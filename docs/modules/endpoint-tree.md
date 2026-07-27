---
title: 端点树
covers_file: [src/modules/endpoint-tree.js]
depends_on: [ui.md]
api_signature: renderEndpointList, collapseAllEndpointNodes, updateEndpointTestUI, updateEmptyState
last_updated: 2026-07-27
why_exists: 端点配置的树形展示、递归渲染、拖拽排序和测试状态更新
---

# 快连AI 端点树模块文档

文件：`src/modules/endpoint-tree.js` | 入口：`renderEndpointList`（从 `main.js:refreshUI` 调用）

## 设计意图

端点树是「左侧面板」的核心组件，以递归树结构展示所有端点节点（小组 → 端点）。每个节点是一个 `fromTemplate("one-endpoint")` 克隆的 `<li>`，包含：

- `<details>` 原生三角箭头（展开/收起）
- 拖拽手柄（`.handle`，`draggable=true`）
- 名称 + 类型标签 + remark
- 操作栏：添加子节点、批量测试、加入会话 checkbox、编辑、复刻、删除
- 节点类型 tooltip（hover 显示继承链配置）
- 顶部类型筛选栏（全部/嵌入/生图/重排序）

树的数据模型由 `store.js` 管理（`getGroups` / `endpointsData`），`endpoint-tree.js` 负责 DOM 渲染和交互事件绑定。Chrome 扩展 CSP 禁止内联脚本，因此节点事件统一在 `buildEndpointNodeEl()` 中通过 `addEventListener` 注册；拖放目标事件由 `bindEndpointNodeDragEvents()` 集中绑定，避免局部 DOM 构建时漏接事件链。

---

## 函数索引

| 函数 | 用途 |
|------|------|
| `collapsedEndpoints` | Set 保存当前折叠的节点 ID |
| `collapseAllEndpointNodes` | 折叠所有节点（遍历 + DOM 操作） |
| `renderEndpointList` | 递归渲染整棵树，末尾恢复当前筛选状态，更新空状态提示（无端点/筛选无结果） |
| `updateEndpointTestUI` | 更新单个节点 + 父级 + 全局 test-all 按钮状态 |
| `activeTypeFilters` | Set，多选筛选状态（存放选中的 type 值，空 Set = 全部显示） |
| `initEndpointFilter` | 初始化筛选栏 change 事件委托（防止 render 后重复绑定），操作 `activeTypeFilters` Set |
| `applyEndpointFilter` | 遍历端点 li 按 `activeTypeFilters` 显示/隐藏，分组节点检查子节点匹配 |
| `handleDetailsToggle` | `<details>` toggle 事件同步 `collapsedEndpoints` Set |
| `handleDragStart` | 拖拽开始，`dataTransfer.setData("text/plain", node.id)` |
| `handleDragEnd` | 拖拽结束，清理 drag class |
| `handleSummaryTooltipMouseover` | summary mouseover 显示 tooltip |
| `handleSummaryTooltipMouseleave` | summary mouseleave 隐藏 tooltip |
| `handleSummaryTooltipClick` | summary click 切换 tooltip 显隐 |
| `handleAddChildClick` | 添加子节点按钮，调用 showEditGroupDialog |
| `handleBatchTestClick` | 批量测试按钮，触发所有子节点 testConnection |
| `handleJoinSessionChange` | join-session checkbox change，操作 selectedEndpoints 数组 |
| `handleEditNodeClick` | 编辑节点按钮，委托到 handleNodeEdit |
| `handleDuplicateNodeClick` | 复刻节点按钮，cloneNode + refreshUI |
| `handleRemoveNodeClick` | 删除节点按钮，confirmAction 后 handleNodeDelete |
| `handleNodeDragover` | dragover 根据鼠标位置设置 drop zone class（before/child） |
| `handleNodeDragleave` | dragleave 清除 drop zone class |
| `handleNodeDrop` | drop 根据 zone 类型调 reorderNode 或 moveNodeAsChild |
| `bindEndpointNodeDragEvents` | 给新建节点集中绑定 dragover / dragleave / drop，保证局部 DOM 构建保持完整拖放链 |
| `handleResetFilter` | 重置筛选按钮，全选所有 type-filter checkbox |
| `handleClickAddEndpoint` | 空状态"去创建"按钮，触发 .add-node.btn click |
| `handleFilterBarChange` | 类型筛选栏 change 事件，操作 activeTypeFilters Set |

