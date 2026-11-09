/* 本月排期：日历（今天标记 / 四周高亮）+ 四周可编辑排期表 + 周范围修改 + 落库同步 */
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

const now=new Date();
const Y=now.getFullYear(), M=now.getMonth();
const pad=n=>(n<10?'0'+n:''+n);
const key=Y+'-'+pad(M+1);
const daysInMonth=new Date(Y,M+1,0).getDate();
const ds=d=>key+'-'+pad(d);
const todayDay=now.getDate();
const todayS=ds(todayDay);
const base=Math.floor(daysInMonth/4), rem=daysInMonth%4;
let cursor=1;
const defaults=[];
for(let i=0;i<4;i+=1){const len=base+(i<rem?1:0);defaults.push({start:ds(cursor),end:ds(cursor+len-1),text:''});cursor+=len;}

await send('Storage.clearDataForOrigin',{origin:ORIGIN,storageTypes:'all'});
await send('Network.setCacheDisabled',{cacheDisabled:true});
await send('Emulation.setDeviceMetricsOverride',{width:1280,height:900,deviceScaleFactor:1,mobile:false});
await send('Page.addScriptToEvaluateOnNewDocument',{source:MOCK});
await load(URL_);await wait(1200);
await ev(`(()=>{window.__mock.setRemote('tasks.json',[]);
  localStorage.removeItem('ts_state_v2');localStorage.removeItem('ts_outbox_v2');return 1})()`);
await load(URL_);await wait(1800);
errors.length = 0;   // 丢掉上一个页面残留的请求错误，只看本次交互

const goTab=async(k)=>{for(let i=0;i<8;i++){await ev(`(()=>{const t=document.querySelector('.tab[data-tab="${k}"]');if(t)t.click();return 1})()`);await wait(250);
  if(await ev(`!!document.querySelector('.tab[data-tab="${k}"].active')`)){await wait(250);return true}}return false};
const toastText=`(()=>{const t=document.querySelector('#toast');return t&&!t.classList.contains('hidden')?t.textContent:'(无提示)'})()`;

/* --- 1) tab 位置：习惯 之后、琐事 之前 --- */
const tabOrder=await ev(`[...document.querySelectorAll('.tab[data-tab]')].map(x=>x.dataset.tab)`);
const ik=tabOrder.indexOf('keep'), im=tabOrder.indexOf('month'), ime=tabOrder.indexOf('memo');
ok('1a 顶部有「排期」tab', im>=0, tabOrder);
ok('1b 位置在「习惯」之后、「琐事」之前', ik<im&&im<ime, tabOrder);
ok('1c 切到本月排期', await goTab('month'));
ok('1d 排期页隐藏「＋新建」', (await ev(`document.querySelector('#btn-new').classList.contains('hidden')`))===true);

/* --- 2) 日历 --- */
ok('2a 日历格子覆盖整月天数', Number(await ev(`document.querySelectorAll('.mc-day:not(.out)').length`))===daysInMonth,
  await ev(`document.querySelectorAll('.mc-day:not(.out)').length`));
ok('2b 今天有且只有一个标记', Number(await ev(`document.querySelectorAll('.mc-day.today').length`))===1,
  await ev(`document.querySelectorAll('.mc-day.today').length`));
ok('2c 今天的格子里是今天的号', Number(await ev(`document.querySelector('.mc-day.today b').textContent`))===todayDay,
  await ev(`document.querySelector('.mc-day.today b').textContent`));
ok('2d 今天格子里有「今」', (await ev(`!!document.querySelector('.mc-day.today .mc-today')`))===true);
ok('2e 顶部写了 ISO 第几周和本月第几周', /ISO 第 [0-9]+ 周/.test(String(await ev(`document.querySelector('.mc-sub').textContent`))) &&
  /本月第.周/.test(String(await ev(`document.querySelector('.mc-sub').textContent`))), await ev(`document.querySelector('.mc-sub').textContent`));
const counts=await ev(`[1,2,3,4].map(i=>document.querySelectorAll('.mc-day.wk'+i).length)`);
ok('2f 四周在日历上分别高亮，段数和默认范围一致', JSON.stringify(counts)===JSON.stringify(defaults.map(w=>Number(w.end.slice(-2))-Number(w.start.slice(-2))+1)), counts);
ok('2g 日历上有图例', Number(await ev(`document.querySelectorAll('.mc-legend .mc-lg').length`))===5,
  await ev(`document.querySelectorAll('.mc-legend .mc-lg').length`));

