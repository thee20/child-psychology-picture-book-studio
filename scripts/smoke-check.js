'use strict';

const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

const root = path.join(__dirname, '..');
const port = 4191;

const child = spawn(process.execPath, [path.join(root, 'server.js')], {
  cwd: root,
  env: { ...process.env, PORT: String(port), HOST: '127.0.0.1', STUDIO_SKIP_AUTO_PROBE: '1' },
  stdio: ['ignore', 'pipe', 'pipe']
});

let log = '';
child.stdout.on('data', (d) => { log += d; });
child.stderr.on('data', (d) => { log += d; });

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function fail(message) {
  console.error('SMOKE FAIL:', message);
  return message;
}

(async () => {
  const failures = [];
  await sleep(900);
  const base = `http://127.0.0.1:${port}`;
  const moduleScripts = [
    '/js/core.js',
    '/js/render.js',
    '/js/api-models.js',
    '/js/story-ai.js',
    '/js/teacher.js',
    '/js/export-book.js',
    '/js/app-main.js'
  ];
  const pages = ['/', '/app.js', '/styles.css', '/desktop-bridge.js', '/api/model-usage', ...moduleScripts];
  for (const p of pages) {
    try {
      const r = await fetch(base + p);
      const t = await r.text();
      console.log(p, r.status, t.slice(0, 100).replace(/\s+/g, ' '));
      if (!r.ok) failures.push(fail(`${p} returned ${r.status}`));
    } catch (error) {
      failures.push(fail(`${p} fetch error: ${error.message}`));
    }
  }

  // Path traversal should be blocked
  try {
    const evil = await fetch(`${base}/%2e%2e/server.js`);
    const evilText = await evil.text();
    console.log('path-traversal', evil.status, evilText.slice(0, 80).replace(/\s+/g, ' '));
    if (evil.status === 200 && /use strict|require\(/i.test(evilText)) {
      failures.push(fail('path traversal returned server.js content'));
    }
  } catch (error) {
    console.log('path-traversal error', error.message);
  }

  // Shutdown without force should be skipped for non-desktop owned process
  try {
    const shutdown = await fetch(`${base}/api/shutdown`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}'
    });
    const shutdownBody = await shutdown.json().catch(() => ({}));
    console.log('/api/shutdown', shutdown.status, JSON.stringify(shutdownBody).slice(0, 160));
    if (!shutdownBody.skipped && shutdownBody.shuttingDown) {
      failures.push(fail('shutdown should skip when not desktop-owned'));
    }
  } catch (error) {
    failures.push(fail(`/api/shutdown error: ${error.message}`));
  }

  // Model policy: when configured, image list must be grok/gemini only.
  // Unconfigured machines return 500 without policy — skip so smoke stays usable as a default gate.
  try {
    const modelsRes = await fetch(`${base}/api/models`);
    const models = await modelsRes.json().catch(() => ({}));
    const unconfigured =
      modelsRes.status >= 400 &&
      /尚未配置|not configured|未配置|loadConnection|API/i.test(String(models.error || models.message || ''));
    if (!modelsRes.ok && (unconfigured || !models.policy)) {
      console.log('/api/models skipped (unconfigured or no policy):', modelsRes.status, String(models.error || models.message || '').slice(0, 120));
    } else {
      const imageIds = (models.models || []).map((m) => m.id).filter((id) => /(image|imagine)/i.test(id));
      const badImage = imageIds.filter((id) => !/grok|gemini/i.test(id));
      console.log('image policy models:', imageIds.join(', ') || '(none)');
      if (badImage.length) failures.push(fail(`non grok/gemini image models listed: ${badImage.join(', ')}`));
      if (!models.policy?.image) failures.push(fail('models policy missing'));
    }
  } catch (error) {
    failures.push(fail(`/api/models policy check error: ${error.message}`));
  }

  // save-export writes bytes to Downloads (or fallback folder)
  try {
    const tiny = Buffer.from('%PDF-1.4 smoke').toString('base64');
    const saveRes = await fetch(`${base}/api/save-export`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ fileName: 'studio-smoke-export.pdf', base64: tiny })
    });
    const saveBody = await saveRes.json().catch(() => ({}));
    console.log('/api/save-export', saveRes.status, JSON.stringify(saveBody).slice(0, 200));
    if (!saveRes.ok || !saveBody.ok || !saveBody.path) {
      failures.push(fail('save-export failed'));
    } else if (saveBody.bytes < 4) {
      failures.push(fail('save-export wrote empty file'));
    } else {
      try { fs.rmSync(saveBody.path, { force: true }); } catch { /* ignore */ }
    }
  } catch (error) {
    failures.push(fail(`/api/save-export error: ${error.message}`));
  }

  let healthOk = false;
  try {
    const h = await fetch(`${base}/api/health`);
    const text = await h.text();
    console.log('/api/health', h.status, text.slice(0, 240));
    healthOk = h.ok && /"ok"\s*:\s*true/.test(text);
    // health must succeed even without model API configured
    if (!/"configured"\s*:/.test(text)) failures.push(fail('/api/health missing configured field'));
    if (!/"ownedBy"\s*:/.test(text)) failures.push(fail('/api/health missing ownedBy field'));
    if (!healthOk) failures.push(fail('health check not ok'));
  } catch (e) {
    failures.push(fail(`/api/health error ${e.message}`));
  }

  const html = await (await fetch(`${base}/`)).text();
  const moduleBodies = [];
  for (const p of moduleScripts) {
    moduleBodies.push(await (await fetch(`${base}${p}`)).text());
  }
  const appJs = await (await fetch(`${base}/app.js`)).text();
  const bridgeJs = await (await fetch(`${base}/desktop-bridge.js`)).text();
  const combinedJs = `${moduleBodies.join('\n')}\n${bridgeJs}`;
  const ids = new Set([...html.matchAll(/id="([^"]+)"/g)].map((m) => m[1]));
  const needed = [...combinedJs.matchAll(/\$\('#([A-Za-z0-9_-]+)'\)/g)].map((m) => m[1]);
  const missing = [...new Set(needed)].filter((id) => !ids.has(id));
  console.log('missing DOM ids:', missing.join(', ') || '(none)');
  if (missing.length) failures.push(fail(`missing DOM ids: ${missing.join(', ')}`));

  if (!html.includes('儿童心理绘本工坊')) failures.push(fail('HTML missing product name'));
  if (html.includes('brand-mark') && !/brand-mark[^>]*>\s*绘\s*</.test(html)) {
    failures.push(fail('brand-mark should use 绘'));
  }
  if (!html.includes('id="apiConfigDialog"')) failures.push(fail('API config dialog missing'));
  if (!html.includes('id="apiConfigBtn"')) failures.push(fail('API config button missing'));
  for (const p of moduleScripts) {
    if (!html.includes(`src="${p}"`) && !html.includes(`src='${p}'`)) {
      failures.push(fail(`index.html missing script ${p}`));
    }
  }

  try {
    const cfg = await (await fetch(`${base}/api/connection-config`)).json();
    if (typeof cfg.hasUserConfig === 'undefined') failures.push(fail('connection-config missing hasUserConfig'));
    console.log('/api/connection-config', cfg.configured, cfg.source || '(none)');
  } catch (error) {
    failures.push(fail(`/api/connection-config error: ${error.message}`));
  }

  const checks = [
    'function scheduleLocalSave',
    'function renderCharacterPreview',
    'function exitApp',
    'function loadKnowledge',
    'function exportBook',
    'function exportBookAsPdf',
    'function exportBookAsImageZip',
    'function renderBookPageToCanvas',
    'function buildPdfDocument',
    'function buildZipStore',
    'function sanitizeZipEntryName',
    '0x0800',
    'function saveExportViaServer',
    'function saveExportBlob',
    'pickLocation',
    'function loadAutosave',
    'const AUTOSAVE_KEY',
    'function connectModels',
    'function openApiConfigDialog',
    'function saveApiConfig',
    "action: testOnly ? 'test' : 'save'",
    'force: false',
    '/api/probe-models',
    '/api/connection-config',
    '/api/save-export',
    'exportBookDialog',
    'save-file-result',
    'showSaveFilePicker',
    'FIRST_FRAME_STYLE_LOCK',
    'isFirstFrame',
    '照片风格漫画'
  ];
  for (const c of checks) {
    const ok = combinedJs.includes(c);
    console.log(c, ok ? 'ok' : 'MISSING');
    if (!ok) failures.push(fail(`critical symbol missing: ${c}`));
  }

  if (combinedJs.includes('xinyu-picture-book-autosave') && !combinedJs.includes('AUTOSAVE_KEY_LEGACY')) {
    failures.push(fail('legacy autosave key used without migration constant'));
  }
  if (!combinedJs.includes('picture-book-studio-autosave')) {
    failures.push(fail('autosave key missing'));
  }

  // 禁止旧版人名品牌字样（用码点拼接，避免源码字面量出现该词）
  const bannedBrand = String.fromCharCode(0x59DA, 0x8001, 0x5E08);
  if ((html + combinedJs + appJs + bridgeJs + log).includes(bannedBrand)) {
    failures.push(fail('source or log still contains banned personal brand characters'));
  }
  console.log('server log:', log.trim());
  console.log('healthOk', healthOk);
  if (log.includes('心屿')) failures.push(fail('server log still contains 心屿'));
  if (!/儿童心理绘本工坊已启动/.test(log)) {
    failures.push(fail('server boot log missing product name'));
  }

  child.kill();
  await sleep(200);
  if (failures.length) {
    console.error(`\n${failures.length} smoke failure(s)`);
    process.exit(2);
  }
  console.log('\nsmoke ok');
  process.exit(0);
})().catch(async (error) => {
  console.error(error);
  try { child.kill(); } catch { /* ignore */ }
  process.exit(1);
});
