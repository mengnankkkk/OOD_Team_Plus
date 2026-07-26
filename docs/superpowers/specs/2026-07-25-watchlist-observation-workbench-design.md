# 持仓观测工作台完整化设计

## 1. 背景

当前持仓观测功能已经具备默认列表、添加标的、移除标的、定时行情扫描和提醒中心联动，但仍存在以下产品断点：

- 关联目标只存在于表单状态，没有提交或落库。
- 同一列表允许重复添加活动标的。
- 观察卡片只有删除操作，无法编辑、检查、管理规则或进入顾问。
- 自选条目接口没有返回持仓、风险、估值证据、事件、建议和提醒聚合。
- 页面宣称持续关注估值、事件、组合关联和行业拥挤度，实际仅实现单日异动和近 20 日回撤。
- 自定义观察条件虽有基础接口，但没有接入持仓观测页面。
- 页面只使用一个隐式默认列表，未开放已有列表 CRUD。

本设计在保留现有数据和通知能力的前提下，将持仓观测补齐为可管理、可检查、可解释、可追踪的工作台。

## 2. 产品决策

### 2.1 已确认决策

- 支持多个命名观察列表。
- 允许观察未持有标的，并明确展示“已持有/未持有”。
- 自定义提醒采用结构化规则模板。
- 高级状态只基于现有真实数据计算；缺少数据时明确展示“数据不足”，不使用价格位置冒充估值或市场拥挤度。
- 保留统一提醒中心，由持仓观测工作台负责配置和触发，由提醒中心负责处理和顾问联动。

### 2.2 非目标

- 不自动生成或执行真实买卖指令。
- 不根据缺失数据推断 PE、PB、市场行业拥挤度或公司事件。
- 不在本次实现自然语言规则解析。
- 不新增短信、邮件或移动推送渠道；浏览器通知和站内提醒继续作为当前渠道。
- 不改造顾问、模拟和证据实验室的核心流程，只提供带上下文的跳转。

## 3. 用户工作流

### 3.1 列表管理

用户进入 `/watchlist` 后：

1. 加载用户的活动和归档观察列表。
2. 优先选择 URL 查询参数 `list` 指定的列表；否则选择名称为“持仓观测”的活动列表；仍不存在时创建默认列表。
3. 用户可以新建、改名、修改描述、归档、恢复和删除列表。
4. 删除列表前显示活动条目数和活动规则数。确认后软删除列表、移除活动条目并停用规则，历史通知和事件保留。

同一标的允许存在于不同列表，但同一列表只能有一个活动条目。

### 3.2 添加和编辑观察对象

添加表单包含：

- A 股或已同步可交易标的搜索。
- 关注理由。
- 计划期限。
- 关联目标，可为空。
- 初始回撤规则，可关闭，默认阈值为 15%。

添加成功后返回完整聚合条目。重复添加返回 `409 WATCHLIST_ITEM_EXISTS`，响应包含已有条目 ID 和列表 ID，前端提供“查看现有记录”。

编辑表单允许修改：

- 关注理由。
- 计划期限。
- 关联目标。

回撤和其他提醒阈值由规则面板管理，不混在条目编辑接口中。

### 3.3 条目后续操作

每个观察卡片提供：

- 问顾问。
- 立即检查该标的。
- 编辑观察信息。
- 管理提醒规则。
- 移动到其他列表。
- 移除。

移除条目时软删除条目并暂停其活动规则。恢复同一标的时复用最近的已移除条目 ID 或创建新条目均可，但活动唯一约束必须始终成立。本次实现采用复用条目并递增版本，以保留稳定引用。

### 3.4 规则管理

每个条目支持以下规则：

| 类型 | 用户输入 | 规范化存储 | 触发语义 |
| --- | --- | --- | --- |
| `PRICE_ABOVE` | 价格 | 正数价格 | 从阈值下方上穿时触发 |
| `PRICE_BELOW` | 价格 | 正数价格 | 从阈值上方下穿时触发 |
| `DRAWDOWN_REACH` | 百分比 | `0..1` 正数比例 | 近 N 日回撤幅度从阈值下方达到或超过阈值 |
| `DAILY_MOVE_REACH` | 百分比 | `0..1` 正数比例 | 每个交易日绝对涨跌达到阈值，每日最多一次 |
| `POSITION_WEIGHT_ABOVE` | 百分比 | `0..1` 正数比例 | 持仓权重从阈值下方达到或超过阈值 |
| `UNREALIZED_GAIN_REACH` | 百分比 | `0..1` 正数比例 | 浮盈比例从阈值下方达到或超过阈值 |
| `REVIEW_DATE` | 日期 | `YYYY-MM-DD` | 到达日期后触发一次，修改日期后可再次触发 |

