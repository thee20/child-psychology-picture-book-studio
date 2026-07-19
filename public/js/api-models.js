'use strict';

/* api-models: connection config, model catalog, usage */

function normalizeModelName(model) { return model.id || model; }

const TEXT_MODEL_PREFERRED = [
  'gpt-5.6-sol',
  'claude-opus-4-6-thinking',
  'gpt-5.5',
  'claude-sonnet-4-6',
  'gemini-3.1-pro',
  'deepseek-v4-pro'
];
const IMAGE_MODEL_PREFERRED = [
  'grok-imagine-image',
  'grok-imagine-image-quality',
  'gemini-3.1-flash-image'
];

function applyModelCatalogToUi(catalog, { badgeText } = {}) {
  modelCatalog = catalog || { text: [], image: [] };
  const textList = modelCatalog.text || [];
  const imageList = modelCatalog.image || [];
  fillSelect($('#textModelSelect'), textList, TEXT_MODEL_PREFERRED);
  fillSelect($('#teacherModelSelect'), textList, TEXT_MODEL_PREFERRED);
  fillSelect($('#imageModelSelect'), imageList, IMAGE_MODEL_PREFERRED);
  renderModelCatalog();
  updateModelUsageBar();
  const badge = $('#connectionBadge');
  if (badge && badgeText) {
    badge.className = 'connection-badge is-ok';
    badge.querySelector('span').textContent = badgeText;
  }
}

function summarizeCatalog(catalog) {
  const text = catalog?.text || [];
  const image = catalog?.image || [];
  const textOk = text.filter((item) => item.availability?.state === 'available' || item.availability?.state === 'partial').length;
  const imageOk = image.filter((item) => item.availability?.state === 'available' || item.availability?.state === 'partial').length;
  return { text: text.length, image: image.length, textOk, imageOk };
}

function sourceLabel(source) {
  return ({
    environment: '环境变量',
    'user-config': '应用内配置',
    workbuddy: 'WorkBuddy'
  })[source] || source || '未配置';
}

function setApiConfigStatus(message, kind = '') {
  const el = $('#apiConfigStatus');
  if (!el) return;
  el.textContent = message;
  el.className = `api-config-status${kind ? ` is-${kind}` : ''}`;
}

async function loadApiConfigForm() {
  const data = await api('/api/connection-config');
  const user = data.userConfig;
  $('#apiProviderNameInput').value = user?.providerName || '';
  $('#apiBaseUrlInput').value = user?.baseUrl || data.baseUrl || '';
  $('#apiKeyInput').value = '';
  $('#apiKeyInput').placeholder = user?.apiKeyMasked
    ? `已保存：${user.apiKeyMasked}（留空则保留原密钥）`
    : '粘贴密钥（保存后不会再次明文显示）';

  if (!data.configured) {
    setApiConfigStatus('尚未配置模型 API。请填写第三方 OpenAI 兼容的 Base URL 与 API Key。', 'warn');
  } else {
    setApiConfigStatus(
      `当前生效：${sourceLabel(data.source)} · ${data.baseUrl || ''} · Key ${data.apiKeyMasked || '••••'}` +
        (data.envConfigured ? '（环境变量优先，应用内保存后重启/取消环境变量后才会用本页配置）' : ''),
      'ok'
    );
  }
  return data;
}

async function openApiConfigDialog() {
  try {
    await loadApiConfigForm();
  } catch (error) {
    setApiConfigStatus(error.message || '读取配置失败', 'error');
  }
  $('#apiConfigDialog')?.showModal();
}

