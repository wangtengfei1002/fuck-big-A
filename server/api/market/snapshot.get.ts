import { getMarketSnapshot } from '../../utils/eastmoney'

export default defineEventHandler(async (event) => {
  const query = getQuery(event)
  const codes = typeof query.codes === 'string'
    ? query.codes.split(',').map((code) => code.trim()).filter(Boolean)
    : []

  return await getMarketSnapshot(codes.map((code) => ({
    code,
    kind: code.startsWith('5') || code.startsWith('15') || code.startsWith('16') ? 'etf' : 'stock',
    sector: code.startsWith('5') || code.startsWith('15') || code.startsWith('16') ? 'ETF' : '持仓'
  })))
})