规则可创建、编辑阈值、编辑窗口、修改严重度、启用、暂停和删除。`DRAWDOWN_REACH` 的默认窗口为 20 个交易日，允许配置 5 至 120 个交易日。其他类型不接受无意义的窗口参数。

未持有标的上的 `POSITION_WEIGHT_ABOVE` 和 `UNREALIZED_GAIN_REACH` 保持活动但评估结果为 `insufficient_data`，不生成通知。

## 4. 页面设计

### 4.1 页面结构

页面使用现有工作台视觉语言，不创建营销式首屏或嵌套卡片。

1. 顶部工具栏
   - 列表切换器。
   - 列表管理菜单。
   - 数据状态和最新检查时间。
   - “立即检查”按钮。
   - “添加标的”按钮。

2. 概况区
   - 观察对象总数。
   - 已持有数量。
   - 活动规则数。
   - 待处理提醒数。
   - 部分可用数据项数量。

3. 条目网格
   - 桌面端两至三列。
   - 移动端单列。
   - 卡片保持固定信息层级，不因异步字段出现而改变操作区位置。

### 4.2 卡片字段

卡片展示：

- 标的名称、代码和资产类型。
- 已持有/未持有状态。
- 最新价格、单日涨跌和行情日期。
- 持仓数量、持仓权重和浮盈比例；未持有时不显示伪值。
- 关联目标。
- 关注理由和计划期限。
- 风险变化。
- 估值证据状态。
- 最近关联事件。
- 组合行业集中度。
- 最新 Agent 结论。
- 活动规则数、已触发规则数和未读提醒数。

所有高级状态显示数据来源和 `dataAsOf`。缺失状态使用“数据不足”或“暂无证据”，不能使用中性数值代替。

### 4.3 交互容器

- 新增/编辑条目使用对话框。
- 规则管理使用右侧 Sheet；移动端占满可用宽度。
- 列表管理使用对话框，列表行提供改名、归档、恢复和删除菜单。
- 删除和移动使用 AlertDialog，不使用原生 `confirm`。
- 图标按钮使用 Lucide 图标、`aria-label`、`title` 或 Tooltip。
- “问顾问”使用明确的图标加文字按钮。

## 5. 数据模型

### 5.1 `watchlists`

沿用现有字段。新增约束和行为：

- 非删除列表名称按 `user_id + name` 唯一；删除后允许重新使用原名称。
- `archived` 列表可读和恢复，但不参与后台扫描。
- `deleted` 列表不在普通列表接口返回。

### 5.2 `watchlist_items`

新增字段：

```sql
goal_id TEXT REFERENCES goals(id) ON DELETE SET NULL;
source_type TEXT NOT NULL DEFAULT 'user'
  CHECK(source_type IN ('user','agent','import'));
```

新增部分唯一索引：

```sql
CREATE UNIQUE INDEX idx_watchlist_items_active_instrument
ON watchlist_items(watchlist_id, instrument_id)
WHERE status = 'active';
```

`planned_horizon` 继续保存用户可读文本以兼容已有数据。接口不再把它限制为 `SHORT/MEDIUM/LONG`。

### 5.3 `observation_conditions`

新增字段：

```sql
watchlist_item_id TEXT REFERENCES watchlist_items(id) ON DELETE SET NULL;
severity TEXT NOT NULL DEFAULT 'attention'
  CHECK(severity IN ('information','attention','important','urgent'));
threshold_date TEXT;
window_days INTEGER;
config_json TEXT NOT NULL DEFAULT '{}';
last_triggered_at TEXT;
```

约束：

- 数值型规则必须设置 `threshold_decimal`。
- `REVIEW_DATE` 必须设置 `threshold_date`。
- 为兼容现有 `threshold_decimal NOT NULL` 表结构，`REVIEW_DATE` 固定写入 `threshold_decimal = '0'`；评估器不得读取该占位值。
- `window_days` 只用于需要窗口的规则。
- 条目删除后规则状态更新为 `paused`，不物理删除。
- 条件所有权必须与条目所属列表用户一致。

### 5.4 `rss_item_instruments`

新增 RSS 条目与标的的显式关联表：

