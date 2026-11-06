const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const C=require('../extension/core.js');
const base=C.ORIGIN;
function harness(panes){
 let next=0;const context={URL,console,crypto:{randomUUID:()=>`new-${++next}`},document:{getElementById(){return null;}},CGWWCore:C,confirm(){throw Error('Existing conversation must not prompt');}};
 context.window=context;context.top=context;vm.createContext(context);
 vm.runInContext(fs.readFileSync(require.resolve('../extension/workspace.js'),'utf8').replace('  void initialize();',`globalThis.api={mergeGroupPanes,selectConversation,addPane,assignToActive,restoreClosedPane,findConversation,get:()=>state,entries:()=>paneNodes,history:()=>closedPanes,init(panes){state={enabled:true,panes,activeId:null};scroller={scrollWidth:1000};for(const p of panes)paneNodes.set(p.id,{iframe:{draft:'keep'},root:{scrollIntoView(){}}});renderPane=p=>{if(!paneNodes.has(p.id))paneNodes.set(p.id,{iframe:{},root:{}})};syncPaneOrder=markActive=applyColumnWidths=safeSave=syncOverlay=updateFallbackDock=setStatus=()=>{};}};`),context);
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


test('group restore reuses folded and parked live documents, adds only missing conversations and retains unrelated tabs',()=>{
 const p={id:'a',url:base+'/c/thread123',visible:false,folded:true,width:480,draft:'live input'},other={id:'b',url:base+'/c/thread456',visible:true,draft:'unrelated'};
 const a=harness([p,other]),frame=a.entries().get('a').iframe;
 const group={activeIndex:0,panes:[{id:'saved-a',url:base+'/g/g-project/c/thread123',visible:true,draft:'older saved input',draftBackups:['backup']},{id:'new',url:base+'/c/thread789',visible:true}]};
 a.mergeGroupPanes(group);a.mergeGroupPanes(group);assert.equal(a.get().panes.length,3);assert.equal(a.entries().get('a').iframe,frame);assert.equal(p.visible,true);assert.equal(p.folded,false);assert.equal(p.width,480);assert.equal(p.draft,'live input');assert.deepEqual(Array.from(p.draftBackups),['backup','older saved input']);assert.equal(a.get().panes[1],other);assert.equal(other.draft,'unrelated');
});
test('group restoration keeps separate unsent chats and repeated restoration reuses their stable pane IDs',()=>{
 const first={id:'draft-1',url:base+'/',newChat:true,visible:true,draft:'first'},a=harness([first]);
 const group={panes:[{...first,draft:'saved first'},{id:'draft-2',url:base+'/',newChat:true,visible:true,draft:'second'}]};
 a.mergeGroupPanes(group);a.mergeGroupPanes(group);assert.equal(a.get().panes.length,2);assert.equal(first.draft,'first');assert.equal(a.get().panes[1].draft,'second');assert.notEqual(first.id,a.get().panes[1].id);
});
test('rapid incoming URL operations share one pane and limit failure does not partially merge groups',async()=>{
 const a=harness([]);await Promise.all(Array.from({length:8},async()=>a.assignToActive(base+'/c/same123','Same',true)));assert.equal(a.get().panes.length,1);
 const panes=Array.from({length:200},(_,i)=>({id:'p'+i,url:base+'/c/thread'+i,visible:false})),b=harness(panes);assert.throws(()=>b.mergeGroupPanes({panes:[{id:'existing',url:base+'/c/thread0',visible:true},{id:'new',url:base+'/c/new123',visible:true}]}),/200/);assert.equal(panes.length,200);assert.equal(panes[0].visible,false);
});

test('a saved unsent chat that has since become a conversation reuses its stable pane instead of opening a new root',()=>{
 const live={id:'draft-stable',url:base+'/c/sent123',visible:true,draft:'new input'},a=harness([live]);
 a.mergeGroupPanes({panes:[{id:'draft-stable',url:base+'/',newChat:true,visible:true,draft:'old input'}]});assert.equal(a.get().panes.length,1);assert.equal(live.url,base+'/c/sent123');assert.equal(live.draft,'new input');assert.deepEqual(Array.from(live.draftBackups),['old input']);
});


test('GPT links and group restoration reuse a folded resource without merging its conversations',()=>{
 const url=base+'/g/g-h8l4uLHFQ-video-ai-by-invideo';
 const p={id:'gpt',url,visible:false,folded:true,draft:'live'};const a=harness([p]);const frame=a.entries().get('gpt').iframe;
 a.assignToActive(url,'GPT');a.assignToActive('/g/g-h8l4uLHFQ-renamed','GPT',true);
 assert.equal(a.get().panes.length,1);assert.equal(p.visible,true);assert.equal(p.folded,false);assert.equal(a.entries().get('gpt').iframe,frame);
 a.mergeGroupPanes({panes:[{id:'saved',url,draft:'old',visible:true}]});assert.equal(a.get().panes.length,1);assert.equal(p.draft,'live');assert.deepEqual(Array.from(p.draftBackups),['old']);
 frame.contentWindow={location:{href:url+'/c/thread123'}};
 a.assignToActive('/c/thread123','Conversation');assert.equal(a.get().panes.length,1);
 a.assignToActive(url,'Start GPT');assert.equal(a.get().panes.length,2);assert.equal(p.url,url+'/c/thread123');
});


test('GPT resources survive durable snapshot and reload with separate conversation identity',()=>{
 const P=require('../extension/persistence.js');let n=0;
 const url=base+'/g/g-h8l4uLHFQ-video-ai-by-invideo';
 const first=P.snapshot({enabled:true,activeIndex:0,panes:[{id:'g',url,folded:true,draft:'keep',visible:true},{id:'c',url:url+'/c/thread123'}]},'workspace',()=>`n${++n}`);
 const second=P.snapshot(first,'workspace',()=>`n${++n}`);
 assert.equal(second.panes.length,2);assert.equal(second.panes[0].url,url);assert.equal(second.panes[0].draft,'keep');assert.equal(second.panes[0].folded,true);assert.deepEqual(second.panes,first.panes);
});


test('legacy parked group panes remain recoverable without creating new parked duplicates',()=>{
 const a=harness([]),url=base+'/c/legacy123';
 const group={panes:[{id:'old',url,visible:false,draft:'legacy draft',width:480}]};
 a.mergeGroupPanes(group);a.mergeGroupPanes(group);assert.equal(a.get().panes.length,1);
 const p=a.get().panes[0];assert.equal(p.visible,false);assert.equal(p.draft,'legacy draft');
 a.selectConversation(p);assert.equal(p.visible,true);assert.equal(p.folded,false);assert.equal(p.draft,'legacy draft');
});
