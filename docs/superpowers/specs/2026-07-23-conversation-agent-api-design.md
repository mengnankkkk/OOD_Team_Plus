# Money Whisperer 对话 Agent MVP API 设计

版本：`v1`

日期：`2026-07-23`
状态：可进入实现计划

配套文档：

- `2026-07-23-conversation-agent-module-design.md`：领域边界、Agent 状态机和业务流程。
- `2026-07-23-conversation-agent-database-design.md`：SQLite 表、ER 图、索引和事务。

## 1. 目标与边界

本文定义 Money Whisperer 对话 Agent MVP 的后端接口、Agent 运行机制、SSE 事件和错误契约。SQLite 结构以配套数据库设计文档为唯一事实来源。

技术边界固定为：

- TypeScript。
- Next.js App Router Route Handlers，统一使用 Node.js Runtime。
- Mastra supervisor-style agents。
- DeepSeek 模型。
- Zod 负责请求、工具参数和 Agent 输出校验。
- SQLite 单文件数据库。
- 本地单 Node.js 进程。
- SSE 输出 Agent 执行进度和最终回复。
- PandaAIQuant Data Service API 是研究数据的正式主来源。
- `.codex/skills/pandadata-api` 是必加载的接口路由与契约 Skill，运行时锁定 `panda_data==0.0.12`。
- TypeScript 通过 `PandadataAdapter` 调用 Python Skill runner；本地 Fixture 只作为明确标记的降级和回归数据。
- 不使用 Redis、消息队列、微服务和真实交易接口。

产品边界固定为：

- 仅提供研究、教育、风险提示和模拟建议。
- 不自动下单，不生成真实订单，不连接券商。
- 买入、卖出、止损和止盈均为条件化的模拟建议。
- 单一 PE、MACD、新闻或涨跌幅不能独立触发买卖建议。
- 信息不足、数据过期、证据冲突或合规不通过时，必须追问或降级为观察提示。
- “适合客户的股票”仅从用户持仓、自选和演示候选池中筛选，不做无边界全市场荐股。

## 2. 总体架构

```text
Next.js UI
  |
  | REST + SSE
  v
Next.js Route Handlers
  |
  +-- Zod request/response validation
  +-- session ownership / idempotency / error mapping
  |
  v
Conversation Agent Service
  |
  +-- Mastra Chief Advisor Supervisor
  |     +-- Profile Context Agent
  |     +-- Data & Research Agent
  |     +-- Portfolio & Risk Agent
  |     +-- Compliance Reviewer Agent
  |
  +-- deterministic TypeScript tools
  |     +-- holding parser and asset resolver
  |     +-- valuation / drawdown / P&L calculations
  |     +-- portfolio concentration and stress test
  |     +-- suitability and compliance rules
  |
  +-- external data integration
  |     +-- SkillRouter
  |     +-- pandadata-api Skill
  |     +-- PandadataAdapter -> panda_data==0.0.12
  |     +-- DataSnapshot / SkillRun recorder
  |
  +-- DeepSeek model adapter
  |
  v
SQLite
  +-- business entities
  +-- analysis runs and SSE events
  +-- evidence, recommendations and decision logs
```

所有相关 Route Handler 必须声明：

```ts
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
```

### 2.1 真实数据与 Skill 运行时

PandaData 调用不是公开的业务 Route Handler，而是 Agent Service 的内部白名单工具。调用链固定为：

```text
Data & Research Agent
  -> SkillRouter
  -> .codex/skills/pandadata-api/references/*
  -> PandadataAdapter
  -> .codex/skills/pandadata-api/scripts/call_api.py
  -> panda_data==0.0.12
  -> PandaAIQuant Data Service
```

P0 白名单至少包含：

| 能力 | 方法 |
| --- | --- |
| 交易日 | `get_trade_cal`, `get_prev_trade_date`, `get_last_trade_date` |
| 股票/复权行情 | `get_stock_daily`, `get_stock_rt_daily`, `get_stock_daily_pre`, `get_stock_daily_post`, `get_adj_factor` |
| 基金/ETF | `get_fund_detail`, `get_fund_daily`, `get_fund_daily_pre`, `get_fund_daily_post` |
| 指数 | `get_index_daily`, `get_index_weights`, `get_index_indicator` |
| 财务 | `get_fina_reports`, `get_fina_performance`, `get_fina_forecast`, `get_audit_opinion` |
| 事件 | `get_restricted_list`, `get_stock_pledge`, `get_stock_shareholder_change`, `get_stock_status_change` |
| 宏观/因子 | `get_macro_detail`, `get_macro_cal`, `get_factor` |
| 港美股 | `get_hk_daily`, `get_us_daily` |

每次调用前必须从本地 Skill reference 读取方法契约，并用 SDK 兼容性检查确认方法已导出；模型不能猜测方法、参数、字段或认证方式。每次调用完成后，服务写入 `tool_call`、`DataSnapshot` 和 `SkillRun` 摘要，Evidence Lab 只展示脱敏信息。

PandaData 凭证只从环境变量或 Skill runtime 配置读取；健康检查只能返回 `configured`、`reachable` 和版本状态，不返回用户名、密码、Token 或配置路径。

契约来源固定为：

