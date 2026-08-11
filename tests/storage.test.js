'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const storageSourcePath = path.join(__dirname, '..', 'src', 'modules', 'storage-core.js');
const extensionStorageSourcePath = path.join(__dirname, '..', 'src', 'extension', 'storage-core.js');
const storeSourcePath = path.join(__dirname, '..', 'src', 'modules', 'store.js');

function createIndexedDBStub(options = {}) {
    const values = new Map();
    const database = {
        objectStoreNames: { contains() { return true; } },
        createObjectStore() {},
        transaction() {
            const transaction = {
                error: null,
                objectStore() {
                    return {
                        delete(key) { values.delete(key); },
                        get(key) {
                            const request = {};
                            queueMicrotask(() => {
                                request.result = values.get(key);
                                request.onsuccess?.();
                            });
                            return request;
                        },
                        put(value, key) {
                            const error = options.writeError?.(key, value);
                            if (error) transaction.error = error;
                            else values.set(key, value);
                        }
                    };
                }
            };
            queueMicrotask(() => {
                if (transaction.error) transaction.onerror?.();
                else transaction.oncomplete?.();
            });
            return transaction;
        }
    };
    return {
        open() {
            const request = {};
            queueMicrotask(() => {
                request.result = database;
                request.onupgradeneeded?.({ target: { result: database } });
                request.onsuccess?.();
            });
            return request;
        }
    };
}

function loadStorageHarness(overrides = {}) {
    const window = {
        __IS_EXTENSION__: false,
        showDirectoryPicker: overrides.showDirectoryPicker
    };
    const context = vm.createContext({
        console,
        DOMException,
        indexedDB: overrides.indexedDB || createIndexedDBStub(),
        showDirectoryPicker: overrides.showDirectoryPicker,
        structuredClone,
        window
    });
    const source = fs.readFileSync(storageSourcePath, 'utf8');
    const exposedSource = source.replace(
        /\r?\n[^\S\r\n]*} else \{\r?\n[^\S\r\n]*storage = window\.__STORAGE__;/,
        `\n\tglobalThis.__storageTestApi = {
        BrowserStorage,
        DirectoryStorage,
        storage,
        setDirectoryHandle(handle) { directoryHandle = handle; },
        getDirectoryHandle() { return directoryHandle; },
        setMode(mode) { currentMode = mode; },
        saveHandleToIndexedDB,
        loadHandleFromIndexedDB,
        clearHandleFromIndexedDB
    };
} else {
    storage = window.__STORAGE__;`
    );
    new vm.Script(exposedSource, { filename: storageSourcePath }).runInContext(context);
    return context.__storageTestApi;
}

function loadExtensionStorageHarness(overrides = {}) {
    const values = new Map();
    const chrome = {
        runtime: { id: 'test-extension' },
        storage: {
            local: {
                async get(key) {
                    if (key === null) return Object.fromEntries(values);
                    return { [key]: values.get(key) };
                },
                async remove(key) { values.delete(key); },
                async set(items) {
                    for (const [key, value] of Object.entries(items)) values.set(key, structuredClone(value));
                }
            }
        }
    };
    const window = { showDirectoryPicker: overrides.showDirectoryPicker };
    const context = vm.createContext({
        chrome,
        console,
        DOMException,
        indexedDB: overrides.indexedDB || createIndexedDBStub(),
        showDirectoryPicker: overrides.showDirectoryPicker,
        structuredClone,
        window
    });
    const source = fs.readFileSync(extensionStorageSourcePath, 'utf8');
    const exposedSource = source.replace(
        '\n\t// 也暴露环境检测',
        `\n\tglobalThis.__extensionStorageTestApi = {
        BrowserStorage,
        DirectoryStorage,
        storage,
        setDirectoryHandle(handle) { directoryHandle = handle; },
        getDirectoryHandle() { return directoryHandle; },
        setMode(mode) { currentMode = mode; },
        saveHandleToIndexedDB,
        loadHandleFromIndexedDB,
        clearHandleFromIndexedDB
    };

    // 也暴露环境检测`
    );
    new vm.Script(exposedSource, { filename: extensionStorageSourcePath }).runInContext(context);
    return { ...context.__extensionStorageTestApi, values };
}

function createStoreHarness(options = {}) {
    let loadEndpointsCalls = 0;
    let saveEndpointsCalls = 0;
    const consoleErrors = [];
    const testConsole = {
        error(...args) { consoleErrors.push(args); },
        info: console.info,
        log: console.log,
        warn: console.warn
    };
    const context = vm.createContext({
        alert() {},
        console: testConsole,

        ...(options.omitSelectedEndpoints ? {} : {
            selectedEndpoints: []
        }),

        saveDefaultSelectedEndpoints(endpoints) {
            if (options.saveDefaultSelectedEndpoints)
                return options.saveDefaultSelectedEndpoints(endpoints);

            if (options.saveDefaultSelectedEndpointsError)
                throw options.saveDefaultSelectedEndpointsError;
        },

        storage: {
            mode: "browser",

            getDirectoryName() {
                return null;
            },

            async deleteSession(id) {
                if (options.deleteSession)
                    return options.deleteSession(id);

                if (options.deleteSessionError)
                    throw options.deleteSessionError;
            },

            async clearAll() {
                if (options.clearAll)
                    return options.clearAll();

                if (options.clearAllError)
                    throw options.clearAllError;
            },

            async loadEndpoints() {
                loadEndpointsCalls += 1;
                if (options.loadEndpoints)
                    return options.loadEndpoints();

                return options.loadedEndpoints;
            },

            async saveEndpoints(data) {
                saveEndpointsCalls += 1;
                if (options.saveEndpoints)
                    return options.saveEndpoints(data);

                if (options.saveEndpointsError)
                    throw options.saveEndpointsError;
            },

            async saveSession(session) {
                if (options.saveSession)
                    return options.saveSession(session);

                if (options.saveSessionError)
                    throw options.saveSessionError;
            }
        },

        structuredClone
    });

    const source = fs.readFileSync(storeSourcePath, "utf8");

    const exposedSource = `${source}\n
globalThis.__storeTestApi = {
    addMessage,
    addNode,
    batchAddNodes,
    cloneNode,
    clearDirectory,
    createSession,
    deleteNode,
    deleteSession,
    getAllSessions,
    getEndpointsData() { return endpointsData; },
    loadEndpoints,
    getGroups,
    getNode,
    getSelectedEndpoints() { return selectedEndpoints; },
    getSession,
    migrateSession,
    moveNodeAsChild,
    reorderNode,
    seedEndpoints(data) { endpointsData = data; },
    seedSelectedEndpoints(ids) { selectedEndpoints = ids; },
    seedSession(session) { sessionsCache.set(session.id, session); },
    updateNode,
    updateSession
};`;

    new vm.Script(exposedSource, {
        filename: storeSourcePath
    }).runInContext(context);

    return {
        api: context.__storeTestApi,
        getLoadEndpointsCalls() { return loadEndpointsCalls; },
        getSaveEndpointsCalls() { return saveEndpointsCalls; },
        getConsoleErrors() { return consoleErrors; }
    };
}

test('loadEndpoints normalizes legacy full URL fields and saves exactly once', async () => {
    const harness = createStoreHarness({
        loadedEndpoints: {
            nodes: [{ id: 'legacy', directUrl: true, children: [] }]
        }
    });

    const loaded = await harness.api.loadEndpoints();

    assert.equal(loaded.nodes[0].isFullUrl, true);
    assert.equal(Object.hasOwn(loaded.nodes[0], 'directUrl'), false);
    assert.equal(harness.getLoadEndpointsCalls(), 1);
    assert.equal(harness.getSaveEndpointsCalls(), 1);
});

test('loadEndpoints normalizes without saving endpoint data when no legacy full URL fields exist', async () => {
    const harness = createStoreHarness({
        loadedEndpoints: {
            nodes: [{ id: 'inherited', children: [] }]
        }
    });

    const loaded = await harness.api.loadEndpoints();

    assert.equal(Object.hasOwn(loaded.nodes[0], 'isFullUrl'), false);
    assert.equal(harness.getSaveEndpointsCalls(), 0);
});

test('loadEndpoints keeps normalized data available when migration save fails', async () => {
    const harness = createStoreHarness({
        loadedEndpoints: {
            nodes: [{ id: 'legacy', directUrl: false, children: [] }]
        },
        saveEndpointsError: new Error('migration save failed')
    });

    const loaded = await harness.api.loadEndpoints();

    assert.equal(loaded.nodes[0].isFullUrl, false);
    assert.equal(Object.hasOwn(loaded.nodes[0], 'directUrl'), false);
    assert.equal(harness.getSaveEndpointsCalls(), 1);
    assert.equal(harness.getConsoleErrors().length, 1);
    assert.match(harness.getConsoleErrors()[0][0], /保存端点字段迁移失败/);
});

test('disconnectDirectory releases the handle without deleting directory data', async () => {
    const calls = [];
    const harness = loadStorageHarness();
    harness.setDirectoryHandle({
        name: 'workspace',
        removeEntry(name) { calls.push(name); }
    });
    harness.setMode('directory');
    harness.DirectoryStorage.release = async () => {
        harness.setDirectoryHandle(null);
    };
    harness.BrowserStorage._delete = async () => {};

    await harness.storage.disconnectDirectory();

    assert.deepEqual(calls, []);
    assert.equal(harness.storage.mode, null);
});

test('activateRestoredDirectory changes the storage-owned mode', async () => {
    const harness = loadStorageHarness();
    harness.DirectoryStorage.restoreHandle = async () => true;
    harness.BrowserStorage._set = async () => {};
    harness.setMode('browser');

    assert.equal(await harness.storage.activateRestoredDirectory(), true);
    assert.equal(harness.storage.mode, 'directory');
});

