'use strict';

/* Offline only. No DOM, network, storage, clock or persistent state.
 * parseSnapshot({conversationKey, loadGeneration, revision, observedAt,
 *   observations: [{containerKey, attributes: {[name]: string}, role?,
 *     roleEvidence?, text?, contentStatus?: 'unsupported'}]}, options?)
 *
 * containerKey is a CALLER assertion that references belong to one canonical
 * message container, not a platform ID. Repeated keys combine evidence; distinct
 * keys never merge merely because their text/ID matches. Array order is only
 * observation order. Role is accepted only with nonempty roleEvidence.
 * options: {limits?: smaller positive budgets, previous?: prior snapshot}.
 * Previous is used only for ID diagnostics in the same conversation/generation
 * and an earlier revision; it never supplies messages, text, roles or relations.
 * scope is a legacy plan label, NOT proof of DOM/viewport visibility.
 */
(function (root) {
  const ID_ATTRIBUTES = Object.freeze([
    'data-chatgpt-search-message-ids',
    'data-chatgpt-selection-message-id',
    'data-dil-source-message-id',
    'data-dil-message-id',
  ]);
  const DEFAULT_LIMITS = Object.freeze({maxContainers: 200, maxTextCodePoints: 20000, maxTotalCodePoints: 200000});
  const nonempty = value => typeof value === 'string' && value.trim().length > 0;
  const tokens = value => [...new Set(value.split(/\s+/u).filter(Boolean))];
  const validCounter = value => Number.isSafeInteger(value) && value >= 0;
  const ownValue = (object, key) => object != null && Object.hasOwn(object, key) ? object[key] : undefined;

  function parseSnapshot(input, options = {}) {
    if (!input || !nonempty(input.conversationKey) || !validCounter(input.loadGeneration) ||
        !validCounter(input.revision) || !nonempty(input.observedAt) || !Array.isArray(input.observations)) {
      throw new TypeError('Expected conversation metadata and an observations array');
    }
    const limits = {...DEFAULT_LIMITS};
    for (const [key, value] of Object.entries(options.limits ?? {})) {
      if (!Object.hasOwn(DEFAULT_LIMITS, key) || !Number.isSafeInteger(value) || value < 1 || value > DEFAULT_LIMITS[key]) {
        throw new TypeError('Limits must be positive integers within the default budgets');
      }
      limits[key] = value;
    }
    const groups = new Map();
    input.observations.forEach((supplied, index) => {
      // Only own fields are observation evidence. Normalize once so inherited
      // role/text/status fields cannot enter grouping or content decisions either.
      const observation = Object.fromEntries(
        ['containerKey', 'attributes', 'role', 'roleEvidence', 'text', 'contentStatus']
          .map(key => [key, ownValue(supplied, key)]),
      );
      if (!observation || !nonempty(observation.containerKey) ||
          (observation.attributes !== undefined && (!observation.attributes ||
           typeof observation.attributes !== 'object' || Array.isArray(observation.attributes)))) {
        throw new TypeError('Each observation needs a canonical containerKey and optional attributes object');
      }
      for (const name of ID_ATTRIBUTES) {
        const value = ownValue(observation.attributes, name);
        if (value !== undefined && typeof value !== 'string') throw new TypeError('ID attributes must be strings');
      }
      if (!groups.has(observation.containerKey)) groups.set(observation.containerKey, {domOrder: index, refs: []});
      groups.get(observation.containerKey).refs.push(observation);
    });

    // Account for identity conflicts even in groups omitted by the output cap.
    const all = [...groups.values()].map(group => {
      const idEvidence = ID_ATTRIBUTES.flatMap(attribute => {
        const values = [...new Set(group.refs.flatMap(ref => tokens(ownValue(ref.attributes, attribute) ?? '')))];
        return values.length ? [{attribute, tokens: values}] : [];
      });
      const candidateIds = [...new Set(idEvidence.flatMap(evidence => evidence.tokens))];
      const roles = [...new Set(group.refs.filter(ref => ['user', 'assistant'].includes(ref.role) && nonempty(ref.roleEvidence)).map(ref => ref.role))];
      const texts = [...new Set(group.refs.filter(ref => typeof ref.text === 'string').map(ref => ref.text))];
      const unsupported = group.refs.some(ref => ref.contentStatus === 'unsupported');
      return {...group, idEvidence, candidateIds, roles, texts, unsupported};
    });
    const owners = new Map();
    for (const group of all) for (const id of group.candidateIds) owners.set(id, (owners.get(id) ?? 0) + 1);
    const snapshot = {
      schemaVersion: 1, adapterVersion: 'p1-offline-1',
      conversationKey: input.conversationKey, loadGeneration: input.loadGeneration,
      revision: input.revision, observedAt: input.observedAt,
      scope: 'mounted-visible-thread', scopeEvidence: 'caller-declared-not-verified',
      historyCompleteness: 'unknown', status: 'ok', messages: [], unresolved: [], issues: [],
      omittedContainers: Math.max(0, all.length - limits.maxContainers),
      diagnostics: {previousComparison: 'not-applicable', notObservedCandidateIds: []},
    };
    if (snapshot.omittedContainers) snapshot.issues.push({code: 'CONTAINER_LIMIT', count: snapshot.omittedContainers});
    let remaining = limits.maxTotalCodePoints;
    for (const group of all.slice(0, limits.maxContainers)) {
      const {candidateIds, domOrder, idEvidence, roles, texts, unsupported} = group;
      const shared = candidateIds.filter(id => owners.get(id) > 1);
      const conflict = shared.length > 0 || roles.length > 1 || texts.length > 1 || (unsupported && texts.length > 0);
      const identityStatus = conflict ? 'conflict' : candidateIds.length > 1 ? 'ambiguous' : candidateIds.length === 0 ? 'missing' : 'candidate';
      if (identityStatus !== 'candidate') {
        const reasons = [];
        if (shared.length) reasons.push('INDEPENDENT_CONTAINER_ID_CONFLICT');
        if (roles.length > 1) reasons.push('ROLE_CONFLICT');
        if (texts.length > 1 || (unsupported && texts.length > 0)) reasons.push('CONTENT_CONFLICT');
        if (candidateIds.length > 1) reasons.push('MULTIPLE_IDS');
        if (candidateIds.length === 0) reasons.push('MISSING_ID');
        snapshot.unresolved.push({domOrder, identityStatus, candidateIds, idEvidence, reasons});
        snapshot.issues.push({code: 'UNRESOLVED_IDENTITY', domOrder});
        continue;
      }
      const candidateId = candidateIds[0];
      const role = roles[0] ?? 'unknown';
      const message = {
        candidateId, key: JSON.stringify([input.conversationKey, candidateId]),
        identityStatus, idEvidence, role,
        roleEvidence: [...new Set(group.refs.filter(ref => ref.role === role && nonempty(ref.roleEvidence)).map(ref => ref.roleEvidence))],
        domOrder, visibility: 'unknown', viewportState: 'unknown',
        relationStatus: 'unknown', activeState: 'unknown',
        contentStatus: unsupported ? 'unsupported' : 'unreadable',
      };
      if (!unsupported && texts.length === 1) {
        const text = texts[0];
        const budget = Math.min(limits.maxTextCodePoints, remaining);
        const parts = [];
        // Stop copying on the first omitted code point, without splitting UTF-16 pairs.
        let truncated = false;
        for (const point of text) {
          if (parts.length === budget) { truncated = true; break; }
          parts.push(point);
        }
        message.text = parts.join('');
        message.textLength = parts.length;
        message.contentStatus = truncated ? 'truncated' : 'readable';
        remaining -= parts.length;
      }
      if (role === 'unknown') snapshot.issues.push({code: 'ROLE_UNKNOWN', domOrder});
      if (message.contentStatus !== 'readable') snapshot.issues.push({code: 'CONTENT_' + message.contentStatus.toUpperCase(), domOrder});
      snapshot.messages.push(message);
    }
    if (snapshot.issues.length) snapshot.status = 'partial';
    const previous = options.previous;
    if (previous && previous.conversationKey === input.conversationKey && previous.loadGeneration === input.loadGeneration &&
        validCounter(previous.revision) && previous.revision < input.revision && Array.isArray(previous.messages)) {
      const observed = new Set(all.flatMap(group => group.candidateIds));
      snapshot.diagnostics = {
        previousComparison: 'same-conversation-generation',
        // Absence is limited to this supplied observation batch, never server deletion.
        notObservedCandidateIds: [...new Set(previous.messages.map(message => message.candidateId).filter(nonempty))].filter(id => !observed.has(id)),
      };
    }
    return snapshot;
  }
  const api = Object.freeze({ID_ATTRIBUTES, DEFAULT_LIMITS, parseSnapshot});
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.M2OfflineParser = api; // Future isolated script context only; not exercised on a webpage in P1.
})(globalThis);
