# Money Whisperer

Money Whisperer 是一套单机部署的个人投资研究与资产分析工作台。当前仓库已收口为 `Next.js + SQLite/better-sqlite3 + Drizzle schema + /api/v1 + src/app/(workbench)` 的单套应用形态。

本项目只做研究、解释和模拟，不连接券商，不创建真实订单。

## 当前架构

| 层 | 当前真源 |
| --- | --- |
| 前端入口 | `src/app/(workbench)` 与 `src/app/login` |
| API | `src/app/api/v1` |
| 数据库 | `src/server/db`、SQL migrations、Drizzle schema |
| 认证 | 用户名密码、HttpOnly session、CSRF cookie/header、角色权限 |
| Agent 主链路 | Chief Advisor + 专业子 Agent + 服务端发布门 |
| 市场数据 | PandaData Python bridge，记录 tool/skill/probe/snapshot |
| 查数 | 结构化 QueryPlan、语义目录编译、SQLite 只读 authorizer |
| 模拟 | 冻结快照、候选分支、切换、撤回、资产快照 |

旧的独立前端原型已从正式源码中移出，不再作为构建入口；根项目只保留 `/api/v1` 业务接口。

## 主要能力

- 注册、登录、登出、当前用户、修改密码。
- 管理员用户列表、启用/禁用、角色调整、临时密码重置、最后管理员保护。
- 用户画像、风险问卷、风险评估、投资目标。
- 标的搜索、持仓录入、自然语言持仓解析确认、编辑、删除。
- 会话、消息、追问、输出偏好、分析详情、SSE 事件、Evidence Pack。
- Chief Advisor 专业建议链路：画像、数据研究、组合风险、建议、合规、解释报告。
- PandaData dry-run/live call、失败分类、数据新鲜度、市场快照和证据关联。
- 智能查数、查询历史、结果分块、图表/Markdown 产物、预览和编辑。
- 推荐卡、决策日志、模拟工作区、分支树、候选、执行、切换、撤回。
- 研究搜索、RSS 阅读与管理、自选、观察条件、通知中心、通知偏好。
- 管理端系统健康、语义层 Metadata、RSS 源、Demo Seed/Reset。

## 目录结构

```text
src/
├─ app/
│  ├─ (workbench)/              # 正式业务前端
│  ├─ login/                    # 登录/注册入口
│  └─ api/v1/                   # 唯一公开业务 API
├─ components/                  # UI 与桌面组件
├─ features/workbench/          # 迁移后的业务页面与客户端 API
├─ mastra/                      # Chief Advisor 模型入口与工具
├─ server/
│  ├─ auth/                     # 用户、Session、角色与管理能力
│  ├─ db/                       # SQLite client、迁移、Drizzle schema
│  ├─ extensions/               # Agent、查数、PandaData、模拟、RSS、通知等
│  ├─ http/                     # request context、idempotency helpers
│  └─ semantic-layer/           # 语义层 Metadata 服务
├─ services/                    # 前端业务服务适配
└─ proxy.ts                     # /api/v1 写请求 Origin/CSRF 防线

scripts/call_api.py             # PandaData Python bridge
docs/                           # 产品、API、数据库和模块设计文档
tests/                          # E2E 与辅助代码
```

## 环境变量

真实密钥必须由 Doppler、CI/CD Secret 或容器 Secret 注入。禁止创建或提交真实 `.env` 文件。

| 变量 | 必需性 | 用途 |
| --- | --- | --- |
| `DB_PATH` | 可选 | SQLite 文件路径，默认 `./data/mw-dev.db` |
| `APP_ORIGIN` | 生产建议必填 | 写请求 Origin 校验 |
| `DEEPSEEK_API_KEY` | 模型调用必需 | Chief Advisor 与 QueryPlan 模型 |
| `DEEPSEEK_MODEL` | 可选 | 模型名 |
| `DEEPSEEK_API_URL` | 可选 | OpenAI-compatible API 地址 |
| `PANDADATA_PYTHON` | PandaData 必需 | PandaData bridge Python 可执行文件 |
| `DEFAULT_USERNAME` | PandaData 必需 | PandaData 登录用户名 |
| `DEFAULT_PASSWORD` | PandaData 必需 | PandaData 登录密码 |
| `JAVA_SERVICE_BASE_URL` | PandaData 必需 | PandaData 服务地址 |
| `MCP_SEARCH_URL` | 可选 | MCP 搜索 HTTP endpoint |
| `ADMIN_USERNAME` | 可选 | 首个管理员初始化用户名 |
| `ADMIN_INITIAL_PASSWORD` | 可选 | 首个管理员初始化临时密码 |
| `ALLOW_REGISTRATION` | 可选 | 是否开放注册，默认 `true` |

示例骨架维护在 `.env.example` 和 `.env.prod.example`，其中只能放不可用占位值。

## 本地启动

```bash
pnpm install
doppler login
doppler setup
doppler run -- pnpm dev
```

打开 <http://localhost:3000>。

## Docker

Compose 文件只读取宿主进程变量，适合由 Doppler 注入：

```bash
doppler run -- docker compose up -d
```

应用数据写入命名 volume `money-whisperer-data`，容器内数据库默认路径为 `/app/data/money-whisperer.db`。

## 安全边界

- `mw_session` 只保存随机 token，数据库只保存 token hash。
- 已登录写请求必须通过 `mw_csrf` 与 `X-CSRF-Token` 双提交校验。
- 配置 `APP_ORIGIN` 后，写请求会校验 Origin。
- 修改类 API 使用 `If-Match` 做乐观锁；创建/执行类 API 使用 `Idempotency-Key`。
- 所有业务服务显式按 `userId` 过滤。
- 智能查数只允许语义目录生成的只读 SQL，并经过 AST 白名单与 SQLite authorizer。
- 金融金额、数量、价格和比例在核心服务中使用 decimal 字符串或整数基点。

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
