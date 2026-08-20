'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const selectedEndpointsSourcePath = path.join(__dirname, '..', 'src', 'modules', 'selected-endpoints.js');
const sharedSourcePath = path.join(__dirname, '..', 'src', 'modules', 'shared.js');
const attachmentsSourcePath = path.join(__dirname, '..', 'src', 'modules', 'attachments.js');
const specialEndpointIds = ['__proto__', 'constructor'];

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

function endpointParamHelperDeclarations(selectedSource) {
	return [
		extractFunctionDeclaration(selectedSource, 'hasOwnEndpointParams'),
		extractFunctionDeclaration(selectedSource, 'readOwnEndpointParams'),
		extractFunctionDeclaration(selectedSource, 'writeOwnEndpointParams'),
		extractFunctionDeclaration(selectedSource, 'deleteOwnEndpointParams')
	];
}

function endpointOverrideMap(endpointId, value) {
	return JSON.parse(`{${JSON.stringify(endpointId)}:${JSON.stringify(value)}}`);
}

function createMemoryStorage() {
	const values = new Map();
	const writes = [];
	return {
		getItem(key) {
			return values.has(key) ? values.get(key) : null;
		},
		removeItem(key) {
			values.delete(key);
			writes.push({ key, value: null });
		},
		setItem(key, value) {
			values.set(key, String(value));
			writes.push({ key, value: String(value) });
		},
		writes
	};
}

function createEndpointParamHelperHarness() {
	const selectedSource = fs.readFileSync(selectedEndpointsSourcePath, 'utf8');
	const context = vm.createContext({});
	const source = [
		...endpointParamHelperDeclarations(selectedSource),
		'globalThis.__has = hasOwnEndpointParams;',
		'globalThis.__read = readOwnEndpointParams;',
		'globalThis.__write = writeOwnEndpointParams;',
		'globalThis.__delete = deleteOwnEndpointParams;'
	].join('\n');
	new vm.Script(source, {
		filename: selectedEndpointsSourcePath
	}).runInContext(context);
	return {
		delete(target, endpointId) {
			return context.__delete(target, endpointId);
		},
		has(target, endpointId) {
			return context.__has(target, endpointId);
		},
		read(target, endpointId) {
			return context.__read(target, endpointId);
		},
		write(target, endpointId, value) {
			return context.__write(target, endpointId, value);
		}
	};
}

function createWorkspaceTransactionHarness(initialWorkspaceParams = {}) {
	const selectedSource = fs.readFileSync(selectedEndpointsSourcePath, 'utf8');
	const localStorage = createMemoryStorage();
	const context = vm.createContext({
		defaultSelectedEndpointParams: initialWorkspaceParams,
		endpointParamsTransactionQueue: Promise.resolve(),
		localStorage,
		updateSession: async function() {
			throw new Error('updateSession should not be called without a session id');
		}
	});
	const source = [
		...endpointParamHelperDeclarations(selectedSource),
		extractFunctionDeclaration(selectedSource, 'saveDefaultSelectedEndpointParams'),
		extractFunctionDeclaration(selectedSource, 'persistEndpointParamsTransaction'),
		'globalThis.__persist = persistEndpointParamsTransaction;'
	].join('\n');
	new vm.Script(source, {
		filename: selectedEndpointsSourcePath
	}).runInContext(context);
	return {
		localStorage,
		workspaceParams: initialWorkspaceParams,
		async write(endpointId, value) {
			await context.__persist(endpointId, value, null, function() {});
		}
	};
}

