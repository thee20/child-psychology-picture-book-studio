'use strict';

/* export-book: canvas PDF/ZIP, knowledge list UI, document import */

/* ========== 绘本多格式导出：Canvas 嵌入真实图片 → PDF / PNG / JPEG ========== */
const EXPORT_PAGE_W = 1600;
const EXPORT_PAGE_H = 1200;

function exportBaseName() {
  return sanitizeZipEntryName(project.title || '绘本导出', '绘本导出');
}

function loadImageElement(src) {
  return new Promise((resolve, reject) => {
    if (!src) {
      resolve(null);
      return;
    }
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('插画加载失败'));
    img.src = src;
  });
}

function drawCoverContain(ctx, img, boxW, boxH, {
  fit = 'cover',
  focusX = 50,
  scale = 1
} = {}) {
  if (!img || !img.width || !img.height) return;
  const iw = img.width;
  const ih = img.height;
  const s = Math.max(0.2, Math.min(3, Number(scale) || 1));
  let drawW;
  let drawH;
  if (fit === 'contain') {
    const r = Math.min(boxW / iw, boxH / ih) * s;
    drawW = iw * r;
    drawH = ih * r;
  } else {
    // cover（默认）与 fill 均铺满画布
    const r = Math.max(boxW / iw, boxH / ih) * s;
    drawW = iw * r;
    drawH = ih * r;
  }
  const fx = Math.min(100, Math.max(0, Number(focusX) ?? 50)) / 100;
  const x = (boxW - drawW) * fx;
  const y = (boxH - drawH) / 2;
  ctx.drawImage(img, x, y, drawW, drawH);
}

function wrapCanvasText(ctx, text, maxWidth) {
  const lines = [];
  const paragraphs = String(text || '').replace(/\r\n/g, '\n').split('\n');
  for (const paragraph of paragraphs) {
    if (!paragraph) {
      lines.push('');
      continue;
    }
    let line = '';
    for (const ch of paragraph) {
      const test = line + ch;
      if (line && ctx.measureText(test).width > maxWidth) {
        lines.push(line);
        line = ch;
      } else {
        line = test;
      }
    }
    if (line) lines.push(line);
  }
  return lines.length ? lines : [''];
}

function roundRectPath(ctx, x, y, w, h, r) {
  const radius = Math.max(0, Math.min(r, w / 2, h / 2));
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.arcTo(x + w, y, x + w, y + h, radius);
  ctx.arcTo(x + w, y + h, x, y + h, radius);
  ctx.arcTo(x, y + h, x, y, radius);
  ctx.arcTo(x, y, x + w, y, radius);
  ctx.closePath();
}

