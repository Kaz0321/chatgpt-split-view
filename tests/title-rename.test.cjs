const test = require('node:test');
const assert = require('node:assert/strict');
const { savedKey, rename } = require('../extension/title-rename.js');

// Deliberately small DOM doubles: selectors, bubbling, native value setter and
// visibility are modeled; no timers, browser dependencies, or network are used.
function fixture(options = {}) {
  let doc;
  const log = [];
  function matches(el, selector) {
    const tag = selector.match(/^[a-z]+/i)?.[0];
    if (tag && el.tag !== tag) return false;
    return [...selector.matchAll(/\[([^=\]]+)(?:="([^"]*)")?\]/g)].every(([, k, v]) =>
      el.getAttribute(k) !== null && (v === undefined || el.getAttribute(k) === v));
  }
  class Element {
    constructor(tag = 'div', attrs = {}, text = '') {
      this.tag = tag; this.attrs = attrs; this.textContent = text;
      this.children = []; this.hidden = false; this.ownerDocument = doc;
      this.disabled = false; this.readOnly = false;
    }
    get id() { return this.attrs.id || ''; }
    get href() { return this.attrs.href; }
    get type() { return this.attrs.type || ''; }
    get isConnected() { return this === doc.root || !!this.parent?.isConnected; }
    getAttribute(k) { return this.attrs[k] ?? null; }
    append(...nodes) { for (const node of nodes) { node.parent = this; this.children.push(node); } }
    remove() { if (this.parent) this.parent.children = this.parent.children.filter(x => x !== this); this.parent = null; }
    contains(el) { return el === this || this.children.some(c => c.contains(el)); }
    querySelectorAll(selector) {
      const result = [];
      for (const child of this.children) {
        if (selector.split(',').some(s => matches(child, s))) result.push(child);
        result.push(...child.querySelectorAll(selector));
      }
      return result;
    }
    closest(selector) { return matches(this, selector) ? this : (this.parent?.closest(selector) ?? null); }
    getClientRects() { return this.hidden ? [] : [{}]; }
    cloneNode() { const copy = new Element(this.tag, { ...this.attrs }, this.textContent); copy.append(...this.children.map(c => c.cloneNode())); return copy; }
    focus() { log.push('focus'); doc.activeElement = this; options.onFocus?.(h); }
    dispatchEvent(event) {
      log.push(`${this.tag}:${event.type}`);
      this.onEvent?.(event);
      if (event.bubbles) doc.emit(event.type, event);
      return true;
    }
    click() { log.push(`${this.tag}:click`); this.onClick?.(); }
  }
  class Input extends Element {
    get value() { return this._value; }
    set value(value) { log.push('set:value'); this._value = value; }
  }
  class Event {
    constructor(type, init = {}) { Object.assign(this, init, { type, isTrusted: false }); }
  }
  doc = {
    location: { href: 'https://chatgpt.com/c/fixture001' }, listeners: new Map(),
    defaultView: { Event, KeyboardEvent: Event, HTMLInputElement: Input, getComputedStyle: el => ({ visibility: el.visibility || 'visible', display: 'block' }) },
    addEventListener(type, listener) { if (!this.listeners.has(type)) this.listeners.set(type, new Set()); this.listeners.get(type).add(listener); },
    removeEventListener(type, listener) { this.listeners.get(type)?.delete(listener); },
    emit(type, event = { isTrusted: true }) { for (const listener of this.listeners.get(type) || []) listener(event); },
    querySelectorAll(selector) {
      if (selector.startsWith('header[')) return this.root.querySelectorAll('header').filter(e => e.attrs['data-app-shell-titlebar'] === 'true' && e.attrs['data-app-shell-header-layout'] === 'thread-edge-scroll').flatMap(e => e.querySelectorAll('button[aria-haspopup="menu"]'));
      return this.root.querySelectorAll(selector);
    },
    getElementById(id) { return this.root.querySelectorAll('[id]').find(el => el.id === id); }
  };
  doc.root = new Element('body');
  const row = new Element('section', { role: 'group', 'aria-label': 'Old title', 'aria-current': 'page' });
  const link = new Element('a', { href: doc.location.href }, 'Old title');
  const trigger = new Element('button', { id: 'title-trigger', 'aria-haspopup': 'menu' }, 'Old title');
  row.append(link, trigger); doc.root.append(row);
  const menu = new Element('div', { role: 'menu', 'aria-labelledby': trigger.id });
  const item = new Element('div', { role: 'menuitem' }, 'Rename'); menu.append(item);
  const dialog = new Element('div', { role: 'dialog', 'aria-labelledby': 'rename-heading' });
  const heading = new Element('h2', { id: 'rename-heading' }, 'Rename chat');
  const form = new Element('form');
  const input = new Input('input', { type: 'text', 'aria-label': 'Chat title' }); input._value = 'Old title';
  const save = new Element('button', { type: 'submit' }, 'Save');
  form.append(input, save); dialog.append(heading, form);
  const h = { doc, row, link, trigger, menu, item, dialog, heading, form, input, save, log, Element, valid: true, ticks: 0 };
  trigger.onEvent = event => { if (event.key === 'Enter') { log.push('open:menu'); if (!options.noMenu) doc.root.append(menu); options.onMenu?.(h); } };
  item.onClick = () => { log.push('open:dialog'); menu.remove(); if (!options.noDialog) doc.root.append(dialog); options.onDialog?.(h); };
  save.onClick = () => { log.push('save'); if (!options.noAck) { dialog.remove(); row.attrs['aria-label'] = input.value; link.textContent = input.value; } options.onSave?.(h); };
  h.run = (extra = {}) => rename({ doc, key: 'chat:fixture001', title: 'New title', valid: () => h.valid, readTitle: () => link.textContent, delay: async () => { h.ticks++; await options.onDelay?.(h); }, ...extra });
  h.clean = () => assert.equal([...doc.listeners.values()].reduce((n, s) => n + s.size, 0), 0);
  return h;
}
async function rejected(h, message, submitted = false) {
  await assert.rejects(h.run(), error => { assert.match(error.message, message); assert.equal(error.submitted, submitted); return true; });
  h.clean();
  if (!submitted) { assert.equal(h.log.includes('set:value'), false); assert.equal(h.log.includes('save'), false); }
}

