# Money Whisperer 中英双语国际化升级设计

## 1. 目标

将 Money Whisperer 从以简体中文为默认假设的单语言投资研究工作台，整体升级为可由用户直接选择语言的中英双语产品。

首期支持：

- `zh-CN`：简体中文。
- `en-US`：美式英语。

首期继续保持现有业务边界：

- 以中国市场投资研究为主要金融语境。
- 以人民币 `CNY` 为默认和主要计价货币。
- 保留现有 A 股、港股、美股、基金和指数能力，不在本次重建全球市场数据平台。
- 不连接券商，不创建或执行真实交易订单。
- 不因语言切换改变风险计算、行情数据、组合事实、合规状态或结构化枚举。

成功标准：

- 用户在正式上线版本中可以从登录页、账户菜单和设置页直接选择“简体中文”或“English”。
- 登录、建档、风险测评、资产、Advisor、证据、报告、模拟、提醒、管理后台、系统健康和公开 A2A 文档全部支持中英文。
- API 错误、SSE 进度、通知、确定性降级文案和 AI 动态内容均跟随协商语言。
- 历史对话、报告、通知和证据摘要保留生成时语言，不因界面切换被重写。
- 同一对话允许出现中英文历史消息，新回复跟随本次请求语言。
- 中英文语言包通过自动化完整性检查，全部正式页面通过双语端到端和视觉回归。
- 英文版本与中文版本在同一个正式发布中一次性开放，不发布隐藏英文入口或页面覆盖不完整的过渡版本。

## 2. 当前状态与主要问题

项目当前技术栈为 Next.js 16、React 19、TypeScript、SQLite、Drizzle、Mastra、Vitest 和 Playwright。

现状审计显示：

- 约 4.2 万行 TypeScript/TSX 源码。
- 148 个源码文件包含中文。
- 中文文案分布在页面、组件、服务、API、数据库默认值、通知、风险问卷、AI 提示词、确定性 fallback、报告和测试中。
- 多处直接使用 `zh-CN`、`CNY` 和 `Asia/Shanghai` 格式化日期、金额和时间。
- 当前根布局固定输出 `<html lang="zh-CN">`。
- 当前没有统一的语言识别、语言包、服务端翻译、API 错误目录或内容语言字段。
- 85 个 `/api/v1` Route Handler 中存在大量直接构造的英文或中文用户错误。
- AI 提示词和确定性结果默认使用中文，生成任务没有持久化请求语言。
- 用户语言、消息语言、报告语言、通知语言和证据翻译状态未进入数据模型。
- 外部资讯的来源语言只在部分 RSS feed 中粗粒度记录，不能表示单条证据的原文和摘要语言。

因此，本次升级不是单纯抽取 UI 文案，而是对展示层、请求上下文、持久化内容、AI 生成链路、API 契约和质量门禁进行统一改造。

## 3. 已确认的产品决策

### 3.1 首期范围

- 只支持 `zh-CN` 和 `en-US`。
- 产品仍以中国市场和人民币计价为核心。
- 全部产品界面纳入首期，包括管理后台、系统健康和公开 A2A 文档。
- 固定产品文案由人工维护，不使用运行时机器翻译。
- AI 动态内容、报告、模拟结果、通知和 Advisor 回复全链路双语。

### 3.2 URL 与语言选择

- 不增加语言 URL 前缀。
- 现有 `/advisor`、`/assets`、`/api/v1/*` 和 A2A 地址保持不变。
- 用户可以直接设置语言。
- 用户切换语言后保留当前路径，仅刷新服务端和客户端语言上下文。

### 3.3 历史内容

- 历史内容保留生成时语言。
- 不在查看时自动翻译全部历史记录。
- 同一对话允许混合语言。
- 新消息、报告、模拟和通知按本次请求语言生成。

### 3.4 外部中文证据

- 原始标题、来源、链接和引用保持原文。
- 英文界面可以生成英文摘要。
- 英文摘要必须显示 `AI translated` 标识。
- 翻译不能改写数字、日期、证券代码、来源主体和结构化金融事实。

