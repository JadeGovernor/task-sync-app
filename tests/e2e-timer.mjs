const CDP='http://127.0.0.1:9334', ORIGIN='http://127.0.0.1:8123', URL_=ORIGIN+'/index.html?v=32';
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
const mouse=(type,x,y,extra={})=>send('Input.dispatchMouseEvent',Object.assign({type,x,y,button:'left',clickCount:1},extra));
const realDrag=async(from,to,steps=8)=>{
  await mouse('mousePressed',from.x,from.y,{buttons:1});
  await wait(60);
  let mid=null;
  for(let i=1;i<=steps;i+=1){
    const x=from.x+(to.x-from.x)*i/steps, y=from.y+(to.y-from.y)*i/steps;
    await mouse('mouseMoved',x,y,{buttons:1});
    if(i===Math.ceil(steps/2)){mid=await ev(`document.body.classList.contains('is-dragging')`)}
    await wait(25);
  }
  await mouse('mouseReleased',to.x,to.y,{buttons:0});
  return mid;
};
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
await load(URL_);await wait(1800);
const goTab=async name=>{await ev(`[...document.querySelectorAll('.tab')].find(t=>t.textContent.includes(${JSON.stringify(name)})).click()`);await wait(400)};
const dAfter=async n=>ev(`Core.shiftDate(Core.todayStr(),${n})`);
const memoVal=()=>ev(`document.querySelector('#memo-text').value`);
const rows=()=>ev(`document.querySelectorAll('#memo-timers .timer-row').length`);
const rowInfo=()=>ev(`[...document.querySelectorAll('#memo-timers .timer-row')].map(r=>({cls:r.className,left:r.querySelector('.timer-left').textContent,text:r.querySelector('.timer-text').textContent,due:r.querySelector('.timer-due').textContent}))`);

// ===== 1) 琐事：光标那一行 + 选日期 → 加倒计时 =====
await goTab('琐事');
ok('1a 琐事页有日期+按钮', await ev(`!!document.querySelector('#memo-timer-date')&&!!document.querySelector('#memo-timer-add')`));
ok('1a2 初始没有倒计时板行', (await rows())===0);
await ev(`(()=>{const ta=document.querySelector('#memo-text');ta.focus();ta.value='买牛奶\\n交房租';ta.dispatchEvent(new Event('input',{bubbles:true}));
  const pos=ta.value.indexOf('交房租')+1;ta.setSelectionRange(pos,pos);return 1})()`);
await wait(200);
const d3=await dAfter(3);
await ev(`(()=>{document.querySelector('#memo-timer-date').value=${JSON.stringify(d3)};document.querySelector('#memo-timer-add').click();return 1})()`);
await wait(400);
const text1=await memoVal();
ok('1b 标记落在光标那一行（第 2 行）', text1==='买牛奶\n交房租 ⏰'+d3, JSON.stringify(text1));
ok('1c 倒计时板出现这条', (await rows())===1, await rows());
const r1=(await rowInfo())[0]||{};
ok('1d 显示剩余天数 + 3天内状态', r1.left==='还有 3 天'&&r1.cls.includes('is-soon'), r1);
ok('1e 已同步到远端', await ev(`JSON.stringify(window.__mock.files()['tasks.json']).includes(${JSON.stringify('交房租 ⏰'+d3)})`));
ok('1f 待上传队列已清空', (await ev(`JSON.parse(localStorage.getItem('ts_outbox_v2')||'[]').length`))===0);

// 板上改日期 → 正文跟着改
const d10=await dAfter(10);
await ev(`(()=>{const i=document.querySelector('#memo-timers [data-action="timer-date"]');i.value=${JSON.stringify(d10)};i.dispatchEvent(new Event('change',{bubbles:true}));return 1})()`);
await wait(400);
ok('1g 板上改日期改的是正文', (await memoVal())==='买牛奶\n交房租 ⏰'+d10, await memoVal());
const r2=(await rowInfo())[0]||{};
ok('1h 剩余天数跟着变', r2.left==='还有 10 天'&&r2.cls.includes('is-far'), r2);
ok('1i 改完也同步出去了', await ev(`JSON.stringify(window.__mock.files()['tasks.json']).includes(${JSON.stringify('交房租 ⏰'+d10)})`));

