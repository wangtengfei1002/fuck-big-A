import type { AssetKind, DailyBar, MarketAsset, MarketIndex, NewsItem, TechnicalSnapshot } from '~/types/trading'

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

interface EastMoneyQuoteResponse {
  data?: {
    diff?: EastMoneyQuote[]
  }
}

interface EastMoneyListResponse {
  data?: {
    diff?: EastMoneyQuote[]
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
const HISTORY_ASSET_LIMIT = 160
const HISTORY_CHUNK_SIZE = 16

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
    isBreakout250: latestClose >= high250
  }
}

async function fetchDailyBars(code: string, market?: number, limit = HISTORY_DAYS) {
  const secid = toSecId(code, market)
  const response = await $fetch<EastMoneyKlineResponse>('https://push2his.eastmoney.com/api/qt/stock/kline/get', {
    query: {
      secid,
      klt: 101,
      fqt: 1,
      lmt: limit,
      end: '20500101',
      fields1: 'f1,f2,f3,f4,f5,f6',
      fields2: 'f51,f52,f53,f54,f55,f56,f57,f58,f59,f60,f61',
      ut: '7eea3edcaed734bea9cbfc24409ed989'
    },
    headers,
    timeout: 12000
  })

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

const quoteFields = 'f2,f3,f5,f6,f7,f8,f10,f12,f13,f14,f15,f16,f18,f20,f21,f23,f39,f62,f64,f65,f70,f71,f100'
const headers = {
  referer: 'https://quote.eastmoney.com/',
  'user-agent': 'Mozilla/5.0'
}

async function fetchQuotes(symbols: WatchSymbol[]) {
  const secids = symbols.map((item) => item.secid ?? toSecId(item.code)).join(',')
  const response = await $fetch<EastMoneyQuoteResponse>('https://push2.eastmoney.com/api/qt/ulist.np/get', {
    query: {
      fltt: 2,
      invt: 2,
      secids,
      fields: quoteFields,
      ut: 'b2884a393a59ad64002292a3e90d46a5'
    },
    headers,
    timeout: 10000
  })

  return response.data?.diff ?? []
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

async function fetchList(fs: string, size: number) {
  const response = await $fetch<EastMoneyListResponse>('https://push2.eastmoney.com/api/qt/clist/get', {
    query: {
      pn: 1,
      pz: size,
      po: 1,
      np: 1,
      fltt: 2,
      invt: 2,
      fid: 'f6',
      fs,
      fields: quoteFields,
      ut: 'b2884a393a59ad64002292a3e90d46a5'
    },
    headers,
    timeout: 12000
  })

  return response.data?.diff ?? []
}

async function fetchTradableQuotes() {
  const settled = await Promise.allSettled([
    fetchList('m:0+t:6,m:0+t:80,m:1+t:2,m:1+t:23,m:1+t:3', 900),
    fetchList('m:0+t:5,m:1+t:5', 360),
    fetchList('b:MK0021,b:MK0022,b:MK0023,b:MK0024', 300)
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

  const dynamicQuotes = [...unique.values()].sort((a, b) => cleanNumber(b.f6) - cleanNumber(a.f6))
  if (dynamicQuotes.length) return dynamicQuotes

  return await fetchQuotesInChunks(fallbackSymbols)
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
      const bars = await fetchDailyBars(code, Number.isFinite(market) ? market : undefined)
      const technical = buildTechnicalSnapshot(bars)
      return {
        secid: item.secid,
        asset: {
          ...item.asset,
          technical,
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

export async function getMarketSnapshot(extraSymbols: WatchSymbol[] = []) {
  const [indexQuotes, assetQuotes, extraQuotes] = await Promise.all([
    fetchQuotes(indexSymbols),
    fetchTradableQuotes(),
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

  const assets = attachRelativeContext(await attachHistory(baseAssets))

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
    news
  }
}
