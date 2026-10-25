const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Core = require('../extension/core.js');
const Options = require('../extension/options.js');
const KEY = Options.PREF_KEY;
const settle = () => new Promise(resolve => setImmediate(resolve));
const config = settings => ({ kind: 'ChatGPTWideWorkspaceSettings', schemaVersion: Core.SCHEMA_VERSION, settings });

class Element {
  constructor() {
    this.value = ''; this.checked = false; this.disabled = false; this.hidden = false;
    this.textContent = ''; this.dataset = {}; this.listeners = {}; this.attributes = {};
  }
  addEventListener(type, listener) { (this.listeners[type] ||= []).push(listener); }
  async emit(type) { for (const fn of this.listeners[type] || []) await fn({ preventDefault() {} }); }
  setAttribute(name, value) { this.attributes[name] = value; }
  focus() { this.focused = true; }
  click() { this.clicked = true; return this.emit('click'); }
  remove() { this.removed = true; }
}

function harness(initial = {}) {
  let stored = Core.normalizeSettings(initial);
  const nodes = Object.fromEntries(['settings-form', 'settings-fields', 'status', 'save-settings', 'discard-settings',
    'export-settings', 'import-settings', 'import-file', 'retry-load', 'sidebar-width', 'keep-master-sidebar',
    'intercept-sidebar', 'hide-frame-sidebar'].map(id => [id, new Element()]));
  const listeners = new Set();
  const state = { writes: [], failGet: false, failSet: false, confirmations: [], confirmResult: true, downloads: [], created: [] };
  const chrome = {
    runtime: {},
    storage: {
      local: {
        get(key, callback) {
          assert.equal(key, KEY);
          const snapshot = { [KEY]: structuredClone(stored) };
          queueMicrotask(() => {
            if (state.failGet) chrome.runtime.lastError = { message: 'read failed' };
            callback(state.failGet ? undefined : snapshot);
            delete chrome.runtime.lastError;
          });
        },
        set(value, callback) {
          state.writes.push(structuredClone(value));
          queueMicrotask(() => {
            if (state.failSet) chrome.runtime.lastError = { message: 'write failed' };
            else {
              const oldValue = stored;
              stored = structuredClone(value[KEY]);
              for (const listener of listeners) listener({ [KEY]: { oldValue, newValue: stored } }, 'local');
            }
            callback();
            delete chrome.runtime.lastError;
          });
        }
      },
      onChanged: { addListener: listener => listeners.add(listener), removeListener: listener => listeners.delete(listener) }
    }
  };
  const document = {
    getElementById: id => nodes[id],
    createElement: tag => { assert.equal(tag, 'a'); const element = new Element(); state.created.push(element); return element; },
    body: { appendChild() {} }
  };
  const browser = {
    Blob, URL: { createObjectURL: blob => { state.downloads.push(blob); return 'blob:local-test'; }, revokeObjectURL: url => { state.revoked = url; } },
    setTimeout: callback => { callback(); },
    confirm: message => { state.confirmations.push(message); return state.confirmResult; },
    addEventListener: (type, callback) => { state[type] = callback; }
  };
  const controller = Options.mount(document, chrome, browser);
  return {
    nodes, state, chrome, controller,
    get stored() { return stored; },
    external(value, notify = true, area = 'local') {
      stored = structuredClone(value);
      if (notify) for (const listener of listeners) listener({ [KEY]: { newValue: value } }, area);
    },
    async change(id, value, event = 'change') {
      if (id === 'sidebar-width') nodes[id].value = String(value); else nodes[id].checked = value;
      await nodes[id].emit(event);
    },
    async import(value, size) {
      const text = typeof value === 'string' ? value : JSON.stringify(value);
      state.fileReads = 0;
      nodes['import-file'].files = [{ size: size ?? Buffer.byteLength(text), text: async () => { state.fileReads++; return text; } }];
      nodes['import-file'].value = 'chosen-file';
      await nodes['import-file'].emit('change');
    }
  };
}

