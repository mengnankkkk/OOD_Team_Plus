# Money Whisperer 对话 Agent 模块设计

## 1. 文档目标

本文定义 Money Whisperer MVP 中“对话 Agent”模块的领域边界、Agent 协作模型、状态机、业务流程、工具能力、建议生成规则、安全边界和验收标准。

配套文档：

- `2026-07-23-conversation-agent-api-design.md`：后端接口、请求响应、SSE 事件和错误码。
- `2026-07-23-conversation-agent-database-design.md`：SQLite 数据模型、ER 关系、索引与事务边界。

## 2. MVP 技术边界

- 单个 Next.js App Router 应用，同时承载页面和 Route Handlers。
- TypeScript 为主语言。
- Mastra Supervisor Agent 负责动态委派，不使用固定 DAG 作为主决策逻辑。
- DeepSeek 提供模型能力。
- Zod 定义所有 Agent、工具和 API 的结构化契约。
- SQLite 保存用户画像、持仓、会话、建议和决策日志。
- 进程内 `Map` 保存正在运行的 Agent 上下文和 SSE 订阅。
- 不使用 Redis、消息队列、微服务、真实账户、真实交易和生产级鉴权。
- **PandaData Data Service API 是正式数据主路径，必须接入。**
- **仓库内复制的 `.codex/skills/pandadata-api` 是正式数据调用 Skill，必须保留完整目录并参与运行时路由。**
- TypeScript Agent 通过 `PandadataAdapter` 调用 Python `panda_data==0.0.12` 运行时；Adapter 再调用 Skill 提供的 `scripts/call_api.py` 或同进程运行器。
- 本地 Fixture 只用于无凭证测试、接口故障降级和确定性回归，不得在真实数据可用时静默替代。
- 其他复制到 `.codex/skills` 的 Quant/API Skill 通过 `SkillRegistry` 注册、`SkillRouter` 选择，并记录版本、许可证、验证级别和输出摘要。

枚举约定：

- API wire format 使用大写 `UPPER_SNAKE_CASE`，便于前端识别和展示。
- SQLite 使用小写 `snake_case`。
- Zod schema 层集中维护双向映射，Route Handler 和 Agent 不得自行拼接枚举值。
- 本文中的 TypeScript 领域示例优先使用小写语义名；具体接口值以 API 文档为准。

## 3. 核心定位

对话 Agent 是用户使用产品的统一入口，负责：

1. 建立和更新用户投资画像。
2. 将自然语言持仓转为结构化资产记录。
3. 识别用户问题的真实意图。
4. 主动追问缺失信息。
5. 动态调用研究、组合、风险和合规能力。
6. 生成支持证据、反方证据和多个候选方案。
7. 输出结构化观察、买入、持有、减仓和退出建议。
8. 允许用户模拟采纳、拒绝或继续追问。
9. 记录决策和后续观察条件。

Agent 不执行真实订单，不保证收益，不将技术指标或单条新闻直接转换为买卖指令。

## 4. 关键概念修正

### 4.1 目标金额与可投资资金

- **目标金额**：用户希望在目标日期达到的资金规模。
- **初始可投资资金**：用户当前能够投入的本金。
- **定期追加资金**：用户每月或每季度可追加的资金。
- **保留现金**：不得用于投资的应急或短期资金。

这四个字段必须独立保存。

### 4.2 目标优先级与资产偏好

- **目标优先级**：保住本金、控制回撤、获得增长、保持流动性等目标之间的顺序。
- **资产偏好**：个股、行业 ETF、宽基指数、黄金、现金等偏好。

“个股、板块、指数”不能作为目标优先级存储。

### 4.3 投资期限

前端可展示短线、中线、长线，但后端必须同时保存具体日期或天数：

| 展示标签 | MVP 默认定义 |
| --- | --- |
| 短线 | 30 天以内 |
| 中线 | 31 天至 365 天 |
| 长线 | 365 天以上 |

用户提供具体目标日期时，以具体日期为准。

