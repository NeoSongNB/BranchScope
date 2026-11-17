'use strict';
const {test} = require('node:test');
const assert = require('node:assert/strict');
const {parseSnapshot, DEFAULT_LIMITS} = require('./parser.js');
const fixtures = require('./fixtures.json');
const observation = (containerKey, id, extra = {}) => ({containerKey, attributes: {'data-dil-message-id': id}, ...extra});
const input = (observations, metadata = {}) => ({...fixtures.metadata, ...metadata, observations});
const run = (name, options, metadata) => parseSnapshot(input(structuredClone(fixtures.cases[name]), metadata), options);
const ids = result => result.messages.map(message => message.candidateId);
function noRelations(result) {
  for (const key of ['edges', 'parentId', 'activeLeaf', 'deletedIds']) assert.equal(Object.hasOwn(result, key), false);
  for (const message of result.messages) {
    assert.equal(message.relationStatus, 'unknown');
    assert.equal(message.activeState, 'unknown');
    for (const key of ['parentId', 'parent', 'activeLeaf', 'createdAt', 'deleted']) assert.equal(Object.hasOwn(message, key), false);
  }
}

test('T01: repeated attribute tokens give exactly one case-sensitive candidate', () => {
  const result = run('repeatedTokens');
  assert.deepEqual(ids(result), ['X']);
  assert.deepEqual(result.unresolved, []);
  assert.deepEqual(result.messages[0].idEvidence, [{attribute: 'data-chatgpt-search-message-ids', tokens: ['X']}]);
  assert.equal(result.messages[0].identityStatus, 'candidate');
  assert.equal(result.messages[0].key, JSON.stringify([fixtures.metadata.conversationKey, 'X']));
  assert.equal(result.messages[0].role, 'user');
  assert.deepEqual(result.messages[0].roleEvidence, ['synthetic-user-label']);
  assert.equal(result.status, 'ok');
  const distinctCase = parseSnapshot(input([observation('c', 'X x')]));
  assert.deepEqual(ids(distinctCase), []);
  assert.equal(distinctCase.unresolved[0].identityStatus, 'ambiguous');
  assert.deepEqual(distinctCase.unresolved[0].candidateIds, ['X', 'x']);
});

test('T02: identical text never merges distinct IDs or conversations', () => {
  const result = run('sameTextDifferentIds');
  assert.deepEqual(ids(result), ['X', 'Y']);
  assert.deepEqual(result.messages.map(m => m.text), ['same', 'same']);
  assert.deepEqual(result.messages.map(m => m.domOrder), [0, 1]);
  assert.notEqual(result.messages[0].key, result.messages[1].key);
  const other = run('sameTextDifferentIds', {}, {conversationKey: 'chatgpt:conversation:synthetic-B'});
  assert.notEqual(other.messages[0].key, result.messages[0].key);
});

test('T03: agree across three attributes; disagreement remains ambiguous', () => {
  const result = run('consistentAttributes');
  assert.deepEqual(ids(result), ['X']);
  assert.equal(result.messages[0].idEvidence.length, 3);
  assert.ok(result.messages[0].idEvidence.every(e => e.tokens.length === 1 && e.tokens[0] === 'X'));
  const refs = structuredClone(fixtures.cases.consistentAttributes);
  refs[0].attributes['data-dil-message-id'] = 'Y';
  const conflict = parseSnapshot(input(refs));
  assert.deepEqual(ids(conflict), []);
  assert.equal(conflict.status, 'partial');
  assert.equal(conflict.unresolved[0].identityStatus, 'ambiguous');
  assert.deepEqual(conflict.unresolved[0].candidateIds, ['X', 'Y']);
  assert.deepEqual(conflict.unresolved[0].reasons, ['MULTIPLE_IDS']);
});

test('T04: multiple/missing IDs go to unresolved without generated IDs or copied text', () => {
  for (const [name, status, expectedIds, reason] of [
    ['multipleIds', 'ambiguous', ['X', 'Y'], 'MULTIPLE_IDS'],
    ['missingId', 'missing', [], 'MISSING_ID'],
  ]) {
    const result = run(name);
    assert.deepEqual(result.messages, []);
    assert.equal(result.unresolved.length, 1);
    assert.equal(result.unresolved[0].identityStatus, status);
    assert.deepEqual(result.unresolved[0].candidateIds, expectedIds);
    assert.deepEqual(result.unresolved[0].reasons, [reason]);
    assert.equal(Object.hasOwn(result.unresolved[0], 'candidateId'), false);
    assert.equal(Object.hasOwn(result.unresolved[0], 'text'), false);
  }
  const unrecognized = parseSnapshot(input([{containerKey: 'c', attributes: {'data-turn-key': 'X'}}]));
  assert.equal(unrecognized.unresolved[0].identityStatus, 'missing');
});

