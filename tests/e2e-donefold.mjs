/* 已完成区：默认收起成一行 / 展开先露最近 3 天 / 更早再折一层 / 设置页手动清理 */
const CDP='http://127.0.0.1:9334', ORIGIN='http://127.0.0.1:8123', URL_=ORIGIN+'/index.html?t='+Date.now();
const l=await(await fetch(CDP+'/json/list')).json();
const t=l.find(x=>x.type==='page'&&!x.url.startsWith('devtools'));
const ws=new WebSocket(t.webSocketDebuggerUrl);let id=0;const p=new Map();
const send=(m,pa={})=>new Promise((r,j)=>{const i=++id;p.set(i,{r,j});ws.send(JSON.stringify({id:i,method:m,params:pa}))});
await new Promise(r=>ws.addEventListener('open',r));
ws.addEventListener('message',e=>{const m=JSON.parse(e.data);if(m.id&&p.has(m.id)){const q=p.get(m.id);p.delete(m.id);m.error?q.j(new Error(JSON.stringify(m.error))):q.r(m.result)}});
await send('Page.enable');await send('Runtime.enable');await send('Network.enable');
const errors=[];ws.addEventListener('message',e=>{const m=JSON.parse(e.data);if(m.method==='Runtime.exceptionThrown')errors.push(String(m.params.exceptionDetails.exception?.description||'').slice(0,200))});
const ev=async x=>{const r=await send('Runtime.evaluate',{expression:x,awaitPromise:true,returnByValue:true});if(r.exceptionDetails)throw new Error(String(r.exceptionDetails.exception?.description||r.exceptionDetails).slice(0,400));return r.result.value};
const load=u=>new Promise(r=>{const h=e=>{const m=JSON.parse(e.data);if(m.method==='Page.loadEventFired'){ws.removeEventListener('message',h);r()}};ws.addEventListener('message',h);send('Page.navigate',{url:u})});
const wait=ms=>new Promise(r=>setTimeout(r,ms));
const R=[];const ok=(n,c,x)=>R.push({n,pass:!!c,x});
process.on('uncaughtException',async e=>{console.log('CRASH: '+e.message);try{await dump()}catch(_){}process.exit(1)});
process.on('unhandledRejection',async e=>{console.log('CRASH: '+(e&&e.message||e));try{await dump()}catch(_){}process.exit(1)});
const dump=async()=>{console.log('--- 已完成用例 ---');R.forEach(r=>console.log((r.pass?'PASS':'FAIL')+' '+r.n+(r.pass?'':'  <= '+JSON.stringify(r.x))));console.log('总计 '+R.filter(r=>r.pass).length+'/'+R.length)};

const MOCK=`(()=>{
  const KEY='__mock_remote';
  const b64=s=>btoa(unescape(encodeURIComponent(s)));
  const ub64=s=>decodeURIComponent(escape(atob(s)));
  const seed=()=>({files:{'tasks.json':[],'checkins.json':[],'settings.json':{devices:{}}},sha:{},puts:0,gets:0});
  const read=()=>{try{return JSON.parse(localStorage.getItem(KEY))||seed()}catch(e){return seed()}};
  const save=st=>localStorage.setItem(KEY,JSON.stringify(st));
  window.__mock={
    files:()=>read().files, putCount:()=>read().puts, getCount:()=>read().gets,
    setRemote:(f,v)=>{const st=read();st.files[f]=v;save(st)},
    reset:()=>{save(seed())}
  };
  window.fetch=async(url,opts={})=>{
    const f=String(url).split('/').pop().split('?')[0];
    const m=((opts&&opts.method)||'GET').toUpperCase();
    const st=read();
    if(m==='GET'){st.gets++;save(st);
      return {ok:true,status:200,headers:{get:()=>null},json:async()=>({content:b64(JSON.stringify(st.files[f]===undefined?[]:st.files[f])),sha:st.sha[f]||'s0'})};}
    const body=JSON.parse(opts.body);
    st.files[f]=JSON.parse(ub64(body.content));st.sha[f]='s'+(++st.puts);save(st);
    return {ok:true,status:200,headers:{get:()=>null},json:async()=>({content:{sha:st.sha[f]}})};
  };
  localStorage.setItem('ts_token_v1','fake-token');
})();`;

