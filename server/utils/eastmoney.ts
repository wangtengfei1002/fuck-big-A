import type { AssetKind, DailyBar, IntradaySnapshot, MarketAsset, MarketIndex, NewsItem, TechnicalSnapshot, TrendAssessment } from '~/types/trading'

const EASTMONEY_TIMEOUT_MS = 60000

interface EastMoneyQuote {
  f2?: number
  f3?: number
  f5?: number
  f6?: number
  f7?: number
  f8?: number
  f10?: number
  f12?: string
  f13?: number
  f14?: string
  f15?: number
  f16?: number
  f18?: number
  f20?: number
  f21?: number
  f23?: number
  f39?: number
  f100?: string
  f62?: number
  f64?: number
  f65?: number
  f70?: number
  f71?: number
}

interface EastMoneyKlineResponse {
  data?: {
    klines?: string[]
  }
}

interface EastMoneyTrendResponse {
  data?: {
    trends?: string[]
  }
}

interface EastMoneyQuoteResponse {
  data?: {
    diff?: EastMoneyQuote[]
  }
}

interface EastMoneyStockDetail {
  f43?: number
  f44?: number
  f45?: number
  f47?: number
  f48?: number
  f57?: string
  f58?: string
  f60?: number
  f62?: number
  f64?: number
  f65?: number
  f70?: number
  f71?: number
  f116?: number
  f117?: number
  f127?: string
  f128?: string
  f162?: number
  f167?: number
  f168?: number
  f170?: number
  f171?: number
}

interface EastMoneyStockDetailResponse {
  data?: EastMoneyStockDetail
}

interface EastMoneyListResponse {
  data?: {
    diff?: EastMoneyQuote[]
  }
}

export interface MarketSnapshotDiagnostic {
  stage: string
  message: string
}

export class MarketSnapshotError extends Error {
  diagnostics: MarketSnapshotDiagnostic[]

  constructor(message: string, diagnostics: MarketSnapshotDiagnostic[] = []) {
    super(message)
    this.name = 'MarketSnapshotError'
    this.diagnostics = diagnostics
  }
}

export interface WatchSymbol {
  code: string
  secid?: string
  displayCode?: string
  kind: AssetKind
  sector: string
}

export const indexSymbols: WatchSymbol[] = [
  { code: '000001', secid: '1.000001', displayCode: '000001.SH', kind: 'stock', sector: 'A股指数' },
  { code: '399001', secid: '0.399001', displayCode: '399001.SZ', kind: 'stock', sector: 'A股指数' },
  { code: '399006', secid: '0.399006', displayCode: '399006.SZ', kind: 'stock', sector: 'A股指数' },
  { code: '000688', secid: '1.000688', displayCode: '000688.SH', kind: 'stock', sector: 'A股指数' },
  { code: '000300', secid: '1.000300', displayCode: '000300.SH', kind: 'stock', sector: 'A股指数' },
  { code: '000905', secid: '1.000905', displayCode: '000905.SH', kind: 'stock', sector: 'A股指数' },
  { code: '000852', secid: '1.000852', displayCode: '000852.SH', kind: 'stock', sector: 'A股指数' }
]

const fallbackSymbols: WatchSymbol[] = [
  '510300', '510500', '510050', '510880', '512100', '159915', '159922', '159949', '159845', '588000',
  '588080', '588200', '512480', '159995', '512760', '512880', '512000', '512800', '512010', '512170',
  '159928', '515790', '516160', '159819', '513330', '513180', '518880', '515220', '159930', '516950',
  '600519', '000858', '300750', '002594', '601318', '600036', '601398', '000977', '603019', '300308',
  '600030', '000776', '601688', '600887', '000333', '000651', '002415', '300059', '600276', '000063',
  '601899', '600489', '601012', '300274', '002475', '002371', '600900', '601088', '600309', '603259',
  '601919', '600028', '601857', '600938', '002714', '300760', '688981', '688041', '688012', '688111',
  '600660', '601166', '000001', '600000', '601288', '601988', '601668', '600048', '000002', '601816',
  '600585', '000725', '002230', '300502', '002241', '300124', '002352', '600839', '601138', '000938',
  '600570', '002049', '300033', '600406', '000568', '600809', '603288', '600690', '002304', '000100'
].map((code) => {
  const kind = assetKind(code)
  return {
    code,
    kind,
    sector: sectorFor(code, kind)
  }
})

const HISTORY_DAYS = 520
const HISTORY_ASSET_LIMIT = 240
const HISTORY_CHUNK_SIZE = 20
const LIST_PAGE_SIZE = 300
const STOCK_LIST_TARGET_SIZE = 1800
const ETF_LIST_TARGET_SIZE = 600
const SECTOR_LIST_TARGET_SIZE = 900
const SNAPSHOT_ASSET_LIMIT = 1200
const EASTMONEY_CACHE_TTL_MS = 60_000

function toSecId(code: string, market?: number) {
  if (typeof market === 'number') return `${market}.${code}`
  if (code.startsWith('6') || code.startsWith('5') || code.startsWith('9')) return `1.${code}`
  return `0.${code}`
}

function displayCode(code: string, market?: number) {
  if (market === 1 || code.startsWith('6') || code.startsWith('5')) return `${code}.SH`
  return `${code}.SZ`
}

function assetKind(code: string): AssetKind {
  return code.startsWith('5') || code.startsWith('15') || code.startsWith('16') ? 'etf' : 'stock'
}

function sectorFor(code: string, kind: AssetKind) {
  if (kind === 'etf') return 'ETF'
  if (code.startsWith('688')) return '科创板'
  if (code.startsWith('300')) return '创业板'
  if (code.startsWith('6')) return '沪市A股'
  return '深市A股'
}

function cleanNumber(value: number | undefined, fallback = 0) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < -1e20) return fallback
  return value
}

