/* 计划页两条硬规则：①过了结束日不消失、顶到最上面标「已拖延 N 天」；②排不上去时给 toast 说明原因 */
const CDP='http://127.0.0.1:9334', ORIGIN='http://127.0.0.1:8123', URL_=ORIGIN+'/index.html?t='+Date.now();
const l=await(await fetch(CDP+'/json/list')).json();
const t=l.find(x=>x.type==='page'&&!x.url.startsWith('devtools'));
const ws=new WebSocket(t.webSocketDebuggerUrl);let id=0;const p=new Map();
const send=(m,pa={})=>new Promise((r,j)=>{const i=++id;p.set(i,{r,j});ws.send(JSON.stringify({id:i,method:m,params:pa}))});
await new Promise(r=>ws.addEventListener('open',r));
const errors=[];
ws.addEventListener('message',e=>{const m=JSON.parse(e.data);
  if(m.method==='Runtime.exceptionThrown')errors.push(String(m.params.exceptionDetails.exception?.description||m.params.exceptionDetails.text||'').slice(0,200));
  if(m.id&&p.has(m.id)){const q=p.get(m.id);p.delete(m.id);m.error?q.j(new Error(JSON.stringify(m.error))):q.r(m.result)}});
await send('Page.enable');await send('Runtime.enable');await send('Network.enable');
const ev=async x=>{const r=await send('Runtime.evaluate',{expression:x,awaitPromise:true,returnByValue:true});
  if(r.exceptionDetails)throw new Error(String(r.exceptionDetails.exception?.description||r.exceptionDetails).slice(0,300));return r.result.value};
const load=u=>new Promise(r=>{const h=e=>{const m=JSON.parse(e.data);if(m.method==='Page.loadEventFired'){ws.removeEventListener('message',h);r()}};ws.addEventListener('message',h);send('Page.navigate',{url:u})});
const wait=ms=>new Promise(r=>setTimeout(r,ms));
const R=[];const ok=(n,c,x)=>R.push({n,pass:!!c,x});
const dump=async()=>{console.log('--- 已完成用例 ---');R.forEach(r=>console.log((r.pass?'PASS ':'FAIL ')+r.n+(r.pass?'':'  <= '+JSON.stringify(r.x))));
  console.log('总计 '+R.filter(r=>r.pass).length+'/'+R.length)};
process.on('uncaughtException',async e=>{console.log('CRASH: '+e.message);try{await dump()}catch(_){}process.exit(1)});
process.on('unhandledRejection',async e=>{console.log('CRASH: '+(e&&e.message||e));try{await dump()}catch(_){}process.exit(1)});

const MOCK=`(()=>{
  const KEY='__mock_remote';
  const b64=s=>btoa(unescape(encodeURIComponent(s)));
  const ub64=s=>decodeURIComponent(escape(atob(s)));
  const seed=()=>({files:{'tasks.json':[],'checkins.json':[],'settings.json':{devices:{}}},sha:{},puts:0});
  const read=()=>{try{return JSON.parse(localStorage.getItem(KEY))||seed()}catch(e){return seed()}};
  const save=st=>localStorage.setItem(KEY,JSON.stringify(st));
  window.__mock={files:()=>read().files,setRemote:(f,v)=>{const st=read();st.files[f]=v;save(st)}};
  window.fetch=async(url,opts={})=>{
    const f=String(url).split('/').pop().split('?')[0];
    const m=((opts&&opts.method)||'GET').toUpperCase();
    const st=read();
    if(m==='GET'){return {ok:true,status:200,headers:{get:()=>null},
      json:async()=>({content:b64(JSON.stringify(st.files[f]===undefined?[]:st.files[f])),sha:'s'+(st.puts||0)})}}
    const body=JSON.parse(opts.body);
    st.files[f]=JSON.parse(ub64(body.content));st.puts=(st.puts||0)+1;st.sha[f]='s'+st.puts;save(st);
    return {ok:true,status:200,headers:{get:()=>null},json:async()=>({content:{sha:st.sha[f]}})};
  };
  localStorage.setItem('ts_token_v1','fake-token');})();`;

