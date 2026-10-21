/* md2hwpx (MDhwpify) 핵심: Markdown -> .hwpx (Blob) — 정부과제 보고서 양식 초안 생성용.
 *
 * 템플릿 구동: window.HWPX_TPL(정부 양식 header + 스타일맵)에 md를 매핑. 원칙: 미리보기에 보이는 대로(v1.3.0).
 *   마크다운 전처리·marked 설정은 미리보기와 같은 md-prep.js 를 쓴다.
 *   - 헤딩 H1~H4  → 제목 1~4단계 + 자동 절 번호, H5·H6 → 4단계 모양(번호 없음)
 *   - 목록 depth 1~4 → 본문 1~4단계 + 정부 불릿(□ ○ ▪ -)·'N)'·☐/☑ 리터럴, 내어쓰기, 항목 안 문단·코드·표·그림 유지
 *   - 문단 안 줄바꿈·<br>·두 칸 줄바꿈 → <hp:lineBreak/>(미리보기 pre-wrap 과 같게)
 *   - 표         → 표제목(머리, 회색 채움)/표내용(셀) + 그리드 borderFill, 열 정렬
 *   - 인라인      → 굵게/기울임/코드/취소선/링크 + <u>·<sup>·<sub>·<mark>·<span style=color> — 문단 기본 글자 모양을
 *                   복제한 글자 모양을 변환 중에 만들어 덧붙임(목록·표 안에서도 글꼴·크기 유지, 겹친 서식 유지)
 *   - 표 밖 HTML  → DOM 으로 읽어 정렬·서식·그림·목록·제목 유지
 *   - ```mermaid  → 미리보기와 같은 DIAG SVG 를 PNG(2배 해상도)로 그려 가운데 그림 문단으로(미지원 종류는 코드 그대로)
 *   - 이미지      → 가운데 정렬 그림 문단. png/jpg/gif/bmp 는 원본 그대로, 그 밖(붙여넣기 WebP·SVG 등)은 PNG 로 바꿔 실제 크기로
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
  /* 미리보기(style.css)와 같은 색·크기 — 산출물 글자 모양을 미리보기에 맞춘다 */
  var LINK_FG = '#2B6CE5', CODE_FG = '#0F172A', CODE_BG = '#F1F5F9', DEL_FG = '#94A3B8', MARK_BG = '#FFFF00', HR_FG = '#E2E8F0';
  var CODE_FMT = { mono: true, color: CODE_FG, shade: CODE_BG, sz: 900 };   // 인라인 코드: 고정폭 9pt + 연회색 음영(.content code)
  var CODE_BLOCK_FMT = { mono: true, color: CODE_FG, sz: 850 };              // 코드 블록 줄: 고정폭 8.5pt(.content pre)
  var BQ_IND = 1200;   // 인용문 안 들여쓰기(미리보기 인용 상자의 왼쪽 막대+안쪽 여백 ≈ 4mm)

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
    if (/^data:/.test(href || '')) return finishInfo(dataUriBytes(href));
    if (!resolver) return null;
    var r = resolver(href);
    return (r && typeof r.then === 'function') ? null : resolvedInfo(href, r);   /* 비동기 공급자는 resolveImages 가 미리 기다려 둔다 */
  }
  function resolvedInfo(href, r) {   /* 공급자 결과({bytes,ext}|Uint8Array|null) → info */
    if (!r) return null;
    var bytes = r.bytes || r, ext = (r.ext || (href.split('?')[0].split('.').pop() || 'png')).toLowerCase(); if (ext === 'jpeg') ext = 'jpg';
    return (bytes && bytes.length) ? finishInfo({ bytes: bytes, ext: ext, mime: 'image/' + ext }) : null;
  }
  function finishInfo(info) {
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
        if (t.type === 'html') {   /* HTML 안 <img>(표·블록·문단 속 인라인, 크기 지정 문법이 바뀐 것 포함) — htmlImg 와 같은 추출 */
          var re = /<img\b[^>]*>/gi, m, h = t.text || t.raw || '';
          while ((m = re.exec(h))) { var src = imgSrcOf(m[0]); if (src) add(parseImgSpec({ href: src }).href); }
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
      /* 공급자(앱: .md 옆 원본 파일 읽기)는 비동기여도 된다 — 변환기가 실제로 쓰는 경로만 정확히 물어본다 */
      var got = /^data:/.test(href) ? finishInfo(dataUriBytes(href)) : Promise.resolve(resolver ? resolver(href) : null).then(function (r) { return resolvedInfo(href, r); }, function () { return null; });
      return Promise.resolve(got).then(function (info) {
        if (!info) return;
        map[href] = info;
        if (sniffImg(info.bytes) || !canDecode) return;   /* 한글이 읽는 형식 → 원본 그대로 */
        return bytesToPng(info.bytes, info.hint).then(function (png) {
          map[href] = { bytes: png.data, ext: 'png', mime: 'image/png', w: png.w, h: png.h };
        }, function () { /* 디코드 실패 → 원본 그대로(예전 동작) */ });
      });
    });
    return Promise.all(jobs).then(function () { return map; });
  }
  /* 그림 문단(다이어그램·본문 그림): 가운데 정렬(TPL.CENTER, 들여쓴 자리면 그 안에서 가운데) + 줄 높이=그림 높이
     (lineseg 캐시가 그림보다 낮으면 한글이 겹쳐 그릴 수 있음) */
  function picPara(pic, ind) {
    var m = /<hp:curSz width="\d+" height="(\d+)"/.exec(pic), h = m ? +m[1] : 1000;
    var para = ind ? paraFor(TPL.CENTER, { left: ind }) : TPL.CENTER;
    return '<hp:p id="0" paraPrIDRef="' + para + '" styleIDRef="0" pageBreak="0" columnBreak="0" merged="0"><hp:run charPrIDRef="' + TPL.STYLE.normal.char + '">' + pic + '</hp:run>' + lineseg(h) + '</hp:p>';
  }
  /* HTML 엔티티 → 글자. 한 번에 풀어야 '&amp;lt;' 가 '<' 로 두 번 풀리지 않는다(미리보기는 '&lt;' 로 보임).
     marked 는 글 토큰에 엔티티를 그대로 두고 브라우저가 풀어 보여 준다 → &copy; · &#8594; 같은 것도 다 풀기 */
  var ENT = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', copy: '©', reg: '®', trade: '™', hellip: '…', middot: '·', ndash: '–', mdash: '—', lsquo: '‘', rsquo: '’', ldquo: '“', rdquo: '”', larr: '←', rarr: '→', uarr: '↑', darr: '↓', times: '×', deg: '°', plusmn: '±', le: '≤', ge: '≥', ne: '≠', bull: '•' };
  var entBox = null;
  function decode(s) {
    if (s == null) return '';
    return String(s).replace(/&(#[xX][0-9a-fA-F]+|#\d+|[a-zA-Z][a-zA-Z0-9]*);/g, function (m, e) {
      if (e.charAt(0) === '#') { var n = /^#x/i.test(e) ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10); return (n > 0 && n <= 0x10FFFF) ? String.fromCodePoint(n) : m; }
      if (Object.prototype.hasOwnProperty.call(ENT, e)) return ENT[e];
      if (typeof document !== 'undefined') { try { entBox = entBox || document.createElement('textarea'); entBox.innerHTML = m; return entBox.value; } catch (x) { } }
      return m;
    });
  }
  function parseFrontmatter(t) {
    var m = t.match(/^---\s*\n([\s\S]*?)\n---\s*\n/), meta = {};
    if (!m) return { meta: meta, body: t };
    m[1].split('\n').forEach(function (line) { var i = line.indexOf(':'); if (i > 0) meta[line.slice(0, i).trim()] = line.slice(i + 1).trim().replace(/^["']|["']$/g, ''); });
    return { meta: meta, body: t.slice(m[0].length) };
  }

  /* ---------- 문맥별 글자 모양·문단 모양 (v1.3.0) ----------
     예전엔 굵게·기울임·코드·링크가 늘 10pt 맑은 고딕 고정 글자 모양이라, 12pt 한컴바탕인 목록·표 안에서 글꼴과 크기가 튀었고
     ***굵은 기울임***·굵은 링크처럼 겹친 서식은 안쪽 하나만 남았다. 이제 그 문단의 기본 글자 모양(base)을 복제해 필요한
     속성만 바꾼 글자 모양을 변환 중에 만들어 header.xml 에 덧붙인다. 들여쓰기·정렬·내어쓰기가 다른 문단 모양도 같은 방식. */
  var hdr = null;
  function hdrReset() {
    var cpN = (TPL.HEADER.match(/<hh:charPr id=/g) || []).length, ppN = (TPL.HEADER.match(/<hh:paraPr id=/g) || []).length;
    var latN = +((/<hh:fontface lang="LATIN" fontCnt="(\d+)"/.exec(TPL.HEADER) || [])[1] || 5);
    /* charPr 새 id 는 템플릿 + 표지용 3개(37~39, convert 의 mkCP) 뒤부터, 고정폭 글꼴은 LATIN 목록 맨 뒤에 추가 */
    hdr = { cp: {}, cpXml: [], cpBase: cpN + 3, cpNext: cpN + 3, pp: {}, ppXml: [], ppBase: ppN, ppNext: ppN, monoId: latN, mono: false };
    hdr.cp[TPL.STYLE.normal.char + '|b'] = TPL.CUSTOM.bold;     /* 바탕글 굵게·기울임은 템플릿에 같은 모양이 이미 있음 */
    hdr.cp[TPL.STYLE.normal.char + '|i'] = TPL.CUSTOM.italic;
  }
  function hdrEl(tag, id) { var m = new RegExp('<hh:' + tag + ' id="' + id + '"[\\s\\S]*?</hh:' + tag + '>').exec(TPL.HEADER); return m ? m[0] : null; }
  function charSize(id) { return +((/ height="(\d+)"/.exec(hdrEl('charPr', id) || '') || [])[1] || 1000); }
  function paraLeft(id) { return +((/<hc:left value="(-?\d+)"/.exec(hdrEl('paraPr', id) || '') || [])[1] || 0); }
  var FMT_KEYS = ['b', 'i', 'u', 's', 'sup', 'sub', 'mono', 'link', 'color', 'shade', 'sz'];
  /* f = {b,i,u,s,sup,sub,mono,link, color:'#RRGGBB', shade:'#RRGGBB', sz: 크기(HWPUNIT, 100=1pt)} → 글자 모양 id */
  function charFor(base, f) {
    var k = []; if (f) FMT_KEYS.forEach(function (n) { if (f[n]) k.push(f[n] === true ? n : n + '=' + f[n]); });
    if (!k.length) return base;
    var key = base + '|' + k.join(','); if (hdr.cp[key] != null) return hdr.cp[key];
    var x = hdrEl('charPr', base); if (!x) return base;
    var id = hdr.cpNext++;
    x = x.replace(/<hh:charPr id="\d+"/, '<hh:charPr id="' + id + '"');
    if (f.sz) x = x.replace(/ height="\d+"/, ' height="' + f.sz + '"');
    var col = f.color || (f.link ? LINK_FG : null);
    if (col) x = x.replace(/textColor="[^"]*"/, 'textColor="' + col + '"');
    if (f.shade) x = x.replace(/shadeColor="[^"]*"/, 'shadeColor="' + f.shade + '"');
    if (f.mono) {   /* 영문·숫자는 고정폭(Consolas), 한글은 맑은 고딕 — 미리보기 코드 글꼴과 같은 조합 */
      hdr.mono = true;
      x = x.replace(/<hh:fontRef [^>]*\/>/, '<hh:fontRef hangul="2" latin="' + hdr.monoId + '" hanja="2" japanese="2" other="2" symbol="2" user="2"/>')
        .replace(/<hh:spacing [^>]*\/>/, '<hh:spacing hangul="0" latin="0" hanja="0" japanese="0" other="0" symbol="0" user="0"/>');
    }
    var tc = (/textColor="([^"]*)"/.exec(x) || [])[1] || '#000000';
    if (f.i && x.indexOf('<hh:italic/>') < 0) x = x.replace(/(<hh:offset [^>]*\/>)/, '$1<hh:italic/>');   /* 스키마 순서: offset → italic → bold */
    if (f.b && x.indexOf('<hh:bold/>') < 0) x = x.replace(/(<hh:offset [^>]*\/>(?:<hh:italic\/>)?)/, '$1<hh:bold/>');
    if (f.u || f.link) x = x.replace(/<hh:underline [^>]*\/>/, '<hh:underline type="BOTTOM" shape="SOLID" color="' + tc + '"/>');
    if (f.s) x = x.replace(/<hh:strikeout [^>]*\/>/, '<hh:strikeout shape="SOLID" color="' + tc + '"/>');
    if (f.sup) x = x.replace('</hh:charPr>', '<hh:supscript/></hh:charPr>');
    else if (f.sub) x = x.replace('</hh:charPr>', '<hh:subscript/></hh:charPr>');
    hdr.cpXml.push(x); hdr.cp[key] = id; return id;
  }
  /* o = {align:'LEFT'|'CENTER'|'RIGHT'|'JUSTIFY', left: 왼쪽 여백, intent: 첫 줄(음수=내어쓰기)} → 문단 모양 id */
  function paraFor(base, o) {
    var key = base + '|' + (o.align || '') + '|' + (o.left == null ? '' : o.left) + '|' + (o.intent == null ? '' : o.intent);
    if (hdr.pp[key] != null) return hdr.pp[key];
    var x = hdrEl('paraPr', base); if (!x) return base;
    var id = hdr.ppNext++;
    x = x.replace(/<hh:paraPr id="\d+"/, '<hh:paraPr id="' + id + '"');
    if (o.align) x = x.replace(/<hh:align horizontal="\w+"/, '<hh:align horizontal="' + o.align + '"');
    /* 여백은 hp:case(HWPUNIT)와 hp:default(그 2배 — 템플릿 실측) 두 벌을 같이 바꾼다 */
    function setM(k, v) { var n = 0; x = x.replace(new RegExp('<hc:' + k + ' value="-?\\d+"', 'g'), function () { return '<hc:' + k + ' value="' + (n++ === 0 ? v : v * 2) + '"'; }); }
    if (o.left != null) setM('left', o.left);
    if (o.intent != null) setM('intent', o.intent);
    hdr.ppXml.push(x); hdr.pp[key] = id; return id;
  }

  /* 인라인 HTML 태그 → 서식(미리보기 브라우저가 보여 주는 대로). null = 서식 태그 아님 */
  function tagFmt(tag, attrs) {
    switch (tag) {
      case 'b': case 'strong': return { b: true };
      case 'i': case 'em': case 'cite': case 'var': case 'dfn': return { i: true };
      case 'u': case 'ins': return { u: true };
      case 's': case 'strike': return { s: true };
      case 'del': return { s: true, color: DEL_FG };   /* .content del 은 회색 */
      case 'sup': return { sup: true };
      case 'sub': return { sub: true };
      case 'mark': return { shade: MARK_BG };
      case 'code': return CODE_FMT;
      case 'kbd': case 'samp': case 'tt': return { mono: true };
      case 'a': return /\bhref\s*=/i.test(attrs || '') ? { link: true } : {};
      case 'span': case 'font': return styleFmt(attrs || '');
    }
    return null;
  }
  function styleFmt(a) {
    var f = {}, m = /(?:^|[\s;"'])color\s*:\s*([^;"']+)/i.exec(a) || /\bcolor\s*=\s*["']?([^"'\s>]+)/i.exec(a), v;
    if (m && (v = cssColor(m[1]))) f.color = v;
    if ((m = /background(?:-color)?\s*:\s*([^;"']+)/i.exec(a)) && (v = cssColor(m[1]))) f.shade = v;
    if (/font-weight\s*:\s*(bold|[6-9]00)/i.test(a)) f.b = true;
    if (/font-style\s*:\s*italic/i.test(a)) f.i = true;
    if (/text-decoration[^;"']*underline/i.test(a)) f.u = true;
    if (/text-decoration[^;"']*line-through/i.test(a)) f.s = true;
    return f;
  }
  var NAMED_COLOR = { black: '#000000', white: '#FFFFFF', red: '#FF0000', green: '#008000', blue: '#0000FF', yellow: '#FFFF00', orange: '#FFA500', purple: '#800080', gray: '#808080', grey: '#808080', navy: '#000080', maroon: '#800000', teal: '#008080' };
  function cssColor(v) {
    v = String(v || '').trim().toLowerCase(); var m;
    if ((m = /^#([0-9a-f]{3})$/.exec(v))) return '#' + m[1].replace(/./g, '$&$&').toUpperCase();
    if ((m = /^#([0-9a-f]{6})$/.exec(v))) return '#' + m[1].toUpperCase();
    if ((m = /^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/.exec(v))) return '#' + [m[1], m[2], m[3]].map(function (n) { return ('0' + Math.min(255, +n).toString(16)).slice(-2); }).join('').toUpperCase();
    return NAMED_COLOR[v] || null;
  }
  function alignAttr(a) {
    var m = /\balign\s*=\s*["']?(center|right|left|justify)/i.exec(a || '') || /text-align\s*:\s*(center|right|left|justify)/i.exec(a || '');
    return m ? m[1].toLowerCase() : null;
  }
  /* <img> 태그 문자열 → src(엔티티 풀어서)·크기 지정(=300x200 · =50%) → 그림 */
  function imgSrcOf(tag) { var m = /\bsrc\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i.exec(tag || ''); return m ? decode(m[1] != null ? m[1] : (m[2] != null ? m[2] : m[3])) : null; }
  function imgSpecOf(tag) {
    var pct = /\bstyle\s*=\s*["'][^"']*\bwidth\s*:\s*(\d+)%/i.exec(tag) || /\bwidth\s*=\s*["']?(\d+)%/i.exec(tag);
    if (pct) return '=' + pct[1] + '%';
    var w = (/\bwidth\s*=\s*["']?(\d+)/i.exec(tag) || [])[1], h = (/\bheight\s*=\s*["']?(\d+)/i.exec(tag) || [])[1];
    if (!w) w = (/\bstyle\s*=\s*["'][^"']*\bwidth\s*:\s*(\d+)px/i.exec(tag) || [])[1];
    return (w && h) ? '=' + w + 'x' + h : (w ? '=' + w + 'x' : (h ? '=x' + h : ''));
  }
  function htmlImg(tag, maxW, maxH) { var src = imgSrcOf(tag); if (!src) return null; var spec = imgSpecOf(tag); return addImage(spec ? { href: src, title: spec } : src, maxW, maxH); }

  /* 인라인 → run 배열 [{c,t}|{c,br}|{c,pic}].
     ctx = {base: 문단 기본 글자 모양, f: 바깥에서 겹친 서식, nl: 문단 안 줄바꿈을 줄바꿈으로(미리보기 p 의 pre-wrap 과 같게 —
            붙여 쓴 목록 항목·표 칸은 미리보기처럼 공백), maxW/maxH: 그림 최대 크기, noPic: 그림 빼기(제목)} */
  function inlineRuns(tokens, ctx) {
    var runs = [], hs = [];   /* hs: 열린 인라인 HTML 서식 태그(<u>…</u> 는 여는·닫는 태그가 따로 토큰으로 온다) */
    function fmt(extra) { var f = Object.assign({}, ctx.f); hs.forEach(function (h) { Object.assign(f, h.f); }); if (extra) Object.assign(f, extra); return f; }
    function sub(extra) { return Object.assign({}, ctx, { f: fmt(extra) }); }
    function text(s, extra) {
      if (!s) return;
      var c = charFor(ctx.base, fmt(extra));
      if (ctx.nl && s.indexOf('\n') >= 0) s.split('\n').forEach(function (p, i) { if (i) runs.push({ c: c, br: true }); if (p) runs.push({ c: c, t: p }); });
      else runs.push({ c: c, t: s });
    }
    function br() { runs.push({ c: charFor(ctx.base, fmt()), br: true }); }
    function html(h) {
      var s = String(h || '').trim(), m;
      if (!s || /^<!--/.test(s)) return;
      if (/^<br\s*\/?>$/i.test(s)) { br(); return; }
      if (/^<img\b/i.test(s)) { if (!ctx.noPic) { var p = htmlImg(s, ctx.maxW, ctx.maxH); if (p) runs.push({ c: ctx.base, pic: p }); } return; }
      if ((m = /^<\/([a-z][a-z0-9]*)\s*>$/i.exec(s))) { var tg = m[1].toLowerCase(); for (var i = hs.length - 1; i >= 0; i--) if (hs[i].tag === tg) { hs.splice(i, 1); break; } return; }
      if ((m = /^<([a-z][a-z0-9]*)\b([^>]*)>$/i.exec(s))) { var f = tagFmt(m[1].toLowerCase(), m[2]); if (f && !/\/\s*$/.test(m[2])) hs.push({ tag: m[1].toLowerCase(), f: f }); return; }
      text(decode(s.replace(/<[^>]+>/g, '')));
    }
    (tokens || []).forEach(function (t) {
      switch (t.type) {
        case 'text': if (t.tokens && t.tokens.length) runs = runs.concat(inlineRuns(t.tokens, sub())); else text(decode(t.text)); break;
        case 'escape': text(t.text); break;
        case 'strong': runs = runs.concat(inlineRuns(t.tokens, sub({ b: true }))); break;
        case 'em': runs = runs.concat(inlineRuns(t.tokens, sub({ i: true }))); break;
        case 'del': runs = runs.concat(inlineRuns(t.tokens, sub({ s: true, color: DEL_FG }))); break;
        case 'codespan': text(t.text, CODE_FMT); break;   /* 코드 안 글자는 엔티티를 풀지 않는다(미리보기도 글자 그대로) */
        case 'link': { var kids = inlineRuns(t.tokens, sub({ link: true })); if (!kids.length) kids = [{ c: charFor(ctx.base, fmt({ link: true })), t: t.href }]; runs = runs.concat(kids); } break;
        case 'br': br(); break;
        case 'image': if (!ctx.noPic) { var p = addImage(t, ctx.maxW, ctx.maxH); if (p) runs.push({ c: ctx.base, pic: p }); else text('[' + (t.text || 'image') + ']'); } break;
        case 'html': html(t.text || t.raw); break;
        default: if (t.tokens) runs = runs.concat(inlineRuns(t.tokens, sub())); else if (t.text != null) text(decode(t.text));
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
        case 'codespan': out += t.text; break;
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
  /* runs → <hp:run> 들. 같은 글자 모양끼리 한 run 으로 묶고, 줄바꿈은 <hp:lineBreak/>(한글 Shift+Enter 와 같은 표기).
     extra = 첫 run 앞 컨트롤(구역 정의·쪽 번호 등) */
  function runsXml(runs, extra) {
    var out = '', cur = null, first = true;
    function head() { var h = (first && extra) ? extra : ''; first = false; return h; }
    function close() { if (cur != null) { out += '</hp:t></hp:run>'; cur = null; } }
    runs.forEach(function (r) {
      if (r.pic) { close(); out += '<hp:run charPrIDRef="' + r.c + '">' + head() + r.pic + '</hp:run>'; return; }
      if (cur !== r.c) { close(); out += '<hp:run charPrIDRef="' + r.c + '">' + head() + '<hp:t>'; cur = r.c; }
      out += r.br ? '<hp:lineBreak/>' : xmlEsc(cleanText(r.t));
    });
    close();
    return out;
  }
  /* st={style,para,char}, h=lineseg 높이. runs=[{c,t}|{c,br}|{c,pic}]. extra=첫 run 앞 컨트롤, para=문단 모양 덮어쓰기 */
  function paraOf(runs, st, h, extra, w, para) {
    if (!runs || !runs.length) runs = [{ c: st.char, t: '' }];
    return '<hp:p id="0" paraPrIDRef="' + (para != null ? para : st.para) + '" styleIDRef="' + st.style + '" pageBreak="0" columnBreak="0" merged="0">' + runsXml(runs, extra) + lineseg(h, w) + '</hp:p>';
  }
  function textPara(text, st, h) { return paraOf([{ c: st.char, t: text }], st, h); }
  function isBlank(r) { return !r.pic && (r.br || !/\S/.test(r.t || '')); }
  function trimRuns(runs) { var a = 0, b = runs.length; while (a < b && isBlank(runs[a])) a++; while (b > a && isBlank(runs[b - 1])) b--; return runs.slice(a, b); }
  /* 문단 하나를 내되, 그림은 따로 가운데 정렬 문단으로 뺀다 — 미리보기 img 는 display:block·가운데라 한 줄을 통째로 차지한다
     (예전 hwpx 는 그림이 글줄 안에 끼어 왼쪽에 붙었다). 그림 앞뒤 조각에 남는 빈 줄바꿈·공백만 정리하고 글머리 공백은 그대로 둔다 */
  function emitPara(runs, st, para, out, ind, h) {
    h = h || 1000;
    if (!runs.some(function (r) { return r.pic; })) { out.push(paraOf(runs, st, h, null, null, para)); return; }
    var seg = [], afterPic = false;
    function flush(beforePic) {
      var a = 0, b = seg.length;
      if (afterPic) while (a < b && isBlank(seg[a])) a++;
      if (beforePic) while (b > a && isBlank(seg[b - 1])) b--;
      var s = seg.slice(a, b); seg = [];
      if (s.some(function (r) { return !isBlank(r); })) out.push(paraOf(s, st, h, null, null, para));
    }
    runs.forEach(function (r) {
      if (r.pic) { flush(true); out.push(picPara(r.pic, ind)); afterPic = true; }
      else seg.push(r);
    });
    flush(false);
  }

  var HH = [0, 1700, 1500, 1300, 1100];  // 헤딩 레벨별 lineseg 높이

  /* 스마트 절 번호: md에 번호 있으면 그대로, 없으면 depth 기반 자동(H1=1. H2=1.1 …) */
  var HASNUM = /^\s*(\d+([.\-]\d+)*\.?|[가나다라마바사아자차카타파하][.)]|[IVXⅠⅡⅢⅣⅤⅥⅦⅧⅨⅩ]+\.|[①-⑳])\s+/;
  var numCtr = [0, 0, 0, 0, 0];
  function nextNum(d) {
    numCtr[d]++; for (var i = d + 1; i < numCtr.length; i++) numCtr[i] = 0;
    var parts = []; for (var j = 1; j <= d; j++) parts.push(numCtr[j]);
    return parts.join('.') + (d === 1 ? '.' : '');
  }
  /* 제목: H1~H4 = 제목 1~4단계 + 자동 절 번호(md 에 번호 있으면 그대로), H5·H6 = 4단계 모양에 번호 없음(미리보기와 같음 —
     예전엔 H4 번호를 이어 받아 '0.0.0.1' 처럼 붙었다). 제목 안 굵게·코드 같은 서식도 살린다 */
  function headingPara(runs, plain, depth) {
    var d = Math.min(depth, 4), st = TPL.STYLE.h[d];
    runs = runs.filter(function (r) { return !r.pic; });
    if (depth <= 4 && !HASNUM.test(plain)) runs.unshift({ c: st.char, t: nextNum(d) + ' ' });
    return paraOf(runs, st, HH[d]);
  }
  function headingBlock(t) {
    var st = TPL.STYLE.h[Math.min(t.depth, 4)];
    return headingPara(inlineRuns(t.tokens, { base: st.char, f: {}, nl: false, noPic: true }), inlineText(t.tokens), t.depth);
  }

  /* 글머리표+공백 폭 근사(HWPUNIT): 전각(□ ○ ▪ ☐ 한글)=1em, 그 밖(숫자·괄호·공백·-)=0.5em. size=글자 크기 */
  var WIDE_CH = /[ᄀ-ᇿ⺀-꓏가-힯豈-﫿＀-｠■-◿☐-☒]/;
  function markerW(s, size) { var w = 0; for (var i = 0; i < s.length; i++) w += WIDE_CH.test(s.charAt(i)) ? 1 : 0.5; return Math.round(w * size); }

  /* 목록: depth 1~4 → 본문 1~4단계 + 정부 글머리표(□ ○ ▪ -), 번호 목록은 'N)'(원본 양식), 할 일 목록은 ☐/☑(미리보기 체크박스).
     - 내어쓰기: 줄이 넘어가면 둘째 줄부터 글머리표 뒤 글자에 맞춘다(미리보기 li 와 같음)
     - 항목 안 둘째 문단·코드·표·그림·인용·다이어그램도 그 들여쓰기로 차례대로 낸다(예전엔 문단끼리 붙고 나머지는 사라졌다)
     - 붙여 쓴 목록(항목 사이 빈 줄 없음)은 항목 안 줄바꿈이 공백, 느슨한 목록은 줄바꿈(미리보기와 같은 규칙)
     ind = 바깥 들여쓰기(인용문 안 목록 등) */
  function listBlocks(list, depth, out, ind) {
    ind = ind || 0;
    var d = Math.min(depth, 4), st = TPL.STYLE.body[d], bullet = TPL.BULLETS[d - 1];
    var size = charSize(st.char), left = paraLeft(st.para) + ind;
    var ordered = !!list.ordered, start = parseInt(list.start, 10); if (isNaN(start)) start = 1;
    (list.items || []).forEach(function (it, idx) {
      var marker = ordered ? ((start + idx) + ')') : bullet;   /* 번호목록은 원본처럼 'N)', 아니면 불릿(□○▪-) */
      if (it.task) marker = ordered ? marker + ' ' + (it.checked ? '☑' : '☐') : (it.checked ? '☑' : '☐');
      var mw = markerW(marker + ' ', size), inner = left + mw;
      var itemPara = paraFor(st.para, { left: left, intent: -mw }), contPara = paraFor(st.para, { left: inner, intent: 0 });
      var done = false;
      function head(runs) { emitPara([{ c: st.char, t: marker + ' ' }].concat(runs || []), st, itemPara, out, inner, 1200); done = true; }
      (it.tokens || []).forEach(function (x) {
        if (x.type === 'checkbox' || x.type === 'space') return;
        if (x.type === 'list') { if (!done) head([]); listBlocks(x, depth + 1, out, ind); return; }
        if (x.type === 'text' || x.type === 'paragraph') {
          var runs = inlineRuns(x.tokens || [{ type: 'text', text: x.text }], { base: st.char, f: {}, nl: x.type === 'paragraph', maxW: CONTENT_W - inner, maxH: 40000 });
          if (!done) head(runs); else emitPara(runs, st, contPara, out, inner, 1200);
          return;
        }
        if (!done) head([]);
        blocks([x], out, { ind: inner });
      });
      if (!done) head([]);
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
      paras += '<hp:p id="0" paraPrIDRef="' + st.para + '" styleIDRef="' + st.style + '" pageBreak="0" columnBreak="0" merged="0">' + runsXml(runs) + lineseg(1000, cw) + '</hp:p>';
    });
    return '<hp:tc name="" header="' + (isHeader ? 1 : 0) + '" hasMargin="0" protect="0" editable="0" dirty="0" borderFillIDRef="' + bfId + '">' +
      '<hp:subList id="" textDirection="HORIZONTAL" lineWrap="BREAK" vertAlign="CENTER" linkListIDRef="0" linkListNextIDRef="0" textWidth="0" textHeight="0" hasTextRef="0" hasNumRef="0">' + paras + '</hp:subList>' +
      '<hp:cellAddr colAddr="' + colAddr + '" rowAddr="' + rowAddr + '"/><hp:cellSpan colSpan="' + (colSpan || 1) + '" rowSpan="' + (rowSpan || 1) + '"/>' +
      '<hp:cellSz width="' + w + '" height="' + h + '"/><hp:cellMargin ' + CELLM + '/></hp:tc>';
  }
  var tblSeq = 0;
  var TBL_IND = 0;   // 지금 만드는 표의 들여쓰기(indented 가 설정) — 쪽에서 나뉘는 표의 가로 위치
  /* 쪽 경계에서 나눌 표: 높이를 어림해 한 쪽에 다 못 들어갈 만큼(본문 쪽 높이의 90% 넘게) 길면 행 단위로 나눈다(머리 행 반복).
     예전엔 모든 표가 '나누지 않음 + 글자처럼 취급'이라 한 쪽보다 긴 표는 한글에서 넘친 행이 통째로 안 보였다(미리보기는 나뉘어 다 보임).
     한 쪽에 들어가는 표는 예전처럼 통째로 다음 쪽(미리보기 break-inside:avoid 와 같음). 글자처럼 취급하는 표는 한글이 못 나눠서 나눌 표만 끈다. */
  var SPLIT_H = Math.round(TEXT_H * 0.9);
  function cellTextH(runs, w, size) {   // 셀 글 높이 어림(HWPUNIT): 줄 수 × 줄높이(160%) + 그림 높이. 글자 폭: 한글 1em·영문/숫자 0.5em·공백 0.3em(한컴바탕 근사)
    var lines = 1, cur = 0, pics = 0;
    (runs || []).forEach(function (r) {
      if (r.pic) { var m = /<hp:curSz width="\d+" height="(\d+)"/.exec(r.pic); pics += m ? +m[1] : 0; return; }
      if (r.br) { lines++; cur = 0; return; }
      var t = r.t || '';
      for (var i = 0; i < t.length; i++) { var ch = t.charAt(i), cw = (WIDE_CH.test(ch) ? 1 : (ch === ' ' ? 0.3 : 0.5)) * size; cur += cw; if (cur > w) { lines++; cur = cw; } }
    });
    return Math.round(lines * size * 1.6) + pics;
  }
  function cellPadV() { var m = /top="(\d+)" bottom="(\d+)"/.exec(CELLM); return m ? +m[1] + +m[2] : 282; }
  function tblBreak(split) { return 'pageBreak="' + (split ? 'CELL' : 'NONE') + '"'; }
  function tblPos(split) { return '<hp:pos treatAsChar="' + (split ? 0 : 1) + '" affectLSpacing="0" flowWithText="1" allowOverlap="0" holdAnchorAndSO="0" vertRelTo="PARA" horzRelTo="COLUMN" vertAlign="TOP" horzAlign="LEFT" vertOffset="0" horzOffset="' + (split ? TBL_IND : 0) + '"/>'; }
  function buildTable(t) {
    var header = t.header || [], rows = t.rows || [];
    var colCnt = header.length || (rows[0] ? rows[0].length : 0);
    if (!colCnt) return textPara('', TPL.STYLE.normal, 1000);
    var all = [];
    if (header.length) all.push({ cells: header, header: true });
    rows.forEach(function (r) { all.push({ cells: r, header: false }); });
    var rowCnt = all.length, rowH = 2400, colW = Math.floor(CONTENT_W / colCnt);
    var GRID = TPL.TABLE.grid, HEAD = TPL.TABLE.headFill;
    var trs = '', estH = 0, padV = cellPadV();
    all.forEach(function (row, ri) {
      var tcs = '', rowMax = rowH;
      for (var ci = 0; ci < colCnt; ci++) {
        var cell = row.cells[ci];
        var w = (ci === colCnt - 1) ? (CONTENT_W - colW * (colCnt - 1)) : colW;
        var st = row.header ? TPL.STYLE.tableHead : TPL.STYLE.tableBody;
        var al = (!row.header && t.align) ? t.align[ci] : null;   /* 열 정렬(:-: · --:) — 미리보기처럼 본문 칸에만(머리 칸은 늘 가운데) */
        if (al === 'center' || al === 'right') st = { style: st.style, char: st.char, para: paraFor(st.para, { align: al.toUpperCase() }) };
        var cRuns = cell ? inlineRuns(cell.tokens || [{ type: 'text', text: cell.text }], { base: st.char, f: {}, nl: false, maxW: Math.max(1, w - 1020), maxH: 10000 }) : [];
        rowMax = Math.max(rowMax, cellTextH(cRuns, Math.max(1, w - 1020), charSize(st.char)) + padV);
        tcs += tblCell([cRuns], st, ci, ri, w, rowH, row.header ? HEAD : GRID, row.header);
      }
      estH += rowMax;
      trs += '<hp:tr>' + tcs + '</hp:tr>';
    });
    var split = estH > SPLIT_H;
    var tbl = '<hp:tbl id="' + (++tblSeq) + '" zOrder="0" numberingType="TABLE" textWrap="TOP_AND_BOTTOM" textFlow="BOTH_SIDES" lock="0" dropcapstyle="None" ' + tblBreak(split) + ' repeatHeader="1" rowCnt="' + rowCnt + '" colCnt="' + colCnt + '" cellSpacing="0" borderFillIDRef="' + GRID + '" noAdjust="0">' +
      '<hp:sz width="' + CONTENT_W + '" widthRelTo="ABSOLUTE" height="' + (rowH * rowCnt) + '" heightRelTo="ABSOLUTE" protect="0"/>' +
      tblPos(split) +
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
      var pre = stripTags(seg.slice(idx, m.index)); if (pre) runs.push({ c: charId, t: pre });
      var pic = htmlImg(m[0], maxW, maxH); if (pic) runs.push({ c: charId, pic: pic });   /* width="50%" 도 % 로(예전엔 50px) */
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
    /* 반복할 머리 행: 첫 행이 전부 th·행 병합 없음 + 뒤에 본문 행이 있을 때만(미리보기 thead 와 같은 규칙) — 표가 쪽에서 나뉠 때만 쓰인다 */
    var row0 = t.cells.filter(function (c) { return c.row === 0; });
    var head0 = t.rowCount > 1 && row0.length && row0.every(function (c) { return c.isHeader && c.rowSpan === 1; });
    var trs = '', rowEst = [], padV = cellPadV();
    for (var r = 0; r < t.rowCount; r++) {
      var rowCells = t.cells.filter(function (c) { return c.row === r; }).sort(function (a, b) { return a.col - b.col; }), tcs = '';
      rowCells.forEach(function (c) {
        var st = c.isHeader ? TPL.STYLE.tableHead : TPL.STYLE.tableBody, w = colWidth(c.col, c.colSpan), h = rowH * c.rowSpan;
        var lines = htmlCellLines(c.inner, st.char, Math.max(1, w - 1020), 10000);
        var ch = padV; lines.forEach(function (ln) { ch += cellTextH(ln, Math.max(1, w - 1020), charSize(st.char)); });
        for (var k = 0; k < c.rowSpan; k++) rowEst[r + k] = Math.max(rowEst[r + k] || rowH, ch / c.rowSpan);   /* 병합 칸 높이는 걸친 행들에 나눠 */
        tcs += tblCell(lines, st, c.col, c.row, w, h, c.isHeader ? HEAD : GRID, c.isHeader && c.row === 0 && head0, c.colSpan, c.rowSpan);
      });
      trs += '<hp:tr>' + tcs + '</hp:tr>';
    }
    var estH = 0; for (var q = 0; q < t.rowCount; q++) estH += rowEst[q] || rowH;
    var split = estH > SPLIT_H;
    var tbl = '<hp:tbl id="' + (++tblSeq) + '" zOrder="0" numberingType="TABLE" textWrap="TOP_AND_BOTTOM" textFlow="BOTH_SIDES" lock="0" dropcapstyle="None" ' + tblBreak(split) + ' repeatHeader="1" rowCnt="' + t.rowCount + '" colCnt="' + t.colCount + '" cellSpacing="0" borderFillIDRef="' + GRID + '" noAdjust="' + (useCg ? '1' : '0') + '">' +
      '<hp:sz width="' + CONTENT_W + '" widthRelTo="ABSOLUTE" height="' + (rowH * t.rowCount) + '" heightRelTo="ABSOLUTE" protect="0"/>' +
      tblPos(split) +
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

  /* 표를 들여쓴 자리(목록 항목·인용 안)에 넣기: 폭을 그만큼 줄여 만들고, 표를 담는 문단에 왼쪽 여백(미리보기 li 안 표처럼) */
  function indented(ind, build) {
    if (!ind) return build();
    var save = CONTENT_W, p;
    CONTENT_W = save - ind; TBL_IND = ind;   /* 쪽에서 나뉘는 표(글자처럼 취급 안 함)는 문단 여백이 안 먹어 가로 위치로 들여씀 */
    try { p = build(); } finally { CONTENT_W = save; TBL_IND = 0; }
    return p.replace(/^<hp:p id="0" paraPrIDRef="\d+"/, '<hp:p id="0" paraPrIDRef="' + paraFor(TPL.STYLE.normal.para, { left: ind }) + '"');
  }
  /* 코드 블록: 줄마다 문단, 고정폭 글꼴·왼쪽 정렬(미리보기 코드 상자 글꼴과 같게, 탭은 8칸 단위 공백 — 예전엔 빨간 맑은 고딕에 탭이 한 칸).
     ```mermaid 는 그림, ```toc 는 목차 */
  function codeBlock(t, out, ind) {
    ind = ind || 0;
    var dpic = t._png ? addPng(t._png, CONTENT_W - ind) : null;   /* resolveDiagrams 가 그려 둔 mermaid → 그림 문단 */
    if (dpic) { out.push(picPara(dpic, ind)); return; }
    if ((t.lang || '').toLowerCase() === 'toc') { tocBlocks(t.text, out); return; }
    var N = TPL.STYLE.normal, c = charFor(N.char, CODE_BLOCK_FMT), para = paraFor(N.para, { align: 'LEFT', left: ind });
    String(t.text || '').replace(/\n$/, '').split('\n').forEach(function (ln) { out.push(paraOf([{ c: c, t: expandTabs(ln) || ' ' }], N, 1000, null, null, para)); });
  }
  function expandTabs(s) {
    var o = '', col = 0;
    for (var i = 0; i < s.length; i++) { var ch = s.charAt(i); if (ch === '\t') { var n = 8 - (col % 8); o += new Array(n + 1).join(' '); col += n; } else { o += ch; col++; } }
    return o;
  }
  /* 가로줄: 본문 폭을 채우는 연회색 선(미리보기 hr 처럼). 예전엔 '─' 20개(약 7cm) */
  function hrPara(ind) {
    ind = ind || 0;
    var N = TPL.STYLE.normal, n = Math.max(4, Math.floor((CONTENT_W - ind) / charSize(N.char)) - 1);
    return paraOf([{ c: charFor(N.char, { color: HR_FG }), t: new Array(n + 1).join('─') }], N, 1000, null, null, paraFor(N.para, { align: 'LEFT', left: ind }));
  }
  /* HTML 표 안에 빈 줄이 있으면 marked 가 블록을 거기서 끊는다 → 미리보기(브라우저)는 이어 붙여 표 하나로 보지만
     예전 hwpx 는 빈 줄 앞 행까지만 냈다. </table> 이 나올 때까지 뒤 토큰 원문을 이어 붙여 한 블록으로 */
  function mergeHtmlTables(tokens) {
    function depth(s) { s = String(s || ''); return (s.match(/<table\b/gi) || []).length - (s.match(/<\/table>/gi) || []).length; }
    var out = [];
    for (var i = 0; i < tokens.length; i++) {
      var t = tokens[i], raw = t.type === 'html' ? (t.raw || t.text || '') : '', d = depth(raw);
      if (d <= 0) { out.push(t); continue; }
      var j = i + 1;
      while (d > 0 && j < tokens.length) { var r = tokens[j].raw || ''; raw += r; d += depth(r); j++; }
      out.push({ type: 'html', raw: raw, text: raw, block: true });
      i = j - 1;
    }
    return out;
  }

  /* ---------- 표 밖 HTML 블록 → 문단 (v1.3.0) ----------
     브라우저처럼 DOM 으로 읽어 정렬(align·text-align·<center>)·글자 서식(<b>·<u>·<sup>·<mark>·<span style=color> 등)·
     그림(<img width>)·줄바꿈(<br>)·목록·표·제목을 옮긴다. 예전엔 <table> 이 아닌 HTML 블록은 통째로 버려 미리보기와 달랐다.
     닫힌 <details> 는 미리보기처럼 요약(▶)만 보인다. */
  var HTML_BLOCK = /^(address|article|aside|blockquote|center|dd|details|dialog|div|dl|dt|fieldset|figcaption|figure|footer|form|h[1-6]|header|hgroup|li|main|nav|ol|p|pre|section|summary|table|ul|hr)$/;
  function htmlBlock(html, out, o) {
    var N = TPL.STYLE.normal;
    if (typeof DOMParser === 'undefined') { var s0 = stripTags(html); if (s0) out.push(textPara(s0, N, 1000)); return; }
    var root = new DOMParser().parseFromString('<!DOCTYPE html><html><body>' + html + '</body></html>', 'text/html').body;
    var runs = [];
    function para(st) { return (st.ind || st.align) ? paraFor(N.para, { left: st.ind || 0, align: st.align ? st.align.toUpperCase() : null }) : N.para; }
    function flush(st) { var r = trimRuns(runs); runs = []; if (r.length) emitPara(r, N, para(st), out, st.ind || 0); }
    function cur(st) { return charFor(st.base || N.char, st.f); }
    function text(s, st) {
      if (st.pre !== 'wrap') s = s.replace(/[\t\n\r\f ]+/g, ' ');   /* 보통 HTML: 공백·줄바꿈은 한 칸(브라우저와 같게) */
      if (!s) return;
      var c = cur(st);
      if (s.indexOf('\n') >= 0) s.split('\n').forEach(function (p, i) { if (i) runs.push({ c: c, br: true }); if (p) runs.push({ c: c, t: p }); });
      else runs.push({ c: c, t: s });
    }
    function kids(n, st) { [].forEach.call(n.childNodes, function (k) { visit(k, st); }); }
    function visit(n, st) {
      if (n.nodeType === 3) { text(n.nodeValue, st); return; }
      if (n.nodeType !== 1) return;
      var tag = n.tagName.toLowerCase(), attrs = (n.outerHTML.match(/^<[^>]*>/) || [''])[0];
      if (tag === 'br') { runs.push({ c: cur(st), br: true }); return; }
      if (tag === 'img') { var pic = htmlImg(attrs, CONTENT_W - (st.ind || 0), 40000); if (pic) runs.push({ c: N.char, pic: pic }); return; }
      if (/^(script|style|template|noscript|head)$/.test(tag)) return;
      if (st.flat && HTML_BLOCK.test(tag) && !/^(table|ul|ol)$/.test(tag)) { if (runs.length > 1) runs.push({ c: cur(st), br: true }); kids(n, st); return; }   /* 목록 항목 안 블록 = 줄바꿈 */
      if (tag === 'table') { flush(st); out.push(indented(st.ind || 0, function () { return buildHtmlTable(n.outerHTML); })); return; }
      if (tag === 'hr') { flush(st); out.push(hrPara(st.ind || 0)); return; }
      if (tag === 'pre') { flush(st); codeBlock({ text: n.textContent || '' }, out, st.ind || 0); return; }
      if (/^h[1-6]$/.test(tag)) {   /* 미리보기는 HTML 제목에도 절 번호를 붙인다 → 같게 */
        flush(st);
        var dep = +tag.charAt(1), save = runs; runs = [];
        kids(n, Object.assign({}, st, { base: TPL.STYLE.h[Math.min(dep, 4)].char, f: {}, pre: null }));
        var hr = trimRuns(runs); runs = save;
        out.push(headingPara(hr, n.textContent || '', dep));
        return;
      }
      if (tag === 'ul' || tag === 'ol') { flush(st); htmlList(n, st, (st.depth || 0) + 1); return; }
      if (tag === 'details') {
        flush(st);
        var open = n.hasAttribute('open');
        [].forEach.call(n.childNodes, function (k) { if (open || (k.nodeType === 1 && k.tagName.toLowerCase() === 'summary')) visit(k, st); });
        flush(st);
        return;
      }
      if (tag === 'summary') { flush(st); runs.push({ c: cur(st), t: '▶ ' }); kids(n, st); flush(st); return; }
      var f = tagFmt(tag, attrs), al = alignAttr(attrs) || (tag === 'center' ? 'center' : null);
      var st2 = Object.assign({}, st);
      if (f) st2.f = Object.assign({}, st.f, f);
      if (al) st2.align = al;
      if (tag === 'p') st2.pre = 'wrap';   /* .content p 는 pre-wrap → 줄바꿈이 보인다 */
      if (tag === 'blockquote') st2.ind = (st.ind || 0) + BQ_IND;
      var blk = HTML_BLOCK.test(tag);
      if (blk) flush(st);
      kids(n, st2);
      if (blk) flush(st2);
    }
    /* HTML 목록도 마크다운 목록과 같은 단계 모양·글머리표·내어쓰기로 */
    function htmlList(n, st, depth) {
      var d = Math.min(depth, 4), ls = TPL.STYLE.body[d], ordered = n.tagName.toLowerCase() === 'ol';
      var start = parseInt(n.getAttribute('start'), 10); if (isNaN(start)) start = 1;
      var size = charSize(ls.char), left = paraLeft(ls.para) + (st.ind || 0), idx = 0;
      [].forEach.call(n.children, function (li) {
        if (li.tagName.toLowerCase() !== 'li') return;
        var marker = ordered ? (start + idx++) + ')' : TPL.BULLETS[d - 1], mw = markerW(marker + ' ', size);
        var save = runs, nested = [];
        runs = [{ c: ls.char, t: marker + ' ' }];
        [].forEach.call(li.childNodes, function (k) {
          if (k.nodeType === 1 && /^(ul|ol)$/i.test(k.tagName)) nested.push(k);
          else visit(k, Object.assign({}, st, { base: ls.char, f: {}, flat: true, pre: null }));
        });
        var r = runs; runs = save;
        var b = r.length; while (b > 1 && isBlank(r[b - 1])) b--;
        emitPara(r.slice(0, b), ls, paraFor(ls.para, { left: left, intent: -mw }), out, left + mw, 1200);
        nested.forEach(function (k) { htmlList(k, st, depth + 1); });
      });
    }
    var st0 = { ind: o.ind || 0, align: o.align || null, f: {}, depth: 0 };
    kids(root, st0);
    flush(st0);
  }

  /* 블록 토큰 → 문단들. o = {ind: 들여쓰기(목록 항목·인용 안), align: 바깥 정렬} */
  function blocks(tokens, out, o) {
    out = out || []; o = o || {};
    var ind = o.ind || 0, N = TPL.STYLE.normal;
    var alStack = [], dStack = [];   /* 여러 토큰에 걸친 <div align=center>…</div> 정렬 / <details>…</details>(닫혀 있으면 안 보임 — 미리보기와 같게) */
    function align() { return alStack.length ? alStack[alStack.length - 1] : (o.align || null); }
    function nPara() { var a = align(); return (ind || a) ? paraFor(N.para, { left: ind, align: a ? a.toUpperCase() : null }) : N.para; }
    function ictx(nl) { return { base: N.char, f: {}, nl: nl, maxW: CONTENT_W - ind, maxH: 40000 }; }
    /* 토큰 안 태그를 차례로 보며, 닫히지 않고 다음 토큰으로 넘어가는 컨테이너(div·center·details)만 스택에 남긴다 */
    function track(h) {
      var re = /<(\/?)(div|center|details)\b([^>]*)>/gi, m, local = [];
      while ((m = re.exec(h))) {
        var tag = m[2].toLowerCase();
        if (!m[1]) { local.push({ tag: tag, attrs: m[3] }); continue; }
        var k = local.length - 1; while (k >= 0 && local[k].tag !== tag) k--;
        if (k >= 0) local.splice(k, 1);
        else if (tag === 'details') dStack.pop();
        else alStack.pop();
      }
      local.forEach(function (e) {
        if (e.tag === 'details') dStack.push(/\bopen\b/i.test(e.attrs));
        else alStack.push(alignAttr(e.attrs) || (e.tag === 'center' ? 'center' : align()));
      });
    }
    function html(h) {
      var bare = h.trim(), m;
      if (!bare || /^<!--[\s\S]*-->$/.test(bare)) return;
      if ((m = /^<(div|center|p)\b([^>]*)>$/i.exec(bare))) { alStack.push(alignAttr(m[2]) || (m[1].toLowerCase() === 'center' ? 'center' : align())); return; }   /* 여는 태그만: 뒤 마크다운 블록들에 정렬 */
      if (/^<\/(div|center|p)>$/i.test(bare)) { alStack.pop(); return; }
      if (/^<table[\s>]/i.test(bare) && /<\/table>$/i.test(bare)) out.push(indented(ind, function () { return buildHtmlTable(h); }));   /* 표만 있는 블록: 예전 경로 그대로 */
      else htmlBlock(h, out, { ind: ind, align: align() });
      track(h);
    }
    mergeHtmlTables(tokens || []).forEach(function (t) {
      var raw = t.type === 'html' ? (t.text || t.raw || '') : '';
      if (dStack.indexOf(false) >= 0) { if (raw) track(raw); return; }   /* 닫힌 <details> 안 */
      switch (t.type) {
        case 'heading': out.push(headingBlock(t)); break;
        case 'paragraph': emitPara(inlineRuns(t.tokens, ictx(true)), N, nPara(), out, ind); break;
        case 'text': emitPara(t.tokens ? inlineRuns(t.tokens, ictx(false)) : [{ c: N.char, t: decode(t.text) }], N, nPara(), out, ind); break;
        case 'blockquote': blocks(t.tokens, out, { ind: ind + BQ_IND, align: align() }); break;   /* 인용: 미리보기 인용 상자 안쪽 여백만큼 들여쓰기 */
        case 'code': codeBlock(t, out, ind); break;
        case 'list': listBlocks(t, 1, out, ind); break;
        case 'table': out.push(indented(ind, function () { return buildTable(t); })); break;
        case 'html': html(raw); break;
        case 'hr': out.push(hrPara(ind)); break;
        case 'space': case 'def': break;
        default: if (t.tokens) emitPara(inlineRuns(t.tokens, ictx(false)), N, nPara(), out, ind); else if (t.text) out.push(paraOf([{ c: N.char, t: decode(t.text) }], N, 1000, null, null, nPara()));
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

    /* 미리보기와 같은 공용 전처리(md-prep.js): 느슨한 목록 보정·표지 제목 줄 빼기·이미지 크기 문법·공백 경로 + 같은 marked 설정
       → 같은 원문을 미리보기와 똑같이 해석한다. (공용 전처리가 없으면 예전 방식) */
    var prep = window.MDPREP ? window.MDPREP.prepare(md || '') : null;
    var fm = prep ? { meta: prep.meta, body: prep.md } : parseFrontmatter(md || ''), meta = fm.meta, body = fm.body;
    var pageFrame = !!(settings && settings.pageFrame);   /* 테두리는 문서 설정(UI)으로 전달 */
    var title = meta.title || meta['제목'] || '';
    var subtitle = meta.subtitle || meta['부제'] || '';
    if (title && !prep) body = body.replace(/^\s*#\s+(.*)\r?\n/, function (m0, h) { return h.trim() === title.trim() ? '' : m0; });

    /* 정부문서엔 들여쓰기(공백4+) 코드블록이 없음 → 감지 비활성(펜스 ```는 유지). 미리보기와 동일 규칙 */
    if (window.MDPREP) window.MDPREP.setupMarked();
    else if (!window.marked.__noIndentCode) { window.marked.__noIndentCode = 1; window.marked.use({ tokenizer: { code: function () { return undefined; } } }); }
    var tokens = window.marked.lexer(body);

    /* 다이어그램(mermaid) PNG 와 이미지 형식 정리를 먼저 끝낸다(비동기). 모듈 상태(CONTENT_W·CELLM·imgList·imgMap 등)는
       그 뒤 동기 구간에서만 설정한다 — 저장을 연달아 눌러 변환이 겹쳐도 서로의 상태를 섞지 않게. */
    var resolver = (settings && settings.imageResolver) || null;
    return Promise.all([resolveDiagrams(tokens), resolveImages(tokens, resolver)]).then(function (res) {
      CONTENT_W = pageFrame ? (BASE_CONTENT_W - 2 * FRAME_PAD - 566) : BASE_CONTENT_W;   /* 프레임 안쪽 폭으로 본문·표 생성(내부표 바깥여백 283*2=566 버퍼로 셀 넘침 방지) */
      CELLM = pageFrame ? 'left="360" right="360" top="240" bottom="240"' : 'left="510" right="510" top="141" bottom="141"';   /* 프레임: 좌우 360 유지, 상하만 360→240 축소(표 컴팩트) */
      numCtr = [0, 0, 0, 0, 0]; imgList = []; picSeq = 0;
      imgResolver = resolver; imgMap = res[1] || {};
      hdrReset();   /* 문맥별 글자·문단 모양 등록부(이번 변환에서 만든 것만 header.xml 에 덧붙임) */
      var coverP = coverParas(meta) || [];   /* 프레임 밖: 표지 */
      if (!coverP.length) {
        if (title) coverP.push(paraOf([{ c: TPL.STYLE.h[1].char, t: title }], TPL.STYLE.h[1], HH[1]));
        if (subtitle) coverP.push(paraOf([{ c: TPL.STYLE.h[2].char, t: subtitle }], TPL.STYLE.h[2], HH[2]));
      }
      /* tocP=프레임 밖 목차(첫 ```toc), framedParas=프레임 안 본문. 본문은 blocks() 한 번에 넘긴다 —
         <div align=center>…</div>·<details> 처럼 여러 토큰에 걸친 HTML 상태를 이어서 봐야 해서 */
      var tocP = [], framedParas = [], tocTok = null;
      var bodyToks = (tokens || []).filter(function (t) { if (!tocTok && t.type === 'code' && (t.lang || '').toLowerCase() === 'toc') { tocTok = t; return false; } return true; });
      if (tocTok) blocks([tocTok], tocP);
      blocks(bodyToks, framedParas);
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
        .replace('</hh:charProperties>', coverCP + hdr.cpXml.join('') + '</hh:charProperties>').replace(/<hh:charProperties itemCnt="\d+">/, '<hh:charProperties itemCnt="' + (hdr.cpBase + hdr.cpXml.length) + '">')
        .replace('</hh:paraProperties>', hdr.ppXml.join('') + '</hh:paraProperties>').replace(/<hh:paraProperties itemCnt="\d+">/, '<hh:paraProperties itemCnt="' + (hdr.ppBase + hdr.ppXml.length) + '">')
        .replace('</hh:borderFills>', bf14 + '</hh:borderFills>').replace(/<hh:borderFills itemCnt="\d+">/, '<hh:borderFills itemCnt="14">');
      /* 제목 1~4단계는 다음 문단과 같은 쪽에(미리보기 제목의 break-after:avoid 와 같게 — 쪽 끝에 제목만 덩그러니 남지 않게) */
      [1, 2, 3, 4].forEach(function (d) { headerXml = headerXml.replace(new RegExp('(<hh:paraPr id="' + TPL.STYLE.h[d].para + '"[^>]*>[\\s\\S]*?)keepWithNext="0"'), '$1keepWithNext="1"'); });
      /* 코드 글꼴(Consolas)을 쓴 문서만 LATIN 글꼴 목록 끝에 추가 — charFor 가 그 id(monoId)를 이미 참조 */
      if (hdr.mono) headerXml = headerXml.replace(/(<hh:fontface lang="LATIN" fontCnt=")(\d+)(">[\s\S]*?)(<\/hh:fontface>)/, function (m0, a, n, b, c) {
        return a + (+n + 1) + b + '<hh:font id="' + n + '" face="Consolas" type="TTF" isEmbedded="0"><hh:typeInfo familyType="FCAT_GOTHIC" weight="5" proportion="9" contrast="0" strokeVariation="0" armStyle="0" letterform="2" midline="0" xHeight="4"/></hh:font>' + c;
      });
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
