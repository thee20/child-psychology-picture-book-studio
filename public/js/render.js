'use strict';

/* render: stage, pages, characters, inspector */

function renderPageList() {
  $('#pageList').innerHTML = project.pages.map((page, index) => {
    const bg = page.image ? `style="background-image:url('${escapeHtml(page.image)}')"` : '';
    return `<article class="page-card ${index === activePageIndex ? 'is-active' : ''}" data-index="${index}">
      <div class="page-number">${String(index + 1).padStart(2, '0')}</div>
      <div><div class="page-thumb ${page.image ? 'has-image' : ''}" ${bg}></div><div class="page-title-small">${escapeHtml(page.title || `第 ${index + 1} 页`)}</div></div>
    </article>`;
  }).join('');
  $('#pageCount').textContent = project.pages.length;
  $('#pagePosition').textContent = `第 ${activePageIndex + 1} / ${project.pages.length} 页`;
  $$('.page-card').forEach((card) => card.addEventListener('click', () => selectPage(Number(card.dataset.index))));
}

function renderStage() {
  const page = currentPage();
  if (!page) return;
  const art = $('#stageArtwork');
  art.className = `stage-artwork ${page.demoArt && !page.image ? 'demo-art' : ''}`;
  art.style.backgroundImage = page.image ? `url("${page.image.replace(/"/g, '%22')}")` : '';
  art.style.backgroundSize = page.imageFit || 'cover';
  art.style.backgroundPosition = `${page.imageX ?? 50}% center`;
  art.style.transform = `scale(${(page.imageScale || 100) / 100})`;
  art.style.transformOrigin = `${page.imageX ?? 50}% center`;
  $('#imageEmptyState').classList.toggle('is-visible', !page.image && !page.demoArt);

  const style = page.textStyle || (page.textStyle = defaultTextStyle());
  const overlay = $('#textOverlay');
  overlay.style.left = `${style.x}%`;
  overlay.style.top = `${style.y}%`;
  overlay.style.width = `${style.width}%`;
  if (style.height && style.height > 0) {
    overlay.style.height = `${style.height}%`;
    overlay.style.minHeight = '0';
  } else {
    overlay.style.height = 'auto';
    overlay.style.minHeight = '80px';
  }
  applyBubbleStyle(overlay, style);
  const text = $('#overlayText');
  if (text.textContent !== page.text) text.textContent = page.text;
  text.style.fontFamily = style.fontFamily;
  text.style.fontSize = `${style.fontSize}px`;
  text.style.lineHeight = style.lineHeight;
  text.style.color = style.color;
  text.style.textAlign = style.align;
  text.style.webkitTextStroke = '0';
  text.style.textShadow = 'none';
}

function renderInspector() {
  const page = currentPage();
  $('#pageTitleInput').value = page.title || '';
  $('#pageTextInput').value = page.text || '';
  $('#emotionSelect').value = page.emotion || '认识并表达情绪';
  $('#editorNoteInput').value = page.note || '';
  $('#imagePromptInput').value = page.prompt || '';
  if ($('#artStyleSelect')) {
    const style = getArtStylePreset();
    $('#artStyleSelect').value = style.id;
  }
  $('#imageFitSelect').value = page.imageFit || 'cover';
  $('#imageXRange').value = page.imageX ?? 50;
  $('#imageScaleRange').value = page.imageScale || 100;
  $('#imageScaleValue').textContent = `${page.imageScale || 100}%`;
  $('#charCount').textContent = `${(page.text || '').replace(/\s/g, '').length} 字`;
  $('#imageStatus').textContent = page.image ? '已生成' : '待生成';

  const style = page.textStyle || (page.textStyle = defaultTextStyle());
  const fontSelect = $('#fontFamilySelect');
  if (fontSelect && ![...fontSelect.options].some((opt) => opt.value === style.fontFamily)) {
    const opt = document.createElement('option');
    opt.value = style.fontFamily;
    opt.textContent = '当前字体';
    fontSelect.appendChild(opt);
  }
  if (fontSelect) fontSelect.value = style.fontFamily;
  $('#fontSizeRange').value = style.fontSize;
  $('#fontSizeValue').textContent = style.fontSize;
  $('#lineHeightRange').value = Math.round(style.lineHeight * 10);
  $('#lineHeightValue').textContent = style.lineHeight.toFixed(1);
  $('#textColorInput').value = style.color;
  $('#textBgInput').value = style.bgColor;
  $('#bgOpacityRange').value = style.bgOpacity;
  $('#bgOpacityValue').textContent = `${style.bgOpacity}%`;
  $('#textWidthRange').value = style.width;
  $('#textWidthValue').textContent = `${style.width}%`;
  const heightVal = style.height && style.height > 0 ? style.height : 22;
  if ($('#textHeightRange')) {
    $('#textHeightRange').value = heightVal;
    $('#textHeightValue').textContent = style.height && style.height > 0 ? `${style.height}%` : '自适应';
  }
  $$('#alignControl button').forEach((button) => button.classList.toggle('is-active', button.dataset.value === style.align));
  $$('#bubbleShapeControl button').forEach((button) => button.classList.toggle('is-active', button.dataset.value === (style.bubbleShape || 'rounded')));
  if ($('#bubbleBorderColor')) {
    $('#bubbleBorderColor').value = style.borderColor || '#d4c4a8';
    $('#bubbleBorderWidth').value = style.borderWidth ?? 2;
    $('#bubbleBorderWidthValue').textContent = style.borderWidth ?? 2;
    $('#bubbleRadiusRange').value = style.borderRadius ?? 16;
    $('#bubbleRadiusValue').textContent = style.borderRadius ?? 16;
  }
  $$('#bubbleTailControl button').forEach((button) => button.classList.toggle('is-active', button.dataset.value === (style.tail || 'bottom')));
}

