# Money Whisperer

Money Whisperer 当前是一个最小、可运行的多 Agent 对话技术底座。它使用 Mastra Supervisor 调度两个通用子 Agent，并通过 DeepSeek 完成流式对话。

> 当前阶段只验证 Agent loop，不提供任何金融、理财或投资建议能力。

## 当前能力

- Next.js App Router 中的 AI SDK v6 流式聊天
- Mastra Supervisor 按需委派 `Explorer` 和 `Reviewer`
- Mastra Memory + LibSQL `:memory:` 多轮上下文
- 同一浏览器标签页刷新后恢复当前会话
- 精简展示子 Agent 的协作中、完成和失败状态
- Zod 请求校验、取消生成、重复提交拦截及错误脱敏
- Vitest 离线测试和一条真实 DeepSeek Playwright 演示流程
- Supervisor、Explorer 和 Reviewer 均限制单轮输出长度，减少委派链路等待时间

暂未实现：金融业务、用户账户、长期持久化、Fixture、量化函数、ECharts、Zustand、Docker、Python Skill。需要实际功能时再引入，仓库中不保留这些功能的空壳。

## 技术要求

- Node.js `>=22.13.0`
- pnpm `10.29.3`
- DeepSeek API Key（仅真实聊天和 live E2E 需要）

核心版本已锁定：Next.js `16.2.11`、React `19.2.8`、Mastra Core `1.52.0`、Mastra AI SDK `1.6.3`、AI SDK `6.0.234`。

## 快速开始

```bash
pnpm install
```

应用只读取进程环境变量 `DEEPSEEK_API_KEY`、`DEEPSEEK_MODEL` 和 `DEEPSEEK_API_URL`，不关心变量来自终端、IDE、CI、容器平台、团队密钥管理器还是 Doppler。默认配置如下：

| 变量 | 默认值 | 说明 |
| :--- | :--- | :--- |
| `DEEPSEEK_API_KEY` | 无 | 必填，仅服务端读取 |
| `DEEPSEEK_MODEL` | `deepseek-v4-flash` | Matrix endpoint 使用的模型名 |
| `DEEPSEEK_API_URL` | `https://ai-model-api.matrix-studio.top/v1/chat/completions` | OpenAI-compatible 完整请求地址 |

服务端会把 `DEEPSEEK_API_URL` 的 `/chat/completions` 后缀规范化为 provider base URL；也可以直接提供 base URL。

### PowerShell

以下方式不会把密钥值写进命令历史或磁盘，只对当前 PowerShell 进程及其子进程有效：

```powershell
$mwSecret = Read-Host "DeepSeek API Key" -AsSecureString
$mwCredential = [System.Management.Automation.PSCredential]::new("DeepSeek", $mwSecret)
$env:DEEPSEEK_API_KEY = $mwCredential.GetNetworkCredential().Password
pnpm dev
Remove-Item Env:DEEPSEEK_API_KEY
```

### macOS / Linux

```bash
read -rsp 'DeepSeek API Key: ' MW_DEEPSEEK_KEY && printf '\n'
export DEEPSEEK_API_KEY="$MW_DEEPSEEK_KEY"
unset MW_DEEPSEEK_KEY
pnpm dev
unset DEEPSEEK_API_KEY
```

