<script setup lang="ts">
import {
  Activity,
  Banknote,
  BookOpenText,
  Bot,
  CircleDollarSign,
  ClipboardList,
  Clock3,
  Landmark,
  Lightbulb,
  Pause,
  Play,
  RefreshCw,
  ShieldAlert,
  Sparkles,
  TrendingUp,
  Wallet,
  Zap
} from 'lucide-vue-next'
import type { Position, Trade, StrategyHorizon } from '~/types/trading'
import { useTradingStore } from '~/stores/trading'

const trading = useTradingStore()
let timer: ReturnType<typeof setInterval> | undefined

const currency = new Intl.NumberFormat('zh-CN', { style: 'currency', currency: 'CNY', maximumFractionDigits: 0 })
const exposurePct = computed(() => trading.totalAsset ? trading.marketValue / trading.totalAsset * 100 : 0)
const cashPct = computed(() => trading.totalAsset ? trading.cash / trading.totalAsset * 100 : 0)
const recentOrders = computed(() => trading.orders.filter((order) => order.side !== 'sell' || order.status === 'filled').slice(0, 16))
const recentTrades = computed(() => trading.trades.slice(0, 16))
const filledOrders = computed(() => trading.orders.filter((order) => order.status === 'filled').slice(0, 12))
const activeTab = ref<'overview' | 'ai' | 'rules'>('overview')
const tradeTab = ref<'trades' | 'closed' | 'fills'>('trades')
const latestIndex = computed(() => trading.indexes[0])
const marketAssetByCode = computed(() => new Map(trading.assets.map((asset) => [asset.code, asset])))
const summaryStatusText = computed(() => {
  if (trading.marketSummaryStatus === 'loading') return 'AI 正在总结行情'
  if (trading.marketSummaryStatus === 'ready') return `AI 总结${trading.marketSummary?.model ? ` | ${trading.marketSummary.model}` : ''}`
  if (trading.marketSummaryStatus === 'fallback') return '规则兜底总结'
  if (trading.marketSummaryStatus === 'error') return '总结生成失败'
  return '等待刷新行情'
})
const horizonLabels: Record<StrategyHorizon, string> = {
  long: '长线',
  swing: '中线',
  short: '短线'
}
const statusLines = computed(() => {
  if (trading.liveError) return [trading.liveError]
  const time = trading.updatedAt
    ? new Intl.DateTimeFormat('zh-CN', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }).format(new Date(trading.updatedAt))
    : '未加载'
  return [
    `数据源 ${trading.dataSource || '-'},更新时间 ${time}`,
    `已扫描 ${trading.assets.length} 个标的,信号 ${trading.signals.length} 个`,
  ]
})
const dbStatus = computed(() => {
  if (trading.syncStatus === 'synced') return '已同步'
  if (trading.syncStatus === 'syncing') return '同步中'
  if (trading.syncStatus === 'error') return '同步失败'
  if (trading.restoreStatus === 'restored') return '已恢复'
  if (trading.restoreStatus === 'loading') return '恢复中'
  if (trading.restoreStatus === 'empty') return '等待首次写入'
  if (trading.restoreStatus === 'error') return '恢复失败'
  return '未同步'
})
const aiStatusText = computed(() => {
  if (trading.aiStatus === 'thinking') return 'AI 分析中'
  if (trading.aiStatus === 'used') return 'AI 决策'
  if (trading.aiStatus === 'resting') return '等待机会'
  if (trading.aiStatus === 'fallback') return '规则兜底'
  if (trading.aiStatus === 'disabled') return 'AI 未启用'
  if (trading.aiStatus === 'error') return 'AI 异常'
  return '等待'
})
const tIncomeRange = ref<'today' | '7d' | 'month' | 'recentMonth' | 'total'>('today')
const tIncomeOptions = [
  { value: 'today', label: '当天' },
  { value: '7d', label: '7天' },
  { value: 'month', label: '当月' },
  { value: 'recentMonth', label: '近一月' },
  { value: 'total', label: '总计' }
] as const
const selectedTIncome = computed(() => {
  if (tIncomeRange.value === '7d') return trading.tIncome7d
  if (tIncomeRange.value === 'month') return trading.tIncomeMonth
  if (tIncomeRange.value === 'recentMonth') return trading.tIncomeRecentMonth
  if (tIncomeRange.value === 'total') return trading.tIncomeTotal
  return trading.tIncomeToday
})
const incomeRange = ref<'today' | 'week' | 'month' | 'recentMonth' | 'total'>('today')
const incomeOptions = [
  { value: 'today', label: '当天' },
  { value: 'week', label: '本周' },
  { value: 'month', label: '当月' },
  { value: 'recentMonth', label: '近一月' },
  { value: 'total', label: '总计' }
] as const
const mainTabs = [
  { key: 'overview', label: '交易总览', icon: Activity },
  { key: 'ai', label: 'AI 行情与机会', icon: Bot },
  { key: 'rules', label: '项目与规则', icon: BookOpenText }
] as const
const ruleCards = [
  {
    title: '项目代码逻辑',
    icon: Activity,
    items: [
      '页面启动后先从 Supabase 恢复 default 组合：现金、持仓、委托、成交和策略日志；没有历史状态时使用 50,000 元模拟资金。',
      '自动驾驶开启后每 15 秒尝试运行一次 runAutoTrade；真正的扫描和交易只在工作日 09:25-11:30、13:00-15:00（Asia/Shanghai）窗口内发生。',
      '行情入口统一为 /api/market/snapshot：拉取主要指数、动态高成交 A 股/ETF、当前持仓补充报价，并生成资金流、底部、技术面和相对强弱数据。',
      '行情刷新会重算持仓市值、浮盈亏、T+1/T+0 可卖数量、市场评分和候选信号；交易或行情刷新后都会同步到 Supabase。',
      '页面只负责展示和触发动作，买卖、仓位、AI、数据库同步都集中在 Pinia store，规则打分集中在 useStrategy。'
    ]
  },
  {
    title: '交易规则',
    icon: ClipboardList,
    items: [
      '买入以约 10,000 元为偏好金额，按 100 股一手取整；低于 4,995 元不买，现金不足或价格触及涨停会拒单。',
      '买入手续费按万 2.5、最低 5 元估算；卖出手续费为万 2.5、最低 5 元，再加千 0.5 印花税。',
      '长线、中线、短线各有独立仓位桶，单桶最高按组合净值 100% 控制；规则买入单 tick 最多执行 2 笔。',
      '普通股票买入后按 T+1 锁定；513 开头或港股、恒生、中概、纳指、标普、日经、黄金、商品、货币、债券、QDII 等 ETF 按 T+0 可卖。',
      '卖出同样按 100 股取整；持仓市值低于 5,000 元只允许一次清仓，高于 5,000 元时单次卖出尽量不低于 5,000 元，并避免留下低于 5,000 元的小尾仓。',
      '长线最短观察 10 天，中线 3 天，短线 1 天；只有硬止损、风险分过高等紧急风控可提前卖出。',
      '本地信号综合趋势、情绪、流动性、市场评分、底部评分、资金流、量比、均线/MACD/RSI、突破、板块强度和估值规模；涨幅过热、技术扩张过远、高换手小盘投机会降权。'
    ]
  },
  {
    title: 'AI 决策规则',
    icon: Sparkles,
    items: [
      'AI 决策层每 10 分钟最多请求一次；只有当前存在可执行的买入或卖出信号时才调用 AI。',
      'AI 输入包含现金、总资产、市场评分、指数、新闻、持仓、前 60 个候选信号，以及价格、成交额、资金流、底部评分、技术指标、相对强弱、板块排名、估值和市值等压缩数据。',
      'AI 只能返回 buy、sell 或 hold，并需要给出周期、置信度、理由、目标权重或卖出比例；接口返回会校验代码、动作、周期和数值范围。',
      '置信度低于 0.55 的 AI 决策不执行；买入还会受现金预留、目标权重、仓位桶和最低买入金额约束，卖出继续受 T+1、跌停、最短持仓期和最低卖出金额约束。',
      'AI prompt 明确要求稀疏高置信决策，不默认偏好 ETF，不做弱分散；底部机会必须有放量和大单/主力净流入支撑，强势机会也要避免高 RSI 和远离均线的追涨。',
      '没有可执行信号、持仓 T+1 锁定或现金不足时，AI 会保持等待机会，不做规则兜底交易；手动闪电按钮会强制刷新行情、强制请求 AI 决策，并额外生成一次行情总结。',
      'AI 行情总结单独请求 /api/ai/market-summary；未配置或失败时，会用规则兜底生成盘面摘要、机会板块和风险提示。'
    ]
  }
]

