'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const endpointTreeSourcePath = path.join(__dirname, '..', 'src', 'modules', 'endpoint-tree.js');
const storeSourcePath = path.join(__dirname, '..', 'src', 'modules', 'store.js');

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
