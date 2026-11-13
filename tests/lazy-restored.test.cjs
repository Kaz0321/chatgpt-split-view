const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs');
const Core=require('../extension/core.js');
const source=fs.readFileSync(require.resolve('../extension/workspace.js'),'utf8');
const saved=(id,extra={})=>({id,url:Core.ORIGIN+'/c/fixture'+id,title:'Saved '+id,width:480,visible:true,folded:true,...extra});
async function harness(panes,enabled=true){
 let serial=0;const frames=[],writes=[];
 class Element{
  constructor(tag){this.tag=tag;this.children=[];this.style={};this.dataset={};this.classList={toggle(){},remove(){}};this.listeners={};if(tag==='iframe')frames.push(this);}
  get firstChild(){return this.children[0];}
  appendChild(e){this.children.push(e);return e;} replaceChildren(...items){this.children=items;}
  setAttribute(k,v){this[k]=v;} addEventListener(k,f){this.listeners[k]=f;} removeEventListener(){} focus(){} scrollIntoView(){} remove(){this.removed=true;}
 }
 const snapshot={schemaVersion:2,workspaceId:'fixture-workspace',enabled,panes,settings:{equalizeColumns:true},activeIndex:0};
 const context={URL,CGWWCore:Core,Element,document:{createElement:t=>new Element(t),getElementById(){return null;},querySelectorAll(){return [];}},crypto:{randomUUID:()=>`new-${++serial}`},sessionStorage:{getItem:()=>null,setItem:(k,v)=>writes.push(JSON.parse(v))},chrome:{storage:{local:{get:async()=>({})},onChanged:{addListener(){}}},runtime:{sendMessage(m,cb){cb(m.action==='load'?{ok:true,id:'fixture-workspace',token:'fixture-token',snapshot}:{ok:true});},onMessage:{addListener(){}}}},setInterval(){},addEventListener(){}};
 context.window=context;context.top=context;vm.createContext(context);
 vm.runInContext(source.replace('  void initialize();',`
 makeUI=()=>{panel={};scroller=document.createElement('div');scroller.clientWidth=1000;};
 updateGeometry=closeOverlay=startMasterWatch=ensureMasterSidebar=startNativeMenuWatch=stopNativeMenuWatch=stopMasterWatch=updateFallbackDock=syncOverlay=setStatus=attachPaneDrag=()=>{};
 globalThis.api={initialize,renderPane,setPaneFolded,setEnabled,selectConversation,restoreParkedPane,mergeGroupPanes,reorderPane,closePane,restoreClosedPane,undoClose,captureDrafts, get:()=>({state,paneNodes,closedPanes}),append(p){state.panes.push(p);renderPane(p);}};`),context);
 await context.api.initialize();return {a:context.api,frames,writes,p:id=>context.api.get().state.panes.find(p=>p.id===id),frame:id=>context.api.get().paneNodes.get(id)?.iframe};
}
test('restored folded panes build no iframe through initialization and repeated enabled renders; expand exactly once',async()=>{
 const h=await harness([saved('one'),saved('two',{folded:false})]);assert.equal(h.frames.length,1);assert.equal(h.frame('one'),undefined);
 const p=h.p('one');for(let i=0;i<3;i++){h.a.setEnabled(true,true);h.a.renderPane(p);}assert.equal(h.frames.length,1);
 h.a.setPaneFolded(p,false);const frame=h.frame('one');assert(frame);assert.equal(h.frames.length,2);frame.document={draft:'live',attachments:['fixture'],generating:true};
 for(let i=0;i<3;i++){h.a.setPaneFolded(p,true);h.a.setEnabled(false);h.a.setEnabled(true);h.a.setPaneFolded(p,false);h.a.selectConversation(p);}
 assert.equal(h.frame('one'),frame);assert.deepEqual(frame.document,{draft:'live',attachments:['fixture'],generating:true});assert.equal(h.frames.length,2);assert.equal(frame.removed,undefined);
});
test('disabled expand/refold keeps eligibility until a visible enabled expansion',async()=>{
 const h=await harness([saved('one')],false),p=h.p('one');h.a.setPaneFolded(p,false);h.a.setPaneFolded(p,true);h.a.setEnabled(true);assert.equal(h.frames.length,0);h.a.selectConversation(p);assert.equal(h.frames.length,1);
});
test('parked folded restore and reorder stay unloaded, selection loads without changing saved width or alias',async()=>{
 const h=await harness([saved('one',{visible:false,title:'Local alias',titleMode:'local'}),saved('two')]),p=h.p('one');h.a.restoreParkedPane(p);h.a.reorderPane(p.id,'two',true);assert.equal(h.frames.length,0);assert.equal(h.a.get().paneNodes.get('one').root.style.width,'32px');
 h.a.selectConversation(p);assert.equal(h.frames.length,1);assert.equal(p.width,480);assert.equal(p.title,'Local alias');assert.equal(p.titleMode,'local');
});
test('local, provisional, new, pending branches, source panes and saved drafts retain eager behavior',async()=>{
 const cases=[{url:Core.ORIGIN+'/local/localfixture?hostId=local'},{url:Core.ORIGIN+'/c/local-chatgpt%3A12345678-1234-1234-1234-123456789abc'},{url:Core.ORIGIN+'/',newChat:true},{draft:'unsent'},{draftBackups:['older']},{branchSource:'source',branchOrigin:Core.ORIGIN+'/c/fixturesource'}];
 const panes=[saved('source'),...cases.map((x,i)=>saved('case'+i,x))],h=await harness(panes);assert.equal(h.frames.length,panes.length);assert.equal(h.p('case3').draft,'unsent');assert.deepEqual(Array.from(h.p('case4').draftBackups),['older']);
});
test('ordinary newly added folded panes are not deferred and saved project conversations qualify',async()=>{
 const h=await harness([saved('project',{url:Core.ORIGIN+'/project/projectfixture/c/fixtureproject'})]);assert.equal(h.frames.length,0);h.a.append(saved('added'));assert.equal(h.frames.length,1);h.a.selectConversation(h.p('project'));assert.equal(h.frames.length,2);
});
test('group restore defers new folded panes, reuses live panes and resolves branch source exclusions before render',async()=>{
 const h=await harness([saved('live',{folded:false,draft:'current'})]),frame=h.frame('live');frame.document={attachments:['fixture'],generating:true};
 h.a.mergeGroupPanes({panes:[saved('old',{url:h.p('live').url,draft:'older'}),saved('new'),saved('source'),saved('branch',{branchSource:'source',branchOrigin:Core.ORIGIN+'/c/fixturesource'})],activeIndex:1});
 assert.equal(h.frame('new'),undefined);assert(h.frame('source'));assert(h.frame('branch'));assert.equal(h.frame('live'),frame);assert.equal(h.p('live').draft,'current');assert(h.p('live').draftBackups.includes('older'));assert.equal(frame.document.generating,true);
 const count=h.frames.length;h.a.selectConversation(h.p('new'));assert.equal(h.frames.length,count+1);
});
test('close deferred pane and history restoration creates a fresh expanded frame; loading metadata never persists',async()=>{
 const h=await harness([saved('one')]);h.a.captureDrafts();assert.equal(JSON.stringify(h.writes).includes('deferred'),false);h.a.closePane(h.p('one'));assert.equal(h.frames.length,0);h.a.restoreClosedPane(h.a.get().closedPanes[0].id);assert.equal(h.frames.length,1);
});

