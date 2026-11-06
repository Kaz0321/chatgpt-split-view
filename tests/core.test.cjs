const test = require('node:test');
const assert = require('node:assert/strict');
const C = require('../extension/core.js');

test('native width migration and lock remain typed and survive workspace restoration',()=>{
 assert.equal(C.normalizeSettings().nativePaneWidth,true);assert.equal(C.normalizeSettings({paneWidth:620}).nativePaneWidth,true);assert.equal(C.normalizeSettings({paneWidth:500}).nativePaneWidth,false);assert.equal(C.normalizeSettings({sidebarLocked:'true'}).sidebarLocked,false);
 const p=C.restoreWorkspacePanes([{url:C.ORIGIN+'/',newChat:true,autoWidth:true,width:794,visible:false,draft:'keep'}],()=> 'id')[0];assert.equal(p.autoWidth,true);assert.equal(p.visible,false);assert.equal(p.draft,'keep');
});

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
    sidebarVisible:true, sidebarLocked:false, nativePaneWidth:false, contentPadding:12, sidebarWidth: 180, paneWidth:1400, interceptSidebar:true, hideFrameSidebar:true, equalizeColumns:false, keepMasterSidebar:true
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
  const manifest = require('../extension/manifest.json');
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


test('GPT landing URLs remain distinct from conversations and normalize resource identity',()=>{
 const url='https://chatgpt.com/g/g-h8l4uLHFQ-video-ai-by-invideo';
 assert.equal(C.chatUrl(url),null);assert.equal(C.paneUrl(url+'/?x=1#section'),url);
 assert.equal(C.paneKey(url),C.paneKey('/g/g-h8l4uLHFQ-renamed'));
 assert.notEqual(C.paneKey(url),C.paneKey('/c/h8l4uLHFQ'));
 assert.notEqual(C.paneKey(url),C.paneKey(url+'/c/thread123'));
 assert.equal(C.paneKey(url+'/c/thread123'),C.conversationKey('/c/thread123'));
 for(const invalid of ['/g','/g/g-xx','/g/g-abc/editor','/skills','https://evil.test/g/g-abc','https://user@chatgpt.com/g/g-abc'])assert.equal(C.paneUrl(invalid),null);
 const raw=[{id:'gpt',url,draft:'keep',folded:true},{id:'other',url:'/g/g-h8l4uLHFQ-renamed'},{id:'chat',url:url+'/c/thread123'},{id:'fresh',url:C.ORIGIN+'/',newChat:true}];
 const restored=C.restoreWorkspacePanes(raw,()=> 'generated');assert.equal(restored.length,3);assert.equal(restored[0].draft,'keep');assert.equal(restored[0].folded,true);assert.equal(restored[2].newChat,true);
 assert.deepEqual(C.restoreWorkspacePanes(restored,()=> 'generated'),restored);
});


test('GPT routing is generic across IDs, optional slugs, query strings and trailing slashes',()=>{
 const examples=[
  ['/g/g-Other123','gpt:Other123'],
  ['/g/g-Other123-another-gpt','gpt:Other123'],
  ['/g/g-0123456789abcdef0123456789abcdef-tool_name','gpt:0123456789abcdef0123456789abcdef'],
  ['/g/g-Third456-name-with-many-hyphens','gpt:Third456']
 ];
 for(const [path,key] of examples){
  assert.equal(C.paneUrl(path+'/?utm_source=test#section'),C.ORIGIN+path);
  assert.equal(C.paneKey(path),key);
  assert.equal(C.paneKey(path+'?model=example'),key);
 }
 assert.notEqual(C.paneKey(examples[0][0]),C.paneKey(examples[3][0]));
 assert.notEqual(C.paneKey('/g/g-Other123'),C.paneKey('/g/g-other123'));
 assert.equal(C.paneUrl('/g/g-Other123-another-gpt/c/thread456?x=1'),C.ORIGIN+'/g/g-Other123-another-gpt/c/thread456');
 assert.equal(C.paneKey('/g/g-Other123-another-gpt/c/thread456'),C.paneKey('/c/thread456'));
});

test('GPT support does not turn arbitrary ChatGPT destinations into panes',()=>{
 for(const path of ['/skills','/plugins','/gpts','/gpts/editor','/settings','/library','/share/thread456','/project/project123','/g/g-Other123/edit','/g/g-Other123/c/short'])assert.equal(C.paneUrl(path),null,path);
 assert.equal(C.newChatUrl('/'),C.ORIGIN+'/');assert.equal(C.paneKey('/'),null);
});
