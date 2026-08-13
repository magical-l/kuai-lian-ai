---
title: CSS 架构
covers_file: [src/style.css, layout.css (外部), common.css (外部)]
depends_on: [architecture.md, external-css-utils]
api_signature: 无（纯样式，无 JS 接口）
last_updated: 2026-08-13
why_exists: style.css 是单文件 ~1200 行，无预处理器，无 postCSS —— 需要文档说明结构分层和命名惯例
---

## 设计意图

CSS 体系采用**三源架构**：两个外部文件提供基础变量和 layout utility，一个内部文件提供项目所有组件样式。无预处理器，CSS 原生嵌套在 style.css 中广泛使用。

```css
/* 加载链 */
common.css    → 所有 Design Tokens（颜色/尺寸/字体/阴影/radius）
layout.css    → Utility class 系统（flex/grid/display/对齐/布局框架）
src/style.css → 项目所有组件样式 + 补充变量
```

common.css 和 layout.css 运行时从 `http://css.document.cool/` 加载（构建时 try-inline），style.css 在构建时内联到 HTML。

## 变量体系

### 变量分层

| 来源 | 内容 | 加载方式 |
|------|------|----------|
| common.css | `--bg-*`, `--text-*`, `--border-*`, `--accent-*`, `--radius-*`, `--space-{1..8}`, `--shadow-*`, `--transition-fast`, `--btn-p`, `--btn-h`（32px）及其他 | 构建时 inline 或运行时 `<link>` |
| style.css :root | `--bg-elevated`, `--bg-hover`, `--accent-muted`, `--warning-light`, `--user-msg-bg/text`, `--text-placeholder`, `--transition-normal`, `--btn-h`（24px 覆盖 common.css 的 32px）, `--font-sans` | 内联 |
| style.css `html.dark` | 暗色模式全部变量覆写 + 外部 CSS 的 `--border-color` 覆写 | 内联 |

**风险**：style.css 的所有 var() 引用的基础变量（如 `--bg-base`、`--radius-*`、`--transition-fast`）实际定义在 common.css。如果 common.css 加载失败，var() 引用会静默回退到 initial 值，导致全页样式丢失。

### 暗色模式

暗色模式通过 `html.dark` class 实现全量 CSS 变量覆写（style.css 第 72-112 行），不依赖 JS 运行时计算颜色。变量覆写清单：

```
--bg-base: #1a1b2e      (亮色默认 #ffffff)
--bg-subtle: #1e1f32
--bg-muted: #282945
--bg-elevated: #232442
--bg-hover: #2e2f4e
--bg-active: #383962
--border-subtle: #2e2f4e
--border-default: #3e3f5e
--border-strong: #5a5d7a
--border-color: #3e3f5e   (覆写外部 CSS 的 --border-color)
--text-primary: #e8e9f0
--text-secondary: #b0b2c5
--text-muted: #7a7d9a
--text-placeholder: #5a5d7a
--accent-primary: #6d9eff  (亮色默认 #5b8def)
--accent-primary-hover: #5b8def
--accent-light: rgba(109, 158, 255, 0.15)
--accent-muted: rgba(109, 158, 255, 0.25)
--success: #34d399
--success-light: rgba(52, 211, 153, 0.15)
--danger: #f87171
--danger-light: rgba(248, 113, 113, 0.15)
--warning: #fbbf24
--warning-light: rgba(251, 191, 36, 0.15)
--user-msg-bg: #4a7bde
--user-msg-text: #ffffff
--shadow-sm/md/lg/xl: 加深阴影
```

此外还覆写了硬编码颜色（代码块背景 `#f6f8fa` → `#2d2d3f`、等待慢速指示器 `#ea580c` → `#fb923c`、慢速端点赞章）。

**交互机制**（见 main.md §主题管理）：
- 无 class → 跟随系统 `prefers-color-scheme` 自动切换
- `html.dark` → 强制暗色
- `html.light` → 强制亮色
- 点击工具栏主题按钮 → 弹出 Popover 菜单，三个选项（亮色/暗色/跟随系统），各带独立 SVG 图标（icon-sun/icon-moon/icon-auto）
- Popover 通过 CSS anchor positioning 定位在按钮正下方居中（`anchor-name: --theme-btn` + `position-anchor` + `translate: -50%`）

