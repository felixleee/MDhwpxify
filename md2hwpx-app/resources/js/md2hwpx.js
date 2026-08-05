/* md2hwpx (MDhwpify) 핵심: Markdown -> .hwpx (Blob) — 정부과제 보고서 양식 초안 생성용.
 *
 * 템플릿 구동: window.HWPX_TPL(정부 양식 header + 스타일맵)에 md를 매핑.
 *   - 헤딩 H1~H4  → 제목 1~4단계 (번호 없이 스타일만)
 *   - 목록 depth 1~4 → 본문 1~4단계 + 정부 불릿(□ ○ ▪ -) 리터럴
 *   - 표         → 표제목(머리, 회색 채움)/표내용(셀) + 그리드 borderFill
 *   - 인라인      → 굵게/기울임/코드/취소선/링크 (gov header에 추가한 커스텀 charPr)
 * 무접두사 OWPML 직접 방출. 제어문자(탭 등)는 cleanText로 제거(한글 크래시 방지).
 * 노출: window.MD2HWPX.convert(md, tpl, settings) -> Promise<Blob>
 */
(function () {
  'use strict';
  var BASE_CONTENT_W = 49324;   // 본문폭 HWPUNIT (pagePr 59528 - 좌우여백 5102*2)
  var CONTENT_W = BASE_CONTENT_W;   // 쪽 테두리 시 프레임 안쪽 여백만큼 축소됨(convert에서 설정)
  var FRAME_PAD = 1300;   // 쪽 테두리 프레임 좌우 안쪽 여백(HWPUNIT ≈4.6mm)
  var TEXT_H = 75684;     // 본문 세로 높이(page 84188 - 상하여백 4252*2) — 프레임이 페이지를 채우도록
  var TPL = null;

  function xmlEsc(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
  function cleanText(s) { return String(s == null ? '' : s).replace(/[\t\r\n\v\f]+/g, ' '); }

  /* ---------- 이미지 (hp:pic + BinData 임베드). href=data URI 만 처리 ---------- */
  var imgList = [];   // {binId, ext, mime, bytes}
  var picSeq = 0;
  var imgResolver = null;   // (src)->{bytes,ext}|Uint8Array|null : data URI 아닌 상대경로 이미지 공급(앱: md 옆 파일 읽기)
  function dataUriBytes(uri) {
    var m = /^data:([^;,]+)?(;base64)?,([\s\S]*)$/.exec(uri || '');
    if (!m) return null;
    var mime = m[1] || 'image/png', isB64 = !!m[2], data = m[3], bin;
    try { bin = isB64 ? ((typeof atob !== 'undefined') ? atob(data) : Buffer.from(data, 'base64').toString('binary')) : decodeURIComponent(data); }
    catch (e) { return null; }
    var bytes = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i) & 0xff;
    var ext = (mime.split('/')[1] || 'png').toLowerCase(); if (ext === 'jpeg') ext = 'jpg';
    return { bytes: bytes, mime: 'image/' + ext, ext: ext };
  }
  function imageSize(b) {
    try {
      if (b[0] === 0x89 && b[1] === 0x50) return { w: (b[16] << 24 | b[17] << 16 | b[18] << 8 | b[19]) >>> 0, h: (b[20] << 24 | b[21] << 16 | b[22] << 8 | b[23]) >>> 0 };
      if (b[0] === 0x47 && b[1] === 0x49) return { w: b[6] | b[7] << 8, h: b[8] | b[9] << 8 };
      if (b[0] === 0x42 && b[1] === 0x4D) return { w: Math.abs(b[18] | b[19] << 8 | b[20] << 16 | b[21] << 24), h: Math.abs(b[22] | b[23] << 8 | b[24] << 16 | b[25] << 24) };
      if (b[0] === 0xFF && b[1] === 0xD8) { var i = 2; while (i < b.length - 8) { if (b[i] !== 0xFF) { i++; continue; } var mk = b[i + 1]; if (mk >= 0xC0 && mk <= 0xCF && mk !== 0xC4 && mk !== 0xC8 && mk !== 0xCC) return { w: b[i + 7] << 8 | b[i + 8], h: b[i + 5] << 8 | b[i + 6] }; i += 2 + (b[i + 2] << 8 | b[i + 3]); } }
    } catch (e) { }
    return { w: 400, h: 300 };
  }
  var PX = 75;   // 1px = 75 HWPUNIT (96dpi)
  function buildPic(binId, w0, h0, maxW, maxH) {
    maxW = maxW || CONTENT_W; maxH = maxH || 40000;   /* 최대높이 캡(~14cm): 과대 이미지가 행을 폭발시키는 것 방지 */
    var natW = Math.max(1, w0 * PX), natH = Math.max(1, h0 * PX), dw = natW, dh = natH;
    if (dw > maxW) { dh = Math.round(dh * maxW / dw); dw = maxW; }
    if (dh > maxH) { dw = Math.round(dw * maxH / dh); dh = maxH; }
    var id = ++picSeq;
    return '<hp:pic id="' + id + '" zOrder="0" numberingType="PICTURE" textWrap="TOP_AND_BOTTOM" textFlow="BOTH_SIDES" lock="0" dropcapstyle="None" href="" groupLevel="0" instid="' + id + '" reverse="0">' +
      '<hp:offset x="0" y="0"/><hp:orgSz width="' + dw + '" height="' + dh + '"/><hp:curSz width="' + dw + '" height="' + dh + '"/>' +
      '<hp:flip horizontal="0" vertical="0"/><hp:rotationInfo angle="0" centerX="' + Math.round(dw / 2) + '" centerY="' + Math.round(dh / 2) + '" rotateimage="1"/>' +
      '<hp:renderingInfo><hc:transMatrix e1="1" e2="0" e3="0" e4="0" e5="1" e6="0"/><hc:scaMatrix e1="1" e2="0" e3="0" e4="0" e5="1" e6="0"/><hc:rotMatrix e1="1" e2="0" e3="0" e4="0" e5="1" e6="0"/></hp:renderingInfo>' +
      '<hp:imgRect><hc:pt0 x="0" y="0"/><hc:pt1 x="' + dw + '" y="0"/><hc:pt2 x="' + dw + '" y="' + dh + '"/><hc:pt3 x="0" y="' + dh + '"/></hp:imgRect>' +
      '<hp:imgClip left="0" right="' + natW + '" top="0" bottom="' + natH + '"/><hp:inMargin left="0" right="0" top="0" bottom="0"/><hp:imgDim dimwidth="' + natW + '" dimheight="' + natH + '"/>' +
      '<hc:img binaryItemIDRef="' + binId + '" bright="0" contrast="0" effect="REAL_PIC" alpha="0"/>' +
      '<hp:sz width="' + dw + '" widthRelTo="ABSOLUTE" height="' + dh + '" heightRelTo="ABSOLUTE" protect="0"/>' +
      '<hp:pos treatAsChar="1" affectLSpacing="0" flowWithText="1" allowOverlap="0" holdAnchorAndSO="0" vertRelTo="PARA" horzRelTo="COLUMN" vertAlign="TOP" horzAlign="CENTER" vertOffset="0" horzOffset="0"/>' +
      '<hp:outMargin left="0" right="0" top="0" bottom="0"/></hp:pic>';
  }
  /* 이미지 크기 문법: href/title 끝의 "=300x200"·"=300x"·"=x200"·"=50%"·"=300" 파싱 */
  var SPEC_RE = /=\s*(\d+x\d+|\d+x|x\d+|\d+%|\d+)\s*$/i;
  function parseImgSpec(tok) {
    var h = tok.href || '', ti = tok.title || '';
    var m = SPEC_RE.exec(ti.trim()) || SPEC_RE.exec(h.trim());
    var spec = m ? m[1].toLowerCase() : null;
    var href = h.replace(/\s*=\s*(\d+x\d+|\d+x|x\d+|\d+%|\d+)\s*$/i, '').trim();
    return { href: href, spec: spec };
  }
  /* spec 적용 → 표시 px {w,h}. natW/natH=자연 px, maxWpx=컨테이너 px */
  function applyImgSpec(spec, natW, natH, maxWpx) {
    var w = natW, h = natH, m;
    if (!spec) { }
    else if (m = /^(\d+)x(\d+)$/.exec(spec)) { w = +m[1]; h = +m[2]; }
    else if (m = /^(\d+)x$/.exec(spec)) { w = +m[1]; h = Math.round(natH * w / natW); }
    else if (m = /^x(\d+)$/.exec(spec)) { h = +m[1]; w = Math.round(natW * h / natH); }
    else if (m = /^(\d+)%$/.exec(spec)) { w = Math.round(maxWpx * (+m[1]) / 100); h = Math.round(natH * w / natW); }
    else if (m = /^(\d+)$/.exec(spec)) { w = +m[1]; h = Math.round(natH * w / natW); }
    return { w: Math.max(1, w), h: Math.max(1, h) };
  }
  function addImage(tok, maxW, maxH) {
    var ps = parseImgSpec(typeof tok === 'string' ? { href: tok } : tok);
    var href = ps.href;
    var info = null;
    if (/^data:/.test(href || '')) info = dataUriBytes(href);
    else if (imgResolver) {
      var r = imgResolver(href);
      if (r) { var bytes = r.bytes || r; var ext = (r.ext || (href.split('?')[0].split('.').pop() || 'png')).toLowerCase(); if (ext === 'jpeg') ext = 'jpg'; if (bytes && bytes.length) info = { bytes: bytes, ext: ext, mime: 'image/' + ext }; }
    }
    if (!info) return null;
    var binId = 'image' + (imgList.length + 1);
    imgList.push({ binId: binId, ext: info.ext, mime: info.mime, bytes: info.bytes });
    var nat = imageSize(info.bytes);
    var disp = applyImgSpec(ps.spec, nat.w, nat.h, Math.round((maxW || CONTENT_W) / PX));
    return buildPic(binId, disp.w, disp.h, maxW, maxH);
  }
  function decode(s) { if (s == null) return ''; return String(s).replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&nbsp;/g, ' '); }
  function parseFrontmatter(t) {
    var m = t.match(/^---\s*\n([\s\S]*?)\n---\s*\n/), meta = {};
    if (!m) return { meta: meta, body: t };
    m[1].split('\n').forEach(function (line) { var i = line.indexOf(':'); if (i > 0) meta[line.slice(0, i).trim()] = line.slice(i + 1).trim().replace(/^["']|["']$/g, ''); });
    return { meta: meta, body: t.slice(m[0].length) };
  }

  /* 인라인 → run 배열 [{c,t}|{c,pic}]. base=문단 기본 charPr id, maxW=이미지 최대폭(셀은 셀폭) */
  function inlineRuns(tokens, base, maxW, maxH) {
    var C = TPL.CUSTOM, runs = [];
    function push(c, t) { if (t) runs.push({ c: c, t: t }); }
    (tokens || []).forEach(function (t) {
      switch (t.type) {
        case 'text': if (t.tokens && t.tokens.length) runs = runs.concat(inlineRuns(t.tokens, base, maxW, maxH)); else push(base, decode(t.text)); break;
        case 'escape': push(base, t.text); break;
        case 'strong': runs = runs.concat(inlineRuns(t.tokens, C.bold, maxW, maxH)); break;
        case 'em': runs = runs.concat(inlineRuns(t.tokens, C.italic, maxW, maxH)); break;
        case 'del': runs = runs.concat(inlineRuns(t.tokens, C.del, maxW, maxH)); break;
        case 'codespan': push(C.code, decode(t.text)); break;
        case 'link': { var kids = inlineRuns(t.tokens, C.link, maxW, maxH); if (!kids.length) kids = [{ c: C.link, t: t.href }]; runs = runs.concat(kids); } break;
        case 'br': push(base, ' '); break;
        case 'image': { var pic = addImage(t, maxW, maxH); if (pic) runs.push({ c: base, pic: pic }); else push(base, '[' + (t.text || 'image') + ']'); } break;
        case 'html': { var s = (t.text || '').replace(/<[^>]+>/g, ''); if (s) push(base, s); } break;
        default: if (t.tokens) runs = runs.concat(inlineRuns(t.tokens, base, maxW, maxH)); else if (t.text != null) push(base, decode(t.text));
      }
    });
    return runs;
  }
  /* 순수 텍스트 추출 (이미지 수집 side-effect 없음 — 제목/셀/미리보기용) */
  function inlineText(tokens) {
    if (!tokens) return '';
    var out = '';
    (tokens || []).forEach(function (t) {
      switch (t.type) {
        case 'text': out += (t.tokens && t.tokens.length) ? inlineText(t.tokens) : decode(t.text); break;
        case 'escape': out += t.text; break;
        case 'codespan': out += decode(t.text); break;
        case 'strong': case 'em': case 'del': case 'link': out += inlineText(t.tokens); break;
        case 'br': out += ' '; break;
        case 'image': break;
        case 'html': out += (t.text || '').replace(/<[^>]+>/g, ''); break;
        default: out += t.tokens ? inlineText(t.tokens) : decode(t.text || '');
      }
    });
    return out;
  }

  function lineseg(h, w) {
    var base = Math.round(h * 0.85);
    return '<hp:linesegarray><hp:lineseg textpos="0" vertpos="0" vertsize="' + h + '" textheight="' + h + '" baseline="' + base + '" spacing="600" horzpos="0" horzsize="' + (w || CONTENT_W) + '" flags="393216"/></hp:linesegarray>';
  }
  /* st={style,para,char}, h=lineseg 높이. runs=[{c,t}]. extra=첫 run 앞 컨트롤 */
  function paraOf(runs, st, h, extra, w) {
    if (!runs || !runs.length) runs = [{ c: st.char, t: '' }];
    var body = '';
    runs.forEach(function (r, i) { var pre = (i === 0 && extra ? extra : ''); body += r.pic ? ('<hp:run charPrIDRef="' + r.c + '">' + pre + r.pic + '</hp:run>') : ('<hp:run charPrIDRef="' + r.c + '">' + pre + '<hp:t>' + xmlEsc(cleanText(r.t)) + '</hp:t></hp:run>'); });
    return '<hp:p id="0" paraPrIDRef="' + st.para + '" styleIDRef="' + st.style + '" pageBreak="0" columnBreak="0" merged="0">' + body + lineseg(h, w) + '</hp:p>';
  }
  function textPara(text, st, h) { return paraOf([{ c: st.char, t: text }], st, h); }

  var HH = [0, 1700, 1500, 1300, 1100];  // 헤딩 레벨별 lineseg 높이

  /* 스마트 절 번호: md에 번호 있으면 그대로, 없으면 depth 기반 자동(H1=1. H2=1.1 …) */
  var HASNUM = /^\s*(\d+([.\-]\d+)*\.?|[가나다라마바사아자차카타파하][.)]|[IVXⅠⅡⅢⅣⅤⅥⅦⅧⅨⅩ]+\.|[①-⑳])\s+/;
  var numCtr = [0, 0, 0, 0, 0];
  function numberHeading(txt, d) {
    if (HASNUM.test(txt)) return txt;
    numCtr[d]++; for (var i = d + 1; i < numCtr.length; i++) numCtr[i] = 0;
    var parts = []; for (var j = 1; j <= d; j++) parts.push(numCtr[j]);
    return parts.join('.') + (d === 1 ? '.' : '') + ' ' + txt;
  }

  /* 목록 재귀: depth 1부터. marked list item.tokens 안에 중첩 list 존재 */
  function listBlocks(list, depth, out) {
    var d = Math.min(depth, 4), st = TPL.STYLE.body[d], bullet = TPL.BULLETS[d - 1];
    (list.items || []).forEach(function (it) {
      var inl = [], nested = [];
      (it.tokens || []).forEach(function (x) {
        if (x.type === 'list') nested.push(x);
        else if (x.type === 'text' || x.type === 'paragraph') inl = inl.concat(inlineRuns(x.tokens || [{ type: 'text', text: x.text }], st.char));
        else if (x.type !== 'space') inl = inl.concat(inlineRuns(x.tokens || [], st.char));
      });
      out.push(paraOf([{ c: st.char, t: bullet + ' ' }].concat(inl), st, 1200));
      nested.forEach(function (nl) { listBlocks(nl, depth + 1, out); });
    });
  }

  /* 표: 표제목(머리·회색채움 headFill)/표내용(그리드) */
  /* lines = 셀 안 줄 배열(각 줄 = run 배열). <br>마다 한 줄 → 셀 내 여러 문단(산출물도 줄바꿈 반영) */
  function tblCell(lines, st, colAddr, rowAddr, w, h, bfId, isHeader, colSpan, rowSpan) {
    var cw = Math.max(1, w - 1020);
    if (!lines || !lines.length) lines = [[{ c: st.char, t: '' }]];
    var paras = '';
    lines.forEach(function (runs) {
      if (!runs || !runs.length) runs = [{ c: st.char, t: '' }];
      var rb = '';
      runs.forEach(function (r) { rb += r.pic ? ('<hp:run charPrIDRef="' + r.c + '">' + r.pic + '</hp:run>') : ('<hp:run charPrIDRef="' + r.c + '"><hp:t>' + xmlEsc(cleanText(r.t)) + '</hp:t></hp:run>'); });
      paras += '<hp:p id="0" paraPrIDRef="' + st.para + '" styleIDRef="' + st.style + '" pageBreak="0" columnBreak="0" merged="0">' + rb + lineseg(1000, cw) + '</hp:p>';
    });
    return '<hp:tc name="" header="' + (isHeader ? 1 : 0) + '" hasMargin="0" protect="0" editable="0" dirty="0" borderFillIDRef="' + bfId + '">' +
      '<hp:subList id="" textDirection="HORIZONTAL" lineWrap="BREAK" vertAlign="CENTER" linkListIDRef="0" linkListNextIDRef="0" textWidth="0" textHeight="0" hasTextRef="0" hasNumRef="0">' + paras + '</hp:subList>' +
      '<hp:cellAddr colAddr="' + colAddr + '" rowAddr="' + rowAddr + '"/><hp:cellSpan colSpan="' + (colSpan || 1) + '" rowSpan="' + (rowSpan || 1) + '"/>' +
      '<hp:cellSz width="' + w + '" height="' + h + '"/><hp:cellMargin left="510" right="510" top="141" bottom="141"/></hp:tc>';
  }
  var tblSeq = 0;
  function buildTable(t) {
    var header = t.header || [], rows = t.rows || [];
    var colCnt = header.length || (rows[0] ? rows[0].length : 0);
    if (!colCnt) return textPara('', TPL.STYLE.normal, 1000);
    var all = [];
    if (header.length) all.push({ cells: header, header: true });
    rows.forEach(function (r) { all.push({ cells: r, header: false }); });
    var rowCnt = all.length, rowH = 2400, colW = Math.floor(CONTENT_W / colCnt);
    var GRID = TPL.TABLE.grid, HEAD = TPL.TABLE.headFill;
    var trs = '';
    all.forEach(function (row, ri) {
      var tcs = '';
      for (var ci = 0; ci < colCnt; ci++) {
        var cell = row.cells[ci];
        var w = (ci === colCnt - 1) ? (CONTENT_W - colW * (colCnt - 1)) : colW;
        var st = row.header ? TPL.STYLE.tableHead : TPL.STYLE.tableBody;
        var cRuns = cell ? inlineRuns(cell.tokens || [{ type: 'text', text: cell.text }], st.char, Math.max(1, w - 1020), 10000) : [];
        tcs += tblCell([cRuns], st, ci, ri, w, rowH, row.header ? HEAD : GRID, row.header);
      }
      trs += '<hp:tr>' + tcs + '</hp:tr>';
    });
    var tbl = '<hp:tbl id="' + (++tblSeq) + '" zOrder="0" numberingType="TABLE" textWrap="TOP_AND_BOTTOM" textFlow="BOTH_SIDES" lock="0" dropcapstyle="None" pageBreak="CELL" repeatHeader="1" rowCnt="' + rowCnt + '" colCnt="' + colCnt + '" cellSpacing="0" borderFillIDRef="' + GRID + '" noAdjust="0">' +
      '<hp:sz width="' + CONTENT_W + '" widthRelTo="ABSOLUTE" height="' + (rowH * rowCnt) + '" heightRelTo="ABSOLUTE" protect="0"/>' +
      '<hp:pos treatAsChar="0" affectLSpacing="0" flowWithText="1" allowOverlap="0" holdAnchorAndSO="0" vertRelTo="PARA" horzRelTo="COLUMN" vertAlign="TOP" horzAlign="LEFT" vertOffset="0" horzOffset="0"/>' +
      '<hp:outMargin left="283" right="283" top="283" bottom="283"/><hp:inMargin left="510" right="510" top="141" bottom="141"/>' + trs + '</hp:tbl>';
    return '<hp:p id="0" paraPrIDRef="' + TPL.STYLE.normal.para + '" styleIDRef="' + TPL.STYLE.normal.style + '" pageBreak="0" columnBreak="0" merged="0"><hp:run charPrIDRef="' + TPL.STYLE.normal.char + '">' + tbl + '<hp:t/></hp:run>' + lineseg(1000) + '</hp:p>';
  }

  /* ---------- HTML 표(colspan/rowspan) → hp:tbl 병합 ---------- */
  function stripTags(s) { return decode(String(s).replace(/<br\s*\/?>/gi, ' ').replace(/<[^>]+>/g, '')).replace(/\s+/g, ' ').trim(); }
  function parseHtmlTable(html) {
    var t = (html.match(/<table[\s\S]*?<\/table>/i) || [html])[0];
    var trs = t.match(/<tr[\s\S]*?<\/tr>/gi) || [];
    var occ = {}, cells = [], colCount = 0;
    trs.forEach(function (tr, r) {
      var c = 0, tds = tr.match(/<t[hd][\s\S]*?<\/t[hd]>/gi) || [];
      tds.forEach(function (td) {
        var isH = /^<th/i.test(td);
        var cs = parseInt((td.match(/colspan\s*=\s*["']?(\d+)/i) || [])[1] || '1', 10) || 1;
        var rs = parseInt((td.match(/rowspan\s*=\s*["']?(\d+)/i) || [])[1] || '1', 10) || 1;
        var inner = td.replace(/^<t[hd][\s\S]*?>/i, '').replace(/<\/t[hd]>\s*$/i, '');
        while (occ[r + '_' + c]) c++;
        cells.push({ row: r, col: c, colSpan: cs, rowSpan: rs, inner: inner, isHeader: isH });
        for (var ri = r; ri < r + rs; ri++) for (var ci = c; ci < c + cs; ci++) occ[ri + '_' + ci] = 1;
        c += cs; if (c > colCount) colCount = c;
      });
    });
    /* colgroup 폭(%) 파싱 → 분수 배열(미리보기 colgroup과 동일 폭을 출력에도 적용해 일치) */
    var colWidths = null, cg = t.match(/<colgroup[\s\S]*?<\/colgroup>/i);
    if (cg) { var ws = [].map.call(cg[0].match(/width\s*:\s*[\d.]+%/gi) || [], function (x) { return parseFloat(x.replace(/[^\d.]/g, '')); }); if (ws.length) { var sum = ws.reduce(function (a, b) { return a + b; }, 0) || 1; colWidths = ws.map(function (w) { return w / sum; }); } }
    return { rowCount: trs.length, colCount: colCount, cells: cells, colWidths: colWidths };
  }
  function segRuns(seg, charId, maxW, maxH) {   /* <br> 없는 한 줄 → run 배열(텍스트+이미지) */
    var runs = [], re = /<img\b[^>]*>/gi, idx = 0, m;
    while ((m = re.exec(seg))) {
      var tag = m[0], src = (tag.match(/src\s*=\s*["']([^"']+)["']/i) || [])[1];
      var pre = stripTags(seg.slice(idx, m.index)); if (pre) runs.push({ c: charId, t: pre });
      if (src) {
        var w = (tag.match(/\bwidth\s*=\s*["']?(\d+)/i) || [])[1], h = (tag.match(/\bheight\s*=\s*["']?(\d+)/i) || [])[1];
        var spec = (w && h) ? ('=' + w + 'x' + h) : (w ? ('=' + w + 'x') : (h ? ('=x' + h) : ''));
        var pic = addImage(spec ? { href: src, title: spec } : src, maxW, maxH); if (pic) runs.push({ c: charId, pic: pic });
      }
      idx = m.index + m[0].length;
    }
    var tail = stripTags(seg.slice(idx)); if (tail) runs.push({ c: charId, t: tail });
    return runs;
  }
  function htmlCellLines(inner, charId, maxW, maxH) {   /* <br>마다 줄 분할 → 줄 배열 */
    var lines = String(inner).split(/<br\s*\/?>/i).map(function (seg) { return segRuns(seg, charId, maxW, maxH); });
    while (lines.length > 1 && !lines[lines.length - 1].length) lines.pop();   /* 후행 빈 줄 제거 */
    return lines.length ? lines : [[{ c: charId, t: '' }]];
  }
  function buildHtmlTable(html) {
    var t = parseHtmlTable(html);
    if (!t.colCount || !t.rowCount) return textPara('', TPL.STYLE.normal, 1000);
    var rowH = 2400, GRID = TPL.TABLE.grid, HEAD = TPL.TABLE.headFill;
    /* 열별 폭(HWPUNIT): colgroup 있으면 그 비율로(미리보기와 동일), 없으면 균등. 마지막 열이 잔여 흡수 */
    var colPx = [], useCg = t.colWidths && t.colWidths.length === t.colCount, acc = 0, eq = Math.floor(CONTENT_W / t.colCount);
    for (var ci = 0; ci < t.colCount; ci++) { var wv = (ci === t.colCount - 1) ? (CONTENT_W - acc) : (useCg ? Math.round(t.colWidths[ci] * CONTENT_W) : eq); colPx[ci] = wv; acc += wv; }
    function colWidth(col, span) { var w = 0; for (var i = 0; i < span; i++) w += colPx[col + i] || 0; return w; }
    var trs = '';
    for (var r = 0; r < t.rowCount; r++) {
      var rowCells = t.cells.filter(function (c) { return c.row === r; }).sort(function (a, b) { return a.col - b.col; }), tcs = '';
      rowCells.forEach(function (c) {
        var st = c.isHeader ? TPL.STYLE.tableHead : TPL.STYLE.tableBody, w = colWidth(c.col, c.colSpan), h = rowH * c.rowSpan;
        var lines = htmlCellLines(c.inner, st.char, Math.max(1, w - 1020), 10000);
        tcs += tblCell(lines, st, c.col, c.row, w, h, c.isHeader ? HEAD : GRID, c.isHeader, c.colSpan, c.rowSpan);
      });
      trs += '<hp:tr>' + tcs + '</hp:tr>';
    }
    var tbl = '<hp:tbl id="' + (++tblSeq) + '" zOrder="0" numberingType="TABLE" textWrap="TOP_AND_BOTTOM" textFlow="BOTH_SIDES" lock="0" dropcapstyle="None" pageBreak="CELL" repeatHeader="1" rowCnt="' + t.rowCount + '" colCnt="' + t.colCount + '" cellSpacing="0" borderFillIDRef="' + GRID + '" noAdjust="' + (useCg ? '1' : '0') + '">' +
      '<hp:sz width="' + CONTENT_W + '" widthRelTo="ABSOLUTE" height="' + (rowH * t.rowCount) + '" heightRelTo="ABSOLUTE" protect="0"/>' +
      '<hp:pos treatAsChar="0" affectLSpacing="0" flowWithText="1" allowOverlap="0" holdAnchorAndSO="0" vertRelTo="PARA" horzRelTo="COLUMN" vertAlign="TOP" horzAlign="LEFT" vertOffset="0" horzOffset="0"/>' +
      '<hp:outMargin left="283" right="283" top="283" bottom="283"/><hp:inMargin left="510" right="510" top="141" bottom="141"/>' + trs + '</hp:tbl>';
    return '<hp:p id="0" paraPrIDRef="' + TPL.STYLE.normal.para + '" styleIDRef="' + TPL.STYLE.normal.style + '" pageBreak="0" columnBreak="0" merged="0"><hp:run charPrIDRef="' + TPL.STYLE.normal.char + '">' + tbl + '<hp:t/></hp:run>' + lineseg(1000) + '</hp:p>';
  }

  function blocks(tokens, out) {
    out = out || [];
    (tokens || []).forEach(function (t) {
      switch (t.type) {
        case 'heading': { var d = Math.min(t.depth, 4), st = TPL.STYLE.h[d]; out.push(paraOf([{ c: st.char, t: numberHeading(inlineText(t.tokens), d) }], st, HH[d])); } break;
        case 'paragraph': out.push(paraOf(inlineRuns(t.tokens, TPL.STYLE.normal.char), TPL.STYLE.normal, 1000)); break;
        case 'text': out.push(paraOf(t.tokens ? inlineRuns(t.tokens, TPL.STYLE.normal.char) : [{ c: TPL.STYLE.normal.char, t: decode(t.text) }], TPL.STYLE.normal, 1000)); break;
        case 'blockquote': blocks(t.tokens, out); break;
        case 'code': String(t.text || '').replace(/\n$/, '').split('\n').forEach(function (ln) { out.push(paraOf([{ c: TPL.CUSTOM.code, t: ln || ' ' }], TPL.STYLE.normal, 1000)); }); break;
        case 'list': listBlocks(t, 1, out); break;
        case 'table': out.push(buildTable(t)); break;
        case 'html': { var h = t.text || t.raw || ''; if (/<table[\s>]/i.test(h)) out.push(buildHtmlTable(h)); } break;
        case 'hr': out.push(textPara('────────────────────', TPL.STYLE.normal, 1000)); break;
        case 'space': break;
        default: if (t.tokens) out.push(paraOf(inlineRuns(t.tokens, TPL.STYLE.normal.char), TPL.STYLE.normal, 1000)); else if (t.text) out.push(textPara(decode(t.text), TPL.STYLE.normal, 1000));
      }
    });
    return out;
  }

  var SEC_NS = 'xmlns:ha="http://www.hancom.co.kr/hwpml/2011/app" xmlns:hp="http://www.hancom.co.kr/hwpml/2011/paragraph" xmlns:hp10="http://www.hancom.co.kr/hwpml/2016/paragraph" xmlns:hs="http://www.hancom.co.kr/hwpml/2011/section" xmlns:hc="http://www.hancom.co.kr/hwpml/2011/core" xmlns:hh="http://www.hancom.co.kr/hwpml/2011/head" xmlns:hhs="http://www.hancom.co.kr/hwpml/2011/history" xmlns:hm="http://www.hancom.co.kr/hwpml/2011/master-page" xmlns:hpf="http://www.hancom.co.kr/schema/2011/hpf" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:opf="http://www.idpf.org/2007/opf/" xmlns:ooxmlchart="http://www.hancom.co.kr/hwpml/2016/ooxmlchart" xmlns:hwpunitchar="http://www.hancom.co.kr/hwpml/2016/HwpUnitChar" xmlns:epub="http://www.idpf.org/2007/ops" xmlns:config="urn:oasis:names:tc:opendocument:xmlns:config:1.0"';

  /* ---------- 표지(frontmatter) ---------- */
  function centerParaOf(text, charId, h) {
    return '<hp:p id="0" paraPrIDRef="' + TPL.CENTER + '" styleIDRef="0" pageBreak="0" columnBreak="0" merged="0"><hp:run charPrIDRef="' + charId + '"><hp:t>' + xmlEsc(cleanText(text)) + '</hp:t></hp:run>' + lineseg(h) + '</hp:p>';
  }
  function emptyPara() { return textPara(' ', TPL.STYLE.normal, 1000); }
  function pageBreakPara() {
    var st = TPL.STYLE.normal;
    return '<hp:p id="0" paraPrIDRef="' + st.para + '" styleIDRef="' + st.style + '" pageBreak="1" columnBreak="0" merged="0"><hp:run charPrIDRef="' + st.char + '"><hp:t/></hp:run>' + lineseg(1000) + '</hp:p>';
  }
  function metaTable(pairs) {
    var GRID = TPL.TABLE.grid, HEAD = TPL.TABLE.headFill, w0 = Math.floor(CONTENT_W * 0.3), w1 = CONTENT_W - w0, rowH = 1400, trs = '';
    pairs.forEach(function (kv, ri) {
      trs += '<hp:tr>' + tblCell([[{ c: TPL.STYLE.tableHead.char, t: kv[0] }]], TPL.STYLE.tableHead, 0, ri, w0, rowH, HEAD, true) + tblCell([[{ c: TPL.STYLE.tableBody.char, t: kv[1] }]], TPL.STYLE.tableBody, 1, ri, w1, rowH, GRID, false) + '</hp:tr>';
    });
    var tbl = '<hp:tbl id="' + (++tblSeq) + '" zOrder="0" numberingType="TABLE" textWrap="TOP_AND_BOTTOM" textFlow="BOTH_SIDES" lock="0" dropcapstyle="None" pageBreak="CELL" repeatHeader="0" rowCnt="' + pairs.length + '" colCnt="2" cellSpacing="0" borderFillIDRef="' + GRID + '" noAdjust="0">' +
      '<hp:sz width="' + CONTENT_W + '" widthRelTo="ABSOLUTE" height="' + (rowH * pairs.length) + '" heightRelTo="ABSOLUTE" protect="0"/>' +
      '<hp:pos treatAsChar="0" affectLSpacing="0" flowWithText="1" allowOverlap="0" holdAnchorAndSO="0" vertRelTo="PARA" horzRelTo="COLUMN" vertAlign="TOP" horzAlign="LEFT" vertOffset="0" horzOffset="0"/>' +
      '<hp:outMargin left="283" right="283" top="283" bottom="283"/><hp:inMargin left="510" right="510" top="141" bottom="141"/>' + trs + '</hp:tbl>';
    return '<hp:p id="0" paraPrIDRef="' + TPL.STYLE.normal.para + '" styleIDRef="' + TPL.STYLE.normal.style + '" pageBreak="0" columnBreak="0" merged="0"><hp:run charPrIDRef="' + TPL.STYLE.normal.char + '">' + tbl + '<hp:t/></hp:run>' + lineseg(1000) + '</hp:p>';
  }
  function coverParas(meta) {
    var special = { title: 1, subtitle: 1, '제목': 1, '부제': 1, '서식': 1, form: 1, kicker: 1, '사업명': 1, '쪽테두리': 1, '테두리': 1, pageBorder: 1 };
    var title = meta.title || meta['제목'] || '';
    var subtitle = meta.subtitle || meta['부제'] || '';
    var form = meta['서식'] || meta.form || '';
    var kicker = meta['사업명'] || meta.kicker || '';
    var pairs = Object.keys(meta).filter(function (k) { return !special[k]; }).map(function (k) { return [k, meta[k]]; });
    if (!title && !subtitle && !kicker && !pairs.length) return null;
    var out = [];
    if (form) out.push(textPara(form, TPL.STYLE.normal, 1000));
    out.push(emptyPara()); out.push(emptyPara()); out.push(emptyPara());
    if (kicker) out.push(centerParaOf(kicker, TPL.CUSTOM.bold, 1300));
    if (title) out.push(centerParaOf(title, TPL.STYLE.h[1].char, 2600));
    if (subtitle) out.push(centerParaOf(subtitle, TPL.STYLE.h[2].char, 1600));
    out.push(emptyPara()); out.push(emptyPara());
    if (pairs.length) out.push(metaTable(pairs));
    out.push(pageBreakPara());
    return out;
  }

  /* 정부 양식 쪽 테두리: 원본 한글처럼 본문 전체를 4변 실선(borderFill 2) 1×1 표로 감쌈.
     - pageBreak="CELL" → 셀이 페이지를 넘기며 테두리 매 페이지 반복(미리보기 분할도 유지)
     - 외곽폭=본문 전체폭, 셀 좌우 여백=FRAME_PAD(안쪽 여백), 셀 높이=TEXT_H(페이지를 채움)
     - 첫 문단(secPr 보유)에 바로 임베드 → 프레임 위 빈 줄 없이 상단부터 시작 */
  function frameTbl(bodyParas) {
    var OUT_W = BASE_CONTENT_W;
    var body = bodyParas.join('') || textPara(' ', TPL.STYLE.normal, 1000);
    var tc = '<hp:tc name="" header="0" hasMargin="1" protect="0" editable="0" dirty="0" borderFillIDRef="2">' +
      '<hp:subList id="" textDirection="HORIZONTAL" lineWrap="BREAK" vertAlign="TOP" linkListIDRef="0" linkListNextIDRef="0" textWidth="0" textHeight="0" hasTextRef="0" hasNumRef="0">' + body + '</hp:subList>' +
      '<hp:cellAddr colAddr="0" rowAddr="0"/><hp:cellSpan colSpan="1" rowSpan="1"/>' +
      '<hp:cellSz width="' + OUT_W + '" height="' + TEXT_H + '"/><hp:cellMargin left="' + FRAME_PAD + '" right="' + FRAME_PAD + '" top="283" bottom="283"/></hp:tc>';
    return '<hp:tbl id="' + (++tblSeq) + '" zOrder="0" numberingType="TABLE" textWrap="TOP_AND_BOTTOM" textFlow="BOTH_SIDES" lock="0" dropcapstyle="None" pageBreak="CELL" repeatHeader="0" rowCnt="1" colCnt="1" cellSpacing="0" borderFillIDRef="2" noAdjust="0">' +
      '<hp:sz width="' + OUT_W + '" widthRelTo="ABSOLUTE" height="' + TEXT_H + '" heightRelTo="ABSOLUTE" protect="0"/>' +
      '<hp:pos treatAsChar="0" affectLSpacing="0" flowWithText="1" allowOverlap="0" holdAnchorAndSO="0" vertRelTo="PARA" horzRelTo="COLUMN" vertAlign="TOP" horzAlign="LEFT" vertOffset="0" horzOffset="0"/>' +
      '<hp:outMargin left="0" right="0" top="0" bottom="0"/><hp:inMargin left="0" right="0" top="0" bottom="0"/>' +
      '<hp:tr>' + tc + '</hp:tr></hp:tbl>';
  }
  function buildSection0(bodyParas, pageFrame) {
    var st = TPL.STYLE.normal;
    if (!bodyParas.length) bodyParas = [textPara(' ', st, 1000)];
    var firstInner = pageFrame ? (frameTbl(bodyParas) + '<hp:t/>') : '<hp:t/>';
    var first = '<hp:p id="0" paraPrIDRef="' + st.para + '" styleIDRef="' + st.style + '" pageBreak="0" columnBreak="0" merged="0"><hp:run charPrIDRef="' + st.char + '">' + TPL.SECPR + TPL.COLCTRL + firstInner + '</hp:run>' + lineseg(1000) + '</hp:p>';
    var rest = pageFrame ? '' : bodyParas.join('');
    return '<?xml version="1.0" encoding="UTF-8" standalone="yes" ?><hs:sec ' + SEC_NS + '>' + first + rest + '</hs:sec>';
  }

  /* ---------- 패키지 파일 (실제 한글 포맷) ---------- */
  var XMLDECL = '<?xml version="1.0" encoding="UTF-8" standalone="yes" ?>';
  var VERSION_XML = XMLDECL + '<hv:HCFVersion xmlns:hv="http://www.hancom.co.kr/hwpml/2011/version" tagetApplication="WORDPROCESSOR" major="5" minor="0" micro="5" buildNumber="0" os="1" xmlVersion="1.4" application="MDhwpify" appVersion="1.0"/>';
  var SETTINGS_XML = XMLDECL + '<ha:HWPApplicationSetting xmlns:ha="http://www.hancom.co.kr/hwpml/2011/app" xmlns:config="urn:oasis:names:tc:opendocument:xmlns:config:1.0"><ha:CaretPosition listIDRef="0" paraIDRef="0" pos="0"/></ha:HWPApplicationSetting>';
  var CONTAINER_XML = XMLDECL + '<ocf:container xmlns:ocf="urn:oasis:names:tc:opendocument:xmlns:container" xmlns:hpf="http://www.hancom.co.kr/schema/2011/hpf"><ocf:rootfiles><ocf:rootfile full-path="Contents/content.hpf" media-type="application/hwpml-package+xml"/><ocf:rootfile full-path="Preview/PrvText.txt" media-type="text/plain"/></ocf:rootfiles></ocf:container>';
  var MANIFEST_XML = XMLDECL + '<odf:manifest xmlns:odf="urn:oasis:names:tc:opendocument:xmlns:manifest:1.0"/>';
  function buildContentHpf(title) {
    var imgItems = imgList.map(function (im) { return '<opf:item id="' + im.binId + '" href="BinData/' + im.binId + '.' + im.ext + '" media-type="' + im.mime + '" isEmbeded="1"/>'; }).join('');
    return XMLDECL + '<opf:package ' + SEC_NS + ' version="" unique-identifier="" id=""><opf:metadata><opf:title>' + xmlEsc(title) + '</opf:title><opf:language>ko</opf:language><opf:meta name="creator" content="text">MDhwpify</opf:meta></opf:metadata>' +
      '<opf:manifest><opf:item id="header" href="Contents/header.xml" media-type="application/xml"/><opf:item id="section0" href="Contents/section0.xml" media-type="application/xml"/><opf:item id="settings" href="settings.xml" media-type="application/xml"/>' + imgItems + '</opf:manifest>' +
      '<opf:spine><opf:itemref idref="header" linear="yes"/><opf:itemref idref="section0" linear="yes"/></opf:spine></opf:package>';
  }

  function convert(md, tpl, settings) {
    if (!window.marked || !window.marked.lexer) return Promise.reject(new Error('marked 가 로드되지 않았습니다.'));
    if (!window.HWPX_TPL || !window.HWPX_TPL.STYLE) return Promise.reject(new Error('HWPX 양식 템플릿이 로드되지 않았습니다.'));
    var JSZip = window.hwpxjs && window.hwpxjs.JSZip;
    if (!JSZip) return Promise.reject(new Error('JSZip 이 로드되지 않았습니다.'));
    TPL = window.HWPX_TPL;

    var fm = parseFrontmatter(md || ''), meta = fm.meta, body = fm.body;
    var pageFrame = /있음|있다|true|1|on|y/i.test(String(meta['쪽테두리'] || meta['테두리'] || meta['pageBorder'] || ''));
    CONTENT_W = pageFrame ? (BASE_CONTENT_W - 2 * FRAME_PAD) : BASE_CONTENT_W;   /* 프레임 안쪽 폭으로 본문·표 생성 */
    var title = meta.title || meta['제목'] || '';
    var subtitle = meta.subtitle || meta['부제'] || '';
    if (title) body = body.replace(/^\s*#\s+(.*)\r?\n/, function (m0, h) { return h.trim() === title.trim() ? '' : m0; });

    /* 정부문서엔 들여쓰기(공백4+) 코드블록이 없음 → 감지 비활성(펜스 ```는 유지). 미리보기와 동일 규칙 */
    if (!window.marked.__noIndentCode) { window.marked.__noIndentCode = 1; window.marked.use({ tokenizer: { code: function () { return undefined; } } }); }
    var tokens = window.marked.lexer(body);
    numCtr = [0, 0, 0, 0, 0]; imgList = []; picSeq = 0;
    imgResolver = (settings && settings.imageResolver) || null;
    var cover = coverParas(meta);
    var bodyParas = cover ? cover.slice() : [];
    if (!cover) {
      if (title) bodyParas.push(paraOf([{ c: TPL.STYLE.h[1].char, t: title }], TPL.STYLE.h[1], HH[1]));
      if (subtitle) bodyParas.push(paraOf([{ c: TPL.STYLE.h[2].char, t: subtitle }], TPL.STYLE.h[2], HH[2]));
    }
    blocks(tokens, bodyParas);

    var section0 = buildSection0(bodyParas, pageFrame);
    var prvText = (title ? title + '\n' : '') + tokens.map(function (t) { return (t.type === 'paragraph' || t.type === 'heading') ? inlineText(t.tokens) : ''; }).filter(Boolean).join('\n').slice(0, 2000);

    var z = new JSZip();
    z.file('mimetype', 'application/hwp+zip', { compression: 'STORE' });
    z.file('version.xml', TPL.VERSION || VERSION_XML);
    z.file('settings.xml', TPL.SETTINGS || SETTINGS_XML);
    z.file('META-INF/container.xml', CONTAINER_XML);
    z.file('META-INF/manifest.xml', MANIFEST_XML);
    z.file('Contents/content.hpf', buildContentHpf(title));
    z.file('Contents/header.xml', TPL.HEADER);
    z.file('Contents/section0.xml', section0);
    z.file('Preview/PrvText.txt', prvText || (title || 'MDhwpify'));
    imgList.forEach(function (im) { z.file('BinData/' + im.binId + '.' + im.ext, im.bytes); });
    return z.generateAsync({ type: 'blob', mimeType: 'application/hwp+zip', compression: 'DEFLATE' });
  }

  window.MD2HWPX = { convert: convert };
})();
