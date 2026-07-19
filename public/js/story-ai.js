'use strict';

/* story-ai: prompts, story gen, page/character images, save project */

function getArtStylePreset() {
  if (!project.settings) project.settings = {};
  let id = project.settings.artStyleId;
  if (!id || !ART_STYLE_PRESETS[id]) {
    // 兼容旧项目：按中文标签反查
    const label = project.settings.artStyle || '';
    const found = Object.values(ART_STYLE_PRESETS).find((item) => item.label === label);
    id = found?.id || 'warm-watercolor';
    project.settings.artStyleId = id;
  }
  const preset = ART_STYLE_PRESETS[id] || ART_STYLE_PRESETS['warm-watercolor'];
  project.settings.artStyle = preset.label;
  return preset;
}

function lockedCharacterPrompt() {
  const locked = project.characters.filter((character) => character.locked);
  const pool = locked.length ? locked : project.characters;
  if (!pool.length) {
    return '角色一致性：根据本页文案设计角色后，全书必须沿用同一造型，不得换脸换装换画风。';
  }
  return `角色一致性（全书强制同一造型，禁止换脸/换装/换物种）：${pool.map((character) => {
    const lockTag = character.locked ? '已锁定' : '建议锁定';
    return `${character.name}（${lockTag}）：外形=${character.appearance || '待补充'}；性格气质=${character.traits || '温和'}`;
  }).join('。')}`;
}

function pageSceneBrief(page) {
  const raw = String(page.prompt || '').trim();
  // 若旧提示词里混入了画风/写实词，丢弃，改从文案重建，避免「照片风」残留
  if (raw && !/(真人|写实|照片|摄影|3D|CG|二次元|赛博|live-?action|photoreal)/i.test(raw)) {
    // 去掉旧“画风/限制”段，只保留场景语义
    const sceneOnly = raw
      .split('\n')
      .filter((line) => !/^(用途|画风|构图|限制|角色一致性|统一画风|硬性禁止|输出要求|【)/.test(line.trim()))
      .join('\n')
      .trim();
    // 仍含写实倾向词则不用
    if (sceneOnly.length > 12 && !/(照片|写实|摄影|真人|镜头|景深)/i.test(sceneOnly)) {
      return sceneOnly.slice(0, 420);
    }
  }
  return `场景：${page.text || page.title || '根据故事情节设计画面'}；情绪氛围：${page.emotion || project.settings?.theme || '安全、温暖'}。请用儿童绘本插画方式表现，不要拍成照片。`;
}

function buildImagePrompt(page = currentPage(), options = {}) {
  const style = getArtStylePreset();
  const index = Math.max(1, project.pages.indexOf(page) + 1);
  const total = project.pages.length || 1;
  const isFirstFrame = index === 1 || options.forceFirstFrameLock;
  let scene = options.sceneOverride || pageSceneBrief(page);
  // 用户手写分镜若带写实词，剥离后仍套绘本画风
  if (options.sceneOverride && /(照片|写实|摄影|真人|photoreal|live-?action)/i.test(String(options.sceneOverride))) {
    scene = String(options.sceneOverride)
      .replace(/(照片级?|写实|摄影|真人|photorealistic|live-?action)/gi, '绘本插画')
      .slice(0, 420);
  }
  const prompt = [
    `【绘本连续插画 · 手绘 2D】《${project.title || '未命名绘本'}》第 ${index} / ${total} 页。`,
    '媒介声明：children\'s picture book illustration，hand-painted 2D art，NOT a photograph，NOT photorealistic comic。',
    style.bible,
    isFirstFrame ? FIRST_FRAME_STYLE_LOCK : '必须与整本其他页同一画风、同一角色造型、同一色彩体系（跟随已生成页的画材与造型）。',
    lockedCharacterPrompt(),
    `本页分镜：${scene}`,
    '构图：4:3 横版儿童绘本，主体中上部，下方保留约 28% 安静空白供排版；表情清晰可读。',
    `硬性禁止：${STYLE_HARD_NEGATIVES}。`,
    '输出要求：只画本页场景，保持与全书视觉连贯，不要新增无关角色，不要改变既定角色关键识别特征。'
  ].filter(Boolean).join('\n');
  page.prompt = prompt;
  if (!options.silent && $('#imagePromptInput') && page === currentPage()) {
    $('#imagePromptInput').value = prompt;
  }
  scheduleLocalSave();
  return prompt;
}

