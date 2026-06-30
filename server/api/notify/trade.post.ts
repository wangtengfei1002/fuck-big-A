import { sendPushPlus } from '../../utils/pushplus'

interface TradeNotifyBody {
  side: 'buy' | 'sell'
  name: string
  code: string
  price: number
  quantity: number
  amount: number
  horizon: string
  confidence: number
  reason: string
  cash: number
  totalAsset: number
}

const HORIZON_LABEL: Record<string, string> = {
  long: '长线',
  swing: '波段',
  short: '短线'
}

export default defineEventHandler(async (event) => {
  const token = useRuntimeConfig().pushplusToken
  if (!token) {
    return { ok: false, reason: 'PUSHPLUS_TOKEN is not configured.' }
  }

  const body = await readBody<TradeNotifyBody>(event)
  if (!body?.side || !body.code || !body.name) {
    throw createError({ statusCode: 400, statusMessage: 'Invalid notify payload.' })
  }

  const sideLabel = body.side === 'buy' ? '买入' : '卖出'
  const horizonLabel = HORIZON_LABEL[body.horizon] ?? body.horizon
  const title = `AI ${sideLabel} ${body.name}`
  const content = [
    `${body.name} (${body.code})`,
    `${sideLabel} ${body.quantity} 股 @ ${body.price.toFixed(3)}`,
    `成交额 CNY ${body.amount.toFixed(0)}`,
    `周期 ${horizonLabel} | 置信度 ${(body.confidence * 100).toFixed(0)}%`,
    `理由：${body.reason}`,
    `现金 ${body.cash.toFixed(0)} | 总资产 ${body.totalAsset.toFixed(0)}`
  ].join('\n')

  try {
    await sendPushPlus(token, title, content)
    return { ok: true }
  } catch (error) {
    return {
      ok: false,
      reason: error instanceof Error ? error.message : 'PushPlus request failed'
    }
  }
})
