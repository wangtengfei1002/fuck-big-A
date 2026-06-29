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
      kind: asset?.kind
    }
  })

  const prompt = [
    'You are an A-share simulated trading decision layer. Return strict JSON only.',
    'Goal: capture strong A-share/retail ETF opportunities and maximize simulated profit. Tradable universe includes ordinary A-shares and retail-buyable ETFs. Do not prefer ETF by default; choose stocks or ETFs purely by expected opportunity.',
    'Account starts with CNY 50,000. Any buy must be at least CNY 4,995 after lot rounding, but this is only a fee floor, not a target size. Avoid chasing: do not buy names that already jumped hard intraday unless the setup is exceptional and explain why it is not a momentum chase.',
    'Respect A-share T+1 through provided sell candidates. Actions may be buy, sell, hold. weight means target NAV weight for buy, max 0.95. sellRatio is 0-1 for available quantity. Avoid weak diversification; prefer sparse, high-conviction decisions and hold cash when edge is unclear.',
    'Sell discipline is strict: if current position market value is below CNY 5,000, only request a full exit; otherwise each partial sell must be at least CNY 5,000 after lot rounding. Do not suggest tiny profit-taking sells.',
    'Horizon discipline is strict. long means hold through normal volatility and avoid selling within about 10 trading days unless hard risk/stop conditions appear. swing normally needs at least 3 trading days. short may trade faster. Never sell a long holding the next day just because short-term momentum cools.',
    'Use bottomScore, volumeRatio, mainNetInflowPct, superOrderNetInflowPct and bigOrderNetInflowPct to distinguish supported bottom accumulation from weak falling knives. Prefer bottom setups only when volume expands and large orders are net inflowing; treat large-order outflow as a sell or avoid signal.',
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
    const response = await $fetch<{ choices?: Array<{ message?: { content?: string } }> }>(`${aiBaseUrl.replace(/\/$/, '')}/chat/completions`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${aiApiKey}`,
        'Content-Type': 'application/json'
      },
      body: {
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
      timeout: aiTimeoutMs
    })

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
