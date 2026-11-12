const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const Core=require('../extension/core.js');
const source=fs.readFileSync(require.resolve('../extension/workspace.js'),'utf8');
function harness(extra={}) {
  let doc;
  class Element {
    constructor(tag='div'){this.tagName=tag.toUpperCase();this.attributes={};this.listeners={};this.children=[];this.style={};this.dataset={};this.hidden=false;this.value='';this.textContent='';this.ownerDocument=doc;this.offsetWidth=154;this.offsetHeight=36;this.classList={toggle(){},add(){},remove(){}};}
    get firstChild(){return this.children[0];} remove(){} insertBefore(e,before){this.appendChild(e);this.children=this.children.filter(x=>x!==e);const i=this.children.indexOf(before);this.children.splice(i<0?this.children.length:i,0,e);}
    appendChild(e){if(e.parentElement)e.parentElement.children=e.parentElement.children.filter(x=>x!==e);this.children.push(e);e.parentElement=this;return e;} append(...es){es.forEach(e=>this.appendChild(e));} replaceChildren(...es){this.children=[];this.value='';this.append(...es);}
    addEventListener(t,f){(this.listeners[t]??=[]).push(f);} setAttribute(k,v){this.attributes[k]=String(v);} getAttribute(k){return this.attributes[k]??null;} hasAttribute(k){return k in this.attributes;}
    closest(s){if(s.includes('[role="menu"]')||s.includes('[data-radix-menu-content]'))return null;return this.control||this;} focus(){doc.activeElement=this;} setPointerCapture(){} checkValidity(){return Number(this.value)>=320&&Number(this.value)<=Number(this.max);}
    getBoundingClientRect(){return {left:parseFloat(this.style.left)||0,top:parseFloat(this.style.top)||0,bottom:(parseFloat(this.style.top)||0)+36,width:154,height:36};}
    emit(type,more={}){const e={target:this,button:0,clientX:0,clientY:0,preventDefault(){this.defaultPrevented=true;},stopImmediatePropagation(){this.stopped=true;},stopPropagation(){this.stopped=true;},composedPath:()=>[this],...more};for(const f of this.listeners[type]||[])f(e);return e;}
  }
  doc={getElementById(){return null;},createElement:t=>new Element(t),listeners:{},removeEventListener(){},addEventListener(t,f){(this.listeners[t]??=[]).push(f);}};
  let serial=0;const saves=[],ctx={setTimeout:()=>1,clearTimeout(){},Element,document:doc,URL,location:{pathname:'/'},crypto:{randomUUID:()=>`pane-${++serial}`},innerWidth:1000,innerHeight:700,confirm:()=>true,CGWWCore:Core,sessionStorage:{setItem:(k,v)=>saves.push(JSON.parse(v))},chrome:{storage:{local:{set:async()=>{}}}},...extra};ctx.window=ctx;ctx.top=ctx;ctx.addEventListener=()=>{};ctx.removeEventListener=()=>{};doc.defaultView=ctx;
  vm.createContext(ctx);vm.runInContext(source.replace('  void initialize();',`const realRender=renderPane;globalThis.api={recordStatus(fn){setStatus=fn;},mergeGroupPanes,expireBranch(p){branchActions.set(p,{expires:0});},prepareBranch,handleBranchClick,checkBranchLocation,finishBranch,importBranchUrl,useRealRender(){renderPane=realRender;},shadowFocus(el){shadow.activeElement=el;},readNativeTitles,syncNativeTitles,ready(){initialized=true;},foldAllPanes,refreshContentLayout,syncSplitPane,isSplitWide,toggleSplitWidth,resizeSplitWidth,paneSourceUrl,copyPaneUrl,openPaneNativeMenu,setPaneFolded,realRender,notice(){autoRestored=true;updateRecoveryUI();return restoreBadge;},newChatControl,handleNewChatClick,addNewChat,syncNewChatLocation,setEnabled,makeOverlay,closeOverlay,placeOverlay,syncOverlay,safeSave,resetPaneWidths,sidebarWidth,toggleSidebar,getPaneWidth,setSidebarWidth,makeSidebarResize,nativeCap(n){originalMaxWidth=n;contentWidthDetected=true;},
    init(panes=[]){state.panes=panes;panel=document.createElement('section');shadow=document.createElement('div');scroller=document.createElement('main');scroller.clientWidth=724;scroller.scrollWidth=2400;renderPane=p=>{if(!paneNodes.has(p.id))paneNodes.set(p.id,{root:document.createElement('article'),iframe:{draft:'keep',id:p.id}});};startMasterWatch=()=>{};stopMasterWatch=()=>{};ensureMasterSidebar=()=>{};pinMasterSidebar=()=>{};},
    enabled(v){state.enabled=v;},prefs(v){settings=Core.normalizeSettings(v);},state(){return state;},entries(){return paneNodes;},ui(){return {panel,overlay,overlayMenu,launcher,viewToggle,menuControls,sidebarHandle};},position(v){overlayPosition=v;},settings(){return settings;}};`),ctx);
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
 const h=harness();h.a.makeOverlay();const u=h.a.ui();assert.equal(u.viewToggle.textContent,'メイン · 分割を開始');u.viewToggle.emit('click');assert.equal(h.a.state().enabled,true);assert.equal(u.viewToggle.textContent,'メイン（元画面）');u.viewToggle.emit('click');assert.equal(h.a.state().enabled,false);assert.equal(u.viewToggle.textContent,'メイン · 分割へ');assert.equal(u.overlay.hidden,true);
});
test('overlay menu opens/closes repeatedly, restores focus and has no destructive view toggle side effect',()=>{
 const h=harness();h.a.enabled(true);h.a.makeOverlay();const u=h.a.ui();for(let i=0;i<3;i++){u.launcher.emit('click');assert.equal(u.overlayMenu.hidden,false);assert.equal(u.launcher.getAttribute('aria-expanded'),'true');u.menuControls.close.emit('click');assert.equal(u.overlayMenu.hidden,true);assert.equal(h.doc.activeElement,u.launcher);}assert.equal(h.a.state().enabled,true);
});
test('overlay controls add fresh chats and apply width/equal settings directly',()=>{
 const h=harness();h.a.makeOverlay();h.a.setEnabled(true);const u=h.a.ui();u.menuControls.add.emit('click');assert.equal(h.a.state().panes.length,2);u.menuControls.width.value='480';u.menuControls.apply.emit('click');assert.equal(h.a.settings().paneWidth,480);u.menuControls.equal.checked=true;u.menuControls.equal.emit('change');assert.equal(h.a.settings().equalizeColumns,true);assert.equal(u.menuControls.width.disabled,true);
});
test('vertical rail keeps the top free regardless of old floating coordinates',()=>{
 const h=harness();h.a.enabled(true);h.a.prefs({sidebarVisible:false});h.a.makeOverlay();h.a.position({x:48,y:50});
 for(const width of [360,900,1844]){h.ctx.innerWidth=width;h.a.placeOverlay();const u=h.a.ui();assert.equal(u.overlay.style.left,'0px');assert.equal(u.overlay.style.top,'0px');assert.equal(u.overlay.style.width,'40px');assert.equal(u.overlayMenu.style.top,'0px');assert.equal(u.overlayMenu.style.left,'40px');}
 h.a.safeSave();assert.equal(h.saves.at(-1).overlayPosition.x,48);assert.equal(h.saves.at(-1).overlayPosition.y,50);
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
 const h=harness();h.a.enabled(true);h.a.makeOverlay();const u=h.a.ui();u.launcher.emit('click');u.overlayMenu.parentElement.emit('keydown',{key:'Escape'});assert(u.overlayMenu.hidden);u.launcher.emit('click');for(const fn of h.doc.listeners.pointerdown)fn({composedPath:()=>[]});assert(u.overlayMenu.hidden);u.launcher.emit('click');assert.equal(u.overlayMenu.hidden,false);assert.equal(h.a.state().enabled,true);
});

