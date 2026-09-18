/* 拖拽不再「卡住」：Esc / 失焦 / 指针跑到窗口外 / 拖动中远端变化（心跳渲染）都要能正常收尾 */
const CDP='http://127.0.0.1:9334', ORIGIN='http://127.0.0.1:8123', URL_=ORIGIN+'/index.html';
const l=await(await fetch(CDP+'/json/list')).json();
const t=l.find(x=>x.type==='page'&&!x.url.startsWith('devtools'));
const ws=new WebSocket(t.webSocketDebuggerUrl);let id=0;const p=new Map();
const send=(m,pa={})=>new Promise((r,j)=>{const i=++id;p.set(i,{r,j});ws.send(JSON.stringify({id:i,method:m,params:pa}))});
await new Promise(r=>ws.addEventListener('open',r));
const errors=[];
ws.addEventListener('message',e=>{const m=JSON.parse(e.data);
  if(m.method==='Runtime.exceptionThrown')errors.push(String(m.params.exceptionDetails.exception?.description||'').slice(0,200));
  if(m.id&&p.has(m.id)){const q=p.get(m.id);p.delete(m.id);m.error?q.j(new Error(JSON.stringify(m.error))):q.r(m.result)}});
await send('Page.enable');await send('Runtime.enable');await send('Network.enable');
const ev=async x=>{const r=await send('Runtime.evaluate',{expression:x,awaitPromise:true,returnByValue:true});
  if(r.exceptionDetails)throw new Error(String(r.exceptionDetails.exception?.description||r.exceptionDetails).slice(0,300));return r.result.value};
const load=u=>new Promise(r=>{const h=e=>{const m=JSON.parse(e.data);if(m.method==='Page.loadEventFired'){ws.removeEventListener('message',h);r()}};ws.addEventListener('message',h);send('Page.navigate',{url:u})});
const wait=ms=>new Promise(r=>setTimeout(r,ms));
const R=[];const ok=(n,c,x)=>R.push({n,pass:!!c,x});
const dump=()=>{console.log('--- 已完成用例 ---');R.forEach(r=>console.log((r.pass?'PASS ':'FAIL ')+r.n+(r.pass?'':'  <= '+JSON.stringify(r.x))));
  console.log('总计 '+R.filter(r=>r.pass).length+'/'+R.length)};
process.on('uncaughtException',async e=>{console.log('CRASH: '+e.message);try{dump()}catch(_){}process.exit(1)});
process.on('unhandledRejection',async e=>{console.log('CRASH: '+(e&&e.message||e));try{dump()}catch(_){}process.exit(1)});

const MOCK=`(()=>{
  const KEY='__mock_remote';
  const b64=s=>btoa(unescape(encodeURIComponent(s)));
  const ub64=s=>decodeURIComponent(escape(atob(s)));
  const seed=()=>({files:{'tasks.json':[],'checkins.json':[],'settings.json':{devices:{}}},sha:{},puts:0,gets:0});
  const read=()=>{try{return JSON.parse(localStorage.getItem(KEY))||seed()}catch(e){return seed()}};
  const save=st=>localStorage.setItem(KEY,JSON.stringify(st));
  window.__mock={files:()=>read().files,setRemote:(f,v)=>{const st=read();st.files[f]=v;save(st)}};
  window.fetch=async(url,opts={})=>{
    const f=String(url).split('/').pop().split('?')[0];
    const m=((opts&&opts.method)||'GET').toUpperCase();
    const st=read();
    if(m==='GET'){save(st);return {ok:true,status:200,headers:{get:()=>null},
      json:async()=>({content:b64(JSON.stringify(st.files[f]===undefined?[]:st.files[f])),sha:'s'+(st.puts||0)})}}
    const body=JSON.parse(opts.body);
    st.files[f]=JSON.parse(ub64(body.content));st.puts=(st.puts||0)+1;st.sha[f]='s'+st.puts;save(st);
    return {ok:true,status:200,headers:{get:()=>null},json:async()=>({content:{sha:st.sha[f]}})};
  };
  localStorage.setItem('ts_token_v1','fake-token');})();`;