for (const loadHarness of [loadStorageHarness, loadExtensionStorageHarness]) {
    const implementation = loadHarness === loadStorageHarness ? 'standard' : 'extension';

    test(`${implementation} disconnectDirectory restores handle and mode when preference clearing fails`, async () => {
        const harness = loadHarness();
        const handle = { name: 'workspace' };
        await harness.DirectoryStorage._setHandle(handle);
        harness.setMode('directory');
        harness.storage._clearModePref = async () => { throw new Error('pref clear failed'); };
        await assert.rejects(harness.storage.disconnectDirectory(), /pref clear failed/);
        assert.equal(harness.storage.mode, 'directory');
        assert.equal(harness.getDirectoryHandle(), handle);
        assert.equal(await harness.loadHandleFromIndexedDB(), handle);
    });

    test(`${implementation} activateRestoredDirectory restores the previous handle when preference saving fails`, async () => {
        const harness = loadHarness();
        const previousHandle = { name: 'previous' };
        const restoredHandle = { name: 'restored' };
        await harness.DirectoryStorage._setHandle(previousHandle);
        harness.setMode('browser');
        harness.DirectoryStorage.restoreHandle = async () => {
            await harness.DirectoryStorage._setHandle(restoredHandle);
            return true;
        };
        let saveAttempts = 0;
        const originalSaveModePref = harness.storage._saveModePref.bind(harness.storage);
        harness.storage._saveModePref = async () => {
            if (saveAttempts++ === 0) throw new Error('pref save failed');
            return originalSaveModePref();
        };
        await assert.rejects(harness.storage.activateRestoredDirectory(), /pref save failed/);
        assert.equal(harness.storage.mode, 'browser');
        assert.equal(harness.getDirectoryHandle(), previousHandle);
        assert.equal(await harness.loadHandleFromIndexedDB(), previousHandle);
    });

    test(`${implementation} activateRestoredDirectory keeps a persisted handle when no handle was active`, async () => {
        const harness = loadHarness();
        const restoredHandle = { name: 'restored' };
        await harness.saveHandleToIndexedDB(restoredHandle);
        harness.setDirectoryHandle(null);
        harness.setMode('browser');
        harness.DirectoryStorage.restoreHandle = async () => {
            harness.setDirectoryHandle(restoredHandle);
            return true;
        };
        let saveAttempts = 0;
        const originalSaveModePref = harness.storage._saveModePref.bind(harness.storage);
        harness.storage._saveModePref = async () => {
            if (saveAttempts++ === 0) throw new Error('pref save failed');
            return originalSaveModePref();
        };
        await assert.rejects(harness.storage.activateRestoredDirectory(), /pref save failed/);
        assert.equal(harness.getDirectoryHandle(), null);
        assert.equal(await harness.loadHandleFromIndexedDB(), restoredHandle);
    });
}

for (const loadHarness of [loadStorageHarness, loadExtensionStorageHarness]) {
    const implementation = loadHarness === loadStorageHarness ? 'standard' : 'extension';

    test(`${implementation} Task 1C serializes switchMode after a failed activateRestoredDirectory`, async () => {
        const harness = loadHarness();
        const restoredHandle = { name: 'restored' };
        const targetDirectory = createMemoryDirectory();
        installBrowserMap(harness.BrowserStorage);
        const saveStarted = deferred();
        const allowFirstSaveToFail = deferred();
        harness.setMode('browser');
        harness.DirectoryStorage.restoreHandle = async () => {
            await harness.DirectoryStorage._setHandle(restoredHandle);
            return true;
        };
        const originalSaveModePref = harness.storage._saveModePref.bind(harness.storage);
        let saveAttempts = 0;
        harness.storage._saveModePref = async () => {
            if (saveAttempts++ === 0) {
                saveStarted.resolve();
                await allowFirstSaveToFail.promise;
                throw new Error('first preference save failed');
            }
            return originalSaveModePref();
        };

        const activating = harness.storage.activateRestoredDirectory();
        await saveStarted.promise;
        const switching = harness.storage.switchMode('directory', targetDirectory.handle);
        allowFirstSaveToFail.resolve();

        await assert.rejects(activating, /first preference save failed/);
        assert.equal(await switching, true);
        assert.equal(harness.storage.mode, 'directory');
        assert.equal(harness.getDirectoryHandle(), targetDirectory.handle);
        assert.equal(await harness.loadHandleFromIndexedDB(), targetDirectory.handle);
        const modePref = loadHarness === loadStorageHarness
            ? await harness.BrowserStorage._get('__mode')
            : harness.values.get('__mode');
        assert.equal(modePref, 'directory');
    });

    test(`${implementation} Task 1C serializes switchMode after disconnectDirectory`, async () => {
        const harness = loadHarness();
        const directoryHandle = { name: 'workspace' };
        const clearStarted = deferred();
        const allowClear = deferred();
        installBrowserMap(harness.BrowserStorage);
        let switchStarted = false;
        const originalExportAllNow = harness.BrowserStorage.exportAll.bind(harness.BrowserStorage);
        harness.BrowserStorage.exportAll = async () => {
            switchStarted = true;
            return originalExportAllNow();
        };
        await harness.DirectoryStorage._setHandle(directoryHandle);
        harness.setMode('directory');
        await harness.storage._saveModePref();
        const originalClearModePref = harness.storage._clearModePref.bind(harness.storage);
        harness.storage._clearModePref = async () => {
            clearStarted.resolve();
            await allowClear.promise;
            return originalClearModePref();
        };

        const disconnecting = harness.storage.disconnectDirectory();
        await clearStarted.promise;
        const switching = harness.storage.switchMode('browser');
        await Promise.resolve();
        assert.equal(switchStarted, false);
        allowClear.resolve();

        await Promise.all([disconnecting, switching]);
        assert.equal(harness.storage.mode, 'browser');
        const modePref = loadHarness === loadStorageHarness
            ? await harness.BrowserStorage._get('__mode')
            : harness.values.get('__mode');
        assert.equal(modePref, 'browser');
        assert.equal(harness.getDirectoryHandle(), null);
        assert.equal(await harness.loadHandleFromIndexedDB(), undefined);
    });

    test(`${implementation} Task 1C selectMode restores browser state after saving directory preference fails`, async () => {
        const harness = loadHarness();
        const previousHandle = { name: 'previous' };
        const targetHandle = { name: 'target' };
        await harness.DirectoryStorage._setHandle(previousHandle);
        harness.setMode('browser');
        await harness.storage._saveModePref();
        const originalSaveModePref = harness.storage._saveModePref.bind(harness.storage);
        let saveAttempts = 0;
        harness.storage._saveModePref = async () => {
            if (saveAttempts++ === 0) throw new Error('directory preference save failed');
            return originalSaveModePref();
        };

        await assert.rejects(harness.storage.selectMode('directory', targetHandle), /directory preference save failed/);
        assert.equal(harness.storage.mode, 'browser');
        assert.equal(harness.getDirectoryHandle(), previousHandle);
        assert.equal(await harness.loadHandleFromIndexedDB(), previousHandle);
        assert.equal(await harness.BrowserStorage._get('__mode'), 'browser');
    });

    test(`${implementation} Task 1C switchMode restores the previous handle when explicit handle persistence fails`, async () => {
        const persistenceError = new Error('directory handle save failed');
        const harness = loadHarness({
            indexedDB: createIndexedDBStub({
                writeError(key, value) { return key === 'directory' && value.name === 'target' ? persistenceError : null; }
            })
        });
        const previousHandle = { name: 'previous' };
        const targetHandle = { name: 'target' };
        await harness.DirectoryStorage._setHandle(previousHandle);
        harness.setMode('browser');
        installBrowserMap(harness.BrowserStorage, [['__mode', 'browser']]);

        await assert.rejects(harness.storage.switchMode('directory', targetHandle), /directory handle save failed/);
        assert.equal(harness.storage.mode, 'browser');
        assert.equal(harness.getDirectoryHandle(), previousHandle);
        assert.equal(await harness.loadHandleFromIndexedDB(), previousHandle);
        const modePref = loadHarness === loadStorageHarness
            ? await harness.BrowserStorage._get('__mode')
            : harness.values.get('__mode');
        assert.equal(modePref, 'browser');
    });

    for (const method of ['selectMode', 'switchMode']) {
        test(`${implementation} Task 1C endpoint ${method} preserves a persisted inactive handle after explicit handle persistence fails`, async () => {
            const persistedHandle = { name: 'persisted' };
            const targetHandle = { name: 'target' };
            const persistenceError = new Error('target handle save failed');
            const harness = loadHarness({
                indexedDB: createIndexedDBStub({
                    writeError(key, value) { return key === 'directory' && value === targetHandle ? persistenceError : null; }
                })
            });
            await harness.saveHandleToIndexedDB(persistedHandle);
            harness.setDirectoryHandle(null);
            harness.setMode('browser');
            installBrowserMap(harness.BrowserStorage, [['__mode', 'browser']]);

            await assert.rejects(harness.storage[method]('directory', targetHandle), /target handle save failed/);
            assert.equal(harness.storage.mode, 'browser');
            assert.equal(harness.getDirectoryHandle(), null);
            assert.equal(await harness.loadHandleFromIndexedDB(), persistedHandle);
            const modePref = loadHarness === loadStorageHarness
                ? await harness.BrowserStorage._get('__mode')
                : harness.values.get('__mode');
            assert.equal(modePref, 'browser');
        });

        test(`${implementation} Task 1C endpoint ${method} restores state when picked handle persistence fails`, async () => {
            const oldHandle = { name: 'old' };
            const pickedHandle = { name: 'picked' };
            const persistenceError = new Error('picked handle save failed');
            const harness = loadHarness({
                indexedDB: createIndexedDBStub({
                    writeError(key, value) { return key === 'directory' && value === pickedHandle ? persistenceError : null; }
                }),
                showDirectoryPicker: async () => pickedHandle
            });
            await harness.DirectoryStorage._setHandle(oldHandle);
            harness.setMode('browser');
            installBrowserMap(harness.BrowserStorage, [['__mode', 'browser']]);

            await assert.rejects(harness.storage[method]('directory'), /picked handle save failed/);
            assert.equal(harness.storage.mode, 'browser');
            assert.equal(harness.getDirectoryHandle(), oldHandle);
            assert.equal(await harness.loadHandleFromIndexedDB(), oldHandle);
            const modePref = loadHarness === loadStorageHarness
                ? await harness.BrowserStorage._get('__mode')
                : harness.values.get('__mode');
            assert.equal(modePref, 'browser');
        });
    }

    test(`${implementation} Task 1C selectMode returns false without state changes when picker is aborted`, async () => {
        const oldHandle = { name: 'old' };
        const harness = loadHarness({
            showDirectoryPicker: async () => { throw new DOMException('cancelled', 'AbortError'); }
        });
        await harness.DirectoryStorage._setHandle(oldHandle);
        harness.setMode('browser');
        await harness.storage._saveModePref();

        assert.equal(await harness.storage.selectMode('directory'), false);
        assert.equal(harness.storage.mode, 'browser');
        assert.equal(harness.getDirectoryHandle(), oldHandle);
        assert.equal(await harness.loadHandleFromIndexedDB(), oldHandle);
    });

    test(`${implementation} storage serializes an already-started save before switching modes`, async () => {
        const harness = loadHarness();
        const directory = createMemoryDirectory();
        const saveStarted = deferred();
        const allowSave = deferred();
        installBrowserMap(harness.BrowserStorage);
        const originalSet = harness.BrowserStorage._set;
        harness.BrowserStorage._set = async (key, value) => {
            if (key === 'session:S') {
                saveStarted.resolve();
                await allowSave.promise;
            }
            return originalSet(key, value);
        };
        harness.setMode('browser');

        const saving = harness.storage.saveSession({ id: 'S', title: 'latest' });
        await saveStarted.promise;
        const switching = harness.storage.switchMode('directory', directory.handle);
        allowSave.resolve();

        await Promise.all([saving, switching]);
        assert.equal(JSON.parse(directory.files.get('sessions/S.json')).title, 'latest');
    });

    test(`${implementation} storage saves a session started during a mode switch to the target directory`, async () => {
        const harness = loadHarness();
        const directory = createMemoryDirectory();
        const exportStarted = deferred();
        const allowExport = deferred();
        const browserValues = installBrowserMap(harness.BrowserStorage);
        const originalExportAll = harness.BrowserStorage._exportAllNow.bind(harness.BrowserStorage);
        harness.BrowserStorage._exportAllNow = async () => {
            exportStarted.resolve();
            await allowExport.promise;
            return originalExportAll();
        };
        harness.setMode('browser');

        const switching = harness.storage.switchMode('directory', directory.handle);
        await exportStarted.promise;
        const saving = harness.storage.saveSession({ id: 'later', title: 'new target' });
        allowExport.resolve();

        await Promise.all([switching, saving]);
        assert.equal(JSON.parse(directory.files.get('sessions/later.json')).title, 'new target');
        assert.equal(browserValues.has('session:later'), false);
    });
}

