# Money Whisperer

> 黑客松参赛项目 · 开源个人投资研究工作台

Money Whisperer 是一个面向个人投资者的 AI 投资研究与资产分析工作台。它把用户画像、风险评估、持仓分析、市场研究、专业 Agent 对话、证据追踪、组合建议和情景模拟串成一个可回放的决策流程。

我们希望解决的问题很简单：投资工具经常直接给出一个“结论”，却没有把依据、反方证据、数据时间、风险边界和“如果不成立会怎样”讲清楚。

Money Whisperer 不替用户下单，而是帮助用户更好地理解自己的资产、比较不同方案，并保留每一步决策的证据和来路。

> 本项目仅用于研究、解释和模拟，不连接券商，不创建或执行真实交易订单，也不构成投资建议、收益承诺或代客理财。

## 黑客松亮点

- **多 Agent 协作**：Chief Advisor 协调画像、数据研究、组合风险、建议、合规审查、解释报告和情景规划等专业 Agent。
- **证据优先**：研究结果带有来源、观察时间、数据新鲜度、支持证据和反方证据，并可在 Evidence Lab 中回放。
- **可逆的分支模拟**：基于冻结组合快照生成保持、再平衡和降险等 A/B/C 方案，使用确定性引擎计算，模拟不会修改真实持仓。
- **从研究到行动闭环**：建议、决策日志、观察条件、提醒和通知连接起来，让一次分析可以持续被观察。
- **面向 Agent 的开放接口**：提供 A2A Agent Card 和 JSON-RPC 消息入口，可将 Chief Advisor 作为远程 Agent 接入其他系统。
- **真实工程边界**：包含用户隔离、CSRF、Origin 校验、幂等键、乐观锁、只读查数、内容清洗和 SSRF 防护等生产化基础能力。

## 产品工作流

```text
建立画像与目标
      ↓
录入持仓并生成组合快照
      ↓
Chief Advisor 理解问题并委派专业 Agent
      ↓
接入市场数据与研究来源，生成证据包
      ↓
输出建议、反方观点和失效条件
      ↓
生成 A/B/C 分支进行情景比较
      ↓
记录决策，并通过自选和提醒持续观察
```

## 演示路径

适合黑客松现场演示的最短路径：

1. 注册用户并完成风险问卷、画像和投资目标。
2. 在资产页搜索标的并录入持仓。
3. 进入 Advisor，询问“基于我的持仓做一次组合风险诊断”。
4. 查看专业 Agent 的分析过程、证据和数据时间。
5. 打开 Evidence Lab，查看证据包、引用和决策出处。
6. 创建模拟工作区，比较保持、再平衡和降险分支。
7. 在决策日志中记录选择，并在提醒中心查看后续观察条件。

## 主要能力

### 用户与资产

- 注册、登录、登出、密码修改和当前用户会话。
- 用户画像、风险问卷、风险评估、投资目标和流动性约束。
- 标的搜索与解析，支持 A 股及其他股票、基金、指数等资产。
- 持仓录入、自然语言持仓解析、编辑和删除。
- 组合快照、资产明细、健康度、集中度、回撤和趋势分析。

### AI 顾问与研究

- Chief Advisor 对话入口，支持追问、澄清问题和流式消息。
- 专业 Agent 协作：画像上下文、数据研究、组合风险、建议、合规审查、解释报告和情景规划。
- 多空辩论式分析，比较支持证据、反方证据、假设、反驳和未决问题。
- 基于证据的研究搜索，支持 Web、MCP、知识库和 RSS 来源。
- 推荐卡、建议详情、决策记录和可回放的分析过程。

### 证据、查数与产物

- Evidence Lab：查看证据包、数据快照、来源、时间、指标和决策出处。
- 语义层查数：由语义目录生成只读 QueryPlan，返回表格、图表或 Markdown 结果。
- 生成并管理图表、Markdown 和财务报告产物，支持预览、编辑、版本和删除。
- 分析任务状态、事件流、失败信息、取消和重试。

### 模拟与持续观察

