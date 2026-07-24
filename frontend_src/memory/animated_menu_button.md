---
name: animated_menu_button
description: 全站菜单键（首页主 CTA + 顶栏导航项）都采用 Uiverse.io ink-sweep 交互：白圆 mix-blend-mode: difference 从左扫过，翻射叠加的文字/图标；点击微位移。
type: project
---

# AnimatedMenuButton（ink-sweep 菜单键）

用户在首页要求给「菜单键」加动画，采用了 Uiverse.io 的经典 ink-sweep 样式；已经封装成通用组件，后续任何需要"高对比度、单点强调动作"的菜单键 / 主 CTA 都可以复用。

**Why:** 用户直接给了这段 Uiverse.io CSS 让我们照着做——黑色 pill 上一颗白色圆通过 `mix-blend-mode: difference` 从左往右扫过（扫过瞬间会把上面的白色文字反相成黑色），按下时整体 `translate(5px, 5px)` 的手感位移。属于用户明确点名的动效语言，别再回退成普通 shadcn Button。

**How to apply:**

- 组件：`src/components/desktop/AnimatedMenuButton.tsx`。
  - Props：继承 `ButtonHTMLAttributes<HTMLButtonElement>` + 可选 `icon?: ReactNode`；`type` 默认 `"button"`。
  - 用法：`<AnimatedMenuButton onClick={...} disabled={...} icon={<Sparkles className="size-4" />}>文本</AnimatedMenuButton>`。
  - 已 forwardRef，可直接接 tooltip/asChild。
- 样式：`src/index.css` 里的 `.menu-anim-btn` / `.menu-anim-btn::before` / `.menu-anim-btn-icon` / `.menu-anim-btn-label`。
  - 底色 `rgb(15, 15, 15)`（纯黑）、白字、`box-shadow: 5px 5px 10px rgba(0,0,0,.103)`。
  - `min-width: 130px; height: 40px`，`padding: 0 18px`，`border-radius: 2px`——可以自动撑开容纳长中文文案。
  - `::before` 是白色圆盘，`width: 100%; aspect-ratio: 1; mix-blend-mode: difference`；初始 `left: -100%; top: 0`；hover 时 `transform: translate(100%, -25%)` 且 `border-radius: 0`。
  - 点击态 `.menu-anim-btn:active:not(:disabled) { transform: translate(3px, 3px); }`（原始 Uiverse 是 5px，这里收敛到 3px，避免顶栏容器抖动）。
  - `:disabled` 走 `cursor: not-allowed; opacity: .55; box-shadow: none;`，不触发动画。
  - 遵守全站 `prefers-reduced-motion: reduce` 覆盖——已经在 `@media (prefers-reduced-motion: reduce)` 段落把所有 transition/animation 收敛到 0.01ms。
- 使用位置（两处已上线）：
  1. `src/pages/desktop/HomePage.tsx` 顶部右侧的「运行一轮 Agent 建议」按钮（`.menu-anim-btn` 黑底 pill）。
  2. 顶栏导航（`src/components/desktop/TopNavigation.tsx` 里的 6 个菜单项：首页 / 资产 / 顾问 / 持仓观测 / 语义层 / 历史记录）的 `.nav-link` 文本链接 ——顶栏本身已是黑背景，不需要 pill 外壳，直接在 `.nav-link` 上加了 `overflow-hidden`、`px-2` 与尺寸自适应的 `::before` 扫光（`width: 120%; aspect-ratio: 1`，`translate(200%, -50%)` 完成从左到右扫过）。活动下划线 `.active::after` 同步改为 `inset-x-2` 并上提 `z-index: 2`，保证射在 sweep 之上。
  3. `RecommendationCard.tsx` 空态里的「生成一轮 Multi-Agent 建议」**暂未**同步，等用户下次点名再改。
- 顶栏运行安全性：顶栏 `sticky top-0 z-40` 自带堆叠上下文，`mix-blend-mode: difference` 不会漏到内容区。每个 `.nav-link` 都包了 `overflow: hidden`，`::before` 不会溢到相邻菜单项。下拉面板是包裹 div 的兄弟节点，不在 `.nav-link` 内部，不受 overflow 影响。
- 两个下拉触发按钮（语义层 / 历史记录）历史上的 `px-0` 已移除，以便统一吃 `.nav-link` 的 `px-2`。
- 深色/浅色主题：两处都写死黑/白对比（Uiverse 的效果核心就是高对比度），不要再加 `dark:` 变体。
