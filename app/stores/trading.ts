import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import type { AiAssetAnalysis, AiClosedPositionReview, AiMarketSummary, AiTradeDecision, ClosedPositionSnapshot, MarketAsset, MarketIndex, MarketSnapshotDiagnostic, NewsItem, Order, OrderSide, Position, RuleAssetAnalysis, StrategyHorizon, StrategyLog, StrategySignal, Trade } from '~/types/trading'

const INITIAL_CASH = 50000
const MIN_BUY_AMOUNT = 4995
const MIN_SELL_AMOUNT = 5000
const SMALL_POSITION_CLEAR_AMOUNT = 5000
const PREFERRED_BUY_AMOUNT = 15000
const T_BUY_AMOUNT = 6000
const AI_SKIP_CASH_FLOOR = 5000
const MAX_BUYS_PER_TICK = 2
const MAX_AI_BUYS_PER_TICK = 2
const AI_MAX_NORMAL_NEW_BUY_CHANGE_PCT = 2.8
const AI_MAX_T_BUY_CHANGE_PCT = 1.8
const AI_MAX_EXCEPTIONAL_MOMENTUM_CHANGE_PCT = 5.2
const MARKET_OPEN_MINUTE = 9 * 60 + 25
const MARKET_MORNING_CLOSE_MINUTE = 11 * 60 + 30
const MARKET_AFTERNOON_OPEN_MINUTE = 13 * 60
const MARKET_CLOSE_MINUTE = 15 * 60
const PORTFOLIO_SLUG = 'default'
const AI_DECISION_COOLDOWN_MS = 10 * 60 * 1000
const MIN_HOLD_DAYS: Record<StrategyHorizon, number> = { long: 1, swing: 1, short: 1 }
const CLOSED_REVIEW_LOG_PREFIX = 'AI_REVIEW_JSON:'
type IncomeRange = 'today' | 'week' | '7d' | 'month' | 'recentMonth' | 'total'
type AutoDecisionNoticeTone = 'idle' | 'info' | 'success' | 'warning' | 'error'
type MarketLoadOptions = {
  summarize?: boolean
  allowOutsideMarketHours?: boolean
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value))
}

function defaultTargetWeight() {
  return 0.45
}

function lowCashAwareBuyCap(cashAmount: number) {
  const spendableCash = Math.max(0, cashAmount - 100)
  if (spendableCash < PREFERRED_BUY_AMOUNT) return spendableCash
  return cashAmount * 0.55
}

function nowTime() {
  return new Intl.DateTimeFormat('zh-CN', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false
  }).format(new Date())
}

function nowDateTime() {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false
  }).formatToParts(new Date())
  const get = (type: string) => parts.find((part) => part.type === type)?.value ?? ''
  return `${get('year')}-${get('month')}-${get('day')} ${get('hour')}:${get('minute')}:${get('second')}`
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

function orderPrice(asset: MarketAsset, side: OrderSide, reason: string) {
  const urgentSell = /hard stop|risk|trend break|outflow|market risk|failed/i.test(reason)
  const improvement = side === 'buy'
    ? /visible momentum|breakout|追高|放量突破|可见行情/i.test(reason)
      ? -0.004
      : /T |pullback|bottom|回落|低吸/i.test(reason) ? 0.006 : 0.003
    : urgentSell ? -0.002 : 0.004
  const rawPrice = asset.price * (1 + (side === 'buy' ? -improvement : improvement))
  const clamped = Math.max(asset.limitDown, Math.min(asset.limitUp, rawPrice))
  return Number(clamped.toFixed(clamped < 10 ? 3 : 2))
}

function isPotentialCompounder(asset: MarketAsset) {
  const technical = asset.technical
  const constructiveTechnical = !technical || (
    !technical.isDeathCross
    && technical.rsi14 < 86
    && technical.closeVsMa60Pct < 35
    && (
      technical.ma20 >= technical.ma60
      || technical.isBreakout60
      || technical.isBreakout250
      || technical.macdHist >= 0
    )
  )
  const leadingContext = (asset.relativeStrengthRank ?? 0) >= 0.72
    && ((asset.sectorRank ?? 0) >= 0.6 || (asset.sectorMomentum ?? 0) >= 4)
  const positiveFlow = (asset.mainNetInflowPct ?? 0) > 0
    || (asset.superOrderNetInflowPct ?? 0) > 0
    || (asset.bigOrderNetInflowPct ?? 0) > 0
  return asset.trendScore >= 62
    && asset.liquidityScore >= 50
    && asset.riskScore <= 78
    && constructiveTechnical
    && leadingContext
    && positiveFlow
}

function hasConfirmedTrendDamage(asset: MarketAsset) {
  const technical = asset.technical
  const technicalDamage = Boolean(technical?.isDeathCross && technical.macdHist < 0 && technical.ma5 < technical.ma20)
  const flowFailure = (asset.mainNetInflowPct ?? 0) < -5 && (asset.bigOrderNetInflowPct ?? 0) < -2
  const sectorRollover = (asset.sectorRank ?? 1) < 0.35 && (asset.sectorMomentum ?? 0) < -2
  return asset.riskScore >= 86
    || asset.trendScore < 44
    || (technicalDamage && (flowFailure || sectorRollover || asset.trendScore < 52))
}

function hasConstructiveMoneyFlow(asset: MarketAsset) {
  return (asset.mainNetInflowPct ?? 0) > 0
    || (asset.superOrderNetInflowPct ?? 0) > 0
    || (asset.bigOrderNetInflowPct ?? 0) > 0
}

function isSupportedBottomAccumulation(asset: MarketAsset) {
  return (asset.bottomScore ?? 0) >= 62
    && hasConstructiveMoneyFlow(asset)
    && (asset.volumeRatio ?? 1) >= 1.05
    && asset.changePct > -3.5
    && asset.changePct <= 2.6
}

