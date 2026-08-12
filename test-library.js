// test-library.js
// Batch Genie — Paper Test Builder: your own bank library
//
// A Canvas course export is hundreds of megabytes and holds every bank in the
// course. Once you know which banks you actually use, save them here as small
// standalone .zip files in a folder on your computer — then load just those
// two or three next time instead of the whole course.
//
// Each saved bank is one .zip named after the bank:
//     Question Banks/
//       Test #9 - TEK 8EF - Single Dis identify.zip
//       6D - Lewis Dot Diagrams.zip
//
// Inside a bank zip:
//     _bank.json      the questions, with everything needed to print them
//     images/…        only the pictures those questions use
//
// Chrome can write straight into a folder you pick (File System Access API).
// Where that isn't available the banks download as one zip you unpack yourself.
//
// Depends on: JSZip, TBHtml, test-banks.js.

(function (global) {
  'use strict';

  var TB = global.TestBuilder = global.TestBuilder || {};
  var H = global.TBHtml;

  var BANK_FORMAT = 1;

  TB.canWriteFolders = function () {
    return typeof global.showDirectoryPicker === 'function';
  };

  function safeName(s) {
    // Keep it readable but legal on macOS and Windows
    return String(s || 'Bank')
      .replace(/[\/\\:*?"<>|]/g, '-')
      .replace(/\s+/g, ' ')
      .trim()
      .substring(0, 120) || 'Bank';
  }
  TB.safeBankFileName = safeName;

  // Every image a set of questions refers to, as {id, ref} pairs
  function refsFor(questions) {
    var out = [], seen = {};
    questions.forEach(function (q) {
      var htmls = [q.html || ''].concat(q.answersHtml || [],
        (q.matchPrompts || []).map(function (p) { return p.html || ''; }));
      htmls.forEach(function (h) {
        H.imageRefs(h).forEach(function (ref) {
          var id = ref.kind === 'remote' ? ref.url : ref.path;
          if (seen[id]) return;
          seen[id] = true;
          out.push({ id: id, ref: ref });
        });
      });
    });
    return out;
  }

  // ── Build one bank zip ──────────────────────────────────────────────────────
  TB.buildBankZip = async function (bank, onProgress) {
    var questions = bank.questions || [];
    if (onProgress) onProgress('Collecting images for “' + bank.name + '”…');

    // Make sure every picture these questions need is decoded and cached
    await TB.ensureImages(questions);

    var zip = new JSZip();
    var imgFolder = zip.folder('images');
    var imageMap = {};       // original ref id -> file name inside the zip
    var n = 0;

    refsFor(questions).forEach(function (entry) {
      var url = TB.resolveImage(entry.ref);
      if (!url || url.indexOf('data:') !== 0) return;      // remote-only, keep the URL in the html
      var m = url.match(/^data:([^;]+);base64,(.*)$/);
      if (!m) return;
      var ext = (m[1].split('/')[1] || 'png').replace('jpeg', 'jpg').replace('+xml', '');
      var fname = 'img' + (++n) + '.' + ext;
      imgFolder.file(fname, m[2], { base64: true });
      imageMap[entry.id] = fname;
    });

    var payload = {
      format: BANK_FORMAT,
      name: bank.name,
      kind: bank.kind || 'bank',
      savedAt: new Date().toISOString(),
      source: bank.sourceFile || '',
      imageMap: imageMap,
      questions: questions.map(function (q) {
        return {
          type: q.type,
          title: q.title || '',
          points: q.points,
          html: q.html || '',
          answersHtml: q.answersHtml || [],
          correct: q.correct || [],
          fib_blanks: q.fib_blanks || {},
          matchPrompts: (q.matchPrompts || []).map(function (p) {
            return { html: p.html, correct: p.correct };
          }),
          answers: q.type === 'SA' || q.type === 'NUM' ? (q.answers || []) : [],
          range: q.range || ''
        };
      })
    };
    zip.file('_bank.json', JSON.stringify(payload, null, 1));
    return await zip.generateAsync({ type: 'blob', compression: 'DEFLATE' });
  };

  // ── Save banks into a folder the user picks ────────────────────────────────
  // Returns { saved: n, folder: name } or throws.
  TB.saveBanksToFolder = async function (banks, onProgress) {
    var dir = await global.showDirectoryPicker({ mode: 'readwrite', id: 'batchgenie-banks' });

    var saved = [], failed = [];
    for (var i = 0; i < banks.length; i++) {
      var bank = banks[i];
      if (onProgress) onProgress('Saving ' + (i + 1) + ' of ' + banks.length + ' — ' + bank.name);
      try {
        var blob = await TB.buildBankZip(bank, onProgress);
        var handle = await dir.getFileHandle(safeName(bank.name) + '.zip', { create: true });
        var w = await handle.createWritable();
        await w.write(blob);
        await w.close();
        bank.dirty = false;
        saved.push(bank.name);
      } catch (err) {
        failed.push({ name: bank.name, reason: err.message });
      }
    }
    return { saved: saved, failed: failed, folder: dir.name };
  };

  // Fallback: one download containing a folder of bank zips
  TB.downloadBanksZip = async function (banks, onProgress) {
    var outer = new JSZip();
    var folder = outer.folder('Question Banks');
    for (var i = 0; i < banks.length; i++) {
      if (onProgress) onProgress('Packing ' + (i + 1) + ' of ' + banks.length + ' — ' + banks[i].name);
      var blob = await TB.buildBankZip(banks[i], onProgress);
      folder.file(safeName(banks[i].name) + '.zip', blob);
      banks[i].dirty = false;
    }
    folder.file('README.txt',
      'These are Batch Genie question banks.\n\n' +
      'Unzip this into a "Question Banks" folder somewhere handy. Next time you\n' +
      'build a test, use Load Bank File(s) and pick just the banks you need\n' +
      'instead of the whole course export.\n');
    var out = await outer.generateAsync({ type: 'blob', compression: 'DEFLATE' });
    TB.download(out, 'question-banks.zip');
    return banks.length;
  };

  // ── Reading a saved bank back ───────────────────────────────────────────────
  // Called by test-banks.js when it finds _bank.json in a zip.
  TB.parseSavedBank = async function (zip, filename, newBankId) {
    var f = zip.file('_bank.json');
    if (!f) return null;
    var data = JSON.parse(await f.async('string'));

    var bank = {
      id: newBankId,
      name: data.name || filename.replace(/\.[^.]+$/, ''),
      kind: data.kind === 'quiz' ? 'quiz' : 'bank',
      sourceFile: filename,
      questions: [],
      skipped: {},
      savedImages: {},
      fromLibrary: true
    };

    // Decode this bank's images once — a single bank is small
    var map = data.imageMap || {};
    var mime = { png:'image/png', jpg:'image/jpeg', jpeg:'image/jpeg', gif:'image/gif', bmp:'image/bmp', webp:'image/webp', svg:'image/svg+xml' };
    var ids = Object.keys(map);
    for (var i = 0; i < ids.length; i++) {
      var fname = map[ids[i]];
      var entry = zip.file('images/' + fname);
      if (!entry) continue;
      var ext = fname.split('.').pop().toLowerCase();
      bank.savedImages[ids[i]] = 'data:' + (mime[ext] || 'image/png') + ';base64,' + (await entry.async('base64'));
    }

    bank.questions = (data.questions || []).map(function (q) {
      var copy = {
        uid: TB.nextUid(),
        type: q.type,
        title: q.title || '',
        points: q.points || 1,
        html: q.html || '',
        answersHtml: q.answersHtml || [],
        answers: (q.answers && q.answers.length) ? q.answers.slice() : (q.answersHtml || []).map(function () { return null; }),
        correct: q.correct || [],
        fib_blanks: q.fib_blanks || {},
        range: q.range || '',
        bankId: bank.id,
        bankName: bank.name
      };
      if (q.matchPrompts && q.matchPrompts.length) {
        copy.matchPrompts = q.matchPrompts.map(function (p) { return { html: p.html, correct: p.correct }; });
      }
      // Banks saved before blank renaming existed still carry UUID markers
      if (copy.type === 'FIB' && TB.normalizeFibNames) TB.normalizeFibNames(copy);
      return copy;
    });

    return bank;
  };

  // ── Bank bookkeeping used by the editor ─────────────────────────────────────
  TB.createBank = function (name) {
    var bank = {
      id: TB.nextBankId(),
      name: name || 'New Bank',
      kind: 'bank',
      sourceFile: '(created here)',
      questions: [],
      skipped: {},
      savedImages: {},
      fromLibrary: true,
      dirty: true
    };
    TB.banks.push(bank);
    TB.resetIndex();
    return bank;
  };

  TB.markDirty = function (bankId) {
    var b = TB.banks.find(function (x) { return x.id === bankId; });
    if (b) b.dirty = true;
  };

  TB.dirtyBanks = function () {
    return TB.banks.filter(function (b) { return b.dirty; });
  };

})(window);
