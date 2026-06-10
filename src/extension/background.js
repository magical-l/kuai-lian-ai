// 快连AI 浏览器插件 - Service Worker
// 代理AI端点请求以绕过CORS限制

'use strict';

// 点击工具栏图标 → 打开新标签页
chrome.action.onClicked.addListener(() => {
	chrome.tabs.create({ url: chrome.runtime.getURL('kuai-lian-ai.html') });
});

// 活跃的流式连接
const activeStreams = new Map();

chrome.runtime.onConnect.addListener(port => {
	if (port.name !== 'cors-proxy') return;

	port.onMessage.addListener(async msg => {
		if (msg.type === 'fetch-stream') {
			const { id, url, options } = msg;
			try {
				const controller = new AbortController();
				activeStreams.set(id, controller);

				// 合并外部signal
				if (options.signal) {
					// 在SW侧监听取消
				}

				const fetchOptions = {
					method: options.method || 'GET',
					headers: options.headers || {},
					body: options.body,
					signal: controller.signal
				};

				const response = await fetch(url, fetchOptions);

				port.postMessage({
					type: 'stream-start',
					id,
					status: response.status,
					ok: response.ok,
					headers: Object.fromEntries(response.headers.entries())
				});

				if (!response.ok || !response.body) {
					const text = await response.text();
					port.postMessage({ type: 'stream-end', id, error: text });
					activeStreams.delete(id);
					return;
				}

				const reader = response.body.getReader();
				const decoder = new TextDecoder();

				while (true) {
					const { done, value } = await reader.read();
					if (done) {
						port.postMessage({ type: 'stream-end', id, done: true });
						break;
					}
					const text = decoder.decode(value, { stream: true });
					port.postMessage({ type: 'stream-chunk', id, data: text });
				}
			} catch (err) {
				port.postMessage({
					type: 'stream-end',
					id,
					error: err.name === 'AbortError' ? 'aborted' : err.message
				});
			} finally {
				activeStreams.delete(id);
			}
		}

		if (msg.type === 'fetch-abort') {
			const controller = activeStreams.get(msg.id);
			if (controller) {
				controller.abort();
				activeStreams.delete(msg.id);
			}
		}
	});

	port.onDisconnect.addListener(() => {
		// 清理该端口所有活跃流
		for (const [id, controller] of activeStreams) {
			controller.abort();
		}
		activeStreams.clear();
	});
});

// 常规fetch代理（测试连接等非流式请求）
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
	if (message.type !== 'fetch') return;

	const { url, options } = message;
	const controller = new AbortController();
	const timeout = options.timeout || 30000;
	const timer = setTimeout(() => controller.abort(), timeout);

	fetch(url, {
		method: options.method || 'GET',
		headers: options.headers || {},
		body: options.body,
		signal: controller.signal
	})
		.then(async res => {
			clearTimeout(timer);
			const text = await res.text();
			sendResponse({
				success: true,
				data: {
					status: res.status,
					ok: res.ok,
					body: text,
					headers: Object.fromEntries(res.headers.entries())
				}
			});
		})
		.catch(err => {
			clearTimeout(timer);
			sendResponse({
				success: false,
				error: err.name === 'AbortError' ? '请求超时或已取消' : err.message
			});
		});

	return true; // 保持消息通道开放（异步sendResponse）
});