function chinaTradeDate(date = new Date()) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).format(date)
}

function startOfChinaWeek(date = new Date()) {
  const weekday = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Shanghai',
    weekday: 'short'
  }).format(date)
  const weekdayIndex = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(weekday)
  const start = new Date(date)
  start.setDate(start.getDate() - ((weekdayIndex + 6) % 7))
  return chinaTradeDate(start)
}

const incomeStartDate = computed(() => {
  const now = new Date()
  if (incomeRange.value === 'total') return ''
  if (incomeRange.value === 'today') return chinaTradeDate(now)
  if (incomeRange.value === 'week') return startOfChinaWeek(now)
  if (incomeRange.value === 'month') return `${chinaTradeDate(now).slice(0, 7)}-01`
  const start = new Date(now)
  start.setMonth(start.getMonth() - 1)
  return chinaTradeDate(start)
})

const selectedIncomeFees = computed(() => {
  if (incomeRange.value === 'total') return trading.totalFees
  const startDate = incomeStartDate.value
  return trading.trades
    .filter((trade) => trade.tradeDate && trade.tradeDate >= startDate)
    .reduce((sum, trade) => sum + trade.fee, 0)
})

const closedPositions = computed(() => {
  const openCodes = new Set(trading.positions.map((position) => position.code))
  const summary = new Map<string, {
    code: string
    name: string
    horizon: StrategyHorizon
    buyQuantity: number
    sellQuantity: number
    buyAmount: number
    sellAmount: number
    totalFee: number
    realizedPnl: number
    lastTime: string
    lastTradeDate: string
  }>()

  const chronologicalTrades = [...trading.trades].reverse()
  for (const trade of chronologicalTrades) {
    const current = summary.get(trade.code) ?? {
      code: trade.code,
      name: trade.name,
      horizon: trade.horizon,
      buyQuantity: 0,
      sellQuantity: 0,
      buyAmount: 0,
      sellAmount: 0,
      totalFee: 0,
      realizedPnl: 0,
      lastTime: trade.time,
      lastTradeDate: trade.tradeDate
    }

    current.name = trade.name
    current.horizon = trade.horizon
    current.totalFee += trade.fee
    current.lastTime = trade.time
    current.lastTradeDate = trade.tradeDate

    if (trade.side === 'buy') {
      current.buyQuantity += trade.quantity
      current.buyAmount += trade.amount
    } else {
      current.sellQuantity += trade.quantity
      current.sellAmount += trade.amount
      current.realizedPnl += trade.pnl
    }

    summary.set(trade.code, current)
  }

  return [...summary.values()]
    .filter((item) => item.sellQuantity > 0 && item.buyQuantity > 0 && item.buyQuantity <= item.sellQuantity && !openCodes.has(item.code))
    .sort((a, b) => {
      const dateCompare = (b.lastTradeDate || '').localeCompare(a.lastTradeDate || '')
      return dateCompare || b.lastTime.localeCompare(a.lastTime)
    })
})