偏好存于 `settings.theme`（IndexedDB / File System Access）。

## 外部 CSS 依赖（layout.css / common.css）

common.css 和 layout.css 是独立维护的 CSS 工程（源码在 `d:\工作\css\css\`），通过 CDN 分发。style.css 的所有样式都运行在这两层之上。

### `.flex` 的默认值踩坑

layout.css 定义的 `.flex`：

```css
.flex { display: flex; flex-wrap: wrap; align-items: flex-start; }
```

注意默认是 **`flex-wrap: wrap` + `align-items: flex-start`**，不是 CSS 规范默认的 `nowrap` + `stretch`。

style.css 第 72 行**显式覆盖**：

```css
.flex {/* 覆盖引入的css的设置 */
    align-items: stretch;
    flex-wrap: nowrap;
}
```

这意味着：
- style.css 中任何 `class="flex ..."` 的地方，flex-wrap 和 align-items 已被 style.css 重置为规范默认值
- 如果未来使用 `.flex` 但**不包括 style.css**（如外部动态加载的内容），会得到 wrap + flex-start 行为
- `flex-wrap: nowrap` 不写在 layout.css 的 `.flex` 里，是因为 layout.css 的 `.flex` 要同时支持 wrap 和 nowrap 两种场景——项目用 `.items-go-x` 方向类配合 `.flex` 的 wrap 实现自然换行，但 快连 AI 的所有 flex 容器都不需要换行，所以 style.css 全局重置了

### Utility class 体系（layout.css 提供）

layout.css 定义了完整的 utility class 系统，style.css 的 HTML 中和这些类混合使用：

**display**
`.inline`, `.block`, `.block.inline`（=inline-block）, `.flex`, `.grid`

**flex 方向**
`.items-go-x`（row）、`.items-go-y`（column）、`.items-from-right`（row-reverse）、`.items-from-bottom`（column-reverse）

**flex 对齐**
横排：`.items-near-left`（flex-start）、`.items-near-right`（flex-end）、`.items-x-near-center`、`.items-x-space-between`（别名：`.items-x-mutex` `.items-x-social-phobia`）
竖排：`.items-y-near-center`、`.items-near-bottom`

**flex 子元素**
`.flexible`（flex: 1 1 auto）、`.no-shrink`（flex-shrink: 0）、`.near-left/right/center`

**布局框架预设**
`.亞字形` / `.叵字形` / `.反叵字形` / `.目字形` / `.三字形` / `.工字形` / `.朋字形` — Grid 布局预设。本项目未使用，仅在 layout.css 中可用。

### 使用惯例

style.css 中的组件类与 layout.css 的 utility class 用空格混合：

```html
<div class="workspace-setting , flex items-go-x items-x-space-between">
<div class="flex items-go-y">
```

注意 class 中使用了 `,` 分隔——这是项目的书写惯例（见 [[css-class-convention]]），HTML 中逗号被当作类名分隔符的视觉标记，实际效果等同于空格。

关键规律：**style.css 只写组件结构和行为**（`.one.msg`, `.btn`），**layout.css 提供布局和对齐**（`.flex`, `.items-*`, `.flexible`）。

### style.css 中定义的变量（仅项目专有，非 common.css 兜底）

```
--bg-elevated       #FFFFFF
--bg-hover          #F3F4F6
--accent-muted      rgba(91, 141, 239, 0.25)
--warning-light     rgba(217, 119, 6, 0.12)
--user-msg-bg       #5B8DEF
--user-msg-text     #FFFFFF
--text-placeholder  #9CA3AF
--transition-normal 180ms ease
--btn-h             24px（覆盖 common.css 的 32px）
--font-sans         'Plus Jakarta Sans', system fallback
--shadow-*          4 级阴影值
--space-{2..8}      8~32px
```

基础变量（`--bg-base`、`--radius-*`、`--shadow-*`、`--space-{1..8}`、`--transition-fast` 等）全部来自 common.css，style.css 只定义项目专有覆盖。

## 文件结构（style.css，~1710 行）

| 章节 | 内容 |
|------|------|
| 基础元素 | html/body 默认值、`<aside>` 面板容器、`<main>` + header、flex/hidden/del 标签重置、.split.btn-group（分裂式发送按钮 + popover 菜单）、.workspace-setting |
| 按钮 | `button, .btn` 基类、join-session（勾选开关）、test-connection（三态：testing/connected/failed）、stop（危险操作）、copy（两态：常态/done） |
| 端点面板 | .one.endpoint 卡片、拖拽指示器（drag-over-before/child）、.greyed 禁用态 |
| 消息 | .one.msg 通用结构、.request（用户消息，靠右 / 蓝底 / 白色）、.response（助手消息，靠左）、think 块、嵌入结果、状态行（wait/status-icon/stop-one） |
| 主框架 | toolbar、.msg.list 滚动容器、streaming-hint、.chat-input-area（textarea + 附件栏 + 发送按钮） |
| 附件 | .one.attachment 缩略图、附件列表布局 |
| 端点面板（详细） | 分组标题、拖拽状态、紧凑模式（.compact）、选中端点列表（.selected.endpoints）、test-all 按钮 |
| 会话 | .one.session 条目（标题 + 元信息 + 选中态） |
| 附件缩略图 + 模型选择器 | .thumb（圆角/边框/删除按钮）、.model-task.selector |
| 弹窗 | dialog.editing.endpoint（表单/输入/布局）、dialog.help（header/close/内容区） |
| 图标 | `.icon` 样式覆写（outline-style 描边宽、char-style 字号）、`.inherit.icon` 继承图标、`.input-row` 行内布局 |
| 媒体查询 + View Transitions | prefers-reduced-motion、2 个响应式断点、3 个 view-transition-name |
| 暗色模式 | `html.dark` 块：全部 CSS 变量暗色覆写 + 硬编码颜色修正 |

## 布局系统

### 面板框架（layout.css 提供基础，style.css 定义面板尺寸）

```
┌─────────────────────────────────────────────────┐
│  <body class="flex items-go-y">                  │
│  ┌──────┬─────────────────────────┬──────────┐   │
│  │aside │ main                    │ aside    │   │
│  │.list │ ┌─ toolbar ──────────┐ │ .list    │   │
│  │.endp.│ ├─ .msg.list ───┤ │ .session │   │
│  │      │ │  (scrollable)      │ │          │   │
│  │      │ ├─ .chat-input-area ─┤ │          │   │
│  │      │ │  (sticky bottom)   │ │          │   │
│  └──────┴─────────────────────────┴──────────┘   │
└─────────────────────────────────────────────────┘
```

- body: `height: 100dvh; overflow: hidden`
- aside（左端点树）: `min-width: 180px; max-width: 45%; width: 260px`
- aside（右会话列表）: 同上
- main: `flex: 1; overflow: hidden` → `.main-row` → `.main-content`
- .chat-input-area: `position: sticky; bottom: 0; z-index: calc(var(--divider-z) + 10); flex: 0 0 auto; min-height: 160px`

分隔条的拖拽宽度由 `ui-utils.js` 的 `initDividers()` 管理，通过设置 `flex-basis` 覆盖 aside 的 width。

### 消息区布局

```
.msg.list（flex column, overflow-y: auto, scroll-padding-bottom: 130px）
  ├── .one.msg.request（align-self: flex-end; max-width: 90%）
  │     ├── header（用户标签 + 时间）
  │     └── .content（蓝底白字; border-radius-lg）
  ├── .one.msg.response（align-self: flex-start; max-width: 90%）
  │     ├── header（模型名 + status + wait耗时 + copy + stop-one）
  │     └── .content（白底; Markdown 渲染; pre/code/blockquote/table）
  │           └── .attachments（附件预览）
  ├── .streaming-hint（sticky bottom; order: 999; 圆角 pill 形）
  │     └── .stop.all.btn
  └──（流式卡片：.one.msg.response.streaming）
