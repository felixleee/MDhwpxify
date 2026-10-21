/* md2hwpx (MDhwpify) 핵심: Markdown -> .hwpx (Blob) — 정부과제 보고서 양식 초안 생성용.
 *
 * 템플릿 구동: window.HWPX_TPL(정부 양식 header + 스타일맵)에 md를 매핑.
 *   - 헤딩 H1~H4  → 제목 1~4단계 (번호 없이 스타일만)
 *   - 목록 depth 1~4 → 본문 1~4단계 + 정부 불릿(□ ○ ▪ -) 리터럴
 *   - 표         → 표제목(머리, 회색 채움)/표내용(셀) + 그리드 borderFill
 *   - 인라인      → 굵게/기울임/코드/취소선/링크 (gov header에 추가한 커스텀 charPr)
 *   - ```mermaid  → 미리보기와 같은 DIAG SVG 를 PNG(2배 해상도)로 그려 가운데 그림 문단으로(미지원 종류는 코드 그대로)
 *   - 이미지      → png/jpg/gif/bmp 는 원본 그대로, 그 밖(붙여넣기 WebP·SVG 등)은 PNG 로 바꿔 실제 크기로
 * 무접두사 OWPML 직접 방출. 제어문자(탭 등)는 cleanText로 제거(한글 크래시 방지), XML 에 못 쓰는 글자는 xmlEsc 에서 버림.
 * 노출: window.MD2HWPX.convert(md, tpl, settings) -> Promise<Blob>
 */
