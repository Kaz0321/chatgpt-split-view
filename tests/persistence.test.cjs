const test=require('node:test'),assert=require('node:assert/strict'),P=require('../extension/persistence.js'),Core=require('../extension/core.js');
function area(data={}){return {data,async get(key){return structuredClone(key===null?data:{[key]:data[key]});},async set(value){Object.assign(data,structuredClone(value));}};}
function harness(){let n=0;const storage={local:area(),session:area()},newId=()=>`id-${++n}`;return {storage,newId,store:P.create(storage,newId)};}
const raw=()=>({settings:{sidebarWidth:390,sidebarLocked:true,sidebarVisible:false,contentPadding:6},enabled:true,activeIndex:1,panes:[{id:'a',url:Core.ORIGIN+'/c/fixture001',title:'First',width:450,visible:false,draft:'unsent'},{id:'b',url:Core.ORIGIN+'/',newChat:true,title:'Second',width:600,visible:true}],closedPanes:[{url:Core.ORIGIN+'/c/closed001',title:'Closed',width:500,draft:'must-not-save'}]});
async function save(h,claim,data=raw(),sequence=1,tab=1){return h.store.handle({action:'save',id:claim.id,token:claim.token,sequence,snapshot:data},tab);}
test('browser restart with empty session storage restores ordered panes, selection, settings, drafts and closed metadata',async()=>{
 const h=harness(),c=await h.store.handle({action:'load'},1);await save(h,c);h.storage.session=area();h.store=P.create(h.storage,h.newId);
 const list=await h.store.handle({action:'list'},20);assert.equal(list.items.length,1);assert.equal(JSON.stringify(list).includes('unsent'),false);
 const r=await h.store.handle({action:'load'},20);assert.equal(r.id,c.id);assert.equal(r.snapshot.activeIndex,1);assert.deepEqual(r.snapshot.panes.map(p=>[p.id,p.visible,p.width]),[['a',false,450],['b',true,600]]);assert.equal(r.snapshot.panes[0].draft,'unsent');assert.equal(r.snapshot.settings.sidebarLocked,true);assert.equal(r.snapshot.settings.sidebarVisible,false);assert.equal(r.snapshot.closedPanes[0].draft,undefined);assert.equal(r.snapshot.panes.some(p=>p.title==='Closed'),false);
});
test('automatic restore isolates host pages and concurrently opened tabs claim different saved workspaces',async()=>{
 const h=harness(),hostA=Core.ORIGIN+'/c/hostaaaa',hostB=Core.ORIGIN+'/c/hostbbbb';
 const a=await h.store.handle({action:'load'},1,hostA);await save(h,a);const b=await h.store.handle({action:'load'},2,hostB);await save(h,b,raw(),1,2);const c=await h.store.handle({action:'load'},3,hostA);await save(h,c,raw(),1,3);
 h.storage.session=area();h.store=P.create(h.storage,h.newId);
 const [one,two,other]=await Promise.all([h.store.handle({action:'load'},11,hostA),h.store.handle({action:'load'},12,hostA),h.store.handle({action:'load'},13,hostB)]);
 assert.notEqual(one.id,two.id);assert.deepEqual(new Set([one.id,two.id]),new Set([a.id,c.id]));assert.equal(other.id,b.id);
 const fresh=await h.store.handle({action:'load'},14,Core.ORIGIN+'/c/hostcccc');assert.equal(fresh.snapshot,null);
});
test('duplicate browser tab receives isolated ID and does not overwrite original',async()=>{const h=harness(),a=await h.store.handle({action:'load'},1);await save(h,a);const b=await h.store.handle({action:'load',id:a.id},2);assert.notEqual(a.id,b.id);assert.equal(b.snapshot.panes.length,2);const changed=raw();changed.panes=[];await save(h,b,changed,1,2);assert.equal(h.storage.local.data[P.PREFIX+a.id].panes.length,2);assert.equal(h.storage.local.data[P.PREFIX+b.id].panes.length,0);});
test('fresh home page restores previous conversation workspace but does not mix host selectors',async()=>{const h=harness(),a=await h.store.handle({action:'load'},1,Core.ORIGIN+'/c/fixture001');await save(h,a);await h.store.release(1);const local=await h.store.handle({action:'load'},2,Core.ORIGIN+'/local/fixture001?hostId=local');assert.equal(local.snapshot,null);const home=await h.store.handle({action:'load'},3);assert.equal(home.id,a.id);});
test('reload token rejects writes from prior document and sequences reject out-of-order writes',async()=>{const h=harness(),a=await h.store.handle({action:'load'},1);await save(h,a);const b=await h.store.handle({action:'load',id:a.id},1);await assert.rejects(save(h,a,raw(),2),/Stale/);await save(h,b,raw(),2);await assert.rejects(save(h,b,raw(),1),/Stale/);});
test('worker restart retains ownership and token through storage.session',async()=>{const h=harness(),a=await h.store.handle({action:'load'},1);await save(h,a);h.store=P.create(h.storage,h.newId);await save(h,a,raw(),2);const b=await h.store.handle({action:'load',id:a.id},2);assert.notEqual(a.id,b.id);});
test('queued delayed saves finish in order and keep the newest state',async()=>{const h=harness(),a=await h.store.handle({action:'load'},1);let release;const original=h.storage.local.set;h.storage.local.set=async v=>{await new Promise(r=>release=r);h.storage.local.set=original;await original.call(h.storage.local,v);};const first=save(h,a);await new Promise(r=>setImmediate(r));const next=raw();next.panes.reverse();const last=save(h,a,next,2);release();await Promise.all([first,last]);assert.equal(h.storage.local.data[P.PREFIX+a.id].panes[0].id,'b');});
test('failed writes preserve previous durable snapshot and queue remains usable',async()=>{const h=harness(),a=await h.store.handle({action:'load'},1);await save(h,a);const original=h.storage.local.set;h.storage.local.set=async()=>{throw Error('quota');};await assert.rejects(save(h,a,{...raw(),panes:[]},2),/quota/);assert.equal(h.storage.local.data[P.PREFIX+a.id].panes.length,2);h.storage.local.set=original;await save(h,a,raw(),3);});
test('closed tab releases ownership without deleting persistent history',async()=>{const h=harness(),a=await h.store.handle({action:'load'},1);await save(h,a);await h.store.release(1);const b=await h.store.handle({action:'load',id:a.id},2);assert.equal(b.id,a.id);assert.equal(b.snapshot.closedPanes.length,1);});

