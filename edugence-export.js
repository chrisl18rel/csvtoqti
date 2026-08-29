// edugence-export.js
// Batch Genie — Edugence support: load a course TEKS PDF once (cached in the browser),
// tag questions with the best-matching SE via AI, and export the CSV that
// edugence-builder.js consumes. Relies on globals from index.html:
// questions, getQ, esc, csvCell, setStatus, showAppAlert, renderAllQuestions,
// saveSession, validateForExport, pdfjsLib, window.activeModel, #apiKey.

window.EdugenceExport = (() => {
  const TEKS_KEY = 'bg_edugence_teks_v1';
  // image_q / image_a…image_e name a file inside the exported zip's images/
  // folder. They stay blank on a question with no picture, and a CSV exported
  // without images is still valid — the extension treats the columns as optional.
  const CSV_HEADER = ['test_title', 'q_num', 'type', 'tek', 'question', 'choice_a', 'choice_b', 'choice_c', 'choice_d', 'choice_e', 'correct', 'num_value', 'num_min', 'num_max', 'image_q', 'image_a', 'image_b', 'image_c', 'image_d', 'image_e', 'notes'];

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
  const EDUGENCE_RULES = `

EDUGENCE MODE — THESE RULES OVERRIDE EVERY QUESTION-TYPE RULE ABOVE, INCLUDING THE FIB, SA, AND MR RULES:
- The ONLY allowed types are "MC" and "NUM". Never output MR, TF, SA, FIB, ESSAY, or FILE.
- MC = exactly 4 answer choices. Choices must be distinct and plausible. Exactly 1 correct in almost every case: mark two or more choices correct ONLY when the source question genuinely asks the student to pick every option that applies. Never turn a single-answer question into a multi-answer one.
- NUM = one numerical answer (sig-fig rules still apply; fill answers, suggested_answer, and blooket_distractors as before) AND set "edugence_answer" to the single value a student bubbles on a scantron: digits with an optional decimal point and minus sign only — no units, no commas, no fractions, no ranges, no scientific notation (e.g. "32", "0.045", "-273.15"). If the correct answer would need scientific notation or is otherwise not griddable, REWRITE the question so the answer is griddable (ask for the value "in units of 10²³", change the units, ask for the exponent or the coefficient, or make it a 4-choice MC).
- MULTI-PART QUESTIONS (two or more answers, e.g. "find the pH and the pOH", "give the protons, electrons, neutrons, and mass number"): SPLIT them into separate questions, one per required answer. Each new question must repeat the shared context in its own body so it stands alone, e.g. "An ion has 8 protons and 8 neutrons and a charge of −2. How many electrons does it have?" → NUM. Never use [blank] markers.
- TRUE/FALSE: rewrite as a 4-choice MC (e.g. turn the statement into a question with 4 options, or offer 4 statements of which exactly one is true).
- SELECT-ALL-THAT-APPLY: keep it as ONE MC question and list every correct choice in "correct". Do NOT split it into several questions and do NOT reduce it to a single correct answer. Make sure the stem tells the student to select all that apply.
- SHORT ANSWER / SINGLE FILL-IN-THE-BLANK: NUM if the answer is a number; otherwise MC with the correct answer plus 3 plausible distractors.
- ESSAY / OPEN RESPONSE: convert into one or more MC questions that test the key ideas.
- IMAGES: Edugence DOES accept images — the builder carries them across. Set "image_ref" to the key of the figure a question depends on, exactly as you would normally. Do NOT rewrite a figure into words and do NOT drop the reference. Still write the stem so the wording makes sense next to the picture rather than repeating it.
- Keep question order; split questions stay together where the original was.`;

  function edugenceModeOn() {
    const box = document.getElementById('edugenceMode');
    return !!(box && box.checked);
  }

  function promptAddendum() {
    let out = edugenceModeOn() ? EDUGENCE_RULES : '';
    if (teks && teks.items && teks.items.length) {
      out += '\n\nTEKS TAGGING: For every question set "tek" to the single best-matching student expectation code from this list. Use ONLY codes from the list, exactly as written. If nothing fits, set "tek": "".\n' +
        teks.items.map(t => t.code + ' — ' + t.text).join('\n');
    }
    return out;
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

  // ─── Convert already-loaded questions to Edugence-ready MC / NUM ───────────
  async function convertForEdugence() {
    if (!questions.length) { showAppAlert('Nothing to convert', 'Extract or add questions first.'); return; }
    if (!apiKey()) { showAppAlert('AI is locked', 'Click the ⚙ settings gear and enter your password to unlock AI.'); return; }
    const already = questions.every(q => q.type === 'MC' || q.type === 'NUM');
    if (already) { setStatus('✅ Every question is already MC or NUM — nothing to convert.', 'done'); return; }

    setStatus('<span class="spinner"></span> Converting ' + questions.length + ' question(s) for Edugence…', 'loading');
    const SYS = `You rewrite quiz questions so they fit Edugence, which accepts ONLY 4-choice multiple choice ("MC", usually one correct answer but more than one is allowed for select-all-that-apply items) and single-value numeric ("NUM") questions.
Return ONLY valid JSON — no markdown fences, no explanation:
{ "questions": [ { "source_id": 12, "type": "MC|NUM", "body": "", "answers": ["A","B","C","D"], "correct": [0], "suggested_answer": "", "blooket_distractors": [], "edugence_answer": "", "tek": "" } ] }
- MC: "answers" = exactly 4 distinct choices, "correct" = array of 0-based indices of the correct choices — one index for a normal question, two or more ONLY for a genuine select-all-that-apply item, "suggested_answer" = text of the correct choice (or all of them, joined with "; ", when several are correct), "blooket_distractors" = [].
- NUM: "answers" = ["[min, max]"] tight range around the sig-fig-correct value (E-notation for scientific notation), "correct" = [], "suggested_answer" = the value with units and a sig-fig note, "blooket_distractors" = 3 plausible wrong values, "edugence_answer" = the single griddable value (see the NUM rule below). For MC set "edugence_answer": "".
- "source_id" = the id of the question it came from. Keep the original order; a split question produces consecutive entries with the same source_id.
- Keep "tek" from the source unless you are given a TEKS list, in which case set the best-matching code from that list (exactly as written) or "" if none fits.
- Questions that are already MC with 4 choices or NUM with no image: return them unchanged apart from any needed cleanup.
- Use proper Unicode subscripts/superscripts for formulas (H₂O, SO₄²⁻, 6.02 × 10²³).` + EDUGENCE_RULES.replace('THESE RULES OVERRIDE EVERY QUESTION-TYPE RULE ABOVE, INCLUDING THE FIB, SA, AND MR RULES:', 'RULES:');
    const teksList = teks && teks.items && teks.items.length ? '\n\nTEKS LIST:\n' + teks.items.map(t => t.code + ' — ' + t.text).join('\n') : '';
    const payload = questions.map(q => ({
      id: q.id, type: q.type, body: q.body, answers: q.answers || [], correct: q.correct || [],
      fib_blanks: q.type === 'FIB' ? Object.fromEntries(Object.entries(q.fib_blanks || {}).map(([k, v]) => [k, v.correct || ''])) : undefined,
      suggested_answer: q.suggested_answer || '', has_image: !!q.image_ref, tek: q.tek || ''
    }));
    try {
      const data = await askAI(SYS, 'QUESTIONS:\n' + JSON.stringify(payload, null, 1) + teksList, 32000);
      const out = (data.questions || []).filter(q => q && q.body && (q.type === 'MC' || q.type === 'NUM'));
      if (!out.length) throw new Error('The AI returned no usable questions.');
      const validTek = new Set(teks && teks.items ? teks.items.map(t => t.code) : []);
      const byId = Object.fromEntries(questions.map(q => [q.id, q]));
      const pts = Math.round((100 / out.length) * 100) / 100;
      const before = questions.length;
      questions = out.map(q => {
        const src = byId[Number(q.source_id)] || {};
        const tek = validTek.size ? (validTek.has(String(q.tek)) ? String(q.tek) : (src.tek || '')) : (String(q.tek || '') || src.tek || '');
        return sanitizeQuestion({
          id: nextId++, type: q.type, title: (src.title || '').replace(/^NEEDS IMAGE\s*/i, ''), points: pts,
          body: q.body, answers: q.type === 'MC' ? (q.answers || []).slice(0, 4) : [String((q.answers || [''])[0] || '')],
          correct: q.type === 'MC' ? [...new Set((q.correct || []).map(Number).filter(n => Number.isInteger(n) && n >= 0 && n < 4))].sort((a, b) => a - b) : [], fib_blanks: {},
          // The figure a question depends on survives the rewrite, and a split
          // question keeps its parent's. Per-choice pictures cannot: the AI
          // replaces the answer list wholesale, so nothing maps onto the old
          // slots — re-attach those by hand after converting.
          image_ref: src.image_ref || '', answer_image_refs: [],
          suggested_answer: q.suggested_answer || '', blooket_distractors: q.blooket_distractors || [], tek,
          edugence_answer: q.type === 'NUM' ? String(q.edugence_answer || '').trim() : '',
          feedback: { general: '', correct: '', incorrect: '' }
        });
      });
      document.getElementById('defaultPts').value = pts;
      renderAllQuestions(); updateQCount(); saveSession();
      setStatus('✅ Converted for Edugence: ' + before + ' → ' + questions.length + ' question(s), all MC or NUM. Points reset to ' + pts + ' each. Review every question before exporting.', 'done');
    } catch (e) {
      setStatus('⚠ Conversion failed: ' + e.message, 'error');
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

  const GRIDDABLE = /^-?\d+(\.\d+)?$/;
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
    const base = { test_title: title, q_num: num, type: '', tek: q.tek || '', question: q.body || '', choice_a: '', choice_b: '', choice_c: '', choice_d: '', choice_e: '', correct: '', num_value: '', num_min: '', num_max: '', image_q: '', image_a: '', image_b: '', image_c: '', image_d: '', image_e: '', notes: '' };

    if (q.type === 'MC' || q.type === 'TF') {
      const entries = (q.answers || []).map((a, i) => ({ text: String(a || '').trim(), i })).filter(e => e.text);
      if (entries.length < 2) return { skip: 'fewer than 2 answer choices' };
      if (entries.length > 5) notes.push('only the first 5 choices exported');
      const keys = ['choice_a', 'choice_b', 'choice_c', 'choice_d', 'choice_e'];
      entries.slice(0, 5).forEach((e, k) => { base[keys[k]] = e.text; });
      // Map every correct index onto its exported letter: one letter for a normal
      // question, several run together (e.g. "AC") for select-all-that-apply.
      const positions = [...new Set((q.correct || [])
        .map(ci => entries.findIndex(e => e.i === ci))
        .filter(p => p >= 0 && p <= 4))].sort((a, b) => a - b);
      if (!positions.length) return { skip: 'no correct answer marked' };
      base.type = 'MC';
      base.correct = positions.map(p => 'ABCDE'[p]).join('');
      if (positions.length > 1) notes.push('select all that apply — ' + positions.length + ' correct');
    } else if (q.type === 'NUM') {
      base.type = 'NUM';
      const value = String(q.edugence_answer || '').trim() || numericValue(q).value;
      if (!value) return { skip: 'no numeric answer' };
      base.num_value = value;
      if (!GRIDDABLE.test(value)) notes.push('answer "' + value + '" is not griddable — fix the Edugence Answer box');
    } else {
      return { skip: q.type + ' is not supported in Edugence export' };
    }
    base.notes = notes.join('; ');
    // Returned unassembled: image filenames are not known until every exported
    // question has been numbered, so the row is turned into cells later.
    return { base, notes };
  }

  // Exports a .zip holding the CSV plus an images/ folder, or a bare .csv when
  // no question carries a picture — a test with no images should not force the
  // extra unzip step on anyone.
  async function exportCSV() {
    if (!questions.length) { showAppAlert('Nothing to export', 'No questions to export. Extract or add questions first.'); return; }
    const problems = validateForExport(false);
    if (problems.length) {
      showAppAlert('Fix these before exporting to Edugence', '<ul style="margin:0;padding-left:20px">' + problems.map(p => '<li style="margin-bottom:6px">' + p + '</li>').join('') + '</ul>');
      return;
    }
    const title = document.getElementById('quizTitle').value.trim() || 'Quiz';
    const exported = [];
    const skipped = [];
    let num = 1;
    questions.forEach((q, i) => {
      const r = questionToRow(q, num, title);
      if (r.skip) { skipped.push('Q' + (i + 1) + ': ' + r.skip); return; }
      exported.push({ q, num, base: r.base, notes: r.notes });
      num++;
    });
    if (!exported.length) { showAppAlert('Nothing exported', 'No MC, TF, or NUM questions with answers were found.<br><br>' + skipped.join('<br>')); return; }

    // Resize and name every picture, then write its filename into the row that
    // uses it.
    setStatus('Preparing images…', 'info');
    let pack = { files: [], byNum: {}, stats: { count: 0, bytes: 0, resized: 0, broken: [] } };
    try {
      pack = await EdugenceImages.collect(exported.map(e => ({ q: e.q, num: e.num })), window.extractedImages || {});
    } catch (e) {
      showAppAlert('Images could not be prepared', esc(e.message) + '<br><br>Export it again without images, or re-extract the document.');
      return;
    }
    const CHOICE_COLS = ['image_a', 'image_b', 'image_c', 'image_d', 'image_e'];
    exported.forEach(e => {
      const rec = pack.byNum[e.num] || { stem: '', choices: [] };
      e.base.image_q = rec.stem || '';
      CHOICE_COLS.forEach((col, i) => { e.base[col] = rec.choices[i] || ''; });
      if (pack.stats.broken.length && rec.stem === '' && EdugenceImages.getRef(e.q, null)) {
        e.notes.push('image could not be read');
        e.base.notes = e.notes.join('; ');
      }
    });

    const lines = [CSV_HEADER.map(csvCell).join(',')];
    exported.forEach(e => lines.push(CSV_HEADER.map(h => csvCell(e.base[h])).join(',')));
    const csv = '\uFEFF' + lines.join('\n');
    const stem = title.replace(/[^a-z0-9]/gi, '_').toLowerCase() + '_edugence';

    let blob, fname;
    if (pack.files.length) {
      const zip = new JSZip();
      zip.file(stem + '.csv', csv);
      const imgs = zip.folder('images');
      pack.files.forEach(f => imgs.file(f.name, f.data, { base64: true }));
      blob = await zip.generateAsync({ type: 'blob' });
      fname = stem + '.zip';
    } else {
      blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
      fname = stem + '.csv';
    }

    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = fname;
    document.body.appendChild(a); a.click(); URL.revokeObjectURL(url); a.remove();

    const untagged = questions.filter(q => !q.tek).length;
    const notGriddable = questions.map((q, i) => q.type === 'NUM' && !GRIDDABLE.test(String(q.edugence_answer || '').trim() || numericValue(q).value) ? 'Q' + (i + 1) : '').filter(Boolean);
    let msg = '✅ Edugence ' + (pack.files.length ? 'package' : 'CSV') + ' downloaded — ' + exported.length + ' question(s)';
    if (pack.files.length) msg += ' and ' + pack.stats.count + ' image(s), ' + EdugenceImages.humanSize(pack.stats.bytes) + (pack.stats.resized ? ' (' + pack.stats.resized + ' resized down to ' + EdugenceImages.MAX_W + 'px)' : '') + '.';
    else msg += '.';
    if (pack.stats.bytes > EdugenceImages.STORAGE_WARN) msg += ' That is close to the browser extension\u2019s 10MB limit — if a run stops partway, split the test in two.';
    if (untagged) msg += ' ' + untagged + ' without a TEK (the builder will skip the SE step for those).';
    if (pack.stats.broken.length) msg += ' Could not read: ' + pack.stats.broken.join(', ') + '.';
    if (notGriddable.length) msg += ' Not griddable, fix the Edugence Answer box: ' + notGriddable.join(', ') + '.';
    if (skipped.length) msg += ' Skipped: ' + skipped.join('; ') + '.';
    setStatus(msg, skipped.length || untagged || notGriddable.length || pack.stats.broken.length ? 'error' : 'done');
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
    const convertBtn = document.getElementById('convertEdugenceBtn');
    if (convertBtn) convertBtn.addEventListener('click', convertForEdugence);
    const exportBtn = document.getElementById('edugenceBtn');
    if (exportBtn) exportBtn.addEventListener('click', exportCSV);
    renderTeksStatus();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();

  return { promptAddendum, edugenceModeOn, tagQuestionsWithAI, convertForEdugence, exportCSV, getTeks: () => teks };
})();
