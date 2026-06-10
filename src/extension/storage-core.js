// 快连AI 统一存储模块
// 支持两种模式：「浏览器存储」和「目录存储」
// 暴露 window.__STORAGE__

(function() {
	'use strict';

	const isChromeExtension = typeof chrome !== 'undefined' && chrome.storage && chrome.runtime && chrome.runtime.id;

	// ================================================================
	//  BrowserStorage：浏览器存储（chrome.storage 或 IndexedDB）
	// ================================================================

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
				request.onsuccess = () => { this._db = request.result; resolve(this._db); };
				request.onerror = () => reject(request.error);
			});
		},

		async _get(key) {
			if (isChromeExtension) {
				const result = await chrome.storage.local.get(key);
				return result[key];
			}
			const db = await this._getDB();
			return new Promise((resolve, reject) => {
				const tx = db.transaction('store', 'readonly');
				const req = tx.objectStore('store').get(key);
				req.onsuccess = () => resolve(req.result);
				req.onerror = () => reject(req.error);
			});
		},

		async _set(key, value) {
			if (isChromeExtension) {
				await chrome.storage.local.set({ [key]: value });
				return;
			}
			const db = await this._getDB();
			return new Promise((resolve, reject) => {
				const tx = db.transaction('store', 'readwrite');
				tx.objectStore('store').put(value, key);
				tx.oncomplete = () => resolve();
				tx.onerror = () => reject(tx.error);
			});
		},

		async _delete(key) {
			if (isChromeExtension) {
				await chrome.storage.local.remove(key);
				return;
			}
			const db = await this._getDB();
			return new Promise((resolve, reject) => {
				const tx = db.transaction('store', 'readwrite');
				tx.objectStore('store').delete(key);
				tx.oncomplete = () => resolve();
				tx.onerror = () => reject(tx.error);
			});
		},

		async _getAll() {
			if (isChromeExtension) {
				const result = await chrome.storage.local.get(null);
				return result;
			}
			const db = await this._getDB();
			return new Promise((resolve, reject) => {
				const tx = db.transaction('store', 'readonly');
				const req = tx.objectStore('store').getAllKeys();
				const result = {};
				req.onsuccess = async () => {
					const keys = req.result;
					for (const key of keys) {
						result[key] = await this._get(key);
					}
					resolve(result);
				};
				req.onerror = () => reject(req.error);
			});
		},

		// ---- 端点 ----
		async loadEndpoints() {
			return await this._get('endpoints') || { groups: [] };
		},

		async saveEndpoints(data) {
			await this._set('endpoints', data);
			return true;
		},

		// ---- 会话 ----
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

		// ---- 设置 ----
		async loadSettings() {
			return await this._get('settings') || {};
		},

		async saveSettings(settings) {
			await this._set('settings', settings);
		},

		// ---- 导出/导入 ----
		async exportAll() {
			return {
				endpoints: await this._get('endpoints') || { groups: [] },
				sessions: await this._get('sessions') || {},
				settings: await this._get('settings') || {},
				exportedAt: Date.now()
			};
		},

		async importAll(data) {
			if (!data || typeof data !== 'object') throw new Error('无效的导入数据');
			await this._set('endpoints', data.endpoints || { groups: [] });
			await this._set('sessions', data.sessions || {});
			if (data.settings) await this._set('settings', data.settings);
		},

		async clearAll() {
			await this._delete('endpoints');
			await this._delete('sessions');
			await this._delete('settings');
		}
	};

	// ================================================================
	//  DirectoryStorage：目录存储（File System Access API）
	// ================================================================

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
			const tx = db.transaction(HANDLE_STORE, 'readwrite');
			const store = tx.objectStore(HANDLE_STORE);
			store.put(handle, 'directory');
			tx.oncomplete = () => resolve();
			tx.onerror = () => reject(tx.error);
		});
	}

	async function loadHandleFromIndexedDB() {
		const db = await openHandleDB();
		return new Promise((resolve, reject) => {
			const tx = db.transaction(HANDLE_STORE, 'readonly');
			const req = tx.objectStore(HANDLE_STORE).get('directory');
			req.onsuccess = () => resolve(req.result);
			req.onerror = () => reject(req.error);
		});
	}

	async function clearHandleFromIndexedDB() {
		const db = await openHandleDB();
		return new Promise((resolve, reject) => {
			const tx = db.transaction(HANDLE_STORE, 'readwrite');
			tx.objectStore(HANDLE_STORE).delete('directory');
			tx.oncomplete = () => resolve();
			tx.onerror = () => reject(tx.error);
		});
	}

	const DirectoryStorage = {
		async _requireDir() {
			if (directoryHandle) return directoryHandle;
			throw new Error('目录未选择');
		},

		// ---- 端点 ----
		async loadEndpoints() {
			if (!directoryHandle) return { groups: [] };
			try {
				const fileHandle = await directoryHandle.getFileHandle('endpoints.json', { create: true });
				const file = await fileHandle.getFile();
				const text = await file.text();
				return text ? JSON.parse(text) : { groups: [] };
			} catch (err) {
				console.error('加载端点配置失败:', err);
				return { groups: [] };
			}
		},

		async saveEndpoints(data) {
			if (!directoryHandle) return false;
			try {
				const fileHandle = await directoryHandle.getFileHandle('endpoints.json', { create: true });
				const writable = await fileHandle.createWritable();
				await writable.write(JSON.stringify(data, null, 2));
				await writable.close();
				return true;
			} catch (err) {
				console.error('保存端点配置失败:', err);
				return false;
			}
		},

		// ---- 会话 ----
		async loadSessions() {
			if (!directoryHandle) return [];
			try {
				const sessionsDir = await directoryHandle.getDirectoryHandle('sessions');
				const sessions = [];
				for await (const handle of sessionsDir.values()) {
					if (handle.kind === 'file' && handle.name.endsWith('.json')) {
						try {
							const file = await handle.getFile();
							const text = await file.text();
							sessions.push(JSON.parse(text));
						} catch (e) { console.warn('跳过损坏的会话文件:', handle.name, e); }
					}
				}
				return sessions;
			} catch (err) {
				if (err.name === 'NotFoundError') return [];
				console.error('加载会话索引失败:', err);
				return [];
			}
		},

		async loadSession(sessionId) {
			if (!directoryHandle) return null;
			try {
				const sessionsDir = await directoryHandle.getDirectoryHandle('sessions');
				const fileHandle = await sessionsDir.getFileHandle(`${sessionId}.json`);
				const file = await fileHandle.getFile();
				return JSON.parse(await file.text());
			} catch (err) {
				if (err.name === 'NotFoundError') return null;
				console.error('加载会话失败:', err);
				return null;
			}
		},

		async saveSession(session) {
			if (!directoryHandle) return false;
			try {
				const sessionsDir = await directoryHandle.getDirectoryHandle('sessions', { create: true });
				const fileHandle = await sessionsDir.getFileHandle(`${session.id}.json`, { create: true });
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
				await sessionsDir.removeEntry(`${sessionId}.json`);
				return true;
			} catch (err) {
				if (err.name === 'NotFoundError') return true;
				console.error('删除会话失败:', err);
				return false;
			}
		},

		// ---- 设置 ----
		async loadSettings() {
			return {}; // 目录模式暂不用独立设置文件
		},

		async saveSettings(settings) {
			// 目录模式暂不持久化设置
		},

		// ---- 导出/导入 ----
		async exportAll() {
			return {
				endpoints: await this.loadEndpoints(),
				sessions: await this.loadSessions(),
				settings: {},
				exportedAt: Date.now()
			};
		},

		async importAll(data) {
			if (!directoryHandle) throw new Error('未选择目录');
			if (data.endpoints) await this.saveEndpoints(data.endpoints);
			if (data.sessions) {
				for (const id in data.sessions) {
					await this.saveSession(data.sessions[id]);
				}
			}
		},

		async clearAll() {
			if (!directoryHandle) return;
			try { await directoryHandle.removeEntry('endpoints.json'); } catch (e) {}
			try { await directoryHandle.removeEntry('sessions', { recursive: true }); } catch (e) {}
		},

		// ---- 目录管理 ----
		getDirectoryName() {
			return directoryHandle ? directoryHandle.name : null;
		},

		async restoreHandle() {
			try {
				const savedHandle = await loadHandleFromIndexedDB();
				if (!savedHandle) return false;
				const perm = await savedHandle.queryPermission({ mode: 'readwrite' });
				if (perm === 'granted') {
					directoryHandle = savedHandle;
					return true;
				}
				const requested = await savedHandle.requestPermission({ mode: 'readwrite' });
				if (requested === 'granted') {
					directoryHandle = savedHandle;
					return true;
				}
				await clearHandleFromIndexedDB();
				return false;
			} catch (e) {
				console.error('恢复目录失败:', e);
				return false;
			}
		},

		async pickAndSave() {
			try {
				directoryHandle = await window.showDirectoryPicker({ mode: 'readwrite' });
				await saveHandleToIndexedDB(directoryHandle);
				return true;
			} catch (err) {
				if (err.name === 'AbortError') return false;
				console.error('选择目录失败:', err);
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

	// ================================================================
	//  存储接口
	// ================================================================

	let currentMode = null;

	function getBackend() {
		return currentMode === 'directory' ? DirectoryStorage : BrowserStorage;
	}

	const storage = {
		get mode() { return currentMode; },

		// 初始化：恢复上次模式
		async init() {
			// 读取模式偏好
			let savedMode = null;
			if (isChromeExtension) {
				const result = await chrome.storage.local.get('__mode');
				savedMode = result.__mode || null;
			} else {
				try {
					savedMode = await BrowserStorage._get('__mode');
				} catch (e) { /* IndexedDB 可能不可用 */ }
			}

			if (savedMode === 'directory') {
				// 尝试恢复目录（扩展页也是安全上下文，支持 File System Access API）
				const ok = await DirectoryStorage.restoreHandle();
				if (ok) {
					currentMode = 'directory';
					return { mode: 'directory', needUserAction: false };
				}
				// 恢复失败，降级到浏览器存储
				currentMode = 'browser';
				await this._saveModePref();
				return { mode: 'browser', needUserAction: false };
			}

			if (savedMode === 'browser') {
				currentMode = 'browser';
				return { mode: 'browser', needUserAction: false };
			}

			// 无历史记录，需要用户选择
			return { mode: null, needUserAction: true };
		},

		// 用户选择模式
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

		// 切换模式（带数据迁移）
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
				console.error('模式切换失败:', e);
				return false;
			}
		},

		async _saveModePref() {
			if (isChromeExtension) {
				await chrome.storage.local.set({ __mode: currentMode });
			} else {
				await BrowserStorage._set('__mode', currentMode);
			}
		},

		// 委托方法
		async loadEndpoints() { return getBackend().loadEndpoints(); },
		async saveEndpoints(data) { return getBackend().saveEndpoints(data); },
		async loadSessions() { return getBackend().loadSessions(); },
		async loadSession(id) { return getBackend().loadSession(id); },
		async saveSession(session) { return getBackend().saveSession(session); },
		async deleteSession(id) { return getBackend().deleteSession(id); },
		async loadSettings() { return getBackend().loadSettings(); },
		async saveSettings(s) { return getBackend().saveSettings(s); },
		async clearAll() { return getBackend().clearAll(); },
		async exportAll() { return getBackend().exportAll(); },
		async importAll(data) { return getBackend().importAll(data); },

		getDirectoryName() {
			return currentMode === 'directory' ? DirectoryStorage.getDirectoryName() : null;
		},

		getDisplayInfo() {
			if (currentMode === 'directory') {
				const name = DirectoryStorage.getDirectoryName();
				return { text: name || '未选择目录', title: '目录存储: ' + (name || '') };
			}
			return { text: '浏览器存储', title: '存储位置: 浏览器内部 (' + (isChromeExtension ? 'chrome.storage' : 'IndexedDB') + ')' };
		},

		// 检查是否已保存目录句柄
		async hasSavedHandle() {
			try {
				const handle = await loadHandleFromIndexedDB();
				return !!handle;
			} catch (e) {
				return false;
			}
		},

		// 尝试恢复已保存的目录句柄
		async restoreDirectory() {
			return await DirectoryStorage.restoreHandle();
		}
	};

	// 也暴露环境检测
	window.__IS_EXTENSION__ = isChromeExtension;

	// 暴露给 app.js
	window.__STORAGE__ = storage;
})();