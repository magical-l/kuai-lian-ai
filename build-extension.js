// 从主 HTML 构建 Chrome 扩展
// 用法: node build-extension.js

const fs = require('fs');
const path = require('path');

const SRC = 'kuai-lian-ai.html';
const EXT = 'extension';

const html = fs.readFileSync(SRC, 'utf8');
const lines = html.split('\n');

// 找到所有 <script> 和 </script> 的边界（排除 vendor 的 <script src="...">）
const scriptBounds = [];
lines.forEach((line, i) => {
	if (/^\t<script>$/.test(line)) scriptBounds.push({ type: 'open', line: i });
	if (/^\t<\/script>$/.test(line)) scriptBounds.push({ type: 'close', line: i });
});

if (scriptBounds.length < 4) {
	console.error('Expected at least 2 inline script blocks');
	process.exit(1);
}

// 第一对内联：boot 适配脚本
const bootOpen = scriptBounds[0].line;
const bootClose = scriptBounds[1].line;
// 第二对内联：主应用脚本
const mainOpen = scriptBounds[2].line;
const mainClose = scriptBounds[3].line;

// 提取内容（不含 <script> / </script> 标签行）
const bootContent = lines.slice(bootOpen + 1, bootClose).join('\n') + '\n';
const mainContent = lines.slice(mainOpen + 1, mainClose).join('\n') + '\n';

// 写入扩展目录
fs.mkdirSync(EXT, { recursive: true });
fs.writeFileSync(path.join(EXT, 'boot.js'), bootContent);
fs.writeFileSync(path.join(EXT, 'app.js'), mainContent);
console.log(`Extracted boot.js (${bootContent.split('\n').length} lines)`);
console.log(`Extracted app.js (${mainContent.split('\n').length} lines)`);

// 构建扩展版 HTML：从后往前替换，避免行号偏移
let extLines = [...lines];

// 替换主脚本块
extLines.splice(mainOpen, mainClose - mainOpen + 1,
	'\t<script src="storage-core.js"></script>',
	'\t<script src="cors-proxy.js"></script>',
	'\t<script src="app.js"></script>'
);

// 替换 boot 脚本块
const bootOffset = -((mainClose - mainOpen + 1) - 3); // 上面替换导致的偏移
extLines.splice(bootOpen, bootClose - bootOpen + 1,
	'\t<script src="boot.js"></script>'
);

fs.writeFileSync(path.join(EXT, SRC), extLines.join('\n'));
console.log(`Generated ${EXT}/${SRC}`);

// 复制 vendor
const vendorSrc = 'vendor';
const vendorDst = path.join(EXT, 'vendor');
fs.mkdirSync(vendorDst, { recursive: true });
fs.readdirSync(vendorSrc).forEach(f => {
	fs.copyFileSync(path.join(vendorSrc, f), path.join(vendorDst, f));
});
console.log('Copied vendor/');
console.log('Done.');
