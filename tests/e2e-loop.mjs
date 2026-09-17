const CDP='http://127.0.0.1:9334', ORIGIN='http://127.0.0.1:8123', URL_=ORIGIN+'/index.html?v=23';
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
const inj=await send('Page.addScriptToEvaluateOnNewDocument',{source:MOCK});
await load(URL_);await wait(1200);

/* 日期不写死：跟着真实「今天」算，哪天跑都成立
 * D.WD   = 今天星期几（循环任务该今天做）
 * D.other= 另一个星期几（今天不该出现）；若本周有已过去的日子就用昨天，好验「本周已过」 */
const D=await ev(`(()=>{const WD=new Date().getDay();const t=Core.todayStr();const elapsed=(WD+6)%7;
  const hasPast=elapsed>0;const other=hasPast?(WD+6)%7:(WD+2)%7;const alt2=(WD+2)%7;
  return {WD,t,elapsed,hasPast,other,alt2,week:Core.weekKey(t),
    otherShort:Core.WEEKDAY_SHORT[other],altShort:Core.WEEKDAY_SHORT[alt2],
    minus20:Core.shiftDate(t,-20)}})()`);
await ev(`(()=>{window.__mock.setRemote('tasks.json',[
  {id:'l1',kind:'loop',title:'每周固定写周报',weekdays:[${D.WD}],doneWeeks:[],created:${JSON.stringify(D.minus20)},notes:[],updatedAt:'2026-09-01T00:00:00.000Z'},
  {id:'l2',kind:'loop',title:'另一天开例会',weekdays:[${D.other}],doneWeeks:[],created:${JSON.stringify(D.minus20)},notes:[],updatedAt:'2026-09-01T00:00:00.000Z'},
  {id:'w1',kind:'work',title:'跟进供应商',created:${JSON.stringify(D.t)},due:${JSON.stringify(D.t)},done:false,notes:[],updatedAt:'2026-09-01T00:00:00.000Z'}]);
  localStorage.removeItem('ts_state_v2');localStorage.removeItem('ts_revs_v2');return 1})()`);
await load(URL_);await wait(1800);

const remoteLoop=(id)=>{const f=ev(`window.__mock.files()['tasks.json']`);return f};
const goTab=async(id)=>{for(let i=0;i<8;i++){await ev(`(()=>{const t=document.querySelector('.tab[data-tab="${id}"]');if(t)t.click();return 1})()`);await wait(350);
  if(await ev(`!!document.querySelector('.tab[data-tab="${id}"].active')`)){await wait(250);return true}}return false};

/* 1. 今日页：循环任务置顶 */
const firstSec=await ev(`(document.querySelector('#view section h3')||{}).textContent||''`);
ok('1a 今日第一条区块是「今日循环任务」', /今日循环任务/.test(firstSec), firstSec);
ok('1b 今天该做的循环任务在今日显示', await ev(`!!document.querySelector('#view .task[data-id="l1"]')`));
ok('1c 不是今天那条今天不出现', !(await ev(`!!document.querySelector('#view .task[data-id="l2"]')`)));
ok('1d 标题写「1 条待做」', /1 条待做/.test(firstSec), firstSec);
ok('1e 带「今天要做」标记', /今天要做/.test(await ev(`document.querySelector('#view .task[data-id="l1"]').textContent`)));
ok('1f 循环任务排在今日效率卡之前',
  await ev(`(()=>{const cards=[...document.querySelectorAll('#view > section')];
    const a=cards.findIndex(s=>/今日循环任务/.test(s.textContent)), b=cards.findIndex(s=>/今日效率/.test(s.textContent));
    return a>=0 && b>=0 && a<b})()`));

/* 2. 打勾 → 从今日消失 + 本周已完成沉到公司页底部 */
await ev(`document.querySelector('#view .task[data-id="l1"] input[data-action="toggle"]').click()`);
await wait(1200);
ok('2a 打勾后从今日消失', !(await ev(`!!document.querySelector('#view .task[data-id="l1"]')`)));
ok('2b 今日显示「都做完了」', /都做完了/.test(await ev(`document.querySelector('#view').textContent`)));
await wait(1200);
let l1=(await ev(`window.__mock.files()['tasks.json']`)).find(x=>x.id==='l1');
ok('2c 已写进云端 doneWeeks（本周 ' + D.week + '）', l1 && (l1.doneWeeks||[]).indexOf(D.week)>=0, l1&&l1.doneWeeks);

