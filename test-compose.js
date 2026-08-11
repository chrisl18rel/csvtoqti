// test-compose.js
// Batch Genie — Paper Test Builder: version composition
//
// Turns a test blueprint (sections + options) into finished versions, each with
// its own question order, answer-choice order, and answer key.
//
// Blueprint shape:
// {
//   title, subtitle, instructions,
//   versions: ['A','B','C'],
//   sameQuestionsAllVersions: true,      // false = draw a fresh random set per version
//   scrambleQuestions: true,             // shuffle question order within each section
//   scrambleChoices:   true,             // shuffle answer choices within each question
//   scrambleWholeTest: false,            // ignore section boundaries, shuffle everything
//   sections: [{
//     name: 'Part I — Multiple Choice',
//     count: 20,                         // how many questions this section holds
//     pool: ['uid', ...],                // questions eligible to be drawn
//     required: ['uid', ...]             // must appear in this section on EVERY version
//   }]
// }

(function (global) {
  'use strict';

  var TB = global.TestBuilder = global.TestBuilder || {};

  var CHOICE_TYPES = ['MC', 'MR', 'TF'];
  TB.CHOICE_TYPES = CHOICE_TYPES;
  TB.LETTERS = 'ABCDEFGHIJ'.split('');

  // ── Seeded RNG ──────────────────────────────────────────────────────────────
  // A seed makes a generated test reproducible: same blueprint + same seed gives
  // byte-identical versions, so you can regenerate a lost copy of Version B.
  function makeRng(seed) {
    var s = seed >>> 0 || 1;
    return function () {
      s ^= s << 13; s >>>= 0;
      s ^= s >> 17; s >>>= 0;
      s ^= s << 5;  s >>>= 0;
      return s / 4294967296;
    };
  }
  TB.makeRng = makeRng;

  TB.seedFromString = function (str) {
    var h = 2166136261 >>> 0;
    str = String(str || '');
    for (var i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = Math.imul(h, 16777619) >>> 0;
    }
    return h >>> 0;
  };

  function shuffled(arr, rng) {
    var a = arr.slice();
    for (var i = a.length - 1; i > 0; i--) {
      var j = Math.floor(rng() * (i + 1));
      var t = a[i]; a[i] = a[j]; a[j] = t;
    }
    return a;
  }
  TB.shuffled = shuffled;

  // ── Draw the questions for one section ──────────────────────────────────────
  // Required questions are always included and count toward the section total;
  // the remainder is drawn at random from the pool.
  function drawSection(section, rng, usedUids) {
    var required = (section.required || []).filter(function (uid) { return !usedUids[uid]; });
    var picked = required.slice(0, section.count);
    picked.forEach(function (uid) { usedUids[uid] = true; });

    var remaining = section.count - picked.length;
    if (remaining > 0) {
      var candidates = (section.pool || []).filter(function (uid) { return !usedUids[uid]; });
      var drawn = shuffled(candidates, rng).slice(0, remaining);
      drawn.forEach(function (uid) { usedUids[uid] = true; });
      picked = picked.concat(drawn);
    }
    return picked;
  }

  // ── Choice ordering ─────────────────────────────────────────────────────────
  // Returns an array of indices into q.answers describing display order.
  // Blank choices are dropped. True/False is never scrambled — "False, True"
  // reads as a mistake to students and gains nothing.
  function choiceOrder(q, rng, scramble) {
    if (!q.answers || !q.answers.length) return [];
    if (TB.plainAnswers) TB.plainAnswers(q);
    var idx = [];
    for (var i = 0; i < q.answers.length; i++) {
      if (String(q.answers[i] || '').trim()) idx.push(i);
    }
    if (!scramble || q.type === 'TF' || idx.length < 2) return idx;
    return shuffled(idx, rng);
  }

  // Correct answer, expressed for the printed version
  function answerFor(q, order) {
    if (CHOICE_TYPES.indexOf(q.type) !== -1) {
      var letters = (q.correct || [])
        .map(function (ci) { return order.indexOf(ci); })
        .filter(function (pos) { return pos >= 0; })
        .sort(function (a, b) { return a - b; })
        .map(function (pos) { return TB.LETTERS[pos]; });
      return letters.join('');
    }
    if (q.type === 'FIB') {
      return Object.keys(q.fib_blanks || {})
        .map(function (bid) { return bid + ': ' + ((q.fib_blanks[bid] || {}).correct || ''); })
        .join('; ');
    }
    if (q.type === 'NUM') return String((q.answers && q.answers[0]) || q.suggested_answer || '');
    if (q.type === 'SA')  return (q.answers || []).filter(Boolean).join(' / ');
    if (q.type === 'ESSAY') return q.suggested_answer || '(open response)';
    return q.suggested_answer || '';
  }
  TB.answerFor = answerFor;

  // ── Build every version ─────────────────────────────────────────────────────
  // Returns { versions: [...], warnings: [...] }
  TB.buildVersions = function (blueprint) {
    var warnings = [];
    var names = (blueprint.versions || ['A']).filter(function (n) { return String(n || '').trim(); });
    if (!names.length) names = ['A'];

    var baseSeed = blueprint.seed != null ? blueprint.seed : TB.seedFromString(blueprint.title || 'test');

    // Validate section capacity up front so a short pool is reported, not silently truncated
    (blueprint.sections || []).forEach(function (s, i) {
      var label = s.name || ('Section ' + (i + 1));
      var poolSize = (s.pool || []).length;
      if (poolSize < s.count) {
        warnings.push('"' + label + '" wants ' + s.count + ' questions but only ' + poolSize + ' are available — it will be short.');
      }
      if ((s.required || []).length > s.count) {
        warnings.push('"' + label + '" has more required questions (' + (s.required || []).length + ') than its size (' + s.count + ') — extras were dropped.');
      }
    });

    // When every version holds the same questions, draw once and reuse.
    var sharedPick = null;
    if (blueprint.sameQuestionsAllVersions) {
      var pickRng = makeRng(baseSeed);
      var used = {};
      sharedPick = (blueprint.sections || []).map(function (s) { return drawSection(s, pickRng, used); });
    }

    var versions = names.map(function (vName, vIdx) {
      // Each version gets its own RNG stream so version B never mirrors A
      var rng = makeRng(baseSeed + (vIdx + 1) * 7919);

      var picks;
      if (sharedPick) {
        picks = sharedPick.map(function (arr) { return arr.slice(); });
      } else {
        var used2 = {};
        picks = (blueprint.sections || []).map(function (s) { return drawSection(s, rng, used2); });
      }

      var sections = (blueprint.sections || []).map(function (s, si) {
        var uids = picks[si] || [];
        if (blueprint.scrambleQuestions) uids = shuffled(uids, rng);
        var qs = uids.map(function (uid) {
          var q = TB.findQuestion(uid);
          if (!q) return null;
          var order = choiceOrder(q, rng, blueprint.scrambleChoices);
          var pts = (s.pointsEach !== '' && s.pointsEach != null) ? parseFloat(s.pointsEach) : (parseFloat(q.points) || 1);
          return { q: q, order: order, answer: answerFor(q, order), points: pts };
        }).filter(Boolean);
        return { name: s.name || ('Section ' + (si + 1)), items: qs };
      });

      // "Scramble the whole test" flattens sections into one running list
      if (blueprint.scrambleWholeTest) {
        var flat = [];
        sections.forEach(function (sec) { flat = flat.concat(sec.items); });
        sections = [{ name: '', items: shuffled(flat, rng) }];
      }

      // Number questions consecutively across the whole test, ExamView-style
      var n = 0, totalPoints = 0;
      sections.forEach(function (sec) {
        sec.startNum = n + 1;
        sec.items.forEach(function (item) {
          // Text blocks are instructions, not questions — they aren't numbered
          if (item.q.type === 'TEXT') { item.number = null; return; }
          item.number = ++n;
          totalPoints += (item.points != null ? item.points : (parseFloat(item.q.points) || 0));
        });
        sec.endNum = n;
      });

      return {
        name: vName,
        sections: sections,
        questionCount: n,
        totalPoints: Math.round(totalPoints * 100) / 100
      };
    });

    return { versions: versions, warnings: warnings };
  };

  // ── Answer keys ─────────────────────────────────────────────────────────────
  // Flat list per version: [{ number, type, answer, points, bankName }]
  TB.keyRows = function (version) {
    var rows = [];
    version.sections.forEach(function (sec) {
      sec.items.forEach(function (item) {
        if (item.q.type === 'TEXT') return;
        rows.push({
          number: item.number,
          type: item.q.type,
          answer: item.answer,
          points: item.points != null ? item.points : (parseFloat(item.q.points) || 1),
          bankName: item.q.bankName || '',
          section: sec.name || ''
        });
      });
    });
    return rows;
  };

  // Questions a bubble sheet can actually grade
  TB.isBubbleable = function (type) { return CHOICE_TYPES.indexOf(type) !== -1; };

})(window);
