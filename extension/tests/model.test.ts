import {describe,it,expect} from 'vitest';
import {fixtures} from '../src/fixtures';
import {project,search,preview} from '../src/model';
const fixture=(id:string)=>fixtures.find(f=>f.id===id)!;
describe('U01/U02 message identities and evidence',()=>{
  for(const f of fixtures)it(`${f.id}: unique nodes and acyclic projected edges`,()=>{
    const g=project(f);expect(new Set(g.nodes.map(n=>n.id)).size).toBe(g.nodes.length);
    for(const edge of g.edges){const seen=new Set<string>();let id:string|null=edge.target;while(id){expect(seen.has(id)).toBe(false);seen.add(id);id=g.nodes.find(n=>n.id===id)?.parent??null;}}
  });
  it('one user, three answers',()=>{const g=project(fixture('answers'));expect(g.nodes.filter(n=>n.role==='user')).toHaveLength(1);expect(g.edges.filter(e=>e.source==='u1')).toHaveLength(3);});
  it('timestamps never establish edges',()=>{expect(project(fixture('unordered')).edges).toEqual(project(fixture('linear')).edges);});
  it('missing parents are unknown, not false roots',()=>{const g=project(fixture('missing'));expect(g.nodes.find(n=>n.id==='orphan')?.relation).toBe('unknown');expect(g.edges.some(e=>e.target==='orphan')).toBe(false);});
  it('cycles never create edges or an active path',()=>{const g=project(fixture('cycle'));expect(g.edges).toHaveLength(0);expect(g.activeKnown).toBe(false);expect(g.nodes.every(n=>n.active==='unknown')).toBe(true);});
  it('duplicates are quarantined including dependent edges',()=>{const g=project(fixture('duplicate'));expect(g.nodes.some(n=>n.id==='a1')).toBe(false);expect(g.edges).toHaveLength(0);expect(g.issues.length).toBeGreaterThan(0);});
  it('hidden ancestry is evidenced; visible assistant messages remain separate',()=>{const g=project(fixture('hidden'));expect(g.nodes).toHaveLength(3);expect(g.edges[0]).toEqual({source:'u1',target:'a1',evidence:['a1','internal','u1']});expect(g.nodes.filter(n=>n.role==='assistant')).toHaveLength(2);});
  it('unknown leaf does not invent an active path',()=>{const g=project({...fixture('linear'),activeLeaf:'absent'});expect(g.nodes.every(n=>n.active==='unknown')).toBe(true);});
  it('search and preview only expose loaded text',()=>{const g=project(fixture('long'));expect(search(g.nodes,'javascript')).toHaveLength(1);expect(search(g.nodes,' ')).toHaveLength(0);expect(preview(g.nodes[1].text).truncated).toBe(true);expect(preview(undefined).text).toBe('内容不可读取');});
});


describe('M1 final audit boundaries',()=>{
  it('different identities with identical text remain separate; shared parent stays unique',()=>{
    const g=project({id:'same',name:'same',description:'',messages:[{id:'u',parentId:null,role:'user',text:'same'},{id:'a',parentId:'u',role:'assistant',text:'same'},{id:'b',parentId:'u',role:'assistant',text:'same'}],activeLeaf:'a'});
    expect(g.nodes.map(n=>n.id)).toEqual(['u','a','b']);expect(g.edges.map(e=>[e.source,e.target])).toEqual([['u','a'],['u','b']]);
  });
  it.each([['self'],['x','y','z']])('isolates cycle %j without contaminating a valid branch',(...ids)=>{
    const normal=fixture('linear');
    const g=project({...normal,messages:[...normal.messages,...ids.map((id,i)=>({id,parentId:ids[(i+1)%ids.length],role:'assistant' as const,text:id}))]});
    expect(g.edges).toEqual(project(normal).edges);expect(g.nodes.filter(n=>ids.includes(n.id)).every(n=>n.relation==='unknown' && n.active==='unknown')).toBe(true);expect(g.nodes.find(n=>n.id==='a2')?.active).toBe('active');
  });
  it('broken hidden ancestry and descendants cannot invent edges',()=>{
    const normal=fixture('linear');const g=project({...normal,messages:[...normal.messages,{id:'h',role:'hidden',parentId:'missing'},{id:'bad',role:'assistant',parentId:'h'},{id:'child',role:'user',parentId:'bad'}]});
    expect(g.edges).toEqual(project(normal).edges);expect(g.nodes.filter(n=>['bad','child'].includes(n.id)).every(n=>n.parent===null && n.relation==='unknown')).toBe(true);
  });
  it('duplicate identical records are quarantined; reordered inputs preserve edge identities',()=>{
    const f=fixture('branches');const g=project({...f,messages:[...f.messages].reverse()});const ids=(graph:ReturnType<typeof project>)=>graph.edges.map(e=>JSON.stringify([e.source,e.target])).sort();
    expect(ids(g)).toEqual(ids(project(f)));expect(new Set(ids(g)).size).toBe(g.edges.length);
    const duplicate=project({...fixture('linear'),messages:[...fixture('linear').messages,fixture('linear').messages[0]]});expect(duplicate.nodes.some(n=>n.id==='u1')).toBe(false);expect(duplicate.edges).toEqual([]);
  });
});
