/* Local text-only composer recovery. Never reads messages, files or attachments. */
(function(root){
  'use strict';
  function composer(doc){
    const el=doc?.querySelector?.('#prompt-textarea');
    if(el&&(el.tagName==='TEXTAREA'||el.isContentEditable===true))return el;
    // Current ChatGPT also uses an id-less ProseMirror textbox. Ambiguous pages
    // stay untouched; exclude message content and navigation from the fallback.
    const candidates=Array.from(doc?.querySelectorAll?.('.ProseMirror[role="textbox"][contenteditable="true"]')||[])
      .filter(e=>!e.closest?.('[data-message-author-role],pre,table,aside,nav'));
    return candidates.length===1?candidates[0]:null;
  }
  function richText(node){
    if(node.nodeType===3)return node.nodeValue||'';
    if(node.tagName==='BR')return '\n';
    const children=Array.from(node.childNodes||[]);
    if(children.length===1&&children[0].tagName==='BR')return '';
    let result='',previousBlock=false;
    children.forEach((child,i)=>{
      const block=/^(P|DIV|LI|H[1-6]|BLOCKQUOTE)$/.test(child.tagName||'');
      if(i&&(block||previousBlock))result+='\n';
      result+=richText(child);previousBlock=block;
    });
    return result;
  }
  function text(el){return el.tagName==='TEXTAREA'?el.value:(el.childNodes?richText(el):(el.textContent===''?'':(el.innerText??el.textContent??'')));}
  function restore(el,value){
    if(!value)return true;
    const doc=el.ownerDocument,win=doc.defaultView;
    if(el.tagName==='TEXTAREA'){
      const setter=Object.getOwnPropertyDescriptor(win.HTMLTextAreaElement.prototype,'value')?.set;
      if(!setter)return false;
      setter.call(el,value);
      el.dispatchEvent(new win.Event('input',{bubbles:true}));
      return text(el)===value;
    }
    // Browser editing participates in the editor's normal input/mutation path.
    // Do not replace rich-editor HTML or overwrite an already populated composer.
    const previous=doc.activeElement;
    el.focus();
    let ok=false;
    try{ok=doc.execCommand('insertText',false,value)&&text(el)===value;}
    finally{if(previous&&previous!==el)previous.focus?.();}
    return ok;
  }
  function connect(doc,pane,save,report=()=>{},getRouteKey=()=>null){
    let done=false,conflict=false,restoring=false,current=null,ignored=null,routeKey=getRouteKey();
    const navigation=()=>{
      const next=getRouteKey();if(next===routeKey)return;
      routeKey=next;
      // Cached text must never be injected into a different route's composer.
      // Ignore the old composer until it is replaced or the user edits it.
      if(pane.draft)pane.draftBackups=[...new Set([...(pane.draftBackups||[]),pane.draft])];
      delete pane.draft;ignored=composer(doc);current=ignored;done=true;conflict=false;
    };
    const attempt=()=>{
      navigation();
      const el=composer(doc);if(routeKey===undefined||!el||el===ignored)return;
      ignored=null;
      if(current!==el){current=el;done=false;conflict=false;}
      if(done)return;
      if(!pane.draft){done=true;return;}
      if(text(el)){
        done=true;conflict=text(el)!==pane.draft;
        if(conflict){pane.draftBackups=[...new Set([...(pane.draftBackups||[]),pane.draft])];pane.draft=text(el);save();}
        if(conflict)report('既存の入力を上書きせず、保存した下書きを保持しています。');
        return;
      }
      restoring=true;
      try{done=restore(el,pane.draft);if(!done){done=true;conflict=true;report('この入力欄へ自動復元できません。保存した下書きは設定メニューで確認できます。');}}
      catch{done=true;conflict=true;report('下書きの自動復元に失敗しました。保存した下書きは設定メニューで確認できます。');}
      finally{restoring=false;}
      if(conflict){pane.draftBackups=[...new Set([...(pane.draftBackups||[]),pane.draft].filter(Boolean))];pane.draft=text(el);save();}
    };
    const capture=()=>{
      attempt();
      const el=composer(doc);
      if(routeKey===undefined||!el||el===ignored||restoring||!done)return;
      if(conflict&&pane.draft&&text(el)!==pane.draft)pane.draftBackups=[...new Set([...(pane.draftBackups||[]),pane.draft])];
      pane.draft=text(el);save();
    };
    const input=event=>{
      navigation();
      const el=composer(doc);if(routeKey===undefined||!el||restoring||!(event.target===el||el.contains?.(event.target)))return;
      if(conflict&&pane.draft&&text(el)!==pane.draft)pane.draftBackups=[...new Set([...(pane.draftBackups||[]),pane.draft])];
      ignored=null;current=el;done=true;conflict=false;pane.draft=text(el);save();
    };
    doc.addEventListener('input',input,true);
    const win=doc.defaultView;win.addEventListener('pagehide',capture);
    attempt();
    return {attempt,capture,navigation,dispose(){doc.removeEventListener('input',input,true);win.removeEventListener('pagehide',capture);}};
  }
  const api={composer,text,restore,connect};
  if(typeof module!=='undefined'&&module.exports)module.exports=api;else root.CGWWDrafts=api;
})(globalThis);
