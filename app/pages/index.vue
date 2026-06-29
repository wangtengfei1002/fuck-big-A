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
  Wallet
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
const statusLine = computed(() => {
  if (trading.liveError) return trading.liveError
  const time = trading.updatedAt
    ? new Intl.DateTimeFormat('zh-CN', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }).format(new Date(trading.updatedAt))
    : '未加载'
  return `数据源 ${trading.dataSource || '-'} | 更新时间 ${time} | 已扫描 ${trading.assets.length} 个标的 | 信号 ${trading.signals.length} 个`
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
      '页面挂载后先从 Supabase 恢复模拟账户、持仓、委托、成交和策略日志。',
      '自动驾驶开启时每 15 秒触发一次 runAutoTrade，并只在 A 股交易窗口内执行扫描。',
      '刷新行情会请求 /api/market/snapshot，更新指数、候选标的、新闻和最新估值。',
      '每次交易或行情刷新后会同步到 Supabase，页面顶部显示同步和恢复状态。'
    ]
  },
  {
    title: '交易规则',
    icon: ClipboardList,
    items: [
      '初始资金 50,000 元，单笔优先买入约 10,000 元，低于 4,995 元不买。',
      '买入按 A 股 100 股一手取整，手续费按万 2.5 且最低 5 元估算。',
      '卖出按一手取整；持仓市值低于 5,000 元只允许清仓，高于 5,000 元时单次卖出不低于 5,000 元。',
      '普通股票买入后 T+1 解锁，跨境 ETF、黄金、债券、QDII 等按 T+0 可卖处理。',
      '涨停附近不追买，涨幅过热会降权；跌停附近不强卖；长线、中线、短线各有独立仓位桶。'
    ]
  },
  {
    title: 'AI 决策规则',
    icon: Sparkles,
    items: [
      'AI 决策每 10 分钟最多请求一次，输入包含现金、总资产、市场评分、指数、新闻、持仓和候选信号。',
      'AI 返回 buy、sell 或 hold，并带有周期、置信度、理由、目标权重或卖出比例。',
      '置信度低于 0.55 的 AI 决策不会执行，买入还会受现金、仓位桶、追涨过滤和目标权重约束。',
      '长线默认至少观察约 10 个交易日，中线约 3 个交易日；除硬风控外，AI 不应把长线持仓当隔日交易。',
      'AI 未启用或接口异常时，系统自动回退到本地规则信号进行买卖。',
      'AI 行情总结单独请求 /api/ai/market-summary，用于生成盘面摘要、机会板块和风险提示。'
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

const selectedRangeCoversAllTrades = computed(() => {
  if (incomeRange.value === 'total') return true
  if (!trading.trades.length) return true
  const startDate = incomeStartDate.value
  return trading.trades.every((trade) => trade.tradeDate && trade.tradeDate >= startDate)
})

const selectedIncome = computed(() => {
  if (selectedRangeCoversAllTrades.value) return trading.totalPnl
  const realized = (() => {
    if (incomeRange.value === 'week') return trading.incomeWeek
    if (incomeRange.value === 'month') return trading.incomeMonth
    if (incomeRange.value === 'recentMonth') return trading.incomeRecentMonth
    return trading.incomeToday
  })()
  return realized + trading.floatingPnl
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

function positionDayPnl(position: Position) {
  const trades = todayTradesFor(position.code)
  if (!trades.length) {
    const asset = marketAssetByCode.value.get(position.code)
    if (!asset?.previousClose) return 0
    return (position.lastPrice - asset.previousClose) * position.quantity
  }

  const realized = trades
    .filter((trade) => trade.side === 'sell')
    .reduce((sum, trade) => sum + trade.pnl, 0)
  const buyQuantity = trades
    .filter((trade) => trade.side === 'buy')
    .reduce((sum, trade) => sum + trade.quantity, 0)
  const soldQuantity = trades
    .filter((trade) => trade.side === 'sell')
    .reduce((sum, trade) => sum + trade.quantity, 0)
  const remainingTodayBuyQuantity = Math.max(0, Math.min(position.quantity, buyQuantity - soldQuantity))
  if (!remainingTodayBuyQuantity) return realized

  const todayBuyCost = trades
    .filter((trade) => trade.side === 'buy')
    .reduce((sum, trade) => sum + trade.amount + trade.fee, 0)
  const averageTodayBuyCost = todayBuyCost / Math.max(buyQuantity, 1)
  const unrealizedTodayBuyPnl = (position.lastPrice - averageTodayBuyCost) * remainingTodayBuyQuantity
  return realized + unrealizedTodayBuyPnl
}

function positionDayPct(position: Position) {
  const trades = todayTradesFor(position.code)
  if (!trades.length) {
    const asset = marketAssetByCode.value.get(position.code)
    if (!asset?.previousClose) return 0
    return (position.lastPrice - asset.previousClose) / asset.previousClose * 100
  }

  const todayCost = trades.reduce((sum, trade) => {
    if (trade.side === 'buy') return sum + trade.amount + trade.fee
    return sum + Math.max(0, trade.amount - trade.fee - trade.pnl)
  }, 0)
  return todayCost > 0 ? positionDayPnl(position) / todayCost * 100 : 0
}

async function runOnce() {
  await trading.runAutoTrade()
}

onMounted(async () => {
  await trading.restoreFromDatabase()
  await trading.loadLiveMarket({ summarize: false })
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
        <div class="market-chip" title="市场状态">
          <ShieldAlert :size="15" />
          <div>
            <span>{{ latestIndex?.name ?? '市场状态' }}</span>
            <strong :class="(latestIndex?.changePct ?? 0) >= 0 ? 'text-rise' : 'text-fall'">
              {{ latestIndex ? `${latestIndex.value.toFixed(2)} ${pct(latestIndex.changePct)}` : '等待数据' }}
            </strong>
          </div>
        </div>
        <div class="ml-auto min-w-0 text-right">
          <div class="text-xs font-semibold uppercase text-slate-500">自动交易状态</div>
          <p class="truncate text-sm font-semibold">{{ trading.loading ? '正在拉取真实行情...' : trading.autoPilot && trading.autoExecute ? '自动买卖运行中' : '自动买卖暂停' }}</p>
          <p class="truncate text-xs" :class="trading.liveError ? 'text-fall' : 'text-ocean'">{{ statusLine }}</p>
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
