# AGENTS.md — fuck-big-a (A-Share Auto Trader)

A 股模拟交易仪表盘：Nuxt 4 全栈，东方财富实时行情 + 规则策略 + 多 AI Provider 决策/分析/复盘，状态持久化到 Supabase，可选 PushPlus 交易通知。

**改功能前先读此文件，不要全库搜索。** 项目很小（二十多个源文件），按下方路径直达即可。

## 命令

```bash
npm install          # postinstall 会跑 nuxt prepare
npm run dev          # 开发服务器，默认 http://localhost:3000
npm run build        # 生产构建
npm run preview      # 预览构建产物
```

无 lint / test 脚本。TypeScript strict 已开。包管理用 npm（有 package-lock.json）。

## 目录地图

```text
app/
  types/trading.ts          # 全部领域类型（单一真相源）
  stores/trading.ts         # Pinia 核心：行情、持仓、买卖、AI、复盘、Supabase 同步（最大文件）
  composables/useStrategy.ts # 规则策略：打分、信号生成、卖出判断
  pages/index.vue           # 唯一页面：仪表盘 UI + 定时器 + 单票分析/清仓复盘入口
  components/MiniLineChart.client.vue  # ECharts 迷你 K 线（仅客户端）
  assets/css/main.css       # Tailwind 入口样式
  app.vue                   # 仅 <NuxtPage />

server/
  api/market/snapshot.get.ts              # GET 行情快照（入口，交易时段守卫）
  api/ai/decide.post.ts                   # POST AI 买卖决策
  api/ai/market-summary.post.ts           # POST AI 行情总结
  api/ai/asset-analysis.post.ts           # POST AI 单票分析
  api/ai/closed-position-review.post.ts   # POST AI 清仓复盘
  api/notify/trade.post.ts                # POST PushPlus AI 成交通知
  api/supabase/state.get.ts               # GET 恢复组合状态
  api/supabase/sync.post.ts               # POST 持久化组合状态
  utils/eastmoney.ts                      # 东方财富 API：指数、标的池、资金流、K 线、技术指标、新闻
  utils/ai.ts                             # AI provider fallback、超时、OpenAI 兼容请求
  utils/pushplus.ts                       # PushPlus 通知
  utils/supabase.ts                       # Supabase admin client

supabase/schema.sql        # sim_portfolios / positions / orders / trades / strategy_logs / closed_position_reviews

nuxt.config.ts             # 模块、runtimeConfig、Tailwind
.env.example               # 环境变量模板
```

**不要读：** `node_modules/`、`.nuxt/`、`.output/`、`.npm-cache/`、日志文件。

## 核心数据流

```text
index.vue 定时器
  → trading.runAutoTrade()
      → loadLiveMarket()  → GET /api/market/snapshot  → eastmoney.ts
      → useStrategy 计算 marketScore + signals（computed，无独立 API）
      → requestAiDecisions() → POST /api/ai/decide（失败/未配置则走规则）
      → executeAiDecision() 或 runRuleTrade()（buy/sell 在 store 内）
      → AI 成交后 notifyAiTrade() → POST /api/notify/trade（可选）
      → syncToDatabase()     → POST /api/supabase/sync

页面加载 → restoreFromDatabase() → GET /api/supabase/state?slug=default
手动刷新/看盘 → requestMarketSummary() → POST /api/ai/market-summary
单票详情 → requestAssetAnalysis() → POST /api/ai/asset-analysis
清仓后复盘 → reviewClosedPosition() → POST /api/ai/closed-position-review → 写入 logs / Supabase
```

- 组合 slug 固定为 `default`，初始资金 50,000 CNY。
- 自动交易窗口：工作日 09:25–15:00（Asia/Shanghai）；`autoExecute` 可关。
- 行情 API 默认只在 09:25–11:30、13:00–15:00 拉取；调试可传 `force=true` 或 `allowOutsideMarketHours=true`。
- A 股 T+1 锁定在 `normalizeT1Locks()`；部分 ETF（513 开头等）T+0，见 `isT0Etf()`。
- 买卖以 100 股为一手（`ceilToLotQuantity` / `floorToLotQuantity`）。
- AI 决策冷却 10 分钟（`AI_DECISION_COOLDOWN_MS`）。
- AI provider 顺序在 `server/utils/ai.ts`：Opus → OpenAI 兼容主接口 → DeepSeek；单个 provider 失败会继续尝试下一个。

## 按任务找文件

