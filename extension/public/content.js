(() => {
  if (window !== window.top || location.origin !== 'https://chatgpt.com') return;

  const host = document.createElement('div');
  const shadow = host.attachShadow({mode: 'closed'});
  const style = document.createElement('style');
  style.textContent = `
    :host{all:initial}
    .launcher{position:fixed;right:24px;bottom:24px;z-index:2147483647;display:flex;gap:8px}
    button{border:1px solid #9db8cd;background:#123e5c;color:white;border-radius:24px;padding:12px 18px;font:14px system-ui;cursor:pointer}
    iframe{position:fixed;inset:24px 24px 80px;width:calc(100vw - 48px);height:calc(100vh - 104px);border:1px solid #aec5d5;border-radius:16px;background:#fff;z-index:2147483646;box-shadow:0 12px 48px #183e5940}
  `;
  const launcher = document.createElement('div');
  launcher.className = 'launcher';
  const liveButton = document.createElement('button');
  const syntheticButton = document.createElement('button');
  liveButton.textContent = '会话地图';
  syntheticButton.textContent = '合成对话地图';
  launcher.append(liveButton, syntheticButton);
  const probe = globalThis.M2Probe;
  let frame;
  let frameMode;
  let framePath;
  let panel;
  let stopped = false;
  let observation;

  function clear() {
    observation?.dispose();
    observation = undefined;
    probe?.clear();
  }

  function close() {
    if (!frame) return;
    clear();
    frame.remove();
    frame = frameMode = framePath = panel = undefined;
    stopped = false;
    liveButton.textContent = '会话地图';
    syntheticButton.textContent = '合成对话地图';
    liveButton.setAttribute('aria-expanded', 'false');
    syntheticButton.setAttribute('aria-expanded', 'false');
  }
  function toggle(mode, button) {
    const wasOpen = frameMode === mode;
    close();
    if (wasOpen) return;
    frame = document.createElement('iframe');
    frameMode = mode;
    framePath = location.pathname;
    frame.title = mode === 'live' ? '当前会话只读地图' : '只读合成数据测试地图';
    if (mode === 'live') panel = crypto.randomUUID();
    frame.src = chrome.runtime.getURL(mode === 'live' ? `index.html?mode=live&panel=${panel}` : 'index.html');
    let loaded = false;
    const currentFrame = frame;
    frame.addEventListener('load', () => {
      if (loaded && frame === currentFrame) clear();
      loaded = true;
    });
    shadow.append(frame);
    button.textContent = '关闭地图';
    button.setAttribute('aria-expanded', 'true');
  }
  liveButton.setAttribute('aria-expanded', 'false');
  syntheticButton.setAttribute('aria-expanded', 'false');
  liveButton.onclick = () => toggle('live', liveButton);
  syntheticButton.onclick = () => toggle('synthetic', syntheticButton);
  // Close and discard a live map on SPA conversation changes and BFCache navigation.
  function checkRoute() {
    if (frameMode === 'live' && location.pathname !== framePath) close();
  }
  window.navigation?.addEventListener('currententrychange', checkRoute);
  window.addEventListener('popstate', checkRoute);
  window.addEventListener('pagehide', close);

  chrome.runtime.onMessage.addListener((message, sender, reply) => {
    if (message?.channel !== 'conversation-map-live-tab' || sender.id !== chrome.runtime.id ||
        sender.tab !== undefined) return;
    checkRoute();
    if (frameMode !== 'live' || !frame?.isConnected || message.panel !== panel) return reply({ok: false, code: 'MAP_CLOSED'});
    if (!probe) return reply({ok: false, code: 'PARSER_UNAVAILABLE'});
    if (message.action === 'context') {
      const pathname = location.pathname;
      const supported = /^\/c\/[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}\/?$/i.test(pathname);
      return reply(supported ? {ok: true, pathname, stopped} : {ok: false, code: 'UNSUPPORTED_ROUTE'});
    }
    if (message.action === 'stop' || message.action === 'clear') {
      if (message.action === 'stop') stopped = true;
      clear();
      return reply({ok: true});
    }
    if (stopped) return reply({ok: false, code: 'STOPPED'});
    if (message.action === 'update') return reply({ok: true, ...(observation?.read(message.since) ?? {watching: false})});
    if (message.action !== 'sample' && message.action !== 'watch') return reply({ok: false, code: 'INVALID_ACTION'});
    if (message.authorized !== true || message.pathname !== framePath) return reply({ok: false, code: 'PROFILE_REQUIRED'});
    clear();
    const capture = () => {
      if (message.profile) probe.sample(message.profile);
      else probe.sampleDefault();
      const result = {snapshot: probe.getSnapshot(), scope: probe.getScope()};
      probe.clear();
      return result;
    };
    const initial = capture();
    if (message.action === 'watch' && initial.scope) {
      const originalPanel = panel;
      observation = globalThis.M2Observe.start(initial, capture, () =>
        panel === originalPanel && frame?.isConnected && location.pathname === framePath);
      return reply({ok: true, ...observation.read(0)});
    }
    return reply({ok: true, snapshot: initial.snapshot, watching: false});
  });

  shadow.append(style, launcher);
  document.documentElement.append(host);
})();
