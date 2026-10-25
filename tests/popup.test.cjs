const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const Popup = require('../popup.js');
const settle = () => new Promise(resolve => setImmediate(resolve));
const validState = extra => ({ ok: true, enabled: true, equalizeColumns: false, paneWidth: 620, maxWidth: 920,
  visibleCount: 2, totalCount: 3, hiddenPanes: [{ id: 'hidden-1', title: '隠した列' }], ...extra });

class Element {
  constructor() { this.value = ''; this.checked = false; this.disabled = false; this.hidden = false; this.textContent = ''; this.children = []; this.dataset = {}; this.attributes = {}; this.listeners = {}; }
  addEventListener(type, fn) { (this.listeners[type] ||= []).push(fn); }
  setAttribute(key, value) { this.attributes[key] = value; }
  replaceChildren() { this.children = []; this.value = ''; }
  appendChild(child) { this.children.push(child); if (!this.value) this.value = child.value; }
  focus() { this.focused = true; }
  async emit(type) { const event = { preventDefault() { this.defaultPrevented = true; } }; for (const fn of this.listeners[type] || []) await fn(event); return event; }
}

function harness(initial = {}) {
  const ids = ['popup', 'toggle-workspace', 'workspace-controls', 'pane-count', 'add-pane', 'equal-columns', 'width-form',
    'pane-width', 'apply-width', 'width-help', 'url-form', 'chat-url', 'add-url', 'restore-form', 'hidden-panes', 'restore-pane',
    'status', 'retry-status', 'open-options'];
  const nodes = Object.fromEntries(ids.map(id => [id, new Element()]));
  const data = { state: validState(initial), queries: [], calls: [], tabId: 14, optionsCalls: 0 };
  const document = { getElementById: id => nodes[id], createElement: tag => { assert.equal(tag, 'option'); return new Element(); } };
  const chrome = {
    tabs: {
      async query(query) {
        data.queries.push(query);
        if (data.queryError) throw new Error('query rejected');
        if (data.noTab) return [];
        // Any URL access would throw. Permissions beyond the tab ID are unnecessary.
        return [{ id: data.tabId, get url() { throw new Error('must not read tab URL'); } }];
      },
      async sendMessage(tabId, message) {
        data.calls.push({ tabId, message });
        if (data.waitResponse) await data.waitResponse;
        if (data.sendError) throw new Error('no receiving end');
        if (data.response !== undefined) return data.response;
        switch (message.action) {
          case 'enable': data.state.enabled = true; break;
          case 'disable': data.state.enabled = false; break;
          case 'add': data.state.visibleCount++; data.state.totalCount++; break;
          case 'width': data.state.paneWidth = message.value; break;
          case 'equal': data.state.equalizeColumns = message.value; break;
          case 'addUrl': data.state.visibleCount++; data.state.totalCount++; break;
          case 'restore': data.state.hiddenPanes = data.state.hiddenPanes.filter(p => p.id !== message.paneId); data.state.visibleCount++; break;
        }
        return structuredClone(data.state);
      }
    },
    runtime: { async openOptionsPage() { data.optionsCalls++; if (data.optionsError) throw new Error('failed'); } }
  };
  const controller = Popup.mount(document, chrome);
  return { nodes, data, document, chrome, controller };
}

test('state validation rejects malformed replies and bounds displayed width', () => {
  assert.equal(Popup.normalizeState(validState({ paneWidth: 1400, maxWidth: 800 })).paneWidth, 800);
  for (const response of [null, {}, { ok: false }, validState({ enabled: 1 }), validState({ maxWidth: 319 }),
    validState({ paneWidth: NaN }), validState({ visibleCount: -1 }), validState({ visibleCount: 4 }), validState({ hiddenPanes: {} })])
    assert.throws(() => Popup.normalizeState(response));
  const state = Popup.normalizeState(validState({ hiddenPanes: [null, { id: '' }, { id: 'x', title: '<img onerror=bad>' }, { id: 'x', title: 'duplicate' }, { id: 'y', title: '\n' }] }));
  assert.deepEqual(state.hiddenPanes, [{ id: 'x', title: '<img onerror=bad>' }, { id: 'y', title: '名前のない列' }]);
});

test('initial status queries active current-window ID without reading a URL', async () => {
  const h = harness();
  assert.equal(h.nodes['toggle-workspace'].disabled, true);
  await settle();
  assert.deepEqual(h.data.queries, [{ active: true, currentWindow: true }]);
  assert.deepEqual(h.data.calls[0], { tabId: 14, message: { type: 'CGWW_ACTION', action: 'status' } });
  assert.equal(h.nodes['pane-count'].textContent, '表示 2 / 全 3 列');
  assert.equal(h.nodes['pane-width'].value, '620');
  assert.equal(h.nodes['pane-width'].max, '920');
  assert.equal(h.nodes['toggle-workspace'].attributes['aria-pressed'], 'true');
  assert.equal(h.nodes['popup'].attributes['aria-busy'], 'false');
});

