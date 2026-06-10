// 扩展环境检测 + 按需适配
(function() {
	const isExt = typeof chrome !== 'undefined' && chrome.storage && chrome.runtime && chrome.runtime.id;
	window.__IS_EXTENSION__ = isExt;
	if (isExt) {
		// 移除 Google Fonts（CSP 禁止外部字体）
		const gf = document.getElementById('google-fonts');
		if (gf) gf.remove();
	} else {
		// 非扩展环境：动态注入 Google Fonts
		const s = document.createElement('style');
		s.id = 'google-fonts';
		s.textContent = '@import url('
		https: //fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700&display=swap');';
			document.head.appendChild(s);
	}
})();

