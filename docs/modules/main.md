---
title: 主模块（编排层）
covers_file: [src/modules/main.js]
depends_on: [store.md, api.md, ui.md, endpoint-tree.md]
api_signature: init, handleSend, refreshUI, handleSessionSelect, updateCardAsEmbedding
last_updated: 2026-07-23
why_exists: 应用编排层——初始化、事件路由、多模型流式编排、状态同步
---

# 快连AI 主模块文档

文件：`src/modules/main.js`

## 设计意图

`main.js` 是应用的**编排层**（orchestrator），不处理数据持久化（store.js）、不处理 API 协议（shared.js）、不处理 UI 渲染细节（messages.js / endpoint-tree.js / session-list.js 等）。它的职责是：

- 初始化所有组件（分隔条、滚动、输入绑定）
- 处理用户输入（send/embedding/stop）
- 协调多模型并行调用（callAllModels）与流式更新
- 管理会话生命周期（create → select → delete）
- 转发 store 变更后的 UI 刷新（refreshUI）

全局状态变量（声明在文件顶部，无 `var/let/const`）：
- `selectedEndpoints`：当前会话选中端点 ID 数组
- `currentSession`：当前会话对象引用
- `sessionGenerations`：Map<sessionId, Map<endpointId, generationState>>
- `lastUserMessage`：最后一条用户消息纯文本
- `defaultSelectedEndpoints`：localStorage 持久化的默认端点

---

## 函数索引

| 函数 | 用途 |
|------|------|
| `loadDefaultSelectedEndpoints` | 从 localStorage 恢复默认端点 |
| `saveDefaultSelectedEndpoints` | 持久化默认端点到 localStorage |
| `init` | 应用初始化入口 |
| `handleDeleteDirectory` | 清除存储配置 |
| `handleWipeDirectory` | 清空所有数据 |
| `updateDirectoryDisplay` | 更新状态栏存储路径显示 |
| `refreshUI` | 全局 UI 重绘（端点树 + 标签栏 + 会话列表 + 消息） |
| `updateChatTitleDisplay` | 更新会话标题 |
| `handleSessionSelect` | 切换当前会话 |
| `handleSessionEdit` | 编辑会话标题 |
| `handleSessionDelete` | 删除会话 |
| `handleAddGroup` | 新增端点组 |
| `handleNodeEdit` | 编辑端点节点 |
| `handleNodeDelete` | 删除端点节点 |
| `handleCopy` | 复制内容到剪贴板 |
| `handleReorderNode` | 同级拖拽重排 |
| `handleMoveNodeAsChild` | 跨级拖拽降级 |
| `handleSend` | 发送消息（主入口，按端点 type 分流 chat/embedding/img-generate） |
| `updateCardAsEmbedding` | 嵌入完成后更新卡片（维度/预览/复制） |
| `updateCardAsImage` | 生图完成后更新卡片（显示图片） |
| `showThinkingCards` | 显示流式响应卡片 |
| `updateStreamingCard` | 更新单张流式卡片 |
| `updateCardStatus` | 更新卡片完成状态 |
| `reorderCardsBySpeed` | 按首 token 时间重排卡片 |
| `reorderSelectorTagsBySpeed` | 同步重排选中标签 |
| `handleNewSession` | 新建会话 |
| `handleFork` | 分叉会话：从指定消息分叉，复制历史消息到新会话，消息文本填入输入框 |
| `initTheme` | 主题初始化：读 settings → 同步 html.class → 注册 matchMedia 监听 |
| `applyThemeClass` | 操作 html 的 `.dark`/`.light` class |
| `setThemePref` | 三态切换：存 settings → 应用 class → 更新按钮图标 |
| `updateThemeIcon` | 同步切换按钮的 char-style class（sun/outline-style↔moon↔half-light/at-left） |
| `handleTestAllConnections` | 测试所有端点的连接 |
| `handleStopAllResponses` | 停止所有响应生成 |
| `handleShowHelp` | 显示帮助/存储设置对话框 |
| `handleChangeDirectory` | 重新选择数据存储目录 |
| `handleFileInputChange` | 文件输入 change 事件处理（添加附件） |
| `handleSendModePopBeforetoggle` | 发送模式 Popover 打开前定位 |
| `handleSendModePopToggle` | 发送模式 Popover 切换时同步按钮 active class |
| `handleThemeRadioChange` | 主题 radio change 处理（亮色/暗色/跟随系统） |
| `handleStopOneResponseClick` | 停止单端点响应生成 |

---

## 核心系统详解

### 1. 初始化流程 (init)

行 22-165。顺序：

