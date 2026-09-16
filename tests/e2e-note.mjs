const CDP='http://127.0.0.1:9334', ORIGIN='http://127.0.0.1:8123', URL_=ORIGIN+'/index.html?v=22';
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
await load(URL_);await wait(1600);

// 先塞一条今天到期的公司条目
await ev(`(()=>{window.__mock.setRemote('tasks.json',[{id:'w1',kind:'work',title:'跟进供应商',created:'2026-09-16',due:'2026-09-16',done:false,notes:[],updatedAt:'2026-09-16T00:00:00.000Z'}]);
  localStorage.removeItem('ts_state_v2');localStorage.removeItem('ts_revs_v2');return 1})()`);
await load(URL_);await wait(1800);
const goTab=async(id)=>{for(let i=0;i<8;i++){await ev(`(()=>{const t=document.querySelector('.tab[data-tab="${id}"]');if(t)t.click();return 1})()`);await wait(350);
  if(await ev(`!!document.querySelector('.tab[data-tab="${id}"].active')`)){await wait(250);return true}}return false};
ok('0a 切到公司页', await goTab('work'));
const addNote=async text=>{await ev(`(()=>{const f=document.querySelector('.note-inline[data-id="w1"]');
  if(!f)throw new Error('没有进展输入框');f.querySelector('input').value=${JSON.stringify(text)};
  f.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}));return 1})()`);await wait(900)};

ok('0 公司条目带进展输入框', await ev(`!!document.querySelector('.note-inline[data-id="w1"]')`));
await addNote('第一条');await addNote('第二条');await addNote('第三条');
const openTexts=()=>`[...document.querySelectorAll('.note-list[data-notes-for="w1"] .note-line .note-text')].map(e=>e.textContent)`;
const doneTexts=()=>`[...document.querySelectorAll('.notes-done .note-line .note-text')].map(e=>e.textContent)`;
ok('1a 三条进展都在上面', JSON.stringify(await ev(openTexts()))===JSON.stringify(['第三条','第二条','第一条']), await ev(openTexts()));
ok('1b 上下小三角已删除', await ev(`document.querySelectorAll('[data-action="note-up"],[data-action="note-down"]').length`)===0);
ok('1c 有打勾按钮', await ev(`document.querySelectorAll('.note-list[data-notes-for="w1"] .note-ok').length`)===3);

// 打勾第一条（最上面那条）→ 划掉沉底
await ev(`document.querySelector('.note-list[data-notes-for="w1"] .note-ok').click()`);
await wait(1000);
ok('2a 打勾后移到已完成区', JSON.stringify(await ev(doneTexts()))===JSON.stringify(['第三条']), await ev(doneTexts()));
ok('2b 上面只剩两条', JSON.stringify(await ev(openTexts()))===JSON.stringify(['第二条','第一条']), await ev(openTexts()));
ok('2c 划掉样式生效', await ev(`(()=>{const t=document.querySelector('.notes-done .note-line .note-text');
  return !!t && getComputedStyle(t).textDecorationLine.includes('line-through')})()`));
ok('2d 已完成区被标注', await ev(`!!document.querySelector('.note-done-sep')`));
ok('2e 远端已记录 done', await ev(`(()=>{const n=window.__mock.files()['tasks.json'][0].notes.find(x=>x.text==='第三条');return !!(n&&n.done&&n.doneAt)})()`));

// 取消打勾 → 回到最上面
await ev(`document.querySelector('.notes-done .note-ok').click()`);
await wait(1000);
ok('3a 取消后回到上面', JSON.stringify(await ev(openTexts()))===JSON.stringify(['第三条','第二条','第一条']), await ev(openTexts()));
ok('3b 已完成区消失', await ev(`!document.querySelector('.notes-done')`));

// 点文字就地修改
await ev(`document.querySelector('.note-list[data-notes-for="w1"] .note-line .note-text').click()`);
await wait(300);
ok('4a 出现编辑输入框', await ev(`!!document.querySelector('.note-edit')`));
ok('4b 编辑框带原文', (await ev(`document.querySelector('.note-edit') && document.querySelector('.note-edit').value`))==='第三条');
await ev(`(()=>{const i=document.querySelector('.note-edit');i.value='第三条（改过）';
  i.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true}));return 1})()`);
await wait(1000);
ok('4c 文字已改', JSON.stringify(await ev(openTexts()))===JSON.stringify(['第三条（改过）','第二条','第一条']), await ev(openTexts()));
ok('4d 没有多出条目', await ev(`document.querySelectorAll('.note-line').length`)===3);
ok('4e 远端文字同步', await ev(`window.__mock.files()['tasks.json'][0].notes.some(n=>n.text==='第三条（改过）')`));

// 拖拽换顺序：把最上面那条拖到最下面
await ev(`(()=>{const ls=[...document.querySelectorAll('.note-list[data-notes-for="w1"] .note-line')];
  const a=ls[0].getBoundingClientRect(), b=ls[2].getBoundingClientRect();
  const pe=(type,x,y)=>new PointerEvent(type,{bubbles:true,cancelable:true,clientX:x,clientY:y,pointerId:7,pointerType:'mouse',button:0,buttons:1});
  ls[0].dispatchEvent(pe('pointerdown',a.left+20,a.top+8));
  window.dispatchEvent(pe('pointermove',a.left+20,a.top+30));
  window.dispatchEvent(pe('pointermove',b.left+20,b.bottom+6));
  window.dispatchEvent(pe('pointerup',b.left+20,b.bottom+6));
  return 1})()`);
await wait(1200);
ok('5a 拖拽后顺序变了', JSON.stringify(await ev(openTexts()))===JSON.stringify(['第二条','第一条','第三条（改过）']), await ev(openTexts()));
ok('5b 拖拽结果进远端', await ev(`(()=>{const n=window.__mock.files()['tasks.json'][0].notes;
  return n.slice().sort((x,y)=>y.seq-x.seq).filter(x=>!x.done).map(x=>x.text).join('|')==='第二条|第一条|第三条（改过）'})()`));
ok('5c 拖拽没有误触发编辑框', await ev(`!document.querySelector('.note-edit')`));
ok('5d 待上传队列已清空', await ev(`JSON.parse(localStorage.getItem('ts_outbox_v2')||'[]').length`)===0);
await wait(6000);
ok('5e 心跳后内容没被冲掉', JSON.stringify(await ev(openTexts()))===JSON.stringify(['第二条','第一条','第三条（改过）']), await ev(openTexts()));

ok('4a2 脚本资源版本号与 config 一致', await ev(`(()=>{const v=window.TS_CONFIG.version;
  return [...document.querySelectorAll('script')].every(s=>!s.src||s.src.includes('v='+v))})()`), await ev(`window.TS_CONFIG.version`));
ok('页面无 JS 异常', errors.length===0, errors.join(' | ').slice(0,300));
await send('Page.removeScriptToEvaluateOnNewDocument',{identifier:inj.identifier});
await dump();
process.exit(R.every(r=>r.pass)?0:1);
