---
title: 模型参数设置（Phase 1）
description: 在编辑端点弹窗中为不同模型类型/接口风格添加可配置 API 参数控件
author: AI
date: 2026-07-19
status: draft
phase: 1/2
---

# 模型参数设置 — Phase 1：端点级参数

## 动机

当前所有 API 参数（temperature、max_tokens、top_p 等）均为硬编码，用户无法调节。
例如 Claude 的 `max_tokens: 4096` 写死在 `providers.js` 中，OpenAI 请求不传任何参数。
用户需要为每个端点独立配置其模型的运行参数。

## 架构总览

```
参数注册表 ──→ UI 动态渲染控件 ──→ 存为端点 params ──→ 请求时 merge 到 body
(静态定义)     (编辑弹窗表单内)      (端点数据)        (shared.js 调用点)
```

核心概念分层：
- **A 层 — 参数注册表**：静态 JSON，定义每种 `(type, style)` 组合有哪些参数及控件类型
- **B 层 — 端点 params**：每个端点节点的实例数据，只存用户设定的值

---

## 1. 参数注册表

新文件 `src/modules/params-registry.js`。

### 结构

两层嵌套：`type → style → paramDef[]`。`common` 表示该 type 下所有 style 都有的通用参数。

```js
var PARAMS_REGISTRY = {
  chat: {
    common: [
      { key: "temperature",   label: "Temperature",    type: "range",   min: 0, max: 2,   step: 0.1, default: 1 },
      { key: "top_p",         label: "Top P",          type: "range",   min: 0, max: 1,   step: 0.1, default: 1 },
      { key: "max_tokens",    label: "Max Tokens",     type: "integer", min: 1,            default: 4096 },
    ],
    openai: [
      { key: "presence_penalty",  label: "Presence Penalty",  type: "range",   min: -2, max: 2, step: 0.1, default: 0 },
      { key: "frequency_penalty", label: "Frequency Penalty", type: "range",   min: -2, max: 2, step: 0.1, default: 0 },
      { key: "seed",              label: "Seed",              type: "integer", nullable: true },
    ],
    claude: [
      { key: "top_k",          label: "Top K",       type: "integer", min: 1, max: 500 },
      { key: "stop_sequences", label: "Stop Sequences", type: "text", placeholder: "逗号分隔多个" },
    ],
    gemini: [
      { key: "top_k",          label: "Top K",       type: "integer", min: 1, max: 500 },
      { key: "stop_sequences", label: "Stop Sequences", type: "text", placeholder: "逗号分隔多个" },
    ],
  },
  embedding: {
    // 暂无参数注册（纯维度设定暂不确定是否通过 params 暴露）
  },
  "image-generation": {
    common: [
      { key: "size",    label: "Size",    type: "select", options: ["1024x1024", "1792x1024", "1024x1792"], default: "1024x1024" },
      { key: "quality", label: "Quality", type: "select", options: ["standard", "hd"], default: "standard" },
      { key: "n",       label: "Count",   type: "integer", min: 1, max: 10, default: 1 },
    ],
  },
  reranking: {
    common: [
      { key: "top_n", label: "Top N", type: "integer", min: 1, default: 10 },
    ],
  },
};
```

### 参数定义字段

| 字段 | 类型 | 必需 | 说明 |
|------|------|------|------|
| `key` | string | ✅ | 参数名，同时也是存储 key 和 API 字段名 |
| `label` | string | ✅ | 控件标签文字 |
| `type` | enum | ✅ | `range` / `integer` / `text` / `select` |
| `min` / `max` | number | 按需 | range、integer 的边界 |
| `step` | number | 按需 | range 的步进 |
| `default` | any | 按需 | 默认值 |
| `placeholder` | string | 按需 | text 输入框提示 |
| `options` | string[] | select 必填 | 下拉选项 |
| `nullable` | bool | 按需 | 是否允许空值 |

### 注册表导出

```js
// params-registry.js
var PARAMS_REGISTRY = { /* ... */ };

function getParamDefs(type, style) {
  var entry = PARAMS_REGISTRY[type];
  if (!entry) return [];
  var defs = (entry.common || []).slice();
  if (style && entry[style]) {
    defs = defs.concat(entry[style]);
  }
  return defs;
}
```

---

## 2. UI — 编辑端点弹窗

### 2.1 位置

表单末尾，在 "指令"（instruction）字段之后、footer 之前。

```html
<details class="param , section">
  <summary>参数设置</summary>
  <div class="param-control , list" data-type-bound></div>
</details>
```

- `data-type-bound` 标记此容器内容由 `(type, style)` 驱动重建
- 如果 `getParamDefs(type, style)` 返回空数组，`<details>` **不渲染**

### 2.2 联动重建

当用户切换 **类型 radio** 或 **接口风格 radio** 时：

1. 获取当前 `type` 和 `style`
2. 调用 `getParamDefs(type, style)`
3. 空数组 → 移除 `<details>` 或隐藏
4. 有参数 → 清空 `.param-control.list` 并重新渲染控件列表

**切换时不保留旧参数值**（因为不同模型/风格的参数不同，保留值反而容易误用）。

### 2.3 控件渲染

每个 `paramDef` 按 `type` 字段渲染：

```
type=range    → <label class="form-row , param-row">
                   <span class="field-label">Temperature:</span>
                   <input type="range" min="0" max="2" step="0.1">
                   <span class="param , val">1.0</span>
                 </label>

type=integer  → <label class="form-row , param-row">
                   <span class="field-label">Max Tokens:</span>
                   <input type="number" min="1">
                 </label>

type=text     → <label class="form-row , param-row">
                   <span class="field-label">Stop Sequences:</span>
                   <input type="text" placeholder="逗号分隔多个">
                 </label>

type=select   → <label class="form-row , param-row">
                   <span class="field-label">Size:</span>
                   <select>
                     <option>1024x1024</option>
                     <option>1792x1024</option>
                   </select>
                 </label>
```