1. **UI 组件初始化**：`initDividers()`（分隔条拖拽）、`initScrollNav()`（滚动导航按钮）、`initScrollPaddingObserver()`（sticky 区高度监听）
2. **输入绑定**：
   - `keydown` 监听：Enter / Ctrl+Enter 切换发送模式，统一调用 `handleSend`（按端点 type 内部分流）
   - `paste` 监听：剪贴板图片提取 → `addAttachment`
3. **发送模式选择器**（Popover API）：radio change 事件持久化 `sendMode` 到 localStorage；`beforetoggle`/`toggle` 事件已移至 HTML `onbeforetoggle`/`ontoggle` 属性，对应 `handleSendModePopBeforetoggle` / `handleSendModePopToggle`
4. **存储恢复**：`tryRestoreDirectory()` → 成功则 `refreshUI`，失败则 `showDirectoryPrompt`
5. **按钮绑定**：不再在 JS 中绑定按钮事件。所有按钮/表单的 onclick/onchange 已从 HTML 移至 JS：静态按钮在 init() 中用 .on() 绑定，模板内元素在 fromTemplate() 后用 addEventListener 绑定。详见决策日志 2026-07-13 CSP 兼容性变更。

### 2. 发送主逻辑 (handleSend)

`handleSend` 是发送的唯一入口，按端点 `type` 内部分流：

```
用户点击发送 / Enter
  │
  ├─ getInputMessage() → 组合文本 + 附件 content array
  ├─ selectedEndpoints 为空 → 高亮提示，return
  ├─ currentSession 不存在 → createSession(content, targets) [新会话]
  ├─ currentSession 存在 → addMessage('user', content) [追加]
  ├─ clearInput() + clearAttachments()
  ├─ setButtonState(true, true) [发送禁用 + 停止启用]
  ├─ appendUserMessage() [追加用户消息到 DOM，不清空]
  ├─ showThinkingCards(selectedEndpoints, groups, targetSessionId)
  │
  ├─ 按 type 分流：
  │   ├─ chat 端点 → callAllModels(groups, chatIds, messages, onChunk)
  │   │     ├─ onChunk → updateStreamingCard() + reorderCardsBySpeed()
  │   │     └─ 完成后返回 responses
  │   ├─ embedding 端点 → Promise.all(embedIds.map(id =>
  │   │     callEmbedding(style, url, key, model, text)
  │   │     → updateCardAsEmbedding(id, result, sessionId)
  │   │     → 返回 { endpointId, embeddingResult }
  │   │   ))
  │   └─ img-generate 端点 → Promise.all(imgGenerateIds.map(id =>
  │         callImageGeneration(style, url, key, model, messages)
  │         → updateCardAsImage(id, result, sessionId)
  │         → 返回 { endpointId, imageResult }
  │       ))
  │
  └─ 合并结果 → addMessage('assistant', null, { responses }) [持久化]
       ├─ sessionGenerations.delete(targetSessionId)
       ├─ setButtonState(false, false)
       └─ refreshUI()
```

**多模型消息构建**：
- 历史 assistant 消息：将多条 `responses` 合并为 `content.join('\n\n---\n\n')`
- 用户消息：`normalizeMessageContent` → `toOpenAIContent` 标准化为 OpenAI 格式（即使目标 endpoint 用 Claude/Gemini 协议，格式转换在 shared.js 的 callAllModels 内部完成）

**嵌入端点的处理**：
- 不再有独立的 `handleEmbeddingSend`，嵌入逻辑内联在 `handleSend` 中
- 嵌入端点并发调用 `callEmbedding`，完成后调用 `updateCardAsEmbedding` 替换卡片内容（维度 + 预览 + 复制按钮）
- 嵌入结果保存为 `embeddingResult`（含 dim、preview、fullJson、model、usage）
- 嵌入端点不参与 streaming 排序

### 4. 流式卡片生命周期

```
showThinkingCards(idList, groups, sessionId)
  │ 创建 streaming-hint 栏 + N 张 fromTemplate("response-card-streaming")
  │ 每张卡片 data-session-id + data-endpoint-id
  │
  ├─ updateStreamingCard(id, state, firstTokenTime, groups, sessionId)
  │   │ 实时更新 thinking 块 / .say 内容 / 反应耗时
  │   └─ firstTokenTime 非 null → 添加 .wait 耗时标签
  │
  ├─ reorderCardsBySpeed()
  │   │ 按 firstTokenTime 排序 DOM 中的卡片
  │   └─ reorderSelectorTagsBySpeed() 同步标签顺序
  │
  └─ updateCardStatus(id, status, error, state, sessionId)
      │ 隐藏 stop-one 按钮
      │ 切换 status-icon（spin → status class）
      │ 失败时显示 error 文本
      │ 完成时显示 totalDuration
      └─ requestAnimationFrame 内执行（批量 DOM 写入）
```