const press=async(pt)=>send('Input.dispatchMouseEvent',{type:'mousePressed',x:pt.x,y:pt.y,button:'left',buttons:1,clickCount:1});
const moveTo=async(pt,btn=1)=>send('Input.dispatchMouseEvent',{type:'mouseMoved',x:pt.x,y:pt.y,button:'left',buttons:btn});
const release=async(pt)=>send('Input.dispatchMouseEvent',{type:'mouseReleased',x:pt.x,y:pt.y,button:'left',buttons:0,clickCount:1});
const trash=()=>`({ph:!!document.querySelector('.sort-ph'),float:!!document.querySelector('body > .is-sorting'),
  lock:document.body.classList.contains('is-dragging')})`;
const clean=async()=>{const r=await ev(trash());return !r.ph&&!r.float&&!r.lock};
const board=()=>`(()=>{const out=[];let cur=null;[...document.querySelector('#work-board').children].forEach(el=>{
  if(el.classList.contains('wb-head')){cur=el.dataset.bucket;return}
  if(el.dataset&&el.dataset.id)out.push(cur+':'+el.dataset.id)});return out.join(',')})()`;
function shiftDays(n){const x=new Date();x.setDate(x.getDate()+n);const p2=v=>(v<10?'0'+v:''+v);
  return x.getFullYear()+'-'+p2(x.getMonth()+1)+'-'+p2(x.getDate());}

await send('Storage.clearDataForOrigin',{origin:ORIGIN,storageTypes:'all'});
await send('Network.setCacheDisabled',{cacheDisabled:true});
await send('Emulation.setDeviceMetricsOverride',{width:1280,height:900,deviceScaleFactor:1,mobile:false});
await send('Page.addScriptToEvaluateOnNewDocument',{source:MOCK});
await load(URL_);await wait(1200);
const seed=[{id:'wa',kind:'work',title:'甲甲',created:shiftDays(-1),due:shiftDays(0),done:false,notes:[],updatedAt:new Date().toISOString()},
            {id:'wb',kind:'work',title:'乙乙',created:shiftDays(-1),due:shiftDays(0),done:false,notes:[],updatedAt:new Date().toISOString()},
            {id:'wc',kind:'work',title:'丙丙',created:shiftDays(-1),due:shiftDays(0),done:false,notes:[],updatedAt:new Date().toISOString()}];
await ev(`(()=>{window.__mock.setRemote('tasks.json',${JSON.stringify(seed)});
  localStorage.removeItem('ts_state_v2');localStorage.removeItem('ts_outbox_v2');return 1})()`);
await load(URL_);await wait(1800);
const goTab=async(k)=>{for(let i=0;i<8;i++){await ev(`(()=>{const t=document.querySelector('.tab[data-tab="${k}"]');if(t)t.click();return 1})()`);await wait(250);
  if(await ev(`!!document.querySelector('.tab[data-tab="${k}"].active')`)){await wait(250);return true}}return false};
ok('0 切到公司页', await goTab('work'));
const startPt=async()=>ev(`(()=>{const el=document.querySelector('#work-board .item-card .task-title');const r=el.getBoundingClientRect();
  return {x:r.left+r.width/2,y:r.top+r.height/2}})()`);
const lower=async()=>ev(`(()=>{const ls=[...document.querySelectorAll('#work-board .item-card .task-title')];
  const r=ls[ls.length-1].getBoundingClientRect();return {x:r.left+r.width/2,y:r.bottom+40}})()`);

/* --- 1) Esc 取消：不该留残骸，也不该改数据 --- */
const before1=String(await ev(board()));
let s1=await startPt();
await press(s1);await wait(50);
let l1=await lower();
for(let i=1;i<=6;i++){await moveTo({x:s1.x,y:s1.y+(l1.y-s1.y)*i/6});await wait(25)}
ok('1a 已经进入拖动', (await ev(`document.body.classList.contains('is-dragging')`))===true);
await send('Input.dispatchKeyEvent',{type:'keyDown',key:'Escape',code:'Escape',windowsVirtualKeyCode:27,nativeVirtualKeyCode:27});
await send('Input.dispatchKeyEvent',{type:'keyUp',key:'Escape',code:'Escape',windowsVirtualKeyCode:27,nativeVirtualKeyCode:27});
await wait(500);
ok('1b Esc 后残骸清干净（浮卡/占位/锁都没了）', await clean(), await ev(trash()));
ok('1c Esc 后顺序没变', String(await ev(board()))===before1, before1+' -> '+await ev(board()));
await release(s1);await wait(300);
ok('1d 松手后也没留下东西', await clean(), await ev(trash()));

