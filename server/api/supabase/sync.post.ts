import type { AiClosedPositionReview, Order, Position, StrategyLog, Trade } from '~/types/trading'
import { useSupabaseAdmin } from '../../utils/supabase'

const MIN_BUY_AMOUNT = 4995
const INITIAL_CASH = 50000
const MAX_FRESH_PORTFOLIO_ASSET = 60000
const POSITION_QUANTITY_TOLERANCE = 0.001
const MIN_CASH_TOLERANCE = -0.01

interface SyncBody {
  portfolioSlug: string
  cash: number
  marketValue: number
  totalAsset: number
  floatingPnl: number
  realizedPnl: number
  returnPct: number
  scannedAssets: number
  signalCount: number
  dataSource: string
  marketUpdatedAt: string
  positions: Position[]
  orders: Order[]
  trades: Trade[]
  logs: StrategyLog[]
  closedPositionReviews?: AiClosedPositionReview[]
}

function tradeNetQuantityByCode(trades: Trade[]) {
  return trades.reduce<Map<string, number>>((sum, trade) => {
    const quantity = Number(trade.quantity) || 0
    sum.set(trade.code, (sum.get(trade.code) ?? 0) + (trade.side === 'buy' ? quantity : -quantity))
    return sum
  }, new Map())
}

function positionQuantityByCode(positions: Position[]) {
  return positions.reduce<Map<string, number>>((sum, position) => {
    sum.set(position.code, (sum.get(position.code) ?? 0) + (Number(position.quantity) || 0))
    return sum
  }, new Map())
}

function cashFromTrades(trades: Trade[]) {
  return trades.reduce((cash, trade) => {
    const amount = Number(trade.amount) || 0
    const fee = Number(trade.fee) || 0
    if (trade.side === 'buy') return cash - amount - fee
    return cash + amount - fee
  }, INITIAL_CASH)
}

function isMissingTableError(error: { code?: string, message?: string } | null) {
  return error?.code === '42P01'
    || error?.code === 'PGRST205'
    || /sim_closed_position_reviews|schema cache|Could not find the table/i.test(error?.message ?? '')
}

function postgrestInList(values: string[]) {
  return `(${values.map((value) => `"${value.replace(/"/g, '""')}"`).join(',')})`
}

