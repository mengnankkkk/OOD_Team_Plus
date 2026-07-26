# Money Whisperer

> 一个会分析、会辩论、能解释，也能陪你比较不同投资方案的多 Agent 投资研究工作台。

Money Whisperer 是一个面向个人投资者的 AI 投资研究与资产分析工作台。

它将用户画像、风险评估、持仓分析、市场研究、多空博弈辩论、AI 理财顾问对话、证据追踪、组合建议和情景模拟连接起来，形成一个完整、可解释、可回放的多 Agent 投资研究系统。

Money Whisperer 不替用户下单，也不会把模型生成的结论包装成确定答案。系统会结合用户的资金情况、风险承受能力、投资目标和实际持仓，组织多个专业 Agent 分别完成研究、分析、质疑、风险检查和结果解释，为用户提供有依据、可验证的持仓观察与调整参考。

用户看到的不只是“买入、卖出或继续持有”，还包括结论背后的数据来源、支持证据、反方证据、风险因素、失效条件，以及不同方案可能带来的组合变化。

> 本项目仅用于投资研究、风险理解和情景模拟，不连接券商，不创建或执行真实交易订单，也不构成投资建议、收益承诺或代客理财。

## 为什么需要 Money Whisperer

传统投资工具通常只展示行情、指标或单一结论，却很少回答这些更重要的问题：

- 这项判断基于哪些数据和证据？
- 有没有值得重视的反方观点？
- 当前数据是否仍然有效？
- 结论在什么情况下可能失效？
- 一项操作会如何影响整个投资组合？
- 除了立即买入或卖出，还有哪些更稳妥的选择？

Money Whisperer 希望把这些问题放回投资决策过程本身。它不是一个只负责生成答案的聊天机器人，而是一套围绕个人资产、证据研究、风险分析、方案比较和持续观察构建的投资研究工作台。

## 适合谁使用

Money Whisperer 主要面向希望独立理解投资决策的个人投资者：

- **刚开始投资的新手**：希望了解自己的风险承受能力、资产结构和常见投资风险。
- **已经持有多种资产的投资者**：希望识别集中度、回撤、流动性和组合配置问题。
- **习惯自主研究的投资者**：希望同时查看支持观点与反方观点，而不是只接受单一结论。
- **需要持续跟踪的用户**：希望把一次研究转化为观察条件、提醒和后续决策记录。
- **关注 AI 可解释性的用户**：希望知道模型使用了什么数据、如何形成结论，以及结论有哪些限制。

## Money Whisperer 如何工作

一次完整的使用流程通常包括：

1. 用户完成风险问卷，建立个人画像和投资目标。
2. 录入当前持仓，系统生成资产快照和组合健康诊断。
3. 用户向 Chief Advisor 提出投资问题。
4. Chief Advisor 根据问题调度不同的专业 Agent。
5. 研究 Agent 获取市场数据、资讯和相关证据。
6. 组合与风险 Agent 分析操作对整体资产的影响。
7. 多空 Agent 从正反两面审视投资假设。
8. 合规与解释 Agent 检查风险边界并整理最终报告。
9. 用户通过情景模拟比较保持、再平衡或降低风险等方案。
10. 最终选择被记录到决策日志，并可以转化为持续观察条件。

整个过程会保留数据来源、分析时间、Agent 执行过程和决策依据，方便用户复查与回溯。

## 主要能力

### 了解自己的资产与风险

Money Whisperer 会先了解用户，而不是脱离实际情况直接生成结论。

- 通过风险问卷评估风险承受能力。
- 记录收入、支出、负债、可投资资金和流动性需求。
- 建立投资目标、目标金额、投资期限和资产偏好。
- 搜索并录入股票、基金、指数等持仓。
- 支持自然语言录入持仓，并在确认后写入资产组合。
- 分析资产配置、集中度、回撤、流动性和组合健康度。
- 通过组合快照观察资产结构随时间发生的变化。

### 与 AI 投资顾问对话

Chief Advisor 是用户与整个多 Agent 系统之间的统一入口。

