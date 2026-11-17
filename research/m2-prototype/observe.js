'use strict';

(() => {
  const DURATION_MS = 60_000;
  const INTERVAL_MS = 250;
  const MAX_UPDATES = 60;
  const ATTRIBUTES = [
    ...globalThis.M2OfflineParser.ID_ATTRIBUTES, 'data-conversation-role',
    'data-thread-find-target', 'data-user-message-bubble', 'class', 'style', 'hidden', 'aria-hidden', 'inert',
  ];

  function start(initial, capture, isCurrent) {
    let latest = initial.snapshot;
    let scope = initial.scope;
    let revision = 1;
    let watching = true;
    let pending;
    const observer = new MutationObserver(records => {
      if (!watching) return;
      const {thread, selector} = scope;
      const relevant = !thread.isConnected || records.length > 64 || records.some(({target}) =>
        thread.contains(target) || target.contains(thread) ||
        (target.nodeType === 1 && (target.closest(selector) || target.querySelector(selector))));
      if (relevant) schedule();
    });
    const deadline = setTimeout(finish, DURATION_MS);

    function finish() {
      watching = false;
      clearTimeout(deadline);
      clearTimeout(pending);
      pending = undefined;
      observer.disconnect();
      document.removeEventListener('visibilitychange', schedule);
      scope = undefined;
    }
    function refresh() {
      pending = undefined;
      if (!watching) return;
      if (!isCurrent()) { dispose(); return; }
      if (document.visibilityState !== 'visible') return;
      const next = capture();
      latest = next.snapshot;
      scope = next.scope;
      revision++;
      if (!scope || revision >= MAX_UPDATES) finish();
    }
    function schedule() {
      if (watching && pending === undefined && document.visibilityState === 'visible') {
        pending = setTimeout(refresh, INTERVAL_MS);
      }
    }
    function dispose() {
      finish();
      latest = undefined;
    }
    const automatic = initial.snapshot.acceptance?.profile === 'candidate-auto';
    observer.observe(document.documentElement, {subtree: true, childList: true, characterData: true,
      attributes: true, ...(automatic ? {attributeFilter: ATTRIBUTES} : {})});
    document.addEventListener('visibilitychange', schedule);
    return {
      read(since) { return {watching, revision, snapshot: since < revision ? latest : undefined}; },
      dispose,
    };
  }
  globalThis.M2Observe = Object.freeze({start});
})();