function createSessionEditorHarness(endpointId) {
	const selectedSource = fs.readFileSync(selectedEndpointsSourcePath, 'utf8');
	const localStorage = createMemoryStorage();
	const workspaceParams = {};
	const session = {
		id: 'session-1',
		modelParams: {}
	};
	const buttons = {
		close: {},
		ok: {},
		reset: {}
	};
	const paramList = {};
	const dialog = {
		_paramOperationGeneration: 0,
		addEventListener() {},
		close() {},
		querySelector(selector) {
			if (selector === '.model-path') return { textContent: '' };
			if (selector === '.param-control.list') return paramList;
			if (selector === '.close') return buttons.close;
			if (selector === '.ok') return buttons.ok;
			if (selector === '.reset') return buttons.reset;
			return null;
		},
		showModal() {}
	};
	const context = vm.createContext({
		alert(message) {
			throw new Error(message);
		},
		collectModelParamControls() {
			return {
				params: {
					temperature: 0.61
				},
				valid: true
			};
		},
		currentSession: session,
		defaultSelectedEndpointParams: workspaceParams,
		document: {
			querySelector(selector) {
				return selector === 'dialog.session-param-editor' ? dialog : null;
			}
		},
		endpointParamsTransactionQueue: Promise.resolve(),
		findModelById() {
			return {
				ancestors: [],
				node: {
					id: endpointId,
					name: 'special endpoint'
				}
			};
		},
		getGroups() {
			return [];
		},
		getParamDefs() {
			return [];
		},
		localStorage,
		renderModelParamControls() {},
		resolveNodeConfig() {
			return {
				params: {},
				style: 'openai',
				type: 'chat'
			};
		},
		async updateSession(sessionId, updateSessionParams) {
			assert.equal(sessionId, session.id);
			updateSessionParams(session);
			return session;
		}
	});
	const source = [
		...endpointParamHelperDeclarations(selectedSource),
		extractFunctionDeclaration(selectedSource, 'saveDefaultSelectedEndpointParams'),
		extractFunctionDeclaration(selectedSource, 'persistEndpointParamsTransaction'),
		extractFunctionDeclaration(selectedSource, 'openSessionParamEditor'),
		'globalThis.__open = openSessionParamEditor;'
	].join('\n');
	new vm.Script(source, {
		filename: selectedEndpointsSourcePath
	}).runInContext(context);
	return {
		localStorage,
		session,
		workspaceParams,
		async submit() {
			context.__open(endpointId);
			await buttons.ok.onclick();
		}
	};
}

function createRemovalHarness(workspaceParams) {
	const selectedSource = fs.readFileSync(selectedEndpointsSourcePath, 'utf8');
	const localStorage = createMemoryStorage();
	const context = vm.createContext({
		defaultSelectedEndpointParams: workspaceParams,
		localStorage
	});
	const source = [
		...endpointParamHelperDeclarations(selectedSource),
		extractFunctionDeclaration(selectedSource, 'saveDefaultSelectedEndpointParams'),
		extractFunctionDeclaration(selectedSource, 'removeWorkspaceEndpointParams'),
		'globalThis.__remove = removeWorkspaceEndpointParams;'
	].join('\n');
	new vm.Script(source, {
		filename: selectedEndpointsSourcePath
	}).runInContext(context);
	return {
		localStorage,
		remove(endpointId) {
			context.__remove(endpointId);
		}
	};
}

function createChatRequestHarness(sessionParams, workspaceParams, endpointId = 'endpoint-1') {
	const selectedSource = fs.readFileSync(selectedEndpointsSourcePath, 'utf8');
	const sharedSource = fs.readFileSync(sharedSourcePath, 'utf8');
	const requestBodies = [];
	const context = vm.createContext({
		AbortController,
		Date,
		currentSession: {
			id: 'session-1',
			modelParams: sessionParams
		},
		defaultSelectedEndpointParams: workspaceParams,
		findModelById() {
			return {
				node: {
					id: endpointId,
					modelId: 'model-1'
				}
			};
		},
		isSessionInvalidated() {
			return false;
		},
		clearSessionGenerations() {},
		getSessionGenerations() {
			return new Map();
		},
		resolveNodeConfig() {
			return {
				style: 'openai',
				baseUrl: 'https://example.test',
				key: 'key',
				params: {
					endpointDefault: 'retained'
				}
			};
		},
		callAPI: async function(style, baseUrl, apiKey, model, messages, onChunk, signal, params) {
			const body = {};
			context.__mergeParams(body, params, style);
			requestBodies.push(body);
			return {
				content: '',
				thinking: '',
				thinkingDuration: null
			};
		},
		renderSelectedEndpoints() {},
		selectedEndpoints: [],
		sessionGenerations: new Map(),
		updateCardStatus() {}
	});
	const source = [
		...endpointParamHelperDeclarations(selectedSource),
		extractFunctionDeclaration(sharedSource, 'setOwnEnumerableDataProperty'),
		extractFunctionDeclaration(sharedSource, 'mergeParams'),
		extractFunctionDeclaration(sharedSource, 'callAllModels'),
		'globalThis.__mergeParams = mergeParams;',
		'globalThis.__callAllModels = callAllModels;'
	].join('\n');
	new vm.Script(source, {
		filename: sharedSourcePath
	}).runInContext(context);
	return {
		async request() {
			await context.__callAllModels([], [endpointId], [], function() {}, 'session-1');
			return requestBodies[0];
		}
	};
}

