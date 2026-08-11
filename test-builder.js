// test-builder.js
// Batch Genie — Paper Test Builder: user interface
//
// Renders the whole Paper Test tab into #tbRoot. Modelled on ExamView:
//   1. Question Banks   — load bank files, pick which banks to pull from
//   2. Select Questions — browse, check the ones you want (or pick randomly)
//   3. Test Sections    — split the test into parts, each drawing N questions
//   4. Versions         — how many, what they're called, what gets scrambled
//   5. Generate         — download Word/print/answer keys
//
// Depends on: test-banks.js, test-compose.js, test-export.js, esc() from index.html.

(function (global) {
  'use strict';

  var TB = global.TestBuilder = global.TestBuilder || {};

  // ── State ───────────────────────────────────────────────────────────────────
  var selected = {};          // uid -> true (questions chosen from the banks)
  var activeBanks = {};       // bankId -> true (which banks the browser shows)
  var sections = [];          // [{ id, name, count, types:[], bankIds:[], required:[uid] }]
  var sectionSeq = 1;
  var filterType = 'ALL';
  var filterText = '';
  var lastVersions = null;
  var expanded = {};          // uid -> true (question preview open)

  var TYPE_LABELS = {
    MC: 'Multiple Choice', MR: 'Multiple Response', TF: 'True/False',
    NUM: 'Numerical', SA: 'Short Answer', FIB: 'Fill in Blanks', ESSAY: 'Essay'
  };

  function el(id) { return document.getElementById(id); }
  function selectedUids() { return Object.keys(selected).filter(function (u) { return selected[u]; }); }

  // Questions visible in the browser right now
  function visibleQuestions() {
    var out = TB.allQuestions().filter(function (q) {
      if (Object.keys(activeBanks).length && !activeBanks[q.bankId]) return false;
      if (filterType !== 'ALL' && q.type !== filterType) return false;
      if (filterText) {
        var hay = (q.body + ' ' + (q.answers || []).join(' ')).toLowerCase();
        if (hay.indexOf(filterText.toLowerCase()) === -1) return false;
      }
      return true;
    });
    return out;
  }

  // ── Status helper (styled, never a browser alert) ────────────────────────────
  function tbStatus(msg, type) {
    var s = el('tbStatus');
    if (!s) return;
    s.className = 'notice notice-' + (type || 'info');
    s.style.display = 'block';
    s.innerHTML = msg;
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Markup
  // ─────────────────────────────────────────────────────────────────────────────
  TB.render = function () {
    var root = el('tbRoot');
    if (!root) return;

    root.innerHTML = [
      // 1 — BANKS
      '<div class="card">',
      '  <h2><span class="step-dot" style="background:#0891b2">1</span>Question Banks</h2>',
      '  <p style="font-size:13px;color:#555;margin:0 0 12px">Load Canvas question-bank exports (.zip) or saved Batch Genie sessions. Select several files at once to load a whole folder of banks.</p>',
      '  <div class="btnrow">',
      '    <label class="btn btn-indigo" style="cursor:pointer;margin:0">',
      '      📂 Load Bank File(s)',
      '      <input type="file" id="tbBankInput" accept=".zip" multiple style="display:none">',
      '    </label>',
      '    <button class="btn btn-gray btn-sm" id="tbClearBanks">Clear All Banks</button>',
      '  </div>',
      '  <div id="tbBankList" style="margin-top:14px"></div>',
      '  <div id="tbBankStatus" class="status-msg" style="margin-top:10px"></div>',
      '</div>',

      // 2 — SELECT QUESTIONS
      '<div class="card" id="tbSelectCard">',
      '  <h2><span class="step-dot" style="background:#6465F1">2</span>Select Questions</h2>',
      '  <div class="questions-toolbar">',
      '    <select id="tbFilterType" style="width:auto;margin-bottom:0;padding:7px 12px;font-size:13px">',
      '      <option value="ALL">All types</option>',
      '      <option value="MC">Multiple Choice</option>',
      '      <option value="MR">Multiple Response</option>',
      '      <option value="TF">True/False</option>',
      '      <option value="NUM">Numerical</option>',
      '      <option value="SA">Short Answer</option>',
      '      <option value="FIB">Fill in Blanks</option>',
      '      <option value="ESSAY">Essay</option>',
      '    </select>',
      '    <input type="text" id="tbSearch" placeholder="Search question text…" style="width:auto;flex:1;min-width:160px;margin-bottom:0;padding:7px 12px;font-size:13px">',
      '    <button class="btn btn-navy btn-sm" id="tbSelectAll">Select All Shown</button>',
      '    <button class="btn btn-gray btn-sm" id="tbSelectNone">Clear Selection</button>',
      '    <button class="btn btn-violet btn-sm" id="tbSelectRandom">🎲 Pick Random…</button>',
      '    <span class="q-count-badge" id="tbSelCount">0 selected</span>',
      '  </div>',
      '  <div id="tbQuestionList" style="max-height:520px;overflow-y:auto;border:1.5px solid #e8e8f5;border-radius:12px;padding:8px;background:#fafafe"></div>',
      '</div>',

      // 3 — SECTIONS
      '<div class="card">',
      '  <h2><span class="step-dot" style="background:#d97706">3</span>Test Sections</h2>',
      '  <p style="font-size:13px;color:#555;margin:0 0 12px">Each section holds a block of question numbers and draws that many questions at random from the ones you selected. Mark any question <strong>Required</strong> to force it onto every version.</p>',
      '  <div id="tbSectionList"></div>',
      '  <div class="btnrow" style="margin-top:10px">',
      '    <button class="btn btn-violet btn-sm" id="tbAddSection">+ Add Section</button>',
      '    <span id="tbSectionSummary" style="font-size:13px;color:#555;align-self:center"></span>',
      '  </div>',
      '</div>',

      // 4 — VERSIONS
      '<div class="card">',
      '  <h2><span class="step-dot" style="background:#8F37EB">4</span>Versions &amp; Scrambling</h2>',
      '  <div class="row2">',
      '    <div>',
      '      <label for="tbTitle">Test Title</label>',
      '      <input type="text" id="tbTitle" placeholder="Unit 3 Exam — Stoichiometry">',
      '    </div>',
      '    <div>',
      '      <label for="tbSubtitle">Subtitle <span style="font-weight:400;color:#888">(optional)</span></label>',
      '      <input type="text" id="tbSubtitle" placeholder="Chemistry — Mr. Leatherwood">',
      '    </div>',
      '  </div>',
      '  <label for="tbInstructions">Instructions to students <span style="font-weight:400;color:#888">(optional)</span></label>',
      '  <textarea id="tbInstructions" style="min-height:52px" placeholder="Show all work. Report answers to the correct number of significant figures."></textarea>',
      '  <div class="row2">',
      '    <div>',
      '      <label for="tbVersionCount">Number of Versions</label>',
      '      <input type="number" id="tbVersionCount" min="1" max="12" value="2">',
      '    </div>',
      '    <div>',
      '      <label for="tbVersionNames">Version Names <span style="font-weight:400;color:#888">(comma separated)</span></label>',
      '      <input type="text" id="tbVersionNames" value="A, B">',
      '    </div>',
      '  </div>',
      '  <label style="margin-bottom:8px;display:block">What should change between versions?</label>',
      '  <div class="check-group" style="background:#f4f4fc;border-radius:10px;padding:12px 14px;border:1.5px solid #e0e0f0;flex-direction:column;gap:10px">',
      '    <label><input type="checkbox" id="tbScrambleQ" checked> Scramble question order within each section</label>',
      '    <label><input type="checkbox" id="tbScrambleC" checked> Scramble answer choices within each question</label>',
      '    <label><input type="checkbox" id="tbScrambleAll"> Scramble <strong>all</strong> questions across the whole test <span style="color:#888;font-size:12px">(ignores section headings)</span></label>',
      '    <hr class="soft" style="margin:4px 0">',
      '    <label><input type="radio" name="tbSameQ" id="tbSameYes" checked style="width:16px;height:16px;accent-color:#6465F1"> Every version uses the <strong>same questions</strong> — only the order changes</label>',
      '    <label><input type="radio" name="tbSameQ" id="tbSameNo" style="width:16px;height:16px;accent-color:#6465F1"> Draw a <strong>different random set</strong> of questions for each version</label>',
      '  </div>',
      '</div>',

      // 5 — GENERATE
      '<div class="card">',
      '  <h2><span class="step-dot" style="background:#198754">5</span>Generate Test</h2>',
      '  <div class="btnrow">',
      '    <button class="btn btn-green" id="tbGenerate">⚙ Generate Versions</button>',
      '    <button class="btn btn-indigo" id="tbDownloadAll" style="display:none">⬇ Download Everything (.zip)</button>',
      '  </div>',
      '  <div id="tbStatus" class="notice notice-info" style="display:none;margin-top:12px"></div>',
      '  <div id="tbPreview" style="margin-top:14px"></div>',
      '</div>'
    ].join('\n');

    wire();
    renderBanks();
    renderQuestions();
    renderSections();
  };

  // ─────────────────────────────────────────────────────────────────────────────
  // Events
  // ─────────────────────────────────────────────────────────────────────────────
  function wire() {
    el('tbBankInput').addEventListener('change', onLoadBanks);
    el('tbClearBanks').addEventListener('click', function () {
      TB.clearBanks(); selected = {}; activeBanks = {}; sections.forEach(function (s) { s.required = []; });
      renderBanks(); renderQuestions(); renderSections();
    });
    el('tbFilterType').addEventListener('change', function () { filterType = this.value; renderQuestions(); });
    el('tbSearch').addEventListener('input', function () { filterText = this.value.trim(); renderQuestions(); });
    el('tbSelectAll').addEventListener('click', function () {
      visibleQuestions().forEach(function (q) { selected[q.uid] = true; });
      renderQuestions(); renderSections();
    });
    el('tbSelectNone').addEventListener('click', function () {
      selected = {}; renderQuestions(); renderSections();
    });
    el('tbSelectRandom').addEventListener('click', pickRandomPrompt);
    el('tbAddSection').addEventListener('click', function () { addSection(); });
    el('tbGenerate').addEventListener('click', onGenerate);
    el('tbDownloadAll').addEventListener('click', onDownloadAll);

    el('tbVersionCount').addEventListener('input', function () {
      var n = Math.max(1, Math.min(12, parseInt(this.value, 10) || 1));
      var names = [];
      for (var i = 0; i < n; i++) names.push(String.fromCharCode(65 + i));
      el('tbVersionNames').value = names.join(', ');
    });
  }

  async function onLoadBanks(input) {
    var files = (input.target || input).files;
    if (!files || !files.length) return;
    var statusEl = el('tbBankStatus');
    statusEl.className = 'status-msg show status-loading';
    statusEl.innerHTML = '<span class="spinner"></span> Reading bank file(s)…';

    var res = await TB.loadBankFiles(files);
    res.added.forEach(function (b) { activeBanks[b.id] = true; });

    var msg = '✅ Loaded ' + res.added.length + ' bank' + (res.added.length !== 1 ? 's' : '') +
      ' — ' + res.added.reduce(function (n, b) { return n + b.questions.length; }, 0) + ' questions.';
    if (res.skipped.length) {
      msg += '<br><span style="color:#92400e">Skipped: ' +
        res.skipped.map(function (s) { return esc(s.name) + ' (' + esc(s.reason) + ')'; }).join('; ') + '</span>';
    }
    statusEl.className = 'status-msg show ' + (res.added.length ? 'status-done' : 'status-error');
    statusEl.innerHTML = res.added.length ? msg : '⚠ No banks loaded. ' + msg;

    (input.target || input).value = '';
    renderBanks(); renderQuestions(); renderSections();
  }

  function pickRandomPrompt() {
    var pool = visibleQuestions();
    if (!pool.length) { tbStatus('⚠ No questions are showing to pick from. Load a bank first.', 'warn'); return; }
    showTbPrompt('Pick random questions',
      'How many of the ' + pool.length + ' showing questions should I select at random?',
      Math.min(10, pool.length), 1, pool.length,
      function (n) {
        var rng = TB.makeRng(Date.now() >>> 0);
        TB.shuffled(pool, rng).slice(0, n).forEach(function (q) { selected[q.uid] = true; });
        renderQuestions(); renderSections();
      });
  }

  // Small styled number prompt (no browser prompt dialogs)
  function showTbPrompt(title, message, value, min, max, onOk) {
    var ov = document.createElement('div');
    ov.style.cssText = 'position:fixed;inset:0;background:rgba(32,29,82,.55);z-index:3000;backdrop-filter:blur(3px)';
    var box = document.createElement('div');
    box.style.cssText = 'position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);width:380px;max-width:92vw;background:#fff;border-radius:16px;box-shadow:0 20px 60px rgba(32,29,82,.25);z-index:3001;overflow:hidden';
    box.innerHTML =
      '<div style="background:linear-gradient(135deg,#201D52,#3a2875);padding:16px 20px;color:#fff;font-weight:700;font-size:15px">' + esc(title) + '</div>' +
      '<div style="padding:18px 20px">' +
      '<p style="margin:0 0 10px;font-size:13px;color:#444">' + esc(message) + '</p>' +
      '<input type="number" id="tbPromptVal" value="' + value + '" min="' + min + '" max="' + max + '" style="width:100%;padding:10px 13px;border:1.5px solid #e0e0f0;border-radius:10px;font-size:14px">' +
      '<div style="display:flex;gap:10px;justify-content:flex-end;margin-top:14px">' +
      '<button class="btn btn-gray btn-sm" id="tbPromptCancel">Cancel</button>' +
      '<button class="btn btn-indigo btn-sm" id="tbPromptOk">OK</button>' +
      '</div></div>';
    document.body.appendChild(ov); document.body.appendChild(box);
    function close() { ov.remove(); box.remove(); }
    ov.onclick = close;
    box.querySelector('#tbPromptCancel').onclick = close;
    box.querySelector('#tbPromptOk').onclick = function () {
      var n = Math.max(min, Math.min(max, parseInt(box.querySelector('#tbPromptVal').value, 10) || min));
      close(); onOk(n);
    };
    setTimeout(function () { box.querySelector('#tbPromptVal').focus(); }, 60);
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Bank list
  // ─────────────────────────────────────────────────────────────────────────────
  function renderBanks() {
    var wrap = el('tbBankList');
    if (!TB.banks.length) {
      wrap.innerHTML = '<div style="background:#f4f4fc;border:1.5px dashed #c8c8ea;border-radius:10px;padding:18px;text-align:center;font-size:13px;color:#888">No banks loaded yet.</div>';
      return;
    }
    wrap.innerHTML = '<div style="font-size:12px;font-weight:700;color:#444;margin-bottom:8px">Check the banks you want to pull questions from:</div>' +
      TB.banks.map(function (b) {
        return '<div style="display:flex;align-items:center;gap:10px;background:#f4f4fc;border:1.5px solid #e0e0f0;border-radius:8px;padding:8px 12px;margin-bottom:6px;font-size:13px">' +
          '<input type="checkbox" data-bank="' + b.id + '" class="tbBankChk" ' + (activeBanks[b.id] ? 'checked' : '') + ' style="width:16px;height:16px;accent-color:#6465F1;margin:0">' +
          '<span style="flex:1"><strong>' + esc(b.name) + '</strong>' +
          '<span style="color:#888"> — ' + esc(b.sourceFile) + '</span></span>' +
          '<span style="color:#6465F1;font-weight:700">' + b.questions.length + ' questions</span>' +
          '<button class="btn btn-red btn-sm" data-rmbank="' + b.id + '">✕</button>' +
          '</div>';
      }).join('');

    wrap.querySelectorAll('.tbBankChk').forEach(function (c) {
      c.addEventListener('change', function () {
        if (this.checked) activeBanks[this.dataset.bank] = true; else delete activeBanks[this.dataset.bank];
        renderQuestions();
      });
    });
    wrap.querySelectorAll('[data-rmbank]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var id = this.dataset.rmbank;
        TB.banks.filter(function (b) { return b.id === id; }).forEach(function (b) {
          b.questions.forEach(function (q) { delete selected[q.uid]; });
        });
        TB.removeBank(id); delete activeBanks[id];
        renderBanks(); renderQuestions(); renderSections();
      });
    });
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Question browser
  // ─────────────────────────────────────────────────────────────────────────────
  function renderQuestions() {
    var list = el('tbQuestionList');
    var qs = visibleQuestions();
    el('tbSelCount').textContent = selectedUids().length + ' selected';

    if (!qs.length) {
      list.innerHTML = '<div style="padding:26px;text-align:center;font-size:13px;color:#888">' +
        (TB.banks.length ? 'No questions match these filters.' : 'Load a question bank above to get started.') + '</div>';
      return;
    }

    list.innerHTML = qs.map(function (q) {
      var isOpen = !!expanded[q.uid];
      var preview = String(q.body || '').replace(/\s+/g, ' ').trim();
      return '<div class="q-card" style="margin-bottom:6px;padding:10px 12px">' +
        '<div style="display:flex;align-items:center;gap:9px">' +
        '<input type="checkbox" class="tbQChk" data-uid="' + q.uid + '" ' + (selected[q.uid] ? 'checked' : '') + ' style="width:17px;height:17px;accent-color:#6465F1;margin:0;flex-shrink:0">' +
        '<span class="type-pill tp-' + q.type + '" style="flex-shrink:0">' + q.type + '</span>' +
        '<span style="flex:1;font-size:13px;color:#333;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + esc(preview.substring(0, 110)) + (preview.length > 110 ? '…' : '') + '</span>' +
        '<span style="font-size:11px;color:#888;flex-shrink:0;max-width:130px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + esc(q.bankName || '') + '</span>' +
        '<button class="btn btn-gray btn-sm" data-toggle="' + q.uid + '" style="flex-shrink:0">' + (isOpen ? 'Hide' : 'View') + '</button>' +
        '</div>' +
        (isOpen ? renderQuestionDetail(q) : '') +
        '</div>';
    }).join('');

    list.querySelectorAll('.tbQChk').forEach(function (c) {
      c.addEventListener('change', function () {
        if (this.checked) selected[this.dataset.uid] = true; else delete selected[this.dataset.uid];
        el('tbSelCount').textContent = selectedUids().length + ' selected';
        renderSections();
      });
    });
    list.querySelectorAll('[data-toggle]').forEach(function (b) {
      b.addEventListener('click', function () {
        var uid = this.dataset.toggle;
        expanded[uid] = !expanded[uid];
        renderQuestions();
      });
    });
  }

  function renderQuestionDetail(q) {
    var im = TB.imageFor(q);
    var html = '<div style="margin-top:10px;padding-top:10px;border-top:1.5px solid #e8e8f5;font-size:13px">' +
      '<div style="margin-bottom:6px">' + esc(q.body).replace(/\n/g, '<br>') + '</div>';
    if (im) html += '<img src="data:' + im.mime + ';base64,' + im.data + '" style="max-width:280px;max-height:170px;border-radius:6px;border:1px solid #e0e0f0;margin-bottom:8px;display:block">';

    if (TB.CHOICE_TYPES.indexOf(q.type) !== -1 && q.answers) {
      html += '<div style="margin-left:12px">' + q.answers.map(function (a, i) {
        if (!String(a || '').trim()) return '';
        var isC = (q.correct || []).indexOf(i) !== -1;
        return '<div style="margin:2px 0;' + (isC ? 'color:#065f46;font-weight:700' : 'color:#444') + '">' +
          (isC ? '✓ ' : '&nbsp;&nbsp;&nbsp;') + esc(a) + '</div>';
      }).join('') + '</div>';
    } else {
      var ans = TB.answerFor(q, []);
      if (ans) html += '<div style="margin-left:12px;color:#065f46;font-weight:700">Answer: ' + esc(ans) + '</div>';
    }
    html += '<div style="margin-top:6px;color:#888;font-size:11px">' + esc(TYPE_LABELS[q.type] || q.type) + ' · ' + (q.points || 1) + ' pt · ' + esc(q.bankName || '') + '</div>';
    return html + '</div>';
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Sections
  // ─────────────────────────────────────────────────────────────────────────────
  function addSection(preset) {
    sections.push(Object.assign({
      id: 'sec_' + (sectionSeq++),
      name: 'Part ' + romanize(sections.length + 1),
      count: 10,
      types: [],
      bankIds: [],
      required: []
    }, preset || {}));
    renderSections();
  }

  function romanize(n) {
    var r = ['I','II','III','IV','V','VI','VII','VIII','IX','X'];
    return r[n - 1] || String(n);
  }

  // Which selected questions a section may draw from
  function sectionPool(sec) {
    return selectedUids().filter(function (uid) {
      var q = TB.findQuestion(uid);
      if (!q) return false;
      if (sec.types.length && sec.types.indexOf(q.type) === -1) return false;
      if (sec.bankIds.length && sec.bankIds.indexOf(q.bankId) === -1) return false;
      return true;
    });
  }
  TB.sectionPool = sectionPool;

  function renderSections() {
    var wrap = el('tbSectionList');
    if (!wrap) return;

    if (!sections.length) {
      wrap.innerHTML = '<div style="background:#f4f4fc;border:1.5px dashed #c8c8ea;border-radius:10px;padding:18px;text-align:center;font-size:13px;color:#888">No sections yet — add one to start building the test.</div>';
      el('tbSectionSummary').textContent = '';
      return;
    }

    var running = 0;
    wrap.innerHTML = sections.map(function (sec, i) {
      var pool = sectionPool(sec);
      var start = running + 1, end = running + sec.count;
      running = end;
      var short = pool.length < sec.count;

      var typeChips = ['MC','MR','TF','NUM','SA','FIB','ESSAY'].map(function (t) {
        var on = sec.types.indexOf(t) !== -1;
        return '<label style="font-weight:400;font-size:12px;display:inline-flex;align-items:center;gap:5px;margin:0 10px 4px 0;cursor:pointer">' +
          '<input type="checkbox" class="tbSecType" data-sec="' + sec.id + '" data-type="' + t + '" ' + (on ? 'checked' : '') + ' style="width:15px;height:15px;accent-color:#6465F1;margin:0">' + t + '</label>';
      }).join('');

      var bankChips = TB.banks.map(function (b) {
        var on = sec.bankIds.indexOf(b.id) !== -1;
        return '<label style="font-weight:400;font-size:12px;display:inline-flex;align-items:center;gap:5px;margin:0 10px 4px 0;cursor:pointer">' +
          '<input type="checkbox" class="tbSecBank" data-sec="' + sec.id + '" data-bank="' + b.id + '" ' + (on ? 'checked' : '') + ' style="width:15px;height:15px;accent-color:#6465F1;margin:0">' + esc(b.name) + '</label>';
      }).join('') || '<span style="font-size:12px;color:#888">no banks loaded</span>';

      var reqList = sec.required.map(function (uid) {
        var q = TB.findQuestion(uid);
        var label = q ? String(q.body).replace(/\s+/g, ' ').substring(0, 60) : '(missing question)';
        return '<div style="display:flex;align-items:center;gap:8px;background:#fff;border:1px solid #e0e0f0;border-radius:6px;padding:5px 9px;margin-bottom:4px;font-size:12px">' +
          '<span class="type-pill tp-' + (q ? q.type : 'MC') + '" style="font-size:10px;padding:2px 6px">' + (q ? q.type : '?') + '</span>' +
          '<span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + esc(label) + '</span>' +
          '<button class="btn btn-red btn-sm" data-unreq="' + sec.id + '|' + uid + '" style="padding:3px 8px;font-size:11px">✕</button></div>';
      }).join('');

      return '<div style="background:#fafafe;border:1.5px solid #e8e8f5;border-radius:12px;padding:14px;margin-bottom:10px">' +
        '<div style="display:flex;align-items:center;gap:10px;margin-bottom:10px">' +
        '<span class="q-num" style="background:#d97706">Q' + start + '–' + end + '</span>' +
        '<input type="text" class="tbSecName" data-sec="' + sec.id + '" value="' + esc(sec.name) + '" placeholder="Section name" style="flex:1;margin-bottom:0;font-weight:700">' +
        '<button class="btn btn-red btn-sm" data-rmsec="' + sec.id + '">✕</button>' +
        '</div>' +
        '<div class="row2" style="margin-bottom:8px">' +
        '<div><label style="font-size:12px">How many questions in this section</label>' +
        '<input type="number" class="tbSecCount" data-sec="' + sec.id + '" value="' + sec.count + '" min="1" max="200" style="margin-bottom:0"></div>' +
        '<div><label style="font-size:12px">Available to draw from</label>' +
        '<div style="padding:9px 0;font-size:13px;font-weight:700;color:' + (short ? '#dc3545' : '#059669') + '">' +
        pool.length + ' question' + (pool.length !== 1 ? 's' : '') + (short ? ' — not enough!' : ' ready') + '</div></div>' +
        '</div>' +
        '<label style="font-size:12px;margin-bottom:4px">Limit to question types <span style="font-weight:400;color:#888">(none checked = any type)</span></label>' +
        '<div style="margin-bottom:8px">' + typeChips + '</div>' +
        '<label style="font-size:12px;margin-bottom:4px">Limit to banks <span style="font-weight:400;color:#888">(none checked = any bank)</span></label>' +
        '<div style="margin-bottom:10px">' + bankChips + '</div>' +
        '<label style="font-size:12px;margin-bottom:4px">Required questions <span style="font-weight:400;color:#888">(always appear in this section, on every version)</span></label>' +
        (reqList || '<div style="font-size:12px;color:#888;margin-bottom:6px">None — the whole section is drawn at random.</div>') +
        '<button class="btn btn-navy btn-sm" data-addreq="' + sec.id + '">+ Add Required Question</button>' +
        '</div>';
    }).join('');

    var totalQ = sections.reduce(function (n, s) { return n + s.count; }, 0);
    el('tbSectionSummary').textContent = sections.length + ' section' + (sections.length !== 1 ? 's' : '') + ' — ' + totalQ + ' questions per version';

    wireSectionEvents();
  }

  function findSec(id) { return sections.find(function (s) { return s.id === id; }); }

  function wireSectionEvents() {
    var wrap = el('tbSectionList');
    wrap.querySelectorAll('.tbSecName').forEach(function (i) {
      i.addEventListener('input', function () { findSec(this.dataset.sec).name = this.value; });
    });
    wrap.querySelectorAll('.tbSecCount').forEach(function (i) {
      i.addEventListener('input', function () {
        findSec(this.dataset.sec).count = Math.max(1, parseInt(this.value, 10) || 1);
        renderSections();
      });
    });
    wrap.querySelectorAll('.tbSecType').forEach(function (c) {
      c.addEventListener('change', function () {
        var sec = findSec(this.dataset.sec), t = this.dataset.type;
        if (this.checked) { if (sec.types.indexOf(t) === -1) sec.types.push(t); }
        else sec.types = sec.types.filter(function (x) { return x !== t; });
        renderSections();
      });
    });
    wrap.querySelectorAll('.tbSecBank').forEach(function (c) {
      c.addEventListener('change', function () {
        var sec = findSec(this.dataset.sec), b = this.dataset.bank;
        if (this.checked) { if (sec.bankIds.indexOf(b) === -1) sec.bankIds.push(b); }
        else sec.bankIds = sec.bankIds.filter(function (x) { return x !== b; });
        renderSections();
      });
    });
    wrap.querySelectorAll('[data-rmsec]').forEach(function (b) {
      b.addEventListener('click', function () {
        sections = sections.filter(function (s) { return s.id !== this.dataset.rmsec; }.bind(this));
        renderSections();
      });
    });
    wrap.querySelectorAll('[data-unreq]').forEach(function (b) {
      b.addEventListener('click', function () {
        var parts = this.dataset.unreq.split('|');
        var sec = findSec(parts[0]);
        sec.required = sec.required.filter(function (u) { return u !== parts[1]; });
        renderSections();
      });
    });
    wrap.querySelectorAll('[data-addreq]').forEach(function (b) {
      b.addEventListener('click', function () { openRequiredPicker(this.dataset.addreq); });
    });
  }

  // Picker listing the selected questions eligible for this section
  function openRequiredPicker(secId) {
    var sec = findSec(secId);
    var pool = sectionPool(sec).filter(function (uid) { return sec.required.indexOf(uid) === -1; });

    var ov = document.createElement('div');
    ov.style.cssText = 'position:fixed;inset:0;background:rgba(32,29,82,.55);z-index:3000;backdrop-filter:blur(3px)';
    var box = document.createElement('div');
    box.style.cssText = 'position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);width:640px;max-width:94vw;max-height:80vh;background:#fff;border-radius:16px;box-shadow:0 20px 60px rgba(32,29,82,.25);z-index:3001;display:flex;flex-direction:column;overflow:hidden';
    box.innerHTML =
      '<div style="background:linear-gradient(135deg,#201D52,#3a2875);padding:16px 20px;color:#fff;font-weight:700;font-size:15px">Require a question in “' + esc(sec.name) + '”</div>' +
      '<div style="padding:14px 20px;overflow-y:auto;flex:1">' +
      (pool.length
        ? pool.map(function (uid) {
            var q = TB.findQuestion(uid);
            return '<div style="display:flex;align-items:center;gap:9px;padding:7px 9px;border:1px solid #e8e8f5;border-radius:8px;margin-bottom:5px;font-size:13px">' +
              '<span class="type-pill tp-' + q.type + '" style="font-size:10px;padding:2px 6px">' + q.type + '</span>' +
              '<span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + esc(String(q.body).replace(/\s+/g, ' ').substring(0, 80)) + '</span>' +
              '<button class="btn btn-green btn-sm" data-pick="' + uid + '">Add</button></div>';
          }).join('')
        : '<p style="font-size:13px;color:#888;text-align:center;padding:20px">No eligible questions. Select questions in step 2 first (and check this section\'s type/bank limits).</p>') +
      '</div>' +
      '<div style="padding:12px 20px;border-top:1px solid #e8e8f5;text-align:right"><button class="btn btn-gray btn-sm" id="tbPickClose">Done</button></div>';
    document.body.appendChild(ov); document.body.appendChild(box);
    function close() { ov.remove(); box.remove(); renderSections(); }
    ov.onclick = close;
    box.querySelector('#tbPickClose').onclick = close;
    box.querySelectorAll('[data-pick]').forEach(function (b) {
      b.addEventListener('click', function () {
        sec.required.push(this.dataset.pick);
        this.closest('div[style*="display:flex"]').remove();
      });
    });
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Generate
  // ─────────────────────────────────────────────────────────────────────────────
  function currentBlueprint() {
    var names = el('tbVersionNames').value.split(',').map(function (s) { return s.trim(); }).filter(Boolean);
    if (!names.length) names = ['A'];
    return {
      title: el('tbTitle').value.trim() || 'Test',
      subtitle: el('tbSubtitle').value.trim(),
      instructions: el('tbInstructions').value.trim(),
      versions: names,
      sameQuestionsAllVersions: el('tbSameYes').checked,
      scrambleQuestions: el('tbScrambleQ').checked,
      scrambleChoices: el('tbScrambleC').checked,
      scrambleWholeTest: el('tbScrambleAll').checked,
      sections: sections.map(function (s) {
        return { name: s.name, count: s.count, pool: sectionPool(s), required: s.required.slice() };
      })
    };
  }

  function onGenerate() {
    if (!sections.length) { tbStatus('⚠ Add at least one section in step 3 first.', 'warn'); return; }
    if (!selectedUids().length) { tbStatus('⚠ No questions selected. Pick some in step 2 first.', 'warn'); return; }

    var bp = currentBlueprint();
    var res = TB.buildVersions(bp);
    lastVersions = { versions: res.versions, blueprint: bp };

    var msg = '✅ Built ' + res.versions.length + ' version' + (res.versions.length !== 1 ? 's' : '') + ': ' +
      res.versions.map(function (v) { return '<strong>' + esc(v.name) + '</strong> (' + v.questionCount + ' q, ' + v.totalPoints + ' pts)'; }).join(' · ');
    if (res.warnings.length) {
      msg += '<br><span style="color:#92400e">⚠ ' + res.warnings.map(esc).join('<br>⚠ ') + '</span>';
    }
    tbStatus(msg, res.warnings.length ? 'warn' : 'success');
    el('tbDownloadAll').style.display = '';
    renderPreview();
  }

  function renderPreview() {
    if (!lastVersions) return;
    var wrap = el('tbPreview');
    wrap.innerHTML = lastVersions.versions.map(function (v, vi) {
      var keyRows = TB.keyRows(v);
      return '<div style="background:#fafafe;border:1.5px solid #e8e8f5;border-radius:12px;padding:14px;margin-bottom:10px">' +
        '<div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin-bottom:10px">' +
        '<span class="q-num" style="background:#198754">Version ' + esc(v.name) + '</span>' +
        '<span style="font-size:13px;color:#555">' + v.questionCount + ' questions · ' + v.totalPoints + ' points</span>' +
        '<div style="margin-left:auto;display:flex;gap:7px">' +
        '<button class="btn btn-navy btn-sm" data-print="' + vi + '">🖨 Print / PDF</button>' +
        '<button class="btn btn-indigo btn-sm" data-docx="' + vi + '">⬇ Word</button>' +
        '</div></div>' +
        '<div style="font-size:12px;color:#444;font-family:\'DM Mono\',monospace;background:#fff;border:1px solid #e8e8f5;border-radius:8px;padding:10px;max-height:120px;overflow-y:auto">' +
        keyRows.map(function (r) { return r.number + '. ' + esc(r.answer || '—'); }).join('&nbsp;&nbsp; ') +
        '</div></div>';
    }).join('');

    wrap.querySelectorAll('[data-print]').forEach(function (b) {
      b.addEventListener('click', function () {
        var v = lastVersions.versions[+this.dataset.print];
        if (!TB.openPrintView(v, lastVersions.blueprint)) {
          tbStatus('⚠ Your browser blocked the print window. Allow pop-ups for this site and try again.', 'warn');
        }
      });
    });
    wrap.querySelectorAll('[data-docx]').forEach(function (b) {
      b.addEventListener('click', async function () {
        var v = lastVersions.versions[+this.dataset.docx];
        this.disabled = true; this.textContent = 'Building…';
        var blob = await TB.buildDocx(v, lastVersions.blueprint);
        TB.download(blob, (lastVersions.blueprint.title || 'test').replace(/[^a-z0-9]+/gi, '_').toLowerCase() + '_version_' + v.name + '.docx');
        this.disabled = false; this.textContent = '⬇ Word';
      });
    });
  }

  async function onDownloadAll() {
    if (!lastVersions) return;
    var btn = el('tbDownloadAll');
    btn.disabled = true; btn.textContent = 'Building package…';
    try {
      var notes = await TB.exportAll(lastVersions.versions, lastVersions.blueprint, {});
      var msg = '✅ Downloaded the full package — Word files, print copies, and both answer keys.';
      if (notes && notes.length) msg += '<br><span style="color:#92400e">' + notes.map(esc).join('<br>') + '</span>';
      tbStatus(msg, 'success');
    } catch (err) {
      tbStatus('⚠ Could not build the package: ' + esc(err.message), 'error');
    }
    btn.disabled = false; btn.textContent = '⬇ Download Everything (.zip)';
  }

  // Start with one section so the page never looks empty
  TB.init = function () {
    TB.render();
    if (!sections.length) addSection({ name: 'Part I — Multiple Choice', count: 10, types: ['MC'] });
  };

})(window);
