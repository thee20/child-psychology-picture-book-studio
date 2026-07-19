'use strict';

/**
 * Split public/app.js into domain modules under public/js/.
 * Reads the current git HEAD version of app.js so UTF-8 Chinese is preserved.
 */
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const dir = path.join(root, 'public', 'js');

function readAppJsFromGit() {
  try {
    return execFileSync('git', ['show', 'HEAD:public/app.js'], {
      cwd: root,
      encoding: 'utf8',
      maxBuffer: 20 * 1024 * 1024
    });
  } catch {
    // Fallback: if HEAD already has a loader, use a backup or working tree sibling
    const backup = path.join(root, 'public', 'app.js.bak');
    if (fs.existsSync(backup)) return fs.readFileSync(backup, 'utf8');
    throw new Error('Cannot read app.js from git HEAD and no public/app.js.bak');
  }
}

const data = readAppJsFromGit().replace(/\r\n/g, '\n').replace(/\r/g, '\n');
const lines = data.split('\n');
const total = lines.length;
console.log('total lines:', total);

// If HEAD is already a loader, abort
if (total < 200 || !lines.some((l) => l.includes('function renderPageList'))) {
  throw new Error('HEAD public/app.js does not look like the full app (already split?)');
}

const find = (re) => {
  const idx = lines.findIndex((l) => re.test(l));
  if (idx < 0) throw new Error(`marker not found: ${re}`);
  return idx + 1; // 1-based
};

const marks = {
  renderPageList: find(/^function renderPageList/),
  normalizeModelName: find(/^function normalizeModelName/),
  getArtStylePreset: find(/^function getArtStylePreset/),
  selectedKnowledge: find(/^function selectedKnowledgeContext/),
  exportSection: find(/绘本多格式导出/),
  loadKnowledge: find(/^async function loadKnowledge/),
  init: find(/^async function init/)
};
console.log('marks', marks);

const parts = [
  { name: 'core.js', start: 1, end: marks.renderPageList - 1, banner: '/* core: helpers, project state, toast/busy, api, autosave */' },
  { name: 'render.js', start: marks.renderPageList, end: marks.normalizeModelName - 1, banner: '/* render: stage, pages, characters, inspector */' },
  { name: 'api-models.js', start: marks.normalizeModelName, end: marks.getArtStylePreset - 1, banner: '/* api-models: connection config, model catalog, usage */' },
  { name: 'story-ai.js', start: marks.getArtStylePreset, end: marks.selectedKnowledge - 1, banner: '/* story-ai: prompts, story gen, page/character images, save project */' },
  { name: 'teacher.js', start: marks.selectedKnowledge, end: marks.exportSection - 1, banner: '/* teacher: lesson plan / ppt helpers */' },
  { name: 'export-book.js', start: marks.exportSection, end: marks.loadKnowledge - 1, banner: '/* export-book: canvas PDF/ZIP, knowledge list UI, document import */' },
  { name: 'app-main.js', start: marks.loadKnowledge, end: total, banner: '/* app-main: knowledge load, bindings, zoom, init */' }
];

fs.mkdirSync(dir, { recursive: true });
for (const p of parts) {
  if (p.start < 1 || p.end < p.start) throw new Error(`bad range ${JSON.stringify(p)}`);
  const slice = lines.slice(p.start - 1, p.end);
  // Drop a leading 'use strict' from first slice if present (we add our own)
  while (slice.length && (slice[0] === "'use strict';" || slice[0] === '"use strict";' || slice[0] === '')) {
    if (slice[0] === "'use strict';" || slice[0] === '"use strict";') {
      slice.shift();
      if (slice[0] === '') slice.shift();
      break;
    }
    slice.shift();
  }
  const body = [`'use strict';`, '', p.banner, '', ...slice].join('\n').replace(/\n+$/, '\n');
  fs.writeFileSync(path.join(dir, p.name), body, 'utf8');
  console.log(p.name, `${p.start}-${p.end}`, 'bytes', Buffer.byteLength(body, 'utf8'));
}

const loader = [
  "'use strict';",
  '/* Stable entry URL. Application logic lives in /js/*.js (loaded by index.html). */',
  ''
].join('\n');
fs.writeFileSync(path.join(root, 'public', 'app.js'), loader, 'utf8');

const core = fs.readFileSync(path.join(dir, 'core.js'), 'utf8');
if (!core.includes('小刺猬')) throw new Error('Chinese text missing from core.js — encoding broken');
console.log('split ok; Chinese preserved');
