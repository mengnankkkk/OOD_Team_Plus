# Money Whisperer 对话 Agent 扩展 REST API 设计

> 版本：`v1 / 扩展 2.0`  
> 日期：`2026-07-23`  
> 状态：可进入实现计划  
> 性质：对[队友 API 设计](./docs/superpowers/specs/2026-07-23-conversation-agent-api-design.md)的增量契约

## 1. 继承的公共约定

本文不建立第二套公共协议。所有端点无条件继承队友 API 第 4、12、13、20 至 24 节：

- 基础路径 `/api/v1`；JSON `camelCase`；SQLite `snake_case`。
- 身份来自签名 HttpOnly Cookie `mw_demo_session`；客户端不得提交 `userId`。
- 所有修改请求验证同源和 `X-CSRF-Token`。
- 金额、价格、数量使用十进制字符串；比例使用 JSON number，`0.15` 表示 15%。
- 成功包络为 `{data,meta}`，`meta` 必含 `requestId/apiVersion/generatedAt`。
- 列表使用 `data.items` 和 `meta.pagination`；游标为 base64url `(createdAt,id)`，默认 20、最大 100。
- 错误包络为 `{error:{code,message,details,retryable},meta}`。
- `PATCH` 使用 `If-Match: "<version>"`；冲突返回 `412 VERSION_CONFLICT`。
- 标记为幂等的 `POST` 必须携带 `Idempotency-Key`；同键同请求重放首个响应，同键异请求返回 `409 IDEMPOTENCY_CONFLICT`。
- 不存在和无权访问均返回 `404 RESOURCE_NOT_FOUND`，避免资源枚举。

修改请求公共头：

```http
Cookie: mw_demo_session=<signed-value>
X-CSRF-Token: <demo-csrf-token>
Idempotency-Key: <required-on-marked-post>
Content-Type: application/json
```

分页成功示例：

```json
{
  "data": { "items": [] },
  "meta": {
    "requestId": "req_01",
    "apiVersion": "v1",
    "generatedAt": "2026-07-23T10:00:00.000Z",
    "pagination": { "limit": 20, "nextCursor": null, "hasMore": false }
  }
}
```

## 2. 公共扩展对象

### 2.1 枚举

```ts
type OutputMode = "SQL_ONLY" | "CHART" | "FINANCIAL_REPORT";
type GeneratedArtifactType = "ECHARTS_OPTION" | "MARKDOWN";
type GeneratedArtifactStatus = "GENERATING" | "READY" | "FAILED" | "DELETED";

type ExtensionAnalysisType =
  | "DATA_QUERY"
  | "ARTIFACT_GENERATION"
  | "BRANCH_OPTION_GENERATION"
  | "PORTFOLIO_REFRESH"
  | "RESEARCH_SEARCH"
  | "RSS_SYNC";

type AnalysisStatus =
  | "QUEUED" | "RUNNING" | "WAITING_FOR_USER" | "COMPLETED"
  | "BLOCKED" | "FAILED" | "CANCELLED" | "INTERRUPTED";

type QueryStatus = "QUEUED" | "RUNNING" | "COMPLETED" | "FAILED" | "CANCELLED" | "INTERRUPTED";
type WorkspaceStatus = "ACTIVE" | "ARCHIVED";
type BranchEventType = "ROOT_CREATED" | "OPTION_EXECUTED" | "BRANCH_SWITCHED" | "UNDO";
type SearchAdapter = "WEB" | "MCP" | "KNOWLEDGE_BASE" | "RSS";
type SourceStatus = "SUCCEEDED" | "FAILED" | "SKIPPED";
type NotificationSeverity = "INFORMATION" | "ATTENTION" | "IMPORTANT" | "URGENT";
type NotificationPreference = "IMPORTANT_ONLY" | "DAILY_DIGEST" | "MUTED";
```

数据库保存小写值，Zod 映射层统一转换；Route Handler 不自行拼接枚举。

### 2.2 扩展运行对象

扩展长操作继续使用队友的 `analyses` API 和根 `agent_runs`，不新增 `/jobs`：

```ts
interface ExtensionRunRef {
  analysisId: string;
  type: ExtensionAnalysisType;
  status: AnalysisStatus;
  streamUrl: string;
}
```

创建长操作统一返回 `202`：

```json
{
  "data": {
    "resourceId": "query_01",
    "analysis": {
      "analysisId": "analysis_query_01",
      "type": "DATA_QUERY",
      "status": "QUEUED",
      "streamUrl": "/api/v1/analyses/analysis_query_01/events"
    }
  },
  "meta": {
    "requestId": "req_query_01",
    "apiVersion": "v1",
    "generatedAt": "2026-07-23T10:00:00.000Z"
  }
}
```

状态读取、取消、重试、SSE 重放统一复用：

- `GET /api/v1/analyses/:analysisId`
- `POST /api/v1/analyses/:analysisId/cancel`
- `POST /api/v1/analyses/:analysisId/retry`
- `GET /api/v1/analyses/:analysisId/events`

`RUNNING` 在进程重启后变为 `INTERRUPTED`；不会自动恢复。取消是协作式的，已终态返回 `409 ANALYSIS_NOT_CANCELLABLE`。重试创建新 run，原资源记录 `retryAnalysisId` 或新资源 ID；相同幂等键只创建一次。

未传 `conversationId` 的查数、资产刷新、搜索和 RSS 同步使用当前用户的内部运维会话创建 run；该会话不出现在普通会话列表，也不会被拼入 Agent 投资对话上下文。

### 2.3 新增 SSE 事件

| event | payload | 说明 |
| --- | --- | --- |
| `query.planned` | `queryId,datasets,columns` | 查询计划完成 |
| `query.validated` | `queryId,safetyChecks` | SQL 安全检查通过 |
| `query.completed` | `queryId,rowCount,truncated` | 查询结果发布 |
| `artifact.completed` | `artifactId,type` | 图表/报告可预览 |
| `branch.options.created` | `workspaceId,branchId,optionIds` | A/B/C 已生成 |
| `branch.created` | `workspaceId,branchId,simulationId` | 新分支已完成 |
| `search.source.completed` | `searchId,adapter,resultCount` | 单来源完成 |
| `portfolio.refreshed` | `portfolioSnapshotId` | 新静态快照发布 |
| `rss.synced` | `feedId,newCount,updatedCount` | RSS 同步完成 |