### 3.5 发布方式

- 采用一次性整体上线。
- 开发过程可以按模块分工和集成，但英文功能不会提前作为正式产品发布。
- 正式上线版本从登录页开始直接向用户开放语言设置。
- 不通过隐藏语言入口掩盖迁移不完整。

## 4. 非目标

- 不在首期支持繁体中文、日语、韩语或欧洲语言。
- 不在首期引入 `[locale]` 路由段或多语言 SEO 路由。
- 不在首期支持用户自由选择任意币种作为组合基准币。
- 不在首期建设证券名称人工翻译库。
- 不在首期自动翻译所有历史对话和历史报告。
- 不在首期为同一报告自动维护中英文同步副本。
- 不在首期按国家切换金融法规、税务规则或投资适当性制度。
- 不在首期重写投资计算、行情适配器、Agent 角色体系或模拟引擎。
- 不允许翻译数据库枚举、API 错误码、市场代码、证券代码、事件类型和 JSON 字段名。

## 5. 总体架构

### 5.1 技术路线

采用 `next-intl`，使用无语言路由模式。

```text
Browser / External Client
  -> account preference / mw_locale cookie / Accept-Language / A2A locale
  -> Locale Resolver
  -> LocaleContext
       -> Next.js layout and metadata
       -> Server Components
       -> Client translation provider
       -> Route Handlers and API errors
       -> Agent and background tasks
       -> Formatter service
  -> Persist content locale with generated content
```

不使用 `[locale]` 路由段，不复制中英文页面，不创建平行的英文业务代码。

### 5.2 目录边界

建议新增：

```text
src/i18n/
├─ config.ts                 # 支持语言、默认语言和类型
├─ resolve-locale.ts         # 账户、Cookie、请求头语言解析
├─ request.ts                # next-intl 请求级配置
├─ locale-context.ts         # 服务端通用 LocaleContext
├─ formatters.ts             # 日期、金额、数字、百分比格式
├─ errors.ts                 # API 错误消息解析
├─ content-language.ts       # 动态内容语言校验
└─ messages/
   ├─ zh-CN/
   │  ├─ common.json
   │  ├─ auth.json
   │  ├─ portfolio.json
   │  ├─ advisor.json
   │  ├─ evidence.json
   │  ├─ simulation.json
   │  ├─ notifications.json
   │  ├─ admin.json
   │  └─ errors.json
   └─ en-US/
      └─ 与 zh-CN 相同的业务域文件
```

页面和组件只消费消息键与 formatter，不自行判断语言或拼接本地化句子。

## 6. 语言类型与解析规则

### 6.1 支持语言

```typescript
export const SUPPORTED_LOCALES = ["zh-CN", "en-US"] as const;
export type AppLocale = (typeof SUPPORTED_LOCALES)[number];
export const DEFAULT_LOCALE: AppLocale = "zh-CN";
```

所有进入业务层的语言必须先归一化为 `AppLocale`。

可接受的请求别名：

- `zh`、`zh-CN`、`zh-Hans` 归一化为 `zh-CN`。
- `en`、`en-US` 归一化为 `en-US`。
- 其他值不报错，继续使用下一优先级或默认值。

请求语言和内容语言使用不同类型：

```typescript
export type ContentLocale = AppLocale | "und";
```

- `AppLocale` 表示产品能够渲染或生成的目标语言。
- `ContentLocale` 表示一段已保存内容的实际语言。
- 用户原文无法可靠判断是中文还是英文时记录为 `und`，但响应语言仍必须是有效 `AppLocale`。
- 外部来源的 `source_locale` 可以保存规范化 BCP 47 标签；无法识别时记录 `und`。

统一请求上下文：

```typescript
type LocaleContext = {
  locale: AppLocale;
  source: "a2a-parameter" | "account" | "cookie" | "accept-language" | "default";
  acceptLanguage: string | null;
};
```

业务服务显式接收 `LocaleContext` 或已解析的 `AppLocale`，不得自行读取 Cookie 或重复实现优先级。

