'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { URL } = require('url');
const { execFileSync } = require('child_process');

const HOST = process.env.HOST || '127.0.0.1';
const PORT = Number(process.env.PORT || 4173);
const ROOT = __dirname;
const PUBLIC_DIR = path.join(ROOT, 'public');
const PROJECTS_DIR = path.join(ROOT, 'data', 'projects');
const EXPORTS_DIR = path.join(ROOT, 'data', 'exports');
const KNOWLEDGE_DIR = path.join(ROOT, 'data', 'knowledge');
const MODEL_STATUS_FILE = path.join(ROOT, 'data', 'model-status.json');
const MODEL_USAGE_FILE = path.join(ROOT, 'data', 'model-usage.json');
const WORKBUDDY_MODELS = path.join(os.homedir(), '.workbuddy', 'models.json');
/** 用户在应用内保存的第三方 OpenAI 兼容接入（仅本地） */
const USER_API_CONFIG_FILE = path.join(ROOT, 'data', 'user-api-config.json');
const MAX_BODY = 80 * 1024 * 1024;
const MAX_BODY_MB = Math.round(MAX_BODY / (1024 * 1024));

function maskSecret(value) {
  const text = String(value || '');
  if (!text) return '';
  if (text.length <= 8) return '••••';
  return `${text.slice(0, 3)}••••${text.slice(-4)}`;
}

function normalizeBaseUrl(value) {
  let base = String(value || '').trim().replace(/\/$/, '');
  if (!base) return '';
  // Allow pasting full chat URL
  base = base.replace(/\/chat\/completions\/?$/i, '');
  return base.replace(/\/$/, '');
}

function readUserApiConfig() {
  try {
    if (!fs.existsSync(USER_API_CONFIG_FILE)) return null;
    const parsed = JSON.parse(fs.readFileSync(USER_API_CONFIG_FILE, 'utf8'));
    if (!parsed || typeof parsed !== 'object') return null;
    const apiKey = String(parsed.apiKey || '').trim();
    const baseUrl = normalizeBaseUrl(parsed.baseUrl || '');
    if (!apiKey || !baseUrl) return null;
    return {
      apiKey,
      baseUrl,
      providerName: String(parsed.providerName || 'Custom OpenAI-compatible').trim() || 'Custom OpenAI-compatible',
      updatedAt: parsed.updatedAt || null,
      source: 'user-config'
    };
  } catch {
    return null;
  }
}

function normalizeUserApiCredentials({ apiKey, baseUrl, providerName, allowReuseExistingKey = true }) {
  let key = String(apiKey || '').trim();
  const existing = allowReuseExistingKey ? readUserApiConfig() : null;
  if (!key && existing) key = existing.apiKey;
  const base = normalizeBaseUrl(baseUrl);
  if (!key) throw new Error('请填写 API Key');
  if (!base) throw new Error('请填写 API Base URL（OpenAI 兼容根路径，例如 https://api.example.com/v1）');
  let parsedUrl;
  try {
    parsedUrl = new URL(base);
  } catch {
    throw new Error('API Base URL 格式无效');
  }
  if (parsedUrl.protocol !== 'http:' && parsedUrl.protocol !== 'https:') {
    throw new Error('API Base URL 仅支持 http:// 或 https://');
  }
  return {
    apiKey: key,
    baseUrl: base,
    providerName: String(providerName || existing?.providerName || 'Custom OpenAI-compatible').trim() || 'Custom OpenAI-compatible'
  };
}

function writeUserApiConfig({ apiKey, baseUrl, providerName }) {
  const normalized = normalizeUserApiCredentials({ apiKey, baseUrl, providerName, allowReuseExistingKey: false });
  fs.mkdirSync(path.dirname(USER_API_CONFIG_FILE), { recursive: true });
  const payload = {
    ...normalized,
    updatedAt: new Date().toISOString()
  };
  fs.writeFileSync(USER_API_CONFIG_FILE, JSON.stringify(payload, null, 2), 'utf8');
  return payload;
}

async function testUserApiConnection({ apiKey, baseUrl }) {
  const connection = {
    apiKey,
    baseUrl,
    source: 'user-config'
  };
  const result = await proxyJson(`${connection.baseUrl}/models`, { headers: authHeaders(connection) }, 20000);
  const count = Array.isArray(result.data) ? result.data.length : 0;
  return {
    ok: true,
    modelCount: count,
    message: count ? `连接成功，发现 ${count} 个模型` : '连接成功（未返回模型列表）'
  };
}

function clearUserApiConfig() {
  try {
    if (fs.existsSync(USER_API_CONFIG_FILE)) fs.unlinkSync(USER_API_CONFIG_FILE);
  } catch {
    /* ignore */
  }
}

function publicConnectionInfo(connection, extra = {}) {
  if (!connection) {
    return {
      ok: false,
      configured: false,
      source: null,
      baseUrl: null,
      providerName: null,
      apiKeyMasked: '',
      ...extra
    };
  }
  return {
    ok: true,
    configured: true,
    source: connection.source,
    baseUrl: connection.baseUrl,
    providerName: connection.providerName || null,
    apiKeyMasked: maskSecret(connection.apiKey),
    ...extra
  };
}

function downloadsDir() {
  const home = os.homedir();
  const candidates = [
    path.join(home, 'Downloads'),
    path.join(home, '下载'),
    path.join(home, 'Desktop'),
    path.join(home, '桌面'),
    EXPORTS_DIR
  ];
  for (const dir of candidates) {
    try {
      fs.mkdirSync(dir, { recursive: true });
      return dir;
    } catch {
      /* try next */
    }
  }
  return EXPORTS_DIR;
}

function ensureUniqueFilePath(targetPath) {
  if (!fs.existsSync(targetPath)) return targetPath;
  const dir = path.dirname(targetPath);
  const ext = path.extname(targetPath);
  const stem = path.basename(targetPath, ext);
  for (let i = 2; i < 1000; i += 1) {
    const candidate = path.join(dir, `${stem} (${i})${ext}`);
    if (!fs.existsSync(candidate)) return candidate;
  }
  return path.join(dir, `${stem}-${Date.now()}${ext}`);
}

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml'
};

fs.mkdirSync(PROJECTS_DIR, { recursive: true });
fs.mkdirSync(EXPORTS_DIR, { recursive: true });
fs.mkdirSync(KNOWLEDGE_DIR, { recursive: true });

const INITIAL_MODEL_STATUS = {
  'gpt-5.6-sol': { state: 'listed', label: '待启动检测', detail: '服务启动后将自动探测' },
  'grok-imagine-image': { state: 'listed', label: '待启动检测', detail: '服务启动后将自动探测' },
  'gemini-3.1-flash-image': { state: 'listed', label: '待启动检测', detail: '服务启动后将自动探测' }
};

/** 文本候选：只保留高能力家族，启动探测后再按可用性排序 */
const TEXT_MODEL_MIN_SCORE = 900;
const TEXT_PROBE_LIMIT = 8;
const IMAGE_PROBE_LIMIT = 6;
const PROBE_TEXT_TIMEOUT_MS = 45000;
const PROBE_IMAGE_TIMEOUT_MS = 90000;

let probeState = {
  running: false,
  done: false,
  startedAt: null,
  finishedAt: null,
  summary: null,
  error: null
};

function emptyUsage() {
  return {
    session: { startedAt: new Date().toISOString(), totalCalls: 0, successCalls: 0, failedCalls: 0, totalTokens: 0 },
    models: {},
    updatedAt: new Date().toISOString()
  };
}

