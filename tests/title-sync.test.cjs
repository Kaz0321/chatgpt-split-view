const test=require('node:test'),assert=require('node:assert/strict');
const C=require('../extension/core.js');
const url='https://chatgpt.com/c/conversation123',key=C.conversationKey(url);
test('native title changes propagate; new documents and unchanged stale sources cannot roll back',()=>{
 const t=C.createTitleTracker(),parent={},child={},old={};
 const observe=(doc,name,primary=false)=>t.observe(doc,new Map([[key,name]]),primary);
 observe(parent,'First',true);observe(child,'First');observe(parent,'Renamed',true);
 observe(child,'First');observe(old,'First');assert.equal(t.get(key),'Renamed');
 observe(child,'Latest');assert.equal(t.get(key),'Latest');observe(parent,'Renamed',true);assert.equal(t.get(key),'Latest');
 observe(child,'First');assert.equal(t.get(key),'First');
 observe(parent,'First',true);assert.equal(t.get(key),'First');
});
test('SPA document first seeing a different conversation cannot override known name',()=>{
 const t=C.createTitleTracker(),a={},b={};t.observe(a,new Map([[key,'New']]));t.observe(b,new Map([['chat:other','Other']]));
 t.observe(b,new Map([[key,'Old']]));assert.equal(t.get(key),'New');
});
test('auto titles update same-ID panes without changing drafts, widths, order or local aliases',()=>{
 const panes=[{id:'a',url,title:'Old',titleMode:'native',draft:'unsent',folded:true,width:700},{id:'b',url,title:'Alias',titleMode:'local'},{id:'c',url,title:'Old',titleMode:'native'}];
 for(const p of panes)C.applyNativeTitle(p,'New');assert.deepEqual(panes.map(p=>p.title),['New','Alias','New']);
 assert.equal(panes[0].draft,'unsent');assert.equal(panes[0].width,700);assert.equal(panes[0].folded,true);
 assert.equal(C.applyNativeTitle(panes[0],'While editing',true),false);assert.equal(panes[0].title,'New');
});
test('legacy aliases preserved, placeholders join sync; roots and GPT starts are never conversation identities',()=>{
 const legacy={url,title:'Custom'};C.applyNativeTitle(legacy,'Native');assert.equal(legacy.title,'Custom');assert.equal(legacy.titleMode,'local');
 const generic={url,title:'新しいチャット'};C.applyNativeTitle(generic,'Native');assert.equal(generic.title,'Native');
 for(const u of ['https://chatgpt.com/','https://chatgpt.com/g/g-example']){const p={url:u,title:'Draft',titleMode:'native'};assert.equal(C.applyNativeTitle(p,'Wrong'),false);}
});
test('title modes survive workspace and group restoration, invalid modes discarded',()=>{
 for(const mode of ['local','native']){const result=C.restoreWorkspacePanes([{id:'a',url,title:'Name',titleMode:mode,folded:true}],()=> 'id');assert.equal(result[0].titleMode,mode);assert.equal(result[0].folded,true);}
 assert.equal(C.normalizeSessionPanes([{url,titleMode:'unknown'}])[0].titleMode,undefined);
});
