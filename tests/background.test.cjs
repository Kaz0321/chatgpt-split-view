const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const ROOT = path.resolve(__dirname, '..', 'extension');
function makeRuntime() {
  let callback;
  const opened = [];
  let optionsOpened=0;
  const sandbox = {
    URL,
    chrome: {
      runtime: { async openOptionsPage(){optionsOpened++;}, onMessage: { addListener(fn) { callback = fn; } } },
      tabs: { async create(params) { opened.push(params); return { id: 7 }; } }
    }
  };
  sandbox.globalThis = sandbox;
  const context = vm.createContext(sandbox);
  sandbox.importScripts = (name) => vm.runInContext(fs.readFileSync(path.join(ROOT, name), 'utf8'), context);
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'background.js'), 'utf8'), context);
  return { opened, get optionsOpened(){return optionsOpened;}, invoke(message, sender) {
    return new Promise((resolve) => callback(message, sender, resolve));
  } };
}
const sender = { tab: { id: 10, windowId: 21 }, frameId: 0, url: 'https://chatgpt.com/c/abcdefgh' };
test('external-open command creates TAB in original browser window', async () => {
  const r = makeRuntime();
  const result = await r.invoke({ type: 'CGWW_OPEN_IN_TAB', url: 'https://chatgpt.com/local/abcdefgh?hostId=local' }, sender);
  assert.equal(result.ok, true);
  assert.equal(r.opened.length, 1);
  assert.equal(r.opened[0].windowId, 21);
  assert.equal(r.opened[0].url, 'https://chatgpt.com/local/abcdefgh?hostId=local');
  assert.equal(r.opened[0].openerTabId, 10);
});
test('invalid URL, external initiator and iframe initiator cannot create tabs', async () => {
  const r = makeRuntime();
  for (const [url, from] of [
    ['https://evil.test/c/abcdefgh', sender],
    ['https://chatgpt.com/c/abcdefgh', {...sender, frameId: 3}],
    ['https://chatgpt.com/c/abcdefgh', {...sender, url: 'https://evil.test/'}],
  ]) {
    const response = await r.invoke({ type: 'CGWW_OPEN_IN_TAB', url }, from);
    assert.equal(response.ok, false);
  }
  assert.equal(r.opened.length, 0);
});

test('top ChatGPT tab can open extension options without creating a conversation tab',async()=>{const r=makeRuntime();const result=await r.invoke({type:'CGWW_OPEN_OPTIONS'},sender);assert.equal(result.ok,true);assert.equal(r.optionsOpened,1);assert.equal(r.opened.length,0);});
test('iframe initiator cannot open extension options',async()=>{const r=makeRuntime();const result=await r.invoke({type:'CGWW_OPEN_OPTIONS'},{...sender,frameId:7});assert.equal(result.ok,false);assert.equal(r.optionsOpened,0);});