function isExceptionalMomentumBuy(asset: MarketAsset, confidence: number) {
  const technical = asset.technical
  const hasBreakout = Boolean(technical?.isBreakout20 || technical?.isBreakout60 || technical?.isBreakout250)
  const hasStrongFlow = (asset.mainNetInflowPct ?? 0) >= 1.2
    || (asset.superOrderNetInflowPct ?? 0) >= 0.8
    || (asset.bigOrderNetInflowPct ?? 0) >= 1
  const hasLeaderContext = (asset.relativeStrengthRank ?? 0) >= 0.78
    && ((asset.sectorRank ?? 0) >= 0.62 || (asset.sectorMomentum ?? 0) >= 4)
  const technicalOk = !technical || (
    !technical.isDeathCross
    && technical.rsi14 < 78
    && technical.closeVsMa20Pct < 14
    && (technical.macdHist >= 0 || hasBreakout)
  )
  return confidence >= 0.78
    && asset.changePct <= AI_MAX_EXCEPTIONAL_MOMENTUM_CHANGE_PCT
    && asset.trendScore >= 72
    && asset.riskScore <= 62
    && (asset.volumeRatio ?? 1) >= 1.45
    && hasStrongFlow
    && hasLeaderContext
    && technicalOk
}

function isAiTBuySetup(asset: MarketAsset, position: Position) {
  return isSupportedBottomAccumulation(asset)
    || (asset.changePct <= 0.8 && hasConstructiveMoneyFlow(asset))
    || (asset.changePct <= AI_MAX_T_BUY_CHANGE_PCT && position.floatingPnlPct <= -1.2 && hasConstructiveMoneyFlow(asset))
}

function aiBuyBlockReason(asset: MarketAsset, position: Position | undefined, decision: AiTradeDecision) {
  if (position) {
    if (asset.changePct > AI_MAX_T_BUY_CHANGE_PCT && !isSupportedBottomAccumulation(asset)) {
      return `AI 买入跳过 ${asset.name}: 当日涨幅 ${asset.changePct.toFixed(2)}% 已超过 T 买低吸阈值，等待回落或改为卖 T。`
    }
    if (!isAiTBuySetup(asset, position)) {
      return `AI 买入跳过 ${asset.name}: 现有持仓没有形成低吸/T 买点，避免把做 T 变成追涨加仓。`
    }
    return ''
  }

  if (asset.changePct > AI_MAX_NORMAL_NEW_BUY_CHANGE_PCT && !isExceptionalMomentumBuy(asset, decision.confidence)) {
    return `AI 买入跳过 ${asset.name}: 当日涨幅 ${asset.changePct.toFixed(2)}% 偏高，除非突破、放量、资金和板块共振足够强，否则不追。`
  }
  return ''
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
  return (currentMinute >= MARKET_OPEN_MINUTE && currentMinute <= MARKET_MORNING_CLOSE_MINUTE)
    || (currentMinute >= MARKET_AFTERNOON_OPEN_MINUTE && currentMinute <= MARKET_CLOSE_MINUTE)
}

function parseClosedReviewLogs(items: StrategyLog[]) {
  return items.reduce<Record<string, AiClosedPositionReview>>((sum, log) => {
    const markerIndex = log.message.indexOf(CLOSED_REVIEW_LOG_PREFIX)
    if (markerIndex < 0) return sum
    try {
      const review = JSON.parse(log.message.slice(markerIndex + CLOSED_REVIEW_LOG_PREFIX.length).trim()) as AiClosedPositionReview
      if (review.code) sum[review.code] = review
    } catch {
      // Ignore malformed historical logs; normal restore should keep going.
    }
    return sum
  }, {})
}

function reviewLogMessage(review: AiClosedPositionReview) {
  return `AI 清仓复盘已保存 ${review.name} ${review.code}: ${review.summary} ${CLOSED_REVIEW_LOG_PREFIX}${JSON.stringify(review)}`
}

