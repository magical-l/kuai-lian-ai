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

function createEndpointTreeHarness(handlerSpies) {
	const context = vm.createContext({ console });
	const source = fs.readFileSync(endpointTreeSourcePath, 'utf8');
	new vm.Script(source, { filename: endpointTreeSourcePath }).runInContext(context);

	context.handleNodeDragover = handlerSpies.dragover;
	context.handleNodeDragleave = handlerSpies.dragleave;
	context.handleNodeDrop = handlerSpies.drop;

	return {
		bindEndpointNodeDragEvents: vm.runInContext(
			'typeof bindEndpointNodeDragEvents === \'function\' ? bindEndpointNodeDragEvents : null',
			context
		)
	};
}

function createGenerationApiHarness() {
	const context = vm.createContext({
		console,
		AbortController,
		currentSession: { id: 'session-1' },
		invalidatedSessionIds: new Set(),
		sessionGenerations: new Map()
	});
	const source = fs.readFileSync(apiSourcePath, 'utf8');
	const exposedSource = [
		extractFunctionDeclaration(source, 'invalidateSession'),
		extractFunctionDeclaration(source, 'isSessionInvalidated'),
		extractFunctionDeclaration(source, 'clearSessionInvalidation'),
		'const sessionAbortControllers = new Map();',
		extractFunctionDeclaration(source, 'getSessionAbortController'),
		extractFunctionDeclaration(source, 'abortSessionRequests'),
		extractFunctionDeclaration(source, 'finishSessionAbortController'),
		extractFunctionDeclaration(source, 'getSessionGenerations'),
		extractFunctionDeclaration(source, 'clearSessionGenerations'),
		extractFunctionDeclaration(source, 'stopSessionGenerations'),
		extractFunctionDeclaration(source, 'stopAllGenerations'),
		extractFunctionDeclaration(source, 'deleteSessionGenerations'),
		'globalThis.__generationApi = { getSessionGenerations, deleteSessionGenerations, stopSessionGenerations, stopAllGenerations, invalidateSession, isSessionInvalidated, getSessionAbortController, abortSessionRequests, finishSessionAbortController };'
	].join('\n');

	new vm.Script(exposedSource, { filename: apiSourcePath }).runInContext(context);
	return { api: context.__generationApi };
}

function createGenerationStartHarness(options = {}) {
	const generationStarts = [];
	const context = vm.createContext({
		console,
		currentSession: { id: 'session-1', messages: [] },
		defaultSelectedEndpointParams: {},
		invalidatedSessionIds: new Set(),
		lastUserMessage: '',
		pendingAttachments: [],
		selectedEndpoints: ['endpoint-1'],
		sessionGenerations: new Map(),
		addMessage: async function(sessionId, role, content) {
			if (role === 'user') {
				context.currentSession.messages.push({ role, content });
				if (options.afterUserMessage) await options.afterUserMessage(context);
			}
		},
		appendUserMessage() {},
		callAllModels: async function(groups, endpointIds, messages, onChunk, sessionId) {
			generationStarts.push({ endpointIds: [...endpointIds], messages, sessionId, isSessionInvalidated: context.isSessionInvalidated(sessionId) });
			return [];
		},
		clearAttachments() {},
		clearInput() {},
		createSession: async function() {
			throw new Error('existing session must be reused');
		},
		findModelById() { return null; },
		getGroups() { return []; },
		getInputMessage: async function() {
			return [{ type: 'text', text: 'Hello' }];
		},
		isSessionInvalidated: null,
		loadSession: async function() {
			return context.currentSession;
		},
		normalizeMessageContent(content) { return content; },
		renderSelectedEndpoints() {},
		resolveNodeConfig() { return { type: 'chat' }; },
		reorderCardsBySpeed() {},
		reorderSelectorTagsBySpeed() {},
		setButtonState() {},
		showThinkingCards() {},
		toOpenAIContent(content) { return content; },
		updateStreamingCard() {},
		refreshUI: async function() {},
		$$() { return []; }
	});
	const apiSource = fs.readFileSync(apiSourcePath, 'utf8');
	const mainSource = fs.readFileSync(mainSourcePath, 'utf8');
	const harnessSource = [
		extractFunctionDeclaration(apiSource, 'invalidateSession'),
		extractFunctionDeclaration(apiSource, 'isSessionInvalidated'),
		extractFunctionDeclaration(apiSource, 'clearSessionInvalidation'),
		'async ' + extractFunctionDeclaration(mainSource, 'handleSend'),
		'globalThis.__generationStartApi = { clearSessionInvalidation, handleSend, invalidateSession, isSessionInvalidated };'
	].join('\n');

	new vm.Script(harnessSource, { filename: mainSourcePath }).runInContext(context);
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
		currentSession: { id: 'session-1', messages: [] },
		defaultSelectedEndpointParams: {},
		lastUserMessage: '',
		pendingAttachments: [],
		selectedEndpoints: ['endpoint-1'],
		sessionGenerations: new Map(),
		addMessage: async function(sessionId, role, content) {
			if (role === 'user') context.currentSession.messages.push({ role, content });
			if (role === 'assistant') calls.addAssistant += 1;
		},
		appendUserMessage() {},
		callEmbedding: async function(style, baseUrl, apiKey, model, input, isFullUrl, params, signal) {
			calls.embeddingSignal = signal;
			context.invalidateSession('session-1');
			return { embedding: [0.1], model: 'model-1' };
		},
		clearAttachments() {},
		clearInput() {},
		createSession: async function() {
			throw new Error('existing session must be reused');
		},
		findModelById() { return { node: { id: 'endpoint-1', modelId: 'model-1', name: 'model-1' } }; },
		getGroups() { return []; },
		getInputMessage: async function() {
			return [{ type: 'text', text: 'Hello' }];
		},
		getSessionAbortController() { return controller; },
		loadSession: async function() { return context.currentSession; },
		normalizeMessageContent(content) { return content; },
		renderSelectedEndpoints() {},
		resolveNodeConfig() { return { type: 'embedding', style: 'openai', baseUrl: '', key: '', params: {} }; },
		reorderCardsBySpeed() {},
		reorderSelectorTagsBySpeed() {},
		setButtonState() {},
		showThinkingCards() {},
		toOpenAIContent(content) { return content; },
		updateCardAsEmbedding() { calls.updateEmbedding += 1; },
		updateCardStatus() {},
		refreshUI: async function() {},
		$$() { return []; }
	});
	const apiSource = fs.readFileSync(apiSourcePath, 'utf8');
	const mainSource = fs.readFileSync(mainSourcePath, 'utf8');
	const harnessSource = [
		'const invalidatedSessionIds = new Set();',
		extractFunctionDeclaration(apiSource, 'invalidateSession'),
		extractFunctionDeclaration(apiSource, 'isSessionInvalidated'),
		extractFunctionDeclaration(apiSource, 'clearSessionInvalidation'),
		'async ' + extractFunctionDeclaration(mainSource, 'handleSend'),
		'globalThis.__nonStreamGenerationApi = { handleSend };'
	].join('\n');

	new vm.Script(harnessSource, { filename: mainSourcePath }).runInContext(context);
	return { api: context.__nonStreamGenerationApi, calls, controller };
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
		currentSession: { id: 'session-1', messages: [] },
		defaultSelectedEndpointParams: {},
		lastUserMessage: '',
		pendingAttachments: [],
		selectedEndpoints: ['endpoint-1'],
		sessionGenerations: new Map(),
		addMessage: async function(sessionId, role, content) {
			if (role === 'user') context.currentSession.messages.push({ role, content });
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
		findModelById() { return { node: { id: 'endpoint-1', modelId: 'model-1', name: 'model-1' } }; },
		getGroups() { return []; },
		getInputMessage: async function() {
			return [{ type: 'text', text: 'Hello' }];
		},
		getSessionAbortController() { return controller; },
		loadSession: async function() { return context.currentSession; },
		normalizeMessageContent(content) { return content; },
		renderSelectedEndpoints() {},
		resolveNodeConfig() { return { type: 'embedding', style: 'openai', baseUrl: '', key: '', params: {} }; },
		reorderCardsBySpeed() {},
		reorderSelectorTagsBySpeed() {},
		setButtonState() {},
		showThinkingCards() {},
		toOpenAIContent(content) { return content; },
		updateCardAsEmbedding() { calls.updateEmbedding += 1; },
		updateCardStatus() {},
		refreshUI: async function() {},
		$$() { return []; }
	});
	const apiSource = fs.readFileSync(apiSourcePath, 'utf8');
	const mainSource = fs.readFileSync(mainSourcePath, 'utf8');
	const harnessSource = [
		'const invalidatedSessionIds = new Set();',
		extractFunctionDeclaration(apiSource, 'invalidateSession'),
		extractFunctionDeclaration(apiSource, 'isSessionInvalidated'),
		extractFunctionDeclaration(apiSource, 'clearSessionInvalidation'),
		'async ' + extractFunctionDeclaration(mainSource, 'handleSend'),
		'globalThis.__deferredNonStreamGenerationApi = { handleSend };'
	].join('\n');

	new vm.Script(harnessSource, { filename: mainSourcePath }).runInContext(context);
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
	const contentEl = { textContent: 'already rendered' };
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
	const context = vm.createContext({
		assert,
		getStatusText() { return 'completed'; },
		requestAnimationFrame(callback) {
			animationFrames.push(callback);
			return animationFrames.length;
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
			}
			if (scope === meta && selector === '.status.loading') return icon;
			throw new Error('Unexpected selector: ' + selector);
		}
	});
	const apiSource = fs.readFileSync(apiSourcePath, 'utf8');
	const mainSource = fs.readFileSync(mainSourcePath, 'utf8');
	const harnessSource = [
		'const invalidatedSessionIds = new Set();',
		extractFunctionDeclaration(apiSource, 'invalidateSession'),
		extractFunctionDeclaration(apiSource, 'isSessionInvalidated'),
		extractFunctionDeclaration(mainSource, 'updateCardStatus'),
		'globalThis.__updateCardStatusApi = { invalidateSession, updateCardStatus };'
	].join('\n');

	new vm.Script(harnessSource, { filename: mainSourcePath }).runInContext(context);
	return {
		api: context.__updateCardStatusApi,
		calls,
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
					return { url: 'https://example.test/v1/embeddings', headers: {}, body: {} };
				},
				parseEmbeddingResponse(data) { return data; }
			}
		},
		mergeParams() {},
		fetchWithTimeout: async function(url, options) {
			calls.push({ url, options });
			return {
				ok: true,
				headers: { get() { return 'application/json'; } },
				text: async function() { return '{"embedding":[0.1]}'; }
			};
		}
	});
	const sharedSource = fs.readFileSync(path.join(__dirname, '..', 'src', 'modules', 'shared.js'), 'utf8');
	new vm.Script(`async ${extractFunctionDeclaration(sharedSource, 'callEmbedding')}\nglobalThis.__callEmbedding = callEmbedding;`, {
		filename: sharedSource
	}).runInContext(context);
	return { callEmbedding: context.__callEmbedding, calls };
}