function installDirectoryHandle(harness, method, error) {
    harness.setDirectoryHandle({
        async getFileHandle() {
            if (method === 'saveEndpoints') throw error;
        },
        async getDirectoryHandle() {
            return {
                async getFileHandle() {
                    if (method === 'saveSession') throw error;
                },
                async removeEntry() {
                    if (method === 'deleteSession') throw error;
                }
            };
        }
    });
}

for (const loadHarness of [loadStorageHarness, loadExtensionStorageHarness]) {
    const implementation = loadHarness === loadStorageHarness ? 'standard' : 'extension';
    for (const method of ['saveEndpoints', 'saveSession', 'deleteSession']) {
        test(`${implementation} directory ${method} save failures reject instead of resolving false`, async () => {
            const harness = loadHarness();
            const error = new DOMException('permission revoked', 'NotAllowedError');
            installDirectoryHandle(harness, method, error);
            const argument = method === 'saveEndpoints'
                ? { nodes: [] }
                : method === 'saveSession' ? { id: 'S' } : 'S';

            await assert.rejects(
                harness.DirectoryStorage[method](argument),
                caught => caught.name === 'NotAllowedError'
            );
        });
    }
}


// Task 1B: the Store is the only boundary that may mutate a cached session before persistence.
test('Task 1B updateSession restores a failed title and keeps the queued title update', async () => {
    const firstSave = deferred();
    let saves = 0;
    const harness = createStoreHarness({
        async saveSession() {
            saves++;
            if (saves === 1) return firstSave.promise;
        }
    });
    const session = { id: 'S', title: 'old', messages: [] };
    harness.api.seedSession(session);

    const failed = harness.api.updateSession('S', current => { current.title = 'failed'; });
    const saved = harness.api.updateSession('S', current => {
        assert.equal(current.title, 'old');
        current.title = 'saved';
    });
    firstSave.reject(new Error('title save failed'));

    await assert.rejects(failed, /title save failed/);
    await saved;
    assert.equal(session.title, 'saved');
});

test('Task 1B updateSession restores modelParams on the cached session object after failure', async () => {
    const session = { id: 'S', messages: [], modelParams: { endpoint: { temperature: 0.2 } } };
    const harness = createStoreHarness({ saveSessionError: new Error('parameter save failed') });
    harness.api.seedSession(session);

    await assert.rejects(harness.api.updateSession('S', current => {
        current.modelParams.endpoint.temperature = 0.9;
    }), /parameter save failed/);
    assert.equal(harness.api.getSession('S'), session);
    assert.deepEqual(session.modelParams, { endpoint: { temperature: 0.2 } });
});

test('Task 1B migrateSession rejects and restores the same legacy session after persistence failure', async () => {
    const session = {
        id: 'S',
        messages: [{ role: 'assistant', timestamp: 1, responses: [{ modelId: 'M', text: 'answer' }] }]
    };
    const before = structuredClone(session);
    const harness = createStoreHarness({ saveSessionError: new Error('migration save failed') });

    await assert.rejects(harness.api.migrateSession(session), /migration save failed/);
    assert.deepEqual(session, before);
});

test('Task 1B migrateSession waits for an in-progress same-session migration and shares its failure', async () => {
    const saveStarted = deferred();
    const allowSaveToFail = deferred();
    const migrationError = new Error('migration save failed');
    const session = {
        id: 'S',
        messages: [{ role: 'assistant', timestamp: 1, responses: [{ modelId: 'M', text: 'answer' }] }]
    };
    const harness = createStoreHarness({
        async saveSession() {
            saveStarted.resolve();
            await allowSaveToFail.promise;
            throw migrationError;
        }
    });

    const firstMigration = harness.api.migrateSession(session);
    await saveStarted.promise;
    const secondMigration = harness.api.migrateSession(session);
    let secondMigrationSettled = false;
    secondMigration.then(
        () => { secondMigrationSettled = true; },
        () => { secondMigrationSettled = true; }
    );
    await Promise.resolve();
    assert.equal(secondMigrationSettled, false);

    allowSaveToFail.resolve();
    await assert.rejects(firstMigration, error => error === migrationError);
    await assert.rejects(secondMigration, error => error === migrationError);
});

test('Task 1B migrateSession independently persists distinct same-id legacy objects', async () => {
    const firstSaveStarted = deferred();
    const allowFirstSave = deferred();
    const payloads = [];
    const firstSession = {
        id: 'S',
        messages: [{ role: 'assistant', timestamp: 1, responses: [{ modelId: 'M1', text: 'first' }] }]
    };
    const secondSession = {
        id: 'S',
        messages: [{ role: 'assistant', timestamp: 2, responses: [{ modelId: 'M2', text: 'second' }] }]
    };
    const harness = createStoreHarness({
        async saveSession(session) {
            payloads.push(structuredClone(session));
            if (payloads.length === 1) {
                firstSaveStarted.resolve();
                await allowFirstSave.promise;
            }
        }
    });

    const firstMigration = harness.api.migrateSession(firstSession);
    await firstSaveStarted.promise;
    const secondMigration = harness.api.migrateSession(secondSession);
    allowFirstSave.resolve();
    await Promise.all([firstMigration, secondMigration]);

    assert.equal(payloads.length, 2);
    assert.equal(payloads[1].messages[0].responses, undefined);
    assert.equal(payloads[1].messages[0].endpointId, 'M2');
    assert.equal(secondSession.messages[0].responses, undefined);
});

test('Task 1B createSession does not cache a session whose first save fails', async () => {
    const harness = createStoreHarness({ saveSessionError: new Error('first save failed') });

    await assert.rejects(harness.api.createSession('hello'), /first save failed/);
    assert.equal(harness.api.getAllSessions().length, 0);
});

test('Task 1B createSession includes initial modelParams in its first persistence payload', async () => {
    const payloads = [];
    const harness = createStoreHarness({
        async saveSession(session) { payloads.push(structuredClone(session)); }
    });
    const modelParams = { endpoint: { temperature: 0.7 } };

    await harness.api.createSession('hello', ['endpoint'], modelParams);
    assert.deepEqual(payloads[0].modelParams, modelParams);
});