### 4.4 指数与可交易资产

指数本身不能以“100 股”形式录入持仓。用户说“指数 100 点时买了 100 股”时，Agent 必须确认：

- 买的是指数 ETF。
- 买的是指数基金。
- 买的是股指期货。
- 用户只是用指数点位描述入场时机。

在资产代码、资产类型、数量和成本确认前，不创建正式持仓。

## 5. Agent 组成

MVP 保留一个 Supervisor 和四个专业 Agent，共五个角色，在控制实现复杂度的同时保留动态委派能力。

### 5.1 Chief Advisor Agent

职责：

- 识别意图。
- 判断是否需要建档、补充持仓或追问。
- 选择子 Agent 和工具。
- 决定串行、并行或再次委派。
- 维护 Evidence Board。
- 合并多个候选方案。
- 在合规通过后生成面向用户的最终响应。

Chief Advisor 不直接计算金融指标。

### 5.2 Profile Agent

职责：

- 完成风险画像和目标建档。
- 判断主观风险偏好与客观承受能力是否冲突。
- 将自然语言回答转成固定枚举和数值约束。
- 维护用户资产偏好、排除项和流动性要求。
- 输出缺失字段和下一条最有价值的问题。

### 5.3 Research Agent

职责：

- 获取历史行情、财务、估值、技术指标、事件和消息。
- 区分事实、计算值、推断和未知信息。
- 生成支持证据和反方证据。
- 分析个股、ETF、指数和板块。
- 将证据写入 Evidence Board。

### 5.4 Portfolio & Risk Agent

职责：

- 计算浮盈、回撤、仓位、集中度和组合暴露。
- 判断标的与用户目标和风险约束的匹配程度。
- 生成买入、持有、减仓和退出候选方案。
- 执行情景模拟和压力测试。
- 对不适合用户的方案行使风险否决权。

### 5.5 Compliance Agent

职责：

- 检查建议是否缺少数据时间、风险、反方证据、有效期和失效条件。
- 拦截保证收益、确定性涨跌预测和强制性交易语言。
- 检查是否超出用户仓位和风险约束。
- 将建议结果标记为 `approved`、`downgraded` 或 `blocked`。

## 6. Agent 协作模式

主流程不是固定的：

```text
Data -> Research -> Portfolio -> Risk -> Report
```

而是由 Chief Advisor 根据上下文动态组织。例如：

```text
用户：科技板块跌得很严重，现在能入场吗？

Chief Advisor
  -> 检查画像：已完成
  -> 检查持仓：科技板块仓位未知
  -> Profile Agent 追问当前科技持仓和可投入资金
  -> Research Agent 分析板块回撤、估值、趋势和事件
  -> Portfolio & Risk Agent 分析新增仓位后的集中度
  -> Chief Advisor 发现趋势证据与估值证据冲突
  -> Research Agent 补充反方证据
  -> Compliance Agent 审查
  -> 输出“等待条件满足后试仓”而不是简单回答“可以买”
```

## 7. Evidence Board

所有 Agent 共享结构化 Evidence Board，而不是仅靠对话文本传递信息。

```typescript
interface EvidenceBoard {
  conversationId: string;
  userId: string;
  intent: ConversationIntent;
  userContext: {
    profileSnapshotId?: string;
    goalIds: string[];
    portfolioSnapshotId?: string;
  };
  missingInformation: MissingField[];
  facts: EvidenceItem[];
  computedMetrics: MetricItem[];
  hypotheses: Hypothesis[];
  supportingEvidence: EvidenceItem[];
  counterEvidence: EvidenceItem[];
  unknowns: string[];
  riskFlags: RiskFlag[];
  candidatePlans: CandidatePlan[];
  complianceResult?: ComplianceResult;
  finalRecommendationId?: string;
}
```

### 7.1 证据分类

- `fact`：接口或用户直接提供的事实。
- `computed`：根据原始数据计算的结果。
- `inference`：Agent 对事实的解释。
- `unknown`：缺失或无法确认的信息。