test('T05: canonical references collapse; independent containers quarantine shared ID', () => {
  const nested = run('nestedReferences');
  assert.deepEqual(ids(nested), ['X']);
  assert.equal(nested.messages[0].text, 'same');
  assert.equal(nested.messages[0].idEvidence.length, 2);
  const independent = run('independentConflict');
  assert.deepEqual(ids(independent), ['Y']);
  assert.equal(independent.messages[0].text, 'unaffected');
  assert.equal(independent.unresolved.length, 2);
  for (const item of independent.unresolved) {
    assert.equal(item.identityStatus, 'conflict');
    assert.deepEqual(item.candidateIds, ['X']);
    assert.deepEqual(item.reasons, ['INDEPENDENT_CONTAINER_ID_CONFLICT']);
  }
});

test('T05 failure branches: same-container role/text conflict is not last-write-wins', () => {
  for (const [refs, reason] of [
    [[observation('c', 'X', {text: 'a'}), observation('c', 'X', {text: 'b'})], 'CONTENT_CONFLICT'],
    [[observation('c', 'X', {role: 'user', roleEvidence: 'label'}), observation('c', 'X', {role: 'assistant', roleEvidence: 'label'})], 'ROLE_CONFLICT'],
    [[observation('c', 'X', {contentStatus: 'unsupported'}), observation('c', 'X', {text: 'a'})], 'CONTENT_CONFLICT'],
  ]) {
    const result = parseSnapshot(input(refs));
    assert.deepEqual(result.messages, []);
    assert.equal(result.unresolved[0].identityStatus, 'conflict');
    assert.deepEqual(result.unresolved[0].reasons, [reason]);
  }
  const ambiguousOwner = parseSnapshot(input([observation('c1', 'X'), observation('c2', 'X Y')]));
  assert.deepEqual(ids(ambiguousOwner), []);
  assert.equal(ambiguousOwner.unresolved[0].identityStatus, 'conflict');
  assert.deepEqual(ambiguousOwner.unresolved[1].candidateIds, ['X', 'Y']);
});

test('T06a: later text revision replaces current content without growing messages', () => {
  const previous = run('textBefore');
  const result = run('textAfter', {previous}, {revision: 2});
  assert.deepEqual(ids(result), ['X']);
  assert.equal(result.messages[0].text, 'ab');
  assert.equal(result.messages[0].textLength, 2);
  assert.equal(previous.messages[0].text, 'a');
  assert.equal(result.revision, 2);
  assert.deepEqual(result.diagnostics.notObservedCandidateIds, []);
  assert.equal(result.diagnostics.previousComparison, 'same-conversation-generation');
  noRelations(result);
});

test('T06b: ID replacement reports only new current ID and old ID not observed', () => {
  const previous = run('textBefore');
  const result = run('idAfter', {previous}, {revision: 2});
  assert.deepEqual(ids(result), ['Y']);
  assert.equal(result.messages[0].text, 'new answer');
  assert.deepEqual(result.diagnostics.notObservedCandidateIds, ['X']);
  assert.deepEqual(Object.keys(result.diagnostics).sort(), ['notObservedCandidateIds', 'previousComparison']);
  assert.equal(result.historyCompleteness, 'unknown');
  noRelations(result);
  const missingNow = run('unknownContent', {previous}, {revision: 2});
  assert.equal(Object.hasOwn(missingNow.messages[0], 'text'), false, 'never fill missing text from history');
});

test('T06 boundary: history is not merged or compared across conversation/generation', () => {
  const previous = run('textBefore');
  for (const metadata of [{conversationKey: 'B', revision: 2}, {loadGeneration: 1, revision: 2}, {revision: 1}]) {
    const result = run('idAfter', {previous}, metadata);
    assert.deepEqual(ids(result), ['Y']);
    assert.deepEqual(result.diagnostics, {previousComparison: 'not-applicable', notObservedCandidateIds: []});
  }
  const empty = parseSnapshot(input([], {revision: 2}), {previous});
  assert.deepEqual(empty.messages, []);
  assert.deepEqual(empty.diagnostics.notObservedCandidateIds, ['X']);
  assert.equal(empty.historyCompleteness, 'unknown');
  // This does NOT implement or test asynchronous stale-callback rejection (T09/P3).
});

