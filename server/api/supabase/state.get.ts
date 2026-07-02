import type { AiClosedPositionReview, AssetKind, Order, Position, StrategyHorizon, StrategyLog, Trade } from '~/types/trading'
import { useSupabaseAdmin } from '../../utils/supabase'

const DEFAULT_PORTFOLIO_SLUG = 'default'
const INITIAL_CASH = 50000

function numberValue(value: unknown, fallback = 0) {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : fallback
}

function isMissingTableError(error: { code?: string, message?: string } | null) {
  return error?.code === '42P01'
    || error?.code === 'PGRST205'
    || /sim_closed_position_reviews|schema cache|Could not find the table/i.test(error?.message ?? '')
}

function cashFromTrades(trades: Trade[]) {
  return trades.reduce((cash, trade) => {
    if (trade.side === 'buy') return cash - trade.amount - trade.fee
    return cash + trade.amount - trade.fee
  }, INITIAL_CASH)
}

function tradeNetQuantityByCode(trades: Trade[]) {
  return trades.reduce<Map<string, number>>((sum, trade) => {
    sum.set(trade.code, (sum.get(trade.code) ?? 0) + (trade.side === 'buy' ? trade.quantity : -trade.quantity))
    return sum
  }, new Map())
}

function positionQuantityByCode(positions: Position[]) {
  return positions.reduce<Map<string, number>>((sum, position) => {
    sum.set(position.code, (sum.get(position.code) ?? 0) + position.quantity)
    return sum
  }, new Map())
}

function hasLedgerMismatch(trades: Trade[], positions: Position[]) {
  const tradeQuantityByCode = tradeNetQuantityByCode(trades)
  const positionQuantityMap = positionQuantityByCode(positions)
  const codes = new Set([...tradeQuantityByCode.keys(), ...positionQuantityMap.keys()])
  return [...codes].some((code) => Math.abs((tradeQuantityByCode.get(code) ?? 0) - (positionQuantityMap.get(code) ?? 0)) > 0.001)
}

function repairTradesFromPositions(positions: Position[]): Trade[] {
  const rawAmounts = positions.map((position) => Math.max(0, position.quantity * position.averageCost))
  const totalRawAmount = rawAmounts.reduce((sum, amount) => sum + amount, 0)
  const amountScale = totalRawAmount > INITIAL_CASH ? INITIAL_CASH / totalRawAmount : 1

  return positions
    .filter((position) => position.quantity > 0)
    .map((position, index): Trade => {
      const amount = rawAmounts[index] * amountScale
      return {
        id: `repair-${position.code}-${position.quantity}-${position.openedAt || 'open'}`,
        time: 'ledger-repair',
        side: 'buy',
        code: position.code,
        name: position.name,
        price: position.quantity > 0 ? amount / position.quantity : position.averageCost,
        quantity: position.quantity,
        amount,
        fee: 0,
        pnl: 0,
        tradeDate: position.openedAt || '',
        horizon: position.horizon,
        reason: 'Rebuilt from saved position because the persisted trade ledger was inconsistent.'
      }
    })
}