推断不得伪装成事实。

### 7.2 置信度定义

置信度表示证据的完整性与一致性，不表示上涨概率：

- `high`：核心数据完整，多个证据方向一致，反方证据已处理。
- `medium`：主要数据完整，但存在冲突或数据窗口有限。
- `low`：缺失重要信息，只能给出观察或风险提示。

## 8. 意图分类

```typescript
type ConversationIntent =
  | "onboarding"
  | "update_profile"
  | "record_holding"
  | "update_holding"
  | "portfolio_diagnosis"
  | "stock_analysis"
  | "buy_timing"
  | "add_position"
  | "hold_or_sell"
  | "stop_loss_take_profit"
  | "asset_suitability"
  | "market_or_sector_question"
  | "simulate_recommendation"
  | "explain_recommendation"
  | "decision_feedback"
  | "unknown";
```

### 8.1 意图识别结果

每次识别必须输出：

- 主意图。
- 可选次意图。
- 置信度。
- 涉及的标的。
- 涉及的持仓。
- 是否需要画像。
- 是否需要持仓数据。
- 是否需要追问。

## 9. 对话状态机

```text
idle
  -> classifying
  -> needs_profile
  -> needs_holdings
  -> needs_clarification
  -> planning
  -> gathering_data
  -> analyzing
  -> challenging
  -> risk_review
  -> compliance_review
  -> recommendation_ready
  -> awaiting_user_decision
  -> completed
```

异常终态：

- `blocked`：风险或合规阻断。
- `insufficient_evidence`：证据不足。
- `failed`：工具或运行时失败。
- `cancelled`：用户取消。
- `expired`：建议已超过有效期。

## 10. 首次用户建档

### 10.1 建档原则

- 每轮最多询问一个主要问题。
- 优先询问会改变建议边界的信息。
- 用户拒答时可使用保守默认值，但必须记录并展示。
- 画像未完成时，可以回答教育性问题，但不能输出个性化买卖建议。

### 10.2 建档字段

#### 资金与流动性

- 初始可投资资金。
- 每月可追加资金。
- 不可投资的保留现金。
- 未来 12 个月大额支出。
- 收入稳定程度。
- 负债和刚性支出。

#### 风险

- 最大可接受亏损金额。
- 最大可接受组合回撤比例。
- 发生 5%、10%、20% 下跌时的行为倾向。
- 是否接受个股高波动。
- 是否愿意分批买入和长期持有。

#### 目标

- 目标名称。
- 目标金额。
- 目标日期。
- 目标优先级。
- 是否允许本金阶段性亏损。

#### 偏好

- 个股、行业 ETF、宽基指数、基金、黄金或现金偏好。
- 排除行业或资产。
- 投资经验。
- 看盘频率。
- 期望持有周期。

### 10.3 风险分类

展示层使用：

- 稳健型。
- 均衡型。
- 进取型。

后端同时保存：

- `risk_willingness_score`：主观意愿。
- `risk_capacity_score`：客观承受能力。
- `effective_risk_level`：两者取更保守结果后的有效等级。
- `max_portfolio_drawdown_pct`。
- `max_single_asset_weight_pct`。
- `max_sector_weight_pct`。

## 11. 持仓录入

### 11.1 输入方式

- 对话文本。
- 结构化表单。
- MVP Fixture 一键导入。

### 11.2 文本解析流程

```text
用户文本
  -> 提取资产名称/代码/价格/数量/日期
  -> 匹配候选标的
  -> 判断资产类型
  -> 生成持仓草稿
  -> 返回确认卡
  -> 用户确认或修改
  -> 创建正式持仓
  -> 生成新的组合快照
```

### 11.3 持仓确认卡

必须包含：

- 标的名称与代码。
- 市场。
- 资产类型。
- 持仓数量。
- 平均成本。
- 买入日期，可为空。
- 关联目标。
- 当前价格和数据时间。

### 11.4 模糊输入处理

以下情况必须追问：

