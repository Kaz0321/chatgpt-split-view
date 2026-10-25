/* Pure validation helpers. No ChatGPT content, network calls or credentials are accessed. */
(function (root) {
  'use strict';
  const ORIGIN = 'https://chatgpt.com';
  const DEFAULTS = Object.freeze({ sidebarWidth: 276, paneWidth: 620, interceptSidebar: true, hideFrameSidebar: true, equalizeColumns: false, keepMasterSidebar: true });
  const SCHEMA_VERSION = 1;

  function boundedNumber(value, fallback, min, max) {
    const n = Number(value);
    return Number.isFinite(n) ? Math.min(max, Math.max(min, Math.round(n))) : fallback;
  }

  function normalizeSettings(settings = {}) {
    if (!settings || typeof settings !== 'object' || Array.isArray(settings)) settings = {};
    return {
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
      /^\/local\/[\w-]{6,}$/,
      /^\/g\/g-[\w-]{3,}\/c\/[\w-]{6,}$/,
      /^\/project\/[\w-]{6,}\/c\/[\w-]{6,}$/
    ].some(pattern => pattern.test(pathname));
    if (!supported) return null;
    // Preserve only the documented-looking local host selector when present;
    // strip all other query/fragment fields to avoid leaking incidental data.
    if (pathname.startsWith('/local/') && url.searchParams.get('hostId') === 'local')
      return ORIGIN + pathname + '?hostId=local';
    return ORIGIN + pathname;
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
      const url = chatUrl(p.url);
      if (!url || seen.has(url)) continue;
      seen.add(url);
      result.push({
        url,
        title: normalizeTitle(p.title),
        width: boundedNumber(p.width, DEFAULTS.paneWidth, 320, 1400),
        visible: p.visible !== false
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
      const url = p.url == null ? null : chatUrl(p.url);
      if (p.url != null && !url) continue;
      result.push({ url, title: normalizeTitle(p.title, url ? 'ChatGPT チャット' : '未設定の列'),
        width: boundedNumber(p.width, DEFAULTS.paneWidth, 320, 1400), visible: p.visible !== false });
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

  const api = { PANE_DRAG_TYPE, isPaneReorderDrag, movePane, ORIGIN, DEFAULTS, SCHEMA_VERSION, boundedNumber, normalizeSettings, calculateEqualWidth, chatUrl, normalizeTitle, normalizePanes, normalizeSessionPanes, importConfig };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.CGWWCore = api;
})(globalThis);
