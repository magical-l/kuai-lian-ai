---
title: 模型参数必须由用户明确决定实施计划
covers_file: []
depends_on: [../specs/2026-08-14-explicit-model-parameters-design.md]
api_signature: renderModelParamControls / collectModelParamControls / mergeParams
last_updated: 2026-08-16
why_exists: 分任务实施参数三态控件、端点与会话接入及请求过滤
---

# 模型参数必须由用户明确决定 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让所有接口格式只发送用户明确设置或明确继承的参数，并让用户可以在端点或会话中阻止上级参数进入请求。

**Architecture:** 继续用参数字段缺失、具体值和 `null` 分别表示继承、自己设置和由模型决定。`params-registry.js` 只定义参数及建议起点；`ui-utils.js` 用同一套模板构造端点和会话参数控件，并只收集用户实际改动过的决定；`store.js` 和会话覆盖保留 `null`，`shared.js` 在生成请求时跳过它。

**Tech Stack:** 原生 HTML/CSS/JavaScript、Node.js 原生 `node:test`、`vm` 测试 harness、项目 `build.js`。

## Global Constraints

- 所有接口格式使用同一套参数决定规则，不根据模型名猜测参数能力。
- 字段缺失表示继承；具体值表示自己设置；`null` 表示停止继承且不发送。
- 已保存的旧具体值继续生效，不迁移、不自动删除。
- 顶层端点中，用户没有操作时必须保留“字段缺失”和 `null` 的原始区别。
- 用户自行添加的自定义参数保持现有行为。
- 不修改 `vendor/`。
- 源码使用 Tab 缩进和 LF；样式修改必须使用 CSS AST 工具并通过语法验证。
- 用户验收前不更新版本号、不同步完成标记、不提交 Git。

---

## File Structure

### 新增或扩展的职责

- `src/layout.html`：增加一份端点窗口和会话窗口共同克隆的参数决定行模板；修正会话窗口说明文字。
- `src/modules/ui-utils.js`：新增参数控件共用函数，负责构造决定方式、保留未保存的输入值、追踪用户是否改动和收集当前层参数。
- `src/style.css`：统一两个窗口中的参数决定按钮、继承说明、具体值区域和错误提示样式。
- `src/modules/attachments.js`：端点窗口提供当前节点参数、上级最终参数和是否允许继承；保存共用控件收集出的当前节点参数。
- `src/modules/selected-endpoints.js`：会话窗口分别提供本层覆盖和端点最终参数；保存共用控件收集出的会话/工作区覆盖。
- `src/modules/shared.js`：请求生成时跳过 `null`；OpenAI 新格式只有拿到具体思考强度时才创建 `reasoning`。
- `src/modules/store.js`：不计划改实现；用测试锁定现有“字段缺失才继承，`null` 阻止继承”行为。
- `tests/endpoint-tree.test.js`：扩展现有 `vm` 和 Mini DOM harness，覆盖继承、请求、端点窗口和会话窗口。
- `kuai-lian-ai.html`、`dist/`：只由 `node build.js` 生成，不手工编辑。

### 共用接口

`ui-utils.js` 新增以下全局函数，两个窗口都调用同一实现：

```js
function renderModelParamControls(container, definitions, ownParams, fallbackParams, options)
function collectModelParamControls(container, originalParams)
```

`renderModelParamControls()` 的 `options`：

```js
{
	allowInherit: true,
	inheritLabel: '继承上级',
	inheritValueLabel: '当前为',
	modelLabel: '由模型决定'
}
```

- `ownParams` 只包含正在编辑这一层保存的参数，不能传已经与上级合并后的对象。
- `fallbackParams` 只用于显示继承或沿用后会得到什么，不用于判断本层决定方式。
- 每行写入 `data-param-key`、`data-original-state` 和 `data-changed`。
- `collectModelParamControls()` 从 `originalParams` 的副本开始，只改写 `data-changed="true"` 的注册参数；返回：

```js
{ valid: true, params }
```

或：

```js
{ valid: false, params: null, firstInvalidControl }
```

---

### Task 1: 锁定参数继承并修正请求过滤

**Files:**
- Modify: `tests/endpoint-tree.test.js`
- Modify: `src/modules/shared.js:635-667`
- Verify only: `src/modules/store.js:38-121`

**Interfaces:**
- Consumes: `resolveNodeConfig(nodeId)` 返回的 `config.params`。
- Produces: `mergeParams(body, params, style)` 只把具体值写入请求；`null` 和空字符串均不写入。

