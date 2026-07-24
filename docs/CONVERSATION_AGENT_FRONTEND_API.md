# Money Whisperer 对话 Agent 前端接口文档

> 版本：`v1 / 前端整合版 1.0`  
> 日期：`2026-07-24`  
> 面向对象：Web 前端、BFF/Route Handler 联调人员  
> 基础路径：`/api/v1`

## 1. 文档范围

本文从以下两份后端设计中筛选并合并普通用户前端需要调用、展示或触发的接口：

- [对话 Agent MVP API 设计](./superpowers/specs/2026-07-23-conversation-agent-api-design.md)
- [对话 Agent 扩展 REST API 设计](./CONVERSATION_AGENT_EXTENSIONS_API.md)

本文是前端消费视角的精简契约，不替代后端完整设计。公共契约以 MVP 文档为基础；扩展文档对同一路径新增的字段、枚举和事件优先。例如，发送消息接口需要同时支持扩展的 `outputMode`、消息产物 `artifacts` 和 `availableActions`。

接口按以下级别标记：

| 级别 | 含义 |
| --- | --- |
| 核心 | 首屏、对话主链路或全局状态必须接入 |
| 页面 | 对应页面上线时接入 |
| 可选 | Demo、诊断或 P1/P2 功能使用，不阻塞对话 MVP |
| 不暴露 | 仅服务端、管理员或内部审计使用，普通前端不调用 |

## 2. 前端暴露范围结论

普通用户前端需要暴露以下业务域：

1. Demo 启动、画像、目标、标的和持仓。
2. 会话、消息、主动追问、分析状态和 SSE 流式事件。
3. 建议卡、模拟、用户决策、证据包和决策日志。
4. 智能查数、图表/报告产物和会话输出偏好。
5. 资产分析、A/B/C 分支模拟、搜索、自选、提醒、通知和 RSS 阅读。

普通用户前端不应暴露：

- `/api/v1/admin/rss/*` 管理接口。
- PandaData、DeepSeek、MCP、Skill 的凭证、原始请求或完整外部响应。
- 数据库路径、表名、迁移信息、内部运维会话和服务端 `userId`。
- 原始模型提示词、隐藏思维链、未净化 HTML、未白名单过滤的 ECharts 配置。

## 3. 公共请求约定

### 3.1 格式与认证

- 请求和普通响应使用 `application/json`，SSE 使用 `text/event-stream`。
- JSON 字段统一为 `camelCase`。
- 身份由签名 HttpOnly Cookie `mw_demo_session` 提供，前端不得发送 `userId`。
- 浏览器请求必须携带 Cookie。同源部署可使用默认策略；跨源开发环境必须使用 `credentials: "include"`，且后端允许凭证 CORS。
- 所有修改请求必须携带 `X-CSRF-Token`；获取方式目前未在源契约定义，见第 16 节。
- 标记为幂等的 `POST` 必须携带唯一 `Idempotency-Key`，最长 128 字符。建议按一次用户动作生成 UUID，并在网络重试时复用原值。
- `PATCH` 和标记需要版本控制的 `PUT/DELETE` 携带 `If-Match: "<version>"`。

示例：

```http
POST /api/v1/conversations/conv_01/messages
Content-Type: application/json
X-CSRF-Token: <csrf-token>
Idempotency-Key: 8c833d29-81dd-43dd-89c0-9dfd35c414b8
Cookie: mw_demo_session=<HttpOnly; browser managed>
```

### 3.2 数据类型和前端格式化

| 后端数据 | Wire 格式 | 前端处理 |
| --- | --- | --- |
| 金额、价格、数量 | 十进制字符串，如 `"128000.00"` | 禁止先转 JS `number` 做精确计算；展示时使用十进制库或服务端格式值 |
| 比例、权重、回撤 | JSON number，如 `0.15` | 展示为 `15%`；负回撤保留负号 |
| 时间 | UTC ISO 8601 | 按用户时区格式化 |
| 日期 | `YYYY-MM-DD` | 不做时区偏移 |
| 缺失指标 | `null` 且可能列入 `missingMetrics` | 展示“暂无数据”，不得显示为 0 |
| ID、游标 | 不透明字符串 | 不解析、不拼接业务含义 |

### 3.3 成功、分页和错误包络

```ts
interface ApiMeta {
  requestId: string;
  apiVersion: "v1";
  generatedAt: string;
  pagination?: {
    limit: number;
    nextCursor: string | null;
    hasMore: boolean;
  };
}

interface ApiResponse<T> {
  data: T;
  meta: ApiMeta;
}

interface ApiErrorResponse {
  error: {
    code: string;
    message: string;
    details?: Array<{ path?: string; reason?: string }>;
    retryable: boolean;
  };
  meta: ApiMeta;
}
```

列表统一为 `data.items`，从 `meta.pagination.nextCursor` 加载下一页。默认 `limit=20`，最大 100；前端不得实现页码或解析游标。`204 No Content` 不调用 `response.json()`。