for (const loadHarness of [loadStorageHarness, loadExtensionStorageHarness]) {
    const implementation = loadHarness === loadStorageHarness ? 'standard' : 'extension';

    test(`${implementation} directory deleteSession treats NotFoundError as success`, async () => {
        const harness = loadHarness();
        installDirectoryHandle(harness, 'deleteSession', new DOMException('missing', 'NotFoundError'));
        await harness.DirectoryStorage.deleteSession('missing');
    });

    for (const phase of ['write', 'close']) {
        test(`${implementation} directory writer ${phase} failure aborts and preserves the original error`, async () => {
            const harness = loadHarness();
            const expected = new Error(`${phase} failed`);
            let abortCalls = 0;
            harness.setDirectoryHandle({
                async getFileHandle() {
                    return {
                        async createWritable() {
                            return {
                                async write() { if (phase === 'write') throw expected; },
                                async close() { if (phase === 'close') throw expected; },
                                async abort() { abortCalls++; throw new Error('abort failed'); }
                            };
                        }
                    };
                }
            });

            await assert.rejects(harness.DirectoryStorage.saveEndpoints({ nodes: [] }), error => error === expected);
            assert.equal(abortCalls, 1);
        });
    }

    test(`${implementation} failed legacy migration remains retryable`, async () => {
        const harness = loadHarness();
        const values = installBrowserMap(harness.BrowserStorage, [[
            'sessions',
            { A: { id: 'A', title: 'legacy' } }
        ]]);
        let shouldFail = true;
        const originalSet = harness.BrowserStorage._set;
        harness.BrowserStorage._set = async (key, value) => {
            if (key === 'session:A' && shouldFail) {
                shouldFail = false;
                throw new Error('write failed');
            }
            await originalSet(key, value);
        };

        await assert.rejects(harness.BrowserStorage.loadSessions(), /write failed/);
        assert.equal(values.has('sessions'), true);
        const sessions = await harness.BrowserStorage.loadSessions();
        assert.equal(sessions[0].title, 'legacy');
        assert.equal(values.has('sessions'), false);
    });

    test(`${implementation} legacy migration cannot overwrite a same-id save`, async () => {
        const harness = loadHarness();
        const values = installBrowserMap(harness.BrowserStorage, [[
            'sessions',
            { A: { id: 'A', title: 'legacy' } }
        ]]);
        const readStarted = deferred();
        const allowRead = deferred();
        const originalGet = harness.BrowserStorage._get;
        harness.BrowserStorage._get = async key => {
            if (key !== 'session:A') return originalGet(key);
            const valueAtRead = await originalGet(key);
            readStarted.resolve();
            await allowRead.promise;
            return valueAtRead;
        };

        const migrating = harness.BrowserStorage.loadSessions();
        await readStarted.promise;
        const saving = harness.BrowserStorage.saveSession({ id: 'A', title: 'new' });
        allowRead.resolve();
        await Promise.all([migrating, saving]);
        assert.equal(values.get('session:A').title, 'new');
    });

    test(`${implementation} migration re-reads the target before writing legacy data`, async () => {
        const harness = loadHarness();
        const values = installBrowserMap(harness.BrowserStorage, [[
            'sessions',
            { A: { id: 'A', title: 'legacy' } }
        ]]);
        let reads = 0;
        const originalGet = harness.BrowserStorage._get;
        harness.BrowserStorage._get = async key => {
            if (key === 'session:A' && ++reads === 1) {
                values.set(key, { id: 'A', title: 'other context' });
                return undefined;
            }
            return originalGet(key);
        };

        await harness.BrowserStorage.loadSessions();
        assert.equal(values.get('session:A').title, 'other context');
        assert.ok(reads >= 2);
    });

    test(`${implementation} BrowserStorage import replaces stale sessions for array and map snapshots`, async () => {
        const harness = loadHarness();
        const values = installBrowserMap(harness.BrowserStorage, [
            ['session:stale', { id: 'stale' }],
            ['session:A', { id: 'A', title: 'old' }]
        ]);
        await harness.BrowserStorage.importAll({ sessions: [{ id: 'A', title: 'array' }] });
        assert.equal(values.has('session:stale'), false);
        assert.equal(values.get('session:A').title, 'array');
        await harness.BrowserStorage.importAll({ sessions: { B: { id: 'B', title: 'map' } } });
        assert.equal(values.has('session:A'), false);
        assert.equal(values.get('session:B').title, 'map');
    });

    test(`${implementation} DirectoryStorage import removes stale session files`, async () => {
        const harness = loadHarness();
        const directory = createMemoryDirectory({
            'endpoints.json': JSON.stringify({ nodes: [{ id: 'old' }] }),
            'sessions/stale.json': JSON.stringify({ id: 'stale' }),
            'sessions/A.json': JSON.stringify({ id: 'A', title: 'old' })
        });
        harness.setDirectoryHandle(directory.handle);
        await harness.DirectoryStorage.importAll({
            endpoints: { nodes: [{ id: 'new' }] },
            sessions: { A: { id: 'A', title: 'new' } }
        });
        assert.equal(directory.files.has('sessions/stale.json'), false);
        assert.equal(JSON.parse(directory.files.get('sessions/A.json')).title, 'new');
    });

    test(`${implementation} BrowserStorage import restores its snapshot after a partial failure`, async () => {
        const harness = loadHarness();
        const values = installBrowserMap(harness.BrowserStorage, [
            ['endpoints', { nodes: [{ id: 'old' }] }],
            ['session:old', { id: 'old' }]
        ]);
        const originalSet = harness.BrowserStorage._set;
        let shouldFail = true;
        harness.BrowserStorage._set = async (key, value) => {
            if (key === 'session:new' && shouldFail) {
                shouldFail = false;
                throw new Error('partial import');
            }
            return originalSet(key, value);
        };
        await assert.rejects(harness.BrowserStorage.importAll({
            endpoints: { nodes: [{ id: 'new' }] },
            sessions: [{ id: 'new' }]
        }), /partial import/);
        assert.deepEqual(values.get('endpoints'), { nodes: [{ id: 'old' }] });
        assert.equal(values.has('session:new'), false);
        assert.equal(values.has('session:old'), true);
    });

    test(`${implementation} DirectoryStorage import restores its snapshot after a partial failure`, async () => {
        const harness = loadHarness();
        const directory = createMemoryDirectory({
            'endpoints.json': JSON.stringify({ nodes: [{ id: 'old' }] }),
            'sessions/old.json': JSON.stringify({ id: 'old' })
        });
        harness.setDirectoryHandle(directory.handle);
        const originalSaveSession = harness.DirectoryStorage._saveSessionNow;
        let shouldFail = true;
        harness.DirectoryStorage._saveSessionNow = async session => {
            if (shouldFail) {
                shouldFail = false;
                throw new Error('partial import');
            }
            return originalSaveSession.call(harness.DirectoryStorage, session);
        };
        await assert.rejects(harness.DirectoryStorage.importAll({
            endpoints: { nodes: [{ id: 'new' }] },
            sessions: [{ id: 'new' }]
        }), /partial import/);
        assert.deepEqual(JSON.parse(directory.files.get('endpoints.json')), { nodes: [{ id: 'old' }] });
        assert.equal(directory.files.has('sessions/new.json'), false);
        assert.equal(directory.files.has('sessions/old.json'), true);
    });

    test(`${implementation} Task 1B DirectoryStorage import preserves broken session bytes after failure`, async () => {
        const harness = loadHarness();
        const brokenSession = '{broken session bytes';
        const directory = createMemoryDirectory({
            'endpoints.json': JSON.stringify({ nodes: [{ id: 'old' }] }),
            'sessions/broken.json': brokenSession
        });
        harness.setDirectoryHandle(directory.handle);
        const originalSaveSession = harness.DirectoryStorage._saveSessionNow;
        let shouldFail = true;
        harness.DirectoryStorage._saveSessionNow = async session => {
            await originalSaveSession.call(harness.DirectoryStorage, session);
            if (shouldFail) {
                shouldFail = false;
                throw new Error('main import failed');
            }
        };

        await assert.rejects(harness.DirectoryStorage.importAll({
            endpoints: { nodes: [{ id: 'new' }] },
            sessions: [{ id: 'new' }]
        }), /main import failed/);
        assert.equal(directory.files.get('sessions/broken.json'), brokenSession);
    });

    test(`${implementation} Task 1B DirectoryStorage import preserves broken endpoints bytes after failure`, async () => {
        const harness = loadHarness();
        const brokenEndpoints = '{broken endpoints bytes';
        const directory = createMemoryDirectory({
            'endpoints.json': brokenEndpoints,
            'sessions/old.json': JSON.stringify({ id: 'old' })
        });
        harness.setDirectoryHandle(directory.handle);
        const originalSaveSession = harness.DirectoryStorage._saveSessionNow;
        let shouldFail = true;
        harness.DirectoryStorage._saveSessionNow = async session => {
            if (shouldFail) {
                shouldFail = false;
                throw new Error('main import failed');
            }
            return originalSaveSession.call(harness.DirectoryStorage, session);
        };

        await assert.rejects(harness.DirectoryStorage.importAll({
            endpoints: { nodes: [{ id: 'new' }] },
            sessions: [{ id: 'new' }]
        }), /main import failed/);
        assert.equal(directory.files.get('endpoints.json'), brokenEndpoints);
    });

    test(`${implementation} Task 1B DirectoryStorage rejects checkpoint read errors before writing`, async () => {
        const harness = loadHarness();
        const checkpointError = new Error('checkpoint read failed');
        const directory = createMemoryDirectory({
            'endpoints.json': JSON.stringify({ nodes: [{ id: 'old' }] })
        }, {
            readError(key) {
                return key === 'endpoints.json' ? checkpointError : null;
            }
        });
        harness.setDirectoryHandle(directory.handle);

        await assert.rejects(harness.DirectoryStorage.importAll({
            endpoints: { nodes: [{ id: 'new' }] },
            sessions: [{ id: 'new' }]
        }), error => error === checkpointError);
        assert.deepEqual(directory.writeAttempts, []);
    });

    test(`${implementation} Task 1B DirectoryStorage import retains main and raw rollback failures`, async () => {
        const harness = loadHarness();
        const mainError = new Error('main import failed');
        const rollbackError = new Error('raw rollback failed');
        const originalEndpoints = JSON.stringify({ nodes: [{ id: 'old' }] });
        const directory = createMemoryDirectory({
            'endpoints.json': originalEndpoints,
            'sessions/old.json': JSON.stringify({ id: 'old' })
        }, {
            writeError(key, value) {
                if (
                    key === 'endpoints.json'
                    && Object.prototype.toString.call(value) === '[object ArrayBuffer]'
                    && decodeFileData(value) === originalEndpoints
                ) return rollbackError;
                return null;
            }
        });
        harness.setDirectoryHandle(directory.handle);
        harness.DirectoryStorage._saveSessionNow = async () => { throw mainError; };

        await assert.rejects(harness.DirectoryStorage.importAll({
            endpoints: { nodes: [{ id: 'new' }] },
            sessions: [{ id: 'new' }]
        }), error => {
            assert.equal(error.name, 'AggregateError');
            assert.equal(error.message, '目录导入失败且回滚失败');
            assert.equal(error.errors.length, 2);
            assert.equal(error.errors[0], mainError);
            assert.equal(error.errors[1], rollbackError);
            assert.equal(error.cause, mainError);
            return true;
        });
    });

    test(`${implementation} Task 1B switchMode outer rollback restores DirectoryStorage raw checkpoint`, async () => {
        const harness = loadHarness();
        const values = installBrowserMap(harness.BrowserStorage, [
            ['endpoints', { nodes: [{ id: 'source' }] }],
            ['session:new', { id: 'new' }],
            ['__mode', 'browser']
        ]);
        const brokenSession = '{broken session bytes';
        const directory = createMemoryDirectory({
            'endpoints.json': JSON.stringify({ nodes: [{ id: 'target' }] }),
            'sessions/broken.json': brokenSession
        });
        harness.setMode('browser');
        const originalSaveSession = harness.DirectoryStorage._saveSessionNow;
        let shouldFail = true;
        harness.DirectoryStorage._saveSessionNow = async session => {
            await originalSaveSession.call(harness.DirectoryStorage, session);
            if (shouldFail) {
                shouldFail = false;
                throw new Error('target import failed');
            }
        };

        await assert.rejects(harness.storage.switchMode('directory', directory.handle), /target import failed/);
        assert.equal(directory.files.get('sessions/broken.json'), brokenSession);
        assert.equal(harness.storage.mode, 'browser');
        assert.equal(values.get('__mode'), 'browser');
    });

    test(`${implementation} DirectoryStorage clearAll is serialized after an overlapping saveSession`, async () => {
        const harness = loadHarness();
        const files = new Map();
        const writeStarted = deferred();
        const allowWrite = deferred();
        let sessionsDirectoryExists = false;
        const missing = () => new DOMException('missing', 'NotFoundError');
        function createSessionFileHandle(name) {
            return {
                async createWritable() {
                    let pending;
                    return {
                        async write(value) { pending = value; writeStarted.resolve(); await allowWrite.promise; },
                        async close() { files.set(name, pending); },
                        async abort() {}
                    };
                },
                async getFile() {
                    const content = files.get(name) || '';
                    return {
                        async arrayBuffer() { return new TextEncoder().encode(content).buffer; }
                    };
                }
            };
        }
        const sessionsDirectory = {
            async getFileHandle(name, options = {}) {
                if (!files.has(name) && !options.create) throw missing();
                return createSessionFileHandle(name);
            },
            async removeEntry(name) {
                if (!files.has(name)) throw missing();
                files.delete(name);
            },
            async *values() {
                for (const name of files.keys()) {
                    yield { ...createSessionFileHandle(name), kind: 'file', name };
                }
            }
        };
        harness.setDirectoryHandle({
            name: 'memory',
            async getFileHandle() { throw missing(); },
            async getDirectoryHandle(name, options = {}) {
                if (name !== 'sessions') throw missing();
                if (!sessionsDirectoryExists && !options.create) throw missing();
                sessionsDirectoryExists = true;
                return sessionsDirectory;
            },
            async removeEntry(name, options = {}) {
                if (name === 'sessions' && options.recursive && sessionsDirectoryExists) {
                    files.clear();
                    sessionsDirectoryExists = false;
                    return;
                }
                throw missing();
            }
        });
        const saving = harness.DirectoryStorage.saveSession({ id: 'A' });
        await writeStarted.promise;
        const clearing = harness.DirectoryStorage.clearAll();
        allowWrite.resolve();
        await Promise.all([saving, clearing]);
        assert.equal(files.has('A.json'), false);
    });

    test(`${implementation} clearAll is serialized after an overlapping saveSession`, async () => {
        const harness = loadHarness();
        const values = installBrowserMap(harness.BrowserStorage);
        const writeStarted = deferred();
        const allowWrite = deferred();
        const originalSet = harness.BrowserStorage._set;
        harness.BrowserStorage._set = async (key, value) => {
            if (key === 'session:A') {
                writeStarted.resolve();
                await allowWrite.promise;
            }
            await originalSet(key, value);
        };
        const saving = harness.BrowserStorage.saveSession({ id: 'A' });
        await writeStarted.promise;
        const clearing = harness.BrowserStorage.clearAll();
        allowWrite.resolve();
        await Promise.all([saving, clearing]);
        assert.equal(values.has('session:A'), false);
    });

    test(`${implementation} switchMode rolls back when target raw checkpoint fails`, async () => {
        const harness = loadHarness();
        const values = installBrowserMap(harness.BrowserStorage, [
            ['endpoints', { nodes: [{ id: 'source' }] }],
            ['__mode', 'browser']
        ]);
        const directory = createMemoryDirectory();
        harness.setMode('browser');
        const originalCheckpoint = harness.DirectoryStorage._checkpointImportNow;
        harness.DirectoryStorage._checkpointImportNow = async () => { throw new Error('target checkpoint failed'); };
        await assert.rejects(harness.storage.switchMode('directory', directory.handle), /target checkpoint failed/);
        harness.DirectoryStorage._checkpointImportNow = originalCheckpoint;
        assert.equal(harness.storage.mode, 'browser');
        assert.equal(harness.getDirectoryHandle(), null);
        assert.equal(values.get('__mode'), 'browser');
    });

    test(`${implementation} switchMode restores target snapshot and mode preference after partial import failure`, async () => {
        const harness = loadHarness();
        const values = installBrowserMap(harness.BrowserStorage, [
            ['endpoints', { nodes: [{ id: 'source' }] }],
            ['session:new', { id: 'new' }],
            ['__mode', 'browser']
        ]);
        const directory = createMemoryDirectory({
            'endpoints.json': JSON.stringify({ nodes: [{ id: 'target' }] }),
            'sessions/old.json': JSON.stringify({ id: 'old' })
        });
        await harness.DirectoryStorage._setHandle(directory.handle);
        harness.setMode('browser');
        const originalSaveSession = harness.DirectoryStorage._saveSessionNow;
        let shouldFail = true;
        harness.DirectoryStorage._saveSessionNow = async session => {
            if (shouldFail) {
                shouldFail = false;
                await originalSaveSession.call(harness.DirectoryStorage, session);
                throw new Error('import failed');
            }
            return originalSaveSession.call(harness.DirectoryStorage, session);
        };
        await assert.rejects(harness.storage.switchMode('directory', directory.handle), /import failed/);
        assert.equal(harness.storage.mode, 'browser');
        assert.equal(values.get('__mode'), 'browser');
        assert.deepEqual(JSON.parse(directory.files.get('endpoints.json')), { nodes: [{ id: 'target' }] });
        assert.equal(directory.files.has('sessions/new.json'), false);
        assert.equal(JSON.parse(directory.files.get('sessions/old.json')).id, 'old');
    });
}