### 2.4 数据流向

**打开编辑对话框时**：
- 如果端点已存 `params.xxx`，用该值填充控件
- 如果未设值，用注册表中的 `default`（如果没有 default 则留空）

**保存端点时**：
- 遍历所有渲染的控件，读取值写入 `saveData.params`
- 只存用户**显式改动过**的值（与 `default` 不同的值）；全部为默认时 `params` 置为 `{}`

### 2.5 界面示意

```
┌─────────────────────────────────────────┐
│ 指令（选填）: [______________________]  │
├─ ▼ 参数设置                              │  ← details 默认收起
│  │ Temperature:     [===o===========] 1.0│
│  │ Top P:           [======o========] 1.0│
│  │ Max Tokens:      [____4096________]   │
│  │ ── 仅 OpenAI ──                      │  ← 可选分隔，显示特色参数来源
│  │ Presence Penalty: [===o===========] 0 │
│  │ Seed:            [________________]   │
│  └───────────────────────────────────────│
├─ ▸ 音色（选填）: [__________________]    │  ← voice/instruction 保持原位
└─────────────────────────────────────────┘
```

---

## 3. 数据存储

### 端点节点 schema 变更

新增字段 `params`（可选，对象类型）：

```js
{
  id: "...",
  name: "...",
  baseUrl: "...",
  modelId: "gpt-4",
  type: "chat",
  style: "openai",
  params: {
    temperature: 0.7,
    max_tokens: 2048,
    presence_penalty: 0.2
  }
  // ... 现有字段不变
}
```

### 继承（inherit）规则

**参数可继承**，继承粒度是**参数级别**而非整体覆盖。

目的：提取公共配置到父级，子节点只设自己的差异参数。

规则：
- `resolveNodeConfig()` 遍历祖先链，按 `Object.assign({}, parent.params, child.params)` 合并
- 子节点设了值的参数覆盖父级同名参数
- 父级有但子节点没设的参数，子节点继承父级值
- 父级全部参数为空时不影响子节点

示例：
```
父级 params: { temperature: 0.7, max_tokens: 4096 }
子级 params: { temperature: 1.0 }
→ 解析结果: { temperature: 1.0, max_tokens: 4096 }
```

注意：继承仅在合并时发生（`resolveNodeConfig` 返回给调用者的值），不修改子节点存储数据。

---

## 4. API 集成

### 调用点修改

所有请求最终经过 `callProvider()`（`src/modules/shared.js`），在此处 merge params。

**修改后逻辑**：

```js
// shared.js — callProvider 中
var body = provider.buildRequest(baseUrl, apiKey, model, messages);

// merge params（如果该端点是 chat 类且 params 非空）
var nodeParams = endpoint.params; // 调用处传入
if (nodeParams && Object.keys(nodeParams).length > 0) {
  if (style === 'gemini') {
    // Gemini 的参数在 generationConfig 内部
    body.generationConfig = body.generationConfig || {};
    Object.assign(body.generationConfig, nodeParams);
  } else {
    Object.assign(body, nodeParams);
  }
}
```

### 调用链路变更

`handleSend()` → `callAllModels()` → `callAPI()` → `callProvider(baseUrl, apiKey, model, messages)`
改为：
`handleSend()` → `callAllModels()` → `callAPI()` → `callProvider(baseUrl, apiKey, model, messages, **endpoint.params**)`

### 测试连接

`testConfig()` 和 `testEmbeddingConfig()` 也需要传 params，确保测试时的请求与正式请求一致。

---

## 5. Phase 2 预览（与会话级参数）

Phase 2 在 "已选端点"（Selected Endpoints）面板中加参数覆盖层：

- 用户可对**本次会话**临时覆盖某个端点的参数（不改端点永久数据）
- 存储位置：session storage 中，与会话绑定
- UI 位置：已选端点卡片/列表项的手风琴或 popover
- 覆盖优先级：会话级覆盖 > 端点级 params > 注册表 default

仅做预览，具体设计在 Phase 2 展开。

---

## 6. 涉及文件

| 文件 | 变更类型 | 说明 |
|------|----------|------|
| `src/modules/params-registry.js` | **新增** | 参数注册表定义 |
| `src/layout.html` | 修改 | 在 "指令" 后插入 `<details>` 收叠区域 |
| `src/modules/attachments.js` | 修改 | `showEditGroupDialog` 中增加参数控件渲染/重建/保存逻辑 |
| `src/modules/shared.js` | 修改 | `callProvider`/`callAPI` 链路透传并 merge params |
| `src/modules/store.js` | 修改 | 节点 schema 增加 `params` 字段（数据迁移兼容） |
| `docs/modules/attachments.md` | 修改 | 更新函数索引 |
| `docs/modules/api.md` | 修改 | 更新调用链路说明 |

---

## 7. 不在此次范围内的内容

- Phase 2 的会话级参数覆盖
- 参数值的类型校验（由浏览器原生控件约束）
- `stop_sequences` 的数组/逗号分隔转换（在 merge 时用 `split(',').map(s => s.trim())` 处理）
- 未选型 model type 的参数（如 tts 已有独立字段，不重复）

---

## 决策日志

- 2026-07-19: 初版设计。参数注册表 + 端点级 params 对象 + 调用层 merge（走法 A）
- 2026-07-19: 修正 — 参数改为可继承（粒度：参数级别，非整体覆盖）；CSS 类名改 `.param.section` / `.param-control.list` / `.param.val`
