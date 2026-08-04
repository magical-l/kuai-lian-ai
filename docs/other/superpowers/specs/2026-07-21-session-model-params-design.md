---
title: 会话模型参数覆盖设计
covers_file: [src/modules/selected-endpoints.js, src/modules/shared.js, src/modules/main.js, src/modules/attachments.js]
depends_on: [data-model.md]
api_signature: defaultSelectedEndpointParams / openSessionParamEditor / updateSession
last_updated: 2026-08-03
why_exists: 定义会话级 API 参数覆盖机制，用户可为每个端点独立设置仅当前会话/工作空间有效的参数
---

# 会话模型参数覆盖设计

## 概述

点击已选中模型标签打开参数弹窗，用户可设置仅本次会话生效的 API 调用参数覆盖。移除操作保留在 × 按钮上不变。

## 数据模型

### 会话对象新增字段

```json
{
  "id": "uuid",
  "title": "标题",
  "createdAt": 1700000000000,
  "modelParams": {
    "endpointId1": { "temperature": 0.7, "max_tokens": 4096 },
    "endpointId2": { "top_p": 0.9 }
  },
  "messages": [...]
}
```

- `modelParams` 是会话的顶级字段，key = endpointId，value = 参数键值对
- 随会话一起持久化/加载；已缓存会话的参数变更通过 `updateSession` 进入 store 的串行持久化队列
- 切换会话/刷新页面自动跟随

### 状态变量

无新增全局变量。`currentSession.modelParams` 即运行时数据源。

## 交互设计

### 交互分割

| 操作 | 行为 |
|------|------|
| 点击标签主体 | 打开参数弹窗 |
| 点击 × 按钮 | 从会话移除该模型（不变） |

### 弹窗 UI

```
┌─── 参数覆盖 · openai/gpt-4o ────────┐
│                                      │
│  以下为 API 调用参数，仅在本次会话生效。│
│  留空=使用端点默认值                  │
│                                      │
│  temperature:  [╌╌╌╌●╌╌╌╌╌╌╌╌] 0.7 │
│  max_tokens:   [____4096____]       │
│  top_p:        [╌╌╌╌●╌╌╌╌╌╌╌╌] 0.9 │
│  top_k:        [____40______]       │
│  ...                                │
│  [+ 自定义参数]                       │
│                                      │
│  ┌─────────┐  ┌──────────────┐      │
│  │  关闭    │  │  重置为默认   │      │
│  └─────────┘  └──────────────┘      │
└──────────────────────────────────────┘
```

### 默认值来源

弹窗中每个参数控件的初始值 = `currentSession.modelParams[endpointId]?.[key]` ?? `resolveNodeConfig(id).params[key]`

即：已保存的会话覆盖值优先，没有则取端点树的默认值。

### 保存逻辑

- 保存按钮先更新工作区级 `defaultSelectedEndpointParams`，有当前会话时再 `await updateSession` 写入 `modelParams[endpointId]`
- `updateSession` 在保存失败时恢复当前会话缓存的变更前快照；对话框仅在成功后关闭
- 用户填入的值与原默认值相同时，可存可不存——存了也不影响行为

### 重置

- "重置为默认"按钮：删除工作区级覆盖；有当前会话时通过 `updateSession` 删除 `modelParams[endpointId]`，表单回退到 `resolveNodeConfig(id).params`
- 重置完成后立即重绘表单，不等待关闭对话框

## 数据流

### API 调用时参数合并顺序

```
resolveNodeConfig(id).params
  → info.node.customParams（持久化，端点树层面的覆盖）
  → currentSession.modelParams?.[endpointId]（新增，会话层面的覆盖，优先级最高）
  → mergeParams(reqBody, mergedParams, style)
```

写代码时的实现位置：
- `shared.js` 约 416 行（`callAPI` 函数内部，`config.params` 之后 `mergeParams` 之前）
- `attachments.js` 测试连接处同样位置

### 跨会话行为

- 切换会话 → `currentSession` 变 → `modelParams` 自动切换
- 新建会话 → 首次发送时将当前工作区参数深拷贝传给 `createSession`，形成之后独立于工作区变更的会话快照
- 导出/导入会话 → `modelParams` 随会话 JSON 一起导出导入

## 技术实现

### 改动文件清单

| 文件 | 改动 |
|------|------|
| `src/modules/params-registry.js` | 暴露 `getParamDefs` 为全局（如未全局化） |
| `src/modules/selected-endpoints.js` | `handleSelectedEndpointClick` 改为弹窗；新增弹窗渲染/保存函数 |
| `src/modules/shared.js` | `callAPI` 内插入 session override 合并 |
| `src/modules/attachments.js` | 测试连接处插入 session override 合并；提取 `renderParamControls` 为独立全局函数 |
| `src/layout.html` | 新增 `<dialog id="session-param-editor">` 模板 |
| `src/style.css` | 弹窗样式（如有必要） |
| `docs/modules/...` | 更新相关文档 |

### 复用模式

弹窗内的参数控件复用 `renderParamControls()`（当前在 `attachments.js` 的 `showEditGroupDialog` 中定义），该函数根据 `type` 和 `style` 从 `getParamDefs` 获取参数定义并渲染对应控件（range/slider/number/select/text）。

### 保存时机

用户点击保存或重置时立即触发一次会话持久化。会话缓存更新和存储写入由 `updateSession` 原子串行处理，避免直接改 `currentSession` 后再异步调用 `saveSession`。

## 边界情况

- 端点在端点树中被删除：`selectedEndpoints` 已清，弹窗不会触发
- 端点的 `type`/`style` 变了：弹窗参数控件根据当前 `resolveNodeConfig` 渲染，参数定义自动跟随
- 同名参数在 `customParams` 和 session override 中都设了：session override 优先级更高
- 保存或重置期间切换会话：处理器以打开时捕获的 endpointId 写入，但以点击时的 currentSession.id 为目标；调用方应避免在未完成的对话框提交期间切换会话

## 决策日志

- 2026-08-03: 会话参数改用 `updateSession`，新会话在 `createSession` 首次写入时接收工作区参数快照，确保持久化失败可回滚且不会出现“先缓存后保存”的窗口。
