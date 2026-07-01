---
name: ui-layer
description: UI 层模块文档 — 分隔条、消息渲染、流式卡片、会话列表、端点标签、附件、对话框、tooltip
---

# 快连AI UI 层模块文档

## 设计意图

UI 层由 `ui-utils.js` `messages.js` `session-list.js` `selected-endpoints.js` `attachments.js` `main.js`（UI 部分）以及 `providers.js`（tooltip 工厂）协同完成。设计原则：

- **CSS 变量驱动**：所有 UI 状态（拖拽尺寸、缩略图样式、对话内容）通过 CSS 变量或 class 切换控制，纯 JS 只做 event binding。
- **DOM as presentation**：消息渲染、卡片更新、端点标签均采用 innerHTML 替换或 template 克隆，不维护虚拟 DOM。
- **flow 优先于 flex**：拖拽计算均基于 `offsetHeight/offsetWidth` + `getBoundingClientRect`，不依赖 flex shrink/grow 推断剩余空间。

---

## 函数索引

| 函数 | 文件 | 行号 | 用途 |
|------|------|------|------|
| `initDividers` | ui-utils.js | 9 | 初始化 3 个分隔条（左/右/水平）的拖动系统 |
| `clampSavedHeight` | ui-utils.js | 144 | 视口变化时重新钳制消息区高度 |
| `scrollToBottom` | ui-utils.js | 157 | 消息容器滚动到底部 |
| `initScrollNav` | ui-utils.js | 162 | 绑定滚动导航按钮（top/bottom） |
| `syncScrollPadding` | ui-utils.js | 182 | 同步 sticky 区高度到 messages scroll-padding |
| `initScrollPaddingObserver` | ui-utils.js | 189 | ResizeObserver 监听 sticky 区变化 |
| `renderMarkdown` | messages.js | 2 | MD 渲染（marked.js） |
| `addCodeCopyButtons` | messages.js | 11 | 为 code block 添加复制按钮 |
| `renderMessages` | messages.js | 30 | 渲染用户消息列表 |
| `renderResponse` | messages.js | 115 | 渲染多模型响应卡片 |
| `getStatusText` | messages.js | 288 | 状态 → 图标字符 |
| `getSpeedClass` | messages.js | 296 | firstTokenTime → CSS class |
| `formatDateTime` | messages.js | 303 | 时间戳格式化 |
| `updateChatTitle` | messages.js | 315 | 更新对话标题栏 |
| `getInputContent` | messages.js | 319 | 获取输入框文本 |
| `getInputMessage` | messages.js | 323 | 获取输入文本 + 附件（转换后） |
| `renderSessionList` | session-list.js | 2 | 渲染左侧会话列表 |
| `renderSelectedEndpoints` | selected-endpoints.js | 2 | 渲染选中端点标签栏 |
| `toggleEndpointSelection` | selected-endpoints.js | 55 | 勾选/取消勾选端点 |
| `bindSelectorEvents` | selected-endpoints.js | 71 | 绑定标签栏事件 |
| `syncJoinBtnState` | selected-endpoints.js | 113 | 同步树中 checkbox 状态 |
| `applyJoinBtnUI` | selected-endpoints.js | 121 | 更新 checkbox 的选中/未选中状态 |
| `buildTooltipHTML` | selected-endpoints.js | 137 | 构建 tooltip 内容 HTML |
| `isTextFile` | attachments.js | 2 | 判断文件扩展名是否为可读取的文本 |
| `getMediaType` | attachments.js | 9 | 根据扩展名返回 MIME 类型 |
| `fileToBase64` | attachments.js | 32 | File → base64 |
| `fileToText` | attachments.js | 63 | File → text |
| `addAttachment` | attachments.js | 71 | 添加附件到待发送列表 |
| `removeAttachment` | attachments.js | 94 | 从待发送列表移除附件 |
| `clearAttachments` | attachments.js | 99 | 清空附件列表 |
| `clearInput` | attachments.js | 104 | 清空输入框 |
| `setButtonState` | attachments.js | 109 | 切换发送/停止按钮状态 |
| `addInheritIcon` | attachments.js | 117 | 继承值旁添加 ↑ 图标 |
| `showEditGroupDialog` | attachments.js | 139 | 显示端点编辑对话框 |
| `showDirectoryPrompt` | attachments.js | 280 | 显示目录选择提示 |
| `hideDirectoryPrompt` | attachments.js | 284 | 隐藏目录选择提示 |
| `showHelpDialog` | attachments.js | 289 | 显示帮助/存储设置对话框 |
| `closeHelpDialog` | attachments.js | 361 | 关闭帮助对话框（带动画） |
| `testConnection` | attachments.js | 402 | 测试端点连接 |
| `collectDescendantIds` | attachments.js | 474 | 递归收集所有后代 ID |
| `clearTestResults` | attachments.js | 486 | 清空（子）节点测试结果 |
| `showAttachmentTooltip` | attachments.js | 499 | 显示附件缩略图 tooltip |
| `hideAttachmentTooltip` | attachments.js | 514 | 隐藏附件 tooltip |
| `renderPendingAttachments` | attachments.js | 520 | 渲染待发送附件缩略图 |
| `showAttachmentPreview` | attachments.js | 549 | 附件预览（图片弹窗/文件下载） |
| `createTooltip` | providers.js | 284 | tooltip 工厂函数 |

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

