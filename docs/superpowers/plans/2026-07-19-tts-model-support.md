# TTS 语音合成模型支持 — 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 新增 `tts` 模型类型，支持 OpenAI `/v1/audio/speech` 格式的文本转语音

**Architecture:** 与 `image-generation` 完全一致的调用模式——非流式、二进制响应、结果以 `audioResult` 存入 assistant 消息、渲染 `<audio>` 播放器。只支持 OpenAI 格式（非 openai 报错）。不支持 voice/speed 参数。

**Tech Stack:** 纯原生 JS，零框架

## Global Constraints

- `detectModelType` 关键词匹配：tts/audio/speech/voice → `"tts"`
- TTS 只支持 OpenAI 格式，`buildTTSRequest` 只定义在 `providers.openai`
- 不传 voice/speed/response_format，全部用 API 默认值
- `audioResult` 字段格式：`{ audioData: base64, blobUrl: blob:, contentType, size }`
- 测试连接用 `testTTSConfig`（input 为 `"."`）
- `callTTS` 永远不走流式，120s 超时

---

### Task 1: 类型检测 — store.js detectModelType

**Files:**
- Modify: `src/modules/store.js:80-96`

**Interfaces:**
- Consumes: 无
- Produces: `detectModelType("tts-1")` → `"tts"`, `detectModelType("tts-1-hd")` → `"tts"`

- [ ] **Step 1: 在 `reranking` 分支后添加 TTS 检测**

读 `src/modules/store.js` 第 80-96 行，在 `reranking` 分支（第 90 行）和 `image` 分支（第 92 行）之间插入：

```js
if (lower.indexOf("tts") >= 0 || lower.indexOf("audio") >= 0 ||
    lower.indexOf("speech") >= 0 || lower.indexOf("voice") >= 0)
    return "tts";
```

- [ ] **Step 2: 验证**

在 `src/layout.html` 中打开 DevTools（或在调试模式），跑：
```js
detectModelType("tts-1");       // → "tts"
detectModelType("tts-1-hd");    // → "tts"
detectModelType("openai-audio"); // → "tts"
detectModelType("gpt-4o");      // → "chat"（不改已有行为）
```

---

### Task 2: Provider + API 层 — providers.js + shared.js

**Files:**
- Modify: `src/modules/providers.js` — 在 `providers.openai` 新增 `buildTTSRequest` 和 `testTTSConfig`
- Modify: `src/modules/shared.js` — 新增 `callTTS` 和 `base64ToBlob`

**Interfaces:**
- Consumes: `providers.openai` 对象（Task 1 的 provider 扩展）
- Produces: `callTTS(style, baseUrl, apiKey, model, input)` → `{ blobUrl, audioData, contentType, size }`

- [ ] **Step 1: providers.openai 新增 `buildTTSRequest`**

在 `providers.openai` 对象中找到 `buildImageRequest`（第 4 行），在其后添加：

```js
buildTTSRequest(baseUrl, apiKey, model, input) {
    baseUrl = baseUrl.replace(/\/+$/, '');
    return {
        url: baseUrl + '/v1/audio/speech',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': 'Bearer ' + apiKey
        },
        body: {
            model,
            input
        }
    };
},
```

- [ ] **Step 2: providers.openai 新增 `testTTSConfig`**

在 `buildTTSRequest` 后添加：

```js
testTTSConfig(baseUrl, apiKey, model) {
    return this.buildTTSRequest(baseUrl, apiKey, model, '.');
},
```

- [ ] **Step 3: shared.js 新增 `base64ToBlob`**

在 shared.js 中找到 `blobToBase64` 及其相邻工具函数，在其后（或邻近位置）添加：