```

### 输入区布局

```
.chat-input-area（sticky bottom; border-top; flex: 0 0 auto; min-height: 160px —— 高度=内容，不收缩不滚动，纯"向上撑"）
  ├── .divider.go-x（垂直拖拽分隔条 → ui-utils.js startDragVertical 调 .msg.list 高度）
  ├── .selected.endpoint.list（已选端点 chips; max-height 由 ui-utils.js syncSelectedAreaLimit 动态设置，CSS 200px 兜底; overflow-y: auto）
  ├── textarea#chat-input（width: 100%; height: auto; flex: 0 0 auto; min-height: 56px）
  └── > menu（发送/停止/附件按钮行）
```

**输入区高度约束**：`.chat-input-area` 是 `flex: 0 0 auto`——高度=内容（已选区 + textarea + 发送按钮行），不收缩不滚动，**纯"向上撑"**：选更多端点 → 已选区增高 → 输入区同步增高 → `.msg.list`（`flex: 1`，`min-height: 50px`）自动压缩让位。已选区上限由 JS `syncSelectedAreaLimit()` 动态设置（= `.main-content` 高 − toolbar − 50 − 输入区其他部分），即"消息区压缩到仅剩 streaming-hint（50px）后，剩余高度全给已选区"，极端多端点时已选区才内部滚动。发送按钮行始终在视口底部可见。JS 侧 `stickyMinHeight()`（ui-utils.js）返回 `max(160px, 内容所需高度)` 作为拖拽 clamp 的输入区下限；拖拽固定消息区后，输入区增高时 `clampMessagesHeight()` 重新收紧消息区（消息区 clamp 下限 50px）。视口极矮时消息区压到 50px 后输入区仍超可用空间属物理极限（需放大窗口）。

## 类名体系

非 BEM，采用**扁平单类 + 标签限定**模式。

### 条目统一模式 `.one.<type>`

| 类型 | 类名 | 变体 |
|------|------|------|
| 端点 | `.one.endpoint` | `.dragging`, `.greyed`, `.compact` |
| 消息 | `.one.msg` | `.request`, `.response`, `.streaming` |
| 会话 | `.one.session` | `.selected` |
| 附件 | `.one.attachment` | — |

### 按钮修饰符（独立类，非 BEM 的 `--`）

| 类 | 用途 |
|------|------|
| `.join-session` | 端点加入会话的勾选开关 |
| `.test-connection` | 连接测试（三态：`.testing` `.connected` `.failed`） |
| `.stop` | 红色危险停止按钮 |
| `.copy` | 复制按钮（两态：`.done` 时隐藏自身，显示兄弟 `.status.icon`） |
| `.main` / `.secondary` | 分裂按钮组主/次 |
| `.option` | popover 菜单选项 |

状态类另用独立类叠加：`.testing`, `.connected`, `.failed`, `.dragging`, `.drag-over-before`, `.drag-over-child`, `.selected`, `.streaming`, `.stopped`, `.completed`, `.failed`, `.compact`, `.done`。

### 标签限定

- `button, .btn` → 统一点击元素样式
- `dialog.editing.endpoint` → 端点编辑弹窗
- `aside.list > ol` → 面板列表容器

### utility class（来自 layout.css）

`flex`, `inline`, `block`, `flex.items-go-x`, `flex.items-go-y`, `flexible`, `no-shrink`, `hidden`, `near-left`, `near-right`, `near-x-center`, `near-y-center`, `items-x-space-between` 等——与 style.css 的组件类直接用空格混合使用。

## `:has()` 使用情况

共 3 处，全部在按钮上下文：

1. 发送模式选项高亮：`.split.btn-group .option.btn:has(input:checked)` → 切换文字颜色
2. 加入会话勾选：`.btn.join-session:has(input:checked)` → 切换 `--btn-text-color` 为 success（char-style 图标继承颜色）
3. 侧栏 toggle：`body:has(.toggle.sidebar.near-right > input:checked) aside.near-right` → 控制侧栏显示/隐藏

## Transition / Animation 策略

- **唯一时长**: `--transition-fast: 120ms ease`（common.css 定义）
- **style.css 补充**: `--transition-normal: 180ms ease`（仅定义，未引用）
- **应用属性**: border-color, box-shadow, background, color
- **应用位置**: input/select focus、按钮 hover、删除按钮 hover、会话 hover
- **@keyframes**: 零。所有反馈完全靠 transition 实现
- **prefers-reduced-motion**: `transition-duration: 0.01ms !important`
- **View Transitions**: 3 个 view-transition-name（`sidebar-left`, `sidebar-right`, `main-chat`），用于面板切换的 View Transition API。JS 端由 `document.startViewTransition` 触发（参见 main.md）

## View Transition 映射

| DOM 元素 | view-transition-name |
|----------|---------------------|
| `aside.endpoint.list` | `sidebar-left` |
| `aside.session.list` | `sidebar-right` |
| `.msg.list` | `main-chat` |

## 响应式断点

| 断点 | 变化 |
|------|------|
| `max-width: 900px` | 侧栏宽度缩至 200px（`min-width: 160px`） |
| `max-width: 768px` | .msg.list padding 和 input-area padding 缩小；消息 max-width 扩大到 95% |

## 与 JS 的交互点

| JS 文件 | 交互方式 | 内容 |
|---------|----------|------|
| ui-utils.js | 设置 flex-basis | `initDividers()` 通过覆盖 aside 的 width + flex-basis 实现拖拽分割 |
| ui-utils.js | 读取 CSS 变量 | `stickyMinHeight()` 返回 `max(CSS min-height, 内容所需高度)`（内容用 scrollHeight 测，减去 textarea 被 flex 撑满的部分） |
| endpoint-tree.js | 切换类 | 拖拽时添加/移除 `.dragging`, `.drag-over-before`, `.drag-over-child` |
| endpoint-tree.js | 切换状态 | 测试完成后添加 `.connected` / `.failed` |
| main.js | View Transition | `document.startViewTransition()` 触发 `view-transition-name` 命名的元素过渡 |
| messages.js | Markdown 渲染 | 代码块渲染到 `.content` 内的 `<pre><code>`，样式在 style.css 第 368-388 行 |
| main.js | 主题管理 | `initTheme()` 在 `html` 上添加 `.dark` / `.light` class 控制暗色模式；`matchMedia('prefers-color-scheme: dark')` 监听系统主题变化 |

## 决策日志

- 2026-07-01: 初始文档创建。确认 style.css 实际 ~1200 行（非预估的 3000+）、:has() 共 3 处（非"大量"）
- 2026-07-10: 新增第 4 处 `:has()` 使用——侧栏 toggle，CSS 变量驱动，JS 仅做 localStorage 持久化
- 2026-07-24: `--selector-bg/--selector-color/--selector-font-weight` → `--checked-*`。`.join-session` 选中态从 `--btn-text-color: var(--success)`（对图标按钮无效）改为 `--checked-bg: var(--accent-primary)`。`.btn.busy + .status.icon.wait` 从 `button, .btn` 嵌套中抽出为独立规则。`.join-session` 内冗余的 `& input[type=checkbox] { opacity:0; ... }` 删除（已由 `label.btn > input { display:none }` 覆盖）。
- 2026-07-01: 暗色模式实现。采用 `html.dark` class 覆写全部 CSS 变量，而非 `prefers-color-scheme` 媒体查询。交互三态（亮→暗→跟随系统），偏好持久化到 settings。html.dark 块约 40 行，新增 4 个 SVG icon 符号。版本 6.3.2。
- 2026-07-02: 根级 compact 节点间距修复。`.compact` 设 `margin-bottom:0` 对子级节点正确（间距由 `.children` 的 gap 控制），但根级 compact 节点（`<ol>` 的直接子元素）丢失了正常间距。新增 `ol > .one.endpoint.compact` 恢复 `margin-bottom:var(--space-3)` 和底部边框。
- 2026-07-24: 修复 slider 滑块滑不到两端。dialog 内的 `& input, & select` 通用规则给 range 加了 `padding: 12px`，缩短了 Chrome 滑块轨道。在 `input[type="range"]` 中追加 `padding: 0; border: none; border-radius: 0;` 覆盖。
- 2026-07-05: 清除 style.css 中所有注释掉的外部 CSS 变量副本（共 9 组）。这些是 common.css 剥离后的历史快照，其中 `--radius-*: 0` 与实际值（4/6/8/12px）不符。变量分层不再需要在 style.css 中留注释副本，统一在本文档的变量分层表中说明。
- 2026-07-05: `--shadow-*` 四值和 `--space-{2..8}` 刻度从 style.css 迁移到 common.css，作为跨项目设计令牌统一管理。style.css :root 仅保留项目专有变量（`--bg-elevated`、`--font-sans`、`--btn-h` 等 11 个变量）。
- 2026-07-06: 试用 `@import layer(base)` 后因 utility class（`.items-y-near-center`）被降层误伤而放弃。改用 style.css 加 `:root { --btn-h: 24px; --icon-*: 16px }` 块以源顺序覆盖 common.css 同名变量。删除 `main > header .btn .icon` 固定宽高规则，使图标由 `.btn.icon-only` 的 100% 约束。修复 `endpoint-tree.js` 第三处 `collectTestable` 中 `testableIds`→`allTestableIds` 笔误。
- 2026-07-20: `.divider.row/.col` → `.divider.go-x/.go-y`。方向语义重构：`.go-x`=分割条沿 X 轴走（横条），`.go-y`=沿 Y 轴走（竖条），消除 `row`/`col` 歧义。同步更新 `src/layout.html` HTML 类名、`ui-utils.js` 选择器、dist 文件。
- 2026-07-15: 端点类型图标从 `.endpoint-type` 自定义 CSS 迁移到 common.css 抽象类（`.digits` `.palette` `.chart`）。筛选按钮选中态改为变量驱动（`--checked-bg`/`--checked-color`/`--checked-font-weight`，原 `--selector-*` 于 2026-07-24 改名），不再直接设 `background`。新增 `--icon-font-size: 18px`。
- 2026-07-13: 新增 `color: var(--danger)` 赋值到 `.warning`（`style.css` 第 4 行）。测试按钮状态 UI 从 `.testing + .spin.animation` 改为 `.busy` + `.status.icon.wait` 站台模式。`style.css` 新增 `.btn.busy ~ .status.icon.wait` 显示规则，由消费方决定 display 值和尺寸（`.btn + .status.icon` 在 common.css 中提供 `--icon-width/height: var(--btn-h)` 自动匹配按钮大小）。
- 2026-07-16: 继承图标重构。将 `.inherit-icon` 冗余类名合并为 `.inherit.icon`，从行内样式提取到 style.css（cursor/color/shrink/margin），`font-size` 改为 `1.6em` 随父级缩放。新增 `.input-row` 全局布局类。
- 2026-07-16: `.tab.container` 重构。修复 `no-tabs` 编辑模式 bug（dialog `& header`→`> header` 避免样式穿透覆盖 no-tabs）。全段 CSS 按 DOM 树嵌套重组（`.btn-group` 路径修正、`.field-*`/`.option.btn` 收拢入 `& form`、`.batch-field` 树型嵌套、tag 移入 batch-field）。`.one.tab` 布局属性与可见性切换分离；radio selector 包 `:not(.no-tabs)` 实现结构互斥，去除冗余 `display: none` 对抗。
- 2026-07-08: `.hint` 样式增强（font-size 12px, opacity 0.75, text-align:center, width:100%），配合接口风格按钮底部显示默认路径文本。
- 2026-07-08: 端点树复刻按钮类名改为 `.duplicate`；参照同为 SVG outline 的 `.join-session`，只通过 `--btn-text-color: var(--accent-primary)` 设定图标色，不单独设置边框、背景、opacity、hover 或 stroke。
- 2026-07-11: sticky 重构：`.sticky` 改用 `--stick-top/bottom/left/right` 变量 + `.near-*` 方向类，替代 `:is(header)` / `:is(footer)` 硬编码。`.streaming-hint` 和 `.chat-input-area` 改用 `.sticky.near-bottom` 类 + `--stick-bottom` 变量。
- 2026-07-22: `.input-row` 新增 `flex: 1; min-width: 0` CSS 规则（style.css）。之前靠 `addInheritIcon`(JS) 设行内样式，子节点编辑时 `.flex > input` 不再匹配，input-row 撑不开挤缩 baseUrl 输入框。迁到 CSS 类统一管理。
- 2026-07-13: 状态图标重构。`--icon-char` 定义从 `.icon` 块内移到顶层，使状态类（`.done`/`.completed`/`.loading` 等）可放在 `.icon` 的祖先上。`.status` 块改为通过 `--status-icon-text-color` 变量消费颜色，不再写死子类列表。复制按钮从 `.copied` + 内部状态 span 改为 `.done` + 兄弟 `.status.icon` 模式。
- 2026-07-14: `:empty::before` 移入 `&.char-style` 后，选中端点删除按钮补上 `char-style` 类。（根因：common.css 重构了 `--icon-char` 的渲染入口，但 `layout.html` 的 `#template-selected-endpoint` 中 `.remove` 按钮未同步更新类名。）
- 2026-07-15: trash/attach 图标从 SVG 切换为 emoji 字符（🗑/🖇）。common.css 新增 `.icon.trash`/`.attach` 类并设 `--icon-font-size: 1.5em`。修复 `.btn > .icon` 因特异性过高覆盖图标自身 `--icon-font-size` 的 bug（改用 `:where(button, .btn) > .icon` 降特异性至 0,1,0）。对应移除 icons.svg 中不再使用的 `#trash`/`#attach` 符号。
- 2026-07-15: 图标变量体系重构：状态类默认字符从分散的 `--icon-ok: '✓'` 统一为 `:root` 上的 `--char-check: '✓'`。`.emoji` 改为覆盖 `--char-*` 而非逐个覆盖 `--icon-*`。同义类合并（`.ok`/`.done`/`.completed` 等共享 `--char-check`）。新增 `.sun`（实心/空心）、`.moon` 图标类。
- 2026-07-15: 顶栏图标 SVG → char-style 替换（folder-open/sun/moon/half-light.at-left），主题按钮图标跟随选中模式动态切换。join-session 从 SVG bubble 改为 `.chat.from-left` char-style，checked 态通过 `--btn-text-color` 变色。
- 2026-07-17: `.content.failed` — 失败回复框样式：`--danger-light` 背景、flex 居中、圆角。图标通过 common.css 的 `.icon.error` 类渲染（`--char-cross` ✗ + `--danger` 色），错误文字用已有的 `.error` 类。替代原先 `.say` 上的失败样式。
- 2026-07-15: common.css `.btn` 块新增 `text-shadow: var(--btn-text-shadow, none)`；`.char-style:empty::before` 块新增 `color: var(--icon-text-color, currentColor)`、`text-shadow: var(--icon-text-shadow, none)`，使 char-style 图标支持字色和轮廓可配。
- 2026-07-16: 图标 overlay 机制：`.char-style` 新增 `::after`（`position: absolute; inset: 0`），通过 `--icon-overlay-char` 控制叠加字符，默认颜色/字号/位置与 `::before` 一致。新增 `.eye`（👁）、`.eye.when-closed`（👁+✗）类。文件夹图标类 `.folder-open/closed` 重构为 `.folder.when-open/closed`。layout.html duplicate/eye 图标从 SVG 切换为 char-style。

