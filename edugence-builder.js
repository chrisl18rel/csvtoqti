// edugence-builder.js
// Batch Genie → Edugence test builder. Injected by the edugence-loader bookmarklet.
// Reads a Batch Genie Edugence CSV and builds the assessment in Edugence by
// driving the real form controls (MUI selects, autocompletes, Quill editors).
// State lives in sessionStorage so clicking the bookmark again resumes a run.
(function () {
  'use strict';
  if (window.__bgEdu) { window.__bgEdu.show(); return; }

  const VERSION = '0.1';
  const SETTINGS_KEY = 'bgEdugenceSettings';
  const STATE_KEY = 'bgEdugenceState';
  const DEFAULTS = {
    campus: 'Legacy High School', grade: 'HS', course: 'Chemistry', language: 'English',
    assessmentType: 'Campus Asmt', bank: 'Campus', highAppr: '60', meets: '70', masters: '80',
    duration: '', percentages: true, resumable: true, allow_preview: true, clonable: true,
    show_pause: false, allow_review: false, do_not_allow_resubmit: false, lockdown_browser: false,
    hide_scores: false, do_not_allow_answer: false, do_not_allow_manual_scoring: false, hide_items: false,
    delay: 500, startAt: 1
  };
  const TYPE_LABELS = { MC: 'Multiple Choice', NUM: 'Numeric' };

  // ─── Utilities ─────────────────────────────────────────────────────────────
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const norm = s => String(s || '').replace(/\s+/g, ' ').trim();
  const visible = el => !!el && el.getBoundingClientRect().width > 0 && getComputedStyle(el).visibility !== 'hidden';
  const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

  async function waitFor(fn, timeout, label) {
    const end = Date.now() + (timeout || 8000);
    while (Date.now() < end) {
      try { const v = fn(); if (v) return v; } catch (e) { /* keep polling */ }
      await sleep(150);
    }
    throw new Error('Timed out waiting for ' + (label || 'element'));
  }

  function findByText(selector, text, exact) {
    const t = norm(text).toLowerCase();
    return Array.from(document.querySelectorAll(selector)).filter(visible).find(el => {
      const s = norm(el.textContent).toLowerCase();
      return exact ? s === t : s.includes(t);
    });
  }

  // Finds the element that directly owns a text node equal to the label (ignores a trailing *).
  function labelNode(label) {
    const want = norm(label).replace(/\s*\*$/, '').toLowerCase();
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    let n;
    while ((n = walker.nextNode())) {
      if (norm(n.nodeValue).replace(/\s*\*$/, '').toLowerCase() === want && visible(n.parentElement)) return n.parentElement;
    }
    return null;
  }

  function controlForLabel(label, selector) {
    const ln = labelNode(label);
    if (!ln) return null;
    let el = ln;
    for (let i = 0; i < 4 && el; i++) {
      const hit = Array.from(el.querySelectorAll(selector)).find(visible);
      if (hit) return hit;
      el = el.parentElement;
    }
    return null;
  }

  function setNativeValue(input, value) {
    const proto = input.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(proto, 'value').set;
    input.focus();
    setter.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
  }

  function mouse(el, type) {
    el.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, button: 0 }));
  }

  function press(el, key, code) {
    ['keydown', 'keyup'].forEach(t => el.dispatchEvent(new KeyboardEvent(t, { key, code: code || key, keyCode: code === 'Escape' ? 27 : 13, bubbles: true })));
  }

  // ─── MUI control drivers ───────────────────────────────────────────────────
  async function selectOption(selectRoot, optionText) {
    if (norm(selectRoot.textContent).toLowerCase() === norm(optionText).toLowerCase()) return true;
    mouse(selectRoot, 'mousedown');
    const listbox = await waitFor(() => Array.from(document.querySelectorAll('[role="presentation"] ul[role="listbox"]')).find(visible), 5000, 'dropdown list');
    await sleep(150);
    const opts = Array.from(listbox.querySelectorAll('[role="option"]'));
    const want = norm(optionText).toLowerCase();
    const opt = opts.find(o => norm(o.textContent).toLowerCase() === want) || opts.find(o => norm(o.textContent).toLowerCase().includes(want));
    if (!opt) {
      press(document.activeElement || document.body, 'Escape', 'Escape');
      throw new Error('No option "' + optionText + '" — dropdown shows: ' + opts.map(o => norm(o.textContent)).join(' | '));
    }
    opt.click();
    await waitFor(() => !visible(listbox), 4000, 'dropdown to close');
    return true;
  }

  async function autocompletePick(input, typed, matcher) {
    setNativeValue(input, typed);
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
    const listbox = await waitFor(() => {
      const id = input.getAttribute('aria-owns') || input.getAttribute('aria-controls');
      const byId = id && document.getElementById(id);
      return (byId && visible(byId)) ? byId : Array.from(document.querySelectorAll('.MuiAutocomplete-popper ul[role="listbox"], ul.MuiAutocomplete-listbox')).find(visible);
    }, 6000, 'autocomplete suggestions for "' + typed + '"');
    await sleep(200);
    const opts = Array.from(listbox.querySelectorAll('[role="option"]'));
    const opt = matcher(opts);
    if (!opt) {
      press(input, 'Escape', 'Escape');
      throw new Error('No match for "' + typed + '" — suggestions: ' + opts.slice(0, 6).map(o => norm(o.textContent)).join(' | '));
    }
    opt.click();
    await sleep(250);
    press(input, 'Escape', 'Escape');
    return norm(opt.textContent);
  }

  // TEK codes arrive as C.6A / C.6.A / 6(A) / C.6(A). Compare on strand+letter.
  function tekKey(s) {
    const m = String(s || '').toUpperCase().replace(/[^A-Z0-9]/g, ' ').match(/(\d{1,2})\s*([A-Z])\b/);
    return m ? m[1] + m[2] : '';
  }

  function tekMatcher(code) {
    const key = tekKey(code);
    return opts => {
      if (!key) return null;
      return opts.find(o => tekKey(o.textContent.slice(0, 40)) === key)
        || opts.find(o => norm(o.textContent).toUpperCase().includes(String(code).toUpperCase()));
    };
  }

  function setQuill(containerId, text) {
    const editor = document.querySelector('#' + containerId + ' .ql-editor');
    if (!editor) throw new Error('Editor #' + containerId + ' not found');
    const html = String(text).split(/\r?\n/).map(l => '<p>' + (esc(l) || '<br>') + '</p>').join('');
    editor.focus();
    editor.innerHTML = html;
    editor.classList.remove('ql-blank');
    editor.dispatchEvent(new Event('input', { bubbles: true }));
    editor.dispatchEvent(new Event('blur', { bubbles: true }));
  }

  async function setCheckbox(name, on) {
    const box = document.querySelector('input[type="checkbox"][name="' + name + '"]');
    if (!box) { log('⚠ Checkbox "' + name + '" not found'); return; }
    if (box.checked !== !!on) { box.click(); await sleep(120); }
  }

  async function setLabeledInput(label, value) {
    if (value === '' || value === null || value === undefined) return;
    const input = controlForLabel(label, 'input[type="text"]:not([aria-hidden]):not([disabled])');
    if (!input) { log('⚠ Field "' + label + '" not found'); return; }
    setNativeValue(input, String(value));
    input.dispatchEvent(new Event('blur', { bubbles: true }));
  }

  async function setLabeledSelect(label, value) {
    const root = controlForLabel(label, 'div[role="button"][aria-haspopup="listbox"]');
    if (!root) { log('⚠ Dropdown "' + label + '" not found'); return; }
    await selectOption(root, value);
  }

  function buttonByLabel(text) {
    return findByText('button', text, true) || findByText('button[title="' + text + '"]', '', false);
  }

  // ─── CSV ───────────────────────────────────────────────────────────────────
  function parseCSV(text) {
    const rows = []; let row = [], field = '', q = false;
    text = text.replace(/^\uFEFF/, '');
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (q) {
        if (c === '"') { if (text[i + 1] === '"') { field += '"'; i++; } else q = false; }
        else field += c;
      } else if (c === '"') q = true;
      else if (c === ',') { row.push(field); field = ''; }
      else if (c === '\n' || c === '\r') {
        if (c === '\r' && text[i + 1] === '\n') i++;
        row.push(field); rows.push(row); row = []; field = '';
      } else field += c;
    }
    if (field !== '' || row.length) { row.push(field); rows.push(row); }
    const header = rows.shift().map(h => norm(h).toLowerCase().replace(/\s+/g, '_'));
    return rows.filter(r => r.some(v => norm(v))).map(r => {
      const o = {}; header.forEach((h, i) => { o[h] = r[i] === undefined ? '' : r[i]; }); return o;
    });
  }

  // ─── State ─────────────────────────────────────────────────────────────────
  const settings = Object.assign({}, DEFAULTS, JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}'));
  let state = JSON.parse(sessionStorage.getItem(STATE_KEY) || 'null') || { phase: 'idle', qIndex: 0, rows: [], title: '', log: [] };
  let running = false, manualResolve = null;

  const saveSettings = () => localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  const saveState = () => sessionStorage.setItem(STATE_KEY, JSON.stringify(state));

  function log(msg) {
    const line = new Date().toLocaleTimeString() + '  ' + msg;
    state.log.push(line); if (state.log.length > 300) state.log.shift();
    saveState();
    const box = document.getElementById('bgEduLog');
    if (box) { box.textContent = state.log.join('\n'); box.scrollTop = box.scrollHeight; }
  }

  // ─── Build steps ───────────────────────────────────────────────────────────
  async function step() { await sleep(settings.delay); }

  async function buildAssessment() {
    log('Building assessment "' + state.title + '"');
    const newBtn = buttonByLabel('New Assessment');
    if (newBtn && !labelNode('Total score')) { newBtn.click(); await waitFor(() => labelNode('Total score'), 10000, 'assessment form'); await step(); }
    await waitFor(() => labelNode('Total score'), 10000, 'assessment form');

    const campus = controlForLabel('Campus', 'div[role="button"][aria-haspopup="listbox"]');
    if (campus && !norm(campus.textContent)) { await selectOption(campus, settings.campus); await step(); }
    const grade = controlForLabel('Grade', 'div[role="button"][aria-haspopup="listbox"]');
    if (grade && !norm(grade.textContent)) { await selectOption(grade, settings.grade); await step(); }
    const course = document.getElementById('edg-course-category-select');
    if (course && norm(course.value).toLowerCase() !== settings.course.toLowerCase()) {
      await autocompletePick(course, settings.course, o => o.find(x => norm(x.textContent).toLowerCase() === settings.course.toLowerCase()) || o[0]);
      await step();
    }
    await setLabeledInput('Title', state.title); await step();
    await setLabeledSelect('Language', settings.language); await step();
    await setLabeledSelect('Type', settings.assessmentType); await step();
    await setLabeledInput('High Appr', settings.highAppr);
    await setLabeledInput('Meets', settings.meets);
    await setLabeledInput('Masters', settings.masters);
    await setLabeledInput('Duration (min.)', settings.duration);
    for (const name of ['percentages', 'resumable', 'show_pause', 'allow_review', 'allow_preview', 'clonable', 'do_not_allow_resubmit', 'lockdown_browser', 'hide_scores', 'do_not_allow_answer', 'do_not_allow_manual_scoring', 'hide_items']) {
      await setCheckbox(name, settings[name]);
    }
    await step();
    const save = buttonByLabel('Save');
    if (!save) throw new Error('Save button not found');
    save.click();
    await waitFor(() => buttonByLabel('New Question'), 20000, 'saved assessment (New Question button)');
    log('Assessment saved.');
    state.phase = 'questions'; saveState();
  }

  async function removeExtraChoices(keep) {
    for (let n = 4; n > keep; n--) {
      const btn = document.querySelector('#ansDiv' + n + ' button[aria-label="Delete Choice"]');
      if (!btn) continue;
      const origConfirm = window.confirm; window.confirm = () => true;
      btn.click();
      await sleep(400);
      const yes = findByText('[role="dialog"] button', 'yes', true) || findByText('[role="dialog"] button', 'ok', true) || findByText('[role="dialog"] button', 'delete', true) || findByText('[role="dialog"] button', 'confirm', true);
      if (yes) { yes.click(); await sleep(300); }
      window.confirm = origConfirm;
    }
  }

  async function clickAnswerBubble(letter) {
    const ln = labelNode('Answers');
    let scope = ln ? ln.parentElement : document.body;
    for (let i = 0; i < 3 && scope; i++) {
      const radio = scope.querySelector('input[type="radio"][value="' + letter + '"], input[type="radio"][value="' + letter.toLowerCase() + '"]');
      if (radio) { radio.click(); return true; }
      const el = Array.from(scope.querySelectorAll('button, label, span, div')).filter(visible).find(e => e.children.length === 0 && norm(e.textContent) === letter);
      if (el) { (el.closest('button, label') || el).click(); return true; }
      scope = scope.parentElement;
    }
    return false;
  }

  function manualPause(reason) {
    log('⏸ ' + reason + ' — do it in Edugence, then click Continue.');
    document.getElementById('bgEduContinue').style.display = 'inline-block';
    return new Promise(res => { manualResolve = res; });
  }

  async function buildQuestion(row, num) {
    const type = norm(row.type).toUpperCase() || 'MC';
    log('Q' + num + ' (' + type + ', TEK ' + (row.tek || '—') + ')');
    const newQ = await waitFor(() => buttonByLabel('New Question'), 15000, 'New Question button');
    newQ.click();
    await waitFor(() => document.querySelector('#editor-98 .ql-editor'), 15000, 'question editor');
    await step();

    await setLabeledSelect('Bank', settings.bank); await step();
    try { await setLabeledSelect('Type', TYPE_LABELS[type] || TYPE_LABELS.MC); }
    catch (e) { log('⚠ ' + e.message); await manualPause('Pick the question Type'); }
    await step();

    if (row.tek) {
      const seInput = Array.from(document.querySelectorAll('input#tags-filled, input[placeholder="Add SEs to the List"]')).find(visible);
      if (seInput) {
        try { log('   SE → ' + await autocompletePick(seInput, tekKey(row.tek).replace(/(\d+)([A-Z])/, '$1'), tekMatcher(row.tek))); }
        catch (e) { log('⚠ ' + e.message); await manualPause('Select the SE for TEK ' + row.tek); }
      } else log('⚠ Selected SEs box not found');
      await step();
    }

    setQuill('editor-98', row.question); await step();

    if (type === 'MC') {
      const choices = ['choice_a', 'choice_b', 'choice_c', 'choice_d', 'choice_e'].map(k => row[k]).filter(v => norm(v));
      if (choices.length < 4) await removeExtraChoices(choices.length);
      for (let i = 4; i < choices.length; i++) {
        const add = findByText('button', 'Add Choice', true);
        if (add) { add.click(); await waitFor(() => document.querySelector('#editor-' + (i + 1) + ' .ql-editor'), 5000, 'choice ' + (i + 1)); }
      }
      for (let i = 0; i < choices.length; i++) { setQuill('editor-' + (i + 1), choices[i]); await sleep(150); }
      await step();
      const letter = norm(row.correct).toUpperCase().charAt(0);
      if (!letter) log('⚠ No correct answer in CSV');
      else if (!(await clickAnswerBubble(letter))) await manualPause('Mark answer ' + letter + ' as correct (bubble not found)');
    } else if (type === 'NUM') {
      await manualPause('Enter numeric answer: ' + (row.num_value || '') + (row.num_min ? '  (range ' + row.num_min + ' – ' + row.num_max + ')' : ''));
    } else {
      await manualPause('Type ' + type + ' is not automated — finish this question by hand');
    }
    if (norm(row.notes)) log('   note: ' + row.notes);
    await step();

    const saveBack = findByText('button', 'Save & Go back', true) || findByText('button', 'Save &amp; Go back', true);
    if (!saveBack) throw new Error('"Save & Go back" button not found');
    saveBack.click();
    await waitFor(() => buttonByLabel('New Question') && !document.querySelector('#editor-98'), 20000, 'return to assessment');
    await step();
  }

  async function run() {
    if (running) return; running = true; setButtons();
    try {
      if (state.phase === 'idle' || state.phase === 'assessment') { state.phase = 'assessment'; saveState(); await buildAssessment(); }
      while (state.phase === 'questions' && state.qIndex < state.rows.length) {
        if (!running) break;
        await buildQuestion(state.rows[state.qIndex], state.qIndex + 1);
        state.qIndex++; saveState(); updateProgress();
      }
      if (state.phase === 'questions' && state.qIndex >= state.rows.length) {
        state.phase = 'done'; saveState();
        log('✅ Done — ' + state.rows.length + ' question(s) built. Review the test, then save.');
      }
    } catch (e) {
      log('✖ ' + e.message + ' (fix the page, then click Resume)');
    }
    running = false; setButtons();
  }

  // ─── Panel ─────────────────────────────────────────────────────────────────
  function panelHTML() {
    const chk = (k, label) => '<label><input type="checkbox" data-s="' + k + '" ' + (settings[k] ? 'checked' : '') + '> ' + label + '</label>';
    const txt = (k, label, w) => '<label>' + label + '<input type="text" data-s="' + k + '" value="' + esc(settings[k]) + '" style="width:' + (w || 90) + 'px"></label>';
    return '<div class="bge-h"><strong>Batch Genie → Edugence</strong> <span style="opacity:.6;font-size:11px">v' + VERSION + '</span><span style="flex:1"></span>' +
      '<button data-a="settings">⚙</button><button data-a="hide">—</button></div>' +
      '<div class="bge-b">' +
      '<div class="bge-row"><input type="file" id="bgEduFile" accept=".csv,text/csv"> <span id="bgEduProgress"></span></div>' +
      '<div id="bgEduSettings" style="display:none" class="bge-set">' +
      txt('campus', 'Campus', 150) + txt('grade', 'Grade', 40) + txt('course', 'Course', 110) + txt('language', 'Language', 70) + txt('assessmentType', 'Type', 100) + txt('bank', 'Bank', 80) +
      txt('highAppr', 'High Appr', 40) + txt('meets', 'Meets', 40) + txt('masters', 'Masters', 40) + txt('duration', 'Duration', 40) + txt('delay', 'Delay ms', 50) + txt('startAt', 'Start at Q#', 40) +
      '<div class="bge-chk">' + chk('percentages', 'Percent scores') + chk('resumable', 'Resumable') + chk('show_pause', 'Show submit later') + chk('allow_review', 'Allow review') + chk('allow_preview', 'Allow previews') + chk('clonable', 'Allow cloning') + chk('do_not_allow_resubmit', 'No resubmit') + chk('lockdown_browser', 'Lockdown browser') + chk('hide_scores', 'Hide scores') + chk('do_not_allow_answer', 'No staff answering') + chk('do_not_allow_manual_scoring', 'No manual scoring') + chk('hide_items', 'Hide items in reports') + '</div></div>' +
      '<div class="bge-row"><button data-a="start" class="bge-go">▶ Start</button><button data-a="resume" class="bge-go">▶ Resume</button><button data-a="pause">⏸ Pause</button><button id="bgEduContinue" data-a="continue" class="bge-go" style="display:none">✔ Continue</button><button data-a="reset">Reset</button></div>' +
      '<pre id="bgEduLog"></pre></div>';
  }

  function updateProgress() {
    const p = document.getElementById('bgEduProgress');
    if (p) p.textContent = state.rows.length ? (state.title + ' — ' + state.qIndex + '/' + state.rows.length + ' done' + (state.phase === 'done' ? ' ✅' : '')) : 'No CSV loaded';
  }

  function setButtons() {
    const p = document.getElementById('bgEduPanel'); if (!p) return;
    const has = state.rows.length > 0;
    p.querySelector('[data-a="start"]').style.display = (has && state.phase === 'idle' && !running) ? '' : 'none';
    p.querySelector('[data-a="resume"]').style.display = (has && state.phase !== 'idle' && state.phase !== 'done' && !running) ? '' : 'none';
    p.querySelector('[data-a="pause"]').style.display = running ? '' : 'none';
  }

  function mountPanel() {
    const style = document.createElement('style');
    style.textContent = '#bgEduPanel{position:fixed;top:10px;right:10px;width:460px;z-index:2147483647;background:#1e1e2e;color:#e8e8f2;border-radius:12px;box-shadow:0 12px 40px rgba(0,0,0,.45);font:12px/1.4 system-ui,sans-serif;overflow:hidden}' +
      '#bgEduPanel .bge-h{display:flex;gap:6px;align-items:center;padding:8px 10px;background:#2a2a40}#bgEduPanel .bge-b{padding:8px 10px}' +
      '#bgEduPanel button{background:#444;color:#fff;border:0;border-radius:6px;padding:5px 10px;cursor:pointer;font-size:12px}#bgEduPanel button.bge-go{background:#3ccf91;color:#111;font-weight:600}' +
      '#bgEduPanel .bge-row{display:flex;gap:6px;align-items:center;flex-wrap:wrap;margin-bottom:6px}#bgEduPanel .bge-set{display:flex;flex-wrap:wrap;gap:6px 10px;margin-bottom:8px;padding:8px;background:#14141f;border-radius:8px}' +
      '#bgEduPanel .bge-set label{display:flex;flex-direction:column;font-size:10px;opacity:.9}#bgEduPanel .bge-set input[type=text]{background:#2a2a40;color:#fff;border:1px solid #444;border-radius:4px;padding:3px 5px;font-size:11px}' +
      '#bgEduPanel .bge-chk{display:flex;flex-wrap:wrap;gap:4px 12px;width:100%}#bgEduPanel .bge-chk label{flex-direction:row;gap:4px;align-items:center;font-size:11px}' +
      '#bgEduPanel pre{margin:0;height:170px;overflow:auto;background:#101018;border-radius:8px;padding:8px;font:11px/1.35 ui-monospace,monospace;white-space:pre-wrap}#bgEduPanel input[type=file]{color:#ccc;font-size:11px}';
    document.head.appendChild(style);
    const p = document.createElement('div'); p.id = 'bgEduPanel'; p.innerHTML = panelHTML(); document.body.appendChild(p);

    p.querySelectorAll('[data-s]').forEach(inp => inp.addEventListener('change', () => {
      settings[inp.dataset.s] = inp.type === 'checkbox' ? inp.checked : (['delay', 'startAt'].includes(inp.dataset.s) ? parseInt(inp.value, 10) || DEFAULTS[inp.dataset.s] : inp.value);
      saveSettings();
    }));
    p.querySelector('[data-a="settings"]').onclick = () => { const s = document.getElementById('bgEduSettings'); s.style.display = s.style.display === 'none' ? 'flex' : 'none'; };
    p.querySelector('[data-a="hide"]').onclick = () => { p.style.display = 'none'; };
    p.querySelector('[data-a="start"]').onclick = () => { state.phase = 'idle'; state.qIndex = Math.max(0, (settings.startAt || 1) - 1); saveState(); run(); };
    p.querySelector('[data-a="resume"]').onclick = () => run();
    p.querySelector('[data-a="pause"]').onclick = () => { running = false; log('Pausing after the current step.'); };
    p.querySelector('[data-a="continue"]').onclick = () => { document.getElementById('bgEduContinue').style.display = 'none'; if (manualResolve) { const r = manualResolve; manualResolve = null; r(); } };
    p.querySelector('[data-a="reset"]').onclick = () => { running = false; state = { phase: 'idle', qIndex: 0, rows: [], title: '', log: [] }; saveState(); document.getElementById('bgEduLog').textContent = ''; updateProgress(); setButtons(); };
    document.getElementById('bgEduFile').addEventListener('change', e => {
      const f = e.target.files[0]; if (!f) return;
      const r = new FileReader();
      r.onload = () => {
        try {
          const rows = parseCSV(r.result);
          if (!rows.length || !('question' in rows[0])) throw new Error('This does not look like a Batch Genie Edugence CSV (no "question" column).');
          state = { phase: 'idle', qIndex: 0, rows, title: norm(rows[0].test_title) || f.name.replace(/\.csv$/i, ''), log: [] };
          saveState(); updateProgress(); setButtons();
          log('Loaded ' + rows.length + ' question(s) for "' + state.title + '". Check ⚙ settings, then Start on the Assessments page.');
        } catch (err) { log('✖ ' + err.message); }
      };
      r.readAsText(f);
    });
    document.getElementById('bgEduLog').textContent = state.log.join('\n');
    updateProgress(); setButtons();
    if (state.rows.length && state.phase !== 'idle' && state.phase !== 'done') log('Resumable run found — click Resume to continue at Q' + (state.qIndex + 1) + '.');
  }

  mountPanel();
  window.__bgEdu = { show: () => { document.getElementById('bgEduPanel').style.display = ''; }, state: () => state };
})();
