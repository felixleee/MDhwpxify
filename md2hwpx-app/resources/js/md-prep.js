/* 미리보기(app.js)와 hwpx 변환(md2hwpx.js)이 같은 마크다운을 보게 하는 공용 전처리 — v1.3.0.
   예전엔 미리보기만 아래 보정을 해서, 같은 원문이 미리보기와 산출물에서 다르게 해석됐다
   (예: 크기 지정 이미지 ![](a.png =300x200)·공백 든 경로가 hwpx 엔 마크다운 글자 그대로 찍힘, "문단\n1. 항목"이 미리보기만 목록).
   - setupMarked(): marked 옵션·토크나이저(~~취소선~~만, 들여쓰기 코드블록 끔)를 한 번 설치
   - prepare(text) → {meta, md, map}
       meta = 프론트매터(표지) 값, md = marked 에 넘길 본문,
       map[i] = md 의 i번째 줄이 원본 text 의 몇 번째 줄인지(0-based, 보정으로 끼운 줄은 -1) — 미리보기 스크롤 동기화용 */
(function () {
  'use strict';
  var FM_RE = /^---\s*\n([\s\S]*?)\n---\s*\n/;

  function parseFrontmatter(t) {
    var m = t.match(FM_RE), meta = {};
    if (!m) return { meta: meta, body: t, lines: 0 };
    m[1].split('\n').forEach(function (line) { var i = line.indexOf(':'); if (i > 0) meta[line.slice(0, i).trim()] = line.slice(i + 1).trim().replace(/^["']|["']$/g, ''); });
    return { meta: meta, body: t.slice(m[0].length), lines: (m[0].match(/\n/g) || []).length };
  }

  /* 펜스 코드(```/~~~, 백틱 개수 무관) 추적: 여는 줄·닫는 줄 판정 */
  var FENCE_RE = /^\s*(`{3,}|~{3,})/;
  function fenceStep(fence, ln) {   /* → 이 줄을 지난 뒤의 펜스 상태(null=코드 밖) */
    var m = ln.match(FENCE_RE);
    if (fence) return (m && m[1].charAt(0) === fence.ch && m[1].length >= fence.len && /^\s*(`{3,}|~{3,})\s*$/.test(ln)) ? null : fence;
    return m ? { ch: m[1].charAt(0), len: m[1].length } : null;
  }
  function tableDelta(ln) { return (ln.match(/<table\b/gi) || []).length - (ln.match(/<\/table>/gi) || []).length; }

  /* 느슨한 목록 보정: 문단 바로 다음 줄에 오는 목록 항목 앞에 빈 줄을 끼워 목록으로 읽히게(정부 문서는 "□ 제목\n- 세부"처럼 붙여 씀).
     코드블록·HTML 표 안은 건드리지 않는다 — 예전엔 거기도 빈 줄을 끼워 코드 내용이 바뀌거나 HTML 표가 둘로 쪼개졌다. */
  function fixLooseLists(lines, map) {
    var isItem = function (s) { return /^\s*([-*+]|\d+\.)\s+/.test(s); };
    var out = [], omap = [], fence = null, tdep = 0;
    for (var i = 0; i < lines.length; i++) {
      var ln = lines[i];
      if (!fence && tdep <= 0 && isItem(ln)) { var p = out.length ? out[out.length - 1] : ''; if (p.trim() && !isItem(p)) { out.push(''); omap.push(-1); } }
      out.push(ln); omap.push(map[i]);
      var wasFence = fence;
      fence = fenceStep(fence, ln);
      if (!wasFence && !fence) tdep += tableDelta(ln);
    }
    return { lines: out, map: omap };
  }

  /* 이미지 크기 단축 문법(=300x200·=300x·=x200·=50%·=300) → <img>, 공백 든 경로 → <> 감싸기.
     코드블록·인라인 코드 밖에서만(문법 예시 보호). 줄 수 유지. */
  function outsideCode(lines, fn) {
    var out = [], fence = null;
    for (var i = 0; i < lines.length; i++) {
      var ln = lines[i];
      if (fence || FENCE_RE.test(ln)) { out.push(ln); fence = fenceStep(fence, ln); continue; }
      out.push(ln.split(/(`+[^`]*`+)/g).map(function (seg, k) { return k % 2 ? seg : fn(seg); }).join(''));
    }
    return out;
  }
  function ea(x) { return String(x).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
  function imageSyntax(s) {
    s = s.replace(/!\[([^\]]*)\]\(\s*([^()]*(?:\([^)]*\)[^()]*)*?)\s+=\s*(\d+x\d+|\d+x|x\d+|\d+%|\d+)\s*\)/g, function (m, alt, dest, sz) {
      var d = dest.replace(/^<|>$/g, '').trim(); if (!d || /["']/.test(d)) return m;
      var a;
      if (/^\d+x\d+$/.test(sz)) { var p = sz.split('x'); a = ' width="' + p[0] + '" height="' + p[1] + '"'; }
      else if (/^\d+x$/.test(sz)) a = ' width="' + sz.slice(0, -1) + '"';
      else if (/^x\d+$/.test(sz)) a = ' height="' + sz.slice(1) + '"';
      else if (/^\d+%$/.test(sz)) a = ' style="width:' + sz.slice(0, -1) + '%"';
      else a = ' width="' + sz + '"';
      return '<img src="' + ea(d) + '" alt="' + ea(alt) + '"' + a + '>';
    });
    s = s.replace(/!\[([^\]]*)\]\(\s*([^()]*(?:\([^)]*\)[^()]*)*)\s*\)/g, function (m, alt, dest) { if (!dest || dest.charAt(0) === '<') return m; if (/["']/.test(dest)) return m; if (!/\s/.test(dest)) return m; return '![' + alt + '](<' + dest.trim() + '>)'; });
    return s;
  }

  function prepare(text) {
    text = String(text == null ? '' : text).replace(/\r\n?/g, '\n');
    var fm = parseFrontmatter(text), meta = fm.meta;
    var lines = fm.body.split('\n'), map = [];
    for (var i = 0; i < lines.length; i++) map.push(fm.lines + i);
    var r = fixLooseLists(lines, map);
    lines = r.lines; map = r.map;
    /* 표지 제목과 같은 첫 '# 제목' 줄은 빼기(표지에 이미 크게 나옴) */
    var title = meta.title || meta['제목'] || '';
    if (title) {
      for (var q = 0; q < lines.length; q++) {
        if (lines[q].trim() === '') continue;
        var tm = lines[q].match(/^\s*#\s+(.*?)\s*$/);
        if (tm && tm[1].trim() === title.trim()) { lines.splice(q, 1); map.splice(q, 1); }
        break;
      }
    }
    lines = outsideCode(lines, imageSyntax);
    return { meta: meta, md: lines.join('\n'), map: map };
  }

  function setupMarked() {
    var mk = window.marked; if (!mk) return;
    mk.setOptions({ gfm: true, breaks: false });
    /* 취소선은 ~~두 개~~만(한 개 ~ 는 글자 그대로: "3~5일" 이 지워지지 않게) */
    if (!mk.__delFix) { mk.__delFix = 1; mk.use({ tokenizer: { del: function (src) { var m = /^~~(?=\S)([\s\S]*?\S)~~/.exec(src); if (m) return { type: 'del', raw: m[0], text: m[1], tokens: this.lexer.inlineTokens(m[1]) }; if (src.charCodeAt(0) === 126) return { type: 'text', raw: '~', text: '~' }; return false; } } }); }
    /* 들여쓰기 코드블록 감지 끔(펜스 ```는 유지) → 정부문서 들여쓴 하위항목이 코드로 오인되지 않게 */
    if (!mk.__noIndentCode) { mk.__noIndentCode = 1; mk.use({ tokenizer: { code: function () { return undefined; } } }); }
  }

  window.MDPREP = { prepare: prepare, setupMarked: setupMarked, parseFrontmatter: parseFrontmatter };
})();
