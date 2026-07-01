# 快连AI 项目概要

浏览器端大模型端点管理+多模型对话工具，纯原生 JS 单页面应用及 Chrome 扩展。

- **技术栈**：纯原生 JS，零框架，无 npm/package.json，无构建工具依赖
- **API 格式**：OpenAI / Claude / Gemini
- **不可修改**：`vendor/` 目录（第三方代码，由包管理器管理）

## 产物形态

| 形态 | 位置 | 用途 |
|------|------|------|
| 源码版 | `src/layout.html` | 开发/调试，直接打开即可 |
| 单页面 HTML | `dist/kuai-lian-ai.html` | 分发部署（`node build.js` 生成） |
| Chrome 扩展 | `dist/extension/` | 浏览器扩展（`node build.js` 生成，含 zip 包） |

## 知识索引

从入口文档开始，遇到不理解的引用时点链接深入。

| 想了解 | 去读 |
|--------|------|
| 源码目录结构、模块职责 | [`docs/index.md`](docs/index.md) |
| 技术选型、数据流向、模块依赖 | [`docs/design/architecture.md`](docs/design/architecture.md) |
| 数据模型（端点树、会话、存储模式） | [`docs/design/data-model.md`](docs/design/data-model.md) |
| 构建流程、双产物差异、版本管理 | [`docs/design/build.md`](docs/design/build.md) |
| CSS 体系 | [`docs/design/css-architecture.md`](docs/design/css-architecture.md) |
| Chrome 扩展架构（环境检测、CORS 代理） | [`docs/extension/overview.md`](docs/extension/overview.md) |

模块级文档（`docs/modules/`）从入口文档的引用链路中按需发现，无需单独索引。

## 文档层（自愈文档）

`docs/` 目录包含从源代码反向推导的自愈文档层。改代码前后的读/写规则：

### 改代码前
- 在 `docs/index.md` 找到受影响模块对应的文档
- 读对应文档的「设计意图」和「函数索引」，理解模块边界和设计约束
- dispatch 子代理做代码调研时，在 prompt 中注明「先去 docs/modules/xxx.md 读设计意图，再 grep 定位代码」

### 改代码后（文档同步）
每次改完代码后，必须更新本次改动涉及的所有文档：
1. 定位：通过 `covers_file` 元数据找到被改文件对应的文档
2. 更新函数功能描述：如果改动改变了函数的行为或签名
3. 追加决策日志：记录变更原因（性能/新需求/规范/重构等），按 `YYYY-MM-DD: 原因` 格式
4. 更新 `last_updated` 字段
5. 运行 `python3 scripts/check-docs-format.py` 验证格式正确性

**不追踪行号**——函数索引的定位由 AI 实时 grep 完成，无需维护。

### 自愈纠错
读文档时，如果发现内容与代码不符（函数描述过时、模块结构变化、`covers_file` 不完整等），**立即修正**。

- 主智能体自己读文档找到错误时：直接修
- dispatch 子代理时：在 prompt 末尾追加「如果发现你读的文档与代码不符，一并修正」

文档格式示例：
```yaml
---
title: 模块名
covers_file: [src/modules/xxx.js]    # 对应源文件
depends_on: []                         # 依赖的其他文档
api_signature: 对外接口                # 外部可见的函数/变量
last_updated: 2026-07-01
why_exists: 一句话说清设计目的
---

## 设计意图
（prose：这个模块解决什么问题、为什么这么设计、关键约束）

## 函数索引
| 函数 | 所在文件 | 功能 | 可见性 | 备注 |
|------|----------|------|--------|------|

## 决策日志
- 2026-07-01: 初始文档创建
```