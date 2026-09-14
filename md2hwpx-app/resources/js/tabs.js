/* ===== 탭(멀티 문서) — MDeautify 이식 =====
   여러 md를 탭으로 열어 두고 전환. 전역(__mdPath·__mdDir·__mdName·__fname·__drop·__imgFiles + 편집기 내용 + 저장 기준선)을
   '활성 문서 라이브 상태'로 두고 탭 전환 때만 스냅샷/복원. 세션: {id,path,dir,name,fname,text,baseline,drop,imgFiles,scroll}.
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

  function renderTabs(){
    ensureBar();if(!bar)return;
    if(!sessions.length){bar.hidden=true;bar.innerHTML="";return;}
    bar.hidden=false;bar.innerHTML="";
    sessions.forEach(function(s){
      var t=el("div","tab"+(s.id===activeId?" active":"")+(isDirty(s)?" dirty":""));
      t.setAttribute("data-id",s.id);t.title=s.path||s.name;
      var nm=el("span","tab-name");nm.textContent=s.name||"문서";
      var dot=el("span","tab-dot");dot.setAttribute("aria-hidden","true");
      var x=el("button","tab-x");x.type="button";x.title="닫기";x.setAttribute("aria-label","닫기");x.innerHTML="&#10005;";
      t.appendChild(nm);t.appendChild(dot);t.appendChild(x);
      t.addEventListener("mousedown",function(e){if(e.button===1){e.preventDefault();closeTab(s.id);}});
      t.addEventListener("click",function(e){if(e.target===x||x.contains(e.target)){e.stopPropagation();closeTab(s.id);return;}switchTo(s.id);});
      bar.appendChild(t);
    });
    var act=bar.querySelector(".tab.active");if(act&&act.scrollIntoView){try{act.scrollIntoView({inline:"nearest",block:"nearest"});}catch(e){}}
  }

  function snapshotActive(){
    if(activeId==null)return;var s=byId(activeId);if(!s)return;var t=ta();
    if(t)s.text=t.value;
    if(window.__getSaved)s.baseline=window.__getSaved();
    s.path=window.__mdPath||null;s.dir=window.__mdDir||null;
    s.name=window.__mdName||s.name;s.fname=window.__fname||s.fname;
    s.drop=window.__drop||{};s.imgFiles=window.__imgFiles||[];
    if(t)s.scroll=t.scrollTop;
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
    if(window.__renderFileBadge)window.__renderFileBadge();
  }
  function switchTo(id){if(id===activeId)return;snapshotActive();activeId=id;restore(byId(id));renderTabs();}

  /* 문서 열기/포커스: 진입점(openMd·drop·loadFile·startBlank)이 호출 */
  function openDoc(meta){
    meta=meta||{};snapshotActive();
    if(meta.path){var ex=findByPath(meta.path);if(ex){activeId=ex.id;restore(ex);renderTabs();return;}}   /* 이미 열림 → 포커스 */
    var s={id:seq++,path:meta.path||null,dir:meta.dir||null,name:meta.name||"document",fname:meta.fname||"document",text:meta.text||"",baseline:meta.text||"",drop:meta.drop||{},imgFiles:[],scroll:0};
    sessions.push(s);activeId=s.id;
    window.__mdPath=s.path;window.__mdDir=s.dir;window.__mdName=s.name;window.__fname=s.fname;window.__drop=s.drop;window.__imgFiles=[];
    document.body.classList.add("loaded");
    if(window.__relayoutPanes)window.__relayoutPanes();
    if(window.__setEditorText)window.__setEditorText(s.text);   /* 새 탭 로드(baseline clean, 미러·프리뷰 일괄) */
    if(window.__renderFileBadge)window.__renderFileBadge();
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
    if(isDirty(s)){
      var choice="discard";
      if(window.__confirmSave3){choice=await window.__confirmSave3({title:"저장하고 닫기",message:"'"+(s.name||"문서")+"'에 저장하지 않은 변경사항이 있어요.\n저장한 뒤 닫을까요?",saveText:"저장하고 닫기",discardText:"저장 안 함",cancelText:"취소"});}
      if(choice==="cancel")return;
      if(choice==="save"){
        if(id!==activeId){activeId=id;restore(s);renderTabs();}   /* 저장은 활성(라이브)에 대해서만 */
        var hadPath=!!window.__mdPath;if(window.__saveMd)await window.__saveMd();
        if(!hadPath&&!window.__mdPath)return;   /* 경로 없던 문서 저장 취소 → 닫기도 취소(유실 방지) */
        snapshotActive();
      }
    }
    var idx=-1;for(var i=0;i<sessions.length;i++)if(sessions[i].id===id){idx=i;break;}
    if(idx<0)return;var wasActive=(id===activeId);
    sessions.splice(idx,1);
    if(!sessions.length){clearToEmpty();renderTabs();return;}
    if(wasActive){var next=sessions[idx]||sessions[idx-1]||sessions[0];activeId=next.id;restore(next);}
    renderTabs();
  }

  var edTmr=null;
  window.__tabsOnEdit=function(){
    if(activeId==null)return;clearTimeout(edTmr);
    edTmr=setTimeout(function(){var s=byId(activeId);if(!s)return;var t=ta();var curDirty=t?(t.value!==(window.__getSaved?window.__getSaved():s.baseline)):isDirty(s);var chip=bar&&bar.querySelector('.tab[data-id="'+activeId+'"]');if(chip)chip.classList.toggle("dirty",!!curDirty);},120);
  };
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
