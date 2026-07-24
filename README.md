# Money Whisperer

Money Whisperer 是一个面向个人投资研究与资产分析的多 Agent 原型项目。仓库目前已经具备较完整的金融业务 API、SQLite 持久化、安全查数、报告产物、分支模拟和提醒能力，但**尚未形成单一前端下的完整端到端产品**。

当前仓库包含两条需要明确区分的界面链路：

- 根目录 Next.js 应用：当前正式入口，提供 Mastra Supervisor 对话技术底座。
- `frontend_src/`：较完整的业务界面原型，使用 Supabase 和 Edge Functions，尚未接入根项目的 `/api/v1` 后端，也不参与根项目构建。

因此，本项目当前更准确的定位是：

> 可运行的 Agent 技术底座 + 金融业务后端原型 + 独立业务 UI 原型。

## 当前实现状态

| 能力 | 状态 | 说明 |
| --- | --- | --- |
| Supervisor 流式对话 | 可用 | 根页面通过 AI SDK v6 和 Mastra 调用 DeepSeek |
| Explorer / Reviewer 委派 | 可用 | 支持委派状态展示、线程记忆和刷新恢复 |
| 用户画像与风险测评 | 后端可用 | 包含画像草稿、三档风险评估、目标和主动追问接口 |
| 持仓管理 | 后端可用 | 支持手工录入、自然语言解析、确认、修改和删除 |
| 理财顾问建议 | 部分实现 | 有确定性建议规则、建议卡、合规降级和决策日志；尚非完整专业投研流程 |
| 智能查数 | 部分实现 | 已有 SQL AST、白名单和 SQLite authorizer；当前业务服务仍以固定查询模板为主 |
| 图表与财务报告 | 后端可用 | 支持 ECharts JSON、Markdown、版本、预览、修改和软删除；缺少正式 UI 入口 |
| A/B/C 分支模拟 | 后端可用 | 支持工作区、分支树、候选、切换、撤回和资产快照；候选策略目前为固定规则 |
| 静态资产分析 | 部分实现 | 有持仓、健康度、风险度、刷新和 MOCK 趋势接口；部分指标仍为简化口径 |
| 信息搜索 | 部分实现 | 包含知识库、Web、MCP HTTP adapter 和 RSS adapter |
| 自选与提醒中心 | 后端可用 | 包含自选 CRUD、阈值穿越、站内通知和通知偏好 |
| RSS | 后端可用 | 支持源管理、安全同步、解析、去重和读取接口 |
| 语义层 Metadata | 后端可用 | 包含领域、表、字段、逻辑外键和同步接口 |
| 业务导航与页面闭环 | 未集成 | `frontend_src` 尚未改接 `/api/v1`，根应用仍只有 Supervisor Playground |
| Evidence Lab / 完整可观测 | 部分实现 | 已有运行事件和证据接口，尚缺完整工具、Skill、数据快照回放链路 |

## 已实现的后端范围

### 对话与顾问

- 会话、消息、历史和输出偏好。
- 意图识别、画像缺失信息追问和回答恢复。
- 买入、持有、停止加仓、分批减仓、退出等结构化建议。
- 建议依据、反方证据、风险、替代方案、有效期和失效条件。
- 用户接受、拒绝、延后决策及观察条件。

### 数据与分析

- 受控 SQLite 只读查询。
- 单 SQL、表/函数白名单、AST 校验和 SQLite authorizer。
- 查询结果分块持久化、大小限制和过期时间。
- 组合持仓、健康分、风险分、集中度和数据质量。
- PandaData Python bridge 及资产刷新入口。
- 明确标记为 `MOCK/mock-trend-v1` 的演示趋势。

### 产物与模拟

- Markdown 财务报告和 ECharts Option 生成。
- Markdown、链接和 ECharts 配置净化。
- 产物版本、乐观锁、安全预览和软删除。
- Git 式模拟工作区、A/B/C 候选、分支树、历史切换和撤回。
- 模拟资产快照与“不创建真实订单”约束。

### 搜索、RSS 与提醒

- 本地 Markdown 知识库搜索。
- Web、MCP HTTP endpoint 和 RSS 多来源搜索。
- RSS URL/重定向安全校验、响应大小限制和条件请求。
- 自选列表、回撤/浮盈/价格观察条件、站内通知和通知偏好。

## 当前关键限制

以下能力尚不能视为产品级完成：