```sql
CREATE TABLE rss_item_instruments (
  id TEXT PRIMARY KEY,
  rss_item_id TEXT NOT NULL REFERENCES rss_items(id) ON DELETE CASCADE,
  instrument_id TEXT NOT NULL REFERENCES instruments(id) ON DELETE CASCADE,
  match_basis TEXT NOT NULL
    CHECK(match_basis IN ('symbol_exact','name_exact','research_link')),
  matched_text TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE UNIQUE INDEX idx_rss_item_instruments_unique
ON rss_item_instruments(rss_item_id, instrument_id);
```

RSS 同步完成后，只针对活动持仓和活动观察条目涉及的标的执行确定性关联：

- 标题或摘要中出现带边界的完整证券代码时使用 `symbol_exact`。
- 标题或摘要中出现完整标的名称时使用 `name_exact`。
- 已有研究证据明确关联 RSS 条目和标的时使用 `research_link`。

关联结果保存 `match_basis` 和 `matched_text`，前端可展示关联依据。不进行简称、同义词或模糊字符串匹配。

### 5.5 迁移

新增迁移按以下顺序执行：

1. 添加 `watchlist_items.goal_id` 和 `source_type`。
2. 将 `idx_watchlists_user_name` 改为 `status != 'deleted'` 的部分唯一索引。
3. 清理同一列表中的重复活动条目：
   - 保留最早创建的活动条目。
   - 将其他重复条目标记为 `removed`。
   - 不删除已有通知。
4. 创建活动标的部分唯一索引。
5. 扩展 `observation_conditions`。
6. 为每个具有 `drawdown_threshold_bps` 的活动条目创建一条 `DRAWDOWN_REACH` 规则：
   - `threshold_decimal = ABS(drawdown_threshold_bps) / 10000`。
   - `window_days = 20`。
   - 已存在等价活动规则时不重复创建。
7. 创建 `rss_item_instruments` 和索引。
8. 对最近 30 日 RSS 条目运行一次确定性标的关联。
9. 保留 `drawdown_threshold_bps` 作为兼容读取字段，本次发布后新增和编辑只写规则表。后续独立迁移再删除兼容字段。

## 6. 服务边界

新增 `src/server/extensions/watchlists/service.ts`，负责：

- 列表和条目的所有权校验。
- 条目创建、恢复、移动和删除事务。
- 重复标的冲突转换。
- 条目聚合查询。
- 列表级概况计算。

新增 `src/server/extensions/watchlists/aggregation.ts`，只负责从已有数据构造只读聚合：

- 行情状态。
- 持仓关系。
- 风险变化。
- 估值证据。
- 最近事件。
- 行业集中度。
- 最新建议。
- 规则和提醒计数。

新增 `src/server/extensions/watchlists/check-service.ts`，负责：

- 列表或单条目的行情刷新。
- 条件评估。
- 默认自选异动规则评估。
- 返回检查状态和数据时间。

现有通知调度器调用 `check-service`，不再分别拼装列表查询和条件评估。

## 7. 聚合计算

### 7.1 行情

从 `market_snapshots` 读取该标的最新有效日行情：

```ts
{
  price: number | null;
  previousClose: number | null;
  dailyMovePct: number | null;
  dataAsOf: string | null;
  status: "available" | "stale" | "insufficient_data";
}
```

超过 72 小时且不是非交易日解释范围内的数据标记为 `stale`。

### 7.2 持仓关系

从用户最新 `portfolio_snapshots` 和 `holding_snapshots` 读取：

```ts
{
  isHeld: boolean;
  quantity: number | null;
  weight: number | null;
  cost: number | null;
  unrealizedGainPct: number | null;
  dataAsOf: string | null;
}
```

### 7.3 风险变化

使用最多 40 个交易日收盘价：

- 最近 10 日年化波动率与此前 10 日年化波动率比较。
- 最近 20 日最大回撤与此前 20 日最大回撤比较。
- 任一风险指标恶化至少 25% 时为 `increasing`。
- 任一风险指标改善至少 20%，且另一指标未恶化时为 `decreasing`。
- 其余为 `stable`。
- 不足 20 个有效交易日时为 `insufficient_data`。

响应同时返回波动率、回撤和计算窗口，前端只展示状态和简短依据。

### 7.4 估值证据

按以下优先级读取：

1. 最新 Agent 建议关联的估值类证据。
2. 该标的最新分析中的估值类证据。

只有证据明确包含估值状态时返回 `low`、`fair` 或 `high`。其他情况返回：

```ts
{
  status: "insufficient_data";
  label: "暂无估值证据";
  source: null;
  dataAsOf: null;
}
```