- 指数没有对应可交易产品。
- 股票名称匹配多个代码。
- 只提供金额，没有数量或成本。
- 只提供“半仓”，没有组合总资产。
- 成本与当前价格单位不明确。

## 12. 财务健康诊断

### 12.1 单资产指标

- 当前价格。
- 持仓成本。
- 持仓数量。
- 当前市值。
- 浮动盈亏金额。
- 浮动盈亏比例。
- 从持仓以来的最大回撤。
- 当前相对阶段高点回撤。
- 20/60/120 日波动与趋势。
- 流动性。
- 估值状态。
- 基本面状态。
- 事件风险。

### 12.2 组合指标

- 总资产和现金比例。
- 资产类别分布。
- 单一标的集中度。
- 行业和主题集中度。
- 前三大持仓占比。
- 标的相关性与隐含重复暴露。
- 组合浮盈亏。
- 组合回撤。
- 压力情景下的预估损失。
- 与用户风险约束的偏离。
- 与目标期限的匹配程度。

### 12.3 核心公式

```text
当前市值 = 当前价格 * 数量
浮动盈亏 = (当前价格 - 平均成本) * 数量
浮动盈亏率 = (当前价格 / 平均成本) - 1
持仓权重 = 当前持仓市值 / 组合总市值
当前回撤 = 当前价格 / 观察窗口最高价 - 1
```

复杂指标由确定性工具计算，Agent 只解释结果。

### 12.4 诊断输出

诊断只突出最重要的三项问题：

- 问题。
- 影响。
- 紧迫度。
- 建议先做什么。
- 需要补充什么信息。

诊断本身不等同于买卖建议。

## 13. 理财顾问问答

### 13.1 必要追问矩阵

#### 买入或入场时机

- 计划持有多久。
- 准备投入多少钱。
- 当前是否已持有同类资产。
- 最大可接受回撤。
- 偏好个股、行业 ETF 还是宽基指数。
- 资金近期是否需要使用。

#### 加仓

- 当前成本与持仓比例。
- 当前浮盈亏。
- 原始投资逻辑。
- 加仓后单票和行业仓位。
- 是否还有追加资金计划。

#### 卖出或减仓

- 当前成本与浮盈亏。
- 当前仓位。
- 持有原因是否变化。
- 资金是否即将使用。
- 用户更重视保住利润还是继续参与上涨。

#### 止损止盈

- 交易还是配置目的。
- 预期持有周期。
- 可接受损失金额。
- 标的波动水平。
- 是否存在基本面或事件失效条件。

## 14. 数据与工具能力

### 14.1 用户和持仓工具

```text
getUserProfile
updateUserProfile
listGoals
listHoldings
parseHoldingText
confirmHoldingDraft
createPortfolioSnapshot
```

### 14.2 市场与研究工具

```text
resolveInstrument
getMarketSnapshot
getHistoricalPrices
getFundamentals
getValuationMetrics
getCorporateEvents
getNewsEvidence
calculateTechnicalIndicators
```

### 14.2.1 真实数据接入契约

市场与研究工具不能直接由模型拼接供应商方法名，必须经过以下链路：

```text
Chief Advisor / Research Agent
  -> SkillRouter
  -> pandadata-api Skill
  -> PandadataAdapter
  -> .codex/skills/pandadata-api/scripts/call_api.py
  -> panda_data==0.0.12
  -> PandaAIQuant Data Service
```

P0 方法白名单：