### 3.4 并发冲突

- 收到 `412 VERSION_CONFLICT`：重新 GET 最新资源，提示用户内容已变化，再决定是否重放编辑。
- 收到 `409 IDEMPOTENCY_CONFLICT`：不得生成新键自动重提；应提示请求冲突并记录 `meta.requestId`。
- 收到 `409 RUN_ALREADY_ACTIVE`：读取会话或分析状态并恢复已有流，不重复创建任务。
- 收到 `429 RATE_LIMITED`：按响应提示退避，避免立即循环重试。

## 4. 前端异步任务模型

查数、产物生成、分支候选、资产刷新和搜索等长操作统一复用分析任务，不建立第二套 Job 轮询协议。

```text
用户操作
  -> POST 创建资源或分析
  -> 202 { resourceId?, analysis/id, streamUrl }
  -> GET streamUrl 接收 SSE
  -> 终态事件到达
  -> GET 对应结果资源刷新页面
```

前端至少保存 `analysisId`、`streamUrl` 和关联的 `resourceId`。SSE 断开不会取消任务，可通过事件 ID 重连；页面恢复时也可先调用 `GET /analyses/:analysisId` 获取权威状态。

终态包括：`COMPLETED`、`BLOCKED`、`FAILED`、`CANCELLED`、`INTERRUPTED`。`WAITING_FOR_USER` 不是终态，应展示追问表单。

## 5. 启动与首页

| 级别 | 方法与路径 | 前端用途 | 主要展示字段 |
| --- | --- | --- | --- |
| 核心 | `GET /api/v1/demo/bootstrap` | 首屏一次获取 Demo 摘要 | `user`、`profile`、`goals`、`holdings`、`latestConversation`、`latestRecommendation` |
| 可选 | `POST /api/v1/demo/reset` | “重置演示数据”按钮 | `resetId`、`cancelledAnalysisIds`、`bootstrap` |
| 可选 | `GET /api/v1/health` | 启动页/诊断页显示服务状态 | `status`、脱敏后的 `checks` |

`bootstrap.goals.items` 和 `bootstrap.holdings.items` 只包含前 5 项，必须用对应列表接口加载完整数据。`latestConversation` 和 `latestRecommendation` 只用于卡片摘要，点击后读取详情。

健康状态展示规则：

| `status` | HTTP | 前端建议 |
| --- | --- | --- |
| `READY` | 200 | 正常进入应用 |
| `DEGRADED` | 200 | 显示降级横幅，部分模型/行情功能可能不可用 |
| `NOT_READY` | 503 | 显示不可用页和重试按钮 |

## 6. 画像、目标、标的与持仓

### 6.1 画像与风险测评

| 级别 | 方法与路径 | 前端用途 | 关键字段/要求 |
| --- | --- | --- | --- |
| 页面 | `GET /api/v1/profile` | 画像页和风险摘要 | `status`、资金字段、风险字段、偏好、`tags`、`version` |
| 页面 | `PATCH /api/v1/profile` | 保存画像草稿 | `If-Match`；返回新 `version` |
| 页面 | `GET /api/v1/risk-questionnaire` | 动态渲染情景题 | `version`、`questions[].type/prompt/options` |
| 页面 | `POST /api/v1/risk-assessments` | 提交风险问卷 | 结果风险等级、建议仓位上限、`conflicts` |
| 页面 | `POST /api/v1/profile/complete` | 完成画像 | `status=COMPLETE`、`effectiveRiskLevel`、`version` |

风险枚举：

```ts
type RiskLevel = "CONSERVATIVE" | "BALANCED" | "AGGRESSIVE";
type RiskCapacity = "LOW" | "MEDIUM" | "HIGH";
type Horizon = "SHORT" | "MEDIUM" | "LONG";
```

前端应同时展示主观风险偏好、客观风险承受力和最终 `effectiveRiskLevel`。`conflicts` 是需要显著展示的风险解释，不是表单错误。

### 6.2 投资目标

| 级别 | 方法与路径 | 前端用途 | 关键字段/要求 |
| --- | --- | --- | --- |
| 页面 | `GET /api/v1/goals?status=&limit=&cursor=` | 目标列表 | 金额、期限、日期、优先级、偏好、状态、`version` |
| 页面 | `POST /api/v1/goals` | 创建目标 | 返回 `id/status/version` |
| 页面 | `PATCH /api/v1/goals/:goalId` | 编辑目标 | `If-Match` |
| 页面 | `DELETE /api/v1/goals/:goalId` | 删除目标 | 成功 204 |

### 6.3 标的与持仓