事件只包含可观察任务信息，不包含隐藏思维链、凭证或完整外部正文。

## 3. Endpoint 总览

| 领域 | 方法与路径 | 用途 |
| --- | --- | --- |
| 对话增量 | `POST /conversations/:id/messages` | 增加可选 `outputMode` |
| 输出偏好 | `GET/PUT/DELETE /conversations/:id/output-preference` | 会话默认模式 |
| 查数 | `POST/GET /data-queries` | 创建/列表 |
| 查数 | `GET /data-queries/:id` | 计划、状态、SQL、来源 |
| 查数 | `GET /data-queries/:id/result` | 结果行和字段元数据 |
| 产物 | `POST/GET /generated-artifacts` | 生成/列表 |
| 产物 | `GET/PATCH/DELETE /generated-artifacts/:id` | 详情/版本修改/软删 |
| 产物 | `GET /generated-artifacts/:id/preview` | 安全预览 |
| 分支 | `POST/GET /simulation-workspaces` | 创建/列表工作区 |
| 分支 | `GET/PATCH /simulation-workspaces/:id` | 详情/归档 |
| 分支 | `GET /simulation-workspaces/:id/tree` | 分支树与历史 |
| 分支 | `POST/GET /simulation-workspaces/:id/options` | 生成/读取候选 |
| 分支 | `POST /simulation-workspaces/:id/branches` | 执行候选并派生分支 |
| 分支 | `PATCH /simulation-workspaces/:id/active-branch` | 切换活动分支 |
| 分支 | `POST /simulation-workspaces/:id/undo` | 撤回到父分支 |
| 分支 | `GET /simulation-workspaces/:id/branches/:branchId/snapshot` | 模拟资产 |
| 静态分析 | `GET /portfolio-analysis/holdings` | 持仓表 |
| 静态分析 | `GET /portfolio-analysis/metrics` | 指标表/评分 |
| 静态分析 | `POST /portfolio-analysis/refresh` | 刷新 run |
| 静态分析 | `GET /portfolio-analysis/trends` | 显式假趋势 |
| 搜索 | `POST/GET /research-searches` | 创建/列表 |
| 搜索 | `GET /research-searches/:id` | 状态与来源 |
| 搜索 | `GET /research-searches/:id/results` | 结果与引用 |
| 自选 | `POST/GET /watchlists` | 创建/列表 |
| 自选 | `GET/PATCH/DELETE /watchlists/:id` | 详情/改名/删除 |
| 自选 | `POST/GET /watchlists/:id/items` | 添加/列表条目 |
| 自选 | `PATCH/DELETE /watchlist-items/:id` | 修改/删除条目 |
| 提醒 | `POST /observation-conditions` | 扩展浮盈类型 |
| 提醒 | `POST /observation-conditions/evaluate` | 复用手动评估 |
| 通知 | `GET /notifications` | 提醒中心 |
| 通知 | `PATCH /notifications/:id` | 已读/忽略 |
| 通知 | `GET/PUT /notification-preference` | 通知偏好 |
| RSS | `GET /rss/feeds`、`GET /rss/items` | 用户读取 |
| RSS | `POST/PATCH/DELETE /admin/rss/feeds[/:id]` | 本地管理员源管理 |
| RSS | `POST /admin/rss/feeds/:id/sync` | 按需同步 |

## 4. 对话输出模式

### 4.1 发送消息增量

队友的 `POST /api/v1/conversations/:conversationId/messages` 请求增加可选字段：

```json
{
  "clientMessageId": "client_msg_sql_01",
  "content": "比较我的股票和基金持仓回撤，并画图",
  "responseMode": "STREAM",
  "outputMode": "CHART"
}
```

`outputMode` 缺失时读取会话偏好，再缺失时使用 `SQL_ONLY`。响应的 `analysis.type` 可为 `DATA_QUERY`；完成后的消息 DTO 增加：

```json
{
  "artifacts": [
    {
      "id": "artifact_chart_01",
      "type": "ECHARTS_OPTION",
      "title": "持仓回撤对比",
      "previewUrl": "/api/v1/generated-artifacts/artifact_chart_01/preview"
    }
  ],
  "availableActions": ["GENERATE_CHART", "GENERATE_FINANCIAL_REPORT"]
}
```

主要错误沿用消息接口，另加 `422 UNSUPPORTED_OUTPUT_MODE`。

### 4.2 会话偏好

#### `GET /api/v1/conversations/:conversationId/output-preference`

响应 `200`；未设置不是 404，而是返回解析后的默认值：

```json
{
  "data": {
    "conversationId": "conv_01",
    "configuredMode": null,
    "effectiveMode": "SQL_ONLY",
    "version": 0
  },
  "meta": {
    "requestId": "req_pref_get",
    "apiVersion": "v1",
    "generatedAt": "2026-07-23T10:01:00.000Z"
  }
}
```

错误：`404 RESOURCE_NOT_FOUND`。

#### `PUT /api/v1/conversations/:conversationId/output-preference`

请求：

```json
{ "outputMode": "FINANCIAL_REPORT" }
```

响应 `200`：`{conversationId,configuredMode,effectiveMode,version}`。首次写入 version 为 1；后续 PUT 必须带 `If-Match`。错误：`404`、`412 VERSION_CONFLICT`、`422 VALIDATION_ERROR`。

#### `DELETE /api/v1/conversations/:conversationId/output-preference`

需要 `If-Match`；成功 `204`，再次删除也返回 `204`。删除后有效模式为 `SQL_ONLY`。错误：`404 RESOURCE_NOT_FOUND`、`412 VERSION_CONFLICT`。

## 5. 智能查数 API

### 5.1 创建查询

`POST /api/v1/data-queries`，必须携带 `Idempotency-Key`。

```json
{
  "conversationId": "conv_01",
  "messageId": "msg_10",
  "question": "比较股票和基金持仓近一年的最大回撤",
  "accountIds": ["account_01"],
  "datasets": ["PORTFOLIO_HOLDINGS", "STOCK_DAILY", "FUND_DAILY"],
  "outputMode": "CHART",
  "requestedLimit": 2000
}
```

Zod 约束：`question` 1..2000 字符；`accountIds` 最多 20 个且去重；`datasets` 1..10 个；`requestedLimit` 1..10000；`conversationId/messageId` 可空但 message 必须属于 conversation。

