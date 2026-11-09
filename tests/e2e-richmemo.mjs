/* 琐事 / 创意富文本：加粗、标题、字号、高亮、字色、表格；保存后刷新仍在，倒计时不被格式破坏 */
const CDP='http://127.0.0.1:9334', ORIGIN='http://127.0.0.1:8123', URL_=ORIGIN+'/index.html?rich='+Date.now();
const l=await(await fetch(CDP+'/json/list')).json();
const t=l.find(x=>x.type==='page'&&!x.url.startsWith('devtools'));
const ws=new WebSocket(t.webSocketDebuggerUrl);let id=0;const p=new Map();
const send=(m,pa={})=>new Promise((r,j)=>{const i=++id;p.set(i,{r,j});ws.send(JSON.stringify({id:i,method:m,params:pa}))});
await new Promise(r=>ws.addEventListener('open',r));
const errors=[];
ws.addEventListener('message',e=>{const m=JSON.parse(e.data);
  if(m.method==='Runtime.exceptionThrown')errors.push(String(m.params.exceptionDetails.exception?.description||m.params.exceptionDetails.text||'').slice(0,300));
  if(m.id&&p.has(m.id)){const q=p.get(m.id);p.delete(m.id);m.error?q.j(new Error(JSON.stringify(m.error))):q.r(m.result)}});