| 级别 | 方法与路径 | 前端用途 | 关键字段/要求 |
| --- | --- | --- | --- |
| 页面 | `GET /api/v1/instruments/search?q=&market=&assetType=&limit=` | 标的选择器 | 必须显示 `symbol/name/market/assetType/tradable` |
| 页面 | `GET /api/v1/instruments/:instrumentId` | 标的详情 | 别名、市场、类型、行业/板块、数据时间、分析维度 |
| 核心 | `GET /api/v1/holdings?includeValuation=true&limit=&cursor=` | 持仓列表 | 数量、成本、目标、估值、收益、行情时间、`version` |
| 页面 | `POST /api/v1/holdings` | 手工录入持仓 | 金额和数量使用字符串 |
| 页面 | `POST /api/v1/holdings/parse` | 自然语言解析持仓 | `parseId/status/candidates/issues/suggestedMatches` |
| 页面 | `POST /api/v1/holdings/parse/:parseId/confirm` | 确认歧义并创建持仓 | 需要 `Idempotency-Key` |
| 页面 | `PATCH /api/v1/holdings/:holdingId` | 编辑持仓 | `If-Match` |
| 页面 | `DELETE /api/v1/holdings/:holdingId` | 删除持仓 | 成功 204 |

`tradable=false` 的指数只能分析或作为基准，前端必须禁用“创建持仓”。当持仓列表因行情不可用而失败时，可降级请求 `includeValuation=false` 展示静态持仓。

## 7. 对话、消息与输出模式

### 7.1 会话接口

| 级别 | 方法与路径 | 前端用途 | 主要字段/要求 |
| --- | --- | --- | --- |
| 核心 | `GET /api/v1/conversations?status=&limit=&cursor=` | 会话侧栏 | `title/status/lastMessagePreview/lastMessageAt/version` |
| 核心 | `POST /api/v1/conversations` | 新建会话 | `title`、`mode=ADVISORY` |
| 核心 | `GET /api/v1/conversations/:conversationId` | 恢复会话状态 | `pendingClarificationCount/activeAnalysisId/version` |
| 页面 | `PATCH /api/v1/conversations/:conversationId` | 改名或归档 | `If-Match`；活动任务期间可能冲突 |
| 核心 | `GET /api/v1/conversations/:conversationId/messages?limit=&cursor=` | 消息历史 | 消息正文、角色、类型、追问和产物 |
| 核心 | `POST /api/v1/conversations/:conversationId/messages` | 发送消息并启动 Agent | `Idempotency-Key`；返回分析和 `streamUrl` |
| 页面 | `GET /api/v1/conversations/:conversationId/output-preference` | 获取输出偏好 | `configuredMode/effectiveMode/version` |
| 页面 | `PUT /api/v1/conversations/:conversationId/output-preference` | 设置默认输出模式 | 后续更新需 `If-Match` |
| 页面 | `DELETE /api/v1/conversations/:conversationId/output-preference` | 恢复默认 `SQL_ONLY` | 需 `If-Match`，成功 204 |

发送消息请求：

```json
{
  "clientMessageId": "client_msg_01",
  "content": "比较我的股票和基金持仓回撤，并画图",
  "responseMode": "STREAM",
  "outputMode": "CHART"
}
```

`outputMode`：

```ts
type OutputMode = "SQL_ONLY" | "CHART" | "FINANCIAL_REPORT";
```

缺省时使用会话偏好，再缺省时为 `SQL_ONLY`。响应为 202：

```json
{
  "data": {
    "userMessage": {
      "id": "msg_10",
      "role": "USER",
      "content": "比较我的股票和基金持仓回撤，并画图"
    },
    "analysis": {
      "id": "analysis_10",
      "type": "DATA_QUERY",
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

完成后的 Assistant 消息可包含：

```ts
interface MessageArtifact {
  id: string;
  type: "ECHARTS_OPTION" | "MARKDOWN";
  title: string;
  previewUrl: string;
}

interface ConversationMessage {
  id: string;
  role: "USER" | "ASSISTANT";
  kind: string;
  content: string;
  clarificationId?: string;
  artifacts?: MessageArtifact[];
  availableActions?: Array<"GENERATE_CHART" | "GENERATE_FINANCIAL_REPORT">;
  createdAt: string;
}
```

### 7.2 主动追问

| 级别 | 方法与路径 | 前端用途 | 主要字段/要求 |
| --- | --- | --- | --- |
| 核心 | `GET /api/v1/conversations/:conversationId/clarifications?status=PENDING` | 恢复待填写表单 | `prompt/blocking/fields/status` |
| 核心 | `POST /api/v1/conversations/:conversationId/clarifications/:clarificationId/answer` | 回答并恢复分析 | `Idempotency-Key`；返回原分析和 `streamUrl` |

前端根据 `fields[].type` 动态渲染 `SINGLE_CHOICE`、`MONEY`、`RATIO` 和 `BOOLEAN`。`blocking=true` 时应阻止继续发送依赖该分析的新问题，但不必冻结整个应用。

## 8. 分析任务与 SSE

### 8.1 分析接口

| 级别 | 方法与路径 | 前端用途 | 主要字段/要求 |
| --- | --- | --- | --- |
| 页面 | `POST /api/v1/analyses` | 页面按钮直接发起个股/组合诊断或适配筛选 | `Idempotency-Key`；返回 202 |
| 核心 | `GET /api/v1/analyses/:analysisId` | 恢复、轮询兜底和终态结果 | `status/stage/progress/result/failure/compliance` |
| 核心 | `POST /api/v1/analyses/:analysisId/cancel` | 取消当前分析 | 已终态返回 409 |
| 核心 | `POST /api/v1/analyses/:analysisId/retry` | 重试失败或中断任务 | `Idempotency-Key`；创建新分析 ID |
| 核心 | `GET /api/v1/analyses/:analysisId/events` | 实时进度和增量消息 | SSE，可用事件 ID 重连 |
| 页面 | `GET /api/v1/analyses/:analysisId/evidence-pack?includeToolPayload=false` | Evidence Lab | 证据、Agent 摘要、工具摘要、合规结果 |

```ts
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