- 创建模拟工作区，生成保持、再平衡、降险等候选方案。
- 通过 A/B/C 分支比较候选方案，支持分支树、切换、撤回和资产快照。
- 自选列表、观察条件、组合提醒、通知中心和通知偏好。
- RSS 阅读、源管理和按需同步。
- 后台调度器定期评估持仓与自选标的的观察条件。

### 管理与外部 Agent

- 管理员用户管理、系统健康检查、RSS 源管理和语义层 Metadata 管理。
- Demo 数据 bootstrap/reset，便于演示和端到端验收。
- A2A Agent Card、JSON-RPC/HTTP+JSON 消息入口和 SSE 流式入口，可将 Chief Advisor、多空辩论、情景模拟与独立研究作为远程 Agent 能力使用。

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
| `A2A_STREAM_MAX_DURATION_MS` | A2A 可选 | 单次 SSE 流最大持续时间，默认 `60000ms` |
| `ADMIN_USERNAME` | 可选 | 首次启动时创建的管理员用户名 |
| `ADMIN_INITIAL_PASSWORD` | 可选 | 首次启动时创建的管理员初始密码 |
| `ALLOW_REGISTRATION` | 可选 | 是否允许注册，默认 `true` |
| `TRUST_PROXY_HEADERS` | 反向代理部署必填 | 仅当入口代理会覆盖并清洗 `X-Forwarded-*`/`X-Real-IP` 时设为 `true` |

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

若 Compose 位于 Nginx、Caddy、Traefik 或云负载均衡器之后，必须由代理覆盖客户端传入的
`X-Forwarded-For`、`X-Forwarded-Proto` 与 `X-Real-IP`，再设置
`TRUST_PROXY_HEADERS=true`。直接暴露应用端口时保持为 `false`。

提醒调度器随 Node 常驻进程启动，每小时刷新活动持仓与观察列表；规则、降级行为和去重策略见
[`docs/notification-center.md`](./docs/notification-center.md)。

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

当前项目仍处于黑客松原型持续演进阶段，接口和数据模型可能发生变化。欢迎先开 Issue 讨论较大的功能或架构调整。

## 设计文档

- [`docs/CONVERSATION_AGENT_EXTENSIONS_REQUIREMENTS.md`](./docs/CONVERSATION_AGENT_EXTENSIONS_REQUIREMENTS.md)：扩展能力与验收范围
- [`docs/CONVERSATION_AGENT_EXTENSIONS_API.md`](./docs/CONVERSATION_AGENT_EXTENSIONS_API.md)：REST API 契约
- [`docs/CONVERSATION_AGENT_EXTENSIONS_DATABASE.md`](./docs/CONVERSATION_AGENT_EXTENSIONS_DATABASE.md)：数据库与状态模型
- [`docs/CONVERSATION_AGENT_FRONTEND_API.md`](./docs/CONVERSATION_AGENT_FRONTEND_API.md)：前端接口使用说明
- [`docs/semantic-layer-metadata-design.md`](./docs/semantic-layer-metadata-design.md)：语义层 Metadata 设计
- [`docs/notification-center.md`](./docs/notification-center.md)：提醒中心与调度策略
- [`docs/a2a-submission.md`](./docs/a2a-submission.md)：A2A Agent 提交说明
- [`docs/competition-qa-summary.md`](./docs/competition-qa-summary.md)：竞赛验收与 QA 摘要
- [`docs/superpowers/specs/`](./docs/superpowers/specs/)：产品和模块设计
- [`docs/superpowers/plans/`](./docs/superpowers/plans/)：实现计划与交付记录

## 许可证

本项目采用 [MIT License](./LICENSE) 开源。

你可以自由使用、复制、修改、合并、发布、分发、再许可和销售本项目的副本，但须保留原始版权声明和许可证文本。

## 免责声明

Money Whisperer 的输出仅用于投资研究、风险理解和情景模拟。市场数据可能延迟、缺失或失真，AI 输出也可能存在错误。任何投资决策都应由用户基于独立判断和适当的专业意见完成。