| 任务 | 先读 |
|------|------|
| 改买卖规则/仓位限制/费用/T+1 | `app/stores/trading.ts` |
| 改信号打分/买入卖出逻辑 | `app/composables/useStrategy.ts` |
| 改类型/接口字段 | `app/types/trading.ts`（前后端共用 `~/types/trading`） |
| 改 UI/图表/定时刷新/分析面板 | `app/pages/index.vue` |
| 改行情源/扫描池/资金流/K 线/技术指标/新闻 | `server/utils/eastmoney.ts` |
| 改 AI provider/兼容请求/超时/fallback | `server/utils/ai.ts` |
| 改 AI 买卖 prompt/解析 | `server/api/ai/decide.post.ts` |
| 改 AI 行情总结 | `server/api/ai/market-summary.post.ts` |
| 改 AI 单票分析 | `server/api/ai/asset-analysis.post.ts` |
| 改 AI 清仓复盘 | `server/api/ai/closed-position-review.post.ts` |
| 改交易通知 | `server/api/notify/trade.post.ts` + `server/utils/pushplus.ts` |
| 改数据库结构/同步字段 | `supabase/schema.sql` + `server/api/supabase/*.ts` |
| 改环境变量 | `nuxt.config.ts` runtimeConfig + `.env.example` |

## 类型速查（`app/types/trading.ts`）

- `StrategyHorizon`: `long` \| `swing` \| `short`
- `SignalAction`: `buy` \| `sell` \| `hold`；`OrderSide`: `buy` \| `sell`
- `MarketAsset` — 行情标的（含 kline、technical、各 score、资金流、相对强度/板块动量）
- `TechnicalSnapshot` — MA、MACD、RSI、量能、20/60/250 日突破等技术指标
- `Position` / `Trade` / `Order` — 持仓、成交与订单；`Trade` 可带 `decisionSnapshot`
- `StrategySignal` / `RuleAssetAnalysis` — 规则层输出
- `AiTradeDecision` / `AiMarketSummary` / `AiAssetAnalysis` / `AiClosedPositionReview` — AI 层输出
- `ClosedPositionSnapshot` — 清仓复盘输入快照

## 环境变量

| 变量 | 用途 |
|------|------|
| `NUXT_PUBLIC_SUPABASE_URL` | Supabase 项目 URL（前端可见） |
| `SUPABASE_SERVICE_ROLE_KEY` | 服务端写库（勿暴露到客户端） |
| `OPUS_BASE_URL` | Opus OpenAI 兼容 API 根地址，默认 `https://aixj.vip/v1` |
| `OPUS_API_KEY` | Opus 密钥；存在时作为第一 AI provider |
| `OPUS_MODEL` | Opus 模型名，默认 `opus4.8` |
| `AI_BASE_URL` | OpenAI 兼容主接口 API 根地址 |
| `AI_API_KEY` | OpenAI 兼容主接口密钥；与 `AI_BASE_URL` 同时存在才启用 |
| `AI_MODEL` | 主接口模型名，默认 `gpt-5.5` |
| `AI_TIMEOUT_MS` | AI 请求超时，默认 60000，范围 5000–180000 |
| `DEEPSEEK_BASE_URL` | DeepSeek API 根地址，默认 `https://api.deepseek.com/v1` |
| `DEEPSEEK_API_KEY` | DeepSeek 密钥；存在时作为后备 AI provider |
| `DEEPSEEK_MODEL` | DeepSeek 模型名，默认 `deepseek-chat` |
| `PUSHPLUS_TOKEN` | 可选 PushPlus 通知 token；未配置时通知接口返回 disabled |

## 约定

- Nuxt 4 目录：`app/` 为源码根，`server/` 为 Nitro API，路径别名 `~/` 指向 `app/`。
- 状态集中在 Pinia `useTradingStore`，页面不直接调 eastmoney。
- 服务端 Supabase 仅用 service role；无用户认证流程。
- UI 文案中文；部分 log 英文。时区统一 `Asia/Shanghai`，交易日用 `chinaTradeDate()`。
- 样式：Tailwind + `main.css`，图标 `lucide-vue-next`，图表 `vue-echarts`（client only）。
- 清仓复盘既写 `sim_closed_position_reviews`，也会在 strategy log 中保存一份 JSON 兜底；缺表时恢复/同步会兼容跳过。
- 小改动保持现有模式：不要引入新框架、不要拆过度抽象、不要加未请求的 test/lint。

## API 契约（简）

- `GET /api/market/snapshot?codes=600519,513050&force=true` — 返回 `{ source, updatedAt, indexes, assets, news, diagnostics?, error? }`
- `POST /api/ai/decide` — body 含 cash/positions/candidates/assets 等，返回 `{ enabled, decisions[], model?, reason? }`
- `POST /api/ai/market-summary` — 返回 `{ enabled, summary, reason? }`
- `POST /api/ai/asset-analysis` — body 含 asset/ruleAnalysis/position/account/indexes/news，返回 `{ enabled, analysis, reason? }`
- `POST /api/ai/closed-position-review` — body 含 `{ item }`，返回 `{ enabled, review, reason? }`
- `POST /api/notify/trade` — AI 成交通知，未配置 `PUSHPLUS_TOKEN` 返回 `{ ok: false, reason }`
- `GET /api/supabase/state?slug=default` — 返回 `{ found, portfolio, positions, orders, trades, logs, closedPositionReviews }`
- `POST /api/supabase/sync` — body 为完整组合快照，无鉴权（本地/私有部署假设）
