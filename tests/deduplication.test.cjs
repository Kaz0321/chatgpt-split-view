const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const C=require('../extension/core.js');
const base=C.ORIGIN;
function harness(panes){
 let next=0;const context={URL,console,crypto:{randomUUID:()=>`new-${++next}`},document:{getElementById(){return null;}},CGWWCore:C,confirm(){throw Error('Existing conversation must not prompt');}};
 context.window=context;context.top=context;vm.createContext(context);
 vm.runInContext(fs.readFileSync(require.resolve('../extension/workspace.js'),'utf8').replace('  void initialize();',`globalThis.api={addPane,assignToActive,restoreClosedPane,findConversation,get:()=>state,entries:()=>paneNodes,history:()=>closedPanes,init(panes){state={enabled:true,panes,activeId:null};for(const p of panes)paneNodes.set(p.id,{iframe:{draft:'keep'},root:{scrollIntoView(){}}});renderPane=p=>{if(!paneNodes.has(p.id))paneNodes.set(p.id,{iframe:{},root:{}})};markActive=applyColumnWidths=safeSave=syncOverlay=updateFallbackDock=setStatus=()=>{};}};`),context);
 context.api.init(panes);return context.api;
}
test('conversation identity handles aliases, query, trailing slash and UUID case but not distinct or local threads',()=>{
 const id='ABCDEF12-1234-5678-9ABC-ABCDEF123456';
 const urls=[`/c/${id}/?model=x#part`,`/g/g-project/c/${id.toLowerCase()}`,`/project/project123/c/${id}`];
 assert.equal(new Set(urls.map(C.conversationKey)).size,1);
 assert.notEqual(C.conversationKey('/local/'+id),C.conversationKey(urls[0]));
 assert.equal(C.conversationKey('/local/thread123?hostId=local'),C.conversationKey('/local/thread123'));
 for(const u of ['/',base+'/?noauth_recent_chat_failed=true','https://evil.test/c/thread123'])assert.equal(C.conversationKey(u),null);
});
test('all incoming routes reuse parked conversation before blank filling and forced addition',()=>{
 const p={id:'a',url:base+'/c/thread123',visible:false,width:480,draft:'text'},blank={id:'b',url:null,visible:true};
 const a=harness([p,blank]),frame=a.entries().get('a').iframe;
 for(const force of [false,true]){a.assignToActive('/g/g-project/c/thread123/?x=1','other',force);a.addPane('/c/thread123','other',force);}
 assert.equal(a.get().panes.length,2);assert.equal(blank.url,null);assert.equal(p.visible,true);assert.equal(p.width,480);assert.equal(a.get().activeId,'a');assert.equal(a.entries().get('a').iframe,frame);assert.equal(frame.draft,'keep');
});
test('history reopening an already open alias consumes history and selects existing even at limit',()=>{
 const panes=Array.from({length:200},(_,i)=>({id:'p'+i,url:base+'/c/thread'+i,visible:false}));const a=harness(panes);
 a.history().push({id:'closed',url:base+'/project/project123/c/thread0'});a.restoreClosedPane('closed');
 assert.equal(a.get().panes.length,200);assert.equal(a.history().length,0);assert.equal(a.get().activeId,'p0');
});
test('new draft that acquired a URL is reused before asynchronous location synchronization',()=>{
 const p={id:'draft',url:base+'/',newChat:true,visible:true};const a=harness([p]);a.entries().get('draft').iframe.contentWindow={location:{href:base+'/c/thread123'}};
 a.assignToActive('/c/thread123','same');assert.equal(a.get().panes.length,1);assert.equal(p.newChat,undefined);assert.equal(a.get().activeId,'draft');
});
test('restoration merges aliases, preserves order and width, maps selected duplicate, and is idempotent',()=>{
 let n=0;const raw={activeIndex:2,panes:[{id:'first',url:base+'/c/thread123',width:420,visible:false},{id:'blank',url:null},{id:'copy',url:base+'/g/g-project/c/thread123',width:600,visible:true,draft:'safe'}]};
 const panes=C.restoreWorkspacePanes(raw.panes,()=>`n${++n}`);assert.equal(panes.length,2);assert.equal(panes[0].id,'first');assert.equal(panes[0].width,420);assert.equal(panes[0].visible,true);assert.equal(panes[0].draft,'safe');assert.equal(C.restoredActiveIndex(raw,panes),0);assert.deepEqual(C.restoreWorkspacePanes(panes,()=>`n${++n}`),panes);
});
test('conflicting duplicate drafts survive as separate blank chats, while fresh chats remain distinct',()=>{
 const raw=[{id:'a',url:'/c/thread123',draft:'one'},{id:'b',url:'/c/thread123',draft:'two'},{id:'c',url:base+'/',newChat:true,draft:'three'}];
 const panes=C.restoreWorkspacePanes(raw,()=> 'generated');assert.equal(panes.length,3);assert.equal(panes[1].url,base+'/');assert.equal(panes[1].newChat,true);assert.deepEqual(panes.map(p=>p.draft),['one','two','three']);assert.equal(C.restoredActiveIndex({panes:raw,activeIndex:1},panes),1);
});

test('durable snapshot remaps selection after deduplication and remains stable across reload',()=>{
 const P=require('../extension/persistence.js');let n=0;
 const raw={enabled:true,activeIndex:2,panes:[{id:'a',url:'/c/thread123',width:440},{id:'dup',url:'/g/g-project/c/thread123'},{id:'b',url:'/c/thread456',width:550,visible:false}],closedPanes:[{url:'/c/thread999',title:'Closed'}]};
 const first=P.snapshot(raw,'workspace',()=>`n${++n}`),second=P.snapshot(first,'workspace',()=>`n${++n}`);
 assert.equal(first.activeIndex,1);assert.equal(first.panes[1].id,'b');assert.equal(second.activeIndex,1);assert.deepEqual(second.panes,first.panes);assert.equal(second.closedPanes.length,1);
});

test('legacy selected blank without IDs retains selection after earlier duplicates are merged',()=>{
 const raw={activeIndex:3,panes:[{url:'/c/thread123'},{url:'/c/thread123'},{url:null},{url:C.ORIGIN+'/',newChat:true,draft:'selected'}]};let n=0;
 const panes=C.restoreWorkspacePanes(raw.panes,()=>`n${++n}`);assert.equal(C.restoredActiveIndex(raw,panes),2);assert.equal(panes[2].draft,'selected');
});