function deferred() {
    let resolve;
    let reject;
    const promise = new Promise((resolvePromise, rejectPromise) => {
        resolve = resolvePromise;
        reject = rejectPromise;
    });
    return { promise, reject, resolve };
}

function installBrowserMap(BrowserStorage, initial = []) {
    const values = new Map(initial);
    BrowserStorage._get = async key => values.get(key);
    BrowserStorage._set = async (key, value) => { values.set(key, structuredClone(value)); };
    BrowserStorage._delete = async key => { values.delete(key); };
    BrowserStorage._entries = async () => Array.from(values.entries());
    return values;
}

function decodeFileData(value) {
    if (typeof value === 'string') return value;
    if (Object.prototype.toString.call(value) === '[object ArrayBuffer]') {
        return new TextDecoder().decode(new Uint8Array(value));
    }
    if (ArrayBuffer.isView(value)) {
        return new TextDecoder().decode(new Uint8Array(value.buffer, value.byteOffset, value.byteLength));
    }
    throw new TypeError('unsupported file data');
}

function createMemoryDirectory(initial = {}, options = {}) {
    const files = new Map(Object.entries(initial));
    const writeAttempts = [];
    const sessionsDirectory = {
        async getFileHandle(name, options = {}) {
            if (!files.has(`sessions/${name}`) && !options.create) throw new DOMException('missing', 'NotFoundError');
            return createFileHandle(`sessions/${name}`);
        },
        async removeEntry(name) {
            const key = `sessions/${name}`;
            if (!files.has(key)) throw new DOMException('missing', 'NotFoundError');
            files.delete(key);
        },
        async *values() {
            for (const key of files.keys()) {
                if (!key.startsWith('sessions/')) continue;
                const name = key.slice('sessions/'.length);
                yield { ...createFileHandle(key), kind: 'file', name };
            }
        }
    };
    function createFileHandle(key) {
        return {
            async createWritable() {
                let pending;
                return {
                    async write(value) {
                        writeAttempts.push(key);
                        const error = options.writeError?.(key, value);
                        if (error) throw error;
                        pending = value;
                    },
                    async close() { files.set(key, decodeFileData(pending)); },
                    async abort() {}
                };
            },
            async getFile() {
                const error = options.readError?.(key);
                if (error) throw error;
                const content = files.get(key) || '';
                return {
                    async text() { return content; },
                    async arrayBuffer() { return new TextEncoder().encode(content).buffer; }
                };
            }
        };
    }
    return {
        files,
        writeAttempts,
        handle: {
            name: 'memory',
            async getFileHandle(name, options = {}) {
                if (!files.has(name) && !options.create) throw new DOMException('missing', 'NotFoundError');
                return createFileHandle(name);
            },
            async getDirectoryHandle(name, options = {}) {
                if (name !== 'sessions') throw new DOMException('missing', 'NotFoundError');
                const hasSessions = Array.from(files.keys()).some(key => key.startsWith('sessions/'));
                if (!hasSessions && !options.create) throw new DOMException('missing', 'NotFoundError');
                return sessionsDirectory;
            },
            async removeEntry(name, options = {}) {
                if (name === 'sessions' && options.recursive) {
                    for (const key of Array.from(files.keys())) if (key.startsWith('sessions/')) files.delete(key);
                    return;
                }
                if (!files.delete(name)) throw new DOMException('missing', 'NotFoundError');
            }
        }
    };
}

test('endpoint mutation treats a missing selection list as empty', async () => {
    const harness = createStoreHarness({ omitSelectedEndpoints: true });
    harness.api.seedEndpoints({
        nodes: [
            { id: 'target', name: 'Target', children: [] },
            { id: 'dragged', name: 'Dragged', children: [] }
        ]
    });

    const result = await harness.api.reorderNode('dragged', 'target', true);

    assert.equal(result, true);
    assert.deepEqual(
        harness.api.getEndpointsData().nodes.map(node => node.id),
        ['dragged', 'target']
    );
});

test('Task 1C endpoint rollback updateNode restores held node and children references after persistence failure', async () => {
    const child = { id: 'C', name: 'child', children: [] };
    const parent = { id: 'P', name: 'parent', marker: 'original', children: [child] };
    const rootNodes = [parent];
    const harness = createStoreHarness({ saveEndpointsError: new Error('disk full') });
    harness.api.seedEndpoints({ nodes: rootNodes });

    await assert.rejects(harness.api.updateNode('P', {
        name: 'changed',
        marker: 'replaced',
        children: [{ id: 'N', name: 'new child', children: [] }]
    }), /disk full/);

    assert.equal(harness.api.getGroups(), rootNodes);
    assert.equal(harness.api.getNode('P'), parent);
    assert.equal(parent.children, rootNodes[0].children);
    assert.equal(parent.children[0], child);
    assert.deepEqual(parent, { id: 'P', name: 'parent', marker: 'original', children: [child] });
});

test('Task 1C endpoint rollback moveNodeAsChild restores held source and target children after persistence failure', async () => {
    const moved = { id: 'M', name: 'moved', children: [] };
    const source = { id: 'S', name: 'source', children: [moved] };
    const target = { id: 'T', name: 'target', children: [] };
    const rootNodes = [source, target];
    const sourceChildren = source.children;
    const targetChildren = target.children;
    const harness = createStoreHarness({ saveEndpointsError: new Error('disk full') });
    harness.api.seedEndpoints({ nodes: rootNodes });

    await assert.rejects(harness.api.moveNodeAsChild('M', 'T'), /disk full/);

    assert.equal(harness.api.getGroups(), rootNodes);
    assert.equal(source.children, sourceChildren);
    assert.equal(target.children, targetChildren);
    assert.equal(source.children[0], moved);
    assert.deepEqual(source.children.map(node => node.id), ['M']);
    assert.deepEqual(target.children, []);
});

test('Task 1C endpoint rollback deleteNode restores the held deleted node at its original index after persistence failure', async () => {
    const first = { id: 'A', name: 'first', children: [] };
    const deleted = { id: 'B', name: 'deleted', children: [] };
    const third = { id: 'C', name: 'third', children: [] };
    const rootNodes = [first, deleted, third];
    const harness = createStoreHarness({ saveEndpointsError: new Error('disk full') });
    harness.api.seedEndpoints({ nodes: rootNodes });

    await assert.rejects(harness.api.deleteNode('B'), /disk full/);

    assert.equal(harness.api.getGroups(), rootNodes);
    assert.equal(rootNodes[1], deleted);
    assert.deepEqual(rootNodes.map(node => node.id), ['A', 'B', 'C']);
});

for (const method of ['addNode', 'cloneNode']) {
    test(`Task 1C endpoint rollback ${method} removes new nodes from held arrays after persistence failure`, async () => {
        const existing = { id: 'A', name: 'existing', children: [] };
        const rootNodes = [existing];
        const harness = createStoreHarness({ saveEndpointsError: new Error('disk full') });
        harness.api.seedEndpoints({ nodes: rootNodes });
        const args = method === 'addNode' ? [null, { name: 'new' }] : ['A'];

        await assert.rejects(harness.api[method](...args), /disk full/);

        assert.equal(harness.api.getGroups(), rootNodes);
        assert.deepEqual(rootNodes, [existing]);
    });
}