test('savedKey admits saved first-party chats and rejects non-chat/provisional/foreign URLs', () => {
  assert.equal(savedKey('/c/fixture001?ignored=yes#hash'), 'chat:fixture001');
  assert.equal(savedKey('/c/ABCDEFAB-1234-1234-1234-ABCDEFABCDEF/'), 'chat:abcdefab-1234-1234-1234-abcdefabcdef');
  for (const value of ['/', '/?temporary-chat=true', '/new', '/draft/fixture001', '/project/fixture001', '/g/g-example', '/g/g-example/c/fixture001', '/local/fixture001', '/c/local-chatgpt%3A12345678-1234-1234-1234-123456789abc', '/c/local-chatgpt-123456', '/c/short', 'https://example.com/c/fixture001', 'http://chatgpt.com/c/fixture001', 'https://user@chatgpt.com/c/fixture001', 'javascript:alert(1)']) assert.equal(savedKey(value), null, value);
});
test('successful rename uses Enter, fresh menu/dialog, native value events and exact row acknowledgement', async () => {
  const h = fixture(); await h.run(); h.clean();
  assert.deepEqual(h.log, ['focus', 'button:keydown', 'open:menu', 'div:click', 'open:dialog', 'set:value', 'input:input', 'input:change', 'button:click', 'save']);
  assert.equal(h.row.attrs['aria-label'], 'New title');
});
test('verified project saved routes share canonical chat identity, including slug and UUID normalization', () => {
  const project = '/g/g-p-1234567890abcdef1234567890abcdef';
  for (const prefix of [project, project + '-my-project']) {
    assert.equal(savedKey(prefix + '/c/fixture001'), savedKey('/c/fixture001'));
    assert.equal(savedKey('https://chatgpt.com' + prefix + '/c/ABCDEFAB-1234-1234-1234-ABCDEFABCDEF/?x=1#hash'), savedKey('/c/abcdefab-1234-1234-1234-abcdefabcdef'));
  }
  for (const value of [project, project + '/project', project + '/c/short', project + '/c/local-chatgpt-123456', project + '/c/local-chatgpt%3A12345678-1234-1234-1234-123456789abc', '/g/g-p-123456/c/fixture001', '/g/g-example/c/fixture001', '/g/g-p-zzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzz/c/fixture001']) assert.equal(savedKey(value), null, value);
});
test('project page can rename a canonical sidebar alias inside a parent project group', async () => {
  for (const suffix of ['', '-my-project']) {
    const h = fixture();
    h.doc.location.href = 'https://chatgpt.com/g/g-p-1234567890abcdef1234567890abcdef' + suffix + '/c/fixture001';
    const parent = new h.Element('section', { role: 'group', 'aria-label': 'Project group' });
    h.row.remove(); parent.append(h.row); h.doc.root.append(parent);
    assert.equal(h.link.closest('[role="group"][aria-label]'), h.row);
    assert.equal(h.link.href, 'https://chatgpt.com/c/fixture001');
    await h.run(); h.clean();
    assert.equal(h.row.attrs['aria-label'], 'New title');
    assert.equal(parent.attrs['aria-label'], 'Project group');
    assert.equal(h.log.filter(x => x === 'save').length, 1);
  }
});
test('identical title is a clean no-op', async () => { const h = fixture(); await h.run({ title: 'Old title' }); assert.deepEqual(h.log, []); h.clean(); });
test('target row must have exactly one matching saved conversation and be unique', async () => {
  for (const mode of ['missing', 'duplicate', 'two-links']) {
    const h = fixture();
    if (mode === 'missing') h.link.attrs.href = '/c/another001';
    if (mode === 'duplicate') { const row = new h.Element('div', { role: 'group', 'aria-label': 'Old title' }); row.append(new h.Element('a', { href: h.doc.location.href })); h.doc.root.append(row); }
    if (mode === 'two-links') h.row.append(new h.Element('a', { href: h.doc.location.href }));
    await rejected(h, /ambiguous/); assert.deepEqual(h.log, []);
  }
});
test('mismatched and ambiguous menus cannot reach the editor', async () => {
  for (const mode of ['mismatch', 'duplicate', 'duplicate-item', 'wrong-item', 'disabled-item']) {
    const h = fixture({ onMenu(h) {
      if (mode === 'mismatch') h.menu.attrs['aria-labelledby'] = 'other-trigger';
      if (mode === 'duplicate') h.doc.root.append(new h.Element('div', { role: 'menu', 'aria-labelledby': h.trigger.id }));
      if (mode === 'duplicate-item') h.menu.append(new h.Element('div', { role: 'menuitem' }, 'Rename'));
      if (mode === 'wrong-item') h.item.textContent = 'Rename something else';
      if (mode === 'disabled-item') h.item.attrs['aria-disabled'] = 'true';
    } });
    await rejected(h, mode === 'mismatch' ? /timeout/ : /ambiguous/); assert.equal(h.log.includes('open:dialog'), false);
  }
});
test('dialog requires one exact owned heading, one labeled input, old value and owned submit', async () => {
  for (const mode of ['wrong-heading', 'external-heading', 'multiple-heading-ids', 'duplicate-dialog', 'wrong-input', 'wrong-value', 'readonly', 'no-form', 'duplicate-save', 'wrong-save']) {
    const h = fixture({ onDialog(h) {
      if (mode === 'wrong-heading') h.heading.textContent = 'Rename';
      if (mode === 'external-heading') { h.heading.remove(); h.doc.root.append(h.heading); }
      if (mode === 'multiple-heading-ids') h.dialog.attrs['aria-labelledby'] += ' another-heading';
      if (mode === 'duplicate-dialog') { const copy = h.dialog.cloneNode(); copy.attrs['aria-labelledby'] = 'second-heading'; copy.children[0].attrs.id = 'second-heading'; h.doc.root.append(copy); }
      if (mode === 'wrong-input') h.input.attrs['aria-label'] = 'Name';
      if (mode === 'wrong-value') h.input._value = 'Another title';
      if (mode === 'readonly') h.input.readOnly = true;
      if (mode === 'no-form') { h.input.remove(); h.dialog.append(h.input); }
      if (mode === 'duplicate-save') h.form.append(h.save.cloneNode());
      if (mode === 'wrong-save') h.save.textContent = 'Save anything';
    } });
    await rejected(h, /timeout|ambiguous|context/);
  }
});
test('already-open menu or rename dialog is not borrowed', async () => {
  for (const existing of ['menu', 'dialog']) { const h = fixture(); h.doc.root.append(h[existing]); await rejected(h, /busy/); assert.deepEqual(h.log, []); }
});
test('an existing hidden dialog becoming visible is not borrowed', async () => {
  const h = fixture({ noDialog: true, onDialog(h) { h.dialog.hidden = false; } });
  h.dialog.hidden = true; h.doc.root.append(h.dialog); await rejected(h, /timeout/);
});
test('trusted user input, navigation and invalid context interrupt waits without editing', async () => {
  for (const stage of ['menu', 'dialog']) for (const interrupt of ['pointerdown', 'keydown', 'input', 'navigation', 'invalid']) {
    const h = fixture({ noMenu: stage === 'menu', noDialog: stage === 'dialog', onDelay(h) {
      if (interrupt === 'navigation') h.doc.location.href = 'https://chatgpt.com/c/another001';
      else if (interrupt === 'invalid') h.valid = false;
      else h.doc.emit(interrupt);
    } });
    await rejected(h, /context/); assert.equal(h.ticks, 1);
  }
});
test('no acknowledgement is bounded and carries submitted flag; exact row and closed dialog both required', async () => {
  for (const mode of ['open-dialog', 'old-title', 'wrong-row']) {
    const h = fixture({ noAck: true, onSave(h) {
      if (mode === 'open-dialog') h.row.attrs['aria-label'] = 'New title';
      else h.dialog.remove();
      if (mode === 'wrong-row') { const row = new h.Element('div', { role: 'group', 'aria-label': 'New title' }); row.append(new h.Element('a', { href: '/c/another001' })); h.doc.root.append(row); }
    } });
    await rejected(h, /timeout/, true); assert.equal(h.ticks, 160); assert.equal(h.log.filter(x => x === 'save').length, 1);
  }
});
test('trusted interruption during native edit never clicks Save and carries uncertain outcome', async () => {
  const h = fixture(); h.input.onEvent = () => h.doc.emit('input'); await rejected(h, /context/, true); assert.equal(h.log.includes('save'), false);
});
test('navigation and trusted user activity during acknowledgement do not retry submitted rename', async () => {
  for (const interrupt of ['navigation', 'input', 'invalid']) {
    const h = fixture({ noAck: true, onDelay(h) {
      if (interrupt === 'navigation') h.doc.location.href = 'https://chatgpt.com/c/another001';
      else if (interrupt === 'invalid') h.valid = false;
      else h.doc.emit('input');
    } });
    await rejected(h, /context/, true);
    assert.equal(h.log.filter(x => x === 'save').length, 1);
    assert.equal(h.log.filter(x => x === 'set:value').length, 1);
  }
});
test('trigger identity, availability and uniqueness are proved before focus', async () => {
  for (const mode of ['missing-id', 'disabled', 'duplicate']) {
    const h = fixture();
    if (mode === 'missing-id') delete h.trigger.attrs.id;
    if (mode === 'disabled') h.trigger.disabled = true;
    if (mode === 'duplicate') h.row.append(h.trigger.cloneNode());
    await rejected(h, /unavailable|ambiguous/); assert.deepEqual(h.log, []);
  }
});
test('context is rechecked after focus before opening the native menu', async () => {
  const h = fixture({ onFocus(h) { h.doc.emit('pointerdown'); } });
  await rejected(h, /context/); assert.deepEqual(h.log, ['focus']);
});
test('row acknowledgement cannot substitute for the existing sidebar title reader', async () => {
  const h = fixture({ onSave(h) { h.link.textContent = 'Old title'; } });
  await rejected(h, /timeout/, true); assert.equal(h.row.attrs['aria-label'], 'New title');
  const equal = fixture(); equal.row.attrs['aria-label'] = 'New title';
  await rejected(equal, /unconfirmed/); assert.deepEqual(equal.log, []);
});
test('document lock excludes concurrent work, is per-document and cleans up after failure', async () => {
  let resume; const h = fixture({ noMenu: true });
  const first = h.run({ delay: () => new Promise(resolve => { resume = resolve; }) });
  await assert.rejects(h.run(), /unavailable/);
  const other = fixture(); await other.run(); other.clean();
  h.valid = false; resume(); await assert.rejects(first, /context/); h.clean();
  h.valid = true; h.trigger.onEvent = () => h.doc.root.append(h.menu);
  await h.run(); h.clean(); assert.equal(h.row.attrs['aria-label'], 'New title');
});
test('current header fallback requires exact old title and never reveals hidden sidebar', async () => {
  for (const mode of ['match', 'mismatch', 'not-current', 'ambiguous']) {
    const h = fixture(); h.trigger.hidden = true;
    const header = new h.Element('header', { 'data-app-shell-titlebar': 'true', 'data-app-shell-header-layout': 'thread-edge-scroll' });
    const button = new h.Element('button', { id: 'header-title', 'aria-haspopup': 'menu' }, mode === 'mismatch' ? 'Other title' : 'Old title');
    button.onEvent = () => { h.menu.attrs['aria-labelledby'] = button.id; h.doc.root.append(h.menu); };
    header.append(button); h.doc.root.append(header);
    if (mode === 'not-current') delete h.row.attrs['aria-current'];
    if (mode === 'ambiguous') header.append(button.cloneNode());
    if (mode === 'match') { await h.run(); h.clean(); } else await rejected(h, /ambiguous|unavailable/);
    assert.equal(h.trigger.hidden, true);
  }
});