test('settings export never includes conversation data or unknown properties', () => {
  const result = Options.makeExport({ ...Core.DEFAULTS, paneWidth: 760, panes: [{ url: 'private', title: 'private' }], url: 'private', title: 'private' });
  assert.deepEqual(Object.keys(result).sort(), ['kind', 'schemaVersion', 'settings']);
  assert.deepEqual(Object.keys(result.settings).sort(), [...Options.SETTINGS_KEYS].sort());
  assert.equal(result.schemaVersion, Core.SCHEMA_VERSION);
  assert.equal(result.settings.paneWidth, 760);
  assert.ok(!JSON.stringify(result).includes('private'));
});

test('import validates shared schema, field types and UTF-8 file-size cap', () => {
  assert.throws(() => Options.parseImport(JSON.stringify({ ...config({ paneWidth: 600 }), schemaVersion: 99 })));
  assert.throws(() => Options.parseImport(JSON.stringify({ ...config({ paneWidth: 600 }), kind: 'Other' })));
  for (const settings of [null, [], {}, { paneWidth: '600' }, { keepMasterSidebar: 1 }, { unknown: true }])
    assert.throws(() => Options.parseImport(JSON.stringify(config(settings))));
  assert.throws(() => Options.parseImport('not JSON'));
  assert.throws(() => Options.parseImport(' '.repeat(Options.MAX_IMPORT_BYTES + 1)));
  assert.throws(() => Options.parseImport(JSON.stringify({ ...config({ sidebarWidth: 300 }), padding: 'あ'.repeat(23000) })), /64 KiB/);
  assert.deepEqual(Options.parseImport(JSON.stringify(config({ sidebarWidth: 9999 }))), { sidebarWidth: 520 });
});

test('import returns only explicitly provided allowlisted settings and ignores legacy panes', () => {
  const patch = Options.parseImport(JSON.stringify({ ...config({ keepMasterSidebar: false }), panes: [{ url: 'secret-url', title: 'secret-title' }] }));
  assert.deepEqual(patch, { keepMasterSidebar: false });
  const polluted = Options.parseImport('{"kind":"ChatGPTWideWorkspaceSettings","schemaVersion":1,"settings":{"__proto__":{"polluted":true},"sidebarWidth":300}}');
  assert.deepEqual(polluted, { sidebarWidth: 300 });
  assert.equal({}.polluted, undefined);
});

test('Chrome bridge supports promise APIs, callback lastError and synchronous failures', async () => {
  assert.deepEqual(await Options.chromeCall({ storage: { local: { get: async () => ({ value: 1 }) } } }, 'get', KEY), { value: 1 });
  await assert.rejects(Options.chromeCall({ storage: { local: { get: () => Promise.reject(new Error('promise fail')) } } }, 'get', KEY), /promise fail/);
  await assert.rejects(Options.chromeCall({ storage: { local: { get() { throw new Error('sync fail'); } } } }, 'get', KEY), /sync fail/);
  const chrome = { runtime: { lastError: { message: 'callback fail' } }, storage: { local: { get: (key, cb) => cb() } } };
  await assert.rejects(Options.chromeCall(chrome, 'get', KEY), /callback fail/);
});

test('load enables fields, displays saved prefs and saves only rare dirty fields', async () => {
  const h = harness({ sidebarWidth: 288, paneWidth: 710, equalizeColumns: false });
  assert.equal(h.nodes['settings-fields'].disabled, true);
  await settle();
  assert.equal(h.nodes['sidebar-width'].value, '288');
  assert.equal(h.nodes['save-settings'].disabled, true);
  await h.change('keep-master-sidebar', false);
  // A toolbar update happens after the options page loaded, without an event.
  h.external({ ...h.stored, paneWidth: 875, equalizeColumns: true, interceptSidebar: false }, false);
  await h.nodes['settings-form'].emit('submit');
  assert.equal(h.stored.keepMasterSidebar, false);
  assert.equal(h.stored.paneWidth, 875);
  assert.equal(h.stored.equalizeColumns, true);
  assert.equal(h.stored.interceptSidebar, false);
  assert.deepEqual(Object.keys(h.state.writes[0]), [KEY]);
  assert.equal(h.nodes['save-settings'].disabled, true);
});