### 7.5 最近事件

只读取通过 `rss_item_instruments` 明确关联的 RSS 条目。关联必须满足：

- 完整证券代码精确匹配。
- 完整标的名称精确匹配。
- 已有研究证据显式链接。

返回最近 30 日内最新一条，并包含来源、发布时间和 `matchBasis`。没有关联记录时返回 `null`。

### 7.6 组合行业集中度

从最新持仓快照按 `instruments.sector` 聚合。返回观察标的所属行业在用户组合中的权重：

- `< 20%`：`low`
- `20%..35%`：`medium`
- `35%..50%`：`high`
- `>= 50%`：`critical`

字段名称和界面文案统一使用“组合行业集中度”，不使用“市场行业拥挤度”。

### 7.7 最新 Agent 结论

读取该用户、该标的最新非删除建议，返回：

- 建议 ID。
- 动作。
- 摘要。
- 状态。
- 生成时间。

### 7.8 提醒和规则计数

- `activeConditionCount`：活动规则数。
- `triggeredConditionCount`：最近一次检查中触发的规则数。
- `unreadAlertCount`：该条目来源且未读、未忽略的通知数。
- `lastCheckedAt`：最近条件评估或自选扫描时间。

## 8. API 设计

### 8.1 列表

- `GET /api/v1/watchlists?status=active|archived&limit=&cursor=`
- `POST /api/v1/watchlists`
- `GET /api/v1/watchlists/:id`
- `PATCH /api/v1/watchlists/:id`
- `DELETE /api/v1/watchlists/:id`

列表响应增加：

```ts
{
  itemCount: number;
  activeConditionCount: number;
  unreadAlertCount: number;
  version: number;
}
```

### 8.2 条目

- `GET /api/v1/watchlists/:id/items?limit=&cursor=`
- `POST /api/v1/watchlists/:id/items`
- `GET /api/v1/watchlist-items/:id`
- `PATCH /api/v1/watchlist-items/:id`
- `DELETE /api/v1/watchlist-items/:id`
- `POST /api/v1/watchlist-items/:id/move`

创建请求：

```ts
{
  instrumentId: string;
  reason?: string;
  plannedHorizon?: string;
  goalId?: string | null;
  source?: "USER" | "AGENT" | "IMPORT";
  initialDrawdownThresholdPct?: number | null;
}
```

条目响应包含基础字段和第 7 节定义的全部聚合。

### 8.3 规则

- `GET /api/v1/observation-conditions?watchlistItemId=&status=&limit=&cursor=`
- `POST /api/v1/observation-conditions`
- `PATCH /api/v1/observation-conditions/:id`
- `DELETE /api/v1/observation-conditions/:id`
- `POST /api/v1/observation-conditions/evaluate`

创建请求：

```ts
{
  watchlistItemId: string;
  conditionType:
    | "PRICE_ABOVE"
    | "PRICE_BELOW"
    | "DRAWDOWN_REACH"
    | "DAILY_MOVE_REACH"
    | "POSITION_WEIGHT_ABOVE"
    | "UNREALIZED_GAIN_REACH"
    | "REVIEW_DATE";
  threshold?: string;
  thresholdDate?: string;
  windowDays?: number;
  severity: "INFORMATION" | "ATTENTION" | "IMPORTANT" | "URGENT";
}
```

### 8.4 立即检查

- `POST /api/v1/watchlists/:id/check`
- `POST /api/v1/watchlist-items/:id/check`

两个接口都要求 `Idempotency-Key`。响应：

```ts
{
  status: "SUCCEEDED" | "PARTIAL" | "FAILED";
  checkedItemCount: number;
  evaluatedConditionCount: number;
  createdNotificationCount: number;
  marketRefreshAttempted: boolean;
  marketRefreshSucceeded: boolean;
  dataAsOf: string | null;
  errorCode: string | null;
  errorMessage: string | null;
}
```

## 9. 提醒与通知

### 9.1 默认扫描

后台启动 15 秒后执行首次扫描，之后每小时扫描：

- 活动持仓。
- 活动观察列表中的活动条目。
- 活动观察条件。
- 最近新增且显式关联到观察标的的 RSS 事件。

归档列表和暂停规则不参与扫描。

新的关联 RSS 条目生成 `WATCHLIST_EVENT` 通知，严重度为 `information`。同一用户、观察条目和 RSS 条目只生成一次；事件通知提供“问顾问”入口，不直接给出买卖结论。

### 9.2 通知上下文

