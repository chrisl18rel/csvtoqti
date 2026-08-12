// test-html.js
// Batch Genie — Paper Test Builder: HTML handling
//
// Canvas question bodies are real HTML: data tables, superscripts and
// subscripts, bold, lists, and images. Flattening that to plain text would
// wreck a chemistry test (an isotope table would become a run-on sentence),
// so both the print view and the Word file render the markup instead.
//
// This module provides:
//   decode()      — unescape the entity-encoded HTML stored in <mattext>
//   toPlain()     — plain text, for previews and searching
//   imageRefs()   — every image the body needs
//   sanitize()    — safe HTML for the print view, with image sources rewritten
//   toOoxml()     — the same content as WordprocessingML for the .docx

(function (global) {
  'use strict';

  var H = global.TBHtml = {};

  // ── Entity decoding ─────────────────────────────────────────────────────────
  var NAMED = { amp:'&', lt:'<', gt:'>', quot:'"', apos:"'", nbsp:' ', ndash:'–', mdash:'—', hellip:'…', deg:'°', times:'×', rsquo:'\u2019', lsquo:'\u2018', ldquo:'\u201C', rdquo:'\u201D' };
  // Hot path: a course export decodes tens of thousands of fragments, so this
  // avoids touching the DOM unless an unusual entity actually shows up.
  H.decode = function (s) {
    if (!s) return '';
    s = String(s);
    if (s.indexOf('&') === -1) return s;
    return s.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, function (m, ent) {
      if (ent.charAt(0) === '#') {
        var code = ent.charAt(1) === 'x' || ent.charAt(1) === 'X'
          ? parseInt(ent.slice(2), 16) : parseInt(ent.slice(1), 10);
        return isFinite(code) ? String.fromCodePoint(code) : m;
      }
      var v = NAMED[ent.toLowerCase()];
      if (v !== undefined) return v;
      var t = document.createElement('textarea');
      t.innerHTML = m;
      return t.value;
    });
  };

  H.parse = function (htmlStr) {
    var root = new DOMParser().parseFromString('<div>' + (htmlStr || '') + '</div>', 'text/html').body.firstChild;
    normalizeSubscripts(root);
    return root;
  };

  // Some questions were authored with a shrunken font instead of a real
  // subscript tag — "H<span style='font-size:8pt'>2</span>SO4". Narrowly
  // convert those (small font, one to three digits) into true subscripts so
  // formulas print as H₂SO₄. Anything longer or non-numeric is left alone.
  function normalizeSubscripts(root) {
    var spans = root.querySelectorAll ? root.querySelectorAll('span[style]') : [];
    for (var i = 0; i < spans.length; i++) {
      var sp = spans[i];
      var st = sp.getAttribute('style') || '';
      var m = st.match(/font-size:\s*([0-9.]+)\s*pt/i);
      var small = (m && parseFloat(m[1]) <= 9) || /font-size:\s*(x-small|xx-small)/i.test(st);
      if (!small) continue;
      var txt = (sp.textContent || '');
      if (!/^\s*[0-9+\-\u2212]{1,3}\s*$/.test(txt)) continue;
      var sub = sp.ownerDocument.createElement('sub');
      sub.textContent = txt.trim();
      if (/\s$/.test(txt)) sub.insertAdjacentText('afterend', ' ');
      sp.replaceWith(sub);
    }
  }

  // ── Plain text (previews, search, DOCX fallbacks) ───────────────────────────
  H.toPlain = function (htmlStr) {
    var root = H.parse(htmlStr);
    // Give table cells and blocks breathing room so text doesn't run together
    root.querySelectorAll('td,th').forEach(function (c) { c.insertAdjacentText('beforeend', '  '); });
    root.querySelectorAll('tr,p,div,br,li').forEach(function (c) { c.insertAdjacentText('beforeend', ' '); });
    return (root.textContent || '').replace(/\s+/g, ' ').trim();
  };

  // ── Image references ────────────────────────────────────────────────────────
  // Canvas writes local files as $IMS-CC-FILEBASE$/... (sometimes URL-encoded)
  // and LaTeX equations as absolute instructure.com URLs.
  H.isFilebase = function (src) {
    return /IMS-CC-FILEBASE|%24IMS-CC-FILEBASE%24/i.test(src || '');
  };

  H.filebasePath = function (src) {
    var s = String(src || '');
    try { s = decodeURIComponent(s); } catch (e) {}
    s = s.replace(/^.*?IMS-CC-FILEBASE\$?/i, '').replace(/^\$?\//, '');
    return s.split('?')[0];
  };

  H.refFor = function (img) {
    var src = img.getAttribute('src') || '';
    var w = parseInt(img.getAttribute('width'), 10);
    var h = parseInt(img.getAttribute('height'), 10);
    var ref = H.isFilebase(src)
      ? { kind: 'local', path: H.filebasePath(src), alt: img.getAttribute('alt') || '' }
      : (/^https?:/i.test(src) ? { kind: 'remote', url: src, alt: img.getAttribute('alt') || '' } : null);
    if (ref) {
      // Canvas writes the intended display size on the tag; trust it over
      // measuring, which is both slower and wrong for stretched images.
      if (isFinite(w) && w > 0) ref.w = w;
      if (isFinite(h) && h > 0) ref.h = h;
    }
    return ref;
  };

  H.imageRefs = function (htmlStr) {
    var out = [];
    H.parse(htmlStr).querySelectorAll('img').forEach(function (img) {
      var ref = H.refFor(img);
      if (ref) out.push(ref);
    });
    return out;
  };

  // Common LaTeX bits that appear in Canvas equation images, so the Word file
  // can show a real symbol instead of "LaTeX: \longrightarrow".
  var LATEX_MAP = {
    '\\longrightarrow': '→', '\\rightarrow': '→', '\\to': '→', '\\Rightarrow': '⇒',
    '\\leftarrow': '←', '\\longleftarrow': '←', '\\leftrightarrow': '↔', '\\rightleftharpoons': '⇌',
    '\\Delta': 'Δ', '\\delta': 'δ', '\\alpha': 'α', '\\beta': 'β', '\\gamma': 'γ', '\\lambda': 'λ',
    '\\mu': 'μ', '\\nu': 'ν', '\\pi': 'π', '\\sigma': 'σ', '\\theta': 'θ', '\\Omega': 'Ω',
    '\\pm': '±', '\\times': '×', '\\cdot': '·', '\\div': '÷', '\\approx': '≈', '\\neq': '≠',
    '\\leq': '≤', '\\geq': '≥', '\\infty': '∞', '\\degree': '°', '\\circ': '°'
  };

  H.latexToText = function (alt) {
    var s = String(alt || '').replace(/^LaTeX:\s*/i, '').trim();
    if (!s) return '';
    Object.keys(LATEX_MAP).forEach(function (k) {
      s = s.split(k).join(LATEX_MAP[k]);
    });
    // _{2} → ₂ and ^{3} → ³ where we can
    var SUB = { '0':'₀','1':'₁','2':'₂','3':'₃','4':'₄','5':'₅','6':'₆','7':'₇','8':'₈','9':'₉','+':'₊','-':'₋' };
    var SUP = { '0':'⁰','1':'¹','2':'²','3':'³','4':'⁴','5':'⁵','6':'⁶','7':'⁷','8':'⁸','9':'⁹','+':'⁺','-':'⁻' };
    s = s.replace(/_\{?([0-9+-]+)\}?/g, function (_, d) { return d.split('').map(function (c) { return SUB[c] || c; }).join(''); });
    s = s.replace(/\^\{?([0-9+-]+)\}?/g, function (_, d) { return d.split('').map(function (c) { return SUP[c] || c; }).join(''); });
    return s.replace(/[{}$]/g, '').replace(/\s+/g, ' ').trim();
  };

  // ── Sanitised HTML for the print view ───────────────────────────────────────
  var ALLOWED = {
    P:1, DIV:1, BR:1, SPAN:1, STRONG:1, B:1, EM:1, I:1, U:1, SUP:1, SUB:1,
    TABLE:1, THEAD:1, TBODY:1, TR:1, TD:1, TH:1, UL:1, OL:1, LI:1, IMG:1,
    H1:1, H2:1, H3:1, H4:1, H5:1, H6:1, PRE:1, CODE:1, HR:1, CAPTION:1
  };

  // resolveImg(ref) -> a usable src string, or '' to drop the image
  H.sanitize = function (htmlStr, resolveImg) {
    var root = H.parse(htmlStr);

    // Anchors become plain text — a paper test can't be clicked
    root.querySelectorAll('a').forEach(function (a) {
      a.replaceWith(document.createTextNode(a.textContent || ''));
    });

    root.querySelectorAll('*').forEach(function (node) {
      if (!ALLOWED[node.tagName]) {
        node.replaceWith.apply(node, Array.prototype.slice.call(node.childNodes));
        return;
      }
      var keepStyle = '', keepSpan = '', keepRowSpan = '', keepAlign = '';
      if (node.tagName === 'TD' || node.tagName === 'TH' || node.tagName === 'TABLE') {
        keepStyle = node.getAttribute('style') || '';
        keepSpan = node.getAttribute('colspan') || '';
        keepRowSpan = node.getAttribute('rowspan') || '';
        var alignM = keepStyle.match(/text-align:\s*(left|right|center)/i);
        keepAlign = alignM ? alignM[1].toLowerCase() : (node.getAttribute('align') || '');
      }
      var src = node.tagName === 'IMG' ? node.getAttribute('src') : null;
      var alt = node.tagName === 'IMG' ? (node.getAttribute('alt') || '') : '';
      var keepW = node.tagName === 'IMG' ? parseInt(node.getAttribute('width'), 10) : NaN;
      var keepH = node.tagName === 'IMG' ? parseInt(node.getAttribute('height'), 10) : NaN;

      Array.prototype.slice.call(node.attributes).forEach(function (attr) {
        node.removeAttribute(attr.name);
      });

      if (node.tagName === 'IMG') {
        var ref = H.isFilebase(src) ? { kind: 'local', path: H.filebasePath(src), alt: alt }
                                    : { kind: 'remote', url: src, alt: alt };
        if (isFinite(keepW) && keepW > 0) ref.w = keepW;
        if (isFinite(keepH) && keepH > 0) ref.h = keepH;
        var resolved = resolveImg ? resolveImg(ref) : (ref.kind === 'remote' ? ref.url : '');
        if (!resolved) {
          var txt = H.latexToText(alt);
          node.replaceWith(document.createTextNode(txt ? ' ' + txt + ' ' : ''));
          return;
        }
        node.setAttribute('src', resolved);
        if (alt) node.setAttribute('alt', alt);
        node.setAttribute('style', 'max-width:100%;max-height:2.4in');
      } else if (node.tagName === 'TD' || node.tagName === 'TH' || node.tagName === 'TABLE') {
        // Merged cells and alignment are part of how the question reads, so
        // they survive; decorative styling does not.
        if (keepSpan) node.setAttribute('colspan', keepSpan);
        if (keepRowSpan) node.setAttribute('rowspan', keepRowSpan);
        var bits = [];
        var w = keepStyle.match(/width:\s*[\d.]+%/i);
        if (w) bits.push(w[0]);
        if (keepAlign) bits.push('text-align:' + keepAlign);
        if (bits.length) node.setAttribute('style', bits.join(';'));
      }
    });

    root.querySelectorAll('table').forEach(function (t) {
      t.setAttribute('class', 'qtable');
    });

    return root.innerHTML;
  };

  // ── WordprocessingML ────────────────────────────────────────────────────────
  // Walks the same DOM and emits paragraphs, runs, and tables. ctx supplies:
  //   { indent, addImage(ref) -> {rId,w,h} | null }
  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&apos;');
  }
  H.xmlEsc = esc;

  function runProps(f) {
    return '<w:rPr>' +
      (f.bold ? '<w:b/>' : '') + (f.italic ? '<w:i/>' : '') + (f.underline ? '<w:u w:val="single"/>' : '') +
      (f.sup ? '<w:vertAlign w:val="superscript"/>' : '') +
      (f.sub ? '<w:vertAlign w:val="subscript"/>' : '') +
      (f.size ? '<w:sz w:val="' + f.size + '"/><w:szCs w:val="' + f.size + '"/>' : '') +
      '</w:rPr>';
  }

  function textRun(text, f) {
    if (!text) return '';
    return '<w:r>' + runProps(f) + '<w:t xml:space="preserve">' + esc(text) + '</w:t></w:r>';
  }

  var EMU = 9525;
  function imageRun(rId, w, h) {
    var cx = Math.round(w * EMU), cy = Math.round(h * EMU);
    var id = (rId.replace(/\D/g, '') || '1');
    return '<w:r><w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0">' +
      '<wp:extent cx="' + cx + '" cy="' + cy + '"/><wp:docPr id="' + id + '" name="Picture ' + id + '"/>' +
      '<a:graphic xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture">' +
      '<pic:pic xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture">' +
      '<pic:nvPicPr><pic:cNvPr id="0" name="img"/><pic:cNvPicPr/></pic:nvPicPr>' +
      '<pic:blipFill><a:blip r:embed="' + rId + '"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill>' +
      '<pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="' + cx + '" cy="' + cy + '"/></a:xfrm>' +
      '<a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic>' +
      '</a:graphicData></a:graphic></wp:inline></w:drawing></w:r>';
  }
  H.imageRun = imageRun;

  var BLOCK = { P:1, DIV:1, LI:1, H1:1, H2:1, H3:1, H4:1, H5:1, H6:1, TR:1, TABLE:1, PRE:1 };

  // Returns an array of block strings (paragraphs / tables)
  H.toOoxml = function (htmlStr, ctx) {
    ctx = ctx || {};
    var indent = ctx.indent || 0;
    var blocks = [];
    var current = [];      // runs collected for the paragraph being built

    function flush(opts) {
      if (!current.length) return;
      opts = opts || {};
      blocks.push('<w:p><w:pPr>' +
        (indent ? '<w:ind w:left="' + indent + '"/>' : '') +
        (ctx.align ? '<w:jc w:val="' + (ctx.align === 'center' ? 'center' : ctx.align) + '"/>' : '') +
        '<w:spacing w:after="' + (opts.after == null ? 40 : opts.after) + '" w:line="240" w:lineRule="auto"/>' +
        (opts.bullet ? '<w:ind w:left="' + (indent + 360) + '"/>' : '') +
        '</w:pPr>' + current.join('') + '</w:p>');
      current = [];
    }

    function walk(node, f) {
      for (var i = 0; i < node.childNodes.length; i++) {
        var n = node.childNodes[i];

        if (n.nodeType === 3) {                                  // text
          var t = n.nodeValue.replace(/\s+/g, ' ');
          if (t.trim() || current.length) current.push(textRun(t, f));
          continue;
        }
        if (n.nodeType !== 1) continue;

        var tag = n.tagName;

        if (tag === 'BR') { current.push('<w:r>' + runProps(f) + '<w:br/></w:r>'); continue; }
        if (tag === 'HR') { flush(); blocks.push('<w:p><w:pPr><w:pBdr><w:bottom w:val="single" w:sz="6" w:color="999999"/></w:pBdr></w:pPr></w:p>'); continue; }

        if (tag === 'IMG') {
          var alt = n.getAttribute('alt') || '';
          var ref = H.refFor(n);
          var placed = (ref && ctx.addImage) ? ctx.addImage(ref) : null;
          if (placed) current.push(imageRun(placed.rId, placed.w, placed.h));
          else {
            var txt = H.latexToText(alt);
            if (txt) current.push(textRun(' ' + txt + ' ', f));
          }
          continue;
        }

        if (tag === 'TABLE') { flush(); blocks.push(tableXml(n, f, ctx, indent)); continue; }

        var f2 = {
          bold: f.bold || tag === 'STRONG' || tag === 'B' || /^H[1-6]$/.test(tag),
          italic: f.italic || tag === 'EM' || tag === 'I',
          underline: f.underline || tag === 'U',
          sup: f.sup || tag === 'SUP',
          sub: f.sub || tag === 'SUB',
          size: f.size
        };

        if (BLOCK[tag]) {
          flush();
          if (tag === 'LI') current.push(textRun('• ', f2));
          walk(n, f2);
          flush({ bullet: tag === 'LI' });
        } else {
          walk(n, f2);
        }
      }
    }

    function tableXml(tableNode, f, ctx2, ind) {
      var rows = [];
      var trs = tableNode.querySelectorAll('tr');
      var maxCols = 1;
      trs.forEach(function (tr) { maxCols = Math.max(maxCols, tr.children.length); });
      var colW = Math.floor(9360 / maxCols);   // usable page width in twips

      trs.forEach(function (tr) {
        var cells = [];
        Array.prototype.slice.call(tr.children).forEach(function (td) {
          var span = parseInt(td.getAttribute('colspan'), 10);
          var rspan = parseInt(td.getAttribute('rowspan'), 10);
          var st = td.getAttribute('style') || '';
          var al = (st.match(/text-align:\s*(left|right|center)/i) || [])[1];
          var inner = H.toOoxml(td.innerHTML, { indent: 0, addImage: ctx2.addImage, align: al });
          if (!inner.length) inner = ['<w:p/>'];
          var props = '<w:tcW w:w="' + (colW * (isFinite(span) && span > 1 ? span : 1)) + '" w:type="dxa"/>' +
            (isFinite(span) && span > 1 ? '<w:gridSpan w:val="' + span + '"/>' : '') +
            (isFinite(rspan) && rspan > 1 ? '<w:vMerge w:val="restart"/>' : '');
          cells.push('<w:tc><w:tcPr>' + props + '</w:tcPr>' + inner.join('') + '</w:tc>');
        });
        if (cells.length) rows.push('<w:tr>' + cells.join('') + '</w:tr>');
      });
      if (!rows.length) return '';
      var grid = '<w:tblGrid>';
      for (var g = 0; g < maxCols; g++) grid += '<w:gridCol w:w="' + colW + '"/>';
      grid += '</w:tblGrid>';
      return '<w:tbl><w:tblPr><w:tblStyle w:val="TableGrid"/><w:tblW w:w="0" w:type="auto"/>' +
        '<w:tblBorders>' +
        ['top','left','bottom','right','insideH','insideV'].map(function (s) {
          return '<w:' + s + ' w:val="single" w:sz="4" w:color="666666"/>';
        }).join('') +
        '</w:tblBorders>' +
        (ind ? '<w:tblInd w:w="' + ind + '" w:type="dxa"/>' : '') +
        '</w:tblPr>' + grid + rows.join('') + '</w:tbl>';
    }

    walk(H.parse(htmlStr), { size: ctx.size });
    flush();
    return blocks;
  };

})(window);