function pct(value: number) {
  const safe = Number.isFinite(value) ? value : 0
  return `${safe >= 0 ? '+' : ''}${safe.toFixed(2)}%`
}

function tradePnlPct(trade: Trade) {
  if (trade.side !== 'sell') return 0
  const costBasis = trade.amount - trade.fee - trade.pnl
  return costBasis > 0 ? trade.pnl / costBasis * 100 : 0
}

function priceText(value: number) {
  const safe = Number.isFinite(value) ? value : 0
  return safe.toFixed(safe > 0 && safe < 10 ? 3 : 2)
}

function timeText(value: string) {
  if (!value) return '--:--'
  return new Intl.DateTimeFormat('zh-CN', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }).format(new Date(value))
}

function money(value: number) {
  return currency.format(Number.isFinite(value) ? value : 0)
}

function horizonText(horizon: StrategyHorizon) {
  return horizonLabels[horizon] ?? '中线'
}

function todayTradesFor(code: string) {
  const today = chinaTradeDate()
  return [...trading.trades]
    .filter((trade) => trade.code === code && trade.tradeDate === today)
    .reverse()
}

function dayPnlForCode(code: string) {
  const position = trading.positions.find((item) => item.code === code)
  const trades = todayTradesFor(code)
  const asset = marketAssetByCode.value.get(code)
  if (!trades.length) {
    if (!position || !asset?.previousClose) return 0
    return (position.lastPrice - asset.previousClose) * position.quantity
  }

  const buyQuantity = trades
    .filter((trade) => trade.side === 'buy')
    .reduce((sum, trade) => sum + trade.quantity, 0)
  const soldQuantity = trades
    .filter((trade) => trade.side === 'sell')
    .reduce((sum, trade) => sum + trade.quantity, 0)
  const buyCost = trades
    .filter((trade) => trade.side === 'buy')
    .reduce((sum, trade) => sum + trade.amount + trade.fee, 0)
  const sellProceeds = trades
    .filter((trade) => trade.side === 'sell')
    .reduce((sum, trade) => sum + trade.amount - trade.fee, 0)
  const currentQuantity = position?.quantity ?? 0
  const currentMarketValue = position?.marketValue ?? 0
  const openingQuantity = Math.max(0, currentQuantity - buyQuantity + soldQuantity)
  const previousClose = asset?.previousClose || position?.lastPrice || 0
  const openingValue = openingQuantity * previousClose

  return currentMarketValue + sellProceeds - buyCost - openingValue
}

