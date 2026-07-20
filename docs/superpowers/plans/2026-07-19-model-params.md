# 模型参数设置 Phase 1 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在编辑端点弹窗中添加可配置的模型运行参数（temperature、max_tokens 等），按类型+接口风格动态渲染控件，参数值在发送请求时 merge 到 body。

**Architecture:** 静态参数注册表驱动 UI 渲染 → 存为端点 `params` 对象 → `resolveNodeConfig` 沿祖先链合并继承 → `callProvider` 中 merge 到请求 body（Gemini 走 `generationConfig`）。

**Tech Stack:** 纯原生 JS，零框架无构建。

## 全局约束

- 不引入任何外部依赖
- CSS 类名用 kebab-case 逗号分隔风格：`.param.section`、`.param-control.list`、`.param.val`、`.param-row`
- 新增 `params-registry.js` 挂 `var` 全局（项目风格），不写作 ES module
- 参数继承粒度：参数级别（`Object.assign({}, parent.params, child.params)`），不是整体覆盖
- `stop_sequences` 存为逗号分隔字符串，merge 时 `split(',').map(s => s.trim())` 转数组
- 参数注册表中所有 key 需与 API 字段名一致（`max_tokens` 而非 `maxTokens`）

---

### Task 1: 创建参数注册表 (`params-registry.js`)

**文件:**
- Create: `src/modules/params-registry.js`

**Interfaces:**
- Produces: `var PARAMS_REGISTRY` — 全局对象，`type → style → paramDef[]`
- Produces: `function getParamDefs(type, style) → paramDef[]`

- [ ] **Step 1: 写文件**

```js
// src/modules/params-registry.js
// 模型参数注册表 — 定义每种 (type, style) 组合有哪些可配置参数

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
      { key: "top_k",          label: "Top K",          type: "integer", min: 1, max: 500 },
      { key: "stop_sequences", label: "Stop Sequences", type: "text",    placeholder: "逗号分隔多个" },
    ],
    gemini: [
      { key: "top_k",              label: "Top K",              type: "integer", min: 1, max: 500 },
      { key: "stop_sequences",     label: "Stop Sequences",     type: "text",    placeholder: "逗号分隔多个" },
      { key: "max_output_tokens",  label: "Max Output Tokens",  type: "integer", min: 1, default: 2048 },
    ],
  },
  embedding: {
    // 暂无参数注册
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

- [ ] **Step 2: 确认语法正确**

验证文件可 parse，无未闭合括号或引号。

---

### Task 2: 在 `store.js` 中添加 `params` 字段和继承解析

**文件:**
- Modify: `src/modules/store.js`

**接口:**
- Produces: `resolveNodeConfig()` 返回值增加 `params` 字段（按参数级别从祖先链合并继承）

- [ ] **Step 1: `resolveNodeConfig` 中对 `params` 做继承合并**

找到 `resolveNodeConfig` 中祖先链遍历的循环（当前约第 45-50 行），在循环结束后追加 params 继承逻辑：

```js
// 在现有 ancestors 遍历循环之后（约第 51 行）追加：
config.params = {};
if (node.params) {
  for (var k in node.params) {
    if (node.params.hasOwnProperty(k)) config.params[k] = node.params[k];
  }
}
for (var i = ancestors.length - 1; i >= 0; i--) {
  var ap = ancestors[i].params;
  if (ap) {
    for (var k in ap) {
      if (ap.hasOwnProperty(k) && !config.params.hasOwnProperty(k)) {
        config.params[k] = ap[k];
      }
    }
  }
}
```

逻辑：子节点显式设置的参数优先，父节点同参数只填充子节点未设的。

- [ ] **Step 2: 确认旧数据兼容**

旧数据没有 `params` 字段，`node.params` 为 `undefined`，`for...in` 不会执行，`config.params` 保持 `{}`。无需迁移脚本。

---

### Task 3: 在 `layout.html` 中添加参数设置收叠区域 + 脚本加载

**文件:**
- Modify: `src/layout.html`

- [ ] **Step 1: 在"指令"字段之后、hint 之前插入 HTML**

找到 instruction 字段的 `</label>` 行（当前第 543 行），在其后、hint div（第 544 行）之前插入：

```html
<details class="param , section">
  <summary>参数设置</summary>
  <div class="param-control , list" data-type-bound></div>