### 6.2 Web 语言优先级

登录用户：

```text
users.preferred_locale
  > mw_locale Cookie
  > Accept-Language
  > zh-CN
```

未登录用户：

```text
mw_locale Cookie
  > Accept-Language
  > zh-CN
```

### 6.3 A2A 语言优先级

```text
显式 locale 参数
  > Accept-Language
  > zh-CN
```

A2A 外部客户端不读取产品用户账户偏好。

### 6.4 后台任务

定时任务和异步任务不能在执行时重新读取浏览器 Cookie。

创建任务时必须解析语言并写入任务记录。后续步骤只使用持久化的 `requestedLocale`。

主动通知调度器按目标用户的 `preferred_locale` 生成通知；为空时使用 `zh-CN`。

## 7. 用户语言设置

### 7.1 登录页

登录页右上角提供语言选择：

```text
简体中文
English
```

切换后：

- 立即更新登录页和注册相关文案。
- 写入 `mw_locale` Cookie。
- 后续登录请求发送对应 `Accept-Language`。
- 登录错误按所选语言返回。

### 7.2 登录后

顶部账户菜单和设置页均提供相同的语言选择。

登录用户切换语言时：

1. 调用 `PATCH /api/v1/profile/locale`。
2. 更新 `users.preferred_locale`。
3. 更新 `mw_locale` Cookie。
4. 更新客户端 API 默认 `Accept-Language`。
5. 刷新当前路由，使 Server Components、Metadata 和 Client Components 使用同一语言。

### 7.3 登录同步

用户登录成功后：

- 账户已设置 `preferred_locale`：账户偏好覆盖现有 Cookie。
- 账户未设置偏好：保留当前 Cookie/请求语言，不在登录时强制写入数据库。
- 用户后续主动切换时，才持久化账户偏好。

语言切换不清空表单、当前对话、查询参数或当前页面路径。

## 8. Next.js 集成

### 8.1 根布局

`src/app/layout.tsx` 改为请求级解析语言：

- 动态设置 `<html lang={locale}>`。
- 按语言生成 Metadata 标题和描述。
- 加载对应消息目录。
- 为客户端组件提供 `NextIntlClientProvider`。
- 不在客户端首次渲染后再修改 `lang`，避免 hydration 不一致。

### 8.2 Proxy

现有 `src/proxy.ts` 继续负责 API 写请求的 Origin 和 CSRF 校验。

语言无路由前缀，因此不增加重写或重定向逻辑。需要时仅在响应中补充或保持语言 Cookie，不把语言解析与安全校验耦合成一个大型函数。

### 8.3 服务端与客户端

- Server Components 使用服务端翻译 API。
- Client Components 使用 `useTranslations`。
- 共享领域常量保存稳定代码，不保存展示标签。
- 页面标题、导航、Toast、Tooltip、空状态、表头、表单标签和 ARIA 文案全部进入语言包。

## 9. 语言包与文案治理

### 9.1 消息键

消息键使用语义命名：

```text
common.actions.save
auth.login.invalidCredentials
portfolio.holdings.marketValue
advisor.progress.collectingEvidence
simulation.options.defensive
errors.PORTFOLIO_EMPTY
```

禁止使用中文原文或英文原文作为消息键。

### 9.2 基准语言

`zh-CN` 为基准目录。`en-US` 必须：

- 具有完全相同的消息键。
- 使用完全相同的 ICU 参数名。
- 不包含空字符串。
- 不遗漏复数、数字和日期参数。

### 9.3 固定标签

以下内容使用“稳定值 + 本地化标签”：

- 风险等级 `R1` 至 `R5`。
- 资产类型。
- 建议动作。
- 合规状态。
- 运行状态。
- 通知严重程度。
- 分支策略。
- 观察条件类型。
- Agent 角色展示名称。

数据库和 API 继续传递稳定值，UI 在最后展示阶段翻译。

### 9.4 风险问卷

风险问卷只保存：

