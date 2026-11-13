const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const ROOT = path.resolve(process.env.CGWW_SOURCE || path.join(__dirname, '..', 'extension'));
const Core = require(path.join(ROOT, 'core.js'));

// Behavioral event-boundary tests, not browser geometry tests. DOM double
// deliberately models menu ancestry and separate iframe Element realms.
function harness() {
  let document;
  class Element {
    constructor(tag='div', attrs={}, parent=null) {
      this.tagName=tag.toUpperCase(); this.attributes=attrs; this.parentElement=parent;
      this.ownerDocument=document; this.textContent=''; this.innerText=''; this.style={}; this.hidden=false; this.children=[];
    }
    setAttribute(k,v){this.attributes[k]=String(v);}
    removeAttribute(k){delete this.attributes[k];}
    appendChild(child){this.children.push(child);child.parentElement=this;return child;}
    remove(){this.removed=true;}
    getClientRects(){return this.noRects?[]:[{}];}
    getAttribute(k){return this.attributes[k] ?? null;}
    hasAttribute(k){return Object.hasOwn(this.attributes,k);}
    matches(selector){
      return selector.split(',').some(s=>{
        s=s.trim();
        if(s==='a[href]') return this.tagName==='A'&&Boolean(this.href);
        if(s==='button') return this.tagName==='BUTTON';
        if(s.startsWith('#'))return this.getAttribute('id')===s.slice(1);
        if(s==='aside'||s==='nav'||s==='dialog') return this.tagName===s.toUpperCase();
        const match=s.match(/^\[([^=\]]+)(?:=["']?([^"'\]]+)["']?)?\]$/);
        return match ? (match[2]===undefined?this.hasAttribute(match[1]):this.getAttribute(match[1])===match[2]) : false;
      });
    }
    closest(selector){for(let e=this;e;e=e.parentElement)if(e.matches(selector))return e;return null;}
  }
  const observerInstances=[];
  document={getElementById(){return null;},defaultView:null,menus:[],listeners:{},
    querySelectorAll(selector){return [...this.menus,...(this.dialogs||[])].filter(node=>node.matches(selector));},createElement:tag=>new Element(tag),
    addEventListener(type,fn){this.listeners[type]=fn;},removeEventListener(type){delete this.listeners[type];}};
  document.body=new Element('body');document.documentElement=new Element('html');
  const sandbox={URL,Element,document,CGWWCore:Core,location:{pathname:'/',href:Core.ORIGIN+'/'},
    getComputedStyle:el=>({position:el.position||(el.hasAttribute('data-cgww-native-menu-position')?'relative':'static'),visibility:el.visibility||'visible',display:el.display||'block'}),
    MutationObserver:class {constructor(fn){this.fn=fn;observerInstances.push(this);}observe(target,options){this.target=target;this.options=options;}disconnect(){this.disconnected=true;}},
    addEventListener(){},removeEventListener(){},cancelAnimationFrame(){}};
  sandbox.window=sandbox;sandbox.top=sandbox;document.defaultView=sandbox;
  const source=fs.readFileSync(path.join(ROOT,'workspace.js'),'utf8');
  const context=vm.createContext(sandbox);
  vm.runInContext(source.replace('  void initialize();',`globalThis.hooks={
    isNativeActionMenuEvent,handleHistoryClick,handleNewChatClick,attachEmbeddedNavigation,
    syncNativeMenus,startNativeMenuWatch,stopNativeMenuWatch,syncNativeModal,syncNativePageRoute,
    getHost(){return host;},getModal(){return nativeModalOpen;},route(value){location.href=value;},
    setRoute(value){nativePageRoute=value;},
    newCalls:[],modeCalls:[],sidebarCalls:[],
    attachHost(){host=document.createElement("div");releaseMasterSidebar=()=>this.sidebarCalls.push("release");ensureMasterSidebar=()=>this.sidebarCalls.push("restore");},
    enable(){state.enabled=true;},prefs(value){settings=Core.normalizeSettings(value);},rejectAdds(){addNewChat=assignToActive=()=>false;},
    calls:[],capture(){assignToActive=(...args)=>this.calls.push(args);closeOverlay=()=>{};addNewChat=(...args)=>this.newCalls.push(args);setEnabled=value=>{this.modeCalls.push(value);state.enabled=value;};}
  };`),context);
  sandbox.hooks.enable();sandbox.hooks.capture();
  function el(tag,attrs,parent){return new Element(tag,attrs,parent);}
  return {h:sandbox.hooks,el,Element,document,observerInstances};
}
function click(target,extra={}) {
  return {target,button:0,clientX:500,defaultPrevented:false,
    preventDefault(){this.defaultPrevented=true;},stopImmediatePropagation(){this.stopped=true;},...extra};
}
function assertNative(h,e){h.handleHistoryClick(e);assert.equal(e.defaultPrevented,false);assert.equal(e.stopped,undefined);assert.equal(h.calls.length,0);}

