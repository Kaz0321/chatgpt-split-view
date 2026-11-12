/* Bounded UI-only rename adapter. No endpoint calls, credentials or navigation. */
(function(root){
  'use strict';
  const ORIGIN='https://chatgpt.com';
  const busy=new WeakSet();
  function savedKey(value){
    try{
      const u=new URL(value,ORIGIN);
      if(u.origin!==ORIGIN||u.username||u.password)return null;
      const path=u.pathname.replace(/\/$/,'');
      if(!/^\/c\/[\w-]{6,}$/.test(path)&&
        !/^\/g\/g-p-[0-9a-f]{32}(?:-[\w-]+)?\/c\/[\w-]{6,}$/i.test(path))return null;
      let id=u.pathname.replace(/\/$/,'').split('/').pop();
      if(/^local-chatgpt/i.test(id))return null;
      if(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id))id=id.toLowerCase();
      return 'chat:'+id;
    }catch{return null;}
  }
  function visible(el){
    if(!el?.isConnected||el.hidden||!el.getClientRects().length)return false;
    const style=el.ownerDocument.defaultView.getComputedStyle(el);
    return style.visibility!=='hidden'&&style.display!=='none';
  }
  function text(el){
    const copy=el.cloneNode(true);
    for(const decoration of copy.querySelectorAll('svg,[aria-hidden="true"]'))decoration.remove();
    return (copy.textContent||'').trim();
  }
  function unique(items){if(items.length!==1)throw Error('ambiguous');return items[0];}
  function targetRow(doc,key){
    return unique(Array.from(doc.querySelectorAll('[role="group"][aria-label]')).filter(row=>{
      const keys=Array.from(row.querySelectorAll('a[href]')).filter(a=>a.closest('[role="group"][aria-label]')===row).map(a=>savedKey(a.href)).filter(Boolean);
      return keys.length===1&&keys[0]===key;
    }));
  }
  function triggerFor(doc,row,oldTitle){
    const own=Array.from(row.querySelectorAll('button[aria-haspopup="menu"]')).filter(visible);
    if(own.length)return unique(own);
    // A hidden sidebar is never revealed or clicked. The current conversation's
    // header title menu is accepted only when its text matches the exact row.
    if(row.getAttribute('aria-current')!=='page')throw Error('unavailable');
    return unique(Array.from(doc.querySelectorAll('header[data-app-shell-titlebar="true"][data-app-shell-header-layout="thread-edge-scroll"] button[aria-haspopup="menu"]'))
      .filter(b=>visible(b)&&text(b)===oldTitle));
  }
  async function rename({doc,key,title,valid,readTitle,delay=ms=>new Promise(resolve=>setTimeout(resolve,ms))}){
    let submitted=false,interrupted=false;
    const stop=event=>{if(event.isTrusted)interrupted=true;};
    function guard(){
      if(interrupted||!valid()||savedKey(doc.location.href)!==key)throw Error('context');
    }
    async function wait(find,attempts=40){
      for(let i=0;i<attempts;i++){
        guard();const result=find();if(result)return result;
        await delay(50);
      }
      throw Error('timeout');
    }
    if(!key||!title||typeof readTitle!=='function'||busy.has(doc))throw Error('unavailable');
    busy.add(doc);
    for(const event of ['pointerdown','keydown','input'])doc.addEventListener(event,stop,true);
    try{
      guard();const row=targetRow(doc,key),oldTitle=row.getAttribute('aria-label').trim();
      if(!oldTitle)throw Error('unavailable');
      if(oldTitle===title){if(readTitle()!==title)throw Error('unconfirmed');return;}
      const trigger=triggerFor(doc,row,oldTitle),triggerId=trigger.id;
      if(!triggerId||trigger.disabled)throw Error('unavailable');
      const previousMenus=new Set(Array.from(doc.querySelectorAll('[role="menu"]')).filter(visible));
      // Never borrow a menu/dialog that the user already opened.
      if(previousMenus.size||Array.from(doc.querySelectorAll('[role="dialog"]')).some(d=>visible(d)&&renameHeading(doc,d)))throw Error('busy');
      guard();trigger.focus();guard();
      trigger.dispatchEvent(new doc.defaultView.KeyboardEvent('keydown',{key:'Enter',code:'Enter',bubbles:true,cancelable:true}));
      const menu=await wait(()=>{
        const menus=Array.from(doc.querySelectorAll('[role="menu"]')).filter(m=>visible(m)&&!previousMenus.has(m)&&
          (m.getAttribute('aria-labelledby')||'').split(/\s+/).includes(triggerId));
        return menus.length?unique(menus):null;
      });
      const item=unique(Array.from(menu.querySelectorAll('[role="menuitem"]')).filter(el=>visible(el)&&
        ['Rename','名前を変更'].includes(text(el))&&el.getAttribute('aria-disabled')!=='true'));
      const previousDialogs=new Set(doc.querySelectorAll('[role="dialog"]'));
      guard();if(!visible(menu)||!visible(item))throw Error('context');item.click();
      const dialog=await wait(()=>{
        const dialogs=Array.from(doc.querySelectorAll('[role="dialog"]')).filter(d=>!previousDialogs.has(d)&&visible(d)&&renameHeading(doc,d));
        return dialogs.length?unique(dialogs):null;
      });
      const input=unique(Array.from(dialog.querySelectorAll('input')).filter(i=>visible(i)&&i.type==='text'&&
        ['Chat title','チャットのタイトル'].includes(i.getAttribute('aria-label'))&&!i.disabled&&!i.readOnly));
      const form=input.closest('form');
      if(!form||!dialog.contains(form)||input.value!==oldTitle)throw Error('context');
      const save=unique(Array.from(form.querySelectorAll('button[type="submit"]')).filter(b=>visible(b)&&['Save','保存'].includes(text(b))&&!b.disabled));
      guard();if(!visible(dialog)||!visible(input)||input.value!==oldTitle)throw Error('context');
      const set=Object.getOwnPropertyDescriptor(doc.defaultView.HTMLInputElement.prototype,'value')?.set;
      if(!set)throw Error('unavailable');
      // From the first native edit onward, an interrupted outcome is uncertain:
      // do not retry, cancel or overwrite a user-owned native editor.
      submitted=true;set.call(input,title);
      input.dispatchEvent(new doc.defaultView.Event('input',{bubbles:true}));
      input.dispatchEvent(new doc.defaultView.Event('change',{bubbles:true}));
      guard();if(!visible(dialog)||!visible(save)||save.disabled||input.value!==title||!form.contains(save))throw Error('context');
      save.click();
      await wait(()=>{
        if(visible(dialog))return false;
        try{return targetRow(doc,key).getAttribute('aria-label').trim()===title&&readTitle()===title;}catch{return false;}
      },160);
      guard();
    }catch(error){
      error.submitted=submitted;throw error;
    }finally{
      busy.delete(doc);
      for(const event of ['pointerdown','keydown','input'])doc.removeEventListener(event,stop,true);
    }
  }
  function renameHeading(doc,dialog){
    const ids=(dialog.getAttribute('aria-labelledby')||'').trim().split(/\s+/);
    if(ids.length!==1)return false;
    const heading=doc.getElementById(ids[0]);
    return heading&&dialog.contains(heading)&&['Rename chat','チャット名を変更'].includes(text(heading));
  }
  const api={savedKey,rename};
  if(typeof module!=='undefined'&&module.exports)module.exports=api;else root.CGWWTitleRename=api;
})(globalThis);