test('addNode rolls back memory when persistence fails', async () => {
    const harness = createStoreHarness({ saveEndpointsError: new Error('disk full') });
    harness.api.seedEndpoints({ nodes: [] });

    await assert.rejects(harness.api.addNode(null, { name: 'new' }), /disk full/);
    assert.equal(harness.api.getEndpointsData().nodes.length, 0);
});

test('updateNode rolls back memory when persistence fails', async () => {
    const harness = createStoreHarness({ saveEndpointsError: new Error('disk full') });
    harness.api.seedEndpoints({ nodes: [{ id: 'N', name: 'old', children: [] }] });

    await assert.rejects(harness.api.updateNode('N', { name: 'new' }), /disk full/);
    assert.equal(harness.api.getEndpointsData().nodes[0].name, 'old');
});

test('deleteNode rolls back selected endpoints when persistence fails', async () => {
    const harness = createStoreHarness({ saveEndpointsError: new Error('disk full') });
    harness.api.seedEndpoints({ nodes: [{ id: 'N', modelId: 'model', children: [] }] });
    harness.api.seedSelectedEndpoints(['N']);

    await assert.rejects(harness.api.deleteNode('N'), /disk full/);
    assert.equal(harness.api.getSelectedEndpoints().join(','), 'N');
});

test('Task 1C endpoint rollback preserves the original save error when selection persistence also fails', async () => {
    const saveEndpointsError = new Error('endpoint save failed');
    let selectionSaveCount = 0;
    const harness = createStoreHarness({
        saveEndpointsError,
        saveDefaultSelectedEndpoints() {
            selectionSaveCount++;
            if (selectionSaveCount === 2) throw new Error('selection rollback save failed');
        }
    });
    harness.api.seedEndpoints({ nodes: [{ id: 'N', name: 'original', children: [] }] });
    harness.api.seedSelectedEndpoints(['N']);

    await assert.rejects(harness.api.deleteNode('N'), error => error === saveEndpointsError);
    assert.equal(selectionSaveCount, 2);
    assert.deepEqual(harness.api.getEndpointsData().nodes, [{ id: 'N', name: 'original', children: [] }]);
    assert.deepEqual(harness.api.getSelectedEndpoints(), ['N']);
});

test('addMessage rolls back the appended message when persistence fails', async () => {
    const harness = createStoreHarness({ saveSessionError: new Error('permission revoked') });
    harness.api.seedSession({ id: 'S', title: 'old', messages: [] });

    await assert.rejects(harness.api.addMessage('S', 'user', 'hello'), /permission revoked/);
    assert.equal(harness.api.getSession('S').messages.length, 0);
    assert.equal(harness.api.getSession('S').title, 'old');
});

test('deleteSession rolls back cache deletion when persistence fails', async () => {
    const harness = createStoreHarness({ deleteSessionError: new Error('permission revoked') });
    harness.api.seedSession({ id: 'S', messages: [] });

    await assert.rejects(harness.api.deleteSession('S'), /permission revoked/);
    assert.equal(harness.api.getSession('S').id, 'S');
});

test('session rollback restores the same externally referenced object', async () => {
    const external = { id: 'S', title: 'old', messages: [] };
    const harness = createStoreHarness({ saveSessionError: new Error('permission revoked') });
    harness.api.seedSession(external);
    await assert.rejects(harness.api.addMessage('S', 'user', 'hello'), /permission revoked/);
    assert.equal(harness.api.getSession('S'), external);
    assert.deepEqual(external, { id: 'S', title: 'old', messages: [] });
});

test('failed session mutation cannot roll back a later successful mutation', async () => {
    let calls = 0;
    const firstSave = deferred();
    const harness = createStoreHarness({
        async saveSession() {
            calls++;
            if (calls === 1) return firstSave.promise;
        }
    });
    const session = { id: 'S', title: 'old', messages: [] };
    harness.api.seedSession(session);
    const first = harness.api.addMessage('S', 'user', 'first');
    const second = harness.api.addMessage('S', 'user', 'second');
    firstSave.reject(new Error('first failed'));
    await assert.rejects(first, /first failed/);
    await second;
    assert.equal(session.messages.length, 1);
    assert.equal(session.messages[0].content[0].text, 'second');
});

test('failed endpoint mutation cannot roll back a later successful mutation', async () => {
    let calls = 0;
    const firstSave = deferred();
    const harness = createStoreHarness({
        async saveEndpoints() {
            calls++;
            if (calls === 1) return firstSave.promise;
        }
    });
    harness.api.seedEndpoints({ nodes: [] });
    const first = harness.api.addNode(null, { name: 'first' });
    const second = harness.api.addNode(null, { name: 'second' });
    firstSave.reject(new Error('first failed'));
    await assert.rejects(first, /first failed/);
    await second;
    assert.equal(harness.api.getEndpointsData().nodes.length, 1);
    assert.equal(harness.api.getEndpointsData().nodes[0].name, 'second');
});

test('queued endpoint updates resolve nodes after a prior rollback', async () => {
    let calls = 0;
    const firstSave = deferred();
    const harness = createStoreHarness({
        async saveEndpoints() {
            calls++;
            if (calls === 1) return firstSave.promise;
        }
    });
    harness.api.seedEndpoints({ nodes: [{ id: 'N', name: 'old', children: [] }] });
    const first = harness.api.updateNode('N', { name: 'failed' });
    const second = harness.api.updateNode('N', { name: 'saved' });
    firstSave.reject(new Error('first failed'));
    await assert.rejects(first, /first failed/);
    await second;
    assert.equal(harness.api.getEndpointsData().nodes[0].name, 'saved');
});

test('queued endpoint moves do not use targets deleted by a prior mutation', async () => {
    const firstSave = deferred();
    let saves = 0;
    const harness = createStoreHarness({
        async saveEndpoints() {
            saves++;
            if (saves === 1) return firstSave.promise;
        }
    });
    harness.api.seedEndpoints({
        nodes: [
            { id: 'target', name: 'target', children: [] },
            { id: 'dragged', name: 'dragged', children: [] }
        ]
    });
    const deleting = harness.api.deleteNode('target');
    const moving = harness.api.reorderNode('dragged', 'target', true);
    firstSave.resolve();
    await deleting;
    assert.equal(await moving, false);
    assert.deepEqual(harness.api.getEndpointsData().nodes.map(node => node.id), ['dragged']);
});

test('queued batchAddNodes resolves its parent after a prior rollback', async () => {
    const saveStarted = deferred();
    const firstSave = deferred();
    let saves = 0;
    const harness = createStoreHarness({
        async saveEndpoints() {
            saves++;
            if (saves === 1) {
                saveStarted.resolve();
                return firstSave.promise;
            }
        }
    });
    harness.api.seedEndpoints({ nodes: [{ id: 'P', name: 'parent', children: [] }] });
    const first = harness.api.updateNode('P', { name: 'failed' });
    await saveStarted.promise;
    const adding = harness.api.batchAddNodes('P', [{ name: 'child' }]);
    firstSave.reject(new Error('first failed'));
    await assert.rejects(first, /first failed/);
    assert.equal((await adding).length, 1);
    const parent = harness.api.getEndpointsData().nodes[0];
    assert.equal(parent.name, 'parent');
    assert.deepEqual(parent.children.map(node => node.name), ['child']);
});

test('queued cloneNode constructs its copy from the tree restored after a prior rollback', async () => {
    const saveStarted = deferred();
    const firstSave = deferred();
    let saves = 0;
    const harness = createStoreHarness({
        async saveEndpoints() {
            saves++;
            if (saves === 1) {
                saveStarted.resolve();
                return firstSave.promise;
            }
        }
    });
    harness.api.seedEndpoints({
        nodes: [{ id: 'P', name: 'parent', children: [{ id: 'S', name: 'source', children: [] }] }]
    });
    const first = harness.api.updateNode('S', { name: 'failed' });
    await saveStarted.promise;
    const cloning = harness.api.cloneNode('S');
    firstSave.reject(new Error('first failed'));
    await assert.rejects(first, /first failed/);
    const cloned = await cloning;
    const children = harness.api.getEndpointsData().nodes[0].children;
    assert.equal(cloned.name, 'source（副本）');
    assert.deepEqual(children.map(node => node.name), ['source', 'source（副本）']);
});

test('cloneNode recursively copies params and customParams without shared references', async () => {
	const harness = createStoreHarness();
	harness.api.seedEndpoints({
		nodes: [{
			id: 'P',
			name: 'parent',
			params: { generation: { temperature: 0.2 } },
			customParams: [{ name: 'top_p', value: 0.9 }],
			children: [{
				id: 'C',
				name: 'child',
				params: { voice: 'alloy' },
				customParams: [{ name: 'speed', value: 1 }],
				children: []
			}]
		}]
	});

	const cloned = await harness.api.cloneNode('P');
	cloned.params.generation.temperature = 0.9;
	cloned.children[0].customParams[0].value = 2;

	assert.deepEqual(cloned.params, { generation: { temperature: 0.9 } });
	assert.deepEqual(cloned.customParams, [{ name: 'top_p', value: 0.9 }]);
	assert.deepEqual(cloned.children[0].params, { voice: 'alloy' });
	assert.deepEqual(cloned.children[0].customParams, [{ name: 'speed', value: 2 }]);
	assert.deepEqual(harness.api.getNode('P').params, { generation: { temperature: 0.2 } });
	assert.deepEqual(harness.api.getNode('P').children[0].customParams, [{ name: 'speed', value: 1 }]);
});

test('queued moveNodeAsChild keeps the dragged node when a prior mutation deletes its target', async () => {
    const harness = createStoreHarness();
    harness.api.seedEndpoints({
        nodes: [
            { id: 'target', name: 'target', children: [] },
            { id: 'dragged', name: 'dragged', children: [] }
        ]
    });
    const deleting = harness.api.deleteNode('target');
    const moving = harness.api.moveNodeAsChild('dragged', 'target');
    await deleting;
    assert.equal(await moving, false);
    assert.deepEqual(harness.api.getEndpointsData().nodes.map(node => node.id), ['dragged']);
});

test('deleteSession waits for an earlier session mutation before deleting persistence', async () => {
    const saveStarted = deferred();
    const allowSave = deferred();
    const calls = [];
    const harness = createStoreHarness({
        async saveSession() {
            calls.push('save');
            saveStarted.resolve();
            await allowSave.promise;
        },
        async deleteSession() { calls.push('delete'); }
    });
    harness.api.seedSession({ id: 'S', title: 'old', messages: [] });
    const adding = harness.api.addMessage('S', 'user', 'hello');
    await saveStarted.promise;
    const deleting = harness.api.deleteSession('S');
    allowSave.resolve();
    await Promise.all([adding, deleting]);
    assert.deepEqual(calls, ['save', 'delete']);
    assert.equal(harness.api.getSession('S'), undefined);
});

