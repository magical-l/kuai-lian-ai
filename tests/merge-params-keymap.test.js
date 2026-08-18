'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const sharedSourcePath = path.join(__dirname, '..', 'src', 'modules', 'shared.js');

function extractFunctionDeclaration(source, functionName) {
	const declarationMatch = new RegExp(`\\bfunction\\s+${functionName}\\s*\\(`).exec(source);
	assert.ok(declarationMatch, `Could not find function declaration ${functionName}`);
	const declarationStart = declarationMatch.index;
	const bodyStart = source.indexOf('{', declarationStart);
	assert.notEqual(bodyStart, -1, `Could not find function body for ${functionName}`);
	let depth = 0;
	let stringDelimiter = null;
	let escaped = false;
	for (let index = bodyStart; index < source.length; index += 1) {
		const character = source[index];
		if (stringDelimiter) {
			if (escaped) {
				escaped = false;
			} else if (character === '\\') {
				escaped = true;
			} else if (character === stringDelimiter) {
				stringDelimiter = null;
			}
			continue;
		}
		if (character === '\'' || character === '"' || character === '`') {
			stringDelimiter = character;
			continue;
		}
		if (character === '{') depth += 1;
		if (character === '}') depth -= 1;
		if (depth === 0) return source.slice(declarationStart, index + 1);
	}
	throw new Error(`Could not balance function body for ${functionName}`);
}

function createMergeParamsHarness() {
	const sharedSource = fs.readFileSync(sharedSourcePath, 'utf8');
	const source = [
		extractFunctionDeclaration(sharedSource, 'setOwnEnumerableDataProperty'),
		extractFunctionDeclaration(sharedSource, 'mergeParams'),
		'globalThis.__mergeParams = mergeParams;'
	].join('\n');
	const context = vm.createContext({});
	new vm.Script(source, {
		filename: sharedSourcePath
	}).runInContext(context);
	return context.__mergeParams;
}

function ownUnknownPrototypeKeys() {
	return JSON.parse('{"__proto__":{"source":"custom"},"constructor":"custom-constructor"}');
}

function assertOwnEnumerableDataProperty(object, key, expectedValue) {
	const descriptor = Object.getOwnPropertyDescriptor(object, key);
	assert.ok(descriptor, `${key} should be an own property`);
	assert.equal(descriptor.enumerable, true, `${key} should be enumerable`);
	assert.equal(Object.hasOwn(descriptor, 'value'), true, `${key} should be a data property`);
	assert.deepEqual(descriptor.value, expectedValue, `${key} should retain its original value`);
}

for (const [style, getTarget] of Object.entries({
	gemini(body) {
		return body.generationConfig;
	},
	responses(body) {
		return body;
	}
})) {
	test(`mergeParams retains own unknown prototype keys in the ${style} request body`, () => {
		const mergeParams = createMergeParamsHarness();
		const body = {};
		mergeParams(body, ownUnknownPrototypeKeys(), style);
		const target = getTarget(body);
		assert.ok(target, `${style} should create its ordinary parameter body`);
		assertOwnEnumerableDataProperty(target, '__proto__', {
			source: 'custom'
		});
		assertOwnEnumerableDataProperty(target, 'constructor', 'custom-constructor');
		assert.deepEqual(Object.keys(target), ['__proto__', 'constructor']);
	});
}

test('Responses reasoning effort wins over a non-object reasoning value regardless of parameter order', () => {
	const mergeParams = createMergeParamsHarness();
	const paramsByOrder = [{
		reasoning_effort: 'high',
		reasoning: 'vendor-value'
	}, {
		reasoning: 'vendor-value',
		reasoning_effort: 'high'
	}];
	for (const params of paramsByOrder) {
		const body = {};
		mergeParams(body, params, 'responses');
		assert.deepEqual(JSON.parse(JSON.stringify(body)), {
			reasoning: {
				effort: 'high'
			}
		});
	}
});

test('Responses reasoning effort preserves ordinary reasoning fields regardless of parameter order', () => {
	const mergeParams = createMergeParamsHarness();
	const paramsByOrder = [{
		reasoning_effort: 'high',
		reasoning: {
			summary: 'auto'
		}
	}, {
		reasoning: {
			summary: 'auto'
		},
		reasoning_effort: 'high'
	}];
	for (const params of paramsByOrder) {
		const body = {};
		mergeParams(body, params, 'responses');
		assert.deepEqual(JSON.parse(JSON.stringify(body)), {
			reasoning: {
				summary: 'auto',
				effort: 'high'
			}
		});
	}
});

test('Responses reasoning effort leaves parameter reasoning untouched while cloning summary fields', () => {
	const mergeParams = createMergeParamsHarness();
	const params = {
		reasoning: {
			summary: 'auto'
		},
		reasoning_effort: 'high'
	};
	const body = {};
	mergeParams(body, params, 'responses');
	assert.equal(Object.hasOwn(params.reasoning, 'effort'), false);
	assert.notStrictEqual(body.reasoning, params.reasoning);
	assert.deepEqual(JSON.parse(JSON.stringify(body.reasoning)), {
		summary: 'auto',
		effort: 'high'
	});
});

test('Responses null or empty reasoning effort leaves custom reasoning unchanged', () => {
	const mergeParams = createMergeParamsHarness();
	for (const reasoningEffort of [null, '']) {
		const reasoning = {
			summary: 'vendor-value'
		};
		const body = {};
		mergeParams(body, {
			reasoning_effort: reasoningEffort,
			reasoning
		}, 'responses');
		assert.strictEqual(body.reasoning, reasoning);
		assert.equal(Object.hasOwn(body.reasoning, 'effort'), false);
	}
});

test('Responses reasoning effort retains own unknown prototype keys safely', () => {
	const mergeParams = createMergeParamsHarness();
	const params = ownUnknownPrototypeKeys();
	params.reasoning_effort = 'high';
	const body = {};
	mergeParams(body, params, 'responses');
	assertOwnEnumerableDataProperty(body, '__proto__', {
		source: 'custom'
	});
	assertOwnEnumerableDataProperty(body, 'constructor', 'custom-constructor');
	assert.deepEqual(JSON.parse(JSON.stringify(body.reasoning)), {
		effort: 'high'
	});
});
