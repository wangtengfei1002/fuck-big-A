import type { AiClosedPositionReview, ClosedPositionSnapshot } from '~/types/trading'

interface ReviewBody {
  item: ClosedPositionSnapshot
}

function normalizeText(value: unknown, fallback = '') {
  return typeof value === 'string' && value.trim() ? value.trim() : fallback
}

function normalizeList(value: unknown) {
  return Array.isArray(value)
    ? value.map((item) => normalizeText(item)).filter(Boolean).slice(0, 5)
    : []
}

function fallbackReview(item: ClosedPositionSnapshot, model?: string): AiClosedPositionReview {
  const outcome = item.postExitChangePct >= 5
    ? 'missed_upside'
    : item.postExitChangePct <= -5
      ? 'protected_downside'
      : 'neutral'
  return {
    code: item.code,
    name: item.name,
    outcome,
    summary: `清仓后涨跌幅 ${item.postExitChangePct.toFixed(2)}%，先记录交易结果，等待 AI 复盘给出更完整归因。`,
    mistakes: outcome === 'missed_upside' ? ['清仓后继续上涨，可能卖出过早或没有识别趋势延续。'] : [],
    strengths: outcome === 'protected_downside' ? ['清仓后继续下跌，说明当时的风控或止盈止损执行有效。'] : [],
    ruleIdeas: ['后续可结合卖出原因、趋势破坏、资金流和板块强度复核卖出规则。'],
    updatedAt: new Date().toISOString(),
    model
  }
}

function normalizeReview(value: unknown, item: ClosedPositionSnapshot, model?: string): AiClosedPositionReview {
  const parsed = value && typeof value === 'object' ? value as Partial<AiClosedPositionReview> : {}
  const outcome = parsed.outcome === 'missed_upside' || parsed.outcome === 'protected_downside' || parsed.outcome === 'neutral'
    ? parsed.outcome
    : item.postExitChangePct >= 5
      ? 'missed_upside'
      : item.postExitChangePct <= -5
        ? 'protected_downside'
        : 'neutral'

  return {
    code: item.code,
    name: item.name,
    outcome,
    summary: normalizeText(parsed.summary, fallbackReview(item).summary),
    mistakes: normalizeList(parsed.mistakes),
    strengths: normalizeList(parsed.strengths),
    ruleIdeas: normalizeList(parsed.ruleIdeas),
    updatedAt: new Date().toISOString(),
    model
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
  const body = await readBody<ReviewBody>(event)
  const item = body.item
  const aiBaseUrl = config.aiBaseUrl
  const aiApiKey = config.aiApiKey
  const aiModel = config.aiModel || 'gpt-5.5'
  const aiTimeoutMs = getAiTimeoutMs(config.aiTimeoutMs)

  if (!item?.code) {
    throw createError({ statusCode: 400, statusMessage: 'Missing closed position snapshot.' })
  }

  if (!aiBaseUrl || !aiApiKey) {
    return {
      enabled: false,
      review: fallbackReview(item),
      reason: 'AI environment variables are not configured.'
    }
  }

  const prompt = [
    '你是 A 股模拟交易系统的交易复盘助手。只返回 JSON，不要 markdown。',
    '任务：分析一个已经清仓的标的。重点比较清仓均价与当前价：如果清仓后明显上涨，要找当时卖早、误判趋势、规则过紧或忽略资金/板块强度的失误；如果清仓后明显下跌，要总结当时风控、止盈止损、回避风险做对的地方。',
    '优先参考 decisionSnapshots：里面是每次成交当时保存的 AI/规则原始理由、账户状态、市场指数、新闻和标的快照。复盘要区分“当时信息下是否合理”和“事后结果是否暴露规则缺陷”。',
    '请把结论写得能直接用于后续优化交易规则，避免空泛鸡汤，不要编造输入里没有的数据。',
    '输出格式：{"outcome":"missed_upside|protected_downside|neutral","summary":"一句总体复盘","mistakes":["失误点"],"strengths":["做得好的点"],"ruleIdeas":["可转成规则优化的建议"]}',
    JSON.stringify({
      closedPosition: {
        code: item.code,
        name: item.name,
        horizon: item.horizon,
        buyQuantity: item.buyQuantity,
        sellQuantity: item.sellQuantity,
        realizedPnl: item.realizedPnl,
        totalFee: item.totalFee,
        averageBuyPrice: item.averageBuyPrice,
        averageExitPrice: item.averageExitPrice,
        currentPrice: item.currentPrice,
        postExitChangePct: item.postExitChangePct,
        lastTradeDate: item.lastTradeDate,
        lastTime: item.lastTime,
        tradeReasons: item.tradeReasons.slice(0, 10),
        decisionSnapshots: item.decisionSnapshots.slice(0, 8)
      },
      currentAssetContext: item.asset
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
          { role: 'system', content: 'Return strict JSON only.' },
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
    const jsonText = content.match(/\{[\s\S]*\}/)?.[0] ?? '{}'
    return {
      enabled: true,
      review: normalizeReview(JSON.parse(jsonText), item, aiModel)
    }
  } catch (error) {
    return {
      enabled: false,
      review: fallbackReview(item, aiModel),
      reason: getErrorMessage(error, 'AI closed position review failed.')
    }
  }
})
