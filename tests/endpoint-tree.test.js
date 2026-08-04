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

function createStoreHarness(initialTree) {
	let saveCount = 0;
	const context = vm.createContext({
		console,
		storage: {
			async saveEndpoints() {
				saveCount += 1;
			}
		}
	});
	const source = fs.readFileSync(storeSourcePath, 'utf8');
	const exposedSource = `${source}\n
globalThis.__storeTestApi = {
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
	assert.match(extractFunctionDeclaration(attachmentsSource.slice(attachmentsSource.indexOf('async function testConnection')), 'testConnection'), /isEndpointTestable\(/, 'testConnection must reuse isEndpointTestable');

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
	const testConnectionSource = extractFunctionDeclaration(attachmentsSource.slice(attachmentsSource.indexOf('async function testConnection')).replace('async function ', 'function '), 'testConnection');
	const testContext = vm.createContext({
		Date,
		FormData,
		connectionStatus: new Map(),
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
	new vm.Script(testConnectionSource.replace('function testConnection', 'async function testConnection') + '\nglobalThis.__testConnection = testConnection;').runInContext(testContext);
	for (const scenario of testCases) {
		await testContext.__testConnection(scenario.id);
		if (scenario.expectedStatus) {
			assert.equal(testContext.connectionStatus.get(scenario.id).status, scenario.expectedStatus, scenario.id + ' must not remain testing without a provider test function');
			assert.equal(uiUpdates.filter(nodeId => nodeId === scenario.id).length, scenario.expectedUiUpdates, scenario.id + ' must update its UI after the failed test');
		}
	}
	assert.deepEqual(calls, testCases.filter(scenario => scenario.expectedCall).map(scenario => scenario.expectedCall), 'only TTS and ASR use their explicit test functions; unsupported types must not fall back to chat');
});