| 业务能力 | Pandadata 方法 | 主要用途 |
| --- | --- | --- |
| 交易日对齐 | `get_trade_cal`, `get_prev_trade_date`, `get_last_trade_date` | 统一交易日和数据截止时间 |
| 股票行情 | `get_stock_daily`, `get_stock_rt_daily`, `get_stock_daily_pre`, `get_stock_daily_post` | 日线、实时和复权行情 |
| 复权因子 | `get_adj_factor` | 复权收益和回撤计算 |
| 基金/ETF | `get_fund_detail`, `get_fund_daily`, `get_fund_daily_pre`, `get_fund_daily_post` | ETF/基金详情与行情 |
| 指数 | `get_index_daily`, `get_index_weights`, `get_index_indicator` | 指数行情、成分和估值 |
| 财务 | `get_fina_reports`, `get_fina_performance`, `get_fina_forecast`, `get_audit_opinion` | 财务、业绩预告和审计意见 |
| 事件风险 | `get_restricted_list`, `get_stock_pledge`, `get_stock_shareholder_change`, `get_stock_status_change` | 解禁、质押、增减持和状态变化 |
| 宏观 | `get_macro_detail`, `get_macro_cal` | 宏观指标和经济日历 |
| 港美股 | `get_hk_daily`, `get_us_daily` | 港美股行情 |
| 量化因子 | `get_factor`, `get_adj_factor` | 因子和复权数据 |

每个方法调用必须先读取 `.codex/skills/pandadata-api/references/method-index.md`、`sdk-0.0.12.md` 和对应接口文档，确认方法已由 SDK 导出；不允许根据模型记忆猜测参数、字段、标的格式或认证步骤。API Skill 仅负责路由和契约，数值计算仍由确定性 TypeScript 工具完成。

每次真实调用生成 `DataSnapshot` 和 `SkillRun` 摘要，至少记录：

- Skill slug、版本、来源仓库和验证级别。
- Pandadata 方法名、脱敏参数、查询区间和数据日期。
- 返回行数、字段校验、质量状态和新鲜度。
- 原始响应是否被裁剪、错误分类和重试次数。

凭证只从运行环境或 Pandadata Skill 的运行时配置读取，不进入 SQLite、SSE、Evidence Lab 或模型上下文。

### 14.3 组合与风险工具

```text
calculateHoldingMetrics
diagnosePortfolio
calculateConcentration
calculateDrawdown
simulatePositionChange
runStressScenario
checkUserSuitability
```

### 14.4 建议与合规工具

```text
buildCandidatePlans
validateRecommendationSchema
checkRecommendationCompliance
persistRecommendation
recordUserDecision
createWatchConditions
```

## 15. 个股分析

### 15.1 分析维度

个股分析必须覆盖：

1. 用户适配性。
2. 估值。
3. 基本面。
4. 趋势与技术指标。
5. 事件与消息。
6. 资金与交易行为。
7. 组合影响。
8. 支持证据和反方证据。

### 15.2 估值

建议指标：

- PE-TTM。
- PE 历史分位。
- 行业 PE 中位数。
- PB。
- PS。
- 股息率。

公司亏损时，PE 标记为不可用，不得用负 PE 进行“低估”判断。

### 15.3 基本面

- 营收同比。
- 净利润同比。
- 扣非净利润同比。
- ROE。
- 毛利率变化。
- 经营现金流/净利润。
- 资产负债率。
- 业绩预告。
- 审计意见。

### 15.4 技术指标

- 20/60/120 日均线。
- MACD。
- RSI。
- 成交量与量比。
- 20/60 日涨跌幅。
- 当前和历史最大回撤。
- 波动率。

MACD 金叉必须同时标记：

- 日线或周线周期。
- 发生日期。
- 零轴上方或下方。
- 是否有成交量确认。
- 更高周期趋势是否一致。

MACD 只能作为趋势确认证据，不能独立触发买入建议。

### 15.5 事件与消息

证据优先级：

1. 公司和交易所公告。
2. 财报、业绩预告和审计意见。
3. 回购、分红、定增、配股和重大合同。
4. 股东增减持、质押、解禁和 ST 变更。
5. 机构调研和资金数据。
6. 财经媒体。
7. 社交媒体情绪。

每条事件保存：

- 来源。
- 发布时间。
- 事件发生时间。
- 影响周期。
- 原始事实。
- Agent 推断。
- 是否已经反映在价格中，允许为未知。

## 16. 买入建议

### 16.1 状态

- `observe`：观察。
- `trial`：试仓。
- `accumulate`：分批增配。