// 手写标记：直接敲进正文也认
const dOver=await dAfter(-4);
await ev(`(()=>{const ta=document.querySelector('#memo-text');ta.value='买牛奶 ⏰'+${JSON.stringify(dOver)}+'\\n交房租 ⏰'+${JSON.stringify(d10)};ta.dispatchEvent(new Event('input',{bubbles:true}));return 1})()`);
await wait(1400);
ok('1j 手写标记被自动识别', (await rows())===2, await rows());
const rs=(await rowInfo());
ok('1k 过期那条排最前且标红', rs[0].cls.includes('is-over')&&rs[0].left==='已过期 4 天', rs[0]);
ok('1l 倒计时头显示统计', await ev(`document.querySelector('#memo-timers .timer-head').textContent.includes('已过期 1')&&document.querySelector('#memo-timers .timer-head').textContent.includes('倒计时 · 2 条')`));

// ✕ 去掉一条
await ev(`(()=>{document.querySelectorAll('#memo-timers [data-action="timer-del"]')[0].click();return 1})()`);
await wait(500);
ok('1m 删掉后正文里标记也没了', !(await memoVal()).includes('⏰'+dOver), await memoVal());
ok('1n 板上只剩一条', (await rows())===1, await rows());

// ===== 2) 创意：同款能力，且和琐事互不干扰 =====
await goTab('创意');
ok('2a 创意页也有倒计时工具条', await ev(`!!document.querySelector('#memo-timer-add')`));
const d1=await dAfter(1);
await ev(`(()=>{const ta=document.querySelector('#memo-text');ta.focus();ta.value='做一个自动播演讲的闹钟';ta.setSelectionRange(3,3);ta.dispatchEvent(new Event('input',{bubbles:true}));return 1})()`);
await wait(200);
await ev(`(()=>{document.querySelector('#memo-timer-date').value=${JSON.stringify(d1)};document.querySelector('#memo-timer-add').click();return 1})()`);
await wait(400);
ok('2b 创意里也加了倒计时', (await memoVal())==='做一个自动播演讲的闹钟 ⏰'+d1, await memoVal());
ok('2c 创意板 1 条 · 显示「明天」', (await rows())===1&&(await rowInfo())[0].left==='明天', await rowInfo());
ok('2d 两条备忘录各自独立', await ev(`(()=>{const f=window.__mock.files()['tasks.json'];const m=f.find(t=>t.kind==='memo'),i=f.find(t=>t.kind==='idea');return !!m&&!!i&&m.memo!==i.memo})()`));

// ===== 3) 今日页倒计时提醒：只收「今天到期 + 已过期」 =====
const d0=await dAfter(0);
await goTab('琐事');
ok('3a 日期默认就是今天（不是一周后）', (await ev(`document.querySelector('#memo-timer-date').value`))===d0);
await ev(`(()=>{const ta=document.querySelector('#memo-text');ta.focus();ta.setSelectionRange(1,1);return 1})()`);
await wait(200);
await ev(`(()=>{document.querySelector('#memo-timer-date').value=${JSON.stringify(d0)};document.querySelector('#memo-timer-add').click();return 1})()`);
await wait(400);
ok('3b 今天到期那条落在光标行', (await memoVal()).includes('买牛奶 ⏰'+d0), await memoVal());

