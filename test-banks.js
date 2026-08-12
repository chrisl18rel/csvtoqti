// test-banks.js
// Batch Genie — Paper Test Builder: question bank loading
//
// Reads Canvas exports and pulls out every question bank and quiz:
//   • .imscc — a full course export (Settings → Export Course Content → Course).
//     This is the file that contains your question banks.
//   • .zip   — a Canvas QTI quiz export, or a Batch Genie "Save Session" zip.
//
// A course export is big (hundreds of MB) and holds thousands of images, so
// images are NOT decoded at load time. We keep the archive open and pull out
// only the pictures a question actually needs, when it needs them. Loading is
// therefore fast and memory stays reasonable.
//
// Depends on: JSZip, TBHtml (test-html.js).

(function (global) {
  'use strict';

  var TB = global.TestBuilder = global.TestBuilder || {};
  var H = global.TBHtml;

  TB.banks = [];
  var bankSeq = 1, qSeq = 1;

  // Canvas question types we can put on a printed test
  var TYPE_MAP = {
    multiple_choice_question: 'MC',
    true_false_question: 'TF',
    multiple_answers_question: 'MR',
    numerical_question: 'NUM',
    short_answer_question: 'SA',
    fill_in_multiple_blanks_question: 'FIB',
    fill_in_the_blank_question: 'SA',
    essay_question: 'ESSAY',
    text_only_question: 'TEXT',
    matching_question: 'MATCH'
  };
  // Hot spot needs clicking on an image and ordering needs drag targets, so
  // neither survives the trip to paper. Counted and reported, never half-drawn.
  var UNSUPPORTED = { hot_spot_question: 1, ordering_question: 1, file_upload_question: 1, calculated_question: 1 };

  TB.TYPE_MAP = TYPE_MAP;

  // Canvas names each blank with a UUID, which is unreadable in the question
  // text and in the editor. Rename them blank1, blank2… in the order they
  // appear in the *body*, because the body is what the teacher sees and edits.
  // Answers are matched by name where the names line up and by position where
  // they don't, so a mismatch between the markers and the scoring rules can't
  // leave the text and the answer list disagreeing.
  function uglyName(name) {
    return !name || name.length > 20 || /^[0-9a-f]{8}-[0-9a-f]{4}-/i.test(name);
  }
  TB.uglyBlankName = uglyName;

  TB.normalizeFibNames = function (q) {
    if (!q || q.type !== 'FIB') return q;
    var html = q.html || '';
    var markers = [], re = /\[([^\]\s]{1,64})\]/g, m;
    while ((m = re.exec(html)) !== null) {
      if (markers.indexOf(m[1]) === -1) markers.push(m[1]);
    }
    var oldKeys = Object.keys(q.fib_blanks || {});
    if (!markers.length) return q;

    // Strip any prefix our own exporter added, then decide name-by-name
    var byName = {};
    oldKeys.forEach(function (k) { byName[k.replace(/^q\d+_/, '')] = q.fib_blanks[k]; });

    var next = {};
    markers.forEach(function (marker, i) {
      // Batch Genie's own QTI export prefixes blank names with q<number>_ to
      // keep them unique across a quiz; that prefix is noise when read back.
      var pretty = marker.replace(/^q\d+_/, '') || marker;
      if (uglyName(pretty)) pretty = 'blank' + (i + 1);
      // Prefer the answer stored under this marker's own name; fall back to
      // whatever sat in the same position in the scoring rules.
      var entry = byName[marker] || byName[marker.replace(/^q\d+_/, '')] ||
                  q.fib_blanks[oldKeys[i]] || { correct: '', blooket_distractors: [] };
      next[pretty] = entry;
      if (pretty !== marker) {
        html = html.split('[' + marker + ']').join('[' + pretty + ']');
      }
    });

    q.fib_blanks = next;
    q.html = html;
    delete q._plain;
    return q;
  };

  TB.nextUid    = function () { return 'q' + (qSeq++); };
  TB.nextBankId = function () { return 'bank_' + (bankSeq++); };

  function decodeEntities(s) { return H.decode(s); }

  function firstMatch(str, re) { var m = str.match(re); return m ? m[1] : ''; }

  // Cheap plain text for short answer labels. A course export has tens of
  // thousands of these; routing each through the DOM parser is far too slow.
  function quickText(x) {
    return decodeEntities(String(x || '')).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
  }

  // ── One <item> → question object ────────────────────────────────────────────
  function parseItem(itemXml, bank) {
    var rawType = firstMatch(itemXml, /<fieldlabel>\s*question_type\s*<\/fieldlabel>\s*<fieldentry>\s*([^<]+?)\s*<\/fieldentry>/);
    if (!rawType || UNSUPPORTED[rawType]) return { skipped: rawType || 'unknown' };
    var type = TYPE_MAP[rawType];
    if (!type) return { skipped: rawType };

    var ptsRaw = firstMatch(itemXml, /<fieldlabel>\s*points_possible\s*<\/fieldlabel>\s*<fieldentry>\s*([^<]+?)\s*<\/fieldentry>/);
    var points = parseFloat(ptsRaw);
    if (!isFinite(points) || points <= 0) points = 1;

    var title = decodeEntities(firstMatch(itemXml, /^<item\s[^>]*title="([^"]*)"/));

    var presXml = firstMatch(itemXml, /<presentation[^>]*>([\s\S]*?)<\/presentation>/);
    // The prompt is the first <material><mattext> inside <presentation>
    var bodyHtml = decodeEntities(firstMatch(presXml, /<material[^>]*>\s*<mattext[^>]*>([\s\S]*?)<\/mattext>/));

    var q = {
      uid: 'q' + (qSeq++),
      type: type,
      title: title === 'Question' ? '' : title,
      points: points,
      html: bodyHtml,
      answers: [],
      answersHtml: [],
      correct: [],
      fib_blanks: {},
      bankId: bank.id,
      bankName: bank.name
    };

    if (type === 'TEXT') return { q: q };

    // Choices, keyed by their Canvas ident (a UUID in real exports).
    // MATCH collects its own choices below, since they repeat per prompt.
    var labelMap = {}, idx = 0;
    var labelRe = /<response_label\s+ident="([^"]+)"[^>]*>[\s\S]*?<mattext[^>]*>([\s\S]*?)<\/mattext>/g, lm;
    while (type !== 'MATCH' && (lm = labelRe.exec(presXml)) !== null) {
      var html = decodeEntities(lm[2]);
      q.answersHtml.push(html);
      q.answers.push(null);            // filled lazily by TB.plainAnswers()
      labelMap[lm[1].trim()] = idx++;
    }

    var respXml = firstMatch(itemXml, /<resprocessing>([\s\S]*?)<\/resprocessing>/);

    if (type === 'MC' || type === 'TF') {
      // The winning condition is the one that sets a non-zero score
      var best = null;
      var condRe = /<respcondition[^>]*>([\s\S]*?)<\/respcondition>/g, cm;
      while ((cm = condRe.exec(respXml)) !== null) {
        var setv = cm[1].match(/<setvar[^>]*>([\d.]+)<\/setvar>/);
        if (setv && parseFloat(setv[1]) > 0) { best = cm[1]; break; }
      }
      var lid = firstMatch(best || respXml, /<varequal[^>]*>([^<]+)<\/varequal>/).trim();
      if (labelMap[lid] !== undefined) q.correct = [labelMap[lid]];
    } else if (type === 'MR') {
      var scored = null, condRe2 = /<respcondition[^>]*>([\s\S]*?)<\/respcondition>/g, cm2;
      while ((cm2 = condRe2.exec(respXml)) !== null) {
        var sv = cm2[1].match(/<setvar[^>]*>([\d.]+)<\/setvar>/);
        if (sv && parseFloat(sv[1]) > 0) { scored = cm2[1]; break; }
      }
      // Wrong choices sit inside <not> blocks — drop those first
      var positive = (scored || respXml).replace(/<not>[\s\S]*?<\/not>/g, '');
      var veRe = /<varequal[^>]*>([^<]+)<\/varequal>/g, vm;
      while ((vm = veRe.exec(positive)) !== null) {
        var id2 = vm[1].trim();
        if (labelMap[id2] !== undefined && q.correct.indexOf(labelMap[id2]) === -1) q.correct.push(labelMap[id2]);
      }
    } else if (type === 'NUM') {
      var gte = firstMatch(respXml, /<vargte[^>]*>([^<]+)<\/vargte>/) || firstMatch(respXml, /<vargt[^>]*>([^<]+)<\/vargt>/);
      var lte = firstMatch(respXml, /<varlte[^>]*>([^<]+)<\/varlte>/) || firstMatch(respXml, /<varlt[^>]*>([^<]+)<\/varlt>/);
      var eq  = firstMatch(respXml, /<varequal[^>]*>([^<]+)<\/varequal>/);
      if (eq) q.answers = [eq.trim()];
      else if (gte && lte) {
        var lo = parseFloat(gte), hi = parseFloat(lte);
        // Canvas stores a tolerance range; show the midpoint as the answer
        var mid = (lo + hi) / 2;
        q.answers = [isFinite(mid) ? String(parseFloat(mid.toFixed(6))) : (gte + '–' + lte)];
        q.range = '[' + gte.trim() + ', ' + lte.trim() + ']';
      }
    } else if (type === 'SA') {
      var seen = {}, veRe2 = /<varequal[^>]*>([^<]+)<\/varequal>/g, vm2;
      while ((vm2 = veRe2.exec(respXml)) !== null) {
        var v = decodeEntities(vm2[1].trim());
        if (v && !seen[v]) { seen[v] = 1; q.answers.push(v); }
      }
    } else if (type === 'MATCH') {
      // Canvas stores one <response_lid> per left-hand prompt; each repeats the
      // same right-hand choice list. On paper that becomes a lettered choice
      // bank plus one numbered blank per prompt.
      q.matchPrompts = [];
      var choiceIdent = [], choiceSeen = {};
      var lidRe = /<response_lid\s+ident="([^"]+)"[^>]*>([\s\S]*?)<\/response_lid>/g, lidm;
      while ((lidm = lidRe.exec(presXml)) !== null) {
        var lidIdent = lidm[1], inner = lidm[2];
        var promptHtml = decodeEntities(firstMatch(inner, /<material[^>]*>\s*<mattext[^>]*>([\s\S]*?)<\/mattext>/));
        q.matchPrompts.push({ ident: lidIdent, html: promptHtml, correct: -1 });
        var clRe = /<response_label\s+ident="([^"]+)"[^>]*>[\s\S]*?<mattext[^>]*>([\s\S]*?)<\/mattext>/g, clm;
        while ((clm = clRe.exec(inner)) !== null) {
          if (choiceSeen[clm[1]]) continue;
          choiceSeen[clm[1]] = true;
          choiceIdent.push(clm[1]);
          q.answersHtml.push(decodeEntities(clm[2]));
          q.answers.push(null);
        }
      }
      // resprocessing maps each prompt ident to the ident of its correct choice
      var mRe = /<varequal\s+respident="([^"]+)"[^>]*>([^<]+)<\/varequal>/g, mm2;
      var pairMap = {};
      while ((mm2 = mRe.exec(respXml)) !== null) pairMap[mm2[1]] = mm2[2].trim();
      q.matchPrompts.forEach(function (pr) {
        var target = pairMap[pr.ident];
        var ci = choiceIdent.indexOf(target);
        if (ci !== -1) pr.correct = ci;
      });
      // A prompt with no resolvable answer is dropped rather than printed blank
      q.matchPrompts = q.matchPrompts.filter(function (pr) { return pr.correct >= 0 && (pr.html || '').trim(); });
      if (!q.matchPrompts.length) return { skipped: 'matching_question' };
    } else if (type === 'FIB') {
      // Canvas keeps each blank in its own <response_lid ident="response_X">.
      // The scoring rule names the *answer id*, and the answer text lives in a
      // <response_label> inside that blank — so resolve id → text, otherwise the
      // answer key comes out full of UUIDs.
      var blankOrder = [], labelText = {};
      var lidRe2 = /<response_lid\s+ident="([^"]+)"[^>]*>([\s\S]*?)<\/response_lid>/g, lm2;
      while ((lm2 = lidRe2.exec(presXml)) !== null) {
        blankOrder.push(lm2[1]);
        var lrRe = /<response_label[^>]*\sident="([^"]+)"[^>]*>[\s\S]*?<mattext[^>]*>([\s\S]*?)<\/mattext>/g, lr;
        while ((lr = lrRe.exec(lm2[2])) !== null) {
          labelText[lr[1].trim()] = quickText(lr[2]);
        }
      }
      // Older/simpler exports use <response_str> per blank instead
      if (!blankOrder.length) {
        var rsRe = /<response_str\s+ident="([^"]+)"/g, rm;
        while ((rm = rsRe.exec(presXml)) !== null) blankOrder.push(rm[1]);
      }

      var ansMap = {};
      var condRe3 = /<respcondition[^>]*>([\s\S]*?)<\/respcondition>/g, cm3;
      while ((cm3 = condRe3.exec(respXml)) !== null) {
        var block = cm3[1];
        var sv3 = block.match(/<setvar[^>]*>([\d.]+)<\/setvar>/);
        if (sv3 && parseFloat(sv3[1]) <= 0) continue;
        var pair = block.match(/<varequal\s+respident="([^"]+)"[^>]*>([^<]+)<\/varequal>/);
        if (!pair) continue;
        var respId = pair[1], val = decodeEntities(pair[2].trim());
        if (ansMap[respId]) continue;
        var text = labelText[val];
        if (text === undefined) text = labelText[val + '-0'];        // some exports omit the suffix
        if (text === undefined) {                                     // or add one we don't expect
          var pref = Object.keys(labelText).filter(function (k) { return k.indexOf(val) === 0; });
          if (pref.length) text = labelText[pref[0]];
        }
        // If it still only resolves to an internal id, leave it blank rather
        // than printing a UUID onto an answer key.
        if (text === undefined) text = /^[0-9a-f]{8}-[0-9a-f]{4}-/i.test(val) ? '' : val;
        ansMap[respId] = text;
      }

      blankOrder.forEach(function (b) {
        var clean = b.replace(/^response_/, '');
        q.fib_blanks[clean] = { correct: ansMap[b] || ansMap[clean] || '', blooket_distractors: [] };
      });
      TB.normalizeFibNames(q);
    }

    return { q: q };
  }

  // ── One QTI file → one bank ─────────────────────────────────────────────────
  function parseQtiFile(xmlText, fallbackName, bankKind) {
    var name = decodeEntities(
      firstMatch(xmlText, /<fieldlabel>\s*bank_title\s*<\/fieldlabel>\s*<fieldentry>\s*([^<]*?)\s*<\/fieldentry>/) ||
      firstMatch(xmlText, /<assessment[^>]*title="([^"]*)"/)
    ) || fallbackName;

    var kind = xmlText.indexOf('<objectbank') !== -1 ? 'bank' : (bankKind || 'quiz');

    var bank = { id: 'bank_' + (bankSeq++), name: name, kind: kind, questions: [], skipped: {} };

    var parts = xmlText.split(/<item\s/);
    for (var i = 1; i < parts.length; i++) {
      var chunk = '<item ' + parts[i];
      var end = chunk.indexOf('</item>');
      if (end === -1) continue;
      var res;
      try { res = parseItem(chunk.substring(0, end + 7), bank); }
      catch (e) { continue; }
      if (res.skipped) { bank.skipped[res.skipped] = (bank.skipped[res.skipped] || 0) + 1; continue; }
      if (res.q && (res.q.html || '').trim()) bank.questions.push(res.q);
    }
    return bank;
  }

  // ── Image index: map a FILEBASE path to an entry in the archive ─────────────
  function buildImageIndex(zip) {
    var index = {};
    Object.keys(zip.files).forEach(function (p) {
      if (zip.files[p].dir) return;
      if (!/\.(png|jpe?g|gif|bmp|svg|webp)$/i.test(p)) return;
      index[p.toLowerCase()] = p;
      // Course exports put media under web_resources/, but questions reference
      // it without that prefix
      index[p.replace(/^web_resources\//i, '').toLowerCase()] = p;
      index[p.replace(/^.*\//, '').toLowerCase()] = p;   // bare filename fallback
    });
    return index;
  }

  var MIME = { png:'image/png', jpg:'image/jpeg', jpeg:'image/jpeg', gif:'image/gif', bmp:'image/bmp', svg:'image/svg+xml', webp:'image/webp' };

  // ── Public: load files ──────────────────────────────────────────────────────
  // onProgress(text) is called as work proceeds — these archives are large.
  TB.loadBankFiles = async function (fileList, onProgress) {
    var added = [], skipped = [], report = { unsupported: {} };

    for (var i = 0; i < fileList.length; i++) {
      var file = fileList[i];
      if (!/\.(zip|imscc)$/i.test(file.name)) {
        skipped.push({ name: file.name, reason: 'not a .zip or .imscc file' });
        continue;
      }
      if (TB.banks.some(function (b) { return b.sourceFile === file.name; })) {
        skipped.push({ name: file.name, reason: 'already loaded' });
        continue;
      }
      try {
        if (onProgress) onProgress('Reading ' + file.name + ' (' + Math.round(file.size / 1048576) + ' MB)…');
        var ab = await file.arrayBuffer();
        var zip = await JSZip.loadAsync(ab);
        var imageIndex = buildImageIndex(zip);

        var banks = [];

        // A bank saved from this app's own library?
        if (zip.file('_bank.json') && TB.parseSavedBank) {
          var savedBank = await TB.parseSavedBank(zip, file.name, TB.nextBankId());
          if (savedBank && savedBank.questions.length) banks.push(savedBank);
        }

        // Batch Genie session?
        var wbFile = banks.length ? null : zip.file('_workbench.json');
        if (wbFile) {
          var wb = JSON.parse(await wbFile.async('string'));
          var b = { id: 'bank_' + (bankSeq++), name: (wb.meta && wb.meta.title) || file.name.replace(/\.[^.]+$/, ''), kind: 'session', questions: [], skipped: {} };
          (wb.questions || []).forEach(function (q) {
            var copy = JSON.parse(JSON.stringify(q));
            copy.uid = 'q' + (qSeq++);
            copy.html = copy.body || '';
            copy.answersHtml = (copy.answers || []).slice();
            copy.answers = copy.answersHtml.map(function () { return null; });
            copy.bankId = b.id; copy.bankName = b.name;
            if (copy.type !== 'FILE') b.questions.push(copy);
          });
          if (b.questions.length) banks.push(b);
          // session images are already base64 in the json
          b.inlineImages = wb.extractedImages || {};
        } else if (!banks.length) {
          var qtiPaths = Object.keys(zip.files).filter(function (p) {
            return !zip.files[p].dir && /\.(qti|xml)$/i.test(p) &&
              !/imsmanifest\.xml$/i.test(p) && !/assessment_meta\.xml$/i.test(p) &&
              !/^course_settings\//i.test(p);
          }).sort();

          for (var j = 0; j < qtiPaths.length; j++) {
            if (onProgress && j % 50 === 0) onProgress('Scanning question banks… ' + j + ' / ' + qtiPaths.length);
            var text = await zip.files[qtiPaths[j]].async('string');
            if (text.indexOf('<item ') === -1) continue;
            var bk = parseQtiFile(text, qtiPaths[j].replace(/^.*\//, '').replace(/\.[^.]+$/, ''));
            if (bk.questions.length) banks.push(bk);
            Object.keys(bk.skipped).forEach(function (k) {
              report.unsupported[k] = (report.unsupported[k] || 0) + bk.skipped[k];
            });
          }
        }

        if (!banks.length) {
          skipped.push({ name: file.name, reason: 'no usable questions found' });
          continue;
        }

        banks.forEach(function (b2) {
          b2.sourceFile = file.name;
          b2.zip = zip;                 // kept open for lazy image reads
          b2.imageIndex = imageIndex;
          b2.imageCache = {};
          b2.questions.forEach(function (q) { q.bankId = b2.id; q.bankName = b2.name; });
          TB.banks.push(b2);
          added.push(b2);
        });
      } catch (err) {
        skipped.push({ name: file.name, reason: err.message });
      }
    }

    return { added: added, skipped: skipped, report: report };
  };

  TB.removeBank = function (id) { TB.banks = TB.banks.filter(function (b) { return b.id !== id; }); };
  TB.clearBanks = function () { TB.banks = []; };

  TB.allQuestions = function () {
    var out = [];
    TB.banks.forEach(function (b) { out = out.concat(b.questions); });
    return out;
  };

  var uidIndex = null;
  TB.findQuestion = function (uid) {
    if (!uidIndex || uidIndex.__n !== TB.banks.length) {
      uidIndex = { __n: TB.banks.length };
      TB.allQuestions().forEach(function (q) { uidIndex[q.uid] = q; });
    }
    return uidIndex[uid] || null;
  };
  TB.resetIndex = function () { uidIndex = null; };

  function bankOf(q) {
    return TB.banks.find(function (b) { return b.id === q.bankId; });
  }

  // ── Lazy image loading ──────────────────────────────────────────────────────
  // Returns a data: URL for a local image, or '' if it isn't in the archive.
  TB.loadImageRef = async function (q, ref) {
    var bank = bankOf(q);
    if (!bank) return '';

    // Banks saved to your library travel with their own pictures
    if (bank.savedImages) {
      var sid = ref.kind === 'remote' ? ref.url : ref.path;
      if (bank.savedImages[sid]) return bank.savedImages[sid];
    }

    if (ref.kind === 'remote') {
      // Many question images point at absolute Canvas URLs that need a login,
      // but the export ships the same file. Match it by name so the picture
      // still appears — in Word especially, where a URL is useless.
      var guess = '';
      if (ref.alt && /\.(png|jpe?g|gif|bmp|webp)$/i.test(ref.alt)) guess = ref.alt;
      if (!guess) {
        var tail = String(ref.url || '').split('?')[0].split('/').pop() || '';
        if (/\.(png|jpe?g|gif|bmp|webp)$/i.test(tail)) guess = tail;
      }
      if (guess) {
        var gk = guess.toLowerCase();
        if (bank.imageCache[gk]) return bank.imageCache[gk];
        var gpath = bank.imageIndex[gk] || bank.imageIndex['uploaded media/' + gk] || bank.imageIndex['assessment_questions/' + gk];
        if (gpath && bank.zip && bank.zip.files[gpath]) {
          var gext = gpath.split('.').pop().toLowerCase();
          var gb64 = await bank.zip.files[gpath].async('base64');
          var gurl = 'data:' + (MIME[gext] || 'image/png') + ';base64,' + gb64;
          bank.imageCache[gk] = gurl;
          return gurl;
        }
      }
      return ref.url;                                // fall back to the live URL
    }

    var key = String(ref.path || '').toLowerCase();
    if (bank.imageCache[key]) return bank.imageCache[key];

    // Session zips keep images inline
    if (bank.inlineImages) {
      var direct = bank.inlineImages[ref.path] || bank.inlineImages[ref.path.replace(/\.[^.]+$/, '')];
      if (direct) {
        var url0 = 'data:' + direct.mime + ';base64,' + direct.data;
        bank.imageCache[key] = url0;
        return url0;
      }
    }

    var path = bank.imageIndex[key] ||
               bank.imageIndex[key.replace(/^web_resources\//, '')] ||
               bank.imageIndex[key.replace(/^.*\//, '')];
    if (!path || !bank.zip || !bank.zip.files[path]) return '';

    var ext = path.split('.').pop().toLowerCase();
    var b64 = await bank.zip.files[path].async('base64');
    var url = 'data:' + (MIME[ext] || 'image/png') + ';base64,' + b64;
    bank.imageCache[key] = url;
    return url;
  };

  // Pull in every image a set of questions needs, so rendering can be synchronous
  TB.ensureImages = async function (questions, onProgress) {
    var resolved = {};
    for (var i = 0; i < questions.length; i++) {
      var q = questions[i];
      if (onProgress && i % 10 === 0) onProgress('Loading images… ' + i + ' / ' + questions.length);
      var htmls = [q.html || ''].concat(q.answersHtml || []);
      for (var j = 0; j < htmls.length; j++) {
        var refs = H.imageRefs(htmls[j]);
        for (var k = 0; k < refs.length; k++) {
          var ref = refs[k];
          var id = ref.kind === 'remote' ? ref.url : ref.path;
          if (resolved[id] !== undefined) continue;
          resolved[id] = await TB.loadImageRef(q, ref);
        }
      }
    }
    TB.imageUrls = Object.assign(TB.imageUrls || {}, resolved);
    return TB.imageUrls;
  };

  TB.imageUrls = {};

  // ── Lazy plain text ─────────────────────────────────────────────────────────
  // A course export holds ~36,000 HTML fragments. Converting them all to plain
  // text at load time costs many seconds, and most are never looked at, so the
  // conversion happens on first use and is cached on the question.
  TB.plain = function (q) {
    if (q._plain == null) q._plain = H.toPlain(q.html || '');
    return q._plain;
  };

  TB.plainAnswers = function (q) {
    if (!q._plainAns) {
      q._plainAns = (q.answersHtml || []).map(function (a) { return H.toPlain(a); });
      q.answers = q.answers.map(function (v, i) { return v == null ? q._plainAns[i] : v; });
    }
    return q._plainAns;
  };

  // Synchronous resolver used while rendering (after ensureImages has run)
  TB.resolveImage = function (ref) {
    var id = ref.kind === 'remote' ? ref.url : ref.path;
    return TB.imageUrls[id] || (ref.kind === 'remote' ? ref.url : '');
  };

})(window);
