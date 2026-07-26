import type { AiDecisionMemory, AiLearningPatternStats, AiRequestDebug, AiTradeDecision, MarketAsset, MarketIndex, NewsItem, Position, StrategySignal } from '~/types/trading'

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

const SOFT_MAX_POSITION_COUNT = 5
const DEFAULT_NEW_POSITION_WEIGHT = 0.24
const HIGH_CONVICTION_NEW_POSITION_WEIGHT = 0.34
const MOMENTUM_PROBE_WEIGHT = 0.12
const MIN_BUY_AMOUNT = 4995
const MIN_SELL_AMOUNT = 5000
const MIN_REMAINING_POSITION_AMOUNT = 5000

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value))
}

function isBuyAllowedAsset(asset: Pick<MarketAsset, 'kind' | 'code' | 'sector'> | undefined) {
  if (!asset) return false
  if (asset.kind !== 'stock') return true
  return !asset.code.startsWith('30')
    && !asset.code.startsWith('688')
    && !asset.sector.includes('创业板')
    && !asset.sector.includes('科创板')
}

function assetThemeText(asset: MarketAsset | undefined) {
  if (!asset) return ''
  return `${asset.name}${asset.sector}${asset.industry ?? ''}${asset.concepts?.join('') ?? ''}`.toLowerCase()
}

function isTechnologyThemeAsset(asset: MarketAsset | undefined) {
  return /科创|芯片|半导体|集成电路|人工智能|ai|电子|信创|软件|机器人|算力|存储|cpo|光模块|服务器|液冷|pcb/.test(assetThemeText(asset))
}

function previousCompletedDailyChangePct(asset: MarketAsset | undefined) {
  const closes = asset?.technical?.closes ?? asset?.kline ?? []
  if (closes.length < 3) return 0
  const previousClose = closes[closes.length - 3]
  const completedClose = closes[closes.length - 2]
  if (!previousClose || !completedClose || previousClose <= 0) return 0
  return Number(((completedClose - previousClose) / previousClose * 100).toFixed(2))
}

function previousCompletedVolumeRatio(asset: MarketAsset | undefined) {
  const volumes = asset?.technical?.volumes ?? []
  if (volumes.length < 7) return undefined
  const completedVolume = volumes[volumes.length - 2]
  const lookback = volumes
    .slice(Math.max(0, volumes.length - 22), volumes.length - 2)
    .filter((volume) => volume > 0)
  if (!completedVolume || !lookback.length) return undefined
  const averageVolume = lookback.reduce((sum, volume) => sum + volume, 0) / lookback.length
  return averageVolume > 0 ? Number((completedVolume / averageVolume).toFixed(2)) : undefined
}

function compactPostLimitUpVolumeContext(asset: MarketAsset | undefined) {
  if (!asset) return undefined
  const technical = asset.technical
  const previousChangePct = previousCompletedDailyChangePct(asset)
  const previousVolumeRatio = previousCompletedVolumeRatio(asset)
  const hasRecentLimitUp = previousChangePct >= 9.5
    || Boolean(technical?.lastCompletedLimitUp)
    || Boolean(technical?.priorTwoLimitUp)
    || (technical?.recentLimitUpCount ?? 0) > 0
  if (!hasRecentLimitUp && !(previousVolumeRatio && previousVolumeRatio >= 2)) return undefined
  return {
    hasRecentLimitUp,
    previousCompletedDailyChangePct: previousChangePct,
    previousCompletedVolumeRatio: previousVolumeRatio,
    recentLimitUpCount: technical?.recentLimitUpCount,
    consecutiveLimitUpDays: technical?.consecutiveLimitUpDays,
    currentChangePct: asset.changePct,
    currentVolumeRatio: asset.volumeRatio,
    warning: hasRecentLimitUp && previousVolumeRatio && previousVolumeRatio >= 2
      ? 'recent limit-up followed by unusually heavy volume; watch for failed relay or profit-taking distribution'
      : 'recent limit-up/volume expansion needs confirmation before new buy'
  }
}