await goTab('今日');
const todayTxt=await ev(`document.querySelector('#view').innerText`);
ok('3c 今日页出现倒计时提醒', todayTxt.includes('倒计时提醒'), todayTxt.slice(0,120));
ok('3d 今天到期的进来了、带来源标签', todayTxt.includes('买牛奶')&&todayTxt.includes('琐事'), todayTxt.slice(0,200));
ok('3e 明天到期的不掺和进今日', !todayTxt.includes('做一个自动播演讲的闹钟'), todayTxt.slice(0,200));
ok('3f 更远（10 天后）的也不进来', !todayTxt.includes('交房租'), todayTxt.slice(0,200));

// 过期的同样要提醒
await goTab('琐事');
await ev(`(()=>{const ta=document.querySelector('#memo-text');ta.value=${JSON.stringify('牛奶过期了 ⏰')}+${JSON.stringify(dOver)}+'\\n'+ta.value;ta.dispatchEvent(new Event('input',{bubbles:true}));return 1})()`);
await wait(1400);
await goTab('今日');
const todayTxt2=await ev(`document.querySelector('#view').innerText`);
ok('3g 过期的也照常提醒', todayTxt2.includes('牛奶过期了')&&todayTxt2.includes('已过期'), todayTxt2.slice(0,200));

// ===== 3.5) 倒计时那一行的文字可以直接点开改，不用回琐事 / 创意 =====
const rowByText = (box, t) =>
  `(()=>{const r=[...document.querySelectorAll('${box} .timer-row')].find(x=>x.querySelector('.timer-text').textContent===${JSON.stringify(t)});if(!r)return 0;r.querySelector('.timer-text').click();return 1})()`;

ok('3h 今日页也能点开这一行', (await ev(rowByText('#today-timers','买牛奶')))===1);
ok('3i 点完变成输入框', await ev(`!!document.querySelector('#today-timers input.timer-edit')`));
await ev(`(()=>{const i=document.querySelector('#today-timers input.timer-edit');i.value='买菜和牛奶';i.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true}));return 1})()`);
await wait(500);
const memoRemote=await ev(`(window.__mock.files()['tasks.json'].find(t=>t.kind==='memo')||{}).memo`);
ok('3j 今日页改完落回琐事正文、标记原样保留', memoRemote==='牛奶过期了 ⏰'+dOver+'\n买菜和牛奶 ⏰'+d0+'\n交房租 ⏰'+d10, memoRemote);
ok('3k 今日页那张卡片跟着变', (await ev(`document.querySelector('#today-timers').innerText`)).includes('买菜和牛奶'));

await goTab('琐事');
ok('3l 琐事页现在显示改后的字', (await memoVal()).includes('买菜和牛奶'));
ok('3m 琐事页也能点开', (await ev(rowByText('#memo-timers','交房租')))===1);
await ev(`(()=>{const i=document.querySelector('#memo-timers input.timer-edit');i.value='不该保存的内容';i.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}));return 1})()`);
await wait(400);
ok('3n Esc 取消：一个字都没改', !(await memoVal()).includes('不该保存')&&(await memoVal()).includes('交房租 ⏰'+d10), await memoVal());
ok('3o 取消后输入框收掉了', (await ev(`document.querySelectorAll('#memo-timers input.timer-edit').length`))===0);

ok('3p 再点开一次', (await ev(rowByText('#memo-timers','交房租')))===1);
await ev(`(()=>{const i=document.querySelector('#memo-timers input.timer-edit');i.value='交房租和水电';i.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true}));return 1})()`);
await wait(500);
ok('3q 板上和正文都改了，倒计时日期没动', (await memoVal()).includes('交房租和水电 ⏰'+d10)&&(await rowInfo()).some(x=>x.text==='交房租和水电'), await rowInfo());
ok('3r 改完同步到远端', await ev(`JSON.stringify(window.__mock.files()['tasks.json']).includes('交房租和水电')`));
ok('3s 板上还是 3 条（改字不影响条数）', (await rows())===3, await rows());

