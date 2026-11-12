/* Pure validation helpers. No ChatGPT content, network calls or credentials are accessed. */
(function (root) {
  'use strict';
  const ORIGIN = 'https://chatgpt.com';
  const DEFAULTS = Object.freeze({ contentPadding: 12, sidebarWidth: 348, sidebarVisible: true, sidebarLocked: false, nativePaneWidth: true, paneWidth: 794, interceptSidebar: true, hideFrameSidebar: true, equalizeColumns: false, keepMasterSidebar: true });
  const SCHEMA_VERSION = 1;

  function boundedNumber(value, fallback, min, max) {
    const n = Number(value);
    return Number.isFinite(n) ? Math.min(max, Math.max(min, Math.round(n))) : fallback;
  }

  function normalizeSettings(settings = {}) {
    if (!settings || typeof settings !== 'object' || Array.isArray(settings)) settings = {};
    return {
      sidebarVisible: typeof settings.sidebarVisible==='boolean'?settings.sidebarVisible:true,
      sidebarLocked: typeof settings.sidebarLocked==='boolean'?settings.sidebarLocked:false,
      nativePaneWidth: typeof settings.nativePaneWidth==='boolean'?settings.nativePaneWidth:(settings.paneWidth==null||settings.paneWidth===620),
      contentPadding: boundedNumber(settings.contentPadding, DEFAULTS.contentPadding, 0, 12),
      sidebarWidth: boundedNumber(settings.sidebarWidth, DEFAULTS.sidebarWidth, 180, 520),
      paneWidth: boundedNumber(settings.paneWidth, DEFAULTS.paneWidth, 320, 1400),
      interceptSidebar: typeof settings.interceptSidebar === 'boolean' ? settings.interceptSidebar : DEFAULTS.interceptSidebar,
      hideFrameSidebar: typeof settings.hideFrameSidebar === 'boolean' ? settings.hideFrameSidebar : DEFAULTS.hideFrameSidebar,
      equalizeColumns: typeof settings.equalizeColumns === 'boolean' ? settings.equalizeColumns : DEFAULTS.equalizeColumns,
      keepMasterSidebar: typeof settings.keepMasterSidebar === 'boolean' ? settings.keepMasterSidebar : DEFAULTS.keepMasterSidebar
    };
  }

  // Equal-size columns fit the available viewport unless the minimum useful width
  // would be too narrow; they then overflow horizontally, without losing panes.
  function calculateEqualWidth(availableWidth, count, maxWidth, minWidth = 320, gap = 7, padding = 18) {
    const n = Math.max(1, Math.floor(Number(count) || 1));
    const width = (Math.max(0, Number(availableWidth) || 0) - padding - gap * (n - 1)) / n;
    return Math.min(maxWidth, Math.max(minWidth, Math.floor(width)));
  }

  function chatUrl(input) {
    if (typeof input !== 'string' || input.length > 2048) return null;
    let url;
    try { url = new URL(input, ORIGIN); } catch { return null; }
    if (url.origin !== ORIGIN || url.username || url.password) return null;
    // Explicit paths only. A loose `/c/` substring rejected valid `/local/` threads
    // and accidentally accepted arbitrary subpaths in the original version.
    const pathname = url.pathname.replace(/\/$/, '');
    const supported = [
      /^\/c\/[\w-]{6,}$/,
      /^\/c\/local-chatgpt%3A[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
      /^\/local\/[\w-]{6,}$/,
      /^\/g\/g-[\w-]{3,}\/c\/[\w-]{6,}$/,
      /^\/project\/[\w-]{6,}\/c\/[\w-]{6,}$/
    ].some(pattern => pattern.test(pathname));
    if (!supported) return null;
    if(/^\/c\/local-chatgpt%3a/i.test(pathname))return ORIGIN+'/c/local-chatgpt%3A'+pathname.slice('/c/local-chatgpt%3A'.length).toLowerCase();
    // Preserve only the documented-looking local host selector when present;
    // strip all other query/fragment fields to avoid leaking incidental data.
    if (pathname.startsWith('/local/') && url.searchParams.get('hostId') === 'local')
      return ORIGIN + pathname + '?hostId=local';
    return ORIGIN + pathname;
  }

  // GPT landing pages are resources, not conversations. Keep their namespace separate.
  function isProvisionalChat(input){const url=chatUrl(input);return !!url&&/^\/c\/local-chatgpt%3a/i.test(new URL(url).pathname);}

  function gptUrl(input) {
    if(typeof input!=='string'||input.length>2048)return null;
    let url;try{url=new URL(input,ORIGIN);}catch{return null;}
    if(url.origin!==ORIGIN||url.username||url.password)return null;
    const path=url.pathname.replace(/\/$/,'');
    return /^\/g\/g-[A-Za-z0-9]{3,}(?:-[A-Za-z0-9_-]+)?$/.test(path)?ORIGIN+path:null;
  }
  function paneUrl(input) { return chatUrl(input)||gptUrl(input); }
  function paneKey(input) {
    const chat=conversationKey(input);if(chat)return chat;
    const gpt=gptUrl(input);
    return gpt?'gpt:'+new URL(gpt).pathname.slice(5).split('-')[0]:null;
  }

  // Project/GPT routes are aliases of the same conversation; local threads
  // occupy a separate namespace. Blank chats intentionally have no identity.
  function conversationKey(input) {
    const normalized=chatUrl(input);if(!normalized)return null;
    const path=new URL(normalized).pathname;
    let id=path.split('/').pop();
    if(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id))id=id.toLowerCase();
    return (path.startsWith('/local/')?'local:':'chat:')+id;
  }

  // A new draft is a distinct pane, not a conversation URL for history deduplication.
  function newChatUrl(input) {
    if (typeof input !== 'string' || input.length > 2048) return null;
    let url;
    try { url = new URL(input, ORIGIN); } catch { return null; }
    if (url.origin !== ORIGIN || url.username || url.password || url.pathname !== '/' || url.hash) return null;
    // Keep mode/project/GPT links native rather than silently changing their meaning.
    for (const key of url.searchParams.keys()) if (key !== 'noauth_recent_chat_failed') return null;
    return ORIGIN + '/';
  }

  function normalizeTitle(value, fallback = 'ChatGPT チャット') {
    const t = typeof value === 'string' ? value.replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, 100) : '';
    return t || fallback;
  }

  function normalizePanes(panes, max = 200) {
    const result = [];
    const seen = new Set();
    if (!Array.isArray(panes)) return result;
    for (const p of panes.slice(0, max * 3)) {
      if (!p || typeof p !== 'object' || Array.isArray(p)) continue;
      const url = paneUrl(p.url);
      if (!url || seen.has(paneKey(url))) continue;
      seen.add(paneKey(url));
      result.push({
        url,
        title: normalizeTitle(p.title),
        width: boundedNumber(p.width, DEFAULTS.paneWidth, 320, 1400),
        ...(typeof p.autoWidth==='boolean'?{autoWidth:p.autoWidth}:{}), visible: p.visible !== false
      });
      if (result.length >= max) break;
    }
    return result;
  }

  function normalizeSessionPanes(panes, max = 200) {
    const result = [];
    if (!Array.isArray(panes)) return result;
    for (const p of panes.slice(0, max)) {
      if (!p || typeof p !== 'object' || Array.isArray(p)) continue;
      const fresh = p.newChat === true && newChatUrl(p.url);
      const url = p.url == null ? null : (fresh || paneUrl(p.url));
      if (p.url != null && !url) continue;
      result.push({ url, ...(fresh ? {newChat:true} : {}), ...(p.titleMode==='local'||p.titleMode==='native'?{titleMode:p.titleMode}:{}), title: normalizeTitle(p.title, fresh ? '新しいチャット' : (url ? 'ChatGPT チャット' : '未設定の列')),
        width: boundedNumber(p.width, DEFAULTS.paneWidth, 320, 1400), ...(typeof p.autoWidth==='boolean'?{autoWidth:p.autoWidth}:{}), visible: p.visible !== false });
    }
    return result;
  }

  function importConfig(value) {
    if (!value || typeof value !== 'object' || value.kind !== 'ChatGPTWideWorkspaceSettings' || value.schemaVersion !== SCHEMA_VERSION) {
      throw new Error('形式またはバージョンが一致しません。');
    }
    return {
      settings: normalizeSettings(value.settings),
      panes: normalizePanes(value.panes)
    };
  }

  // Workspace restoration: drafts never enter settings exports or closed history.
  function restoreWorkspacePanes(raw,newId) {
    if(!Array.isArray(raw))return [];
    const ids=new Set(),result=[],conversations=new Map();
    for(const item of raw.slice(0,200)){
      const pane=normalizeSessionPanes([item])[0];if(!pane)continue;
      const candidate=typeof item.id==='string'&&/^[a-zA-Z0-9_-]{1,100}$/.test(item.id)?item.id:null;
      const id=candidate&&!ids.has(candidate)?candidate:newId();ids.add(id);
      const branch=typeof item.branchSource==='string'&&/^[a-zA-Z0-9_-]{1,100}$/.test(item.branchSource)&&conversationKey(item.branchOrigin)?{branchSource:item.branchSource,branchOrigin:chatUrl(item.branchOrigin)}:{};
      const key=paneKey(pane.url),existing=!branch.branchSource&&key&&conversations.get(key);
      const backups=Array.isArray(item.draftBackups)?item.draftBackups.filter(x=>typeof x==='string'&&x):[];
      if(existing){
        if(backups.length)existing.draftBackups=[...new Set([...(existing.draftBackups||[]),...backups])];
        existing.visible=existing.visible||pane.visible;
        if(typeof item.draft==='string'&&item.draft&&!existing.draft)existing.draft=item.draft;
        else if(typeof item.draft==='string'&&item.draft&&item.draft!==existing.draft){
          // Preserve conflicting unsent text without reopening the conversation twice.
          result.push({...pane,id,url:ORIGIN+'/',newChat:true,title:normalizeTitle(item.title)+' (下書き)',draft:item.draft});
        }
        continue;
      }
      const restored={...pane,...branch,id,...(item.folded===true?{folded:true}:{}),...(backups.length?{draftBackups:[...new Set(backups)]}:{}),...(typeof item.draft==='string'?{draft:item.draft}:{})};
      result.push(restored);if(key&&!branch.branchSource)conversations.set(key,restored);
    }
    return result;
  }

  function restoredActiveIndex(raw,panes) {
    const selected=Number.isInteger(raw.activeIndex)?raw.panes?.[raw.activeIndex]:null;
    let index=selected?.id?panes.findIndex(p=>p.id===selected.id):-1;
    const key=paneKey(selected?.url||raw.activeUrl);
    if(index<0&&key)index=panes.findIndex(p=>paneKey(p.url)===key);
    if(index<0&&selected&&!key&&normalizeSessionPanes([selected]).length){
      let sequence=0;
      index=restoreWorkspacePanes(raw.panes.slice(0,raw.activeIndex+1),()=>`legacy-${++sequence}`).length-1;
    }
    if(index<0)index=panes.findIndex(p=>p.visible);
    return index;
  }

  const PANE_DRAG_TYPE = 'application/x-cgww-pane-id';
  function isPaneReorderDrag(types) {
    const values=Array.from(types||[],value=>String(value).toLowerCase());
    return !values.includes('files')&&values.includes(PANE_DRAG_TYPE);
  }
  function movePane(panes,sourceId,targetId,after=false) {
    if(sourceId===targetId)return panes;
    const source=panes.find(p=>p.id===sourceId),target=panes.find(p=>p.id===targetId);
    if(!source||!target)return panes;
    const result=panes.filter(p=>p!==source),index=result.indexOf(target);
    result.splice(index+(after?1:0),0,source);return result;
  }

  // A newly loaded document must not replace a name already observed elsewhere.
  function createTitleTracker() {
    const sources=new WeakMap(), names=new Map();
    return {
      get:key=>names.get(key),
      observe(source,values){
        const previous=sources.get(source);sources.set(source,new Map(values));
        for(const [key,title] of values){
          if(!key||!title)continue;
          const current=names.get(key);
          if(current===title)continue;
          if(current!==undefined&&(!previous?.has(key)||previous.get(key)===title))continue;
          names.set(key,title);
        }
      }
    };
  }
  function applyNativeTitle(pane,title,editing=false) {
    if(!conversationKey(pane.url)||!title||editing||pane.titleMode==='local')return false;
    if(!pane.titleMode&&pane.title!==title&&!['新しいチャット','ChatGPT チャット','未設定の列'].includes(pane.title)){
      pane.titleMode='local';return true; // Legacy names may be user aliases.
    }
    const changed=pane.title!==title||pane.titleMode!=='native';
    pane.title=title;pane.titleMode='native';return changed;
  }

  function isBranchLabel(label){return /^(?:Branch in new chat|新しいチャットに分岐|新しいチャットで分岐|チャットを分岐)$/i.test(label);}

  const api = { isProvisionalChat, isBranchLabel, createTitleTracker, applyNativeTitle, gptUrl, paneUrl, paneKey, conversationKey, restoredActiveIndex, restoreWorkspacePanes, PANE_DRAG_TYPE, isPaneReorderDrag, movePane, ORIGIN, DEFAULTS, SCHEMA_VERSION, boundedNumber, normalizeSettings, calculateEqualWidth, chatUrl, newChatUrl, normalizeTitle, normalizePanes, normalizeSessionPanes, importConfig };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.CGWWCore = api;
})(globalThis);