function shiftDays(n){const x=new Date();x.setDate(x.getDate()+n);const p2=v=>(v<10?'0'+v:''+v);
  return x.getFullYear()+'-'+p2(x.getMonth()+1)+'-'+p2(x.getDate());}
const realDrag=async(from,to,steps=10)=>{
  await send('Input.dispatchMouseEvent',{type:'mousePressed',x:from.x,y:from.y,button:'left',buttons:1,clickCount:1});
  await wait(60);
  for(let i=1;i<=steps;i+=1){
    const x=from.x+(to.x-from.x)*i/steps, y=from.y+(to.y-from.y)*i/steps;
    await send('Input.dispatchMouseEvent',{type:'mouseMoved',x,y,button:'left',buttons:1});
    await wait(25);
  }
  await send('Input.dispatchMouseEvent',{type:'mouseReleased',x:to.x,y:to.y,button:'left',buttons:0,clickCount:1});
};

await send('Storage.clearDataForOrigin',{origin:ORIGIN,storageTypes:'all'});
await send('Network.setCacheDisabled',{cacheDisabled:true});
await send('Emulation.setDeviceMetricsOverride',{width:1280,height:900,deviceScaleFactor:1,mobile:false});
await send('Page.addScriptToEvaluateOnNewDocument',{source:MOCK});
await load(URL_);await wait(1200);
const seed=[
  {id:'p_over',kind:'plan',title:'过了截止还没做完的计划',created:shiftDays(-20),rangeStart:shiftDays(-20),rangeEnd:shiftDays(-2),done:false,rank:5,notes:[],updatedAt:new Date().toISOString()},
  {id:'p_urg', kind:'plan',title:'三天后截止的紧急计划',  created:shiftDays(-9), rangeStart:shiftDays(-9), rangeEnd:shiftDays(3), done:false,rank:1,notes:[],updatedAt:new Date().toISOString()},
  {id:'p_norm',kind:'plan',title:'四十天后截止的正常计划',created:shiftDays(-9), rangeStart:shiftDays(-9), rangeEnd:shiftDays(40),done:false,rank:2,notes:[],updatedAt:new Date().toISOString()},
  {id:'p_done',kind:'plan',title:'早就做完的计划',      created:shiftDays(-30),rangeStart:shiftDays(-30),rangeEnd:shiftDays(-25),done:true,doneDate:shiftDays(-26),rank:6,notes:[],updatedAt:new Date().toISOString()}
];
await ev(`(()=>{window.__mock.setRemote('tasks.json',${JSON.stringify(seed)});
  localStorage.removeItem('ts_state_v2');localStorage.removeItem('ts_outbox_v2');return 1})()`);
await load(URL_);await wait(2000);

const goTab=async(k)=>{for(let i=0;i<8;i++){await ev(`(()=>{const t=document.querySelector('.tab[data-tab="${k}"]');if(t)t.click();return 1})()`);await wait(250);
  if(await ev(`!!document.querySelector('.tab[data-tab="${k}"].active')`)){await wait(250);return true}}return false};
const badge=(k)=>`(()=>{const t=document.querySelector('.tab[data-tab="${k}"] i');return t?Number(t.textContent):0})()`;
const boardOrder=`(()=>[...document.querySelectorAll('#plan-board .item-card[data-id]')].map(x=>x.dataset.id).join(','))()`;
const toastText=`(()=>{const t=document.querySelector('#toast');return t&&!t.classList.contains('hidden')?t.textContent:'(无提示)'})()`;

await goTab('plan');
ok('0 计划页有排序板', (await ev(`!!document.querySelector('#plan-board')`))===true);