let usageStore = emptyUsage();

function loadModelStatus() {
  try {
    return { ...INITIAL_MODEL_STATUS, ...JSON.parse(fs.readFileSync(MODEL_STATUS_FILE, 'utf8')) };
  } catch {
    return { ...INITIAL_MODEL_STATUS };
  }
}

function loadUsage() {
  try {
    const saved = JSON.parse(fs.readFileSync(MODEL_USAGE_FILE, 'utf8'));
    usageStore = { ...emptyUsage(), ...saved, session: { ...emptyUsage().session, ...(saved.session || {}) }, models: saved.models || {} };
  } catch {
    usageStore = emptyUsage();
  }
  return usageStore;
}

function saveUsage() {
  usageStore.updatedAt = new Date().toISOString();
  fs.writeFileSync(MODEL_USAGE_FILE, JSON.stringify(usageStore, null, 2), 'utf8');
  return usageStore;
}

function recordUsage(model, { ok, tokens = 0, detail = '' } = {}) {
  if (!model) return loadUsage();
  loadUsage();
  usageStore.session.totalCalls = (usageStore.session.totalCalls || 0) + 1;
  if (ok) usageStore.session.successCalls = (usageStore.session.successCalls || 0) + 1;
  else usageStore.session.failedCalls = (usageStore.session.failedCalls || 0) + 1;
  usageStore.session.totalTokens = (usageStore.session.totalTokens || 0) + (Number(tokens) || 0);
  const entry = usageStore.models[model] || { calls: 0, success: 0, failed: 0, tokens: 0 };
  entry.calls += 1;
  if (ok) entry.success += 1; else entry.failed += 1;
  entry.tokens = (entry.tokens || 0) + (Number(tokens) || 0);
  entry.lastOk = Boolean(ok);
  entry.lastDetail = detail || '';
  entry.lastAt = new Date().toISOString();
  usageStore.models[model] = entry;
  return saveUsage();
}

function extractTokens(result) {
  const usage = result?.usage || {};
  if (Number.isFinite(usage.total_tokens)) return Number(usage.total_tokens);
  const sum = Number(usage.prompt_tokens || 0) + Number(usage.completion_tokens || 0);
  return Number.isFinite(sum) && sum > 0 ? sum : 0;
}

function markModelStatus(model, state, label, detail = '', usageMeta = null) {
  if (!model) return;
  const status = loadModelStatus();
  status[model] = { state, label, detail, checkedAt: new Date().toISOString() };
  fs.writeFileSync(MODEL_STATUS_FILE, JSON.stringify(status, null, 2), 'utf8');
  if (usageMeta) {
    recordUsage(model, {
      ok: state === 'available' || state === 'partial',
      tokens: usageMeta.tokens || 0,
      detail
    });
  }
}

function listKnowledge() {
  return fs.readdirSync(KNOWLEDGE_DIR)
    .filter((name) => name.endsWith('.json'))
    .map((name) => {
      try {
        const file = path.join(KNOWLEDGE_DIR, name);
        const value = JSON.parse(fs.readFileSync(file, 'utf8'));
        return {
          id: path.basename(name, '.json'),
          title: value.title || '未命名资料',
          preview: String(value.content || '').slice(0, 160),
          characters: String(value.content || '').length,
          updatedAt: value.updatedAt || fs.statSync(file).mtime.toISOString()
        };
      } catch {
        return null;
      }
    })
    .filter(Boolean)
    .sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
}

loadUsage();

function isImageLikeModelId(id) {
  return /(image|imagine)/i.test(String(id || '')) && !/video/i.test(String(id || ''));
}

function isAllowedImageModel(id) {
  const value = String(id || '').toLowerCase();
  if (!isImageLikeModelId(value)) return false;
  // 产品策略：图片模型只保留 Grok 与 Gemini 系列
  return /grok/.test(value) || /gemini/.test(value);
}

function isAllowedTextModel(id) {
  const value = String(id || '');
  if (!value || isImageLikeModelId(value) || /video/i.test(value)) return false;
  // 只保留高能力分文本模型，再由启动探测筛出“可用性最强”的一批
  return modelScore(value, 'text') >= TEXT_MODEL_MIN_SCORE;
}

function modelBaseName(id) {
  const value = String(id || '');
  const slash = value.lastIndexOf('/');
  return slash >= 0 ? value.slice(slash + 1) : value;
}

