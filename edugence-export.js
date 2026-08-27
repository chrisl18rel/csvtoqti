// edugence-export.js
// Batch Genie — Edugence support: load a course TEKS PDF once (cached in the browser),
// tag questions with the best-matching SE via AI, and export the CSV that
// edugence-builder.js consumes. Relies on globals from index.html:
// questions, getQ, esc, csvCell, setStatus, showAppAlert, renderAllQuestions,
// saveSession, validateForExport, pdfjsLib, window.activeModel, #apiKey.

window.EdugenceExport = (() => {
  const TEKS_KEY = 'bg_edugence_teks_v1';
  const CSV_HEADER = ['test_title', 'q_num', 'type', 'tek', 'question', 'choice_a', 'choice_b', 'choice_c', 'choice_d', 'choice_e', 'correct', 'num_value', 'num_min', 'num_max', 'notes'];

  let teks = loadTeks();

  // ─── TEKS storage ──────────────────────────────────────────────────────────
  function loadTeks() {
    try { return JSON.parse(localStorage.getItem(TEKS_KEY) || 'null'); } catch (e) { return null; }
  }
  function saveTeks(data) {
    teks = data;
    if (data) localStorage.setItem(TEKS_KEY, JSON.stringify(data));
    else localStorage.removeItem(TEKS_KEY);
    renderTeksStatus();
  }

  function renderTeksStatus() {
    const el = document.getElementById('teksStatus');
    const list = document.getElementById('teksList');
    if (el) {
      el.innerHTML = teks && teks.items && teks.items.length
        ? '✅ <strong>' + esc(teks.course || 'TEKS') + '</strong> — ' + teks.items.length + ' student expectations loaded (saved on this device)'
        : 'No TEKS loaded. Upload the TEA PDF (or a .txt) for your course so questions can be tagged.';
    }
    if (list) list.innerHTML = teks && teks.items ? teks.items.map(t => '<option value="' + esc(t.code) + '">' + esc(t.text.slice(0, 80)) + '</option>').join('') : '';
    const clearBtn = document.getElementById('teksClearBtn');
    if (clearBtn) clearBtn.style.display = teks ? '' : 'none';
    const tagBtn = document.getElementById('tagTeksBtn');
    if (tagBtn) tagBtn.disabled = !(teks && teks.items && teks.items.length);
  }

  // ─── AI helper ─────────────────────────────────────────────────────────────
  function apiKey() { return (document.getElementById('apiKey') || {}).value?.trim() || ''; }

  async function askAI(system, user, maxTokens) {
    const resp = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey(),
        'anthropic-version': '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true'
      },
      body: JSON.stringify({ model: window.activeModel || 'claude-sonnet-5', max_tokens: maxTokens || 16000, system, messages: [{ role: 'user', content: user }] })
    });
    if (!resp.ok) {
      const err = await resp.json().catch(() => ({}));
      throw new Error(err.error?.message || 'API error ' + resp.status);
    }
    const data = await resp.json();
    const raw = data.content.filter(b => b.type === 'text').map(b => b.text).join('');
    const clean = raw.replace(/```json|```/g, '').trim();
    const start = clean.indexOf('{'), end = clean.lastIndexOf('}');
    return JSON.parse(clean.slice(start, end + 1));
  }

  // ─── TEKS file → structured list ───────────────────────────────────────────
  async function readTeksFile(file) {
    if (/\.pdf$/i.test(file.name)) {
      pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
      const pdf = await pdfjsLib.getDocument({ data: await file.arrayBuffer() }).promise;
      let text = '';
      for (let p = 1; p <= pdf.numPages; p++) {
        const page = await pdf.getPage(p);
        const tc = await page.getTextContent();
        text += tc.items.map(i => i.str).join(' ') + '\n';
      }
      return text;
    }
    return await file.text();
  }

  async function loadTeksFromFile(file) {
    if (!apiKey()) { setStatus('⚠ AI is locked. Click the ⚙ settings gear and enter your password first.', 'error'); return; }
    setStatus('<span class="spinner"></span> Reading TEKS document…', 'loading');
    let text;
    try { text = await readTeksFile(file); }
    catch (e) { setStatus('⚠ Could not read TEKS file: ' + e.message, 'error'); return; }
    if (!text.trim()) { setStatus('⚠ No text found in that file. If the PDF is a scan, export it as text first.', 'error'); return; }

    setStatus('<span class="spinner"></span> Structuring the TEKS list with AI…', 'loading');
    const SYS = `You convert Texas TEKS documents into a structured list of student expectations (SEs).
Return ONLY valid JSON — no markdown fences, no explanation:
{ "course": "Course name as written in the document", "items": [ { "code": "C.6A", "strand": "6", "letter": "A", "text": "the SE text" } ] }
Rules:
- One item per lettered student expectation, e.g. (6)(A), (6)(B). Skip introduction paragraphs and knowledge-and-skills headers that have no letter.
- "code" = course prefix + strand + letter with no space, e.g. "C.6A" for Chemistry (6)(A), "B.7C" for Biology, "IPC.5B", "Phy.2A". Use the conventional TEA/STAAR abbreviation for the course.
- "text" = the full SE wording, cleaned of line-break artifacts, without the "The student is expected to" lead-in.
- Preserve the order of the document. Include every lettered SE.`;
    try {
      const data = await askAI(SYS, 'TEKS document text:\n\n' + text.slice(0, 120000), 20000);
      if (!data.items || !data.items.length) throw new Error('No student expectations were found.');
      data.items = data.items.map(t => ({ code: String(t.code || '').trim(), strand: String(t.strand || '').trim(), letter: String(t.letter || '').trim().toUpperCase(), text: String(t.text || '').trim() })).filter(t => t.code);
      data.loadedAt = new Date().toISOString();
      data.fileName = file.name;
      saveTeks(data);
      setStatus('✅ Loaded ' + data.items.length + ' TEKS for ' + (data.course || 'your course') + '. New extractions will be tagged automatically.', 'done');
    } catch (e) {
      setStatus('⚠ TEKS processing failed: ' + e.message, 'error');
    }
  }

  // ─── Prompt addendum used by doExtract() ───────────────────────────────────
  function promptAddendum() {
    if (!teks || !teks.items || !teks.items.length) return '';
    return '\n\nTEKS TAGGING: For every question set "tek" to the single best-matching student expectation code from this list. Use ONLY codes from the list, exactly as written. If nothing fits, set "tek": "".\n' +
      teks.items.map(t => t.code + ' — ' + t.text).join('\n');
  }

  // ─── Tag existing questions with AI ────────────────────────────────────────
  async function tagQuestionsWithAI() {
    if (!questions.length) { showAppAlert('Nothing to tag', 'Extract or add questions first.'); return; }
    if (!teks || !teks.items || !teks.items.length) { showAppAlert('No TEKS loaded', 'Upload your course TEKS in Step 2 first.'); return; }
    if (!apiKey()) { showAppAlert('AI is locked', 'Click the ⚙ settings gear and enter your password to unlock AI.'); return; }

    setStatus('<span class="spinner"></span> Tagging ' + questions.length + ' question(s) with TEKS…', 'loading');
    const SYS = 'You tag chemistry/science quiz questions with the single best-matching Texas TEKS student expectation. Return ONLY valid JSON: { "tags": [ { "id": 1, "tek": "C.6A" } ] }. Use ONLY codes from the provided list, exactly as written. If nothing fits, use "".';
    const list = 'TEKS LIST:\n' + teks.items.map(t => t.code + ' — ' + t.text).join('\n');
    const qs = 'QUESTIONS:\n' + questions.map(q => 'id ' + q.id + ' [' + q.type + ']: ' + q.body + (q.answers && q.answers.length ? '\n   choices: ' + q.answers.filter(Boolean).join(' | ') : '')).join('\n\n');
    try {
      const data = await askAI(SYS, list + '\n\n' + qs, 8000);
      const valid = new Set(teks.items.map(t => t.code));
      let n = 0;
      (data.tags || []).forEach(t => {
        const q = getQ(Number(t.id));
        if (q && valid.has(String(t.tek))) { q.tek = String(t.tek); n++; }
      });
      renderAllQuestions();
      saveSession();
      setStatus('✅ Tagged ' + n + ' of ' + questions.length + ' question(s). Open any card to change a TEK.', 'done');
    } catch (e) {
      setStatus('⚠ Tagging failed: ' + e.message, 'error');
    }
  }

  // ─── Numeric helpers ───────────────────────────────────────────────────────
  function parseNumRule(rule) {
    const s = String(rule || '').trim();
    let m = s.match(/^\[\s*([^,\]]+)\s*,\s*([^\]]+)\s*\]$/);
    if (m) return { min: m[1].trim(), max: m[2].trim() };
    m = s.match(/^(.+?)\s*\+-\s*(.+?)(%?)$/);
    if (m) {
      const v = parseFloat(m[1]), d = parseFloat(m[2]);
      if (!isNaN(v) && !isNaN(d)) {
        const margin = m[3] ? Math.abs(v) * d / 100 : d;
        return { value: m[1].trim(), min: String(v - margin), max: String(v + margin) };
      }
    }
    if (s && !isNaN(parseFloat(s))) return { value: s, min: s, max: s };
    return { value: '', min: '', max: '' };
  }

  const SUPS = '⁰¹²³⁴⁵⁶⁷⁸⁹⁻⁺', NORMS = '0123456789-+';
  function numericValue(q) {
    // "6.022 × 10²³ mol⁻¹ (4 sig figs)" → "6.022E23"
    const s = String(q.suggested_answer || '').replace(/[×x]\s*10([⁰¹²³⁴⁵⁶⁷⁸⁹⁻⁺]+)/, (_, sup) => 'E' + sup.split('').map(c => NORMS[SUPS.indexOf(c)] || '').join(''));
    const m = s.match(/-?\d+(?:\.\d+)?(?:E-?\d+)?/i);
    const parsed = parseNumRule(q.answers && q.answers[0]);
    return { value: (m && m[0]) || parsed.value || '', min: parsed.min, max: parsed.max };
  }

  // ─── CSV export ────────────────────────────────────────────────────────────
  function questionToRow(q, num, title) {
    const notes = [];
    if (!q.tek) notes.push('no TEK');
    if (q.image_ref) notes.push('has an image — add it in Edugence');
    const base = { test_title: title, q_num: num, type: '', tek: q.tek || '', question: q.body || '', choice_a: '', choice_b: '', choice_c: '', choice_d: '', choice_e: '', correct: '', num_value: '', num_min: '', num_max: '', notes: '' };

    if (q.type === 'MC' || q.type === 'TF') {
      const entries = (q.answers || []).map((a, i) => ({ text: String(a || '').trim(), i })).filter(e => e.text);
      if (entries.length < 2) return { skip: 'fewer than 2 answer choices' };
      if (entries.length > 5) notes.push('only the first 5 choices exported');
      const keys = ['choice_a', 'choice_b', 'choice_c', 'choice_d', 'choice_e'];
      entries.slice(0, 5).forEach((e, k) => { base[keys[k]] = e.text; });
      const pos = entries.findIndex(e => e.i === (q.correct || [])[0]);
      if (pos < 0 || pos > 4) return { skip: 'no correct answer marked' };
      base.type = 'MC';
      base.correct = 'ABCDE'[pos];
    } else if (q.type === 'NUM') {
      const n = numericValue(q);
      base.type = 'NUM';
      base.num_value = n.value; base.num_min = n.min; base.num_max = n.max;
      if (!n.value && !n.min) return { skip: 'no numeric answer' };
    } else {
      return { skip: q.type + ' is not supported in Edugence export' };
    }
    base.notes = notes.join('; ');
    return { row: CSV_HEADER.map(h => base[h]) };
  }

  function exportCSV() {
    if (!questions.length) { showAppAlert('Nothing to export', 'No questions to export. Extract or add questions first.'); return; }
    const problems = validateForExport(false);
    if (problems.length) {
      showAppAlert('Fix these before exporting to Edugence', '<ul style="margin:0;padding-left:20px">' + problems.map(p => '<li style="margin-bottom:6px">' + p + '</li>').join('') + '</ul>');
      return;
    }
    const title = document.getElementById('quizTitle').value.trim() || 'Quiz';
    const lines = [CSV_HEADER.map(csvCell).join(',')];
    const skipped = [];
    let num = 1;
    questions.forEach((q, i) => {
      const r = questionToRow(q, num, title);
      if (r.skip) { skipped.push('Q' + (i + 1) + ': ' + r.skip); return; }
      lines.push(r.row.map(csvCell).join(','));
      num++;
    });
    if (lines.length === 1) { showAppAlert('Nothing exported', 'No MC, TF, or NUM questions with answers were found.<br><br>' + skipped.join('<br>')); return; }

    const blob = new Blob(['\uFEFF' + lines.join('\n')], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = title.replace(/[^a-z0-9]/gi, '_').toLowerCase() + '_edugence.csv';
    document.body.appendChild(a); a.click(); URL.revokeObjectURL(url); a.remove();

    const untagged = questions.filter(q => !q.tek).length;
    let msg = '✅ Edugence CSV downloaded — ' + (num - 1) + ' question(s).';
    if (untagged) msg += ' ' + untagged + ' without a TEK (the builder will skip the SE step for those).';
    if (skipped.length) msg += ' Skipped: ' + skipped.join('; ') + '.';
    setStatus(msg, skipped.length || untagged ? 'error' : 'done');
    document.getElementById('statusMsg').classList.add('show');
  }

  // ─── Wire up ───────────────────────────────────────────────────────────────
  function init() {
    const fileInput = document.getElementById('teksFileInput');
    if (fileInput) fileInput.addEventListener('change', e => { const f = e.target.files[0]; if (f) loadTeksFromFile(f); e.target.value = ''; });
    const clearBtn = document.getElementById('teksClearBtn');
    if (clearBtn) clearBtn.addEventListener('click', () => { saveTeks(null); setStatus('TEKS list cleared.', 'done'); });
    const tagBtn = document.getElementById('tagTeksBtn');
    if (tagBtn) tagBtn.addEventListener('click', tagQuestionsWithAI);
    const exportBtn = document.getElementById('edugenceBtn');
    if (exportBtn) exportBtn.addEventListener('click', exportCSV);
    renderTeksStatus();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();

  return { promptAddendum, tagQuestionsWithAI, exportCSV, getTeks: () => teks };
})();