- [ ] **Step 1: 为参数继承补回归测试**

在 `tests/endpoint-tree.test.js` 使用现有 `createStoreHarness()`，加入：

```js
test('parameter inheritance distinguishes absence, own values, and model-decides null', () => {
	const harness = createStoreHarness({
		nodes: [{
			id: 'parent',
			params: { temperature: 0.7 },
			children: [
				{ id: 'inherit', children: [] },
				{ id: 'own', params: { temperature: 0.3 }, children: [] },
				{ id: 'model', params: { temperature: null }, children: [] }
			]
		}]
	});

	assert.equal(harness.api.resolveNodeConfig('inherit').params.temperature, 0.7);
	assert.equal(harness.api.resolveNodeConfig('own').params.temperature, 0.3);
	assert.equal(harness.api.resolveNodeConfig('model').params.temperature, null);
});
```

该测试预计立即通过；它是防止后续 UI 改动破坏现有继承规则的保护测试。

- [ ] **Step 2: 新增真实 `mergeParams()` harness 和失败测试**

在现有 harness 区增加：

```js
function createMergeParamsHarness() {
	const context = vm.createContext({});
	const sharedSource = fs.readFileSync(path.join(__dirname, '..', 'src', 'modules', 'shared.js'), 'utf8');
	const source = extractFunctionDeclaration(sharedSource, 'mergeParams');
	new vm.Script(`${source}\nglobalThis.__mergeParams = mergeParams;`, { filename: sharedSource }).runInContext(context);
	return context.__mergeParams;
}
```

加入：

```js
test('mergeParams omits model-decides null values for every interface style', () => {
	const mergeParams = createMergeParamsHarness();
	for (const style of ['openai', 'claude', 'gemini', 'responses']) {
		const body = {};
		mergeParams(body, { temperature: null }, style);
		assert.equal(JSON.stringify(body).includes('temperature'), false, style);
	}
});

test('responses reasoning is created only for an explicit effort', () => {
	const mergeParams = createMergeParamsHarness();
	const nullBody = {};
	mergeParams(nullBody, { reasoning_effort: null }, 'responses');
	assert.deepEqual(JSON.parse(JSON.stringify(nullBody)), {});

	const emptyBody = {};
	mergeParams(emptyBody, { reasoning_effort: '' }, 'responses');
	assert.deepEqual(JSON.parse(JSON.stringify(emptyBody)), {});

	const ownBody = {};
	mergeParams(ownBody, { reasoning_effort: 'low' }, 'responses');
	assert.deepEqual(JSON.parse(JSON.stringify(ownBody)), { reasoning: { effort: 'low' } });
});
```

- [ ] **Step 3: 运行测试，确认第二个测试失败**

Run:

```bash
node --test tests/endpoint-tree.test.js
```

Expected: `parameter inheritance...` 通过；`responses reasoning is created only for an explicit effort` 失败，因为当前代码会生成 `{reasoning:{effort:null}}`。

- [ ] **Step 4: 让思考强度遵守空值过滤**

把 `mergeParams()` 中思考强度分支改为先判断具体值：

```js
if (style === 'responses' && pk === 'reasoning_effort') {
	if (params[pk] !== null && params[pk] !== '') {
		body.reasoning = body.reasoning || {};
		body.reasoning.effort = params[pk];
	}
	continue;
}
```

保留普通参数原有过滤，不为其他接口另写分支。

- [ ] **Step 5: 运行针对性测试**

Run:

```bash
node --test tests/endpoint-tree.test.js
```

Expected: 新增继承和请求过滤测试全部通过，原测试不回归。

---

### Task 2: 实现两个窗口共用的参数决定控件

**Files:**
- Modify: `src/layout.html:610-641`
- Modify: `src/modules/ui-utils.js`
- Modify: `src/style.css:1466-1522,1760-1833`
- Modify: `tests/endpoint-tree.test.js`

**Interfaces:**
- Produces: `renderModelParamControls(...)` 和 `collectModelParamControls(...)`。
- Consumers: Task 3 的 `showEditGroupDialog()`、Task 4 的 `openSessionParamEditor()`。

- [ ] **Step 1: 在源码 HTML 中增加共用模板**

在会话参数窗口后添加：