for(const role of ['menu','menuitem','menuitemcheckbox','menuitemradio']) {
  test(`native ${role} button and nested action link stay native`,()=>{
    const {h,el}=harness();const menu=el('div',{role});
    const button=el('button',{},menu);button.textContent='アーカイブ';
    assertNative(h,click(button));
    const a=el('a',{},menu);a.href=Core.ORIGIN+'/c/fixture123';
    assertNative(h,click(el('span',{},a)));
  });
}
test('Radix native menu content without a role preserves project action links',()=>{
  const {h,el}=harness();const menu=el('div',{'data-radix-menu-content':''});
  const a=el('a',{},menu);a.href=Core.ORIGIN+'/c/fixture123';a.textContent='プロジェクトへ追加';
  assertNative(h,click(a));
});
test('composedPath native menu semantics protect a retargeted event',()=>{
  const {h,el}=harness();const host=el('a');host.href=Core.ORIGIN+'/c/fixture123';
  const menu=el('div',{role:'menu'});
  assertNative(h,click(host,{composedPath:()=>[host,menu]}));
});
test('menu new-chat action is not converted to a split-view draft',()=>{
  const {h,el}=harness();const menu=el('div',{role:'menu'});
  const b=el('button',{'data-testid':'new-chat-button','aria-label':'新しいチャット'},menu);
  const e=click(b);assert.equal(h.handleNewChatClick(e),false);assertNative(h,e);
});
test('ordinary sidebar history link remains intercepted outside action menus',()=>{
  const {h,el}=harness();const nav=el('aside'),a=el('a',{},nav);
  a.href=Core.ORIGIN+'/c/fixture123';a.innerText='Dummy history';
  const e=click(a);h.handleHistoryClick(e);
  assert.equal(e.defaultPrevented,true);assert.equal(e.stopped,true);assert.equal(h.calls.length,1);
  assert.equal(h.calls[0][0],a.href);
});
test('ordinary unrelated button is not classified as a native action menu',()=>{
  const {h,el}=harness();assert.equal(h.isNativeActionMenuEvent(click(el('button'))),false);
});
test('embedded menu chat-link click retains native handler and propagation',()=>{
  const {h,el,Element}=harness();let handler;
  const listeners={};const doc={defaultView:{Element},addEventListener(type,fn){listeners[type]=fn;if(type==='click')handler=fn;},removeEventListener(type){delete listeners[type];}};
  const frame={contentDocument:doc,contentWindow:{location:{origin:Core.ORIGIN}}};
  h.attachEmbeddedNavigation(frame,{id:'dummy-pane'});assert.equal(typeof listeners.keydown,'function');
  const menu=el('div',{role:'menu'}),a=el('a',{},menu);a.ownerDocument=doc;
  a.href=Core.ORIGIN+'/c/fixture123';a.target='_blank';
  const e=click(a);handler(e);assert.equal(e.defaultPrevented,false);assert.equal(e.stopped,undefined);assert.equal(h.calls.length,0);
});