function limitRange(code: string) {
  if (code.startsWith('300') || code.startsWith('688')) return 0.2
  return 0.1
}

function average(values: number[]) {
  if (!values.length) return 0
  return values.reduce((sum, value) => sum + value, 0) / values.length
}

function sma(values: number[], period: number) {
  if (values.length < period) return 0
  return average(values.slice(-period))
}

function macd(values: number[]) {
  if (values.length < 35) return { diff: 0, dea: 0, hist: 0 }
  const fast = 12
  const slow = 26
  const signal = 9
  const diffs: number[] = []
  let emaFast = values[0]
  let emaSlow = values[0]
  for (let index = 0; index < values.length; index += 1) {
    const price = values[index]
    emaFast = index === 0 ? price : (price - emaFast) * (2 / (fast + 1)) + emaFast
    emaSlow = index === 0 ? price : (price - emaSlow) * (2 / (slow + 1)) + emaSlow
    diffs.push(emaFast - emaSlow)
  }

  let dea = diffs[0]
  for (let index = 1; index < diffs.length; index += 1) {
    dea = (diffs[index] - dea) * (2 / (signal + 1)) + dea
  }
  const diff = diffs[diffs.length - 1] ?? 0
  const hist = (diff - dea) * 2
  return { diff, dea, hist }
}

function rsi(values: number[], period = 14) {
  if (values.length <= period) return 50
  let gains = 0
  let losses = 0
  for (let index = values.length - period; index < values.length; index += 1) {
    const change = values[index] - values[index - 1]
    if (change >= 0) gains += change
    else losses -= change
  }
  if (losses === 0) return 100
  const rs = gains / losses
  return 100 - 100 / (1 + rs)
}

function isLimitUpBar(bar: DailyBar) {
  return bar.changePct >= 9.5 || bar.changePct >= 19
}

function buildTechnicalSnapshot(bars: DailyBar[]): TechnicalSnapshot | undefined {
  if (!bars.length) return undefined
  const closes = bars.map((bar) => bar.close)
  const volumes = bars.map((bar) => bar.volume)
  const latestClose = closes[closes.length - 1] ?? 0
  const ma5 = sma(closes, 5)
  const ma10 = sma(closes, 10)
  const ma20 = sma(closes, 20)
  const ma60 = sma(closes, 60)
  const ma120 = sma(closes, 120)
  const ma250 = sma(closes, 250)
  const macdValue = macd(closes)
  const volumeAvg20 = sma(volumes, 20)
  const high20 = Math.max(...bars.slice(-20).map((bar) => bar.high))
  const low20 = Math.min(...bars.slice(-20).map((bar) => bar.low))
  const high60 = Math.max(...bars.slice(-60).map((bar) => bar.high))
  const low60 = Math.min(...bars.slice(-60).map((bar) => bar.low))
  const high250 = Math.max(...bars.slice(-250).map((bar) => bar.high))
  const low250 = Math.min(...bars.slice(-250).map((bar) => bar.low))
  const completedBars = bars.length > 1 ? bars.slice(0, -1) : bars
  const recentLimitUpCount = completedBars.slice(-5).filter(isLimitUpBar).length
  let consecutiveLimitUpDays = 0
  for (let index = completedBars.length - 1; index >= 0; index -= 1) {
    if (!isLimitUpBar(completedBars[index])) break
    consecutiveLimitUpDays += 1
  }
  const lastCompletedLimitUp = Boolean(completedBars.length && isLimitUpBar(completedBars[completedBars.length - 1]))
  const priorTwoLimitUp = completedBars.slice(-2).length === 2 && completedBars.slice(-2).every(isLimitUpBar)
  return {
    historyDays: bars.length,
    closes,
    volumes,
    ma5,
    ma10,
    ma20,
    ma60,
    ma120,
    ma250,
    macdDiff: macdValue.diff,
    macdDea: macdValue.dea,
    macdHist: macdValue.hist,
    rsi14: rsi(closes),
    volumeAvg20,
    volumeSpike20: volumeAvg20 > 0 ? (volumes[volumes.length - 1] ?? 0) / volumeAvg20 : 0,
    high20,
    low20,
    high60,
    low60,
    high250,
    low250,
    closeVsMa20Pct: ma20 > 0 ? (latestClose - ma20) / ma20 * 100 : 0,
    closeVsMa60Pct: ma60 > 0 ? (latestClose - ma60) / ma60 * 100 : 0,
    closeVsMa250Pct: ma250 > 0 ? (latestClose - ma250) / ma250 * 100 : 0,
    isGoldenCross: ma5 > ma20 && ma10 > ma20,
    isDeathCross: ma5 < ma20 && ma10 < ma20,
    isBreakout20: latestClose >= high20,
    isBreakout60: latestClose >= high60,
    isBreakout250: latestClose >= high250,
    recentLimitUpCount,
    consecutiveLimitUpDays,
    lastCompletedLimitUp,
    priorTwoLimitUp
  }
}

async function fetchDailyBars(code: string, market?: number, limit = HISTORY_DAYS) {
  const secid = toSecId(code, market)
  const response = await fetchEastMoney<EastMoneyKlineResponse>(
    'https://push2his.eastmoney.com/api/qt/stock/kline/get',
    {
      secid,
      klt: 101,
      fqt: 1,
      lmt: limit,
      end: '20500101',
      fields1: 'f1,f2,f3,f4,f5,f6',
      fields2: 'f51,f52,f53,f54,f55,f56,f57,f58,f59,f60,f61',
      ut: '7eea3edcaed734bea9cbfc24409ed989'
    },
    'https://quote.eastmoney.com/'
  )

  const klines = response.data?.klines ?? []
  return klines
    .map((line) => {
      const [date, open, close, high, low, volume, amount, amplitude, changePct, changeAmount, turnoverRate] = line.split(',')
      return {
        date,
        open: Number(open),
        close: Number(close),
        high: Number(high),
        low: Number(low),
        volume: Number(volume),
        amount: Number(amount),
        amplitude: Number(amplitude),
        changePct: Number(changePct),
        changeAmount: Number(changeAmount),
        turnoverRate: Number(turnoverRate)
      } satisfies DailyBar
    })
    .filter((bar) => Number.isFinite(bar.close) && bar.close > 0)
}

