import type { AiMarketSummary, AiRequestDebug, MarketAsset, MarketIndex, NewsItem } from '~/types/trading'

interface SummaryBody {
  marketScore: number
  indexes: MarketIndex[]
  news: NewsItem[]
  assets: MarketAsset[]
}

interface SectorBucket {
  name: string
  count: number
  totalChange: number
  totalTrend: number
  totalRisk: number
  totalMainFlow: number
  flowCount: number
  advancers: number
  decliners: number
  strongCount: number
  weakCount: number
  topExamples: string[]
  weakExamples: string[]
}

function normalizeText(value: unknown, fallback = '') {
  return typeof value === 'string' && value.trim() ? value.trim() : fallback
}

function roundNumber(value: unknown, digits = 2) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return undefined
  const factor = 10 ** digits
  return Math.round(value * factor) / factor
}

function cleanPct(value: unknown, limit = 100) {
  const rounded = roundNumber(value)
  if (typeof rounded !== 'number') return undefined
  return Math.max(-limit, Math.min(limit, rounded))
}

function cleanPeRatio(asset: MarketAsset) {
  if (asset.kind === 'etf') return null
  const value = roundNumber(asset.peRatio)
  if (typeof value !== 'number' || value <= 0 || value > 300) return null
  return value
}

function cleanPbRatio(asset: MarketAsset) {
  if (asset.kind === 'etf') return null
  const value = roundNumber(asset.pbRatio)
  if (typeof value !== 'number' || value <= 0 || value > 80) return null
  return value
}

function inferEtfTheme(asset: MarketAsset) {
  if (asset.kind !== 'etf') return undefined
  const text = `${asset.name}${asset.code}`.toLowerCase()
  if (/创新药|医药|医疗|恒生医/.test(text)) return text.includes('港') || text.includes('恒生') ? '港股创新药/医疗' : '创新药/医药'
  if (/半导体|芯片|集成电路|科创芯片/.test(text)) return '半导体/芯片'
  if (/科创50|科创板|588/.test(text)) return '科创宽基'
  if (/红利|股息|分红/.test(text)) return '红利低波'
  if (/银行/.test(text)) return '银行'
  if (/证券|券商/.test(text)) return '券商'
  if (/中概|互联网|恒生科技|港股通科技|科技30/.test(text)) return '港股互联网/科技'
  if (/酒|白酒/.test(text)) return '白酒消费'
  if (/上证50|沪深300|中证500|中证1000|创业板|宽基/.test(text)) return '宽基指数'
  return 'ETF 其他主题'
}

function assetTheme(asset: MarketAsset) {
  const etfTheme = inferEtfTheme(asset)
  if (etfTheme) return etfTheme
  return normalizeText(asset.sector, normalizeText(asset.industry, '未分类'))
}

function assetLabel(asset: MarketAsset) {
  return `${asset.name} ${asset.code}`
}

function compactAsset(asset: MarketAsset) {
  const theme = assetTheme(asset)
  return {
    code: asset.code,
    name: asset.name,
    kind: asset.kind,
    theme,
    sector: asset.kind === 'etf' && asset.sector === '-' ? theme : asset.sector,
    industry: asset.kind === 'etf' && asset.industry === '-' ? theme : asset.industry,
    concepts: asset.kind === 'etf' && (!asset.concepts?.length || asset.concepts.every((item) => item === '-'))
      ? [theme]
      : asset.concepts?.slice(0, 4),
    price: roundNumber(asset.price),
    changePct: roundNumber(asset.changePct),
    turnover: roundNumber(asset.turnover, 0),
    turnoverRate: roundNumber(asset.turnoverRate),
    marketCap: roundNumber(asset.marketCap, 0),
    floatMarketCap: roundNumber(asset.floatMarketCap, 0),
    peRatio: cleanPeRatio(asset),
    pbRatio: cleanPbRatio(asset),
    volumeRatio: roundNumber(asset.volumeRatio),
    amplitude: roundNumber(asset.amplitude),
    mainNetInflowPct: cleanPct(asset.mainNetInflowPct),
    superOrderNetInflowPct: cleanPct(asset.superOrderNetInflowPct),
    bigOrderNetInflowPct: cleanPct(asset.bigOrderNetInflowPct),
    bottomScore: roundNumber(asset.bottomScore, 0),
    trendScore: roundNumber(asset.trendScore, 0),
    sentimentScore: roundNumber(asset.sentimentScore, 0),
    liquidityScore: roundNumber(asset.liquidityScore, 0),
    riskScore: roundNumber(asset.riskScore, 0),
    relativeStrengthRank: roundNumber(asset.relativeStrengthRank, 3),
    sectorRank: roundNumber(asset.sectorRank, 3),
    sectorMomentum: roundNumber(asset.sectorMomentum),
    sectorAssetCount: asset.kind === 'etf' ? undefined : asset.sectorAssetCount,
    behavioralContext: buildRetailTrapAssessment(asset),
    technical: compactTechnical(asset)
  }
}