### 8.2 SSE 公共结构

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

核心事件：

| event | 前端动作 |
| --- | --- |
| `run.started` | 创建运行中状态 |
| `stage.changed` | 更新阶段文案和进度条 |
| `supervisor.plan` | 展示可审计的计划摘要 |
| `agent.started` / `agent.completed` | 更新 Agent 步骤列表 |
| `tool.started` / `tool.completed` / `tool.failed` | 更新工具步骤，不展示原始凭证或完整响应 |
| `evidence.added` | Evidence Lab 增量追加证据摘要 |
| `clarification.required` | 拉取追问接口并展示表单 |
| `recommendation.created` | 获取建议卡 |
| `message.delta` | 按 `messageId` 拼接 Assistant 文本 |
| `message.completed` | 标记消息流输出完成 |
| `run.completed` | 关闭流并获取最终结果资源 |
| `run.blocked` | 展示合规/风险阻断原因 |
| `run.failed` | 根据 `retryable` 展示重试按钮 |
| `run.cancelled` | 标记任务已取消 |
| `heartbeat` | 保活，不写入 UI 时间线 |

扩展事件：

| event | payload 关键字段 | 前端动作 |
| --- | --- | --- |
| `query.planned` | `queryId/datasets/columns` | 展示查询计划 |
| `query.validated` | `queryId/safetyChecks` | 展示安全校验完成 |
| `query.completed` | `queryId/rowCount/truncated` | 拉取查询结果 |
| `artifact.completed` | `artifactId/type` | 拉取安全预览 |
| `branch.options.created` | `workspaceId/branchId/optionIds` | 拉取候选方案 |
| `branch.created` | `workspaceId/branchId/simulationId` | 刷新分支树和快照 |
| `search.source.completed` | `searchId/adapter/resultCount` | 更新分来源进度 |
| `portfolio.refreshed` | `portfolioSnapshotId` | 用同一快照 ID 刷新持仓与指标 |
| `rss.synced` | `feedId/newCount/updatedCount` | 仅管理端消费，普通前端忽略 |

浏览器原生 `EventSource` 不能自定义普通请求头。使用同源 Cookie 时可直接连接，并依赖浏览器携带最后事件 ID 自动重连；如前端必须显式设置 `Last-Event-ID`，应使用基于 `fetch` 的 SSE 客户端。

## 9. 建议、模拟、证据与决策

| 级别 | 方法与路径 | 前端用途 | 主要展示字段 |
| --- | --- | --- | --- |
| 核心 | `GET /api/v1/recommendations?action=&status=&limit=&cursor=` | 建议列表/首页摘要 | 动作、标的、摘要、适合度、置信度、有效期、状态 |
| 核心 | `GET /api/v1/recommendations/:recommendationId` | 完整建议卡 | 仓位计划、价格区间、条件、正反证据、风险、替代方案、指标、合规声明 |
| 页面 | `POST /api/v1/recommendations/:recommendationId/simulations` | 创建建议模拟 | `Idempotency-Key`；返回 before/after、目标影响和声明 |
| 页面 | `GET /api/v1/simulations/:simulationId` | 模拟对比页 | `proposed/noAction`、风险损失、行业权重 |
| 页面 | `POST /api/v1/recommendations/:recommendationId/decisions` | 记录模拟采纳、拒绝或稍后处理 | `Idempotency-Key`；永远不会创建真实订单 |
| 页面 | `GET /api/v1/analyses/:analysisId/evidence-pack` | Evidence Lab | 新鲜度、正反证据、Agent/工具轨迹、合规结果、缺失证据 |
| 页面 | `GET /api/v1/decisions?action=&limit=&cursor=` | 决策日志列表 | 建议 ID、动作、原因、备注、时间 |
| 页面 | `GET /api/v1/decisions/:decisionId` | 决策快照详情 | 建议和模拟快照、动作、原因、`ordersCreated=false` |