async function renderBookPageToCanvas(page, width = EXPORT_PAGE_W, height = EXPORT_PAGE_H) {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('无法创建画布');

  // 底色
  ctx.fillStyle = '#f2f0ea';
  ctx.fillRect(0, 0, width, height);

  let img = null;
  if (page.image) {
    try {
      img = await loadImageElement(page.image);
    } catch {
      img = null;
    }
  }

  if (img) {
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, 0, width, height);
    ctx.clip();
    drawCoverContain(ctx, img, width, height, {
      fit: page.imageFit || 'cover',
      focusX: page.imageX ?? 50,
      scale: (page.imageScale || 100) / 100
    });
    ctx.restore();
  } else {
    // 无图时的温和渐变占位（与舞台 demo 风格接近）
    const g = ctx.createLinearGradient(0, 0, width, height);
    g.addColorStop(0, '#b8d5d0');
    g.addColorStop(0.55, '#dfc489');
    g.addColorStop(1, '#708f68');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, width, height);
    ctx.fillStyle = 'rgba(34,48,42,.55)';
    ctx.font = `600 ${Math.round(height * 0.045)}px "Microsoft YaHei", "PingFang SC", sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(page.title || '待生成插画', width / 2, height / 2);
  }

  // 文字气泡（与编辑器百分比布局一致）
  const style = { ...defaultTextStyle(), ...(page.textStyle || {}) };
  const boxX = (Number(style.x) || 0) / 100 * width;
  const boxY = (Number(style.y) || 0) / 100 * height;
  const boxW = Math.max(40, (Number(style.width) || 72) / 100 * width);
  const padX = Math.max(16, Math.round(width * 0.021));
  const padY = Math.max(12, Math.round(height * 0.018));
  const fontSize = Math.max(12, Number(style.fontSize) || 34);
  const lineHeight = Math.max(1.1, Number(style.lineHeight) || 1.6);
  const fontFamily = String(style.fontFamily || "'Microsoft YaHei', sans-serif").replace(/"/g, "'");
  ctx.font = `${fontSize}px ${fontFamily}`;
  const lines = wrapCanvasText(ctx, page.text || '', Math.max(20, boxW - padX * 2));
  const textBlockH = lines.length * fontSize * lineHeight;
  let boxH;
  if (style.height && style.height > 0) {
    boxH = (Number(style.height) / 100) * height;
  } else {
    boxH = Math.max(fontSize * lineHeight + padY * 2, textBlockH + padY * 2);
  }

  const shape = style.bubbleShape || 'rounded';
  const radius = shape === 'square' ? 4
    : shape === 'caption' ? 0
      : shape === 'cloud' ? Math.max(Number(style.borderRadius) || 16, 28)
        : (Number(style.borderRadius) ?? 16);

  if (shape !== 'none') {
    ctx.save();
    roundRectPath(ctx, boxX, boxY, boxW, boxH, radius);
    ctx.fillStyle = rgba(style.bgColor || '#fffdf7', style.bgOpacity ?? 84);
    ctx.fill();
    const bw = Number(style.borderWidth) || 0;
    if (bw > 0) {
      ctx.lineWidth = bw;
      ctx.strokeStyle = style.borderColor || '#d4c4a8';
      ctx.stroke();
    }
    ctx.restore();
  }

  ctx.fillStyle = style.color || '#22302a';
  ctx.textAlign = style.align === 'left' ? 'left' : style.align === 'right' ? 'right' : 'center';
  ctx.textBaseline = 'top';
  const textAreaW = Math.max(20, boxW - padX * 2);
  let cursorX = boxX + padX;
  if (style.align === 'center') cursorX = boxX + boxW / 2;
  else if (style.align === 'right') cursorX = boxX + boxW - padX;
  const startY = boxY + Math.max(padY, (boxH - textBlockH) / 2);
  lines.forEach((line, index) => {
    const y = startY + index * fontSize * lineHeight;
    ctx.fillText(line, cursorX, y, textAreaW);
  });

  return canvas;
}

async function renderAllBookPages(onProgress) {
  const pages = project.pages || [];
  const canvases = [];
  for (let i = 0; i < pages.length; i += 1) {
    if (typeof onProgress === 'function') onProgress(i + 1, pages.length);
    canvases.push(await renderBookPageToCanvas(pages[i]));
  }
  return canvases;
}

function canvasToBlob(canvas, type = 'image/png', quality) {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (!blob) reject(new Error('页面渲染失败'));
      else resolve(blob);
    }, type, quality);
  });
}

async function blobToBase64(blob) {
  const buffer = new Uint8Array(await blob.arrayBuffer());
  const chunk = 0x8000;
  let binary = '';
  for (let i = 0; i < buffer.length; i += chunk) {
    const slice = buffer.subarray(i, Math.min(i + chunk, buffer.length));
    binary += String.fromCharCode.apply(null, slice);
  }
  return btoa(binary);
}

/** 优先本地服务写入「下载」目录（可靠、不依赖 WebView 消息解析） */
async function saveExportViaServer(blob, fileName) {
  if (!blob || !blob.size) throw new Error('导出内容为空');
  const base64 = await blobToBase64(blob);
  const response = await fetch('/api/save-export', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      fileName: fileName || 'export.bin',
      base64,
      mime: blob.type || 'application/octet-stream'
    })
  });
  const value = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(value.error || '服务端保存失败');
  return value;
}

function isCancelledSave(error) {
  return Boolean(
    error?.cancelled
    || error?.name === 'AbortError'
    || /已取消|cancel|abort/i.test(String(error?.message || ''))
  );
}

/**
 * 保存导出文件：优先弹出「另存为」让用户选位置。
 * @param {Blob} blob
 * @param {string} fileName
 * @param {{ pickLocation?: boolean }} [options]
 */
async function saveExportBlob(blob, fileName, options = {}) {
  if (!blob || !blob.size) throw new Error('导出内容为空');
  const pickLocation = options.pickLocation !== false;

  // 1) 桌面壳 / 浏览器「另存为」（可选目录）
  if (window.studioDesktop?.saveBlob) {
    try {
      const result = await window.studioDesktop.saveBlob(blob, fileName, { pickLocation });
      if (result?.cancelled) {
        toast('已取消保存', '');
        return null;
      }
      const path = result?.path || fileName;
      if (result?.via === 'desktop' || result?.via === 'file-picker') {
        toast(path ? `已保存：${path}` : `已保存：${fileName}`, 'success');
      } else {
        toast(`已开始下载：${fileName}`, 'success');
      }
      return path || fileName;
    } catch (error) {
      if (isCancelledSave(error)) {
        toast('已取消保存', '');
        return null;
      }
      console.warn('interactive save failed', error);
    }
  }

  // 2) 回退：服务端固定写到「下载」目录
  try {
    const saved = await saveExportViaServer(blob, fileName);
    const shown = saved.path || saved.fileName || fileName;
    toast(`已保存到默认位置：${shown}`, 'success');
    return shown;
  } catch (serverError) {
    console.warn('save-export server failed', serverError);
  }

  // 3) 最后回退：a[download]
  const href = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = href;
  anchor.download = fileName;
  document.body.appendChild(anchor);
  anchor.click();
  setTimeout(() => {
    try { anchor.remove(); } catch { /* ignore */ }
    URL.revokeObjectURL(href);
  }, 4000);
  toast(`已开始下载：${fileName}`, 'success');
  return fileName;
}

/* --- 轻量 ZIP（无外部依赖，用于分页图片打包） --- */
function crc32Table() {
  if (crc32Table._t) return crc32Table._t;
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i += 1) {
    let c = i;
    for (let k = 0; k < 8; k += 1) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
    table[i] = c >>> 0;
  }
  crc32Table._t = table;
  return table;
}

function crc32(bytes) {
  let c = 0xFFFFFFFF;
  const table = crc32Table();
  for (let i = 0; i < bytes.length; i += 1) c = table[(c ^ bytes[i]) & 0xFF] ^ (c >>> 8);
  return (c ^ 0xFFFFFFFF) >>> 0;
}

function u16(n) {
  return new Uint8Array([n & 0xFF, (n >>> 8) & 0xFF]);
}

function u32(n) {
  return new Uint8Array([n & 0xFF, (n >>> 8) & 0xFF, (n >>> 16) & 0xFF, (n >>> 24) & 0xFF]);
}

function concatBytes(parts) {
  const total = parts.reduce((sum, p) => sum + p.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

/**
 * 打包 ZIP（Store 无压缩）。
 * 中文文件名必须：UTF-8 编码 + general purpose bit 11 (0x0800)，
 * 否则 Windows 资源管理器会按系统代码页误读成乱码。
 * 并附加 Info-ZIP Unicode Path (0x7075) 额外字段，兼容更多解压工具。
 */
function buildZipStore(files) {
  // files: [{ name: string, data: Uint8Array }]
  const localParts = [];
  const centralParts = [];
  let offset = 0;
  const encoder = new TextEncoder();
  // bit 11 = Language encoding flag (EFS)：文件名按 UTF-8 解释
  const GP_UTF8 = 0x0800;
  for (const file of files) {
    const name = String(file.name || 'file.bin');
    const nameBytes = encoder.encode(name);
    const data = file.data instanceof Uint8Array ? file.data : new Uint8Array(file.data || []);
    const crc = crc32(data);
    // Info-ZIP Unicode Path Extra Field (0x7075)
    // version(1) + nameCRC32(4) + utf8 name
    const unicodeExtra = concatBytes([
      u16(0x7075),
      u16(5 + nameBytes.length),
      new Uint8Array([1]),
      u32(crc32(nameBytes)),
      nameBytes
    ]);
    const localHeader = concatBytes([
      u32(0x04034b50),
      u16(20),
      u16(GP_UTF8),
      u16(0), // store
      u16(0),
      u16(0),
      u32(crc),
      u32(data.length),
      u32(data.length),
      u16(nameBytes.length),
      u16(unicodeExtra.length),
      nameBytes,
      unicodeExtra,
      data
    ]);
    localParts.push(localHeader);
    const central = concatBytes([
      u32(0x02014b50),
      u16(20),
      u16(20),
      u16(GP_UTF8),
      u16(0),
      u16(0),
      u16(0),
      u32(crc),
      u32(data.length),
      u32(data.length),
      u16(nameBytes.length),
      u16(unicodeExtra.length),
      u16(0),
      u16(0),
      u16(0),
      u32(0),
      u32(offset),
      nameBytes,
      unicodeExtra
    ]);
    centralParts.push(central);
    offset += localHeader.length;
  }
  const centralDir = concatBytes(centralParts);
  const end = concatBytes([
    u32(0x06054b50),
    u16(0),
    u16(0),
    u16(files.length),
    u16(files.length),
    u32(centralDir.length),
    u32(offset),
    u16(0)
  ]);
  return concatBytes([...localParts, centralDir, end]);
}

/** 压缩包内条目名：保留中文，去掉非法字符；过长时按字符截断 */
function sanitizeZipEntryName(raw, fallback = 'page') {
  let name = String(raw || '')
    .normalize('NFKC')
    .replace(/[\\/:*?"<>|\u0000-\u001f]/g, '-')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^\.+/, '')
    .replace(/\.+$/, '');
  if (!name) name = fallback;
  // Windows 路径组件上限约 255 字节；按码点截到 40 个字符足够读
  if ([...name].length > 40) name = [...name].slice(0, 40).join('').trim();
  if (!name) name = fallback;
  return name;
}

async function blobToUint8Array(blob) {
  const buffer = await blob.arrayBuffer();
  return new Uint8Array(buffer);
}

/* --- 轻量 PDF：每页一张 JPEG（兼容好、体积可控） --- */
function buildPdfDocument(jpegPages, pageW, pageH) {
  const encoder = new TextEncoder();
  const parts = [];
  const offsets = [0]; // 1-based object offsets

  const write = (chunk) => {
    if (typeof chunk === 'string') parts.push(encoder.encode(chunk));
    else parts.push(chunk);
  };

  // Pre-assign object numbers:
  // 1 Catalog, 2 Pages, then for each page: Page, Content, Image
  const pageCount = jpegPages.length;
  const pageObj = (i) => 3 + i * 3;
  const contentObj = (i) => 4 + i * 3;
  const imageObj = (i) => 5 + i * 3;

  write('%PDF-1.4\n');
  // 二进制注释：声明 PDF 含 8-bit 数据（须写原始字节，勿经 UTF-8 转义）
  write(new Uint8Array([0x25, 0xE2, 0xE3, 0xCF, 0xD3, 0x0A]));

  const objectBodies = new Map();

  objectBodies.set(1, encoder.encode('1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n'));
  const kids = jpegPages.map((_, i) => `${pageObj(i)} 0 R`).join(' ');
  objectBodies.set(2, encoder.encode(
    `2 0 obj\n<< /Type /Pages /Count ${pageCount} /Kids [ ${kids} ] >>\nendobj\n`
  ));

  jpegPages.forEach((jpegBytes, i) => {
    const content = `q\n${pageW} 0 0 ${pageH} 0 0 cm\n/Im${i + 1} Do\nQ\n`;
    const contentBytes = encoder.encode(content);
    objectBodies.set(pageObj(i), encoder.encode(
      `${pageObj(i)} 0 obj\n`
      + `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pageW} ${pageH}] `
      + `/Resources << /XObject << /Im${i + 1} ${imageObj(i)} 0 R >> >> `
      + `/Contents ${contentObj(i)} 0 R >>\nendobj\n`
    ));
    objectBodies.set(contentObj(i), concatBytes([
      encoder.encode(`${contentObj(i)} 0 obj\n<< /Length ${contentBytes.length} >>\nstream\n`),
      contentBytes,
      encoder.encode('\nendstream\nendobj\n')
    ]));
    objectBodies.set(imageObj(i), concatBytes([
      encoder.encode(
        `${imageObj(i)} 0 obj\n`
        + `<< /Type /XObject /Subtype /Image /Width ${pageW} /Height ${pageH} `
        + `/ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode `
        + `/Length ${jpegBytes.length} >>\nstream\n`
      ),
      jpegBytes,
      encoder.encode('\nendstream\nendobj\n')
    ]));
  });

  const maxObj = 2 + pageCount * 3;
  for (let id = 1; id <= maxObj; id += 1) {
    offsets[id] = parts.reduce((sum, p) => sum + p.length, 0);
    write(objectBodies.get(id));
  }

  const xrefStart = parts.reduce((sum, p) => sum + p.length, 0);
  let xref = `xref\n0 ${maxObj + 1}\n`;
  xref += '0000000000 65535 f \n';
  for (let id = 1; id <= maxObj; id += 1) {
    xref += `${String(offsets[id]).padStart(10, '0')} 00000 n \n`;
  }
  write(xref);
  write(`trailer\n<< /Size ${maxObj + 1} /Root 1 0 R >>\nstartxref\n${xrefStart}\n%%EOF\n`);

  return concatBytes(parts);
}

async function exportBookAsPdf() {
  if (!project.pages?.length) return toast('没有可导出的页面', 'error');
  setBusy(true, '正在生成 PDF', '渲染页面插画并嵌入 PDF…', { cancellable: true });
  try {
    const canvases = await renderAllBookPages((current, total) => {
      $('#busyDetail').textContent = `渲染第 ${current} / ${total} 页…`;
    });
    throwIfCancelled();
    const jpegPages = [];
    for (let i = 0; i < canvases.length; i += 1) {
      $('#busyDetail').textContent = `编码第 ${i + 1} / ${canvases.length} 页…`;
      const blob = await canvasToBlob(canvases[i], 'image/jpeg', 0.92);
      jpegPages.push(await blobToUint8Array(blob));
      throwIfCancelled();
    }
    $('#busyDetail').textContent = '组装 PDF…';
    const pdfBytes = buildPdfDocument(jpegPages, EXPORT_PAGE_W, EXPORT_PAGE_H);
    const fileName = `${exportBaseName()}.pdf`;
    // 弹出「另存为」前先关掉遮罩，避免挡住交互、也避免取消时仍显示「导出中」
    setBusy(false);
    await saveExportBlob(new Blob([pdfBytes], { type: 'application/pdf' }), fileName, { pickLocation: true });
  } catch (error) {
    if (isAbortError(error) || isCancelledSave(error)) toast('已取消导出', '');
    else toast(error?.message || '导出 PDF 失败', 'error');
  } finally {
    setBusy(false);
  }
}

async function exportBookAsImageZip(format = 'png') {
  if (!project.pages?.length) return toast('没有可导出的页面', 'error');
  const isJpeg = format === 'jpeg' || format === 'jpg';
  const mime = isJpeg ? 'image/jpeg' : 'image/png';
  const ext = isJpeg ? 'jpg' : 'png';
  setBusy(true, `正在导出 ${ext.toUpperCase()} 分页`, '渲染页面插画…', { cancellable: true });
  try {
    const canvases = await renderAllBookPages((current, total) => {
      $('#busyDetail').textContent = `渲染第 ${current} / ${total} 页…`;
    });
    throwIfCancelled();
    const usedNames = new Set();
    const files = [];
    for (let i = 0; i < canvases.length; i += 1) {
      $('#busyDetail').textContent = `编码第 ${i + 1} / ${canvases.length} 页…`;
      const blob = await canvasToBlob(canvases[i], mime, isJpeg ? 0.92 : undefined);
      const data = await blobToUint8Array(blob);
      const pageNo = String(i + 1).padStart(2, '0');
      const title = sanitizeZipEntryName(project.pages[i].title || `第${i + 1}页`, `page-${pageNo}`);
      let entryName = `${pageNo}-${title}.${ext}`;
      // 同名标题去重，避免后写覆盖前写
      if (usedNames.has(entryName.toLowerCase())) {
        entryName = `${pageNo}-${title}-${i + 1}.${ext}`;
      }
      usedNames.add(entryName.toLowerCase());
      files.push({ name: entryName, data });
      throwIfCancelled();
    }
    $('#busyDetail').textContent = '打包 ZIP…';
    const zipBytes = buildZipStore(files);
    const fileName = `${exportBaseName()}-${ext}.zip`;
    setBusy(false);
    await saveExportBlob(new Blob([zipBytes], { type: 'application/zip' }), fileName, { pickLocation: true });
  } catch (error) {
    if (isAbortError(error) || isCancelledSave(error)) toast('已取消导出', '');
    else toast(error?.message || '导出图片失败', 'error');
  } finally {
    setBusy(false);
  }
}

/** 备用：系统打印（使用真实 <img>，避免 CSS background 在打印中丢失） */
function buildExportBookHtml() {
  const pages = project.pages.map((page) => {
    const style = { ...defaultTextStyle(), ...(page.textStyle || {}) };
    const shape = style.bubbleShape || 'rounded';
    const radius = shape === 'square' ? 4 : shape === 'caption' ? 0 : shape === 'cloud' ? Math.max(style.borderRadius || 16, 28) : (style.borderRadius ?? 16);
    const bg = shape === 'none' ? 'transparent' : rgba(style.bgColor, style.bgOpacity);
    const border = shape === 'none' ? 'none' : `${style.borderWidth ?? 2}px solid ${style.borderColor || '#d4c4a8'}`;
    const height = style.height > 0 ? `height:${style.height}%;` : '';
    const fontFamily = String(style.fontFamily || 'sans-serif').replace(/"/g, "'");
    const fit = page.imageFit === 'contain' ? 'contain' : 'cover';
    const pos = `${page.imageX ?? 50}% center`;
    const scale = (page.imageScale || 100) / 100;
    const imgHtml = page.image
      ? `<img class="art-img" src="${String(page.image).replace(/"/g, '&quot;')}" alt="" style="object-fit:${fit};object-position:${pos};transform:scale(${scale});transform-origin:${pos}">`
      : '<div class="art-fallback"></div>';
    return `<section class="page">${imgHtml}<div class="copy" style="left:${style.x}%;top:${style.y}%;width:${style.width}%;${height}font-family:${fontFamily};font-size:${style.fontSize}px;line-height:${style.lineHeight};color:${style.color};text-align:${style.align};background:${bg};border:${border};border-radius:${radius}px;padding:22px 34px">${escapeHtml(page.text).replace(/\n/g, '<br>')}</div></section>`;
  }).join('');

  return `<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(project.title || '绘本导出')}</title>
<style>
@page { size: landscape; margin: 0; }
* { box-sizing: border-box; }
html, body { margin: 0; padding: 0; background: #fff; }
.page {
  width: 100vw;
  height: 100vh;
  position: relative;
  overflow: hidden;
  page-break-after: always;
  break-after: page;
  background: #eee;
}
.page:last-child { page-break-after: auto; break-after: auto; }
.art-img {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  display: block;
  -webkit-print-color-adjust: exact;
  print-color-adjust: exact;
}
.art-fallback {
  position: absolute;
  inset: 0;
  background: linear-gradient(145deg,#b8d5d0,#dfc489 55%,#708f68);
  -webkit-print-color-adjust: exact;
  print-color-adjust: exact;
}
.copy {
  position: absolute;
  white-space: pre-wrap;
  display: grid;
  place-items: center;
  overflow: hidden;
  z-index: 2;
  -webkit-print-color-adjust: exact;
  print-color-adjust: exact;
}
@media print {
  .page { width: 100vw; height: 100vh; }
}
</style></head><body>${pages}</body></html>`;
}