type IntradayPoint = {
  time: string
  open: number
  close: number
  high: number
  low: number
  volume: number
  amount: number
  vwap: number
}

function pctChange(current: number, base: number) {
  if (!current || !base || base <= 0) return 0
  return (current - base) / base * 100
}

function buildIntradaySnapshot(points: IntradayPoint[], previousClose: number): IntradaySnapshot | undefined {
  const validPoints = points.filter((point) => point.close > 0)
  if (!validPoints.length || previousClose <= 0) return undefined

  const latest = validPoints[validPoints.length - 1]
  const highPoint = validPoints.reduce((best, point, index) => {
    const bestHigh = best.point.high || best.point.close
    const currentHigh = point.high || point.close
    return currentHigh > bestHigh ? { point, index } : best
  }, { point: validPoints[0], index: 0 })
  const low = Math.min(...validPoints.map((point) => point.low || point.close))
  const open = validPoints[0].open || validPoints[0].close
  const totalAmount = validPoints.reduce((sum, point) => sum + Math.max(0, point.amount), 0)
  const totalVolume = validPoints.reduce((sum, point) => sum + Math.max(0, point.volume), 0)
  const latestVwap = latest.vwap > 0
    ? latest.vwap
    : totalVolume > 0
      ? totalAmount / Math.max(totalVolume, 1)
      : latest.close
  const first30 = validPoints.slice(0, Math.min(30, validPoints.length))
  const first30High = Math.max(...first30.map((point) => point.high || point.close))
  const first30Close = first30[first30.length - 1]?.close ?? open
  const closeAt = (offset: number) => validPoints[Math.max(0, validPoints.length - 1 - offset)]?.close ?? latest.close
  const openChangePct = pctChange(open, previousClose)
  const highChangePct = pctChange(highPoint.point.high || highPoint.point.close, previousClose)
  const currentChangePct = pctChange(latest.close, previousClose)
  const highPullbackPct = pctChange(latest.close, highPoint.point.high || highPoint.point.close)
  const first30MinHighChangePct = pctChange(first30High, previousClose)
  const fadeFromFirst30HighPct = pctChange(latest.close, first30High)
  const currentVsVwapPct = pctChange(latest.close, latestVwap)
  const last5MinChangePct = pctChange(latest.close, closeAt(5))
  const last15MinChangePct = pctChange(latest.close, closeAt(15))
  const minutesFromHigh = Math.max(0, validPoints.length - 1 - highPoint.index)
  const turnedGreenAfterStrongOpen = first30MinHighChangePct >= 4.5 && currentChangePct <= 0
  const trend: IntradaySnapshot['trend'] = turnedGreenAfterStrongOpen || (highChangePct >= 4 && highPullbackPct <= -3 && currentVsVwapPct < -0.4)
    ? 'fade'
    : currentChangePct < -1.2 && currentVsVwapPct < -0.5 && last15MinChangePct < -0.4
      ? 'weak_down'
      : currentChangePct > 2.5 && currentVsVwapPct > 0.4 && last15MinChangePct >= -0.2
        ? 'strong_up'
        : last15MinChangePct > 0.5 && currentVsVwapPct > -0.2
          ? 'recovering'
          : 'range'

  return {
    points: validPoints.length,
    openChangePct,
    highChangePct,
    lowChangePct: pctChange(low, previousClose),
    highPullbackPct,
    currentVsVwapPct,
    last5MinChangePct,
    last15MinChangePct,
    minutesFromHigh,
    first30MinHighChangePct,
    first30MinCloseChangePct: pctChange(first30Close, previousClose),
    fadeFromFirst30HighPct,
    turnedGreenAfterStrongOpen,
    trend
  }
}

async function fetchIntradaySnapshot(code: string, market: number | undefined, previousClose: number) {
  const secid = toSecId(code, market)
  const response = await fetchEastMoney<EastMoneyTrendResponse>(
    'https://push2his.eastmoney.com/api/qt/stock/trends2/get',
    {
      secid,
      ndays: 1,
      iscr: 0,
      iscca: 0,
      fields1: 'f1,f2,f3,f4,f5,f6,f7,f8,f9,f10,f11,f12,f13',
      fields2: 'f51,f52,f53,f54,f55,f56,f57,f58',
      ut: '7eea3edcaed734bea9cbfc24409ed989'
    },
    'https://quote.eastmoney.com/'
  )

  const points = (response.data?.trends ?? [])
    .map((line): IntradayPoint | null => {
      const [time, open, close, high, low, volume, amount, vwap] = line.split(',')
      const point = {
        time,
        open: Number(open),
        close: Number(close),
        high: Number(high),
        low: Number(low),
        volume: Number(volume),
        amount: Number(amount),
        vwap: Number(vwap)
      }
      return Number.isFinite(point.close) && point.close > 0 ? point : null
    })
    .filter((point): point is IntradayPoint => Boolean(point))

  return buildIntradaySnapshot(points, previousClose)
}

function scoreFromQuote(changePct: number, turnover: number, amplitude: number, volumeRatio: number, mainNetInflowPct: number, bottomScore: number) {
  const liquidityScore = Math.max(20, Math.min(98, Math.log10(Math.max(turnover, 1)) * 9))
  const trendScore = Math.max(10, Math.min(95, 55 + changePct * 7 + Math.min(10, mainNetInflowPct * 0.6) + bottomScore * 0.08))
  const sentimentScore = Math.max(10, Math.min(95, 52 + changePct * 8 + liquidityScore * 0.08 + mainNetInflowPct * 0.9 + Math.max(0, volumeRatio - 1) * 5))
  const riskScore = Math.max(12, Math.min(88, Math.abs(changePct) * 9 + amplitude * 2.8 - Math.max(0, bottomScore - 55) * 0.12))
  return { liquidityScore, trendScore, sentimentScore, riskScore }
}