function renderCharacters() {
  if (!project.characters.length) {
    project.characters.push({ id: uid('char'), name: '新角色', appearance: '', traits: '', locked: false, image: '' });
    activeCharacterIndex = 0;
  }
  $('#characterList').innerHTML = project.characters.map((character, index) => `
    <article class="character-card ${index === activeCharacterIndex ? 'is-active' : ''}" data-index="${index}">
      <div class="character-avatar" ${character.image ? `style="background-image:url('${escapeHtml(character.image)}')"` : ''}>${character.image ? '' : escapeHtml((character.name || '角').slice(0, 1))}</div>
      <div class="character-meta"><strong>${escapeHtml(character.name || '未命名角色')}</strong><span>${escapeHtml(character.appearance || '等待补充外形锚点')}</span></div>
      <div class="lock-icon">${character.locked ? '●' : '○'}</div>
    </article>`).join('');
  $$('.character-card').forEach((card) => card.addEventListener('click', () => {
    activeCharacterIndex = Number(card.dataset.index);
    renderCharacters();
  }));
  const character = currentCharacter();
  $('#characterNameInput').value = character.name || '';
  $('#characterAppearanceInput').value = character.appearance || '';
  $('#characterTraitsInput').value = character.traits || '';
  $('#characterLockInput').checked = Boolean(character.locked);
  renderCharacterPreview();
}

function renderCharacterPreview() {
  const character = currentCharacter();
  if (!character || !$('#characterPreviewArt')) return;
  const name = character.name || '未命名角色';
  const art = $('#characterPreviewArt');
  if (character.image) {
    art.style.backgroundImage = `url('${character.image.replace(/'/g, '%27')}')`;
    art.textContent = '';
  } else {
    art.style.backgroundImage = '';
    art.textContent = name.slice(0, 1);
  }
  $('#characterPreviewName').textContent = name;
  $('#characterPreviewTraits').textContent = character.traits || '性格待补充';
  $('#characterPreviewAppearance').textContent = character.appearance || '补充外形后可生成设定图并预览。';
}

function applyCharacterImageZoom(anchorClientX, anchorClientY) {
  const viewport = $('#characterViewerViewport');
  const img = $('#characterPreviewImage');
  if (!viewport || !img || img.hidden || !img.naturalWidth) {
    if ($('#charZoomLabel')) $('#charZoomLabel').textContent = `${Math.round(charViewer.zoom * 100)}%`;
    return;
  }
  const prevW = img.clientWidth || img.naturalWidth;
  const prevH = img.clientHeight || img.naturalHeight;
  const nextW = img.naturalWidth * charViewer.zoom;
  const nextH = img.naturalHeight * charViewer.zoom;
  let ratioX = 0.5;
  let ratioY = 0.5;
  if (Number.isFinite(anchorClientX) && Number.isFinite(anchorClientY)) {
    const rect = viewport.getBoundingClientRect();
    const localX = anchorClientX - rect.left + viewport.scrollLeft - 24;
    const localY = anchorClientY - rect.top + viewport.scrollTop - 24;
    ratioX = prevW ? localX / prevW : 0.5;
    ratioY = prevH ? localY / prevH : 0.5;
  } else if (prevW > 0 && prevH > 0) {
    ratioX = (viewport.scrollLeft + viewport.clientWidth / 2 - 24) / prevW;
    ratioY = (viewport.scrollTop + viewport.clientHeight / 2 - 24) / prevH;
  }
  img.style.width = `${nextW}px`;
  img.style.height = `${nextH}px`;
  if ($('#charZoomLabel')) $('#charZoomLabel').textContent = `${Math.round(charViewer.zoom * 100)}%`;
  requestAnimationFrame(() => {
    viewport.scrollLeft = Math.max(0, nextW * ratioX - viewport.clientWidth / 2 + 24);
    viewport.scrollTop = Math.max(0, nextH * ratioY - viewport.clientHeight / 2 + 24);
  });
}

function setCharZoom(next, anchorX, anchorY) {
  charViewer.zoom = Math.max(0.15, Math.min(6, next));
  applyCharacterImageZoom(anchorX, anchorY);
}

