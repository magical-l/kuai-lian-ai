---
title: UI 层
covers_file: [src/modules/ui-utils.js, src/modules/messages.js, src/modules/session-list.js, src/modules/selected-endpoints.js, src/modules/attachments.js]
depends_on: [providers.md]
api_signature: 无（各函数在模块内部使用）
last_updated: 2026-07-20
why_exists: UI 组件渲染和交互——分隔条拖拽、消息渲染、流式卡片、会话列表、端点标签、附件、连接测试、对话框/tooltip
---

# 快连AI UI 层模块文档

## 设计意图

UI 层由 `ui-utils.js` `messages.js` `session-list.js` `selected-endpoints.js` `attachments.js` `main.js`（UI 部分）以及 `providers.js`（tooltip 工厂）协同完成。设计原则：

- **CSS 变量驱动**：所有 UI 状态（拖拽尺寸、缩略图样式、对话内容）通过 CSS 变量或 class 切换控制，纯 JS 只做 event binding。
- **DOM as presentation**：消息渲染、卡片更新、端点标签均采用 innerHTML 替换或 template 克隆，不维护虚拟 DOM。
- **flow 优先于 flex**：拖拽计算均基于 `offsetHeight/offsetWidth` + `getBoundingClientRect`，不依赖 flex shrink/grow 推断剩余空间。

---

## 函数索引