- 稳定题目 ID。
- 稳定选项值。
- 分数。
- 风险等级。
- 冲突类型代码。

问题、帮助文字、选项标签、风险等级名称和冲突解释由语言包生成。

旧答案数据不因国际化改变评分含义。

### 9.5 术语表

建立中英术语表并作为人工审校标准，至少包括：

- 持仓、仓位、成本、浮盈亏。
- 最大回撤、波动、集中度、风险预算。
- 支持证据、反方证据、失效条件。
- 试仓、分批加仓、停止加仓、分批减仓。
- 组合快照、行情时间、数据质量。
- 研究用途、情景模拟、非投资建议。

同一结构化概念不允许在不同页面随意更换英文术语。

## 10. 区域格式

### 10.1 统一 formatter

所有显示层通过统一 formatter：

```typescript
formatMoney(amount, { locale, currency: "CNY" })
formatNumber(value, { locale })
formatPercent(value, { locale })
formatDate(value, { locale, style })
formatDateTime(value, { locale, timeZone, style })
```

禁止业务组件直接调用固定的：

- `toLocaleString("zh-CN")`
- `Intl.NumberFormat("zh-CN", ...)`
- `Intl.DateTimeFormat("zh-CN", ...)`

### 10.2 货币

首期组合基准货币仍为 `CNY`。

语言只改变表示方式，不改变金额：

- 中文可显示 `¥123,456` 或符合既有产品规范的人民币格式。
- 英文可显示 `CN¥123,456`，避免与其他使用 `¥` 的货币混淆。

### 10.3 时区

- 数据库存储继续使用 ISO 时间。
- 市场数据时间继续依据市场时区。
- 首期用户展示时区保持现有产品规则，不新增用户时区设置。
- 明确属于中国市场的通知继续按 `Asia/Shanghai` 解释，但格式化语言由 `locale` 决定。

市场时区与界面语言必须分离，英文界面不等于美国时区。

## 11. API 国际化

### 11.1 语言协商

Web 客户端所有 API 请求自动发送：

```http
Accept-Language: zh-CN
```

或：

```http
Accept-Language: en-US
```

API 响应增加：

```http
Content-Language: <resolved-locale>
```

### 11.2 错误目录

建立集中式错误目录。Route Handler 不直接构造面向用户的自然语言错误。

响应继续保持：

```json
{
  "error": {
    "code": "PORTFOLIO_EMPTY",
    "message": "No active holdings were found.",
    "details": {
      "portfolioId": "default"
    }
  }
}
```

规则：

- `code` 永远稳定，不翻译。
- `message` 按请求语言本地化。
- `details` 保存字段名、约束、机器值和可程序处理的数据。
- Zod 原始错误不能未经治理直接作为最终用户文案。
- 数据库、PandaData 和模型原始异常只进入安全日志。

### 11.3 API 辅助函数

统一使用：

```typescript
apiSuccess(request, data, options)
apiError(request, code, details, options)
```

辅助函数负责：

- 语言解析。
- 本地化错误消息。
- `Content-Language`。
- 现有 `meta`。
- HTTP 状态。
- 可重试标记。

### 11.4 SSE

SSE 保留稳定事件类型：

```text
agent.started
agent.completed
tool.started
evidence.added
compliance.completed
```

面向用户的进度使用：

- 服务端已本地化的 `title` 和 `content`；或
- 稳定消息键加结构化参数。

不允许客户端根据英文事件类型自行硬编码中文进度。

## 12. 数据模型与迁移

### 12.1 用户偏好

为 `users` 增加：

```text
preferred_locale TEXT NULL
```

约束为：

```text
NULL | zh-CN | en-US
```

旧用户保持 `NULL`，直到主动选择语言。

### 12.2 生成内容语言

增加以下字段：