async function saveApiConfig({ testOnly = false } = {}) {
  const baseUrl = $('#apiBaseUrlInput')?.value?.trim() || '';
  const apiKey = $('#apiKeyInput')?.value?.trim() || '';
  const providerName = $('#apiProviderNameInput')?.value?.trim() || '';
  if (!baseUrl) {
    setApiConfigStatus('请填写 API Base URL', 'error');
    return;
  }
  if (!apiKey && !($('#apiKeyInput')?.placeholder || '').includes('已保存')) {
    setApiConfigStatus('请填写 API Key', 'error');
    return;
  }
  setApiConfigStatus(testOnly ? '正在测试连接…' : '正在保存并验证…', '');
  setBusy(true, testOnly ? '测试 API 连接' : '保存 API 配置', '正在请求上游 /models…');
  try {
    const result = await api('/api/connection-config', {
      method: 'POST',
      body: JSON.stringify({
        action: testOnly ? 'test' : 'save',
        baseUrl,
        apiKey,
        providerName,
        test: true
      })
    });
    if (testOnly) {
      // Test never persists; refuse to treat as saved even if server misbehaves.
      if (result.saved) {
        setApiConfigStatus('服务器意外写入了配置（请检查版本）', 'error');
        toast('测试连接不应保存配置', 'error');
        return;
      }
      if (result.test && !result.test.ok) {
        setApiConfigStatus(result.message || result.test.message, 'error');
        toast(result.message || result.test.message, 'error');
      } else {
        setApiConfigStatus(result.message || '测试成功（未保存）', 'ok');
        toast(result.message || '连接测试成功（尚未保存）', 'success');
      }
      return;
    }
    if (result.test && !result.test.ok) {
      setApiConfigStatus(result.message || result.test.message, 'error');
      toast(result.message || result.test.message, 'error');
    } else {
      setApiConfigStatus(result.message || '已保存', 'ok');
      toast(result.message || 'API 配置已保存', 'success');
      $('#apiKeyInput').value = '';
      await loadApiConfigForm();
      await connectModels();
      try { $('#apiConfigDialog')?.close(); } catch { /* ignore */ }
    }
  } catch (error) {
    setApiConfigStatus(error.message || (testOnly ? '测试失败' : '保存失败'), 'error');
    toast(error.message, 'error');
  } finally {
    setBusy(false);
  }
}

async function clearApiConfig() {
  if (!window.confirm('确定清除应用内保存的第三方 API 配置？\n（不会删除环境变量或 WorkBuddy）')) return;
  setBusy(true, '清除 API 配置', '正在更新本地配置…');
  try {
    const result = await api('/api/connection-config', {
      method: 'POST',
      body: JSON.stringify({ action: 'clear' })
    });
    toast(result.message || '已清除', 'success');
    await loadApiConfigForm();
    await connectModels();
  } catch (error) {
    toast(error.message, 'error');
  } finally {
    setBusy(false);
  }
}

async function connectModels() {
  const badge = $('#connectionBadge');
  try {
    badge.className = 'connection-badge is-pending';
    badge.querySelector('span').textContent = '连接中 · 检查 API 配置';

    const health = await api('/api/health');
    if (health.usageStats) modelUsage = health.usageStats;
    console.info('API source:', health.source, health.configured);

    if (!health.configured) {
      badge.className = 'connection-badge is-error';
      badge.querySelector('span').textContent = '未配置 API';
      fillSelect($('#textModelSelect'), [], []);
      fillSelect($('#teacherModelSelect'), [], []);
      fillSelect($('#imageModelSelect'), [], []);
      updateModelUsageBar();
      toast('请先点击「API 接入」配置第三方模型 Base URL 与 API Key', 'error');
      return;
    }

    // 先拉当前目录（可能还在探测中）
    const listed = await api('/api/model-catalog');
    models = [...(listed.catalog?.text || []), ...(listed.catalog?.image || [])];
    applyModelCatalogToUi(listed.catalog, {
      badgeText: listed.probe?.running
        ? `已连接(${sourceLabel(health.source)}) · 检测中…`
        : `已连接 · 文本 ${listed.catalog?.text?.length || 0} / 图片 ${listed.catalog?.image?.length || 0}`
    });

    // 启动探测：等待服务端完成本次可用性检测（首次启动会实际请求上游）
    badge.querySelector('span').textContent = '已连接 · 正在检测模型可用性…';
    toast('正在检测文本/图片模型可用性，请稍候…', '');
    const probed = await api('/api/probe-models', {
      method: 'POST',
      body: JSON.stringify({ force: false })
    });
    if (probed.usageStats) modelUsage = probed.usageStats;
    models = [...(probed.catalog?.text || []), ...(probed.catalog?.image || [])];
    const stats = summarizeCatalog(probed.catalog);
    applyModelCatalogToUi(probed.catalog, {
      badgeText: probed.probe?.error
        ? '已连接 · 模型检测未完成'
        : `已连接 · 可用 文本${stats.textOk}/${stats.text} · 图片${stats.imageOk}/${stats.image}`
    });

    if (probed.probe?.error) {
      toast(`模型检测未完成：${probed.probe.error}`, 'error');
    } else {
      toast(`模型检测完成：文本可用 ${stats.textOk}，图片可用 ${stats.imageOk}`, stats.imageOk || stats.textOk ? 'success' : 'error');
    }

    if (!stats.imageOk) {
      toast('当前没有可用的 Grok/Gemini 图片模型，请检查第三方 API 渠道或图片模型权限', 'error');
    }
  } catch (error) {
    badge.className = 'connection-badge is-error';
    badge.querySelector('span').textContent = '模型连接失败';
    fillSelect($('#textModelSelect'), [{ id: 'gpt-5.6-sol', rank: 1, feature: '综合主力模型', availability: { label: '状态未知' } }], []);
    fillSelect($('#teacherModelSelect'), [{ id: 'gpt-5.6-sol', rank: 1, feature: '综合主力模型', availability: { label: '状态未知' } }], []);
    fillSelect($('#imageModelSelect'), [{ id: 'grok-imagine-image', rank: 1, feature: '快速绘本插画', availability: { label: '状态未知' } }], []);
    updateModelUsageBar();
    toast(error.message, 'error');
  }
}

