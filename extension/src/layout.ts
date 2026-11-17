import type {Graph} from './model';
import type {LayoutRecord,Point} from './storage';
export function positions(graph:Graph,direction:'TB'|'LR',saved:Record<string,Point>={}) {
  const result:Record<string,Point>=Object.create(null);
  const byId=new Map(graph.nodes.map(n=>[n.id,n]));
  const levels=new Map<number,number>();
  const order=new Map(graph.nodes.map((n,i)=>[n.id,i]));
  for(const node of graph.nodes){
    let d=0;let parent=node.parent;const seen=new Set<string>();
    while(parent && byId.has(parent) && !seen.has(parent)){seen.add(parent);d++;parent=byId.get(parent)!.parent;}
    const slot=levels.get(d)??0;levels.set(d,slot+1);
    result[node.id]=Object.hasOwn(saved,node.id)?saved[node.id]:(direction==='TB'?{x:slot*310,y:d*220}:{x:d*310,y:slot*220});
  }
  // New nodes avoid all existing hand-positioned rectangles without moving them.
  for(const node of graph.nodes){
    if(Object.hasOwn(saved,node.id))continue;
    const p=result[node.id];let attempts=0;
    while(Object.entries(result).some(([id,q])=>id!==node.id && (Object.hasOwn(saved,id) || order.get(id)!<order.get(node.id)!) && Math.abs(q.x-p.x)<290 && Math.abs(q.y-p.y)<200) && attempts++<graph.nodes.length+1){if(direction==='TB')p.x+=310;else p.y+=220;}
  }
  return result;
}
export function initialLayout(id:string,graph:Graph,saved:LayoutRecord|null):LayoutRecord {
  const direction=saved?.direction??'TB';
  return {schemaVersion:1,conversationId:id,nodePositions:positions(graph,direction,saved?.nodePositions),viewport:saved?.viewport??{x:50,y:45,zoom:0.85},direction,selectedNodeId:graph.nodes.some(n=>n.id===saved?.selectedNodeId)?saved!.selectedNodeId:null,updatedAt:saved?.updatedAt??new Date().toISOString()};
}
