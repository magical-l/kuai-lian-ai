'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const endpointTreeSourcePath = path.join(__dirname, '..', 'src', 'modules', 'endpoint-tree.js');
const mainSourcePath = path.join(__dirname, '..', 'src', 'modules', 'main.js');
const storeSourcePath = path.join(__dirname, '..', 'src', 'modules', 'store.js');
const sessionListSourcePath = path.join(__dirname, '..', 'src', 'modules', 'session-list.js');
const selectedEndpointsSourcePath = path.join(__dirname, '..', 'src', 'modules', 'selected-endpoints.js');
const attachmentsSourcePath = path.join(__dirname, '..', 'src', 'modules', 'attachments.js');
const paramsRegistrySourcePath = path.join(__dirname, '..', 'src', 'modules', 'params-registry.js');
const apiSourcePath = path.join(__dirname, '..', 'src', 'modules', 'api.js');
class FakeEventTarget {
	constructor() {
		this.listeners = new Map();
	}
	addEventListener(type, listener) {
		if (!this.listeners.has(type)) this.listeners.set(type, []);
		this.listeners.get(type).push(listener);
	}
	dispatchEvent(event) {
		event.currentTarget = this;
		const listeners = this.listeners.get(event.type) || [];
		listeners.forEach(listener => listener(event));
		return true;
	}
}

function maskJavaScriptStringsAndComments(source) {
	let masked = '';
	let index = 0;
	let state = 'code';
	while (index < source.length) {
		const character = source[index];
		const nextCharacter = source[index + 1];
		if (state === 'code') {
			if (character === '/' && nextCharacter === '/') {
				masked += '  ';
				index += 2;
				state = 'line-comment';
				continue;
			}
			if (character === '/' && nextCharacter === '*') {
				masked += '  ';
				index += 2;
				state = 'block-comment';
				continue;
			}
			if (character === '\'' || character === '"' || character === '`') {
				masked += ' ';
				index += 1;
				state = character;
				continue;
			}
			masked += character;
			index += 1;
			continue;
		}
		if (state === 'line-comment') {
			if (character === '\n' || character === '\r') {
				masked += character;
				state = 'code';
			} else {
				masked += ' ';
			}
			index += 1;
			continue;
		}
		if (state === 'block-comment') {
			if (character === '*' && nextCharacter === '/') {
				masked += '  ';
				index += 2;
				state = 'code';
				continue;
			}
			masked += character === '\n' || character === '\r' ? character : ' ';
			index += 1;
			continue;
		}
		if (character === '\\') {
			masked += '  ';
			index += 2;
			continue;
		}
		if (character === state) {
			masked += ' ';
			index += 1;
			state = 'code';
			continue;
		}
		masked += character === '\n' || character === '\r' ? character : ' ';
		index += 1;
	}
	return masked;
}

function extractFunctionDeclaration(source, functionName) {
	const maskedSource = maskJavaScriptStringsAndComments(source);
	const declarationPattern = new RegExp(`\\bfunction\\s+${functionName}\\s*\\(`);
	const declarationMatch = declarationPattern.exec(maskedSource);
	assert.ok(declarationMatch, `Could not find function declaration ${functionName}`);
	const declarationStart = declarationMatch.index;
	const bodyStart = maskedSource.indexOf('{', declarationStart);
	assert.notEqual(bodyStart, -1, `Could not find function body for ${functionName}`);
	let depth = 0;
	for (let index = bodyStart; index < maskedSource.length; index += 1) {
		if (maskedSource[index] === '{') depth += 1;
		if (maskedSource[index] === '}') depth -= 1;
		if (depth === 0) return source.slice(declarationStart, index + 1);
	}
	throw new Error(`Could not balance function body for ${functionName}`);
}

function createMergeParamsHarness() {
	const context = vm.createContext({});
	const sharedSource = fs.readFileSync(path.join(__dirname, '..', 'src', 'modules', 'shared.js'), 'utf8');
	const source = [
		extractFunctionDeclaration(sharedSource, 'setOwnEnumerableDataProperty'),
		extractFunctionDeclaration(sharedSource, 'mergeParams')
	].join('\n');
	new vm.Script(`${source}\nglobalThis.__mergeParams = mergeParams;`, {
		filename: sharedSource
	}).runInContext(context);
	return context.__mergeParams;
}

function createProviderRequestBodyHarness() {
	const calls = [];
	const context = vm.createContext({
		AbortController,
		Response,
		console: {
			log() {}
		},
		document: {},
		HTMLElement: function HTMLElement() {},
		Document: function Document() {},
		createInitialState() {
			return {
				content: '',
				thinking: '',
				thinkingDuration: null
			};
		},
		createTagParser() {
			return null;
		},
		currentAbortController: null,
		fetchWithTimeout: async function(url, options) {
			calls.push({
				url,
				body: JSON.parse(options.body)
			});
			if (url.includes('/embeddings')) {
				return new Response('{"data":[{"embedding":[0.1]}],"model":"model"}', {
					status: 200,
					headers: {
						'content-type': 'application/json'
					}
				});
			}
			return new Response('data: [DONE]\n\n', {
				status: 200,
				headers: {
					'content-type': 'text/event-stream'
				}
			});
		},
		finalizeState() {},
		processSSEStream: async function() {}
	});
	context.HTMLElement.prototype = {};
	context.Document.prototype = {};
	const providersSource = fs.readFileSync(path.join(__dirname, '..', 'src', 'modules', 'providers.js'), 'utf8');
	const sharedSource = fs.readFileSync(path.join(__dirname, '..', 'src', 'modules', 'shared.js'), 'utf8');
	const source = [
		providersSource,
		extractFunctionDeclaration(sharedSource, 'setOwnEnumerableDataProperty'),
		extractFunctionDeclaration(sharedSource, 'mergeParams'), 'async ' + extractFunctionDeclaration(sharedSource, 'callProvider'), 'async ' + extractFunctionDeclaration(sharedSource, 'callEmbedding'), 'globalThis.__providerRequestBody = { callEmbedding, callProvider, providers };'
	].join('\n');
	new vm.Script(source, {
		filename: path.join(__dirname, '..', 'src', 'modules', 'providers.js')
	}).runInContext(context);
	return {
		api: context.__providerRequestBody,
		calls
	};
}

function createParamRegistryHarness() {
	const context = vm.createContext({});
	const paramsRegistrySource = fs.readFileSync(paramsRegistrySourcePath, 'utf8');
	const source = [
		paramsRegistrySource,
		'globalThis.__paramRegistry = { getParamDefs };'
	].join('\n');
	new vm.Script(source, {
		filename: paramsRegistrySourcePath
	}).runInContext(context);
	return context.__paramRegistry;
}

function createEndpointTreeHarness(handlerSpies) {
	const context = vm.createContext({
		console
	});
	const source = fs.readFileSync(endpointTreeSourcePath, 'utf8');
	new vm.Script(source, {
		filename: endpointTreeSourcePath
	}).runInContext(context);
	context.handleNodeDragover = handlerSpies.dragover;
	context.handleNodeDragleave = handlerSpies.dragleave;
	context.handleNodeDrop = handlerSpies.drop;
	return {
		bindEndpointNodeDragEvents: vm.runInContext('typeof bindEndpointNodeDragEvents === \'function\' ? bindEndpointNodeDragEvents : null', context)
	};
}

function createGenerationApiHarness() {
	const context = vm.createContext({
		console,
		AbortController,
		currentSession: {
			id: 'session-1'
		},
		invalidatedSessionIds: new Set(),
		sessionGenerations: new Map()
	});
	const source = fs.readFileSync(apiSourcePath, 'utf8');
	const exposedSource = [
		extractFunctionDeclaration(source, 'invalidateSession'),
		extractFunctionDeclaration(source, 'isSessionInvalidated'),
		extractFunctionDeclaration(source, 'clearSessionInvalidation'), 'const sessionAbortControllers = new Map();',
		extractFunctionDeclaration(source, 'getSessionAbortController'),
		extractFunctionDeclaration(source, 'abortSessionRequests'),
		extractFunctionDeclaration(source, 'finishSessionAbortController'),
		extractFunctionDeclaration(source, 'getSessionGenerations'),
		extractFunctionDeclaration(source, 'clearSessionGenerations'),
		extractFunctionDeclaration(source, 'stopSessionGenerations'),
		extractFunctionDeclaration(source, 'stopAllGenerations'),
		extractFunctionDeclaration(source, 'deleteSessionGenerations'), 'globalThis.__generationApi = { getSessionGenerations, deleteSessionGenerations, stopSessionGenerations, stopAllGenerations, invalidateSession, isSessionInvalidated, getSessionAbortController, abortSessionRequests, finishSessionAbortController };'
	].join('\n');
	new vm.Script(exposedSource, {
		filename: apiSourcePath
	}).runInContext(context);
	return {
		api: context.__generationApi
	};
}

function createGenerationStartHarness(options = {}) {
	const generationStarts = [];
	const context = vm.createContext({
		console,
		currentSession: {
			id: 'session-1',
			messages: []
		},
		defaultSelectedEndpointParams: {},
		invalidatedSessionIds: new Set(),
		lastUserMessage: '',
		pendingAttachments: [],
		selectedEndpoints: ['endpoint-1'],
		sessionGenerations: new Map(),
		addMessage: async function(sessionId, role, content) {
			if (role === 'user') {
				context.currentSession.messages.push({
					role,
					content
				});
				if (options.afterUserMessage) await options.afterUserMessage(context);
			}
		},
		appendUserMessage() {},
		callAllModels: async function(groups, endpointIds, messages, onChunk, sessionId) {
			generationStarts.push({
				endpointIds: [...endpointIds],
				messages,
				sessionId,
				isSessionInvalidated: context.isSessionInvalidated(sessionId)
			});
			return [];
		},
		clearAttachments() {},
		clearInput() {},
		createSession: async function() {
			throw new Error('existing session must be reused');
		},
		findModelById() {
			return null;
		},
		getGroups() {
			return [];
		},
		getInputMessage: async function() {
			return [{
				type: 'text',
				text: 'Hello'
			}];
		},
		isSessionInvalidated: null,
		loadSession: async function() {
			return context.currentSession;
		},
		normalizeMessageContent(content) {
			return content;
		},
		renderSelectedEndpoints() {},
		resolveNodeConfig() {
			return {
				type: 'chat'
			};
		},
		reorderCardsBySpeed() {},
		reorderSelectorTagsBySpeed() {},
		setButtonState() {},
		showThinkingCards() {},
		toOpenAIContent(content) {
			return content;
		},
		updateStreamingCard() {},
		refreshUI: async function() {},
		$$() {
			return [];
		}
	});
	const apiSource = fs.readFileSync(apiSourcePath, 'utf8');
	const mainSource = fs.readFileSync(mainSourcePath, 'utf8');
	const harnessSource = [
		extractFunctionDeclaration(apiSource, 'invalidateSession'),
		extractFunctionDeclaration(apiSource, 'isSessionInvalidated'),
		extractFunctionDeclaration(apiSource, 'clearSessionInvalidation'), 'async ' + extractFunctionDeclaration(mainSource, 'handleSend'), 'globalThis.__generationStartApi = { clearSessionInvalidation, handleSend, invalidateSession, isSessionInvalidated };'
	].join('\n');
	new vm.Script(harnessSource, {
		filename: mainSourcePath
	}).runInContext(context);
	return {
		api: context.__generationStartApi,
		generationStarts
	};
}

function createNonStreamGenerationHarness() {
	const controller = new AbortController();
	const calls = {
		addAssistant: 0,
		embeddingSignal: null,
		updateEmbedding: 0
	};
	const context = vm.createContext({
		console,
		AbortController,
		currentSession: {
			id: 'session-1',
			messages: []
		},
		defaultSelectedEndpointParams: {},
		lastUserMessage: '',
		pendingAttachments: [],
		selectedEndpoints: ['endpoint-1'],
		sessionGenerations: new Map(),
		addMessage: async function(sessionId, role, content) {
			if (role === 'user') context.currentSession.messages.push({
				role,
				content
			});
			if (role === 'assistant') calls.addAssistant += 1;
		},
		appendUserMessage() {},
		callEmbedding: async function(style, baseUrl, apiKey, model, input, isFullUrl, params, signal) {
			calls.embeddingSignal = signal;
			context.invalidateSession('session-1');
			return {
				embedding: [0.1],
				model: 'model-1'
			};
		},
		clearAttachments() {},
		clearInput() {},
		createSession: async function() {
			throw new Error('existing session must be reused');
		},
		findModelById() {
			return {
				node: {
					id: 'endpoint-1',
					modelId: 'model-1',
					name: 'model-1'
				}
			};
		},
		getGroups() {
			return [];
		},
		getInputMessage: async function() {
			return [{
				type: 'text',
				text: 'Hello'
			}];
		},
		getSessionAbortController() {
			return controller;
		},
		loadSession: async function() {
			return context.currentSession;
		},
		normalizeMessageContent(content) {
			return content;
		},
		renderSelectedEndpoints() {},
		resolveNodeConfig() {
			return {
				type: 'embedding',
				style: 'openai',
				baseUrl: '',
				key: '',
				params: {}
			};
		},
		reorderCardsBySpeed() {},
		reorderSelectorTagsBySpeed() {},
		setButtonState() {},
		showThinkingCards() {},
		toOpenAIContent(content) {
			return content;
		},
		updateCardAsEmbedding() {
			calls.updateEmbedding += 1;
		},
		updateCardStatus() {},
		refreshUI: async function() {},
		$$() {
			return [];
		}
	});
	const apiSource = fs.readFileSync(apiSourcePath, 'utf8');
	const mainSource = fs.readFileSync(mainSourcePath, 'utf8');
	const harnessSource = ['const invalidatedSessionIds = new Set();',
		extractFunctionDeclaration(apiSource, 'invalidateSession'),
		extractFunctionDeclaration(apiSource, 'isSessionInvalidated'),
		extractFunctionDeclaration(apiSource, 'clearSessionInvalidation'), 'async ' + extractFunctionDeclaration(mainSource, 'handleSend'), 'globalThis.__nonStreamGenerationApi = { handleSend };'
	].join('\n');
	new vm.Script(harnessSource, {
		filename: mainSourcePath
	}).runInContext(context);
	return {
		api: context.__nonStreamGenerationApi,
		calls,
		controller
	};
}

function createDeferredNonStreamGenerationHarness() {
	let resolveEmbedding;
	let signalEmbeddingStarted;
	const embeddingResult = new Promise(function(resolve) {
		resolveEmbedding = resolve;
	});
	const embeddingStarted = new Promise(function(resolve) {
		signalEmbeddingStarted = resolve;
	});
	const controller = new AbortController();
	const calls = {
		addAssistant: 0,
		embeddingSignal: null,
		updateEmbedding: 0
	};
	const context = vm.createContext({
		console,
		AbortController,
		currentSession: {
			id: 'session-1',
			messages: []
		},
		defaultSelectedEndpointParams: {},
		lastUserMessage: '',
		pendingAttachments: [],
		selectedEndpoints: ['endpoint-1'],
		sessionGenerations: new Map(),
		addMessage: async function(sessionId, role, content) {
			if (role === 'user') context.currentSession.messages.push({
				role,
				content
			});
			if (role === 'assistant') calls.addAssistant += 1;
		},
		appendUserMessage() {},
		callEmbedding: async function(style, baseUrl, apiKey, model, input, isFullUrl, params, signal) {
			calls.embeddingSignal = signal;
			signalEmbeddingStarted();
			return embeddingResult;
		},
		clearAttachments() {},
		clearInput() {},
		createSession: async function() {
			throw new Error('existing session must be reused');
		},
		findModelById() {
			return {
				node: {
					id: 'endpoint-1',
					modelId: 'model-1',
					name: 'model-1'
				}
			};
		},
		getGroups() {
			return [];
		},
		getInputMessage: async function() {
			return [{
				type: 'text',
				text: 'Hello'
			}];
		},
		getSessionAbortController() {
			return controller;
		},
		loadSession: async function() {
			return context.currentSession;
		},
		normalizeMessageContent(content) {
			return content;
		},
		renderSelectedEndpoints() {},
		resolveNodeConfig() {
			return {
				type: 'embedding',
				style: 'openai',
				baseUrl: '',
				key: '',
				params: {}
			};
		},
		reorderCardsBySpeed() {},
		reorderSelectorTagsBySpeed() {},
		setButtonState() {},
		showThinkingCards() {},
		toOpenAIContent(content) {
			return content;
		},
		updateCardAsEmbedding() {
			calls.updateEmbedding += 1;
		},
		updateCardStatus() {},
		refreshUI: async function() {},
		$$() {
			return [];
		}
	});
	const apiSource = fs.readFileSync(apiSourcePath, 'utf8');
	const mainSource = fs.readFileSync(mainSourcePath, 'utf8');
	const harnessSource = ['const invalidatedSessionIds = new Set();',
		extractFunctionDeclaration(apiSource, 'invalidateSession'),
		extractFunctionDeclaration(apiSource, 'isSessionInvalidated'),
		extractFunctionDeclaration(apiSource, 'clearSessionInvalidation'), 'async ' + extractFunctionDeclaration(mainSource, 'handleSend'), 'globalThis.__deferredNonStreamGenerationApi = { handleSend };'
	].join('\n');
	new vm.Script(harnessSource, {
		filename: mainSourcePath
	}).runInContext(context);
	return {
		api: context.__deferredNonStreamGenerationApi,
		calls,
		controller,
		embeddingStarted,
		resolveEmbedding
	};
}

function createUpdateCardStatusHarness() {
	const animationFrames = [];
	const calls = {
		cardSelectorMatches: 0,
		domWrites: []
	};
	const card = {};
	const stopButton = {
		classList: {
			remove(className) {
				calls.domWrites.push('stop-button.remove:' + className);
			}
		}
	};
	const contentEl = {
		textContent: 'already rendered'
	};
	const icon = {
		classList: {
			add(className) {
				calls.domWrites.push('icon.add:' + className);
			},
			remove(className) {
				calls.domWrites.push('icon.remove:' + className);
			}
		},
		set textContent(value) {
			calls.domWrites.push('icon.textContent:' + value);
		}
	};
	const meta = {};
	// 卡片正文内容区（`$('.one.response.msg > .content')` 应命中它，而不是 header 的 `.copy.content` 按钮）
	const bodyContent = {
		innerHTML: '',
		children: [],
		classList: {
			add(className) {
				calls.domWrites.push('bodyContent.classList.add:' + className);
			},
			remove(className) {
				calls.domWrites.push('bodyContent.classList.remove:' + className);
			}
		},
		addChild(el) {
			this.children.push(el);
			calls.domWrites.push('bodyContent.addChild:' + (el.className || el.tagName));
		}
	};
	const copyButton = {
		classList: {
			add(className) {
				calls.domWrites.push('copyButton.classList.add:' + className);
			},
			remove() {}
		}
	};
	const context = vm.createContext({
		assert,
		getStatusText() {
			return 'completed';
		},
		requestAnimationFrame(callback) {
			animationFrames.push(callback);
			return animationFrames.length;
		},
		mk: function(tag, className) {
			calls.domWrites.push('mk:' + tag + ':' + className);
			return {
				tagName: tag,
				className: className,
				textContent: '',
				classList: {
					add() {}
				},
				addChild() {}
			};
		},
		'$': function(selector, scope) {
			if (!scope) {
				assert.equal(selector, '.one.response.msg[data-session-id="session-1"][data-endpoint-id="endpoint-1"]');
				calls.cardSelectorMatches += 1;
				return card;
			}
			if (scope === card) {
				if (selector === '.stop-one-response') return stopButton;
				if (selector === '.say') return contentEl;
				if (selector === 'header') return meta;
				if (selector === '.one.response.msg > .content') return bodyContent;
				if (selector === '.copy.content') return copyButton;
			}
			if (scope === meta && selector === '.status.loading') return icon;
			throw new Error('Unexpected selector: ' + selector);
		}
	});
	const apiSource = fs.readFileSync(apiSourcePath, 'utf8');
	const mainSource = fs.readFileSync(mainSourcePath, 'utf8');
	const harnessSource = ['const invalidatedSessionIds = new Set();',
		extractFunctionDeclaration(apiSource, 'invalidateSession'),
		extractFunctionDeclaration(apiSource, 'isSessionInvalidated'),
		extractFunctionDeclaration(mainSource, 'updateCardStatus'), 'globalThis.__updateCardStatusApi = { invalidateSession, updateCardStatus };'
	].join('\n');
	new vm.Script(harnessSource, {
		filename: mainSourcePath
	}).runInContext(context);
	return {
		api: context.__updateCardStatusApi,
		calls,
		bodyContent,
		contentEl,
		runNextAnimationFrame() {
			assert.equal(animationFrames.length, 1);
			animationFrames.shift()();
		}
	};
}

function createCallEmbeddingSignalHarness() {
	const calls = [];
	const context = vm.createContext({
		console,
		providers: {
			openai: {
				buildEmbeddingRequest() {
					return {
						url: 'https://example.test/v1/embeddings',
						headers: {},
						body: {}
					};
				},
				parseEmbeddingResponse(data) {
					return data;
				}
			}
		},
		mergeParams() {},
		fetchWithTimeout: async function(url, options) {
			calls.push({
				url,
				options
			});
			return {
				ok: true,
				headers: {
					get() {
						return 'application/json';
					}
				},
				text: async function() {
					return '{"embedding":[0.1]}';
				}
			};
		}
	});
	const sharedSource = fs.readFileSync(path.join(__dirname, '..', 'src', 'modules', 'shared.js'), 'utf8');
	new vm.Script(`async ${extractFunctionDeclaration(sharedSource, 'callEmbedding')}\nglobalThis.__callEmbedding = callEmbedding;`, {
		filename: sharedSource
	}).runInContext(context);
	return {
		callEmbedding: context.__callEmbedding,
		calls
	};
}

function createCallProviderHarness(options = {}) {
	const context = vm.createContext({
		AbortController,
		Response,
		createInitialState() {
			return {
				content: '',
				thinking: '',
				thinkingDuration: null
			};
		},
		createTagParser() {
			return null;
		},
		currentAbortController: null,
		fetchWithTimeout: async function() {
			if (options.abort) {
				const error = new Error('stopped');
				error.name = 'AbortError';
				throw error;
			}
			return new Response('data: {"choices":[{"delta":{"content":"Hello"}}]}\n\ndata: [DONE]\n\n', {
				status: 200,
				headers: {
					'content-type': 'application/json'
				}
			});
		},
		finalizeState() {},
		mergeParams() {},
		processSSEStream: async function(response, provider, state, tagParser, onChunk) {
			assert.equal(response.body instanceof ReadableStream, true);
			state.content = 'Hello';
			onChunk(state);
		}
	});
	const sharedSource = fs.readFileSync(path.join(__dirname, '..', 'src', 'modules', 'shared.js'), 'utf8');
	const callProviderSource = extractFunctionDeclaration(sharedSource, 'callProvider');
	new vm.Script(`async ${callProviderSource}\nglobalThis.__callProvider = callProvider;`, {
		filename: sharedSource
	}).runInContext(context);
	return context.__callProvider;
}

function createEarlyImagePreviewHarness() {
	let signalImageDownloadStarted;
	let resolveImageDownload;
	const imageDownloadStarted = new Promise(function(resolve) {
		signalImageDownloadStarted = resolve;
	});
	const imageDownload = new Promise(function(resolve) {
		resolveImageDownload = resolve;
	});
	let requestCount = 0;
	const context = vm.createContext({
		console: {
			warn() {}
		},
		URL: {
			createObjectURL() {
				return 'blob:generated';
			}
		},
		FileReader: class {
			readAsDataURL() {
				this.result = 'data:image/png;base64,encoded';
				this.onload();
			}
		},
		fetch: async function() {
			requestCount += 1;
			if (requestCount === 2) {
				signalImageDownloadStarted();
				return imageDownload;
			}
			return {
				ok: true,
				headers: {
					get() {
						return 'application/json';
					}
				},
				text: async function() {
					return JSON.stringify({
						data: [{
							url: 'https://download.example/media'
						}]
					});
				}
			};
		},
		fetchWithTimeout: async function() {
			return context.fetch();
		},
		mergeParams() {},
		providers: {
			openai: {
				buildImageRequest() {
					return {
						url: 'https://api.example/generate',
						headers: {},
						body: {}
					};
				}
			}
		}
	});
	const sharedSource = fs.readFileSync(path.join(__dirname, '..', 'src', 'modules', 'shared.js'), 'utf8');
	const functionSource = extractFunctionDeclaration(sharedSource, 'callImageGeneration');
	new vm.Script(`async ${functionSource}\nglobalThis.__earlyImagePreview = callImageGeneration;`, {
		filename: sharedSource
	}).runInContext(context);
	return {
		callImageGeneration: context.__earlyImagePreview,
		imageDownloadStarted,
		resolveImageDownload
	};
}

function createMediaDownloadHarness(functionName, resultField) {
	const context = vm.createContext({
		console: {
			warn() {}
		},
		fetch: async function(url, options) {
			if (url === 'https://download.example/media') {
				const error = new Error('stopped');
				error.name = 'AbortError';
				throw error;
			}
			return {
				ok: true,
				headers: {
					get() {
						return 'application/json';
					}
				},
				text: async function() {
					return JSON.stringify({
						data: [{
							url: 'https://download.example/media'
						}]
					});
				}
			};
		},
		fetchWithTimeout: async function() {
			return context.fetch('https://api.example/generate');
		},
		mergeParams() {},
		providers: {
			openai: {
				buildImageRequest() {
					return {
						url: 'https://api.example/generate',
						headers: {},
						body: {}
					};
				},
				buildVideoRequest() {
					return {
						url: 'https://api.example/generate',
						headers: {},
						body: {}
					};
				}
			}
		}
	});
	const sharedSource = fs.readFileSync(path.join(__dirname, '..', 'src', 'modules', 'shared.js'), 'utf8');
	const functionSource = extractFunctionDeclaration(sharedSource, functionName);
	new vm.Script(`async ${functionSource}\nglobalThis.__mediaDownload = ${functionName};`, {
		filename: sharedSource
	}).runInContext(context);
	return context.__mediaDownload;
}

function createHandleSendFinallyRaceHarness() {
	let resolveLoadSession;
	let signalLoadSessionStarted;
	const loadSessionPromise = new Promise(function(resolve) {
		resolveLoadSession = resolve;
	});
	const loadSessionStarted = new Promise(function(resolve) {
		signalLoadSessionStarted = resolve;
	});
	let refreshUICount = 0;
	const context = vm.createContext({
		AbortController,
		currentSession: {
			id: 'session-1',
			messages: []
		},
		defaultSelectedEndpointParams: {},
		lastUserMessage: '',
		pendingAttachments: [],
		selectedEndpoints: ['endpoint-1'],
		sessionGenerations: new Map(),
		addMessage: async function(sessionId, role, content) {
			if (role === 'user') context.currentSession.messages.push({
				role,
				content
			});
		},
		appendUserMessage() {},
		callAllModels: async function() {
			return [];
		},
		clearAttachments() {},
		clearInput() {},
		createSession: async function() {
			throw new Error('existing session must be reused');
		},
		findModelById() {
			return null;
		},
		getGroups() {
			return [];
		},
		getInputMessage: async function() {
			return [{
				type: 'text',
				text: 'Hello'
			}];
		},
		getSessionAbortController() {
			return new AbortController();
		},
		isSessionInvalidated: null,
		loadSession: async function() {
			signalLoadSessionStarted();
			return loadSessionPromise;
		},
		normalizeMessageContent(content) {
			return content;
		},
		renderSelectedEndpoints() {},
		resolveNodeConfig() {
			return {
				type: 'chat'
			};
		},
		reorderCardsBySpeed() {},
		reorderSelectorTagsBySpeed() {},
		setButtonState() {},
		showThinkingCards() {},
		toOpenAIContent(content) {
			return content;
		},
		updateStreamingCard() {},
		refreshUI: async function() {
			refreshUICount += 1;
		},
		$$() {
			return [];
		}
	});
	const apiSource = fs.readFileSync(apiSourcePath, 'utf8');
	const mainSource = fs.readFileSync(mainSourcePath, 'utf8');
	const harnessSource = ['const invalidatedSessionIds = new Set();',
		extractFunctionDeclaration(apiSource, 'invalidateSession'),
		extractFunctionDeclaration(apiSource, 'isSessionInvalidated'), 'async ' + extractFunctionDeclaration(mainSource, 'handleSend'), 'globalThis.__finallyRaceApi = { handleSend, invalidateSession, getCurrentSession() { return currentSession; } };'
	].join('\n');
	new vm.Script(harnessSource, {
		filename: mainSourcePath
	}).runInContext(context);
	return {
		api: context.__finallyRaceApi,
		loadSessionStarted,
		resolveLoadSession,
		getRefreshUICount() {
			return refreshUICount;
		},
		setCurrentSession(session) {
			context.currentSession = session;
		}
	};
}

function createCallAllModelsHarness(options = {}) {
	const generationStarts = [];
	const callApiCalls = [];
	const endpointParams = options.endpointParams || {};
	const context = vm.createContext({
		AbortController,
		Date,
		currentSession: options.currentSession === undefined ? {
			id: 'session-1'
		} : cloneJson(options.currentSession),
		defaultSelectedEndpointParams: cloneJson(options.workspaceParams || {}),
		findModelById() {
			return {
				node: {
					id: 'endpoint-1',
					modelId: 'model-1'
				}
			};
		},
		isSessionInvalidated: null,
		clearSessionGenerations() {},
		getSessionGenerations(sessionId) {
			if (!context.sessionGenerations.has(sessionId)) context.sessionGenerations.set(sessionId, new Map());
			return context.sessionGenerations.get(sessionId);
		},
		callAPI: async function(style, baseUrl, apiKey, model, messages, onChunk, signal, params, isFullUrl) {
			generationStarts.push('callAPI');
			callApiCalls.push({
				params: cloneJson(params || {})
			});
			if (options.abort) {
				onChunk({
					content: 'partial',
					thinking: '',
					phase: 'content',
					firstContentTokenTime: Date.now()
				});
				const error = new Error('stopped');
				error.name = 'AbortError';
				throw error;
			}
			return {
				content: '',
				thinking: '',
				thinkingDuration: null
			};
		},
		renderSelectedEndpoints() {},
		resolveNodeConfig() {
			return {
				style: 'openai',
				baseUrl: '',
				key: '',
				params: cloneJson(endpointParams)
			};
		},
		selectedEndpoints: [],
		sessionGenerations: new Map(),
		updateCardStatus() {}
	});
	const apiSource = fs.readFileSync(apiSourcePath, 'utf8');
	const selectedSource = fs.readFileSync(selectedEndpointsSourcePath, 'utf8');
	const sharedSource = fs.readFileSync(path.join(__dirname, '..', 'src', 'modules', 'shared.js'), 'utf8');
	const harnessSource = ['const invalidatedSessionIds = new Set();',
		extractFunctionDeclaration(apiSource, 'invalidateSession'),
		extractFunctionDeclaration(apiSource, 'isSessionInvalidated'),
		extractFunctionDeclaration(sharedSource, 'setOwnEnumerableDataProperty'),
		extractFunctionDeclaration(selectedSource, 'hasOwnEndpointParams'),
		extractFunctionDeclaration(selectedSource, 'readOwnEndpointParams'),
		extractFunctionDeclaration(sharedSource, 'callAllModels'), 'globalThis.__callAllModelsApi = { callAllModels, invalidateSession };'
	].join('\n');
	new vm.Script(harnessSource, {
		filename: sharedSource
	}).runInContext(context);
	return {
		api: context.__callAllModelsApi,
		callApiCalls,
		generationStarts
	};
}

function createSessionDeleteHarness() {
	const events = [];
	const buttonStates = [];
	let rejectDeleteSession;
	let resolveDeleteSession;
	const deleteSessionPromise = new Promise(function(resolve, reject) {
		resolveDeleteSession = resolve;
		rejectDeleteSession = reject;
	});
	const context = vm.createContext({
		currentSession: {
			id: 'session-1'
		},
		deleteSession() {
			events.push('deleteSession');
			return deleteSessionPromise;
		},
		deleteSessionGenerations() {
			events.push('deleteSessionGenerations');
		},
		setButtonState(sendDisabled, stopEnabled) {
			buttonStates.push({
				sendDisabled,
				stopEnabled
			});
		},
		refreshUI: async function() {
			events.push('refreshUI');
		}
	});
	const apiSource = fs.readFileSync(apiSourcePath, 'utf8');
	const mainSource = fs.readFileSync(mainSourcePath, 'utf8');
	const sessionInvalidationSource = apiSource.slice(0, apiSource.indexOf('function getSessionGenerations'));
	const handleSessionDeleteSource = extractFunctionDeclaration(mainSource, 'handleSessionDelete');
	new vm.Script(`${sessionInvalidationSource}\nasync ${handleSessionDeleteSource}\nglobalThis.__sessionDeleteApi = { handleSessionDelete, isSessionInvalidated };`, {
		filename: mainSourcePath
	}).runInContext(context);
	return {
		events,
		buttonStates,
		handleSessionDelete: context.__sessionDeleteApi.handleSessionDelete,
		isSessionInvalidated: context.__sessionDeleteApi.isSessionInvalidated,
		rejectDeleteSession,
		resolveDeleteSession
	};
}

function createShowThinkingCardsHarness() {
	const removed = {
		sessionItem: false,
		responseCard: false
	};
	const sessionItem = {
		remove() {
			removed.sessionItem = true;
		}
	};
	const responseCard = {
		remove() {
			removed.responseCard = true;
		}
	};
	const container = {
		addChild() {}
	};
	const hint = {
		dataset: {},
		appendChild() {},
		querySelectorAll() {
			return [];
		}
	};
	const context = vm.createContext({
		document: {
			querySelector(selector) {
				assert.equal(selector, '.msg.list');
				return container;
			}
		},
		findModelById() {
			return {
				ancestors: [],
				node: {
					name: 'Endpoint'
				}
			};
		},
		fromTemplate() {
			return {
				dataset: {},
				querySelector() {
					return {
						addEventListener() {},
						classList: {
							add() {}
						}
					};
				}
			};
		},
		ensureStreamingHint() {
			return hint;
		},
		mk() {
			return {
				dataset: {},
				appendChild() {}
			};
		},
		scrollToBottom() {},
		$: function(selector, ctx) {
			if (selector === '.msg.list') return container;
			if (selector === '.response .name') return {
				textContent: ''
			};
			return null;
		},
		$$: function(selector, ctx) {
			if (!ctx) return [sessionItem, responseCard];
			assert.equal(ctx, container);
			return [responseCard];
		}
	});
	const mainSource = fs.readFileSync(mainSourcePath, 'utf8');
	const showSource = extractFunctionDeclaration(mainSource, 'showThinkingCards');
	new vm.Script(`${showSource}\nglobalThis.__showThinkingCards = showThinkingCards;`, {
		filename: mainSourcePath
	}).runInContext(context);
	return {
		showThinkingCards: context.__showThinkingCards,
		removed
	};
}

function createStoreHarness(initialTree) {
	let saveCount = 0;
	let nextGeneratedId = 0;
	const context = vm.createContext({
		console,
		generateUUID() {
			nextGeneratedId += 1;
			return `generated-${nextGeneratedId}`;
		},
		storage: {
			mode: 'browser',
			async saveEndpoints() {
				saveCount += 1;
			}
		}
	});
	const source = fs.readFileSync(storeSourcePath, 'utf8');
	const exposedSource = `${source}\n
globalThis.__storeTestApi = {
	addNode,
	batchAddNodes,
	cloneNode,
	migrateEndpoints,
	normalizeEndpointFullUrlFlags,
	resolveNodeConfig,
		hasPlainParamsPrototype(nodeId) {
			const node = findNodeInTree(endpointsData.nodes, nodeId);
			return !!node && (!Object.prototype.hasOwnProperty.call(node, 'params') || node.params === null || Object.getPrototypeOf(node.params) === Object.getPrototypeOf(JSON.parse('{}')));
		},
		hasPlainResolvedParamsPrototype(nodeId) {
			const config = resolveNodeConfig(nodeId);
			return !!config && Object.getPrototypeOf(config.params) === Object.getPrototypeOf(JSON.parse('{}'));
		},
	updateNode,
	reorderNode,
	moveNodeAsChild,
	setEndpointsData(data) {
		endpointsData = data;
	},
	getEndpointsData() {
		return endpointsData;
	}
};`;
	new vm.Script(exposedSource, {
		filename: storeSourcePath
	}).runInContext(context);
	context.__storeTestApi.setEndpointsData(initialTree);
	return {
		api: context.__storeTestApi,
		getSaveCount() {
			return saveCount;
		}
	};
}

