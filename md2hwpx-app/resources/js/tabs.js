/* ===== 탭(멀티 문서) — MDeautify 이식 =====
   여러 md를 탭으로 열어 두고 전환. 전역(__mdPath·__mdDir·__mdName·__fname·__drop·__imgFiles + 편집기 내용 + 저장 기준선)을
   '활성 문서 라이브 상태'로 두고 탭 전환 때만 스냅샷/복원. 세션: {id,path,dir,name,fname,text,baseline,drop,imgFiles,scroll,ai}.
   ai = 그 문서의 AI 대화 세션(ai-chat.js __aiSnapshot/__aiRestore). 대화가 있는 탭엔 별 표시(.has-ai).
   ⚠️ MVP: 탭 전환 시 textarea undo 초기화, 재시작 시 탭 복원 없음(세션 한정).
   MDhwpxify 전역: __syncMirror(미러 하이라이트)·__render(미리보기)·__setEditorText(새 탭 로드, baseline clean). */
(function(){
  var sessions=[],activeId=null,seq=1,bar=null;
  function ensureBar(){if(bar)return bar;bar=document.getElementById("tabBar");return bar;}
  function norm(p){return String(p||"").replace(/[\\/]+/g,"\\").replace(/\\+$/,"").toLowerCase();}
  function byId(id){for(var i=0;i<sessions.length;i++)if(sessions[i].id===id)return sessions[i];return null;}
  function findByPath(p){if(!p)return null;var n=norm(p);for(var i=0;i<sessions.length;i++)if(sessions[i].path&&norm(sessions[i].path)===n)return sessions[i];return null;}
  function isDirty(s){return !!s&&s.text!==s.baseline;}
  function el(tag,cls){var d=document.createElement(tag);if(cls)d.className=cls;return d;}
  function ta(){return document.getElementById("editor");}
  function mirror(){return document.getElementById("raw");}

  /* ---- AI 대화 표시(별) — MDeautify v1.8.2 ----
     활성 탭은 s.ai 가 마지막 스냅샷이라 뒤처진다 → 살아있는 세션에 직접 묻는다.
     비활성 탭의 s.ai 는 세션 객체 그대로라 msgs 가 실시간으로 자란다(배경에서 받는 답변도 반영). */
  function hasAi(s){
    if(s.id===activeId&&window.__aiHasMsgs)return window.__aiHasMsgs();
    return !!(s.ai&&s.ai.msgs&&s.ai.msgs.length);
  }
  /* 별 1개(4각 스파클) — 16x16 박스를 꽉 채우도록 가운데 정렬 */
  var AI_SVG='<svg viewBox="0 0 16 16" width="16" height="16" fill="currentColor">'+
    '<path d="M8,1 C8,6.25 6.25,8 1,8 C6.25,8 8,9.75 8,15 C8,9.75 9.75,8 15,8 C9.75,8 8,6.25 8,1 Z"/></svg>';

  function renderTabs(){
    ensureBar();if(!bar)return;
    if(!sessions.length){bar.hidden=true;bar.innerHTML="";return;}
    bar.hidden=false;bar.innerHTML="";
    sessions.forEach(function(s){
      var ai=hasAi(s);
      var t=el("div","tab"+(s.id===activeId?" active":"")+(isDirty(s)?" dirty":"")+(ai?" has-ai":""));
      t.setAttribute("data-id",s.id);t.title=(s.path||s.name)+(ai?"  ·  AI 대화 있음":"");
      var sp=el("span","tab-ai");sp.setAttribute("aria-hidden","true");sp.innerHTML=AI_SVG;
      var nm=el("span","tab-name");nm.textContent=s.name||"문서";
      var dot=el("span","tab-dot");dot.setAttribute("aria-hidden","true");
      var x=el("button","tab-x");x.type="button";x.title="닫기";x.setAttribute("aria-label","닫기");x.innerHTML="&#10005;";
      t.appendChild(sp);t.appendChild(nm);t.appendChild(dot);t.appendChild(x);
      t.addEventListener("mousedown",function(e){if(e.button===1){e.preventDefault();closeTab(s.id);}});
      t.addEventListener("click",function(e){if(e.target===x||x.contains(e.target)){e.stopPropagation();closeTab(s.id);return;}switchTo(s.id);});
      bar.appendChild(t);
    });
    var act=bar.querySelector(".tab.active");if(act&&act.scrollIntoView){try{act.scrollIntoView({inline:"nearest",block:"nearest"});}catch(e){}}
  }

  function snapshotActive(noAi){   /* noAi=true: AI 대화는 떼지 않음(연결 복구용 내보내기 — 패널을 비우지 않게) */
    if(activeId==null)return;var s=byId(activeId);if(!s)return;var t=ta();
    if(t)s.text=t.value;
    if(window.__getSaved)s.baseline=window.__getSaved();
    s.path=window.__mdPath||null;s.dir=window.__mdDir||null;
    s.name=window.__mdName||s.name;s.fname=window.__fname||s.fname;
    s.drop=window.__drop||{};s.imgFiles=window.__imgFiles||[];
    if(t)s.scroll=t.scrollTop;
    if(!noAi&&window.__aiSnapshot)s.ai=window.__aiSnapshot();   /* AI 대화도 문서에 딸려 보관 */
  }
  /* 세션 → 라이브(전환/복원): baseline 보존(dirty 유지), __setEditorText 안 씀(그건 baseline clean 리셋) */
  function restore(s){
    window.__mdPath=s.path||null;window.__mdDir=s.dir||null;window.__mdName=s.name||null;window.__fname=s.fname||null;
    window.__drop=s.drop||{};window.__imgFiles=s.imgFiles||[];
    var t=ta(),m=mirror();
    if(t)t.value=s.text;
    if(window.__setSaved)window.__setSaved(s.baseline);
    document.body.classList.add("loaded");
    if(window.__relayoutPanes)window.__relayoutPanes();
    if(window.__syncMirror)window.__syncMirror();
    if(window.__render)window.__render(s.text,false);
    if(t){t.scrollTop=s.scroll||0;if(m){m.scrollTop=t.scrollTop;m.scrollLeft=t.scrollLeft;}}
    var fh=document.getElementById("findHl");if(fh)fh.innerHTML="";   /* 이전 탭의 찾기 하이라이트 잔상 제거 */
    if(window.__renderFileBadge)window.__renderFileBadge();
    if(window.__aiRestore)window.__aiRestore(s.ai);   /* 이 문서의 대화로 교체(없으면 새 대화) */
  }
  function switchTo(id){if(id===activeId)return;snapshotActive();activeId=id;restore(byId(id));renderTabs();}

  /* 문서 열기/포커스: 진입점(openMd·drop·loadFile·startBlank)이 호출 */
  function openDoc(meta){
    meta=meta||{};snapshotActive();
    if(meta.path){var ex=findByPath(meta.path);if(ex){activeId=ex.id;restore(ex);renderTabs();return;}}   /* 이미 열림 → 포커스 */
    /* meta.baseline: 저장 기준선을 따로 줄 때(연결 복구 — 미저장 편집의 ● 표시 유지). 없으면 열자마자 clean */
    var hasBase=(typeof meta.baseline==="string");
    var s={id:seq++,path:meta.path||null,dir:meta.dir||null,name:meta.name||"document",fname:meta.fname||"document",text:meta.text||"",baseline:hasBase?meta.baseline:(meta.text||""),drop:meta.drop||{},imgFiles:[],scroll:0};
    sessions.push(s);activeId=s.id;
    window.__mdPath=s.path;window.__mdDir=s.dir;window.__mdName=s.name;window.__fname=s.fname;window.__drop=s.drop;window.__imgFiles=[];
    document.body.classList.add("loaded");
    if(window.__relayoutPanes)window.__relayoutPanes();
    if(window.__setEditorText)window.__setEditorText(s.text);   /* 새 탭 로드(baseline clean, 미러·프리뷰 일괄) */
    if(hasBase&&window.__setSaved)window.__setSaved(s.baseline);   /* 기준선 복원 → 미저장이면 ● 그대로 */
    if(window.__renderFileBadge)window.__renderFileBadge();
    if(window.__aiRestore)window.__aiRestore(s.ai);   /* 새 문서 = 새 대화(restore 를 안 거치는 경로라 여기서 직접 — 빠뜨리면 이전 대화가 새 문서로 샘) */
    renderTabs();
  }

  function clearToEmpty(){
    activeId=null;document.body.classList.remove("loaded");
    window.__mdPath=null;window.__mdDir=null;window.__mdName=null;window.__fname=null;window.__drop={};window.__imgFiles=[];
    var t=ta(),m=mirror();if(t)t.value="";if(m)m.innerHTML="";
    if(window.__setSaved)window.__setSaved("");
    var pages=document.getElementById("pages");if(pages)pages.innerHTML="";
    var pv=document.getElementById("pvHead");if(pv)pv.textContent="Total 0 pages";
    if(window.__renderFileBadge)window.__renderFileBadge();
  }

  async function closeTab(id){
    var s=byId(id);if(!s)return;
    if(id===activeId)snapshotActive();
    var backTo=null;   /* 배경 탭을 저장하려고 잠깐 전환했다면, 닫은 뒤 원래 보던 탭으로 복귀 */
    if(isDirty(s)){
      var choice="discard";
      if(window.__confirmSave3){choice=await window.__confirmSave3({title:"저장하고 닫기",message:"'"+(s.name||"문서")+"'에 저장하지 않은 변경사항이 있어요.\n저장한 뒤 닫을까요?",saveText:"저장하고 닫기",discardText:"저장 안 함",cancelText:"취소"});}
      if(choice==="cancel")return;
      if(choice==="save"){
        /* 저장은 활성(라이브)에 대해서만 → 먼저 활성화. ⚠️전환 전에 지금 활성 문서를 스냅샷해야 함 —
           안 하면 그 문서의 마지막 스냅샷 이후 편집(과 AI 대화)이 라이브 상태째 덮여 사라진다. */
        if(id!==activeId){snapshotActive();backTo=activeId;activeId=id;restore(s);renderTabs();}
        var hadPath=!!window.__mdPath;if(window.__saveMd)await window.__saveMd();
        if(!hadPath&&!window.__mdPath)return;   /* 경로 없던 문서 저장 취소 → 닫기도 취소(유실 방지) */
        snapshotActive();
      }
    }
    var idx=-1;for(var i=0;i<sessions.length;i++)if(sessions[i].id===id){idx=i;break;}
    if(idx<0)return;var wasActive=(id===activeId);
    sessions.splice(idx,1);
    if(!sessions.length){clearToEmpty();renderTabs();return;}
    if(wasActive){var next=(backTo!=null&&byId(backTo))||sessions[idx]||sessions[idx-1]||sessions[0];activeId=next.id;restore(next);}
    renderTabs();
  }

  var edTmr=null;
  window.__tabsOnEdit=function(){
    if(activeId==null)return;clearTimeout(edTmr);
    edTmr=setTimeout(function(){var s=byId(activeId);if(!s)return;var t=ta();var curDirty=t?(t.value!==(window.__getSaved?window.__getSaved():s.baseline)):isDirty(s);var chip=bar&&bar.querySelector('.tab[data-id="'+activeId+'"]');if(chip)chip.classList.toggle("dirty",!!curDirty);},120);
  };
  /* AI 대화가 생기거나 비워질 때 별 표시만 갱신(ai-chat 이 메시지 경계마다 호출) */
  window.__tabsSyncAi=function(){
    if(!bar)return;
    sessions.forEach(function(s){
      var chip=bar.querySelector('.tab[data-id="'+s.id+'"]');
      if(!chip)return;
      var ai=hasAi(s);
      chip.classList.toggle("has-ai",ai);
      chip.title=(s.path||s.name)+(ai?"  ·  AI 대화 있음":"");
    });
  };
  /* 연결 끊김 복구(recover.js)용: 모든 탭을 직렬화 가능한 형태로(활성 탭은 라이브 상태 반영 후) + 활성 탭 순번 */
  window.__tabsExport=function(){
    snapshotActive(true);
    var act=-1;
    var docs=sessions.map(function(s,i){if(s.id===activeId)act=i;return {path:s.path,dir:s.dir,name:s.name,fname:s.fname,text:s.text,baseline:s.baseline,drop:s.drop||{}};});
    return {active:act,docs:docs};
  };
  window.__tabsActivate=function(i){var s=sessions[i];if(s)switchTo(s.id);};
  window.__openDoc=openDoc;
  window.__tabsCount=function(){return sessions.length;};
  window.__closeActiveTab=function(){if(activeId!=null)closeTab(activeId);};

  /* ===== Ctrl/Cmd+W: 활성 탭 닫기 (더티면 저장 모달, 마지막 탭이면 빈 화면) ===== */
  function anyOverlayOpen(){var ids=["appModal","updModal","notesModal","themeModal","settingsModal","docSetModal"];for(var i=0;i<ids.length;i++){var m=document.getElementById(ids[i]);if(m&&!m.hidden)return true;}return false;}
  document.addEventListener("keydown",function(e){
    if(!((e.ctrlKey||e.metaKey)&&!e.shiftKey&&!e.altKey))return;
    if(e.key!=="w"&&e.key!=="W")return;
    if(e.repeat)return;
    if(activeId==null)return;
    if(anyOverlayOpen())return;
    var ae=document.activeElement;if(ae&&(ae.id==="fbFind"||ae.id==="fbRepl"))return;
    e.preventDefault();closeTab(activeId);
  },true);
  document.addEventListener("mdocify:settings-hydrated",function(){ensureBar();renderTabs();});
  ensureBar();
})();