---

## 核心系统详解

### 1. 递归渲染 (renderEndpointList)

行 24-398。入口清空 `<aside.endpoint.list > ol>`，调用内部函数 `renderTreeNode` 递归遍历 `nodes` 数组。

每个节点渲染流程：

1. **克隆模板**：`fromTemplate('one-endpoint', 'li')`，无子节点时添加 `.compact` class。模板结构：`<li><details><summary>` 保持原生 `display:list-item` 保留三角 marker，summary 内包 `<header class="inline flex items-x-mutex">` 含 handle、type-badge、name、actions 四个子元素，`inline-flex` 保持与 marker 同行，宽度由 CSS 控制（有 marker 时 `calc(100% - 15px)`，无 marker 时 `.compact` 下 `calc(100% - 5px)`），`items-x-mutex`(space-between) 分布内容。
2. **拖拽手柄**（行 39-58）：`dataTransfer.setData("text/plain", node.id)`，dragstart/dragend 事件。可拖拽值为 `effectAllowed = "move"`
3. **展开/收起**：
   - `<details>` 原生 `open` 属性 + `<summary>` 原生三角箭头控制显隐
   - 无子节点时（`.compact`）隐藏三角箭头（`list-style: none` + `::marker`）
   - `<details>` 的 `toggle` 事件通过 HTML `ontoggle="handleDetailsToggle(this)"` 同步 `collapsedEndpoints` Set 状态
4. **名称 + 类型标签 + Tooltip**（行 65-85）：
   - 名称文本设为 `node.name`
   - 类型标签（`.type-badge`）紧跟在 `.name` 后面，渲染时根据 `rcfg.type` 设置：embedding→🔢、image→🎨、rerank→📊（chat 不显示标签，减少视觉噪音）
   - `createTooltip(tooltipId, buildTooltipHTML(node, rcfg, node.name))` 绑定到 `summaryEl` 的 mouseover/mouseleave/click
   - tooltip 内容由 `selected-endpoints.js` 的 `buildTooltipHTML` 生成
5. **操作栏**（行 103-281）：所有按钮事件在 renderTreeNode 中通过 addEventListener 绑定（取代 HTML onclick）。
   - **添加子**：`handleAddChildClick` → `showEditGroupDialog(null, node.id, ...)` 新增
   - **批量测试**（行 116-233）：
     - 判断可测试节点（recursive `collectTestable`）：需有 `baseUrl + key + modelId`，且 `config.type` 为 chat/embedding
     - 按钮 CSS class 切换：`connected`（全部成功）/ `failed`（有失败）/ `testing`（旋转动画）
     - 点击触发所有子节点 `onTestConnection(id)`
     - 按钮 title 显示汇总统计："✓ 全部成功" / "✗ N个失败：错误信息"
   - **加入会话**（行 235-257）：checkbox + `applyJoinBtnUI` 同步选中状态，通过 HTML `onchange="handleJoinSessionChange(this)"` 操作 `selectedEndpoints` 数组
   - **编辑/复刻/删除**：编辑委托到 `onNodeEdit`；复刻调用 `cloneNode(node.id)` 后刷新；删除委托到 `onNodeDelete`
6. **拖放排序**（行 283-329）：
   - `dragover` 根据鼠标在 summary 区域的位置，在 `nodeEl` 上添加三类 drop zone class：
     - `drag-over-before`（上半区 → 插到该节点前）
     - `drag-over-child`（下半区或非 summary 区域 → 作为子节点）
   - `drop` 事件读取 `draggedId`，根据 drop zone 类型调 `onReorderNodes(draggedId, targetId, true)` 或 `onMoveNode(draggedId, node.id)`
7. **递归子节点**（行 331-342）：有子节点时创建 `<ol class="children">`（使用 `<details>` 原生 open/close 控制显隐），递归调用 `renderTreeNode`。内容追加到 `<details>` 而非 `<li>`。
8. **类型筛选**：在端点树 header 行（`AI服务端点` 标题右侧）渲染多选 checkbox 组（🔢嵌入/🎨生图/📊重排序）。「全部不选 = 显示所有，选一个或多个 = 只显示匹配类型」。`initEndpointFilter` 用 change 事件委托监听 header 内 `.type-filter` 的 checkbox change，操作 `activeTypeFilters` Set（add/delete），然后调用 `applyEndpointFilter` 遍历所有 `li.one.endpoint`，按 `activeTypeFilters` 匹配显示/隐藏。`renderEndpointList` 末尾自动恢复筛选。分组节点先检查子节点是否有匹配再决定自身显隐。