1. 根 Next.js 页面尚未接入 `/api/v1` 金融业务接口。
2. `frontend_src` 依赖外部 Supabase 表和 `advisor-chat`、`holdings-import`、`agent-workflow` 等 Edge Functions；这些后端不在当前仓库中。
3. 智能查数的 QueryPlan 生成器尚未接入主查询服务，当前查询主要选择固定数据表和字段。
4. 分支候选目前采用固定的保持、减仓 25%、减仓 50% 规则，不是完整的 AI 情景预测。
5. 资产回撤、收益、波动率、流动性和个股基本面/估值/技术指标仍未完整实现。
6. 当前仅有 Supervisor、Explorer 和 Reviewer，没有完全落地画像、研究、组合、风险、合规等专业 Agent 节点。
7. SSE 接口主要用于持久化事件重放，尚不是持续运行的实时推送通道。
8. Evidence Lab 尚不能完整回放 `tool_calls`、`skill_runs`、市场快照和每次 PandaData 方法契约。
9. 当前环境必须实际安装 `panda_data` 并通过 Doppler 注入认证信息后，才能执行真实 PandaData 链路。
10. 项目尚未提供 Dockerfile 或 Docker Compose。

详细产品、API 和数据库目标以 [`docs/`](./docs/) 中的设计文档为准。

## 技术栈

- Node.js `>=22.13.0`
- pnpm `10.29.3`
- Next.js `16.2.11`
- React `19.2.8`
- Mastra Core `1.52.0`
- AI SDK `6.0.234`
- DeepSeek OpenAI-compatible API
- SQLite / `better-sqlite3`
- Drizzle ORM
- Zod
- Vitest 与 Playwright

`frontend_src` 是独立的 Vite + React 18 + Supabase 原型，不属于根 Next.js 构建链。

## 目录结构

```text
src/
├─ app/
│  ├─ api/chat/                  # 当前 Supervisor Playground 接口
│  ├─ api/v1/                    # 金融业务 REST API
│  ├─ api/semantic-layer/        # 语义层 Metadata API
│  └─ page.tsx                   # 当前根页面，仅挂载 ChatShell
├─ features/chat/                # 根应用聊天 UI
├─ mastra/                       # Supervisor、子 Agent 和金融工具
└─ server/
   ├─ db/                        # SQLite runtime schema 与迁移
   ├─ chat/                      # AI SDK / Mastra 对话边界
   ├─ semantic-layer/            # 语义层服务
   └─ extensions/                # 查数、报告、模拟、搜索、RSS、提醒等

frontend_src/                    # 独立业务 UI 原型，当前使用 Supabase
scripts/call_api.py              # PandaData Python bridge
tests/unit/                      # 根 Agent 技术底座单元测试
tests/e2e/                       # 当前仅覆盖 Supervisor live 演示流程
docs/                            # 产品、模块、API、数据库和前端契约
```

## 快速开始

### 1. 安装依赖

```bash
pnpm install
```

### 2. 使用 Doppler 启动根应用

本项目禁止创建真实 `.env` 文件。开发环境使用 Doppler 的 `money-whisperer / dev_personal` 配置：

```bash
doppler login
doppler setup
doppler status
doppler run --project money-whisperer --config dev_personal -- pnpm dev
```

打开 <http://localhost:3000>。

根聊天页面需要 `DEEPSEEK_API_KEY`。未注入密钥时，离线测试仍可运行，但 live 对话不可用。

### 3. 离线验证

以下命令不需要真实模型密钥，也不会产生模型调用费用：

```bash
pnpm lint
pnpm typecheck
pnpm test
```

完整检查：

```bash
pnpm check
```

### 4. Live E2E

Live E2E 会调用 DeepSeek，需要网络并产生少量模型费用：

```bash
doppler run --project money-whisperer --config dev_personal -- pnpm test:e2e
```

当前 Playwright 场景验证：

- Explorer 和 Reviewer 委派。
- 流式最终回复。
- 第二轮线程记忆。
- 页面刷新后的会话恢复。

它尚未覆盖画像、持仓、智能查数、建议、分支模拟、产物、提醒或 RSS 的完整业务闭环。

## 环境变量

应用只读取进程环境变量。真实密钥必须由 Doppler、CI/CD Secret 或容器 Secret 注入，禁止写入本地 `.env`。

### 根应用

