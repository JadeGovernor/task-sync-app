/* 公司页：整条拖动排序 + 跨桶拖动自动改到期日 + 新建后立刻可见 */
const CDP='http://127.0.0.1:9334', ORIGIN='http://127.0.0.1:8123', URL_=ORIGIN+'/index.html';
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
  const seed=()=>({files:{'tasks.json':[],'checkins.json':[],'settings.json':{devices:{}}},sha:{},puts:0,gets:0});
  const read=()=>{try{return JSON.parse(localStorage.getItem(KEY))||seed()}catch(e){return seed()}};
  const save=st=>localStorage.setItem(KEY,JSON.stringify(st));
  window.__mock={files:()=>read().files,putCount:()=>read().puts,
    setRemote:(f,v)=>{const st=read();st.files[f]=v;save(st)},reset:()=>save(seed())};
  window.fetch=async(url,opts={})=>{
    const f=String(url).split('/').pop().split('?')[0];
    const m=((opts&&opts.method)||'GET').toUpperCase();
    const st=read();
    if(m==='GET'){st.gets++;save(st);return {ok:true,status:200,headers:{get:()=>null},
      json:async()=>({content:b64(JSON.stringify(st.files[f]===undefined?[]:st.files[f])),sha:st.sha[f]||'s0'})}}
    const body=JSON.parse(opts.body);
    st.files[f]=JSON.parse(ub64(body.content));st.sha[f]='s'+(++st.puts);save(st);
    return {ok:true,status:200,headers:{get:()=>null},json:async()=>({content:{sha:st.sha[f]}})};
  };
  localStorage.setItem('ts_token_v1','fake-token');
  window.__nativeDrags=0;
  document.addEventListener('dragstart',()=>{window.__nativeDrags++},true);
})();`;

const realDrag=async(from,to,steps=10)=>{
  await send('Input.dispatchMouseEvent',{type:'mousePressed',x:from.x,y:from.y,button:'left',buttons:1,clickCount:1});
  await wait(60);
  let mid=null;
  for(let i=1;i<=steps;i+=1){
    const x=from.x+(to.x-from.x)*i/steps, y=from.y+(to.y-from.y)*i/steps;
    await send('Input.dispatchMouseEvent',{type:'mouseMoved',x,y,button:'left',buttons:1});
    if(i===Math.ceil(steps/2))mid=await ev(`document.body.classList.contains('is-dragging')`);
    await wait(25);
  }
  await send('Input.dispatchMouseEvent',{type:'mouseReleased',x:to.x,y:to.y,button:'left',buttons:0,clickCount:1});
  return mid;
};
const d=(n)=>shiftDays(n);
function shiftDays(n){const x=new Date();x.setDate(x.getDate()+n);
  const p2=v=>(v<10?'0'+v:''+v);return x.getFullYear()+'-'+p2(x.getMonth()+1)+'-'+p2(x.getDate());}

await send('Storage.clearDataForOrigin',{origin:ORIGIN,storageTypes:'all'});
await send('Network.setCacheDisabled',{cacheDisabled:true});
await send('Emulation.setDeviceMetricsOverride',{width:1280,height:900,deviceScaleFactor:1,mobile:false});
await send('Page.addScriptToEvaluateOnNewDocument',{source:MOCK});
await load(URL_);await wait(1200);
const seed=[{id:'wt1',kind:'work',title:'今日甲',created:d(-1),due:d(0),done:false,notes:[],updatedAt:new Date().toISOString()},
            {id:'wt2',kind:'work',title:'今日乙',created:d(-1),due:d(0),done:false,notes:[],updatedAt:new Date().toISOString()},
            {id:'wm1',kind:'work',title:'明日甲',created:d(-1),due:d(1),done:false,notes:[],updatedAt:new Date().toISOString()},
            {id:'wl1',kind:'work',title:'更晚甲',created:d(-1),due:d(9),done:false,notes:[],updatedAt:new Date().toISOString()},
            {id:'wd1',kind:'work',title:'已完成甲',created:d(-2),due:d(-2),done:true,doneDate:d(-2),notes:[],updatedAt:new Date().toISOString()}];
await ev(`(()=>{window.__mock.setRemote('tasks.json',${JSON.stringify(seed)});
  localStorage.removeItem('ts_state_v2');localStorage.removeItem('ts_outbox_v2');return 1})()`);
await load(URL_);await wait(1800);

const goTab=async(k)=>{for(let i=0;i<8;i++){await ev(`(()=>{const t=document.querySelector('.tab[data-tab="${k}"]');if(t)t.click();return 1})()`);await wait(250);
  if(await ev(`!!document.querySelector('.tab[data-tab="${k}"].active')`)){await wait(250);return true}}return false};
ok('0 切到公司页', await goTab('work'));
ok('1a 公司页有可拖拽排序板', (await ev(`!!document.querySelector('#work-board')`))===true);
ok('1b 三个桶标题都在', JSON.stringify(await ev(`[...document.querySelectorAll('#work-board .wb-head')].map(x=>x.dataset.bucket)`))===JSON.stringify(['today','tomorrow','later']), await ev(`[...document.querySelectorAll('#work-board .wb-head')].map(x=>x.dataset.bucket)`));
const board=()=>`(()=>{const out=[];let cur=null;[...document.querySelector('#work-board').children].forEach(el=>{
  if(el.classList.contains('wb-head')){cur=el.dataset.bucket;return}
  if(el.dataset&&el.dataset.id)out.push(cur+':'+el.dataset.id)});return out.join(',')})()`;
ok('1c 待办按桶排好了', String(await ev(board()))==='today:wt1,today:wt2,tomorrow:wm1,later:wl1', await ev(board()));
ok('1d 已完成的不在排序板里', (await ev(`document.querySelector('#work-board').textContent.includes('已完成甲')`))===false);

/* --- 2) 桶内拖动：今日乙 拖到 今日甲 上面 --- */
await ev(`window.__nativeDrags=0;window.getSelection().removeAllRanges()`);
const g=await ev(`(()=>{const t=id=>document.querySelector('#work-board .item-card[data-id="'+id+'"] .task-title').getBoundingClientRect();
  const a=t('wt1'),b=t('wt2');return {fx:b.left+b.width/2,fy:b.top+b.height/2,tx:a.left+a.width/2,ty:a.top+2}})()`);
const mid=await realDrag({x:g.fx,y:g.fy},{x:g.tx,y:g.ty});
await wait(1500);
ok('2a 拖动中挂上了 is-dragging 锁', mid===true, mid);
ok('2b 桶内顺序已换', String(await ev(board()))==='today:wt2,today:wt1,tomorrow:wm1,later:wl1', await ev(board()));
ok('2c 没拖出选区（那个复制感）', (await ev(`String(window.getSelection())`))==='', await ev(`String(window.getSelection())`));
ok('2d 没触发浏览器原生拖拽', (await ev(`window.__nativeDrags`))===0);
const cloudRank=await ev(`(()=>{const f=window.__mock.files()['tasks.json'];
  return f.filter(x=>x.id==='wt1'||x.id==='wt2').map(x=>x.id+':'+(x.rank||0)).join(',')})()`);
ok('2e 新顺序已写进云端 rank', cloudRank==='wt1:2,wt2:1', cloudRank);

/* --- 3) 跨桶拖动：明日甲 拖进 今日桶 → 到期日改成今天 --- */
const g3=await ev(`(()=>{const src=document.querySelector('#work-board .item-card[data-id="wm1"] .task-title').getBoundingClientRect();
  const head=document.querySelector('#work-board .wb-head[data-bucket="today"]').getBoundingClientRect();
  return {fx:src.left+src.width/2,fy:src.top+src.height/2,tx:head.left+60,ty:head.bottom+6}})()`);
await realDrag({x:g3.fx,y:g3.fy},{x:g3.tx,y:g3.ty});
await wait(1600);
ok('3a 明日甲已经挪进今日桶', String(await ev(board())).indexOf('today:wm1')>=0, await ev(board()));
const dueNow=await ev(`(()=>{const f=window.__mock.files()['tasks.json'];const it=f.find(x=>x.id==='wm1');return it.due})()`);
ok('3b 到期日自动改成今天', dueNow===d(0), dueNow+' 期望 '+d(0));

/* --- 4) 跨桶拖动：今日甲 拖到底部（更晚桶）→ 到期日改到一周后 --- */
const g4=await ev(`(()=>{const src=document.querySelector('#work-board .item-card[data-id="wt1"] .task-title').getBoundingClientRect();
  const all=[...document.querySelectorAll('#work-board .item-card')];
  const last=all[all.length-1].getBoundingClientRect();
  return {fx:src.left+src.width/2,fy:src.top+src.height/2,tx:last.left+last.width/2,ty:last.bottom+40}})()`);
await realDrag({x:g4.fx,y:g4.fy},{x:g4.tx,y:g4.ty});
await wait(1600);
const dueLater=await ev(`(()=>{const f=window.__mock.files()['tasks.json'];const it=f.find(x=>x.id==='wt1');return it.due})()`);
ok('4a 拖进“更晚”＝到期日改到一周后', dueLater===d(7), dueLater+' 期望 '+d(7));
ok('4b 它现在排在更晚桶的最后', String(await ev(board())).indexOf('later:wt1')>=0, await ev(board()));

/* --- 5) 新建后立刻可见：应该出现在今日桶并高亮 --- */
await ev(`document.querySelector('#btn-new').click()`);await wait(400);
await ev(`(()=>{document.querySelector('#f-title').value='新加的公司条目';return 1})()`);
await ev(`document.querySelector('#task-form').dispatchEvent(new Event('submit',{cancelable:true,bubbles:true}))`);
await wait(1200);
const newId=await ev(`(()=>{const f=window.__mock.files()['tasks.json'];const it=f.find(x=>x.title==='新加的公司条目');
  return it?it.id+'@'+it.due:(document.querySelector('#work-board').textContent.indexOf('新加的公司条目')>=0?'IN-DOM':'MISSING')})()`);
ok('5a 新建的公司条目写进了云端且到期日=今天', String(newId).indexOf('@'+d(0))>0, newId);
ok('5b 新建的条目就在公司页今日桶里', String(await ev(board())).indexOf('today:'+String(newId).split('@')[0])>=0, await ev(board()));
ok('5c 新建后自动高亮那一行', (await ev(`!!document.querySelector('#work-board .just-added')`))===true);
/* --- 6) 设置页「数据恢复」：云端被旧快照覆盖后能一键拉回 --- */
await ev(`(()=>{const f=window.__mock.files()['tasks.json'];
  window.__mock.setRemote('tasks.json', f.filter(x=>x.id==='wd1'));return 1})()`);   // 模拟别台设备拿旧快照整份写回
await goTab('settings');
ok('6a 设置页有数据恢复入口', (await ev(`!!document.querySelector('[data-restore]')`))===true,
  await ev(`document.querySelector('#view').textContent.slice(0,200)`));
await ev(`document.querySelector('#set-refresh').click()`);await wait(1500);
ok('6c 快照列表出现了可恢复的历史版本', (await ev(`document.querySelectorAll('[data-restore]').length`))>=1,
  await ev(`document.querySelectorAll('[data-restore]').length`));
const snapshotCount = await ev(`(()=>{const b=document.querySelector('[data-restore]');
  return b?b.getAttribute('data-restore'):'(无)'})()`);
await ev(`document.querySelector('[data-restore]').click()`);await wait(400);
ok('6d 点恢复会先确认', (await ev(`!document.querySelector('#confirm-backdrop').classList.contains('hidden')`))===true);
await ev(`document.querySelector('#confirm-ok').click()`);await wait(1600);
const restored = await ev(`window.__mock.files()['tasks.json'].map(x=>x.id).join(',')`);
ok('6e 恢复把那一版整份推回了云端', restored.indexOf('wt2')>=0 && restored.indexOf('wm1')>=0, restored+' 来源快照='+snapshotCount);
await goTab('work');
ok('6f 恢复后公司页条目回来了', String(await ev(board())).indexOf('today:wt2')>=0, await ev(board()));
ok('6g 全程无 JS 报错（含恢复流程）', errors.length===0, errors.slice(0,2));
/* --- 7) 手机（iPhone 尺寸）触屏长按拖动 --- */
await send('Emulation.setDeviceMetricsOverride',{width:393,height:852,deviceScaleFactor:2,mobile:true});
await send('Emulation.setTouchEmulationEnabled',{enabled:true,maxTouchPoints:1});
await goTab('work');await wait(600);
const overflow=await ev(`(()=>{const b=document.querySelector('#work-board');if(!b)return 'NO_BOARD';
  return document.documentElement.scrollWidth<=Math.ceil(window.innerWidth)+2?'OK':('OVERFLOW '+document.documentElement.scrollWidth+' > '+window.innerWidth)})()`);
ok('7a 手机宽度下公司页不横向溢出', overflow==='OK', overflow);
const beforeMobile=String(await ev(board()));
const ids=beforeMobile.split(',').filter(x=>x.startsWith('today:'));
ok('7b 今日桶里至少两条可拖', ids.length>=2, beforeMobile);
await ev('window.__mids=' + JSON.stringify(ids));
await ev(`(()=>{const el=document.querySelector('#work-board .item-card');if(el)el.scrollIntoView({block:'center'});return 1})()`);
await wait(600);
const gm=await ev(`(()=>{const ids=window.__mids.map(x=>x.split(':')[1]);
  const a=document.querySelector('#work-board .item-card[data-id="'+ids[0]+'"] .task-title').getBoundingClientRect();
  const b=document.querySelector('#work-board .wb-head[data-bucket="tomorrow"]').getBoundingClientRect();
  return {fx:a.left+a.width/2,fy:a.top+a.height/2,tx:b.left+80,ty:b.top-8}})()`);
const g7=gm&&gm.fx!=null?gm:null;
if(g7){
  const pt=(x,y)=>[{x,y,radiusX:2,radiusY:2,force:1,id:1}];
  await ev(`window.__pt=[];['pointerdown','pointermove','pointerup','pointercancel','touchstart','touchmove','touchend','touchcancel'].forEach(t=>document.addEventListener(t,e=>window.__pt.push(t+':'+(e.pointerType||'')),true))`);
  await send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:pt(g7.fx,g7.fy)});
  await wait(450);
  let midTouch=false;
  for(let i=1;i<=8;i++){await send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:pt(g7.fx,g7.fy+(g7.ty-g7.fy)*i/8)});
    if(i===4)midTouch=await ev(`document.body.classList.contains('is-dragging')`);await wait(30)}
  await send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
  await wait(1500);
  ok('7c 触屏长按能进拖动', midTouch===true, midTouch);
  const afterMobile=String(await ev(board()));
  ok('7d 触屏拖动真的改了顺序', afterMobile!==beforeMobile, beforeMobile+' -> '+afterMobile);
} else {
  ok('7c 触屏长按能进拖动', false, '拿不到卡片坐标');
  ok('7d 触屏拖动真的改了顺序', false, '拿不到卡片坐标');
}
ok('7e 移动端全程无 JS 报错', errors.length===0, errors.slice(0,2));
await dump();
process.exit(R.every(r=>r.pass)?0:1);
