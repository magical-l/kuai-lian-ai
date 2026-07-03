---
title: 端点树
covers_file: [src/modules/endpoint-tree.js]
depends_on: [ui.md]
api_signature: renderEndpointList, collapseAllEndpointNodes, updateEndpointTestUI, updateEmptyState
last_updated: 2026-07-03
why_exists: 端点配置的树形展示、递归渲染、拖拽排序和测试状态更新
---

# 快连AI 端点树模块文档

文件：`src/modules/endpoint-tree.js` | 入口：`renderEndpointList`（从 `main.js:refreshUI` 调用）

## 设计意图

端点树是「左侧面板」的核心组件，以递归树结构展示所有端点节点（小组 → 端点）。每个节点是一个 `fromTemplate("one-endpoint")` 克隆的 `<li>`，包含：

- `<details>` 原生三角箭头（展开/收起）
- 拖拽手柄（`.handle`，`draggable=true`）
- 名称 + 类型标签 + remark
- 操作栏：添加子节点、批量测试、加入会话 checkbox、编辑、删除
- 节点类型 tooltip（hover 显示继承链配置）
- 顶部类型筛选栏（全部/嵌入/生图/重排序）

树的数据模型由 `store.js` 管理（`getGroups` / `endpointsData`），`endpoint-tree.js` 只负责 DOM 渲染和交互事件绑定。

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

---

## 核心系统详解

### 1. 递归渲染 (renderEndpointList)

行 24-398。入口清空 `<aside.endpoint.list > ol>`，调用内部函数 `renderTreeNode` 递归遍历 `nodes` 数组。

每个节点渲染流程：

1. **克隆模板**：`fromTemplate('one-endpoint', 'li')`，无子节点时添加 `.compact` class。模板结构：`<li><details><summary>` 保持原生 `display:list-item` 保留三角 marker，summary 内包 `<header class="inline flex items-x-mutex" style="width:95%">` 含 handle、type-badge、name、actions 四个子元素，header 用 `width:95%` 避开 marker 占位、`items-x-mutex`(space-between) 分布内容。
2. **拖拽手柄**（行 39-58）：`dataTransfer.setData("text/plain", node.id)`，dragstart/dragend 事件。可拖拽值为 `effectAllowed = "move"`
3. **展开/收起**：
   - `<details>` 原生 `open` 属性 + `<summary>` 原生三角箭头控制显隐
   - 无子节点时（`.compact`）隐藏三角箭头（`list-style: none` + `::marker`）
   - `<details>` 的 `toggle` 事件同步 `collapsedEndpoints` Set 状态
4. **名称 + 类型标签 + Tooltip**（行 65-85）：
   - 名称文本设为 `node.name`
   - 类型标签（`.type-badge`）紧跟在 `.name` 后面，渲染时根据 `rcfg.type` 设置：embedding→🔢、image→🎨、rerank→📊（chat 不显示标签，减少视觉噪音）
   - `createTooltip(tooltipId, buildTooltipHTML(node, rcfg, node.name))` 绑定到 `summaryEl` 的 mouseover/mouseleave/click
   - tooltip 内容由 `selected-endpoints.js` 的 `buildTooltipHTML` 生成
5. **操作栏**（行 103-281）：
   - **添加子**：调用 `showEditGroupDialog(null, node.id, ...)` 新增
   - **批量测试**（行 116-233）：
     - 判断可测试节点（recursive `collectTestable`）：需有 `baseUrl + key + modelId`，且 `config.type` 为 chat/embedding
     - 按钮 CSS class 切换：`connected`（全部成功）/ `failed`（有失败）/ `testing`（旋转动画）
     - 点击触发所有子节点 `onTestConnection(id)`
     - 按钮 title 显示汇总统计："✓ 全部成功" / "✗ N个失败：错误信息"
   - **加入会话**（行 235-257）：checkbox + `applyJoinBtnUI` 同步选中状态，change 事件直接操作 `selectedEndpoints` 数组
   - **编辑/删除**：委托到 `onNodeEdit` / `onNodeDelete`
6. **拖放排序**（行 283-329）：
   - `dragover` 根据鼠标在 summary 区域的位置，在 `nodeEl` 上添加三类 drop zone class：
     - `drag-over-before`（上半区 → 插到该节点前）
     - `drag-over-child`（下半区或非 summary 区域 → 作为子节点）
   - `drop` 事件读取 `draggedId`，根据 drop zone 类型调 `onReorderNodes(draggedId, targetId, true)` 或 `onMoveNode(draggedId, node.id)`
7. **递归子节点**（行 331-342）：有子节点时创建 `<ol class="children">`（使用 `<details>` 原生 open/close 控制显隐），递归调用 `renderTreeNode`。内容追加到 `<details>` 而非 `<li>`。
8. **类型筛选**：在端点树 header 行（`AI服务端点` 标题右侧）渲染多选 checkbox 组（🔢嵌入/🎨生图/📊重排序）。「全部不选 = 显示所有，选一个或多个 = 只显示匹配类型」。`initEndpointFilter` 用 change 事件委托监听 header 内 `.type-filter` 的 checkbox change，操作 `activeTypeFilters` Set（add/delete），然后调用 `applyEndpointFilter` 遍历所有 `li.one.endpoint`，按 `activeTypeFilters` 匹配显示/隐藏。`renderEndpointList` 末尾自动恢复筛选。分组节点先检查子节点是否有匹配再决定自身显隐。

9. **空状态提示**：`renderEndpointList` 末尾检查 `.endpoint.list .empty-state` 容器，根据情况显示：
   - 无任何端点时显示「目前还没有创建端点。」+「去创建」按钮（点击触发 `.add-group.btn` 的 click）
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

行 400-487。三段式更新：

1. **单节点**（行 401-424）：按 `data-node-id` 定位 DOM，根据 `connectionStatus.get(nodeId)` 更新按钮 class（`.testing` / `.connected` / `.failed`）+ title
2. **全局 test-all 按钮**（行 426-458）：遍历所有可测试节点，汇总状态
3. **父级 batch 测试按钮**（行 459-486）：从当前节点向父级逐级爬升，对每个父级节点检查其所有子节点的测试结果，同步按钮状态。需要 `nodeEl.parentElement` 满足 `.children` class 才能找到父级。

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
| 2026-07-02 | 去掉自定义 .expand 按钮，复用 `<summary>` 原生三角箭头 | 自定义按钮与原生功能重复；flex 布局需移到 summary 内层 div 以避免 Chrome 隐藏原生 marker |
| 2026-07-02 | summary 内包 header(95%+inline-flex+items-x-mutex) 实现 handle+name 左、actions 右布局 | 原生 marker 与 flex 互斥（Chrome），改用 95% 宽度避开 marker 占位 + items-x-mutex(space-between) 分布内容 |
| 2026-07-03 | 端点节点名称旁加类型标签，chat 不显示 | 嵌入/生图端点太多时难以在树中目视定位；chat 为主，标签只对非 chat 类型有意义 |
| 2026-07-03 | 端点树顶部加类型筛选栏（全部/嵌入/生图/重排序），事件委托避免重绘后丢失 | 筛选需要跨层次（分组节点隐藏前检查子节点匹配），CSS-only 无法处理父子关系；`renderEndpointList` 重绘后自动恢复筛选状态 |
| 2026-07-03 | 端点树列表为空时显示两种提示：「去创建」（无任何端点）和「重置筛选」（筛选后无结果） | 空列表无提示时用户不知该做什么；区分"没建过"和"被筛掉了"两种场景，各提供对应操作按钮 |
