import type { AiMarketSummary, MarketAsset, MarketIndex, NewsItem } from '~/types/trading'

interface SummaryBody {
  marketScore: number
  indexes: MarketIndex[]
  news: NewsItem[]
  assets: MarketAsset[]
}

function normalizeText(value: unknown, fallback = '') {
  return typeof value === 'string' && value.trim() ? value.trim() : fallback
}

function compactTechnical(asset: MarketAsset) {
  const technical = asset.technical
  if (!technical) return undefined
  return {
    historyDays: technical.historyDays,
    ma20: technical.ma20,
    ma60: technical.ma60,
    ma250: technical.ma250,
    macdDiff: technical.macdDiff,
    macdDea: technical.macdDea,
    macdHist: technical.macdHist,
    rsi14: technical.rsi14,
    volumeSpike20: technical.volumeSpike20,
    closeVsMa20Pct: technical.closeVsMa20Pct,
    closeVsMa60Pct: technical.closeVsMa60Pct,
    closeVsMa250Pct: technical.closeVsMa250Pct,
    isGoldenCross: technical.isGoldenCross,
    isDeathCross: technical.isDeathCross,
    isBreakout20: technical.isBreakout20,
    isBreakout60: technical.isBreakout60,
    isBreakout250: technical.isBreakout250
  }
}

function normalizeSummary(value: unknown, model?: string): AiMarketSummary {
  const item = value && typeof value === 'object' ? value as Partial<AiMarketSummary> : {}
  const opportunities = Array.isArray(item.opportunities)
    ? item.opportunities.slice(0, 5).map((opportunity) => ({
        name: normalizeText(opportunity?.name, '待观察板块'),
        rating: opportunity?.rating === 'high' || opportunity?.rating === 'low' ? opportunity.rating : 'medium',
        reason: normalizeText(opportunity?.reason, '等待更多行情确认。'),
        examples: Array.isArray(opportunity?.examples)
          ? opportunity.examples.map((example) => normalizeText(example)).filter(Boolean).slice(0, 5)
          : []
      }))
    : []

  return {
    summary: normalizeText(item.summary, 'AI 暂未给出有效行情总结。'),
    opportunities,
    risks: Array.isArray(item.risks)
      ? item.risks.map((risk) => normalizeText(risk)).filter(Boolean).slice(0, 5)
      : [],
    updatedAt: new Date().toISOString(),
    model
  }
}

function fallbackSummary(body: SummaryBody): AiMarketSummary {
  const bySector = new Map<string, { count: number, avgChange: number, avgTrend: number, examples: string[] }>()
  for (const asset of body.assets) {
    const current = bySector.get(asset.sector) ?? { count: 0, avgChange: 0, avgTrend: 0, examples: [] }
    current.count += 1
    current.avgChange += asset.changePct
    current.avgTrend += asset.trendScore
    if (current.examples.length < 4) current.examples.push(`${asset.name} ${asset.code}`)
    bySector.set(asset.sector, current)
  }

  const opportunities = [...bySector.entries()]
    .map(([name, value]) => ({
      name,
      rating: value.avgTrend / Math.max(value.count, 1) > 68 ? 'high' as const : 'medium' as const,
      reason: `平均涨跌幅 ${(value.avgChange / Math.max(value.count, 1)).toFixed(2)}%，趋势评分 ${(value.avgTrend / Math.max(value.count, 1)).toFixed(0)}。`,
      examples: value.examples
    }))
    .sort((a, b) => (b.rating === 'high' ? 1 : 0) - (a.rating === 'high' ? 1 : 0))
    .slice(0, 4)

  return {
    summary: `规则兜底总结：当前市场评分 ${body.marketScore}，已扫描 ${body.assets.length} 个标的。优先关注强趋势、高成交额且风险分数不过热的方向。`,
    opportunities,
    risks: ['AI 总结接口未启用或调用失败，当前为规则兜底。', '高波动题材只适合小仓位观察，避免追涨。'],
    updatedAt: new Date().toISOString()
  }
}

