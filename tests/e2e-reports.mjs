/* 计划底稿 + 周报：富文本落库、周报创建/切换/删除、双栏独立滚动、手机布局 */
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

await send('Storage.clearDataForOrigin',{origin:ORIGIN,storageTypes:'all'});
await send('Network.setCacheDisabled',{cacheDisabled:true});
await send('Emulation.setDeviceMetricsOverride',{width:1280,height:900,deviceScaleFactor:1,mobile:false});
await send('Page.addScriptToEvaluateOnNewDocument',{source:MOCK});
await load(URL_);await wait(1200);
await ev(`(()=>{window.__mock.setRemote('tasks.json',[]);
  localStorage.removeItem('ts_state_v2');localStorage.removeItem('ts_outbox_v2');return 1})()`);
await load(URL_);await wait(1800);
errors.length = 0;

const goTab=async(k)=>{for(let i=0;i<8;i++){await ev(`(()=>{const t=document.querySelector('.tab[data-tab="${k}"]');if(t)t.click();return 1})()`);await wait(250);
  if(await ev(`!!document.querySelector('.tab[data-tab="${k}"].active')`)){await wait(300);return true}}return false};
const tasks=()=>ev(`window.__mock.files()['tasks.json']||[]`);

ok('1a 排期页有计划底稿', await goTab('month') && await ev(`!!document.querySelector('#monthnote-editor')`));
ok('1b 计划底稿有富文本工具栏', await ev(`!!document.querySelector('#monthnote-toolbar .memo-bold')`));
ok('1c 计划底稿下面有周报入口', await ev(`!!document.querySelector('[data-action="report-new"]')`));
ok('1d 初始没有周报', Number(await ev(`document.querySelectorAll('.report-banner').length`))===0);
ok('1e 右侧有空白提示', await ev(`!!document.querySelector('.report-empty')`));

await ev(`(()=>{const ed=document.querySelector('#monthnote-editor');
  ed.innerHTML='<h2>今年所有计划</h2><div>先把产品方向写清楚</div><div>十一月挑一条进排期</div>';
  ed.dispatchEvent(new Event('input',{bubbles:true}));return 1})()`);
await wait(1300);
let list=await tasks();
const note=list.find(x=>x.kind==='monthnote');
ok('2a 计划底稿自动写进 tasks.json', !!note && note.memo.indexOf('今年所有计划')===0, note);
ok('2b 富文本格式也保存了', !!note && /<h2/.test(note.memoHtml), note&&note.memoHtml);
ok('2c 底稿正文是三行', !!note && note.memo.split('\n').length===3, note&&note.memo);

await ev(`document.querySelector('[data-action="report-new"]').click()`);
await wait(350);
ok('3a 点新增周报出现名称输入', await ev(`!!document.querySelector('#report-name')`));
ok('3b 名称输入自动聚焦', await ev(`document.activeElement && document.activeElement.id==='report-name'`));
await ev(`(()=>{const i=document.querySelector('#report-name');i.value='11 月第一周周报';
  document.querySelector('#report-new-form').requestSubmit();return 1})()`);
await wait(900);
list=await tasks();
const r1=list.find(x=>x.kind==='weekreport'&&x.title==='11 月第一周周报');
ok('3c 回车创建了一份周报', !!r1, list.filter(x=>x.kind==='weekreport'));
ok('3d 左侧出现可点击 banner', Number(await ev(`document.querySelectorAll('.report-banner').length`))===1);
ok('3e 新建后右侧直接打开了这张纸', await ev(`!!document.querySelector('#report-editor') && document.querySelector('.report-paper-title b').textContent==='11 月第一周周报'`));
ok('3f 名称表单已收起', await ev(`!document.querySelector('#report-name')`));

await ev(`(()=>{const ed=document.querySelector('#report-editor');
  ed.innerHTML='<h2>本周完成</h2><div>做完排期模块</div><table><tbody><tr><td>指标</td><td>结果</td></tr></tbody></table>';
  ed.dispatchEvent(new Event('input',{bubbles:true}));return 1})()`);
await wait(1300);
list=await tasks();
const saved1=list.find(x=>x.kind==='weekreport'&&x.title==='11 月第一周周报');
ok('4a 周报正文写进自己的记录', !!saved1 && saved1.memo.indexOf('本周完成')===0, saved1);
ok('4b 周报也保存富文本表格', !!saved1 && /<table/.test(saved1.memoHtml), saved1&&saved1.memoHtml);

await ev(`document.querySelector('[data-action="report-new"]').click()`);await wait(250);
await ev(`(()=>{const i=document.querySelector('#report-name');i.value='11 月第二周周报';
  document.querySelector('#report-new-form').requestSubmit();return 1})()`);
await wait(800);
ok('5a 第二份周报创建成功', (await tasks()).filter(x=>x.kind==='weekreport').length===2);
ok('5b 第二份自动变成当前周报', await ev(`document.querySelector('.report-paper-title b').textContent==='11 月第二周周报'`));
await ev(`(()=>{const ed=document.querySelector('#report-editor');
  ed.innerHTML='<div>第二周的内容</div>';ed.dispatchEvent(new Event('input',{bubbles:true}));return 1})()`);
await wait(1200);
ok('5c 两份周报各自独立保存', await ev(`(()=>{const a=(window.__mock.files()['tasks.json']||[]).find(x=>x.kind==='weekreport'&&x.title==='11 月第一周周报');
  const b=(window.__mock.files()['tasks.json']||[]).find(x=>x.kind==='weekreport'&&x.title==='11 月第二周周报');
  return !!a&&!!b&&a.memo.indexOf('本周完成')===0&&b.memo==='第二周的内容'})()`));

