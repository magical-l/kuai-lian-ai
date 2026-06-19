const fs = require("fs");
const path = "d:/工作/快连ai/kuai-lian-ai.html";
let html = fs.readFileSync(path, "utf8");

// ===== Modification 1: HTML structure =====
const oldHtml = [
    '<div class="chat-input-area layout-y-queue">',
    '\t\t\t\t\t\t<div class="selector-bar">',
    '\t\t\t\t\t\t\t<div class="selector-summary layout-x-queue">',
    '\t\t\t\t\t\t\t\t<!-- 已选模型标签 -->',
    '\t\t\t\t\t\t\t</nav>',
    '\t\t\t\t\t\t</div>'
].join('\n');

const newHtml = [
    '<div class="chat-input-area layout-y-queue">',
    '\t\t\t\t\t\t<div class="selector-summary layout-x-queue">',
    '\t\t\t\t\t\t\t<!-- 已选模型标签 -->',
    '\t\t\t\t\t\t</nav>'
].join('\n');

html = html.replace(oldHtml, newHtml);

// ===== Modification 2: Inline CSS changes =====
// a) Delete .selector-bar rule
const ruleA = ".selector-bar {position: relative;width: 100%;background: var(--bg-muted);border-radius: var(--radius-md) var(--radius-md) 0 0;padding: var(--space-1) var(--space-2);border: 1px solid var(--border-subtle);border-bottom: none;max-height:30vh;overflow-y:auto;}";
html = html.replace(ruleA, "");

// b) Delete .selector-bar.generating .model.tag rule
const ruleB = ".selector-bar.generating .model.tag {cursor: not-allowed;opacity: 0.6;}";
html = html.replace(ruleB, "");

// c) Modify .selector-summary rule
const oldRuleC = ".selector-summary {align-items: center;gap: var(--space-1);flex-wrap: wrap;flex: 1;min-width: 0;overflow: hidden;}";
const newRuleC = ".selector-summary {background: var(--bg-muted);border-radius: var(--radius-md) var(--radius-md) 0 0;padding: var(--space-1) var(--space-2);border: 1px solid var(--border-subtle);border-bottom: none;width: 100%;align-items: center;gap: var(--space-1);flex-wrap: wrap;min-width: 0;overflow: hidden;}";
html = html.replace(oldRuleC, newRuleC);

// d) Add new rule after .selector-summary (before "/* 模型标签样式 */")
const insertAfterRuleC = ".selector-summary.generating .model.tag {cursor: not-allowed;opacity: 0.6;}";
html = html.replace(newRuleC, newRuleC + insertAfterRuleC);

// ===== Modification 3: JS code change =====
html = html.replace(
    'const container = $(".selector-bar");',
    'const container = $(".selector-summary");'
);

fs.writeFileSync(path, html, "utf8");
console.log("All three modifications applied successfully.");
