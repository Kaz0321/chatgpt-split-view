const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),Core=require('../extension/core.js');
function harness(){
 const requests=[],sessions=[],notices=[];let reloads=0,confirmed=true,n=0;
 const ctx={CGWWCore:Core,document:{getElementById(){return null;}},crypto:{randomUUID:()=>`new-${++n}`},confirm:()=>confirmed,location:{reload(){reloads++;}},sessionStorage:{setItem(k,v){sessions.push(JSON.parse(v));}},chrome:{runtime:{sendMessage(m,cb){requests.push({m,cb});}}}};ctx.window=ctx;ctx.top=ctx;vm.createContext(ctx);
 vm.runInContext(fs.readFileSync(require.resolve('../extension/workspace.js'),'utf8').replace('  void initialize();',`globalThis.api={safeSave,flushWorkspace,switchWorkspace,closePane,undoClose,restoreClosedPane,retryWorkspaceSave,get:()=>({state,pendingSnapshot,saveProblem,saveInFlight,lastClosed,closedPanes,restoringWorkspace}),set(panes){state={enabled:true,panes,activeId:panes[0]?.id};workspaceId='old';durableToken='token';},entries:paneNodes,history(p){closedPanes=p},expire(){lastClosed.expires=0},noToken(){durableToken=null}};setStatus=t=>notices.push(t);markActive=applyColumnWidths=syncOverlay=updateFallbackDock=syncPaneOrder=()=>{};renderPane=p=>paneNodes.set(p.id,{root:{},iframe:{}});` ).replace('setStatus=t=>notices.push(t);','setStatus=t=>globalThis.notify(t);'),Object.assign(ctx,{notify:t=>notices.push(t)}));
 ctx.api.set([{id:'a',url:Core.ORIGIN+'/c/fixture001',visible:true,width:480,draft:'keep',draftBackups:['older']}]);
 return {a:ctx.api,ctx,requests,sessions,notices,reloads:()=>reloads,cancel:()=>confirmed=false};
}
const tick=()=>new Promise(r=>setImmediate(r));
test('failed save retains newest in-flight edit and retries it without reverting',async()=>{
 const h=harness();h.a.safeSave();h.a.get().state.panes[0].draft='newest';h.a.safeSave();h.requests[0].cb({ok:false});await tick();
 assert.equal(h.a.get().pendingSnapshot.panes[0].draft,'newest');assert.equal(h.a.get().saveProblem,true);
 const retry=h.a.flushWorkspace();assert.equal(h.requests[1].m.snapshot.panes[0].draft,'newest');h.requests[1].cb({ok:true});assert.equal(await retry,true);assert.equal(h.a.get().pendingSnapshot,null);
 await h.a.flushWorkspace();h.a.get().state.panes[0].draft='later';h.a.safeSave();assert.equal(h.requests.length,3);h.requests[2].cb({ok:true});await tick();
});
test('switch cancellation leaves current session and documents untouched',async()=>{const h=harness();h.cancel();assert.equal(await h.a.switchWorkspace('target'),false);assert.equal(h.requests.length,0);assert.equal(h.sessions.length,0);assert.equal(h.reloads(),0);});
test('switch waits for save and keeps current workspace on failed save or missing target',async()=>{
 const h=harness();const attempt=h.a.switchWorkspace('target');h.requests[0].cb({ok:false});assert.equal(await attempt,false);assert.equal(h.reloads(),0);assert.equal(h.a.get().state.panes[0].draft,'keep');
 const again=h.a.switchWorkspace('target');h.requests[1].cb({ok:true});await tick();assert.equal(h.requests[2].m.action,'read');h.requests[2].cb({ok:true,snapshot:null});assert.equal(await again,false);assert.equal(h.reloads(),0);
});
test('switch captures edits during target read and only reloads after final successful save',async()=>{
 const h=harness();const attempt=h.a.switchWorkspace('target');h.requests[0].cb({ok:true});await tick();
 h.a.get().state.panes[0].draft='edited during read';h.requests[1].cb({ok:true,snapshot:{workspaceId:'target',panes:[]}});await tick();
 assert.equal(h.reloads(),0);assert.equal(h.requests[2].m.snapshot.panes[0].draft,'edited during read');h.requests[2].cb({ok:true});assert.equal(await attempt,true);assert.equal(h.reloads(),1);assert.equal(h.sessions.at(-1).workspaceId,'target');
});
test('close frees resource immediately; undo restores draft/backups/order but history stays metadata-only',()=>{
 const h=harness(),p=h.a.get().state.panes[0];let removed=false;h.a.entries.set(p.id,{root:{remove(){}},iframe:{remove(){removed=true;}}});h.a.closePane(p);assert(removed);assert.equal(h.a.entries.size,0);assert.equal(h.a.get().closedPanes[0].draft,undefined);
 h.a.undoClose();const restored=h.a.get().state.panes[0];assert.equal(restored.draft,'keep');assert.equal(restored.draftBackups[0],'older');assert.equal(restored.width,480);assert.equal(h.a.get().closedPanes.length,0);
});
test('expired undo does nothing and full history restore explains remedy without consuming history',()=>{
 const h=harness();h.a.closePane(h.a.get().state.panes[0]);h.a.expire();h.a.undoClose();assert.equal(h.a.get().state.panes.length,0);
 h.a.set(Array.from({length:200},(_,i)=>({id:'p'+i,url:null})));h.a.history([{id:'history',url:Core.ORIGIN+'/c/other001'}]);h.a.restoreClosedPane('history');assert.equal(h.a.get().closedPanes.length,1);assert(h.notices.at(-1).includes('200'));
});

