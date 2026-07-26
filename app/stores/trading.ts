import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import type { AiAssetAnalysis, AiClosedPositionReview, AiDecisionMemory, AiLearningPatternStats, AiLearningSummary, AiMarketSummary, AiRequestDebug, AiTradeDecision, ClosedPositionSnapshot, MarketAsset, MarketIndex, MarketSnapshotDiagnostic, NewsItem, Order, OrderSide, Position, RuleAssetAnalysis, StrategyHorizon, StrategyLog, StrategyPerformance, StrategySignal, Trade } from '~/types/trading'

const INITIAL_CASH = 50000
const MIN_BUY_AMOUNT = 4995
const MIN_SELL_AMOUNT = 5000
const MIN_REMAINING_POSITION_AMOUNT = 5000
const SMALL_POSITION_CLEAR_AMOUNT = 5000
const PREFERRED_BUY_AMOUNT = 12000
const T_BUY_AMOUNT = 5000
const T_SUPPORT_BUY_AMOUNT = 8000
const AI_SKIP_CASH_FLOOR = 5000
const MAX_BUYS_PER_TICK = 2
const MAX_AI_BUYS_PER_TICK = 2
const SOFT_MAX_POSITION_COUNT = 5
const AI_MIN_CONFIDENCE = 0.55
const AI_MIN_BUY_CONFIDENCE = 0.62
const AI_MAX_NORMAL_NEW_BUY_CHANGE_PCT = 3.5
const AI_MAX_T_BUY_CHANGE_PCT = 1.8
const AI_MAX_EXCEPTIONAL_MOMENTUM_CHANGE_PCT = 14.8
const BASE_STOCK_WEIGHT_CAP = 0.34
const BASE_ETF_WEIGHT_CAP = 0.45
const CONVICTION_STOCK_WEIGHT_CAP = 0.52
const CONVICTION_ETF_WEIGHT_CAP = 0.68
const BASE_SECTOR_WEIGHT_CAP = 0.56
const CONVICTION_SECTOR_WEIGHT_CAP = 0.72
const MOMENTUM_PROBE_WEIGHT = 0.12
const MARKET_OPEN_MINUTE = 9 * 60 + 25
const MARKET_MORNING_CLOSE_MINUTE = 11 * 60 + 30
const MARKET_AFTERNOON_OPEN_MINUTE = 13 * 60
const MARKET_CLOSE_MINUTE = 15 * 60
const SWING_SHAKEOUT_CONFIRM_MINUTE = 10 * 60 + 30
const PORTFOLIO_SLUG = 'default'
const AI_DECISION_COOLDOWN_MS = 10 * 60 * 1000
const AI_SAME_SYMBOL_SELL_COOLDOWN_MS = 30 * 60 * 1000
const MIN_HOLD_DAYS: Record<StrategyHorizon, number> = { long: 1, swing: 1, short: 1 }
const CLOSED_REVIEW_LOG_PREFIX = 'AI_REVIEW_JSON:'
type IncomeRange = 'today' | 'week' | '7d' | 'month' | 'recentMonth' | 'total'
type AutoDecisionNoticeTone = 'idle' | 'info' | 'success' | 'warning' | 'error'
type AiExecutionResult = {
  action: AiTradeDecision['action']
  label: string
  executed: boolean
  reason: string
}
type AiCandidateSignal = StrategySignal & {
  candidateSources?: string[]
}
type MarketLoadOptions = {
  summarize?: boolean
  allowOutsideMarketHours?: boolean
}
type RotationOpportunityContext = {
  active: boolean
  bestName: string
  bestScore: number
  bestChangePct: number
  hotCount: number
}

const AI_TRADE_PATTERN_TAXONOMY = [
  'entry_trend_strong_up_large_flow',
  'entry_trend_strong_up_weak_flow',
  'entry_trend_up_pullback_large_flow',
  'entry_trend_up_pullback_weak_flow',
  'entry_trend_continuation_sector_leader',
  'entry_trend_continuation_isolated',
  'entry_core_leader_compounder_clean',
  'entry_core_leader_compounder_extended',
  'entry_ma_reclaim_with_flow',
  'entry_ma_reclaim_without_flow',
  'entry_breakout_20d_volume_flow',
  'entry_breakout_20d_no_flow',
  'entry_breakout_60d_volume_flow',
  'entry_breakout_60d_no_flow',
  'entry_breakout_250d_volume_flow',
  'entry_breakout_250d_no_flow',
  'entry_new_high_low_risk',
  'entry_new_high_high_risk',
  'entry_limit_up_breakout_clean',
  'entry_limit_up_breakout_blowoff_risk',
  'entry_bottom_large_order_accumulation',
  'entry_bottom_mainflow_only',
  'entry_bottom_no_flow',
  'entry_bottom_high_volume_reversal',
  'entry_bottom_low_volume_reversal',
  'entry_bottom_sector_support',
  'entry_bottom_isolated',
  'entry_value_reversion_with_flow',
  'entry_value_reversion_without_flow',
  'entry_falling_knife_avoid',
  'entry_pullback_ma5_support_flow',
  'entry_pullback_ma10_support_flow',
  'entry_pullback_ma20_support_flow',
  'entry_pullback_ma60_support_flow',
  'entry_vwap_reclaim',
  'entry_intraday_recovering',
  'entry_constructive_pullback_large_order',
  'entry_constructive_pullback_no_flow',
  'entry_gap_down_repair',
  'entry_support_break_failed',
  'entry_moneyflow_broad_inflow',
  'entry_main_in_super_big_out',
  'entry_main_out_super_big_in',
  'entry_super_big_inflow_divergence',
  'entry_large_order_outflow_avoid',
  'entry_flow_fading_after_spike',
  'entry_flow_turnaround_repair',
  'entry_volume_spike_accumulation',
  'entry_low_volume_drift',
  'entry_liquidity_high_turnover_speculation',
  'entry_relative_sector_leader',
  'entry_relative_leader_weak_sector',
  'entry_sector_leader_relative_lag',
  'entry_sector_momentum_rotation',
  'entry_sector_breadth_confirmation',
  'entry_isolated_theme_move',
  'entry_news_theme_with_sector',
  'entry_news_theme_isolated',
  'entry_policy_theme_with_flow',
  'entry_weak_relative_strength',
  'entry_overextended_chase',
  'entry_overextended_with_exceptional_flow',
  'entry_failed_intraday_spike',
  'entry_post_limit_up_blowoff',
  'entry_high_risk_speculation',
  'entry_high_rsi_extension',
  'entry_death_cross_avoid',
  'entry_distribution_phase_avoid',
  'entry_downtrend_countertrend',
  'entry_poor_liquidity_avoid',
  'entry_t0_global_etf_tactical',
  'entry_sector_etf_rotation',
  'entry_broad_etf_defensive',
  'entry_bond_gold_cash_etf_safety',
  'entry_overseas_etf_momentum',
  'entry_overseas_etf_overextended',
  'entry_etf_premium_discount_opportunity',
  'entry_etf_low_vol_hold',
  'entry_etf_risk_off_exit',
  'entry_etf_theme_chase',
  'entry_t_cost_improvement',
  'entry_t_large_order_support',
  'entry_t_bottom_support_add',
  'entry_t_vwap_reclaim_add',
  'entry_t_extended_intraday_avoid',
  'exit_t_exhaustion_trim',
  'exit_t_failed_spike_trim',
  'exit_t_partial_profit_keep_core',
  'entry_t_bad_cost_increase',
  'exit_t_core_leader_no_trim',
  'exit_hard_stop',
  'exit_trend_break',
  'exit_money_flow_failure',
  'exit_market_risk_reduction',
  'exit_profit_or_exhaustion',
  'exit_sector_rollover',
  'exit_failed_spike',
  'exit_small_position_clear',
  'exit_rotation_to_better_setup',
  'general_signal'
] as const

const AI_TRADE_PATTERN_SET = new Set<string>(AI_TRADE_PATTERN_TAXONOMY)

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value))
}

function tradePattern(value: string) {
  return AI_TRADE_PATTERN_SET.has(value) ? value : 'general_signal'
}