function createConnectionTestHarness(workspaceParams, endpointId = 'endpoint-1', style = 'openai', type = 'chat') {
	const selectedSource = fs.readFileSync(selectedEndpointsSourcePath, 'utf8');
	const attachmentsSource = fs.readFileSync(attachmentsSourcePath, 'utf8');
	const sharedSource = fs.readFileSync(sharedSourcePath, 'utf8');
	const connectionTestBlock = attachmentsSource.slice(
		attachmentsSource.indexOf('const connectionStatus = new Map()'),
		attachmentsSource.indexOf('let attachmentTooltip = null;')
	);
	const requests = [];
	const testBodies = {
		openai: {
			chat: { model: 'model-1', messages: [{ role: 'user', content: 'hi' }], max_tokens: 3 },
			embedding: { model: 'model-1', input: 'hi' },
			tts: { model: 'model-1', input: '.' }
		},
		claude: {
			chat: { model: 'model-1', max_tokens: 3, messages: [{ role: 'user', content: 'hi' }] }
		},
		gemini: {
			chat: { contents: [{ role: 'user', parts: [{ text: 'hi' }] }] }
		},
		responses: {
			chat: { model: 'model-1', input: [{ type: 'message', role: 'user', content: [{ type: 'input_text', text: 'hi' }] }], max_output_tokens: 3 }
		}
	};
	const providers = {};
	Object.keys(testBodies).forEach(function(providerStyle) {
		providers[providerStyle] = {};
		Object.keys(testBodies[providerStyle]).forEach(function(providerType) {
			const methodName = providerType === 'chat'
				? 'testConfig'
				: providerType === 'tts' ? 'testTTSConfig' : 'test' + providerType[0].toUpperCase() + providerType.slice(1) + 'Config';
			providers[providerStyle][methodName] = function() {
				return {
					url: 'https://example.test',
					headers: {},
					body: JSON.parse(JSON.stringify(testBodies[providerStyle][providerType]))
				};
			};
		});
	});
	providers.openai.testASRConfig = function() {
		const body = new FormData();
		body.append('file', 'test');
		return {
			url: 'https://example.test',
			headers: {},
			body
		};
	};
	const context = vm.createContext({
		Date,
		FormData,
		defaultSelectedEndpointParams: workspaceParams,
		fetchWithTimeout: async function(url, options) {
			requests.push(options.body instanceof FormData ? options.body : JSON.parse(options.body));
			return {
				ok: true,
				headers: {
					get() {
						return 'text/plain';
					}
				}
			};
		},
		getNode(nodeId) {
			return nodeId === endpointId ? {
				customParams: [{ key: 'vendor_option', value: 'enabled' }]
			} : null;
		},
		isEndpointTestable() {
			return true;
		},
		providers,
		resolveNodeConfig() {
			return {
				baseUrl: 'https://example.test',
				key: 'key',
				modelId: 'model-1',
				type,
				style,
				params: {}
			};
		},
		updateEndpointTestUI() {}
	});
	const source = [
		...endpointParamHelperDeclarations(selectedSource),
		extractFunctionDeclaration(sharedSource, 'setOwnEnumerableDataProperty'),
		extractFunctionDeclaration(sharedSource, 'mergeParams'),
		connectionTestBlock,
		'globalThis.__testConnection = testConnection;'
	].join('\n');
	new vm.Script(source, {
		filename: attachmentsSourcePath
	}).runInContext(context);
	return {
		async request() {
			await context.__testConnection(endpointId);
			return requests[0];
		}
	};
}

