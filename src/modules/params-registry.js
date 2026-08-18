// src/modules/params-registry.js
// 模型参数注册表 — 定义每种 (type, style) 组合有哪些可配置参数

var PARAMS_REGISTRY = {
  chat: {
    common: [
      { key: "temperature",   label: "温度",          type: "range",   min: 0, max: 2,   step: 0.1, default: 1 },
      { key: "top_p",         label: "Top P（核采样）", type: "range",   min: 0, max: 1,   step: 0.1, default: 1 },
      { key: "max_tokens",    label: "最大 Token 数", type: "integer", min: 1,            default: 4096 },
    ],
    openai: [
      { key: "presence_penalty",  label: "话题新鲜度惩罚", type: "range",   min: -2, max: 2, step: 0.1, default: 0 },
      { key: "frequency_penalty", label: "频率惩罚",       type: "range",   min: -2, max: 2, step: 0.1, default: 0 },
      { key: "seed",              label: "随机种子",       type: "integer", nullable: true },
    ],
    claude: [
      { key: "top_k",          label: "Top K",          type: "integer", min: 1, max: 500 },
      { key: "stop_sequences", label: "停止序列",       type: "text",    placeholder: "逗号分隔多个" },
    ],
    gemini: [
      { key: "top_k",              label: "Top K",              type: "integer", min: 1, max: 500 },
      { key: "stop_sequences",     label: "停止序列",           type: "text",    placeholder: "逗号分隔多个" },
      { key: "max_output_tokens",  label: "最大输出 Token 数",  type: "integer", min: 1, default: 2048 },
    ],
    responses: [
      { key: "reasoning_effort", label: "思考强度", type: "select", options: ["low", "medium", "high"], default: "high" },
    ],
  },
  tts: {
    common: [
      { key: "voice",        label: "音色",  type: "text", placeholder: "如 alloy、cixingnansheng" },
      { key: "instruction",  label: "指令",  type: "text", placeholder: "如 语气温柔、活泼俏皮" },
      { key: "speed",        label: "语速",  type: "range", min: 0.25, max: 4.0, step: 0.1, default: 1.0 },
    ],
  },
  embedding: {
    // 暂无参数注册
  },
  "image-generation": {
    common: [
      { key: "size",    label: "图片尺寸", type: "select", options: ["1024x1024", "1792x1024", "1024x1792"], default: "1024x1024" },
      { key: "quality", label: "质量",    type: "select", options: ["standard", "hd"], default: "standard" },
      { key: "n",       label: "生成数量", type: "integer", min: 1, max: 10, default: 1 },
    ],
  },
  asr: {
    common: [
      { key: "language",       label: "语言代码", type: "text",    placeholder: "如 zh、en、ja（留空自动检测）" },
      { key: "prompt",         label: "提示文本", type: "text",    placeholder: "引导识别结果的提示词" },
      { key: "temperature",    label: "温度",     type: "range",   min: 0, max: 1,   step: 0.1, default: 0 },
      { key: "response_format",label: "响应格式", type: "select",  options: ["json", "verbose_json", "text"], default: "json" },
    ],
  },
  "video-generation": {
    common: [
      { key: "duration",   label: "时长（秒）", type: "integer", min: 1, max: 15, default: 5 },
      { key: "ratio",      label: "画面比例",   type: "select", options: ["16:9", "4:3", "1:1", "9:16", "3:4"], default: "16:9" },
      { key: "resolution", label: "分辨率",     type: "select", options: ["480p", "720p", "1080p"], default: "720p" },
    ],
  },
  reranking: {
    common: [
      { key: "top_n", label: "Top N", type: "integer", min: 1, default: 10 },
    ],
  },
};

function getParamDefs(type, style) {
  var entry = PARAMS_REGISTRY[type];
  if (!entry) return [];
  var defs = (entry.common || []).slice();
  if (style && entry[style]) {
    defs = defs.concat(entry[style]);
  }
  return defs;
}
