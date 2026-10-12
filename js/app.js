/* Certificate Studio — runs entirely in the browser. No data ever leaves the device. */
'use strict';

(() => {
  const $ = (id) => document.getElementById(id);

  // ---------- Constants ----------
  const STORE_KEY = 'certificate-studio:v1';
  const RTL_RE = /[֐-ࣿיִ-﷿ﹰ-﻿]/;
  const MAX_EDGE = 7000;          // cap template resolution (keeps canvases within browser limits)
  const PDF_TARGET_EDGE = 3508;   // PDF pages are rendered at ~300 DPI for A4
  const IMAGE_PDF_LONG_EDGE = 842; // image templates become A4-sized PDF pages (in points)
  const SAMPLE_TEXT = 'Recipient Name';
  const SUPPORTS_SPACING = 'letterSpacing' in CanvasRenderingContext2D.prototype;

  const FONT_GROUPS = [
    { label: 'Arabic & Latin', fonts: ['Amiri', 'Cairo', 'Tajawal'] },
    { label: 'Latin display', fonts: ['Playfair Display', 'Cormorant Garamond', 'Great Vibes', 'Montserrat'] },
    { label: 'System', fonts: ['Times New Roman', 'Georgia', 'Arial', 'Segoe UI', 'Tahoma', 'Traditional Arabic', 'Sakkal Majalla', 'Simplified Arabic'] },
  ];
  const SWATCHES = ['#1d1c1a', '#1b2a4a', '#1f4d3a', '#7a2e2a', '#a9824b', '#ffffff'];

  const DEFAULTS = {
    box: { cx: 0.5, cy: 0.535, w: 0.62, size: 0.075 },
    style: { family: 'Amiri', weight: 700, italic: false, align: 'center', direction: 'auto',
      color: '#1d1c1a', textCase: 'none', letterSpacing: 0, autoFit: true },
    format: 'pdf', numbered: false, namesText: '',
  };

  const state = {
    template: null, // { canvas, width, height, name, kind, pagePt, pdf: { doc, pageCount, page } }
    names: [],
    current: 0,
    box: { ...DEFAULTS.box },
    style: { ...DEFAULTS.style },
    format: DEFAULTS.format,
    numbered: DEFAULTS.numbered,
    showBox: true,
    busy: false,
    cancelled: false,
  };
  const customFonts = new Set();

  const els = {};
  [
    'templateEmpty', 'templateInfo', 'chooseTemplate', 'chooseTemplate2', 'useSample', 'useSample2', 'replaceTemplate',
    'templateInput', 'tplName', 'tplMeta', 'pdfPageField', 'pdfPage',
    'namesInput', 'nameCount', 'importBtn', 'clearNames', 'nameList', 'sheetInput',
    'fontFamily', 'addFont', 'fontInput', 'boldBtn', 'italicBtn', 'alignGroup', 'dirGroup',
    'sizeRange', 'sizeOut', 'colorInput', 'colorHex', 'swatches', 'textCase', 'spacingField', 'spacingRange', 'spacingOut',
    'autoFit', 'posX', 'posY', 'posW', 'centerBtn',
    'prevName', 'nextName', 'pagerName', 'pagerCount', 'toggleBox',
    'stage', 'stageEmpty', 'canvasWrap', 'preview', 'guideV', 'guideH', 'nameBox', 'stageBusy', 'stageBusyText', 'dropVeil',
    'formatGroup', 'numbered', 'dlCurrent', 'dlCombined', 'dlZip', 'dlZipLabel',
    'importDialog', 'importFile', 'importSheet', 'importColumn', 'importHeader', 'importPreview', 'importCount', 'importReplace', 'importAppend',
    'progressDialog', 'progressTitle', 'progressBar', 'progressCount', 'progressName', 'progressCancel', 'toasts',
  ].forEach((id) => { els[id] = $(id); });

  // ---------- Utilities ----------
  const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
  const round1 = (v) => Math.round(v * 10) / 10;
  const tick = () => new Promise((r) => setTimeout(r, 0));
  const isRTL = (text) => RTL_RE.test(text);

  function toast(message, type = 'info', ms = 3600) {
    const t = document.createElement('div');
    t.className = 'toast' + (type === 'error' ? ' error' : '');
    t.setAttribute('role', type === 'error' ? 'alert' : 'status');
    t.textContent = message;
    els.toasts.append(t);
    setTimeout(() => t.remove(), ms);
  }

  const scripts = {};
  function loadScript(src) {
    if (!scripts[src]) {
      scripts[src] = new Promise((resolve, reject) => {
        const s = document.createElement('script');
        s.src = src;
        s.onload = resolve;
        s.onerror = () => { delete scripts[src]; reject(new Error(`Could not load ${src}. Is the app folder complete?`)); };
        document.head.append(s);
      });
    }
    return scripts[src];
  }
  async function getPdfjs() {
    // Loading the worker as a plain script lets pdf.js run on the main thread,
    // which works when the app is opened straight from disk (file://).
    await loadScript('vendor/pdf.worker.min.js');
    await loadScript('vendor/pdf.min.js');
    window.pdfjsLib.GlobalWorkerOptions.workerSrc = 'vendor/pdf.worker.min.js';
    return window.pdfjsLib;
  }

  function download(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  }

  function canvasToBlob(canvas, type, quality) {
    return new Promise((resolve, reject) => {
      canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('The browser could not encode this image.'))), type, quality);
    });
  }

  function dateStamp() {
    const d = new Date();
    const p = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
  }

  // ---------- Persistence (settings only; templates and files are never stored) ----------
  let saveTimer = 0;
  function save() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      try {
        localStorage.setItem(STORE_KEY, JSON.stringify({
          box: state.box, style: state.style, format: state.format, numbered: state.numbered,
          namesText: els.namesInput.value,
        }));
      } catch { /* storage unavailable (private mode) — not critical */ }
    }, 250);
  }
  function restore() {
    let saved = null;
    try { saved = JSON.parse(localStorage.getItem(STORE_KEY) || 'null'); } catch { saved = null; }
    if (!saved || typeof saved !== 'object') return;
    if (saved.box) Object.assign(state.box, pickNumbers(saved.box, DEFAULTS.box));
    if (saved.style) {
      for (const k of Object.keys(DEFAULTS.style)) {
        if (typeof saved.style[k] === typeof DEFAULTS.style[k]) state.style[k] = saved.style[k];
      }
      const known = FONT_GROUPS.some((g) => g.fonts.includes(state.style.family));
      if (!known) state.style.family = DEFAULTS.style.family; // custom fonts aren't persisted
    }
    if (['pdf', 'png', 'jpg'].includes(saved.format)) state.format = saved.format;
    state.numbered = !!saved.numbered;
    if (typeof saved.namesText === 'string') els.namesInput.value = saved.namesText;
  }
  function pickNumbers(obj, defaults) {
    const out = {};
    for (const k of Object.keys(defaults)) if (Number.isFinite(obj[k])) out[k] = obj[k];
    return out;
  }

  // ---------- Fonts ----------
  const loadedFontKeys = new Set();
  function fontCss(px, family = state.style.family) {
    const s = state.style;
    return `${s.italic ? 'italic ' : ''}${s.weight} ${px}px "${family}", "Segoe UI", Tahoma, Arial, sans-serif`;
  }
  async function ensureFont(text) {
    const key = `${fontCss(10)}|${text}`;
    if (loadedFontKeys.has(key)) return;
    try { await document.fonts.load(fontCss(64), text || 'Aa'); } catch { /* fall back silently */ }
    loadedFontKeys.add(key);
  }

  function buildFontSelect() {
    const sel = els.fontFamily;
    sel.textContent = '';
    for (const g of FONT_GROUPS) {
      const og = document.createElement('optgroup');
      og.label = g.label;
      for (const f of g.fonts) og.append(new Option(f, f));
      sel.append(og);
    }
    if (customFonts.size) {
      const og = document.createElement('optgroup');
      og.label = 'Your fonts';
      for (const f of customFonts) og.append(new Option(f, f));
      sel.append(og);
    }
    sel.value = state.style.family;
  }

  async function addCustomFont(file) {
    if (!file) return;
    const family = file.name.replace(/\.[^.]+$/, '').replace(/[^\p{L}\p{N} _-]/gu, '').trim() || 'Custom font';
    try {
      const face = new FontFace(family, await file.arrayBuffer());
      await face.load();
      document.fonts.add(face);
      customFonts.add(family);
      state.style.family = family;
      buildFontSelect();
      loadedFontKeys.clear();
      onStyleChange();
      toast(`Font “${family}” added`);
    } catch {
      toast('That font file could not be read. Try a .ttf, .otf or .woff file.', 'error');
    }
  }

  // ---------- Text rendering (shared by preview and export) ----------
  function applyCase(text, mode) {
    if (mode === 'upper') return text.toLocaleUpperCase();
    if (mode === 'title') return text.toLocaleLowerCase().replace(/(^|[\s\-'’])(\p{L})/gu, (m, a, b) => a + b.toLocaleUpperCase());
    return text;
  }

  function drawName(ctx, W, H, rawName) {
    const s = state.style;
    const b = state.box;
    const text = applyCase(String(rawName || '').trim(), s.textCase);
    if (!text) return;

    const rtl = s.direction === 'rtl' || (s.direction === 'auto' && isRTL(text));
    const boxW = b.w * W;
    const left = (b.cx - b.w / 2) * W;
    const cy = b.cy * H;
    // Tracking breaks Arabic letter joining, so it only applies to non-RTL text.
    const tracking = SUPPORTS_SPACING && !isRTL(text) ? s.letterSpacing : 0;
    let size = b.size * H;

    const setFont = () => {
      ctx.font = fontCss(size);
      if (SUPPORTS_SPACING) ctx.letterSpacing = `${tracking * size}px`;
    };

    ctx.save();
    ctx.direction = rtl ? 'rtl' : 'ltr';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = s.color;
    setFont();
    if (s.autoFit) {
      for (let i = 0; i < 4; i++) {
        const w = ctx.measureText(text).width;
        if (w <= boxW || size < 2) break;
        size *= (boxW / w) * 0.995;
        setFont();
      }
    }
    ctx.textAlign = s.align; // 'left' | 'center' | 'right' are absolute in canvas
    const x = s.align === 'left' ? left : s.align === 'right' ? left + boxW : left + boxW / 2;
    ctx.fillText(text, x, cy);
    ctx.restore();
  }

  // ---------- Template loading ----------
  function setStageBusy(on, text = 'Opening template…') {
    els.stageBusy.hidden = !on;
    els.stageBusyText.textContent = text;
  }

  async function loadTemplateFile(file) {
    if (!file) return;
    const isPdf = file.type === 'application/pdf' || /\.pdf$/i.test(file.name);
    const isImage = file.type.startsWith('image/') || /\.(png|jpe?g|webp|gif|bmp|svg)$/i.test(file.name);
    if (!isPdf && !isImage) {
      toast('Unsupported file. Please use a PNG, JPG, WEBP, SVG or PDF template.', 'error');
      return;
    }
    setStageBusy(true);
    try {
      if (isPdf) {
        const pdfjs = await getPdfjs();
        const data = new Uint8Array(await file.arrayBuffer());
        const doc = await pdfjs.getDocument({ data, isEvalSupported: false }).promise;
        const page = await renderPdfPage(doc, 1);
        if (state.template?.pdf?.doc && state.template.pdf.doc !== doc) state.template.pdf.doc.destroy();
        setTemplate({ ...page, name: file.name, kind: 'pdf', pdf: { doc, pageCount: doc.numPages, page: 1 } });
      } else {
        const canvas = await imageFileToCanvas(file);
        setTemplate({ canvas, width: canvas.width, height: canvas.height, name: file.name, kind: 'image', pagePt: null });
      }
    } catch (err) {
      console.error(err);
      const msg = /password/i.test(err?.name + err?.message)
        ? 'This PDF is password-protected. Please export an unlocked copy.'
        : 'This file could not be opened as a template. It may be damaged or in an unsupported format.';
      toast(msg, 'error', 5000);
    } finally {
      setStageBusy(false);
    }
  }

  async function imageFileToCanvas(file) {
    const url = URL.createObjectURL(file);
    try {
      const img = new Image();
      img.src = url;
      await img.decode();
      let w = img.naturalWidth || 2000;
      let h = img.naturalHeight || 1414;
      const scale = Math.min(1, MAX_EDGE / Math.max(w, h));
      w = Math.round(w * scale);
      h = Math.round(h * scale);
      const canvas = document.createElement('canvas');
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext('2d');
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(img, 0, 0, w, h);
      return canvas;
    } finally {
      URL.revokeObjectURL(url);
    }
  }

  async function renderPdfPage(doc, pageNumber) {
    const page = await doc.getPage(pageNumber);
    const base = page.getViewport({ scale: 1 });
    const scale = Math.min(PDF_TARGET_EDGE / Math.max(base.width, base.height), MAX_EDGE / Math.max(base.width, base.height));
    const viewport = page.getViewport({ scale });
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(viewport.width);
    canvas.height = Math.round(viewport.height);
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    await page.render({ canvasContext: ctx, viewport }).promise;
    page.cleanup();
    return { canvas, width: canvas.width, height: canvas.height, pagePt: [base.width, base.height] };
  }

  async function changePdfPage(n) {
    const t = state.template;
    if (!t?.pdf) return;
    setStageBusy(true, 'Rendering page…');
    try {
      const page = await renderPdfPage(t.pdf.doc, n);
      setTemplate({ ...t, ...page, pdf: { ...t.pdf, page: n } });
    } catch (err) {
      console.error(err);
      toast('That page could not be rendered.', 'error');
    } finally {
      setStageBusy(false);
    }
  }

  function setTemplate(t) {
    state.template = t;
    els.templateEmpty.hidden = true;
    els.templateInfo.hidden = false;
    els.stageEmpty.hidden = true;
    els.canvasWrap.hidden = false;
    els.tplName.textContent = t.name;
    els.tplName.title = t.name;
    const kind = t.kind === 'pdf' ? `PDF · page ${t.pdf.page} of ${t.pdf.pageCount}` : t.kind === 'sample' ? 'Sample design' : 'Image';
    els.tplMeta.textContent = `${t.width} × ${t.height} px · ${kind}`;
    els.pdfPageField.hidden = !(t.pdf && t.pdf.pageCount > 1);
    if (t.pdf && t.pdf.pageCount > 1) {
      els.pdfPage.textContent = '';
      for (let i = 1; i <= t.pdf.pageCount; i++) els.pdfPage.append(new Option(`Page ${i}`, String(i)));
      els.pdfPage.value = String(t.pdf.page);
    }
    syncControls();
    updateExportState();
    layoutStage();
  }

  // A built-in sample design so the whole workflow can be tried without a file.
  async function makeSampleTemplate() {
    const W = 3508, H = 2480;
    await Promise.all([
      document.fonts.load('600 100px "Cormorant Garamond"'),
      document.fonts.load('400 100px "Great Vibes"'),
      document.fonts.load('400 100px "Montserrat"'),
      document.fonts.load('700 100px "Montserrat"'),
    ]).catch(() => {});
    const c = document.createElement('canvas');
    c.width = W; c.height = H;
    const g = c.getContext('2d');
    const green = '#1f4d3a', brass = '#a9824b', ink = '#2a2824';

    g.fillStyle = '#fbf8f1';
    g.fillRect(0, 0, W, H);
    g.fillStyle = green;
    g.fillRect(0, 0, W, 70); g.fillRect(0, H - 70, W, 70); g.fillRect(0, 0, 70, H); g.fillRect(W - 70, 0, 70, H);
    g.strokeStyle = brass;
    g.lineWidth = 6; g.strokeRect(130, 130, W - 260, H - 260);
    g.lineWidth = 2; g.strokeRect(160, 160, W - 320, H - 320);
    // corner diamonds
    g.fillStyle = brass;
    for (const [x, y] of [[145, 145], [W - 145, 145], [145, H - 145], [W - 145, H - 145]]) {
      g.save(); g.translate(x, y); g.rotate(Math.PI / 4); g.fillRect(-22, -22, 44, 44); g.restore();
    }
    g.textAlign = 'center';
    g.textBaseline = 'alphabetic';
    g.fillStyle = green;
    g.font = '600 230px "Cormorant Garamond", Georgia, serif';
    if (SUPPORTS_SPACING) g.letterSpacing = '40px';
    g.fillText('CERTIFICATE', W / 2 + 20, 640);
    if (SUPPORTS_SPACING) g.letterSpacing = '0px';
    g.fillStyle = brass;
    g.font = '400 170px "Great Vibes", cursive';
    g.fillText('of Achievement', W / 2, 860);
    g.fillStyle = ink;
    g.font = '400 64px "Montserrat", Arial, sans-serif';
    if (SUPPORTS_SPACING) g.letterSpacing = '14px';
    g.fillText('THIS CERTIFICATE IS PROUDLY PRESENTED TO', W / 2 + 7, 1100);
    if (SUPPORTS_SPACING) g.letterSpacing = '0px';
    // name rule
    g.strokeStyle = brass; g.lineWidth = 3;
    g.beginPath(); g.moveTo(W / 2 - 1000, 1490); g.lineTo(W / 2 + 1000, 1490); g.stroke();
    g.fillStyle = '#57534b';
    g.font = '400 70px "Cormorant Garamond", Georgia, serif';
    g.fillText('in recognition of outstanding dedication, effort and excellence.', W / 2, 1650);
    // signatures
    g.strokeStyle = ink; g.lineWidth = 3;
    for (const x of [W * 0.25, W * 0.75]) {
      g.beginPath(); g.moveTo(x - 420, 2010); g.lineTo(x + 420, 2010); g.stroke();
    }
    g.font = '700 50px "Montserrat", Arial, sans-serif';
    if (SUPPORTS_SPACING) g.letterSpacing = '8px';
    g.fillStyle = ink;
    g.fillText('DIRECTOR', W * 0.25 + 4, 2090);
    g.fillText('DATE', W * 0.75 + 4, 2090);
    if (SUPPORTS_SPACING) g.letterSpacing = '0px';
    // seal
    const sx = W / 2, sy = 2010;
    g.fillStyle = green;
    g.beginPath(); g.arc(sx, sy, 170, 0, Math.PI * 2); g.fill();
    g.strokeStyle = '#c9a56a'; g.lineWidth = 6; g.setLineDash([14, 14]);
    g.beginPath(); g.arc(sx, sy, 130, 0, Math.PI * 2); g.stroke();
    g.setLineDash([]);
    g.strokeStyle = '#f5f2ea'; g.lineWidth = 18; g.lineCap = 'round'; g.lineJoin = 'round';
    g.beginPath(); g.moveTo(sx - 60, sy + 5); g.lineTo(sx - 15, sy + 50); g.lineTo(sx + 65, sy - 45); g.stroke();
    return c;
  }

  async function useSample() {
    setStageBusy(true, 'Preparing sample…');
    try {
      const canvas = await makeSampleTemplate();
      state.box = { cx: 0.5, cy: 0.545, w: 0.56, size: 0.085 };
      setTemplate({ canvas, width: canvas.width, height: canvas.height, name: 'Sample certificate', kind: 'sample', pagePt: null });
      save();
    } finally {
      setStageBusy(false);
    }
  }

  // ---------- Preview stage ----------
  const view = { w: 0, h: 0, dpr: 1 };
  let scaledTemplate = null;
  let rafId = 0;
  let renderToken = 0;

  function layoutStage() {
    const t = state.template;
    if (!t) return;
    const stage = els.stage;
    const cs = getComputedStyle(stage);
    const availW = stage.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
    const stacked = window.matchMedia('(max-width: 900px)').matches;
    const availH = stacked ? Infinity : stage.clientHeight - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom);
    const scale = Math.min(availW / t.width, availH / t.height);
    const w = Math.max(1, Math.floor(t.width * scale));
    const h = Math.max(1, Math.floor(t.height * scale));
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    if (w === view.w && h === view.h && dpr === view.dpr && scaledTemplate?.source === t.canvas) { requestRender(); return; }
    Object.assign(view, { w, h, dpr });
    els.canvasWrap.style.width = `${w}px`;
    els.canvasWrap.style.height = `${h}px`;
    els.preview.width = Math.round(w * dpr);
    els.preview.height = Math.round(h * dpr);
    // Cache a downscaled copy so dragging stays smooth on large templates.
    const sc = document.createElement('canvas');
    sc.width = els.preview.width;
    sc.height = els.preview.height;
    const g = sc.getContext('2d');
    g.imageSmoothingQuality = 'high';
    g.drawImage(t.canvas, 0, 0, sc.width, sc.height);
    sc.source = t.canvas;
    scaledTemplate = sc;
    requestRender();
  }

  function requestRender() {
    positionBox();
    cancelAnimationFrame(rafId);
    rafId = requestAnimationFrame(renderPreview);
  }

  function previewName() {
    return state.names[state.current] ?? SAMPLE_TEXT;
  }

  async function renderPreview() {
    if (!state.template || !scaledTemplate) return;
    const token = ++renderToken;
    const name = previewName();
    await ensureFont(applyCase(name, state.style.textCase));
    if (token !== renderToken) return;
    const c = els.preview;
    const ctx = c.getContext('2d');
    ctx.clearRect(0, 0, c.width, c.height);
    ctx.drawImage(scaledTemplate, 0, 0);
    drawName(ctx, c.width, c.height, name);
  }

  function positionBox() {
    if (!view.w) return;
    const b = state.box;
    const hPx = Math.max(14, b.size * view.h * 1.35);
    const s = els.nameBox.style;
    s.left = `${(b.cx - b.w / 2) * view.w}px`;
    s.width = `${b.w * view.w}px`;
    s.top = `${b.cy * view.h - hPx / 2}px`;
    s.height = `${hPx}px`;
  }

  // Drag to move, side handles to resize the box, corner handle to scale the type.
  function initBoxDrag() {
    const box = els.nameBox;
    const SNAP = 0.008;
    let drag = null;

    box.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      e.preventDefault();
      box.focus({ preventScroll: true });
      box.setPointerCapture(e.pointerId);
      drag = { handle: e.target.dataset.handle || 'move', x: e.clientX, y: e.clientY, b: { ...state.box } };
    });
    box.addEventListener('pointermove', (e) => {
      if (!drag) return;
      const dx = (e.clientX - drag.x) / view.w;
      const dy = (e.clientY - drag.y) / view.h;
      const s = drag.b;
      const b = state.box;
      const left = s.cx - s.w / 2;
      const right = s.cx + s.w / 2;
      if (drag.handle === 'move') {
        let cx = clamp(s.cx + dx, 0, 1);
        let cy = clamp(s.cy + dy, 0, 1);
        const snapX = Math.abs(cx - 0.5) < SNAP;
        const snapY = Math.abs(cy - 0.5) < SNAP;
        if (snapX) cx = 0.5;
        if (snapY) cy = 0.5;
        els.guideV.classList.toggle('on', snapX);
        els.guideH.classList.toggle('on', snapY);
        b.cx = cx; b.cy = cy;
      } else if (drag.handle === 'r') {
        const r = clamp(right + dx, left + 0.03, 1);
        b.w = r - left; b.cx = (left + r) / 2;
      } else if (drag.handle === 'l') {
        const l = clamp(left + dx, 0, right - 0.03);
        b.w = right - l; b.cx = (l + right) / 2;
      } else if (drag.handle === 'size') {
        b.size = clamp(s.size + dy / 1.35 * 2, 0.01, 0.3);
      }
      syncControls();
      requestRender();
    });
    const end = () => {
      if (!drag) return;
      drag = null;
      els.guideV.classList.remove('on');
      els.guideH.classList.remove('on');
      save();
    };
    box.addEventListener('pointerup', end);
    box.addEventListener('pointercancel', end);

    box.addEventListener('keydown', (e) => {
      const step = e.shiftKey ? 0.01 : 0.002;
      const moves = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] };
      const m = moves[e.key];
      if (!m) return;
      e.preventDefault();
      state.box.cx = clamp(state.box.cx + m[0], 0, 1);
      state.box.cy = clamp(state.box.cy + m[1], 0, 1);
      syncControls();
      requestRender();
      save();
    });
  }

  // ---------- Names ----------
  function parseNames(text) {
    return text.replace(/^﻿/, '').split(/\r?\n/).map((s) => s.replace(/\s+/g, ' ').trim()).filter(Boolean);
  }

  function onNamesChange() {
    state.names = parseNames(els.namesInput.value);
    state.current = clamp(state.current, 0, Math.max(0, state.names.length - 1));
    els.nameCount.textContent = state.names.length;
    renderNameList();
    updatePager();
    updateExportState();
    requestRender();
    save();
  }

  function renderNameList() {
    const frag = document.createDocumentFragment();
    const pad = Math.max(2, String(state.names.length).length);
    state.names.forEach((name, i) => {
      const li = document.createElement('li');
      li.className = 'name-row' + (i === state.current ? ' active' : '');
      li.dataset.i = i;
      const idx = document.createElement('span');
      idx.className = 'idx';
      idx.textContent = String(i + 1).padStart(pad, '0');
      const nm = document.createElement('span');
      nm.className = 'nm';
      nm.dir = 'auto';
      nm.textContent = name;
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'icon-btn';
      btn.dataset.act = 'download';
      btn.title = 'Download this certificate';
      btn.setAttribute('aria-label', `Download certificate for ${name}`);
      btn.innerHTML = '<svg class="ic"><use href="#i-download"/></svg>';
      li.append(idx, nm, btn);
      frag.append(li);
    });
    els.nameList.replaceChildren(frag);
  }

  function setCurrent(i, scroll = true) {
    if (!state.names.length) return;
    state.current = (i + state.names.length) % state.names.length;
    els.nameList.querySelectorAll('.name-row.active').forEach((n) => n.classList.remove('active'));
    const row = els.nameList.children[state.current];
    if (row) {
      row.classList.add('active');
      if (scroll) row.scrollIntoView({ block: 'nearest' });
    }
    updatePager();
    requestRender();
  }

  function updatePager() {
    const n = state.names.length;
    els.pagerName.textContent = previewName();
    els.pagerCount.textContent = n ? `${state.current + 1} of ${n}` : 'Sample text — add names to preview them';
    els.prevName.disabled = els.nextName.disabled = n < 2;
  }

  // ---------- Spreadsheet import ----------
  const NAME_HEADER_RE = /(^|\b)(full\s*name|name|names|recipient|student|participant|attendee|trainee)(\b|$)|الاسم|اسم|المتدرب|الطالب|المشارك/i;
  let importBook = null;

  async function openSpreadsheet(file) {
    if (!file) return;
    try {
      await loadScript('vendor/xlsx.full.min.js');
      const book = window.XLSX.read(new Uint8Array(await file.arrayBuffer()), { type: 'array', dense: true });
      if (!book.SheetNames.length) throw new Error('No sheets');
      importBook = book;
      els.importFile.textContent = file.name;
      els.importSheet.textContent = '';
      book.SheetNames.forEach((n) => els.importSheet.append(new Option(n, n)));
      els.importSheet.parentElement.hidden = book.SheetNames.length < 2;
      prepareImportSheet(true);
      els.importDialog.showModal();
    } catch (err) {
      console.error(err);
      toast('That spreadsheet could not be read. Save it as .xlsx or .csv and try again.', 'error', 5000);
    }
  }

  function sheetRows() {
    const ws = importBook.Sheets[els.importSheet.value];
    return window.XLSX.utils.sheet_to_json(ws, { header: 1, defval: '', raw: false, blankrows: false })
      .map((r) => r.map((v) => String(v ?? '').replace(/\s+/g, ' ').trim()));
  }

  function prepareImportSheet(guess) {
    const rows = sheetRows();
    const cols = rows.reduce((m, r) => Math.max(m, r.length), 0);
    const first = rows[0] || [];
    let headerIdx = first.findIndex((v) => NAME_HEADER_RE.test(v));
    if (guess) els.importHeader.checked = headerIdx >= 0;
    if (headerIdx < 0) {
      // Pick the column with the most text-like values.
      let best = 0, bestScore = -1;
      for (let c = 0; c < cols; c++) {
        const score = rows.filter((r) => r[c] && !/^[\d\s.,:/@+-]+$/.test(r[c]) && !r[c].includes('@')).length;
        if (score > bestScore) { best = c; bestScore = score; }
      }
      headerIdx = best;
    }
    els.importColumn.textContent = '';
    for (let c = 0; c < Math.max(cols, 1); c++) {
      const letter = window.XLSX.utils.encode_col(c);
      const label = els.importHeader.checked && first[c] ? `${letter} — ${first[c]}` : `Column ${letter}`;
      els.importColumn.append(new Option(label, String(c)));
    }
    els.importColumn.value = String(headerIdx);
    updateImportPreview();
  }

  function importedNames() {
    const col = Number(els.importColumn.value) || 0;
    const rows = sheetRows();
    return rows.slice(els.importHeader.checked ? 1 : 0).map((r) => r[col] || '').filter(Boolean);
  }

  function updateImportPreview() {
    const names = importedNames();
    els.importPreview.replaceChildren(...names.slice(0, 8).map((n) => {
      const li = document.createElement('li');
      li.textContent = n;
      li.dir = 'auto';
      return li;
    }));
    els.importCount.textContent = `${names.length} name${names.length === 1 ? '' : 's'}${names.length > 8 ? ' · first 8 shown' : ''}`;
    els.importReplace.disabled = els.importAppend.disabled = !names.length;
  }

  function finishImport() {
    const action = els.importDialog.returnValue;
    if ((action === 'replace' || action === 'append') && importBook) {
      const names = importedNames();
      const existing = action === 'append' ? parseNames(els.namesInput.value) : [];
      els.namesInput.value = [...existing, ...names].join('\n');
      if (action === 'replace') state.current = 0;
      onNamesChange();
      toast(`${names.length} name${names.length === 1 ? '' : 's'} imported`);
    }
    importBook = null;
    els.sheetInput.value = '';
  }

  // ---------- Style controls ----------
  function sizePx() {
    return Math.round(state.box.size * (state.template?.height || 1000));
  }

  function syncControls() {
    const s = state.style, b = state.box;
    els.fontFamily.value = s.family;
    els.boldBtn.setAttribute('aria-pressed', String(s.weight >= 600));
    els.italicBtn.setAttribute('aria-pressed', String(s.italic));
    els.alignGroup.querySelectorAll('[data-align]').forEach((n) => n.setAttribute('aria-pressed', String(n.dataset.align === s.align)));
    els.dirGroup.querySelectorAll('[data-dir]').forEach((n) => n.setAttribute('aria-pressed', String(n.dataset.dir === s.direction)));
    els.sizeRange.value = round1(b.size * 100);
    els.sizeOut.textContent = state.template ? `${sizePx()} px` : `${round1(b.size * 100)}%`;
    els.colorInput.value = s.color;
    if (document.activeElement !== els.colorHex) els.colorHex.value = s.color.toUpperCase();
    els.swatches.querySelectorAll('.swatch').forEach((n) => n.setAttribute('aria-pressed', String(n.dataset.color === s.color.toLowerCase())));
    els.textCase.value = s.textCase;
    els.spacingRange.value = s.letterSpacing;
    els.spacingOut.textContent = `${Math.round(s.letterSpacing * 100)}`;
    els.autoFit.checked = s.autoFit;
    if (document.activeElement !== els.posX) els.posX.value = round1(b.cx * 100);
    if (document.activeElement !== els.posY) els.posY.value = round1(b.cy * 100);
    if (document.activeElement !== els.posW) els.posW.value = round1(b.w * 100);
    els.formatGroup.querySelectorAll('[data-format]').forEach((n) => n.setAttribute('aria-checked', String(n.dataset.format === state.format)));
    els.numbered.checked = state.numbered;
    els.toggleBox.setAttribute('aria-pressed', String(state.showBox));
    els.canvasWrap.classList.toggle('hide-box', !state.showBox);
  }

  function onStyleChange() {
    syncControls();
    requestRender();
    save();
  }

  function initControls() {
    buildFontSelect();
    SWATCHES.forEach((c) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'swatch';
      b.dataset.color = c;
      b.style.background = c;
      b.title = c.toUpperCase();
      b.setAttribute('aria-label', `Color ${c}`);
      els.swatches.append(b);
    });
    if (!SUPPORTS_SPACING) els.spacingField.hidden = true;

    els.fontFamily.addEventListener('change', () => { state.style.family = els.fontFamily.value; onStyleChange(); });
    els.addFont.addEventListener('click', () => els.fontInput.click());
    els.fontInput.addEventListener('change', () => { addCustomFont(els.fontInput.files[0]); els.fontInput.value = ''; });
    els.boldBtn.addEventListener('click', () => { state.style.weight = state.style.weight >= 600 ? 400 : 700; onStyleChange(); });
    els.italicBtn.addEventListener('click', () => { state.style.italic = !state.style.italic; onStyleChange(); });
    els.alignGroup.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-align]');
      if (btn) { state.style.align = btn.dataset.align; onStyleChange(); }
    });
    els.dirGroup.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-dir]');
      if (btn) { state.style.direction = btn.dataset.dir; onStyleChange(); }
    });
    els.sizeRange.addEventListener('input', () => { state.box.size = Number(els.sizeRange.value) / 100; onStyleChange(); });
    els.colorInput.addEventListener('input', () => { state.style.color = els.colorInput.value.toLowerCase(); onStyleChange(); });
    els.colorHex.addEventListener('input', () => {
      let v = els.colorHex.value.trim();
      if (!v.startsWith('#')) v = '#' + v;
      if (/^#[0-9a-f]{6}$/i.test(v)) { state.style.color = v.toLowerCase(); onStyleChange(); }
      else if (/^#[0-9a-f]{3}$/i.test(v)) { state.style.color = ('#' + v.slice(1).split('').map((c) => c + c).join('')).toLowerCase(); onStyleChange(); }
    });
    els.colorHex.addEventListener('blur', syncControls);
    els.swatches.addEventListener('click', (e) => {
      const b = e.target.closest('.swatch');
      if (b) { state.style.color = b.dataset.color; onStyleChange(); }
    });
    els.textCase.addEventListener('change', () => { state.style.textCase = els.textCase.value; onStyleChange(); });
    els.spacingRange.addEventListener('input', () => { state.style.letterSpacing = Number(els.spacingRange.value); onStyleChange(); });
    els.autoFit.addEventListener('change', () => { state.style.autoFit = els.autoFit.checked; onStyleChange(); });

    const posInput = (el, apply) => el.addEventListener('input', () => {
      const v = Number(el.value);
      if (el.value !== '' && Number.isFinite(v)) { apply(v / 100); requestRender(); save(); }
    });
    posInput(els.posX, (v) => { state.box.cx = clamp(v, 0, 1); });
    posInput(els.posY, (v) => { state.box.cy = clamp(v, 0, 1); });
    posInput(els.posW, (v) => { state.box.w = clamp(v, 0.03, 1); });
    [els.posX, els.posY, els.posW].forEach((el) => el.addEventListener('blur', syncControls));
    els.centerBtn.addEventListener('click', () => { state.box.cx = 0.5; onStyleChange(); });

    els.toggleBox.addEventListener('click', () => { state.showBox = !state.showBox; syncControls(); });
    els.formatGroup.addEventListener('click', (e) => {
      const b = e.target.closest('[data-format]');
      if (b) { state.format = b.dataset.format; syncControls(); updateExportState(); save(); }
    });
    els.numbered.addEventListener('change', () => { state.numbered = els.numbered.checked; save(); });
  }

  // ---------- Export ----------
  class Cancelled extends Error {}
  let exportCanvas = null;

  function pageSizePt() {
    const t = state.template;
    if (t.pagePt) return t.pagePt;
    const r = t.width / t.height;
    return r >= 1 ? [IMAGE_PDF_LONG_EDGE, IMAGE_PDF_LONG_EDGE / r] : [IMAGE_PDF_LONG_EDGE * r, IMAGE_PDF_LONG_EDGE];
  }

  async function renderFull(name, opaque) {
    const t = state.template;
    exportCanvas = exportCanvas || document.createElement('canvas');
    const c = exportCanvas;
    c.width = t.width;
    c.height = t.height;
    const ctx = c.getContext('2d');
    await ensureFont(applyCase(name, state.style.textCase));
    if (opaque) { ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, c.width, c.height); }
    ctx.drawImage(t.canvas, 0, 0);
    drawName(ctx, c.width, c.height, name);
    return c;
  }

  async function addPdfPage(doc, name, first) {
    const [pw, ph] = pageSizePt();
    const c = await renderFull(name, true);
    const jpg = new Uint8Array(await (await canvasToBlob(c, 'image/jpeg', 0.95)).arrayBuffer());
    if (!first) doc.addPage([pw, ph], pw > ph ? 'landscape' : 'portrait');
    doc.addImage(jpg, 'JPEG', 0, 0, pw, ph, undefined, 'NONE');
  }

  function newPdf() {
    const [pw, ph] = pageSizePt();
    return new window.jspdf.jsPDF({ orientation: pw > ph ? 'landscape' : 'portrait', unit: 'pt', format: [pw, ph], compress: true });
  }

  async function makeFile(name, format) {
    if (format === 'png') return canvasToBlob(await renderFull(name, false), 'image/png');
    if (format === 'jpg') return canvasToBlob(await renderFull(name, true), 'image/jpeg', 0.95);
    const doc = newPdf();
    await addPdfPage(doc, name, true);
    return doc.output('blob');
  }

  function safeFileName(name, index, total, ext, used) {
    let base = name.replace(/[\\/:*?"<>|\u0000-\u001f\u007f]/g, '').replace(/\s+/g, ' ').trim().replace(/^\.+|\.+$/g, '').slice(0, 120).trim();
    if (!base) base = `certificate-${index + 1}`;
    if (/^(con|prn|aux|nul|com\d|lpt\d)$/i.test(base)) base += '_';
    if (state.numbered) base = `${String(index + 1).padStart(Math.max(3, String(total).length), '0')} - ${base}`;
    let candidate = base;
    for (let k = 2; used.has(candidate.toLowerCase()); k++) candidate = `${base} (${k})`;
    used.add(candidate.toLowerCase());
    return `${candidate}.${ext}`;
  }

  async function loadExportLibs(needPdf, needZip) {
    if (needPdf) await loadScript('vendor/jspdf.umd.min.js');
    if (needZip) await loadScript('vendor/jszip.min.js');
  }

  function canExport() {
    if (!state.template) { toast('Add a template first.', 'error'); return false; }
    if (!state.names.length) { toast('Add at least one recipient name.', 'error'); return false; }
    return !state.busy;
  }

  function updateExportState() {
    const ready = !!state.template && state.names.length > 0;
    els.dlCurrent.disabled = !ready;
    els.dlZip.disabled = !ready;
    els.dlCombined.disabled = !ready;
    els.dlCombined.hidden = state.format !== 'pdf';
    els.dlZipLabel.textContent = state.names.length ? `Download all ${state.names.length} (ZIP)` : 'Download all (ZIP)';
  }

  async function downloadOne(index) {
    if (!canExport()) return;
    const name = state.names[index];
    state.busy = true;
    try {
      await loadExportLibs(state.format === 'pdf', false);
      const blob = await makeFile(name, state.format);
      download(blob, safeFileName(name, index, state.names.length, state.format, new Set()));
    } catch (err) {
      console.error(err);
      toast('Export failed. ' + (err.message || ''), 'error', 5000);
    } finally {
      state.busy = false;
    }
  }

  function showProgress(title) {
    state.cancelled = false;
    els.progressTitle.textContent = title;
    els.progressBar.style.width = '0%';
    els.progressCount.textContent = '';
    els.progressName.textContent = '';
    els.progressCancel.disabled = false;
    els.progressDialog.showModal();
  }
  function setProgress(fraction, count, name) {
    els.progressBar.style.width = `${Math.round(fraction * 100)}%`;
    els.progressCount.textContent = count;
    els.progressName.textContent = name;
  }

  async function runBatch(kind) {
    if (!canExport()) return;
    const names = [...state.names];
    const total = names.length;
    const format = kind === 'combined' ? 'pdf' : state.format;
    state.busy = true;
    showProgress(kind === 'combined' ? 'Building one PDF' : `Generating ${total} certificate${total === 1 ? '' : 's'}`);
    try {
      await loadExportLibs(format === 'pdf', kind === 'zip');
      if (kind === 'zip') {
        const zip = new window.JSZip();
        const used = new Set();
        for (let i = 0; i < total; i++) {
          if (state.cancelled) throw new Cancelled();
          setProgress(i / total * 0.92, `${i + 1} / ${total}`, names[i]);
          zip.file(safeFileName(names[i], i, total, format, used), await makeFile(names[i], format));
          await tick();
        }
        setProgress(0.92, '', 'Packaging ZIP…');
        els.progressCancel.disabled = true;
        const out = await zip.generateAsync({ type: 'blob', compression: 'STORE' }, (m) => {
          els.progressBar.style.width = `${Math.round(92 + m.percent * 0.08)}%`;
        });
        download(out, `certificates-${dateStamp()}.zip`);
      } else {
        const doc = newPdf();
        for (let i = 0; i < total; i++) {
          if (state.cancelled) throw new Cancelled();
          setProgress(i / total, `${i + 1} / ${total}`, names[i]);
          await addPdfPage(doc, names[i], i === 0);
          await tick();
        }
        setProgress(1, '', 'Saving PDF…');
        await tick();
        download(doc.output('blob'), `certificates-${dateStamp()}.pdf`);
      }
      toast(`${total} certificate${total === 1 ? '' : 's'} ready`);
    } catch (err) {
      if (err instanceof Cancelled) toast('Export cancelled');
      else { console.error(err); toast('Export failed. ' + (err.message || ''), 'error', 6000); }
    } finally {
      state.busy = false;
      if (els.progressDialog.open) els.progressDialog.close();
    }
  }

  // ---------- Wiring ----------
  function initEvents() {
    const pickTemplate = () => els.templateInput.click();
    [els.chooseTemplate, els.chooseTemplate2, els.replaceTemplate].forEach((b) => b.addEventListener('click', pickTemplate));
    [els.useSample, els.useSample2].forEach((b) => b.addEventListener('click', useSample));
    els.templateInput.addEventListener('change', () => { loadTemplateFile(els.templateInput.files[0]); els.templateInput.value = ''; });
    els.pdfPage.addEventListener('change', () => changePdfPage(Number(els.pdfPage.value)));

    // Drag & drop: templates anywhere on the stage, spreadsheets onto the names panel or stage.
    let dragDepth = 0;
    const hasFiles = (e) => [...(e.dataTransfer?.types || [])].includes('Files');
    window.addEventListener('dragenter', (e) => { if (hasFiles(e)) { dragDepth++; els.dropVeil.hidden = false; } });
    window.addEventListener('dragleave', () => { dragDepth = Math.max(0, dragDepth - 1); if (!dragDepth) els.dropVeil.hidden = true; });
    window.addEventListener('dragover', (e) => { if (hasFiles(e)) e.preventDefault(); });
    window.addEventListener('drop', (e) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      dragDepth = 0;
      els.dropVeil.hidden = true;
      const file = e.dataTransfer.files[0];
      if (!file) return;
      if (/\.(xlsx|xls|csv|ods)$/i.test(file.name)) openSpreadsheet(file);
      else if (/\.(ttf|otf|woff2?)$/i.test(file.name)) addCustomFont(file);
      else loadTemplateFile(file);
    });

    els.namesInput.addEventListener('input', onNamesChange);
    els.clearNames.addEventListener('click', () => {
      if (!els.namesInput.value) return;
      els.namesInput.value = '';
      state.current = 0;
      onNamesChange();
    });
    els.nameList.addEventListener('click', (e) => {
      const row = e.target.closest('.name-row');
      if (!row) return;
      const i = Number(row.dataset.i);
      if (e.target.closest('[data-act="download"]')) downloadOne(i);
      else setCurrent(i, false);
    });
    els.prevName.addEventListener('click', () => setCurrent(state.current - 1));
    els.nextName.addEventListener('click', () => setCurrent(state.current + 1));
    document.addEventListener('keydown', (e) => {
      if (e.target.closest('input, textarea, select, [contenteditable], .name-box') || document.querySelector('dialog[open]')) return;
      if (e.key === 'PageDown' || e.key === ']') { e.preventDefault(); setCurrent(state.current + 1); }
      if (e.key === 'PageUp' || e.key === '[') { e.preventDefault(); setCurrent(state.current - 1); }
    });

    els.importBtn.addEventListener('click', () => els.sheetInput.click());
    els.sheetInput.addEventListener('change', () => openSpreadsheet(els.sheetInput.files[0]));
    els.importSheet.addEventListener('change', () => prepareImportSheet(true));
    els.importHeader.addEventListener('change', () => {
      const col = els.importColumn.value;
      prepareImportSheet(false);
      els.importColumn.value = col;
      updateImportPreview();
    });
    els.importColumn.addEventListener('change', updateImportPreview);
    els.importDialog.addEventListener('close', finishImport);

    els.dlCurrent.addEventListener('click', () => downloadOne(state.current));
    els.dlZip.addEventListener('click', () => runBatch('zip'));
    els.dlCombined.addEventListener('click', () => runBatch('combined'));
    els.progressCancel.addEventListener('click', () => { state.cancelled = true; els.progressCancel.disabled = true; });
    els.progressDialog.addEventListener('cancel', (e) => { e.preventDefault(); state.cancelled = true; });

    new ResizeObserver(() => layoutStage()).observe(els.stage);
    window.addEventListener('beforeunload', (e) => { if (state.busy) e.preventDefault(); });
  }

  // ---------- Boot ----------
  restore();
  initControls();
  initBoxDrag();
  initEvents();
  syncControls();
  onNamesChange();
  // Re-render once bundled web fonts finish loading so the preview is exact.
  document.fonts.ready.then(() => { loadedFontKeys.clear(); requestRender(); });
})();
