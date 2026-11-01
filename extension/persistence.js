/* Extension-local durable workspaces. Serialized claims reject stale documents. */
(function(root){
  'use strict';
  const Core=root.CGWWCore||(typeof require==='function'?require('./core.js'):null);
  const PREFIX='cgww.workspace.',OWNERS='cgww.workspaceOwners';
  const validId=id=>typeof id==='string'&&/^[a-zA-Z0-9_-]{1,100}$/.test(id);
  const hostIdentity=value=>{try{const url=new URL(value);return url.origin+'|'+(url.searchParams.get('hostId')||'');}catch{return null;}};
  function snapshot(raw,id,newId){
    if(!raw||!Array.isArray(raw.panes))throw Error('Invalid workspace');
    return {schemaVersion:2,workspaceId:id,savedAt:Date.now(),settings:Core.normalizeSettings(raw.settings),enabled:raw.enabled===true,
      panes:Core.restoreWorkspacePanes(raw.panes,newId),closedPanes:Core.normalizeSessionPanes(raw.closedPanes).filter(p=>p.url).map(({url,title,width,newChat,autoWidth})=>({url,title,width,...(newChat?{newChat:true}:{}),...(typeof autoWidth==='boolean'?{autoWidth}:{})})),
      activeIndex:Number.isInteger(raw.activeIndex)?raw.activeIndex:-1,activeUrl:Core.chatUrl(raw.activeUrl),
      overlayPosition:Number.isFinite(raw.overlayPosition?.x)&&Number.isFinite(raw.overlayPosition?.y)?{x:raw.overlayPosition.x,y:raw.overlayPosition.y}:null};
  }
  function create(storage,newId=()=>crypto.randomUUID()){
    let queue=Promise.resolve();
    async function run(message,tabId,hostUrl){
      const owners=(await storage.session.get(OWNERS))[OWNERS]||{};
      if(message.action==='load'){
        let id=validId(message.id)?message.id:null;
        if(!id){
          const all=await storage.local.get(null),claimed=new Set(Object.entries(owners).filter(([tab])=>Number(tab)!==tabId).map(([,owner])=>owner.id));
          const previous=Object.entries(all).filter(([key,value])=>key.startsWith(PREFIX)&&hostIdentity(value?.hostUrl)===hostIdentity(hostUrl)&&Array.isArray(value?.panes)&&!claimed.has(value.workspaceId)).map(([,value])=>value).sort((a,b)=>Number(b.hostUrl===hostUrl)-Number(a.hostUrl===hostUrl)||(b.savedAt||0)-(a.savedAt||0))[0];
          id=previous?.workspaceId||newId();
        }
        const saved=(await storage.local.get(PREFIX+id))[PREFIX+id]||null;
        if(Object.entries(owners).some(([tab,owner])=>Number(tab)!==tabId&&owner.id===id))id=newId();
        const token=newId();owners[tabId]={id,token,sequence:0,hostUrl};await storage.session.set({[OWNERS]:owners});
        return {ok:true,id,token,snapshot:saved?{...saved,workspaceId:id}:null};
      }
      if(message.action==='list'){
        const all=await storage.local.get(null);
        return {ok:true,items:Object.entries(all).filter(([key,value])=>key.startsWith(PREFIX)&&Array.isArray(value?.panes)).map(([,s])=>({id:s.workspaceId,title:s.panes[0]?.title||'保存した作業',count:s.panes.length,savedAt:s.savedAt||0})).sort((a,b)=>b.savedAt-a.savedAt)};
      }
      if(message.action==='read'){
        if(!validId(message.id))throw Error('Invalid workspace ID');
        return {ok:true,snapshot:(await storage.local.get(PREFIX+message.id))[PREFIX+message.id]||null};
      }
      if(message.action==='save'){
        const owner=owners[tabId];
        if(!owner||owner.token!==message.token||owner.id!==message.id||!Number.isInteger(message.sequence)||message.sequence<=owner.sequence)throw Error('Stale workspace writer');
        const saved={...snapshot(message.snapshot,owner.id,newId),hostUrl:owner.hostUrl};
        await storage.local.set({[PREFIX+owner.id]:saved});
        owner.sequence=message.sequence;await storage.session.set({[OWNERS]:owners});return {ok:true};
      }
      throw Error('Unknown workspace action');
    }
    return {handle(message,tabId,hostUrl=Core.ORIGIN+'/'){const task=queue.then(()=>run(message,tabId,hostUrl));queue=task.catch(()=>{});return task;},release(tabId){const task=queue.then(async()=>{const owners=(await storage.session.get(OWNERS))[OWNERS]||{};delete owners[tabId];await storage.session.set({[OWNERS]:owners});});queue=task.catch(()=>{});return task;}};
  }
  const api={create,snapshot,PREFIX,OWNERS};if(typeof module!=='undefined'&&module.exports)module.exports=api;else root.CGWWPersistence=api;
})(globalThis);
