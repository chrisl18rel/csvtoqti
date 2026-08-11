// test-export.js
// Batch Genie — Paper Test Builder: output files
//
// Produces, for a set of generated versions:
//   • .docx   — a real Word file (OOXML written directly with JSZip, no new library)
//   • print   — a print/PDF window (Cmd+P → Save as PDF gives the PDF)
//   • key CSV — plain answer key for your records
//   • ZipGrade CSV — scanner-ready key containing every version in one file
//
// Depends on: JSZip, TestBuilder (test-compose.js), esc() from index.html.

(function (global) {
  'use strict';

  var TB = global.TestBuilder = global.TestBuilder || {};

  function xmlEsc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&apos;');
  }

  function safeFile(s) {
    return String(s || 'test').replace(/[^a-z0-9]+/gi, '_').replace(/^_+|_+$/g, '').toLowerCase() || 'test';
  }

  function download(blob, filename) {
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url; a.download = filename;
    document.body.appendChild(a); a.click();
    URL.revokeObjectURL(url); a.remove();
  }
  TB.download = download;

  // ─────────────────────────────────────────────────────────────────────────────
  // CSV — plain answer key (all versions in one file)
  // ─────────────────────────────────────────────────────────────────────────────
  function csvCellLocal(val) {
    var s = String(val == null ? '' : val);
    return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }

  TB.answerKeyCsv = function (versions, blueprint) {
    var lines = [['Version', 'Question #', 'Section', 'Type', 'Correct Answer', 'Points', 'Bank'].join(',')];
    versions.forEach(function (v) {
      TB.keyRows(v).forEach(function (r) {
        lines.push([v.name, r.number, r.section, r.type, r.answer, r.points, r.bankName].map(csvCellLocal).join(','));
      });
    });
    return lines.join('\n');
  };

  // ─────────────────────────────────────────────────────────────────────────────
  // CSV — ZipGrade key import
  // Format (per ZipGrade docs): Key, Question Number, Response, Point Value
  // One file holds every version. Only bubble-gradable questions are included.
  // ─────────────────────────────────────────────────────────────────────────────
  TB.zipGradeCsv = function (versions) {
    var lines = [['Key', 'Question Number', 'Response/Mapping', 'Point Value'].join(',')];
    var notes = [];

    versions.forEach(function (v) {
      // ZipGrade key versions must be a single character
      var keyChar = String(v.name || 'A').trim().charAt(0).toUpperCase();
      var rows = TB.keyRows(v).filter(function (r) { return TB.isBubbleable(r.type) && r.answer; });

      if (rows.length && rows.some(function (r) { return r.number > 100; })) {
        notes.push('Version ' + v.name + ': questions past #100 were left out — ZipGrade sheets stop at 100.');
      }
      rows.filter(function (r) { return r.number <= 100; }).forEach(function (r) {
        lines.push([keyChar, r.number, r.answer, r.points].map(csvCellLocal).join(','));
      });

      var skipped = TB.keyRows(v).length - rows.length;
      if (skipped > 0) {
        notes.push('Version ' + v.name + ': ' + skipped + ' written-response question(s) are not on the ZipGrade key — grade those by hand.');
      }
    });

    return { csv: lines.join('\n'), notes: notes };
  };

  // ─────────────────────────────────────────────────────────────────────────────
  // Shared rendering helpers
  // ─────────────────────────────────────────────────────────────────────────────

  // Blank writing space for open-response questions
  function blankLinesFor(type) {
    if (type === 'ESSAY') return 6;
    if (type === 'FIB')   return 2;
    if (type === 'SA' || type === 'NUM') return 1;
    return 0;
  }

  function headerLines(blueprint, version) {
    return {
      title: blueprint.title || 'Test',
      subtitle: blueprint.subtitle || '',
      versionLabel: 'Version ' + version.name,
      instructions: blueprint.instructions || ''
    };
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Print / PDF view
  // ─────────────────────────────────────────────────────────────────────────────
  TB.printHtml = function (version, blueprint) {
    var h = headerLines(blueprint, version);
    var out = [];

    out.push('<!DOCTYPE html><html><head><meta charset="utf-8"><title>' +
      esc(h.title) + ' — Version ' + esc(version.name) + '</title><style>' +
      '@page{margin:0.75in}' +
      'body{font-family:Georgia,"Times New Roman",serif;font-size:11.5pt;line-height:1.45;color:#000;margin:0}' +
      '.tHead{border-bottom:2px solid #000;padding-bottom:8px;margin-bottom:14px}' +
      '.tTitle{font-size:16pt;font-weight:700;margin:0}' +
      '.tSub{font-size:11pt;margin:2px 0 0}' +
      '.tMeta{display:flex;justify-content:space-between;font-size:10.5pt;margin-top:10px}' +
      '.tVer{font-weight:700}' +
      '.tInstr{font-style:italic;font-size:10.5pt;margin:10px 0 16px}' +
      '.secHead{font-weight:700;font-size:12pt;margin:18px 0 10px;padding-top:6px;border-top:1px solid #999;page-break-after:avoid}' +
      '.q{margin:0 0 13px;page-break-inside:avoid}' +
      '.qtext{margin:0 0 4px}' +
      '.qnum{font-weight:700;margin-right:6px}' +
      '.choices{margin:2px 0 0 26px}' +
      '.choice{margin:1px 0}' +
      '.cl{font-weight:700;margin-right:6px}' +
      '.qimg{display:block;max-width:75%;max-height:2.6in;margin:6px 0 6px 26px}' +
      '.blank{border-bottom:1px solid #000;height:1.5em;margin:6px 26px 0 26px}' +
      '.foot{margin-top:24px;border-top:1px solid #999;padding-top:6px;font-size:9pt;text-align:center;color:#333}' +
      '@media print{.noprint{display:none}}' +
      '</style></head><body>');

    out.push('<div class="noprint" style="background:#eef2ff;border:1px solid #c7d2fe;border-radius:8px;padding:10px 14px;margin-bottom:16px;font-family:system-ui,sans-serif;font-size:13px">' +
      '<strong>To print or save as PDF:</strong> press Cmd+P, then choose your printer — or "Save as PDF" in the destination menu. ' +
      '<button onclick="window.print()" style="margin-left:10px;padding:6px 14px;border:none;border-radius:6px;background:#6465F1;color:#fff;font-weight:700;cursor:pointer">Print now</button></div>');

    out.push('<div class="tHead"><p class="tTitle">' + esc(h.title) + '</p>' +
      (h.subtitle ? '<p class="tSub">' + esc(h.subtitle) + '</p>' : '') +
      '<div class="tMeta"><span>Name: ______________________________</span>' +
      '<span>Date: ______________</span>' +
      '<span>Period: ______</span>' +
      '<span class="tVer">' + esc(h.versionLabel) + '</span></div></div>');

    if (h.instructions) out.push('<p class="tInstr">' + esc(h.instructions) + '</p>');

    version.sections.forEach(function (sec) {
      if (sec.name) out.push('<p class="secHead">' + esc(sec.name) + '</p>');
      sec.items.forEach(function (item) {
        var q = item.q;
        out.push('<div class="q"><p class="qtext"><span class="qnum">' + item.number + '.</span>' +
          esc(q.body).replace(/\n/g, '<br>') + '</p>');

        var im = TB.imageFor(q);
        if (im) out.push('<img class="qimg" src="data:' + im.mime + ';base64,' + im.data + '">');

        if (item.order && item.order.length && TB.CHOICE_TYPES.indexOf(q.type) !== -1) {
          out.push('<div class="choices">');
          item.order.forEach(function (ci, pos) {
            out.push('<div class="choice"><span class="cl">' + TB.LETTERS[pos] + '.</span>' + esc(q.answers[ci]) + '</div>');
          });
          out.push('</div>');
        }

        var blanks = blankLinesFor(q.type);
        for (var b = 0; b < blanks; b++) out.push('<div class="blank"></div>');

        out.push('</div>');
      });
    });

    out.push('<div class="foot">' + esc(h.title) + ' — Version ' + esc(version.name) +
      ' — ' + version.questionCount + ' questions — ' + version.totalPoints + ' points</div>');
    out.push('</body></html>');
    return out.join('');
  };

  TB.openPrintView = function (version, blueprint) {
    var w = window.open('', '_blank');
    if (!w) return false;
    w.document.write(TB.printHtml(version, blueprint));
    w.document.close();
    return true;
  };

  // ─────────────────────────────────────────────────────────────────────────────
  // .docx  (WordprocessingML written directly — real Word file, no extra library)
  // ─────────────────────────────────────────────────────────────────────────────

  var EMU_PER_PX = 9525;

  function runXml(text, opts) {
    opts = opts || {};
    var rPr = '<w:rPr>' +
      (opts.bold ? '<w:b/>' : '') +
      (opts.italic ? '<w:i/>' : '') +
      (opts.size ? '<w:sz w:val="' + opts.size + '"/><w:szCs w:val="' + opts.size + '"/>' : '') +
      '</w:rPr>';
    // Preserve manual line breaks inside a question body
    var parts = String(text == null ? '' : text).split('\n');
    return parts.map(function (p, i) {
      return (i ? '<w:r>' + rPr + '<w:br/></w:r>' : '') +
        '<w:r>' + rPr + '<w:t xml:space="preserve">' + xmlEsc(p) + '</w:t></w:r>';
    }).join('');
  }

  function paraXml(runs, opts) {
    opts = opts || {};
    var ind = opts.indent ? '<w:ind w:left="' + opts.indent + '"/>' : '';
    var spacing = '<w:spacing w:before="' + (opts.before || 0) + '" w:after="' + (opts.after == null ? 60 : opts.after) + '" w:line="240" w:lineRule="auto"/>';
    var jc = opts.align ? '<w:jc w:val="' + opts.align + '"/>' : '';
    var bdr = opts.topBorder ? '<w:pBdr><w:top w:val="single" w:sz="6" w:color="999999"/></w:pBdr>' : '';
    var keep = opts.keepNext ? '<w:keepNext/>' : '';
    var pageBreak = opts.pageBreakBefore ? '<w:pageBreakBefore/>' : '';
    return '<w:p><w:pPr>' + pageBreak + keep + bdr + spacing + ind + jc + '</w:pPr>' + runs + '</w:p>';
  }

  function imageParaXml(rId, widthPx, heightPx, indent) {
    var cx = Math.round(widthPx * EMU_PER_PX), cy = Math.round(heightPx * EMU_PER_PX);
    return '<w:p><w:pPr><w:ind w:left="' + (indent || 360) + '"/><w:spacing w:after="80"/></w:pPr><w:r><w:drawing>' +
      '<wp:inline distT="0" distB="0" distL="0" distR="0">' +
      '<wp:extent cx="' + cx + '" cy="' + cy + '"/><wp:docPr id="' + (rId.replace(/\D/g, '') || '1') + '" name="Picture ' + rId + '"/>' +
      '<a:graphic xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture">' +
      '<pic:pic xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture">' +
      '<pic:nvPicPr><pic:cNvPr id="0" name="img"/><pic:cNvPicPr/></pic:nvPicPr>' +
      '<pic:blipFill><a:blip r:embed="' + rId + '"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill>' +
      '<pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="' + cx + '" cy="' + cy + '"/></a:xfrm>' +
      '<a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic>' +
      '</a:graphicData></a:graphic></wp:inline></w:drawing></w:r></w:p>';
  }

  // Word needs real pixel dimensions; read them from the base64 image
  function imageSize(mime, b64) {
    return new Promise(function (resolve) {
      var img = new Image();
      img.onload = function () { resolve({ w: img.naturalWidth || 400, h: img.naturalHeight || 300 }); };
      img.onerror = function () { resolve({ w: 400, h: 300 }); };
      img.src = 'data:' + mime + ';base64,' + b64;
    });
  }

  function b64ToUint8(b64) {
    var bin = atob(b64);
    var arr = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
    return arr;
  }

  TB.buildDocx = async function (version, blueprint) {
    var h = headerLines(blueprint, version);
    var body = [];
    var media = [];   // { name, bytes, ext }
    var rels  = [];   // { id, target }
    var relSeq = 1;

    // Header block
    body.push(paraXml(runXml(h.title, { bold: true, size: 32 }), { after: 20 }));
    if (h.subtitle) body.push(paraXml(runXml(h.subtitle, { size: 22 }), { after: 40 }));
    body.push(paraXml(
      runXml('Name: ______________________________     Date: ______________     Period: ______     ', { size: 20 }) +
      runXml('Version ' + version.name, { size: 20, bold: true }),
      { after: 100, topBorder: false }
    ));
    if (h.instructions) body.push(paraXml(runXml(h.instructions, { italic: true, size: 20 }), { after: 140 }));

    for (var si = 0; si < version.sections.length; si++) {
      var sec = version.sections[si];
      if (sec.name) {
        body.push(paraXml(runXml(sec.name, { bold: true, size: 24 }),
          { before: 200, after: 80, topBorder: true, keepNext: true }));
      }

      for (var ii = 0; ii < sec.items.length; ii++) {
        var item = sec.items[ii], q = item.q;

        body.push(paraXml(
          runXml(item.number + '.  ', { bold: true }) + runXml(q.body),
          { after: 40, keepNext: true }
        ));

        var im = TB.imageFor(q);
        if (im) {
          var size = await imageSize(im.mime, im.data);
          var maxW = 430;                       // keeps images inside the margins
          var scale = size.w > maxW ? maxW / size.w : 1;
          var ext = (im.mime.split('/')[1] || 'png').replace('jpeg', 'jpg');
          var rId = 'rId' + (100 + relSeq);
          var name = 'image' + relSeq + '.' + ext;
          relSeq++;
          media.push({ name: name, bytes: b64ToUint8(im.data) });
          rels.push({ id: rId, target: 'media/' + name });
          body.push(imageParaXml(rId, size.w * scale, size.h * scale, 360));
        }

        if (item.order && item.order.length && TB.CHOICE_TYPES.indexOf(q.type) !== -1) {
          for (var ci = 0; ci < item.order.length; ci++) {
            body.push(paraXml(
              runXml(TB.LETTERS[ci] + '.  ', { bold: true }) + runXml(q.answers[item.order[ci]]),
              { indent: 480, after: 20 }
            ));
          }
        }

        var blanks = blankLinesFor(q.type);
        for (var b = 0; b < blanks; b++) {
          body.push(paraXml(runXml('_________________________________________________________'), { indent: 480, after: 40 }));
        }

        body.push(paraXml('', { after: 60 }));
      }
    }

    body.push(paraXml(runXml(h.title + ' — Version ' + version.name + ' — ' +
      version.questionCount + ' questions — ' + version.totalPoints + ' points', { size: 16 }),
      { before: 240, align: 'center', topBorder: true }));

    var documentXml =
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" ' +
      'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" ' +
      'xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" ' +
      'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">' +
      '<w:body>' + body.join('') +
      '<w:sectPr><w:pgSz w:w="12240" w:h="15840"/>' +
      '<w:pgMar w:top="1080" w:right="1080" w:bottom="1080" w:left="1080" w:header="720" w:footer="720" w:gutter="0"/>' +
      '</w:sectPr></w:body></w:document>';

    var contentTypes =
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
      '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
      '<Default Extension="xml" ContentType="application/xml"/>' +
      '<Default Extension="png" ContentType="image/png"/>' +
      '<Default Extension="jpg" ContentType="image/jpeg"/>' +
      '<Default Extension="jpeg" ContentType="image/jpeg"/>' +
      '<Default Extension="gif" ContentType="image/gif"/>' +
      '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
      '</Types>';

    var rootRels =
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>' +
      '</Relationships>';

    var docRels =
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      rels.map(function (r) {
        return '<Relationship Id="' + r.id + '" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="' + r.target + '"/>';
      }).join('') +
      '</Relationships>';

    var zip = new JSZip();
    zip.file('[Content_Types].xml', contentTypes);
    zip.folder('_rels').file('.rels', rootRels);
    var word = zip.folder('word');
    word.file('document.xml', documentXml);
    word.folder('_rels').file('document.xml.rels', docRels);
    if (media.length) {
      var mediaFolder = word.folder('media');
      media.forEach(function (m) { mediaFolder.file(m.name, m.bytes); });
    }

    return await zip.generateAsync({ type: 'blob', compression: 'DEFLATE' });
  };

  // ─────────────────────────────────────────────────────────────────────────────
  // Bundle everything into one zip
  // ─────────────────────────────────────────────────────────────────────────────
  TB.exportAll = async function (versions, blueprint, opts) {
    opts = opts || {};
    var base = safeFile(blueprint.title);
    var zip = new JSZip();

    for (var i = 0; i < versions.length; i++) {
      var v = versions[i];
      var vBase = base + '_version_' + safeFile(v.name);
      if (opts.docx !== false) {
        var blob = await TB.buildDocx(v, blueprint);
        zip.file(vBase + '.docx', blob);
      }
      if (opts.html !== false) {
        zip.file(vBase + '_print.html', TB.printHtml(v, blueprint));
      }
    }

    zip.file(base + '_answer_keys.csv', '﻿' + TB.answerKeyCsv(versions, blueprint));

    var zg = TB.zipGradeCsv(versions);
    zip.file(base + '_zipgrade_key.csv', '﻿' + zg.csv);

    var readme =
      blueprint.title + '\n' +
      '='.repeat((blueprint.title || 'Test').length) + '\n\n' +
      'Versions: ' + versions.map(function (v) { return v.name; }).join(', ') + '\n' +
      'Questions per version: ' + versions.map(function (v) { return v.name + '=' + v.questionCount; }).join(', ') + '\n' +
      'Generated: ' + new Date().toLocaleString() + '\n\n' +
      'FILES\n' +
      '  *.docx              Editable Word copy of each version — print from here.\n' +
      '  *_print.html        Open in a browser and press Cmd+P to print or save as PDF.\n' +
      '  *_answer_keys.csv   Every version\'s key, one row per question.\n' +
      '  *_zipgrade_key.csv  Import into ZipGrade (all versions in this one file).\n\n' +
      (zg.notes.length ? 'NOTES\n  ' + zg.notes.join('\n  ') + '\n' : '');
    zip.file('README.txt', readme);

    var out = await zip.generateAsync({ type: 'blob', compression: 'DEFLATE' });
    download(out, base + '_test_package.zip');
    return zg.notes;
  };

})(window);