await send('Page.enable');await send('Runtime.enable');await send('Network.enable');
const ev=async x=>{const r=await send('Runtime.evaluate',{expression:x,awaitPromise:true,returnByValue:true});
  if(r.exceptionDetails)throw new Error(String(r.exceptionDetails.exception?.description||r.exceptionDetails).slice(0,500));return r.result.value};
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
  localStorage.setItem('ts_token_v1','fake-token');
})();`;

await send('Storage.clearDataForOrigin',{origin:ORIGIN,storageTypes:'all'});
await send('Network.setCacheDisabled',{cacheDisabled:true});
await send('Emulation.setDeviceMetricsOverride',{width:1280,height:900,deviceScaleFactor:1,mobile:false});
await send('Page.addScriptToEvaluateOnNewDocument',{source:MOCK});
await load(URL_);await wait(1800);
errors.length = 0;   // 丢掉切到本页之前，旧页面残留的网络错误

const goMemo=async()=>{await ev(`document.querySelector('.tab[data-tab="memo"]').click()`);await wait(450)};
const setMemo=async text=>{
  const html=String(text).split('\n').map(line=>line
    ? '<div>'+line.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')+'</div>'
    : '<div><br></div>').join('');
  await ev(`(()=>{const ed=document.querySelector('#memo-text');ed.focus();ed.innerHTML=${JSON.stringify(html)};
    ed.dispatchEvent(new Event('input',{bubbles:true}));return 1})()`);
  await wait(300);
};
const selectLine=async (line, start, end)=>{
  await ev(`(()=>{const ed=document.querySelector('#memo-text');const el=ed.children[${line}];
    const w=document.createTreeWalker(el,NodeFilter.SHOW_TEXT);let node=w.nextNode();
    if(!node)node=el.appendChild(document.createTextNode(''));
    const r=document.createRange();r.setStart(node,${start==null?0:start});
    r.setEnd(node,${end==null?'node.nodeValue.length':end});
    const s=getSelection();s.removeAllRanges();s.addRange(r);return 1})()`);
};
const caretEndOfText=async text=>{
  await ev(`(()=>{const ed=document.querySelector('#memo-text');
    const w=document.createTreeWalker(ed,NodeFilter.SHOW_TEXT);let n=null,node=null;
    while((n=w.nextNode())){if(n.nodeValue.includes(${JSON.stringify(text)})){node=n;break}}
    if(!node)return 0;const at=node.nodeValue.indexOf(${JSON.stringify(text)})+${JSON.stringify(text)}.length;
    const r=document.createRange();r.setStart(node,at);r.collapse(true);
    const s=getSelection();s.removeAllRanges();s.addRange(r);return 1})()`);
};
const remoteMemo=()=>ev(`(()=>{const t=(window.__mock.files()['tasks.json']||[]).find(x=>x.kind==='memo');return t||null})()`);

await goMemo();
ok('1a 琐事页有富文本编辑区', await ev(`!!document.querySelector('#memo-text[contenteditable="true"]')`));
ok('1b 顶部有加粗按钮', await ev(`!!document.querySelector('[data-memo-cmd="bold"]')`));
ok('1c 有正文/标题/小标题选择', (await ev(`[...document.querySelectorAll('[data-memo-select="block"] option')].map(x=>x.textContent)`)).join('|')==='段落|正文|标题|小标题');
ok('1d 有字号、高亮、字色、表格', await ev(`!!document.querySelector('[data-memo-select="size"]')&&!!document.querySelector('[data-memo-select="highlight"]')&&!!document.querySelector('[data-memo-select="color"]')&&!!document.querySelector('[data-memo-cmd="table"]')`));

await setMemo('第一行标题\n第二行正文\n第三行正文');
await selectLine(0);
await ev(`document.querySelector('[data-memo-cmd="bold"]').click()`);
await wait(150);
await ev(`(()=>{const s=document.querySelector('[data-memo-select="block"]');s.value='h2';s.dispatchEvent(new Event('change',{bubbles:true}));return 1})()`);
await wait(200);

await selectLine(1);
await ev(`(()=>{const s=document.querySelector('[data-memo-select="highlight"]');s.value='#fef08a';s.dispatchEvent(new Event('change',{bubbles:true}));return 1})()`);
await wait(150);
await selectLine(1);
await ev(`(()=>{const s=document.querySelector('[data-memo-select="color"]');s.value='#dc2626';s.dispatchEvent(new Event('change',{bubbles:true}));return 1})()`);
await wait(150);
await selectLine(2);
await ev(`(()=>{const s=document.querySelector('[data-memo-select="size"]');s.value='5';s.dispatchEvent(new Event('change',{bubbles:true}));return 1})()`);
await wait(200);

await caretEndOfText('第三行正文');
await ev(`document.querySelector('[data-memo-cmd="table"]').click()`);
await wait(1300);

ok('2a 标题变成 h2', await ev(`!!document.querySelector('#memo-text h2')`));
ok('2b 加粗生效', await ev(`(()=>{const h=document.querySelector('#memo-text h2');const sp=h&&h.querySelector('span');
  return !!sp&&/bold|[6-9]00/.test(sp.style.fontWeight||'')})()`),
  await ev(`document.querySelector('#memo-text h2')&&document.querySelector('#memo-text h2').innerHTML`));
ok('2c 高亮生效', await ev(`(()=>{const s=[...document.querySelectorAll('#memo-text span')].find(x=>x.textContent.includes('第二行正文'));return !!s&&/254,\\s*240,\\s*138/.test(s.style.backgroundColor)})()`),
  await ev(`[...document.querySelectorAll('#memo-text span')].map(x=>x.getAttribute('style'))`));
ok('2d 字色生效', await ev(`(()=>{const s=[...document.querySelectorAll('#memo-text span')].find(x=>x.textContent.includes('第二行正文'));return !!s&&/220,\\s*38,\\s*38/.test(s.style.color)})()`));
ok('2e 字号生效', await ev(`(()=>{const ed=document.querySelector('#memo-text');return !!ed.querySelector('font[size="5"]')||/font-size:\\s*18px/.test(ed.innerHTML)})()`),
  await ev(`document.querySelector('#memo-text').innerHTML`));
ok('2f 表格插在标题外、单独成块', await ev(`!!document.querySelector('#memo-text table')&&!document.querySelector('#memo-text h2 table')`));

const saved=await remoteMemo();
ok('3a 格式写进 memoHtml', !!saved&&/<h2/.test(saved.memoHtml)&&/<table/.test(saved.memoHtml), saved&&saved.memoHtml);
ok('3b 纯文本 memo 仍保留给倒计时', !!saved&&saved.memo.split('\n')[0]==='第一行标题'&&saved.memo.includes('第三行正文'), saved&&saved.memo);
ok('3c 表格文字也进了纯文本摘要', !!saved&&saved.memo.includes('列 1 | 列 2 | 列 3'), saved&&saved.memo);

await load(URL_);await wait(1800);
await goMemo();
ok('4a 刷新后标题还在', await ev(`!!document.querySelector('#memo-text h2')`));
ok('4b 刷新后表格还在', await ev(`!!document.querySelector('#memo-text table')`));
ok('4c 刷新后高亮和字色还在', await ev(`(()=>{const s=[...document.querySelectorAll('#memo-text span')].find(x=>x.textContent.includes('第二行正文'));return !!s&&s.style.backgroundColor&&s.style.color})()`));
await wait(1200);

const d=await ev(`Core.todayStr()`);
await caretEndOfText('第二行正文');
await ev(`(()=>{document.querySelector('#memo-timer-date').value=${JSON.stringify(d)};document.querySelector('#memo-timer-add').click();return 1})()`);
await wait(1400);
const afterTimer=await remoteMemo();
ok('5a 富文本正文仍能加倒计时', !!afterTimer&&afterTimer.memo.includes('第二行正文 ⏰'+d), afterTimer&&afterTimer.memo);
ok('5b 加倒计时后标题格式没丢', !!afterTimer&&/<h2/.test(afterTimer.memoHtml), afterTimer&&afterTimer.memoHtml);
ok('5c 加倒计时后表格没丢', !!afterTimer&&/<table/.test(afterTimer.memoHtml), afterTimer&&afterTimer.memoHtml);
ok('5d 倒计时板正常出现', await ev(`document.querySelectorAll('#memo-timers .timer-row').length`)===1);

/* 远端 HTML 不可信：只保留白名单标签/样式，脚本、事件和图片一律清掉 */
await ev(`(()=>{const now=new Date().toISOString();window.__mock.setRemote('tasks.json',[{
  id:'memo_evil',kind:'memo',title:'琐事',created:Core.todayStr(),updatedAt:now,memo:'安全正文\\n红字',
  memoHtml:'<h2 onclick="window.__x=1">安全正文</h2><script>window.__x=2</script><img src=x onerror="window.__x=3"><span style="color:red;position:fixed">红字</span>'
}]);return 1})()`);
await load(URL_);await wait(1800);
await goMemo();
ok('5e 远端脚本标签被清掉', (await ev(`document.querySelectorAll('#memo-text script').length`))===0);
ok('5f 远端图片和事件属性被清掉', (await ev(`document.querySelectorAll('#memo-text img,#memo-text [onclick],#memo-text [onerror]').length`))===0);
ok('5g 危险样式被过滤、正常字色保留', await ev(`(()=>{const s=[...document.querySelectorAll('#memo-text span')].find(x=>x.textContent.includes('红字'));
  return !!s&&s.style.color==='red'&&!s.style.position})()`));
ok('5h 恶意代码没有执行', (await ev(`typeof window.__x`))==='undefined');
ok('6 全程无 JS 报错', errors.length===0, errors.slice(0,2));

await dump();
process.exit(R.every(r=>r.pass)?0:1);
