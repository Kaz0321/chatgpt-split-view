/*
 * ChatGPT Wide Workspace - strictly local, opt-in UI proof of concept.
 * Does not touch cookies, fetch endpoints, transcripts, or bypass frame security headers.
 * The site remains the top-level origin; only its existing history sidebar remains visible.
 */
(() => {
  'use strict';
  if (window !== window.top || !window.CGWWCore || document.getElementById('cgww-host')) return;
  const Core = window.CGWWCore;
  const Layout = window.CGWWLayout;
  const Drafts = window.CGWWDrafts;
  let workspaceId = null;
  let initializing=false,initialized=false,restoringWorkspace=false,durableToken=null,saveSequence=0,pendingSnapshot=null,saveInFlight=false;
  let savePromise=null,saveProblem=false,saveBadge,undoButton,restoreBadge,autoRestored=false,lastClosed=null,undoTimer=null,switching=false;
  const SESSION_KEY = 'cgww.v1.workspace';
  const PREF_KEY = 'cgww.v1.preferences';
  let settings = Core.normalizeSettings();
  let state = { enabled: false, panes: [], activeId: null };
  let closedPanes = [];
  const paneNodes = new Map();
  let host, shadow, panel, launcher, scroller, flashNode, infoButton;
  let draggedPaneId=null, statusTimer=null;
  let overlay, overlayMenu, viewToggle, menuControls, overlayPosition=null;
  let sidebarHandle;
  let fallbackDock, fallbackList, equalButton, maxWidthNote, nativeSidebarCheck;
  let geometryObserver = null;
  let masterObserver=null,masterFrame=null,masterStyle=null,pinnedMaster=null,pendingOpener=null;
  let nativeMenuObserver=null,nativeMenuFrame=null,nativeMenuStyle=null;
  const nativeMenuMarks=new Map();
  const ACTION_MENU='[role="menu"], [role="menuitem"], [role="menuitemcheckbox"], [role="menuitemradio"], [data-radix-menu-content], [aria-haspopup="menu"], [aria-haspopup="true"]';
  let originalMaxWidth = 1400; // outer pane cap, not the text/content cap
  let contentWidthDetected=false,contentLayoutTimer=null,contentLayoutObserver=null;
  let settingsInputs = null;
  const SIDE_NAV = '.app-shell-left-panel, #app-shell-sidebar, #ds-sidebar, #stage-slideover-sidebar, [data-testid="sidebar"], [data-app-navigation-rail], [data-app-action-sidebar-scroll], [data-sidebar-destination]';
  const FRAME_NAV_CSS = `
    .app-shell-left-panel,
    #app-shell-sidebar,
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
    /* The hidden navigation's divider belongs to the adjacent main surface.
       Keep this inside the iframe-only, hideFrameSidebar stylesheet. */
    main[class*="MainContentLeftBorder-"] { border-left-width: 0 !important; }
    /* Modern app-shell paints the rail separately from the hidden aside:
       a workspace ::before and a transparent PageSurface with a shadow. */
    [data-app-shell-frame] {
      --app-shell-navigation-rail-width: 0px !important;
      --app-shell-left-panel-width: 0px !important;
      --app-shell-animated-left-panel-width: 0px !important;
    }
    [data-app-shell-workspace]::before {
      inset-inline-start: 0 !important;
      border-start-start-radius: 0 !important;
      border-end-start-radius: 0 !important;
    }
    [data-app-shell-workspace] > [class*="PageSurface-"] {
      display: none !important;
    }
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
    if(!Layout)return 1400;
    const measurement=Layout.inspect(document,{compact:true,gutter:settings.contentPadding});
    contentWidthDetected=measurement.detected;
    return measurement.outerMax;
  }

  function refreshContentLayout() {
    contentLayoutTimer=null;
    if(!Layout)return;
    const native=Layout.inspect(document,{compact:true,gutter:settings.contentPadding});
    const nativeContentMax=native.detected&&native.columns?.length?Math.max(...native.columns.map(c=>c.contentMax)):undefined;
    const caps=native.detected?[native.outerMax]:[];let unknownFrame=false;
    for(const entry of paneNodes.values()){
      const frame=entry.iframe;
      try{
        if(!frame?.contentDocument||frame.contentWindow.location.origin!==Core.ORIGIN)continue;
        const doc=frame.contentDocument;
        if(frame._cgwwContentDocument!==doc){frame._cgwwContentDocument=doc;frame._cgwwScrollbarAllowance=0;}
        const measurement=Layout.inspect(doc,{compact:true,gutter:settings.contentPadding,contentMax:nativeContentMax,scrollbarAllowance:frame._cgwwScrollbarAllowance||0});
        frame._cgwwScrollbarAllowance=measurement.scrollbarAllowance;
        Layout.apply(doc,measurement);
        if(measurement.detected)caps.push(measurement.outerMax);else unknownFrame=true;
      }catch{/* Authentication or cross-origin documents stay untouched. */}
    }
    const detected=caps.length>0&&!unknownFrame,next=detected?Math.max(...caps):1400;
    if(next!==originalMaxWidth||detected!==contentWidthDetected){originalMaxWidth=next;contentWidthDetected=detected;applyColumnWidths();syncOverlay();}
  }

  function scheduleContentLayout() {
    if(!Layout||contentLayoutTimer!==null)return;
    contentLayoutTimer=setTimeout(refreshContentLayout,100);
  }

  function measureNativeSidebar() {
    const selectors = '.app-shell-left-panel, #app-shell-sidebar, #ds-sidebar, #stage-slideover-sidebar, [data-testid="sidebar"], [data-testid="sidebar-navigation"]';
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
    if(!settings.sidebarVisible)return 0;
    return Math.min(settings.sidebarWidth,Math.max(120,(window.innerWidth||1024)-320));
  }

  function releaseMasterSidebar() {
    if(pinnedMaster){pinnedMaster.removeAttribute('data-cgww-master-sidebar');pinnedMaster=null;}
    masterStyle?.remove();masterStyle=null;pendingOpener=null;
  }

  function pinMasterSidebar() {
    if(!state.enabled){releaseMasterSidebar();return;}
    if(!settings.sidebarVisible){
      if(!masterStyle){masterStyle=document.createElement('style');masterStyle.id='cgww-master-pin';document.documentElement.appendChild(masterStyle);}
      const css=SIDE_NAV+'{display:none!important;visibility:hidden!important;pointer-events:none!important}';
      if(masterStyle.textContent!==css)masterStyle.textContent=css;return;
    }
    if(!settings.keepMasterSidebar){releaseMasterSidebar();return;}
    const candidates=Array.from(document.querySelectorAll('.app-shell-left-panel, #app-shell-sidebar, #ds-sidebar, #stage-slideover-sidebar, [data-testid="sidebar"], [data-testid="sidebar-navigation"]'));
    const native=candidates.find(el=>el.childElementCount>0);
    if(!native){if(pinnedMaster&&!pinnedMaster.isConnected)releaseMasterSidebar();return;}
    if(pinnedMaster!==native){pinnedMaster?.removeAttribute('data-cgww-master-sidebar');pinnedMaster=native;native.setAttribute('data-cgww-master-sidebar','true');}
    if(!masterStyle){masterStyle=document.createElement('style');masterStyle.id='cgww-master-pin';document.documentElement.appendChild(masterStyle);}
    const css=`[data-cgww-master-sidebar="true"]{display:block!important;visibility:visible!important;opacity:1!important;position:fixed!important;inset:0 auto 0 0!important;transform:none!important;translate:none!important;width:${sidebarWidth()}px!important;min-width:0!important;max-width:${sidebarWidth()}px!important;height:100dvh!important;max-height:100dvh!important;overflow:auto!important;z-index:2147483644!important;pointer-events:auto!important}`;
    if(masterStyle.textContent!==css)masterStyle.textContent=css;
  }

  function tryExpandNativeSidebar(userInitiated = false) {
    if (!state.enabled || !settings.sidebarVisible || !settings.keepMasterSidebar || measureNativeSidebar()) {pendingOpener=null;return true;}
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

  // Native action menus are commands, not history navigation. This also covers
  // links and retargeted events, before either history or new-chat interception.
  function isNativeActionMenuEvent(event) {
    const path=typeof event.composedPath==='function'?event.composedPath():[event.target];
    return path.some(node=>node?.matches?.(ACTION_MENU)||node?.closest?.(ACTION_MENU));
  }

  function clearNativeMenuMarks() {
    for(const [node,attrs] of nativeMenuMarks)for(const attr of attrs)node.removeAttribute(attr);
    nativeMenuMarks.clear();
  }

  function syncNativeMenus() {
    if(!state.enabled)return;
    const desired=new Map();
    const mark=(node,attr)=>{if(!node)return;let attrs=desired.get(node);if(!attrs)desired.set(node,attrs=new Set());attrs.add(attr);};
    const layer=node=>{
      mark(node,'data-cgww-native-menu-layer');
      if(nativeMenuMarks.get(node)?.has('data-cgww-native-menu-position')||getComputedStyle(node).position==='static')mark(node,'data-cgww-native-menu-position');
    };
    for(const menu of document.querySelectorAll('[role="menu"], [data-radix-menu-content]')) {
      if(menu.hidden||menu.getAttribute('data-state')==='closed'||!menu.getClientRects().length)continue;
      const css=getComputedStyle(menu);if(css.visibility==='hidden'||css.display==='none')continue;
      // Radix positions its portal wrapper, so elevate that stacking context too.
      // Do not raise arbitrary app roots or rewrite site inline styles.
      const wrapper=menu.closest('[data-radix-popper-content-wrapper]');
      layer(menu);if(wrapper)layer(wrapper);
      let sidebar=null;
      for(let node=menu.parentElement;node&&node!==document.body&&node!==document.documentElement;node=node.parentElement)if(node.matches(SIDE_NAV))sidebar=node;
      if(sidebar) {
        // A non-portaled submenu must escape the pinned sidebar's scroll clip.
        // Only its ancestor chain is relaxed, only while a menu is open.
        for(let node=menu.parentElement;node&&node!==document.body&&node!==document.documentElement;node=node.parentElement) {
          layer(node);mark(node,'data-cgww-native-menu-overflow');
          if(node===sidebar)break;
        }
      }
    }
    for(const [node,attrs] of nativeMenuMarks)for(const attr of attrs)if(!desired.get(node)?.has(attr))node.removeAttribute(attr);
    for(const [node,attrs] of desired)for(const attr of attrs)if(!nativeMenuMarks.get(node)?.has(attr))node.setAttribute(attr,'');
    nativeMenuMarks.clear();for(const [node,attrs] of desired)nativeMenuMarks.set(node,attrs);
  }

  function scheduleNativeMenus() {
    if(nativeMenuFrame!==null)return;
    nativeMenuFrame=requestAnimationFrame(()=>{nativeMenuFrame=null;syncNativeMenus();});
  }

  function startNativeMenuWatch() {
    if(nativeMenuObserver||typeof MutationObserver!=='function')return;
    nativeMenuStyle=document.createElement('style');nativeMenuStyle.id='cgww-native-menu-layers';
    nativeMenuStyle.textContent='[data-cgww-native-menu-layer][data-cgww-native-menu-layer]{z-index:2147483647!important}[data-cgww-native-menu-position]{position:relative!important}[data-cgww-native-menu-overflow][data-cgww-native-menu-overflow]{overflow:visible!important}';
    document.documentElement.appendChild(nativeMenuStyle);
    // Run in the mutation microtask: newly mounted submenus must be raised
    // before their first paint, not after a deferred animation frame.
    nativeMenuObserver=new MutationObserver(syncNativeMenus);
    nativeMenuObserver.observe(document.body,{subtree:true,childList:true,attributes:true,attributeFilter:['class','style','hidden','role','data-state','aria-expanded']});
    window.addEventListener('resize',scheduleNativeMenus);document.addEventListener('transitionend',scheduleNativeMenus,true);
    syncNativeMenus();
  }

  function stopNativeMenuWatch() {
    nativeMenuObserver?.disconnect();nativeMenuObserver=null;
    if(nativeMenuFrame!==null){cancelAnimationFrame(nativeMenuFrame);nativeMenuFrame=null;}
    window.removeEventListener('resize',scheduleNativeMenus);document.removeEventListener('transitionend',scheduleNativeMenus,true);
    clearNativeMenuMarks();nativeMenuStyle?.remove();nativeMenuStyle=null;
  }

  function updateFallbackDock() {
    if (!fallbackDock) return;
    const needsFallback = state.enabled && settings.sidebarVisible && settings.keepMasterSidebar && !measureNativeSidebar();
    fallbackDock.hidden = !needsFallback;
    if (!needsFallback || !fallbackList) return;
    const signature=JSON.stringify(state.panes.map(p=>[p.id,p.title,p.visible]));
    if(fallbackList.dataset.signature===signature)return;
    fallbackList.dataset.signature=signature;fallbackList.replaceChildren();
    const registered = state.panes.filter(p => p.url && p.visible);
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
    if(state.enabled&&!settings.sidebarVisible){pinMasterSidebar();updateGeometry();updateFallbackDock();return;}
    if(!state.enabled||!settings.keepMasterSidebar){releaseMasterSidebar();updateFallbackDock();return;}
    pinMasterSidebar();
    if(!measureNativeSidebar())tryExpandNativeSidebar();else pendingOpener=null;
    updateGeometry();updateFallbackDock();
  }

  function getPaneWidth(pane) {
    if(pane.folded)return 32;
    if (settings.equalizeColumns) {
      const visibleCount = state.panes.filter(p => p.visible&&!p.folded).length;
      const foldedWidth=state.panes.filter(p=>p.visible&&p.folded).length*40;
      return Core.calculateEqualWidth((scroller?.clientWidth||0)-foldedWidth, visibleCount, originalMaxWidth);
    }
    if(pane.autoWidth===true||(pane.autoWidth===undefined&&settings.nativePaneWidth&&(!pane.width||pane.width===620||pane.width===Core.DEFAULTS.paneWidth)))return contentWidthDetected?originalMaxWidth:Core.DEFAULTS.paneWidth;
    return Core.boundedNumber(pane.width, settings.paneWidth, 320, originalMaxWidth);
  }

  function applyColumnWidths() {
    if (!scroller) return;
    for (const pane of state.panes) {
      const entry = paneNodes.get(pane.id);
      if (entry) {
        entry.root.style.width = `${getPaneWidth(pane)}px`;
        entry.root.classList.toggle('folded',pane.folded===true);
        if(entry.restoreButton)entry.restoreButton.hidden=!pane.folded;
        if(entry.foldButton)entry.foldButton.setAttribute('aria-expanded',String(!pane.folded));
        if(entry.spine){entry.spine.setAttribute('aria-label',`${pane.title} を${pane.folded?'展開':'折りたたむ'}`);entry.spine.setAttribute('aria-expanded',String(!pane.folded));entry.spine.firstChild.textContent=pane.title;}
      }
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
    if(initializing||restoringWorkspace)return;
    try {
      if(!workspaceId)workspaceId=newId();
      const snapshot={savedAt:Date.now(),
        schemaVersion:2,workspaceId,settings,
        closedPanes: closedPanes.map(({url,title,width,newChat,autoWidth})=>({url,title,width,...(typeof autoWidth==='boolean'?{autoWidth}:{}),...(newChat?{newChat:true}:{})})),
        enabled: state.enabled,
        activeUrl: state.panes.find(p => p.id === state.activeId)?.url || null,
        activeIndex:state.panes.findIndex(p=>p.id===state.activeId), overlayPosition,
        panes: state.panes.map(p => ({ id:p.id, ...(p.folded?{folded:true}:{}), ...(typeof p.autoWidth==='boolean'?{autoWidth:p.autoWidth}:{}), ...(typeof p.draft==='string'?{draft:p.draft}:{}), ...(p.draftBackups?.length?{draftBackups:[...p.draftBackups]}:{}), url: p.url, title: p.title, width: p.width, visible: p.visible, ...(p.newChat ? {newChat:true} : {}) }))
      };
      try{sessionStorage.setItem(SESSION_KEY,JSON.stringify(snapshot));}
      catch{setStatus('このタブ内の保存に失敗しました。再起動用の保存は継続します。',true);}
      pendingSnapshot=snapshot;if(durableToken)void flushWorkspace();else{saveProblem=true;updateRecoveryUI();}return snapshot;
    } catch { setStatus('このタブの状態を保存できませんでした。', true); }
  }

  function durableRequest(message) {
    return new Promise((resolve,reject)=>{
      if(!chrome.runtime?.sendMessage){reject(Error('Storage unavailable'));return;}
      const timeout=typeof setTimeout==='function'?setTimeout(()=>reject(Error('Storage timeout')),10000):null;
      chrome.runtime.sendMessage({type:'CGWW_WORKSPACE',...message},result=>{
        if(timeout!==null)clearTimeout(timeout);
        if(chrome.runtime.lastError||!result?.ok)reject(Error('Storage unavailable'));else resolve(result);
      });
    });
  }

  function updateRecoveryUI() {
    if(saveBadge){saveBadge.hidden=!saveProblem&&!pendingSnapshot&&!saveInFlight;saveBadge.textContent=saveProblem?'未保存・再試行':'保存中…';saveBadge.disabled=saveInFlight;}
    if(undoButton)undoButton.hidden=!lastClosed||Date.now()>lastClosed.expires;
    if(restoreBadge)restoreBadge.hidden=!autoRestored;
  }

  function flushWorkspace() {
    if(savePromise)return savePromise;
    if(!durableToken){saveProblem=true;updateRecoveryUI();return Promise.resolve(false);}
    if(!pendingSnapshot){saveProblem=false;updateRecoveryUI();return Promise.resolve(true);}
    saveInFlight=true;updateRecoveryUI();
    savePromise=(async()=>{
      try{while(pendingSnapshot){const snapshot=pendingSnapshot;
        await durableRequest({action:'save',id:workspaceId,token:durableToken,sequence:++saveSequence,snapshot});
        if(pendingSnapshot===snapshot)pendingSnapshot=null;
      }saveProblem=false;return true;}
      catch{saveProblem=true;setStatus('未保存です。最新状態を保持しています。「未保存・再試行」で再試行できます。',true);return false;}
      finally{saveInFlight=false;savePromise=null;updateRecoveryUI();}
    })();return savePromise;
  }

  async function retryWorkspaceSave() {
    if(saveInFlight)return flushWorkspace();
    try{if(saveProblem||!durableToken){const claim=await durableRequest({action:'load',id:workspaceId});workspaceId=claim.id;durableToken=claim.token;}
      captureDrafts();return await flushWorkspace();
    }catch{saveProblem=true;updateRecoveryUI();return false;}
  }

  function mergeGroupPanes(snapshot) {
    const incoming=Core.restoreWorkspacePanes(snapshot.panes,newId),used=new Set(state.panes.map(p=>p.id)),plans=[];
    for(const saved of incoming){
      const key=Core.conversationKey(saved.url);
      const existing=key?findConversation(saved.url):state.panes.find(p=>p.id===saved.id&&(saved.newChat||(!Core.conversationKey(p.url)&&p.url===saved.url)));
      if(existing){plans.push({saved,pane:existing,existing:true});continue;}
      const pane={...saved};if(used.has(pane.id))pane.id=newId();used.add(pane.id);plans.push({saved,pane,existing:false});
    }
    if(state.panes.length+plans.filter(x=>!x.existing).length>200)throw Error('200列の上限です。現在のタブは変更していません。');
    for(const {saved,pane,existing} of plans){
      if(existing){
        // Never replace a live document or its current input with an older snapshot.
        const backups=[...(pane.draftBackups||[]),...(saved.draftBackups||[]),saved.draft].filter(x=>typeof x==='string'&&x&&x!==pane.draft);
        if(backups.length)pane.draftBackups=[...new Set(backups)];
        if(saved.visible){pane.visible=true;pane.folded=false;}
      }else state.panes.push(pane);
      renderPane(pane);
    }
    const selected=plans[Core.restoredActiveIndex(snapshot,incoming)]?.pane;
    if(selected)state.activeId=selected.id;
    syncPaneOrder();applyColumnWidths();markActive();syncOverlay();updateFallbackDock();safeSave();
    return plans;
  }

  async function restoreNamedGroup(id) {
    if(switching)return false;
    if(!confirm('現在のタブと入力を保持し、グループにある不足分だけ追加します。同じ会話は既存の列を利用します。続けますか？'))return false;
    switching=true;
    try{
      captureDrafts();if(!await flushWorkspace())return false;
      const {snapshot}=await durableRequest({action:'readGroup',id});if(!snapshot)throw Error('グループが見つかりません。');
      captureDrafts();if(!await flushWorkspace())return false;
      mergeGroupPanes(snapshot);
      if(!await flushWorkspace()){setStatus('タブは保持していますが復元後の保存を確認できません。未保存・再試行を使ってください。',true);return false;}
      setStatus('グループを復元しました。同じ会話は既存の列を利用しています。');return true;
    }catch(e){setStatus(e.message||'復元できませんでした。現在のタブを保持しています。',true);return false;}
    finally{switching=false;}
  }

  async function switchWorkspace(id=null,group=false) {
    if(group)return restoreNamedGroup(id);
    if(switching)return false;
    if(!confirm('現在の作業を保存して切り替えます。添付ファイル・生成中の処理は復元できません。キャンセルすると現在の作業を続けられます。'))return false;
    switching=true;
    try{
      captureDrafts();if(!await flushWorkspace())return false;
      const result=id?await durableRequest({action:group?'readGroup':'read',id}):{snapshot:{schemaVersion:2,workspaceId:newId(),enabled:true,settings,panes:[],closedPanes:[],savedAt:Date.now()}};
      if(!result.snapshot)throw Error('Missing workspace');
      // Capture edits made while the read/save was pending; no await after final save.
      captureDrafts();if(!await flushWorkspace())return false;
      restoringWorkspace=true;sessionStorage.setItem(SESSION_KEY,JSON.stringify(result.snapshot));location.reload();return true;
    }catch{restoringWorkspace=false;safeSave();setStatus('切替できませんでした。現在の作業を保持しています。',true);return false;}
    finally{switching=false;}
  }

  async function saveNamedGroup() {
    if(switching)return;
    const name=menuControls.groupName.value.trim();
    if(!name||name.normalize('NFKC').length>100){menuControls.groupStatus.textContent='グループ名を1〜100文字で入力してください。';menuControls.groupName.focus();return;}
    switching=true;menuControls.groupSave.disabled=true;
    try{
      const snapshot=captureDrafts();
      if(!snapshot||!await flushWorkspace())throw Error('Save failed');
      const result=await durableRequest({action:'saveGroup',id:workspaceId,token:durableToken,name,snapshot});
      menuControls.groupStatus.textContent=`「${result.name}」を保存しました。現在のタブはそのままです。`;
      await showSavedWorkspaces();
    }catch{menuControls.groupStatus.textContent='保存を確認できませんでした。現在のタブは保持しています。一覧を再表示して保存結果を確認してください。';}
    finally{switching=false;menuControls.groupSave.disabled=false;}
  }

  async function showSavedWorkspaces() {
    const list=menuControls.savedList;list.replaceChildren();
    try{const result=await durableRequest({action:'list'});
      for(const item of result.items.filter(item=>item.id!==workspaceId)){
        const restore=button(`${item.title} (${item.count}タブ)${item.group?'':'・以前の作業'} — ${new Date(item.savedAt).toLocaleString()}`,'保存済みタブグループを復元',async()=>{
          await switchWorkspace(item.id,item.group);
        });restore.style.whiteSpace='normal';list.appendChild(restore);
      }
      if(!list.children.length)list.appendChild(create('p','','保存済みタブグループはありません。'));
    }catch{list.appendChild(create('p','','保存済みタブグループを読み込めませんでした。'));}
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
      .overlay{position:fixed;z-index:2147483646;display:flex;flex-wrap:wrap;max-width:calc(100vw - 20px);align-items:center;gap:2px;padding:3px;border:1px solid #aebdcd;border-radius:7px;background:#f8fafc;color:#344b61;font:12px system-ui;pointer-events:auto}
      .overlay button{min-height:28px;max-width:100%;border:1px solid transparent;border-radius:4px;background:transparent;color:inherit;padding:0 7px;white-space:nowrap}
      .overlay button:hover{background:#e5edf5;border-color:#cad6e1}.overlay .overlay-grip{width:20px;padding:0;cursor:move;touch-action:none}
      .overlay-menu{position:fixed;z-index:2147483647;width:300px;max-width:calc(100vw - 16px);max-height:calc(100dvh - 16px);overflow:auto;border:1px solid #aebdcd;border-radius:8px;background:#fff;color:#243b51;padding:12px;font:12px/1.5 system-ui;pointer-events:auto}
      [hidden]{display:none!important}.overlay-menu h3{font-size:13px;margin:0}.overlay-menu .menu-heading{display:flex;align-items:center;justify-content:space-between;margin-bottom:9px}
      .sidebar-resize{position:fixed;top:0;bottom:0;width:7px;z-index:2147483647;cursor:col-resize;touch-action:none;pointer-events:auto;background:transparent}.sidebar-resize:hover{background:#4c91df66}.sidebar-resize[aria-disabled=true]{cursor:default;pointer-events:none}.overlay-menu .menu-row{display:flex;align-items:center;gap:6px;margin-top:9px}.overlay-menu label{flex:1}.parked-title{flex:1;min-width:0;overflow-wrap:anywhere}.overlay-menu input[type=text]{min-width:0;width:100%;flex:1}.overlay-menu h3{margin-top:12px}.overlay-menu button,.overlay-menu input,.overlay-menu select{font:inherit;color:inherit;min-height:30px;border:1px solid #c8d3df;border-radius:5px;background:#f8fafc;padding:4px 7px}.overlay-menu button:hover{background:#e5edf5}.overlay-menu input[type=number]{width:76px}.overlay-menu input[type=checkbox]{min-height:0;accent-color:#347ed5}.overlay-menu select{min-width:0;flex:1;max-width:205px}.overlay-menu :disabled{opacity:.5;cursor:default}.overlay-note{font-size:10px;color:#62748a;margin:8px 0 0}
      .board{position:fixed;inset:0 0 0 auto;z-index:2147483645;display:flex;flex-direction:column;background:#e9eef4;color:#1c3048;font:12px system-ui;pointer-events:auto}
      .board[hidden],.launcher[hidden],.dock[hidden],.pane[hidden],.hintbar[hidden]{display:none!important}
      .scroller{flex:1;min-height:0;display:flex;gap:7px;padding:9px;overflow-x:auto;overflow-y:hidden;background:#dfe6ef;scroll-snap-type:x proximity}
      .pane{position:relative;flex:none;min-width:320px;display:flex;flex-direction:column;height:100%;border:1px solid #aebdcd;border-radius:8px;overflow:hidden;background:#fff;scroll-snap-align:start}
      .tab-state{font-size:11px;color:#52657a;max-width:100px}.pane-restore{position:absolute;top:2px;left:2px;width:28px;height:28px;z-index:3;border:1px solid #9aafc5;border-radius:4px;background:#fff;color:#243b51;cursor:pointer}.pane-restore:focus-visible{outline:2px solid #347ed5}.pane-spine{position:absolute;left:0;top:0;bottom:0;width:8px;padding:0;border:0;background:#e5edf5;z-index:2;cursor:pointer}.pane-spine span{display:none}.pane-spine:focus-visible{outline:2px solid #347ed5;outline-offset:-2px}.pane:not(.folded){padding-left:8px}.pane.folded{min-width:32px;padding:0}.pane.folded .pane-head,.pane.folded .pane-main,.pane.folded .resize{display:none}.pane.folded .pane-spine{width:100%}.pane.folded .pane-spine span{display:block;position:absolute;left:50%;top:50%;width:calc(100vh - 160px);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;transform:translate(-50%,-50%) rotate(-90deg);font:13px system-ui;color:#243b51}.pane.active{outline:2px solid #347ed5;outline-offset:-2px}.pane.dragging{opacity:.65}.pane.drop-before::before,.pane.drop-after::after{content:"";position:absolute;top:32px;bottom:0;width:4px;background:#1684ed;z-index:3;pointer-events:none}.pane.drop-before::before{left:0}.pane.drop-after::after{right:0}
      .pane-head{height:32px;min-height:32px;box-sizing:border-box;display:flex;align-items:center;gap:3px;padding:3px 5px;border-bottom:1px solid #e0e6ed;background:#fff}
      .pane-control{flex:none;display:inline-flex;align-items:center;justify-content:center;gap:3px;height:24px;min-width:24px;padding:0 5px;border:1px solid transparent;border-radius:4px;background:transparent;color:#526579;font-size:12px;line-height:1;vertical-align:middle}
      .pane-control:hover{border-color:#d7e1eb;background:#edf2f7;color:#243b51}.pane-control:active{background:#dfe8f1}
      .drag-grip{width:24px;padding:0;cursor:grab;font-size:14px}.drag-grip:active{cursor:grabbing}
      .pane-close{width:24px;padding:0;font-size:20px;font-weight:400}.pane-close:hover{border-color:#e5c5c5;background:#fff0f0;color:#a33131}
      .pane-index{flex:none;font-size:10px;color:#497198;padding:2px}.pane-title{flex:1;min-width:45px;width:50px;height:24px;padding:2px 3px;border:1px solid transparent;border-radius:4px;font-size:12px;color:#243b51}.pane-title:focus{border-color:#8dabcb}
      .pane-status{font-size:10px;flex:none;color:#8192a3;cursor:help}.pane-status[data-state=loaded]{color:#3e8b6a}.pane-status[data-state=warning]{color:#b46825}
      .pane-main{position:relative;flex:1;min-height:0;background:#fff}iframe{display:block;width:100%;height:100%;border:0;background:#fff}.empty{padding:24px 15px;line-height:1.8;color:#62748a;text-align:center}
      .resize{position:absolute;right:0;top:32px;bottom:0;width:5px;cursor:ew-resize;background:transparent;z-index:1}.resize:hover{background:#4c91df88}
      .hintbar{position:absolute;bottom:10px;left:10px;right:10px;z-index:4;padding:7px 10px;border:1px solid #c4d3e2;border-radius:7px;background:#f8fbffff;pointer-events:none;font-size:11px;color:#45617d}.flash.warning{color:#a94f29}
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
    shadow.appendChild(panel);makeSidebarResize();makeOverlay();document.documentElement.appendChild(host);
    originalMaxWidth=readOriginalMaxWidth();
    if(Layout&&typeof MutationObserver==='function'){contentLayoutObserver=new MutationObserver(scheduleContentLayout);contentLayoutObserver.observe(document.documentElement,{childList:true,subtree:true,attributes:true,attributeFilter:['class','style']});}
    window.addEventListener('resize',scheduleContentLayout);
    document.addEventListener('load',event=>{if(event.target?.tagName==='LINK'&&/\bstylesheet\b/i.test(event.target.rel||''))scheduleContentLayout();},true);
    updateGeometry();applyColumnWidths();
    if(typeof ResizeObserver==='function'){geometryObserver=new ResizeObserver(()=>applyColumnWidths());geometryObserver.observe(scroller);}else window.addEventListener('resize',applyColumnWidths);
  }

  function closeOverlay(restoreFocus=true) {
    if(!overlayMenu||overlayMenu.hidden)return;
    overlayMenu.hidden=true;launcher.setAttribute('aria-expanded','false');if(restoreFocus)launcher.focus();
  }

  function placeOverlay() {
    if(!overlay)return;
    const w=overlay.offsetWidth||154,h=overlay.offsetHeight||36;
    const preferred=overlayPosition||{x:12,y:Math.round((window.innerHeight||700)*.46)};
    const x=Math.max(4,Math.min(preferred.x,Math.max(4,window.innerWidth-w-16))),y=Math.max(4,Math.min(preferred.y,Math.max(4,window.innerHeight-h-16)));
    overlay.style.left=x+'px';overlay.style.top=y+'px';
    if(overlayMenu&&!overlayMenu.hidden){const r=overlay.getBoundingClientRect(),mh=overlayMenu.offsetHeight,mw=overlayMenu.offsetWidth;overlayMenu.style.left=Math.max(8,Math.min(r.left,window.innerWidth-mw-16))+'px';overlayMenu.style.top=Math.max(8,Math.min(r.bottom+6+mh<window.innerHeight?r.bottom+6:r.top-mh-6,window.innerHeight-mh-8))+'px';}
  }

  function syncOverlay() {
    if(!viewToggle)return;
    viewToggle.textContent=state.enabled?'元画面':(state.panes.length?'分割へ':'分割を開始');
    viewToggle.title=state.enabled?'元のChatGPT画面を表示（列と下書きは保持）':'分割表示へ戻る';
    viewToggle.setAttribute('aria-label',state.enabled?'元の画面を表示':(state.panes.length?'分割表示に戻る':'分割表示を開始'));
    if(!menuControls)return;
    menuControls.add.disabled=false;menuControls.sidebarVisible.disabled=!state.enabled;menuControls.url.disabled=!state.enabled;menuControls.width.disabled=!state.enabled||settings.equalizeColumns;menuControls.apply.disabled=menuControls.width.disabled;
    menuControls.width.value=String(settings.nativePaneWidth?(contentWidthDetected?originalMaxWidth:Core.DEFAULTS.paneWidth):Math.min(settings.paneWidth,originalMaxWidth));menuControls.width.max=String(originalMaxWidth);menuControls.equal.checked=settings.equalizeColumns;menuControls.equal.disabled=!state.enabled;
    menuControls.sidebarVisible.textContent=settings.sidebarVisible?'左一覧を隠す':'左一覧を表示';menuControls.sidebarVisible.setAttribute('aria-pressed',String(settings.sidebarVisible));menuControls.sidebarVisible.setAttribute('aria-label',menuControls.sidebarVisible.textContent);
    menuControls.sidebar.value=String(settings.sidebarWidth);menuControls.sidebar.disabled=settings.sidebarLocked;menuControls.sidebarApply.disabled=settings.sidebarLocked;menuControls.sidebarReset.disabled=settings.sidebarLocked;
    menuControls.sidebarLock.textContent=settings.sidebarLocked?'ロック解除':'ロック';menuControls.sidebarLock.setAttribute('aria-pressed',String(settings.sidebarLocked));
    menuControls.parkedList.replaceChildren();
    const parked=state.panes;
    menuControls.parkedHeading.textContent=`タブ一覧 (${parked.length})`;
    for(const p of parked){
      const row=create('div','menu-row'),name=create('span','parked-title',p.title);
      const status=create('span','tab-state',`${!p.visible?'退避中':p.folded?'折りたたみ中':'表示中'}${p.id===state.activeId?'・選択中':''}${!state.enabled?'・分割表示休止中':''}`);
      const restore=button(!p.visible||p.folded?'復元':'選択',`${p.title} を${!p.visible||p.folded?'復元':'選択'}`,()=>{selectConversation(p);paneNodes.get(p.id)?.foldButton?.focus();});restore.disabled=!state.enabled;
      row.append(name,status,restore);
      if(p.visible&&!p.folded){const fold=button('_',`${p.title} を折りたたむ`,()=>setPaneFolded(p,true));fold.setAttribute('aria-label',`${p.title} を折りたたむ`);fold.disabled=!state.enabled;row.appendChild(fold);}menuControls.parkedList.appendChild(row);
    }
    if(!parked.length)menuControls.parkedList.appendChild(create('p','','タブはありません。'));
    if(menuControls.historyEntry)menuControls.historyEntry.textContent=`閉じた履歴 (${closedPanes.length})`;
    renderClosedHistory();
    placeOverlay();
  }

  function resetPaneWidths() {
    settings.nativePaneWidth=true;settings.paneWidth=Core.DEFAULTS.paneWidth;settings.equalizeColumns=false;
    for(const p of state.panes)p.autoWidth=true;
    refreshContentLayout();applyColumnWidths();savePrefs();safeSave();syncOverlay();
  }

  function toggleSidebar() {
    settings.sidebarVisible=!settings.sidebarVisible;ensureMasterSidebar();updateGeometry();savePrefs();safeSave();syncOverlay();
  }

  function setSidebarWidth(value,persist=true) {
    if(settings.sidebarLocked)return;
    settings.sidebarWidth=Core.boundedNumber(value,settings.sidebarWidth,180,520);
    updateGeometry();pinMasterSidebar();syncOverlay();
    if(persist){savePrefs();safeSave();}
  }

  function makeSidebarResize() {
    sidebarHandle=create('div','sidebar-resize');sidebarHandle.setAttribute('role','separator');sidebarHandle.setAttribute('aria-label','左一覧の幅');sidebarHandle.setAttribute('aria-orientation','vertical');sidebarHandle.tabIndex=0;
    let drag=null;
    sidebarHandle.addEventListener('pointerdown',e=>{if(e.button!==0||settings.sidebarLocked)return;e.preventDefault();drag={x:e.clientX,width:settings.sidebarWidth};sidebarHandle.setPointerCapture(e.pointerId);});
    sidebarHandle.addEventListener('pointermove',e=>{if(drag&&!settings.sidebarLocked)setSidebarWidth(drag.width+e.clientX-drag.x,false);});
    const end=()=>{if(!drag)return;drag=null;savePrefs();safeSave();};sidebarHandle.addEventListener('pointerup',end);sidebarHandle.addEventListener('pointercancel',end);
    sidebarHandle.addEventListener('keydown',e=>{if(settings.sidebarLocked||!['ArrowLeft','ArrowRight'].includes(e.key))return;e.preventDefault();setSidebarWidth(settings.sidebarWidth+(e.key==='ArrowRight'?10:-10));});
    shadow.appendChild(sidebarHandle);
  }

  function setPaneFolded(p,folded) {
    p.folded=Boolean(folded);state.activeId=p.id;applyColumnWidths();markActive();safeSave();syncOverlay();
    const entry=paneNodes.get(p.id);
    (p.folded?entry?.restoreButton:entry?.foldButton)?.focus();
  }

  function restoreParkedPane(p) {
    p.visible=true;state.activeId=p.id;renderPane(p);markActive();applyColumnWidths();safeSave();syncOverlay();
  }

  function attachDraftRecovery(frame) {
    if(!Drafts||frame._cgwwClosed)return;
    try{
      const doc=frame.contentDocument;
      if(!doc||frame.contentWindow.location.origin!==Core.ORIGIN)return;
      if(frame._cgwwDraftDocument!==doc){
        frame._cgwwDraftRecovery?.dispose();frame._cgwwDraftDocument=doc;
        frame._cgwwDraftRecovery=Drafts.connect(doc,frame._cgwwPane,()=>{safeSave();},text=>setStatus(text,true));
      }
      frame._cgwwDraftRecovery.attempt();
    }catch{/* Cross-origin/login composers remain untouched. */}
  }

  function captureDrafts() {
    for(const entry of paneNodes.values())entry.iframe?._cgwwDraftRecovery?.capture();
    return safeSave();
  }

  function renderClosedHistory() {
    if(!menuControls?.historyList)return;
    const query=menuControls.search.value.trim().toLocaleLowerCase();
    menuControls.historyList.replaceChildren();
    for(const p of closedPanes.filter(p=>(p.title+' '+p.url).toLocaleLowerCase().includes(query))){
      const item=button(p.title+' — '+p.url,'再読み込みで復元',()=>restoreClosedPane(p.id));
      item.disabled=!state.enabled;
      item.style.whiteSpace='normal';item.style.overflowWrap='anywhere';menuControls.historyList.appendChild(item);
    }
    if(!menuControls.historyList.children.length)menuControls.historyList.appendChild(create('p','','該当する履歴はありません。'));
  }

  function restoreClosedPane(id) {
    if(!state.enabled)return;
    const index=closedPanes.findIndex(p=>p.id===id);if(index<0)return;
    const existing=findConversation(closedPanes[index].url);
    if(existing){closedPanes.splice(index,1);selectConversation(existing);return;}
    if(state.panes.length>=200){setStatus('200列の上限です。不要な列を閉じてから復元してください。退避だけでは列数は減りません。',true);return;}
    const saved=closedPanes.splice(index,1)[0],p={...saved,id:newId(),visible:true};
    state.panes.push(p);state.activeId=p.id;renderPane(p);markActive();safeSave();syncOverlay();
  }

  function parkPane(p) {
    p.visible=false;const entry=paneNodes.get(p.id);if(entry)entry.root.hidden=true;
    state.activeId=state.panes.find(x=>x.visible)?.id||null;
    markActive();applyColumnWidths();safeSave();syncOverlay();updateFallbackDock();
    setStatus('退避しました。設定メニューの「退避中」から復元できます。');
  }

  const detaching=new Set();
  async function detachPane(p) {
    if(detaching.has(p.id))return;
    if(!Core.chatUrl(p.url)||p.newChat){setStatus('送信済みの会話を選んでください。新規会話と入力は元の列に保持します。',true);return;}
    if(!confirm('会話URLを新規ウィンドウで開き、元の列を退避します。下書き・添付・生成中の状態は元の列に残り、自動移行しません。続けますか？'))return;
    detaching.add(p.id);
    try{
      captureDrafts();if(!await flushWorkspace())return;
      await window.CGWWDetached.request({action:'detach',workspaceId,url:p.url,title:p.title});
      if(state.panes.includes(p))parkPane(p);
    }catch(e){setStatus(e.message||'新規ウィンドウを作成できませんでした。元の列を保持しています。',true);}
    finally{detaching.delete(p.id);}
  }

  function closePane(p) {
    const entry=paneNodes.get(p.id),frame=entry?.iframe;
    frame?._cgwwDraftRecovery?.capture();
    const undo={pane:{...p,draftBackups:p.draftBackups?[...p.draftBackups]:undefined},index:state.panes.indexOf(p),expires:Date.now()+30000};
    if(frame){
      frame._cgwwClosed=true;
      frame._cgwwFrameObserver?.disconnect();frame._cgwwFrameCleanup?.();frame._cgwwNavigationCleanup?.();frame._cgwwDraftRecovery?.dispose();
      frame.remove();
      for(const key of Object.keys(frame))if(key.startsWith('_cgww'))delete frame[key];
      frame._cgwwClosed=true;
      entry.iframe=null;
    }
    entry?.root.remove();paneNodes.delete(p.id);
    state.panes=state.panes.filter(x=>x.id!==p.id);
    if(p.url)closedPanes.unshift({id:newId(),url:p.url,title:p.title,width:p.width,...(typeof p.autoWidth==='boolean'?{autoWidth:p.autoWidth}:{}),...(p.newChat?{newChat:true}:{})});
    closedPanes=closedPanes.slice(0,200);
    undo.historyId=p.url?closedPanes[0]?.id:null;lastClosed=undo;
    if(typeof setTimeout==='function'){clearTimeout(undoTimer);undoTimer=setTimeout(()=>{lastClosed=null;updateRecoveryUI();},30000);}
    updateRecoveryUI();
    state.activeId=state.panes.find(x=>x.visible)?.id||null;
    syncPaneOrder();markActive();applyColumnWidths();safeSave();syncOverlay();updateFallbackDock();
    setStatus('列を閉じました。30秒以内は「閉じた列を元に戻す」でテキストを復元できます。添付・生成中状態は対象外です。');
  }

  function undoClose() {
    if(!lastClosed||Date.now()>lastClosed.expires)return;
    const undo=lastClosed,p=undo.pane,existing=findConversation(p.url);
    if(!existing&&state.panes.length>=200){setStatus('200列の上限です。列を閉じてから元に戻してください。',true);return;}
    if(existing){existing.draftBackups=[...new Set([...(existing.draftBackups||[]),...(p.draftBackups||[]),p.draft].filter(x=>x&&x!==existing.draft))];selectConversation(existing);}
    else{p.id=newId();p.visible=true;state.panes.splice(Math.max(0,undo.index),0,p);state.activeId=p.id;renderPane(p);syncPaneOrder();markActive();applyColumnWidths();}
    closedPanes=closedPanes.filter(x=>x.id!==undo.historyId);lastClosed=null;safeSave();syncOverlay();updateRecoveryUI();
  }

  function makeOverlay() {
    overlay=create('div','overlay');overlay.setAttribute('role','group');overlay.setAttribute('aria-label','Split View 操作');
    saveBadge=button('未保存・再試行','最新状態の保存を再試行',retryWorkspaceSave);saveBadge.setAttribute('aria-live','polite');
    undoButton=button('閉じた列を元に戻す','30秒以内のテキスト復元。添付・生成中状態は対象外',undoClose);
    restoreBadge=create('div','overlay-note');const restoredText=create('p','','前回の作業を復元しました。');restoredText.setAttribute('role','status');restoreBadge.append(restoredText,button('通知を閉じる','復元の通知だけを閉じる。作業はそのまま保持',()=>{autoRestored=false;updateRecoveryUI();menuControls.close.focus();}));
    const grip=button('⠿','操作ボタンをドラッグで移動。矢印キーでも移動できます。',()=>{},'overlay-grip');grip.setAttribute('aria-label','操作ボタンの位置を移動');overlay.appendChild(grip);
    launcher=button('▥ メニュー','Split View メニュー',()=>{const open=overlayMenu.hidden;overlayMenu.hidden=!open;launcher.setAttribute('aria-expanded',String(open));if(open){syncOverlay();menuControls.close.focus();}},'overlay-launcher');launcher.setAttribute('aria-label','Split View メニュー');launcher.setAttribute('aria-expanded','false');launcher.setAttribute('aria-controls','cgww-overlay-menu');overlay.appendChild(launcher);
    const add=button('＋ 新しいチャット','独立した新しいチャットを右端に追加',event=>{if(event.detail>1)return;if(!state.enabled)setEnabled(true,true);addNewChat();syncOverlay();},'overlay-add');overlay.appendChild(add);
    const sidebarVisible=button('左一覧を隠す','左一覧の表示切替',toggleSidebar,'overlay-sidebar');overlay.appendChild(sidebarVisible);
    viewToggle=button('分割を開始','分割表示を開始',()=>setEnabled(!state.enabled),'overlay-view');overlay.appendChild(viewToggle);overlay.append(saveBadge,undoButton);updateRecoveryUI();shadow.appendChild(overlay);
    overlayMenu=create('section','overlay-menu');overlayMenu.id='cgww-overlay-menu';overlayMenu.hidden=true;overlayMenu.setAttribute('role','dialog');overlayMenu.setAttribute('aria-label','Split View メニュー');
    const heading=create('div','menu-heading');heading.appendChild(create('h3','','Split View'));const close=button('×','メニューを閉じる',()=>closeOverlay());close.setAttribute('aria-label','メニューを閉じる');heading.appendChild(close);overlayMenu.appendChild(heading);
    const row=()=>{const e=create('div','menu-row');overlayMenu.appendChild(e);return e;};
    const url=button('URLから追加','会話URLを入力して追加',()=>{addFromPrompt();syncOverlay();});row().appendChild(url);
    const equalLabel=create('label','','列を等分 '),equal=create('input');equal.type='checkbox';equal.setAttribute('aria-label','列を等分');equal.addEventListener('change',()=>{setEqualize(equal.checked);syncOverlay();});equalLabel.appendChild(equal);row().appendChild(equalLabel);
    const widthRow=row(),widthLabel=create('label','','全列幅 (px)'),width=create('input');width.id='cgww-menu-width';width.type='number';width.min='320';width.max=String(originalMaxWidth);widthLabel.htmlFor=width.id;const apply=button('適用','全列の幅を変更',()=>{if(!width.checkValidity())return;settings.nativePaneWidth=false;settings.paneWidth=Core.boundedNumber(width.value,settings.paneWidth,320,originalMaxWidth);for(const p of state.panes){p.width=settings.paneWidth;p.autoWidth=false;}applyColumnWidths();savePrefs();safeSave();syncOverlay();});const widthReset=button('リセット','全列をChatGPT標準幅に戻す',resetPaneWidths);widthReset.setAttribute('aria-label','全列幅をリセット');widthRow.append(widthLabel,width,apply,widthReset);
    const sideRow=row(),sidebar=create('input');sidebar.type='number';sidebar.min='180';sidebar.max='520';sidebar.setAttribute('aria-label','左一覧幅 (px)');
    const sidebarApply=button('適用','左一覧幅を適用',()=>{if(sidebar.checkValidity())setSidebarWidth(sidebar.value);});
    const sidebarReset=button('リセット','左一覧幅をリセット',()=>setSidebarWidth(Core.DEFAULTS.sidebarWidth));sidebarReset.setAttribute('aria-label','左一覧幅をリセット');
    const sidebarLock=button('ロック','左一覧の幅変更をロック・解除',()=>{settings.sidebarLocked=!settings.sidebarLocked;updateGeometry();savePrefs();safeSave();syncOverlay();});sidebarLock.setAttribute('aria-label','左一覧幅のロック');
    sideRow.append(create('label','','左一覧幅 (px)'),sidebar,sidebarApply);row().append(sidebarReset,sidebarLock);
    const parkedHeading=create('h3','','タブ一覧 (0)'),parkedList=create('div');overlayMenu.append(parkedHeading,parkedList,restoreBadge,create('h3','','タブグループの保存と復元'));
    const historyEntry=button('閉じた履歴 (0)','このワークスペースで閉じた列を検索',()=>{historyPanel.hidden=!historyPanel.hidden;historyEntry.setAttribute('aria-expanded',String(!historyPanel.hidden));});historyEntry.setAttribute('aria-expanded','false');row().appendChild(historyEntry);
    const historyPanel=create('div'),search=create('input'),historyList=create('div');historyPanel.hidden=true;search.type='search';search.setAttribute('aria-label','閉じた履歴をタイトル・URLで検索');search.placeholder='タイトル・URLで検索';search.addEventListener('input',renderClosedHistory);historyPanel.append(create('p','','このワークスペースで閉じた列のみ。復元は再読み込みです。未送信入力は戻りません。'),search,historyList);overlayMenu.appendChild(historyPanel);
    overlayMenu.appendChild(create('p','overlay-note','現在のタブの組み合わせを名前付きで保存します。同名は連番で保存し、上書きしません。グループ復元は既存タブを保持し、不足分だけ追加します。以前の作業は保存して切り替えます。'));
    const groupName=create('input');groupName.type='text';groupName.maxLength=100;groupName.setAttribute('aria-label','タブグループ名');groupName.placeholder='タブグループ名';
    const groupSave=button('名前を付けて保存','現在のタブグループをコピーして保存',saveNamedGroup);row().append(groupName,groupSave);
    const groupStatus=create('p','overlay-note');groupStatus.setAttribute('role','status');overlayMenu.appendChild(groupStatus);
    row().appendChild(button('保存済みタブグループを表示','名前付きグループと以前の作業の一覧を表示',showSavedWorkspaces));const savedList=create('div');overlayMenu.appendChild(savedList);
    overlayMenu.appendChild(create('p','overlay-note','その他の設定では本文余白・既定の表示設定・設定JSONの入出力を変更できます。'));
    row().appendChild(button('その他の設定','拡張のオプション画面を開く',openOptions));
    shadow.appendChild(overlayMenu);menuControls={groupName,groupSave,groupStatus,savedList,close,add,url,width,apply,equal,sidebarVisible,sidebar,sidebarApply,sidebarReset,sidebarLock,parkedHeading,parkedList,historyEntry,historyPanel,search,historyList};
    let dragging=null;
    grip.addEventListener('pointerdown',e=>{if(e.button!==0)return;e.preventDefault();closeOverlay(false);const r=overlay.getBoundingClientRect();dragging={x:e.clientX,y:e.clientY,left:r.left,top:r.top};grip.setPointerCapture(e.pointerId);});
    grip.addEventListener('pointermove',e=>{if(!dragging)return;overlayPosition={x:dragging.left+e.clientX-dragging.x,y:dragging.top+e.clientY-dragging.y};placeOverlay();});
    const end=()=>{if(!dragging)return;dragging=null;const r=overlay.getBoundingClientRect();overlayPosition={x:r.left,y:r.top};safeSave();};grip.addEventListener('pointerup',end);grip.addEventListener('pointercancel',end);
    grip.addEventListener('keydown',e=>{const steps={ArrowLeft:[-16,0],ArrowRight:[16,0],ArrowUp:[0,-16],ArrowDown:[0,16]},d=steps[e.key];if(!d)return;e.preventDefault();const r=overlay.getBoundingClientRect();overlayPosition={x:r.left+d[0],y:r.top+d[1]};placeOverlay();safeSave();});
    document.addEventListener('pointerdown',e=>{const path=e.composedPath();if(!path.includes(overlay)&&!path.includes(overlayMenu))closeOverlay(false);},true);
    shadow.addEventListener('keydown',e=>{if(e.key==='Escape'&&!overlayMenu.hidden){e.preventDefault();closeOverlay();}});
    window.addEventListener('resize',placeOverlay);syncOverlay();
  }

  function openOptions() {
    if(!chrome.runtime?.sendMessage){setStatus('オプションは拡張環境で開いてください。',true);return;}
    chrome.runtime.sendMessage({type:'CGWW_OPEN_OPTIONS'},result=>{if(chrome.runtime.lastError||!result?.ok)setStatus('オプションを開けませんでした。',true);});
  }

  function applyPreferences(raw) {
    const previous=settings;settings=Core.normalizeSettings(raw);
    if(previous.paneWidth!==settings.paneWidth||previous.nativePaneWidth!==settings.nativePaneWidth)for(const p of state.panes){p.width=settings.paneWidth;p.autoWidth=settings.nativePaneWidth;}
    if(previous.hideFrameSidebar!==settings.hideFrameSidebar)paneNodes.forEach(entry=>{if(entry.iframe)applyIframeSidebarRule(entry.iframe);});
    scheduleContentLayout();updateGeometry();ensureMasterSidebar();syncOverlay();safeSave();
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
    if(sidebarHandle){sidebarHandle.hidden=!state.enabled||!settings.sidebarVisible;sidebarHandle.style.left=`${sidebarWidth()-3}px`;sidebarHandle.setAttribute('aria-disabled',String(settings.sidebarLocked));sidebarHandle.setAttribute('aria-valuenow',String(settings.sidebarWidth));sidebarHandle.setAttribute('aria-valuemin','180');sidebarHandle.setAttribute('aria-valuemax','520');}
    if (fallbackDock) fallbackDock.style.width = `${sidebarWidth()}px`;
    applyColumnWidths();
  }

  function setEnabled(enabled, restoring=false) {
    state.enabled = Boolean(enabled);
    panel.hidden = !state.enabled;
    updateGeometry();
    closeOverlay(false);
    if (state.enabled && state.panes.length === 0 && !restoring) {
      const url = Core.chatUrl(location.href);
      if (url) addPane(url, '現在のチャット');
      else addNewChat();
    }
    if (state.enabled) {
      for (const p of state.panes) if (p.visible) renderPane(p);
      startMasterWatch();ensureMasterSidebar();startNativeMenuWatch();
    } else {stopNativeMenuWatch();stopMasterWatch();updateFallbackDock();}
    applyColumnWidths(); syncOverlay(); safeSave();
  }

  function addNewChat() {
    if(state.panes.length>=200){setStatus('動作保護のため200列が上限です。',true);return false;}
    if(state.panes.filter(p=>p.visible).length>=8&&!confirm('9列以上になります。新しいチャット列を追加しますか？'))return false;
    const p={id:newId(),url:Core.ORIGIN+'/',newChat:true,title:'新しいチャット',width:settings.paneWidth,autoWidth:settings.nativePaneWidth,visible:true};
    // Never deduplicate root URLs: each blank chat owns an independent document.
    state.panes.push(p);state.activeId=p.id;renderPane(p);markActive();applyColumnWidths();safeSave();
    scroller.scrollLeft=scroller.scrollWidth;setStatus('新しいチャットを右端に追加しました。');return true;
  }

  function syncNewChatLocation(frame) {
    const p=frame._cgwwPane;
    if(!p?.newChat)return;
    try{const url=Core.chatUrl(frame.contentWindow.location.href);if(url){p.url=url;delete p.newChat;safeSave();}}catch{/* Same-origin only. */}
  }

  function newChatControl(event) {
    const target=event.target,ElementClass=target?.ownerDocument?.defaultView?.Element||Element;
    if(!(target instanceof ElementClass))return null;
    const control=target.closest('a[href],button,[role="button"]');
    if(!control||control.disabled||control.getAttribute?.('aria-disabled')==='true'||control.hasAttribute?.('download'))return null;
    const label=(control.getAttribute?.('aria-label')||control.getAttribute?.('title')||control.textContent||'').trim();
    const known=control.getAttribute?.('data-octane-navigation-item')==='new_chat'||['create-new-chat-button','new-chat-button'].includes(control.getAttribute?.('data-testid'));
    if(!known&&!/^(?:New chat|新しいチャット|新規チャット)$/i.test(label))return null;
    if(control.tagName==='A'&&!Core.newChatUrl(control.href))return null;
    // A no-href project/GPT command has context we cannot reconstruct safely.
    const path=target.ownerDocument?.defaultView?.location?.pathname||location.pathname;
    if(control.tagName!=='A'&&/^\/(?:g|project)\//.test(path))return null;
    return control;
  }

  function handleNewChatClick(event) {
    if(isNativeActionMenuEvent(event))return false;
    if(!state.enabled||!settings.interceptSidebar||event.button!==0||event.defaultPrevented||event.ctrlKey||event.metaKey||event.altKey||event.shiftKey)return false;
    if(!newChatControl(event))return false;
    event.preventDefault();event.stopImmediatePropagation();if(event.detail>1)return true;addNewChat();return true;
  }

  function emptyPane() {
    return { id: newId(), url: null, title: '未設定の列', width: settings.paneWidth, autoWidth:settings.nativePaneWidth, visible: true };
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

  function findConversation(url) {
    const key=Core.conversationKey(url);if(!key)return null;
    // A draft may already have acquired its conversation URL before its observer ran.
    for(const p of state.panes){
      const frame=paneNodes.get(p.id)?.iframe;
      try{const current=Core.chatUrl(frame?.contentWindow.location.href);if(current){p.url=current;delete p.newChat;}}catch{/* Same-origin only. */}
      if(Core.conversationKey(p.url)===key)return p;
    }
    return null;
  }

  function selectConversation(p) {
    p.visible=true;p.folded=false;state.activeId=p.id;
    renderPane(p);markActive();applyColumnWidths();safeSave();syncOverlay();updateFallbackDock();
    paneNodes.get(p.id)?.root.scrollIntoView?.({block:'nearest',inline:'nearest'});
  }

  function addPane(rawUrl, title, forceNew = false) {
    const url = Core.chatUrl(rawUrl);
    if (!url) { setStatus('ChatGPTの会話URL（/c/...）を指定してください。', true); return; }
    const exists = findConversation(url);
    if (exists) { selectConversation(exists); return; }
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
    const p = { id: newId(), url, title: Core.normalizeTitle(title), width: settings.paneWidth, autoWidth:settings.nativePaneWidth, visible: true };
    state.panes.push(p);
    state.activeId = p.id;
    renderPane(p); markActive(); safeSave();
    applyColumnWidths(); updateFallbackDock();
    scroller.scrollLeft = scroller.scrollWidth;
  }

  function assignToActive(url, title, forceNew = false) {
    const existing=findConversation(url);if(existing){selectConversation(existing);return;}
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
    if(isNativeActionMenuEvent(event))return;
    if(handleNewChatClick(event))return;
    if (!state.enabled || !settings.interceptSidebar || event.button !== 0 || event.defaultPrevented) return;
    if (event.ctrlKey || event.metaKey || event.altKey) return;
    const anchor = historyAnchor(event);
    if (!anchor || anchor.hasAttribute?.('download') || !isSidebarLink(anchor, event.clientX)) return;
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
      frame._cgwwNavigationCleanup?.();
      const onClick = event => {
        if(isNativeActionMenuEvent(event))return;
        closeOverlay(false);
        if(handleNewChatClick(event))return;
        if (!state.enabled || !settings.interceptSidebar || event.button !== 0 || event.defaultPrevented) return;
        if (event.ctrlKey || event.metaKey || event.altKey) return;
        const anchor = historyAnchor(event);
        if (!anchor || anchor.hasAttribute?.('download')) return;
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
      };
      doc.addEventListener('click',onClick,true);
      frame._cgwwNavigationCleanup=()=>doc.removeEventListener('click',onClick,true);
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
          syncNewChatLocation(frame);attachDraftRecovery(frame);scheduleContentLayout();
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
          scheduleContentLayout();
          // Offscreen iframe animation frames may be deferred. Inspect the now-loaded
          // stylesheet immediately, then once more after layout for visible frames.
          if(settings.hideFrameSidebar)tagEmbeddedNavigation(frame);
          frame.contentWindow.requestAnimationFrame(()=>{if(!frame._cgwwClosed&&settings.hideFrameSidebar)tagEmbeddedNavigation(frame);});
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
    const frame = create('iframe');frame._cgwwPane=p;
    frame.setAttribute('data-cgww-frame', 'true');
    frame.src = p.url;
    frame.title = `ChatGPT: ${p.title}`;
    // Respect all server-provided iframe and authentication restrictions.
    frame.addEventListener('load', () => {
      if(frame._cgwwClosed)return;
      try {
        const doc = frame.contentDocument;
        if (doc && frame.contentWindow.location.origin === Core.ORIGIN && doc.body?.children.length) {
          syncNewChatLocation(frame);applyIframeSidebarRule(frame);attachDraftRecovery(frame);scheduleContentLayout();
          attachEmbeddedNavigation(frame, p);
          setTimeout(ensureMasterSidebar, 250);
          const displayedUrl = frame.contentWindow.location.href;
          const valid=Core.chatUrl(displayedUrl)||(p.newChat&&Core.newChatUrl(displayedUrl));
          setPaneStatus(foot,valid?'読込済：会話内の履歴リンクもワークスペースへ割当':'読込先が会話以外です。通常のChatGPT画面で認証や対応形式を確認',valid?'loaded':'warning');
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
      applyColumnWidths();return;
    }
    const root = create('article', 'pane');
    root.style.width = `${getPaneWidth(p)}px`;
    root.hidden = !p.visible;
    const spine=button('','列を折りたたむ / 展開',()=>setPaneFolded(p,!p.folded),'pane-spine');
    spine.appendChild(create('span','',p.title));root.appendChild(spine);
    const restoreButton=button('□','この列を元の幅に復元',()=>setPaneFolded(p,false),'pane-restore');restoreButton.setAttribute('aria-label','この列を復元');root.appendChild(restoreButton);
    const head = create('div', 'pane-head');
    const grip=button('⠿','列をドラッグで移動',()=>{state.activeId=p.id;markActive();},'pane-control drag-grip');head.appendChild(grip);
    const index = create('span', 'pane-index', String(state.panes.indexOf(p) + 1));
    head.appendChild(index);
    const title = create('input', 'pane-title');
    title.type = 'text'; title.maxLength = 100; title.value = p.title; title.title = '表示名を編集'; title.setAttribute('aria-label', '列の表示名');
    title.addEventListener('change', () => { p.title = Core.normalizeTitle(title.value); title.value = p.title; applyColumnWidths();safeSave();syncOverlay(); });
    title.addEventListener('focus', () => { state.activeId = p.id; markActive(); });
    head.appendChild(title);
    const foot=create('span','pane-status');setPaneStatus(foot,'会話URL未指定');head.appendChild(foot);
    const reloadButton=button('↻ 更新','この列だけを再読み込み。端末間の同期は保証しません。',()=>reloadPane(p),'pane-control pane-reload');reloadButton.setAttribute('aria-label','この列を更新');head.appendChild(reloadButton);
    const detachButton=button('↗','会話を新規ウィンドウで開く。元の列は退避して保持',()=>detachPane(p),'pane-control pane-detach');detachButton.setAttribute('aria-label','新規ウィンドウ');head.appendChild(detachButton);
    const foldButton=button('_','この列を折りたたむ（ページと入力を保持）',()=>setPaneFolded(p,true),'pane-control pane-fold');foldButton.setAttribute('aria-label','この列を折りたたむ');head.appendChild(foldButton);
    const parkButton=button('退避','この列を一時退避（iframeを保持）',()=>parkPane(p),'pane-control pane-park');parkButton.setAttribute('aria-label','この列を退避');head.appendChild(parkButton);
    const closeButton=button('×','この列を閉じてページを破棄',()=>closePane(p),'pane-control pane-close');closeButton.setAttribute('aria-label','この列を閉じる');head.appendChild(closeButton);
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
        p.autoWidth=false;
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
    paneNodes.set(p.id, { root, iframe, title, main, foot, index, grip, spine, foldButton, restoreButton });
    attachPaneDrag(root,grip,p);syncPaneOrder();applyColumnWidths();
  }

  function reloadPane(pane) {
    const entry=paneNodes.get(pane.id);if(!entry?.iframe)return;
    // Confirm attachment/streaming limits; save only supported composer text.
    if(!confirm('この列を更新します。未送信テキストは保存して復元します。添付ファイル・生成中の状態は復元できない場合があります。続けますか？'))return;
    entry.iframe._cgwwDraftRecovery?.capture();safeSave();
    setPaneStatus(entry.foot,'この列を再読み込み中');
    try{entry.iframe.contentWindow.location.reload();}catch{entry.iframe.src=pane.url;}
  }

  function actionState() {
    return {ok:true,enabled:state.enabled,equalizeColumns:settings.equalizeColumns,paneWidth:settings.paneWidth,maxWidth:originalMaxWidth,contentWidthDetected,visibleCount:state.panes.filter(p=>p.visible).length,totalCount:state.panes.length,hiddenPanes:state.panes.filter(p=>!p.visible).map(p=>({id:p.id,title:p.title}))};
  }

  function handleAction(message,sender,reply) {
    if(message?.type!=='CGWW_ACTION')return;
    if(sender?.id!==chrome.runtime.id||sender?.url!==chrome.runtime.getURL('popup.html')||sender?.tab){reply({ok:false,error:'許可されていない操作元です。'});return;}
    try{
      switch(message.action){
        case 'status':break;
        case 'enable':setEnabled(true);break;
        case 'disable':setEnabled(false);break;
        case 'add':if(!state.enabled)throw Error('横並びを開始してください。');addNewChat();break;
        case 'width':settings.nativePaneWidth=false;settings.paneWidth=Core.boundedNumber(message.value,settings.paneWidth,320,originalMaxWidth);for(const p of state.panes){p.width=settings.paneWidth;p.autoWidth=settings.nativePaneWidth;}applyColumnWidths();savePrefs();safeSave();break;
        case 'equal':setEqualize(message.value===true);break;
        case 'addUrl':if(!state.enabled)throw Error('横並びを開始してください。');if(!Core.chatUrl(message.url))throw Error('有効なChatGPT会話URLを指定してください。');assignToActive(message.url,'追加したチャット');break;
        case 'restore':{const p=state.panes.find(p=>p.id===message.paneId&&!p.visible);if(!p)throw Error('復帰する列が見つかりません。');p.visible=true;state.activeId=p.id;renderPane(p);markActive();applyColumnWidths();safeSave();break;}
        default:throw Error('未対応の操作です。');
      }
      syncOverlay();reply(actionState());
    }catch(error){reply({ok:false,error:error.message||'操作に失敗しました。'});}
  }

  function markActive() {
    paneNodes.forEach((entry, id) => entry.root.classList.toggle('active', id === state.activeId));
    updateFallbackDock(); syncOverlay(); safeSave();
  }

  async function initialize() {
    if(initializing||initialized)return;initializing=true;
    const detached=await window.CGWWDetached?.boot;
    if(detached?.detached||detached?.blocked){initializing=false;return;}
    let loadError=false;
    try {
      const obj = await chrome.storage.local.get(PREF_KEY);
      settings = Core.normalizeSettings(obj?.[PREF_KEY]);
    } catch { /* keep safe defaults */ }
    try {
      let stored=null;
      try{const raw=sessionStorage.getItem(SESSION_KEY);if(raw)stored=JSON.parse(raw);}catch{/* Keep durable recovery available when session JSON is corrupt. */}
      try{
        if(detached?.workspaceId)stored=null;
        const loaded=await durableRequest({action:'load',id:detached?.workspaceId||stored?.workspaceId});
        autoRestored=!stored&&!!loaded.snapshot;
        workspaceId=loaded.id;durableToken=loaded.token;
        if(loaded.snapshot&&(!stored||loaded.snapshot.savedAt>=(stored.savedAt||0)))stored=loaded.snapshot;
        if(stored)stored={...stored,workspaceId:loaded.id};
      }catch{loadError=true;}
      if (stored) {
        workspaceId=typeof stored.workspaceId==='string'?stored.workspaceId:newId();
        if(stored.schemaVersion===2&&stored.settings)settings=Core.normalizeSettings(stored.settings);
        closedPanes = Core.normalizeSessionPanes(stored?.closedPanes).filter(p=>p.url).map(p=>({...p,id:newId()}));
        state.enabled = stored?.enabled === true;
        state.panes = Core.restoreWorkspacePanes(stored?.panes,newId);
        state.activeId = state.panes[Core.restoredActiveIndex(stored,state.panes)]?.id || null;
        if(Number.isFinite(stored?.overlayPosition?.x)&&Number.isFinite(stored?.overlayPosition?.y))overlayPosition={x:stored.overlayPosition.x,y:stored.overlayPosition.y};
      }
    } catch { /* corrupted session data: keep empty state, do not remove existing storage */ }
    makeUI();
    for (const p of state.panes) renderPane(p);
    applyColumnWidths(); markActive();
    if (state.enabled) setEnabled(true,true);
    initializing=false;initialized=true;
    if(state.panes.length||closedPanes.length)safeSave();
    if(loadError)setStatus('ブラウザ再起動用の保存を開始できませんでした。このタブ内の復元のみ利用できます。',true);
    // Register only a capture listener. Disabled state leaves all ChatGPT links untouched.
    window.addEventListener('pagehide',captureDrafts);
    window.addEventListener('beforeunload',captureDrafts);
    window.addEventListener('click', handleHistoryClick, true);
    chrome.runtime?.onMessage?.addListener(handleAction);
    chrome.runtime?.onMessage?.addListener((m,s,reply)=>{
      if(m?.type!=='CGWW_INTEGRATE')return;
      if(s.id!==chrome.runtime.id||s.tab||m.workspaceId!==workspaceId||!Core.chatUrl(m.url)){reply({ok:false});return;}
      (async()=>{
        try{
          const existing=findConversation(m.url);
          if(!existing&&state.panes.length>=200)throw Error('200列が上限です。不要な列を閉じてから再試行してください。');
          setEnabled(true);if(existing)selectConversation(existing);else addPane(m.url,m.title,true);
          if(!findConversation(m.url))throw Error('統合をキャンセルしました。');
          captureDrafts();if(!await flushWorkspace())throw Error('元画面の保存に失敗しました。再試行してください。');
          reply({ok:true});
        }catch(e){reply({ok:false,error:e.message});}
      })();return true;
    });
    chrome.storage?.onChanged?.addListener((changes,area)=>{if(area==='local'&&changes[PREF_KEY])applyPreferences(changes[PREF_KEY].newValue);});
  }

  void initialize();
})();