打开 [http://localhost:3000](http://localhost:3000)。IDE、CI/CD 和容器平台用户应在各自的 Secret 管理界面中，将密钥映射为同名进程变量。

仓库中的 `.env.example` 与 `.env.prod.example` 只是字段骨架。请勿创建真实 `.env` 文件，也不要把密钥放入命令参数、日志或测试夹具。

## 可选：Doppler

Doppler 不是安装或运行前置条件。团队成员可以使用普通环境变量、IDE Secret、CI/CD Secret 或容器 Secret；应用只要求最终注入同名进程变量。

当前项目的 Doppler 配置为 `money-whisperer` / `dev_personal`。开发和 live E2E 使用该配置：

```bash
doppler login
doppler setup
doppler status
doppler run --project money-whisperer --config dev_personal -- pnpm dev
doppler run --project money-whisperer --config dev_personal -- pnpm test:e2e
```

### Doppler Dashboard 录入指引

如需新增或轮换字段，请前往 Doppler 官网进行配置。

#### 1. 访问链接

- 请点击打开 Doppler 控制台：[Doppler Dashboard](https://dashboard.doppler.com/)

#### 2. 配置详情

| 推荐字段名 (Key) | 建议值/说明 (Value Description) | 适用环境 (Target Config) |
| :--- | :--- | :--- |
| `DEEPSEEK_API_KEY` | 开发环境使用的 DeepSeek API Key | `Development -> dev_personal` |
| `DEEPSEEK_MODEL` | `deepseek-v4-flash` | `Development -> dev_personal` |
| `DEEPSEEK_API_URL` | Matrix OpenAI-compatible endpoint | `Development -> dev_personal` |
| `DEEPSEEK_API_KEY` | 线上生产环境密钥（如生产部署需要） | `Production -> prd` |

`DEEPSEEK_MODEL` 和 `DEEPSEEK_API_URL` 是非敏感配置，可按环境填写 `deepseek-v4-flash` 与你的 OpenAI-compatible endpoint。

本地开发和 live E2E 只需要配置 `dev_personal`，无需为了本地测试提前填写 `prd`。

#### 3. 绝对防护警告（防污染）

在 **Production (`prd`)** 环境中保存此变量时，Doppler 可能会弹窗提示：

> "Please Confirm: Do you want to sync these secrets to other environments?"

请绝对不要勾选 Development 或 Staging，保持所有框为空，直接点击确认，确保生产密钥不会污染本地开发环境。

#### 4. 骨架文件已更新

本仓库已维护 `.env.example` 与 `.env.prod.example`，两者只含不可用的占位值。

## 目录职责

```text
src/
├─ app/                 # 页面、样式与 HTTP 路由边界
├─ components/ui/       # 当前页面实际使用的 shadcn 风格原子组件
├─ features/chat/       # 聊天 UI、会话 hook 与展示映射
├─ mastra/              # Supervisor、子 Agent 与进程级运行时
└─ server/chat/         # 环境检查、请求契约、历史和流适配
tests/
├─ unit/                # 不调用模型的 Vitest 测试
└─ e2e/                 # 唯一一条真实 DeepSeek 演示流程
```

模块只依赖相邻职责；HTTP 路由不包含 Agent 定义，UI 不直接访问 Mastra。ESLint 对手写 `ts/tsx` 文件设置 250 行上限，防止需求频繁调整后出现不可读的大文件。

## 命令

```bash
pnpm dev        # 本地开发，需要安全注入 DEEPSEEK_API_KEY
pnpm lint       # ESLint，不需要密钥
pnpm typecheck  # TypeScript，不需要密钥
pnpm test       # Vitest 离线测试，不需要密钥、不产生模型费用
pnpm build      # 生产构建，不需要密钥
pnpm check      # 依次运行 lint、typecheck、test、build
pnpm test:e2e   # 真实 DeepSeek 流程，需要密钥、网络并产生少量调用费用
```

Doppler 用户可运行：

```bash
doppler run --project money-whisperer --config dev_personal -- pnpm test:e2e
```

`test:e2e` 未检测到密钥时会明确失败，不会跳过形成假绿。

当前已用 Doppler 注入运行并通过唯一的 live E2E：Explorer 和 Reviewer 委派、流式最终回复、第二轮线程记忆及页面刷新恢复均已验证。真实 E2E 需要网络，会产生少量模型调用费用，通常耗时约 1 分钟。

## 数据与会话边界

- `Memory` 和 `LibSQLStore({ url: ":memory:" })` 是唯一服务端历史真源。
- Mastra 运行时是 Node 进程级 singleton；开发时通过 `globalThis` 避免热更新重复初始化。
- 会话 ID 存在浏览器 `sessionStorage`，同标签页刷新沿用，不是身份认证凭证。
- Node 进程重启或请求切换到另一实例后历史会丢失；当前不支持登录、跨实例共享或长期持久化。
- 未来加入 Docker Compose 时，只能使用 `DEEPSEEK_API_KEY=${DEEPSEEK_API_KEY}` 映射宿主变量，禁止 `env_file` 和硬编码密钥。

## 参考

- [Mastra Agent Reference](https://mastra.ai/reference/agents/agent)
- [Mastra Supervisor Agents](https://mastra.ai/docs/agents/supervisor-agents)
- [Mastra Memory](https://mastra.ai/docs/memory/overview)
- [Mastra 官方 Reference](https://mastra.ai/reference?list=acp)