test('parked titles and restore buttons are directly present without nested disclosure',()=>{
 const h=harness(),p={id:'parked',title:'Named parked conversation',url:Core.ORIGIN+'/',newChat:true,width:480,visible:false};h.a.init([p]);h.a.enabled(true);h.a.makeOverlay();const u=h.a.ui();
 assert.equal(u.menuControls.parkedList.hidden,false);assert.equal(u.menuControls.parkedList.children[0].children[0].textContent,p.title);assert.equal(u.menuControls.parkedEntry,undefined);
 u.menuControls.parkedList.children[0].children[2].emit('click');assert.equal(p.visible,true);assert.equal(h.a.state().panes[0],p);assert.equal(p.width,480);
});
test('restoring empty or all-parked workspace never creates an extra conversation',()=>{
 const h=harness();h.a.setEnabled(true,true);assert.equal(h.a.state().panes.length,0);const p={id:'parked',visible:false};h.a.init([p]);h.a.setEnabled(true,true);assert.equal(h.a.state().panes.length,1);assert.equal(p.visible,false);
});

test('direct actions remain outside the closed menu and add exactly one chat from original mode',()=>{
 const h=harness();h.a.makeOverlay();const u=h.a.ui();assert.equal(u.overlayMenu.hidden,true);
 assert.equal(u.overlay.children[1],u.launcher);assert.equal(u.overlay.children[2],u.menuControls.sidebarVisible);assert.equal(u.overlay.children[3],u.menuControls.add);assert.equal(u.menuControls.padding,undefined);
 u.menuControls.add.emit('click');assert.equal(h.a.state().panes.length,1);assert.equal(h.a.state().enabled,true);assert.equal(u.overlayMenu.hidden,true);
 u.menuControls.sidebarVisible.emit('click');assert.equal(h.a.sidebarWidth(),0);assert.equal(u.menuControls.sidebarVisible.getAttribute('aria-label'),'左一覧を表示');assert.equal(u.overlayMenu.hidden,true);
 u.menuControls.sidebarVisible.emit('click');assert.equal(u.menuControls.sidebarVisible.getAttribute('aria-label'),'左一覧を隠す');assert.equal(u.overlayMenu.hidden,true);
});

test('native default and full reset use measured outer width while manual width stays independent',()=>{
 const h=harness();h.a.enabled(true);h.a.addNewChat();h.a.nativeCap(814);const p=h.a.state().panes[0];assert.equal(h.a.getPaneWidth(p),814);p.autoWidth=false;p.width=450;assert.equal(h.a.getPaneWidth(p),450);h.a.resetPaneWidths();assert.equal(h.a.getPaneWidth(p),814);assert.equal(p.autoWidth,true);assert.equal(h.a.settings().equalizeColumns,false);
});
test('sidebar drag, bounds and persisted lock prevent accidental width edits',()=>{
 const h=harness();h.a.makeOverlay();h.a.makeSidebarResize();h.a.enabled(true);const ui=h.a.ui(),handle=ui.sidebarHandle;
 handle.emit('pointerdown',{clientX:348,pointerId:1});handle.emit('pointermove',{clientX:380});handle.emit('pointerup');assert.equal(h.a.settings().sidebarWidth,380);assert.equal(h.saves.at(-1).settings.sidebarWidth,380);
 ui.menuControls.sidebarLock.emit('click');assert.equal(h.a.settings().sidebarLocked,true);assert.equal(ui.menuControls.sidebar.disabled,true);assert.equal(ui.menuControls.sidebarReset.disabled,true);
 handle.emit('pointerdown',{clientX:380,pointerId:2});handle.emit('pointermove',{clientX:500});handle.emit('pointerup');handle.emit('keydown',{key:'ArrowRight'});h.a.setSidebarWidth(500);assert.equal(h.a.settings().sidebarWidth,380);
 ui.menuControls.sidebarLock.emit('click');h.a.setSidebarWidth(900);assert.equal(h.a.settings().sidebarWidth,520);ui.menuControls.sidebarReset.emit('click');assert.equal(h.a.settings().sidebarWidth,Core.DEFAULTS.sidebarWidth);
});

test('hidden sidebar releases all width and restores width and lock with all panes parked',()=>{
 const h=harness();h.a.makeOverlay();h.a.makeSidebarResize();h.a.enabled(true);h.a.init([{id:'park',visible:false,width:450}]);h.a.prefs({sidebarWidth:380,sidebarLocked:true});
 h.a.toggleSidebar();assert.equal(h.a.sidebarWidth(),0);assert.equal(h.a.settings().sidebarWidth,380);assert.equal(h.a.settings().sidebarLocked,true);assert.equal(h.saves.at(-1).settings.sidebarVisible,false);assert.equal(h.a.ui().sidebarHandle.hidden,true);assert.equal(h.a.ui().overlay.hidden,false);
 h.a.toggleSidebar();assert.equal(h.a.sidebarWidth(),380);assert.equal(h.a.settings().sidebarLocked,true);assert.equal(h.a.state().panes.length,1);assert.equal(h.a.state().panes[0].visible,false);
});

test('fold and restore buttons keep the document, draft, width and keyboard focus',()=>{
 const h=harness(),p={id:'a',title:'A',visible:true,width:480,autoWidth:false,draft:'unsent'};
 h.a.init([p]);h.a.enabled(true);h.a.realRender(p);const entry=h.a.entries().get('a');
 const frame={draft:'live input'};entry.iframe=frame;
 entry.foldButton.emit('click');assert.equal(p.folded,true);assert.equal(p.visible,true);assert.equal(entry.root.style.width,'32px');assert.equal(h.doc.activeElement,entry.restoreButton);assert.equal(entry.restoreButton.hidden,false);
 entry.restoreButton.emit('click');assert.equal(p.folded,false);assert.equal(entry.root.style.width,'480px');assert.equal(h.doc.activeElement,entry.foldButton);assert.equal(entry.restoreButton.hidden,true);assert.equal(entry.iframe,frame);assert.equal(frame.draft,'live input');assert.equal(p.draft,'unsent');
 assert.equal(h.saves.at(-1).panes[0].width,480);
});
test('all-tab menu shows displayed folded parked and paused states and restores the selected pane only',()=>{
 const h=harness(),panes=[{id:'a',title:'A',visible:true},{id:'b',title:'B',visible:true,folded:true,width:510,draft:'keep'},{id:'c',title:'C',visible:false}];
 h.a.init(panes);h.a.enabled(true);h.a.makeOverlay();const list=h.a.ui().menuControls.parkedList;
 assert.equal(list.children.length,3);assert.match(list.children[0].children[1].textContent,/表示中/);assert.match(list.children[1].children[1].textContent,/折りたたみ中/);assert.match(list.children[2].children[1].textContent,/退避中/);
 list.children[1].children[2].emit('click');assert.equal(panes[1].folded,false);assert.equal(panes[1].draft,'keep');assert.equal(panes[2].visible,false);assert.match(list.children[1].children[1].textContent,/選択中/);
 h.a.enabled(false);h.a.syncOverlay();assert(list.children.every(row=>row.children[2].disabled));assert.match(list.children[0].children[1].textContent,/分割表示休止中/);
});
test('restore notice lives in menu and dismisses without saving, switching or dropping panes',()=>{
 const h=harness(),p={id:'a',title:'A',visible:true,draft:'keep'};h.a.init([p]);h.a.makeOverlay();const notice=h.a.notice(),u=h.a.ui(),before=h.saves.length;
 assert.equal(notice.parentElement,u.overlayMenu);assert.equal(notice.hidden,false);notice.children[1].emit('click');assert.equal(notice.hidden,true);assert.equal(h.saves.length,before);assert.equal(h.a.state().panes[0],p);assert.equal(p.draft,'keep');assert.equal(h.doc.activeElement,u.menuControls.close);
});