function opportunityScore(asset: MarketAsset) {
  return asset.trendScore
    + asset.sentimentScore
    + asset.liquidityScore
    + (asset.bottomScore ?? 0) * 0.3
    + (asset.mainNetInflowPct ?? 0) * 0.8
    + ((asset.volumeRatio ?? 1) - 1) * 6
    - asset.riskScore * 0.45
}

function buildBreadth(assets: MarketAsset[], indexes: MarketIndex[]) {
  const total = assets.length
  const advancers = assets.filter((asset) => asset.changePct > 0).length
  const decliners = assets.filter((asset) => asset.changePct < 0).length
  const flat = Math.max(0, total - advancers - decliners)
  const changes = assets.map((asset) => asset.changePct).sort((a, b) => a - b)
  const medianChange = changes.length ? changes[Math.floor(changes.length / 2)] : 0
  const avgChange = total ? assets.reduce((sum, asset) => sum + asset.changePct, 0) / total : 0
  const avgIndexBreadth = indexes.length ? indexes.reduce((sum, index) => sum + index.breadth, 0) / indexes.length : 0
  return {
    scannedAssets: total,
    advancers,
    decliners,
    flat,
    advancePct: total ? roundNumber((advancers / total) * 100) : 0,
    declinePct: total ? roundNumber((decliners / total) * 100) : 0,
    strongUpCount: assets.filter((asset) => asset.changePct >= 3).length,
    strongDownCount: assets.filter((asset) => asset.changePct <= -3).length,
    limitLikeUpCount: assets.filter((asset) => asset.kind === 'stock' && asset.changePct >= 9.7).length,
    avgChangePct: roundNumber(avgChange),
    medianChangePct: roundNumber(medianChange),
    avgIndexBreadth: roundNumber(avgIndexBreadth)
  }
}

function buildSectorStats(assets: MarketAsset[]) {
  const buckets = new Map<string, SectorBucket>()
  for (const asset of assets) {
    const name = assetTheme(asset)
    const current = buckets.get(name) ?? {
      name,
      count: 0,
      totalChange: 0,
      totalTrend: 0,
      totalRisk: 0,
      totalMainFlow: 0,
      flowCount: 0,
      advancers: 0,
      decliners: 0,
      strongCount: 0,
      weakCount: 0,
      topExamples: [],
      weakExamples: []
    }
    current.count += 1
    current.totalChange += asset.changePct
    current.totalTrend += asset.trendScore
    current.totalRisk += asset.riskScore
    if (typeof asset.mainNetInflowPct === 'number' && Number.isFinite(asset.mainNetInflowPct)) {
      current.totalMainFlow += cleanPct(asset.mainNetInflowPct) ?? 0
      current.flowCount += 1
    }
    if (asset.changePct > 0) current.advancers += 1
    if (asset.changePct < 0) current.decliners += 1
    if (asset.changePct >= 3) current.strongCount += 1
    if (asset.changePct <= -3) current.weakCount += 1
    if (asset.changePct > 0 && current.topExamples.length < 4) current.topExamples.push(assetLabel(asset))
    if (asset.changePct < 0 && current.weakExamples.length < 3) current.weakExamples.push(assetLabel(asset))
    buckets.set(name, current)
  }

  const stats = [...buckets.values()]
    .filter((bucket) => bucket.count >= 2 || bucket.strongCount > 0)
    .map((bucket) => ({
      name: bucket.name,
      count: bucket.count,
      avgChangePct: roundNumber(bucket.totalChange / Math.max(bucket.count, 1)),
      advancePct: roundNumber((bucket.advancers / Math.max(bucket.count, 1)) * 100),
      strongCount: bucket.strongCount,
      weakCount: bucket.weakCount,
      avgTrendScore: roundNumber(bucket.totalTrend / Math.max(bucket.count, 1), 0),
      avgRiskScore: roundNumber(bucket.totalRisk / Math.max(bucket.count, 1), 0),
      avgMainNetInflowPct: bucket.flowCount ? roundNumber(bucket.totalMainFlow / bucket.flowCount) : undefined,
      topExamples: bucket.topExamples,
      weakExamples: bucket.weakExamples
    }))

  return {
    leaders: [...stats]
      .sort((a, b) => ((b.avgChangePct ?? 0) + b.strongCount * 0.8 + (b.advancePct ?? 0) * 0.03) - ((a.avgChangePct ?? 0) + a.strongCount * 0.8 + (a.advancePct ?? 0) * 0.03))
      .slice(0, 8),
    laggards: [...stats]
      .sort((a, b) => ((a.avgChangePct ?? 0) - a.weakCount * 0.8 + (a.advancePct ?? 0) * 0.02) - ((b.avgChangePct ?? 0) - b.weakCount * 0.8 + (b.advancePct ?? 0) * 0.02))
      .slice(0, 6)
  }
}