test('disable and enable update all controls from the returned state', async () => {
  const h = harness(); await settle();
  await h.nodes['toggle-workspace'].emit('click');
  assert.equal(h.data.calls.at(-1).message.action, 'disable');
  assert.equal(h.nodes['workspace-controls'].disabled, true);
  assert.equal(h.nodes['add-pane'].disabled, true);
  assert.equal(h.nodes['toggle-workspace'].disabled, false);
  await h.nodes['add-pane'].emit('click');
  assert.equal(h.data.calls.at(-1).message.action, 'disable');
  await h.nodes['toggle-workspace'].emit('click');
  assert.equal(h.data.calls.at(-1).message.action, 'enable');
  assert.equal(h.nodes['workspace-controls'].disabled, false);
});

test('new empty columns issue add and refresh the count', async () => {
  const h = harness(); await settle();
  await h.nodes['add-pane'].emit('click');
  assert.deepEqual(h.data.calls.at(-1).message, { type: 'CGWW_ACTION', action: 'add' });
  assert.equal(h.nodes['pane-count'].textContent, '表示 3 / 全 4 列');
  assert.match(h.nodes.status.textContent, /右端/);
});

test('width form supports native submit/Enter path, validates bounds and sends numeric value', async () => {
  const h = harness({ maxWidth: 780 }); await settle();
  for (const value of ['', 'abc', '319', '781', '400.5']) {
    h.nodes['pane-width'].value = value;
    const event = await h.nodes['width-form'].emit('submit');
    assert.equal(event.defaultPrevented, true);
    assert.equal(h.data.calls.length, 1);
    assert.equal(h.nodes.status.dataset.state, 'error');
  }
  assert.equal(h.nodes['pane-width'].focused, true);
  h.nodes['pane-width'].value = '720';
  await h.nodes['width-form'].emit('submit');
  assert.deepEqual(h.data.calls.at(-1).message, { type: 'CGWW_ACTION', action: 'width', value: 720 });
  assert.equal(h.nodes['pane-width'].value, '720');
});

test('equal checkbox toggles state and disables manual width until switched off', async () => {
  const h = harness(); await settle();
  h.nodes['equal-columns'].checked = true;
  await h.nodes['equal-columns'].emit('change');
  assert.deepEqual(h.data.calls.at(-1).message, { type: 'CGWW_ACTION', action: 'equal', value: true });
  assert.equal(h.nodes['pane-width'].disabled, true);
  assert.equal(h.nodes['apply-width'].disabled, true);
  await h.nodes['width-form'].emit('submit');
  assert.equal(h.data.calls.length, 2);
  h.nodes['equal-columns'].checked = false;
  await h.nodes['equal-columns'].emit('change');
  assert.equal(h.nodes['pane-width'].disabled, false);
});

test('URL form delegates validation to content handler and clears only on success', async () => {
  const h = harness(); await settle();
  h.nodes['chat-url'].value = '   ';
  const emptyEvent = await h.nodes['url-form'].emit('submit');
  assert.equal(emptyEvent.defaultPrevented, true);
  assert.equal(h.data.calls.length, 1);
  h.nodes['chat-url'].value = ' not-a-conversation ';
  h.data.response = { ok: false, error: '対応する会話URLではありません。' };
  await h.nodes['url-form'].emit('submit');
  assert.deepEqual(h.data.calls.at(-1).message, { type: 'CGWW_ACTION', action: 'addUrl', url: 'not-a-conversation' });
  assert.equal(h.nodes['chat-url'].value, ' not-a-conversation ');
  assert.equal(h.nodes.status.textContent, '対応する会話URLではありません。');
  delete h.data.response;
  h.nodes['chat-url'].value = ' /c/example-test ';
  await h.nodes['url-form'].emit('submit');
  assert.equal(h.nodes['chat-url'].value, '');
  assert.equal(h.nodes['pane-count'].textContent, '表示 3 / 全 4 列');
});

test('hidden list renders titles as text, restores selected ID via submit and disables when empty', async () => {
  const h = harness({ hiddenPanes: [{ id: 'hidden-1', title: '<script>alert(1)</script>' }] }); await settle();
  assert.equal(h.nodes['hidden-panes'].children[0].textContent, '<script>alert(1)</script>');
  const event = await h.nodes['restore-form'].emit('submit');
  assert.equal(event.defaultPrevented, true);
  assert.deepEqual(h.data.calls.at(-1).message, { type: 'CGWW_ACTION', action: 'restore', paneId: 'hidden-1' });
  assert.equal(h.nodes['restore-pane'].disabled, true);
  assert.equal(h.nodes['hidden-panes'].disabled, true);
  await h.nodes['restore-form'].emit('submit');
  assert.equal(h.data.calls.length, 2);
});

