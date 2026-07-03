import type { AiAssetAnalysis, MarketAsset, MarketIndex, NewsItem, Position, RuleAssetAnalysis } from '~/types/trading'

interface AssetAnalysisBody {
  asset: MarketAsset
  ruleAnalysis: RuleAssetAnalysis
  position?: Position
  account: {
    cash: number
    totalAsset: number
    marketValue: number
    marketScore: number
  }
  indexes: MarketIndex[]
  news: NewsItem[]
}

function normalizeText(value: unknown, fallback = '') {
  return typeof value === 'string' && value.trim() ? value.trim() : fallback
}

function normalizeList(value: unknown) {
  return Array.isArray(value)
    ? value.map((item) => normalizeText(item)).filter(Boolean).slice(0, 5)
    : []
}

function compactTechnical(asset: MarketAsset) {
  const technical = asset.technical
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
    volumeSpike20: technical.volumeSpike20,
    closeVsMa20Pct: technical.closeVsMa20Pct,
    closeVsMa60Pct: technical.closeVsMa60Pct,
    closeVsMa250Pct: technical.closeVsMa250Pct,
    isGoldenCross: technical.isGoldenCross,
    isDeathCross: technical.isDeathCross,
    isBreakout20: technical.isBreakout20,
    isBreakout60: technical.isBreakout60,
    isBreakout250: technical.isBreakout250,
    recentCloses: technical.closes.slice(-20),
    recentVolumes: technical.volumes.slice(-20)
  }
}

function fallbackAnalysis(body: AssetAnalysisBody, model?: string): AiAssetAnalysis {
  const { asset, ruleAnalysis, position } = body
  const hasPosition = Boolean(position)
  const summary = ruleAnalysis.action === 'buy'
    ? `${asset.name} 现在有买入信号，但不要只看它在涨，重点看成交量、资金流和板块强度能不能继续配合。`
    : ruleAnalysis.action === 'sell'
      ? `${asset.name} 已经触发卖出/风控信号，先把风险放在第一位。`
      : hasPosition
        ? `${asset.name} 目前更像是继续拿着观察，暂时没有强到必须加仓，也没有明确到必须卖出。`
        : `${asset.name} 现在先观望，规则层没有给出足够清楚的买点。`

  return {
    code: asset.code,
    name: asset.name,
    action: ruleAnalysis.action,
    label: ruleAnalysis.label,
    summary,
    reasons: [
      `现价 ${asset.price.toFixed(asset.price < 10 ? 3 : 2)}，今日涨跌 ${asset.changePct.toFixed(2)}%。`,
      ruleAnalysis.reason
    ],
    risks: [
      asset.riskScore >= 70 ? '风险分偏高，追进去容易吃波动。' : '还需要继续看资金流和板块持续性。',
      '当前为模拟交易分析，不代表确定收益。'
    ],
    nextSteps: [
      ruleAnalysis.action === 'buy' ? '如果要买，等价格和量能稳定后按一手整数执行。' : '先等下一轮实时行情刷新后再看。',
      hasPosition ? '已有持仓时优先看可卖数量、T+1 锁定和止损纪律。' : '没有持仓时不要因为单日波动冲动追高。'
    ],
    updatedAt: new Date().toISOString(),
    model
  }
}

function normalizeAnalysis(value: unknown, body: AssetAnalysisBody, model?: string): AiAssetAnalysis {
  const parsed = value && typeof value === 'object' ? value as Partial<AiAssetAnalysis> : {}
  const fallback = fallbackAnalysis(body, model)
  const action = parsed.action === 'buy' || parsed.action === 'sell' || parsed.action === 'hold'
    ? parsed.action
    : fallback.action
  const label = parsed.label === '买入' || parsed.label === '卖出' || parsed.label === '继续持有' || parsed.label === '观望'
    ? parsed.label
    : action === 'buy'
      ? '买入'
      : action === 'sell'
        ? '卖出'
        : body.position
          ? '继续持有'
          : '观望'

  return {
    code: body.asset.code,
    name: body.asset.name,
    action,
    label,
    summary: normalizeText(parsed.summary, fallback.summary),
    reasons: normalizeList(parsed.reasons).length ? normalizeList(parsed.reasons) : fallback.reasons,
    risks: normalizeList(parsed.risks).length ? normalizeList(parsed.risks) : fallback.risks,
    nextSteps: normalizeList(parsed.nextSteps).length ? normalizeList(parsed.nextSteps) : fallback.nextSteps,
    updatedAt: new Date().toISOString(),
    model
  }
}

export default defineEventHandler(async (event) => {
  const config = useRuntimeConfig()
  const body = await readBody<AssetAnalysisBody>(event)
  const aiProviders = getAiProviders(config)
  const aiTimeoutMs = getAiTimeoutMs(config.aiTimeoutMs)

  if (!body.asset?.code || !body.ruleAnalysis?.code) {
    throw createError({ statusCode: 400, statusMessage: 'Missing asset analysis payload.' })
  }

  if (!aiProviders.length) {
    return {
      enabled: false,
      analysis: fallbackAnalysis(body),
      reason: 'AI provider environment variables are not configured.'
    }
  }

  const asset = body.asset
  const prompt = [
    '你是 A 股模拟交易系统里的单票实时分析助手。只返回 JSON，不要 markdown。',
    '用户要大白话，不要堆评分。请像给普通人解释一样，说清楚：这票现在能不能碰、为什么、主要风险是什么、下一步该盯什么。',
    '不要给保证收益，不要编造输入里没有的数据。可以参考规则层结论，但不要复述分数；需要结合实时价格、涨跌、资金流、均线、板块、持仓和账户情况。',
    '输出格式：{"action":"buy|sell|hold","label":"买入|卖出|继续持有|观望","summary":"一句大白话结论","reasons":["理由"],"risks":["风险"],"nextSteps":["下一步"]}',
    JSON.stringify({
      account: body.account,
      indexes: body.indexes.slice(0, 5),
      news: body.news.slice(0, 6),
      position: body.position,
      ruleConclusion: {
        action: body.ruleAnalysis.action,
        label: body.ruleAnalysis.label,
        horizon: body.ruleAnalysis.horizon,
        reason: body.ruleAnalysis.reason
      },
      asset: {
        code: asset.code,
        name: asset.name,
        kind: asset.kind,
        sector: asset.sector,
        industry: asset.industry,
        concepts: asset.concepts,
        price: asset.price,
        previousClose: asset.previousClose,
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
        relativeStrengthRank: asset.relativeStrengthRank,
        sectorRank: asset.sectorRank,
        sectorMomentum: asset.sectorMomentum,
        technical: compactTechnical(asset)
      }
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
          max_tokens: 1400,
          store: false
        },
        aiTimeoutMs
      )

      const content = response.choices?.[0]?.message?.content ?? ''
      const jsonText = content.match(/\{[\s\S]*\}/)?.[0] ?? '{}'
      return normalizeAnalysis(JSON.parse(jsonText), body, aiProviderModelLabel(provider))
    })

    return {
      enabled: true,
      analysis: result.value
    }
  } catch (error) {
    return {
      enabled: false,
      analysis: fallbackAnalysis(body),
      reason: getErrorMessage(error, 'AI asset analysis failed.')
    }
  }
})