响应 `202` 使用第 2.2 节运行对象，`resourceId=query_01`。权限：当前会话用户；`accountIds` 必须全部属于当前用户。

错误：

- `404 RESOURCE_NOT_FOUND`：会话、消息或账户不存在/无权。
- `409 IDEMPOTENCY_CONFLICT`。
- `422 DATASET_NOT_ALLOWED`、`QUERY_SCOPE_INVALID`、`VALIDATION_ERROR`。
- `429 RATE_LIMITED`。

### 5.2 查询列表

`GET /api/v1/data-queries?conversationId=conv_01&status=COMPLETED&limit=20&cursor=...`

每项返回 `id/question/status/outputMode/rowCount/truncated/dataAsOf/createdAt/analysisId`。空集合返回 `200` 和 `items=[]`。错误：`422 VALIDATION_ERROR`。

### 5.3 查询详情

`GET /api/v1/data-queries/:queryId`

响应 `200`：

```json
{
  "data": {
    "id": "query_01",
    "question": "比较股票和基金持仓近一年的最大回撤",
    "status": "COMPLETED",
    "analysisId": "analysis_query_01",
    "plan": {
      "datasets": ["PORTFOLIO_HOLDINGS", "STOCK_DAILY", "FUND_DAILY"],
      "dimensions": ["assetName", "assetType"],
      "metrics": ["maxDrawdown"],
      "timeRange": { "start": "2025-07-23", "end": "2026-07-23" }
    },
    "sql": {
      "dialect": "SQLITE",
      "statement": "WITH scoped_holdings AS (...) SELECT ... LIMIT ?",
      "parameterTypes": ["TEXT", "INTEGER"],
      "safetyChecks": ["SINGLE_SELECT", "AUTHORIZED_VIEWS", "SQLITE_AUTHORIZER"]
    },
    "result": { "rowCount": 6, "truncated": false, "expiresAt": "2026-08-22T10:00:00.000Z" },
    "sources": [
      {
        "type": "PANDADATA",
        "method": "get_stock_daily_post",
        "dataAsOf": "2026-07-22",
        "toolCallId": "tool_01",
        "skillRunId": "skill_run_01"
      }
    ],
    "failure": null
  },
  "meta": {
    "requestId": "req_query_get",
    "apiVersion": "v1",
    "generatedAt": "2026-07-23T10:02:00.000Z"
  }
}
```

运行中 `plan/sql/result` 可为 null；失败返回 `failure={code,message,retryable}`，HTTP 仍为 200，因为资源已创建。错误：`404 RESOURCE_NOT_FOUND`。

### 5.4 查询结果

`GET /api/v1/data-queries/:queryId/result?limit=100&cursor=...`

响应 `200`：

```json
{
  "data": {
    "columns": [
      { "key": "assetName", "label": "资产", "type": "STRING", "unit": null, "sensitivity": "PUBLIC" },
      { "key": "maxDrawdown", "label": "最大回撤", "type": "RATIO", "unit": "PERCENT", "sensitivity": "USER_PRIVATE" }
    ],
    "items": [
      { "rowId": "row_0001", "values": { "assetName": "示例科技", "maxDrawdown": -0.184 } }
    ],
    "rowCount": 6,
    "truncated": false,
    "dataAsOf": "2026-07-22"
  },
  "meta": {
    "requestId": "req_result",
    "apiVersion": "v1",
    "generatedAt": "2026-07-23T10:03:00.000Z",
    "pagination": { "limit": 100, "nextCursor": null, "hasMore": false }
  }
}
```

状态非 `COMPLETED` 返回 `409 QUERY_RESULT_NOT_READY`；已过期返回 `410 QUERY_RESULT_EXPIRED`；失败/取消/中断不返回部分行，用户通过 analysis 重试。

### 5.5 查数领域错误

| HTTP | code | 重试 | 含义 |
| --- | --- | --- | --- |
| 422 | `QUERY_REJECTED` | 否 | AST/authorizer 安全拒绝 |
| 422 | `QUERY_TOO_EXPENSIVE` | 否 | 预计扫描或输出超限 |
| 422 | `DATASET_NOT_ALLOWED` | 否 | 未注册数据集 |
| 422 | `FIELD_NOT_ALLOWED` | 否 | 未注册字段或函数 |
| 408 | `QUERY_TIMEOUT` | 是 | 超过 10 秒 |
| 409 | `QUERY_RESULT_NOT_READY` | 是 | 查询未完成 |
| 410 | `QUERY_RESULT_EXPIRED` | 否 | 结果正文已清理 |
| 502 | `PANDADATA_AUTH_FAILED` | 否 | 凭证缺失/无权 |
| 502 | `PANDADATA_UNAVAILABLE` | 是 | 正式数据服务不可用 |
| 502 | `SKILL_CONTRACT_MISMATCH` | 否 | SDK/Skill 契约不一致 |
| 503 | `DATABASE_BUSY` | 是 | SQLite 退避重试耗尽 |

## 6. 生成产物 API

### 6.1 创建生成任务

`POST /api/v1/generated-artifacts`，必须携带 `Idempotency-Key`。

```json
{
  "type": "MARKDOWN",
  "title": "我的持仓财务分析报告",
  "conversationId": "conv_01",
  "source": {
    "messageId": "msg_20",
    "dataQueryId": "query_01"
  }
}
```

至少提供 `messageId` 或 `dataQueryId`；二者同时提供时必须属于同一用户/会话。`type` 只允许 `ECHARTS_OPTION/MARKDOWN`；title 1..120。响应 `202` 返回 `resourceId` 和 `ARTIFACT_GENERATION` run。

错误：`404 RESOURCE_NOT_FOUND`、`409 IDEMPOTENCY_CONFLICT`、`409 QUERY_RESULT_NOT_READY`、`410 QUERY_RESULT_EXPIRED`、`422 VALIDATION_ERROR`、`502 MODEL_UNAVAILABLE`。

### 6.2 列表和详情

- `GET /api/v1/generated-artifacts?conversationId=&messageId=&type=&status=&limit=&cursor=`
- `GET /api/v1/generated-artifacts/:artifactId`

