import type { MarketAsset, MarketIndex, NewsItem, Position, RiskLevel, StrategyHorizon, StrategySignal } from '~/types/trading'

const HORIZON_LABELS: Record<StrategyHorizon, string> = {
  long: 'conviction core',
  swing: 'swing',
  short: 'short momentum'
}
const SWING_SHAKEOUT_CONFIRM_MINUTE = 10 * 60 + 30
const SOFT_MAX_POSITION_COUNT = 5
type RotationOpportunityContext = {
  active: boolean
  bestName: string
  bestScore: number
  bestChangePct: number
  hotCount: number
}

function riskLevel(score: number): RiskLevel {
  if (score >= 62) return 'high'
  if (score >= 40) return 'medium'
  return 'low'
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value))
}

function inferHorizon(asset: MarketAsset, score: number, marketScore: number): StrategyHorizon {
  if (isConvictionTrend(asset, marketScore) && score >= 62) return 'long'
  if (score >= 78 && asset.riskScore <= 58 && marketScore >= 50) return 'long'
  if (asset.trendScore >= 68 && asset.sentimentScore >= 58 && asset.riskScore <= 64) return 'short'
  if (score >= 62 && asset.trendScore >= 54) return 'swing'
  return 'swing'
}

function targetWeight(asset: MarketAsset, horizon: StrategyHorizon, score: number, marketScore: number) {
  if (isRetailThemeBetaEtf(asset) && isResilientLeader(asset)) {
    return clamp(score / 330, 0.18, 0.32)
  }
  if (isVisibleMomentum(asset, marketScore)) {
    return clamp(score / 560, 0.1, 0.2)
  }
  if (horizon === 'long') {
    const base = score / 260
    return clamp(base * clamp(marketScore / 65, 0.7, 1.28), 0.2, 0.46)
  }
  if (horizon === 'swing') return clamp(score / 380, 0.14, 0.34)
  return clamp(score / 470, 0.12, 0.26)
}

function chasePenalty(asset: MarketAsset, marketScore: number) {
  if (isVisibleMomentum(asset, marketScore)) {
    return clamp((asset.changePct - 3.5) * 1.4, 0, 5)
  }
  const changePct = asset.changePct
  if (changePct <= 2.5) return 0
  return clamp((changePct - 2.5) * 4.5, 0, 18)
}

function fundFlowBoost(asset: MarketAsset) {
  return clamp((asset.mainNetInflowPct ?? 0) * 0.7 + (asset.superOrderNetInflowPct ?? 0) * 0.45 + (asset.bigOrderNetInflowPct ?? 0) * 0.3, -12, 14)
}

function volumeBoost(asset: MarketAsset) {
  return clamp(((asset.volumeRatio ?? 1) - 1) * 7, -8, 12)
}

function technicalBoost(asset: MarketAsset) {
  const technical = asset.technical
  if (!technical) return 0
  const trendAlignment =
    (technical.ma20 > technical.ma60 && technical.ma60 > technical.ma250 ? 6 : 0)
    + (technical.ma5 > technical.ma20 ? 3 : -2)
  const macdSignal =
    technical.macdDiff > technical.macdDea && technical.macdHist > 0
      ? 5
      : technical.macdDiff < technical.macdDea && technical.macdHist < 0
        ? -6
        : 0
  const breakoutSignal =
    (technical.isBreakout20 ? 3 : 0)
    + (technical.isBreakout60 ? 4 : 0)
    + (technical.isBreakout250 ? 5 : 0)
  const volumeSignal = clamp((technical.volumeSpike20 - 1) * 5, -4, 8)
  const rsiSignal = technical.rsi14 >= 78 ? -8 : technical.rsi14 <= 28 ? -3 : technical.rsi14 >= 45 && technical.rsi14 <= 68 ? 3 : 0
  const extensionPenalty = technical.closeVsMa20Pct > 14 || technical.closeVsMa60Pct > 24 ? -8 : 0
  const weakTrendPenalty = technical.isDeathCross ? -8 : 0
  return clamp(trendAlignment + macdSignal + breakoutSignal + volumeSignal + rsiSignal + extensionPenalty + weakTrendPenalty, -18, 20)
}

function relativeContextBoost(asset: MarketAsset) {
  const relativeStrength = typeof asset.relativeStrengthRank === 'number' ? (asset.relativeStrengthRank - 0.5) * 14 : 0
  const sectorStrength = typeof asset.sectorRank === 'number' ? (asset.sectorRank - 0.5) * 10 : 0
  const sectorMomentum = clamp((asset.sectorMomentum ?? 0) * 0.6, -6, 8)
  const breadth = (asset.sectorAssetCount ?? 0) >= 5 ? 2 : 0
  const valuationPenalty = asset.peRatio && asset.peRatio > 0 && asset.peRatio < 80 ? 0 : asset.kind === 'stock' ? -2 : 0
  return clamp(relativeStrength + sectorStrength + sectorMomentum + breadth + valuationPenalty, -14, 18)
}

