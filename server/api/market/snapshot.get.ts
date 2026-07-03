import { MarketSnapshotError, getMarketSnapshot } from '../../utils/eastmoney'

const MARKET_OPEN_MINUTE = 9 * 60 + 25
const MARKET_MORNING_CLOSE_MINUTE = 11 * 60 + 30
const MARKET_AFTERNOON_OPEN_MINUTE = 13 * 60
const MARKET_CLOSE_MINUTE = 15 * 60

function isChinaMarketWindow() {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Shanghai',
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  }).formatToParts(new Date())
  const get = (type: string) => parts.find((part) => part.type === type)?.value ?? ''
  const weekday = get('weekday')
  if (weekday === 'Sat' || weekday === 'Sun') return false
  const currentMinute = Number(get('hour')) * 60 + Number(get('minute'))
  return (currentMinute >= MARKET_OPEN_MINUTE && currentMinute <= MARKET_MORNING_CLOSE_MINUTE)
    || (currentMinute >= MARKET_AFTERNOON_OPEN_MINUTE && currentMinute <= MARKET_CLOSE_MINUTE)
}

function isForced(value: unknown) {
  return value === true || value === 'true' || value === '1' || value === 1
}

export default defineEventHandler(async (event) => {
  const query = getQuery(event)
  const allowOutsideMarketHours = isForced(query.force) || isForced(query.allowOutsideMarketHours)
  const codes = typeof query.codes === 'string'
    ? query.codes.split(',').map((code) => code.trim()).filter(Boolean)
    : []

  try {
    if (!allowOutsideMarketHours && !isChinaMarketWindow()) {
      return {
        source: 'closed',
        updatedAt: new Date().toISOString(),
        indexes: [],
        assets: [],
        news: [],
        error: 'Outside A-share trading session; market snapshot skipped.',
        diagnostics: [
          { stage: 'market-hours', message: 'Skipped outside 09:25-11:30 and 13:00-15:00 Asia/Shanghai.' }
        ]
      }
    }

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
