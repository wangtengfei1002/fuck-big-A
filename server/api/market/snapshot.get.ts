import { MarketSnapshotError, getMarketSnapshot } from '../../utils/eastmoney'

export default defineEventHandler(async (event) => {
  const query = getQuery(event)
  const codes = typeof query.codes === 'string'
    ? query.codes.split(',').map((code) => code.trim()).filter(Boolean)
    : []

  try {
    return await getMarketSnapshot(codes.map((code) => ({
      code,
      kind: code.startsWith('5') || code.startsWith('15') || code.startsWith('16') ? 'etf' : 'stock',
      sector: code.startsWith('5') || code.startsWith('15') || code.startsWith('16') ? 'ETF' : '持仓'
    })))
  } catch (error) {
    console.error('[api/market/snapshot] upstream failed', error)
    const diagnostics = error instanceof MarketSnapshotError ? error.diagnostics : []
    return {
      source: 'fallback',
      updatedAt: new Date().toISOString(),
      indexes: [],
      assets: [],
      news: [],
      error: error instanceof Error ? error.message : 'Market snapshot failed',
      diagnostics
    }
  }
})
