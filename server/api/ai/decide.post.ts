import type { AiDecisionMemory, AiRequestDebug, AiTradeDecision, MarketAsset, MarketIndex, NewsItem, Position, StrategySignal } from '~/types/trading'

interface DecideBody {
  cash: number
  totalAsset: number
  marketValue: number
  marketScore: number
  indexes: MarketIndex[]
  news: NewsItem[]
  positions: Position[]
  candidates: Array<StrategySignal & { candidateSources?: string[] }>
  assets: MarketAsset[]
  memory?: AiDecisionMemory
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value))
}

function isBuyAllowedAsset(asset: Pick<MarketAsset, 'kind' | 'code' | 'sector'> | undefined) {
  if (!asset) return false
  if (asset.kind !== 'stock') return true
  return !asset.code.startsWith('30') && !asset.sector.includes('创业板')
}

function buyBlockReason(asset: Pick<MarketAsset, 'kind' | 'code' | 'sector'> | undefined) {
  if (!asset) return 'missing live asset data'
  if (isBuyAllowedAsset(asset)) return ''
  return '创业板/30 开头股票不在当前模拟账户买入范围'
}

function distancePct(price: number | undefined, anchor: number | undefined) {
  if (!price || !anchor || anchor <= 0) return undefined
  return Number(((price - anchor) / price * 100).toFixed(2))
}

function nearestSupportDistancePct(asset: MarketAsset | undefined) {
  if (!asset) return undefined
  const supports = [
    asset.previousClose,
    asset.technical?.ma5,
    asset.technical?.ma10,
    asset.technical?.ma20,
    asset.technical?.low20
  ].filter((value): value is number => Boolean(value && value > 0 && value <= asset.price))
  const distances = supports
    .map((value) => distancePct(asset.price, value))
    .filter((value): value is number => typeof value === 'number')
  return distances.length ? Math.min(...distances) : undefined
}

function nearestPressureDistancePct(asset: MarketAsset | undefined) {
  if (!asset) return undefined
  const pressures = [
    asset.technical?.high20,
    asset.technical?.high60,
    asset.technical?.high250,
    asset.limitUp
  ].filter((value): value is number => Boolean(value && value > 0 && value >= asset.price))
  const distances = pressures.map((value) => Number(((value - asset.price) / asset.price * 100).toFixed(2)))
  return distances.length ? Math.min(...distances) : undefined
}

function compactTechnical(asset: MarketAsset | undefined) {
  const technical = asset?.technical
  if (!technical) return undefined
  return {
    historyDays: technical.historyDays,
    ma5: technical.ma5,
    ma10: technical.ma10,
    ma20: technical.ma20,
    ma60: technical.ma60,
    ma120: technical.ma120,
    ma250: technical.ma250,
    macdDiff: technical.macdDiff,
    macdDea: technical.macdDea,
    macdHist: technical.macdHist,
    rsi14: technical.rsi14,
    volumeAvg20: technical.volumeAvg20,
    volumeSpike20: technical.volumeSpike20,
    high20: technical.high20,
    low20: technical.low20,
    high60: technical.high60,
    low60: technical.low60,
    high250: technical.high250,
    low250: technical.low250,
    closeVsMa20Pct: technical.closeVsMa20Pct,
    closeVsMa60Pct: technical.closeVsMa60Pct,
    closeVsMa250Pct: technical.closeVsMa250Pct,
    isGoldenCross: technical.isGoldenCross,
    isDeathCross: technical.isDeathCross,
    isBreakout20: technical.isBreakout20,
    isBreakout60: technical.isBreakout60,
    isBreakout250: technical.isBreakout250,
    recentLimitUpCount: technical.recentLimitUpCount,
    consecutiveLimitUpDays: technical.consecutiveLimitUpDays,
    lastCompletedLimitUp: technical.lastCompletedLimitUp,
    priorTwoLimitUp: technical.priorTwoLimitUp,
    recentCloses: technical.closes.slice(-30),
    recentVolumes: technical.volumes.slice(-30)
  }
}

function compactIntraday(asset: MarketAsset | undefined) {
  const intraday = asset?.intraday
  if (!intraday) return undefined
  return intraday
}

