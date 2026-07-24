---
name: history_menu
description: 顶栏导航新增"历史记录"多栏下拉，聚合决策日志与 Evidence Lab 两个回溯入口。
type: project
---

顶栏主导航在「我的」旁边新增一个「历史记录」下拉。

**Why:** 用户希望把「决策日志」和「Evidence Lab」这两个回溯类入口从账号头像下拉里单独提到顶栏，作为一个可见的"历史记录"聚合入口 —— 鼠标点击后展开一个多栏卡片式菜单选择要打开哪个。

**How to apply:**
- 顶栏 nav 顺序：首页 · 资产 · 顾问 · 持仓观测 · **历史记录 ▼**。
- 「历史记录」与「语义层」两个下拉已统一换成自作 CSS 方案，不再用 shadcn Popover / Radix Portal：包裹在 `<div className="relative">` 里，包裹 div 推onMouseEnter/onMouseLeave（鼠标悬停即展开、离开 180ms 延时关闭，防止鼠标从触发到面板划过时颙闪），下拉面板 `<div className="absolute left-[calc(50%-10px)] top-full -translate-x-1/2 pt-1 ..."><div className="overflow-hidden rounded-md bg-popover shadow-xl">...</div></div>`（`pt-1` 把触发与卡片之间那 4px 透明间隙包回面板自己的 hitbox，保证 hover 桥接无断），定位先拿触发按钮宽取中点（50%）再向左碰 10px（chevron `size-3.5` = 14px + `gap-1.5` = 6px 的一半），确保二级项目文字中线与一级标题文字中线对齐；面板内部：无图标 · 纯文字 · 项目 `px-0 text-center` 居中 · 项目之间细分割线 · 主题自适应（`bg-popover` / `text-popover-foreground`） · 500ms 慢速展开动画（`animate-in fade-in-0 zoom-in-90 slide-in-from-top-4 duration-500 origin-top`）。对应自己的 useEffect 监听 mousedown / Escape 关闭。
- 账号头像下拉里同时移除 `决策日志` 与 `Evidence Lab` 两项，只保留：个人财务档案 + （游客）绑定邮箱账号 / （已登录）退出登录。
- 「历史记录」触发器要在其中任一子路径（/decision-log 或 /evidence-lab）激活时给出 `active` 视觉态，避免用户迷失。
- 移动端底部 Tab 保持 4 项（首页/资产/顾问/持仓观测）不变；历史记录暂只在桌面端顶栏出现，移动端用户仍可通过深链访问这两个页面。
