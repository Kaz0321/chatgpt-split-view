const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs');
const Core=require('../extension/core.js'),P=require('../extension/persistence.js');
const source=fs.readFileSync(require.resolve('../extension/workspace.js'),'utf8');
const tick=()=>new Promise(r=>setImmediate(r));
function harness(){
 let serial=0;const data={},owners={},session={};let fail=false;
 const area=(d)=>({async get(k){return structuredClone(k===null?d:{[k]:d[k]})},async set(v){if(fail&&d===data)throw Error('quota');Object.assign(d,structuredClone(v));}});
 const storage={local:area(data),session:area(owners)},store=P.create(storage,()=>`generated-${++serial}`);
 const initial={schemaVersion:2,workspaceId:'legacy',enabled:true,savedAt:1,settings:{sidebarVisible:false},activeIndex:1,panes:[{id:'a',url:Core.ORIGIN+'/c/fixture001',title:'Alpha',visible:true,width:480,draft:'before',draftBackups:['older']},{id:'b',url:Core.ORIGIN+'/c/fixture002',title:'Beta',visible:true,folded:true,width:510},{id:'c',url:Core.ORIGIN+'/c/fixture003',title:'Gamma',visible:false,width:520}]};
 data[P.PREFIX+'legacy']=structuredClone(initial);session['cgww.v1.workspace']=JSON.stringify(initial);
 async function boot(){
  let reloads=0,confirmation=true;const ctx={CGWWCore:Core,document:{getElementById(){return null}},crypto:{randomUUID:()=>`generated-${++serial}`},location:{reload(){reloads++}},confirm:()=>confirmation,sessionStorage:{getItem:k=>session[k]||null,setItem:(k,v)=>session[k]=v},chrome:{storage,runtime:{sendMessage(m,cb){store.handle(m,1).then(cb).catch(()=>cb({ok:false}))}}}};ctx.window=ctx;ctx.top=ctx;ctx.addEventListener=()=>{};vm.createContext(ctx);
  vm.runInContext(source.replace('  void initialize();',`makeUI=()=>{};renderPane=applyColumnWidths=markActive=setEnabled=setStatus=()=>{};showSavedWorkspaces=async()=>{};menuControls={groupName:{value:'Research',focus(){}},groupSave:{},groupStatus:{}};globalThis.api={initialize,switchWorkspace,saveNamedGroup,captureDrafts,flushWorkspace,state:()=>state,id:()=>workspaceId,status:()=>menuControls.groupStatus.textContent};`),ctx);
  await ctx.api.initialize();await ctx.api.flushWorkspace();return {a:ctx.api,reloads:()=>reloads,cancel:()=>confirmation=false};
 }
 return {boot,data,session,store,fail:()=>fail=true,clearTabSession:()=>{delete session['cgww.v1.workspace']}};
}
test('real initialization + group save/read + reload preserves legacy drafts and protects original group',async()=>{
 const h=harness(),old=await h.boot();assert.equal(old.a.id(),'legacy');assert.equal(old.a.state().panes[0].draftBackups[0],'older');
 await old.a.saveNamedGroup();await old.a.saveNamedGroup();const items=(await h.store.handle({action:'list'},1)).items;
 assert.deepEqual(items.filter(x=>x.group).map(x=>x.title).sort(),['Research','Research (2)']);assert(items.some(x=>x.id==='legacy'&&!x.group));
 const group=items.find(x=>x.title==='Research');old.a.state().panes[0].draft='latest current input';
 assert.equal(await old.a.switchWorkspace(group.id,true),true);assert.equal(old.reloads(),1);assert.equal(h.data[P.PREFIX+'legacy'].panes[0].draft,'latest current input');
 const restored=await h.boot();assert.notEqual(restored.a.id(),group.id);assert.notEqual(restored.a.id(),'legacy');assert.equal(restored.a.state().panes[0].draft,'before');assert.equal(restored.a.state().panes[0].draftBackups[0],'older');assert.equal(restored.a.state().panes[1].folded,true);assert.equal(restored.a.state().panes[2].visible,false);assert.equal(restored.a.state().panes[1].width,510);assert.equal(restored.a.state().activeId,'b');
 restored.a.state().panes[0].draft='edit copy';restored.a.captureDrafts();await restored.a.flushWorkspace();assert.equal(h.data[P.GROUP_PREFIX+group.id].panes[0].draft,'before');
 h.clearTabSession();const restarted=await h.boot();assert.equal(restarted.a.state().panes[0].draft,'edit copy');assert.equal((await h.store.handle({action:'list'},1)).items.filter(x=>x.group).length,2);
});
test('group restore cancellation and real storage failure retain the live document and latest draft',async()=>{
 for(const failure of [false,true]){const h=harness(),live=await h.boot();await live.a.saveNamedGroup();const group=(await h.store.handle({action:'list'},1)).items.find(x=>x.group);const pane=live.a.state().panes[0];pane.draft='must retain';if(failure)h.fail();else live.cancel();assert.equal(await live.a.switchWorkspace(group.id,true),false);assert.equal(live.reloads(),0);assert.equal(live.a.state().panes[0],pane);assert.equal(pane.draft,'must retain');assert.equal(live.a.id(),'legacy');assert.equal(h.data[P.GROUP_PREFIX+group.id].panes[0].draft,'before');}
});

