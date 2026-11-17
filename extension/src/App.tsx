import {useEffect,useLayoutEffect,useMemo,useRef,useState,type ReactNode} from 'react';
import {Background,Controls,Handle,Position,ReactFlow,ReactFlowProvider,applyNodeChanges,type Node,type NodeProps,type ReactFlowInstance} from '@xyflow/react';
import {fixtures} from './fixtures';
import {preview,project,search,type Fixture,type Message,type VisibleRole} from './model';
import {initialLayout,positions} from './layout';
import {IndexedLayoutStore,type LayoutRecord,type LayoutStore} from './storage';

const stateNames={active:'活动路径',inactive:'非活动',unknown:'活动未知'};
const roleNames:Record<VisibleRole,string>={user:'用户',assistant:'AI 回答',unknown:'角色未知'};
type CardNode=Node<{message:Message;match:boolean;direction:'TB'|'LR'},'message'>;
function MessageCard({data,selected}:NodeProps<CardNode>){
  const p=preview(data.message.text);
  return <div className={`message-card ${data.message.role} ${data.message.active} ${selected?'chosen':''} ${data.match?'match':''}`}>
    <Handle type="target" position={data.direction==='TB'?Position.Top:Position.Left} isConnectable={false}/>
    <div className="card-meta"><strong>{roleNames[data.message.role]}</strong><span title={data.message.id}>{data.message.id}</span></div>
    <p>{p.text}</p><footer><span>{stateNames[data.message.active]}</span>{data.message.contentStatus==='truncated' ? <span>采样正文已截断</span> : p.truncated && <span>预览已截断</span>}{data.message.relation==='unknown' && <span>关系未知</span>}</footer>
    <Handle type="source" position={data.direction==='TB'?Position.Bottom:Position.Right} isConnectable={false}/>
  </div>;
}
const nodeTypes={message:MessageCard};
export function SafeContent({text}:{text?:string}){
  // M1 deliberately renders plain text: no HTML injection, URL linking or remote media.
  return <div className="message-body">{text??'内容不可读取。此处仅展示占位，不补造消息正文。'}</div>;
}
export function SaveStatus({status}:{status:string}){return <span role="status" className={status.includes('失败')?'save-error':'save-status'}>{status}</span>;}