test('external preference changes refresh clean controls without losing unsaved edits', async () => {
  const h = harness(); await settle();
  await h.change('sidebar-width', '310', 'input');
  h.external({ ...h.stored, sidebarWidth: 320, hideFrameSidebar: false, paneWidth: 800 });
  assert.equal(h.nodes['sidebar-width'].value, '310');
  assert.equal(h.nodes['hide-frame-sidebar'].checked, false);
  assert.match(h.nodes.status.textContent, /未保存/);
  await h.nodes['settings-form'].emit('submit');
  assert.equal(h.stored.sidebarWidth, 310);
  assert.equal(h.stored.hideFrameSidebar, false);
  assert.equal(h.stored.paneWidth, 800);
});

test('an external update during initial load wins over the stale read snapshot', async () => {
  const h = harness({ sidebarWidth: 270 });
  h.external({ ...h.stored, sidebarWidth: 350 });
  await settle();
  assert.equal(h.nodes['sidebar-width'].value, '350');
});

test('invalid widths are not saved; reverting a checkbox clears its dirty state', async () => {
  const h = harness(); await settle();
  await h.change('keep-master-sidebar', false);
  await h.change('keep-master-sidebar', true);
  assert.equal(h.nodes['save-settings'].disabled, true);
  for (const width of ['', 'abc', '179', '521', '300.5']) {
    await h.change('sidebar-width', width, 'input');
    await h.nodes['settings-form'].emit('submit');
    assert.equal(h.nodes.status.dataset.state, 'error');
  }
  assert.equal(h.state.writes.length, 0);
  assert.equal(h.nodes['sidebar-width'].focused, true);
});

test('read failures can retry and save failures retain unsaved changes', async () => {
  const h = harness(); h.state.failGet = true; await settle();
  assert.equal(h.nodes['settings-fields'].disabled, true);
  assert.equal(h.nodes['retry-load'].hidden, false);
  h.state.failGet = false;
  await h.nodes['retry-load'].emit('click');
  assert.equal(h.nodes['settings-fields'].disabled, false);
  await h.change('sidebar-width', 310, 'input');
  h.state.failSet = true;
  await h.nodes['settings-form'].emit('submit');
  assert.equal(h.nodes['sidebar-width'].value, '310');
  assert.equal(h.nodes['save-settings'].disabled, false);
  assert.equal(h.nodes.status.dataset.state, 'error');
  h.state.failSet = false;
  await h.nodes['settings-form'].emit('submit');
  assert.equal(h.stored.sidebarWidth, 310);
});

test('repeated submits issue one write and discard restores last external values', async () => {
  const h = harness(); await settle();
  await h.change('sidebar-width', 310, 'input');
  await Promise.all([h.nodes['settings-form'].emit('submit'), h.nodes['settings-form'].emit('submit')]);
  assert.equal(h.state.writes.length, 1);
  await h.change('sidebar-width', 400, 'input');
  h.external({ ...h.stored, sidebarWidth: 340 });
  await h.nodes['discard-settings'].emit('click');
  assert.equal(h.nodes['sidebar-width'].value, '340');
  assert.equal(h.nodes['save-settings'].disabled, true);
});

test('settings-only import merges provided fields; explicit frequent values apply intentionally', async () => {
  const h = harness({ paneWidth: 840, equalizeColumns: true }); await settle();
  await h.import({ ...config({ sidebarWidth: 320 }), panes: [{ url: 'private-url', title: 'private-title' }] });
  assert.equal(h.stored.sidebarWidth, 320);
  assert.equal(h.stored.paneWidth, 840);
  assert.equal(h.stored.equalizeColumns, true);
  assert.ok(!JSON.stringify(h.state.writes).includes('private'));
  assert.match(h.state.confirmations[0], /変更しません/);
  await h.import(config({ paneWidth: 600, equalizeColumns: false }));
  assert.equal(h.stored.paneWidth, 600);
  assert.equal(h.stored.equalizeColumns, false);
  assert.equal(h.stored.sidebarWidth, 320);
  assert.match(h.state.confirmations[1], /更新します/);
  assert.equal(h.nodes['import-file'].value, '');
});

