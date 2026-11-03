/* Metadata-only window handoffs. Never close either document automatically. */
(function(root){
  'use strict';
  const Core=root.CGWWCore||(typeof require==='function'?require('./core.js'):null);
  const KEY='cgww.detachedWindows',LIVE='cgww.detachedLive';
  const valid=s=>typeof s==='string'&&/^[a-zA-Z0-9_-]{1,100}$/.test(s);
  function create(chrome,newId=()=>crypto.randomUUID()){
    let queue=Promise.resolve();
    async function run(m,s){
      if(!s?.tab?.id||s.frameId!==0||!s.url?.startsWith(Core.ORIGIN+'/'))throw Error('許可されていない操作元です。');
      const records=(await chrome.storage.local.get(KEY))[KEY]||{};
      const live=(await chrome.storage.session.get(LIVE))[LIVE]||{};
      const owners=(await chrome.storage.session.get('cgww.workspaceOwners'))['cgww.workspaceOwners']||{};
      const focus=async id=>{const tab=await chrome.tabs.update(id,{active:true});await chrome.windows.update(tab.windowId,{focused:true});};
      if(m.action==='detach'){
        const url=Core.chatUrl(m.url);
        if(!url||!valid(m.workspaceId)||owners[s.tab.id]?.id!==m.workspaceId)throw Error('保存済みの会話を選んでください。');
        const existing=Object.entries(records).find(([,r])=>r.workspaceId===m.workspaceId&&Core.conversationKey(r.url)===Core.conversationKey(url));
        if(existing&&live[existing[0]]){
          try{const reply=await chrome.tabs.sendMessage(live[existing[0]],{type:'CGWW_DETACHED_PROBE',token:existing[0]});if(reply?.ok){await focus(live[existing[0]]);return {ok:true};}}catch{/* Closed or navigated: source is still retained. */}
        }
        if(existing?.[1].pending)throw Error('前回のウィンドウ作成結果を確認できません。元の列を保持しています。分離先が開いているか確認してください。');
        if(!existing&&Object.keys(records).length>=200)throw Error('分離記録の上限です。元の列は保持しています。');
        const token=existing?.[0]||newId();
        records[token]={workspaceId:m.workspaceId,url,title:Core.normalizeTitle(m.title),sourceUrl:Core.chatUrl(s.url)||Core.ORIGIN+'/',pending:true};
        await chrome.storage.local.set({[KEY]:records});
        let opened;
        try{opened=await chrome.windows.create({url:url+'#cgww-detached='+token,type:'normal',focused:true});}
        catch(e){records[token].pending=false;await chrome.storage.local.set({[KEY]:records});throw e;}
        if(!opened?.tabs?.[0]?.id)throw Error('作成結果を確認できません。元の列を保持しています。');
        live[token]=opened.tabs[0].id;await chrome.storage.session.set({[LIVE]:live});
        records[token].pending=false;await chrome.storage.local.set({[KEY]:records});
        return {ok:true};
      }
      if(!valid(m.token)||!records[m.token])throw Error('分離元の記録が見つかりません。現在の画面を保持しています。');
      const r=records[m.token];
      if(m.action==='source')return {ok:true,workspaceId:r.workspaceId};
      if(Core.conversationKey(s.url)!==Core.conversationKey(r.url))throw Error('分離した会話と現在のURLが異なります。現在の画面を保持しています。');
      live[m.token]=s.tab.id;await chrome.storage.session.set({[LIVE]:live});
      if(m.action==='identify'){r.pending=false;await chrome.storage.local.set({[KEY]:records});return {ok:true};}
      const source=Object.entries(owners).find(([id,o])=>Number(id)!==s.tab.id&&o.id===r.workspaceId);
      if(m.action==='integrate'){
        if(!source)throw Error('元画面がありません。「元の作業を開く」で復元後、もう一度統合してください。');
        const reply=await chrome.tabs.sendMessage(Number(source[0]),{type:'CGWW_INTEGRATE',workspaceId:r.workspaceId,url:r.url,title:r.title});
        if(!reply?.ok)throw Error(reply?.error||'元画面に統合できませんでした。両方の画面を保持しています。');
        await focus(Number(source[0]));return {ok:true};
      }
      if(m.action==='reopen'){
        if(source){await focus(Number(source[0]));return {ok:true};}
        if(live['source:'+m.token]){try{await focus(live['source:'+m.token]);return {ok:true};}catch{/* Previously opened source was closed. */}}
        const saved=(await chrome.storage.local.get('cgww.workspace.'+r.workspaceId))['cgww.workspace.'+r.workspaceId];
        if(!saved)throw Error('元の作業の保存が見つかりません。現在の画面を保持しています。');
        const opened=await chrome.windows.create({url:r.sourceUrl+'#cgww-source='+m.token,type:'normal',focused:true});
        if(opened?.tabs?.[0]?.id){live['source:'+m.token]=opened.tabs[0].id;await chrome.storage.session.set({[LIVE]:live});}return {ok:true};
      }
      throw Error('未対応の操作です。');
    }
    return {handle(m,s){const task=queue.then(()=>run(m,s));queue=task.catch(()=>{});return task;}};
  }
  const api={create};if(typeof module!=='undefined'&&module.exports)module.exports=api;else root.CGWWWindows=api;
})(globalThis);