async function exportBookViaPrint() {
  if (!project.pages?.length) return toast('没有可导出的页面', 'error');
  setBusy(true, '正在准备系统打印', '使用真实图片渲染，可选择「另存为 PDF」', { cancellable: false });
  try {
    const html = buildExportBookHtml();
    if (window.studioDesktop?.printHtml) {
      await window.studioDesktop.printHtml(html);
      toast('已打开打印/导出 PDF 对话框', 'success');
      return;
    }
    const printWindow = window.open('', '_blank');
    if (!printWindow || !printWindow.document) throw new Error('无法打开导出窗口');
    printWindow.document.write(html);
    printWindow.document.close();
    setTimeout(() => {
      try { printWindow.focus(); printWindow.print(); } catch { /* ignore */ }
    }, 400);
    toast('已打开打印/导出 PDF 对话框', 'success');
  } catch (error) {
    toast(error?.message || '打开打印失败', 'error');
  } finally {
    setBusy(false);
  }
}

function openExportBookDialog() {
  if (!project.pages?.length) return toast('没有可导出的页面', 'error');
  const dialog = $('#exportBookDialog');
  if (!dialog) {
    // 无对话框时默认 PDF
    exportBookAsPdf().catch((error) => handleTaskError(error, '导出绘本失败'));
    return;
  }
  dialog.showModal();
}

