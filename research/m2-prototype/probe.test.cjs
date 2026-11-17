'use strict';
// Synthetic DOM-interface double, NOT jsdom, Chrome, CSS engine or site evidence.
// It models only preorder traversal, subtree rejection and supplied geometry.
const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const sources = ['parser.js', 'probe.js'].map(file => fs.readFileSync(path.join(__dirname, file), 'utf8'));
const route = '/c/00000000-0000-0000-0000-000000000001';
const profile = {confirmed: true, pathname: route, evidence: 'Synthetic test profile, not observed ChatGPT DOM',
  thread: '.thread', message: '.message', user: '.user', assistant: '.assistant', userBody: '.text', assistantBody: '.text'};
const text = value => ({nodeType: 3, nodeValue: value, children: []});
function element(tags = [], children = [], options = {}) {
  const tagName = options.tagName || 'DIV';
  const el = {nodeType: 1, tagName, children, parentElement: null, isConnected: true,
    css: {display: 'block', visibility: 'visible', opacity: '1', ...options.css},
    matches(selector) {
      return selector.split(',').some(part => part.toUpperCase() === tagName || tags.includes(part));
    },
    getClientRects() { return options.noBox ? [] : [{}]; },
    hasAttribute(name) { return Object.hasOwn(options.attributes || {}, name); },
    getAttribute(name) { return (options.attributes || {})[name] ?? null; },
    contains(other) { return other === this || this.children.some(child => child.nodeType === 1 && child.contains(other)); },
  };
  for (const child of children) child.parentElement = el;
  return el;
}
function message(id = 'X', value = 'hello', extraBodies = []) {
  return element(['.message', '.user'], [element(['.text'], [text(value)]), ...extraBodies], {
    attributes: {'data-chatgpt-search-message-ids': id},
  });
}
function harness(threads = [element(['.thread'], [message()])], now = () => 0) {
  const body = element([], threads);
  const html = element([], [body], {tagName: 'HTML'});
  const document = {visibilityState: 'visible', documentElement: html, body,
    createTreeWalker(root, mask, filter) {
      const stack = [...root.children].reverse();
      return {nextNode() {
        while (stack.length) {
          const node = stack.pop();
          const shown = mask & (node.nodeType === 1 ? 1 : 4);
          const decision = shown ? filter.acceptNode(node) : 3;
          if (decision !== 2) stack.push(...[...node.children].reverse());
          if (decision === 1) return node;
        }
        return null;
      }};
    },
  };
  const page = {}; page.top = page;
  const context = vm.createContext({window: page, document, location: {origin: 'https://chatgpt.com', pathname: route},
    performance: {now}, structuredClone, Node: {ELEMENT_NODE: 1, TEXT_NODE: 3},
    NodeFilter: {SHOW_ELEMENT: 1, SHOW_TEXT: 4, FILTER_ACCEPT: 1, FILTER_REJECT: 2, FILTER_SKIP: 3},
    getComputedStyle: el => el.css});
  sources.forEach(source => vm.runInContext(source, context));
  return {api: context.M2Probe, context};
}
function collect(h) { h.api.sample(profile); return h.api.getSnapshot(); }

