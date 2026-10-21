/* 미리보기 등에 넣는 HTML 정화 — v1.3.1 (vendor/purify.min.js = DOMPurify 3.2.7, Cure53, Apache-2.0/MPL-2.0).
   마크다운 안의 HTML 은 미리보기에서 진짜 HTML 로 그려진다. 거르지 않으면 남이 준 .md 의 <img src=x onerror=…> 같은 코드가
   앱 권한(Neutralino os·filesystem — 명령 실행·파일 쓰기)으로 돌 수 있다 → marked 출력·릴리스 노트·다이어그램 SVG 는 여기서 거른 뒤 넣는다.
   - 남기는 것: 글자 서식·표(colspan·colgroup)·그림(상대/절대 경로·윈도 드라이브 경로 D:/…·data:image)·링크(http·mailto·file·#)·
                할 일 체크박스·<details>·align·style 속성(크기·색)·SVG
   - 빼는 것: <script>·이벤트 속성(on…)·javascript: 링크·iframe/object/embed·<style>(앱 화면 전체 모양을 바꿈)·
              <form>·<button> 등 폼(앱 창을 다른 주소로 보낼 수 있음)·<map>/<area>(링크 처리 밖에서 창 이동)
   정화기를 못 불러온 경우엔 HTML 을 글자 그대로 보여 준다(실행되는 쪽보다 안전). */
(function () {
  'use strict';
  /* DOMPurify 기본 허용 + file: 링크 + 윈도 드라이브 경로(D:/폴더/그림.png, D:\폴더 — marked 는 역슬래시를 %5C 로 바꿔 넣는다.
     기본값은 'D:' 를 모르는 주소 형식으로 보고 지운다) */
  var URI_OK = /^(?:(?:(?:f|ht)tps?|mailto|tel|file):|[a-z]:(?:[\\/]|%5c)|[^a-z]|[a-z+.\-]+(?:[^a-z+.\-:]|$))/i;
  var CFG = {
    ALLOWED_URI_REGEXP: URI_OK,
    SANITIZE_NAMED_PROPS: true,   /* 글 속 HTML 의 id·name 앞에 'user-content-' — id="editor"·"pages" 같은 앱 요소 id 와 겹쳐 앱이 엉뚱한 요소를 잡지 않게 */
    FORBID_TAGS: ['style', 'form', 'button', 'textarea', 'select', 'option', 'optgroup', 'datalist', 'map', 'area'],
    FORBID_ATTR: ['action', 'formaction']
  };
  function asText(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  window.__sanitize = function (html) {
    var P = window.DOMPurify;
    if (!P || typeof P.sanitize !== 'function' || P.isSupported === false) return asText(html);
    return P.sanitize(String(html == null ? '' : html), CFG);
  };
})();