列表项返回 `id/type/title/status/currentVersion/messageId/dataQueryId/previewUrl/createdAt/updatedAt`。详情另返回 `sourceSnapshot={messageDigest,contextDigest,dataAsOf}`、`provenance={analysisId,modelName,algorithmVersion,toolCallIds}` 和失败摘要。软删除资源对普通 GET 返回 404；列表默认排除。

空集合为 `200 items=[]`；主要错误：`404 RESOURCE_NOT_FOUND`、`422 VALIDATION_ERROR`。

### 6.3 安全预览

`GET /api/v1/generated-artifacts/:artifactId/preview`

Markdown 响应：

```json
{
  "data": {
    "id": "artifact_report_01",
    "type": "MARKDOWN",
    "version": 2,
    "markdown": "# 持仓分析\n...",
    "sanitizedHtml": "<h1>持仓分析</h1>...",
    "contentSha256": "sha256:..."
  },
  "meta": {
    "requestId": "req_preview",
    "apiVersion": "v1",
    "generatedAt": "2026-07-23T10:05:00.000Z"
  }
}
```

ECharts 响应将内容放在 `option`，只含 JSON 白名单。生成中返回 `409 ARTIFACT_NOT_READY`；失败返回详情中的 failure，不提供 preview；错误：`404`、`409`。

### 6.4 修改和删除

`PATCH /api/v1/generated-artifacts/:artifactId`，请求头 `If-Match: "2"`：

```json
{
  "title": "更新后的持仓分析",
  "content": "# 更新后的持仓分析\n...",
  "editSummary": "修正文案和表格标题"
}
```

只能编辑 `READY`。Markdown 最多 1 MiB；ECharts Option 最多 512 KiB，必须通过安全 schema。成功 `200` 返回新 `version=3/contentSha256/updatedAt`，并追加版本；同一旧 If-Match 不会重复创建版本。

`DELETE /api/v1/generated-artifacts/:artifactId` 需要 `If-Match`，成功 `204`；再次删除返回 `204`。错误：`404`、`409 ARTIFACT_NOT_EDITABLE`、`412 VERSION_CONFLICT`、`422 ARTIFACT_CONTENT_UNSAFE`。

## 7. 分支模拟 API

### 7.1 创建工作区

`POST /api/v1/simulation-workspaces`，必须携带 `Idempotency-Key`。

```json
{
  "conversationId": "conv_01",
  "recommendationId": "recommendation_20",
  "portfolioSnapshotId": "portfolio_snapshot_20",
  "name": "黄金仓位 A/B/C 模拟"
}
```

`recommendationId` 可空；提供时必须属于用户并与快照兼容。未提供快照时服务端在同一创建流程先冻结当前活动账户，响应使用生成的快照。成功 `201`：

```json
{
  "data": {
    "id": "workspace_01",
    "status": "ACTIVE",
    "portfolioSnapshotId": "portfolio_snapshot_20",
    "rootBranchId": "branch_root",
    "activeBranchId": "branch_root",
    "version": 1
  },
  "meta": {
    "requestId": "req_workspace",
    "apiVersion": "v1",
    "generatedAt": "2026-07-23T10:10:00.000Z"
  }
}
```

错误：`404`、`409 IDEMPOTENCY_CONFLICT`、`422 SNAPSHOT_NOT_USABLE`、`422 VALIDATION_ERROR`。

### 7.2 列表、详情和归档

- `GET /api/v1/simulation-workspaces?status=ACTIVE&conversationId=&limit=&cursor=`
- `GET /api/v1/simulation-workspaces/:workspaceId`
- `PATCH /api/v1/simulation-workspaces/:workspaceId`，`If-Match` 必填，可修改 `name/status=ARCHIVED`。

详情返回根/活动分支、来源快照、recommendation、分支数量和版本。归档后允许读取，不允许生成/执行候选；重新激活不属于 MVP。错误：`404`、`409 WORKSPACE_ARCHIVED`、`412`、`422`。

### 7.3 获取分支树

`GET /api/v1/simulation-workspaces/:workspaceId/tree`

```json
{
  "data": {
    "workspaceId": "workspace_01",
    "activeBranchId": "branch_b",
    "branches": [
      { "id": "branch_root", "parentBranchId": null, "label": "初始资产", "depth": 0, "simulationId": null },
      { "id": "branch_a", "parentBranchId": "branch_root", "label": "A 分批减仓", "depth": 1, "simulationId": "simulation_a" },
      { "id": "branch_b", "parentBranchId": "branch_root", "label": "B 继续持有", "depth": 1, "simulationId": "simulation_b" }
    ],
    "events": [
      { "id": "event_03", "type": "BRANCH_SWITCHED", "fromBranchId": "branch_a", "toBranchId": "branch_b", "createdAt": "2026-07-23T10:12:00.000Z" }
    ],
    "version": 4
  },
  "meta": {
    "requestId": "req_tree",
    "apiVersion": "v1",
    "generatedAt": "2026-07-23T10:12:00.000Z"
  }
}
```

分支按 `depth,createdAt,id` 稳定排序；错误：`404`。

### 7.4 生成和读取 A/B/C

`POST /api/v1/simulation-workspaces/:workspaceId/options`，必须携带 `Idempotency-Key`：

```json
{
  "fromBranchId": "branch_root",
  "scenario": "黄金已持有半仓且上涨，比较追高、持有和减仓",
  "optionCount": 3,
  "horizonDays": 30
}
```

`optionCount` 2..5，默认 3；scenario 1..2000 字符；fromBranch 必须属于工作区。响应 `202` 返回 `BRANCH_OPTION_GENERATION` run。

`GET /api/v1/simulation-workspaces/:workspaceId/options?fromBranchId=branch_root&batchId=option_batch_01` 返回：

```json
{
  "data": {
    "batchId": "option_batch_01",
    "status": "COMPLETED",
    "fromBranchId": "branch_root",
    "engineParameters": {
      "engineVersion": "branch-simulation-v1",
      "commissionRate": 0.0003,
      "minimumCommission": "5.00",
      "slippageRate": 0.001,
      "allowShort": false,
      "allowLeverage": false
    },
    "priceManifest": {
      "dataAsOf": "2026-07-22",
      "sha256": "sha256:...",
      "items": [{ "instrumentId": "instrument_gold", "price": "6.28", "source": "PANDADATA" }]
    },
    "items": [
      { "id": "option_a", "label": "A", "action": "SCALE_IN", "summary": "小额追高", "trades": [] },
      { "id": "option_b", "label": "B", "action": "HOLD", "summary": "保持仓位", "trades": [] },
      { "id": "option_c", "label": "C", "action": "SCALE_OUT", "summary": "分批减仓", "trades": [] }
    ]
  },
  "meta": {
    "requestId": "req_options",
    "apiVersion": "v1",
    "generatedAt": "2026-07-23T10:13:00.000Z"
  }
}
```