test('one double-click gesture creates one new chat while later distinct clicks remain independent',()=>{
 const h=harness();h.a.enabled(true);const b=control(h);h.a.handleNewChatClick(event(b,{detail:1}));h.a.handleNewChatClick(event(b,{detail:2}));assert.equal(h.a.state().panes.length,1);h.a.handleNewChatClick(event(b,{detail:1}));assert.equal(h.a.state().panes.length,2);
 h.a.makeOverlay();const add=h.a.ui().menuControls.add;add.emit('click',{detail:1});add.emit('click',{detail:2});assert.equal(h.a.state().panes.length,3);
});


test('folded controls restore independent widths and focus across multiple panes',()=>{
 const h=harness(),panes=[320,480,1400].map((width,i)=>({id:'width'+i,title:'Pane '+i,visible:true,width,autoWidth:false,draft:'draft'+i}));
 h.a.init(panes);h.a.enabled(true);for(const p of panes)h.a.realRender(p);
 for(const p of panes){const e=h.a.entries().get(p.id);e.foldButton.emit('click');assert.equal(e.root.style.width,'32px');assert.equal(e.restoreButton.hidden,false);assert.equal(h.doc.activeElement,e.restoreButton);}
 for(const p of panes){const e=h.a.entries().get(p.id);e.restoreButton.emit('click');assert.equal(e.root.style.width,p.width+'px');assert.equal(h.doc.activeElement,e.foldButton);assert.equal(p.draft,'draft'+panes.indexOf(p));}
});


test('legacy parked tab returns from list and then uses only the fold control',()=>{
 const h=harness(),p={id:'legacy',url:Core.ORIGIN+'/',newChat:true,title:'Legacy',visible:false,width:480,draft:'saved input'};
 h.a.init([p]);h.a.enabled(true);h.a.realRender(p);h.a.makeOverlay();
 h.a.ui().menuControls.parkedList.children[0].children[2].emit('click');
 const e=h.a.entries().get(p.id);assert.equal(p.visible,true);assert.equal(p.folded,false);assert.equal(p.draft,'saved input');
 assert.equal(e.root.children.some(x=>x.className==='pane-control pane-park'),false);
 e.foldButton.emit('click');assert.equal(p.visible,true);assert.equal(p.folded,true);assert.equal(p.draft,'saved input');assert.equal(h.a.state().panes.length,1);
});


test('approved left menu keeps actions outside and settings in a closed native disclosure',()=>{
 const h=harness();h.a.makeOverlay();const u=h.a.ui(),c=u.menuControls;
 assert.equal(c.displaySettings.tagName,'DETAILS');assert.equal(c.displaySettings.hasAttribute('open'),false);assert.equal(c.displaySettings.firstChild.tagName,'SUMMARY');
 assert.equal(c.tabsSection.parentElement,u.overlayMenu);assert.equal(c.groupsSection.parentElement,u.overlayMenu);assert.equal(c.displaySettings.parentElement,undefined);
 assert(u.overlayMenu.children.indexOf(c.tabsSection)<u.overlayMenu.children.indexOf(c.groupsSection));
 for(const action of [u.launcher,c.add,c.sidebarVisible,u.viewToggle])assert.equal(action.parentElement,u.overlay);
 assert.equal(c.width.parentElement.parentElement,c.displaySettings);assert.equal(c.groupName.parentElement.parentElement.parentElement,c.groupsSection);
});

test('left menu clamps narrow viewport and preserves long titles and tab statuses',()=>{
 const h=harness();h.ctx.innerWidth=240;h.ctx.innerHeight=300;const title='長い会話タイトル'.repeat(20);
 h.a.init([{id:'long',title,visible:true,folded:true}]);h.a.enabled(true);h.a.makeOverlay();const u=h.a.ui();u.launcher.emit('click');h.a.placeOverlay();
 assert.equal(u.overlayMenu.style.width,'120px');assert(parseFloat(u.overlayMenu.style.left)+120<=40+h.a.sidebarWidth());assert(parseFloat(u.overlayMenu.style.top)+parseFloat(u.overlayMenu.style.maxHeight)<=300);
 const row=u.menuControls.parkedList.children[0];assert.equal(row.children[0].textContent,title);assert.equal(row.children[0].title,title);assert.match(row.children[1].textContent,/折りたたみ中/);
});


test('compact tab name selects and right action folds without a duplicate selection button',()=>{
 const h=harness(),p={id:'a',title:'A',visible:true,width:480,draft:'keep'};h.a.init([p]);h.a.enabled(true);h.a.realRender(p);h.a.makeOverlay();
 let row=h.a.ui().menuControls.parkedList.children[0];assert.equal(row.children.length,3);assert.equal(row.children[0].tagName,'BUTTON');
 row.children[2].emit('click');assert.equal(p.folded,true);assert.equal(p.visible,true);
 row=h.a.ui().menuControls.parkedList.children[0];row.children[0].emit('click');assert.equal(p.folded,false);assert.equal(p.draft,'keep');
});

test('docked menu respects saved sidebar widths and ignores floating coordinates without deleting them',()=>{
 const h=harness();h.a.enabled(true);h.a.position({x:500,y:400});h.a.makeOverlay();
 for(const width of [180,348,461,520]){h.a.prefs({sidebarWidth:width,sidebarVisible:true});h.a.ui().launcher.emit('click');h.a.placeOverlay();const u=h.a.ui();assert.equal(u.overlay.style.left,'0px');assert.equal(u.overlay.style.width,'40px');assert.equal(u.overlayMenu.style.width,width+'px');assert.equal(u.overlayMenu.style.top,'0px');assert.equal(u.overlayMenu.style.left,'40px');assert.equal(h.a.settings().sidebarWidth,width);if(!u.overlayMenu.hidden)h.a.closeOverlay();}
});


