# 会话隔离的生成状态管理 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将全局的 `activeGenerations` 改为按会话隔离的 `sessionGenerations`，使多个会话可以同时独立地进行模型回复生成。

**Architecture:** 使用两层 Map 结构 `Map<sessionId, Map<modelId, state>>`，每个会话有独立的模型状态子 Map。所有操作需指定 sessionId。

**Tech Stack:** 纯 JavaScript，无额外依赖

---

## 文件结构

**修改文件：**
- `kuai-lian-ai.html` — 所有代码在同一 HTML 文件中，需要修改多处

---

### Task 1: 替换数据结构定义

**Files:**
- Modify: `kuai-lian-ai.html:4859` — `activeGenerations` 定义位置

- [ ] **Step 1: 替换变量定义**

找到（约第 4859 行）：
```js
let activeGenerations = new Map(); // 生成中状态跟踪
```

替换为：
```js
let sessionGenerations = new Map(); // 按会话隔离的生成状态：Map<sessionId, Map<modelId, state>>
```

- [ ] **Step 2: Commit**

```bash
git add kuai-lian-ai.html
git commit -m "refactor: 重命名 activeGenerations 为 sessionGenerations（准备按会话隔离）"
```

---

### Task 2: 创建辅助函数

**Files:**
- Modify: `kuai-lian-ai.html` — 在 `stopSingleGeneration` 函数附近添加辅助函数

- [ ] **Step 1: 添加辅助函数**

在 `stopSingleGeneration` 函数之前（约第 4494 行附近）添加：
```js
// 获取指定会话的生成状态Map
function getSessionGenerations(sessionId) {
  if (!sessionGenerations.has(sessionId)) {
    sessionGenerations.set(sessionId, new Map());
  }
  return sessionGenerations.get(sessionId);
}

// 清除指定会话的所有生成状态
function clearSessionGenerations(sessionId) {
  const gens = sessionGenerations.get(sessionId);
  if (gens) {
    gens.forEach(state => {
      if (state.abortController && state.status === 'generating') {
        state.abortController.abort();
      }
    });
    gens.clear();
  }
}

// 删除指定会话的生成状态Map
function deleteSessionGenerations(sessionId) {
  clearSessionGenerations(sessionId);
  sessionGenerations.delete(sessionId);
}
```

- [ ] **Step 2: Commit**

```bash
git add kuai-lian-ai.html
git commit -m "feat: 添加会话隔离的辅助函数 getSessionGenerations/clearSessionGenerations/deleteSessionGenerations"
```

---

### Task 3: 改造 callAllModels 函数

**Files:**
- Modify: `kuai-lian-ai.html:4726-4858` — `callAllModels` 函数

- [ ] **Step 1: 修改函数签名和初始化逻辑**

找到函数开头（约第 4726 行）：
```js
async function callAllModels(groups, modelIds, messages, onChunk, sessionId) {
  const startTime = Date.now();
  activeGenerations.clear();

  // 初始化每个模型的状态和AbortController
  modelIds.forEach(id => {
    activeGenerations.set(id, {
```

替换为：
```js
async function callAllModels(groups, modelIds, messages, onChunk, sessionId) {
  const startTime = Date.now();

  // 清除当前会话的旧生成状态（不影响其他会话）
  clearSessionGenerations(sessionId);
  const gens = getSessionGenerations(sessionId);

  // 初始化每个模型的状态和AbortController
  modelIds.forEach(id => {
    gens.set(id, {
```

- [ ] **Step 2: 修改函数内部所有 activeGenerations 引用**

函数内所有 `activeGenerations` 替换为 `gens`（局部变量）：

约第 4747 行：
```js
const state = gens.get(id);
```

约第 4763 行：
```js
const genState = gens.get(id);
```

约第 4809 行：
```js
const genState = gens.get(id);
```

- [ ] **Step 3: Commit**

```bash
git add kuai-lian-ai.html
git commit -m "refactor: callAllModels 使用会话隔离的 sessionGenerations"
```

---

### Task 4: 改造 stopSingleGeneration 和 stopAllGenerations

