'use strict';

/* teacher: lesson plan / ppt helpers */

function selectedKnowledgeContext() {
  const selected = knowledgeItems.filter((item) => selectedKnowledgeIds.has(item.id));
  if (!selected.length) return '';
  return selected.map((item) => `【${item.title}】\n${item.preview || ''}`).join('\n\n').slice(0, 6000);
}

function teacherPrompt(mode) {
  const title = $('#teacherTitleInput').value.trim() || '小学心理健康课';
  const grade = $('#teacherGradeSelect').value;
  const duration = $('#teacherDurationSelect').value;
  const context = $('#teacherContextInput').value.trim() || '普通小学班级，学生需要在安全、非评判的课堂氛围中参与体验。';
  const needs = $('#teacherNeedsInput').value.trim() || '活动可操作、表达温和，避免对学生进行诊断或强迫分享隐私。';
  const doc = ($('#courseDocInput')?.value || '').trim();
  const knowledge = selectedKnowledgeContext();
  const materials = [doc && `导入文档参考：\n${doc.slice(0, 4000)}`, knowledge && `知识库参考：\n${knowledge}`].filter(Boolean).join('\n\n');
  const common = `你是一名经验丰富的小学心理健康教师和课程设计师。课题：${title}；年级：${grade}；课时：${duration}；学情：${context}；特别要求：${needs}。坚持发展性心理健康教育，不做诊断，不制造羞耻，不强迫学生公开个人隐私，活动须有退出选项和安全边界。${materials ? `\n\n以下为本地导入/知识库资料，请在合适处吸收使用：\n${materials}` : ''}`;
  if (mode === 'ppt') return `${common}\n请设计 10-14 页可直接授课的心理课 PPT。只输出 JSON：{"title":"课件标题","subtitle":"年级与课时","slides":[{"title":"页面标题","subtitle":"封面副标题（仅封面需要）","bullets":["页面要点"],"notes":"教师讲解词与操作提醒"}]}。包含暖场、目标、情境、知识点、体验活动、讨论、练习、总结与课后延伸；每页不超过 5 个要点。`;
  if (mode === 'handout') return `${common}\n请设计一份学生可打印使用的课堂活动单。只输出 JSON：{"title":"活动单标题","studentNote":"给学生的温和说明","sections":[{"title":"板块标题","instruction":"操作说明","prompts":["填写问题或活动步骤"]}],"safetyNote":"安全与求助提示"}。问题应允许跳过，不收集敏感隐私。`;
  return `${common}\n请编写一份完整、可直接上课的小学心理健康教案。只输出 JSON：{"title":"课题","grade":"年级","duration":"课时","theme":"核心心理主题","studentAnalysis":"学情分析","objectives":["认知目标","情感目标","行为目标"],"keyPoint":"重点","difficulty":"难点","materials":["准备材料"],"phases":[{"name":"环节","minutes":5,"teacher":"教师活动与可直接说出的引导语","students":"学生活动","purpose":"设计意图"}],"assessment":"过程性评价","extension":"家庭或课后延伸"}。总时长与课时匹配，至少包含一个体验活动、一次安静反思和一个可选择的分享环节。`;
}

async function generateTeacherMaterial() {
  const detail = teacherMode === 'plan' ? '编写教案与课堂流程' : teacherMode === 'ppt' ? '设计 PPT 页面与教师讲稿' : '设计学生活动单';
  setBusy(true, 'AI 正在准备心理课', `${detail}（可随时中断）`);
  try {
    throwIfCancelled();
    const result = await api('/api/chat', { method: 'POST', body: JSON.stringify({
      model: $('#teacherModelSelect').value || $('#textModelSelect').value || 'gpt-5.6-sol',
      messages: [{ role: 'user', content: teacherPrompt(teacherMode) }], maxTokens: 8000, jsonMode: true
    }) });
    throwIfCancelled();
    teacherData[teacherMode] = parseJsonResponse(result.content);
    renderTeacherPreview();
    toast('备课材料已生成，可在预览中继续修改', 'success');
  } catch (error) {
    handleTaskError(error, '生成备课材料失败');
  } finally { setBusy(false); }
}

