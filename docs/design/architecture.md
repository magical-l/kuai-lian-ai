---
title: 技术架构
covers_file: [src/layout.html, src/style.css, src/modules/storage-core.js, src/modules/providers.js, src/modules/boot.js, src/modules/main.js]
depends_on: []
api_signature: window.__STORAGE__ / window.__IS_EXTENSION__ / window.__EXTENSION_FETCH__
last_updated: 2026-07-02
why_exists: 定义快连AI的技术选型、模块依赖关系和数据流向，作为所有代码改动的架构参照
---

## 设计意图

快连AI是一个零框架、纯原生JS的单页面应用，同时产出独立HTML和Chrome扩展两种产物。核心权衡点是"极致轻量 vs 功能完整"——零依赖意味着完全控制打包体积和渲染路径，但也意味着所有基础设施（存储抽象、模板系统、状态管理、路由）都需要手写。

技术选型的三条底线：(1) 不引入npm/package.json，构建仅依赖Node内置API；(2) 存储层同时支持本地目录和浏览器内置两种模式；(3) 单份源码通过构建脚本的双路径处理产出两种运行形态。

### 数据流向

```
用户操作（点击/输入）
    │
    ▼
main.js（事件处理入口）
    │
    ├─→ store.js（数据读写：端点树CRUD、会话管理）
    │      │
    │      └─→ storage-core.js（存储抽象层）
    │             ├─→ DirectoryStorage（File System Access API）
    │             └─→ BrowserStorage（IndexedDB / chrome.storage）
    │
    ├─→ api.js（API请求 + SSE流式处理）
    │      │
    │      └─→ 三种格式转换（toOpenAIContent / toClaudeContent / toGeminiContent）
    │
    └─→ endpoint-tree.js + messages.js + session-list.js（UI渲染）
           │
           └─→ providers.js（DOM辅助：$ / $$ / mk / fromTemplate / setValues）
```

各层对应的模块文档：[存储层](../modules/storage-core.md) · [数据管理](../modules/store.md) · [API 层](../modules/api.md) · [Provider 格式](../modules/providers.md) · [UI 组件](../modules/ui.md) · [端点树](../modules/endpoint-tree.md) · [主逻辑](../modules/main.md)

### 模块依赖关系链

严格的线性依赖，无循环引用。顺序由 build.js 中的 MODULE_ORDER 数组定义：

```
storage-core.js  ──→  providers.js  ──→  ui-utils.js  ──→  selected-endpoints.js
     │
     ▼
endpoint-tree.js  ──→  messages.js  ──→  session-list.js  ──→  attachments.js
     │
     ▼
store.js  ──→  api.js  ──→  shared.js  ──→  main.js
```

storage-core 是最底层，不依赖任何其他模块；main.js 是最顶层，依赖所有下层模块。

### 双产物架构

| 维度 | 单页面 HTML | Chrome 扩展 |
|------|------------|-------------|
| 产物路径 | dist/kuai-lian-ai.html | dist/extension/ |
| JS 形态 | 全部内联到 HTML（含 vendor） | 拆分为 boot.js + storage-core.js + cors-proxy.js + app.js 四个文件 |
| CSS 内联 | style.css + highlight.css 内联 | 同上 |
| 远程 CSS | 构建时 fetch 后内联（common.css + layout.css） | 同上 |
| vendor 处理 | 全部内联到 HTML | 复制到 extension/vendor/ |
| CORS 代理 | 无（受浏览器同源策略限制） | background.js Service Worker 转发 |
| SVG 图标 | base64 data URI 内联 | 保留外部引用 |
| 首次加载 | 无存储模式，弹出选择 | chrome.storage 默认 |

### CSS 变量体系

在 :root 中声明的 Design Tokens 覆盖全部组件：

- **背景层**：--bg-base, --bg-subtle, --bg-muted, --bg-elevated, --bg-hover, --bg-active
- **边框**：--border-subtle, --border-default, --border-strong
- **文字**：--text-primary, --text-secondary, --text-muted, --text-placeholder
- **强调色**：--accent-primary, --accent-primary-hover, --accent-light, --accent-muted
- **功能色**：--success, --success-light, --danger, --danger-light, --warning, --warning-light
- **尺寸**：--radius-{sm,md,lg,xl}, --space-{1..8}, --shadow-{sm,md,lg,xl}
- **字体**：--font-sans（Plus Jakarta Sans + fallback）
- **交互**：--transition-fast(120ms), --transition-normal(180ms)
- **按钮**：--btn-h(24px)

CSS 变量驱动模式（CLAUDE.md 中的约定）：基类按钮声明 --hover-bg / --hover-color，变体只设变量值，不重复写行为规则。

### 环境检测

环境检测（`__IS_EXTENSION__` / `__EXTENSION_FETCH__` / Google Fonts 按环境注入/跳过）在 `boot.js` 中实现，详见 [`docs/extension/overview.md`](../extension/overview.md) 的与单页面版本配合部分。

## 函数索引

| 函数 | 所在文件 | 功能 | 可见性 | 备注 |
|------|----------|------|--------|------|
| init | src/modules/main.js | 应用初始化入口 | 全局 | 绑定事件、恢复存储、渲染UI |
| tryRestoreDirectory | src/modules/store.js | 恢复上次存储模式 | 全局 | 含数据迁移 |
| getBackend | src/modules/storage-core.js | 路由到当前存储后端 | 内部 | 目录模式→DirectoryStorage，其他→BrowserStorage |
| buildSinglePage | build.js | 构建单页HTML产物 | 内部 | 内联CSS/JS/vendor |
| buildExtension | build.js | 构建扩展HTML产物 | 内部 | 拆分外部JS文件 |
| detectModelType | src/modules/store.js | 从模型名自动推断类型 | 全局 | 返回 chat/embedding/rerank |

## 决策日志

- 2026-07-01: 初始文档创建
