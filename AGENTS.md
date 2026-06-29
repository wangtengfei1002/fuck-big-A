# AGENTS.md — fuck-big-a (A-Share Auto Trader)

A股模拟交易仪表盘：Nuxt 4 全栈，东方财富实时行情 + 规则策略 + 可选 AI 决策，状态持久化到 Supabase。

**改功能前先读此文件，不要全库搜索。** 项目很小（~20 个源文件），按下方路径直达即可。

## 命令

```bash
npm install          # postinstall 会跑 nuxt prepare
npm run dev          # 开发服务器，默认 http://localhost:3000
npm run build        # 生产构建
npm run preview      # 预览构建产物
```

无 lint / test 脚本。TypeScript strict 已开。包管理用 npm（有 package-lock.json）。

## 目录地图

```
app/
  types/trading.ts          # 全部领域类型（单一真相源）
  stores/trading.ts         # Pinia 核心：行情、持仓、买卖、AI、Supabase 同步（最大文件）
  composables/useStrategy.ts # 规则策略：打分、信号生成、卖出判断
  pages/index.vue           # 唯一页面：仪表盘 UI + 定时器
  components/MiniLineChart.client.vue  # ECharts 迷你 K 线（仅客户端）
  assets/css/main.css       # Tailwind 入口样式
  app.vue                   # 仅 <NuxtPage />

server/
  api/market/snapshot.get.ts       # GET 行情快照（入口）
  api/ai/decide.post.ts            # POST AI 买卖决策
  api/ai/market-summary.post.ts    # POST AI 行情总结
  api/supabase/state.get.ts        # GET 恢复组合状态
  api/supabase/sync.post.ts        # POST 持久化组合状态
  utils/eastmoney.ts               # 东方财富 API：指数、标的池、新闻
  utils/supabase.ts                # Supabase admin client
  utils/ai.ts                      # AI 超时等工具

supabase/schema.sql         # sim_portfolios / positions / orders / trades / strategy_logs

nuxt.config.ts              # 模块、runtimeConfig、Tailwind
.env.example                # 环境变量模板
```

**不要读：** `node_modules/`、`.nuxt/`、`.output/`、`.npm-cache/`、日志文件。

## 核心数据流

```
index.vue 定时器
  → trading.runAutoTrade()
      → loadLiveMarket()  → GET /api/market/snapshot  → eastmoney.ts
      → useStrategy 计算 marketScore + signals（computed，无独立 API）
      → requestAiDecisions() → POST /api/ai/decide（失败/未配置则走规则）
      → executeAiDecision() 或 runRuleTrade()（buy/sell 在 store 内）
      → syncToDatabase()     → POST /api/supabase/sync

页面加载 → restoreFromDatabase() → GET /api/supabase/state?slug=default
```

- 组合 slug 固定为 `default`，初始资金 50,000 CNY。
- 自动交易窗口：工作日 09:25–15:00（Asia/Shanghai）；`autoExecute` 可关。
- A 股 T+1 锁定在 `normalizeT1Locks()`；部分 ETF（513 开头等）T+0，见 `isT0Etf()`。
- 买卖以 100 股为一手（`ceilToLotQuantity` / `floorToLotQuantity`）。
- AI 决策冷却 10 分钟（`AI_DECISION_COOLDOWN_MS`）。

## 按任务找文件

| 任务 | 先读 |
|------|------|
| 改买卖规则/仓位限制/费用 | `app/stores/trading.ts` |
| 改信号打分/买入卖出逻辑 | `app/composables/useStrategy.ts` |
| 改类型/接口字段 | `app/types/trading.ts`（前后端共用 `~/types/trading`） |
| 改 UI/图表/定时刷新 | `app/pages/index.vue` |
| 改行情源/扫描池/新闻 | `server/utils/eastmoney.ts` |
| 改 AI prompt/解析 | `server/api/ai/decide.post.ts`、`market-summary.post.ts` |
| 改数据库结构/同步字段 | `supabase/schema.sql` + `server/api/supabase/*.ts` |
| 改环境变量 | `nuxt.config.ts` runtimeConfig + `.env` |

## 类型速查（`app/types/trading.ts`）

- `StrategyHorizon`: `long` \| `swing` \| `short`
- `SignalAction` / `OrderSide`: `buy` \| `sell` \| `hold`
- `MarketAsset` — 行情标的（含 kline、各 score、资金流）
- `Position` / `Trade` / `Order` — 持仓与成交
- `StrategySignal` — 规则层输出；`AiTradeDecision` — AI 层输出
- `AiMarketSummary` — AI 行情总结

## 环境变量

| 变量 | 用途 |
|------|------|
| `NUXT_PUBLIC_SUPABASE_URL` | Supabase 项目 URL（前端可见） |
| `SUPABASE_SERVICE_ROLE_KEY` | 服务端写库（勿暴露到客户端） |
| `AI_BASE_URL` | OpenAI 兼容 API 根地址 |
| `AI_API_KEY` | AI 密钥；未配置时 AI 禁用，走规则兜底 |
| `AI_MODEL` | 模型名，默认 gpt-5.5 |
| `AI_TIMEOUT_MS` | 请求超时，默认 60000 |

## 约定

- Nuxt 4 目录：`app/` 为源码根，`server/` 为 Nitro API，路径别名 `~/` 指向 `app/`。
- 状态集中在 Pinia `useTradingStore`，页面不直接调 eastmoney。
- 服务端 Supabase 仅用 service role；无用户认证流程。
- UI 文案中文；部分 log 英文。时区统一 `Asia/Shanghai`，交易日用 `chinaTradeDate()`。
- 样式：Tailwind + `main.css`，图标 `lucide-vue-next`，图表 `vue-echarts`（client only）。
- 小改动保持现有模式：不要引入新框架、不要拆过度抽象、不要加未请求的 test/lint。

## API 契约（简）

- `GET /api/market/snapshot?codes=600519,513050` — 返回 `{ source, updatedAt, indexes, assets, news }`
- `POST /api/ai/decide` — body 含 cash/positions/candidates/assets 等，返回 `{ enabled, decisions[], model? }`
- `POST /api/ai/market-summary` — 返回 `{ enabled, summary }`
- `GET /api/supabase/state?slug=default` — 返回 `{ found, portfolio, positions, orders, trades, logs }`
- `POST /api/supabase/sync` — body 为完整组合快照，无鉴权（本地/私有部署假设）