```js
function base64ToBlob(b64, mimeType) {
    var byteChars = atob(b64);
    var byteArrays = [];
    for (var offset = 0; offset < byteChars.length; offset += 512) {
        var slice = byteChars.slice(offset, offset + 512);
        var byteNumbers = new Array(slice.length);
        for (var i = 0; i < slice.length; i++) {
            byteNumbers[i] = slice.charCodeAt(i);
        }
        byteArrays.push(new Uint8Array(byteNumbers));
    }
    return new Blob(byteArrays, { type: mimeType || 'audio/mpeg' });
}
```

- [ ] **Step 4: shared.js 新增 `callTTS`**

在 `callImageGeneration` 函数（约第 252 行）后添加：

```js
async function callTTS(style, baseUrl, apiKey, model, input) {
    var provider = providers[style];
    if (!provider) throw new Error('不支持的接口风格: ' + style);
    if (!provider.buildTTSRequest) throw new Error('该接口不支持语音生成');

    var req = provider.buildTTSRequest(baseUrl, apiKey, model, input);
    var res = await fetchWithTimeout(req.url, {
        method: 'POST',
        headers: req.headers,
        body: JSON.stringify(req.body)
    }, 120000);

    if (!res.ok) {
        var errText = await res.text().catch(function() { return ''; });
        throw new Error('TTS请求失败: ' + res.status + (errText ? ' - ' + errText : ''));
    }

    var ct = res.headers.get('content-type') || '';
    if (ct.includes('text/html')) {
        var body = await res.text().catch(function() { return ''; });
        var m = body.match(/<title>([^<]+)<\/title>/i);
        throw new Error('TTS请求失败: 返回了HTML — ' + (m ? m[1] : body.slice(0, 100)));
    }

    var blob = await res.blob();
    var audioData = await blobToBase64(blob);
    var blobUrl = URL.createObjectURL(blob);

    return { blobUrl: blobUrl, audioData: audioData, contentType: ct, size: blob.size };
}
```

- [ ] **Step 5: 验证**

构建验证：`node build.js`。确认无语法错误。

---

### Task 3: Send 分流 + 消息渲染 — main.js + messages.js

**Files:**
- Modify: `src/modules/main.js` — `handleSend` 中加 `ttsIds` 分流 + `updateCardAsAudio`
- Modify: `src/modules/messages.js` — `appendMessages` 中渲染 `audioResult`

**Interfaces:**
- Consumes: `callTTS` (Task 2), `resolveNodeConfig`, `findModelById`
- Produces: assistant 消息附带 `audioResult` 字段，包含 `<audio>` 播放器的卡片

- [ ] **Step 1: main.js handleSend 新增 ttsIds 分流**

在 `handleSend` 函数中，找到 `imgGenerateIds` 声明（约第 459 行），在其后加：

```js
const ttsIds = [];
```

在 `forEach` 分流中（约第 463 行 `imgGenerateIds.push(id)` 后）加：

```js
else if (cfg.type === 'tts') ttsIds.push(id);
```

- [ ] **Step 2: main.js handleSend 新增 ttsPromises**

在 `imgGeneratePromises`（约第 501 行）后，`chatPromise`（第 528 行）前，添加：

```js
const ttsPromises = ttsIds.map(async function(id) {
    var info = findModelById(groups, id);
    if (!info) {
        return { endpointId: id, status: 'failed', error: '端点不存在', content: '' };
    }
    try {
        var cfg = resolveNodeConfig(id);
        var input = '';
        for (var i = messages.length - 1; i >= 0; i--) {
            if (messages[i].role === 'user') {
                var c = messages[i].content;
                if (Array.isArray(c) && c.length > 0 && c[0].type === 'text') {
                    input = c[0].text || '';
                } else if (typeof c === 'string') {
                    input = c;
                }
                break;
            }
        }
        var result = await callTTS(cfg.style || 'openai', cfg.baseUrl, cfg.key,
            (info.node.modelId || info.node.name), input);
        updateCardAsAudio(id, result, targetSessionId);
        return {
            endpointId: id,
            status: 'completed',
            content: '',
            audioResult: {
                blobUrl: result.blobUrl,
                audioData: result.audioData,
                contentType: result.contentType,
                size: result.size
            }
        };
    } catch (err) {
        updateCardStatus(id, 'failed', err.message, null, targetSessionId);
        return { endpointId: id, status: 'failed', error: err.message, content: '' };
    }
});
```