for (const method of ['batchAddNodes', 'cloneNode', 'reorderNode', 'moveNodeAsChild']) {
    test(`${method} rolls back endpoint state when persistence fails`, async () => {
        const harness = createStoreHarness({ saveEndpointsError: new Error('disk full') });
        harness.api.seedEndpoints({
            nodes: [
                { id: 'A', name: 'A', children: [] },
                { id: 'B', name: 'B', children: [] }
            ]
        });
        const before = structuredClone(harness.api.getEndpointsData());
        const args = {
            batchAddNodes: [null, [{ name: 'new' }]],
            cloneNode: ['A'],
            reorderNode: ['B', 'A', true],
            moveNodeAsChild: ['B', 'A']
        }[method];
        await assert.rejects(harness.api[method](...args), /disk full/);
        assert.deepEqual(harness.api.getEndpointsData(), before);
    });
}

test('responses branch rolls back in place when persistence fails', async () => {
    const external = { id: 'S', title: 'old', messages: [] };
    const harness = createStoreHarness({ saveSessionError: new Error('permission revoked') });
    harness.api.seedSession(external);
    await assert.rejects(harness.api.addMessage('S', 'assistant', null, {
        responses: [{ modelId: 'M', text: 'answer' }]
    }), /permission revoked/);
    assert.equal(harness.api.getSession('S'), external);
    assert.deepEqual(external.messages, []);
});

for (const loadHarness of [loadStorageHarness, loadExtensionStorageHarness]) {
    const implementation = loadHarness === loadStorageHarness ? 'standard' : 'extension';
    test(`${implementation} concurrent saves write independent session keys`, async () => {
        const { BrowserStorage } = loadHarness();
        const values = new Map();
        BrowserStorage._get = async key => values.get(key);
        BrowserStorage._set = async (key, value) => { values.set(key, structuredClone(value)); };

        await Promise.all([
            BrowserStorage.saveSession({ id: 'A', title: 'new A' }),
            BrowserStorage.saveSession({ id: 'B', title: 'new B' })
        ]);

        assert.equal(values.get('session:A').title, 'new A');
        assert.equal(values.get('session:B').title, 'new B');
    });

    test(`${implementation} legacy aggregate sessions migrate idempotently`, async () => {
        const { BrowserStorage } = loadHarness();
        const values = new Map([
            ['sessions', {
                A: { id: 'A', title: 'A', createdAt: 1 },
                B: { id: 'B', title: 'B', createdAt: 2 }
            }]
        ]);
        BrowserStorage._get = async key => values.get(key);
        BrowserStorage._set = async (key, value) => { values.set(key, structuredClone(value)); };
        BrowserStorage._delete = async key => { values.delete(key); };
        BrowserStorage._entries = async () => Array.from(values.entries());

        const first = await BrowserStorage.loadSessions();
        const second = await BrowserStorage.loadSessions();

        assert.equal(first.map(session => session.id).join(','), 'B,A');
        assert.equal(second.map(session => session.id).join(','), 'B,A');
        assert.equal(values.has('sessions'), false);
        assert.equal(values.get('session:A').id, 'A');
        assert.equal(values.get('session:B').id, 'B');
    });
}

for (const loadHarness of [loadStorageHarness, loadExtensionStorageHarness]) {
    const implementation = loadHarness === loadStorageHarness ? 'standard' : 'extension';

    test(`${implementation} Task 1D clear BrowserStorage clearAll restores endpoints, settings, and sessions after cleanup failure`, async () => {
        const mainError = new Error('settings cleanup failed');
        const harness = loadHarness();
        const values = installBrowserMap(harness.BrowserStorage, [
            ['endpoints', { nodes: [{ id: 'old' }] }],
            ['settings', { theme: 'dark' }],
            ['session:A', { id: 'A', title: 'old session' }]
        ]);
        const originalDelete = harness.BrowserStorage._delete;
        harness.BrowserStorage._delete = async key => {
            if (key === 'settings') throw mainError;
            return originalDelete(key);
        };

        await assert.rejects(harness.BrowserStorage.clearAll(), error => error === mainError);
        assert.deepEqual(values.get('endpoints'), { nodes: [{ id: 'old' }] });
        assert.deepEqual(values.get('settings'), { theme: 'dark' });
        assert.deepEqual(values.get('session:A'), { id: 'A', title: 'old session' });
    });

    test(`${implementation} Task 1D clear BrowserStorage clearAll retains cleanup and rollback failures`, async () => {
        const mainError = new Error('settings cleanup failed');
        const rollbackError = new Error('browser rollback failed');
        const harness = loadHarness();
        installBrowserMap(harness.BrowserStorage, [
            ['endpoints', { nodes: [{ id: 'old' }] }],
            ['settings', { theme: 'dark' }],
            ['session:A', { id: 'A' }]
        ]);
        const originalDelete = harness.BrowserStorage._delete;
        harness.BrowserStorage._delete = async key => {
            if (key === 'settings') throw mainError;
            return originalDelete(key);
        };
        harness.BrowserStorage._set = async () => { throw rollbackError; };

        await assert.rejects(harness.BrowserStorage.clearAll(), error => {
            assert.equal(error.name, 'AggregateError');
            assert.equal(error.errors.length, 2);
            assert.equal(error.errors[0], mainError);
            assert.equal(error.errors[1], rollbackError);
            assert.equal(error.cause, mainError);
            return true;
        });
    });

    test(`${implementation} Task 1D clear DirectoryStorage clearAll restores raw endpoint bytes and sessions after cleanup failure`, async () => {
        const mainError = new Error('sessions cleanup failed');
        const endpointsBytes = '{broken endpoint bytes';
        const sessionBytes = '{broken session bytes';
        const harness = loadHarness();
        const directory = createMemoryDirectory({
            'endpoints.json': endpointsBytes,
            'sessions/A.json': sessionBytes
        });
        const originalRemoveEntry = directory.handle.removeEntry.bind(directory.handle);
        directory.handle.removeEntry = async (name, options) => {
            if (name === 'sessions' && options?.recursive) {
                await originalRemoveEntry(name, options);
                throw mainError;
            }
            return originalRemoveEntry(name, options);
        };
        harness.setDirectoryHandle(directory.handle);

        await assert.rejects(harness.DirectoryStorage.clearAll(), error => error === mainError);
        assert.equal(directory.files.get('endpoints.json'), endpointsBytes);
        assert.equal(directory.files.get('sessions/A.json'), sessionBytes);
    });

    test(`${implementation} Task 1D clear DirectoryStorage clearAll retains cleanup and raw rollback failures`, async () => {
        const mainError = new Error('sessions cleanup failed');
        const rollbackError = new Error('raw rollback failed');
        const endpointsBytes = '{broken endpoint bytes';
        const harness = loadHarness();
        const directory = createMemoryDirectory({
            'endpoints.json': endpointsBytes,
            'sessions/A.json': '{broken session bytes'
        }, {
            writeError(key, value) {
                if (
                    key === 'endpoints.json'
                    && Object.prototype.toString.call(value) === '[object ArrayBuffer]'
                    && decodeFileData(value) === endpointsBytes
                ) return rollbackError;
                return null;
            }
        });
        const originalRemoveEntry = directory.handle.removeEntry.bind(directory.handle);
        directory.handle.removeEntry = async (name, options) => {
            if (name === 'sessions' && options?.recursive) {
                await originalRemoveEntry(name, options);
                throw mainError;
            }
            return originalRemoveEntry(name, options);
        };
        harness.setDirectoryHandle(directory.handle);

        await assert.rejects(harness.DirectoryStorage.clearAll(), error => {
            assert.equal(error.name, 'AggregateError');
            assert.equal(error.errors.length, 2);
            assert.equal(error.errors[0], mainError);
            assert.equal(error.errors[1], rollbackError);
            assert.equal(error.cause, mainError);
            return true;
        });
    });

    test(`${implementation} Task 1D clear storage.clearAll dispatches rollback-safe browser and directory cleanup`, async () => {
        const browserError = new Error('browser cleanup failed');
        const browserHarness = loadHarness();
        const browserValues = installBrowserMap(browserHarness.BrowserStorage, [
            ['endpoints', { nodes: [{ id: 'old' }] }],
            ['session:A', { id: 'A' }]
        ]);
        const originalBrowserDelete = browserHarness.BrowserStorage._delete;
        browserHarness.BrowserStorage._delete = async key => {
            if (key === 'sessions') throw browserError;
            return originalBrowserDelete(key);
        };
        browserHarness.setMode('browser');

        await assert.rejects(browserHarness.storage.clearAll(), error => error === browserError);
        assert.deepEqual(browserValues.get('endpoints'), { nodes: [{ id: 'old' }] });
        assert.deepEqual(browserValues.get('session:A'), { id: 'A' });

        const directoryError = new Error('directory cleanup failed');
        const directoryHarness = loadHarness();
        const directory = createMemoryDirectory({
            'endpoints.json': '{original endpoints',
            'sessions/A.json': '{original session'
        });
        const originalRemoveEntry = directory.handle.removeEntry.bind(directory.handle);
        directory.handle.removeEntry = async (name, options) => {
            if (name === 'sessions' && options?.recursive) throw directoryError;
            return originalRemoveEntry(name, options);
        };
        directoryHarness.setDirectoryHandle(directory.handle);
        directoryHarness.setMode('directory');

        await assert.rejects(directoryHarness.storage.clearAll(), error => error === directoryError);
        assert.equal(directory.files.get('endpoints.json'), '{original endpoints');
        assert.equal(directory.files.get('sessions/A.json'), '{original session');
    });
}

test('Task 1D clear clearDirectory preserves endpoint and session cache references when persistent cleanup fails', async () => {
    const clearError = new Error('persistent cleanup failed');
    const endpoints = { nodes: [{ id: 'E', name: 'endpoint', children: [] }] };
    const session = { id: 'S', title: 'session', messages: [] };
    const harness = createStoreHarness({ clearAllError: clearError });
    harness.api.seedEndpoints(endpoints);
    harness.api.seedSession(session);

    await assert.rejects(harness.api.clearDirectory(), error => error === clearError);
    assert.equal(harness.api.getEndpointsData(), endpoints);
    assert.equal(harness.api.getSession('S'), session);
});

function bytesOf(value) {
	return new Uint8Array(value).slice();
}

function memoryBytes(value) {
	if (typeof value === 'string') return new TextEncoder().encode(value);
	if (Object.prototype.toString.call(value) === '[object ArrayBuffer]') return new Uint8Array(value).slice();
	if (ArrayBuffer.isView(value)) return new Uint8Array(value.buffer, value.byteOffset, value.byteLength).slice();
	throw new TypeError('unsupported memory file data');
}

