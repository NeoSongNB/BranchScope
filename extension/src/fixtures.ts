import type {Fixture, RawMessage} from './model';
const u = (id:string,parentId:string|null,text:string):RawMessage=>({id,parentId,text,role:'user'});
const a = (id:string,parentId:string,text:string):RawMessage=>({id,parentId,text,role:'assistant'});
const base = [u('u1',null,'如何设计一个可信的对话地图？'),a('a1','u1','从真实父关系开始。每条消息保留自己的身份，画布只是它们的另一种视图。'),u('u2','a1','为什么不能按时间连线？'),a('a2','u2','不同分支可以交错生成。时间能够排序，却不能证明上下文关系。')];
export const fixtures: Fixture[] = [
  {id:'linear',name:'简单线性对话',description:'两轮对话，四条独立消息。',messages:base,activeLeaf:'a2'},
  {id:'answers',name:'一个问题 · 多个回答',description:'同一个用户节点连接三个答案，问题不会重复。',messages:[...base.slice(0,2),a('a-alt','u1','另一种方案：先设计稳定 ID，再将每条回答投影为独立节点。'),a('a-third','u1','第三种方案：先准备异常数据，用测试守住真实关系。')],activeLeaf:'a-alt'},
  {id:'branches',name:'多层分支',description:'沿着消息探索不同方案。蓝色连线表示已知的活动路径。',messages:[...base,a('a-alt','u1','我们也可以从只读原型开始。'),u('u-alt','a-alt','第一步验证什么？'),a('a-next','u-alt','验证消息身份、父子关系与布局恢复。'),u('u3','a2','布局应该保留什么？'),a('a3','u3','只保存位置、视口和选择，不保存消息正文。')],activeLeaf:'a-next'},
  {id:'missing',name:'缺失父节点',description:'缺失的关系会被明确标注，不会凭时间补线。',messages:[...base,a('orphan','absent','我的父消息尚未提供。')]},
  {id:'cycle',name:'循环父关系',description:'循环组件保留可见消息，但不画不可信的边。',messages:[u('cycle-u','cycle-a','这是一个循环。'),a('cycle-a','cycle-u','关系不能形成合法的祖先链。')],activeLeaf:'cycle-a'},
  {id:'duplicate',name:'重复消息 ID',description:'隔离冲突身份，不任意选择某个版本。',messages:[...base,a('a1','u1','冲突内容')]},
  {id:'unordered',name:'时间戳乱序',description:'回答时间早于问题也不会改变明确的父关系。',messages:base.map((m,i)=>({...m,createdAt:100-i*10})),activeLeaf:'a2'},
  {id:'hidden',name:'隐藏中间节点',description:'只沿完整父链跨过隐藏消息，保留关系证据。',messages:[u('u1',null,'给我一条面向用户的答案。'),{id:'internal',parentId:'u1',role:'hidden'},a('a1','internal','这是面向用户的回答。'),a('a2','a1','这是另一条独立可见的回答，不按角色合并。')],activeLeaf:'a2'},
  {id:'long',name:'长文本与不可读内容',description:'预览明确标注截断，详情保留完整文本；未知内容使用占位。',messages:[u('u1',null,'请展示长文本和安全渲染样本。'),a('a1','u1','每条消息都有自己的位置。\n'.repeat(100)+'<img src="https://invalid.example/x" onerror="alert(1)">\n[危险链接](javascript:alert(1))\n<script>alert(1)</script>'),{id:'a2',parentId:'u1',role:'assistant'}],activeLeaf:'a1'},
];