test('a new group branch wakes an existing deferred source even when omitted from the incoming group',async()=>{
 const h=await harness([saved('source')]);assert.equal(h.frames.length,0);
 h.a.mergeGroupPanes({panes:[saved('branch',{branchSource:'source',branchOrigin:Core.ORIGIN+'/c/fixturesource'})]});
 assert(h.frame('source'));assert(h.frame('branch'));assert.equal(h.frames.length,2);
});

test('explicit undoClose retains folded state but loads a fresh frame as before',async()=>{
 const h=await harness([saved('one')]);h.a.closePane(h.p('one'));h.a.undoClose();
 const restored=h.a.get().state.panes[0];assert.equal(restored.folded,true);assert.equal(restored.visible,true);assert.equal(h.frames.length,1);
 h.a.setPaneFolded(restored,false);assert.equal(h.frames.length,1);
});
test('current project route and slugged project route defer until selected',async()=>{
 for(const slug of ['', '-fixture']){
  const url=Core.ORIGIN+'/g/g-p-0123456789abcdef0123456789abcdef'+slug+'/c/fixtureproject';
  const h=await harness([saved('project',{url})]);assert.equal(h.frames.length,0);h.a.selectConversation(h.p('project'));assert.equal(h.frames.length,1);assert.equal(h.frame('project').src,url);
 }
});