AI 输出通过 Zod；每个 trade 必须含 `instrumentId/direction/quantity|targetWeight/rationale`。失败资源返回 failure。错误：`404`、`409 OPTIONS_NOT_READY`、`502 MODEL_UNAVAILABLE`、`422`。

### 7.5 执行候选并创建分支

`POST /api/v1/simulation-workspaces/:workspaceId/branches`，必须携带 `Idempotency-Key`：

```json
{
  "parentBranchId": "branch_root",
  "optionId": "option_c",
  "name": "C 分批减仓"
}
```

服务端创建可观察的执行 run，使用 option 保存的 price manifest 调用确定性引擎，并创建队友 `simulation`、metrics、allocations、子分支和资产快照。v1 固定同步完成：成功返回 `201`，不得根据耗时在 `201/202` 间漂移。data：

```json
{
  "branchId": "branch_c",
  "parentBranchId": "branch_root",
  "simulationId": "simulation_c",
  "snapshotId": "branch_snapshot_c",
  "analysisId": "analysis_branch_c",
  "activeBranchId": "branch_c",
  "workspaceVersion": 5,
  "ordersCreated": false
}
```

错误：`404`、`409 OPTION_ALREADY_EXECUTED`（同请求无幂等键时）、`409 INSUFFICIENT_SIMULATED_CASH`、`422 OPTION_EXPIRED`、`422 PRICE_MANIFEST_INVALID`、`422 COMPLIANCE_BLOCKED`。

### 7.6 切换和撤回

`PATCH /api/v1/simulation-workspaces/:workspaceId/active-branch`，`If-Match` 必填：

```json
{ "branchId": "branch_a" }
```

成功 `200` 返回 `activeBranchId/version`，追加 `BRANCH_SWITCHED`。目标可以是任何历史分支。

`POST /api/v1/simulation-workspaces/:workspaceId/undo`，必须携带 `Idempotency-Key` 和 `If-Match`：

```json
{ "reason": "撤回本次选择" }
```

把指针移到活动分支父节点并追加 `UNDO`。根节点调用返回 `409 ROOT_BRANCH_CANNOT_UNDO`。两者不删除历史、不更新真实持仓。其他错误：`404`、`409 IDEMPOTENCY_CONFLICT`、`412 VERSION_CONFLICT`。

### 7.7 分支资产快照

`GET /api/v1/simulation-workspaces/:workspaceId/branches/:branchId/snapshot`

返回 `cash/totalValue/unrealizedPnl/holdings[]/metrics/dataAsOf/priceManifestSha256/engineVersion`。金额、价格、数量为字符串，权重/收益/回撤为 number。空仓时 `holdings=[]`，不是 404。错误：`404 RESOURCE_NOT_FOUND`。

## 8. 静态资产分析 API

### 8.1 持仓视图

`GET /api/v1/portfolio-analysis/holdings?accountId=&portfolioSnapshotId=`

不传 snapshot 时读取最新有效快照；没有任何持仓返回 `200 items=[]` 和 `summary`。响应：

```json
{
  "data": {
    "portfolioSnapshotId": "portfolio_snapshot_21",
    "asOf": "2026-07-22T07:00:00.000Z",
    "dataQuality": "COMPLETE",
    "summary": { "totalValue": "328000.00", "cashValue": "48000.00", "unrealizedPnl": "18600.00" },
    "items": [
      {
        "holdingId": "holding_01",
        "instrumentId": "instrument_01",
        "assetType": "STOCK",
        "symbol": "DEMO001.SZ",
        "name": "示例科技",
        "quantity": "1000",
        "averageCost": "46.20",
        "marketPrice": "51.30",
        "marketValue": "51300.00",
        "weight": 0.1564,
        "unrealizedPnl": "5100.00",
        "unrealizedPnlRate": 0.1104,
        "drawdown": -0.082,
        "drawdownWindowDays": 252
      }
    ]
  },
  "meta": {
    "requestId": "req_holdings_view",
    "apiVersion": "v1",
    "generatedAt": "2026-07-23T10:20:00.000Z"
  }
}
```

错误：`404 RESOURCE_NOT_FOUND`（显式 snapshot/account 不存在）、`422 VALIDATION_ERROR`。

### 8.2 指标视图

`GET /api/v1/portfolio-analysis/metrics?portfolioSnapshotId=portfolio_snapshot_21`

```json
{
  "data": {
    "portfolioSnapshotId": "portfolio_snapshot_21",
    "scoreVersion": "portfolio-score-v1",
    "healthScore": 72,
    "riskScore": 61,
    "metrics": {
      "returnRate": 0.061,
      "maxDrawdown": -0.142,
      "annualizedVolatility": 0.228,
      "largestHoldingWeight": 0.31,
      "largestSectorWeight": 0.42,
      "concentrationHhi": 0.221,
      "liquidityDays": 1.8,
      "dataCompleteness": 0.92
    },
    "components": [
      { "code": "CONCENTRATION", "score": 58, "quality": "VALID" }
    ],
    "missingMetrics": [],
    "asOf": "2026-07-22T07:00:00.000Z"
  },
  "meta": {
    "requestId": "req_metrics",
    "apiVersion": "v1",
    "generatedAt": "2026-07-23T10:20:00.000Z"
  }
}
```

指标不足时字段为 `null` 并列入 `missingMetrics`，禁止用 0 代替。错误：`404`。

### 8.3 刷新

`POST /api/v1/portfolio-analysis/refresh`，必须携带 `Idempotency-Key`：

```json
{ "accountIds": ["account_01"], "reason": "USER_IMPORTED_DATA" }
```

响应 `202`，`analysis.type=PORTFOLIO_REFRESH`。成功 SSE `portfolio.refreshed` 给出新 `portfolioSnapshotId`；客户端随后重新 GET holdings 与 metrics，二者必须返回同一 snapshot。错误：`404`、`409 RUN_ALREADY_ACTIVE`、`409 IDEMPOTENCY_CONFLICT`、`502 PANDADATA_*`、`503 DATABASE_BUSY`。