function defaultTargetWeight(highConviction = false) {
  return highConviction ? 0.34 : 0.24
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

function formatOrderPrice(value: number) {
  return Number(value.toFixed(value < 10 ? 3 : 2))
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

function isBuyAllowedAsset(asset: Pick<MarketAsset, 'kind' | 'code' | 'sector'>) {
  if (asset.kind !== 'stock') return true
  return !asset.code.startsWith('30')
    && !asset.code.startsWith('688')
    && !asset.sector.includes('创业板')
    && !asset.sector.includes('科创板')
}

function buyBlockedReason(asset: Pick<MarketAsset, 'kind' | 'code' | 'name' | 'sector'>) {
  if (isBuyAllowedAsset(asset)) return ''
  return `${asset.name} ${asset.code} 属于创业板/科创板标的，当前模拟账户买入范围不包含 30 或 688 开头股票；优先用主板股票或普通 ETF 替代。`
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
      : /T |support|pullback|bottom|回落|低吸|支撑/i.test(reason) ? 0.006 : 0.003
    : urgentSell ? -0.002 : 0.004
  const rawPrice = asset.price * (1 + (side === 'buy' ? -improvement : improvement))
  const clamped = Math.max(asset.limitDown, Math.min(asset.limitUp, rawPrice))
  return formatOrderPrice(clamped)
}

function isAtDailyLimitUp(asset: MarketAsset) {
  return asset.kind === 'stock' && asset.price >= asset.limitUp - 0.001
}

function limitUpPartialTrimBlockedReason(asset: MarketAsset, position: Position, ratio: number) {
  let quantity = floorToLotQuantity(position.availableQuantity * ratio)
  if (quantity > 0 && quantity * asset.price < MIN_SELL_AMOUNT) {
    quantity = ceilToLotQuantity(MIN_SELL_AMOUNT / asset.price)
  }
  quantity = floorToLotQuantity(Math.min(quantity, position.availableQuantity))
  if (quantity < 100) return `执行护栏：${asset.name} 当前涨停，可卖数量不足以做有效小幅减仓，保留持仓等待次日延续。`
  const remainingValue = (position.quantity - quantity) * asset.price
  if (quantity >= position.quantity || remainingValue < MIN_REMAINING_POSITION_AMOUNT) {
    return `执行护栏：${asset.name} 当前涨停，本次减仓会触发清仓或留下过小尾仓；涨停情况下不允许被动清仓，先保留持仓。`
  }
  return ''
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

function isResilientLeader(asset: MarketAsset) {
  const technical = asset.technical
  const constructiveTechnical = !technical || (
    !technical.isDeathCross
    && technical.rsi14 < 88
    && technical.closeVsMa20Pct < 26
    && (
      technical.macdHist >= 0
      || technical.isGoldenCross
      || technical.isBreakout20
      || technical.isBreakout60
      || technical.volumeSpike20 >= 1.35
    )
  )
  return asset.trendScore >= 66
    && asset.liquidityScore >= 48
    && asset.riskScore <= 76
    && (
      (asset.relativeStrengthRank ?? 0) >= 0.78
      || (asset.sectorRank ?? 0) >= 0.68
      || (asset.sectorMomentum ?? 0) >= 5.5
    )
    && (
      hasConstructiveMoneyFlow(asset)
      || hasLargeOrderSupport(asset)
      || (asset.volumeRatio ?? 1) >= 1.45
    )
    && constructiveTechnical
}

function marketAllowsOpportunity(asset: MarketAsset, currentMarketScore: number, normalMin: number, resilientMin = 32) {
  return currentMarketScore >= normalMin || (currentMarketScore >= resilientMin && isResilientLeader(asset))
}

function assetThemeText(asset: MarketAsset) {
  return `${asset.name}${asset.sector}${asset.industry ?? ''}${asset.concepts?.join('') ?? ''}`.toLowerCase()
}

function isRetailThemeBetaEtf(asset: MarketAsset) {
  if (asset.kind !== 'etf') return false
  return /科创|芯片|半导体|集成电路|人工智能|ai|电子|信创|软件|机器人|算力/.test(assetThemeText(asset))
}

function isTechnologyThemeAsset(asset: MarketAsset) {
  return /科创|芯片|半导体|集成电路|人工智能|ai|电子|信创|软件|机器人|算力|存储|cpo|光模块|服务器|液冷|pcb/.test(assetThemeText(asset))
}

function isTechnologyReboundFollowThrough(asset: MarketAsset, currentMarketScore: number) {
  const previousSurge = previousCompletedDailyChangePct(asset) >= (asset.kind === 'etf' ? 3.5 : 6)
  const todayConfirm = asset.changePct >= (asset.kind === 'etf' ? 0.8 : 1.5)
    && asset.changePct <= (asset.kind === 'etf' ? 9.8 : 12.8)
    && (asset.volumeRatio ?? 1) >= 1.05
  const broadContext = currentMarketScore >= 30
    || (asset.relativeStrengthRank ?? 0) >= 0.72
    || (asset.sectorRank ?? 0) >= 0.62
    || (asset.sectorMomentum ?? 0) >= 4
  const confirmedFlow = hasConstructiveMoneyFlow(asset)
    || hasLargeOrderSupport(asset)
    || (asset.volumeRatio ?? 1) >= 1.35
  const intradayOk = !asset.intraday
    || (
      asset.intraday.trend !== 'fade'
      && asset.intraday.currentVsVwapPct >= -0.35
      && asset.intraday.last15MinChangePct >= -0.45
      && asset.intraday.highPullbackPct > -4.5
    )
  return isTechnologyThemeAsset(asset)
    && previousSurge
    && todayConfirm
    && broadContext
    && confirmedFlow
    && intradayOk
    && !hasHighVolumeBreakoutFadeRisk(asset)
    && !hasFailedIntradaySpike(asset)
    && asset.riskScore <= 80
    && asset.price > asset.limitDown
    && asset.price < asset.limitUp
}

function hasLargeOrderSupport(asset: MarketAsset) {
  return (asset.superOrderNetInflowPct ?? 0) > 0.2
    || (asset.bigOrderNetInflowPct ?? 0) > 0.2
    || ((asset.superOrderNetInflowPct ?? 0) > 0 && (asset.bigOrderNetInflowPct ?? 0) > 0)
}

function hasLargeOrderDivergenceSupport(asset: MarketAsset) {
  return (asset.mainNetInflowPct ?? 0) < 0
    && (
      (asset.superOrderNetInflowPct ?? 0) >= 0.5
      || (asset.bigOrderNetInflowPct ?? 0) >= 0.5
      || ((asset.superOrderNetInflowPct ?? 0) > 0 && (asset.bigOrderNetInflowPct ?? 0) > 0)
    )
}

function isBottomRepairProtected(asset: MarketAsset) {
  const technical = asset.technical
  const noConfirmedBreak = !technical || (
    !technical.isDeathCross
    || technical.macdHist >= 0
    || technical.ma5 >= technical.ma20
  )
  return (asset.bottomScore ?? 0) >= 80
    && (asset.volumeRatio ?? 1) >= 1.15
    && hasLargeOrderSupport(asset)
    && asset.riskScore <= 78
    && asset.changePct > -4.8
    && noConfirmedBreak
}

function isLeaderPullbackProtected(asset: MarketAsset) {
  const leadingContext = (asset.relativeStrengthRank ?? 0) >= 0.72
    || (asset.sectorRank ?? 0) >= 0.62
    || (asset.sectorMomentum ?? 0) >= 4
  const constructiveTechnical = !asset.technical || (
    !asset.technical.isDeathCross
    || asset.technical.macdHist >= 0
    || asset.technical.ma5 >= asset.technical.ma20
  )
  return leadingContext
    && asset.trendScore >= 50
    && asset.riskScore <= 80
    && constructiveTechnical
}

function hasConfirmedTrendDamage(asset: MarketAsset) {
  const technical = asset.technical
  const technicalDamage = Boolean(technical?.isDeathCross && technical.macdHist < 0 && technical.ma5 < technical.ma20)
  const bottomRepairProtected = isBottomRepairProtected(asset)
  const flowFailure = (asset.mainNetInflowPct ?? 0) < -6 && (asset.bigOrderNetInflowPct ?? 0) < -1.5 && (asset.superOrderNetInflowPct ?? 0) < -1
  const sectorRollover = (asset.sectorRank ?? 1) < 0.3 && (asset.sectorMomentum ?? 0) < -3
  return asset.riskScore >= 86
    || asset.trendScore < (bottomRepairProtected ? 30 : 42)
    || (technicalDamage && (flowFailure || sectorRollover || asset.trendScore < 52))
}

function hasExitGradeDamage(asset: MarketAsset) {
  const technical = asset.technical
  const technicalDamage = Boolean(technical?.isDeathCross && technical.macdHist < 0 && technical.ma5 < technical.ma20)
  const flowFailure = (asset.mainNetInflowPct ?? 0) < -5
    && (asset.bigOrderNetInflowPct ?? 0) < -1.5
    && (asset.superOrderNetInflowPct ?? 0) < -1
  const sectorRollover = (asset.sectorRank ?? 1) < 0.28 && (asset.sectorMomentum ?? 0) < -3
  const priceBreak = asset.changePct <= -4.8 && asset.trendScore < 50 && (asset.mainNetInflowPct ?? 0) < -2
  return asset.riskScore >= 88
    || asset.trendScore < 36
    || priceBreak
    || (technicalDamage && (flowFailure || sectorRollover || asset.trendScore < 48))
    || (flowFailure && (sectorRollover || asset.trendScore < 50))
}

function coreBuyFactorFailureCount(asset: MarketAsset) {
  const technical = asset.technical
  const trend = asset.trendAssessment
  const failures = [
    asset.trendScore < 44 || trend?.direction === 'down' || trend?.phase === 'distribution',
    (asset.relativeStrengthRank ?? 0.5) < 0.35,
    (asset.sectorRank ?? 1) < 0.3 && (asset.sectorMomentum ?? 0) < 0,
    (asset.mainNetInflowPct ?? 0) < -5 && (asset.bigOrderNetInflowPct ?? 0) < -1.5 && (asset.superOrderNetInflowPct ?? 0) < -1,
    (asset.superOrderNetInflowPct ?? 0) < -1 && (asset.bigOrderNetInflowPct ?? 0) < -1,
    Boolean(technical?.isDeathCross && technical.macdHist < 0 && technical.ma5 < technical.ma20)
  ]
  return failures.filter(Boolean).length
}

function isSwingMorningShakeoutProtected(asset: MarketAsset, position: Position, currentMarketScore: number) {
  const intraday = asset.intraday
  if (position.horizon !== 'swing' || !intraday) return false
  const { hour, minute } = getChinaTimeParts()
  const earlyWindow = hour * 60 + minute <= SWING_SHAKEOUT_CONFIRM_MINUTE || intraday.points <= 65
  const intradayWeak = intraday.trend === 'weak_down'
    || (intraday.currentVsVwapPct <= -0.8 && intraday.last15MinChangePct <= -0.6)
  const sectorStillSupported = currentMarketScore >= 45
    && ((asset.sectorRank ?? 0) >= 0.62 || (asset.sectorMomentum ?? 0) >= 3.5)
  const largeOrderStillSupported = hasLargeOrderSupport(asset) || hasLargeOrderDivergenceSupport(asset)
  return earlyWindow
    && intradayWeak
    && position.floatingPnlPct > -5.5
    && asset.riskScore < 84
    && sectorStillSupported
    && largeOrderStillSupported
    && coreBuyFactorFailureCount(asset) < 3
    && !hasConfirmedTrendDamage(asset)
}

function hasExhaustionTrimSetup(asset: MarketAsset, position?: Position) {
  if (!position) return false
  const technical = asset.technical
  const intraday = asset.intraday
  const flowFade = (asset.mainNetInflowPct ?? 0) < -0.8 && (asset.bigOrderNetInflowPct ?? 0) < -0.4
  const overheated = asset.changePct >= 6
    || (technical?.rsi14 ?? 0) >= 82
    || (technical?.closeVsMa20Pct ?? 0) >= 14
    || (asset.turnoverRate ?? 0) >= 16
  const failedIntradaySpike = Boolean(intraday && (
    intraday.turnedGreenAfterStrongOpen
    || intraday.trend === 'fade'
    || (
      intraday.highChangePct >= 5
      && intraday.highPullbackPct <= -3.5
      && intraday.currentVsVwapPct < -0.4
      && intraday.last15MinChangePct < -0.3
    )
  ))
  return (
    position.floatingPnlPct >= 3
    && asset.changePct >= 4.5
    && flowFade
    && overheated
  ) || Boolean(position && failedIntradaySpike && flowFade)
}

function hasFailedIntradaySpike(asset: MarketAsset) {
  const intraday = asset.intraday
  if (!intraday) return false
  const flowWeak = (asset.mainNetInflowPct ?? 0) < 0
    || (asset.bigOrderNetInflowPct ?? 0) < -0.4
    || (asset.superOrderNetInflowPct ?? 0) < -0.4
  return flowWeak && (
    intraday.turnedGreenAfterStrongOpen
    || intraday.trend === 'fade'
    || (
      intraday.first30MinHighChangePct >= 4.5
      && intraday.fadeFromFirst30HighPct <= -3.5
      && intraday.currentVsVwapPct < -0.4
    )
  )
}

function hasTrendExitEvidence(asset: MarketAsset) {
  const trend = asset.trendAssessment
  if (!trend) return false
  return (trend.phase === 'failed_spike' || trend.phase === 'distribution') && trend.confidence >= 0.58
    || trend.direction === 'down' && trend.confidence >= 0.68 && trend.components.moneyFlow < 42
    || trend.direction === 'fading' && trend.confidence >= 0.72 && trend.components.intraday < 35 && trend.components.moneyFlow < 45
}

function rotationOpportunityScore(asset: MarketAsset, currentMarketScore: number) {
  if ((!marketAllowsOpportunity(asset, currentMarketScore, 44, 32)) || hasFailedIntradaySpike(asset) || hasHighVolumeBreakoutFadeRisk(asset)) return 0
  const technical = asset.technical
  const leadingContext = (asset.relativeStrengthRank ?? 0) >= 0.72
    && ((asset.sectorRank ?? 0) >= 0.62 || (asset.sectorMomentum ?? 0) >= 4)
  const positiveFlow = (asset.mainNetInflowPct ?? 0) > 0.8
    || (asset.superOrderNetInflowPct ?? 0) > 0.4
    || (asset.bigOrderNetInflowPct ?? 0) > 0.6
  const bottomReversal = (asset.bottomScore ?? 0) >= 62
    && asset.changePct >= 2.2
    && (asset.volumeRatio ?? 1) >= 1.25
    && (positiveFlow || hasLargeOrderSupport(asset))
  const themeLift = leadingContext
    && asset.changePct >= 2
    && asset.trendScore >= 58
    && (positiveFlow || (asset.volumeRatio ?? 1) >= 1.45)
  const breakoutLift = Boolean(technical?.isBreakout20 || technical?.isBreakout60 || technical?.isBreakout250)
    && asset.changePct >= 1.8
    && (asset.volumeRatio ?? 1) >= 1.25
  if (!bottomReversal && !themeLift && !breakoutLift) return 0

  return clamp(
    asset.trendScore * 0.22
    + asset.sentimentScore * 0.16
    + asset.liquidityScore * 0.12
    - asset.riskScore * 0.12
    + clamp(asset.changePct, 0, 8) * 3.2
    + clamp(((asset.volumeRatio ?? 1) - 1) * 9, 0, 14)
    + clamp((asset.mainNetInflowPct ?? 0) * 1.1 + (asset.bigOrderNetInflowPct ?? 0) * 0.7 + (asset.superOrderNetInflowPct ?? 0) * 0.7, -6, 16)
    + (asset.relativeStrengthRank ?? 0.5) * 12
    + (asset.sectorRank ?? 0.5) * 8
    + clamp(asset.sectorMomentum ?? 0, -4, 8)
    + (bottomReversal ? 10 : 0)
    + (breakoutLift ? 6 : 0),
    0,
    100
  )
}

function buildRotationOpportunityContext(items: MarketAsset[], heldCodes: Set<string>, currentMarketScore: number): RotationOpportunityContext {
  const candidates = items
    .filter((asset) => !heldCodes.has(asset.code) && isBuyAllowedAsset(asset))
    .map((asset) => ({
      asset,
      score: rotationOpportunityScore(asset, currentMarketScore)
    }))
    .filter((item) => item.score >= 72)
    .sort((a, b) => b.score - a.score)
  const best = candidates[0]
  return {
    active: Boolean(best && (best.score >= 78 || candidates.length >= 2)),
    bestName: best?.asset.name ?? '',
    bestScore: best?.score ?? 0,
    bestChangePct: best?.asset.changePct ?? 0,
    hotCount: candidates.length
  }
}

function hasOpportunityCostExit(asset: MarketAsset, position: Position | undefined, currentMarketScore: number, rotationContext: RotationOpportunityContext) {
  if (!position) return false
  const trend = asset.trendAssessment
  const technical = asset.technical
  const heldOpportunityScore = rotationOpportunityScore(asset, currentMarketScore)
  const exceptionalRotationWindow = rotationContext.bestScore >= 84
    && rotationContext.bestChangePct >= 4
    && rotationContext.hotCount >= 1
  const weaknessCount = [
    asset.changePct <= Math.min(1.2, rotationContext.bestChangePct - 2.8),
    heldOpportunityScore + 18 < rotationContext.bestScore,
    asset.trendScore < 58 || trend?.direction === 'fading' || trend?.direction === 'sideways',
    (asset.relativeStrengthRank ?? 0.5) < 0.55,
    (asset.sectorRank ?? 0.5) < 0.5 && (asset.sectorMomentum ?? 0) < 2,
    !hasConstructiveMoneyFlow(asset) && !hasLargeOrderSupport(asset),
    Boolean(technical?.isDeathCross || (technical && technical.closeVsMa20Pct < -4))
  ].filter(Boolean).length

  return rotationContext.active
    && currentMarketScore >= (exceptionalRotationWindow ? 34 : 44)
    && (exceptionalRotationWindow || !(position.floatingPnlPct >= 6 && position.highestPnlPct - position.floatingPnlPct < 3))
    && position.floatingPnlPct > (exceptionalRotationWindow ? -7 : -5)
    && (exceptionalRotationWindow || !isBottomRepairProtected(asset))
    && (exceptionalRotationWindow || !isPotentialCompounder(asset))
    && weaknessCount >= (exceptionalRotationWindow ? 2 : 3)
}

function focusedPortfolioBuyBlockReason(
  asset: MarketAsset,
  position: Position | undefined,
  currentPositionCount: number,
  edgeScore: number,
  currentMarketScore: number,
  sourceLabel: string
) {
  if (position || currentPositionCount < SOFT_MAX_POSITION_COUNT) return ''
  const opportunityScore = rotationOpportunityScore(asset, currentMarketScore)
  const technologyReboundException = isTechnologyReboundFollowThrough(asset, currentMarketScore) && edgeScore >= 68
  const highQualityException = technologyReboundException || edgeScore >= 82
    && (
      opportunityScore >= 78
      || isPotentialCompounder(asset)
      || technologyReboundException
      || (
        asset.trendScore >= 72
        && (asset.relativeStrengthRank ?? 0) >= 0.72
        && ((asset.sectorRank ?? 0) >= 0.62 || (asset.sectorMomentum ?? 0) >= 4)
        && hasConstructiveMoneyFlow(asset)
      )
    )
  if (highQualityException) return ''
  return `${sourceLabel} 买入跳过 ${asset.name}: 当前已有 ${currentPositionCount} 个持仓，组合优先控制在 ${SOFT_MAX_POSITION_COUNT} 个以内，避免实盘参考时过度分散和小额碎片仓。除非是高置信强轮动/核心主线机会，否则先用卖出腾仓或加到已有强持仓。`
}

function hasPostLimitUpBlowoffRisk(asset: MarketAsset) {
  const technical = asset.technical
  const intraday = asset.intraday
  if (!technical || !intraday) return false
  const recentLimitUp = technical.priorTwoLimitUp
    || technical.consecutiveLimitUpDays >= 2
    || technical.recentLimitUpCount >= 2
  return recentLimitUp
    && intraday.highChangePct >= 5
    && intraday.highPullbackPct <= -3.5
    && intraday.minutesFromHigh >= 20
}

function previousCompletedDailyChangePct(asset: MarketAsset) {
  const closes = asset.technical?.closes ?? asset.kline
  if (closes.length < 3) return 0
  const previousClose = closes[closes.length - 3]
  const completedClose = closes[closes.length - 2]
  if (!previousClose || !completedClose || previousClose <= 0) return 0
  return (completedClose - previousClose) / previousClose * 100
}

function hasHighVolumeBreakoutFadeRisk(asset: MarketAsset) {
  const intraday = asset.intraday
  const technical = asset.technical
  if (!intraday) return false

  const strongPreviousSession = previousCompletedDailyChangePct(asset) >= (asset.kind === 'etf' ? 1.5 : 2.5)
  const recentBreakout = Boolean(technical && (
    technical.isBreakout20
    || technical.isBreakout60
    || technical.isBreakout250
    || technical.recentLimitUpCount > 0
  ))
  const highVolume = (asset.volumeRatio ?? 1) >= 1.45 || (technical?.volumeSpike20 ?? 1) >= 1.35
  const unrepairedFade = intraday.currentVsVwapPct <= -0.4
    && intraday.highChangePct >= 1.5
    && intraday.highPullbackPct <= -2.4
    && intraday.minutesFromHigh >= 20
    && (
      intraday.trend === 'fade'
      || intraday.trend === 'weak_down'
      || intraday.last15MinChangePct <= -0.2
    )

  return highVolume && unrepairedFade && (strongPreviousSession || recentBreakout)
}

function hasConstructiveMoneyFlow(asset: MarketAsset) {
  return (asset.mainNetInflowPct ?? 0) > 0
    || (asset.superOrderNetInflowPct ?? 0) > 0
    || (asset.bigOrderNetInflowPct ?? 0) > 0
}

function isSupportedBottomAccumulation(asset: MarketAsset) {
  return !hasHighVolumeBreakoutFadeRisk(asset)
    && (asset.bottomScore ?? 0) >= 62
    && hasConstructiveMoneyFlow(asset)
    && (asset.volumeRatio ?? 1) >= 1.05
    && asset.changePct > -3.5
    && asset.changePct <= 2.6
}

function nearestSupportDistancePct(asset: MarketAsset) {
  const price = asset.price
  const technical = asset.technical
  const supports = [
    asset.previousClose,
    technical?.ma5,
    technical?.ma10,
    technical?.ma20,
    technical?.low20
  ].filter((value): value is number => Boolean(value && value > 0 && value <= price))
  if (!supports.length || price <= 0) return Number.POSITIVE_INFINITY
  return Math.min(...supports.map((value) => (price - value) / price * 100))
}

function isIntradaySupportBuy(asset: MarketAsset, position?: Position) {
  const technical = asset.technical
  const pullbackFromBest = position?.highestPrice
    ? (asset.price - position.highestPrice) / Math.max(position.highestPrice, 1) * 100
    : 0
  const constructiveFlow = hasConstructiveMoneyFlow(asset)
    || ((asset.mainNetInflowPct ?? 0) >= -0.2 && (asset.bigOrderNetInflowPct ?? 0) >= 0)
  const notBroken = !technical || (
    !technical.isDeathCross
    && technical.rsi14 < 78
    && technical.closeVsMa20Pct > -8
  )
  return Boolean(position)
    && asset.changePct <= 2.8
    && asset.riskScore <= 76
    && constructiveFlow
    && notBroken
    && (
      nearestSupportDistancePct(asset) <= 1.25
      || pullbackFromBest <= -1.6
      || isSupportedBottomAccumulation(asset)
    )
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
    && technical.rsi14 < 84
    && technical.closeVsMa20Pct < 24
    && (
      technical.macdHist >= 0
      || technical.isGoldenCross
      || hasBreakout
      || technical.volumeSpike20 >= 1.45
    )
  )
  const intradayOk = !asset.intraday
    || (
      asset.intraday.trend !== 'fade'
      && asset.intraday.currentVsVwapPct >= -0.2
      && asset.intraday.last15MinChangePct >= -0.25
      && asset.intraday.highPullbackPct > -4.8
    )
  return confidence >= 0.8
    && asset.changePct <= AI_MAX_EXCEPTIONAL_MOMENTUM_CHANGE_PCT
    && asset.trendScore >= 70
    && asset.riskScore <= 68
    && (asset.volumeRatio ?? 1) >= 1.35
    && hasStrongFlow
    && hasLeaderContext
    && technicalOk
    && intradayOk
}

function isAiTBuySetup(asset: MarketAsset, position: Position) {
  return isSupportedBottomAccumulation(asset)
    || isIntradaySupportBuy(asset, position)
    || (asset.changePct <= 0.8 && hasConstructiveMoneyFlow(asset))
    || (asset.changePct <= AI_MAX_T_BUY_CHANGE_PCT && position.floatingPnlPct <= -1.2 && hasConstructiveMoneyFlow(asset))
}

function aiBuyHardBlockReason(asset: MarketAsset, position: Position | undefined, decision: AiTradeDecision, currentPositionCount: number, currentMarketScore: number) {
  const blockedReason = buyBlockedReason(asset)
  if (blockedReason) {
    return `AI 买入跳过 ${asset.name}: ${blockedReason}`
  }
  const focusedBlockReason = focusedPortfolioBuyBlockReason(asset, position, currentPositionCount, decision.confidence * 100, currentMarketScore, 'AI')
  if (focusedBlockReason) return focusedBlockReason
  return ''
}

function aiBuyRiskNotes(asset: MarketAsset, position: Position | undefined) {
  const notes: string[] = []
  if (hasPostLimitUpBlowoffRisk(asset)) {
    const intraday = asset.intraday
    const technical = asset.technical
    notes.push(`软风险：近期/连续涨停后今天冲高回落，最高涨幅 ${intraday?.highChangePct.toFixed(2)}%、从高点回撤 ${intraday?.highPullbackPct.toFixed(2)}%，recentLimitUpCount ${technical?.recentLimitUpCount}，疑似高位分歧/派发。`)
  }
  if (hasHighVolumeBreakoutFadeRisk(asset)) {
    const intraday = asset.intraday
    notes.push(`软风险：近期突破/强阳后今天放量冲高回落，量比 ${(asset.volumeRatio ?? 1).toFixed(2)}、最高涨幅 ${intraday?.highChangePct.toFixed(2)}%、从高点回撤 ${intraday?.highPullbackPct.toFixed(2)}%、VWAP 偏离 ${intraday?.currentVsVwapPct.toFixed(2)}%，可能是获利盘兑现/拉高派发。`)
  }
  if (hasFailedIntradaySpike(asset)) {
    notes.push('软风险：分时出现冲高回落/跌破 VWAP，属于失败强势，AI 若仍买入应说明修复证据。')
  }
  const trend = asset.trendAssessment
  if (trend && (
    trend.phase === 'distribution'
    || trend.phase === 'failed_spike'
    || trend.direction === 'down'
    || (trend.direction === 'fading' && trend.confidence >= 0.6)
  ) && trend.phase !== 'bottoming') {
    notes.push(`软风险：综合趋势诊断为 ${trend.direction}/${trend.phase}，score ${trend.score}，AI 若逆势买入需有明确反转/修复理由。`)
  }
  if (position) {
    if (asset.changePct > AI_MAX_T_BUY_CHANGE_PCT && !isSupportedBottomAccumulation(asset) && !isIntradaySupportBuy(asset, position)) {
      notes.push(`软风险：已有持仓当日涨幅 ${asset.changePct.toFixed(2)}% 超过 T 买低吸阈值，买入会提高成本。`)
    }
    if (!isAiTBuySetup(asset, position)) {
      notes.push('软风险：现有持仓没有形成低吸/T 买点，追加买入可能变成追涨加仓。')
    }
  } else if (asset.changePct > AI_MAX_NORMAL_NEW_BUY_CHANGE_PCT && !isExceptionalMomentumBuy(asset, 1)) {
    notes.push(`软风险：当日涨幅 ${asset.changePct.toFixed(2)}% 偏高，AI 若追涨应说明突破、放量、资金和板块共振。`)
  }
  return notes
}

function convictionFromAsset(asset: MarketAsset, scoreOrConfidence = 0) {
  const technical = asset.technical
  const strongFlow = (asset.mainNetInflowPct ?? 0) >= 1.2
    || (asset.superOrderNetInflowPct ?? 0) >= 0.8
    || (asset.bigOrderNetInflowPct ?? 0) >= 1
  const leader = (asset.relativeStrengthRank ?? 0) >= 0.78
    && ((asset.sectorRank ?? 0) >= 0.62 || (asset.sectorMomentum ?? 0) >= 4)
  const constructiveTechnical = !technical || (
    !technical.isDeathCross
    && technical.rsi14 < 82
    && technical.closeVsMa20Pct < 18
    && (
      technical.macdHist >= 0
      || technical.isGoldenCross
      || technical.isBreakout20
      || technical.isBreakout60
    )
  )
  return scoreOrConfidence >= 0.82
    || scoreOrConfidence >= 82
    || (
      asset.trendScore >= 72
      && asset.riskScore <= 62
      && strongFlow
      && leader
      && constructiveTechnical
    )
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
  const aiDecisionBriefFull = ref('AI 暂无本轮结论')
  const aiRequestDebugs = ref<AiRequestDebug[]>([])
  const lastAiDecisionAt = ref(0)
  const autoTradeRunning = ref(false)
  const lastAiSellAtByCode = new Map<string, number>()
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
        sectorAssetCount: params.asset.sectorAssetCount,
        technical: params.asset.technical,
        intraday: params.asset.intraday,
        trendAssessment: params.asset.trendAssessment
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

  function performanceForSource(source: StrategyPerformance['source']): StrategyPerformance {
    const sells = trades.value.filter((trade) => {
      if (trade.side !== 'sell') return false
      if (source === 'all') return true
      return trade.decisionSnapshot?.source === source
    })
    const pnlValues = sells.map((trade) => trade.pnl)
    const pnl = pnlValues.reduce((sum, value) => sum + value, 0)
    const wins = pnlValues.filter((value) => value > 0).length
    const losses = pnlValues.filter((value) => value < 0).length
    const tradesCount = pnlValues.length
    const winRate = tradesCount ? wins / tradesCount * 100 : 0
    const avgPnl = tradesCount ? pnl / tradesCount : 0
    const bestPnl = tradesCount ? Math.max(...pnlValues) : 0
    const worstPnl = tradesCount ? Math.min(...pnlValues) : 0
    const suggestion = !tradesCount
      ? '暂无卖出样本，先积累成交。'
      : winRate >= 58 && avgPnl > 0
        ? '胜率和单笔期望为正，可允许高确信信号放大仓位。'
        : pnl > 0
          ? '总体盈利但胜率一般，继续优先做强信号，弱信号降频。'
          : '样本期亏损，降低普通信号仓位，只保留高确信机会。'
    return {
      source,
      trades: tradesCount,
      wins,
      losses,
      winRate,
      pnl,
      avgPnl,
      bestPnl,
      worstPnl,
      suggestion
    }
  }

  const strategyPerformance = computed<StrategyPerformance[]>(() => [
    performanceForSource('all'),
    performanceForSource('ai'),
    performanceForSource('rule')
  ])

  function roundMetric(value: number) {
    return Number(value.toFixed(2))
  }

  function sourceOfTrade(trade: Trade) {
    return trade.decisionSnapshot?.source
      ?? (trade.reason.startsWith('AI ') ? 'ai' : 'rule')
  }

  function entryTradeForSell(sellTrade: Trade, sellIndex: number) {
    return trades.value
      .slice(sellIndex + 1)
      .find((trade) => trade.side === 'buy' && trade.code === sellTrade.code)
  }

  function classifyTradePattern(entryTrade: Trade | undefined, exitTrade: Trade) {
    const entryReason = (entryTrade?.reason ?? '').toLowerCase()
    const exitReason = exitTrade.reason.toLowerCase()
    const reason = `${entryReason} ${exitReason}`
    const asset = entryTrade?.decisionSnapshot?.asset ?? exitTrade.decisionSnapshot?.asset
    const trend = asset?.trendAssessment
    const intraday = asset?.intraday
    const technical = asset?.technical
    const relativeRank = asset?.relativeStrengthRank ?? 0
    const sectorRank = asset?.sectorRank ?? 0
    const sectorMomentum = asset?.sectorMomentum ?? 0
    const mainFlow = asset?.mainNetInflowPct ?? 0
    const superFlow = asset?.superOrderNetInflowPct ?? 0
    const bigFlow = asset?.bigOrderNetInflowPct ?? 0
    const volumeRatio = asset?.volumeRatio ?? 1
    const changePct = asset?.changePct ?? 0
    const riskScore = asset?.riskScore ?? 50
    const peRatio = asset?.peRatio ?? 0
    const pbRatio = asset?.pbRatio ?? 0
    const turnoverRate = asset?.turnoverRate ?? 0
    const amplitude = asset?.amplitude ?? 0
    const bottomScore = asset?.bottomScore ?? 0
    const broadFlowIn = mainFlow > 0 && (superFlow > 0 || bigFlow > 0)
    const largeOrderIn = superFlow > 0.4 || bigFlow > 0.4 || (superFlow > 0 && bigFlow > 0)
    const largeOrderOut = superFlow < -0.4 || bigFlow < -0.4 || (superFlow < 0 && bigFlow < 0)
    const broadFlowOut = mainFlow < 0 && (superFlow < 0 || bigFlow < 0)
    const leadingSector = sectorRank >= 0.62 || sectorMomentum >= 4
    const broadSector = (asset?.sectorAssetCount ?? 0) >= 3
    const strongRelative = relativeRank >= 0.72
    const weakRelative = relativeRank > 0 && relativeRank < 0.35
    const strongTrend = trend?.direction === 'strong_up' || trend?.direction === 'up'
    const cleanTrend = strongTrend && (trend?.confidence ?? 0) >= 0.62 && riskScore < 70
    const extended = changePct > AI_MAX_NORMAL_NEW_BUY_CHANGE_PCT
      || (technical?.rsi14 ?? 0) >= 78
      || (technical?.closeVsMa20Pct ?? 0) >= 12
    const highVolume = volumeRatio >= 1.4
    const lowVolume = volumeRatio < 0.9
    const isEtf = asset?.kind === 'etf'
    const etfText = `${asset?.code ?? ''}${asset?.name ?? ''}${asset?.sector ?? ''}`.toLowerCase()
    const isOverseasEtf = /513|qdii|港|恒生|纳指|标普|日经|德国|法国/.test(etfText)
    const isSafetyEtf = /黄金|债|货币|商品/.test(etfText)

    if (/小仓|尾仓|清仓/.test(exitReason)) return tradePattern('exit_small_position_clear')
    if (/rotation|轮动|更优|superior/.test(exitReason)) return tradePattern('exit_rotation_to_better_setup')
    if (/sector rollover|板块.*转弱|sector.*weak/.test(exitReason) || (sectorRank < 0.28 && sectorMomentum < -3)) return tradePattern('exit_sector_rollover')
    if (/failed spike|冲高回落|vwap|fade/.test(exitReason) || intraday?.trend === 'fade') return tradePattern(/t trim|t 卖|做t|卖 t/.test(exitReason) ? 'exit_t_failed_spike_trim' : 'exit_failed_spike')
    if (/t trim|t 卖|做t|卖 t|exhaustion trim/.test(exitReason)) return tradePattern('exit_t_exhaustion_trim')
    if (/keep.*core|保留核心|核心不卖/.test(exitReason)) return tradePattern('exit_t_core_leader_no_trim')
    if (/partial|部分|keep core|保留底仓/.test(exitReason)) return tradePattern('exit_t_partial_profit_keep_core')
    if (/hard stop|止损|emergency|跌停|hard risk/.test(exitReason)) return tradePattern('exit_hard_stop')
    if (/trend break|破位|death cross|确认级破坏|downtrend/.test(exitReason) || trend?.phase === 'downtrend') return tradePattern('exit_trend_break')
    if (/outflow|资金流出|money-flow failure|large-order outflow/.test(exitReason) || largeOrderOut) return tradePattern('exit_money_flow_failure')
    if (/market risk|deleverag|指数|系统风险|risk reduction/.test(exitReason)) return tradePattern(isEtf ? 'entry_etf_risk_off_exit' : 'exit_market_risk_reduction')
    if (/profit|止盈|trailing|衰竭|exhaustion|near resistance/.test(exitReason)) return tradePattern('exit_profit_or_exhaustion')

    if (/t 买|t buy|做t|cost|低吸\/t|t_/.test(entryReason)) {
      if (extended) return tradePattern('entry_t_extended_intraday_avoid')
      if (/vwap|分时修复|recovering/.test(entryReason) || intraday?.trend === 'recovering') return tradePattern('entry_t_vwap_reclaim_add')
      if (bottomScore >= 70 || trend?.phase === 'bottoming') return tradePattern('entry_t_bottom_support_add')
      if (largeOrderIn) return tradePattern('entry_t_large_order_support')
      return tradePattern(/加仓|increase|追/.test(entryReason) && changePct > 0.8 ? 'entry_t_bad_cost_increase' : 'entry_t_cost_improvement')
    }

    if (isEtf) {
      if (isSafetyEtf) return tradePattern('entry_bond_gold_cash_etf_safety')
      if (isOverseasEtf && extended) return tradePattern('entry_overseas_etf_overextended')
      if (isOverseasEtf && strongTrend) return tradePattern('entry_overseas_etf_momentum')
      if (/premium|discount|溢价|折价/.test(reason)) return tradePattern('entry_etf_premium_discount_opportunity')
      if (/theme|题材|热点/.test(reason) && extended) return tradePattern('entry_etf_theme_chase')
      if (trend?.phase === 'range' || (turnoverRate > 0 && turnoverRate < 3)) return tradePattern('entry_etf_low_vol_hold')
      if (isOverseasEtf) return tradePattern('entry_t0_global_etf_tactical')
      return tradePattern(leadingSector ? 'entry_sector_etf_rotation' : 'entry_broad_etf_defensive')
    }

    if (/limit-up|涨停|连板|blowoff/.test(reason) || (technical?.recentLimitUpCount ?? 0) >= 2 || technical?.priorTwoLimitUp) {
      return tradePattern((intraday?.highPullbackPct ?? 0) <= -3 || intraday?.trend === 'fade'
        ? 'entry_limit_up_breakout_blowoff_risk'
        : 'entry_limit_up_breakout_clean')
    }
    if (/failed|冲高回落|vwap|fade|turn.*green|失败强势/.test(reason) || intraday?.trend === 'fade' || intraday?.turnedGreenAfterStrongOpen) return tradePattern('entry_failed_intraday_spike')
    if (trend?.phase === 'distribution') return tradePattern('entry_distribution_phase_avoid')
    if (trend?.direction === 'down') return tradePattern('entry_downtrend_countertrend')
    if (technical?.isDeathCross && (technical.macdHist ?? 0) < 0) return tradePattern('entry_death_cross_avoid')
    if (riskScore >= 78 || /speculation|高风险|risk score/.test(reason)) return tradePattern('entry_high_risk_speculation')
    if ((technical?.rsi14 ?? 0) >= 82) return tradePattern('entry_high_rsi_extension')
    if ((asset?.liquidityScore ?? 100) < 40 || (turnoverRate > 0 && turnoverRate < 0.5)) return tradePattern('entry_poor_liquidity_avoid')
    if (/追高|overextended|高位|涨幅/.test(reason) || (changePct > AI_MAX_NORMAL_NEW_BUY_CHANGE_PCT && !largeOrderIn)) return tradePattern(largeOrderIn && highVolume ? 'entry_overextended_with_exceptional_flow' : 'entry_overextended_chase')

    if (/breakout|突破|新高/.test(reason) || technical?.isBreakout20 || technical?.isBreakout60 || technical?.isBreakout250) {
      if (technical?.isBreakout250) return tradePattern(highVolume && broadFlowIn ? 'entry_breakout_250d_volume_flow' : 'entry_breakout_250d_no_flow')
      if (technical?.isBreakout60) return tradePattern(highVolume && broadFlowIn ? 'entry_breakout_60d_volume_flow' : 'entry_breakout_60d_no_flow')
      if (technical?.isBreakout20) return tradePattern(highVolume && broadFlowIn ? 'entry_breakout_20d_volume_flow' : 'entry_breakout_20d_no_flow')
      return tradePattern(riskScore < 62 && broadFlowIn ? 'entry_new_high_low_risk' : 'entry_new_high_high_risk')
    }

    if (/主升|leader|ten-bagger|复利核心/.test(reason) || (strongTrend && strongRelative && leadingSector && broadFlowIn)) return tradePattern(extended ? 'entry_core_leader_compounder_extended' : 'entry_core_leader_compounder_clean')
    if (strongRelative && leadingSector) return tradePattern(broadSector ? 'entry_relative_sector_leader' : 'entry_sector_breadth_confirmation')
    if (strongRelative && !leadingSector) return tradePattern('entry_relative_leader_weak_sector')
    if (!strongRelative && leadingSector) return tradePattern(sectorMomentum >= 5 ? 'entry_sector_momentum_rotation' : 'entry_sector_leader_relative_lag')
    if (/news|政策|题材|sentiment|热点/.test(reason)) {
      if (/policy|政策/.test(reason) && broadFlowIn) return tradePattern('entry_policy_theme_with_flow')
      return tradePattern(leadingSector ? 'entry_news_theme_with_sector' : 'entry_news_theme_isolated')
    }
    if (/theme|题材|热点/.test(reason) && !leadingSector) return tradePattern('entry_isolated_theme_move')

    if (trend?.phase === 'bottoming' || /bottom|底部|修复|accumulation/.test(reason) || bottomScore >= 70) {
      if (changePct < -4 && broadFlowOut) return tradePattern('entry_falling_knife_avoid')
      if (largeOrderIn && volumeRatio >= 1.05) return tradePattern('entry_bottom_large_order_accumulation')
      if (mainFlow > 0 && !largeOrderIn) return tradePattern('entry_bottom_mainflow_only')
      if (highVolume && broadFlowIn) return tradePattern('entry_bottom_high_volume_reversal')
      if (lowVolume) return tradePattern('entry_bottom_low_volume_reversal')
      if (leadingSector) return tradePattern('entry_bottom_sector_support')
      if (broadFlowIn) return tradePattern('entry_bottom_mainflow_only')
      return tradePattern(leadingSector ? 'entry_bottom_sector_support' : 'entry_bottom_isolated')
    }

    if (trend?.phase === 'pullback' || /pullback|support|回踩|回落|支撑|near support/.test(reason)) {
      if (largeOrderIn) return tradePattern('entry_constructive_pullback_large_order')
      if (technical?.ma5 && asset?.price && Math.abs((asset.price - technical.ma5) / asset.price * 100) <= 1.5 && broadFlowIn) return tradePattern('entry_pullback_ma5_support_flow')
      if (technical?.ma10 && asset?.price && Math.abs((asset.price - technical.ma10) / asset.price * 100) <= 1.8 && broadFlowIn) return tradePattern('entry_pullback_ma10_support_flow')
      if (technical?.ma20 && asset?.price && Math.abs((asset.price - technical.ma20) / asset.price * 100) <= 2.2 && broadFlowIn) return tradePattern('entry_pullback_ma20_support_flow')
      if (technical?.ma60 && asset?.price && Math.abs((asset.price - technical.ma60) / asset.price * 100) <= 3 && broadFlowIn) return tradePattern('entry_pullback_ma60_support_flow')
      if (changePct < -2 && intraday?.trend === 'recovering') return tradePattern('entry_gap_down_repair')
      if (trend?.phase === 'downtrend') return tradePattern('entry_support_break_failed')
      return tradePattern('entry_constructive_pullback_no_flow')
    }

    if (/ma|均线|reclaim|金叉/.test(reason) || technical?.isGoldenCross) return tradePattern(broadFlowIn ? 'entry_ma_reclaim_with_flow' : 'entry_ma_reclaim_without_flow')
    if (/vwap|分时修复|recovering|last15/.test(reason) || intraday?.trend === 'recovering') return tradePattern(changePct < 0 ? 'entry_vwap_reclaim' : 'entry_intraday_recovering')
    if (mainFlow > 0 && superFlow < 0 && bigFlow < 0) return tradePattern('entry_main_in_super_big_out')
    if (mainFlow < 0 && (superFlow > 0 || bigFlow > 0)) return tradePattern(superFlow > 0.4 || bigFlow > 0.4 ? 'entry_super_big_inflow_divergence' : 'entry_main_out_super_big_in')
    if (mainFlow < -3 && largeOrderOut) return tradePattern('entry_large_order_outflow_avoid')
    if (broadFlowIn && highVolume) return tradePattern('entry_volume_spike_accumulation')
    if (broadFlowIn) return tradePattern('entry_moneyflow_broad_inflow')
    if (intraday?.trend === 'fade' && broadFlowOut) return tradePattern('entry_flow_fading_after_spike')
    if (trend?.phase === 'bottoming' && mainFlow > -1 && (superFlow > 0 || bigFlow > 0)) return tradePattern('entry_flow_turnaround_repair')
    if (lowVolume && trend?.phase === 'range') return tradePattern('entry_low_volume_drift')
    if (turnoverRate >= 16 || amplitude >= 10) return tradePattern('entry_liquidity_high_turnover_speculation')
    if (weakRelative && !leadingSector) return tradePattern('entry_weak_relative_strength')
    if (peRatio > 0 && peRatio < 18 && pbRatio > 0 && pbRatio < 2) return tradePattern(broadFlowIn ? 'entry_value_reversion_with_flow' : 'entry_value_reversion_without_flow')
    if ((asset?.floatMarketCap ?? 0) > 0 && turnoverRate > 0 && turnoverRate < 3 && trend?.phase === 'range') return tradePattern('entry_low_volatility_quality')
    if (strongTrend) {
      if (trend?.direction === 'strong_up') return tradePattern(broadFlowIn ? 'entry_trend_strong_up_large_flow' : 'entry_trend_strong_up_weak_flow')
      if (trend?.phase === 'pullback') return tradePattern(broadFlowIn ? 'entry_trend_up_pullback_large_flow' : 'entry_trend_up_pullback_weak_flow')
      return tradePattern(leadingSector ? 'entry_trend_continuation_sector_leader' : 'entry_trend_continuation_isolated')
    }
    return tradePattern(cleanTrend ? 'entry_trend_continuation_sector_leader' : 'general_signal')
  }

  function patternStatsFromTrades(): AiLearningPatternStats[] {
    type PatternAccumulator = {
      pattern: string
      trades: number
      wins: number
      losses: number
      pnl: number
      bestPnl: number
      worstPnl: number
      recentExamples: string[]
    }

    const patternMap = trades.value.reduce<Map<string, PatternAccumulator>>((sum, trade, index) => {
      if (trade.side !== 'sell') return sum
      const entryTrade = entryTradeForSell(trade, index)
      const pattern = classifyTradePattern(entryTrade, trade)
      const item = sum.get(pattern) ?? {
        pattern,
        trades: 0,
        wins: 0,
        losses: 0,
        pnl: 0,
        bestPnl: Number.NEGATIVE_INFINITY,
        worstPnl: Number.POSITIVE_INFINITY,
        recentExamples: []
      }
      item.trades += 1
      item.wins += trade.pnl > 0 ? 1 : 0
      item.losses += trade.pnl < 0 ? 1 : 0
      item.pnl += trade.pnl
      item.bestPnl = Math.max(item.bestPnl, trade.pnl)
      item.worstPnl = Math.min(item.worstPnl, trade.pnl)
      if (item.recentExamples.length < 3) {
        const source = sourceOfTrade(entryTrade ?? trade)
        item.recentExamples.push(`${trade.name}(${trade.code}) ${source} ${trade.pnl >= 0 ? '+' : ''}${trade.pnl.toFixed(2)}: ${compactReason(entryTrade?.reason || trade.reason, 90)}`)
      }
      sum.set(pattern, item)
      return sum
    }, new Map())

    return [...patternMap.values()].map((item) => ({
      pattern: item.pattern,
      trades: item.trades,
      wins: item.wins,
      losses: item.losses,
      winRate: roundMetric(item.trades ? item.wins / item.trades * 100 : 0),
      pnl: roundMetric(item.pnl),
      avgPnl: roundMetric(item.trades ? item.pnl / item.trades : 0),
      bestPnl: roundMetric(item.bestPnl === Number.NEGATIVE_INFINITY ? 0 : item.bestPnl),
      worstPnl: roundMetric(item.worstPnl === Number.POSITIVE_INFINITY ? 0 : item.worstPnl),
      recentExamples: item.recentExamples
    }))
  }

  function buildLearningSummary(reviews: AiClosedPositionReview[]): AiLearningSummary {
    const patternStats = patternStatsFromTrades()
    const allPerformance = strategyPerformance.value.find((item) => item.source === 'all')
    const aiPerformance = strategyPerformance.value.find((item) => item.source === 'ai')
    const rulePerformance = strategyPerformance.value.find((item) => item.source === 'rule')
    const observedPatterns = [...patternStats]
      .sort((a, b) => b.trades - a.trades || Math.abs(b.pnl) - Math.abs(a.pnl))
      .slice(0, 100)
    const bestPatterns = [...patternStats]
      .filter((item) => item.trades >= 1 && item.pnl > 0)
      .sort((a, b) => b.avgPnl - a.avgPnl || b.trades - a.trades)
      .slice(0, 30)
    const weakPatterns = [...patternStats]
      .filter((item) => item.trades >= 1 && item.pnl < 0)
      .sort((a, b) => a.avgPnl - b.avgPnl || b.trades - a.trades)
      .slice(0, 30)
    const recentMistakes = reviews
      .filter((review) => review.outcome === 'missed_upside' || review.mistakes.length)
      .slice(0, 5)
      .map((review) => `${review.name}(${review.code}): ${compactReason(review.mistakes.join('; ') || review.summary, 130)}`)
    const provenStrengths = reviews
      .filter((review) => review.outcome === 'protected_downside' || review.strengths.length)
      .slice(0, 5)
      .map((review) => `${review.name}(${review.code}): ${compactReason(review.strengths.join('; ') || review.summary, 120)}`)
    const sampleSize = allPerformance?.trades ?? 0
    const aiSampleSize = aiPerformance?.trades ?? 0
    const ruleSampleSize = rulePerformance?.trades ?? 0
    const currentBias = sampleSize < 6
      ? 'learning_mode: sample is small; keep position sizes conservative and require clean evidence.'
      : (allPerformance?.avgPnl ?? 0) < 0
        ? 'defensive_selectivity: expectancy is negative; reduce low-conviction buys and demand stronger confirmation.'
        : aiSampleSize >= 4 && (aiPerformance?.avgPnl ?? 0) > 0 && (aiPerformance?.winRate ?? 0) >= 50
          ? 'constructive_ai_edge: allow high-conviction setups to size up within risk caps.'
          : 'balanced_selectivity: act on the cleanest setups, but avoid activity for its own sake.'
    const actionHints = [
      bestPatterns.length
        ? `Prefer patterns that have paid: ${bestPatterns.slice(0, 6).map((item) => `${item.pattern} avg ${item.avgPnl}`).join(', ')}.`
        : 'No proven profitable pattern yet; treat every new buy as provisional.',
      weakPatterns.length
        ? `Be stricter or avoid weak patterns: ${weakPatterns.slice(0, 6).map((item) => `${item.pattern} avg ${item.avgPnl}`).join(', ')}.`
        : 'No clearly losing pattern has emerged yet.',
      recentMistakes.length
        ? 'When current evidence resembles recent mistakes, lower confidence or wait for confirmation.'
        : 'No repeated review mistake yet; use raw market evidence first.',
      provenStrengths.length
        ? 'Keep behaviors that reviews say protected downside or captured profit.'
        : 'No repeated proven strength yet; do not overfit early outcomes.'
    ]

    return {
      taxonomySize: AI_TRADE_PATTERN_TAXONOMY.length,
      sampleSize,
      aiSampleSize,
      ruleSampleSize,
      observedPatterns,
      bestPatterns,
      weakPatterns,
      recentMistakes,
      provenStrengths,
      currentBias,
      actionHints
    }
  }

  function buildAiDecisionMemory(): AiDecisionMemory {
    const reviews = Object.values(closedPositionReviews.value)
      .sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || ''))
      .slice(0, 8)
    const missedUpsideReviews = reviews.filter((review) => review.outcome === 'missed_upside')
    const protectedDownsideReviews = reviews.filter((review) => review.outcome === 'protected_downside')
    const aiPerformance = strategyPerformance.value.find((item) => item.source === 'ai')
    const allPerformance = strategyPerformance.value.find((item) => item.source === 'all')
    const patternSummary = buildLearningSummary(reviews)
    const recentTrades = trades.value.slice(0, 18).map((trade) => {
      const item = {
        time: trade.time,
        tradeDate: trade.tradeDate,
        side: trade.side,
        code: trade.code,
        name: trade.name,
        price: trade.price,
        quantity: trade.quantity,
        amount: trade.amount,
        pnl: trade.pnl,
        horizon: trade.horizon,
        reason: trade.reason.replace(/\s+/g, ' ').trim()
      }
      return trade.decisionSnapshot?.source
        ? { ...item, source: trade.decisionSnapshot.source }
        : item
    })
    const learningNotes = [
      allPerformance && allPerformance.trades
        ? `Total closed-trade expectancy: ${allPerformance.avgPnl.toFixed(2)} CNY/trade, win rate ${allPerformance.winRate.toFixed(1)}%, total PnL ${allPerformance.pnl.toFixed(2)}. ${allPerformance.suggestion}`
        : 'No meaningful closed-trade sample yet; prefer high-quality asymmetric opportunities over activity.',
      aiPerformance && aiPerformance.trades
        ? `AI closed-trade expectancy: ${aiPerformance.avgPnl.toFixed(2)} CNY/trade, win rate ${aiPerformance.winRate.toFixed(1)}%, total PnL ${aiPerformance.pnl.toFixed(2)}.`
        : 'AI has too few closed trades; treat confidence as provisional and demand strong evidence.',
      `Compressed learning bias: ${patternSummary.currentBias}`,
      ...patternSummary.actionHints.slice(0, 2),
      missedUpsideReviews.length
        ? `Repeated mistake risk: ${missedUpsideReviews.map((review) => `${review.name}(${review.code}) ${compactReason(review.mistakes.join('; ') || review.summary, 120)}`).join(' | ')}`
        : 'No recent missed-upside review recorded.',
      protectedDownsideReviews.length
        ? `What worked: ${protectedDownsideReviews.map((review) => `${review.name}(${review.code}) ${compactReason(review.strengths.join('; ') || review.summary, 100)}`).join(' | ')}`
        : 'No recent protected-downside review recorded.'
    ].filter(Boolean)

    return {
      performance: strategyPerformance.value,
      recentTrades,
      closedPositionReviews: reviews,
      learningNotes,
      patternSummary
    }
  }

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

  function setAiDecisionBrief(message: string, fullMessage = message) {
    aiDecisionBrief.value = compactReason(message, 96)
    aiDecisionBriefFull.value = fullMessage
  }

  function rememberAiRequestDebug(debug?: AiRequestDebug) {
    if (!debug) return
    aiRequestDebugs.value = [
      debug,
      ...aiRequestDebugs.value.filter((item) => item.id !== debug.id)
    ].slice(0, 6)
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
    const fullMessage = decisions.length
      ? [
          `${modelLabel} 返回 ${decisions.length} 条 AI 建议：`,
          ...decisions.map((decision, index) => {
            const actionText = decision.action === 'buy'
              ? '买入'
              : decision.action === 'sell'
                ? '卖出'
                : '观望'
            const weightText = typeof decision.weight === 'number'
              ? `，目标仓位 ${(decision.weight * 100).toFixed(1)}%`
              : ''
            const sellText = typeof decision.sellRatio === 'number'
              ? `，卖出比例 ${(decision.sellRatio * 100).toFixed(0)}%`
              : ''
            return `${index + 1}. AI建议${actionText} ${assetLabel(decision.code)}，周期 ${decision.horizon}，信心 ${(decision.confidence * 100).toFixed(0)}%${weightText}${sellText}。原因：${decision.reason}`
          })
        ].join('\n')
      : `${modelLabel}：未返回 AI 建议。`
    if (actionable) {
      const actionText = actionable.action === 'buy' ? '买入' : '卖出'
      const countText = decisions.length > 1 ? `，共 ${decisions.length} 条` : ''
      setAiDecisionBrief(`${modelLabel}：AI建议${actionText} ${assetLabel(actionable.code)}${countText}，${actionable.reason}`, fullMessage)
      return
    }

    const hold = decisions.find((decision) => decision.action === 'hold')
    if (hold) {
      setAiDecisionBrief(`${modelLabel}：AI建议观望，${hold.reason}`, fullMessage)
      return
    }

    setAiDecisionBrief(`${modelLabel}：AI建议观望，未返回可执行机会`, fullMessage)
  }

  function updateAiExecutionBrief(results: AiExecutionResult[]) {
    if (!results.length) return
    const firstExecuted = results.find((result) => result.executed)
    const first = firstExecuted ?? results[0]
    const actionText = first.action === 'buy'
      ? '买入'
      : first.action === 'sell'
        ? '卖出'
        : '观望'
    const statusText = first.executed ? '已成交' : '未成交'
    const countText = results.length > 1 ? `，共 ${results.length} 条处理结果` : ''
    const fullMessage = [
      'AI 自动执行结果：',
      ...results.map((result, index) => {
        const itemActionText = result.action === 'buy'
          ? '买入'
          : result.action === 'sell'
            ? '卖出'
            : '观望'
        return `${index + 1}. ${result.executed ? '已成交' : '未成交'} ${itemActionText} ${result.label}。${result.reason}`
      })
    ].join('\n')
    setAiDecisionBrief(`AI执行${statusText}：${actionText} ${first.label}${countText}，${first.reason}`, fullMessage)
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

  function positionWeight(code: string) {
    const position = positions.value.find((item) => item.code === code)
    return position ? position.marketValue / Math.max(totalAsset.value, 1) : 0
  }

  function sectorExposure(asset: MarketAsset) {
    const key = asset.sector || asset.industry || asset.kind
    return positions.value.reduce((sum, position) => {
      const heldAsset = assetMap.value.get(position.code)
      const heldKey = heldAsset?.sector || heldAsset?.industry || heldAsset?.kind
      return heldKey === key ? sum + position.marketValue : sum
    }, 0)
  }

  function allocationCaps(asset: MarketAsset, highConviction: boolean) {
    const assetCap = asset.kind === 'etf'
      ? highConviction ? CONVICTION_ETF_WEIGHT_CAP : BASE_ETF_WEIGHT_CAP
      : highConviction ? CONVICTION_STOCK_WEIGHT_CAP : BASE_STOCK_WEIGHT_CAP
    const sectorCap = highConviction ? CONVICTION_SECTOR_WEIGHT_CAP : BASE_SECTOR_WEIGHT_CAP
    return {
      assetAmount: Math.max(0, totalAsset.value * assetCap - (positions.value.find((item) => item.code === asset.code)?.marketValue ?? 0)),
      sectorAmount: Math.max(0, totalAsset.value * sectorCap - sectorExposure(asset)),
      cashAmount: Math.max(0, cash.value - 100)
    }
  }

  function capBuyAmount(asset: MarketAsset, requestedAmount: number, highConviction: boolean, reason: string, silent = false) {
    const caps = allocationCaps(asset, highConviction)
    const cappedAmount = Math.min(requestedAmount, caps.assetAmount, caps.sectorAmount, caps.cashAmount)
    if (!silent && requestedAmount >= MIN_BUY_AMOUNT && cappedAmount < MIN_BUY_AMOUNT) {
      addLog(`Skip buy ${asset.name}: allocation cap hit. Current weight ${(positionWeight(asset.code) * 100).toFixed(1)}%, market exposure ${(marketValue.value / Math.max(totalAsset.value, 1) * 100).toFixed(1)}%. ${reason}`, 'medium')
    }
    return Math.max(0, cappedAmount)
  }

  function aiBuyCapacityBlockReason(asset: MarketAsset, requestedAmount: number, cappedAmount: number, highConviction: boolean, isNewPosition: boolean) {
    const minRequiredAmount = MIN_BUY_AMOUNT
    if (cappedAmount >= minRequiredAmount) return ''
    const caps = allocationCaps(asset, highConviction)
    const capLabels: Array<[keyof typeof caps, string]> = [
      ['assetAmount', '单标的仓位上限'],
      ['sectorAmount', '板块仓位上限'],
      ['cashAmount', '可用现金']
    ]
    const limitingCaps = capLabels
      .filter(([key]) => caps[key] < minRequiredAmount)
      .map(([key, label]) => `${label}剩余 ${caps[key].toFixed(0)}`)
    const currentWeight = positionWeight(asset.code) * 100
    const exposurePct = marketValue.value / Math.max(totalAsset.value, 1) * 100
    return `AI 买入跳过 ${asset.name}: ${isNewPosition ? '新开仓' : '买入'}空间不足一笔最低成交额 ${minRequiredAmount}。AI目标金额 ${requestedAmount.toFixed(0)}，执行后可用买入空间 ${cappedAmount.toFixed(0)}；${limitingCaps.join('，') || '目标金额低于最低买入额'}。当前个股仓位 ${currentWeight.toFixed(1)}%，组合持仓 ${exposurePct.toFixed(1)}%，现金 ${cash.value.toFixed(0)}。`
  }

  function buy(asset: MarketAsset, targetAmount: number, reason: string, horizon: StrategyHorizon = 'swing', snapshot?: Trade['decisionSnapshot']) {
    const blockedReason = buyBlockedReason(asset)
    if (blockedReason) {
      addOrder({
        side: 'buy',
        code: asset.code,
        name: asset.name,
        price: asset.price,
        quantity: 0,
        amount: 0,
        status: 'rejected',
        horizon,
        reason: `${blockedReason} ${reason}`
      })
      addLog(`Skip buy ${asset.name}: ${blockedReason}`, 'medium')
      return false
    }
    const existing = positions.value.find((position) => position.code === asset.code)
    let price = orderPrice(asset, 'buy', reason)
    const floorQuantity = floorToLotQuantity(targetAmount / price)
    const ceilQuantity = ceilToLotQuantity(targetAmount / price)
    const floorAmount = floorQuantity * price
    const ceilAmount = ceilQuantity * price
    const minExecutableAmount = MIN_BUY_AMOUNT
    const canRoundUp = floorAmount < PREFERRED_BUY_AMOUNT
      && ceilQuantity >= 100
      && ceilAmount <= (targetAmount >= PREFERRED_BUY_AMOUNT ? Math.max(targetAmount * 1.25, PREFERRED_BUY_AMOUNT) : targetAmount * 1.25)
      && ceilAmount + calcBuyFee(ceilAmount) <= cash.value
    const lotQuantity = canRoundUp ? ceilQuantity : floorQuantity
    if (lotQuantity < 100) {
      addLog(`Skip buy ${asset.name}: target amount cannot reach one lot.`, 'low')
      return false
    }

    const minimumPriceForLot = formatOrderPrice(minExecutableAmount / lotQuantity)
    if (
      lotQuantity === 100
      && lotQuantity * price < minExecutableAmount
      && minimumPriceForLot <= asset.price
      && minimumPriceForLot <= asset.limitUp
      && lotQuantity * minimumPriceForLot + calcBuyFee(lotQuantity * minimumPriceForLot) <= cash.value
    ) {
      price = minimumPriceForLot
    }

    const amount = lotQuantity * price
    if (amount < minExecutableAmount) {
      addLog(`Skip buy ${asset.name}: CNY ${amount.toFixed(0)} is below minimum buy amount ${minExecutableAmount}.`, 'low')
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
    const tacticalExit = /T trim|trailing|hard stop|risk|trend break|outflow|market risk|short momentum|rotation|opportunity cost/i.test(reason)
    const emergencyExit = asset.riskScore >= 86
      || existing.floatingPnlPct <= (existing.horizon === 'long' ? -13 : existing.horizon === 'swing' ? -8 : -4.5)

    if (!mustClearSmallPosition && heldDays < minHoldDays && !emergencyExit && !tacticalExit) {
      addLog(`Skip sell ${asset.name} @ ${asset.price.toFixed(3)}: ${existing.horizon} 持仓仅 ${heldDays} 天，未到 ${minHoldDays} 天最短观察期.`, 'low')
      return false
    }

    const price = orderPrice(asset, 'sell', reason)
    let quantity = floorToLotQuantity(existing.availableQuantity * ratio)
    let executionNote = ''
    if (mustClearSmallPosition) {
      quantity = existing.availableQuantity >= existing.quantity ? existing.quantity : 0
      if (quantity > 0) {
        executionNote = `执行调整：当前持仓市值 ${positionValue.toFixed(0)} 低于 ${SMALL_POSITION_CLEAR_AMOUNT}，按小仓规则清仓。`
      }
    } else if (quantity > 0 && quantity * asset.price < MIN_SELL_AMOUNT) {
      quantity = ceilToLotQuantity(MIN_SELL_AMOUNT / asset.price)
    }

    quantity = Math.min(quantity, existing.availableQuantity)
    quantity = floorToLotQuantity(quantity)
    const leavesTinyRemainder = (existing.quantity - quantity) > 0 && (existing.quantity - quantity) * asset.price < MIN_REMAINING_POSITION_AMOUNT
    if (!mustClearSmallPosition && leavesTinyRemainder && existing.availableQuantity >= existing.quantity) {
      quantity = existing.quantity
      executionNote = `执行调整：按比例卖出会留下低于 ${MIN_REMAINING_POSITION_AMOUNT} 的尾仓，自动改为清仓。`
    } else if (!mustClearSmallPosition && leavesTinyRemainder) {
      addLog(`Skip sell ${asset.name} @ ${asset.price.toFixed(3)}: 本次卖出会留下低于 ${MIN_REMAINING_POSITION_AMOUNT} 的尾仓，但 T+1 锁定导致无法清仓。`, 'low')
      return false
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
    const isFullExit = quantity >= existing.quantity && existing.availableQuantity >= existing.quantity
    if (!isFullExit && amount < MIN_SELL_AMOUNT) {
      addLog(`Skip sell ${asset.name} @ ${asset.price.toFixed(3)}: 单次卖出 ${amount.toFixed(0)} 低于最低 ${MIN_SELL_AMOUNT}.`, 'low')
      return false
    }

    const fee = calcSellFee(amount)
    const costBasis = quantity * existing.averageCost
    const pnl = amount - fee - costBasis
    const pnlPct = pnl / Math.max(costBasis, 1) * 100
    const sellOutcome = `${pnl >= 0 ? '盈利卖出' : '亏损卖出'} ${pnl >= 0 ? '+' : ''}${pnl.toFixed(2)} (${pnlPct >= 0 ? '+' : ''}${pnlPct.toFixed(2)}%)`
    const finalReason = executionNote ? `${reason} | ${executionNote}` : reason
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
      reason: `${finalReason} | ${sellOutcome}`,
      decisionSnapshot: snapshot
    })
    addOrder({ side: 'sell', code: asset.code, name: asset.name, price, quantity, amount, status: 'filled', horizon: existing.horizon, reason: `${finalReason} | ${sellOutcome}` })

    positions.value = positions.value.filter((position) => position.quantity > 0)
    refreshMarks()
    addLog(`SELL ${asset.name} ${quantity} @ ${price.toFixed(3)} limit, quote ${asset.price.toFixed(3)}. ${pnl >= 0 ? 'Profit' : 'Loss'} ${pnl.toFixed(2)} (${pnlPct >= 0 ? '+' : ''}${pnlPct.toFixed(2)}%). ${finalReason}`, asset.riskScore > 55 ? 'high' : 'medium')
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
    if (!isBuyAllowedAsset(asset)) return false
    if (asset.price >= asset.limitUp) return false
    const existing = positions.value.find((position) => position.code === signal.code)
    if (!existing && focusedPortfolioBuyBlockReason(asset, undefined, positions.value.length, signal.score, marketScore.value, '规则')) return false
    if (existing) {
      const targetAmount = capBuyAmount(asset, Math.min(isIntradaySupportBuy(asset, existing) ? T_SUPPORT_BUY_AMOUNT : T_BUY_AMOUNT, Math.max(0, cash.value - 100)), convictionFromAsset(asset, signal.score), signal.reason, true)
      const lotQuantity = floorToLotQuantity(targetAmount / asset.price)
      const amount = lotQuantity * asset.price
      return lotQuantity >= 100 && amount >= MIN_BUY_AMOUNT && amount + calcBuyFee(amount) <= cash.value
    }
    const cashCap = lowCashAwareBuyCap(cash.value)
    const preferredAmount = signal.reason.includes('visible momentum') ? MIN_BUY_AMOUNT : PREFERRED_BUY_AMOUNT
    const targetAmount = capBuyAmount(asset, Math.min(Math.max(totalAsset.value * signal.suggestedWeight, preferredAmount), cashCap), convictionFromAsset(asset, signal.score), signal.reason, true)
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
    if (!isBuyAllowedAsset(asset)) return false
    if (asset.price >= asset.limitUp || !hasSellablePosition()) return false
    const existing = positions.value.find((position) => position.code === signal.code)
    if (!existing && focusedPortfolioBuyBlockReason(asset, undefined, positions.value.length, signal.score, marketScore.value, '轮动')) return false
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
    const positionValue = position.quantity * asset.price
    const mustClearSmallPosition = positionValue < SMALL_POSITION_CLEAR_AMOUNT
    let quantity = floorToLotQuantity(position.availableQuantity * ratio)
    if (mustClearSmallPosition) {
      quantity = position.availableQuantity >= position.quantity ? position.quantity : 0
    } else if (quantity > 0 && quantity * asset.price < MIN_SELL_AMOUNT) {
      quantity = ceilToLotQuantity(MIN_SELL_AMOUNT / asset.price)
    }
    quantity = floorToLotQuantity(Math.min(quantity, position.availableQuantity))
    const remainingValue = (position.quantity - quantity) * asset.price
    const isFullExit = quantity >= position.quantity && position.availableQuantity >= position.quantity
    if (!isFullExit && remainingValue > 0 && remainingValue < MIN_REMAINING_POSITION_AMOUNT) return false
    const amount = quantity * asset.price
    return quantity >= 100 && (isFullExit || amount >= MIN_SELL_AMOUNT)
  }

  function actionableSignals() {
    return signals.value.filter((signal) => canBuySignal(signal) || canSellSignal(signal) || canRotateIntoSignal(signal))
  }

  function aiCandidateSignals(): AiCandidateSignal[] {
    const positionCodes = new Set(positions.value.map((position) => position.code))
    const candidateMap = new Map<string, AiCandidateSignal>()
    const eligibleSignals = signals.value.filter((signal) => {
      const asset = assetMap.value.get(signal.code)
      return Boolean(asset && (positionCodes.has(signal.code) || isBuyAllowedAsset(asset)))
    })
    const addCandidate = (signal: StrategySignal | undefined, source: string) => {
      if (!signal) return
      const asset = assetMap.value.get(signal.code)
      if (!asset || (!positionCodes.has(signal.code) && !isBuyAllowedAsset(asset))) return
      const existing = candidateMap.get(signal.code)
      if (existing) {
        existing.candidateSources = [...new Set([...(existing.candidateSources ?? []), source])]
        return
      }
      candidateMap.set(signal.code, {
        ...signal,
        candidateSources: [source]
      })
    }
    const addCandidates = (items: StrategySignal[], source: string) => {
      items.forEach((signal) => addCandidate(signal, source))
    }
    const rankedSignals = (
      predicate: (signal: StrategySignal, asset: MarketAsset) => boolean,
      score: (signal: StrategySignal, asset: MarketAsset) => number,
      limit: number
    ) => eligibleSignals
      .filter((signal) => {
        const asset = assetMap.value.get(signal.code)
        return Boolean(asset && predicate(signal, asset))
      })
      .sort((a, b) => {
        const assetA = assetMap.value.get(a.code)
        const assetB = assetMap.value.get(b.code)
        return (assetB ? score(b, assetB) : -Infinity) - (assetA ? score(a, assetA) : -Infinity)
      })
      .slice(0, limit)

    addCandidates(actionableSignals(), 'local actionable rule signal')
    addCandidates(
      positions.value
        .map((position) => signals.value.find((signal) => signal.code === position.code))
        .filter((signal): signal is StrategySignal => Boolean(signal)),
      'held position review'
    )
    addCandidates(eligibleSignals.slice(0, 20), 'top local composite score')
    addCandidates(rankedSignals(
      (_signal, asset) => (asset.relativeStrengthRank ?? 0) >= 0.72 || (asset.sectorRank ?? 0) >= 0.62 || (asset.sectorMomentum ?? 0) >= 4,
      (signal, asset) => signal.score + (asset.relativeStrengthRank ?? 0) * 18 + (asset.sectorRank ?? 0) * 12 + (asset.sectorMomentum ?? 0) * 0.8,
      18
    ), 'relative or sector leader')
    addCandidates(rankedSignals(
      (_signal, asset) => !hasHighVolumeBreakoutFadeRisk(asset) && (asset.bottomScore ?? 0) >= 62 && hasConstructiveMoneyFlow(asset) && asset.changePct <= 2.8,
      (signal, asset) => signal.score + (asset.bottomScore ?? 0) * 0.35 + ((asset.volumeRatio ?? 1) - 1) * 8 + (asset.bigOrderNetInflowPct ?? 0) * 0.5,
      16
    ), 'bottom accumulation with money-flow support')
    addCandidates(rankedSignals(
      (_signal, asset) => (asset.mainNetInflowPct ?? 0) > 1 || (asset.superOrderNetInflowPct ?? 0) > 0.8 || (asset.bigOrderNetInflowPct ?? 0) > 1,
      (signal, asset) => signal.score + (asset.mainNetInflowPct ?? 0) * 1.2 + (asset.superOrderNetInflowPct ?? 0) * 0.7 + (asset.bigOrderNetInflowPct ?? 0) * 0.7,
      16
    ), 'large-order money-flow anomaly')
    addCandidates(rankedSignals(
      (_signal, asset) => isRetailThemeBetaEtf(asset)
        && asset.changePct >= 1.2
        && asset.price < asset.limitUp
        && !hasHighVolumeBreakoutFadeRisk(asset)
        && (
          (asset.volumeRatio ?? 1) >= 1.15
          || hasConstructiveMoneyFlow(asset)
          || hasLargeOrderSupport(asset)
        ),
      (signal, asset) => signal.score
        + clamp(asset.changePct, 0, 10) * 3.2
        + clamp(((asset.volumeRatio ?? 1) - 1) * 10, 0, 16)
        + (asset.relativeStrengthRank ?? 0.5) * 14
        + (asset.sectorRank ?? 0.5) * 12
        + clamp(asset.sectorMomentum ?? 0, -4, 10)
        + clamp((asset.mainNetInflowPct ?? 0) + (asset.bigOrderNetInflowPct ?? 0) + (asset.superOrderNetInflowPct ?? 0), -4, 14),
      12
    ), 'retail ETF theme beta implementation')
    addCandidates(rankedSignals(
      (_signal, asset) => nearestSupportDistancePct(asset) <= 1.5 && hasConstructiveMoneyFlow(asset) && asset.riskScore <= 76,
      (signal, asset) => signal.score + Math.max(0, 1.5 - nearestSupportDistancePct(asset)) * 8 + (asset.trendAssessment?.score ?? 50) * 0.2,
      14
    ), 'constructive pullback near support')
    addCandidates(rankedSignals(
      (_signal, asset) => positionCodes.has(asset.code) || asset.changePct <= -3 || asset.riskScore >= 78 || asset.trendAssessment?.direction === 'down' || asset.trendAssessment?.direction === 'fading',
      (signal, asset) => (positionCodes.has(asset.code) ? 80 : 0) + asset.riskScore + Math.abs(Math.min(asset.changePct, 0)) * 4 + (100 - signal.score) * 0.2,
      14
    ), 'risk and weak-tape sample')

    return [...candidateMap.values()].slice(0, 100)
  }

  function shouldSkipAiDecision() {
    const hasPositions = positions.value.length > 0
    const allPositionsBlockedForSell = hasPositions
      && positions.value.every((position) => position.availableQuantity < 100)
    return allPositionsBlockedForSell && cash.value < AI_SKIP_CASH_FLOOR
  }

  function hasThemeBetaUrgency(candidates: AiCandidateSignal[]) {
    const starIndex = indexes.value.find((item) => item.code.includes('000688') || item.name.includes('科创'))
    const themeEtfs = assets.value
      .filter((asset) => isBuyAllowedAsset(asset) && isRetailThemeBetaEtf(asset))
      .filter((asset) => asset.price > asset.limitDown && asset.price < asset.limitUp)
      .filter((asset) => !hasHighVolumeBreakoutFadeRisk(asset) && !hasFailedIntradaySpike(asset))
    const techAssets = assets.value
      .filter(isTechnologyThemeAsset)
      .filter((asset) => asset.price > asset.limitDown && asset.price < asset.limitUp)
      .filter((asset) => !hasHighVolumeBreakoutFadeRisk(asset) && !hasFailedIntradaySpike(asset))
    const techFollowThroughCount = techAssets.filter((asset) => (
      previousCompletedDailyChangePct(asset) >= (asset.kind === 'etf' ? 3.5 : 6)
      && asset.changePct >= (asset.kind === 'etf' ? 0.8 : 1.5)
      && (asset.volumeRatio ?? 1) >= 1.05
    )).length
    const techPanicReboundCount = techAssets.filter((asset) => (
      asset.changePct >= (asset.kind === 'etf' ? 2 : 5)
      && (
        (asset.volumeRatio ?? 1) >= 1.25
        || hasConstructiveMoneyFlow(asset)
        || (asset.relativeStrengthRank ?? 0) >= 0.72
      )
    )).length
    const bestThemeEtf = themeEtfs
      .sort((a, b) => (
        b.changePct
        + (b.volumeRatio ?? 1)
        + (b.relativeStrengthRank ?? 0) * 2
        + (b.sectorRank ?? 0) * 2
      ) - (
        a.changePct
        + (a.volumeRatio ?? 1)
        + (a.relativeStrengthRank ?? 0) * 2
        + (a.sectorRank ?? 0) * 2
      ))[0]
    const hasThemeCandidate = candidates.some((candidate) => candidate.candidateSources?.some((source) => source.includes('theme beta')))
    const canAct = cash.value >= MIN_BUY_AMOUNT || hasSellablePosition()
    return Boolean(canAct && bestThemeEtf && hasThemeCandidate && (
      (starIndex?.changePct ?? 0) >= 2.5
      || bestThemeEtf.changePct >= 3.2
      || (bestThemeEtf.changePct >= 2 && (bestThemeEtf.volumeRatio ?? 1) >= 1.4)
      || techPanicReboundCount >= 3
      || techFollowThroughCount >= 2
    ))
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
    positions.value = normalizeT1Locks(positions.value)
    refreshMarks()
    const candidates = aiCandidateSignals()
    const themeBetaUrgency = hasThemeBetaUrgency(candidates)
    if (!force && Date.now() - lastAiDecisionAt.value < AI_DECISION_COOLDOWN_MS && !themeBetaUrgency) {
      aiStatus.value = 'resting'
      aiError.value = ''
      setAutoDecisionNotice('info', 'AI 决策接口冷却中')
      addLog('AI decision resting: cooldown is active.', 'low')
      return []
    }
    if (!force && themeBetaUrgency && Date.now() - lastAiDecisionAt.value < AI_DECISION_COOLDOWN_MS) {
      addLog('AI cooldown bypassed: retail ETF theme beta urgency detected.', 'medium')
    }
    if (!candidates.length) {
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
        debug?: AiRequestDebug
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
          assets: assets.value,
          memory: buildAiDecisionMemory()
        }
      })

      rememberAiRequestDebug(response.debug)
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
      addLog(`AI decision layer ${response.model ?? ''}: ${decisions.length} normalized decisions.`, 'low')
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
        debug?: AiRequestDebug
      }>('/api/ai/market-summary', {
        method: 'POST',
        body: {
          marketScore: marketScore.value,
          indexes: indexes.value,
          news: news.value,
          assets: assets.value
        }
      })

      rememberAiRequestDebug(response.debug)
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
        debug?: AiRequestDebug
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

      rememberAiRequestDebug(response.debug)
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

  function executeAiDecision(decision: AiTradeDecision): AiExecutionResult {
    const asset = assetMap.value.get(decision.code)
    if (!asset) {
      return {
        action: decision.action,
        label: decision.code,
        executed: false,
        reason: `标的不在当前行情池。AI原因：${decision.reason}`
      }
    }
    const minConfidence = decision.action === 'buy' ? AI_MIN_BUY_CONFIDENCE : AI_MIN_CONFIDENCE
    if (decision.confidence < minConfidence) {
      return {
        action: decision.action,
        label: assetLabel(decision.code),
        executed: false,
        reason: `AI 信心 ${(decision.confidence * 100).toFixed(0)}% 低于 ${(minConfidence * 100).toFixed(0)}% 执行阈值。AI原因：${decision.reason}`
      }
    }
    let executed = false
    const snapshot = createTradeSnapshot({
      source: 'ai',
      asset,
      decision
    })
    if (decision.action === 'sell') {
      const position = positions.value.find((item) => item.code === asset.code)
      const lastAiSellAt = lastAiSellAtByCode.get(asset.code) ?? 0
      const confirmedDamage = hasConfirmedTrendDamage(asset)
      const exitGradeDamage = hasExitGradeDamage(asset)
      if (
        position
        && lastAiSellAt > 0
        && Date.now() - lastAiSellAt < AI_SAME_SYMBOL_SELL_COOLDOWN_MS
        && !confirmedDamage
        && !exitGradeDamage
      ) {
        const remainingMinutes = Math.ceil((AI_SAME_SYMBOL_SELL_COOLDOWN_MS - (Date.now() - lastAiSellAt)) / 60000)
        const reason = `执行护栏：${asset.name} 刚完成 AI 卖出，${remainingMinutes} 分钟内不重复减仓；除非出现确认级趋势破坏或硬风险。AI原因：${decision.reason}`
        addLog(reason, 'medium')
        return {
          action: decision.action,
          label: assetLabel(decision.code),
          executed: false,
          reason
        }
      }
      const exhaustionTrimSetup = hasExhaustionTrimSetup(asset, position)
      const trendExitEvidence = hasTrendExitEvidence(asset) || hasPostLimitUpBlowoffRisk(asset)
      const rotationContext = buildRotationOpportunityContext(assets.value, new Set(positions.value.map((item) => item.code)), marketScore.value)
      const opportunityCostExit = hasOpportunityCostExit(asset, position, marketScore.value, rotationContext)
      const exceptionalRotationExit = opportunityCostExit
        && rotationContext.bestScore >= 84
        && rotationContext.bestChangePct >= 4
      const bottomRepairProtected = position && isBottomRepairProtected(asset) && !confirmedDamage
      const leaderPullbackProtected = position && isLeaderPullbackProtected(asset) && !confirmedDamage
      const swingShakeoutProtected = position && isSwingMorningShakeoutProtected(asset, position, marketScore.value) && !exitGradeDamage
      const protectsCompoundingCore = position
        && isPotentialCompounder(asset)
        && !confirmedDamage
        && !exitGradeDamage
      const sellSoftNotes = [
        swingShakeoutProtected && !exhaustionTrimSetup ? '软保护：波段持仓早盘弱势但板块/大单承接仍在。' : '',
        position && isAtDailyLimitUp(asset) && !exitGradeDamage ? '软保护：当前涨停，涨停本身不是卖出建议；如有风险只允许小幅减仓并保留次日延续仓位。' : '',
        decision.confidence < 0.68 && !exitGradeDamage && !exhaustionTrimSetup && !trendExitEvidence && !opportunityCostExit ? '软保护：卖出信心不足且没有确认级破坏/衰竭。' : '',
        bottomRepairProtected && !exitGradeDamage && !exhaustionTrimSetup && !trendExitEvidence && !opportunityCostExit ? '软保护：底部修复承接仍在，未出现确认级破坏。' : '',
        leaderPullbackProtected && !exitGradeDamage && !exhaustionTrimSetup && !trendExitEvidence && !opportunityCostExit ? '软保护：主线/相对强势结构未确认破坏。' : '',
        protectsCompoundingCore && !exhaustionTrimSetup && !trendExitEvidence && !opportunityCostExit ? '软保护：复利核心/潜在主升结构未确认破坏。' : ''
      ].filter(Boolean)
      const requestedRatio = Math.max(0.2, Math.min(1, decision.sellRatio ?? 0.5))
      const protectedRatio = position && isAtDailyLimitUp(asset) && !exitGradeDamage
        ? Math.min(requestedRatio, 0.25)
        : trendExitEvidence && !exitGradeDamage
        ? Math.min(requestedRatio, 0.35)
        : exhaustionTrimSetup && !exitGradeDamage
        ? Math.min(requestedRatio, 0.2)
        : opportunityCostExit && !exitGradeDamage
        ? Math.min(requestedRatio, exceptionalRotationExit ? 0.6 : 0.45)
        : bottomRepairProtected && !exitGradeDamage
        ? Math.min(requestedRatio, 0.25)
        : leaderPullbackProtected && !exitGradeDamage
          ? Math.min(requestedRatio, 0.3)
          : protectsCompoundingCore ? Math.min(requestedRatio, 0.25)
            : sellSoftNotes.length ? Math.min(requestedRatio, 0.3) : requestedRatio
      const protectionNote = protectedRatio < requestedRatio
        ? position && isAtDailyLimitUp(asset) && !exitGradeDamage
          ? `执行护栏：当前涨停，默认保留次日延续仓位，AI 卖出比例从 ${(requestedRatio * 100).toFixed(0)}% 降至 ${(protectedRatio * 100).toFixed(0)}%，不允许清仓。`
          : trendExitEvidence && !exitGradeDamage
          ? `执行护栏：综合趋势诊断已转弱但未到硬止损，AI 卖出比例从 ${(requestedRatio * 100).toFixed(0)}% 降至 ${(protectedRatio * 100).toFixed(0)}%。`
          : exhaustionTrimSetup && !exitGradeDamage
          ? `执行护栏：只有日内衰竭/T 卖证据，AI 卖出比例从 ${(requestedRatio * 100).toFixed(0)}% 降至 ${(protectedRatio * 100).toFixed(0)}%。`
          : opportunityCostExit && !exitGradeDamage
          ? `执行护栏：${exceptionalRotationExit ? '极强' : '强'}机会窗口下的落后持仓机会成本减仓，AI 卖出比例从 ${(requestedRatio * 100).toFixed(0)}% 降至 ${(protectedRatio * 100).toFixed(0)}%。`
          : bottomRepairProtected
          ? `执行护栏：底部修复承接未破坏，AI 卖出比例从 ${(requestedRatio * 100).toFixed(0)}% 降至 ${(protectedRatio * 100).toFixed(0)}%。`
          : leaderPullbackProtected
            ? `执行护栏：主线/相对强势结构未确认破坏，AI 卖出比例从 ${(requestedRatio * 100).toFixed(0)}% 降至 ${(protectedRatio * 100).toFixed(0)}%。`
            : `执行护栏：复利核心未确认破坏，AI 卖出比例从 ${(requestedRatio * 100).toFixed(0)}% 降至 ${(protectedRatio * 100).toFixed(0)}%。`
        : ''
      const softNoteText = sellSoftNotes.length ? ` | ${sellSoftNotes.join(' ')}` : ''
      const limitUpTrimBlockReason = position && isAtDailyLimitUp(asset) && !exitGradeDamage
        ? limitUpPartialTrimBlockedReason(asset, position, protectedRatio)
        : ''
      if (limitUpTrimBlockReason) {
        addLog(`${limitUpTrimBlockReason} AI reason: ${decision.reason}`, 'medium')
        return {
          action: decision.action,
          label: assetLabel(decision.code),
          executed: false,
          reason: `${limitUpTrimBlockReason} AI原因：${decision.reason}`
        }
      }
      executed = sell(asset, protectedRatio, `AI ${decision.horizon}: ${decision.reason}${protectionNote ? ` | ${protectionNote}` : ''}${softNoteText}`, snapshot)
    } else if (decision.action === 'buy') {
      const existing = positions.value.find((position) => position.code === asset.code)
      const blockReason = aiBuyHardBlockReason(asset, existing, decision, positions.value.length, marketScore.value)
      if (blockReason) {
        addLog(`${blockReason} AI reason: ${decision.reason}`, 'medium')
        return {
          action: decision.action,
          label: assetLabel(decision.code),
          executed: false,
          reason: `${blockReason} AI原因：${decision.reason}`
        }
      }
      const riskNotes = aiBuyRiskNotes(asset, existing)
      const cashCap = Math.max(0, cash.value - 100)
      const currentWeight = existing ? existing.marketValue / Math.max(totalAsset.value, 1) : 0
      const highConviction = convictionFromAsset(asset, decision.confidence)
      const targetWeight = typeof decision.weight === 'number'
        ? clamp(decision.weight, currentWeight, highConviction ? 0.95 : 0.72)
        : existing
          ? clamp(currentWeight + (isIntradaySupportBuy(asset, existing) ? T_SUPPORT_BUY_AMOUNT : T_BUY_AMOUNT) / Math.max(totalAsset.value, 1), 0, highConviction ? 0.95 : 0.72)
          : Math.min(Math.max(defaultTargetWeight(highConviction), PREFERRED_BUY_AMOUNT / Math.max(totalAsset.value, 1)), highConviction ? 0.95 : 0.72)
      const targetAmount = existing
        ? Math.min(Math.max(0, totalAsset.value * targetWeight - existing.marketValue), cashCap)
        : Math.min(totalAsset.value * targetWeight, cashCap)
      const reboundFollowThrough = isTechnologyReboundFollowThrough(asset, marketScore.value)
      const guardedTargetAmount = !existing && asset.changePct > AI_MAX_NORMAL_NEW_BUY_CHANGE_PCT
        ? Math.min(targetAmount, Math.max(MIN_BUY_AMOUNT, totalAsset.value * (reboundFollowThrough ? 0.18 : MOMENTUM_PROBE_WEIGHT)))
        : targetAmount
      const riskNoteText = riskNotes.length ? ` | ${riskNotes.join(' ')}` : ''
      const cappedTargetAmount = capBuyAmount(asset, guardedTargetAmount, highConviction, `AI ${decision.horizon}: ${decision.reason}${riskNoteText}`)
      const capacityBlockReason = aiBuyCapacityBlockReason(asset, guardedTargetAmount, cappedTargetAmount, highConviction, !existing)
      if (capacityBlockReason) {
        addLog(`${capacityBlockReason} AI reason: ${decision.reason}`, 'medium')
        return {
          action: decision.action,
          label: assetLabel(decision.code),
          executed: false,
          reason: `${capacityBlockReason} AI原因：${decision.reason}`
        }
      }
      executed = buy(asset, cappedTargetAmount, `AI ${decision.horizon}: ${decision.reason}${riskNoteText}`, decision.horizon, snapshot)
    }
    if (executed && decision.action === 'sell') lastAiSellAtByCode.set(asset.code, Date.now())
    if (executed) notifyAiTrade(decision, asset)
    const actionText = decision.action === 'buy' ? '买入' : decision.action === 'sell' ? '卖出' : '观望'
    return {
      action: decision.action,
      label: assetLabel(decision.code),
      executed,
      reason: executed
        ? `${actionText}请求通过执行检查。AI原因：${decision.reason}`
        : `${actionText}请求未通过执行检查，可能受仓位、现金、一手数量、最低成交额、涨跌停、T+1 或价格风控约束。AI原因：${decision.reason}`
    }
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
      .filter((signal) => {
        const asset = assetMap.value.get(signal.code)
        return Boolean(asset && isBuyAllowedAsset(asset) && canBuySignal(signal))
      })
      .slice(0, MAX_BUYS_PER_TICK)
    for (const signal of buySignals) {
      const asset = assetMap.value.get(signal.code)
      if (!asset) continue
      const existing = positions.value.find((position) => position.code === signal.code)
      const cashCap = lowCashAwareBuyCap(cash.value)
      const preferredAmount = signal.reason.includes('visible momentum') ? MIN_BUY_AMOUNT : PREFERRED_BUY_AMOUNT
      const highConviction = convictionFromAsset(asset, signal.score)
      const targetAmount = existing
        ? Math.min(isIntradaySupportBuy(asset, existing) ? T_SUPPORT_BUY_AMOUNT : T_BUY_AMOUNT, Math.max(0, cash.value - 100))
        : Math.min(Math.max(totalAsset.value * signal.suggestedWeight, preferredAmount), cashCap)
      const cappedTargetAmount = capBuyAmount(asset, targetAmount, highConviction, signal.reason)
      if (buy(asset, cappedTargetAmount, signal.reason, signal.horizon, createTradeSnapshot({
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
      const executionResults: AiExecutionResult[] = []
      const processedDecisionKeys = new Set<string>()
      for (const decision of orderedDecisions) {
        const decisionKey = `${decision.action}:${decision.code}`
        if (processedDecisionKeys.has(decisionKey)) {
          executionResults.push({
            action: decision.action,
            label: assetLabel(decision.code),
            executed: false,
            reason: `同一轮 AI 已处理过 ${assetLabel(decision.code)} 的${decision.action === 'buy' ? '买入' : '卖出'}决策，跳过重复建议。AI原因：${decision.reason}`
          })
          continue
        }
        processedDecisionKeys.add(decisionKey)
        if (decision.action === 'buy' && executedAiBuys >= MAX_AI_BUYS_PER_TICK) {
          executionResults.push({
            action: decision.action,
            label: assetLabel(decision.code),
            executed: false,
            reason: `本轮 AI 买入数量已达到上限 ${MAX_AI_BUYS_PER_TICK}。AI原因：${decision.reason}`
          })
          continue
        }
        const result = executeAiDecision(decision)
        executionResults.push(result)
        if (result.executed) {
          executedAiTrades += 1
          if (decision.action === 'buy') executedAiBuys += 1
        }
      }
      updateAiExecutionBrief(executionResults)
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
    aiDecisionBriefFull,
    aiRequestDebugs,
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
    strategyPerformance,
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
