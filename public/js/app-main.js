'use strict';

/* app-main: knowledge load, bindings, zoom, init */

async function loadKnowledge() {
  const result = await api('/api/knowledge');
  knowledgeItems = result.items || [];
  renderKnowledgeList();
}

async function saveTextToKnowledge(title, text) {
  if (!text?.trim()) throw new Error('没有可入库的内容');
  await api('/api/knowledge', { method: 'POST', body: JSON.stringify({ title: title || '未命名资料', content: text.trim() }) });
  await loadKnowledge();
}

function openTeacherStudio(mode = 'plan') {
  teacherMode = mode;
  $$('.teacher-tab').forEach((item) => item.classList.toggle('is-active', item.dataset.teacherTab === teacherMode));
  $('#generatePlanBtn').textContent = { plan: 'AI 生成备课教案', ppt: 'AI 生成 PPT 课件', handout: 'AI 生成活动单' }[teacherMode];
  $('#teacherDialogTitle').textContent = mode === 'ppt' ? 'PPT 课件制作' : '心理备课台';
  $('#teacherDialogSubtitle').textContent = mode === 'ppt'
    ? '与绘本并列：导入文档与知识库后生成课件结构、讲稿，并导出 PPTX。'
    : '与绘本并列：导入文档与知识库后生成教案/活动单，并导出 Word。';
  renderTeacherPreview();
  loadKnowledge().catch(() => {});
  $('#teacherDialog').showModal();
}

async function exitApp() {
  if (!window.confirm('确定退出儿童心理绘本工坊吗？\n未点「保存」的内容仍保留在本地自动草稿中。')) return;
  const inWebView = Boolean(window.chrome?.webview?.postMessage);
  if (inWebView) {
    // 桌面壳会在 FormClosed 时结束自己拉起的 Node 子进程，避免误杀备用启动的共享服务
    try { window.chrome.webview.postMessage(JSON.stringify({ type: 'exit' })); } catch { /* ignore */ }
    return;
  }
  try {
    // force:false so browser/备用启动 exit does not kill a desktop-owned Node backend
    await fetch('/api/shutdown', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ force: false })
    });
  } catch { /* ignore */ }
  window.close();
  setTimeout(() => toast('若窗口未关闭，请直接关闭浏览器标签页或桌面程序', 'error'), 600);
}

function bindPageFields() {
  $('#projectTitle').addEventListener('input', (event) => { project.title = event.target.value; scheduleLocalSave(); });
  $('#pageTitleInput').addEventListener('input', (event) => { currentPage().title = event.target.value; renderPageList(); scheduleLocalSave(); });
  $('#pageTextInput').addEventListener('input', (event) => { currentPage().text = event.target.value; renderStage(); $('#charCount').textContent = `${event.target.value.replace(/\s/g,'').length} 字`; scheduleLocalSave(); });
  $('#overlayText').addEventListener('input', (event) => { currentPage().text = event.target.textContent; $('#pageTextInput').value = currentPage().text; scheduleLocalSave(); });
  $('#emotionSelect').addEventListener('change', (event) => { currentPage().emotion = event.target.value; scheduleLocalSave(); });
  $('#editorNoteInput').addEventListener('input', (event) => { currentPage().note = event.target.value; scheduleLocalSave(); });
  $('#imagePromptInput').addEventListener('input', (event) => { currentPage().prompt = event.target.value; scheduleLocalSave(); });
  $('#imageFitSelect').addEventListener('change', (event) => { currentPage().imageFit = event.target.value; renderStage(); scheduleLocalSave(); });
  $('#imageXRange').addEventListener('input', (event) => { currentPage().imageX = Number(event.target.value); renderStage(); scheduleLocalSave(); });
  $('#imageScaleRange').addEventListener('input', (event) => { const value = Number(event.target.value); currentPage().imageScale = value; $('#imageScaleValue').textContent = `${value}%`; renderStage(); scheduleLocalSave(); });
}