export default defineEventHandler(async (event) => {
  const query = getQuery(event)
  const slug = typeof query.slug === 'string' && query.slug ? query.slug : DEFAULT_PORTFOLIO_SLUG
  const supabase = useSupabaseAdmin()

  const { data: portfolio, error: portfolioError } = await supabase
    .from('sim_portfolios')
    .select('*')
    .eq('slug', slug)
    .maybeSingle()

  if (portfolioError) throw createError({ statusCode: 500, statusMessage: portfolioError.message })
  if (!portfolio) {
    return {
      ok: true,
      found: false,
      portfolioSlug: slug
    }
  }

  const [
    { data: positions, error: positionsError },
    { data: orders, error: ordersError },
    { data: trades, error: tradesError },
    { data: logs, error: logsError },
    reviewsResult
  ] = await Promise.all([
    supabase.from('sim_positions').select('*').eq('portfolio_slug', slug).order('updated_at', { ascending: false }),
    supabase.from('sim_orders').select('*').eq('portfolio_slug', slug).order('created_at', { ascending: false }).limit(120),
    supabase.from('sim_trades').select('*').eq('portfolio_slug', slug).order('created_at', { ascending: false }),
    supabase.from('sim_strategy_logs').select('*').eq('portfolio_slug', slug).order('created_at', { ascending: false }).limit(80),
    supabase.from('sim_closed_position_reviews').select('*').eq('portfolio_slug', slug).order('reviewed_at', { ascending: false })
  ])

  const error = positionsError || ordersError || tradesError || logsError
  if (error) throw createError({ statusCode: 500, statusMessage: error.message })
  if (reviewsResult.error && !isMissingTableError(reviewsResult.error)) {
    throw createError({ statusCode: 500, statusMessage: reviewsResult.error.message })
  }

  const restoredTrades = (trades ?? []).map((trade): Trade => ({
    id: trade.id,
    time: trade.time,
    side: trade.side,
    code: trade.code,
    name: trade.name,
    price: numberValue(trade.price),
    quantity: numberValue(trade.quantity),
    amount: numberValue(trade.amount),
    fee: numberValue(trade.fee),
    pnl: numberValue(trade.pnl),
    tradeDate: trade.trade_date ?? '',
    horizon: (trade.horizon ?? 'swing') as StrategyHorizon,
    reason: trade.reason ?? '',
    decisionSnapshot: trade.decision_snapshot ?? undefined
  }))

  const restoredPositions = (positions ?? []).map((position): Position => ({
    code: position.code,
    name: position.name,
    kind: position.kind as AssetKind,
    horizon: (position.horizon ?? 'swing') as StrategyHorizon,
    quantity: numberValue(position.quantity),
    availableQuantity: numberValue(position.available_quantity),
    lockedQuantity: numberValue(position.locked_quantity),
    lockedUntil: position.locked_until ?? '',
    averageCost: numberValue(position.average_cost),
    lastPrice: numberValue(position.last_price),
    highestPrice: numberValue(position.highest_price, numberValue(position.last_price)),
    marketValue: numberValue(position.market_value),
    floatingPnl: numberValue(position.floating_pnl),
    floatingPnlPct: numberValue(position.floating_pnl_pct),
    highestPnlPct: numberValue(position.highest_pnl_pct, numberValue(position.floating_pnl_pct)),
    openedAt: position.opened_at ?? ''
  }))
  const ledgerNeedsRepair = cashFromTrades(restoredTrades) < -0.01 || hasLedgerMismatch(restoredTrades, restoredPositions)
  const safeTrades = ledgerNeedsRepair ? repairTradesFromPositions(restoredPositions) : restoredTrades

  return {
    ok: true,
    found: true,
    portfolioSlug: slug,
    portfolio: {
      cash: Math.max(0, cashFromTrades(safeTrades)),
      dataSource: portfolio.data_source ?? '',
      updatedAt: portfolio.market_updated_at ?? ''
    },
    positions: restoredPositions,
    orders: (orders ?? []).map((order): Order => ({
      id: order.id,
      time: order.time,
      side: order.side,
      code: order.code,
      name: order.name,
      price: numberValue(order.price),
      quantity: numberValue(order.quantity),
      amount: numberValue(order.amount),
      status: order.status,
      horizon: (order.horizon ?? 'swing') as StrategyHorizon,
      reason: order.reason ?? ''
    })),
    trades: safeTrades,
    logs: (logs ?? []).map((log): StrategyLog => ({
      id: log.id,
      time: log.time,
      level: log.level,
      message: log.message
    })),
    closedPositionReviews: (reviewsResult.error ? [] : reviewsResult.data ?? []).map((review): AiClosedPositionReview => ({
      code: review.code,
      name: review.name,
      outcome: review.outcome ?? 'neutral',
      summary: review.summary ?? '',
      mistakes: Array.isArray(review.mistakes) ? review.mistakes : [],
      strengths: Array.isArray(review.strengths) ? review.strengths : [],
      ruleIdeas: Array.isArray(review.rule_ideas) ? review.rule_ideas : [],
      updatedAt: review.reviewed_at ?? '',
      model: review.model ?? undefined
    }))
  }
})