function rebuildAllPagePrompts() {
  project.pages.forEach((page) => buildImagePrompt(page, { silent: true }));
  if (currentPage()) $('#imagePromptInput').value = currentPage().prompt || '';
  scheduleLocalSave();
}

function collectImageReferences(page, options = {}) {
  const refs = [];
  const seen = new Set();
  const push = (src) => {
    if (!src || seen.has(src) || src === page?.image) return; // 绝不把「本页旧图」当参考（避免重生成时锁死错误照片风）
    seen.add(src);
    refs.push(src);
  };

  // 1) 角色设定图：外形锚点（优先）
  project.characters
    .filter((character) => character.image && (character.locked || options.includeUnlockedCharacters))
    .forEach((character) => push(character.image));

  // 2) 风格锚点：其他页的已生成图（排除本页）
  if (options.styleAnchor && options.styleAnchor !== page?.image) push(options.styleAnchor);
  if (options.includeBookStyleAnchor !== false) {
    const firstStyled = project.pages.find((item) => item.image && item !== page);
    if (firstStyled?.image) push(firstStyled.image);
    const pageIndex = project.pages.indexOf(page);
    if (pageIndex > 0) {
      for (let i = pageIndex - 1; i >= 0; i -= 1) {
        const prev = project.pages[i];
        if (prev.image && prev !== page) {
          push(prev.image);
          break;
        }
      }
    }
  }

  return refs.slice(0, 4);
}

function consistencyInstruction(hasCharacterRef, hasStyleRef, { isFirstFrame = false } = {}) {
  const parts = [
    '你正在为同一本儿童心理绘本绘制连续插画。',
    '必须输出手绘 2D 儿童绘本插画：可见画材笔触，卡通/绘本造型，禁止照片与照片风格漫画。',
    '必须保持全书画风、线条、上色方式、色彩饱和度、角色外形 100% 一致。'
  ];
  if (isFirstFrame) {
    parts.push('本页是全书首帧画风锚点：请确立正确的水彩/彩铅/扁平绘本风格，后续页将跟随。');
  }
  if (hasCharacterRef) parts.push('前序附图包含角色设定图：严格按设定图的物种、五官、服装、配色绘制，不得改成真人或其他风格角色。若设定图偏写实，仍按儿童绘本插画语言重绘角色。');
  if (hasStyleRef) parts.push('附图中另有已生成的绘本页作为画风连续性参考：只继承其画材/笔触/色彩体系，不要复制其构图与场景；若参考图偏照片写实，忽略其摄影感，仍输出绘本插画。');
  parts.push('本页必须是新的分镜场景。禁止输出照片写实、半写实真人漫画。');
  return parts.join('');
}

function parseJsonResponse(content) {
  const cleaned = String(content).trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  try { return JSON.parse(cleaned); } catch {
    const start = cleaned.indexOf('{');
    const end = cleaned.lastIndexOf('}');
    if (start >= 0 && end > start) return JSON.parse(cleaned.slice(start, end + 1));
    throw new Error('AI 返回内容不是有效 JSON，请重试');
  }
}

