import type { AssetKind, MarketAsset, MarketIndex, NewsItem } from '~/types/trading'

interface EastMoneyQuote {
  f2?: number
  f3?: number
  f5?: number
  f6?: number
  f7?: number
  f10?: number
  f12?: string
  f13?: number
  f14?: string
  f15?: number
  f16?: number
  f18?: number
  f62?: number
  f64?: number
  f65?: number
  f70?: number
  f71?: number
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

function scoreFromQuote(changePct: number, turnover: number, amplitude: number, volumeRatio: number, mainNetInflowPct: number, bottomScore: number) {
  const liquidityScore = Math.max(20, Math.min(98, Math.log10(Math.max(turnover, 1)) * 9))
  const trendScore = Math.max(10, Math.min(95, 55 + changePct * 7 + Math.min(10, mainNetInflowPct * 0.6) + bottomScore * 0.08))
  const sentimentScore = Math.max(10, Math.min(95, 52 + changePct * 8 + liquidityScore * 0.08 + mainNetInflowPct * 0.9 + Math.max(0, volumeRatio - 1) * 5))
  const riskScore = Math.max(12, Math.min(88, Math.abs(changePct) * 9 + amplitude * 2.8 - Math.max(0, bottomScore - 55) * 0.12))
  return { liquidityScore, trendScore, sentimentScore, riskScore }
}

const quoteFields = 'f2,f3,f5,f6,f7,f10,f12,f13,f14,f15,f16,f18,f62,f64,f65,f70,f71'
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
    sector: sectorFor(code, kind),
    price,
    previousClose,
    changePct,
    volume: cleanNumber(quote.f5),
    turnover,
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

  const assets = [...quoteBySecid.values()]
    .map(quoteToAsset)
    .filter((asset): asset is MarketAsset => Boolean(asset))

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