test('save group button reveals local-date default and cancel preserves all data',()=>{
 const h=harness();h.a.makeOverlay();const c=h.a.ui().menuControls;assert(c.groupSaveDetails.hidden);const count=h.saves.length;
 c.groupStart.emit('click');const d=new Date(),expected=`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
 assert.equal(c.groupName.value,expected);assert.equal(c.groupSaveDetails.hidden,false);assert.equal(h.doc.activeElement,c.groupName);assert.equal(c.groupStart.getAttribute('aria-expanded'),'true');
 c.groupName.value='not saved';c.groupCancel.emit('click');assert(c.groupSaveDetails.hidden);assert.equal(h.saves.length,count);assert.equal(h.doc.activeElement,c.groupStart);
});

test('original view hides the entire toolbar and menu but preserves accessible tab state',()=>{
 const h=harness();h.a.init([{id:'a',title:'A',visible:true}]);h.a.makeOverlay();h.a.placeOverlay();const u=h.a.ui();assert.equal(u.overlay.hidden,true);assert.equal(u.overlayMenu.hidden,true);
 const row=u.menuControls.parkedList.children[0];assert.equal(row.children[2].getAttribute('aria-expanded'),'true');assert.match(row.children[1].className,/sr-only/);
});

test('original return button uses native flow and split restores the same button and draft',()=>{
 const h=harness();h.doc.body=new h.Element('body');const header=new h.Element('header');h.doc.body.appendChild(header);
 h.doc.querySelectorAll=()=>[header];h.doc.querySelector=()=>null;
 h.Element.prototype.attachShadow=function(){return new h.Element('shadow');};
 h.a.makeOverlay();const u=h.a.ui(),mount=header.children[0];
 assert.equal(mount.id,'cgww-return');assert.equal(u.overlay.hidden,true);assert.notEqual(u.viewToggle.parentElement,u.overlay);assert.equal(mount.style.display,'inline-flex');
 u.viewToggle.emit('click');const pane=h.a.state().panes[0],frame=h.a.entries().get(pane.id).iframe;frame.draft='unsent';
 assert.equal(u.viewToggle.parentElement,u.overlay);assert.equal(mount.style.display,'none');
 u.viewToggle.emit('click');assert.equal(u.overlay.hidden,true);assert.equal(mount.style.display,'inline-flex');
 u.viewToggle.emit('click');assert.equal(h.a.entries().get(pane.id).iframe,frame);assert.equal(frame.draft,'unsent');
 assert.deepEqual(h.doc.body.style,{});
});

test('workspace host has no layout box or stacking context that traps the toolbar behind native sidebar',()=>{
 const css=source.match(/:host\{([^}]+)\}/)[1];assert.match(css,/display:contents/);assert.doesNotMatch(css,/position:fixed|transform:|isolation:|opacity:/);
});

test('missing header puts return button before the conversation rather than after the composer',()=>{
 const h=harness();h.doc.body=new h.Element('body');const main=new h.Element('main'),conversation=new h.Element('div'),composer=new h.Element('textarea');main.append(conversation,composer);h.doc.body.appendChild(main);
 h.doc.querySelectorAll=()=>[];h.doc.querySelector=()=>main;h.Element.prototype.attachShadow=function(){return new h.Element('shadow');};
 h.a.makeOverlay();const mount=main.firstChild,u=h.a.ui();assert.equal(mount.id,'cgww-return');assert.equal(main.children[1],conversation);assert.equal(main.children[2],composer);assert.equal(mount.style.position,'sticky');assert.equal(mount.style.pointerEvents,'auto');
 u.viewToggle.emit('click');assert.equal(h.a.state().enabled,true);assert.equal(mount.hidden,true);
});

test('return button explicitly accepts pointer events inherited as none from a native header',()=>{
 assert.match(source,/returnHost\.style\.pointerEvents='auto'/);assert.match(source,/cursor:pointer;pointer-events:auto}button:focus-visible/);
});

test('rail keeps all four actions direct and gives the board full viewport height',()=>{
 const h=harness();h.a.makeOverlay();h.a.setEnabled(true);let u=h.a.ui();assert.equal(u.panel.style.top,'0px');assert.equal(u.panel.style.left,'388px');
 u.menuControls.sidebarVisible.emit('click');assert.equal(u.panel.style.left,'40px');assert.equal(u.panel.style.top,'0px');
 u.launcher.emit('click');assert.equal(u.overlayMenu.hidden,false);
 const count=h.a.state().panes.length;u.menuControls.add.emit('click');assert.equal(h.a.state().panes.length,count+1);
 u.viewToggle.emit('click');assert.equal(h.a.state().enabled,false);u.viewToggle.emit('click');assert.equal(h.a.state().enabled,true);assert.equal(u.panel.style.top,'0px');
});

test('copy URL prefers live conversation, falls back to saved URL, and rejects unsent roots',async()=>{
 const copies=[],prompts=[];const h=harness({navigator:{clipboard:{writeText:async value=>copies.push(value)}},prompt:(message,value)=>prompts.push(value)});
 const p={id:'copy',url:Core.ORIGIN+'/c/saved000',visible:true};h.a.init([p]);h.a.setEnabled(true);h.a.entries().get(p.id).iframe={contentWindow:{location:{href:Core.ORIGIN+'/c/current00'}}};
 await h.a.copyPaneUrl(p);assert.equal(copies[0],Core.ORIGIN+'/c/current00');
 h.a.entries().get(p.id).iframe={get contentWindow(){throw Error('cross origin');}};await h.a.copyPaneUrl(p);assert.equal(copies[1],p.url);
 h.ctx.navigator.clipboard.writeText=async()=>{throw Error('denied');};await h.a.copyPaneUrl(p);assert.equal(prompts[0],p.url);
 assert.equal(h.a.paneSourceUrl({id:'blank',url:Core.ORIGIN+'/',newChat:true}),null);
});
test('native conversation menu refuses generic labels, ambiguity, mismatched URLs and cross origin',()=>{
 const h=harness({getComputedStyle:()=>({visibility:'visible'})});const p={id:'menu',url:Core.ORIGIN+'/c/menu0000',visible:true};h.a.init([p]);h.a.setEnabled(true);
 let clicks=0,candidates=[];const button=label=>({getAttribute:()=>label,getClientRects:()=>[{}],click:()=>clicks++});const frame={contentDocument:{querySelectorAll:()=>candidates},contentWindow:{location:{origin:Core.ORIGIN,href:p.url}}};h.a.entries().get(p.id).iframe=frame;
 candidates=[button('More options')];assert.equal(h.a.openPaneNativeMenu(p),false);
 candidates=[button('Conversation options'),button('Conversation options')];assert.equal(h.a.openPaneNativeMenu(p),false);
 candidates=[button('Conversation options')];frame.contentWindow.location.href=Core.ORIGIN+'/c/other000';assert.equal(h.a.openPaneNativeMenu(p),false);
 frame.contentWindow.location.href=p.url;assert.equal(h.a.openPaneNativeMenu(p),true);assert.equal(clicks,1);
 frame.contentWindow.location.origin='https://other.example';assert.equal(h.a.openPaneNativeMenu(p),false);assert.equal(clicks,1);
 frame.contentWindow.location.origin=Core.ORIGIN;frame.contentWindow.location.href=Core.ORIGIN+'/';p.url=Core.ORIGIN+'/';assert.equal(h.a.openPaneNativeMenu(p),false);assert.equal(clicks,1);
});

test('gear opens extension options directly without changing panes or mode',()=>{
 const messages=[];const h=harness({chrome:{runtime:{sendMessage:(m,callback)=>{messages.push(m);callback({ok:true});}},storage:{local:{set:async()=>{}}}}});
 h.a.makeOverlay();h.a.setEnabled(true);const before=h.a.state().panes.slice(),u=h.a.ui();
 const gear=u.overlay.children.find(e=>e.getAttribute('aria-label')==='オプションを開く');assert.ok(gear);gear.emit('click');
 assert.equal(messages.length,1);assert.equal(messages[0].type,'CGWW_OPEN_OPTIONS');assert.equal(h.a.state().enabled,true);assert.deepEqual(h.a.state().panes,before);
 assert.equal(u.overlay.children.indexOf(u.menuControls.sidebarVisible),u.overlay.children.indexOf(u.launcher)+1);
});

test('hide and restore keep both rail controls usable with the same frame and width',()=>{
 const h=harness(),p={id:'keep',url:Core.ORIGIN+'/c/thread123',visible:true,width:480};h.a.init([p]);h.a.makeOverlay();h.a.setEnabled(true);const u=h.a.ui(),frame=h.a.entries().get(p.id).iframe;
 for(const width of [360,768,1844]){h.ctx.innerWidth=width;
  u.menuControls.sidebarVisible.emit('click');assert.equal(h.a.settings().sidebarVisible,false);assert.equal(u.overlay.hidden,false);assert.equal(u.menuControls.sidebarVisible.disabled,false);assert.equal(u.panel.style.left,'40px');
  u.launcher.emit('click');assert.equal(u.overlayMenu.hidden,false);u.menuControls.close.emit('click');assert.equal(u.overlayMenu.hidden,true);
  u.menuControls.sidebarVisible.emit('click');assert.equal(h.a.settings().sidebarVisible,true);assert.equal(u.overlay.hidden,false);assert.ok(parseFloat(u.panel.style.left)>40);assert.equal(h.a.entries().get(p.id).iframe,frame);assert.equal(p.width,480);
 }
});


test('split panel expands only its pane and restores original width and settings on close',()=>{
 const h=harness({CGWWLayout:{splitPanelOpen:d=>d.open}}),p={id:'a',title:'A',visible:true,width:480,autoWidth:false,draft:'keep'},q={id:'b',visible:true,width:600};
 h.a.init([p,q]);const doc={open:false};const before=JSON.stringify(p);h.a.syncSplitPane(p,doc,'/c/a');assert.equal(h.a.getPaneWidth(p),480);
 doc.open=true;h.a.syncSplitPane(p,doc,'/c/a');assert.equal(h.a.getPaneWidth(p),1100);assert.equal(h.a.getPaneWidth(q),600);
 h.a.resizeSplitWidth(p,1600);assert.equal(h.a.getPaneWidth(p),1600);assert.equal(JSON.stringify(p),before);
 doc.open=false;h.a.syncSplitPane(p,doc,'/c/a');assert.equal(h.a.getPaneWidth(p),480);assert.equal(JSON.stringify(p),before);
});
test('equalized siblings keep their width; manual split override resets on close or navigation',()=>{
 const h=harness({CGWWLayout:{splitPanelOpen:d=>d.open}}),p={id:'a',visible:true,width:480},q={id:'b',visible:true,width:600};h.a.init([p,q]);h.a.prefs({equalizeColumns:true});
 const initial=h.a.getPaneWidth(q),doc={open:true};h.a.syncSplitPane(p,doc,'/c/a');assert.equal(h.a.getPaneWidth(q),initial);assert.equal(h.a.getPaneWidth(p),1100);
 h.a.toggleSplitWidth(p);assert.equal(h.a.getPaneWidth(p),initial);h.a.syncSplitPane(p,doc,'/c/a');assert.equal(h.a.isSplitWide(p),false);
 doc.open=false;h.a.syncSplitPane(p,doc,'/c/a');doc.open=true;h.a.syncSplitPane(p,doc,'/c/a');assert.equal(h.a.isSplitWide(p),true);
 h.a.resizeSplitWidth(p,1700);h.a.syncSplitPane(p,{open:false},'/c/b');assert.equal(h.a.getPaneWidth(p),initial);assert.equal(h.a.settings().equalizeColumns,true);
});
test('wide button is reversible, preserves frame and drafts, and works without detection',()=>{
 const h=harness(),p={id:'a',title:'A',visible:true,width:480,draft:'keep'};h.a.init([p]);h.a.enabled(true);h.a.realRender(p);const e=h.a.entries().get('a'),frame={draft:'live'};e.iframe=frame;
 e.wideButton.emit('click');assert.equal(e.root.style.width,'1100px');assert.equal(e.wideButton.getAttribute('aria-pressed'),'true');
 h.a.syncSplitPane(p,{},'/c/a');assert.equal(h.a.isSplitWide(p),true,'first inspection must retain manual widening');
 e.foldButton.emit('click');assert.equal(e.root.style.width,'32px');e.restoreButton.emit('click');assert.equal(e.root.style.width,'1100px');
 e.wideButton.emit('click');assert.equal(e.root.style.width,'480px');assert.equal(e.iframe,frame);assert.equal(frame.draft,'live');assert.equal(p.draft,'keep');assert.equal(e.wideButton.getAttribute('aria-pressed'),'false');
});

test('live layout refresh expands and restores one frame without feeding split widths into siblings',()=>{
 const applied=[],inspected=[];const h=harness({CGWWLayout:{splitPanelOpen:d=>d.open,inspect:d=>{inspected.push(d);return {detected:true,outerMax:800,columns:[{contentMax:768}],scrollbarAllowance:0};},apply:(d,m)=>applied.push([d,m.columns.length])}});
 const p={id:'a',visible:true,autoWidth:true},q={id:'b',visible:true,autoWidth:true};h.a.init([p,q]);h.a.nativeCap(800);
 const d={open:true},other={open:false};
 for(const [pane,doc] of [[p,d],[q,other]])h.a.entries().set(pane.id,{root:new h.Element(),iframe:{_cgwwPane:pane,contentDocument:doc,contentWindow:{location:{origin:'https://chatgpt.com',href:'/c/'+pane.id}}}});
 h.a.refreshContentLayout();assert.equal(h.a.getPaneWidth(p),1100);assert.equal(h.a.getPaneWidth(q),800);assert.equal(inspected.includes(d),false);assert.ok(applied.some(([doc,n])=>doc===d&&n===0));
 p.folded=true;h.a.resizeSplitWidth(p,1600);h.a.refreshContentLayout();p.folded=false;assert.equal(h.a.getPaneWidth(p),1600);
 d.open=false;h.a.refreshContentLayout();assert.equal(h.a.getPaneWidth(p),800);assert.equal(h.a.getPaneWidth(q),800);
 d.open=true;h.a.refreshContentLayout();h.a.entries().get('a').iframe.contentWindow.location.origin='https://example.com';h.a.refreshContentLayout();assert.equal(h.a.getPaneWidth(p),800);
});

test('fold all retains documents, inputs, widths, active pane and hidden legacy panes; individual restore works',()=>{
 const h=harness(),panes=[{id:'a',title:'A',visible:true,width:480,draft:'A input'},{id:'b',title:'B',visible:true,width:600,folded:true},{id:'c',title:'C',visible:false,width:700}];
 h.a.init(panes);h.a.enabled(true);for(const p of panes)h.a.realRender(p);h.a.state().activeId='a';h.a.makeOverlay();
 const u=h.a.ui();assert.equal(u.overlay.children.indexOf(u.menuControls.foldAll),u.overlay.children.indexOf(u.menuControls.add)+1);assert.equal(u.menuControls.tabsSection.children.includes(u.menuControls.foldAll),false);assert.equal(u.menuControls.foldAll.getAttribute('aria-label'),'全部縮小');
 const frames=panes.map(p=>{const f={draft:'live '+p.id};h.a.entries().get(p.id).iframe=f;return f;});
 h.a.ui().menuControls.foldAll.emit('click');assert.equal(panes[0].folded,true);assert.equal(panes[1].folded,true);assert.equal(panes[2].folded,undefined);assert.equal(panes[2].visible,false);assert.equal(h.a.state().activeId,'a');
 const saves=h.saves.length;h.a.ui().menuControls.foldAll.emit('click');assert.equal(h.saves.length,saves);
 panes.forEach((p,i)=>{assert.equal(h.a.entries().get(p.id).iframe,frames[i]);assert.equal(frames[i].draft,'live '+p.id);});
 const e=h.a.entries().get('a');assert.equal(e.foldedCloseButton.hidden,false);e.restoreButton.emit('click');assert.equal(e.root.style.width,'480px');assert.equal(e.foldedCloseButton.hidden,true);assert.equal(panes[0].draft,'A input');
});
test('folded close is a separate control that calls normal close without restoring',()=>{
 const h=harness(),p={id:'a',title:'A',visible:true,width:480};h.a.init([p]);h.a.enabled(true);h.a.realRender(p);const e=h.a.entries().get('a');
 assert.equal(e.foldedCloseButton.hidden,true);e.foldButton.emit('click');assert.equal(e.foldedCloseButton.hidden,false);
 const event=e.foldedCloseButton.emit('click');assert.equal(event.stopped,true);assert.equal(h.a.state().panes.length,0);assert.equal(h.a.entries().has('a'),false);assert.equal(p.folded,true);
});

function reorderFixture(folded){
 const h=harness(),panes=['a','b','c'].map((id,i)=>({id,title:id,url:Core.ORIGIN+'/c/thread00'+id,visible:true,width:480+i*80,folded:folded[i],draft:'draft '+id}));
 h.a.init(panes);h.a.enabled(true);for(const p of panes){h.a.realRender(p);const e=h.a.entries().get(p.id);e.iframe={draft:'live '+p.id};e.root.getBoundingClientRect=()=>({left:40,width:parseFloat(e.root.style.width),height:700,top:0});}h.a.state().activeId='a';return {h,panes};
}
function transfer(){const data={};return {types:[],setData(k,v){data[k]=v;this.types=Object.keys(data);},getData(k){return data[k]||'';}};}
function dragPane(h,from,to,after){
 const p=h.a.state().panes.find(p=>p.id===from),src=h.a.entries().get(from),dst=h.a.entries().get(to),grip=p.folded?src.foldedGrip:src.grip,dataTransfer=transfer();
 grip.emit('dragstart',{dataTransfer});assert.equal(dataTransfer.effectAllowed,'move');
 const rect=dst.root.getBoundingClientRect(),clientX=rect.left+rect.width*(after?.75:.25);
 assert.equal(dst.root.emit('dragover',{dataTransfer,clientX}).defaultPrevented,true);
 const drop=dst.root.emit('drop',{dataTransfer,clientX});assert.equal(drop.defaultPrevented,true);assert.equal(drop.stopped,true);grip.emit('dragend');
}
for(const folded of [[false,false,false],[true,true,true],[true,false,true]])test('drag reorders both directions repeatedly and persists mixed fold state '+folded,()=>{
 const {h,panes}=reorderFixture(folded),frames=panes.map(p=>h.a.entries().get(p.id).iframe);
 const order=()=>Array.from(h.a.state().panes,p=>p.id);
 for(let i=0;i<3;i++){
  dragPane(h,'a','c',true);assert.deepEqual(order(),['b','c','a']);
  dragPane(h,'a','b',false);assert.deepEqual(order(),['a','b','c']);
 }
 dragPane(h,'c','a',false);assert.deepEqual(order(),['c','a','b']);
 const restored=Core.restoreWorkspacePanes(h.saves.at(-1).panes,()=>{throw Error('ids should survive');});
 assert.deepEqual(restored.map(p=>p.id),['c','a','b']);
 const resumed=harness();resumed.a.init(restored);resumed.a.enabled(true);for(const p of restored)resumed.a.realRender(p);
 for(const [i,p]of h.a.state().panes.entries()){
  const e=h.a.entries().get(p.id);assert.equal(e.root.style.order,String(i));assert.equal(e.foldedGrip.getAttribute('aria-label'),`列 ${i+1} を移動`);assert.equal(e.grip.getAttribute('aria-label'),e.foldedGrip.getAttribute('aria-label'));
  assert.equal(e.root.listeners.drop.length,1);assert.equal(e.foldedGrip.hidden,!p.folded);assert.equal(resumed.a.entries().get(p.id).foldedGrip.hidden,!p.folded);
 }
 panes.forEach((p,i)=>{assert.equal(h.a.entries().get(p.id).iframe,frames[i]);assert.equal(frames[i].draft,'live '+p.id);assert.equal(p.draft,'draft '+p.id);assert.equal(p.width,480+i*80);});assert.equal(h.a.state().activeId,'a');
 const a=h.a.entries().get('a');h.a.setPaneFolded(panes[0],true);assert.equal(a.foldedGrip.hidden,false);assert.equal(a.foldedGrip.textContent,a.grip.textContent);a.foldedGrip.emit('click');assert.equal(panes[0].folded,true);
 a.restoreButton.emit('click');assert.equal(a.foldedGrip.hidden,true);assert.equal(panes[0].folded,false);assert.deepEqual(order(),['c','a','b']);
});
test('folded keyboard handle moves across visible siblings and ignores hidden legacy panes',()=>{
 const {h,panes}=reorderFixture([true,false,true]);panes[1].visible=false;const e=h.a.entries().get('a');e.foldedGrip.focus();
 e.foldedGrip.emit('keydown',{altKey:true,key:'ArrowRight'});assert.deepEqual(Array.from(h.a.state().panes,p=>p.id),['b','c','a']);assert.equal(h.doc.activeElement,e.foldedGrip);
 e.foldedGrip.emit('keydown',{altKey:true,key:'ArrowLeft'});assert.deepEqual(Array.from(h.a.state().panes,p=>p.id),['b','a','c']);
 const count=h.saves.length;e.foldedGrip.emit('keydown',{altKey:true,key:'ArrowLeft'});e.foldedGrip.emit('keydown',{key:'ArrowRight'});assert.equal(h.saves.length,count);assert.equal(panes[0].folded,true);
});
test('cancelled drag, foreign files/links, self-drop and mismatched ids never reorder',()=>{
 const {h}=reorderFixture([true,false,true]),a=h.a.entries().get('a'),b=h.a.entries().get('b');
 const unchanged=()=>assert.deepEqual(Array.from(h.a.state().panes,p=>p.id),['a','b','c']);
 for(const types of [['Files'],['text/uri-list'],[Core.PANE_DRAG_TYPE,'Files']]){
  const dt=transfer();a.foldedGrip.emit('dragstart',{dataTransfer:dt});dt.types=types;
  assert.equal(b.root.emit('dragover',{dataTransfer:dt}).defaultPrevented,undefined);assert.equal(b.root.emit('drop',{dataTransfer:dt}).defaultPrevented,undefined);a.foldedGrip.emit('dragend');unchanged();
 }
 const dt=transfer();a.foldedGrip.emit('dragstart',{dataTransfer:dt});a.foldedGrip.emit('dragend');assert.equal(b.root.emit('drop',{dataTransfer:dt}).defaultPrevented,undefined);
 a.foldedGrip.emit('dragstart',{dataTransfer:dt});dt.setData(Core.PANE_DRAG_TYPE,'c');assert.equal(b.root.emit('drop',{dataTransfer:dt}).defaultPrevented,undefined);a.foldedGrip.emit('dragend');unchanged();
 const saves=h.saves.length;dragPane(h,'a','a',false);assert.equal(h.saves.length,saves);unchanged();
 assert.equal(a.restoreButton.draggable,undefined);assert.equal(a.foldedCloseButton.draggable,undefined);assert.equal(a.spine.draggable,undefined);
});

test('sidebar boundary follows the board through widths, hiding and locking without intercepting input',()=>{
 assert.match(source,/\.board::before\{[^}]*left:0;top:0;bottom:0;width:1px;[^}]*pointer-events:none/);
 const h=harness();h.a.makeOverlay();h.a.setEnabled(true);
 for(const width of [180,340,520]){h.a.setSidebarWidth(width);assert.equal(h.a.ui().panel.style.left,`${40+width}px`);h.a.ui().menuControls.sidebarLock.emit('click');assert.equal(h.a.ui().panel.style.left,`${40+width}px`);h.a.ui().menuControls.sidebarLock.emit('click');}
 h.a.toggleSidebar();assert.equal(h.a.ui().panel.style.left,'40px');h.a.toggleSidebar();assert.equal(h.a.ui().panel.style.left,'560px');h.a.setEnabled(false);assert.equal(h.a.ui().panel.hidden,true);
});

test('main identifies only the parent page, not an active pane or duplicate new-chat URLs',()=>{
 const h=harness(),panes=['a','b'].map(id=>({id,title:id,url:Core.ORIGIN+'/',newChat:true,visible:true,width:480,draft:'keep '+id}));
 h.a.init(panes);h.a.enabled(true);for(const p of panes)h.a.realRender(p);h.a.makeOverlay();const u=h.a.ui(),frames=panes.map(p=>h.a.entries().get(p.id).iframe);
 assert.equal(u.menuControls.mainEntry.textContent,'メイン（元画面）を表示');
 for(const p of panes){h.a.state().activeId=p.id;h.a.syncOverlay();h.a.setPaneFolded(p,true);const e=h.a.entries().get(p.id);assert.match(e.root.getAttribute('aria-label'),/^分割タブ/);assert.match(e.spine.getAttribute('aria-label'),/^分割タブ:/);assert.equal(e.root.getAttribute('aria-label').includes('メイン'),false);e.restoreButton.emit('click');}
 for(let i=0;i<3;i++){u.menuControls.mainEntry.emit('click');assert.equal(h.a.state().enabled,false);assert.equal(u.viewToggle.textContent,'メイン · 分割へ');assert.match(u.viewToggle.getAttribute('aria-label'),/^メインチャット表示中/);u.viewToggle.emit('click');assert.equal(h.a.state().enabled,true);assert.equal(u.viewToggle.textContent,'メイン（元画面）');}
 panes.forEach((p,i)=>{assert.equal(h.a.entries().get(p.id).iframe,frames[i]);assert.equal(p.draft,'keep '+p.id);});
 assert.match(source,/overlay-view::after\{content:'メイン';font:9px\/10px system-ui/);assert.match(source,/overlay-view\{display:flex;flex-direction:column;align-items:center;justify-content:center/);
 for(const width of [360,900,1844]){h.ctx.innerWidth=width;h.a.placeOverlay();assert.equal(u.overlay.style.width,'40px');assert.equal(u.overlay.children.indexOf(u.menuControls.foldAll),u.overlay.children.indexOf(u.menuControls.add)+1);}
});

test('native title reader ignores conflicting sidebar names and unrelated conversation IDs',()=>{
 const h=harness(),url=Core.ORIGIN+'/c/fixture001',key=Core.conversationKey(url);
 const link=(href,text)=>({href,textContent:text,cloneNode:()=>({textContent:text,querySelectorAll:()=>[]})});
 const doc={querySelectorAll:()=>[{querySelectorAll:()=>[link(url,'First'),link(url,'Other'),link(Core.ORIGIN+'/','Draft')]}]};
 assert.equal(h.a.readNativeTitles(doc).size,0);
 doc.querySelectorAll=()=>[{querySelectorAll:()=>[link(url,'First'),link(Core.ORIGIN+'/c/fixture002','Second')]}];
 assert.equal(h.a.readNativeTitles(doc,key).get(key),'First');assert.equal(h.a.readNativeTitles(doc,key).size,1);
});
test('title sync updates real pane controls, folded spine and list while preserving editor focus and iframe',()=>{
 const h=harness(),url=Core.ORIGIN+'/c/fixture001',p={id:'a',url,title:'Old',titleMode:'native',visible:true,folded:true,width:480};
 h.a.init([p]);h.a.realRender(p);h.a.makeOverlay();h.a.ready();
 const entry=h.a.entries().get('a');let name='Native';
 h.doc.querySelectorAll=()=>[{querySelectorAll:()=>[{href:url,cloneNode:()=>({textContent:name,querySelectorAll:()=>[]})}]}];
 h.a.syncNativeTitles();assert.equal(p.title,'Native');assert.equal(entry.title.value,'Native');assert.equal(entry.spine.firstChild.textContent,'Native');
 entry.title.focus();h.doc.activeElement={};entry.title.value='Typing';h.a.shadowFocus(entry.title);name='Later';h.a.syncNativeTitles();assert.equal(entry.title.value,'Typing');assert.equal(p.title,'Native');
 entry.title.emit('change');assert.equal(p.titleMode,'local');assert.equal(p.title,'Typing');
 entry.title.value='';entry.title.emit('change');assert.equal(p.titleMode,'native');assert.equal(p.title,'Later');
 h.a.shadowFocus(null);h.doc.activeElement=null;entry.title.emit('blur');assert.equal(entry.title.value,'Later');assert.equal(h.a.ui().menuControls.parkedList.children[0].children[0].textContent,'Later');

});

test('title reader strips menu labels and decorations rather than using action aria-label',()=>{
 const h=harness(),url=Core.ORIGIN+'/c/fixture001';let cleaned=false;
 const copy={get textContent(){return cleaned?'Conversation':'Conversation Open menu';},querySelectorAll(selector){assert.match(selector,/button/);return [{remove(){cleaned=true;}}];}};
 const link={href:url,getAttribute:()=> 'Open conversation menu',cloneNode:()=>copy};
 const doc={querySelectorAll:()=>[{querySelectorAll:()=>[link]}]};
 assert.equal(h.a.readNativeTitles(doc).get(Core.conversationKey(url)),'Conversation');
});

function branchFixture(){
 const h=harness(),p={id:'original',url:Core.ORIGIN+'/c/original123',title:'Original',visible:true,width:480,draft:'keep'};
 h.a.init([p]);h.a.realRender(p);h.a.useRealRender();h.a.enabled(true);
 const original={contentWindow:{location:{href:p.url}},draft:'untouched',attachment:'untouched'};h.a.entries().get(p.id).iframe=original;
 const pending=h.a.prepareBranch(p),frame=h.a.entries().get(pending.id).iframe;
 frame.contentWindow={location:{href:p.url}};return {h,p,pending,frame,original};
}
function branchEvent(label='Branch in new chat'){
 const control={textContent:label,closest:()=>control,matches:()=>true};
 return {button:0,target:control,composedPath:()=>[control],preventDefault(){this.prevented=true},stopImmediatePropagation(){this.stopped=true}};
}
test('branch preparation is adjacent and idempotent; native action adopts new conversation without replacing original',()=>{
 const {h,p,pending,frame,original}=branchFixture();assert.equal(h.a.prepareBranch(p),pending);assert.equal(h.a.state().panes.length,2);
 assert.equal(h.a.handleBranchClick(branchEvent(),pending),false);
 frame.contentWindow.location.href=Core.ORIGIN+'/c/branched123';h.a.checkBranchLocation(pending);
 assert.equal(pending.branchSource,undefined);assert.equal(pending.url,Core.ORIGIN+'/c/branched123');assert.equal(h.a.entries().get(pending.id).iframe,frame);
 assert.equal(h.a.entries().get(p.id).iframe,original);assert.equal(original.attachment,'untouched');assert.equal(p.draft,'keep');assert.equal(p.url,Core.ORIGIN+'/c/original123');
 assert.equal(h.a.entries().get(pending.id).branchButton.textContent,'分岐');
});
test('unarmed or cancelled navigation is never treated as branch; authentication fails closed',()=>{
 const {h,pending,frame}=branchFixture();frame.contentWindow.location.href=Core.ORIGIN+'/c/unrelated123';h.a.checkBranchLocation(pending);assert.ok(pending.branchSource);
 frame.contentWindow.location.href=pending.branchOrigin;h.a.handleBranchClick(branchEvent(),pending);h.a.handleBranchClick(branchEvent('Another command'),pending);
 frame.contentWindow.location.href=Core.ORIGIN+'/c/unrelated123';h.a.checkBranchLocation(pending);assert.ok(pending.branchSource);
 frame.contentWindow.location.href=pending.branchOrigin;h.a.handleBranchClick(branchEvent(),pending);frame.contentWindow.location.href='https://auth.openai.com/';h.a.checkBranchLocation(pending);
 frame.contentWindow.location.href=Core.ORIGIN+'/c/branched123';h.a.checkBranchLocation(pending);assert.ok(pending.branchSource);
});
test('branching original native menu is redirected to safe preparation, roots rejected, source navigation not overwritten',()=>{
 const {h,p,pending,frame,original}=branchFixture(),e=branchEvent();assert.equal(h.a.handleBranchClick(e,p),true);assert.ok(e.prevented);assert.equal(h.a.state().panes.length,2);
 assert.equal(h.a.prepareBranch({id:'draft',url:Core.ORIGIN+'/',newChat:true}),undefined);
 h.a.handleBranchClick(branchEvent(),pending);original.contentWindow.location.href=Core.ORIGIN+'/c/different123';frame.contentWindow.location.href=Core.ORIGIN+'/c/branched123';h.a.checkBranchLocation(pending);assert.ok(pending.branchSource);
});
test('pending branch and its drafts survive persistence without merging into original; no branch action is persisted',()=>{
 const {h,p,pending}=branchFixture();pending.draft='pending text';const snapshot=h.a.safeSave();let n=0;
 const restored=Core.restoreWorkspacePanes(snapshot.panes,()=>String(++n));assert.equal(restored.length,2);assert.equal(restored[1].branchSource,p.id);assert.equal(restored[1].draft,'pending text');assert.equal(restored[0].draft,'keep');assert.equal(snapshot.panes[1].expires,undefined);
});
test('existing branch is reused and reordered, preparation input remains untouched',()=>{
 const {h,pending,frame}=branchFixture();const existing={id:'existing',url:Core.ORIGIN+'/c/branched123',title:'Existing',visible:true,width:480};h.a.state().panes.push(existing);h.a.realRender(existing);
 pending.draft='preserve preparation';h.a.handleBranchClick(branchEvent(),pending);frame.contentWindow.location.href=existing.url;h.a.checkBranchLocation(pending);
 assert.equal(h.a.state().panes[1],existing);assert.equal(pending.draft,'preserve preparation');assert.ok(pending.branchSource);
});

test('expired branch, cancel URL import and removed source never alter original or finish preparation',()=>{
 const {h,p,pending,frame}=branchFixture();h.a.expireBranch(pending);frame.contentWindow.location.href=Core.ORIGIN+'/c/branched123';h.a.checkBranchLocation(pending);assert.ok(pending.branchSource);
 h.ctx.prompt=()=>null;h.a.importBranchUrl(pending);assert.equal(h.a.state().panes.length,2);
 h.a.state().panes.splice(0,1);assert.equal(h.a.finishBranch(pending,frame.contentWindow.location.href),false);assert.equal(p.url,Core.ORIGIN+'/c/original123');
});
test('separate source columns keep independent preparation sessions and group restore retains preparation drafts',()=>{
 const {h,p,pending}=branchFixture();const other={...p,id:'other',url:Core.ORIGIN+'/c/other123',title:'Other'};h.a.state().panes.push(other);h.a.realRender(other);h.a.entries().get(other.id).iframe.contentWindow={location:{href:other.url}};
 const second=h.a.prepareBranch(other);assert.equal(second.branchSource,other.id);assert.equal(pending.branchSource,p.id);assert.equal(h.a.state().panes.indexOf(second),h.a.state().panes.indexOf(other)+1);
 const snapshot={panes:[{...p,id:'savedOriginal'},{...pending,id:'savedPrep',branchSource:'savedOriginal',draft:'group input'}]};h.a.mergeGroupPanes(snapshot);
 assert.equal(pending.branchSource,p.id);assert.ok(pending.draftBackups.includes('group input'));assert.equal(p.draft,'keep');const count=h.a.state().panes.length;h.a.mergeGroupPanes(snapshot);assert.equal(h.a.state().panes.length,count);
});

test('manual branch URL import rejects changed, root, auth and inaccessible original documents',()=>{
 for(const href of [Core.ORIGIN+'/c/different123',Core.ORIGIN+'/', 'https://auth.openai.com/']){
  const {h,pending,original}=branchFixture();original.contentWindow.location.href=href;h.ctx.prompt=()=>Core.ORIGIN+'/c/branched123';h.a.importBranchUrl(pending);assert.equal(h.a.state().panes.length,2);
 }
 const {h,pending,original}=branchFixture();Object.defineProperty(original,'contentWindow',{get(){throw Error('cross-origin')}});h.ctx.prompt=()=>Core.ORIGIN+'/c/branched123';h.a.importBranchUrl(pending);assert.equal(h.a.state().panes.length,2);
});
test('memory confirmation cancellation prevents branch preparation and manual URL addition',()=>{
 const {h,p,pending}=branchFixture();for(let i=0;i<7;i++)h.a.state().panes.push({id:'extra'+i,url:Core.ORIGIN+'/c/extra00'+i,visible:true});
 h.ctx.confirm=()=>false;h.ctx.prompt=()=>Core.ORIGIN+'/c/branched123';const before=h.a.state().panes.length;h.a.importBranchUrl(pending);assert.equal(h.a.state().panes.length,before);
 h.a.state().panes.splice(h.a.state().panes.indexOf(pending),1);assert.equal(h.a.prepareBranch(p),undefined);assert.equal(h.a.state().panes.length,before-1);
});

test('observed native provisional branch URL is adopted without reload and later follows saved URL',()=>{
 const {h,pending,frame,original,p}=branchFixture();const provisional=Core.ORIGIN+'/c/local-chatgpt%3A1647ed5a-3d27-42bc-a768-552610a7bc2d';
 assert.equal(Core.chatUrl(provisional),provisional);assert.equal(Core.chatUrl(provisional+'-extra'),null);
 h.a.handleBranchClick(branchEvent('新しいチャットに分岐'),pending);frame.contentWindow.location.href=provisional;h.a.checkBranchLocation(pending);
 assert.equal(pending.url,provisional);assert.equal(pending.branchSource,undefined);assert.equal(h.a.entries().get(p.id).iframe,original);
 frame.contentWindow.location.href=Core.ORIGIN+'/c/saved123';h.a.syncNewChatLocation(frame);assert.equal(pending.url,Core.ORIGIN+'/c/saved123');
});

test('manual import never reports placement success after cancellation or pane limit',()=>{
 for(const count of [8,200]){
  const {h,pending}=branchFixture(),messages=[];h.a.recordStatus(t=>messages.push(t));
  while(h.a.state().panes.length<count)h.a.state().panes.push({id:'extra'+h.a.state().panes.length,url:null,visible:true});
  h.ctx.confirm=()=>false;h.ctx.prompt=()=>Core.ORIGIN+'/c/branched123';h.a.importBranchUrl(pending);
  assert.equal(h.a.state().panes.length,count);assert.ok(messages.every(t=>!t.includes('配置しました')));
 }
});

test('provisional URL case variants share identity and cannot create preparation or a fresh imported frame',()=>{
 const upper=Core.ORIGIN+'/c/local-chatgpt%3A1647ED5A-3D27-42BC-A768-552610A7BC2D',lower=upper.toLowerCase();
 assert.equal(Core.chatUrl(upper),Core.chatUrl(lower));assert.equal(Core.conversationKey(upper),Core.conversationKey(lower));
 assert.equal(Core.isProvisionalChat(upper),true);assert.equal(Core.isProvisionalChat(lower),true);assert.equal(Core.isProvisionalChat(lower+'-invalid'),false);
 const {h,p,pending,original}=branchFixture();original.contentWindow.location.href=lower;assert.equal(h.a.prepareBranch(p),undefined);
 original.contentWindow.location.href=p.url;h.ctx.prompt=()=>lower;h.a.importBranchUrl(pending);assert.equal(h.a.state().panes.length,2);
 const existing={id:'provisional',url:upper,title:'Existing branch',visible:true,width:480};h.a.state().panes.push(existing);h.a.realRender(existing);
 const frame=h.a.entries().get(existing.id).iframe;const beforeOrder=h.a.state().panes.map(x=>x.id);h.a.importBranchUrl(pending);assert.deepEqual(h.a.state().panes.map(x=>x.id),beforeOrder);frame.contentWindow={location:{href:upper}};
 h.a.importBranchUrl(pending);assert.equal(h.a.state().panes.length,3);assert.equal(h.a.state().panes[1],existing);assert.equal(h.a.entries().get(existing.id).iframe,frame);
});