async function createStoryWithAi() {
  const outline = $('#outlineTextInput').value.trim();
  const pageCount = Math.max(4, Math.min(24, Number($('#pageCountInput').value) || 8));
  const age = $('#ageSelect').value;
  const theme = $('#themeSelect').value;
  const storyStyle = $('#storyStyleSelect').value;
  const prompt = `你是一位儿童心理学背景的绘本作家。请根据输入创作一本完整中文儿童心理绘本。
适读年龄：${age}
心理主题：${theme}
叙事风格：${storyStyle}
页数：严格 ${pageCount} 页
用户大纲：${outline || '一个孩子在生活中遇到心理困扰，通过安全的关系与小行动逐渐获得成长。'}

要求：不说教、不贴标签，不制造羞耻或恐惧；每页 30-90 个汉字；情节有起承转合；结尾提供希望但不承诺问题瞬间消失。角色外形必须提供可用于图片生成的一致性锚点。
只输出 JSON，结构为：{"title":"书名","characters":[{"name":"名字","appearance":"稳定具体的外形锚点","traits":"性格","locked":true}],"pages":[{"title":"页标题","text":"正文","emotion":"本页心理目标","prompt":"具体画面分镜提示词"}]}。`;

  setBusy(true, 'AI 正在创作完整绘本', `规划 ${pageCount} 页故事与角色（可随时中断）`);
  try {
    throwIfCancelled();
    const result = await api('/api/chat', {
      method: 'POST',
      body: JSON.stringify({ model: $('#textModelSelect').value, messages: [{ role: 'user', content: prompt }], maxTokens: 8000, jsonMode: true })
    });
    throwIfCancelled();
    const value = parseJsonResponse(result.content);
    project.title = value.title || project.title;
    project.settings = { ...project.settings, age, theme, storyStyle, artStyleId: project.settings?.artStyleId || 'warm-watercolor' };
    getArtStylePreset();
    project.characters = (value.characters || []).map((character) => ({ id: uid('char'), image: '', locked: true, ...character }));
    project.pages = (value.pages || []).slice(0, pageCount).map((page, index) => defaultPage(index, page));
    if (!project.pages.length) throw new Error('AI 没有返回页面内容');
    // 丢弃模型自由发挥的分镜词里的画风漂移，统一重建一致性提示词
    rebuildAllPagePrompts();
    activePageIndex = 0;
    activeCharacterIndex = 0;
    $('#outlineDialog').close();
    renderAll();
    toast(`已生成 ${project.pages.length} 页完整绘本（已统一画风提示词）`, 'success');
  } catch (error) {
    handleTaskError(error, '创作绘本失败');
  } finally {
    setBusy(false);
  }
}

function importOutlineByLines() {
  const raw = $('#outlineTextInput').value.trim();
  if (!raw) return toast('请先粘贴或选择大纲文件', 'error');
  try {
    const json = JSON.parse(raw);
    const items = Array.isArray(json) ? json : json.pages;
    if (!Array.isArray(items)) throw new Error('JSON 中未找到 pages 数组');
    project.pages = items.map((item, index) => defaultPage(index, typeof item === 'string' ? { text: item } : item));
  } catch {
    const lines = raw.split(/\r?\n/).map((line) => line.replace(/^\s*(?:[-*]|\d+[.、])\s*/, '').trim()).filter(Boolean);
    project.pages = lines.map((line, index) => {
      const [title, ...text] = line.split(/[：:]/);
      return defaultPage(index, { title: text.length ? title : `第 ${index + 1} 页`, text: text.length ? text.join('：').trim() : line });
    });
  }
  activePageIndex = 0;
  $('#outlineDialog').close();
  renderAll();
  toast(`已导入 ${project.pages.length} 页大纲`, 'success');
}