用户可以直接提出自然语言问题，例如：

- “我的持仓是不是太集中？”
- “这只股票现在适合继续加仓吗？”
- “如果市场继续下跌，我的组合可能受到多大影响？”
- “帮我比较继续持有、减仓和重新配置三种方案。”
- “这条建议使用了哪些数据？有没有相反证据？”

当信息不足时，顾问会主动追问投资期限、资金用途、最大可接受回撤等关键信息，而不是在缺少上下文时直接给出答案。

### 多 Agent 专业协作

不同 Agent 分别承担清晰的研究职责：

- **画像 Agent**：理解用户资金情况、目标、约束和风险偏好。
- **数据研究 Agent**：获取行情、基本面、市场信息和研究材料。
- **组合风险 Agent**：分析集中度、波动、回撤和资产暴露。
- **多空辩论 Agent**：分别构建支持观点与反方观点，并相互质询。
- **建议 Agent**：根据用户情况整理可执行的观察或调整方案。
- **合规审查 Agent**：检查证据完整性、风险表达和结论边界。
- **解释报告 Agent**：将复杂分析整理为用户可以理解的报告。
- **情景规划 Agent**：生成不同组合调整方案，用于模拟比较。

Chief Advisor 负责组织这些 Agent 的协作，并汇总最终结果。

### 多空博弈与反方审视

Money Whisperer 不只寻找支持某个结论的材料。多空辩论模式会围绕同一个投资假设，分别展示：

- 支持该判断的核心证据。
- 可能推翻该判断的反方证据。
- 双方依赖的关键假设。
- 对证据质量和数据时效性的质疑。
- 当前仍无法确认的问题。
- 需要持续观察的失效条件。

这能帮助用户避免只关注符合自己预期的信息，也让 AI 的结论更容易被检查和质疑。

### Evidence Lab 证据实验室

每一项重要结论都应当能够追溯。Evidence Lab 用于集中查看：

- 数据和研究材料的来源。
- 数据对应的观察时间和更新时间。
- 支持证据与反方证据。
- 市场快照和组合指标。
- Agent 使用过的工具及执行结果。
- 建议形成过程和风险检查结果。
- 情景模拟使用的价格与资产快照。

用户可以从最终建议返回原始证据，判断结论是否可靠、是否过时，以及是否适用于自己的情况。

### 语义查数与研究产物

用户可以使用自然语言提出数据问题，由系统转换为受控的只读查询计划。

系统可以生成：

- 结构化数据表格。
- 趋势图和组合图表。
- Markdown 研究摘要。
- 资产分析报告。
- 组合诊断报告。
- 可保存和继续编辑的研究产物。

查询过程受到只读限制，不会通过自然语言查询修改业务数据。

### 组合情景模拟

对于重要决策，Money Whisperer 不要求用户立刻接受某一项建议。系统可以基于当前组合快照生成多个候选方案，例如：

- 保持现有配置，继续观察。
- 降低高集中度持仓。
- 调整资产比例，使组合更加均衡。
- 增加现金缓冲，降低整体风险。
- 使用分批操作代替一次性调整。

用户可以通过 A/B/C 分支查看不同方案下的资产配置、风险指标和预期变化，并在分支之间切换或撤回。

所有模拟都基于冻结快照运行，不会修改用户录入的真实持仓。

### 决策记录与持续观察

一次分析不应在关闭页面后失去价值。用户可以：

- 接受、拒绝或暂缓一项建议。
- 记录自己的决策理由。
- 查看过去的建议和决策过程。
- 将关键风险转化为观察条件。
- 把关注的标的加入自选列表。
- 接收持仓集中、价格变化和条件触发提醒。
- 从提醒直接返回顾问，发起新一轮分析。

这使研究、决策和后续观察形成持续闭环。

### 开放能力与外部 Agent 接入

除完整的用户工作台外，Money Whisperer 还提供标准化 Agent 接口：

