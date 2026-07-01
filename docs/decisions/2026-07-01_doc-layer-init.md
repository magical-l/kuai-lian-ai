# 计划：为快连 AI 构建自愈文档层

## 一、设计目标

1. 一个 AI 原生文档层，填补 CLAUDE.md 和源代码之间的"设计意图"断层
2. 文档由 AI 初始化、由 AI 在改代码后自动同步（自愈）
3. 格式上找到"AI 可精确解析"与"人可流畅阅读"的边际收益最佳点
4. 后续每个新会话从 docs/index.md 入口加载，按需深入特定模块文档

## 二、文档目录结构（嵌套）

```
docs/
  index.md                 入口：项目目的、总体架构、模块索引、文档阅读路线
  design/
    architecture.md         技术选型、架构决策记录、数据流向
    data-model.md           端点树 / 会话 / 消息的数据结构定义
    build.md                构建流程、产物差异（单页 vs 扩展）
  modules/
    storage-core.md         存储层（storage-core.js + extension/storage-core.js）
    api.md                  API 通信层（api.js + shared.js）
    providers.md            Provider 格式抽象层（providers.js）
    ui.md                   UI 层概览（ui-utils.js + messages.js + 各渲染模块）
    endpoint-tree.md        端点树渲染与交互（endpoint-tree.js）
    store.md                数据管理（store.js）
    main.md                 主入口逻辑（main.js）
  extension/
    overview.md             Chrome 扩展概览
    cors-proxy.md           CORS 代理设计（background.js + cors-proxy.js）
  decisions/
    2026-07-01_doc-layer-init.md   本计划对应的初始化决策记录
```

**为什么这样划分而不是按源文件 1:1：** store.js 和 storage-core.js 功能高度关联（一个数据管理、一个存储后端），合为 storage.md 更清晰。extension/storage-core.js 是独立实现，单独说明但和 modules/storage-core.md 交叉引用。最空的模块（session-list.js ~61 行）不自立文档，合并入 ui.md。

## 三、文档信息格式（"混合"的边际甜点）

### 每份文档的结构

每个 `.md` 文件由三段组成：

```
--- YAML frontmatter ───
title:          标题
covers_file:    覆盖的源文件列表
depends_on:     依赖/关联的其他文档
api_signature:  对外暴露的接口（全局变量、事件、导出函数）
last_updated:   日期
why_exists:     这个模块存在的原因（一句话）
─── 正文 ───

### 设计意图（prose）
- 这个模块解决什么问题
- 为什么采用当前方案（备选方案的取舍）
- 关键约束条件

### 函数索引（structured table）
| 函数 | 行号 | 功能 | 内部/外部 | 备注 |
|------|------|------|-----------|------|
|      |      |      |            |      |

### 决策日志（reverse chronological）
- 2026-07-01: 初始文档创建
- （后续每次修改追加一条：改了哪、为什么改）
```

### 这样选的理由

- **YAML frontmatter**：AI 结构化解析入口，一眼知道"这文档对应哪些文件""
- **设计意图 prose**：边际收益最高的一段——代码里写不出来的"为什么"。人读着舒服，AI 也靠这个理解模块定位
- **函数索引 table**：AI 查函数时不用 grep 全文，表格里就能找到。人很少看但有用
- **决策日志**：自愈文档的关键机制。每次改代码后追加一条，形成"这个模块为什么变成今天这样"的可追溯记录

**不做的事：**
- 不把函数参数列表、返回值类型写进文档（代码本身就是最权威的签名来源）
- 不写代码块的复制品（杜绝文档与代码脱节）
- 不在文档里写具体的算法实现细节（除非算法本身是一个重要设计决策）

## 四、初始化流程（Workflow 脚本）

写一个 Workflow script 做以下事（后台跑，完成后通知）：

1. **创建目录骨架**：`docs/` 及子目录
2. **按 template 写入口文档** `docs/index.md`
3. **按 template 写各个模块文档**（共约 10 份）
4. **写第一份决策日志** `docs/decisions/2026-07-01_doc-layer-init.md`

每份文档用 Read 读对应源文件后生成，确保函数行号和当前代码一致。

预计执行时间：2-3 分钟（10 个文件，每个文件 Read + 生成 + Write）。

## 五、初始化后的维护契约

文档生成后，后续每次代码修改的 Workflow 增加一个 stage：

```
[改代码] → [doc sync] → [verify]
```

doc sync stage 做的事：
1. 定位被改文件对应的 docs 文档
2. 更新函数索引表中的行号和签名
3. 在设计意图段末尾追加一条决策日志
4. 更新 YAML frontmatter 的 `last_updated`

## 六、执行前需要你确认的点

1. **文档目录结构**：上面的嵌套划分是否合理？有没有哪个模块不该独立成文 / 应该拆分？
2. **信息格式的"三段式"**：YAML + 设计意图 prose + 函数索引 table，这个结构你认同吗？
3. **Workflow script 先写给我审核，再执行**：还是说直接就跑了？
4. **初始化的文档是否包含"当前所有历史代码都还没有决策日志"的说明**：即每份文档初始只有一条决策日志"初始文档创建，基于代码反向推导"，不含用户真实决策记录——这个表达你是否接受？