**renderMessages** (行 30)：清空 `#chat-messages`，遍历 `messages` 数组。用户消息渲染为 `.msg.request.one` 结构（含头像、meta 时间、复制按钮、文本内容、附件栏）。响应消息委托给 `renderResponse`。

**renderResponse** (行 115)：按 `firstTokenTime` 排序后端响应。对每个 response：
- 复用已有的 streaming card（`data-endpoint-id` 匹配），或从 template 新建
- 更新 header：name + remark + 时间 + 反应耗时 + 总耗时 + 状态 + 错误 + 复制按钮
- `.say` 内容由 `textContent` 升级为 `innerHTML`（renderMarkdown 渲染）
- 调用 `addCodeCopyButtons` 为每个 `<pre><code>` 添加复制按钮
- 处理 thinking 块（`<details class="think">`）：含摘要、耗时、内容
- 处理 embedding 结果（`.embedding-result`）：维度 + 预览 + 复制完整向量

### 3. 流式响应卡片渲染

文件：`main.js:538-695`

- `showThinkingCards`（行 538）：创建 streaming-hint 提示栏（"N个端点思考中" + 全部停止按钮）+ N 张 `fromTemplate("response-card-streaming")` 卡片。每张卡片有单端点停止按钮。
- `updateStreamingCard`（行 583）：按 `sessionId + endpointId` 定位卡片，更新 thinking 块（content + duration）、`.say` 内容、header 反应耗时（首次 token 时间）。
- `updateCardStatus`（行 625）：更新卡片状态 UI：停止按钮隐藏、status-icon 文本切换（spin → status）、失败时显示 error、完成时显示 totalDuration。
- `reorderCardsBySpeed`（行 682）：按 `firstTokenTime` 对 DOM 中卡片重新排列（最快的在最前）。
- `reorderSelectorTagsBySpeed`（行 697）：同步重排选中端点标签顺序。

### 4. 会话列表 (renderSessionList)

文件：`session-list.js:2-60`

从 `<aside.session.list > ol>` 清空并克隆 `<template id="one-session">`。按 `createdAt` 降序排列。每个会话项：

- 点击 → `onSessionSelect(sessionId)`
- 编辑按钮 → 创建 `<input class="editing title">` 内联替换标题文字，Enter/blur 保存，Escape 恢复
- 删除按钮 → `confirmAction` 确认后调用 `onSessionDelete`

### 5. 端点标签栏 (renderSelectedEndpoints / toggleEndpointSelection)

文件：`selected-endpoints.js`

**renderSelectedEndpoints** (行 2)：根据 `selectedEndpoints` 数组生成 `<li>` 列表。每个标签显示完整路径（`ancestors + node.name`）、remark、移除按钮。空状态显示 `<span class="empty hint">请选择端点`。

**toggleEndpointSelection** (行 55)：在 `selectedEndpoints` 中添加/移除 ID。正在生成时阻止操作。触发 `syncJoinBtnState` 同步树中 checkbox。

**bindSelectorEvents** (行 71)：标签点击切换选中、叉号强制移除。为每个标签创建 tooltip（`createTooltip(buildTooltipHTML(...))`），hover 显示节点配置。

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

从 `<template id="edit-group-dialog">` 克隆 `<dialog class="editing endpoint">`。功能：

- 名称 + URL + 格式 + Key + 模型 ID + 备注 6 个字段
- 名称与模型 ID 自动同步（用户起始编辑名称后停止自动同步）
- 继承值图标（↑）：空字段自动填入祖先值，`addInheritIcon` 添加继承标记
- Enter 在字段间切换焦点，最后一个字段 Enter 触发保存
- API Key 显隐切换按钮
- 保存时区分"节点已有值"和"来自继承"，避免无覆盖继承值

### 9. 帮助/存储对话框 (showHelpDialog / showDirectoryPrompt)

文件：`attachments.js:289-386`

- `showHelpDialog` 从 `<template id="help-dialog">` 克隆
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