test('initialization awaits durable restore, suppresses intermediate saves and ignores duplicate initialize',async()=>{
 const vm=require('node:vm'),fs=require('node:fs');let release,loads=0,renders=0;const writes=[],sessionWrites=[];
 const snapshot={...raw(),workspaceId:'saved',schemaVersion:2,savedAt:10};
 const ctx={CGWWCore:Core,document:{getElementById(){return null;}},crypto:{randomUUID:()=>`pane-${++renders}`},sessionStorage:{getItem(){return JSON.stringify({...snapshot,savedAt:1,panes:[]});},setItem(k,v){sessionWrites.push(JSON.parse(v));}},chrome:{runtime:{sendMessage(m,cb){if(m.action==='load'){loads++;release=()=>cb({ok:true,id:'saved',token:'token',snapshot});}else{writes.push(m);cb({ok:true});}},onMessage:{addListener(){}}},storage:{local:{get:async()=>({})},onChanged:{addListener(){}}}}};ctx.window=ctx;ctx.top=ctx;ctx.addEventListener=()=>{};
 vm.createContext(ctx);let source=fs.readFileSync(require.resolve('../extension/workspace.js'),'utf8');source=source.replace('  void initialize();',`makeUI=()=>safeSave();renderPane=()=>safeSave();applyColumnWidths=()=>{};markActive=()=>safeSave();setEnabled=()=>safeSave();globalThis.api={initialize,state:()=>state};`);vm.runInContext(source,ctx);
 const first=ctx.api.initialize();await ctx.api.initialize();await new Promise(r=>setImmediate(r));assert.equal(loads,1);assert.equal(writes.length,0);assert.equal(sessionWrites.length,0);release();await first;assert.equal(ctx.api.state().panes.length,2);assert.equal(ctx.api.state().activeId,'b');assert.equal(writes.length,1);assert.equal(writes[0].snapshot.panes.length,2);await ctx.api.initialize();assert.equal(loads,1);
});

test('named groups preserve full snapshots, suffix duplicate names and never replace the current workspace',async()=>{
 const h=harness(),c=await h.store.handle({action:'load'},1);await save(h,c);const data=raw();data.panes[0].folded=true;data.panes[0].draftBackups=['older'];
 const request={action:'saveGroup',id:c.id,token:c.token,name:'  調査  ',snapshot:data};
 const a=await h.store.handle(request,1),b=await h.store.handle({...request,name:'調査'},1);
 assert.equal(a.name,'調査');assert.equal(b.name,'調査 (2)');assert.notEqual(a.id,b.id);assert.equal(h.storage.local.data[P.PREFIX+c.id].panes[0].folded,undefined);
 const list=await h.store.handle({action:'list'},1);assert.equal(list.items.filter(x=>x.group).length,2);assert.equal(list.items.filter(x=>!x.group).length,1);assert.equal(JSON.stringify(list).includes('older'),false);
 const restored=await h.store.handle({action:'readGroup',id:a.id},1);assert.notEqual(restored.snapshot.workspaceId,a.id);assert.equal(restored.snapshot.panes[0].draft,'unsent');assert.equal(restored.snapshot.panes[0].draftBackups[0],'older');assert.equal(restored.snapshot.panes[0].folded,true);assert.equal(restored.snapshot.panes[0].visible,false);
 const copy=await h.store.handle({action:'load',id:restored.snapshot.workspaceId},2);await save(h,copy,{...restored.snapshot,panes:[]},1,2);assert.equal(h.storage.local.data[P.GROUP_PREFIX+a.id].panes.length,2);
 h.storage.session=area();h.store=P.create(h.storage,h.newId);assert.equal((await h.store.handle({action:'list'},3)).items.filter(x=>x.group).length,2);
});
test('group validation and failed storage leave previous groups and live work intact',async()=>{
 const h=harness(),c=await h.store.handle({action:'load'},1);await save(h,c);const req={action:'saveGroup',id:c.id,token:c.token,name:'work',snapshot:raw()};
 for(const change of [{name:''},{name:' '.repeat(5)},{name:'x'.repeat(101)},{token:'stale'}])await assert.rejects(h.store.handle({...req,...change},1));
 const before=structuredClone(h.storage.local.data);h.storage.local.set=async()=>{throw Error('quota')};await assert.rejects(h.store.handle(req,1),/quota/);assert.deepEqual(h.storage.local.data,before);
 assert.equal((await h.store.handle({action:'readGroup',id:'missing'},1)).snapshot,null);
});
