'use strict';

// The automatic profile is a candidate based on recorded DOM observations
// and the reference adapter. Every sample validates it against the current page.
(() => {
  const parser = globalThis.M2OfflineParser;
  const LIMITS = Object.freeze({milliseconds: 5000, steps: 500000, messages: 200,
    textPerMessage: 20000, textTotal: 200000, attributeLength: 2048});
  const EXCLUDE = 'script,style,noscript,template,iframe,object,embed,form,button,input,textarea,select,nav,aside,[role="button"],[role="toolbar"],[role="menu"],[role="complementary"],[contenteditable="true"],[hidden],[aria-hidden="true"],[inert]';
  const BLOCK = new Set(['P', 'DIV', 'PRE', 'LI', 'TR', 'H1', 'H2', 'H3', 'H4', 'BLOCKQUOTE']);
  const AUTO = Object.freeze({
    thread: '[data-thread-find-target="conversation"]',
    message: '[data-conversation-role]',
    user: '[data-conversation-role="user"]',
    assistant: '[data-conversation-role="assistant"]',
    userBody: '[data-user-message-bubble="true"]',
    assistantBody: '.markdown',
  });
  let stopped = false;
  let scope;
  let snapshot = blocked([{code: 'PROFILE_REQUIRED'}]);
  function blocked(issues) {
    return {status: 'blocked', messages: [], unresolved: [], issues,
      historyCompleteness: 'unknown', scope: 'mounted-thread-sample', viewportState: 'unknown'};
  }
  function fail(code) { throw new Error(code); }
  function route() {
    if (window !== window.top || location.origin !== 'https://chatgpt.com') fail('UNSUPPORTED_CONTEXT');
    const match = /^\/c\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\/?$/i.exec(location.pathname);
    if (!match) fail('UNSUPPORTED_ROUTE');
    return {path: location.pathname, key: 'chatgpt:conversation:' + match[1]};
  }
  function sample(profile, automatic = false) {
    scope = undefined;
    snapshot = blocked([{code: 'SAMPLING'}]); // Drop the old body before attempting a new sample.
    if (stopped) { snapshot = blocked([{code: 'STOPPED'}]); return {status: snapshot.status}; }
    const start = performance.now();
    let visits = 0;
    function budget() {
      if (++visits > LIMITS.steps) fail('WORK_LIMIT');
      if (performance.now() - start > LIMITS.milliseconds) fail('TIME_LIMIT');
    }
    // This is a visibility exclusion, not viewport intersection or proof of
    // semantic thread membership. That membership requires the human profile.
    function visibilityFilter(element) {
      for (let el = element; el; el = el.parentElement) {
        budget();
        if (el.matches(EXCLUDE)) return NodeFilter.FILTER_REJECT;
        const css = getComputedStyle(el);
        if (css.display === 'none' || css.visibility === 'hidden' || css.visibility === 'collapse' ||
            css.contentVisibility === 'hidden' || css.opacity === '0') return NodeFilter.FILTER_REJECT;
      }
      if (element.getClientRects().length > 0) return NodeFilter.FILTER_ACCEPT;
      // A display:contents wrapper contributes descendants even without its own box.
      return getComputedStyle(element).display === 'contents' ? NodeFilter.FILTER_SKIP : NodeFilter.FILTER_REJECT;
    }
    function walk(root, visit, textNodes = false) {
      const walker = document.createTreeWalker(root, textNodes ? NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT : NodeFilter.SHOW_ELEMENT, {
        acceptNode(node) {
          budget();
          return node.nodeType === Node.ELEMENT_NODE ? visibilityFilter(node) : NodeFilter.FILTER_ACCEPT;
        },
      });
      let node;
      while ((node = walker.nextNode())) { budget(); if (visit(node) === false) break; }
    }
    function matchesWithin(root, selector, cap) {
      const found = [];
      if (root.matches(selector) && visibilityFilter(root) === NodeFilter.FILTER_ACCEPT) found.push(root);
      walk(root, node => {
        if (node.matches(selector)) found.push(node);
        return found.length < cap;
      });
      return found;
    }
    const counts = {threads: 0, containers: 0, user: 0, assistant: 0, identified: 0, readable: 0, unresolved: 0};
    try {
      const current = route();
      if (!parser || typeof parser.parseSnapshot !== 'function') fail('PARSER_UNAVAILABLE');
      if (!automatic && (!profile || profile.confirmed !== true || profile.pathname !== current.path ||
          typeof profile.evidence !== 'string' || profile.evidence.trim().length < 12 || profile.evidence.length > 1000)) fail('PROFILE_REQUIRED');
      const selectors = {};
      for (const name of ['thread', 'message', 'user', 'assistant', 'userBody', 'assistantBody']) {
        const value = automatic ? AUTO[name] : Object.hasOwn(profile, name) ? profile[name] : undefined;
        // Intentionally a narrow profile: no selector lists or broad root fallback.
        if (typeof value !== 'string' || !value.trim() || value.length > 160 ||
            value.includes(',') || /^(?:\*|html|body|:root)$/i.test(value.trim())) fail('INVALID_PROFILE');
        selectors[name] = value;
      }
      if (document.visibilityState !== 'visible') fail('DOCUMENT_HIDDEN');
      // Examine element matches only; never read document/body text.
      const threads = matchesWithin(document.documentElement, selectors.thread, 2);
      counts.threads = threads.length;
      if (threads.length !== 1 || threads[0] === document.body || threads[0] === document.documentElement) fail('THREAD_NOT_UNIQUE');
      const thread = threads[0];
      const messages = matchesWithin(thread, selectors.message, LIMITS.messages + 1);
      counts.containers = messages.length;
      if (!messages.length) fail('NO_MESSAGES');
      if (messages.length > LIMITS.messages) fail('MESSAGE_LIMIT');
      if (messages.some(m => m === thread || messages.some(other => other !== m && other.contains(m)))) fail('MESSAGE_CONTAINER_AMBIGUOUS');
      if (automatic) {
        const candidates = new Set(messages);
        walk(thread, element => {
          if (!parser.ID_ATTRIBUTES.some(name => element.hasAttribute(name))) return;
          for (let ancestor = element; ancestor !== thread; ancestor = ancestor.parentElement) {
            budget();
            if (candidates.has(ancestor)) return;
          }
          fail('MESSAGE_OUTSIDE_CONTAINER');
        });
      }
      const observations = [];
      const collectorIssues = [];
      const truncated = new Set();
      let remaining = LIMITS.textTotal;
      messages.forEach((message, domOrder) => {
        budget();
        const attributes = Object.fromEntries(parser.ID_ATTRIBUTES.map(name => [name, []]));
        const attributeSizes = Object.fromEntries(parser.ID_ATTRIBUTES.map(name => [name, 0]));
        function readIds(el) {
          for (const name of parser.ID_ATTRIBUTES) {
            if (!el.hasAttribute(name)) continue;
            const value = el.getAttribute(name);
            attributeSizes[name] += value.length + (attributes[name].length ? 1 : 0);
            if (attributeSizes[name] > LIMITS.attributeLength) fail('ID_ATTRIBUTE_LIMIT');
            attributes[name].push(value);
          }
        }
        readIds(message);
        walk(message, readIds);
        const values = Object.fromEntries(Object.entries(attributes).map(([name, list]) => {
          const value = list.join(' ');
          if (value.length > LIMITS.attributeLength) fail('ID_ATTRIBUTE_LIMIT');
          return [name, value];
        }));
        const isUser = message.matches(selectors.user);
        const isAssistant = message.matches(selectors.assistant);
        const role = isUser === isAssistant ? 'unknown' : isUser ? 'user' : 'assistant';
        if (role !== 'unknown') counts[role]++;
        const observation = {containerKey: 'sample-container-' + domOrder, attributes: values, role};
        if (role !== 'unknown') observation.roleEvidence = (automatic ? 'dom-profile:' : 'human-profile:') + selectors[role];
        if (role === 'unknown') collectorIssues.push({code: 'ROLE_NOT_CONFIRMED', domOrder});
        else {
          const bodies = matchesWithin(message, selectors[role + 'Body'], 2);
          if (bodies.length !== 1 || bodies[0] === message) collectorIssues.push({code: 'BODY_NOT_UNIQUE', domOrder});
          else {
            const body = bodies[0];
            const parts = [];
            const cap = Math.min(remaining, LIMITS.textPerMessage);
            let clipped = false;
            const append = text => {
              for (const point of text) {
                budget();
                if (parts.length >= cap) { clipped = true; return false; }
                parts.push(point);
              }
              return true;
            };
            walk(body, node => {
              if (node.nodeType === Node.TEXT_NODE) return append(node.nodeValue);
              if (node.tagName === 'BR' || (BLOCK.has(node.tagName) && parts.length && parts.at(-1) !== '\n')) return append('\n');
            }, true);
            observation.text = parts.join('');
            remaining -= parts.length;
            if (clipped) { truncated.add(domOrder); collectorIssues.push({code: 'TEXT_LIMIT', domOrder}); }
          }
        }
        observations.push(observation);
      });
      budget();
      if (route().path !== current.path || !thread.isConnected) fail('CONTEXT_CHANGED');
      const result = parser.parseSnapshot({conversationKey: current.key, loadGeneration: 0, revision: 1,
        observedAt: new Date().toISOString(), observations});
      // Collector truncation is explicit even when the parser receives a bounded string.
      for (const message of result.messages) if (truncated.has(message.domOrder)) message.contentStatus = 'truncated';
      result.issues.push(...collectorIssues);
      if (result.issues.length) result.status = 'partial';
      result.scope = 'mounted-thread-sample';
      result.scopeEvidence = automatic ? 'candidate-dom-profile' : 'human-profile-plus-visibility-filter-not-browser-validated';
      counts.identified = result.messages.length;
      counts.readable = result.messages.filter(message => message.contentStatus === 'readable' || message.contentStatus === 'truncated').length;
      counts.unresolved = result.unresolved.length;
      result.collector = {version: 'p2-single-1', sampledContainers: messages.length, visits,
        elapsedMs: performance.now() - start, profileEvidence: automatic ? 'candidate-dom-profile' : profile.evidence,
        limits: LIMITS, browserAcceptance: 'NOT VERIFIED'};
      budget();
      const ambiguous = result.issues.some(({code}) => ['ROLE_NOT_CONFIRMED', 'BODY_NOT_UNIQUE', 'UNRESOLVED_IDENTITY'].includes(code));
      snapshot = automatic && ambiguous ? blocked([{code: 'AUTO_PROFILE_MISMATCH'}, ...result.issues]) : result;
      if (snapshot === result) scope = {thread, selector: selectors.thread};
    } catch (error) {
      const allowed = /^(UNSUPPORTED_CONTEXT|UNSUPPORTED_ROUTE|PROFILE_REQUIRED|PARSER_UNAVAILABLE|INVALID_PROFILE|DOCUMENT_HIDDEN|THREAD_NOT_UNIQUE|NO_MESSAGES|MESSAGE_LIMIT|MESSAGE_CONTAINER_AMBIGUOUS|MESSAGE_OUTSIDE_CONTAINER|ID_ATTRIBUTE_LIMIT|WORK_LIMIT|TIME_LIMIT|CONTEXT_CHANGED)$/;
      snapshot = blocked([{code: allowed.test(error.message) ? error.message : 'SAMPLING_ERROR'}]);
    }
    snapshot.acceptance = {profile: automatic ? 'candidate-auto' : 'manual', ...counts};
    // Do not automatically print or return message bodies to the console.
    return {status: snapshot.status, messages: snapshot.messages.length,
      unresolved: snapshot.unresolved.length, issues: snapshot.issues};
  }
  globalThis.M2Probe = Object.freeze({
    sample(profile) { return sample(profile); },
    sampleDefault() { return sample(undefined, true); },
    getSnapshot() { return structuredClone(snapshot); },
    getScope() { return scope; },
    clear() { scope = undefined; snapshot = blocked([{code: 'CLEARED'}]); },
    stop() { stopped = true; scope = undefined; snapshot = blocked([{code: 'STOPPED'}]); },
    limits: LIMITS,
  });
})();
