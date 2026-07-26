import type { MarketAsset, Position } from '~/types/trading'

type BehavioralTrapLevel = 'low' | 'medium' | 'high'

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value))
}

function round(value: number, digits = 2) {
  const factor = 10 ** digits
  return Math.round(value * factor) / factor
}

function pct(value: number | undefined) {
  return typeof value === 'number' && Number.isFinite(value) ? round(value) : undefined
}

function recentDailyChangePcts(asset: MarketAsset, limit = 3) {
  const closes = asset.technical?.closes ?? asset.kline
  const changes: number[] = []
  for (let index = Math.max(1, closes.length - limit - 1); index < closes.length; index += 1) {
    const previous = closes[index - 1]
    const current = closes[index]
    if (previous > 0 && current > 0) changes.push(round((current - previous) / previous * 100))
  }
  return changes.slice(-limit)
}

function assessTwoDaySurge(asset: MarketAsset) {
  const changes = recentDailyChangePcts(asset, 3)
  const lastTwo = changes.slice(-2)
  const threshold = asset.kind === 'etf' ? 1.8 : 3
  const combined = lastTwo.reduce((sum, value) => sum + Math.max(0, value), 0)
  const active = lastTwo.length >= 2 && (
    lastTwo.every((value) => value >= threshold)
    || combined >= (asset.kind === 'etf' ? 4.5 : 7)
  )
  const confirmingStrength = (
    asset.changePct <= 1.8
    && (
      (asset.mainNetInflowPct ?? 0) > 0
      || (asset.superOrderNetInflowPct ?? 0) > 0
      || (asset.bigOrderNetInflowPct ?? 0) > 0
    )
    && ((asset.sectorRank ?? 0) >= 0.6 || (asset.sectorMomentum ?? 0) >= 3)
  ) || Boolean(asset.intraday?.currentVsVwapPct && asset.intraday.currentVsVwapPct > 0.3 && asset.intraday.last15MinChangePct >= 0)

  return {
    active,
    recentDailyChangesPct: lastTwo,
    combinedPct: round(combined),
    pullbackRisk: active
      ? asset.changePct >= 2.5 || asset.intraday?.trend === 'fade' ? 'high' as const : 'medium' as const
      : 'low' as const,
    confirmingStrength,
    guidance: active
      ? '前两日连续大涨后第三日更容易回调或震荡，买入要等回踩承接/VWAP 修复/资金和板块继续确认；若信号非常明确，可小仓位试错，不要追在尖峰。'
      : '未触发二连大涨第三日回调经验规则。'
  }
}

function previousCompletedDailyChangePct(asset: MarketAsset) {
  const closes = asset.technical?.closes ?? asset.kline
  if (closes.length < 3) return 0
  const previousClose = closes[closes.length - 3]
  const completedClose = closes[closes.length - 2]
  if (!previousClose || !completedClose || previousClose <= 0) return 0
  return (completedClose - previousClose) / previousClose * 100
}

