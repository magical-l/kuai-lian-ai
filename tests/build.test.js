'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execSync, spawn } = require('node:child_process');
const test = require('node:test');
const vm = require('node:vm');

const buildSource = fs.readFileSync(path.join(__dirname, '..', 'build.js'), 'utf8').replace(/\r\n/g, '\n');
const syncGetURLSource = buildSource.match(/function syncGetURL\(url\) \{[\s\S]*?\n\}\n\nfunction tryInlineLocalCSS/)[0]
	.replace(/\n\nfunction tryInlineLocalCSS$/, '');

function fetchAsWindows(url) {
	const context = { Buffer, execSync, process: { platform: 'win32' }, result: null, url };
	vm.runInNewContext(`${syncGetURLSource}\nresult = syncGetURL(url);`, context);
	return context.result;
}

function startFixtureServer(content) {
	const source = `
		const http = require('node:http');
		const content = Buffer.from(${JSON.stringify(content)}, 'utf8');
		const server = http.createServer((request, response) => {
			response.writeHead(200, { 'Content-Type': 'text/css' });
			response.end(content);
		});
		server.listen(0, '127.0.0.1', () => process.stdout.write(String(server.address().port) + '\\n'));
	`;
	const server = spawn(process.execPath, ['-e', source], { stdio: ['ignore', 'pipe', 'inherit'] });
	return {
		server,
		port: new Promise((resolve, reject) => {
			server.once('error', reject);
			server.stdout.once('data', data => resolve(Number(data.toString().trim())));
		}),
	};
}

test('Windows remote CSS fetch preserves UTF-8 icon characters', { skip: process.platform !== 'win32' }, async () => {
	const css = '.folder::before{content:"🗁"}.delete::before{content:"✕"}';
	const fixture = startFixtureServer(css);
	try {
		const port = await fixture.port;
		assert.equal(fetchAsWindows(`http://127.0.0.1:${port}/icons.css`), css);
	} finally {
		fixture.server.kill();
	}
});
