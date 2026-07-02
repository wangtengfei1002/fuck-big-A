export type AssetKind = 'stock' | 'etf'
export type OrderSide = 'buy' | 'sell'
export type SignalAction = 'buy' | 'sell' | 'hold'
export type RiskLevel = 'low' | 'medium' | 'high'
export type StrategyHorizon = 'long' | 'swing' | 'short'

export interface DailyBar {
  date: string
  open: number
  close: number
  high: number
  low: number
  volume: number
  amount: number
  amplitude: number
  changePct: number
  changeAmount: number
  turnoverRate: number
}

export interface TechnicalSnapshot {
  historyDays: number
  closes: number[]
  volumes: number[]
  ma5: number
  ma10: number
  ma20: number
  ma60: number
  ma120: number
  ma250: number
  macdDiff: number
  macdDea: number
  macdHist: number
  rsi14: number
  volumeAvg20: number
  volumeSpike20: number
  high20: number
  low20: number
  high60: number
  low60: number
  high250: number
  low250: number
  closeVsMa20Pct: number
  closeVsMa60Pct: number
  closeVsMa250Pct: number
  isGoldenCross: boolean
  isDeathCross: boolean
  isBreakout20: boolean
  isBreakout60: boolean
  isBreakout250: boolean
}

export interface MarketAsset {
  code: string
  name: string
  kind: AssetKind
  sector: string
  price: number
  previousClose: number
  changePct: number
  volume: number
  turnover: number
  turnoverRate?: number
  marketCap?: number
  floatMarketCap?: number
  peRatio?: number
  pbRatio?: number
  industry?: string
  concepts?: string[]
  volumeRatio?: number
  amplitude?: number
  mainNetInflow?: number
  mainNetInflowPct?: number
  superOrderNetInflow?: number
  superOrderNetInflowPct?: number
  bigOrderNetInflow?: number
  bigOrderNetInflowPct?: number
  bottomScore?: number
  liquidityScore: number
  trendScore: number
  sentimentScore: number
  riskScore: number
  premiumRate?: number
  limitUp: number
  limitDown: number
  kline: number[]
  technical?: TechnicalSnapshot
  relativeStrengthRank?: number
  sectorRank?: number
  sectorMomentum?: number
  sectorAssetCount?: number
}

export interface MarketIndex {
  code: string
  name: string
  value: number
  changePct: number
  breadth: number
  volumeRatio: number
}

export interface MarketSnapshotDiagnostic {
  stage: string
  message: string
}

export interface NewsItem {
  id: string
  time: string
  source: string
  title: string
  impact: number
  tags: string[]
}

export interface Position {
  code: string
  name: string
  kind: AssetKind
  horizon: StrategyHorizon
  quantity: number
  availableQuantity: number
  lockedQuantity: number
  lockedUntil: string
  averageCost: number
  lastPrice: number
  highestPrice: number
  marketValue: number
  floatingPnl: number
  floatingPnlPct: number
  highestPnlPct: number
  openedAt: string
}

export interface TradeDecisionSnapshot {
  source: 'ai' | 'rule'
  capturedAt: string
  model?: string
  decision?: AiTradeDecision
  signal?: StrategySignal
  account: {
    cash: number
    totalAsset: number
    marketValue: number
    marketScore: number
  }
  market: {
    dataSource: string
    updatedAt: string
    indexes: MarketIndex[]
    news: NewsItem[]
  }
  asset: Partial<MarketAsset>
}

export interface Trade {
  id: string
  time: string
  side: OrderSide
  code: string
  name: string
  price: number
  quantity: number
  amount: number
  fee: number
  pnl: number
  tradeDate: string
  horizon: StrategyHorizon
  reason: string
  decisionSnapshot?: TradeDecisionSnapshot
}

export interface Order {
  id: string
  time: string
  side: OrderSide
  code: string
  name: string
  price: number
  quantity: number
  amount: number
  status: 'filled' | 'rejected' | 'skipped'
  horizon: StrategyHorizon
  reason: string
}

export interface StrategySignal {
  code: string
  name: string
  action: SignalAction
  horizon: StrategyHorizon
  score: number
  risk: RiskLevel
  suggestedWeight: number
  sellRatio: number
  reason: string
}

export interface RuleAssetAnalysis {
  code: string
  name: string
  action: SignalAction
  label: '买入' | '继续持有' | '卖出' | '观望'
  horizon: StrategyHorizon
  score: number
  risk: RiskLevel
  suggestedWeight: number
  sellRatio: number
  reason: string
  currentPrice: number
  changePct: number
  hasPosition: boolean
  targetAmount: number
}

export interface AiAssetAnalysis {
  code: string
  name: string
  action: SignalAction
  label: '买入' | '继续持有' | '卖出' | '观望'
  summary: string
  reasons: string[]
  risks: string[]
  nextSteps: string[]
  updatedAt: string
  model?: string
}

export interface AiTradeDecision {
  action: 'buy' | 'sell' | 'hold'
  code: string
  horizon: StrategyHorizon
  weight?: number
  sellRatio?: number
  confidence: number
  reason: string
  model?: string
}

export interface MarketOpportunity {
  name: string
  rating: 'high' | 'medium' | 'low'
  reason: string
  examples: string[]
}

export interface AiMarketSummary {
  summary: string
  opportunities: MarketOpportunity[]
  risks: string[]
  updatedAt: string
  model?: string
}

export interface ClosedPositionSnapshot {
  code: string
  name: string
  horizon: StrategyHorizon
  buyQuantity: number
  sellQuantity: number
  buyAmount: number
  sellAmount: number
  totalFee: number
  realizedPnl: number
  averageBuyPrice: number
  averageExitPrice: number
  currentPrice: number
  postExitChangePct: number
  lastTradeDate: string
  lastTime: string
  tradeReasons: string[]
  decisionSnapshots: TradeDecisionSnapshot[]
  asset?: Partial<MarketAsset>
}

export interface AiClosedPositionReview {
  code: string
  name: string
  outcome: 'missed_upside' | 'protected_downside' | 'neutral'
  summary: string
  mistakes: string[]
  strengths: string[]
  ruleIdeas: string[]
  updatedAt: string
  model?: string
}

export interface StrategyLog {
  id: string
  time: string
  level: RiskLevel
  message: string
}
