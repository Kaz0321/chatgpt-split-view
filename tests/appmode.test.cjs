const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const Core=require('../extension/core.js');
const source=fs.readFileSync(require.resolve('../extension/workspace.js'),'utf8');
function harness(extra={}) {
  let doc;
  class Element {
    constructor(tag='div'){this.tagName=tag.toUpperCase();this.attributes={};this.listeners={};this.children=[];this.style={};this.dataset={};this.hidden=false;this.value='';this.textContent='';this.ownerDocument=doc;this.offsetWidth=154;this.offsetHeight=36;this.classList={toggle(){},add(){},remove(){}};}
    appendChild(e){this.children.push(e);e.parentElement=this;return e;} append(...es){es.forEach(e=>this.appendChild(e));} replaceChildren(...es){this.children=[];this.value='';this.append(...es);}
    addEventListener(t,f){(this.listeners[t]??=[]).push(f);} setAttribute(k,v){this.attributes[k]=String(v);} getAttribute(k){return this.attributes[k]??null;} hasAttribute(k){return k in this.attributes;}
    closest(s){return this.control||this;} focus(){doc.activeElement=this;} setPointerCapture(){} checkValidity(){return Number(this.value)>=320&&Number(this.value)<=Number(this.max);}
    getBoundingClientRect(){return {left:parseFloat(this.style.left)||0,top:parseFloat(this.style.top)||0,bottom:(parseFloat(this.style.top)||0)+36,width:154,height:36};}
    emit(type,more={}){const e={target:this,button:0,clientX:0,clientY:0,preventDefault(){this.defaultPrevented=true;},stopImmediatePropagation(){this.stopped=true;},composedPath:()=>[this],...more};for(const f of this.listeners[type]||[])f(e);return e;}
  }
  doc={getElementById(){return null;},createElement:t=>new Element(t),listeners:{},addEventListener(t,f){(this.listeners[t]??=[]).push(f);}};
  let serial=0;const saves=[],ctx={Element,document:doc,URL,location:{pathname:'/'},crypto:{randomUUID:()=>`pane-${++serial}`},innerWidth:1000,innerHeight:700,confirm:()=>true,CGWWCore:Core,sessionStorage:{setItem:(k,v)=>saves.push(JSON.parse(v))},chrome:{storage:{local:{set:async()=>{}}}},...extra};ctx.window=ctx;ctx.top=ctx;ctx.addEventListener=()=>{};doc.defaultView=ctx;
  vm.createContext(ctx);vm.runInContext(source.replace('  void initialize();',`globalThis.api={newChatControl,handleNewChatClick,addNewChat,syncNewChatLocation,setEnabled,makeOverlay,closeOverlay,placeOverlay,syncOverlay,safeSave,
    init(panes=[]){state.panes=panes;panel=document.createElement('section');shadow=document.createElement('div');scroller={clientWidth:724,scrollWidth:2400};renderPane=p=>{if(!paneNodes.has(p.id))paneNodes.set(p.id,{root:document.createElement('article'),iframe:{draft:'keep',id:p.id}});};startMasterWatch=()=>{};stopMasterWatch=()=>{};ensureMasterSidebar=()=>{};},
    enabled(v){state.enabled=v;},prefs(v){settings=Core.normalizeSettings(v);},state(){return state;},entries(){return paneNodes;},ui(){return {overlay,overlayMenu,launcher,viewToggle,menuControls};},position(v){overlayPosition=v;},settings(){return settings;}};`),ctx);
  ctx.api.init();return {a:ctx.api,ctx,doc,Element,saves};
}
function control(h,tag='a',attrs={}){const e=new h.Element(tag);e.href='https://chatgpt.com/?noauth_recent_chat_failed=1';e.setAttribute('aria-label','新しいチャット');for(const [k,v]of Object.entries(attrs))e.setAttribute(k,v);return e;}
function event(target,extra={}){return {target,button:0,preventDefault(){this.defaultPrevented=true;},stopImmediatePropagation(){this.stopped=true;},...extra};}
test('new-chat URL is root only, strips incidental noauth query but preserves unsupported mode links natively',()=>{
 assert.equal(Core.newChatUrl('/'),'https://chatgpt.com/');assert.equal(Core.newChatUrl('/?noauth_recent_chat_failed=1'),'https://chatgpt.com/');
 for(const s of ['https://evil.example/','https://user:pass@chatgpt.com/','/?temporary-chat=true','/?model=fixture','#x','/images','/g/g-fixture','/c/fixture123'])assert.equal(Core.newChatUrl(s),null,s);
 assert.equal(Core.chatUrl('/'),null);
});
test('multiple new drafts survive session normalization without URL deduplication',()=>{
 const result=Core.normalizeSessionPanes(Array.from({length:10},()=>({url:'https://chatgpt.com/',newChat:true,width:320})));assert.equal(result.length,10);assert(result.every(p=>p.newChat&&p.url===Core.ORIGIN+'/'));assert.notEqual(result[0],result[1]);
 assert.equal(Core.normalizeSessionPanes([{url:'https://evil.example/',newChat:true},{url:'https://chatgpt.com/'}]).length,0);
});
test('observed native octane root link and explicit new-chat buttons are recognized',()=>{
 const h=harness(),a=control(h,'a',{'data-octane-navigation-item':'new_chat'});assert.equal(h.a.newChatControl(event(a)),a);
 for(const label of ['新しいチャット','New chat','新規チャット']){const b=control(h,'button',{'aria-label':label});assert.equal(h.a.newChatControl(event(b)),b);}
 const b=control(h,'button',{'aria-label':'','data-testid':'create-new-chat-button'});assert.equal(h.a.newChatControl(event(b)),b);
});
test('logo, unrelated labels, external/mode links, downloads and disabled controls stay native',()=>{
 const h=harness();for(const label of ['ChatGPT','新しいチャットを共有','New chat settings']){const b=control(h,'a',{'aria-label':label});assert.equal(h.a.newChatControl(event(b)),null);}
 for(const href of ['https://example.com/','/?temporary-chat=true','/project/fixture000/']){const b=control(h);b.href=href;assert.equal(h.a.newChatControl(event(b)),null);}
 for(const attrs of [{download:''},{'aria-disabled':'true'}])assert.equal(h.a.newChatControl(event(control(h,'a',attrs))),null);
 const b=control(h,'button');b.disabled=true;assert.equal(h.a.newChatControl(event(b)),null);
 h.ctx.location.pathname='/g/g-fixture';assert.equal(h.a.newChatControl(event(control(h,'button'))),null);
});
test('modifier, secondary, already-handled, original-mode and disabled interception clicks pass through',()=>{
 const h=harness();h.a.enabled(true);const b=control(h);for(const extra of [{ctrlKey:true},{metaKey:true},{altKey:true},{shiftKey:true},{button:1},{defaultPrevented:true}]){const e=event(b,extra);assert.equal(h.a.handleNewChatClick(e),false);assert.equal(e.stopped,undefined);}
 h.a.enabled(false);assert.equal(h.a.handleNewChatClick(event(b)),false);h.a.enabled(true);h.a.prefs({interceptSidebar:false});assert.equal(h.a.handleNewChatClick(event(b)),false);
});
test('new-chat click appends right while preserving existing pane objects and drafts',()=>{
 const h=harness(),original={id:'old',url:Core.ORIGIN+'/c/fixture000',title:'Fixture',visible:true,width:400};h.a.init([original]);h.a.enabled(true);const e=event(control(h));assert.equal(h.a.handleNewChatClick(e),true);assert(e.defaultPrevented&&e.stopped);assert.equal(h.a.state().panes[0],original);assert.equal(h.a.state().panes[1].newChat,true);assert.equal(h.a.state().activeId,h.a.state().panes[1].id);
});
test('repeated new chats create ten distinct pane IDs and retain active index in session',()=>{
 const h=harness();h.a.enabled(true);for(let i=0;i<10;i++)assert(h.a.addNewChat());const p=h.a.state().panes;assert.equal(new Set(p.map(x=>x.id)).size,10);assert(p.every(x=>x.url===Core.ORIGIN+'/'));h.a.safeSave();assert.equal(h.saves.at(-1).activeIndex,9);assert.equal(h.saves.at(-1).panes.length,10);
});
test('cancelled large-pane confirmation does not append or fall through to destructive native navigation',()=>{
 const h=harness({confirm:()=>false});h.a.init(Array.from({length:8},(_,i)=>({id:String(i),visible:true})));h.a.enabled(true);const e=event(control(h));assert.equal(h.a.handleNewChatClick(e),true);assert(e.defaultPrevented);assert.equal(h.a.state().panes.length,8);
});
test('original-view round trips preserve iframe references and original drafts',()=>{
 const h=harness();h.a.setEnabled(true);const pane=h.a.state().panes[0],frame=h.a.entries().get(pane.id).iframe;frame.draft='unsent fixture';for(let i=0;i<4;i++){h.a.setEnabled(false);h.a.setEnabled(true);}assert.equal(h.a.entries().get(pane.id).iframe,frame);assert.equal(frame.draft,'unsent fixture');assert.equal(h.a.state().panes.length,1);
});
test('page overlay works without chrome.tabs or extension popup and offers one-click original/return',()=>{
 const h=harness();h.a.makeOverlay();const u=h.a.ui();assert.equal(u.viewToggle.textContent,'分割を開始');u.viewToggle.emit('click');assert.equal(h.a.state().enabled,true);assert.equal(u.viewToggle.textContent,'元画面');u.viewToggle.emit('click');assert.equal(h.a.state().enabled,false);assert.equal(u.viewToggle.textContent,'分割へ');assert.equal(u.overlay.hidden,false);
});
test('overlay menu opens/closes repeatedly, restores focus and has no destructive view toggle side effect',()=>{
 const h=harness();h.a.makeOverlay();const u=h.a.ui();for(let i=0;i<3;i++){u.launcher.emit('click');assert.equal(u.overlayMenu.hidden,false);assert.equal(u.launcher.getAttribute('aria-expanded'),'true');u.menuControls.close.emit('click');assert.equal(u.overlayMenu.hidden,true);assert.equal(h.doc.activeElement,u.launcher);}assert.equal(h.a.state().enabled,false);
});
test('overlay controls add fresh chats and apply width/equal settings directly',()=>{
 const h=harness();h.a.makeOverlay();h.a.setEnabled(true);const u=h.a.ui();u.menuControls.add.emit('click');assert.equal(h.a.state().panes.length,2);u.menuControls.width.value='480';u.menuControls.apply.emit('click');assert.equal(h.a.settings().paneWidth,480);u.menuControls.equal.checked=true;u.menuControls.equal.emit('change');assert.equal(h.a.settings().equalizeColumns,true);assert.equal(u.menuControls.width.disabled,true);
});
test('overlay position clamps inside narrow viewport and arrow movement persists locally',()=>{
 const h=harness();h.a.makeOverlay();h.ctx.innerWidth=400;h.ctx.innerHeight=300;h.a.position({x:5000,y:5000});h.a.placeOverlay();const u=h.a.ui();assert.equal(u.overlay.style.left,'230px');assert.equal(u.overlay.style.top,'248px');u.overlay.children[0].emit('keydown',{key:'ArrowLeft'});assert.equal(u.overlay.style.left,'214px');assert.equal(h.saves.at(-1).overlayPosition.x,214);
});
test('new draft transition records only validated same-origin conversation URL without changing iframe source',()=>{
 const h=harness();const p={newChat:true,url:Core.ORIGIN+'/'};const frame={_cgwwPane:p,src:p.url,contentWindow:{location:{href:Core.ORIGIN+'/c/fixture000'}}};h.a.syncNewChatLocation(frame);assert.equal(p.url,Core.ORIGIN+'/c/fixture000');assert.equal(p.newChat,undefined);assert.equal(frame.src,Core.ORIGIN+'/');
 const q={newChat:true,url:Core.ORIGIN+'/'};h.a.syncNewChatLocation({_cgwwPane:q,contentWindow:{location:{href:'https://evil.example/c/fixture000'}}});assert.equal(q.newChat,true);
});
test('workspace has no box shadows or persistent toolbar; drag markers use noninteractive pseudo-elements',()=>{
 assert.equal(source.includes('box-shadow'),false);assert.equal(source.includes('const toolbar = create('),false);assert.match(source,/\.pane\.drop-before::before/);assert.match(source,/width:4px;background:#1684ed;z-index:3;pointer-events:none/);assert.match(source,/\.overlay\{position:fixed/);
});
test('iframe-realm new-chat button is recognized without parent Element rejection',()=>{
 const h=harness(),child=vm.createContext({});vm.runInContext(`class Element{};this.Element=Element;this.button=new Element();button.tagName='BUTTON';button.ownerDocument={defaultView:{Element,location:{pathname:'/c/fixture000'}}};button.closest=()=>button;button.getAttribute=k=>k==='aria-label'?'新しいチャット':null;`,child);assert.equal(h.a.newChatControl(event(child.button)),child.button);
});
test('Escape and outside pointer dismissal close only the menu and permit reopening',()=>{
 const h=harness();h.a.makeOverlay();const u=h.a.ui();u.launcher.emit('click');u.overlayMenu.parentElement.emit('keydown',{key:'Escape'});assert(u.overlayMenu.hidden);u.launcher.emit('click');for(const fn of h.doc.listeners.pointerdown)fn({composedPath:()=>[]});assert(u.overlayMenu.hidden);u.launcher.emit('click');assert.equal(u.overlayMenu.hidden,false);assert.equal(h.a.state().enabled,false);
});