### 8.4 假趋势

`GET /api/v1/portfolio-analysis/trends?portfolioSnapshotId=&metric=HEALTH_SCORE&points=12`

```json
{
  "data": {
    "source": "MOCK",
    "modelVersion": "mock-trend-v1",
    "disclaimer": "演示趋势，不是行情、预测或投资证据",
    "metric": "HEALTH_SCORE",
    "items": [
      { "date": "2026-06-12", "value": 68 },
      { "date": "2026-06-19", "value": 70 }
    ]
  },
  "meta": {
    "requestId": "req_trend",
    "apiVersion": "v1",
    "generatedAt": "2026-07-23T10:21:00.000Z"
  }
}
```

`points` 2..52；同 snapshot/metric/points 的结果确定性一致。错误：`404`、`422`。

## 9. 信息搜索 API（P1）

### 9.1 创建与列表

`POST /api/v1/research-searches`，必须携带 `Idempotency-Key`：

```json
{
  "conversationId": "conv_01",
  "analysisId": "analysis_20",
  "query": "科技板块近期政策和财报风险",
  "adapters": ["WEB", "MCP", "KNOWLEDGE_BASE", "RSS"],
  "filters": { "instrumentIds": ["instrument_01"], "publishedAfter": "2026-06-01" },
  "maximumResults": 20
}
```

query 1..1000；adapters 1..4 去重；maximumResults 1..50。响应 `202` 和 `RESEARCH_SEARCH` run。

`GET /api/v1/research-searches?conversationId=&analysisId=&status=&limit=&cursor=` 返回分页摘要；空集合 200。错误：`404`、`409 IDEMPOTENCY_CONFLICT`、`422`、`429`。

### 9.2 状态与结果

`GET /api/v1/research-searches/:searchId` 返回 `status/query/adapters/sourceStatuses/resultCount/analysisId/failure`。

`GET /api/v1/research-searches/:searchId/results?adapter=&limit=&cursor=`：

```json
{
  "data": {
    "items": [
      {
        "id": "research_result_01",
        "title": "示例政策说明",
        "summary": "经净化的摘要",
        "canonicalUrl": "https://example.com/report",
        "adapter": "WEB",
        "sourceName": "example.com",
        "publishedAt": "2026-07-20T02:00:00.000Z",
        "retrievedAt": "2026-07-23T10:22:00.000Z",
        "trust": "UNVERIFIED_EXTERNAL",
        "citations": [
          { "id": "citation_01", "locator": "section-2", "excerpt": "不超过 500 字的摘录", "evidenceId": "evidence_30" }
        ]
      }
    ],
    "sourceStatuses": [
      { "adapter": "WEB", "status": "SUCCEEDED", "error": null },
      { "adapter": "MCP", "status": "FAILED", "error": { "code": "MCP_UNAVAILABLE", "retryable": true } }
    ]
  },
  "meta": {
    "requestId": "req_search_results",
    "apiVersion": "v1",
    "generatedAt": "2026-07-23T10:23:00.000Z",
    "pagination": { "limit": 20, "nextCursor": null, "hasMore": false }
  }
}
```

部分来源失败仍返回 200；全部失败后资源 status=FAILED。未完成返回 `409 SEARCH_RESULTS_NOT_READY`。其他错误：`404`、`422`。

### 9.3 搜索错误

| HTTP | code | 重试 |
| --- | --- | --- |
| 409 | `SEARCH_RESULTS_NOT_READY` | 是 |
| 422 | `SEARCH_ADAPTER_NOT_ENABLED` | 否 |
| 422 | `UNSAFE_SOURCE_URL` | 否 |
| 502 | `MCP_UNAVAILABLE` | 是 |
| 502 | `SEARCH_PROVIDER_UNAVAILABLE` | 是 |
| 502 | `KNOWLEDGE_BASE_UNAVAILABLE` | 是 |
| 504 | `SEARCH_TIMEOUT` | 是 |

## 10. 自选 API（P0）

### 10.1 自选列表 CRUD

`POST /api/v1/watchlists`，必须携带 `Idempotency-Key`：

```json
{ "name": "中长期观察", "description": "与长期目标相关的股票和 ETF" }
```

name 1..60，description 最多 300；每用户最多 20 个活动列表。成功 `201` 返回 `id/name/description/itemCount/version/createdAt`。

`GET /api/v1/watchlists?limit=&cursor=` 返回分页列表；`GET /watchlists/:id` 返回详情和聚合计数。

`PATCH /api/v1/watchlists/:id` 需要 `If-Match`，可改 name/description；`DELETE` 需要 `If-Match`，软删除并返回 204，不删除 instruments/建议/提醒历史。

错误：`404`、`409 WATCHLIST_LIMIT_REACHED`、`409 WATCHLIST_NAME_CONFLICT`、`412`、`422`。

### 10.2 自选条目

`POST /api/v1/watchlists/:watchlistId/items`，必须携带 `Idempotency-Key`：

```json
{
  "instrumentId": "instrument_01",
  "reason": "估值回到历史中位数时复查",
  "plannedHorizon": "LONG",
  "goalId": "goal_01",
  "source": "USER"
}
```

成功 `201` 返回 item 和 version；重复活动标的返回 `409 WATCHLIST_ITEM_EXISTS`。

`GET /api/v1/watchlists/:watchlistId/items?limit=&cursor=` 每项返回基础字段及只读聚合：

```json
{
  "id": "watch_item_01",
  "instrument": { "id": "instrument_01", "symbol": "DEMO001.SZ", "name": "示例科技", "type": "STOCK" },
  "reason": "估值回到历史中位数时复查",
  "plannedHorizon": "LONG",
  "goalId": "goal_01",
  "valuationStatus": "MID_RANGE",
  "riskChange": "INCREASING",
  "portfolioRelation": { "isHeld": true, "weight": 0.1564 },
  "latestAgentConclusion": { "recommendationId": "recommendation_20", "action": "OBSERVE", "asOf": "2026-07-22" },
  "activeAlertCount": 1,
  "version": 1
}
```

`PATCH /api/v1/watchlist-items/:itemId` 需 `If-Match`，可改 reason/plannedHorizon/goalId；`DELETE` 软删除。聚合字段不可写。错误：`404`、`409`、`412`、`422`。