await ev(`(()=>{const b=[...document.querySelectorAll('.report-banner-hit')].find(x=>x.textContent.indexOf('11 月第一周周报')>=0);b.click();return 1})()`);
await wait(500);
ok('6a 点左侧 banner 切回第一份', await ev(`document.querySelector('.report-paper-title b').textContent==='11 月第一周周报'`));
ok('6b 右侧显示第一份自己的内容', await ev(`document.querySelector('#report-editor').textContent.indexOf('做完排期模块')>=0`));
ok('6c banner 有当前选中态', await ev(`!!document.querySelector('.report-banner.is-active')`));

const layout=await ev(`(()=>{const l=document.querySelector('.report-list-panel').getBoundingClientRect();
  const r=document.querySelector('.report-pane').getBoundingClientRect();
  const list=document.querySelector('.report-banner-list');
  const scroll=document.querySelector('.report-paper-scroll');
  return {lh:Math.round(l.height),rh:Math.round(r.height),topDiff:Math.round(Math.abs(l.top-r.top)),
    leftOverflow:getComputedStyle(list).overflowY,rightOverflow:getComputedStyle(scroll).overflowY,
    workspace:Math.round(document.querySelector('.reports-workspace').getBoundingClientRect().height)}})()`);
ok('7a 左右两栏高度一致', layout.lh===layout.rh&&layout.topDiff===0, layout);
ok('7b 两栏都设置成内部独立滚动', layout.leftOverflow==='auto'&&layout.rightOverflow==='auto', layout);
ok('7c 整体高度接近一屏', layout.workspace>=470&&layout.workspace<=650, layout);

for(let i=0;i<7;i++){await ev(`window.__mock.setRemote('tasks.json',(window.__mock.files()['tasks.json']||[]).concat([{
  id:'extra${i}',kind:'weekreport',title:'补充周报 ${i+1}',memo:'x',memoHtml:'<div>x</div>',
  created:'2026-11-0${(i%8)+1}',createdAt:'2026-11-0${(i%8)+1}T08:0${i}:00.000Z',updatedAt:'2026-11-0${(i%8)+1}T08:0${i}:00.000Z'
}]))`);}
await load(URL_);await wait(1800);await goTab('month');await wait(500);
const scrollable=await ev(`(()=>{const list=document.querySelector('.report-banner-list');
  const left=list.scrollHeight>list.clientHeight;list.scrollTop=40;
  return {left,leftPos:list.scrollTop,count:document.querySelectorAll('.report-banner').length}})()`);
ok('7d 周报很多时左栏自己滚动', scrollable.left&&scrollable.leftPos>0, scrollable);

await ev(`(()=>{const ed=document.querySelector('#report-editor');
  ed.innerHTML='<h2>超长周报</h2>'+Array.from({length:80},(_,i)=>'<div>第 '+(i+1)+' 行内容</div>').join('');
  ed.dispatchEvent(new Event('input',{bubbles:true}));return 1})()`);
await wait(1200);
const rightScroll=await ev(`(()=>{const s=document.querySelector('.report-paper-scroll');
  const over=s.scrollHeight>s.clientHeight;s.scrollTop=80;
  return {over,pos:s.scrollTop,sh:s.scrollHeight,ch:s.clientHeight}})()`);
ok('7e 右侧长周报自己滚动', rightScroll.over&&rightScroll.pos>0, rightScroll);

await send('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:2,mobile:true});
await load(URL_);await wait(1800);await goTab('month');await wait(500);
const mobile=await ev(`(()=>{const ws=document.querySelector('.reports-workspace');
  const l=document.querySelector('.report-list-panel').getBoundingClientRect();
  const r=document.querySelector('.report-pane').getBoundingClientRect();
  return {w:innerWidth,sw:document.documentElement.scrollWidth,
    cols:getComputedStyle(ws).gridTemplateColumns,lw:Math.round(l.width),rw:Math.round(r.width),
    lh:Math.round(l.height),rh:Math.round(r.height),body:document.body.scrollWidth}})()`);
ok('8a 手机宽度没有横向溢出', mobile.sw<=mobile.w&&mobile.body<=mobile.w, mobile);
ok('8b 手机仍保留左 banner + 右正文两栏', mobile.lw>80&&mobile.rw>180, mobile);
ok('8c 手机两栏仍然等高', mobile.lh===mobile.rh, mobile);
ok('8d 手机周报编辑器可用', await ev(`!!document.querySelector('#report-editor')&&!!document.querySelector('#report-toolbar')`));

await ev(`document.querySelector('[data-action="report-delete"]').click()`);await wait(300);
ok('9a 删除前有确认弹窗', await ev(`!document.querySelector('#confirm-backdrop').classList.contains('hidden')`));
await ev(`document.querySelector('#confirm-ok').click()`);await wait(700);
ok('9b 删除后当前周报从左侧消失', (await tasks()).filter(x=>x.kind==='weekreport').length===8,
  (await tasks()).filter(x=>x.kind==='weekreport').length);

await send('Emulation.setDeviceMetricsOverride',{width:1280,height:900,deviceScaleFactor:1,mobile:false});
ok('10 全程无 JS 报错', errors.length===0, errors.slice(0,3));

await dump();
process.exit(R.every(r=>r.pass)?0:1);