卡片完成/失败后，`refreshUI` 检测到流式卡片（`[data-session-id]` 存在）时调用 `renderResponse` 增量更新，将 `.say` 从 textContent 升级为 `innerHTML`（Markdown 渲染）。无流式卡片时调用 `renderMessages` 全量重建。

`handleSend` 发送消息时不再调用 `renderMessages` 全量重建，改用 `appendUserMessage` 只追加新用户消息，并清除旧回复卡片的 `data-endpoint-id`/`data-session-id` 防止冲突。

### 5. refreshUI — 全局状态同步枢纽

行 211-269。在 store 变更后统一调用，保证 DOM 与数据层一致：

1. **端点过滤**：移除已不存在的 `selectedEndpoints` ID
2. **当前会话有效性**：会话已被删除时清空 `currentSession`
3. **渲染端点标签栏**：`renderSelectedEndpoints`
4. **渲染端点树**：`renderEndpointList`（递归重绘整棵树）
5. **渲染会话列表**：`renderSessionList`
6. **渲染消息区**：
   - 有流式卡片 → 调用 `renderResponse` 增量更新
   - 无流式卡片 → `renderMessages` 全量替换
7. **View Transition**：`document.startViewTransition` 包裹 DOM 更新（降级支持：回退到直接调用）

### 6. 会话选择与恢复 (handleSessionSelect)

行 278-317。切换会话时：

1. `loadSession(sessionId)` 从 store 加载完整会话数据
2. 从 lastUserMessage 恢复 `selectedEndpoints`（targetEndpoints/targetModels）
3. 从 `sessionGenerations` 恢复生成状态
4. `refreshUI` 重绘
5. 如果有生成中的端点 → `showThinkingCards` 恢复流式卡片 + `updateStreamingCard` 恢复内容 + `setButtonState(true, true)`
6. 全部完成/失败 → 清理 `sessionGenerations` 条目

### 7. 事件处理函数一览

| handler | 触发 | 行为 |
|---------|------|------|
| `handleSessionSelect(id)` | 点击会话 | 加载会话、恢复端点、恢复生成状态 |
| `handleSessionEdit(id, title)` | 编辑标题 | 原地更新 title → saveSession → refreshUI |
| `handleSessionDelete(id)` | 删除按钮 | deleteSessionGenerations → deleteSession → refreshUI |
| `handleAddGroup()` | 添加组 | showEditGroupDialog → addNode → refreshUI |
| `handleNodeEdit(id)` | 编辑节点 | clearTestResults → showEditGroupDialog → updateNode → refreshUI |
| `handleNodeDelete(id)` | 删除节点 | 清理 selectedEndpoints 引用 → deleteNode → refreshUI |
| `handleCopy(content)` | 复制按钮 | navigator.clipboard.writeText |
| `handleReorderNode` | 拖拽排序 | clearTestResults → reorderNode → refreshUI |
| `handleMoveNodeAsChild` | 跨级降级 | clearTestResults → moveNodeAsChild → refreshUI |
| `handleNewSession()` | 新建会话 | 清空 currentSession → 从 defaultSelectedEndpoints 恢复端点 → refreshUI |
| `handleFork(msgIndex)` | 分叉按钮 | 复制 msgIndex 之前所有消息到新会话 → 切换到新会话 → 该消息文本填入输入框 |
| `handleTestAllConnections()` | test-all 按钮 | 遍历所有节点 testConnection |
| `handleStopAllResponses()` | stop 按钮 | stopAllGenerations + setButtonState(false, false) |
| `handleShowHelp()` | help 按钮 | 检测是否有已保存 handle → showHelpDialog |
| `handleChangeDirectory()` | 更换目录按钮 | selectDirectory → updateDirectoryDisplay → refreshUI |
| `handleFileInputChange(input)` | file-input change | 多文件 addAttachment |
| `handleSendModePopBeforetoggle(e)` | sendModePop beforetoggle | Popover 打开前定位（fixed 计算位置） |
| `handleSendModePopToggle(e)` | sendModePop toggle | 同步按钮 active class |
| `handleThemeRadioChange(radio)` | 主题 radio change | setThemePref + updateThemeIcon + 关闭 Popover |
| `handleStopOneResponseClick(btn)` | 单端点停止按钮 | stopSingleGeneration + 禁用按钮 |
| `handleRecordClick()` | 录音按钮 | 切换录音/停止状态，同步 `aria-pressed` 属性 |