| 函数 | 文件 | 用途 |
|------|------|------|
| `initDividers` | ui-utils.js | 初始化 3 个分隔条（左/右/水平）的拖动系统 |
| `clampSavedHeight` | ui-utils.js | 视口变化时重新钳制消息区高度 |
| `scrollToBottom` | ui-utils.js | 消息容器滚动到底部 |
| `initScrollNav` | ui-utils.js | 绑定滚动导航按钮（top/bottom） |
| `syncScrollPadding` | ui-utils.js | 同步 sticky 区高度到 messages scroll-padding |
| `initScrollPaddingObserver` | ui-utils.js | ResizeObserver 监听 sticky 区变化 |
| `renderMarkdown` | messages.js | MD 渲染（marked.js） |
| `addCodeCopyButtons` | messages.js | 为 code block 添加复制按钮 |
| `renderMessages` | messages.js | 全量渲染用户消息列表（清空后重建） |
| `appendUserMessage` | messages.js | 追加单条用户消息（不重建） |
| `renderResponse` | messages.js | 渲染多模型响应卡片 |
| `getStatusText` | messages.js | 状态 → 图标字符 |
| `getSpeedClass` | messages.js | firstTokenTime → CSS class |
| `formatDateTime` | messages.js | 时间戳格式化 |
| `updateChatTitle` | messages.js | 更新对话标题栏 |
| `getInputContent` | messages.js | 获取输入框文本 |
| `getInputMessage` | messages.js | 获取输入文本 + 附件（转换后） |
| `renderSessionList` | session-list.js | 渲染左侧会话列表 |
| `renderSelectedEndpoints` | selected-endpoints.js | 渲染选中端点标签栏 |
| `toggleEndpointSelection` | selected-endpoints.js | 勾选/取消勾选端点 |
| `syncJoinBtnState` | selected-endpoints.js | 同步树中 checkbox 状态 |
| `handleSelectedEndpointClick` | selected-endpoints.js | 端点标签点击切换选中 |
| `handleSelectedEndpointRemoveClick` | selected-endpoints.js | 端点标签叉号强制移除 |
| `handleSelectedEndpointMouseover` | selected-endpoints.js | 端点标签 hover 显示 tooltip |
| `handleSelectedEndpointMouseleave` | selected-endpoints.js | 端点标签 mouseleave 隐藏 tooltip |
| `handleEditSessionTitleClick` | session-list.js | 会话标题编辑按钮，创建 input 替换标题 |
| `handleRemoveSessionClick` | session-list.js | 会话删除按钮，confirmAction 后删除 |
| `handleSessionListItemClick` | session-list.js | 会话列表项点击，切换当前会话 |
| `handleCopyContentClick` | messages.js | 复制内容按钮，clipboard.writeText |
| `handleCopyCodeClick` | messages.js | 复制代码块按钮 |
| `handleScrollTop` | ui-utils.js | 滚动导航到消息区顶部 |
| `handleScrollBottom` | ui-utils.js | 滚动导航到消息区底部 |
| `isTextFile` | attachments.js | 判断文件扩展名是否为可读取的文本 |
| `getMediaType` | attachments.js | 根据扩展名返回 MIME 类型 |
| `fileToBase64` | attachments.js | File → base64 |
| `fileToText` | attachments.js | File → text |
| `addAttachment` | attachments.js | 添加附件到待发送列表 |
| `removeAttachment` | attachments.js | 从待发送列表移除附件 |
| `clearAttachments` | attachments.js | 清空附件列表 |
| `clearInput` | attachments.js | 清空输入框 |
| `setButtonState` | attachments.js | 切换发送/停止按钮状态 |
| `addInheritIcon` | attachments.js | 继承值旁添加 🜍 图标（icon + inherit + char-style 类，CSS 控制样式） |
| `showEditGroupDialog` | attachments.js | 显示端点编辑对话框，含继承来源提示 |
| `buildBatchFields` | attachments.js | 批量创建表单字段构建（style/type '继承'选项+互斥逻辑） |
| `addTagFromInput` | attachments.js | 批量字段：输入框添加 tag |
| `addTagToField` | attachments.js | 批量字段：创建 tag 元素（去重） |
| `setupBatchDragDrop` | attachments.js | 批量字段拖拽排序 |
| `collectBatchFieldValues` | attachments.js | 收集批量字段值（跳过空值的继承标记） |
| `handleBatchSubmit` | attachments.js | 批量提交：收集值→生成子树→插入树 |
| `generateBatchSubtree` | attachments.js | 根据字段值生成多层级树结构 |
| `showDirectoryPrompt` | attachments.js | 显示目录选择提示 |
| `hideDirectoryPrompt` | attachments.js | 隐藏目录选择提示 |
| `showHelpDialog` | attachments.js | 显示帮助/存储设置对话框 |
| `closeHelpDialog` | attachments.js | 关闭帮助对话框（带动画） |
| `testConnection` | attachments.js | 测试端点连接 |
| `collectDescendantIds` | attachments.js | 递归收集所有后代 ID |
| `clearTestResults` | attachments.js | 清空（子）节点测试结果 |
| `showAttachmentTooltip` | attachments.js | 显示附件缩略图 tooltip |
| `hideAttachmentTooltip` | attachments.js | 隐藏附件 tooltip |
| `renderPendingAttachments` | attachments.js | 渲染待发送附件缩略图 |
| `showAttachmentPreview` | attachments.js | 附件预览（图片弹窗/文件下载） |
| `createTooltip` | providers.js | tooltip 工厂函数 |

---

## 核心系统详解

### 1. 分隔条拖拽系统 (initDividers)

文件：`ui-utils.js:9-142`

**架构**：
- 3 个分隔条：左侧面板（endpoint tree）、右侧面板（session list）、水平分隔（消息区/输入区）
- 采用 `mousedown/mousemove/mouseup` 全文档事件模型
- 拖拽值实时写入 CSS，松开时持久化到 `localStorage`

**关键设计决策**：
- 左右面板以 `flex: none` + 显式 `width` 锁定，避免 flex 容器 shrink/ grow 干扰
- 水平分隔使用 `flex: 0 0 auto` + `height`，同理避免 flex 撑满
- 右侧面板支持 `viewTransition` 动画切换隐藏/显示
- `clampSavedHeight` 在 `resize` 事件中重新钳制，防止 F12 打开时输入区被挤出