function hasPositiveMoneyFlow(asset: MarketAsset) {
  return (asset.mainNetInflowPct ?? 0) > 0.8
    || (asset.superOrderNetInflowPct ?? 0) > 0.4
    || (asset.bigOrderNetInflowPct ?? 0) > 0.6
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

function isLeadingTheme(asset: MarketAsset) {
  return (asset.relativeStrengthRank ?? 0) >= 0.72
    && ((asset.sectorRank ?? 0) >= 0.62 || (asset.sectorMomentum ?? 0) >= 4)
}

function assetThemeText(asset: MarketAsset) {
  return `${asset.name}${asset.sector}${asset.industry ?? ''}${asset.concepts?.join('') ?? ''}`.toLowerCase()
}

function isRetailThemeBetaEtf(asset: MarketAsset) {
  if (asset.kind !== 'etf') return false
  const text = assetThemeText(asset)
  return /科创|芯片|半导体|集成电路|人工智能|ai|电子|信创|软件|机器人|算力/.test(text)
}

function isTechnologyThemeAsset(asset: MarketAsset) {
  const text = assetThemeText(asset)
  return /科创|芯片|半导体|集成电路|人工智能|ai|电子|信创|软件|机器人|算力|存储|cpo|光模块|服务器|液冷|pcb/.test(text)
}

function isBuyAllowedAsset(asset: Pick<MarketAsset, 'kind' | 'code' | 'sector'>) {
  if (asset.kind !== 'stock') return true
  return !asset.code.startsWith('30')
    && !asset.code.startsWith('688')
    && !asset.sector.includes('创业板')
    && !asset.sector.includes('科创板')
}

function isPanicToRepairSetup(asset: MarketAsset, marketScore: number) {
  const intraday = asset.intraday
  if (!intraday || hasHighVolumeBreakoutFadeRisk(asset) || failedIntradaySpikeReason(asset)) return false
  const deepPanic = asset.kind === 'etf'
    ? intraday.lowChangePct <= -1.6 || intraday.openChangePct <= -1.2
    : intraday.lowChangePct <= -3.2 || intraday.openChangePct <= -2.2
  const repairedPrice = intraday.currentVsVwapPct >= -0.15
    && intraday.last15MinChangePct >= 0.35
    && intraday.highPullbackPct > -4.5
    && (intraday.trend === 'recovering' || intraday.trend === 'strong_up' || asset.changePct >= -0.3)
  const repairedFlow = hasPositiveMoneyFlow(asset)
    || hasLargeOrderSupport(asset)
    || hasLargeOrderDivergenceSupport(asset)
  const resilientContext = marketAllowsOpportunity(asset, marketScore, 42, 30)
    || isRetailThemeBetaEtf(asset)
    || isLeadingTheme(asset)
  return deepPanic
    && repairedPrice
    && repairedFlow
    && resilientContext
    && (asset.volumeRatio ?? 1) >= 1.05
    && asset.riskScore <= 78
    && asset.price > asset.limitDown
    && asset.price < asset.limitUp
}

function themeBetaSignal(assets: MarketAsset[], indexes: MarketIndex[]) {
  const starIndex = indexes.find((item) => item.code.includes('000688') || item.name.includes('科创'))
  const themeEtfs = assets.filter(isRetailThemeBetaEtf)
  const technologyAssets = assets.filter(isTechnologyThemeAsset)
  const bestEtfChange = themeEtfs.reduce((best, asset) => Math.max(best, asset.changePct), -Infinity)
  const avgEtfChange = themeEtfs.length
    ? themeEtfs.reduce((sum, asset) => sum + asset.changePct, 0) / themeEtfs.length
    : -Infinity
  const hotEtfCount = themeEtfs.filter((asset) => (
    asset.changePct >= 2
    && (asset.volumeRatio ?? 1) >= 1.1
    && !hasHighVolumeBreakoutFadeRisk(asset)
  )).length
  const hotTechnologyCount = technologyAssets.filter((asset) => (
    asset.changePct >= (asset.kind === 'etf' ? 2 : 5)
    && (
      (asset.volumeRatio ?? 1) >= 1.2
      || hasPositiveMoneyFlow(asset)
      || (asset.relativeStrengthRank ?? 0) >= 0.72
    )
    && !hasHighVolumeBreakoutFadeRisk(asset)
  )).length
  const followThroughCount = technologyAssets.filter((asset) => (
    previousCompletedDailyChangePct(asset) >= (asset.kind === 'etf' ? 3.5 : 6)
    && asset.changePct >= (asset.kind === 'etf' ? 0.8 : 1.5)
    && (asset.volumeRatio ?? 1) >= 1.05
    && !hasHighVolumeBreakoutFadeRisk(asset)
  )).length
  const starLift = starIndex?.changePct ?? 0
  const active = (hotEtfCount >= 1 || hotTechnologyCount >= 3 || followThroughCount >= 2)
    && (
      starLift >= 2.5
      || bestEtfChange >= 3.2
      || (avgEtfChange >= 1.8 && hotEtfCount >= 2)
      || hotTechnologyCount >= 3
      || followThroughCount >= 2
    )
  return {
    active,
    starLift,
    bestEtfChange: Number.isFinite(bestEtfChange) ? bestEtfChange : 0,
    hotEtfCount,
    hotTechnologyCount,
    followThroughCount
  }
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
      hasPositiveMoneyFlow(asset)
      || hasLargeOrderSupport(asset)
      || (asset.volumeRatio ?? 1) >= 1.45
    )
    && constructiveTechnical
}

function marketAllowsOpportunity(asset: MarketAsset, marketScore: number, normalMin: number, resilientMin = 32) {
  return marketScore >= normalMin || (marketScore >= resilientMin && isResilientLeader(asset))
}

function isVisibleMomentum(asset: MarketAsset, marketScore: number) {
  const technical = asset.technical
  const breakout = Boolean(technical?.isBreakout20 || technical?.isBreakout60 || technical?.isBreakout250)
  const constructiveTechnical = !technical || (
    !technical.isDeathCross
    && technical.rsi14 < 88
    && technical.closeVsMa20Pct < 26
    && (
      technical.macdHist >= 0
      || technical.isGoldenCross
      || breakout
      || technical.volumeSpike20 >= 1.45
    )
  )
  const strongVolume = (asset.volumeRatio ?? 1) >= 1.45 || (technical?.volumeSpike20 ?? 1) >= 1.45
  const strongFlow = (asset.mainNetInflowPct ?? 0) >= 1.2
    || (asset.superOrderNetInflowPct ?? 0) >= 0.8
    || (asset.bigOrderNetInflowPct ?? 0) >= 1
  const strongRelativeContext = isLeadingTheme(asset)
    || (asset.relativeStrengthRank ?? 0) >= 0.82
    || (asset.sectorMomentum ?? 0) >= 6
  return marketAllowsOpportunity(asset, marketScore, 42, 34)
    && asset.changePct >= 2.6
    && asset.changePct <= 12.8
    && asset.trendScore >= 68
    && asset.sentimentScore >= 62
    && asset.liquidityScore >= 50
    && asset.riskScore <= 72
    && constructiveTechnical
    && strongVolume
    && strongFlow
    && strongRelativeContext
}

