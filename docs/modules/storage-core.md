---
name: 存储层核心 — storage-core.js
description: BrowserStorage / DirectoryStorage 双后端设计，统一 storage 接口，扩展版独立实现
type: architecture
---

# 存储层核心

## 设计意图

应用需要同时支持两种持久化模式：

1. **浏览器存储（BrowserStorage）**：零配置，数据保存在 IndexedDB，适合快速试用
2. **目录存储（DirectoryStorage）**：用户选择本地目录，数据存为可读 JSON 文件（`endpoints.json` + `sessions/<uuid>.json`），适合看重数据可移植性的用户

双后端通过统一的 `storage` 对象切换，业务代码不感知后端差异。模式偏好（`__mode` key）持久化在 IndexedDB（标准页）或 `chrome.storage.local`（扩展页），应用启动时恢复。

## 架构总览

```
                    storage 对象（统一接口）
                   /                      \
          BrowserStorage               DirectoryStorage
               |                             |
          IndexedDB                    File System Access API
     (kuai-lian-ai-browser)          (用户选择的目录)
               |
    扩展版: chrome.storage.local      目录句柄持久化在 IndexedDB
    作为一级存储                          (endpoint-manager DB)
```

- 非扩展环境：`storage` 在 `modules/storage-core.js` 内定义，内联 `BrowserStorage` 和 `DirectoryStorage`
- 扩展环境：`storage` 加载自 `extension/storage-core.js` 导出的 `window.__STORAGE__`（见 build.js 的扩展构建路径）

## 函数索引

### storage 统一接口

| 方法 | 功能 | 路由 |
|------|------|------|
| `init()` | 恢复上次模式；无历史记录时返回 `needUserAction: true` | 读取 `__mode` 偏好，目录模式优先尝试 `restoreHandle` |
| `selectMode(mode, handle?)` | 选择模式（用户首次选择） | 目录模式则 `pickAndSave` 或接受外部 handle |
| `switchMode(target, handle?)` | 切换模式并迁移数据 | `exportAll` -> 选目标 -> `importAll`，失败回滚 |
| `loadEndpoints()` | 加载端点配置 | -> `getBackend().loadEndpoints()` |
| `saveEndpoints(data)` | 保存端点配置 | -> `getBackend().saveEndpoints(data)` |
| `loadSessions()` | 加载会话列表 | -> `getBackend().loadSessions()` |
| `loadSession(id)` | 加载单会话 | -> `getBackend().loadSession(id)` |
| `saveSession(session)` | 保存单会话 | -> `getBackend().saveSession(session)` |
| `deleteSession(id)` | 删除单会话 | -> `getBackend().deleteSession(id)` |
| `loadSettings()` | 加载设置 | -> `getBackend().loadSettings()` |
| `saveSettings(s)` | 保存设置 | -> `getBackend().saveSettings(s)` |
| `clearAll()` | 清除所有数据 | -> `getBackend().clearAll()` |
| `exportAll()` | 导出全部（迁移用） | -> `getBackend().exportAll()` |
| `importAll(data)` | 导入全部（迁移用） | -> `getBackend().importAll(data)` |
| `hasSavedHandle()` | 检查是否存有目录句柄 | 查询 `endpoint-manager` IndexedDB |
| `restoreDirectory()` | 尝试恢复目录句柄 | -> `DirectoryStorage.restoreHandle()` |
| `getDirectoryName()` | 目录模式：返回目录名 | -> `DirectoryStorage.getDirectoryName()` |
| `getDisplayInfo()` | 返回 UI 展示信息 | 目录/浏览器分别构造 text + title |

### BrowserStorage

| 方法 | 实现 |
|------|------|
| `_getDB()` | 懒初始化 `kuai-lian-ai-browser` IndexedDB，含 store objectStore |
| `_get(key)` | 非扩展：IndexedDB.get；扩展：`chrome.storage.local.get` |
| `_set(key, value)` | 同上，IndexedDB.put / chrome.storage.local.set |
| `_delete(key)` | 同上，IndexedDB.delete / chrome.storage.local.remove |
| `_getAll()` | 扩展版独有，遍历所有 key |
| `loadEndpoints / saveEndpoints` | 单 key 'endpoints' |
| `loadSessions / loadSession / saveSession / deleteSession` | 单 key 'sessions'（JSON 对象，以 session.id 为键） |
| `exportAll / importAll / clearAll` | 批量操作 |

### DirectoryStorage