### 8. 主题管理

行 730+。Popover 下拉选择 + radio 直选（亮色/暗色/跟随系统），不再用循环切换。

```
initTheme()  [init() 末尾调用]
  ├── loadSettings() 读 settings.theme
  ├── applyThemeClass(mode)
  │     ├── mode='dark'  → html.classList.add('dark')
  │     ├── mode='light' → html.classList.add('light')
  │     └── mode=null    → 移除 class（跟随系统）
  ├── updateThemeIcon(mode)  切换按钮的 char-style class（light=sun.outline-style / dark=moon / system=half-light.at-left）
  ├── 同步 radio 选中状态（#themePop input[value="dark|light|system"]）
  └── matchMedia('prefers-color-scheme: dark').addListener
        └── 仅在 themeMode=null 时自动切换

#themePop CSS anchor positioning（纯 CSS，无 JS）
  ├── anchor-name: --theme-btn（按钮上）
  ├── position-anchor: --theme-btn（popover 上）
  ├── top: anchor(--theme-btn bottom)
  ├── left: anchor(--theme-btn center)
  └── translate: -50% 4px（居中 + 下方偏移）

radio change → setThemePref(mode)
  ├── themeMode = mode
  ├── applyThemeClass + updateThemeIcon + 同步 radio
  └── saveSettings({ theme: 'light' | 'dark' | undefined })
```

### 9. 与 store/API 层的交互关系

以下调用涉及模块：[store.md](./store.md) · [api.md](./api.md) · [shared.md](./shared.md)

| 调用 | 方向 | 用途 |
|------|------|------|
| `getGroups()` | main → store | 获取端点树数据 |
| `getAllSessions()` | main → store | 获取所有会话列表 |
| `getSession(id)` | main → store | 获取单条会话 |
| `loadSession(id)` | main → store | 加载完整会话（含消息） |
| `saveSession(session)` | main → store | 保存会话 |
| `createSession(msg, targets)` | main → store | 创建新会话 |
| `addMessage(sid, role, content, opts)` | main → store | 追加消息 |
| `deleteSession(id)` | main → store | 删除会话 |
| `addNode(pid, data)` | main → store | 添加节点 |
| `updateNode(id, data)` | main → store | 更新节点 |
| `deleteNode(id)` | main → store | 删除节点 |
| `reorderNode(did, tid, before)` | main → store | 重排节点 |
| `moveNodeAsChild(did, pid)` | main → store | 移动节点为子 |
| `resolveNodeConfig(id)` | main → store | 解析节点配置（含继承） |
| `findModelById(groups, id)` | main → store | 查找端点（带 ancestors） |
| `getNode(id)` | main → store | 获取单节点 |
| `callAllModels(groups, ids, msgs, cb, sid)` | main → shared | 多模型并行调用 |
| `callEmbedding(style, url, key, model, text)` | main → shared | 嵌入向量调用 |
| `getSessionGenerations(sid)` | main → shared | 获取生成状态 Map |
| `clearSessionGenerations(sid)` | main → shared | 清除生成状态 |
| `deleteSessionGenerations(sid)` | main → shared | 删除生成状态 |
| `stopAllGenerations()` | main → shared | 停止所有生成 |
| `stopSingleGeneration(sid, eid)` | main → shared | 停止单个端点 |

---

## 决策日志