### 16.2 必填字段

- 适合程度：高、中、低。
- 建议仓位区间。
- 首笔仓位。
- 后续加仓条件。
- 参考观察区间。
- 止损条件。
- 止盈或再平衡条件。
- 建议期限。
- 有效期。
- 主要依据，最多三条。
- 反方证据，至少一条。
- 主要风险，最多三条。
- 替代方案。

### 16.3 参考区间

参考区间是观察和模拟区间，不是保证成交或收益的交易指令。

计算可组合：

- 历史估值分位。
- 历史波动区间。
- 均线和成交密集区。
- 组合允许投入的最高金额。

必须记录计算方法和有效期。

## 17. 卖出与持仓建议

### 17.1 状态

- `hold`：继续持有。
- `stop_adding`：停止加仓。
- `reduce`：分批减仓。
- `exit`：退出。

### 17.2 必填字段

- 建议减仓比例。
- 执行节奏。
- 触发原因。
- 减仓后的组合变化。
- 继续持有的主要风险。
- 不减仓的情景。
- 替代配置。
- 建议失效条件。

### 17.3 触发原因分类

- 价格与回撤。
- 基本面变化。
- 估值过高。
- 事件风险。
- 宏观或地缘事件，例如贸易冲突。
- 用户目标或流动性变化。
- 单票或行业仓位超限。
- 组合再平衡。

宏观事件只能作为风险情景之一，不能单独触发卖出。

## 18. 候选方案与情景模拟

每次建议至少形成两个候选方案，重要场景形成三个：

- 立即行动。
- 等待或持有。
- 替代配置。

模拟结果包含：

- 调整前后资产权重。
- 调整前后单票和行业集中度。
- 预估组合波动变化。
- 历史压力场景变化。
- 目标资金影响。
- 现金比例变化。
- 风险规则命中变化。

## 19. 合规与风险门

以下情况不能生成个性化买卖建议：

- 用户画像未达到最低完整度。
- 标的无法唯一确认。
- 持仓数量、成本或组合总资产缺失。
- 行情数据过期。
- 重要财务或事件数据冲突。
- 建议超出用户最大单票或行业仓位。
- 用户使用短期刚性资金进行高风险投资。
- 只有单一技术指标或单条新闻支持。
- 缺少反方证据。
- 置信度低。
- 用户要求保证收益或确定性预测。

降级输出：

- 教育性解释。
- 风险提示。
- 需要补充的信息。
- 观察条件。
- 暂不建议行动。

## 20. 用户决策闭环

用户可对建议执行：

- 模拟采纳。
- 拒绝。
- 稍后处理。
- 继续追问。
- 请求替代方案。

每次决策记录：

- 建议版本。
- 用户动作。
- 用户原因。
- 当时的组合快照。
- 当时的数据快照。
- 后续复核时间或触发条件。

用户反馈可影响后续解释方式和提醒频率，但不能自动放宽风险上限。

## 21. 后续观察条件

建议完成后生成零个或多个观察条件：

- 价格进入参考区间。
- 回撤达到阈值。
- 重新站上或跌破均线。
- 财报或业绩预告发布。
- 解禁、质押、减持等事件进入窗口。
- 单票或行业仓位超过上限。
- 建议即将过期。

MVP 不运行后台定时器。用户点击“触发演示事件”或重新进入会话时执行条件检查。

## 22. SSE 对话事件

Agent 通过 SSE 展示过程，但不得暴露内部推理文本。

允许展示：

- 意图识别完成。
- 正在补充用户信息。
- 正在获取数据。
- 已调用哪个业务工具。
- 哪个子 Agent 已完成。
- 风险规则命中。
- 合规通过、降级或阻断。
- 建议卡已生成。

禁止展示：

- 隐藏系统提示词。
- 模型内部思维链。
- 未脱敏的工具凭证。

## 23. 核心端到端流程

### 23.1 首次使用