function relativeRank(value: number, sortedDesc: number[]) {
  if (!sortedDesc.length) return 0
  const index = sortedDesc.findIndex((item) => value >= item)
  const safeIndex = index === -1 ? sortedDesc.length - 1 : index
  return 1 - safeIndex / Math.max(sortedDesc.length - 1, 1)
}

function clampScore(value: number) {
  return Math.max(0, Math.min(100, value))
}

const quoteFields = 'f2,f3,f5,f6,f7,f8,f10,f12,f13,f14,f15,f16,f18,f20,f21,f23,f39,f62,f64,f65,f70,f71,f100'
const stockDetailFields = 'f43,f44,f45,f47,f48,f57,f58,f60,f62,f64,f65,f70,f71,f116,f117,f127,f128,f162,f167,f168,f170,f171'
const EASTMONEY_RETRY_COUNT = 3
const EASTMONEY_RETRY_DELAY_MS = 350

type EastMoneyQuery = Record<string, string | number | undefined>

const browserProfiles = [
  {
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
    secChUa: '"Google Chrome";v="131", "Chromium";v="131", "Not_A Brand";v="24"',
    platform: '"Windows"'
  },
  {
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36 Edg/130.0.0.0',
    secChUa: '"Microsoft Edge";v="130", "Chromium";v="130", "Not_A Brand";v="24"',
    platform: '"Windows"'
  },
  {
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_7_1) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
    secChUa: '"Google Chrome";v="131", "Chromium";v="131", "Not_A Brand";v="24"',
    platform: '"macOS"'
  }
]

let browserProfileCursor = 0

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function nextEastMoneyHeaders(referer = 'https://quote.eastmoney.com/center/gridlist.html') {
  const profile = browserProfiles[browserProfileCursor % browserProfiles.length]
  browserProfileCursor += 1
  return {
    Accept: 'application/json, text/plain, */*',
    'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
    'Cache-Control': 'no-cache',
    Pragma: 'no-cache',
    Referer: referer,
    'Sec-Fetch-Dest': 'empty',
    'Sec-Fetch-Mode': 'cors',
    'Sec-Fetch-Site': 'same-site',
    'User-Agent': profile.userAgent,
    'sec-ch-ua': profile.secChUa,
    'sec-ch-ua-mobile': '?0',
    'sec-ch-ua-platform': profile.platform
  }
}

async function fetchEastMoney<T>(url: string, query: EastMoneyQuery, referer?: string) {
  let lastError: unknown

  for (let attempt = 0; attempt < EASTMONEY_RETRY_COUNT; attempt += 1) {
    try {
      return await $fetch<T>(url, {
        query: attempt === 0 ? query : { ...query, _: Date.now() },
        headers: nextEastMoneyHeaders(referer),
        timeout: EASTMONEY_TIMEOUT_MS
      })
    } catch (error) {
      lastError = error
      if (attempt < EASTMONEY_RETRY_COUNT - 1) {
        await sleep(EASTMONEY_RETRY_DELAY_MS * (attempt + 1))
      }
    }
  }

  throw lastError
}

function detailToQuote(detail: EastMoneyStockDetail | undefined, fallbackMarket?: number): EastMoneyQuote | null {
  if (!detail?.f57) return null
  const sector = detail.f127 || detail.f128
  return {
    f2: detail.f43,
    f3: detail.f170,
    f5: detail.f47,
    f6: detail.f48,
    f7: detail.f171,
    f8: detail.f168,
    f12: detail.f57,
    f13: fallbackMarket,
    f14: detail.f58,
    f15: detail.f44,
    f16: detail.f45,
    f18: detail.f60,
    f20: detail.f116,
    f21: detail.f117,
    f23: detail.f167,
    f39: detail.f162,
    f62: detail.f62,
    f64: detail.f64,
    f65: detail.f65,
    f70: detail.f70,
    f71: detail.f71,
    f100: sector
  }
}

type CacheEntry<T> = {
  expiresAt: number
  promise: Promise<T>
}

const quoteCache = new Map<string, CacheEntry<EastMoneyQuote[]>>()
const listCache = new Map<string, CacheEntry<EastMoneyQuote[]>>()

function getCachedRequest<T>(cache: Map<string, CacheEntry<T>>, key: string, loader: () => Promise<T>) {
  const now = Date.now()
  const cached = cache.get(key)
  if (cached && cached.expiresAt > now) return cached.promise

  const promise = loader().catch((error) => {
    cache.delete(key)
    throw error
  })
  cache.set(key, {
    expiresAt: now + EASTMONEY_CACHE_TTL_MS,
    promise
  })
  return promise
}

async function fetchStockDetailQuote(symbol: WatchSymbol) {
  const secid = symbol.secid ?? toSecId(symbol.code)
  const [marketPart] = secid.split('.')
  const market = Number(marketPart)
  const response = await fetchEastMoney<EastMoneyStockDetailResponse>(
    'https://push2.eastmoney.com/api/qt/stock/get',
    {
      fltt: 2,
      invt: 2,
      secid,
      fields: stockDetailFields,
      ut: 'b2884a393a59ad64002292a3e90d46a5'
    },
    'https://quote.eastmoney.com/'
  )

  return detailToQuote(response.data, Number.isFinite(market) ? market : undefined)
}

async function fetchQuotesFallback(symbols: WatchSymbol[]) {
  const settled = await Promise.allSettled(symbols.map((symbol) => fetchStockDetailQuote(symbol)))
  return settled
    .filter((result): result is PromiseFulfilledResult<EastMoneyQuote | null> => result.status === 'fulfilled')
    .map((result) => result.value)
    .filter((quote): quote is EastMoneyQuote => Boolean(quote))
}