**Files:**
- Modify: `kuai-lian-ai.html:4496-4510` — 停止生成相关函数

- [ ] **Step 1: 改造 stopSingleGeneration**

找到（约第 4496 行）：
```js
function stopSingleGeneration(modelId) {
  const state = activeGenerations.get(modelId);
  if (state && state.abortController) {
    state.abortController.abort();
  }
}
```

替换为：
```js
function stopSingleGeneration(sessionId, modelId) {
  const gens = sessionGenerations.get(sessionId);
  if (!gens) return;
  const state = gens.get(modelId);
  if (state && state.abortController && state.status === 'generating') {
    state.abortController.abort();
  }
}
```

- [ ] **Step 2: 改造 stopAllGenerations**

找到（约第 4504 行）：
```js
function stopAllGenerations() {
  activeGenerations.forEach((state, id) => {
    if (state.abortController && state.status === 'generating') {
      state.abortController.abort();
    }
  });
}
```

替换为：
```js
function stopSessionGenerations(sessionId) {
  clearSessionGenerations(sessionId);
}
```

保留原函数名兼容旧调用（可选，或直接改名）：
```js
// 兼容：停止当前会话的所有生成
function stopAllGenerations() {
  if (currentSession) {
    stopSessionGenerations(currentSession.id);
  }
}
```

- [ ] **Step 3: Commit**

```bash
git add kuai-lian-ai.html
git commit -m "refactor: stopSingleGeneration/stopAllGenerations 改为按会话隔离"
```

---

### Task 5: 改造 refreshUI 的 isGenerating 检查

**Files:**
- Modify: `kuai-lian-ai.html:5020-5040` — refreshUI 函数

- [ ] **Step 1: 修改 isGenerating 逻辑**

找到（约第 5023 行）：
```js
const isGenerating = currentSession && activeGenerations.size > 0 &&
    Array.from(activeGenerations.values()).some(s => s.sessionId === currentSession.id && s.status === 'generating');
```

替换为：
```js
const gens = currentSession ? sessionGenerations.get(currentSession.id) : null;
const isGenerating = gens && gens.size > 0 &&
    Array.from(gens.values()).some(s => s.status === 'generating');
```

- [ ] **Step 2: Commit**

```bash
git add kuai-lian-ai.html
git commit -m "refactor: refreshUI 使用会话隔离检查 isGenerating"
```

---

### Task 6: 改造 handleSessionSelect 恢复逻辑

**Files:**
- Modify: `kuai-lian-ai.html:5063-5085` — handleSessionSelect 函数

- [ ] **Step 1: 修改恢复逻辑**

找到检查和恢复逻辑（约第 5064 行）：
```js
const sessionModels = Array.from(activeGenerations.entries())
    .filter(([id, state]) => state.sessionId === sessionId);
```

替换为：
```js
const gens = sessionGenerations.get(sessionId);
const sessionModels = gens ? Array.from(gens.entries()) : [];
```

后续代码中 `generatingModels`、`completedModels` 等的筛选逻辑保持不变，因为 `sessionModels` 已是正确来源。

同时删除 state 中的 `sessionId` 属性检查（不再需要，因为 Map 本身已按会话隔离）。

- [ ] **Step 2: Commit**

```bash
git add kuai-lian-ai.html
git commit -m "refactor: handleSessionSelect 直接从 sessionGenerations 取会话状态"
```

---

### Task 7: 改造 handleSend 和其他调用点

**Files:**
- Modify: `kuai-lian-ai.html` — 多处调用点

- [ ] **Step 1: 确认 callAllModels 调用已传入 sessionId**

检查 handleSend 中（约第 5214 行）的调用：
```js
const responses = await callAllModels(groups, selectedModels, messages, onChunk, targetSessionId);
```

确认 `targetSessionId` 参数已正确传入（之前修改已添加）。

- [ ] **Step 2: 修改停止按钮调用**

找到停止按钮的 onclick（约第 5259 行和 elsewhere）：
```js
stopBtn.onclick = () => {
  stopAllGenerations();
  ...
};
```

确认 `stopAllGenerations()` 已改为使用 `currentSession.id`（Task 4 的兼容版本已处理）。