test('pending commands disable controls and reject repeated clicks without duplicate messages', async () => {
  const h = harness(); await settle();
  let release;
  h.data.waitResponse = new Promise(resolve => { release = resolve; });
  const first = h.nodes['add-pane'].emit('click');
  await settle();
  assert.equal(h.nodes['popup'].attributes['aria-busy'], 'true');
  assert.equal(h.nodes['toggle-workspace'].disabled, true);
  assert.equal(h.nodes['open-options'].disabled, true);
  await h.nodes['add-pane'].emit('click');
  await h.nodes['open-options'].emit('click');
  assert.equal(h.data.calls.length, 2);
  assert.equal(h.data.optionsCalls, 0);
  release(); await first;
  assert.equal(h.data.calls.length, 2);
  assert.equal(h.nodes['add-pane'].disabled, false);
});

test('unavailable tabs show recoverable error; options still opens and retry refreshes current tab ID', async () => {
  const h = harness(); h.data.sendError = true; await settle();
  assert.equal(h.nodes['workspace-controls'].disabled, true);
  assert.equal(h.nodes['retry-status'].hidden, false);
  assert.match(h.nodes.status.textContent, /ChatGPTの通常タブ/);
  assert.match(h.nodes.status.textContent, /未送信/);
  await h.nodes['open-options'].emit('click');
  assert.equal(h.data.optionsCalls, 1);
  h.data.sendError = false; h.data.tabId = 30;
  await h.nodes['retry-status'].emit('click');
  assert.equal(h.data.calls.at(-1).tabId, 30);
  assert.equal(h.nodes['workspace-controls'].disabled, false);
  assert.equal(h.nodes['retry-status'].hidden, true);
});

test('query failures, missing tabs and malformed responses do not leave popup busy', async () => {
  for (const failure of ['queryError', 'noTab', 'malformed']) {
    const h = harness(); await settle();
    if (failure === 'malformed') h.data.response = { ok: true }; else h.data[failure] = true;
    await h.controller.command('status');
    assert.equal(h.nodes['toggle-workspace'].disabled, true);
    assert.equal(h.nodes['open-options'].disabled, false);
    assert.equal(h.nodes['popup'].attributes['aria-busy'], 'false');
    assert.equal(h.nodes.status.dataset.state, 'error');
  }
});

test('options rejection is visible and does not corrupt workspace state', async () => {
  const h = harness(); await settle(); h.data.optionsError = true;
  await h.nodes['open-options'].emit('click');
  assert.equal(h.nodes.status.dataset.state, 'error');
  assert.equal(h.nodes['workspace-controls'].disabled, false);
  assert.equal(h.nodes['open-options'].disabled, false);
});

test('browser branch initializes with normal promise APIs and no CommonJS', async () => {
  const h = harness(); await settle();
  const context = vm.createContext({ document: h.document, chrome: h.chrome });
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../popup.js'), 'utf8'), context);
  await settle();
  assert.equal(h.data.calls.at(-1).message.action, 'status');
  assert.equal(h.nodes['pane-count'].textContent, '表示 2 / 全 3 列');
});

test('static popup is CSP-compatible, accessible, and uses native forms rather than inline handlers', () => {
  const html = fs.readFileSync(path.join(__dirname, '../popup.html'), 'utf8');
  const css = fs.readFileSync(path.join(__dirname, '../popup.css'), 'utf8');
  const js = fs.readFileSync(path.join(__dirname, '../popup.js'), 'utf8');
  assert.match(html, /<html lang="ja">/);
  assert.match(html, /src="popup.js" defer/);
  assert.match(html, /href="popup.css"/);
  assert.doesNotMatch(html, /<style|style=|\son\w+=|<script(?![^>]*\bsrc=)/i);
  assert.doesNotMatch(css, /https?:\/\/|@import/);
  assert.doesNotMatch(js, /innerHTML|fetch\(|XMLHttpRequest|sessionStorage|localStorage|\.url\b/);
  for (const id of ['width-form', 'url-form', 'restore-form']) assert.match(html, new RegExp(`<form id="${id}"`));
  for (const id of ['pane-width', 'chat-url', 'hidden-panes']) assert.match(html, new RegExp(`for="${id}"`));
  assert.match(html, /role="status"/);
  assert.match(html, /候補版/);
  assert.match(html, /別端末との同期を保証するものではありません/);
});