9. **空状态提示**：`renderEndpointList` 末尾检查 `.endpoint.list .empty-state` 容器，根据情况显示：
   - 无任何端点时显示「目前还没有创建端点。」+「去创建」按钮（点击触发 `.add-node.btn` 的 click）
   - 筛选后无结果时显示「没有符合筛选的端点。」+「重置筛选」按钮（点击全选所有 type-filter checkbox 并重新应用）
   - 其他情况隐藏空状态

### 2. 拖拽排序：跨级操作

数据层的 `handleReorderNode` 和 `handleMoveNodeAsChild` 定义在 `main.js:372-381`。

跨级逻辑：

- **同级重排**：`handleReorderNode(draggedId, targetId, insertBefore)` → `reorderNode` → 在 store 中将 `draggedId` 移动到 `targetId` 之前（同级 sibling 内）
- **跨级降级**：`handleMoveNodeAsChild(draggedId, targetParentId)` → `moveNodeAsChild` → 将 `draggedId` 从原父节点移除，追加到 `targetParentId` 的子节点列表末尾

拖拽前调用 `clearTestResults(draggedId)` 清除测试缓存，拖拽后调用 `refreshUI()` 遍历重绘。

### 3. 展开/收起 (collapsedEndpoints)

- `collapsedEndpoints` 是全局 `Set<nodeId>`
- `collapseAllEndpointNodes()`：收集所有节点 ID 加入 Set，DOM 直接设置 `details.open = false` + `textContent: "▶"`
- 单个节点 toggle 展开/收起：监听 `<details>` 的 `toggle` 事件同步 Set
- 数据不持久化（刷新后恢复默认展开）

### 4. 测试状态 UI 更新 (updateEndpointTestUI)

行 505-597。三段式更新：

1. **单节点**：按 `data-node-id` 定位 DOM，根据 `connectionStatus.get(nodeId)` 更新按钮 class（`.testing` / `.connected` / `.failed`）+ title（`getConnectionStatusText`）
2. **全局 test-all 按钮**：遍历所有可测试节点，汇总状态
3. **所有祖先 batch 测试按钮**（while 循环爬升 DOM 链）：对每个祖先节点，用 `collectTestableIds` 收集其全部可测子孙节点，从 `connectionStatus` 检查状态（testing/connected/failed），同步祖先按钮。测试中有子孙则设 `.busy`，全部通过则 `.connected`，有失败则 `.failed`。

### 5. 加入会话勾选 (join-session)

每个叶子节点（有 modelId 的端点）显示 `join-session` 按钮，内含 checkbox：

- `applyJoinBtnUI`（`selected-endpoints.js:121`）根据 `selectedEndpoints` 数组决定 checkbox checked + title 文案 + SVG fill 颜色
- checkbox `change` 事件直接操作 `selectedEndpoints` 数组 + `saveDefaultSelectedEndpoints` + `renderSelectedEndpoints` 重绘标签栏
- 无 modelId 的中间节点隐藏 join 按钮（`joinBtn.style.display = 'none'`）

### 6. 右键菜单

端点树当前未实现自定义右键菜单。删除操作通过 `.remove` 按钮 + `confirmAction` 对话框完成。如果未来需要右键菜单，需新增 `contextmenu` 事件处理。

---

## 与 store 层的交互关系

| 调用 | 方向 | 用途 |
|------|------|------|
| `getGroups()` | tree → store | 获取原始树数据 |
| `getNode(nodeId)` | tree → store | 获取单个节点（编辑/删除） |
| `addNode(parentId, data)` | tree → store | 新增节点 |
| `updateNode(nodeId, data)` | tree → store | 更新节点 |
| `deleteNode(nodeId)` | tree → store | 删除节点 |
| `cloneNode(nodeId)` | tree → store | 深拷贝节点及子树，插入到原节点之后 |
| `reorderNode(draggedId, targetId, before)` | tree → store | 同级重排 |
| `moveNodeAsChild(draggedId, parentId)` | tree → store | 跨级降级 |
| `resolveNodeConfig(nodeId)` | tree → store | 沿祖先链解析完整配置 |
| `findModelById(groups, id)` | tree → store | 通过 ID 查找模型（带 ancestors） |
| `detectModelType(modelName)` | tree → store | 检测模型类型（chat/embedding） |