function compactTrendAssessment(asset: MarketAsset | undefined) {
  const trendAssessment = asset?.trendAssessment
  if (!trendAssessment) return undefined
  return trendAssessment
}

function assessTradeSetup(asset: MarketAsset | undefined, position: Position | undefined, signal: StrategySignal) {
  const supports: string[] = []
  const risks: string[] = []
  const vetoes: string[] = []
  const requiredConfirmations: string[] = []
  if (!asset) {
    return {
      setupType: 'unknown',
      buyBias: 'avoid',
      qualityScore: 0,
      supports,
      risks: ['missing live asset data'],
      vetoes: ['missing live asset data'],
      requiredConfirmations
    }
  }

  const trend = asset.trendAssessment
  const intraday = asset.intraday
  const technical = asset.technical
  const moneyFlowScore = trend?.components.moneyFlow ?? 50
  const postLimitUpBlowoff = Boolean(technical && intraday && (
    technical.priorTwoLimitUp
    || technical.consecutiveLimitUpDays >= 2
    || technical.recentLimitUpCount >= 2
  ) && intraday.highChangePct >= 5 && intraday.highPullbackPct <= -3.5 && intraday.minutesFromHigh >= 20)
  const failedIntradaySpike = Boolean(intraday && (
    intraday.turnedGreenAfterStrongOpen
    || intraday.trend === 'fade'
    || (intraday.highChangePct >= 5 && intraday.highPullbackPct <= -3.5 && intraday.currentVsVwapPct < -0.4)
  ))
  const extendedWithoutExceptionalConfirmation = asset.changePct > 2.8
    && !(trend?.direction === 'strong_up' && moneyFlowScore >= 65 && (intraday?.currentVsVwapPct ?? 0) > 0.3 && (intraday?.last15MinChangePct ?? 0) >= -0.1)
  const isHealthyTrend = trend?.direction === 'strong_up'
    || trend?.direction === 'up'
    || (trend?.phase === 'bottoming' && moneyFlowScore >= 52)
    || (trend?.phase === 'pullback' && (trend?.score ?? 0) >= 55 && moneyFlowScore >= 50)

  if (trend?.direction === 'strong_up' || trend?.direction === 'up') supports.push(`trend ${trend.direction}/${trend.phase} score ${trend.score}`)
  if (trend?.phase === 'bottoming') supports.push(`bottoming with money-flow score ${moneyFlowScore}`)
  if ((asset.relativeStrengthRank ?? 0) >= 0.72) supports.push('strong relative rank')
  if ((asset.sectorRank ?? 0) >= 0.62 || (asset.sectorMomentum ?? 0) >= 4) supports.push('supportive sector/theme')
  if ((asset.mainNetInflowPct ?? 0) > 0 && (asset.bigOrderNetInflowPct ?? 0) > 0) supports.push('main and big-order inflow both positive')
  if (intraday?.trend === 'recovering') supports.push('intraday momentum repairing')
  if (intraday?.trend === 'strong_up' && intraday.currentVsVwapPct > 0) supports.push('intraday above VWAP')

  if (postLimitUpBlowoff) {
    vetoes.push('recent/consecutive limit-up followed by deep intraday pullback: possible blowoff distribution')
    requiredConfirmations.push('wait for VWAP reclaim, repaired 5/15-minute momentum, and broad money-flow support')
  }
  if (failedIntradaySpike) {
    risks.push('failed intraday spike / high pullback')
    requiredConfirmations.push('avoid opening long until price reclaims VWAP')
  }
  if (trend?.phase === 'distribution' || trend?.phase === 'failed_spike') vetoes.push(`trendAssessment phase ${trend.phase}`)
  if (trend?.direction === 'down') vetoes.push('trendAssessment direction down')
  if (trend?.direction === 'fading' && trend.confidence >= 0.6) risks.push(`trend fading with confidence ${(trend.confidence * 100).toFixed(0)}%`)
  if (extendedWithoutExceptionalConfirmation) risks.push(`intraday gain ${asset.changePct.toFixed(2)}% without full confirmation`)
  if (technical?.rsi14 && technical.rsi14 >= 82) risks.push(`RSI overheated ${technical.rsi14.toFixed(1)}`)
  if (moneyFlowScore < 45) risks.push(`weak money-flow score ${moneyFlowScore}`)
  if (asset.riskScore >= 78) risks.push(`risk score elevated ${asset.riskScore}`)

  const baseScore = signal.score
  const qualityScore = Math.max(0, Math.min(100,
    baseScore
    + (isHealthyTrend ? 8 : -8)
    + supports.length * 3
    - risks.length * 6
    - vetoes.length * 22
  ))
  const setupType = postLimitUpBlowoff
    ? 'post_limit_up_blowoff'
    : failedIntradaySpike
      ? 'failed_intraday_spike'
      : trend?.phase === 'bottoming'
        ? 'bottoming_repair'
        : trend?.phase === 'pullback'
          ? 'constructive_pullback'
          : trend?.direction === 'strong_up' || trend?.direction === 'up'
            ? 'trend_continuation'
            : 'unclear'
  const buyBias = vetoes.length
    ? 'avoid'
    : qualityScore >= 78
      ? 'normal'
      : qualityScore >= 64
        ? 'pilot'
        : 'avoid'

  return {
    setupType,
    buyBias,
    qualityScore: Math.round(qualityScore),
    supports: supports.slice(0, 6),
    risks: risks.slice(0, 6),
    vetoes: vetoes.slice(0, 6),
    requiredConfirmations: requiredConfirmations.slice(0, 4),
    hasPosition: Boolean(position)
  }
}

