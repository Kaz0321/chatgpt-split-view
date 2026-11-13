const test=require('node:test'),assert=require('node:assert/strict');
const D=require('../extension/drafts.js'),C=require('../extension/core.js');
function fixture(saved='',existing=''){
 const events={},windowEvents={},writes=[],reports=[];
 class Area{get value(){return this._value||'';}set value(v){this._value=v;}}
 const el=new Area();el.tagName='TEXTAREA';el.value=existing;el.dispatchEvent=e=>{events[e.type]?.({target:el});};
 const doc={querySelector:s=>s==='#prompt-textarea'?el:null,addEventListener:(t,f)=>events[t]=f,removeEventListener:t=>delete events[t],defaultView:{HTMLTextAreaElement:Area,Event:class{constructor(type){this.type=type;}},addEventListener:(t,f)=>windowEvents[t]=f,removeEventListener:t=>delete windowEvents[t]}};el.ownerDocument=doc;
 const pane={draft:saved},recovery=D.connect(doc,pane,()=>writes.push(pane.draft),s=>reports.push(s));
 return {el,doc,pane,recovery,events,windowEvents,writes,reports};
}
test('textarea draft is restored exactly once without sending or reloading',()=>{const h=fixture('line 1\n日本語');assert.equal(h.el.value,'line 1\n日本語');h.el.value='user edit';h.recovery.attempt();assert.equal(h.el.value,'user edit');assert.equal(h.writes.length,0);});
test('input and pagehide save text locally, including intentional clearing',()=>{const h=fixture();h.el.value='new';h.events.input({target:h.el});assert.equal(h.pane.draft,'new');h.el.value='final';h.windowEvents.pagehide();assert.equal(h.pane.draft,'final');h.el.value='';h.events.input({target:h.el});assert.equal(h.pane.draft,'');});
test('existing native draft is not overwritten and saved backup survives pagehide',()=>{const h=fixture('saved','native');assert.equal(h.el.value,'native');h.recovery.capture();assert.equal(h.pane.draft,'native');assert.deepEqual(h.pane.draftBackups,['saved']);assert.equal(h.reports.length,1);h.el.value='edited';h.events.input({target:h.el});assert.equal(h.pane.draft,'edited');assert(h.pane.draftBackups.includes('saved'));const restored=C.restoreWorkspacePanes([h.pane],()=> 'restored')[0];assert(restored.draftBackups.includes('saved'));assert.equal(restored.draft,'edited');});
test('other input fields, attachments and transcripts are not captured',()=>{const h=fixture('saved');h.events.input({target:{type:'file',files:['private']}});assert.equal(h.pane.draft,'saved');assert.equal(h.writes.length,0);});
test('late hydration restores when composer becomes available; cleanup releases listeners',()=>{const h=fixture();let el=null;h.doc.querySelector=()=>el;const p={draft:'late'},r=D.connect(h.doc,p,()=>{});r.attempt();el=h.el;r.attempt();assert.equal(h.el.value,'late');r.dispose();assert.equal(h.events.input,undefined);assert.equal(h.windowEvents.pagehide,undefined);});
test('duplicate IDs repaired, parked order widths and distinct new-chat drafts survive session restore',()=>{let n=0;const raw=[{id:'same',url:C.ORIGIN+'/',newChat:true,draft:'one',width:420,visible:false},{id:'same',url:C.ORIGIN+'/',newChat:true,draft:'two',width:550,visible:false}];const ps=C.restoreWorkspacePanes(raw,()=>`new-${++n}`);assert.equal(ps.length,2);assert.notEqual(ps[0].id,ps[1].id);assert.deepEqual(ps.map(p=>[p.draft,p.width,p.visible]),[['one',420,false],['two',550,false]]);assert.deepEqual(C.restoreWorkspacePanes(ps,()=>`new-${++n}`),ps);});
test('legacy sessions migrate and malformed entries do not misalign draft owners',()=>{let n=0;const ps=C.restoreWorkspacePanes([{url:'https://evil.test',draft:'bad'},{url:C.ORIGIN+'/c/fixture001',draft:'good',title:'title'}],()=>`p-${++n}`);assert.equal(ps.length,1);assert.equal(ps[0].draft,'good');assert.equal(ps[0].title,'title');assert(ps[0].id);});
test('separate workspace snapshots do not share objects or overwrite draft data',()=>{const a=C.restoreWorkspacePanes([{url:C.ORIGIN+'/',newChat:true,draft:'A'}],()=> 'a');const b=C.restoreWorkspacePanes([{url:C.ORIGIN+'/',newChat:true,draft:'B'}],()=> 'b');a[0].draft='changed';assert.equal(b[0].draft,'B');assert.equal(C.normalizeSessionPanes(a)[0].draft,undefined);});
test('rich text paragraphs, intentional blank lines and soft breaks retain exact text',()=>{const t=s=>({nodeType:3,nodeValue:s}),e=(tag,...nodes)=>({tagName:tag,childNodes:nodes});assert.equal(D.text(e('DIV',e('P',t('one')),e('P',e('BR')),e('P',t('two'),e('BR'),t('three')))),'one\n\ntwo\nthree');assert.equal(D.text(e('DIV',e('P',e('BR')))),'');});
test('id-less current ChatGPT composer is supported only when unambiguous',()=>{const candidate={closest:()=>null};const doc={querySelector:()=>null,querySelectorAll:()=>[candidate]};assert.equal(D.composer(doc),candidate);doc.querySelectorAll=()=>[candidate,candidate];assert.equal(D.composer(doc),null);});

