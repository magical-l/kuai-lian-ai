# 会话隔离的生成状态管理

## 问题

当前 `activeGenerations` 使用 `modelId` 作为全局 key，导致：
- 会话 A 用模型 abc 发请求，状态存入 `activeGenerations`
- 会话 B 也用模型 abc 发请求，`callAllModels` 先 `clear()` 清掉 A 的状态
- A 的回复丢失或错乱

## 设计方案

### 数据结构

```js
// 当前（有问题）
let activeGenerations = new Map<modelId, state>  // 全局，跨会话冲突

// 新设计
let sessionGenerations = new Map<sessionId, Map<modelId, state>>
```

每个 state 结构：
```js
{
  abortController,
  status: 'generating' | 'completed' | 'failed' | 'stopped',
  firstTokenTime,
  startTime,
  content,
  thinking,
  thinkingDuration,
  totalDuration
}
```

### 核心函数改造

| 函数 | 改造内容 |
|------|----------|
| `callAllModels` | 参数增加 `sessionId`；先清除该会话的旧状态；创建/更新该会话的子 Map |
| `stopSingleGeneration(modelId)` | → `stopSingleGeneration(sessionId, modelId)` |
| `stopAllGenerations()` | → `stopSessionGenerations(sessionId)`，只停止指定会话的所有请求 |
| `refreshUI` | `isGenerating` 检查改为：`sessionGenerations.get(currentSession?.id)?.some(s => s.status === 'generating')` |
| `handleSessionSelect` | 恢复时取 `sessionGenerations.get(sessionId)` 的子 Map |
| `handleSessionDelete` | 删除会话时调用 `stopSessionGenerations(sessionId)` 并 `sessionGenerations.delete(sessionId)` |
| `handleNewSession` | 无需清除状态（新会话本就没有状态） |

### 场景验证

| 场景 | 预期行为 |
|------|----------|
| 会话 A 发消息 → 新建会话 B 发消息 | A、B 各有独立子 Map，并行不干扰 |
| 会话 A 正在回复 → 切换到会话 B | B 显示自己的状态（可能为空），A 继续后台运行 |
| 切回会话 A | 从 `sessionGenerations.get(A)` 取状态，恢复流式卡片 |
| 会话 A 回复完成 | 保存到 A 的消息列表，不影响 B |
| 删除会话 A | 中止 A 的请求，清除 A 的子 Map |

### 全局停止按钮

保持现状：只停止当前会话的生成。不增加「停止所有会话」功能。

## 实现要点

1. 替换 `activeGenerations` 为 `sessionGenerations`，所有引用处需修改
2. `callAllModels` 调用时传入 `sessionId`（已在 `handleSend` 中有 `targetSessionId`）
3. 所有 `activeGenerations.get(id)` 改为 `sessionGenerations.get(sessionId)?.get(id)`
4. 所有遍历操作需先获取目标会话的子 Map