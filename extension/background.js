/* Open only validated chat URLs, in the invoking tab's window. */
importScripts('core.js');
importScripts('persistence.js');
importScripts('windows.js');
let windowStore;
let workspaceStore;
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if(message?.type==='CGWW_WINDOW'){
    windowStore ||= globalThis.CGWWWindows.create(chrome);
    windowStore.handle(message,sender).then(sendResponse).catch(e=>sendResponse({ok:false,error:e.message}));return true;
  }
  if(message?.type==='CGWW_WORKSPACE'){
    if(!sender?.tab?.id||sender.frameId!==0||!sender.url?.startsWith('https://chatgpt.com/')){sendResponse({ok:false});return;}
    workspaceStore ||= globalThis.CGWWPersistence.create(chrome.storage);
    const host=globalThis.CGWWCore.chatUrl(sender.url)||new URL(sender.url).origin+new URL(sender.url).pathname;
    workspaceStore.handle(message,sender.tab.id,host).then(sendResponse).catch(()=>sendResponse({ok:false,error:'作業状態を保存・読み込みできませんでした。'}));return true;
  }
  if(!['CGWW_OPEN_IN_TAB','CGWW_OPEN_OPTIONS'].includes(message?.type))return;
  if(message.type==='CGWW_OPEN_OPTIONS'){
    if(!sender?.tab?.id||sender.frameId!==0||!sender.url?.startsWith('https://chatgpt.com/')){sendResponse({ok:false});return;}
    chrome.runtime.openOptionsPage().then(()=>sendResponse({ok:true})).catch(()=>sendResponse({ok:false}));return true;
  }
  const url = globalThis.CGWWCore.paneUrl(message.url);
  if (!url || !sender?.tab?.id || sender.frameId !== 0 ||
      !sender.url?.startsWith('https://chatgpt.com/')) {
    sendResponse({ ok: false });
    return;
  }
  chrome.tabs.create({ url, active: true, windowId: sender.tab.windowId, openerTabId: sender.tab.id })
    .then(() => sendResponse({ ok: true }))
    .catch(() => sendResponse({ ok: false }));
  return true;
});
chrome.tabs.onRemoved?.addListener(tabId=>{workspaceStore ||= globalThis.CGWWPersistence.create(chrome.storage);workspaceStore.release(tabId).catch(()=>{});});