| 表 | 字段 | 用途 |
| --- | --- | --- |
| `conversation_sessions` | `title_locale` | 会话标题生成语言，不锁定后续会话语言 |
| `messages` | `content_locale` | 每条用户或 Assistant 消息的内容语言 |
| `agent_runs` | `requested_locale` | 本次任务要求的输出语言 |
| `recommendations` | `content_locale` | 建议展示字段语言 |
| `notifications` | `content_locale` | 通知标题和正文语言 |
| `generated_artifacts` | `content_locale` | 产物标题及当前内容语言 |
| `generated_artifact_versions` | `content_locale` | 每个版本的内容语言 |
| `simulation_option_batches` | `content_locale` | 整批模拟方案的生成语言 |
| `information_requests` | `content_locale` | 澄清提示和字段标签语言 |

以上 `content_locale` 和 `title_locale` 使用 `ContentLocale`；任务目标语言 `requested_locale` 使用 `AppLocale`。

如果决策摘要、观察条件或其他 AI 动态内容没有独立表字段，则必须在对应记录的 `metadata_json` 中保存 `contentLocale`，并在后续专门迁移时升级为明确字段。

### 12.3 外部证据

为 `evidence_items` 增加：

```text
source_locale
summary_locale
translation_metadata_json
```

`translation_metadata_json` 至少包含：

```json
{
  "translated": true,
  "targetLocale": "en-US",
  "provider": "configured-model-provider",
  "model": "configured-model",
  "translatedAt": "2026-07-26T00:00:00.000Z",
  "sourceContentSha256": "..."
}
```

为 `rss_items` 增加：

```text
source_locale
```

feed 级 `language` 继续保留，但不能替代单条内容的来源语言。

### 12.4 历史数据回填

迁移规则：

- 历史会话标题、消息、建议、通知、产物主记录、产物版本、模拟选项批次和澄清请求回填 `zh-CN`。
- 历史 Agent 运行回填 `requested_locale = zh-CN`。
- 历史中文 RSS 和证据在无法可靠检测时回填 `source_locale = zh-CN`。
- 现有证据摘要回填 `summary_locale = zh-CN`。
- 不生成历史英文翻译。
- 不修改历史正文、标题、摘要或哈希。
- 用户 `preferred_locale` 不回填，保持 `NULL`。

迁移必须可在现有 SQLite 数据库上在线执行，并在执行前使用现有迁移备份机制创建备份。

## 13. AI 与 Agent 生成链路

### 13.1 请求契约

以下入口增加必填 `requestedLocale: AppLocale`：

- Advisor 对话。
- 专业子 Agent。
- 每日组合建议。
- 资产深度报告。
- 澄清问题。
- 分支模拟方案。
- 提醒触发后的 Advisor 分析。
- 数据查询生成的展示性总结。
- A2A 能力调用。

任务创建时将语言写入 `agent_runs.requested_locale`。

### 13.2 提示词结构

提示词分为：

1. 权威业务规则：金融事实、合规规则、Agent 边界、结构化上下文和数据新鲜度。
2. 输出语言契约：要求所有面向用户的展示字段使用 `requestedLocale`。

不维护两套独立的中英文合规规则，以免规则逐渐不一致。

系统可以使用一份权威规则模板，但必须明确告诉模型：

- 哪些字段是机器枚举。
- 哪些字段是面向用户的自然语言。
- 最终自然语言必须使用目标语言。
- 原始证券名称、代码、数字和引用不得被翻译改写。

### 13.3 结构化输出

以下机器字段保持英文稳定值：

- `action`
- `requestedDirection`
- `suitability`
- `status`
- `decision`
- `strategy`
- `provider`
- `agent`
- `eventType`

以下展示字段按目标语言生成：

- `summary`
- `conclusion`
- `rationales`
- `supportEvidence`
- `counterEvidence`
- `risks`
- `portfolioImpact`
- `invalidationConditions`
- `description`
- `disclaimer`

结构化结果增加 `contentLocale`，服务端校验其等于 `requestedLocale`。

### 13.4 语言质量校验

英文请求的长文本输出如果明显仍以中文为主：

1. 以相同结构化事实追加一次语言纠正重试。
2. 重试不得重新获取或改写市场事实。
3. 再次失败时标记语言质量降级。
4. 不能静默将中文结果标记为合格英文。

