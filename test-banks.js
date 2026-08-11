// test-banks.js
// Batch Genie — Paper Test Builder: question bank loading
//
// Loads question banks from either:
//   • Canvas QTI export .zip  (Course Settings → Export Content → Question bank)
//   • Batch Genie session .zip (produced by "Save Session")
//
// A single .zip may contain several question banks (Canvas puts each bank in its
// own XML file, the way ExamView puts each chapter in its own section). Each XML
// file becomes one bank in the library so you can pull from them independently.
//
// Depends on: JSZip, and parseQtiItem()/qtiDecodeEntities() from index.html.

(function (global) {
  'use strict';

  var TB = global.TestBuilder = global.TestBuilder || {};

  // ── Bank library state ──────────────────────────────────────────────────────
  // banks: [{ id, name, sourceFile, kind, questions: [q], images: {key:{data,mime}} }]
  TB.banks = [];
  var bankSeq = 1;

  function bankId() { return 'bank_' + (bankSeq++); }

  function prettyName(filename) {
    return String(filename || '')
      .replace(/\.[^.]+$/, '')
      .replace(/[_-]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  // Questions that make no sense on a printed test
  function isPrintable(q) {
    return q && q.body && String(q.body).trim() && q.type !== 'FILE';
  }

  // ── Canvas QTI export ───────────────────────────────────────────────────────
  // Returns an array of banks (one per assessment/bank XML file found).
  async function parseCanvasQtiZip(zip, filename) {
    var out = [];

    // Collect images once — they are shared across all XML files in the zip
    var images = {};
    var mimeMap = { png:'image/png', jpg:'image/jpeg', jpeg:'image/jpeg', gif:'image/gif', bmp:'image/bmp', svg:'image/svg+xml' };
    for (var path in zip.files) {
      if (zip.files[path].dir) continue;
      var ext = path.split('.').pop().toLowerCase();
      if (!mimeMap[ext]) continue;
      var b64 = await zip.files[path].async('base64');
      var key = path.replace(/^.*[\/\\]/, '').replace(/\.[^.]+$/, '').replace(/[^a-z0-9_]/gi, '_');
      images[key] = { data: b64, mime: mimeMap[ext], originalName: path };
    }

    // Every XML/QTI file that actually contains <item> elements is a bank
    var xmlPaths = Object.keys(zip.files).filter(function (p) {
      return !zip.files[p].dir && /\.(xml|qti)$/i.test(p) && !/imsmanifest\.xml$/i.test(p) && !/assessment_meta\.xml$/i.test(p);
    }).sort();

    for (var i = 0; i < xmlPaths.length; i++) {
      var xmlText = await zip.files[xmlPaths[i]].async('string');
      if (xmlText.indexOf('<item') === -1) continue;

      // Bank title: <assessment title="..."> or <objectbank> label, else file name
      var titleMatch = xmlText.match(/<assessment[^>]*title="([^"]*)"/);
      var label = titleMatch ? qtiDecodeEntities(titleMatch[1]) : '';
      if (!label) {
        var obMatch = xmlText.match(/<objectbank[^>]*ident="([^"]*)"/);
        label = obMatch ? obMatch[1] : prettyName(xmlPaths[i].replace(/^.*[\/\\]/, ''));
      }

      var questions = [];
      var parts = xmlText.split(/<item\s/);
      for (var j = 1; j < parts.length; j++) {
        var chunk = '<item ' + parts[j];
        var end = chunk.indexOf('</item>');
        if (end === -1) continue;
        var itemXmlStr = chunk.substring(0, end + 7);
        var identMatch = itemXmlStr.match(/^<item\s[^>]*ident="([^"]*)"/);
        if (!identMatch) continue;
        var q;
        try { q = parseQtiItem(identMatch[1], itemXmlStr, images); }
        catch (e) { continue; }
        if (isPrintable(q)) questions.push(q);
      }

      if (questions.length) {
        out.push({
          id: bankId(),
          name: label,
          sourceFile: filename,
          kind: 'canvas',
          questions: questions,
          images: images
        });
      }
    }
    return out;
  }

  // ── Batch Genie session zip ─────────────────────────────────────────────────
  async function parseWorkbenchZip(zip, filename) {
    var wbFile = zip.file('_workbench.json');
    if (!wbFile) return [];
    var wb = JSON.parse(await wbFile.async('string'));
    var questions = (wb.questions || []).filter(isPrintable).map(function (q) {
      return JSON.parse(JSON.stringify(q));
    });
    if (!questions.length) return [];
    return [{
      id: bankId(),
      name: (wb.meta && wb.meta.title) ? wb.meta.title : prettyName(filename),
      sourceFile: filename,
      kind: 'workbench',
      questions: questions,
      images: wb.extractedImages || {}
    }];
  }

  // ── Public: load one or more files ──────────────────────────────────────────
  // Returns { added: [bank], skipped: [{name, reason}] }
  TB.loadBankFiles = async function (fileList) {
    var added = [], skipped = [];

    for (var i = 0; i < fileList.length; i++) {
      var file = fileList[i];
      if (!/\.zip$/i.test(file.name)) {
        skipped.push({ name: file.name, reason: 'not a .zip file' });
        continue;
      }
      if (TB.banks.some(function (b) { return b.sourceFile === file.name; })) {
        skipped.push({ name: file.name, reason: 'already loaded' });
        continue;
      }
      try {
        var ab  = await file.arrayBuffer();
        var zip = await JSZip.loadAsync(ab);

        var banks = await parseWorkbenchZip(zip, file.name);
        if (!banks.length) banks = await parseCanvasQtiZip(zip, file.name);

        if (!banks.length) {
          skipped.push({ name: file.name, reason: 'no questions found — is this a Canvas QTI export or a Batch Genie session zip?' });
          continue;
        }

        // Tag every question with its bank so the browser can show/filter by origin
        banks.forEach(function (b) {
          b.questions.forEach(function (q) {
            q.bankId   = b.id;
            q.bankName = b.name;
            q.uid      = b.id + '_' + q.id;
          });
          TB.banks.push(b);
          added.push(b);
        });
      } catch (err) {
        skipped.push({ name: file.name, reason: err.message });
      }
    }

    return { added: added, skipped: skipped };
  };

  TB.removeBank = function (id) {
    TB.banks = TB.banks.filter(function (b) { return b.id !== id; });
  };

  TB.clearBanks = function () { TB.banks = []; };

  // All questions across every loaded bank
  TB.allQuestions = function () {
    var out = [];
    TB.banks.forEach(function (b) { out = out.concat(b.questions); });
    return out;
  };

  TB.findQuestion = function (uid) {
    var all = TB.allQuestions();
    for (var i = 0; i < all.length; i++) if (all[i].uid === uid) return all[i];
    return null;
  };

  // Image lookup honours the bank the question came from, since two banks can
  // use the same image key for different pictures.
  TB.imageFor = function (q) {
    if (!q || !q.image_ref) return null;
    var bank = TB.banks.find(function (b) { return b.id === q.bankId; });
    if (bank && bank.images && bank.images[q.image_ref]) return bank.images[q.image_ref];
    return null;
  };

})(window);