function dayPnlDenominatorForCode(code: string) {
  const position = trading.positions.find((item) => item.code === code)
  const trades = todayTradesFor(code)
  const asset = marketAssetByCode.value.get(code)
  if (!trades.length) return position && asset?.previousClose ? position.quantity * asset.previousClose : 0

  const buyCost = trades
    .filter((trade) => trade.side === 'buy')
    .reduce((sum, trade) => sum + trade.amount + trade.fee, 0)
  const buyQuantity = trades
    .filter((trade) => trade.side === 'buy')
    .reduce((sum, trade) => sum + trade.quantity, 0)
  const soldQuantity = trades
    .filter((trade) => trade.side === 'sell')
    .reduce((sum, trade) => sum + trade.quantity, 0)
  const currentQuantity = position?.quantity ?? 0
  const openingQuantity = Math.max(0, currentQuantity - buyQuantity + soldQuantity)
  const previousClose = asset?.previousClose || position?.lastPrice || 0
  return openingQuantity * previousClose + buyCost
}

function positionDayPnl(position: Position) {
  return dayPnlForCode(position.code)
}

function positionDayPct(position: Position) {
  const denominator = dayPnlDenominatorForCode(position.code)
  return denominator > 0 ? dayPnlForCode(position.code) / denominator * 100 : 0
}

const selectedIncome = computed(() => {
  if (incomeRange.value === 'total') return trading.totalPnl
  if (incomeRange.value === 'today') {
    const today = chinaTradeDate()
    const codes = new Set([
      ...trading.positions.map((position) => position.code),
      ...trading.trades.filter((trade) => trade.tradeDate === today).map((trade) => trade.code)
    ])
    return [...codes].reduce((sum, code) => sum + dayPnlForCode(code), 0)
  }
  const realized = (() => {
    if (incomeRange.value === 'week') return trading.incomeWeek
    if (incomeRange.value === 'month') return trading.incomeMonth
    if (incomeRange.value === 'recentMonth') return trading.incomeRecentMonth
    return trading.incomeToday
  })()
  return realized + trading.floatingPnl
})