function modelScore(id, category) {
  const value = id.toLowerCase();
  const rules = category === 'image' ? [
    [/grok-imagine-image-quality/, 1000],
    [/gemini-3\.1-flash-image/, 960],
    [/gemini.*image/, 920],
    [/grok-imagine-image/, 900],
    [/grok.*imagine/, 860],
    [/gemini/, 820]
  ] : [
    [/gpt-5\.6-(sol|terra|luna)/, 1200], [/claude-opus-4-6-thinking/, 1170], [/gpt-5\.5/, 1140],
    [/claude-sonnet-4-6/, 1120], [/gemini-3\.1-pro/, 1090], [/grok-4\.5/, 1070], [/grok-4\.20.*reasoning/, 1060],
    [/deepseek-v4-pro/, 1030], [/glm-5\.2/, 1010], [/kimi-k2\.6/, 990], [/minimax-m3/, 970],
    [/qwen3\.5-397b/, 950], [/grok-4\.3/, 940], [/gemini-3\.5-flash/, 920], [/deepseek-v4-flash/, 900],
    [/glm-5\.1/, 880], [/qwen3\.5-122b/, 860], [/step-3\.7/, 830], [/minimax-m2\.7/, 800],
    [/gpt-oss-120b/, 780], [/qwen3-next-80b/, 750], [/gpt-oss-20b/, 650]
  ];
  const rule = rules.find(([pattern]) => pattern.test(value));
  let score = rule ? rule[1] : 500;
  // 代理前缀模型降权，优先展示直连/主渠道同名模型
  if (/rugao\//.test(value)) score -= 40;
  if (/anyrouter\//.test(value)) score -= 50;
  if (/lyclaude\//.test(value)) score -= 60;
  if (category === 'text' && /compact|flash|mini|lite|fast/.test(value)) score -= 35;
  return score;
}

/** 同 basename 只保留分最高的一条，避免 lyclaude/xxx 与 xxx 重复占位 */
function dedupeByBaseName(ids, category) {
  const best = new Map();
  for (const id of ids) {
    const base = modelBaseName(id).toLowerCase();
    const prev = best.get(base);
    if (!prev) {
      best.set(base, id);
      continue;
    }
    const prevScore = modelScore(prev, category);
    const nextScore = modelScore(id, category);
    if (nextScore > prevScore || (nextScore === prevScore && id.length < prev.length)) {
      best.set(base, id);
    }
  }
  return [...best.values()];
}

function modelFeature(id, category) {
  const value = id.toLowerCase();
  if (category === 'image') {
    if (/quality/.test(value)) return '高质量绘本插画，细节优先，速度较慢';
    if (/gemini/.test(value)) return 'Gemini 图文能力，适合角色与场景表达';
    if (/grok-imagine/.test(value)) return 'Grok 出图快、色彩鲜明，已适配本项目';
    if (/grok/.test(value)) return 'Grok 图片生成';
    return '绘本插画模型';
  }
  if (/gpt-5\.6/.test(value)) return '综合推理、结构化写作和长文规划强，首选主力';
  if (/claude-opus/.test(value)) return '深度推理与细腻写作强，适合复杂心理主题';
  if (/claude-sonnet/.test(value)) return '写作质量与速度均衡，适合教案和课件';
  if (/gpt-5\.5/.test(value)) return '综合写作与工具调用强，适合整本创作';
  if (/gemini.*pro/.test(value)) return '长上下文和资料整合强，适合长文档备课';
  if (/grok/.test(value)) return '响应直接、创意发散强，适合头脑风暴';
  if (/deepseek.*pro/.test(value)) return '推理与中文结构化输出强，性价比较好';
  if (/glm-5/.test(value)) return '中文教育场景表现好，教案表达自然';
  if (/kimi/.test(value)) return '长文本阅读与中文写作好，适合资料整理';
  if (/minimax/.test(value)) return '中文创意写作和角色对话自然';
  if (/qwen/.test(value)) return '中文理解稳健，适合通用备课与改写';
  if (/flash|mini|lite|fast|compact/.test(value)) return '速度优先，适合草稿和快速修改';
  return '通用文本创作与结构化输出';
}

function availabilityRank(state) {
  return ({ available: 4, partial: 3, listed: 2, checking: 2, unavailable: 1 }[state] || 0);
}

function buildModelCatalog(ids, options = {}) {
  const status = loadModelStatus();
  const preferAvailableText = options.preferAvailableText !== false;
  const catalog = { text: [], image: [] };

  const textIds = dedupeByBaseName(ids.filter((id) => isAllowedTextModel(id)), 'text');
  const imageIds = dedupeByBaseName(ids.filter((id) => isAllowedImageModel(id)), 'image');

  catalog.image = imageIds.map((id) => {
    const availability = status[id] || { state: 'listed', label: '代理已列出', detail: '尚未发起实测请求' };
    return { id, score: modelScore(id, 'image'), feature: modelFeature(id, 'image'), availability };
  }).sort((a, b) => availabilityRank(b.availability?.state) - availabilityRank(a.availability?.state)
    || b.score - a.score
    || a.id.localeCompare(b.id))
    .map((item, index) => ({ ...item, rank: index + 1 }));

  let textItems = textIds.map((id) => {
    const availability = status[id] || { state: 'listed', label: '代理已列出', detail: '尚未发起实测请求' };
    return { id, score: modelScore(id, 'text'), feature: modelFeature(id, 'text'), availability };
  }).sort((a, b) => availabilityRank(b.availability?.state) - availabilityRank(a.availability?.state)
    || b.score - a.score
    || a.id.localeCompare(b.id));

  // 文字模型：优先只保留探测可用/部分可用的；若尚无探测结果则保留高分候选供展示
  if (preferAvailableText) {
    const strong = textItems.filter((item) => item.availability?.state === 'available' || item.availability?.state === 'partial');
    if (strong.length) textItems = strong;
    else textItems = textItems.slice(0, TEXT_PROBE_LIMIT);
  }

  catalog.text = textItems.map((item, index) => ({ ...item, rank: index + 1 }));
  return catalog;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function mapPool(items, concurrency, worker) {
  const results = new Array(items.length);
  let next = 0;
  async function run() {
    while (next < items.length) {
      const index = next;
      next += 1;
      results[index] = await worker(items[index], index);
    }
  }
  const runners = Array.from({ length: Math.min(concurrency, Math.max(items.length, 1)) }, () => run());
  await Promise.all(runners);
  return results;
}

async function fetchUpstreamModelIds(connection) {
  const result = await proxyJson(`${connection.baseUrl}/models`, { headers: authHeaders(connection) }, 30000);
  return (result.data || []).map((item) => item.id).filter(Boolean);
}

async function probeTextModel(connection, model) {
  try {
    const result = await proxyJson(`${connection.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: authHeaders(connection),
      body: JSON.stringify({
        model,
        messages: [{ role: 'user', content: '只回复两个字：可用' }],
        temperature: 0,
        max_tokens: 8,
        stream: false
      })
    }, PROBE_TEXT_TIMEOUT_MS);
    const content = result?.choices?.[0]?.message?.content;
    if (content != null && String(content).trim()) {
      markModelStatus(model, 'available', '启动检测可用', '文本探测通过');
      return { id: model, category: 'text', state: 'available' };
    }
    markModelStatus(model, 'partial', '响应异常', '探测有回包但无文本内容');
    return { id: model, category: 'text', state: 'partial' };
  } catch (error) {
    markModelStatus(model, 'unavailable', '启动检测失败', String(error.message || error).slice(0, 180));
    return { id: model, category: 'text', state: 'unavailable', error: String(error.message || error).slice(0, 180) };
  }
}

async function probeImageModel(connection, model) {
  try {
    if (isImagesApiOnlyModel(model)) {
      const result = await proxyJson(`${connection.baseUrl}/images/generations`, {
        method: 'POST',
        headers: authHeaders(connection),
        body: JSON.stringify({
          model,
          prompt: '儿童绘本风格小测试图，一只简笔小刺猬，干净背景，无文字',
          size: '1024x1024',
          n: 1,
          response_format: 'b64_json'
        })
      }, PROBE_IMAGE_TIMEOUT_MS);
      extractImage(result);
      markModelStatus(model, 'available', '启动检测可用', '图片探测通过');
      return { id: model, category: 'image', state: 'available' };
    }

    // Gemini 等可能走 chat 多模态出图
    try {
      const result = await proxyJson(`${connection.baseUrl}/images/generations`, {
        method: 'POST',
        headers: authHeaders(connection),
        body: JSON.stringify({
          model,
          prompt: '儿童绘本风格小测试图，一只简笔小刺猬，干净背景，无文字',
          size: '1024x1024',
          n: 1,
          response_format: 'b64_json'
        })
      }, PROBE_IMAGE_TIMEOUT_MS);
      extractImage(result);
      markModelStatus(model, 'available', '启动检测可用', '图片探测通过（images）');
      return { id: model, category: 'image', state: 'available' };
    } catch (primaryError) {
      const chatResult = await proxyJson(`${connection.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: authHeaders(connection),
        body: JSON.stringify({
          model,
          messages: [{ role: 'user', content: '请生成一张儿童绘本风格小测试图：一只简笔小刺猬，干净背景，无文字。直接输出图片。' }],
          stream: false
        })
      }, PROBE_IMAGE_TIMEOUT_MS);
      extractImage(chatResult);
      markModelStatus(model, 'available', '启动检测可用', '图片探测通过（chat）');
      return { id: model, category: 'image', state: 'available' };
    }
  } catch (error) {
    markModelStatus(model, 'unavailable', '启动检测失败', String(error.message || error).slice(0, 180));
    return { id: model, category: 'image', state: 'unavailable', error: String(error.message || error).slice(0, 180) };
  }
}

async function runModelAvailabilityProbe({ force = false, includeImages = true } = {}) {
  if (probeState.running) {
    while (probeState.running) await sleep(200);
    return {
      catalog: probeState.summary?.catalog || buildModelCatalog([]),
      probe: {
        running: false,
        done: probeState.done,
        startedAt: probeState.startedAt,
        finishedAt: probeState.finishedAt,
        summary: probeState.summary,
        error: probeState.error
      }
    };
  }

  // Reuse completed probe unless force=true (auto-start uses force + text-only).
  if (probeState.done && !force) {
    let ids = [];
    try {
      const connection = loadConnection();
      ids = await fetchUpstreamModelIds(connection);
    } catch {
      ids = Object.keys(loadModelStatus());
    }
    const catalog = buildModelCatalog(ids);
    return {
      catalog,
      probe: {
        running: false,
        done: true,
        startedAt: probeState.startedAt,
        finishedAt: probeState.finishedAt,
        summary: probeState.summary,
        error: probeState.error
      }
    };
  }

  probeState.running = true;
  probeState.done = false;
  probeState.startedAt = new Date().toISOString();
  probeState.finishedAt = null;
  probeState.error = null;
  probeState.summary = null;

  try {
    const connection = loadConnection();
    const ids = await fetchUpstreamModelIds(connection);
    const textCandidates = dedupeByBaseName(ids.filter((id) => isAllowedTextModel(id)), 'text')
      .sort((a, b) => modelScore(b, 'text') - modelScore(a, 'text') || a.localeCompare(b))
      .slice(0, TEXT_PROBE_LIMIT);
    const imageCandidates = includeImages
      ? dedupeByBaseName(ids.filter((id) => isAllowedImageModel(id)), 'image')
        .sort((a, b) => modelScore(b, 'image') - modelScore(a, 'image') || a.localeCompare(b))
        .slice(0, IMAGE_PROBE_LIMIT)
      : [];

    // 探测前标记为 checking
    for (const id of [...textCandidates, ...imageCandidates]) {
      markModelStatus(id, 'checking', includeImages ? '启动检测中' : '文本检测中', '正在探测可用性…');
    }
    if (!includeImages) {
      for (const id of dedupeByBaseName(ids.filter((id) => isAllowedImageModel(id)), 'image').slice(0, IMAGE_PROBE_LIMIT)) {
        markModelStatus(id, 'listed', '待手动检测', '启动时跳过图片探测（避免消耗配额）；可在模型面板重新检测');
      }
    }

    const textResults = await mapPool(textCandidates, 3, (model) => probeTextModel(connection, model));
    const imageResults = imageCandidates.length
      ? await mapPool(imageCandidates, 2, (model) => probeImageModel(connection, model))
      : [];
    const catalog = buildModelCatalog(ids);
    const summary = {
      textProbed: textResults.length,
      imageProbed: imageResults.length,
      textAvailable: textResults.filter((item) => item.state === 'available' || item.state === 'partial').length,
      imageAvailable: imageResults.filter((item) => item.state === 'available' || item.state === 'partial').length,
      includeImages,
      results: [...textResults, ...imageResults],
      catalog
    };
    probeState.summary = summary;
    probeState.done = true;
    probeState.finishedAt = new Date().toISOString();
    console.log(
      includeImages
        ? `模型启动检测完成：文本可用 ${summary.textAvailable}/${summary.textProbed}，图片可用 ${summary.imageAvailable}/${summary.imageProbed}`
        : `模型启动检测完成（仅文本）：可用 ${summary.textAvailable}/${summary.textProbed}；图片探测已跳过`
    );
    return {
      catalog,
      probe: {
        running: false,
        done: true,
        startedAt: probeState.startedAt,
        finishedAt: probeState.finishedAt,
        summary: {
          textProbed: summary.textProbed,
          imageProbed: summary.imageProbed,
          textAvailable: summary.textAvailable,
          imageAvailable: summary.imageAvailable
        },
        error: null
      }
    };
  } catch (error) {
    probeState.error = String(error.message || error);
    probeState.done = true;
    probeState.finishedAt = new Date().toISOString();
    console.warn(`模型启动检测失败：${probeState.error}`);
    return {
      catalog: buildModelCatalog([]),
      probe: {
        running: false,
        done: true,
        startedAt: probeState.startedAt,
        finishedAt: probeState.finishedAt,
        summary: null,
        error: probeState.error
      }
    };
  } finally {
    probeState.running = false;
  }
}

function safeFileName(value, fallback) {
  const name = String(value || fallback).replace(/[\\/:*?"<>|]/g, '-').replace(/\s+/g, ' ').trim();
  return name.slice(0, 80) || fallback;
}

function sendDownload(res, filePath, downloadName, mime) {
  const body = fs.readFileSync(filePath);
  res.writeHead(200, {
    'Content-Type': mime,
    'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(downloadName)}`,
    'Content-Length': body.length,
    'Cache-Control': 'no-store'
  });
  res.end(body);
}

function runUtf8PowerShell(scriptPath, parameterCommand, environment, options = {}) {
  const bootstrap = `$script = [scriptblock]::Create([IO.File]::ReadAllText($env:STUDIO_SCRIPT_PATH, [Text.Encoding]::UTF8)); & $script ${parameterCommand}`;
  return execFileSync('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', bootstrap], {
    windowsHide: true,
    encoding: options.encoding,
    timeout: options.timeout,
    maxBuffer: options.maxBuffer || 20 * 1024 * 1024,
    env: { ...process.env, STUDIO_SCRIPT_PATH: scriptPath, ...environment }
  });
}

function sendJson(res, status, value) {
  const body = JSON.stringify(value);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store'
  });
  res.end(body);
}

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY) {
        reject(new Error(`请求内容超过 ${MAX_BODY_MB}MB 限制`));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      try {
        const raw = Buffer.concat(chunks).toString('utf8');
        resolve(raw ? JSON.parse(raw) : {});
      } catch {
        reject(new Error('请求 JSON 格式无效'));
      }
    });
    req.on('error', reject);
  });
}

