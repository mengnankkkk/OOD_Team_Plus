---
name: guest_first_access
description: 首页与其他页面不再强制登录，用户默认以匿名会话进入，仅在"我的"里显示可选的邮箱绑定入口。
type: project
---

Money Whisperer 不再强制登录才能查看内容。

**Why:** 用户明确要求"现在不需要登陆界面了，去掉目前的不登陆就不能看的逻辑，但是用户隔离的逻辑是要存在的。目前是不需要登陆就可以进行信息的查看。然后在我的里面输入信息可以进行信息的保存"。

**How to apply:**
- 全站不再有登录墙。ProtectedRoute 只作为等待会话就绪的过渡态，不再重定向到 /login。
- useAuth 在没有已存在的会话时自动调用匿名登录（Supabase anonymous sign-in，需 EXTERNAL_ANONYMOUS_USERS_ENABLED=true），确保任何时候 auth.uid() 都有值。
- 每个匿名访客拿到一个独立的 user_id，所有 RLS 策略照旧生效 —— 用户隔离不受影响。
- "我的"页面对匿名用户显示"游客账号（仅当前浏览器）"，操作按钮从"退出登录"改为"绑定邮箱账号"，跳转 /login 让用户升级为常驻账号。
- 顶栏账号下拉：匿名时显示"游客"标签 + "绑定邮箱账号"入口；已绑定邮箱时才显示"退出登录"。
- LoginPage 保留可用，作为可选的邮箱绑定入口，不再是访问网站的必经之路。
- 未来做匿名 → 邮箱账号数据合并时，应使用 `supabase.auth.updateUser({ email })` 而不是 signUp（后者会新建一个用户，丢失匿名账号下已有的资产/建议/日志）。