test('missing storage callback times out, retains pending state and can reacquire a writer for retry',async()=>{
 const h=harness(),timers=[];h.ctx.setTimeout=fn=>{timers.push(fn);return timers.length;};h.ctx.clearTimeout=()=>{};
 h.a.safeSave();timers[0]();await tick();assert(h.a.get().saveProblem);assert(h.a.get().pendingSnapshot);
 const retry=h.a.retryWorkspaceSave();assert.equal(h.requests[1].m.action,'load');h.requests[1].cb({ok:true,id:'old',token:'fresh'});await tick();assert.equal(h.requests[2].m.token,'fresh');h.requests[2].cb({ok:true});assert.equal(await retry,true);assert.equal(h.a.get().pendingSnapshot,null);
});
test('new workspace saves old state first and uses a distinct empty workspace identifier',async()=>{
 const h=harness();const changing=h.a.switchWorkspace();h.requests[0].cb({ok:true});await tick();h.requests[1].cb({ok:true});assert.equal(await changing,true);assert.notEqual(h.sessions.at(-1).workspaceId,'old');assert.equal(h.sessions.at(-1).panes.length,0);assert.equal(h.requests[0].m.id,'old');
});
test('failed reload rolls session back to current workspace instead of leaving target selected',async()=>{
 const h=harness();h.ctx.location.reload=()=>{throw Error('interrupted')};const changing=h.a.switchWorkspace('target');h.requests[0].cb({ok:true});await tick();h.requests[1].cb({ok:true,snapshot:{workspaceId:'target',panes:[]}});await tick();h.requests[2].cb({ok:true});assert.equal(await changing,false);assert.equal(h.sessions.at(-1).workspaceId,'old');assert.equal(h.a.get().restoringWorkspace,false);
});

test('automatic restore notice appears only when durable workspace replaces an absent tab session',async()=>{
 for(const withSession of [false,true]){
  const snapshot={schemaVersion:2,workspaceId:'saved',enabled:false,panes:[],closedPanes:[],savedAt:10};
  const ctx={CGWWCore:Core,document:{getElementById(){return null;}},crypto:{randomUUID:()=> 'generated'},sessionStorage:{getItem:()=>withSession?JSON.stringify(snapshot):null,setItem(){}},chrome:{storage:{local:{get:async()=>({})},onChanged:{addListener(){}}},runtime:{sendMessage(m,cb){cb({ok:true,id:'saved',token:'writer',snapshot});},onMessage:{addListener(){}}}}};ctx.window=ctx;ctx.top=ctx;ctx.addEventListener=()=>{};vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(require.resolve('../extension/workspace.js'),'utf8').replace('  void initialize();',`makeUI=()=>{restoreBadge={};updateRecoveryUI()};renderPane=applyColumnWidths=markActive=()=>{};globalThis.api={initialize,hidden:()=>restoreBadge.hidden};`),ctx);
  await ctx.api.initialize();assert.equal(ctx.api.hidden(),withSession);
 }
});

test('named group restoration saves current input before merging and after merging without reload',async()=>{
 const h=harness();const restore=h.a.switchWorkspace('group-id',true);assert.equal(await h.a.switchWorkspace('group-id',true),false);assert.equal(h.requests.length,1);h.requests[0].cb({ok:true});await tick();assert.equal(h.requests[1].m.action,'readGroup');
 h.a.get().state.panes[0].draft='edited during group load';h.requests[1].cb({ok:true,snapshot:{workspaceId:'copy-id',panes:[]}});await tick();assert.equal(h.reloads(),0);assert.equal(h.requests[2].m.snapshot.panes[0].draft,'edited during group load');h.requests[2].cb({ok:true});await tick();assert.equal(h.requests[3].m.action,'save');h.requests[3].cb({ok:true});assert.equal(await restore,true);assert.equal(h.reloads(),0);assert.equal(h.sessions.at(-1).workspaceId,'old');
});
