/* 今日页能打勾计划 + tab 徽标口径与页面一致（含逾期顺延） */
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
await send('Storage.clearDataForOrigin',{origin:ORIGIN,storageTypes:'all'});
await send('Network.setCacheDisabled',{cacheDisabled:true});
await send('Emulation.setDeviceMetricsOverride',{width:1280,height:900,deviceScaleFactor:1,mobile:false});
await send('Page.addScriptToEvaluateOnNewDocument',{source:MOCK});
await load(URL_);await wait(1200);
const seed=[
  {id:'w_over',kind:'work',title:'逾期没做完的公司活',created:shiftDays(-5),due:shiftDays(-3),done:false,notes:[],updatedAt:new Date().toISOString()},
  {id:'w_today',kind:'work',title:'今天到期的公司活',created:shiftDays(-1),due:shiftDays(0),done:false,notes:[],updatedAt:new Date().toISOString()},
  {id:'w_tmw',kind:'work',title:'明天才到期的公司活',created:shiftDays(-1),due:shiftDays(1),done:false,notes:[],updatedAt:new Date().toISOString()},
  {id:'w_done',kind:'work',title:'已经做完的公司活',created:shiftDays(-6),due:shiftDays(-6),done:true,doneDate:shiftDays(-1),notes:[],updatedAt:new Date().toISOString()},
  {id:'p_a',kind:'plan',title:'进行中的计划A',created:shiftDays(-5),rangeStart:shiftDays(-5),rangeEnd:shiftDays(30),done:false,notes:[],updatedAt:new Date().toISOString(),rank:1},
  {id:'p_b',kind:'plan',title:'进行中的计划B',created:shiftDays(-5),rangeStart:shiftDays(-5),rangeEnd:shiftDays(3),done:false,notes:[],updatedAt:new Date().toISOString(),rank:2},
  {id:'p_done',kind:'plan',title:'已完成的计划',created:shiftDays(-9),rangeStart:shiftDays(-9),rangeEnd:shiftDays(-8),done:true,doneDate:shiftDays(-8),notes:[],updatedAt:new Date().toISOString(),rank:3}
];
await ev(`(()=>{window.__mock.setRemote('tasks.json',${JSON.stringify(seed)});
  localStorage.removeItem('ts_state_v2');localStorage.removeItem('ts_outbox_v2');return 1})()`);
await load(URL_);await wait(2000);
const goTab=async(k)=>{for(let i=0;i<8;i++){await ev(`(()=>{const t=document.querySelector('.tab[data-tab="${k}"]');if(t)t.click();return 1})()`);await wait(250);
  if(await ev(`!!document.querySelector('.tab[data-tab="${k}"].active')`)){await wait(250);return true}}return false};
const badge=(k)=>`(()=>{const t=document.querySelector('.tab[data-tab="${k}"] i');return t?Number(t.textContent):0})()`;

/* --- 1) tab 徽标口径 --- */
ok('1a 公司徽标 = 今日该做（逾期顺延 1 + 今天到期 1 = 2）', (await ev(badge('work')))===2, await ev(badge('work')));
ok('1b 计划徽标 = 进行中 2 条', (await ev(badge('plan')))===2, await ev(badge('plan')));
await goTab('work');
ok('1c 公司页「今日」桶条数和徽标一致', (await ev(`document.querySelector('#work-board [data-bucket="today"] .cnt').textContent`))==='2',
  await ev(`document.querySelector('#work-board [data-bucket="today"] .cnt').textContent`));
ok('1d 逾期那条确实在今日桶里', (await ev(`document.querySelector('#work-board').textContent.includes('逾期没做完的公司活')`))===true);
ok('1e 明天那条不在今日桶', (await ev(`document.querySelector('#work-board [data-bucket="today"]').textContent.includes('明天才到期')`))===false);

/* --- 2) 今日页的计划能打勾 --- */
await goTab('today');
ok('2a 今日页有计划区', (await ev(`document.querySelector('#view').textContent.includes('计划 · 进行中')`))===true);
ok('2b 今日页计划行有勾选框', (await ev(`document.querySelectorAll('#view input[data-action="plan-done"]').length`))===2,
  await ev(`document.querySelectorAll('#view input[data-action="plan-done"]').length`));
ok('2c 今日页计划行还是未勾状态', (await ev(`[...document.querySelectorAll('#view input[data-action="plan-done"]')].every(i=>!i.checked)`))===true);
await ev(`document.querySelector('#view input[data-action="plan-done"][data-id="p_b"]').click()`);
await wait(1200);
const pB=await ev(`(()=>{const f=window.__mock.files()['tasks.json'];const it=f.find(x=>x.id==='p_b');
  return it?JSON.stringify({done:it.done,doneDate:it.doneDate}):'MISSING'})()`);
ok('2d 打勾后云端里那条计划变成已完成（带完成日期）', pB===JSON.stringify({done:true,doneDate:shiftDays(0)}), pB);
ok('2e 打勾后它从今日页消失', (await ev(`document.querySelector('#view').textContent.includes('进行中的计划B')`))===false);
ok('2f 计划徽标同步减少', (await ev(badge('plan')))===1, await ev(badge('plan')));
await goTab('plan');
ok('2g0 计划页「已完成」区计数 +1', (await ev(`(()=>{const c=document.querySelector('#view [data-action="done-fold"][data-scope="plan"] .cnt');
  return c?c.textContent:'(没有已完成区)'})()`))==='2 条',
  await ev(`(()=>{const c=document.querySelector('#view [data-action="done-fold"][data-scope="plan"] .cnt');return c?c.textContent:'(没有已完成区)'})()`));
await ev(`(()=>{const h=document.querySelector('#view [data-action="done-fold"][data-scope="plan"]');if(h)h.click();return 1})()`);
await wait(500);
ok('2g 展开后能看到刚完成的那条计划', (await ev(`document.querySelector('#view').textContent.includes('进行中的计划B')`))===true,
  await ev(`document.querySelector('#view').textContent.replace(/\s+/g,' ').slice(0,160)`));

/* --- 3) 今日页勾公司条目，公司徽标要跟着掉 --- */
await goTab('today');
await ev(`document.querySelector('#view input[data-action="toggle"][data-id="w_today"]').click()`);
await wait(1200);
ok('3a 勾掉今天那条后，公司徽标 2 → 1', (await ev(badge('work')))===1, await ev(badge('work')));
ok('3b 云端里那条已标记完成', (await ev(`window.__mock.files()['tasks.json'].find(x=>x.id==='w_today').done`))===true);
ok('3c 今天已勾的条数回显正确', (await ev(`document.querySelector('#view').textContent.includes('已打勾')||document.querySelector('#view').textContent.includes('已完成')`))===true);
ok('3d 全程无 JS 报错', errors.length===0, errors.slice(0,2));
dump();
process.exit(R.every(r=>r.pass)?0:1);