**localStorage 键**：
- `sidebar-left-width`
- `sidebar-right-width`
- `sidebar-right-hidden`
- `chat-messages-height`

### 2. 消息渲染 (renderMarkdown / renderMessages / renderResponse)

文件：`messages.js`

**renderMarkdown** (行 2)：封装 `marked.parse`，开启 `breaks` 和 `gfm`。

**renderMessages** (行 30)：清空 `.msg.list`，遍历 `messages` 数组。用户消息渲染为 `.msg.request.one` 结构（含头像、meta 时间、复制按钮、文本内容、附件栏）。响应消息委托给 `renderResponse`（调用前清除所有已有响应卡片的 `data-endpoint-id`，确保每条 assistant 消息都创建独立卡片，不互相覆盖）。

**appendUserMessage** (行 63)：从 `renderMessages` 中提取的单条用户消息渲染函数，只追加不重建。发送消息时 `handleSend` 改用此函数替代 `renderMessages`，避免清空已有消息列表。旧回复卡片保留在 DOM 中（仅清除 `data-endpoint-id` / `data-session-id` 防止冲突）。

**renderResponse** (行 120)：按 `firstTokenTime` 排序后端响应。对每个 response：
- 复用已有的 streaming card（`data-endpoint-id` 匹配），或从 template 新建
- 更新 header：name + remark + 时间 + 反应耗时 + 总耗时 + 状态 + 复制按钮
- 错误信息渲染到 `.content` 中（`.say` 后面），有错误时隐藏复制按钮
- `.say` 内容由 `textContent` 升级为 `innerHTML`（renderMarkdown 渲染）
- 调用 `addCodeCopyButtons` 为每个 `<pre><code>` 添加复制按钮
- 处理 thinking 块（`<details class="think">`）：含摘要、耗时、内容
- 处理 embedding 结果（`.embedding-result`）：维度 + 预览 + 复制完整向量
- 端点树类型筛选栏（`endpoint-tree.js`）：端点树顶部有筛选按钮（全部/嵌入/生图/重排序），点击后遍历端点 li 按类型显示/隐藏
### 3. 流式响应卡片渲染

文件：`main.js:538-695`

- `ensureStreamingHint`：初始化/重建 `.msg.list` 中的静态提示栏（默认显示"内容由AI生成，请仔细甄别使用"），页面初始化及 session 切换后调用。
- `showThinkingCards`：在静态提示栏的免责声明后追加流式状态（"N个端点思考中" + 全部停止按钮）+ N 张 `fromTemplate("response-card-streaming")` 卡片。每张卡片有单端点停止按钮。
- `resetStreamingHint`：移除提示栏中的流式状态信息（仅保留免责声明），会话切换时调用。
- `updateStreamingCard`（行 583）：按 `sessionId + endpointId` 定位卡片，更新 thinking 块（content + duration）、`.say` 内容、header 反应耗时（首次 token 时间）。
- `updateCardStatus`（行 625）：更新卡片状态 UI：停止按钮隐藏、status-icon 文本切换（spin → status）、失败时显示 error、完成时显示 totalDuration。
- `reorderCardsBySpeed`（行 682）：按 `firstTokenTime` 对 DOM 中卡片重新排列（最快的在最前）。
- `reorderSelectorTagsBySpeed`（行 697）：同步重排选中端点标签顺序。

### 4. 会话列表 (renderSessionList)

文件：`session-list.js:2-60`

从 `<aside.session.list > ol>` 清空并克隆 `<template id="one-session">`。按 `createdAt` 降序排列。每个会话项：

- 点击 → `handleSessionListItemClick`（HTML `onclick` 绑定） → `onSessionSelect(sessionId)`
- 编辑按钮 → `handleEditSessionTitleClick`（HTML `onclick` 绑定） → 创建 `<input class="editing title">` 内联替换标题文字，Enter/blur 保存，Escape 恢复
- 删除按钮 → `handleRemoveSessionClick`（HTML `onclick` 绑定） → `confirmAction` 确认后调用 `onSessionDelete`