```html
<template id="model-param-row">
	<div class="registered param-row">
		<span class="field-label"></span>
		<span class="field-control">
			<span class="param-decision btn-group , flex items-go-x">
				<label class="option btn : inherit"><input type="radio" value="inherit"><span class="text"></span></label>
				<label class="option btn : own"><input type="radio" value="own">自己设置</label>
				<label class="option btn : model"><input type="radio" value="model"><span class="text">由模型决定</span></label>
			</span>
			<span class="inherited param hint"></span>
			<span class="own param control"></span>
			<span class="validation error"></span>
		</span>
	</div>
</template>
```

同时把会话窗口说明改成具体行为：

```html
<div class="hint">每项参数可以沿用端点设置、自己设置，或明确交给模型决定。</div>
```

- [ ] **Step 2: 先写共用控件的失败测试**

在 `tests/endpoint-tree.test.js` 新增专用 Mini DOM harness，加载 `providers.js` 的 `fromTemplate()` 及 `ui-utils.js` 的两个新函数。至少覆盖：

```js
test('model parameter controls distinguish inherited, own, and model-decides states', () => {
	// ownParams 缺字段 + allowInherit=true → inherit
	// ownParams.temperature=0.3 → own
	// ownParams.temperature=null → model
});

test('untouched parameter controls preserve absent and null source states', () => {
	// 顶层 absent 虽显示 model，收集后仍 absent
	// 顶层 null 收集后仍 null
});

test('changing a parameter decision writes only that registered field', () => {
	// 原对象中的 unknown 和其他注册参数保持原样
	// inherit 删除当前字段；model 写 null；own 写解析后的值
});

test('switching away from own and back preserves the unsaved value', () => {
	// own 输入 0.4 → model → own，输入框仍是 0.4
});
```

测试 harness 中给 `getParamDefs()` 使用的定义固定为：

```js
[
	{ key: 'temperature', label: '温度', type: 'range', min: 0, max: 2, step: 0.1, default: 1 },
	{ key: 'max_tokens', label: '最大 Token 数', type: 'integer', min: 1, default: 4096 },
	{ key: 'reasoning_effort', label: '思考强度', type: 'select', options: ['low', 'medium', 'high'], default: 'high' }
]
```

- [ ] **Step 3: 运行测试，确认共用函数尚不存在**

Run:

```bash
node --test tests/endpoint-tree.test.js
```

Expected: 新测试失败，原因是 `renderModelParamControls` / `collectModelParamControls` 未定义。

- [ ] **Step 4: 在 `ui-utils.js` 实现共用渲染函数**

实现时遵守这些明确规则：

```js
function renderModelParamControls(container, definitions, ownParams, fallbackParams, options) {
	// 清空并为每个 definition 克隆 #model-param-row。
	// ownParams 有具体值 → own；值为 null → model；缺字段 → allowInherit ? inherit : model。
	// 每行保存 original-state 和 changed=false。
	// own 控件始终存在，非 own 时只隐藏，不销毁，因此切换回来保留输入值。
	// 第一次没有具体值时，own 控件使用 definition.default 作为建议起点。
	// radio 的 click 和 change 都能把这一项标为 changed，支持顶层已经选中 model 时再次明确点击 model。
	// fallbackParams 只生成“当前为 X”或“上级未设置，将由模型决定”的说明。
}
```

具体值控件继续支持现有四类：`range`、`integer`、`text`、`select`。所有 input/select 保留 `name="param-<key>"`，避免破坏现有测试和定位方式。

- [ ] **Step 5: 实现共用收集和校验函数**

```js
function collectModelParamControls(container, originalParams) {
	var params = JSON.parse(JSON.stringify(originalParams || {}));
	var valid = true;
	var firstInvalidControl = null;
	// 只遍历 .registered.param-row；custom 行由 attachments.js 现有逻辑处理。
	// changed=false：不改 params，保留 absent 与 null 的原始区别。
	// inherit：delete params[key]。
	// model：params[key] = null。
	// own：按 definition 类型解析并校验后写具体值。
	// 无效时在本行 .validation.error 写具体范围，返回 valid=false。
	return { valid, params: valid ? params : null, firstInvalidControl };
}
```

数字错误信息格式固定为：

```text
请输入 0～2 之间的数值
请输入不小于 1 的整数
```

- [ ] **Step 6: 用 CSS AST 工具增加共用样式**

使用 `css-editor` 或项目 CSS AST 脚本修改 `src/style.css`，把两个窗口已有重复规则收敛到参数行语义上。样式必须实现：