- 本地 `.codex/skills/pandadata-api/references/api-docs.md`、`method-index.md` 和 `sdk-0.0.12.md`。
- [PandaAIQuant Data Service API](https://www.pandaaiquant.com/data-service/api-docs?api=data_overview)。
- 其他复制到 `.codex/skills` 的 Skill manifest 与 reference 文档。

本地运行使用单个 `next start` 进程。进程内维护：

- `Map<analysisRunId, AbortController>`：取消任务。
- `Map<analysisRunId, Promise<void>>`：避免同一任务重复执行。
- 轻量内存限流计数器。

业务状态和 SSE 事件写入 SQLite。进程重启后，状态为 `RUNNING` 的任务改为 `INTERRUPTED`，用户可以调用重试接口，不尝试在内存中自动恢复。

## 3. Agent 职责与决策边界

### 3.1 Chief Advisor Supervisor

负责：

- 识别建档、持仓录入、个股分析、组合诊断、买卖咨询等意图。
- 判断上下文是否完整。
- 动态选择专业 Agent 和工具，不采用固定线性工作流。
- 汇总候选方案，处理 Agent 结论冲突。
- 生成面向用户的最终回复。

禁止：

- 自行心算价格、收益、回撤、仓位或估值。
- 绕过风险和合规检查。
- 输出隐藏思维链。

### 3.2 Profile Context Agent

负责读取和检查：

- 主观风险偏好。
- 客观风险承受能力。
- 最大可接受回撤。
- 可投资资金和近期流动性需求。
- 投资期限、目标及标的偏好。
- 当前持仓、行业集中度和行为标签。

### 3.3 Data & Research Agent

负责调用结构化工具获取：

- 行情和历史价格。
- PE、PB、PS、估值历史分位和行业中位数。
- 营收、利润、ROE、毛利率、现金流和负债率。
- MA、MACD、RSI、成交量、波动率和回撤。
- 公司公告、财报、解禁、减持、政策和宏观事件。
- 支持证据和反方证据。
- 必须通过 `pandadata-api` Skill 将业务能力路由到已验证的 `panda_data.get_*` 方法。
- 交易日统一使用 `get_trade_cal`、`get_prev_trade_date` 或 `get_last_trade_date` 对齐，不能用自然日替代交易日。
- 每次真实取数生成数据快照，记录方法、脱敏参数、查询窗口、最新数据日、行数和质量状态。
- Skill 或 SDK 契约不匹配时停止该调用，不得用模型推测字段或用 Fixture 冒充实时结果。

### 3.4 Portfolio & Risk Agent

负责：

- 浮盈浮亏、仓位和回撤计算。
- 资产、单票和行业集中度分析。
- 用户目标与持仓期限匹配。
- 调仓前后模拟。
- 历史压力情景和最大回撤约束。
- 生成持有、停止加仓、分批减仓或退出候选方案。

### 3.5 Compliance Reviewer Agent

负责最终门禁：

- 禁止承诺收益和确定性涨跌预测。
- 检查建议是否具有数据日期、风险、反方证据、有效期和失效条件。
- 检查单票和行业仓位是否超过用户约束。
- 数据不足时将建议降级为 `OBSERVE`。
- 高风险或不适当建议标记为 `BLOCKED`。

### 3.6 Agent 运行原则

```text
Agent 决定下一步研究什么
确定性工具负责计算
风险规则决定是否适合用户
合规规则决定能否展示为建议
用户只可模拟采纳或拒绝
```

SSE 和数据库只保存 Agent 的任务状态、工具输入摘要、证据摘要和结论，不保存或返回模型隐藏思维链。

## 4. API 通用约定

### 4.1 基础路径与格式

- 基础路径：`/api/v1`
- Content-Type：`application/json`
- SSE Content-Type：`text/event-stream`
- JSON 字段：`camelCase`
- SQLite 字段：`snake_case`
- ID：应用层生成 UUID。
- 时间：UTC ISO 8601，例如 `2026-07-23T08:30:00.000Z`。
- 日期：`YYYY-MM-DD`。
- 金额、价格和数量：十进制字符串，例如 `"128000.00"`。
- 比例：数值，`0.15` 表示 `15%`。
- 证券代码和名称必须使用真实标的；本地 Fixture 数值仅用于演示，不代表真实市场状态。

### 4.2 身份与数据归属

MVP 使用一个预置演示用户和签名的 HttpOnly Cookie：`mw_demo_session`。

- Route Handler 从服务端会话读取 `userId`。
- 客户端不得提交或覆盖 `userId`。
- 所有查询必须包含当前用户归属条件。
- 修改请求必须验证同源请求和 `X-CSRF-Token`。
- 生产化身份认证不属于本 MVP。

### 4.3 成功响应

```json
{
  "data": {
    "id": "rec_01"
  },
  "meta": {
    "requestId": "req_01",
    "apiVersion": "v1",
    "generatedAt": "2026-07-23T08:30:00.000Z"
  }
}
```

分页响应：

```json
{
  "data": {
    "items": []
  },
  "meta": {
    "requestId": "req_01",
    "apiVersion": "v1",
    "generatedAt": "2026-07-23T08:30:00.000Z",
    "pagination": {
      "limit": 20,
      "nextCursor": null,
      "hasMore": false
    }
  }
}
```

`204 No Content` 是唯一无响应体的成功形式。

### 4.4 错误响应

```json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "请求参数不合法",
    "details": [
      {
        "path": "maxAcceptableDrawdown",
        "reason": "必须介于 0.01 和 0.8 之间"
      }
    ],
    "retryable": false
  },
  "meta": {
    "requestId": "req_01",
    "apiVersion": "v1",
    "generatedAt": "2026-07-23T08:30:00.000Z"
  }
}
```

主要错误码：

| HTTP | code | 含义 |
| --- | --- | --- |
| 400 | `BAD_REQUEST` | 无法解析请求 |
| 401 | `UNAUTHENTICATED` | 演示会话不存在或失效 |
| 403 | `FORBIDDEN` | 无资源访问权或 CSRF 校验失败 |
| 404 | `RESOURCE_NOT_FOUND` | 资源不存在 |
| 409 | `IDEMPOTENCY_CONFLICT` | 相同幂等键对应不同请求 |
| 409 | `RUN_ALREADY_ACTIVE` | 分析任务已在运行 |
| 409 | `DECISION_CONFLICT` | 决策与当前建议状态冲突 |
| 412 | `VERSION_CONFLICT` | `If-Match` 与资源版本不一致 |
| 422 | `VALIDATION_ERROR` | Zod 校验失败 |
| 422 | `PROFILE_INCOMPLETE` | 画像不足以生成建议 |
| 422 | `HOLDING_CONFIRMATION_REQUIRED` | 持仓解析存在歧义 |
| 422 | `STALE_MARKET_DATA` | 行情超过允许的新鲜度 |
| 422 | `INSUFFICIENT_EVIDENCE` | 证据不足，只能生成观察提示 |
| 422 | `COMPLIANCE_BLOCKED` | 建议被合规规则阻断 |
| 429 | `RATE_LIMITED` | 本地内存限流触发 |
| 500 | `INTERNAL_ERROR` | 未分类服务端错误 |
| 502 | `MODEL_UNAVAILABLE` | DeepSeek 调用失败 |
| 502 | `PANDADATA_AUTH_FAILED` | PandaData 凭证缺失、失效或无权限 |
| 502 | `PANDADATA_UNAVAILABLE` | PandaAIQuant Data Service 不可访问 |
| 502 | `SKILL_CONTRACT_MISMATCH` | 本地 API Skill、SDK 和接口文档契约不一致 |
| 502 | `DATA_PROVIDER_UNAVAILABLE` | 非 PandaData 数据工具调用失败 |
| 503 | `ANALYSIS_INTERRUPTED` | 进程重启导致任务中断 |

### 4.5 幂等

以下 `POST` 必须携带 `Idempotency-Key`：

- 创建对话消息。
- 创建分析任务。
- 回答主动追问。
- 确认持仓解析。
- 重试分析任务。
- 创建模拟方案。
- 记录用户决策。
- 手动评估观察条件。
- 重置 Demo 数据。

规则：

1. 幂等键最长 128 字符。
2. 服务端保存请求体 SHA-256、响应状态和响应体 24 小时。
3. 相同键和相同请求返回第一次响应。
4. 相同键和不同请求返回 `409 IDEMPOTENCY_CONFLICT`。

### 4.6 乐观锁

`PATCH` 请求必须携带：

```http
If-Match: "3"
```

资源更新成功后 `version` 加一。版本不匹配返回 `412 VERSION_CONFLICT`。

### 4.7 分页

列表接口使用游标分页：

```text
?limit=20&cursor=<base64url(createdAt,id)>
```

- 默认 `limit=20`。
- 最大 `limit=100`。
- 默认按 `createdAt DESC, id DESC`。
- 不使用页码和 OFFSET。

## 5. 核心枚举与对象

### 5.1 风险与期限

```ts
type RiskLevel = "CONSERVATIVE" | "BALANCED" | "AGGRESSIVE";
type RiskCapacity = "LOW" | "MEDIUM" | "HIGH";
type Horizon = "SHORT" | "MEDIUM" | "LONG";
type InstrumentPreference =
  | "STOCK"
  | "SECTOR_ETF"
  | "BROAD_INDEX_ETF"
  | "INDEX_FUND"
  | "GOLD"
  | "CASH";
```

期限口径：

- `SHORT`：一个月以内。
- `MEDIUM`：一个月至一年。
- `LONG`：一年以上。

“个股、板块、指数”在数据模型中是 `instrumentPreferences`，不是目标优先级。目标优先级由整数 `priority` 表示。

### 5.2 持仓

```ts
type AssetType =
  | "STOCK"
  | "ETF"
  | "INDEX_FUND"
  | "MUTUAL_FUND"
  | "GOLD"
  | "GOLD_ETF"
  | "FUTURE"
  | "CASH";
```

指数本身不可直接录入为可交易持仓。用户说“指数 100 点时买了 100 股”时，解析结果必须要求确认其实际购买的是 ETF、指数基金、期货或其他产品。

持仓 API 的展示类型由 SQLite `instrument_type` 与 `instrument_subtype` 共同映射：

| API `AssetType` | SQLite |
| --- | --- |
| `STOCK` | `instrument_type=stock` |
| `ETF` | `instrument_type=etf`，子类型不是黄金 ETF |
| `INDEX_FUND` | `instrument_type=fund`, `instrument_subtype=index_fund` |
| `MUTUAL_FUND` | `instrument_type=fund`, `instrument_subtype=mutual_fund` |
| `GOLD` | `instrument_type=gold` |
| `GOLD_ETF` | `instrument_type=etf`, `instrument_subtype=gold_etf` |
| `FUTURE` | `instrument_type=future` |
| `CASH` | `instrument_type=cash` |

`direction` 不单独入库，由建议动作推导：`TRIAL_BUY/SCALE_IN -> BUY`，`SCALE_OUT/EXIT -> SELL`，`HOLD/STOP_ADDING -> HOLD`，`WATCH -> OBSERVE`。

### 5.3 分析任务

```ts
type AnalysisType =
  | "ADVISORY_QA"
  | "STOCK_DIAGNOSTIC"
  | "PORTFOLIO_DIAGNOSTIC"
  | "HOLDING_REVIEW"
  | "STOCK_SUITABILITY_SCREEN";

type AnalysisStatus =
  | "QUEUED"
  | "RUNNING"
  | "WAITING_FOR_USER"
  | "COMPLETED"
  | "BLOCKED"
  | "FAILED"
  | "CANCELLED"
  | "INTERRUPTED";

type AnalysisStage =
  | "RECEIVED"
  | "CHECKING_CONTEXT"
  | "PLANNING"
  | "GATHERING_DATA"
  | "ANALYZING"
  | "CHALLENGING"
  | "STRESS_TESTING"
  | "COMPLIANCE_REVIEW"
  | "FINALIZED";
```

`QUEUED` 只表示请求已被本地进程接受，不代表存在外部队列。

`status` 是可恢复、可持久化的粗粒度生命周期；`stage` 是面向 UI 的细粒度当前步骤，不参与终态判断。用户补充信息期间使用 `status=WAITING_FOR_USER`，`stage` 保留进入等待前的步骤；恢复执行后再更新为新的步骤。

API 分析状态与根 `agent_runs.run_status` 的映射：

| API `AnalysisStatus` | SQLite `run_status` |
| --- | --- |
| `QUEUED` | `queued` |
| `RUNNING` | `running` |
| `WAITING_FOR_USER` | `waiting_user` |
| `COMPLETED` | `succeeded` |
| `BLOCKED` | `blocked` |
| `FAILED` | `failed` |
| `CANCELLED` | `cancelled` |
| `INTERRUPTED` | `interrupted` |

`stage` 写入根 run 最新一条 `agent_run_events` 的 `stage.changed` payload；查询时优先读取最后事件，缺失时按根 run 状态回退推导。子 Agent run 只使用数据库 `run_status`，不单独暴露为 `AnalysisStatus`。

### 5.4 建议

```ts
type RecommendationDirection = "BUY" | "SELL" | "HOLD" | "OBSERVE";

type RecommendationAction =
  | "WATCH"
  | "TRIAL_BUY"
  | "SCALE_IN"
  | "HOLD"
  | "STOP_ADDING"
  | "SCALE_OUT"
  | "EXIT";

type RecommendationStatus =
  | "DRAFT"
  | "PENDING_REVIEW"
  | "ACTIVE"
  | "DEGRADED"
  | "BLOCKED"
  | "EXPIRED"
  | "SUPERSEDED";

type Suitability = "LOW" | "MEDIUM" | "HIGH";
type EvidenceConfidence = "LOW" | "MEDIUM" | "HIGH";
```

API 动作与 SQLite `recommendation_action` 的映射：

| API `RecommendationAction` | SQLite |
| --- | --- |
| `WATCH` | `observe` |
| `TRIAL_BUY` | `trial_buy` |
| `SCALE_IN` | `scale_in` |
| `HOLD` | `hold` |
| `STOP_ADDING` | `stop_adding` |
| `SCALE_OUT` | `scale_out` |
| `EXIT` | `exit` |

数据库额外允许内部动作 `risk_notice`，它不是一个可交易动作。`DEGRADED` 建议保留 Agent 原始动作方向，例如 `SCALE_OUT`，但必须明确标记为仅允许模拟、不可实际下单；只有 `BLOCKED` 或纯风险提示才对外序列化为 `action=WATCH`。查询参数 `action=WATCH` 同时匹配数据库的 `observe` 和 `risk_notice`。

API 推荐状态与 SQLite `recommendation_status` 的映射：

| API `RecommendationStatus` | SQLite |
| --- | --- |
| `DRAFT` | `draft` |
| `PENDING_REVIEW` | `pending_review` |
| `ACTIVE` | `published` |
| `DEGRADED` | `degraded` |
| `BLOCKED` | `blocked` |
| `EXPIRED` | `expired` |
| `SUPERSEDED` | `superseded` |

`EvidenceConfidence` 表示证据完整性与一致性，不表示上涨概率。

### 5.5 个股诊断结构

个股诊断必须包含：

```json
{
  "asset": {
    "symbol": "000001.SZ",
    "name": "平安银行",
    "assetType": "STOCK"
  },
  "market": {
    "lastPrice": "10.42",
    "dataAsOf": "2026-07-22T07:00:00.000Z"
  },
  "position": {
    "quantity": "1000",
    "averageCost": "11.20",
    "marketValue": "10420.00",
    "unrealizedPnl": "-780.00",
    "unrealizedPnlRatio": -0.0696,
    "currentDrawdown": -0.110
  },
  "valuation": {
    "peTtm": "5.80",
    "peMeaningful": true,
    "peThreeYearPercentile": 0.22,
    "industryPeMedian": "6.40",
    "pb": "0.73",
    "ps": "1.10",
    "dividendYield": 0.04
  },
  "fundamentals": {
    "revenueYoY": 0.10,
    "netProfitYoY": 0.03,
    "roe": 0.098,
    "grossMarginTrend": "STABLE",
    "operatingCashFlowToNetProfit": 1.1,
    "debtRatio": 0.41
  },
  "technical": {
    "ma20Relation": "BELOW",
    "ma60Relation": "BELOW",
    "macdState": "BEARISH",
    "macdCrossDate": null,
    "macdZeroAxis": "BELOW",
    "weeklyAlignment": "NEUTRAL",
    "volumeConfirmation": "NORMAL",
    "rsi14": 48.2,
    "volatility20d": 0.22
  },
  "events": [
    {
      "title": "银行板块净息差与资产质量仍需跟踪",
      "sourceTier": "LOCAL_FIXTURE",
      "publishedAt": "2026-07-18T09:00:00.000Z",
      "eventDate": null,
      "direction": "NEUTRAL",
      "materiality": "MEDIUM",
      "impactHorizon": "SHORT_TO_MEDIUM"
    }
  ],
  "portfolioFit": {
    "role": "VALUE_SATELLITE",
    "currentWeight": 0.09,
    "suggestedInitialWeight": 0.02,
    "maximumWeight": 0.08,
    "sectorWeightAfter": 0.11
  }
}
```

MACD 金叉必须同时展示发生日期、零轴位置、周线方向和成交量确认。技术指标只能作为趋势证据，不能单独决定买卖动作。

### 5.6 组合诊断结构

```json
{
  "totalMarketValue": "328000.00",
  "totalUnrealizedPnl": "18600.00",
  "currentDrawdown": -0.086,
  "allocation": [
    { "category": "STOCK", "weight": 0.42 },
    { "category": "ETF", "weight": 0.28 },
    { "category": "GOLD_ETF", "weight": 0.20 },
    { "category": "CASH", "weight": 0.10 }
  ],
  "concentration": {
    "largestPositionWeight": 0.24,
    "topThreeWeight": 0.58,
    "largestSectorWeight": 0.42
  },
  "riskFit": {
    "effectiveRiskLevel": "BALANCED",
    "maximumAllowedEquityWeight": 0.65,
    "maximumAllowedSectorWeight": 0.25,
    "status": "MISMATCHED"
  },
  "stressTests": [
    {
      "scenario": "EQUITY_MARKET_MINUS_20",
      "estimatedPortfolioChange": -0.116
    }
  ],
  "topIssues": [
    {
      "code": "SECTOR_CONCENTRATION",
      "severity": "HIGH",
      "summary": "科技板块占比 42%，超过用户上限 25%"
    }
  ]
}
```

## 6. Endpoint 总览

| 模块 | 方法与路径 |
| --- | --- |
| 画像 | `GET /profile` |
| 画像 | `PATCH /profile` |
| 画像 | `GET /risk-questionnaire` |
| 画像 | `POST /risk-assessments` |
| 画像 | `POST /profile/complete` |
| 目标 | `GET /goals` |
| 目标 | `POST /goals` |
| 目标 | `PATCH /goals/:goalId` |
| 目标 | `DELETE /goals/:goalId` |
| 标的 | `GET /instruments/search` |
| 标的 | `GET /instruments/:instrumentId` |
| 持仓 | `GET /holdings` |
| 持仓 | `POST /holdings` |
| 持仓 | `POST /holdings/parse` |
| 持仓 | `POST /holdings/parse/:parseId/confirm` |
| 持仓 | `PATCH /holdings/:holdingId` |
| 持仓 | `DELETE /holdings/:holdingId` |
| 自选 | `GET /watchlist` |
| 自选 | `POST /watchlist` |
| 自选 | `PATCH /watchlist/:itemId` |
| 自选 | `DELETE /watchlist/:itemId` |
| 对话 | `GET /conversations` |
| 对话 | `POST /conversations` |
| 对话 | `GET /conversations/:conversationId` |
| 对话 | `PATCH /conversations/:conversationId` |
| 消息 | `GET /conversations/:conversationId/messages` |
| 消息 | `POST /conversations/:conversationId/messages` |
| 追问 | `GET /conversations/:conversationId/clarifications` |
| 追问 | `POST /conversations/:conversationId/clarifications/:clarificationId/answer` |
| 分析 | `POST /analyses` |
| 分析 | `GET /analyses/:analysisId` |
| 分析 | `POST /analyses/:analysisId/cancel` |
| 分析 | `POST /analyses/:analysisId/retry` |
| 流式事件 | `GET /analyses/:analysisId/events` |
| 建议 | `GET /recommendations` |
| 建议 | `GET /recommendations/:recommendationId` |
| 建议 | `POST /recommendations/:recommendationId/simulations` |
| 建议 | `GET /simulations/:simulationId` |
| 决策 | `POST /recommendations/:recommendationId/decisions` |
| Evidence Lab | `GET /analyses/:analysisId/evidence-pack` |
| 决策日志 | `GET /decisions` |
| 决策日志 | `GET /decisions/:decisionId` |
| 观察条件 | `GET /observation-conditions` |
| 观察条件 | `POST /observation-conditions` |
| 观察条件 | `PATCH /observation-conditions/:conditionId` |
| 观察条件 | `DELETE /observation-conditions/:conditionId` |
| 观察条件 | `POST /observation-conditions/evaluate` |
| 系统 | `GET /health` |
| 演示 | `GET /demo/bootstrap` |
| 演示 | `POST /demo/reset` |

## 7. 画像建档接口

### 7.1 获取画像

`GET /api/v1/profile`

请求：无请求体。

响应 `200`：

```json
{
  "data": {
    "id": "profile_demo",
    "status": "DRAFT",
    "monthlyIncome": "18000.00",
    "monthlyExpenses": "9000.00",
    "investableCapital": "100000.00",
    "monthlyContribution": "3000.00",
    "emergencyFundMonths": 4,
    "nearTermLiquidityNeed": "30000.00",
    "subjectiveRiskPreference": "AGGRESSIVE",
    "objectiveRiskCapacity": "MEDIUM",
    "effectiveRiskLevel": "BALANCED",
    "maxAcceptableDrawdown": 0.15,
    "instrumentPreferences": ["SECTOR_ETF", "BROAD_INDEX_ETF"],
    "tags": ["稳定收入", "关注科技", "短期有流动性需求"],
    "version": 2
  },
  "meta": {
    "requestId": "req_profile_01",
    "apiVersion": "v1",
    "generatedAt": "2026-07-23T08:30:00.000Z"
  }
}
```

主要错误：`401 UNAUTHENTICATED`。

### 7.2 更新画像草稿

`PATCH /api/v1/profile`

请求头：`If-Match: "2"`。

请求：

```json
{
  "investableCapital": "120000.00",
  "monthlyContribution": "4000.00",
  "nearTermLiquidityNeed": "20000.00",
  "maxAcceptableDrawdown": 0.18,
  "instrumentPreferences": ["STOCK", "SECTOR_ETF"]
}
```

响应 `200`：

```json
{
  "data": {
    "id": "profile_demo",
    "status": "DRAFT",
    "investableCapital": "120000.00",
    "monthlyContribution": "4000.00",
    "maxAcceptableDrawdown": 0.18,
    "instrumentPreferences": ["STOCK", "SECTOR_ETF"],
    "version": 3
  },
  "meta": {
    "requestId": "req_profile_02",
    "apiVersion": "v1",
    "generatedAt": "2026-07-23T08:31:00.000Z"
  }
}
```

主要错误：`401 UNAUTHENTICATED`、`412 VERSION_CONFLICT`、`422 VALIDATION_ERROR`。

### 7.3 获取风险情景题

`GET /api/v1/risk-questionnaire`

请求：无请求体。

响应 `200`：

```json
{
  "data": {
    "version": "risk-v1",
    "questions": [
      {
        "id": "monthly_drop_10",
        "type": "SINGLE_CHOICE",
        "prompt": "投资账户一个月下跌 10%，你最可能怎么做？",
        "options": [
          { "value": "SELL_ALL", "label": "立即卖出" },
          { "value": "RESEARCH_FIRST", "label": "先了解原因" },
          { "value": "ADD_IF_VALID", "label": "逻辑未变则分批加仓" }
        ]
      },
      {
        "id": "fund_usage_time",
        "type": "SINGLE_CHOICE",
        "prompt": "这笔资金最早什么时候可能需要使用？",
        "options": [
          { "value": "WITHIN_3_MONTHS", "label": "三个月内" },
          { "value": "WITHIN_1_YEAR", "label": "一年内" },
          { "value": "AFTER_1_YEAR", "label": "一年以后" }
        ]
      }
    ]
  },
  "meta": {
    "requestId": "req_risk_q_01",
    "apiVersion": "v1",
    "generatedAt": "2026-07-23T08:32:00.000Z"
  }
}
```

主要错误：`401 UNAUTHENTICATED`。

### 7.4 提交风险测评

`POST /api/v1/risk-assessments`

请求：

```json
{
  "questionnaireVersion": "risk-v1",
  "answers": [
    { "questionId": "monthly_drop_10", "value": "ADD_IF_VALID" },
    { "questionId": "fund_usage_time", "value": "WITHIN_1_YEAR" }
  ],
  "objectiveInputs": {
    "incomeStability": "STABLE",
    "investmentAssetShareOfHouseholdAssets": 0.55,
    "hasEmergencyFund": true
  }
}
```

响应 `201`：

```json
{
  "data": {
    "id": "risk_01",
    "status": "COMPLETED",
    "subjectiveRiskPreference": "AGGRESSIVE",
    "objectiveRiskCapacity": "MEDIUM",
    "effectiveRiskLevel": "BALANCED",
    "recommendedMaxEquityWeight": 0.65,
    "recommendedMaxSingleAssetWeight": 0.1,
    "recommendedMaxSectorWeight": 0.25,
    "recommendedMaxDrawdown": 0.15,
    "conflicts": [
      {
        "code": "SHORT_LIQUIDITY_VS_AGGRESSIVE_PREFERENCE",
        "message": "主观偏好进取，但一年内可能用钱，因此按较低风险边界执行"
      }
    ]
  },
  "meta": {
    "requestId": "req_risk_01",
    "apiVersion": "v1",
    "generatedAt": "2026-07-23T08:33:00.000Z"
  }
}
```

主要错误：`422 VALIDATION_ERROR`、`422 RISK_ASSESSMENT_INCOMPLETE`。

### 7.5 完成画像

`POST /api/v1/profile/complete`

请求：

```json
{
  "riskAssessmentId": "risk_01",
  "acknowledgements": {
    "informationIsAccurate": true,
    "understandsSimulationOnly": true
  }
}
```

响应 `200`：

```json
{
  "data": {
    "profileId": "profile_demo",
    "status": "COMPLETE",
    "effectiveRiskLevel": "BALANCED",
    "completedAt": "2026-07-23T08:34:00.000Z",
    "version": 4
  },
  "meta": {
    "requestId": "req_profile_complete_01",
    "apiVersion": "v1",
    "generatedAt": "2026-07-23T08:34:00.000Z"
  }
}
```

主要错误：`404 RESOURCE_NOT_FOUND`、`422 PROFILE_INCOMPLETE`、`422 VALIDATION_ERROR`。

## 8. 投资目标接口

### 8.1 获取目标列表

`GET /api/v1/goals?status=ACTIVE&limit=20&cursor=...`

响应 `200`：

```json
{
  "data": {
    "items": [
      {
        "id": "goal_01",
        "name": "三年买房首付",
        "targetAmount": "500000.00",
        "initialInvestmentAmount": "100000.00",
        "monthlyContributionAmount": "5000.00",
        "horizon": "LONG",
        "targetDate": "2029-07-23",
        "priority": 1,
        "instrumentPreferences": ["BROAD_INDEX_ETF", "GOLD"],
        "status": "ACTIVE",
        "version": 1
      }
    ]
  },
  "meta": {
    "requestId": "req_goals_01",
    "apiVersion": "v1",
    "generatedAt": "2026-07-23T08:35:00.000Z",
    "pagination": {
      "limit": 20,
      "nextCursor": null,
      "hasMore": false
    }
  }
}
```

主要错误：`422 VALIDATION_ERROR`。

### 8.2 创建目标

`POST /api/v1/goals`

请求：

```json
{
  "name": "三年买房首付",
  "targetAmount": "500000.00",
  "initialInvestmentAmount": "100000.00",
  "monthlyContributionAmount": "5000.00",
  "horizon": "LONG",
  "targetDate": "2029-07-23",
  "priority": 1,
  "instrumentPreferences": ["BROAD_INDEX_ETF", "GOLD"],
  "notes": "本金安全优先于收益"
}
```

响应 `201`：

```json
{
  "data": {
    "id": "goal_01",
    "status": "ACTIVE",
    "version": 1
  },
  "meta": {
    "requestId": "req_goal_create_01",
    "apiVersion": "v1",
    "generatedAt": "2026-07-23T08:36:00.000Z"
  }
}
```

主要错误：`422 VALIDATION_ERROR`、`422 PROFILE_INCOMPLETE`。

### 8.3 更新目标

`PATCH /api/v1/goals/:goalId`

请求头：`If-Match: "1"`。

请求：

```json
{
  "targetAmount": "550000.00",
  "monthlyContributionAmount": "6000.00",
  "priority": 1
}
```

响应 `200`：

```json
{
  "data": {
    "id": "goal_01",
    "targetAmount": "550000.00",
    "monthlyContributionAmount": "6000.00",
    "version": 2
  },
  "meta": {
    "requestId": "req_goal_patch_01",
    "apiVersion": "v1",
    "generatedAt": "2026-07-23T08:37:00.000Z"
  }
}
```

主要错误：`404 RESOURCE_NOT_FOUND`、`412 VERSION_CONFLICT`、`422 VALIDATION_ERROR`。

### 8.4 删除目标

`DELETE /api/v1/goals/:goalId`

请求：无请求体。

响应：`204 No Content`。

主要错误：`404 RESOURCE_NOT_FOUND`、`409 GOAL_HAS_ACTIVE_HOLDINGS`。

## 9. 标的与持仓接口

### 9.1 搜索标的

```http
GET /api/v1/instruments/search?q=沪深300&market=CN&assetType=ETF&limit=10
```

响应：

```json
{
  "data": {
    "items": [
      {
        "id": "ins_510300",
        "symbol": "510300.SH",
        "name": "沪深300ETF",
        "market": "CN",
        "assetType": "ETF",
        "tradable": true,
        "matchedAlias": "沪深300"
      },
      {
        "id": "ins_000300",
        "symbol": "000300.SH",
        "name": "沪深300指数",
        "market": "CN",
        "assetType": "INDEX",
        "tradable": false,
        "matchedAlias": "沪深300"
      }
    ]
  },
  "meta": {
    "requestId": "req_01",
    "apiVersion": "v1",
    "generatedAt": "2026-07-23T08:30:00.000Z"
  }
}
```

规则：

- 仅搜索本地演示标的池。
- `tradable=false` 的指数只能用于分析或作为基准，不能直接创建持仓。
- 搜索结果必须显示代码、市场和资产类型，不能只显示名称。

### 9.2 获取标的详情

```http
GET /api/v1/instruments/:instrumentId
```

响应包括：

- 标的代码、名称、别名。
- 市场和资产类型。
- 是否可交易。
- 所属行业、板块和跟踪指数。
- 最新数据时间。
- 支持的分析维度。

主要错误：`404 RESOURCE_NOT_FOUND`。

### 9.3 获取持仓

`GET /api/v1/holdings?includeValuation=true&limit=20&cursor=...`

响应 `200`：

```json
{
  "data": {
    "items": [
      {
        "id": "holding_01",
        "assetType": "ETF",
        "symbol": "510300.SH",
        "name": "沪深300ETF",
        "market": "CN",
        "quantity": "1000",
        "averageCost": "4.20",
        "currency": "CNY",
        "goalId": "goal_01",
        "valuation": {
          "lastPrice": "4.35",
          "marketValue": "4350.00",
          "unrealizedPnl": "150.00",
          "unrealizedPnlRatio": 0.0357,
          "dataAsOf": "2026-07-22T07:00:00.000Z"
        },
        "version": 1
      }
    ]
  },
  "meta": {
    "requestId": "req_holdings_01",
    "apiVersion": "v1",
    "generatedAt": "2026-07-23T08:38:00.000Z",
    "pagination": {
      "limit": 20,
      "nextCursor": null,
      "hasMore": false
    }
  }
}
```

主要错误：`422 STALE_MARKET_DATA`、`502 DATA_PROVIDER_UNAVAILABLE`。当 `includeValuation=false` 时不因行情失败阻断持仓列表。

### 9.4 手工创建持仓

`POST /api/v1/holdings`

请求：

```json
{
  "assetType": "ETF",
  "symbol": "510300.SH",
  "name": "沪深300ETF",
  "market": "CN",
  "quantity": "1000",
  "averageCost": "4.20",
  "currency": "CNY",
  "acquiredAt": "2026-04-20",
  "goalId": "goal_01",
  "thesis": "长期宽基配置"
}
```

响应 `201`：

```json
{
  "data": {
    "id": "holding_01",
    "source": "MANUAL",
    "version": 1
  },
  "meta": {
    "requestId": "req_holding_create_01",
    "apiVersion": "v1",
    "generatedAt": "2026-07-23T08:39:00.000Z"
  }
}
```

主要错误：`404 RESOURCE_NOT_FOUND`、`409 HOLDING_ALREADY_EXISTS`、`422 ASSET_NOT_TRADABLE`、`422 VALIDATION_ERROR`。

### 9.5 解析自然语言持仓

`POST /api/v1/holdings/parse`

请求：

```json
{
  "text": "我在沪深300指数100点时买了100股",
  "defaultMarket": "CN"
}
```

响应 `200`：

```json
{
  "data": {
    "parseId": "parse_01",
    "status": "NEEDS_CONFIRMATION",
    "candidates": [
      {
        "candidateId": "candidate_01",
        "assetType": null,
        "symbol": null,
        "name": "沪深300指数",
        "quantity": "100",
        "averageCost": "100.00",
        "confidence": 0.62,
        "issues": [
          {
            "code": "DIRECT_INDEX_NOT_TRADABLE",
            "message": "指数本身通常不能按股买入，请确认实际产品"
          }
        ],
        "suggestedMatches": [
          {
            "assetType": "ETF",
            "symbol": "510300.SH",
            "name": "沪深300ETF"
          },
          {
            "assetType": "INDEX",
            "symbol": "000300.SH",
            "name": "沪深300指数"
          }
        ]
      }
    ]
  },
  "meta": {
    "requestId": "req_parse_01",
    "apiVersion": "v1",
    "generatedAt": "2026-07-23T08:40:00.000Z"
  }
}
```

主要错误：`400 BAD_REQUEST`、`422 VALIDATION_ERROR`、`502 MODEL_UNAVAILABLE`。

### 9.6 确认解析结果

`POST /api/v1/holdings/parse/:parseId/confirm`

请求头：`Idempotency-Key: holding-confirm-01`。

请求：

```json
{
  "confirmedCandidates": [
    {
      "candidateId": "candidate_01",
      "assetType": "ETF",
      "symbol": "510300.SH",
      "name": "沪深300ETF",
      "market": "CN",
      "quantity": "100",
      "averageCost": "4.20",
      "currency": "CNY",
      "goalId": "goal_01"
    }
  ]
}
```

响应 `201`：

```json
{
  "data": {
    "parseId": "parse_01",
    "status": "CONFIRMED",
    "holdings": [
      {
        "id": "holding_02",
        "symbol": "510300.SH",
        "quantity": "100",
        "averageCost": "4.20",
        "version": 1
      }
    ]
  },
  "meta": {
    "requestId": "req_confirm_01",
    "apiVersion": "v1",
    "generatedAt": "2026-07-23T08:41:00.000Z"
  }
}
```

主要错误：`404 RESOURCE_NOT_FOUND`、`409 IDEMPOTENCY_CONFLICT`、`409 PARSE_ALREADY_CONFIRMED`、`422 HOLDING_CONFIRMATION_REQUIRED`。

### 9.7 更新持仓

`PATCH /api/v1/holdings/:holdingId`

请求头：`If-Match: "1"`。

请求：

```json
{
  "quantity": "1200",
  "averageCost": "4.18",
  "thesis": "长期配置并定期再平衡"
}
```

响应 `200`：

```json
{
  "data": {
    "id": "holding_01",
    "quantity": "1200",
    "averageCost": "4.18",
    "version": 2
  },
  "meta": {
    "requestId": "req_holding_patch_01",
    "apiVersion": "v1",
    "generatedAt": "2026-07-23T08:42:00.000Z"
  }
}
```

主要错误：`404 RESOURCE_NOT_FOUND`、`412 VERSION_CONFLICT`、`422 VALIDATION_ERROR`。

### 9.8 删除持仓

`DELETE /api/v1/holdings/:holdingId`

响应：`204 No Content`。

主要错误：`404 RESOURCE_NOT_FOUND`。

## 10. 对话与消息接口

### 10.1 获取会话列表

`GET /api/v1/conversations?status=ACTIVE&limit=20&cursor=...`

响应 `200`：

```json
{
  "data": {
    "items": [
      {
        "id": "conv_01",
        "title": "科技板块是否适合入场",
        "status": "ACTIVE",
        "lastMessagePreview": "我准备投入两万元，最多承受 12% 回撤",
        "lastMessageAt": "2026-07-23T08:45:00.000Z",
        "version": 1
      }
    ]
  },
  "meta": {
    "requestId": "req_conv_list_01",
    "apiVersion": "v1",
    "generatedAt": "2026-07-23T08:46:00.000Z",
    "pagination": {
      "limit": 20,
      "nextCursor": null,
      "hasMore": false
    }
  }
}
```

主要错误：`422 VALIDATION_ERROR`。

### 10.2 创建会话

`POST /api/v1/conversations`

请求：

```json
{
  "title": "黄金持仓咨询",
  "mode": "ADVISORY"
}
```

响应 `201`：

```json
{
  "data": {
    "id": "conv_02",
    "title": "黄金持仓咨询",
    "status": "ACTIVE",
    "version": 1
  },
  "meta": {
    "requestId": "req_conv_create_01",
    "apiVersion": "v1",
    "generatedAt": "2026-07-23T08:47:00.000Z"
  }
}
```

主要错误：`422 VALIDATION_ERROR`。

### 10.3 获取会话详情

`GET /api/v1/conversations/:conversationId`

响应 `200`：

```json
{
  "data": {
    "id": "conv_02",
    "title": "黄金持仓咨询",
    "status": "ACTIVE",
    "pendingClarificationCount": 1,
    "activeAnalysisId": "analysis_02",
    "version": 1
  },
  "meta": {
    "requestId": "req_conv_get_01",
    "apiVersion": "v1",
    "generatedAt": "2026-07-23T08:48:00.000Z"
  }
}
```

主要错误：`404 RESOURCE_NOT_FOUND`。

### 10.4 更新或归档会话

`PATCH /api/v1/conversations/:conversationId`

请求头：`If-Match: "1"`。

请求：

```json
{
  "title": "黄金半仓是否减仓",
  "status": "ARCHIVED"
}
```

响应 `200`：

```json
{
  "data": {
    "id": "conv_02",
    "title": "黄金半仓是否减仓",
    "status": "ARCHIVED",
    "version": 2
  },
  "meta": {
    "requestId": "req_conv_patch_01",
    "apiVersion": "v1",
    "generatedAt": "2026-07-23T08:49:00.000Z"
  }
}
```

主要错误：`404 RESOURCE_NOT_FOUND`、`409 RUN_ALREADY_ACTIVE`、`412 VERSION_CONFLICT`。

### 10.5 获取消息

`GET /api/v1/conversations/:conversationId/messages?limit=30&cursor=...`

响应 `200`：

```json
{
  "data": {
    "items": [
      {
        "id": "msg_01",
        "role": "USER",
        "kind": "TEXT",
        "content": "科技板块跌得很严重，现在适合入场吗？",
        "createdAt": "2026-07-23T08:50:00.000Z"
      },
      {
        "id": "msg_02",
        "role": "ASSISTANT",
        "kind": "CLARIFICATION",
        "content": "在形成建议前，我需要确认投入金额、持有期限和最大可接受回撤。",
        "clarificationId": "clarification_01",
        "createdAt": "2026-07-23T08:50:02.000Z"
      }
    ]
  },
  "meta": {
    "requestId": "req_messages_01",
    "apiVersion": "v1",
    "generatedAt": "2026-07-23T08:51:00.000Z",
    "pagination": {
      "limit": 30,
      "nextCursor": null,
      "hasMore": false
    }
  }
}
```

主要错误：`404 RESOURCE_NOT_FOUND`。

### 10.6 发送消息并启动 Agent

`POST /api/v1/conversations/:conversationId/messages`

请求头：`Idempotency-Key: msg-tech-entry-01`。

请求：

```json
{
  "clientMessageId": "client_msg_01",
  "content": "科技板块跌得很严重，现在是不是入场时机？",
  "responseMode": "STREAM"
}
```

响应 `202`：

```json
{
  "data": {
    "userMessage": {
      "id": "msg_10",
      "role": "USER",
      "content": "科技板块跌得很严重，现在是不是入场时机？"
    },
    "analysis": {
      "id": "analysis_10",
      "type": "ADVISORY_QA",
      "status": "QUEUED"
    },
    "streamUrl": "/api/v1/analyses/analysis_10/events"
  },
  "meta": {
    "requestId": "req_msg_send_01",
    "apiVersion": "v1",
    "generatedAt": "2026-07-23T08:52:00.000Z"
  }
}
```

主要错误：`404 RESOURCE_NOT_FOUND`、`409 IDEMPOTENCY_CONFLICT`、`409 RUN_ALREADY_ACTIVE`、`422 VALIDATION_ERROR`、`429 RATE_LIMITED`。

## 11. Agent 主动追问接口

### 11.1 获取待回答问题

`GET /api/v1/conversations/:conversationId/clarifications?status=PENDING`

响应 `200`：

```json
{
  "data": {
    "items": [
      {
        "id": "clarification_01",
        "analysisId": "analysis_10",
        "prompt": "为了判断科技板块是否适合你，需要补充以下信息。",
        "blocking": true,
        "fields": [
          {
            "key": "holdingPeriod",
            "type": "SINGLE_CHOICE",
            "label": "计划持有多久？",
            "options": ["SHORT", "MEDIUM", "LONG"],
            "required": true
          },
          {
            "key": "investmentAmount",
            "type": "MONEY",
            "label": "准备投入多少钱？",
            "required": true
          },
          {
            "key": "maxDrawdown",
            "type": "RATIO",
            "label": "最大可接受多少回撤？",
            "required": true
          },
          {
            "key": "instrumentPreference",
            "type": "SINGLE_CHOICE",
            "label": "偏好个股、行业 ETF 还是宽基指数？",
            "options": ["STOCK", "SECTOR_ETF", "BROAD_INDEX_ETF"],
            "required": true
          },
          {
            "key": "nearTermUse",
            "type": "BOOLEAN",
            "label": "这笔钱近期是否需要使用？",
            "required": true
          }
        ],
        "status": "PENDING"
      }
    ]
  },
  "meta": {
    "requestId": "req_clarifications_01",
    "apiVersion": "v1",
    "generatedAt": "2026-07-23T08:53:00.000Z"
  }
}
```

主要错误：`404 RESOURCE_NOT_FOUND`、`422 VALIDATION_ERROR`。

### 11.2 回答问题并恢复分析

`POST /api/v1/conversations/:conversationId/clarifications/:clarificationId/answer`

请求头：`Idempotency-Key: clarification-answer-01`。

请求：

```json
{
  "answers": {
    "holdingPeriod": "LONG",
    "investmentAmount": "20000.00",
    "maxDrawdown": 0.12,
    "instrumentPreference": "SECTOR_ETF",
    "nearTermUse": false
  }
}
```

响应 `202`：

```json
{
  "data": {
    "clarificationId": "clarification_01",
    "status": "ANSWERED",
    "analysis": {
      "id": "analysis_10",
      "status": "RUNNING"
    },
    "streamUrl": "/api/v1/analyses/analysis_10/events"
  },
  "meta": {
    "requestId": "req_clarification_answer_01",
    "apiVersion": "v1",
    "generatedAt": "2026-07-23T08:54:00.000Z"
  }
}
```

主要错误：`404 RESOURCE_NOT_FOUND`、`409 CLARIFICATION_ALREADY_ANSWERED`、`422 VALIDATION_ERROR`、`422 CLARIFICATION_EXPIRED`。

## 12. 分析任务接口

### 12.1 创建分析

`POST /api/v1/analyses`

请求头：`Idempotency-Key: stock-diagnostic-01`。

个股诊断请求：

```json
{
  "type": "STOCK_DIAGNOSTIC",
  "conversationId": "conv_01",
  "input": {
    "holdingId": "holding_01",
    "question": "分析当前持仓并给出持有、止损和止盈条件"
  }
}
```

组合诊断请求：

```json
{
  "type": "PORTFOLIO_DIAGNOSTIC",
  "conversationId": "conv_01",
  "input": {
    "goalId": "goal_01",
    "includeStressTests": true
  }
}
```

适配筛选请求：

```json
{
  "type": "STOCK_SUITABILITY_SCREEN",
  "conversationId": "conv_01",
  "input": {
    "candidateSymbols": ["000001.SZ", "600519.SH", "510300.SH"],
    "maximumResults": 3
  }
}
```

响应 `202`：

```json
{
  "data": {
    "id": "analysis_20",
    "type": "STOCK_DIAGNOSTIC",
    "status": "QUEUED",
    "streamUrl": "/api/v1/analyses/analysis_20/events"
  },
  "meta": {
    "requestId": "req_analysis_create_01",
    "apiVersion": "v1",
    "generatedAt": "2026-07-23T08:55:00.000Z"
  }
}
```

主要错误：`409 IDEMPOTENCY_CONFLICT`、`422 PROFILE_INCOMPLETE`、`422 VALIDATION_ERROR`、`429 RATE_LIMITED`。

### 12.2 获取分析状态与结果

`GET /api/v1/analyses/:analysisId`

响应 `200`：

```json
{
  "data": {
    "id": "analysis_20",
    "type": "STOCK_DIAGNOSTIC",
    "status": "COMPLETED",
    "stage": "FINALIZED",
    "progress": 1,
    "startedAt": "2026-07-23T08:55:01.000Z",
    "completedAt": "2026-07-23T08:55:12.000Z",
    "result": {
      "diagnosticId": "diagnostic_20",
      "recommendationIds": ["recommendation_20"],
      "assistantMessageId": "msg_20"
    },
    "compliance": {
      "status": "APPROVED_WITH_WARNINGS",
      "warnings": ["建议仅供模拟，不构成真实交易指令"]
    }
  },
  "meta": {
    "requestId": "req_analysis_get_01",
    "apiVersion": "v1",
    "generatedAt": "2026-07-23T08:56:00.000Z"
  }
}
```

当 `status=WAITING_FOR_USER` 时，`result` 包含 `clarificationId`；当失败时包含结构化 `failure`。

主要错误：`404 RESOURCE_NOT_FOUND`。

### 12.3 取消分析

`POST /api/v1/analyses/:analysisId/cancel`

请求：

```json
{
  "reason": "用户离开当前分析"
}
```

响应 `200`：

```json
{
  "data": {
    "id": "analysis_20",
    "status": "CANCELLED",
    "cancelledAt": "2026-07-23T08:56:30.000Z"
  },
  "meta": {
    "requestId": "req_analysis_cancel_01",
    "apiVersion": "v1",
    "generatedAt": "2026-07-23T08:56:30.000Z"
  }
}
```

主要错误：`404 RESOURCE_NOT_FOUND`、`409 ANALYSIS_NOT_CANCELLABLE`。

### 12.4 重试分析

`POST /api/v1/analyses/:analysisId/retry`

请求头：`Idempotency-Key: retry-analysis-20-01`。

请求：

```json
{
  "reuseValidEvidence": true
}
```

响应 `202`：

```json
{
  "data": {
    "id": "analysis_21",
    "retryOf": "analysis_20",
    "status": "QUEUED",
    "streamUrl": "/api/v1/analyses/analysis_21/events"
  },
  "meta": {
    "requestId": "req_analysis_retry_01",
    "apiVersion": "v1",
    "generatedAt": "2026-07-23T08:57:00.000Z"
  }
}
```

主要错误：`404 RESOURCE_NOT_FOUND`、`409 ANALYSIS_NOT_RETRYABLE`、`409 IDEMPOTENCY_CONFLICT`。

## 13. SSE 流式接口

### 13.1 建立连接

`GET /api/v1/analyses/:analysisId/events`

请求头：

```http
Accept: text/event-stream
Last-Event-ID: evt_0008
```

响应头：

```http
Content-Type: text/event-stream
Cache-Control: no-cache, no-transform
Connection: keep-alive
X-Accel-Buffering: no
```

主要错误：连接建立前可返回 `401`、`404`；连接建立后的错误通过 `run.failed` 事件返回。

### 13.2 统一事件格式

```text
id: evt_0009
event: agent.started
data: {"eventId":"evt_0009","analysisId":"analysis_10","conversationId":"conv_01","sequence":9,"type":"agent.started","occurredAt":"2026-07-23T08:58:00.000Z","payload":{"agent":"DataResearchAgent","label":"正在核对估值、趋势和事件数据"}}

```

公共结构：

```ts
interface AgentStreamEvent<T = unknown> {
  eventId: string;
  analysisId: string;
  conversationId: string | null;
  sequence: number;
  type: string;
  occurredAt: string;
  payload: T;
}
```

事件类型：

| event | payload 关键字段 | 用途 |
| --- | --- | --- |
| `run.started` | `type`、`label` | 任务启动 |
| `stage.changed` | `stage`、`progress` | 更新可展示的分析步骤 |
| `supervisor.plan` | `steps[]` | 可展示的任务计划摘要 |
| `agent.started` | `agent`、`label` | 专业 Agent 启动 |
| `agent.completed` | `agent`、`summary` | Agent 结论摘要 |
| `tool.started` | `toolCallId`、`toolName`、`inputSummary` | 工具调用开始 |
| `tool.completed` | `toolCallId`、`outputSummary`、`dataAsOf` | 工具调用完成 |
| `tool.failed` | `toolCallId`、`code`、`retryable` | 工具失败 |
| `evidence.added` | `evidenceId`、`stance`、`summary` | 新证据可展示 |
| `clarification.required` | `clarificationId`、`fields` | 需要用户补全 |
| `recommendation.created` | `recommendationId`、`action` | 建议已生成 |
| `message.delta` | `messageId`、`delta` | 最终自然语言逐段输出 |
| `message.completed` | `messageId` | 回复完成 |
| `run.completed` | `result` | 分析完成 |
| `run.blocked` | `reasonCode`、`message` | 风险或合规阻断 |
| `run.failed` | `code`、`message`、`retryable` | 任务失败 |
| `run.cancelled` | `reason` | 任务取消 |
| `heartbeat` | `serverTime` | 每 15 秒保活 |

`supervisor.plan`、`agent.completed` 和工具摘要不得包含隐藏思维链，只提供可审计的任务说明和结论。

### 13.3 重连与结束

- SSE 事件写入 SQLite 后再发送。
- 客户端用 `Last-Event-ID` 从下一序号恢复。
- 终态事件后服务端主动关闭连接。
- 业务事件默认保留 180 天，与数据库保留策略一致；MVP 不提供分析删除接口。
- 心跳不要求持久化，业务事件必须持久化。

## 14. 推荐与模拟接口

### 14.1 获取建议列表

`GET /api/v1/recommendations?action=SCALE_OUT&status=ACTIVE&limit=20&cursor=...`

响应 `200`：

```json
{
  "data": {
    "items": [
      {
        "id": "recommendation_20",
        "direction": "SELL",
        "action": "SCALE_OUT",
        "asset": {
          "symbol": "518880.SH",
          "name": "黄金ETF"
        },
        "summary": "停止追高，考虑分批降低集中度",
        "suitability": "HIGH",
        "confidence": "MEDIUM",
        "validUntil": "2026-07-30T07:00:00.000Z",
        "status": "ACTIVE"
      }
    ]
  },
  "meta": {
    "requestId": "req_rec_list_01",
    "apiVersion": "v1",
    "generatedAt": "2026-07-23T09:00:00.000Z",
    "pagination": {
      "limit": 20,
      "nextCursor": null,
      "hasMore": false
    }
  }
}
```

主要错误：`422 VALIDATION_ERROR`。

### 14.2 获取完整建议卡

`GET /api/v1/recommendations/:recommendationId`

响应 `200`：

```json
{
  "data": {
    "id": "recommendation_20",
    "analysisId": "analysis_20",
    "direction": "BUY",
    "action": "TRIAL_BUY",
    "status": "ACTIVE",
    "asset": {
      "symbol": "000001.SZ",
      "name": "平安银行",
      "assetType": "STOCK"
    },
    "summary": "估值处于历史中低位，但中期趋势尚未确认，仅适合小仓位观察",
    "suitability": "MEDIUM",
    "confidence": "MEDIUM",
    "timeHorizon": "LONG",
    "positionPlan": {
      "suggestedWeightRange": { "min": 0.02, "max": 0.08 },
      "initialWeight": 0.02,
      "maximumWeight": 0.08,
      "reduceRatio": null
    },
    "referenceRanges": {
      "observationPrice": { "min": "9.80", "max": "10.50" },
      "stopLossPrice": { "min": "9.10", "max": "9.40" },
      "takeProfitPrice": { "min": "11.50", "max": "12.20" }
    },
    "addConditions": [
      "净息差和资产质量没有继续恶化",
      "重新站稳 20 日均线",
      "组合银行行业权重仍低于 25%"
    ],
    "stopLossConditions": [
      "价格跌破参考风险区间且成交量异常放大",
      "核心盈利假设失效",
      "用户资金期限缩短"
    ],
    "takeProfitConditions": [
      "达到目标估值区间",
      "单票权重超过 8%",
      "组合需要再平衡"
    ],
    "rationales": [
      "PE-TTM 为 28.6，处于近三年 34% 分位",
      "营收同比增长 18%，经营现金流覆盖净利润",
      "日线 MACD 金叉，但仍在零轴下方"
    ],
    "counterEvidence": [
      "毛利率连续两个报告期下降，周线趋势仍弱"
    ],
    "risks": [
      "45 天后存在限售股解禁",
      "科技行业波动和组合相关性较高"
    ],
    "alternatives": [
      {
        "type": "BROAD_INDEX_ETF",
        "summary": "使用宽基 ETF 降低单票风险"
      },
      {
        "type": "CASH",
        "summary": "等待趋势和基本面证据进一步确认"
      }
    ],
    "displayMetrics": {
      "valuation": {
        "peTtm": "28.60",
        "peThreeYearPercentile": 0.34,
        "industryPeMedian": "35.20"
      },
      "fundamentals": {
        "revenueYoY": 0.18,
        "netProfitYoY": 0.12,
        "roe": 0.154,
        "grossMarginTrend": "DECLINING"
      },
      "technical": {
        "macdState": "DAILY_GOLDEN_CROSS",
        "macdZeroAxis": "BELOW",
        "weeklyAlignment": "BEARISH",
        "volumeConfirmation": "WEAK"
      },
      "eventSummary": {
        "highestRisk": "MEDIUM",
        "importantEventCount": 1
      }
    },
    "dataAsOf": "2026-07-22T07:00:00.000Z",
    "validUntil": "2026-07-30T07:00:00.000Z",
    "invalidWhen": [
      "业绩预告明显下修",
      "行业权重超过用户上限",
      "行情数据过期"
    ],
    "compliance": {
      "status": "APPROVED_WITH_WARNINGS",
      "disclaimer": "仅供研究和模拟，不构成真实投资建议或交易指令"
    }
  },
  "meta": {
    "requestId": "req_rec_get_01",
    "apiVersion": "v1",
    "generatedAt": "2026-07-23T09:01:00.000Z"
  }
}
```

卖出或持有建议使用同一结构，并额外填充：

- `positionPlan.reduceRatio`。
- `executionPace`。
- `triggerReasons`，例如贸易摩擦、业绩下修或集中度超限。
- `portfolioImpactAfterReduction`。
- `riskIfContinueHolding`。
- `scenarioIfNoAction`。

主要错误：`404 RESOURCE_NOT_FOUND`。

### 14.3 创建模拟方案

`POST /api/v1/recommendations/:recommendationId/simulations`

请求头：`Idempotency-Key: simulation-rec-20-01`。

请求：

```json
{
  "scenario": "PROPOSED",
  "customAdjustment": null
}
```

响应 `201`：

```json
{
  "data": {
    "id": "simulation_20",
    "recommendationId": "recommendation_20",
    "status": "COMPLETED",
    "before": {
      "totalMarketValue": "328000.00",
      "assetWeight": 0.0,
      "sectorWeight": 0.21,
      "estimatedStressLoss": -0.108
    },
    "after": {
      "totalMarketValue": "328000.00",
      "assetWeight": 0.02,
      "sectorWeight": 0.23,
      "estimatedStressLoss": -0.112
    },
    "goalImpact": {
      "liquidityStatus": "UNCHANGED",
      "riskFit": "WITHIN_LIMITS"
    },
    "ordersCreated": false,
    "disclaimer": "模拟结果不代表未来表现，不会产生真实交易"
  },
  "meta": {
    "requestId": "req_sim_create_01",
    "apiVersion": "v1",
    "generatedAt": "2026-07-23T09:02:00.000Z"
  }
}
```

主要错误：`404 RESOURCE_NOT_FOUND`、`409 IDEMPOTENCY_CONFLICT`、`422 RECOMMENDATION_EXPIRED`、`422 COMPLIANCE_BLOCKED`。

### 14.4 获取模拟方案

`GET /api/v1/simulations/:simulationId`

响应 `200`：

```json
{
  "data": {
    "id": "simulation_20",
    "status": "COMPLETED",
    "comparison": {
      "proposed": {
        "estimatedStressLoss": -0.112,
        "sectorWeight": 0.23
      },
      "noAction": {
        "estimatedStressLoss": -0.108,
        "sectorWeight": 0.21
      }
    },
    "ordersCreated": false
  },
  "meta": {
    "requestId": "req_sim_get_01",
    "apiVersion": "v1",
    "generatedAt": "2026-07-23T09:03:00.000Z"
  }
}
```

主要错误：`404 RESOURCE_NOT_FOUND`。

### 14.5 模拟采纳、拒绝或稍后处理

`POST /api/v1/recommendations/:recommendationId/decisions`

请求头：`Idempotency-Key: decision-rec-20-01`。

模拟采纳请求：

```json
{
  "action": "SIMULATED_ACCEPT",
  "simulationId": "simulation_20",
  "reasonCodes": ["FITS_LONG_TERM_PLAN"],
  "note": "先记录方案，不执行真实交易"
}
```

拒绝请求：

```json
{
  "action": "REJECT",
  "simulationId": null,
  "reasonCodes": ["RISK_TOO_HIGH"],
  "note": "暂时无法接受额外波动"
}
```

响应 `201`：

```json
{
  "data": {
    "id": "decision_20",
    "recommendationId": "recommendation_20",
    "action": "SIMULATED_ACCEPT",
    "recordedAt": "2026-07-23T09:04:00.000Z",
    "ordersCreated": false,
    "observationConditionsCreated": [
      "condition_20",
      "condition_21"
    ]
  },
  "meta": {
    "requestId": "req_decision_create_01",
    "apiVersion": "v1",
    "generatedAt": "2026-07-23T09:04:00.000Z"
  }
}
```

主要错误：`404 RESOURCE_NOT_FOUND`、`409 DECISION_CONFLICT`、`409 IDEMPOTENCY_CONFLICT`、`422 SIMULATION_REQUIRED`、`422 RECOMMENDATION_EXPIRED`。

## 15. Evidence Lab 接口

### 15.1 获取证据包与执行轨迹

`GET /api/v1/analyses/:analysisId/evidence-pack?includeToolPayload=false`

响应 `200`：

```json
{
  "data": {
    "analysisId": "analysis_20",
    "dataFreshness": {
      "marketDataAsOf": "2026-07-22T07:00:00.000Z",
      "financialReportPeriod": "2026-Q2",
      "status": "FRESH"
    },
    "evidence": [
      {
        "id": "evidence_01",
        "category": "VALUATION",
        "stance": "SUPPORT",
        "title": "PE 处于历史中低分位",
        "summary": "PE-TTM 5.8，近三年分位 22%",
        "source": {
          "type": "LOCAL_FIXTURE",
          "name": "getValuationSnapshot",
          "reference": "valuation:000001.SZ:2026-07-22"
        },
        "dataAsOf": "2026-07-22T07:00:00.000Z",
        "quality": "HIGH"
      },
      {
        "id": "evidence_02",
        "category": "FUNDAMENTAL",
        "stance": "COUNTER",
        "title": "盈利增速偏低",
        "summary": "净利润同比增长约 3%，后续仍需跟踪净息差和资产质量",
        "source": {
          "type": "LOCAL_FIXTURE",
          "name": "getFundamentalSnapshot",
          "reference": "fundamental:000001.SZ:2026-Q2"
        },
        "dataAsOf": "2026-06-30T00:00:00.000Z",
        "quality": "HIGH"
      }
    ],
    "agentTrace": [
      {
        "agent": "DataResearchAgent",
        "status": "COMPLETED",
        "purpose": "核对估值、基本面、趋势和事件",
        "summary": "估值相对合理，短期动量改善，但中期趋势未确认"
      },
      {
        "agent": "ComplianceReviewerAgent",
        "status": "COMPLETED",
        "purpose": "检查建议边界",
        "summary": "允许展示为小仓位观察，不允许表述为确定性买入"
      }
    ],
    "toolCalls": [
      {
        "id": "tool_01",
        "toolName": "getValuationSnapshot",
        "status": "COMPLETED",
        "inputSummary": "000001.SZ，三年估值窗口",
        "outputSummary": "PE-TTM 5.8，历史分位 22%",
        "startedAt": "2026-07-23T08:55:03.000Z",
        "completedAt": "2026-07-23T08:55:04.000Z"
      }
    ],
    "compliance": {
      "status": "APPROVED_WITH_WARNINGS",
      "rules": [
        {
          "code": "NO_SINGLE_SIGNAL_RECOMMENDATION",
          "result": "PASS"
        },
        {
          "code": "COUNTER_EVIDENCE_REQUIRED",
          "result": "PASS"
        }
      ]
    },
    "missingEvidence": [],
    "disclaimer": "证据包用于解释模拟建议，不代表未来收益"
  },
  "meta": {
    "requestId": "req_evidence_01",
    "apiVersion": "v1",
    "generatedAt": "2026-07-23T09:05:00.000Z"
  }
}
```

主要错误：`404 RESOURCE_NOT_FOUND`、`409 ANALYSIS_NOT_READY`。

默认隐藏原始模型提示词、密钥、完整外部响应和隐藏思维链。`includeToolPayload=true` 仍只返回脱敏且经过白名单过滤的结构化字段。

## 16. 决策日志接口

### 16.1 获取决策日志

`GET /api/v1/decisions?action=REJECT&limit=20&cursor=...`

响应 `200`：

```json
{
  "data": {
    "items": [
      {
        "id": "decision_20",
        "recommendationId": "recommendation_20",
        "action": "REJECT",
        "reasonCodes": ["RISK_TOO_HIGH"],
        "note": "暂时无法接受额外波动",
        "recordedAt": "2026-07-23T09:04:00.000Z"
      }
    ]
  },
  "meta": {
    "requestId": "req_decisions_01",
    "apiVersion": "v1",
    "generatedAt": "2026-07-23T09:06:00.000Z",
    "pagination": {
      "limit": 20,
      "nextCursor": null,
      "hasMore": false
    }
  }
}
```

主要错误：`422 VALIDATION_ERROR`。

### 16.2 获取决策详情

`GET /api/v1/decisions/:decisionId`

响应 `200`：

```json
{
  "data": {
    "id": "decision_20",
    "recommendationSnapshot": {
      "action": "SCALE_OUT",
      "summary": "分批降低黄金集中度",
      "dataAsOf": "2026-07-22T07:00:00.000Z"
    },
    "simulationSnapshot": {
      "beforeWeight": 0.5,
      "afterWeight": 0.25
    },
    "action": "SIMULATED_ACCEPT",
    "reasonCodes": ["REDUCE_CONCENTRATION"],
    "note": "只记录模拟方案",
    "recordedAt": "2026-07-23T09:04:00.000Z",
    "ordersCreated": false
  },
  "meta": {
    "requestId": "req_decision_get_01",
    "apiVersion": "v1",
    "generatedAt": "2026-07-23T09:07:00.000Z"
  }
}
```

主要错误：`404 RESOURCE_NOT_FOUND`。

## 17. 后续观察条件接口

没有定时任务和消息队列。观察条件在以下时机评估：

- 用户打开首页或持仓页。
- 用户发送相关对话。
- 用户手动点击“重新检查”。
- 演示脚本调用批量评估接口。

### 17.1 获取观察条件

`GET /api/v1/observation-conditions?status=ACTIVE&limit=20&cursor=...`

响应 `200`：

```json
{
  "data": {
    "items": [
      {
        "id": "condition_20",
        "type": "DRAWDOWN_REACH",
        "asset": {
          "symbol": "000001.SZ",
          "name": "平安银行"
        },
        "severity": "IMPORTANT",
        "parameters": {
          "window": "FROM_RECENT_HIGH",
          "threshold": -0.15
        },
        "status": "ACTIVE",
        "lastEvaluatedAt": null,
        "validUntil": "2026-10-23T00:00:00.000Z",
        "version": 1
      }
    ]
  },
  "meta": {
    "requestId": "req_condition_list_01",
    "apiVersion": "v1",
    "generatedAt": "2026-07-23T09:08:00.000Z",
    "pagination": {
      "limit": 20,
      "nextCursor": null,
      "hasMore": false
    }
  }
}
```

主要错误：`422 VALIDATION_ERROR`。

### 17.2 创建观察条件

`POST /api/v1/observation-conditions`

请求：

```json
{
  "holdingId": "holding_01",
  "sourceRecommendationId": "recommendation_20",
  "type": "POSITION_WEIGHT_ABOVE",
  "severity": "IMPORTANT",
  "parameters": {
    "threshold": 0.08
  },
  "evaluationMode": "ON_PAGE_LOAD",
  "validUntil": "2026-10-23T00:00:00.000Z"
}
```

响应 `201`：

```json
{
  "data": {
    "id": "condition_21",
    "status": "ACTIVE",
    "version": 1
  },
  "meta": {
    "requestId": "req_condition_create_01",
    "apiVersion": "v1",
    "generatedAt": "2026-07-23T09:09:00.000Z"
  }
}
```

支持类型：

- `PRICE_ENTER_ZONE`
- `DRAWDOWN_REACH`
- `PE_PERCENTILE_BELOW`
- `MACD_CONFIRMATION`
- `EVENT_RISK`
- `POSITION_WEIGHT_ABOVE`
- `THESIS_INVALIDATED`
- `REVIEW_DATE`

主要错误：`404 RESOURCE_NOT_FOUND`、`422 VALIDATION_ERROR`。

### 17.3 更新观察条件

`PATCH /api/v1/observation-conditions/:conditionId`

请求头：`If-Match: "1"`。

请求：

```json
{
  "severity": "URGENT",
  "parameters": {
    "threshold": -0.18
  },
  "status": "ACTIVE"
}
```

响应 `200`：

```json
{
  "data": {
    "id": "condition_20",
    "severity": "URGENT",
    "parameters": {
      "threshold": -0.18
    },
    "version": 2
  },
  "meta": {
    "requestId": "req_condition_patch_01",
    "apiVersion": "v1",
    "generatedAt": "2026-07-23T09:10:00.000Z"
  }
}
```

主要错误：`404 RESOURCE_NOT_FOUND`、`412 VERSION_CONFLICT`、`422 VALIDATION_ERROR`。

### 17.4 删除观察条件

`DELETE /api/v1/observation-conditions/:conditionId`

响应：`204 No Content`。

主要错误：`404 RESOURCE_NOT_FOUND`。

### 17.5 批量评估观察条件

`POST /api/v1/observation-conditions/evaluate`

请求头：`Idempotency-Key: evaluate-conditions-20260723-01`。

请求：

```json
{
  "conditionIds": ["condition_20", "condition_21"],
  "createConversationMessages": true
}
```

响应 `200`：

```json
{
  "data": {
    "evaluated": 2,
    "triggered": 1,
    "results": [
      {
        "conditionId": "condition_20",
        "status": "TRIGGERED",
        "observedValue": -0.162,
        "threshold": -0.15,
        "summary": "回撤达到 16.2%，超过 15% 观察阈值",
        "analysisId": "analysis_30"
      },
      {
        "conditionId": "condition_21",
        "status": "NOT_TRIGGERED",
        "observedValue": 0.07,
        "threshold": 0.08
      }
    ]
  },
  "meta": {
    "requestId": "req_condition_evaluate_01",
    "apiVersion": "v1",
    "generatedAt": "2026-07-23T09:11:00.000Z"
  }
}
```

主要错误：`409 IDEMPOTENCY_CONFLICT`、`422 STALE_MARKET_DATA`、`502 DATA_PROVIDER_UNAVAILABLE`。

## 18. 建议生成规则

### 18.1 买入建议最低字段

- 状态：观察、试仓或分批增配。
- 用户适合程度。
- 组合建议仓位区间。
- 首笔仓位。
- 后续加仓条件。
- 参考观察区间。
- 价格和投资逻辑止损条件。
- 止盈或再平衡条件。
- 建议期限。
- 有效期。
- 最多三条主要依据。
- 至少一条反方证据。
- 最多三条主要风险。
- 替代方案。

### 18.2 卖出与持有建议最低字段

- 动作：持有、停止加仓、分批减仓或退出。
- 建议减仓比例。
- 执行节奏。
- 触发原因。
- 减仓后的组合变化。
- 继续持有的主要风险。
- 不减仓可能出现的情景。
- 替代配置。
- 建议失效条件。

### 18.3 硬规则

以下任意一项成立时不得生成明确买卖建议：

- 画像未完成。
- 标的无法唯一确认。
- 持仓数量或成本缺失。
- 行情超过配置的新鲜度。
- 只有单一技术指标或单一消息支持。
- 缺少反方证据。
- 无法计算组合影响。
- 建议后单票或行业仓位超过用户上限。
- 用户近期需要使用该资金。
- 用户要求保证收益或确定性预测。

降级结果必须说明：

- 当前可以确认的事实。
- 缺失或冲突的信息。
- 暂不能生成建议的原因。
- 下一次可以重新评估的条件。

## 19. 数据库设计引用

数据库结构、字段类型、枚举、外键、索引、事务、数据保留和 SQLite 到 PostgreSQL 迁移，以 `2026-07-23-conversation-agent-database-design.md` 为唯一事实来源。

API wire enum 使用大写 `UPPER_SNAKE_CASE`，数据库存储 enum 使用小写 `snake_case`；实现层必须集中维护一份显式映射，不允许在 Route Handler 中临时转换。金额、价格和数量在 API 与数据库中均使用十进制字符串。

资源别名固定为：API `holdings/parse` 对应 `holding_parse_drafts`，`analyses` 对应根 `agent_runs`，`clarifications` 对应 `information_requests`，`observation-conditions` 对应 `watch_conditions`。前端和 Route Handler 使用 API 名称，仓储层使用表名。

## 20. 事务与状态一致性

必须在同一 SQLite 事务中完成：

1. 消息写入、分析任务创建和首个 `run.started` 事件。
2. 持仓解析确认、持仓创建和解析任务状态更新。
3. 建议创建、证据关联和合规状态写入。
4. 决策日志、建议决策状态和观察条件创建。
5. SSE 终态事件和分析任务终态更新。

状态迁移：

```text
QUEUED -> RUNNING
RUNNING -> WAITING_FOR_USER
WAITING_FOR_USER -> RUNNING
RUNNING -> COMPLETED
RUNNING -> BLOCKED
RUNNING -> FAILED
RUNNING -> CANCELLED
QUEUED/RUNNING -> INTERRUPTED
FAILED/INTERRUPTED -> 新的 retry run
```

禁止：

- 从终态回到 `RUNNING`。
- 在建议创建前标记分析 `COMPLETED`。
- 在合规未通过时创建 `ACTIVE` 建议。
- 在没有模拟结果时记录 `SIMULATED_ACCEPT`。

## 21. Zod 校验策略

所有边界必须使用 Zod：

1. Route Handler 请求参数。
2. SQLite 读取后的 JSON 字段。
3. Mastra Agent 输入。
4. 每个工具的参数和输出。
5. DeepSeek 生成的结构化候选结论。
6. 最终诊断、证据和建议卡。
7. SSE 事件 payload。

重要约束：

- 用户消息长度 `1..4000` 字符。
- 持仓解析文本长度 `1..2000` 字符。
- 金额和价格使用正十进制字符串。
- `maxAcceptableDrawdown` 为 `0.01..0.8`。
- 买入建议 `rationales` 最多 3 条。
- 买入建议 `counterEvidence` 至少 1 条。
- 买入建议 `risks` 最多 3 条。
- 候选股票最多 20 个，结果最多 3 个。
- 观察条件参数必须按 `conditionType` 使用判别联合校验。

Agent 输出 Zod 校验失败时允许一次带错误摘要的模型修复；第二次失败则将分析标记为 `FAILED`，不得使用未校验文本拼装建议。

## 22. 安全、隐私与合规

### 22.1 输入安全

- 限制消息和字段长度。
- 外部新闻、公告和 Skill 输出视为不可信文本。
- 数据内容不能覆盖系统指令、用户风险边界或合规规则。
- 工具采用白名单注册，模型不能构造任意函数名、SQL 或文件路径。
- SQLite 查询全部使用参数绑定。

### 22.2 模型数据最小化

发送给 DeepSeek 的上下文仅包含：

- 必要的风险标签和约束。
- 脱敏后的目标与持仓摘要。
- 结构化行情和研究证据。
- 当前用户问题。

不发送：

- Cookie、CSRF Token、数据库路径或服务端密钥。
- 不需要的收入、身份或家庭明细。
- 其他用户数据。

### 22.3 合规措辞

禁止：

- “保证上涨”“稳赚”“必然反弹”。
- 将置信度包装为上涨概率。
- 仅凭 MACD 金叉或新闻情绪推荐买入。
- 使用“立即买入”“一键卖出”等真实交易措辞。

允许：

- “加入观察”“小仓位模拟试仓”“停止加仓”“分批降低集中度”。
- 给出参考区间、条件、失效条件和风险。
- 比较采纳、不操作和替代方案的模拟结果。

### 22.4 限流

本地内存限流建议：

- 读取接口：每用户每分钟 120 次。
- 启动模型分析：每用户每分钟 10 次。
- 同时运行的模型分析：每用户 1 个。
- SSE 连接：每用户最多 3 个。

进程重启后计数清零，可接受于本地演示。

## 23. 失败与降级

| 场景 | 行为 |
| --- | --- |
| DeepSeek 超时 | 记录 `MODEL_UNAVAILABLE`，保留已生成证据，允许重试 |
| PandaData 凭证失败 | 记录 `PANDADATA_AUTH_FAILED`，不使用未标记的 Fixture 冒充实时数据 |
| PandaData 服务不可用 | 记录 `PANDADATA_UNAVAILABLE`，可使用明确标记的缓存/Fixture，无法满足新鲜度时停止建议 |
| API Skill 契约不匹配 | 记录 `SKILL_CONTRACT_MISMATCH`，停止该方法调用并要求重新加载本地接口文档 |
| 行情数据过期 | 不生成明确买卖建议，返回 `STALE_MARKET_DATA` 或观察提示 |
| 用户画像不完整 | 创建 clarification，任务进入 `WAITING_FOR_USER` |
| 标的无法确认 | 要求用户确认代码和资产类型 |
| 单一证据 | 继续搜索反方证据；仍不足则降级观察 |
| Agent 观点冲突 | Supervisor 要求补充证据；无法解决则显示冲突 |
| 合规阻断 | 任务进入 `BLOCKED`，输出风险说明，不创建 Active 建议 |
| 进程重启 | 将运行中任务标记 `INTERRUPTED`，支持 retry |
| SSE 断开 | 任务继续执行，客户端通过 `Last-Event-ID` 重连 |
| SQLite 锁等待超时 | 返回可重试 `503 DATABASE_BUSY` |

## 24. 系统与 Demo 接口

### 24.1 健康检查

`GET /api/v1/health`

用途：

- 判断 Node.js 进程是否存活。
- 检查 SQLite 是否可读写且迁移版本正确。
- 检查 DeepSeek 是否已配置以及最近一次轻量探测结果。
- 检查 PandaData SDK、凭证配置和最近一次轻量数据探测。
- 检查固定 Fixture 和 Demo seed 是否可加载，Fixture 仅作为降级能力。

健康检查不得返回 API Key、数据库文件路径、环境变量值、堆栈、完整供应商错误或用户数据。模型检查默认复用最近 60 秒内的探测结果，避免每次健康检查都触发模型生成。

响应 `200`：

```json
{
  "data": {
    "status": "READY",
    "version": "0.1.0",
    "uptimeSeconds": 1842,
    "checks": {
      "process": {
        "status": "UP"
      },
      "database": {
        "status": "UP",
        "writable": true,
        "migrationVersion": "0009"
      },
      "model": {
        "status": "UP",
        "provider": "DEEPSEEK",
        "checkedAt": "2026-07-23T09:20:00.000Z"
      },
      "pandadata": {
        "status": "UP",
        "sdkVersion": "0.0.12",
        "configured": true,
        "methodProbe": "get_trade_cal",
        "checkedAt": "2026-07-23T09:20:00.000Z"
      },
      "fixture": {
        "status": "UP",
        "seedVersion": "demo-v2-real-symbols"
      }
    }
  },
  "meta": {
    "requestId": "req_health_01",
    "apiVersion": "v1",
    "generatedAt": "2026-07-23T09:20:10.000Z"
  }
}
```

状态规则：

- `READY`：数据库、迁移、PandaData 和模型可用。
- `DEGRADED`：进程和数据库可用，但 PandaData/模型探测失败，只能使用明确标记的缓存或 Fixture；返回 HTTP `200`。
- `NOT_READY`：数据库不可用、迁移不匹配或 Fixture 缺失；返回 HTTP `503` 和同结构的脱敏检查结果。

该接口不要求演示 Cookie，不创建会话或业务数据，不受普通读取限流影响，但应设置独立的轻量限流。

### 24.2 获取 Demo 启动状态

`GET /api/v1/demo/bootstrap`

返回前端首屏所需的固定演示用户、画像完成度、投资目标、当前持仓和最近一次对话/建议摘要。接口只读取 seed，不隐式重置数据，并设置 `Cache-Control: no-store`。

响应 `200`：

```json
{
  "data": {
    "seedVersion": "demo-v2-real-symbols",
    "user": {
      "id": "user_demo_01",
      "displayName": "演示投资者"
    },
    "profile": {
      "id": "profile_demo_01",
      "status": "COMPLETE",
      "effectiveRiskLevel": "BALANCED",
      "maxAcceptableDrawdown": 0.15,
      "version": 1
    },
    "goals": {
      "items": [
        {
          "id": "goal_demo_growth",
          "name": "三年稳健增值",
          "priority": 1,
          "targetAmount": "300000.00",
          "horizon": "LONG"
        }
      ],
      "total": 2
    },
    "holdings": {
      "items": [
        {
          "id": "holding_demo_gold",
          "instrument": {
            "id": "instrument_518880_sh",
            "symbol": "518880.SH",
            "name": "黄金 ETF",
            "assetType": "GOLD_ETF"
          },
          "quantity": "10000",
          "averageCost": "4.2600",
          "portfolioWeight": 0.5
        }
      ],
      "total": 3
    },
    "latestConversation": {
      "id": "conversation_demo_gold",
      "title": "黄金半仓是否减仓",
      "status": "ACTIVE",
      "lastMessageAt": "2026-07-23T09:10:00.000Z"
    },
    "latestRecommendation": {
      "id": "recommendation_demo_gold",
      "action": "SCALE_OUT",
      "status": "ACTIVE",
      "summary": "黄金仓位集中，建议模拟分批降低集中度",
      "validUntil": "2026-07-30T07:00:00.000Z"
    }
  },
  "meta": {
    "requestId": "req_demo_bootstrap_01",
    "apiVersion": "v1",
    "generatedAt": "2026-07-23T09:20:10.000Z"
  }
}
```

`goals.items` 和 `holdings.items` 默认各返回首屏前 5 项并提供 `total`；不嵌入消息正文、Evidence Lab、完整建议卡或行情序列，这些内容继续通过各自资源接口加载。`profile.status` 是根据画像必填字段与当前风险评估计算出的 `DRAFT` 或 `COMPLETE`，不要求数据库单独保存重复状态列。

主要错误：`401 UNAUTHENTICATED`、`503 DEMO_NOT_READY`。

### 24.3 重置 Demo 数据

`POST /api/v1/demo/reset`

请求头：

```http
Idempotency-Key: demo-reset-20260723-01
X-CSRF-Token: <demo-csrf-token>
```

请求：

```json
{
  "seedVersion": "demo-v2-real-symbols"
}
```

执行语义：

1. 仅在 `DEMO_MODE=true` 时开放。
2. 使用进程内互斥锁串行化 reset；已有 reset 时返回 `409 DEMO_RESET_IN_PROGRESS`。
3. 先取消该 Demo 用户的活动根 run，触发其 `AbortController`，写入 `run.cancelled`，并从活动运行 `Map` 移除。
4. 在独立于 Demo 用户生命周期的 `idempotency_records` 和 `demo_reset_runs` 中登记请求。
5. 使用一个 `BEGIN IMMEDIATE` 事务删除旧用户私有数据、清理 seed 专属 Fixture 引用并重新插入固定 ID、固定版本的 seed。
6. 提交后重新签发演示 Cookie 和 CSRF Token，并读取一次与 `GET /demo/bootstrap` 相同的启动状态。
7. 相同幂等键和相同请求直接返回第一次响应；相同键但不同 `seedVersion` 返回 `409 IDEMPOTENCY_CONFLICT`。

响应 `200`：

```json
{
  "data": {
    "resetId": "demo_reset_01",
    "seedVersion": "demo-v2-real-symbols",
    "cancelledAnalysisIds": ["analysis_30"],
    "resetAt": "2026-07-23T09:22:00.000Z",
    "bootstrap": {
      "seedVersion": "demo-v2-real-symbols",
      "user": {
        "id": "user_demo_01",
        "displayName": "演示投资者"
      },
      "profile": {
        "id": "profile_demo_01",
        "status": "COMPLETE",
        "effectiveRiskLevel": "BALANCED",
        "maxAcceptableDrawdown": 0.15,
        "version": 1
      },
      "goals": {
        "items": [
          {
            "id": "goal_demo_growth",
            "name": "三年稳健增值",
            "priority": 1,
            "targetAmount": "300000.00",
            "horizon": "LONG"
          }
        ],
        "total": 2
      },
      "holdings": {
        "items": [
          {
            "id": "holding_demo_gold",
            "instrument": {
              "id": "instrument_518880_sh",
              "symbol": "518880.SH",
              "name": "黄金 ETF",
              "assetType": "GOLD_ETF"
            },
            "quantity": "10000",
            "averageCost": "4.2600",
            "portfolioWeight": 0.5
          }
        ],
        "total": 3
      },
      "latestConversation": {
        "id": "conversation_demo_gold",
        "title": "黄金半仓是否减仓",
        "status": "ACTIVE",
        "lastMessageAt": "2026-07-23T09:10:00.000Z"
      },
      "latestRecommendation": {
        "id": "recommendation_demo_gold",
        "action": "SCALE_OUT",
        "status": "ACTIVE",
        "summary": "黄金仓位集中，建议模拟分批降低集中度",
        "validUntil": "2026-07-30T07:00:00.000Z"
      }
    }
  },
  "meta": {
    "requestId": "req_demo_reset_01",
    "apiVersion": "v1",
    "generatedAt": "2026-07-23T09:22:00.000Z"
  }
}
```

`bootstrap` 必须与 24.2 的 `data` 对象完全同构。Reset 成功后，相同 seed 的业务 ID、画像、目标、持仓、会话、建议和 Fixture 内容必须可重复，只有 `resetId`、审计时间与幂等元数据允许变化。

主要错误：`403 DEMO_RESET_DISABLED`、`409 DEMO_RESET_IN_PROGRESS`、`409 IDEMPOTENCY_CONFLICT`、`422 UNKNOWN_SEED_VERSION`、`503 DATABASE_BUSY`。

## 25. 验收场景

1. 未建档用户询问科技板块入场，Agent 先完成画像或追问。
2. 用户主观进取但一年内需要资金，系统按较低风险边界执行。
3. “指数 100 点买 100 股”被识别为不可直接交易的歧义持仓。
4. 持仓诊断正确计算浮盈、回撤和组合权重。
5. 个股卡展示 PE 历史分位、基本面、MACD 上下文、事件和组合适配。
6. MACD 金叉但周线弱、成交量不足时，不生成强买入建议。
7. 黄金占组合 50% 时优先给出停止加仓或分批减仓方案。
8. 买入建议包含仓位、加仓条件、止损、止盈、有效期和至少一条反方证据。
9. 卖出建议展示减仓后组合变化和不减仓情景。
10. 用户通过 SSE 看到 Agent、工具、证据和建议事件。
11. SSE 断开后可用 `Last-Event-ID` 继续接收。
12. 模拟采纳不会创建订单，数据库中 `orders_created` 始终为 0。
13. 拒绝建议后生成不可变决策日志。
14. 回撤观察条件可由手动评估接口触发新分析。
15. 行情过期、证据不足或合规失败时不输出明确买卖建议。
16. 相同幂等键重复提交不会生成重复消息、持仓、模拟或决策。
17. 健康检查能区分 `READY`、`DEGRADED` 和 `NOT_READY`，且不泄露敏感配置。
18. Demo bootstrap 一次返回首屏所需摘要，并与各资源详情接口保持一致。
19. Demo reset 会取消活动分析；连续重置到同一 seed 后业务状态完全一致。
20. 配置 Pandadata 凭证后，Agent 能通过复制的 `pandadata-api` Skill 完成真实数据调用。
21. 真实调用能追溯到准确的方法名、脱敏参数、数据日期、SDK/Skill 版本和质量状态。
22. SDK 未导出、接口契约不匹配或数据服务不可用时，系统不会输出伪造的实时数据。

## 26. 推荐实现顺序

1. 加载 `.codex/skills/pandadata-api`，安装并锁定 `panda_data==0.0.12`，完成 `get_trade_cal` 和 `get_stock_daily` 冒烟测试。
2. 建立 SQLite 迁移、统一响应、错误、幂等和会话中间层。
3. 完成画像、风险测评、目标和持仓 CRUD。
4. 完成自然语言持仓解析与确认。
5. 完成会话、消息、分析任务和 SSE 事件存储。
6. 实现 `PandadataAdapter`、方法白名单、数据快照和 Skill 运行记录。
7. 接入 Mastra Supervisor、DeepSeek 和确定性工具。
8. 完成追问恢复机制。
9. 完成个股与组合诊断。
10. 完成建议卡、Evidence Lab 和合规门禁。
11. 完成模拟、决策日志和观察条件。
12. 完成 health、Demo bootstrap 和可重复 reset。
13. 用真实数据、凭证失败、接口过期和 Fixture 降级场景完成端到端演示测试。

本文档是对话 Agent MVP 的唯一 API 契约。前端、Route Handler、Mastra Agent、工具和 SQLite 迁移应复用同一套 Zod 枚举与对象定义，避免在不同层重复解释金融字段。