test('portal menu and Radix positioning wrapper are elevated without rewriting inline styles',()=>{
  const {h,el,document}=harness();const wrapper=el('div',{'data-radix-popper-content-wrapper':''},document.body);
  wrapper.position='fixed';wrapper.style={transform:'translate(200px, 100px)',zIndex:'50'};
  const menu=el('div',{role:'menu'},wrapper);document.menus=[menu];
  h.syncNativeMenus();
  assert(menu.hasAttribute('data-cgww-native-menu-layer'));assert(wrapper.hasAttribute('data-cgww-native-menu-layer'));
  assert(menu.hasAttribute('data-cgww-native-menu-position'));assert(!wrapper.hasAttribute('data-cgww-native-menu-position'));
  assert(!document.body.hasAttribute('data-cgww-native-menu-layer'));
  assert.deepEqual(wrapper.style,{transform:'translate(200px, 100px)',zIndex:'50'});
  h.syncNativeMenus();assert(menu.hasAttribute('data-cgww-native-menu-position'),'repeated sync retains extension-required positioning');
});
test('nested sidebar menu relaxes only its ancestor chain and removes all marks after close',()=>{
  const {h,el,document}=harness();const sidebar=el('aside',{'id':'ds-sidebar'},document.body);
  const row=el('div',{},sidebar),sibling=el('div',{},sidebar),menu=el('div',{role:'menu'},row);document.menus=[menu];
  h.syncNativeMenus();
  for(const node of [sidebar,row])assert(node.hasAttribute('data-cgww-native-menu-overflow'));
  assert(!sibling.hasAttribute('data-cgww-native-menu-overflow'));assert(!document.body.hasAttribute('data-cgww-native-menu-overflow'));
  menu.setAttribute('data-state','closed');h.syncNativeMenus();
  for(const node of [sidebar,row,menu])for(const key of Object.keys(node.attributes))assert(!key.startsWith('data-cgww-native-menu-'));
});
test('hidden, closed, non-rendered and visibility-hidden native menus are not elevated',()=>{
  const {h,el,document}=harness();const menus=Array.from({length:5},()=>el('div',{role:'menu'},document.body));
  menus[0].hidden=true;menus[1].setAttribute('data-state','closed');menus[2].noRects=true;menus[3].visibility='hidden';menus[4].display='none';
  document.menus=menus;h.syncNativeMenus();for(const menu of menus)assert(!menu.hasAttribute('data-cgww-native-menu-layer'));
});
test('menu watcher excludes own marker mutations and original-mode stop restores native layout',()=>{
  const {h,el,document,observerInstances}=harness();const menu=el('div',{role:'menu'},document.body);document.menus=[menu];
  h.startNativeMenuWatch();const observer=observerInstances[0],sheet=document.documentElement.children[0];
  assert.equal(observer.target,document.body);assert.equal(observer.options.subtree,true);
  assert(!observer.options.attributeFilter.some(attr=>attr.startsWith('data-cgww-')));
  assert(menu.hasAttribute('data-cgww-native-menu-layer'));
  h.startNativeMenuWatch();assert.equal(observerInstances.length,1,'one watcher per enabled session');
  h.stopNativeMenuWatch();assert.equal(observer.disconnected,true);assert.equal(sheet.removed,true);
  assert(!menu.hasAttribute('data-cgww-native-menu-layer'));assert(!menu.hasAttribute('data-cgww-native-menu-position'));
});
test('ellipsis menu trigger nested inside history anchor stays native',()=>{
  for(const popup of ['menu','true']){
    const {h,el}=harness();const nav=el('aside'),a=el('a',{},nav);a.href=Core.ORIGIN+'/c/fixture123';
    const b=el('button',{'aria-haspopup':popup},a);assertNative(h,click(el('svg',{},b)));
  }
});
test('newly mounted submenu layers are applied inside mutation callback without deferring a frame',()=>{
  const {h,el,document,observerInstances}=harness();h.startNativeMenuWatch();
  const wrapper=el('div',{'data-radix-popper-content-wrapper':''},document.body);wrapper.position='fixed';
  const submenu=el('div',{role:'menu'},wrapper);document.menus=[submenu];
  observerInstances[0].fn([]);
  assert(wrapper.hasAttribute('data-cgww-native-menu-layer'));assert(submenu.hasAttribute('data-cgww-native-menu-layer'));
  h.stopNativeMenuWatch();
});


test('GPT page links open a pane from main content while menus and modified clicks stay native',()=>{
 const {h,el}=harness();const anchor=el('a');anchor.href='https://chatgpt.com/g/g-h8l4uLHFQ-video-ai-by-invideo';anchor.textContent='Video AI';
 const e=click(anchor);h.handleHistoryClick(e);assert.equal(e.defaultPrevented,true);assert.equal(h.calls[0][0],anchor.href);
 const modified=click(anchor,{ctrlKey:true});h.handleHistoryClick(modified);assert.equal(modified.defaultPrevented,false);assert.equal(h.calls.length,1);
 const menu=el('div',{role:'menu'});anchor.parentElement=menu;const action=click(anchor);h.handleHistoryClick(action);assert.equal(action.defaultPrevented,false);assert.equal(h.calls.length,1);
});