// ===== 3.6) 打勾 = 这件事划掉：整行（连它的进展）从琐事 / 创意里删掉，误点可撤回 =====
const todayRowsInfo=()=>ev(`[...document.querySelectorAll('#today-timers .timer-row')].map(r=>({cls:r.className,text:r.querySelector('.timer-text').textContent,checked:!!r.querySelector('.timer-cb input').checked}))`);
const memoSaved=()=>ev(`((window.__mock.files()['tasks.json']||[]).find(t=>t.kind==='memo')||{}).memo`);
const tickCb=(box,t)=>`(()=>{const r=[...document.querySelectorAll('${box} .timer-row')].find(x=>x.querySelector('.timer-text').textContent===${JSON.stringify(t)});if(!r)return 0;r.querySelector('.timer-cb input').click();return 1})()`;
const toastText=()=>ev(`document.querySelector('#toast').textContent`);
const clickUndo=()=>ev(`(()=>{const b=document.querySelector('#toast [data-action="undo"]');if(!b)return 0;b.click();return 1})()`);

ok('3.6a 琐事板上每条都有打勾框', (await ev(`document.querySelectorAll('#memo-timers .timer-row .timer-cb input').length`))===3);
ok('3.6b 板上勾掉那条过期的', (await ev(tickCb('#memo-timers','牛奶过期了')))===1);
await wait(700);
ok('3.6c 打勾不再留 ✅，那一行整块从正文删掉', !(await memoVal()).includes('牛奶过期了')&&!(await memoVal()).includes('✅'), await memoVal());
ok('3.6d 板上跟着少一条', (await rows())===2, await rows());
ok('3.6e 删除同步到远端', !(await ev(`JSON.stringify(window.__mock.files()['tasks.json']).includes('牛奶过期了')`)));
const hasUndo=await ev(`!!document.querySelector('#toast [data-action="undo"]')`);
ok('3.6f 提示条上带「撤回」按钮', hasUndo&&(await toastText()).includes('划掉'), await toastText());
ok('3.6g 点撤回', (await clickUndo())===1);
await wait(700);
ok('3.6h 撤回后那一行原样回来', (await memoVal()).includes('牛奶过期了 ⏰'+dOver)&&(await rows())===3, await memoVal());
ok('3.6i 撤回也同步到远端', await ev(`JSON.stringify(window.__mock.files()['tasks.json']).includes('牛奶过期了')`));

/* 今日页勾掉一条：连它下面的进展一起删，不用再回琐事 */
await goTab('琐事');
await ev(`(()=>{const i=[...document.querySelectorAll('#memo-timers .timer-item')].find(x=>x.querySelector('.timer-text').textContent==='买菜和牛奶');i.querySelector('[data-action="sub-add"]').click();return 1})()`);
await wait(250);
await ev(`(()=>{const f=document.querySelector('#memo-timers .timer-sub-add-form');f.querySelector('input').value='已经买好了';f.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}));return 1})()`);
await wait(800);
ok('3.6j 先给这条挂上一条进展', (await memoVal()).includes('↳ '+d0.slice(5)+' 已经买好了'), await memoVal());

await goTab('今日');
const ti1=await todayRowsInfo();
ok('3.6k 今日页两条都在、都还没勾', ti1.length===2&&ti1.every(r=>!r.checked), JSON.stringify(ti1));
ok('3.6l 今日页直接勾掉一条', (await ev(tickCb('#today-timers','买菜和牛奶')))===1);
await wait(700);
ok('3.6m 勾掉的这条从今日页消失，只剩另一条', (await todayRowsInfo()).length===1, JSON.stringify(await todayRowsInfo()));
ok('3.6n 勾选后没被当成切页指令跳到琐事', await ev(`!!document.querySelector('#today-timers')&&!document.querySelector('#memo-text')`));
const saved=await memoSaved();
ok('3.6o 琐事正文里那句和它的进展一起删了', !saved.includes('买菜和牛奶')&&!saved.includes('已经买好了'), saved);
ok('3.6p 别的那条一个字没动', saved.includes('交房租和水电 ⏰'+d10), saved);
ok('3.6q 删除也同步到远端', !(await ev(`JSON.stringify(window.__mock.files()['tasks.json']).includes('已经买好了')`)));
ok('3.6r 今日页也能撤回这一整块', (await clickUndo())===1);
await wait(700);
ok('3.6s 撤回后今日页两条又都在', (await todayRowsInfo()).length===2, JSON.stringify(await todayRowsInfo()));
await goTab('琐事');
ok('3.6t 撤回后那句和它的进展都回来了', (await memoVal()).includes('买菜和牛奶 ⏰'+d0)&&(await memoVal()).includes('↳ '+d0.slice(5)+' 已经买好了'), await memoVal());