test('T07: order/roles/time/parent hints never generate relations or visibility claims', () => {
  const result = parseSnapshot(input([
    observation('c1', 'Z', {role: 'assistant', roleEvidence: 'label', createdAt: 99, parentId: null, visibility: 'rendered'}),
    observation('c2', 'A', {role: 'assistant', roleEvidence: 'label', createdAt: 1, parentId: 'Z'}),
    observation('c3', 'U', {role: 'user', roleEvidence: 'label', active: true}),
  ]));
  assert.deepEqual(ids(result), ['Z', 'A', 'U']);
  assert.deepEqual(result.messages.map(m => m.domOrder), [0, 1, 2]);
  assert.deepEqual(result.messages.map(m => m.role), ['assistant', 'assistant', 'user']);
  assert.equal(result.scopeEvidence, 'caller-declared-not-verified');
  for (const m of result.messages) {
    assert.equal(m.viewportState, 'unknown');
    assert.equal(m.visibility, 'unknown');
  }
  noRelations(result);
});

test('T08: unknown roles and unreadable/unsupported bodies remain explicit', () => {
  const result = run('unknownContent');
  assert.deepEqual(ids(result), ['X']);
  assert.equal(result.messages[0].role, 'unknown');
  assert.deepEqual(result.messages[0].roleEvidence, []);
  assert.equal(result.messages[0].contentStatus, 'unreadable');
  assert.equal(Object.hasOwn(result.messages[0], 'text'), false);
  assert.equal(result.status, 'partial');
  assert.deepEqual(result.issues.map(i => i.code), ['ROLE_UNKNOWN', 'CONTENT_UNREADABLE']);
  assert.equal(run('unsupportedContent').messages[0].contentStatus, 'unsupported');
  const unprovenRole = parseSnapshot(input([observation('c', 'X', {role: 'assistant', text: ''})]));
  assert.equal(unprovenRole.messages[0].role, 'unknown');
  assert.equal(unprovenRole.messages[0].contentStatus, 'readable');
  assert.equal(unprovenRole.messages[0].textLength, 0);
});

test('T08: Unicode per-message and total text budgets truncate explicitly', () => {
  const result = parseSnapshot(input([
    observation('c1', 'X', {text: '😀ab'}), observation('c2', 'Y', {text: '中文'}), observation('c3', 'Z', {text: 'more'}),
  ]), {limits: {maxTextCodePoints: 2, maxTotalCodePoints: 3}});
  assert.deepEqual(ids(result), ['X', 'Y', 'Z']);
  assert.deepEqual(result.messages.map(m => m.text), ['😀a', '中', '']);
  assert.deepEqual(result.messages.map(m => m.textLength), [2, 1, 0]);
  assert.deepEqual(result.messages.map(m => m.contentStatus), ['truncated', 'truncated', 'truncated']);
  const exact = parseSnapshot(input([observation('c', 'X', {text: '😀a'})]), {limits: {maxTextCodePoints: 2}});
  assert.equal(exact.messages[0].contentStatus, 'readable');
  const defaults = parseSnapshot(input([observation('c', 'X', {text: '😀'.repeat(DEFAULT_LIMITS.maxTextCodePoints + 1)})]));
  assert.equal(defaults.messages[0].textLength, 20000);
  assert.equal(Array.from(defaults.messages[0].text).length, 20000);
  assert.equal(defaults.messages[0].contentStatus, 'truncated');
});

test('T08: container cap reports omissions and cannot hide a duplicate owner', () => {
  const result = parseSnapshot(input([observation('c1', 'X'), observation('c2', 'Y')]), {limits: {maxContainers: 1}});
  assert.deepEqual(ids(result), ['X']);
  assert.equal(result.omittedContainers, 1);
  assert.equal(result.status, 'partial');
  assert.deepEqual(result.issues[0], {code: 'CONTAINER_LIMIT', count: 1});
  const conflict = parseSnapshot(input([observation('c1', 'X'), observation('c2', 'X')]), {limits: {maxContainers: 1}});
  assert.deepEqual(ids(conflict), []);
  assert.equal(conflict.unresolved[0].identityStatus, 'conflict');
});

test('T08: markup is opaque text, not DOM sanitization/filtering evidence', () => {
  const text = '<script>throw new Error("must not execute")</script><style>body{display:none}</style>Copy';
  const result = parseSnapshot(input([observation('c', 'X', {text, innerHTML: '<b>ignored</b>', url: 'https://invalid.test'})]));
  assert.equal(result.messages[0].text, text);
  assert.equal(result.messages[0].contentStatus, 'readable');
  assert.equal(Object.hasOwn(result.messages[0], 'innerHTML'), false);
  assert.equal(Object.hasOwn(result.messages[0], 'url'), false);
  // Script/style/toolbar removal is deliberately NOT claimed; it belongs to P2 DOM tests.
});

