const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const source = fs.readFileSync(require.resolve('../extension/workspace.js'), 'utf8');
// Source-contract checks only. Rendered geometry is a separate browser check.
test('pane controls share a 24px centered target and consistent neutral styling', () => {
  const css = source.match(/\.pane-control\{([^}]+)\}/)?.[1];
  for (const rule of ['display:inline-flex', 'align-items:center', 'justify-content:center', 'height:24px', 'min-width:24px', 'border:1px solid transparent', 'line-height:1']) assert.ok(css.includes(rule), rule);
  for (const name of ['drag-grip', 'pane-reload', 'pane-close']) assert.ok(source.includes(`'pane-control ${name}'`));
  assert.match(source, /\.drag-grip\{width:24px;/);
  assert.match(source, /\.pane-close\{width:24px;/);
});
test('monochrome close and editable title have explicit accessible names', () => {
  assert.ok(source.includes("const closeButton=button('×'"));
  assert.ok(source.includes("closeButton.setAttribute('aria-label','この列を閉じる')"));
  assert.ok(source.includes("title.setAttribute('aria-label', '列の表示名')"));
  assert.ok(!source.includes('❌'));
  assert.match(source, /button:focus-visible,input:focus-visible\{outline:2px solid/);
});
test('alignment preserves the 32px header and content resize boundary', () => {
  assert.match(source, /\.pane-head\{height:32px;min-height:32px;/);
  assert.match(source, /\.pane-title\{[^}]*height:24px;/);
  assert.match(source, /\.resize\{[^}]*top:32px;/);
  assert.ok(source.includes("root.hidden = true;"));
  assert.ok(source.includes("setStatus('列を非表示にしました。iframeは保持されています。')"));
});
