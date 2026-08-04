// ========== 统一存储模块 ==========
let storage, currentMode;
	// IndexedDB handle storage (for persisting directory handle)
	const DIRECTORY_DB = 'endpoint-manager';
	const HANDLE_STORE = 'handles';
	let directoryHandle = null;
	async function openHandleDB() {
		return new Promise((resolve, reject) => {
			const request = indexedDB.open(DIRECTORY_DB, 1);
			request.onerror = () => reject(request.error);
			request.onsuccess = () => resolve(request.result);
			request.onupgradeneeded = e => {
				const db = e.target.result;
				if (!db.objectStoreNames.contains(HANDLE_STORE)) db.createObjectStore(HANDLE_STORE);
			};
		});
	}
	async function saveHandleToIndexedDB(handle) {
		const db = await openHandleDB();
		return new Promise((resolve, reject) => {
			const tx = db.transaction(HANDLE_STORE, "readwrite");
			tx.objectStore(HANDLE_STORE).put(handle, "directory");
			tx.oncomplete = () => resolve();
			tx.onerror = () => reject(tx.error);
		});
	}
	async function loadHandleFromIndexedDB() {
		const db = await openHandleDB();
		return new Promise((resolve, reject) => {
			const tx = db.transaction(HANDLE_STORE, "readonly");
			const req = tx.objectStore(HANDLE_STORE).get("directory");
			req.onsuccess = () => resolve(req.result);
			req.onerror = () => reject(req.error);
		});
	}
	async function clearHandleFromIndexedDB() {
		const db = await openHandleDB();
		return new Promise((resolve, reject) => {
			const tx = db.transaction(HANDLE_STORE, "readwrite");
			tx.objectStore(HANDLE_STORE).delete("directory");
			tx.oncomplete = () => resolve();
			tx.onerror = () => reject(tx.error);
		});
	}