- 通过 A2A Agent Card 描述 Agent 能力和调用方式。
- 通过 JSON-RPC 消息入口调用 Chief Advisor。
- 支持将投资研究能力接入其他 Agent 平台或业务系统。
- 提供独立的 REST API，用于资产、研究、模拟、提醒和证据管理。
- 提供系统健康、RSS、用户和语义层管理能力。

这使 Money Whisperer 不仅是一个可直接使用的产品，也可以作为开源投资研究 Agent 的基础设施继续扩展。

## 技术栈

| 类别 | 技术 |
| --- | --- |
| Web 应用 | Next.js 16、React 19、TypeScript |
| UI | Tailwind CSS、Radix UI、Lucide、Recharts |
| Agent | Mastra、DeepSeek OpenAI-compatible API |
| 数据库 | SQLite、better-sqlite3、Drizzle schema/migrations |
| 市场数据 | PandaData Python SDK bridge |
| 测试 | Vitest、Playwright |
| 部署 | Next standalone、Docker Compose |

运行时要求：

- Node.js `>= 22.13.0`
- pnpm `10.29.3`
- PandaData 功能需要 Python 3 和 `panda_data==0.0.12`

## 快速开始

### 1. 安装依赖

```bash
pnpm install
```

如果需要接入 PandaData：

```bash
python3 -m venv .venv-pandadata
. .venv-pandadata/bin/activate
pip install -r requirements.txt
```

### 2. 配置环境变量

本地开发可以从示例文件开始：

```bash
cp .env.example .env.local
```

