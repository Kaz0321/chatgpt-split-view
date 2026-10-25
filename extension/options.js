/* Extension-local preferences only. No conversation state or network access. */
(function (root) {
  'use strict';
  const Core = root.CGWWCore || (typeof module !== 'undefined' && module.exports ? require('./core.js') : null);
  const PREF_KEY = 'cgww.v1.preferences';
  const MAX_IMPORT_BYTES = 64 * 1024;
  const SETTINGS_KEYS = Object.freeze(['sidebarWidth', 'paneWidth', 'keepMasterSidebar', 'interceptSidebar', 'hideFrameSidebar', 'equalizeColumns']);
  const FIELD_IDS = Object.freeze({ sidebarWidth: 'sidebar-width', keepMasterSidebar: 'keep-master-sidebar', interceptSidebar: 'intercept-sidebar', hideFrameSidebar: 'hide-frame-sidebar' });

  function makeExport(settings) {
    return { kind: 'ChatGPTWideWorkspaceSettings', schemaVersion: Core.SCHEMA_VERSION, settings: Core.normalizeSettings(settings) };
  }

  function parseImport(text) {
    if (typeof text !== 'string' || text.length > MAX_IMPORT_BYTES || new TextEncoder().encode(text).byteLength > MAX_IMPORT_BYTES)
      throw new Error('設定JSONは64 KiB以下にしてください。');
    let value;
    try { value = JSON.parse(text); } catch { throw new Error('JSONとして読み込めませんでした。設定JSONを選んでください。'); }
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('設定JSONの形式が一致しません。');
    // Pass only settings to the shared validator. Legacy panes are deliberately ignored.
    const validated = Core.importConfig({ kind: value.kind, schemaVersion: value.schemaVersion, settings: value.settings });
    if (!value.settings || typeof value.settings !== 'object' || Array.isArray(value.settings))
      throw new Error('設定項目が見つかりませんでした。');
    const patch = {};
    for (const key of SETTINGS_KEYS) {
      if (!Object.prototype.hasOwnProperty.call(value.settings, key)) continue;
      const input = value.settings[key];
      if (typeof input !== typeof Core.DEFAULTS[key] || (typeof input === 'number' && !Number.isFinite(input)))
        throw new Error('設定値の型が正しくありません。');
      patch[key] = validated.settings[key];
    }
    if (!Object.keys(patch).length) throw new Error('対応する設定項目が見つかりませんでした。');
    return patch;
  }

  // Chrome supports callbacks and, in current MV3 versions, promises. Handle both
  // while reading lastError in its callback scope and settling only once.
  function chromeCall(chromeApi, method, argument) {
    return new Promise((resolve, reject) => {
      let settled = false;
      const finish = (error, value) => {
        if (settled) return;
        settled = true;
        if (error) reject(error); else resolve(value);
      };
      try {
        const returned = chromeApi.storage.local[method](argument, value => {
          const error = chromeApi.runtime?.lastError;
          finish(error ? new Error(error.message || '設定の保存領域にアクセスできません。') : null, value);
        });
        if (returned && typeof returned.then === 'function') returned.then(value => finish(null, value), error => finish(error));
      } catch (error) { finish(error); }
    });
  }

  function mount(document, chromeApi, browser = root) {
    const find = id => document.getElementById(id);
    const form = find('settings-form');
    const fieldset = find('settings-fields');
    const status = find('status');
    const save = find('save-settings');
    const discard = find('discard-settings');
    const exportButton = find('export-settings');
    const importButton = find('import-settings');
    const fileInput = find('import-file');
    const retry = find('retry-load');
    const fields = Object.fromEntries(Object.entries(FIELD_IDS).map(([key, id]) => [key, find(id)]));
    let preferences = Core.normalizeSettings();
    let ready = false;
    let busy = false;
    let storageRevision = 0;
    const dirty = new Set();

    function setStatus(message, error = false) {
      status.textContent = message;
      status.dataset.state = error ? 'error' : 'ok';
    }

    function updateButtons() {
      fieldset.disabled = !ready || busy;
      save.disabled = !ready || busy || !dirty.size;
      discard.disabled = !ready || busy || !dirty.size;
      exportButton.disabled = !ready || busy;
      importButton.disabled = !ready || busy;
      retry.disabled = busy;
      form.setAttribute('aria-busy', String(busy));
    }

    function renderFields() {
      for (const [key, field] of Object.entries(fields)) {
        if (dirty.has(key)) continue;
        if (key === 'sidebarWidth') field.value = String(preferences[key]);
        else field.checked = preferences[key];
      }
      updateButtons();
    }

    async function readPreferences() {
      const stored = await chromeCall(chromeApi, 'get', PREF_KEY);
      return Core.normalizeSettings(stored?.[PREF_KEY]);
    }

    async function load() {
      if (busy) return;
      busy = true;
      const revision = storageRevision;
      updateButtons();
      setStatus('設定を読み込んでいます…');
      try {
        const loaded = await readPreferences();
        if (revision === storageRevision) preferences = loaded;
        ready = true;
        retry.hidden = true;
        setStatus('変更後に「変更を保存」を押してください。');
      } catch {
        ready = false;
        retry.hidden = false;
        setStatus('設定を読み込めませんでした。拡張が有効か確認し、再試行してください。', true);
      } finally { busy = false; renderFields(); }
    }

    async function writePatch(patch, message) {
      // A fresh read preserves frequent toolbar settings changed in another tab.
      const latest = await readPreferences();
      const next = Core.normalizeSettings({ ...latest, ...patch });
      await chromeCall(chromeApi, 'set', { [PREF_KEY]: next });
      preferences = next;
      dirty.clear();
      setStatus(message);
    }

    for (const [key, field] of Object.entries(fields)) {
      field.addEventListener(key === 'sidebarWidth' ? 'input' : 'change', () => {
        if (!ready || busy) return;
        const current = key === 'sidebarWidth' ? Number(field.value) : field.checked;
        if ((key !== 'sidebarWidth' || field.value.trim() !== '') && current === preferences[key]) dirty.delete(key);
        else dirty.add(key);
        setStatus(dirty.size ? '未保存の変更があります。' : '保存済みの設定と同じです。');
        updateButtons();
      });
    }

    form.addEventListener('submit', async event => {
      event.preventDefault();
      if (!ready || busy || !dirty.size) return;
      const width = Number(fields.sidebarWidth.value);
      if (!fields.sidebarWidth.value.trim() || !Number.isInteger(width) || width < 180 || width > 520) {
        setStatus('左側の表示幅は180〜520の整数で入力してください。', true);
        fields.sidebarWidth.focus();
        return;
      }
      const patch = {};
      for (const key of dirty) patch[key] = key === 'sidebarWidth' ? width : fields[key].checked;
      busy = true;
      updateButtons();
      setStatus('設定を保存しています…');
      try { await writePatch(patch, '設定を保存しました。開いている横並び画面にも反映されます。'); }
      catch { setStatus('保存できませんでした。変更は残っています。もう一度保存してください。', true); }
      finally { busy = false; renderFields(); }
    });

    discard.addEventListener('click', () => {
      if (!ready || busy) return;
      dirty.clear();
      renderFields();
      setStatus('未保存の変更を取り消しました。');
    });

    exportButton.addEventListener('click', async () => {
      if (!ready || busy) return;
      busy = true;
      updateButtons();
      let url;
      let link;
      try {
        const saved = await readPreferences();
        const blob = new browser.Blob([JSON.stringify(makeExport(saved), null, 2) + '\n'], { type: 'application/json' });
        url = browser.URL.createObjectURL(blob);
        link = document.createElement('a');
        link.href = url;
        link.download = 'chatgpt-wide-workspace-settings.json';
        document.body.appendChild(link);
        link.click();
        setStatus(dirty.size ? '保存済みの設定を書き出しました。未保存の変更は含みません。' : '設定だけを書き出しました。会話のURL・タイトルは含みません。');
      } catch { setStatus('設定を書き出せませんでした。もう一度お試しください。', true); }
      finally {
        if (link) link.remove();
        if (url) browser.setTimeout(() => browser.URL.revokeObjectURL(url), 1000);
        busy = false;
        updateButtons();
      }
    });

    importButton.addEventListener('click', () => { if (ready && !busy) fileInput.click(); });
    fileInput.addEventListener('change', async () => {
      const file = fileInput.files?.[0];
      if (!file || !ready || busy) { fileInput.value = ''; return; }
      busy = true;
      updateButtons();
      try {
        if (!Number.isFinite(file.size) || file.size > MAX_IMPORT_BYTES) throw new Error('設定JSONは64 KiB以下にしてください。');
        const patch = parseImport(await file.text());
        const frequent = Object.prototype.hasOwnProperty.call(patch, 'paneWidth') || Object.prototype.hasOwnProperty.call(patch, 'equalizeColumns');
        const message = 'ファイルに記載された設定を適用しますか？\n' +
          (frequent ? '列幅・等分は、ファイルに記載された項目も更新します。\n' : '列幅・等分の設定は変更しません。\n') +
          '会話や列は復元しません。' + (dirty.size ? '\nこの画面の未保存の変更は取り消されます。' : '');
        if (!browser.confirm(message)) { setStatus('読み込みをキャンセルしました。'); return; }
        try { await writePatch(patch, '設定のみを読み込みました。会話や列は変更していません。'); }
        catch { setStatus('読み込んだ設定を保存できませんでした。元の変更は残っています。', true); }
      } catch (error) { setStatus(error instanceof Error ? error.message : '設定を読み込めませんでした。', true); }
      finally { fileInput.value = ''; busy = false; renderFields(); }
    });

    function onStorageChanged(changes, areaName) {
      if (areaName !== 'local' || !Object.prototype.hasOwnProperty.call(changes, PREF_KEY)) return;
      storageRevision++;
      preferences = Core.normalizeSettings(changes[PREF_KEY].newValue);
      renderFields();
      if (ready && !busy) setStatus(dirty.size ? '別の画面で設定が更新されました。未保存の項目はそのまま残しています。' : '別の画面で更新された設定を反映しました。');
    }

    chromeApi?.storage?.onChanged?.addListener(onStorageChanged);
    // Let the document own listener lifetime; removing it on pagehide would
    // leave a back/forward-cache restore unable to receive storage updates.
    retry.addEventListener('click', load);
    void load();
    return { load };
  }

  const api = { PREF_KEY, MAX_IMPORT_BYTES, SETTINGS_KEYS, makeExport, parseImport, chromeCall, mount };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else if (Core) mount(root.document, root.chrome);
  else {
    const status = root.document.getElementById('status');
    status.textContent = '設定の初期化に失敗しました。拡張を再読み込みしてください。';
    status.dataset.state = 'error';
  }
})(globalThis);
