/* 校验：旧内容永远盖不掉新内容（离线老操作回放 / 两设备互相覆盖） */
const fs=require('fs'),path=require('path'),vm=require('vm');
const DIR='/Users/chewang/Desktop/Ai workshop /codex/tutorial/task-sync-app';
const read=p=>fs.readFileSync(path.join(DIR,p),'utf8');
const ls=new Map();
const win={localStorage:{getItem:k=>ls.has(k)?ls.get(k):null,setItem:(k,v)=>ls.set(k,String(v)),removeItem:k=>ls.delete(k)},
  addEventListener(){},document:{hidden:false,addEventListener(){}},navigator:{userAgent:'node'},
  TextEncoder,TextDecoder,btoa:s=>Buffer.from(s,'binary').toString('base64'),atob:s=>Buffer.from(s,'base64').toString('binary')};
win.window=win;
const ctx=vm.createContext(win);
ctx.setTimeout=setTimeout;ctx.clearTimeout=clearTimeout;ctx.setInterval=()=>0;ctx.clearInterval=()=>{};ctx.console=console;
vm.runInContext(read('js/core.js'),ctx);vm.runInContext(read('js/store.js'),ctx);
const Core=win.Core,Store=win.Store;

const remote={files:{'tasks.json':[],'checkins.json':[],'settings.json':{devices:{}}},sha:{}};
const b64=s=>Buffer.from(s,'utf8').toString('base64');
const ub64=s=>Buffer.from(s,'base64').toString('utf8');
let puts=0;
win.fetch=async(url,opts={})=>{
  const f=String(url).split('/').pop().split('?')[0];
  const m=((opts&&opts.method)||'GET').toUpperCase();
  if(m==='GET') return {ok:true,status:200,headers:{get:()=>null},json:async()=>({content:b64(JSON.stringify(remote.files[f])),sha:remote.sha[f]||'s0'})};
  const body=JSON.parse(opts.body);
  remote.files[f]=JSON.parse(ub64(body.content));remote.sha[f]='s'+(++puts);
  return {ok:true,status:200,headers:{get:()=>null},json:async()=>({content:{sha:remote.sha[f]}})};
};
ctx.fetch=win.fetch;
const CFG={owner:'o',repo:'r',files:{tasks:'tasks.json',checkins:'checkins.json',settings:'settings.json'},defaults:{}};
const R=[];const ok=(n,c,x)=>R.push({n,pass:!!c,x});
const ob=()=>JSON.parse(ls.get('ts_outbox_v2')||'[]');

(async()=>{
  const NEW={id:'m1',kind:'memo',title:'琐事',memo:'很多很多内容',updatedAt:'2026-09-13T09:50:25.352Z'};
  const OLD={id:'m1',kind:'memo',title:'琐事',memo:'很短',updatedAt:'2026-09-13T09:44:03.042Z'};
  remote.files['tasks.json']=[NEW];
  const s=new Store(CFG);s.token='t';s.init();
  s.files.tasks.value=[NEW];s.files.tasks.loaded=true;

  // 老设备把旧内容推上去（直接模拟远端已被写旧，再看本机能否守住）
  ok('1 旧内容不许覆盖新内容', (()=>{const r=Core.applyOp('tasks',[NEW],{file:'tasks',type:'task_set',task:OLD});return !r.changed && r.value[0].memo==='很多很多内容';})());
  ok('2 新内容可以正常更新', (()=>{const n=Object.assign({},NEW,{memo:'又加了一行',updatedAt:'2026-09-13T10:00:00.000Z'});const r=Core.applyOp('tasks',[NEW],{file:'tasks',type:'task_set',task:n});return r.changed && r.value[0].memo==='又加了一行';})());
  ok('3 新条目照常新增', (()=>{const r=Core.applyOp('tasks',[],{file:'tasks',type:'task_set',task:{id:'x',kind:'keep',title:'新习惯',updatedAt:'2026-09-13T10:00:00.000Z'}});return r.changed&&r.value.length===1;})());
  ok('4 老删除不许删掉新内容', (()=>{const r=Core.applyOp('tasks',[NEW],{file:'tasks',type:'task_delete',id:'m1',at:'2026-09-13T09:45:00.000Z'});return !r.changed&&r.value.length===1;})());
  ok('5 新删除可以删掉老内容', (()=>{const r=Core.applyOp('tasks',[NEW],{file:'tasks',type:'task_delete',id:'m1',at:'2026-09-13T10:10:00.000Z'});return r.changed&&r.value.length===0;})());

  // 6) 端到端：两台新设备抢写同一条，时间新的赢，老的推不上去
  const B=new Store(CFG);B.token='t';B.init();
  const T2='2026-09-13T10:00:00.000Z', T1='2026-09-13T09:00:00.000Z';
  const freshItem={id:'m2',kind:'memo',title:'琐事',memo:'A 刚写的新内容',updatedAt:T2};
  const staleItem={id:'m2',kind:'memo',title:'琐事',memo:'B 手里过期的旧内容',updatedAt:T1};
  remote.files['tasks.json']=[freshItem];remote.sha['tasks.json']='sZ';
  B.files.tasks.value=[staleItem];
  ls.set('ts_outbox_v2',JSON.stringify([{_id:'op-b',file:'tasks',type:'task_set',task:staleItem,at:T1}]));
  await B.flush();
  ok('6 老设备推不动新内容', remote.files['tasks.json'].find(t=>t.id==='m2').memo==='A 刚写的新内容', JSON.stringify(remote.files['tasks.json']));
  ok('7 老设备队列被清掉、本地跟到最新', JSON.parse(ls.get('ts_outbox_v2')||'[]').length===0 && B.files.tasks.value.find(t=>t.id==='m2').memo==='A 刚写的新内容', JSON.stringify(B.files.tasks.value));

  // 8) 新操作自带 at 时间戳
  s.saveTask({id:'m3',kind:'keep',title:'测试',updatedAt:new Date().toISOString()});
  const q=ob(); ok('8 新操作带 at 时间戳', q.length===1 && typeof q[0].at==='string', JSON.stringify(q));

  R.forEach(r=>console.log((r.pass?'PASS':'FAIL')+' '+r.n+(r.pass?'':'  <= '+JSON.stringify(r.x))));
  console.log('总计 '+R.filter(r=>r.pass).length+'/'+R.length);
  process.exit(R.every(r=>r.pass)?0:1);
})();