for(const role of ['dialog','alertdialog','listbox','option'])test(`native ${role} links and new-chat commands are not intercepted`,()=>{
  const {h,el}=harness();const dialog=el('div',{role}),a=el('a',{},dialog);a.href=Core.ORIGIN+'/c/fixture123';
  assertNative(h,click(a,{clientX:0}));
  const button=el('button',{'data-testid':'new-chat-button'},dialog);button.textContent='New chat';
  const e=click(button);assert.equal(h.handleNewChatClick(e),false);assert.equal(e.defaultPrevented,false);assert.equal(h.newCalls.length,0);
});
test('body links at the left edge and keyboard click coordinates remain native',()=>{
  const {h,el}=harness();const a=el('a');a.href=Core.ORIGIN+'/c/fixture123';
  for(const clientX of [0,20,100,500])assertNative(h,click(a,{clientX}));
});
test('plain project-name links open independent project pages without relying on labels',()=>{
  const {h,el}=harness();const a=el('a');a.href=Core.ORIGIN+'/g/g-p-0123456789abcdef0123456789abcdef/project';a.textContent='Fixture project';
  for(let i=0;i<2;i++){const e=click(a);h.handleHistoryClick(e);assert.equal(e.defaultPrevented,true);}
  assert.deepEqual(Array.from(h.newCalls,args=>args[0]),[a.href,a.href]);
  for(const extra of [{ctrlKey:true},{metaKey:true},{shiftKey:true},{altKey:true},{button:1}])assertNative(h,click(a,extra));
  a.setAttribute('download','');assertNative(h,click(a));a.removeAttribute('download');
  for(const suffix of ['?mode=other','#section']){a.href=Core.ORIGIN+'/g/g-p-fixture/project'+suffix;assertNative(h,click(a));}
});
test('project creation button stays native and modal yield restores only after last nested dialog closes',()=>{
  const {h,el,document}=harness();h.attachHost();
  const create=el('button',{'data-app-action-sidebar-project-create':'','aria-label':'新しいプロジェクトを追加'});
  assertNative(h,click(create));
  const host=h.getHost(),frame=el('iframe',{},host);host.appendChild(frame);frame.src='/c/fixture123';frame.document={draft:'unsent',attachment:'fixture',scrollTop:123,generating:true};
  const originalDocument=frame.document,dialog=el('div',{role:'dialog','aria-modal':'true'},document.body);document.dialogs=[dialog];
  h.syncNativeMenus();assert(host.hasAttribute('data-cgww-native-modal'));assert.equal(h.getModal(),true);
  h.syncNativeMenus();assert.deepEqual(Array.from(h.sidebarCalls),['release']);
  const nested=el('div',{role:'alertdialog'},document.body);document.dialogs.push(nested);dialog.setAttribute('data-state','closed');
  h.syncNativeMenus();assert.equal(h.getModal(),true);
  nested.hidden=true;h.syncNativeMenus();assert.equal(h.getModal(),false);assert(!host.hasAttribute('data-cgww-native-modal'));
  assert.deepEqual(Array.from(h.sidebarCalls),['release','restore']);assert.equal(host.children[0],frame);assert.equal(frame.document,originalDocument);assert.equal(frame.src,'/c/fixture123');assert.equal(frame.document.draft,'unsent');
  dialog.removeAttribute('data-state');h.syncNativeMenus();h.stopNativeMenuWatch();assert(!host.hasAttribute('data-cgww-native-modal'));assert.equal(h.getModal(),false);
});
test('nonvisible dialogs and dialogs inside aria-hidden ancestors do not suspend workspace',()=>{
  const {h,el,document}=harness();h.attachHost();const hiddenParent=el('div',{'aria-hidden':'true'},document.body);
  const dialogs=Array.from({length:5},()=>el('div',{role:'dialog'},document.body));
  dialogs[0].hidden=true;dialogs[0].setAttribute('hidden','');dialogs[1].noRects=true;dialogs[2].display='none';dialogs[3].visibility='hidden';dialogs[4].parentElement=hiddenParent;
  document.dialogs=dialogs;h.syncNativeMenus();assert.equal(h.getModal(),false);assert.deepEqual(Array.from(h.sidebarCalls),[]);
});
test('native page navigation opens projects or conversations once and yields for settings',()=>{
  const {h}=harness();h.setRoute(Core.ORIGIN+'/');
  const project=Core.ORIGIN+'/g/g-p-0123456789abcdef0123456789abcdef/project';h.route(project);h.syncNativePageRoute();h.syncNativePageRoute();assert.deepEqual(Array.from(h.newCalls,args=>Array.from(args)),[[project]]);
  h.route(Core.ORIGIN+'/c/fixture123');h.syncNativePageRoute();assert.equal(h.calls[0][0],Core.ORIGIN+'/c/fixture123');
  h.route(Core.ORIGIN+'/settings/general-settings');h.syncNativePageRoute();assert.deepEqual(Array.from(h.modeCalls),[false]);
});
test('native created project route waits for modal dismissal and is adopted without repeating',()=>{
  const {h,el,document}=harness();h.attachHost();h.setRoute(Core.ORIGIN+'/');
  const dialog=el('div',{role:'dialog'},document.body);document.dialogs=[dialog];h.syncNativeMenus();
  h.route(Core.ORIGIN+'/g/g-p-0123456789abcdef0123456789abcdef/project');h.syncNativeMenus();assert.equal(h.newCalls.length,0);
  dialog.setAttribute('data-state','closed');h.syncNativeMenus();h.syncNativeMenus();assert.equal(h.newCalls.length,1);assert.equal(h.getModal(),false);
});
test('listbox popup gets menu layering and removes marks on dismiss',()=>{
  const {h,el,document}=harness();const wrapper=el('div',{'data-radix-popper-content-wrapper':''},document.body);wrapper.position='fixed';const popup=el('div',{role:'listbox'},wrapper);document.menus=[popup];
  h.syncNativeMenus();assert(wrapper.hasAttribute('data-cgww-native-menu-layer'));popup.hidden=true;h.syncNativeMenus();assert(!wrapper.hasAttribute('data-cgww-native-menu-layer'));
});