function protoOverride(value) {
	return JSON.parse(`{"__proto__":${JSON.stringify(value)}}`);
}

test('endpoint param helpers write special endpoint ids as own enumerable JSON properties', () => {
	const harness = createEndpointParamHelperHarness();
	for (const endpointId of specialEndpointIds) {
		const target = {};
		const value = {
			endpointId,
			temperature: 0.42
		};
		harness.write(target, endpointId, value);
		const descriptor = Object.getOwnPropertyDescriptor(target, endpointId);
		assert.ok(descriptor, `${endpointId} should be an own property`);
		assert.equal(descriptor.enumerable, true);
		assert.equal(harness.has(target, endpointId), true);
		assert.equal(harness.read(target, endpointId), value);
		assert.deepEqual(JSON.parse(JSON.stringify(target))[endpointId], value);
		assert.equal(Object.getPrototypeOf(target), Object.prototype);
	}
});

test('endpoint param helpers do not mistake inherited prototype keys for stored overrides', () => {
	const harness = createEndpointParamHelperHarness();
	const ordinaryObject = {};
	for (const endpointId of specialEndpointIds) {
		assert.equal(harness.has(ordinaryObject, endpointId), false);
		assert.equal(harness.read(ordinaryObject, endpointId), undefined);
	}
});

test('endpoint param helper reads preserve session-own precedence and workspace fallback', () => {
	const harness = createEndpointParamHelperHarness();
	for (const endpointId of specialEndpointIds) {
		const sessionValue = {
			source: 'session'
		};
		const workspaceValue = {
			source: 'workspace'
		};
		const sessionParams = {};
		const workspaceParams = endpointOverrideMap(endpointId, workspaceValue);
		const fallback = harness.has(sessionParams, endpointId)
			? harness.read(sessionParams, endpointId)
			: harness.read(workspaceParams, endpointId);
		assert.deepEqual(fallback, workspaceValue);
		harness.write(sessionParams, endpointId, sessionValue);
		const preferred = harness.has(sessionParams, endpointId)
			? harness.read(sessionParams, endpointId)
			: harness.read(workspaceParams, endpointId);
		assert.deepEqual(preferred, sessionValue);
	}
});

test('endpoint param helper deletion removes only own entries without touching prototypes', () => {
	const harness = createEndpointParamHelperHarness();
	for (const endpointId of specialEndpointIds) {
		const inheritedValue = {
			source: 'prototype'
		};
		const prototype = Object.create(null);
		Object.defineProperty(prototype, endpointId, {
			configurable: true,
			enumerable: true,
			value: inheritedValue,
			writable: true
		});
		const target = Object.create(prototype);
		harness.delete(target, endpointId);
		assert.equal(Object.hasOwn(target, endpointId), false);
		assert.equal(target[endpointId], inheritedValue);
		const ownValue = {
			source: 'own'
		};
		harness.write(target, endpointId, ownValue);
		harness.delete(target, endpointId);
		assert.equal(Object.hasOwn(target, endpointId), false);
		assert.equal(target[endpointId], inheritedValue);
		assert.equal(prototype[endpointId], inheritedValue);
	}
});