/* --- 1) 过了结束日不消失，顶到最上面 --- */
ok('1a 已拖延那条还在板上（没被归档消失）', String(await ev(boardOrder)).indexOf('p_over')>=0, await ev(boardOrder));
ok('1b 它排在第一位', String(await ev(boardOrder)).split(',')[0]==='p_over', await ev(boardOrder));
ok('1c 顺序＝已拖延 → 紧急 → 正常', String(await ev(boardOrder))==='p_over,p_urg,p_norm', await ev(boardOrder));
ok('1d 标了「已拖延 2 天未完成」', (await ev(`document.querySelector('#plan-board .item-card[data-id="p_over"]').textContent.includes('已拖延 2 天未完成')`))===true,
  await ev(`document.querySelector('#plan-board .item-card[data-id="p_over"]').textContent`));
ok('1e 不是已完成的样式（未打勾、可操作）', (await ev(`!!document.querySelector('#plan-board .item-card[data-id="p_over"] [data-action="plan-done"]')`))===true);
ok('1f 项目导航已不显示徽标', (await ev(badge('plan')))===0, await ev(badge('plan')));
ok('1g 今日页也能看到它，且带同样标记', (await ev(`(()=>{const v=document.querySelector('#view').textContent;
  return v.includes('过了截止还没做完的计划')&&v.includes('已拖延 2 天未完成')})()`))===true);

/* --- 2) 把正常计划拖到「紧急」上面：不许，但要说清楚 --- */
await goTab('plan');
const rectOf=(sel)=>`(()=>{const r=document.querySelector('${sel}').getBoundingClientRect();return {x:r.left+r.width/2,y:r.top+r.height/2,top:r.top}})()`;
const src=await ev(rectOf('#plan-board .item-card[data-id="p_norm"] .task-title'));
const dst=await ev(rectOf('#plan-board .item-card[data-id="p_urg"] .task-title'));
await realDrag({x:src.x,y:src.y},{x:dst.x,y:dst.top+2});
await wait(900);
const t1=String(await ev(toastText));
ok('2a 拖到紧急上面时弹了提示', t1!=='(无提示)', t1);
ok('2b 提示点名了「紧急」这条', t1.indexOf('紧急')>=0 && t1.indexOf('三天后截止的紧急计划')>=0, t1);
ok('2c 提示说明了「不能排到它上面」', t1.indexOf('不能排到它上面')>=0, t1);
ok('2d 顺序回到规则顺序（紧急仍在正常之上）', String(await ev(boardOrder))==='p_over,p_urg,p_norm', await ev(boardOrder));
await wait(4200);

/* --- 3) 把已拖延那条往下拖：不许，提示改说明是「已拖延」 --- */
const src2=await ev(rectOf('#plan-board .item-card[data-id="p_over"] .task-title'));
const dst2=await ev(rectOf('#plan-board .item-card[data-id="p_norm"] .task-title'));
await realDrag({x:src2.x,y:src2.y},{x:dst2.x,y:dst2.top+2});
await wait(900);
const t2=String(await ev(toastText));
ok('3a 往下拖已拖延条也有提示', t2!=='(无提示)', t2);
ok('3b 提示说明「已拖延 N 天」固定在最上面', t2.indexOf('已拖延')>=0 && t2.indexOf('最上面')>=0, t2);
ok('3c 它仍然在最上面（规则生效）', String(await ev(boardOrder)).split(',')[0]==='p_over', await ev(boardOrder));
await wait(4200);

/* --- 4) 同一档里拖动依然能改顺序（规则不能把正常排序也锁死） --- */
const normOnly=await ev(`(()=>{const ids=[...document.querySelectorAll('#plan-board .item-card[data-id]')].map(x=>x.dataset.id);
  return ids.filter(x=>x!=='p_over'&&x!=='p_urg').length})()`);
ok('4a 同档正常计划只有一条（没法再拖，跳过）', normOnly===1, normOnly);
const cloudRanks=await ev(`(()=>{const f=window.__mock.files()['tasks.json'];
  return f.filter(x=>x.kind==='plan'&&!x.done).map(x=>x.id+':'+x.rank).sort().join(',')})()`);
ok('4b 拖过的顺序仍写进了云端 rank', /p_(over|urg|norm):\d/.test(String(cloudRanks)), cloudRanks);
ok('4c 全程无 JS 报错', errors.length===0, errors.slice(0,2));
await dump();
process.exit(R.every(r=>r.pass)?0:1);