async function fetchQuotes(symbols: WatchSymbol[]) {
  const secids = symbols.map((item) => item.secid ?? toSecId(item.code)).join(',')
  const cacheKey = `quotes:${secids}`

  return getCachedRequest(quoteCache, cacheKey, async () => {
    try {
      const response = await fetchEastMoney<EastMoneyQuoteResponse>(
        'https://push2.eastmoney.com/api/qt/ulist.np/get',
        {
          fltt: 2,
          invt: 2,
          secids,
          fields: quoteFields,
          ut: 'b2884a393a59ad64002292a3e90d46a5'
        },
        'https://quote.eastmoney.com/'
      )

      const quotes = response.data?.diff ?? []
      if (quotes.length) return quotes
      console.warn('[eastmoney] fetchQuotes returned empty, falling back to stock/get', { secids })
    } catch (error) {
      console.warn('[eastmoney] fetchQuotes failed', error)
    }

    try {
      return await fetchQuotesFallback(symbols)
    } catch (error) {
      console.warn('[eastmoney] fetchQuotes fallback failed', error)
      return []
    }
  })
}

async function fetchQuotesInChunks(symbols: WatchSymbol[], size = 55) {
  const chunks: WatchSymbol[][] = []
  for (let index = 0; index < symbols.length; index += size) {
    chunks.push(symbols.slice(index, index + size))
  }

  const settled = await Promise.allSettled(chunks.map((chunk) => fetchQuotes(chunk)))
  return settled
    .filter((result): result is PromiseFulfilledResult<EastMoneyQuote[]> => result.status === 'fulfilled')
    .flatMap((result) => result.value)
}

async function fetchListPage(fs: string, page: number, pageSize: number) {
  try {
    const response = await fetchEastMoney<EastMoneyListResponse>(
      'https://push2.eastmoney.com/api/qt/clist/get',
      {
        pn: page,
        pz: pageSize,
        po: 1,
        np: 1,
        fltt: 2,
        invt: 2,
        fid: 'f6',
        fs,
        fields: quoteFields,
        ut: 'b2884a393a59ad64002292a3e90d46a5'
      },
      'https://quote.eastmoney.com/center/gridlist.html'
    )

    return response.data?.diff ?? []
  } catch (error) {
    console.warn('[eastmoney] fetchList page failed', { fs, page, pageSize, error })
    return []
  }
}

async function fetchList(fs: string, size: number, pageSize = LIST_PAGE_SIZE) {
  const cacheKey = `list:${fs}:${size}`

  return getCachedRequest(listCache, cacheKey, async () => {
    const safePageSize = Math.max(1, Math.min(pageSize, LIST_PAGE_SIZE))
    const pageCount = Math.max(1, Math.ceil(size / safePageSize))
    const pages: EastMoneyQuote[] = []
    for (let page = 1; page <= pageCount; page += 1) {
      pages.push(...await fetchListPage(fs, page, safePageSize))
      if (page < pageCount) await sleep(120)
    }
    return pages
      .slice(0, size)
  })
}

async function fetchTradableQuotes() {
  const settled = await Promise.allSettled([
    fetchList('m:0+t:6,m:0+t:80,m:1+t:2,m:1+t:23,m:1+t:3', STOCK_LIST_TARGET_SIZE),
    fetchList('m:0+t:5,m:1+t:5', ETF_LIST_TARGET_SIZE),
    fetchList('b:MK0021,b:MK0022,b:MK0023,b:MK0024', SECTOR_LIST_TARGET_SIZE)
  ])

  const quotes = settled
    .filter((result): result is PromiseFulfilledResult<EastMoneyQuote[]> => result.status === 'fulfilled')
    .flatMap((result) => result.value)

  const unique = new Map<string, EastMoneyQuote>()
  for (const quote of quotes) {
    if (!quote.f12 || !quote.f14) continue
    const price = cleanNumber(quote.f2)
    const turnover = cleanNumber(quote.f6)
    if (price <= 0 || turnover <= 0) continue
    if (quote.f14.includes('ST') || quote.f14.includes('退')) continue
    unique.set(`${quote.f13}.${quote.f12}`, quote)
  }

  const dynamicQuotes = [...unique.values()]
    .sort((a, b) => cleanNumber(b.f6) - cleanNumber(a.f6))
    .slice(0, SNAPSHOT_ASSET_LIMIT)
  if (dynamicQuotes.length) return dynamicQuotes

  const fallbackQuotes = await fetchQuotesInChunks(fallbackSymbols)
  if (!fallbackQuotes.length) {
    throw new MarketSnapshotError('EastMoney returned no tradable quotes', [
      { stage: 'tradable-list', message: 'primary universe and fallback universe were both empty' }
    ])
  }
  return fallbackQuotes
}

