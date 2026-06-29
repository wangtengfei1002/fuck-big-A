import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import type { AiMarketSummary, AiTradeDecision, MarketAsset, MarketIndex, NewsItem, Order, Position, StrategyHorizon, StrategyLog, StrategySignal, Trade } from '~/types/trading'

const INITIAL_CASH = 50000
const MIN_BUY_AMOUNT = 4995
const MIN_SELL_AMOUNT = 5000
const SMALL_POSITION_CLEAR_AMOUNT = 5000
const PREFERRED_BUY_AMOUNT = 10000
const AI_SKIP_CASH_FLOOR = 5000
const MAX_BUYS_PER_TICK = 2
const MARKET_OPEN_MINUTE = 9 * 60 + 25
const MARKET_CLOSE_MINUTE = 15 * 60
const PORTFOLIO_SLUG = 'default'
const AI_DECISION_COOLDOWN_MS = 10 * 60 * 1000
const HORIZON_BUCKET_CAPS: Record<StrategyHorizon, number> = { long: 1, swing: 1, short: 1 }
const MIN_HOLD_DAYS: Record<StrategyHorizon, number> = { long: 10, swing: 3, short: 1 }
type IncomeRange = 'today' | 'week' | '7d' | 'month' | 'recentMonth' | 'total'

function defaultTargetWeight(horizon: StrategyHorizon) {
  if (horizon === 'long') return 0.45
  if (horizon === 'short') return 0.3
  return 0.4
}

function nowTime() {
  return new Intl.DateTimeFormat('zh-CN', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false
  }).format(new Date())
}

function chinaTradeDate(date = new Date()) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).format(date)
}

function tradeDateToUtc(date: string) {
  const [year, month, day] = date.split('-').map(Number)
  if (!year || !month || !day) return null
  return Date.UTC(year, month - 1, day)
}

function daysSinceTradeDate(date: string) {
  const tradeUtc = tradeDateToUtc(date)
  const todayUtc = tradeDateToUtc(chinaTradeDate())
  if (tradeUtc === null || todayUtc === null) return Number.POSITIVE_INFINITY
  return Math.max(0, Math.floor((todayUtc - tradeUtc) / 86_400_000))
}

function ceilToLotQuantity(quantity: number) {
  return Math.ceil(quantity / 100) * 100
}

function floorToLotQuantity(quantity: number) {
  return Math.floor(quantity / 100) * 100
}

function isT0Etf(asset: Pick<MarketAsset, 'kind' | 'code' | 'name' | 'sector'>) {
  if (asset.kind !== 'etf') return false
  const text = `${asset.name}${asset.sector}`.toLowerCase()
  return asset.code.startsWith('513')
    || text.includes('港')
    || text.includes('恒生')
    || text.includes('中概')
    || text.includes('纳指')
    || text.includes('标普')
    || text.includes('日经')
    || text.includes('德国')
    || text.includes('法国')
    || text.includes('黄金')
    || text.includes('商品')
    || text.includes('货币')
    || text.includes('债')
    || text.includes('qdii')
}

function calcBuyFee(amount: number) {
  return Math.max(5, amount * 0.00025)
}

function calcSellFee(amount: number) {
  return Math.max(5, amount * 0.00025) + amount * 0.0005
}

function getChinaTimeParts() {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Shanghai',
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  }).formatToParts(new Date())

  const get = (type: string) => parts.find((part) => part.type === type)?.value ?? ''
  return {
    weekday: get('weekday'),
    hour: Number(get('hour')),
    minute: Number(get('minute'))
  }
}

function isChinaMarketAutoWindow() {
  const { weekday, hour, minute } = getChinaTimeParts()
  if (weekday === 'Sat' || weekday === 'Sun') return false
  const currentMinute = hour * 60 + minute
  return currentMinute >= MARKET_OPEN_MINUTE && currentMinute <= MARKET_CLOSE_MINUTE
}

