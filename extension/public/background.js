chrome.action.onClicked.addListener(() => { chrome.tabs.create({url: chrome.runtime.getURL('index.html')}); });

chrome.runtime.onMessage.addListener((message, sender, reply) => {
  if (message?.channel !== 'conversation-map-live-ui' ||
      sender.id !== chrome.runtime.id || !/^[0-9a-f-]{36}$/.test(message.panel ?? '') ||
      sender.url !== chrome.runtime.getURL(`index.html?mode=live&panel=${message.panel}`) ||
      !(sender.frameId > 0) || !Number.isInteger(sender.tab?.id)) return;
  chrome.tabs.sendMessage(sender.tab.id, {
    ...message, channel: 'conversation-map-live-tab',
  }, {frameId: 0}).then(reply, () => reply({ok: false, code: 'TAB_UNAVAILABLE'}));
  return true;
});