function quoteToAsset(quote: EastMoneyQuote): MarketAsset | null {
  const code = quote.f12
  if (!code) return null

  const price = cleanNumber(quote.f2)
  const previousClose = cleanNumber(quote.f18, price)
  if (price <= 0 || previousClose <= 0) return null

  const changePct = cleanNumber(quote.f3)
  const turnover = cleanNumber(quote.f6)
  const high = cleanNumber(quote.f15, price)
  const low = cleanNumber(quote.f16, price)
  const amplitude = cleanNumber(quote.f7, previousClose > 0 ? (high - low) / previousClose * 100 : 0)
  const volumeRatio = cleanNumber(quote.f10, 1)
  const mainNetInflow = cleanNumber(quote.f62)
  const superOrderNetInflow = cleanNumber(quote.f64) + cleanNumber(quote.f65)
  const bigOrderNetInflow = cleanNumber(quote.f70) + cleanNumber(quote.f71)
  const mainNetInflowPct = turnover > 0 ? mainNetInflow / turnover * 100 : 0
  const superOrderNetInflowPct = turnover > 0 ? superOrderNetInflow / turnover * 100 : 0
  const bigOrderNetInflowPct = turnover > 0 ? bigOrderNetInflow / turnover * 100 : 0
  const intradayPosition = high > low ? (price - low) / (high - low) : 0.5
  const lowLocationScore = Math.max(0, Math.min(100, (1 - Math.abs(changePct) / 5) * 42 + (1 - intradayPosition) * 28 + Math.max(0, volumeRatio - 1) * 12))
  const fundSupportScore = Math.max(0, Math.min(35, mainNetInflowPct * 2 + superOrderNetInflowPct * 1.2 + bigOrderNetInflowPct * 0.8))
  const bottomScore = Math.round(Math.max(0, Math.min(100, lowLocationScore + fundSupportScore)))
  const scores = scoreFromQuote(changePct, turnover, amplitude, volumeRatio, mainNetInflowPct, bottomScore)
  const kind = assetKind(code)
  const range = limitRange(code)

  return {
    code,
    name: quote.f14 || code,
    kind,
    sector: quote.f100 || sectorFor(code, kind),
    industry: quote.f100 || sectorFor(code, kind),
    concepts: quote.f100 ? [quote.f100] : [],
    price,
    previousClose,
    changePct,
    volume: cleanNumber(quote.f5),
    turnover,
    turnoverRate: cleanNumber(quote.f8),
    marketCap: cleanNumber(quote.f20),
    floatMarketCap: cleanNumber(quote.f21),
    peRatio: cleanNumber(quote.f39),
    pbRatio: cleanNumber(quote.f23),
    volumeRatio,
    amplitude,
    mainNetInflow,
    mainNetInflowPct,
    superOrderNetInflow,
    superOrderNetInflowPct,
    bigOrderNetInflow,
    bigOrderNetInflowPct,
    bottomScore,
    liquidityScore: Math.round(scores.liquidityScore),
    trendScore: Math.round(scores.trendScore),
    sentimentScore: Math.round(scores.sentimentScore),
    riskScore: Math.round(scores.riskScore),
    premiumRate: kind === 'etf' ? 0 : undefined,
    limitUp: Number((previousClose * (1 + range)).toFixed(3)),
    limitDown: Number((previousClose * (1 - range)).toFixed(3)),
    kline: [previousClose, price]
  }
}

async function attachHistory(items: Array<{ secid: string, asset: MarketAsset }>) {
  const enrichableSecids = new Set(
    [...items]
      .sort((a, b) => b.asset.turnover - a.asset.turnover)
      .slice(0, HISTORY_ASSET_LIMIT)
      .map((item) => item.secid)
  )

  const enriched = new Map<string, MarketAsset>()
  const selected = items.filter((item) => enrichableSecids.has(item.secid))
  for (let index = 0; index < selected.length; index += HISTORY_CHUNK_SIZE) {
    const chunk = selected.slice(index, index + HISTORY_CHUNK_SIZE)
    const settled = await Promise.allSettled(chunk.map(async (item) => {
      const [marketPart, code] = item.secid.split('.')
      const market = Number(marketPart)
      const [bars, intraday] = await Promise.all([
        fetchDailyBars(code, Number.isFinite(market) ? market : undefined),
        fetchIntradaySnapshot(code, Number.isFinite(market) ? market : undefined, item.asset.previousClose).catch(() => undefined)
      ])
      const technical = buildTechnicalSnapshot(bars)
      return {
        secid: item.secid,
        asset: {
          ...item.asset,
          technical,
          intraday,
          kline: bars.length ? bars.slice(-250).map((bar) => bar.close) : item.asset.kline
        }
      }
    }))

    for (const result of settled) {
      if (result.status === 'fulfilled') enriched.set(result.value.secid, result.value.asset)
    }
  }

  return items.map((item) => enriched.get(item.secid) ?? item.asset)
}

function attachRelativeContext(assets: MarketAsset[]) {
  const strengthValues = assets.map((asset) => (
    asset.changePct
    + asset.trendScore * 0.08
    + asset.sentimentScore * 0.06
    + (asset.mainNetInflowPct ?? 0) * 0.8
    + ((asset.volumeRatio ?? 1) - 1) * 1.5
  ))
  const sortedStrength = [...strengthValues].sort((a, b) => b - a)
  const sectorMap = new Map<string, MarketAsset[]>()
  for (const asset of assets) {
    const key = asset.sector || asset.industry || asset.kind
    const current = sectorMap.get(key) ?? []
    current.push(asset)
    sectorMap.set(key, current)
  }

  const sectorMomentum = new Map<string, number>()
  for (const [sector, items] of sectorMap) {
    const momentum = items.reduce((sum, asset) => (
      sum
      + asset.changePct
      + asset.trendScore * 0.06
      + asset.sentimentScore * 0.04
      + (asset.mainNetInflowPct ?? 0) * 0.7
      + ((asset.volumeRatio ?? 1) - 1) * 2
    ), 0) / Math.max(items.length, 1)
    sectorMomentum.set(sector, momentum)
  }

  const sortedSectors = [...sectorMomentum.entries()].sort((a, b) => b[1] - a[1])
  const sectorRankMap = new Map(sortedSectors.map(([sector], index) => [sector, 1 - index / Math.max(sortedSectors.length - 1, 1)]))

  return assets.map((asset) => {
    const key = asset.sector || asset.industry || asset.kind
    const strengthValue = asset.changePct + asset.trendScore * 0.08 + asset.sentimentScore * 0.06 + (asset.mainNetInflowPct ?? 0) * 0.8 + ((asset.volumeRatio ?? 1) - 1) * 1.5
    return {
      ...asset,
      relativeStrengthRank: relativeRank(strengthValue, sortedStrength),
      sectorRank: sectorRankMap.get(key) ?? 0,
      sectorMomentum: sectorMomentum.get(key) ?? 0,
      sectorAssetCount: sectorMap.get(key)?.length ?? 0
    }
  })
}

