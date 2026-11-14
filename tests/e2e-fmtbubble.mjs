/* 选区左侧快捷格式菜单：定位、大中小 B、反复切换稳定性、颜色高亮保留 */
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

const selectAllEditor=`(()=>{const ed=document.querySelector('#memo-text');
  const range=document.createRange();range.selectNodeContents(ed);
  const sel=getSelection();sel.removeAllRanges();sel.addRange(range);
  document.dispatchEvent(new Event('selectionchange'));return 1})()`;
const clickPreset=async(k)=>{await ev(`document.querySelector('[data-fmt-preset="${k}"]').click()`);await wait(120);};
const fmtState=()=>ev(`(()=>{const ed=document.querySelector('#memo-text');
  const block=ed.firstElementChild;const target=block?(block.querySelector('span,b,strong')||block):null;
  const cs=target?getComputedStyle(target):null;
  return {tag:block?block.tagName:null,weight:cs?cs.fontWeight:null,size:cs?cs.fontSize:null,
    fonts:ed.querySelectorAll('font[size]').length,bolds:ed.querySelectorAll('b,strong').length,
    html:ed.innerHTML,selected:!getSelection().isCollapsed}})()`);

await goTab('memo');
await ev(`(()=>{const ed=document.querySelector('#memo-text');
  ed.innerHTML='<p>同一段文字反复切换</p>';ed.dispatchEvent(new Event('input',{bubbles:true}));return 1})()`);
await wait(900);
await ev(selectAllEditor);await wait(250);

const bubble=await ev(`(()=>{const b=document.querySelector('#fmt-bubble');const r=b.getBoundingClientRect();
  const tr=document.querySelector('#memo-text p').getBoundingClientRect();
  return {shown:!b.classList.contains('hidden'),left:Math.round(r.left),top:Math.round(r.top),
    textLeft:Math.round(tr.left),options:b.querySelectorAll('[data-fmt-preset]').length,
    hiddenAria:b.getAttribute('aria-hidden')}})()`);
ok('1a 选中文字后出现圆形快捷按钮', bubble.shown && bubble.options===4, bubble);
ok('1b 按钮在选区左侧', bubble.left < bubble.textLeft, bubble);
ok('1c 按钮没有跑出屏幕', bubble.left>=0&&bubble.top>=0, bubble);
ok('1d 菜单含大中小 B 四项', bubble.options===4, bubble);

await ev(`document.querySelector('.fmt-trigger').click()`);await wait(100);
ok('1e 点圆钮可展开竖排菜单', await ev(`document.querySelector('#fmt-bubble').classList.contains('is-open')`));
ok('1f 四项是竖排', await ev(`getComputedStyle(document.querySelector('.fmt-options')).flexDirection==='column'`));

await clickPreset('large');
let s=await fmtState();
ok('2a 大 = 标题块', s.tag==='H2', s);
ok('2b 大 = 标题字号且加粗', Number.parseFloat(s.size)>=20&&(s.weight==='700'||s.weight==='bold'), s);

await clickPreset('medium');
s=await fmtState();
ok('2c 中 = 小标题块', s.tag==='H3', s);
ok('2d 中 = 小标题字号且加粗', Number.parseFloat(s.size)>=16&&Number.parseInt(s.weight,10)>=600, s);

await clickPreset('small');
s=await fmtState();
ok('2e 小 = 普通段落', s.tag==='P', s);
ok('2f 小 = 默认字号且不加粗', s.weight==='400'||s.weight==='normal', s);
const smallSize=s.size;

await clickPreset('bold');
s=await fmtState();
ok('2g B 只加粗不改字号', s.tag==='P'&&s.size===smallSize&&Number.parseInt(s.weight,10)>=600, s);
ok('2h B 不会留下多余字号标签', s.fonts===0, s);

for(let i=0;i<6;i++){
  await clickPreset('large');
  await clickPreset('medium');
  await clickPreset('small');
  await clickPreset('bold');
}
s=await fmtState();
ok('3a 反复切换 24 次后仍是普通段落', s.tag==='P', s);
ok('3b 反复切换后没有 font[size] 嵌套', s.fonts===0, s);
ok('3c 反复切换后没有重复 b/strong 标签', s.bolds===0, s);
ok('3d 反复切换后字号仍是默认', s.size===smallSize, s);
ok('3e 反复切换后仍保持加粗', Number.parseInt(s.weight,10)>=600, s);
ok('3f 反复切换时选区没有丢', s.selected===true, s);

await ev(`(()=>{const ed=document.querySelector('#memo-text');
  ed.innerHTML='<p><span style="color:#dc2626;background-color:#fef08a">彩色高亮文字</span></p>';
  ed.dispatchEvent(new Event('input',{bubbles:true}));
  const range=document.createRange();range.selectNodeContents(ed.firstElementChild);
  const sel=getSelection();sel.removeAllRanges();sel.addRange(range);
  document.dispatchEvent(new Event('selectionchange'));return 1})()`);