语言校验只用于发现明显不匹配，不以字符比例取代人工术语和内容质量审校。

### 13.5 确定性文案

以下内容不得依赖模型翻译：

- 模型未配置提示。
- 确定性 Advisor fallback。
- 画像或持仓缺失提示。
- 澄清表单问题和选项标签。
- 报告标题。
- SSE 进度。
- 通知标题和阈值描述。
- 合规免责声明。
- 空状态和失败状态。

这些文案全部进入人工维护的中英文目录。

### 13.6 混合语言对话

- 用户消息按原文保存，并记录检测或请求时的 `contentLocale`。
- Assistant 回复使用本次 `requestedLocale`。
- 用户在英文界面输入中文时，Assistant 仍以英文为主要输出语言。
- 证券名称、代码和引用原文可以保留中文。
- 对话标题按创建时语言生成，切换界面不自动改名。

### 13.7 报告和产物

- 报告在生成时确定语言并持久化。
- 查看时不重新生成。
- 修改产物内容时，新版本记录实际 `content_locale`。
- 首期不提供自动生成另一语言副本。
- 未来的“翻译副本”必须创建新版本或新产物，并保留来源版本关联。

## 14. 外部资讯与证据翻译

### 14.1 展示规则

英文界面展示中文来源时：

- 原始标题保持不变。
- 原始链接保持不变。
- 显示来源语言。
- 显示英文 AI 摘要。
- 显示 `AI translated`。
- 引用仍指向原始来源。

中文界面默认展示原始中文摘要，不额外生成中文翻译。

### 14.2 翻译缓存

缓存键：

```text
sourceContentSha256 + targetLocale
```

相同原文和目标语言不重复调用模型。

原文发生变化时，摘要指纹变化并生成新翻译。

### 14.3 事实保护

翻译步骤接收：

- 原始文本。
- 结构化数字和日期清单。
- 证券代码清单。
- 来源主体名称。

翻译结果返回后，服务端校验关键 token 未被删除或改写。无法通过时使用原文，并显示翻译不可用状态。

## 15. A2A 国际化

### 15.1 请求

A2A 支持显式：

```json
{
  "locale": "en-US"
}
```

也可以在 capability metadata 中传递。显式值优先于 `Accept-Language`。

### 15.2 响应

以下内容保持协议稳定：

- JSON-RPC 字段。
- capability ID。
- operation。
- task status。
- artifact type。
- error code。

以下内容按协商语言返回：

- Agent Card 的展示名称和描述。
- 用户错误消息。
- Advisor 最终内容。
- 报告和模拟说明。
- 任务进度展示文案。

### 15.3 Agent Card

Agent Card 的机器 ID 不变。可本地化描述通过请求语言或可扩展描述字段返回，不能为中英文发布两个不同能力 ID。

## 16. 前端迁移范围

必须迁移：

- `src/app/layout.tsx` Metadata 和 HTML language。
- 登录、注册、密码修改。
- 两套现存工作台布局和导航。
- 首页、资产、分析、Advisor、目标、画像、风险测评。
- Evidence Lab、报告产物和历史记录。
- 分支模拟、决策日志、自选、提醒、通知偏好和 RSS。
- 语义层管理、用户管理、RSS 管理和系统健康。
- Dialog、Toast、Tooltip、ARIA、加载、错误和空状态。
- 图表标题、图例、坐标标签、导出标题和 Markdown 模板。
- A2A 公开文档和 Agent Card 展示文本。

现有通用 UI primitive 中只有实际包含展示文案的部分需要迁移；纯样式和无文案组件不做无关改造。

## 17. 自动化质量门禁

新增：

```text
pnpm i18n:check
```

检查内容：

1. `zh-CN` 和 `en-US` 消息键完全一致。
2. ICU 参数名一致。
3. 不存在空翻译。
4. 不存在重复或未使用的高风险错误码映射。
5. 产品 UI、服务端用户错误、通知和确定性 fallback 中不存在未豁免硬编码文案。
6. 不允许新增固定 `zh-CN` formatter 调用。
7. AI 生成入口必须传入 `requestedLocale`。
8. 持久化动态内容必须写入 `contentLocale`。
9. API 用户错误码必须在错误目录注册。
10. `<html lang>` 不得固定为单一语言。

