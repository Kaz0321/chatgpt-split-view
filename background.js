/* Open only validated chat URLs, in the invoking tab's window. */
importScripts('core.js');
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if(!['CGWW_OPEN_IN_TAB','CGWW_OPEN_OPTIONS'].includes(message?.type))return;
  if(message.type==='CGWW_OPEN_OPTIONS'){
    if(!sender?.tab?.id||sender.frameId!==0||!sender.url?.startsWith('https://chatgpt.com/')){sendResponse({ok:false});return;}
    chrome.runtime.openOptionsPage().then(()=>sendResponse({ok:true})).catch(()=>sendResponse({ok:false}));return true;
  }
  const url = globalThis.CGWWCore.chatUrl(message.url);
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