await wait(250);
await clickPreset('large');
let colorful=await ev(`(()=>{const sp=document.querySelector('#memo-text h2 span');return sp?{style:sp.getAttribute('style'),weight:getComputedStyle(sp).fontWeight}:null})()`);
ok('4a 大不改掉原有文字颜色', !!colorful&&/color:\s*#?dc2626/i.test(colorful.style), colorful);
ok('4b 大不改掉原有高亮', !!colorful&&/background-color:\s*#?fef08a/i.test(colorful.style), colorful);
await clickPreset('small');
colorful=await ev(`(()=>{const sp=document.querySelector('#memo-text p span');return sp?{style:sp.getAttribute('style'),weight:getComputedStyle(sp).fontWeight,color:getComputedStyle(sp).color,bg:getComputedStyle(sp).backgroundColor}:null})()`);
ok('4c 小仍然保留颜色和高亮', !!colorful&&colorful.color!=='rgb(15, 23, 42)'&&colorful.bg!=='rgba(0, 0, 0, 0)', colorful);
ok('4d 小把这段恢复为不加粗', !!colorful&&(colorful.weight==='400'||colorful.weight==='normal'), colorful);

await ev(`(()=>{const ed=document.querySelector('#memo-text');
  ed.innerHTML='<p>最后切到大标题</p>';ed.dispatchEvent(new Event('input',{bubbles:true}));
  const range=document.createRange();range.selectNodeContents(ed.firstElementChild);
  const sel=getSelection();sel.removeAllRanges();sel.addRange(range);
  document.dispatchEvent(new Event('selectionchange'));return 1})()`);
await wait(200);await clickPreset('large');await wait(1100);
const saved=await ev(`(()=>{const m=(window.__mock.files()['tasks.json']||[]).find(x=>x.kind==='memo');return m?{memo:m.memo,html:m.memoHtml}:null})()`);
ok('5a 快捷格式会触发自动保存', !!saved&&saved.memo==='最后切到大标题', saved);
ok('5b 保存的是 H2 富文本', !!saved&&/<h2/i.test(saved.html), saved);

await load(URL_);await wait(1800);await goTab('memo');await wait(400);
ok('5c 刷新后格式还在', await ev(`document.querySelector('#memo-text h2') && document.querySelector('#memo-text h2').textContent==='最后切到大标题'`));

await goTab('month');await wait(400);
await ev(`(()=>{const ed=document.querySelector('#monthnote-editor');
  ed.innerHTML='<p>周报底稿也能快捷排版</p>';ed.dispatchEvent(new Event('input',{bubbles:true}));
  const range=document.createRange();range.selectNodeContents(ed.firstElementChild);
  const sel=getSelection();sel.removeAllRanges();sel.addRange(range);
  document.dispatchEvent(new Event('selectionchange'));return 1})()`);
await wait(250);
ok('6a 排期底稿也出现快捷按钮', await ev(`!document.querySelector('#fmt-bubble').classList.contains('hidden')`));
await clickPreset('medium');
ok('6b 排期底稿也能设为小标题', await ev(`!!document.querySelector('#monthnote-editor h3')`));

await ev(`document.querySelector('[data-action="report-new"]').click()`);await wait(250);
await ev(`(()=>{const i=document.querySelector('#report-name');i.value='格式菜单测试周报';
  document.querySelector('#report-new-form').requestSubmit();return 1})()`);
await wait(800);
await ev(`(()=>{const ed=document.querySelector('#report-editor');
  ed.innerHTML='<p>周报正文也能快捷排版</p>';ed.dispatchEvent(new Event('input',{bubbles:true}));
  const range=document.createRange();range.selectNodeContents(ed.firstElementChild);
  const sel=getSelection();sel.removeAllRanges();sel.addRange(range);
  document.dispatchEvent(new Event('selectionchange'));return 1})()`);
await wait(250);
ok('6c 周报正文也出现快捷按钮', await ev(`!document.querySelector('#fmt-bubble').classList.contains('hidden')`));
await clickPreset('large');
ok('6d 周报正文也能设为标题', await ev(`!!document.querySelector('#report-editor h2')`));

await send('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:2,mobile:true});
await wait(400);
await ev(selectAllEditor).catch(()=>{});
const mobileBubble=await ev(`(()=>{const b=document.querySelector('#fmt-bubble');if(b.classList.contains('hidden'))return {hidden:true};
  const r=b.getBoundingClientRect();return {hidden:false,left:r.left,right:r.right,w:innerWidth}})()`);
ok('7a 手机宽度下快捷按钮不跑出屏幕', mobileBubble.hidden||(mobileBubble.left>=0&&mobileBubble.right<=mobileBubble.w), mobileBubble);

await send('Emulation.setDeviceMetricsOverride',{width:1280,height:900,deviceScaleFactor:1,mobile:false});
ok('8 全程无 JS 报错', errors.length===0, errors.slice(0,3));

await dump();
process.exit(R.every(r=>r.pass)?0:1);