| 日期 | 决策 | 理由 |
|------|------|------|
| 2026-04-23 | sessionGenerations 用双层 Map 按 session 隔离 | 避免多会话并行生成时状态冲突 |
| 2026-04-26 | handleSend 中新建会话 vs 追加消息用 `isNewSession` 标志 | createSession 已包含第一条消息的 addMessage，追加时重复调用会重复添加 |
| 2026-04-26 | 消息转换统一走 OpenAI content array 格式 | callAllModels 内部为每个 endpoint 按协议转格式，主逻辑只维护一种中间格式 |
| 2026-04-26 | refreshUI 中使用 startViewTransition | 平滑 DOM 更新过渡效果，CSS View Transition API |
| 2026-04-26 | 流式卡片完成后不立即移除，由 refreshUI 统一清理 | 避免中途移除导致闪烁、避免与 reorderCardsBySpeed 竞争 |
| 2026-04-27 | 嵌入模式独立为一个函数而非 handleSend 的分支 | 嵌入流程差异太大（单端点、无 streaming、特殊 UI），合并只会增加 if-else |
| 2026-07-13 | CSS class .add-group → .add-node（docs 引用同步更新） | 语义更准确：新增的是端点 node 而非分组 group |
| 2026-07-15 | updateThemeIcon 从 SVG href 切换改为 classList 操作 | 主题按钮图标从 SVG 图标切换为 char-style 语义类（sun/outline-style / moon / half-light.at-left） |
| 2026-07-08 | updateCardAsEmbedding 改用卡内静态的 `.embedding-result` 元素而非动态创建 | `embedding-meta` 模板已内联到 `response-card-streaming`，直接从卡内查找即可 |
| 2026-07-01 | 暗色模式：Popover 下拉选择（亮/暗/系统），radio 直选替代三态循环；beforetoggle 动态定位；settings.theme 持久化；html.className 驱动 | 三态循环 + 同图标用户无法区分当前模式，Popover 下拉 + 独立图标（sun/moon/auto）更清晰 |
| 2026-07-02 | 错误信息从 header 移到 .content（跟 .say 同级），有错误时隐藏复制按钮 | 错误信息过长时 header 空间不足，移到 content 更合理；有错误时复制按钮无意义 |
| 2026-07-03 | 移除全局 inputMode 和 handleEmbeddingSend，handleSend 按端点 type 内部分流 | 端点类型在配置时已知，全局 toggle 是错误抽象；统一入口 + 类型路由使多类型端点并发成为可能 |
| 2026-07-04 | handleSend 新增 img-generate 分流 + updateCardAsImage | 生图端点走 callImageGeneration 非流式路径，图片下载转 base64 持久化，支持会话记录加载 |
| 2026-07-17 | refreshUI doUpdate 统一走 renderMessages 全量渲染 | 移除 hasStreamingCards 分支（该分支只渲染最后一条消息，导致旧轮次丢失）。所有场景均 `renderMessages` + `ensureStreamingHint` |
| 2026-07-17 | API 上下文构建合并连续 assistant 消息 | flat 格式后每条 assistant 消息独立，连续多条用 `\n\n---\n\n` 合并；兼容不支持多 assistant 的 provider |
| 2026-07-17 | updateCardStatus failed/stopped 时 `.say` 显示 ✗ 及失败色 | 空 `.say` 让用户困惑；✗ + `--danger-light` 背景比空白或等待回复更清晰 |
| 2026-07-09 | 内联样式迁移到 utility class + classList。`style.display` → `classList.remove('hidden')`；移除无定义的 `.mb-1` 查询及冗余 inline 样式设置 | 与 CSS 分离，用 classList 而非 style.display 控制显隐；`.mb-1` 无对应 CSS 定义
| 2026-07-11 | handleSend 改用 appendUserMessage 替代 renderMessages | 发送消息时不清空 `.msg.list`，避免全量 DOM 重建；旧回复卡片保留，清除 `data-endpoint-id`/`data-session-id` 防止与新 streaming cards 冲突 |
| 2026-07-12 | 事件绑定从 JS 移到 HTML 内联属性（随后因 CSP 限制回退） | 减少 init() 中的事件绑定代码，但 Chrome 扩展 CSP 禁止内联脚本执行 |
| 2026-07-13 | 事件绑定从 HTML 内联属性回到 JS addEventListener | Chrome 扩展 CSP script-src 'self' 禁止内联 onclick/onchange/ontoggle 等，所有 46 处 onxxx 改为 init() 中的 .on() 或模板克隆后的 addEventListener |
| 2026-07-22 | TTS handler 新增会话参数覆盖合并（与 image generation 模式一致） | 修复 TTS 端点绕过会话级 voice/instruction 覆盖的 bug |
| 2026-07-22 | TTS 播放器从 `.content > .audio-result` 移到 `.say` 内部 | `(无内容)` 占位文本被 `<audio controls>` 播放器取代；updateCardAsAudio 和 messages.js 音频渲染同步修改 |
| 2026-07-22 | 新增消息分叉功能（handleFork） | 用户消息 header 新增分叉按钮，点击后以该消息为分叉点创建新会话（复制之前的历史消息），消息文本填入输入框，等待编辑/重发 |
| 2026-07-23 | `handleNodeDelete` 直接移除 DOM 节点，`refreshUI` 新增 `{ skipEndpointTree: true }` 选项 | 删除端点后不触发整个端点树重绘，保持滚动位置不丢失 |
| 2026-07-23 | 录音按钮添加 aria-pressed 属性，CSS 切换图标（🎤→⏹）+ 脉冲动画 | 录音中无视觉反馈，用户无法区分是否正在录音 |