硬编码扫描允许列表：

- `src/i18n/messages/**`
- 原始 A 股标的数据。
- 测试输入和中英文断言。
- README 和设计文档。
- 明确标注的权威模型规则模板。
- 第三方或外部来源原文。

任何豁免必须按目录或精确规则登记，不能使用全仓库宽泛忽略。

## 18. 测试策略

### 18.1 单元测试

- 支持语言归一化。
- 账户、Cookie、`Accept-Language` 优先级。
- 登录后的账户偏好同步。
- 消息键和 ICU 参数一致性。
- 日期、金额、数字和百分比格式。
- 风险问卷稳定 ID 和本地化标签。
- API 错误目录。
- 动态内容语言字段回填。
- 证据翻译缓存键和事实保护。

### 18.2 API 契约测试

对用户可见错误分别发送：

```http
Accept-Language: zh-CN
Accept-Language: en-US
```

断言：

- HTTP 状态相同。
- 错误码相同。
- `details` 机器结构相同。
- `message` 使用请求语言。
- `Content-Language` 正确。

### 18.3 Agent 测试

同一结构化输入分别请求中英文：

- 机器枚举保持一致。
- 数值、日期、证券代码和市场事实保持一致。
- 展示字段语言正确。
- fallback、重试和合规阻止均能双语输出。
- 任务记录保存正确 `requested_locale`。

### 18.4 端到端测试

每个正式流程运行中文和英文两轮：

1. 登录和注册。
2. 用户语言设置及跨刷新保持。
3. 建档和风险问卷。
4. 持仓录入与自然语言解析。
5. Advisor 对话和澄清。
6. 组合建议和证据。
7. 资产深度报告。
8. 分支模拟。
9. 决策日志。
10. 自选、提醒和通知。
11. 历史记录和产物。
12. 管理后台和系统健康。
13. A2A 文档和请求语言协商。

### 18.5 混合历史测试

- 中文历史消息在英文界面保持中文。
- 同一对话的新回复为英文。
- 中文历史报告不被重写。
- 新英文报告记录 `en-US`。
- 切回中文后，英文历史内容仍保持英文。

### 18.6 视觉回归

至少覆盖桌面和移动端：

- 英文长按钮和导航。
- 表格标题与空状态。
- Advisor 消息和证据卡。
- 报告预览。
- 模拟方案卡和分支树。
- 管理后台表单。
- Dialog、Toast 和错误提示。

不允许文字溢出、重叠、裁切或因切换语言造成布局跳动。

### 18.7 完整验证

正式上线候选必须通过：

```text
pnpm lint
pnpm typecheck
pnpm test
pnpm i18n:check
pnpm build
pnpm test:e2e
```

双语 E2E 可以拆分 CI job，但所有 job 必须同时成功。

## 19. 开发组织与集成顺序

发布虽然只有一次，开发仍按以下依赖顺序集成：

1. 国际化配置、语言解析、formatter 和 Provider。
2. 数据库语言字段与历史回填。
3. 用户语言设置和认证流程。
4. API 错误目录、`Accept-Language` 和 `Content-Language`。
5. 通用布局、导航、UI 状态和风险问卷。
6. 资产、目标、画像和分析页面。
7. Advisor、澄清、SSE 和推荐。
8. 报告、产物、证据翻译和历史内容。
9. 模拟、提醒、通知和 RSS。
10. 管理后台、系统健康、A2A 和公开文档。
11. 全仓库硬编码清理、人工英文审校和双语回归。

每一步进入主集成分支后仍不得对正式环境提前开放不完整英文产品。

## 20. 一次性上线方案

### 20.1 上线前