await send('Storage.clearDataForOrigin',{origin:ORIGIN,storageTypes:'all'});
await send('Network.setCacheDisabled',{cacheDisabled:true});
await send('Emulation.setDeviceMetricsOverride',{width:393,height:852,deviceScaleFactor:2,mobile:true});
await send('Page.addScriptToEvaluateOnNewDocument',{source:MOCK});
await load(URL_);await wait(1200);

/* 种数据：公司 3 条已完成（今天 / 10 天前 / 40 天前）+ 1 条待办；计划 1 条已完成(40 天前) + 1 条进行中 */
await ev(`(()=>{
  const t=Core.todayStr(), old=Core.shiftDate(t,-10), veryOld=Core.shiftDate(t,-40);
  window.__mock.setRemote('tasks.json',[
    {id:'w1',kind:'work',title:'今天刚完成',due:t,done:true,doneDate:t,notes:[],updatedAt:'2026-09-16T00:00:00.000Z'},
    {id:'w2',kind:'work',title:'十天前完成',due:old,done:true,doneDate:old,notes:[],updatedAt:'2026-09-06T00:00:00.000Z'},
    {id:'w3',kind:'work',title:'四十天前完成',due:veryOld,done:true,doneDate:veryOld,notes:[],updatedAt:'2026-08-06T00:00:00.000Z'},
    {id:'w4',kind:'work',title:'今天要做的事',due:t,done:false,notes:[],updatedAt:'2026-09-16T00:00:00.000Z'},
    {id:'p1',kind:'plan',title:'老计划已完成',rangeStart:null,rangeEnd:null,done:true,doneDate:veryOld,notes:[],updatedAt:'2026-08-06T00:00:00.000Z'},
    {id:'p2',kind:'plan',title:'进行中的计划',rangeStart:null,rangeEnd:null,done:false,notes:[],updatedAt:'2026-09-16T00:00:00.000Z'}]);
  window.__mock.setRemote('checkins.json',[]);
  localStorage.removeItem('ts_state_v2');
  return 1})()`);
await load(URL_);await wait(1800);

const text=async sel=>await ev(`(document.querySelector(${JSON.stringify(sel)})||{}).textContent||''`);
const goTab=async(tab)=>{for(let i=0;i<8;i++){await ev(`(()=>{const t=document.querySelector('.tab[data-tab="${tab}"]');if(t)t.click();return 1})()`);await wait(350);
  if(await ev(`!!document.querySelector('.tab[data-tab="${tab}"].active')`)){await wait(250);return true}}return false};

/* ---------- 1. 公司页：默认收起 ---------- */
ok('0 切到公司页', await goTab('work'));
ok('1a 有已完成区', await ev(`!!document.querySelector('.done-card')`));
ok('1b 默认收起，不渲染网格', await ev(`document.querySelectorAll('.done-card .done-grid').length===0 && document.querySelectorAll('.done-card .task').length===0`));
const h1=await text('.done-head');
ok('1c 标题写明条数并提示可展开', /已完成/.test(h1)&&/3 条/.test(h1)&&/展开/.test(h1), h1);
ok('1d 收起时不影响未完成的条目', await ev(`/今天要做的事/.test(document.querySelector('#view').textContent)`));

/* ---------- 2. 展开：先只露最近 3 天 ---------- */
await ev(`document.querySelector('.done-head').click()`);await wait(400);
ok('2a 点标题展开出网格', await ev(`document.querySelectorAll('.done-card .done-grid .task').length===1`),
  await ev(`document.querySelectorAll('.done-card .done-grid .task').length`));
ok('2b 露出来的是最近 3 天完成的那条', await ev(`/今天刚完成/.test(document.querySelector('.done-card .done-grid').textContent)`));
const more=await text('.done-more');
ok('2c 更早那批再折一层', /更早完成 · 2 条/.test(more)&&/展开/.test(more), more);
ok('2d 更早的没混进上面那格', await ev(`!/十天前完成/.test(document.querySelector('.done-card .done-grid').textContent)`));