| 方法 | 实现 |
|------|------|
| `_requireDir()` | 扩展版独有，断言目录已选 |
| `loadEndpoints()` | 读 `endpoints.json`，不存在则返回空 |
| `saveEndpoints(data)` | 写 `endpoints.json`（JSON.stringify + 缩进） |
| `loadSessions()` | 遍历 `sessions/` 目录下所有 `.json` 文件 |
| `loadSession(id)` | 读 `sessions/{id}.json` |
| `saveSession(session)` | 写 `sessions/{id}.json` |
| `deleteSession(id)` | 删 `sessions/{id}.json` |
| `loadSettings / saveSettings` | 目录模式暂不持久化设置 |
| `exportAll()` | 组合端点和所有会话 |
| `importAll(data)` | 写端点和逐个写会话 |
| `clearAll()` | 删 `endpoints.json` + `sessions/` 目录 |
| `restoreHandle()` | 从 IndexedDB 恢复目录句柄 + 检测/请求权限 |
| `pickAndSave()` | 调用 `showDirectoryPicker` 并将句柄持久化 |
| `release()` | 清空句柄 |

### 目录句柄持久化

| 函数 | 用途 |
|------|------|
| `openHandleDB()` | 打开 `endpoint-manager` IndexedDB |
| `saveHandleToIndexedDB(handle)` | 保存 FileSystemDirectoryHandle |
| `loadHandleFromIndexedDB()` | 读取已保存句柄 |
| `clearHandleFromIndexedDB()` | 清除已保存句柄 |

## 双后端差异一览

| 维度 | BrowserStorage | DirectoryStorage |
|------|---------------|-----------------|
| 存储引擎 | IndexedDB（扩展版：`chrome.storage.local`） | File System Access API |
| 数据格式 | key-value（blob） | 可读 JSON 文本文件 |
| 会话存储 | 单 key 内嵌全部会话（JSON 对象） | 每会话独立文件 |
| 设置持久化 | 支持 | 暂不支持（返回空对象） |
| 数据可见性 | 浏览器内部，用户不可直接访问 | 用户可直接编辑 JSON |
| 权限模型 | 无额外权限 | 需用户选择目录 + 授予读写权限 |
| 句柄持久化 | N/A | 辅助 IndexedDB（`endpoint-manager`）保存句柄引用 |

## 扩展版独立实现的原因

`src/extension/storage-core.js` 是独立的完整副本（在 IIFE 中执行），而非引用 `modules/storage-core.js`。差异包括：

1. **`chrome.storage.local` 优先**：`_get/_set/_delete` 先判断 `isChromeExtension`，扩展环境下用 `chrome.storage.local` 代替 IndexedDB。因为 `chrome.storage.local` 在 Service Worker 中也可访问且支持后台同步。
2. **额外方法 `_getAll()`**：`chrome.storage.local.get(null)` 一次获取全部 key，IndexedDB 版用 `getAllKeys` + 逐个读实现等价功能。
3. **`_saveModePref()` 条件写入**：扩展版通过 `chrome.storage.local.set` 存模式偏好，标准版用 IndexedDB。
4. **`_requireDir()`**：扩展版 DirectoryStorage 有显式的目录检查守卫。
5. **`try-catch` 粒度更细**：扩展版在 `saveSession`/`deleteSession` 等操作中区分了 `NotFoundError` 和其他错误。
6. **`window.__IS_EXTENSION__` 和 `window.__STORAGE__`**：扩展版由 `boot.js` 在环境检测后挂载，非扩展版直接在全局作用域定义 `storage` 变量。

构建时 `build.js` 的扩展构建路径将 `extension/storage-core.js` 作为独立 `<script src>` 插入 HTML，并在 `boot.js` 之前加载，确保扩展页启动时 `window.__STORAGE__` 已就绪。

## 常量

| 常量 | 值 | 用途 |
|------|-----|------|
| `THINKING_TAGS` | `[{start:'<thinking>',end:'</thinking>'},{start:'<think>',end:'</think>'}]` | 用于识别和剥离模型回复中的思考过程标记（被 `store.js` 和 `api.js` 使用） |
| `DIRECTORY_DB` | `'endpoint-manager'` | 目录句柄持久化专用 IndexedDB 名称 |
| `HANDLE_STORE` | `'handles'` | 目录句柄持久化 objectStore 名称 |
| `storage.mode` | `'browser'` \| `'directory'` \| `null` | 当前活动模式 |

## 决策日志

| 决策 | 原因 |
|------|------|
| 不全局抛出未选择目录的错误 | 用户在 UI 中可见提示，启动时无需阻塞 |
| 目录句柄存 IndexedDB 而非 `chrome.storage` | FileSystemDirectoryHandle 是平台对象，需 IndexedDB 的结构化克隆算法支持序列化 |
| 设置不在目录模式持久化 | 设置（主题/布局）与 UI 强相关，放在目录中无意义；当前需求不要求跨机器同步设置 |
| 切换模式使用 exportAll + importAll 而非逐条迁移 | 数据量小（百级端点+会话），全量快照原子性更高，实现简单 |
| `migrateEndpoints` 不在 storage-core 中 | 数据格式迁移是业务逻辑，在 `store.js` 中处理；storage-core 只负责读写原始 JSON |