function createSelectedEndpointsHarness(options) {
	const storageValues = new Map();
	if (options.workspaceRaw !== null) storageValues.set('defaultSelectedEndpointParams', options.workspaceRaw);
	const setItemErrors = new Map(options.setItemErrors || []);
	const removeItemErrors = new Map(options.removeItemErrors || []);
	let nextSetItemError = null;
	let nextRemoveItemError = null;
	let setItemCallCount = 0;
	let removeItemCallCount = 0;
	let updateSessionCallCount = 0;
	let updateSessionMutated = false;
	const localStorage = {
		getItem(key) {
			return storageValues.has(key) ? storageValues.get(key) : null;
		},
		setItem(key, value) {
			setItemCallCount += 1;
			const error = nextSetItemError || setItemErrors.get(setItemCallCount);
			nextSetItemError = null;
			if (error) throw error;
			storageValues.set(key, String(value));
		},
		removeItem(key) {
			removeItemCallCount += 1;
			const error = nextRemoveItemError || removeItemErrors.get(removeItemCallCount);
			nextRemoveItemError = null;
			if (error) throw error;
			storageValues.delete(key);
		}
	};
	let currentSession = cloneJson(options.currentSession);
	let savedSelectedEndpoints = null;
	const context = vm.createContext({
		console,
		currentSession,
		localStorage,
		selectedEndpoints: options.selectedEndpoints || [],
		sessionGenerations: new Map(),
		saveDefaultSelectedEndpoints(selectedEndpoints) {
			savedSelectedEndpoints = [...selectedEndpoints];
		},
		renderSelectedEndpoints() {},
		getGroups() {
			return [];
		},
		$() {
			return null;
		},
		document: {
			querySelector() {
				return null;
			}
		},
		updateSession: async function(sessionId, mutator) {
			updateSessionCallCount += 1;
			if (options.updateSession) {
				return options.updateSession({
					callIndex: updateSessionCallCount,
					sessionId,
					currentSession,
					mutator
				});
			}
			assert.equal(sessionId, currentSession.id);
			const previousSession = cloneJson(currentSession);
			mutator(currentSession);
			updateSessionMutated = true;
			Object.keys(currentSession).forEach(function(key) {
				delete currentSession[key];
			});
			Object.assign(currentSession, previousSession);
			throw options.updateSessionError;
		}
	});
	const source = fs.readFileSync(selectedEndpointsSourcePath, 'utf8');
	const exposedSource = source + '\n\nglobalThis.__selectedEndpointsTestApi = {\n\tpersistEndpointParamsTransaction,\n\ttoggleEndpointSelection,\n\tgetSelectedEndpoints() {\n\t\treturn [...selectedEndpoints];\n\t},\n\tgetDefaultSelectedEndpointParams() {\n\t\treturn JSON.parse(JSON.stringify(defaultSelectedEndpointParams));\n\t}\n};';
	new vm.Script(exposedSource, {
		filename: selectedEndpointsSourcePath
	}).runInContext(context);
	return {
		api: context.__selectedEndpointsTestApi,
		currentSession,
		setCurrentSession(session) {
			currentSession = cloneJson(session);
			context.currentSession = currentSession;
		},
		failNextSetItem(error) {
			nextSetItemError = error;
		},
		failNextRemoveItem(error) {
			nextRemoveItemError = error;
		},
		getSetItemCallCount() {
			return setItemCallCount;
		},
		getRemoveItemCallCount() {
			return removeItemCallCount;
		},
		getUpdateSessionCallCount() {
			return updateSessionCallCount;
		},
		getSavedSelectedEndpoints() {
			return savedSelectedEndpoints ? [...savedSelectedEndpoints] : null;
		},
		wasUpdateSessionMutated() {
			return updateSessionMutated;
		},
		localStorage
	};
}

function createDescendantTargetTree() {
	return {
		nodes: [{
			id: 'dragged',
			name: 'Dragged ancestor',
			children: [{
				id: 'target',
				name: 'Target descendant',
				children: []
			}]
		}, {
			id: 'sibling',
			name: 'Unrelated sibling',
			children: []
		}]
	};
}

function createGuardTree() {
	return {
		nodes: [{
			id: 'dragged',
			name: 'Dragged node',
			children: []
		}, {
			id: 'target',
			name: 'Target node',
			children: []
		}]
	};
}

function cloneJson(value) {
	return JSON.parse(JSON.stringify(value));
}

function countNodesById(nodes, nodeId) {
	return nodes.reduce((count, node) => {
		const childCount = countNodesById(node.children || [], nodeId);
		return count + (node.id === nodeId ? 1 : 0) + childCount;
	}, 0);
}

function assertRejectedWithoutChanges(result, harness, originalTree) {
	assert.equal(result, false);
	assert.deepEqual(harness.api.getEndpointsData(), originalTree);
	assert.equal(harness.getSaveCount(), 0);
}
class MiniClassList {
	constructor(element) {
		this.element = element;
		this.values = new Set();
	}
	add(...names) {
		names.forEach(name => this.values.add(name));
	}
	remove(...names) {
		names.forEach(name => this.values.delete(name));
	}
	contains(name) {
		return this.values.has(name) || this.element.className.split(/[\s,]+/).includes(name);
	}
	toggle(name, force) {
		const next = force === undefined ? !this.contains(name) : force;
		if (next) this.add(name);
		else this.remove(name);
		return next;
	}
}
class MiniElement {
	constructor(tagName, className = '') {
		this.tagName = tagName.toUpperCase();
		this.className = className;
		this.classList = new MiniClassList(this);
		this.children = [];
		this.parentNode = null;
		this.parentElement = null;
		this.style = {};
		this.dataset = {};
		this.value = '';
		this.checked = false;
		this.type = tagName === 'input' ? 'text' : '';
		this.name = '';
		this.textContent = '';
		this.childNodes = [];
		this.listeners = new Map();
	}
	get firstChild() {
		return this.children[0] || null;
	}
	appendChild(child) {
		if (child.parentNode) child.parentNode.removeChild(child);
		child.parentNode = this;
		child.parentElement = this;
		this.children.push(child);
		this.childNodes = this.children;
		return child;
	}
	insertBefore(child, reference) {
		if (child.parentNode) child.parentNode.removeChild(child);
		child.parentNode = this;
		child.parentElement = this;
		const index = this.children.indexOf(reference);
		if (index < 0) this.children.push(child);
		else this.children.splice(index, 0, child);
		this.childNodes = this.children;
		return child;
	}
	removeChild(child) {
		const index = this.children.indexOf(child);
		if (index >= 0) this.children.splice(index, 1);
		child.parentNode = null;
		child.parentElement = null;
		this.childNodes = this.children;
	}
	remove() {
		if (this.parentNode) this.parentNode.removeChild(this);
	}
	addEventListener(type, listener) {
		if (!this.listeners.has(type)) {
			const listeners = [];
			listeners.call = function(thisArg, event) {
				[...listeners].forEach(current => current.call(thisArg, event));
			};
			this.listeners.set(type, listeners);
		}
		const listeners = this.listeners.get(type);
		if (!listeners.includes(listener)) listeners.push(listener);
	}
	removeEventListener(type, listener) {
		const listeners = this.listeners.get(type);
		if (!listeners) return;
		const index = listeners.indexOf(listener);
		if (index >= 0) listeners.splice(index, 1);
	}
	focus() {
		this.focused = true;
	}
	dispatch(type, init = {}) {
		const event = Object.assign({
			type,
			currentTarget: this,
			target: this,
			preventDefault() {
				this.defaultPrevented = true;
			}
		}, init);
		[...(this.listeners.get(type) || [])].forEach(listener => listener.call(this, event));
		const propertyHandler = this['on' + type];
		if (typeof propertyHandler === 'function') propertyHandler.call(this, event);
		return event;
	}
	closest(selector) {
		let current = this;
		while (current) {
			if (current.matches(selector)) return current;
			current = current.parentElement;
		}
		return null;
	}
	matches(selector) {
		const simple = selector.split(':')[0];
		if (simple && simple !== '*' && !this.matchesSimple(simple)) return false;
		if (selector.includes(':checked') && !this.checked) return false;
		return true;
	}
	matchesSimple(selector) {
		const tagMatch = selector.match(/^[a-z][a-z0-9-]*/i);
		if (tagMatch && this.tagName !== tagMatch[0].toUpperCase()) return false;
		for (const className of selector.matchAll(/\.([\w-]+)/g)) {
			if (!this.classList.contains(className[1])) return false;
		}
		for (const attr of selector.matchAll(/\[([\w-]+)(?:=["']([^"']*)["'])?\]/g)) {
			const actual = this[attr[1]] === undefined ? '' : String(this[attr[1]]);
			if (attr[2] !== undefined && actual !== attr[2]) return false;
		}
		return true;
	}
	querySelector(selector) {
		const found = this.querySelectorAll(selector)[0] || null;
		if (found) return found;
		if (selector === '.inheriting-val') {
			const placeholder = new MiniElement('span', 'inheriting-val');
			this.appendChild(placeholder);
			return placeholder;
		}
		return null;
	}
	querySelectorAll(selector) {
		const parts = selector.trim().split(/\s+/);
		const result = [];
		const visit = element => {
			for (const child of element.children) {
				if (child.matches(parts[parts.length - 1])) {
					let ancestor = child.parentElement;
					let index = parts.length - 2;
					while (ancestor && index >= 0) {
						if (ancestor.matches(parts[index])) index -= 1;
						ancestor = ancestor.parentElement;
					}
					if (index < 0) result.push(child);
				}
				visit(child);
			}
		};
		visit(this);
		return result;
	}
}

function createEditDialogHarness(tree, options = {}) {
	const dialog = new MiniElement('dialog', 'editing endpoint');
	const header = new MiniElement('header');
	const title = new MiniElement('h3');
	const sourceHint = new MiniElement('div', 'inherit-source hint');
	const tabContainer = new MiniElement('div', 'tab container');
	const singleTab = new MiniElement('label', 'btn tab');
	const singleRadio = new MiniElement('input');
	singleRadio.name = 'dialog-tab';
	singleRadio.value = 'single';
	singleRadio.type = 'radio';
	singleRadio.checked = true;
	singleTab.appendChild(singleRadio);
	tabContainer.appendChild(singleTab);
	const form = new MiniElement('form');
	const nameInput = new MiniElement('input');
	nameInput.name = 'name';
	const modelInput = new MiniElement('input');
	modelInput.name = 'model-id';
	const typeField = new MiniElement('span', 'field-control');
	const typeGroup = new MiniElement('div', 'btn-group');
	const typeInputs = ['', 'chat', 'embedding', 'tts'].map(value => {
		const label = new MiniElement('label', 'option btn');
		const input = new MiniElement('input');
		input.name = 'type';
		input.value = value;
		input.type = 'radio';
		label.appendChild(input);
		if (value === '') label.appendChild(new MiniElement('span', 'inheriting-val'));
		typeGroup.appendChild(label);
		return input;
	});
	const typeHint = new MiniElement('span', 'hint');
	typeField.appendChild(typeGroup);
	typeField.appendChild(typeHint);
	const styleGroup = new MiniElement('div', 'btn-group');
	const styleInputs = ['', 'openai', 'claude', 'responses'].map(value => {
		const label = new MiniElement('label', 'option btn');
		const input = new MiniElement('input');
		input.name = 'style';
		input.value = value;
		input.type = 'radio';
		label.appendChild(input);
		if (value === '') label.appendChild(new MiniElement('span', 'inheriting-val'));
		styleGroup.appendChild(label);
		return input;
	});
	const urlRow = new MiniElement('span', 'url-row');
	const urlFlex = new MiniElement('span', 'flex');
	const urlInput = new MiniElement('input');
	urlInput.name = 'url';
	const pathSuffix = new MiniElement('span', 'path-suffix');
	const fullUrlToggle = new MiniElement('label', 'btn direct-url toggle');
	const fullUrlCheckbox = new MiniElement('input');
	fullUrlCheckbox.type = 'checkbox';
	fullUrlToggle.appendChild(fullUrlCheckbox);
	urlFlex.appendChild(urlInput);
	urlFlex.appendChild(pathSuffix);
	urlFlex.appendChild(fullUrlToggle);
	urlRow.appendChild(urlFlex);
	const originalDialogQuerySelector = dialog.querySelector.bind(dialog);
	dialog.querySelector = selector => selector === '.path-suffix' ? pathSuffix : originalDialogQuerySelector(selector);
	const keyInput = new MiniElement('input');
	keyInput.name = 'apikey';
	const apiToggle = new MiniElement('label', 'toggle apikey');
	const apiCheckbox = new MiniElement('input');
	apiCheckbox.type = 'checkbox';
	apiToggle.appendChild(apiCheckbox);
	const remarkInput = new MiniElement('input');
	remarkInput.name = 'remark';
	const paramSection = new MiniElement('div', 'param section');
	const paramList = new ModelParamElement('div', 'param-control list');
	paramSection.appendChild(paramList);
	const okButton = new MiniElement('button', 'ok');
	okButton.click = function() {
		if (this.onclick) this.onclick();
	};
	const closeButton = new MiniElement('button', 'close');
	form.appendChild(nameInput);
	form.appendChild(modelInput);
	form.appendChild(typeField);
	form.appendChild(styleGroup);
	form.appendChild(urlRow);
	form.appendChild(keyInput);
	form.appendChild(apiToggle);
	form.appendChild(remarkInput);
	form.appendChild(paramSection);
	header.appendChild(title);
	header.appendChild(sourceHint);
	dialog.appendChild(header);
	dialog.appendChild(tabContainer);
	dialog.appendChild(form);
	dialog.appendChild(okButton);
	dialog.appendChild(closeButton);
	dialog.show = function() {
		this.open = true;
	};
	dialog.close = function() {
		this.open = false;
	};

	function findNodeWithAncestors(nodes, nodeId, ancestors = []) {
		for (const node of nodes) {
			if (node.id === nodeId) return {
				node,
				ancestors
			};
			if (node.children) {
				const found = findNodeWithAncestors(node.children, nodeId, [...ancestors, node]);
				if (found) return found;
			}
		}
		return null;
	}
	const template = createModelParamTemplateFromLayout();
	const document = {
		querySelector(selector) {
			if (selector === 'dialog.editing.endpoint') return dialog;
			if (selector === '#model-param-row') return template;
			return dialog.querySelector(selector);
		},
		createElement(tagName) {
			return new MiniElement(tagName);
		},
		addEventListener() {},
		removeEventListener() {}
	};
	const context = vm.createContext({
		console,
		document,
		doc: document,
		dialog,
		endpointsData: tree,
		findNodeWithAncestors,
		getNode(nodeId) {
			const result = findNodeWithAncestors(tree.nodes, nodeId);
			return result ? result.node : null;
		},
		detectModelType(name) {
			return name && name.includes('embedding') ? 'embedding' : 'chat';
		},
		resolveNodeConfig(nodeId) {
			const result = findNodeWithAncestors(tree.nodes, nodeId);
			if (!result) return null;
			const config = {};
			['baseUrl', 'style', 'key', 'modelId', 'type'].forEach(field => {
				config[field] = result.node[field] || '';
			});
			config.params = {};
			if (result.node.params) Object.assign(config.params, result.node.params);
			for (let index = result.ancestors.length - 1; index >= 0; index -= 1) {
				const ancestor = result.ancestors[index];
				['baseUrl', 'style', 'key', 'modelId', 'type'].forEach(field => {
					if (!config[field] && ancestor[field]) config[field] = ancestor[field];
				});
				if (ancestor.params) {
					Object.entries(ancestor.params).forEach(([key, value]) => {
						if (!Object.hasOwn(config.params, key)) config.params[key] = value;
					});
				}
			}
			let fullUrl;
			for (const candidate of [result.node, ...result.ancestors.slice().reverse()]) {
				if (Object.hasOwn(candidate, 'isFullUrl')) {
					fullUrl = !!candidate.isFullUrl;
					break;
				}
			}
			config.isFullUrl = fullUrl || false;
			if (!config.type) config.type = context.detectModelType(config.modelId);
			if (!config.style) config.style = 'openai';
			return config;
		},
		$(selector, ctx = dialog) {
			if (selector === 'dialog.editing.endpoint') return dialog;
			return ctx.querySelector(selector);
		},
		setValues(ctx, values) {
			Object.entries(values).forEach(([selector, value]) => {
				ctx.querySelector(selector).value = value || '';
			});
		},
		onClick(handlers, ctx = dialog) {
			Object.entries(handlers).forEach(([selector, handler]) => {
				const target = ctx.querySelector(selector);
				if (target) target.onclick = handler;
			});
		},
		getParamDefs(type, style) {
			return options.getParamDefs ? options.getParamDefs(type, style) : endpointParamDefinitions(type, style);
		},
		fromTemplate(templateId, selector) {
			assert.equal(templateId, 'model-param-row');
			return template.content.cloneNode(true).querySelector(selector);
		}
	});
	const attachmentsSource = fs.readFileSync(attachmentsSourcePath, 'utf8');
	const sharedSource = fs.readFileSync(path.join(__dirname, '..', 'src', 'modules', 'shared.js'), 'utf8');
	const uiUtilsSource = fs.readFileSync(path.join(__dirname, '..', 'src', 'modules', 'ui-utils.js'), 'utf8');
	const source = [
		extractFunctionDeclaration(sharedSource, 'setOwnEnumerableDataProperty'),
		extractFunctionDeclaration(attachmentsSource, 'addInheritIcon'),
		extractFunctionDeclaration(attachmentsSource, 'shouldSaveIsFullUrl'),
		extractFunctionDeclaration(uiUtilsSource, 'createModelParamValueControl'),
		extractFunctionDeclaration(uiUtilsSource, 'renderModelParamControls'),
		extractFunctionDeclaration(uiUtilsSource, 'modelParamNumberError'),
		extractFunctionDeclaration(uiUtilsSource, 'isValidModelParamNumber'),
		extractFunctionDeclaration(uiUtilsSource, 'collectModelParamControls'),
		extractFunctionDeclaration(attachmentsSource.slice(attachmentsSource.indexOf('function clearBatchDragDrop')), 'clearBatchDragDrop'),
		extractFunctionDeclaration(attachmentsSource.slice(attachmentsSource.indexOf('function setupBatchDragDrop')), 'setupBatchDragDrop'),
		extractFunctionDeclaration(attachmentsSource, 'showEditGroupDialog'), 'globalThis.__showEditGroupDialog = showEditGroupDialog;', 'globalThis.__setupBatchDragDrop = setupBatchDragDrop;'
	].join('\n');
	new vm.Script(source, {
		filename: attachmentsSourcePath
	}).runInContext(context);
	return {
		context,
		dialog,
		urlInput,
		pathSuffix,
		fullUrlCheckbox,
		okButton,
		paramList,
		getParamRow(key) {
			return paramList.querySelectorAll('.registered.param-row').find(row => row.dataset.paramKey === key);
		},
		collectParams(originalParams = {}) {
			return context.collectModelParamControls(paramList, originalParams);
		},
		selectParamDecision(key, value) {
			const row = paramList.querySelectorAll('.registered.param-row').find(candidate => candidate.dataset.paramKey === key);
			const radios = row.querySelectorAll('input[type="radio"]');
			radios.forEach(radio => {
				radio.checked = radio.value === value;
			});
			const target = radios.find(radio => radio.value === value);
			target.dispatch('click');
		}
	};
}

function createTerminalStreamHarness(streamData) {
	const context = vm.createContext({
		AbortController,
		Document: function Document() {},
		HTMLElement: function HTMLElement() {},
		Response,
		TextDecoder,
		THINKING_TAGS: [],
		currentAbortController: null,
		document: {},
		fetchWithTimeout: async function() {
			return new Response(streamData, {
				status: 200,
				headers: {
					'content-type': 'text/event-stream'
				}
			});
		},
		mergeParams() {}
	});
	context.HTMLElement.prototype = {};
	context.Document.prototype = {};
	const providersSource = fs.readFileSync(path.join(__dirname, '..', 'src', 'modules', 'providers.js'), 'utf8');
	const sharedSource = fs.readFileSync(path.join(__dirname, '..', 'src', 'modules', 'shared.js'), 'utf8');
	const source = [
		providersSource,
		extractFunctionDeclaration(sharedSource, 'createInitialState'),
		extractFunctionDeclaration(sharedSource, 'createTagParser'),
		extractFunctionDeclaration(sharedSource, 'processWithTagParser'),
		extractFunctionDeclaration(sharedSource, 'handleParsedChunk'),
		'async ' + extractFunctionDeclaration(sharedSource, 'processSSEStream'),
		'async ' + extractFunctionDeclaration(sharedSource, 'callProvider'),
		'globalThis.__terminalStreamApi = { callProvider, processSSEStream, providers };'
	].join('\n');
	new vm.Script(source, {
		filename: path.join(__dirname, '..', 'src', 'modules', 'shared.js')
	}).runInContext(context);
	return context.__terminalStreamApi;
}

function createCallAllModelsTerminalHarness() {
	const context = vm.createContext({
		AbortController,
		Date,
		currentSession: {
			id: 'session-1'
		},
		selectedEndpoints: [],
		sessionGenerations: new Map(),
		callAPI: async function(style, baseUrl, apiKey, model, messages, onChunk) {
			onChunk({
				content: 'partial answer',
				thinking: 'partial reasoning',
				thinkingDuration: 12,
				phase: 'content',
				firstContentTokenTime: Date.now()
			});
			const error = new Error('响应因输出长度限制而不完整');
			error.state = {
				content: 'partial answer',
				thinking: 'partial reasoning',
				thinkingDuration: 12
			};
			throw error;
		},
		clearSessionGenerations() {},
		findModelById() {
			return {
				node: {
					id: 'endpoint-1',
					modelId: 'model-1'
				}
			};
		},
		getSessionGenerations(sessionId) {
			if (!context.sessionGenerations.has(sessionId)) context.sessionGenerations.set(sessionId, new Map());
			return context.sessionGenerations.get(sessionId);
		},
		hasOwnEndpointParams() {
			return false;
		},
		isSessionInvalidated() {
			return false;
		},
		readOwnEndpointParams() {
			return null;
		},
		renderSelectedEndpoints() {},
		resolveNodeConfig() {
			return {
				baseUrl: '',
				isFullUrl: false,
				key: '',
				params: {},
				style: 'openai'
			};
		},
		setOwnEnumerableDataProperty(target, key, value) {
			target[key] = value;
		},
		updateCardStatus() {}
	});
	const sharedSource = fs.readFileSync(path.join(__dirname, '..', 'src', 'modules', 'shared.js'), 'utf8');
	new vm.Script(`async ${extractFunctionDeclaration(sharedSource, 'callAllModels')}\nglobalThis.__callAllModels = callAllModels;`, {
		filename: sharedSource
	}).runInContext(context);
	return context.__callAllModels;
}

test('deleting a generating session invalidates it before aborting generation', () => {
	const harness = createGenerationApiHarness();
	const controller = new AbortController();
	harness.api.getSessionGenerations('session-1').set('endpoint-1', {
		abortController: controller,
		status: 'generating'
	});
	harness.api.invalidateSession('session-1');
	harness.api.deleteSessionGenerations('session-1');
	assert.equal(harness.api.isSessionInvalidated('session-1'), true);
	assert.equal(controller.signal.aborted, true);
});
test('stopping a session aborts its non-stream requests', () => {
	const harness = createGenerationApiHarness();
	const controller = harness.api.getSessionAbortController('session-1');
	harness.api.stopSessionGenerations('session-1');
	assert.equal(controller.signal.aborted, true);
});
test('stopping all generations aborts the active session non-stream requests', () => {
	const harness = createGenerationApiHarness();
	const controller = harness.api.getSessionAbortController('session-1');
	harness.api.stopAllGenerations();
	assert.equal(controller.signal.aborted, true);
});
test('overlapping non-stream sends retain the session abort controller until all sends finish', () => {
	const harness = createGenerationApiHarness();
	const firstController = harness.api.getSessionAbortController('session-1');
	const secondController = harness.api.getSessionAbortController('session-1');
	harness.api.finishSessionAbortController('session-1', firstController);
	harness.api.abortSessionRequests('session-1');
	assert.equal(firstController, secondController);
	assert.equal(secondController.signal.aborted, true);
});
test('non-stream requests receive the session signal and invalidated results skip UI and assistant persistence', async () => {
	const embeddingHarness = createCallEmbeddingSignalHarness();
	const signal = new AbortController().signal;
	await embeddingHarness.callEmbedding('openai', '', '', 'model-1', 'Hello', false, {}, signal);
	assert.equal(embeddingHarness.calls[0].options.signal, signal);
	const generationHarness = createNonStreamGenerationHarness();
	await generationHarness.api.handleSend();
	assert.equal(generationHarness.calls.embeddingSignal, generationHarness.controller.signal);
	assert.equal(generationHarness.calls.updateEmbedding, 0);
	assert.equal(generationHarness.calls.addAssistant, 0);
});
test('an aborted non-stream embedding that resolves successfully does not update its card or persist an assistant response', async () => {
	const harness = createDeferredNonStreamGenerationHarness();
	const sending = harness.api.handleSend();
	await harness.embeddingStarted;
	harness.controller.abort();
	harness.resolveEmbedding({
		embedding: [0.1],
		model: 'model-1'
	});
	await sending;
	assert.equal(harness.calls.embeddingSignal, harness.controller.signal);
	assert.equal(harness.controller.signal.aborted, true);
	assert.equal(harness.calls.updateEmbedding, 0);
	assert.equal(harness.calls.addAssistant, 0);
});
test('updateCardStatus skips queued DOM writes after its target session invalidates', () => {
	const harness = createUpdateCardStatusHarness();
	harness.api.updateCardStatus('endpoint-1', 'completed', null, null, 'session-1');
	harness.api.invalidateSession('session-1');
	harness.runNextAnimationFrame();
	assert.equal(harness.calls.cardSelectorMatches, 1);
	assert.deepEqual(harness.calls.domWrites, []);
});
test('updateCardStatus failed writes the error into the body content, not the header copy button', () => {
	const harness = createUpdateCardStatusHarness();
	harness.api.updateCardStatus('endpoint-1', 'failed', 'boom', null, 'session-1');
	harness.runNextAnimationFrame();
	// 错误信息必须进入正文 `.content`（`.one.response.msg > .content`），
	// 而不能误写进 header 里带 `content` class 的 `.copy.content` 复制按钮（它加载中被 display:none 隐藏）
	assert.ok(harness.calls.domWrites.includes('bodyContent.classList.add:failed'), '正文 content 必须标记 failed');
	const failChildren = harness.bodyContent.children.map(c => c.className);
	assert.ok(failChildren.includes('fail-icon'), '✗ 图标必须渲染在正文 content');
	assert.ok(failChildren.includes('fail-msg'), '错误文本必须渲染在正文 content');
	assert.ok(harness.calls.domWrites.includes('copyButton.classList.add:hidden'), '复制按钮应被隐藏');
	assert.ok(harness.calls.domWrites.includes('mk:span:fail-icon'), 'fail-icon 由 mk 创建');
	assert.ok(harness.calls.domWrites.includes('mk:span:fail-msg'), 'fail-msg 由 mk 创建');
});
test('an invalidated session does not start a new chat generation', async () => {
	const harness = createGenerationStartHarness();
	harness.api.invalidateSession('session-1');
	await harness.api.handleSend();
	assert.equal(harness.api.isSessionInvalidated('session-1'), true);
	assert.equal(harness.generationStarts.length, 0);
});
test('handleSessionDelete invalidates and aborts before its deferred storage deletion resolves', async () => {
	const harness = createSessionDeleteHarness();
	const deletion = harness.handleSessionDelete('session-1');
	assert.deepEqual(harness.events, ['deleteSessionGenerations', 'deleteSession']);
	assert.equal(harness.isSessionInvalidated('session-1'), true);
	harness.resolveDeleteSession();
	await deletion;
	assert.deepEqual(harness.buttonStates, [{
		sendDisabled: false,
		stopEnabled: false
	}]);
});
test('handleSessionDelete keeps invalidation when storage deletion rejects', async () => {
	const harness = createSessionDeleteHarness();
	const deletion = harness.handleSessionDelete('session-1');
	const deleteError = new Error('storage delete failed');
	harness.rejectDeleteSession(deleteError);
	await assert.rejects(deletion, deleteError);
	assert.equal(harness.isSessionInvalidated('session-1'), true);
});
test('deletion during user-message persistence prevents a late chat start', async () => {
	let resolveUserMessage;
	let started = false;
	const userMessagePersistence = new Promise(function(resolve) {
		resolveUserMessage = resolve;
	});
	const harness = createGenerationStartHarness({
		afterUserMessage() {
			started = true;
			return userMessagePersistence;
		}
	});
	const sending = harness.api.handleSend();
	while (!started) await Promise.resolve();
	harness.api.invalidateSession('session-1');
	resolveUserMessage();
	await sending;
	assert.equal(harness.generationStarts.length, 0);
});
test('callAllModels rejects an invalidated session before starting requests', async () => {
	const harness = createCallAllModelsHarness();
	harness.api.invalidateSession('session-1');
	const results = await harness.api.callAllModels([], ['endpoint-1'], [], () => {}, 'session-1');
	assert.equal(results.length, 0);
	assert.equal(harness.generationStarts.length, 0);
});
test('callProvider handles an HTTP 200 JSON response without assigning to a const', async () => {
	const callProvider = createCallProviderHarness();
	const chunks = [];
	const provider = {
		buildRequest() {
			return {
				url: 'https://api.example/chat',
				headers: {},
				body: {}
			};
		},
		needsTagParsing: false
	};
	const state = await callProvider(provider, '', '', '', [], chunk => chunks.push(chunk), null, 'openai', {}, false);
	assert.equal(state.content, 'Hello');
	assert.equal(chunks.length, 1);
});
test('callProvider rethrows AbortError so chat dispatch can mark it stopped', async () => {
	const callProvider = createCallProviderHarness({
		abort: true
	});
	const provider = {
		buildRequest() {
			return {
				url: 'https://api.example/chat',
				headers: {},
				body: {}
			};
		},
		needsTagParsing: false
	};
	await assert.rejects(callProvider(provider, '', '', '', [], () => {}, new AbortController().signal, 'openai', {}, false), {
		name: 'AbortError'
	});
});
test('callAllModels marks a chat AbortError as stopped and preserves partial content', async () => {
	const harness = createCallAllModelsHarness({
		abort: true
	});
	const [result] = await harness.api.callAllModels([], ['endpoint-1'], [], () => {}, 'session-1');
	assert.equal(result.status, 'stopped');
	assert.equal(result.content, 'partial');
});
test('handleSend finally does not restore a session invalidated while loading it', async () => {
	const harness = createHandleSendFinallyRaceHarness();
	const sending = harness.api.handleSend();
	await harness.loadSessionStarted;
	harness.setCurrentSession(null);
	harness.api.invalidateSession('session-1');
	harness.resolveLoadSession({
		id: 'session-1',
		messages: []
	});
	await sending;
	assert.equal(harness.api.getCurrentSession(), null);
	assert.equal(harness.getRefreshUICount(), 0);
});
test('image generation exposes the initial image before URL persistence finishes', async () => {
	const harness = createEarlyImagePreviewHarness();
	const previews = [];
	const generation = harness.callImageGeneration('openai', '', '', '', [], false, {}, null, function(result) {
		previews.push(result.url);
	});
	await harness.imageDownloadStarted;
	assert.deepEqual(previews, ['https://download.example/media']);
	harness.resolveImageDownload({
		ok: true,
		blob: async function() {
			return new Blob(['image'], {
				type: 'image/png'
			});
		}
	});
	await generation;
});
test('image and video download AbortError propagate instead of falling back to the source URL', async () => {
	const imageGeneration = createMediaDownloadHarness('callImageGeneration', 'url');
	const videoGeneration = createMediaDownloadHarness('callVideoGeneration', 'videoUrl');
	const signal = new AbortController().signal;
	await assert.rejects(imageGeneration('openai', '', '', '', [], false, {}, signal), {
		name: 'AbortError'
	});
	await assert.rejects(videoGeneration('openai', '', '', '', [], false, {}, signal), {
		name: 'AbortError'
	});
});
test('deselecting an endpoint clears its workspace parameters without changing session parameters', () => {
	const endpointId = 'endpoint-1';
	const sessionBefore = {
		id: 'session-1',
		modelParams: {
			[endpointId]: {
				temperature: 0.6
			}
		}
	};
	const harness = createSelectedEndpointsHarness({
		currentSession: sessionBefore,
		selectedEndpoints: [endpointId, 'other-endpoint'],
		workspaceRaw: '{"endpoint-1":{"temperature":0.2},"other-endpoint":{"topP":0.4}}'
	});
	harness.api.toggleEndpointSelection(endpointId, true);
	assert.deepEqual(cloneJson(harness.api.getDefaultSelectedEndpointParams()), {
		'other-endpoint': {
			topP: 0.4
		}
	});
	assert.deepEqual(harness.currentSession.modelParams, sessionBefore.modelParams);
	assert.deepEqual(cloneJson(harness.api.getSelectedEndpoints()), ['other-endpoint']);
	assert.deepEqual(cloneJson(harness.getSavedSelectedEndpoints()), ['other-endpoint']);
	assert.equal(harness.localStorage.getItem('defaultSelectedEndpointParams'), '{"other-endpoint":{"topP":0.4}}');
});
test('deselecting an endpoint without workspace parameters does not write workspace storage', () => {
	const harness = createSelectedEndpointsHarness({
		currentSession: {
			id: 'session-1',
			modelParams: {
				'endpoint-1': {
					temperature: 0.6
				}
			}
		},
		selectedEndpoints: ['endpoint-1'],
		workspaceRaw: '{}'
	});
	harness.api.toggleEndpointSelection('endpoint-1', true);
	assert.deepEqual(cloneJson(harness.api.getDefaultSelectedEndpointParams()), {});
	assert.equal(harness.getSetItemCallCount(), 0);
	assert.equal(harness.localStorage.getItem('defaultSelectedEndpointParams'), '{}');
});
test('workspace/session parameter transaction restores workspace state after save and reset session failures', async () => {
	const endpointId = 'endpoint-1';
	const workspaceBefore = {
		[endpointId]: {
			temperature: 0.2,
			topP: 0.9
		}
	};
	const rawWorkspaceBefore = '{\n  "endpoint-1": { "temperature": 0.2, "topP": 0.9 }\n}';
	const sessionBefore = {
		id: 'session-1',
		modelParams: {
			[endpointId]: {
				temperature: 0.6
			},
			'other-endpoint': {
				topP: 0.4
			}
		}
	};
	const harness = createSelectedEndpointsHarness({
		currentSession: sessionBefore,
		updateSessionError: new Error('session update failed'),
		workspaceRaw: rawWorkspaceBefore
	});
	await assert.rejects(harness.api.persistEndpointParamsTransaction(endpointId, {
		temperature: 1.1
	}, sessionBefore.id, function(session) {
		if (!session.modelParams) session.modelParams = {};
		session.modelParams[endpointId] = {
			temperature: 1.1
		};
	}), /session update failed/);
	assert.equal(harness.wasUpdateSessionMutated(), true);
	assert.deepEqual(cloneJson(harness.api.getDefaultSelectedEndpointParams()), workspaceBefore);
	assert.equal(harness.localStorage.getItem('defaultSelectedEndpointParams'), rawWorkspaceBefore);
	assert.deepEqual(harness.currentSession.modelParams, sessionBefore.modelParams);
	await assert.rejects(harness.api.persistEndpointParamsTransaction(endpointId, undefined, sessionBefore.id, function(session) {
		delete session.modelParams[endpointId];
		if (Object.keys(session.modelParams).length === 0) delete session.modelParams;
	}), /session update failed/);
	assert.deepEqual(cloneJson(harness.api.getDefaultSelectedEndpointParams()), workspaceBefore);
	assert.equal(harness.localStorage.getItem('defaultSelectedEndpointParams'), rawWorkspaceBefore);
	assert.deepEqual(harness.currentSession.modelParams, sessionBefore.modelParams);
	assert.equal(harness.getUpdateSessionCallCount(), 2);
});
test('workspace/session parameter transaction does not update the session when localStorage rejects the workspace write', async () => {
	const endpointId = 'endpoint-1';
	const workspaceBefore = {
		[endpointId]: {
			temperature: 0.2
		}
	};
	const rawWorkspaceBefore = '{"endpoint-1":{"temperature":0.2}}';
	const sessionBefore = {
		id: 'session-1',
		modelParams: {
			[endpointId]: {
				temperature: 0.6
			}
		}
	};
	const harness = createSelectedEndpointsHarness({
		currentSession: sessionBefore,
		updateSessionError: new Error('updateSession must not run'),
		workspaceRaw: rawWorkspaceBefore
	});
	harness.failNextSetItem(new Error('localStorage write failed'));
	await assert.rejects(harness.api.persistEndpointParamsTransaction(endpointId, {
		temperature: 1.1
	}, sessionBefore.id, function(session) {
		session.modelParams[endpointId] = {
			temperature: 1.1
		};
	}), /localStorage write failed/);
	assert.equal(harness.getUpdateSessionCallCount(), 0);
	assert.deepEqual(cloneJson(harness.api.getDefaultSelectedEndpointParams()), workspaceBefore);
	assert.equal(harness.localStorage.getItem('defaultSelectedEndpointParams'), rawWorkspaceBefore);
	assert.deepEqual(harness.currentSession.modelParams, sessionBefore.modelParams);
});
test('workspace/session parameter transaction serializes an earlier session failure before a later save', async () => {
	const endpointId = 'endpoint-1';
	let rejectFirstSessionUpdate;
	let firstSessionUpdateStarted;
	const firstSessionUpdate = new Promise(function(resolve) {
		firstSessionUpdateStarted = resolve;
	});
	const firstSessionFailure = new Error('first session update failed');
	const harness = createSelectedEndpointsHarness({
		currentSession: {
			id: 'session-1'
		},
		workspaceRaw: '{}',
		updateSession({
			callIndex,
			currentSession,
			mutator
		}) {
			mutator(currentSession);
			if (callIndex === 1) {
				firstSessionUpdateStarted();
				return new Promise(function(resolve, reject) {
					rejectFirstSessionUpdate = reject;
				});
			}
			return Promise.resolve();
		}
	});
	const firstTransaction = harness.api.persistEndpointParamsTransaction(endpointId, {
		temperature: 0.2
	}, 'session-1', function(session) {
		session.modelParams = {
			[endpointId]: {
				temperature: 0.2
			}
		};
	});
	await firstSessionUpdate;
	const secondTransaction = harness.api.persistEndpointParamsTransaction(endpointId, {
		temperature: 0.8
	}, 'session-1', function(session) {
		session.modelParams = {
			[endpointId]: {
				temperature: 0.8
			}
		};
	});
	await Promise.resolve();
	assert.equal(harness.getUpdateSessionCallCount(), 1, 'the queued transaction must not start before the first session update settles');
	rejectFirstSessionUpdate(firstSessionFailure);
	await assert.rejects(firstTransaction, firstSessionFailure);
	await secondTransaction;
	assert.deepEqual(cloneJson(harness.api.getDefaultSelectedEndpointParams()), {
		[endpointId]: {
			temperature: 0.8
		}
	});
	assert.equal(harness.localStorage.getItem('defaultSelectedEndpointParams'), '{"endpoint-1":{"temperature":0.8}}');
	assert.equal(harness.getUpdateSessionCallCount(), 2);
});
test('workspace/session parameter transaction captures the queued session at enqueue time', async () => {
	const endpointId = 'endpoint-1';
	const sessionIds = [];
	let releaseFirstUpdate;
	let firstUpdateStarted;
	const firstUpdate = new Promise(function(resolve) {
		firstUpdateStarted = resolve;
	});
	const harness = createSelectedEndpointsHarness({
		currentSession: {
			id: 'session-A'
		},
		workspaceRaw: '{}',
		updateSession({
			callIndex,
			sessionId
		}) {
			sessionIds.push(sessionId);
			if (callIndex === 1) {
				firstUpdateStarted();
				return new Promise(function(resolve) {
					releaseFirstUpdate = resolve;
				});
			}
		}
	});
	const firstTransaction = harness.api.persistEndpointParamsTransaction(endpointId, {
		temperature: 0.2
	}, 'session-A', function() {});
	await firstUpdate;
	const secondTransaction = harness.api.persistEndpointParamsTransaction(endpointId, {
		temperature: 0.8
	}, 'session-A', function() {});
	harness.setCurrentSession({
		id: 'session-B'
	});
	releaseFirstUpdate();
	await Promise.all([firstTransaction, secondTransaction]);
	assert.deepEqual(sessionIds, ['session-A', 'session-A']);
});
test('workspace/session parameter transaction preserves the session error when rollback storage write fails', async () => {
	const endpointId = 'endpoint-1';
	const sessionError = new Error('session update failed');
	const rollbackError = new Error('localStorage rollback failed');
	const harness = createSelectedEndpointsHarness({
		currentSession: {
			id: 'session-1'
		},
		workspaceRaw: '{}',
		setItemErrors: [
			[2, rollbackError]
		],
		updateSession() {
			return Promise.reject(sessionError);
		}
	});
	await assert.rejects(harness.api.persistEndpointParamsTransaction(endpointId, {
		temperature: 0.8
	}, 'session-1', function() {}), function(error) {
		assert.equal(error, sessionError);
		assert.equal(error.rollbackError, rollbackError);
		return true;
	});
	assert.equal(harness.getSetItemCallCount(), 2);
	assert.equal(harness.getUpdateSessionCallCount(), 1);
});
test('workspace/session parameter transaction preserves the session error when rollback removeItem fails without prior workspace storage', async () => {
	const endpointId = 'endpoint-1';
	const sessionError = new Error('session update failed');
	const rollbackError = new Error('localStorage rollback remove failed');
	const harness = createSelectedEndpointsHarness({
		currentSession: {
			id: 'session-1'
		},
		workspaceRaw: null,
		removeItemErrors: [
			[1, rollbackError]
		],
		updateSession() {
			return Promise.reject(sessionError);
		}
	});
	await assert.rejects(harness.api.persistEndpointParamsTransaction(endpointId, {
		temperature: 0.8
	}, 'session-1', function() {}), function(error) {
		assert.equal(error, sessionError);
		assert.equal(error.rollbackError, rollbackError);
		return true;
	});
	assert.equal(harness.getSetItemCallCount(), 1);
	assert.equal(harness.getRemoveItemCallCount(), 1);
	assert.equal(harness.getUpdateSessionCallCount(), 1);
});

