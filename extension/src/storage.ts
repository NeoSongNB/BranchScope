export type Point = {x:number;y:number};
export type LayoutRecord = {schemaVersion:1;conversationId:string;nodePositions:Record<string,Point>;viewport:Point & {zoom:number};direction:'TB'|'LR';selectedNodeId:string|null;updatedAt:string};
export interface LayoutStore {load(id:string):Promise<LayoutRecord|null>;save(record:LayoutRecord):Promise<void>;last():Promise<string|null>;remember(id:string):Promise<void>}
const finite = (n:unknown):n is number=>typeof n==='number' && Number.isFinite(n);
// Allowlist serialization: extra fields (including message bodies) never reach storage.
export function cleanLayout(value:unknown, expectedId?:string):LayoutRecord {
  const v = value as LayoutRecord;
  if (!v || v.schemaVersion!==1 || typeof v.conversationId!=='string' || (expectedId && v.conversationId!==expectedId) || !['TB','LR'].includes(v.direction) || !v.viewport || !finite(v.viewport.x)||!finite(v.viewport.y)||!finite(v.viewport.zoom)||v.viewport.zoom<0.1||v.viewport.zoom>3 || !v.nodePositions || typeof v.nodePositions!=='object' || (v.selectedNodeId!==null && typeof v.selectedNodeId!=='string') || typeof v.updatedAt!=='string') throw new Error('布局记录损坏或版本不支持；原记录未覆盖');
  const entries = Object.entries(v.nodePositions).map(([id,p])=>{
    if (!p || !finite(p.x)||!finite(p.y)) throw new Error('布局坐标无效');
    return [id,{x:p.x,y:p.y}] as const;
  });
  return {schemaVersion:1,conversationId:v.conversationId,nodePositions:Object.fromEntries(entries),viewport:{x:v.viewport.x,y:v.viewport.y,zoom:v.viewport.zoom},direction:v.direction,selectedNodeId:v.selectedNodeId,updatedAt:v.updatedAt};
}
export class IndexedLayoutStore implements LayoutStore {
  private pending:Promise<void>=Promise.resolve();
  constructor(private name='conversation-map-m1'){}
  private open():Promise<IDBDatabase> {return new Promise((resolve,reject)=>{
    const request=indexedDB.open(this.name,1);
    request.onupgradeneeded=()=>{request.result.createObjectStore('layouts');request.result.createObjectStore('preferences');};
    request.onerror=()=>reject(new Error('无法打开布局存储'));
    request.onblocked=()=>reject(new Error('布局存储被另一窗口阻塞，请关闭旧测试窗口'));
    request.onsuccess=()=>{request.result.onversionchange=()=>request.result.close();resolve(request.result);};
  });}
  private async transaction(store:string,key:string,value?:unknown):Promise<unknown> {
    const db=await this.open();
    return new Promise((resolve,reject)=>{
      const tx=db.transaction(store,value===undefined?'readonly':'readwrite');
      const req=value===undefined?tx.objectStore(store).get(key):tx.objectStore(store).put(value,key);
      tx.oncomplete=()=>{db.close();resolve(req.result);};
      tx.onerror=tx.onabort=()=>{db.close();reject(new Error('布局存储操作失败'));};
    });
  }
  async load(id:string){await this.pending;const v=await this.transaction('layouts',id);return v===undefined?null:cleanLayout(v,id);}
  async save(record:LayoutRecord){const clean=cleanLayout(record);const task=this.pending.then(async()=>{await this.transaction('layouts',clean.conversationId,clean);});this.pending=task.catch(()=>{});await task;}
  async last(){const id=await this.transaction('preferences','fixture');return typeof id==='string'?id:null;}
  async remember(id:string){await this.transaction('preferences','fixture',id);}
}
