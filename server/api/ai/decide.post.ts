import type { AiTradeDecision, MarketAsset, MarketIndex, NewsItem, Position, StrategySignal } from '~/types/trading'

interface DecideBody {
  cash: number
  totalAsset: number
  marketValue: number
  marketScore: number
  indexes: MarketIndex[]
  news: NewsItem[]
  positions: Position[]
  candidates: StrategySignal[]
  assets: MarketAsset[]
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value))
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
    recentCloses: technical.closes.slice(-30),
    recentVolumes: technical.volumes.slice(-30)
  }
}

function normalizeDecision(value: unknown, validCodes: Set<string>): AiTradeDecision | null {
  if (!value || typeof value !== 'object') return null
  const item = value as Partial<AiTradeDecision>
  if (!item.code || !validCodes.has(item.code)) return null
  if (item.action !== 'buy' && item.action !== 'sell' && item.action !== 'hold') return null
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

async function requestChatCompletion<T>(url: string, headers: Record<string, string>, body: Record<string, unknown>, timeout: number) {
  try {
    return await $fetch<T>(url, {
      method: 'POST',
      headers,
      body,
      timeout
    })
  } catch (error) {
    const message = getErrorMessage(error, '')
    const canRetryWithoutOpenAiExtras = /reasoning_effort|store|unsupported|unrecognized|unknown|invalid/i.test(message)
    if (!canRetryWithoutOpenAiExtras) throw error

    const { reasoning_effort: _reasoningEffort, store: _store, ...compatibleBody } = body
    return await $fetch<T>(url, {
      method: 'POST',
      headers,
      body: compatibleBody,
      timeout
    })
  }
}

export default defineEventHandler(async (event) => {
  const config = useRuntimeConfig()
  const body = await readBody<DecideBody>(event)
  const aiBaseUrl = config.aiBaseUrl
  const aiApiKey = config.aiApiKey
  const aiModel = config.aiModel || 'gpt-5.5'
  const aiTimeoutMs = getAiTimeoutMs(config.aiTimeoutMs)

  if (!aiBaseUrl || !aiApiKey) {
    return {
      enabled: false,
      decisions: [] as AiTradeDecision[],
      reason: 'AI environment variables are not configured.'
    }
  }

  const assetMap = new Map(body.assets.map((asset) => [asset.code, asset]))
  const compactAssets = body.candidates.slice(0, 60).map((signal) => {
    const asset = assetMap.get(signal.code)
    return {
      code: signal.code,
      name: signal.name,
      action: signal.action,
      horizon: signal.horizon,
      score: signal.score,
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
      technical: compactTechnical(asset)
    }
  })

  const prompt = [
    'You are an A-share simulated trading decision layer. Return strict JSON only.',
    'Goal: capture strong A-share/retail ETF opportunities and maximize simulated profit. Tradable universe includes ordinary A-shares and retail-buyable ETFs. Do not prefer ETF by default; choose stocks or ETFs purely by expected opportunity.',
    'Account starts with CNY 50,000. Any buy must be at least CNY 4,995 after lot rounding, but this is only a fee floor, not a target size. Chasing is allowed when the tape is visibly strong: breakout, expanding volume, main/super/big order inflow, strong relative/sector rank, and acceptable RSI/MA extension. Size chase buys smaller than clean pullback buys and explain why the momentum is confirmed rather than blind chasing.',
    'Respect A-share T+1 through provided sell candidates. Actions may be buy, sell, hold. weight means target NAV weight for buy, max 0.95. sellRatio is 0-1 for available quantity. Be more opportunistic when edge is visible: repeated buy/sell decisions on the same symbol are allowed for T-style simulation, especially trim high and rebuy pullbacks.',
    'Sell discipline is active, not mechanical. If a holding is strong in trend, sector, volume and money flow, do not full-exit only because it has profit; trim 20%-35% at intraday strength and keep a core. If trend, money flow, sector breadth or risk clearly deteriorates, be decisive with profit-taking or stop-loss. Current position market value below CNY 5,000 should still be full exit only.',
    'Horizon is guidance, not a prison. Good tape can justify holding long/swing positions indefinitely; bad tape can justify early exit. For short/T trades, selling strength and buying back lower is encouraged when price action, volume and money flow support it.',
    'Potential ten-bagger discipline: when a stock has strong relativeStrengthRank, leading sectorRank/sectorMomentum, constructive MA/MACD structure, expanding volume, and persistent main/super/big order inflow, classify it as long/core instead of short momentum. Tolerate normal shakeouts; only full-exit after confirmed trend damage, money-flow failure, sector rollover, or hard risk/stop conditions. Otherwise prefer partial T trims.',
    'Use bottomScore, volumeRatio, mainNetInflowPct, superOrderNetInflowPct and bigOrderNetInflowPct to distinguish supported bottom accumulation from weak falling knives. Prefer bottom setups only when volume expands and large orders are net inflowing; treat large-order outflow as a sell or avoid signal.',
    'Use technical fields when available: two-year daily history summary, MA5/10/20/60/120/250, MACD, RSI14, volumeSpike20, recent closes/volumes, 20/60/250-day breakouts, and distance from moving averages. Prefer setups where trend, volume, money flow and risk agree. Buying extended names is acceptable only with strong breakout confirmation, volume expansion, and money-flow support; otherwise wait for a pullback.',
    'Use relative context when available: relativeStrengthRank is rank versus the scanned universe, sectorRank and sectorMomentum describe whether its industry/theme is currently leading, and sectorAssetCount indicates signal breadth. Prefer names that are strong both individually and within strong sectors; be skeptical of isolated moves in weak sectors. Use valuation/size fields such as marketCap, floatMarketCap, peRatio, pbRatio and turnoverRate to judge quality, liquidity and speculation risk.',
    JSON.stringify({
      account: {
        cash: body.cash,
        totalAsset: body.totalAsset,
        marketValue: body.marketValue,
        marketScore: body.marketScore
      },
      indexes: body.indexes.slice(0, 5),
      news: body.news.slice(0, 8),
      positions: body.positions,
      candidates: compactAssets
    })
  ].join('\n')

  try {
    const response = await requestChatCompletion<{ choices?: Array<{ message?: { content?: string } }> }>(
      `${aiBaseUrl.replace(/\/$/, '')}/chat/completions`,
      {
        Authorization: `Bearer ${aiApiKey}`,
        'Content-Type': 'application/json'
      },
      {
        model: aiModel,
        messages: [
          {
            role: 'system',
            content: 'Return JSON like {"decisions":[{"action":"buy","code":"300750","horizon":"swing","weight":0.55,"confidence":0.82,"reason":"..."}]}. No markdown.'
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
    const validCodes = new Set(body.candidates.map((candidate) => candidate.code))
    const decisions = (parsed.decisions ?? [])
      .map((decision) => normalizeDecision(decision, validCodes))
      .filter((decision): decision is AiTradeDecision => Boolean(decision))
      .slice(0, 10)

    return {
      enabled: true,
      model: aiModel,
      decisions
    }
  } catch (error) {
    return {
      enabled: false,
      decisions: [] as AiTradeDecision[],
      reason: getErrorMessage(error, 'AI decision failed.')
    }
  }
})
