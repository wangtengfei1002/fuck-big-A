import type { MarketAsset, MarketIndex, NewsItem, Position, RiskLevel, StrategyHorizon, StrategySignal } from '~/types/trading'

const HORIZON_LABELS: Record<StrategyHorizon, string> = {
  long: 'conviction core',
  swing: 'swing',
  short: 'short momentum'
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
  if (score >= 78 && asset.riskScore <= 58 && marketScore >= 50) return 'long'
  if (asset.trendScore >= 68 && asset.sentimentScore >= 58 && asset.riskScore <= 64) return 'short'
  if (score >= 62 && asset.trendScore >= 54) return 'swing'
  return 'swing'
}

function targetWeight(asset: MarketAsset, horizon: StrategyHorizon, score: number, marketScore: number) {
  if (horizon === 'long') {
    const base = score / 260
    return clamp(base * clamp(marketScore / 65, 0.65, 1.2), 0.18, 0.38)
  }
  if (horizon === 'swing') return clamp(score / 420, 0.12, 0.28)
  return clamp(score / 520, 0.1, 0.22)
}

function chasePenalty(changePct: number) {
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

function isLeadingTheme(asset: MarketAsset) {
  return (asset.relativeStrengthRank ?? 0) >= 0.72
    && ((asset.sectorRank ?? 0) >= 0.62 || (asset.sectorMomentum ?? 0) >= 4)
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
  return marketScore >= 42
    && asset.trendScore >= 62
    && asset.liquidityScore >= 52
    && asset.riskScore <= 74
    && isLeadingTheme(asset)
    && constructiveTechnical
    && (hasPositiveMoneyFlow(asset) || asset.trendScore >= 72)
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

function shouldSellPosition(asset: MarketAsset, position: Position, marketScore: number) {
  const pnlPct = position.floatingPnlPct
  const drawdownFromBest = position.highestPnlPct - pnlPct
  const convictionTrend = position.horizon === 'long' && isConvictionTrend(asset, marketScore)
  const trendBreak = asset.trendScore < (position.horizon === 'long' ? (convictionTrend ? 30 : 36) : position.horizon === 'swing' ? 44 : 50)
  const fundOutflow = (asset.mainNetInflowPct ?? 0) < (convictionTrend ? -7 : -4) && (asset.bigOrderNetInflowPct ?? 0) < (convictionTrend ? -4 : -2)
  const hardStop = pnlPct <= (position.horizon === 'long' ? (convictionTrend ? -18 : -13) : position.horizon === 'swing' ? -8 : -4.5)
  const weakLoss = pnlPct <= (position.horizon === 'long' ? -8 : position.horizon === 'swing' ? -5 : -3.5) && trendBreak
  const riskExit = asset.riskScore >= (position.horizon === 'long' ? (convictionTrend ? 96 : 90) : position.horizon === 'swing' ? 80 : 74)
  const technicalExit = asset.technical?.isDeathCross && (asset.technical?.macdHist ?? 0) < 0 && asset.trendScore < (position.horizon === 'long' ? 48 : 56)
  const marketRiskExit = marketScore < 36 && asset.changePct < -4 && asset.trendScore < (position.horizon === 'long' ? 42 : 55)
  const trailingTakeProfit =
    (position.horizon === 'long' && (
      convictionTrend
        ? position.highestPnlPct >= 35 && drawdownFromBest >= 14 && asset.trendScore < 44 && fundOutflow
        : position.highestPnlPct >= 18 && drawdownFromBest >= 8 && asset.trendScore < 48
    ))
    || (position.horizon === 'swing' && position.highestPnlPct >= 9 && drawdownFromBest >= 4.5)
    || (position.horizon === 'short' && position.highestPnlPct >= 4 && drawdownFromBest >= 2.2)
  const shortFade = position.horizon === 'short' && asset.changePct < -2.8 && asset.trendScore < 58

  if (hardStop) return { sell: true, ratio: position.horizon === 'long' ? 0.4 : 1, reason: `hard stop ${pnlPct.toFixed(2)}%` }
  if (riskExit) return { sell: true, ratio: 1, reason: `risk score ${asset.riskScore}` }
  if (technicalExit && !convictionTrend) return { sell: true, ratio: position.horizon === 'long' ? 0.3 : 0.5, reason: `technical trend break` }
  if (fundOutflow && trendBreak) return { sell: true, ratio: position.horizon === 'long' ? 0.3 : 0.5, reason: `large-order outflow ${((asset.mainNetInflowPct ?? 0)).toFixed(2)}%` }
  if (trailingTakeProfit) return { sell: true, ratio: position.horizon === 'long' ? 0.3 : 0.5, reason: `trailing profit drawdown ${drawdownFromBest.toFixed(2)}%` }
  if (weakLoss) return { sell: true, ratio: position.horizon === 'long' ? 0.3 : 0.5, reason: `loss with trend break ${pnlPct.toFixed(2)}%` }
  if (marketRiskExit) return { sell: true, ratio: position.horizon === 'long' ? 0.3 : 0.5, reason: `market risk score ${Math.round(marketScore)}` }
  if (shortFade) return { sell: true, ratio: 0.5, reason: `short momentum faded` }

  return { sell: false, ratio: 0, reason: '' }
}

export function useStrategy() {
  const scoreMarket = (indexes: MarketIndex[], news: NewsItem[]) => {
    if (!indexes.length) return 0

    const indexScore = indexes.reduce((sum, item) => sum + item.changePct * 8 + item.breadth * 0.45 + item.volumeRatio * 10, 0) / indexes.length
    const newsScore = news.reduce((sum, item) => sum + item.impact, 0) / Math.max(news.length, 1)
    return clamp(indexScore * 0.58 + newsScore * 0.42, 0, 100)
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

    return assets
      .map((asset) => {
        const rawScore =
          asset.trendScore * 0.34
          + asset.sentimentScore * 0.22
          + asset.liquidityScore * 0.2
          + marketScore * 0.16
          + bottomBoost(asset)
          + fundFlowBoost(asset)
          + volumeBoost(asset)
          + technicalBoost(asset)
          + relativeContextBoost(asset)
          - asset.riskScore * 0.18
          + clamp(asset.changePct, -3, 2.5) * 1.1
          - chasePenalty(asset.changePct)
          - speculationPenalty(asset)
        const score = clamp(Math.round(Number.isFinite(rawScore) ? rawScore : 0), 0, 100)
        const position = positionMap.get(asset.code)
        const horizon = position?.horizon ?? (isConvictionTrend(asset, marketScore) && score >= 68 ? 'long' : inferHorizon(asset, score, marketScore))
        const sellDecision = position ? shouldSellPosition(asset, position, marketScore) : { sell: false, ratio: 0, reason: '' }
        const notOverheated = asset.changePct < (horizon === 'short' ? 4.5 : 3.2)
        const technical = asset.technical
        const technicalSupport = !technical || (
          !technical.isDeathCross
          && technical.rsi14 < 78
          && technical.closeVsMa20Pct < 16
          && (
            technical.macdHist >= 0
            || technical.isGoldenCross
            || technical.isBreakout20
            || technical.volumeSpike20 >= 1.35
          )
        )
        const supportedBottom = (asset.bottomScore ?? 0) >= 62 && (asset.mainNetInflowPct ?? 0) > 0 && (asset.volumeRatio ?? 1) >= 1.05 && asset.changePct > -3.5
        const longBuy = horizon === 'long' && marketScore >= 48 && score >= 60 && asset.riskScore <= 58 && notOverheated && technicalSupport
        const swingBuy = horizon === 'swing' && marketScore >= 50 && score >= 66 && asset.riskScore <= 66 && (notOverheated || supportedBottom) && technicalSupport
        const shortBuy = horizon === 'short' && marketScore >= 55 && score >= 72 && asset.riskScore <= 64 && asset.changePct > 0.3 && notOverheated && technicalSupport
        const bottomBuy = supportedBottom && marketScore >= 45 && score >= 64 && asset.riskScore <= 70 && asset.price > asset.limitDown && technicalSupport
        const shouldBuy = !position && asset.price < asset.limitUp && (longBuy || swingBuy || shortBuy || bottomBuy)
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
  const base = `${HORIZON_LABELS[horizon]} | trend ${asset.trendScore}, sentiment ${asset.sentimentScore}, liquidity ${asset.liquidityScore}, risk ${asset.riskScore}, market ${Math.round(marketScore)}, bottom ${asset.bottomScore ?? 0}, volume ratio ${(asset.volumeRatio ?? 1).toFixed(2)}, main net ${((asset.mainNetInflowPct ?? 0)).toFixed(2)}%, big net ${((asset.bigOrderNetInflowPct ?? 0)).toFixed(2)}%`
  if (action === 'buy') return `${base}. Risk-budgeted allocation from simulated NAV ${Math.round(totalAsset)}.`
  if (action === 'sell') return `${base}. Exit: ${sellReason}.`
  return `${base}. Hold/watch until score, risk or drawdown changes.`
}