ok('3a 切到公司页', await goTab('work'));
const wTxt=await ev(`(()=>{const s=[...document.querySelectorAll('#view > section')].find(x=>/循环任务/.test(x.querySelector('h3')?x.querySelector('h3').textContent:''));return s?s.textContent:''})()`);
ok('3b 公司页有「循环任务」区块', /循环任务 · 每周固定要做/.test(wTxt), wTxt.slice(0,60));
ok('3c 循环任务在公司页最底部',
  await ev(`(()=>{const cards=[...document.querySelectorAll('#view > section')];const s=cards[cards.length-1];
    return /循环任务 · 每周固定要做/.test(s.textContent)})()`));
const doneRow=await ev(`(()=>{const t=document.querySelector('#view .task[data-id="l1"]');return t?{cls:t.className,inGrid:!!t.closest('.done-grid'),txt:t.textContent}:null})()`);
ok('3d 打勾那条已划掉（is-done）', doneRow && /is-done/.test(doneRow.cls), doneRow);
ok('3e 已沉到底部 done 网格里', doneRow && doneRow.inGrid, doneRow);
ok('3f 标签显示「本周已完成」', doneRow && /本周已完成/.test(doneRow.txt), doneRow);
const strike=await ev(`(()=>{const t=document.querySelector('#view .task[data-id="l1"] .task-title');return getComputedStyle(t).textDecorationLine})()`);
ok('3g 文字真的带删除线', /line-through/.test(strike), strike);
const l2txt=await ev(`(()=>{const t=document.querySelector('#view .task[data-id="l2"]');return t?t.textContent+'|'+(t.closest('.done-grid')?'grid':'pend'):''})()`);
if (D.hasPast) ok('3h 本周已过的那天仍在待办区标「本周已过」', /本周已过/.test(l2txt) && /pend/.test(l2txt), l2txt);
else ok('3h 本周还没过去的那天照常在待办区', /pend/.test(l2txt) && !/is-done/.test(l2txt), l2txt);

/* 4. 公司页快速添加：改选另一个星期几 */
ok('4-0 快速添加默认勾中今天（星期值 ' + D.WD + '）', await ev(`!!document.querySelector('#lp-weekdays .wd.on input[value="${D.WD}"]')`));
/* 填标题 / 点星期 / 提交放同一次调用里：中间不等待，免得后台心跳刷新把表单重置掉 */
const lpOn=await ev(`(()=>{const f=document.querySelector('#loop-form');
  f.querySelector('#lp-title').value='每周${D.altShort}写总结';
  [...f.querySelectorAll('#lp-weekdays .wd')].find(l=>l.querySelector('input').value==='${D.WD}').click(); // 取消今天
  [...f.querySelectorAll('#lp-weekdays .wd')].find(l=>l.querySelector('input').value==='${D.alt2}').click(); // 只留那一天
  const on=[...document.querySelectorAll('#lp-weekdays .wd.on input')].map(i=>i.value);
  f.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}));
  return on})()`);
ok('4a 点星期按钮会高亮', lpOn.length===1 && lpOn[0]===String(D.alt2), lpOn);
await wait(1400);
const added=(await ev(`window.__mock.files()['tasks.json']`)).find(x=>x.title==='每周'+D.altShort+'写总结');
ok('4b 新循环任务已建并同步云端', added && added.kind==='loop' && added.weekdays.join()===String(D.alt2), added);
ok('4c 页面上出现「每周 ' + D.altShort + '」的条目', new RegExp('每周 ' + D.altShort).test(await ev(`document.querySelector('#view .task[data-id="${added&&added.id}"]').textContent`)));
ok('4d 输入框已清空', (await ev(`document.querySelector('#lp-title').value`))==='');

/* 5. 取消打勾 → 回到未完成、重新出现 */
await ev(`document.querySelector('#view .task[data-id="l1"] input[data-action="toggle"]').click()`);
await wait(1300);
const l1b=(await ev(`window.__mock.files()['tasks.json']`)).find(x=>x.id==='l1');
ok('5a 取消打勾后 doneWeeks 清空', l1b && (l1b.doneWeeks||[]).length===0, l1b&&l1b.doneWeeks);
ok('5b 回到待办区、不再划掉', await ev(`(()=>{const t=document.querySelector('#view .task[data-id="l1"]');return !!t && !t.classList.contains('is-done') && !t.closest('.done-grid')})()`));