test('workspace transaction writes special endpoint ids as serializable own properties', async () => {
	for (const endpointId of specialEndpointIds) {
		const harness = createWorkspaceTransactionHarness();
		const value = {
			source: 'workspace-transaction'
		};
		await harness.write(endpointId, value);
		assert.equal(Object.hasOwn(harness.workspaceParams, endpointId), true);
		assert.deepEqual(JSON.parse(JSON.stringify(harness.workspaceParams[endpointId])), value);
		assert.deepEqual(JSON.parse(JSON.stringify(harness.workspaceParams))[endpointId], value);
		const saved = JSON.parse(harness.localStorage.getItem('defaultSelectedEndpointParams'));
		assert.deepEqual(saved[endpointId], value);
		assert.equal(Object.getPrototypeOf(harness.workspaceParams), Object.prototype);
	}
});

test('session parameter editor writes special endpoint ids safely to session and workspace', async () => {
	for (const endpointId of specialEndpointIds) {
		const harness = createSessionEditorHarness(endpointId);
		await harness.submit();
		for (const target of [harness.session.modelParams, harness.workspaceParams]) {
			assert.equal(Object.hasOwn(target, endpointId), true);
			assert.deepEqual(JSON.parse(JSON.stringify(target[endpointId])), {
				temperature: 0.61
			});
			assert.deepEqual(JSON.parse(JSON.stringify(target))[endpointId], {
				temperature: 0.61
			});
			assert.equal(Object.getPrototypeOf(target), Object.prototype);
		}
	}
});

test('callAllModels uses session-own special endpoint overrides and merges concrete request values', async () => {
	for (const endpointId of specialEndpointIds) {
		const sessionParams = endpointOverrideMap(endpointId, {
			temperature: 0.73
		});
		const workspaceParams = endpointOverrideMap(endpointId, {
			temperature: 0.24
		});
		const body = await createChatRequestHarness(sessionParams, workspaceParams, endpointId).request();
		assert.equal(body.temperature, 0.73);
		assert.equal(body.endpointDefault, 'retained');
	}
});

test('callAllModels ignores inherited special keys and falls back to workspace-own overrides', async () => {
	for (const endpointId of specialEndpointIds) {
		const workspaceParams = endpointOverrideMap(endpointId, {
			top_p: 0.86
		});
		const body = await createChatRequestHarness({}, workspaceParams, endpointId).request();
		assert.equal(body.top_p, 0.86);
		assert.equal(body.endpointDefault, 'retained');
	}
});

test('connection testing reads workspace overrides for special endpoint ids', async () => {
	for (const endpointId of specialEndpointIds) {
		const workspaceParams = endpointOverrideMap(endpointId, {
			frequency_penalty: 0.37
		});
		const body = await createConnectionTestHarness(workspaceParams, endpointId).request();
		assert.equal(body.frequency_penalty, 0.37);
		assert.equal(body.vendor_option, 'enabled');
	}
});

test('workspace removal deletes own special endpoint entries but leaves inherited entries untouched', () => {
	const prototype = Object.create(null);
	for (const endpointId of specialEndpointIds) {
		Object.defineProperty(prototype, endpointId, {
			configurable: true,
			enumerable: true,
			value: {
				source: 'prototype'
			},
			writable: true
		});
	}
	const inheritedOnly = Object.create(prototype);
	const inheritedHarness = createRemovalHarness(inheritedOnly);
	for (const endpointId of specialEndpointIds) inheritedHarness.remove(endpointId);
	assert.equal(inheritedHarness.localStorage.writes.length, 0);
	for (const endpointId of specialEndpointIds) {
		assert.equal(Object.hasOwn(inheritedOnly, endpointId), false);
		assert.equal(inheritedOnly[endpointId], prototype[endpointId]);
	}

	for (const endpointId of specialEndpointIds) {
		const ownParams = endpointOverrideMap(endpointId, {
			source: 'own'
		});
		const ownHarness = createRemovalHarness(ownParams);
		ownHarness.remove(endpointId);
		assert.equal(Object.hasOwn(ownParams, endpointId), false);
		assert.equal(ownHarness.localStorage.writes.length, 1);
	}
});

