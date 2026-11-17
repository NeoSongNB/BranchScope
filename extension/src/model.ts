export type VisibleRole = 'user' | 'assistant' | 'unknown';
export type RawMessage = { id: string; parentId?: string | null; role: VisibleRole | 'hidden'; text?: string; createdAt?: number; contentStatus?: 'readable' | 'truncated' | 'unreadable' | 'unsupported' };
export type Fixture = { id: string; name: string; description: string; messages: RawMessage[]; activeLeaf?: string };
export type Message = RawMessage & { role: VisibleRole; parent: string | null; evidence: string[]; relation: 'verified' | 'root' | 'unknown'; active: 'active' | 'inactive' | 'unknown' };
export type Graph = { nodes: Message[]; edges: { source: string; target: string; evidence: string[] }[]; issues: string[]; activeKnown: boolean };

// Duplicate identities are quarantined entirely. Never pick an arbitrary first/last value.
export function project(fixture: Fixture, reportUnknownParent = true): Graph {
  const counts = new Map<string, number>();
  fixture.messages.forEach(m => counts.set(m.id, (counts.get(m.id) ?? 0) + 1));
  const issues = [...counts].filter(([,n]) => n > 1).map(([id]) => `重复 ID ${id}：已隔离冲突消息`);
  const raw = new Map(fixture.messages.filter(m => counts.get(m.id) === 1).map(m => [m.id,m]));
  function ancestry(id: string) {
    const seen = new Set<string>(); const chain: string[] = []; let cursor: string | null | undefined = id;
    while (cursor !== null) {
      if (cursor === undefined || !raw.has(cursor) || seen.has(cursor)) return { chain, valid: false };
      seen.add(cursor); chain.push(cursor); cursor = raw.get(cursor)!.parentId;
    }
    return { chain, valid: true };
  }
  const active = fixture.activeLeaf ? ancestry(fixture.activeLeaf) : {chain:[],valid:false};
  const nodes: Message[] = [];
  for (const m of raw.values()) {
    if (m.role === 'hidden') continue;
    const path = ancestry(m.id);
    const parentIndex = path.chain.slice(1).findIndex(id => raw.get(id)!.role !== 'hidden');
    const evidence = parentIndex < 0 ? path.chain : path.chain.slice(0,parentIndex + 2);
    // An invalid component remains disconnected: no cycle, false root, or inferred edge.
    const parent = path.valid && parentIndex >= 0 ? evidence.at(-1)! : null;
    if (!path.valid && (reportUnknownParent || m.parentId !== undefined)) issues.push(`${m.id}：父链缺失、重复或循环，关系未知`);
    nodes.push({...m,role:m.role,parent,evidence:path.valid ? evidence : [],relation:!path.valid?'unknown':parent?'verified':'root',active:!path.valid || !active.valid?'unknown':active.chain.includes(m.id)?'active':'inactive'});
  }
  return { nodes,edges:nodes.filter(n=>n.parent !== null).map(n=>({source:n.parent!,target:n.id,evidence:n.evidence})),issues,activeKnown:active.valid };
}
export function search(nodes: Message[], query: string) {
  const q = query.trim().toLocaleLowerCase();
  return q ? nodes.filter(n=>n.text?.toLocaleLowerCase().includes(q)) : [];
}
export function preview(text?: string, limit = 100) {
  if (text === undefined) return {text:'内容不可读取',truncated:false};
  const chars = Array.from(text);
  return {text:chars.slice(0,limit).join('') + (chars.length>limit?'…':''),truncated:chars.length>limit};
}
