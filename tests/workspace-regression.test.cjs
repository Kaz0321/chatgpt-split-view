const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const ROOT = path.resolve(process.env.CGWW_SOURCE || path.join(__dirname, '..', 'extension'));
const C = require(path.join(ROOT, 'core.js'));
// Expose lexical functions without initializing any browser UI; production code
// is otherwise unchanged. DOM behaviors below are explicit test doubles.
function harness(extra={}) {
  class Element {}
  const document = {getElementById(){return null;}};
  const sandbox={URL, console, Element, document, CGWWCore:C, ...extra};
  sandbox.window=sandbox; sandbox.top=sandbox;
  const context=vm.createContext(sandbox);
  const source=fs.readFileSync(path.join(ROOT,'workspace.js'),'utf8');
  assert(source.includes('  void initialize();'));
  vm.runInContext(source.replace('  void initialize();', `globalThis.testHooks = {
    historyAnchor, attachEmbeddedNavigation, readOriginalMaxWidth, setEqualize, applyColumnWidths, syncPaneOrder, reorderPane, attachPaneDrag,
    getOrder(){return state.panes.map(p=>p.id);},
    measureNativeSidebar, tagEmbeddedNavigation, applyIframeSidebarRule,
    setSettings(value) { settings = Core.normalizeSettings(value); },
    setEnabled(value) { state.enabled = value; },
    setLayout(panes, entries, availableWidth, cap) {
      state.panes=panes; entries.forEach((entry,id)=>paneNodes.set(id,entry));
      scroller={clientWidth:availableWidth}; originalMaxWidth=cap;
      savePrefs=()=>{}; safeSave=()=>{};
    },
    resize(width) {scroller.clientWidth=width; applyColumnWidths();},
    frameNavCss: FRAME_NAV_CSS,
    captureAssignments() { const calls=[]; assignToActive=(...args)=>calls.push(args); return calls; }
  };`),context);
  return {hooks:sandbox.testHooks,sandbox};
}

test('same-realm history links are detected',()=>{
  const {hooks,sandbox}=harness();
  const anchor=new sandbox.Element(); anchor.closest=()=>anchor;
  assert.equal(hooks.historyAnchor({target:anchor}),anchor);
});

test('iframe-realm history links are detected without parent instanceof rejection',()=>{
  const {hooks}=harness();
  const frame=vm.createContext({});
  vm.runInContext('class Element {}; this.Element=Element; this.anchor=new Element(); anchor.closest=()=>anchor; anchor.ownerDocument={defaultView:{Element}};',frame);
  assert.equal(hooks.historyAnchor({target:frame.anchor}),frame.anchor);
});

test('embedded _blank chat link is intercepted rather than opening a browser tab/window',()=>{
  const {hooks}=harness();
  let handler;
  const doc={addEventListener(type,callback){assert.equal(type,'click'); handler=callback;}};
  const frame={contentDocument:doc,contentWindow:{location:{origin:C.ORIGIN}}};
  hooks.setEnabled(true);
  const assignments=hooks.captureAssignments();
  hooks.attachEmbeddedNavigation(frame,{id:'pane-one'});
  const realm=vm.createContext({});
  vm.runInContext(`class Element {}; this.Element=Element; this.anchor=new Element();
    anchor.ownerDocument={defaultView:{Element}};
    anchor.href='https://chatgpt.com/c/fixture123'; anchor.target='_blank';
    anchor.innerText='Fixture'; anchor.closest=(s)=>s==='a[href]'?anchor:null;`,realm);
  const event={target:realm.anchor,button:0,clientX:400,defaultPrevented:false,
    preventDefault(){this.defaultPrevented=true;},stopImmediatePropagation(){this.stopped=true;}};
  handler(event);
  assert.equal(event.defaultPrevented,true,'default navigation must be prevented');
  assert.equal(event.stopped,true);
  assert.equal(assignments.length,1);
});

test('column cap equals the supplied original content max width (no arbitrary 48px inflation)',()=>{
  const root={appendChild(){}};
  const doc={getElementById(){return null;},documentElement:root,body:{},querySelector(){return null;},
    createElement(){return {style:{},getBoundingClientRect(){return {width:768};},remove(){}};}};
  const {hooks}=harness({document:doc,getComputedStyle(){return {getPropertyValue(){return '768px';}};}});
  assert.equal(hooks.readOriginalMaxWidth(),768);
});

