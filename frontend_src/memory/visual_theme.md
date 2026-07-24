---
name: visual_theme
description: 全站视觉基调——中性无衬线字体（Helvetica Neue / Arial）+ 黑色顶栏 + 米白色内容底 + 1px 浅灰分隔线。
type: project
---

# 视觉基调

用户已确认的整站视觉方向。任何改字体、改主色、改顶栏背景、改卡片底色的动作都要以此为准。

**Why:** 用户明确要求 "Arial / Helvetica Neue 或相近的中性无衬线字体、1px 浅灰分隔线、黑色顶栏、米白色内容底色"，是一个整体去装饰化、偏商务的排印方向。

**How to apply:**

- 字体（`src/index.css` 中 `--font-sans`）：`"Helvetica Neue", Arial, "PingFang SC", "Microsoft YaHei", "Source Han Sans SC", "Noto Sans CJK SC", sans-serif`。不要再引 Noto Sans SC / 思源宋体等 Google Fonts；系统 Helvetica/Arial + 系统 CJK 无衬线即可。`--font-mono` 保留 IBM Plex Mono 用于金额/指标。
- 内容底色（`--background`）：`40 25% 95%`（暖米白）。`--foreground` 用近黑 `0 0% 13%`。卡片 (`--card`) 拉到纯白 `0 0% 100%` 以拉开层次。
- 分隔线（`--border`）：`0 0% 88%`（浅灰）。所有 `border-border` / `border-t` / `border-b` 都吃这一档，全站分隔线维持 1px 粗细。不要把 border 加粗或换配色。
- 顶栏（`src/components/desktop/TopNavigation.tsx`）：`sticky top-0 border-b border-neutral-800 bg-neutral-950 text-neutral-100`。
  - Logo 文字 `text-white`；`.nav-link` 在 `src/index.css` 里已改为默认 `text-neutral-400 hover:text-white`、active `text-white`，专供顶栏这个深色环境。
  - 顶栏右侧的提醒铃铛按钮 / 用户下拉触发器：外框改 `border-neutral-800 bg-neutral-900`，图标/文字用 `text-neutral-300 / text-neutral-100`；游客灰圈 `bg-neutral-800 text-neutral-400`，登录后头像圆用 `bg-primary/20 text-primary`。
- 下拉面板（Popover 及自作 dropdown）：内容部分仍走 `bg-popover text-popover-foreground`（现在是纯白 + 近黑），保持米白背景上"发布面板"的视觉断层。
- Body 不再叠加网格底纹（原来的 `linear-gradient` 24px grid 已删）——米白干净地铺满内容区。
- 主色/强调色 (`--primary` / `--accent`) 保持原本的蓝 `221 52% 39%`，不改。仪表 / 状态色 / destructive 也不变。
- 暗色模式 `.dark` 变量目前没跟着重刷，如果后面要开夜间模式再统一处理，不要单独临时改一个组件的 `dark:` 类。