function renderTeacherPreview() {
  const data = teacherData[teacherMode];
  $('#teacherPreviewType').textContent = { plan: '教案预览', ppt: 'PPT 课件预览', handout: '学生活动单预览' }[teacherMode];
  if (!data) {
    $('#teacherPreview').innerHTML = '<div class="preview-placeholder"><div class="empty-illustration"><span></span><i></i><b></b></div><p>填写课题后，AI 会生成结构完整、可继续编辑的教学材料。</p></div>';
    return;
  }
  if (teacherMode === 'ppt') {
    $('#teacherPreview').innerHTML = `<div class="preview-section"><h4 contenteditable="true" data-teacher-path="title">${escapeHtml(data.title)}</h4><p>${escapeHtml(data.subtitle || '')}</p></div>${(data.slides || []).map((slide, index) => `<div class="preview-section ppt-slide-preview"><span>SLIDE ${String(index + 1).padStart(2,'0')}</span><b contenteditable="true" data-slide="${index}" data-slide-field="title">${escapeHtml(slide.title)}</b><ul>${(slide.bullets || []).map((bullet) => `<li>${escapeHtml(bullet)}</li>`).join('')}</ul><span>${escapeHtml(slide.notes || '')}</span></div>`).join('')}`;
  } else if (teacherMode === 'handout') {
    $('#teacherPreview').innerHTML = `<div class="preview-section"><h4>${escapeHtml(data.title)}</h4><p>${escapeHtml(data.studentNote || '')}</p></div>${(data.sections || []).map((section) => `<div class="preview-section"><h4>${escapeHtml(section.title)}</h4><p>${escapeHtml(section.instruction || '')}</p><ul>${(section.prompts || []).map((prompt) => `<li>${escapeHtml(prompt)} ____________________</li>`).join('')}</ul></div>`).join('')}<div class="preview-section"><h4>安全提示</h4><p>${escapeHtml(data.safetyNote || '')}</p></div>`;
  } else {
    $('#teacherPreview').innerHTML = `<div class="preview-section"><h4 contenteditable="true" data-teacher-path="title">${escapeHtml(data.title)}</h4><p>${escapeHtml(data.grade || '')} · ${escapeHtml(data.duration || '')} · ${escapeHtml(data.theme || '')}</p></div><div class="preview-section"><h4>学情分析</h4><p>${escapeHtml(data.studentAnalysis || '')}</p></div><div class="preview-section"><h4>教学目标</h4><ul>${(data.objectives || []).map((item) => `<li>${escapeHtml(item)}</li>`).join('')}</ul></div><div class="preview-section"><h4>重点与难点</h4><p>重点：${escapeHtml(data.keyPoint || '')}\n难点：${escapeHtml(data.difficulty || '')}</p></div><div class="preview-section"><h4>教学准备</h4><ul>${(data.materials || []).map((item) => `<li>${escapeHtml(item)}</li>`).join('')}</ul></div>${(data.phases || []).map((phase) => `<div class="preview-section"><h4>${escapeHtml(phase.name)} · ${escapeHtml(phase.minutes)} 分钟</h4><p>教师活动：${escapeHtml(phase.teacher || '')}\n\n学生活动：${escapeHtml(phase.students || '')}\n\n设计意图：${escapeHtml(phase.purpose || '')}</p></div>`).join('')}<div class="preview-section"><h4>评价与延伸</h4><p>${escapeHtml(data.assessment || '')}\n\n${escapeHtml(data.extension || '')}</p></div>`;
  }
  $$('[data-teacher-path="title"]').forEach((element) => element.addEventListener('input', () => { teacherData[teacherMode].title = element.textContent.trim(); }));
  $$('[data-slide]').forEach((element) => element.addEventListener('input', () => { teacherData.ppt.slides[Number(element.dataset.slide)][element.dataset.slideField] = element.textContent.trim(); }));
}

async function downloadGenerated(path, payload, fallbackName) {
  const response = await fetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
    signal: activeAbort?.signal
  });
  if (!response.ok) {
    const value = await response.json().catch(() => ({}));
    throw new Error(value.error || '导出失败');
  }
  throwIfCancelled();
  const blob = await response.blob();
  throwIfCancelled();
  if (!blob || blob.size < 32) throw new Error('导出文件为空，请检查本地是否安装 Word / PowerPoint');
  const disposition = response.headers.get('Content-Disposition') || '';
  const match = disposition.match(/filename\*=UTF-8''([^;]+)/i);
  const fileName = match ? decodeURIComponent(match[1]) : fallbackName;
  // 生成完成后关闭 busy，再弹「另存为」，避免遮罩挡住对话框
  setBusy(false);
  return saveExportBlob(blob, fileName, { pickLocation: true });
}

async function exportTeacherPlan() {
  if (!teacherData.plan) { teacherMode = 'plan'; await generateTeacherMaterial(); }
  if (!teacherData.plan) return;
  setBusy(true, '正在生成 Word 教案', '调用本地 Microsoft Word（可随时中断）');
  try {
    await downloadGenerated('/api/export-docx', { plan: teacherData.plan }, `${teacherData.plan.title || '小学心理课教案'}.docx`);
  } catch (error) {
    if (isCancelledSave(error)) toast('已取消保存', '');
    else handleTaskError(error, '导出教案失败（需本地已安装 Microsoft Word）');
  } finally { setBusy(false); }
}

async function exportTeacherPpt() {
  if (!teacherData.ppt) {
    teacherMode = 'ppt';
    $$('.teacher-tab').forEach((item) => item.classList.toggle('is-active', item.dataset.teacherTab === 'ppt'));
    await generateTeacherMaterial();
  }
  if (!teacherData.ppt) return;
  setBusy(true, '正在生成 PowerPoint 课件', '调用本地 Microsoft PowerPoint（可随时中断）');
  try {
    await downloadGenerated('/api/export-pptx', { presentation: teacherData.ppt }, `${teacherData.ppt.title || '心理课课件'}.pptx`);
  } catch (error) {
    if (isCancelledSave(error)) toast('已取消保存', '');
    else handleTaskError(error, '导出课件失败（需本地已安装 Microsoft PowerPoint）');
  } finally { setBusy(false); }
}

async function openProjects() {
  const result = await api('/api/projects');
  $('#projectList').innerHTML = result.projects.length ? result.projects.map((item) => `
    <article class="project-item"><div><strong>${escapeHtml(item.title)}</strong><span>${item.pageCount} 页 · ${new Date(item.updatedAt).toLocaleString()}</span></div><button type="button" class="button button-secondary button-small" data-project="${escapeHtml(item.id)}">打开</button></article>`).join('') : '<div class="project-item"><span>还没有保存过项目</span></div>';
  $('#projectsDialog').showModal();
  $$('[data-project]').forEach((button) => button.addEventListener('click', async () => {
    const data = await api(`/api/projects/${encodeURIComponent(button.dataset.project)}`);
    project = data.project;
    activePageIndex = 0; activeCharacterIndex = 0;
    $('#projectsDialog').close(); renderAll();
  }));
}
