// 从 src/ 构建单页面 HTML 和 Chrome 扩展
// 用法: node build.js
// layout.html 使用标准 <link href> 和 <script src> 引用源文件，
// build 脚本扫描这些标签内联或重写引用。

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const SRC = 'src';
const DST = 'dist';

const DEV_MODE = process.argv.includes('--dev');
const DEV_CSS_DIR = path.resolve(__dirname, '..', 'css', 'css');

const MODULE_ORDER = [
	'storage-core.js',
	'providers.js',
	'ui-utils.js',
	'selected-endpoints.js',
	'endpoint-tree.js',
	'messages.js',
	'session-list.js',
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

function validateCSS(css, filePath) {
	const lines = css.replace(/\/\*[\s\S]*?\*\//g, '').split('\n');
	let depth = 0, inDecl = false, errors = [];

	for (let i = 0; i < lines.length; i++) {
		const ln = lines[i];
		if (!ln.trim()) { if (inDecl) continue; else continue; }

		const opens = (ln.match(/\{/g) || []).length;
		const closes = (ln.match(/\}/g) || []).length;
		const prevDepth = depth;
		depth += opens - closes;

		if (prevDepth === 0 && opens === 0) { inDecl = false; continue; }

		if (opens + closes > 0) {
			inDecl = false;
			// 同行声明：提取 { 和 } 之间的声名文本做校验
			const braceOpen = ln.indexOf('{');
			const braceClose = ln.lastIndexOf('}');
			if (braceOpen >= 0 && braceClose > braceOpen) {
				const inline = ln.slice(braceOpen + 1, braceClose).trim();
				if (inline) {
					for (const part of inline.split(';')) {
						const d = part.trim();
						if (!d) continue;
						if (!/^\s*[a-zA-Z@_-][\w-]*\s*:/.test(d + ';'))
							errors.push(`  ${filePath}:${i + 1}: invalid declaration — "${d};"`);
					}
				}
			}
			continue;
		}

		// 多行声明延续行：跳过检查
		if (inDecl) { if (ln.trimEnd().endsWith(';')) inDecl = false; continue; }

		// 新开始的多行声明（有 : 但未以 ; 结尾）
		if (ln.includes(':') && !ln.trimEnd().endsWith(';')) {
			const colonAt = ln.indexOf(':');
			const prop = ln.slice(0, colonAt).trim();
			if (!/^[a-zA-Z@_-][\w-]*$/.test(prop))
				errors.push(`  ${filePath}:${i + 1}: invalid property name — "${prop}"`);
			inDecl = true;
			continue;
		}

		// 单行声明
		if (ln.trimEnd().endsWith(';')) {
			if (!/^\s*[a-zA-Z@_-][\w-]*\s*:.+;/.test(ln))
				errors.push(`  ${filePath}:${i + 1}: invalid declaration — "${ln.trim()}"`);
		}
	}

	if (depth !== 0) errors.push(`  Brace mismatch in ${filePath}: unpaired braces (net: ${depth})`);

	if (errors.length) {
		console.error('\nCSS validation failed:');
		errors.forEach(e => console.error(e));
		process.exit(1);
	}
}

function compressJS(js) {
	return js.split('\n').map(l => l.trimEnd()).filter(l => l !== '').join('\n');
}

/** 判断是否为源文件（需要 inline 或处理的） */
function isSourceAsset(src) {
	return src === 'style.css' || src.startsWith('modules/');
}

function syncGetURL(url) {
	try {
		if (process.platform === 'win32') {
			return execSync(
				`powershell -Command "(Invoke-WebRequest -Uri '${url}' -UseBasicParsing).Content"`,
				{ encoding: 'utf8', timeout: 15000, stdio: ['ignore', 'pipe', 'ignore'] }
			).trim();
		}
		return execSync(`curl -sf "${url}"`, { encoding: 'utf8', timeout: 15000, stdio: ['ignore', 'pipe', 'ignore'] }).trim();
	} catch {
		return null;
	}
}

function tryInlineLocalCSS(html) {
	const remoteCSSFiles = [
		{ url: 'css.lwj621.workers.dev/css/common.css', label: 'common.css' },
		{ url: 'css.lwj621.workers.dev/css/layout.css', label: 'layout.css' },
	];
	for (const { url, label } of remoteCSSFiles) {
		let content = null;
		// 1. 开发模式：优先用本地文件
		if (DEV_MODE) {
			const localPath = path.join(DEV_CSS_DIR, label);
			try {
				if (fs.existsSync(localPath)) {
					content = fs.readFileSync(localPath, 'utf8');
					console.log(`  [dev] inlined local ${label}`);
				}
			} catch (e) {
				console.warn(`  [dev] failed to read ${localPath}: ${e.message}`);
			}
		}
		// 2. 从 CDN fetch（构建时内联，确保扩展/单页不依赖外网）
		if (!content) {
			const cdnURL = `https://${url}`;
			content = syncGetURL(cdnURL);
			if (content) {
				console.log(`  fetched ${url} (${(content.length / 1024).toFixed(1)} KB)`);
			} else {
				console.warn(`  [warn] failed to fetch ${cdnURL}, leaving external link`);
			}
		}
		if (content) {
			const escapedUrl = url.replace(/\./g, '\\.');
			html = html.replace(
				new RegExp(`@import\\s+url\\(\\s*['\"]https://${escapedUrl}['\"]\\s*\\)\\s*layer\\(base\\)\\s*;`, 'g'),
				() => '@layer base { ' + compressCSS(content) + ' }'
			);
		}
	}
	return html;
}

function buildSinglePage(html) {
	// 内联 CSS：<link href="style.css"> → <style>inline</style>
	const cssContent = read(SRC, 'style.css');
	validateCSS(cssContent, 'src/style.css');
	html = html.replace(/<link\s[^>]*href="style\.css"[^>]*>/g, () => {
		return '<style>' + compressCSS(cssContent) + '</style>';
	});
	// 内联 highlight CSS
	const hlCSSText = read('vendor', 'highlight-github.min.css');
	html = html.replace(/<link\s[^>]*href="\.\.\/vendor\/highlight-github\.min\.css"[^>]*>/g, () => {
		return '<style>' + compressCSS(hlCSSText) + '</style>';
	});
	// 内联 JS：<script src="modules/X.js"> → <script>inline</script>
	html = html.replace(/<script\s[^>]*src="modules\/([^"]+)"[^>]*><\/script>/g, (m, file) => {
		return '<script>' + compressJS(read(SRC, 'modules', file)) + '</script>';
	});
	// 修正 vendor CSS 路径（源码版用 ../vendor/，构建版统一用 vendor/）
	html = html.replace(/href="\.\.\/vendor\//g, 'href="vendor/');
	// 内联 vendor JS
	html = html.replace(/<script\s[^>]*src="[^"]*vendor\/marked\.min\.js"[^>]*><\/script>/g, () => {
		return '<script>' + read('vendor', 'marked.min.js') + '</script>';
	});
	html = html.replace(/<script\s[^>]*src="[^"]*vendor\/highlight\.min\.js"[^>]*><\/script>/g, () => {
		return '<script>' + read('vendor', 'highlight.min.js') + '</script>';
	});
	// 内联 SVG 图标（转为 base64 data URI，单页文件可独立分发）
	const svgBase64 = fs.readFileSync('logo.svg', 'base64');
	const svgDataUri = 'data:image/svg+xml;base64,' + svgBase64;
	html = html.replace(/src="[^"]*logo\.svg"/g, 'src="' + svgDataUri + '"');
	html = html.replace(/href="[^"]*logo\.svg"/g, 'href="' + svgDataUri + '"');
	html = tryInlineLocalCSS(html);
	return html;
}

