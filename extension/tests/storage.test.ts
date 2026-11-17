import 'fake-indexeddb/auto';
import {it,expect} from 'vitest';
import {IndexedLayoutStore,cleanLayout} from '../src/storage';
import {initialLayout,positions} from '../src/layout';
import {fixtures} from '../src/fixtures';
import {project} from '../src/model';
const graph=project(fixtures[0]);
it('U05 restores positions, viewport, direction and selection across store instances',async()=>{
  const name='test-'+crypto.randomUUID();const store=new IndexedLayoutStore(name);
  const record=initialLayout('linear',graph,null);record.nodePositions.u1={x:456,y:789};record.viewport={x:12,y:-34,zoom:1.2};record.direction='LR';record.selectedNodeId='a1';
  await store.save(record);const restored=await new IndexedLayoutStore(name).load('linear');expect(restored).toEqual(record);expect(initialLayout('linear',graph,restored)).toEqual(record);
});
it('U05 isolates conversations and remembers synthetic scenario',async()=>{const s=new IndexedLayoutStore(crypto.randomUUID());await s.save(initialLayout('linear',graph,null));expect(await s.load('other')).toBeNull();await s.remember('answers');expect(await s.last()).toBe('answers');});
it('U05 allowlist removes body/credentials and nested extras',()=>{const r=initialLayout('linear',graph,null);const clean=cleanLayout({...r,text:'secret',token:'secret',viewport:{...r.viewport,cookie:'secret'},nodePositions:{u1:{x:1,y:2,text:'secret'}}});expect(JSON.stringify(clean)).not.toContain('secret');});
it('U05 rejects future schemas and invalid coordinates',()=>{const r=initialLayout('linear',graph,null);expect(()=>cleanLayout({...r,schemaVersion:2})).toThrow();expect(()=>cleanLayout({...r,viewport:{x:0,y:0,zoom:NaN}})).toThrow();expect(()=>cleanLayout({...r,nodePositions:{u1:{x:Infinity,y:0}}})).toThrow();});
it('U05 adding nodes preserves manually saved positions',()=>{const saved={u1:{x:733,y:291}};const larger=project({...fixtures[0],messages:[...fixtures[0].messages,{id:'new',parentId:'a2',role:'user',text:'new'}]});expect(positions(larger,'TB',saved).u1).toEqual(saved.u1);});
