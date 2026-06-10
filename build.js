// 从 src/ 构建单页面 HTML 和 Chrome 扩展
// 用法: node build.js
// layout.html 包含完整 HTML 结构及 {CSS} {BOOT} {APP} 占位符，
// build 脚本填入压缩后的内容。

const fs = require('fs');
const path = require('path');

const SRC = 'src';
const DST = 'dist';

const MODULE_ORDER = [
	'storage-core.js',
	'providers.js',
	'ui-utils.js',
	'model-selector.js',
	'attachments.js',
	'store.js',
	'api.js',
	'shared.js',
	'main.js',
];

function read(...segments) {
	return fs.readFileSync(path.join(...segments), 'utf8');
}

function copy(src, dst) {
	fs.mkdirSync(path.dirname(dst), { recursive: true });
	fs.copyFileSync(src, dst);
}

function concatModules() {
	return MODULE_ORDER
		.map(f => read(SRC, 'modules', f))
		.join('')
		.replace(/\n$/, '');
}

function compressCSS(css) {
	return css.split('\n').map(l => l.trim()).filter(Boolean).join('');
}

function compressJS(js) {
	return js.split('\n').map(l => l.trimEnd()).filter(l => l !== '').join('\n');
}

/** 读取模板并替换占位符（用函数做替换值，避免 String.replace 对 $ 的特殊处理） */
function buildHTML(layout, css, boot, app) {
	return layout
		.replace('{CSS}', () => compressCSS(css))
		.replace('{BOOT}', () => '<script>' + compressJS(boot) + '</script>')
		.replace('{APP}', () => '<script>' + compressJS(app) + '</script>');
}

// ====== Clean dist ======
fs.rmSync(DST, { recursive: true, force: true });
fs.mkdirSync(DST, { recursive: true });

const layout = read(SRC, 'layout.html');

// ====== 1. 单页面 HTML ======
const mainHTML = buildHTML(layout, read(SRC, 'style.css'), read(SRC, 'modules', 'boot.js'), concatModules());
fs.writeFileSync(path.join(DST, 'kuai-lian-ai.html'), mainHTML, 'utf8');
console.log(`Built ${DST}/kuai-lian-ai.html`);

// ====== 2. Chrome 扩展 ======
const extDir = path.join(DST, 'extension');

// 2a. 复制扩展专用源码
const extSrcDir = path.join(SRC, 'extension');
for (const name of fs.readdirSync(extSrcDir)) {
	const srcPath = path.join(extSrcDir, name);
	if (fs.statSync(srcPath).isDirectory()) {
		fs.cpSync(srcPath, path.join(extDir, name), { recursive: true });
	} else {
		copy(srcPath, path.join(extDir, name));
	}
}

// 2b. 生成 boot.js / app.js
fs.writeFileSync(path.join(extDir, 'boot.js'), compressJS(read(SRC, 'modules', 'boot.js')) + '\n', 'utf8');
fs.writeFileSync(path.join(extDir, 'app.js'), compressJS(concatModules()) + '\n', 'utf8');

// 2c. 生成扩展版 HTML（占位符替换为 script src）
const extHTML = layout
	.replace('{CSS}', () => compressCSS(read(SRC, 'style.css')))
	.replace('{BOOT}', '<script src="boot.js"></script>')
	.replace('{APP}',
		'<script src="storage-core.js"></script>\n' +
		'\t<script src="cors-proxy.js"></script>\n' +
		'\t<script src="app.js"></script>');
fs.writeFileSync(path.join(extDir, 'kuai-lian-ai.html'), extHTML, 'utf8');

// 2d. 复制 vendor/
const vendorDir = path.join(extDir, 'vendor');
fs.mkdirSync(vendorDir, { recursive: true });
for (const f of fs.readdirSync('vendor')) {
	copy(path.join('vendor', f), path.join(vendorDir, f));
}

// 2e. 复制 SVG 图标
copy('恋-人脸、ai.svg', path.join(extDir, '恋-人脸、ai.svg'));

console.log(`Built ${extDir}/`);
console.log('Done.');