至少配置 AI 顾问所需的 `DEEPSEEK_API_KEY`。PandaData、远程搜索和 A2A 是按功能启用的可选集成，变量说明见[环境变量](#环境变量)。

### 3. 启动开发服务器

```bash
pnpm dev
```

打开 <http://localhost:3000>。

SQLite 数据库默认位于 `./data/mw-dev.db`。应用首次访问数据库时会自动执行 `src/server/db/migrations` 中尚未应用的迁移；数据库文件存在时，迁移前会在 `data/backups/` 创建备份。

## 常用命令

```bash
# 开发
pnpm dev

# 生产构建与启动
pnpm build
pnpm start

# 代码质量
pnpm lint
pnpm typecheck

# 单元测试与 API 契约测试
pnpm test

# Playwright 端到端测试
pnpm test:e2e

# 完整检查
pnpm check

# 生成、应用 Drizzle 迁移
pnpm db:generate
pnpm db:migrate
pnpm db:push

# 分支模拟 API smoke test
pnpm smoke:branch
```

端到端测试会自动构建独立的 `.next-e2e` 产物，并使用临时 SQLite 数据库，不会覆盖本地开发数据。

## 环境变量

真实密钥不要提交到仓库。开发环境使用 `.env.local`，生产环境使用 Doppler、CI/CD Secret 或容器 Secret。

| 变量 | 必需性 | 说明 |
| --- | --- | --- |
| `DB_PATH` | 可选 | SQLite 路径，默认 `./data/mw-dev.db` |
| `APP_ORIGIN` | 生产建议必填 | 写请求 Origin 校验，以及 A2A Agent Card 的公开地址 |
| `DEEPSEEK_API_KEY` | AI 功能必需 | 顾问、查询计划和情景规划的模型调用密钥 |
| `DEEPSEEK_MODEL` | 可选 | 模型名称，默认 `DeepSeek-Pro` |
| `DEEPSEEK_API_URL` | 可选 | OpenAI-compatible API 地址 |
| `PANDADATA_PYTHON` | PandaData 必需 | Python 可执行文件路径 |
| `DEFAULT_USERNAME` | PandaData 必需 | PandaData 用户名 |
| `DEFAULT_PASSWORD` | PandaData 必需 | PandaData 密码 |
| `JAVA_SERVICE_BASE_URL` | PandaData 必需 | PandaData 服务地址 |
| `MCP_SEARCH_URL` | 可选 | MCP 搜索服务地址 |
| `FIRECRAWL_API_KEY` | 可选 | Firecrawl/MCP 搜索密钥 |
| `FIRECRAWL_SEARCH_URL` | 可选 | Firecrawl 搜索地址 |
| `A2A_BEARER_TOKEN` | A2A 必需 | A2A 远程调用的 Bearer token |
| `ADMIN_USERNAME` | 可选 | 首次启动时创建的管理员用户名 |
| `ADMIN_INITIAL_PASSWORD` | 可选 | 首次启动时创建的管理员初始密码 |
| `ALLOW_REGISTRATION` | 可选 | 是否允许注册，默认 `true` |

完整占位配置见 `.env.example` 和 `.env.prod.example`。

## Docker 部署

构建并启动：

```bash
docker compose build
docker compose up -d
```

生产环境建议通过 Doppler 注入变量：

```bash
doppler run -- docker compose up -d
```

Compose 默认将应用绑定到 `127.0.0.1:3000`，可通过 `HOST_BIND_ADDRESS` 和 `HOST_PORT` 调整。数据库持久化在 Docker volume `money-whisperer-data`，容器内路径为 `/app/data/money-whisperer.db`。

容器提供健康检查：

```text
GET /api/v1/health
```

仓库中的 `.github/workflows/deploy.yml` 使用 GitHub Actions + Doppler + SSH 在生产机上构建并重启 Docker Compose 服务。

## 架构与目录

```text
src/
├─ app/
│  ├─ (workbench)/             # 正式工作台页面与路由
│  ├─ login/                   # 登录/注册入口
│  ├─ api/v1/                  # 业务 REST API
│  ├─ api/a2a/                 # A2A JSON-RPC 消息入口
│  ├─ .well-known/             # Agent Card
│  └─ docs/                    # 可访问的 A2A 提交说明
├─ features/
│  ├─ frontend-migration/      # 前端运行时适配、认证和 Query Provider
│  └─ workbench/               # 工作台页面、组件和客户端 API
├─ components/                 # 通用 UI 与桌面组件
├─ layouts/                    # 工作台布局
├─ mastra/
│  ├─ agents/                  # Chief Advisor 与 Agent 入口
│  └─ tools/                   # Agent 工具
├─ server/
│  ├─ a2a/                     # Agent Card 与远程消息处理
│  ├─ auth/                    # 用户、Session、角色和管理员能力
│  ├─ db/                      # SQLite client、schema、迁移
│  ├─ extensions/              # 顾问、分析、查数、搜索、模拟、RSS、通知等
│  ├─ semantic-layer/          # 语义层 Metadata 与同步
│  ├─ health/                  # 系统健康检查
│  └─ http/                    # 请求上下文、ID 和幂等辅助函数
├─ services/                   # 前端业务服务适配
├─ hooks/                      # 客户端 hooks
└─ lib/                        # 领域计算、工具和共享逻辑

scripts/                       # PandaData bridge、E2E server、smoke test
tests/
├─ unit/                       # 跨模块单元测试
└─ e2e/                        # Playwright 业务流程测试
docs/                          # API、数据库、产品和模块设计文档
```

## API 与 Agent 入口

### 工作台 API

业务 API 统一位于 `/api/v1`，按领域拆分为：

- `auth`、`profile`、`goals`、`risk-assessments`、`onboarding`
- `instruments`、`holdings`、`portfolio-analysis`
- `conversations`、`analyses`、`recommendations`、`decisions`
- `data-queries`、`generated-artifacts`、`research-searches`
- `simulation-workspaces`、`watchlists`、`observation-conditions`
- `notifications`、`notification-preference`、`rss`
- `admin`、`demo`、`health`

具体请求/响应契约见 [`docs/CONVERSATION_AGENT_EXTENSIONS_API.md`](./docs/CONVERSATION_AGENT_EXTENSIONS_API.md)。

### A2A

| 地址 | 用途 |
| --- | --- |
| `/.well-known/agent-card.json` | Agent 能力、协议和认证信息 |
| `POST /api/a2a/message-send` | A2A JSON-RPC 消息入口 |
| `/docs/a2a-submission` | A2A 提交说明和请求示例 |

A2A 请求使用：

```http
Authorization: Bearer <A2A_BEARER_TOKEN>
```

调用链为：

```text
A2A / 工作台
  -> Chief Advisor
  -> 专业 Agent 协作
  -> 证据、风险与合规发布门
  -> Markdown / JSON / 分析产物
```

发布门会根据证据完整性和运行状态产生 `ACTIVE`、`DEGRADED` 或 `BLOCKED` 结果。

## 安全边界

- Session 使用 HttpOnly Cookie；数据库只保存 session token 的 hash。
- 已登录的写请求需要 `mw_csrf` Cookie 与 `X-CSRF-Token` 双提交校验。
- 配置 `APP_ORIGIN` 后，写请求会额外校验 Origin。
- 修改类接口使用 `If-Match` 进行乐观锁控制；创建、执行和同步类接口使用 `Idempotency-Key`。
- 所有业务查询按当前 `userId` 隔离，客户端不能自行提交身份字段代替服务端会话。
- 语义查数只允许只读 SQL，并经过 QueryPlan、SQL AST 白名单和 SQLite authorizer。
- Web/RSS 来源会执行 URL 安全检查，Markdown 和 ECharts 产物会经过清洗。
- 金额、数量、价格和比例在核心服务中使用 decimal 字符串或整数基点，避免浮点误差。
- 分支模拟只移动模拟分支指针和快照，不写入真实持仓。

## 参与开源

欢迎通过 Issue、Discussion 或 Pull Request 参与：

1. Fork 仓库并创建功能分支。
2. 保持改动聚焦，并补充必要的单元测试或端到端测试。
3. 提交前运行 `pnpm check`。
4. 在 Pull Request 中说明背景、方案、验证方式和已知限制。

适合贡献的方向：

- 增加新的市场数据、搜索或知识库适配器。
- 改进 Agent 评测、证据回放和提示词可观察性。
- 扩展组合分析、回测和情景模拟能力。
- 补充多语言、可访问性、部署文档和示例。

当前项目仍在持续演进，接口和数据模型可能发生变化。欢迎先开 Issue 讨论较大的功能或架构调整。

## 设计文档

- [`docs/CONVERSATION_AGENT_EXTENSIONS_REQUIREMENTS.md`](./docs/CONVERSATION_AGENT_EXTENSIONS_REQUIREMENTS.md)：扩展能力与验收范围
- [`docs/CONVERSATION_AGENT_EXTENSIONS_API.md`](./docs/CONVERSATION_AGENT_EXTENSIONS_API.md)：REST API 契约
- [`docs/CONVERSATION_AGENT_EXTENSIONS_DATABASE.md`](./docs/CONVERSATION_AGENT_EXTENSIONS_DATABASE.md)：数据库与状态模型
- [`docs/CONVERSATION_AGENT_FRONTEND_API.md`](./docs/CONVERSATION_AGENT_FRONTEND_API.md)：前端接口使用说明
- [`docs/semantic-layer-metadata-design.md`](./docs/semantic-layer-metadata-design.md)：语义层 Metadata 设计
- [`docs/notification-center.md`](./docs/notification-center.md)：提醒中心与调度策略
- [`docs/a2a-submission.md`](./docs/a2a-submission.md)：A2A Agent 提交说明
- [`docs/superpowers/specs/`](./docs/superpowers/specs/)：产品和模块设计
- [`docs/superpowers/plans/`](./docs/superpowers/plans/)：实现计划与交付记录

## 许可证

本项目采用 [MIT License](./LICENSE) 开源。

你可以自由使用、复制、修改、合并、发布、分发、再许可和销售本项目的副本，但须保留原始版权声明和许可证文本。

## 免责声明

Money Whisperer 的输出仅用于投资研究、风险理解和情景模拟。市场数据可能延迟、缺失或失真，AI 输出也可能存在错误。任何投资决策都应由用户基于独立判断和适当的专业意见完成。