test('P2 offline: default blocked, missing profile and stop never emit bodies', () => {
  const h = harness();
  assert.equal(h.api.getSnapshot().issues[0].code, 'PROFILE_REQUIRED');
  h.api.sample();
  assert.equal(h.api.getSnapshot().messages.length, 0);
  h.api.stop();
  h.api.sample(profile);
  assert.equal(h.api.getSnapshot().issues[0].code, 'STOPPED');
  assert.equal(h.api.getSnapshot().messages.length, 0);
});
test('P2 offline: collector-parser handoff preserves ID, role, text, order and unknown relations', () => {
  const h = harness([element(['.thread'], [message('X X', 'same'), message('Y', 'same')])]);
  const result = collect(h);
  assert.equal(result.status, 'ok');
  assert.deepEqual(result.messages.map(m => m.candidateId), ['X', 'Y']);
  assert.deepEqual(result.messages.map(m => m.domOrder), [0, 1]);
  assert.deepEqual(result.messages.map(m => m.text), ['same', 'same']);
  for (const m of result.messages) {
    assert.equal(m.role, 'user');
    assert.equal(m.activeState, 'unknown');
    assert.equal(m.relationStatus, 'unknown');
    assert.equal(Object.hasOwn(m, 'parentId'), false);
  }
  assert.equal(Object.hasOwn(result, 'edges'), false);
});
test('P2 offline: multiple candidate IDs remain unresolved', () => {
  const result = collect(harness([element(['.thread'], [message('X Y')])]));
  assert.equal(result.status, 'partial');
  assert.deepEqual(result.messages, []);
  assert.equal(result.unresolved[0].identityStatus, 'ambiguous');
  assert.deepEqual(result.unresolved[0].candidateIds, ['X', 'Y']);
});
test('P2 offline: zero or multiple threads block; non-unique body is unreadable', () => {
  for (const threads of [[], [element(['.thread']), element(['.thread'])]]) {
    const result = collect(harness(threads));
    assert.equal(result.status, 'blocked');
    assert.equal(result.issues[0].code, 'THREAD_NOT_UNIQUE');
    assert.deepEqual(result.messages, []);
  }
  const result = collect(harness([element(['.thread'], [message('X', 'one', [element(['.text'], [text('two')])])])]));
  assert.equal(result.messages[0].contentStatus, 'unreadable');
  assert.equal(Object.hasOwn(result.messages[0], 'text'), false);
  assert.ok(result.issues.some(i => i.code === 'BODY_NOT_UNIQUE'));
});
test('P2 offline: message and attribute caps block without keeping partial bodies', () => {
  for (const [messages, code] of [
    [Array.from({length: 201}, (_, i) => message('id-' + i)), 'MESSAGE_LIMIT'],
    [[message('X'.repeat(2049))], 'ID_ATTRIBUTE_LIMIT'],
  ]) {
    const result = collect(harness([element(['.thread'], messages)]));
    assert.equal(result.status, 'blocked');
    assert.equal(result.issues[0].code, code);
    assert.deepEqual(result.messages, []);
  }
});
test('P2 offline: Unicode collector truncation remains explicit after parser handoff', () => {
  const result = collect(harness([element(['.thread'], [message('X', '😀'.repeat(20001))])]));
  assert.equal(result.status, 'partial');
  assert.equal(result.messages[0].contentStatus, 'truncated');
  assert.equal(result.messages[0].textLength, 20000);
  assert.equal(Array.from(result.messages[0].text).length, 20000);
  assert.ok(result.issues.some(i => i.code === 'TEXT_LIMIT'));
});
test('P2 offline: elapsed budget blocks and clears the previous successful snapshot', () => {
  let expired = false; let ticks = 0;
  const h = harness(undefined, () => expired ? ticks++ * 6000 : 0);
  assert.equal(collect(h).messages.length, 1);
  expired = true;
  const result = collect(h);
  assert.equal(result.issues[0].code, 'TIME_LIMIT');
  assert.deepEqual(result.messages, []);
});
test('P2 regression: no-box display:contents wrapper must not prune visible message descendants', () => {
  // Intended invariant, not a real-site claim. display:contents has no own box;
  // visible descendants must not be silently interpreted as NO_MESSAGES.
  const wrapper = element([], [message('X', 'visible child')], {css: {display: 'contents'}, noBox: true});
  const result = collect(harness([element(['.thread'], [wrapper])]));
  assert.equal(result.status, 'ok');
  assert.deepEqual(result.messages.map(m => m.candidateId), ['X']);
  assert.equal(result.messages[0].text, 'visible child');
});