function fitCharacterViewer() {
  const viewport = $('#characterViewerViewport');
  const img = $('#characterPreviewImage');
  if (!viewport || !img || img.hidden || !img.naturalWidth) {
    charViewer.zoom = 1;
    if ($('#charZoomLabel')) $('#charZoomLabel').textContent = '100%';
    return;
  }
  const pad = 48;
  const scale = Math.min(
    (viewport.clientWidth - pad) / img.naturalWidth,
    (viewport.clientHeight - pad) / img.naturalHeight,
    1
  );
  charViewer.zoom = Math.max(0.15, scale);
  img.style.width = `${img.naturalWidth * charViewer.zoom}px`;
  img.style.height = `${img.naturalHeight * charViewer.zoom}px`;
  if ($('#charZoomLabel')) $('#charZoomLabel').textContent = `${Math.round(charViewer.zoom * 100)}%`;
  requestAnimationFrame(() => {
    viewport.scrollLeft = Math.max(0, (img.clientWidth - viewport.clientWidth) / 2);
    viewport.scrollTop = Math.max(0, (img.clientHeight - viewport.clientHeight) / 2);
  });
}

function openCharacterPreviewDialog() {
  const character = currentCharacter();
  if (!character) return;
  const name = character.name || '未命名角色';
  $('#characterPreviewDialogTitle').textContent = `${name} · 角色预览`;
  $('#characterPreviewDialogName').textContent = name;
  $('#characterPreviewDialogTraits').textContent = character.traits || '—';
  $('#characterPreviewDialogAppearance').textContent = character.appearance || '—';
  $('#characterPreviewDialogLock').textContent = character.locked ? '已锁定（外形用于每页出图）' : '未锁定';
  const img = $('#characterPreviewImage');
  const placeholder = $('#characterPreviewPlaceholder');
  if (character.image) {
    img.hidden = false;
    placeholder.hidden = true;
    img.onload = () => fitCharacterViewer();
    if (img.src !== character.image) img.src = character.image;
    else if (img.complete) fitCharacterViewer();
  } else {
    img.hidden = true;
    img.removeAttribute('src');
    img.style.width = '';
    img.style.height = '';
    placeholder.hidden = false;
    placeholder.textContent = name.slice(0, 1);
    charViewer.zoom = 1;
    if ($('#charZoomLabel')) $('#charZoomLabel').textContent = '100%';
  }
  $('#characterPreviewDialog').showModal();
}

function bindCharacterViewer() {
  const viewport = $('#characterViewerViewport');
  if (!viewport) return;
  viewport.addEventListener('wheel', (event) => {
    event.preventDefault();
    const factor = event.deltaY < 0 ? 1.12 : 1 / 1.12;
    setCharZoom(charViewer.zoom * factor, event.clientX, event.clientY);
  }, { passive: false });
  viewport.addEventListener('pointerdown', (event) => {
    if (event.button !== 0) return;
    charViewer.dragging = true;
    charViewer.startX = event.clientX;
    charViewer.startY = event.clientY;
    charViewer.scrollLeft = viewport.scrollLeft;
    charViewer.scrollTop = viewport.scrollTop;
    viewport.setPointerCapture(event.pointerId);
    viewport.classList.add('is-panning');
  });
  viewport.addEventListener('pointermove', (event) => {
    if (!charViewer.dragging) return;
    viewport.scrollLeft = charViewer.scrollLeft - (event.clientX - charViewer.startX);
    viewport.scrollTop = charViewer.scrollTop - (event.clientY - charViewer.startY);
  });
  const endPan = () => {
    charViewer.dragging = false;
    viewport.classList.remove('is-panning');
  };
  viewport.addEventListener('pointerup', endPan);
  viewport.addEventListener('pointercancel', endPan);
  $('#charZoomInBtn')?.addEventListener('click', () => setCharZoom(charViewer.zoom * 1.25));
  $('#charZoomOutBtn')?.addEventListener('click', () => setCharZoom(charViewer.zoom / 1.25));
  $('#charZoomFitBtn')?.addEventListener('click', fitCharacterViewer);
  $('#charZoomResetBtn')?.addEventListener('click', () => {
    charViewer.zoom = 1;
    applyCharacterImageZoom();
  });
}

function renderAll() {
  $('#projectTitle').value = project.title || '未命名绘本';
  renderPageList();
  renderStage();
  renderInspector();
  renderCharacters();
  scheduleLocalSave();
}

function selectPage(index) {
  activePageIndex = Math.max(0, Math.min(project.pages.length - 1, index));
  renderPageList();
  renderStage();
  renderInspector();
}

function selectInspectorTab(tab) {
  $$('.inspector-tab').forEach((button) => button.classList.toggle('is-active', button.dataset.tab === tab));
  $$('.inspector-content').forEach((panel) => panel.classList.toggle('is-active', panel.id === `tab-${tab}`));
}