export default defineEventHandler(async (event) => {
  const body = await readBody<SyncBody>(event)
  const slug = body.portfolioSlug || 'default'
  const supabase = useSupabaseAdmin()

  const { data: existingPortfolio, error: existingPortfolioError } = await supabase
    .from('sim_portfolios')
    .select('cash, market_value, total_asset')
    .eq('slug', slug)
    .maybeSingle()

  if (existingPortfolioError) throw createError({ statusCode: 500, statusMessage: existingPortfolioError.message })

  const { data: existingPositions, error: existingPositionsError } = await supabase
    .from('sim_positions')
    .select('code, quantity')
    .eq('portfolio_slug', slug)

  if (existingPositionsError) throw createError({ statusCode: 500, statusMessage: existingPositionsError.message })

  if (!body.positions.length && (existingPositions?.length ?? 0) > 0) {
    throw createError({
      statusCode: 409,
      statusMessage: 'Rejected empty positions sync because saved positions already exist.'
    })
  }

  const tradeQuantityByCode = tradeNetQuantityByCode(body.trades)
  const positionQuantityMap = positionQuantityByCode(body.positions)
  const quantityCodes = new Set([...tradeQuantityByCode.keys(), ...positionQuantityMap.keys()])
  const quantityMismatchCode = [...quantityCodes].find((code) => {
    const tradeQuantity = tradeQuantityByCode.get(code) ?? 0
    const positionQuantity = positionQuantityMap.get(code) ?? 0
    return Math.abs(tradeQuantity - positionQuantity) > POSITION_QUANTITY_TOLERANCE
  })

  if (quantityMismatchCode) {
    throw createError({
      statusCode: 409,
      statusMessage: `Rejected inconsistent ledger for ${quantityMismatchCode}: trades net ${tradeQuantityByCode.get(quantityMismatchCode) ?? 0}, positions ${positionQuantityMap.get(quantityMismatchCode) ?? 0}.`
    })
  }

  if (body.positions.length && existingPositions?.length) {
    const incomingTradeIds = body.trades.map((trade) => trade.id)
    const { data: existingTrades, error: existingTradesError } = incomingTradeIds.length
      ? await supabase
          .from('sim_trades')
          .select('id')
          .eq('portfolio_slug', slug)
          .in('id', incomingTradeIds)
      : { data: [], error: null }

    if (existingTradesError) throw createError({ statusCode: 500, statusMessage: existingTradesError.message })

    const existingTradeIds = new Set((existingTrades ?? []).map((trade) => trade.id))
    const existingQuantityByCode = new Map(existingPositions.map((position) => [position.code, Number(position.quantity)]))
    const staleIncrease = body.positions.find((position) => {
      const existingQuantity = existingQuantityByCode.get(position.code)
      if (existingQuantity === undefined || position.quantity <= existingQuantity) return false
      return !body.trades.some((trade) => trade.code === position.code && trade.side === 'buy' && !existingTradeIds.has(trade.id))
    })

    if (staleIncrease) {
      throw createError({
        statusCode: 409,
        statusMessage: `Rejected stale position increase for ${staleIncrease.code}: ${existingQuantityByCode.get(staleIncrease.code)} -> ${staleIncrease.quantity} without a new buy trade.`
      })
    }
  }

  const isFreshResetPortfolio = existingPortfolio
    && Number(existingPortfolio.cash) === INITIAL_CASH
    && Number(existingPortfolio.market_value) === 0
    && Number(existingPortfolio.total_asset) === INITIAL_CASH

  if (isFreshResetPortfolio && body.totalAsset > MAX_FRESH_PORTFOLIO_ASSET) {
    throw createError({
      statusCode: 409,
      statusMessage: `Rejected stale portfolio sync above CNY ${MAX_FRESH_PORTFOLIO_ASSET}; current initial capital is CNY ${INITIAL_CASH}.`
    })
  }

  const cashToPersist = cashFromTrades(body.trades)
  if (cashToPersist < MIN_CASH_TOLERANCE) {
    throw createError({
      statusCode: 409,
      statusMessage: `Rejected inconsistent ledger: trades imply negative cash CNY ${cashToPersist.toFixed(2)}.`
    })
  }

  const marketValueToPersist = body.marketValue
  const floatingPnlToPersist = body.floatingPnl
  const totalAssetToPersist = cashToPersist + marketValueToPersist
  const returnPctToPersist = (totalAssetToPersist - INITIAL_CASH) / INITIAL_CASH * 100

  const { error: portfolioError } = await supabase
    .from('sim_portfolios')
    .upsert({
      slug,
      cash: cashToPersist,
      market_value: marketValueToPersist,
      total_asset: totalAssetToPersist,
      floating_pnl: floatingPnlToPersist,
      realized_pnl: body.realizedPnl,
      return_pct: returnPctToPersist,
      scanned_assets: body.scannedAssets,
      signal_count: body.signalCount,
      data_source: body.dataSource,
      market_updated_at: body.marketUpdatedAt || null,
      updated_at: new Date().toISOString()
    }, { onConflict: 'slug' })

  if (portfolioError) throw createError({ statusCode: 500, statusMessage: portfolioError.message })

  const incomingPositionCodes = body.positions.map((position) => position.code)
  let deletePositionsQuery = supabase
    .from('sim_positions')
    .delete()
    .eq('portfolio_slug', slug)
  if (incomingPositionCodes.length) {
    deletePositionsQuery = deletePositionsQuery.not('code', 'in', postgrestInList(incomingPositionCodes))
  }

  const { error: deletePositionsError } = await deletePositionsQuery

  if (deletePositionsError) throw createError({ statusCode: 500, statusMessage: deletePositionsError.message })

  if (body.positions.length) {
    const { error } = await supabase
      .from('sim_positions')
      .upsert(body.positions.map((position) => ({
        portfolio_slug: slug,
        code: position.code,
        name: position.name,
        kind: position.kind,
        horizon: position.horizon,
        quantity: position.quantity,
        available_quantity: position.availableQuantity,
        locked_quantity: position.lockedQuantity,
        locked_until: position.lockedUntil || null,
        average_cost: position.averageCost,
        last_price: position.lastPrice,
        highest_price: position.highestPrice,
        market_value: position.marketValue,
        floating_pnl: position.floatingPnl,
        floating_pnl_pct: position.floatingPnlPct,
        highest_pnl_pct: position.highestPnlPct,
        opened_at: position.openedAt,
        updated_at: new Date().toISOString()
      })), { onConflict: 'portfolio_slug,code' })

    if (error) throw createError({ statusCode: 500, statusMessage: error.message })
  }

  const persistableOrders = body.orders.filter((order) => order.side !== 'buy' || order.amount >= MIN_BUY_AMOUNT)

  const incomingOrderIds = persistableOrders.map((order) => order.id)
  let deleteOrdersQuery = supabase
    .from('sim_orders')
    .delete()
    .eq('portfolio_slug', slug)
  if (incomingOrderIds.length) {
    deleteOrdersQuery = deleteOrdersQuery.not('id', 'in', postgrestInList(incomingOrderIds))
  }
  const { error: deleteOrdersError } = await deleteOrdersQuery
  if (deleteOrdersError) throw createError({ statusCode: 500, statusMessage: deleteOrdersError.message })

  if (persistableOrders.length) {
    const { error } = await supabase
      .from('sim_orders')
      .upsert(persistableOrders.map((order) => ({
        id: order.id,
        portfolio_slug: slug,
        time: order.time,
        side: order.side,
        code: order.code,
        name: order.name,
        price: order.price,
        quantity: order.quantity,
        amount: order.amount,
        status: order.status,
        horizon: order.horizon,
        reason: order.reason
      })), { onConflict: 'id' })

    if (error) throw createError({ statusCode: 500, statusMessage: error.message })
  }

  const incomingTradeIds = body.trades.map((trade) => trade.id)
  let deleteTradesQuery = supabase
    .from('sim_trades')
    .delete()
    .eq('portfolio_slug', slug)
  if (incomingTradeIds.length) {
    deleteTradesQuery = deleteTradesQuery.not('id', 'in', postgrestInList(incomingTradeIds))
  }
  const { error: deleteTradesError } = await deleteTradesQuery
  if (deleteTradesError) throw createError({ statusCode: 500, statusMessage: deleteTradesError.message })

  if (body.trades.length) {
    const { error } = await supabase
      .from('sim_trades')
      .upsert(body.trades.map((trade) => ({
        id: trade.id,
        portfolio_slug: slug,
        time: trade.time,
        side: trade.side,
        code: trade.code,
        name: trade.name,
        price: trade.price,
        quantity: trade.quantity,
        amount: trade.amount,
        fee: trade.fee,
        pnl: trade.pnl,
        trade_date: trade.tradeDate || null,
        horizon: trade.horizon,
        reason: trade.reason,
        decision_snapshot: trade.decisionSnapshot ?? null
      })), { onConflict: 'id' })

    if (error) throw createError({ statusCode: 500, statusMessage: error.message })
  }

  const incomingLogIds = body.logs.map((log) => log.id)
  let deleteLogsQuery = supabase
    .from('sim_strategy_logs')
    .delete()
    .eq('portfolio_slug', slug)
  if (incomingLogIds.length) {
    deleteLogsQuery = deleteLogsQuery.not('id', 'in', postgrestInList(incomingLogIds))
  }
  const { error: deleteLogsError } = await deleteLogsQuery
  if (deleteLogsError) throw createError({ statusCode: 500, statusMessage: deleteLogsError.message })

  if (body.logs.length) {
    const { error } = await supabase
      .from('sim_strategy_logs')
      .upsert(body.logs.map((log) => ({
        id: log.id,
        portfolio_slug: slug,
        time: log.time,
        level: log.level,
        message: log.message
      })), { onConflict: 'id' })

    if (error) throw createError({ statusCode: 500, statusMessage: error.message })
  }

  const reviews = body.closedPositionReviews ?? []
  if (reviews.length) {
    const { error } = await supabase
      .from('sim_closed_position_reviews')
      .upsert(reviews.map((review) => ({
        portfolio_slug: slug,
        code: review.code,
        name: review.name,
        outcome: review.outcome,
        summary: review.summary,
        mistakes: review.mistakes,
        strengths: review.strengths,
        rule_ideas: review.ruleIdeas,
        model: review.model ?? null,
        reviewed_at: review.updatedAt || new Date().toISOString(),
        updated_at: new Date().toISOString()
      })), { onConflict: 'portfolio_slug,code' })

    if (error && !isMissingTableError(error)) throw createError({ statusCode: 500, statusMessage: error.message })
  }

  return {
    ok: true,
    syncedAt: new Date().toISOString()
  }
})