建议动作：

```ts
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
```

前端显示约束：

- `confidence` 表示证据完整性与一致性，不得文案化为“上涨概率”。
- `dataAsOf`、`validUntil` 和 `compliance.disclaimer` 必须在完整建议卡可见。
- `DEGRADED/BLOCKED` 必须显示原因，不能渲染为可执行交易按钮。
- 模拟采纳按钮应明确写“记录模拟方案”，不得写“一键买入/卖出”。
- 所有模拟和决策响应中的 `ordersCreated` 必须为 `false`。

## 10. 智能查数与生成产物

### 10.1 智能查数

| 级别 | 方法与路径 | 前端用途 | 主要展示字段 |
| --- | --- | --- | --- |
| 页面 | `POST /api/v1/data-queries` | 从查数页或消息操作创建查询 | 返回 `resourceId` 和分析流 |
| 页面 | `GET /api/v1/data-queries?conversationId=&status=&limit=&cursor=` | 查询历史 | 问题、状态、模式、行数、截断、数据日期、分析 ID |
| 页面 | `GET /api/v1/data-queries/:queryId` | 查询详情/审计抽屉 | `plan/sql/result/sources/failure` |
| 页面 | `GET /api/v1/data-queries/:queryId/result?limit=&cursor=` | 动态结果表格 | `columns/items/rowCount/truncated/dataAsOf` |

结果列由服务端元数据驱动：

```ts
interface QueryColumn {
  key: string;
  label: string;
  type: "STRING" | "NUMBER" | "DECIMAL" | "RATIO" | "DATE" | "DATETIME" | string;
  unit: string | null;
  sensitivity: "PUBLIC" | "USER_PRIVATE" | string;
}

interface QueryRow {
  rowId: string;
  values: Record<string, unknown>;
}
```

前端使用 `columns[].key` 读取 `values`，使用 `label/type/unit` 决定表头和格式，不能假定固定列。`truncated=true` 时必须提示结果已截断。生成未完成时收到 `QUERY_RESULT_NOT_READY`，结果过期时收到 `QUERY_RESULT_EXPIRED`。

`sql.statement` 只用于用户主动展开的审计视图，不应默认占据主结果区域；服务端已经限定为授权范围内的只读 SQL。

### 10.2 图表和报告产物

| 级别 | 方法与路径 | 前端用途 | 主要展示字段/要求 |
| --- | --- | --- | --- |
| 页面 | `POST /api/v1/generated-artifacts` | 生成图表或 Markdown 报告 | 来源至少包含 `messageId` 或 `dataQueryId` |
| 页面 | `GET /api/v1/generated-artifacts?conversationId=&messageId=&type=&status=&limit=&cursor=` | 产物列表 | 类型、标题、状态、版本、来源、预览 URL、时间 |
| 页面 | `GET /api/v1/generated-artifacts/:artifactId` | 产物详情/失败状态 | 来源摘要、溯源、失败摘要 |
| 页面 | `GET /api/v1/generated-artifacts/:artifactId/preview` | 安全预览 | Markdown 的 `sanitizedHtml` 或白名单 ECharts `option` |
| 页面 | `PATCH /api/v1/generated-artifacts/:artifactId` | 编辑已就绪产物 | `If-Match`；只允许 `READY` |
| 页面 | `DELETE /api/v1/generated-artifacts/:artifactId` | 软删除产物 | `If-Match`，成功 204 |

```ts
type GeneratedArtifactType = "ECHARTS_OPTION" | "MARKDOWN";
type GeneratedArtifactStatus = "GENERATING" | "READY" | "FAILED" | "DELETED";
```

安全渲染规则：

- Markdown 优先渲染服务端返回的 `sanitizedHtml`，不要直接把 `markdown` 注入 `innerHTML`。
- ECharts 只消费预览接口返回的 JSON `option`，禁止执行函数字符串、脚本或自定义 HTML。
- `contentSha256` 可用于前端缓存校验，不能代替权限检查。
- `ARTIFACT_NOT_READY` 时显示生成中并继续监听对应 analysis，不做高频轮询。

## 11. 资产分析与分支模拟

### 11.1 静态资产分析

| 级别 | 方法与路径 | 前端用途 | 主要展示字段 |
| --- | --- | --- | --- |
| 页面 | `GET /api/v1/portfolio-analysis/holdings?accountId=&portfolioSnapshotId=` | 资产分析持仓表 | 汇总、价格、权重、盈亏、回撤、数据质量和日期 |
| 页面 | `GET /api/v1/portfolio-analysis/metrics?portfolioSnapshotId=` | 评分和风险指标 | 健康/风险分、指标、组件、缺失指标、日期 |
| 页面 | `POST /api/v1/portfolio-analysis/refresh` | 用户主动刷新数据 | 返回 `PORTFOLIO_REFRESH` 分析流 |
| 可选 | `GET /api/v1/portfolio-analysis/trends?portfolioSnapshotId=&metric=&points=` | 演示趋势图 | 必须展示 `source=MOCK` 和免责声明 |