## 11. 提醒和通知 API（P0）

### 11.1 扩展观察条件

继续使用队友 `POST /api/v1/observation-conditions`。新增类型 `UNREALIZED_GAIN_REACH`：

```json
{
  "holdingId": "holding_gold",
  "sourceRecommendationId": "recommendation_20",
  "type": "UNREALIZED_GAIN_REACH",
  "severity": "IMPORTANT",
  "parameters": { "threshold": 0.20 },
  "evaluationMode": "ON_PAGE_LOAD",
  "validUntil": "2026-10-23T00:00:00.000Z"
}
```

回撤条件扩展参数：

```json
{
  "type": "DRAWDOWN_REACH",
  "parameters": { "threshold": -0.15, "window": "ROLLING_DAYS", "windowDays": 252 }
}
```

`UNREALIZED_GAIN_REACH` threshold 必须 `0 < x <= 10`；回撤必须 `-1 < x < 0`。响应和乐观锁沿用队友条件 API。

### 11.2 手动评估

复用 `POST /api/v1/observation-conditions/evaluate`，必须携带 `Idempotency-Key`：

```json
{ "conditionIds": ["condition_20"], "reason": "USER_REFRESH" }
```

成功响应增加：

```json
{
  "evaluatedCount": 1,
  "triggeredCount": 1,
  "suppressedCount": 0,
  "notificationsCreated": ["notification_01"]
}
```

阈值穿越、冷却、同一指标快照去重由服务端执行。过期/假趋势数据不触发。错误沿用队友接口，另加 `422 METRIC_DATA_STALE`。

### 11.3 通知列表与操作

`GET /api/v1/notifications?unreadOnly=true&severity=IMPORTANT&limit=&cursor=` 返回：

```json
{
  "data": {
    "items": [
      {
        "id": "notification_01",
        "severity": "IMPORTANT",
        "title": "黄金持仓浮盈达到 20%",
        "body": "当前浮盈 21.3%，已穿越设置阈值 20%",
        "conditionId": "condition_20",
        "eventId": "watch_event_20",
        "groupKey": "holding_gold:UNREALIZED_GAIN_REACH",
        "occurrenceCount": 1,
        "actions": ["VIEW_ANALYSIS", "OPEN_SIMULATION", "IGNORE"],
        "readAt": null,
        "ignoredAt": null,
        "createdAt": "2026-07-23T10:30:00.000Z",
        "version": 1
      }
    ]
  },
  "meta": {
    "requestId": "req_notifications",
    "apiVersion": "v1",
    "generatedAt": "2026-07-23T10:30:00.000Z",
    "pagination": { "limit": 20, "nextCursor": null, "hasMore": false }
  }
}
```

`PATCH /api/v1/notifications/:notificationId` 需要 `If-Match`：

```json
{ "action": "MARK_READ" }
```

action 为 `MARK_READ/IGNORE`；成功 200。MARK_READ 重放保持首次 `readAt`，IGNORE 同时确认对应 watch event，必要时写决策日志。通知不能改回未读。错误：`404`、`409 NOTIFICATION_ACTION_CONFLICT`、`412`、`422`。

### 11.4 通知偏好

- `GET /api/v1/notification-preference`
- `PUT /api/v1/notification-preference`，后续修改需 `If-Match`

请求：

```json
{ "mode": "IMPORTANT_ONLY", "digestTime": null, "timezone": "Asia/Shanghai" }
```

`DAILY_DIGEST` 必须提供 `digestTime=HH:mm`；MVP 不实际外发，只影响提醒中心聚合显示。未设置 GET 返回 `IMPORTANT_ONLY/version=0`。错误：`412`、`422`。

## 12. RSS API（P2）

### 12.1 用户读取

`GET /api/v1/rss/feeds?enabled=true&limit=&cursor=` 返回 `id/name/siteUrl/status/lastSyncedAt`。

`GET /api/v1/rss/items?feedId=&instrumentId=&q=&publishedAfter=&limit=&cursor=` 返回 `title/summary/canonicalUrl/publishedAt/feed/source=RSS`。空集合 200；q 最多 200 字。错误：`404`（显式 feed 不存在）、`422`。

### 12.2 本地管理员源管理

MVP 使用服务器配置的本地 demo admin gate；非管理员统一 `404`，不在本文引入角色系统。

`POST /api/v1/admin/rss/feeds`，必须携带 `Idempotency-Key`：

```json
{
  "name": "示例财经 RSS",
  "feedUrl": "https://example.com/feed.xml",
  "siteUrl": "https://example.com",
  "enabled": true,
  "refreshIntervalMinutes": 60
}
```

成功 201。`PATCH /admin/rss/feeds/:feedId` 需 `If-Match`；`DELETE` 软删除并 204。feedUrl 修改后必须重新做 DNS/SSRF 校验并清空条件请求水位。

错误：`404`、`409 RSS_FEED_URL_EXISTS`、`412`、`422 UNSAFE_SOURCE_URL`、`422 VALIDATION_ERROR`。

### 12.3 按需同步

`POST /api/v1/admin/rss/feeds/:feedId/sync`，必须携带 `Idempotency-Key`：

```json
{ "force": false }
```

响应 `202`，analysis type `RSS_SYNC`。`force=false` 使用 ETag/Last-Modified；`304` 仍以成功完成，计数为 0。取消/重试复用 analyses API。

错误：`404`、`409 RSS_SYNC_ALREADY_ACTIVE`、`409 IDEMPOTENCY_CONFLICT`、`422 UNSAFE_SOURCE_URL`、`502 RSS_UPSTREAM_FAILED`、`504 RSS_SYNC_TIMEOUT`。

## 13. 并发、失败、空数据和重试语义

| 场景 | 统一行为 |
| --- | --- |
| 列表无数据 | `200`，`items=[]`，`hasMore=false` |
| 显式资源不存在/他人资源 | `404 RESOURCE_NOT_FOUND` |
| 长操作未就绪 | 资源详情 200 展示状态；结果/预览接口返回领域 409 |
| 长操作上游失败 | run/resource 标记 FAILED，保存脱敏 failure；不伪造结果 |
| 用户取消 | 协作式终止，资源标记 CANCELLED；已发布不可变结果不回滚 |
| 进程重启 | `RUNNING -> INTERRUPTED`；用户显式 retry 创建新 run |
| SQLite busy | 最多指数退避 3 次，之后 `503 DATABASE_BUSY` |
| `If-Match` 过期 | `412 VERSION_CONFLICT`，details 返回 `currentVersion` |
| 同一幂等键并发 | 一个获得预留；另一个重放或等候短时间后返回首次响应 |
| 同键不同请求 | `409 IDEMPOTENCY_CONFLICT` |
| PandaData 不可用 | 明确 502；缓存/Fixture 标来源，过期时停止需要新鲜度的操作 |
| 模型不可用 | 查数已有结果仍可读；报告/候选失败并可重试 |