- 决定方式按钮清晰分组，与具体值区域之间有可见间隔。
- `.own.param.control.hidden` 和未使用的继承说明不占布局。
- `.validation.error` 使用危险色文字但不只靠颜色：必须包含具体错误文字。
- 保持正文至少 13px，交互按钮点击高度至少 32px。
- 不给小按钮增加颜色渐变 transition。

Run:

```bash
node scripts/css-ast/validate.js --json src/style.css
```

Expected: JSON 结果表明语法有效，无修复建议。

- [ ] **Step 7: 运行共用控件测试和 CSS 验证**

Run:

```bash
node --test tests/endpoint-tree.test.js
node scripts/css-ast/validate.js --json src/style.css
```

Expected: Task 2 新增测试通过，CSS 语法有效。

---

### Task 3: 把端点编辑窗口接入三种决定方式

**Files:**
- Modify: `src/modules/attachments.js:267-810`
- Modify: `tests/endpoint-tree.test.js:1242-1423` and endpoint-dialog tests

**Interfaces:**
- Consumes: `renderModelParamControls(...)`、`collectModelParamControls(...)`。
- Produces: `showEditGroupDialog()` 的 `onSave(saveData)` 中，`saveData.params` 只包含当前节点明确保存的状态和值。

- [ ] **Step 1: 扩展端点窗口 harness**

扩展 `createEditDialogHarness(tree)`：

- 在 dialog 中加入 `.param.section > .param-control.list`。
- `getParamDefs()` 返回 Task 2 的三项固定定义。
- `resolveNodeConfig()` 同时解析 `params`，保留 `null` 并只在字段缺失时继承。
- 暴露参数容器和必要的决定方式点击辅助函数。

- [ ] **Step 2: 写端点保存的失败测试**

新增：

```js
test('editing endpoint metadata does not save untouched parameter suggestions', () => {
	// 新顶层端点 params 缺失；只改名称并保存；saveData.params 不存在。
});

test('root endpoint preserves untouched absent and null parameter states', () => {
	// absent 仍 absent；null 仍 null。
});

test('child endpoint uses own params to choose inherit despite an effective parent value', () => {
	// 父 temperature=0.7，子缺字段；UI 选中 inherit，说明显示 0.7。
});

test('child endpoint saves inherit, own, and model-decides decisions', () => {
	// inherit 删除字段；own 保存 0.3；model 保存 null。
});

test('endpoint parameter validation blocks save and keeps the dialog open', () => {
	// 选择 own 后填非法数字，onSave 不调用，错误写到当前参数行。
});
```

- [ ] **Step 3: 运行测试，确认现有窗口仍会保存建议值**

Run:

```bash
node --test tests/endpoint-tree.test.js
```

Expected: 新测试失败；当前 `.ok` handler 遍历所有控件，把建议值全部放入 `saveData.params`。

- [ ] **Step 4: 改造 `renderParamControls()` 调用边界**

保留 `showEditGroupDialog()` 的外部签名。内部删除重复构造 range/integer/text/select 的代码，改为：

```js
renderModelParamControls(
	paramList,
	getParamDefs(type, style),
	buildExistingParams(node),
	parentIdOrAncestorsResolvedParams,
	{
		allowInherit: hasParent,
		inheritLabel: '继承上级',
		inheritValueLabel: '当前为',
		modelLabel: '由模型决定'
	}
);
```

编辑现有子节点时，用 `findNodeWithAncestors(...).ancestors` 中最近上级解析 `fallbackParams`；不能把当前节点已经合并后的 `rcfg.params` 当成上级值。新建子节点时使用 `resolveNodeConfig(parentId).params`。

- [ ] **Step 5: 改造端点保存逻辑**

`.ok` handler 调用：

```js
var collected = collectModelParamControls(paramList, buildExistingParams(node));
if (!collected.valid) {
	collected.firstInvalidControl?.focus();
	return;
}
var params = collected.params;
if (Object.keys(params).length > 0) saveData.params = params;
else if (node && node.params) saveData.params = {};
```

最后一行的目的：编辑已有节点并把最后一个当前层字段切成“继承上级”时，必须用空对象覆盖旧 `params`，不能因为省略 `saveData.params` 而让 `Object.assign` 保留旧值。新节点没有参数时不写 `params`。

兼容字段继续由最终 `params` 计算：

```js
saveData.voice = params.voice ?? '';
saveData.instruction = params.instruction ?? '';
```

自定义参数行继续走现有收集逻辑，不加入决定方式。

- [ ] **Step 6: 运行端点窗口测试**

Run:

```bash
node --test tests/endpoint-tree.test.js
```

Expected: Task 3 新测试及原有 full URL、继承图标、批量创建测试全部通过。

---

### Task 4: 把会话参数窗口接入三种决定方式

**Files:**
- Modify: `src/modules/selected-endpoints.js:47-203`
- Modify: `tests/endpoint-tree.test.js:927-1036,1949-2217`

**Interfaces:**
- Consumes: `renderModelParamControls(...)`、`collectModelParamControls(...)`、`persistEndpointParamsTransaction(...)`。
- Produces: workspace 和当前会话保存相同的本层参数对象；`null` 明确阻止端点值；空对象删除该端点覆盖。

- [ ] **Step 1: 扩展会话参数 dialog harness**

建立一个共用 `createSessionParamDialogHarness(options)`，替代 1949–2217 行三个测试重复的 dialog/context 搭建；它必须保留：

- 打开时捕获的 `sessionId`。
- operation generation 和原生 `cancel` / `close` 失效保护。
- 可控的事务 resolve/reject。
- `ownOverride`、`resolvedEndpointParams` 和参数控件 DOM。

现有三个并发/失效测试改为使用新 harness，断言保持不变。

- [ ] **Step 2: 写会话三态的失败测试**

新增：

```js
test('session parameter mode comes from the override layer, not resolved endpoint values', () => {
	// rcfg.temperature=0.7，override 缺字段 → 沿用端点设置，不是自己设置。
});

test('session parameter editor saves own and model-decides values', async () => {
	// own 0.3 同步写 workspace/session；model 同步写 null。
});

test('session parameter editor removes only fields changed to endpoint defaults', async () => {
	// temperature 改沿用时删除 temperature，但保留 top_p 和未知字段。
});

test('session parameter editor removes empty endpoint override objects', async () => {
	// 删除最后一个字段后 nextWorkspaceParams=undefined；session.modelParams[endpointId] 删除。
});

test('untouched session parameters preserve legacy values and null blockers', async () => {
	// 不操作参数就保存，旧具体值和 null 原样保留。
});
```

- [ ] **Step 3: 运行测试，确认当前代码按合并值误判并全量重写**

Run:

```bash
node --test tests/endpoint-tree.test.js
```

Expected: 新测试失败；当前代码把端点值合并进 `defaults`，然后遍历所有控件写成会话覆盖。

- [ ] **Step 4: 分离“本层覆盖”和“沿用后结果”**

在 `openSessionParamEditor()` 中保留两个对象：

```js
var ownOverride = overrideSrc ? JSON.parse(JSON.stringify(overrideSrc)) : {};
var endpointParams = rcfg.params ? JSON.parse(JSON.stringify(rcfg.params)) : {};
```

渲染调用改为：

```js
renderModelParamControls(
	paramList,
	getParamDefs(rcfg.type || 'chat', rcfg.style || 'openai'),
	ownOverride,
	endpointParams,
	{
		allowInherit: true,
		inheritLabel: '沿用端点设置',
		inheritValueLabel: '当前为',
		modelLabel: '由模型决定'
	}
);
```

不得再把 `rcfg.params` 预先复制进会话覆盖显示对象。

- [ ] **Step 5: 保存精确覆盖并清理空对象**

`.ok` handler：

```js
var collected = collectModelParamControls(paramList, ownOverride);
if (!collected.valid) {
	collected.firstInvalidControl?.focus();
	return;
}
var params = collected.params;
var nextWorkspaceParams = Object.keys(params).length ? params : undefined;
```

事务中的会话更新：

```js
if (!session.modelParams) session.modelParams = {};
if (nextWorkspaceParams === undefined) delete session.modelParams[endpointId];
else session.modelParams[endpointId] = JSON.parse(JSON.stringify(params));
if (Object.keys(session.modelParams).length === 0) delete session.modelParams;
```

保存成功后更新闭包中的 `ownOverride`，确保用户不关闭窗口继续操作时，以刚保存的数据为新原始状态。

`.reset` 保持“删除该端点全部会话/工作区覆盖并沿用端点”的现有含义；重绘时传空 `ownOverride` 和原 `endpointParams`。

- [ ] **Step 6: 运行会话参数和事务回归测试**

Run:

```bash
node --test tests/endpoint-tree.test.js
```

Expected: 新增三态测试通过；原有 rollback、打开会话快照和 stale operation 测试全部通过。

---

### Task 5: 静态验证、构建和真实页面测试