function buildExtension(html) {
	// 内联 CSS
	const cssContent = read(SRC, 'style.css');
	validateCSS(cssContent, 'src/style.css');
	html = html.replace(/<link\s[^>]*href="style\.css"[^>]*>/g, () => {
		return '<style>' + compressCSS(cssContent) + '</style>';
	});
	// 内联 highlight CSS
	const extHLCSSText = read('vendor', 'highlight-github.min.css');
	html = html.replace(/<link\s[^>]*href="\.\.\/vendor\/highlight-github\.min\.css"[^>]*>/g, () => {
		return '<style>' + compressCSS(extHLCSSText) + '</style>';
	});
	// 修正 vendor CSS 路径（源码版用 ../vendor/，构建版统一用 vendor/）
	html = html.replace(/href="\.\.\/vendor\//g, 'href="vendor/');
	// 修正 vendor JS 路径（构建版用 vendor/）
	html = html.replace(/src="\.\.\/vendor\//g, 'src="vendor/');
	// boot.js: 改为外部引用
	html = html.replace(/<script\s[^>]*src="modules\/boot\.js"[^>]*><\/script>/g,
		'<script src="boot.js"></script>');
	// app-modules 块: 替换为扩展版的 3 个外部引用
	html = html.replace(/<!-- app-modules -->[\s\S]*?<!-- \/app-modules -->/,
		'<script src="storage-core.js"></script>\n' +
		'\t<script src="cors-proxy.js"></script>\n' +
		'\t<script src="app.js"></script>');
	html = tryInlineLocalCSS(html);
	return html;
}

// ====== Ensure dist directory ======
fs.mkdirSync(DST, { recursive: true });

const layout = read(SRC, 'layout.html');

// ====== 1. 单页面 HTML ======
const mainHTML = buildSinglePage(layout);
fs.writeFileSync(path.join(DST, 'kuai-lian-ai.html'), mainHTML, 'utf8');
fs.copyFileSync(path.join(DST, 'kuai-lian-ai.html'), 'kuai-lian-ai.html');
console.log(`Built ${DST}/kuai-lian-ai.html`);

	// 1b. 复制 icons.svg（SVG sprite，供 standalone HTML 引用）
	copy(path.join(SRC, 'icons.svg'), path.join(DST, 'icons.svg'));
	fs.copyFileSync(path.join(DST, 'icons.svg'), 'icons.svg');
	console.log('Copied icons.svg');

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
copy('logo.svg', path.join(extDir, 'logo.svg'));
copy(path.join(SRC, 'icons.svg'), path.join(extDir, 'icons.svg'));

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