刷新成功后，从 `portfolio.refreshed` 取得 `portfolioSnapshotId`，随后 holdings 与 metrics 必须使用同一快照 ID，避免同屏数据跨时点。

### 11.2 A/B/C 分支模拟

| 级别 | 方法与路径 | 前端用途 | 主要字段/要求 |
| --- | --- | --- | --- |
| 页面 | `POST /api/v1/simulation-workspaces` | 创建分支工作区 | `Idempotency-Key`；返回根/活动分支和版本 |
| 页面 | `GET /api/v1/simulation-workspaces?status=&conversationId=&limit=&cursor=` | 工作区列表 | 摘要、状态、分支数和版本 |
| 页面 | `GET /api/v1/simulation-workspaces/:workspaceId` | 恢复工作区 | 根/活动分支、来源快照、建议、版本 |
| 页面 | `PATCH /api/v1/simulation-workspaces/:workspaceId` | 改名或归档 | `If-Match` |
| 页面 | `GET /api/v1/simulation-workspaces/:workspaceId/tree` | 分支树与操作历史 | `branches/events/activeBranchId/version` |
| 页面 | `POST /api/v1/simulation-workspaces/:workspaceId/options` | 生成 2 至 5 个候选 | `Idempotency-Key`；异步分析流 |
| 页面 | `GET /api/v1/simulation-workspaces/:workspaceId/options?fromBranchId=&batchId=` | 展示 A/B/C 候选 | 引擎参数、价格清单、候选动作和模拟交易 |
| 页面 | `POST /api/v1/simulation-workspaces/:workspaceId/branches` | 执行候选并派生分支 | `Idempotency-Key`；同步返回 201 |
| 页面 | `PATCH /api/v1/simulation-workspaces/:workspaceId/active-branch` | 切换历史分支 | `If-Match` |
| 页面 | `POST /api/v1/simulation-workspaces/:workspaceId/undo` | 指针撤回到父分支 | `Idempotency-Key` 和 `If-Match` |
| 页面 | `GET /api/v1/simulation-workspaces/:workspaceId/branches/:branchId/snapshot` | 分支资产对比 | 现金、总值、盈亏、持仓、指标和数据日期 |

切换和撤回只移动活动指针，不删除历史，也不更新真实持仓。所有分支执行结果必须展示 `ordersCreated=false`。

## 12. 搜索、自选、观察条件、通知与 RSS

### 12.1 研究搜索（P1）

| 级别 | 方法与路径 | 前端用途 | 主要展示字段 |
| --- | --- | --- | --- |
| 可选 | `POST /api/v1/research-searches` | 发起多来源搜索 | 查询、适配器、过滤条件、最大结果数；返回分析流 |
| 可选 | `GET /api/v1/research-searches?conversationId=&analysisId=&status=&limit=&cursor=` | 搜索历史 | 状态、来源和结果数摘要 |
| 可选 | `GET /api/v1/research-searches/:searchId` | 搜索状态 | `sourceStatuses/failure/analysisId` |
| 可选 | `GET /api/v1/research-searches/:searchId/results?adapter=&limit=&cursor=` | 搜索结果与引用 | 标题、净化摘要、链接、来源、时间、可信度、引用 |

部分来源失败时接口仍返回 200。前端应按 `sourceStatuses` 分来源展示成功/失败，不能把未验证外部来源包装为系统事实。

### 12.2 自选列表（P0）

| 级别 | 方法与路径 | 前端用途 |
| --- | --- | --- |
| 页面 | `POST /api/v1/watchlists` | 创建自选列表 |
| 页面 | `GET /api/v1/watchlists?limit=&cursor=` | 自选列表 |
| 页面 | `GET /api/v1/watchlists/:watchlistId` | 自选详情和聚合计数 |
| 页面 | `PATCH /api/v1/watchlists/:watchlistId` | 改名/描述，需 `If-Match` |
| 页面 | `DELETE /api/v1/watchlists/:watchlistId` | 软删除，需 `If-Match` |
| 页面 | `POST /api/v1/watchlists/:watchlistId/items` | 添加标的，需 `Idempotency-Key` |
| 页面 | `GET /api/v1/watchlists/:watchlistId/items?limit=&cursor=` | 条目和估值/风险/持仓/建议/提醒聚合 |
| 页面 | `PATCH /api/v1/watchlist-items/:itemId` | 修改原因、期限、目标，需 `If-Match` |
| 页面 | `DELETE /api/v1/watchlist-items/:itemId` | 软删除条目 |

### 12.3 观察条件

