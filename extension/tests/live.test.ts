import {expect, it} from 'vitest';
import {liveFixture, type LiveMessage, type LiveSnapshot} from '../src/live';
import {project} from '../src/model';
import {positions} from '../src/layout';

const uuid = '00000000-0000-0000-0000-000000000001';
const pathname = '/c/' + uuid;
const user: LiveMessage = {candidateId: 'u', identityStatus: 'candidate', domOrder: 0, role: 'user',
  contentStatus: 'readable', text: 'same text'};
const answer: LiveMessage = {...user, candidateId: 'a', domOrder: 1, role: 'assistant'};
function snapshot(messages: LiveMessage[]): LiveSnapshot {
  return {conversationKey: 'chatgpt:conversation:' + uuid, status: 'ok', scope: 'mounted-thread-sample',
    messages, issues: []};
}

it('projects distinct roles and answers but never turns DOM order or untrusted hints into edges', () => {
  const falseParent = {...answer, parentId: 'u', activeState: 'active'};
  const graph = project(liveFixture(pathname, snapshot([user, falseParent, {...answer, candidateId: 'b'}])), false);
  expect(graph.nodes.map(({id, role, relation, active}) => [id, role, relation, active])).toEqual([
    ['u', 'user', 'unknown', 'unknown'], ['a', 'assistant', 'unknown', 'unknown'],
    ['b', 'assistant', 'unknown', 'unknown'],
  ]);
  expect(graph.edges).toEqual([]);
  expect(graph.issues).toEqual([]);
});

it('discards stale snapshots and replaces rather than keeping vanished message bodies', () => {
  expect(liveFixture(pathname, snapshot([user, answer])).messages).toHaveLength(2);
  expect(liveFixture(pathname, snapshot([{...user, text: 'revised'}])).messages.map(m => m.text)).toEqual(['revised']);
  expect(liveFixture(pathname.replace(/1$/, '2'), snapshot([user])).messages).toEqual([]);
  expect(liveFixture(pathname, {...snapshot([user]), status: 'blocked'}).messages).toEqual([]);
});

it('isolates duplicate IDs, keeps unknown roles and unreadable states, and safely lays out reserved IDs', () => {
  const ambiguousBody: LiveMessage = {...answer, candidateId: '__proto__', role: 'unknown', contentStatus: 'unreadable'};
  const graph = project(liveFixture(pathname, snapshot([user, user, ambiguousBody])), false);
  expect(graph.issues).toHaveLength(1);
  expect(graph.nodes.map(({id, role, text}) => [id, role, text])).toEqual([['__proto__', 'unknown', undefined]]);
  expect(Object.hasOwn(positions(graph, 'TB'), '__proto__')).toBe(true);
});

it('renders a complete verified ancestry chain and isolates corrupted components using the shared projector', () => {
  const fixture = liveFixture(pathname, snapshot([user, answer]));
  fixture.messages[0].parentId = null;
  fixture.messages[1].parentId = 'hidden';
  fixture.messages.push({id: 'hidden', role: 'hidden', parentId: 'u'}, {id: 'loop', role: 'assistant', parentId: 'loop'});
  const graph = project(fixture, false);
  expect(graph.edges).toEqual([{source: 'u', target: 'a', evidence: ['a', 'hidden', 'u']}]);
  expect(graph.nodes.find(node => node.id === 'loop')?.relation).toBe('unknown');
  expect(graph.activeKnown).toBe(false);
});