/* 收尾：删掉刚加的进展，正文恢复到 3.5 结束时的三行 */
await ev(`(()=>{const s=document.querySelector('#memo-timers .timer-sub');s.querySelector('[data-action="sub-del"]').click();return 1})()`);
await wait(700);
ok('3.6u 现场恢复成三行、没有 ✅', (await memoVal()).split('\n').length===3&&!(await memoVal()).includes('✅'), await memoVal());
await goTab('今日');

// ===== 3.7) 今日页里直接补进展 / 删倒计时 / 拖动排序（不用回琐事 / 创意） =====
const findItem = (box,t)=>`[...document.querySelectorAll('${box} .timer-item')].find(x=>x.querySelector('.timer-text').textContent===${JSON.stringify(t)})`;
const subInfo = (box)=>ev(`[...document.querySelectorAll('${box} .timer-sub')].map(s=>({md:s.querySelector('.sub-md').textContent,text:s.querySelector('.sub-text').textContent}))`);
const setMemo = async (text)=>{await ev(`(()=>{const ta=document.querySelector('#memo-text');ta.value=${JSON.stringify(text)};ta.dispatchEvent(new Event('input',{bubbles:true}));return 1})()`);await wait(1400)};

await goTab('今日');
ok('3.7a 今日页每行都有 ＋进展 / ✕ / 日期', await ev(`document.querySelectorAll('#today-timers [data-action="sub-add"]').length===2&&document.querySelectorAll('#today-timers [data-action="timer-del"]').length===2&&document.querySelectorAll('#today-timers .timer-date').length===2`));
ok('3.7b 今日页整条是拖动单元', await ev(`[...document.querySelectorAll('#today-timers .timer-item')].every(x=>x.querySelector('.timer-row'))`));

await ev(`(()=>{const i=${findItem('#today-timers','买菜和牛奶')};i.querySelector('[data-action="sub-add"]').click();return 1})()`);
ok('3.7c 点＋进展长出输入框', await ev(`!!document.querySelector('#today-timers .timer-sub-add-form input')`));
await ev(`(()=>{const f=document.querySelector('#today-timers .timer-sub-add-form');f.querySelector('input').value='已经买好了';f.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}));return 1})()`);
await wait(600);
const memoNow=()=>ev(`(window.__mock.files()['tasks.json'].find(t=>t.kind==='memo')||{}).memo`);
const memoAfterSub=await memoNow();
ok('3.7d 进展写进琐事正文（今天日期 + ↳）', memoAfterSub.includes('  ↳ '+d0.slice(5)+' 已经买好了'), memoAfterSub);
const subLines=memoAfterSub.split('\n');
const parentAt=subLines.findIndex((l)=>l.includes('买菜和牛奶'));
ok('3.7e 进展紧跟在那一句话下面', subLines[parentAt+1].trim()==='↳ '+d0.slice(5)+' 已经买好了', JSON.stringify(subLines));
ok('3.7f 今日页立刻显示这条进展', (await subInfo('#today-timers')).some(s=>s.text==='已经买好了'), JSON.stringify(await subInfo('#today-timers')));
ok('3.7g 今日页补的进展已同步到远端', await ev(`JSON.stringify(window.__mock.files()['tasks.json']).includes(${JSON.stringify('↳ '+d0.slice(5)+' 已经买好了')})`));