function isConvictionTrend(asset: MarketAsset, marketScore: number) {
  const technical = asset.technical
  const constructiveTechnical = !technical || (
    !technical.isDeathCross
    && technical.ma20 >= technical.ma60
    && (
      technical.ma5 >= technical.ma20
      || technical.isBreakout20
      || technical.isBreakout60
      || technical.volumeSpike20 >= 1.35
    )
  )
  return marketAllowsOpportunity(asset, marketScore, 42, 34)
    && asset.trendScore >= 62
    && asset.liquidityScore >= 52
    && asset.riskScore <= 74
    && isLeadingTheme(asset)
    && constructiveTechnical
    && (hasPositiveMoneyFlow(asset) || asset.trendScore >= 72)
}

function isStrongContinuation(asset: MarketAsset, marketScore: number) {
  const technical = asset.technical
  const constructiveTechnical = !technical || (
    !technical.isDeathCross
    && technical.rsi14 < 84
    && (
      technical.macdHist >= 0
      || technical.ma5 >= technical.ma20
      || technical.isBreakout20
      || technical.volumeSpike20 >= 1.25
    )
  )
  const strongFlow = hasPositiveMoneyFlow(asset)
    || ((asset.mainNetInflowPct ?? 0) > 0 && (asset.bigOrderNetInflowPct ?? 0) > 0)
  return marketAllowsOpportunity(asset, marketScore, 38, 32)
    && asset.trendScore >= 62
    && asset.sentimentScore >= 58
    && asset.riskScore <= 76
    && constructiveTechnical
    && (strongFlow || isLeadingTheme(asset))
}

function speculationPenalty(asset: MarketAsset) {
  const highTurnover = (asset.turnoverRate ?? 0) > 18
  const smallFloat = asset.floatMarketCap ? asset.floatMarketCap < 5_000_000_000 : false
  const overheated = asset.changePct > 5 || (asset.technical?.rsi14 ?? 0) > 82
  if (highTurnover && smallFloat && overheated) return 8
  if (highTurnover && overheated) return 4
  return 0
}

function bottomBoost(asset: MarketAsset) {
  const score = asset.bottomScore ?? 0
  if (score < 48) return 0
  return clamp((score - 48) * 0.26, 0, 12)
}