/* --- 3) 四周排期表 --- */
ok('3a 排期表正好四行', Number(await ev(`document.querySelectorAll('.ms-row').length`))===4,
  await ev(`document.querySelectorAll('.ms-row').length`));
ok('3b 每行都有可编辑框', Number(await ev(`document.querySelectorAll('.ms-text').length`))===4);
ok('3c 第一行写着第一周和默认范围', String(await ev(`document.querySelector('.ms-row .ms-name').textContent`)).indexOf('第一周')>=0);
ok('3d 今天所在的那一周标了「本周」', (await ev(`!!document.querySelector('.ms-row.is-now .ms-now')`))===true);
ok('3e 每行都有改范围的小铅笔', Number(await ev(`document.querySelectorAll('.ms-pencil').length`))===4);

/* --- 4) 写正文自动落库（每周一条，互不覆盖） --- */
await ev(`(()=>{const ta=document.querySelector('.ms-text[data-ms-week="3"]');
  ta.value='第四周：月底复盘';ta.dispatchEvent(new Event('input',{bubbles:true}));return 1})()`);
await wait(1200);
await ev(`(()=>{const ta=document.querySelector('.ms-text[data-ms-week="1"]');
  ta.value='第二周：把方案定稿\\n周三前发出去';ta.dispatchEvent(new Event('input',{bubbles:true}));return 1})()`);
await wait(1300);
const savedText=await ev(`(()=>{const it=(window.__mock.files()['tasks.json']||[]).find(x=>x.kind==='monthweek'&&x.week===1);
  return it?it.text:'(未保存)'})()`);
ok('4a 正文自动写进 tasks.json', String(savedText).indexOf('第二周：把方案定稿')===0, savedText);
ok('4b 每周单独一条记录', (await ev(`(window.__mock.files()['tasks.json']||[]).filter(x=>x.kind==='monthweek').length`))===2,
  await ev(`(window.__mock.files()['tasks.json']||[]).filter(x=>x.kind==='monthweek').map(x=>x.week)`));
ok('4c 改第二周没有冲掉第四周', String(await ev(`(()=>{const it=(window.__mock.files()['tasks.json']||[]).find(x=>x.kind==='monthweek'&&x.week===3);return it?it.text:'(丢了)'})()`))==='第四周：月底复盘',
  await ev(`(window.__mock.files()['tasks.json']||[]).map(x=>x.kind+':'+x.week+':'+x.text).join(' | ')`));

/* --- 5) 改周范围 --- */
await ev(`document.querySelector('.ms-pencil[data-week="1"]').click()`);
await wait(400);
ok('5a 点铅笔出现范围编辑器', (await ev(`!!document.querySelector('[data-ms-editor="1"]')`))===true);
const newStart=ds(Math.max(2, Number(defaults[1].start.slice(-2))+1));
const newEnd=ds(Number(defaults[1].end.slice(-2))-1);
await ev(`(()=>{document.querySelector('#ms-start-1').value='${newStart}';
  document.querySelector('#ms-end-1').value='${newEnd}';return 1})()`);
await ev(`document.querySelector('[data-action="month-range-save"]').click()`);
await wait(900);
const savedRange=await ev(`(()=>{const it=(window.__mock.files()['tasks.json']||[]).find(x=>x.kind==='monthweek'&&x.week===1);
  return it?it.start+'~'+it.end:'(未保存)'})()`);
ok('5b 新范围写进云端', savedRange===newStart+'~'+newEnd, savedRange);
ok('5c 保存后编辑器收起', (await ev(`!!document.querySelector('[data-ms-editor="1"]')`))===false);
const counts2=await ev(`[1,2,3,4].map(i=>document.querySelectorAll('.mc-day.wk'+i).length)`);
ok('5d 日历高亮跟着新范围变了', JSON.stringify(counts2)!==JSON.stringify(counts), counts2);
ok('5e 行上的范围文字也更新了', String(await ev(`document.querySelectorAll('.ms-row .ms-range')[1].textContent`)).indexOf(String(Number(newStart.slice(5,7)))+'.'+Number(newStart.slice(8)))>=0,
  await ev(`document.querySelectorAll('.ms-row .ms-range')[1].textContent`));