- 2026-07-18: 远程 CSS 域名从 `css.lwj621.workers.dev` 切换到 `css.document.cool`，路径从 `/css/` 简化为根路径
- 2026-07-18: 叶子节点（`.compact`）缩进对齐。`.compact summary` 缺少 marker 占位空间（~15px），内容比有子节点的兄弟节点偏左。添加 `padding-inline-start: calc(var(--space-2) + 15px)` 补偿。
- 2026-07-21: 修复 style.css 花括号嵌套缺陷。`.one.msg` 块的 `& .status/.usage/.think/.embedding-*` 因多了一个 `}` 跳出作用域成为顶层 `:scope` 选择器。`& .error` 逃出 `&.response`。修复：删除多余 `}`（原 606 行），在 `.embedding-full-json` 后补 `}` 闭合 `.one.msg`。同时删除 `#themePop` 中被立即覆盖的 `border: none`。版本 v6.25.2。
- 2026-07-22: `aside.endpoint.list` 空状态改为 CSS `:has()` 驱动。移除 JS 维护的 `show-empty-state` class，用 `&:not(:has(> ol > .one.endpoint))` 自动控制 ol/empty-state 显隐。JS 仅保留文案和按钮显隐控制。`.empty-state` 默认 `display: none`。版本 v6.25.3。
- 2026-07-28: `.empty-state:not(.hidden)` 显式设为 `display: block`，补足筛选无结果场景；节点仍存在时不会触发“无节点”的 `:has()` 规则，必须由 JS 移除 `.hidden` 后显示空态。
t- 2026-07-24: 端点树名字/备注压缩优先级反转。`.one.endpoint .remark` 新增 `overflow: hidden; text-overflow: ellipsis; min-width: 0;` 允许截断；`aside.endpoint.list .name` 移除 `word-break: break-all; overflow-wrap: break-word; min-width: 0;`，新增 `min-width: 3em; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;`。备注优先压缩，名字 `3em` 保护不压到 0。版本 v6.32.2.
- 2026-08-13: 修复 bug3（发送按钮行被挤出视口下沿）。三层修复：① `ui-utils.js` `stickyMinHeight()` 从返回 CSS `min-height:160px` 改为 `max(160px, 内容所需高度)`（用 scrollHeight 减 textarea 被 flex 撑满的部分补偿，绕开"scrollHeight 在 flex:1 子元素被撑满时不正确"的坑），拖拽 clamp 时输入区不再被压到容纳不下内容；② `.selected.endpoint.list` 加 `max-height: 100px` + `overflow-y: auto`，已选端点多时内部滚动而非无限增高；③ `.chat-input-area` 加 `overflow-y: auto` + `> menu` `position: sticky; bottom: 0` 兜底，窄视口/大量已选端点时输入区内部滚动、发送按钮行始终贴住视口下沿。
- 2026-08-13: 输入区布局改为「内容自适应 + 已选区限高滚动」模型，替代上一版「overflow-y + menu sticky 兜底」方案。`.chat-input-area` 从 `flex: 1`（撑满）改为 `flex: 0 0 auto`（高度=内容，不撑满不收缩），删除 `overflow-y: auto` 和 `> menu` 的 `position: sticky; bottom: 0` 兜底；`textarea#chat-input` 从 `height: 100%` 改为 `height: auto` 并新增 `flex: 0 0 auto`（`min-height: 56px` 保留）。剩余高度全归 `.msg.list`（`flex: 1`）：选更多端点 → 已选区增高（`max-height: 100px` 内部滚动）→ 输入区增高 → 消息区自动压缩，发送按钮行始终在视口底部，无需输入区内部滚动。`.selected.endpoint.list` 的 `max-height: 100px` + `overflow-y: auto` 保留不动。
- 2026-08-13: 输入区加「滚动兜底」，补充上面「内容自适应」模型。`.chat-input-area` 从 `flex: 0 0 auto` 改为 `flex: 0 1 auto`（允许收缩），新增 `overflow-y: auto`；`> menu` 新增 `position: sticky; bottom: 0; background: var(--bg-base); z-index: 1`（贴底 + 实底色遮挡滚动到 menu 下方的已选区/textarea）。正常视口输入区仍内容自适应向上撑；视口过小（≤~420px）或输入区内容过高时，消息区被压到 `min-height: 100px` 后输入区收缩内部滚动、menu 贴底，消息区底部 `.streaming-hint`（"内容由AI生成"行）不再被输入区盖住。`.selected.endpoint.list` 的 `max-height` 与 `.msg.list` 的 `flex` 不动。不走此前被移除的 `flex: 1` 撑满方案。
- 2026-08-13: **撤销滚动兜底，回归纯"向上撑"**。用户确认：输入区（已选区+输入框+发送按钮行）必须整体完整显示、绝不内部滚动——"向上撑"是输入区挤压消息区，不是输入区自己滚。`.chat-input-area` 从 `flex: 0 1 auto` + `overflow-y: auto` 改回 `flex: 0 0 auto`（不收缩不滚动），删除 `overflow-y: auto` 和 `> menu` 的 `position: sticky; bottom: 0; background; z-index`。视口 ≥480px 下 `.streaming-hint` 实测恒在输入区上方 24px 不被盖（含流式高状态、滚动到底）；<480px 时消息区压到 `min-height: 100px` 后输入区超可用空间属物理极限（需放大窗口）。`.selected.endpoint.list` max-height 与 `.msg.list` flex 不变。
- 2026-08-13: **已选区"撑到极限"**。用户要求已选区向上撑贯彻更久（而非 3 行就滚动）。`.msg.list` `min-height` 100→50px（消息区压缩到仅剩 `.streaming-hint`）；`.selected.endpoint.list` 的 max-height 改由 ui-utils.js `syncSelectedAreaLimit()` 动态设置（= `.main-content` 高 − toolbar − 50 − 输入区其他部分），CSS 保留 200px 兜底；所有消息区 clamp 下限（clampSavedHeight / clampMessagesHeight / initDividers 恢复拖拽高度）统一 100→50。效果：已选区在任意视口向上撑到物理极限（消息区仅剩提示行）才滚动，`.streaming-hint` 始终可见。