function hasConstructiveMoneyFlow(asset: MarketAsset | undefined) {
  if (!asset) return false
  return (asset.mainNetInflowPct ?? 0) > 0
    || (asset.superOrderNetInflowPct ?? 0) > 0
    || (asset.bigOrderNetInflowPct ?? 0) > 0
}

function isSupportedBottomAccumulation(asset: MarketAsset | undefined) {
  if (!asset) return false
  return (asset.bottomScore ?? 0) >= 62
    && hasConstructiveMoneyFlow(asset)
    && (asset.volumeRatio ?? 1) >= 1.05
    && asset.changePct > -3.5
    && asset.changePct <= 2.6
}

function isTBuySetup(asset: MarketAsset | undefined, position: Position | undefined) {
  if (!asset || !position) return false
  return isSupportedBottomAccumulation(asset)
    || (asset.changePct <= 0.8 && hasConstructiveMoneyFlow(asset))
    || (asset.changePct <= 1.8 && position.floatingPnlPct <= -1.2 && hasConstructiveMoneyFlow(asset))
}

function normalizeDecision(value: unknown, validCodes: Set<string>, validBuyCodes: Set<string>): AiTradeDecision | null {
  if (!value || typeof value !== 'object') return null
  const item = value as Partial<AiTradeDecision>
  if (!item.code || !validCodes.has(item.code)) return null
  if (item.action !== 'buy' && item.action !== 'sell' && item.action !== 'hold') return null
  if (item.action === 'buy' && !validBuyCodes.has(item.code)) return null
  const horizon = item.horizon === 'long' || item.horizon === 'short' ? item.horizon : 'swing'

  return {
    action: item.action,
    code: item.code,
    horizon,
    weight: typeof item.weight === 'number' ? clamp(item.weight, 0, 0.95) : undefined,
    sellRatio: typeof item.sellRatio === 'number' ? clamp(item.sellRatio, 0, 1) : undefined,
    confidence: typeof item.confidence === 'number' ? clamp(item.confidence, 0, 1) : 0.5,
    reason: String(item.reason || 'AI decision')
  }
}