观察条目产生的通知 metadata 至少包含：

```ts
{
  watchlistId: string;
  watchlistItemId: string;
  conditionId?: string;
  instrumentId: string;
  symbol: string;
  name: string;
  goalId?: string;
  reason?: string;
  rule: string;
  metricValue?: number;
  threshold?: number | string;
  dataAsOf: string;
  advisorPrompt: string;
}
```

“问顾问”跳转使用该上下文生成问题，不把通知自动解释为买卖建议。

### 9.3 去重

- 价格、回撤、权重和浮盈规则按阈值跨越生成事件。
- 单日异动按 `用户 + 条目 + 规则 + 交易日` 去重。
- 复查日期按 `用户 + 条目 + 规则 + thresholdDate` 去重。
- 关联事件按 `用户 + 条目 + rssItemId` 去重。
- 默认自选异动继续按交易日去重。

## 10. 错误处理与安全

- 所有资源按当前登录用户校验所有权。
- 修改和删除使用 `If-Match`。
- 创建和立即检查使用 `Idempotency-Key`。
- `goalId` 必须属于当前用户且目标为活动状态。
- 移动条目前验证目标列表所有权和重复冲突。
- 外部行情失败时返回 `PARTIAL`，保留最近有效数据及其日期。
- 单个标的数据失败不阻断其他条目聚合。
- API 不返回环境变量、供应商原始错误、Cookie、Token 或完整外部响应。

标准业务错误：

- `WATCHLIST_ITEM_EXISTS`
- `WATCHLIST_ITEM_MOVE_CONFLICT`
- `WATCHLIST_ARCHIVED`
- `OBSERVATION_CONDITION_INVALID`
- `OBSERVATION_DATA_INSUFFICIENT`
- `VERSION_CONFLICT`
- `RESOURCE_NOT_FOUND`

## 11. 前端状态管理

React Query key：

```ts
["watchlists", userId, status]
["watchlist", userId, watchlistId]
["watchlist-items", userId, watchlistId]
["watchlist-item", userId, itemId]
["observation-conditions", userId, itemId]
["alerts", userId]
```

创建、编辑、移动、移除、规则变更和立即检查后，只失效相关列表、条目、规则和提醒查询。列表切换写入 URL `?list=<id>`，刷新后保持选中列表。

## 12. 测试策略

### 12.1 数据库和迁移

- 旧条目迁移后保留理由、期限和回撤阈值。
- 重复活动条目被确定性清理。
- 部分唯一索引阻止后续重复。
- 已有回撤阈值转换为单条活动规则。

### 12.2 API

- 多列表 CRUD、归档、恢复和权限隔离。
- 条目创建、编辑、移动、移除、恢复和重复冲突。
- `goalId` 所有权和落库。
- 聚合字段返回正确的数据来源和时间。
- 七种规则的创建、编辑、启停、删除和校验。
- 列表级与条目级立即检查的幂等性。

### 12.3 规则引擎

每种规则覆盖：

- 未跨越阈值不触发。
- 首次跨越触发。
- 重复扫描不重复通知。
- 离开阈值后再次跨越可再次触发。
- 数据不足时不触发并返回明确状态。
- 不同用户和条目互不影响。

### 12.4 聚合

- 已持有和未持有关系。
- 风险上升、下降、稳定和数据不足。
- 估值证据存在和缺失。
- 精确代码、完整名称和研究链接三种事件关联。
- 关联事件存在、缺失和去重。
- 行业集中度四档。
- 最新建议、活动规则和未读提醒计数。

### 12.5 前端端到端

- 新建、改名、归档、恢复和删除列表。
- 添加标的并持久化目标。
- 重复添加显示冲突处理。
- 编辑条目。
- 创建、修改、暂停和删除规则。
- 单条目和整列表立即检查。
- 从卡片和提醒进入顾问。
- 移动和移除条目。
- 桌面与移动端布局、文本溢出和对话框可用性。

## 13. 验收标准

功能完成需同时满足：

1. 页面不存在无效字段或仅本地保存的选项。
2. 同一列表无法产生重复活动标的。
3. 卡片提供已确认的六类后续操作。
4. 七类结构化规则可完整管理和评估。
5. 高级状态全部来自真实数据并显示来源和时间。
6. 缺失数据不显示伪造状态。
7. 多列表完整 CRUD 可用。
8. 定时扫描和手动检查使用同一服务。
9. 历史通知在列表或条目删除后仍可审计。
10. lint、类型检查、单元测试、E2E 和生产构建全部通过。