/* --- 2) 拖动中窗口失焦（比如切到别的 App/浏览器） --- */
let s2=await startPt();
await press(s2);await wait(50);
let l2=await lower();
for(let i=1;i<=6;i++){await moveTo({x:s2.x,y:s2.y+(l2.y-s2.y)*i/6});await wait(25)}
ok('2a 已经进入拖动', (await ev(`document.body.classList.contains('is-dragging')`))===true);
await ev(`window.dispatchEvent(new Event('blur'))`);await wait(500);
ok('2b 失焦后残骸清干净', await clean(), await ev(trash()));
await release(s2);await wait(200);
ok('2c 失焦后页面还能正常点 tab', await goTab('plan') && await goTab('work'));

/* --- 3) 指针在窗口外松开：下一次 move 的 buttons=0 应该收尾 --- */
let s3=await startPt();
await press(s3);await wait(50);
let l3=await lower();
for(let i=1;i<=6;i++){await moveTo({x:s3.x,y:s3.y+(l3.y-s3.y)*i/6});await wait(25)}
ok('3a 已经进入拖动', (await ev(`document.body.classList.contains('is-dragging')`))===true);
/* 在窗口外松手：事件流里下一次 move 的 buttons 已经是 0（CDP 不会真给你这个状态，所以直接派发） */
await ev(`window.dispatchEvent(new PointerEvent('pointermove',{pointerType:'mouse',buttons:0,clientY:${Math.round(s3.y + 120)},clientX:${Math.round(s3.x)},bubbles:true}))`);
await wait(600);
ok('3b 窗口外松手后残骸清干净', await clean(), await ev(trash()));
ok('3c 页面没被锁住', (await ev(`!document.body.classList.contains('is-dragging')`))===true);

/* --- 4) 拖动中远端数据变了（心跳渲染）：不能把拖动中的卡片变成孤儿 --- */
await ev(`window.__boardNode=document.querySelector('#work-board');window.__boardText=document.querySelector('#work-board').textContent.length`);
let s4=await startPt();
await press(s4);await wait(50);
let l4=await lower();
for(let i=1;i<=5;i++){await moveTo({x:s4.x,y:s4.y+(l4.y-s4.y)*i/5});await wait(30)}
ok('4a 已经进入拖动', (await ev(`document.body.classList.contains('is-dragging')`))===true);
/* 远端插入一条 + 等心跳（5 秒一轮）：没有护栏时这里会重建 DOM，把手上这张卡片变成孤儿 */
await ev(`(()=>{const f=window.__mock.files()['tasks.json'];
  window.__mock.setRemote('tasks.json', f.concat([{id:'wz',kind:'work',title:'远端新来的',created:'2026-09-18',due:'2026-09-18',done:false,notes:[],updatedAt:new Date().toISOString()}]));return 1})()`);
await wait(7000);
ok('4b 拖动中即使远端变了，排序板节点也没被换掉', (await ev(`document.querySelector('#work-board')===window.__boardNode`))===true);
ok('4c 手上这张卡片还在（没有变孤儿）', (await ev(`!!document.querySelector('body > .is-sorting')`))===true);
await release(l4);await wait(1500);
ok('4d 松手后残骸清干净', await clean(), await ev(trash()));
ok('4e 松手后顺序提交了、远端也收到了', (await ev(`window.__mock.files()['tasks.json'].some(t=>t.id==='wz')`))===true);
ok('4f 补渲染生效：远端新条目已出现在公司页', (await ev(`document.querySelector('#work-board').textContent.indexOf('远端新来的')>=0`))===true,
  await ev(`document.querySelector('#work-board').textContent.slice(0,80)`));
ok('4g 全程无 JS 报错', errors.length===0, errors.slice(0,2));
dump();
process.exit(R.every(r=>r.pass)?0:1);
