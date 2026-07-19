'use strict';

/**
 * 桌面壳桥接：
 * 1) 绘本导出打印：用全屏隐藏打印宿主，而不是 1×1 iframe（WebView2 下 1px 打印常失败）
 * 2) 文件保存：通过 chrome.webview.postMessage 交给原生壳「另存为」写入本地
 */
(function () {
  let requestSeq = 0;
  const pendingSaves = new Map();

  function ensurePrintHost() {
    let host = document.getElementById('studioPrintHost');
    if (host) return host;
    host = document.createElement('iframe');
    host.id = 'studioPrintHost';
    host.setAttribute('title', '绘本导出打印');
    host.setAttribute('aria-hidden', 'true');
    host.style.cssText = [
      'position:fixed',
      'left:0',
      'top:0',
      'width:100vw',
      'height:100vh',
      'border:0',
      'margin:0',
      'padding:0',
      'z-index:2147483000',
      'background:#fff',
      'opacity:0',
      'pointer-events:none'
    ].join(';');
    document.documentElement.appendChild(host);
    return host;
  }

  function printHtmlDocument(html) {
    return new Promise(function (resolve, reject) {
      try {
        const host = ensurePrintHost();
        const win = host.contentWindow;
        if (!win || !host.contentDocument) {
          reject(new Error('无法创建打印宿主'));
          return;
        }
        const doc = host.contentDocument;
        doc.open();
        doc.write(html);
        doc.close();

        let settled = false;
        const finish = function (ok, error) {
          if (settled) return;
          settled = true;
          try {
            host.style.opacity = '0';
            host.style.pointerEvents = 'none';
          } catch { /* ignore */ }
          if (ok) resolve(true);
          else reject(error || new Error('打印失败'));
        };

        const runPrint = function () {
          try {
            host.style.opacity = '0.02';
            host.style.pointerEvents = 'auto';
            win.focus();
            const after = function () { finish(true); };
            win.addEventListener('afterprint', after, { once: true });
            setTimeout(function () {
              try { win.print(); } catch (error) { finish(false, error); }
            }, 80);
            setTimeout(function () { finish(true); }, 120000);
          } catch (error) {
            finish(false, error);
          }
        };

        if (doc.readyState === 'complete') {
          setTimeout(runPrint, 120);
        } else {
          host.onload = function () { setTimeout(runPrint, 120); };
          setTimeout(runPrint, 600);
        }
      } catch (error) {
        reject(error);
      }
    });
  }

  function isWebView() {
    try {
      return Boolean(window.chrome && window.chrome.webview && window.chrome.webview.postMessage);
    } catch {
      return false;
    }
  }

  function bytesToBase64(bytes) {
    const chunk = 0x8000;
    let binary = '';
    for (let i = 0; i < bytes.length; i += chunk) {
      const slice = bytes.subarray(i, Math.min(i + chunk, bytes.length));
      binary += String.fromCharCode.apply(null, slice);
    }
    return btoa(binary);
  }

  function bindDesktopMessageHandler() {
    if (!isWebView() || bindDesktopMessageHandler._done) return;
    bindDesktopMessageHandler._done = true;
    try {
      window.chrome.webview.addEventListener('message', function (event) {
        let data = event && event.data;
        if (typeof data === 'string') {
          try { data = JSON.parse(data); } catch { return; }
        }
        if (!data || data.type !== 'save-file-result') return;
        const requestId = String(data.requestId || '');
        const pending = pendingSaves.get(requestId);
        if (!pending) return;
        pendingSaves.delete(requestId);
        clearTimeout(pending.timer);
        if (data.cancelled) {
          const err = new Error('已取消保存');
          err.name = 'AbortError';
          err.cancelled = true;
          pending.reject(err);
          return;
        }
        if (data.ok) {
          pending.resolve({
            via: 'desktop',
            path: data.path || '',
            cancelled: false
          });
          return;
        }
        pending.reject(new Error(data.error || '导出保存失败'));
      });
    } catch { /* ignore */ }
  }

  function saveBlobViaDesktop(blob, fileName, options) {
    options = options || {};
    const pickLocation = options.pickLocation !== false;
    return new Promise(function (resolve, reject) {
      if (!isWebView()) {
        reject(new Error('not-webview'));
        return;
      }
      if (!blob || !blob.size) {
        reject(new Error('导出内容为空'));
        return;
      }
      bindDesktopMessageHandler();
      blob.arrayBuffer().then(function (buffer) {
        try {
          const base64 = bytesToBase64(new Uint8Array(buffer));
          if (!base64) {
            reject(new Error('导出内容为空'));
            return;
          }
          const requestId = 'save-' + Date.now().toString(36) + '-' + (++requestSeq);
          const timer = setTimeout(function () {
            if (!pendingSaves.has(requestId)) return;
            pendingSaves.delete(requestId);
            reject(new Error('等待保存对话框超时'));
          }, 10 * 60 * 1000);
          pendingSaves.set(requestId, { resolve: resolve, reject: reject, timer: timer });
          window.chrome.webview.postMessage(JSON.stringify({
            type: 'save-file',
            requestId: requestId,
            fileName: fileName || 'export.bin',
            base64: base64,
            mime: blob.type || 'application/octet-stream',
            pickLocation: pickLocation
          }));
        } catch (error) {
          reject(error);
        }
      }).catch(function () {
        reject(new Error('读取导出文件失败'));
      });
    });
  }

  function saveBlobInBrowser(blob, fileName) {
    const href = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = href;
    anchor.download = fileName || 'export.bin';
    anchor.rel = 'noopener';
    document.body.appendChild(anchor);
    anchor.click();
    setTimeout(function () {
      try { anchor.remove(); } catch { /* ignore */ }
      URL.revokeObjectURL(href);
    }, 4000);
    return { via: 'browser', path: fileName || 'export.bin' };
  }

  async function saveBlobWithPicker(blob, fileName) {
    if (typeof window.showSaveFilePicker !== 'function') {
      return saveBlobInBrowser(blob, fileName);
    }
    const ext = String(fileName || '').includes('.')
      ? '.' + String(fileName).split('.').pop().toLowerCase()
      : '';
    const mime = blob.type || 'application/octet-stream';
    const types = [];
    if (ext === '.pdf' || mime === 'application/pdf') {
      types.push({ description: 'PDF', accept: { 'application/pdf': ['.pdf'] } });
    } else if (ext === '.zip' || mime === 'application/zip') {
      types.push({ description: 'ZIP', accept: { 'application/zip': ['.zip'] } });
    } else if (ext === '.png') {
      types.push({ description: 'PNG', accept: { 'image/png': ['.png'] } });
    } else if (ext === '.jpg' || ext === '.jpeg') {
      types.push({ description: 'JPEG', accept: { 'image/jpeg': ['.jpg', '.jpeg'] } });
    } else if (ext === '.docx') {
      types.push({ description: 'Word', accept: { 'application/vnd.openxmlformats-officedocument.wordprocessingml.document': ['.docx'] } });
    } else if (ext === '.pptx') {
      types.push({ description: 'PowerPoint', accept: { 'application/vnd.openxmlformats-officedocument.presentationml.presentation': ['.pptx'] } });
    }
    if (!types.length) {
      types.push({ description: '文件', accept: { [mime]: ext ? [ext] : [] } });
    }
    try {
      const handle = await window.showSaveFilePicker({
        suggestedName: fileName || 'export.bin',
        types: types
      });
      const writable = await handle.createWritable();
      await writable.write(blob);
      await writable.close();
      return { via: 'file-picker', path: handle.name || fileName || '' };
    } catch (error) {
      if (error && (error.name === 'AbortError' || /abort|cancel|取消/i.test(String(error.message || '')))) {
        const err = new Error('已取消保存');
        err.name = 'AbortError';
        err.cancelled = true;
        throw err;
      }
      // 不支持或失败时回退下载
      return saveBlobInBrowser(blob, fileName);
    }
  }

  window.studioDesktop = {
    isWebView: isWebView,
    printHtml: printHtmlDocument,
    /**
     * @param {Blob} blob
     * @param {string} fileName
     * @param {{ pickLocation?: boolean }} [options]
     */
    saveBlob: async function (blob, fileName, options) {
      options = options || {};
      const pickLocation = options.pickLocation !== false;
      if (isWebView()) {
        try {
          return await saveBlobViaDesktop(blob, fileName, { pickLocation: pickLocation });
        } catch (error) {
          if (error && (error.cancelled || error.name === 'AbortError')) throw error;
          // 桌面消息失败时，浏览器侧再尝试「另存为」或下载
          if (pickLocation) return saveBlobWithPicker(blob, fileName);
          return saveBlobInBrowser(blob, fileName);
        }
      }
      if (pickLocation) return saveBlobWithPicker(blob, fileName);
      return saveBlobInBrowser(blob, fileName);
    },
    requestExit: function () {
      try {
        if (isWebView()) {
          window.chrome.webview.postMessage(JSON.stringify({ type: 'exit' }));
          return true;
        }
      } catch { /* ignore */ }
      return false;
    }
  };

  if (isWebView()) bindDesktopMessageHandler();

  // 兼容旧调用：about:blank 的 window.open 仍给可写文档窗口（大 iframe）
  const nativeOpen = window.open.bind(window);
  window.open = function (url, target, features) {
    if (url && url !== 'about:blank') return nativeOpen(url, target, features);
    const host = ensurePrintHost();
    try {
      host.style.opacity = '0.02';
      host.style.pointerEvents = 'auto';
    } catch { /* ignore */ }
    return host.contentWindow;
  };
})();