test('chat session and workspace overrides retain own __proto__ through the final request body with session precedence', async () => {
	const sessionValue = {
		source: 'session'
	};
	const workspaceValue = {
		source: 'workspace'
	};
	const sessionHarness = createChatRequestHarness({
		'endpoint-1': protoOverride(sessionValue)
	}, {
		'endpoint-1': protoOverride(workspaceValue)
	});
	const sessionBody = await sessionHarness.request();
	assert.equal(Object.hasOwn(sessionBody, '__proto__'), true);
	assert.deepEqual(sessionBody.__proto__, sessionValue);
	assert.equal(Object.getPrototypeOf(sessionBody), Object.prototype);

	const workspaceHarness = createChatRequestHarness(null, {
		'endpoint-1': protoOverride(workspaceValue)
	});
	const workspaceBody = await workspaceHarness.request();
	assert.equal(Object.hasOwn(workspaceBody, '__proto__'), true);
	assert.deepEqual(workspaceBody.__proto__, workspaceValue);
	assert.equal(Object.getPrototypeOf(workspaceBody), Object.prototype);
});

test('connection testing retains a workspace own __proto__ override in its final request body', async () => {
	const workspaceValue = {
		source: 'workspace-connection-test'
	};
	const harness = createConnectionTestHarness({
		'endpoint-1': protoOverride(workspaceValue)
	});
	const body = await harness.request();
	assert.equal(Object.hasOwn(body, '__proto__'), true);
	assert.deepEqual(body.__proto__, workspaceValue);
	assert.equal(Object.getPrototypeOf(body), Object.prototype);
});


test('connection testing applies protocol-specific chat token limits after workspace overrides', async () => {
	const cases = [
		{ style: 'openai', tokenPath: ['max_completion_tokens'], excludes: 'max_tokens' },
		{ style: 'claude', tokenPath: ['max_tokens'] },
		{ style: 'responses', tokenPath: ['max_output_tokens'] },
		{ style: 'gemini', tokenPath: ['generationConfig', 'maxOutputTokens'] }
	];
	for (const testCase of cases) {
		const workspaceParams = endpointOverrideMap('endpoint-1', {
			max_tokens: 999,
			max_completion_tokens: 999,
			max_output_tokens: 999,
			temperature: 0.42,
			_custom: [{ key: 'custom_flag', value: 'preserved' }]
		});
		const body = await createConnectionTestHarness(workspaceParams, 'endpoint-1', testCase.style, 'chat').request();
		let target = body;
		for (const key of testCase.tokenPath) target = target[key];
		assert.equal(target, 3, `${testCase.style} test token limit`);
		if (testCase.excludes) assert.equal(Object.hasOwn(body, testCase.excludes), false, `${testCase.style} must not send conflicting ${testCase.excludes}`);
		const params = testCase.style === 'gemini' ? body.generationConfig : body;
		assert.equal(params.temperature, 0.42);
		assert.equal(params.custom_flag, 'preserved');
	}
});

test('connection testing does not inject chat token limits into embedding, TTS, or ASR requests', async () => {
	const cases = [
		{ style: 'openai', type: 'embedding', assertBody(body) {
			assert.equal(body.max_tokens, 999);
			assert.equal(body.max_output_tokens, 999);
		} },
		{ style: 'openai', type: 'tts', assertBody(body) {
			assert.equal(body.max_tokens, 999);
			assert.equal(body.max_output_tokens, 999);
		} },
		{ style: 'openai', type: 'asr', assertBody(body) {
			assert.notEqual(body.get('max_tokens'), '3');
			assert.notEqual(body.get('max_output_tokens'), '3');
		} }
	];
	for (const testCase of cases) {
		const workspaceParams = endpointOverrideMap('endpoint-1', {
			max_tokens: 999,
			max_completion_tokens: 999,
			max_output_tokens: 999,
			temperature: 0.42,
			_custom: [{ key: 'custom_flag', value: 'preserved' }]
		});
		const body = await createConnectionTestHarness(workspaceParams, 'endpoint-1', testCase.style, testCase.type).request();
		testCase.assertBody(body);
	}
});