export function hasHighVolumeBreakoutFadeRisk(asset: MarketAsset) {
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

function levelFromScore(score: number): BehavioralTrapLevel {
  if (score >= 70) return 'high'
  if (score >= 42) return 'medium'
  return 'low'
}

export function buildRetailTrapAssessment(asset: MarketAsset, position?: Position) {
  const intraday = asset.intraday
  const technical = asset.technical
  const trend = asset.trendAssessment
  const mainFlow = asset.mainNetInflowPct ?? 0
  const superFlow = asset.superOrderNetInflowPct ?? 0
  const bigFlow = asset.bigOrderNetInflowPct ?? 0
  const highPullback = intraday?.highPullbackPct ?? 0
  const minutesFromHigh = intraday?.minutesFromHigh ?? 0
  const twoDaySurge = assessTwoDaySurge(asset)
  const highVolumeBreakoutFade = hasHighVolumeBreakoutFadeRisk(asset)
  const failedSpike = Boolean(intraday && (
    intraday.turnedGreenAfterStrongOpen
    || intraday.trend === 'fade'
    || (intraday.highChangePct >= 4.5 && highPullback <= -3 && intraday.currentVsVwapPct < -0.3)
  ))
  const postLimitUpBlowoff = Boolean(technical && intraday && (
    technical.priorTwoLimitUp
    || technical.consecutiveLimitUpDays >= 2
    || technical.recentLimitUpCount >= 2
  ) && intraday.highChangePct >= 5 && highPullback <= -3.5 && minutesFromHigh >= 20)
  const overheatedChase = asset.changePct >= 3.2
    && ((technical?.rsi14 ?? 0) >= 78 || (technical?.closeVsMa20Pct ?? 0) >= 10 || (asset.volumeRatio ?? 1) >= 1.8)
  const flowDistribution = (mainFlow < -1 && bigFlow < 0)
    || (mainFlow < 0 && superFlow < 0 && bigFlow < 0)
  const panicFlush = Boolean(intraday && asset.changePct <= -2.5 && (
    intraday.lowChangePct <= -3.5
    || intraday.currentVsVwapPct <= -1.2
    || intraday.last15MinChangePct <= -0.9
  ))
  const possibleShakeout = Boolean(position && panicFlush
    && !flowDistribution
    && (
      (asset.relativeStrengthRank ?? 0) >= 0.6
      || (asset.sectorRank ?? 0) >= 0.58
      || superFlow > 0
      || bigFlow > 0
    ))
  const score = clamp(
    (failedSpike ? 24 : 0)
    + (postLimitUpBlowoff ? 34 : 0)
    + (highVolumeBreakoutFade ? 28 : 0)
    + (overheatedChase ? 22 : 0)
    + (flowDistribution ? 20 : 0)
    + (panicFlush ? 16 : 0)
    + (twoDaySurge.active ? twoDaySurge.pullbackRisk === 'high' ? 22 : 14 : 0)
    + (trend?.phase === 'distribution' || trend?.phase === 'failed_spike' ? 18 : 0)
    + (asset.riskScore >= 80 ? 14 : 0)
    - (possibleShakeout ? 18 : 0)
    - (twoDaySurge.active && twoDaySurge.confirmingStrength ? 8 : 0)
    - ((superFlow > 0 && bigFlow > 0) ? 8 : 0),
    0,
    100
  )

  const evidence = [
    failedSpike ? `冲高回落/跌破 VWAP，离日内高点回撤 ${pct(highPullback)}%` : '',
    postLimitUpBlowoff ? '近期涨停后出现大幅冲高回落，可能是情绪顶或派发' : '',
    highVolumeBreakoutFade ? `近期突破/强阳后放量冲高回落，量比 ${pct(asset.volumeRatio)}、VWAP 偏离 ${pct(intraday?.currentVsVwapPct)}%` : '',
    overheatedChase ? `涨幅 ${pct(asset.changePct)}%、RSI ${pct(technical?.rsi14)}、量比 ${pct(asset.volumeRatio)}，有追高拥挤风险` : '',
    twoDaySurge.active ? `前两日连续上涨 ${twoDaySurge.recentDailyChangesPct.join('% / ')}%，第三日回调/震荡概率升高` : '',
    twoDaySurge.active && twoDaySurge.confirmingStrength ? '二连涨后仍有资金/板块/VWAP 确认，可允许小仓位但不能追高' : '',
    flowDistribution ? `主力/大单流出：main ${pct(mainFlow)}%，super ${pct(superFlow)}%，big ${pct(bigFlow)}%` : '',
    panicFlush ? `日内急跌或贴 VWAP 下方，容易诱发散户恐慌卖出` : '',
    possibleShakeout ? '持仓仍有相对强度/板块/大单承接，急跌可能是洗盘而非确认破位' : ''
  ].filter(Boolean)

  const likelyPattern = postLimitUpBlowoff
    ? '涨停后诱多派发'
    : highVolumeBreakoutFade
      ? '突破次日放量冲高回落/获利盘兑现'
    : failedSpike && flowDistribution
      ? '拉高出货/冲高回落'
      : twoDaySurge.active && (overheatedChase || asset.changePct >= 2.5)
        ? '二连大涨第三天回调风险'
        : overheatedChase
        ? '情绪追高拥挤'
        : possibleShakeout
          ? '强势股盘中洗盘'
          : panicFlush
            ? '恐慌杀跌'
            : superFlow > 0 && bigFlow > 0 && asset.changePct <= 2.5
              ? '低位承接/吸筹'
              : '暂无明显收割形态'

  return {
    trapRisk: levelFromScore(score),
    trapScore: Math.round(score),
    likelyPattern,
    retailEmotion: overheatedChase || failedSpike || twoDaySurge.active ? '怕错过而追高' : panicFlush ? '怕继续亏而割肉' : '等待确认',
    twoDaySurge,
    mainForceHypothesis: possibleShakeout
      ? '可能利用盘中急跌洗出短线筹码，需用趋势破坏和大单流向确认，不要只看一根急跌。'
      : highVolumeBreakoutFade
        ? '前一日强突破后早盘拉升未能维持，放量跌回 VWAP 下方，可能是获利盘兑现或边拉边派发；必须等重新站回 VWAP 和短线动量修复。'
      : twoDaySurge.active && !twoDaySurge.confirmingStrength
        ? '前两日连续大涨后第三日，短线获利盘和追高盘都更敏感，容易出现冲高兑现或震荡洗筹。'
      : postLimitUpBlowoff || failedSpike
        ? '可能利用拉升制造赚钱效应吸引追单，再在高位派发筹码。'
        : flowDistribution
          ? '资金流出说明高位承接可能来自散户情绪，不能只看价格上涨。'
          : '暂未看到明确的诱多/诱空证据，按普通趋势和风控处理。',
    antiHarvestDiscipline: [
      '新买优先等回踩承接、VWAP 重新站稳、5/15 分钟动能修复，不在日内尖峰追单。',
      '前两日连续大涨后的第三日，默认等待回调确认；只有资金、板块、VWAP 和量价继续共振时才允许小仓位参与。',
      '卖出必须看趋势破坏、资金流失败或二次跌破，避免在日内最低附近情绪化割肉。',
      '高位放量冲高回落时宁可错过，也不要用满仓证明自己正确；低位急跌但大单承接仍在时先确认再动手。'
    ],
    evidence
  }
}