function previousCompletedDailyChangePct(asset: MarketAsset) {
  const closes = asset.technical?.closes ?? asset.kline
  if (closes.length < 3) return 0
  const previousClose = closes[closes.length - 3]
  const completedClose = closes[closes.length - 2]
  if (!previousClose || !completedClose || previousClose <= 0) return 0
  return (completedClose - previousClose) / previousClose * 100
}

function hasHighVolumeBreakoutFadeRisk(asset: MarketAsset) {
  const intraday = asset.intraday
  const technical = asset.technical
  if (!intraday) return false

  const strongPreviousSession = previousCompletedDailyChangePct(asset) >= (asset.kind === 'etf' ? 1.5 : 2.5)
  const recentBreakout = Boolean(technical && (
    technical.isBreakout20
    || technical.isBreakout60
    || technical.isBreakout250
    || technical.recentLimitUpCount > 0
  ))
  const highVolume = (asset.volumeRatio ?? 1) >= 1.45 || (technical?.volumeSpike20 ?? 1) >= 1.35
  const unrepairedFade = intraday.currentVsVwapPct <= -0.4
    && intraday.highChangePct >= 1.5
    && intraday.highPullbackPct <= -2.4
    && intraday.minutesFromHigh >= 20
    && (
      intraday.trend === 'fade'
      || intraday.trend === 'weak_down'
      || intraday.last15MinChangePct <= -0.2
    )

  return highVolume && unrepairedFade && (strongPreviousSession || recentBreakout)
}

function buildTrendAssessment(asset: MarketAsset): TrendAssessment {
  const technical = asset.technical
  const intraday = asset.intraday
  const reasons: string[] = []
  const warnings: string[] = []
  const highVolumeBreakoutFade = hasHighVolumeBreakoutFadeRisk(asset)

  let daily = 50
  if (technical) {
    if (technical.ma20 > technical.ma60) daily += 8
    if (technical.ma60 > technical.ma250) daily += 6
    if (technical.ma5 > technical.ma20) daily += 5
    if (technical.macdHist > 0) daily += 7
    if (technical.isBreakout20) daily += 6
    if (technical.isBreakout60) daily += 8
    if (technical.isBreakout250) daily += 10
    if (technical.isDeathCross) daily -= 14
    if (technical.macdHist < 0) daily -= 7
    if (technical.closeVsMa20Pct < -6) daily -= 9
    if (technical.closeVsMa60Pct < -8) daily -= 10
    if (technical.rsi14 >= 82) warnings.push(`RSI overheated ${technical.rsi14.toFixed(1)}`)
    if (technical.isBreakout60 || technical.isBreakout250) reasons.push('daily breakout confirmed')
    if (technical.isDeathCross && technical.macdHist < 0) warnings.push('daily MA/MACD trend damaged')
  } else {
    daily += (asset.trendScore - 50) * 0.5
  }

  let intradayScore = 50
  if (intraday) {
    intradayScore = intraday.trend === 'strong_up'
      ? 76
      : intraday.trend === 'recovering'
        ? 62
        : intraday.trend === 'weak_down'
          ? 24
          : intraday.trend === 'fade'
            ? 18
            : 50
    intradayScore += Math.max(-12, Math.min(12, intraday.currentVsVwapPct * 2.2))
    intradayScore += Math.max(-10, Math.min(10, intraday.last15MinChangePct * 3.2))
    intradayScore += intraday.highPullbackPct <= -3.5 ? -10 : 0
    if (intraday.trend === 'strong_up') reasons.push('intraday above VWAP with positive momentum')
    if (intraday.trend === 'recovering') reasons.push('intraday momentum is repairing')
    if (intraday.trend === 'fade' || intraday.turnedGreenAfterStrongOpen) warnings.push('failed intraday spike / strong open faded')
    if (intraday.currentVsVwapPct < -0.6) warnings.push(`below VWAP ${intraday.currentVsVwapPct.toFixed(2)}%`)
  }
  const postLimitUpDistribution = Boolean(technical && intraday && (
    technical.priorTwoLimitUp
    || technical.consecutiveLimitUpDays >= 2
    || technical.recentLimitUpCount >= 2
  ) && (
    intraday.highChangePct >= 5
    && intraday.highPullbackPct <= -3.5
    && intraday.minutesFromHigh >= 20
  ))
  if (postLimitUpDistribution) {
    daily -= 12
    intradayScore -= 18
    warnings.push(`post-limit-up blowoff risk: recent limit-up count ${technical?.recentLimitUpCount ?? 0}, high pullback ${intraday?.highPullbackPct.toFixed(2)}%`)
  }
  if (highVolumeBreakoutFade) {
    daily -= 10
    intradayScore -= 16
    warnings.push(`high-volume breakout fade: volume ratio ${(asset.volumeRatio ?? 1).toFixed(2)}, high pullback ${intraday?.highPullbackPct.toFixed(2)}%, VWAP ${intraday?.currentVsVwapPct.toFixed(2)}%`)
  }

  const moneyFlow = clampScore(
    50
    + (asset.mainNetInflowPct ?? 0) * 3
    + (asset.superOrderNetInflowPct ?? 0) * 4
    + (asset.bigOrderNetInflowPct ?? 0) * 3
  )
  if (moneyFlow >= 62) reasons.push('large-order money flow supports trend')
  if (moneyFlow <= 38) warnings.push('money flow is weakening')

  const relative = clampScore(50 + ((asset.relativeStrengthRank ?? 0.5) - 0.5) * 70)
  const sector = clampScore(50 + ((asset.sectorRank ?? 0.5) - 0.5) * 55 + (asset.sectorMomentum ?? 0) * 1.8)
  if (relative >= 68) reasons.push('relative strength leads scanned universe')
  if (sector >= 65) reasons.push('sector/theme context is supportive')
  if (relative <= 35) warnings.push('relative strength is weak')
  if (sector <= 35) warnings.push('sector/theme context is weak')

  const risk = clampScore(100 - asset.riskScore)
  if (asset.riskScore >= 78) warnings.push(`risk score elevated ${asset.riskScore}`)

  const score = clampScore(
    daily * 0.24
    + intradayScore * 0.22
    + moneyFlow * 0.2
    + relative * 0.14
    + sector * 0.1
    + risk * 0.1
  )
  const failedSpike = highVolumeBreakoutFade || Boolean(intraday && (
    intraday.turnedGreenAfterStrongOpen
    || intraday.trend === 'fade'
    || (
      intraday.highChangePct >= 5
      && intraday.highPullbackPct <= -3.5
      && intraday.currentVsVwapPct < -0.4
    )
  ))
  const distribution = postLimitUpDistribution || (moneyFlow <= 38 && score < 54 && (asset.turnoverRate ?? 0) >= 8)
  const phase: TrendAssessment['phase'] = failedSpike
    ? 'failed_spike'
    : distribution
      ? 'distribution'
      : score >= 68 && Boolean(technical?.isBreakout20 || technical?.isBreakout60 || technical?.isBreakout250)
        ? 'breakout'
        : score >= 62
          ? 'continuation'
          : score >= 49 && (intraday?.trend === 'recovering' || (asset.bottomScore ?? 0) >= 70)
            ? ((asset.bottomScore ?? 0) >= 70 ? 'bottoming' : 'pullback')
            : score <= 38
              ? 'downtrend'
              : 'range'
  const direction: TrendAssessment['direction'] = failedSpike || phase === 'distribution'
    ? 'fading'
    : score >= 72
      ? 'strong_up'
      : score >= 58
        ? 'up'
        : score <= 38
          ? 'down'
          : score <= 48
            ? 'fading'
            : 'sideways'
  const confidence = Math.max(0.35, Math.min(0.96, 0.42 + Math.abs(score - 50) / 70 + Math.min(reasons.length + warnings.length, 6) * 0.035))

  return {
    direction,
    phase,
    score: Math.round(score),
    confidence: Number(confidence.toFixed(2)),
    components: {
      daily: Math.round(clampScore(daily)),
      intraday: Math.round(clampScore(intradayScore)),
      moneyFlow: Math.round(moneyFlow),
      relative: Math.round(relative),
      sector: Math.round(sector),
      risk: Math.round(risk)
    },
    reasons: reasons.slice(0, 5),
    warnings: warnings.slice(0, 5)
  }
}

