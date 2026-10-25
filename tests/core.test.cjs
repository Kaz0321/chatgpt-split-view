const test = require('node:test');
const assert = require('node:assert/strict');
const C = require('../core.js');

test('only ChatGPT conversation URLs pass', () => {
  assert.equal(C.chatUrl('https://chatgpt.com/c/abcdef12-34'), 'https://chatgpt.com/c/abcdef12-34');
  assert.equal(C.chatUrl('https://chatgpt.com/g/g-name/c/abcdef12?q=private'), 'https://chatgpt.com/g/g-name/c/abcdef12');
  assert.equal(C.chatUrl('https://chatgpt.com/local/fixture-local-thread-0001'),
    'https://chatgpt.com/local/fixture-local-thread-0001');
  assert.equal(C.chatUrl('https://chatgpt.com/local/abcdefff?hostId=local&token=danger'),
    'https://chatgpt.com/local/abcdefff?hostId=local');
  assert.equal(C.chatUrl('https://chatgpt.com/g/g-example/c/abcdefghi'), 'https://chatgpt.com/g/g-example/c/abcdefghi');
  for (const u of ['https://chatgpt.com/else/c/abcdef123', 'https://evil.example/c/abcdef12', 'javascript:alert(1)', 'https://chatgpt.com/','https://chatgpt.com/share/abc','https://chatgpt.com@evil.test/c/abcdef12']) {
    assert.equal(C.chatUrl(u), null, u);
  }
});

test('settings are bounded, privacy-preserving and typed', () => {
  assert.deepEqual(C.normalizeSettings({sidebarWidth: -30, paneWidth:99999, interceptSidebar:'true'}), {
    sidebarWidth: 180, paneWidth:1400, interceptSidebar:true, hideFrameSidebar:true, equalizeColumns:false, keepMasterSidebar:true
  });
  assert.equal(C.normalizeTitle('<script>Title</script>'), '<script>Title</script>'); // textContent used by renderer, never innerHTML
});

test('import rejects foreign and unsupported versions', () => {
  assert.throws(() => C.importConfig({kind:'Other', schemaVersion:1}));
  assert.throws(() => C.importConfig({kind:'ChatGPTWideWorkspaceSettings',schemaVersion:2}));
  const result = C.importConfig({kind:'ChatGPTWideWorkspaceSettings',schemaVersion:1, settings:{paneWidth:720},panes:[
    {url:'https://chatgpt.com/c/abcdef123', title:'fixture-title'},
    {url:'https://chatgpt.com/c/abcdef123', title:'duplicate'},
    {url:'https://attacker.test/c/abcdef123', title:'blocked'}
  ]});
  assert.equal(result.panes.length, 1);
  assert.equal(result.panes[0].title, 'fixture-title');
  assert.equal(result.settings.paneWidth,720);
});


test('session restore keeps empty columns, duplicate views and visibility', () => {
  const panes = C.normalizeSessionPanes([
    {url: null, title:'待機列', visible:true},
    {url:'https://chatgpt.com/c/abcdef123',title:'A',visible:false},
    {url:'https://chatgpt.com/c/abcdef123',title:'A copy',visible:true},
    {url:'https://attacker.example/c/abcdef123',title:'unsafe'}
  ]);
  assert.equal(panes.length,3);
  assert.equal(panes[0].url,null);
  assert.equal(panes[1].visible,false);
  assert.equal(panes[2].title,'A copy');
});


test('extension keeps least-privilege manifest settings', () => {
  const manifest = require('../manifest.json');
  assert.equal(manifest.manifest_version, 3);
  assert.deepEqual(manifest.permissions, ['storage']);
  assert.equal(manifest.background.service_worker, 'background.js');
  assert.deepEqual(manifest.content_scripts[0].matches, ['https://chatgpt.com/*']);
  assert.equal(manifest.content_scripts[0].all_frames, false);
});


test('equal columns fill available width, respect original cap and scroll below minimum', () => {
  assert.equal(C.calculateEqualWidth(1100, 2, 920), 537);
  assert.equal(C.calculateEqualWidth(2300, 2, 920), 920);
  assert.equal(C.calculateEqualWidth(700, 3, 920), 320);
  assert.equal(C.normalizeSettings({equalizeColumns:true, keepMasterSidebar:false}).equalizeColumns,true);
  assert.equal(C.normalizeSettings({equalizeColumns:'yes'}).equalizeColumns,false);
});
