from pathlib import Path
import sys
repo=Path(__file__).resolve().parents[1]
r=Path(sys.argv[1]).resolve() if len(sys.argv)>1 else repo/'dist'
target=r/'ui-fixture';target.mkdir(exist_ok=True)
s=(repo/'extension/workspace.js').read_text(encoding='utf-8')
boot='''
  workspaceId='fixture';durableToken='fixture-token';
  const saved=JSON.parse(sessionStorage.getItem('cgww.v1.workspace')||'null');
  state={enabled:saved?saved.enabled!==false:new URLSearchParams(location.search).get('original')!=='1',activeId:'a',panes:saved?.panes||[
    {id:'a',title:'調査メモ',url:null,width:480,autoWidth:false,visible:true},
    {id:'b',title:'比較用の会話',url:null,width:480,autoWidth:false,visible:true,folded:true},
    {id:'c',title:'後で読む会話',url:null,width:480,autoWidth:false,visible:false}]};
  settings=Core.normalizeSettings(saved?.settings||{sidebarVisible:true});autoRestored=true;initializing=false;
  updateFallbackDock=()=>{};
  buildFrame=(p,main)=>{const frame=document.createElement('iframe');frame.src='about:blank';frame.title='Local new chat fixture';main.appendChild(frame);return frame;};
  makeUI();panel.hidden=!state.enabled;state.panes.forEach(renderPane);applyColumnWidths();markActive();
  for(const p of state.panes){const entry=paneNodes.get(p.id);entry.main.replaceChildren();const field=document.createElement('textarea');field.setAttribute('aria-label',p.title+'の未送信入力');field.style.cssText='margin:20px;width:85%;height:180px';field.value=p.draft||'未送信のダミー入力';field.addEventListener('input',()=>{p.draft=field.value;safeSave()});entry.main.appendChild(field);}
'''
s=s.replace('  void initialize();',boot)
(target/'workspace.js').write_text(s,encoding='utf-8')
(target/'core.js').write_bytes((repo/'extension/core.js').read_bytes())
(target/'persistence.js').write_bytes((repo/'extension/persistence.js').read_bytes())
(target/'index.html').write_text('''<!doctype html><meta charset="utf-8"><title>Split View local UI fixture</title><script src="core.js"></script><script src="persistence.js"></script><script>
const local=JSON.parse(localStorage.getItem('store')||'{}'),session={'cgww.workspaceOwners':{1:{id:'fixture',token:'fixture-token',sequence:0,hostUrl:'https://chatgpt.com/'}}};
const area=(d,persist)=>({async get(k){return structuredClone(k===null?d:{[k]:d[k]})},async set(v){Object.assign(d,structuredClone(v));if(persist)localStorage.setItem('store',JSON.stringify(d))}});
window.chrome={storage:{local:area(local,true),session:area(session,false)}};
const store=CGWWPersistence.create(chrome.storage);chrome.runtime={sendMessage(m,cb){store.handle(m,1).then(cb).catch(e=>cb({ok:false,error:e.message}))}};
</script><style>html,body{margin:0;height:100%}body{display:flex;flex-direction:column}header{display:flex;align-items:center;gap:10px;flex:none;min-height:48px}main{flex:1;min-height:0;overflow:auto}footer{flex:none;padding:8px}textarea{max-width:90%}aside{position:fixed;top:0;left:0;bottom:0;width:348px;z-index:2147483644;background:white;pointer-events:auto}body:has(#cgww-return:not([hidden])) aside{display:none}</style><body><header style="pointer-events:none">ChatGPT fixture</header><main><p>Native content</p><div style="height:1200px">Scrollable conversation</div><button>End of conversation</button></main><footer><textarea aria-label="Native draft">native unsent input</textarea></footer><aside>Native sidebar stacking context</aside><script src="workspace.js"></script>''',encoding='utf-8')

html=(target/"index.html").read_text(encoding="utf-8")
(target/"no-header.html").write_text(html.replace('<header style="pointer-events:none">ChatGPT fixture</header>','<div>ChatGPT fixture without header</div>'),encoding="utf-8")
