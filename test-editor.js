// test-editor.js
// Batch Genie — Paper Test Builder: question editor
//
// Edit any question from a bank, then choose what to do with the change:
//   • Save changes          — overwrite the question in its bank
//   • Save as new question  — keep the original, add a copy to the same bank
//   • Save to another bank… — file it under a different (or brand new) bank
//
// Whichever you choose, the result is available to the test you're building
// straight away. Banks you change are marked so step 1 can offer to re-save
// them to your library.
//
// Depends on: TBHtml, test-banks.js, test-library.js, esc() from index.html.

(function (global) {
  'use strict';

  var TB = global.TestBuilder = global.TestBuilder || {};
  var H = global.TBHtml;

  var EDITABLE_TYPES = ['MC', 'MR', 'TF', 'NUM', 'SA', 'ESSAY', 'FIB', 'MATCH', 'TEXT'];

  // esc() comes from index.html's script as a lexical binding, so it is
  // referenced directly rather than off the global object.
  function esc2(s) { return esc(s); }

  // Working copy so Cancel really cancels
  function cloneQ(q) {
    var c = JSON.parse(JSON.stringify({
      type: q.type, title: q.title || '', points: q.points,
      html: q.html || '', answersHtml: q.answersHtml || [],
      correct: q.correct || [], fib_blanks: q.fib_blanks || {},
      matchPrompts: q.matchPrompts || [], answers: q.answers || [], range: q.range || ''
    }));
    return c;
  }

  // ── The dialog ──────────────────────────────────────────────────────────────
  // onDone(action) is called after a successful save so the browser can refresh
  TB.openEditor = function (uid, onDone) {
    var orig = TB.findQuestion(uid);
    if (!orig) return;
    // Last line of defence: whatever the question's history, its blanks get
    // readable names before anyone sees them.
    if (orig.type === 'FIB' && TB.normalizeFibNames) TB.normalizeFibNames(orig);
    var draft = cloneQ(orig);

    var ov = document.createElement('div');
    ov.style.cssText = 'position:fixed;inset:0;background:rgba(32,29,82,.55);z-index:3200;backdrop-filter:blur(3px)';
    var box = document.createElement('div');
    box.style.cssText = 'position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);width:820px;max-width:96vw;max-height:88vh;background:#fff;border-radius:16px;box-shadow:0 20px 60px rgba(32,29,82,.3);z-index:3201;display:flex;flex-direction:column;overflow:hidden';
    document.body.appendChild(ov);
    document.body.appendChild(box);

    function close() { ov.remove(); box.remove(); }
    ov.onclick = close;

    // MR is always multi-answer. MC is normally single-answer, but Edugence
    // renders its A/B/C/D bubbles as independent checkboxes with no shared
    // radio group, so a select-all-that-apply item legitimately arrives as an
    // MC carrying two or more correct indices. Render those as checkboxes too,
    // or opening the question here would silently drop every correct answer
    // but the first. The flag is sticky for the life of the dialog: once a
    // question is being edited as multi-answer, unticking down to one choice
    // must not flip the controls back to radios mid-edit and strand the user.
    var multiMC = draft.type === 'MC' && (draft.correct || []).length > 1;
    function isMulti() { return draft.type === 'MR' || (draft.type === 'MC' && multiMC); }

    function answersEditor() {
      if (draft.type === 'TEXT' || draft.type === 'ESSAY') {
        return '<p style="font-size:13px;color:#888;margin:0">No answer choices for this type.</p>';
      }

      if (draft.type === 'NUM') {
        return '<label style="font-size:12px">Correct value <span style="font-weight:400;color:#888">(what the answer key shows)</span></label>' +
          '<input type="text" id="edNum" value="' + esc2(draft.answers[0] || '') + '" placeholder="e.g. 6.9">' +
          '<label style="font-size:12px">Accepted range <span style="font-weight:400;color:#888">(optional, e.g. [6.8, 7.0])</span></label>' +
          '<input type="text" id="edRange" value="' + esc2(draft.range || '') + '">';
      }

      if (draft.type === 'SA') {
        return '<label style="font-size:12px">Acceptable answers — one per line</label>' +
          '<textarea id="edSA" style="min-height:80px">' + esc2((draft.answers || []).filter(Boolean).join('\n')) + '</textarea>';
      }

      if (draft.type === 'FIB') {
        var ids = TB.fibOrder ? TB.fibOrder(draft) : Object.keys(draft.fib_blanks || {});
        if (!ids.length) return '<p style="font-size:13px;color:#888;margin:0">No blanks found. Add [blank_name] markers in the question text.</p>';
        return '<label style="font-size:12px">Answer for each blank, in the order they appear</label>' +
          ids.map(function (bid, i) {
            return '<div style="display:flex;gap:8px;align-items:center;margin-bottom:6px">' +
              '<span style="font-weight:700;min-width:22px">' + (i + 1) + '.</span>' +
              '<input type="text" class="edFib" data-bid="' + esc2(bid) + '" value="' +
              esc2((draft.fib_blanks[bid] || {}).correct || '') + '" style="margin-bottom:0;flex:1"></div>';
          }).join('');
      }

      if (draft.type === 'MATCH') {
        var choices = draft.answersHtml.map(function (c, i) {
          return '<div style="display:flex;gap:8px;align-items:center;margin-bottom:5px">' +
            '<span style="font-weight:700;min-width:22px">' + TB.LETTERS[i] + '.</span>' +
            '<input type="text" class="edMChoice" data-i="' + i + '" value="' + esc2(H.toPlain(c)) + '" style="margin-bottom:0;flex:1">' +
            '<button class="btn btn-red btn-sm" data-rmchoice="' + i + '">✕</button></div>';
        }).join('');
        var prompts = (draft.matchPrompts || []).map(function (p, i) {
          var opts = draft.answersHtml.map(function (c, ci) {
            return '<option value="' + ci + '" ' + (p.correct === ci ? 'selected' : '') + '>' +
              TB.LETTERS[ci] + '. ' + esc2(H.toPlain(c).substring(0, 40)) + '</option>';
          }).join('');
          return '<div style="display:flex;gap:8px;align-items:center;margin-bottom:5px">' +
            '<input type="text" class="edMPrompt" data-i="' + i + '" value="' + esc2(H.toPlain(p.html)) + '" style="margin-bottom:0;flex:1">' +
            '<span style="color:#888">→</span>' +
            '<select class="edMCorrect" data-i="' + i + '" style="width:auto;margin-bottom:0;min-width:150px">' + opts + '</select>' +
            '<button class="btn btn-red btn-sm" data-rmprompt="' + i + '">✕</button></div>';
        }).join('');
        return '<label style="font-size:12px">Choices students pick from</label>' + choices +
          '<button class="btn btn-gray btn-sm" id="edAddChoice" style="margin-bottom:12px">+ Add Choice</button>' +
          '<label style="font-size:12px;margin-top:8px">Items to match, and their answer</label>' + prompts +
          '<button class="btn btn-gray btn-sm" id="edAddPrompt">+ Add Item</button>';
      }

      // MC / MR / TF
      var multi = isMulti();
      var rows = draft.answersHtml.map(function (a, i) {
        var on = (draft.correct || []).indexOf(i) !== -1;
        return '<div style="display:flex;gap:8px;align-items:center;margin-bottom:6px">' +
          '<input type="' + (multi ? 'checkbox' : 'radio') + '" name="edCorrect" class="edCorrect" data-i="' + i + '" ' +
          (on ? 'checked' : '') + ' style="width:18px;height:18px;accent-color:#6465F1;margin:0;flex-shrink:0">' +
          '<span style="font-weight:700;min-width:22px">' + TB.LETTERS[i] + '.</span>' +
          '<input type="text" class="edChoice" data-i="' + i + '" value="' + esc2(H.toPlain(a)) + '" style="margin-bottom:0;flex:1">' +
          '<button class="btn btn-red btn-sm" data-rmans="' + i + '">✕</button></div>';
      }).join('');
      return '<label style="font-size:12px">Answer choices — ' + (multi ? 'tick every correct one' : 'tick the correct one') + '</label>' +
        rows + '<button class="btn btn-gray btn-sm" id="edAddAns">+ Add Choice</button>';
    }

    // What the editable surface shows: the question exactly as Canvas has it,
    // with images resolved. Blank markers stay visible as chips so they can be
    // moved, removed or added.
    function editableHtml() {
      var html = H.sanitize(draft.html, TB.resolveImage);
      if (draft.type === 'FIB') {
        html = html.replace(/\[([A-Za-z0-9_\-]{1,64})\]/g,
          '<span class="tbBlankChip">[$1]</span>');
      }
      return html;
    }

    // Read the surface back, turning blank chips into plain markers again
    function readEditable() {
      var node = box.querySelector('#edBody');
      if (!node) return draft.html;
      var clone = node.cloneNode(true);
      clone.querySelectorAll('.tbBlankChip').forEach(function (chip) {
        chip.replaceWith(document.createTextNode(chip.textContent));
      });
      return H.sanitize(clone.innerHTML, function (ref) { return TB.resolveImage(ref); });
    }

    function draw() {
      var typeOpts = EDITABLE_TYPES.map(function (t) {
        return '<option value="' + t + '" ' + (draft.type === t ? 'selected' : '') + '>' + t + '</option>';
      }).join('');

      box.innerHTML =
        '<div style="background:linear-gradient(135deg,#201D52,#3a2875);padding:16px 20px;display:flex;align-items:center;justify-content:space-between">' +
        '<span style="color:#fff;font-size:16px;font-weight:700">✏ Edit Question</span>' +
        '<span style="color:rgba(255,255,255,.7);font-size:12px">from ' + esc2(orig.bankName || '') + '</span></div>' +

        '<div style="padding:18px 20px;overflow-y:auto;flex:1">' +
        '<div class="row2">' +
        '<div><label style="font-size:12px">Type</label><select id="edType">' + typeOpts + '</select></div>' +
        '<div><label style="font-size:12px">Points</label><input type="number" id="edPoints" min="0" step="0.5" value="' + (draft.points || 1) + '"></div>' +
        '</div>' +

        '<label style="font-size:12px">Question text <span style="font-weight:400;color:#888">(edit it just like a document — tables, bold and images are kept exactly as they are in Canvas)</span></label>' +
        '<div class="tbToolbar">' +
        '<button type="button" data-cmd="bold" title="Bold"><strong>B</strong></button>' +
        '<button type="button" data-cmd="italic" title="Italic"><em>I</em></button>' +
        '<button type="button" data-cmd="underline" title="Underline"><u>U</u></button>' +
        '<button type="button" data-cmd="superscript" title="Superscript">x²</button>' +
        '<button type="button" data-cmd="subscript" title="Subscript">x₂</button>' +
        '<button type="button" data-cmd="removeFormat" title="Clear formatting">✕ format</button>' +
        '<span style="width:10px"></span>' +
        '<button type="button" id="edInsertTable" title="Insert a table">▦ Table</button>' +
        (draft.type === 'FIB' ? '<button type="button" id="edInsertBlank" title="Insert a blank">＿ Blank</button>' : '') +
        '<button type="button" id="edToggleSource" title="Show the underlying HTML">&lt;/&gt;</button>' +
        '</div>' +
        '<div id="edBody" class="tbWysiwyg" contenteditable="true">' + editableHtml() + '</div>' +
        '<textarea id="edSource" style="display:none;min-height:120px;font-family:\'DM Mono\',monospace;font-size:12.5px;margin-top:8px"></textarea>' +
        '<div style="font-size:11px;color:#888;margin:4px 0 14px">' +
        (draft.type === 'FIB' ? 'Each <span class="tbBlankChip">[blank1]</span> marks where a student writes. They print as ruled lines.' : 'What you see here is what prints.') +
        '</div>' +

        '<div id="edAnswers">' + answersEditor() + '</div>' +
        '</div>' +

        '<div style="padding:12px 20px;border-top:1px solid #e8e8f5;display:flex;gap:10px;flex-wrap:wrap;justify-content:flex-end">' +
        '<button class="btn btn-gray btn-sm" id="edCancel">Cancel</button>' +
        '<button class="btn btn-navy btn-sm" id="edSaveNew">Save as new question</button>' +
        '<button class="btn btn-violet btn-sm" id="edSaveOther">Save to another bank…</button>' +
        '<button class="btn btn-green btn-sm" id="edSave">Save changes</button>' +
        '</div>';

      wire();
    }

    function readTextInputs() {
      var srcBox = box.querySelector('#edSource');
      if (srcBox && srcBox.style.display !== 'none') draft.html = srcBox.value;
      else draft.html = readEditable();
      var p = box.querySelector('#edPoints');
      if (p) draft.points = parseFloat(p.value) || 1;

      box.querySelectorAll('.edChoice').forEach(function (i) {
        draft.answersHtml[+i.dataset.i] = i.value;
      });
      box.querySelectorAll('.edMChoice').forEach(function (i) {
        draft.answersHtml[+i.dataset.i] = i.value;
      });
      box.querySelectorAll('.edMPrompt').forEach(function (i) {
        if (draft.matchPrompts[+i.dataset.i]) draft.matchPrompts[+i.dataset.i].html = i.value;
      });
      box.querySelectorAll('.edMCorrect').forEach(function (sel) {
        if (draft.matchPrompts[+sel.dataset.i]) draft.matchPrompts[+sel.dataset.i].correct = parseInt(sel.value, 10);
      });
      box.querySelectorAll('.edFib').forEach(function (i) {
        var bid = i.dataset.bid;
        draft.fib_blanks[bid] = draft.fib_blanks[bid] || {};
        draft.fib_blanks[bid].correct = i.value;
      });
      var sa = box.querySelector('#edSA');
      if (sa) draft.answers = sa.value.split('\n').map(function (x) { return x.trim(); }).filter(Boolean);
      var num = box.querySelector('#edNum');
      if (num) draft.answers = [num.value.trim()];
      var rng = box.querySelector('#edRange');
      if (rng) draft.range = rng.value.trim();

      // answers array must stay the same length as the choice list
      if (['MC', 'MR', 'TF', 'MATCH'].indexOf(draft.type) !== -1) {
        draft.answers = draft.answersHtml.map(function (a) { return H.toPlain(a); });
      }
    }

    function wire() {
      box.querySelector('#edCancel').addEventListener('click', close);

      box.querySelector('#edType').addEventListener('change', function () {
        readTextInputs();
        draft.type = this.value;
        if (draft.type === 'TF') {
          draft.answersHtml = ['True', 'False'];
          draft.correct = draft.correct.filter(function (i) { return i < 2; });
        }
        if (draft.type === 'MATCH' && !draft.matchPrompts.length) {
          draft.matchPrompts = [{ html: '', correct: 0 }];
          if (!draft.answersHtml.length) draft.answersHtml = ['', ''];
        }
        draw();
      });

      var body = box.querySelector('#edBody');
      var srcBox = box.querySelector('#edSource');

      box.querySelectorAll('.tbToolbar [data-cmd]').forEach(function (b2) {
        b2.addEventListener('mousedown', function (e) { e.preventDefault(); });   // keep the selection
        b2.addEventListener('click', function () {
          body.focus();
          document.execCommand(this.dataset.cmd, false, null);
        });
      });

      box.querySelector('#edInsertTable').addEventListener('click', function () {
        askTableSize(function (rows, cols) {
          var html = '<table border="1"><tbody>';
          for (var r = 0; r < rows; r++) {
            html += '<tr>';
            for (var c = 0; c < cols; c++) html += (r === 0 ? '<th>&nbsp;</th>' : '<td>&nbsp;</td>');
            html += '</tr>';
          }
          html += '</tbody></table><p>&nbsp;</p>';
          body.focus();
          document.execCommand('insertHTML', false, html);
        });
      });

      var insBlank = box.querySelector('#edInsertBlank');
      if (insBlank) insBlank.addEventListener('click', function () {
        // Next free blank name, so it never collides with an existing one
        var n = 1;
        while (draft.fib_blanks['blank' + n] || body.innerHTML.indexOf('[blank' + n + ']') !== -1) n++;
        body.focus();
        document.execCommand('insertHTML', false, '<span class="tbBlankChip">[blank' + n + ']</span>&nbsp;');
        syncBlanks();
      });

      box.querySelector('#edToggleSource').addEventListener('click', function () {
        if (srcBox.style.display === 'none') {
          srcBox.value = readEditable();
          srcBox.style.display = '';
          body.style.display = 'none';
        } else {
          draft.html = srcBox.value;
          srcBox.style.display = 'none';
          body.style.display = '';
          body.innerHTML = editableHtml();
          syncBlanks();
        }
      });

      // Adding or deleting blanks in the text keeps the answer list in step
      function syncBlanks() {
        if (draft.type !== 'FIB') return;
        var html = readEditable();
        var found = [], re = /\[([^\]\s]{1,64})\]/g, m;
        while ((m = re.exec(html)) !== null) if (found.indexOf(m[1]) === -1) found.push(m[1]);
        var same = found.length === Object.keys(draft.fib_blanks).length &&
          found.every(function (b3) { return draft.fib_blanks[b3]; });
        if (same) return;
        var next = {};
        found.forEach(function (b3) { next[b3] = draft.fib_blanks[b3] || { correct: '', blooket_distractors: [] }; });
        draft.fib_blanks = next;
        draft.html = html;
        draw();
      }
      body.addEventListener('blur', syncBlanks);

      // Pasting from Word or Canvas brings a lot of junk; keep only what we render
      body.addEventListener('paste', function (e) {
        var html = (e.clipboardData || global.clipboardData).getData('text/html');
        var text = (e.clipboardData || global.clipboardData).getData('text/plain');
        e.preventDefault();
        document.execCommand('insertHTML', false, html ? H.sanitize(html, TB.resolveImage) : esc2(text));
      });

      box.querySelectorAll('.edCorrect').forEach(function (c) {
        c.addEventListener('change', function () {
          var i = +this.dataset.i;
          if (isMulti()) {
            if (this.checked) { if (draft.correct.indexOf(i) === -1) draft.correct.push(i); }
            else draft.correct = draft.correct.filter(function (x) { return x !== i; });
          } else {
            draft.correct = this.checked ? [i] : [];
          }
        });
      });

      var addAns = box.querySelector('#edAddAns');
      if (addAns) addAns.addEventListener('click', function () {
        readTextInputs(); draft.answersHtml.push(''); draw();
      });
      box.querySelectorAll('[data-rmans]').forEach(function (b) {
        b.addEventListener('click', function () {
          readTextInputs();
          var i = +this.dataset.rmans;
          draft.answersHtml.splice(i, 1);
          draft.correct = draft.correct.filter(function (x) { return x !== i; })
                                       .map(function (x) { return x > i ? x - 1 : x; });
          draw();
        });
      });

      var addChoice = box.querySelector('#edAddChoice');
      if (addChoice) addChoice.addEventListener('click', function () { readTextInputs(); draft.answersHtml.push(''); draw(); });
      var addPrompt = box.querySelector('#edAddPrompt');
      if (addPrompt) addPrompt.addEventListener('click', function () { readTextInputs(); draft.matchPrompts.push({ html: '', correct: 0 }); draw(); });
      box.querySelectorAll('[data-rmchoice]').forEach(function (b) {
        b.addEventListener('click', function () {
          readTextInputs();
          var i = +this.dataset.rmchoice;
          draft.answersHtml.splice(i, 1);
          draft.matchPrompts.forEach(function (p) {
            if (p.correct === i) p.correct = 0; else if (p.correct > i) p.correct--;
          });
          draw();
        });
      });
      box.querySelectorAll('[data-rmprompt]').forEach(function (b) {
        b.addEventListener('click', function () {
          readTextInputs(); draft.matchPrompts.splice(+this.dataset.rmprompt, 1); draw();
        });
      });

      box.querySelector('#edSave').addEventListener('click', function () { commit('overwrite'); });
      box.querySelector('#edSaveNew').addEventListener('click', function () { commit('copy'); });
      box.querySelector('#edSaveOther').addEventListener('click', function () { chooseBank(); });
    }

    function problems() {
      var out = [];
      if (!String(draft.html || '').trim()) out.push('The question text is empty.');
      if (['MC', 'TF'].indexOf(draft.type) !== -1) {
        if (draft.answersHtml.filter(function (a) { return String(a).trim(); }).length < 2) out.push('Needs at least two answer choices.');
        if (!draft.correct.length) out.push('Tick which choice is correct.');
      }
      if (draft.type === 'MR' && !draft.correct.length) out.push('Tick at least one correct choice.');
      if (draft.type === 'SA' && !(draft.answers || []).length) out.push('Enter at least one acceptable answer.');
      if (draft.type === 'NUM' && !String((draft.answers || [])[0] || '').trim()) out.push('Enter the correct value.');
      if (draft.type === 'MATCH') {
        if (!draft.matchPrompts.length) out.push('Add at least one item to match.');
        if (draft.answersHtml.filter(function (a) { return String(a).trim(); }).length < 2) out.push('Needs at least two choices.');
      }
      return out;
    }

    // target: undefined = same bank
    function commit(mode, targetBank) {
      readTextInputs();
      var errs = problems();
      if (errs.length) {
        if (typeof showAppAlert === 'function') showAppAlert('Fix these first', '<ul style="margin:0;padding-left:20px">' +
          errs.map(function (e) { return '<li>' + esc2(e) + '</li>'; }).join('') + '</ul>');
        return;
      }

      var bank = targetBank || TB.banks.find(function (b) { return b.id === orig.bankId; });
      if (!bank) return;

      if (mode === 'overwrite' && !targetBank) {
        applyTo(orig);
        TB.markDirty(orig.bankId);
      } else {
        var copy = applyTo({ uid: TB.nextUid() });
        copy.bankId = bank.id;
        copy.bankName = bank.name;
        // A copy filed elsewhere still needs its pictures to resolve
        if (!bank.savedImages) bank.savedImages = {};
        var srcBank = TB.banks.find(function (b) { return b.id === orig.bankId; });
        if (srcBank) {
          [copy.html].concat(copy.answersHtml || []).forEach(function (h) {
            H.imageRefs(h).forEach(function (ref) {
              var id = ref.kind === 'remote' ? ref.url : ref.path;
              var url = TB.imageUrls && TB.imageUrls[id];
              if (url && url.indexOf('data:') === 0) bank.savedImages[id] = url;
            });
          });
        }
        bank.questions.push(copy);
        TB.markDirty(bank.id);
      }

      TB.resetIndex();
      close();
      if (onDone) onDone(mode, bank);
    }

    function applyTo(target) {
      target.type = draft.type;
      target.title = draft.title;
      target.points = draft.points;
      target.html = draft.html;
      target.answersHtml = (draft.answersHtml || []).slice();
      target.answers = (draft.answers || []).slice();
      target.correct = (draft.correct || []).slice();
      target.fib_blanks = JSON.parse(JSON.stringify(draft.fib_blanks || {}));
      target.range = draft.range || '';
      if (draft.type === 'MATCH') target.matchPrompts = JSON.parse(JSON.stringify(draft.matchPrompts || []));
      else delete target.matchPrompts;
      delete target._plain;
      delete target._plainAns;
      target.edited = true;
      return target;
    }

    // Pick an existing bank, or type a name to make a new one
    function chooseBank() {
      readTextInputs();
      var ov2 = document.createElement('div');
      ov2.style.cssText = 'position:fixed;inset:0;background:rgba(32,29,82,.5);z-index:3300';
      var box2 = document.createElement('div');
      box2.style.cssText = 'position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);width:520px;max-width:94vw;max-height:75vh;background:#fff;border-radius:16px;box-shadow:0 20px 60px rgba(32,29,82,.3);z-index:3301;display:flex;flex-direction:column;overflow:hidden';
      box2.innerHTML =
        '<div style="background:linear-gradient(135deg,#201D52,#3a2875);padding:15px 18px;color:#fff;font-weight:700;font-size:15px">Save this question to…</div>' +
        '<div style="padding:16px 18px;overflow-y:auto;flex:1">' +
        '<label style="font-size:12px">Make a new bank</label>' +
        '<div style="display:flex;gap:8px;margin-bottom:14px">' +
        '<input type="text" id="edNewBank" placeholder="e.g. Stoichiometry — my edits" style="flex:1;margin-bottom:0">' +
        '<button class="btn btn-green btn-sm" id="edMakeBank">Create</button></div>' +
        '<label style="font-size:12px">…or an existing bank</label>' +
        TB.banks.map(function (b) {
          return '<button class="btn btn-gray btn-sm" data-tobank="' + b.id + '" style="display:block;width:100%;text-align:left;margin-bottom:5px;justify-content:flex-start">' +
            esc2(b.name) + ' <span style="opacity:.7">(' + b.questions.length + ')</span></button>';
        }).join('') +
        '</div>' +
        '<div style="padding:10px 18px;border-top:1px solid #e8e8f5;text-align:right"><button class="btn btn-gray btn-sm" id="edPickCancel">Cancel</button></div>';
      document.body.appendChild(ov2); document.body.appendChild(box2);
      function close2() { ov2.remove(); box2.remove(); }
      ov2.onclick = close2;
      box2.querySelector('#edPickCancel').addEventListener('click', close2);
      box2.querySelector('#edMakeBank').addEventListener('click', function () {
        var name = box2.querySelector('#edNewBank').value.trim();
        if (!name) return;
        var nb = TB.createBank(name);
        close2();
        commit('copy', nb);
      });
      box2.querySelectorAll('[data-tobank]').forEach(function (b) {
        b.addEventListener('click', function () {
          var target = TB.banks.find(function (x) { return x.id === this.dataset.tobank; }.bind(this));
          close2();
          commit('copy', target);
        });
      });
    }

    draw();
  };

  // Small rows/columns prompt for the Insert Table button
  function askTableSize(onOk) {
    var ov = document.createElement('div');
    ov.style.cssText = 'position:fixed;inset:0;background:rgba(32,29,82,.5);z-index:3400';
    var box = document.createElement('div');
    box.style.cssText = 'position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);width:320px;background:#fff;border-radius:14px;box-shadow:0 20px 60px rgba(32,29,82,.3);z-index:3401;overflow:hidden';
    box.innerHTML =
      '<div style="background:linear-gradient(135deg,#201D52,#3a2875);padding:14px 18px;color:#fff;font-weight:700;font-size:14px">Insert a table</div>' +
      '<div style="padding:16px 18px">' +
      '<div class="row2"><div><label style="font-size:12px">Rows</label><input type="number" id="tblRows" value="3" min="1" max="30"></div>' +
      '<div><label style="font-size:12px">Columns</label><input type="number" id="tblCols" value="3" min="1" max="12"></div></div>' +
      '<div style="font-size:11px;color:#888;margin-bottom:10px">The first row is a header row.</div>' +
      '<div style="display:flex;gap:8px;justify-content:flex-end">' +
      '<button class="btn btn-gray btn-sm" id="tblCancel">Cancel</button>' +
      '<button class="btn btn-indigo btn-sm" id="tblOk">Insert</button></div></div>';
    document.body.appendChild(ov); document.body.appendChild(box);
    function close() { ov.remove(); box.remove(); }
    ov.onclick = close;
    box.querySelector('#tblCancel').onclick = close;
    box.querySelector('#tblOk').onclick = function () {
      var r = Math.max(1, Math.min(30, parseInt(box.querySelector('#tblRows').value, 10) || 3));
      var c = Math.max(1, Math.min(12, parseInt(box.querySelector('#tblCols').value, 10) || 3));
      close(); onOk(r, c);
    };
  }

  // ── Brand new question, written from scratch ────────────────────────────────
  TB.newQuestion = function (bankId, onDone) {
    var bank = TB.banks.find(function (b) { return b.id === bankId; }) || TB.banks[0];
    if (!bank) return;
    var q = {
      uid: TB.nextUid(),
      type: 'MC',
      title: '',
      points: 1,
      html: '',
      answersHtml: ['', '', '', ''],
      answers: ['', '', '', ''],
      correct: [],
      fib_blanks: {},
      bankId: bank.id,
      bankName: bank.name,
      edited: true
    };
    bank.questions.push(q);
    TB.markDirty(bank.id);
    TB.resetIndex();
    TB.openEditor(q.uid, function (mode, b) {
      if (onDone) onDone(mode, b);
    });
  };

})(window);