function fillSelect(select, values, preferred = []) {
  if (!select) return;
  const entries = values.map((value, index) => typeof value === 'string' ? { id: value, rank: index + 1, feature: '', availability: { label: '' } } : value);
  // 下拉优先展示可用模型，不可用的仍可看到但排后
  const unique = entries
    .filter((entry, index) => entries.findIndex((item) => item.id === entry.id) === index)
    .sort((a, b) => {
      const rank = { available: 4, partial: 3, listed: 2, checking: 2, unavailable: 1 };
      return (rank[b.availability?.state] || 0) - (rank[a.availability?.state] || 0)
        || (b.score || 0) - (a.score || 0)
        || String(a.id).localeCompare(String(b.id));
    });
  select.innerHTML = unique.map((entry) => {
    const state = entry.availability?.label || '状态未知';
    const label = `#${String(entry.rank || 0).padStart(2, '0')} ${entry.id}｜${entry.feature || '通用模型'}｜${state}`;
    return `<option value="${escapeHtml(entry.id)}" title="${escapeHtml(label)}">${escapeHtml(label)}</option>`;
  }).join('');
  const ids = unique.map((entry) => entry.id);
  const availablePreferred = preferred.find((value) => {
    const entry = unique.find((item) => item.id === value);
    return entry && entry.availability?.state !== 'unavailable';
  });
  const best = availablePreferred
    || unique.find((entry) => entry.availability?.state === 'available')?.id
    || unique.find((entry) => entry.availability?.state === 'partial')?.id
    || ids[0];
  if (best) select.value = best;
}

function renderModelCatalog() {
  const items = modelCatalog[activeCatalogType] || [];
  const usageMap = modelUsage.models || {};
  updateModelUsageBar();
  $('#modelCatalogList').innerHTML = items.map((item) => {
    const usage = usageMap[item.id];
    const usageLine = usage
      ? `本会话 ${usage.calls || 0} 次 · Token ${usage.tokens || 0} · ${usage.lastOk === false ? '最近失败' : usage.lastOk ? '最近可响应' : '已记录'}`
      : '本会话尚未调用';
    return `<article class="model-row">
    <div class="model-rank">${String(item.rank).padStart(2, '0')}</div>
    <div><strong>${escapeHtml(item.id)}</strong><span class="model-feature">能力分 ${item.score}</span></div>
    <div class="model-feature">${escapeHtml(item.feature)}${item.availability?.detail ? `<br>${escapeHtml(item.availability.detail)}` : ''}<br>${escapeHtml(usageLine)}</div>
    <div class="model-availability ${escapeHtml(item.availability?.state || 'listed')}">${escapeHtml(item.availability?.label || '代理已列出')}</div>
  </article>`;
  }).join('') || '<div class="project-item"><span>暂无此类模型</span></div>';
  $$('.catalog-tab').forEach((button) => button.classList.toggle('is-active', button.dataset.catalog === activeCatalogType));
}