function attachTrendAssessment(assets: MarketAsset[]) {
  return assets.map((asset) => ({
    ...asset,
    trendAssessment: buildTrendAssessment(asset)
  }))
}

export async function getMarketSnapshot(extraSymbols: WatchSymbol[] = []) {
  const diagnostics: MarketSnapshotDiagnostic[] = []

  const [indexQuotes, assetQuotes, extraQuotes] = await Promise.all([
    fetchQuotes(indexSymbols),
    fetchTradableQuotes().catch((error) => {
      if (error instanceof MarketSnapshotError) diagnostics.push(...error.diagnostics)
      else diagnostics.push({ stage: 'tradable-list', message: error instanceof Error ? error.message : 'unknown error' })
      throw error
    }),
    extraSymbols.length ? fetchQuotesInChunks(extraSymbols) : Promise.resolve([])
  ])

  const indexByCode = new Map(indexQuotes.map((quote) => [quote.f12, quote]))
  const indexes: MarketIndex[] = indexSymbols.map((symbol) => {
    const quote = indexByCode.get(symbol.code)
    const changePct = cleanNumber(quote?.f3)
    return {
      code: symbol.displayCode ?? displayCode(symbol.code),
      name: quote?.f14 || symbol.code,
      value: cleanNumber(quote?.f2),
      changePct,
      breadth: Math.max(5, Math.min(95, 50 + changePct * 8)),
      volumeRatio: Math.max(0.5, Math.min(2.5, 1 + changePct / 20))
    }
  })

  const quoteBySecid = new Map<string, EastMoneyQuote>()
  for (const quote of [...assetQuotes, ...extraQuotes]) {
    if (!quote.f12) continue
    quoteBySecid.set(`${quote.f13 ?? (quote.f12.startsWith('6') || quote.f12.startsWith('5') ? 1 : 0)}.${quote.f12}`, quote)
  }

  const baseAssets = [...quoteBySecid.entries()].map(([secid, quote]) => {
    const asset = quoteToAsset(quote)
    if (!asset) return null
    return { secid, asset }
  }).filter((item): item is { secid: string, asset: MarketAsset } => Boolean(item))

  const assets = attachTrendAssessment(attachRelativeContext(await attachHistory(baseAssets)))
  if (!assets.length) {
    throw new MarketSnapshotError('EastMoney snapshot produced no assets', [
      ...diagnostics,
      { stage: 'asset-build', message: 'all fetched quotes were filtered out or history failed' }
    ])
  }

  const avgChange = assets.reduce((sum, item) => sum + item.changePct, 0) / Math.max(assets.length, 1)
  const news: NewsItem[] = [
    {
      id: `live-market-${Date.now()}`,
      time: new Intl.DateTimeFormat('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date()),
      source: '实时行情',
      title: `已扫描 ${assets.length} 个高成交额 A 股和 ETF，平均涨跌幅 ${avgChange >= 0 ? '+' : ''}${avgChange.toFixed(2)}%。`,
      impact: Math.round(Math.max(-90, Math.min(90, avgChange * 18))),
      tags: ['live', 'quotes', 'universe']
    }
  ]

  return {
    source: 'eastmoney',
    updatedAt: new Date().toISOString(),
    indexes,
    assets,
    news,
    diagnostics
  }
}
