// src/modules/params-registry.js
// 模型参数注册表 — 定义每种 (type, style) 组合有哪些可配置参数

var PARAMS_REGISTRY = {
  chat: {
    common: [
      { key: "temperature",   label: "Temperature",    type: "range",   min: 0, max: 2,   step: 0.1, default: 1 },
      { key: "top_p",         label: "Top P",          type: "range",   min: 0, max: 1,   step: 0.1, default: 1 },
      { key: "max_tokens",    label: "Max Tokens",     type: "integer", min: 1,            default: 4096 },
    ],
    openai: [
      { key: "presence_penalty",  label: "Presence Penalty",  type: "range",   min: -2, max: 2, step: 0.1, default: 0 },
      { key: "frequency_penalty", label: "Frequency Penalty", type: "range",   min: -2, max: 2, step: 0.1, default: 0 },
      { key: "seed",              label: "Seed",              type: "integer", nullable: true },
    ],
    claude: [
      { key: "top_k",          label: "Top K",          type: "integer", min: 1, max: 500 },
      { key: "stop_sequences", label: "Stop Sequences", type: "text",    placeholder: "逗号分隔多个" },
    ],
    gemini: [
      { key: "top_k",              label: "Top K",              type: "integer", min: 1, max: 500 },
      { key: "stop_sequences",     label: "Stop Sequences",     type: "text",    placeholder: "逗号分隔多个" },
      { key: "max_output_tokens",  label: "Max Output Tokens",  type: "integer", min: 1, default: 2048 },
    ],
  },
  embedding: {
    // 暂无参数注册
  },
  "image-generation": {
    common: [
      { key: "size",    label: "Size",    type: "select", options: ["1024x1024", "1792x1024", "1024x1792"], default: "1024x1024" },
      { key: "quality", label: "Quality", type: "select", options: ["standard", "hd"], default: "standard" },
      { key: "n",       label: "Count",   type: "integer", min: 1, max: 10, default: 1 },
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