function createSessionParamDialogHarness(options = {}) {
	const endpointId = options.endpointId || 'endpoint-1';
	const template = createModelParamTemplateFromLayout();
	const paramList = new ModelParamElement('div', 'param-control list');
	const controls = {
		'.close': new ModelParamElement('button', 'close'),
		'.ok': new ModelParamElement('button', 'ok'),
		'.reset': new ModelParamElement('button', 'reset'),
		'.model-path': new ModelParamElement('span', 'model-path'),
		'.param-control.list': paramList
	};
	const dialog = Object.assign(new FakeEventTarget(), {
		closeCount: 0,
		open: false,
		querySelector(selector) {
			if (controls[selector]) return controls[selector];
			throw new Error('Unexpected dialog selector: ' + selector);
		},
		close() {
			this.closeCount += 1;
			this.open = false;
		},
		showModal() {
			this.open = true;
		}
	});
	const document = {
		createElement(tagName) {
			return new ModelParamElement(tagName);
		},
		querySelector(selector) {
			if (selector === 'dialog.session-param-editor') return dialog;
			if (selector === '#model-param-row') return template;
			return null;
		}
	};
	const workspaceParams = cloneJson(options.workspaceParams || {});
	const storageValues = new Map([
		['defaultSelectedEndpointParams', JSON.stringify(workspaceParams)]
	]);
	const sessions = new Map();

	function retainSession(session) {
		if (!session) return null;
		const retained = cloneJson(session);
		sessions.set(retained.id, retained);
		return retained;
	}
	const openedSession = options.currentSession === undefined ? retainSession({
		id: 'session-A',
		modelParams: {}
	}) : retainSession(options.currentSession);
	(options.sessions || []).forEach(retainSession);
	const transactionCalls = [];
	const updateSessionTargets = [];
	const alerts = [];
	let renderCount = 0;
	const localStorage = {
		getItem(key) {
			return storageValues.has(key) ? storageValues.get(key) : null;
		},
		setItem(key, value) {
			storageValues.set(key, String(value));
		},
		removeItem(key) {
			storageValues.delete(key);
		}
	};
	const context = vm.createContext({
		JSON,
		alert(message) {
			alerts.push(message);
		},
		currentSession: openedSession,
		defaultSelectedEndpointParams: workspaceParams,
		doc: document,
		document,
		findModelById() {
			return {
				ancestors: [],
				node: {
					id: endpointId,
					name: 'Endpoint',
					modelId: 'model-1'
				}
			};
		},
		fromTemplate(templateId, selector) {
			assert.equal(templateId, 'model-param-row');
			return template.content.cloneNode(true).querySelector(selector);
		},
		incrementRenderCount() {
			renderCount += 1;
		},
		getGroups() {
			return [];
		},
		getParamDefs(type, style) {
			return options.definitions || endpointParamDefinitions(type, style);
		},
		localStorage,
		persistEndpointParamsTransaction: options.controlTransactions ? function(...args) {
			return new Promise(function(resolve, reject) {
				transactionCalls.push({
					args,
					resolve,
					reject
				});
			});
		} : undefined,
		resolveNodeConfig() {
			return {
				params: cloneJson(options.resolvedEndpointParams || {
					temperature: 0.7
				}),
				type: options.type || 'chat',
				style: options.style || 'openai'
			};
		},
		saveDefaultSelectedEndpointParams(params) {
			localStorage.setItem('defaultSelectedEndpointParams', JSON.stringify(params));
		},
		updateSession: async function(sessionId, mutator) {
			updateSessionTargets.push(sessionId);
			if (typeof options.updateSession === 'function') return options.updateSession({
				sessionId,
				mutator,
				sessions
			});
			const session = sessions.get(sessionId);
			if (!session) return null;
			mutator(session);
			return session;
		}
	});
	const selectedSource = fs.readFileSync(selectedEndpointsSourcePath, 'utf8');
	const uiUtilsSource = fs.readFileSync(path.join(__dirname, '..', 'src', 'modules', 'ui-utils.js'), 'utf8');
	const sourceParts = [
		extractFunctionDeclaration(uiUtilsSource, 'createModelParamValueControl'),
		extractFunctionDeclaration(uiUtilsSource, 'renderModelParamControls'),
		extractFunctionDeclaration(uiUtilsSource, 'modelParamNumberError'),
		extractFunctionDeclaration(uiUtilsSource, 'isValidModelParamNumber'),
		extractFunctionDeclaration(uiUtilsSource, 'collectModelParamControls'), 'const __renderSessionControls = renderModelParamControls;', "renderModelParamControls = function() { incrementRenderCount(); return __renderSessionControls.apply(this, arguments); };",
		extractFunctionDeclaration(selectedSource, 'hasOwnEndpointParams'),
		extractFunctionDeclaration(selectedSource, 'readOwnEndpointParams'),
		extractFunctionDeclaration(selectedSource, 'writeOwnEndpointParams'),
		extractFunctionDeclaration(selectedSource, 'deleteOwnEndpointParams')
	];
	if (!options.controlTransactions) {
		sourceParts.push('var endpointParamsTransactionQueue = Promise.resolve();');
		sourceParts.push(extractFunctionDeclaration(selectedSource, 'persistEndpointParamsTransaction'));
	}
	sourceParts.push(extractFunctionDeclaration(selectedSource, 'openSessionParamEditor'));
	sourceParts.push('globalThis.__openSessionParamEditor = openSessionParamEditor;');
	new vm.Script(sourceParts.join('\n'), {
		filename: selectedEndpointsSourcePath
	}).runInContext(context);
	return {
		alerts,
		context,
		dialog,
		endpointId,
		okButton: controls['.ok'],
		paramList,
		resetButton: controls['.reset'],
		transactionCalls,
		updateSessionTargets,
		getParamRow(key) {
			return modelParamRow(paramList, key);
		},
		getRenderCount() {
			return renderCount;
		},
		getSession(sessionId) {
			return sessions.get(sessionId);
		},
		getWorkspaceParams() {
			return cloneJson(context.defaultSelectedEndpointParams);
		},
		open() {
			context.__openSessionParamEditor(endpointId);
		},
		selectParamDecision(key, value) {
			selectModelParamDecision(modelParamRow(paramList, key), value);
		},
		setCurrentSession(session) {
			if (!session) {
				context.currentSession = null;
				return;
			}
			context.currentSession = sessions.get(session.id) || retainSession(session);
		},
		setParamValue(key, value, eventType = 'input') {
			const control = modelParamRow(paramList, key).querySelector('.own.param.control').querySelector('input, select');
			control.value = String(value);
			control.dispatch(eventType);
			return control;
		}
	};
}
test('parameter dialog keeps the opened session as the save and reset target after switching sessions', async () => {
	const harness = createSessionParamDialogHarness({
		currentSession: {
			id: 'session-A',
			modelParams: {
				'endpoint-1': {
					temperature: 0.2,
					max_tokens: null,
					unknown: 'keep'
				}
			}
		},
		sessions: [{
			id: 'session-B',
			modelParams: {}
		}]
	});
	harness.open();
	harness.setCurrentSession({
		id: 'session-B'
	});
	harness.setParamValue('temperature', 0.8);
	await harness.okButton.onclick();
	const saved = {
		temperature: 0.8,
		max_tokens: null,
		unknown: 'keep'
	};
	assert.deepEqual(harness.getWorkspaceParams()['endpoint-1'], saved);
	assert.deepEqual(harness.getSession('session-A').modelParams['endpoint-1'], saved);
	assert.deepEqual(harness.getSession('session-B').modelParams, {});
	await harness.resetButton.onclick();
	assert.deepEqual(harness.updateSessionTargets, ['session-A', 'session-A']);
	assert.equal(Object.hasOwn(harness.getSession('session-A'), 'modelParams'), false);
	assert.deepEqual(harness.getSession('session-B').modelParams, {});
});
test('parameter dialog ignores stale save and reset completions after a newer operation begins', async () => {
	const harness = createSessionParamDialogHarness({
		currentSession: null,
		controlTransactions: true
	});
	harness.open();
	const staleSave = harness.okButton.onclick();
	const currentReset = harness.resetButton.onclick();
	assert.equal(harness.transactionCalls.length, 2);
	harness.transactionCalls[0].resolve();
	await staleSave;
	assert.equal(harness.dialog.closeCount, 0, 'a stale save must not close the dialog opened for the newer operation');
	harness.transactionCalls[1].resolve();
	await currentReset;
	assert.equal(harness.getRenderCount(), 2, 'only the current reset may redraw parameter controls');
	const staleReset = harness.resetButton.onclick();
	const currentSave = harness.okButton.onclick();
	assert.equal(harness.transactionCalls.length, 4);
	harness.transactionCalls[2].reject(new Error('stale reset failed'));
	await staleReset;
	assert.deepEqual(harness.alerts, [], 'a stale reset error must not replace the newer operation state');
	harness.transactionCalls[3].reject(new Error('current save failed'));
	await currentSave;
	assert.deepEqual(harness.alerts, ['参数保存失败：current save failed']);
	assert.equal(harness.dialog.open, true, 'the latest failed operation must leave the dialog open');
});
test('parameter dialog invalidates stale operations after native dialog close', async () => {
	const harness = createSessionParamDialogHarness({
		currentSession: null,
		controlTransactions: true
	});
	harness.open();
	const staleSave = harness.okButton.onclick();
	harness.dialog.dispatchEvent({
		type: 'cancel'
	});
	harness.dialog.open = false;
	harness.dialog.showModal();
	harness.transactionCalls[0].resolve();
	await staleSave;
	const staleReset = harness.resetButton.onclick();
	harness.dialog.dispatchEvent({
		type: 'close'
	});
	harness.dialog.open = false;
	harness.dialog.showModal();
	harness.transactionCalls[1].resolve();
	await staleReset;
	const staleFailure = harness.okButton.onclick();
	harness.dialog.dispatchEvent({
		type: 'cancel'
	});
	harness.dialog.open = false;
	harness.dialog.showModal();
	harness.transactionCalls[2].reject(new Error('stale save failed'));
	await staleFailure;
	assert.equal(harness.dialog.closeCount, 0, 'old save completions must not close a dialog reopened after native cancel');
	assert.equal(harness.getRenderCount(), 1, 'old reset completions must not render a dialog reopened after native close');
	assert.deepEqual(harness.alerts, [], 'old failed saves must not alert in a dialog reopened after native cancel');
	assert.equal(harness.dialog.open, true, 'old operations must not change the reopened dialog state');
});

function createJoinSessionChangeHarness() {
	const selectedEndpoints = ['endpoint-1', 'other-endpoint'];
	const workspaceParams = {
		'endpoint-1': {
			temperature: 0.2
		},
		'other-endpoint': {
			topP: 0.4
		}
	};
	let removeWorkspaceEndpointParamsCalls = 0;
	let savedSelectedEndpoints = null;
	let renderSelectedEndpointsCalls = 0;
	let applyJoinBtnUICalls = 0;
	const nodeElement = {
		dataset: {
			nodeId: 'endpoint-1'
		}
	};
	const joinSession = {
		closest(selector) {
			assert.equal(selector, '.one.endpoint');
			return nodeElement;
		}
	};
	const checkbox = {
		closest(selector) {
			if (selector === '.one.endpoint') return nodeElement;
			assert.equal(selector, '.join-session');
			return joinSession;
		}
	};
	const context = vm.createContext({
		selectedEndpoints,
		removeWorkspaceEndpointParams(endpointId) {
			removeWorkspaceEndpointParamsCalls += 1;
			delete workspaceParams[endpointId];
		},
		saveDefaultSelectedEndpoints(nextSelectedEndpoints) {
			savedSelectedEndpoints = [...nextSelectedEndpoints];
		},
		renderSelectedEndpoints() {
			renderSelectedEndpointsCalls += 1;
		},
		getGroups() {
			return [];
		},
		applyJoinBtnUI(joinButton, endpointId) {
			assert.equal(joinButton, joinSession);
			assert.equal(endpointId, 'endpoint-1');
			applyJoinBtnUICalls += 1;
		}
	});
	const source = fs.readFileSync(endpointTreeSourcePath, 'utf8');
	const handlerSource = extractFunctionDeclaration(source, 'handleJoinSessionChange');
	new vm.Script(`${handlerSource}\nglobalThis.__handleJoinSessionChange = handleJoinSessionChange;`, {
		filename: endpointTreeSourcePath
	}).runInContext(context);
	return {
		handleJoinSessionChange: context.__handleJoinSessionChange,
		checkbox,
		getSelectedEndpoints() {
			return [...context.selectedEndpoints];
		},
		workspaceParams,
		get removeWorkspaceEndpointParamsCalls() {
			return removeWorkspaceEndpointParamsCalls;
		},
		get savedSelectedEndpoints() {
			return savedSelectedEndpoints;
		},
		get renderSelectedEndpointsCalls() {
			return renderSelectedEndpointsCalls;
		},
		get applyJoinBtnUICalls() {
			return applyJoinBtnUICalls;
		}
	};
}

function createHandleNodeDeleteFailureHarness(options = {}) {
	let removed = false;
	let clearTestResultsCalls = 0;
	let refreshUICalls = 0;
	let removeWorkspaceEndpointParamsCalls = 0;
	const selectedEndpoints = ['node-1', 'other-1'];
	const connectionStatus = new Map([
		['node-1', 'connected'],
		['child-1', 'connected']
	]);
	const collapsedEndpoints = new Set(['node-1', 'child-1']);
	const workspaceParams = {
		'node-1': {
			temperature: 0.7
		},
		'child-1': {
			temperature: 0.5
		},
		'other-1': {
			topP: 0.4
		}
	};
	const currentSession = {
		modelParams: {
			'node-1': {
				temperature: 0.2
			}
		}
	};
	const deleteError = options.deleteError === undefined ? new Error('endpoint persistence failed') : options.deleteError;
	const deleteResult = options.deleteResult === undefined ? true : options.deleteResult;
	const parentContainer = {
		closest() {
			return null;
		}
	};
	const nodeElement = {
		remove() {
			removed = true;
		},
		closest(selector) {
			assert.equal(selector, 'ol');
			return parentContainer;
		}
	};
	const context = vm.createContext({
		collapsedEndpoints,
		collectDescendantIds() {
			return ['node-1', 'child-1'];
		},
		connectionStatus,
		deleteNode: async function() {
			if (deleteError) throw deleteError;
			return deleteResult;
		},
		document: {
			querySelector(selector) {
				assert.equal(selector, '.one.endpoint[data-node-id="node-1"]');
				return nodeElement;
			}
		},
		invalidateConnectionTest() {},
		refreshUI: async function() {
			refreshUICalls += 1;
		},
		removeWorkspaceEndpointParams(endpointId) {
			removeWorkspaceEndpointParamsCalls += 1;
			delete workspaceParams[endpointId];
		},
		selectedEndpoints,
		clearTestResults() {
			clearTestResultsCalls += 1;
		},
		saveDefaultSelectedEndpoints() {},
		updateEmptyState() {}
	});
	const mainSource = fs.readFileSync(mainSourcePath, 'utf8');
	const handleSource = extractFunctionDeclaration(mainSource, 'handleNodeDelete');
	new vm.Script(`async ${handleSource}\nglobalThis.__handleNodeDelete = handleNodeDelete;`, {
		filename: mainSourcePath
	}).runInContext(context);
	return {
		handleNodeDelete: context.__handleNodeDelete,
		deleteError,
		selectedEndpoints,
		connectionStatus,
		collapsedEndpoints,
		workspaceParams,
		currentSession,
		get removed() {
			return removed;
		},
		get clearTestResultsCalls() {
			return clearTestResultsCalls;
		},
		get refreshUICalls() {
			return refreshUICalls;
		},
		get removeWorkspaceEndpointParamsCalls() {
			return removeWorkspaceEndpointParamsCalls;
		}
	};
}
test('endpoint tree checkbox deselection clears workspace params without changing session params', () => {
	const harness = createJoinSessionChangeHarness();
	harness.handleJoinSessionChange(harness.checkbox);
	assert.equal(harness.removeWorkspaceEndpointParamsCalls, 1);
	assert.deepEqual(harness.workspaceParams, {
		'other-endpoint': {
			topP: 0.4
		}
	});
	assert.deepEqual(harness.getSelectedEndpoints(), ['other-endpoint']);
	assert.deepEqual(harness.savedSelectedEndpoints, ['other-endpoint']);
	assert.equal(harness.renderSelectedEndpointsCalls, 1);
	assert.equal(harness.applyJoinBtnUICalls, 1);
});
test('handleNodeDelete keeps UI state when persistence fails', async () => {
	const harness = createHandleNodeDeleteFailureHarness();
	await assert.rejects(harness.handleNodeDelete('node-1'), harness.deleteError);
	assert.deepEqual(harness.selectedEndpoints, ['node-1', 'other-1']);
	assert.equal(harness.connectionStatus.has('node-1'), true);
	assert.equal(harness.collapsedEndpoints.has('node-1'), true);
	assert.equal(harness.removed, false);
	assert.equal(harness.clearTestResultsCalls, 0);
	assert.equal(harness.refreshUICalls, 0);
});
test('handleNodeDelete keeps workspace params when delete fails', async () => {
	const harness = createHandleNodeDeleteFailureHarness();
	await assert.rejects(harness.handleNodeDelete('node-1'), harness.deleteError);
	assert.equal(harness.removeWorkspaceEndpointParamsCalls, 0);
	assert.deepEqual(harness.workspaceParams, {
		'node-1': {
			temperature: 0.7
		},
		'child-1': {
			temperature: 0.5
		},
		'other-1': {
			topP: 0.4
		}
	});
	assert.deepEqual(harness.currentSession.modelParams, {
		'node-1': {
			temperature: 0.2
		}
	});
});
test('handleNodeDelete keeps workspace params when delete returns false', async () => {
	const harness = createHandleNodeDeleteFailureHarness({
		deleteError: null,
		deleteResult: false
	});
	await harness.handleNodeDelete('node-1');
	assert.equal(harness.removeWorkspaceEndpointParamsCalls, 0);
	assert.deepEqual(harness.workspaceParams, {
		'node-1': {
			temperature: 0.7
		},
		'child-1': {
			temperature: 0.5
		},
		'other-1': {
			topP: 0.4
		}
	});
	assert.equal(harness.removed, false);
	assert.equal(harness.refreshUICalls, 0);
});
test('handleNodeDelete clears workspace params for the deleted subtree after success', async () => {
	const harness = createHandleNodeDeleteFailureHarness({
		deleteError: null
	});
	await harness.handleNodeDelete('node-1');
	assert.equal(harness.removeWorkspaceEndpointParamsCalls, 2);
	assert.deepEqual(harness.workspaceParams, {
		'other-1': {
			topP: 0.4
		}
	});
	assert.deepEqual(harness.currentSession.modelParams, {
		'node-1': {
			temperature: 0.2
		}
	});
});
test('showThinkingCards only removes old response cards inside the message list', () => {
	const harness = createShowThinkingCardsHarness();
	harness.showThinkingCards(['endpoint-1'], [], 'session-1');
	assert.equal(harness.removed.sessionItem, false);
	assert.equal(harness.removed.responseCard, true);
});
test('renderSessionList appends each rendered session with standard DOM appendChild', () => {
	const appendedSessions = [];
	const titleEl = {
		textContent: ''
	};
	const metaEl = {};
	const timeEl = {
		textContent: ''
	};
	const editBtn = {
		dataset: {},
		addEventListener() {}
	};
	const deleteBtn = {
		dataset: {},
		addEventListener() {}
	};
	const sessionEl = {
		dataset: {},
		classList: {
			add() {}
		},
		querySelector(selector) {
			if (selector === '.title') return titleEl;
			if (selector === '.meta') return metaEl;
			if (selector === '.time') return timeEl;
			if (selector === '.edit.title') return editBtn;
			if (selector === '.remove') return deleteBtn;
			throw new Error(`Unexpected session selector: ${selector}`);
		}
	};
	const container = {
		querySelectorAll() {
			return [];
		},
		appendChild(element) {
			appendedSessions.push(element);
		}
	};
	const sessionListSource = fs.readFileSync(sessionListSourcePath, 'utf8');
	const renderSource = extractFunctionDeclaration(sessionListSource, 'renderSessionList');
	const context = vm.createContext({
		document: {
			querySelector(selector) {
				assert.equal(selector, 'aside.session.list > ol');
				return container;
			}
		},
		fromTemplate(templateName, tagName) {
			assert.equal(templateName, 'one-session');
			assert.equal(tagName, 'li');
			return sessionEl;
		}
	});
	new vm.Script(`
		${renderSource}
		globalThis.__renderSessionList = renderSessionList;
	`, {
		filename: sessionListSourcePath
	}).runInContext(context);
	context.__renderSessionList([{
		id: 'session-1',
		title: '会话 1',
		createdAt: 1
	}], null, null, null, null);
	assert.equal(appendedSessions.length, 1);
	assert.equal(appendedSessions[0], sessionEl);
});
test('handleEditSessionTitleClick consumes a rejected save Promise after blur while restoring the old title', () => {
	const currentTitle = '旧标题';
	const titleEl = {
		textContent: currentTitle,
		classList: {
			add(className) {
				assert.equal(className, 'hidden');
			},
			remove(className) {
				assert.equal(className, 'hidden');
			}
		}
	};
	const inputEl = {
		value: '新标题',
		blur() {
			this.onblur();
		},
		focus() {},
		remove() {},
		select() {}
	};
	const meta = {};
	const sessionEl = {
		dataset: {
			sessionId: 'session-1'
		},
		insertBefore(input, reference) {
			assert.equal(input, inputEl);
			assert.equal(reference, meta);
		},
		querySelector(selector) {
			if (selector === '.title') return titleEl;
			if (selector === '.meta') return meta;
			throw new Error(`Unexpected session selector: ${selector}`);
		}
	};
	const button = {
		closest(selector) {
			assert.equal(selector, 'li');
			return sessionEl;
		}
	};
	const sessionListSource = fs.readFileSync(sessionListSourcePath, 'utf8');
	const handleEditSource = extractFunctionDeclaration(sessionListSource, 'handleEditSessionTitleClick');
	const context = vm.createContext({
		mk(tagName, className) {
			assert.equal(tagName, 'input');
			assert.equal(className, 'editing title');
			return inputEl;
		}
	});
	new vm.Script(`
		globalThis.__consumedRejection = false;
		const savePromise = Promise.reject(new Error('save failed'));
		savePromise.catch(() => {});
		savePromise.catch = onRejected => {
			globalThis.__consumedRejection = true;
			return Promise.prototype.catch.call(savePromise, onRejected);
		};
		function handleSessionEdit() {
			return savePromise;
		}
		${handleEditSource}
		globalThis.__handleEditSessionTitleClick = handleEditSessionTitleClick;
	`, {
		filename: sessionListSourcePath
	}).runInContext(context);
	context.__handleEditSessionTitleClick(button);
	inputEl.value = '新标题';
	inputEl.blur();
	assert.equal(context.__consumedRejection, true, 'the rejected save Promise must be consumed');
	assert.equal(titleEl.textContent, currentTitle);
});
test('bindEndpointNodeDragEvents dispatches drag events to the real named handlers', () => {
	const calls = {
		dragover: [],
		dragleave: [],
		drop: []
	};
	const harness = createEndpointTreeHarness({
		dragover(...args) {
			calls.dragover.push(args);
		},
		dragleave(...args) {
			calls.dragleave.push(args);
		},
		drop(...args) {
			calls.drop.push(args);
		}
	});
	assert.equal(typeof harness.bindEndpointNodeDragEvents, 'function', 'endpoint-tree.js must define bindEndpointNodeDragEvents(nodeEl)');
	const nodeEl = new FakeEventTarget();
	harness.bindEndpointNodeDragEvents(nodeEl);
	const dragoverEvent = {
		type: 'dragover'
	};
	const dragleaveEvent = {
		type: 'dragleave'
	};
	const dropEvent = {
		type: 'drop'
	};
	nodeEl.dispatchEvent(dragoverEvent);
	nodeEl.dispatchEvent(dragleaveEvent);
	nodeEl.dispatchEvent(dropEvent);
	assert.equal(calls.dragover.length, 1);
	assert.equal(calls.dragover[0][0], dragoverEvent);
	assert.equal(calls.dragover[0][1], nodeEl);
	assert.equal(dragoverEvent.currentTarget, nodeEl);
	assert.equal(calls.dragleave.length, 1);
	assert.equal(calls.dragleave[0][0], nodeEl);
	assert.equal(dragleaveEvent.currentTarget, nodeEl);
	assert.equal(calls.drop.length, 1);
	assert.equal(calls.drop[0][0], dropEvent);
	assert.equal(calls.drop[0][1], nodeEl);
	assert.equal(dropEvent.currentTarget, nodeEl);
});