export default defineEventHandler(async (event) => {
  const config = useRuntimeConfig()
  const body = await readBody<SummaryBody>(event)
  const aiProviders = getAiProviders(config)
  const aiTimeoutMs = getAiTimeoutMs(config.aiTimeoutMs)

  if (!aiProviders.length) {
    return {
      enabled: false,
      summary: fallbackSummary(body),
      reason: 'AI provider environment variables are not configured.'
    }
  }

  const topAssets = [...body.assets]
    .sort((a, b) => (
      b.trendScore + b.sentimentScore + b.liquidityScore + (b.bottomScore ?? 0) * 0.35 + (b.mainNetInflowPct ?? 0) * 1.2 + ((b.volumeRatio ?? 1) - 1) * 8 - b.riskScore * 0.4
    ) - (
      a.trendScore + a.sentimentScore + a.liquidityScore + (a.bottomScore ?? 0) * 0.35 + (a.mainNetInflowPct ?? 0) * 1.2 + ((a.volumeRatio ?? 1) - 1) * 8 - a.riskScore * 0.4
    ))
    .slice(0, 40)
    .map((asset) => ({
      code: asset.code,
      name: asset.name,
      kind: asset.kind,
      sector: asset.sector,
      industry: asset.industry,
      concepts: asset.concepts,
      changePct: asset.changePct,
      turnover: asset.turnover,
      turnoverRate: asset.turnoverRate,
      marketCap: asset.marketCap,
      floatMarketCap: asset.floatMarketCap,
      peRatio: asset.peRatio,
      pbRatio: asset.pbRatio,
      volumeRatio: asset.volumeRatio,
      amplitude: asset.amplitude,
      mainNetInflowPct: asset.mainNetInflowPct,
      superOrderNetInflowPct: asset.superOrderNetInflowPct,
      bigOrderNetInflowPct: asset.bigOrderNetInflowPct,
      bottomScore: asset.bottomScore,
      trendScore: asset.trendScore,
      sentimentScore: asset.sentimentScore,
      liquidityScore: asset.liquidityScore,
      riskScore: asset.riskScore,
      relativeStrengthRank: asset.relativeStrengthRank,
      sectorRank: asset.sectorRank,
      sectorMomentum: asset.sectorMomentum,
      sectorAssetCount: asset.sectorAssetCount,
      technical: compactTechnical(asset)
    }))

  const prompt = [
    '你是 A 股和普通散户可买 ETF 的盘面分析助手。只返回 JSON，不要 markdown。',
    '请基于实时指数、新闻/情绪和候选标的，总结当前整个市场，并指出哪些板块/方向更有机会。不要给保证收益，不要编造不存在的数据。',
    '输出格式：{"summary":"一句到两句总体判断","opportunities":[{"name":"板块名","rating":"high|medium|low","reason":"机会逻辑","examples":["标的A 代码","ETF 代码"]}],"risks":["风险1","风险2"]}',
    JSON.stringify({
      marketScore: body.marketScore,
      indexes: body.indexes.slice(0, 7),
      news: body.news.slice(0, 8),
      topAssets
    })
  ].join('\n')

  try {
    const result = await withAiProviderFallback(aiProviders, async (provider) => {
      const response = await requestChatCompletion<{ choices?: Array<{ message?: { content?: string } }> }>(
        aiProviderChatCompletionUrl(provider),
        aiProviderHeaders(provider),
        {
          model: provider.model,
          messages: [
            { role: 'system', content: 'Return strict JSON only.' },
            { role: 'user', content: prompt }
          ],
          temperature: 0.2,
          reasoning_effort: 'high',
          max_tokens: 1800,
          store: false
        },
        aiTimeoutMs
      )

      const content = response.choices?.[0]?.message?.content ?? ''
      const jsonText = content.match(/\{[\s\S]*\}/)?.[0] ?? '{}'
      return normalizeSummary(JSON.parse(jsonText), aiProviderModelLabel(provider))
    })

    return {
      enabled: true,
      summary: result.value
    }
  } catch (error) {
    return {
      enabled: false,
      summary: fallbackSummary(body),
      reason: getErrorMessage(error, 'AI market summary failed.')
    }
  }
})
