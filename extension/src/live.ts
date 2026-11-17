import type {Fixture, RawMessage, VisibleRole} from './model';

export type LiveMessage = {
  candidateId: string;
  identityStatus: 'candidate';
  domOrder: number;
  role: VisibleRole;
  contentStatus: NonNullable<RawMessage['contentStatus']>;
  text?: string;
};
export type LiveSnapshot = {
  status: 'ok' | 'partial' | 'blocked';
  conversationKey?: string;
  scope: 'mounted-thread-sample';
  messages: LiveMessage[];
  issues: {code: string}[];
  acceptance?: {
    profile: 'candidate-auto' | 'manual';
    threads: number;
    containers: number;
    user: number;
    assistant: number;
    identified: number;
    readable: number;
    unresolved: number;
  };
};
export type SelectorName = 'thread' | 'message' | 'user' | 'assistant' | 'userBody' | 'assistantBody';
export type Profile = Record<SelectorName, string> & {
  pathname: string;
  confirmed: true;
  evidence: string;
};
type LiveRequest = {action: 'context' | 'clear' | 'stop'} | {action: 'update'; since: number} |
  {action: 'sample' | 'watch' | 'acceptance'; pathname: string; authorized: true; profile?: Profile};
type LiveReply = {
  ok: boolean;
  code?: string;
  pathname?: string;
  stopped?: boolean;
  snapshot?: LiveSnapshot;
  revision?: number;
  watching?: boolean;
  acceptance?: { t10: string; t11: string; t13: string };
};
const callbacks = globalThis as typeof globalThis & {
  chrome?: {runtime?: {sendMessage(message: unknown): Promise<LiveReply | undefined>}};
};

export async function requestLive(request: LiveRequest): Promise<LiveReply> {
  const panel = new URLSearchParams(location.search).get('panel');
  if (!panel || parent === window || !callbacks.chrome?.runtime) return {ok: false, code: 'MAP_CLOSED'};
  try {
    return await callbacks.chrome.runtime.sendMessage({
      ...request, channel: 'conversation-map-live-ui', panel,
    }) ?? {ok: false, code: 'TAB_UNAVAILABLE'};
  } catch {
    return {ok: false, code: 'TAB_UNAVAILABLE'};
  }
}

export async function sampleDiagnostic(snapshot: LiveSnapshot) {
  const ids = snapshot.messages.map(message => message.candidateId);
  // Only opaque UUIDs can participate in comparison. Never hash user content.
  const fingerprint = ids.length > 0 && ids.every(id => /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(id))
    ? [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(ids.sort().join('\n'))))]
      .map(byte => byte.toString(16).padStart(2, '0')).join('').slice(0, 24)
    : undefined;
  const counts = snapshot.acceptance;
  return JSON.stringify({
    schema: 1,
    status: snapshot.status,
    scope: snapshot.scope,
    profile: counts?.profile,
    threads: counts?.threads,
    containers: counts?.containers,
    user: counts?.user,
    assistant: counts?.assistant,
    identified: counts?.identified,
    readable: counts?.readable,
    unresolved: counts?.unresolved,
    issues: [...new Set(snapshot.issues.map(issue => issue.code))],
    idSetFingerprint: fingerprint,
  }, null, 2);
}

function conversationKey(pathname: string) {
  return 'chatgpt:conversation:' + pathname.replace(/^\/c\/|\/$/g, '');
}

export function isCurrentSample(pathname: string, snapshot?: LiveSnapshot): snapshot is LiveSnapshot {
  return !!snapshot && snapshot.conversationKey === conversationKey(pathname) &&
    snapshot.scope === 'mounted-thread-sample' && (snapshot.status === 'ok' || snapshot.status === 'partial');
}

export function liveFixture(pathname: string, snapshot?: LiveSnapshot): Fixture {
  const messages: RawMessage[] = isCurrentSample(pathname, snapshot) ? snapshot.messages
    .filter(message => message.identityStatus === 'candidate' && message.candidateId.length > 0)
    .map(({candidateId, role, text, contentStatus}) => ({
      id: candidateId, role, text: contentStatus === 'readable' || contentStatus === 'truncated' ? text : undefined,
      contentStatus,
    })) : [];
  // P2 observes identities and text. Only a source with explicit raw relationship
  // evidence may populate RawMessage.parentId or Fixture.activeLeaf.
  return {id: conversationKey(pathname), name: '当前会话', description: '仅当前已挂载消息', messages};
}
