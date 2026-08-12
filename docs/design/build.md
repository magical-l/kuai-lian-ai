---
title: 构建流程
covers_file: [build.js, src/layout.html, src/extension/manifest.json]
depends_on: [architecture.md, data-model.md]
api_signature: node build.js / MODULE_ORDER / DEV_MODE
last_updated: 2026-08-12
why_exists: 定义从源码到双产物的构建流程，确保构建可复现、产物可预测
---

## 设计意图

构建脚本 build.js 是一个单文件 Node.js 脚本，使用 fs/path/child_process 内置模块，零外部依赖。输入为 src/ 目录下的源码文件，输出为 dist/ 下的单页面 HTML 和 Chrome 扩展两个产物。

### 构建流程

#### 第1步：读取 layout.html 模板

layout.html 包含三个占位符系统和外部引用：
- `{CSS}`——style.css 的内联位置（实际通过 `<link href="style.css">` 标签定位）
- `{BOOT}`——boot.js 的加载位置
- `{APP}`——所有模块的加载位置

构建脚本通过正则匹配 `<link>` 和 `<script>` 标签来定位和替换引用，而非文本占位符。

#### 第2步：CSS 处理

1. **style.css**：读取 → validateCSS（花括号平衡 + 声明校验） → compressCSS（去空行、trim） → 内联为 `<style>`
2. **highlight-github.min.css**：同上（vendor 目录）
3. **common.css / layout.css**（远程CSS）：
   - 开发模式（`--dev` 参数）：优先读取本地 `../css/css/common.css` / `layout.css`
   - 单页面构建：从 `css.document.cool` 构建时 fetch 内联（确保单页不依赖外网）
   - 扩展构建：保留 `<link>` 外链，运行时从 `css.document.cool` 加载
   - fetch 失败：保留外部 `<link>` 引用（仅单页面模式有 fallback）

#### 第3步：JS 处理

**单页面产物**：
- 所有 modules/*.js 按 MODULE_ORDER 依次读取 → compressJS（去空行） → 内联为 `<script>`
- vendor/marked.min.js 和 vendor/highlight.min.js 全文内联
- boot.js 内联到 HTML 头部 `<script src="modules/boot.js">` 位置

**扩展产物**：
- boot.js 单独写入 extension/boot.js（原样内联压缩版）
- modules 全部拼接为 extension/app.js
- storage-core.js 和 cors-proxy.js 作为独立文件从 extension 版 storage-core.js 复制
- vendor 文件复制到 extension/vendor/ 目录

#### 第4步：SVG 处理

logo.svg 转为 base64 data URI 内联（单页产物独立分发需要）。

#### 第5步：扩展打包

使用 PowerShell 的 Compress-Archive 将 extension/ 目录打包为 dist/kuai-lian-ai.zip。

### 双产物差异对比

| 维度 | 单页面 HTML | Chrome 扩展 |
|------|------------|-------------|
| 输出路径 | dist/kuai-lian-ai.html + 根目录副本 | dist/extension/ 目录 + dist/kuai-lian-ai.zip |
| vendor JS | 全部内联 | 复制为独立文件 |
| vendor CSS (highlight) | 内联 | 内联 |
| remote CSS | 构建时 fetch 内联 | `<link>` 外链，运行时加载 |
| boot.js | 头部内联 | extension/boot.js 外部引用 |
| modules | 全部内联到 HTML | 拼接为 extension/app.js |
| storage-core.js | 全部内联 | 独立文件 storage-core.js |
| cors-proxy.js | 无（未引入） | 独立文件 cors-proxy.js |
| 图标 | base64 data URI | 保留外部引用 |
| CORS 支持 | 无（浏览器限制） | background.js Service Worker |
| CSP | 无限制 | extension_pages 有 strict CSP |

### MODULE_ORDER

模块加载顺序（由 build.js 第16-29行定义）：

1. storage-core.js — 存储抽象
2. providers.js — Provider/API 格式与 DOM 辅助
3. params-registry.js — 按端点 type/style 提供参数定义
4. ui-utils.js — 通用 UI 工具
5. selected-endpoints.js — 选中端点管理
6. endpoint-tree.js — 端点树渲染
7. messages.js — 消息渲染
8. session-list.js — 会话列表渲染
9. attachments.js — 附件管理
10. store.js — 数据/状态管理
11. api.js — API 请求 + SSE
12. shared.js — 共享逻辑
13. main.js — 主入口

严格线性顺序，不可乱。每个文件依赖前序文件暴露的全局函数/变量。

### 版本管理

- 发布版本涉及三处：`src/extension/manifest.json` 的 `version` 字段、`src/layout.html` 中 `<span class="version">vX.Y.Z</span>`、构建后的根目录单页面 `kuai-lian-ai.html`
- 当前页面/构建文档版本：`6.32.12`
- 当前 manifest 已同步为 `6.32.12`；构建后需核对源码 manifest、扩展 manifest 与页面版本一致
- 每次正式发布验收后三处均需同步更新
- 版本号递增遵循语义化版本（MAJOR.MINOR.PATCH）

## 函数索引

| 函数 | 所在文件 | 功能 | 可见性 | 备注 |
|------|----------|------|--------|------|
| concatModules | build.js | 按 MODULE_ORDER 拼接所有模块 | 内部 | 用于扩展版 app.js |
| compressCSS | build.js | 去空行、trim 行 | 内部 | 不压缩声明（仅去除空白行） |
| validateCSS | build.js | CSS 花括号平衡 + 声明语法校验 | 内部 | 花括号/属性名/声明格式 |
| compressJS | build.js | 去空行 | 内部 | 不压缩变量名 |
| syncGetURL | build.js | 幂等 fetch（支持 Win32/Unix） | 内部 | 用于构建时内联远程CSS |
| tryInlineLocalCSS | build.js | 内联远程 CSS（common.css + layout.css） | 内部 | 开发模式优先本地 |
| buildSinglePage | build.js | 构建单页HTML | 内部 | 全部内联 |
| buildExtension | build.js | 构建扩展版HTML | 内部 | 拆分为外部JS |
| isSourceAsset | build.js | 判断是否为源码文件 | 内部 | modules/* 和 style.css |

## 决策日志

- 2026-07-01: 初始文档创建
- 2026-07-08: 接口风格按钮显示默认路径；修复 dialog 复用崩溃；修复继承显示名
- 2026-07-14: CSS 校验器兼容 `:has()` 选择器（selector 中的 `:` 误判为 property name）
- 2026-07-15: 筛选按钮 class 从 `endpoint-type.chat`/`embedding`/`image-generation`/`reranking` 改为 `chat`/`digits`/`palette`/`chart`，对齐 common.css 抽象图标

- 2026-07-18: 远程 CSS 域名从 `css.lwj621.workers.dev` 切换到 `css.document.cool`（路径从 `/css/name.css` 简化为 `/name.css`）
- 2026-07-28: 当时验收后将页面、扩展 manifest 和文档版本同步到 v6.32.4（历史记录）
- 2026-08-12: 同步 v6.32.11 的清空屏障、端点回滚防御和存储审查修复产物；根单页与 dist 单页构建后保持一致
- 2026-08-12: 验收 workspace 参数生命周期修复并发布 v6.32.12；页面、扩展 manifest 与构建产物版本一致
