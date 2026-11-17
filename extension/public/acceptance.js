(() => {
  const uuid = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;

  async function summarize(snapshot) {
    const counts = snapshot.acceptance;
    const ids = snapshot.messages.map(message => message.candidateId);
    let orderedIds;
    if (snapshot.status === 'ok' && ids.length && ids.every(id => uuid.test(id))) {
      const bytes = new TextEncoder().encode(ids.join('\n'));
      const digest = await crypto.subtle.digest('SHA-256', bytes);
      orderedIds = Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
    }
    return {
      status: snapshot.status,
      containers: counts?.containers ?? 0,
      identified: counts?.identified ?? 0,
      readable: counts?.readable ?? 0,
      user: counts?.user ?? 0,
      assistant: counts?.assistant ?? 0,
      issues: [...new Set(snapshot.issues.map(({code}) => code))],
      orderedIds,
    };
  }

  function report(before, after, reloadIssue) {
    // Use fingerprints only for this one comparison. Exclude them from the output.
    const {orderedIds: beforeIds, ...initial} = before;
    let latest;
    if (after) {
      const {orderedIds, ...sample} = after;
      latest = sample;
    }
    const comparable = beforeIds && after?.orderedIds;
    return {
      schema: 1,
      scope: 'mounted-thread-sample',
      t10: before.status === 'ok' ? 'sampled-compare-visible-messages' : 'sample-incomplete',
      t11: comparable ? (beforeIds === after.orderedIds ? 'same-ids-in-same-order' : 'mounted-ids-or-order-changed') : 'inconclusive',
      t13: 'dedicated-boundary-cases-not-exercised',
      before: initial,
      after: latest,
      reloadIssue,
    };
  }
  globalThis.M2Acceptance = Object.freeze({summarize, report});
})();
