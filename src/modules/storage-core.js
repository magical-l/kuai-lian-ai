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
	const BrowserStorage = {
		_db: null,
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
		async loadEndpoints() {
			return await this._get('endpoints') || {
				groups: []
			};
		},
		async saveEndpoints(data) {
			await this._set('endpoints', data);
			return true;
		},
		async loadSessions() {
			const sessions = await this._get('sessions') || {};
			return Object.values(sessions).sort((a, b) => {
				const ta = a.updatedAt || a.createdAt || 0;
				const tb = b.updatedAt || b.createdAt || 0;
				return tb - ta;
			});
		},
		async loadSession(sessionId) {
			const sessions = await this._get('sessions') || {};
			return sessions[sessionId] || null;
		},
		async saveSession(session) {
			const sessions = await this._get('sessions') || {};
			sessions[session.id] = session;
			await this._set('sessions', sessions);
			return true;
		},
		async deleteSession(sessionId) {
			const sessions = await this._get('sessions') || {};
			delete sessions[sessionId];
			await this._set('sessions', sessions);
			return true;
		},
		async loadSettings() {
			return await this._get('settings') || {};
		},
		async saveSettings(settings) {
			await this._set('settings', settings);
		},
		async exportAll() {
			return {
				endpoints: await this._get('endpoints') || {
					groups: []
				},
				sessions: await this._get('sessions') || {},
				settings: await this._get('settings') || {},
				exportedAt: Date.now()
			};
		},
		async importAll(data) {
			if (!data || typeof data !== 'object') throw new Error('无效');
			await this._set('endpoints', data.endpoints || {
				groups: []
			});
			await this._set('sessions', data.sessions || {});
			if (data.settings) await this._set('settings', data.settings);
		},
		async clearAll() {
			await this._delete('endpoints');
			await this._delete('sessions');
			await this._delete('settings');
		}
	};
	
	const DirectoryStorage = {
		async loadEndpoints() {
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
					groups: []
				};
			} catch (err) {
				console.error('加载端点失败:', err);
				return {
					groups: []
				};
			}
		},
		async saveEndpoints(data) {
			if (!directoryHandle) return false;
			try {
				const fileHandle = await directoryHandle.getFileHandle('endpoints.json', {
					create: true
				});
				const writable = await fileHandle.createWritable();
				await writable.write(JSON.stringify(data, null, 2));
				await writable.close();
				return true;
			} catch (err) {
				console.error('保存端点失败:', err);
				return false;
			}
		},
		async loadSessions() {
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
		async loadSession(sessionId) {
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
		async saveSession(session) {
			if (!directoryHandle) return false;
			try {
				const sessionsDir = await directoryHandle.getDirectoryHandle('sessions', {
					create: true
				});
				const fileHandle = await sessionsDir.getFileHandle(session.id + '.json', {
					create: true
				});
				const writable = await fileHandle.createWritable();
				await writable.write(JSON.stringify(session, null, 2));
				await writable.close();
				return true;
			} catch (err) {
				console.error('保存会话失败:', err);
				return false;
			}
		},
		async deleteSession(sessionId) {
			if (!directoryHandle) return false;
			try {
				const sessionsDir = await directoryHandle.getDirectoryHandle('sessions');
				await sessionsDir.removeEntry(sessionId + '.json');
				return true;
			} catch (err) {
				return err.name === 'NotFoundError';
			}
		},
		async loadSettings() {
			return {};
		},
		async saveSettings(settings) {},
		async exportAll() {
			return {
				endpoints: await this.loadEndpoints(),
				sessions: await this.loadSessions(),
				settings: {},
				exportedAt: Date.now()
			};
		},
		async importAll(data) {
			if (data.endpoints) await this.saveEndpoints(data.endpoints);
			if (data.sessions) {
				for (const id in data.sessions) {
					await this.saveSession(data.sessions[id]);
				}
			}
		},
		async clearAll() {
			if (!directoryHandle) return;
			try {
				await directoryHandle.removeEntry('endpoints.json');
			} catch (e) {}
			try {
				await directoryHandle.removeEntry('sessions', {
					recursive: true
				});
			} catch (e) {}
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
			try {
				directoryHandle = await window.showDirectoryPicker({
					mode: 'readwrite'
				});
				await saveHandleToIndexedDB(directoryHandle);
				return true;
			} catch (err) {
				return false;
			}
		},
		async _setHandle(handle) {
			directoryHandle = handle;
			await saveHandleToIndexedDB(handle);
		},
		async release() {
			directoryHandle = null;
			await clearHandleFromIndexedDB();
		}
	};
	// 统一存储接口
	currentMode = null;

	function getBackend() {
		return currentMode === 'directory' ? DirectoryStorage : BrowserStorage;
	}
	storage = {
		get mode() {
			return currentMode;
		},
		async init() {
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
		},
		async switchMode(target, handle) {
			if (target === currentMode) return true;
			const data = await getBackend().exportAll();
			if (target === 'directory') {
				if (handle) {
					await DirectoryStorage._setHandle(handle);
				} else {
					const ok = await DirectoryStorage.pickAndSave();
					if (!ok) return false;
				}
			}
			const oldMode = currentMode;
			currentMode = target;
			try {
				await getBackend().importAll(data);
				await this._saveModePref();
				if (oldMode === 'directory') await DirectoryStorage.release();
				return true;
			} catch (e) {
				currentMode = oldMode;
				return false;
			}
		},
		async _saveModePref() {
			await BrowserStorage._set('__mode', currentMode);
		},
		async loadEndpoints() {
			return getBackend().loadEndpoints();
		},
		async saveEndpoints(data) {
			return getBackend().saveEndpoints(data);
		},
		async loadSessions() {
			return getBackend().loadSessions();
		},
		async loadSession(id) {
			return getBackend().loadSession(id);
		},
		async saveSession(session) {
			return getBackend().saveSession(session);
		},
		async deleteSession(id) {
			return getBackend().deleteSession(id);
		},
		async loadSettings() {
			return getBackend().loadSettings();
		},
		async saveSettings(s) {
			return getBackend().saveSettings(s);
		},
		async clearAll() {
			return getBackend().clearAll();
		},
		async exportAll() {
			return getBackend().exportAll();
		},
		async importAll(data) {
			return getBackend().importAll(data);
		},
		async hasSavedHandle() {
			try {
				return !!(await loadHandleFromIndexedDB());
			} catch {
				return false;
			}
		},
		async restoreDirectory() {
			return await DirectoryStorage.restoreHandle();
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
const THINKING_TAGS = [{
	start: '<thinking>',
	end: '</thinking>'
}, {
	start: '<think>',
	end: '</think>'
}];