async function exportBook(format = 'menu') {
  if (format === 'pdf') return exportBookAsPdf();
  if (format === 'png' || format === 'png-zip') return exportBookAsImageZip('png');
  if (format === 'jpeg' || format === 'jpg' || format === 'jpeg-zip') return exportBookAsImageZip('jpeg');
  if (format === 'print') return exportBookViaPrint();
  openExportBookDialog();
}

async function fileToBase64(file) {
  const buffer = new Uint8Array(await file.arrayBuffer());
  let binary = '';
  for (let offset = 0; offset < buffer.length; offset += 0x8000) binary += String.fromCharCode(...buffer.subarray(offset, offset + 0x8000));
  return btoa(binary);
}

async function importDocumentFile(file) {
  const dataBase64 = await fileToBase64(file);
  return api('/api/import-document', { method: 'POST', body: JSON.stringify({ fileName: file.name, dataBase64 }) });
}

function renderKnowledgeList() {
  const list = $('#knowledgeList');
  if (!list) return;
  if (!knowledgeItems.length) {
    list.innerHTML = '<div class="knowledge-item"><strong>知识库为空</strong><span>可导入文档或将上方文档写入知识库。</span></div>';
    return;
  }
  list.innerHTML = knowledgeItems.map((item) => {
    const checked = selectedKnowledgeIds.has(item.id) ? 'checked' : '';
    const selected = selectedKnowledgeIds.has(item.id) ? 'is-selected' : '';
    return `<article class="knowledge-item ${selected}">
      <input type="checkbox" data-knowledge-check="${escapeHtml(item.id)}" ${checked}>
      <label><strong>${escapeHtml(item.title)}</strong><span>${item.characters || 0} 字 · ${escapeHtml((item.preview || '').slice(0, 60))}</span></label>
      <button type="button" class="text-button" data-knowledge-delete="${escapeHtml(item.id)}">删除</button>
    </article>`;
  }).join('');
  $$('[data-knowledge-check]').forEach((input) => input.addEventListener('change', () => {
    if (input.checked) selectedKnowledgeIds.add(input.dataset.knowledgeCheck);
    else selectedKnowledgeIds.delete(input.dataset.knowledgeCheck);
    renderKnowledgeList();
  }));
  $$('[data-knowledge-delete]').forEach((button) => button.addEventListener('click', async () => {
    try {
      await api(`/api/knowledge/${encodeURIComponent(button.dataset.knowledgeDelete)}`, { method: 'DELETE' });
      selectedKnowledgeIds.delete(button.dataset.knowledgeDelete);
      await loadKnowledge();
      toast('已删除', 'success');
    } catch (error) { toast(error.message, 'error'); }
  }));
}