export const useTradingStore = defineStore('trading', () => {
  const cash = ref(INITIAL_CASH)
  const assets = ref<MarketAsset[]>([])
  const indexes = ref<MarketIndex[]>([])
  const news = ref<NewsItem[]>([])
  const positions = ref<Position[]>([])
  const orders = ref<Order[]>([])
  const trades = ref<Trade[]>([])
  const logs = ref<StrategyLog[]>([
    { id: 'l0', time: nowTime(), level: 'low', message: 'Auto pilot initialized with CNY 50,000 simulated capital.' }
  ])
  const selectedCode = ref('')
  const autoPilot = ref(true)
  const autoExecute = ref(true)
  const strategyTick = ref(0)
  const loading = ref(false)
  const liveError = ref('')
  const dataSource = ref('')
  const updatedAt = ref('')
  const lastAutoSkip = ref('')
  const syncStatus = ref<'idle' | 'syncing' | 'synced' | 'error'>('idle')
  const syncError = ref('')
  const restoreStatus = ref<'idle' | 'loading' | 'restored' | 'empty' | 'error'>('idle')
  const restoreError = ref('')
  const aiStatus = ref<'idle' | 'thinking' | 'used' | 'fallback' | 'disabled' | 'error'>('idle')
  const aiError = ref('')
  const lastAiDecisionAt = ref(0)
  const autoTradeRunning = ref(false)
  const marketSummary = ref<AiMarketSummary | null>(null)
  const marketSummaryStatus = ref<'idle' | 'loading' | 'ready' | 'fallback' | 'error'>('idle')
  const marketSummaryError = ref('')

  const assetMap = computed(() => new Map(assets.value.map((asset) => [asset.code, asset])))
  const selectedAsset = computed(() => assetMap.value.get(selectedCode.value) ?? assets.value[0])
  const marketValue = computed(() => positions.value.reduce((sum, item) => sum + item.marketValue, 0))
  const totalAsset = computed(() => cash.value + marketValue.value)
  const floatingPnl = computed(() => positions.value.reduce((sum, item) => sum + item.floatingPnl, 0))
  const horizonExposure = computed(() => positions.value.reduce<Record<StrategyHorizon, number>>((sum, position) => {
    sum[position.horizon] += position.marketValue
    return sum
  }, { long: 0, swing: 0, short: 0 }))
  const realizedPnl = computed(() => trades.value
    .filter((trade) => trade.side === 'sell')
    .reduce((sum, trade) => sum + trade.pnl, 0))
  const totalPnl = computed(() => totalAsset.value - INITIAL_CASH)
  const totalFees = computed(() => trades.value.reduce((sum, trade) => sum + trade.fee, 0))
  const returnPct = computed(() => (totalAsset.value - INITIAL_CASH) / INITIAL_CASH * 100)
  const tIncomeToday = computed(() => tIncomeForRange('today'))
  const tIncome7d = computed(() => tIncomeForRange('7d'))
  const tIncomeMonth = computed(() => tIncomeForRange('month'))
  const tIncomeRecentMonth = computed(() => tIncomeForRange('recentMonth'))
  const tIncomeTotal = computed(() => tIncomeForRange('total'))
  const incomeToday = computed(() => realizedIncomeForRange('today'))
  const incomeWeek = computed(() => realizedIncomeForRange('week'))
  const incomeMonth = computed(() => realizedIncomeForRange('month'))
  const incomeRecentMonth = computed(() => realizedIncomeForRange('recentMonth'))
  const incomeTotal = computed(() => realizedIncomeForRange('total'))

  const { scoreMarket, generateSignals } = useStrategy()
  const marketScore = computed(() => Math.round(scoreMarket(indexes.value, news.value)))
  const signals = computed<StrategySignal[]>(() => generateSignals(assets.value, indexes.value, news.value, positions.value, totalAsset.value))

  function addLog(message: string, level: StrategyLog['level'] = 'low') {
    logs.value.unshift({
      id: `l${Date.now()}${Math.random().toString(16).slice(2)}`,
      time: nowTime(),
      level,
      message
    })
    logs.value = logs.value.slice(0, 80)
  }

  function addOrder(order: Omit<Order, 'id' | 'time'>) {
    orders.value.unshift({
      id: `o${Date.now()}${Math.random().toString(16).slice(2)}`,
      time: nowTime(),
      ...order
    })
    orders.value = orders.value.slice(0, 120)
  }

  async function syncToDatabase() {
    syncStatus.value = 'syncing'
    syncError.value = ''
    try {
      await $fetch('/api/supabase/sync', {
        method: 'POST',
        body: {
          portfolioSlug: PORTFOLIO_SLUG,
          cash: cash.value,
          marketValue: marketValue.value,
          totalAsset: totalAsset.value,
          floatingPnl: floatingPnl.value,
          realizedPnl: realizedPnl.value,
          returnPct: returnPct.value,
          scannedAssets: assets.value.length,
          signalCount: signals.value.length,
          dataSource: dataSource.value,
          marketUpdatedAt: updatedAt.value,
          positions: positions.value,
          orders: orders.value,
          trades: trades.value,
          logs: logs.value
        }
      })
      syncStatus.value = 'synced'
      return true
    } catch (error) {
      syncStatus.value = 'error'
      syncError.value = error instanceof Error ? error.message : 'Supabase sync failed'
      return false
    }
  }

  async function restoreFromDatabase() {
    restoreStatus.value = 'loading'
    restoreError.value = ''
    try {
      const state = await $fetch<{
        ok: boolean
        found: boolean
        portfolio?: {
          cash: number
          dataSource: string
          updatedAt: string
        }
        positions?: Position[]
        orders?: Order[]
        trades?: Trade[]
        logs?: StrategyLog[]
      }>('/api/supabase/state', {
        query: { slug: PORTFOLIO_SLUG }
      })

      if (!state.found || !state.portfolio) {
        restoreStatus.value = 'empty'
        return false
      }

      trades.value = state.trades ?? []
      const restoredPositions = state.positions ?? []
      cash.value = state.portfolio.cash
      positions.value = normalizeT1Locks(restoredPositions)
      orders.value = state.orders ?? []
      logs.value = state.logs?.length
        ? state.logs
        : [{ id: 'l0', time: nowTime(), level: 'low', message: 'Auto pilot initialized with CNY 50,000 simulated capital.' }]
      dataSource.value = state.portfolio.dataSource
      updatedAt.value = state.portfolio.updatedAt
      restoreStatus.value = 'restored'
      addLog('Restored simulated portfolio from Supabase.', 'low')
      return true
    } catch (error) {
      restoreStatus.value = 'error'
      restoreError.value = error instanceof Error ? error.message : 'Supabase restore failed'
      return false
    }
  }

  async function loadLiveMarket(options: { summarize?: boolean } = {}) {
    const shouldSummarize = options.summarize ?? true
    loading.value = true
    liveError.value = ''
    try {
      const snapshot = await $fetch<{
        source: string
        updatedAt: string
        indexes: MarketIndex[]
        assets: MarketAsset[]
        news: NewsItem[]
      }>('/api/market/snapshot', {
        query: {
          codes: positions.value.map((position) => position.code).join(',')
        }
      })

      indexes.value = snapshot.indexes
      assets.value = snapshot.assets
      news.value = snapshot.news
      dataSource.value = snapshot.source
      updatedAt.value = snapshot.updatedAt
      if ((!selectedCode.value || !assets.value.some((asset) => asset.code === selectedCode.value)) && assets.value[0]) {
        selectedCode.value = assets.value[0].code
      }
      refreshMarks()
      addLog(
        `Live market refreshed from ${snapshot.source}. Indexes ${indexes.value.length}, tradable ${assets.value.length}, signals ${signals.value.length}, market score ${marketScore.value}.`,
        'low'
      )
      if (shouldSummarize) await requestMarketSummary()
      await syncToDatabase()
      return true
    } catch (error) {
      liveError.value = error instanceof Error ? error.message : 'Live market request failed'
      addLog(`Live market refresh failed: ${liveError.value}`, 'high')
      return false
    } finally {
      loading.value = false
    }
  }

  function refreshMarks() {
    positions.value = normalizeT1Locks(positions.value).map((position) => {
      const asset = assetMap.value.get(position.code)
      if (!asset) return position
      const marketValue = position.quantity * asset.price
      const floatingPnl = marketValue - position.quantity * position.averageCost
      const floatingPnlPct = floatingPnl / Math.max(position.quantity * position.averageCost, 1) * 100
      return {
        ...position,
        availableQuantity: Math.min(position.availableQuantity, position.quantity),
        lastPrice: asset.price,
        highestPrice: Math.max(position.highestPrice || position.lastPrice || asset.price, asset.price),
        marketValue,
        floatingPnl,
        floatingPnlPct,
        highestPnlPct: Math.max(position.highestPnlPct ?? floatingPnlPct, floatingPnlPct)
      }
    })
  }

  function normalizeT1Locks(items: Position[]) {
    const today = chinaTradeDate()
    let released = false
    const normalized = items.map((position) => {
      const lockedQuantity = Math.max(0, Math.min(position.lockedQuantity ?? 0, position.quantity))
      const asset = assetMap.value.get(position.code)
      const canTradeT0 = asset ? isT0Etf(asset) : false
      if (canTradeT0 || !position.lockedUntil || position.lockedUntil < today || lockedQuantity <= 0) {
        if (!canTradeT0 && lockedQuantity > 0) released = true
        return {
          ...position,
          lockedQuantity: 0,
          lockedUntil: '',
          availableQuantity: position.quantity
        }
      }
      return {
        ...position,
        lockedQuantity,
        availableQuantity: Math.max(0, position.quantity - lockedQuantity)
      }
    })
    if (released) addLog('Released T+1 locked stock positions for the new trading day.', 'low')
    return normalized
  }

  function buy(asset: MarketAsset, targetAmount: number, reason: string, horizon: StrategyHorizon = 'swing') {
    const existing = positions.value.find((position) => position.code === asset.code)
    const floorQuantity = floorToLotQuantity(targetAmount / asset.price)
    const ceilQuantity = ceilToLotQuantity(targetAmount / asset.price)
    const floorAmount = floorQuantity * asset.price
    const ceilAmount = ceilQuantity * asset.price
    const canRoundUp = floorAmount < PREFERRED_BUY_AMOUNT
      && ceilQuantity >= 100
      && ceilAmount <= Math.max(targetAmount * 1.25, PREFERRED_BUY_AMOUNT)
      && ceilAmount + calcBuyFee(ceilAmount) <= cash.value
    const lotQuantity = canRoundUp ? ceilQuantity : floorQuantity
    if (lotQuantity < 100) {
      addLog(`Skip buy ${asset.name}: target amount cannot reach one lot.`, 'low')
      return false
    }

    const amount = lotQuantity * asset.price
    if (amount < MIN_BUY_AMOUNT) {
      addLog(`Skip buy ${asset.name}: CNY ${amount.toFixed(0)} is below minimum buy amount ${MIN_BUY_AMOUNT}.`, 'low')
      return false
    }

    const fee = calcBuyFee(amount)
    if (amount + fee > cash.value || asset.price >= asset.limitUp) {
      addOrder({ side: 'buy', code: asset.code, name: asset.name, price: asset.price, quantity: lotQuantity, amount, status: 'rejected', horizon, reason: amount + fee > cash.value ? '可用现金不足' : '接近或达到涨停，放弃追高' })
      return false
    }

    cash.value -= amount + fee
    if (existing) {
      const nextQuantity = existing.quantity + lotQuantity
      existing.averageCost = (existing.averageCost * existing.quantity + amount + fee) / nextQuantity
      existing.quantity = nextQuantity
      if (!isT0Etf(asset)) {
        existing.lockedQuantity = (existing.lockedQuantity ?? 0) + lotQuantity
        existing.lockedUntil = chinaTradeDate()
        existing.availableQuantity = Math.max(0, nextQuantity - existing.lockedQuantity)
      } else {
        existing.availableQuantity = nextQuantity
      }
      existing.lastPrice = asset.price
      existing.highestPrice = Math.max(existing.highestPrice || asset.price, asset.price)
      existing.marketValue = nextQuantity * asset.price
    } else {
      positions.value.push({
        code: asset.code,
        name: asset.name,
        kind: asset.kind,
        horizon,
        quantity: lotQuantity,
        availableQuantity: isT0Etf(asset) ? lotQuantity : 0,
        lockedQuantity: isT0Etf(asset) ? 0 : lotQuantity,
        lockedUntil: isT0Etf(asset) ? '' : chinaTradeDate(),
        averageCost: (amount + fee) / lotQuantity,
        lastPrice: asset.price,
        highestPrice: asset.price,
        marketValue: amount,
        floatingPnl: -fee,
        floatingPnlPct: -fee / amount * 100,
        highestPnlPct: 0,
        openedAt: chinaTradeDate()
      })
    }

    trades.value.unshift({
      id: `t${Date.now()}${asset.code}`,
      time: nowTime(),
      side: 'buy',
      code: asset.code,
      name: asset.name,
      price: asset.price,
      quantity: lotQuantity,
      amount,
      fee,
      pnl: 0,
      tradeDate: chinaTradeDate(),
      horizon,
      reason
    })
    addOrder({ side: 'buy', code: asset.code, name: asset.name, price: asset.price, quantity: lotQuantity, amount, status: 'filled', horizon, reason })
    refreshMarks()
    addLog(`BUY ${asset.name} ${lotQuantity} @ ${asset.price.toFixed(3)}. ${reason}`, asset.riskScore > 55 ? 'medium' : 'low')
    syncToDatabase()
    return true
  }

  function sell(asset: MarketAsset, ratio: number, reason: string) {
    positions.value = normalizeT1Locks(positions.value)
    refreshMarks()
    const existing = positions.value.find((position) => position.code === asset.code)
    if (!existing || existing.availableQuantity < 100 || asset.price <= asset.limitDown) {
      const blockedReason = !existing ? '无持仓' : existing.availableQuantity < 100 ? 'T+1 或可卖数量不足' : '接近或达到跌停，无法卖出'
      addLog(`Skip sell ${asset.name} @ ${asset.price.toFixed(3)}: ${blockedReason}.`, 'low')
      return false
    }

    const positionValue = existing.quantity * asset.price
    const availableValue = existing.availableQuantity * asset.price
    const minHoldDays = MIN_HOLD_DAYS[existing.horizon]
    const heldDays = daysSinceTradeDate(existing.openedAt)
    const mustClearSmallPosition = positionValue < SMALL_POSITION_CLEAR_AMOUNT
    const emergencyExit = asset.riskScore >= 86
      || existing.floatingPnlPct <= (existing.horizon === 'long' ? -13 : existing.horizon === 'swing' ? -8 : -4.5)

    if (!mustClearSmallPosition && heldDays < minHoldDays && !emergencyExit) {
      addLog(`Skip sell ${asset.name} @ ${asset.price.toFixed(3)}: ${existing.horizon} 持仓仅 ${heldDays} 天，未到 ${minHoldDays} 天最短观察期.`, 'low')
      return false
    }

    let quantity = floorToLotQuantity(existing.availableQuantity * ratio)
    if (mustClearSmallPosition) {
      quantity = existing.availableQuantity >= existing.quantity ? existing.quantity : 0
    } else if (quantity > 0 && quantity * asset.price < MIN_SELL_AMOUNT) {
      quantity = ceilToLotQuantity(MIN_SELL_AMOUNT / asset.price)
    }

    quantity = Math.min(quantity, existing.availableQuantity)
    quantity = floorToLotQuantity(quantity)
    const leavesTinyRemainder = (existing.quantity - quantity) > 0 && (existing.quantity - quantity) * asset.price < MIN_SELL_AMOUNT
    if (!mustClearSmallPosition && leavesTinyRemainder && existing.availableQuantity >= existing.quantity) {
      quantity = existing.quantity
    }

    if (quantity < 100) {
      const blockedReason = mustClearSmallPosition
        ? `当前持仓 ${positionValue.toFixed(0)} 低于 ${SMALL_POSITION_CLEAR_AMOUNT}，但可卖数量不足以清仓`
        : availableValue < MIN_SELL_AMOUNT
          ? `可卖市值 ${availableValue.toFixed(0)} 低于单次最低卖出 ${MIN_SELL_AMOUNT}`
          : '卖出数量不足一手'
      addLog(`Skip sell ${asset.name} @ ${asset.price.toFixed(3)}: ${blockedReason}.`, 'low')
      return false
    }

    const amount = quantity * asset.price
    if (!mustClearSmallPosition && amount < MIN_SELL_AMOUNT) {
      addLog(`Skip sell ${asset.name} @ ${asset.price.toFixed(3)}: 单次卖出 ${amount.toFixed(0)} 低于最低 ${MIN_SELL_AMOUNT}.`, 'low')
      return false
    }

    const fee = calcSellFee(amount)
    const costBasis = quantity * existing.averageCost
    const pnl = amount - fee - costBasis
    const pnlPct = pnl / Math.max(costBasis, 1) * 100
    const sellOutcome = `${pnl >= 0 ? '盈利卖出' : '亏损卖出'} ${pnl >= 0 ? '+' : ''}${pnl.toFixed(2)} (${pnlPct >= 0 ? '+' : ''}${pnlPct.toFixed(2)}%)`
    cash.value += amount - fee
    existing.quantity -= quantity
    existing.availableQuantity -= quantity

    trades.value.unshift({
      id: `t${Date.now()}${asset.code}`,
      time: nowTime(),
      side: 'sell',
      code: asset.code,
      name: asset.name,
      price: asset.price,
      quantity,
      amount,
      fee,
      pnl,
      tradeDate: chinaTradeDate(),
      horizon: existing.horizon,
      reason: `${reason} | ${sellOutcome}`
    })
    addOrder({ side: 'sell', code: asset.code, name: asset.name, price: asset.price, quantity, amount, status: 'filled', horizon: existing.horizon, reason: `${reason} | ${sellOutcome}` })

    positions.value = positions.value.filter((position) => position.quantity > 0)
    refreshMarks()
    addLog(`SELL ${asset.name} ${quantity} @ ${asset.price.toFixed(3)}. ${pnl >= 0 ? 'Profit' : 'Loss'} ${pnl.toFixed(2)} (${pnlPct >= 0 ? '+' : ''}${pnlPct.toFixed(2)}%). ${reason}`, asset.riskScore > 55 ? 'high' : 'medium')
    syncToDatabase()
    return true
  }

  function candidateSignals() {
    const priority = { sell: 0, buy: 1, hold: 2 }
    return [...signals.value]
      .sort((a, b) => priority[a.action] - priority[b.action] || b.score - a.score)
      .slice(0, 80)
  }

  function shouldSkipAiDecision() {
    const hasPositions = positions.value.length > 0
    const allPositionsBlockedForSell = hasPositions
      && positions.value.every((position) => position.availableQuantity < 100)
    return allPositionsBlockedForSell && cash.value < AI_SKIP_CASH_FLOOR
  }

  function startOfChinaWeek(date = new Date()) {
    const weekday = new Intl.DateTimeFormat('en-US', {
      timeZone: 'Asia/Shanghai',
      weekday: 'short'
    }).format(date)
    const weekdayIndex = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(weekday)
    const daysFromMonday = (weekdayIndex + 6) % 7
    const start = new Date(date)
    start.setDate(start.getDate() - daysFromMonday)
    return chinaTradeDate(start)
  }

  function realizedIncomeForRange(range: IncomeRange) {
    const now = new Date()
    const today = chinaTradeDate(now)
    const monthPrefix = today.slice(0, 7)
    const weekStart = startOfChinaWeek(now)
    const start = new Date(now)
    if (range === '7d') start.setDate(start.getDate() - 6)
    if (range === 'recentMonth') start.setMonth(start.getMonth() - 1)
    const startDate = chinaTradeDate(start)

    return trades.value
      .filter((trade) => trade.side === 'sell')
      .filter((trade) => {
        if (!trade.tradeDate) return range === 'total'
        const date = trade.tradeDate
        if (range === 'total') return true
        if (range === 'today') return date === today
        if (range === 'week') return date >= weekStart && date <= today
        if (range === 'month') return date.startsWith(monthPrefix)
        return date >= startDate && date <= today
      })
      .reduce((sum, trade) => sum + trade.pnl, 0)
  }

  function tIncomeForRange(range: Exclude<IncomeRange, 'week'>) {
    return realizedIncomeForRange(range)
  }

  async function requestAiDecisions() {
    if (Date.now() - lastAiDecisionAt.value < AI_DECISION_COOLDOWN_MS) return []
    positions.value = normalizeT1Locks(positions.value)
    refreshMarks()
    if (shouldSkipAiDecision()) {
      lastAiDecisionAt.value = Date.now()
      aiStatus.value = 'fallback'
      aiError.value = ''
      addLog(`AI decision skipped: all positions are T+1 locked and cash ${cash.value.toFixed(0)} is below ${AI_SKIP_CASH_FLOOR}.`, 'low')
      return []
    }
    aiStatus.value = 'thinking'
    aiError.value = ''
    try {
      const response = await $fetch<{
        enabled: boolean
        decisions: AiTradeDecision[]
        reason?: string
        model?: string
      }>('/api/ai/decide', {
        method: 'POST',
        body: {
          cash: cash.value,
          totalAsset: totalAsset.value,
          marketValue: marketValue.value,
          marketScore: marketScore.value,
          indexes: indexes.value,
          news: news.value,
          positions: positions.value,
          candidates: candidateSignals(),
          assets: assets.value
        }
      })

      lastAiDecisionAt.value = Date.now()
      if (!response.enabled) {
        aiStatus.value = 'disabled'
        aiError.value = response.reason ?? ''
        return []
      }
      aiStatus.value = response.decisions.length ? 'used' : 'fallback'
      addLog(`AI decision layer ${response.model ?? ''}: ${response.decisions.length} actionable decisions.`, 'low')
      return response.decisions
    } catch (error) {
      lastAiDecisionAt.value = Date.now()
      aiStatus.value = 'error'
      aiError.value = error instanceof Error ? error.message : 'AI decision failed'
      addLog(`AI decision failed, using rule fallback: ${aiError.value}`, 'medium')
      return []
    }
  }

  async function requestMarketSummary() {
    if (!assets.value.length) return null
    marketSummaryStatus.value = 'loading'
    marketSummaryError.value = ''
    try {
      const response = await $fetch<{
        enabled: boolean
        summary: AiMarketSummary
        reason?: string
      }>('/api/ai/market-summary', {
        method: 'POST',
        body: {
          marketScore: marketScore.value,
          indexes: indexes.value,
          news: news.value,
          assets: assets.value
        }
      })

      marketSummary.value = response.summary
      marketSummaryStatus.value = response.enabled ? 'ready' : 'fallback'
      marketSummaryError.value = response.reason ?? ''
      return response.summary
    } catch (error) {
      marketSummaryStatus.value = 'error'
      marketSummaryError.value = error instanceof Error ? error.message : 'AI market summary failed'
      return null
    }
  }

  function executeAiDecision(decision: AiTradeDecision) {
    const asset = assetMap.value.get(decision.code)
    if (!asset || decision.confidence < 0.55) return false
    if (decision.action === 'sell') {
      const ratio = Math.max(0.2, Math.min(1, decision.sellRatio ?? 0.5))
      return sell(asset, ratio, `AI ${decision.horizon}: ${decision.reason}`)
    }
    if (decision.action === 'buy') {
      const bucketRoom = Math.max(0, totalAsset.value * HORIZON_BUCKET_CAPS[decision.horizon] - horizonExposure.value[decision.horizon])
      const targetWeight = Math.min(Math.max(decision.weight ?? defaultTargetWeight(decision.horizon), PREFERRED_BUY_AMOUNT / Math.max(totalAsset.value, 1)), 0.95)
      const cashCap = Math.max(0, cash.value - 100)
      const targetAmount = Math.min(totalAsset.value * targetWeight, cashCap, bucketRoom)
      return buy(asset, targetAmount, `AI ${decision.horizon}: ${decision.reason}`, decision.horizon)
    }
    return false
  }

  async function runRuleTrade() {
    const sellSignals = signals.value.filter((signal) => signal.action === 'sell').slice(0, 3)
    for (const signal of sellSignals) {
      const asset = assetMap.value.get(signal.code)
      if (asset) sell(asset, signal.sellRatio || 0.5, signal.reason)
    }

    const buySignals = signals.value
      .filter((signal) => signal.action === 'buy')
      .slice(0, MAX_BUYS_PER_TICK)
    for (const signal of buySignals) {
      const asset = assetMap.value.get(signal.code)
      if (!asset) continue
      const bucketRoom = Math.max(0, totalAsset.value * HORIZON_BUCKET_CAPS[signal.horizon] - horizonExposure.value[signal.horizon])
      const cashCap = signal.horizon === 'short' ? cash.value * 0.35 : cash.value * 0.55
      const targetAmount = Math.min(Math.max(totalAsset.value * signal.suggestedWeight, PREFERRED_BUY_AMOUNT), cashCap, bucketRoom)
      buy(asset, targetAmount, signal.reason, signal.horizon)
    }

    if (!buySignals.length && !sellSignals.length) {
      addLog(`No trade. Market score ${marketScore.value}; keeping cash reserve ${cash.value.toFixed(0)}.`, 'low')
    }
  }

  async function runAutoTrade() {
    if (autoTradeRunning.value) {
      addLog('Auto scan skipped because the previous scan is still running.', 'low')
      return
    }
    autoTradeRunning.value = true
    strategyTick.value += 1
    try {
      if (!autoExecute.value) {
        addLog('Auto execution is off. Market scan and trade decisions are paused.', 'low')
        return
      }
      if (!isChinaMarketAutoWindow()) {
        const todaySkip = new Date().toDateString()
        if (lastAutoSkip.value !== todaySkip) {
          lastAutoSkip.value = todaySkip
          addLog('Auto scan skipped outside A-share trading window 09:25-15:00 Asia/Shanghai.', 'low')
        }
        return
      }
      const loaded = await loadLiveMarket({ summarize: !assets.value.length })
      if (!loaded) return
      refreshMarks()

      const aiDecisions = await requestAiDecisions()
      let executedAiTrades = 0
      for (const decision of aiDecisions) {
        if (executeAiDecision(decision)) executedAiTrades += 1
      }
      if (!executedAiTrades && (aiStatus.value === 'disabled' || aiStatus.value === 'error')) {
        await runRuleTrade()
      }
    } finally {
      autoTradeRunning.value = false
    }
  }

  function selectAsset(code: string) {
    selectedCode.value = code
  }

  return {
    cash,
    assets,
    indexes,
    news,
    positions,
    orders,
    trades,
    logs,
    loading,
    liveError,
    dataSource,
    updatedAt,
    lastAutoSkip,
    syncStatus,
    syncError,
    restoreStatus,
    restoreError,
    aiStatus,
    aiError,
    marketSummary,
    marketSummaryStatus,
    marketSummaryError,
    selectedCode,
    selectedAsset,
    autoPilot,
    autoExecute,
    marketValue,
    horizonExposure,
    totalAsset,
    floatingPnl,
    realizedPnl,
    totalPnl,
    totalFees,
    returnPct,
    tIncomeToday,
    tIncome7d,
    tIncomeMonth,
    tIncomeRecentMonth,
    tIncomeTotal,
    incomeToday,
    incomeWeek,
    incomeMonth,
    incomeRecentMonth,
    incomeTotal,
    marketScore,
    signals,
    buy,
    sell,
    restoreFromDatabase,
    loadLiveMarket,
    requestMarketSummary,
    syncToDatabase,
    runAutoTrade,
    selectAsset
  }
})

