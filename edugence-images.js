// edugence-images.js
// Batch Genie — Edugence image support.
//
// Edugence stores pictures as base64 data URIs inline in the question record;
// there is no upload endpoint and no media library. So everything here exists to
// get a document's images down to a sensible size and hand them to the browser
// extension, which pastes them straight into Edugence's Quill editors.
//
// Two jobs:
//   1. Per-choice image refs. The main app has always allowed one image per
//      question (q.image_ref). Edugence lets an answer choice carry its own
//      picture too, so questions also get q.answer_image_refs — an array of
//      extractedImages keys running parallel to q.answers.
//   2. Packing. collect() resizes anything wider than MAX_W and names each file
//      so the CSV can reference it by name inside the exported .zip.
//
// Relies on globals from index.html: questions, getQ, extractedImages, esc,
// saveSession, reRenderCard.

window.EdugenceImages = (() => {
  'use strict';

  // 800px is wide enough for a titration curve or a Lewis structure to stay
  // readable on a Chromebook, and small enough that a 25-question test with a
  // picture on every item still fits inside the extension's 10MB storage quota.
  const MAX_W = 800;

  // ─── Per-choice refs ───────────────────────────────────────────────────────
  // slot: null/undefined = the question stem, a number = that answer index.
  function refsFor(q) {
    if (!Array.isArray(q.answer_image_refs)) q.answer_image_refs = [];
    return q.answer_image_refs;
  }

  function getRef(q, slot) {
    if (!q) return '';
    return slot === null || slot === undefined ? (q.image_ref || '') : (refsFor(q)[slot] || '');
  }

  function setRef(q, slot, key) {
    if (!q) return;
    if (slot === null || slot === undefined) { q.image_ref = key; return; }
    const refs = refsFor(q);
    while (refs.length <= slot) refs.push('');
    refs[slot] = key;
  }

  // Answer rows can be deleted and reordered, so the parallel array has to move
  // with them or every choice below the gap inherits the wrong picture.
  function removeSlot(q, i) {
    if (!q || !Array.isArray(q.answer_image_refs)) return;
    q.answer_image_refs.splice(i, 1);
  }

  // ─── The little camera button on each answer row ───────────────────────────
  function answerButton(qid, i) {
    const q = typeof getQ === 'function' ? getQ(qid) : null;
    const ref = getRef(q, i);
    const has = !!(ref && window.extractedImages && window.extractedImages[ref]);
    return '<button class="btn ' + (has ? 'btn-navy' : 'btn-gray') + ' btn-sm" ' +
      'title="' + (has ? 'Change or remove this choice’s image' : 'Add an image to this choice') + '" ' +
      'onclick="openImgPicker(' + qid + ',' + i + ')" ' +
      'style="flex-shrink:0">&#128444;' + (has ? ' ✓' : '') + '</button>';
  }

  // Thumbnail shown under an answer row that has a picture attached.
  function answerThumb(qid, i) {
    const q = typeof getQ === 'function' ? getQ(qid) : null;
    const ref = getRef(q, i);
    const im = ref && window.extractedImages ? window.extractedImages[ref] : null;
    if (!im) return '';
    return '<div style="margin:-2px 0 8px 30px;display:flex;align-items:center;gap:8px">' +
      '<img src="data:' + im.mime + ';base64,' + im.data + '" ' +
      'style="max-height:60px;max-width:160px;border-radius:6px;border:2px solid #6465F1;display:block">' +
      '<span style="font-size:11px;color:#888;font-family:monospace">' + esc(ref) + '</span></div>';
  }

  // ─── Resizing ──────────────────────────────────────────────────────────────
  const loadImage = src => new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('could not decode image'));
    img.src = src;
  });

  // Returns { data, mime, w, h, resized }. An image already narrow enough is
  // passed through untouched — re-encoding a photo that did not need it only
  // loses quality and, for a JPEG turned into a PNG, multiplies the file size.
  async function downscale(entry, maxW) {
    const cap = maxW || MAX_W;
    const src = 'data:' + entry.mime + ';base64,' + entry.data;
    let img;
    try { img = await loadImage(src); }
    catch (e) { return { data: entry.data, mime: entry.mime, w: 0, h: 0, resized: false, broken: true }; }

    if (img.naturalWidth <= cap) {
      return { data: entry.data, mime: entry.mime, w: img.naturalWidth, h: img.naturalHeight, resized: false };
    }

    const scale = cap / img.naturalWidth;
    const w = cap, h = Math.max(1, Math.round(img.naturalHeight * scale));
    const cv = document.createElement('canvas');
    cv.width = w; cv.height = h;
    const ctx = cv.getContext('2d');
    ctx.imageSmoothingQuality = 'high';
    // Photographs stay JPEG; everything else becomes PNG, which keeps the sharp
    // edges of diagrams, chemical structures and axis labels intact.
    const jpeg = /jpe?g/i.test(entry.mime);
    if (!jpeg) { ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, w, h); }
    ctx.drawImage(img, 0, 0, w, h);
    const outMime = jpeg ? 'image/jpeg' : 'image/png';
    const uri = cv.toDataURL(outMime, jpeg ? 0.9 : undefined);
    return { data: uri.split(',')[1], mime: outMime, w, h, resized: true };
  }

  const EXT = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/jpg': 'jpg', 'image/gif': 'gif', 'image/webp': 'webp', 'image/bmp': 'bmp' };
  const extFor = mime => EXT[String(mime).toLowerCase()] || 'png';

  // ─── Packing for export ────────────────────────────────────────────────────
  // rows: [{ q, num }] in the order they were written to the CSV, so filenames
  // line up with the q_num column and stay readable when someone opens the zip.
  //
  // Returns { files: [{ name, data }], byNum: { num: { stem, choices[] } }, stats }
  async function collect(rows, images, maxW) {
    const files = [];
    const byNum = {};
    const seen = {};           // extractedImages key + size → filename, so one
                               // picture used twice is stored once
    const stats = { count: 0, bytes: 0, resized: 0, broken: [] };

    async function add(ref, baseName) {
      const entry = images && images[ref];
      if (!entry) return '';
      const cacheKey = ref + '@' + (maxW || MAX_W);
      if (seen[cacheKey]) return seen[cacheKey];
      const out = await downscale(entry, maxW);
      if (out.broken) { stats.broken.push(ref); return ''; }
      const name = baseName + '.' + extFor(out.mime);
      files.push({ name, data: out.data });
      seen[cacheKey] = name;
      stats.count++;
      stats.bytes += Math.round(out.data.length * 0.75);   // base64 → bytes
      if (out.resized) stats.resized++;
      return name;
    }

    for (const { q, num } of rows) {
      const pad = String(num).padStart(3, '0');
      const rec = { stem: '', choices: [] };
      rec.stem = await add(getRef(q, null), 'q' + pad + '_stem');
      const answers = q.answers || [];
      for (let i = 0; i < Math.min(answers.length, 5); i++) {
        rec.choices[i] = await add(getRef(q, i), 'q' + pad + '_' + 'abcde'[i]);
      }
      byNum[num] = rec;
    }
    return { files, byNum, stats };
  }

  function humanSize(bytes) {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return Math.round(bytes / 1024) + ' KB';
    return (bytes / 1024 / 1024).toFixed(1) + ' MB';
  }

  // The extension keeps a whole run in chrome.storage.local, which is capped at
  // 10MB. Warn well before that rather than letting a run die halfway through.
  const STORAGE_WARN = 7 * 1024 * 1024;

  return {
    MAX_W, STORAGE_WARN,
    getRef, setRef, removeSlot,
    answerButton, answerThumb,
    downscale, collect, humanSize, extFor
  };
})();