- 建立完整页面和 API 覆盖清单。
- 完成中英文固定文案人工审校。
- 完成金融、风险和合规术语审校。
- 完成数据库迁移演练和恢复演练。
- 在生产数据副本上验证历史回填。
- 执行全量双语 E2E 和视觉回归。
- 执行缺失消息键和硬编码扫描。
- 进入文案冻结窗口，只接受缺陷修复。

### 20.2 部署

1. 备份 SQLite 数据库。
2. 部署包含完整中英文功能的应用版本。
3. 自动执行向后兼容语言字段迁移。
4. 执行健康检查和关键 API 探针。
5. 验证登录页语言选择可见并可用。
6. 验证登录用户语言偏好可保存、刷新和跨设备同步。
7. 验证中文和英文各一条完整 Advisor 到报告路径。

语言选择入口随该版本直接上线，不需要后续功能开关。

### 20.3 回滚

- 以整体应用版本回滚为主。
- 新增语言字段保持向后兼容，旧应用忽略额外列。
- 不通过隐藏语言入口代替回滚。
- 回滚前后均保留数据库备份和迁移记录。

## 21. 监控与运行指标

上线后监控：

- 缺失消息键次数。
- 不支持语言回退次数。
- `requestedLocale` 与生成结果语言不匹配次数。
- Agent 语言纠正重试和降级次数。
- 证据翻译成功、失败和缓存命中率。
- API 按 `Content-Language` 和错误码的分布。
- 语言切换接口失败率。
- 英文页面客户端异常和 hydration 错误。
- 中英文关键流程成功率差异。

日志记录语言代码和来源类型，不记录不必要的用户文本。

## 22. 风险与缓解

### 22.1 文案遗漏

风险：页面可见文案散落在 148 个源码文件中。

缓解：

- 自动硬编码扫描。
- 页面覆盖清单。
- 双语 E2E。
- 文案冻结。

### 22.2 AI 英文与中文事实不一致

风险：同一结构化输入生成不同金融结论。

缓解：

- 服务端事实和计算保持唯一来源。
- 机器枚举不翻译。
- 关键数字和证券代码做结果校验。
- 双语 Agent 契约测试。

### 22.3 后台通知语言错误

风险：后台任务没有浏览器上下文。

缓解：

- 创建任务时持久化语言。
- 主动通知读取账户偏好。
- 禁止后台任务从 Cookie 推断。

### 22.4 英文长文案破坏布局

缓解：

- 双语视觉回归。
- 稳定尺寸与响应式约束。
- 不依赖固定中文字符宽度。

### 22.5 API 客户端依赖 message

风险：现有客户端可能比较错误消息文本。

缓解：

- 审计并改为比较稳定错误码。
- API 契约测试保证 `code` 不变。
- `details` 提供程序所需信息。

### 22.6 一次性发布范围过大

缓解：

- 开发按依赖顺序集成。
- 正式环境只发布完整版本。
- 预发布环境进行全量验收。
- 使用明确的上线阻断标准。

## 23. 上线阻断条件

满足任一条件时禁止上线：

- 登录页不能直接选择语言。
- 任一正式页面缺少英文版本。
- 任一关键 API 返回未本地化用户错误。
- AI、通知、报告或模拟未记录内容语言。
- 英文 Agent 输出未通过人工金融术语审校。
- 存在未豁免的硬编码用户文案。
- 双语 E2E、构建、类型检查或迁移演练失败。
- 英文界面出现严重溢出、遮挡或不可操作。
- 数据库备份或整体应用回滚未完成演练。

## 24. 最终验收

国际化升级完成的定义：

- 用户无需修改 URL，可以在登录前后直接设置语言。
- 账户偏好、Cookie 和浏览器语言按既定优先级工作。
- 所有正式页面、用户错误、通知、动态内容和公开文档支持中英文。
- 历史内容保留原语言，新内容记录生成语言。
- 英文证据摘要明确标记为 AI 翻译，原始证据身份不变。
- 金融事实、计算结果、合规状态和机器协议不因翻译改变。
- 全量质量门禁、双语回归、数据迁移和回滚演练通过。
- 中英文能力在同一次正式发布中完整交付。