| 变量 | 必需性 | 用途 |
| --- | --- | --- |
| `DEEPSEEK_API_KEY` | Live 对话必需 | DeepSeek API Key，仅服务端读取 |
| `DEEPSEEK_MODEL` | 可选 | 模型名 |
| `DEEPSEEK_API_URL` | 可选 | OpenAI-compatible API 地址 |
| `DB_PATH` | 可选 | SQLite 文件路径，默认 `./data/mw-dev.db` |
| `PANDADATA_PYTHON` | 可选 | PandaData bridge 使用的 Python 可执行文件 |
| `DEFAULT_USERNAME` | PandaData 必需 | PandaData 登录用户名 |
| `DEFAULT_PASSWORD` | PandaData 必需 | PandaData 登录密码 |
| `JAVA_SERVICE_BASE_URL` | PandaData 必需 | PandaData 服务地址 |
| `MCP_SEARCH_URL` | MCP 搜索可选 | 当前 MCP 搜索 HTTP endpoint |
| `SEMANTIC_LAYER_DB_URL` | 可选 | 语义层数据库地址 |

### 独立前端原型

| 变量 | 必需性 | 用途 |
| --- | --- | --- |
| `VITE_SUPABASE_URL` | 必需 | Supabase 项目地址 |
| `VITE_SUPABASE_PUBLISHABLE_KEY` | 必需 | Supabase Publishable Key |

这些字段同样必须通过 Doppler 注入。不要为 Vite 或 Docker 创建本地 `.env` 文件。

## 数据与安全边界

- 默认数据库为 `./data/mw-dev.db`，`data/` 已被 Git 忽略。
- 业务 API 使用 `mw_session` HttpOnly Cookie 识别登录会话。
- 修改请求在已登录会话下要求匹配 `mw_csrf` 与 `X-CSRF-Token`。
- 没有有效会话时，当前 MVP 会降级到固定 `demo-user`。
- 智能查数仅允许白名单中的只读 SQLite 查询。
- 模型不能直接执行任意 SQL、访问文件路径或创建真实订单。
- Markdown、ECharts、RSS URL 和外部搜索结果均经过专门安全边界处理。
- 仓库中的 `.env.example` 与 `.env.prod.example` 只能保存不可用占位值。

## Doppler 配置约定

- 本地开发：`Development -> dev_personal`
- 生产环境：`Production -> prd`

在 Production (`prd`) 中保存变量时，如果 Doppler 提示：

> Please Confirm: Do you want to sync these secrets to other environments?

不要选择 Development 或 Staging，保持其他环境为空，避免生产密钥污染开发环境。

## 开发优先级

当前最重要的后续工作：

1. 选择唯一业务前端，并统一接入 `/api/v1`。
2. 补齐市场快照、工具调用、Skill 运行和证据关联真源。
3. 将 QueryPlan 和语义层真正接入智能查数主链路。
4. 完成个股/基金分析、真实组合指标和专业 Agent 协作。
5. 增加覆盖完整业务闭环的 Playwright E2E。

## 设计文档

- [对话 Agent 模块设计](./docs/superpowers/specs/2026-07-23-conversation-agent-module-design.md)
- [对话 Agent API 设计](./docs/superpowers/specs/2026-07-23-conversation-agent-api-design.md)
- [对话 Agent 数据库设计](./docs/superpowers/specs/2026-07-23-conversation-agent-database-design.md)
- [多 Agent 理财顾问产品设计](./docs/superpowers/specs/2026-07-23-agent-financial-advisor-design.md)
- [扩展能力需求](./docs/CONVERSATION_AGENT_EXTENSIONS_REQUIREMENTS.md)
- [扩展 API 设计](./docs/CONVERSATION_AGENT_EXTENSIONS_API.md)
- [扩展数据库设计](./docs/CONVERSATION_AGENT_EXTENSIONS_DATABASE.md)
- [前端接口文档](./docs/CONVERSATION_AGENT_FRONTEND_API.md)
- [语义层 Metadata 设计](./docs/semantic-layer-metadata-design.md)

## 参考

- [Mastra Agent Reference](https://mastra.ai/reference/agents/agent)
- [Mastra Supervisor Agents](https://mastra.ai/docs/agents/supervisor-agents)
- [Mastra Memory](https://mastra.ai/docs/memory/overview)
- [Doppler Documentation](https://docs.doppler.com/)