function buyBlockReason(asset: Pick<MarketAsset, 'kind' | 'code' | 'sector'> | undefined) {
  if (!asset) return 'missing live asset data'
  if (isBuyAllowedAsset(asset)) return ''
  return '创业板/科创板（30/688 开头）股票不在当前模拟账户买入范围；用主板股票或普通 ETF 替代'
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
  const highVolumeBreakoutFade = hasHighVolumeBreakoutFadeRisk(asset)
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
  const extendedWithoutExceptionalConfirmation = asset.changePct > 3.5
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
  if (highVolumeBreakoutFade) {
    vetoes.push('recent breakout/strong daily bar followed by high-volume intraday fade below VWAP')
    requiredConfirmations.push('wait for VWAP reclaim, repaired 5/15-minute momentum, and proof that volume is accumulation rather than profit-taking')
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
    : highVolumeBreakoutFade
      ? 'high_volume_breakout_fade'
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
  return !hasHighVolumeBreakoutFadeRisk(asset)
    && (asset.bottomScore ?? 0) >= 62
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

function compactDebugText(value: string, maxLength = 220) {
  const text = value.replace(/\s+/g, ' ').trim()
  return text.length > maxLength ? `${text.slice(0, maxLength)}...` : text
}

function extractAiContent(response: {
  output_text?: unknown
  choices?: Array<{
    text?: unknown
    message?: {
      content?: unknown
      reasoning_content?: unknown
    }
  }>
}) {
  const choice = response.choices?.[0]
  const content = choice?.message?.content
  if (typeof content === 'string') return content
  if (Array.isArray(content)) {
    return content
      .map((part) => {
        if (typeof part === 'string') return part
        if (!part || typeof part !== 'object') return ''
        const item = part as { text?: unknown, content?: unknown }
        if (typeof item.text === 'string') return item.text
        if (typeof item.content === 'string') return item.content
        return ''
      })
      .filter(Boolean)
      .join('\n')
  }
  if (typeof choice?.text === 'string') return choice.text
  if (typeof response.output_text === 'string') return response.output_text
  if (typeof choice?.message?.reasoning_content === 'string') return choice.message.reasoning_content
  return ''
}

function fallbackHoldDecision(signal: StrategySignal | undefined, rawDecisionCount: number, rawContent: string): AiTradeDecision[] {
  if (!signal) return []
  const reason = rawDecisionCount > 0
    ? `AI 返回 ${rawDecisionCount} 条建议，但均未通过本地校验（代码不在候选池、买入范围受限或字段非法），先观望 ${signal.name}。`
    : rawContent.trim()
      ? `AI 返回内容未包含可解析的 decisions（原始片段：${compactDebugText(rawContent)}），先按候选池最高分观望 ${signal.name}。`
      : `AI 响应内容为空，未返回可解析的 decisions，先按候选池最高分观望 ${signal.name}。`
  return [{
    action: 'hold',
    code: signal.code,
    horizon: signal.horizon,
    confidence: 0.5,
    reason
  }]
}

function compactLearningPatterns(items: AiLearningPatternStats[] | undefined, limit: number, exampleLimit: number) {
  return (items ?? []).slice(0, limit).map((item) => ({
    ...item,
    recentExamples: item.recentExamples.slice(0, exampleLimit)
  }))
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
        patternSummary: body.memory.patternSummary
          ? {
              taxonomySize: body.memory.patternSummary.taxonomySize,
              sampleSize: body.memory.patternSummary.sampleSize,
              aiSampleSize: body.memory.patternSummary.aiSampleSize,
              ruleSampleSize: body.memory.patternSummary.ruleSampleSize,
              observedPatterns: compactLearningPatterns(body.memory.patternSummary.observedPatterns, 100, 1),
              bestPatterns: compactLearningPatterns(body.memory.patternSummary.bestPatterns, 30, 2),
              weakPatterns: compactLearningPatterns(body.memory.patternSummary.weakPatterns, 30, 2),
              recentMistakes: (body.memory.patternSummary.recentMistakes ?? []).slice(0, 5),
              provenStrengths: (body.memory.patternSummary.provenStrengths ?? []).slice(0, 5),
              currentBias: body.memory.patternSummary.currentBias,
              actionHints: body.memory.patternSummary.actionHints.slice(0, 4)
            }
          : undefined,
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
      positionAvailableValue: position && asset ? position.availableQuantity * asset.price : undefined,
      positionMarketValue: position && asset ? position.quantity * asset.price : undefined,
      positionFloatingPnlPct: position?.floatingPnlPct,
      previousCompletedDailyChangePct: previousCompletedDailyChangePct(asset),
      previousCompletedVolumeRatio: previousCompletedVolumeRatio(asset),
      limitUp: asset?.limitUp,
      limitDown: asset?.limitDown,
      isAtLimitUp: asset ? asset.price >= asset.limitUp - 0.001 : false,
      execution: {
        buyAllowed,
        buyBlockReason: buyAllowed ? '' : buyBlockReason(asset),
        sellAvailable: Boolean(position && position.availableQuantity >= 100 && asset && asset.price > asset.limitDown),
        minimumBuyAmount: MIN_BUY_AMOUNT,
        minimumSellAmount: MIN_SELL_AMOUNT,
        minimumRemainingPositionAmount: MIN_REMAINING_POSITION_AMOUNT,
        defaultNewPositionWeight: DEFAULT_NEW_POSITION_WEIGHT,
        highConvictionNewPositionWeight: HIGH_CONVICTION_NEW_POSITION_WEIGHT,
        momentumProbeWeight: MOMENTUM_PROBE_WEIGHT,
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
      extendedIntradayGain: asset ? asset.changePct > (position ? 1.8 : 3.5) : false,
      postLimitUpVolumeContext: compactPostLimitUpVolumeContext(asset),
      technologyReboundContext: asset
        ? {
            isTechnologyTheme: isTechnologyThemeAsset(asset),
            previousCompletedDailyChangePct: previousCompletedDailyChangePct(asset),
            followThroughCandidate: isTechnologyThemeAsset(asset)
              && previousCompletedDailyChangePct(asset) >= (asset.kind === 'etf' ? 3.5 : 6)
              && asset.changePct >= (asset.kind === 'etf' ? 0.8 : 1.5)
              && (asset.volumeRatio ?? 1) >= 1.05
          }
        : undefined,
      behavioralContext: asset ? buildRetailTrapAssessment(asset, position) : undefined,
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
      marketScore: body.marketScore,
      positionCount: body.positions.length,
      softMaxPositionCount: SOFT_MAX_POSITION_COUNT
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
    'Goal: capture strong A-share/retail ETF opportunities and maximize simulated profit. Buyable universe is ordinary main-board A-shares and retail-buyable ETFs; ChiNext/创业板 30xxxx and STAR Market/科创板 688xxx stocks are not buyable and should not be analyzed as new buys. When the strongest opportunity is in 科创/半导体/芯片 but direct 688/30 stocks are not buyable, use liquid retail-buyable ETFs or eligible main-board stocks as the implementation vehicle. Do not prefer ETF by default; choose eligible stocks or ETFs purely by expected opportunity and executable access.',
    'Be data-first. Ground every active decision in the supplied decisionSupport, execution, trendAssessment, technical, intraday, money-flow, relative/sector, valuation/size, position, and tradingMemory fields. Prefer concise evidence over repeating generic risk rules.',
    'The candidate list is deliberately diversified. candidateSources tells you why each symbol was included. Local action, score, suggestedWeight and reason are discovery hints from the rule engine, not commands; you may buy a local hold, hold a local buy, or reject a local sell when the raw evidence says so. Explain any meaningful override using concrete data.',
    'Act like a maturing trading assistant, not a rule executor. First read tradingMemory.patternSummary, then recent trades and closed-position reviews. patternSummary is the compressed long-term learning layer: taxonomySize is the fixed pattern universe size, observedPatterns can include up to 100 historical setup buckets, bestPatterns are setups to prefer when current evidence matches, weakPatterns are setups to penalize, currentBias describes how aggressive or defensive you should be, and actionHints are operating rules distilled from outcomes. Do not overfit a single trade; use the summary when sampleSize is meaningful and explain when today is an exception.',
    'Every non-hold reason must briefly say why this decision is expected to improve profit versus holding cash/position, and how it follows or consciously overrides tradingMemory.patternSummary. If memory says early selling missed upside, demand stronger sell evidence; if memory says a stop protected downside, keep that discipline. If AI or total expectancy is negative, reduce low-conviction activity and only act when edge is clear.',
    'Be selective and fee-aware, but do not confuse selectivity with inactivity. Frequent trading is acceptable when the evidence is clear and expected edge beats fees; what must be avoided is repeated low-conviction churn. Prefer about 5 total holdings, not a messy basket of unrelated names. MarketScore is a sizing and selectivity dial, not a total veto: even in a weak market, buyable leaders can run, but weak markets require harder evidence before buying: strong relativeStrengthRank or sectorRank/sectorMomentum, expanding volume, broad main/super/big-order support, constructive trendAssessment, and no failed intraday spike. When account.positionCount is at or above account.softMaxPositionCount, avoid opening a new symbol unless it is a clearly exceptional high-conviction opportunity; instead prefer adding to an existing strong holding, holding cash, or selling/rotating out of a laggard first. When cash is above about 25% of totalAsset and the market is not in clear panic, search for 1-2 asymmetric buys with clear evidence: trendAssessment up/strong_up, bottoming with improving money flow, sector/relative strength support, clean pullback near support, or confirmed main-theme rebound follow-through. If evidence is mixed, return hold. Size new symbols by NAV, not by the original CNY 50,000 starting capital: ordinary conviction should be meaningful, high conviction can be larger, and CNY 5,000 probes are allowed only for rare controlled momentum risk, not as the default way to fill slots. Holding cash is correct when candidates are mostly fading/down/distribution, failed spikes, overextended, money flow is poor, the portfolio is already fragmented, or the edge is not clear after fees.',
    'When 科创50/芯片/半导体 is the clear market leader but direct 688/30 stocks are unavailable, treat liquid theme ETFs in the candidate list as the primary beta vehicle. A strong ETF beta buy is valid when the ETF itself has volume expansion, relative/sector leadership, constructive money flow, and no failed intraday spike. This is better than doing nothing while unbuyable 20cm stocks lead the tape. Prefer a controlled but meaningful ETF position over chasing unavailable STAR/ChiNext stocks.',
    'Technology panic-rebound regime: when many 科技/芯片/半导体/AI/CPO/光模块/PCB names had a sharp prior-session reversal or limit-down-to-limit-up style rebound and today shows follow-through, treat this as a separate opportunity class, not ordinary chasing. Use technologyReboundContext.previousCompletedDailyChangePct and followThroughCandidate together with volumeRatio, relative/sector rank, VWAP/intraday trend, and money flow. If direct 688/30 leaders are unbuyable, buy the strongest executable ETF or main-board proxy when its own data confirms. Avoid buying only when today becomes an unrepaired high-volume fade below VWAP, money flow fails, or price is already at/near limit-up.',
    'Use setupAssessment as a compact read of the data, not as a replacement for judgment. buyBias, qualityScore, supports, risks, vetoes, requiredConfirmations, and decisionSupport should explain the trade quality and position size. Treat vetoes as severe risk flags, not automatic execution bans, except for explicit access/execution limits such as unbuyable 30/688 stocks, limit-up/limit-down, cash, lot size, T+1, and position/capacity constraints.',
    'Add a behavioral-market layer before deciding. behavioralContext describes how retail traders may be harvested by FOMO chasing, panic selling, shakeouts, failed spikes, post-limit-up blowoff, or distribution. For every active buy/sell, explicitly address behavioralContext.trapRisk, likelyPattern, retailEmotion, mainForceHypothesis, and antiHarvestDiscipline in the reason. A buy must explain why it is not just chasing the day high; a sell must explain why it is not just selling the day low. If the likelyPattern is 拉高出货/冲高回落/涨停后诱多派发/突破次日放量冲高回落 and evidence is not repaired, avoid new buys. If the likelyPattern is 强势股盘中洗盘, do not sell a held leader at the panic low unless trend, sector, and large-order support have truly failed.',
    'Respect the two-day surge lesson: when behavioralContext.twoDaySurge.active is true, assume the third day has elevated pullback/shakeout probability. Do not chase the open or intraday high just because the prior two days were strong. A buy is still allowed when signals are explicit and broad-based: price is not overextended or has pulled back/reclaimed VWAP, volume confirms, main/super/big order flow supports, sector/relative strength remains strong, and confidence is high; size it as a pilot unless the setup is exceptional.',
    'Extra caution on yesterday limit-up or near-limit-up names: when previousCompletedDailyChangePct is at or above 9.5, treat today\'s buy as a higher-risk continuation, not a fresh bargain. Do not buy just because yesterday looked hot; require a cleaner pullback/reclaim of VWAP, solid volume confirmation, broad money-flow support, and clear room above the entry. If the next day is already weak, faded, or below VWAP, prefer hold over chasing.',
    'Post-limit-up heavy-volume warning: when postLimitUpVolumeContext shows a recent limit-up followed by previousCompletedVolumeRatio >= 2, do not treat high volume as automatically bullish. If price only rises modestly, closes near the lower half, fades below VWAP, or the next session opens/turns weak, assume relay-failure/profit-taking risk until proven otherwise. A new buy requires unusually clean confirmation: strong close or VWAP reclaim, limited high pullback, broad main/super/big-order inflow, sector leadership, and enough upside room after fees.',
    'Held stock at daily limit-up: when isAtLimitUp is true for a held ordinary stock, HOLD is the default and涨停本身不是卖出建议 because next-session continuation is valuable. If there is clear but non-critical exhaustion or risk evidence, a small partial trim may be proposed with sellRatio around 0.2-0.25; do not return sellRatio=1 or recommend a full exit merely because the position is profitable, overbought, or the local rule signal says sell. Full exit at limit-up requires confirmed severe trend damage, major negative news, or another exceptional hard-risk reason.',
    'Account originally started with CNY 50,000, but current sizing must use account.totalAsset. Any buy must be at least CNY 4,995 after lot rounding; this is an execution/fee floor, not the normal new-position size. New buy confidence should normally be at least 0.62, and preferably 0.68+ for a new symbol; below that, hold unless it is risk reduction. For new symbols, think in weights: around 20%-25% NAV for ordinary conviction, around 30%-35% NAV for high conviction, and around 10%-12% NAV for controlled probes or overextended momentum. Default new buys should be pullbacks, bottom accumulation, or modest intraday strength. Avoid buying names already up more than about 3.5% intraday unless it is an exceptional breakout/reversal with expanding volume, main/super/big order inflow, strong relative/sector rank, acceptable RSI/MA extension, above/reclaiming VWAP, and high confidence; size those exception buys as controlled probes unless conviction is exceptional. Strong A-share reversals can keep running, but do not buy at/near an unrepaired intraday high, below VWAP, after a deep high pullback, or when price is already at limit-up and execution will reject.',
    'Respect A-share T+1 through provided sell candidates. Actions may be buy, sell, hold. weight means target NAV weight for buy, max 0.95. sellRatio is 0-1 for available quantity. Sell execution is fee-aware: every non-full-exit sell must be at least CNY 5,000 and must leave a remaining position of at least CNY 5,000; if a partial sell would leave less than CNY 5,000, either choose full exit when fully sellable and exit evidence is strong, or hold. Do not split a roughly CNY 10,000 position into several small sells. Same-symbol T is encouraged only when it improves cost: for existing positions, buy only when tBuySetup or supportedBottomAccumulation is true, or when the stock is near flat/pulling back with constructive money flow. If an existing position is up more than about 1.8%-2.0% intraday, prefer hold or sell/trim available shares instead of adding, unless it is a supported bottom recovery.',
    'Sell discipline is profit-maximizing, not mechanical. Your default for a strong holding is HOLD and let profits run. Never sell only because there is a profit, a short-term pullback, a high intraday gain, or because a rule candidate says sell. Full exit requires confirmed trend damage, money-flow failure, sector rollover, hard risk/stop conditions, or a clearly superior rotation. Loosen sells for opportunity cost when the candidate pool has a clear stronger opportunity window: violent bottom reversal, sector/theme lift, or breakout with volume and money-flow confirmation. In that case, if a held position is visibly lagging that opportunity set in intraday strength, trend score, relative/sector rank, and money flow, a 25%-45% partial sell or rotation is allowed only when it satisfies the CNY 5,000 minimum sell and remaining-position rules. If the rotation window is exceptional, with a leader up strongly on volume/flow/sector confirmation while the held position has at least two clear relative weaknesses, selling 50%-60% of the laggard is allowed to free capital, even in a weak broad market, but still avoid small fragmented sells. This is not a small-up/small-down rule; it is a relative opportunity rule for freeing capital from stale holdings when better A-share setups are actually present. For swing holdings in the first hour, weak_down/below-VWAP/last-15-minute weakness is not enough for full exit when sectorMomentum or sectorRank is still supportive and super/big-order net inflow remains positive; wait until after 10:30 Asia/Shanghai or a second breakdown unless at least three core buy factors have failed. Treat negative mainNetInflow with positive super/big-order inflow as money-flow divergence, not automatic trend failure. Partial T trim is allowed only when price is visibly exhausted near resistance with fading money flow/RSI/volume evidence, and only if the trim is at least CNY 5,000 and keeps at least CNY 5,000 core; otherwise hold or full exit. Small position market value below CNY 5,000 should be full exit only when the exit is otherwise justified.',
    'Horizon is metadata, not a prison. You may upgrade an existing swing/short holding to long/core when new evidence shows a durable leader, and you may downgrade/exit long holdings when the evidence breaks. Do not let the current swing/short label force a sell or small target weight.',
    'Potential ten-bagger discipline: when a stock has strong relativeStrengthRank, leading sectorRank/sectorMomentum, constructive MA/MACD structure, expanding volume, and persistent main/super/big order inflow, classify it as long/core instead of short momentum even if the rule signal says swing/short. Tolerate normal shakeouts and ordinary pullbacks; only full-exit after confirmed trend damage, money-flow failure, sector rollover, or hard risk/stop conditions. Otherwise prefer hold or add-on-pullback. Do not T-trim a potential leader unless there is clear exhaustion plus money-flow fade.',
    'Use bottomScore, volumeRatio, mainNetInflowPct, superOrderNetInflowPct and bigOrderNetInflowPct to distinguish supported bottom accumulation from weak falling knives. Prefer bottom setups only when volume expands and large orders are net inflowing; treat large-order outflow as a sell or avoid signal. When an existing holding has bottomScore >= 80, expanded volume, and super/big-order support, do not sell only because the index is weak or mainNetInflow is negative; require confirmed technical damage, failed large-order support, sector rollover, or hard stop. If risk must be reduced, use at most a small 20%-25% trim. When candidates include tBuySetup=false and extendedIntradayGain=true, recognize that adding raises cost; only buy if expected upside clearly beats the cost/risk tradeoff, otherwise wait for a lower entry or use available shares for a T trim.',
    'Use intraday fields when available. A stock that opened/ran up strongly then fell below VWAP or turned green after a 4.5%+ first-30-minute high is a failed intraday spike, not clean strength. For held positions, failed intraday spikes with money-flow deterioration deserve at least a partial sell/trim unless longer-term leadership remains very strong. For non-held names, failed spikes are severe risk flags; buying is allowed only when you can explain why VWAP/momentum/money-flow repair is already visible and expected return justifies the risk.',
    'Treat high_volume_breakout_fade as a severe risk flag for new longs: a recent breakout/strong daily bar followed by heavy intraday volume, early strength, a deep pullback from the high, and price below VWAP is more likely profit-taking or pull-up distribution than clean bottom accumulation. Positive bottomScore or one money-flow field is not enough; if you still buy, explicitly cite VWAP reclaim, repaired 5/15-minute momentum, and broad money-flow support.',
    'Be especially skeptical after consecutive or recent limit-up days. If technical.priorTwoLimitUp/recentLimitUpCount is high and today shows a large intraday high followed by a deep pullback, treat bottomScore and positive mainNetInflow as unreliable by themselves; this can be blowoff distribution or profit-taking, not bottom accumulation. Opening a new long in that pattern requires repaired VWAP/5/15-minute momentum and broad-based money flow.',
    'Anti-harvest execution discipline: do not buy because the candle looks exciting, the name is on a leaderboard, or cash feels idle. Prefer entries where the price is near support or has reclaimed VWAP after a shakeout with large-order support. Do not sell because red candles feel scary, a position briefly turns negative, or the current price is near the intraday low. Prefer selling into failed rebounds, confirmed distribution, or broken support, and use partial trims when evidence is mixed.',
    'Use trendAssessment as the synthesized trend diagnosis across daily trend, intraday structure, money flow, relative strength, sector context, and risk. Prefer buys only when trendAssessment.direction is up/strong_up with confidence, or bottoming with improving money flow. Treat direction=fading/down or phase=failed_spike/distribution as evidence to avoid buys and consider trims/exits for held positions, unless tradingMemory and long-term leadership make the risk worth holding.',
    'Use technical fields when available: two-year daily history summary, MA5/10/20/60/120/250, MACD, RSI14, volumeSpike20, recent closes/volumes, 20/60/250-day breakouts, and distance from moving averages. Prefer setups where trend, volume, money flow and risk agree. Buying extended names is acceptable only with strong breakout confirmation, volume expansion, and money-flow support; otherwise wait for a pullback.',
    'Use relative context when available: relativeStrengthRank is rank versus the scanned universe, sectorRank and sectorMomentum describe whether its industry/theme is currently leading, and sectorAssetCount indicates signal breadth. Prefer names that are strong both individually and within strong sectors; be skeptical of isolated moves in weak sectors. Use valuation/size fields such as marketCap, floatMarketCap, peRatio, pbRatio and turnoverRate to judge quality, liquidity and speculation risk.',
    'If there is no active buy or sell, still return exactly one hold decision for the strongest/currently most relevant candidate with a concrete data reason. Do not return an empty decisions array unless the candidates list is empty.',
    JSON.stringify(promptPayload)
  ].join('\n')
  const systemMessage = 'Return one valid compact JSON object only, no markdown. Escape quotes inside strings. Example: {"decisions":[{"action":"buy","code":"600519","horizon":"swing","weight":0.55,"confidence":0.82,"reason":"..."}]}.'
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
      const response = await requestChatCompletion<{
        output_text?: unknown
        choices?: Array<{
          text?: unknown
          message?: {
            content?: unknown
            reasoning_content?: unknown
          }
        }>
      }>(
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
          temperature: 0.15,
          reasoning_effort: 'high',
          max_tokens: 1600,
          store: false
        },
        aiTimeoutMs
      )

      const content = extractAiContent(response)
      const parsed = parseAiJsonObject<{ decisions?: unknown[] }>(content, { decisions: [] })
      const validCodes = new Set(candidateSignals.map((candidate) => candidate.code))
      const validBuyCodes = new Set(candidateSignals
        .filter((candidate) => isBuyAllowedAsset(assetMap.get(candidate.code)))
        .map((candidate) => candidate.code))
      const rawDecisions = parsed.decisions ?? []
      const normalizedDecisions = rawDecisions
        .map((decision) => normalizeDecision(decision, validCodes, validBuyCodes))
        .filter((decision): decision is AiTradeDecision => Boolean(decision))
        .slice(0, 10)
      return {
        decisions: normalizedDecisions.length
          ? normalizedDecisions
          : fallbackHoldDecision(candidateSignals[0], rawDecisions.length, content),
        response,
        responseContent: content
      }
    })

    return {
      enabled: true,
      model: aiProviderModelLabel(result.provider),
      decisions: result.value.decisions,
      debug: {
        ...debugBase,
        id: `${debugBase.kind}:${debugBase.capturedAt}`,
        model: aiProviderModelLabel(result.provider),
        response: result.value.response,
        responseContent: result.value.responseContent
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
