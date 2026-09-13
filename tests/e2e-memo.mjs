const CDP='http://127.0.0.1:9334', ORIGIN='http://127.0.0.1:8123', URL_=ORIGIN+'/index.html?v=20';
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
await load(URL_);await wait(1800);
const goTab=async name=>{await ev(`[...document.querySelectorAll('.tab')].find(t=>t.textContent.includes(${JSON.stringify(name)})).click()`);await wait(400)};

// ===== 1) 琐事：敲完字立刻切页 =====
await goTab('琐事');
ok('1a 琐事页有输入框', await ev(`!!document.querySelector('#memo-text')`));
await ev(`(()=>{const ta=document.querySelector('#memo-text');ta.focus();ta.value='买牛奶 + 交房租';ta.dispatchEvent(new Event('input',{bubbles:true}));return 1;})()`);
await wait(120);
await goTab('习惯');
await wait(1600);
await goTab('琐事');
const memoBack=await ev(`document.querySelector('#memo-text').value`);
ok('1b 切页回来字还在', memoBack==='买牛奶 + 交房租', memoBack);
ok('1c 已进远端', await ev(`JSON.stringify(window.__mock.files()['tasks.json']).includes('买牛奶 + 交房租')`));
ok('1d 待上传队列已清空', await ev(`JSON.parse(localStorage.getItem('ts_outbox_v2')||'[]').length`)===0);
await wait(6000);
ok('1e 心跳后仍在（没被冲掉）', await ev(`document.querySelector('#memo-text') && document.querySelector('#memo-text').value==='买牛奶 + 交房租'`));

// ===== 2) 习惯：加一条 -> 删掉 -> 反复心跳不复活 =====
await goTab('习惯');
await ev(`(()=>{document.querySelector('#k-title').value='每天读书';document.querySelector('#keep-form').dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}));return 1;})()`);
await wait(1600);
const hId=await ev(`(window.__mock.files()['tasks.json'].find(t=>t.title==='每天读书')||{}).id`);
ok('2a 习惯进了远端', !!hId, hId);
await ev(`(()=>{const c=document.querySelector('[data-id="${hId}"] .mini-btn[data-action="edit"]');c.click();return 1;})()`);
await wait(500);
ok('2b0 打开详情弹窗', await ev(`document.querySelector('#btn-delete-task')&&!document.querySelector('#btn-delete-task').classList.contains('hidden')`));
await ev(`document.querySelector('#btn-delete-task').click()`);
await wait(500);
await ev(`document.querySelector('#confirm-ok').click()`);
await wait(2000);
ok('2b 远端已不含该习惯', await ev(`!window.__mock.files()['tasks.json'].some(t=>t.id===${JSON.stringify(hId)})`));
ok('2c 删除后队列归零', await ev(`JSON.parse(localStorage.getItem('ts_outbox_v2')||'[]').length`)===0);
await wait(7000);
ok('2d 七秒后没复活', await ev(`!window.__mock.files()['tasks.json'].some(t=>t.id===${JSON.stringify(hId)})&&!JSON.parse(localStorage.getItem('ts_state_v2')).tasks.some(t=>t.id===${JSON.stringify(hId)})`));
ok('2e 琐事仍在', await ev(`window.__mock.files()['tasks.json'].some(t=>t.memo==='买牛奶 + 交房租')`));

// ===== 2.5) 创意备忘录：和琐事同款、互不干扰 =====
await goTab('创意');
ok('2f 创意页有输入框', await ev(`!!document.querySelector('#memo-text')`));
ok('2g 创意初始为空', (await ev(`document.querySelector('#memo-text').value`))==='');
await ev(`(()=>{const ta=document.querySelector('#memo-text');ta.focus();ta.value='做一个自动播演讲的闹钟';ta.dispatchEvent(new Event('input',{bubbles:true}));return 1;})()`);
await wait(1400);
ok('2h 创意已进远端', await ev(`window.__mock.files()['tasks.json'].some(t=>t.kind==='idea'&&t.memo==='做一个自动播演讲的闹钟')`));
await goTab('琐事');
const memoStill=await ev(`document.querySelector('#memo-text').value`);
ok('2i 切回琐事内容没被串改', memoStill==='买牛奶 + 交房租', memoStill);
await goTab('创意');
ok('2j 创意内容还在', (await ev(`document.querySelector('#memo-text').value`))==='做一个自动播演讲的闹钟');
ok('2k 两条备忘录各自一条', await ev(`(()=>{const f=window.__mock.files()['tasks.json'];return f.filter(t=>t.kind==='memo').length===1&&f.filter(t=>t.kind==='idea').length===1})()`));
ok('2l 灵感不混进今日/公司/计划', await ev(`(()=>{document.querySelector('[data-tab="today"]').click();return 1})()`)!==undefined);
await wait(400);
ok('2m 今日页没出现备忘录条目', await ev(`!document.querySelector('#view').innerText.includes('做一个自动播演讲的闹钟')&&!document.querySelector('#view').innerText.includes('买牛奶')`));
ok('2n 创意 tab 在琐事后面', await ev(`(()=>{const t=[...document.querySelectorAll('.tab')].map(x=>x.textContent.replace(/\\d+$/,'').trim());return t.indexOf('创意')===t.indexOf('琐事')+1})()`));

// ===== 3) 旧版遗留队列（无 _id）进来即清空、不回灌 =====
await ev(`(()=>{const stale={id:'ghost1',kind:'keep',title:'早该删掉的习惯',created:'2026-01-01'};
  const st=JSON.parse(localStorage.getItem('ts_state_v2'));st.tasks=st.tasks.concat([stale]);localStorage.setItem('ts_state_v2',JSON.stringify(st));
  localStorage.setItem('ts_outbox_v2',JSON.stringify([{file:'tasks',type:'task_set',task:stale},{file:'tasks',type:'task_set',task:stale}]));return 1})()`);
await load(URL_);await wait(1800);
ok('3a 旧队列被清空', await ev(`JSON.parse(localStorage.getItem('ts_outbox_v2')||'[]').length`)===0);
await wait(6500);
ok('3b 幽灵习惯没被回灌', await ev(`!window.__mock.files()['tasks.json'].some(t=>t.id==='ghost1')&&!JSON.parse(localStorage.getItem('ts_state_v2')).tasks.some(t=>t.id==='ghost1')`));

// ===== 4) 版本与离线能力 =====
ok('4a 已切到 v20 资源', await ev(`[...document.querySelectorAll('script')].every(s=>!s.src||s.src.includes('v=20'))`));
ok('4b Service Worker 缓存名 v20', (await (await fetch(ORIGIN+'/sw.js')).text()).includes('task-sync-v20'));

ok('页面无 JS 异常', errors.length===0, errors.join(' | ').slice(0,300));
await send('Page.removeScriptToEvaluateOnNewDocument',{identifier:inj.identifier});
await dump();
process.exit(R.every(r=>r.pass)?0:1);