function createRecursiveMemoryDirectory(initialFiles, options = {}) {
	const root = { kind: 'directory', children: new Map() };

	function missing() {
		return new DOMException('missing', 'NotFoundError');
	}

	function split(filePath) {
		return filePath.split('/').filter(Boolean);
	}

	function getDirectory(parts, create = false) {
		let current = root;
		for (const name of parts) {
			let child = current.children.get(name);
			if (!child) {
				if (!create) throw missing();
				child = { kind: 'directory', children: new Map() };
				current.children.set(name, child);
			}
			if (child.kind !== 'directory') throw new DOMException('not a directory', 'TypeMismatchError');
			current = child;
		}
		return current;
	}

	function installFile(filePath, value) {
		const parts = split(filePath);
		const name = parts.pop();
		const parent = getDirectory(parts, true);
		parent.children.set(name, { kind: 'file', bytes: memoryBytes(value) });
	}

	for (const [filePath, value] of Object.entries(initialFiles)) installFile(filePath, value);

	function fileHandle(parent, name, node) {
		return {
			kind: 'file',
			name,
			async createWritable() {
				let pending;
				return {
					async write(value) {
						const error = options.writeError?.(name, value);
						if (error) throw error;
						pending = memoryBytes(value);
					},
					async close() {
						parent.children.set(name, { kind: 'file', bytes: pending });
					},
					async abort() {}
				};
			},
			async getFile() {
				if (!node || node.kind !== 'file') throw missing();
				const copy = node.bytes.slice();
				return {
					async text() { return new TextDecoder().decode(copy); },
					async arrayBuffer() {
						return copy.buffer.slice(copy.byteOffset, copy.byteOffset + copy.byteLength);
					}
				};
			}
		};
	}

	function directoryHandle(directory, directoryName = 'memory', directoryPath = '') {
		return {
			kind: 'directory',
			name: directoryName,
			async getFileHandle(name, createOptions = {}) {
				let node = directory.children.get(name);
				if (!node) {
					if (!createOptions.create) throw missing();
					node = { kind: 'file', bytes: new Uint8Array() };
					directory.children.set(name, node);
				}
				if (node.kind !== 'file') throw new DOMException('not a file', 'TypeMismatchError');
				return fileHandle(directory, name, node);
			},
			async getDirectoryHandle(name, createOptions = {}) {
				let node = directory.children.get(name);
				if (!node) {
					if (!createOptions.create) throw missing();
					node = { kind: 'directory', children: new Map() };
					directory.children.set(name, node);
				}
				if (node.kind !== 'directory') throw new DOMException('not a directory', 'TypeMismatchError');
				return directoryHandle(node, name, `${directoryPath}${name}/`);
			},
			async removeEntry(name, removeOptions = {}) {
				const node = directory.children.get(name);
				if (!node) throw missing();
				if (node.kind === 'directory' && !removeOptions.recursive && node.children.size) {
					throw new DOMException('directory not empty', 'InvalidModificationError');
				}
				directory.children.delete(name);
				const error = await options.removeErrorAfter?.(`${directoryPath}${name}`, removeOptions);
				if (error) throw error;
			},
			async *values() {
				for (const [name, node] of directory.children) {
					yield node.kind === 'file'
						? fileHandle(directory, name, node)
						: directoryHandle(node, name, `${directoryPath}${name}/`);
				}
			}
		};
	}

	function snapshot(directory = root, prefix = '', result = { directories: [], files: [] }) {
		for (const [name, node] of directory.children) {
			const currentPath = `${prefix}${name}`;
			if (node.kind === 'directory') {
				result.directories.push(currentPath);
				snapshot(node, `${currentPath}/`, result);
			} else {
				result.files.push([currentPath, Array.from(node.bytes)]);
			}
		}
		return result;
	}

	return {
		handle: directoryHandle(root),
		snapshot() {
			const result = snapshot();
			result.directories.sort();
			result.files.sort(([left], [right]) => left.localeCompare(right));
			return result;
		}
	};
}

function assertClearAggregate(error, message, mainError, rollbackError) {
	assert.equal(error.name, 'AggregateError');
	assert.equal(error.message, message);
	assert.equal(error.errors.length, 2);
	assert.equal(error.errors[0], mainError);
	assert.equal(error.errors[1], rollbackError);
	assert.equal(error.cause, mainError);
	return true;
}

for (const loadHarness of [loadStorageHarness, loadExtensionStorageHarness]) {
	const implementation = loadHarness === loadStorageHarness ? 'standard' : 'extension';

	test(`${implementation} Task 1D clear BrowserStorage deletes only managed data and preserves mode and unknown keys`, async () => {
		const harness = loadHarness();
		const values = installBrowserMap(harness.BrowserStorage, [
			['endpoints', { nodes: [{ id: 'E' }] }],
			['sessions', { legacy: { id: 'legacy' } }],
			['settings', { theme: 'dark' }],
			['session:A', { id: 'A' }],
			['session:B', { id: 'B' }],
			['__mode', 'browser'],
			['unknown', { mustSurvive: true }]
		]);

		await harness.BrowserStorage.clearAll();

		assert.deepEqual(Array.from(values.entries()), [
			['__mode', 'browser'],
			['unknown', { mustSurvive: true }]
		]);
	});

	test(`${implementation} Task 1D clear BrowserStorage restores the complete checkpoint after the later session deletion fails`, async () => {
		const mainError = new DOMException('second session deletion blocked', 'NotAllowedError');
		const harness = loadHarness();
		const values = installBrowserMap(harness.BrowserStorage, [
			['endpoints', { nodes: [{ id: 'old' }] }],
			['sessions', { legacy: { id: 'legacy' } }],
			['settings', { theme: 'dark' }],
			['session:A', { id: 'A', title: 'first' }],
			['session:B', { id: 'B', title: 'second' }],
			['__mode', 'browser'],
			['unknown', { preserve: true }]
		]);
		const checkpoint = structuredClone(Array.from(values.entries()));
		const originalDelete = harness.BrowserStorage._delete;
		let clearPhase = true;
		harness.BrowserStorage._delete = async key => {
			if (clearPhase && key === 'session:B') throw mainError;
			return originalDelete(key);
		};

		await assert.rejects(harness.BrowserStorage.clearAll(), error => error === mainError);
		clearPhase = false;
		assert.deepEqual(
			Array.from(values.entries()).sort(([left], [right]) => left.localeCompare(right)),
			checkpoint.sort(([left], [right]) => left.localeCompare(right))
		);
	});

	test(`${implementation} Task 1D clear BrowserStorage reports a newly-created-key rollback deletion failure`, async () => {
		const mainError = new DOMException('second session deletion blocked', 'NotAllowedError');
		const rollbackError = new DOMException('created key cannot be removed', 'QuotaExceededError');
		const harness = loadHarness();
		const values = installBrowserMap(harness.BrowserStorage, [
			['endpoints', { nodes: [{ id: 'old' }] }],
			['settings', { theme: 'dark' }],
			['session:A', { id: 'A' }],
			['session:B', { id: 'B' }],
			['__mode', 'browser'],
			['unknown', { preserve: true }]
		]);
		const originalDelete = harness.BrowserStorage._delete;
		let clearing = true;
		harness.BrowserStorage._delete = async key => {
			if (clearing && key === 'session:B') {
				values.set('created-during-clear', { transient: true });
				throw mainError;
			}
			if (!clearing && key === 'created-during-clear') throw rollbackError;
			return originalDelete(key);
		};
		const originalEntries = harness.BrowserStorage._entries;
		let entriesCalls = 0;
		harness.BrowserStorage._entries = async () => {
			entriesCalls++;
			if (entriesCalls === 2) clearing = false;
			return originalEntries();
		};

		await assert.rejects(
			harness.BrowserStorage.clearAll(),
			error => assertClearAggregate(error, '浏览器清空失败且回滚失败', mainError, rollbackError)
		);
	});

	test(`${implementation} Task 1D clear DirectoryStorage restores recursive session trees and exact raw bytes after partial cleanup`, async () => {
		const mainError = new DOMException('recursive sessions deletion interrupted', 'NotAllowedError');
		const harness = loadHarness();
		const directory = createRecursiveMemoryDirectory({
			'endpoints.json': bytesOf([0, 255, 17, 18]),
			'sessions/A.json': bytesOf([123, 34, 105, 100, 34, 58, 34, 65, 34, 125]),
			'sessions/notes.bin': bytesOf([0, 1, 2, 255]),
			'sessions/nested/B.json': bytesOf([123, 98, 114, 111, 107, 101, 110]),
			'sessions/nested/readme.txt': bytesOf([226, 152, 131]),
			'sessions/nested/deeper/blob.dat': bytesOf([16, 0, 16, 255])
		}, {
			removeErrorAfter(filePath, removeOptions) {
				return filePath === 'sessions' && removeOptions.recursive ? mainError : null;
			}
		});
		const checkpoint = directory.snapshot();
		harness.setDirectoryHandle(directory.handle);

		await assert.rejects(harness.DirectoryStorage.clearAll(), error => error === mainError);
		assert.deepEqual(directory.snapshot(), checkpoint);
	});

	test(`${implementation} Task 1D clear DirectoryStorage removes an empty sessions directory introduced during failed cleanup rollback`, async () => {
		const mainError = new DOMException('cleanup failed after creating sessions', 'NotAllowedError');
		const harness = loadHarness();
		const directory = createRecursiveMemoryDirectory({
			'endpoints.json': bytesOf([0, 255, 17, 18])
		}, {
			async removeErrorAfter(filePath, removeOptions) {
				if (filePath !== 'endpoints.json' || removeOptions.recursive) return null;
				await directory.handle.getDirectoryHandle('sessions', { create: true });
				return mainError;
			}
		});
		const checkpoint = directory.snapshot();
		harness.setDirectoryHandle(directory.handle);

		await assert.rejects(harness.DirectoryStorage.clearAll(), error => error === mainError);
		assert.deepEqual(directory.snapshot(), checkpoint);
	});

	test(`${implementation} Task 1D clear DirectoryStorage reports DOMException cleanup and rollback failures in order`, async () => {
		const mainError = new DOMException('recursive sessions deletion interrupted', 'NotAllowedError');
		const rollbackError = new DOMException('endpoint restore blocked', 'QuotaExceededError');
		const endpointsBytes = bytesOf([0, 255, 17, 18]);
		const harness = loadHarness();
		const directory = createRecursiveMemoryDirectory({
			'endpoints.json': endpointsBytes,
			'sessions/A.json': bytesOf([123, 34, 105, 100, 34, 58, 34, 65, 34, 125])
		}, {
			removeErrorAfter(filePath, removeOptions) {
				return filePath === 'sessions' && removeOptions.recursive ? mainError : null;
			},
			writeError(name, value) {
				return name === 'endpoints.json' && Array.from(memoryBytes(value)).join(',') === Array.from(endpointsBytes).join(',')
					? rollbackError
					: null;
			}
		});
		harness.setDirectoryHandle(directory.handle);

		await assert.rejects(
			harness.DirectoryStorage.clearAll(),
			error => assertClearAggregate(error, '目录清空失败且回滚失败', mainError, rollbackError)
		);
	});
}

