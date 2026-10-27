const test=require('node:test'),assert=require('node:assert/strict'),path=require('node:path'),fs=require('node:fs'),vm=require('node:vm');
const ROOT=process.env.CGWW_SOURCE||path.join(__dirname,'../extension');
const L=require(path.join(ROOT,'content-layout.js'));
const base={boxSizing:'border-box',maxWidth:'768px',paddingLeft:'20px',paddingRight:'20px',borderLeftWidth:'0px',borderRightWidth:'0px'};
function fixture({style={},scrollbar=0,inset=0,unsafe=false,unknown=false}={}){
 class N{
  constructor(tag='DIV',s={}){this.tagName=tag;this.baseStyle={maxWidth:'none',...s};this.attrs={};this.parentElement=null;this.textContent='';this.writes=0;}
  getAttribute(k){return this.attrs[k]??null;}setAttribute(k,v){this.attrs[k]=String(v);this.writes++;}removeAttribute(k){delete this.attrs[k];this.writes++;}
  matches(sel){return sel.split(',').some(t=>t.toUpperCase()===this.tagName);}
  closest(){return unsafe?this:null;}appendChild(n){n.parentElement=this;doc.styles.push(n);}remove(){doc.styles=doc.styles.filter(n=>n!==this);}
 }
 const html=new N('HTML'),body=new N('BODY',{paddingLeft:inset+'px',paddingRight:inset+'px'}),col=new N('MAIN',{...base,...style}),message=new N('DIV');
 body.parentElement=html;col.parentElement=body;message.parentElement=col;html.clientWidth=1000-scrollbar;
 const doc={documentElement:html,body,styles:[],querySelectorAll(sel){return sel==='['+L.COLUMN_ATTR+']'?(col.getAttribute(L.COLUMN_ATTR)?[col]:[]):unknown?[]:[message];},getElementById(id){return this.styles.find(s=>s.id===id)||null;},createElement(tag){return new N(tag.toUpperCase());}};
 doc.defaultView={innerWidth:1000,getComputedStyle(node){return node===col&&col.getAttribute(L.COLUMN_ATTR)&&doc.styles.length?{...node.baseStyle,maxWidth:'752px',paddingLeft:'12px',paddingRight:'12px'}:node.baseStyle;}};
 return {doc,col,message,body,html};
}
test('pixel parsing rejects percentages, auto, CSS expressions and malformed values',()=>{for(const v of ['100%','none','auto','calc(100% - 2px)','NaNpx','-2px',null])assert.equal(L.pixels(v),null);assert.equal(L.pixels('768.5px'),768.5);});
test('border-box compact padding preserves original inner width',()=>{const g=L.columnGeometry(base,true);assert.deepEqual(g,{contentMax:728,paddingLeft:12,paddingRight:12,border:0,columnMax:752});assert.equal(g.columnMax-g.paddingLeft-g.paddingRight,768-40);});
test('content-box cap keeps its content width, adding only measured insets',()=>{const g=L.columnGeometry({...base,boxSizing:'content-box'},true);assert.equal(g.contentMax,768);assert.equal(g.columnMax,792);});
test('small existing padding is never enlarged',()=>{const g=L.columnGeometry({...base,paddingLeft:'8px',paddingRight:'4px'},true);assert.equal(g.paddingLeft,8);assert.equal(g.paddingRight,4);assert.equal(g.columnMax,768);});
test('border widths are separated from text and outer dimensions',()=>{const g=L.columnGeometry({...base,borderLeftWidth:'1px',borderRightWidth:'2px'},true);assert.equal(g.contentMax,725);assert.equal(g.columnMax,752);});
test('wide original versus pane text width agrees with compact gutter, scrollbar and border',()=>{for(const scrollbar of [0,15,17]){const g=L.columnGeometry(base,true),outer=L.requiredOuterWidth(g.columnMax,24,scrollbar);const inner=outer-2-scrollbar-24;assert.equal(Math.min(inner,g.columnMax)-g.paddingLeft-g.paddingRight-28,700);}});
test('narrow panes naturally reduce line width rather than forcing original minimum',()=>{const g=L.columnGeometry(base,true);const wide=g.contentMax-28,narrow=Math.min(320-2-15,g.columnMax)-24-28;assert.equal(wide,700);assert.equal(narrow,251);assert(narrow<wide);});
test('only semantic conversation ancestors with usable caps are detected',()=>{const {doc,col}=fixture();const m=L.inspect(doc,{compact:true});assert.equal(m.detected,true);assert.equal(m.columns[0].node,col);assert.equal(m.outerMax,754);});
test('unknown or unsafe message context stays untouched with explicit fallback',()=>{for(const opts of [{unknown:true},{unsafe:true},{style:{maxWidth:'100%'}}]){const {doc,col}=fixture(opts),m=L.inspect(doc,{compact:true});assert.equal(m.detected,false);assert.equal(m.outerMax,1400);L.apply(doc,m);assert.equal(col.getAttribute(L.COLUMN_ATTR),null);assert.equal(doc.styles.length,0);}});
test('nested padding and vertical scrollbar contribute to outer cap',()=>{const {doc}=fixture({inset:16,scrollbar:15});assert.equal(L.inspect(doc,{compact:true}).outerMax,801);});
test('scrollbar allowance never shrinks within one document',()=>{const {doc}=fixture({scrollbar:15});const m=L.inspect(doc,{compact:true});doc.documentElement.clientWidth=1000;assert.equal(L.inspect(doc,{compact:true,scrollbarAllowance:m.scrollbarAllowance}).outerMax,769);});
test('compact stylesheet is scoped and preserves pre, tables and input styles',()=>{const {doc,col}=fixture();L.apply(doc,L.inspect(doc,{compact:true}));const css=doc.styles[0].textContent;assert.match(css,/max-width:752px/);assert.match(css,/width:100%/);assert.match(css,/min-width:0/);assert.doesNotMatch(css,/\b(pre|table|textarea|input)\b/);assert.equal(col.baseStyle.paddingLeft,'20px');});
test('repeat measurement reads native styles, not feedback from previous compact CSS',()=>{const {doc,col}=fixture();const first=L.inspect(doc,{compact:true});L.apply(doc,first);const again=L.inspect(doc,{compact:true});assert.equal(again.columns[0].contentMax,728);assert.equal(again.outerMax,first.outerMax);assert.equal(col.getAttribute(L.COLUMN_ATTR),'1');});
test('unchanged repeated application does not rewrite the stylesheet',()=>{const {doc}=fixture();const m=L.inspect(doc,{compact:true});L.apply(doc,m);const style=doc.styles[0];let writes=0,css=style.textContent;Object.defineProperty(style,'textContent',{get(){return css;},set(v){writes++;css=v;}});L.apply(doc,L.inspect(doc,{compact:true}));assert.equal(writes,0);});
test('native responsive style changes are remeasured after resize',()=>{const {doc,col}=fixture();L.apply(doc,L.inspect(doc,{compact:true}));col.baseStyle.paddingLeft='32px';col.baseStyle.paddingRight='32px';const m=L.inspect(doc,{compact:true});assert.equal(m.columns[0].contentMax,704);assert.equal(m.columns[0].columnMax,728);});
test('missing document or unsupported view returns fallback without mutation',()=>{assert.equal(L.inspect(null).detected,false);assert.equal(L.inspect({}).outerMax,1400);});
test('layout scheduling is coalesced and does not poll or rebuild frames',()=>{const s=fs.readFileSync(path.join(ROOT,'workspace.js'),'utf8');const body=s.slice(s.indexOf('  function refreshContentLayout()'),s.indexOf('  function measureNativeSidebar()'));assert.match(body,/contentLayoutTimer!==null/);assert.match(body,/setTimeout\(refreshContentLayout,100\)/);assert.doesNotMatch(body,/setInterval|replaceChildren|\.src\s*=/);assert.match(body,/unknownFrame/);});
test('a nested scroll container contributes its gutter without counting borders twice',()=>{
 const {doc,col}=fixture();const ancestor={parentElement:doc.body,baseStyle:{maxWidth:'none',borderLeftWidth:'2px',borderRightWidth:'2px',paddingLeft:'5px',paddingRight:'5px'},offsetWidth:800,clientWidth:781};col.parentElement=ancestor;
 const measured=L.inspect(doc,{compact:true});assert.equal(measured.columns[0].ancestorInsets,14);assert.equal(measured.scrollbarAllowance,15);assert.equal(measured.outerMax,783);
 ancestor.clientWidth=796;assert.equal(L.inspect(doc,{compact:true,scrollbarAllowance:measured.scrollbarAllowance}).outerMax,783);
});