test('native navigation honors interception preference, cancels and pane limits by revealing original UI',()=>{
 for(const route of ['/g/g-p-fixture/project','/c/fixture123']){
  const {h}=harness();h.setRoute(Core.ORIGIN+'/');h.prefs({interceptSidebar:false});h.route(Core.ORIGIN+route);h.syncNativePageRoute();assert.deepEqual(Array.from(h.modeCalls),[false]);assert.equal(h.newCalls.length+h.calls.length,0);
  const second=harness().h;second.setRoute(Core.ORIGIN+'/');second.rejectAdds();second.route(Core.ORIGIN+route);second.syncNativePageRoute();assert.deepEqual(Array.from(second.modeCalls),[false]);
 }
});
test('same-path query and fragment changes do not select or open another pane',()=>{
 const {h}=harness();h.setRoute(Core.ORIGIN+'/c/fixture123');
 for(const suffix of ['#message','?model=fixture']){h.route(Core.ORIGIN+'/c/fixture123'+suffix);h.syncNativePageRoute();}
 assert.equal(h.calls.length+h.newCalls.length+h.modeCalls.length,0);
});

test('HTML dialog without explicit ARIA role protects project and new-chat actions',()=>{
 const {h,el}=harness(),dialog=el('dialog',{open:''}),a=el('a',{},dialog);a.href=Core.ORIGIN+'/g/g-p-fixture/project';assertNative(h,click(a));
 const b=el('button',{'data-testid':'new-chat-button'},dialog);b.textContent='New chat';assertNative(h,click(b));assert.equal(h.newCalls.length,0);
});
test('canonical project slugs and conversation aliases do not create or select duplicate routes',()=>{
 const {h}=harness(),project=Core.ORIGIN+'/g/g-p-0123456789abcdef0123456789abcdef';h.setRoute(project+'/project');h.route(project+'-fixture/project');h.syncNativePageRoute();assert.equal(h.newCalls.length,0);
 h.setRoute(Core.ORIGIN+'/c/fixture123');h.route(project+'/c/fixture123');h.syncNativePageRoute();assert.equal(h.calls.length,0);
});
test('mode-bearing home navigation reveals original page rather than covering it',()=>{
 const {h}=harness();h.setRoute(Core.ORIGIN+'/');h.route(Core.ORIGIN+'/?temporary-chat=true');h.syncNativePageRoute();assert.deepEqual(Array.from(h.modeCalls),[false]);
});