test('Contract: invalid envelope/attribute/limits fail explicitly, no fallback identities', () => {
  for (const bad of [null, input([], {conversationKey: ''}), input([], {revision: -1}), input([{}]),
    input([{containerKey: 'c', attributes: []}]), input([{containerKey: 'c', attributes: {'data-dil-message-id': 4}}])]) {
    assert.throws(() => parseSnapshot(bad), TypeError);
  }
  for (const limits of [{maxContainers: 0}, {maxContainers: 201}, {maxTextCodePoints: 1.5}, {unknown: 1}, {toString: 1}]) {
    assert.throws(() => parseSnapshot(input([]), {limits}), TypeError);
  }
});

test('Contract: deterministic pure parsing leaves frozen inputs and prior snapshots intact', () => {
  const deepFreeze = value => {if (value && typeof value === 'object') {Object.values(value).forEach(deepFreeze); Object.freeze(value);} return value;};
  const batch = deepFreeze(input(structuredClone(fixtures.cases.idAfter), {revision: 2}));
  const previous = deepFreeze(run('textBefore'));
  const before = JSON.stringify({batch, previous});
  assert.deepEqual(parseSnapshot(batch, {previous}), parseSnapshot(batch, {previous}));
  assert.equal(JSON.stringify({batch, previous}), before);
});

test('Regression: inherited ID attributes never supply candidates or trigger type validation', () => {
  for (const inherited of ['inherited-ID', 42]) {
    const attributes = Object.create({'data-dil-message-id': inherited});
    const result = parseSnapshot(input([{containerKey: 'c', attributes}]));
    assert.deepEqual(result.messages, []);
    assert.equal(result.unresolved[0].identityStatus, 'missing');
    assert.deepEqual(result.unresolved[0].candidateIds, []);
    assert.deepEqual(result.unresolved[0].idEvidence, []);
    assert.deepEqual(result.unresolved[0].reasons, ['MISSING_ID']);
    attributes['data-chatgpt-selection-message-id'] = 'own-ID';
    const own = parseSnapshot(input([{containerKey: 'c', attributes}]));
    assert.deepEqual(ids(own), ['own-ID']);
    assert.deepEqual(own.messages[0].idEvidence, [{attribute: 'data-chatgpt-selection-message-id', tokens: ['own-ID']}]);
  }
  const attributes = Object.create(Object.defineProperty({}, 'data-dil-message-id', {
    get() { throw new Error('inherited getter must not run'); },
  }));
  assert.equal(parseSnapshot(input([{containerKey: 'c', attributes}])).unresolved[0].identityStatus, 'missing');
  Object.defineProperty(attributes, 'data-dil-message-id', {value: 42});
  assert.throws(() => parseSnapshot(input([{containerKey: 'c', attributes}])), TypeError);
});

test('Regression: inherited observation fields are not identity, role or content evidence', () => {
  const inheritedAttributes = Object.assign(Object.create({attributes: {'data-dil-message-id': 'X'}}), {containerKey: 'c'});
  const missing = parseSnapshot(input([inheritedAttributes]));
  assert.deepEqual(ids(missing), []);
  assert.deepEqual(missing.unresolved[0].idEvidence, []);
  assert.equal(missing.unresolved[0].identityStatus, 'missing');
  const inheritedContainer = Object.assign(Object.create({containerKey: 'c'}), {attributes: {'data-dil-message-id': 'X'}});
  assert.throws(() => parseSnapshot(input([inheritedContainer])), TypeError);
  for (const [prototype, ownFields] of [
    [{role: 'assistant'}, {roleEvidence: 'own-label'}],
    [{roleEvidence: 'inherited-label'}, {role: 'assistant'}],
    [{role: 'assistant', roleEvidence: 'inherited-label', text: 'inherited text', contentStatus: 'unsupported'}, {}],
  ]) {
    const ref = Object.assign(Object.create(prototype), observation('c', 'X'), ownFields);
    const result = parseSnapshot(input([ref]));
    assert.deepEqual(ids(result), ['X']);
    assert.equal(result.messages[0].role, 'unknown');
    assert.deepEqual(result.messages[0].roleEvidence, []);
    assert.equal(result.messages[0].contentStatus, 'unreadable');
    assert.equal(Object.hasOwn(result.messages[0], 'text'), false);
    noRelations(result);
  }
  const ref = Object.assign(Object.create({contentStatus: 'unsupported', text: 'inherited text'}),
    observation('c', 'X', {text: 'own text', role: 'user', roleEvidence: 'own-label'}));
  const own = parseSnapshot(input([ref]));
  assert.deepEqual(ids(own), ['X']);
  assert.equal(own.messages[0].text, 'own text');
  assert.equal(own.messages[0].contentStatus, 'readable');
  assert.equal(own.messages[0].role, 'user');
  assert.deepEqual(own.messages[0].roleEvidence, ['own-label']);
});