function chinaMarketClock() {
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
  const value = (type: string) => parts.find((part) => part.type === type)?.value ?? '00'
  const hour = Number(value('hour'))
  const minute = Number(value('minute'))
  const minutes = hour * 60 + minute
  const phase = minutes < 9 * 60 + 25
    ? 'pre_open'
    : minutes <= 10 * 60
      ? 'opening'
      : minutes <= 11 * 60 + 30
        ? 'morning'
        : minutes < 13 * 60
          ? 'midday_break'
          : minutes < 14 * 60 + 50
            ? 'afternoon'
            : minutes <= 15 * 60
              ? 'closing'
              : 'after_close'
  return {
    date: `${value('year')}-${value('month')}-${value('day')}`,
    time: `${value('hour')}:${value('minute')}:${value('second')}`,
    timezone: 'Asia/Shanghai',
    phase
  }
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
        approach: normalizeText(opportunity?.approach),
        trigger: normalizeText(opportunity?.trigger),
        invalid: normalizeText(opportunity?.invalid),
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
  const breadth = buildBreadth(body.assets, body.indexes)
  const sectorStats = buildSectorStats(body.assets)
  const opportunities = sectorStats.leaders
    .map((sector) => ({
      name: sector.name,
      rating: body.marketScore < 50 || (sector.avgRiskScore ?? 0) >= 75 ? 'medium' as const : (sector.avgTrendScore ?? 0) > 72 ? 'high' as const : 'medium' as const,
      reason: `平均涨跌幅 ${(sector.avgChangePct ?? 0).toFixed(2)}%，上涨占比 ${(sector.advancePct ?? 0).toFixed(0)}%，趋势评分 ${sector.avgTrendScore ?? 0}，风险分 ${sector.avgRiskScore ?? 0}。`,
      approach: body.marketScore < 50 ? '弱市只观察回踩承接，不追涨。' : '优先等待放量确认或回踩不破。',
      trigger: '板块上涨占比继续高于 60%，核心标的不跌破日内均价。',
      invalid: '指数继续走弱或板块内强势标的批量回落。',
      examples: sector.topExamples
    }))
    .slice(0, 4)

  return {
    summary: `规则兜底总结：当前市场评分 ${body.marketScore}，已扫描 ${breadth.scannedAssets} 个标的，平均涨跌幅 ${breadth.avgChangePct}%，上涨占比 ${breadth.advancePct}%。弱市优先看结构性机会和风控。`,
    opportunities,
    risks: ['AI 总结接口未启用或调用失败，当前为规则兜底。', '高波动题材只适合小仓位观察，避免追涨。', '若临近收盘仍未放量修复，隔夜风险高于盘中机会。'],
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

  const breadth = buildBreadth(body.assets, body.indexes)
  const sectorStats = buildSectorStats(body.assets)
  const topAssets = [...body.assets]
    .sort((a, b) => opportunityScore(b) - opportunityScore(a))
    .slice(0, 24)
    .map(compactAsset)
  const weakAssets = [...body.assets]
    .sort((a, b) => (a.changePct + a.trendScore * 0.03 - a.riskScore * 0.03) - (b.changePct + b.trendScore * 0.03 - b.riskScore * 0.03))
    .slice(0, 16)
    .map(compactAsset)
  const realNews = body.news
    .filter((item) => !(item.tags.includes('live') && item.tags.includes('quotes')))
    .slice(0, 8)
  const marketScanNotes = body.news
    .filter((item) => item.tags.includes('live') || item.tags.includes('quotes'))
    .slice(0, 4)

  const promptPayload = {
    marketScore: body.marketScore,
    marketClock: chinaMarketClock(),
    fieldGuide: {
      scoreRange: 'bottomScore/trendScore/sentimentScore/liquidityScore/riskScore are 0-100.',
      riskScore: 'Higher riskScore means hotter or more fragile price action, not safer.',
      bottomScore: 'Higher bottomScore means bottoming/repair potential, not an automatic buy signal.',
      relativeStrengthRank: '0-1 rank; higher means stronger relative performance in scanned universe.',
      pePb: 'peRatio/pbRatio are null when unavailable, invalid, or ETF-specific.'
    },
    behavioralFieldGuide: {
      trapRisk: 'low/medium/high estimate of whether the current price action may harvest retail traders.',
      likelyPattern: 'Examples: 拉高出货/冲高回落, 涨停后诱多派发, 情绪追高拥挤, 强势股盘中洗盘, 恐慌杀跌, 低位承接/吸筹.',
      twoDaySurge: 'When active, the asset had a recent two-day surge and the third day has elevated pullback/shakeout risk; strong confirmation can still justify a pilot buy.',
      antiHarvest: 'Prefer pullback support and VWAP reclaim for buys; avoid panic sells near the intraday low unless evidence confirms breakdown.'
    },
    indexes: body.indexes.slice(0, 7),
    marketBreadth: breadth,
    sectorStats,
    marketScanNotes,
    realNews,
    topAssets,
    weakAssets
  }
  const prompt = [
    '你是 A 股和普通散户可买 ETF 的盘面分析助手。只返回 JSON，不要 markdown。',
    '请同时参考指数、市场宽度、强势候选、弱势样本、板块统计、真实新闻和扫描摘要，总结当前市场。topAssets 是强势筛选结果，不能代表全市场；必须用 marketBreadth/weakAssets/sectorStats 交叉校验。',
    '若 marketScore 低于 50，默认按弱市/结构性行情处理：除非板块上涨占比、成交、资金和风险分都支持，否则不要给 high；临近收盘时要区分“今日可操作”和“次日观察”。',
    '必须加入散户行为和反收割视角：识别今天市场是在奖励低吸承接，还是在用拉高出货、冲高回落、涨停后诱多、恐慌杀跌洗出筹码。机会的 approach/trigger/invalid 里要写清楚如何避免买在日内高点、卖在日内低点。不要断言主力一定操纵，只能基于 behavioralContext、资金流、VWAP、板块宽度提出假设。',
    '如果强势候选里有 behavioralContext.twoDaySurge.active=true，要提示二连大涨第三日的回调概率，不把连续上涨本身当作追买理由；但在明确放量、资金、VWAP 和板块共振时，可列为小仓位跟踪机会。',
    '不要编造新闻、政策、财报或不存在的数据。realNews 为空时只能说缺少外部消息面，marketScanNotes 只是扫描摘要，不是真实新闻。',
    '输出格式：{"summary":"一句到两句总体判断，必须包含强弱结构和仓位倾向","opportunities":[{"name":"板块名或主题","rating":"high|medium|low","reason":"机会逻辑，必须提到宽度/强弱/风险之一","approach":"低吸/突破跟随/只观察/不追高等操作方式","trigger":"继续跟踪或行动触发条件","invalid":"机会失效条件","examples":["标的A 代码","ETF 代码"]}],"risks":["风险1","风险2"]}',
    JSON.stringify(promptPayload)
  ].join('\n')
  const systemMessage = 'Return one valid compact JSON object only, no markdown. Escape quotes inside strings.'
  const debugBase: Omit<AiRequestDebug, 'id' | 'model'> = {
    kind: 'market-summary',
    title: 'AI 行情总结',
    endpoint: '/api/ai/market-summary',
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
            { role: 'system', content: systemMessage },
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
      return normalizeSummary(parseAiJsonObject(content, {}), aiProviderModelLabel(provider))
    })

    return {
      enabled: true,
      summary: result.value,
      debug: {
        ...debugBase,
        id: `${debugBase.kind}:${debugBase.capturedAt}`,
        model: aiProviderModelLabel(result.provider)
      }
    }
  } catch (error) {
    return {
      enabled: false,
      summary: fallbackSummary(body),
      reason: getErrorMessage(error, 'AI market summary failed.'),
      debug: {
        ...debugBase,
        id: `${debugBase.kind}:${debugBase.capturedAt}`
      }
    }
  }
})