test('canceled, invalid and oversized imports never write or discard unsaved changes', async () => {
  const h = harness(); await settle();
  await h.change('sidebar-width', 310, 'input');
  h.state.confirmResult = false;
  await h.import(config({ sidebarWidth: 400 }));
  assert.equal(h.nodes['sidebar-width'].value, '310');
  assert.equal(h.nodes['save-settings'].disabled, false);
  await h.import(config({ sidebarWidth: 400 }), Options.MAX_IMPORT_BYTES + 1);
  assert.equal(h.state.fileReads, 0);
  await h.import('invalid');
  assert.equal(h.state.writes.length, 0);
  assert.equal(h.nodes['import-file'].value, '');
});

test('export uses saved values, strips unknown fields, cleans its download URL and keeps dirty edits', async () => {
  const h = harness({ sidebarWidth: 290 }); await settle();
  await h.change('sidebar-width', 410, 'input');
  h.external({ ...h.stored, secret: 'private', paneWidth: 790 }, false);
  await h.nodes['export-settings'].emit('click');
  const content = JSON.parse(await h.state.downloads[0].text());
  assert.equal(content.settings.sidebarWidth, 290);
  assert.equal(content.settings.paneWidth, 790);
  assert.ok(!JSON.stringify(content).includes('private'));
  assert.equal(h.nodes['sidebar-width'].value, '410');
  assert.equal(h.nodes['save-settings'].disabled, false);
  assert.equal(h.state.created[0].download, 'chatgpt-wide-workspace-settings.json');
  assert.equal(h.state.created[0].removed, true);
  assert.equal(h.state.revoked, 'blob:local-test');
});

test('options assets use external scripts/styles, associated labels and no remote resources', () => {
  const dir = path.join(__dirname, '..', 'extension');
  const html = fs.readFileSync(path.join(dir, 'options.html'), 'utf8');
  const js = fs.readFileSync(path.join(dir, 'options.js'), 'utf8');
  const css = fs.readFileSync(path.join(dir, 'options.css'), 'utf8');
  assert.match(html, /<html lang="ja">/);
  assert.match(html, /src="core.js" defer/);
  assert.match(html, /src="options.js" defer/);
  assert.match(html, /href="options.css"/);
  assert.doesNotMatch(html, /<style|style=|\son\w+=|<script(?![^>]*\bsrc=)/i);
  assert.doesNotMatch(html + css, /https?:\/\/|@import/);
  assert.doesNotMatch(js, /innerHTML|fetch\(|XMLHttpRequest|sessionStorage|localStorage|storage\.local\.clear\(/);
  for (const id of ['sidebar-width', 'keep-master-sidebar', 'intercept-sidebar', 'hide-frame-sidebar'])
    assert.match(html, new RegExp(`for="${id}"`));
  assert.match(html, /role="status"/);
  assert.match(html, /候補版/);
  assert.match(html, /実験的/);
});


test('browser script initializes through CGWWCore without CommonJS or inline handlers', async () => {
  const vm = require('node:vm');
  const nodes = Object.fromEntries(['settings-form', 'settings-fields', 'status', 'save-settings', 'discard-settings',
    'export-settings', 'import-settings', 'import-file', 'retry-load', 'sidebar-width', 'keep-master-sidebar',
    'intercept-sidebar', 'hide-frame-sidebar'].map(id => [id, new Element()]));
  const context = vm.createContext({
    CGWWCore: Core, TextEncoder,
    document: { getElementById: id => nodes[id] },
    chrome: { runtime: {}, storage: { local: { get: async () => ({ [KEY]: { sidebarWidth: 345 } }) }, onChanged: { addListener() {} } } }
  });
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../extension/options.js'), 'utf8'), context);
  await settle();
  assert.equal(nodes['sidebar-width'].value, '345');
  assert.equal(nodes['settings-fields'].disabled, false);
});
