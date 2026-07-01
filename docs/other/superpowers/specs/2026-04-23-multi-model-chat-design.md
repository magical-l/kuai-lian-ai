---
name: 多模型并行对话系统
description: 输入框上方模型选择器，支持多选、并行调用、实时排序
type: project
---

# 多模型并行对话系统设计

## 背景

当前系统每次只能选择一个模型对话。用户希望同时向多个模型发送相同消息，比较它们的回复质量和速度。

## 核心需求

1. **多模型选择**: 同时选中多个模型，消息发送给所有选中模型
2. **实时排序**: 回复按首字返回速度排序，快的在上
3. **独立控制**: 每个模型可单独停止，也可全部停止
4. **状态可视化**: 模型名标签显示当前状态（等待/思考/输出/完成/失败/停止）

## 数据结构

### 会话存储格式

```json
{
  "id": "session-uuid",
  "title": "你好",
  "startTime": 1706000000,
  "messages": [
    {
      "role": "user",
      "content": "你好",
      "timestamp": 1706000100,
      "targetModels": ["uuid-m1", "uuid-m2", "uuid-m3"]
    },
    {
      "role": "assistant",
      "responses": [
        {
          "modelId": "uuid-m1",
          "content": "你好！",
          "firstTokenTime": 300,
          "status": "completed",
          "timestamp": 1706000200
        },
        {
          "modelId": "uuid-m2",
          "content": "...",
          "firstTokenTime": 2500,
          "status": "completed",
          "timestamp": 1706000250
        },
        {
          "modelId": "uuid-m3",
          "content": null,
          "status": "failed",
          "error": "HTTP 500",
          "timestamp": 1706000300
        }
      ]
    }
  ]
}
```

**字段说明**:
- `targetModels`: 本条用户消息发送给哪些模型（UUID数组）
- `responses`: 多模型回复数组，与上一条user的targetModels对应
- `firstTokenTime`: 首字延迟(ms)，用于排序和颜色标识
- `status`: completed | failed | stopped

### 全局默认模型集

存储位置: localStorage（用户偏好，与端点配置分离）
```json
localStorage.setItem('defaultSelectedModels', JSON.stringify(["uuid-m1", "uuid-m2"]));
```

新会话继承此配置，用户可在会话中修改。

## UI设计

### 模型选择器位置

输入框上方，可折叠展开。

### 标签结构（每个模型）

```
[状态图标] [模型名] [操作按钮]
```

- 状态图标在左（✓完成、◐生成中、⚠失败、■停止）
- 模型名在中间
- 操作按钮在右（✕取消/■停止）

### 颜色规则（影响标签背景）

| 颜色 | 条件 | 含义 |
|------|------|------|
| 绿色 | firstTokenTime < 1s | 响应快 |
| 黄色 | 1s ≤ firstTokenTime < 2s | 响应中等 |
| 橙色 | firstTokenTime ≥ 2s | 响应慢 |
| 红色 | status = failed | 失败 |
| 灰色 | status = stopped | 被停止 |

### 选择器状态

1. **无选中（强制展开）**: 提示"请选择模型"，发送按钮禁用
2. **已选中，展开**: 显示完整模型列表，按端点分组
3. **已选中，收起**: 只显示已选模型标签 + "展开"链接
4. **生成中**: 选择器可展开查看，但禁止修改（标签不可点击），每个标签显示停止按钮

### 消息区显示

用户消息 → 多模型回复卡片（按firstTokenTime排序）

每个回复卡片显示：
- 模型名 + 首字延迟（如"0.3s首字"）
- 回复内容
- 失败时显示错误信息

## 并行调用逻辑

### 发送流程

1. 获取targetModels列表
2. 创建独立的AbortController数组
3. `Promise.all` 并行调用所有模型的stream API
4. 记录每个模型的首字时间戳
5. 实时更新DOM排序

### 首字检测

每个模型的stream回调中：
```js
if (!firstTokenRecorded) {
  firstTokenTime = Date.now() - startTime;
  firstTokenRecorded = true;
  // 触发DOM重排：将此模型移到已开始输出的模型组最前
}
```

### 停止控制

- **单独停止**: 调用对应模型的 `abortController.abort()`
- **全部停止**: 遍历所有activeGenerations调用abort

### 失败处理

失败的模型也显示回复卡片，内容为错误信息，status=failed。

## 左侧栏变化

- 保留端点+模型树结构
- 点击模型**不再触发选中**，只用于展开/收起、编辑、删除
- 选中操作只能在输入框上方的选择器完成

## 历史会话渲染

恢复旧会话时：
1. 读取每条user消息的targetModels
2. 对应的assistant消息按responses数组渲染
3. 按当时记录的firstTokenTime排序显示

## 兼容性

旧会话的单模型消息格式不变，渲染时检测：
- 有`responses`字段 → 多模型渲染
- 无`responses`但有`modelId` → 单模型渲染（向后兼容）

---

**Why**: 用户需要比较不同模型对同一问题的回复质量和速度
**How to apply**: 实现时遵循数据结构和UI规范，确保向后兼容旧会话格式