### 5. 端点标签栏 (renderSelectedEndpoints / toggleEndpointSelection)

文件：`selected-endpoints.js`

**renderSelectedEndpoints** (行 2)：根据 `selectedEndpoints` 数组生成 `<li>` 列表。每个标签显示完整路径（`ancestors + node.name`）、remark、移除按钮。空状态显示 `<span class="empty hint">请选择端点`。

**toggleEndpointSelection** (行 55)：在 `selectedEndpoints` 中添加/移除 ID。正在生成时阻止操作。触发 `syncJoinBtnState` 同步树中 checkbox。

事件绑定已移至 HTML 模板 `#template-selected-endpoint` 的内联 onclick/onmouseover/onmouseleave 属性，对应的 handler 为 `handleSelectedEndpointClick` / `handleSelectedEndpointRemoveClick` / `handleSelectedEndpointMouseover` / `handleSelectedEndpointMouseleave`。标签内容含 tooltip（`createTooltip`），hover 显示节点配置。

### 6. 附件系统

文件：`attachments.js`

**数据结构**：`pendingAttachments: [{ id, name, type: 'image'|'file_text'|'file', file, mediaType, previewUrl }]`

**文件分类**：
- `isTextFile` — 按约 40 种文本扩展名判定
- `getMediaType` — 返回 MIME（图片 → image/*，文档 → application/*，否则 `application/octet-stream`）
- `fileToBase64` / `fileToText` — FileReader 封装

**UI**：
- `addAttachment` — 生成附件对象，图片预生成 dataURL 缩略图
- `renderPendingAttachments` — `.attachment.list` 内渲染缩略图 `div.thumb`（图片 backgroundImage / 文件 📄）
- hover 时 `showAttachmentTooltip`（fixed tooltip 显示文件名）
- 点击预览：图片弹窗遮罩，文件触发下载
- 粘贴图片：通过 `paste` 事件直接 `addAttachment`

### 7. 连接测试 (testConnection)

文件：`attachments.js:402-471`

流程：
1. `resolveNodeConfig` 获取解析后的端点配置
2. 检测模型类型（chat / embedding），选择合适的测试函数
3. 发起 POST 请求（30s 超时 + AbortController）
4. 响应验证：
   - HTTP 非 200 → 提取错误信息
   - content-type `text/html` → 提取 `<title>` 或截取 < 100 字符
   - content-type `application/json` → 检查 `{error:{...}}`
5. 异常处理：`Failed to fetch` / `NetworkError` → 标记 `cors_blocked`
6. 更新 `connectionStatus Map` 并调用 `updateEndpointTestUI`

### 8. 端点编辑对话框 (showEditGroupDialog)

文件：`attachments.js:139-278`

直接操作 DOM 中的 `<dialog class="editing endpoint" id="edit-group-dialog">`（非 template 非 clone）。用 `show()`（非 `showModal()`）打开，不阻塞页面交互，可在编辑时点击后面端点复制字段值。功能：

- 字段顺序：名称 → 模型名 → 类型 → 接口风格 → Base URL → API Key → 备注
- 名称输入 placeholder 为"（默认同模型名）"，为空时保存自动 fallback 到模型名
- 名称与模型 ID 自动同步（用户起始编辑名称后停止自动同步）
- 类型字段自动从 modelId 检测（chat/embedding/rerank），用户可手动覆盖（覆盖后停止自动检测）
- 继承值图标（↑）：空字段自动填入祖先值，`addInheritIcon` 添加继承标记
- Enter 在字段间切换焦点，最后一个字段 Enter 触发保存
- API Key 显隐切换按钮
- 保存时区分"节点已有值"和"来自继承"，避免无覆盖继承值
- 显示继承来源：dialog 标题下方显示"继承自: [父节点名称]"，顶级节点无此提示

### 9. 帮助/存储对话框 (showHelpDialog / showDirectoryPrompt)

文件：`attachments.js:289-386`

- `showHelpDialog` 直接操作 DOM 中的 `<dialog class="help" id="help-dialog">`（非 template 非 clone），用 `showModal()` 打开
- 按钮 onclick 直接写在 HTML 中，三个具名函数（`onRecoverDirectory`、`onSelectDirectory`、`onUseBrowserStorage`）通过 `dataset` 读取状态
- 显示当前存储位置、恢复按钮（`restoreDirectory`）、选择目录、使用浏览器存储
- 首次启动时 `showDirectoryPrompt`（forceSelectDirectory = true，禁止关闭）
- `closeHelpDialog` 带飞入动画：计算按钮中心到对话框中心的偏移，`translate + scale(0.05)` 缩小消失

### 10. Tooltip (createTooltip)

文件：`providers.js:284-324`

工厂函数，返回 `{ show(triggerEl), hide() }`：

- DOM 优先挂到 `.one.endpoint` 内（减少嵌套层级），fallback 到 `doc.body`
- 内容 HTML 含复制按钮（自动绑定 clipboard write）
- 位置计算：`triggerEl.getBoundingClientRect` → fixed 定位在元素上方
- 延迟隐藏（hideTimer），hover 在 tooltip 上不消失

---

## 决策日志

| 日期 | 决策 | 理由 |
|------|------|------|
| 2026-04-25 | 分隔条拖拽用 `flex: none` + 显式 `width/height`，不用 `flex-basis` | flex 容器下 `flex-basis` 与 shrink/grow 互相干扰，显式尺寸更可预测 |
| 2026-04-26 | `.say` 用 `innerHTML` 而非 `textContent` | 支持 Markdown 渲染为 HTML |
| 2026-04-26 | 消息渲染不做 diff 更新，直接 innerHTML 替换 | 聊天场景消息量小（~100 条），DOM 替换开销可忽略，省去 diff 复杂度 |
| 2026-04-26 | 流式卡片用 `data-session-id` + `data-endpoint-id` 定位 | 多 session 同时生成时需要区分卡片归属 |
| 2026-04-27 | Tooltip 优先挂到 `.one.endpoint` 下 | 避免大量 tooltip 浮在 body 层导致 z-index 管理困难 |
| 2026-07-01 | renderMessages 在调用 renderResponse 前清除已有卡片的 data-endpoint-id | 多轮会话加载时同一 endpoint 在多个 assistant 消息中出现，querySelector 会找到上一轮创建的卡片并覆写，导致之前的 assistant 回复全部丢失 |
| 2026-07-15 | typeIconMap 值从 `embedding`/`image-generation`/`reranking` 改为 `digits`/`palette`/`chart` | .endpoint-type CSS 已删除，改为 common.css 抽象的 `.icon.char-style` 体系 |
| 2026-07-02 | 错误信息从 header 移至 `.content`（`.say` 之后），有错误时隐藏复制按钮 | 错误信息过长时 header 空间不足，移到 content 更合理；有错误时复制按钮无意义 |
| 2026-07-14 | 编辑弹窗新增 `.tab.container` 组件；批量创建节点功能 | 单节点/批量创建两种模式，radio 驱动 CSS `:has()` 显隐 |
| 2026-07-01 | 侧边栏切换时 updateSidebarToggleIcon 移入 doToggle 内部 | icon 在 ViewTransition 路径外更新导致暗色下图标颜色不随状态正确切换。版本 6.3.1。 |

| 2026-07-03 | 端点编辑对话框新增类型选择器，移除全局 taskMode radio | 每个端点独立标注类型（chat/embedding/image/rerank），不再用全局切换；类型自动从 modelId 检测，用户可覆盖 |
| 2026-07-07 | help-dialog 从 template 改为直接 DOM 元素 | 帮助弹窗始终在场，无需 template 克隆 |
| 2026-07-07 | 端点编辑对话框从 showModal 改为 show() | 编辑时允许点击后面页面操作其他元素 |
| 2026-07-07 | dialog CSS 用 [open] 属性选择器限定 display:flex | 避免关闭态下 display:flex 覆盖 UA dialog { display:none } 导致 dialog 内容漏出 |
| 2026-07-07 | 编辑弹窗也从 template 改为直接 DOM 元素，移出 `<aside>` 放到 `<main>` 末尾 | 同步 help-dialog 的模式；避免 show() 无 top layer 时被后序 DOM 元素遮盖 |
| 2026-07-08 | 修复 dialog 复用崩溃：移除 `!hasParent` 时从 DOM 永久删除"继承"按钮的代码 | 删除操作导致 dialog DOM 结构不可逆变化，复用时崩溃 |
| 2026-07-08 | 修复 style 继承显示名：从内部值（如 openai）改为中文名（如 ChatGPT式） | 与类型字段 type 的中文名显示一致 |
| 2026-07-08 | 编辑/新建节点时 dialog 显示"继承自: [父节点名称]" | 让用户明确知道当前配置是从哪个节点继承的，避免混淆 |
| 2026-07-08 | renderSelectedEndpoints 从字符串拼接改为 `fromTemplate` 克隆 | HTML 结构定义在 `<template>`，JS 只做 DOM 操作 |
| 2026-07-08 | buildTooltipHTML row() 从模板字符串改为 `tooltip-row` 模板克隆 | 统一 HTML 定义在模板中 |
| 2026-07-08 | 复制按钮内容从 `copy-btn-content` 模板改为 `mk`+`text` 辅助函数 | 两个 span 过于简单，模板没必要；代码块无父模板可放 |
| 2026-07-08 | 眼睛图标切换从 `innerHTML` 改为两个 SVG 静态存在按钮中，JS 切显隐 | 按钮在静态 HTML 中，直接放两个图标更简单 |
| 2026-07-08 | `.remark` 从独立模板改为放在父模板（`response-card-streaming`、`one-endpoint`）中 | 本来就是父结构的一部分，无需独立模板 |
| 2026-07-08 | buildTooltipHTML 从 `fromTemplate` 克隆行改为 `firstElementChild.cloneNode` 获取整个模板，直接填充行 | tooltip 行结构在 `tooltip-content` 模板中静态定义，`createTooltip` 懒克隆，`buildTooltipHTML` 只填充值 |
| 2026-07-09 | 内联样式迁移到 utility class + classList。`style.display` → `classList.toggle('hidden')`（fullJson 显隐、眼睛图标切换）；移除无定义的 `.mb-1` 查询 | 与 CSS 分离，用 classList 而非 style.display 控制显隐
| 2026-07-09 | 修复 dialog 编辑弹窗二次打开崩溃：重置空值 radio 标签 + null 安全 | 前一次调用修改了 radio 标签 DOM，第二次打开时 `querySelector` 返回 null |
| 2026-07-10 | Toggle 按钮统一命名：`toggle btn : <目标> [visibility]` | `.toggle-sidebar` 违反正交拆分原则，统一为 `toggle btn : right-sidebar visibility`；API key toggle 同步为 `toggle btn : apikey visibility`。`:` 为视觉分隔符，不作为 CSS 选择目标 |
| 2026-07-10 | 侧栏 toggle 改用 checkbox + `:has()` 模式 | `button` → `label > input[checkbox]`，CSS `:has()` 控制侧栏显隐和图标切换，JS 只做 localStorage 持久化；View Transition 移除；类名 `.right-sidebar` → `.sidebar.near-right` |
| 2026-07-10 | API Key toggle 也改用 checkbox 模式 | `form-row` 从 `<label>` 改为 `<div>`，`field-label` 改为 `<label for="apikey-input">`；toggle button → label + checkbox，JS 只做 `input.type` 切换 |
| 2026-07-10 | 图标切换规则 `.on`/`.off` 提升到 common.css | `toggle > input:checked ~ .icon.on { display:none }` + `input:not(:checked) ~ .icon.off { display:none }`，所有 toggle 共享，无需在项目 CSS 中重复 |
| 2026-07-11 | 新增 `appendUserMessage` 替代 `handleSend` 中的 `renderMessages` 调用 | 发送消息时不清空 `.msg.list`，只追加新用户消息；旧回复卡片保留并清除 `data-endpoint-id`/`data-session-id` 防止冲突 |
| 2026-07-11 | 代码块复制按钮图标从 `text(mk(…), '⧉')` 改为空 `mk(…)`，利用 CSS `.icon:empty::before` 渲染 | 与 common.css 图标体系对齐，移除手写字符；`done` 状态图标同理 |
| 2026-07-12 | 事件绑定从 JS 移到 HTML 内联属性 | bindSelectorEvents 移除，tag 事件改为 HTML onclick/onmouseover/onmouseleave 直接引用 handler；会话列表 click/edit/delete 同理；消息区复制/展开/代码块复制/滚动按钮事件同上 |
| 2026-07-17 | streaming-hint 从动态创建/移除改为静态常驻 + 内容切换 | 默认显示免责声明"内容由AI生成，请仔细甄别使用"；发起请求后在免责声明后追加流式状态（N个端点思考中 + 全部停止）；会话切换时恢复免责声明。新增 ensureStreamingHint / resetStreamingHint。 |
| 2026-07-14 | `#template-selected-endpoint` 删除按钮补上 `char-style` 类 | common.css 将 `:empty::before` 移入 `&.char-style`，按钮缺少此类导致 ✕ 图标不显示 |
| 2026-07-14 | 附件添加按钮从 `<button>` + 独立 `<input class="file-input">` 改为 `<label>` 包裹 `<input type="file" hidden>` | 精简冗余 JS 桥接（click→触发隐藏 input），利用 label 语义原生触发文件选择 |
| 2026-07-14 | 编辑端点弹窗：取消 ✗ 移入 header 右上角，完成按钮从 `.done` 改为 `.ok` | `.done` 与 common.css 的完成态类名碰撞（`.btn.done { display:none }`），改用 `.ok` 并补 `char-style` 渲染图标。取消按钮遵循 help dialog 模式放 header |
| 2026-07-15 | 嵌入结果展开按钮替换为原生 `<details>/<summary>`，删除 `handleExpandJsonClick` 函数及事件绑定 | 原生 `<details>` 替代自定义 toggle 按钮 + JS，消除 `expand`/`collapsed`/`expanded` class 依赖 |
| 2026-07-17 | `renderResponse` 改为直接处理单条 assistant 消息（flat 格式），不再迭代 `responses` 数组 | 数据格式从 `{responses:[...]}` 改为每条 response 独立消息。去除旧格式兼容代码。`data-endpoint-id` 保留全局清空逻辑防止跨轮次误匹配 |
| 2026-07-17 | `.say.failed` 新增 CSS：`--danger-light` 背景 + `--danger` 色 ✗ 居中，替代空 `.say` 显示 | 失败端点显示空白 `.say` 让用户困惑；用图标 + 状态色比文字更直觉 |
| 2026-07-16 | 批量创建 style/type 新增显式"继承"选项 | 与单节点对话框一致，默认选中"继承"且互斥于具体值；有父节点时显示继承值标签；提交时跳过空值标记使节点运行时自然继承 |
| 2026-07-20 | 编辑弹窗字段顺序重排：名称→模型名→类型→接口风格→Base URL→API Key→备注 | 逻辑分组：标识信息放前（名称+模型名+类型），协议信息居中（接口风格+Base URL），认证信息最后；名称加 placeholder 提示默认值 |