| 级别 | 方法与路径 | 前端用途 |
| --- | --- | --- |
| 页面 | `GET /api/v1/observation-conditions?status=&limit=&cursor=` | 提醒条件列表 |
| 页面 | `POST /api/v1/observation-conditions` | 创建价格、回撤、浮盈、估值、事件等条件 |
| 页面 | `PATCH /api/v1/observation-conditions/:conditionId` | 修改阈值、严重度或状态，需 `If-Match` |
| 页面 | `DELETE /api/v1/observation-conditions/:conditionId` | 删除条件 |
| 页面 | `POST /api/v1/observation-conditions/evaluate` | 用户点击“重新检查”，需 `Idempotency-Key` |

支持的展示类型至少包括：`PRICE_ENTER_ZONE`、`DRAWDOWN_REACH`、`UNREALIZED_GAIN_REACH`、`PE_PERCENTILE_BELOW`、`MACD_CONFIRMATION`、`EVENT_RISK`、`POSITION_WEIGHT_ABOVE`、`THESIS_INVALIDATED`、`REVIEW_DATE`。

### 12.4 通知中心

| 级别 | 方法与路径 | 前端用途 | 主要展示字段/要求 |
| --- | --- | --- | --- |
| 页面 | `GET /api/v1/notifications?unreadOnly=&severity=&limit=&cursor=` | 通知中心和未读数 | 严重度、标题、正文、聚合次数、动作、已读/忽略时间、版本 |
| 页面 | `PATCH /api/v1/notifications/:notificationId` | `MARK_READ` 或 `IGNORE` | `If-Match`；不能恢复未读 |
| 页面 | `GET /api/v1/notification-preference` | 获取通知偏好 | 未设置返回 `IMPORTANT_ONLY/version=0` |
| 页面 | `PUT /api/v1/notification-preference` | 保存通知偏好 | 后续修改需 `If-Match` |

通知严重度为 `INFORMATION/ATTENTION/IMPORTANT/URGENT`，偏好为 `IMPORTANT_ONLY/DAILY_DIGEST/MUTED`。MVP 的 `DAILY_DIGEST` 只影响提醒中心聚合，不实际外发。

### 12.5 RSS 阅读（P2）

| 级别 | 方法与路径 | 前端用途 | 主要展示字段 |
| --- | --- | --- | --- |
| 可选 | `GET /api/v1/rss/feeds?enabled=true&limit=&cursor=` | 来源筛选 | 名称、站点 URL、状态、最后同步时间 |
| 可选 | `GET /api/v1/rss/items?feedId=&instrumentId=&q=&publishedAfter=&limit=&cursor=` | 资讯列表 | 标题、摘要、规范链接、发布时间、来源 |

普通前端只读取 RSS，不调用管理和同步接口。

## 13. 页面与接口最小映射

| 页面/组件 | 首次加载 | 用户动作 | 实时/后续加载 |
| --- | --- | --- | --- |
| 应用首页 | `GET /demo/bootstrap` | 重置 Demo、进入最近会话/建议 | 按需加载完整持仓、建议、通知 |
| 对话页 | 会话详情、消息、输出偏好 | 发消息、回答追问、取消/重试 | SSE；完成后刷新消息、建议或产物 |
| 画像页 | profile、risk-questionnaire | 保存草稿、提交测评、完成画像 | 重新 GET profile 校验最终状态 |
| 持仓页 | holdings | 新建、解析确认、编辑、删除、重新检查 | portfolio refresh SSE；刷新分析快照 |
| 建议页 | recommendation detail | 创建模拟、记录决策、创建观察条件 | evidence-pack、simulation detail |
| 查数页 | data-query list/detail | 创建查询、生成产物 | 查询 SSE；结果表或安全预览 |
| 分支模拟页 | workspace detail/tree | 生成候选、执行、切换、撤回 | 候选 SSE；刷新 tree 和 snapshot |
| 自选页 | watchlists/items | CRUD、创建提醒 | 聚合建议和提醒字段 |
| 通知中心 | notifications、preference | 已读、忽略、修改偏好 | 按游标加载更多 |

## 14. 前端错误展示建议

| HTTP/code | 前端处理 |
| --- | --- |
| `401 UNAUTHENTICATED` | 清理本地用户态并进入 Demo 会话初始化/登录兜底 |
| `403 FORBIDDEN` | 提示权限或请求校验失败，不展示资源是否存在 |
| `404 RESOURCE_NOT_FOUND` | 展示资源不存在或已删除，不区分“无权访问” |
| `409 RUN_ALREADY_ACTIVE` | 恢复已有任务，不创建第二个任务 |
| `409 *_NOT_READY` | 保持加载态并监听对应 SSE |
| `409 IDEMPOTENCY_CONFLICT` | 阻止自动重提，显示冲突提示 |
| `410 *_EXPIRED` | 显示结果已过期并引导重新生成 |
| `412 VERSION_CONFLICT` | 重新读取资源后让用户确认编辑 |
| `422 VALIDATION_ERROR` | 使用 `details[].path/reason` 映射表单字段 |
| `422 PROFILE_INCOMPLETE` | 引导完成画像 |
| `422 STALE_MARKET_DATA` / `METRIC_DATA_STALE` | 展示数据时间和刷新入口，不展示明确买卖建议 |
| `422 COMPLIANCE_BLOCKED` | 展示阻断说明，不提供交易式按钮 |
| `429 RATE_LIMITED` | 禁用重复提交并退避 |
| `502/503` 且 `retryable=true` | 展示重试；保留已生成的安全摘要和任务 ID |
| `503 ANALYSIS_INTERRUPTED` | 提供“重新分析”，调用 retry 创建新 run |

