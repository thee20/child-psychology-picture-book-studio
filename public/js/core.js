'use strict';

/* core: helpers, project state, toast/busy, api, autosave */

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => Array.from(document.querySelectorAll(selector));
const uid = (prefix = 'id') => `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
const clone = (value) => JSON.parse(JSON.stringify(value));

const defaultTextStyle = () => ({
  fontFamily: "'Microsoft YaHei', 'PingFang SC', sans-serif",
  fontSize: 34,
  lineHeight: 1.6,
  color: '#22302a',
  bgColor: '#fffdf7',
  bgOpacity: 84,
  width: 72,
  height: 0, // 0 = 自适应内容高度
  x: 14,
  y: 66,
  align: 'center',
  bubbleShape: 'rounded', // rounded | speech | cloud | caption | square | none
  borderColor: '#d4c4a8',
  borderWidth: 2,
  borderRadius: 16,
  tail: 'bottom' // speech bubble tail
});

const defaultPage = (index, seed = {}) => ({
  id: uid('page'),
  title: seed.title || `第 ${index + 1} 页`,
  text: seed.text || '',
  emotion: seed.emotion || '认识并表达情绪',
  note: seed.note || '',
  prompt: seed.prompt || '',
  image: seed.image || '',
  demoArt: Boolean(seed.demoArt),
  imageFit: 'cover',
  imageX: 50,
  imageScale: 100,
  textStyle: { ...defaultTextStyle(), ...(seed.textStyle || {}) }
});

const starterPages = [
  defaultPage(0, {
    title: '风吹来的早晨',
    text: '清晨的风轻轻吹过森林，小刺猬栗栗把一颗小石子装进了口袋。\n“今天，我也想试着勇敢一点。”',
    emotion: '培养自信与勇气',
    prompt: '温暖的水彩儿童绘本插画，清晨森林，小刺猬站在小路边，把一颗发光的小石子装进口袋，柔和晨光，留出下方文字空间，4:3 横版，无文字，无水印',
    demoArt: true
  }),
  defaultPage(1, { title: '会说话的口袋', text: '每当栗栗有一点点害怕，口袋里的石子就会暖暖地发光。', emotion: '建立安全感' }),
  defaultPage(2, { title: '黑黑的树洞', text: '树洞里传来细小的哭声。栗栗的脚有些发抖，但他没有转身离开。', emotion: '认识并表达情绪' }),
  defaultPage(3, { title: '勇气原来在这里', text: '栗栗终于明白，勇气不是从不害怕，而是害怕时仍愿意向前走一步。', emotion: '培养自信与勇气' })
];

const ART_STYLE_PRESETS = {
  'warm-watercolor': {
    id: 'warm-watercolor',
    label: '温暖水彩儿童绘本',
    bible: [
      '统一画风（整本必须完全一致，像同一位绘者完成）：',
      '纯手绘 2D 温暖水彩儿童绘本插画（children\'s picture book illustration），',
      '轻薄水彩叠加、可见纸张肌理与笔触，柔和自然光，低对比，边缘柔和，色彩温柔饱和适中，',
      '角色造型圆润可爱、比例儿童绘本化，明确是绘本插画而不是照片。'
    ].join('')
  },
  'soft-crayon': {
    id: 'soft-crayon',
    label: '柔和彩铅绘本',
    bible: [
      '统一画风（整本必须完全一致）：',
      '纯手绘 2D 柔和彩铅与淡彩儿童绘本插画，细腻笔触与手绘颗粒，温暖色调，',
      '角色比例儿童绘本化，画面干净柔和，明确是绘本插画而不是照片或写实漫画。'
    ].join('')
  },
  'flat-picturebook': {
    id: 'flat-picturebook',
    label: '扁平儿童绘本',
    bible: [
      '统一画风（整本必须完全一致）：',
      '纯手绘 2D 现代扁平插画儿童绘本，干净色块，柔和描边，简洁造型，',
      '统一线条粗细与配色系统，适合低幼阅读，禁止照片质感与写实光影。'
    ].join('')
  },
  'storybook-gouache': {
    id: 'storybook-gouache',
    label: '水粉故事绘本',
    bible: [
      '统一画风（整本必须完全一致）：',
      '纯手绘 2D 水粉/丙烯质感儿童故事绘本，厚涂但不写实，柔和阴影，童话感构图，',
      '角色外形稳定、颜色体系统一，明确是绘本插画，禁止照片级写实。'
    ].join('')
  }
};

const STYLE_HARD_NEGATIVES = [
  '严禁切换画风',
  '严禁真人实拍、照片级写实、电影剧照、摄影棚打光、镜头景深、超写实皮肤与毛孔',
  '严禁照片风格漫画、半写实漫画、真人漫画、live-action comic、photorealistic illustration',
  '严禁 3D 渲染、CG、次世代游戏截图、塑料感建模、Unreal/Octane 渲染感',
  '严禁突然变成日系二次元厚涂、美漫、暗黑写实、赛博朋克等其他风格',
  '严禁每页角色五官、服装、体型发生明显变化',
  '画面内不要出现任何文字、字母、数字、标志或水印'
].join('；');

/** 首帧 / 无风格锚点时额外加锁，防止 Grok 等模型漂成「照片风漫画」 */
const FIRST_FRAME_STYLE_LOCK = [
  '【首帧画风锚点】本页是全书视觉标准页，后续页将严格跟随本页画风。',
  '必须输出：手绘儿童绘本插画、可见画材笔触、柔和卡通造型。',
  '绝对禁止：真实照片、摄影感、照片风格漫画、半写实、真人皮肤质感、电影截图。'
].join('');

const initialProject = () => ({
  id: uid('book'),
  title: '小刺猬的勇气口袋',
  updatedAt: new Date().toISOString(),
  settings: {
    age: '5-7 岁',
    theme: '勇气与自信',
    storyStyle: '温柔诗意',
    artStyleId: 'warm-watercolor',
    artStyle: ART_STYLE_PRESETS['warm-watercolor'].label
  },
  characters: [
    {
      id: uid('char'),
      name: '栗栗',
      appearance: '一只圆滚滚的小刺猬，浅棕色短刺，米白色小肚皮，左耳旁有一片嫩绿色叶子，背着墨绿色小挎包',
      traits: '敏感、善良、愿意尝试',
      locked: true,
      image: ''
    }
  ],
  pages: starterPages
});

let project = initialProject();
let activePageIndex = 0;
let activeCharacterIndex = 0;
let models = [];
let modelCatalog = { text: [], image: [] };
let modelUsage = { session: {}, models: {} };
let activeCatalogType = 'text';
let teacherMode = 'plan';
let teacherData = { plan: null, ppt: null, handout: null };
let knowledgeItems = [];
let selectedKnowledgeIds = new Set();
let lastCallInfo = { ok: null, message: '尚未调用', ms: null };
let zoom = 0.82;
let saveTimer = null;
let drag = null;
let charViewer = { zoom: 1, dragging: false, startX: 0, startY: 0, scrollLeft: 0, scrollTop: 0 };

function applyBubbleStyle(overlay, style) {
  const shape = style.bubbleShape || 'rounded';
  overlay.className = `text-overlay is-selected bubble-${shape}${shape === 'speech' ? ` tail-${style.tail || 'bottom'}` : ''}`;
  const borderWidth = Number(style.borderWidth) || 0;
  const borderColor = style.borderColor || '#d4c4a8';
  const radius = Number(style.borderRadius) ?? 16;
  if (shape === 'none') {
    overlay.style.background = 'transparent';
    overlay.style.border = '1px dashed transparent';
    overlay.style.borderRadius = '8px';
    overlay.style.boxShadow = 'none';
    return;
  }
  overlay.style.background = rgba(style.bgColor, style.bgOpacity);
  overlay.style.border = `${borderWidth}px solid ${borderColor}`;
  if (shape === 'square') overlay.style.borderRadius = '4px';
  else if (shape === 'caption') overlay.style.borderRadius = '0';
  else if (shape === 'cloud') overlay.style.borderRadius = `${Math.max(radius, 28)}px`;
  else overlay.style.borderRadius = `${radius}px`;
  overlay.style.boxShadow = shape === 'speech' || shape === 'rounded'
    ? '0 10px 24px rgba(36,52,47,.12)'
    : shape === 'cloud'
      ? '0 8px 20px rgba(36,52,47,.1)'
      : 'none';
  // CSS variables for tail color
  overlay.style.setProperty('--bubble-bg', rgba(style.bgColor, style.bgOpacity));
  overlay.style.setProperty('--bubble-border', borderColor);
  overlay.style.setProperty('--bubble-border-w', `${borderWidth}px`);
}

function currentPage() { return project.pages[activePageIndex]; }
function currentCharacter() { return project.characters[activeCharacterIndex]; }

function rgba(hex, opacity) {
  const value = hex.replace('#', '');
  const normalized = value.length === 3 ? value.split('').map((c) => c + c).join('') : value;
  const number = Number.parseInt(normalized, 16);
  return `rgba(${(number >> 16) & 255}, ${(number >> 8) & 255}, ${number & 255}, ${opacity / 100})`;
}

function escapeHtml(text) {
  return String(text ?? '').replace(/[&<>'"]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[char]);
}

function toast(message, type = '') {
  const item = document.createElement('div');
  item.className = `toast ${type ? `is-${type}` : ''}`;
  item.textContent = message;
  $('#toastRegion').appendChild(item);
  setTimeout(() => item.remove(), 3600);
}

let activeAbort = null;
let cancelRequested = false;
let cancelNoticeShown = false;
let busyForceCloseTimer = null;

function isAbortError(error) {
  return error?.name === 'AbortError'
    || /abort|cancel|取消|中断/i.test(String(error?.message || error || ''));
}

function beginCancellableTask() {
  cancelRequested = false;
  cancelNoticeShown = false;
  if (activeAbort) {
    try { activeAbort.abort(); } catch { /* ignore */ }
  }
  activeAbort = new AbortController();
  return activeAbort.signal;
}

function setBusy(active, title = 'AI 正在创作', detail = '请稍候', options = {}) {
  const cancellable = options.cancellable !== false;
  if (busyForceCloseTimer) {
    clearTimeout(busyForceCloseTimer);
    busyForceCloseTimer = null;
  }
  $('#busyOverlay').hidden = !active;
  $('#busyTitle').textContent = title;
  $('#busyDetail').textContent = detail;
  const cancelBtn = $('#cancelBusyBtn');
  if (cancelBtn) {
    cancelBtn.hidden = !active || !cancellable;
    cancelBtn.disabled = false;
    cancelBtn.textContent = '中断取消';
  }
  if (active && cancellable) beginCancellableTask();
  if (!active) {
    activeAbort = null;
    cancelRequested = false;
  }
}

function notifyCancelled() {
  if (cancelNoticeShown) return;
  cancelNoticeShown = true;
  toast('已中断取消当前创作', '');
}

function cancelBusyTask() {
  if ($('#busyOverlay')?.hidden) return;
  cancelRequested = true;
  const cancelBtn = $('#cancelBusyBtn');
  if (cancelBtn) {
    cancelBtn.disabled = true;
    cancelBtn.textContent = '正在取消…';
  }
  $('#busyDetail').textContent = '正在中断当前创作，请稍候…';
  if (activeAbort) {
    try { activeAbort.abort(); } catch { /* ignore */ }
  }
  // 防止请求卡死时遮罩不关闭
  busyForceCloseTimer = setTimeout(() => {
    if (!$('#busyOverlay').hidden) {
      notifyCancelled();
      setBusy(false);
    }
  }, 1200);
}

function throwIfCancelled() {
  if (cancelRequested || activeAbort?.signal?.aborted) {
    const error = new Error('已取消');
    error.name = 'AbortError';
    throw error;
  }
}

async function api(path, options = {}) {
  const started = performance.now();
  const signal = options.signal || activeAbort?.signal;
  try {
    const response = await fetch(path, {
      ...options,
      signal,
      headers: { 'Content-Type': 'application/json', ...(options.headers || {}) }
    });
    const data = await response.json().catch(() => ({}));
    const ms = Math.round(performance.now() - started);
    if (data.usageStats) modelUsage = data.usageStats;
    if (!response.ok) {
      lastCallInfo = { ok: false, message: data.error || `请求失败（${response.status}）`, ms };
      updateModelUsageBar();
      throw new Error(data.error || `请求失败（${response.status}）`);
    }
    if (path.includes('/chat') || path.includes('/generate-image')) {
      lastCallInfo = { ok: true, message: '调用成功', ms };
      updateModelUsageBar();
    }
    return data;
  } catch (error) {
    if (isAbortError(error) || cancelRequested) {
      const abortError = new Error('已取消');
      abortError.name = 'AbortError';
      throw abortError;
    }
    throw error;
  }
}

function handleTaskError(error, fallbackMessage = '操作失败') {
  if (isAbortError(error) || cancelRequested) {
    notifyCancelled();
    return true;
  }
  toast(error?.message || fallbackMessage, 'error');
  return false;
}

function updateModelUsageBar() {
  const bar = $('#modelUsageBar');
  if (!bar) return;
  const session = modelUsage.session || {};
  const total = session.totalCalls || 0;
  const ok = session.successCalls || 0;
  const fail = session.failedCalls || 0;
  const tokens = session.totalTokens || 0;
  const last = lastCallInfo.ok == null
    ? '最近：尚未调用'
    : `最近：${lastCallInfo.ok ? '成功' : '失败'}${lastCallInfo.ms != null ? ` ${lastCallInfo.ms}ms` : ''} · ${lastCallInfo.message}`;
  bar.textContent = `本会话调用 ${total} 次（成功 ${ok} / 失败 ${fail}）· Token 约 ${tokens} · ${last}`;
}

async function refreshModelUsage() {
  try {
    const result = await fetch('/api/model-usage').then((r) => r.json());
    if (result.usage) {
      modelUsage = result.usage;
      updateModelUsageBar();
    }
  } catch { /* ignore */ }
}

const AUTOSAVE_KEY = 'picture-book-studio-autosave';
/** 仅用于迁移更早版本草稿键；不作为产品标识展示 */
const AUTOSAVE_KEY_LEGACY = ['xinyu-picture-book-autosave'];

function readLegacyAutosaveRaw() {
  for (const key of AUTOSAVE_KEY_LEGACY) {
    try {
      const raw = localStorage.getItem(key);
      if (raw) return raw;
    } catch { /* ignore */ }
  }
  return null;
}

function clearLegacyAutosaveKeys() {
  for (const key of AUTOSAVE_KEY_LEGACY) {
    try { localStorage.removeItem(key); } catch { /* ignore */ }
  }
}

function projectForLocalDraft(source, { stripImages = false } = {}) {
  const draft = clone(source);
  draft.updatedAt = new Date().toISOString();
  if (stripImages) {
    draft.pages = (draft.pages || []).map((page) => ({
      ...page,
      image: '',
      demoArt: false
    }));
    draft.characters = (draft.characters || []).map((character) => ({
      ...character,
      image: ''
    }));
    draft._draftNote = 'images-stripped-due-to-storage-quota';
  }
  return draft;
}

function writeLocalDraft(draft) {
  localStorage.setItem(AUTOSAVE_KEY, JSON.stringify(draft));
  clearLegacyAutosaveKeys();
}

function scheduleLocalSave() {
  clearTimeout(saveTimer);
  const status = $('#autosaveStatus');
  if (status) status.textContent = '正在记录修改…';
  saveTimer = setTimeout(() => {
    try {
      const full = projectForLocalDraft(project, { stripImages: false });
      writeLocalDraft(full);
      if (status) status.textContent = '已自动保存到本地';
    } catch (error) {
      const quota = error && (error.name === 'QuotaExceededError' || /quota|exceeded|storage/i.test(String(error.message || error)));
      if (quota) {
        try {
          const light = projectForLocalDraft(project, { stripImages: true });
          writeLocalDraft(light);
          if (status) status.textContent = '本地草稿已降级保存（插画过大未写入）';
          toast('本地自动草稿空间不足：已保存文案与设定，插画请点「保存」写入项目文件', 'error');
          return;
        } catch { /* fall through */ }
      }
      if (status) status.textContent = '本地自动保存失败';
      toast(quota ? '本地自动草稿空间不足，请尽快点「保存」' : '本地自动保存失败，请尽快点「保存」', 'error');
    }
  }, 350);
}

function loadAutosave() {
  try {
    const fromCurrent = localStorage.getItem(AUTOSAVE_KEY);
    const raw = fromCurrent || readLegacyAutosaveRaw();
    const saved = raw ? JSON.parse(raw) : null;
    if (saved?.pages?.length) {
      project = saved;
      project.settings = { artStyleId: 'warm-watercolor', ...(project.settings || {}) };
      getArtStylePreset();
      project.pages = project.pages.map((page, index) => ({
        ...defaultPage(index),
        ...page,
        textStyle: { ...defaultTextStyle(), ...(page.textStyle || {}) }
      }));
      // Migrate legacy key once we successfully load
      try {
        if (!fromCurrent && readLegacyAutosaveRaw()) {
          writeLocalDraft(projectForLocalDraft(project));
        }
      } catch { /* ignore migration failure */ }
    }
  } catch { /* ignore broken local draft */ }
}
