---
name: advisor_sessions
description: 顾问页改为豆包风格双栏布局；左侧「新建会话 / 历史会话」，onboarding_messages 通过 session_id 分组。
type: project
---

顾问页从单栏聊天升级为「豆包风格双栏对话」：左侧 264px 边栏包含「新建会话」按钮与「历史会话」列表，右侧是主对话区。

**Why:** 用户明确要求"模仿豆包的对话组件布局，左边有'新建会话'和'历史会话'"。

**How to apply:**
- 数据层：`onboarding_messages` 新增 `session_id UUID` 列 + `idx_onboarding_session(user_id, session_id, created_at DESC)` 索引；旧数据按用户各回填一个"legacy" session_id（每个用户所有历史消息聚成一个旧会话）。RLS 仍按 user_id 隔离，session_id 只是分组维度不是安全边界。
- 云函数 `advisor-chat`：接收 body.sessionId（缺省则生成一个新的 uuid）；`load_history` span 现在只拉当前 session 内的消息，避免跨会话上下文污染；user/advisor 两条消息都写入同一 session_id；响应额外返回 `sessionId` 供前端确认。
- 服务层：
  - `listOnboardingMessages(userId, sessionId?)` — 传 sessionId 只加载该会话；不传返回全部（后台仍受 RLS 约束）。
  - `listAdvisorSessions(userId)` — 聚合最近 500 条消息按 session_id 分组，返回 `{sessionId, title, messageCount, firstActivityAt, lastActivityAt}`，title 取该会话首条 user 消息前 18 字。
  - `sendAdvisorMessage(message, sessionId)` — 现在强制传 sessionId。
  - `deleteAdvisorSession(userId, sessionId)` — 从 onboarding_messages 中批量删除该 session 全部消息（用于左栏「删除会话」）。
  - `clearOnboardingConversation` 仍保留但页面不再调用，可用于账号清理。
- 前端：
  - 左栏：`新建会话` 主色按钮 + `历史会话` 徽标 + 会话列表（每项显示 title / 消息条数 / 相对时间；hover 显示删除图标）；当前会话高亮为 `primary/10` 背景。
  - 右栏：header 显示当前会话 title 与"AI 生成可能有误，请核对关键信息"提示；主区域是消息流；空状态显示"有什么我能帮你的吗？"和 4 个建议 chip；底部 `Textarea + 发送` 圆角输入区，Cmd/Ctrl+Enter 发送。
  - Page 挂载时自动加载会话列表；有会话就打开最近一条；没有则用 `crypto.randomUUID()` 生成一个新的空会话（尚未落库，直到第一条消息发送才会真正创建）。
  - 「新建会话」点一下 → 清空当前消息 + 生成新的 sessionId + 让用户开始输入。
  - 页面外层容器高度 `h-[75vh] min-h-[560px]` 稳定占位，不依赖精确的容器数学。
- **顶层布局例外**：`MainLayout` 的 `<main>` 在 `/advisor` 路径下不套 `mx-auto max-w-[1440px] px-5 md:px-10 xl:px-16 pt-8 pb-16`（顶栏与页脚仍保留），以便双栏对话区不被重复居中与非必要的内边距压缩。
- 底部依然保留 AdvisorTrace 折叠思维链组件不变。
- 移动端未特殊适配（原设计目标是桌面优先）；如需移动端可以后续加一个抽屉式左栏。
