# 进度日志

## 2026-07-21

- 完成 brainstorming：确定方案 A（弹窗复用 renderParamControls + session override 存会话对象）
- spec 已写并提交
- 开始实现

### 实现步骤

1. 提取 `renderParamControls` 为独立全局函数
2. 新增 dialog 模板 HTML
3. 实现弹窗逻辑
4. 修改 click handler
5. 插入 session override 到 API 调用
6. 样式

## 2026-07-22

### Bug 修复：TTS 端点忽略会话级 voice/instruction 覆盖

**问题**：`main.js` TTS handler 直接读 `info.node.voice` / `info.node.instruction`（原始树节点），跳过了会话参数覆盖（`currentSession.modelParams[id]`）。

**修复**：
1. 在 `main.js` TTS handler 段新增参数覆盖读取（与生图端点模式一致）
2. 从 `cfg.params.voice` / `cfg.params.instruction` 取值（包含树默认值 + 会话覆盖）

**验证**：
- ✅ `node build.js` 通过
- ✅ `git diff` 仅 2 处改动（+11/-1）

### 增强：TTS 播放器移到 .say 内部

**问题**：TTS 返回后 `.say` 显示"(无内容)"，播放器在独立 `.audio-result` div 中，二者分离。

**改动**：
- `main.js:updateCardAsAudio` — 把 `<audio>` 从 `.content > .audio-result` 移到 `.say` 内部
- `messages.js` — 从 session 恢复时同样把 `<audio>` 放入 `.say`

**效果**：播放器取代 "(无内容)" 占位文本，直接显示在 `.say` 区域。`audio` 的 controls 提供播放/暂停/进度条。
