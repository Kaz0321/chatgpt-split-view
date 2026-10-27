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
  const SESSION_KEY = 'cgww.v1.workspace';
  const PREF_KEY = 'cgww.v1.preferences';
  let settings = Core.normalizeSettings();
  let state = { enabled: false, panes: [], activeId: null };
  const paneNodes = new Map();
  let host, shadow, panel, launcher, scroller, flashNode, infoButton;
  let draggedPaneId=null, statusTimer=null;
  let overlay, overlayMenu, viewToggle, menuControls, overlayPosition=null;
  let fallbackDock, fallbackList, equalButton, maxWidthNote, nativeSidebarCheck;
  let geometryObserver = null;
  let masterObserver=null,masterFrame=null,masterStyle=null,pinnedMaster=null,pendingOpener=null;
  let nativeMenuObserver=null,nativeMenuFrame=null,nativeMenuStyle=null;
  const nativeMenuMarks=new Map();
  const ACTION_MENU='[role="menu"], [role="menuitem"], [role="menuitemcheckbox"], [role="menuitemradio"], [data-radix-menu-content], [aria-haspopup="menu"], [aria-haspopup="true"]';
  let originalMaxWidth = 1400; // outer pane cap, not the text/content cap
  let contentWidthDetected=false,contentLayoutTimer=null,contentLayoutObserver=null;
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
    if(!Layout)return 1400;
    const measurement=Layout.inspect(document,{compact:true});
    contentWidthDetected=measurement.detected;
    return measurement.outerMax;
  }

  function refreshContentLayout() {
    contentLayoutTimer=null;
    if(!Layout)return;
    const native=Layout.inspect(document,{compact:true});
    const caps=native.detected?[native.outerMax]:[];let unknownFrame=false;
    for(const entry of paneNodes.values()){
      const frame=entry.iframe;
      try{
        if(!frame?.contentDocument||frame.contentWindow.location.origin!==Core.ORIGIN)continue;
        const doc=frame.contentDocument;
        if(frame._cgwwContentDocument!==doc){frame._cgwwContentDocument=doc;frame._cgwwScrollbarAllowance=0;}
        const measurement=Layout.inspect(doc,{compact:true,scrollbarAllowance:frame._cgwwScrollbarAllowance||0});
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
        activeIndex:state.panes.findIndex(p=>p.id===state.activeId), overlayPosition,
        panes: state.panes.map(p => ({ url: p.url, title: p.title, width: p.width, visible: p.visible, ...(p.newChat ? {newChat:true} : {}) }))
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
      .overlay{position:fixed;z-index:2147483646;display:flex;align-items:center;gap:2px;padding:3px;border:1px solid #aebdcd;border-radius:7px;background:#f8fafc;color:#344b61;font:12px system-ui;pointer-events:auto}
      .overlay button{height:28px;border:1px solid transparent;border-radius:4px;background:transparent;color:inherit;padding:0 7px;white-space:nowrap}
      .overlay button:hover{background:#e5edf5;border-color:#cad6e1}.overlay .overlay-grip{width:20px;padding:0;cursor:move;touch-action:none}
      .overlay-menu{position:fixed;z-index:2147483647;width:300px;max-width:calc(100vw - 16px);max-height:calc(100dvh - 16px);overflow:auto;border:1px solid #aebdcd;border-radius:8px;background:#fff;color:#243b51;padding:12px;font:12px/1.5 system-ui;pointer-events:auto}
      .overlay-menu[hidden]{display:none!important}.overlay-menu h3{font-size:13px;margin:0}.overlay-menu .menu-heading{display:flex;align-items:center;justify-content:space-between;margin-bottom:9px}
      .overlay-menu .menu-row{display:flex;align-items:center;gap:6px;margin-top:9px}.overlay-menu label{flex:1}.overlay-menu button,.overlay-menu input,.overlay-menu select{font:inherit;color:inherit;min-height:30px;border:1px solid #c8d3df;border-radius:5px;background:#f8fafc;padding:4px 7px}.overlay-menu button:hover{background:#e5edf5}.overlay-menu input[type=number]{width:76px}.overlay-menu input[type=checkbox]{min-height:0;accent-color:#347ed5}.overlay-menu select{min-width:0;flex:1;max-width:205px}.overlay-menu :disabled{opacity:.5;cursor:default}.overlay-note{font-size:10px;color:#62748a;margin:8px 0 0}
      .board{position:fixed;inset:0 0 0 auto;z-index:2147483645;display:flex;flex-direction:column;background:#e9eef4;color:#1c3048;font:12px system-ui;pointer-events:auto}
      .board[hidden],.launcher[hidden],.dock[hidden],.pane[hidden],.hintbar[hidden]{display:none!important}
      .scroller{flex:1;min-height:0;display:flex;gap:7px;padding:9px;overflow-x:auto;overflow-y:hidden;background:#dfe6ef;scroll-snap-type:x proximity}
      .pane{position:relative;flex:none;min-width:320px;display:flex;flex-direction:column;height:100%;border:1px solid #aebdcd;border-radius:8px;overflow:hidden;background:#fff;scroll-snap-align:start}
      .pane.active{outline:2px solid #347ed5;outline-offset:-2px}.pane.dragging{opacity:.65}.pane.drop-before::before,.pane.drop-after::after{content:"";position:absolute;top:32px;bottom:0;width:4px;background:#1684ed;z-index:3;pointer-events:none}.pane.drop-before::before{left:0}.pane.drop-after::after{right:0}
      .pane-head{height:32px;min-height:32px;display:flex;align-items:center;gap:3px;padding:3px 5px;border-bottom:1px solid #e0e6ed;background:#fff}
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
    shadow.appendChild(panel);makeOverlay();document.documentElement.appendChild(host);
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
    menuControls.add.disabled=!state.enabled;menuControls.url.disabled=!state.enabled;menuControls.width.disabled=!state.enabled||settings.equalizeColumns;menuControls.apply.disabled=menuControls.width.disabled;
    menuControls.width.value=String(Math.min(settings.paneWidth,originalMaxWidth));menuControls.width.max=String(originalMaxWidth);menuControls.equal.checked=settings.equalizeColumns;menuControls.equal.disabled=!state.enabled;
    if(menuControls.widthHelp)menuControls.widthHelp.textContent=contentWidthDetected?'広い列は元の本文上限、狭い列は折り返します。':'本文上限が未検出の会話では余白を変更しません。列幅は手動調整できます。';
    const chosen=menuControls.hidden.value;menuControls.hidden.replaceChildren();
    for(const p of state.panes.filter(p=>!p.visible)){const option=create('option','',p.title);option.value=p.id;menuControls.hidden.appendChild(option);}
    if(state.panes.some(p=>!p.visible&&p.id===chosen))menuControls.hidden.value=chosen;
    menuControls.hidden.disabled=!state.enabled||!menuControls.hidden.children.length;menuControls.restore.disabled=menuControls.hidden.disabled;
    placeOverlay();
  }

  function makeOverlay() {
    overlay=create('div','overlay');overlay.setAttribute('role','group');overlay.setAttribute('aria-label','Split View 操作');
    const grip=button('⠿','操作ボタンをドラッグで移動。矢印キーでも移動できます。',()=>{},'overlay-grip');grip.setAttribute('aria-label','操作ボタンの位置を移動');overlay.appendChild(grip);
    launcher=button('▥ メニュー','Split View メニュー',()=>{const open=overlayMenu.hidden;overlayMenu.hidden=!open;launcher.setAttribute('aria-expanded',String(open));if(open){syncOverlay();menuControls.close.focus();}},'overlay-launcher');launcher.setAttribute('aria-label','Split View メニュー');launcher.setAttribute('aria-expanded','false');launcher.setAttribute('aria-controls','cgww-overlay-menu');overlay.appendChild(launcher);
    viewToggle=button('分割を開始','分割表示を開始',()=>setEnabled(!state.enabled),'overlay-view');overlay.appendChild(viewToggle);shadow.appendChild(overlay);
    overlayMenu=create('section','overlay-menu');overlayMenu.id='cgww-overlay-menu';overlayMenu.hidden=true;overlayMenu.setAttribute('role','dialog');overlayMenu.setAttribute('aria-label','Split View メニュー');
    const heading=create('div','menu-heading');heading.appendChild(create('h3','','Split View'));const close=button('×','メニューを閉じる',()=>closeOverlay());close.setAttribute('aria-label','メニューを閉じる');heading.appendChild(close);overlayMenu.appendChild(heading);
    const row=()=>{const e=create('div','menu-row');overlayMenu.appendChild(e);return e;};
    const add=button('＋ 新しいチャット','独立した新しいチャットを右端に追加',()=>{addNewChat();syncOverlay();}),url=button('URLから追加','会話URLを入力して追加',()=>{addFromPrompt();syncOverlay();});row().append(add,url);
    const equalLabel=create('label','','列を等分 '),equal=create('input');equal.type='checkbox';equal.setAttribute('aria-label','列を等分');equal.addEventListener('change',()=>{setEqualize(equal.checked);syncOverlay();});equalLabel.appendChild(equal);row().appendChild(equalLabel);
    const widthRow=row(),widthLabel=create('label','','列幅 (px)'),width=create('input');width.id='cgww-menu-width';width.type='number';width.min='320';width.max=String(originalMaxWidth);widthLabel.htmlFor=width.id;const apply=button('適用','全列の幅を変更',()=>{if(!width.checkValidity())return;settings.paneWidth=Core.boundedNumber(width.value,settings.paneWidth,320,originalMaxWidth);for(const p of state.panes)p.width=settings.paneWidth;applyColumnWidths();savePrefs();safeSave();syncOverlay();});widthRow.append(widthLabel,width,apply);
    const widthHelp=create('p','overlay-note');overlayMenu.appendChild(widthHelp);
    const restoreRow=row(),hidden=create('select');hidden.setAttribute('aria-label','隠した列');const restore=button('戻す','隠した列を復帰',()=>{const p=state.panes.find(p=>p.id===hidden.value&&!p.visible);if(!p)return;p.visible=true;state.activeId=p.id;renderPane(p);markActive();applyColumnWidths();safeSave();syncOverlay();});restoreRow.append(hidden,restore);
    row().appendChild(button('その他の設定','拡張のオプション画面を開く',openOptions));
    overlayMenu.appendChild(create('p','overlay-note','元画面では通常どおり操作できます。列は保持されますが、このページの再読み込みでは未送信入力を失います。'));
    shadow.appendChild(overlayMenu);menuControls={close,add,url,width,apply,equal,hidden,restore,widthHelp};
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
    if(previous.paneWidth!==settings.paneWidth)for(const p of state.panes)p.width=settings.paneWidth;
    if(previous.hideFrameSidebar!==settings.hideFrameSidebar)paneNodes.forEach(entry=>{if(entry.iframe)applyIframeSidebarRule(entry.iframe);});
    updateGeometry();ensureMasterSidebar();syncOverlay();safeSave();
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
    closeOverlay(false);
    if (state.enabled && state.panes.length === 0) {
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
    const p={id:newId(),url:Core.ORIGIN+'/',newChat:true,title:'新しいチャット',width:settings.paneWidth,visible:true};
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
    event.preventDefault();event.stopImmediatePropagation();addNewChat();return true;
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
      doc.addEventListener('click', event => {
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
          syncNewChatLocation(frame);scheduleContentLayout();
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
    const frame = create('iframe');frame._cgwwPane=p;
    frame.setAttribute('data-cgww-frame', 'true');
    frame.src = p.url;
    frame.title = `ChatGPT: ${p.title}`;
    // Respect all server-provided iframe and authentication restrictions.
    frame.addEventListener('load', () => {
      try {
        const doc = frame.contentDocument;
        if (doc && frame.contentWindow.location.origin === Core.ORIGIN && doc.body?.children.length) {
          syncNewChatLocation(frame);applyIframeSidebarRule(frame);scheduleContentLayout();
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
        case 'width':settings.paneWidth=Core.boundedNumber(message.value,settings.paneWidth,320,originalMaxWidth);for(const p of state.panes)p.width=settings.paneWidth;applyColumnWidths();savePrefs();safeSave();break;
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
        state.activeId = (Number.isInteger(stored?.activeIndex) ? state.panes[stored.activeIndex]?.id : null) || state.panes.find(p => p.url === stored?.activeUrl)?.id || state.panes.find(p => p.visible)?.id || null;
        if(Number.isFinite(stored?.overlayPosition?.x)&&Number.isFinite(stored?.overlayPosition?.y))overlayPosition={x:stored.overlayPosition.x,y:stored.overlayPosition.y};
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
