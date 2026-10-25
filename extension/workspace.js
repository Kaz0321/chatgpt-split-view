/*
 * ChatGPT Wide Workspace - strictly local, opt-in UI proof of concept.
 * Does not touch cookies, fetch endpoints, transcripts, or bypass frame security headers.
 * The site remains the top-level origin; only its existing history sidebar remains visible.
 */
(() => {
  'use strict';
  if (window !== window.top || !window.CGWWCore || document.getElementById('cgww-host')) return;
  const Core = window.CGWWCore;
  const SESSION_KEY = 'cgww.v1.workspace';
  const PREF_KEY = 'cgww.v1.preferences';
  let settings = Core.normalizeSettings();
  let state = { enabled: false, panes: [], activeId: null };
  const paneNodes = new Map();
  let host, shadow, panel, launcher, scroller, flashNode, infoButton;
  let draggedPaneId=null, statusTimer=null;
  let fallbackDock, fallbackList, equalButton, maxWidthNote, nativeSidebarCheck;
  let geometryObserver = null;
  let masterObserver=null,masterFrame=null,masterStyle=null,pinnedMaster=null,pendingOpener=null;
  let originalMaxWidth = 920;
  let settingsInputs = null;
  const SIDE_NAV = '#ds-sidebar, #stage-slideover-sidebar, [data-testid="sidebar"], [data-app-navigation-rail], [data-app-action-sidebar-scroll], [data-sidebar-destination]';
  const FRAME_NAV_CSS = `
    #ds-sidebar,
    #stage-slideover-sidebar,
    [data-testid="sidebar"],
    [data-app-navigation-rail],
    [data-app-action-sidebar-scroll],
    [data-sidebar-destination],
    [data-testid="sidebar-navigation"],
    [data-testid="navigation-sidebar"],
    [data-cgww-embedded-nav="true"] {
      display: none !important; visibility: hidden !important;
      width: 0 !important; min-width: 0 !important; max-width: 0 !important;
      overflow: hidden !important;
    }
    :root { --sidebar-width: 0px; --sidebar-current-width: 0px; }
  `;

  function newId() {
    return crypto.randomUUID ? crypto.randomUUID() : `p${Date.now()}_${Math.random().toString(36).slice(2)}`;
  }

  function setStatus(text, isWarning = false) {
    if (!flashNode) return;
    flashNode.textContent = text;
    flashNode.classList.toggle('warning', isWarning);
    if(infoButton)infoButton.title=text;
    flashNode.parentElement.hidden=false;
    clearTimeout(statusTimer);statusTimer=setTimeout(()=>{if(flashNode)flashNode.parentElement.hidden=true;},4500);
  }

  function readOriginalMaxWidth() {
    // Prefer ChatGPT's own conversation max-width variable. A detached measurement
    // element resolves rem, vw, CSS calc, etc. Never writes ChatGPT styles.
    try {
      const candidates = [document.documentElement, document.body, document.querySelector('main')].filter(Boolean);
      for (const node of candidates) {
        const value = getComputedStyle(node).getPropertyValue('--thread-content-max-width').trim();
        if (!value) continue;
        const probe = document.createElement('span');
        probe.style.cssText = 'position:absolute;visibility:hidden;display:block;pointer-events:none;';
        probe.style.width = value;
        document.documentElement.appendChild(probe);
        const measured = probe.getBoundingClientRect().width;
        probe.remove();
        // Match the actual content cap; do not add an undocumented 48px.
        if (measured > 400 && measured < 1100) return Math.round(measured);
      }
    } catch { /* fallback is intentionally conservative */ }
    return 920;
  }

  function measureNativeSidebar() {
    const selectors = '#ds-sidebar, #stage-slideover-sidebar, [data-testid="sidebar"], [data-testid="sidebar-navigation"]';
    const nodes = Array.from(document.querySelectorAll(selectors));
    // Some ChatGPT variants expose the expanded pane as a nav/aside landmark.
    nodes.push(...Array.from(document.querySelectorAll('aside, nav')).slice(0, 15));
    return nodes.some(el => {
      const r = el.getBoundingClientRect();
      const st = getComputedStyle(el);
      return r.left < 80 && r.right > 175 && r.width >= 175 && r.height > 180 && st.display !== 'none' && st.visibility !== 'hidden';
    });
  }

  function findNativeOpener() {
    const selectors = ['[data-testid="open-sidebar-button"]',
      'button[aria-label="Open sidebar"]', 'button[aria-label="Show sidebar"]',
      'button[aria-label="サイドバーを開く"]', 'button[aria-label="サイドバーを表示"]'];
    for (const selector of selectors) {
      const el = document.querySelector(selector);
      if (el && el.getBoundingClientRect().width > 0) return el;
    }
    return null;
  }

  function sidebarWidth() {
    return Math.min(settings.sidebarWidth,Math.max(120,(window.innerWidth||1024)-320));
  }

  function releaseMasterSidebar() {
    if(pinnedMaster){pinnedMaster.removeAttribute('data-cgww-master-sidebar');pinnedMaster=null;}
    masterStyle?.remove();masterStyle=null;pendingOpener=null;
  }

  function pinMasterSidebar() {
    if(!state.enabled||!settings.keepMasterSidebar){releaseMasterSidebar();return;}
    const candidates=Array.from(document.querySelectorAll('#ds-sidebar, #stage-slideover-sidebar, [data-testid="sidebar"], [data-testid="sidebar-navigation"]'));
    const native=candidates.find(el=>el.childElementCount>0);
    if(!native){if(pinnedMaster&&!pinnedMaster.isConnected)releaseMasterSidebar();return;}
    if(pinnedMaster!==native){pinnedMaster?.removeAttribute('data-cgww-master-sidebar');pinnedMaster=native;native.setAttribute('data-cgww-master-sidebar','true');}
    if(!masterStyle){masterStyle=document.createElement('style');masterStyle.id='cgww-master-pin';document.documentElement.appendChild(masterStyle);}
    const css=`[data-cgww-master-sidebar="true"]{display:block!important;visibility:visible!important;opacity:1!important;position:fixed!important;inset:0 auto 0 0!important;transform:none!important;translate:none!important;width:${sidebarWidth()}px!important;min-width:0!important;max-width:${sidebarWidth()}px!important;height:100dvh!important;max-height:100dvh!important;overflow:auto!important;z-index:2147483644!important;pointer-events:auto!important}`;
    if(masterStyle.textContent!==css)masterStyle.textContent=css;
  }

  function tryExpandNativeSidebar(userInitiated = false) {
    if (!state.enabled || !settings.keepMasterSidebar || measureNativeSidebar()) {pendingOpener=null;return true;}
    const opener=findNativeOpener();
    // One automatic attempt per visible opener episode. No polling/double clicks.
    if(!opener||(!userInitiated&&pendingOpener===opener))return false;
    pendingOpener=opener;opener.click();return true;
  }

  function scheduleMasterSidebar() {
    if(masterFrame!==null||!state.enabled)return;
    masterFrame=requestAnimationFrame(()=>{masterFrame=null;ensureMasterSidebar();});
  }

  function startMasterWatch() {
    if(masterObserver||typeof MutationObserver!=='function')return;
    const relevant=node=>node?.nodeType===1&&node.id!=='cgww-host'&&node.id!=='cgww-master-pin'&&
      (node===document.body||node===document.documentElement||node===pinnedMaster||node.contains?.(pinnedMaster)||node.matches?.(SIDE_NAV+', button')||node.querySelector?.(SIDE_NAV));
    masterObserver=new MutationObserver(records=>{if(records.some(r=>r.type==='attributes'?relevant(r.target):Array.from(r.addedNodes||[]).concat(Array.from(r.removedNodes||[])).some(relevant)))scheduleMasterSidebar();});
    masterObserver.observe(document.documentElement,{subtree:true,childList:true,attributes:true,attributeFilter:['class','style','hidden','aria-expanded']});
    window.addEventListener('resize',scheduleMasterSidebar);document.addEventListener('transitionend',scheduleMasterSidebar,true);
  }

  function stopMasterWatch() {
    masterObserver?.disconnect();masterObserver=null;
    if(masterFrame!==null){cancelAnimationFrame(masterFrame);masterFrame=null;}
    window.removeEventListener('resize',scheduleMasterSidebar);document.removeEventListener('transitionend',scheduleMasterSidebar,true);releaseMasterSidebar();
  }

  function updateFallbackDock() {
    if (!fallbackDock) return;
    const needsFallback = state.enabled && settings.keepMasterSidebar && !measureNativeSidebar();
    fallbackDock.hidden = !needsFallback;
    if (!needsFallback || !fallbackList) return;
    const signature=JSON.stringify(state.panes.map(p=>[p.id,p.title,p.visible]));
    if(fallbackList.dataset.signature===signature)return;
    fallbackList.dataset.signature=signature;fallbackList.replaceChildren();
    const registered = state.panes.filter(p => p.url);
    if (!registered.length) fallbackList.appendChild(create('p', 'dock-empty', 'まず会話URLを追加してください。'));
    for (const pane of registered) {
      const item = button(pane.title, 'このチャット列を表示', () => {
        pane.visible = true;
        state.activeId = pane.id;
        renderPane(pane); markActive(); applyColumnWidths(); safeSave(); updateFallbackDock();
      }, 'dock-item');
      if (pane.id === state.activeId) item.classList.add('selected');
      fallbackList.appendChild(item);
    }
  }

  function tagEmbeddedNavigation(frame) {
    if (!settings.hideFrameSidebar) return;
    try {
      const doc = frame.contentDocument;
      if (!doc || frame.contentWindow.location.origin !== Core.ORIGIN) return;
      const frameWidth = frame.clientWidth || 600;
      const frameHeight = frame.clientHeight || 650;
      const candidates = doc.querySelectorAll('aside, nav, [role="navigation"], [data-testid="sidebar"], [data-app-navigation-rail]');
      for (const node of candidates) {
        const r = node.getBoundingClientRect();
        // Geometry fallback for ChatGPT variants with changing data attributes.
        // An actual side rail must be tall, comparatively narrow and left-docked.
        if (r.left <= 100 && r.width >= 30 && r.width < Math.min(520, Math.max(320, frameWidth * .85)) &&
            r.height >= Math.min(220, frameHeight * .45) && r.height > r.width * 1.2 &&
            node.getAttribute('data-cgww-embedded-nav') !== 'true')
          node.setAttribute('data-cgww-embedded-nav', 'true');
      }
    } catch { /* same-origin frames only */ }
  }

  function ensureMasterSidebar() {
    if(!state.enabled||!settings.keepMasterSidebar){releaseMasterSidebar();updateFallbackDock();return;}
    pinMasterSidebar();
    if(!measureNativeSidebar())tryExpandNativeSidebar();else pendingOpener=null;
    updateGeometry();updateFallbackDock();
  }

  function getPaneWidth(pane) {
    if (settings.equalizeColumns) {
      const visibleCount = state.panes.filter(p => p.visible).length;
      return Core.calculateEqualWidth(scroller?.clientWidth, visibleCount, originalMaxWidth);
    }
    return Core.boundedNumber(pane.width, settings.paneWidth, 320, originalMaxWidth);
  }

  function applyColumnWidths() {
    if (!scroller) return;
    for (const pane of state.panes) {
      const entry = paneNodes.get(pane.id);
      if (entry) entry.root.style.width = `${getPaneWidth(pane)}px`;
    }
    if (equalButton) { equalButton.textContent = settings.equalizeColumns ? '等分: ON' : '等分: OFF'; equalButton.setAttribute('aria-pressed',String(settings.equalizeColumns)); }
    if(settingsInputs?.widthInput){settingsInputs.widthInput.disabled=settings.equalizeColumns;settingsInputs.widthInput.value=String(settings.equalizeColumns?getPaneWidth(state.panes.find(p=>p.visible)||{}):settings.paneWidth);}
    if (settingsInputs?.equalInput) settingsInputs.equalInput.checked = settings.equalizeColumns;
  }

  function setEqualize(enabled) {
    settings.equalizeColumns = Boolean(enabled);
    applyColumnWidths(); savePrefs(); safeSave();
    setStatus(settings.equalizeColumns ? '表示中の列を等幅にしました。ウィンドウサイズに自動追従します（iframeの再読込なし）。' : '手動の列幅に戻しました（iframeの再読込なし）。');
  }

  function safeSave() {
    try {
      sessionStorage.setItem(SESSION_KEY, JSON.stringify({
        enabled: state.enabled,
        activeUrl: state.panes.find(p => p.id === state.activeId)?.url || null,
        panes: state.panes.map(p => ({ url: p.url, title: p.title, width: p.width, visible: p.visible }))
      }));
    } catch { setStatus('このタブの状態を保存できませんでした。', true); }
  }

  async function savePrefs() {
    try { await chrome.storage.local.set({ [PREF_KEY]: settings }); }
    catch { setStatus('設定保存に失敗しました。', true); }
  }

  function create(tag, className, text) {
    const el = document.createElement(tag);
    if (className) el.className = className;
    if (typeof text === 'string') el.textContent = text;
    return el;
  }

  function button(text, tooltip, action, className = '') {
    const el = create('button', className, text);
    el.type = 'button';
    el.title = tooltip;
    el.addEventListener('click', action);
    return el;
  }

  function makeUI() {
    host = document.createElement('div'); host.id = 'cgww-host';
    shadow = host.attachShadow({ mode: 'open' });
    const style = document.createElement('style');
    style.textContent = `
      :host{all:initial}*,*::before,*::after{box-sizing:border-box}button,input{font:inherit}button{cursor:pointer}
      button:focus-visible,input:focus-visible{outline:2px solid #448af0;outline-offset:1px}
      .launcher{position:fixed;right:14px;top:10px;z-index:2147483646;padding:7px 11px;border:1px solid #49627d;border-radius:8px;background:#19304c;color:#fff;font:13px system-ui;pointer-events:auto}
      .board{position:fixed;inset:0 0 0 auto;z-index:2147483645;display:flex;flex-direction:column;background:#e9eef4;color:#1c3048;font:12px system-ui;box-shadow:-2px 0 8px #0002;pointer-events:auto}
      .board[hidden],.launcher[hidden],.dock[hidden],.pane[hidden],.hintbar[hidden]{display:none!important}
      .scroller{flex:1;min-height:0;display:flex;gap:7px;padding:9px;overflow-x:auto;overflow-y:hidden;background:#dfe6ef;scroll-snap-type:x proximity}
      .pane{position:relative;flex:none;min-width:320px;display:flex;flex-direction:column;height:100%;border:1px solid #aebdcd;border-radius:8px;overflow:hidden;background:#fff;scroll-snap-align:start}
      .pane.active{outline:2px solid #347ed5;outline-offset:-2px}.pane.dragging{opacity:.65}.pane.drop-before{box-shadow:inset 4px 0 #1684ed}.pane.drop-after{box-shadow:inset -4px 0 #1684ed}
      .pane-head{height:32px;min-height:32px;display:flex;align-items:center;gap:3px;padding:3px 5px;border-bottom:1px solid #e0e6ed;background:#fff}
      .pane-control{flex:none;display:inline-flex;align-items:center;justify-content:center;gap:3px;height:24px;min-width:24px;padding:0 5px;border:1px solid transparent;border-radius:4px;background:transparent;color:#526579;font-size:12px;line-height:1;vertical-align:middle}
      .pane-control:hover{border-color:#d7e1eb;background:#edf2f7;color:#243b51}.pane-control:active{background:#dfe8f1}
      .drag-grip{width:24px;padding:0;cursor:grab;font-size:14px}.drag-grip:active{cursor:grabbing}
      .pane-close{width:24px;padding:0;font-size:20px;font-weight:400}.pane-close:hover{border-color:#e5c5c5;background:#fff0f0;color:#a33131}
      .pane-index{flex:none;font-size:10px;color:#497198;padding:2px}.pane-title{flex:1;min-width:45px;width:50px;height:24px;padding:2px 3px;border:1px solid transparent;border-radius:4px;font-size:12px;color:#243b51}.pane-title:focus{border-color:#8dabcb}
      .pane-status{font-size:10px;flex:none;color:#8192a3;cursor:help}.pane-status[data-state=loaded]{color:#3e8b6a}.pane-status[data-state=warning]{color:#b46825}
      .pane-main{position:relative;flex:1;min-height:0;background:#fff}iframe{display:block;width:100%;height:100%;border:0;background:#fff}.empty{padding:24px 15px;line-height:1.8;color:#62748a;text-align:center}
      .resize{position:absolute;right:0;top:32px;bottom:0;width:5px;cursor:ew-resize;background:transparent;z-index:1}.resize:hover{background:#4c91df88}
      .hintbar{position:absolute;bottom:10px;left:10px;right:10px;z-index:4;padding:7px 10px;border:1px solid #c4d3e2;border-radius:7px;background:#f8fbffff;box-shadow:0 2px 10px #0002;pointer-events:none;font-size:11px;color:#45617d}.flash.warning{color:#a94f29}
      .dock{position:fixed;inset:0 auto 0 0;width:276px;z-index:2147483645;overflow:auto;padding:12px;background:#fafcff;border-right:1px solid #c7d5e3;color:#243c54;font:12px system-ui}.dock h3{font-size:14px;margin:4px 0}.dock-note{font-size:11px;line-height:1.6;color:#748496}.dock-item{display:block;width:100%;border:0;border-radius:5px;background:transparent;text-align:left;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;padding:9px 6px;margin:3px 0;color:#314b66}.dock-item:hover,.dock-item.selected{background:#e0edfc}.dock-control{width:100%;padding:7px;border:1px solid #a4bdd4;border-radius:5px;background:#f0f6fc;color:#35546e}.dock-empty{font-size:11px;color:#7b8c9b}
    `;
    shadow.appendChild(style);
    fallbackDock = create('aside', 'dock'); fallbackDock.hidden = true;
    fallbackDock.appendChild(create('h3', '', 'ChatGPT 作業一覧'));
    fallbackDock.appendChild(create('p', 'dock-note', '公式履歴の表示待ちです。ここはこのタブに登録した列だけの代替一覧で、全履歴や同期一覧ではありません。'));
    fallbackDock.appendChild(button('公式履歴を開く', '元画面の履歴ペインを展開', () => { tryExpandNativeSidebar(true); setTimeout(updateFallbackDock, 250); }, 'dock-control'));
    fallbackList = create('div'); fallbackDock.appendChild(fallbackList); shadow.appendChild(fallbackDock);
    panel = create('section', 'board'); panel.hidden = true; panel.setAttribute('role','region'); panel.setAttribute('aria-label','ChatGPT 横並びワークスペース');
    scroller=create('main','scroller');panel.appendChild(scroller);
    const hintbar=create('div','hintbar');hintbar.hidden=true;hintbar.setAttribute('role','status');flashNode=create('span','flash','ドラッグで列を移動。Alt+←/→でも並べ替えできます。');hintbar.appendChild(flashNode);panel.appendChild(hintbar);
    shadow.appendChild(panel);document.documentElement.appendChild(host);
    originalMaxWidth=readOriginalMaxWidth();
    updateGeometry();applyColumnWidths();
    if(typeof ResizeObserver==='function'){geometryObserver=new ResizeObserver(()=>applyColumnWidths());geometryObserver.observe(scroller);}else window.addEventListener('resize',applyColumnWidths);
  }

  function openOptions() {
    if(!chrome.runtime?.sendMessage){setStatus('オプションは拡張環境で開いてください。',true);return;}
    chrome.runtime.sendMessage({type:'CGWW_OPEN_OPTIONS'},result=>{if(chrome.runtime.lastError||!result?.ok)setStatus('オプションを開けませんでした。',true);});
  }

  function applyPreferences(raw) {
    const previous=settings;settings=Core.normalizeSettings(raw);
    if(previous.paneWidth!==settings.paneWidth)for(const p of state.panes)p.width=settings.paneWidth;
    if(previous.hideFrameSidebar!==settings.hideFrameSidebar)paneNodes.forEach(entry=>{if(entry.iframe)applyIframeSidebarRule(entry.iframe);});
    updateGeometry();ensureMasterSidebar();safeSave();
  }

  function syncPaneOrder() {
    state.panes.forEach((pane,index)=>{const entry=paneNodes.get(pane.id);if(!entry)return;entry.root.style.order=String(index);entry.root.dataset.visualOrder=String(index);entry.index.textContent=String(index+1);entry.grip.setAttribute('aria-label',`列 ${index+1} を移動`);});
  }

  function reorderPane(sourceId,targetId,after=false) {
    const next=Core.movePane(state.panes,sourceId,targetId,after);
    if(next===state.panes)return;
    state.panes=next;syncPaneOrder();safeSave();setStatus('列の順番を変更しました。会話の再読み込みはしていません。');
  }

  function attachPaneDrag(root,grip,pane) {
    grip.draggable=true;grip.title='ドラッグで列を並べ替え。Alt+←/→でも移動';
    const clear=()=>{draggedPaneId=null;paneNodes.forEach(e=>e.root.classList.remove('dragging','drop-before','drop-after'));};
    grip.addEventListener('dragstart',event=>{if(!event.dataTransfer)return;draggedPaneId=pane.id;event.dataTransfer.setData(Core.PANE_DRAG_TYPE,pane.id);event.dataTransfer.effectAllowed='move';root.classList.add('dragging');});
    grip.addEventListener('dragend',clear);
    root.addEventListener('dragover',event=>{if(!draggedPaneId||!Core.isPaneReorderDrag(event.dataTransfer?.types))return;event.preventDefault();event.dataTransfer.dropEffect='move';const after=event.clientX>root.getBoundingClientRect().left+root.getBoundingClientRect().width/2;root.classList.toggle('drop-before',!after);root.classList.toggle('drop-after',after);});
    root.addEventListener('dragleave',()=>root.classList.remove('drop-before','drop-after'));
    root.addEventListener('drop',event=>{if(!draggedPaneId||!Core.isPaneReorderDrag(event.dataTransfer?.types))return;const id=event.dataTransfer.getData(Core.PANE_DRAG_TYPE);if(id!==draggedPaneId)return;event.preventDefault();event.stopPropagation();const rect=root.getBoundingClientRect();reorderPane(id,pane.id,event.clientX>rect.left+rect.width/2);clear();});
    grip.addEventListener('keydown',event=>{if(!event.altKey||!['ArrowLeft','ArrowRight'].includes(event.key))return;event.preventDefault();const visible=state.panes.filter(p=>p.visible);const i=visible.findIndex(p=>p.id===pane.id),right=event.key==='ArrowRight',target=visible[i+(right?1:-1)];if(target)reorderPane(pane.id,target.id,right);});
  }

  function setPaneStatus(node,text,stateName='') { node.textContent='●';node.title=text;node.setAttribute('aria-label',text);node.dataset.state=stateName; }

  function updateGeometry() {
    if (panel) panel.style.left = `${sidebarWidth()}px`;
    if (fallbackDock) fallbackDock.style.width = `${sidebarWidth()}px`;
    applyColumnWidths();
  }

  function setEnabled(enabled) {
    state.enabled = Boolean(enabled);
    panel.hidden = !state.enabled;
    if(launcher)launcher.hidden = state.enabled;
    if (state.enabled && state.panes.length === 0) {
      const url = Core.chatUrl(location.href);
      if (url) addPane(url, '現在のチャット');
      else addEmptyPane();
    }
    if (state.enabled) {
      for (const p of state.panes) if (p.visible) renderPane(p);
      startMasterWatch();ensureMasterSidebar();
    } else {stopMasterWatch();updateFallbackDock();}
    applyColumnWidths(); safeSave();
  }

  function emptyPane() {
    return { id: newId(), url: null, title: '未設定の列', width: settings.paneWidth, visible: true };
  }

  function addEmptyPane() {
    if (state.panes.length >= 200) { setStatus('動作保護のため200列が上限です。', true); return; }
    if (state.panes.filter(p => p.visible).length >= 8 && !confirm('9列以上になります。メモリ使用量が増えますが、列を追加しますか？')) return;
    const p = emptyPane();
    state.panes.push(p);
    state.activeId = p.id;
    renderPane(p);
    markActive(); safeSave();
    applyColumnWidths(); updateFallbackDock();
    scroller.scrollLeft = scroller.scrollWidth;
    setStatus('空の列を追加しました。左の履歴から会話を選んでください。');
  }

  function addPane(rawUrl, title, forceNew = false) {
    const url = Core.chatUrl(rawUrl);
    if (!url) { setStatus('ChatGPTの会話URL（/c/...）を指定してください。', true); return; }
    const exists = state.panes.find(p => p.url === url);
    if (exists && !forceNew) {
      exists.visible = true;
      if (exists.title === 'ChatGPT チャット' && title) exists.title = Core.normalizeTitle(title);
      state.activeId = exists.id;
      renderPane(exists); markActive(); applyColumnWidths(); safeSave();
      return;
    }
    const active = state.panes.find(p => p.id === state.activeId);
    if (active && !active.url && !forceNew) {
      active.url = url;
      active.title = Core.normalizeTitle(title);
      active.visible = true;
      renderPane(active); markActive(); applyColumnWidths(); safeSave();
      return;
    }
    if (state.panes.length >= 200) { setStatus('動作保護のため200列が上限です。', true); return; }
    if (state.panes.filter(p => p.visible).length >= 8 && !confirm('さらに列を追加しますか？会話ごとにメモリを使用します。')) return;
    const p = { id: newId(), url, title: Core.normalizeTitle(title), width: settings.paneWidth, visible: true };
    state.panes.push(p);
    state.activeId = p.id;
    renderPane(p); markActive(); safeSave();
    applyColumnWidths(); updateFallbackDock();
    scroller.scrollLeft = scroller.scrollWidth;
  }

  function assignToActive(url, title, forceNew = false) {
    // Incoming conversations never replace a selected/left-hand document.
    const last=state.panes[state.panes.length-1];
    if(last&&last.visible&&!last.url&&!forceNew){last.url=Core.chatUrl(url);if(!last.url)return;last.title=Core.normalizeTitle(title);state.activeId=last.id;renderPane(last);markActive();safeSave();return;}
    addPane(url,title,true);
  }

  function addFromPrompt() {
    const raw = prompt('ChatGPTの会話URL（https://chatgpt.com/c/...）を貼り付けてください。');
    if (raw === null) return;
    const url = Core.chatUrl(raw);
    if (!url) { alert('対応するURLではありません。chatgpt.com の会話URLを入力してください。'); return; }
    addPane(url, '追加したチャット', true);
  }

  function restoreHiddenPane() {
    const hidden = state.panes.filter(p => !p.visible);
    if (!hidden.length) { setStatus('隠した列はありません。'); return; }
    const listing = hidden.map((p, i) => `${i + 1}. ${p.title}`).join('\n');
    const answer = prompt(`戻す列の番号を入力してください。\n${listing}`, '1');
    if (answer === null) return;
    const index = Number(answer) - 1;
    if (!Number.isInteger(index) || index < 0 || index >= hidden.length) return;
    const p = hidden[index]; p.visible = true;
    state.activeId = p.id; renderPane(p); markActive(); applyColumnWidths(); safeSave();
  }

  function historyAnchor(event) {
    const target = event.target;
    // Same-origin iframe elements belong to their own JavaScript realm.
    // Testing them against the parent's Element rejects every iframe click.
    const ElementClass = target?.ownerDocument?.defaultView?.Element || Element;
    if (!(target instanceof ElementClass)) return null;
    return target.closest('a[href]');
  }

  function isSidebarLink(anchor, x, isInsideFrame = false) {
    // Popup menus in the compact navigation rail may extend beyond the
    // user-selected overlay boundary. DOM context takes precedence over X.
    if (anchor.closest(SIDE_NAV + ', nav, aside, [role=menu]')) return true;
    return x <= (isInsideFrame ? 110 : settings.sidebarWidth);
  }

  function handleHistoryClick(event) {
    if (!state.enabled || !settings.interceptSidebar || event.button !== 0 || event.defaultPrevented) return;
    if (event.ctrlKey || event.metaKey || event.altKey) return;
    const anchor = historyAnchor(event);
    if (!anchor || !isSidebarLink(anchor, event.clientX)) return;
    const url = Core.chatUrl(anchor.href);
    if (!url) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    assignToActive(url, Core.normalizeTitle(anchor.innerText || anchor.getAttribute('aria-label') || anchor.textContent), event.shiftKey);
  }

  function attachEmbeddedNavigation(frame, pane) {
    try {
      const doc = frame.contentDocument;
      if (!doc || frame.contentWindow.location.origin !== Core.ORIGIN) return;
      // A click within an iframe does not bubble to the top page. Capture only
      // chat links, preserving default browser behavior for other hyperlinks.
      // Remove any old listener on the same document before attaching.
      if (frame._cgwwDocument === doc) return;
      frame._cgwwDocument = doc;
      doc.addEventListener('click', event => {
        if (!state.enabled || !settings.interceptSidebar || event.button !== 0 || event.defaultPrevented) return;
        if (event.ctrlKey || event.metaKey || event.altKey) return;
        const anchor = historyAnchor(event);
        if (!anchor) return;
        const url = Core.chatUrl(anchor.href);
        if (!url) return;
        // Embedded history links and explicit _blank chat links should be
        // opened in workspace columns, not browser windows. Non-chat links
        // retain their original navigation behavior.
        if (!isSidebarLink(anchor, event.clientX, true) && anchor.target !== '_blank') return;
        event.preventDefault();
        event.stopImmediatePropagation();
        state.activeId = pane.id;
        assignToActive(url, Core.normalizeTitle(anchor.innerText || anchor.getAttribute('aria-label') || anchor.textContent), event.shiftKey);
      }, true);
    } catch { /* Cross-origin/login pages remain unmodified */ }
  }

  function applyIframeSidebarRule(frame) {
    try {
      const doc = frame.contentDocument;
      if (!doc || frame.contentWindow.location.origin !== Core.ORIGIN || !doc.documentElement) return;
      let style = doc.getElementById('cgww-frame-nav-hide');
      if (!style) {
        style = doc.createElement('style');
        style.id = 'cgww-frame-nav-hide';
        // Direct documentElement child remains effective if the site re-renders <head>.
        doc.documentElement.appendChild(style);
      }
      style.textContent = settings.hideFrameSidebar ? FRAME_NAV_CSS : '';
      if (settings.hideFrameSidebar) tagEmbeddedNavigation(frame);
      // Install once per iframe document; re-apply if SPA navigation replaces the
      // stylesheet. Never overwrite the ChatGPT app's state or storage.
      if (frame._cgwwObservedDocument !== doc) {
        frame._cgwwFrameObserver?.disconnect();
        frame._cgwwFrameCleanup?.();
        frame._cgwwObservedDocument = doc;
        const observer = new MutationObserver(() => {
          const existing = doc.getElementById('cgww-frame-nav-hide');
          if (!existing) applyIframeSidebarRule(frame);
          else if (settings.hideFrameSidebar) tagEmbeddedNavigation(frame);
        });
        // Hydrated/replaced navigation is usually below <body>, not a direct
        // <html> child. This remains active even when parent pinning is off.
        observer.observe(doc.documentElement, { childList: true, subtree: true,
          attributes: true, attributeFilter: ['class', 'style', 'hidden'] });
        frame._cgwwFrameObserver = observer;
        // A new stylesheet may finish loading after the DOM mutation callback.
        // Recheck once layout is ready, independently of parent-sidebar pinning.
        const afterLayout = () => {
          // Offscreen iframe animation frames may be deferred. Inspect the now-loaded
          // stylesheet immediately, then once more after layout for visible frames.
          if(settings.hideFrameSidebar)tagEmbeddedNavigation(frame);
          frame.contentWindow.requestAnimationFrame(()=>{if(settings.hideFrameSidebar)tagEmbeddedNavigation(frame);});
        };
        const onStylesheetLoad = event => {
          if (event.target?.tagName === 'LINK' && /\bstylesheet\b/i.test(event.target.rel || '')) afterLayout();
        };
        doc.addEventListener('load', onStylesheetLoad, true);
        frame.contentWindow.addEventListener('resize', afterLayout);
        frame._cgwwFrameCleanup = () => {
          doc.removeEventListener('load', onStylesheetLoad, true);
          frame.contentWindow.removeEventListener('resize', afterLayout);
        };
      }
    } catch { /* security boundary: keep parent page unchanged */ }
  }

  function buildFrame(p, main, foot) {
    const frame = create('iframe');
    frame.setAttribute('data-cgww-frame', 'true');
    frame.src = p.url;
    frame.title = `ChatGPT: ${p.title}`;
    // Respect all server-provided iframe and authentication restrictions.
    frame.addEventListener('load', () => {
      try {
        const doc = frame.contentDocument;
        if (doc && frame.contentWindow.location.origin === Core.ORIGIN && doc.body?.children.length) {
          applyIframeSidebarRule(frame);
          attachEmbeddedNavigation(frame, p);
          setTimeout(ensureMasterSidebar, 250);
          const displayedUrl = frame.contentWindow.location.href;
          setPaneStatus(foot,Core.chatUrl(displayedUrl)?'読込済：会話内の履歴リンクもワークスペースへ割当':'読込先が会話以外です。通常のChatGPT画面で認証や対応形式を確認',Core.chatUrl(displayedUrl)?'loaded':'warning');
        } else {
          setPaneStatus(foot,'埋め込み不可の可能性あり。通常のChatGPT画面で確認','warning');
        }
      } catch {
        setPaneStatus(foot,'認証画面または埋め込み制限。通常のChatGPT画面で確認','warning');
      }
    });
    main.replaceChildren(frame);
    setPaneStatus(foot,'読み込み中… 埋め込み不可の場合は通常のChatGPT画面で確認');
    return frame;
  }

  function renderPane(p) {
    let entry = paneNodes.get(p.id);
    if (entry) {
      entry.root.hidden = !p.visible;
      entry.root.style.width = `${getPaneWidth(p)}px`;
      entry.title.value = p.title;
      if (!entry.iframe && p.url && p.visible && state.enabled) {
        // Filling an empty pane is safe. Existing loaded frames are never replaced.
        entry.iframe = buildFrame(p, entry.main, entry.foot);
      }
      return;
    }
    const root = create('article', 'pane');
    root.style.width = `${getPaneWidth(p)}px`;
    root.hidden = !p.visible;
    const head = create('div', 'pane-head');
    const grip=button('⠿','列をドラッグで移動',()=>{state.activeId=p.id;markActive();},'pane-control drag-grip');head.appendChild(grip);
    const index = create('span', 'pane-index', String(state.panes.indexOf(p) + 1));
    head.appendChild(index);
    const title = create('input', 'pane-title');
    title.type = 'text'; title.maxLength = 100; title.value = p.title; title.title = '表示名を編集'; title.setAttribute('aria-label', '列の表示名');
    title.addEventListener('change', () => { p.title = Core.normalizeTitle(title.value); title.value = p.title; safeSave(); });
    title.addEventListener('focus', () => { state.activeId = p.id; markActive(); });
    head.appendChild(title);
    const foot=create('span','pane-status');setPaneStatus(foot,'会話URL未指定');head.appendChild(foot);
    const reloadButton=button('↻ 更新','この列だけを再読み込み。端末間の同期は保証しません。',()=>reloadPane(p),'pane-control pane-reload');reloadButton.setAttribute('aria-label','この列を更新');head.appendChild(reloadButton);
    const closeButton=button('×', 'この列を閉じる（ポップアップから復帰可能）', () => {
      p.visible = false;
      root.hidden = true;
      const visible = state.panes.find(x => x.visible);
      state.activeId = visible?.id || null;
      markActive(); applyColumnWidths(); safeSave();
      setStatus('列を非表示にしました。iframeは保持されています。');
    }, 'pane-control pane-close');closeButton.setAttribute('aria-label','この列を閉じる');head.appendChild(closeButton);
    root.appendChild(head);
    const main = create('div', 'pane-main');
    let iframe;
    if (p.url && state.enabled && p.visible) iframe = buildFrame(p, main, foot);
    else if (p.url) main.appendChild(create('div', 'empty', '列を表示すると、このチャットを読み込みます。'));
    else main.appendChild(create('div', 'empty', '左の履歴からチャットをクリックしてください。\n\n会話は常に右端へ追加します。'));
    root.appendChild(main);
    const resizer = create('div', 'resize');
    resizer.title = 'ドラッグでこの列の幅を変更';
    resizer.addEventListener('pointerdown', event => {
      if (event.button !== 0) return;
      if (settings.equalizeColumns) { setStatus('等分モード中です。ドラッグで変更するには「等分: OFF」にしてください。'); return; }
      event.preventDefault(); resizer.setPointerCapture(event.pointerId);
      const start = event.clientX, initial = getPaneWidth(p);
      const move = e => {
        p.width = Core.boundedNumber(initial + (e.clientX - start), initial, 320, originalMaxWidth);
        root.style.width = `${getPaneWidth(p)}px`;
      };
      const stop = () => {
        resizer.removeEventListener('pointermove', move);
        resizer.removeEventListener('pointerup', stop);
        resizer.removeEventListener('pointercancel', stop);
        safeSave();
      };
      resizer.addEventListener('pointermove', move);
      resizer.addEventListener('pointerup', stop);
      resizer.addEventListener('pointercancel', stop);
    });
    root.appendChild(resizer);
    root.addEventListener('pointerdown', event => {
      if (event.target === title) return;
      state.activeId = p.id; markActive();
    });
    scroller.appendChild(root);
    paneNodes.set(p.id, { root, iframe, title, main, foot, index, grip });
    attachPaneDrag(root,grip,p);syncPaneOrder();applyColumnWidths();
  }

  function reloadPane(pane) {
    const entry=paneNodes.get(pane.id);if(!entry?.iframe)return;
    // Always confirm, without inspecting private draft contents or attachments.
    if(!confirm('この列だけを更新します。未送信の入力・添付・生成中の内容が失われる可能性があります。続けますか？'))return;
    setPaneStatus(entry.foot,'この列を再読み込み中');
    try{entry.iframe.contentWindow.location.reload();}catch{entry.iframe.src=pane.url;}
  }

  function actionState() {
    return {ok:true,enabled:state.enabled,equalizeColumns:settings.equalizeColumns,paneWidth:settings.paneWidth,maxWidth:originalMaxWidth,visibleCount:state.panes.filter(p=>p.visible).length,totalCount:state.panes.length,hiddenPanes:state.panes.filter(p=>!p.visible).map(p=>({id:p.id,title:p.title}))};
  }

  function handleAction(message,sender,reply) {
    if(message?.type!=='CGWW_ACTION')return;
    if(sender?.id!==chrome.runtime.id||sender?.url!==chrome.runtime.getURL('popup.html')||sender?.tab){reply({ok:false,error:'許可されていない操作元です。'});return;}
    try{
      switch(message.action){
        case 'status':break;
        case 'enable':setEnabled(true);break;
        case 'disable':setEnabled(false);break;
        case 'add':if(!state.enabled)throw Error('横並びを開始してください。');addEmptyPane();break;
        case 'width':settings.paneWidth=Core.boundedNumber(message.value,settings.paneWidth,320,originalMaxWidth);for(const p of state.panes)p.width=settings.paneWidth;applyColumnWidths();savePrefs();safeSave();break;
        case 'equal':setEqualize(message.value===true);break;
        case 'addUrl':if(!state.enabled)throw Error('横並びを開始してください。');if(!Core.chatUrl(message.url))throw Error('有効なChatGPT会話URLを指定してください。');assignToActive(message.url,'追加したチャット');break;
        case 'restore':{const p=state.panes.find(p=>p.id===message.paneId&&!p.visible);if(!p)throw Error('復帰する列が見つかりません。');p.visible=true;state.activeId=p.id;renderPane(p);markActive();applyColumnWidths();safeSave();break;}
        default:throw Error('未対応の操作です。');
      }
      reply(actionState());
    }catch(error){reply({ok:false,error:error.message||'操作に失敗しました。'});}
  }

  function markActive() {
    paneNodes.forEach((entry, id) => entry.root.classList.toggle('active', id === state.activeId));
    updateFallbackDock(); safeSave();
  }

  async function initialize() {
    try {
      const obj = await chrome.storage.local.get(PREF_KEY);
      settings = Core.normalizeSettings(obj?.[PREF_KEY]);
    } catch { /* keep safe defaults */ }
    try {
      const raw = sessionStorage.getItem(SESSION_KEY);
      if (raw) {
        const stored = JSON.parse(raw);
        state.enabled = stored?.enabled === true;
        state.panes = Core.normalizeSessionPanes(stored?.panes).map(p => ({ ...p, id: newId() }));
        state.activeId = state.panes.find(p => p.url === stored?.activeUrl)?.id || state.panes.find(p => p.visible)?.id || null;
      }
    } catch { /* corrupted session data: keep empty state, do not remove existing storage */ }
    makeUI();
    for (const p of state.panes) renderPane(p);
    applyColumnWidths(); markActive();
    if (state.enabled) setEnabled(true);
    // Register only a capture listener. Disabled state leaves all ChatGPT links untouched.
    window.addEventListener('click', handleHistoryClick, true);
    chrome.runtime?.onMessage?.addListener(handleAction);
    chrome.storage?.onChanged?.addListener((changes,area)=>{if(area==='local'&&changes[PREF_KEY])applyPreferences(changes[PREF_KEY].newValue);});
  }

  void initialize();
})();