---

## 决策日志

| 日期 | 决策 | 理由 |
|------|------|------|
| 2026-04-24 | 树节点用 `<li>` + `<div class="children">` 递归嵌套，不用 `<ul>` | 避免嵌套 `<ul>/<ol>` 带来的默认 padding/margin 干扰 |
| 2026-04-24 | 拖拽用 `dragover/drop` 原生 API，不用第三方库 | 只有同级排序 + 跨级降级两种操作，原生 API 足够 |
| 2026-04-25 | drop zone 分三类（before/child/after），不实现 after | 实际需求只有"插到前"和"变成子"，after 与 before 对称但无使用场景 |
| 2026-04-26 | 批量测试按钮 title 显示汇总统计 | 测试结果即时反馈，避免用户反复 hover 看每个子节点状态 |
| 2026-04-27 | 折叠状态不持久化 | 用户对树的折叠习惯变频繁，持久化收益低且增加复杂度 |
| 2026-07-02 | 端点树结构改为 details/summary/ol，利用原生 open/close 替代手动 display 切换 | 语义化 HTML，减少 JS 手动 DOM 操作，提升可访问性 |
| 2026-07-15 | 端点类型 class 名称从 `chat`/`embedding`/`image-generation`/`reranking` 改为 `chat`/`digits`/`palette`/`chart`，对齐 common.css 抽象图标体系 | `.endpoint-type` CSS 定义已删除，图标渲染由 common.css 的 `.icon.char-style` 统一处理 |
| 2026-07-13 | CSS class .add-group → .add-node（JS querySelector/docs 同步更新） | 语义更准确：新增的是端点 node 而非分组 group |
| 2026-07-02 | 去掉自定义 .expand 按钮，复用 `<summary>` 原生三角箭头 | 自定义按钮与原生功能重复；flex 布局需移到 summary 内层 div 以避免 Chrome 隐藏原生 marker |
| 2026-07-02 | summary 内包 header(95%+inline-flex+items-x-mutex) 实现 handle+name 左、actions 右布局 | 原生 marker 与 flex 互斥（Chrome），改用 95% 宽度避开 marker 占位 + items-x-mutex(space-between) 分布内容 |
| 2026-07-15 | updateEndpointTestUI 第3段改为 while 循环爬升所有祖先 + 每层检查全部可测子孙 | 修复两个 bug：(1) 根级节点测试完成后不解除 .busy；(2) 重新测试时中间节点不显示沙漏 |
| 2026-07-03 | 端点树顶部加类型筛选栏（全部/嵌入/生图/重排序），事件委托避免重绘后丢失 | 筛选需要跨层次（分组节点隐藏前检查子节点匹配），CSS-only 无法处理父子关系；`renderEndpointList` 重绘后自动恢复筛选状态 |
| 2026-07-03 | 端点树列表为空时显示两种提示：「去创建」（无任何端点）和「重置筛选」（筛选后无结果） | 空列表无提示时用户不知该做什么；区分"没建过"和"被筛掉了"两种场景，各提供对应操作按钮 |
| 2026-07-04 | summary 内 header 宽度从 inline style 移到 CSS：有 marker 时 `calc(100% - 15px)`，`.compact`（无 marker）时 `calc(100% - 5px)` | 两种场景 marker 宽度不同，分开处理；CSS 控制比内联样式更干净 |
| 2026-07-08 | 节点操作栏新增复刻按钮 | 用户需要快速复制现有端点/分组配置；复刻在数据层生成新 UUID 子树，避免复制后 ID 冲突 |
| 2026-07-08 | `.remark` 从动态创建改为模板内静态存在，JS 只设 textContent | `one-endpoint` 模板内已有 `.remark` 空 span，无需 createElement |
| 2026-07-11 | 测试按钮状态管理从 className 全量重置改为 classList.remove/add | 避免 className 全量覆盖导致 HTML 中 base class（btn, bare, icon-only）丢失；classList 只管理状态类，base class 来自 HTML |
| 2026-07-12 | `.spin` 旋转动画需同时加 `.animation` class | common.css 中 `.spin` 嵌套在 `.animation` 下，JS 只加 `.spin` 不加 `.animation` 导致旋转动画不生效 |
| 2026-07-12 | 交互事件绑定从 JS 移到 HTML 模板 #one-endpoint 的内联属性（随后因 CSP 限制回退） | RenderTreeNode 不再绑定 onclick/onchange/ontoggle/onmouseover/onmouseleave，改为 HTML 属性直接引用全局 handler。因 Chrome 扩展 CSP 禁止内联脚本，该变更于次日回退 |
| 2026-07-13 | 交互事件绑定从 HTML 内联属性回到 JS addEventListener | Chrome 扩展 CSP script-src 'self' 禁止内联脚本，所有 46 处 onxxx 改回 JS 绑定，详见 main.md 对应条目 |
| 2026-07-13 | 测试按钮 CSS class 从 .testing（+ 内 span .spin.animation）改为 .connecting（按钮隐藏，由兄弟 .status.icon.wait 沙漏图标站台） | common.css 新增 .btn.busy + .btn:not(.busy) + .status.icon.wait + .btn + .status.icon 组件模式，沙漏翻转动画替代旋转动画；,