await goTab('琐事');
ok('3.7h 琐事板也显示同一条进展', (await subInfo('#memo-timers')).some(s=>s.text==='已经买好了'), JSON.stringify(await subInfo('#memo-timers')));
ok('3.7i 进展被算作那句话的一部分（没多出倒计时）', (await rows())===3, await rows());

await ev(`(()=>{const s=[...document.querySelectorAll('#memo-timers .timer-sub')].find(x=>x.querySelector('.sub-text').textContent==='已经买好了');s.querySelector('.sub-text').click();return 1})()`);
ok('3.7j 点进展的文字变成输入框', await ev(`!!document.querySelector('#memo-timers .timer-sub input.sub-edit')`));
await ev(`(()=>{const i=document.querySelector('#memo-timers .timer-sub input.sub-edit');i.value='已经买好了，还买了鸡蛋';i.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true}));return 1})()`);
await wait(600);
ok('3.7k 改完写回正文、日期还在', (await memoVal()).includes('↳ '+d0.slice(5)+' 已经买好了，还买了鸡蛋'), await memoVal());

await ev(`(()=>{const s=[...document.querySelectorAll('#memo-timers .timer-sub')].find(x=>x.querySelector('.sub-text').textContent==='已经买好了，还买了鸡蛋');s.querySelector('[data-action="sub-del"]').click();return 1})()`);
await wait(600);
ok('3.7l 删掉这条进展', !(await memoNow()).includes('已经买好了')&&!(await memoNow()).includes('↳'), await memoNow());
ok('3.7m 删完那句话本身还在', (await memoNow()).includes('买菜和牛奶 ⏰'+d0), await memoNow());

/* 今日页 ✕ = 去掉倒计时标记，正文那句话保留 */
await goTab('今日');
await ev(`(()=>{const i=${findItem('#today-timers','牛奶过期了')};i.querySelector('[data-action="timer-del"]').click();return 1})()`);
await wait(600);
const memoAfterDel=await memoNow();
ok('3.7n 今日页 ✕ 去掉倒计时，正文那句话留着', memoAfterDel.includes('牛奶过期了')&&!memoAfterDel.includes('⏰'+dOver), memoAfterDel);
ok('3.7o 今日页那张卡片跟着少一条', await ev(`document.querySelectorAll('#today-timers .timer-item').length===1`));

/* 拖动排序：同一档里两条（都是今天），把下面那条拖到上面 */
await goTab('琐事');
await setMemo('甲今天 ⏰'+d0+'\n乙今天 ⏰'+d0);
ok('3.7p 板上按正文顺序排', JSON.stringify((await rowInfo()).map(r=>r.text))===JSON.stringify(['甲今天','乙今天']), await rowInfo());
const centers=await ev(`(()=>{
  const find=(t)=>[...document.querySelectorAll('#memo-timers .timer-item')].find(x=>x.querySelector('.timer-text').textContent===t);
  const a=find('甲今天'), b=find('乙今天');
  b.scrollIntoView({block:'center'});
  const ca=a.querySelector('.timer-text').getBoundingClientRect(), cb=b.querySelector('.timer-text').getBoundingClientRect();
  return {a:{x:Math.round(ca.left+ca.width/2),y:Math.round(ca.top+ca.height/2)},b:{x:Math.round(cb.left+cb.width/2),y:Math.round(cb.top+cb.height/2)}}})()`);