- [ ] **Step 3: main.js handleSend 合并结果**

在 `Promise.all` 行（约第 540 行），把 `ttsPromises` 加入：

```js
const [embedResults, imgGenerateResults, ttsResults, chatResults] = await Promise.all([
    Promise.all(embedPromises),
    Promise.all(imgGeneratePromises),
    Promise.all(ttsPromises),
    chatPromise
]);

allResults.push(...embedResults, ...imgGenerateResults, ...ttsResults, ...chatResults);
```

- [ ] **Step 4: main.js 新增 updateCardAsAudio**

在 `updateCardAsImage`（约第 857 行）后添加：

```js
function updateCardAsAudio(endpointId, result, sessionId) {
    var card = $('.one.response.msg[data-session-id="' + sessionId + '"][data-endpoint-id="' + endpointId + '"]');
    if (!card) return;
    var sayEl = $('.say', card);
    if (sayEl) sayEl.textContent = '';
    var contentWrapper = $('.content', card);
    if (contentWrapper) {
        var existing = $('.audio-result', contentWrapper);
        if (existing) existing.remove();

        var audioDiv = mk('div', 'audio-result');
        if (result.blobUrl) {
            var audio = mk('audio', '');
            audio.src = result.blobUrl;
            audio.controls = true;
            audio.style.maxWidth = '100%';
            audio.style.height = '40px';
            audioDiv.addChild(audio);
        }
        contentWrapper.addChild(audioDiv);
    }
    updateCardStatus(endpointId, 'completed', null, null, sessionId);
}
```

- [ ] **Step 5: messages.js 渲染 audioResult**

在 `appendMessages` 函数中，找到 `imageResult` 分支（约第 419 行），在其后添加：

```js
// audio 结果（TTS 场景）
if (r.audioResult) {
    var audioMeta = $('.audio-result', existing);
    if (!audioMeta) {
        audioMeta = mk('div', 'audio-result');
        existing.addChild(audioMeta);
    }
    var hasPlayer = audioMeta.querySelector('audio');
    if (!hasPlayer && r.audioResult.audioData) {
        var blob = base64ToBlob(r.audioResult.audioData, 'audio/mpeg');
        var blobUrl = URL.createObjectURL(blob);
        var audio = mk('audio', '');
        audio.src = blobUrl;
        audio.controls = true;
        audio.style.maxWidth = '100%';
        audio.style.height = '40px';
        audioMeta.addChild(audio);
    }
}
```

- [ ] **Step 6: 验证**

构建：`node build.js`。在源码版打开，建一个 TTS 端点（如 modelId 为 `tts-1`），选中，输入文本，点发送，确认音频播放器出现并能播放。

---

### Task 4: UI 类型集成 — endpoint-tree.js + selected-endpoints.js + attachments.js + layout.html

**Files:**
- Modify: `src/modules/endpoint-tree.js` — 类型图标映射 + isNodeTestable
- Modify: `src/modules/selected-endpoints.js` — typeIconMap
- Modify: `src/modules/attachments.js` — 类型选择列表 + 测试路由
- Modify: `src/layout.html` — 筛选 checkbox + 编辑 radio

**Interfaces:**
- Consumes: 无（纯 UI 绑定）
- Produces: 端点上显示 🔊 图标、筛选器可切换 TTS、编辑弹窗可选 TTS 类型

- [ ] **Step 1: endpoint-tree.js 类型→图标映射**

第 209 行 `else if (type === 'reranking')` 后加：

```js
else if (type === 'tts') { typeEl.classList.add('speaker'); }
```

- [ ] **Step 2: endpoint-tree.js 图标→类型逆向**

约第 487 行 `else if (typeEl.classList.contains('chart'))` 后加：