| 2026-07-13 | 测试按钮 CSS class 从 `.testing`（+ 内 span `.spin.animation`）改为 `.connecting`（按钮隐藏，由兄弟 `.status.icon.wait` 沙漏图标站台） | common.css 新增 `.btn.busy + .btn:not(.busy) + .status.icon.wait + .btn + .status.icon` 组件模式，沙漏翻转动画替代旋转动画 |
| 2026-07-23 | `updateEndpointTestUI` 除 CSS class 外，同步更新按钮的 `title` 属性（含错误信息和时间戳） | 测试完成后 hover 仍显示"未测试"，因 `title` 从未更新——只改了视觉 class 没改 tooltip 文案 |
| 2026-07-23 | `renderEndpointList` 新增滚动位置保持：渲染前记住第一个可见节点 ID，渲染后 `scrollIntoView({ block: 'nearest' })` | 删除端点后全量重绘导致滚动位置丢失，"定位不准" |
| 2026-07-23 | 抽取 `buildEndpointNodeEl(node)` 独立函数，单点增/改/克隆直接插 DOM，不再全量重建 | 全量重建浪费 + 滚动位置丢失。与删除走同一模式：局部 DOM 操作 + `refreshUI({skipEndpointTree: true})` |
| 2026-07-23 | 撤销滚动锚点方案，改为 `handleNodeDelete` 直接删 DOM 节点 + 跳过 `renderEndpointList` 重绘 | 滚动锚点无效——DOM 和 data 同时改变，`scrollIntoView` 找不到目标。更根本的方案是不重绘整棵树 |
| 2026-07-23 | 补回 `renderEndpointList` 末尾被 AST 工具误删的 test-all 按钮状态更新代码 | AST 替换函数体时漏掉了 `renderTreeNode` 之后的 `.test-all` 更新逻辑，导致树重绘后 test-all 按钮状态卡在旧值 |
| 2026-07-23 | `updateEndpointTestUI` Part 2/3 及 `renderEndpointList` test-all 按钮：混成状态时也显示叉叉（`anyFail` 而非 `anyFail && !anySuccess`） | 父节点兼有成功/失败的子节点时，原逻辑两个条件都不满足，按钮失去状态类 |
| 2026-07-23 | `buildEndpointNodeEl` 中 tooltip 对象改存到 `summaryEl._tooltip` 而非 `nameSpan._tooltip` | tooltip 事件处理器挂在 `summaryEl` 上、读 `summaryEl._tooltip`，但创建时存到了 `nameSpan`，导致始终 `undefined`，hover 不显示 tooltip |
| 2026-07-27 | `buildEndpointNodeEl` 通过 `bindEndpointNodeDragEvents` 统一绑定 dragover / dragleave / drop | 局部 DOM 构建抽取时漏掉目标事件，浏览器将拖动退化为文本搜索且 drop 不触发；集中绑定避免同类回归 |