export function Workspace({fixture,store,onChoose,liveControls}:{fixture:Fixture;store:LayoutStore;onChoose?:(id:string)=>void;liveControls?:ReactNode}){
  const live=liveControls!==undefined;
  const [extra,setExtra]=useState(false);
  const graph=useMemo(()=>project(extra?{...fixture,messages:[...fixture.messages,{id:'m1-added',parentId:fixture.messages.find(m=>m.role==='assistant')?.id??null,role:'user',text:'这是追加的合成节点。原有手动位置应保持不变。'}]}:fixture,!live),[fixture,extra,live]);
  const [record,setRecord]=useState<LayoutRecord|null>(null);
  const latest=useRef<LayoutRecord|null>(null);
  const [nodes,setNodes]=useState<CardNode[]>([]);
  const [query,setQuery]=useState('');
  const [status,setStatus]=useState('正在读取本地布局…');
  const [loadError,setLoadError]=useState(false);const [retry,setRetry]=useState(0);
  const [flow,setFlow]=useState<ReactFlowInstance<CardNode>|null>(null);
  const revision=useRef(0);const alive=useRef(true);
  useEffect(()=>{alive.current=true;return()=>{alive.current=false;};},[]);
  useEffect(()=>{
    let cancelled=false;setLoadError(false);setStatus('正在读取本地布局…');
    store.load(fixture.id).then(saved=>{if(cancelled)return;const r=initialLayout(fixture.id,graph,saved);latest.current=r;setRecord(r);setStatus(live?'布局仅在本窗口可用':saved?'已恢复本地布局':'尚无保存记录');}).catch(()=>{if(!cancelled){setLoadError(true);setStatus('读取失败：未覆盖原布局，请重试');}});
    return()=>{cancelled=true;};
    // Graph additions reconcile below, never trigger a stale storage reload.
  },[fixture.id,store,retry]);
  const matches=useMemo(()=>search(graph.nodes,query),[graph,query]);
  const matchIds=new Set(matches.map(n=>n.id));
  useLayoutEffect(()=>{
    if(!record)return;
    setNodes(previous=>graph.nodes.map(n=>({...previous.find(old=>old.id===n.id),id:n.id,type:'message',position:Object.hasOwn(record.nodePositions,n.id)?record.nodePositions[n.id]:{x:0,y:0},selected:record.selectedNodeId===n.id,data:{message:n,match:matchIds.has(n.id),direction:record.direction}})));
  },[record,graph,query]);
  useLayoutEffect(()=>{
    const current=latest.current;
    if(!live || !current)return;
    const selectedNodeId=graph.nodes.some(n=>n.id===current.selectedNodeId)?current.selectedNodeId:null;
    const next={...current,nodePositions:positions(graph,current.direction,current.nodePositions),selectedNodeId};
    latest.current=next;setRecord(next);
  },[graph,live]);
  function save(next:LayoutRecord){
    latest.current=next;setRecord(next);const version=++revision.current;setStatus('正在保存布局…');
    void store.save(next).then(()=>{if(alive.current && revision.current===version)setStatus(live?'布局已更新（仅本窗口）':'布局已保存');}).catch(()=>{if(alive.current && revision.current===version)setStatus('保存失败：本次布局尚未保存，请重试');});
  }
  function update(patch:Partial<LayoutRecord>){if(latest.current)save({...latest.current,...patch,updatedAt:new Date().toISOString()});}
  useEffect(()=>{if(extra && latest.current)update({nodePositions:positions(graph,latest.current.direction,latest.current.nodePositions)});},[extra]);
  // Only explicit selection events may write back; stale selection snapshots must not.
  function select(id:string,center=false){
    if(latest.current?.selectedNodeId!==id)update({selectedNodeId:id});
    const p=latest.current?.nodePositions[id];
    if(center && p)void flow?.setCenter(p.x+130,p.y+85,{zoom:1,duration:0});
  }
  const selected=graph.nodes.find(n=>n.id===record?.selectedNodeId);
  return <div className="app-shell">
    <header className="topbar"><div><strong className="brand">对话地图</strong><span className="test-badge">{live?'M2 当前会话只读':'M1 合成测试模式'}</span></div><span className="privacy-note">{live?'仅当前已挂载消息 · 历史完整性未知':'只读样本 · 不连接真实聊天'}</span></header>
    <aside className="sidebar">{live ? liveControls : <>
      <h1>沿着问题，<br/>看见不同回答。</h1><p className="intro">每个节点是一条消息，每条线都有父关系依据。</p>
      <label htmlFor="fixture">合成场景</label><select id="fixture" value={fixture.id} onChange={e=>onChoose?.(e.target.value)}>{fixtures.map(f=><option key={f.id} value={f.id}>{f.name}</option>)}</select>
      <p className="scenario-description">{fixture.description}</p>
      </>}
      <label htmlFor="search">{live?'搜索已采样的正文':'搜索已加载的样本文本'}</label><input id="search" type="search" value={query} placeholder="例如：关系、布局…" onChange={e=>setQuery(e.target.value)}/>
      <p className="result-count">{query.trim()?`${matches.length} 条匹配消息`:`${graph.nodes.length} 条消息 / ${graph.edges.length} 条已证实连线`}</p>
      <nav aria-label="搜索结果" className="results">{matches.map(n=><button disabled={!record} key={n.id} onClick={()=>select(n.id,true)}><strong>{n.role==='assistant'?'AI':roleNames[n.role]} · {n.id}</strong><span>{preview(n.text,65).text}</span></button>)}{query.trim() && matches.length===0 && <p>没有匹配结果。搜索仅覆盖已加载的文本。</p>}</nav>
      <div className="legend"><span className="legend-active">活动路径</span><span className="legend-selected">选中消息</span><span className="legend-match">搜索命中</span><span>虚线卡片：状态未知</span></div>
    </aside>
    <main className="map-area"><div className="map-toolbar"><div><strong>{fixture.name}</strong><small>{graph.activeKnown?(live?'活动路径已知':'合成活动路径已知'):'活动路径未知'}</small></div><div className="tools"><button disabled={!record} onClick={()=>void flow?.fitView({padding:0.2,duration:0})}>适配视图</button><button disabled={!record} onClick={()=>{if(record){const direction=record.direction==='TB'?'LR':'TB';update({direction,nodePositions:positions(graph,direction)});}}}>重排为{record?.direction==='LR'?'纵向':'横向'}</button>{!live && <button disabled={!record||extra} onClick={()=>setExtra(true)}>追加测试节点</button>}</div></div>
      {graph.issues.length>0 && <details className="issues"><summary>发现 {graph.issues.length} 项关系异常 · 已安全隔离</summary><ul>{graph.issues.map((issue,i)=><li key={i}>{issue}</li>)}</ul></details>}
      <div className="canvas" data-testid="canvas">{record ? <ReactFlow<CardNode> nodes={nodes} edges={graph.edges.map(e=>({id:JSON.stringify([e.source,e.target]),source:e.source,target:e.target,type:'smoothstep',style:{stroke:graph.nodes.find(n=>n.id===e.target)?.active==='active'?'#247aa3':'#a3b4c0',strokeWidth:graph.nodes.find(n=>n.id===e.target)?.active==='active'?2.5:1.4}}))} nodeTypes={nodeTypes} onInit={setFlow} defaultViewport={record.viewport} minZoom={0.1} maxZoom={3} nodesConnectable={false} edgesFocusable={false} deleteKeyCode={null} onNodesChange={changes=>{setNodes(ns=>applyNodeChanges(changes,ns));const selection=changes.find(change=>change.type==='select' && change.selected);if(selection?.type==='select')select(selection.id);}} onNodeClick={(_,node)=>select(node.id)} onNodeDragStop={(_,node)=>update({nodePositions:{...latest.current!.nodePositions,[node.id]:node.position}})} onMoveEnd={(_,viewport)=>update({viewport})}><Background color="#c8d6df" gap={24}/><Controls showInteractive={false}/></ReactFlow>:<div className="loading">{loadError?'无法恢复布局。为保护原记录，地图暂未启用。':'正在准备消息地图…'}{loadError && <button onClick={()=>setRetry(n=>n+1)}>重试读取</button>}</div>}</div>
      <footer className="map-footer"><SaveStatus status={status}/>{status.startsWith('保存失败') && <button onClick={()=>latest.current && save(latest.current)}>重试保存</button>}<span>拖动节点调整位置 · 滚轮缩放 · 拖动画布平移</span></footer>
    </main>
    <aside className="inspector" aria-label="消息详情"><h2>消息详情</h2>{selected?<><div className="detail-meta"><strong>{selected.role==='user'?'用户消息':roleNames[selected.role]}</strong><code>{selected.id}</code></div><p className="state-label">{stateNames[selected.active]} · {selected.relation==='unknown'?'父关系未知':selected.relation==='root'?'已证实的根节点':'父关系已证实'}{selected.contentStatus==='truncated'?' · 采样正文已截断':''}</p><SafeContent text={selected.text}/><details className="evidence"><summary>查看关系依据</summary><p>父节点：{selected.parent??(selected.relation==='root'?'无（已证实根）':'未知')}</p><p>原始链：{selected.evidence.join(' ← ')||'证据不完整'}</p></details></>:<div className="empty-detail"><span className="empty-glyph">◎</span><h3>选择一条消息</h3><p>点击节点查看正文和关系依据。选中不会改变活动路径。</p></div>}<p className="plain-note">正文以纯文本安全显示；Markdown、链接与图片均不执行或外联。</p></aside>
  </div>;
}
const defaultStore=new IndexedLayoutStore();
export function App({store=defaultStore}:{store?:LayoutStore}){
  const [id,setId]=useState<string|null>(null);const [preferenceError,setPreferenceError]=useState(false);
  useEffect(()=>{let alive=true;store.last().then(saved=>{if(alive)setId(fixtures.some(f=>f.id===saved)?saved:'branches');}).catch(()=>{if(alive){setId('branches');setPreferenceError(true);}});return()=>{alive=false;};},[store]);
  if(!id)return <p className="loading">正在打开合成测试地图…</p>;
  return <>{preferenceError && <div role="alert" className="preference-error">场景偏好存储失败；地图布局将单独报告保存状态。<button onClick={()=>{void store.remember(id).then(()=>setPreferenceError(false)).catch(()=>setPreferenceError(true));}}>重试</button></div>}<ReactFlowProvider key={id}><Workspace fixture={fixtures.find(f=>f.id===id)!} store={store} onChoose={next=>{setId(next);void store.remember(next).then(()=>setPreferenceError(false)).catch(()=>setPreferenceError(true));}}/></ReactFlowProvider></>;
}