function compactReason(value: string, maxLength = 96) {
  const text = value.replace(/\s+/g, ' ').trim()
  return text.length > maxLength ? `${text.slice(0, maxLength - 1)}…` : text
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
  const liveDiagnostics = ref<MarketSnapshotDiagnostic[]>([])
  const dataSource = ref('')
  const updatedAt = ref('')
  const lastAutoSkip = ref('')
  const syncStatus = ref<'idle' | 'syncing' | 'synced' | 'error'>('idle')
  const syncError = ref('')
  const restoreStatus = ref<'idle' | 'loading' | 'restored' | 'empty' | 'error'>('idle')
  const restoreError = ref('')
  const aiStatus = ref<'idle' | 'thinking' | 'used' | 'resting' | 'fallback' | 'disabled' | 'error'>('idle')
  const aiError = ref('')
  const autoDecisionNotice = ref<{ tone: AutoDecisionNoticeTone, message: string }>({
    tone: 'idle',
    message: '等待自动扫描'
  })
  const aiDecisionBrief = ref('AI 暂无本轮结论')
  const lastAiDecisionAt = ref(0)
  const autoTradeRunning = ref(false)
  const marketSummary = ref<AiMarketSummary | null>(null)
  const marketSummaryStatus = ref<'idle' | 'loading' | 'ready' | 'fallback' | 'error'>('idle')
  const marketSummaryError = ref('')
  const assetAnalyses = ref<Record<string, AiAssetAnalysis>>({})
  const assetAnalysisStatus = ref<Record<string, 'idle' | 'loading' | 'ready' | 'fallback' | 'error'>>({})
  const assetAnalysisError = ref<Record<string, string>>({})
  const closedPositionReviews = ref<Record<string, AiClosedPositionReview>>({})
  const closedPositionReviewStatus = ref<Record<string, 'idle' | 'loading' | 'ready' | 'fallback' | 'error'>>({})
  const closedPositionReviewError = ref<Record<string, string>>({})
  let activeSync: Promise<boolean> | null = null
  let syncAgain = false

  function snapshotMarketContext() {
    return {
      dataSource: dataSource.value,
      updatedAt: updatedAt.value,
      indexes: indexes.value,
      news: news.value
    }
  }

  function snapshotAccountContext() {
    return {
      cash: cash.value,
      totalAsset: totalAsset.value,
      marketValue: marketValue.value,
      marketScore: marketScore.value
    }
  }

  function createTradeSnapshot(params: {
    source: 'ai' | 'rule'
    asset: MarketAsset
    decision?: AiTradeDecision
    signal?: StrategySignal
  }) {
    return {
      source: params.source,
      capturedAt: new Date().toISOString(),
      model: params.decision?.model,
      decision: params.decision,
      signal: params.signal,
      account: snapshotAccountContext(),
      market: snapshotMarketContext(),
      asset: {
        code: params.asset.code,
        name: params.asset.name,
        kind: params.asset.kind,
        sector: params.asset.sector,
        industry: params.asset.industry,
        concepts: params.asset.concepts,
        price: params.asset.price,
        previousClose: params.asset.previousClose,
        changePct: params.asset.changePct,
        turnover: params.asset.turnover,
        turnoverRate: params.asset.turnoverRate,
        marketCap: params.asset.marketCap,
        floatMarketCap: params.asset.floatMarketCap,
        peRatio: params.asset.peRatio,
        pbRatio: params.asset.pbRatio,
        volumeRatio: params.asset.volumeRatio,
        amplitude: params.asset.amplitude,
        mainNetInflow: params.asset.mainNetInflow,
        mainNetInflowPct: params.asset.mainNetInflowPct,
        superOrderNetInflow: params.asset.superOrderNetInflow,
        superOrderNetInflowPct: params.asset.superOrderNetInflowPct,
        bigOrderNetInflow: params.asset.bigOrderNetInflow,
        bigOrderNetInflowPct: params.asset.bigOrderNetInflowPct,
        bottomScore: params.asset.bottomScore,
        liquidityScore: params.asset.liquidityScore,
        trendScore: params.asset.trendScore,
        sentimentScore: params.asset.sentimentScore,
        riskScore: params.asset.riskScore,
        limitUp: params.asset.limitUp,
        limitDown: params.asset.limitDown,
        relativeStrengthRank: params.asset.relativeStrengthRank,
        sectorRank: params.asset.sectorRank,
        sectorMomentum: params.asset.sectorMomentum,
        sectorAssetCount: params.asset.sectorAssetCount
      }
    }
  }

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

  function setAutoDecisionNotice(tone: AutoDecisionNoticeTone, message: string) {
    autoDecisionNotice.value = {
      tone,
      message: compactReason(message, 160)
    }
  }

  function setApiNotice(name: string, state: 'loading' | 'done' | 'failed' | 'disabled') {
    const tone: AutoDecisionNoticeTone = state === 'loading'
      ? 'info'
      : state === 'failed'
        ? 'error'
        : state === 'disabled'
          ? 'warning'
          : 'success'
    const suffix = state === 'loading'
      ? '请求中'
      : state === 'failed'
        ? '请求失败'
        : state === 'disabled'
          ? '未启用'
          : '请求完成'
    setAutoDecisionNotice(tone, `${name}${suffix}`)
  }

  function setAiDecisionBrief(message: string) {
    aiDecisionBrief.value = compactReason(message, 96)
  }

  function shouldSkipMarketSnapshot(allowOutsideMarketHours?: boolean) {
    if (allowOutsideMarketHours || isChinaMarketAutoWindow()) return false
    setAutoDecisionNotice('idle', '非交易时间：已暂停自动行情请求，首次启动和手动刷新除外。')
    addLog('Market snapshot skipped outside A-share trading sessions.', 'low')
    return true
  }

  function assetLabel(code: string) {
    const asset = assetMap.value.get(code)
    return asset ? `${asset.name} ${code}` : code
  }

  function updateAiDecisionBrief(model: string | undefined, decisions: AiTradeDecision[]) {
    const modelLabel = model || decisions[0]?.model || 'AI'
    const actionable = decisions.find((decision) => decision.action === 'buy' || decision.action === 'sell')
    if (actionable) {
      const actionText = actionable.action === 'buy' ? '买入' : '卖出'
      const countText = decisions.length > 1 ? `，共 ${decisions.length} 条` : ''
      setAiDecisionBrief(`${modelLabel}：${actionText} ${assetLabel(actionable.code)}${countText}，${actionable.reason}`)
      return
    }

    const hold = decisions.find((decision) => decision.action === 'hold')
    if (hold) {
      setAiDecisionBrief(`${modelLabel}：不买，${hold.reason}`)
      return
    }

    setAiDecisionBrief(`${modelLabel}：不买，未返回可执行机会`)
  }

  function upsertClosedReviewLog(review: AiClosedPositionReview) {
    const message = reviewLogMessage(review)
    const existingIndex = logs.value.findIndex((log) => log.message.includes(CLOSED_REVIEW_LOG_PREFIX) && log.message.includes(`"code":"${review.code}"`))
    const log: StrategyLog = {
      id: existingIndex >= 0 ? logs.value[existingIndex].id : `l-review-${review.code}-${Date.now()}`,
      time: nowTime(),
      level: review.outcome === 'missed_upside' ? 'medium' : 'low',
      message
    }
    if (existingIndex >= 0) {
      logs.value = [
        log,
        ...logs.value.slice(0, existingIndex),
        ...logs.value.slice(existingIndex + 1)
      ].slice(0, 80)
    } else {
      logs.value.unshift(log)
      logs.value = logs.value.slice(0, 80)
    }
  }

  function addOrder(order: Omit<Order, 'id' | 'time'>) {
    orders.value.unshift({
      id: `o${Date.now()}${Math.random().toString(16).slice(2)}`,
      time: nowDateTime(),
      ...order
    })
    orders.value = orders.value.slice(0, 120)
  }

  async function persistSnapshotToDatabase() {
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
          logs: logs.value,
          closedPositionReviews: Object.values(closedPositionReviews.value)
        }
      })
      syncStatus.value = 'synced'
      return true
    } catch (error) {
      syncStatus.value = 'error'
      syncError.value = error instanceof Error ? error.message : 'Supabase sync failed'
      setApiNotice('数据库同步接口', 'failed')
      return false
    }
  }

  async function syncToDatabase() {
    if (activeSync) {
      syncAgain = true
      return activeSync
    }

    activeSync = (async () => {
      let ok = false
      do {
        syncAgain = false
        ok = await persistSnapshotToDatabase()
      } while (syncAgain)
      return ok
    })().finally(() => {
      activeSync = null
    })

    return activeSync
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
        closedPositionReviews?: AiClosedPositionReview[]
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
      closedPositionReviews.value = {
        ...parseClosedReviewLogs(logs.value),
        ...Object.fromEntries((state.closedPositionReviews ?? []).map((review) => [review.code, review]))
      }
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

  async function loadLiveMarket(options: MarketLoadOptions = {}) {
    if (shouldSkipMarketSnapshot(options.allowOutsideMarketHours)) return false
    const shouldSummarize = options.summarize ?? true
    loading.value = true
    liveError.value = ''
    liveDiagnostics.value = []
    setApiNotice('行情接口', 'loading')
    try {
      const today = chinaTradeDate()
      const quoteCodes = new Set([
        ...positions.value.map((position) => position.code),
        ...trades.value.filter((trade) => trade.tradeDate === today).map((trade) => trade.code)
      ])
      const snapshot = await $fetch<{
        source: string
        updatedAt: string
        indexes: MarketIndex[]
        assets: MarketAsset[]
        news: NewsItem[]
        error?: string
        diagnostics?: MarketSnapshotDiagnostic[]
      }>('/api/market/snapshot', {
        query: {
          codes: [...quoteCodes].join(','),
          force: options.allowOutsideMarketHours ? '1' : undefined
        }
      })

      liveDiagnostics.value = snapshot.diagnostics ?? []
      if (snapshot.error) {
        throw new Error(snapshot.error)
      }

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
      setApiNotice('行情接口', 'done')
      if (shouldSummarize) await requestMarketSummary()
      await syncToDatabase()
      return true
    } catch (error) {
      const diagnosticText = liveDiagnostics.value.length
        ? ` | ${liveDiagnostics.value.map((item) => `${item.stage}: ${item.message}`).join(' ; ')}`
        : ''
      liveError.value = error instanceof Error ? `${error.message}${diagnosticText}` : `Live market request failed${diagnosticText}`
      setApiNotice('行情接口', 'failed')
      addLog(`Live market refresh failed: ${liveError.value}`, 'high')
      return false
    } finally {
      loading.value = false
    }
  }

  async function loadSingleAsset(code: string, options: { allowOutsideMarketHours?: boolean } = {}) {
    const normalized = normalizeCodeInput(code)
    if (!normalized) return null
    const existing = assetMap.value.get(normalized)
    if (existing) return existing
    if (shouldSkipMarketSnapshot(options.allowOutsideMarketHours)) return null

    try {
      const snapshot = await $fetch<{
        source: string
        updatedAt: string
        indexes: MarketIndex[]
        assets: MarketAsset[]
        news: NewsItem[]
        error?: string
        diagnostics?: MarketSnapshotDiagnostic[]
      }>('/api/market/snapshot', {
        query: {
          codes: normalized,
          force: options.allowOutsideMarketHours ? '1' : undefined
        }
      })

      const asset = snapshot.assets.find((item) => item.code === normalized) ?? snapshot.assets[0] ?? null
      if (!asset) return null

      if (snapshot.indexes.length) indexes.value = snapshot.indexes
      if (snapshot.news.length) news.value = snapshot.news
      dataSource.value = snapshot.source
      updatedAt.value = snapshot.updatedAt
      liveDiagnostics.value = snapshot.diagnostics ?? liveDiagnostics.value
      assets.value = [asset, ...assets.value.filter((item) => item.code !== asset.code)]
      selectedCode.value = asset.code
      refreshMarks()
      return asset
    } catch (error) {
      liveError.value = error instanceof Error ? error.message : 'Single asset load failed'
      return null
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

  function buy(asset: MarketAsset, targetAmount: number, reason: string, horizon: StrategyHorizon = 'swing', snapshot?: Trade['decisionSnapshot']) {
    const existing = positions.value.find((position) => position.code === asset.code)
    const price = orderPrice(asset, 'buy', reason)
    const floorQuantity = floorToLotQuantity(targetAmount / price)
    const ceilQuantity = ceilToLotQuantity(targetAmount / price)
    const floorAmount = floorQuantity * price
    const ceilAmount = ceilQuantity * price
    const canRoundUp = floorAmount < PREFERRED_BUY_AMOUNT
      && ceilQuantity >= 100
      && ceilAmount <= Math.max(targetAmount * 1.25, PREFERRED_BUY_AMOUNT)
      && ceilAmount + calcBuyFee(ceilAmount) <= cash.value
    const lotQuantity = canRoundUp ? ceilQuantity : floorQuantity
    if (lotQuantity < 100) {
      addLog(`Skip buy ${asset.name}: target amount cannot reach one lot.`, 'low')
      return false
    }

    const amount = lotQuantity * price
    if (amount < MIN_BUY_AMOUNT) {
      addLog(`Skip buy ${asset.name}: CNY ${amount.toFixed(0)} is below minimum buy amount ${MIN_BUY_AMOUNT}.`, 'low')
      return false
    }

    const fee = calcBuyFee(amount)
    if (amount + fee > cash.value || asset.price >= asset.limitUp) {
      addOrder({ side: 'buy', code: asset.code, name: asset.name, price, quantity: lotQuantity, amount, status: 'rejected', horizon, reason: amount + fee > cash.value ? '可用现金不足' : '接近或达到涨停，放弃追高' })
      return false
    }

    cash.value -= amount + fee
    if (existing) {
      const nextQuantity = existing.quantity + lotQuantity
      existing.horizon = horizon
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
      const marketValue = lotQuantity * asset.price
      const cost = amount + fee
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
        marketValue,
        floatingPnl: marketValue - cost,
        floatingPnlPct: (marketValue - cost) / Math.max(cost, 1) * 100,
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
      price,
      quantity: lotQuantity,
      amount,
      fee,
      pnl: 0,
      tradeDate: chinaTradeDate(),
      horizon,
      reason,
      decisionSnapshot: snapshot
    })
    addOrder({ side: 'buy', code: asset.code, name: asset.name, price, quantity: lotQuantity, amount, status: 'filled', horizon, reason })
    refreshMarks()
    addLog(`BUY ${asset.name} ${lotQuantity} @ ${price.toFixed(3)} limit, quote ${asset.price.toFixed(3)}. ${reason}`, asset.riskScore > 55 ? 'medium' : 'low')
    syncToDatabase()
    return true
  }

  function sell(asset: MarketAsset, ratio: number, reason: string, snapshot?: Trade['decisionSnapshot']) {
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
    const tacticalExit = /T trim|trailing|hard stop|risk|trend break|outflow|market risk|short momentum/i.test(reason)
    const emergencyExit = asset.riskScore >= 86
      || existing.floatingPnlPct <= (existing.horizon === 'long' ? -13 : existing.horizon === 'swing' ? -8 : -4.5)

    if (!mustClearSmallPosition && heldDays < minHoldDays && !emergencyExit && !tacticalExit) {
      addLog(`Skip sell ${asset.name} @ ${asset.price.toFixed(3)}: ${existing.horizon} 持仓仅 ${heldDays} 天，未到 ${minHoldDays} 天最短观察期.`, 'low')
      return false
    }

    const price = orderPrice(asset, 'sell', reason)
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

    const amount = quantity * price
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
      price,
      quantity,
      amount,
      fee,
      pnl,
      tradeDate: chinaTradeDate(),
      horizon: existing.horizon,
      reason: `${reason} | ${sellOutcome}`,
      decisionSnapshot: snapshot
    })
    addOrder({ side: 'sell', code: asset.code, name: asset.name, price, quantity, amount, status: 'filled', horizon: existing.horizon, reason: `${reason} | ${sellOutcome}` })

    positions.value = positions.value.filter((position) => position.quantity > 0)
    refreshMarks()
    addLog(`SELL ${asset.name} ${quantity} @ ${price.toFixed(3)} limit, quote ${asset.price.toFixed(3)}. ${pnl >= 0 ? 'Profit' : 'Loss'} ${pnl.toFixed(2)} (${pnlPct >= 0 ? '+' : ''}${pnlPct.toFixed(2)}%). ${reason}`, asset.riskScore > 55 ? 'high' : 'medium')
    syncToDatabase()
    return true
  }

  function candidateSignals() {
    const priority = { sell: 0, buy: 1, hold: 2 }
    return [...signals.value]
      .sort((a, b) => priority[a.action] - priority[b.action] || b.score - a.score)
      .slice(0, 80)
  }

  function normalizeCodeInput(rawCode: string) {
    return rawCode.trim().toUpperCase().replace(/^(SZ|SH|BJ)\.?/, '').replace(/\D/g, '')
  }

  function assetSearchResults(rawCode: string) {
    const code = normalizeCodeInput(rawCode)
    const name = rawCode.trim()
    if (!code && !name) return []
    return assets.value
      .filter((asset) => (code && asset.code.includes(code)) || (name && asset.name.includes(name)))
      .slice(0, 8)
  }

  function resolveAssetQuery(rawCode: string) {
    const code = normalizeCodeInput(rawCode)
    if (code) return code
    return assetSearchResults(rawCode)[0]?.code ?? ''
  }

  function analyzeAssetByCode(rawCode: string): RuleAssetAnalysis[] {
    const matchedAssets = assetSearchResults(rawCode)
    if (!matchedAssets.length) return []
    return matchedAssets.map((asset) => {
      const signal = signals.value.find((item) => item.code === asset.code)
      const position = positions.value.find((item) => item.code === asset.code)
      const hasPosition = Boolean(position)
      const action = position
        ? signal?.action === 'sell'
          ? 'sell'
          : 'hold'
        : signal?.action ?? 'hold'
      const label: RuleAssetAnalysis['label'] = action === 'buy'
        ? '买入'
        : action === 'sell'
          ? '卖出'
          : hasPosition
            ? '继续持有'
            : '观望'
      const targetAmount = signal?.suggestedWeight
        ? Math.max(signal.reason.includes('visible momentum') ? MIN_BUY_AMOUNT : PREFERRED_BUY_AMOUNT, totalAsset.value * signal.suggestedWeight)
        : PREFERRED_BUY_AMOUNT

      return {
        code: asset.code,
        name: asset.name,
        action,
        label,
        horizon: signal?.horizon ?? position?.horizon ?? 'swing',
        score: signal?.score ?? 0,
        risk: signal?.risk ?? 'medium',
        suggestedWeight: signal?.suggestedWeight ?? 0,
        sellRatio: signal?.sellRatio ?? 0,
        reason: signal?.reason ?? (hasPosition ? '当前持仓暂未出现明确卖出信号，先继续持有观察。' : '当前未出现明确买点，先观察。'),
        currentPrice: asset.price,
        changePct: asset.changePct,
        hasPosition,
        targetAmount
      }
    })
  }

  function canBuySignal(signal: StrategySignal) {
    const asset = assetMap.value.get(signal.code)
    if (!asset || signal.action !== 'buy') return false
    if (asset.price >= asset.limitUp) return false
    const existing = positions.value.find((position) => position.code === signal.code)
    if (existing) {
      const targetAmount = Math.min(T_BUY_AMOUNT, Math.max(0, cash.value - 100))
      const lotQuantity = floorToLotQuantity(targetAmount / asset.price)
      const amount = lotQuantity * asset.price
      return lotQuantity >= 100 && amount >= MIN_BUY_AMOUNT && amount + calcBuyFee(amount) <= cash.value
    }
    const cashCap = lowCashAwareBuyCap(cash.value)
    const preferredAmount = signal.reason.includes('visible momentum') ? MIN_BUY_AMOUNT : PREFERRED_BUY_AMOUNT
    const targetAmount = Math.min(Math.max(totalAsset.value * signal.suggestedWeight, preferredAmount), cashCap)
    const lotQuantity = floorToLotQuantity(targetAmount / asset.price)
    const amount = lotQuantity * asset.price
    return lotQuantity >= 100 && amount >= MIN_BUY_AMOUNT && amount + calcBuyFee(amount) <= cash.value
  }

  function hasSellablePosition() {
    return positions.value.some((position) => {
      const asset = assetMap.value.get(position.code)
      return asset && position.availableQuantity >= 100 && asset.price > asset.limitDown
    })
  }

  function canRotateIntoSignal(signal: StrategySignal) {
    const asset = assetMap.value.get(signal.code)
    if (!asset || signal.action !== 'buy') return false
    if (asset.price >= asset.limitUp || !hasSellablePosition()) return false
    const existing = positions.value.find((position) => position.code === signal.code)
    const projectedCash = cash.value + positions.value
      .filter((position) => {
        const heldAsset = assetMap.value.get(position.code)
        return heldAsset && position.availableQuantity >= 100 && heldAsset.price > heldAsset.limitDown
      })
      .reduce((sum, position) => {
        const heldAsset = assetMap.value.get(position.code)
        return sum + (heldAsset ? position.availableQuantity * heldAsset.price : 0)
      }, 0)
    const preferredAmount = signal.reason.includes('visible momentum') ? MIN_BUY_AMOUNT : PREFERRED_BUY_AMOUNT
    const lotQuantity = floorToLotQuantity(Math.min(existing ? T_BUY_AMOUNT : preferredAmount, projectedCash * 0.55) / asset.price)
    const amount = lotQuantity * asset.price
    return lotQuantity >= 100 && amount >= MIN_BUY_AMOUNT && signal.score >= 64
  }

  function canSellSignal(signal: StrategySignal) {
    const asset = assetMap.value.get(signal.code)
    const position = positions.value.find((item) => item.code === signal.code)
    if (!asset || !position || signal.action !== 'sell') return false
    if (position.availableQuantity < 100 || asset.price <= asset.limitDown) return false
    const ratio = signal.sellRatio || 0.5
    const quantity = floorToLotQuantity(position.availableQuantity * ratio)
    const amount = quantity * asset.price
    return quantity >= 100 && (position.quantity * asset.price < SMALL_POSITION_CLEAR_AMOUNT || amount >= MIN_SELL_AMOUNT)
  }

  function actionableSignals() {
    return signals.value.filter((signal) => canBuySignal(signal) || canSellSignal(signal) || canRotateIntoSignal(signal))
  }

  function aiCandidateSignals() {
    const actionable = actionableSignals()
    const codes = new Set(actionable.map((signal) => signal.code))
    const heldSignals = positions.value
      .map((position) => signals.value.find((signal) => signal.code === position.code))
      .filter((signal): signal is StrategySignal => Boolean(signal))
      .filter((signal) => {
        if (codes.has(signal.code)) return false
        codes.add(signal.code)
        return true
      })
    const topScoredSignals = signals.value
      .filter((signal) => !codes.has(signal.code))
      .slice(0, 30)
    return [...actionable, ...heldSignals, ...topScoredSignals].slice(0, 80)
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
    const now = new Date()
    const today = chinaTradeDate(now)
    const monthPrefix = today.slice(0, 7)
    const start = new Date(now)
    if (range === '7d') start.setDate(start.getDate() - 6)
    if (range === 'recentMonth') start.setMonth(start.getMonth() - 1)
    const startDate = chinaTradeDate(start)
    const tradesByDateAndCode = new Map<string, Trade[]>()

    for (const trade of trades.value) {
      if (!trade.tradeDate) continue
      if (range !== 'total') {
        if (range === 'today' && trade.tradeDate !== today) continue
        if (range === 'month' && !trade.tradeDate.startsWith(monthPrefix)) continue
        if ((range === '7d' || range === 'recentMonth') && (trade.tradeDate < startDate || trade.tradeDate > today)) continue
      }
      const key = `${trade.tradeDate}:${trade.code}`
      tradesByDateAndCode.set(key, [...(tradesByDateAndCode.get(key) ?? []), trade])
    }

    return [...tradesByDateAndCode.values()]
      .filter((items) => items.some((trade) => trade.side === 'buy') && items.some((trade) => trade.side === 'sell'))
      .reduce((sum, items) => sum + items
        .filter((trade) => trade.side === 'sell')
        .reduce((tradeSum, trade) => tradeSum + trade.pnl, 0), 0)
  }

  async function requestAiDecisions(force = false) {
    if (!force && Date.now() - lastAiDecisionAt.value < AI_DECISION_COOLDOWN_MS) {
      aiStatus.value = 'resting'
      aiError.value = ''
      setAutoDecisionNotice('info', 'AI 决策接口冷却中')
      addLog('AI decision resting: cooldown is active.', 'low')
      return []
    }
    positions.value = normalizeT1Locks(positions.value)
    refreshMarks()
    const candidates = force ? candidateSignals() : aiCandidateSignals()
    if (!force && !candidates.length) {
      aiStatus.value = 'resting'
      aiError.value = ''
      setAutoDecisionNotice('info', 'AI 决策接口未请求')
      addLog('AI decision resting: no candidates available for this tick.', 'low')
      return []
    }
    if (!force && shouldSkipAiDecision()) {
      aiStatus.value = 'resting'
      aiError.value = ''
      setAutoDecisionNotice('info', 'AI 决策接口未请求')
      addLog(`AI decision resting: all positions are T+1 locked and cash ${cash.value.toFixed(0)} is below ${AI_SKIP_CASH_FLOOR}.`, 'low')
      return []
    }
    aiStatus.value = 'thinking'
    aiError.value = ''
    setApiNotice('AI 决策接口', 'loading')
    setAiDecisionBrief('AI 决策请求中')
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
          candidates,
          assets: assets.value
        }
      })

      lastAiDecisionAt.value = Date.now()
      if (!response.enabled) {
        aiStatus.value = 'disabled'
        aiError.value = response.reason ?? ''
        setApiNotice('AI 决策接口', 'disabled')
        setAiDecisionBrief(`AI 未启用，${aiError.value || '接口返回 disabled'}`)
        addLog(`AI decision disabled${aiError.value ? `: ${aiError.value}` : ''}. Running rule fallback.`, 'low')
        return []
      }
      const decisions = response.decisions.map((decision) => ({
        ...decision,
        model: response.model
      }))
      aiStatus.value = decisions.length ? 'used' : 'resting'
      setApiNotice('AI 决策接口', 'done')
      updateAiDecisionBrief(response.model, decisions)
      addLog(`AI decision layer ${response.model ?? ''}: ${decisions.length} actionable decisions.`, 'low')
      return decisions
    } catch (error) {
      lastAiDecisionAt.value = Date.now()
      aiStatus.value = 'error'
      aiError.value = error instanceof Error ? error.message : 'AI decision failed'
      setApiNotice('AI 决策接口', 'failed')
      setAiDecisionBrief(`AI 决策失败，${aiError.value}`)
      addLog(`AI decision failed, running rule fallback: ${aiError.value}`, 'medium')
      return []
    }
  }

  async function requestMarketSummary() {
    if (!assets.value.length) return null
    marketSummaryStatus.value = 'loading'
    marketSummaryError.value = ''
    setApiNotice('AI 行情总结接口', 'loading')
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
      setApiNotice('AI 行情总结接口', response.enabled ? 'done' : 'disabled')
      return response.summary
    } catch (error) {
      marketSummaryStatus.value = 'error'
      marketSummaryError.value = error instanceof Error ? error.message : 'AI market summary failed'
      setApiNotice('AI 行情总结接口', 'failed')
      return null
    }
  }

  async function requestAssetAnalysis(code: string) {
    let asset = assetMap.value.get(code)
    if (!asset) {
      asset = await loadSingleAsset(code) ?? undefined
    }
    if (!asset) return null
    const ruleAnalysis = analyzeAssetByCode(code)[0]
    if (!ruleAnalysis) return null
    const position = positions.value.find((item) => item.code === code)
    assetAnalysisStatus.value = { ...assetAnalysisStatus.value, [code]: 'loading' }
    assetAnalysisError.value = { ...assetAnalysisError.value, [code]: '' }
    setApiNotice('AI 单票分析接口', 'loading')
    try {
      const response = await $fetch<{
        enabled: boolean
        analysis: AiAssetAnalysis
        reason?: string
      }>('/api/ai/asset-analysis', {
        method: 'POST',
        body: {
          asset,
          ruleAnalysis,
          position,
          account: {
            cash: cash.value,
            totalAsset: totalAsset.value,
            marketValue: marketValue.value,
            marketScore: marketScore.value
          },
          indexes: indexes.value,
          news: news.value
        }
      })

      assetAnalyses.value = {
        ...assetAnalyses.value,
        [code]: response.analysis
      }
      assetAnalysisStatus.value = {
        ...assetAnalysisStatus.value,
        [code]: response.enabled ? 'ready' : 'fallback'
      }
      assetAnalysisError.value = {
        ...assetAnalysisError.value,
        [code]: response.reason ?? ''
      }
      setApiNotice('AI 单票分析接口', response.enabled ? 'done' : 'disabled')
      return response.analysis
    } catch (error) {
      assetAnalysisStatus.value = { ...assetAnalysisStatus.value, [code]: 'error' }
      assetAnalysisError.value = {
        ...assetAnalysisError.value,
        [code]: error instanceof Error ? error.message : 'AI asset analysis failed'
      }
      setApiNotice('AI 单票分析接口', 'failed')
      return null
    }
  }

  async function reviewClosedPosition(item: ClosedPositionSnapshot) {
    if (!assets.value.length) await loadLiveMarket({ summarize: false })
    closedPositionReviewStatus.value = { ...closedPositionReviewStatus.value, [item.code]: 'loading' }
    closedPositionReviewError.value = { ...closedPositionReviewError.value, [item.code]: '' }
    setApiNotice('AI 清仓复盘接口', 'loading')
    try {
      const response = await $fetch<{
        enabled: boolean
        review: AiClosedPositionReview
        reason?: string
      }>('/api/ai/closed-position-review', {
        method: 'POST',
        body: { item }
      })

      closedPositionReviews.value = {
        ...closedPositionReviews.value,
        [item.code]: response.review
      }
      closedPositionReviewStatus.value = {
        ...closedPositionReviewStatus.value,
        [item.code]: response.enabled ? 'ready' : 'fallback'
      }
      closedPositionReviewError.value = {
        ...closedPositionReviewError.value,
        [item.code]: response.reason ?? ''
      }
      upsertClosedReviewLog(response.review)
      setApiNotice('AI 清仓复盘接口', response.enabled ? 'done' : 'disabled')
      await syncToDatabase()
      return response.review
    } catch (error) {
      closedPositionReviewStatus.value = { ...closedPositionReviewStatus.value, [item.code]: 'error' }
      closedPositionReviewError.value = {
        ...closedPositionReviewError.value,
        [item.code]: error instanceof Error ? error.message : 'AI closed position review failed'
      }
      setApiNotice('AI 清仓复盘接口', 'failed')
      return null
    }
  }

  function notifyAiTrade(decision: AiTradeDecision, asset: MarketAsset) {
    const trade = trades.value[0]
    if (!trade || trade.code !== asset.code) return
    $fetch('/api/notify/trade', {
      method: 'POST',
      body: {
        side: trade.side,
        name: asset.name,
        code: asset.code,
        price: trade.price,
        quantity: trade.quantity,
        amount: trade.amount,
        horizon: decision.horizon,
        confidence: decision.confidence,
        reason: decision.reason,
        cash: cash.value,
        totalAsset: totalAsset.value
      }
    }).catch(() => {})
  }

  function executeAiDecision(decision: AiTradeDecision) {
    const asset = assetMap.value.get(decision.code)
    if (!asset || decision.confidence < 0.55) return false
    let executed = false
    const snapshot = createTradeSnapshot({
      source: 'ai',
      asset,
      decision
    })
    if (decision.action === 'sell') {
      const position = positions.value.find((item) => item.code === asset.code)
      const protectsCompoundingCore = position
        && isPotentialCompounder(asset)
        && !hasConfirmedTrendDamage(asset)
        && !/hard stop|risk|trend break|outflow|market risk|资金流失效|趋势破坏/i.test(decision.reason)
      const requestedRatio = Math.max(0.2, Math.min(1, decision.sellRatio ?? 0.5))
      const ratio = protectsCompoundingCore ? Math.min(requestedRatio, 0.35) : requestedRatio
      executed = sell(asset, ratio, `AI ${decision.horizon}: ${decision.reason}`, snapshot)
    } else if (decision.action === 'buy') {
      const existing = positions.value.find((position) => position.code === asset.code)
      const blockReason = aiBuyBlockReason(asset, existing, decision)
      if (blockReason) {
        addLog(`${blockReason} AI reason: ${decision.reason}`, 'medium')
        return false
      }
      const cashCap = Math.max(0, cash.value - 100)
      const currentWeight = existing ? existing.marketValue / Math.max(totalAsset.value, 1) : 0
      const targetWeight = typeof decision.weight === 'number'
        ? clamp(decision.weight, currentWeight, 0.95)
        : existing
          ? clamp(currentWeight + T_BUY_AMOUNT / Math.max(totalAsset.value, 1), 0, 0.95)
          : Math.min(Math.max(defaultTargetWeight(), PREFERRED_BUY_AMOUNT / Math.max(totalAsset.value, 1)), 0.95)
      const targetAmount = existing
        ? Math.min(Math.max(0, totalAsset.value * targetWeight - existing.marketValue), cashCap)
        : Math.min(totalAsset.value * targetWeight, cashCap)
      const guardedTargetAmount = !existing && asset.changePct > AI_MAX_NORMAL_NEW_BUY_CHANGE_PCT
        ? Math.min(targetAmount, MIN_BUY_AMOUNT)
        : targetAmount
      executed = buy(asset, guardedTargetAmount, `AI ${decision.horizon}: ${decision.reason}`, decision.horizon, snapshot)
    }
    if (executed) notifyAiTrade(decision, asset)
    return executed
  }

  async function runRuleTrade() {
    let executedRuleTrades = 0
    const sellSignals = signals.value.filter((signal) => signal.action === 'sell').slice(0, 3)
    for (const signal of sellSignals) {
      const asset = assetMap.value.get(signal.code)
      if (asset && sell(asset, signal.sellRatio || 0.5, signal.reason, createTradeSnapshot({
        source: 'rule',
        asset,
        signal
      }))) executedRuleTrades += 1
    }

    const buySignals = signals.value
      .filter((signal) => signal.action === 'buy')
      .slice(0, MAX_BUYS_PER_TICK)
    for (const signal of buySignals) {
      const asset = assetMap.value.get(signal.code)
      if (!asset) continue
      const existing = positions.value.find((position) => position.code === signal.code)
      const cashCap = lowCashAwareBuyCap(cash.value)
      const preferredAmount = signal.reason.includes('visible momentum') ? MIN_BUY_AMOUNT : PREFERRED_BUY_AMOUNT
      const targetAmount = existing
        ? Math.min(T_BUY_AMOUNT, Math.max(0, cash.value - 100))
        : Math.min(Math.max(totalAsset.value * signal.suggestedWeight, preferredAmount), cashCap)
      if (buy(asset, targetAmount, signal.reason, signal.horizon, createTradeSnapshot({
        source: 'rule',
        asset,
        signal
      }))) executedRuleTrades += 1
    }

    if (!buySignals.length && !sellSignals.length) {
      addLog(`No trade. Market score ${marketScore.value}; keeping cash reserve ${cash.value.toFixed(0)}.`, 'low')
    }
    return executedRuleTrades
  }

  async function probeAiDecision() {
    if (aiStatus.value === 'thinking') return
    const hadMarket = assets.value.length > 0
    const loaded = await loadLiveMarket({ summarize: false })
    if (!loaded && !hadMarket) {
      aiStatus.value = 'error'
      aiError.value = liveError.value || 'No market data available for AI probe.'
      setApiNotice('行情接口', 'failed')
      addLog(`AI probe aborted: no market data. ${aiError.value}`, 'medium')
      return
    }
    const decisions = await requestAiDecisions(true)
    await requestMarketSummary()
    addLog(`AI probe: ${decisions.length} decisions returned, status=${aiStatus.value}.`, 'low')
  }

  async function runAutoTrade() {
    if (autoTradeRunning.value) {
      setAutoDecisionNotice('info', '自动扫描暂未开始：上一轮行情/AI 分析仍在运行。')
      addLog('Auto scan skipped because the previous scan is still running.', 'low')
      return
    }
    autoTradeRunning.value = true
    strategyTick.value += 1
    try {
      if (!autoExecute.value) {
        setAutoDecisionNotice('idle', '自动买卖已暂停：不会加载行情或请求 AI。')
        addLog('Auto execution is off. Market scan and trade decisions are paused.', 'low')
        return
      }
      if (!isChinaMarketAutoWindow()) {
        const todaySkip = new Date().toDateString()
        if (lastAutoSkip.value !== todaySkip) {
          lastAutoSkip.value = todaySkip
          addLog('Auto scan skipped outside A-share trading sessions 09:25-11:30 and 13:00-15:00 Asia/Shanghai.', 'low')
        }
        setAutoDecisionNotice('idle', '非自动交易时段：09:25-11:30、13:00-15:00 才会自动分析。')
        return
      }
      const loaded = await loadLiveMarket({ summarize: !marketSummary.value })
      if (!loaded) {
        setApiNotice('行情接口', 'failed')
        return
      }
      refreshMarks()

      const aiCandidates = aiCandidateSignals()
      if (!aiCandidates.length) {
        aiStatus.value = 'resting'
        aiError.value = ''
        setAutoDecisionNotice('info', 'AI 决策接口未请求')
        return
      }

      const aiDecisions = await requestAiDecisions()
      let executedAiTrades = 0
      let executedAiBuys = 0
      const executableAiDecisions = aiDecisions.filter((decision) => decision.action !== 'hold')
      const orderedDecisions = [...executableAiDecisions].sort((a, b) => {
        const priority = { sell: 0, buy: 1, hold: 2 }
        return priority[a.action] - priority[b.action]
      })
      for (const decision of orderedDecisions) {
        if (decision.action === 'buy' && executedAiBuys >= MAX_AI_BUYS_PER_TICK) continue
        if (executeAiDecision(decision)) {
          executedAiTrades += 1
          if (decision.action === 'buy') executedAiBuys += 1
        }
      }
      if (executedAiTrades) {
        setApiNotice('AI 决策接口', 'done')
      }
      if (!executedAiTrades && aiStatus.value !== 'thinking') {
        const shouldFallbackToRules = aiStatus.value === 'disabled'
          || aiStatus.value === 'error'
        if (shouldFallbackToRules) {
          const previousNotice = autoDecisionNotice.value
          aiStatus.value = 'fallback'
          addLog('AI did not execute a trade this tick; running rule fallback.', 'low')
          const executedRuleTrades = await runRuleTrade()
          if (previousNotice.tone !== 'error') {
            setAutoDecisionNotice(executedRuleTrades ? 'success' : 'warning', executedRuleTrades ? '规则兜底已成交' : '规则兜底未成交')
          }
        } else if (aiStatus.value === 'used') {
          aiStatus.value = 'resting'
          setApiNotice('AI 决策接口', 'done')
          if (!executableAiDecisions.length) {
            setAutoDecisionNotice('info', 'AI 已分析：本轮建议观望，未触发交易。')
          } else {
            setAutoDecisionNotice('info', 'AI 已分析：受仓位、价格或风控约束，本轮未成交。')
          }
        } else if (aiStatus.value === 'resting') {
          setAutoDecisionNotice('info', 'AI 等待机会：本轮未触发交易。')
        }
      }
      await syncToDatabase()
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
    liveDiagnostics,
    dataSource,
    updatedAt,
    lastAutoSkip,
    syncStatus,
    syncError,
    restoreStatus,
    restoreError,
    aiStatus,
    aiError,
    autoDecisionNotice,
    aiDecisionBrief,
    marketSummary,
    marketSummaryStatus,
    marketSummaryError,
    assetAnalyses,
    assetAnalysisStatus,
    assetAnalysisError,
    closedPositionReviews,
    closedPositionReviewStatus,
    closedPositionReviewError,
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
    assetSearchResults,
    resolveAssetQuery,
    analyzeAssetByCode,
    buy,
    sell,
    restoreFromDatabase,
    loadLiveMarket,
    loadSingleAsset,
    requestMarketSummary,
    requestAssetAnalysis,
    reviewClosedPosition,
    probeAiDecision,
    syncToDatabase,
    runAutoTrade,
    selectAsset
  }
})