- [ ] **Step 3: Commit**

```bash
git add kuai-lian-ai.html
git commit -m "refactor: 确认所有调用点使用会话隔离参数"
```

---

### Task 8: 改造 handleSessionDelete

**Files:**
- Modify: `kuai-lian-ai.html` — handleSessionDelete 函数

- [ ] **Step 1: 添加会话状态清理**

找到 handleSessionDelete（约第 5090 行附近），确保删除会话时清理生成状态：
```js
async function handleSessionDelete(sessionId) {
  // 停止并删除该会话的生成状态
  deleteSessionGenerations(sessionId);
  await deleteSession(sessionId);
  if (currentSession?.id === sessionId) {
    currentSession = null;
  }
  await refreshUI();
}
```

- [ ] **Step 2: Commit**

```bash
git add kuai-lian-ai.html
git commit -m "refactor: handleSessionDelete 清理会话生成状态"
```

---

### Task 9: 移除 state 中不再需要的 sessionId 属性

**Files:**
- Modify: `kuai-lian-ai.html` — callAllModels 中的 state 初始化

- [ ] **Step 1: 移除 sessionId 属性**

找到 state 初始化（约第 4732 行）：
```js
gens.set(id, {
  sessionId,  // 删除这一行
  abortController: new AbortController(),
  ...
});
```

- [ ] **Step 2: Commit**

```bash
git add kuai-lian-ai.html
git commit -m "refactor: 移除 state 中冗余的 sessionId 属性"
```

---

### Task 10: 改造其他 activeGenerations 引用

**Files:**
- Modify: `kuai-lian-ai.html:2606, 2641, 2656-2670, 5516-5538` — 其他引用点

- [ ] **Step 1: 改造 renderModelSelector 中的引用（约第 2606、2641、2656-2670 行）**

这些位置涉及模型选择器的状态显示，需要传入当前会话 ID：

找到类似：
```js
const genState = activeGenerations.get(id);
```

替换为：
```js
const gens = currentSession ? sessionGenerations.get(currentSession.id) : null;
const genState = gens ? gens.get(id) : null;
```

多处类似，逐一修改。

- [ ] **Step 2: 改造 reorderCardsBySpeed 和 reorderSelectorTagsBySpeed（约第 5516-5538 行）**

找到：
```js
const stateA = activeGenerations.get(a.dataset.modelId);
```

替换为：
```js
const gens = currentSession ? sessionGenerations.get(currentSession.id) : null;
const stateA = gens ? gens.get(a.dataset.modelId) : null;
```

类似处理 stateB。

- [ ] **Step 3: Commit**

```bash
git add kuai-lian-ai.html
git commit -m "refactor: 所有 activeGenerations 引用改为 sessionGenerations"
```

---

### Task 11: 最终验证和版本更新

**Files:**
- Modify: `kuai-lian-ai.html` — 版本号

- [ ] **Step 1: 更新版本号**

```html
<span class="brand">快连AI</span><span class="version">v1.20.0</span>
```

- [ ] **Step 2: 确认无遗漏的 activeGenerations 引用**

搜索确认：
```bash
grep -n "activeGenerations" kuai-lian-ai.html
```

预期：无结果（已全部替换为 sessionGenerations）

- [ ] **Step 3: Commit**

```bash
git add kuai-lian-ai.html
git commit -m "release: v1.20.0 会话隔离的生成状态管理"
```

---

## 自检清单

1. **Spec 覆盖：**
   - 数据结构替换 → Task 1
   - 辅助函数 → Task 2
   - callAllModels 改造 → Task 3
   - stop 函数改造 → Task 4
   - refreshUI 改造 → Task 5
   - handleSessionSelect 改造 → Task 6
   - handleSend/调用点 → Task 7
   - handleSessionDelete → Task 8
   - 移除冗余 sessionId 属性 → Task 9
   - 其他引用点 → Task 10
   - 版本更新 → Task 11

2. **Placeholder 检查：** 无 TBD/TODO，所有代码具体

3. **类型一致性：** sessionGenerations 为 `Map<sessionId, Map<modelId, state>>`，辅助函数签名一致