function isSupportedBottomBuy(asset: MarketAsset) {
  const positiveFlow = (asset.mainNetInflowPct ?? 0) > 0
    || (asset.superOrderNetInflowPct ?? 0) > 0
    || (asset.bigOrderNetInflowPct ?? 0) > 0
  return !hasHighVolumeBreakoutFadeRisk(asset)
    && (asset.bottomScore ?? 0) >= 62
    && positiveFlow
    && (asset.volumeRatio ?? 1) >= 1.05
    && asset.changePct > -3.5
    && asset.changePct <= 2.6
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

function hasConfirmedTrendDamage(asset: MarketAsset, bottomRepairProtected = isBottomRepairProtected(asset)) {
  const technical = asset.technical
  const technicalDamage = Boolean(technical?.isDeathCross && technical.macdHist < 0 && technical.ma5 < technical.ma20)
  const flowFailure = (asset.mainNetInflowPct ?? 0) < -6 && (asset.bigOrderNetInflowPct ?? 0) < -1.5 && (asset.superOrderNetInflowPct ?? 0) < -1
  const sectorRollover = (asset.sectorRank ?? 1) < 0.3 && (asset.sectorMomentum ?? 0) < -3
  return asset.riskScore >= 86
    || asset.trendScore < (bottomRepairProtected ? 30 : 42)
    || (technicalDamage && (flowFailure || sectorRollover || asset.trendScore < 50))
}

function currentChinaMinute() {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Shanghai',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  }).formatToParts(new Date())
  const get = (type: string) => Number(parts.find((part) => part.type === type)?.value ?? 0)
  return get('hour') * 60 + get('minute')
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

function isSwingMorningShakeoutProtected(asset: MarketAsset, position: Position, marketScore: number) {
  const intraday = asset.intraday
  if (position.horizon !== 'swing' || !intraday) return false
  const earlyWindow = currentChinaMinute() <= SWING_SHAKEOUT_CONFIRM_MINUTE || intraday.points <= 65
  const intradayWeak = intraday.trend === 'weak_down'
    || (intraday.currentVsVwapPct <= -0.8 && intraday.last15MinChangePct <= -0.6)
  const sectorStillSupported = marketScore >= 45
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

function distancePct(price: number, anchor: number) {
  if (!price || !anchor || anchor <= 0) return Number.POSITIVE_INFINITY
  return (price - anchor) / price * 100
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
  if (!supports.length) return Number.POSITIVE_INFINITY
  return Math.min(...supports.map((value) => distancePct(price, value)))
}

function nearestPressureDistancePct(asset: MarketAsset) {
  const price = asset.price
  const technical = asset.technical
  const pressures = [
    technical?.high20,
    technical?.high60,
    technical?.high250,
    asset.limitUp
  ].filter((value): value is number => Boolean(value && value > 0 && value >= price))
  if (!pressures.length) return Number.POSITIVE_INFINITY
  return Math.min(...pressures.map((value) => (value - price) / price * 100))
}

function isIntradaySupportBuy(asset: MarketAsset, position?: Position) {
  const technical = asset.technical
  const supportDistance = nearestSupportDistancePct(asset)
  const pullbackFromBest = position?.highestPrice
    ? (asset.price - position.highestPrice) / Math.max(position.highestPrice, 1) * 100
    : 0
  const constructiveFlow = hasPositiveMoneyFlow(asset)
    || ((asset.mainNetInflowPct ?? 0) > 0 && (asset.bigOrderNetInflowPct ?? 0) >= -0.3)
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
      supportDistance <= 1.25
      || pullbackFromBest <= -1.6
      || (asset.bottomScore ?? 0) >= 62
    )
}

function intradayPressureReason(asset: MarketAsset) {
  const technical = asset.technical
  const pressureDistance = nearestPressureDistancePct(asset)
  const extended = Boolean(technical && (technical.rsi14 >= 76 || technical.closeVsMa20Pct >= 10 || technical.closeVsMa60Pct >= 18))
  const flowSoftening = (asset.mainNetInflowPct ?? 0) < -0.8 || (asset.bigOrderNetInflowPct ?? 0) < -0.5
  const nearResistance = pressureDistance <= 1.1
  const overheat = asset.changePct >= 4.2 || (asset.turnoverRate ?? 0) >= 16
  if (nearResistance && (extended || flowSoftening || overheat)) {
    return `T pressure near resistance ${pressureDistance.toFixed(2)}% away`
  }
  if (asset.changePct >= 3.2 && extended && flowSoftening) {
    return `T pressure after extended intraday push`
  }
  return ''
}

function failedIntradaySpikeReason(asset: MarketAsset) {
  const intraday = asset.intraday
  if (!intraday) return ''
  const moneyFlowWeak = (asset.mainNetInflowPct ?? 0) < 0
    || (asset.bigOrderNetInflowPct ?? 0) < -0.4
    || (asset.superOrderNetInflowPct ?? 0) < -0.4
  const failedStrongOpen = intraday.turnedGreenAfterStrongOpen
    || (
      intraday.first30MinHighChangePct >= 4.5
      && intraday.fadeFromFirst30HighPct <= -3.5
      && intraday.currentVsVwapPct < -0.4
    )
  const failedHigh = intraday.highChangePct >= 5
    && intraday.highPullbackPct <= -3.5
    && intraday.currentVsVwapPct < -0.4
    && intraday.last15MinChangePct < -0.3
  if ((failedStrongOpen || failedHigh || intraday.trend === 'fade') && moneyFlowWeak) {
    return `failed intraday spike: high ${intraday.highChangePct.toFixed(2)}%, pullback ${intraday.highPullbackPct.toFixed(2)}%, vs VWAP ${intraday.currentVsVwapPct.toFixed(2)}%`
  }
  return ''
}

function previousCompletedDailyChangePct(asset: MarketAsset) {
  const closes = asset.technical?.closes ?? asset.kline
  if (closes.length < 3) return 0
  const previousClose = closes[closes.length - 3]
  const completedClose = closes[closes.length - 2]
  if (!previousClose || !completedClose || previousClose <= 0) return 0
  return (completedClose - previousClose) / previousClose * 100
}

function isTechPanicReboundFollowThrough(asset: MarketAsset, marketScore: number) {
  if (!isTechnologyThemeAsset(asset) || hasHighVolumeBreakoutFadeRisk(asset) || failedIntradaySpikeReason(asset)) return false
  const previousSurge = previousCompletedDailyChangePct(asset) >= (asset.kind === 'etf' ? 3.5 : 6)
  const todayConfirm = asset.changePct >= (asset.kind === 'etf' ? 0.8 : 1.5)
    && asset.changePct <= (asset.kind === 'etf' ? 9.8 : 12.8)
    && (asset.volumeRatio ?? 1) >= 1.05
  const broadContext = marketAllowsOpportunity(asset, marketScore, 38, 30)
    || (asset.relativeStrengthRank ?? 0) >= 0.72
    || (asset.sectorRank ?? 0) >= 0.62
    || (asset.sectorMomentum ?? 0) >= 4
  const confirmedFlow = hasPositiveMoneyFlow(asset)
    || hasLargeOrderSupport(asset)
    || (asset.volumeRatio ?? 1) >= 1.35
  const intradayOk = !asset.intraday
    || (
      asset.intraday.trend !== 'fade'
      && asset.intraday.currentVsVwapPct >= -0.35
      && asset.intraday.last15MinChangePct >= -0.45
      && asset.intraday.highPullbackPct > -4.5
    )
  const technicalOk = !asset.technical
    || (
      !asset.technical.isDeathCross
      || asset.technical.macdHist >= 0
      || asset.technical.ma5 >= asset.technical.ma20
      || asset.technical.volumeSpike20 >= 1.45
    )
  return previousSurge
    && todayConfirm
    && broadContext
    && confirmedFlow
    && intradayOk
    && technicalOk
    && asset.riskScore <= 80
    && asset.price > asset.limitDown
    && asset.price < asset.limitUp
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

function trendAssessmentSellReason(asset: MarketAsset) {
  const trend = asset.trendAssessment
  if (!trend || trend.confidence < 0.58) return ''
  if (trend.phase === 'failed_spike' || trend.phase === 'distribution') {
    return `trend assessment ${trend.phase}: score ${trend.score}, warnings ${trend.warnings.join('; ') || 'multi-factor fade'}`
  }
  if (trend.direction === 'down' && trend.confidence >= 0.68 && trend.components.moneyFlow < 42 && trend.components.daily < 45) {
    return `trend assessment down: score ${trend.score}, daily ${trend.components.daily}, money flow ${trend.components.moneyFlow}`
  }
  if (trend.direction === 'fading' && trend.confidence >= 0.72 && trend.components.intraday < 35 && trend.components.moneyFlow < 45) {
    return `trend assessment fading: intraday ${trend.components.intraday}, money flow ${trend.components.moneyFlow}`
  }
  return ''
}

function rotationOpportunityScore(asset: MarketAsset, marketScore: number) {
  if ((!marketAllowsOpportunity(asset, marketScore, 44, 32)) || failedIntradaySpikeReason(asset) || hasHighVolumeBreakoutFadeRisk(asset)) return 0
  const technical = asset.technical
  const bottomReversal = (asset.bottomScore ?? 0) >= 62
    && asset.changePct >= 2.2
    && (asset.volumeRatio ?? 1) >= 1.25
    && (hasPositiveMoneyFlow(asset) || hasLargeOrderSupport(asset))
  const themeLift = isLeadingTheme(asset)
    && asset.changePct >= 2
    && asset.trendScore >= 58
    && (hasPositiveMoneyFlow(asset) || (asset.volumeRatio ?? 1) >= 1.45)
  const breakoutLift = Boolean(technical?.isBreakout20 || technical?.isBreakout60 || technical?.isBreakout250)
    && asset.changePct >= 1.8
    && (asset.volumeRatio ?? 1) >= 1.25
  if (!bottomReversal && !themeLift && !breakoutLift && !isVisibleMomentum(asset, marketScore)) return 0

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

function buildRotationOpportunityContext(assets: MarketAsset[], positionCodes: Set<string>, marketScore: number): RotationOpportunityContext {
  const candidates = assets
    .filter((asset) => !positionCodes.has(asset.code))
    .map((asset) => ({
      asset,
      score: rotationOpportunityScore(asset, marketScore)
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

function opportunityCostExitReason(
  asset: MarketAsset,
  position: Position,
  marketScore: number,
  rotationContext: RotationOpportunityContext,
  protectedCore: boolean,
  strongContinuation: boolean,
  bottomRepairProtected: boolean,
  exitGradeDamage: boolean
) {
  const trend = asset.trendAssessment
  const technical = asset.technical
  const heldOpportunityScore = rotationOpportunityScore(asset, marketScore)
  const exceptionalRotationWindow = rotationContext.bestScore >= 84
    && rotationContext.bestChangePct >= 4
    && rotationContext.hotCount >= 1
  const weaknessCount = [
    asset.changePct <= Math.min(1.2, rotationContext.bestChangePct - 2.8),
    heldOpportunityScore + 18 < rotationContext.bestScore,
    asset.trendScore < 58 || trend?.direction === 'fading' || trend?.direction === 'sideways',
    (asset.relativeStrengthRank ?? 0.5) < 0.55,
    (asset.sectorRank ?? 0.5) < 0.5 && (asset.sectorMomentum ?? 0) < 2,
    !hasPositiveMoneyFlow(asset) && !hasLargeOrderSupport(asset),
    Boolean(technical?.isDeathCross || (technical && technical.closeVsMa20Pct < -4))
  ].filter(Boolean).length

  if (
    !rotationContext.active
    || marketScore < (exceptionalRotationWindow ? 34 : 44)
    || (!exceptionalRotationWindow && position.floatingPnlPct >= 6 && position.highestPnlPct - position.floatingPnlPct < 3)
    || position.floatingPnlPct <= (exceptionalRotationWindow ? -7 : -5)
    || (protectedCore && !exceptionalRotationWindow)
    || (strongContinuation && !exceptionalRotationWindow)
    || (bottomRepairProtected && !exceptionalRotationWindow)
    || exitGradeDamage
    || weaknessCount < (exceptionalRotationWindow ? 2 : 3)
  ) return ''

  return `${exceptionalRotationWindow ? 'exceptional ' : ''}rotation opportunity cost: ${rotationContext.hotCount} stronger candidates led by ${rotationContext.bestName} (${rotationContext.bestChangePct.toFixed(2)}%, score ${Math.round(rotationContext.bestScore)}); current holding lags with ${weaknessCount}/7 weak relative factors`
}

function shouldSellPosition(asset: MarketAsset, position: Position, marketScore: number, rotationContext: RotationOpportunityContext) {
  const pnlPct = position.floatingPnlPct
  const drawdownFromBest = position.highestPnlPct - pnlPct
  const convictionTrend = isConvictionTrend(asset, marketScore)
  const protectedCore = convictionTrend
    && (
      position.horizon === 'long'
      || position.highestPnlPct >= 8
      || isLeadingTheme(asset)
    )
  const bottomRepairProtected = isBottomRepairProtected(asset) && !hasConfirmedTrendDamage(asset, true)
  const riskHorizon = protectedCore ? 'long' : position.horizon
  const strongContinuation = isStrongContinuation(asset, marketScore)
  const trendBreak = asset.trendScore < (riskHorizon === 'long' ? (convictionTrend ? 30 : 36) : riskHorizon === 'swing' ? 44 : 50)
  const fundOutflow = (asset.mainNetInflowPct ?? 0) < (protectedCore ? -7 : -4) && (asset.bigOrderNetInflowPct ?? 0) < (protectedCore ? -4 : -2)
  const hardStop = pnlPct <= (bottomRepairProtected
    ? -9
    : riskHorizon === 'long' ? (strongContinuation ? -16 : -10) : riskHorizon === 'swing' ? -6 : -3.5)
  const weakLoss = pnlPct <= (riskHorizon === 'long' ? -8 : riskHorizon === 'swing' ? -5 : -3.5) && trendBreak
  const riskExit = asset.riskScore >= (riskHorizon === 'long' ? (convictionTrend ? 94 : 84) : riskHorizon === 'swing' ? 76 : 70)
  const technicalExit = asset.technical?.isDeathCross && (asset.technical?.macdHist ?? 0) < 0 && asset.trendScore < (riskHorizon === 'long' ? 48 : 56)
  const marketRiskExit = marketScore < 38 && asset.changePct < -2.8 && asset.trendScore < (riskHorizon === 'long' ? 44 : 56)
  const exitGradeMoneyFlowFailure = (asset.mainNetInflowPct ?? 0) < -5
    && (asset.bigOrderNetInflowPct ?? 0) < -1.5
    && (asset.superOrderNetInflowPct ?? 0) < -1
  const exitGradeTechnicalFailure = Boolean(asset.technical?.isDeathCross && (asset.technical?.macdHist ?? 0) < 0 && asset.trendScore < 50)
  const exitGradeSectorFailure = (asset.sectorRank ?? 1) < 0.28 && (asset.sectorMomentum ?? 0) < -3
  const exitGradeDamage = riskExit
    || (exitGradeTechnicalFailure && (exitGradeMoneyFlowFailure || exitGradeSectorFailure))
    || (trendBreak && exitGradeMoneyFlowFailure)
  const swingShakeoutProtected = isSwingMorningShakeoutProtected(asset, position, marketScore) && !exitGradeDamage
  const profitRunnerProtected = protectedCore && strongContinuation && !exitGradeDamage
  const intradayFlowFade = (asset.mainNetInflowPct ?? 0) < -0.8 && (asset.bigOrderNetInflowPct ?? 0) < -0.4
  const intradayOverheat = asset.changePct >= (riskHorizon === 'short' ? 5.8 : 6.5)
    || (asset.technical?.rsi14 ?? 0) >= 82
    || (asset.technical?.closeVsMa20Pct ?? 0) >= 14
  const intradayStrengthTrim = !profitRunnerProtected
    && asset.changePct >= (riskHorizon === 'short' ? 5.4 : 6.2)
    && pnlPct >= (riskHorizon === 'short' ? 2 : 3)
    && intradayOverheat
    && (
      nearestPressureDistancePct(asset) <= 1.2
      || intradayFlowFade
      || (!strongContinuation && (asset.turnoverRate ?? 0) >= 14)
    )
  const trailingTakeProfit =
    (riskHorizon === 'long' && (
      convictionTrend
        ? position.highestPnlPct >= 35 && drawdownFromBest >= 14 && asset.trendScore < 44 && fundOutflow
        : position.highestPnlPct >= 18 && drawdownFromBest >= 8 && asset.trendScore < 48
    ))
    || (riskHorizon === 'swing' && position.highestPnlPct >= 9 && drawdownFromBest >= (strongContinuation ? 7 : 4))
    || (riskHorizon === 'short' && position.highestPnlPct >= 4 && drawdownFromBest >= (strongContinuation ? 3.6 : 1.8))
  const intradayTTrim = !profitRunnerProtected
    && pnlPct >= (riskHorizon === 'short' ? 3.5 : 6)
    && asset.changePct >= (riskHorizon === 'short' ? 3.5 : 4.8)
    && Boolean(intradayPressureReason(asset))
    && (intradayFlowFade || (asset.technical?.rsi14 ?? 0) >= 80)
  const pressureReason = intradayPressureReason(asset)
  const failedSpikeReason = failedIntradaySpikeReason(asset)
  const trendSellReason = trendAssessmentSellReason(asset)
  const opportunityExitReason = opportunityCostExitReason(asset, position, marketScore, rotationContext, protectedCore, strongContinuation, bottomRepairProtected, exitGradeDamage)
  const intradayPressureTrim = Boolean(pressureReason)
    && pnlPct >= (riskHorizon === 'short' ? 1.6 : 2.4)
    && !protectedCore
  const shortFade = !protectedCore && position.horizon === 'short' && asset.changePct < -2.8 && asset.trendScore < 58

  if (hardStop) return { sell: true, ratio: strongContinuation ? 0.5 : 1, reason: `hard stop ${pnlPct.toFixed(2)}% with ${strongContinuation ? 'trend still partly alive' : 'weak tape'}` }
  if (riskExit) return { sell: true, ratio: 1, reason: `risk score ${asset.riskScore}` }
  if (swingShakeoutProtected) return { sell: false, ratio: 0, reason: '' }
  if (technicalExit && !convictionTrend) return { sell: true, ratio: bottomRepairProtected ? 0.2 : riskHorizon === 'long' ? 0.3 : 0.5, reason: `technical trend break` }
  if (fundOutflow && trendBreak) return { sell: true, ratio: riskHorizon === 'long' ? 0.3 : 0.5, reason: `large-order outflow ${((asset.mainNetInflowPct ?? 0)).toFixed(2)}%` }
  if (trendSellReason) return { sell: true, ratio: protectedCore ? 0.25 : strongContinuation ? 0.35 : 0.55, reason: trendSellReason }
  if (failedSpikeReason) return { sell: true, ratio: protectedCore ? 0.25 : strongContinuation ? 0.35 : 0.55, reason: failedSpikeReason }
  if (intradayStrengthTrim) return { sell: true, ratio: strongContinuation ? 0.25 : 0.35, reason: `intraday spike trim ${asset.changePct.toFixed(2)}%; protect gain before possible fade` }
  if (intradayPressureTrim) return { sell: true, ratio: 0.25, reason: `${pressureReason}; trim and wait for support buyback` }
  if (intradayTTrim) return { sell: true, ratio: 0.25, reason: `T trim into strength; trend and money flow still confirmed` }
  if (trailingTakeProfit) return { sell: true, ratio: strongContinuation ? 0.25 : riskHorizon === 'long' ? 0.35 : 0.65, reason: `trailing profit drawdown ${drawdownFromBest.toFixed(2)}%; continuation ${strongContinuation ? 'still strong, keep core' : 'failed'}` }
  if (opportunityExitReason) {
    const exceptionalRotation = opportunityExitReason.startsWith('exceptional ')
    return { sell: true, ratio: riskHorizon === 'long' ? (exceptionalRotation ? 0.4 : 0.25) : pnlPct <= -1.5 ? (exceptionalRotation ? 0.6 : 0.45) : (exceptionalRotation ? 0.5 : 0.35), reason: opportunityExitReason }
  }
  if (bottomRepairProtected && (weakLoss || marketRiskExit || shortFade)) return { sell: false, ratio: 0, reason: '' }
  if (weakLoss) return { sell: true, ratio: riskHorizon === 'long' ? 0.3 : 0.5, reason: `loss with trend break ${pnlPct.toFixed(2)}%` }
  if (marketRiskExit) return { sell: true, ratio: riskHorizon === 'long' ? 0.3 : 0.5, reason: `market risk score ${Math.round(marketScore)}` }
  if (shortFade) return { sell: true, ratio: 0.5, reason: `short momentum faded` }

  return { sell: false, ratio: 0, reason: '' }
}

export function useStrategy() {
  const scoreMarket = (indexes: MarketIndex[], news: NewsItem[]) => {
    if (!indexes.length) return 50

    const indexScores = indexes.map((item) => (
      50
      + item.changePct * 9
      + (item.breadth - 50) * 0.35
      + (item.volumeRatio - 1) * 12
    ))
    const averageIndexScore = indexScores.reduce((sum, value) => sum + value, 0) / indexes.length
    const leaderIndexScore = Math.max(...indexScores)
    const indexScore = leaderIndexScore - averageIndexScore >= 12
      ? averageIndexScore * 0.68 + leaderIndexScore * 0.32
      : averageIndexScore
    const newsScore = news.length
      ? 50 + news.reduce((sum, item) => sum + item.impact, 0) / news.length * 0.35
      : 50
    return clamp(indexScore * 0.72 + newsScore * 0.28, 0, 100)
  }

  const generateSignals = (
    assets: MarketAsset[],
    indexes: MarketIndex[],
    news: NewsItem[],
    positions: Position[],
    totalAsset: number
  ): StrategySignal[] => {
    const marketScore = scoreMarket(indexes, news)
    const positionMap = new Map(positions.map((position) => [position.code, position]))
    const themeBeta = themeBetaSignal(assets, indexes)
    const rotationContext = buildRotationOpportunityContext(assets, new Set(positionMap.keys()), marketScore)

    return assets
      .map((asset) => {
        const rawScore =
          asset.trendScore * 0.29
          + asset.sentimentScore * 0.17
          + asset.liquidityScore * 0.18
          + marketScore * 0.18
          + bottomBoost(asset)
          + fundFlowBoost(asset) * 0.82
          + volumeBoost(asset) * 0.78
          + technicalBoost(asset)
          + relativeContextBoost(asset)
          + (themeBeta.active && isRetailThemeBetaEtf(asset) ? clamp(themeBeta.starLift * 2.4 + themeBeta.bestEtfChange * 2.2 + themeBeta.hotEtfCount * 3, 0, 22) : 0)
          + (themeBeta.active && isTechnologyThemeAsset(asset) ? clamp(themeBeta.hotTechnologyCount * 2 + themeBeta.followThroughCount * 3, 0, 18) : 0)
          + (isTechPanicReboundFollowThrough(asset, marketScore) ? 16 : 0)
          + (isPanicToRepairSetup(asset, marketScore) ? 14 : 0)
          + ((asset.trendAssessment?.score ?? 50) - 50) * 0.35
          - asset.riskScore * 0.18
          - (hasHighVolumeBreakoutFadeRisk(asset) ? 18 : 0)
          + clamp(asset.changePct, -3, 2.5) * 0.45
          - chasePenalty(asset, marketScore)
          - speculationPenalty(asset)
        const score = clamp(Math.round(Number.isFinite(rawScore) ? rawScore : 0), 0, 100)
        const position = positionMap.get(asset.code)
        const horizon = position?.horizon ?? (isConvictionTrend(asset, marketScore) && score >= 62 ? 'long' : inferHorizon(asset, score, marketScore))
        const sellDecision = position ? shouldSellPosition(asset, position, marketScore, rotationContext) : { sell: false, ratio: 0, reason: '' }
        const visibleMomentum = isVisibleMomentum(asset, marketScore)
        const breakoutFadeRisk = hasHighVolumeBreakoutFadeRisk(asset)
        const failedSpike = Boolean(failedIntradaySpikeReason(asset)) || breakoutFadeRisk
        const trendAssessment = asset.trendAssessment
        const techReboundSetup = isTechPanicReboundFollowThrough(asset, marketScore)
        const trendBlocksBuy = Boolean(trendAssessment && (
          trendAssessment.phase === 'failed_spike'
          || trendAssessment.phase === 'distribution'
          || trendAssessment.direction === 'down'
          || (trendAssessment.direction === 'fading' && trendAssessment.confidence >= 0.6)
        ) && trendAssessment.phase !== 'bottoming' && !techReboundSetup)
        const trendAllowsBuy = !trendAssessment
          || trendAssessment.direction === 'up'
          || trendAssessment.direction === 'strong_up'
          || (trendAssessment.phase === 'bottoming' && trendAssessment.components.moneyFlow >= 50)
          || (trendAssessment.phase === 'pullback' && trendAssessment.score >= 52 && trendAssessment.components.moneyFlow >= 48)
        const notOverheated = visibleMomentum || asset.changePct < (horizon === 'short' ? 4.5 : 3.2)
        const technical = asset.technical
        const technicalSupport = !technical || (
          (!technical.isDeathCross || techReboundSetup)
          && technical.rsi14 < (visibleMomentum ? 86 : 78)
          && technical.closeVsMa20Pct < (visibleMomentum ? 22 : 16)
          && (
            technical.macdHist >= 0
            || technical.isGoldenCross
            || technical.isBreakout20
            || technical.volumeSpike20 >= 1.35
            || techReboundSetup
          )
        )
        const supportedBottom = isSupportedBottomBuy(asset)
        const panicRepairBuy = !position
          && isPanicToRepairSetup(asset, marketScore)
          && score >= (isRetailThemeBetaEtf(asset) ? 58 : 62)
          && asset.riskScore <= 78
          && technicalSupport
        const themeBetaBuy = !position
          && themeBeta.active
          && isRetailThemeBetaEtf(asset)
          && score >= 60
          && asset.riskScore <= 78
          && asset.changePct >= 1.2
          && asset.changePct <= 12.8
          && asset.price > asset.limitDown
          && asset.price < asset.limitUp
          && technicalSupport
          && (
            hasPositiveMoneyFlow(asset)
            || hasLargeOrderSupport(asset)
            || (asset.volumeRatio ?? 1) >= 1.25
          )
          && (!asset.intraday || (
            asset.intraday.trend !== 'fade'
            && asset.intraday.currentVsVwapPct >= -0.3
            && asset.intraday.last15MinChangePct >= -0.35
          ))
        const techPanicReboundBuy = !position
          && themeBeta.active
          && techReboundSetup
          && score >= (asset.kind === 'etf' ? 58 : 64)
          && asset.riskScore <= 80
          && technicalSupport
        const longBuy = horizon === 'long' && marketAllowsOpportunity(asset, marketScore, 48, 34) && score >= 60 && asset.riskScore <= 58 && notOverheated && technicalSupport
        const swingBuy = horizon === 'swing' && marketAllowsOpportunity(asset, marketScore, 50, 34) && score >= 66 && asset.riskScore <= 66 && (notOverheated || supportedBottom) && technicalSupport
        const shortBuy = horizon === 'short' && marketAllowsOpportunity(asset, marketScore, 55, 36) && score >= 72 && asset.riskScore <= 64 && asset.changePct > 0.3 && notOverheated && technicalSupport
        const bottomBuy = supportedBottom && marketAllowsOpportunity(asset, marketScore, 45, 32) && score >= 64 && asset.riskScore <= 70 && asset.price > asset.limitDown && technicalSupport
        const chaseBuy = visibleMomentum && score >= 74 && asset.changePct <= 12.8 && asset.price > asset.limitDown && asset.price < asset.limitUp
        const selectiveTrendBuy = !position
          && Boolean(trendAssessment)
          && marketAllowsOpportunity(asset, marketScore, 38, 32)
          && score >= 60
          && asset.riskScore <= 72
          && technicalSupport
          && (trendAssessment?.direction === 'up' || trendAssessment?.direction === 'strong_up')
          && (trendAssessment?.score ?? 0) >= 62
          && (trendAssessment?.confidence ?? 0) >= 0.56
          && (trendAssessment?.components.moneyFlow ?? 0) >= 48
          && asset.changePct < 4.8
        const bottomingTrendBuy = !position
          && trendAssessment?.phase === 'bottoming'
          && marketAllowsOpportunity(asset, marketScore, 35, 30)
          && score >= 58
          && asset.riskScore <= 76
          && technicalSupport
          && trendAssessment.components.moneyFlow >= 52
          && asset.changePct <= 2.8
        const pullbackFromHighPct = position?.highestPrice
          ? (asset.price - position.highestPrice) / Math.max(position.highestPrice, 1) * 100
          : 0
        const tBuySetup = supportedBottom
          || isIntradaySupportBuy(asset, position)
          || (asset.changePct <= 0.8 && hasPositiveMoneyFlow(asset))
          || (asset.changePct <= 1.8 && (position?.floatingPnlPct ?? 0) <= -1.2 && hasPositiveMoneyFlow(asset))
          || (asset.changePct <= 1.8 && pullbackFromHighPct <= -1.2 && hasPositiveMoneyFlow(asset))
        const tBuy = Boolean(position)
          && marketScore >= 38
          && score >= 62
          && asset.riskScore <= 72
          && technicalSupport
          && isStrongContinuation(asset, marketScore)
          && asset.changePct <= (isIntradaySupportBuy(asset, position) ? 2.8 : supportedBottom ? 2.6 : 1.8)
          && tBuySetup
        const focusedPortfolioAllowsNewBuy = Boolean(position)
          || positionMap.size < SOFT_MAX_POSITION_COUNT
          || (
            score >= 78
            && (
              rotationOpportunityScore(asset, marketScore) >= 76
              || isConvictionTrend(asset, marketScore)
              || visibleMomentum
            )
          )
        const buyAccessAllowed = position || isBuyAllowedAsset(asset)
        const shouldBuy = buyAccessAllowed && !failedSpike && !breakoutFadeRisk && !trendBlocksBuy && trendAllowsBuy && asset.price < asset.limitUp && focusedPortfolioAllowsNewBuy && ((!position && (longBuy || swingBuy || shortBuy || bottomBuy || chaseBuy || themeBetaBuy || techPanicReboundBuy || panicRepairBuy || selectiveTrendBuy || bottomingTrendBuy)) || tBuy)
        const action = sellDecision.sell ? 'sell' : shouldBuy ? 'buy' : 'hold'
        const suggestedWeight = targetWeight(asset, horizon, score, marketScore)

        return {
          code: asset.code,
          name: asset.name,
          action,
          horizon,
          score,
          risk: riskLevel(asset.riskScore),
          suggestedWeight,
          sellRatio: sellDecision.ratio,
          reason: buildReason(asset, marketScore, totalAsset, action, horizon, sellDecision.reason)
        }
      })
      .sort((a, b) => b.score - a.score)
  }

  return {
    scoreMarket,
    generateSignals
  }
}

function buildReason(
  asset: MarketAsset,
  marketScore: number,
  totalAsset: number,
  action: StrategySignal['action'],
  horizon: StrategyHorizon,
  sellReason: string
) {
  const trendAssessment = asset.trendAssessment
  const trendText = trendAssessment
    ? `, trend assessment ${trendAssessment.direction}/${trendAssessment.phase} score ${trendAssessment.score} confidence ${(trendAssessment.confidence * 100).toFixed(0)}%`
    : ''
  const base = `${HORIZON_LABELS[horizon]} | trend ${asset.trendScore}, sentiment ${asset.sentimentScore}, liquidity ${asset.liquidityScore}, risk ${asset.riskScore}, market ${Math.round(marketScore)}, bottom ${asset.bottomScore ?? 0}, volume ratio ${(asset.volumeRatio ?? 1).toFixed(2)}, main net ${((asset.mainNetInflowPct ?? 0)).toFixed(2)}%, big net ${((asset.bigOrderNetInflowPct ?? 0)).toFixed(2)}%${trendText}`
  if (action === 'buy' && isTechPanicReboundFollowThrough(asset, marketScore)) return `${base}. technology panic-rebound follow-through: prior session strong reversal and today confirms with volume/relative/theme support; execute eligible ETF or main-board proxy from simulated NAV ${Math.round(totalAsset)}.`
  if (action === 'buy' && isVisibleMomentum(asset, marketScore)) return `${base}. visible momentum chase: breakout/volume/money-flow/relative-strength conditions confirm the move; use smaller risk-budgeted allocation from simulated NAV ${Math.round(totalAsset)}.`
  if (action === 'buy') return `${base}. Risk-budgeted allocation from simulated NAV ${Math.round(totalAsset)}.`
  if (action === 'sell') return `${base}. Exit: ${sellReason}.`
  return `${base}. Hold/watch until score, risk or drawdown changes.`
}