function bindTextControls() {
  const update = (key, value) => {
    if (!currentPage().textStyle) currentPage().textStyle = defaultTextStyle();
    currentPage().textStyle[key] = value;
    renderStage();
    scheduleLocalSave();
  };
  $('#fontFamilySelect').addEventListener('change', (event) => update('fontFamily', event.target.value));
  $('#fontSizeRange').addEventListener('input', (event) => { const value = Number(event.target.value); $('#fontSizeValue').textContent = value; update('fontSize', value); });
  $('#lineHeightRange').addEventListener('input', (event) => { const value = Number(event.target.value) / 10; $('#lineHeightValue').textContent = value.toFixed(1); update('lineHeight', value); });
  $('#textColorInput').addEventListener('input', (event) => update('color', event.target.value));
  $('#textBgInput').addEventListener('input', (event) => update('bgColor', event.target.value));
  $('#bgOpacityRange').addEventListener('input', (event) => { const value = Number(event.target.value); $('#bgOpacityValue').textContent = `${value}%`; update('bgOpacity', value); });
  $('#textWidthRange').addEventListener('input', (event) => { const value = Number(event.target.value); $('#textWidthValue').textContent = `${value}%`; update('width', value); });
  $('#textHeightRange')?.addEventListener('input', (event) => {
    const value = Number(event.target.value);
    $('#textHeightValue').textContent = `${value}%`;
    update('height', value);
  });
  $$('#alignControl button').forEach((button) => button.addEventListener('click', () => { update('align', button.dataset.value); renderInspector(); }));
  $$('#bubbleShapeControl button').forEach((button) => button.addEventListener('click', () => {
    update('bubbleShape', button.dataset.value);
    $$('#bubbleShapeControl button').forEach((item) => item.classList.toggle('is-active', item === button));
  }));
  $('#bubbleBorderColor')?.addEventListener('input', (event) => update('borderColor', event.target.value));
  $('#bubbleBorderWidth')?.addEventListener('input', (event) => {
    const value = Number(event.target.value);
    $('#bubbleBorderWidthValue').textContent = value;
    update('borderWidth', value);
  });
  $('#bubbleRadiusRange')?.addEventListener('input', (event) => {
    const value = Number(event.target.value);
    $('#bubbleRadiusValue').textContent = value;
    update('borderRadius', value);
  });
  $$('#bubbleTailControl button').forEach((button) => button.addEventListener('click', () => {
    update('tail', button.dataset.value);
    $$('#bubbleTailControl button').forEach((item) => item.classList.toggle('is-active', item === button));
  }));
  $('#resetTextStyleBtn').addEventListener('click', () => { currentPage().textStyle = defaultTextStyle(); renderStage(); renderInspector(); scheduleLocalSave(); });
}

function bindCharacterFields() {
  $('#addCharacterBtn').addEventListener('click', () => {
    project.characters.push({ id: uid('char'), name: '新角色', appearance: '', traits: '', locked: false, image: '' });
    activeCharacterIndex = project.characters.length - 1; renderCharacters(); scheduleLocalSave();
  });
  $('#characterNameInput').addEventListener('input', (event) => { currentCharacter().name = event.target.value; renderCharacters(); scheduleLocalSave(); });
  $('#characterAppearanceInput').addEventListener('input', (event) => { currentCharacter().appearance = event.target.value; renderCharacters(); scheduleLocalSave(); });
  $('#characterTraitsInput').addEventListener('input', (event) => { currentCharacter().traits = event.target.value; renderCharacters(); scheduleLocalSave(); });
  $('#characterLockInput').addEventListener('change', (event) => { currentCharacter().locked = event.target.checked; renderCharacters(); scheduleLocalSave(); });
  $('#generateCharacterBtn').addEventListener('click', () => generateCharacterImage().catch((error) => toast(error.message, 'error')));
  $('#openCharacterPreviewBtn')?.addEventListener('click', openCharacterPreviewDialog);
  $('#previewGenerateCharacterBtn')?.addEventListener('click', () => generateCharacterImage().catch((error) => toast(error.message, 'error')));
  $('#characterPreviewCard')?.addEventListener('click', openCharacterPreviewDialog);
}

function ensureTextStyle() {
  const page = currentPage();
  if (!page.textStyle) page.textStyle = defaultTextStyle();
  return page.textStyle;
}

