'use strict';

(function () {
  const paths = {
    plus: '<path d="M12 5v14M5 12h14"/>',
    minus: '<path d="M5 12h14"/>',
    left: '<path d="m15 18-6-6 6-6"/>',
    right: '<path d="m9 18 6-6-6-6"/>',
    folder: '<path d="M3 7.5h6l2 2h10v8.5a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><path d="M3 9.5v-3a2 2 0 0 1 2-2h4l2 2h4"/>',
    save: '<path d="M5 4h12l2 2v14H5z"/><path d="M8 4v6h8V4M8 20v-6h8v6"/>',
    download: '<path d="M12 3v12m0 0 5-5m-5 5-5-5"/><path d="M4 18v2h16v-2"/>',
    layers: '<path d="m12 3 9 5-9 5-9-5z"/><path d="m3 12 9 5 9-5M3 16l9 5 9-5"/>',
    key: '<path d="M15.5 7.5a4.5 4.5 0 1 0-3.7 4.43L21 21l2-2-2-2 2-2-3-3-1.8 1.8"/><circle cx="9" cy="9" r="1.5"/>',
    upload: '<path d="M12 16V4m0 0 5 5m-5-5L7 9"/><path d="M4 16v4h16v-4"/>',
    sparkles: '<path d="m12 3 1.2 3.8L17 8l-3.8 1.2L12 13l-1.2-3.8L7 8l3.8-1.2z"/><path d="m19 14 .7 2.3L22 17l-2.3.7L19 20l-.7-2.3L16 17l2.3-.7zM5 13l.8 2.2L8 16l-2.2.8L5 19l-.8-2.2L2 16l2.2-.8z"/>',
    copy: '<rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2"/>',
    trash: '<path d="M4 7h16M9 7V4h6v3M7 7l1 13h8l1-13"/><path d="M10 11v5M14 11v5"/>',
    wand: '<path d="m4 20 11-11"/><path d="m13 5 2-2 6 6-2 2z"/><path d="M6 4v3M4.5 5.5h3M18 15v4M16 17h4"/>',
    image: '<rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="8" cy="9" r="2"/><path d="m3 17 5-5 4 4 3-3 6 6"/>',
    userPlus: '<circle cx="9" cy="8" r="4"/><path d="M2.5 20a7 7 0 0 1 13 0M19 8v6M16 11h6"/>',
    refresh: '<path d="M20 7v5h-5"/><path d="M19 12a7 7 0 1 0-2 5"/>',
    file: '<path d="M6 3h8l4 4v14H6z"/><path d="M14 3v5h5M9 13h6M9 17h6"/>',
    book: '<path d="M3 5.5c3-1.5 6-1.2 9 1.5v13c-3-2.7-6-3-9-1.5z"/><path d="M21 5.5c-3-1.5-6-1.2-9 1.5v13c3-2.7 6-3 9-1.5z"/>',
    presentation: '<path d="M4 4h16v12H4zM12 16v5M8 21h8"/><path d="m8 12 3-3 2 2 3-4"/>'
  };

  function icon(name) {
    return '<svg class="ui-icon" viewBox="0 0 24 24" aria-hidden="true">' + (paths[name] || paths.sparkles) + '</svg>';
  }

  const assignments = {
    openProjectsBtn: 'folder',
    saveBtn: 'save',
    exportBtn: 'download',
    apiConfigBtn: 'key',
    modelCatalogBtn: 'layers',
    addPageBtn: 'plus',
    outlineImportBtn: 'file',
    batchImageBtn: 'image',
    duplicatePageBtn: 'copy',
    deletePageBtn: 'trash',
    prevPageBtn: 'left',
    nextPageBtn: 'right',
    zoomOutBtn: 'minus',
    zoomInBtn: 'plus',
    polishTextBtn: 'sparkles',
    shortenTextBtn: 'wand',
    regenerateTextBtn: 'refresh',
    buildPromptBtn: 'wand',
    copyPromptBtn: 'copy',
    generateImageBtn: 'sparkles',
    uploadImageBtn: 'upload',
    addCharacterBtn: 'userPlus',
    generateCharacterBtn: 'image',
    resetTextStyleBtn: 'refresh',
    chooseOutlineFileBtn: 'file',
    parseOutlineBtn: 'book',
    aiOutlineBtn: 'sparkles',
    generatePlanBtn: 'sparkles',
    exportPlanBtn: 'file',
    exportPptBtn: 'presentation',
    helpBtn: 'book',
    exitBtn: 'trash',
    lessonModeBtn: 'book',
    pptModeBtn: 'presentation',
    openCharacterPreviewBtn: 'image',
    chooseCourseDocBtn: 'file',
    importKnowledgeBtn: 'upload',
    saveDocToKnowledgeBtn: 'save'
  };
  const iconOnly = new Set(['addPageBtn', 'prevPageBtn', 'nextPageBtn', 'zoomOutBtn', 'zoomInBtn']);

  function decorateButton(id, name, force) {
    const button = document.getElementById(id);
    if (!button) return;
    if (!force && button.querySelector('.ui-icon')) return;
    if (iconOnly.has(id)) button.innerHTML = icon(name);
    else button.insertAdjacentHTML('afterbegin', icon(name));
  }

  function decorateAll() {
    Object.keys(assignments).forEach(function (id) {
      decorateButton(id, assignments[id], false);
    });
    const dynamicButton = document.getElementById('generatePlanBtn');
    if (dynamicButton) {
      new MutationObserver(function () {
        if (!dynamicButton.querySelector('.ui-icon')) decorateButton('generatePlanBtn', 'sparkles', false);
      }).observe(dynamicButton, { childList: true });
    }
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', decorateAll, { once: true });
  else decorateAll();
})();