```js
else if (typeEl.classList.contains('speaker')) type = 'tts';
```

- [ ] **Step 3: endpoint-tree.js isNodeTestable**

两处修改（约第 237 行和第 385 行），在 `cfg.type === "chat"` 条件后加 `|| cfg.type === "tts"`。

- [ ] **Step 4: selected-endpoints.js typeIconMap**

找到 `typeIconMap` 定义（约第 37 行），加：

```js
tts: 'speaker',
```

- [ ] **Step 5: attachments.js 类型选择列表**

在类型选择数组（约第 445 行）`reranking` 项后加：

```js
{ value: 'tts', icon: 'speaker', text: '语音' },
```

- [ ] **Step 6: attachments.js 测试路由**

约第 816 行，将：

```js
var testFn = (modelType === 'embedding' && provider.testEmbeddingConfig) ? provider.testEmbeddingConfig : provider.testConfig;
```

改为：

```js
var testFn = (modelType === 'embedding' && provider.testEmbeddingConfig) ? provider.testEmbeddingConfig :
             (modelType === 'tts' && provider.testTTSConfig) ? provider.testTTSConfig :
             provider.testConfig;
```

- [ ] **Step 7: layout.html 筛选 checkbox**

找到端点类型筛选区（约第 156 行），在 `reranking` 的 checkbox 后加：

```html
<input type="checkbox" value="tts" checked>
```

- [ ] **Step 8: layout.html 编辑 radio**

找到编辑弹窗 type radio 组（约第 501 行），在 `reranking` 的 radio 后加：

```html
<input type="radio" name="type" value="tts">
```

- [ ] **Step 9: 验证**

构建：`node build.js`。打开源码版，确认：
- 筛选区出现 TTS checkbox
- 编辑端点时 type 可选"语音"
- 端点树中 TTS 类型显示 🔊 图标

---

### Task 5: CSS — common.css 图标定义

**Files:**
- Modify: `d:\工作\css\css\common.css` — 字符变量 + 端类型类

- [ ] **Step 1: 新增 `--char-speaker` 变量**

在 common.css 的字符变量区（约第 384 行 `--char-chart` 附近）新增：

```css
--char-speaker: '🔊';  /* U+1F50A &#x1F50A; */
```

- [ ] **Step 2: 新增 `.speaker` 类**

在端类型类定义区（约第 473 行 `.chart` 附近）新增：

```css
.speaker { --icon-char: var(--char-speaker); }
```

- [ ] **Step 3: 验证**

构建：`node build.js --dev`（使用本地 common.css）。在源码版打开，确认 TTS 端点的类型图标显示为 🔊。

---

### Task 6: 文档 + 版本

**Files:**
- Modify: `src/layout.html` — 版本号
- Modify: `docs/other/superpowers/pecs/2026-07-19-tts-model-support-design.md` — 更新 `last_updated`

- [ ] **Step 1: 更新版本号**

在 `src/layout.html` 中找到 `<span class="version">v6.14.0</span>`，递增第三位 → `v6.14.1`。

- [ ] **Step 2: 确认设计文档已更新**

确认 `docs/other/superpowers/pecs/2026-07-19-tts-model-support-design.md` 的 `last_updated` 为当天日期。

- [ ] **Step 3: 构建最终产物**

```bash
node build.js
```

- [ ] **Step 4: git commit**

```bash
git add -A
git commit -m "feat: 新增 TTS 语音合成模型类型支持

- detectModelType 新增 tts/audio/speech/voice 关键词检测
- providers.openai 新增 buildTTSRequest / testTTSConfig
- shared.js 新增 callTTS / base64ToBlob
- main.js handleSend 新增 ttsIds 分流及 updateCardAsAudio
- messages.js 渲染 audioResult（<audio> 播放器）
- UI 类型系统：筛选/图标/编辑/测试全链路
- common.css 新增 --char-speaker 图标

Co-Authored-By: Claude <noreply@anthropic.com>"
```