function createCallProviderHarness(options = {}) {
	const context = vm.createContext({
		AbortController,
		Response,
		createInitialState() {
			return { content: '', thinking: '', thinkingDuration: null };
		},
		createTagParser() { return null; },
		currentAbortController: null,
		fetchWithTimeout: async function() {
			if (options.abort) {
				const error = new Error('stopped');
				error.name = 'AbortError';
				throw error;
			}
			return new Response('data: {"choices":[{"delta":{"content":"Hello"}}]}\n\ndata: [DONE]\n\n', {
				status: 200,
				headers: { 'content-type': 'application/json' }
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

function createMediaDownloadHarness(functionName, resultField) {
	const context = vm.createContext({
		console: { warn() {} },
		fetch: async function(url, options) {
			if (url === 'https://download.example/media') {
				const error = new Error('stopped');
				error.name = 'AbortError';
				throw error;
			}
			return {
				ok: true,
				headers: { get() { return 'application/json'; } },
				text: async function() { return JSON.stringify({ data: [{ url: 'https://download.example/media' }] }); }
			};
		},
		fetchWithTimeout: async function() {
			return context.fetch('https://api.example/generate');
		},
		mergeParams() {},
		providers: {
			openai: {
				buildImageRequest() { return { url: 'https://api.example/generate', headers: {}, body: {} }; },
				buildVideoRequest() { return { url: 'https://api.example/generate', headers: {}, body: {} }; }
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
		currentSession: { id: 'session-1', messages: [] },
		defaultSelectedEndpointParams: {},
		lastUserMessage: '',
		pendingAttachments: [],
		selectedEndpoints: ['endpoint-1'],
		sessionGenerations: new Map(),
		addMessage: async function(sessionId, role, content) {
			if (role === 'user') context.currentSession.messages.push({ role, content });
		},
		appendUserMessage() {},
		callAllModels: async function() { return []; },
		clearAttachments() {},
		clearInput() {},
		createSession: async function() {
			throw new Error('existing session must be reused');
		},
		findModelById() { return null; },
		getGroups() { return []; },
		getInputMessage: async function() {
			return [{ type: 'text', text: 'Hello' }];
		},
		getSessionAbortController() { return new AbortController(); },
		isSessionInvalidated: null,
		loadSession: async function() {
			signalLoadSessionStarted();
			return loadSessionPromise;
		},
		normalizeMessageContent(content) { return content; },
		renderSelectedEndpoints() {},
		resolveNodeConfig() { return { type: 'chat' }; },
		reorderCardsBySpeed() {},
		reorderSelectorTagsBySpeed() {},
		setButtonState() {},
		showThinkingCards() {},
		toOpenAIContent(content) { return content; },
		updateStreamingCard() {},
		refreshUI: async function() { refreshUICount += 1; },
		$$() { return []; }
	});
	const apiSource = fs.readFileSync(apiSourcePath, 'utf8');
	const mainSource = fs.readFileSync(mainSourcePath, 'utf8');
	const harnessSource = [
		'const invalidatedSessionIds = new Set();',
		extractFunctionDeclaration(apiSource, 'invalidateSession'),
		extractFunctionDeclaration(apiSource, 'isSessionInvalidated'),
		'async ' + extractFunctionDeclaration(mainSource, 'handleSend'),
		'globalThis.__finallyRaceApi = { handleSend, invalidateSession, getCurrentSession() { return currentSession; } };'
	].join('\n');

	new vm.Script(harnessSource, { filename: mainSourcePath }).runInContext(context);
	return {
		api: context.__finallyRaceApi,
		loadSessionStarted,
		resolveLoadSession,
		getRefreshUICount() { return refreshUICount; },
		setCurrentSession(session) { context.currentSession = session; }
	};
}

function createCallAllModelsHarness(options = {}) {
	const generationStarts = [];
	const context = vm.createContext({
		AbortController,
		Date,
		currentSession: { id: 'session-1' },
		defaultSelectedEndpointParams: {},
		findModelById() { return { node: { id: 'endpoint-1', modelId: 'model-1' } }; },
		isSessionInvalidated: null,
		clearSessionGenerations() {},
		getSessionGenerations(sessionId) {
			if (!context.sessionGenerations.has(sessionId)) context.sessionGenerations.set(sessionId, new Map());
			return context.sessionGenerations.get(sessionId);
		},
		callAPI: async function(_style, _baseUrl, _apiKey, _model, _messages, onChunk) {
			generationStarts.push('callAPI');
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
			return { content: '', thinking: '', thinkingDuration: null };
		},
		renderSelectedEndpoints() {},
		resolveNodeConfig() { return { style: 'openai', baseUrl: '', key: '', params: {} }; },
		selectedEndpoints: [],
		sessionGenerations: new Map(),
		updateCardStatus() {}
	});
	const apiSource = fs.readFileSync(apiSourcePath, 'utf8');
	const sharedSource = fs.readFileSync(path.join(__dirname, '..', 'src', 'modules', 'shared.js'), 'utf8');
	const harnessSource = [
		'const invalidatedSessionIds = new Set();',
		extractFunctionDeclaration(apiSource, 'invalidateSession'),
		extractFunctionDeclaration(apiSource, 'isSessionInvalidated'),
		extractFunctionDeclaration(sharedSource, 'callAllModels'),
		'globalThis.__callAllModelsApi = { callAllModels, invalidateSession };'
	].join('\n');

	new vm.Script(harnessSource, { filename: sharedSource }).runInContext(context);
	return { api: context.__callAllModelsApi, generationStarts };
}

function createSessionDeleteHarness() {
	const events = [];
	let rejectDeleteSession;
	let resolveDeleteSession;
	const deleteSessionPromise = new Promise(function(resolve, reject) {
		resolveDeleteSession = resolve;
		rejectDeleteSession = reject;
	});
	const context = vm.createContext({
		currentSession: { id: 'session-1' },
		deleteSession() {
			events.push('deleteSession');
			return deleteSessionPromise;
		},
		deleteSessionGenerations() {
			events.push('deleteSessionGenerations');
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
			return { ancestors: [], node: { name: 'Endpoint' } };
		},
		fromTemplate() {
			return {
				dataset: {},
				querySelector() {
					return { addEventListener() {}, classList: { add() {} } };
				}
			};
		},
		ensureStreamingHint() {
			return hint;
		},
		mk() {
			return { dataset: {}, appendChild() {} };
		},
		scrollToBottom() {},
		$: function(selector, ctx) {
			if (selector === '.msg.list') return container;
			if (selector === '.response .name') return { textContent: '' };
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

	new vm.Script(exposedSource, { filename: storeSourcePath }).runInContext(context);
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
	const context = vm.createContext({
		console,
		currentSession,
		localStorage,
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
	const exposedSource = source + '\n\nglobalThis.__selectedEndpointsTestApi = {\n\tpersistEndpointParamsTransaction,\n\tgetDefaultSelectedEndpointParams() {\n\t\treturn JSON.parse(JSON.stringify(defaultSelectedEndpointParams));\n\t}\n};';

	new vm.Script(exposedSource, { filename: selectedEndpointsSourcePath }).runInContext(context);

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
		wasUpdateSessionMutated() {
			return updateSessionMutated;
		},
		localStorage
	};
}

function createDescendantTargetTree() {
	return {
		nodes: [
			{
				id: 'dragged',
				name: 'Dragged ancestor',
				children: [
					{
						id: 'target',
						name: 'Target descendant',
						children: []
					}
				]
			},
			{
				id: 'sibling',
				name: 'Unrelated sibling',
				children: []
			}
		]
	};
}

function createGuardTree() {
	return {
		nodes: [
			{
				id: 'dragged',
				name: 'Dragged node',
				children: []
			},
			{
				id: 'target',
				name: 'Target node',
				children: []
			}
		]
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
		this.listeners.set(type, listener);
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

function createEditDialogHarness(tree) {
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
	const typeInputs = ['','chat'].map(value => {
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
	const styleInputs = ['','openai'].map(value => {
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
	const okButton = new MiniElement('button', 'ok');
	okButton.click = function() { if (this.onclick) this.onclick(); };
	const closeButton = new MiniElement('button', 'close');
	form.appendChild(nameInput);
	form.appendChild(modelInput);
	form.appendChild(typeField);
	form.appendChild(styleGroup);
	form.appendChild(urlRow);
	form.appendChild(keyInput);
	form.appendChild(apiToggle);
	form.appendChild(remarkInput);
	header.appendChild(title);
	header.appendChild(sourceHint);
	dialog.appendChild(header);
	dialog.appendChild(tabContainer);
	dialog.appendChild(form);
	dialog.appendChild(okButton);
	dialog.appendChild(closeButton);
	dialog.show = function() { this.open = true; };
	dialog.close = function() { this.open = false; };

	function findNodeWithAncestors(nodes, nodeId, ancestors = []) {
		for (const node of nodes) {
			if (node.id === nodeId) return { node, ancestors };
			if (node.children) {
				const found = findNodeWithAncestors(node.children, nodeId, [...ancestors, node]);
				if (found) return found;
			}
		}
		return null;
	}

	const document = {
		querySelector(selector) {
			if (selector === 'dialog.editing.endpoint' || selector === 'dialog.editing.endpoint') return dialog;
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
			for (let index = result.ancestors.length - 1; index >= 0; index -= 1) {
				const ancestor = result.ancestors[index];
				['baseUrl', 'style', 'key', 'modelId', 'type'].forEach(field => {
					if (!config[field] && ancestor[field]) config[field] = ancestor[field];
				});
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
		getParamDefs() {
			return [];
		}
	});

	const attachmentsSource = fs.readFileSync(attachmentsSourcePath, 'utf8');
	const source = [
		extractFunctionDeclaration(attachmentsSource, 'addInheritIcon'),
		extractFunctionDeclaration(attachmentsSource, 'shouldSaveIsFullUrl'),
		extractFunctionDeclaration(attachmentsSource, 'showEditGroupDialog'),
		'globalThis.__showEditGroupDialog = showEditGroupDialog;'
	].join('\n');
	new vm.Script(source, { filename: attachmentsSourcePath }).runInContext(context);
	return { context, dialog, urlInput, pathSuffix, fullUrlCheckbox, okButton };
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
	harness.resolveEmbedding({ embedding: [0.1], model: 'model-1' });
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
		buildRequest() { return { url: 'https://api.example/chat', headers: {}, body: {} }; },
		needsTagParsing: false
	};

	const state = await callProvider(provider, '', '', '', [], chunk => chunks.push(chunk), null, 'openai', {}, false);

	assert.equal(state.content, 'Hello');
	assert.equal(chunks.length, 1);
});

test('callProvider rethrows AbortError so chat dispatch can mark it stopped', async () => {
	const callProvider = createCallProviderHarness({ abort: true });
	const provider = {
		buildRequest() { return { url: 'https://api.example/chat', headers: {}, body: {} }; },
		needsTagParsing: false
	};

	await assert.rejects(callProvider(provider, '', '', '', [], () => {}, new AbortController().signal, 'openai', {}, false), { name: 'AbortError' });
});

test('callAllModels marks a chat AbortError as stopped and preserves partial content', async () => {
	const harness = createCallAllModelsHarness({ abort: true });

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
	harness.resolveLoadSession({ id: 'session-1', messages: [] });
	await sending;

	assert.equal(harness.api.getCurrentSession(), null);
	assert.equal(harness.getRefreshUICount(), 0);
});

test('image and video download AbortError propagate instead of falling back to the source URL', async () => {
	const imageGeneration = createMediaDownloadHarness('callImageGeneration', 'url');
	const videoGeneration = createMediaDownloadHarness('callVideoGeneration', 'videoUrl');
	const signal = new AbortController().signal;

	await assert.rejects(imageGeneration('openai', '', '', '', [], false, {}, signal), { name: 'AbortError' });
	await assert.rejects(videoGeneration('openai', '', '', '', [], false, {}, signal), { name: 'AbortError' });
});

test('workspace/session parameter transaction restores workspace state after save and reset session failures', async () => {
	const endpointId = 'endpoint-1';
	const workspaceBefore = {
		[endpointId]: { temperature: 0.2, topP: 0.9 }
	};
	const rawWorkspaceBefore = '{\n  "endpoint-1": { "temperature": 0.2, "topP": 0.9 }\n}';
	const sessionBefore = {
		id: 'session-1',
		modelParams: {
			[endpointId]: { temperature: 0.6 },
			'other-endpoint': { topP: 0.4 }
		}
	};
	const harness = createSelectedEndpointsHarness({
		currentSession: sessionBefore,
		updateSessionError: new Error('session update failed'),
		workspaceRaw: rawWorkspaceBefore
	});

	await assert.rejects(
		harness.api.persistEndpointParamsTransaction(
			endpointId,
			{ temperature: 1.1 },
			sessionBefore.id,
			function(session) {
				if (!session.modelParams) session.modelParams = {};
				session.modelParams[endpointId] = { temperature: 1.1 };
			}
		),
		/session update failed/
	);

	assert.equal(harness.wasUpdateSessionMutated(), true);
	assert.deepEqual(cloneJson(harness.api.getDefaultSelectedEndpointParams()), workspaceBefore);
	assert.equal(harness.localStorage.getItem('defaultSelectedEndpointParams'), rawWorkspaceBefore);
	assert.deepEqual(harness.currentSession.modelParams, sessionBefore.modelParams);

	await assert.rejects(
		harness.api.persistEndpointParamsTransaction(
			endpointId,
			undefined,
			sessionBefore.id,
			function(session) {
				delete session.modelParams[endpointId];
				if (Object.keys(session.modelParams).length === 0) delete session.modelParams;
			}
		),
		/session update failed/
	);

	assert.deepEqual(cloneJson(harness.api.getDefaultSelectedEndpointParams()), workspaceBefore);
	assert.equal(harness.localStorage.getItem('defaultSelectedEndpointParams'), rawWorkspaceBefore);
	assert.deepEqual(harness.currentSession.modelParams, sessionBefore.modelParams);
	assert.equal(harness.getUpdateSessionCallCount(), 2);
});

test('workspace/session parameter transaction does not update the session when localStorage rejects the workspace write', async () => {
	const endpointId = 'endpoint-1';
	const workspaceBefore = {
		[endpointId]: { temperature: 0.2 }
	};
	const rawWorkspaceBefore = '{"endpoint-1":{"temperature":0.2}}';
	const sessionBefore = {
		id: 'session-1',
		modelParams: {
			[endpointId]: { temperature: 0.6 }
		}
	};
	const harness = createSelectedEndpointsHarness({
		currentSession: sessionBefore,
		updateSessionError: new Error('updateSession must not run'),
		workspaceRaw: rawWorkspaceBefore
	});
	harness.failNextSetItem(new Error('localStorage write failed'));

	await assert.rejects(
		harness.api.persistEndpointParamsTransaction(
			endpointId,
			{ temperature: 1.1 },
			sessionBefore.id,
			function(session) {
				session.modelParams[endpointId] = { temperature: 1.1 };
			}
		),
		/localStorage write failed/
	);

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
		currentSession: { id: 'session-1' },
		workspaceRaw: '{}',
		updateSession({ callIndex, currentSession, mutator }) {
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

	const firstTransaction = harness.api.persistEndpointParamsTransaction(
		endpointId,
		{ temperature: 0.2 },
		'session-1',
		function(session) {
			session.modelParams = { [endpointId]: { temperature: 0.2 } };
		}
	);
	await firstSessionUpdate;

	const secondTransaction = harness.api.persistEndpointParamsTransaction(
		endpointId,
		{ temperature: 0.8 },
		'session-1',
		function(session) {
			session.modelParams = { [endpointId]: { temperature: 0.8 } };
		}
	);
	await Promise.resolve();
	assert.equal(harness.getUpdateSessionCallCount(), 1, 'the queued transaction must not start before the first session update settles');
	rejectFirstSessionUpdate(firstSessionFailure);

	await assert.rejects(firstTransaction, firstSessionFailure);
	await secondTransaction;

	assert.deepEqual(cloneJson(harness.api.getDefaultSelectedEndpointParams()), {
		[endpointId]: { temperature: 0.8 }
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
		currentSession: { id: 'session-A' },
		workspaceRaw: '{}',
		updateSession({ callIndex, sessionId }) {
			sessionIds.push(sessionId);
			if (callIndex === 1) {
				firstUpdateStarted();
				return new Promise(function(resolve) {
					releaseFirstUpdate = resolve;
				});
			}
		}
	});

	const firstTransaction = harness.api.persistEndpointParamsTransaction(endpointId, { temperature: 0.2 }, 'session-A', function() {});
	await firstUpdate;
	const secondTransaction = harness.api.persistEndpointParamsTransaction(endpointId, { temperature: 0.8 }, 'session-A', function() {});
	harness.setCurrentSession({ id: 'session-B' });
	releaseFirstUpdate();

	await Promise.all([firstTransaction, secondTransaction]);
	assert.deepEqual(sessionIds, ['session-A', 'session-A']);
});

test('workspace/session parameter transaction preserves the session error when rollback storage write fails', async () => {
	const endpointId = 'endpoint-1';
	const sessionError = new Error('session update failed');
	const rollbackError = new Error('localStorage rollback failed');
	const harness = createSelectedEndpointsHarness({
		currentSession: { id: 'session-1' },
		workspaceRaw: '{}',
		setItemErrors: [[2, rollbackError]],
		updateSession() {
			return Promise.reject(sessionError);
		}
	});

	await assert.rejects(
		harness.api.persistEndpointParamsTransaction(
			endpointId,
			{ temperature: 0.8 },
			'session-1',
			function() {}
		),
		function(error) {
			assert.equal(error, sessionError);
			assert.equal(error.rollbackError, rollbackError);
			return true;
		}
	);

	assert.equal(harness.getSetItemCallCount(), 2);
	assert.equal(harness.getUpdateSessionCallCount(), 1);
});

test('workspace/session parameter transaction preserves the session error when rollback removeItem fails without prior workspace storage', async () => {
	const endpointId = 'endpoint-1';
	const sessionError = new Error('session update failed');
	const rollbackError = new Error('localStorage rollback remove failed');
	const harness = createSelectedEndpointsHarness({
		currentSession: { id: 'session-1' },
		workspaceRaw: null,
		removeItemErrors: [[1, rollbackError]],
		updateSession() {
			return Promise.reject(sessionError);
		}
	});

	await assert.rejects(
		harness.api.persistEndpointParamsTransaction(
			endpointId,
			{ temperature: 0.8 },
			'session-1',
			function() {}
		),
		function(error) {
			assert.equal(error, sessionError);
			assert.equal(error.rollbackError, rollbackError);
			return true;
		}
	);

	assert.equal(harness.getSetItemCallCount(), 1);
	assert.equal(harness.getRemoveItemCallCount(), 1);
	assert.equal(harness.getUpdateSessionCallCount(), 1);
});

test('parameter dialog keeps the opened session as the save and reset target after switching sessions', async () => {
	const endpointId = 'endpoint-1';
	const updateSessionTargets = [];
	const paramList = {
		querySelectorAll(selector) {
			assert.equal(selector, 'input, select');
			return [{ name: 'param-temperature', type: 'range', value: '0.8' }];
		}
	};
	const dialog = {
		open: false,
		querySelector(selector) {
			if (selector === '.close') return this.closeButton;
			if (selector === '.ok') return this.okButton;
			if (selector === '.reset') return this.resetButton;
			if (selector === '.param-control.list') return paramList;
			if (selector === '.model-path') return this.modelPath;
			throw new Error(`Unexpected dialog selector: ${selector}`);
		},
		close() {
			this.open = false;
		},
		showModal() {
			this.open = true;
		},
		closeButton: {},
		okButton: {},
		resetButton: {},
		modelPath: { textContent: '' }
	};
	const selectedEndpointsSource = fs.readFileSync(selectedEndpointsSourcePath, 'utf8');
	const persistTransactionSource = extractFunctionDeclaration(selectedEndpointsSource, 'persistEndpointParamsTransaction');
	const openSessionParamEditorSource = extractFunctionDeclaration(selectedEndpointsSource, 'openSessionParamEditor');
	const context = vm.createContext({
		alert() {},
		currentSession: { id: 'session-A', modelParams: { [endpointId]: { temperature: 0.2 } } },
		defaultSelectedEndpointParams: {},
		document: {
			querySelector(selector) {
				assert.equal(selector, 'dialog.session-param-editor');
				return dialog;
			}
		},
		findModelById() {
			return { ancestors: [], node: { name: 'Endpoint' } };
		},
		getGroups() {
			return [];
		},
		persistedWorkspaceParams: [],
		renderParamControlsInDialog() {},
		resolveNodeConfig() {
			return { params: { temperature: 0.2 }, type: 'chat', style: 'openai' };
		},
		saveDefaultSelectedEndpointParams() {},
		localStorage: {
			getItem() {
				return '{}';
			}
		},
		updateSession(sessionId) {
			updateSessionTargets.push(sessionId);
		}
	});
	new vm.Script(`
		var endpointParamsTransactionQueue = Promise.resolve();
		${persistTransactionSource}
		${openSessionParamEditorSource}
		globalThis.__openSessionParamEditor = openSessionParamEditor;
	`, {
		filename: selectedEndpointsSourcePath
	}).runInContext(context);

	context.__openSessionParamEditor(endpointId);
	context.currentSession = { id: 'session-B' };
	await dialog.okButton.onclick();
	await dialog.resetButton.onclick();

	assert.deepEqual(updateSessionTargets, ['session-A', 'session-A']);
});

test('parameter dialog ignores stale save and reset completions after a newer operation begins', async () => {
	const renders = [];
	const alerts = [];
	const transactions = [];
	const paramList = {
		querySelectorAll(selector) {
			assert.equal(selector, 'input, select');
			return [{ name: 'param-temperature', type: 'range', value: '0.8' }];
		}
	};
	const dialog = {
		closeCount: 0,
		open: false,
		querySelector(selector) {
			if (selector === '.close') return this.closeButton;
			if (selector === '.ok') return this.okButton;
			if (selector === '.reset') return this.resetButton;
			if (selector === '.param-control.list') return paramList;
			if (selector === '.model-path') return this.modelPath;
			throw new Error(`Unexpected dialog selector: ${selector}`);
		},
		close() {
			this.closeCount += 1;
			this.open = false;
		},
		showModal() {
			this.open = true;
		},
		closeButton: {},
		okButton: {},
		resetButton: {},
		modelPath: { textContent: '' }
	};
	const selectedEndpointsSource = fs.readFileSync(selectedEndpointsSourcePath, 'utf8');
	const openSessionParamEditorSource = extractFunctionDeclaration(selectedEndpointsSource, 'openSessionParamEditor');
	const context = vm.createContext({
		alert(message) {
			alerts.push(message);
		},
		currentSession: null,
		defaultSelectedEndpointParams: {},
		document: {
			querySelector(selector) {
				assert.equal(selector, 'dialog.session-param-editor');
				return dialog;
			}
		},
		findModelById() {
			return { ancestors: [], node: { name: 'Endpoint' } };
		},
		getGroups() {
			return [];
		},
		persistEndpointParamsTransaction() {
			return new Promise(function(resolve, reject) {
				transactions.push({ resolve, reject });
			});
		},
		renderParamControlsInDialog(...args) {
			renders.push(args);
		},
		resolveNodeConfig() {
			return { params: { temperature: 0.2 }, type: 'chat', style: 'openai' };
		}
	});
	new vm.Script(`${openSessionParamEditorSource}\nglobalThis.__openSessionParamEditor = openSessionParamEditor;`, {
		filename: selectedEndpointsSourcePath
	}).runInContext(context);

	context.__openSessionParamEditor('endpoint-1');
	const staleSave = dialog.okButton.onclick();
	const currentReset = dialog.resetButton.onclick();
	assert.equal(transactions.length, 2);
	transactions[0].resolve();
	await staleSave;
	assert.equal(dialog.closeCount, 0, 'a stale save must not close the dialog opened for the newer operation');
	transactions[1].resolve();
	await currentReset;
	assert.equal(renders.length, 2, 'only the current reset may redraw parameter controls');

	const staleReset = dialog.resetButton.onclick();
	const currentSave = dialog.okButton.onclick();
	assert.equal(transactions.length, 4);
	transactions[2].reject(new Error('stale reset failed'));
	await staleReset;
	assert.deepEqual(alerts, [], 'a stale reset error must not replace the newer operation state');
	transactions[3].reject(new Error('current save failed'));
	await currentSave;
	assert.deepEqual(alerts, ['参数保存失败：current save failed']);
	assert.equal(dialog.open, true, 'the latest failed operation must leave the dialog open');
});

test('parameter dialog invalidates stale operations after native dialog close', async () => {
	const renders = [];
	const alerts = [];
	const transactions = [];
	const paramList = {
		querySelectorAll(selector) {
			assert.equal(selector, 'input, select');
			return [{ name: 'param-temperature', type: 'range', value: '0.8' }];
		}
	};
	const dialog = Object.assign(new FakeEventTarget(), {
		closeCount: 0,
		open: false,
		querySelector(selector) {
			if (selector === '.close') return this.closeButton;
			if (selector === '.ok') return this.okButton;
			if (selector === '.reset') return this.resetButton;
			if (selector === '.param-control.list') return paramList;
			if (selector === '.model-path') return this.modelPath;
			throw new Error('Unexpected dialog selector: ' + selector);
		},
		close() {
			this.closeCount += 1;
			this.open = false;
		},
		showModal() {
			this.open = true;
		},
		closeButton: {},
		okButton: {},
		resetButton: {},
		modelPath: { textContent: '' }
	});
	const selectedEndpointsSource = fs.readFileSync(selectedEndpointsSourcePath, 'utf8');
	const openSessionParamEditorSource = extractFunctionDeclaration(selectedEndpointsSource, 'openSessionParamEditor');
	const context = vm.createContext({
		alert(message) {
			alerts.push(message);
		},
		currentSession: null,
		defaultSelectedEndpointParams: {},
		document: {
			querySelector(selector) {
				assert.equal(selector, 'dialog.session-param-editor');
				return dialog;
			}
		},
		findModelById() {
			return { ancestors: [], node: { name: 'Endpoint' } };
		},
		getGroups() {
			return [];
		},
		persistEndpointParamsTransaction() {
			return new Promise(function(resolve, reject) {
				transactions.push({ resolve, reject });
			});
		},
		renderParamControlsInDialog(...args) {
			renders.push(args);
		},
		resolveNodeConfig() {
			return { params: { temperature: 0.2 }, type: 'chat', style: 'openai' };
		}
	});
	new vm.Script(openSessionParamEditorSource + '\n\nglobalThis.__openSessionParamEditor = openSessionParamEditor;', {
		filename: selectedEndpointsSourcePath
	}).runInContext(context);

	context.__openSessionParamEditor('endpoint-1');
	const staleSave = dialog.okButton.onclick();
	dialog.dispatchEvent({ type: 'cancel' });
	dialog.open = false;
	dialog.showModal();
	transactions[0].resolve();
	await staleSave;

	const staleReset = dialog.resetButton.onclick();
	dialog.dispatchEvent({ type: 'close' });
	dialog.open = false;
	dialog.showModal();
	transactions[1].resolve();
	await staleReset;

	const staleFailure = dialog.okButton.onclick();
	dialog.dispatchEvent({ type: 'cancel' });
	dialog.open = false;
	dialog.showModal();
	transactions[2].reject(new Error('stale save failed'));
	await staleFailure;

	assert.equal(dialog.closeCount, 0, 'old save completions must not close a dialog reopened after native cancel');
	assert.equal(renders.length, 1, 'old reset completions must not render a dialog reopened after native close');
	assert.deepEqual(alerts, [], 'old failed saves must not alert in a dialog reopened after native cancel');
	assert.equal(dialog.open, true, 'old operations must not change the reopened dialog state');
});

function createHandleNodeDeleteFailureHarness() {
	let removed = false;
	let clearTestResultsCalls = 0;
	let refreshUICalls = 0;
	const selectedEndpoints = ['node-1', 'other-1'];
	const connectionStatus = new Map([['node-1', 'connected']]);
	const collapsedEndpoints = new Set(['node-1']);
	const deleteError = new Error('endpoint persistence failed');
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
			return ['node-1'];
		},
		connectionStatus,
		deleteNode: async function() {
			throw deleteError;
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
		selectedEndpoints,
		clearTestResults() {
			clearTestResultsCalls += 1;
		},
		saveDefaultSelectedEndpoints() {}
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
		get removed() { return removed; },
		get clearTestResultsCalls() { return clearTestResultsCalls; },
		get refreshUICalls() { return refreshUICalls; }
	};
}

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

test('showThinkingCards only removes old response cards inside the message list', () => {
	const harness = createShowThinkingCardsHarness();

	harness.showThinkingCards(['endpoint-1'], [], 'session-1');

	assert.equal(harness.removed.sessionItem, false);
	assert.equal(harness.removed.responseCard, true);
});

test('renderSessionList appends each rendered session with standard DOM appendChild', () => {
	const appendedSessions = [];
	const titleEl = { textContent: '' };
	const metaEl = {};
	const timeEl = { textContent: '' };
	const editBtn = { dataset: {}, addEventListener() {} };
	const deleteBtn = { dataset: {}, addEventListener() {} };
	const sessionEl = {
		dataset: {},
		classList: { add() {} },
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
		querySelectorAll() { return []; },
		appendChild(element) { appendedSessions.push(element); }
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
	`, { filename: sessionListSourcePath }).runInContext(context);

	context.__renderSessionList([
		{ id: 'session-1', title: '会话 1', createdAt: 1 }
	], null, null, null, null);

	assert.equal(appendedSessions.length, 1);
	assert.equal(appendedSessions[0], sessionEl);
});

test('handleEditSessionTitleClick consumes a rejected save Promise after blur while restoring the old title', () => {
	const currentTitle = '旧标题';
	const titleEl = {
		textContent: currentTitle,
		classList: {
			add(className) { assert.equal(className, 'hidden'); },
			remove(className) { assert.equal(className, 'hidden'); }
		}
	};
	const inputEl = {
		value: '新标题',
		blur() { this.onblur(); },
		focus() {},
		remove() {},
		select() {}
	};
	const meta = {};
	const sessionEl = {
		dataset: { sessionId: 'session-1' },
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

	assert.equal(
		typeof harness.bindEndpointNodeDragEvents,
		'function',
		'endpoint-tree.js must define bindEndpointNodeDragEvents(nodeEl)'
	);

	const nodeEl = new FakeEventTarget();
	harness.bindEndpointNodeDragEvents(nodeEl);
	const dragoverEvent = { type: 'dragover' };
	const dragleaveEvent = { type: 'dragleave' };
	const dropEvent = { type: 'drop' };

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
	const data = { name: 'New group' };
	const newNode = { id: 'new-group', name: 'New group', children: [] };
	const builtNodeEl = { id: 'built-new-group' };
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
	const data = { name: 'Cancelled group' };
	await onSubmit(data);

	assert.equal(calls.length, 2);
	assert.equal(calls[0][0], 'addNode');
	assert.equal(calls[0][1], null);
	assert.equal(calls[0][2], data);
	assertSkipEndpointTreeRefresh(calls[1]);
});

test('handleAddChildClick creates a first child list, filters it, then refreshes', async () => {
	const calls = [];
	const data = { name: 'New child' };
	const newNode = { id: 'new-child', name: 'New child', children: [] };
	const builtNodeEl = { id: 'built-new-child' };
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
		dataset: { nodeId: 'parent-node' },
		querySelector(selector) {
			if (selector === 'details > ol.children') return null;
			if (selector === 'details') return detailsEl;
			if (selector === '.name') return { classList: parentNameClassList };
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
		children: [{ id: 'existing-child', name: 'Existing endpoint', children: [] }]
	};
	const newNode = { id: 'new-child', name: 'New endpoint', children: [] };
	const classList = {
		add() {},
		remove() {},
		contains(className) {
			return className === 'children';
		}
	};
	const parentBatchBtn = {
		classList,
		dataset: { testableIds: JSON.stringify(['existing-child']) },
		title: ''
	};
	const childTestBtn = { classList, title: '' };
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
		dataset: { nodeId: 'parent-node' },
		parentElement: { classList: { contains() { return false; } } },
		querySelector(selector) {
			if (selector === 'details > ol.children') return null;
			if (selector === 'details') return detailsEl;
			if (selector === '.name') return { classList };
			if (selector === '.test-connection') return parentBatchBtn;
			throw new Error(`Unexpected parent selector: ${selector}`);
		}
	};
	const childNodeEl = {
		dataset: { nodeId: 'new-child' },
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
			assert.deepEqual(data, { name: 'New endpoint' });
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
				return { baseUrl: 'https://example.test', modelId: 'test-model', type: 'chat' };
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
	await onSubmit({ name: 'New endpoint' });

	assert.deepEqual(
		JSON.parse(parentBatchBtn.dataset.testableIds),
		['existing-child', 'new-child'],
		'parent batch test data must include the locally appended testable child'
	);
	context.__handleBatchTestClick(parentBatchBtn);
	assert.deepEqual(batchTestedIds, ['existing-child', 'new-child']);
	assert.equal(context.__updateEndpointTestUICalls(), 1);
});

test('handleAddChildClick refreshes without local DOM work when addNode returns null', async () => {
	const calls = [];
	let onSubmit;
	const nodeEl = {
		dataset: { nodeId: 'parent-node' },
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
	const data = { name: 'Cancelled child' };
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

	const emptyState = { classList: createClassList('hidden') };
	const emptyHint = { textContent: '' };
	const resetBtn = { classList: createClassList('hidden') };
	const addBtn = { classList: createClassList() };
	const aside = {
		querySelector(selector) {
			if (selector === '.empty-state') return emptyState;
			throw new Error(`Unexpected aside selector: ${selector}`);
		}
	};
	const hiddenEndpointNodes = [
		{ classList: createClassList('hidden') },
		{ classList: createClassList('hidden') }
	];
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
			return [{ id: 'filtered-group' }];
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
		child = Object.assign({ id: 'b', children: [] }, data);
		tree.nodes[0].children.push(child);
	});
	nameInput.value = 'B';

	assert.equal(harness.urlInput.value, 'https://parent.example/v1');
	assert.equal(harness.pathSuffix.textContent, '/v1/chat/completions');
	const directUrlToggle = harness.dialog.querySelector('.direct-url.toggle.btn');
	const fullUrlCheckbox = directUrlToggle.querySelector('input[type="checkbox"]');
	fullUrlCheckbox.checked = true;
	assert.equal(fullUrlCheckbox.listeners.has('change'), true);
	fullUrlCheckbox.listeners.get('change').call(fullUrlCheckbox, { type: 'change' });
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
			children: [{ id: 'b', name: 'B', children: [] }]
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
			children: [{ id: 'b', name: 'B', children: [] }]
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
				legacy: { isFullUrl: true },
				inherited: { isFullUrl: true },
				falseOverride: { isFullUrl: false }
			}[nodeId] || null;
		}
	});
	new vm.Script(`${getEditIsFullUrlSource}\nglobalThis.__getEditIsFullUrl = getEditIsFullUrl;`, {
		filename: attachmentsSourcePath
	}).runInContext(context);

	assert.equal(context.__getEditIsFullUrl({ id: 'legacy', directUrl: true }), true);
	assert.equal(context.__getEditIsFullUrl({ id: 'inherited', children: [] }), true);
	assert.equal(context.__getEditIsFullUrl({ id: 'falseOverride', isFullUrl: false }), false);
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
				children: [{ id: 'inherit-grandchild', name: 'Inherit grandchild', children: [] }]
			}]
		}]
	};
	const harness = createStoreHarness(tree);

	const created = await harness.api.addNode('parent', { name: 'Created' });
	assert.equal(Object.hasOwn(created, 'isFullUrl'), false);
	assert.equal(Object.hasOwn(created, 'directUrl'), false);

	const createdFalse = await harness.api.addNode('parent', { name: 'Created false', directUrl: false });
	assert.equal(createdFalse.isFullUrl, false);
	assert.equal(Object.hasOwn(createdFalse, 'directUrl'), false);

	const batchIds = await harness.api.batchAddNodes('parent', [{ name: 'Batch root', children: [{ name: 'Batch child' }] }]);
	const batchRoot = harness.api.getEndpointsData().nodes[0].children.find(function(node) { return node.id === batchIds[0]; });
	assert.equal(Object.hasOwn(batchRoot, 'isFullUrl'), false);
	assert.equal(Object.hasOwn(batchRoot.children[0], 'isFullUrl'), false);

	const cloned = await harness.api.cloneNode('inherit-child');
	assert.equal(Object.hasOwn(cloned, 'isFullUrl'), false);
	assert.equal(Object.hasOwn(cloned.children[0], 'isFullUrl'), false);
});

test('normalizeEndpointFullUrlFlags recursively migrates legacy fields without adding absent overrides', () => {
	const data = { nodes: [{
		id: 'root',
		directUrl: true,
		children: [{
			id: 'child',
			isFullUrl: false,
			directUrl: true,
			children: [{ id: 'legacy-deep', directUrl: false, children: [] }]
		}, {
			id: 'inherit',
			children: []
		}]
	}] };
	const root = data.nodes[0];
	const child = root.children[0];
	const changed = createStoreHarness({ nodes: [] }).api.normalizeEndpointFullUrlFlags(data);

	assert.equal(changed, true);
	assert.equal(data.nodes[0], root);
	assert.equal(data.nodes[0].children[0], child);
	assert.equal(data.nodes[0].isFullUrl, true);
	assert.equal(Object.hasOwn(data.nodes[0], 'directUrl'), false);
	assert.equal(data.nodes[0].children[0].isFullUrl, false);
	assert.equal(Object.hasOwn(data.nodes[0].children[0], 'directUrl'), false);
	assert.equal(data.nodes[0].children[0].children[0].isFullUrl, false);
	assert.equal(Object.hasOwn(data.nodes[0].children[1], 'isFullUrl'), false);
	assert.equal(createStoreHarness({ nodes: [] }).api.normalizeEndpointFullUrlFlags({
		nodes: [{ id: 'unset', children: [] }]
	}), false);
});

test('migrateEndpoints preserves and normalizes direct URL compatibility values', () => {
	const harness = createStoreHarness({ nodes: [] });
	const migrated = harness.api.migrateEndpoints({
		groups: [{
			id: 'legacy-group',
			name: 'Legacy group',
			directUrl: true,
			models: [{ id: 'legacy-model', name: 'Legacy model', directUrl: false }]
		}]
	});

	assert.equal(migrated.nodes[0].isFullUrl, true);
	assert.equal(Object.hasOwn(migrated.nodes[0], 'directUrl'), false);
	assert.equal(migrated.nodes[0].children[0].isFullUrl, false);
	assert.equal(Object.hasOwn(migrated.nodes[0].children[0], 'directUrl'), false);
});

test('updateNode normalizes legacy directUrl updates without retaining the old field', async () => {
	const harness = createStoreHarness({ nodes: [{ id: 'node', name: 'Node', children: [] }] });
	const updated = await harness.api.updateNode('node', { directUrl: true });

	assert.equal(updated.isFullUrl, true);
	assert.equal(Object.hasOwn(updated, 'directUrl'), false);
});

test('edit save omits inherited full URL until the checkbox changes', () => {
	const attachmentsSource = fs.readFileSync(attachmentsSourcePath, 'utf8');
	const shouldSaveIsFullUrlSource = extractFunctionDeclaration(attachmentsSource, 'shouldSaveIsFullUrl');
	const context = vm.createContext({});
	new vm.Script(`${shouldSaveIsFullUrlSource}\nglobalThis.__shouldSaveIsFullUrl = shouldSaveIsFullUrl;`).runInContext(context);

	assert.equal(context.__shouldSaveIsFullUrl({ id: 'child' }, true, true, false), false);
	assert.equal(context.__shouldSaveIsFullUrl({ id: 'child' }, true, false, true), true);
	assert.equal(context.__shouldSaveIsFullUrl({ id: 'legacy', directUrl: false }, false, false, false), true);
	assert.equal(context.__shouldSaveIsFullUrl({ id: 'modern', isFullUrl: true }, true, true, false), true);
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
		nodes: [
			{
				id: 'parent',
				name: 'Parent',
				isFullUrl: true,
				children: [
					{ id: 'child-false', name: 'Explicit false', isFullUrl: false, children: [] },
					{ id: 'child-inherited', name: 'Inherited', children: [] },
					{ id: 'legacy', name: 'Legacy', directUrl: true, children: [] },
					{ id: 'new-wins', name: 'New wins', isFullUrl: false, directUrl: true, children: [] }
				]
			}
		]
	};
	const harness = createStoreHarness(tree);

	assert.equal(harness.api.resolveNodeConfig('child-false').isFullUrl, false);
	assert.equal(harness.api.resolveNodeConfig('child-inherited').isFullUrl, true);
	assert.equal(harness.api.resolveNodeConfig('legacy').isFullUrl, true);
	assert.equal(harness.api.resolveNodeConfig('new-wins').isFullUrl, false);

	const created = await harness.api.addNode(null, { name: 'Created', isFullUrl: true });
	assert.equal(created.isFullUrl, true);
	assert.equal(Object.hasOwn(created, 'directUrl'), false);

	const legacyUpdated = await harness.api.updateNode('legacy', { isFullUrl: false });
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
		nodes: [
			{
				id: 'target',
				name: 'Target',
				children: []
			},
			{
				id: 'middle',
				name: 'Middle',
				children: []
			},
			{
				id: 'dragged',
				name: 'Dragged',
				children: [
					{
						id: 'dragged-child',
						name: 'Dragged child',
						children: []
					}
				]
			}
		]
	};
	const harness = createStoreHarness(tree);
	const result = await harness.api.reorderNode('dragged', 'target', true);
	const updatedTree = harness.api.getEndpointsData();

	assert.equal(result, true);
	assert.deepEqual(
		updatedTree.nodes.map(node => node.id),
		['dragged', 'target', 'middle']
	);
	assert.deepEqual(
		updatedTree.nodes[0].children.map(node => node.id),
		['dragged-child']
	);
	assert.equal(countNodesById(updatedTree.nodes, 'dragged'), 1);
	assert.equal(harness.getSaveCount(), 1);
});

test('moveNodeAsChild appends a node under the target exactly once and persists once', async () => {
	const tree = {
		nodes: [
			{
				id: 'dragged',
				name: 'Dragged',
				children: [
					{
						id: 'dragged-child',
						name: 'Dragged child',
						children: []
					}
				]
			},
			{
				id: 'target',
				name: 'Target parent',
				children: [
					{
						id: 'existing-child',
						name: 'Existing child',
						children: []
					}
				]
			},
			{
				id: 'sibling',
				name: 'Sibling',
				children: []
			}
		]
	};
	const harness = createStoreHarness(tree);
	const result = await harness.api.moveNodeAsChild('dragged', 'target');
	const updatedTree = harness.api.getEndpointsData();

	assert.equal(result, true);
	assert.deepEqual(
		updatedTree.nodes.map(node => node.id),
		['target', 'sibling']
	);
	assert.deepEqual(
		updatedTree.nodes[0].children.map(node => node.id),
		['existing-child', 'dragged']
	);
	assert.deepEqual(
		updatedTree.nodes[0].children[1].children.map(node => node.id),
		['dragged-child']
	);
	assert.equal(countNodesById(updatedTree.nodes, 'dragged'), 1);
	assert.equal(harness.getSaveCount(), 1);
});

const guardedStoreOperations = [
	{
		name: 'reorderNode',
		run(api, targetId) {
			return api.reorderNode('dragged', targetId, true);
		}
	},
	{
		name: 'moveNodeAsChild',
		run(api, targetId) {
			return api.moveNodeAsChild('dragged', targetId);
		}
	}
];

const invalidTargets = [
	{ name: 'the dragged node itself', id: 'dragged' },
	{ name: 'a missing target', id: 'missing' }
];

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
	const newNode = { id: 'new-group', name: 'New group', children: [] };
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
	await onSubmit({ name: 'New group' });

	assert.equal(buildCount, 0);
	assert.equal(appendCount, 0);
});

test('handleAddChildClick does not append a node already inserted by a complete tree render during addNode', async () => {
	let onSubmit;
	let buildCount = 0;
	let appendCount = 0;
	const newNode = { id: 'new-child', name: 'New child', children: [] };
	const existingNodeEl = {};
	const childList = {
		appendChild() {
			appendCount += 1;
		},
		querySelector(selector) {
			return selector.includes(newNode.id) ? existingNodeEl : null;
		}
	};
	const detailsEl = { open: false };
	const refreshedNodeEl = {
		classList: { remove() {} },
		dataset: { nodeId: 'parent-node' },
		querySelector(selector) {
			if (selector === 'details > ol.children') return childList;
			if (selector === 'details') return detailsEl;
			if (selector === '.name') return { classList: { add() {} } };
			return selector.includes(newNode.id) ? existingNodeEl : null;
		}
	};
	const originalNodeEl = {
		isConnected: true,
		dataset: { nodeId: 'parent-node' }
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
	await onSubmit({ name: 'New child' });

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
				if (selector === '.endpoint-type') return { classList: createClassList(typeClass) };
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
				async clearAll() { directoryClearCount += 1; }
			},
			Map,
			alert() {},
			confirmAction(_message, onConfirm) { confirmations.push(onConfirm); },
			refreshUI: async () => {},
			sessionsCache: new Map(),
			showDirectoryPrompt() {},
			storage: {
				getDirectoryName() { return 'test-directory'; },
				mode: 'directory',
				async clearAll() { storageClearCount += 1; }
			},
			updateDirectoryDisplay: async () => {},
			window: { __IS_EXTENSION__: isExtension }
		});

		const harnessSource = [
			'var endpointsData = null;',
			'var endpointsMutationQueue = Promise.resolve();',
			'var sessionMutationQueues = new Map();',
			'var activeStorageSaves = new Set();',
			'var clearGeneration = 0;',
			'var clearInProgress = false;',
			'async ' + clearDirectorySource,
			handleWipeDirectorySource,
			'globalThis.__handleWipeDirectory = handleWipeDirectory;'
		].join(String.fromCharCode(10));
		new vm.Script(harnessSource, { filename: mainSourcePath }).runInContext(context);

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

	[
		'buildEndpointNodeEl',
		'renderEndpointList',
		'updateEndpointTestUI'
	].forEach(function(functionName) {
		assert.match(extractFunctionDeclaration(endpointTreeSource, functionName), /isEndpointTestable\(/, functionName + ' must reuse isEndpointTestable');
	});
	assert.match(extractFunctionDeclaration(mainSource, 'handleTestAllConnections'), /isEndpointTestable\(/, 'handleTestAllConnections must reuse isEndpointTestable');
	assert.match(extractFunctionDeclaration(attachmentsSource.slice(attachmentsSource.indexOf('function testConnection')), 'testConnection'), /isEndpointTestable\(/, 'testConnection must reuse isEndpointTestable');

	const configs = {
		chat: { baseUrl: 'https://example.test', key: '', modelId: 'model', type: 'chat' },
		embedding: { baseUrl: 'https://example.test', key: '', modelId: 'model', type: 'embedding' },
		embed: { baseUrl: 'https://example.test', key: '', modelId: 'model', type: 'embed' },
		tts: { baseUrl: 'https://example.test', key: '', modelId: 'chat-looking-model', type: 'tts' },
		asr: { baseUrl: 'https://example.test', key: '', modelId: 'chat-looking-model', type: 'asr' },
		missingTestFn: { baseUrl: 'https://example.test', key: '', modelId: 'chat-looking-model', style: 'missing-tts', type: 'tts' },
		missingProvider: { baseUrl: 'https://example.test', key: '', modelId: 'model', style: 'missing-provider', type: 'chat' },
		image: { baseUrl: 'https://example.test', key: '', modelId: 'model', type: 'image-generation' },
		video: { baseUrl: 'https://example.test', key: '', modelId: 'model', type: 'video-generation' },
		reranking: { baseUrl: 'https://example.test', key: '', modelId: 'model', type: 'reranking' },
		missingKey: { baseUrl: 'https://example.test', modelId: 'model', type: 'chat' }
	};
	const eligibleIds = new Set(['chat', 'embedding', 'embed', 'tts', 'asr', 'missingTestFn', 'missingProvider']);
	const testCases = [
		{ id: 'tts', expectedCall: 'tts' },
		{ id: 'asr', expectedCall: 'asr' },
		{ id: 'image' },
		{ id: 'video' },
		{ id: 'reranking' },
		{ id: 'missingTestFn', expectedStatus: 'failed', expectedUiUpdates: 2 },
		{ id: 'missingProvider', expectedStatus: 'failed', expectedUiUpdates: 2 }
	];
	const eligibilityContext = vm.createContext({
		resolveNodeConfig(nodeId) { return configs[nodeId]; }
	});
	new vm.Script(eligibilitySource + '\nglobalThis.__isEndpointTestable = isEndpointTestable;').runInContext(eligibilityContext);
	Object.keys(configs).forEach(function(id) {
		assert.equal(eligibilityContext.__isEndpointTestable(id), eligibleIds.has(id), id + ' eligibility');
	});

	const calls = [];
	const uiUpdates = [];
	const connectionTestBlock = attachmentsSource.slice(
		attachmentsSource.indexOf('const connectionStatus = new Map()'),
		attachmentsSource.indexOf('let attachmentTooltip = null;')
	);
	const testContext = vm.createContext({
		Date,
		FormData,
		detectModelType() { return 'chat'; },
		fetchWithTimeout: async function() {
			return { ok: true, headers: { get() { return 'text/plain'; } } };
		},
		getNode() { return {}; },
		isEndpointTestable(nodeId) { return eligibleIds.has(nodeId); },
		mergeParams() {},
		providers: {
			openai: {
				testConfig() { calls.push('chat'); return { url: 'https://example.test', headers: {}, body: {} }; },
				testEmbeddingConfig() { calls.push('embedding'); return { url: 'https://example.test', headers: {}, body: {} }; },
				testTTSConfig() { calls.push('tts'); return { url: 'https://example.test', headers: {}, body: {} }; },
				testASRConfig() { calls.push('asr'); return { url: 'https://example.test', headers: {}, body: {} }; }
			},
			'missing-tts': {}
		},
		resolveNodeConfig(nodeId) { return configs[nodeId]; },
		updateEndpointTestUI(nodeId) { uiUpdates.push(nodeId); }
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
	const connectionTestBlock = attachmentsSource.slice(
		attachmentsSource.indexOf('const connectionStatus = new Map()'),
		attachmentsSource.indexOf('let attachmentTooltip = null;')
	);
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
		getNode() { return {}; },
		isEndpointTestable() { return true; },
		mergeParams() {},
		providers: {
			openai: {
				testConfig() {
					providerCallCount += 1;
					return { url: 'https://example.test', headers: {}, body: {} };
				}
			}
		},
		resolveNodeConfig() {
			return { baseUrl: 'https://example.test', key: '', modelId: 'model', type: 'chat' };
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

	pendingFetches.shift()({ ok: true, headers: { get() { return 'text/plain'; } } });
	await firstTest;

	const retry = context.__testConnection('chat');
	assert.equal(fetchCallCount, 2);
	assert.equal(providerCallCount, 2);
	pendingFetches.shift()({ ok: true, headers: { get() { return 'text/plain'; } } });
	await retry;
});

test('stale connection test completion cannot restore cleared results or update old result UI', async () => {
	const attachmentsSource = fs.readFileSync(path.join(__dirname, '..', 'src', 'modules', 'attachments.js'), 'utf8');
	const connectionTestBlock = attachmentsSource.slice(
		attachmentsSource.indexOf('const connectionStatus = new Map()'),
		attachmentsSource.indexOf('let attachmentTooltip = null;')
	);
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
		getNode() { return {}; },
		isEndpointTestable() { return true; },
		mergeParams() {},
		providers: {
			openai: {
				testConfig() {
					return { url: 'https://example.test', headers: {}, body: {} };
				}
			}
		},
		resolveNodeConfig() {
			return { baseUrl: 'https://example.test', key: '', modelId: 'model', type: 'chat' };
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
	resolveFetch({ ok: true, headers: { get() { return 'text/plain'; } } });
	await pendingTest;

	assert.equal(context.__connectionStatus.has('chat'), false);
	assert.deepEqual(uiUpdates, ['chat']);
});

test('clearTestResults retains P1 until it settles before allowing a second connection test', async () => {
	const attachmentsSource = fs.readFileSync(path.join(__dirname, '..', 'src', 'modules', 'attachments.js'), 'utf8');
	const connectionTestBlock = attachmentsSource.slice(
		attachmentsSource.indexOf('const connectionStatus = new Map()'),
		attachmentsSource.indexOf('let attachmentTooltip = null;')
	);
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
		getNode() { return {}; },
		isEndpointTestable() { return true; },
		mergeParams() {},
		providers: {
			openai: {
				testConfig() {
					providerCallCount += 1;
					return { url: 'https://example.test', headers: {}, body: {} };
				}
			}
		},
		resolveNodeConfig() {
			return { baseUrl: 'https://example.test', key: '', modelId: 'model', type: 'chat' };
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

	pendingFetches.shift()({ ok: true, headers: { get() { return 'text/plain'; } } });
	await p1;

	const p2 = context.__testConnection('chat');
	assert.notStrictEqual(p2, p1);
	assert.equal(fetchCallCount, 2, 'only the post-settlement call may start P2');
	assert.equal(providerCallCount, 2, 'only the post-settlement call may invoke the provider again');
	pendingFetches.shift()({ ok: true, headers: { get() { return 'text/plain'; } } });
	await p2;
});

test('workspace/session parameter transaction rejects and rolls back when the target session is absent', async () => {
	const endpointId = 'endpoint-1';
	const workspaceBefore = {
		[endpointId]: { temperature: 0.2, topP: 0.9 }
	};
	const rawWorkspaceBefore = '{\n  "endpoint-1": { "temperature": 0.2, "topP": 0.9 }\n}';
	const sessionBefore = {
		id: 'session-1',
		modelParams: {
			[endpointId]: { temperature: 0.6 }
		}
	};
	const harness = createSelectedEndpointsHarness({
		currentSession: sessionBefore,
		workspaceRaw: rawWorkspaceBefore,
		updateSession() {
			return null;
		}
	});

	await assert.rejects(
		harness.api.persistEndpointParamsTransaction(
			endpointId,
			{ temperature: 1.1 },
			sessionBefore.id,
			function(session) {
				session.modelParams[endpointId] = { temperature: 1.1 };
			}
		),
		function(error) {
			assert.match(error.message, /目标会话.*(不存在|未保存)|(不存在|未保存).*目标会话/);
			return true;
		}
	);

	assert.equal(harness.getUpdateSessionCallCount(), 1);
	assert.deepEqual(cloneJson(harness.api.getDefaultSelectedEndpointParams()), workspaceBefore);
	assert.equal(harness.localStorage.getItem('defaultSelectedEndpointParams'), rawWorkspaceBefore);
	assert.deepEqual(harness.currentSession, sessionBefore);
});