function measureOverlayHeightPercent() {
  const overlay = $('#textOverlay');
  const stage = $('#bookStage');
  if (!overlay || !stage) return 22;
  const percent = (overlay.getBoundingClientRect().height / stage.getBoundingClientRect().height) * 100;
  return Math.max(12, Math.min(70, percent || 22));
}

function bindDrag() {
  const overlay = $('#textOverlay');
  overlay.addEventListener('pointerdown', (event) => {
    const style = ensureTextStyle();
    const stageRect = $('#bookStage').getBoundingClientRect();
    const handle = event.target.closest?.('[data-resize]');
    if (handle) {
      event.preventDefault();
      event.stopPropagation();
      if (!style.height || style.height <= 0) style.height = measureOverlayHeightPercent();
      drag = {
        mode: 'resize',
        dir: handle.dataset.resize,
        startX: event.clientX,
        startY: event.clientY,
        x: style.x,
        y: style.y,
        width: style.width,
        height: style.height || measureOverlayHeightPercent(),
        fontSize: style.fontSize,
        stageRect
      };
      overlay.setPointerCapture(event.pointerId);
      return;
    }
    // 点在文字上默认进入编辑；按住边框空白区域可拖动
    if (event.target === $('#overlayText') || event.target.closest?.('.overlay-text')) return;
    drag = {
      mode: 'move',
      startX: event.clientX,
      startY: event.clientY,
      x: style.x,
      y: style.y,
      width: style.width,
      stageRect
    };
    overlay.setPointerCapture(event.pointerId);
  });

  overlay.addEventListener('pointermove', (event) => {
    if (!drag) return;
    const style = ensureTextStyle();
    const dx = (event.clientX - drag.startX) / drag.stageRect.width * 100;
    const dy = (event.clientY - drag.startY) / drag.stageRect.height * 100;

    if (drag.mode === 'move') {
      style.x = Math.max(0, Math.min(100 - style.width, drag.x + dx));
      style.y = Math.max(0, Math.min(90, drag.y + dy));
      renderStage();
      return;
    }

    // resize
    let { x, y, width, height, fontSize } = drag;
    const dir = drag.dir || 'se';
    if (dir.includes('e')) width = drag.width + dx;
    if (dir.includes('w')) {
      width = drag.width - dx;
      x = drag.x + dx;
    }
    if (dir.includes('s')) height = drag.height + dy;
    if (dir.includes('n')) {
      height = drag.height - dy;
      y = drag.y + dy;
    }
    width = Math.max(18, Math.min(95, width));
    height = Math.max(12, Math.min(75, height));
    x = Math.max(0, Math.min(100 - width, x));
    y = Math.max(0, Math.min(92 - height, y));

    // 对角缩放时同步微调字号，更像“放大缩小气泡”
    if ((dir === 'se' || dir === 'nw' || dir === 'ne' || dir === 'sw') && drag.width > 0) {
      const scale = width / drag.width;
      style.fontSize = Math.max(14, Math.min(72, Math.round(drag.fontSize * scale)));
      if ($('#fontSizeRange')) {
        $('#fontSizeRange').value = style.fontSize;
        $('#fontSizeValue').textContent = style.fontSize;
      }
    }

    style.x = x;
    style.y = y;
    style.width = width;
    style.height = height;
    if ($('#textWidthRange')) {
      $('#textWidthRange').value = Math.round(width);
      $('#textWidthValue').textContent = `${Math.round(width)}%`;
    }
    if ($('#textHeightRange')) {
      $('#textHeightRange').value = Math.round(height);
      $('#textHeightValue').textContent = `${Math.round(height)}%`;
    }
    renderStage();
  });

  overlay.addEventListener('pointerup', () => { if (drag) scheduleLocalSave(); drag = null; });
  overlay.addEventListener('pointercancel', () => { drag = null; });

  // 滚轮在文字框上缩放
  overlay.addEventListener('wheel', (event) => {
    if (!overlay.classList.contains('is-selected')) return;
    event.preventDefault();
    const style = ensureTextStyle();
    if (!style.height || style.height <= 0) style.height = measureOverlayHeightPercent();
    const factor = event.deltaY < 0 ? 1.06 : 1 / 1.06;
    const nextW = Math.max(18, Math.min(95, style.width * factor));
    const nextH = Math.max(12, Math.min(75, style.height * factor));
    const cx = style.x + style.width / 2;
    const cy = style.y + style.height / 2;
    style.width = nextW;
    style.height = nextH;
    style.x = Math.max(0, Math.min(100 - nextW, cx - nextW / 2));
    style.y = Math.max(0, Math.min(92 - nextH, cy - nextH / 2));
    style.fontSize = Math.max(14, Math.min(72, Math.round(style.fontSize * factor)));
    if ($('#fontSizeRange')) {
      $('#fontSizeRange').value = style.fontSize;
      $('#fontSizeValue').textContent = style.fontSize;
    }
    if ($('#textWidthRange')) {
      $('#textWidthRange').value = Math.round(nextW);
      $('#textWidthValue').textContent = `${Math.round(nextW)}%`;
    }
    if ($('#textHeightRange')) {
      $('#textHeightRange').value = Math.round(nextH);
      $('#textHeightValue').textContent = `${Math.round(nextH)}%`;
    }
    renderStage();
    scheduleLocalSave();
  }, { passive: false });
}

