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

  function esc2(s) { return global.esc(s); }

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
    var draft = cloneQ(orig);

    var ov = document.createElement('div');
    ov.style.cssText = 'position:fixed;inset:0;background:rgba(32,29,82,.55);z-index:3200;backdrop-filter:blur(3px)';
    var box = document.createElement('div');
    box.style.cssText = 'position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);width:820px;max-width:96vw;max-height:88vh;background:#fff;border-radius:16px;box-shadow:0 20px 60px rgba(32,29,82,.3);z-index:3201;display:flex;flex-direction:column;overflow:hidden';
    document.body.appendChild(ov);
    document.body.appendChild(box);

    function close() { ov.remove(); box.remove(); }
    ov.onclick = close;

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
      var multi = draft.type === 'MR';
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

        '<label style="font-size:12px">Question text <span style="font-weight:400;color:#888">(plain text is fine; existing formatting and tables are kept)</span></label>' +
        '<textarea id="edBody" style="min-height:90px;font-family:\'DM Mono\',monospace;font-size:12.5px">' + esc2(draft.html) + '</textarea>' +

        '<div style="background:#f4f4fc;border:1px solid #e0e0f0;border-radius:10px;padding:10px 12px;margin-bottom:14px">' +
        '<div style="font-size:11px;font-weight:700;color:#666;margin-bottom:5px">PREVIEW</div>' +
        '<div id="edPreview" style="font-size:13px">' + H.sanitize(draft.html, TB.resolveImage) + '</div></div>' +

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
      var b = box.querySelector('#edBody');
      if (b) draft.html = b.value;
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
      body.addEventListener('input', function () {
        draft.html = this.value;
        box.querySelector('#edPreview').innerHTML = H.sanitize(draft.html, TB.resolveImage);
      });
      // Adding [markers] should surface new blanks straight away
      body.addEventListener('change', function () {
        if (draft.type !== 'FIB') return;
        var found = [], re = /\[([^\]\s]{1,64})\]/g, m;
        while ((m = re.exec(draft.html)) !== null) if (found.indexOf(m[1]) === -1) found.push(m[1]);
        var next = {};
        found.forEach(function (b) { next[b] = draft.fib_blanks[b] || { correct: '', blooket_distractors: [] }; });
        draft.fib_blanks = next;
        readTextInputs();
        draw();
      });

      box.querySelectorAll('.edCorrect').forEach(function (c) {
        c.addEventListener('change', function () {
          var i = +this.dataset.i;
          if (draft.type === 'MR') {
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
        if (global.showAppAlert) global.showAppAlert('Fix these first', '<ul style="margin:0;padding-left:20px">' +
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