(function () {
  'use strict';
  var BASE_CONTENT_W = 49324;   // 본문폭 HWPUNIT (pagePr 59528 - 좌우여백 5102*2)
  var CONTENT_W = BASE_CONTENT_W;   // 쪽 테두리 시 프레임 안쪽 여백만큼 축소됨(convert에서 설정)
  var FRAME_PAD = 1300;   // 쪽 테두리 프레임 좌우 안쪽 여백(HWPUNIT ≈4.6mm)
  var TEXT_H = 75684;     // 본문 세로 높이(page 84188 - 상하여백 4252*2) — 프레임이 페이지를 채우도록
  var CELLM = 'left="510" right="510" top="141" bottom="141"';   // 표 셀 안쪽 여백(프레임 문서는 원본 맞춰 360 사방)
  var TPL = null;

  /* XML 1.0 에 쓸 수 없는 글자(제어 문자 U+0000–0008·000B·000C·000E–001F, U+FFFE/FFFF, 짝 없는 서로게이트)는 버린다.
     PDF·Word 에서 복사한 글에 섞여 들어오며, 남으면 한글이 문서를 손상된 파일로 본다. */
  var XML_BAD = /[\x00-\x08\x0B\x0C\x0E-\x1F￾￿]|[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g;
  function xmlEsc(s) { return String(s == null ? '' : s).replace(XML_BAD, '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
  function cleanText(s) { return String(s == null ? '' : s).replace(/[\t\r\n\v\f]+/g, ' '); }

  /* ---------- 이미지 (hp:pic + BinData 임베드). href=data URI 만 처리 ---------- */
  var imgList = [];   // {binId, ext, mime, bytes}
  var picSeq = 0;
  var imgResolver = null;   // (src)->{bytes,ext}|Uint8Array|null : data URI 아닌 상대경로 이미지 공급(앱: md 옆 파일 읽기)
  var imgMap = {};   // href → 미리 정리한 이미지 {bytes,ext,mime,w?,h?} (변환마다 resolveImages 결과로 교체)
  function dataUriBytes(uri) {
    var m = /^data:([^,]*),([\s\S]*)$/.exec(uri || '');   /* ;charset=… 같은 매개변수가 끼어도 받음 */
    if (!m) return null;
    var head = m[1].split(';'), mime = (head[0] || '').trim().toLowerCase() || 'image/png', data = m[2], bin;
    var isB64 = head.slice(1).some(function (p) { return p.trim().toLowerCase() === 'base64'; });
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
  /* 실제 바이트로 형식 판별 — 한글이 확실히 읽는 png/jpg/gif/bmp 만, 그 밖(WebP·SVG 등)은 null */
  function sniffImg(b) {
    if (!b || b.length < 4) return null;
    if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4E && b[3] === 0x47) return 'png';
    if (b[0] === 0xFF && b[1] === 0xD8) return 'jpg';
    if (b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46) return 'gif';
    if (b[0] === 0x42 && b[1] === 0x4D) return 'bmp';
    return null;
  }
  /* src → {bytes, ext, mime, hint}. ext·mime 은 바이트로 정한다(이름과 내용이 달라도 맞게, content.hpf 속성엔 안전한 글자만).
     hint = 원래 알려진 mime(PNG 변환 때 SVG 판별용) */
  function srcInfo(href, resolver) {
    var info = null;
    if (/^data:/.test(href || '')) info = dataUriBytes(href);
    else if (resolver) {
      var r = resolver(href);
      if (r) { var bytes = r.bytes || r; var ext = (r.ext || (href.split('?')[0].split('.').pop() || 'png')).toLowerCase(); if (ext === 'jpeg') ext = 'jpg'; if (bytes && bytes.length) info = { bytes: bytes, ext: ext, mime: 'image/' + ext }; }
    }
    if (!info) return null;
    info.hint = info.mime;
    var k = sniffImg(info.bytes);
    if (k) { info.ext = k; info.mime = 'image/' + k; }
    else { info.ext = String(info.ext || '').replace(/[^a-z0-9]/gi, '').toLowerCase() || 'bin'; info.mime = 'image/' + info.ext; }
    return info;
  }
  function addImage(tok, maxW, maxH) {
    var ps = parseImgSpec(typeof tok === 'string' ? { href: tok } : tok);
    var info = imgMap[ps.href] || srcInfo(ps.href, imgResolver);   /* 보통은 resolveImages 가 미리 정리해 둔 것 */
    if (!info) return null;
    var binId = 'image' + (imgList.length + 1);
    imgList.push({ binId: binId, ext: info.ext, mime: info.mime, bytes: info.bytes });
    var nat = info.w ? { w: info.w, h: info.h } : imageSize(info.bytes);
    if (!nat.w || !nat.h) nat = { w: 400, h: 300 };   /* 헤더가 깨져 크기 0 → 0 나눗셈(NaN) 방지 */
    var disp = applyImgSpec(ps.spec, nat.w, nat.h, Math.round((maxW || CONTENT_W) / PX));
    return buildPic(binId, disp.w, disp.h, maxW, maxH);
  }
  /* 다이어그램 PNG → hp:pic. png={data,w,h}: 2배 해상도로 그린 비트맵을 논리 크기(w×h px)로 배치 → 인쇄·확대해도 선명 */
  function addPng(png, maxW, maxH) {
    if (!png || !png.data || !png.data.length) return null;
    var binId = 'image' + (imgList.length + 1);
    imgList.push({ binId: binId, ext: 'png', mime: 'image/png', bytes: png.data });
    return buildPic(binId, png.w, png.h, maxW, maxH);
  }

  /* ---------- 다이어그램(mermaid) → PNG 사전 렌더 (async; MDocify md2docx 와 같은 방식) ----------
     미리보기(app.js)는 ```mermaid 를 DIAG.render 로 SVG 를 그리는데, 예전 hwpx 는 코드 줄을 그대로 넣어 산출물이 달랐다.
     SVG→canvas(2배)→PNG 로 래스터화해 t._png 로 붙여 두면 blocks() 가 그림 문단으로 낸다.
     판정 규칙은 미리보기와 동일: 언어가 mermaid 인 블록만(이름 없는 블록은 그대로), 미지원 종류는 코드 그대로 둔다. */
  function svgToPng(svg) {
    return new Promise(function (resolve, reject) {
      /* 루트에 width/height 가 없으면 viewBox 로 채움(없으면 <img> 가 300×150 기본값으로 그려 잘림) */
      svg = String(svg).replace(/<svg\b[^>]*>/, function (tag) {
        if (/\swidth=/.test(tag) && /\sheight=/.test(tag)) return tag;
        var vb = /viewBox="\s*[-\d.]+\s+[-\d.]+\s+([\d.]+)\s+([\d.]+)\s*"/.exec(tag);
        return vb ? tag.replace(/^<svg/, '<svg width="' + vb[1] + '" height="' + vb[2] + '"') : tag;
      });
      var url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml;charset=utf-8' }));
      var img = new Image();
      img.onload = function () {
        var nw = img.naturalWidth || 800, nh = img.naturalHeight || 400, scale = 2;
        var c = document.createElement('canvas'); c.width = Math.round(nw * scale); c.height = Math.round(nh * scale);
        var g = c.getContext('2d'); g.fillStyle = '#ffffff'; g.fillRect(0, 0, c.width, c.height); g.drawImage(img, 0, 0, c.width, c.height);
        URL.revokeObjectURL(url);
        c.toBlob(function (b) { if (!b) { reject(new Error('toBlob 실패')); return; } b.arrayBuffer().then(function (ab) { resolve({ data: new Uint8Array(ab), w: nw, h: nh }); }, reject); }, 'image/png');
      };
      img.onerror = function () { URL.revokeObjectURL(url); reject(new Error('SVG 로드 실패')); };
      img.src = url;
    });
  }
  function isMermaid(t) { return t.type === 'code' && (t.lang || '').trim().toLowerCase() === 'mermaid'; }
  function renderDiagram(t) {
    return Promise.resolve().then(function () {
      if (!window.DIAG || typeof document === 'undefined') return;
      var kind = window.DIAG.detectKind(t.text || '');
      if (!kind) return;   /* 미지원 종류 → 코드 블록 그대로(원문 보존) */
      return svgToPng(window.DIAG.render(kind, t.text || '')).then(function (png) { t._png = png; });
    }).catch(function () { /* 래스터화 실패 → 코드 블록으로 폴백 */ });
  }
  function resolveDiagrams(tokens) {
    var jobs = [];
    (function walk(toks) {
      (toks || []).forEach(function (t) {
        if (isMermaid(t)) jobs.push(renderDiagram(t));
        if (t.tokens) walk(t.tokens);
        if (t.items) walk(t.items);
      });
    })(tokens);
    return Promise.all(jobs);
  }

  /* ---------- 이미지 형식 정리 (async) ----------
     붙여넣기·끌어 넣기 이미지는 앱이 WebP 로 줄여 담고(SVG 는 그대로), WebP·SVG 는 크기를 못 읽어 400×300(4:3)으로 찌그러지고
     한글에 따라 아예 안 보인다 → png/jpg/gif/bmp 가 아니면 브라우저로 디코드해 PNG(실제 픽셀 크기, SVG 는 2배로 선명하게)로 바꿔 둔다.
     문서의 모든 이미지를 href 별로 한 번씩 읽어 맵으로 돌려준다(모듈 상태는 건드리지 않음 — 변환이 겹쳐도 안전). */
  function bytesToPng(bytes, hint) {
    var head = '';
    try { head = new TextDecoder().decode(bytes.subarray(0, 512)); } catch (e) { }
    if (/svg/i.test(hint || '') || /<svg[\s>]/i.test(head)) return svgToPng(new TextDecoder().decode(bytes));
    return new Promise(function (resolve, reject) {
      var url = URL.createObjectURL(new Blob([bytes], { type: hint || 'application/octet-stream' }));
      var img = new Image();
      img.onload = function () {
        var w = img.naturalWidth, h = img.naturalHeight;
        if (!w || !h) { URL.revokeObjectURL(url); reject(new Error('이미지 크기 없음')); return; }
        var c = document.createElement('canvas'); c.width = w; c.height = h;
        c.getContext('2d').drawImage(img, 0, 0);   /* 투명도는 PNG 로 그대로 */
        URL.revokeObjectURL(url);
        c.toBlob(function (b) { if (!b) { reject(new Error('toBlob 실패')); return; } b.arrayBuffer().then(function (ab) { resolve({ data: new Uint8Array(ab), w: w, h: h }); }, reject); }, 'image/png');
      };
      img.onerror = function () { URL.revokeObjectURL(url); reject(new Error('이미지 디코드 실패')); };
      img.src = url;
    });
  }
  function collectImgHrefs(tokens) {
    var set = {};
    function add(h) { if (h) set[h] = 1; }
    (function walk(toks) {
      (toks || []).forEach(function (t) {
        if (!t) return;
        if (t.type === 'image') add(parseImgSpec(t).href);
        if (t.type === 'html' && /<table/i.test(t.text || '')) {   /* HTML 표 안 <img> (segRuns 와 같은 추출) */
          var re = /<img\b[^>]*>/gi, m;
          while ((m = re.exec(t.text))) { var src = (m[0].match(/src\s*=\s*["']([^"']+)["']/i) || [])[1]; if (src) add(parseImgSpec({ href: src }).href); }
        }
        if (t.tokens) walk(t.tokens);
        if (t.items) walk(t.items);
        if (t.header) t.header.forEach(function (c) { walk(c.tokens); });   /* GFM 표 셀 */
        if (t.rows) t.rows.forEach(function (r) { r.forEach(function (c) { walk(c.tokens); }); });
      });
    })(tokens);
    return Object.keys(set);
  }
  function resolveImages(tokens, resolver) {
    var map = {};
    var canDecode = typeof document !== 'undefined' && typeof Image !== 'undefined';
    var jobs = collectImgHrefs(tokens).map(function (href) {
      var info = srcInfo(href, resolver);
      if (!info) return null;
      map[href] = info;
      if (sniffImg(info.bytes) || !canDecode) return null;   /* 한글이 읽는 형식 → 원본 그대로 */
      return bytesToPng(info.bytes, info.hint).then(function (png) {
        map[href] = { bytes: png.data, ext: 'png', mime: 'image/png', w: png.w, h: png.h };
      }, function () { /* 디코드 실패 → 원본 그대로(예전 동작) */ });
    });
    return Promise.all(jobs).then(function () { return map; });
  }
  /* 다이어그램 그림 문단: 가운데 정렬(TPL.CENTER) + 줄 높이=그림 높이(lineseg 캐시가 그림보다 낮으면 한글이 겹쳐 그릴 수 있음) */
  function picPara(pic) {
    var m = /<hp:curSz width="\d+" height="(\d+)"/.exec(pic), h = m ? +m[1] : 1000;
    return '<hp:p id="0" paraPrIDRef="' + TPL.CENTER + '" styleIDRef="0" pageBreak="0" columnBreak="0" merged="0"><hp:run charPrIDRef="' + TPL.STYLE.normal.char + '">' + pic + '</hp:run>' + lineseg(h) + '</hp:p>';
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
    var ordered = !!list.ordered, start = parseInt(list.start, 10); if (isNaN(start)) start = 1;
    (list.items || []).forEach(function (it, idx) {
      var marker = ordered ? ((start + idx) + ')') : bullet;   /* 번호목록은 원본처럼 'N)', 아니면 불릿(□○▪-) */
      var inl = [], nested = [];
      (it.tokens || []).forEach(function (x) {
        if (x.type === 'list') nested.push(x);
        else if (x.type === 'text' || x.type === 'paragraph') inl = inl.concat(inlineRuns(x.tokens || [{ type: 'text', text: x.text }], st.char));
        else if (x.type !== 'space') inl = inl.concat(inlineRuns(x.tokens || [], st.char));
      });
      out.push(paraOf([{ c: st.char, t: marker + ' ' }].concat(inl), st, 1200));
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
      '<hp:cellSz width="' + w + '" height="' + h + '"/><hp:cellMargin ' + CELLM + '/></hp:tc>';
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
    var tbl = '<hp:tbl id="' + (++tblSeq) + '" zOrder="0" numberingType="TABLE" textWrap="TOP_AND_BOTTOM" textFlow="BOTH_SIDES" lock="0" dropcapstyle="None" pageBreak="NONE" repeatHeader="1" rowCnt="' + rowCnt + '" colCnt="' + colCnt + '" cellSpacing="0" borderFillIDRef="' + GRID + '" noAdjust="0">' +
      '<hp:sz width="' + CONTENT_W + '" widthRelTo="ABSOLUTE" height="' + (rowH * rowCnt) + '" heightRelTo="ABSOLUTE" protect="0"/>' +
      '<hp:pos treatAsChar="1" affectLSpacing="0" flowWithText="1" allowOverlap="0" holdAnchorAndSO="0" vertRelTo="PARA" horzRelTo="COLUMN" vertAlign="TOP" horzAlign="LEFT" vertOffset="0" horzOffset="0"/>' +
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
    var rowH = 2100, GRID = TPL.TABLE.grid, HEAD = TPL.TABLE.headFill;   /* 셀 상하 높이 축소(2400→2100)로 표 컴팩트화(원본에 가깝게) */
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
    var tbl = '<hp:tbl id="' + (++tblSeq) + '" zOrder="0" numberingType="TABLE" textWrap="TOP_AND_BOTTOM" textFlow="BOTH_SIDES" lock="0" dropcapstyle="None" pageBreak="NONE" repeatHeader="1" rowCnt="' + t.rowCount + '" colCnt="' + t.colCount + '" cellSpacing="0" borderFillIDRef="' + GRID + '" noAdjust="' + (useCg ? '1' : '0') + '">' +
      '<hp:sz width="' + CONTENT_W + '" widthRelTo="ABSOLUTE" height="' + (rowH * t.rowCount) + '" heightRelTo="ABSOLUTE" protect="0"/>' +
      '<hp:pos treatAsChar="1" affectLSpacing="0" flowWithText="1" allowOverlap="0" holdAnchorAndSO="0" vertRelTo="PARA" horzRelTo="COLUMN" vertAlign="TOP" horzAlign="LEFT" vertOffset="0" horzOffset="0"/>' +
      '<hp:outMargin left="283" right="283" top="283" bottom="283"/><hp:inMargin left="510" right="510" top="141" bottom="141"/>' + trs + '</hp:tbl>';
    return '<hp:p id="0" paraPrIDRef="' + TPL.STYLE.normal.para + '" styleIDRef="' + TPL.STYLE.normal.style + '" pageBreak="0" columnBreak="0" merged="0"><hp:run charPrIDRef="' + TPL.STYLE.normal.char + '">' + tbl + '<hp:t/></hp:run>' + lineseg(1000) + '</hp:p>';
  }

  /* 목차(```toc): 각 줄 "들여쓰기(레벨=앞 공백수) + 항목  쪽번호(뒤 정수)" → 점선(leader=3) 우측정렬(type=2) 탭으로 정부양식 목차 재현.
     원본과 동일 방식(paraPr tabPr 없이 탭 자체 속성). 탭 width는 근사치(한글이 열 때 재계산). */
  function tocBlocks(text, out) {
    String(text || '').replace(/\n+$/, '').split('\n').forEach(function (ln) {
      if (!ln.trim()) return;
      var level = Math.min(3, (ln.match(/^ */)[0] || '').length);   // 앞 공백 1칸 = 1레벨
      var CH = level === 0 ? TPL.STYLE.h[4].char : TPL.STYLE.body[1].char;   // 대분류(1./2.)=12pt 굵게, 그 외=12pt 보통(원본과 동일)
      var b = ln.replace(/^\s+/, '');
      var m = /^(.*\S)\s+(\d+)$/.exec(b);
      if (!m) { out.push(centerParaOf(b, TPL.STYLE.h[2].char, 1400)); return; }   // 쪽번호 없는 줄 = 가운데 큰 제목("목 차")
      var entry = m[1], page = m[2];
      var entryTxt = new Array(level + 1).join('　') + entry;   // 레벨당 전각공백 1
      /* paraPrIDRef="23"(tabPrIDRef=3: 우측정렬 탭+leader) 사용 → 뷰어가 <hp:tab/>을 우측 끝으로 점선정렬(원본 목차와 동일 방식). 인라인 width는 뷰어가 무시함 */
      var runs = '<hp:run charPrIDRef="' + CH + '"><hp:t>' + xmlEsc(cleanText(entryTxt)) + '</hp:t></hp:run>' +
        '<hp:run charPrIDRef="' + CH + '"><hp:t><hp:tab leader="3" type="2"/>' + xmlEsc(page) + '</hp:t></hp:run>';
      out.push('<hp:p id="0" paraPrIDRef="23" styleIDRef="0" pageBreak="0" columnBreak="0" merged="0">' + runs + lineseg(1200, CONTENT_W) + '</hp:p>');
    });
  }

  function blocks(tokens, out) {
    out = out || [];
    (tokens || []).forEach(function (t) {
      switch (t.type) {
        case 'heading': { var d = Math.min(t.depth, 4), st = TPL.STYLE.h[d]; out.push(paraOf([{ c: st.char, t: numberHeading(inlineText(t.tokens), d) }], st, HH[d])); } break;
        case 'paragraph': out.push(paraOf(inlineRuns(t.tokens, TPL.STYLE.normal.char), TPL.STYLE.normal, 1000)); break;
        case 'text': out.push(paraOf(t.tokens ? inlineRuns(t.tokens, TPL.STYLE.normal.char) : [{ c: TPL.STYLE.normal.char, t: decode(t.text) }], TPL.STYLE.normal, 1000)); break;
        case 'blockquote': blocks(t.tokens, out); break;
        case 'code': {
          var dpic = t._png ? addPng(t._png) : null;   /* resolveDiagrams 가 그려 둔 mermaid → 그림 문단 */
          if (dpic) out.push(picPara(dpic));
          else if ((t.lang || '').toLowerCase() === 'toc') tocBlocks(t.text, out);
          else String(t.text || '').replace(/\n$/, '').split('\n').forEach(function (ln) { out.push(paraOf([{ c: TPL.CUSTOM.code, t: ln || ' ' }], TPL.STYLE.normal, 1000)); });
        } break;
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
      '<hp:pos treatAsChar="1" affectLSpacing="0" flowWithText="1" allowOverlap="0" holdAnchorAndSO="0" vertRelTo="PARA" horzRelTo="COLUMN" vertAlign="TOP" horzAlign="LEFT" vertOffset="0" horzOffset="0"/>' +
      '<hp:outMargin left="283" right="283" top="283" bottom="283"/><hp:inMargin left="510" right="510" top="141" bottom="141"/>' + trs + '</hp:tbl>';
    return '<hp:p id="0" paraPrIDRef="' + TPL.STYLE.normal.para + '" styleIDRef="' + TPL.STYLE.normal.style + '" pageBreak="0" columnBreak="0" merged="0"><hp:run charPrIDRef="' + TPL.STYLE.normal.char + '">' + tbl + '<hp:t/></hp:run>' + lineseg(1000) + '</hp:p>';
  }
  /* 표지 회색 박스: 사업명(윗줄) + 제목(아랫줄, 큼) 를 가운데 정렬 1×1 회색 표(headFill)로. 페이지 가운데 배치. */
  function coverBox(kicker, title) {
    var W = BASE_CONTENT_W, HEAD = 14;   // 원본처럼 거의 페이지 폭 + 회색 박스(#DFDFDF, borderFill 14)
    var st = { style: 0, para: TPL.CENTER, char: TPL.STYLE.body[1].char };
    var lines = [];
    if (kicker) lines.push([{ c: 38, t: kicker }]);   // 사업명 22pt
    if (title) lines.push([{ c: 37, t: title }]);     // 제목 26pt 굵게(원본값)
    var rowH = 7100;   // 박스 높이(원본 ≈25mm)
    var tc = tblCell(lines, st, 0, 0, W, rowH, HEAD, false, 1, 1);
    var tbl = '<hp:tbl id="' + (++tblSeq) + '" zOrder="0" numberingType="TABLE" textWrap="TOP_AND_BOTTOM" textFlow="BOTH_SIDES" lock="0" dropcapstyle="None" pageBreak="NONE" repeatHeader="0" rowCnt="1" colCnt="1" cellSpacing="0" borderFillIDRef="' + HEAD + '" noAdjust="0">' +
      '<hp:sz width="' + W + '" widthRelTo="ABSOLUTE" height="' + rowH + '" heightRelTo="ABSOLUTE" protect="0"/>' +
      '<hp:pos treatAsChar="1" affectLSpacing="0" flowWithText="1" allowOverlap="0" holdAnchorAndSO="0" vertRelTo="PARA" horzRelTo="COLUMN" vertAlign="TOP" horzAlign="CENTER" vertOffset="0" horzOffset="0"/>' +
      '<hp:outMargin left="0" right="0" top="0" bottom="0"/><hp:inMargin left="510" right="510" top="283" bottom="283"/>' +
      '<hp:tr>' + tc + '</hp:tr></hp:tbl>';
    return '<hp:p id="0" paraPrIDRef="' + TPL.CENTER + '" styleIDRef="0" pageBreak="0" columnBreak="0" merged="0"><hp:run charPrIDRef="' + TPL.STYLE.normal.char + '">' + tbl + '<hp:t/></hp:run>' + lineseg(1000, CONTENT_W) + '</hp:p>';
  }
  function coverParas(meta) {
    var client = meta['고객사'] || meta['도입기업'] || '';
    var kicker = meta['사업명'] || meta.kicker || '';
    var title = meta.title || meta['제목'] || '';
    var subtitle = meta.subtitle || meta['부제'] || '';
    var date = meta['작성일'] || meta.date || '';
    var maker = meta['작성기관'] || meta.publisher || '';
    var special = { title: 1, subtitle: 1, '제목': 1, '부제': 1, '서식': 1, form: 1, kicker: 1, '사업명': 1, '쪽테두리': 1, '테두리': 1, pageBorder: 1, '고객사': 1, '도입기업': 1, '작성일': 1, date: 1, '작성기관': 1, publisher: 1 };
    var pairs = Object.keys(meta).filter(function (k) { return !special[k]; }).map(function (k) { return [k, meta[k]]; });
    if (!client && !kicker && !title && !subtitle && !date && !maker && !pairs.length) return null;
    var out = [], i;
    for (i = 0; i < 10; i++) out.push(emptyPara());   // 상단 여백(원본처럼 크게 → 고객사·박스가 ~25% 지점에서 시작)
    if (client) out.push(centerParaOf(client, 39, 2400));   // 고객사 20pt 굵게(상단)
    out.push(emptyPara());
    if (kicker || title) out.push(coverBox(kicker, title));
    if (subtitle) { out.push(emptyPara()); out.push(centerParaOf(subtitle, 38, 2600)); }
    for (i = 0; i < 11; i++) out.push(emptyPara());   // 박스→작성일 간격
    if (date) out.push(centerParaOf(date, 39, 2400));   // 작성일 20pt 굵게
    for (i = 0; i < 10; i++) out.push(emptyPara());   // 작성일→작성기관 간격(작성기관 더 아래로)
    if (maker) out.push(centerParaOf(maker, 38, 2600));   // 작성기관 22pt(하단)
    if (pairs.length) { out.push(emptyPara()); out.push(metaTable(pairs)); }
    return out;   /* 페이지 나눔은 다음 그룹(목차/본문) 첫 문단의 pageBreak로 처리 */
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
  /* 첫 문단 first run 앞에 secPr·컬럼·쪽번호 컨트롤 삽입($ 이스케이프 회피 위해 함수 치환) */
  function injectHead(p, head) { return p.replace(/<hp:run[^>]*>/, function (m) { return m + head; }); }
  /* 문단 자체를 새 페이지에서 시작(첫 <hp:p>의 pageBreak="0"→"1"). 빈 문단 없이 깔끔한 페이지 나눔 */
  function breakBefore(p) { return p.replace('pageBreak="0"', 'pageBreak="1"'); }
  /* preParas=프레임 밖(표지·목차, 테두리 없음·강제 페이지나눔 동작), framedParas=프레임 안(본문, 테두리 반복).
     표 셀 안에선 pageBreak가 무시되므로 표지·목차는 프레임 밖에 둬야 페이지가 정상 나뉜다(원본과 동일). */
  function buildSection0(preParas, framedParas, pageFrame) {
    var st = TPL.STYLE.normal;
    /* 용지 여백(②상태): 머리말·꼬리말 예약 제거(0), 상/하 15mm·좌우 18mm. 본문 세로영역 267mm = 미리보기 일치. */
    var secpr = TPL.SECPR.replace(/<hp:margin [^>]*\/>/, '<hp:margin header="0" footer="0" gutter="0" left="5102" right="5102" top="4252" bottom="4252"/>');
    var secHead = secpr + TPL.COLCTRL;   /* 섹션 속성: 반드시 첫 문단 */
    /* 쪽번호: '쪽 번호 매기기'(pageNum)를 본문 첫 문단에 둠 → 앞의 표지·목차엔 번호 안 붙고, newNum=1로 본문 첫 쪽이 "- 1 -"(원본과 동일) */
    var PAGENUM = '<hp:ctrl><hp:pageNum pos="BOTTOM_CENTER" formatType="DIGIT" sideChar="-"/></hp:ctrl><hp:ctrl><hp:newNum num="1" numType="PAGE"/></hp:ctrl>';
    var out = '';
    if (pageFrame) {
      var framed = framedParas.length ? framedParas : [textPara(' ', st, 1000)];
      var brk = preParas.length ? '1' : '0';   /* 표지·목차 뒤면 본문(프레임)은 새 페이지부터 */
      var frameRun = (preParas.length ? PAGENUM : secHead + PAGENUM) + frameTbl(framed);
      var frameP = '<hp:p id="0" paraPrIDRef="' + st.para + '" styleIDRef="' + st.style + '" pageBreak="' + brk + '" columnBreak="0" merged="0"><hp:run charPrIDRef="' + st.char + '">' + frameRun + '<hp:t/></hp:run>' + lineseg(1000) + '</hp:p>';
      if (preParas.length) out += injectHead(preParas[0], secHead) + preParas.slice(1).join('');
      out += frameP;
    } else {
      var pre = preParas.slice(), fr = framedParas.slice();
      if (pre.length && fr.length) fr[0] = breakBefore(fr[0]);   /* 표지·목차 뒤면 본문 새 페이지부터 */
      var all = pre.concat(fr);
      if (!all.length) all = [textPara(' ', st, 1000)];
      if (pre.length && fr.length) { all[0] = injectHead(all[0], secHead); all[pre.length] = injectHead(all[pre.length], PAGENUM); }
      else all[0] = injectHead(all[0], secHead + PAGENUM);
      out += all.join('');
    }
    return '<?xml version="1.0" encoding="UTF-8" standalone="yes" ?><hs:sec ' + SEC_NS + '>' + out + '</hs:sec>';
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
    var pageFrame = !!(settings && settings.pageFrame);   /* 테두리는 문서 설정(UI)으로 전달 */
    var title = meta.title || meta['제목'] || '';
    var subtitle = meta.subtitle || meta['부제'] || '';
    if (title) body = body.replace(/^\s*#\s+(.*)\r?\n/, function (m0, h) { return h.trim() === title.trim() ? '' : m0; });

    /* 정부문서엔 들여쓰기(공백4+) 코드블록이 없음 → 감지 비활성(펜스 ```는 유지). 미리보기와 동일 규칙 */
    if (!window.marked.__noIndentCode) { window.marked.__noIndentCode = 1; window.marked.use({ tokenizer: { code: function () { return undefined; } } }); }
    var tokens = window.marked.lexer(body);

    /* 다이어그램(mermaid) PNG 와 이미지 형식 정리를 먼저 끝낸다(비동기). 모듈 상태(CONTENT_W·CELLM·imgList·imgMap 등)는
       그 뒤 동기 구간에서만 설정한다 — 저장을 연달아 눌러 변환이 겹쳐도 서로의 상태를 섞지 않게. */
    var resolver = (settings && settings.imageResolver) || null;
    return Promise.all([resolveDiagrams(tokens), resolveImages(tokens, resolver)]).then(function (res) {
      CONTENT_W = pageFrame ? (BASE_CONTENT_W - 2 * FRAME_PAD - 566) : BASE_CONTENT_W;   /* 프레임 안쪽 폭으로 본문·표 생성(내부표 바깥여백 283*2=566 버퍼로 셀 넘침 방지) */
      CELLM = pageFrame ? 'left="360" right="360" top="240" bottom="240"' : 'left="510" right="510" top="141" bottom="141"';   /* 프레임: 좌우 360 유지, 상하만 360→240 축소(표 컴팩트) */
      numCtr = [0, 0, 0, 0, 0]; imgList = []; picSeq = 0;
      imgResolver = resolver; imgMap = res[1] || {};
      var coverP = coverParas(meta) || [];   /* 프레임 밖: 표지 */
      if (!coverP.length) {
        if (title) coverP.push(paraOf([{ c: TPL.STYLE.h[1].char, t: title }], TPL.STYLE.h[1], HH[1]));
        if (subtitle) coverP.push(paraOf([{ c: TPL.STYLE.h[2].char, t: subtitle }], TPL.STYLE.h[2], HH[2]));
      }
      var tocP = [], framedParas = [], tocSeen = false;   /* tocP=프레임 밖 목차, framedParas=프레임 안 본문 */
      (tokens || []).forEach(function (t) {
        if (!tocSeen && t.type === 'code' && (t.lang || '').toLowerCase() === 'toc') { blocks([t], tocP); tocSeen = true; }
        else blocks([t], framedParas);
      });
      if (coverP.length && tocP.length) tocP[0] = breakBefore(tocP[0]);   /* 표지 뒤 목차는 새 페이지부터 */
      /* 표지·목차 페이지는 쪽번호 숨김(원본과 동일: 본문부터 번호). pageNum은 본문 첫 문단(buildSection0) */
      var PAGEHIDE = '<hp:ctrl><hp:pageHiding hideHeader="0" hideFooter="0" hideMasterPage="0" hideBorder="0" hideFill="0" hidePageNum="1"/></hp:ctrl>';
      if (coverP.length) coverP[0] = injectHead(coverP[0], PAGEHIDE);
      if (tocP.length) tocP[0] = injectHead(tocP[0], PAGEHIDE);
      var preParas = coverP.concat(tocP);

      var section0 = buildSection0(preParas, framedParas, pageFrame);
      /* 표지용 큰 글자 charPr 추가(37=24pt굵게 제목·38=20pt 작성기관·39=16pt 고객사/사업명·40=14pt 작성일) → 헤더에 주입 */
      function mkCP(baseId, newId, h) { var b = new RegExp('<hh:charPr id="' + baseId + '"[\\s\\S]*?</hh:charPr>').exec(TPL.HEADER); return b ? b[0].replace('id="' + baseId + '"', 'id="' + newId + '"').replace(/height="\d+"/, 'height="' + h + '"').replace(/<hh:fontRef [^>]*\/>/, '<hh:fontRef hangul="3" latin="3" hanja="3" japanese="3" other="3" symbol="3" user="3"/>') : ''; }   /* 표지 글꼴 = 바탕체(id 3, 원본과 동일) */
      var coverCP = mkCP(9, 37, 2600) + mkCP(1, 38, 2200) + mkCP(9, 39, 2000);   // 37=제목26pt굵게, 38=사업명·작성기관22pt, 39=고객사·작성일20pt굵게 (원본값)
      var bf7 = /<hh:borderFill id="7"[\s\S]*?<\/hh:borderFill>/.exec(TPL.HEADER)[0];
      var bf14 = bf7.replace('id="7"', 'id="14"').replace('faceColor="#F2F3F9"', 'faceColor="#DFDFDF"');   // 표지 박스 회색(#DFDFDF, 원본과 동일)
      var headerXml = TPL.HEADER
        .replace('</hh:charProperties>', coverCP + '</hh:charProperties>').replace(/<hh:charProperties itemCnt="\d+">/, '<hh:charProperties itemCnt="40">')
        .replace('</hh:borderFills>', bf14 + '</hh:borderFills>').replace(/<hh:borderFills itemCnt="\d+">/, '<hh:borderFills itemCnt="14">');
      var prvText = (title ? title + '\n' : '') + tokens.map(function (t) { return (t.type === 'paragraph' || t.type === 'heading') ? inlineText(t.tokens) : ''; }).filter(Boolean).join('\n').slice(0, 2000);

      var z = new JSZip();
      z.file('mimetype', 'application/hwp+zip', { compression: 'STORE' });
      z.file('version.xml', TPL.VERSION || VERSION_XML);
      z.file('settings.xml', TPL.SETTINGS || SETTINGS_XML);
      z.file('META-INF/container.xml', CONTAINER_XML);
      z.file('META-INF/manifest.xml', MANIFEST_XML);
      z.file('Contents/content.hpf', buildContentHpf(title));
      z.file('Contents/header.xml', headerXml);
      z.file('Contents/section0.xml', section0);
      z.file('Preview/PrvText.txt', prvText || (title || 'MDhwpify'));
      imgList.forEach(function (im) { z.file('BinData/' + im.binId + '.' + im.ext, im.bytes); });
      return z.generateAsync({ type: 'blob', mimeType: 'application/hwp+zip', compression: 'DEFLATE' });
    });
  }

  window.MD2HWPX = { convert: convert };
})();