export default defineEventHandler(async (event) => {
  const config = useRuntimeConfig()
  const body = await readBody<DecideBody>(event)
  const aiProviders = getAiProviders(config)
  const aiTimeoutMs = getAiTimeoutMs(config.aiTimeoutMs)

  if (!aiProviders.length) {
    return {
      enabled: false,
      decisions: [] as AiTradeDecision[],
      reason: 'AI provider environment variables are not configured.'
    }
  }

  const assetMap = new Map(body.assets.map((asset) => [asset.code, asset]))
  const positionMap = new Map(body.positions.map((position) => [position.code, position]))
  const candidateSignals = body.candidates
    .filter((signal) => {
      const asset = assetMap.get(signal.code)
      const hasPosition = positionMap.has(signal.code)
      return hasPosition || isBuyAllowedAsset(asset)
    })
  const memory = body.memory
    ? {
        performance: body.memory.performance,
        recentTrades: body.memory.recentTrades.slice(0, 18),
        closedPositionReviews: body.memory.closedPositionReviews.slice(0, 8).map((review) => ({
          code: review.code,
          name: review.name,
          outcome: review.outcome,
          summary: review.summary,
          mistakes: review.mistakes.slice(0, 4),
          strengths: review.strengths.slice(0, 4),
          ruleIdeas: review.ruleIdeas.slice(0, 4),
          updatedAt: review.updatedAt
        })),
        learningNotes: body.memory.learningNotes.slice(0, 8)
      }
    : undefined
  const compactAssets = candidateSignals.slice(0, 80).map((signal) => {
    const asset = assetMap.get(signal.code)
    const position = positionMap.get(signal.code)
    const buyAllowed = isBuyAllowedAsset(asset)
    return {
      code: signal.code,
      name: signal.name,
      action: signal.action,
      horizon: signal.horizon,
      score: signal.score,
      candidateSources: signal.candidateSources ?? ['local composite score'],
      suggestedWeight: signal.suggestedWeight,
      sellRatio: signal.sellRatio,
      reason: signal.reason,
      price: asset?.price,
      changePct: asset?.changePct,
      turnover: asset?.turnover,
      turnoverRate: asset?.turnoverRate,
      marketCap: asset?.marketCap,
      floatMarketCap: asset?.floatMarketCap,
      peRatio: asset?.peRatio,
      pbRatio: asset?.pbRatio,
      volume: asset?.volume,
      volumeRatio: asset?.volumeRatio,
      amplitude: asset?.amplitude,
      mainNetInflow: asset?.mainNetInflow,
      mainNetInflowPct: asset?.mainNetInflowPct,
      superOrderNetInflow: asset?.superOrderNetInflow,
      superOrderNetInflowPct: asset?.superOrderNetInflowPct,
      bigOrderNetInflow: asset?.bigOrderNetInflow,
      bigOrderNetInflowPct: asset?.bigOrderNetInflowPct,
      bottomScore: asset?.bottomScore,
      trendScore: asset?.trendScore,
      sentimentScore: asset?.sentimentScore,
      liquidityScore: asset?.liquidityScore,
      riskScore: asset?.riskScore,
      kind: asset?.kind,
      sector: asset?.sector,
      industry: asset?.industry,
      concepts: asset?.concepts,
      relativeStrengthRank: asset?.relativeStrengthRank,
      sectorRank: asset?.sectorRank,
      sectorMomentum: asset?.sectorMomentum,
      sectorAssetCount: asset?.sectorAssetCount,
      hasPosition: Boolean(position),
      positionAvailableQuantity: position?.availableQuantity,
      positionFloatingPnlPct: position?.floatingPnlPct,
      execution: {
        buyAllowed,
        buyBlockReason: buyAllowed ? '' : buyBlockReason(asset),
        sellAvailable: Boolean(position && position.availableQuantity >= 100 && asset && asset.price > asset.limitDown),
        minimumBuyAmount: 4995,
        lotSize: 100
      },
      decisionSupport: {
        nearestSupportDistancePct: nearestSupportDistancePct(asset),
        nearestPressureDistancePct: nearestPressureDistancePct(asset),
        trend: asset?.trendAssessment
          ? `${asset.trendAssessment.direction}/${asset.trendAssessment.phase} score ${asset.trendAssessment.score} confidence ${(asset.trendAssessment.confidence * 100).toFixed(0)}%`
          : undefined,
        moneyFlow: `main ${((asset?.mainNetInflowPct ?? 0)).toFixed(2)}%, super ${((asset?.superOrderNetInflowPct ?? 0)).toFixed(2)}%, big ${((asset?.bigOrderNetInflowPct ?? 0)).toFixed(2)}%`,
        relative: `relativeRank ${((asset?.relativeStrengthRank ?? 0) * 100).toFixed(0)}%, sectorRank ${((asset?.sectorRank ?? 0) * 100).toFixed(0)}%, sectorMomentum ${(asset?.sectorMomentum ?? 0).toFixed(2)}`,
        technical: asset?.technical
          ? `MA5/20/60 ${asset.technical.ma5.toFixed(2)}/${asset.technical.ma20.toFixed(2)}/${asset.technical.ma60.toFixed(2)}, MACD hist ${asset.technical.macdHist.toFixed(3)}, RSI14 ${asset.technical.rsi14.toFixed(1)}, volSpike20 ${asset.technical.volumeSpike20.toFixed(2)}`
          : undefined,
        intraday: asset?.intraday
          ? `${asset.intraday.trend}, vsVWAP ${asset.intraday.currentVsVwapPct.toFixed(2)}%, last15 ${asset.intraday.last15MinChangePct.toFixed(2)}%, highPullback ${asset.intraday.highPullbackPct.toFixed(2)}%`
          : undefined
      },
      supportedBottomAccumulation: isSupportedBottomAccumulation(asset),
      tBuySetup: isTBuySetup(asset, position),
      extendedIntradayGain: asset ? asset.changePct > (position ? 1.8 : 2.8) : false,
      technical: compactTechnical(asset),
      intraday: compactIntraday(asset),
      trendAssessment: compactTrendAssessment(asset),
      setupAssessment: assessTradeSetup(asset, position, signal)
    }
  })
  const promptPayload = {
    account: {
      cash: body.cash,
      totalAsset: body.totalAsset,
      marketValue: body.marketValue,
      marketScore: body.marketScore
    },
    candidateSourceGuide: {
      localAction: 'candidate.action is a local rule label, not an instruction. Override it when the supplied evidence disagrees.',
      localScore: 'candidate.score is a local composite ranking used for discovery. Treat it as one feature alongside raw market data, not as the final decision.',
      candidateSources: 'candidateSources explains why the name was sent to you: actionable rule, held position, top local score, relative/sector leader, bottom accumulation, money-flow anomaly, support pullback, or risk sample.'
    },
    indexes: body.indexes.slice(0, 5),
    news: body.news.slice(0, 8),
    positions: body.positions,
    tradingMemory: memory,
    candidates: compactAssets
  }

  const prompt = [
    'You are an A-share simulated trading decision layer. Return strict JSON only.',
    'Goal: capture strong A-share/retail ETF opportunities and maximize simulated profit. Buyable universe is ordinary main-board A-shares and retail-buyable ETFs; ChiNext/创业板 30xxxx stocks are not buyable and should not be analyzed as new buys. Do not prefer ETF by default; choose eligible stocks or ETFs purely by expected opportunity.',
    'Be data-first. Ground every active decision in the supplied decisionSupport, execution, trendAssessment, technical, intraday, money-flow, relative/sector, valuation/size, position, and tradingMemory fields. Prefer concise evidence over repeating generic risk rules.',
    'The candidate list is deliberately diversified. candidateSources tells you why each symbol was included. Local action, score, suggestedWeight and reason are discovery hints from the rule engine, not commands; you may buy a local hold, hold a local buy, or reject a local sell when the raw evidence says so. Explain any meaningful override using concrete data.',
    'Act like a maturing trading assistant, not a rule executor. First read tradingMemory: recent trades, performance, closed-position reviews, missed-upside mistakes, and what worked. Your job is to improve expected profit and avoid repeating the same error pattern. If memory says early selling missed upside, demand stronger sell evidence; if memory says a stop protected downside, keep that discipline. If AI or total expectancy is negative, reduce low-conviction activity and only act when edge is clear.',
    'Every non-hold reason must briefly say why this decision is expected to improve profit versus holding cash/position, and how it avoids the most relevant recent mistake from tradingMemory. If tradingMemory conflicts with a rule candidate, use judgment and explain the override.',
    'Do not let excessive cash sit idle by default. When cash is above about 25% of totalAsset and the market is not in clear panic, actively search the candidates for 1-2 asymmetric pilot buys: trendAssessment up/strong_up, bottoming with improving money flow, sector/relative strength support, or clean pullback near support. Size pilot buys modestly when conviction is medium, but prefer a small high-quality position over doing nothing. Holding cash is correct only when candidates are mostly fading/down/distribution, failed spikes, overextended, or money flow is poor.',
    'Use setupAssessment as a compact read of the data, not as a replacement for judgment. buyBias, qualityScore, supports, risks, vetoes, requiredConfirmations, and decisionSupport should explain the trade quality and position size.',
    'Account starts with CNY 50,000. Any buy must be at least CNY 4,995 after lot rounding, but this is only a fee floor, not a target size. Default new buys should be pullbacks, bottom accumulation, or modest intraday strength. Avoid buying names already up more than about 2.8% intraday unless it is an exceptional breakout with expanding volume, main/super/big order inflow, strong relative/sector rank, acceptable RSI/MA extension, and high confidence; size those exception buys small.',
    'Respect A-share T+1 through provided sell candidates. Actions may be buy, sell, hold. weight means target NAV weight for buy, max 0.95. sellRatio is 0-1 for available quantity. Same-symbol T is encouraged only when it improves cost: for existing positions, buy only when tBuySetup or supportedBottomAccumulation is true, or when the stock is near flat/pulling back with constructive money flow. If an existing position is up more than about 1.8%-2.0% intraday, prefer hold or sell/trim available shares instead of adding, unless it is a supported bottom recovery.',
    'Sell discipline is profit-maximizing, not mechanical. Your default for a strong holding is HOLD and let profits run. Never sell only because there is a profit, a short-term pullback, a high intraday gain, or because a rule candidate says sell. Full exit requires confirmed trend damage, money-flow failure, sector rollover, hard risk/stop conditions, or a clearly superior rotation. For swing holdings in the first hour, weak_down/below-VWAP/last-15-minute weakness is not enough for full exit when sectorMomentum or sectorRank is still supportive and super/big-order net inflow remains positive; wait until after 10:30 Asia/Shanghai or a second breakdown unless at least three core buy factors have failed. Treat negative mainNetInflow with positive super/big-order inflow as money-flow divergence, not automatic trend failure. Partial T trim is allowed only when price is visibly exhausted near resistance with fading money flow/RSI/volume evidence; size trims 15%-25% and keep the core. Small position market value below CNY 5,000 should be full exit only when the exit is otherwise justified.',
    'Horizon is metadata, not a prison. You may upgrade an existing swing/short holding to long/core when new evidence shows a durable leader, and you may downgrade/exit long holdings when the evidence breaks. Do not let the current swing/short label force a sell or small target weight.',
    'Potential ten-bagger discipline: when a stock has strong relativeStrengthRank, leading sectorRank/sectorMomentum, constructive MA/MACD structure, expanding volume, and persistent main/super/big order inflow, classify it as long/core instead of short momentum even if the rule signal says swing/short. Tolerate normal shakeouts and ordinary pullbacks; only full-exit after confirmed trend damage, money-flow failure, sector rollover, or hard risk/stop conditions. Otherwise prefer hold or add-on-pullback. Do not T-trim a potential leader unless there is clear exhaustion plus money-flow fade.',
    'Use bottomScore, volumeRatio, mainNetInflowPct, superOrderNetInflowPct and bigOrderNetInflowPct to distinguish supported bottom accumulation from weak falling knives. Prefer bottom setups only when volume expands and large orders are net inflowing; treat large-order outflow as a sell or avoid signal. When an existing holding has bottomScore >= 80, expanded volume, and super/big-order support, do not sell only because the index is weak or mainNetInflow is negative; require confirmed technical damage, failed large-order support, sector rollover, or hard stop. If risk must be reduced, use at most a small 20%-25% trim. When candidates include tBuySetup=false and extendedIntradayGain=true, do not buy; wait for a lower entry or use available shares for a T trim.',
    'Use intraday fields when available. A stock that opened/ran up strongly then fell below VWAP or turned green after a 4.5%+ first-30-minute high is a failed intraday spike, not strength. For held positions, failed intraday spikes with money-flow deterioration deserve at least a partial sell/trim unless longer-term leadership remains very strong. For non-held names, do not chase failed spikes; wait for reclaim of VWAP and improving 5/15-minute momentum.',
    'Be especially skeptical after consecutive or recent limit-up days. If technical.priorTwoLimitUp/recentLimitUpCount is high and today shows a large intraday high followed by a deep pullback, treat bottomScore and positive mainNetInflow as unreliable by themselves; this can be blowoff distribution or profit-taking, not bottom accumulation. Do not open a new long in that pattern unless price reclaims VWAP, 5/15-minute momentum repairs, and money flow remains broad-based.',
    'Use trendAssessment as the synthesized trend diagnosis across daily trend, intraday structure, money flow, relative strength, sector context, and risk. Prefer buys only when trendAssessment.direction is up/strong_up with confidence, or bottoming with improving money flow. Treat direction=fading/down or phase=failed_spike/distribution as evidence to avoid buys and consider trims/exits for held positions, unless tradingMemory and long-term leadership make the risk worth holding.',
    'Use technical fields when available: two-year daily history summary, MA5/10/20/60/120/250, MACD, RSI14, volumeSpike20, recent closes/volumes, 20/60/250-day breakouts, and distance from moving averages. Prefer setups where trend, volume, money flow and risk agree. Buying extended names is acceptable only with strong breakout confirmation, volume expansion, and money-flow support; otherwise wait for a pullback.',
    'Use relative context when available: relativeStrengthRank is rank versus the scanned universe, sectorRank and sectorMomentum describe whether its industry/theme is currently leading, and sectorAssetCount indicates signal breadth. Prefer names that are strong both individually and within strong sectors; be skeptical of isolated moves in weak sectors. Use valuation/size fields such as marketCap, floatMarketCap, peRatio, pbRatio and turnoverRate to judge quality, liquidity and speculation risk.',
    JSON.stringify(promptPayload)
  ].join('\n')
  const systemMessage = 'Return JSON like {"decisions":[{"action":"buy","code":"600519","horizon":"swing","weight":0.55,"confidence":0.82,"reason":"..."}]}. No markdown.'
  const debugBase: Omit<AiRequestDebug, 'id' | 'model'> = {
    kind: 'decision',
    title: 'AI 买卖决策',
    endpoint: '/api/ai/decide',
    capturedAt: new Date().toISOString(),
    prompt,
    payload: promptPayload,
    messages: [
      { role: 'system', content: systemMessage },
      { role: 'user', content: prompt }
    ]
  }

  try {
    const result = await withAiProviderFallback(aiProviders, async (provider) => {
      const response = await requestChatCompletion<{ choices?: Array<{ message?: { content?: string } }> }>(
        aiProviderChatCompletionUrl(provider),
        aiProviderHeaders(provider),
        {
          model: provider.model,
          messages: [
            {
              role: 'system',
              content: systemMessage
            },
            { role: 'user', content: prompt }
          ],
          temperature: 0.2,
          reasoning_effort: 'high',
          max_tokens: 1600,
          store: false
        },
        aiTimeoutMs
      )

      const content = response.choices?.[0]?.message?.content ?? ''
      const jsonText = content.match(/\{[\s\S]*\}/)?.[0] ?? '{"decisions":[]}'
      const parsed = JSON.parse(jsonText) as { decisions?: unknown[] }
      const validCodes = new Set(candidateSignals.map((candidate) => candidate.code))
      const validBuyCodes = new Set(candidateSignals
        .filter((candidate) => isBuyAllowedAsset(assetMap.get(candidate.code)))
        .map((candidate) => candidate.code))
      return (parsed.decisions ?? [])
        .map((decision) => normalizeDecision(decision, validCodes, validBuyCodes))
        .filter((decision): decision is AiTradeDecision => Boolean(decision))
        .slice(0, 10)
    })

    return {
      enabled: true,
      model: aiProviderModelLabel(result.provider),
      decisions: result.value,
      debug: {
        ...debugBase,
        id: `${debugBase.kind}:${debugBase.capturedAt}`,
        model: aiProviderModelLabel(result.provider)
      }
    }
  } catch (error) {
    return {
      enabled: false,
      decisions: [] as AiTradeDecision[],
      reason: getErrorMessage(error, 'AI decision failed.'),
      debug: {
        ...debugBase,
        id: `${debugBase.kind}:${debugBase.capturedAt}`
      }
    }
  }
})
