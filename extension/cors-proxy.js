// 快连AI 浏览器插件 - CORS代理
// 通过background service worker代理API请求，绕过CORS限制
// 注入到 window.__EXTENSION_FETCH__

(function() {
	'use strict';

	let streamIdCounter = 0;
	let port = null;

	function connectPort() {
		if (!port) {
			port = chrome.runtime.connect({ name: 'cors-proxy' });
			port.onDisconnect.addListener(() => { port = null; });
		}
	}

	// 非流式fetch（测试连接等简单请求）
	async function fetchSimple(url, options = {}) {
		return new Promise((resolve, reject) => {
			chrome.runtime.sendMessage({
				type: 'fetch',
				url,
				options: {
					method: options.method || 'GET',
					headers: options.headers || {},
					body: options.body,
					timeout: options.timeout || 30000
				}
			}, response => {
				if (chrome.runtime.lastError) {
					reject(new Error(chrome.runtime.lastError.message));
					return;
				}
				if (!response.success) {
					const err = new Error(response.error);
					if (response.error === '请求超时或已取消') err.name = 'AbortError';
					reject(err);
					return;
				}
				resolve({
					ok: response.data.ok,
					status: response.data.status,
					headers: new Headers(response.data.headers),
					text: () => Promise.resolve(response.data.body),
					json: () => Promise.resolve(JSON.parse(response.data.body)),
					body: null
				});
			});
		});
	}

	// 流式fetch（聊天等需要流式响应的请求）
	async function fetchStream(url, options = {}) {
		connectPort();

		const id = ++streamIdCounter;
		const externalSignal = options.signal;

		return new Promise((resolve, reject) => {
			let streamController;
			let streamStarted = false;
			let responseStatus, responseOk, responseHeaders;
			let chunks = [];
			let errorText = null;
			let textResolver = null;
			const textPromise = new Promise(res => { textResolver = res; });

			const readableStream = new ReadableStream({
				start(controller) { streamController = controller; },
				cancel() { port.postMessage({ type: 'fetch-abort', id }); }
			});

			function handleMessage(msg) {
				if (msg.id !== id) return;

				switch (msg.type) {
					case 'stream-start':
						responseStatus = msg.status;
						responseOk = msg.ok;
						responseHeaders = new Headers(msg.headers);
						streamStarted = true;
						resolve({
							ok: responseOk,
							status: responseStatus,
							headers: responseHeaders,
							body: readableStream,
							text: () => textPromise,
							json: () => textPromise.then(t => JSON.parse(t))
						});
						break;

					case 'stream-chunk':
						chunks.push(msg.data);
						if (streamController) {
							const encoder = new TextEncoder();
							streamController.enqueue(encoder.encode(msg.data));
						}
						break;

					case 'stream-end':
						if (msg.error) {
							errorText = msg.error;
							if (textResolver) textResolver(errorText);
							if (streamController) {
								try { streamController.error(new Error(msg.error)); } catch (e) {}
							}
						} else {
							const text = chunks.join('');
							if (textResolver) textResolver(text);
							if (streamController) {
								try { streamController.close(); } catch (e) {}
							}
						}
						port.onMessage.removeListener(handleMessage);
						break;
				}
			}

			port.onMessage.addListener(handleMessage);

			if (externalSignal) {
				externalSignal.addEventListener('abort', () => {
					port.postMessage({ type: 'fetch-abort', id });
				});
			}

			port.postMessage({
				type: 'fetch-stream',
				id,
				url,
				options: {
					method: options.method || 'GET',
					headers: options.headers || {},
					body: options.body
				}
			});
		});
	}

	async function extensionFetch(url, options = {}) {
		// 非流式请求（测试连接等）使用 fetchSimple
		if (options._noStream) {
			return await fetchSimple(url, options);
		}
		// 默认用流式代理（兼容聊天场景的 SSE 流）
		return await fetchStream(url, options);
	}

	window.__EXTENSION_FETCH__ = extensionFetch;
})();