function loadConnection() {
  // 1) Environment variables (highest priority for IT / scripted deploy)
  const envKey = process.env.CLI_PROXY_API_KEY;
  const envBase = process.env.CLI_PROXY_BASE_URL;
  if (envKey) {
    if (!envBase) {
      throw new Error('已设置 CLI_PROXY_API_KEY 时，必须同时设置 CLI_PROXY_BASE_URL（OpenAI 兼容接口根路径，例如 https://your-proxy.example/v1）');
    }
    return {
      apiKey: envKey,
      baseUrl: normalizeBaseUrl(envBase),
      providerName: process.env.CLI_PROXY_PROVIDER_NAME || 'Environment',
      source: 'environment'
    };
  }

  // 2) In-app third-party API config (user-friendly, stored under data/)
  const userCfg = readUserApiConfig();
  if (userCfg) {
    return {
      apiKey: userCfg.apiKey,
      baseUrl: userCfg.baseUrl,
      providerName: userCfg.providerName,
      source: 'user-config'
    };
  }

  // 3) Local WorkBuddy models.json (optional)
  if (!fs.existsSync(WORKBUDDY_MODELS)) {
    throw new Error('尚未配置模型 API。请在应用内打开「API 接入」填写第三方 OpenAI 兼容的 Base URL 与 API Key，或设置环境变量 CLI_PROXY_API_KEY / CLI_PROXY_BASE_URL。');
  }
  const parsed = JSON.parse(fs.readFileSync(WORKBUDDY_MODELS, 'utf8'));
  const models = Array.isArray(parsed) ? parsed : parsed.models || [];
  const nameHint = String(process.env.CLI_PROXY_PROVIDER_NAME || 'CLI Proxy API').toLowerCase();
  const model =
    models.find((item) =>
      item && item.apiKey && typeof item.url === 'string' &&
      String(item.name || '').toLowerCase().includes(nameHint)
    ) ||
    models.find((item) => item && item.apiKey && typeof item.url === 'string');
  if (!model) {
    throw new Error('本地 WorkBuddy 配置中未找到可用的 API 条目。请在应用内「API 接入」填写第三方模型，或完善 WorkBuddy / 环境变量。');
  }
  const chatUrl = new URL(model.url);
  const basePath = chatUrl.pathname.replace(/\/chat\/completions\/?$/, '').replace(/\/$/, '');
  return {
    apiKey: model.apiKey,
    baseUrl: `${chatUrl.origin}${basePath}`,
    providerName: String(model.name || 'WorkBuddy'),
    source: 'workbuddy'
  };
}