所有全局错误日志至少记录 `error.code` 和 `meta.requestId`，不得记录 Cookie、CSRF Token、消息中的隐私字段或未净化的工具响应。

## 15. 不向普通前端暴露的接口与字段

### 15.1 接口

| 接口 | 原因 |
| --- | --- |
| `POST/PATCH/DELETE /api/v1/admin/rss/feeds[/:id]` | 本地管理员源管理 |
| `POST /api/v1/admin/rss/feeds/:feedId/sync` | 管理员运维操作；普通前端只读同步后的内容 |
| 内部 PandaData/DeepSeek/MCP/Skill 调用 | 服务端适配层，包含权限、版本和数据治理逻辑 |
| 数据库、迁移、幂等记录和内部运维会话接口 | 没有用户展示价值且可能泄漏实现细节 |

### 15.2 字段与内容

- Cookie 值、CSRF Token 值、API Key、数据库连接信息和文件路径。
- 原始 Prompt、隐藏思维链、模型内部推理和完整供应商错误。
- 未净化外部正文；搜索和 RSS 只展示服务端返回的净化摘要、有限摘录和规范 URL。
- `includeToolPayload=true` 不作为普通 UI 默认选项；即使启用，也只能接收服务端脱敏白名单字段。
- SSE 和 Evidence Lab 中只展示 `label/summary/purpose` 等可审计摘要。

## 16. 联调前必须确认的契约缺口

以下内容在两份源文档中尚未形成完整的浏览器契约，前端不应自行假设：

1. **CSRF Token 获取方式**：所有修改请求要求 `X-CSRF-Token`，但 `GET /demo/bootstrap` 响应没有 token，源文档也未定义独立 token 接口或可读 Cookie。后端需明确由响应头、非 HttpOnly Cookie、HTML meta 还是 bootstrap 字段提供。
2. **分析引用字段命名**：基础响应使用 `analysis.id`，扩展运行对象使用 `analysis.analysisId`。建议 wire 层统一为 `analysis.id`，或在 OpenAPI/Zod 契约中确认单一名称后再生成前端类型。
3. **直接分析入口范围**：`POST /analyses` 只列出基础诊断类型，扩展长任务应通过各自资源创建接口触发，前端不要直接提交扩展 `AnalysisType`，除非后端另行确认。
4. **SSE 浏览器鉴权与重连**：需确认部署保持同源 Cookie，以及服务端支持浏览器自动发送的 `Last-Event-ID`。跨源场景需明确 CORS 和 `withCredentials` 策略。
5. **DELETE 的版本要求一致性**：扩展资源 DELETE 明确要求 `If-Match`，基础目标/持仓/观察条件 DELETE 未统一要求。前端应以各接口表述为准，后端最好在实现前统一。
6. **前端枚举中文文案**：wire enum 已确定，但产品文案未形成共享字典。建议由前端维护显式映射并为未知枚举提供兜底，不直接显示 `UPPER_SNAKE_CASE`。

在上述问题确认前，可以完成只读页面、数据结构和 Mock 联调；涉及写请求和可靠 SSE 重连的端到端验收需要后端补齐契约。

## 17. 前端验收清单

- [ ] 所有请求使用 `/api/v1`，请求体不包含 `userId`。
- [ ] 修改请求携带 CSRF Token；幂等 POST 在网络重试时复用同一键。
- [ ] 编辑请求发送当前 `version` 对应的 `If-Match`。
- [ ] 金额、价格和数量保持字符串，比例按 `0.15 = 15%` 展示。
- [ ] 列表使用游标，空集合展示空状态而非错误。
- [ ] 对话页可从 `activeAnalysisId` 恢复任务，并处理 SSE 断线重连。
- [ ] `WAITING_FOR_USER` 展示追问表单，所有终态正确停止加载。
- [ ] Markdown 只渲染 `sanitizedHtml`，ECharts 只消费白名单 `option`。
- [ ] 建议显示数据日期、有效期、正反证据、风险和合规声明。
- [ ] 假趋势显著标注 `MOCK`，模拟操作显著标注不产生真实订单。
- [ ] 404 不区分资源不存在和无权访问，避免资源枚举。
- [ ] 日志不记录 Cookie、CSRF Token、密钥、隐私正文或原始工具响应。