/* --- 6) 非法范围要有提示 --- */
await ev(`document.querySelector('.ms-pencil[data-week="1"]').click()`);
await wait(300);
await ev(`(()=>{document.querySelector('#ms-start-1').value='${defaults[0].start}';
  document.querySelector('#ms-end-1').value='${defaults[1].end}';return 1})()`);
await ev(`document.querySelector('[data-action="month-range-save"]').click()`);
await wait(400);
const tmsg=String(await ev(toastText));
ok('6a 范围越过上一周时给提示', tmsg.indexOf('晚于')>=0, tmsg);
ok('6b 编辑器保持打开，方便改', (await ev(`!!document.querySelector('[data-ms-editor="1"]')`))===true);
await ev(`document.querySelector('[data-action="month-range-cancel"]').click()`);
await wait(300);
ok('6c 取消后编辑器收起', (await ev(`!!document.querySelector('[data-ms-editor="1"]')`))===false);

/* --- 6d) 第四周贴底时，编辑框仍完整滚进视口，日期选择器有空间展开 --- */
await ev(`document.querySelector('.ms-pencil[data-week="3"]').click()`);
await wait(900);
const fourth=await ev(`(()=>{const e=document.querySelector('[data-ms-editor="3"]');
  if(!e)return null;const r=e.getBoundingClientRect();
  return {top:Math.round(r.top),bottom:Math.round(r.bottom),vh:innerHeight,
    room:!!document.querySelector('.ms-scroll-room'),y:Math.round(scrollY)}})()`);
ok('6d 第四周编辑框完整落在屏幕内', fourth && fourth.top>=0 && fourth.bottom<=fourth.vh, fourth);
ok('6e 编辑时页面底部留有滚动空间', fourth && fourth.room===true, fourth);
await ev(`document.querySelector('[data-action="month-range-cancel"]').click()`);
await wait(300);
ok('6f 第四周取消后编辑器收起', (await ev(`!!document.querySelector('[data-ms-editor="3"]')`))===false);

/* --- 7) 刷新后数据还在 --- */
await load(URL_);await wait(1800);
await goTab('month');await wait(500);
const reloaded=await ev(`document.querySelector('.ms-text[data-ms-week="1"]').value`);
ok('7a 刷新后排期正文还在', String(reloaded).indexOf('第二周：把方案定稿')===0, reloaded);
const reloadedRange=await ev(`document.querySelectorAll('.ms-row .ms-range')[1].textContent`);
ok('7b 刷新后改过的范围还在', String(reloadedRange).indexOf(Number(newStart.slice(5,7))+'.'+Number(newStart.slice(8)))>=0, reloadedRange);
ok('7c 全程无 JS 报错', errors.length===0, errors.slice(0,2));

/* --- 8) 手机宽度下第四周编辑框也能完整进入视口 --- */
await send('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:2,mobile:true});
await load(URL_);await wait(1800);
await goTab('month');await wait(500);
await ev(`document.querySelector('.ms-pencil[data-week="3"]').click()`);
await wait(1000);
const fourthMobile=await ev(`(()=>{const e=document.querySelector('[data-ms-editor="3"]');
  if(!e)return null;const r=e.getBoundingClientRect();
  return {top:Math.round(r.top),bottom:Math.round(r.bottom),vh:innerHeight,
    room:!!document.querySelector('.ms-scroll-room'),w:innerWidth}})()`);
ok('8a 手机宽度下第四周编辑框完整可见', fourthMobile && fourthMobile.w===390 &&
  fourthMobile.top>=0 && fourthMobile.bottom<=fourthMobile.vh, fourthMobile);
ok('8b 手机宽度下编辑框滚到了中上部', fourthMobile && fourthMobile.top<fourthMobile.vh*0.45, fourthMobile);
await ev(`document.querySelector('[data-action="month-range-cancel"]').click()`);
await wait(300);
ok('8c 手机宽度下取消正常', (await ev(`!!document.querySelector('[data-ms-editor="3"]')`))===false);
await send('Emulation.setDeviceMetricsOverride',{width:1280,height:900,deviceScaleFactor:1,mobile:false});

await dump();
process.exit(R.every(r=>r.pass)?0:1);