function bindFiles() {
  $('#chooseOutlineFileBtn').addEventListener('click', () => $('#outlineFileInput').click());
  $('#outlineFileInput').addEventListener('change', async (event) => {
    const file = event.target.files[0];
    if (!file) return;
    setBusy(true, '正在导入大纲文档', `${file.name}（可随时中断）`);
    try {
      const result = await importDocumentFile(file);
      throwIfCancelled();
      $('#outlineTextInput').value = result.text;
      toast(`已读取 ${file.name}，共 ${result.characters} 个字符`, 'success');
    } catch (error) { handleTaskError(error, '导入失败'); }
    finally { setBusy(false); event.target.value = ''; }
  });
  $('#uploadImageBtn').addEventListener('click', () => $('#imageFileInput').click());
  $('#imageFileInput').addEventListener('change', (event) => {
    const file = event.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => { currentPage().image = reader.result; currentPage().demoArt = false; renderAll(); };
    reader.readAsDataURL(file);
  });
  $('#chooseCourseDocBtn')?.addEventListener('click', () => $('#courseDocFileInput').click());
  $('#courseDocFileInput')?.addEventListener('change', async (event) => {
    const file = event.target.files[0];
    if (!file) return;
    setBusy(true, '正在导入文档', `${file.name}（可随时中断）`);
    try {
      const result = await importDocumentFile(file);
      throwIfCancelled();
      $('#courseDocInput').value = result.text;
      toast(`已导入 ${file.name}`, 'success');
    } catch (error) { handleTaskError(error, '导入失败'); }
    finally { setBusy(false); event.target.value = ''; }
  });
  $('#clearCourseDocBtn')?.addEventListener('click', () => { $('#courseDocInput').value = ''; });
  $('#importKnowledgeBtn')?.addEventListener('click', () => $('#knowledgeFileInput').click());
  $('#knowledgeFileInput')?.addEventListener('change', async (event) => {
    const file = event.target.files[0];
    if (!file) return;
    setBusy(true, '正在导入知识库', `${file.name}（可随时中断）`);
    try {
      const result = await importDocumentFile(file);
      throwIfCancelled();
      await saveTextToKnowledge(file.name.replace(/\.[^.]+$/, ''), result.text);
      toast('已加入知识库', 'success');
    } catch (error) { handleTaskError(error, '导入失败'); }
    finally { setBusy(false); event.target.value = ''; }
  });
  $('#saveDocToKnowledgeBtn')?.addEventListener('click', async () => {
    try {
      await saveTextToKnowledge($('#teacherTitleInput').value.trim() || '备课资料', $('#courseDocInput').value);
      toast('已写入知识库', 'success');
    } catch (error) { toast(error.message, 'error'); }
  });
  $('#refreshKnowledgeBtn')?.addEventListener('click', () => loadKnowledge().catch((error) => toast(error.message, 'error')));
}