**Files:**
- Verify: `src/layout.html`
- Verify: `src/style.css`
- Verify: `src/modules/ui-utils.js`
- Verify: `src/modules/attachments.js`
- Verify: `src/modules/selected-endpoints.js`
- Verify: `src/modules/shared.js`
- Generated: `kuai-lian-ai.html`, `dist/kuai-lian-ai.html`, `dist/extension/`

**Interfaces:**
- Consumes: Tasks 1–4 的最终源码。
- Produces: 三种产物一致、页面无运行时错误的待验收实现。

- [ ] **Step 1: 运行完整 Node 测试**

Run:

```bash
node --test tests/storage.test.js tests/endpoint-tree.test.js
```

Expected: 全部测试通过，失败数为 0。

- [ ] **Step 2: 检查所有改动 JavaScript 的语法**

Run:

```bash
node --check src/modules/ui-utils.js
node --check src/modules/attachments.js
node --check src/modules/selected-endpoints.js
node --check src/modules/shared.js
node --check tests/endpoint-tree.test.js
```

Expected: 每条命令退出码 0，无输出。

- [ ] **Step 3: 验证 CSS 和文档格式**

Run:

```bash
node scripts/css-ast/validate.js --json src/style.css
python3 scripts/check-docs-format.py
```

Expected: CSS 有效；现有文档和本次设计/计划格式均通过。功能文档同步留到用户验收阶段，不在这里提前改版本和完成标记。

- [ ] **Step 4: 构建全部产物**

Run:

```bash
node build.js
```

Expected: 单页面 HTML、Chrome 扩展和 zip 生成成功；不手工编辑构建产物。

- [ ] **Step 5: 由 verify 子代理做静态复核**

Prompt 必须包含：

```text
改动文件: src/layout.html, src/style.css, src/modules/ui-utils.js, src/modules/attachments.js, src/modules/selected-endpoints.js, src/modules/shared.js, tests/endpoint-tree.test.js
改动意图: 参数只有在用户明确设置时才发送；字段缺失/具体值/null 分别表示继承/自己设置/由模型决定。
检查: 源码与构建产物一致、JS/CSS/HTML 语法、模板结构、测试结果、未修改 vendor 和版本号。
```

Expected: 静态验证通过后再进入真实页面测试。

- [ ] **Step 6: 由 testing 子代理做真实页面测试**

Prompt：

```text
改动文件: src/layout.html, src/style.css, src/modules/ui-utils.js, src/modules/attachments.js, src/modules/selected-endpoints.js, src/modules/shared.js
改动意图: 参数窗口增加“继承/沿用、自己设置、由模型决定”；未操作的建议值不保存。
关键区域: 新建和编辑顶层端点、编辑子端点、已选端点的会话参数窗口、OpenAI 新格式思考强度。
不应受影响: 端点名称/URL/API Key 保存、批量创建、自定义参数、参数保存事务、发送和停止按钮。
```

测试人员应启动或复用项目 HTTP 服务并独立检查：

1. 顶层端点未改参数，只改名称后保存，再打开仍没有具体参数生效。
2. 子端点能在继承 0.7、自己设置 0.3、由模型决定之间切换。
3. 会话参数能沿用端点、自己设置和阻止端点值。
4. 切走“自己设置”再切回时，未保存输入仍在。
5. 页面 `console.error`、pageerror 和失败网络请求均为 0；不向真实模型发送付费请求。

- [ ] **Step 7: 逐行检查最终 diff**

Run:

```bash
git diff --check HEAD
git status --short
```

Expected: 无空白错误；改动只包含本功能已有工作区内容、本计划实施内容和构建产物。

---

## 用户验收后的收尾（现在不执行）

用户明确说“验收通过”或“任务完成”后，按项目流程执行：

1. 把 `docs/other/todo.txt` 中大功能 9 的参数未完成项标记完成。
2. 同步 `docs/modules/params-registry.md`、`docs/modules/ui.md`、`docs/design/data-model.md`、`docs/modules/api.md`、`docs/design/css-architecture.md` 及实际修改文件对应文档；追加 2026-08-14 决策日志并更新 `last_updated`。
3. 运行 `python3 scripts/check-docs-format.py`。
4. 按语义化版本规则更新 `src/layout.html` 中版本号并运行 `node build.js`。
5. 再次运行完整测试、静态检查和真实页面冒烟测试。
6. 提交 Git；提交消息包含大功能 9 参数完成摘要和规定的 Co-Authored-By 行。