function assertSkipEndpointTreeRefresh(call) {
	assert.equal(call[0], 'refresh');
	assert.equal(call[1].skipEndpointTree, true);
	assert.equal(Object.keys(call[1]).length, 1);
}
test('handleAddGroup filters its appended root node before refreshing the endpoint tree', async () => {
	const calls = [];
	const data = {
		name: 'New group'
	};
	const newNode = {
		id: 'new-group',
		name: 'New group',
		children: []
	};
	const builtNodeEl = {
		id: 'built-new-group'
	};
	let onSubmit;
	const container = {
		appendChild(nodeEl) {
			calls.push(['append', nodeEl]);
		}
	};
	const mainSource = fs.readFileSync(mainSourcePath, 'utf8');
	const handleAddGroupSource = extractFunctionDeclaration(mainSource, 'handleAddGroup');
	const context = vm.createContext({
		addNode: async (...args) => {
			calls.push(['addNode', ...args]);
			return newNode;
		},
		applyEndpointFilter() {
			calls.push(['filter']);
		},
		buildEndpointNodeEl(node) {
			calls.push(['build', node]);
			return builtNodeEl;
		},
		document: {
			querySelector(selector) {
				assert.equal(selector, 'aside.endpoint.list > ol');
				return container;
			}
		},
		refreshUI: async options => {
			calls.push(['refresh', options]);
		},
		showEditGroupDialog(...args) {
			assert.equal(args[0], null);
			assert.equal(args[1], null);
			onSubmit = args[2];
		},
		updateEmptyState() {}
	});
	new vm.Script(`${handleAddGroupSource}\nglobalThis.__handleAddGroup = handleAddGroup;`, {
		filename: mainSourcePath
	}).runInContext(context);
	context.__handleAddGroup();
	await onSubmit(data);
	assert.equal(calls[0][0], 'addNode');
	assert.equal(calls[0][1], null);
	assert.equal(calls[0][2], data);
	assert.equal(calls[1][0], 'build');
	assert.equal(calls[1][1], newNode);
	assert.equal(calls[2][0], 'append');
	assert.equal(calls[2][1], builtNodeEl);
	assert.equal(calls[3][0], 'filter');
	assertSkipEndpointTreeRefresh(calls[4]);
});
test('handleAddGroup refreshes without local DOM work when addNode returns null', async () => {
	const calls = [];
	let onSubmit;
	const mainSource = fs.readFileSync(mainSourcePath, 'utf8');
	const handleAddGroupSource = extractFunctionDeclaration(mainSource, 'handleAddGroup');
	const context = vm.createContext({
		addNode: async (...args) => {
			calls.push(['addNode', ...args]);
			return null;
		},
		applyEndpointFilter() {
			calls.push(['filter']);
		},
		buildEndpointNodeEl() {
			calls.push(['build']);
		},
		document: {
			querySelector() {
				calls.push(['query']);
				return null;
			}
		},
		refreshUI: async options => {
			calls.push(['refresh', options]);
		},
		showEditGroupDialog(...args) {
			onSubmit = args[2];
		},
		updateEmptyState() {}
	});
	new vm.Script(`${handleAddGroupSource}\nglobalThis.__handleAddGroup = handleAddGroup;`, {
		filename: mainSourcePath
	}).runInContext(context);
	context.__handleAddGroup();
	const data = {
		name: 'Cancelled group'
	};
	await onSubmit(data);
	assert.equal(calls.length, 2);
	assert.equal(calls[0][0], 'addNode');
	assert.equal(calls[0][1], null);
	assert.equal(calls[0][2], data);
	assertSkipEndpointTreeRefresh(calls[1]);
});
test('handleAddChildClick creates a first child list, filters it, then refreshes', async () => {
	const calls = [];
	const data = {
		name: 'New child'
	};
	const newNode = {
		id: 'new-child',
		name: 'New child',
		children: []
	};
	const builtNodeEl = {
		id: 'built-new-child'
	};
	let onSubmit;
	const childrenOl = {
		set className(value) {
			calls.push(['children-class', value]);
		},
		appendChild(nodeEl) {
			calls.push(['children-append', nodeEl]);
		}
	};
	const detailsEl = {
		open: false,
		appendChild(nodeEl) {
			calls.push(['details-append', nodeEl]);
		}
	};
	const parentClassList = {
		remove(className) {
			calls.push(['parent-class-remove', className]);
		}
	};
	const parentNameClassList = {
		add(className) {
			calls.push(['parent-name-class-add', className]);
		}
	};
	const nodeEl = {
		classList: parentClassList,
		dataset: {
			nodeId: 'parent-node'
		},
		querySelector(selector) {
			if (selector === 'details > ol.children') return null;
			if (selector === 'details') return detailsEl;
			if (selector === '.name') return {
				classList: parentNameClassList
			};
			throw new Error(`Unexpected node selector: ${selector}`);
		}
	};
	const button = {
		closest(selector) {
			assert.equal(selector, '.one.endpoint');
			return nodeEl;
		}
	};
	const endpointTreeSource = fs.readFileSync(endpointTreeSourcePath, 'utf8');
	const context = vm.createContext({
		addNode: async (...args) => {
			calls.push(['addNode', ...args]);
			return newNode;
		},
		applyEndpointFilter() {
			calls.push(['filter']);
		},
		buildEndpointNodeEl(node) {
			calls.push(['build', node]);
			return builtNodeEl;
		},
		document: {
			createElement(tagName) {
				calls.push(['create', tagName]);
				return childrenOl;
			}
		},
		refreshUI: async options => {
			calls.push(['refresh', options]);
		},
		showEditGroupDialog(...args) {
			assert.equal(args[0], null);
			assert.equal(args[1], 'parent-node');
			onSubmit = args[2];
		},
		updateEmptyState() {}
	});
	const handleAddChildClickSource = extractFunctionDeclaration(endpointTreeSource, 'handleAddChildClick');
	new vm.Script(`${handleAddChildClickSource}\nglobalThis.__handleAddChildClick = handleAddChildClick;`, {
		filename: endpointTreeSourcePath
	}).runInContext(context);
	context.__handleAddChildClick(button);
	await onSubmit(data);
	assert.equal(calls[0][0], 'addNode');
	assert.equal(calls[0][1], 'parent-node');
	assert.equal(calls[0][2], data);
	assert.equal(calls[1][0], 'create');
	assert.equal(calls[1][1], 'ol');
	assert.equal(calls[2][0], 'children-class');
	assert.equal(calls[2][1], 'children');
	assert.equal(calls[3][0], 'details-append');
	assert.equal(calls[3][1], childrenOl);
	assert.equal(calls[4][0], 'build');
	assert.equal(calls[4][1], newNode);
	assert.equal(calls[5][0], 'children-append');
	assert.equal(calls[5][1], builtNodeEl);
	assert.equal(calls[6][0], 'parent-class-remove');
	assert.equal(calls[6][1], 'compact');
	assert.equal(calls[7][0], 'parent-name-class-add');
	assert.equal(calls[7][1], 'has-children');
	assert.equal(calls[8][0], 'filter');
	assertSkipEndpointTreeRefresh(calls[9]);
	assert.equal(detailsEl.open, true);
});
test('local child append refreshes ancestor batch test ids before its real batch action', async () => {
	let onSubmit;
	const batchTestedIds = [];
	const parentNode = {
		id: 'parent-node',
		name: 'Parent group',
		children: [{
			id: 'existing-child',
			name: 'Existing endpoint',
			children: []
		}]
	};
	const newNode = {
		id: 'new-child',
		name: 'New endpoint',
		children: []
	};
	const classList = {
		add() {},
		remove() {},
		contains(className) {
			return className === 'children';
		}
	};
	const parentBatchBtn = {
		classList,
		dataset: {
			testableIds: JSON.stringify(['existing-child'])
		},
		title: ''
	};
	const childTestBtn = {
		classList,
		title: ''
	};
	const detailsEl = {
		open: false,
		appendChild(nodeEl) {
			nodeEl.parentElement = this;
		}
	};
	const childrenOl = {
		classList,
		appendChild(nodeEl) {
			nodeEl.parentElement = this;
		},
		closest(selector) {
			assert.equal(selector, '.one.endpoint');
			return parentNodeEl;
		}
	};
	const parentNodeEl = {
		classList,
		dataset: {
			nodeId: 'parent-node'
		},
		parentElement: {
			classList: {
				contains() {
					return false;
				}
			}
		},
		querySelector(selector) {
			if (selector === 'details > ol.children') return null;
			if (selector === 'details') return detailsEl;
			if (selector === '.name') return {
				classList
			};
			if (selector === '.test-connection') return parentBatchBtn;
			throw new Error(`Unexpected parent selector: ${selector}`);
		}
	};
	const childNodeEl = {
		dataset: {
			nodeId: 'new-child'
		},
		querySelector(selector) {
			assert.equal(selector, '.test-connection');
			return childTestBtn;
		}
	};
	const button = {
		closest(selector) {
			assert.equal(selector, '.one.endpoint');
			return parentNodeEl;
		}
	};
	const endpointTreeSource = fs.readFileSync(endpointTreeSourcePath, 'utf8');
	const handleAddChildClickSource = extractFunctionDeclaration(endpointTreeSource, 'handleAddChildClick');
	const handleBatchTestClickSource = extractFunctionDeclaration(endpointTreeSource, 'handleBatchTestClick');
	const updateEndpointTestUISource = extractFunctionDeclaration(endpointTreeSource, 'updateEndpointTestUI');
	const context = vm.createContext({
		addNode: async (parentId, data) => {
			assert.equal(parentId, 'parent-node');
			assert.deepEqual(data, {
				name: 'New endpoint'
			});
			parentNode.children.push(newNode);
			return newNode;
		},
		applyEndpointFilter() {},
		buildEndpointNodeEl(node) {
			assert.equal(node, newNode);
			return childNodeEl;
		},
		connectionStatus: new Map(),
		document: {
			createElement(tagName) {
				assert.equal(tagName, 'ol');
				return childrenOl;
			},
			querySelector(selector) {
				if (selector === '.test-all') return null;
				assert.equal(selector, '.one.endpoint[data-node-id="new-child"]');
				return childNodeEl;
			}
		},
		getConnectionStatusText() {
			return 'Not tested';
		},
		getNode(nodeId) {
			assert.equal(nodeId, 'parent-node');
			return parentNode;
		},
		isEndpointTestable(nodeId) {
			return nodeId === 'existing-child' || nodeId === 'new-child';
		},
		refreshUI: async () => {},
		resolveNodeConfig(nodeId) {
			if (nodeId === 'existing-child' || nodeId === 'new-child') {
				return {
					baseUrl: 'https://example.test',
					modelId: 'test-model',
					type: 'chat'
				};
			}
			return null;
		},
		showEditGroupDialog(_node, parentId, submit) {
			assert.equal(parentId, 'parent-node');
			onSubmit = submit;
		},
		updateEmptyState() {},
		testConnection(nodeId) {
			batchTestedIds.push(nodeId);
		}
	});
	new vm.Script(`${updateEndpointTestUISource}
var synchronizeEndpointTestUI = updateEndpointTestUI;
var updateEndpointTestUICalls = 0;
updateEndpointTestUI = function(nodeId) {
	updateEndpointTestUICalls += 1;
	return synchronizeEndpointTestUI(nodeId);
};
${handleAddChildClickSource}
${handleBatchTestClickSource}
globalThis.__handleAddChildClick = handleAddChildClick;
globalThis.__handleBatchTestClick = handleBatchTestClick;
globalThis.__synchronizeEndpointTestUI = synchronizeEndpointTestUI;
globalThis.__updateEndpointTestUICalls = function() { return updateEndpointTestUICalls; };`, {
		filename: endpointTreeSourcePath
	}).runInContext(context);
	context.__handleAddChildClick(button);
	await onSubmit({
		name: 'New endpoint'
	});
	assert.deepEqual(JSON.parse(parentBatchBtn.dataset.testableIds),
		['existing-child', 'new-child'], 'parent batch test data must include the locally appended testable child');
	context.__handleBatchTestClick(parentBatchBtn);
	assert.deepEqual(batchTestedIds, ['existing-child', 'new-child']);
	assert.equal(context.__updateEndpointTestUICalls(), 1);
});
test('handleAddChildClick refreshes without local DOM work when addNode returns null', async () => {
	const calls = [];
	let onSubmit;
	const nodeEl = {
		dataset: {
			nodeId: 'parent-node'
		},
		querySelector() {
			calls.push(['query']);
			return null;
		}
	};
	const button = {
		closest() {
			return nodeEl;
		}
	};
	const endpointTreeSource = fs.readFileSync(endpointTreeSourcePath, 'utf8');
	const handleAddChildClickSource = extractFunctionDeclaration(endpointTreeSource, 'handleAddChildClick');
	const context = vm.createContext({
		addNode: async (...args) => {
			calls.push(['addNode', ...args]);
			return null;
		},
		applyEndpointFilter() {
			calls.push(['filter']);
		},
		buildEndpointNodeEl() {
			calls.push(['build']);
		},
		document: {
			createElement() {
				calls.push(['create']);
			}
		},
		refreshUI: async options => {
			calls.push(['refresh', options]);
		},
		showEditGroupDialog(...args) {
			onSubmit = args[2];
		},
		updateEmptyState() {}
	});
	new vm.Script(`${handleAddChildClickSource}\nglobalThis.__handleAddChildClick = handleAddChildClick;`, {
		filename: endpointTreeSourcePath
	}).runInContext(context);
	context.__handleAddChildClick(button);
	const data = {
		name: 'Cancelled child'
	};
	await onSubmit(data);
	assert.equal(calls.length, 2);
	assert.equal(calls[0][0], 'addNode');
	assert.equal(calls[0][1], 'parent-node');
	assert.equal(calls[0][2], data);
	assertSkipEndpointTreeRefresh(calls[1]);
});
test('updateEmptyState shows the filtered-empty state when every endpoint has the hidden class', () => {
	function createClassList(...classes) {
		const values = new Set(classes);
		return {
			add(...names) {
				names.forEach(name => values.add(name));
			},
			contains(name) {
				return values.has(name);
			},
			remove(...names) {
				names.forEach(name => values.delete(name));
			}
		};
	}
	const emptyState = {
		classList: createClassList('hidden')
	};
	const emptyHint = {
		textContent: ''
	};
	const resetBtn = {
		classList: createClassList('hidden')
	};
	const addBtn = {
		classList: createClassList()
	};
	const aside = {
		querySelector(selector) {
			if (selector === '.empty-state') return emptyState;
			throw new Error(`Unexpected aside selector: ${selector}`);
		}
	};
	const hiddenEndpointNodes = [{
		classList: createClassList('hidden')
	}, {
		classList: createClassList('hidden')
	}];
	const endpointTreeSource = fs.readFileSync(endpointTreeSourcePath, 'utf8');
	const updateEmptyStateSource = extractFunctionDeclaration(endpointTreeSource, 'updateEmptyState');
	const context = vm.createContext({
		activeTypeFilters: new Set(['embedding']),
		document: {
			querySelector(selector) {
				if (selector === 'aside.endpoint.list') return aside;
				throw new Error(`Unexpected document selector: ${selector}`);
			},
			querySelectorAll(selector) {
				if (selector === 'aside.endpoint.list li.one.endpoint') return hiddenEndpointNodes;
				if (selector === 'aside.endpoint.list li.one.endpoint[style*="display: none"]') return [];
				throw new Error(`Unexpected document selector: ${selector}`);
			}
		},
		getGroups() {
			return [{
				id: 'filtered-group'
			}];
		}
	});
	emptyState.querySelector = selector => {
		if (selector === '.hint') return emptyHint;
		if (selector === '.reset-filter') return resetBtn;
		if (selector === '.add-endpoint') return addBtn;
		throw new Error(`Unexpected empty-state selector: ${selector}`);
	};
	new vm.Script(`${updateEmptyStateSource}\nglobalThis.__updateEmptyState = updateEmptyState;`, {
		filename: endpointTreeSourcePath
	}).runInContext(context);
	context.__updateEmptyState();
	assert.equal(emptyState.classList.contains('hidden'), false);
	assert.equal(emptyHint.textContent, '没有符合筛选的端点。');
	assert.equal(resetBtn.classList.contains('hidden'), false);
	assert.equal(addBtn.classList.contains('hidden'), true);
});
test('editing endpoint metadata does not save untouched parameter suggestions', () => {
	const tree = {
		nodes: []
	};
	const harness = createEditDialogHarness(tree);
	let saveData;
	harness.context.__showEditGroupDialog(null, null, data => {
		saveData = data;
	});
	harness.dialog.querySelector('input[name="name"]').value = 'New endpoint';
	harness.okButton.onclick();
	assert.equal(Object.hasOwn(saveData, 'params'), false);
});
test('root endpoint preserves untouched absent and null parameter states', () => {
	const absent = {
		id: 'absent',
		name: 'Absent',
		style: 'openai',
		type: 'chat',
		children: []
	};
	const nullNode = {
		id: 'null',
		name: 'Null',
		style: 'openai',
		type: 'chat',
		params: {
			temperature: null
		},
		children: []
	};
	const tree = {
		nodes: [absent, nullNode]
	};
	const absentHarness = createEditDialogHarness(tree);
	let absentSave;
	absentHarness.context.__showEditGroupDialog(absent, null, data => {
		absentSave = data;
	});
	assert.equal(absentHarness.getParamRow('temperature').dataset.state, 'model');
	assert.equal(absentHarness.getParamRow('temperature').querySelectorAll('input[type="radio"]').some(radio => radio.value === 'inherit'), false);
	absentHarness.okButton.onclick();
	assert.equal(Object.hasOwn(absentSave, 'params'), false);
	const nullHarness = createEditDialogHarness(tree);
	let nullSave;
	nullHarness.context.__showEditGroupDialog(nullNode, null, data => {
		nullSave = data;
	});
	assert.equal(nullHarness.getParamRow('temperature').dataset.state, 'model');
	nullHarness.okButton.onclick();
	assert.deepEqual(JSON.parse(JSON.stringify(nullSave.params)), {
		temperature: null
	});
});
test('child endpoint uses own params to choose inherit despite an effective parent value', () => {
	const child = {
		id: 'child',
		name: 'Child',
		children: []
	};
	const tree = {
		nodes: [{
			id: 'parent',
			name: 'Parent',
			style: 'openai',
			type: 'chat',
			params: {
				temperature: 0.7
			},
			children: [child]
		}]
	};
	const harness = createEditDialogHarness(tree);
	harness.context.__showEditGroupDialog(child, null, () => {});
	const row = harness.getParamRow('temperature');
	assert.equal(row.dataset.state, 'inherit');
	assert.equal(row.querySelector('.inherited.param.hint').textContent, '当前为 0.7');
	assert.equal(row.querySelectorAll('input[type="radio"]').some(radio => radio.value === 'inherit'), true);
	assert.equal(harness.getParamRow('max_tokens').querySelectorAll('input[type="radio"]').some(radio => radio.value === 'inherit'), true);
});
test('child endpoint saves inherit own and model-decides decisions', () => {
	const child = {
		id: 'child',
		name: 'Child',
		params: {
			temperature: 0.9,
			max_tokens: 20,
			presence_penalty: 1
		},
		children: []
	};
	const tree = {
		nodes: [{
			id: 'parent',
			name: 'Parent',
			style: 'openai',
			type: 'chat',
			params: {
				temperature: 0.7
			},
			children: [child]
		}]
	};
	const harness = createEditDialogHarness(tree);
	let saveData;
	harness.context.__showEditGroupDialog(child, null, data => {
		saveData = data;
	});
	harness.selectParamDecision('temperature', 'inherit');
	harness.selectParamDecision('max_tokens', 'own');
	harness.getParamRow('max_tokens').querySelector('input[type="number"]').value = '33';
	harness.selectParamDecision('presence_penalty', 'model');
	harness.okButton.onclick();
	assert.deepEqual(JSON.parse(JSON.stringify(saveData.params)), {
		max_tokens: 33,
		presence_penalty: null
	});
});
test('last inherited endpoint parameter saves an empty object over the old value', () => {
	const child = {
		id: 'child',
		name: 'Child',
		params: {
			temperature: 0.9
		},
		children: []
	};
	const tree = {
		nodes: [{
			id: 'parent',
			name: 'Parent',
			style: 'openai',
			type: 'chat',
			params: {
				temperature: 0.7
			},
			children: [child]
		}]
	};
	const harness = createEditDialogHarness(tree);
	let saveData;
	harness.context.__showEditGroupDialog(child, null, data => {
		saveData = data;
	});
	harness.selectParamDecision('temperature', 'inherit');
	harness.okButton.onclick();
	assert.deepEqual(JSON.parse(JSON.stringify(saveData.params)), {});
});
test('endpoint parameter validation blocks save and keeps the dialog open', () => {
	const node = {
		id: 'root',
		name: 'Root',
		style: 'openai',
		type: 'chat',
		children: []
	};
	const harness = createEditDialogHarness({
		nodes: [node]
	});
	let saveCount = 0;
	harness.context.__showEditGroupDialog(node, null, () => {
		saveCount += 1;
	});
	harness.selectParamDecision('max_tokens', 'own');
	const row = harness.getParamRow('max_tokens');
	const control = row.querySelector('input[type="number"]');
	control.value = '1.5';
	control.listeners.get('change').call(control, {
		type: 'change'
	});
	harness.okButton.onclick();
	assert.equal(saveCount, 0);
	assert.equal(harness.dialog.open, true);
	assert.equal(row.querySelector('.validation.error').textContent, '请输入不小于 1 的整数');
	assert.equal(control.focused, true);
});
test('endpoint parameter rerender preserves unsaved decisions values and custom rows', () => {
	const node = {
		id: 'root',
		name: 'Root',
		style: 'openai',
		type: 'chat',
		customParams: [{
			key: 'legacy',
			value: 'kept'
		}],
		children: []
	};
	const harness = createEditDialogHarness({
		nodes: [node]
	});
	let saveData;
	harness.context.__showEditGroupDialog(node, null, data => {
		saveData = data;
	});
	harness.selectParamDecision('temperature', 'own');
	const temperature = harness.getParamRow('temperature').querySelector('input[type="range"]');
	temperature.value = '0.4';
	temperature.dispatch('input');
	harness.selectParamDecision('max_tokens', 'model');
	assert.deepEqual(JSON.parse(JSON.stringify(harness.collectParams({}).params)), {
		temperature: 0.4,
		max_tokens: null
	});
	const customRows = harness.paramList.querySelectorAll('.param-row.custom');
	customRows[0].querySelectorAll('input')[1].value = 'edited';
	const style = harness.dialog.querySelector('input[name="style"][value="openai"]');
	style.checked = true;
	style.dispatch('change');
	assert.equal(harness.getParamRow('temperature').dataset.state, 'own');
	assert.equal(Number(harness.getParamRow('temperature').querySelector('input[type="range"]').value), 0.4);
	assert.equal(harness.getParamRow('max_tokens').dataset.state, 'model');
	assert.equal(harness.paramList.querySelectorAll('.param-row.custom')[0].querySelectorAll('input')[1].value, 'edited');
	harness.okButton.onclick();
	assert.deepEqual(JSON.parse(JSON.stringify(saveData.params)), {
		temperature: 0.4,
		max_tokens: null
	});
	assert.deepEqual(JSON.parse(JSON.stringify(saveData.customParams)), [{
		key: 'legacy',
		value: 'edited'
	}]);
});
test('legacy voice and instruction display as own without migrating when untouched', () => {
	const node = {
		id: 'tts',
		name: 'TTS',
		style: 'openai',
		type: 'tts',
		params: {
			speed: 1
		},
		voice: 'alloy',
		instruction: 'calm',
		children: []
	};
	const harness = createEditDialogHarness({
		nodes: [node]
	});
	let saveData;
	harness.context.__showEditGroupDialog(node, null, data => {
		saveData = data;
	});
	assert.equal(harness.getParamRow('voice').dataset.state, 'own');
	assert.equal(harness.getParamRow('instruction').dataset.state, 'own');
	harness.okButton.onclick();
	assert.deepEqual(JSON.parse(JSON.stringify(saveData.params)), {
		speed: 1
	});
	assert.equal(Object.hasOwn(saveData.params, 'voice'), false);
	assert.equal(Object.hasOwn(saveData.params, 'instruction'), false);
	assert.equal(Object.hasOwn(saveData, 'voice'), false);
	assert.equal(Object.hasOwn(saveData, 'instruction'), false);
});
test('new child full URL toggle persists the inherited Base URL and clears inheritance on the next edit', () => {
	const tree = {
		nodes: [{
			id: 'a',
			name: 'A',
			baseUrl: 'https://parent.example/v1',
			style: 'openai',
			type: 'chat',
			children: []
		}]
	};
	const harness = createEditDialogHarness(tree);
	const nameInput = harness.dialog.querySelector('input[name="name"]');
	let saveData;
	let child;
	harness.context.__showEditGroupDialog(null, 'a', data => {
		saveData = data;
		child = Object.assign({
			id: 'b',
			children: []
		}, data);
		tree.nodes[0].children.push(child);
	});
	nameInput.value = 'B';
	assert.equal(harness.urlInput.value, 'https://parent.example/v1');
	assert.equal(harness.pathSuffix.textContent, '/v1/chat/completions');
	const directUrlToggle = harness.dialog.querySelector('.direct-url.toggle.btn');
	const fullUrlCheckbox = directUrlToggle.querySelector('input[type="checkbox"]');
	fullUrlCheckbox.checked = true;
	assert.equal(typeof fullUrlCheckbox.onchange, 'function');
	fullUrlCheckbox.dispatch('change');
	assert.equal(harness.urlInput.value, 'https://parent.example/v1', 'the toggle must not edit the Base URL input');
	assert.equal(harness.pathSuffix.textContent, '', 'the toggle must cancel /v1/chat/completions');
	harness.okButton.onclick();
	assert.equal(saveData.baseUrl, 'https://parent.example/v1', 'toggling full URL must persist the effective inherited Base URL');
	assert.equal(saveData.isFullUrl, true);
	harness.context.__showEditGroupDialog(child, null, () => {});
	assert.equal(harness.urlInput.value, 'https://parent.example/v1');
	assert.equal(harness.urlInput.parentNode.querySelector('.inherit.icon'), null, 'the saved Base URL must no longer be treated as inherited');
});
test('editing a child after changing its own Base URL removes the stale inherited icon on the next edit', () => {
	const tree = {
		nodes: [{
			id: 'a',
			name: 'A',
			baseUrl: 'https://parent.example/v1',
			style: 'openai',
			type: 'chat',
			children: [{
				id: 'b',
				name: 'B',
				children: []
			}]
		}]
	};
	const harness = createEditDialogHarness(tree);
	const child = tree.nodes[0].children[0];
	harness.context.__showEditGroupDialog(child, null, data => Object.assign(child, data));
	assert.ok(harness.urlInput.parentNode.querySelector('.inherit.icon'), 'the first edit must mark the inherited Base URL');
	harness.urlInput.value = 'https://child.example/v1';
	harness.urlInput.oninput();
	assert.equal(harness.urlInput._inheritIconAdded, false, 'changing to an own Base URL must clear the inherited-marker guard');
	harness.okButton.onclick();
	harness.context.__showEditGroupDialog(child, null, () => {});
	assert.equal(harness.urlInput.parentNode.querySelector('.inherit.icon'), null, 'an own Base URL must not retain the inherited icon');
});
test('removeIcon clears the inherited marker when the DOM icon is already absent', () => {
	const tree = {
		nodes: [{
			id: 'a',
			name: 'A',
			baseUrl: 'https://parent.example/v1',
			style: 'openai',
			type: 'chat',
			children: [{
				id: 'b',
				name: 'B',
				children: []
			}]
		}]
	};
	const harness = createEditDialogHarness(tree);
	const child = tree.nodes[0].children[0];
	harness.context.__showEditGroupDialog(child, null, () => {});
	const icon = harness.urlInput.parentNode.querySelector('.inherit.icon');
	assert.ok(icon, 'the inherited Base URL must initially have an icon');
	icon.remove();
	assert.equal(harness.urlInput._inheritIconAdded, true, 'the marker remains stale after external DOM removal');
	harness.urlInput.oninput();
	assert.equal(harness.urlInput._inheritIconAdded, false, 'removeIcon must reset the marker even without a DOM icon');
});
test('new grandchild path display inherits the complete URL state and does not append the chat path', () => {
	const tree = {
		nodes: [{
			id: 'a',
			name: 'A',
			baseUrl: 'https://parent.example/v1',
			style: 'openai',
			type: 'chat',
			isFullUrl: false,
			children: [{
				id: 'b',
				name: 'B',
				baseUrl: 'https://child.example/v1/chat/completions',
				isFullUrl: true,
				children: []
			}]
		}]
	};
	const harness = createEditDialogHarness(tree);
	harness.context.__showEditGroupDialog(null, 'b', () => {});
	assert.equal(harness.fullUrlCheckbox.checked, true, 'a new child must inherit the parent full URL state');
	assert.equal(harness.pathSuffix.textContent, '', 'a full URL parent must not display /v1/chat/completions for a new child');
});
test('edit URL checkbox resolves the effective node configuration instead of raw node fields', () => {
	const attachmentsSource = fs.readFileSync(attachmentsSourcePath, 'utf8');
	const getEditIsFullUrlSource = extractFunctionDeclaration(attachmentsSource, 'getEditIsFullUrl');
	const context = vm.createContext({
		resolveNodeConfig(nodeId) {
			return {
				legacy: {
					isFullUrl: true
				},
				inherited: {
					isFullUrl: true
				},
				falseOverride: {
					isFullUrl: false
				}
			} [nodeId] || null;
		}
	});
	new vm.Script(`${getEditIsFullUrlSource}\nglobalThis.__getEditIsFullUrl = getEditIsFullUrl;`, {
		filename: attachmentsSourcePath
	}).runInContext(context);
	assert.equal(context.__getEditIsFullUrl({
		id: 'legacy',
		directUrl: true
	}), true);
	assert.equal(context.__getEditIsFullUrl({
		id: 'inherited',
		children: []
	}), true);
	assert.equal(context.__getEditIsFullUrl({
		id: 'falseOverride',
		isFullUrl: false
	}), false);
});
test('isFullUrl leaves unset values absent while preserving explicit and legacy values', async () => {
	const tree = {
		nodes: [{
			id: 'parent',
			name: 'Parent',
			isFullUrl: true,
			children: [{
				id: 'inherit-child',
				name: 'Inherit child',
				children: [{
					id: 'inherit-grandchild',
					name: 'Inherit grandchild',
					children: []
				}]
			}]
		}]
	};
	const harness = createStoreHarness(tree);
	const created = await harness.api.addNode('parent', {
		name: 'Created'
	});
	assert.equal(Object.hasOwn(created, 'isFullUrl'), false);
	assert.equal(Object.hasOwn(created, 'directUrl'), false);
	const createdFalse = await harness.api.addNode('parent', {
		name: 'Created false',
		directUrl: false
	});
	assert.equal(createdFalse.isFullUrl, false);
	assert.equal(Object.hasOwn(createdFalse, 'directUrl'), false);
	const batchIds = await harness.api.batchAddNodes('parent', [{
		name: 'Batch root',
		children: [{
			name: 'Batch child'
		}]
	}]);
	const batchRoot = harness.api.getEndpointsData().nodes[0].children.find(function(node) {
		return node.id === batchIds[0];
	});
	assert.equal(Object.hasOwn(batchRoot, 'isFullUrl'), false);
	assert.equal(Object.hasOwn(batchRoot.children[0], 'isFullUrl'), false);
	const cloned = await harness.api.cloneNode('inherit-child');
	assert.equal(Object.hasOwn(cloned, 'isFullUrl'), false);
	assert.equal(Object.hasOwn(cloned.children[0], 'isFullUrl'), false);
});
test('addNode ignores removal metadata and legacy top-level voice fields', async () => {
	const harness = createStoreHarness({
		nodes: []
	});
	const created = await harness.api.addNode(null, {
		name: 'Created',
		_removeLegacyParamFields: ['voice'],
		voice: 'should-not-be-persisted'
	});
	assert.equal(Object.hasOwn(created, '_removeLegacyParamFields'), false);
	assert.equal(Object.hasOwn(created, 'voice'), false);
});
test('normalizeEndpointFullUrlFlags recursively migrates legacy fields without adding absent overrides', () => {
	const data = {
		nodes: [{
			id: 'root',
			directUrl: true,
			children: [{
				id: 'child',
				isFullUrl: false,
				directUrl: true,
				children: [{
					id: 'legacy-deep',
					directUrl: false,
					children: []
				}]
			}, {
				id: 'inherit',
				children: []
			}]
		}]
	};
	const root = data.nodes[0];
	const child = root.children[0];
	const changed = createStoreHarness({
		nodes: []
	}).api.normalizeEndpointFullUrlFlags(data);
	assert.equal(changed, true);
	assert.equal(data.nodes[0], root);
	assert.equal(data.nodes[0].children[0], child);
	assert.equal(data.nodes[0].isFullUrl, true);
	assert.equal(Object.hasOwn(data.nodes[0], 'directUrl'), false);
	assert.equal(data.nodes[0].children[0].isFullUrl, false);
	assert.equal(Object.hasOwn(data.nodes[0].children[0], 'directUrl'), false);
	assert.equal(data.nodes[0].children[0].children[0].isFullUrl, false);
	assert.equal(Object.hasOwn(data.nodes[0].children[1], 'isFullUrl'), false);
	assert.equal(createStoreHarness({
		nodes: []
	}).api.normalizeEndpointFullUrlFlags({
		nodes: [{
			id: 'unset',
			children: []
		}]
	}), false);
});
test('migrateEndpoints preserves and normalizes direct URL compatibility values', () => {
	const harness = createStoreHarness({
		nodes: []
	});
	const migrated = harness.api.migrateEndpoints({
		groups: [{
			id: 'legacy-group',
			name: 'Legacy group',
			directUrl: true,
			models: [{
				id: 'legacy-model',
				name: 'Legacy model',
				directUrl: false
			}]
		}]
	});
	assert.equal(migrated.nodes[0].isFullUrl, true);
	assert.equal(Object.hasOwn(migrated.nodes[0], 'directUrl'), false);
	assert.equal(migrated.nodes[0].children[0].isFullUrl, false);
	assert.equal(Object.hasOwn(migrated.nodes[0].children[0], 'directUrl'), false);
});
test('updateNode normalizes legacy directUrl updates without retaining the old field', async () => {
	const harness = createStoreHarness({
		nodes: [{
			id: 'node',
			name: 'Node',
			children: []
		}]
	});
	const updated = await harness.api.updateNode('node', {
		directUrl: true
	});
	assert.equal(updated.isFullUrl, true);
	assert.equal(Object.hasOwn(updated, 'directUrl'), false);
});
test('updateNode removes requested top-level fields while applying ordinary updates', async () => {
	const harness = createStoreHarness({
		nodes: [{
			id: 'node',
			name: 'Node',
			voice: 'alloy',
			instruction: 'Speak clearly',
			children: []
		}]
	});
	const updates = {
		name: 'Renamed',
		_removeLegacyParamFields: ['voice', 'instruction']
	};
	const updated = await harness.api.updateNode('node', updates);
	assert.equal(updated.name, 'Renamed');
	assert.equal(Object.hasOwn(updated, 'voice'), false);
	assert.equal(Object.hasOwn(updated, 'instruction'), false);
	assert.equal(Object.hasOwn(updated, '_removeLegacyParamFields'), false);
});
test('updateNode protects structural fields and ignores non-string removal entries', async () => {
	const children = [{
		id: 'child',
		name: 'Child',
		children: []
	}];
	const harness = createStoreHarness({
		nodes: [{
			id: 'node',
			name: 'Node',
			42: 'keep',
			children
		}]
	});
	const updated = await harness.api.updateNode('node', {
		_removeLegacyParamFields: ['id', 'children', 42]
	});
	assert.equal(updated.id, 'node');
	assert.equal(updated.children, children);
	assert.deepEqual(updated.children, [{
		id: 'child',
		name: 'Child',
		children: []
	}]);
	assert.equal(updated['42'], 'keep');
	assert.equal(Object.hasOwn(updated, '_removeLegacyParamFields'), false);
});
test('updateNode does not modify the supplied updates object', async () => {
	const removeFields = ['voice'];
	const params = {
		temperature: 0.7
	};
	const updates = {
		name: 'Renamed',
		params,
		_removeLegacyParamFields: removeFields
	};
	const updatesSnapshot = cloneJson(updates);
	const harness = createStoreHarness({
		nodes: [{
			id: 'node',
			name: 'Node',
			voice: 'alloy',
			children: []
		}]
	});
	await harness.api.updateNode('node', updates);
	assert.equal(updates._removeLegacyParamFields, removeFields);
	assert.equal(updates.params, params);
	assert.deepEqual(updates, updatesSnapshot);
});
test('updateNode safely persists a JSON __proto__ update without polluting the node', async () => {
	const updates = JSON.parse('{"__proto__":{"polluted":true},"name":"Updated"}');
	const updatesSnapshot = JSON.parse(JSON.stringify(updates));
	const tree = {
		nodes: [{
			id: 'node',
			name: 'Node',
			children: []
		}]
	};
	const originalPrototype = Object.getPrototypeOf(tree.nodes[0]);
	const harness = createStoreHarness(tree);
	const updated = await harness.api.updateNode('node', updates);
	const descriptor = Object.getOwnPropertyDescriptor(updated, '__proto__');
	assert.ok(descriptor, '__proto__ should be an own property');
	assert.equal(descriptor.enumerable, true, '__proto__ should be enumerable');
	assert.equal(Object.hasOwn(descriptor, 'value'), true, '__proto__ should be a data property');
	assert.deepEqual(JSON.parse(JSON.stringify(descriptor.value)), {
		polluted: true
	});
	assert.equal(Object.getPrototypeOf(updated), originalPrototype);
	assert.equal(Object.hasOwn(updated, 'polluted'), false);
	assert.equal(updated.polluted, undefined);
	assert.equal(updated.name, 'Updated');
	assert.deepEqual(JSON.parse(JSON.stringify(updates)), updatesSnapshot);
});
test('addNode preserves top-level params absence empty concrete and null states', async () => {
	const harness = createStoreHarness({
		nodes: []
	});
	const noParams = await harness.api.addNode(null, {
		name: 'No params',
		style: 'responses',
		type: 'chat'
	});
	const emptyParams = await harness.api.addNode(null, {
		name: 'Empty params',
		style: 'responses',
		type: 'chat',
		params: {}
	});
	const concreteParams = {
		temperature: 0.7,
		max_tokens: 200
	};
	const concrete = await harness.api.addNode(null, {
		name: 'Concrete params',
		style: 'responses',
		type: 'chat',
		params: concreteParams
	});
	const nullParams = await harness.api.addNode(null, {
		name: 'Null params',
		style: 'responses',
		type: 'chat',
		params: null
	});
	assert.equal(Object.hasOwn(noParams, 'params'), false);
	assert.equal(Object.hasOwn(emptyParams, 'params'), true);
	assert.deepEqual(JSON.parse(JSON.stringify(emptyParams.params)), {});
	assert.deepEqual(JSON.parse(JSON.stringify(concrete.params)), concreteParams);
	assert.equal(nullParams.params, null);
});
test('addNode JSON-snapshots params without restoring a null prototype', async () => {
	const harness = createStoreHarness({
		nodes: []
	});
	const nullPrototypeParams = Object.create(null);
	nullPrototypeParams.temperature = 0.7;
	nullPrototypeParams.hasOwnProperty = 'own parameter value';
	const ordinaryParams = {
		nested: {
			top_p: 0.9
		}
	};
	const nullPrototypeNode = await harness.api.addNode(null, {
		name: 'Null prototype params',
		params: nullPrototypeParams
	});
	const ordinaryNode = await harness.api.addNode(null, {
		name: 'Ordinary params',
		params: ordinaryParams
	});
	assert.equal(harness.api.hasPlainParamsPrototype(nullPrototypeNode.id), true);
	assert.equal(harness.api.resolveNodeConfig(nullPrototypeNode.id).params.temperature, 0.7);
	assert.equal(harness.api.resolveNodeConfig(nullPrototypeNode.id).params.hasOwnProperty, 'own parameter value');
	assert.notEqual(ordinaryNode.params, ordinaryParams);
	assert.notEqual(ordinaryNode.params.nested, ordinaryParams.nested);
	ordinaryParams.nested.top_p = 0.1;
	assert.equal(ordinaryNode.params.nested.top_p, 0.9);
});
test('parameter inheritance distinguishes absence, own values, and model-decides null', () => {
	const harness = createStoreHarness({
		nodes: [{
			id: 'parent',
			params: {
				temperature: 0.7
			},
			children: [{
				id: 'inherit',
				children: []
			}, {
				id: 'own',
				params: {
					temperature: 0.3
				},
				children: []
			}, {
				id: 'model',
				params: {
					temperature: null
				},
				children: []
			}]
		}]
	});
	assert.equal(harness.api.resolveNodeConfig('inherit').params.temperature, 0.7);
	assert.equal(harness.api.resolveNodeConfig('own').params.temperature, 0.3);
	assert.equal(harness.api.resolveNodeConfig('model').params.temperature, null);
});
test('mergeParams omits model-decides null values for every interface style', () => {
	const mergeParams = createMergeParamsHarness();
	const expectedBodies = {
		openai: {},
		claude: {},
		gemini: {
			generationConfig: {}
		},
		responses: {}
	};
	for (const [style, expectedBody] of Object.entries(expectedBodies)) {
		const body = {};
		mergeParams(body, {
			temperature: null
		}, style);
		assert.deepEqual(JSON.parse(JSON.stringify(body)), expectedBody, style);
	}
});
test('mergeParams omits empty stop sequences for Claude and Gemini', () => {
	const mergeParams = createMergeParamsHarness();
	const expectedBodies = {
		claude: {},
		gemini: {
			generationConfig: {}
		}
	};
	for (const [style, expectedBody] of Object.entries(expectedBodies)) {
		const body = {};
		mergeParams(body, {
			stop_sequences: ''
		}, style);
		assert.deepEqual(JSON.parse(JSON.stringify(body)), expectedBody, style);
	}
});
test('mergeParams omits stop sequences that clean to no values for Claude and Gemini', () => {
	const mergeParams = createMergeParamsHarness();
	const expectedBodies = {
		claude: {},
		gemini: {
			generationConfig: {}
		}
	};
	for (const stopSequences of ['   ', ',, ']) {
		for (const [style, expectedBody] of Object.entries(expectedBodies)) {
			const body = {};
			mergeParams(body, {
				stop_sequences: stopSequences
			}, style);
			assert.deepEqual(JSON.parse(JSON.stringify(body)), expectedBody, `${style}: ${JSON.stringify(stopSequences)}`);
		}
	}
});
test('mergeParams omits empty temperature values for every interface style', () => {
	const mergeParams = createMergeParamsHarness();
	const expectedBodies = {
		openai: {},
		claude: {},
		gemini: {
			generationConfig: {}
		},
		responses: {}
	};
	for (const [style, expectedBody] of Object.entries(expectedBodies)) {
		const body = {};
		mergeParams(body, {
			temperature: ''
		}, style);
		assert.deepEqual(JSON.parse(JSON.stringify(body)), expectedBody, style);
	}
});
test('mergeParams trims and removes empty stop sequences for Claude and Gemini', () => {
	const mergeParams = createMergeParamsHarness();
	const expectedBodies = {
		claude: {
			stop_sequences: ['END', 'STOP']
		},
		gemini: {
			generationConfig: {
				stopSequences: ['END', 'STOP']
			}
		}
	};
	for (const [style, expectedBody] of Object.entries(expectedBodies)) {
		const body = {};
		mergeParams(body, {
			stop_sequences: ' END , , STOP '
		}, style);
		assert.deepEqual(JSON.parse(JSON.stringify(body)), expectedBody, style);
	}
});
test('responses reasoning is created only for an explicit effort', () => {
	const mergeParams = createMergeParamsHarness();
	const nullBody = {};
	mergeParams(nullBody, {
		reasoning_effort: null
	}, 'responses');
	assert.deepEqual(JSON.parse(JSON.stringify(nullBody)), {});
	const emptyBody = {};
	mergeParams(emptyBody, {
		reasoning_effort: ''
	}, 'responses');
	assert.deepEqual(JSON.parse(JSON.stringify(emptyBody)), {});
	const ownBody = {};
	mergeParams(ownBody, {
		reasoning_effort: 'low'
	}, 'responses');
	assert.deepEqual(JSON.parse(JSON.stringify(ownBody)), {
		reasoning: {
			effort: 'low'
		}
	});
});
test('edit save omits inherited full URL until the checkbox changes', () => {
	const attachmentsSource = fs.readFileSync(attachmentsSourcePath, 'utf8');
	const shouldSaveIsFullUrlSource = extractFunctionDeclaration(attachmentsSource, 'shouldSaveIsFullUrl');
	const context = vm.createContext({});
	new vm.Script(`${shouldSaveIsFullUrlSource}\nglobalThis.__shouldSaveIsFullUrl = shouldSaveIsFullUrl;`).runInContext(context);
	assert.equal(context.__shouldSaveIsFullUrl({
		id: 'child'
	}, true, true, false), false);
	assert.equal(context.__shouldSaveIsFullUrl({
		id: 'child'
	}, true, false, true), true);
	assert.equal(context.__shouldSaveIsFullUrl({
		id: 'legacy',
		directUrl: false
	}, false, false, false), true);
	assert.equal(context.__shouldSaveIsFullUrl({
		id: 'modern',
		isFullUrl: true
	}, true, true, false), true);
});
test('callEmbedding declares params and main forwards resolved embedding parameters', () => {
	const sharedSource = fs.readFileSync(path.join(__dirname, '..', 'src', 'modules', 'shared.js'), 'utf8');
	const mainSource = fs.readFileSync(mainSourcePath, 'utf8');
	const signature = extractFunctionDeclaration(sharedSource, 'callEmbedding').slice(0, extractFunctionDeclaration(sharedSource, 'callEmbedding').indexOf('{'));
	assert.match(signature, /input\s*,\s*isFullUrl\s*,\s*params/);
	assert.match(extractFunctionDeclaration(mainSource, 'handleSend'), /callEmbedding\([^;]*cfg\.isFullUrl\s*,\s*cfg\.params\)/);
});
test('isFullUrl prefers an explicit child value, falls back to legacy data, and survives new nodes and cloning', async () => {
	const tree = {
		nodes: [{
			id: 'parent',
			name: 'Parent',
			isFullUrl: true,
			children: [{
				id: 'child-false',
				name: 'Explicit false',
				isFullUrl: false,
				children: []
			}, {
				id: 'child-inherited',
				name: 'Inherited',
				children: []
			}, {
				id: 'legacy',
				name: 'Legacy',
				directUrl: true,
				children: []
			}, {
				id: 'new-wins',
				name: 'New wins',
				isFullUrl: false,
				directUrl: true,
				children: []
			}]
		}]
	};
	const harness = createStoreHarness(tree);
	assert.equal(harness.api.resolveNodeConfig('child-false').isFullUrl, false);
	assert.equal(harness.api.resolveNodeConfig('child-inherited').isFullUrl, true);
	assert.equal(harness.api.resolveNodeConfig('legacy').isFullUrl, true);
	assert.equal(harness.api.resolveNodeConfig('new-wins').isFullUrl, false);
	const created = await harness.api.addNode(null, {
		name: 'Created',
		isFullUrl: true
	});
	assert.equal(created.isFullUrl, true);
	assert.equal(Object.hasOwn(created, 'directUrl'), false);
	const legacyUpdated = await harness.api.updateNode('legacy', {
		isFullUrl: false
	});
	assert.equal(legacyUpdated.isFullUrl, false);
	assert.equal(Object.hasOwn(legacyUpdated, 'directUrl'), false);
	assert.equal(harness.api.resolveNodeConfig('legacy').isFullUrl, false);
	const cloned = await harness.api.cloneNode('parent');
	assert.equal(cloned.isFullUrl, true);
	assert.equal(cloned.children[0].isFullUrl, false);
	assert.equal(Object.hasOwn(cloned, 'directUrl'), false);
	assert.equal(Object.hasOwn(cloned.children[2], 'directUrl'), false);
});
test('reorderNode moves a node to the target position exactly once and persists once', async () => {
	const tree = {
		nodes: [{
			id: 'target',
			name: 'Target',
			children: []
		}, {
			id: 'middle',
			name: 'Middle',
			children: []
		}, {
			id: 'dragged',
			name: 'Dragged',
			children: [{
				id: 'dragged-child',
				name: 'Dragged child',
				children: []
			}]
		}]
	};
	const harness = createStoreHarness(tree);
	const result = await harness.api.reorderNode('dragged', 'target', true);
	const updatedTree = harness.api.getEndpointsData();
	assert.equal(result, true);
	assert.deepEqual(updatedTree.nodes.map(node => node.id),
		['dragged', 'target', 'middle']);
	assert.deepEqual(updatedTree.nodes[0].children.map(node => node.id),
		['dragged-child']);
	assert.equal(countNodesById(updatedTree.nodes, 'dragged'), 1);
	assert.equal(harness.getSaveCount(), 1);
});
test('moveNodeAsChild appends a node under the target exactly once and persists once', async () => {
	const tree = {
		nodes: [{
			id: 'dragged',
			name: 'Dragged',
			children: [{
				id: 'dragged-child',
				name: 'Dragged child',
				children: []
			}]
		}, {
			id: 'target',
			name: 'Target parent',
			children: [{
				id: 'existing-child',
				name: 'Existing child',
				children: []
			}]
		}, {
			id: 'sibling',
			name: 'Sibling',
			children: []
		}]
	};
	const harness = createStoreHarness(tree);
	const result = await harness.api.moveNodeAsChild('dragged', 'target');
	const updatedTree = harness.api.getEndpointsData();
	assert.equal(result, true);
	assert.deepEqual(updatedTree.nodes.map(node => node.id),
		['target', 'sibling']);
	assert.deepEqual(updatedTree.nodes[0].children.map(node => node.id),
		['existing-child', 'dragged']);
	assert.deepEqual(updatedTree.nodes[0].children[1].children.map(node => node.id),
		['dragged-child']);
	assert.equal(countNodesById(updatedTree.nodes, 'dragged'), 1);
	assert.equal(harness.getSaveCount(), 1);
});
const guardedStoreOperations = [{
	name: 'reorderNode',
	run(api, targetId) {
		return api.reorderNode('dragged', targetId, true);
	}
}, {
	name: 'moveNodeAsChild',
	run(api, targetId) {
		return api.moveNodeAsChild('dragged', targetId);
	}
}];
const invalidTargets = [{
	name: 'the dragged node itself',
	id: 'dragged'
}, {
	name: 'a missing target',
	id: 'missing'
}];
guardedStoreOperations.forEach(operation => {
	invalidTargets.forEach(target => {
		test(`${operation.name} rejects ${target.name} without mutation or persistence`, async () => {
			const tree = createGuardTree();
			const originalTree = cloneJson(tree);
			const harness = createStoreHarness(tree);
			const result = await operation.run(harness.api, target.id);
			assertRejectedWithoutChanges(result, harness, originalTree);
		});
	});
});
test('reorderNode rejects a target inside the dragged subtree without mutation or persistence', async () => {
	const tree = createDescendantTargetTree();
	const originalTree = cloneJson(tree);
	const harness = createStoreHarness(tree);
	const result = await harness.api.reorderNode('dragged', 'target', true);
	assertRejectedWithoutChanges(result, harness, originalTree);
});
test('moveNodeAsChild rejects a target inside the dragged subtree without mutation or persistence', async () => {
	const tree = createDescendantTargetTree();
	const originalTree = cloneJson(tree);
	const harness = createStoreHarness(tree);
	const result = await harness.api.moveNodeAsChild('dragged', 'target');
	assertRejectedWithoutChanges(result, harness, originalTree);
});
test('handleAddGroup does not append a node already inserted by a complete tree render during addNode', async () => {
	let onSubmit;
	let treeWasRendered = false;
	let buildCount = 0;
	let appendCount = 0;
	const newNode = {
		id: 'new-group',
		name: 'New group',
		children: []
	};
	const existingNodeEl = {};
	const container = {
		appendChild() {
			appendCount += 1;
		},
		querySelector(selector) {
			return treeWasRendered && selector.includes(newNode.id) ? existingNodeEl : null;
		}
	};
	const mainSource = fs.readFileSync(mainSourcePath, 'utf8');
	const handleAddGroupSource = extractFunctionDeclaration(mainSource, 'handleAddGroup');
	const context = vm.createContext({
		addNode: async () => {
			treeWasRendered = true;
			return newNode;
		},
		applyEndpointFilter() {},
		buildEndpointNodeEl() {
			buildCount += 1;
			return {};
		},
		document: {
			querySelector(selector) {
				if (selector === 'aside.endpoint.list > ol') return container;
				return treeWasRendered && selector.includes(newNode.id) ? existingNodeEl : null;
			}
		},
		refreshUI: async () => {},
		showEditGroupDialog(_node, _parentId, submit) {
			onSubmit = submit;
		},
		updateEmptyState() {}
	});
	new vm.Script(`${handleAddGroupSource}\nglobalThis.__handleAddGroup = handleAddGroup;`, {
		filename: mainSourcePath
	}).runInContext(context);
	context.__handleAddGroup();
	await onSubmit({
		name: 'New group'
	});
	assert.equal(buildCount, 0);
	assert.equal(appendCount, 0);
});
test('handleAddChildClick does not append a node already inserted by a complete tree render during addNode', async () => {
	let onSubmit;
	let buildCount = 0;
	let appendCount = 0;
	const newNode = {
		id: 'new-child',
		name: 'New child',
		children: []
	};
	const existingNodeEl = {};
	const childList = {
		appendChild() {
			appendCount += 1;
		},
		querySelector(selector) {
			return selector.includes(newNode.id) ? existingNodeEl : null;
		}
	};
	const detailsEl = {
		open: false
	};
	const refreshedNodeEl = {
		classList: {
			remove() {}
		},
		dataset: {
			nodeId: 'parent-node'
		},
		querySelector(selector) {
			if (selector === 'details > ol.children') return childList;
			if (selector === 'details') return detailsEl;
			if (selector === '.name') return {
				classList: {
					add() {}
				}
			};
			return selector.includes(newNode.id) ? existingNodeEl : null;
		}
	};
	const originalNodeEl = {
		isConnected: true,
		dataset: {
			nodeId: 'parent-node'
		}
	};
	const button = {
		closest() {
			return originalNodeEl;
		}
	};
	const endpointTreeSource = fs.readFileSync(endpointTreeSourcePath, 'utf8');
	const handleAddChildClickSource = extractFunctionDeclaration(endpointTreeSource, 'handleAddChildClick');
	const context = vm.createContext({
		addNode: async () => {
			originalNodeEl.isConnected = false;
			return newNode;
		},
		applyEndpointFilter() {},
		buildEndpointNodeEl() {
			buildCount += 1;
			return {};
		},
		document: {
			createElement() {
				throw new Error('The refreshed tree already has a child list');
			},
			querySelector(selector) {
				if (selector.includes('parent-node')) return refreshedNodeEl;
				return selector.includes(newNode.id) ? existingNodeEl : null;
			}
		},
		refreshUI: async () => {},
		showEditGroupDialog(_node, _parentId, submit) {
			onSubmit = submit;
		},
		updateEmptyState() {}
	});
	new vm.Script(`${handleAddChildClickSource}\nglobalThis.__handleAddChildClick = handleAddChildClick;`, {
		filename: endpointTreeSourcePath
	}).runInContext(context);
	context.__handleAddChildClick(button);
	await onSubmit({
		name: 'New child'
	});
	assert.equal(buildCount, 0);
	assert.equal(appendCount, 0);
});
test('applyEndpointFilter removes hidden from every endpoint when no type filters are active', () => {
	function createClassList(...initialClasses) {
		const classes = new Set(initialClasses);
		return {
			add(...names) {
				names.forEach(name => classes.add(name));
			},
			contains(name) {
				return classes.has(name);
			},
			remove(...names) {
				names.forEach(name => classes.delete(name));
			},
			toggle(name, force) {
				if (force) classes.add(name);
				else classes.delete(name);
			}
		};
	}

	function createEndpoint(typeClass) {
		return {
			classList: createClassList('hidden'),
			querySelector(selector) {
				if (selector === '.endpoint-type') return {
					classList: createClassList(typeClass)
				};
				if (selector === 'details > ol') return null;
				throw new Error(`Unexpected endpoint selector: ${selector}`);
			}
		};
	}
	const endpoints = [createEndpoint('chat'), createEndpoint('digits')];
	const endpointTreeSource = fs.readFileSync(endpointTreeSourcePath, 'utf8');
	const applyEndpointFilterSource = extractFunctionDeclaration(endpointTreeSource, 'applyEndpointFilter');
	const context = vm.createContext({
		activeTypeFilters: new Set(),
		document: {
			querySelectorAll(selector) {
				assert.equal(selector, 'aside.endpoint.list li.one.endpoint');
				return endpoints;
			}
		}
	});
	new vm.Script(`${applyEndpointFilterSource}\nglobalThis.__applyEndpointFilter = applyEndpointFilter;`, {
		filename: endpointTreeSourcePath
	}).runInContext(context);
	context.__applyEndpointFilter();
	endpoints.forEach(endpoint => assert.equal(endpoint.classList.contains('hidden'), false));
});
test('handleWipeDirectory clears persisted directory data exactly once in standard and extension pages', async () => {
	const mainSource = fs.readFileSync(mainSourcePath, 'utf8');
	const storeSource = fs.readFileSync(storeSourcePath, 'utf8');
	const handleWipeDirectorySource = extractFunctionDeclaration(mainSource, 'handleWipeDirectory');
	const clearDirectorySource = extractFunctionDeclaration(storeSource, 'clearDirectory');
	for (const isExtension of [false, true]) {
		let storageClearCount = 0;
		let directoryClearCount = 0;
		const confirmations = [];
		const context = vm.createContext({
			DirectoryStorage: {
				async clearAll() {
					directoryClearCount += 1;
				}
			},
			Map,
			alert() {},
			confirmAction(_message, onConfirm) {
				confirmations.push(onConfirm);
			},
			refreshUI: async () => {},
			sessionsCache: new Map(),
			showDirectoryPrompt() {},
			storage: {
				getDirectoryName() {
					return 'test-directory';
				},
				mode: 'directory',
				async clearAll() {
					storageClearCount += 1;
				}
			},
			updateDirectoryDisplay: async () => {},
			window: {
				__IS_EXTENSION__: isExtension
			}
		});
		const harnessSource = ['var endpointsData = null;', 'var endpointsMutationQueue = Promise.resolve();', 'var sessionMutationQueues = new Map();', 'var activeStorageSaves = new Set();', 'var clearGeneration = 0;', 'var clearInProgress = false;', 'async ' + clearDirectorySource,
			handleWipeDirectorySource, 'globalThis.__handleWipeDirectory = handleWipeDirectory;'
		].join(String.fromCharCode(10));
		new vm.Script(harnessSource, {
			filename: mainSourcePath
		}).runInContext(context);
		await context.__handleWipeDirectory();
		assert.equal(confirmations.length, 1, 'first confirmation must be retained');
		await confirmations.shift()();
		assert.equal(confirmations.length, 1, 'second confirmation must be retained');
		await confirmations.shift()();
		assert.equal(storageClearCount, 1, 'storage.clearAll must run once when isExtension=' + isExtension);
		assert.equal(directoryClearCount, 0, 'DirectoryStorage.clearAll must be delegated through clearDirectory when isExtension=' + isExtension);
	}
});
test('endpoint connection testing uses one eligibility rule and explicit resolved types', async () => {
	const endpointTreeSource = fs.readFileSync(endpointTreeSourcePath, 'utf8');
	const mainSource = fs.readFileSync(mainSourcePath, 'utf8');
	const attachmentsSource = fs.readFileSync(path.join(__dirname, '..', 'src', 'modules', 'attachments.js'), 'utf8');
	const eligibilitySource = extractFunctionDeclaration(endpointTreeSource, 'isEndpointTestable');
	['buildEndpointNodeEl', 'renderEndpointList', 'updateEndpointTestUI'].forEach(function(functionName) {
		assert.match(extractFunctionDeclaration(endpointTreeSource, functionName), /isEndpointTestable\(/, functionName + ' must reuse isEndpointTestable');
	});
	assert.match(extractFunctionDeclaration(mainSource, 'handleTestAllConnections'), /isEndpointTestable\(/, 'handleTestAllConnections must reuse isEndpointTestable');
	assert.match(extractFunctionDeclaration(attachmentsSource.slice(attachmentsSource.indexOf('function testConnection')), 'testConnection'), /isEndpointTestable\(/, 'testConnection must reuse isEndpointTestable');
	const configs = {
		chat: {
			baseUrl: 'https://example.test',
			key: '',
			modelId: 'model',
			type: 'chat'
		},
		embedding: {
			baseUrl: 'https://example.test',
			key: '',
			modelId: 'model',
			type: 'embedding'
		},
		embed: {
			baseUrl: 'https://example.test',
			key: '',
			modelId: 'model',
			type: 'embed'
		},
		tts: {
			baseUrl: 'https://example.test',
			key: '',
			modelId: 'chat-looking-model',
			type: 'tts'
		},
		asr: {
			baseUrl: 'https://example.test',
			key: '',
			modelId: 'chat-looking-model',
			type: 'asr'
		},
		missingTestFn: {
			baseUrl: 'https://example.test',
			key: '',
			modelId: 'chat-looking-model',
			style: 'missing-tts',
			type: 'tts'
		},
		missingProvider: {
			baseUrl: 'https://example.test',
			key: '',
			modelId: 'model',
			style: 'missing-provider',
			type: 'chat'
		},
		image: {
			baseUrl: 'https://example.test',
			key: '',
			modelId: 'model',
			type: 'image-generation'
		},
		video: {
			baseUrl: 'https://example.test',
			key: '',
			modelId: 'model',
			type: 'video-generation'
		},
		reranking: {
			baseUrl: 'https://example.test',
			key: '',
			modelId: 'model',
			type: 'reranking'
		},
		missingKey: {
			baseUrl: 'https://example.test',
			modelId: 'model',
			type: 'chat'
		}
	};
	const eligibleIds = new Set(['chat', 'embedding', 'embed', 'tts', 'asr', 'missingTestFn', 'missingProvider']);
	const testCases = [{
		id: 'tts',
		expectedCall: 'tts'
	}, {
		id: 'asr',
		expectedCall: 'asr'
	}, {
		id: 'image'
	}, {
		id: 'video'
	}, {
		id: 'reranking'
	}, {
		id: 'missingTestFn',
		expectedStatus: 'failed',
		expectedUiUpdates: 2
	}, {
		id: 'missingProvider',
		expectedStatus: 'failed',
		expectedUiUpdates: 2
	}];
	const eligibilityContext = vm.createContext({
		resolveNodeConfig(nodeId) {
			return configs[nodeId];
		}
	});
	new vm.Script(eligibilitySource + '\nglobalThis.__isEndpointTestable = isEndpointTestable;').runInContext(eligibilityContext);
	Object.keys(configs).forEach(function(id) {
		assert.equal(eligibilityContext.__isEndpointTestable(id), eligibleIds.has(id), id + ' eligibility');
	});
	const calls = [];
	const uiUpdates = [];
	const connectionTestBlock = attachmentsSource.slice(attachmentsSource.indexOf('const connectionStatus = new Map()'), attachmentsSource.indexOf('let attachmentTooltip = null;'));
	const testContext = vm.createContext({
		Date,
		FormData,
		detectModelType() {
			return 'chat';
		},
		fetchWithTimeout: async function() {
			return {
				ok: true,
				headers: {
					get() {
						return 'text/plain';
					}
				}
			};
		},
		getNode() {
			return {};
		},
		isEndpointTestable(nodeId) {
			return eligibleIds.has(nodeId);
		},
		mergeParams() {},
		providers: {
			openai: {
				testConfig() {
					calls.push('chat');
					return {
						url: 'https://example.test',
						headers: {},
						body: {}
					};
				},
				testEmbeddingConfig() {
					calls.push('embedding');
					return {
						url: 'https://example.test',
						headers: {},
						body: {}
					};
				},
				testTTSConfig() {
					calls.push('tts');
					return {
						url: 'https://example.test',
						headers: {},
						body: {}
					};
				},
				testASRConfig() {
					calls.push('asr');
					return {
						url: 'https://example.test',
						headers: {},
						body: {}
					};
				}
			},
			'missing-tts': {}
		},
		resolveNodeConfig(nodeId) {
			return configs[nodeId];
		},
		updateEndpointTestUI(nodeId) {
			uiUpdates.push(nodeId);
		}
	});
	new vm.Script(connectionTestBlock + '\nglobalThis.__testConnection = testConnection;\nglobalThis.__connectionStatus = connectionStatus;').runInContext(testContext);
	for (const scenario of testCases) {
		await testContext.__testConnection(scenario.id);
		if (scenario.expectedStatus) {
			assert.equal(testContext.__connectionStatus.get(scenario.id).status, scenario.expectedStatus, scenario.id + ' must not remain testing without a provider test function');
			assert.equal(uiUpdates.filter(nodeId => nodeId === scenario.id).length, scenario.expectedUiUpdates, scenario.id + ' must update its UI after the failed test');
		}
	}
	assert.deepEqual(calls, testCases.filter(scenario => scenario.expectedCall).map(scenario => scenario.expectedCall), 'only TTS and ASR use their explicit test functions; unsupported types must not fall back to chat');
});
test('testConnection reuses one in-flight Promise per node and allows a later retry', async () => {
	const attachmentsSource = fs.readFileSync(path.join(__dirname, '..', 'src', 'modules', 'attachments.js'), 'utf8');
	const connectionTestBlock = attachmentsSource.slice(attachmentsSource.indexOf('const connectionStatus = new Map()'), attachmentsSource.indexOf('let attachmentTooltip = null;'));
	const pendingFetches = [];
	let fetchCallCount = 0;
	let providerCallCount = 0;
	const context = vm.createContext({
		Date,
		FormData,
		fetchWithTimeout() {
			fetchCallCount += 1;
			return new Promise(function(resolve) {
				pendingFetches.push(resolve);
			});
		},
		getNode() {
			return {};
		},
		isEndpointTestable() {
			return true;
		},
		mergeParams() {},
		providers: {
			openai: {
				testConfig() {
					providerCallCount += 1;
					return {
						url: 'https://example.test',
						headers: {},
						body: {}
					};
				}
			}
		},
		resolveNodeConfig() {
			return {
				baseUrl: 'https://example.test',
				key: '',
				modelId: 'model',
				type: 'chat'
			};
		},
		updateEndpointTestUI() {}
	});
	new vm.Script(connectionTestBlock + '\n\nglobalThis.__testConnection = testConnection;', {
		filename: path.join(__dirname, '..', 'src', 'modules', 'attachments.js')
	}).runInContext(context);
	const firstTest = context.__testConnection('chat');
	const concurrentTest = context.__testConnection('chat');
	assert.strictEqual(concurrentTest, firstTest);
	assert.equal(fetchCallCount, 1);
	assert.equal(providerCallCount, 1);
	pendingFetches.shift()({
		ok: true,
		headers: {
			get() {
				return 'text/plain';
			}
		}
	});
	await firstTest;
	const retry = context.__testConnection('chat');
	assert.equal(fetchCallCount, 2);
	assert.equal(providerCallCount, 2);
	pendingFetches.shift()({
		ok: true,
		headers: {
			get() {
				return 'text/plain';
			}
		}
	});
	await retry;
});
test('stale connection test completion cannot restore cleared results or update old result UI', async () => {
	const attachmentsSource = fs.readFileSync(path.join(__dirname, '..', 'src', 'modules', 'attachments.js'), 'utf8');
	const connectionTestBlock = attachmentsSource.slice(attachmentsSource.indexOf('const connectionStatus = new Map()'), attachmentsSource.indexOf('let attachmentTooltip = null;'));
	let resolveFetch;
	const uiUpdates = [];
	const context = vm.createContext({
		Date,
		FormData,
		fetchWithTimeout() {
			return new Promise(function(resolve) {
				resolveFetch = resolve;
			});
		},
		getNode() {
			return {};
		},
		isEndpointTestable() {
			return true;
		},
		mergeParams() {},
		providers: {
			openai: {
				testConfig() {
					return {
						url: 'https://example.test',
						headers: {},
						body: {}
					};
				}
			}
		},
		resolveNodeConfig() {
			return {
				baseUrl: 'https://example.test',
				key: '',
				modelId: 'model',
				type: 'chat'
			};
		},
		updateEndpointTestUI(nodeId) {
			uiUpdates.push(nodeId);
		}
	});
	new vm.Script(connectionTestBlock + '\n\nglobalThis.__testConnection = testConnection;\nglobalThis.__clearTestResults = clearTestResults;\nglobalThis.__connectionStatus = connectionStatus;', {
		filename: path.join(__dirname, '..', 'src', 'modules', 'attachments.js')
	}).runInContext(context);
	const pendingTest = context.__testConnection('chat');
	context.__clearTestResults('chat');
	resolveFetch({
		ok: true,
		headers: {
			get() {
				return 'text/plain';
			}
		}
	});
	await pendingTest;
	assert.equal(context.__connectionStatus.has('chat'), false);
	assert.deepEqual(uiUpdates, ['chat']);
});
test('clearTestResults retains P1 until it settles before allowing a second connection test', async () => {
	const attachmentsSource = fs.readFileSync(path.join(__dirname, '..', 'src', 'modules', 'attachments.js'), 'utf8');
	const connectionTestBlock = attachmentsSource.slice(attachmentsSource.indexOf('const connectionStatus = new Map()'), attachmentsSource.indexOf('let attachmentTooltip = null;'));
	const pendingFetches = [];
	let fetchCallCount = 0;
	let providerCallCount = 0;
	const context = vm.createContext({
		Date,
		FormData,
		fetchWithTimeout() {
			fetchCallCount += 1;
			return new Promise(function(resolve) {
				pendingFetches.push(resolve);
			});
		},
		getNode() {
			return {};
		},
		isEndpointTestable() {
			return true;
		},
		mergeParams() {},
		providers: {
			openai: {
				testConfig() {
					providerCallCount += 1;
					return {
						url: 'https://example.test',
						headers: {},
						body: {}
					};
				}
			}
		},
		resolveNodeConfig() {
			return {
				baseUrl: 'https://example.test',
				key: '',
				modelId: 'model',
				type: 'chat'
			};
		},
		updateEndpointTestUI() {}
	});
	new vm.Script(connectionTestBlock + '\n\nglobalThis.__testConnection = testConnection;\nglobalThis.__clearTestResults = clearTestResults;', {
		filename: path.join(__dirname, '..', 'src', 'modules', 'attachments.js')
	}).runInContext(context);
	const p1 = context.__testConnection('chat');
	context.__clearTestResults('chat');
	const duringClear = context.__testConnection('chat');
	assert.strictEqual(duringClear, p1, 'clearing results must not permit a duplicate in-flight request');
	assert.equal(fetchCallCount, 1, 'P1 remains the only fetch until it settles');
	assert.equal(providerCallCount, 1, 'P1 remains the only provider invocation until it settles');
	pendingFetches.shift()({
		ok: true,
		headers: {
			get() {
				return 'text/plain';
			}
		}
	});
	await p1;
	const p2 = context.__testConnection('chat');
	assert.notStrictEqual(p2, p1);
	assert.equal(fetchCallCount, 2, 'only the post-settlement call may start P2');
	assert.equal(providerCallCount, 2, 'only the post-settlement call may invoke the provider again');
	pendingFetches.shift()({
		ok: true,
		headers: {
			get() {
				return 'text/plain';
			}
		}
	});
	await p2;
});
test('workspace/session parameter transaction rejects and rolls back when the target session is absent', async () => {
	const endpointId = 'endpoint-1';
	const workspaceBefore = {
		[endpointId]: {
			temperature: 0.2,
			topP: 0.9
		}
	};
	const rawWorkspaceBefore = '{\n  "endpoint-1": { "temperature": 0.2, "topP": 0.9 }\n}';
	const sessionBefore = {
		id: 'session-1',
		modelParams: {
			[endpointId]: {
				temperature: 0.6
			}
		}
	};
	const harness = createSelectedEndpointsHarness({
		currentSession: sessionBefore,
		workspaceRaw: rawWorkspaceBefore,
		updateSession() {
			return null;
		}
	});
	await assert.rejects(harness.api.persistEndpointParamsTransaction(endpointId, {
		temperature: 1.1
	}, sessionBefore.id, function(session) {
		session.modelParams[endpointId] = {
			temperature: 1.1
		};
	}), function(error) {
		assert.match(error.message, /目标会话.*(不存在|未保存)|(不存在|未保存).*目标会话/);
		return true;
	});
	assert.equal(harness.getUpdateSessionCallCount(), 1);
	assert.deepEqual(cloneJson(harness.api.getDefaultSelectedEndpointParams()), workspaceBefore);
	assert.equal(harness.localStorage.getItem('defaultSelectedEndpointParams'), rawWorkspaceBefore);
	assert.deepEqual(harness.currentSession, sessionBefore);
});
class ModelParamClassList {
	constructor(element) {
		this.element = element;
		this.values = new Set(element.className.split(/[\s,]+/).filter(Boolean));
	}
	add(...names) {
		names.forEach(name => this.values.add(name));
	}
	remove(...names) {
		names.forEach(name => this.values.delete(name));
	}
	contains(name) {
		return this.values.has(name);
	}
	toggle(name, force) {
		const next = force === undefined ? !this.contains(name) : force;
		if (next) this.add(name);
		else this.remove(name);
		return next;
	}
}
class ModelParamElement {
	constructor(tagName, className = '') {
		this.tagName = tagName.toUpperCase();
		this.className = className;
		this.classList = new ModelParamClassList(this);
		this.children = [];
		this.parentElement = null;
		this.dataset = {};
		this.style = {};
		this.listeners = new Map();
		this.value = '';
		this.checked = false;
		this.name = '';
		this.type = tagName === 'input' ? 'text' : '';
		this.textContent = '';
		this.focused = false;
	}
	focus() {
		this.focused = true;
	}
	appendChild(child) {
		child.parentElement = this;
		this.children.push(child);
		return child;
	}
	insertBefore(child, reference) {
		child.parentElement = this;
		const index = this.children.indexOf(reference);
		if (index < 0) this.children.push(child);
		else this.children.splice(index, 0, child);
		return child;
	}
	removeChild(child) {
		this.children.splice(this.children.indexOf(child), 1);
		child.parentElement = null;
	}
	get firstChild() {
		return this.children[0] || null;
	}
	get innerHTML() {
		return '';
	}
	set innerHTML(value) {
		if (value === '') this.children = [];
	}
	addEventListener(type, listener) {
		if (!this.listeners.has(type)) this.listeners.set(type, []);
		this.listeners.get(type).push(listener);
	}
	focus() {
		this.focused = true;
	}
	dispatch(type) {
		(this.listeners.get(type) || []).forEach(listener => listener.call(this, {
			type,
			currentTarget: this
		}));
	}
	matches(selector) {
		const tag = selector.match(/^[a-z][\w-]*/i);
		if (tag && this.tagName !== tag[0].toUpperCase()) return false;
		for (const match of selector.matchAll(/\.([\w-]+)/g))
			if (!this.classList.contains(match[1])) return false;
		const type = selector.match(/\[type=["']?([^\]"']+)["']?\]/);
		return !type || this.type === type[1];
	}
	querySelectorAll(selector) {
		const selectors = selector.split(',').map(value => value.trim());
		const results = [];
		const visit = element => element.children.forEach(child => {
			if (selectors.some(candidate => child.matches(candidate))) results.push(child);
			visit(child);
		});
		visit(this);
		return results;
	}
	querySelector(selector) {
		return this.querySelectorAll(selector)[0] || null;
	}
	cloneNode(deep) {
		const copy = new ModelParamElement(this.tagName, this.className);
		copy.dataset = {
			...this.dataset
		};
		copy.style = {
			...this.style
		};
		copy.value = this.value;
		copy.checked = this.checked;
		copy.name = this.name;
		copy.type = this.type;
		copy.textContent = this.textContent;
		if (deep) this.children.forEach(child => copy.appendChild(child.cloneNode(true)));
		return copy;
	}
}

function createModelParamTemplateFromLayout() {
	const layoutSource = fs.readFileSync(path.join(__dirname, '..', 'src', 'layout.html'), 'utf8');
	const match = layoutSource.match(/<template id="model-param-row">([\s\S]*?)<\/template>/);
	if (!match) throw new Error('layout.html is missing #model-param-row');
	const holder = new ModelParamElement('fragment');
	const stack = [holder];
	const tokens = match[1].match(/<\/?[^>]+>|[^<]+/g) || [];
	tokens.forEach(token => {
		if (token.startsWith('</')) {
			stack.pop();
			return;
		}
		if (!token.startsWith('<')) {
			const text = token.trim();
			if (text) stack[stack.length - 1].textContent += text;
			return;
		}
		const tagMatch = token.match(/^<([\w-]+)/);
		if (!tagMatch) return;
		const element = new ModelParamElement(tagMatch[1]);
		for (const attribute of token.matchAll(/([\w-]+)(?:="([^"]*)")?/g)) {
			const [, name, value = ''] = attribute;
			if (name === tagMatch[1]) continue;
			if (name === 'class') {
				element.className = value;
				element.classList = new ModelParamClassList(element);
			} else if (name === 'type') {
				element.type = value;
			} else if (name === 'value') {
				element.value = value;
			}
		}
		stack[stack.length - 1].appendChild(element);
		if (!/\/>$/.test(token) && !['input', 'br', 'hr', 'img'].includes(element.tagName.toLowerCase())) stack.push(element);
	});
	return {
		content: holder
	};
}

function createModelParamControlsHarness() {
	const template = createModelParamTemplateFromLayout();
	const document = {
		createElement(tagName) {
			return new ModelParamElement(tagName);
		},
		querySelector(selector) {
			return selector === '#model-param-row' ? template : null;
		}
	};
	const container = new ModelParamElement('div', 'param-control list');
	const providersSource = fs.readFileSync(path.join(__dirname, '..', 'src', 'modules', 'providers.js'), 'utf8');
	const uiUtilsSource = fs.readFileSync(path.join(__dirname, '..', 'src', 'modules', 'ui-utils.js'), 'utf8');
	const context = vm.createContext({
		JSON,
		document,
		window: {
			addEventListener() {}
		},
		getComputedStyle() {
			return {
				minHeight: '160'
			};
		},
		localStorage: {
			getItem() {
				return null;
			},
			removeItem() {},
			setItem() {}
		},
		ResizeObserver: class {
			observe() {}
		}
	});
	const source = ['const doc = document;', 'function $(selector, ctx = doc) { return ctx.querySelector(selector); }',
		extractFunctionDeclaration(providersSource, 'fromTemplate'),
		uiUtilsSource, "globalThis.__modelParamControls = { renderModelParamControls: typeof renderModelParamControls === 'function' ? renderModelParamControls : null, collectModelParamControls: typeof collectModelParamControls === 'function' ? collectModelParamControls : null };"
	].join('\n');
	new vm.Script(source, {
		filename: uiUtilsSource
	}).runInContext(context);
	return {
		api: context.__modelParamControls,
		container
	};
}

function modelParamDefinitions() {
	return [{
		key: 'temperature',
		label: '温度',
		type: 'range',
		min: 0,
		max: 2,
		step: 0.1,
		default: 1
	}, {
		key: 'max_tokens',
		label: '最大 Token 数',
		type: 'integer',
		min: 1,
		default: 4096
	}, {
		key: 'reasoning_effort',
		label: '思考强度',
		type: 'select',
		options: ['low', 'medium', 'high'],
		default: 'high'
	}];
}

function endpointParamDefinitions(type, style) {
	if (type === 'embedding') return [];
	if (type === 'tts') {
		return [{
			key: 'voice',
			label: '音色',
			type: 'text'
		}, {
			key: 'instruction',
			label: '指令',
			type: 'text'
		}, {
			key: 'speed',
			label: '语速',
			type: 'range',
			min: 0.25,
			max: 4,
			step: 0.1,
			default: 1
		}];
	}
	if (type !== 'chat') return [];
	const definitions = [{
		key: 'temperature',
		label: '温度',
		type: 'range',
		min: 0,
		max: 2,
		step: 0.1,
		default: 1
	}, {
		key: 'max_tokens',
		label: '最大 Token 数',
		type: 'integer',
		min: 1,
		default: 4096
	}];
	if (style === 'openai') definitions.push({
		key: 'presence_penalty',
		label: '话题新鲜度惩罚',
		type: 'range',
		min: -2,
		max: 2,
		step: 0.1,
		default: 0
	});
	if (style === 'claude') definitions.push({
		key: 'top_k',
		label: 'Top K',
		type: 'integer',
		min: 1,
		max: 500
	}, {
		key: 'stop_sequences',
		label: '停止序列',
		type: 'text'
	});
	if (style === 'responses') definitions.push({
		key: 'reasoning_effort',
		label: '思考强度',
		type: 'select',
		options: ['low', 'medium', 'high'],
		default: 'high'
	});
	return definitions;
}

function modelParamRow(container, key) {
	return container.querySelectorAll('.registered.param-row').find(row => row.dataset.paramKey === key);
}

function selectModelParamDecision(row, value) {
	const radios = row.querySelectorAll('input[type="radio"]');
	radios.forEach(radio => {
		radio.checked = radio.value === value;
	});
	const target = radios.find(radio => radio.value === value);
	target.dispatch('click');
	target.dispatch('change');
}
test('model parameter controls distinguish inherited, own, and model-decides states', () => {
	const harness = createModelParamControlsHarness();
	assert.equal(typeof harness.api.renderModelParamControls, 'function');
	harness.api.renderModelParamControls(harness.container, modelParamDefinitions(), {
		temperature: 0.3
	}, {
		temperature: 0.8
	}, {
		allowInherit: true
	});
	assert.equal(modelParamRow(harness.container, 'temperature').dataset.state, 'own');
	assert.equal(modelParamRow(harness.container, 'max_tokens').dataset.state, 'inherit');
	harness.api.renderModelParamControls(harness.container, modelParamDefinitions(), {
		temperature: null
	}, {}, {
		allowInherit: true
	});
	assert.equal(modelParamRow(harness.container, 'temperature').dataset.state, 'model');
});
test('untouched parameter controls preserve absent and null source states', () => {
	const absentHarness = createModelParamControlsHarness();
	absentHarness.api.renderModelParamControls(absentHarness.container, modelParamDefinitions(), {}, {}, {
		allowInherit: false
	});
	assert.equal(modelParamRow(absentHarness.container, 'temperature').dataset.state, 'model');
	assert.deepEqual(JSON.parse(JSON.stringify(absentHarness.api.collectModelParamControls(absentHarness.container, {}))), {
		valid: true,
		params: {},
		firstInvalidControl: null
	});
	const nullHarness = createModelParamControlsHarness();
	nullHarness.api.renderModelParamControls(nullHarness.container, modelParamDefinitions(), {
		temperature: null
	}, {}, {
		allowInherit: false
	});
	assert.deepEqual(JSON.parse(JSON.stringify(nullHarness.api.collectModelParamControls(nullHarness.container, {
		temperature: null
	}))), {
		valid: true,
		params: {
			temperature: null
		},
		firstInvalidControl: null
	});
});
test('changing a parameter decision writes only that registered field', () => {
	const harness = createModelParamControlsHarness();
	const original = {
		temperature: 0.7,
		max_tokens: 22,
		unknown: 'preserve'
	};
	harness.api.renderModelParamControls(harness.container, modelParamDefinitions(), original, {}, {
		allowInherit: true
	});
	const temperature = modelParamRow(harness.container, 'temperature');
	const maxTokens = modelParamRow(harness.container, 'max_tokens');
	const reasoning = modelParamRow(harness.container, 'reasoning_effort');
	selectModelParamDecision(temperature, 'inherit');
	selectModelParamDecision(maxTokens, 'model');
	selectModelParamDecision(reasoning, 'own');
	reasoning.querySelector('select').value = 'low';
	assert.deepEqual(JSON.parse(JSON.stringify(harness.api.collectModelParamControls(harness.container, original).params)), {
		max_tokens: null,
		unknown: 'preserve',
		reasoning_effort: 'low'
	});
});
test('switching away from own and back preserves the unsaved value', () => {
	const harness = createModelParamControlsHarness();
	harness.api.renderModelParamControls(harness.container, modelParamDefinitions(), {
		temperature: 0.3
	}, {}, {
		allowInherit: true
	});
	const row = modelParamRow(harness.container, 'temperature');
	const input = row.querySelector('input[type="range"]');
	input.value = '0.4';
	selectModelParamDecision(row, 'model');
	selectModelParamDecision(row, 'own');
	assert.equal(row.querySelector('input[type="range"]').value, '0.4');
});
test('model parameter controls reject non-step and non-integer numeric values', () => {
	const harness = createModelParamControlsHarness();
	harness.api.renderModelParamControls(harness.container, modelParamDefinitions(), {}, {}, {
		allowInherit: false
	});
	const temperature = modelParamRow(harness.container, 'temperature');
	selectModelParamDecision(temperature, 'own');
	temperature.querySelector('input[type="range"]').value = '0.25';
	let result = harness.api.collectModelParamControls(harness.container, {});
	assert.equal(result.valid, false);
	assert.equal(temperature.querySelector('.validation.error').textContent, '请输入 0～2 之间的数值');
	const maxTokens = modelParamRow(harness.container, 'max_tokens');
	selectModelParamDecision(maxTokens, 'own');
	maxTokens.querySelector('input[type="number"]').value = '1.5';
	result = harness.api.collectModelParamControls(harness.container, {});
	assert.equal(result.valid, false);
	assert.equal(maxTokens.querySelector('.validation.error').textContent, '请输入不小于 1 的整数');
});
test('model parameter decision labels and available choices honor options', () => {
	const harness = createModelParamControlsHarness();
	harness.api.renderModelParamControls(harness.container, modelParamDefinitions(), {}, {}, {
		allowInherit: false,
		inheritLabel: '沿用端点设置',
		inheritValueLabel: '端点值为',
		modelLabel: '交给模型'
	});
	const rows = harness.container.querySelectorAll('.registered.param-row');
	assert.equal(rows.length, modelParamDefinitions().length);
	assert.equal(new Set(rows.map(row => row.querySelector('input[type="radio"]').name)).size, rows.length);
	const decision = rows[0].querySelector('.param-decision');
	assert.equal(decision.querySelectorAll('input[type="radio"]').length, 2);
	assert.equal(decision.querySelectorAll('input[type="radio"]').some(radio => radio.value === 'inherit'), false);
	assert.equal(decision.querySelectorAll('.text').some(text => text.textContent === '交给模型'), true);
	assert.equal(rows[0].dataset.state, 'model');
});
test('model parameter decision click and change independently dirty only their row', () => {
	const harness = createModelParamControlsHarness();
	harness.api.renderModelParamControls(harness.container, modelParamDefinitions(), {}, {}, {
		allowInherit: true
	});
	const [first, second] = harness.container.querySelectorAll('.registered.param-row');
	const own = first.querySelectorAll('input[type="radio"]').find(radio => radio.value === 'own');
	own.checked = true;
	own.dispatch('click');
	assert.equal(first.dataset.changed, 'true');
	assert.equal(second.dataset.changed, 'false');
	const model = second.querySelectorAll('input[type="radio"]').find(radio => radio.value === 'model');
	model.checked = true;
	model.dispatch('change');
	assert.equal(second.dataset.changed, 'true');
	assert.equal(first.dataset.state, 'own');
});
test('model parameter validation rejects empty own values and unknown select values', () => {
	const definitions = [{
		key: 'count',
		label: '数量',
		type: 'integer'
	}, {
		key: 'note',
		label: '备注',
		type: 'text'
	}, {
		key: 'mode',
		label: '模式',
		type: 'select',
		options: ['a', 'b']
	}, {
		key: 'optional',
		label: '可选备注',
		type: 'text',
		nullable: true
	}];
	const harness = createModelParamControlsHarness();
	harness.api.renderModelParamControls(harness.container, definitions, {}, {}, {
		allowInherit: false
	});
	for (const row of harness.container.querySelectorAll('.registered.param-row')) {
		const own = row.querySelectorAll('input[type="radio"]').find(radio => radio.value === 'own');
		own.checked = true;
		own.dispatch('click');
	}
	modelParamRow(harness.container, 'count').querySelector('input[type="number"]').value = '';
	modelParamRow(harness.container, 'note').querySelector('input[type="text"]').value = '';
	modelParamRow(harness.container, 'mode').querySelector('select').value = 'outside';
	modelParamRow(harness.container, 'optional').querySelector('input[type="text"]').value = '';
	const result = harness.api.collectModelParamControls(harness.container, {});
	assert.equal(result.valid, false);
	assert.equal(modelParamRow(harness.container, 'count').querySelector('.validation.error').textContent, '请填写数量');
	assert.equal(modelParamRow(harness.container, 'note').querySelector('.validation.error').textContent, '请填写备注');
	assert.equal(modelParamRow(harness.container, 'mode').querySelector('.validation.error').textContent, '请选择模式');
	assert.equal(modelParamRow(harness.container, 'optional').querySelector('.validation.error').textContent, '');
	assert.doesNotMatch(modelParamRow(harness.container, 'count').querySelector('.validation.error').textContent, /undefined/);
});
test('model parameter controls describe null and empty fallback as model-decides', () => {
	const harness = createModelParamControlsHarness();
	harness.api.renderModelParamControls(harness.container, modelParamDefinitions(), {}, {
		temperature: null,
		max_tokens: ''
	}, {
		allowInherit: true,
		inheritValueLabel: '端点值为'
	});
	assert.equal(modelParamRow(harness.container, 'temperature').querySelector('.inherited.param.hint').textContent, '上级未设置，将由模型决定');
	assert.equal(modelParamRow(harness.container, 'max_tokens').querySelector('.inherited.param.hint').textContent, '上级未设置，将由模型决定');
});
test('collectModelParamControls ignores custom parameter rows', () => {
	const harness = createModelParamControlsHarness();
	const custom = harness.container.appendChild(new ModelParamElement('div', 'custom param-row'));
	custom.dataset.paramKey = 'custom';
	custom.dataset.changed = true;
	custom.dataset.state = 'model';
	assert.deepEqual(JSON.parse(JSON.stringify(harness.api.collectModelParamControls(harness.container, {
		custom: 'keep'
	}))), {
		valid: true,
		params: {
			custom: 'keep'
		},
		firstInvalidControl: null
	});
});
test('own parameter value edits dirty and persist every control type', () => {
	const definitions = [{
		key: 'temperature',
		label: '温度',
		type: 'range',
		min: 0,
		max: 2,
		step: 0.1,
		default: 1
	}, {
		key: 'max_tokens',
		label: '最大 Token 数',
		type: 'integer',
		min: 1,
		default: 4096
	}, {
		key: 'note',
		label: '备注',
		type: 'text',
		default: ''
	}, {
		key: 'mode',
		label: '模式',
		type: 'select',
		options: ['a', 'b'],
		default: 'a'
	}];
	const original = {
		temperature: 0.3,
		max_tokens: 16,
		note: 'before',
		mode: 'a'
	};
	const harness = createModelParamControlsHarness();
	harness.api.renderModelParamControls(harness.container, definitions, original, {}, {
		allowInherit: true
	});
	const edits = [
		['temperature', 'input', '0.4'],
		['max_tokens', 'change', '24'],
		['note', 'input', 'after'],
		['mode', 'change', 'b']
	];
	for (const [key, event, value] of edits) {
		const row = modelParamRow(harness.container, key);
		const control = row.querySelector('.own.param.control').querySelector('input, select');
		control.value = value;
		control.dispatch(event);
		assert.equal(row.dataset.changed, 'true');
		assert.equal(row.dataset.state, 'own');
	}
	assert.deepEqual(JSON.parse(JSON.stringify(harness.api.collectModelParamControls(harness.container, original).params)), {
		temperature: 0.4,
		max_tokens: 24,
		note: 'after',
		mode: 'b'
	});
});
test('switching model to own persists the most recently entered own value', () => {
	const harness = createModelParamControlsHarness();
	const original = {
		temperature: 0.3
	};
	harness.api.renderModelParamControls(harness.container, modelParamDefinitions(), original, {}, {
		allowInherit: true
	});
	const row = modelParamRow(harness.container, 'temperature');
	const control = row.querySelector('input[type="range"]');
	control.value = '0.4';
	control.dispatch('input');
	selectModelParamDecision(row, 'model');
	selectModelParamDecision(row, 'own');
	assert.equal(row.dataset.state, 'own');
	assert.deepEqual(JSON.parse(JSON.stringify(harness.api.collectModelParamControls(harness.container, original).params)), {
		temperature: 0.4
	});
});
test('model parameter template retains clickable labels and options labels honor custom values', () => {
	const template = createModelParamTemplateFromLayout();
	const options = template.content.querySelectorAll('.option.btn');
	assert.equal(options.length, 3);
	assert.equal(options.every(option => option.tagName === 'LABEL' && option.querySelector('input[type="radio"]')), true);
	const harness = createModelParamControlsHarness();
	harness.api.renderModelParamControls(harness.container, modelParamDefinitions(), {}, {
		temperature: 0.8,
		max_tokens: undefined,
		reasoning_effort: null
	}, {
		allowInherit: true,
		inheritLabel: '沿用端点设置',
		inheritValueLabel: '端点值为',
		modelLabel: '交给模型'
	});
	const temperature = modelParamRow(harness.container, 'temperature');
	assert.equal(temperature.querySelectorAll('.text').some(text => text.textContent === '沿用端点设置'), true);
	assert.equal(temperature.querySelectorAll('.text').some(text => text.textContent === '交给模型'), true);
	assert.equal(temperature.querySelector('.inherited.param.hint').textContent, '端点值为 0.8');
	assert.equal(modelParamRow(harness.container, 'max_tokens').querySelector('.inherited.param.hint').textContent, '上级未设置，将由模型决定');
	assert.equal(modelParamRow(harness.container, 'reasoning_effort').querySelector('.inherited.param.hint').textContent, '上级未设置，将由模型决定');
});

function extractCssRuleBlock(source, selector) {
	let selectorIndex = source.indexOf(selector);
	while (selectorIndex !== -1) {
		const bodyStart = source.indexOf('{', selectorIndex + selector.length);
		if (bodyStart !== -1 && source.slice(selectorIndex + selector.length, bodyStart).trim() === '') {
			let depth = 0;
			for (let index = bodyStart; index < source.length; index += 1) {
				if (source[index] === '{') depth += 1;
				if (source[index] === '}') depth -= 1;
				if (depth === 0) return source.slice(selectorIndex, index + 1);
			}
			throw new Error('Unbalanced CSS rule: ' + selector);
		}
		selectorIndex = source.indexOf(selector, selectorIndex + selector.length);
	}
	assert.fail('CSS selector must exist as a rule: ' + selector);
}
test('parameter decision buttons use one precise rule that wins in both dialogs', () => {
	const styleSource = fs.readFileSync(path.join(__dirname, '..', 'src', 'style.css'), 'utf8');
	const scope = '&:is(.editing.endpoint, .session-param-editor) .param-control.list > .param-row';
	const decisionSelector = scope + '.registered .param-decision .option.btn';
	const decisionRule = extractCssRuleBlock(styleSource, decisionSelector);
	assert.match(decisionRule, /--btn-h\s*:\s*32px\s*;/);
	assert.match(decisionRule, /min-height\s*:\s*32px\s*;/);
	assert.match(decisionRule, /transition\s*:\s*none\s*;/);
});
test('endpoint and session parameter rows share one semantic core rule', () => {
	const styleSource = fs.readFileSync(path.join(__dirname, '..', 'src', 'style.css'), 'utf8');
	const scope = '&:is(.editing.endpoint, .session-param-editor) .param-control.list > .param-row';
	const sharedRule = extractCssRuleBlock(styleSource, scope);
	assert.match(sharedRule, /gap\s*:\s*var\(--space-2\)\s*;/);
	assert.match(sharedRule, /margin-bottom\s*:\s*var\(--space-1\)\s*;/);
});
test('registered parameter validation occupies a readable full-width next line', () => {
	const styleSource = fs.readFileSync(path.join(__dirname, '..', 'src', 'style.css'), 'utf8');
	const scope = '&:is(.editing.endpoint, .session-param-editor) .param-control.list > .param-row.registered > .field-control';
	const fieldControlRule = extractCssRuleBlock(styleSource, scope);
	const validationRule = extractCssRuleBlock(styleSource, scope + ' > .validation.error');
	assert.match(fieldControlRule, /flex-wrap\s*:\s*wrap\s*;/);
	assert.match(validationRule, /flex-basis\s*:\s*100%\s*;/);
	assert.match(validationRule, /font-size\s*:\s*13px\s*;/);
	assert.match(validationRule, /color\s*:\s*var\(--danger\)\s*;/);
});
test('endpoint dialog renders definitions from the final inherited type and style', () => {
	const child = {
		id: 'child',
		name: 'Child',
		children: []
	};
	const tree = {
		nodes: [{
			id: 'parent',
			name: 'Parent',
			type: 'chat',
			style: 'claude',
			children: [child]
		}]
	};
	const harness = createEditDialogHarness(tree);
	harness.context.__showEditGroupDialog(child, null, () => {});
	assert.ok(harness.getParamRow('top_k'), 'Claude definition must render after inheritance resolves');
	assert.equal(harness.getParamRow('presence_penalty'), undefined);
});
test('new root endpoint renders OpenAI definitions after applying its default style', () => {
	const harness = createEditDialogHarness({
		nodes: []
	});
	harness.context.__showEditGroupDialog(null, null, () => {});
	assert.ok(harness.getParamRow('presence_penalty'));
	assert.equal(harness.getParamRow('top_k'), undefined);
});
test('switching to a type without definitions clears hidden controls and excludes hidden dirty drafts', () => {
	const node = {
		id: 'root',
		name: 'Root',
		type: 'chat',
		style: 'openai',
		params: {
			unknown: 'keep'
		},
		customParams: [{
			key: 'legacy',
			value: 'keep'
		}],
		children: []
	};
	const harness = createEditDialogHarness({
		nodes: [node]
	});
	let saveData;
	harness.context.__showEditGroupDialog(node, null, data => {
		saveData = data;
	});
	harness.selectParamDecision('max_tokens', 'own');
	const dirty = harness.getParamRow('max_tokens').querySelector('input[type="number"]');
	dirty.value = 'invalid';
	dirty.dispatch('input');
	const embedding = harness.dialog.querySelector('input[name="type"][value="embedding"]');
	harness.dialog.querySelectorAll('input[name="type"]').forEach(radio => {
		radio.checked = radio === embedding;
	});
	embedding.dispatch('change');
	assert.equal(harness.paramList.children.length, 0);
	harness.okButton.onclick();
	assert.deepEqual(JSON.parse(JSON.stringify(saveData.params)), {
		unknown: 'keep'
	});
	assert.equal(Object.hasOwn(saveData, 'customParams'), false);
});
test('switching definitions restores only that definitions independent unsaved draft', () => {
	const node = {
		id: 'root',
		name: 'Root',
		type: 'chat',
		style: 'openai',
		params: {
			unknown: 'keep'
		},
		children: []
	};
	const harness = createEditDialogHarness({
		nodes: [node]
	});
	let saveData;
	harness.context.__showEditGroupDialog(node, null, data => {
		saveData = data;
	});
	harness.selectParamDecision('presence_penalty', 'own');
	const penalty = harness.getParamRow('presence_penalty').querySelector('input[type="range"]');
	penalty.value = '0.4';
	penalty.dispatch('input');
	const claude = harness.dialog.querySelector('input[name="style"][value="claude"]');
	harness.dialog.querySelectorAll('input[name="style"]').forEach(radio => {
		radio.checked = radio === claude;
	});
	claude.dispatch('change');
	harness.selectParamDecision('top_k', 'own');
	const topK = harness.getParamRow('top_k').querySelector('input[type="number"]');
	topK.value = '12';
	topK.dispatch('input');
	const openai = harness.dialog.querySelector('input[name="style"][value="openai"]');
	harness.dialog.querySelectorAll('input[name="style"]').forEach(radio => {
		radio.checked = radio === openai;
	});
	openai.dispatch('change');
	assert.equal(harness.getParamRow('presence_penalty').querySelector('input[type="range"]').value, '0.4');
	harness.dialog.querySelectorAll('input[name="style"]').forEach(radio => {
		radio.checked = radio === claude;
	});
	claude.dispatch('change');
	harness.okButton.onclick();
	assert.deepEqual(JSON.parse(JSON.stringify(saveData.params)), {
		unknown: 'keep',
		top_k: 12
	});
	assert.equal(Object.hasOwn(saveData.params, 'presence_penalty'), false);
});
test('unknown own __proto__ survives dialog save, storage snapshot, resolution, and the final request body as a plain JSON property', async () => {
	const protoValue = {
		source: 'unknown-param'
	};
	const sourceParams = JSON.parse('{"__proto__":{"source":"unknown-param"}}');
	const node = {
		id: 'proto-node',
		name: 'Proto node',
		type: 'chat',
		style: 'openai',
		params: sourceParams,
		children: []
	};
	const tree = {
		nodes: [node]
	};
	const registry = createParamRegistryHarness();
	const dialogHarness = createEditDialogHarness(tree, {
		getParamDefs: registry.getParamDefs,
	});
	const storeHarness = createStoreHarness(tree);
	const providerHarness = createProviderRequestBodyHarness();
	let updatePromise;
	let saveData;
	dialogHarness.context.__showEditGroupDialog(node, null, function(data) {
		saveData = data;
		updatePromise = storeHarness.api.updateNode(node.id, data);
	});
	dialogHarness.okButton.onclick();
	dialogHarness.context.__lastProtoSave = saveData;
	assert.equal(Object.hasOwn(saveData.params, '__proto__'), true);
	assert.deepEqual(cloneJson(saveData.params.__proto__), protoValue);
	assert.equal(Object.getPrototypeOf(Object.getPrototypeOf(saveData.params)), null);
	await updatePromise;
	const added = await storeHarness.api.addNode(null, {
		name: 'Proto snapshot',
		params: JSON.parse('{"__proto__":{"source":"unknown-param"}}')
	});
	assert.equal(Object.hasOwn(added.params, '__proto__'), true);
	assert.deepEqual(cloneJson(added.params.__proto__), protoValue);
	assert.equal(storeHarness.api.hasPlainParamsPrototype(added.id), true);
	const resolved = storeHarness.api.resolveNodeConfig(node.id);
	assert.equal(Object.hasOwn(resolved.params, '__proto__'), true);
	assert.deepEqual(cloneJson(resolved.params.__proto__), protoValue);
	assert.equal(storeHarness.api.hasPlainResolvedParamsPrototype(node.id), true);
	const body = {};
	createMergeParamsHarness()(body, resolved.params, resolved.style);
	assert.equal(Object.hasOwn(body, '__proto__'), true);
	assert.deepEqual(cloneJson(body.__proto__), protoValue);
	assert.equal(Object.getPrototypeOf(body), Object.prototype);
	await providerHarness.api.callProvider(providerHarness.api.providers.openai, 'https://example.test', 'key', 'model', [{
		role: 'user',
		content: 'Hi'
	}], function() {}, null, resolved.style, resolved.params, false);
	assert.equal(Object.hasOwn(providerHarness.calls[0].body, '__proto__'), true);
	assert.deepEqual(providerHarness.calls[0].body.__proto__, protoValue);
	assert.equal(Object.getPrototypeOf(providerHarness.calls[0].body), Object.prototype);
});
test('switching endpoint type and style preserves untouched old params null unknown and custom values through resolve and request merge', async () => {
	const child = {
		id: 'child',
		name: 'Child',
		type: 'chat',
		style: 'openai',
		params: {
			voice: null,
			speed: 1,
			temperature: 0.9,
			presence_penalty: 0.8,
			frequency_penalty: 0.2,
			unknown: 'preserve'
		},
		customParams: [{
			key: 'vendor_option',
			value: 'keep-custom'
		}],
		children: []
	};
	const tree = {
		nodes: [child]
	};
	const registry = createParamRegistryHarness();
	const dialogHarness = createEditDialogHarness(tree, {
		getParamDefs: registry.getParamDefs
	});
	const storeHarness = createStoreHarness(tree);
	const mergeParams = createMergeParamsHarness();
	let updatePromise;
	dialogHarness.context.__showEditGroupDialog(child, null, function(saveData) {
		updatePromise = storeHarness.api.updateNode(child.id, saveData);
	});
	const claude = dialogHarness.dialog.querySelector('input[name="style"][value="claude"]');
	dialogHarness.dialog.querySelectorAll('input[name="style"]').forEach(function(radio) {
		radio.checked = radio === claude;
	});
	claude.dispatch('change');
	const tts = dialogHarness.dialog.querySelector('input[name="type"][value="tts"]');
	dialogHarness.dialog.querySelectorAll('input[name="type"]').forEach(function(radio) {
		radio.checked = radio === tts;
	});
	tts.dispatch('change');
	dialogHarness.okButton.onclick();
	await updatePromise;
	const expectedParams = {
		voice: null,
		speed: 1,
		temperature: 0.9,
		presence_penalty: 0.8,
		frequency_penalty: 0.2,
		unknown: 'preserve'
	};
	assert.deepEqual(cloneJson(child.params), expectedParams);
	assert.deepEqual(cloneJson(child.customParams), [{
		key: 'vendor_option',
		value: 'keep-custom'
	}]);
	const resolved = storeHarness.api.resolveNodeConfig(child.id);
	assert.deepEqual(cloneJson(resolved.params), expectedParams);
	const body = {};
	mergeParams(body, resolved.params, resolved.style);
	assert.deepEqual(cloneJson(body), {
		speed: 1,
		temperature: 0.9,
		presence_penalty: 0.8,
		frequency_penalty: 0.2,
		unknown: 'preserve'
	});
});
test('switching OpenAI chat definitions to Claude preserves untouched OpenAI params through dialog save store resolve and provider request body', async () => {
	const node = {
		id: 'openai-chat',
		name: 'OpenAI chat',
		type: 'chat',
		style: 'openai',
		params: {
			temperature: 0.7,
			top_p: 0.8,
			max_tokens: 128,
			presence_penalty: 0.2,
			frequency_penalty: 0.3,
			seed: 42,
			unknown: 'keep',
			nullable: null
		},
		customParams: [{
			key: 'vendor_option',
			value: 'keep-custom'
		}],
		children: []
	};
	const tree = {
		nodes: [node]
	};
	const registry = createParamRegistryHarness();
	const dialogHarness = createEditDialogHarness(tree, {
		getParamDefs: registry.getParamDefs
	});
	const storeHarness = createStoreHarness(tree);
	const providerHarness = createProviderRequestBodyHarness();
	let updatePromise;
	dialogHarness.context.__showEditGroupDialog(node, null, function(saveData) {
		updatePromise = storeHarness.api.updateNode(node.id, saveData);
	});
	const claude = dialogHarness.dialog.querySelector('input[name="style"][value="claude"]');
	dialogHarness.dialog.querySelectorAll('input[name="style"]').forEach(function(radio) {
		radio.checked = radio === claude;
	});
	claude.dispatch('change');
	dialogHarness.okButton.onclick();
	await updatePromise;
	const expectedParams = {
		temperature: 0.7,
		top_p: 0.8,
		max_tokens: 128,
		presence_penalty: 0.2,
		frequency_penalty: 0.3,
		seed: 42,
		unknown: 'keep',
		nullable: null
	};
	assert.deepEqual(cloneJson(node.params), expectedParams);
	const resolved = storeHarness.api.resolveNodeConfig(node.id);
	assert.deepEqual(cloneJson(resolved.params), expectedParams);
	assert.deepEqual(cloneJson(node.customParams), [{
		key: 'vendor_option',
		value: 'keep-custom'
	}]);
	await providerHarness.api.callProvider(providerHarness.api.providers.claude, 'https://example.test', 'key', 'model', [{
		role: 'user',
		content: 'Hi'
	}], function() {}, null, resolved.style, resolved.params, false);
	assert.deepEqual(cloneJson(providerHarness.calls[0].body), {
		model: 'model',
		max_tokens: 128,
		messages: [{
			role: 'user',
			content: 'Hi'
		}],
		stream: true,
		temperature: 0.7,
		top_p: 0.8,
		presence_penalty: 0.2,
		frequency_penalty: 0.3,
		seed: 42,
		unknown: 'keep'
	});
});
test('switching OpenAI chat definitions to Responses preserves untouched OpenAI params and maps reasoning effort', async () => {
	const node = {
		id: 'openai-responses',
		name: 'OpenAI responses',
		type: 'chat',
		style: 'openai',
		params: {
			temperature: 0.6,
			top_p: 0.9,
			max_tokens: 256,
			presence_penalty: 0.2,
			frequency_penalty: 0.3,
			seed: 7,
			reasoning_effort: 'high',
			unknown: 'keep',
			nullable: null
		},
		children: []
	};
	const tree = {
		nodes: [node]
	};
	const registry = createParamRegistryHarness();
	const dialogHarness = createEditDialogHarness(tree, {
		getParamDefs: registry.getParamDefs
	});
	const storeHarness = createStoreHarness(tree);
	const providerHarness = createProviderRequestBodyHarness();
	let updatePromise;
	dialogHarness.context.__showEditGroupDialog(node, null, function(saveData) {
		updatePromise = storeHarness.api.updateNode(node.id, saveData);
	});
	const responses = dialogHarness.dialog.querySelector('input[name="style"][value="responses"]');
	dialogHarness.dialog.querySelectorAll('input[name="style"]').forEach(function(radio) {
		radio.checked = radio === responses;
	});
	responses.dispatch('change');
	dialogHarness.okButton.onclick();
	await updatePromise;
	const expectedParams = {
		temperature: 0.6,
		top_p: 0.9,
		max_tokens: 256,
		presence_penalty: 0.2,
		frequency_penalty: 0.3,
		seed: 7,
		reasoning_effort: 'high',
		unknown: 'keep',
		nullable: null
	};
	assert.deepEqual(cloneJson(node.params), expectedParams);
	const resolved = storeHarness.api.resolveNodeConfig(node.id);
	assert.deepEqual(cloneJson(resolved.params), expectedParams);
	await providerHarness.api.callProvider(providerHarness.api.providers.responses, 'https://example.test', 'key', 'model', [{
		role: 'user',
		content: 'Hi'
	}], function() {}, null, resolved.style, resolved.params, false);
	assert.deepEqual(cloneJson(providerHarness.calls[0].body), {
		model: 'model',
		input: [{
			type: 'message',
			role: 'user',
			content: [{
				type: 'input_text',
				text: 'Hi'
			}]
		}],
		stream: true,
		temperature: 0.6,
		top_p: 0.9,
		max_output_tokens: 256,
		presence_penalty: 0.2,
		frequency_penalty: 0.3,
		seed: 7,
		unknown: 'keep',
		reasoning: {
			effort: 'high'
		}
	});
});
test('switching OpenAI chat definitions to embedding preserves all untouched chat params and custom values', async () => {
	const node = {
		id: 'openai-embedding',
		name: 'OpenAI embedding',
		type: 'chat',
		style: 'openai',
		params: {
			temperature: 0.6,
			top_p: 0.9,
			max_tokens: 256,
			presence_penalty: 0.2,
			frequency_penalty: 0.3,
			seed: 7,
			reasoning_effort: 'high',
			unknown: 'keep'
		},
		customParams: [{
			key: 'vendor_option',
			value: 'keep-custom'
		}],
		children: []
	};
	const tree = {
		nodes: [node]
	};
	const registry = createParamRegistryHarness();
	const dialogHarness = createEditDialogHarness(tree, {
		getParamDefs: registry.getParamDefs
	});
	const storeHarness = createStoreHarness(tree);
	const providerHarness = createProviderRequestBodyHarness();
	let updatePromise;
	dialogHarness.context.__showEditGroupDialog(node, null, function(saveData) {
		updatePromise = storeHarness.api.updateNode(node.id, saveData);
	});
	const embedding = dialogHarness.dialog.querySelector('input[name="type"][value="embedding"]');
	dialogHarness.dialog.querySelectorAll('input[name="type"]').forEach(function(radio) {
		radio.checked = radio === embedding;
	});
	embedding.dispatch('change');
	dialogHarness.okButton.onclick();
	await updatePromise;
	const expectedParams = {
		temperature: 0.6,
		top_p: 0.9,
		max_tokens: 256,
		presence_penalty: 0.2,
		frequency_penalty: 0.3,
		seed: 7,
		reasoning_effort: 'high',
		unknown: 'keep'
	};
	assert.deepEqual(cloneJson(node.params), expectedParams);
	const resolved = storeHarness.api.resolveNodeConfig(node.id);
	assert.deepEqual(cloneJson(resolved.params), expectedParams);
	assert.deepEqual(cloneJson(node.customParams), [{
		key: 'vendor_option',
		value: 'keep-custom'
	}]);
	await providerHarness.api.callEmbedding('openai', 'https://example.test', 'key', 'model', 'Hi', false, resolved.params, null);
	assert.deepEqual(cloneJson(providerHarness.calls[0].body), {
		model: 'model',
		input: 'Hi',
		encoding_format: 'float',
		temperature: 0.6,
		top_p: 0.9,
		max_tokens: 256,
		presence_penalty: 0.2,
		frequency_penalty: 0.3,
		seed: 7,
		reasoning_effort: 'high',
		unknown: 'keep'
	});
});
test('leaving TTS keeps untouched invisible legacy voice and instruction available to the resolver', async () => {
	const node = {
		id: 'legacy-tts',
		name: 'Legacy TTS',
		type: 'tts',
		style: 'openai',
		voice: 'alloy',
		instruction: 'calm',
		children: []
	};
	const tree = {
		nodes: [node]
	};
	const registry = createParamRegistryHarness();
	const dialogHarness = createEditDialogHarness(tree, {
		getParamDefs: registry.getParamDefs
	});
	const storeHarness = createStoreHarness(tree);
	let updatePromise;
	let saveData;
	dialogHarness.context.__showEditGroupDialog(node, null, function(data) {
		saveData = data;
		updatePromise = storeHarness.api.updateNode(node.id, data);
	});
	const chat = dialogHarness.dialog.querySelector('input[name="type"][value="chat"]');
	dialogHarness.dialog.querySelectorAll('input[name="type"]').forEach(function(radio) {
		radio.checked = radio === chat;
	});
	chat.dispatch('change');
	assert.equal(dialogHarness.getParamRow('voice'), undefined);
	assert.equal(dialogHarness.getParamRow('instruction'), undefined);
	dialogHarness.okButton.onclick();
	assert.equal(Object.hasOwn(saveData, '_removeLegacyParamFields'), false);
	await updatePromise;
	assert.equal(node.voice, 'alloy');
	assert.equal(node.instruction, 'calm');
	const resolved = storeHarness.api.resolveNodeConfig(node.id);
	assert.equal(resolved.params.voice, 'alloy');
	assert.equal(resolved.params.instruction, 'calm');
});
test('model id auto-detection snapshots chat draft before rendering embedding definitions', () => {
	const node = {
		id: 'root',
		name: 'Root',
		type: '',
		style: 'openai',
		modelId: 'gpt-4o',
		customParams: [{
			key: 'draft',
			value: 'before'
		}],
		children: []
	};
	const harness = createEditDialogHarness({
		nodes: [node]
	});
	harness.context.__showEditGroupDialog(node, null, () => {});
	harness.selectParamDecision('temperature', 'own');
	const temperature = harness.getParamRow('temperature').querySelector('input[type="range"]');
	temperature.value = '0.4';
	temperature.dispatch('input');
	const customValue = harness.paramList.querySelectorAll('.param-row.custom')[0].querySelectorAll('input')[1];
	customValue.value = 'edited';
	const modelId = harness.dialog.querySelector('input[name="model-id"]');
	modelId.value = 'text-embedding-3-small';
	modelId.oninput();
	assert.equal(harness.paramList.children.length, 0);
	modelId.value = 'gpt-4o';
	modelId.oninput();
	assert.equal(harness.getParamRow('temperature').querySelector('input[type="range"]').value, '0.4');
	assert.equal(harness.paramList.querySelectorAll('.param-row.custom')[0].querySelectorAll('input')[1].value, 'edited');
});
test('reopening one dialog replaces type and style handlers instead of mixing node drafts', () => {
	const first = {
		id: 'first',
		name: 'First',
		type: 'chat',
		style: 'openai',
		children: []
	};
	const second = {
		id: 'second',
		name: 'Second',
		type: 'chat',
		style: 'openai',
		params: {
			unknown: 'second'
		},
		children: []
	};
	const harness = createEditDialogHarness({
		nodes: [first, second]
	});
	harness.context.__showEditGroupDialog(first, null, () => {});
	harness.selectParamDecision('presence_penalty', 'own');
	const firstPenalty = harness.getParamRow('presence_penalty').querySelector('input[type="range"]');
	firstPenalty.value = '0.8';
	firstPenalty.dispatch('input');
	let secondSave;
	harness.context.__showEditGroupDialog(second, null, data => {
		secondSave = data;
	});
	const claude = harness.dialog.querySelector('input[name="style"][value="claude"]');
	harness.dialog.querySelectorAll('input[name="style"]').forEach(radio => {
		radio.checked = radio === claude;
	});
	claude.dispatch('change');
	harness.selectParamDecision('top_k', 'own');
	const topK = harness.getParamRow('top_k').querySelector('input[type="number"]');
	topK.value = '20';
	topK.dispatch('input');
	harness.okButton.onclick();
	assert.deepEqual(JSON.parse(JSON.stringify(secondSave.params)), {
		unknown: 'second',
		top_k: 20
	});
});
test('legacy top-level voice does not override or auto-delete an own null params blocker', () => {
	const node = {
		id: 'tts',
		name: 'TTS',
		type: 'tts',
		style: 'openai',
		params: {
			voice: null
		},
		voice: 'alloy',
		children: []
	};
	const harness = createEditDialogHarness({
		nodes: [node]
	});
	let saveData;
	harness.context.__showEditGroupDialog(node, null, data => {
		saveData = data;
	});
	assert.equal(harness.getParamRow('voice').dataset.state, 'model');
	harness.okButton.onclick();
	assert.equal(saveData.params.voice, null);
	assert.equal(Object.hasOwn(saveData, 'voice'), false);
	assert.equal(Object.hasOwn(saveData, '_removeLegacyParamFields'), false);
});
test('legacy top-level voice and instruction resolve through deep ancestors with nearest blockers', () => {
	const harness = createStoreHarness({
		nodes: [{
			id: 'grandparent',
			voice: 'grand-voice',
			instruction: 'grand-instruction',
			children: [{
				id: 'parent',
				params: {
					voice: null
				},
				children: [{
					id: 'inherit',
					children: []
				}, {
					id: 'own',
					params: {
						instruction: ''
					},
					children: []
				}, {
					id: 'own-voice',
					params: {
						voice: 'child-voice'
					},
					children: []
				}]
			}]
		}]
	});
	assert.equal(harness.api.resolveNodeConfig('inherit').params.voice, null);
	assert.equal(harness.api.resolveNodeConfig('inherit').params.instruction, 'grand-instruction');
	assert.equal(harness.api.resolveNodeConfig('own').params.instruction, '');
	assert.equal(harness.api.resolveNodeConfig('own-voice').params.voice, 'child-voice');
});
test('nullable own empty values save empty strings without numeric zero coercion', () => {
	const definitions = [{
		key: 'optional_text',
		label: '可选文本',
		type: 'text',
		nullable: true
	}, {
		key: 'optional_integer',
		label: '可选整数',
		type: 'integer',
		nullable: true
	}];
	const harness = createModelParamControlsHarness();
	harness.api.renderModelParamControls(harness.container, definitions, {}, {}, {
		allowInherit: false
	});
	for (const row of harness.container.querySelectorAll('.registered.param-row')) selectModelParamDecision(row, 'own');
	const result = harness.api.collectModelParamControls(harness.container, {});
	assert.equal(result.valid, true);
	assert.deepEqual(JSON.parse(JSON.stringify(result.params)), {
		optional_text: '',
		optional_integer: ''
	});
});

function attachRealDocumentListeners(document) {
	document.listeners = new Map();
	document.removeCallCount = 0;
	document.addEventListener = FakeEventTarget.prototype.addEventListener;
	document.removeEventListener = function(type, listener) {
		this.removeCallCount += 1;
		const listeners = this.listeners.get(type);
		if (!listeners) return;
		const index = listeners.indexOf(listener);
		if (index >= 0) listeners.splice(index, 1);
	};
	document.dispatchEvent = FakeEventTarget.prototype.dispatchEvent;
}
test('metadata-only child edit preserves parent legacy voice and instruction through the real resolver', () => {
	const child = {
		id: 'child',
		name: 'Child',
		children: []
	};
	const tree = {
		nodes: [{
			id: 'parent',
			name: 'Parent',
			type: 'tts',
			style: 'openai',
			voice: 'alloy',
			instruction: 'calm',
			children: [child]
		}]
	};
	const harness = createEditDialogHarness(tree);
	let saveData;
	harness.context.__showEditGroupDialog(child, null, data => {
		saveData = data;
		Object.assign(child, data);
	});
	harness.dialog.querySelector('input[name="name"]').value = 'Renamed child';
	harness.okButton.onclick();
	assert.equal(Object.hasOwn(saveData, 'voice'), false);
	assert.equal(Object.hasOwn(saveData, 'instruction'), false);
	const resolved = createStoreHarness(tree).api.resolveNodeConfig('child');
	assert.equal(resolved.params.voice, 'alloy');
	assert.equal(resolved.params.instruction, 'calm');
});
test('metadata-only edit preserves empty legacy top-level voice and instruction', async () => {
	const node = {
		id: 'tts',
		name: 'TTS',
		type: 'tts',
		style: 'openai',
		voice: '',
		instruction: '',
		children: []
	};
	const tree = {
		nodes: [node]
	};
	const dialogHarness = createEditDialogHarness(tree);
	const storeHarness = createStoreHarness(tree);
	let saveData;
	let updatePromise;
	dialogHarness.context.__showEditGroupDialog(node, null, data => {
		saveData = data;
		updatePromise = storeHarness.api.updateNode('tts', saveData);
	});
	dialogHarness.dialog.querySelector('input[name="name"]').value = 'Renamed TTS';
	dialogHarness.okButton.onclick();
	await updatePromise;
	assert.equal(Object.hasOwn(saveData, '_removeLegacyParamFields'), false);
	assert.equal(node.name, 'Renamed TTS');
	assert.equal(Object.hasOwn(node, 'voice'), true);
	assert.equal(node.voice, '');
	assert.equal(Object.hasOwn(node, 'instruction'), true);
	assert.equal(node.instruction, '');
});
test('nodes without legacy fields do not gain top-level null or empty compatibility fields', () => {
	const node = {
		id: 'tts',
		name: 'TTS',
		type: 'tts',
		style: 'openai',
		params: {
			voice: null,
			instruction: ''
		},
		children: []
	};
	const tree = {
		nodes: [node]
	};
	const harness = createEditDialogHarness(tree);
	let saveData;
	harness.context.__showEditGroupDialog(node, null, data => {
		saveData = data;
		Object.assign(node, data);
	});
	harness.okButton.onclick();
	assert.equal(Object.hasOwn(saveData, 'voice'), false);
	assert.equal(Object.hasOwn(saveData, 'instruction'), false);
	assert.equal(Object.hasOwn(saveData, '_removeLegacyParamFields'), false);
	const resolved = createStoreHarness(tree).api.resolveNodeConfig('tts');
	assert.equal(resolved.params.voice, null);
	assert.equal(resolved.params.instruction, '');
});
test('changing legacy child voice and instruction away from own clears stale top-level values', async () => {
	const child = {
		id: 'child',
		name: 'Child',
		voice: 'echo',
		instruction: 'fast',
		children: []
	};
	const tree = {
		nodes: [{
			id: 'parent',
			name: 'Parent',
			type: 'tts',
			style: 'openai',
			voice: 'alloy',
			instruction: 'calm',
			children: [child]
		}]
	};
	const dialogHarness = createEditDialogHarness(tree);
	const storeHarness = createStoreHarness(tree);
	let updatePromise;
	dialogHarness.context.__showEditGroupDialog(child, null, saveData => {
		updatePromise = storeHarness.api.updateNode('child', saveData);
	});
	dialogHarness.selectParamDecision('voice', 'inherit');
	dialogHarness.selectParamDecision('instruction', 'model');
	dialogHarness.okButton.onclick();
	await updatePromise;
	const resolved = storeHarness.api.resolveNodeConfig('child');
	assert.equal(resolved.params.voice, 'alloy');
	assert.equal(Object.hasOwn(child, 'voice'), false);
	assert.equal(Object.hasOwn(child, 'instruction'), false);
	assert.equal(resolved.params.instruction, null);
});
test('own concrete voice and instruction synchronize top-level compatibility fields', () => {
	const node = {
		id: 'tts',
		name: 'TTS',
		type: 'tts',
		style: 'openai',
		children: []
	};
	const tree = {
		nodes: [node]
	};
	const harness = createEditDialogHarness(tree);
	let saveData;
	harness.context.__showEditGroupDialog(node, null, data => {
		saveData = data;
		Object.assign(node, data);
	});
	harness.selectParamDecision('voice', 'own');
	harness.getParamRow('voice').querySelector('input[type="text"]').value = 'nova';
	harness.selectParamDecision('instruction', 'own');
	harness.getParamRow('instruction').querySelector('input[type="text"]').value = 'Speak clearly';
	harness.okButton.onclick();
	assert.equal(saveData.voice, 'nova');
	assert.equal(saveData.instruction, 'Speak clearly');
	const resolved = createStoreHarness(tree).api.resolveNodeConfig('tts');
	assert.equal(resolved.params.voice, 'nova');
	assert.equal(resolved.params.instruction, 'Speak clearly');
});
test('reopening endpoint dialog keeps only the current Enter save listener', () => {
	const first = {
		id: 'first',
		name: 'First',
		type: 'chat',
		style: 'openai',
		children: []
	};
	const second = {
		id: 'second',
		name: 'Second',
		type: 'chat',
		style: 'openai',
		children: []
	};
	const harness = createEditDialogHarness({
		nodes: [first, second]
	});
	let firstSaves = 0;
	let secondSaves = 0;
	harness.context.__showEditGroupDialog(first, null, () => {
		firstSaves += 1;
	});
	harness.context.__showEditGroupDialog(second, null, () => {
		secondSaves += 1;
	});
	const form = harness.dialog.querySelector('form');
	harness.context.document.activeElement = harness.dialog.querySelector('input[name="remark"]');
	form.dispatch('keydown', {
		key: 'Enter',
		shiftKey: false,
		ctrlKey: false
	});
	assert.equal(firstSaves, 0);
	assert.equal(secondSaves, 1);
	assert.equal((form.listeners.get('keydown') || []).length, 0);
});
test('reopening endpoint dialog replaces API key full URL and tab handlers', () => {
	const tree = {
		nodes: [{
			id: 'parent-a',
			name: 'Parent A',
			type: 'chat',
			style: 'openai',
			children: []
		}, {
			id: 'parent-b',
			name: 'Parent B',
			type: 'chat',
			style: 'openai',
			children: []
		}]
	};
	const harness = createEditDialogHarness(tree);
	const tabContainer = harness.dialog.querySelector('.tab.container');
	const singleRadio = tabContainer.querySelector('input[value="single"]');
	const batchLabel = new MiniElement('label', 'btn tab');
	const batchRadio = new MiniElement('input');
	batchRadio.name = 'dialog-tab';
	batchRadio.value = 'batch';
	batchRadio.type = 'radio';
	batchLabel.appendChild(batchRadio);
	tabContainer.appendChild(batchLabel);
	const fieldList = new MiniElement('div', 'field-list');
	fieldList.hasChildNodes = function() {
		return false;
	};
	harness.dialog.querySelector('form').appendChild(fieldList);
	const batchBuildCalls = [];
	harness.context.buildBatchFields = function(_dialog, parentId) {
		batchBuildCalls.push(parentId);
	};
	harness.context.__showEditGroupDialog(null, 'parent-a', () => {});
	harness.context.__showEditGroupDialog(null, 'parent-b', () => {});
	const apiCheckbox = harness.dialog.querySelector('.toggle.apikey input');
	const keyInput = harness.dialog.querySelector('input[name="apikey"]');
	let keyType = keyInput.type;
	let keyTypeWrites = 0;
	Object.defineProperty(keyInput, 'type', {
		configurable: true,
		get() {
			return keyType;
		},
		set(value) {
			keyType = value;
			keyTypeWrites += 1;
		}
	});
	apiCheckbox.checked = true;
	apiCheckbox.dispatch('change');
	assert.equal(keyTypeWrites, 1);
	const fullUrlCheckbox = harness.dialog.querySelector('.direct-url.toggle input');
	const urlRow = harness.dialog.querySelector('.url-row');
	const originalToggle = urlRow.classList.toggle.bind(urlRow.classList);
	let directToggleCalls = 0;
	urlRow.classList.toggle = function(name, force) {
		if (name === 'direct') directToggleCalls += 1;
		return originalToggle(name, force);
	};
	fullUrlCheckbox.checked = true;
	fullUrlCheckbox.dispatch('change');
	assert.equal(directToggleCalls, 1);
	singleRadio.checked = false;
	batchRadio.checked = true;
	batchRadio.dispatch('change');
	assert.deepEqual(batchBuildCalls, ['parent-b']);
	assert.equal((apiCheckbox.listeners.get('change') || []).length, 0);
	assert.equal((fullUrlCheckbox.listeners.get('change') || []).length, 0);
	assert.equal((batchRadio.listeners.get('change') || []).length, 0);
});
test('reopening endpoint dialog replaces Escape cleanup and never chains close wrappers', () => {
	const first = {
		id: 'first',
		name: 'First',
		type: 'chat',
		style: 'openai',
		children: []
	};
	const second = {
		id: 'second',
		name: 'Second',
		type: 'chat',
		style: 'openai',
		children: []
	};
	const harness = createEditDialogHarness({
		nodes: [first, second]
	});
	const document = harness.context.document;
	attachRealDocumentListeners(document);
	harness.dialog.hasAttribute = function(name) {
		return name === 'open' && this.open;
	};
	let nativeCloseCount = 0;
	harness.dialog.close = function() {
		nativeCloseCount += 1;
		this.open = false;
	};
	harness.context.__showEditGroupDialog(first, null, () => {});
	harness.context.__showEditGroupDialog(second, null, () => {});
	assert.equal(document.listeners.get('keydown').length, 1);
	document.removeCallCount = 0;
	harness.dialog.close();
	assert.equal(nativeCloseCount, 1);
	assert.equal(document.removeCallCount, 1);
	harness.context.__showEditGroupDialog(first, null, () => {});
	harness.context.__showEditGroupDialog(second, null, () => {});
	document.removeCallCount = 0;
	document.dispatchEvent({
		type: 'keydown',
		key: 'Escape'
	});
	assert.equal(nativeCloseCount, 2);
	assert.equal(document.removeCallCount, 1);
	assert.equal(document.listeners.get('keydown').length, 0);
});
test('metadata-only edit does not migrate empty legacy fields into params', async () => {
	const node = {
		id: 'tts-empty',
		name: 'TTS empty',
		type: 'tts',
		style: 'openai',
		voice: '',
		instruction: '',
		children: []
	};
	const tree = {
		nodes: [node]
	};
	const dialogHarness = createEditDialogHarness(tree);
	const storeHarness = createStoreHarness(tree);
	let saveData;
	let updatePromise;
	dialogHarness.context.__showEditGroupDialog(node, null, data => {
		saveData = data;
		updatePromise = storeHarness.api.updateNode(node.id, data);
	});
	dialogHarness.dialog.querySelector('input[name="name"]').value = 'Renamed empty TTS';
	dialogHarness.okButton.onclick();
	await updatePromise;
	assert.equal(Object.hasOwn(saveData, 'params'), false);
	assert.equal(Object.hasOwn(node, 'params'), false);
	assert.equal(Object.hasOwn(node, 'voice'), true);
	assert.equal(Object.hasOwn(node, 'instruction'), true);
	assert.equal(node.voice, '');
	assert.equal(node.instruction, '');
});
test('new dialog clears stale batch state and rebuilds against the current parent', () => {
	const tree = {
		nodes: [{
			id: 'parent-a',
			name: 'Parent A',
			type: 'chat',
			style: 'openai',
			children: []
		}, {
			id: 'parent-b',
			name: 'Parent B',
			type: 'chat',
			style: 'openai',
			children: []
		}]
	};
	const harness = createEditDialogHarness(tree);
	const tabContainer = harness.dialog.querySelector('.tab.container');
	const singleRadio = tabContainer.querySelector('input[value="single"]');
	const batchLabel = new MiniElement('label', 'btn tab');
	const batchRadio = new MiniElement('input');
	batchRadio.name = 'dialog-tab';
	batchRadio.value = 'batch';
	batchRadio.type = 'radio';
	batchLabel.appendChild(batchRadio);
	tabContainer.appendChild(batchLabel);
	const batchRootName = new MiniElement('input');
	batchRootName.name = 'batch-root-name';
	const fieldList = new MiniElement('div', 'field-list');
	fieldList.hasChildNodes = function() {
		return this.children.length > 0;
	};
	harness.dialog.querySelector('form').appendChild(batchRootName);
	harness.dialog.querySelector('form').appendChild(fieldList);
	const originalQuerySelector = harness.dialog.querySelector.bind(harness.dialog);
	harness.dialog.querySelector = function(selector) {
		if (selector === 'input[name="batch-root-name"]') return batchRootName;
		if (selector === '.field-list') return fieldList;
		return originalQuerySelector(selector);
	};
	const buildCalls = [];
	let submitted;
	harness.context.buildBatchFields = function(_dialog, parentId) {
		buildCalls.push(parentId);
		const block = new MiniElement('div', 'batch-field');
		block.dataset.parentId = parentId;
		const checkbox = new MiniElement('input');
		checkbox.type = 'checkbox';
		block.appendChild(checkbox);
		fieldList.appendChild(block);
	};
	harness.context.handleBatchSubmit = function(_dialog, parentId) {
		submitted = {
			parentId,
			rootName: batchRootName.value,
			fieldParentId: fieldList.firstChild && fieldList.firstChild.dataset.parentId
		};
		return true;
	};
	harness.context.__showEditGroupDialog(null, 'parent-a', () => {});
	singleRadio.checked = false;
	batchRadio.checked = true;
	batchRadio.dispatch('change');
	batchRootName.value = 'Old A root';
	fieldList.firstChild.querySelector('input[type="checkbox"]').checked = true;
	harness.dialog.close();
	harness.context.__showEditGroupDialog(null, 'parent-b', () => {});
	assert.equal(batchRootName.value, '');
	assert.equal(fieldList.children.length, 0);
	assert.equal(singleRadio.checked, true);
	assert.equal(batchRadio.checked, false);
	singleRadio.checked = false;
	batchRadio.checked = true;
	batchRadio.dispatch('change');
	assert.deepEqual(buildCalls, ['parent-a', 'parent-b']);
	batchRootName.value = 'New B root';
	harness.okButton.onclick();
	assert.deepEqual(submitted, {
		parentId: 'parent-b',
		rootName: 'New B root',
		fieldParentId: 'parent-b'
	});
	assert.equal((batchRadio.listeners.get('change') || []).length, 0);
});
test('empty legacy voice displays model while untouched save blocks requests and explicit inherit restores parent voice', async () => {
	const child = {
		id: 'child',
		name: 'Child',
		voice: '',
		children: []
	};
	const tree = {
		nodes: [{
			id: 'parent',
			name: 'Parent',
			type: 'tts',
			style: 'openai',
			params: {
				voice: 'alloy'
			},
			children: [child]
		}]
	};
	const storeHarness = createStoreHarness(tree);
	const dialogHarness = createEditDialogHarness(tree);
	const mergeParams = createMergeParamsHarness();
	dialogHarness.context.resolveNodeConfig = storeHarness.api.resolveNodeConfig;
	let saveData;
	let updatePromise;
	dialogHarness.context.__showEditGroupDialog(child, null, data => {
		saveData = data;
		updatePromise = storeHarness.api.updateNode(child.id, data);
	});
	assert.equal(dialogHarness.getParamRow('voice').dataset.state, 'model');
	dialogHarness.dialog.querySelector('input[name="name"]').value = 'Renamed child';
	dialogHarness.okButton.onclick();
	await updatePromise;
	assert.equal(Object.hasOwn(saveData, 'params'), false);
	assert.equal(Object.hasOwn(saveData, '_removeLegacyParamFields'), false);
	assert.equal(Object.hasOwn(child, 'params'), false);
	assert.equal(child.voice, '');
	const blockedConfig = storeHarness.api.resolveNodeConfig(child.id);
	assert.equal(blockedConfig.params.voice, '');
	const blockedBody = {};
	mergeParams(blockedBody, blockedConfig.params, blockedConfig.style);
	assert.equal(Object.hasOwn(blockedBody, 'voice'), false);
	dialogHarness.context.__showEditGroupDialog(child, null, data => {
		saveData = data;
		updatePromise = storeHarness.api.updateNode(child.id, data);
	});
	dialogHarness.selectParamDecision('voice', 'inherit');
	dialogHarness.okButton.onclick();
	assert.deepEqual(Array.from(saveData._removeLegacyParamFields), ['voice']);
	await updatePromise;
	assert.equal(Object.hasOwn(child, 'voice'), false);
	assert.equal(Object.hasOwn(child, 'params'), false);
	const inheritedConfig = storeHarness.api.resolveNodeConfig(child.id);
	assert.equal(inheritedConfig.params.voice, 'alloy');
	const inheritedBody = {};
	mergeParams(inheritedBody, inheritedConfig.params, inheritedConfig.style);
	assert.equal(inheritedBody.voice, 'alloy');
});
test('batch drag handlers reset across cancelled drags and reused new-node dialogs', () => {
	const tree = {
		nodes: [{
			id: 'parent-a',
			name: 'Parent A',
			type: 'chat',
			style: 'openai',
			children: []
		}, {
			id: 'parent-b',
			name: 'Parent B',
			type: 'chat',
			style: 'openai',
			children: []
		}]
	};
	const harness = createEditDialogHarness(tree);
	const list = new MiniElement('div', 'field-list');
	list.hasChildNodes = function() {
		return this.children.length > 0;
	};
	harness.dialog.querySelector('form').appendChild(list);
	const originalQuerySelector = harness.dialog.querySelector.bind(harness.dialog);
	harness.dialog.querySelector = function(selector) {
		if (selector === '.field-list') return list;
		return originalQuerySelector(selector);
	};

	function makeField(name) {
		const block = new MiniElement('div', 'batch-field');
		block.dataset.field = name;
		block.getBoundingClientRect = function() {
			return {
				top: 0,
				height: 100
			};
		};
		const handle = new MiniElement('span', 'handle');
		block.appendChild(handle);
		return {
			block,
			handle
		};
	}

	function handlerCount(type) {
		return (list.listeners.get(type) || []).length + (typeof list['on' + type] === 'function' ? 1 : 0);
	}
	const transfer = {
		effectAllowed: '',
		dropEffect: ''
	};
	harness.context.__showEditGroupDialog(null, 'parent-a', () => {});
	const stale = makeField('stale-a');
	const staleSibling = makeField('stale-sibling');
	list.appendChild(stale.block);
	list.appendChild(staleSibling.block);
	harness.context.__setupBatchDragDrop(list);
	list.dispatch('dragstart', {
		target: stale.handle,
		dataTransfer: transfer
	});
	list.dispatch('dragend', {
		target: stale.handle,
		dataTransfer: transfer
	});
	harness.dialog.close();
	harness.context.__showEditGroupDialog(null, 'parent-b', () => {});
	for (const type of ['dragstart', 'dragover', 'drop', 'dragend']) assert.equal(handlerCount(type), 0, type + ' must clear before rebuilding');
	const currentFirst = makeField('current-first');
	const currentSecond = makeField('current-second');
	list.appendChild(currentFirst.block);
	list.appendChild(currentSecond.block);
	harness.context.__setupBatchDragDrop(list);
	for (const type of ['dragstart', 'dragover', 'drop', 'dragend']) assert.equal(handlerCount(type), 1, type + ' must have one current handler');
	list.dispatch('drop', {
		target: currentSecond.block,
		clientY: 75,
		dataTransfer: transfer
	});
	assert.deepEqual(list.children.map(block => block.dataset.field), ['current-first', 'current-second']);
	list.dispatch('dragstart', {
		target: currentFirst.handle,
		dataTransfer: transfer
	});
	list.dispatch('dragover', {
		target: currentSecond.block,
		clientY: 75,
		dataTransfer: transfer
	});
	list.dispatch('drop', {
		target: currentSecond.block,
		clientY: 75,
		dataTransfer: transfer
	});
	list.dispatch('dragend', {
		target: currentFirst.handle,
		dataTransfer: transfer
	});
	assert.deepEqual(list.children.map(block => block.dataset.field), ['current-second', 'current-first']);
	assert.equal(list.querySelectorAll('.dragging').length, 0);
	assert.equal(list.querySelectorAll('.drag-over').length, 0);
	harness.dialog.close();
	harness.context.__showEditGroupDialog(null, 'parent-a', () => {});
	for (const type of ['dragstart', 'dragover', 'drop', 'dragend']) assert.equal(handlerCount(type), 0, type + ' must not accumulate after another reopen');
});
test('legacy parameter removal metadata is narrow immutable and collision-safe', async () => {
	const collision = {
		importedBusinessValue: true
	};
	const children = [{
		id: 'child',
		name: 'Child',
		children: []
	}];
	const params = {
		temperature: 0.7
	};
	const customParams = [{
		key: 'x',
		value: 'y'
	}];
	const harness = createStoreHarness({
		nodes: [{
			id: 'node',
			name: 'Node',
			baseUrl: 'https://example.test',
			voice: 'alloy',
			instruction: 'Speak clearly',
			params,
			customParams,
			other: 'keep',
			_removeLegacyParamFields: collision,
			children
		}]
	});
	const removalFields = ['voice', 'instruction', 'name', 'baseUrl', 'params', 'customParams', 'id', 'children', 'other'];
	const updates = {
		name: 'Renamed',
		_removeLegacyParamFields: removalFields
	};
	const snapshot = cloneJson(updates);
	const updated = await harness.api.updateNode('node', updates);
	assert.equal(updated.name, 'Renamed');
	assert.equal(Object.hasOwn(updated, 'voice'), false);
	assert.equal(Object.hasOwn(updated, 'instruction'), false);
	assert.equal(updated.baseUrl, 'https://example.test');
	assert.equal(updated.params, params);
	assert.equal(updated.customParams, customParams);
	assert.equal(updated.id, 'node');
	assert.equal(updated.children, children);
	assert.equal(updated.other, 'keep');
	assert.equal(updated._removeLegacyParamFields, collision);
	assert.deepEqual(updates, snapshot);
	assert.equal(updates._removeLegacyParamFields, removalFields);
});
test('legacy parameter removal metadata is ignored by addNode and never newly persisted by updateNode', async () => {
	const harness = createStoreHarness({
		nodes: [{
			id: 'existing',
			name: 'Existing',
			voice: 'alloy',
			children: []
		}]
	});
	const created = await harness.api.addNode(null, {
		name: 'Created',
		voice: 'nova',
		_removeLegacyParamFields: ['voice']
	});
	const updated = await harness.api.updateNode('existing', {
		_removeLegacyParamFields: ['voice']
	});
	assert.equal(Object.hasOwn(created, '_removeLegacyParamFields'), false);
	assert.equal(Object.hasOwn(created, 'voice'), false);
	assert.equal(Object.hasOwn(updated, 'voice'), false);
	assert.equal(Object.hasOwn(updated, '_removeLegacyParamFields'), false);
});
test('session parameter mode comes from the override layer, not resolved endpoint values', () => {
	const harness = createSessionParamDialogHarness({
		currentSession: {
			id: 'session-A',
			modelParams: {}
		},
		workspaceParams: {
			'endpoint-1': {
				temperature: 0.2
			}
		},
		resolvedEndpointParams: {
			temperature: 0.7
		}
	});
	harness.open();
	const row = harness.getParamRow('temperature');
	assert.equal(row.dataset.state, 'inherit');
	assert.equal(row.querySelector('.inherited.param.hint').textContent, '当前为 0.7');
});
test('session parameter editor saves own and model-decides values to workspace and opened session', async () => {
	const harness = createSessionParamDialogHarness({
		currentSession: {
			id: 'session-A',
			modelParams: {}
		}
	});
	harness.open();
	harness.selectParamDecision('temperature', 'own');
	harness.setParamValue('temperature', 0.3);
	harness.selectParamDecision('max_tokens', 'model');
	await harness.okButton.onclick();
	const expected = {
		temperature: 0.3,
		max_tokens: null
	};
	assert.deepEqual(harness.getWorkspaceParams()['endpoint-1'], expected);
	assert.deepEqual(harness.getSession('session-A').modelParams['endpoint-1'], expected);
	assert.equal(harness.getParamRow('temperature').dataset.changed, 'false');
	assert.equal(harness.getParamRow('max_tokens').dataset.changed, 'false');
});
test('session parameter editor removes only fields changed to endpoint defaults', async () => {
	const own = {
		temperature: 0.4,
		max_tokens: 200,
		unknown: 'keep'
	};
	const harness = createSessionParamDialogHarness({
		currentSession: {
			id: 'session-A',
			modelParams: {
				'endpoint-1': own
			}
		},
		workspaceParams: {
			'endpoint-1': own
		}
	});
	harness.open();
	harness.selectParamDecision('temperature', 'inherit');
	await harness.okButton.onclick();
	const expected = {
		max_tokens: 200,
		unknown: 'keep'
	};
	assert.deepEqual(harness.getWorkspaceParams()['endpoint-1'], expected);
	assert.deepEqual(harness.getSession('session-A').modelParams['endpoint-1'], expected);
});
test('session parameter editor removes empty endpoint override objects', async () => {
	const own = {
		temperature: 0.4
	};
	const harness = createSessionParamDialogHarness({
		currentSession: {
			id: 'session-A',
			modelParams: {
				'endpoint-1': own
			}
		},
		workspaceParams: {
			'endpoint-1': own
		}
	});
	harness.open();
	harness.selectParamDecision('temperature', 'inherit');
	await harness.okButton.onclick();
	assert.equal(Object.hasOwn(harness.getWorkspaceParams(), 'endpoint-1'), false);
	assert.equal(Object.hasOwn(harness.getSession('session-A'), 'modelParams'), false);
});
test('untouched session parameters preserve legacy values null blockers and unknown fields', async () => {
	const own = {
		temperature: 0.4,
		max_tokens: null,
		unknown: 'keep'
	};
	const harness = createSessionParamDialogHarness({
		currentSession: {
			id: 'session-A',
			modelParams: {
				'endpoint-1': own
			}
		},
		workspaceParams: {
			'endpoint-1': own
		}
	});
	harness.open();
	await harness.okButton.onclick();
	assert.deepEqual(harness.getWorkspaceParams()['endpoint-1'], own);
	assert.deepEqual(harness.getSession('session-A').modelParams['endpoint-1'], own);
});
test('workspace-only session parameter editor saves without updating a session', async () => {
	const harness = createSessionParamDialogHarness({
		currentSession: null,
		workspaceParams: {
			'endpoint-1': {
				temperature: null,
				unknown: 'keep'
			}
		}
	});
	harness.open();
	assert.equal(harness.getParamRow('temperature').dataset.state, 'model');
	harness.selectParamDecision('temperature', 'own');
	harness.setParamValue('temperature', 0.3);
	await harness.okButton.onclick();
	assert.deepEqual(harness.getWorkspaceParams()['endpoint-1'], {
		temperature: 0.3,
		unknown: 'keep'
	});
	assert.deepEqual(harness.updateSessionTargets, []);
});
test('session parameter reset removes the whole override and redraws endpoint fallback', async () => {
	const own = {
		temperature: 0.3,
		unknown: 'remove'
	};
	const harness = createSessionParamDialogHarness({
		currentSession: {
			id: 'session-A',
			modelParams: {
				'endpoint-1': own
			}
		},
		workspaceParams: {
			'endpoint-1': own
		},
		resolvedEndpointParams: {
			temperature: 0.7
		}
	});
	harness.open();
	await harness.resetButton.onclick();
	assert.equal(Object.hasOwn(harness.getWorkspaceParams(), 'endpoint-1'), false);
	assert.equal(Object.hasOwn(harness.getSession('session-A'), 'modelParams'), false);
	assert.equal(harness.getParamRow('temperature').dataset.state, 'inherit');
	assert.equal(harness.getParamRow('temperature').querySelector('.inherited.param.hint').textContent, '当前为 0.7');
});
test('session parameter validation blocks transactions focuses the invalid control and keeps the dialog open', async () => {
	const harness = createSessionParamDialogHarness({
		currentSession: null,
		controlTransactions: true
	});
	harness.open();
	harness.selectParamDecision('max_tokens', 'own');
	const control = harness.setParamValue('max_tokens', 1.5);
	await harness.okButton.onclick();
	assert.equal(harness.transactionCalls.length, 0);
	assert.equal(control.focused, true);
	assert.equal(harness.dialog.open, true);
});
test('invalid session parameter save invalidates an earlier pending reset without starting another transaction', async () => {
	const harness = createSessionParamDialogHarness({
		currentSession: null,
		controlTransactions: true
	});
	harness.open();
	const staleReset = harness.resetButton.onclick();
	harness.selectParamDecision('max_tokens', 'own');
	harness.setParamValue('max_tokens', 1.5);
	await harness.okButton.onclick();
	assert.equal(harness.transactionCalls.length, 1);
	harness.transactionCalls[0].resolve();
	await staleReset;
	assert.equal(harness.getRenderCount(), 1, 'the invalid newer save must keep the earlier reset completion stale');
});
test('failed session parameter save keeps the dialog and original dirty baseline', async () => {
	const harness = createSessionParamDialogHarness({
		currentSession: {
			id: 'session-A',
			modelParams: {
				'endpoint-1': {
					temperature: 0.4
				}
			}
		},
		controlTransactions: true
	});
	harness.open();
	harness.setParamValue('temperature', 0.3);
	const saving = harness.okButton.onclick();
	harness.transactionCalls[0].reject(new Error('save failed'));
	await saving;
	assert.equal(harness.dialog.open, true);
	assert.equal(harness.getParamRow('temperature').dataset.originalState, 'own');
	assert.equal(harness.getParamRow('temperature').dataset.changed, 'true');
	assert.equal(harness.getParamRow('temperature').querySelector('input[type="range"]').value, '0.3');
});
test('reopening the same session parameter dialog does not accumulate lifecycle or button listeners', async () => {
	const harness = createSessionParamDialogHarness({
		currentSession: {
			id: 'session-A',
			modelParams: {}
		},
		sessions: [{
			id: 'session-B',
			modelParams: {}
		}]
	});
	harness.open();
	harness.setCurrentSession({
		id: 'session-B'
	});
	harness.open();
	assert.equal((harness.dialog.listeners.get('cancel') || []).length, 1);
	assert.equal((harness.dialog.listeners.get('close') || []).length, 1);
	harness.selectParamDecision('temperature', 'own');
	harness.setParamValue('temperature', 0.3);
	await harness.okButton.onclick();
	assert.deepEqual(harness.updateSessionTargets, ['session-B']);
	assert.deepEqual(harness.getSession('session-A').modelParams, {});
	assert.deepEqual(harness.getSession('session-B').modelParams['endpoint-1'], {
		temperature: 0.3
	});
});
test('callAllModels applies null missing and own session parameter decisions over endpoint values', async () => {
	const scenarios = [
		[{
			id: 'session-1',
			modelParams: {
				'endpoint-1': {
					temperature: null
				}
			}
		}, null],
		[{
			id: 'session-1',
			modelParams: {
				'endpoint-1': {}
			}
		}, 0.7],
		[{
			id: 'session-1',
			modelParams: {
				'endpoint-1': {
					temperature: 0.3
				}
			}
		}, 0.3]
	];
	for (const [currentSession, expected] of scenarios) {
		const harness = createCallAllModelsHarness({
			currentSession,
			endpointParams: {
				temperature: 0.7
			}
		});
		await harness.api.callAllModels([], ['endpoint-1'], [], () => {}, 'session-1');
		assert.equal(harness.callApiCalls[0].params.temperature, expected);
		const body = {};
		createMergeParamsHarness()(body, harness.callApiCalls[0].params, 'openai');
		assert.equal(Object.hasOwn(body, 'temperature'), expected !== null);
		if (expected !== null) assert.equal(body.temperature, expected);
	}
});

test('handleSend keeps unified file content through chat provider dispatch', async () => {
	const file = { type: 'file', name: 'report.pdf', source: { type: 'base64', media_type: 'application/pdf', data: 'JVBERi0xLjQ=' } };
	const generationStarts = [];
	const controller = new AbortController();
	const context = vm.createContext({
		console,
		AbortController,
		currentSession: { id: 'session-1', messages: [] },
		defaultSelectedEndpointParams: {},
		pendingAttachments: [],
		selectedEndpoints: ['endpoint-1'],
		sessionGenerations: new Map(),
		addMessage: async function(sessionId, role, content) { if (role === 'user') context.currentSession.messages.push({ role, content }); },
		appendUserMessage() {},
		callAllModels: async function(groups, endpointIds, messages) { generationStarts.push(messages); return []; },
		clearAttachments() {},
		clearInput() {},
		createSession: async function() { throw new Error('existing session must be reused'); },
		findModelById() { return null; },
		getGroups() { return []; },
		getInputMessage: async function() { return [{ type: 'text', text: 'Review this file' }, file]; },
		getSessionAbortController() { return controller; },
		loadSession: async function() { return context.currentSession; },
		normalizeMessageContent(message) { return message.content; },
		renderSelectedEndpoints() {},
		resolveNodeConfig() { return { type: 'chat' }; },
		reorderCardsBySpeed() {},
		reorderSelectorTagsBySpeed() {},
		setButtonState() {},
		showThinkingCards() {},
		toOpenAIContent(content) { return content.map(function(item) { return item.type === 'file' ? { type: 'image_url', image_url: { url: 'wrong' } } : item; }); },
		updateStreamingCard() {},
		refreshUI: async function() {},
		$$() { return []; }
	});
	const apiSource = fs.readFileSync(apiSourcePath, 'utf8');
	const mainSource = fs.readFileSync(mainSourcePath, 'utf8');
	new vm.Script([extractFunctionDeclaration(apiSource, 'isSessionInvalidated'), 'const invalidatedSessionIds = new Set();', 'async ' + extractFunctionDeclaration(mainSource, 'handleSend'), 'globalThis.__handleSend = handleSend;'].join('\n'), { filename: mainSourcePath }).runInContext(context);
	await context.__handleSend();
	assert.deepEqual(cloneJson(generationStarts[0][0].content), [{ type: 'text', text: 'Review this file' }, file]);
});

test('handleSend routes normalized audio attachments to ASR even when File.type is unreliable', async () => {
	const audioFile = { name: 'clip.wav', type: 'application/octet-stream' };
	const asrCalls = [];
	const controller = new AbortController();
	const context = vm.createContext({
		AbortController,
		console: { error() {} },
		currentSession: { id: 'session-1', messages: [], modelParams: {} },
		defaultSelectedEndpointParams: {},
		pendingAttachments: [{ file: audioFile, mediaType: 'audio/wav' }],
		selectedEndpoints: ['asr-1'],
		sessionGenerations: new Map(),
		addMessage: async function(sessionId, role, content) { if (role === 'user') context.currentSession.messages.push({ role, content }); },
		appendUserMessage() {},
		callASR: async function(style, baseUrl, key, model, file) { asrCalls.push(file); return { text: 'transcript' }; },
		clearAttachments() {},
		clearInput() {},
		createSession: async function() { throw new Error('existing session must be reused'); },
		findModelById() { return { node: { name: 'ASR model' } }; },
		finishSessionAbortController() {},
		getGroups() { return []; },
		getInputMessage: async function() { return [{ type: 'text', text: 'Transcribe this' }]; },
		getSessionAbortController() { return controller; },
		hasOwnEndpointParams() { return false; },
		isSessionInvalidated() { return false; },
		loadSession: async function() { return context.currentSession; },
		normalizeMessageContent(message) { return message.content; },
		readOwnEndpointParams() { return {}; },
		renderSelectedEndpoints() {},
		resolveNodeConfig() { return { type: 'asr', style: 'openai', baseUrl: '', key: '', params: {}, isFullUrl: false }; },
		reorderCardsBySpeed() {},
		reorderSelectorTagsBySpeed() {},
		setButtonState() {},
		showThinkingCards() {},
		updateCardAsText() {},
		updateCardStatus() {},
		updateStreamingCard() {},
		refreshUI: async function() {},
		$$() { return []; }
	});
	const apiSource = fs.readFileSync(apiSourcePath, 'utf8');
	const mainSource = fs.readFileSync(mainSourcePath, 'utf8');
	new vm.Script([extractFunctionDeclaration(apiSource, 'isSessionInvalidated'), 'const invalidatedSessionIds = new Set();', 'async ' + extractFunctionDeclaration(mainSource, 'handleSend'), 'globalThis.__handleSend = handleSend;'].join('\n'), { filename: mainSourcePath }).runInContext(context);
	await context.__handleSend();
	assert.deepEqual(asrCalls, [audioFile]);
});

test('attachments preserve reliable browser MIME types and recognize PowerPoint extensions', async () => {
	const attachmentsSource = fs.readFileSync(attachmentsSourcePath, 'utf8');
	const pendingAttachments = [];
	const context = vm.createContext({
        Blob: Blob,

        FileReader: class FileReader {
			readAsDataURL() {
				this.result = 'data:audio/mpeg;base64,SUQz';
				this.onload();
			}
		},

        generateUUID() {
			return 'attachment-1';
		},

        pendingAttachments,
        renderPendingAttachments() {}
    });
	new vm.Script([
		extractFunctionDeclaration(attachmentsSource, 'isTextFile'),
		extractFunctionDeclaration(attachmentsSource, 'getMediaType'),
		'async ' + extractFunctionDeclaration(attachmentsSource, 'addAttachment'),
		'globalThis.__attachments = { addAttachment, getMediaType };'
	].join('\n'), { filename: attachmentsSourcePath }).runInContext(context);
	assert.equal(context.__attachments.getMediaType('slides.ppt'), 'application/vnd.ms-powerpoint');
	assert.equal(context.__attachments.getMediaType('slides.pptx'), 'application/vnd.openxmlformats-officedocument.presentationml.presentation');
	await context.__attachments.addAttachment({
		name: 'slides.pptx',
		type: 'application/x-browser-specific-presentation'
	});
	assert.equal(pendingAttachments[0].mediaType, 'application/x-browser-specific-presentation');
	for (const file of [
		{ name: 'clip.mp3', type: '' },
		{ name: 'clip.wav', type: 'application/octet-stream' }
	]) {
		await context.__attachments.addAttachment(file);
		const attachment = pendingAttachments[pendingAttachments.length - 1];
		assert.match(attachment.mediaType, /^audio\//);
		assert.ok(attachment.previewUrl, `${file.name} should have an audio preview`);
	}
});

test('providers encode unified attachments by their documented protocols', () => {
	const context = vm.createContext({ document: {}, HTMLElement: function HTMLElement() {}, Document: function Document() {} });
	context.HTMLElement.prototype = {};
	context.Document.prototype = {};
	const providersSource = fs.readFileSync(path.join(__dirname, '..', 'src', 'modules', 'providers.js'), 'utf8');
	const apiSource = fs.readFileSync(apiSourcePath, 'utf8');
	new vm.Script([extractFunctionDeclaration(apiSource, 'toOpenAIContent'), extractFunctionDeclaration(apiSource, 'toClaudeContent'), extractFunctionDeclaration(apiSource, 'toGeminiContent'), providersSource, 'globalThis.__providers = providers;'].join('\n'), { filename: path.join(__dirname, '..', 'src', 'modules', 'providers.js') }).runInContext(context);
	const text = { type: 'text', text: 'Please inspect these attachments.' };
	const image = { type: 'image', name: 'photo.png', source: { type: 'base64', media_type: 'image/png', data: 'aW1hZ2U=' } };
	const svgImage = { type: 'image', name: 'diagram.svg', source: { type: 'base64', media_type: 'image/svg+xml', data: 'PHN2Zy8+' } };
	const pdf = { type: 'file', name: 'report.pdf', source: { type: 'base64', media_type: 'application/pdf', data: 'JVBERi0xLjQ=' } };
	const docx = { type: 'file', name: 'report.docx', source: { type: 'base64', media_type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', data: 'ZG9jeA==' } };
	const xlsx = { type: 'file', name: 'data.xlsx', source: { type: 'base64', media_type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', data: 'eGxzeA==' } };
	const ppt = { type: 'file', name: 'slides.ppt', source: { type: 'base64', media_type: 'application/vnd.ms-powerpoint', data: 'cHB0' } };
	const pptx = { type: 'file', name: 'slides.pptx', source: { type: 'base64', media_type: 'application/vnd.openxmlformats-officedocument.presentationml.presentation', data: 'cHB0eA==' } };
	const mp3 = { type: 'file', name: 'clip.mp3', source: { type: 'base64', media_type: 'audio/mpeg', data: 'SUQz' } };
	const wav = { type: 'file', name: 'clip.wav', source: { type: 'base64', media_type: 'audio/wav', data: 'UklGRg==' } };
	const webm = { type: 'file', name: 'clip.webm', source: { type: 'base64', media_type: 'audio/webm', data: 'R29nZw==' } };
	const openaiMessages = [{ role: 'user', content: [text, image, pdf, docx, xlsx, ppt, pptx, mp3, wav] }];
	const openai = context.__providers.openai.buildRequest('https://example.test', 'key', 'model', openaiMessages).body.messages[0].content;
	assert.deepEqual(cloneJson(openai), [
		{ type: 'text', text: 'Please inspect these attachments.' },
		{ type: 'image_url', image_url: { url: 'data:image/png;base64,aW1hZ2U=' } },
		{ type: 'file', file: { filename: 'report.pdf', file_data: 'data:application/pdf;base64,JVBERi0xLjQ=' } },
		{ type: 'file', file: { filename: 'report.docx', file_data: 'data:application/vnd.openxmlformats-officedocument.wordprocessingml.document;base64,ZG9jeA==' } },
		{ type: 'file', file: { filename: 'data.xlsx', file_data: 'data:application/vnd.openxmlformats-officedocument.spreadsheetml.sheet;base64,eGxzeA==' } },
		{ type: 'file', file: { filename: 'slides.ppt', file_data: 'data:application/vnd.ms-powerpoint;base64,cHB0' } },
		{ type: 'file', file: { filename: 'slides.pptx', file_data: 'data:application/vnd.openxmlformats-officedocument.presentationml.presentation;base64,cHB0eA==' } },
		{ type: 'input_audio', input_audio: { format: 'mp3', data: 'SUQz' } },
		{ type: 'input_audio', input_audio: { format: 'wav', data: 'UklGRg==' } }
	]);
	assert.throws(() => context.__providers.openai.buildRequest('https://example.test', 'key', 'model', [{ role: 'user', content: [webm] }]), /不支持音频附件/);
	assert.throws(() => context.__providers.openai.buildRequest('https://example.test', 'key', 'model', [{ role: 'user', content: [svgImage] }]), /不支持图片附件/);

	const claude = context.__providers.claude.buildRequest('https://example.test', 'key', 'model', [{ role: 'user', content: [text, image, pdf] }]).body.messages[0].content;
	assert.deepEqual(cloneJson(claude), [
		{ type: 'text', text: 'Please inspect these attachments.' },
		{ type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'aW1hZ2U=' } },
		{ type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: 'JVBERi0xLjQ=' } }
	]);
	for (const unsupported of [docx, xlsx, ppt, pptx, mp3, wav, webm]) {
		assert.throws(() => context.__providers.claude.buildRequest('https://example.test', 'key', 'model', [{ role: 'user', content: [unsupported] }]), /不支持/);
	}
	assert.throws(() => context.__providers.claude.buildRequest('https://example.test', 'key', 'model', [{ role: 'user', content: [svgImage] }]), /不支持图片附件/);

	const responses = context.__providers.responses.buildRequest('https://example.test', 'key', 'model', [{ role: 'user', content: [text, image, pdf, docx, xlsx, ppt, pptx] }]).body.input[0].content;
	assert.deepEqual(cloneJson(responses), [
		{ type: 'input_text', text: 'Please inspect these attachments.' },
		{ type: 'input_image', image_url: 'data:image/png;base64,aW1hZ2U=' },
		{ type: 'input_file', filename: 'report.pdf', file_data: 'data:application/pdf;base64,JVBERi0xLjQ=' },
		{ type: 'input_file', filename: 'report.docx', file_data: 'data:application/vnd.openxmlformats-officedocument.wordprocessingml.document;base64,ZG9jeA==' },
		{ type: 'input_file', filename: 'data.xlsx', file_data: 'data:application/vnd.openxmlformats-officedocument.spreadsheetml.sheet;base64,eGxzeA==' },
		{ type: 'input_file', filename: 'slides.ppt', file_data: 'data:application/vnd.ms-powerpoint;base64,cHB0' },
		{ type: 'input_file', filename: 'slides.pptx', file_data: 'data:application/vnd.openxmlformats-officedocument.presentationml.presentation;base64,cHB0eA==' }
	]);
	for (const unsupported of [mp3, wav, webm]) {
		assert.throws(() => context.__providers.responses.buildRequest('https://example.test', 'key', 'model', [{ role: 'user', content: [unsupported] }]), /不支持音频附件/);
	}

	const promptParts = [{ type: 'file_text', text: 'Text extracted from a file' }];
	assert.equal(context.__providers.openai.buildImageRequest('https://example.test', 'key', 'model', [{ role: 'user', content: promptParts }]).body.prompt, 'Text extracted from a file');
	assert.equal(context.__providers.gemini.buildImageRequest('https://example.test', 'key', 'model', [{ role: 'user', content: promptParts }]).body.contents[0].parts[0].text, 'Text extracted from a file');
	assert.equal(context.__providers.openai.buildVideoRequest('https://example.test', 'key', 'model', [{ role: 'user', content: promptParts }]).body.prompt, 'Text extracted from a file');
	assert.equal(context.__providers.jimeng.buildVideoRequest('https://example.test', 'key', 'model', [{ role: 'user', content: promptParts }]).body.prompt, 'Text extracted from a file');
	assert.equal(context.__providers.openai.buildTTSRequest('https://example.test', 'key', 'model', promptParts.filter(function(part) {
		return part.type === 'text' || part.type === 'file_text';
	}).map(function(part) {
		return part.text || '';
	}).join('\n')).body.input, 'Text extracted from a file');

	const gemini = context.__providers.gemini.buildRequest('https://example.test', 'key', 'unsupported-model', [{ role: 'user', content: [text, image, pdf, docx, xlsx, mp3, wav] }]).body.contents[0].parts;
	assert.deepEqual(cloneJson(gemini), [
		{ text: 'Please inspect these attachments.' },
		{ inline_data: { mime_type: 'image/png', data: 'aW1hZ2U=' } },
		{ inline_data: { mime_type: 'application/pdf', data: 'JVBERi0xLjQ=' } },
		{ inline_data: { mime_type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', data: 'ZG9jeA==' } },
		{ inline_data: { mime_type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', data: 'eGxzeA==' } },
		{ inline_data: { mime_type: 'audio/mpeg', data: 'SUQz' } },
		{ inline_data: { mime_type: 'audio/wav', data: 'UklGRg==' } }
	]);
});


test('providers classify explicit terminal outcomes without rejecting unknown finish reasons', () => {
	const stream = createTerminalStreamHarness('');
	const cases = [{
		style: 'openai',
		json: {
			choices: [{
				finish_reason: 'length'
			}]
		},
		outcome: 'incomplete',
		reason: 'length'
	}, {
		style: 'openai',
		json: {
			choices: [{
				finish_reason: 'content_filter'
			}]
		},
		outcome: 'refused',
		reason: 'content_filter'
	}, {
		style: 'claude',
		json: {
			type: 'message_delta',
			delta: {
				stop_reason: 'max_tokens'
			}
		},
		outcome: 'incomplete',
		reason: 'max_tokens'
	}, {
		style: 'claude',
		json: {
			type: 'error',
			error: {
				message: 'upstream error'
			}
		},
		outcome: 'failed'
	}, {
		style: 'responses',
		json: {
			type: 'response.incomplete',
			response: {
				incomplete_details: {
					reason: 'max_output_tokens'
				}
			}
		},
		outcome: 'incomplete',
		reason: 'max_output_tokens'
	}, {
		style: 'gemini',
		json: {
			promptFeedback: {
				blockReason: 'SAFETY'
			}
		},
		outcome: 'refused',
		reason: 'SAFETY'
	}, {
		style: 'gemini',
		json: {
			candidates: [{
				finishReason: 'MAX_TOKENS'
			}]
		},
		outcome: 'incomplete',
		reason: 'MAX_TOKENS'
	}];
	for (const item of cases) {
		const parsed = stream.providers[item.style].parseChunk(item.json);
		assert.equal(parsed.terminal.outcome, item.outcome);
		if (item.reason) assert.equal(parsed.terminal.reason, item.reason);
	}
	assert.equal(stream.providers.gemini.parseChunk({
		candidates: [{
			finishReason: 'THIRD_PARTY_EXTENSION'
		}]
	}), null);
});

test('explicit failed, refused, and incomplete streams reject with their partial state', async () => {
	const streams = [{
		style: 'openai',
		outcome: 'incomplete',
		data: 'data: {"choices":[{"delta":{"content":"OpenAI partial"}}]}\n\ndata: {"choices":[{"finish_reason":"length"}]}\n\n'
	}, {
		style: 'claude',
		outcome: 'refused',
		data: 'data: {"type":"content_block_delta","delta":{"type":"text_delta","text":"Claude partial"}}\n\ndata: {"type":"message_delta","delta":{"stop_reason":"refusal"}}\n\n'
	}, {
		style: 'responses',
		outcome: 'failed',
		data: 'data: {"type":"response.output_text.delta","delta":"Responses partial"}\n\ndata: {"type":"response.failed","response":{"error":{"message":"upstream failed"}}}\n\n'
	}, {
		style: 'gemini',
		outcome: 'incomplete',
		data: 'data: {"candidates":[{"content":{"parts":[{"text":"Gemini partial"}]}}]}\n\ndata: {"candidates":[{"finishReason":"MAX_TOKENS"}]}\n\n'
	}];
	for (const item of streams) {
		const stream = createTerminalStreamHarness(item.data);
		await assert.rejects(stream.callProvider(stream.providers[item.style], '', '', '', [], () => {}, null, item.style, {}, false), function(error) {
			assert.equal(error.terminal.outcome, item.outcome);
			assert.ok(error.state.content.includes('partial'));
			return true;
		});
	}
});

test('SSE parsing skips invalid JSON but propagates provider exceptions', async () => {
	const stream = createTerminalStreamHarness('data: not-json\n\ndata: {"content":"valid"}\n\n');
	const state = {
		content: '',
		thinking: '',
		phase: 'content',
		thinkingStartTime: null,
		firstContentTokenTime: null,
		thinkingDuration: null
	};
	await stream.processSSEStream(new Response('data: not-json\n\ndata: {"content":"valid"}\n\n'), {
		parseChunk(json) {
			return json;
		}
	}, state, null, () => {});
	assert.equal(state.content, 'valid');
	await assert.rejects(stream.processSSEStream(new Response('data: {"content":"valid"}\n\n'), {
		parseChunk() {
			throw new Error('provider parser failed');
		}
	}, state, null, () => {}), /provider parser failed/);
});

test('callAllModels reports terminal failures without discarding streamed partial content', async () => {
	const callAllModels = createCallAllModelsTerminalHarness();
	const [result] = await callAllModels([], ['endpoint-1'], [], () => {}, 'session-1');
	assert.equal(result.status, 'failed');
	assert.equal(result.error, '响应因输出长度限制而不完整');
	assert.equal(result.content, 'partial answer');
	assert.equal(result.thinking, 'partial reasoning');
	assert.equal(result.thinkingDuration, 12);
});


test('bug4 Responses files, audio validation, refusal errors, and EOF SSE events follow protocol', async () => {
	const context = vm.createContext({ document: {}, HTMLElement: function HTMLElement() {}, Document: function Document() {} });
	context.HTMLElement.prototype = {};
	context.Document.prototype = {};
	const providersSource = fs.readFileSync(path.join(__dirname, '..', 'src', 'modules', 'providers.js'), 'utf8');
	const apiSource = fs.readFileSync(apiSourcePath, 'utf8');
	new vm.Script([extractFunctionDeclaration(apiSource, 'toOpenAIContent'), extractFunctionDeclaration(apiSource, 'toClaudeContent'), extractFunctionDeclaration(apiSource, 'toGeminiContent'), providersSource, 'globalThis.__providers = providers;'].join('\n'), { filename: path.join(__dirname, '..', 'src', 'modules', 'providers.js') }).runInContext(context);
	const zip = { type: 'file', name: 'archive.zip', source: { type: 'base64', media_type: 'application/zip', data: 'UEsDBA==' } };
	const octetStream = { type: 'file', name: 'payload.bin', source: { type: 'base64', media_type: 'application/octet-stream', data: 'AAE=' } };
	const responseFiles = context.__providers.responses.buildRequest('https://example.test', 'key', 'model', [{ role: 'user', content: [zip, octetStream] }]).body.input[0].content;
	assert.deepEqual(cloneJson(responseFiles), [
		{ type: 'input_file', filename: 'archive.zip', file_data: 'data:application/zip;base64,UEsDBA==' },
		{ type: 'input_file', filename: 'payload.bin', file_data: 'data:application/octet-stream;base64,AAE=' }
	]);
	for (const file of [
		{ type: 'file', name: 'wrong.wav', source: { type: 'base64', media_type: 'audio/mpeg', data: 'SUQz' } },
		{ type: 'file', name: 'wrong.mp3', source: { type: 'base64', media_type: 'audio/wav', data: 'UklGRg==' } },
		{ type: 'file', name: 'clip.ogg', source: { type: 'base64', media_type: 'audio/ogg', data: 'T2dnUw==' } }
	]) {
		assert.throws(() => context.__providers.openai.buildRequest('https://example.test', 'key', 'model', [{ role: 'user', content: [file] }]), /不支持音频附件/);
	}
	const stream = createTerminalStreamHarness('');
	for (const json of [
		{ type: 'response.refusal.delta', delta: 'policy refusal' },
		{ type: 'response.refusal.done', response: { status_details: { reason: 'safety' } } },
		{ type: 'error', error: { message: 'event failure' } },
		{ error: { message: 'top-level failure' } }
	]) {
		const parsed = stream.providers.responses.parseChunk(json);
		assert.ok(parsed.terminal);
	}
	const refusal = stream.providers.responses.parseChunk({ type: 'response.refusal.delta', delta: 'policy refusal' }).terminal;
	assert.equal(refusal.outcome, 'refused');
	assert.equal(refusal.message, 'policy refusal');
	const failure = stream.providers.responses.parseChunk({ error: { message: 'top-level failure' } }).terminal;
	assert.equal(failure.outcome, 'failed');
	assert.equal(failure.message, 'top-level failure');
	const eofStream = createTerminalStreamHarness('data:{"type":"response.output_text.delta","delta":"EOF content"}\n\ndata:{"type":"response.refusal.done","response":{"status_details":{"reason":"safety"}}}\n\ndata:{"type":"response.completed"}');
	await assert.rejects(eofStream.callProvider(eofStream.providers.responses, '', '', '', [], () => {}, null, 'responses', {}, false), error => {
		assert.equal(error.terminal.outcome, 'refused');
		assert.equal(error.terminal.reason, 'safety');
		assert.equal(error.state.content, 'EOF content');
		return true;
	});
});


test('bug5 provider terminal contracts preserve protocol data and partial responses', async () => {
	const stream = createTerminalStreamHarness('');
	const responseInput = stream.providers.responses.buildRequest('https://example.test', 'key', 'model', [
		{ role: 'user', content: 'first question' },
		{ role: 'assistant', content: 'previous answer' },
		{ role: 'user', content: [{ type: 'text', text: 'next question' }] }
	]).body.input;
	assert.deepEqual(cloneJson(responseInput), [
		{ type: 'message', role: 'user', content: [{ type: 'input_text', text: 'first question' }] },
		{ type: 'message', role: 'assistant', content: 'previous answer' },
		{ type: 'message', role: 'user', content: [{ type: 'input_text', text: 'next question' }] }
	]);

	const chatRefusal = stream.providers.openai.parseChunk({
		choices: [{ delta: { refusal: 'Cannot help with that.' } }]
	});
	assert.equal(chatRefusal.terminal.outcome, 'refused');
	assert.equal(chatRefusal.terminal.message, 'Cannot help with that.');
	assert.equal(chatRefusal.refusalDelta, 'Cannot help with that.');

	const chatRefusalStream = createTerminalStreamHarness(`data: {"choices":[{"delta":{"refusal":"Policy "}}]}

data: {"choices":[{"delta":{"refusal":"refusal"},"finish_reason":"stop"}]}

`);
	await assert.rejects(chatRefusalStream.callProvider(chatRefusalStream.providers.openai, '', '', '', [], () => {}, null, 'openai', {}, false), error => {
		assert.equal(error.terminal.outcome, 'refused');
		assert.equal(error.terminal.message, 'Policy refusal');
		assert.match(error.message, /Policy refusal/);
		return true;
	});

	for (const reason of ['RECITATION', 'LANGUAGE', 'IMAGE_SAFETY', 'IMAGE_PROHIBITED_CONTENT', 'IMAGE_RECITATION']) {
		assert.equal(stream.providers.gemini.parseChunk({ candidates: [{ finishReason: reason }] }).terminal.outcome, 'refused');
	}
	for (const reason of ['MALFORMED_FUNCTION_CALL', 'MALFORMED_RESPONSE', 'UNEXPECTED_TOOL_CALL', 'TOO_MANY_TOOL_CALLS', 'MISSING_THOUGHT_SIGNATURE']) {
		assert.equal(stream.providers.gemini.parseChunk({ candidates: [{ finishReason: reason }] }).terminal.outcome, 'failed');
	}
	assert.equal(stream.providers.gemini.parseChunk({ candidates: [{ finishReason: 'OTHER' }] }), null);

	const officialError = stream.providers.responses.parseChunk({
		type: 'error',
		message: 'Invalid input',
		code: 'invalid_request',
		param: 'input[0]'
	}).terminal;
	assert.equal(officialError.outcome, 'failed');
	assert.match(officialError.message, /Invalid input/);
	assert.match(officialError.message, /invalid_request/);
	assert.match(officialError.message, /input\[0\]/);
	const refusalDone = stream.providers.responses.parseChunk({
		type: 'response.refusal.done',
		refusal: 'Policy refusal'
	}).terminal;
	assert.equal(refusalDone.outcome, 'refused');
	assert.equal(refusalDone.message, 'Policy refusal');

	const refusalStream = createTerminalStreamHarness(`data: {"type":"response.refusal.delta","delta":"Policy "}

data: {"type":"response.refusal.delta","delta":"refusal"}

data: {"type":"response.refusal.done"}

data: {"type":"response.completed"}

`);
	await assert.rejects(refusalStream.callProvider(refusalStream.providers.responses, '', '', '', [], () => {}, null, 'responses', {}, false), error => {
		assert.equal(error.terminal.outcome, 'refused');
		assert.equal(error.terminal.message, 'Policy refusal');
		return true;
	});

	for (const reason of ['pause_turn', 'tool_use']) {
		const parsed = stream.providers.claude.parseChunk({ type: 'message_delta', delta: { stop_reason: reason } });
		assert.equal(parsed.terminal.outcome, 'incomplete');
		assert.equal(parsed.terminal.reason, reason);
	}
});

test('bug5 failed card keeps streamed response text while showing the failure state', () => {
	const harness = createUpdateCardStatusHarness();
	harness.api.updateCardStatus('endpoint-1', 'failed', 'upstream failed', null, 'session-1');
	harness.runNextAnimationFrame();
	assert.equal(harness.contentEl.textContent, 'already rendered');
	assert.equal(harness.bodyContent.innerHTML, '');
	assert.equal(harness.bodyContent.children.length, 2);
	assert.equal(harness.bodyContent.children[1].textContent, 'upstream failed');
});

test('SSE terminal priority lets upstream failures replace refusal and preserves complete refusal text', async () => {
	for (const failedEvent of [
		'data: {"type":"error","error":{"message":"top-level upstream error"}}\n\n',
		'data: {"type":"response.failed","response":{"error":{"message":"response failed upstream"}}}\n\n'
	]) {
		const stream = createTerminalStreamHarness(
			'data: {"type":"response.refusal.delta","delta":"Policy "}\n\n'
			+ 'data: {"type":"response.refusal.delta","delta":"refusal"}\n\n'
			+ 'data: {"type":"response.refusal.done"}\n\n'
			+ failedEvent
		);
		await assert.rejects(stream.callProvider(stream.providers.responses, '', '', '', [], () => {}, null, 'responses', {}, false), error => {
			assert.equal(error.terminal.outcome, 'failed');
			assert.match(error.terminal.message, /upstream/);
			return true;
		});
	}

	const refusalStream = createTerminalStreamHarness(
		'data: {"choices":[{"delta":{"refusal":"Policy "}}]}\n\n'
		+ 'data: {"choices":[{"delta":{"refusal":"refusal"}}]}\n\n'
		+ 'data: {"choices":[{"finish_reason":"stop"}]}\n\n'
		+ 'data: {"choices":[{"finish_reason":"refusal"}]}\n\n'
	);
	await assert.rejects(refusalStream.callProvider(refusalStream.providers.openai, '', '', '', [], () => {}, null, 'openai', {}, false), error => {
		assert.equal(error.terminal.outcome, 'refused');
		assert.equal(error.terminal.message, 'Policy refusal');
		return true;
	});
});

test('attachment previews and ASR uploads use extension-normalized audio MIME types', async () => {
	const attachmentsSource = fs.readFileSync(attachmentsSourcePath, 'utf8');
	const pendingAttachments = [];
	const previewTypes = [];
	const context = vm.createContext({
		Blob,
		FileReader: class FileReader {
			readAsDataURL(blob) {
				previewTypes.push(blob.type);
				this.result = 'data:' + blob.type + ';base64,SUQz';
				this.onload();
			}
		},
		generateUUID() { return 'attachment-1'; },
		pendingAttachments,
		renderPendingAttachments() {}
	});
	new vm.Script([
		extractFunctionDeclaration(attachmentsSource, 'isTextFile'),
		extractFunctionDeclaration(attachmentsSource, 'getMediaType'),
		'async ' + extractFunctionDeclaration(attachmentsSource, 'addAttachment'),
		'globalThis.__attachments = { addAttachment };'
	].join('\n'), { filename: attachmentsSourcePath }).runInContext(context);
	const wav = new Blob(['RIFF'], { type: 'application/octet-stream' });
	Object.defineProperty(wav, 'name', { value: 'clip.wav' });
	await context.__attachments.addAttachment(wav);
	assert.equal(pendingAttachments[0].mediaType, 'audio/wav');
	assert.deepEqual(previewTypes, ['audio/wav']);
	assert.match(pendingAttachments[0].previewUrl, /^data:audio\/wav;base64,/);

	const mp3 = new Blob(['ID3'], { type: '' });
	Object.defineProperty(mp3, 'name', { value: 'clip.mp3' });
	const asrCalls = [];
	const controller = new AbortController();
	const mainContext = vm.createContext({
		AbortController,
		Blob,
		console: { error() {} },
		currentSession: { id: 'session-1', messages: [], modelParams: {} },
		defaultSelectedEndpointParams: {},
		pendingAttachments: [{ file: mp3, mediaType: 'audio/mpeg' }],
		selectedEndpoints: ['asr-1'],
		sessionGenerations: new Map(),
		addMessage: async function(sessionId, role, content) { if (role === 'user') mainContext.currentSession.messages.push({ role, content }); },
		appendUserMessage() {},
		callASR: async function(style, baseUrl, key, model, file) { asrCalls.push(file); return { text: 'transcript' }; },
		clearAttachments() {}, clearInput() {},
		createSession: async function() { throw new Error('existing session must be reused'); },
		findModelById() { return { node: { name: 'ASR model' } }; },
		finishSessionAbortController() {}, getGroups() { return []; },
		getInputMessage: async function() { return [{ type: 'text', text: 'Transcribe this' }]; },
		getSessionAbortController() { return controller; }, hasOwnEndpointParams() { return false; },
		isSessionInvalidated() { return false; }, loadSession: async function() { return mainContext.currentSession; },
		normalizeMessageContent(message) { return message.content; }, readOwnEndpointParams() { return {}; },
		renderSelectedEndpoints() {}, resolveNodeConfig() { return { type: 'asr', style: 'openai', baseUrl: '', key: '', params: {}, isFullUrl: false }; },
		reorderCardsBySpeed() {}, reorderSelectorTagsBySpeed() {}, setButtonState() {}, showThinkingCards() {},
		updateCardAsText() {}, updateCardStatus() {}, updateStreamingCard() {}, refreshUI: async function() {}, $$() { return []; }
	});
	const apiSource = fs.readFileSync(apiSourcePath, 'utf8');
	const mainSource = fs.readFileSync(mainSourcePath, 'utf8');
	new vm.Script([extractFunctionDeclaration(apiSource, 'isSessionInvalidated'), 'const invalidatedSessionIds = new Set();', 'async ' + extractFunctionDeclaration(mainSource, 'handleSend'), 'globalThis.__handleSend = handleSend;'].join('\n'), { filename: mainSourcePath }).runInContext(mainContext);
	await mainContext.__handleSend();
	assert.equal(asrCalls.length, 1);
	assert.equal(asrCalls[0].type, 'audio/mpeg');
	assert.equal(asrCalls[0].name, 'clip.mp3');
	assert.equal(asrCalls[0].size, mp3.size);
});