function bindActions() {
  $$('.inspector-tab').forEach((button) => button.addEventListener('click', () => selectInspectorTab(button.dataset.tab)));
  $$('.workflow-step').forEach((button) => button.addEventListener('click', () => {
    if (button.dataset.openTeacher) {
      openTeacherStudio(button.dataset.openTeacher);
      return;
    }
    $$('.workflow-step').forEach((item) => item.classList.remove('is-active'));
    button.classList.add('is-active');
    const panel = button.dataset.panel;
    if (panel === 'outline') $('#outlineDialog').showModal();
    else selectInspectorTab({ story: 'page', characters: 'character', visual: 'image', editor: 'text' }[panel]);
  }));
  $('#outlineImportBtn').addEventListener('click', () => $('#outlineDialog').showModal());
  $('#parseOutlineBtn').addEventListener('click', importOutlineByLines);
  $('#aiOutlineBtn').addEventListener('click', () => createStoryWithAi().catch((error) => handleTaskError(error)));
  $('#artStyleSelect')?.addEventListener('change', (event) => {
    if (!project.settings) project.settings = {};
    project.settings.artStyleId = event.target.value;
    getArtStylePreset();
    rebuildAllPagePrompts();
    toast(`已切换整本画风为「${project.settings.artStyle}」，并统一全部提示词`, 'success');
  });
  $('#buildPromptBtn').addEventListener('click', () => {
    buildImagePrompt();
    toast('已按整本画风与角色锁定重建本页提示词', 'success');
  });
  $('#rebuildAllPromptsBtn')?.addEventListener('click', () => {
    rebuildAllPagePrompts();
    toast('已为全书页面统一一致性提示词', 'success');
  });
  $('#copyPromptBtn').addEventListener('click', () => navigator.clipboard.writeText($('#imagePromptInput').value).then(() => toast('提示词已复制')));
  $('#generateImageBtn').addEventListener('click', () => generatePageImage().catch((error) => handleTaskError(error)));
  $('#emptyGenerateBtn').addEventListener('click', () => { selectInspectorTab('image'); generatePageImage().catch((error) => handleTaskError(error)); });
  $('#batchImageBtn').addEventListener('click', () => batchGenerateImages().catch((error) => handleTaskError(error)));
  $('#polishTextBtn').addEventListener('click', () => transformPageText('polish').catch((error) => handleTaskError(error)));
  $('#shortenTextBtn').addEventListener('click', () => transformPageText('shorten').catch((error) => handleTaskError(error)));
  $('#regenerateTextBtn').addEventListener('click', () => transformPageText('rewrite').catch((error) => handleTaskError(error)));
  $('#saveBtn').addEventListener('click', () => saveProject().catch((error) => handleTaskError(error)));
  $('#openProjectsBtn').addEventListener('click', () => openProjects().catch((error) => toast(error.message, 'error')));
  $('#exportBtn').addEventListener('click', () => exportBook().catch((error) => handleTaskError(error, '导出绘本失败')));
  $('#exportPdfBtn')?.addEventListener('click', () => {
    try { $('#exportBookDialog')?.close(); } catch { /* ignore */ }
    exportBookAsPdf().catch((error) => handleTaskError(error, '导出 PDF 失败'));
  });
  $('#exportPngZipBtn')?.addEventListener('click', () => {
    try { $('#exportBookDialog')?.close(); } catch { /* ignore */ }
    exportBookAsImageZip('png').catch((error) => handleTaskError(error, '导出 PNG 失败'));
  });
  $('#exportJpegZipBtn')?.addEventListener('click', () => {
    try { $('#exportBookDialog')?.close(); } catch { /* ignore */ }
    exportBookAsImageZip('jpeg').catch((error) => handleTaskError(error, '导出 JPEG 失败'));
  });
  $('#exportPrintBtn')?.addEventListener('click', () => {
    try { $('#exportBookDialog')?.close(); } catch { /* ignore */ }
    exportBookViaPrint().catch((error) => handleTaskError(error, '打开打印失败'));
  });
  $('#helpBtn')?.addEventListener('click', () => $('#helpDialog').showModal());
  $('#exitBtn')?.addEventListener('click', () => exitApp().catch((error) => toast(error.message, 'error')));
  $('#cancelBusyBtn')?.addEventListener('click', cancelBusyTask);
  $('#apiConfigBtn')?.addEventListener('click', () => openApiConfigDialog().catch((error) => toast(error.message, 'error')));
  $('#apiConfigSaveBtn')?.addEventListener('click', () => saveApiConfig({ testOnly: false }).catch((error) => toast(error.message, 'error')));
  $('#apiConfigTestBtn')?.addEventListener('click', () => saveApiConfig({ testOnly: true }).catch((error) => toast(error.message, 'error')));
  $('#apiConfigClearBtn')?.addEventListener('click', () => clearApiConfig().catch((error) => toast(error.message, 'error')));
  $$('[data-api-preset]').forEach((button) => button.addEventListener('click', () => {
    const url = button.getAttribute('data-api-preset') || '';
    if ($('#apiBaseUrlInput')) $('#apiBaseUrlInput').value = url;
  }));
  $('#modelCatalogBtn').addEventListener('click', async () => {
    activeCatalogType = 'text';
    await refreshModelUsage();
    renderModelCatalog();
    $('#modelCatalogDialog').showModal();
  });
  $$('.catalog-tab').forEach((button) => button.addEventListener('click', () => { activeCatalogType = button.dataset.catalog; renderModelCatalog(); }));
  $$('.teacher-tab').forEach((button) => button.addEventListener('click', () => {
    teacherMode = button.dataset.teacherTab;
    $$('.teacher-tab').forEach((item) => item.classList.toggle('is-active', item === button));
    $('#generatePlanBtn').textContent = { plan: 'AI 生成备课教案', ppt: 'AI 生成 PPT 课件', handout: 'AI 生成活动单' }[teacherMode];
    renderTeacherPreview();
  }));
  $('#generatePlanBtn').addEventListener('click', () => generateTeacherMaterial().catch((error) => handleTaskError(error)));
  $('#exportPlanBtn').addEventListener('click', () => exportTeacherPlan().catch((error) => handleTaskError(error)));
  $('#exportPptBtn').addEventListener('click', () => exportTeacherPpt().catch((error) => handleTaskError(error)));

  $('#addPageBtn').addEventListener('click', () => { project.pages.splice(activePageIndex + 1, 0, defaultPage(activePageIndex + 1)); activePageIndex += 1; renderAll(); });
  $('#duplicatePageBtn').addEventListener('click', () => { const page = clone(currentPage()); page.id = uid('page'); page.title = `${page.title}（副本）`; project.pages.splice(activePageIndex + 1, 0, page); activePageIndex += 1; renderAll(); });
  $('#deletePageBtn').addEventListener('click', () => { if (project.pages.length <= 1) return toast('绘本至少需要保留一页', 'error'); project.pages.splice(activePageIndex, 1); activePageIndex = Math.min(activePageIndex, project.pages.length - 1); renderAll(); });
  $('#prevPageBtn').addEventListener('click', () => selectPage(activePageIndex - 1));
  $('#nextPageBtn').addEventListener('click', () => selectPage(activePageIndex + 1));
  $('#zoomInBtn').addEventListener('click', () => setZoom(zoom + .08));
  $('#zoomOutBtn').addEventListener('click', () => setZoom(zoom - .08));
  $('#fitBtn').addEventListener('click', fitStage);
}

function setZoom(value) {
  zoom = Math.max(.38, Math.min(1.25, value));
  $('#bookStage').style.setProperty('--zoom', zoom);
  $('#zoomLabel').textContent = `${Math.round(zoom * 100)}%`;
}

function fitStage() {
  const viewport = $('#stageViewport').getBoundingClientRect();
  setZoom(Math.min((viewport.width - 70) / 960, (viewport.height - 70) / 720, 1));
}

async function init() {
  loadAutosave();
  bindPageFields(); bindTextControls(); bindCharacterFields(); bindCharacterViewer(); bindDrag(); bindFiles(); bindActions();
  renderAll();
  await connectModels();
  requestAnimationFrame(fitStage);
  window.addEventListener('resize', fitStage);
}

init().catch((error) => toast(error.message, 'error'));