async function runOnce() {
  await trading.runAutoTrade()
}

onMounted(async () => {
  await trading.restoreFromDatabase()
  await trading.loadLiveMarket()
  if (trading.autoPilot) {
    await runOnce()
  }
  timer = setInterval(async () => {
    if (!trading.autoPilot) return
    await runOnce()
  }, 15000)
})

onBeforeUnmount(() => {
  if (timer) clearInterval(timer)
})
</script>

<template>
  <main class="min-h-screen px-3 py-3 text-ink lg:px-5">
    <header class="mb-3 grid grid-cols-1 gap-3 xl:grid-cols-[1fr_430px]">
      <section class="grid grid-cols-2 gap-2 md:grid-cols-3 xl:grid-cols-6">
        <div class="metric">
          <div class="metric-label"><Wallet :size="15" />总资产</div>
          <strong>{{ money(trading.totalAsset) }}</strong>
          <span :class="trading.returnPct >= 0 ? 'text-rise' : 'text-fall'">{{ pct(trading.returnPct) }}</span>
        </div>
        <div class="metric">
          <div class="metric-label"><Banknote :size="15" />可用现金</div>
          <strong>{{ money(trading.cash) }}</strong>
          <span>{{ cashPct.toFixed(1) }}% 现金</span>
        </div>
        <div class="metric">
          <div class="metric-label"><Landmark :size="15" />持仓市值</div>
          <strong>{{ money(trading.marketValue) }}</strong>
          <span>{{ exposurePct.toFixed(1) }}% 仓位</span>
        </div>
        <div class="metric">
          <div class="metric-label"><TrendingUp :size="15" />持仓盈亏</div>
          <strong :class="trading.floatingPnl >= 0 ? 'text-rise' : 'text-fall'">{{ money(trading.floatingPnl) }}</strong>
          <span>按最新价估算</span>
        </div>
        <div class="metric">
          <div class="metric-label"><TrendingUp :size="15" />收益</div>
          <div class="metric-segmented">
            <button
              v-for="option in incomeOptions"
              :key="option.value"
              :class="{ active: incomeRange === option.value }"
              type="button"
              @click="incomeRange = option.value"
            >
              {{ option.label }}
            </button>
          </div>
          <strong :class="selectedIncome >= 0 ? 'text-rise' : 'text-fall'">{{ money(selectedIncome) }}</strong>
          <span>含手续费 {{ money(selectedIncomeFees) }}</span>
        </div>
        <div class="metric">
          <div class="metric-label"><CircleDollarSign :size="15" />总手续费</div>
          <strong>{{ money(trading.totalFees) }}</strong>
          <span>买卖累计</span>
        </div>
      </section>

      <section class="toolbar">
        <div class="flex items-center gap-2">
          <button class="icon-button" :title="trading.autoPilot ? '暂停自动买卖' : '开启自动买卖'" @click="trading.autoPilot = !trading.autoPilot">
            <Pause v-if="trading.autoPilot" :size="17" />
            <Play v-else :size="17" />
          </button>
          <label class="toggle-button" title="自动执行会按真实交易时间后台扫描和决策">
            <input v-model="trading.autoExecute" type="checkbox">
            <span>{{ trading.autoExecute ? '自动执行' : '停止执行' }}</span>
          </label>
          <button class="icon-button" title="刷新真实行情" :disabled="trading.loading" @click="trading.loadLiveMarket">
            <RefreshCw :size="17" />
          </button>
          <button class="icon-button" title="手动触发 AI 决策（不执行买卖）" :disabled="trading.aiStatus === 'thinking'" @click="trading.probeAiDecision">
            <Zap :size="17" />
          </button>
          <div class="market-chip" title="市场状态">
            <ShieldAlert :size="15" />
            <div>
              <span>{{ latestIndex?.name ?? '市场状态' }}</span>
              <strong :class="(latestIndex?.changePct ?? 0) >= 0 ? 'text-rise' : 'text-fall'">
                {{ latestIndex ? `${latestIndex.value.toFixed(2)} ${pct(latestIndex.changePct)}` : '等待数据' }}
              </strong>
            </div>
          </div>
        </div>
        <div class="mt-2 min-w-0 text-left">
          <div class="text-xs font-semibold uppercase text-slate-500">自动交易状态: {{ trading.loading ? '正在拉取真实行情...' : trading.autoPilot && trading.autoExecute ? '自动买卖运行中' : '自动买卖暂停' }}</div>
          <p v-for="line in statusLines" :key="line" class="truncate text-xs leading-relaxed" :class="trading.liveError ? 'text-fall' : 'text-ocean'">{{ line }}</p>
        </div>
      </section>
    </header>

    <nav class="page-tabs mb-3" aria-label="页面视图">
      <button
        v-for="tab in mainTabs"
        :key="tab.key"
        :class="{ active: activeTab === tab.key }"
        type="button"
        @click="activeTab = tab.key"
      >
        <component :is="tab.icon" :size="17" />
        <span>{{ tab.label }}</span>
      </button>
    </nav>

    <section v-if="activeTab === 'overview'" class="space-y-3">
      <section class="panel">
        <div class="panel-title">
          <span><Activity :size="16" />数据加载状态</span>
        </div>
        <div class="grid gap-2 md:grid-cols-3 xl:grid-cols-8">
          <div class="stat-box">
            <span>行情是否正常</span>
            <strong>{{ trading.liveError ? '异常' : trading.assets.length ? '正常' : '等待' }}</strong>
          </div>
          <div class="stat-box">
            <span>扫描标的数</span>
            <strong>{{ trading.assets.length }}</strong>
          </div>
          <div class="stat-box">
            <span>长线仓位</span>
            <strong>{{ money(trading.horizonExposure.long) }}</strong>
          </div>
          <div class="stat-box">
            <span>中线/短线</span>
            <strong>{{ money(trading.horizonExposure.swing + trading.horizonExposure.short) }}</strong>
          </div>
          <div class="stat-box">
            <span>决策层</span>
            <strong>{{ aiStatusText }}</strong>
          </div>
          <div class="stat-box">
            <span>数据库状态</span>
            <strong>{{ dbStatus }}</strong>
          </div>
          <div class="stat-box xl:col-span-2">
            <div class="stat-head">
              <span>做 T 收入</span>
              <div class="segmented">
                <button
                  v-for="option in tIncomeOptions"
                  :key="option.value"
                  :class="{ active: tIncomeRange === option.value }"
                  type="button"
                  @click="tIncomeRange = option.value"
                >
                  {{ option.label }}
                </button>
              </div>
            </div>
            <strong :class="selectedTIncome >= 0 ? 'text-rise' : 'text-fall'">{{ money(selectedTIncome) }}</strong>
          </div>
        </div>
        <p v-if="trading.syncError || trading.restoreError || trading.aiError" class="mt-2 text-xs text-fall">
          {{ trading.syncError || trading.restoreError || trading.aiError }}
        </p>
      </section>

      <div class="grid gap-3 xl:grid-cols-2">
        <section class="panel min-w-0">
          <div class="panel-title">
            <span><Wallet :size="16" />当前持仓</span>
            <small class="text-xs text-slate-500">{{ trading.positions.length }} 个持仓</small>
          </div>
          <div class="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>标的</th>
                  <th>周期</th>
                  <th>数量</th>
                  <th>成本/现价</th>
                  <th>市值</th>
                  <th>当日盈亏</th>
                  <th>盈亏</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="position in trading.positions" :key="position.code">
                  <td>
                    <button class="link-cell">{{ position.name }}</button>
                    <small>{{ position.code }} | {{ position.availableQuantity }} 可卖</small>
                  </td>
                  <td><span class="tag">{{ horizonText(position.horizon) }}</span></td>
                  <td>{{ position.quantity }}</td>
                  <td>
                    {{ position.averageCost.toFixed(3) }}
                    <small>{{ position.lastPrice.toFixed(position.lastPrice < 10 ? 3 : 2) }}</small>
                  </td>
                  <td>{{ money(position.marketValue) }}</td>
                  <td :class="positionDayPnl(position) >= 0 ? 'text-rise' : 'text-fall'">
                    {{ money(positionDayPnl(position)) }}
                    <small>{{ pct(positionDayPct(position)) }}</small>
                  </td>
                  <td :class="position.floatingPnl >= 0 ? 'text-rise' : 'text-fall'">
                    {{ money(position.floatingPnl) }}
                    <small>{{ pct(position.floatingPnlPct) }} | 最高 {{ pct(position.highestPnlPct) }}</small>
                  </td>
                </tr>
                <tr v-if="!trading.positions.length">
                  <td colspan="7" class="empty">当前空仓，等待自动交易建仓</td>
                </tr>
              </tbody>
            </table>
          </div>
        </section>

        <section class="panel min-w-0">
          <div class="panel-title">
            <span><ClipboardList :size="16" />委托记录</span>
            <small class="text-xs text-slate-500">{{ trading.orders.length }} 条</small>
          </div>
          <div class="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>时间</th>
                  <th>方向</th>
                  <th>标的</th>
                  <th>周期</th>
                  <th>金额</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="order in recentOrders" :key="order.id">
                  <td>{{ order.time }}</td>
                  <td :class="order.side === 'buy' ? 'text-rise' : 'text-fall'">{{ order.side === 'buy' ? '买入' : '卖出' }}</td>
                  <td>
                    <button class="link-cell" :title="`${order.name} ${order.code}`">{{ order.name }}</button>
                    <small :title="`${order.status} | ${order.reason}`">{{ order.status }} | {{ order.reason }}</small>
                  </td>
                  <td><span class="tag">{{ horizonText(order.horizon) }}</span></td>
                  <td>
                    {{ money(order.amount) }}
                    <small>@ {{ priceText(order.price) }} | {{ order.quantity }} 股 | {{ timeText(trading.updatedAt) }}</small>
                  </td>
                </tr>
                <tr v-if="!recentOrders.length">
                  <td colspan="5" class="empty">暂无委托</td>
                </tr>
              </tbody>
            </table>
          </div>
        </section>
      </div>

      <section class="panel min-w-0">
        <div class="panel-title">
          <span><Clock3 :size="16" />成交与委托摘要</span>
          <div class="segmented">
            <button :class="{ active: tradeTab === 'trades' }" type="button" @click="tradeTab = 'trades'">成交</button>
            <button :class="{ active: tradeTab === 'closed' }" type="button" @click="tradeTab = 'closed'">清仓</button>
            <button :class="{ active: tradeTab === 'fills' }" type="button" @click="tradeTab = 'fills'">已成委托</button>
          </div>
        </div>
        <div class="table-wrap">
          <table v-if="tradeTab === 'trades'">
            <thead>
              <tr>
                <th>时间</th>
                <th>方向</th>
                <th>标的</th>
                <th>周期</th>
                <th>金额</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="trade in recentTrades" :key="trade.id">
                <td>{{ trade.time }}</td>
                <td :class="trade.side === 'buy' ? 'text-rise' : 'text-fall'">{{ trade.side === 'buy' ? '买入' : '卖出' }}</td>
                <td>
                  <button class="link-cell">{{ trade.name }}</button>
                  <small>{{ trade.quantity }} 股 | {{ trade.reason }}</small>
                </td>
                <td><span class="tag">{{ horizonText(trade.horizon) }}</span></td>
                <td>
                  {{ money(trade.amount) }}
                  <small>@ {{ priceText(trade.price) }} | {{ trade.quantity }} 股 | {{ timeText(trading.updatedAt) }}</small>
                  <small v-if="trade.side === 'sell'" :class="trade.pnl >= 0 ? 'text-rise' : 'text-fall'">
                    {{ trade.pnl >= 0 ? '盈利' : '亏损' }} {{ money(trade.pnl) }} | {{ pct(tradePnlPct(trade)) }}
                  </small>
                </td>
              </tr>
              <tr v-if="!trading.trades.length">
                <td colspan="5" class="empty">暂无成交</td>
              </tr>
            </tbody>
          </table>

          <table v-else-if="tradeTab === 'closed'">
            <thead>
              <tr>
                <th>标的</th>
                <th>周期</th>
                <th>买入/卖出股数</th>
                <th>累计成交</th>
                <th>已实现盈亏</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="item in closedPositions" :key="item.code">
                <td>
                  <button class="link-cell">{{ item.name }}</button>
                  <small>{{ item.code }} | {{ item.lastTradeDate }} {{ item.lastTime }}</small>
                </td>
                <td><span class="tag">{{ horizonText(item.horizon) }}</span></td>
                <td>{{ item.buyQuantity }} / {{ item.sellQuantity }}</td>
                <td>
                  {{ money(item.buyAmount + item.sellAmount) }}
                  <small>费用 {{ money(item.totalFee) }}</small>
                </td>
                <td :class="item.realizedPnl >= 0 ? 'text-rise' : 'text-fall'">{{ money(item.realizedPnl) }}</td>
              </tr>
              <tr v-if="!closedPositions.length">
                <td colspan="5" class="empty">暂无已清仓标的</td>
              </tr>
            </tbody>
          </table>

          <table v-else>
            <thead>
              <tr>
                <th>时间</th>
                <th>动作</th>
                <th>标的</th>
                <th>周期</th>
                <th>数量</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="order in filledOrders" :key="order.id">
                <td>{{ order.time }}</td>
                <td :class="order.side === 'buy' ? 'text-rise' : 'text-fall'">{{ order.side === 'buy' ? '买入' : '卖出' }}</td>
                <td>{{ order.name }}</td>
                <td><span class="tag">{{ horizonText(order.horizon) }}</span></td>
                <td>
                  {{ order.quantity }}
                  <small>@ {{ priceText(order.price) }} | {{ timeText(trading.updatedAt) }}</small>
                </td>
              </tr>
              <tr v-if="!filledOrders.length">
                <td colspan="5" class="empty">暂无已成交委托</td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>
    </section>

    <section v-else-if="activeTab === 'ai'" class="panel">
      <div class="panel-title">
        <span><Lightbulb :size="16" />AI 行情总结与机会板块</span>
        <small class="text-xs text-slate-500">{{ summaryStatusText }}</small>
      </div>
      <div v-if="trading.marketSummary" class="market-summary">
        <div class="summary-hero">
          <div>
            <span>盘面摘要</span>
            <p>{{ trading.marketSummary.summary }}</p>
          </div>
          <strong>{{ trading.marketScore }}</strong>
        </div>
        <div class="opportunity-grid">
          <article v-for="item in trading.marketSummary.opportunities" :key="item.name" class="opportunity-card">
            <div>
              <strong>{{ item.name }}</strong>
              <span :class="`rating ${item.rating}`">{{ item.rating === 'high' ? '机会强' : item.rating === 'medium' ? '可观察' : '谨慎' }}</span>
            </div>
            <p>{{ item.reason }}</p>
            <small v-if="item.examples.length">{{ item.examples.join(' / ') }}</small>
          </article>
        </div>
        <div v-if="trading.marketSummary.risks.length" class="risk-list">
          <span v-for="risk in trading.marketSummary.risks" :key="risk">{{ risk }}</span>
        </div>
      </div>
      <div v-else class="empty compact">
        刷新真实行情后，会在这里生成盘面总结和机会板块。
      </div>
      <p v-if="trading.marketSummaryError" class="mt-2 text-xs text-amber">
        {{ trading.marketSummaryError }}
      </p>
    </section>

    <section v-else class="rules-layout">
      <article v-for="card in ruleCards" :key="card.title" class="rule-card">
        <div class="rule-card-head">
          <component :is="card.icon" :size="18" />
          <h2>{{ card.title }}</h2>
        </div>
        <ol>
          <li v-for="item in card.items" :key="item">{{ item }}</li>
        </ol>
      </article>
    </section>
  </main>
</template>