test('unsupported composer restoration retains saved text separately from empty current input',()=>{
 const el={tagName:'TEXTAREA',value:''},doc={querySelector:()=>el,addEventListener(){},removeEventListener(){},defaultView:{HTMLTextAreaElement:{prototype:{}},addEventListener(){},removeEventListener(){}}};el.ownerDocument=doc;
 const pane={draft:'saved'};const recovery=D.connect(doc,pane,()=>{});assert.equal(pane.draft,'');assert.deepEqual(pane.draftBackups,['saved']);recovery.capture();assert.deepEqual(pane.draftBackups,['saved']);
});

test('saved route changes back up text and never restore or capture the previous composer into a new conversation',()=>{
 const h=fixture('old draft');h.recovery.dispose();let key='chat:first',current=h.el;
 h.doc.querySelector=()=>current;
 const r=D.connect(h.doc,h.pane,()=>{},()=>{},()=>key);
 key='chat:second';r.navigation();r.attempt();r.capture();
 assert.equal(h.pane.draft,undefined);assert.deepEqual(h.pane.draftBackups,['old draft']);assert.equal(h.el.value,'old draft');
 const replacement=Object.create(Object.getPrototypeOf(h.el));Object.assign(replacement,{tagName:'TEXTAREA',ownerDocument:h.doc,value:'',dispatchEvent(){}});current=replacement;
 r.attempt();assert.equal(replacement.value,'');r.capture();assert.equal(h.pane.draft,'');
 replacement.value='second draft';h.events.input({target:replacement});assert.equal(h.pane.draft,'second draft');
 key='chat:third';r.navigation();replacement.value='third draft';h.events.input({target:replacement});assert.equal(h.pane.draft,'third draft');assert.deepEqual(h.pane.draftBackups,['old draft','second draft']);
});
test('route promotion preserves live composer text as backup, never injecting it into a replacement',()=>{
 const h=fixture('draft');h.recovery.dispose();let key='draft:home';
 const r=D.connect(h.doc,h.pane,()=>{},()=>{},()=>key);key='chat:saved';r.attempt();r.capture();assert.equal(h.pane.draft,undefined);assert.equal(h.el.value,'draft');assert.deepEqual(h.pane.draftBackups,['draft']);
 h.el.value='new input';h.events.input({target:h.el});r.attempt();assert.equal(h.pane.draft,'new input');
});
test('unsupported native routes cannot capture input under a prior conversation identity',()=>{
 const h=fixture('old');h.recovery.dispose();let key='chat:fixture';const r=D.connect(h.doc,h.pane,()=>{},()=>{},()=>key);
 key=undefined;h.el.value='settings input';h.events.input({target:h.el});r.capture();assert.equal(h.pane.draft,undefined);assert.deepEqual(h.pane.draftBackups,['old']);
 key=null;h.el.value='new chat draft';h.events.input({target:h.el});assert.equal(h.pane.draft,'new chat draft');
});

test('different fresh project routes cannot inject cached text into an empty replacement composer',()=>{
 const h=fixture('project A draft');h.recovery.dispose();let key='draft:projectA',current=h.el;h.doc.querySelector=()=>current;
 const r=D.connect(h.doc,h.pane,()=>{},()=>{},()=>key);key='draft:projectB';
 current=Object.create(Object.getPrototypeOf(h.el));Object.assign(current,{tagName:'TEXTAREA',ownerDocument:h.doc,value:'',dispatchEvent(){}});
 r.attempt();assert.equal(current.value,'');assert.equal(h.pane.draft,undefined);assert.deepEqual(h.pane.draftBackups,['project A draft']);
});

test('initial unsupported document cannot carry a cached draft into a later supported route',()=>{
 const h=fixture();h.recovery.dispose();h.pane.draft='cached A';let key=undefined;
 const r=D.connect(h.doc,h.pane,()=>{},()=>{},()=>key);assert.equal(h.el.value,'');key='chat:B';r.attempt();r.capture();
 assert.equal(h.el.value,'');assert.equal(h.pane.draft,undefined);assert.deepEqual(h.pane.draftBackups,['cached A']);
});