</details>
```

注意：`<details>` 在编辑模式下初始隐藏（因为 open 属性由 JS 控制），默认关闭。

- [ ] **Step 2: 添加 `params-registry.js` 的 `<script>` 加载标签**

在 `providers.js` 的 `<script>` 标签之后（第 582 行）插入：

```html
<script src="modules/params-registry.js"></script>
```

确保在依赖它的 `attachments.js` 之前加载。

---

### Task 4: 在 `attachments.js` 中实现参数控件的渲染/重建/保存

**文件:**
- Modify: `src/modules/attachments.js`

**Interfaces:**
- Consumes: `getParamDefs(type, style)` from `params-registry.js`
- Consumes: `resolveNodeConfig()` `params` from `store.js`

- [ ] **Step 1: 在 `showEditGroupDialog` 开头获取 `<details>` 引用**

在现有字段引用之后（第 171 行 `instructionInput` 之后）添加：

```js
var paramSection = $('.param.section', dialog);
var paramList = $('.param-control.list', dialog);
```

- [ ] **Step 2: 实现 `renderParamControls(type, style, existingParams)` 函数**

放在 `showEditGroupDialog` 函数内部（在 `updateTypeHint` 之后或作为嵌套函数），根据 `getParamDefs` 渲染控件到 `.param-control.list`：

```js
function renderParamControls(type, style, existingParams) {
  var defs = typeof getParamDefs === 'function' ? getParamDefs(type, style) : [];
  if (!paramSection || !paramList) return;
  if (defs.length === 0) {
    paramSection.style.display = 'none';
    return;
  }
  paramSection.style.display = '';
  paramList.innerHTML = '';
  defs.forEach(function(def) {
    var label = doc.createElement('label');
    label.className = 'form-row , param-row , flex items-go-x items-y-near-center';
    var nameSpan = doc.createElement('span');
    nameSpan.className = 'field-label';
    nameSpan.textContent = def.label + ':';
    label.appendChild(nameSpan);
    var ctrlSpan = doc.createElement('span');
    ctrlSpan.className = 'field-control';
    var val = existingParams && existingParams.hasOwnProperty(def.key)
      ? existingParams[def.key]
      : (def.hasOwnProperty('default') ? def.default : '');
    if (def.type === 'range') {
      var input = doc.createElement('input');
      input.type = 'range';
      input.name = 'param-' + def.key;
      if (def.min !== undefined) input.min = def.min;
      if (def.max !== undefined) input.max = def.max;
      if (def.step !== undefined) input.step = def.step;
      input.value = val !== '' ? val : def.default;
      var valSpan = doc.createElement('span');
      valSpan.className = 'param , val';
      valSpan.textContent = input.value;
      input.addEventListener('input', function() { valSpan.textContent = this.value; });
      ctrlSpan.appendChild(input);
      ctrlSpan.appendChild(valSpan);
    } else if (def.type === 'integer') {
      var input = doc.createElement('input');
      input.type = 'number';
      input.name = 'param-' + def.key;
      if (def.min !== undefined) input.min = def.min;
      if (def.max !== undefined) input.max = def.max;
      if (val !== '') input.value = val;
      else if (def.hasOwnProperty('default')) input.value = def.default;
      ctrlSpan.appendChild(input);
    } else if (def.type === 'text') {
      var input = doc.createElement('input');
      input.type = 'text';
      input.name = 'param-' + def.key;
      if (def.placeholder) input.placeholder = def.placeholder;
      if (val !== '' && val !== null && val !== undefined) input.value = val;
      ctrlSpan.appendChild(input);
    } else if (def.type === 'select') {
      var sel = doc.createElement('select');
      sel.name = 'param-' + def.key;
      (def.options || []).forEach(function(opt) {
        var optEl = doc.createElement('option');
        optEl.value = opt;
        optEl.textContent = opt;
        if (opt === val || (val === '' && opt === def.default)) optEl.selected = true;
        sel.appendChild(optEl);
      });
      ctrlSpan.appendChild(sel);
    }
    label.appendChild(ctrlSpan);
    paramList.appendChild(label);
  });
}
```

- [ ] **Step 3: 在填充表单后触发首次参数渲染**

在现有表单值填充（第 188-197 行）和 type radio 设置（第 200-206 行）之后，调用 renderParamControls：

```js
// 在 type radio 设置完成之后（第 208 行 updateTypeHint 之后）
var initialType = getRadio('type', dialog) || detectModelType(node ? node.modelId || '' : '');
var initialStyle = getRadio('style', dialog);
renderParamControls(initialType, initialStyle, node ? node.params : null);
```

- [ ] **Step 4: 在 type/style 变化时重建参数控件**

找到 type radio 的 change 监听器（第 334 行 `dialog.querySelectorAll('input[name="type"]')`），追加参数重建：

```js
// 修改现有 type change 监听器（第 334 行），在内部追加：
dialog.querySelectorAll('input[name="type"]').forEach(function(r) {
  r.addEventListener('change', function() {
    _typeUserEdited = true;
    typeSel = this;
    renderParamControls(this.value, getRadio('style', dialog), node ? node.params : null);
  });
});
```

找到 style radio 的 change 监听（目前没有显式监听，需要添加）：

```js
dialog.querySelectorAll('input[name="style"]').forEach(function(r) {
  r.addEventListener('change', function() {
    renderParamControls(getRadio('type', dialog), this.value, node ? node.params : null);
  });
});
```

- [ ] **Step 5: 在保存逻辑中收集参数值到 `saveData.params`**

在 `.ok` 按钮的保存逻辑中（第 418 行 `saveData.instruction = ...` 之后），添加 params 收集：

```js
// 收集 params
var params = {};
if (paramList) {
  var inputs = paramList.querySelectorAll('input, select');
  inputs.forEach(function(el) {
    var key = el.name.replace(/^param-/, '');
    if (el.type === 'number') {
      var numVal = parseFloat(el.value);
      if (!isNaN(numVal)) params[key] = numVal;
    } else if (el.type === 'range') {
      params[key] = parseFloat(el.value);
    } else {
      params[key] = el.value;
    }
  });
}
if (Object.keys(params).length > 0) saveData.params = params;
```

注意：`saveData.params` 只存用户改动过的值。如果全部为默认值，`params` 设为 `{}` 或 `undefined`（由 Object.keys 长度判断）。

---

### Task 5: 在 `shared.js` 中实现 params 透传和 body merge

**文件:**
- Modify: `src/modules/shared.js`

- [ ] **Step 1: 修改 `callProvider` 签名和 body merge**

```js
// 修改前：
async function callProvider(provider, baseUrl, apiKey, model, messages, onChunk, signal = null) {

// 修改后：
async function callProvider(provider, baseUrl, apiKey, model, messages, onChunk, signal = null, params) {
```

在 `const config = provider.buildRequest(...)` 之后追加 body merge：

```js
const config = provider.buildRequest(baseUrl, apiKey, model, messages);
// 合并参数配置
if (params && Object.keys(params).length > 0) {
  // Gemini 参数在 generationConfig 内部
  if (provider === providers.gemini) {
    config.body.generationConfig = config.body.generationConfig || {};
    for (var pk in params) {
      if (params.hasOwnProperty(pk)) {
        // stop_sequences 在 Gemini 中是数组
        if (pk === 'stop_sequences' && typeof params[pk] === 'string') {
          config.body.generationConfig[pk] = params[pk].split(',').map(function(s) { return s.trim(); }).filter(Boolean);
        } else {
          config.body.generationConfig[pk] = params[pk];
        }
      }
    }
  } else {
    for (var pk in params) {
      if (params.hasOwnProperty(pk)) {
        if (pk === 'stop_sequences' && typeof params[pk] === 'string') {
          config.body[pk] = params[pk].split(',').map(function(s) { return s.trim(); }).filter(Boolean);
        } else {
          config.body[pk] = params[pk];
        }
      }
    }
  }
}
```

注意：`providers.gemini` 是否可访问取决于 `providers` 变量的作用域。需在 `shared.js` 中确认 `providers` 已全局加载。如果 `providers` 是局部变量，可用 `provider.buildRequest === providers.gemini.buildRequest` 或传入 style 字符串做判断。

更稳妥的方式：改为 `callAPI` 传递 style，或让 `callProvider` 接受 style 参数。

实际上最简单且可靠的判断方式：**在 `callAPI` 层做 merge**，因为 `callAPI` 已经有 `style` 参数。

```js
// callAPI 修改后：
async function callAPI(style, baseUrl, apiKey, model, messages, onChunk, signal = null, params) {
  const provider = providers[style];
  if (!provider) throw new Error('不支持的接口风格: ' + style);
  return await callProvider(provider, baseUrl, apiKey, model, messages, onChunk, signal, style, params);
}
```

然后在 `callProvider` 中接受 `style` 参数并基于 `style === 'gemini'` 做判断：

```js
async function callProvider(provider, baseUrl, apiKey, model, messages, onChunk, signal = null, style, params) {
  const config = provider.buildRequest(baseUrl, apiKey, model, messages);
  if (params && Object.keys(params).length > 0) {
    if (style === 'gemini') {
      config.body.generationConfig = config.body.generationConfig || {};
      for (var pk in params) {
        if (params.hasOwnProperty(pk)) {
          if (pk === 'stop_sequences' && typeof params[pk] === 'string') {
            config.body.generationConfig[pk] = params[pk].split(',').map(function(s) { return s.trim(); }).filter(Boolean);
          } else {
            config.body.generationConfig[pk] = params[pk];
          }
        }
      }
    } else {
      for (var pk in params) {
        if (params.hasOwnProperty(pk)) {
          if (pk === 'stop_sequences' && typeof params[pk] === 'string') {
            config.body[pk] = params[pk].split(',').map(function(s) { return s.trim(); }).filter(Boolean);
          } else if (params[pk] !== null && params[pk] !== '') {
            config.body[pk] = params[pk];
          }
        }
      }
    }
  }
  // ... 后续代码不变
```

- [ ] **Step 2: 修改 `callAPI` 签名透传 params**

```js
async function callAPI(style, baseUrl, apiKey, model, messages, onChunk, signal = null, params) {
  const provider = providers[style];
  if (!provider) throw new Error('不支持的接口风格: ' + style);
  return await callProvider(provider, baseUrl, apiKey, model, messages, onChunk, signal, style, params);
}
```

- [ ] **Step 3: 在 `callAllModels` 中传入 `config.params`**

`callAllModels` 中第 392-409 行调用 `callAPI` 处，传参增加：

```js
// 修改前：
const resultState = await callAPI(config.style || 'openai', config.baseUrl, config.key, (info.node.modelId || info.node.name), messages, chunkState => { ... }, state.abortController.signal);

// 修改后：
const resultState = await callAPI(config.style || 'openai', config.baseUrl, config.key, (info.node.modelId || info.node.name), messages, chunkState => { ... }, state.abortController.signal, config.params);
```

- [ ] **Step 4: 在 `testConnection` 中传入 params**

`src/modules/attachments.js` 中 `testConnection` 函数（第 830 行之前），在调用 `testFn` 后 merge params：

```js
// 在获取 tcfg 之后（第 830 行 var tcfg = testFn(...) 之后）：
var params = rcfg.params;
if (params && Object.keys(params).length > 0) {
  if (rcfg.style === 'gemini') {
    tcfg.body.generationConfig = tcfg.body.generationConfig || {};
    for (var pk in params) {
      if (params.hasOwnProperty(pk)) {
        if (pk === 'stop_sequences' && typeof params[pk] === 'string') {
          tcfg.body.generationConfig[pk] = params[pk].split(',').map(function(s) { return s.trim(); }).filter(Boolean);
        } else {
          tcfg.body.generationConfig[pk] = params[pk];
        }
      }
    }
  } else {
    for (var pk in params) {
      if (params.hasOwnProperty(pk)) {
        if (pk === 'stop_sequences' && typeof params[pk] === 'string') {
          tcfg.body[pk] = params[pk].split(',').map(function(s) { return s.trim(); }).filter(Boolean);
        } else if (params[pk] !== null && params[pk] !== '') {
          tcfg.body[pk] = params[pk];
        }
      }
    }
  }
}
```

注意：为防止代码重复，可抽取一个 `mergeParams(body, params, style)` 工具函数到 `shared.js` 中，两处共用。

- [ ] **Step 5: 抽取 `mergeParams` 工具函数到 `shared.js`**

⚠️ 用 `function mergeParams(...)` 函数声明形式（hoistable），确保在 `attachments.js` 之后加载也能被调用。

```js
function mergeParams(body, params, style) {
  if (!params || Object.keys(params).length === 0) return;
  var target = body;
  if (style === 'gemini') {
    body.generationConfig = body.generationConfig || {};
    target = body.generationConfig;
  }
  for (var pk in params) {
    if (params.hasOwnProperty(pk)) {
      if (pk === 'stop_sequences' && typeof params[pk] === 'string') {
        target[pk] = params[pk].split(',').map(function(s) { return s.trim(); }).filter(Boolean);
      } else if (params[pk] !== null && params[pk] !== '') {
        target[pk] = params[pk];
      }
    }
  }
}
```

导出后，`callProvider` 和 `testConnection` 两处共用。

---

### Task 6: 更新文档

**文件:**
- Modify: `docs/modules/attachments.md` — 新增 `renderParamControls` 函数索引
- Modify: `docs/modules/api.md` — 更新调用链路说明
- Create: `docs/modules/params-registry.md` — 新模块文档

- [ ] **Step 1: 创建 `params-registry.md`**

```markdown
---
title: 参数注册表
covers_file: [src/modules/params-registry.js]
depends_on: []
api_signature: PARAMS_REGISTRY, getParamDefs(type, style)
last_updated: 2026-07-19
why_exists: 定义每种 (模型类型, 接口风格) 组合的可配置 API 参数，驱动编辑弹窗中参数控件的动态渲染
---

## 设计意图

将模型参数的定义（有哪些参数、控件类型、边界值）与 UI 渲染逻辑分离。
注册表是纯数据层，不包含任何 UI 代码。UI 通过 `getParamDefs(type, style)` 查询当前组合的所有参数定义，
然后据此渲染控件。

## 函数索引

| 函数 | 所在文件 | 功能 | 可见性 | 备注 |
|------|----------|------|--------|------|
| `getParamDefs(type, style)` | `params-registry.js` | 根据 type + style 返回参数定义数组 | 全局 | 返回 `common` + style 专属的合并结果 |

## 参数定义字段

| 字段 | 类型 | 必需 | 说明 |
|------|------|------|------|
| `key` | string | ✅ | 参数名，API 字段名和存储 key |
| `label` | string | ✅ | 控件标签 |
| `type` | enum | ✅ | range / integer / text / select |
| `min/max` | number | 按需 | 控件边界 |
| `step` | number | 按需 | range 步进 |
| `default` | any | 按需 | 默认值 |
| `placeholder` | string | 按需 | text 输入框提示 |
| `options` | string[] | select 必填 | 下拉选项 |
| `nullable` | bool | 按需 | 是否允许空值 |

## 决策日志

- 2026-07-19: 初始创建，支持 chat/openai/claude/gemini、image-generation、reranking
```

- [ ] **Step 2: 更新 `attachments.md`**

在函数索引表中新增 `renderParamControls` 和 `mergeParams`（如有导出）：

| `renderParamControls(type, style, existingParams)` | `attachments.js` | 根据 type/style 渲染参数控件到 dialog DOM | 内部函数 | 在 showEditGroupDialog 中调用 |

- [ ] **Step 3: 更新 `api.md`**

在调用链路章节补充 params 透传说明。

- [ ] **Step 4: 运行格式验证**

```bash
python3 scripts/check-docs-format.py
```

---

### Task 7: 端到端验证

- [ ] **Step 1: 打开源码版页面**

```bash
start "" "d:\工作\快连ai\src\layout.html"
```

- [ ] **Step 2: 测试新建端点 — chat + openai 风格的参数控件**

1. 新建端点，输入模型名 `gpt-4`
2. 确保类型自动检测为"聊天"
3. 展开"参数设置"收叠区域
4. 检查渲染了：Temperature(range) / Top P(range) / Max Tokens(number) / Presence Penalty(range) / Frequency Penalty(range) / Seed(number)
5. 改接口风格为 Claude，检查控件切换为 Temperature(range) / Top P(range) / Max Tokens(number) / Top K(number) / Stop Sequences(text)

- [ ] **Step 3: 测试保存和回填**

1. 设 Temperature=0.5，保存端点
2. 重新编辑该端点，确认 Temperature 回填为 0.5
3. 父节点设 Temperature=0.7，子节点不设 Temperature，确认子节点的 Temperature 继承为 0.7
4. 子节点设 Temperature=1.0，确认子节点 Temperature=1.0（覆盖父级）

- [ ] **Step 4: 测试发送请求时参数生效**

1. 抓网络请求或用浏览器 DevTools 检查请求 body
2. 发送一条 chat 消息，确认请求 body 中包含 `temperature: 0.5`（或设定的值）
3. Gemini 风格的请求 body 中参数在 `generationConfig` 内

- [ ] **Step 5: 测试无参数类型不显示**

1. 选择类型为"嵌入"（embedding），确认"参数设置"收叠区域不显示
2. 选择类型为"语音"（tts），确认"参数设置"收叠区域不显示

- [ ] **Step 6: 测试连接**

点击测试连接按钮，确认测试请求 body 中也包含设定的参数值。

---

## 涉及文件汇总

| 文件 | 操作 | 任务 |
|------|------|------|
| `src/modules/params-registry.js` | 新增 | Task 1 |
| `src/modules/store.js` | 修改 | Task 2 |
| `src/layout.html` | 修改 | Task 3 |
| `src/modules/attachments.js` | 修改 | Task 4 |
| `src/modules/shared.js` | 修改 | Task 5 |
| `docs/modules/params-registry.md` | 新增 | Task 6 |
| `docs/modules/attachments.md` | 修改 | Task 6 |
| `docs/modules/api.md` | 修改 | Task 6 |
