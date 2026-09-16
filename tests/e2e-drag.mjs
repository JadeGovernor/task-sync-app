/* 拖拽排序：真实鼠标事件下不应拖出文字选区、不应触发原生拖拽（那个「复制感」） */
const CDP='http://127.0.0.1:9334', ORIGIN='http://127.0.0.1:8123', URL_=ORIGIN+'/index.html?v=24';
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
  window.__nativeDrags=0;
  document.addEventListener('dragstart',()=>{window.__nativeDrags++},true);
  window.addEventListener('selectstart',()=>{window.__selectStarts=(window.__selectStarts||0)+1},true);
})();`;

/* 真实鼠标：按下 → 逐步移动 → 松开 */
const mouse=async(type,x,y,extra={})=>send('Input.dispatchMouseEvent',Object.assign({type,x,y,button:'left',clickCount:1},extra));
const realDrag=async(from,to,steps=8)=>{
  await send('Input.dispatchMouseEvent',{type:'mousePressed',x:from.x,y:from.y,button:'left',buttons:1,clickCount:1});
  await wait(60);
  let mid=null;
  for(let i=1;i<=steps;i+=1){
    const x=from.x+(to.x-from.x)*i/steps, y=from.y+(to.y-from.y)*i/steps;
    await send('Input.dispatchMouseEvent',{type:'mouseMoved',x,y,button:'left',buttons:1});
    if(i===Math.ceil(steps/2)){mid=await ev(`document.body.classList.contains('is-dragging')`)}
    await wait(25);
  }
  await send('Input.dispatchMouseEvent',{type:'mouseReleased',x:to.x,y:to.y,button:'left',buttons:0,clickCount:1});
  return mid;
};

await send('Storage.clearDataForOrigin',{origin:ORIGIN,storageTypes:'all'});
await send('Network.setCacheDisabled',{cacheDisabled:true});
await send('Emulation.setDeviceMetricsOverride',{width:1280,height:900,deviceScaleFactor:1,mobile:false});
const inj=await send('Page.addScriptToEvaluateOnNewDocument',{source:MOCK});
await load(URL_);await wait(1500);

await ev(`(()=>{window.__mock.setRemote('tasks.json',[{id:'w1',kind:'work',title:'跟进供应商',created:'2026-09-16',due:'2026-09-16',done:false,notes:[],updatedAt:'2026-09-16T00:00:00.000Z'}]);
  localStorage.removeItem('ts_state_v2');localStorage.removeItem('ts_revs_v2');return 1})()`);
await load(URL_);await wait(1800);

const goTab=async(id_)=>{for(let i=0;i<8;i++){await ev(`(()=>{const t=document.querySelector('.tab[data-tab="${id_}"]');if(t)t.click();return 1})()`);await wait(300);
  if(await ev(`!!document.querySelector('.tab[data-tab="${id_}"].active')`)){await wait(250);return true}}return false};
ok('0 切到公司页', await goTab('work'));
const addNote=async text=>{await ev(`(()=>{const f=document.querySelector('.note-inline[data-id="w1"]');
  f.querySelector('input').value=${JSON.stringify(text)};
  f.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}));return 1})()`);await wait(700)};
const openTexts=()=>`[...document.querySelectorAll('.note-list[data-notes-for="w1"] .note-line .note-text')].map(e=>e.textContent)`;
await addNote('甲甲甲甲甲');await addNote('乙乙乙乙乙');await addNote('丙丙丙丙丙');
ok('1 三条进展就位', JSON.stringify(await ev(openTexts()))===JSON.stringify(['丙丙丙丙丙','乙乙乙乙乙','甲甲甲甲甲']), await ev(openTexts()));

/* --- 核心：从文字正中按下并拖动，检查是否拖出选区 / 触发原生拖拽 --- */
await ev(`window.__nativeDrags=0;window.__selectStarts=0;window.getSelection().removeAllRanges()`);
const geo=await ev(`(()=>{const ls=[...document.querySelectorAll('.note-list[data-notes-for="w1"] .note-line')];
  const t0=ls[0].querySelector('.note-text').getBoundingClientRect();
  const t2=ls[2].getBoundingClientRect();
  return {fx:t0.left+t0.width/2, fy:t0.top+t0.height/2, tx:t2.left+t2.width/2, ty:t2.bottom-2}})()`);
const midClass = await realDrag({x:geo.fx,y:geo.fy},{x:geo.tx,y:geo.ty});
await wait(1400);

const sel = await ev(`String(window.getSelection())`);
ok('2a 拖完没有残留选区（就是那个复制感）', sel==='', sel);
ok('2b 没有触发浏览器原生拖拽', (await ev(`window.__nativeDrags`))===0, await ev(`window.__nativeDrags`));
ok('2c 拖动中已挂上 is-dragging 锁', midClass===true, midClass);
ok('2d 松手后 is-dragging 已解除', (await ev(`document.body.classList.contains('is-dragging')`))===false);
ok('2e 顺序真的换了（丙 拖到底部）', JSON.stringify(await ev(openTexts()))===JSON.stringify(['乙乙乙乙乙','甲甲甲甲甲','丙丙丙丙丙']), await ev(openTexts()));
ok('2f 拖拽没误开编辑框', (await ev(`!document.querySelector('.note-edit')`))===true);
ok('2g 没多出重复条目', (await ev(`document.querySelectorAll('.note-list[data-notes-for="w1"] .note-line').length`))===3);
const cloudNotes = await ev(`(()=>{const f=window.__mock.files()['tasks.json'];
  const it=Array.isArray(f)?f[0]:(f&&f.tasks&&f.tasks[0]);
  if(!it||!Array.isArray(it.notes))return 'NO_NOTES:'+JSON.stringify(f).slice(0,160);
  return it.notes.slice().sort((x,y)=>(y.seq||0)-(x.seq||0)).map(x=>x.text).join('|')})()`);
ok('2h 新顺序已进云端', cloudNotes==='乙乙乙乙乙|甲甲甲甲甲|丙丙丙丙丙', cloudNotes);
ok('2i 拖拽期间无 JS 报错', errors.length===0, errors.slice(0,2));

/* --- 拖完还能正常点开编辑，且输入框内文字仍可选中 --- */
await ev(`document.querySelector('.note-list[data-notes-for="w1"] .note-line .note-text').click()`);
await wait(350);
ok('3a 点文字仍能就地编辑', (await ev(`!!document.querySelector('.note-edit')`))===true);
ok('3b 编辑框里文字仍可选中', (await ev(`(()=>{const i=document.querySelector('.note-edit');
  i.focus();i.setSelectionRange(0,i.value.length);return getComputedStyle(i).userSelect})()`))==='text');
await ev(`(()=>{const i=document.querySelector('.note-edit');i.value='乙乙乙（改）';
  i.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true}));return 1})()`);
await wait(900);
ok('3c 编辑内容已保存', JSON.stringify(await ev(openTexts()))===JSON.stringify(['乙乙乙（改）','甲甲甲甲甲','丙丙丙丙丙']), await ev(openTexts()));

/* --- 拖拽过程中也不会选中页面其它文字 --- */
await ev(`window.getSelection().removeAllRanges()`);
const g2=await ev(`(()=>{const ls=[...document.querySelectorAll('.note-list[data-notes-for="w1"] .note-line')];
  const a=ls[2].getBoundingClientRect(), b=ls[0].getBoundingClientRect();
  return {fx:a.left+a.width/2, fy:a.top+a.height/2, tx:b.left+b.width/2, ty:b.top+2}})()`);
await realDrag({x:g2.fx,y:g2.fy},{x:g2.tx,y:g2.ty});
await wait(1300);
ok('4a 反向拖回也无残留选区', (await ev(`String(window.getSelection())`))==='', await ev(`String(window.getSelection())`));
ok('4b 反向拖回顺序正确（丙 拖回最上）', JSON.stringify(await ev(openTexts()))===JSON.stringify(['丙丙丙丙丙','乙乙乙（改）','甲甲甲甲甲']), await ev(openTexts()));

/* --- 计划 / 习惯卡片同样拖不出选区 --- */
ok('5 切到习惯页', await goTab('keep'));
await ev(`(()=>{const i=document.querySelector('#k-title');if(!i)return 0;i.value='早睡';
  document.querySelector('#keep-form')&&document.querySelector('#keep-form').dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}));return 1})()`);
await wait(900);
const cardCount = await ev(`document.querySelectorAll('#keep-board .item-card, #keep-board .task').length`);
if(cardCount>=1){
  await ev(`window.getSelection().removeAllRanges();window.__nativeDrags=0`);
  const g3=await ev(`(()=>{const c=document.querySelector('#keep-board .item-card, #keep-board .task').getBoundingClientRect();
    return {fx:c.left+c.width/2, fy:c.top+c.height/2, tx:c.left+c.width/2, ty:c.top+c.height/2+40}})()`);
  await realDrag({x:g3.fx,y:g3.fy},{x:g3.tx,y:g3.ty});
  await wait(900);
  ok('5a 习惯卡片拖完无残留选区', (await ev(`String(window.getSelection())`))==='', await ev(`String(window.getSelection())`));
  ok('5b 习惯卡片无原生拖拽', (await ev(`window.__nativeDrags`))===0);
} else { ok('5a 习惯卡片拖完无残留选区', false, '没找到卡片'); ok('5b 习惯卡片无原生拖拽', false, '没找到卡片'); }

ok('9 全程无 JS 报错', errors.length===0, errors.slice(0,3));
await dump();
process.exit(R.every(r=>r.pass)?0:1);