/* ---------- 3. 再展开更早 ---------- */
await ev(`document.querySelector('.done-more').click()`);await wait(400);
ok('3a 更早那层展开后共 3 条', await ev(`document.querySelectorAll('.done-card .done-grid .task').length===3`));
ok('3b 更早的两条露出来了', await ev(`/十天前完成/.test(document.querySelector('.done-card').textContent)&&/四十天前完成/.test(document.querySelector('.done-card').textContent)`));

/* ---------- 4. 收起 ---------- */
await ev(`document.querySelector('.done-head').click()`);await wait(400);
ok('4a 再点标题收回去', await ev(`document.querySelectorAll('.done-card .done-grid').length===0&&document.querySelectorAll('.done-card .task').length===0`));

/* ---------- 5. 计划页同样折叠，且状态互不干扰 ---------- */
ok('5a 切到计划页', await goTab('plan'));
ok('5b 计划页也有已完成区且默认收起', await ev(`!!document.querySelector('.done-card')&&document.querySelectorAll('.done-card .done-grid').length===0`));
const h2=await text('.done-head');
ok('5c 计划已完成写的是自己的条数', /1 条/.test(h2), h2);
await ev(`document.querySelector('.done-head').click()`);await wait(400);
ok('5d 只剩更早的完成项时直接铺开，不用多点一次', await ev(`/老计划已完成/.test(document.querySelector('.done-card').textContent)`));
ok('5d2 这条旧的确实标在「更早完成」那层下面', await ev(`/更早完成 · 1 条/.test(document.querySelector('.done-more').textContent)`));
ok('5e 进行中的计划仍在上面排序板里', await ev(`/进行中的计划/.test(document.querySelector('#plan-board').textContent)`));
await goTab('work');
ok('5f 两个模块的折叠状态各管各的（公司仍收起）', await ev(`document.querySelectorAll('.done-card .done-grid').length===0`));

/* ---------- 6. 设置页清理已完成 ---------- */
ok('6a 切到设置页', await goTab('settings'));
const btn=await text('#set-purge-done');
ok('6b 按钮写明可清理条数（40 天前完成的 2 条）', /2 条/.test(btn), btn);
ok('6c 有可清理对象时按钮可用', await ev(`!document.querySelector('#set-purge-done').disabled`));
const putsBefore=await ev(`window.__mock.putCount()`);
await ev(`document.querySelector('#set-purge-done').click()`);await wait(400);
ok('6d 先弹二次确认', await ev(`!document.querySelector('#confirm-backdrop').classList.contains('hidden')`));
ok('6e 确认框写清影响范围', /2 条/.test(await text('#confirm-text')), await text('#confirm-text'));
await ev(`document.querySelector('#confirm-ok').click()`);await wait(1800);
const ids=await ev(`window.__mock.files()['tasks.json'].map(x=>x.id).sort()`);
ok('6f 云端只删了超期那两条', JSON.stringify(ids)===JSON.stringify(['p2','w1','w2','w4']), ids);
ok('6g 打勾历史没被动', await ev(`JSON.stringify(window.__mock.files()['checkins.json'])==='[]'`));
ok('6h 清理走批量删除，只发一次请求', (await ev(`window.__mock.putCount()`))-putsBefore===1, (await ev(`window.__mock.putCount()`))-putsBefore);
ok('6i 清完后按钮变 0 条并禁用', /0 条/.test(await text('#set-purge-done'))&&await ev(`document.querySelector('#set-purge-done').disabled`), await text('#set-purge-done'));
ok('6j 没误删今天完成的条目', await ev(`window.__mock.files()['tasks.json'].some(x=>x.id==='w1')`));

/* ---------- 7. 清理后页面回到正常 ---------- */
await goTab('work');
ok('7a 清理后公司页已完成剩 2 条（40 天前那条没了）', /2 条/.test(await text('.done-head')), await text('.done-head'));
ok('7b 未完成的条目照常在', await ev(`/今天要做的事/.test(document.querySelector('#view').textContent)`));

/* ---------- 8. 收尾 ---------- */
ok('8a 全程无 JS 报错', errors.length===0, errors);
await dump();
process.exit(R.every(r=>r.pass)?0:1);
