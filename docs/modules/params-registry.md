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

`PARAMS_REGISTRY` 采用两层结构：`type → style → paramDef[]`。`common` 表示该 type 下所有 style 都有的通用参数。
渲染时合并 `common` + style 专属参数。

## 参数注册机制

每种模型类型的参数注册在 `PARAMS_REGISTRY` 对象中：

- `chat.common` — temperature、top_p、max_tokens（所有 chat 模型通用）
- `chat.openai` — presence_penalty、frequency_penalty、seed（OpenAI 特色）
- `chat.claude` — top_k、stop_sequences（Claude 特色）
- `chat.gemini` — top_k、stop_sequences、max_output_tokens（Gemini 特色）
- `image-generation.common` — size、quality、n
- `reranking.common` — top_n
- `embedding` — 暂未注册参数
- `tts` — 已有独立字段（voice/instruction），不在注册表重复

数据流向：注册表 → `renderParamControls()` → 用户设定值 → `endpoint.params` → `mergeParams()` → 请求 body。

## 函数索引

| 函数 | 所在文件 | 功能 | 可见性 | 备注 |
|------|----------|------|--------|------|
| `getParamDefs(type, style)` | `params-registry.js` | 根据 type + style 返回参数定义数组 | 全局 | 合并 common + style 专属的 concat 结果 |

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
