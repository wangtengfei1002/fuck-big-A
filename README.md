# fuck-big-A

A 股模拟交易仪表盘。项目使用 Nuxt 4 全栈实现，接入东方财富实时行情，内置规则策略，并可选接入 OpenAI 兼容接口做 AI 买卖决策。组合状态可持久化到 Supabase。

> 仅用于学习、研究和模拟交易，不构成任何投资建议。

## 功能

- 实时行情快照：指数、候选标的、新闻与资金流数据
- 自动交易：工作日 09:25-15:00 按策略自动运行
- 规则策略：趋势、动量、成交额、资金流等维度综合打分
- AI 决策：可选调用 OpenAI 兼容 API，失败或未配置时回退到规则策略
- 组合管理：现金、持仓、订单、成交、策略日志
- A 股交易约束：100 股一手、T+1 锁定，部分 ETF 支持 T+0
- 数据持久化：通过 Supabase 保存和恢复模拟组合
- 可视化界面：Nuxt + Pinia + Tailwind + ECharts

## 技术栈

- Nuxt 4 / Vue 3
- Pinia
- TypeScript
- Tailwind CSS
- ECharts / vue-echarts
- Supabase
- 东方财富行情接口
- OpenAI 兼容 AI 接口

## 快速开始

```bash
npm install
npm run dev
```

开发服务器默认运行在：

```text
http://localhost:3000
```

生产构建：

```bash
npm run build
npm run preview
```

## 环境变量

复制 `.env.example` 为 `.env`，然后按需填写：

```bash
cp .env.example .env
```

| 变量 | 说明 |
| --- | --- |
| `NUXT_PUBLIC_SUPABASE_URL` | Supabase 项目 URL |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase service role key，用于服务端写库 |
| `AI_BASE_URL` | OpenAI 兼容接口地址 |
| `AI_API_KEY` | AI 接口密钥，未配置时自动禁用 AI 决策 |
| `AI_MODEL` | AI 模型名，默认 `gpt-5.5` |
| `AI_TIMEOUT_MS` | AI 请求超时时间，默认 `60000` |
| `PUSHPLUS_TOKEN` | 可选通知 token |

## Supabase 初始化

如果需要持久化组合状态，请在 Supabase SQL Editor 中执行：

```text
supabase/schema.sql
```

主要表：

- `sim_portfolios`
- `positions`
- `orders`
- `trades`
- `strategy_logs`

项目假设本地或私有部署使用，当前同步 API 未做用户鉴权。

## 项目结构

```text
app/
  types/trading.ts
  stores/trading.ts
  composables/useStrategy.ts
  pages/index.vue
  components/MiniLineChart.client.vue
  assets/css/main.css

server/
  api/market/snapshot.get.ts
  api/ai/decide.post.ts
  api/ai/market-summary.post.ts
  api/supabase/state.get.ts
  api/supabase/sync.post.ts
  utils/eastmoney.ts
  utils/supabase.ts
  utils/ai.ts

supabase/
  schema.sql
```

## API

- `GET /api/market/snapshot?codes=600519,513050`
- `POST /api/ai/decide`
- `POST /api/ai/market-summary`
- `GET /api/supabase/state?slug=default`
- `POST /api/supabase/sync`

## 交易逻辑概览

页面定时触发 `runAutoTrade()`：

```text
loadLiveMarket()
  -> 规则策略生成信号
  -> 可选请求 AI 决策
  -> 执行买入/卖出
  -> 同步 Supabase
```

默认组合 slug 为 `default`，初始资金为 50,000 CNY。AI 决策存在冷却时间，未配置 AI 或请求失败时会使用规则策略兜底。

## 免责声明

本项目只做模拟交易与策略研究。行情、策略、AI 输出都可能存在延迟、错误或不完整情况，请勿直接用于真实交易决策。