function tryLoadConnection() {
  try {
    return loadConnection();
  } catch {
    return null;
  }
}

async function proxyJson(url, options, timeoutMs = 120000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { ...options, signal: controller.signal });
    const raw = await response.text();
    let data;
    try {
      data = raw ? JSON.parse(raw) : {};
    } catch {
      data = { raw };
    }
    if (!response.ok) {
      const detail = data.error?.message || data.error || data.message || raw || response.statusText;
      throw new Error(`上游接口 ${response.status}：${detail}`);
    }
    return data;
  } finally {
    clearTimeout(timer);
  }
}

function authHeaders(connection) {
  return {
    Authorization: `Bearer ${connection.apiKey}`,
    'Content-Type': 'application/json'
  };
}

function isImagesApiOnlyModel(model) {
  const id = String(model || '').toLowerCase();
  // 这些模型在 CLI Proxy 上通常只开放 images 路由，chat 会 503
  if (/grok-imagine-image/.test(id)) return true;
  if (/gpt-image/.test(id)) return true;
  if (/dall-e|dalle/.test(id)) return true;
  if (/flux/.test(id) && !/chat/.test(id)) return true;
  return false;
}

function formatImageRouteError(model, errors, { imagesApiOnly }) {
  const detail = errors.map((error) => String(error?.message || error)).filter(Boolean).join(' | ');
  if (imagesApiOnly) {
    return `图片模型 ${model} 仅支持 /images 接口。${detail || '请检查 NAS 代理与模型可用性。'}`;
  }
  return detail || `图片生成失败（模型 ${model}）`;
}

function extractImage(result) {
  const first = Array.isArray(result.data) ? result.data[0] : null;
  if (first?.b64_json) return { src: `data:image/png;base64,${first.b64_json}`, revisedPrompt: first.revised_prompt };
  if (first?.url) return { src: first.url, revisedPrompt: first.revised_prompt };

  const message = result.choices?.[0]?.message;
  const messageImages = Array.isArray(message?.images) ? message.images : [];
  for (const item of messageImages) {
    const url = item?.image_url?.url || item?.image_url || item?.url;
    if (url) return { src: url };
    if (item?.b64_json) return { src: `data:image/png;base64,${item.b64_json}` };
  }
  const content = message?.content;
  if (Array.isArray(content)) {
    for (const part of content) {
      const url = part?.image_url?.url || part?.image_url || part?.url;
      if (url) return { src: url };
      if (part?.b64_json) return { src: `data:image/png;base64,${part.b64_json}` };
    }
  }
  if (typeof content === 'string') {
    const dataUrl = content.match(/data:image\/[^;]+;base64,[A-Za-z0-9+/=]+/);
    if (dataUrl) return { src: dataUrl[0] };
    const markdown = content.match(/!\[[^\]]*\]\((https?:\/\/[^)]+)\)/);
    if (markdown) return { src: markdown[1] };
    const plainUrl = content.match(/https?:\/\/\S+\.(?:png|jpe?g|webp)(?:\?\S*)?/i);
    if (plainUrl) return { src: plainUrl[0] };
    if (/^[\[{]/.test(content.trim())) {
      try {
        const nested = JSON.parse(content);
        if (nested !== result) return extractImage(nested);
      } catch { /* content is not JSON */ }
    }
  }
  const outputItems = [result.images, result.output, result.artifacts].flat().filter(Boolean);
  for (const item of outputItems) {
    const url = item?.image_url?.url || item?.image_url || item?.url;
    if (url) return { src: url };
    if (item?.b64_json || item?.base64) return { src: `data:image/png;base64,${item.b64_json || item.base64}` };
  }
  throw new Error('模型已返回结果，但未找到可显示的图片。可尝试切换图片模型。');
}

function safeProjectId(value) {
  const id = String(value || '').trim().replace(/[^a-zA-Z0-9_-]/g, '-').replace(/-+/g, '-');
  return id.slice(0, 80) || `book-${Date.now()}`;
}