幂等 `POST` 的自动重试只适用于客户端因网络未知而重放同一键。服务端不会自动重跑业务失败；用户调用队友 retry API。GET 可按网络策略安全重试；PATCH 不自动重试，必须先重读 version。

## 14. 完整错误码增量

| HTTP | code | retryable |
| --- | --- | --- |
| 408 | `QUERY_TIMEOUT` | true |
| 409 | `QUERY_RESULT_NOT_READY` | true |
| 409 | `ARTIFACT_NOT_READY` | true |
| 409 | `ARTIFACT_NOT_EDITABLE` | false |
| 409 | `OPTIONS_NOT_READY` | true |
| 409 | `WORKSPACE_ARCHIVED` | false |
| 409 | `ROOT_BRANCH_CANNOT_UNDO` | false |
| 409 | `INSUFFICIENT_SIMULATED_CASH` | false |
| 409 | `SEARCH_RESULTS_NOT_READY` | true |
| 409 | `WATCHLIST_LIMIT_REACHED` | false |
| 409 | `WATCHLIST_NAME_CONFLICT` | false |
| 409 | `WATCHLIST_ITEM_EXISTS` | false |
| 409 | `NOTIFICATION_ACTION_CONFLICT` | false |
| 409 | `RSS_SYNC_ALREADY_ACTIVE` | true |
| 410 | `QUERY_RESULT_EXPIRED` | false |
| 422 | `QUERY_REJECTED` | false |
| 422 | `QUERY_TOO_EXPENSIVE` | false |
| 422 | `DATASET_NOT_ALLOWED` | false |
| 422 | `FIELD_NOT_ALLOWED` | false |
| 422 | `ARTIFACT_CONTENT_UNSAFE` | false |
| 422 | `SNAPSHOT_NOT_USABLE` | false |
| 422 | `OPTION_EXPIRED` | false |
| 422 | `PRICE_MANIFEST_INVALID` | false |
| 422 | `SEARCH_ADAPTER_NOT_ENABLED` | false |
| 422 | `UNSAFE_SOURCE_URL` | false |
| 422 | `METRIC_DATA_STALE` | false |
| 502 | `SEARCH_PROVIDER_UNAVAILABLE` | true |
| 502 | `MCP_UNAVAILABLE` | true |
| 502 | `KNOWLEDGE_BASE_UNAVAILABLE` | true |
| 502 | `RSS_UPSTREAM_FAILED` | true |
| 503 | `DATABASE_BUSY` | true |
| 504 | `SEARCH_TIMEOUT` | true |
| 504 | `RSS_SYNC_TIMEOUT` | true |

未列出的认证、幂等、分析、模型、PandaData、Skill 和合规错误完全复用队友错误目录。

## 15. API 到数据库追踪

| API 领域 | 新增表 | 复用表 |
| --- | --- | --- |
| 输出偏好 | `conversation_output_preferences` | `conversation_sessions` |
| 查数 | `data_queries`, `data_query_result_chunks` | `agent_runs`, `tool_calls`, `skill_runs`, `idempotency_records` |
| 产物 | `generated_artifacts`, `generated_artifact_versions` | `messages`, `message_artifacts`, `agent_runs`, `audit_events` |
| 分支 | `simulation_workspaces`, `simulation_branches`, `simulation_option_batches`, `simulation_options`, `simulation_branch_events`, `simulation_asset_snapshots`, `simulation_asset_snapshot_items` | `portfolio_snapshots`, `simulations`, metrics/allocations, `decision_logs` |
| 静态分析 | `portfolio_score_snapshots` | `portfolio_snapshots`, `holding_snapshots`, `market_snapshots/metrics` |
| 搜索 | `research_searches`, `research_results`, `research_citations` | `agent_runs`, `tool_calls`, `evidence_items/source_links` |
| 自选 | `watchlists`, `watchlist_items` | `instruments`, `user_goals`, `recommendations` |
| 通知 | `notifications`, `notification_preferences` | `watch_conditions`, `watch_condition_events`, `decision_logs` |
| RSS | `rss_feeds`, `rss_items` | `agent_runs`, `tool_calls`, `data_sources` |

## 16. 契约验收

1. 所有端点通过同一个 `mw_demo_session`、CSRF、成功/错误包络和 Zod 契约测试。
2. 所有列表返回 `data.items/meta.pagination`，所有比例是 number，所有金额/价格/数量是字符串。
3. 所有 PATCH 缺少/错误 `If-Match` 时失败；版本冲突固定为 `412`。
4. 所有标记幂等的 POST 在并发和 24 小时内重放不产生重复资源。
5. 对话 `outputMode`、偏好和默认值按固定优先级解析；消息能读取新增产物链接。
6. 写 SQL、多语句、PRAGMA、ATTACH、系统表、危险函数和越权账户在执行前被拒绝。
7. 查询详情能追踪 `analysisId/toolCallId/skillRunId/dataAsOf`，不会返回凭证或敏感参数。
8. Artifact 恶意 Markdown、链接和 ECharts 函数不能进入预览；编辑产生不可变版本。
9. A/B/C 使用保存的价格清单；切换/撤回只移动指针；执行分支产生既有 `simulation`，真实持仓不变。
10. 静态 holdings/metrics 在刷新后引用同一 snapshot；趋势始终显式 MOCK。
11. 搜索部分成功可读且进入 Evidence Board 的引用可追溯，外部提示注入不触发工具。
12. 自选聚合字段只读；浮盈/回撤提醒按穿越去重并生成四级站内通知。
13. RSS 同步防 SSRF/XML 实体攻击，支持 304、取消、中断和显式重试。
14. 进程重启后活动 run 为 INTERRUPTED，SSE 业务事件可用 `Last-Event-ID` 连续重放。
