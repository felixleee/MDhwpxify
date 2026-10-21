/* md2hwpx 본체: 편집기 + A4 페이지네이션 미리보기(Paged.js) + .hwpx 저장
 * 미리보기 렌더 파이프라인은 MDeautify와 동일(buildSource → runPaged). */
(function () {
  'use strict';

  var TEMPLATES = { clean: window.TPL_CLEAN };
  var curTemplate = 'clean';   /* 출력(.hwpx) 렌더 템플릿 — 현재 clean 하나(모든 문서 공통) */
  /* 문서 골격('빈 양식으로 시작') 템플릿: tplSelect 로 선택. 출력은 항상 clean. */
  var DOC_TEMPLATES = { 'gov-report': function(){return window.GOV_REPORT_BLANK;}, 'gov-manual': function(){return window.GOV_MANUAL_BLANK;} };
  var DOC_NAMES = { 'gov-report': '완료보고서', 'gov-manual': '사용자매뉴얼' };
  var curDoc = 'gov-report';
  /* 문서 설정(문서 설정 모달): 테두리(내용 감싸는 1×1 표 틀). frontmatter 대신 UI 로 제어. */
  var docOpts = { frame: true };
  var curName = 'document';
  var $ = function (id) { return document.getElementById(id); };

  /* ---------- 공통 유틸 ---------- */
  function esc(s){return String(s).replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];});}   /* 따옴표까지 — 속성값(title='…') 안에서 끊고 나오지 못하게 */

  /* ---------- 편집기 구문 강조 미러(MDeautify 이식) ---------- */
  function hlMd(t){var e=esc(t);
  /* 각 줄을 .ln[data-ln] 로 감싸 스크롤 동기화(방식 B)에서 줄별 Y좌표를 측정 가능하게 함.
     인라인 span이라 오버레이(투명 textarea) 정합에는 영향 없음. */
  return e.split("\n").map(function(line,i){var l=line;
  if(/^\s{0,3}#{1,6}\s/.test(line))l='<span class="mh">'+l+'</span>';
  else if(/^\s{0,3}&gt;/.test(l))l='<span class="mq">'+l+'</span>';
  else{
  l=l.replace(/^(\s*)([-*+]|\d+\.)(\s)/,'$1<span class="ml">$2</span>$3');
  l=l.replace(/(`[^`]+`)/g,'<span class="mc">$1</span>');
  l=l.replace(/(\*\*[^*]+\*\*)/g,'<span class="mb">$1</span>');
  l=l.replace(/(\[[^\]]+\]\([^)]+\))/g,'<span class="mlk">$1</span>');
  }
  return '<span class="ln" data-ln="'+i+'">'+(l||'​')+'</span>';}).join("\n");}
  /* 미러 동기화: textarea 값이 바뀌는 모든 지점에서 호출(직접 .value= 는 input 이벤트를 안 쏘므로 필수). 전역 노출로 이식된 IIFE도 사용. */
  function syncMirror(){var r=$('raw'),ta=$('editor');if(r&&ta){r.innerHTML=hlMd(ta.value);}}
  window.__syncMirror=syncMirror;

  function buildCover(meta){
    var client=meta["고객사"]||meta["도입기업"]||"";
    var kicker=meta["사업명"]||meta.kicker||"";
    var title=meta.title||meta["제목"]||"";
    var subtitle=meta.subtitle||meta["부제"]||"";
    var date=meta["작성일"]||meta.date||"";
    var maker=meta["작성기관"]||meta.publisher||"";
    var special={"title":1,"subtitle":1,"제목":1,"부제":1,"사업명":1,"kicker":1,"쪽테두리":1,"테두리":1,"pageBorder":1,"고객사":1,"도입기업":1,"작성일":1,"date":1,"작성기관":1,"publisher":1,"서식":1,"form":1};
    var rows="";Object.keys(meta).forEach(function(k){if(special[k])return;rows+="<tr><td class='k'>"+esc(k)+"</td><td>"+esc(meta[k])+"</td></tr>";});
    if(!client&&!kicker&&!title&&!subtitle&&!date&&!maker&&!rows)return"";
    return "<div class='cover gov-cover'>"+
      (client?"<div class='gc-client'>"+esc(client)+"</div>":"")+
      ((kicker||title)?"<div class='gc-box'>"+(kicker?"<div class='gc-kicker'>"+esc(kicker)+"</div>":"")+(title?"<div class='gc-title'>"+esc(title)+"</div>":"")+"</div>":"")+
      (subtitle?"<div class='gc-sub'>"+esc(subtitle)+"</div>":"")+
      "<div class='gc-spacer'></div>"+
      (date?"<div class='gc-date'>"+esc(date)+"</div>":"")+
      (maker?"<div class='gc-maker'>"+esc(maker)+"</div>":"")+
      (rows?"<table class='gc-meta'>"+rows+"</table>":"")+
    "</div>";
  }

  var PAGED_CSS="@page{size:A4;margin:16mm 18mm;@top-center{content:' ';font-family:'Noto Sans KR','Malgun Gothic',sans-serif;font-size:9pt;color:#94a3b8;}@bottom-center{content:counter(page);font-family:'함초롬바탕','Malgun Gothic',sans-serif;font-size:10pt;color:#333;}}.content h1,.content h2,.content h3,.content h4{break-after:avoid-page;-webkit-column-break-after:avoid;}.content tr,.content img,.content svg,.content figure,.content blockquote{break-inside:avoid;}.content ul,.content ol,.content pre{break-inside:auto;}.content table{break-inside:avoid;}.content thead{break-after:avoid;}.pb-before{break-before:page;}.cover{break-after:page;}.content .mdocify-toc{break-after:page;}.content p,.content li{orphans:2;widows:2;}";
  /* 정부 양식 쪽 테두리(미리보기): body.mdocify-frame 일 때 style.css 가 .pagedjs_* chrome 에 프레임+여백 적용 */
  var pvFrame=false;

  /* ---------- 경량 코드 구문 강조 (VSCode Dark 계열, MDeautify와 동일) ---------- */
  function hlCode(src, lang){
    function E(s){return s.replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;");}
    function W(cls,txt){return '<span class="thl-'+cls+'">'+E(txt)+'</span>';}
    function scan(str,RE,map){var out="",last=0,m;while((m=RE.exec(str))!==null){if(m.index===RE.lastIndex){RE.lastIndex++;continue;}out+=E(str.slice(last,m.index))+W(map(m),m[0]);last=RE.lastIndex;}return out+E(str.slice(last));}
    lang=(lang||"").toLowerCase().trim();
    var AL={javascript:"js",jsx:"js",mjs:"js",node:"js",typescript:"ts",tsx:"ts","c++":"cpp",cxx:"cpp",cc:"cpp",hpp:"cpp","c#":"cs",csharp:"cs",py:"python",python3:"python",sh:"bash",shell:"bash",zsh:"bash",ps:"powershell",ps1:"powershell",pwsh:"powershell",xml:"html",htm:"html",markdown:"md",mkd:"md"};
    var L=AL[lang]||lang;
    if(L==="html"){return scan(src,/(<!--[\s\S]*?-->)|("(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*')|(<\/?[a-zA-Z][\w:-]*|\/?>)|([a-zA-Z_:][\w:.-]*)(?=\s*=)/g,function(m){return m[1]!==undefined?"com":m[2]!==undefined?"str":m[3]!==undefined?"kw":"fn";});}
    if(L==="css"||L==="scss"){var cRE=L==="scss"?"\\/\\*[\\s\\S]*?\\*\\/|\\/\\/[^\\n]*":"\\/\\*[\\s\\S]*?\\*\\/";var RE=new RegExp("("+cRE+")|(\"(?:\\\\.|[^\"\\\\])*\"|'(?:\\\\.|[^'\\\\])*')|(#[0-9a-fA-F]{3,8}\\b|\\b\\d[\\d.]*(?:px|em|rem|%|vh|vw|vmin|vmax|pt|s|ms|deg|fr|ch|ex)?\\b)|(@[\\w-]+|\\$[\\w-]+|--[\\w-]+|![a-z]+)|([a-zA-Z-][\\w-]*)(?=\\s*:)","g");return scan(src,RE,function(m){return m[1]!==undefined?"com":m[2]!==undefined?"str":m[3]!==undefined?"num":m[4]!==undefined?"kw":"fn";});}
    if(L==="md"){var lines=src.split("\n"),o=[];var inl=function(t){return scan(t,/(`[^`]+`)|(\*\*[^*]+\*\*|__[^_]+__)|(\*[^*\n]+\*|_[^_\n]+_)|(\[[^\]]+\]\([^)]+\))/g,function(m){return m[1]!==undefined?"str":m[2]!==undefined?"kw":m[3]!==undefined?"lit":"fn";});};for(var i=0;i<lines.length;i++){var ln=lines[i];if(/^\s{0,3}#{1,6}\s/.test(ln)){o.push(W("kw",ln));}else if(/^\s{0,3}>/.test(ln)){o.push(W("com",ln));}else if(/^\s{0,3}(```|~~~)/.test(ln)){o.push(W("kw",ln));}else{var mm=ln.match(/^(\s{0,3})([-*+]|\d+\.)(\s.*)$/);if(mm){o.push(E(mm[1])+W("kw",mm[2])+inl(mm[3]));}else{o.push(inl(ln));}}}return o.join("\n");}
    var K={js:"abstract async await break case catch class const continue debugger default delete do else export extends finally for from function get if implements import in instanceof interface let new of package private protected public return set static super switch this throw try typeof var void while with yield",ts:"abstract as async await break case catch class const continue declare default delete do else enum export extends finally for from function get if implements import in infer instanceof interface keyof let namespace new of private protected public readonly return set static super switch this throw try type typeof var void while yield",c:"auto break case char const continue default do double else enum extern float for goto if inline int long register return short signed sizeof static struct switch typedef union unsigned void volatile while include define ifdef ifndef endif pragma undef",cpp:"auto bool break case catch char class const constexpr continue default delete do double else enum explicit extern float for friend goto if inline int long namespace new nullptr operator override private protected public register return short signed sizeof static struct switch template this throw try typedef typename union unsigned using virtual void volatile while include define",cs:"abstract as base bool break byte case catch char checked class const continue decimal default delegate do double else enum event explicit extern finally fixed float for foreach get goto if implicit in int interface internal is lock long namespace new object operator out override params private protected public readonly ref return sbyte sealed set short sizeof static string struct switch this throw try typeof uint ulong unchecked unsafe ushort using var virtual void volatile while async await yield",php:"abstract and array as break callable case catch class clone const continue declare default do echo else elseif empty endif extends final finally fn for foreach function global goto if implements include include_once instanceof insteadof interface isset list namespace new or print private protected public require require_once return static switch throw trait try unset use var while xor yield",python:"and as assert async await break class continue def del elif else except finally for from global if import in is lambda nonlocal not or pass raise return try while with yield match case",bash:"if then else elif fi case esac for while until do done in function select time echo cd export local return read source alias unset shift eval exec set",powershell:"if elseif else switch foreach for while do until break continue function return param begin process end try catch finally throw class enum filter in trap exit",sql:"select from where insert into values update set delete create table drop alter add column index view join inner left right outer full on group by order having limit offset union all as distinct and or not null is in like between exists case when then else end primary key foreign references default constraint unique",json:""};
    var LN={js:["//"],ts:["//"],c:["//"],cpp:["//"],cs:["//"],php:["//","#"],python:["#"],bash:["#"],powershell:["#"],sql:["--"],json:[]};
    var BL={js:1,ts:1,c:1,cpp:1,cs:1,php:1,sql:1},TPL={js:1,ts:1},TRIPLE={python:1};
    if(!(L in K))L="js";
    function q(s){return s.replace(/[.*+?^${}()|[\]\\]/g,"\\$&");}
    var g=[],com=[];if(BL[L])com.push("\\/\\*[\\s\\S]*?\\*\\/");if(L==="powershell")com.push("<#[\\s\\S]*?#>");(LN[L]||[]).forEach(function(x){com.push(q(x)+"[^\\n]*");});g.push(com.length?com.join("|"):"(?!)");
    var st=[];if(TRIPLE[L]){st.push('"""[\\s\\S]*?"""',"'''[\\s\\S]*?'''");}st.push('"(?:\\\\.|[^"\\\\])*"',"'(?:\\\\.|[^'\\\\])*'");if(TPL[L])st.push("`(?:\\\\.|[^`\\\\])*`");g.push(st.join("|"));
    g.push("0[xX][\\da-fA-F]+|\\b\\d[\\d_]*(?:\\.\\d+)?(?:[eE][+-]?\\d+)?\\b");
    var kw=(K[L]||"").trim();g.push(kw?"\\b(?:"+kw.split(/\s+/).map(q).join("|")+")\\b":"(?!)");
    g.push("\\b(?:true|false|null|undefined|None|True|False|nil|NaN|NULL)\\b");
    g.push("[A-Za-z_$][\\w$]*(?=\\s*\\()");
    var RE2=new RegExp(g.map(function(x){return "("+x+")";}).join("|"),"g"+(L==="sql"?"i":""));
    return scan(src,RE2,function(m){return m[1]!==undefined?"com":m[2]!==undefined?"str":m[3]!==undefined?"num":m[4]!==undefined?"kw":m[5]!==undefined?"lit":"fn";});
  }

  /* ---------- 소스(.content) 빌드 ---------- */
  function buildSource(text){
    /* 마크다운 보정(느슨한 목록·표지 제목·이미지 크기 문법·공백 경로)과 marked 설정은 hwpx 변환과 같은 공용 전처리(md-prep.js) —
       미리보기만 따로 고치면 같은 원문이 산출물에서 다르게 해석된다. srcMap: srcmd 각 줄 → 원본 text 줄(스크롤 sync 방식 B, 삽입줄=-1) */
    var prep=window.MDPREP.prepare(text),meta=prep.meta;
    pvFrame=!!docOpts.frame;   /* 테두리: 문서 설정 모달로 제어 */
    document.body.classList.toggle('mdocify-frame',pvFrame);   /* 프레임 CSS는 메인 style.css에서 .pagedjs_* chrome 에 적용(주입 X) */
    var srcmd=prep.md,srcMap=prep.map;
    window.MDPREP.setupMarked();
    var src=$('src');
    /* 마크다운 안 HTML 은 정화한 뒤 넣는다(sanitize.js) — 숨은 #src 에 넣는 순간에도 <img onerror> 같은 코드는 실행되므로 넣기 전에 */
    src.innerHTML=buildCover(meta)+"<div class='content'>"+window.__sanitize(window.marked.parse(srcmd))+"</div>";
    src.querySelectorAll(".content a[href]").forEach(function(a){a.setAttribute("target","_blank");a.setAttribute("rel","noopener noreferrer");});
    /* 표 헤더(첫 행이 전부 th·rowspan 없음)를 <thead>로 감싸 Paged.js가 페이지마다 헤더 반복(산출물 repeatHeader와 동일) → 헤더 고아·표 중복 방지 */
    src.querySelectorAll(".content table").forEach(function(t){
      if(t.querySelector("thead"))return;
      var body=t.querySelector("tbody")||t, rows=body.querySelectorAll(":scope > tr"), first=rows[0];
      /* 첫 행이 전부 th·rowspan 없음 + 뒤에 본문 행이 실제로 있을 때만 thead화(표지 등 1행짜리 표는 제외) */
      if(rows.length>1 && first && first.querySelector("th") && !first.querySelector("td") && !first.querySelector("[rowspan]")){
        var thead=document.createElement("thead");thead.appendChild(first);t.insertBefore(thead,body);
      }
    });
    /* 정부 양식 미리보기: 헤딩 자동 절번호(1./1.1). md에 번호 있으면 그대로 (hwpx 출력과 동일 규칙) */
    (function(){var ctr=[0,0,0,0,0];var HN=/^\s*(\d+([.\-]\d+)*\.?|[가나다라마바사아자차카타파하][.)]|[IVXⅠⅡⅢⅣⅤⅥⅦⅧⅨⅩ]+\.|[①-⑳])\s+/;
      src.querySelectorAll(".content h1,.content h2,.content h3,.content h4").forEach(function(h){
        var d=+h.tagName.slice(1); if(d<1||d>4)return;
        if(HN.test(h.textContent))return;
        ctr[d]++; for(var i=d+1;i<ctr.length;i++)ctr[i]=0;
        var parts=[];for(var j=1;j<=d;j++)parts.push(ctr[j]);
        var sn=document.createElement('span');sn.className='secnum';sn.textContent=parts.join('.')+(d===1?'.':'');h.insertBefore(document.createTextNode(' '),h.firstChild);h.insertBefore(sn,h.firstChild);   /* innerHTML 로 다시 읽고 쓰지 않음 */
      });})();
    /* 목차(```toc): "들여쓰기(레벨) 항목  쪽번호" → 점선 leader + 우측 쪽번호(정부양식). 코드 하이라이트보다 먼저 처리(pre 제거). */
    src.querySelectorAll(".content pre code.language-toc").forEach(function(c){
      var pre=c.closest("pre")||c, box=document.createElement("div");box.className="mdocify-toc";
      String(c.textContent||"").replace(/\n+$/,"").split("\n").forEach(function(ln){
        if(!ln.trim())return;
        var level=Math.min(3,(ln.match(/^ */)[0]||"").length);
        var b=ln.replace(/^\s+/,""),m=/^(.*\S)\s+(\d+)$/.exec(b);
        if(!m){var t=document.createElement("div");t.className="toc-title";t.textContent=b;box.appendChild(t);return;}
        var entry=m[1],page=m[2];
        var row=document.createElement("div");row.className="toc-row toc-l"+level;
        var e=document.createElement("span");e.className="toc-entry";e.textContent=entry;
        var d=document.createElement("span");d.className="toc-dots";
        var p=document.createElement("span");p.className="toc-page";p.textContent=page;
        row.appendChild(e);row.appendChild(d);row.appendChild(p);box.appendChild(row);
      });
      pre.replaceWith(box);
    });
    src.querySelectorAll("code.language-mermaid").forEach(function(c){var pre=c.closest("pre")||c;var kind=window.DIAG?window.DIAG.detectKind(c.textContent):null;var fig=document.createElement("figure");if(kind){fig.innerHTML=window.__sanitize(window.DIAG.render(kind,c.textContent));}else{var box=document.createElement("div");box.className="diag-unsupported";var ti=document.createElement("div");ti.className="du-title";ti.textContent="지원하지 않는 다이어그램 (지원: flowchart · sequence · erDiagram · pie · state · class · gantt · journey · mindmap · timeline)";box.appendChild(ti);fig.appendChild(box);}pre.replaceWith(fig);});
    src.querySelectorAll("pre code[class*='language-']").forEach(function(c){var mm=(c.className||"").match(/language-([\w#+.-]+)/);c.innerHTML=hlCode(c.textContent,mm?mm[1]:"");});
    /* A1: 긴 코드블록이 페이지 경계에서 잘리지 않게 — 각 줄을 블록 span(.cl)으로 감싸 Paged.js에 분할지점 제공(빈 줄=제로폭공백) */
    src.querySelectorAll(".content pre > code").forEach(function(c){var h=c.innerHTML.replace(/\n$/,"");c.innerHTML=h.split("\n").map(function(ln){return "<span class='cl'>"+(ln===""?"​":ln)+"</span>";}).join("");});
    /* 스크롤 sync(방식 B): 최상위 블록마다 원본 줄번호를 data-sl 로 태깅(marked 토큰 누적 줄수 → srcMap 로 원본 줄 역변환).
       렌더 미출력 토큰(space/def)은 DOM 자식 1:1 대응에서 제외. 목록 항목·표 행은 세분 태깅(큰 블록 내부 드리프트 감소). */
    try{
      var _toks=window.marked.lexer(srcmd),_nl=function(s){return (s.match(/\n/g)||[]).length;};
      var _toEd=function(fl){var o=srcMap[fl],j=fl;while((o==null||o<0)&&j<srcMap.length-1){j++;o=srcMap[j];}return (o==null||o<0)?0:o;};
      var _info=[],_cum=0;
      for(var _ti=0;_ti<_toks.length;_ti++){var _tk=_toks[_ti];if(_tk.type!=="space"&&_tk.type!=="def")_info.push({tok:_tk,fl:_cum});_cum+=_nl(_tk.raw);}
      var _content=src.querySelector(".content"),_blks=_content?_content.children:[];
      for(var _k=0;_k<_blks.length&&_k<_info.length;_k++){
        var _el=_blks[_k],_t=_info[_k].tok,_f=_info[_k].fl;
        _el.setAttribute("data-sl",_toEd(_f));
        if(_t.type==="list"&&_t.items){var _lis=_el.children,_lc=_f,_li=0;for(var _ii=0;_ii<_t.items.length;_ii++){while(_li<_lis.length&&_lis[_li].tagName!=="LI")_li++;if(_li<_lis.length){_lis[_li].setAttribute("data-sl",_toEd(_lc));_li++;}_lc+=_nl(_t.items[_ii].raw);}}
        else if(_t.type==="table"){var _trs=_el.querySelectorAll("tr");for(var _ri=0;_ri<_trs.length;_ri++)_trs[_ri].setAttribute("data-sl",_toEd(_f+(_ri===0?0:_ri+1)));}
      }
    }catch(e){}
    return src;
  }

  /* ---------- 페이지네이션 (Paged.js) ---------- */
  function setHead(txt){var h=$('pvHead');if(h)h.textContent=txt;}
  function fallbackRender(src){var pages=$('pages');pages.innerHTML="";var d=document.createElement("div");d.className="fallback-doc";[].forEach.call(src.childNodes,function(n){d.appendChild(n.cloneNode(true));});pages.appendChild(d);setHead("연속 보기 (페이지 분할 미리보기를 사용할 수 없습니다)");}
  /* Paged.js가 한 표를 페이지 나눔 하면 이어지는 조각(data-split-from)엔 thead가 빠짐 → 원본 조각의 thead/colgroup을 복제해 반복.
     반드시 '같은 표의 연속 조각'에만 적용(data-split-from 가드). 안 그러면 앞 표의 헤더가 뒤의 무관한 표에 붙는 버그 발생. */
  function repeatTableHeaders(container){
    var last=null;
    container.querySelectorAll(".pagedjs_page table").forEach(function(t){
      var thead=t.querySelector(":scope > thead");var colg=t.querySelector(":scope > colgroup");
      if(!t.hasAttribute("data-split-from")){last=thead?{thead:thead,colg:colg}:null;return;}
      if(thead)return;
      if(last){if(last.colg&&!colg){t.insertBefore(last.colg.cloneNode(true),t.firstChild);}var tb=t.querySelector(":scope > tbody");var h=last.thead.cloneNode(true);if(tb){t.insertBefore(h,tb);}else{t.appendChild(h);}}
    });
  }
  function runPaged(src,keepScroll,attempt){
    attempt=attempt||0;
    var myGen=(window.__pgGen=(window.__pgGen||0)+1);   /* A2 세대 가드: 더 새 조판이 시작되면 이 결과 폐기(조판 경쟁 방지) */
    var pages=$('pages'),viewer=pages;
    var vMax=viewer.scrollHeight-viewer.clientHeight;
    var ratio=(keepScroll&&vMax>0)?viewer.scrollTop/vMax:0;
    function restore(){var m=viewer.scrollHeight-viewer.clientHeight;viewer.scrollTop=keepScroll?ratio*m:0;}
    pages.innerHTML="";
    if(!window.PagedModule||!window.PagedModule.Previewer){fallbackRender(src);restore();hidePreviewLoading();return;}
    var blobUrl=null;try{blobUrl=URL.createObjectURL(new Blob([PAGED_CSS],{type:"text/css"}));}catch(e){}
    try{
      var prev=new window.PagedModule.Previewer();
      /* 콘텐츠 맨 앞에 <style> 을 붙이면 Paged.js 가 첫 페이지를 복제한다(표지 없는 문서에서 발현, MDeautify 4477cb3).
         → PAGED_CSS 는 스타일시트(blobUrl)로만 넘기고, blob 생성 실패 시에만 인라인 <style> 폴백. */
      var content=blobUrl?src.innerHTML:("<style>"+PAGED_CSS+"</style>"+src.innerHTML);
      prev.preview(content, blobUrl?[blobUrl]:[], pages).then(function(flow){
        if(blobUrl){try{URL.revokeObjectURL(blobUrl);}catch(e){}}
        if(myGen!==window.__pgGen)return;   /* 스테일 결과 폐기(더 새 조판이 진행 중) */
        /* A2 오버플로 검출 → 자동 재조판: 조판 경쟁으로 내용이 단을 넘으면(scrollWidth>clientWidth) 최대 2회 재시도 */
        var bad=false,pcs=pages.querySelectorAll(".pagedjs_page_content");
        for(var bi=0;bi<pcs.length;bi++){if(pcs[bi].scrollWidth>pcs[bi].clientWidth+4){bad=true;break;}}
        if(bad&&attempt<2){setTimeout(function(){if(myGen===window.__pgGen)runPaged(src,keepScroll,attempt+1);},50);return;}
        repeatTableHeaders(pages);
        /* 표지·목차 페이지는 테두리(프레임) 제외 — 원본과 동일(본문 페이지만 테두리) */
        pages.querySelectorAll(".pagedjs_page").forEach(function(pg){ if(pg.querySelector(".cover,.mdocify-toc")) pg.classList.add("mdocify-noframe"); });
        if(typeof window.applyFooter==="function")window.applyFooter();
        if(typeof window.applyHeader==="function")window.applyHeader();
        var n=pages.querySelectorAll(".pagedjs_page").length||((flow&&flow.total)||0);
        setHead("Total "+n+" page"+(n>1?"s":""));
        restore();hidePreviewLoading();
      }).catch(function(err){console.error(err);if(blobUrl){try{URL.revokeObjectURL(blobUrl);}catch(e){}}if(myGen!==window.__pgGen)return;fallbackRender(src);restore();hidePreviewLoading();});
    }catch(e){console.error(e);fallbackRender(src);restore();hidePreviewLoading();}
  }

  /* 미리보기 로딩 스피너: 200ms 지연 표시(빠른 렌더=타이핑엔 안 뜸, 큰 파일처럼 오래 걸릴 때만 표시) */
  var _plTimer=null;
  function showPreviewLoading(msg){var el=$('previewLoading');if(!el)return;var m=el.querySelector('.pl-msg');if(m&&msg)m.textContent=msg;clearTimeout(_plTimer);_plTimer=setTimeout(function(){el.hidden=false;},200);}
  function hidePreviewLoading(){clearTimeout(_plTimer);var el=$('previewLoading');if(el)el.hidden=true;}
  window.__previewLoadingHide=hidePreviewLoading;

  var debounceTimer=null;
  async function renderPreview(text, keepScroll){
    showPreviewLoading('미리보기 준비 중…');
    await new Promise(function(r){setTimeout(r,0);});   /* 스피너가 페인트될 기회를 준 뒤 무거운 작업 시작 */
    var src=buildSource(text);
    if(typeof window.__resolveLocalImages==="function"){try{await window.__resolveLocalImages(src);}catch(e){}}
    document.body.classList.add('loaded');
    setHead("페이지 분할 중...");
    runPaged(src, keepScroll);
  }
  /* 입력 시 색상 미러만 즉시 갱신, 무거운 미리보기 재생성은 입력을 멈춘 뒤 2초 후 1회(타이핑 중 재분할 깜빡임 방지) — MDeautify EDIT_DELAY=2000 과 동일 */
  var EDIT_DELAY=2000;
  function onEdit(){syncMirror();if(window.__tabsOnEdit)window.__tabsOnEdit();clearTimeout(debounceTimer);debounceTimer=setTimeout(function(){renderPreview($('editor').value,true);if(window.__autoSave&&window.__autoSaveMd)window.__autoSaveMd();},EDIT_DELAY);}

  /* 이식된(별도 IIFE) 뱃지/드롭/ZIP 코드가 호출하는 브리지: 미리보기 재생성 + 편집기 텍스트 교체 */
  window.__render=function(text, keepScroll){ renderPreview(text, keepScroll); };
  window.__setEditorText=function(text){ $('editor').value=text; if(window.__fname)curName=window.__fname; document.body.classList.add('loaded'); $('editor').scrollTop=0; syncMirror(); renderPreview(text,false); if(window.__markClean)window.__markClean(); };

  /* ---------- 파일 로드 / 빈 문서 ---------- */
  function loadFile(file){
    if(!file)return;
    var r=new FileReader();
    r.onload=function(e){
      var nm=(file.name||'document'),fn=nm.replace(/\.(md|markdown|txt)$/i,'');
      if(window.__openDoc){window.__openDoc({path:null,dir:null,name:nm,fname:fn,text:e.target.result,drop:{}});return;}
      $('editor').value=e.target.result;
      curName=fn;window.__mdName=nm;window.__fname=fn;
      document.body.classList.add('loaded');
      $('editor').scrollTop=0;
      syncMirror();
      renderPreview(e.target.result,false);
      if(window.__markClean)window.__markClean();
    };
    r.readAsText(file,'utf-8');
  }
  function startBlank(){
    /* 선택된 문서 골격(tplSelect)으로 시작 — 내용은 플레이스홀더(빈 양식). 없으면 빈 문서 폴백. */
    var fn=DOC_TEMPLATES[curDoc],seed=(fn&&typeof fn()==='string')?fn():'';
    var nm=DOC_NAMES[curDoc]||'document';
    if(window.__openDoc){window.__openDoc({path:null,dir:null,name:nm,fname:nm,text:seed,drop:{}});$('editor').focus();return;}   /* 새 탭 */
    $('editor').value=seed;curName=nm;
    window.__mdName=null;window.__fname=nm;
    document.body.classList.add('loaded');
    $('editor').scrollTop=0;
    syncMirror();
    renderPreview(seed,false);
    if(window.__markClean)window.__markClean();
    $('editor').focus();
  }

  /* ---------- .hwpx 저장 ---------- */
  /* 드롭 풀(webp 재인코딩) 폴백 resolver: data URI의 실제 mime로 확장자를 맞춤(바이트-확장자 불일치 방지). */
  function dropResolver(src){
    try{
      if(/^(https?:|data:|blob:)/i.test(src))return null;
      var s=src;try{s=decodeURIComponent(src);}catch(e){}
      var base=s.split(/[\\/]/).pop(),norm=s.replace(/^\.\//,"").replace(/\\/g,"/");
      var du=window.__drop&&(window.__drop[norm]||window.__drop[base]);
      if(!du)return null;
      var i=String(du).indexOf(",");if(i<0)return null;
      var mm=/^data:([^;,]+)/.exec(du),mime=mm?mm[1]:'image/png',ext=(mime.split('/')[1]||'png').toLowerCase();if(ext==='jpeg')ext='jpg';
      var bin=atob(du.slice(i+1)),bytes=new Uint8Array(bin.length),k;
      for(k=0;k<bin.length;k++)bytes[k]=bin.charCodeAt(k)&0xff;
      return {bytes:bytes,ext:ext};
    }catch(e){return null;}
  }
  /* 마지막으로 hwpx 를 저장한 폴더(.md 경로가 없는 문서의 기본 위치) — mdocify_ 접두어라 exe 에선 settings.json 에 남는다 */
  var HWPX_DIR_KEY='mdocify_lastHwpxDir';
  function lastHwpxDir(){try{return localStorage.getItem(HWPX_DIR_KEY)||'';}catch(e){return '';}}
  function rememberHwpxDir(p){try{localStorage.setItem(HWPX_DIR_KEY,p.replace(/[\\\/][^\\\/]*$/,''));}catch(e){}}
  function appAlert(msg,title){if(window.__appAlert)window.__appAlert(msg,title||'알림');else alert(msg);}
  async function saveDocx(){
    var md=$('editor').value||'';
    if(!md.trim()){appAlert('내용이 없습니다. 먼저 MD를 입력하거나 파일을 여세요.');return;}
    /* 파일 이름은 지금 탭 기준(__fname). curName 은 탭 전환·다른 이름으로 저장 때 안 바뀌어 다른 문서 이름이 붙었다. 변환 중 탭을 바꿔도 안 흔들리게 시작 시점에 고정 */
    var name=window.__fname||curName||'document';
    var tpl=TEMPLATES[curTemplate]||window.TPL_CLEAN;
    var isExe=(typeof window.NL_PORT!=='undefined'&&typeof window.Neutralino!=='undefined');
    /* exe: 저장할 곳을 먼저 고른다 — 기본은 .md 와 같은 폴더(없으면 마지막으로 hwpx 를 저장한 폴더). 예전엔 다운로드 폴더로만 갔다 */
    var outPath=null;
    if(isExe){
      var dir=window.__mdDir||lastHwpxDir();
      try{outPath=await Neutralino.os.showSaveDialog('hwpx로 저장',{defaultPath:(dir?dir+'\\':'')+name+'.hwpx',filters:[{name:'한글 문서',extensions:['hwpx']},{name:'모든 파일',extensions:['*']}]});}catch(e){outPath=null;}
      if(!outPath)return;   /* 취소 */
      if(!/\.hwpx$/i.test(outPath))outPath+='.hwpx';
    }
    setBusy(true);
    try{
      /* 이미지 공급자: 변환기가 실제로 쓰는 경로만 물어 온다(크기 지정·공백 경로·HTML <img> 포함 — 예전엔 원문을 정규식으로 훑어 일부를 놓쳤다).
         파일 열기로 연 문서(__mdDir)면 원본 바이트를 디스크에서 읽고(한글이 원본 형식 그대로 렌더), 없으면 드롭 풀(webp) */
      var resolver=async function(src){
        if(window.__mdDir&&window.__readOrigBytes&&!/^(https?:|data:|blob:)/i.test(src)){
          var r=await window.__readOrigBytes(src);
          if(!r){var s=src;try{s=decodeURIComponent(src);}catch(e){}if(s!==src)r=await window.__readOrigBytes(s);}
          if(r)return r;
        }
        return dropResolver(src);
      };
      var blob=await window.MD2HWPX.convert(md,tpl,Object.assign({},window.__docSettings,{imageResolver:resolver,pageFrame:docOpts.frame}));
      if(isExe){
        try{await Neutralino.filesystem.writeBinaryFile(outPath,await blob.arrayBuffer());}
        catch(e){try{Neutralino.debug.log('[hwpx] '+((e&&e.message)||e));}catch(_){}appAlert('저장하지 못했어요. 같은 이름의 파일이 한글에서 열려 있으면 닫고 다시 저장해 주세요.','저장 실패');return;}
        rememberHwpxDir(outPath);
        showSavedModal(outPath.replace(/^.*[\\\/]/,'').replace(/\.hwpx$/i,''),outPath);
      }else{
        var url=URL.createObjectURL(blob);
        var a=document.createElement('a');a.href=url;a.download=name+'.hwpx';
        document.body.appendChild(a);a.click();a.remove();
        setTimeout(function(){URL.revokeObjectURL(url);},1000);
        showSavedModal(name,null);   /* 저장 완료 → 실제 한글에서 확인 안내 */
      }
    }catch(err){console.error(err);appAlert('변환 실패: '+(err&&err.message?err.message:err),'오류');}
    finally{setBusy(false);}
  }
  /* .hwpx 저장 완료 안내 모달: 미리보기는 근사치 → 실제 한글에서 최종 확인 권고. exe 면 저장 폴더 + [한글에서 열기](기본 연결 프로그램) */
  function showSavedModal(fname,path){
    var prev=document.querySelector('.saved-modal-ov');if(prev)prev.remove();
    var ov=document.createElement('div');ov.className='saved-modal-ov';
    var dir=path?path.replace(/[\\\/][^\\\/]*$/,''):'';
    ov.innerHTML="<div class='saved-modal' role='dialog' aria-modal='true'>"+
      "<div class='sm-ic'>📄</div>"+
      "<div class='sm-title'>hwpx 저장 완료</div>"+
      "<div class='sm-msg'><b>"+esc(fname)+".hwpx</b> 저장됨.<br>미리보기는 근사치예요 — <b>실제 한글에서 열어 최종 레이아웃을 확인</b>해 주세요.</div>"+
      (dir?"<div class='sm-path' title='"+esc(path)+"'>"+esc(dir)+"</div>":"")+
      "<div class='sm-btns'>"+(path?"<button type='button' class='sm-open'>한글에서 열기</button>":"")+"<button type='button' class='sm-ok'>확인</button></div></div>";
    document.body.appendChild(ov);
    function close(){ov.remove();document.removeEventListener('keydown',onKey);}
    function openIt(){close();try{Neutralino.os.open(path);}catch(e){}}
    function onKey(e){
      if(e.key==='Escape')close();
      else if(e.key==='Enter'){e.preventDefault();var f=document.activeElement;if(f&&f.classList&&f.classList.contains('sm-open'))openIt();else close();}   /* Enter = 초점 버튼(기본 확인) */
    }
    ov.querySelector('.sm-ok').addEventListener('click',close);
    var ob=ov.querySelector('.sm-open');if(ob)ob.addEventListener('click',openIt);
    ov.addEventListener('click',function(e){if(e.target===ov)close();});
    document.addEventListener('keydown',onKey);
    try{ov.querySelector('.sm-ok').focus();}catch(e){}
  }
  function setBusy(b){var el=$('btnSave');if(el)el.disabled=b;document.body.classList.toggle('busy',b);}

  /* ---------- 리사이즈 + 접기 (A2: 사이드 패널 제외한 가용폭을 비율로 분할) ---------- */
  function initSplitter(){
    var main=$('main'),pane=$('editorPane'),viewer=$('previewWrap'),sp=$('splitter'),fb=$('foldBtn');
    if(!main||!pane||!sp||!fb)return;
    var ico=fb.querySelector('.fold-ico'),lastBasis='50%',dragging=false,ratio=.5;
    function setIco(){ico.textContent=document.body.classList.contains('editor-collapsed')?'›':'‹';}
    /* 가용폭 = main 내부폭 − (편집/미리보기가 아닌 모든 형제 폭) → AI 패널·리사이저·스플리터가 자동으로 빠진다.
       ⚠️ 편집/미리보기의 현재 rect 로 계산하면 안 됨(이미 찌그러진 레이아웃 기준이 되어 값 어긋남). */
    function avail(){var t=main.clientWidth,cs=main.children;for(var i=0;i<cs.length;i++){var c=cs[i];if(c===pane||c===viewer)continue;t-=c.getBoundingClientRect().width;}return t;}
    function relayout(){
      if(!viewer||dragging||document.body.classList.contains('editor-collapsed'))return;
      if(!pane.offsetWidth&&!viewer.offsetWidth)return;           /* 아직 안 보이면 통과 */
      var a=avail();if(!(a>0))return;
      var maxW=a-260;if(maxW<180)maxW=180;                        /* 미리보기 최소 260 보장 */
      var w=Math.max(180,Math.min(maxW,Math.round(a*ratio)));
      if(Math.abs(pane.getBoundingClientRect().width-w)<.5)return;/* 변화 없으면 no-op */
      pane.style.flex='0 0 '+w+'px';lastBasis=w+'px';
    }
    window.__relayoutPanes=relayout;
    window.addEventListener('resize',relayout);
    fb.addEventListener('mousedown',function(e){e.stopPropagation();});
    fb.addEventListener('click',function(e){e.stopPropagation();var c=document.body.classList.toggle('editor-collapsed');if(!c)pane.style.flex='0 0 '+lastBasis;setIco();});
    sp.addEventListener('mousedown',function(e){if(e.target===fb||fb.contains(e.target))return;dragging=true;document.body.style.userSelect='none';document.body.style.cursor='col-resize';if(document.body.classList.contains('editor-collapsed')){document.body.classList.remove('editor-collapsed');setIco();}e.preventDefault();});
    window.addEventListener('mousemove',function(e){if(!dragging)return;var er=pane.getBoundingClientRect();var a=avail();var maxW=(a>0)?Math.max(180,a-260):(main.clientWidth-260);var w=Math.max(180,Math.min(maxW,e.clientX-er.left));pane.style.flex='0 0 '+w+'px';lastBasis=w+'px';if(a>0)ratio=w/a;});   /* 편집 패널의 실제 왼쪽 기준 + 드래그 중 비율 갱신 */
    window.addEventListener('mouseup',function(){if(dragging){dragging=false;document.body.style.userSelect='';document.body.style.cursor='';}});
    setIco();
  }

  /* ---------- 초기화 ---------- */
  function init(){
    $('editor').addEventListener('input',onEdit);
    $('editor').addEventListener('scroll',function(){var r=$('raw');if(r){r.scrollTop=$('editor').scrollTop;r.scrollLeft=$('editor').scrollLeft;}});
    $('fileInput').addEventListener('change',async function(e){var f=e.target.files[0];e.target.value='';if(f){if(window.__confirmReplaceDoc&&!(await window.__confirmReplaceDoc()))return;loadFile(f);}});
    var top=$('btnOpenTop');if(top)top.addEventListener('click',function(){if(window.__nativeOpen)window.__nativeOpen();else $('fileInput').click();});
    var open=$('btnOpen');if(open)open.addEventListener('click',function(){if(window.__nativeOpen)window.__nativeOpen();else $('fileInput').click();});
    var blank=$('btnBlank');if(blank)blank.addEventListener('click',startBlank);
    $('btnSave').addEventListener('click',saveDocx);
    var sel=$('tplSelect');if(sel){curDoc=sel.value;sel.addEventListener('change',function(){curDoc=sel.value;});}   /* 문서 골격 선택(출력 템플릿은 clean 고정) */
    /* 문서 설정 모달(앵커 팝오버): 템플릿·테두리·페이지번호. localStorage 영속. */
    (function(){var dbtn=$('btnDocSet'),dmodal=$('docSetModal'),dclose=$('dsClose'),f=$('optFrame');
      if(!dbtn||!dmodal)return;
      try{var sv=JSON.parse(localStorage.getItem('mdocify_doc_opts')||'null');if(sv){docOpts.frame=!!sv.frame;}}catch(e){}
      if(f)f.checked=docOpts.frame;
      document.body.classList.toggle('mdocify-frame',docOpts.frame);
      function persist(){try{localStorage.setItem('mdocify_doc_opts',JSON.stringify(docOpts));}catch(e){}}
      function dopen(){dmodal.hidden=false;var r=dbtn.getBoundingClientRect(),w=dmodal.offsetWidth||300,left=Math.max(8,Math.min(r.left,window.innerWidth-w-8));dmodal.style.top=(r.bottom+6)+'px';dmodal.style.left=left+'px';}
      function dclm(){dmodal.hidden=true;}
      dbtn.addEventListener('click',function(e){e.stopPropagation();dmodal.hidden?dopen():dclm();});
      if(dclose)dclose.addEventListener('click',dclm);
      document.addEventListener('click',function(e){if(!dmodal.hidden&&!dmodal.contains(e.target)&&!dbtn.contains(e.target))dclm();});
      document.addEventListener('keydown',function(e){if(e.key==='Escape')dclm();});
      if(f)f.addEventListener('change',function(){docOpts.frame=f.checked;document.body.classList.toggle('mdocify-frame',docOpts.frame);persist();renderPreview($('editor').value,true);});
    })();
    /* 라이트/다크 셸 테마: 선택 상태를 localStorage에 저장하고 시작 시 복원.
       다크는 '설정 기억' 체크와 무관하게 항상 독립 저장(MDeautify와 동일). 기본=라이트. */
    var dark=$('stDark');
    (function(){var KEY="mdocify_ui_mode";
      function apply(){var saved=null;try{saved=localStorage.getItem(KEY);}catch(e){}var isDark=saved==="dark";document.body.classList.toggle('dark',isDark);if(dark)dark.checked=isDark;}
      apply();
      /* EXE: settings-store 가 %APPDATA%\MDhwpxify\settings.json → localStorage 복원 후 재적용(비동기 하이드레이션) */
      document.addEventListener('mdocify:settings-hydrated',apply);
      if(dark)dark.addEventListener('change',function(){var mode=dark.checked?"dark":"light";document.body.classList.toggle('dark',dark.checked);try{localStorage.setItem(KEY,mode);}catch(e){}});
    })();
    /* 자동 저장 토글(MDeautify settings/autosave.js 이식): 켜면 편집을 멈춘 뒤 미리보기가 갱신되는 시점(EDIT_DELAY)에
       원본 .md 도 저장. 실제 저장은 window.__autoSaveMd()(EXE + 경로 있고 변경 있을 때만), 문서 전환 가드도 이 값을 본다. 기본=꺼짐. */
    (function(){var KEY="mdocify_autosave",cb=$('stAutoSave');
      function load(){var v=null;try{v=localStorage.getItem(KEY);}catch(e){}window.__autoSave=(v==="1");if(cb)cb.checked=window.__autoSave;}
      load();
      document.addEventListener('mdocify:settings-hydrated',load);
      if(cb)cb.addEventListener('change',function(){window.__autoSave=cb.checked;try{localStorage.setItem(KEY,cb.checked?"1":"0");}catch(e){}});
    })();
    /* 설정(⚙) 모달 열기/닫기 (버전·업데이트 UI 는 아래 자동 업데이트 IIFE 가 tmAbout 에 채움 — MDeautify 와 동일) */
    (function(){var btn=$('btnSettings'),modal=$('settingsModal'),close=$('stClose');
      if(!btn||!modal)return;
      function open(){modal.hidden=false;
        var r=btn.getBoundingClientRect(),w=modal.offsetWidth||340,left=Math.max(8,Math.min(r.right-w,window.innerWidth-w-8));modal.style.top=(r.bottom+6)+'px';modal.style.left=left+'px';
        /* 새 버전 대기(⚙ 점) 중일 때만 자동 확인 → 결과·릴리스노트·재시작 바로 표시. 최신이면 '업데이트 확인' 누르기 전엔 숨김(MDeautify와 동일) */
        if(btn.classList.contains('has-update')&&window.__updateCheck)window.__updateCheck();}
      function closeM(){modal.hidden=true;}
      btn.addEventListener('click',function(e){e.stopPropagation();modal.hidden?open():closeM();});
      if(close)close.addEventListener('click',closeM);
      document.addEventListener('click',function(e){if(!modal.hidden&&!modal.contains(e.target)&&e.target!==btn&&!btn.contains(e.target))closeM();});
      document.addEventListener('keydown',function(e){if(e.key==='Escape'&&!modal.hidden)closeM();});
    })();
    /* 드롭 처리(.md + 이미지 + 커서 삽입)는 아래 이식된 IIFE가 담당. 여기서는 문서 단독 드롭 핸들러를 두지 않음(중복 방지). */
    initSplitter();
    syncMirror();  /* 초기 내용(있으면)에 미러 맞춤 */
  }

  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init);
  else init();
})();

/* ===== 이하 MDeautify에서 이식: 이미지 붙여넣기/드롭 임베드 + 로컬 이미지 해석기 + ZIP + 파일 뱃지 ===== */

/* 이미지 붙여넣기 → data URI 로 임베드. 큰 이미지는 긴 변 기준 자동 다운스케일(WebP).
   100% 오프라인·경로 불필요·편집기 커서 위치에 ![alt](data:...) 삽입. */
(function(){
  var ta=document.getElementById("editor");if(!ta)return;
  var MAXDIM=1280,QUAL=0.85;  /* 긴 변 최대 px(초과 시 축소) + WebP 품질 */
  function altOf(f){var n=(f.name||"image").replace(/\.[a-z0-9]+$/i,"");return n||"image";}
  function insertText(txt){ta.focus();var ok=false;try{ok=document.execCommand("insertText",false,txt);}catch(e){}
    if(!ok){var s=ta.selectionStart,e=ta.selectionEnd,v=ta.value;ta.value=v.slice(0,s)+txt+v.slice(e);ta.selectionStart=ta.selectionEnd=s+txt.length;ta.dispatchEvent(new Event("input",{bubbles:true}));}}
  /* dataUrl → 다운스케일+WebP 재인코딩(투명도 지원). SVG는 벡터 유지. Promise<dataUrl>. */
  function encode(dataUrl,mime){return new Promise(function(res){
    if(/^image\/svg/i.test(mime||"")){res(dataUrl);return;}
    var img=new Image();
    img.onload=function(){
      var w=img.naturalWidth||img.width,h=img.naturalHeight||img.height,scale=Math.min(1,MAXDIM/w,MAXDIM/h);
      var cw=Math.max(1,Math.round(w*scale)),ch=Math.max(1,Math.round(h*scale));
      var c=document.createElement("canvas");c.width=cw;c.height=ch;c.getContext("2d").drawImage(img,0,0,cw,ch);
      var out;try{out=c.toDataURL("image/webp",QUAL);if(out.indexOf("data:image/webp")!==0)out=null;}catch(e){out=null;}
      if(!out)out=c.toDataURL("image/jpeg",QUAL);  /* WebP 미지원 폴백 */
      if(scale===1&&out.length>=dataUrl.length)out=dataUrl;  /* 축소 안 했고 재인코딩이 더 크면 원본 유지 */
      res(out);};
    img.onerror=function(){res(dataUrl);};  /* 디코드 실패 시 원본 유지 */
    img.src=dataUrl;});}
  function embed(file){var reader=new FileReader();reader.onload=function(){encode(reader.result,file.type).then(function(out){insertText("!["+altOf(file)+"]("+out+")");});};reader.readAsDataURL(file);}
  window.__img={encode:encode,insert:insertText};  /* 드롭/뱃지 경로에서 재사용 */
  ta.addEventListener("paste",function(e){var items=(e.clipboardData&&e.clipboardData.items)||[];
    for(var i=0;i<items.length;i++){if(items[i].type&&items[i].type.indexOf("image/")===0){var f=items[i].getAsFile();if(f){e.preventDefault();embed(f);return;}}}});
})();

/* ===== 통합 로컬 이미지 해석기 (드롭 풀 window.__drop 기준) =====
   각 <img> 로컬 경로를 드롭된 파일 맵(window.__drop)에서 찾아 data URI 로 치환. */
window.__resolveLocalImages=async function(src){
  var imgs=src.querySelectorAll("img"),list=[],seen={},ref={};
  for(var i=0;i<imgs.length;i++){var el=imgs[i],raw0=el.getAttribute("src")||"";
    if(/^(https?:|data:|blob:)/i.test(raw0))continue;
    var s=raw0;try{s=decodeURIComponent(raw0);}catch(e){}   /* marked가 공백·한글을 %인코딩하므로 복원해 파일명과 매칭 */
    var base=s.split(/[\\/]/).pop(),norm=s.replace(/^\.\//,"").replace(/\\/g,"/"),d=null;
    if(window.__drop)d=window.__drop[norm]||window.__drop[base]||null;
    if(!d&&typeof window.__nativeResolve==="function"){try{d=await window.__nativeResolve(s);}catch(e){}}
    if(d){window.__drop=window.__drop||{};if(!window.__drop[base])window.__drop[base]=d;}   /* 해석된 이미지를 풀에 보관 → 목록에 삭제 버튼 표시 + 문서 전환에도 유지 */
    if(d)el.setAttribute("src",d);
    ref[base]=1;ref[norm]=1;
    if(!seen[base]){seen[base]=1;list.push({name:base,status:d?"ok":"missing"});}
  }
  /* 드롭했지만 문서에서 참조하지 않은 이미지 표시 */
  if(window.__drop){for(var k in window.__drop){if(window.__drop.hasOwnProperty(k)&&!ref[k]&&!seen[k]){seen[k]=1;list.push({name:k,status:"unused"});}}}
  window.__imgFiles=list;
  if(typeof window.__renderFileBadge==="function")window.__renderFileBadge();
};

/* ===== 드롭: .md(+이미지들) 또는 폴더째 =====
   드롭 payload의 이미지 바이트로 ![](name.png) 해석(경로 불필요).
   .md만 드롭 → 문서만 로드. 이미지만 드롭(문서 열린 상태) → 커서에 임베드. */
(function(){
  function readText(f){return new Promise(function(r){var fr=new FileReader();fr.onload=function(){r(fr.result);};fr.readAsText(f,"utf-8");});}
  function readDataUrl(f){return new Promise(function(r){var fr=new FileReader();fr.onload=function(){r(fr.result);};fr.readAsDataURL(f);});}
  function mimeByName(n){var e=(n.split(".").pop()||"").toLowerCase();return ({png:"image/png",jpg:"image/jpeg",jpeg:"image/jpeg",gif:"image/gif",webp:"image/webp",bmp:"image/bmp",svg:"image/svg+xml"})[e]||"";}
  function isImgName(n){return /\.(png|jpe?g|gif|webp|bmp|svg)$/i.test(n);}
  function isMdName(n){return /\.(md|markdown|txt)$/i.test(n);}
  function walk(entry,out){return new Promise(function(res){
    if(entry.isFile){entry.file(function(f){out.push(f);res();},function(){res();});}
    else if(entry.isDirectory){var rd=entry.createReader(),acc=[];(function rd2(){rd.readEntries(function(es){if(!es.length){(async function(){for(var c=0;c<acc.length;c++)await walk(acc[c],out);res();})();}else{acc=acc.concat(es);rd2();}},function(){res();});})();}
    else res();
  });}
  async function handle(entries,flat,insAt){
    var files=[];
    if(entries&&entries.length){for(var i=0;i<entries.length;i++)await walk(entries[i],files);}
    else files=flat||[];
    var md=null,imgs=[];
    for(var j=0;j<files.length;j++){var f=files[j];if(!md&&isMdName(f.name))md=f;else if(isImgName(f.name))imgs.push(f);}
    if(md){
      if(window.__confirmReplaceDoc&&!(await window.__confirmReplaceDoc()))return;   /* 다른 MD 교체 전 확인 */
      var newDrop={};   /* 함께 온 이미지 = 이 문서의 이미지 풀 */
      for(var k=0;k<imgs.length;k++){var im=imgs[k];try{var du=await readDataUrl(im);newDrop[im.name]=await window.__img.encode(du,im.type||mimeByName(im.name));}catch(e){}}
      var text=await readText(md);
      var nm=md.name,fn=md.name.replace(/\.(md|markdown|txt)$/i,"");
      if(window.__openDoc){window.__openDoc({path:null,dir:null,name:nm,fname:fn,text:text,drop:newDrop});}   /* 새 탭 */
      else{window.__drop=Object.assign(window.__drop||{},newDrop);window.__mdDir=null;window.__mdName=nm;window.__fname=fn;window.__setEditorText(text);}
    }else if(imgs.length&&document.body.classList.contains("loaded")){
      /* 이미지만 드롭 → 파일 풀(window.__drop)에 추가.
         에디터(textarea) 위에 드롭했으면(insAt!=null) 그 위치에 ![](이름) 참조까지 삽입,
         그 밖의 위치면 풀에만 추가(팝오버에서 삽입 가능). */
      window.__drop=window.__drop||{};
      var added=[];
      for(var m=0;m<imgs.length;m++){var ig=imgs[m];try{var du2=await readDataUrl(ig);window.__drop[ig.name]=await window.__img.encode(du2,ig.type||mimeByName(ig.name));added.push(ig.name);}catch(e){}}
      var ta=document.getElementById("editor");
      if(insAt!=null&&ta&&added.length){
        var refs=added.map(function(n){var alt=n.replace(/\.[a-z0-9]+$/i,"");var dest=/\s/.test(n)?"<"+n+">":n;return "!["+alt+"]("+dest+")";}).join("\n");
        var pos=Math.min(Math.max(0,insAt|0),ta.value.length),before=ta.value.slice(0,pos),after=ta.value.slice(pos);
        var block=(before&&!/\n$/.test(before)?"\n":"")+refs+(after&&!/^\n/.test(after)?"\n":"");
        var nt=before+block+after;ta.value=nt;
        try{ta.selectionStart=ta.selectionEnd=(before+block).length;}catch(e){}
        if(window.__syncMirror)window.__syncMirror();
        window.__render(nt,true);
      }else{
        window.__render(ta?ta.value:(window.__lastText||""),true);
      }
      if(added.length&&window.__flashBadge)window.__flashBadge(added.length);
    }
  }
  /* 파일 선택창에서 고른 File 목록도 드롭과 동일 처리(.md=문서 열기 / 이미지=풀에 추가) */
  window.__ingestFiles=function(fileList){handle(null,Array.prototype.slice.call(fileList||[]));};
  function hasFiles(dt){return dt&&dt.types&&Array.prototype.indexOf.call(dt.types,"Files")>=0;}
  document.addEventListener("dragover",function(e){e.preventDefault();if(hasFiles(e.dataTransfer))document.body.classList.add("drag");});
  document.addEventListener("dragleave",function(e){if(e.relatedTarget===null||(e.clientX<=0&&e.clientY<=0))document.body.classList.remove("drag");});
  /* 에디터(textarea) 위에 드롭했으면 그 지점의 글자 위치(offset)를 구함 → 이미지 참조를 그 자리에 삽입 */
  function dropCaret(x,y){var ta=document.getElementById("editor");if(!ta||!document.body.classList.contains("loaded"))return null;
    try{var cp=document.caretPositionFromPoint&&document.caretPositionFromPoint(x,y);if(cp&&cp.offsetNode===ta)return cp.offset;}catch(e){}
    try{var r=ta.getBoundingClientRect();if(x>=r.left&&x<=r.right&&y>=r.top&&y<=r.bottom)return ta.value.length;}catch(e){}  /* 정확한 위치 못 구하면 에디터 영역 안일 때 끝에 삽입 */
    return null;}
  document.addEventListener("drop",function(e){e.preventDefault();document.body.classList.remove("drag");var dt=e.dataTransfer;if(!dt)return;
    var insAt=dropCaret(e.clientX,e.clientY);
    var entries=[],items=dt.items;
    if(items&&items.length&&items[0].webkitGetAsEntry){for(var i=0;i<items.length;i++){var en=items[i].webkitGetAsEntry&&items[i].webkitGetAsEntry();if(en)entries.push(en);}}
    var flat=[];if(dt.files){for(var k=0;k<dt.files.length;k++)flat.push(dt.files[k]);}
    handle(entries,flat,insAt);
  });
})();

/* ===== 변경감지(dirty) + md 원본 저장(Ctrl+S)/자동저장 + 문서 교체 가드 (MDeautify 편집경험 이식) ===== */
(function(){
  var ta=document.getElementById("editor");if(!ta)return;
  /* 공용 토스트(MDeautify v1.6.0 이식): 저장·자동저장·이미지·탐색기·AI 안내가 같은 #fbToast 하나를 공유.
     position:fixed(body) 라 부모 무관 → 에디터 우상단 📎 배지 자리를 기준으로 앵커(배지 보이면 그 왼쪽 8px, 숨으면 배지 자리=코너).
     편집기가 안 보이면(접힘) 미리보기 우상단으로 폴백. (이전엔 창 맨 아래 가운데 #appToast 라 시선에서 멀어 안 보였음) */
  window.__toast=function(msg,dur){
    var t=document.getElementById("fbToast");
    if(!t){t=document.createElement("div");t.id="fbToast";document.body.appendChild(t);}
    else if(t.parentNode!==document.body){document.body.appendChild(t);}
    t.textContent=msg;
    var eb=document.getElementById("editorBody"),badge=document.getElementById("fileBadge");
    var th=t.offsetHeight||26,anchored=false;
    if(eb&&eb.getClientRects().length){
      var er=eb.getBoundingClientRect();
      t.style.left="auto";
      t.style.top=Math.round(er.top+8+11-th/2)+"px";   /* 배지 세로 중앙(top:8 + 높이≈22의 절반)에 맞춤 */
      if(badge&&badge.getClientRects().length){var br=badge.getBoundingClientRect();t.style.right=Math.round(window.innerWidth-br.left+8)+"px";}
      else{t.style.right=Math.round(window.innerWidth-er.right+14)+"px";}
      anchored=true;
    }
    if(!anchored){
      var v=document.getElementById("previewWrap");
      if(v){var r=v.getBoundingClientRect(),head=v.querySelector(".pv-head"),hh=head?head.offsetHeight:0;
        t.style.top=Math.round(r.top+hh+12)+"px";t.style.right=Math.round(window.innerWidth-r.right+14)+"px";t.style.left="auto";}
    }
    t.classList.remove("show");void t.offsetWidth;t.classList.add("show");
    clearTimeout(t.__tmr);t.__tmr=setTimeout(function(){t.classList.remove("show");},dur||1600);
  };
  function toast(msg){if(window.__toast)window.__toast(msg);}
  var savedText=null;   /* 마지막 저장/로드 내용 = 변경감지 기준선 */
  window.__markClean=function(){savedText=ta.value;};
  window.__isDirty=function(){return document.body.classList.contains("loaded")&&ta.value!==savedText;};
  window.__getSaved=function(){return savedText;};                 /* 탭 스냅샷용 */
  window.__setSaved=function(t){savedText=(t==null?null:t);};      /* 탭 복원용(dirty 보존) */
  window.__saveMd=async function(){
    if(!document.body.classList.contains("loaded"))return;
    var text=ta.value;
    var isExe=(typeof window.NL_PORT!=="undefined"&&typeof window.Neutralino!=="undefined");
    var defName=window.__mdName||((window.__fname||"document")+".md");
    if(isExe){
      try{
        var path=window.__mdPath;
        if(!path){   /* 드롭 등 경로 미확보 → 저장 위치 1회 지정 */
          path=await Neutralino.os.showSaveDialog("Markdown 저장",{defaultPath:defName,filters:[{name:"Markdown",extensions:["md","markdown","txt"]},{name:"모든 파일",extensions:["*"]}]});
          if(!path)return;
          if(!/\.(md|markdown|txt)$/i.test(path))path+=".md";
          window.__mdPath=path;window.__mdDir=path.replace(/[\\\/][^\\\/]*$/,"");window.__mdName=path.replace(/^.*[\\\/]/,"");window.__fname=window.__mdName.replace(/\.(md|markdown|txt)$/i,"");
          if(window.__renderFileBadge)window.__renderFileBadge();
        }
        await Neutralino.filesystem.writeFile(path,text);savedText=text;toast("저장됨");
        if(window.__tabsOnEdit)window.__tabsOnEdit();   /* 기준선이 바뀌었으니 탭의 미저장 점 재계산(안 하면 다음 입력·탭 전환 때까지 점이 남음) */
      }catch(e){try{Neutralino.debug.log("[save] "+e);}catch(_){}if(window.__appAlert)window.__appAlert("저장 중 문제가 발생했습니다.","오류");else alert("저장 중 문제가 발생했습니다.");}
    }else{
      try{var blob=new Blob([text],{type:"text/markdown;charset=utf-8"});var url=URL.createObjectURL(blob);var a=document.createElement("a");a.href=url;a.download=defName;document.body.appendChild(a);a.click();document.body.removeChild(a);setTimeout(function(){URL.revokeObjectURL(url);},1000);toast("다운로드됨");}catch(e){}
    }
  };
  window.__autoSaveMd=async function(){   /* 편집 멈춘 뒤 호출. EXE + 경로 있을 때만, 변경 있을 때만 조용히 저장(호출부에서 __autoSave 게이트) */
    if(!document.body.classList.contains("loaded"))return;
    var isExe=(typeof window.NL_PORT!=="undefined"&&typeof window.Neutralino!=="undefined");
    if(!isExe||!window.__mdPath)return;
    var text=ta.value; if(text===savedText)return;
    try{await Neutralino.filesystem.writeFile(window.__mdPath,text);savedText=text;toast("자동 저장됨");if(window.__tabsOnEdit)window.__tabsOnEdit();}catch(e){try{Neutralino.debug.log("[autosave] "+e);}catch(_){}}   /* 저장 후 탭 점 재계산 — 자동 저장은 입력 후에 일어나 이게 없으면 점이 항상 떠 있음 */
  };
  /* 다른 md로 교체 전 가드. true=진행 / false=취소. 저장 안 된 변경 있을 때만 개입 */
  window.__confirmReplaceDoc=async function(){
    if(!document.body.classList.contains("loaded"))return true;
    if(!(window.__isDirty&&window.__isDirty()))return true;
    if(window.__autoSave&&window.__mdPath){if(window.__saveMd)await window.__saveMd();return true;}
    if(window.__openDoc)return true;   /* 탭: 새 문서는 새 탭으로 열리고 지금 문서는 ● 그대로 남음 → 교체가 아니니 묻지 않음(탭 이전 코드의 잔재였음) */
    if(window.__confirmSave3){
      var choice=await window.__confirmSave3({title:"저장하고 열기",message:"편집 중인 문서에 저장하지 않은 변경사항이 있어요.\n저장한 뒤 새 문서를 열까요?",saveText:"저장하고 열기",discardText:"저장 안 함",cancelText:"취소"});
      if(choice==="cancel")return false;
      if(choice==="save"){var hadPath=!!window.__mdPath;if(window.__saveMd)await window.__saveMd();if(!hadPath&&!window.__mdPath)return false;return true;}
      return true;   /* discard */
    }
    return true;
  };
  document.addEventListener("keydown",function(e){
    if((e.ctrlKey||e.metaKey)&&!e.shiftKey&&!e.altKey&&(e.key==="s"||e.key==="S")){e.preventDefault();window.__saveMd();}
  },true);
})();

/* ===== md 편집기: Tab / Shift+Tab 들여쓰기 (VSCode 유사, MDeautify 이식) =====
   - Tab: 커서 위치에 공백 2칸 삽입 / 선택 있으면 대상 줄들 들여쓰기
   - Shift+Tab: 현재 줄(또는 선택 줄들) 내어쓰기(앞 공백 최대 2칸 또는 탭 1개 제거)
   - Alt/Ctrl/Meta+Tab 은 가로채지 않음(OS 창 전환 등 유지)
   - execCommand 로 편집해 네이티브 실행취소(Ctrl+Z) 스택을 보존(input 이벤트 → 미러·탭 ●·미리보기도 그대로 따라옴)
   목록 들여쓰기 깊이가 □ ○ ▪ - 단계를 정하는 앱이라 Tab 으로 바로 단계를 바꿀 수 있어야 한다(예전엔 Tab 이 편집기 밖으로 초점을 옮겼다). */
(function(){
  var ta=document.getElementById("editor"),mirror=document.getElementById("raw");if(!ta)return;
  var UNIT="  ";
  function countNL(s){var n=0,i=0;for(;i<s.length;i++)if(s.charCodeAt(i)===10)n++;return n;}
  function synced(){if(mirror){mirror.scrollTop=ta.scrollTop;mirror.scrollLeft=ta.scrollLeft;}}
  ta.addEventListener("keydown",function(e){
    if(e.key!=="Tab"||e.altKey||e.ctrlKey||e.metaKey)return;   /* Alt/Ctrl/Meta+Tab 은 OS/브라우저에 양보 */
    e.preventDefault();
    var val=ta.value,start=ta.selectionStart,end=ta.selectionEnd;
    if(start===end&&!e.shiftKey){document.execCommand("insertText",false,UNIT);synced();return;}   /* 단순 삽입 */
    var ls=val.lastIndexOf("\n",start-1)+1;                    /* 첫 줄 시작 오프셋 */
    var le=val.indexOf("\n",end);if(le<0)le=val.length;        /* 마지막 줄 끝 오프셋 */
    var lines=val.slice(ls,le).split("\n");
    if(e.shiftKey){                                            /* 내어쓰기 */
      var rm0=((lines[0]||"").match(/^( {1,2}|\t)/)||[""])[0].length;
      lines=lines.map(function(ln){var m=ln.match(/^( {1,2}|\t)/);return m?ln.slice(m[0].length):ln;});
      var nb=lines.join("\n");
      ta.setSelectionRange(ls,le);document.execCommand("insertText",false,nb);
      if(start===end){var np=Math.max(ls,start-rm0);ta.setSelectionRange(np,np);}
      else ta.setSelectionRange(ls,ls+nb.length);
    }else{                                                     /* 들여쓰기(선택 줄들) */
      var uS=1+countNL(val.slice(ls,start)),uE=1+countNL(val.slice(ls,end));
      lines=lines.map(function(ln){return UNIT+ln;});
      var nb2=lines.join("\n");
      ta.setSelectionRange(ls,le);document.execCommand("insertText",false,nb2);
      ta.setSelectionRange(start+UNIT.length*uS,end+UNIT.length*uE);
    }
    synced();
  });
})();

/* ===== ZIP 저장: 현재 MD + 풀(window.__drop)의 이미지들을 무압축(store) zip으로 묶어 저장 ===== */
(function(){
  var crcTable=null;
  function crc32(buf){if(!crcTable){crcTable=[];for(var n=0;n<256;n++){var c=n;for(var k=0;k<8;k++)c=(c&1)?(0xEDB88320^(c>>>1)):(c>>>1);crcTable[n]=c>>>0;}}var crc=0xFFFFFFFF;for(var i=0;i<buf.length;i++)crc=(crcTable[(crc^buf[i])&0xFF]^(crc>>>8))>>>0;return (crc^0xFFFFFFFF)>>>0;}
  function u16(v){return [v&0xFF,(v>>>8)&0xFF];}
  function u32(v){return [v&0xFF,(v>>>8)&0xFF,(v>>>16)&0xFF,(v>>>24)&0xFF];}
  function zipStore(files){
    var enc=new TextEncoder(),local=[],central=[],offset=0;
    for(var i=0;i<files.length;i++){
      var nameB=enc.encode(files[i].name),data=files[i].data,crc=crc32(data),sz=data.length;
      var lh=[].concat(u32(0x04034b50),u16(20),u16(0x0800),u16(0),u16(0),u16(0),u32(crc),u32(sz),u32(sz),u16(nameB.length),u16(0));
      local.push(new Uint8Array(lh),nameB,data);
      var ch=[].concat(u32(0x02014b50),u16(20),u16(20),u16(0x0800),u16(0),u16(0),u16(0),u32(crc),u32(sz),u32(sz),u16(nameB.length),u16(0),u16(0),u16(0),u16(0),u32(0),u32(offset));
      central.push(new Uint8Array(ch),nameB);
      offset+=lh.length+nameB.length+data.length;
    }
    var cSize=0;for(var c1=0;c1<central.length;c1++)cSize+=central[c1].length;
    var eocd=new Uint8Array([].concat(u32(0x06054b50),u16(0),u16(0),u16(files.length),u16(files.length),u32(cSize),u32(offset),u16(0)));
    var parts=local.concat(central).concat([eocd]),total=0,p;
    for(p=0;p<parts.length;p++)total+=parts[p].length;
    var out=new Uint8Array(total),pos=0;for(p=0;p<parts.length;p++){out.set(parts[p],pos);pos+=parts[p].length;}
    return out;
  }
  function dataUriToBytes(du){var i=String(du).indexOf(",");if(i<0)return null;try{var bin=atob(du.slice(i+1)),u=new Uint8Array(bin.length),k;for(k=0;k<bin.length;k++)u[k]=bin.charCodeAt(k);return u;}catch(e){return null;}}
  window.__exportZip=async function(){
    try{
      var ta=document.getElementById("editor");
      var mdText=(ta?ta.value:window.__lastText)||"";
      var mdName=window.__mdName||((window.__fname||"document")+".md");
      var baseName=(window.__fname||mdName.replace(/\.(md|markdown|txt)$/i,"")||"document");
      var files=[{name:mdName,data:new TextEncoder().encode(mdText)}];
      if(window.__drop){for(var k in window.__drop){if(Object.prototype.hasOwnProperty.call(window.__drop,k)){var b=dataUriToBytes(window.__drop[k]);if(b)files.push({name:k,data:b});}}}
      var zip=zipStore(files),zipName=baseName+".zip";
      if(typeof window.NL_PORT!=="undefined"&&window.Neutralino){   /* EXE: 네이티브 저장 다이얼로그 */
        var path=await Neutralino.os.showSaveDialog("ZIP 저장",{defaultPath:zipName,filters:[{name:"ZIP",extensions:["zip"]}]});
        if(!path)return;if(!/\.zip$/i.test(path))path+=".zip";
        await Neutralino.filesystem.writeBinaryFile(path,zip.buffer.slice(zip.byteOffset,zip.byteOffset+zip.byteLength));
      }else{                                                        /* 브라우저/웹뷰: 앵커 다운로드 */
        var blob=new Blob([zip],{type:"application/zip"}),a=document.createElement("a");
        a.href=URL.createObjectURL(blob);a.download=zipName;document.body.appendChild(a);a.click();
        setTimeout(function(){URL.revokeObjectURL(a.href);a.remove();},1500);
      }
    }catch(e){try{Neutralino.debug.log("[zip] "+e);}catch(_){}alert("ZIP 저장 중 문제가 발생했습니다.");}
  };
})();

/* ===== 불러온 파일 뱃지 + 팝오버 (문서 + 참조 이미지 상태 + 미참조 드롭 이미지) ===== */
(function(){
  function esc(s){return String(s).replace(/[&<>"']/g,function(c){return {"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c];});}   /* 홑따옴표까지 — 이미지 이름은 문서 글에서 오고 속성은 홑따옴표로 감싼다(예전엔 x' onmouseover='… 로 코드가 끼어들 수 있었다) */
  /* '식별안됨' 이미지 = MD에 ![](이름) 참조가 있으나 못 찾음 → 그 참조를 본문에서 삭제(파일명/경로 basename 일치). */
  function removeRefFromMd(name){
    var ta=document.getElementById("editor");if(!ta)return;
    var re=/!\[[^\]]*\]\(\s*(<[^>]*>|[^()]*(?:\([^)]*\)[^()]*)*)\s*\)/g,changed=false;
    var out=ta.value.replace(re,function(m,dest){
      var d=dest.replace(/^<|>$/g,"").replace(/\s+["'][^"']*["']\s*$/,"").trim();  /* <> 벗기고 제목 제거 */
      try{d=decodeURIComponent(d);}catch(e){}
      var base=d.split(/[\\/]/).pop();
      if(d===name||base===name){changed=true;return "";}
      return m;
    });
    if(!changed)return;
    out=out.replace(/\n{3,}/g,"\n\n");  /* 참조만 있던 줄이 비면서 생긴 과한 빈 줄 정리 */
    ta.value=out;
    if(window.__syncMirror)window.__syncMirror();
    if(typeof window.__render==="function")window.__render(out,true);
  }
  var badge=document.getElementById("fileBadge"),num=document.getElementById("fileBadgeN"),pop=document.getElementById("filePop");
  function build(){
    var md=window.__mdName||(window.__fname?window.__fname+".md":null),imgs=window.__imgFiles||[];
    if(num)num.textContent=String((md?1:0)+imgs.length);
    var anyMissing=false;for(var mi=0;mi<imgs.length;mi++){if(imgs[mi].status==="missing"){anyMissing=true;break;}}
    if(badge)badge.classList.toggle("has-missing",anyMissing);
    if(!pop)return;
    var h="<button type='button' class='fp-close' title='닫기' aria-label='닫기'>✕</button><div class='fp-h fp-h-top'><span>불러온 파일</span><button type='button' class='fp-zip-btn' title='MD와 이미지를 ZIP으로 묶어 저장'>ZIP 저장</button></div>";
    if(md)h+="<div class='fp-row'><span class='fp-ico'>📄</span><span class='fp-name' title='"+esc(md)+"'>"+esc(md)+"</span></div>";
    if(imgs.length){
      h+="<div class='fp-sec'><div class='fp-h'>이미지 ("+imgs.length+")</div>";
      for(var i=0;i<imgs.length;i++){var f=imgs[i],
        st=f.status==="ok"?["st-ok","✓ 사용중"]:f.status==="missing"?["st-bad","✗ 식별안됨"]:["st-ok","● 사용가능"],
        inPool=window.__drop&&Object.prototype.hasOwnProperty.call(window.__drop,f.name),
        act=f.status==="missing"?"<button class='fp-rm-btn' type='button' data-rm='"+esc(f.name)+"' title='MD에서 이 이미지 참조를 삭제: "+esc(f.name)+"'>참조 삭제</button>":"<button class='fp-ins-btn' type='button' data-ins='"+esc(f.name)+"' title='커서 위치에 삽입: "+esc(f.name)+"'>삽입</button>";
        h+="<div class='fp-row' title='"+esc(f.name)+"'><span class='fp-ico'>🖼️</span><span class='fp-name'>"+esc(f.name)+"</span><span class='fp-st "+st[0]+"'>"+st[1]+"</span>"+act+(inPool?"<button class='fp-del-btn' type='button' data-del='"+esc(f.name)+"' title='목록에서 제거: "+esc(f.name)+"' aria-label='삭제'>✕</button>":"<span class='fp-del-ph'></span>")+"</div>";}
      h+="</div>";
    }else h+="<div class='fp-sec'><div class='fp-empty'>참조된 이미지 없음</div></div>";
    if(anyMissing)h+="<div class='fp-hint'>식별 안 된 이미지가 있어요. <b>‘MD 파일 열기’</b>로 이미지를 넣거나, <b>이미지</b>(또는 폴더째) 끌어다 놓으면 표시됩니다.</div>";
    pop.innerHTML=h;
  }
  window.__renderFileBadge=build;
  function close(){if(pop)pop.hidden=true;if(badge)badge.classList.remove("on");}
  /* 배지 클릭 = 토글(열려 있으면 닫기, 닫혀 있으면 내용 갱신 후 열기). */
  if(badge)badge.addEventListener("click",function(e){e.stopPropagation();if(pop.hidden){build();pop.hidden=false;badge.classList.add("on");}else{close();}});
  /* 이미지 추가 알림: 배지 초록 깜빡 + 옆에 잠깐 뜨는 툴팁 */
  window.__flashBadge=function(n){
    if(!badge)return;
    badge.classList.remove("flash-added");void badge.offsetWidth;badge.classList.add("flash-added");
    setTimeout(function(){badge.classList.remove("flash-added");},3600);
    if(window.__toast)window.__toast(n>1?("이미지 "+n+"개가 추가되었습니다"):"이미지가 추가되었습니다",1900);   /* 공용 토스트(배지 옆)로 통일 */
  };
  /* 팝오버 클릭: X = 닫기 / '삽입' = 참조 삽입(닫지 않음 → 여러 번 연속 삽입 가능) */
  if(pop)pop.addEventListener("click",function(e){
    if(e.target.closest&&e.target.closest(".fp-close")){close();return;}
    if(e.target.closest&&e.target.closest(".fp-zip-btn")){if(window.__exportZip)window.__exportZip();return;}
    var del=e.target.closest&&e.target.closest(".fp-del-btn");
    if(del){var dn=del.getAttribute("data-del");if(dn&&window.__drop)delete window.__drop[dn];  /* 풀에서 제거 → 재렌더로 목록/상태 갱신(팝오버는 열린 채) */
      var cur=document.getElementById("editor");if(typeof window.__render==="function")window.__render(cur?cur.value:(window.__lastText||""),true);else if(window.__renderFileBadge)window.__renderFileBadge();return;}
    var rm=e.target.closest&&e.target.closest(".fp-rm-btn");
    if(rm){var rn=rm.getAttribute("data-rm");if(rn)removeRefFromMd(rn);return;}
    var btn=e.target.closest&&e.target.closest(".fp-ins-btn");if(!btn)return;var name=btn.getAttribute("data-ins");if(!name)return;
    var alt=name.replace(/\.[a-z0-9]+$/i,"");var dest=/\s/.test(name)?"<"+name+">":name;  /* 공백 포함 파일명은 <>로 감싸야 마크다운이 인식 */
    if(window.__img&&window.__img.insert)window.__img.insert("!["+alt+"]("+dest+")");});
})();
/* ===== 문서 설정: 테마 색(프리셋/커스텀)·본문 폰트·기준 크기·기억 (미리보기 + .docx 공통) ===== */
(function(){
  var THEMES=[
    {n:"로열 퍼플",b:"#4c1d95",a:"#7c3aed"},{n:"오션 틸",b:"#0f4c5c",a:"#0891b2"},
    {n:"포레스트",b:"#14532d",a:"#16a34a"},{n:"버건디",b:"#7f1d1d",a:"#dc2626"},
    {n:"네이비",b:"#1e3a5f",a:"#2563eb"},{n:"차콜 오렌지",b:"#1f2937",a:"#ea580c"},
    {n:"인디고 로즈",b:"#312e81",a:"#e11d48"},{n:"브론즈 골드",b:"#713f12",a:"#d97706"}
  ];
  var FONTS={
    malgun:{css:'"Malgun Gothic","맑은 고딕","Segoe UI",sans-serif',docx:"맑은 고딕"},
    noto:{css:'"Noto Sans KR","Malgun Gothic",sans-serif',docx:"Noto Sans KR"},
    nanum:{css:'"NanumGothic","나눔고딕","Malgun Gothic",sans-serif',docx:"나눔고딕"},
    batang:{css:'"Batang","바탕",serif',docx:"바탕"}
  };
  var DEF={brand:"#1d4ed8",accent:"#2563eb"};   /* 저장값 없을 때 = 현재 기본 파랑 */
  var $=function(id){return document.getElementById(id);};
  var trigger=$("btnDocSettings"),modal=$("themeModal"),grid=$("tm-grid");
  if(!trigger||!modal||!grid)return;
  var colorInput=$("tmColor"),hexOut=$("tmHex"),applyBtn=$("tmApply"),swEl=$("tmSw"),customRow=$("tmCustom"),
      fontSel=$("tmFont"),sizeInp=$("tmSize"),sizeVal=$("tmSizeVal"),rememberInp=$("tmRemember"),closeBtn=$("tmClose");
  var R=document.documentElement.style;
  var state={mode:"default",i:4,hex:null,sizePx:14,font:"noto"},remember=true,pendingHex=null;
  function hexToRgb(h){h=(h||"").replace("#","");if(h.length===3)h=h.split("").map(function(c){return c+c;}).join("");return[parseInt(h.slice(0,2),16),parseInt(h.slice(2,4),16),parseInt(h.slice(4,6),16)];}
  function toHex(r,g,b){return "#"+[r,g,b].map(function(x){return ("0"+Math.max(0,Math.min(255,Math.round(x))).toString(16)).slice(-2);}).join("");}
  function darkOf(hex){var c=hexToRgb(hex);return toHex(c[0]*0.55,c[1]*0.55,c[2]*0.55);}   /* 강조색 → 진한 브랜드색 파생 */
  function curColors(){
    if(state.mode==="custom"&&/^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(state.hex||""))return {brand:darkOf(state.hex),accent:state.hex};
    if(state.mode==="preset"){var t=THEMES[state.i]||THEMES[4];return {brand:t.b,accent:t.a};}
    return {brand:DEF.brand,accent:DEF.accent};
  }
  function apply(){   /* CSS 변수 반영 + __docSettings 갱신(.docx 브리지용) */
    var c=curColors();
    R.setProperty("--brand",c.brand);R.setProperty("--accent",c.accent);
    R.setProperty("--doc-size",state.sizePx+"px");R.setProperty("--doc-font",FONTS[state.font].css);
    window.__docSettings=Object.assign(window.__docSettings||{},{brand:c.brand,accent:c.accent,sizePx:state.sizePx,font:{css:FONTS[state.font].css,docx:FONTS[state.font].docx}});
  }
  function rerender(){if(typeof window.__render==="function"){var ta=$("editor");window.__render(ta?ta.value:"",true);}}
  function persist(){if(!remember)return;try{
    localStorage.setItem("mdocify_theme",state.mode);
    if(state.mode==="custom")localStorage.setItem("mdocify_custom",state.hex||"");else localStorage.removeItem("mdocify_custom");
    localStorage.setItem("mdocify_preset",String(state.i));
    localStorage.setItem("mdocify_size",String(state.sizePx));
    localStorage.setItem("mdocify_font",state.font);
  }catch(e){}}
  function mark(){
    Array.prototype.forEach.call(grid.children,function(c,j){c.classList.toggle("active",state.mode==="preset"&&j===state.i);});
    if(customRow)customRow.classList.toggle("active",state.mode==="custom");
  }
  function commit(){apply();mark();persist();rerender();}
  THEMES.forEach(function(t,i){var b=document.createElement("button");b.type="button";
    b.innerHTML="<span class='sw' style=\"background:linear-gradient(135deg,"+t.b+" 0 50%,"+t.a+" 50%)\"></span><span>"+t.n+"</span>";
    b.addEventListener("click",function(){state.mode="preset";state.i=i;state.hex=null;commit();});grid.appendChild(b);});
  function updateSw(){if(swEl&&colorInput){var a=colorInput.value;swEl.style.background="linear-gradient(135deg,"+darkOf(a)+" 0 50%,"+a+" 50%)";}}
  if(colorInput){var onPick=function(){pendingHex=colorInput.value;if(hexOut)hexOut.textContent=colorInput.value.toUpperCase();updateSw();};colorInput.addEventListener("input",onPick);colorInput.addEventListener("change",onPick);}
  if(applyBtn)applyBtn.addEventListener("click",function(){var hex=pendingHex||(colorInput?colorInput.value:null);if(!/^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(hex||""))return;state.mode="custom";state.hex=hex;commit();});
  if(fontSel)fontSel.addEventListener("change",function(){if(FONTS[fontSel.value]){state.font=fontSel.value;commit();}});
  if(sizeInp){sizeInp.addEventListener("input",function(){state.sizePx=+sizeInp.value;if(sizeVal)sizeVal.textContent=state.sizePx+"px";apply();});sizeInp.addEventListener("change",function(){persist();rerender();});}
  if(rememberInp)rememberInp.addEventListener("change",function(){remember=rememberInp.checked;try{localStorage.setItem("mdocify_remember",remember?"1":"0");}catch(e){}if(remember)persist();else try{["mdocify_theme","mdocify_custom","mdocify_preset","mdocify_size","mdocify_font"].forEach(function(k){localStorage.removeItem(k);});}catch(e){}});
  function syncControls(){var c=curColors();
    if(colorInput)colorInput.value=(state.mode==="custom"&&state.hex)?state.hex:c.accent;
    if(hexOut)hexOut.textContent=(colorInput?colorInput.value:c.accent).toUpperCase();
    pendingHex=state.mode==="custom"?state.hex:null;updateSw();
    if(fontSel)fontSel.value=state.font;
    if(sizeInp)sizeInp.value=state.sizePx;if(sizeVal)sizeVal.textContent=state.sizePx+"px";
    if(rememberInp)rememberInp.checked=remember;mark();}
  function openModal(){syncControls();modal.hidden=false;var r=trigger.getBoundingClientRect();var card=modal.firstElementChild,w=card?card.offsetWidth:320;var left=Math.max(8,Math.min(r.left,window.innerWidth-w-8));var top=r.bottom+6;modal.style.top=top+"px";modal.style.left=left+"px";if(card){card.style.maxHeight=(window.innerHeight-top-12)+"px";}}
  function closeModal(){modal.hidden=true;}
  trigger.addEventListener("click",function(e){e.stopPropagation();modal.hidden?openModal():closeModal();});
  document.addEventListener("click",function(e){if(!modal.hidden&&!modal.contains(e.target)&&e.target!==trigger&&!trigger.contains(e.target))closeModal();});
  if(closeBtn)closeBtn.addEventListener("click",closeModal);
  document.addEventListener("keydown",function(e){if(e.key==="Escape"&&!modal.hidden)closeModal();});
  (function load(){var rm=null;try{rm=localStorage.getItem("mdocify_remember");}catch(e){}remember=rm===null?true:rm==="1";
    if(remember)try{
      var th=localStorage.getItem("mdocify_theme"),cu=localStorage.getItem("mdocify_custom"),pi=localStorage.getItem("mdocify_preset"),sz=localStorage.getItem("mdocify_size"),ft=localStorage.getItem("mdocify_font");
      if(th==="custom"&&cu){state.mode="custom";state.hex=cu;}else if(th==="preset"&&pi!==null&&THEMES[+pi]){state.mode="preset";state.i=+pi;}
      if(sz&&+sz>=11&&+sz<=18)state.sizePx=+sz;if(ft&&FONTS[ft])state.font=ft;
    }catch(e){}
    apply();   /* 초기 반영(재렌더는 문서 로드 시 자연 발생) */
  })();
})();

/* ===== 쪽 바닥글(Footer): 미리보기(Paged.js @bottom-center) + .docx 공통 =====
   설정 기억('mdocify_remember')이 켜져 있을 때만 저장. 컨트롤 변경 시 상태갱신→저장(게이트)→재주입(applyFooter)→docx 설정 반영. */
(function(){
  function remember(){try{var r=localStorage.getItem("mdocify_remember");return r===null?true:r==="1";}catch(e){return true;}}
  function save(k,v){if(!remember())return;try{localStorage.setItem(k,v);}catch(e){}}
  var FOOT={on:true,text:"- {pageNumber} -",align:"center",border:false};   /* 정부양식 쪽번호 "- N -"(산출물 pageNum과 동일). 표지 포함 1부터 */
  function loadFooter(){try{var o=localStorage.getItem("mdocify_footer_on");if(o!==null)FOOT.on=(o==="1");var t=localStorage.getItem("mdocify_footer_text");if(t!==null)FOOT.text=t;var a=localStorage.getItem("mdocify_footer_align");if(a)FOOT.align=a;var b=localStorage.getItem("mdocify_footer_border");if(b!==null)FOOT.border=(b==="1");}catch(e){}}
  function saveFooter(){save("mdocify_footer_on",FOOT.on?"1":"0");save("mdocify_footer_text",FOOT.text);save("mdocify_footer_align",FOOT.align);save("mdocify_footer_border",FOOT.border?"1":"0");}
  function syncDocx(){window.__docSettings=window.__docSettings||{};window.__docSettings.footer={on:FOOT.on,text:FOOT.text,align:FOOT.align,border:FOOT.border};}
  window.applyFooter=function(){var pages=document.querySelectorAll("#pages .pagedjs_page");var content=[];pages.forEach(function(pg){var mc=pg.querySelector(".pagedjs_margin-bottom-center .pagedjs_margin-content");if(mc){mc.textContent="";mc.style.borderTop="";mc.style.paddingTop="";}if(!mc||pg.querySelector(".cover"))return;if(pg.querySelector(".mdocify-toc"))return;var body=pg.querySelector(".pagedjs_page_content");var has=body&&(body.textContent.trim().length>0||body.querySelector("img,svg,table,hr,figure"));if(!has)return;content.push(mc);});if(!FOOT.on)return;   /* 표지(.cover)·목차(.mdocify-toc) 페이지는 쪽번호 제외 → 본문부터 1 */var total=content.length;content.forEach(function(mc,i){mc.textContent=String(FOOT.text).replace(/\{pageNumber\}/g,i+1).replace(/\{totalPages\}/g,total);mc.style.justifyContent=(FOOT.align==="left"?"flex-start":(FOOT.align==="right"?"flex-end":"center"));if(FOOT.border){mc.style.borderTop="1px solid #cbd5e1";mc.style.paddingTop="5px";}});};
  loadFooter();
  /* 정부양식 쪽번호 마이그레이션(1회): 예전 기본값("Page …")·off 상태가 저장돼 있어도 gov "- N -"로 리셋 */
  try{if(localStorage.getItem("mdocify_footer_ver")!=="gov1"){FOOT.on=true;FOOT.text="- {pageNumber} -";FOOT.align="center";FOOT.border=false;localStorage.setItem("mdocify_footer_ver","gov1");saveFooter();}}catch(e){}
  syncDocx();
  var on=document.getElementById("tmFooter"),txt=document.getElementById("tmFooterText"),al=document.getElementById("tmFooterAlign"),bd=document.getElementById("tmFooterBorder"),body=document.getElementById("tmFooterBody");
  function sync(){if(on)on.checked=FOOT.on;if(txt)txt.value=FOOT.text;if(al)al.value=FOOT.align;if(bd)bd.checked=FOOT.border;if(body)body.classList.toggle("off",!FOOT.on);}
  function changed(){if(on)FOOT.on=on.checked;if(txt)FOOT.text=txt.value;if(al)FOOT.align=al.value;if(bd)FOOT.border=bd.checked;if(body)body.classList.toggle("off",!FOOT.on);saveFooter();syncDocx();window.applyFooter();}
  sync();
  [on,al,bd].forEach(function(el){if(el)el.addEventListener("change",changed);});
  if(txt)txt.addEventListener("input",changed);
})();

/* ===== 쪽 머리말(Header): footer 와 대칭. 미리보기(Paged.js @top-center) + .docx 공통. 변수 {pageNumber} {totalPages} {title}. 기본 off. ===== */
(function(){
  function remember(){try{var r=localStorage.getItem("mdocify_remember");return r===null?true:r==="1";}catch(e){return true;}}
  function save(k,v){if(!remember())return;try{localStorage.setItem(k,v);}catch(e){}}
  var HEAD={on:false,text:"{title}",align:"center",border:true};
  function loadHeader(){try{var o=localStorage.getItem("mdocify_header_on");if(o!==null)HEAD.on=(o==="1");var t=localStorage.getItem("mdocify_header_text");if(t!==null)HEAD.text=t;var a=localStorage.getItem("mdocify_header_align");if(a)HEAD.align=a;var b=localStorage.getItem("mdocify_header_border");if(b!==null)HEAD.border=(b==="1");}catch(e){}}
  function saveHeader(){save("mdocify_header_on",HEAD.on?"1":"0");save("mdocify_header_text",HEAD.text);save("mdocify_header_align",HEAD.align);save("mdocify_header_border",HEAD.border?"1":"0");}
  function syncDocx(){window.__docSettings=window.__docSettings||{};window.__docSettings.header={on:HEAD.on,text:HEAD.text,align:HEAD.align,border:HEAD.border};}
  window.applyHeader=function(){var pages=document.querySelectorAll("#pages .pagedjs_page");var content=[];pages.forEach(function(pg){var mc=pg.querySelector(".pagedjs_margin-top-center .pagedjs_margin-content");if(mc){mc.textContent="";mc.style.borderBottom="";mc.style.paddingBottom="";}if(!mc||pg.querySelector(".cover"))return;var body=pg.querySelector(".pagedjs_page_content");var has=body&&(body.textContent.trim().length>0||body.querySelector("img,svg,table,hr,figure"));if(!has)return;content.push(mc);});if(!HEAD.on)return;var total=content.length,title=(window.__fname||"document");content.forEach(function(mc,i){mc.textContent=String(HEAD.text).replace(/\{pageNumber\}/g,i+1).replace(/\{totalPages\}/g,total).replace(/\{title\}/g,title);mc.style.justifyContent=(HEAD.align==="left"?"flex-start":(HEAD.align==="right"?"flex-end":"center"));if(HEAD.border){mc.style.borderBottom="1px solid #cbd5e1";mc.style.paddingBottom="5px";}});};
  loadHeader();syncDocx();
  var on=document.getElementById("tmHeader"),txt=document.getElementById("tmHeaderText"),al=document.getElementById("tmHeaderAlign"),bd=document.getElementById("tmHeaderBorder"),body=document.getElementById("tmHeaderBody");
  function sync(){if(on)on.checked=HEAD.on;if(txt)txt.value=HEAD.text;if(al)al.value=HEAD.align;if(bd)bd.checked=HEAD.border;if(body)body.classList.toggle("off",!HEAD.on);}
  function changed(){if(on)HEAD.on=on.checked;if(txt)HEAD.text=txt.value;if(al)HEAD.align=al.value;if(bd)HEAD.border=bd.checked;if(body)body.classList.toggle("off",!HEAD.on);saveHeader();syncDocx();window.applyHeader();}
  sync();
  [on,al,bd].forEach(function(el){if(el)el.addEventListener("change",changed);});
  if(txt)txt.addEventListener("input",changed);
})();

/* ===== EXE(Neutralino) 네이티브 파일 처리 (MDeautify 이식) =====
   로컬 이미지(![](x.png))는 .md 실제 경로를 알 때만 해석. 경로 확보: 파일열기 버튼(showOpenDialog)·실행인자(NL_ARGS: 더블클릭·연결앱·아이콘에 드롭).
   창-안 HTML5 드롭은 경로 없음(WebView2 한계)→문서만 로드, 이미지는 함께 드롭. 브라우저(NL_PORT 없음)에선 비활성. */
(function(){
  if(typeof window.NL_PORT==="undefined"||typeof window.Neutralino==="undefined")return;
  try{Neutralino.init();}catch(e){}
  function log(m){try{Neutralino.debug.log(String(m));}catch(e){}}
  function dirOf(p){var i=Math.max(p.lastIndexOf("\\"),p.lastIndexOf("/"));return i<0?"":p.slice(0,i);}
  function baseOf(p){var i=Math.max(p.lastIndexOf("\\"),p.lastIndexOf("/"));return i<0?p:p.slice(i+1);}
  function isAbs(p){return /^[a-zA-Z]:[\\/]/.test(p)||/^[\\/]/.test(p);}
  function joinP(dir,rel){rel=rel.replace(/^\.[\\/]/,"").replace(/\//g,"\\");return dir.replace(/[\\/]+$/,"")+"\\"+rel;}
  function mimeOf(p){var e=(p.split(".").pop()||"").toLowerCase();return ({png:"image/png",jpg:"image/jpeg",jpeg:"image/jpeg",gif:"image/gif",webp:"image/webp",bmp:"image/bmp",svg:"image/svg+xml"})[e]||"application/octet-stream";}
  function isMdPath(p){return /\.(md|markdown|txt)$/i.test(p);}
  function isImgPath(p){return /\.(png|jpe?g|gif|webp|bmp|svg)$/i.test(p);}
  function blobToDataUrl(b){return new Promise(function(r){var fr=new FileReader();fr.onload=function(){r(fr.result);};fr.readAsDataURL(b);});}
  async function readAsDataUrl(path){var arr=await Neutralino.filesystem.readBinaryFile(path);return blobToDataUrl(new Blob([new Uint8Array(arr)],{type:mimeOf(path)}));}
  /* 통합 해석기(__resolveLocalImages)가 호출: .md 폴더 기준 경로 1건을 읽어 data URI 반환 */
  window.__nativeResolve=async function(s){
    if(!window.__mdDir)return null;
    var abs=isAbs(s)?s.replace(/\//g,"\\"):joinP(window.__mdDir,s);
    try{var du=await readAsDataUrl(abs);return (window.__img&&window.__img.encode)?await window.__img.encode(du,mimeOf(abs)):du;}catch(err){log("[img] resolve fail: "+abs);return null;}
  };
  async function openMd(path){
    if(window.__confirmReplaceDoc&&!(await window.__confirmReplaceDoc()))return;
    try{var text=await Neutralino.filesystem.readFile(path);var nm=baseOf(path),fn=nm.replace(/\.(md|markdown|txt)$/i,"");if(window.__openDoc){window.__openDoc({path:path,dir:dirOf(path),name:nm,fname:fn,text:text,drop:{}});}else{window.__mdPath=path;window.__mdDir=dirOf(path);window.__mdName=nm;window.__fname=fn;window.__setEditorText(text);}}catch(err){log("[md] open fail: "+path);}
  }
  async function nativeOpen(){try{
    var ps=await Neutralino.os.showOpenDialog("파일 열기",{filters:[
      {name:"마크다운·이미지",extensions:["md","markdown","txt","png","jpg","jpeg","gif","webp","bmp","svg"]},
      {name:"마크다운",extensions:["md","markdown","txt"]},
      {name:"이미지",extensions:["png","jpg","jpeg","gif","webp","bmp","svg"]},
      {name:"모든 파일",extensions:["*"]}
    ],multiSelections:true});
    if(!ps||!ps.length)return;
    var mdPath=null,imgPaths=[];
    for(var i=0;i<ps.length;i++){if(!mdPath&&isMdPath(ps[i]))mdPath=ps[i];else if(isImgPath(ps[i]))imgPaths.push(ps[i]);}
    if(mdPath){openMd(mdPath);return;}
    if(imgPaths.length&&document.body.classList.contains("loaded")){
      window.__drop=window.__drop||{};
      for(var k=0;k<imgPaths.length;k++){var pth=imgPaths[k];try{var du=await readAsDataUrl(pth);window.__drop[baseOf(pth)]=(window.__img&&window.__img.encode)?await window.__img.encode(du,mimeOf(pth)):du;}catch(e){log("[open img] "+pth);}}
      var ta=document.getElementById("editor");if(window.__render)window.__render(ta?ta.value:"",true);
    }
  }catch(e){log("[open] "+e);}}
  window.__nativeOpen=nativeOpen;
  /* hwpx export용: src의 원본 이미지 바이트를 .md 폴더 기준으로 디스크에서 직접 읽음(webp 재인코딩 회피 → 한글이 원본 bmp/png/jpg 그대로 렌더) */
  window.__readOrigBytes=async function(src){
    if(!window.__mdDir)return null;
    var abs=isAbs(src)?src.replace(/\//g,"\\"):joinP(window.__mdDir,src);
    try{var arr=await Neutralino.filesystem.readBinaryFile(abs);var ext=(baseOf(abs).split(".").pop()||"png").toLowerCase();if(ext==="jpeg")ext="jpg";return {bytes:new Uint8Array(arr),ext:ext};}catch(e){return null;}
  };
  /* ===== 폴더 탐색기(explorer.js) 연동 진입점 ===== */
  /* .md 경로로 문서 열기 — 교체 가드 통과 시 true 반환(탐색기가 선택 표시), 취소·실패 시 false. */
  window.__openMdPath=async function(path){
    if(window.__confirmReplaceDoc&&!(await window.__confirmReplaceDoc()))return false;
    try{
      var text=await Neutralino.filesystem.readFile(path);var nm=baseOf(path),fn=nm.replace(/\.(md|markdown|txt)$/i,"");
      if(window.__openDoc){window.__openDoc({path:path,dir:dirOf(path),name:nm,fname:fn,text:text,drop:{}});}
      else{window.__mdPath=path;window.__mdDir=dirOf(path);window.__mdName=nm;window.__fname=fn;window.__setEditorText(text);}
      return true;
    }catch(err){log("[md] open fail: "+path);if(window.__toast)window.__toast("파일을 열 수 없어요");return false;}
  };
  /* 탐색기 이미지 미리보기용: 경로의 원본 바이트를 data URL 로(썸네일 표시, 인코딩 없이 원본). */
  window.__imgDataUrl=async function(abs){try{return await readAsDataUrl(abs);}catch(e){log("[imgpreview] "+abs);return null;}};
  /* 탐색기 이미지 클릭 = 현재 커서 위치에 ![](경로) 삽입. 문서 폴더(__mdDir) 기준 상대경로(없으면 절대),
     __mdDir 미확보(창-안 드롭 문서 등) 시엔 렌더 위해 풀(__drop)에 바이트 적재 후 파일명 참조로 폴백. */
  window.__insertImageFromPath=async function(abs){
    if(!document.body.classList.contains("loaded"))return;
    var base=baseOf(abs),ref=null;
    if(window.__mdDir){
      try{ref=await Neutralino.filesystem.getRelativePath(abs,window.__mdDir);}catch(e){ref=null;}
      if(ref)ref=ref.replace(/\\/g,"/");
      if(!ref)ref=abs.replace(/\\/g,"/");   /* 상대경로 산출 실패(다른 드라이브 등) → 절대경로 폴백 */
    }else{
      try{var du=await readAsDataUrl(abs);window.__drop=window.__drop||{};window.__drop[base]=(window.__img&&window.__img.encode)?await window.__img.encode(du,mimeOf(abs)):du;}catch(e){log("[ins img] "+abs);}
      ref=base;
    }
    var alt=base.replace(/\.[a-z0-9]+$/i,"");
    var dest=/\s/.test(ref)?"<"+ref+">":ref;
    if(window.__img&&window.__img.insert)window.__img.insert("!["+alt+"]("+dest+")");   /* 커서 삽입 + onEdit → 미러·미리보기 갱신 */
  };
  /* 실행 인자로 넘어온 .md 자동 열기(더블클릭/연결앱/아이콘에 드롭).
     연결 끊김 복구(recover.js) 대기 중이면 건너뜀 — 새로고침해도 NL_ARGS 는 처음 그대로라 같은 파일이 또 열리고, 복원본이 우선이다. */
  try{var hasRecover=false;try{hasRecover=!!localStorage.getItem("mdhwpxify_recover");}catch(_){}
    if(!hasRecover){var a=window.NL_ARGS||[];for(var i=1;i<a.length;i++){if(isMdPath(a[i])&&isAbs(a[i])){openMd(a[i]);break;}}}}catch(e){}
})();

/* ===== GitHub 릴리스 목록 공유 캐시 (업데이트 확인 + 릴리스 노트가 함께 사용) — MDeautify 구조 이식 =====
   - /releases 한 번만 호출해 최근 목록을 캐시(TTL 10분) → 시작 시 확인·설정 열기·노트 열기가 겹쳐도 재호출 안 함.
   - ETag 조건부 요청(If-None-Match): 변경 없으면 304 → GitHub rate limit 에 미차감(사실상 공짜). 미인증 60회/시간 소진 방지.
   - 실패 시 캐시가 있으면 캐시로 폴백. force=true 면 TTL 무시하고 재검증(단 ETag 로 304 면 여전히 무료). */
(function(){
  var REPO="felixleee/MDhwpxify",URL="https://api.github.com/repos/"+REPO+"/releases?per_page=10",TTL=600000;
  var cache=null,etag=null,ts=0,inflight=null;
  window.__ghReleases=function(force){
    var now=Date.now();
    if(!force&&cache&&(now-ts)<TTL)return Promise.resolve(cache);
    if(inflight)return inflight;                          /* 동시 호출 합치기 */
    var headers={"Accept":"application/vnd.github+json"};
    if(etag)headers["If-None-Match"]=etag;
    inflight=fetch(URL,{headers:headers}).then(function(r){
      if(r.status===304){ts=Date.now();return cache||[];}  /* 변경 없음 → 캐시 재사용(미차감) */
      if(!r.ok)throw new Error("HTTP "+r.status);
      var et=r.headers.get("etag");if(et)etag=et;
      return r.json().then(function(arr){cache=Array.isArray(arr)?arr:[];ts=Date.now();return cache;});
    }).catch(function(e){if(cache)return cache;throw e;})   /* 실패해도 캐시 있으면 그걸로 */
      .then(function(v){inflight=null;return v;},function(e){inflight=null;throw e;});
    return inflight;
  };
})();
/* ===== 릴리스 노트 모달 (GitHub 릴리스 body 를 marked 로 렌더) — MDeautify 구조 이식 =====
   __showReleaseNotes(tag): 수동(즉시 열고 로딩→채움/에러). __showReleaseNotesAuto(tag): 자동(성공 시에만 표시). */
(function(){
  var modal=document.getElementById("notesModal"),titleEl=document.getElementById("nmTitle"),bodyEl=document.getElementById("nmBody"),closeBtn=document.getElementById("nmClose");
  if(!modal)return;
  function esc(s){return String(s).replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];});}   /* 따옴표까지 — 속성값(title='…') 안에서 끊고 나오지 못하게 */
  function close(){modal.hidden=true;}
  if(closeBtn)closeBtn.addEventListener("click",close);
  modal.addEventListener("click",function(e){if(e.target===modal)close();});
  document.addEventListener("keydown",function(e){if(e.key==="Escape"&&!modal.hidden)close();});
  var TITLE="MDhwpxify Release Note";
  /* 릴리스 body 선두의 중복 제목(#/## …)을 제거 — 섹션 헤더로 버전을 따로 표기하므로. */
  function stripHead(md){return String(md||"").replace(/^[ \t]*#{1,2}[ \t]+.*(?:\r?\n)+/,"");}
  /* 최근 5개 릴리스를 공유 캐시(window.__ghReleases)에서 가져와 각 버전 섹션으로 렌더 — 자동 업데이트 확인과 호출 공유. */
  function fetchRecent(){
    return window.__ghReleases().then(function(arr){if(!Array.isArray(arr))arr=[];return arr.slice(0,5).map(function(j){
        var tag=String(j.tag_name||j.name||"").replace(/^v/i,"");
        return {ver:tag?("v"+tag):(j.name||"릴리스"),
                date:String(j.published_at||j.created_at||"").slice(0,10),
                html:(j.body&&window.marked)?window.__sanitize(window.marked.parse(stripHead(j.body))):esc(j.body||"")};   /* GitHub 에서 받은 글도 정화 */
      });});
  }
  function renderList(items){
    if(titleEl)titleEl.textContent=TITLE;
    var h="";
    for(var i=0;i<items.length;i++){var it=items[i];
      h+="<section class='nm-rel'><div class='nm-rel-head'><span class='nm-ver'>"+esc(it.ver)+"</span>"+
         (it.date?"<span class='nm-date'>"+esc(it.date)+"</span>":"")+"</div>"+
         (it.html||"<p class='nm-empty'>내용이 없습니다.</p>")+"</section>";
    }
    if(bodyEl){bodyEl.innerHTML=h||"<p class='nm-loading'>릴리스 노트가 없습니다.</p>";bodyEl.scrollTop=0;}
    modal.hidden=false;
  }
  window.__showReleaseNotes=function(){
    if(titleEl)titleEl.textContent=TITLE;if(bodyEl)bodyEl.innerHTML="<p class='nm-loading'>불러오는 중…</p>";modal.hidden=false;
    return fetchRecent().then(function(items){if(items.length)renderList(items);else if(bodyEl)bodyEl.innerHTML="<p class='nm-loading'>릴리스 노트가 없습니다.</p>";}).catch(function(){if(bodyEl)bodyEl.innerHTML="<p class='nm-err'>릴리스 노트를 불러오지 못했어요.</p>";});
  };
  window.__showReleaseNotesAuto=function(){
    return fetchRecent().then(function(items){if(items.length)renderList(items);}).catch(function(){});
  };
})();
/* ===== 자동 업데이트 (EXE 전용) — MDeautify 구조 이식 =====
   확인: GitHub API(CORS 허용)로 최신 릴리스 tag 를 현재 버전(NL_APPVERSION)과 비교(공유 캐시 사용).
   설치: exe+sha256 다운로드 URL·대상 경로를 담은 PowerShell 헬퍼를 temp 에 쓰고 백그라운드 실행 → app.exit().
         헬퍼가 네이티브 다운로드 → SHA256 검증 → Unblock-File → (앱 종료로 exe 잠금 풀릴 때까지 대기) → 백업 후 교체 → 재실행. */
(function(){
  var REPO="felixleee/MDhwpxify",EXE="MDhwpxify.exe";
  var isExe=(typeof window.NL_PORT!=="undefined"&&typeof window.Neutralino!=="undefined");
  var about=document.getElementById("tmAbout"),verEl=document.getElementById("tmVer"),
      btn=document.getElementById("tmUpd"),box=document.getElementById("tmUpdBox"),msg=document.getElementById("tmUpdMsg"),
      act=document.getElementById("tmUpdAct"),link=document.getElementById("tmUpdLink"),go=document.getElementById("tmUpdGo"),
      settingsBtn=document.getElementById("btnSettings"),
      updModal=document.getElementById("updModal"),updMsgEl=document.getElementById("updMsg");
  if(!about||!isExe)return;                                  /* 버전/업데이트 정보는 EXE 에서만 */
  function showUpd(t){if(updMsgEl)updMsgEl.textContent=t;if(updModal)updModal.hidden=false;}
  function hideUpd(){if(updModal)updModal.hidden=true;}
  var CUR=window.NL_APPVERSION?String(window.NL_APPVERSION):"";
  about.hidden=false;if(verEl)verEl.textContent=CUR||"—";

  function verGt(a,b){a=String(a).replace(/^v/i,"").split(".");b=String(b).replace(/^v/i,"").split(".");for(var i=0;i<3;i++){var x=parseInt(a[i]||0,10),y=parseInt(b[i]||0,10);if(x>y)return true;if(x<y)return false;}return false;}
  function escH(s){return String(s).replace(/[&<>"']/g,function(c){return {"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c];});}   /* GitHub 태그·오류 글자를 HTML 로 넣지 않게 */
  function setMsg(cls,html){if(!box||!msg)return;box.hidden=false;msg.className="tm-upd-msg"+(cls?" "+cls:"");msg.innerHTML=html;}
  function showAct(){if(act)act.hidden=false;}   /* '릴리스 노트'는 새 창 대신 인-앱 모달로(아래 링크 클릭) */
  function hideAct(){if(act)act.hidden=true;}
  if(link)link.addEventListener("click",function(){var t=(latest&&latest.tag)||CUR;if(window.__showReleaseNotes)window.__showReleaseNotes(t);});

  var latest=null;   /* {tag, exeUrl, shaUrl, size, notesUrl} */
  /* 최신 릴리스를 공유 캐시(window.__ghReleases)에서 도출 — /releases 목록의 첫 정식(초안·프리릴리스 제외) 릴리스. force=true 면 ETag 재검증. */
  function fetchLatest(force){
    return window.__ghReleases(force).then(function(arr){
      var j=null;for(var i=0;i<(arr||[]).length;i++){if(!arr[i].draft&&!arr[i].prerelease){j=arr[i];break;}}
      if(!j)return {tag:"",exeUrl:null,shaUrl:null,size:0,notesUrl:""};
      var a=(j.assets||[]),exeUrl=null,shaUrl=null,size=0;for(var k=0;k<a.length;k++){if(a[k].name===EXE){exeUrl=a[k].browser_download_url;size=a[k].size||0;}else if(a[k].name===EXE+".sha256")shaUrl=a[k].browser_download_url;}
      return {tag:(j.tag_name||"").replace(/^v/i,""),exeUrl:exeUrl,shaUrl:shaUrl,size:size,notesUrl:j.html_url};});
  }
  function check(auto,force){
    if(btn)btn.disabled=true;if(!auto)setMsg("","확인 중…");
    return fetchLatest(force).then(function(info){
      latest=info;if(btn)btn.disabled=false;
      if(!info.tag){if(!auto)setMsg("bad","릴리스 정보를 읽지 못했어요.");return false;}
      if(verGt(info.tag,CUR)){
        if(settingsBtn)settingsBtn.classList.add("has-update");
        if(!info.exeUrl){setMsg("warn","새 버전 <b>v"+escH(info.tag)+"</b> 이 있지만 자동 설치용 exe가 없어요. 릴리스에서 직접 받아 주세요.");showAct();if(go)go.style.display="none";return true;}
        setMsg("warn","새 버전 <b>v"+escH(info.tag)+"</b> 이 있습니다. (현재 v"+CUR+")");showAct();if(go){go.style.display="";go.disabled=false;}return true;   /* 새 버전 → 설치 버튼 활성 */
      }
      if(settingsBtn)settingsBtn.classList.remove("has-update");
      if(!auto){setMsg("ok","최신 버전입니다. (v"+CUR+")");showAct();if(go){go.style.display="";go.disabled=true;}}  /* 같은 버전 → 버튼은 두되 비활성화 */
      else hideAct();
      return false;
    }).catch(function(e){if(btn)btn.disabled=false;if(!auto)setMsg("bad","업데이트 확인 실패: "+escH((e&&e.message)||e));return false;});
  }

  function psQ(s){return "'"+String(s).replace(/'/g,"''")+"'";}   /* PowerShell single-quote escape */
  function buildHelper(exeUrl,shaUrl,target){
    return [
      "$ErrorActionPreference='SilentlyContinue'",
      "[Net.ServicePointManager]::SecurityProtocol=[Net.SecurityProtocolType]::Tls12",
      "$exe="+psQ(exeUrl),"$sha="+psQ(shaUrl||""),"$target="+psQ(target),
      "function Relaunch(){ try{ if(Test-Path $target){ Start-Process -FilePath $target } }catch{} }",   /* 실패 시 원본(교체 전 온전한 exe) 재실행 → 앱이 닫힌 채 남지 않게 */
      "$tmp=Join-Path $env:TEMP 'mdhwpxify-update'",
      "New-Item -ItemType Directory -Force $tmp | Out-Null",
      "$status=Join-Path $tmp 'status.txt'",
      "Remove-Item $status -Force -ErrorAction SilentlyContinue",   /* 이전 실행의 status 제거(앱이 stale 읽지 않게) */
      "$dl=Join-Path $tmp 'MDhwpxify.new.exe'",
      "try{ Invoke-WebRequest -Uri $exe -OutFile $dl -UseBasicParsing }catch{ Set-Content -LiteralPath $status -Value 'fail:download' -Encoding ascii; exit 1 }",
      "$expected=''",
      "if($sha){ try{ $sf=Join-Path $tmp 'MDhwpxify.sha'; Invoke-WebRequest -Uri $sha -OutFile $sf -UseBasicParsing; $c=Get-Content $sf -Raw; $expected=(($c -replace '[^0-9A-Fa-f]','')).Substring(0,64).ToLower() }catch{ $expected='' } }",
      "$actual=(Get-FileHash $dl -Algorithm SHA256).Hash.ToLower()",
      "if($expected -and ($actual -ne $expected)){ Remove-Item $dl -Force; Set-Content -LiteralPath $status -Value 'fail:verify' -Encoding ascii; exit 2 }",
      "Unblock-File $dl",
      "Set-Content -LiteralPath $status -Value 'downloaded' -Encoding ascii",   /* 앱이 이걸 보고 '설치 중' 표시 후 종료 → 아래 교체 진행 */
      "$dir=[IO.Path]::GetDirectoryName($target)",
      "$bakName=[IO.Path]::GetFileName($target)+'.bak'",
      "$bak=Join-Path $dir $bakName",
      "$ok=$false",
      "for($i=0;$i -lt 120;$i++){ try{ if(Test-Path $bak){Remove-Item $bak -Force}; Rename-Item -LiteralPath $target -NewName $bakName -ErrorAction Stop; Copy-Item $dl $target -Force; $ok=$true; break }catch{ Start-Sleep -Milliseconds 500 } }",
      "if(-not $ok){ if((Test-Path $bak) -and -not (Test-Path $target)){ Rename-Item -LiteralPath $bak -NewName ([IO.Path]::GetFileName($target)) }; Relaunch; exit 3 }",
      "Remove-Item $bak -Force -ErrorAction SilentlyContinue",
      "Remove-Item $dl -Force -ErrorAction SilentlyContinue",
      "Start-Process -FilePath $target"
    ].join("\r\n");
  }
  /* status.txt 폴링: 다운로드 동안 앱은 열린 채 진행률 표시.
     'downloaded' → '설치 중' 표시 후 앱 종료(잠금 해제) → 헬퍼가 교체+재실행. 'fail:*' → 앱 유지+에러. */
  function poll(statusPath,dlPath,total){
    var tries=0,MAX=600;   /* 600 * 500ms = 5분 */
    var t=setInterval(function(){
      tries++;
      Neutralino.filesystem.readFile(statusPath).then(function(s){
        s=String(s||"").trim();
        if(s.indexOf("downloaded")===0){
          clearInterval(t);showUpd("설치 중… 곧 재시작됩니다");
          setTimeout(function(){try{Neutralino.app.exit();}catch(e){}},600);   /* 종료 → 헬퍼가 교체+재실행 */
        }else if(s.indexOf("fail")===0){
          clearInterval(t);hideUpd();if(go)go.disabled=false;
          var code=(s.split(":")[1]||"").trim();
          alert(code==="download"?"다운로드에 실패했어요. 앱은 그대로 유지됩니다.":code==="verify"?"파일 검증(SHA256)에 실패했어요. 앱은 그대로 유지됩니다.":"업데이트에 실패했어요. 앱은 그대로 유지됩니다.");
        }
      }).catch(function(){
        /* status 없음 = 다운로드 진행 중 → 파일 크기로 대략 % */
        Neutralino.filesystem.getStats(dlPath).then(function(st){
          if(total>0){var pct=Math.min(99,Math.floor((st.size/total)*100));showUpd("업데이트 다운로드 중… "+pct+"%");}
          else showUpd("업데이트 다운로드 중…");
        }).catch(function(){showUpd("업데이트 다운로드 중…");});
      });
      if(tries>=MAX){clearInterval(t);hideUpd();if(go)go.disabled=false;alert("업데이트 시간이 초과되었습니다. 앱은 그대로 유지됩니다.");}
    },500);
  }
  function install(){
    if(!latest||!latest.tag){setMsg("bad","릴리스 정보를 확인하지 못했어요.");return;}
    if(!verGt(latest.tag,CUR)){setMsg("ok","이미 최신 버전입니다. (v"+CUR+")");hideAct();if(settingsBtn)settingsBtn.classList.remove("has-update");return;}  /* 최신이면 설치 실행 안 함(안전장치) */
    if(!latest.exeUrl){setMsg("bad","설치할 exe 자산이 없습니다.");return;}
    var base=String(window.NL_PATH||"").replace(/[\\/]+$/,"");
    if(!base){setMsg("bad","앱 경로를 확인하지 못했어요.");return;}
    var target=base+"\\"+EXE,total=latest.size||0;
    if(go)go.disabled=true;
    Neutralino.os.getEnv("TEMP").then(function(tmp){
      var dir=(tmp||base),name="mdhwpxify-update.ps1",updDir=dir+"\\mdhwpxify-update";
      var statusPath=updDir+"\\status.txt",dlPath=updDir+"\\MDhwpxify.new.exe";
      var script=buildHelper(latest.exeUrl,latest.shaUrl,target);
      return Neutralino.filesystem.writeFile(dir+"\\"+name,script).then(function(){
        /* 상대 파일명 + cwd 로 실행(경로 공백/인용부호 회피). 앱은 닫지 않고 다운로드 진행률을 폴링으로 표시. */
        return Neutralino.os.execCommand("powershell -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "+name,{background:true,cwd:dir});
      }).then(function(){
        showUpd("업데이트 다운로드 중…");
        poll(statusPath,dlPath,total);
      });
    }).catch(function(e){hideUpd();if(go)go.disabled=false;alert("설치 시작 실패: "+((e&&e.message)||e));});
  }

  if(btn)btn.addEventListener("click",function(){check(false,true);});   /* 명시적 '업데이트 확인' 버튼 → force 재검증(ETag 라 변경 없으면 304=무료) */
  if(go)go.addEventListener("click",install);
  window.__updateCheck=function(){return check(false,false);};   /* 톱니 열 때 자동 호출 → 캐시(TTL 10분) 재사용, 재호출 안 함 */
  setTimeout(function(){check(true,false);},2500);   /* 시작 후 조용히 1회 확인 → 캐시 채움. 새 버전이면 설정 버튼에 점 표시 */

  /* 업데이트 후 첫 실행이면 릴리스 노트 모달 자동 표시 (MDeautify seenCheck 이식).
     seen 버전은 mdocify_ 접두 키라 %APPDATA%\MDhwpxify\settings.json 에 영속(exe 교체에도 유지).
     포트 자동(0)이라 localStorage 는 매 실행 비어 시작 → 설정 하이드레이션(settings-ready) 후 판정.
     '업그레이드'만 표시(첫 설치 제외): seen 이 현재와 다르거나, seen 은 없지만 기존 설정키가 있으면(=이전 사용자) 표시. */
  function seenCheck(){
    if(!CUR)return;
    var seen=null;try{seen=localStorage.getItem("mdocify_seen_version");}catch(e){}
    var hadSettings=false;try{for(var i=0;i<localStorage.length;i++){var k=localStorage.key(i);if(k&&k.indexOf("mdocify_")===0&&k!=="mdocify_seen_version"){hadSettings=true;break;}}}catch(e){}
    var upgraded=(seen&&seen!==CUR)||(!seen&&hadSettings);
    if(upgraded&&window.__showReleaseNotesAuto)window.__showReleaseNotesAuto(CUR);
    if(seen!==CUR){try{localStorage.setItem("mdocify_seen_version",CUR);}catch(e){}}
  }
  document.addEventListener("mdocify:settings-ready",seenCheck);
})();

/* ===== MD 원본 ↔ 미리보기 스크롤 동기화 (방식 B, MDeautify 이식) =====
   한쪽 스크롤 위치를 앵커쌍{ed:에디터 원본줄 Y, vw:미리보기 블록 Y} 선형보간으로 반대쪽에 반영.
   lockUntil: 프로그램적 스크롤이 되돌려 트리거하는 피드백 루프 차단(짧은 창 동안 상호 이벤트 무시).
   편집기 접힘(editor-collapsed) 시 비활성. 편집기=#editor, 색상 미러=#raw(.ln[data-ln]), 뷰어=#pages([data-sl]). */
(function(){
  var rawInput=document.getElementById("editor"),mirror=document.getElementById("raw"),viewer=document.getElementById("pages");
  if(!rawInput||!mirror||!viewer)return;
  var clock=(window.performance&&performance.now)?function(){return performance.now();}:function(){return +new Date();};
  var lockUntil=0,cache=null,ckey="";
  /* 앵커: [data-sl] 블록마다 {ed,vw}. 양 끝점(0,0)/(max,max) + 클램프 + vw 단조증가. 레이아웃 변화 시에만 재계산(캐시). */
  function build(){
    var seen={},A=[],mr=mirror.getBoundingClientRect(),vr=viewer.getBoundingClientRect(),vs=viewer.scrollTop,rs=mirror.scrollTop;
    var bl=viewer.querySelectorAll("[data-sl]");
    for(var i=0;i<bl.length;i++){var sl=+bl[i].getAttribute("data-sl");if(seen[sl])continue;
      var ln=mirror.querySelector('.ln[data-ln="'+sl+'"]');if(!ln)continue;
      var r=ln.getClientRects();if(!r.length)continue;
      seen[sl]=1;
      A.push({ed:r[0].top-mr.top+rs, vw:bl[i].getBoundingClientRect().top-vr.top+vs});
    }
    A.sort(function(a,b){return a.ed-b.ed;});
    var edMax=rawInput.scrollHeight-rawInput.clientHeight,vwMax=viewer.scrollHeight-viewer.clientHeight;
    A.unshift({ed:0,vw:0});A.push({ed:edMax,vw:vwMax});
    for(var k=0;k<A.length;k++){A[k].ed=Math.max(0,Math.min(edMax,A[k].ed));A[k].vw=Math.max(0,Math.min(vwMax,A[k].vw));}
    for(var m=1;m<A.length;m++){if(A[m].vw<A[m-1].vw)A[m].vw=A[m-1].vw;}
    return A;
  }
  function anchors(){var k=viewer.querySelectorAll("[data-sl]").length+"|"+rawInput.scrollHeight+"|"+viewer.scrollHeight+"|"+rawInput.clientWidth+"|"+viewer.clientHeight;if(k!==ckey){cache=build();ckey=k;}return cache;}
  function interp(A,fk,tk,v){for(var i=0;i<A.length-1;i++){var a=A[i],b=A[i+1];if(v>=a[fk]&&v<=b[fk]){var s=b[fk]-a[fk];return a[tk]+(s>0?(v-a[fk])/s:0)*(b[tk]-a[tk]);}}return v<=A[0][fk]?A[0][tk]:A[A.length-1][tk];}
  /* 헤더(.pv-head)는 스크롤러(#pages) 밖 형제라 내용을 가리지 않음 → 헤더 높이 보정 없음.
     (MDeautify 에서 sticky 헤더 시절 보정이 따라와 있었는데, 그대로 두면 동기화가 헤더 높이 ~33px 만큼 어긋남 — MDeautify v1.8.2 와 동일하게 제거) */
  function linkFn(from,to,fk,tk){from.addEventListener("scroll",function(){if(clock()<lockUntil)return;if(document.body.classList.contains("editor-collapsed"))return;var A=anchors();if(!A||A.length<2)return;
    var q=from.scrollTop;
    var y=interp(A,fk,tk,q);if(y==null)return;
    lockUntil=clock()+80;to.scrollTop=Math.max(0,y);
    if(to===rawInput){mirror.scrollTop=rawInput.scrollTop;mirror.scrollLeft=rawInput.scrollLeft;}
  });}
  linkFn(rawInput,viewer,"ed","vw");
  linkFn(viewer,rawInput,"vw","ed");
})();