```text
创建会话
  -> 用户表达目标
  -> 进入建档
  -> 风险情景问答
  -> 目标和资金采集
  -> 资产偏好采集
  -> 持仓录入与确认
  -> 生成画像摘要
  -> 生成首次组合诊断
```

### 23.2 科技板块入场

```text
用户提问
  -> 加载画像
  -> 检查科技持仓
  -> 追问投入金额与期限
  -> 分析板块回撤、估值、趋势和事件
  -> 模拟新增仓位后的集中度
  -> 形成观察/试仓/替代宽基方案
  -> 风险与合规审查
  -> 建议卡
  -> 模拟采纳或继续追问
```

### 23.3 黄金半仓浮盈

```text
用户提问
  -> 确认“半仓”的口径
  -> 获取成本、浮盈和目标
  -> 判断黄金在组合中的角色
  -> 分析继续加仓、持有、减仓三种方案
  -> 检查组合集中度和流动性
  -> 输出停止加仓或分批减仓的条件化建议
```

### 23.4 个股推荐

```text
用户要求推荐
  -> 检查画像和偏好
  -> 从持仓/自选/演示候选池筛选
  -> 每个候选执行八维分析
  -> 排除不满足风险和组合约束的标的
  -> 最多输出三个候选
  -> 每个候选同时给出适合原因和不适合原因
  -> 用户选择一个进入完整建议卡
```

## 24. MVP 范围

### 24.1 必须实现

- 单一演示用户。
- 三档风险画像。
- 一个目标。
- 股票、ETF、指数基金、黄金四类资产。
- 自然语言持仓解析与确认。
- 单资产和组合诊断。
- 个股分析。
- 买入、持有、停止加仓、分批减仓建议。
- 主动追问。
- 动态 Agent 委派。
- PandaData 真实数据接入：至少完成交易日、股票/ETF 行情、财务或指数估值中的一条真实调用链。
- `pandadata-api` Skill 加载、方法检索、SDK 版本校验和最小冒烟测试。
- 数据快照、Skill 运行和来源证据可在 Evidence Lab 中回放。
- 模拟采纳。
- Evidence Lab。
- 决策日志。
- 后续观察条件。
- SSE 过程展示。

### 24.2 不实现

- 注册登录。
- 多租户。
- 真实账户同步。
- 真实交易。
- 后台定时任务。
- 推送服务。
- Redis。
- 独立队列。
- 微服务。
- 全市场实时选股。

## 25. 非功能要求

- 首个 SSE 状态事件在请求后 500 毫秒内返回。
- 已接入真实数据时，完整建议在数据接口和模型延迟允许范围内返回，并展示数据时间；Fixture 回归场景在 15 秒内返回。
- 所有建议可通过 `recommendation_id` 回放。
- 相同 Fixture 和参数应生成一致的确定性计算结果。
- 所有工具输入输出通过 Zod 校验。
- Agent 失败时保留已完成的证据并返回可理解的降级结果。
- PandaData 不可用、认证失败或 Skill 契约不匹配时，不得静默伪装成实时数据；必须标记数据源状态并降级为观察提示。
- 用户重置 Demo 后可恢复到固定初始状态。

## 26. 验收标准

- 未建档用户不会直接收到个性化买卖建议。
- 模糊持仓不会未经确认写入数据库。
- Agent 会根据不同意图询问不同的缺失信息。
- 每项建议包含支持证据和反方证据。
- MACD、PE 或新闻不能单独触发建议。
- 建议包含仓位、期限、有效期和失效条件。
- 风险或合规节点可以降级或阻断建议。
- 用户可模拟采纳、拒绝和继续追问。
- 建议、数据、Agent 运行和用户决策能够完整追溯。
- 配置 Pandadata 凭证后，Agent 能通过 `pandadata-api` Skill 完成至少一次真实数据调用。
- 真实调用能记录准确的方法名、脱敏参数、数据日期、Skill 版本和质量状态。
- SDK 未导出或接口契约不匹配时，任务失败或降级，不生成伪造行情。