if (!window.__IS_EXTENSION__) {
	const SESSION_PREFIX = 'session:';
	const BrowserStorage = {
		_db: null,
		_operationQueue: Promise.resolve(),
		_enqueue(operation) {
			const result = this._operationQueue.then(operation, operation);
			this._operationQueue = result.catch(() => {});
			return result;
		},
		async _getDB() {
			if (this._db) return this._db;
			return new Promise((resolve, reject) => {
				const request = indexedDB.open('kuai-lian-ai-browser', 1);
				request.onupgradeneeded = e => {
					const db = e.target.result;
					if (!db.objectStoreNames.contains('store')) db.createObjectStore('store');
				};
				request.onsuccess = () => {
					this._db = request.result;
					resolve(this._db);
				};
				request.onerror = () => reject(request.error);
			});
		},
		async _get(key) {
			const db = await this._getDB();
			return new Promise((resolve, reject) => {
				const tx = db.transaction('store', 'readonly');
				const req = tx.objectStore('store').get(key);
				req.onsuccess = () => resolve(req.result);
				req.onerror = () => reject(req.error);
			});
		},
		async _set(key, value) {
			const db = await this._getDB();
			return new Promise((resolve, reject) => {
				const tx = db.transaction('store', 'readwrite');
				tx.objectStore('store').put(value, key);
				tx.oncomplete = () => resolve();
				tx.onerror = () => reject(tx.error);
			});
		},
		async _delete(key) {
			const db = await this._getDB();
			return new Promise((resolve, reject) => {
				const tx = db.transaction('store', 'readwrite');
				tx.objectStore('store').delete(key);
				tx.oncomplete = () => resolve();
				tx.onerror = () => reject(tx.error);
			});
		},
		async _loadEndpointsNow() {
			return await this._get('endpoints') || {
				nodes: []
			};
		},
		async loadEndpoints() {
			return this._enqueue(() => this._loadEndpointsNow());
		},
		async _saveEndpointsNow(data) {
			await this._set('endpoints', data);
			return true;
		},
		async saveEndpoints(data) {
			return this._enqueue(() => this._saveEndpointsNow(data));
		},
		async _entries() {
			const db = await this._getDB();
			return new Promise((resolve, reject) => {
				const tx = db.transaction('store', 'readonly');
				const req = tx.objectStore('store').openCursor();
				const entries = [];
				req.onsuccess = () => {
					const cursor = req.result;
					if (!cursor) {
						resolve(entries);
						return;
					}
					entries.push([cursor.key, cursor.value]);
					cursor.continue();
				};
				req.onerror = () => reject(req.error);
			});
		},
		async _migrateLegacySessionsNow() {
			const legacy = await this._get('sessions');
			if (!legacy || typeof legacy !== 'object') return;
			for (const [id, session] of Object.entries(legacy)) {
				const key = SESSION_PREFIX + id;
				if (await this._get(key)) continue;
				if (!await this._get(key)) await this._set(key, session);
			}
			await this._delete('sessions');
		},
		async _migrateLegacySessions() {
			return this._enqueue(() => this._migrateLegacySessionsNow());
		},
		async _loadSessionsNow() {
			await this._migrateLegacySessionsNow();
			const entries = await this._entries();
			return entries
				.filter(([key]) => key.startsWith(SESSION_PREFIX))
				.map(([, session]) => session)
				.sort((a, b) => {
					const ta = a.updatedAt || a.createdAt || 0;
					const tb = b.updatedAt || b.createdAt || 0;
					return tb - ta;
				});
		},
		async loadSessions() {
			return this._enqueue(() => this._loadSessionsNow());
		},
		async _loadSessionNow(sessionId) {
			await this._migrateLegacySessionsNow();
			return await this._get(SESSION_PREFIX + sessionId) || null;
		},
		async loadSession(sessionId) {
			return this._enqueue(() => this._loadSessionNow(sessionId));
		},
		async _saveSessionNow(session) {
			await this._migrateLegacySessionsNow();
			await this._set(SESSION_PREFIX + session.id, session);
		},
		async saveSession(session) {
			return this._enqueue(() => this._saveSessionNow(session));
		},
		async _deleteSessionNow(sessionId) {
			await this._migrateLegacySessionsNow();
			await this._delete(SESSION_PREFIX + sessionId);
		},
		async deleteSession(sessionId) {
			return this._enqueue(() => this._deleteSessionNow(sessionId));
		},
		async _loadSettingsNow() {
			return await this._get('settings') || {};
		},
		async loadSettings() {
			return this._enqueue(() => this._loadSettingsNow());
		},
		async _saveSettingsNow(settings) {
			await this._set('settings', settings);
		},
		async saveSettings(settings) {
			return this._enqueue(() => this._saveSettingsNow(settings));
		},
		async _exportAllNow() {
			await this._migrateLegacySessionsNow();
			const entries = await this._entries();
			const sessions = entries
				.filter(([key]) => key.startsWith(SESSION_PREFIX))
				.map(([, session]) => session);
			return {
				endpoints: await this._get('endpoints') || { nodes: [] },
				sessions: Object.fromEntries(sessions.map(session => [session.id, session])),
				settings: await this._get('settings') || {},
				exportedAt: Date.now()
			};
		},
		async exportAll() {
			return this._enqueue(() => this._exportAllNow());
		},
		async _importAllNow(data) {
			if (!data || typeof data !== 'object') throw new Error('无效');
			await this._migrateLegacySessionsNow();
			await this._set('endpoints', data.endpoints || { nodes: [] });
			const sessions = Array.isArray(data.sessions)
				? data.sessions
				: Object.values(data.sessions || {});
			const importedIds = new Set();
			for (const session of sessions) {
				importedIds.add(String(session.id));
				await this._set(SESSION_PREFIX + session.id, session);
			}
			const entries = await this._entries();
			for (const [key] of entries) {
				if (key.startsWith(SESSION_PREFIX) && !importedIds.has(key.slice(SESSION_PREFIX.length))) {
					await this._delete(key);
				}
			}
			if (data.settings) await this._set('settings', data.settings);
		},
		async importAll(data) {
			return this._enqueue(async () => {
				const snapshot = await this._exportAllNow();
				try {
					await this._importAllNow(data);
				} catch (error) {
					try {
						await this._importAllNow(snapshot);
					} catch (rollbackError) {
						throw new AggregateError([error, rollbackError], '浏览器导入失败且回滚失败', { cause: error });
					}
					throw error;
				}
			});
		},
		async _clearAllNow(checkpoint) {
			await this._delete('endpoints');
			await this._delete('sessions');
			await this._delete('settings');
			for (const [key] of checkpoint) {
				if (key.startsWith(SESSION_PREFIX)) await this._delete(key);
			}
		},
		async _restoreClearCheckpointNow(checkpoint) {
			const checkpointKeys = new Set(checkpoint.map(([key]) => key));
			const currentEntries = await this._entries();
			for (const [key] of currentEntries) {
				if (!checkpointKeys.has(key)) await this._delete(key);
			}
			for (const [key, value] of checkpoint) await this._set(key, value);
		},
		async clearAll() {
			return this._enqueue(async () => {
				const checkpoint = await this._entries();
				try {
					await this._clearAllNow(checkpoint);
				} catch (error) {
					try {
						await this._restoreClearCheckpointNow(checkpoint);
					} catch (rollbackError) {
						throw new AggregateError([error, rollbackError], '浏览器清空失败且回滚失败', { cause: error });
					}
					throw error;
				}
			});
		}
	};

	const DirectoryStorage = {
		_operationQueue: Promise.resolve(),
		_enqueue(operation) {
			const result = this._operationQueue.then(operation, operation);
			this._operationQueue = result.catch(() => {});
			return result;
		},
		async _loadEndpointsNow() {
			if (!directoryHandle) return {
				groups: []
			};
			try {
				const fileHandle = await directoryHandle.getFileHandle('endpoints.json', {
					create: true
				});
				const file = await fileHandle.getFile();
				const text = await file.text();
				return text ? JSON.parse(text) : {
					nodes: []
				};
			} catch (err) {
				console.error('加载端点失败:', err);
				return {
					nodes: []
				};
			}
		},
		async loadEndpoints() {
			return this._enqueue(() => this._loadEndpointsNow());
		},
		async _saveEndpointsNow(data) {
			if (!directoryHandle) throw new Error('未选择存储目录');
			const fileHandle = await directoryHandle.getFileHandle('endpoints.json', {
				create: true
			});
			const writable = await fileHandle.createWritable();
			try {
				await writable.write(JSON.stringify(data, null, 2));
				await writable.close();
			} catch (error) {
				await writable.abort?.().catch(() => {});
				throw error;
			}
		},
		async saveEndpoints(data) {
			return this._enqueue(() => this._saveEndpointsNow(data));
		},
		async _loadSessionsNow() {
			if (!directoryHandle) return [];
			try {
				const sessionsDir = await directoryHandle.getDirectoryHandle('sessions');
				const sessions = [];
				for await (const handle of sessionsDir.values()) {
					if (handle.kind === 'file' && handle.name.endsWith('.json')) {
						try {
							const file = await handle.getFile();
							sessions.push(JSON.parse(await file.text()));
						} catch (e) {}
					}
				}
				return sessions;
			} catch (err) {
				if (err.name === 'NotFoundError') return [];
				return [];
			}
		},
		async loadSessions() {
			return this._enqueue(() => this._loadSessionsNow());
		},
		async _loadSessionNow(sessionId) {
			if (!directoryHandle) return null;
			try {
				const sessionsDir = await directoryHandle.getDirectoryHandle('sessions');
				const fileHandle = await sessionsDir.getFileHandle(sessionId + '.json');
				const file = await fileHandle.getFile();
				return JSON.parse(await file.text());
			} catch (err) {
				return null;
			}
		},
		async loadSession(sessionId) {
			return this._enqueue(() => this._loadSessionNow(sessionId));
		},
		async _saveSessionNow(session) {
			if (!directoryHandle) throw new Error('未选择存储目录');
			const sessionsDir = await directoryHandle.getDirectoryHandle('sessions', {
				create: true
			});
			const fileHandle = await sessionsDir.getFileHandle(session.id + '.json', {
				create: true
			});
			const writable = await fileHandle.createWritable();
			try {
				await writable.write(JSON.stringify(session, null, 2));
				await writable.close();
			} catch (error) {
				await writable.abort?.().catch(() => {});
				throw error;
			}
		},
		async saveSession(session) {
			return this._enqueue(() => this._saveSessionNow(session));
		},
		async _deleteSessionNow(sessionId) {
			if (!directoryHandle) throw new Error('未选择存储目录');
			try {
				const sessionsDir = await directoryHandle.getDirectoryHandle('sessions');
				await sessionsDir.removeEntry(sessionId + '.json');
			} catch (error) {
				if (error.name !== 'NotFoundError') throw error;
			}
		},
		async deleteSession(sessionId) {
			return this._enqueue(() => this._deleteSessionNow(sessionId));
		},
		async _loadSettingsNow() {
			return {};
		},
		async loadSettings() {
			return this._enqueue(() => this._loadSettingsNow());
		},
		async _saveSettingsNow(settings) {},
		async saveSettings(settings) {
			return this._enqueue(() => this._saveSettingsNow(settings));
		},
		async _exportAllNow() {
			return {
				endpoints: await this._loadEndpointsNow(),
				sessions: await this._loadSessionsNow(),
				settings: await this._loadSettingsNow(),
				exportedAt: Date.now()
			};
		},
		async exportAll() {
			return this._enqueue(() => this._exportAllNow());
		},
		async _readRawFileNow(parentHandle, name) {
			try {
				const fileHandle = await parentHandle.getFileHandle(name);
				const file = await fileHandle.getFile();
				const bytes = await file.arrayBuffer();
				return { exists: true, bytes: bytes.slice(0) };
			} catch (error) {
				if (error.name === 'NotFoundError') return { exists: false };
				throw error;
			}
		},
		async _writeRawFileNow(parentHandle, name, bytes) {
			const fileHandle = await parentHandle.getFileHandle(name, { create: true });
			const writable = await fileHandle.createWritable();
			try {
				await writable.write(bytes);
				await writable.close();
			} catch (error) {
				await writable.abort?.().catch(() => {});
				throw error;
			}
		},
		async _checkpointImportNow() {
			if (!directoryHandle) throw new Error('未选择目录');
			const endpoints = await this._readRawFileNow(directoryHandle, 'endpoints.json');
			const sessions = [];
			try {
				const sessionsDir = await directoryHandle.getDirectoryHandle('sessions');
				for await (const handle of sessionsDir.values()) {
					if (handle.kind !== 'file' || !handle.name.endsWith('.json')) continue;
					const file = await handle.getFile();
					const bytes = await file.arrayBuffer();
					sessions.push({ name: handle.name, bytes: bytes.slice(0) });
				}
			} catch (error) {
				if (error.name !== 'NotFoundError') throw error;
			}
			return { endpoints, sessions };
		},
		_checkpointImport() {
			return this._enqueue(() => this._checkpointImportNow());
		},
		async _restoreImportCheckpointNow(checkpoint) {
			if (!directoryHandle) throw new Error('未选择目录');
			if (checkpoint.endpoints.exists) {
				await this._writeRawFileNow(directoryHandle, 'endpoints.json', checkpoint.endpoints.bytes);
			} else {
				try {
					await directoryHandle.removeEntry('endpoints.json');
				} catch (error) {
					if (error.name !== 'NotFoundError') throw error;
				}
			}
			let sessionsDir;
			try {
				sessionsDir = await directoryHandle.getDirectoryHandle('sessions');
			} catch (error) {
				if (error.name !== 'NotFoundError') throw error;
				if (!checkpoint.sessions.length) return;
				sessionsDir = await directoryHandle.getDirectoryHandle('sessions', { create: true });
			}
			const currentSessionNames = [];
			for await (const handle of sessionsDir.values()) {
				if (handle.kind === 'file' && handle.name.endsWith('.json')) currentSessionNames.push(handle.name);
			}
			const checkpointSessionNames = new Set(checkpoint.sessions.map(session => session.name));
			for (const session of checkpoint.sessions) {
				await this._writeRawFileNow(sessionsDir, session.name, session.bytes);
			}
			for (const name of currentSessionNames) {
				if (!checkpointSessionNames.has(name)) await sessionsDir.removeEntry(name);
			}
		},
		_restoreImportCheckpoint(checkpoint) {
			return this._enqueue(() => this._restoreImportCheckpointNow(checkpoint));
		},
		async _importAllNow(data) {
			if (!directoryHandle) throw new Error('未选择目录');
			if (data.endpoints) await this._saveEndpointsNow(data.endpoints);
			const sessions = Array.isArray(data.sessions)
				? data.sessions
				: Object.values(data.sessions || {});
			const importedIds = new Set();
			for (const session of sessions) {
				importedIds.add(String(session.id));
				await this._saveSessionNow(session);
			}
			let sessionsDir;
			try {
				sessionsDir = await directoryHandle.getDirectoryHandle('sessions');
			} catch (error) {
				if (error.name === 'NotFoundError') return;
				throw error;
			}
			for await (const handle of sessionsDir.values()) {
				if (handle.kind !== 'file' || !handle.name.endsWith('.json')) continue;
				const id = handle.name.slice(0, -5);
				if (!importedIds.has(id)) await sessionsDir.removeEntry(handle.name);
			}
		},
		async importAll(data) {
			return this._enqueue(async () => {
				const checkpoint = await this._checkpointImportNow();
				try {
					await this._importAllNow(data);
				} catch (error) {
					try {
						await this._restoreImportCheckpointNow(checkpoint);
					} catch (rollbackError) {
						throw new AggregateError([error, rollbackError], '目录导入失败且回滚失败', { cause: error });
					}
					throw error;
				}
			});
		},
		async _checkpointClearDirectoryNow(parentHandle, path = '') {
			const entries = [];
			for await (const handle of parentHandle.values()) {
				const currentPath = path + handle.name;
				if (handle.kind === 'file') {
					const file = await handle.getFile();
					const bytes = await file.arrayBuffer();
					entries.push({ kind: 'file', path: currentPath, bytes: bytes.slice(0) });
				} else if (handle.kind === 'directory') {
					entries.push({ kind: 'directory', path: currentPath });
					entries.push(...await this._checkpointClearDirectoryNow(handle, currentPath + '/'));
				}
			}
			return entries;
		},
		async _checkpointClearNow() {
			if (!directoryHandle) return null;
			const endpoints = await this._readRawFileNow(directoryHandle, 'endpoints.json');
			let sessions = [];
			try {
				const sessionsDir = await directoryHandle.getDirectoryHandle('sessions');
				if (sessionsDir.values) sessions = await this._checkpointClearDirectoryNow(sessionsDir, 'sessions/');
				sessions.unshift({ kind: 'directory', path: 'sessions' });
			} catch (error) {
				if (error.name !== 'NotFoundError') throw error;
			}
			return { endpoints, sessions };
		},
		async _restoreClearCheckpointNow(checkpoint) {
			if (!directoryHandle) return;
			if (checkpoint.endpoints.exists) {
				await this._writeRawFileNow(directoryHandle, 'endpoints.json', checkpoint.endpoints.bytes);
			} else {
				try {
					await directoryHandle.removeEntry('endpoints.json');
				} catch (error) {
					if (error.name !== 'NotFoundError') throw error;
				}
			}
			let currentSessions = [];
			try {
				const sessionsDir = await directoryHandle.getDirectoryHandle('sessions');
				if (sessionsDir.values) currentSessions = await this._checkpointClearDirectoryNow(sessionsDir, 'sessions/');
			} catch (error) {
				if (error.name !== 'NotFoundError') throw error;
			}
			const checkpointPaths = new Set(checkpoint.sessions.map(entry => entry.path));
			if (!checkpoint.sessions.length) {
				try {
					await directoryHandle.removeEntry('sessions', { recursive: true });
				} catch (error) {
					if (error.name !== 'NotFoundError') throw error;
				}
				return;
			}
			if (currentSessions.some(entry => !checkpointPaths.has(entry.path))) {
				await directoryHandle.removeEntry('sessions', { recursive: true });
			}
			await directoryHandle.getDirectoryHandle('sessions', { create: true });
			for (const entry of checkpoint.sessions.filter(entry => entry.kind === 'directory' && entry.path !== 'sessions').sort((left, right) => left.path.length - right.path.length)) {
				let parentHandle = directoryHandle;
				for (const part of entry.path.split('/')) parentHandle = await parentHandle.getDirectoryHandle(part, { create: true });
			}
			for (const entry of checkpoint.sessions.filter(entry => entry.kind === 'file')) {
				const parts = entry.path.split('/');
				const name = parts.pop();
				let parentHandle = directoryHandle;
				for (const part of parts) parentHandle = await parentHandle.getDirectoryHandle(part, { create: true });
				await this._writeRawFileNow(parentHandle, name, entry.bytes);
			}
		},
		async _clearAllNow() {
			if (!directoryHandle) return;
			try {
				await directoryHandle.removeEntry('endpoints.json');
			} catch (error) {
				if (error.name !== 'NotFoundError') throw error;
			}
			try {
				await directoryHandle.removeEntry('sessions', { recursive: true });
			} catch (error) {
				if (error.name !== 'NotFoundError') throw error;
			}
		},
		async clearAll() {
			return this._enqueue(async () => {
				if (!directoryHandle) return;
				const checkpoint = await this._checkpointClearNow();
				try {
					await this._clearAllNow();
				} catch (error) {
					try {
						await this._restoreClearCheckpointNow(checkpoint);
					} catch (rollbackError) {
						throw new AggregateError([error, rollbackError], '目录清空失败且回滚失败', { cause: error });
					}
					throw error;
				}
			});
		},
		getDirectoryName() {
			return directoryHandle ? directoryHandle.name : null;
		},
		async restoreHandle() {
			try {
				const savedHandle = await loadHandleFromIndexedDB();
				if (!savedHandle) return false;
				const perm = await savedHandle.queryPermission({
					mode: 'readwrite'
				});
				if (perm !== 'granted') {
					const req = await savedHandle.requestPermission({
						mode: 'readwrite'
					});
					if (req !== 'granted') {
						await clearHandleFromIndexedDB();
						return false;
					}
				}
				directoryHandle = savedHandle;
				return true;
			} catch (e) {
				return false;
			}
		},
		async pickAndSave() {
			let handle;
			try {
				handle = await window.showDirectoryPicker({
					mode: 'readwrite'
				});
			} catch (error) {
				if (error.name === 'AbortError') return false;
				throw error;
			}
			await saveHandleToIndexedDB(handle);
			directoryHandle = handle;
			return true;
		},
		async _setHandle(handle) {
			directoryHandle = handle;
			await saveHandleToIndexedDB(handle);
		},
		_snapshotHandle() {
			return directoryHandle;
		},
		async _snapshotHandleState() {
			return {
				activeHandle: directoryHandle,
				persistedHandle: await loadHandleFromIndexedDB()
			};
		},
		_setActiveHandle(handle) {
			directoryHandle = handle;
		},
		async _restoreHandle(handle) {
			directoryHandle = handle;
			if (handle) await saveHandleToIndexedDB(handle);
			else await clearHandleFromIndexedDB();
		},
		async _restoreHandleState({ activeHandle, persistedHandle }) {
			if (persistedHandle) await saveHandleToIndexedDB(persistedHandle);
			else await clearHandleFromIndexedDB();
			directoryHandle = activeHandle;
		},
		async release() {
			const previousHandle = directoryHandle;
			try {
				await clearHandleFromIndexedDB();
				directoryHandle = null;
			} catch (error) {
				directoryHandle = previousHandle;
				throw error;
			}
		}
	};
	// 统一存储接口
	currentMode = null;

	function getBackend() {
		return currentMode === 'directory' ? DirectoryStorage : BrowserStorage;
	}
	storage = {
		_modeQueue: Promise.resolve(),
		_enqueueModeOperation(operation) {
			const result = this._modeQueue.then(operation, operation);
			this._modeQueue = result.catch(() => {});
			return result;
		},
		get mode() {
			return currentMode;
		},
		async init() {
			return this._enqueueModeOperation(() => this._initNow());
		},
		async _initNow() {
			let savedMode = null;
			try {
				savedMode = await BrowserStorage._get('__mode');
			} catch (e) {}
			if (savedMode === 'directory') {
				const ok = await DirectoryStorage.restoreHandle();
				if (ok) {
					currentMode = 'directory';
					return {
						mode: 'directory',
						needUserAction: false
					};
				}
				currentMode = 'browser';
				await this._saveModePref();
				return {
					mode: 'browser',
					needUserAction: false
				};
			}
			if (savedMode === 'browser') {
				currentMode = 'browser';
				return {
					mode: 'browser',
					needUserAction: false
				};
			}
			return {
				mode: null,
				needUserAction: true
			};
		},
		async selectMode(mode, handle) {
			return this._enqueueModeOperation(() => this._selectModeNow(mode, handle));
		},
		async _selectModeNow(mode, handle) {
			const previousMode = currentMode;
			const previousHandleState = await DirectoryStorage._snapshotHandleState();
			try {
				if (mode === 'directory') {
					if (handle) {
						await DirectoryStorage._setHandle(handle);
					} else {
						const ok = await DirectoryStorage.pickAndSave();
						if (!ok) return false;
					}
				}
				currentMode = mode;
				await this._saveModePref();
				return true;
			} catch (error) {
				currentMode = previousMode;
				try {
					await DirectoryStorage._restoreHandleState(previousHandleState);
					await this._saveModePref();
				} catch (rollbackError) {
					throw new AggregateError([error, rollbackError], '选择存储模式失败且回滚失败', { cause: error });
				}
				throw error;
			}
		},
		async switchMode(target, handle) {
			return this._enqueueModeOperation(() => this._switchModeNow(target, handle));
		},
		async _switchModeNow(target, handle) {
			if (target === currentMode) return true;
			const oldMode = currentMode;
			const oldHandleState = await DirectoryStorage._snapshotHandleState();
			const data = await getBackend()._exportAllNow();
			let targetBackend, directoryTarget, targetSnapshot;
			try {
				if (target === 'directory') {
					if (handle) await DirectoryStorage._setHandle(handle);
					else if (!await DirectoryStorage.pickAndSave()) return false;
				}
				currentMode = target;
				targetBackend = getBackend();
				directoryTarget = targetBackend === DirectoryStorage;
				targetSnapshot = directoryTarget
					? await DirectoryStorage._checkpointImportNow()
					: await targetBackend._exportAllNow();
				if (directoryTarget) await DirectoryStorage._importAllNow(data);
				else await targetBackend._importAllNow(data);
				await this._saveModePref();
				if (oldMode === 'directory') await DirectoryStorage.release();
				return true;
			} catch (error) {
				const rollbackErrors = [];
				if (targetSnapshot) {
					try {
						if (directoryTarget) await DirectoryStorage._restoreImportCheckpointNow(targetSnapshot);
						else await targetBackend._importAllNow(targetSnapshot);
					} catch (rollbackError) {
						rollbackErrors.push(rollbackError);
					}
				}
				currentMode = oldMode;
				try {
					await DirectoryStorage._restoreHandleState(oldHandleState);
				} catch (rollbackError) {
					rollbackErrors.push(rollbackError);
				}
				try {
					await this._saveModePref();
				} catch (rollbackError) {
					rollbackErrors.push(rollbackError);
				}
				if (rollbackErrors.length) {
					throw new AggregateError([error, ...rollbackErrors], '模式切换失败且回滚失败', { cause: error });
				}
				throw error;
			}
		},
		async _saveModePref() {
			await BrowserStorage._set('__mode', currentMode);
		},
		async _clearModePref() {
			await BrowserStorage._delete('__mode');
		},
		async disconnectDirectory() {
			return this._enqueueModeOperation(() => this._disconnectDirectoryNow());
		},
		async _disconnectDirectoryNow() {
			if (currentMode !== 'directory') return;
			const previousHandle = DirectoryStorage._snapshotHandle();
			try {
				await DirectoryStorage.release();
				currentMode = null;
				await this._clearModePref();
			} catch (error) {
				currentMode = 'directory';
				try {
					await DirectoryStorage._restoreHandle(previousHandle);
					await this._saveModePref();
				} catch (rollbackError) {
					throw new AggregateError([error, rollbackError], '解除目录失败且回滚失败', { cause: error });
				}
				throw error;
			}
		},
		async activateRestoredDirectory() {
			return this._enqueueModeOperation(() => this._activateRestoredDirectoryNow());
		},
		async _activateRestoredDirectoryNow() {
			const previousMode = currentMode;
			const previousHandle = DirectoryStorage._snapshotHandle();
			const restored = await DirectoryStorage.restoreHandle();
			if (!restored) return false;
			try {
				currentMode = 'directory';
				await this._saveModePref();
				return true;
			} catch (error) {
				currentMode = previousMode;
				try {
					if (previousHandle) await DirectoryStorage._restoreHandle(previousHandle);
					else DirectoryStorage._setActiveHandle(null);
					await this._saveModePref();
				} catch (rollbackError) {
					throw new AggregateError([error, rollbackError], '恢复目录失败且回滚失败', { cause: error });
				}
				throw error;
			}
		},
		async loadEndpoints() {
			return this._enqueueModeOperation(() => getBackend()._loadEndpointsNow());
		},
		async saveEndpoints(data) {
			return this._enqueueModeOperation(() => getBackend()._saveEndpointsNow(data));
		},
		async loadSessions() {
			return this._enqueueModeOperation(() => getBackend()._loadSessionsNow());
		},
		async loadSession(id) {
			return this._enqueueModeOperation(() => getBackend()._loadSessionNow(id));
		},
		async saveSession(session) {
			return this._enqueueModeOperation(() => getBackend()._saveSessionNow(session));
		},
		async deleteSession(id) {
			return this._enqueueModeOperation(() => getBackend()._deleteSessionNow(id));
		},
		async loadSettings() {
			return this._enqueueModeOperation(() => getBackend()._loadSettingsNow());
		},
		async saveSettings(s) {
			return this._enqueueModeOperation(() => getBackend()._saveSettingsNow(s));
		},
		async clearAll() {
			return this._enqueueModeOperation(() => getBackend().clearAll());
		},
		async exportAll() {
			return this._enqueueModeOperation(() => getBackend()._exportAllNow());
		},
		async importAll(data) {
			return this._enqueueModeOperation(() => getBackend()._importAllNow(data));
		},
		async hasSavedHandle() {
			try {
				return !!(await loadHandleFromIndexedDB());
			} catch {
				return false;
			}
		},
		async restoreDirectory() {
			return this._enqueueModeOperation(() => this._restoreDirectoryNow());
		},
		async _restoreDirectoryNow() {
			return DirectoryStorage.restoreHandle();
		},
		getDirectoryName() {
			return currentMode === 'directory' ? DirectoryStorage.getDirectoryName() : null;
		},
		getDisplayInfo() {
			if (currentMode === 'directory') {
				const name = DirectoryStorage.getDirectoryName();
				return {
					text: name || '未选择',
					title: '目录存储: ' + (name || '')
				};
			}
			return {
				text: '浏览器存储',
				title: '存储位置: 浏览器内部 (IndexedDB)'
			};
		}
	};
} else {
	storage = window.__STORAGE__;
	currentMode = storage.mode;
}
if (!window.__IS_EXTENSION__) {
	window.__STORAGE__ = storage;
}
const THINKING_TAGS = [{
	start: '<thinking>',
	end: '</thinking>'
}, {
	start: '<think>',
	end: '</think>'
}];