test('P2 excludes hidden and auxiliary subtrees from message and body walks', () => {
  const excluded = [
    {css: {display: 'none'}}, {css: {visibility: 'hidden'}},
    {css: {display: 'contents', contentVisibility: 'hidden'}, noBox: true},
    {tagName: 'ASIDE'}, {tagName: 'FORM'}, {tagName: 'INPUT'}, {tagName: 'IFRAME'},
    {tags: ['[role="toolbar"]']}, {tags: ['[hidden]']},
  ];
  const hiddenMessages = excluded.map(({tags, ...options}) => element(tags, [message('hidden')], options));
  const hiddenBody = excluded.map(({tags, ...options}) => element(tags, [text('hidden')], options));
  const answer = element(['.message', '.assistant'], [
    element(['.text'], [
      ...hiddenBody,
      element([], [text('line one'), element([], [], {tagName: 'BR'}), text('line two')],
        {css: {display: 'contents'}, noBox: true}),
    ]),
    element([], [element([], [], {attributes: {'data-dil-message-id': 'A'}})],
      {css: {display: 'contents'}, noBox: true}),
  ], {attributes: {'data-chatgpt-selection-message-id': 'A'}});
  const result = collect(harness([element(['.thread'], [...hiddenMessages, message('U'), answer])]));
  assert.equal(result.status, 'ok');
  assert.deepEqual(result.messages.map(m => [m.candidateId, m.role, m.text]), [
    ['U', 'user', 'hello'], ['A', 'assistant', 'line one\nline two'],
  ]);
  assert.deepEqual(result.messages[1].idEvidence.map(e => e.attribute),
    ['data-chatgpt-selection-message-id', 'data-dil-message-id']);
});

test('P2 clear drops bodies, allows manual resampling and cannot undo stop', () => {
  const h = harness();
  assert.equal(collect(h).messages.length, 1);
  h.api.clear();
  assert.equal(h.api.getSnapshot().issues[0].code, 'CLEARED');
  assert.deepEqual(h.api.getSnapshot().messages, []);
  assert.equal(collect(h).messages.length, 1);
  h.api.stop();
  h.api.clear();
  assert.deepEqual(collect(h).messages, []);
  assert.equal(h.api.getSnapshot().issues[0].code, 'STOPPED');
});

test('P2 route mismatch clears the previous snapshot before reading', () => {
  const h = harness();
  assert.equal(collect(h).messages.length, 1);
  h.context.location.pathname = '/';
  const result = collect(h);
  assert.equal(result.issues[0].code, 'UNSUPPORTED_ROUTE');
  assert.deepEqual(result.messages, []);
});

const autoThread = '[data-thread-find-target="conversation"]';
function automaticMessage(role, id, options = {}) {
  const body = role === 'user' ? '[data-user-message-bubble="true"]' : '.markdown';
  const content = element([body], [text('example')]);
  return element(['[data-conversation-role]', `[data-conversation-role="${role}"]`],
    options.ambiguous ? [content, element([body], [text('second match')])] : [content],
    {attributes: {'data-chatgpt-search-message-ids': id}});
}
function autoCollect(threads) {
  const {api} = harness(threads);
  api.sampleDefault();
  return api.getSnapshot();
}

test('automatic profile matches a unique visible thread and requires a scoped role, ID, and body', () => {
  const content = [automaticMessage('user', 'U U'), automaticMessage('assistant', 'A')];
  const result = autoCollect([
    element([autoThread], content),
    element([autoThread], [automaticMessage('assistant', 'hidden')], {css: {display: 'none'}}),
  ]);
  assert.equal(result.status, 'ok');
  assert.deepEqual(result.messages.map(({candidateId, role, text}) => [candidateId, role, text]),
    [['U', 'user', 'example'], ['A', 'assistant', 'example']]);
  assert.equal(result.acceptance.profile, 'candidate-auto');
  assert.equal(result.acceptance.readable, 2);
});

test('automatic profile blocks structural drift, orphan IDs, conflicting IDs, and ambiguous bodies', () => {
  const cases = [
    [[element(), element()], 'THREAD_NOT_UNIQUE'],
    [[element([autoThread]), element([autoThread])], 'THREAD_NOT_UNIQUE'],
    [[element([autoThread], [automaticMessage('system', 'S')])], 'ROLE_NOT_CONFIRMED'],
    [[element([autoThread], [automaticMessage('assistant', 'A', {ambiguous: true})])], 'BODY_NOT_UNIQUE'],
    [[element([autoThread], [automaticMessage('user', 'U V')])], 'UNRESOLVED_IDENTITY'],
    [[element([autoThread], [automaticMessage('user', 'U'),
      element([], [text('unassigned')], {attributes: {'data-dil-message-id': 'X'}})])], 'MESSAGE_OUTSIDE_CONTAINER'],
  ];
  for (const [threads, code] of cases) {
    const result = autoCollect(threads);
    assert.equal(result.status, 'blocked');
    assert.ok(result.issues.some(issue => issue.code === code), code);
    assert.deepEqual(result.messages, []);
  }
});