/* 5c. 循环任务也要能写进展（本轮新增） */
ok('5c 未完成的循环任务带进展输入框',
  await ev(`!!document.querySelector('#view .item-card[data-id="l1"] .note-inline[data-id="l1"] input')`));
ok('5d 还没有进展时给提示语',
  /还没有进展/.test(await ev(`document.querySelector('#view .item-card[data-id="l1"] .notes-zone').textContent`)));
await ev(`(()=>{const f=document.querySelector('#view .note-inline[data-id="l1"]');
  f.querySelector('input').value='这周的周报先写了开头';
  f.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}));return 1})()`);
await wait(1300);
const l1n=(await ev(`window.__mock.files()['tasks.json']`)).find(x=>x.id==='l1');
ok('5e 进展已写进云端（带日期、时间与文字）',
  l1n && (l1n.notes||[]).length===1 && l1n.notes[0].text==='这周的周报先写了开头'
  && /^\d{4}-\d{2}-\d{2}$/.test(l1n.notes[0].date||'') && !!l1n.notes[0].time, l1n&&l1n.notes);
ok('5f 页面上这条进展已显示', /这周的周报先写了开头/.test(await ev(`document.querySelector('#view .item-card[data-id="l1"]').textContent`)));
ok('5g 进展带序号 1',
  (await ev(`(document.querySelector('#view .note-line[data-note-index="0"] .note-num')||{}).textContent||''`)).trim()==='1');

/* 5h. 今日页的循环任务同样能补进展（和公司条目一致） */
ok('5h 今日页循环任务带「＋进展」按钮', await goTab('today') && await ev(`!!document.querySelector('#view .task[data-id="l1"] [data-action="note"]')`));
ok('5i 今日页也看得到刚写的进展', /这周的周报先写了开头/.test(await ev(`document.querySelector('#view').textContent`)));
await goTab('work');

/* 6. 弹窗新建：类型选「循环任务」+ 另一个星期几 */
await ev(`document.querySelector('#btn-new').click()`);
await wait(400);
await ev(`(()=>{const k=document.querySelector('#f-kind');k.value='loop';k.dispatchEvent(new Event('change',{bubbles:true}));return 1})()`);
await wait(300);
ok('6a 弹窗显示星期选择器', !(await ev(`document.querySelector('.fg-loop').classList.contains('hidden')`)));
ok('6b 弹窗隐藏到日期的公司字段', await ev(`document.querySelector('.fg-work').classList.contains('hidden')`));
ok('6c 类型下拉里有「循环任务」', /循环任务/.test(await ev(`document.querySelector('#f-kind option[value="loop"]').textContent`)));
await ev(`(()=>{document.querySelector('#f-title').value='每周${D.altShort}发周计划';
  [...document.querySelectorAll('#f-weekdays .wd')].find(l=>l.querySelector('input').value==='${D.WD}').click(); // 取消默认的今天
  [...document.querySelectorAll('#f-weekdays .wd')].find(l=>l.querySelector('input').value==='${D.alt2}').click();
  document.querySelector('#task-form').dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}));return 1})()`);
await wait(1400);
const mAdded=(await ev(`window.__mock.files()['tasks.json']`)).find(x=>x.title==='每周'+D.altShort+'发周计划');
ok('6d 弹窗建出的循环任务已同步', mAdded && mAdded.weekdays.join()===String(D.alt2), mAdded);
ok('6e 弹窗已关闭', await ev(`document.querySelector('#modal-backdrop').classList.contains('hidden')`));
await ev(`document.querySelector('.tab[data-tab="today"]').click()`);
await wait(500);
ok('6f 不是今天那条不会出现在今日页', !(await ev(`!!document.querySelector('#view .task[data-id="${mAdded && mAdded.id}"]')`)));

/* 7. 刷新后状态保持（不会变少/回退） */
await load(URL_);await wait(1800);
const keep=(await ev(`window.__mock.files()['tasks.json']`)).filter(x=>x.kind==='loop').map(x=>x.id+x.title).sort();
ok('7a 刷新后三端内容不变少', keep.length===4, keep);
await goTab('work');
ok('7c 刷新后循环任务的进展还在', /这周的周报先写了开头/.test(await ev(`document.querySelector('#view').textContent`)));
ok('7b 无 JS 报错', errors.length===0, errors.slice(0,3));

await dump();
process.exit(R.every(r=>r.pass)?0:1);