async function transformPageText(mode) {
  const page = currentPage();
  const instructions = {
    polish: '润色得更有画面感和节奏，但不增加复杂情节',
    shorten: '精简到原长度约 60%，保留情绪与关键动作',
    rewrite: '重新创作同一情节，语言自然、温暖、不说教'
  };
  setBusy(true, 'AI 正在修改文案', `${page.title}（可随时中断）`);
  try {
    throwIfCancelled();
    const result = await api('/api/chat', {
      method: 'POST',
      body: JSON.stringify({
        model: $('#textModelSelect').value || 'gpt-5.6-sol',
        messages: [{ role: 'user', content: `面向 ${project.settings.age || '5-7 岁'} 儿童，${instructions[mode]}。心理目标：${page.emotion}。只输出改写后的正文，不加标题或说明。\n\n原文：${page.text}` }],
        maxTokens: 1200
      })
    });
    throwIfCancelled();
    page.text = result.content.trim().replace(/^['“"]|['”"]$/g, '');
    renderInspector(); renderStage(); scheduleLocalSave();
  } catch (error) {
    handleTaskError(error, '修改文案失败');
  } finally { setBusy(false); }
}

async function generatePageImage(page = currentPage(), silent = false, options = {}) {
  // 始终套整本一致性外壳，避免各页自由提示词导致卡通/真人混搭
  const pageIndex = project.pages.indexOf(page);
  const isFirstFrame = pageIndex <= 0
    || !project.pages.some((item, idx) => idx !== pageIndex && item.image);

  let sceneOverride;
  if (!silent && page === currentPage()) {
    const typed = ($('#imagePromptInput')?.value || '').trim();
    // 用户改过的完整一致性词可直接用；否则只把非模板内容当「分镜」
    if (typed && !typed.includes('【绘本连续插画')) sceneOverride = typed;
  }

  // 首帧或重生成第一页时强制重建提示词（避免沿用旧照片风 prompt）
  const shouldForceRebuild = isFirstFrame || options.forceRebuildPrompt;
  const prompt = (!shouldForceRebuild && options.keepPrompt && page.prompt?.trim())
    ? page.prompt.trim()
    : buildImagePrompt(page, {
      silent,
      sceneOverride,
      forceFirstFrameLock: isFirstFrame
    });

  // 参考图：绝不包含本页旧图；首帧仅角色设定图（若有）
  let referenceImages = options.referenceImages
    || collectImageReferences(page, {
      styleAnchor: isFirstFrame ? null : options.styleAnchor,
      includeBookStyleAnchor: !isFirstFrame
    });
  // 双重保险：过滤本页旧图
  if (page.image) referenceImages = referenceImages.filter((src) => src !== page.image);

  const hasCharacterRef = project.characters.some((character) => character.image && character.locked)
    && referenceImages.some((src) => project.characters.some((c) => c.image === src));
  const hasStyleRef = referenceImages.some((src) => project.pages.some((p) => p !== page && p.image === src));

  if (!silent) {
    setBusy(
      true,
      'AI 正在绘制本页',
      isFirstFrame
        ? `${page.title}（首帧画风锚点 · 强制绘本插画，禁止照片风）`
        : `${page.title}（统一绘本画风中，可随时中断）`
    );
  }
  try {
    throwIfCancelled();
    const result = await api('/api/generate-image', {
      method: 'POST',
      body: JSON.stringify({
        model: $('#imageModelSelect').value || 'grok-imagine-image',
        prompt,
        size: '1536x1024',
        referenceImages,
        consistencyMode: true,
        consistencyNote: consistencyInstruction(hasCharacterRef, hasStyleRef, { isFirstFrame }),
        artStyle: getArtStylePreset().label,
        isFirstFrame
      })
    });
    throwIfCancelled();
    page.image = result.src;
    page.demoArt = false;
    page.prompt = prompt;
    renderPageList(); renderStage(); renderInspector(); scheduleLocalSave();
    if (!silent) {
      toast(
        isFirstFrame
          ? '首帧插画已生成（已锁定绘本画风，若偏照片请点「重建一致性分镜词」后重生成）'
          : (hasCharacterRef || hasStyleRef ? '本页插画已生成（已套用一致性约束）' : '本页插画已生成'),
        'success'
      );
    }
    return true;
  } catch (error) {
    if (isAbortError(error) || cancelRequested) throw error;
    if (!silent) toast(error.message, 'error');
    return false;
  } finally {
    if (!silent) setBusy(false);
  }
}

async function batchGenerateImages() {
  const targets = project.pages.filter((page) => !page.image);
  if (!targets.length) return toast('所有页面都已有插画');

  const lockedWithArt = project.characters.filter((character) => character.locked && character.image);
  if (!lockedWithArt.length) {
    const proceed = window.confirm(
      '当前没有“已锁定且有设定图”的角色。\n\n批量出图时角色与画风更容易漂移。\n建议先到「角色」生成设定图并锁定，再批量出图。\n\n仍要继续吗？'
    );
    if (!proceed) return;
  }

  // 批量前统一重写全部提示词，锁定画风圣经
  rebuildAllPagePrompts();

  setBusy(true, '批量生成绘本插画', `统一绘本画风生成 ${targets.length} 页（首帧将作为全书锚点）`);
  const batchSignal = activeAbort?.signal;
  let success = 0;
  let cancelled = false;
  // 风格锚点：优先其他已有页；批量过程中滚动更新（不含正在生成页的旧图）
  let styleAnchor = project.pages.find((page) => page.image && !targets.includes(page))?.image || null;

  try {
    for (let index = 0; index < targets.length; index += 1) {
      if (cancelRequested || batchSignal?.aborted) {
        cancelled = true;
        break;
      }
      const page = targets[index];
      const isBatchFirst = !styleAnchor;
      $('#busyDetail').textContent = isBatchFirst
        ? `首帧画风锚点 ${index + 1} / ${targets.length}：${page.title}`
        : `统一画风绘制 ${index + 1} / ${targets.length}：${page.title}`;
      try {
        const refs = collectImageReferences(page, {
          styleAnchor,
          includeBookStyleAnchor: Boolean(styleAnchor)
        });
        const ok = await generatePageImage(page, true, {
          styleAnchor,
          referenceImages: refs,
          forceRebuildPrompt: isBatchFirst
        });
        if (ok) {
          success += 1;
          styleAnchor = page.image || styleAnchor;
        }
      } catch (error) {
        if (isAbortError(error) || cancelRequested) {
          cancelled = true;
          break;
        }
      }
    }
    renderAll();
    if (cancelled || cancelRequested) {
      cancelNoticeShown = false;
      toast(`已中断批量出图：已完成 ${success} 页（已尽量保持画风一致）`, '');
      cancelNoticeShown = true;
    } else {
      toast(`批量生成完成：成功 ${success} 页，失败 ${targets.length - success} 页（已启用整本一致性）`, success ? 'success' : 'error');
    }
  } finally { setBusy(false); }
}

async function generateCharacterImage() {
  const character = currentCharacter();
  const style = getArtStylePreset();
  const prompt = [
    '儿童绘本角色设定图，供后续整本插画保持外形一致。',
    style.bible,
    `角色：${character.name}。固定外形：${character.appearance}。性格气质：${character.traits}。`,
    '画面：正面全身站姿 + 侧面小姿态 + 三种温和表情，纯净浅色背景，轮廓清楚，五官与服装细节稳定可复用。',
    `硬性禁止：${STYLE_HARD_NEGATIVES}。`
  ].join('\n');
  setBusy(true, 'AI 正在设计角色', `${character.name}（可随时中断）`);
  try {
    throwIfCancelled();
    const result = await api('/api/generate-image', {
      method: 'POST',
      body: JSON.stringify({
        model: $('#imageModelSelect').value || 'grok-imagine-image',
        prompt,
        size: '1024x1024',
        consistencyMode: true,
        consistencyNote: '这是角色设定图，后续页必须严格沿用该外形与画风。',
        artStyle: style.label
      })
    });
    throwIfCancelled();
    character.image = result.src;
    character.locked = true;
    renderCharacters(); scheduleLocalSave();
    if ($('#characterPreviewDialog')?.open) openCharacterPreviewDialog();
    toast('角色设定图已生成并锁定，批量出图将优先对齐该外形', 'success');
  } catch (error) {
    handleTaskError(error, '生成角色失败');
  } finally { setBusy(false); }
}

async function saveProject() {
  project.title = $('#projectTitle').value.trim() || '未命名绘本';
  setBusy(true, '正在保存项目', '写入本地项目文件', { cancellable: true });
  try {
    const result = await api('/api/projects/save', { method: 'POST', body: JSON.stringify({ project }) });
    project = result.project;
    scheduleLocalSave();
    toast('项目已保存到本地', 'success');
  } catch (error) {
    handleTaskError(error, '保存失败');
  } finally { setBusy(false); }
}