test('unavailable native width falls back explicitly to 920px',()=>{
  const doc={getElementById(){return null;},documentElement:{},body:{},querySelector(){return null;}};
  const {hooks}=harness({document:doc,getComputedStyle(){return {getPropertyValue(){return '';}};}});
  assert.equal(hooks.readOriginalMaxWidth(),920);
});

test('manual 320px width survives preferences and session normalization',()=>{
  assert.equal(C.normalizeSettings({paneWidth:320}).paneWidth,320);
  assert.equal(C.normalizeSessionPanes([{url:null,width:320}])[0].width,320);
  assert.equal(C.normalizePanes([{url:'https://chatgpt.com/c/fixture123',width:320}])[0].width,320);
});

test('current ds-sidebar is explicitly hidden even before geometry is available',()=>{
  const {hooks}=harness();
  assert.match(hooks.frameNavCss,/#ds-sidebar\s*[,\{]/);
});

test('new embedded navigation is observed after load without depending on parent pinning',()=>{
  const observed=[];
  let insertedStyle;
  const root={appendChild(el){insertedStyle=el;}};
  const doc={documentElement:root,getElementById(){return insertedStyle;},
    createElement(){return {};},querySelectorAll(){return [];}};
  const {hooks}=harness({MutationObserver:class {constructor(fn){this.callback=fn;} observe(node,options){observed.push(options);}}});
  hooks.setSettings({keepMasterSidebar:false,hideFrameSidebar:true});
  hooks.applyIframeSidebarRule({contentDocument:doc,contentWindow:{location:{origin:C.ORIGIN}},clientWidth:600,clientHeight:800});
  assert.equal(observed.length,1);
  assert.equal(observed[0].subtree,true,'React descendants must be observed, not just root children');
});

test('expanded ASIDE sidebar remains recognized without a matching test id',()=>{
  const aside={getBoundingClientRect(){return {left:0,right:260,width:260,height:750};}};
  const doc={getElementById(){return null;},querySelectorAll(selector){return selector==='aside, nav'?[aside]:[];}};
  const {hooks}=harness({document:doc,getComputedStyle(){return {display:'block',visibility:'visible'};}});
  assert.equal(hooks.measureNativeSidebar(),true);
});

test('equal-width calculations cover 1-8 panes, resize, min/cap and hidden-pane count',()=>{
  for (const count of [1,2,3,4,8]) for (const width of [480,900,1440,1920,3200]) {
    const actual=C.calculateEqualWidth(width,count,768);
    assert.equal(actual,Math.min(768,Math.max(320,Math.floor((width-18-7*(count-1))/count))));
  }
  assert(C.calculateEqualWidth(1440,3,768)<C.calculateEqualWidth(1440,2,768));
});


test('equal-width toggle and repeated resize preserve iframe objects, URLs and draft data',()=>{
  const {hooks}=harness();
  const panes=[{id:'a',width:620,visible:true},{id:'b',width:500,visible:true},{id:'c',width:440,visible:false}];
  const entries=new Map(panes.map(p=>[p.id,{root:{style:{}},iframe:{src:'https://chatgpt.com/c/fixture'+p.id,draft:'unsent-'+p.id}}]));
  const originals=[...entries.values()].map(e=>e.iframe);
  hooks.setLayout(panes,entries,1400,768);
  hooks.setEqualize(true);
  assert.equal(entries.get('a').root.style.width,'687px');
  assert.equal(entries.get('b').root.style.width,'687px');
  hooks.resize(900);
  assert.equal(entries.get('a').root.style.width,'437px');
  assert.equal(entries.get('b').root.style.width,'437px');
  hooks.resize(500);
  assert.equal(entries.get('a').root.style.width,'320px');
  hooks.resize(3000);
  assert.equal(entries.get('a').root.style.width,'768px');
  hooks.setEqualize(false);
  assert.equal(entries.get('a').root.style.width,'620px');
  assert.equal(entries.get('b').root.style.width,'500px');
  [...entries.values()].forEach((entry,i)=>{
    assert.equal(entry.iframe,originals[i]);
    assert.equal(entry.iframe.draft,'unsent-'+panes[i].id);
    assert.equal(entry.iframe.src,'https://chatgpt.com/c/fixture'+panes[i].id);
  });
});

test('descendant navigation added after load is marked when parent pinning is off',()=>{
  let callback,style; const candidates=[];
  const doc={documentElement:{appendChild(el){style=el;}},getElementById(){return style;},
    createElement(){return {};},querySelectorAll(){return candidates;}};
  const {hooks}=harness({MutationObserver:class {constructor(fn){callback=fn;} observe(){}}});
  hooks.setSettings({keepMasterSidebar:false,hideFrameSidebar:true});
  hooks.applyIframeSidebarRule({contentDocument:doc,contentWindow:{location:{origin:C.ORIGIN}},clientWidth:600,clientHeight:800});
  const attributes={};
  const navigation={getBoundingClientRect(){return {left:0,width:260,height:750};},
    getAttribute(name){return attributes[name];},setAttribute(name,value){attributes[name]=value;}};
  candidates.push(navigation);
  callback([{type:'childList',addedNodes:[navigation]}]);
  assert.equal(attributes['data-cgww-embedded-nav'],'true');
});

test('cross-origin or unavailable embedded documents are not modified',()=>{
  const {hooks}=harness(); let mutations=0;
  const doc={getElementById(){mutations++;},querySelectorAll(){mutations++;}};
  hooks.applyIframeSidebarRule({contentDocument:doc,contentWindow:{location:{origin:'https://example.test'}}});
  hooks.tagEmbeddedNavigation({contentDocument:doc,contentWindow:{location:{origin:'https://example.test'}}});
  hooks.applyIframeSidebarRule({contentDocument:null});
  assert.equal(mutations,0);
});

test('embedded Ctrl/Meta/Alt clicks and external links keep native browser behavior',()=>{
  const {hooks,sandbox}=harness(); let handler;
  hooks.setEnabled(true);const assignments=hooks.captureAssignments();
  hooks.attachEmbeddedNavigation({contentDocument:{addEventListener(type,fn){handler=fn;}},contentWindow:{location:{origin:C.ORIGIN}}},{id:'one'});
  const anchor=new sandbox.Element(); anchor.target='_blank';anchor.closest=()=>anchor;
  for (const modifier of ['ctrlKey','metaKey','altKey','external']) {
    anchor.href=modifier==='external'?'https://example.test/':'https://chatgpt.com/c/fixture123';
    let prevented=false;
    handler({target:anchor,button:0,[modifier]:true,preventDefault(){prevented=true;}});
    assert.equal(prevented,false);
  }
  assert.equal(assignments.length,0);
});


function lateLayoutHarness(deferFrame=false) {
  let style,rect={left:0,width:0,height:0};const attrs={};const listeners={};
  const nav={getBoundingClientRect(){return rect;},getAttribute(n){return attrs[n];},setAttribute(n,v){attrs[n]=v;}};
  const doc={documentElement:{appendChild(el){style=el;}},getElementById(){return style;},createElement(){return {};},querySelectorAll(){return [nav];},
    addEventListener(type,fn){listeners['doc:'+type]=fn;},removeEventListener(){}};
  const win={location:{origin:C.ORIGIN},requestAnimationFrame(fn){if(!deferFrame)fn();},
    addEventListener(type,fn){listeners['win:'+type]=fn;},removeEventListener(){}};
  const {hooks}=harness({MutationObserver:class{constructor(fn){} observe(){} disconnect(){}}});
  hooks.setSettings({keepMasterSidebar:false,hideFrameSidebar:true});
  hooks.applyIframeSidebarRule({contentDocument:doc,contentWindow:win,clientWidth:600,clientHeight:800});
  return {attrs,listeners,makeVisible(){rect={left:0,width:220,height:750};}};
}

test('stylesheet finishing after DOM mutation rechecks generic iframe navigation',()=>{
  const h=lateLayoutHarness();assert.equal(h.attrs['data-cgww-embedded-nav'],undefined);h.makeVisible();
  assert.equal(typeof h.listeners['doc:load'],'function');
  h.listeners['doc:load']({target:{tagName:'LINK',rel:'stylesheet'}});
  assert.equal(h.attrs['data-cgww-embedded-nav'],'true');
});

test('iframe viewport resize rechecks navigation with parent pinning disabled',()=>{
  const h=lateLayoutHarness();h.makeVisible();
  assert.equal(typeof h.listeners['win:resize'],'function');h.listeners['win:resize']();
  assert.equal(h.attrs['data-cgww-embedded-nav'],'true');
});

test('offscreen iframe stylesheet load does not depend on animation-frame delivery',()=>{const h=lateLayoutHarness(true);h.makeVisible();h.listeners['doc:load']({target:{tagName:'LINK',rel:'stylesheet'}});assert.equal(h.attrs['data-cgww-embedded-nav'],'true');});
