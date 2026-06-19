const fs = require('fs');

const filePath = 'd:\\工作\\快连ai\\kuai-lian-ai.html';
let html = fs.readFileSync(filePath, 'utf8');

// Track all changes
const changes = [];

// 1. HTML structure: remove <div class="selector-bar"> and its closing </div>
const htmlBefore = html;
html = html.replace(
  '<div class="selector-bar">\n\t\t\t\t\t\t<div class="selector-summary layout-x-queue">',
  '<div class="selector-summary layout-x-queue">'
);
const mod1a = html !== htmlBefore;
changes.push('Mod1: selector-bar open tag removed: ' + mod1a);

const htmlBefore2 = html;
html = html.replace(
  '\t\t\t\t\t\t\t</nav>\n\t\t\t\t\t\t</div>',
  '\t\t\t\t\t\t\t</nav>'
);
const mod1b = html !== htmlBefore2;
changes.push('Mod1: selector-bar closing div removed: ' + mod1b);

// 2. CSS changes
// Rule A: Remove .selector-bar { ... }
const ruleA = '.selector-bar {position: relative;width: 100%;background: var(--bg-muted);border-radius: var(--radius-md) var(--radius-md) 0 0;padding: var(--space-1) var(--space-2);border: 1px solid var(--border-subtle);border-bottom: none;max-height:30vh;overflow-y:auto;}';
const cssBefore1 = html;
html = html.replace(ruleA, '');
changes.push('Mod2a: selector-bar CSS rule removed: ' + (html !== cssBefore1));

// Rule B: Remove .selector-bar.generating .model.tag { ... }
const ruleB = '.selector-bar.generating .model.tag {cursor: not-allowed;opacity: 0.6;}';
const cssBefore2 = html;
html = html.replace(ruleB, '');
changes.push('Mod2b: selector-bar.generating rule removed: ' + (html !== cssBefore2));

// Rule C: Replace .selector-summary { ... } with new version
const oldRuleC = '.selector-summary {align-items: center;gap: var(--space-1);flex-wrap: wrap;flex: 1;min-width: 0;overflow: hidden;}';
const newRuleC = '.selector-summary {background: var(--bg-muted);border-radius: var(--radius-md) var(--radius-md) 0 0;padding: var(--space-1) var(--space-2);border: 1px solid var(--border-subtle);border-bottom: none;width: 100%;align-items: center;gap: var(--space-1);flex-wrap: wrap;min-width: 0;overflow: hidden;}';
const cssBefore3 = html;
html = html.replace(oldRuleC, newRuleC);
changes.push('Mod2c: selector-summary rule updated: ' + (html !== cssBefore3));

// Rule D: Add new rule after modified .selector-summary
const ruleD = '.selector-summary.generating .model.tag {cursor: not-allowed;opacity: 0.6;}';
const cssBefore4 = html;
html = html.replace(newRuleC, newRuleC + ruleD);
changes.push('Mod2d: new .selector-summary.generating rule added: ' + (html !== cssBefore4));

// 3. JS change
const jsBefore = html;
html = html.replace('const container = $(".selector-bar");', 'const container = $(".selector-summary");');
changes.push('Mod3: JS selector changed: ' + (html !== jsBefore));

// Verify
changes.push('---');
changes.push('File contains <div class="selector-bar">: ' + html.includes('<div class="selector-bar">'));
changes.push('File contains .selector-bar CSS rule: ' + /\.selector-bar\s*\{position:\s*relative/.test(html));
changes.push('File contains .selector-bar.generating: ' + /\.selector-bar\.generating/.test(html));
changes.push('File contains new .selector-summary rule: ' + html.includes('width: 100%'));
changes.push('File contains .selector-summary.generating: ' + html.includes('.selector-summary.generating .model.tag'));
changes.push('File contains correct JS: ' + html.includes('const container = $(".selector-summary");'));

console.log(changes.join('\n'));

try {
  fs.writeFileSync(filePath, html, 'utf8');
  console.log('\nFile written successfully.');
} catch (e) {
  console.error('Write error:', e.message);
}