const dragging=await realDrag(centers.b,{x:centers.a.x,y:centers.a.y-6});
ok('3.7q 整条任意位置都能拖起来', dragging===true, dragging);
await wait(700);
ok('3.7r 拖完正文顺序真的换了', (await memoVal()).split('\n').slice(0,2).join('|')==='乙今天 ⏰'+d0+'|甲今天 ⏰'+d0, await memoVal());
ok('3.7s 板上顺序跟着换', JSON.stringify((await rowInfo()).map(r=>r.text))===JSON.stringify(['乙今天','甲今天']), await rowInfo());
ok('3.7t 拖动顺序也同步到远端', (await memoNow()).startsWith('乙今天 ⏰'+d0+'\n甲今天 ⏰'+d0), await memoNow());

/* 今日页拖动：跨备忘录不互相搬（只在自己那张纸上换位置） */
await goTab('创意');
await setMemo('创意今天 ⏰'+d0);
await goTab('今日');
const todayOrder=()=>ev(`[...document.querySelectorAll('#today-timers .timer-text')].map(x=>x.textContent)`);
ok('3.7u 今日页把两张备忘录的提醒并在一起', JSON.stringify(await todayOrder())===JSON.stringify(['乙今天','创意今天','甲今天']), await todayOrder());
const c2=await ev(`(()=>{
  const find=(t)=>[...document.querySelectorAll('#today-timers .timer-item')].find(x=>x.querySelector('.timer-text').textContent===t);
  const a=find('乙今天'), b=find('甲今天');
  b.scrollIntoView({block:'center'});
  const ca=a.querySelector('.timer-text').getBoundingClientRect(), cb=b.querySelector('.timer-text').getBoundingClientRect();
  return {a:{x:Math.round(ca.left+ca.width/2),y:Math.round(ca.top+ca.height/2)},b:{x:Math.round(cb.left+cb.width/2),y:Math.round(cb.top+cb.height/2)}}})()`);
await realDrag(c2.b,{x:c2.a.x,y:c2.a.y-6});
await wait(700);
ok('3.7v 今日页拖完琐事的顺序也换了', (await memoNow()).startsWith('甲今天 ⏰'+d0+'\n乙今天'), await memoNow());
ok('3.7w 创意那张纸一个字没动', (await ev(`(window.__mock.files()['tasks.json'].find(t=>t.kind==='idea')||{}).memo`))==='创意今天 ⏰'+d0);

/* 把现场恢复到 3.6 结束时的样子，后面第 4 段还要用 */
await goTab('琐事');
await setMemo('牛奶过期了 ⏰'+dOver+'\n买菜和牛奶 ⏰'+d0+'\n交房租和水电 ⏰'+d10);
await goTab('创意');
await setMemo('做一个自动播演讲的闹钟 ⏰'+d1);
await goTab('琐事');
ok('3.7x 恢复：琐事仍是 3 条、创意仍是 1 条', (await rows())===3, await rowInfo());

// ===== 4) 刷新（换设备/新会话）后还在 =====
await load(URL_);await wait(1800);
await goTab('琐事');
ok('4a 刷新后琐事的倒计时还在', (await rows())===3&&(await memoVal()).includes('⏰'+d10), await rowInfo());
await goTab('创意');
ok('4b 刷新后创意的倒计时还在', (await rows())===1&&(await rowInfo())[0].left==='明天', await rowInfo());
await wait(4000);
ok('4c 心跳几轮没被冲掉', (await rows())===1);

// ===== 5) 版本与离线 =====
const ver=await ev(`window.TS_CONFIG.version`);
ok('5a 脚本资源版本号与 config 一致', await ev(`[...document.querySelectorAll('script')].every(s=>!s.src||s.src.includes('v='+window.TS_CONFIG.version))`), ver);
ok('5b Service Worker 缓存名跟随版本', (await (await fetch(ORIGIN+'/sw.js')).text()).includes('task-sync-v'+ver), ver);

ok('页面无 JS 异常', errors.length===0, errors.join(' | ').slice(0,300));
await send('Page.removeScriptToEvaluateOnNewDocument',{identifier:inj.identifier});
await dump();
process.exit(R.every(r=>r.pass)?0:1);
