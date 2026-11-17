chrome.action.onClicked.addListener(() => { chrome.tabs.create({url: chrome.runtime.getURL('index.html')}); });

// A reload check carries only a summary and an ID digest in service-worker memory.
// Bind the one-use grant to the tab, the same pathname, and a new document.
const reloadChecks = new Map();
chrome.tabs.onRemoved.addListener(tabId => reloadChecks.delete(tabId));

function reloadCheck(message, sender, reply) {
  if (sender.id !== chrome.runtime.id || sender.frameId !== 0 || !Number.isInteger(sender.tab?.id) ||
      typeof sender.documentId !== 'string' || !sender.url) return;
  const url = new URL(sender.url);
  if (url.origin !== 'https://chatgpt.com') return;
  const tab = sender.tab.id;
  const previous = reloadChecks.get(tab);
  if (message.action === 'arm') {
    if (!/^\/c\/[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}\/?$/i.test(url.pathname)) return;
    if (!/^[a-f0-9]{64}$/.test(message.before?.orderedIds ?? '')) return;
    if (!previous && reloadChecks.size >= 16) return reply({ok: false});
    const check = {path: url.pathname, documentId: sender.documentId, before: message.before, expires: Date.now() + 20_000};
    reloadChecks.set(tab, check);
    setTimeout(() => { if (reloadChecks.get(tab) === check) reloadChecks.delete(tab); }, 20_000);
    return reply({ok: true});
  }
  if (!previous) return;
  if (message.action === 'cancel' && previous.documentId === sender.documentId) reloadChecks.delete(tab);
  if (!['discard', 'take'].includes(message.action) || previous.documentId === sender.documentId) return;
  reloadChecks.delete(tab);
  if (message.action === 'take' && previous.path === url.pathname && previous.expires > Date.now()) return reply({before: previous.before});
}

chrome.runtime.onMessage.addListener((message, sender, reply) => {
  if (message?.channel === 'conversation-map-reload-check') return reloadCheck(message, sender, reply);
  if (message?.channel !== 'conversation-map-live-ui' ||
      sender.id !== chrome.runtime.id || !/^[0-9a-f-]{36}$/.test(message.panel ?? '') ||
      sender.url !== chrome.runtime.getURL(`index.html?mode=live&panel=${message.panel}`) ||
      !(sender.frameId > 0) || !Number.isInteger(sender.tab?.id)) return;
  chrome.tabs.sendMessage(sender.tab.id, {
    ...message, channel: 'conversation-map-live-tab',
  }, {frameId: 0}).then(reply, () => reply({ok: false, code: 'TAB_UNAVAILABLE'}));
  return true;
});