async function handleApi(req, res, pathname) {
  try {
    if (req.method === 'GET' && pathname === '/api/health') {
      // Server is healthy even when model API is not configured yet (desktop shell depends on ok:true).
      const connection = tryLoadConnection();
      const userCfg = readUserApiConfig();
      const info = publicConnectionInfo(connection, {
        usageStats: loadUsage(),
        hasUserConfig: Boolean(userCfg),
        envConfigured: Boolean(process.env.CLI_PROXY_API_KEY && process.env.CLI_PROXY_BASE_URL),
        sources: {
          environment: Boolean(process.env.CLI_PROXY_API_KEY),
          userConfig: Boolean(userCfg),
          workbuddy: fs.existsSync(WORKBUDDY_MODELS)
        }
      });
      return sendJson(res, 200, {
        ...info,
        ok: true,
        configured: Boolean(connection),
        ownedBy: process.env.STUDIO_OWNED_BY || null,
        pid: process.pid
      });
    }

    if (req.method === 'GET' && pathname === '/api/connection-config') {
      const connection = tryLoadConnection();
      const userCfg = readUserApiConfig();
      return sendJson(res, 200, {
        ...publicConnectionInfo(connection),
        hasUserConfig: Boolean(userCfg),
        userConfig: userCfg
          ? {
            baseUrl: userCfg.baseUrl,
            providerName: userCfg.providerName,
            apiKeyMasked: maskSecret(userCfg.apiKey),
            updatedAt: userCfg.updatedAt
          }
          : null,
        envConfigured: Boolean(process.env.CLI_PROXY_API_KEY && process.env.CLI_PROXY_BASE_URL),
        note: '优先级：环境变量 > 应用内 API 接入 > 本地 WorkBuddy。密钥不会返回明文。'
      });
    }

    if (req.method === 'POST' && pathname === '/api/connection-config') {
      const body = await readJsonBody(req);
      const action = String(body.action || 'save').toLowerCase();
      if (action === 'clear') {
        clearUserApiConfig();
        const connection = tryLoadConnection();
        return sendJson(res, 200, {
          ok: true,
          cleared: true,
          ...publicConnectionInfo(connection),
          message: connection
            ? `已清除应用内配置，当前改用：${connection.source}`
            : '已清除应用内配置。请重新填写第三方 API，或配置环境变量 / WorkBuddy。'
        });
      }

      // action=test: probe /models without writing user-api-config.json
      // action=save (default): persist then optionally verify
      if (action === 'test') {
        const credentials = normalizeUserApiCredentials({
          apiKey: body.apiKey,
          baseUrl: body.baseUrl,
          providerName: body.providerName,
          allowReuseExistingKey: true
        });
        let test;
        try {
          test = await testUserApiConnection(credentials);
        } catch (error) {
          test = { ok: false, message: error.message || String(error) };
        }
        return sendJson(res, 200, {
          ok: true,
          saved: false,
          ...publicConnectionInfo({
            apiKey: credentials.apiKey,
            baseUrl: credentials.baseUrl,
            providerName: credentials.providerName,
            source: 'user-config'
          }),
          test,
          message: test.ok ? `测试成功：${test.message}` : `测试失败：${test.message}`
        });
      }

      if (action !== 'save') {
        return sendJson(res, 400, { error: `未知 action：${action}（支持 save / test / clear）` });
      }

      const credentials = normalizeUserApiCredentials({
        apiKey: body.apiKey,
        baseUrl: body.baseUrl,
        providerName: body.providerName,
        allowReuseExistingKey: true
      });
      const saved = writeUserApiConfig(credentials);

      // Optional connectivity test against /models
      let test = null;
      if (body.test !== false) {
        try {
          test = await testUserApiConnection(saved);
        } catch (error) {
          test = { ok: false, message: error.message || String(error) };
        }
      }

      return sendJson(res, 200, {
        ok: true,
        saved: true,
        ...publicConnectionInfo({
          apiKey: saved.apiKey,
          baseUrl: saved.baseUrl,
          providerName: saved.providerName,
          source: 'user-config'
        }),
        test,
        message: test?.ok
          ? `已保存并验证：${test.message}`
          : (test ? `已保存，但验证失败：${test.message}` : '已保存第三方 API 配置')
      });
    }

    if (req.method === 'GET' && pathname === '/api/models') {
      const connection = loadConnection();
      const result = await proxyJson(`${connection.baseUrl}/models`, { headers: authHeaders(connection) }, 30000);
      const models = (result.data || [])
        .map((item) => ({ id: item.id, ownedBy: item.owned_by || '' }))
        .filter((item) => isAllowedTextModel(item.id) || isAllowedImageModel(item.id));
      return sendJson(res, 200, {
        models,
        policy: {
          image: '仅保留 Grok / Gemini 图片模型',
          text: `仅保留高能力文本模型（能力分 ≥ ${TEXT_MODEL_MIN_SCORE}），并按启动探测可用性排序`
        },
        usageStats: loadUsage()
      });
    }

    if (req.method === 'GET' && pathname === '/api/model-catalog') {
      const connection = loadConnection();
      const result = await proxyJson(`${connection.baseUrl}/models`, { headers: authHeaders(connection) }, 30000);
      const ids = (result.data || []).map((item) => item.id).filter(Boolean);
      return sendJson(res, 200, {
        catalog: buildModelCatalog(ids),
        probe: {
          running: probeState.running,
          done: probeState.done,
          startedAt: probeState.startedAt,
          finishedAt: probeState.finishedAt,
          error: probeState.error,
          summary: probeState.summary
            ? {
              textProbed: probeState.summary.textProbed,
              imageProbed: probeState.summary.imageProbed,
              textAvailable: probeState.summary.textAvailable,
              imageAvailable: probeState.summary.imageAvailable
            }
            : null
        },
        updatedAt: new Date().toISOString(),
        usageStats: loadUsage()
      });
    }

    if (req.method === 'POST' && pathname === '/api/probe-models') {
      const body = await readJsonBody(req).catch(() => ({}));
      const force = Boolean(body && body.force);
      // Manual probe defaults to full (text+image). Pass includeImages:false to skip paid image probes.
      const includeImages = body && Object.prototype.hasOwnProperty.call(body, 'includeImages')
        ? Boolean(body.includeImages)
        : true;
      const result = await runModelAvailabilityProbe({ force, includeImages });
      return sendJson(res, 200, {
        ok: true,
        catalog: result.catalog,
        probe: result.probe,
        usageStats: loadUsage(),
        updatedAt: new Date().toISOString()
      });
    }

    if (req.method === 'GET' && pathname === '/api/model-usage') {
      return sendJson(res, 200, { usage: loadUsage() });
    }

    if (req.method === 'POST' && pathname === '/api/shutdown') {
      const body = await readJsonBody(req).catch(() => ({}));
      const ownedByDesktop = process.env.STUDIO_OWNED_BY === 'desktop';
      const force = Boolean(body && body.force);
      if (!ownedByDesktop && !force) {
        return sendJson(res, 200, {
          ok: false,
          skipped: true,
          reason: '当前服务非桌面壳托管，已跳过关闭以免误杀共享实例。需要强制关闭时请传 { "force": true }。'
        });
      }
      sendJson(res, 200, { ok: true, shuttingDown: true });
      setTimeout(() => {
        try { server.close(); } catch { /* ignore */ }
        process.exit(0);
      }, 120);
      return;
    }

    if (req.method === 'POST' && pathname === '/api/chat') {
      const body = await readJsonBody(req);
      const connection = loadConnection();
      const payload = {
        model: body.model || 'gpt-5.6-sol',
        messages: Array.isArray(body.messages) ? body.messages : [],
        temperature: Number.isFinite(body.temperature) ? body.temperature : 0.8,
        max_tokens: body.maxTokens || 4096,
        stream: false
      };
      if (body.jsonMode) payload.response_format = { type: 'json_object' };
      let result;
      try {
        result = await proxyJson(`${connection.baseUrl}/chat/completions`, {
          method: 'POST',
          headers: authHeaders(connection),
          body: JSON.stringify(payload)
        });
        const tokens = extractTokens(result) || Math.ceil(JSON.stringify(payload.messages).length / 3);
        markModelStatus(payload.model, 'available', '已实测可用', '最近文本请求成功', { tokens });
      } catch (error) {
        markModelStatus(payload.model, 'unavailable', '请求失败', error.message.slice(0, 180), { tokens: 0 });
        throw error;
      }
      return sendJson(res, 200, {
        content: result.choices?.[0]?.message?.content || '',
        model: result.model || payload.model,
        usage: result.usage || null,
        usageStats: loadUsage()
      });
    }

    if (req.method === 'POST' && pathname === '/api/generate-image') {
      const body = await readJsonBody(req);
      const connection = loadConnection();
      const model = body.model || 'grok-imagine-image';
      const referenceImages = Array.isArray(body.referenceImages) ? body.referenceImages.filter(Boolean).slice(0, 4) : [];
      const artStyle = String(body.artStyle || '温暖水彩儿童绘本');
      const consistencyNote = String(body.consistencyNote || '').trim();
      const consistencyMode = body.consistencyMode !== false;

      // 部分代理模型（如 grok-imagine-image / gpt-image-*）只允许 images 端点，
      // 禁止走 /chat/completions；有参考图时只能把一致性约束写进文字 prompt。
      const imagesApiOnly = isImagesApiOnlyModel(model);

      const isFirstFrame = body.isFirstFrame === true || body.isFirstFrame === 'true';
      const styleGuard = consistencyMode
        ? [
          `【整本画风锁定】${artStyle}。`,
          '媒介：children\'s picture book illustration / hand-painted 2D art only。',
          '全书插画必须像同一位绘者连续创作：同一画材、同一造型语言、同一色彩体系。',
          '禁止：真人照片、摄影感、照片风格漫画、半写实、live-action comic、超写实皮肤、电影剧照。',
          '禁止：3D/CG、次世代渲染、中途换风格、改变既定角色外形。',
          isFirstFrame
            ? '【首帧】本页是全书画风标准页：必须确立正确的手绘绘本插画风格，供后续页跟随。'
            : '',
          consistencyNote
        ].filter(Boolean).join('\n')
        : '';

      const refTextGuide = referenceImages.length
        ? [
          imagesApiOnly
            ? '【一致性说明（本模型 images 接口不支持附图直传，以下约束必须严格遵守）】'
            : '【一致性说明（已附参考图，请视觉对齐）】',
          '1) 保持已设定角色的物种、五官、服装、配色与体型，不得改成真人。',
          '2) 保持全书同一儿童绘本画风与色彩体系；若参考图偏照片写实，忽略摄影感，仍输出绘本插画。',
          '3) 绘制本页新分镜场景，不要复制旧页构图。',
          `4) 参考图数量：${referenceImages.length}（角色/画风）。`
        ].join('\n')
        : (isFirstFrame
          ? '【无风格参考图】请仅凭文字锁定：手绘儿童绘本插画，禁止照片与照片风漫画。'
          : '');

      const finalPrompt = [styleGuard, refTextGuide, body.prompt].filter(Boolean).join('\n\n');

      const generationPayload = {
        model,
        prompt: finalPrompt,
        size: body.size || '1536x1024',
        n: 1,
        response_format: 'b64_json'
      };

      const chatContent = referenceImages.length
        ? [
          { type: 'text', text: finalPrompt },
          ...referenceImages.map((url) => ({ type: 'image_url', image_url: { url } }))
        ]
        : finalPrompt;

      const chatPayload = {
        model,
        messages: [{ role: 'user', content: chatContent }],
        stream: false
      };

      const errors = [];
      let result;

      const tryImagesGenerations = async () => {
        result = await proxyJson(`${connection.baseUrl}/images/generations`, {
          method: 'POST',
          headers: authHeaders(connection),
          body: JSON.stringify(generationPayload)
        }, 300000);
      };

      const tryChatCompletions = async () => {
        result = await proxyJson(`${connection.baseUrl}/chat/completions`, {
          method: 'POST',
          headers: authHeaders(connection),
          body: JSON.stringify(chatPayload)
        }, 300000);
      };

      // 路由策略：
      // 1) images-only 模型：只打 /images/generations（绝不回退 chat）
      // 2) 其他模型：无参考图先 generations，再 chat；有参考图先 chat，再 generations
      if (imagesApiOnly) {
        try {
          await tryImagesGenerations();
        } catch (error) {
          errors.push(error);
          markModelStatus(model, 'unavailable', '请求失败', String(error.message || error).slice(0, 180), { tokens: 0 });
          throw new Error(formatImageRouteError(model, errors, { imagesApiOnly: true }));
        }
      } else if (referenceImages.length) {
        try {
          await tryChatCompletions();
        } catch (error) {
          errors.push(error);
          try {
            await tryImagesGenerations();
          } catch (error2) {
            errors.push(error2);
            markModelStatus(model, 'unavailable', '请求失败', String(errors[0].message || errors[0]).slice(0, 180), { tokens: 0 });
            throw new Error(formatImageRouteError(model, errors, { imagesApiOnly: false }));
          }
        }
      } else {
        try {
          await tryImagesGenerations();
        } catch (error) {
          errors.push(error);
          try {
            await tryChatCompletions();
          } catch (error2) {
            errors.push(error2);
            markModelStatus(model, 'unavailable', '请求失败', String(errors[0].message || errors[0]).slice(0, 180), { tokens: 0 });
            throw new Error(formatImageRouteError(model, errors, { imagesApiOnly: false }));
          }
        }
      }

      const image = extractImage(result);
      markModelStatus(model, 'available', '已实测可用', '最近图片请求成功', { tokens: extractTokens(result) || 1200 });
      return sendJson(res, 200, { ...image, model, usageStats: loadUsage() });
    }

    if (req.method === 'GET' && pathname === '/api/knowledge') {
      return sendJson(res, 200, { items: listKnowledge() });
    }

    if (req.method === 'POST' && pathname === '/api/knowledge') {
      const body = await readJsonBody(req);
      const content = String(body.content || '').trim();
      if (!content) throw new Error('知识库内容不能为空');
      const id = `kb-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
      const saved = {
        id,
        title: String(body.title || '未命名资料').slice(0, 120),
        content,
        updatedAt: new Date().toISOString()
      };
      fs.writeFileSync(path.join(KNOWLEDGE_DIR, `${id}.json`), JSON.stringify(saved, null, 2), 'utf8');
      return sendJson(res, 200, {
        ok: true,
        item: { id, title: saved.title, characters: content.length, updatedAt: saved.updatedAt, preview: content.slice(0, 160) }
      });
    }

    if (req.method === 'DELETE' && pathname.startsWith('/api/knowledge/')) {
      const id = safeProjectId(decodeURIComponent(pathname.slice('/api/knowledge/'.length)));
      const target = path.join(KNOWLEDGE_DIR, `${id}.json`);
      if (!fs.existsSync(target)) return sendJson(res, 404, { error: '知识库条目不存在' });
      fs.rmSync(target, { force: true });
      return sendJson(res, 200, { ok: true });
    }

    if (req.method === 'POST' && pathname === '/api/import-document') {
      const body = await readJsonBody(req);
      const fileName = safeFileName(body.fileName, 'document.txt');
      const extension = path.extname(fileName).toLowerCase();
      if (!['.txt', '.md', '.json', '.doc', '.docx', '.rtf'].includes(extension)) throw new Error('支持 TXT、MD、JSON、DOC、DOCX、RTF 文件');
      if (!body.dataBase64) throw new Error('文档内容为空');
      const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'studio-import-'));
      const inputPath = path.join(tempDir, `input${extension}`);
      try {
        fs.writeFileSync(inputPath, Buffer.from(body.dataBase64, 'base64'));
        let text;
        if (['.txt', '.md', '.json'].includes(extension)) {
          text = fs.readFileSync(inputPath, 'utf8');
        } else {
          text = runUtf8PowerShell(path.join(ROOT, 'scripts', 'extract-document.ps1'), '-InputPath $env:STUDIO_INPUT_PATH', { STUDIO_INPUT_PATH: inputPath }, { encoding: 'utf8' });
        }
        text = String(text).replace(/\r\n/g, '\n').replace(/\r/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
        return sendJson(res, 200, { fileName, extension, text, characters: text.length });
      } finally {
        fs.rmSync(tempDir, { recursive: true, force: true });
      }
    }

    if (req.method === 'POST' && pathname === '/api/save-export') {
      const body = await readJsonBody(req);
      const fileName = safeFileName(body.fileName, 'export.bin');
      const base64 = String(body.base64 || '').replace(/\s+/g, '');
      if (!base64) throw new Error('导出内容为空');
      let bytes;
      try {
        bytes = Buffer.from(base64, 'base64');
      } catch {
        throw new Error('导出数据解码失败');
      }
      if (!bytes.length) throw new Error('导出内容为空');
      const dir = downloadsDir();
      const target = ensureUniqueFilePath(path.join(dir, fileName));
      fs.writeFileSync(target, bytes);
      return sendJson(res, 200, {
        ok: true,
        path: target,
        fileName: path.basename(target),
        bytes: bytes.length,
        folder: dir
      });
    }

    if (req.method === 'POST' && pathname === '/api/export-pptx') {
      const body = await readJsonBody(req);
      if (!body.presentation?.slides?.length) throw new Error('没有可导出的 PPT 页面');
      const baseName = safeFileName(body.presentation.title, '心理课课件');
      const jobId = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
      const jsonPath = path.join(EXPORTS_DIR, `${jobId}.json`);
      const outputPath = path.join(EXPORTS_DIR, `${jobId}.pptx`);
      try {
        fs.writeFileSync(jsonPath, JSON.stringify(body.presentation, null, 2), 'utf8');
        runUtf8PowerShell(path.join(ROOT, 'scripts', 'export-ppt.ps1'), '-JsonPath $env:STUDIO_JSON_PATH -OutputPath $env:STUDIO_OUTPUT_PATH', { STUDIO_JSON_PATH: jsonPath, STUDIO_OUTPUT_PATH: outputPath }, { timeout: 120000, maxBuffer: 4 * 1024 * 1024 });
        return sendDownload(res, outputPath, `${baseName}.pptx`, 'application/vnd.openxmlformats-officedocument.presentationml.presentation');
      } finally {
        for (const file of [jsonPath, outputPath]) if (fs.existsSync(file)) fs.rmSync(file, { force: true });
      }
    }

    if (req.method === 'POST' && pathname === '/api/export-docx') {
      const body = await readJsonBody(req);
      if (!body.plan) throw new Error('没有可导出的教案');
      const baseName = safeFileName(body.plan.title, '小学心理课教案');
      const jobId = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
      const jsonPath = path.join(EXPORTS_DIR, `${jobId}.json`);
      const outputPath = path.join(EXPORTS_DIR, `${jobId}.docx`);
      try {
        fs.writeFileSync(jsonPath, JSON.stringify(body.plan, null, 2), 'utf8');
        runUtf8PowerShell(path.join(ROOT, 'scripts', 'export-docx.ps1'), '-JsonPath $env:STUDIO_JSON_PATH -OutputPath $env:STUDIO_OUTPUT_PATH', { STUDIO_JSON_PATH: jsonPath, STUDIO_OUTPUT_PATH: outputPath }, { timeout: 120000, maxBuffer: 4 * 1024 * 1024 });
        return sendDownload(res, outputPath, `${baseName}.docx`, 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
      } finally {
        for (const file of [jsonPath, outputPath]) if (fs.existsSync(file)) fs.rmSync(file, { force: true });
      }
    }

    if (req.method === 'GET' && pathname === '/api/projects') {
      const projects = fs.readdirSync(PROJECTS_DIR)
        .filter((name) => name.endsWith('.json'))
        .map((name) => {
          try {
            const file = path.join(PROJECTS_DIR, name);
            const value = JSON.parse(fs.readFileSync(file, 'utf8'));
            return {
              id: path.basename(name, '.json'),
              title: value.title || '未命名绘本',
              updatedAt: value.updatedAt || fs.statSync(file).mtime.toISOString(),
              pageCount: Array.isArray(value.pages) ? value.pages.length : 0
            };
          } catch {
            return null;
          }
        })
        .filter(Boolean)
        .sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
      return sendJson(res, 200, { projects });
    }

    if (req.method === 'POST' && pathname === '/api/projects/save') {
      const body = await readJsonBody(req);
      const project = body.project;
      if (!project || typeof project !== 'object') throw new Error('缺少项目数据');
      const id = safeProjectId(project.id || project.title);
      const saved = { ...project, id, updatedAt: new Date().toISOString() };
      const target = path.join(PROJECTS_DIR, `${id}.json`);
      const temp = `${target}.tmp`;
      fs.writeFileSync(temp, JSON.stringify(saved, null, 2), 'utf8');
      fs.renameSync(temp, target);
      return sendJson(res, 200, { ok: true, project: saved, path: target });
    }

    if (req.method === 'GET' && pathname.startsWith('/api/projects/')) {
      const id = safeProjectId(decodeURIComponent(pathname.slice('/api/projects/'.length)));
      const target = path.join(PROJECTS_DIR, `${id}.json`);
      if (!fs.existsSync(target)) return sendJson(res, 404, { error: '项目不存在' });
      return sendJson(res, 200, { project: JSON.parse(fs.readFileSync(target, 'utf8')) });
    }

    return sendJson(res, 404, { error: '接口不存在' });
  } catch (error) {
    const message = error.name === 'AbortError' ? '请求超时，请稍后重试' : error.message;
    return sendJson(res, 500, { error: message });
  }
}

function isPathInside(parentDir, candidatePath) {
  const parent = path.resolve(parentDir);
  const candidate = path.resolve(candidatePath);
  const relative = path.relative(parent, candidate);
  if (!relative || relative === '') return true;
  // Windows: reject absolute escapes and any .. segment; compare case-insensitively
  if (path.isAbsolute(relative)) return false;
  if (relative.split(path.sep).includes('..')) return false;
  if (process.platform === 'win32') {
    return candidate.toLowerCase().startsWith(parent.toLowerCase() + path.sep)
      || candidate.toLowerCase() === parent.toLowerCase();
  }
  return candidate.startsWith(parent + path.sep) || candidate === parent;
}

function serveStatic(req, res, pathname) {
  const requested = pathname === '/' ? '/index.html' : pathname;
  let decoded;
  try {
    decoded = decodeURIComponent(requested);
  } catch {
    sendJson(res, 400, { error: '无效的资源路径' });
    return;
  }
  // Strip leading slashes so resolve never treats the join as absolute on Windows
  const relativeRequest = decoded.replace(/^[/\\]+/, '');
  const target = path.resolve(PUBLIC_DIR, relativeRequest);
  if (!isPathInside(PUBLIC_DIR, target) || !fs.existsSync(target) || fs.statSync(target).isDirectory()) {
    sendJson(res, 404, { error: '文件不存在' });
    return;
  }
  const body = fs.readFileSync(target);
  res.writeHead(200, {
    'Content-Type': MIME[path.extname(target).toLowerCase()] || 'application/octet-stream',
    'Content-Length': body.length,
    'Cache-Control': target.endsWith('.html') ? 'no-cache' : 'public, max-age=300'
  });
  res.end(body);
}

const server = http.createServer(async (req, res) => {
  const requestUrl = new URL(req.url, `http://${req.headers.host || `${HOST}:${PORT}`}`);
  if (requestUrl.pathname.startsWith('/api/')) {
    await handleApi(req, res, requestUrl.pathname);
  } else {
    serveStatic(req, res, requestUrl.pathname);
  }
});

server.on('error', (error) => {
  if (error && error.code === 'EADDRINUSE') {
    console.error(`端口 ${HOST}:${PORT} 已被占用。请关闭占用该端口的进程，或设置环境变量 PORT 使用其他端口。`);
  } else {
    console.error(`本地服务启动失败：${error && error.message ? error.message : error}`);
  }
  process.exit(1);
});

server.listen(PORT, HOST, () => {
  console.log(`儿童心理绘本工坊已启动：http://${HOST}:${PORT}`);
  if (process.env.STUDIO_OWNED_BY === 'desktop') {
    console.log('服务托管模式：desktop（仅桌面壳可正常关闭本进程）');
  }
  try {
    const connection = loadConnection();
    // 不打印完整 baseUrl / 密钥，避免泄露本地代理接入信息
    console.log(`模型 API 已就绪（来源：${connection.source}）`);
  } catch (error) {
    console.warn(`模型 API 尚未就绪：${error.message}`);
  }
  // 启动后自动探测：默认仅文本，避免每次启动消耗图片配额
  // STUDIO_SKIP_AUTO_PROBE=1 跳过；STUDIO_AUTO_PROBE_IMAGES=1 启用启动时图片探测
  if (process.env.STUDIO_SKIP_AUTO_PROBE !== '1') {
    const autoProbeImages = process.env.STUDIO_AUTO_PROBE_IMAGES === '1';
    setTimeout(() => {
      runModelAvailabilityProbe({ force: true, includeImages: autoProbeImages }).catch((error) => {
        console.warn(`自动模型检测未完成：${error.message || error}`);
      });
    }, 400);
    if (!autoProbeImages) {
      console.log('自动模型检测：仅文本（设置 STUDIO_AUTO_PROBE_IMAGES=1 可启用图片探测）');
    }
  } else {
    console.log('已跳过自动模型检测（STUDIO_SKIP_AUTO_PROBE=1）');
  }
});
