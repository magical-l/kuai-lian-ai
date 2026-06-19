// 从 src/ 构建单页面 HTML 和 Chrome 扩展
// 用法: node build.js
// layout.html 使用标准 <link href> 和 <script src> 引用源文件，
// build 脚本扫描这些标签内联或重写引用。

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

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

/** 判断是否为源文件（需要 inline 或处理的） */
function isSourceAsset(src) {
	return src === 'style.css' || src.startsWith('modules/');
}

function buildSinglePage(html) {
	// 内联 CSS：<link href="style.css"> → <style>inline</style>
	html = html.replace(/<link\s[^>]*href="style\.css"[^>]*>/g, () => {
		return '<style>' + compressCSS(read(SRC, 'style.css')) + '</style>';
	});
	// 内联 JS：<script src="modules/X.js"> → <script>inline</script>
	html = html.replace(/<script\s[^>]*src="modules\/([^"]+)"[^>]*><\/script>/g, (m, file) => {
		return '<script>' + compressJS(read(SRC, 'modules', file)) + '</script>';
	});
	return html;
}

function buildExtension(html) {
	// 内联 CSS
	html = html.replace(/<link\s[^>]*href="style\.css"[^>]*>/g, () => {
		return '<style>' + compressCSS(read(SRC, 'style.css')) + '</style>';
	});
	// boot.js: 改为外部引用
	html = html.replace(/<script\s[^>]*src="modules\/boot\.js"[^>]*><\/script>/g,
		'<script src="boot.js"></script>');
	// app-modules 块: 替换为扩展版的 3 个外部引用
	html = html.replace(/<!-- app-modules -->[\s\S]*?<!-- \/app-modules -->/,
		'<script src="storage-core.js"></script>\n' +
		'\t<script src="cors-proxy.js"></script>\n' +
		'\t<script src="app.js"></script>');
	return html;
}

// ====== Clean dist ======
fs.rmSync(DST, { recursive: true, force: true });
fs.mkdirSync(DST, { recursive: true });

const layout = read(SRC, 'layout.html');

// ====== 1. 单页面 HTML ======
const mainHTML = buildSinglePage(layout);
fs.writeFileSync(path.join(DST, 'kuai-lian-ai.html'), mainHTML, 'utf8');
fs.copyFileSync(path.join(DST, 'kuai-lian-ai.html'), 'kuai-lian-ai.html');
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

// 2c. 生成扩展版 HTML
const extHTML = buildExtension(layout);
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

// ====== 3. 打包为 zip ======
const zipPath = path.resolve(DST, 'kuai-lian-ai.zip');
const extDirResolved = path.resolve(extDir);
execSync(
	`powershell -Command "Compress-Archive -Path '${extDirResolved}\\*' -DestinationPath '${zipPath}' -Force"`,
	{ stdio: 'inherit' }
);
console.log(`Packaged ${zipPath}`);

console.log('Done.');