/* Native ChatGPT windows retain their own drafts and attachments. */
(() => {
  'use strict';
  if(window!==window.top)return;
  const request=message=>new Promise((resolve,reject)=>{
    const timer=setTimeout(()=>reject(Error('応答がありません。現在の画面を保持しています。')),10000);
    try{chrome.runtime.sendMessage({type:'CGWW_WINDOW',...message},r=>{clearTimeout(timer);if(chrome.runtime.lastError||!r?.ok)reject(Error(r?.error||'通信できません。現在の画面を保持しています。'));else resolve(r);});}catch(e){clearTimeout(timer);reject(e);}
  });
  window.CGWWDetached={request,boot:(async()=>{
    const match=location.hash.match(/^#cgww-(detached|source)=([a-zA-Z0-9_-]{1,100})$/);
    if(match?.[1]==='source'){
      try{const r=await request({action:'source',token:match[2]});history.replaceState(null,'',location.pathname+location.search);return {workspaceId:r.workspaceId};}
      catch(e){const note=document.createElement('p');note.textContent='元の作業を開けませんでした。'+e.message;note.style='position:fixed;top:8px;right:16px;z-index:2147483647;background:Canvas;color:CanvasText;padding:12px';document.documentElement.append(note);return {blocked:true};}
    }
    let token=match?.[2];
    try{token ||= sessionStorage.getItem('cgww.detachedToken');if(token)sessionStorage.setItem('cgww.detachedToken',token);}catch{/* URL marker still supports the first document. */}
    if(!token)return {};
    const host=document.createElement('div');host.style='position:fixed;top:8px;right:16px;z-index:2147483647;max-width:calc(100vw - 32px)';
    const shadow=host.attachShadow({mode:'open'});shadow.innerHTML='<style>:host{font:14px system-ui}section{background:Canvas;color:CanvasText;border:1px solid GrayText;border-radius:8px;padding:8px;box-shadow:0 2px 8px #0003}button{font:inherit;margin:2px;padding:6px}p{max-width:360px;margin:4px}</style><section><button>タブに統合</button><button>元の作業を開く</button><p role="status"></p></section>';
    document.documentElement.append(host);
    const buttons=shadow.querySelectorAll('button'),status=shadow.querySelector('p');
    let busy=false;
    async function action(name){
      if(busy)return;
      if(name==='integrate'&&!confirm('会話URLを元の列に統合します。下書き・添付・生成中の状態は移行しません。このウィンドウは内容確認のため残します。続けますか？'))return;
      busy=true;buttons.forEach(b=>b.disabled=true);
      try{await request({action:name,token});status.textContent=name==='integrate'?'統合しました。内容を確認してから、このウィンドウを閉じてください。':'元の作業を開きました。読み込み後に統合してください。';}
      catch(e){status.textContent=e.message;}finally{busy=false;buttons.forEach(b=>b.disabled=false);}
    }
    buttons[0].onclick=()=>action('integrate');buttons[1].onclick=()=>action('reopen');
    chrome.runtime.onMessage.addListener((m,s,reply)=>{if(m?.type==='CGWW_DETACHED_PROBE'&&s.id===chrome.runtime.id&&!s.tab)reply({ok:m.token===token});});
    try{await request({action:'identify',token});}catch(e){status.textContent=e.message;}
    return {detached:true};
  })()};
})();
