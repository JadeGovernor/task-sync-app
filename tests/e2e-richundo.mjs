/* 文本白纸撤销/重做：文字、表格、流程图、图片、计划底稿 */
const CDP='http://127.0.0.1:9334', ORIGIN='http://127.0.0.1:8123', URL_=ORIGIN+'/index.html?undo='+Date.now();
const l=await(await fetch(CDP+'/json/list')).json();
const t=l.find(x=>x.type==='page'&&x.url.startsWith(ORIGIN))||l.find(x=>x.type==='page'&&!x.url.startsWith('devtools'));
const ws=new WebSocket(t.webSocketDebuggerUrl);let id=0;const p=new Map();
const send=(m,pa={})=>new Promise((r,j)=>{const i=++id;p.set(i,{r,j});ws.send(JSON.stringify({id:i,method:m,params:pa}))});
await new Promise(r=>ws.addEventListener('open',r));
const errors=[];
ws.addEventListener('message',e=>{const m=JSON.parse(e.data);
  if(m.method==='Runtime.exceptionThrown')errors.push(String(m.params.exceptionDetails.exception?.description||m.params.exceptionDetails.text||'').slice(0,300));
  if(m.id&&p.has(m.id)){const q=p.get(m.id);p.delete(m.id);m.error?q.j(new Error(JSON.stringify(m.error))):q.r(m.result)}});
await send('Page.enable');await send('Runtime.enable');await send('Network.enable');await send('Page.bringToFront');
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
  window.__mock={files:()=>read().files};
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
await load(URL_);await wait(1800);
errors.length=0;

const goTab=async(k)=>{for(let i=0;i<8;i++){await ev(`(()=>{const t=document.querySelector('.tab[data-tab="${k}"]');if(t)t.click();return 1})()`);await wait(250);
  if(await ev(`!!document.querySelector('.tab[data-tab="${k}"].active')`)){await wait(300);return true}}return false};
const setEditor=async(sel,text)=>{
  const html='<div>'+String(text).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')+'</div>';
  await ev(`(()=>{const ed=document.querySelector(${JSON.stringify(sel)});if(!ed)return false;
    ed.focus();ed.innerHTML=${JSON.stringify(html)};ed.dispatchEvent(new Event('input',{bubbles:true}));return true})()`);
  await wait(120);
};
const deleteLastChar=sel=>ev(`(()=>{const ed=document.querySelector(${JSON.stringify(sel)});if(!ed)return false;
  ed.focus();const w=document.createTreeWalker(ed,NodeFilter.SHOW_TEXT);let n=null,last=null;
  while((n=w.nextNode())){if(n.nodeValue)last=n}
  if(!last||!last.nodeValue.length)return false;
  ed.dispatchEvent(new InputEvent('beforeinput',{inputType:'deleteContentBackward',bubbles:true,cancelable:true}));
  last.deleteData(last.nodeValue.length-1,1);
  ed.dispatchEvent(new InputEvent('input',{inputType:'deleteContentBackward',bubbles:true}));
  return true})()`);
const key=async(sel,k,shift=false)=>{
  await ev(`(()=>{const el=${sel==='body'?'document.body':'document.querySelector('+JSON.stringify(sel)+')'};
    if(!el)return false;if(el.focus)el.focus();
    el.dispatchEvent(new KeyboardEvent('keydown',{key:${JSON.stringify(k)},code:'Key${k.toUpperCase()}',
      metaKey:true,shiftKey:${!!shift},bubbles:true,cancelable:true}));return true})()`);
  await wait(180);
};
const editorText=sel=>ev(`(document.querySelector(${JSON.stringify(sel)})||{}).textContent||''`);

await goTab('memo');
ok('1a 琐事白纸已就绪', await ev(`!!document.querySelector('#memo-text')`));

await setEditor('#memo-text','今天先写三件事');
await deleteLastChar('#memo-text');
ok('1b 模拟误删最后一个字', (await editorText('#memo-text'))==='今天先写三件', await editorText('#memo-text'));
await goTab('work');
await goTab('memo');
ok('1c 切换页面后误删内容仍保留', (await editorText('#memo-text'))==='今天先写三件', await editorText('#memo-text'));
await key('#memo-text','z');
ok('1d 切换页面后 ⌘Z 仍能恢复误删文字', (await editorText('#memo-text'))==='今天先写三件事', await editorText('#memo-text'));
await key('#memo-text','z',true);
ok('1e ⌘⇧Z 能重做删除', (await editorText('#memo-text'))==='今天先写三件', await editorText('#memo-text'));

await setEditor('#memo-text','表格撤销测试');
await ev(`document.querySelector('[data-memo-cmd="table"]').click()`);await wait(180);
await ev(`document.querySelector('.table-picker-cell[data-row="2"][data-col="2"]').click()`);await wait(320);
ok('2a 表格已插入', await ev(`!!document.querySelector('#memo-text table')`));
await ev(`(()=>{const ed=document.querySelector('#memo-text');const table=ed.querySelector('table');
  const line=table&&table.nextElementSibling;if(!line)return false;
  const r=document.createRange();r.setStart(line,0);r.collapse(true);
  const s=getSelection();s.removeAllRanges();s.addRange(r);
  line.dispatchEvent(new KeyboardEvent('keydown',{key:'Backspace',bubbles:true,cancelable:true}));
  return !ed.querySelector('table')})()`);
await wait(120);
ok('2b 表后空行退格会删除整张表', await ev(`!document.querySelector('#memo-text table')`));
await key('#memo-text','z');
ok('2c ⌘Z 恢复被删表格', await ev(`!!document.querySelector('#memo-text table')`));

await setEditor('#memo-text','流程图撤销测试');
await ev(`document.querySelector('[data-memo-cmd="flow"]').click()`);await wait(260);
await ev(`document.querySelector('[data-flow-add]').click()`);await wait(120);
await ev(`(()=>{const i=document.activeElement;i.value='撤销节点';i.dispatchEvent(new Event('input',{bubbles:true}));return 1})()`);
await ev(`document.querySelector('#flow-save').click()`);await wait(420);
ok('3a 流程图已保存到白纸', await ev(`!!document.querySelector('#memo-text [data-flow]')`));
await ev(`document.querySelector('#memo-text [data-flow-del]').click()`);await wait(180);
ok('3b 删除按钮会移除流程图', await ev(`!document.querySelector('#memo-text [data-flow]')`));
await key('body','z');
ok('3c 焦点离开编辑区后 ⌘Z 仍恢复流程图', await ev(`!!document.querySelector('#memo-text [data-flow]')`));

await setEditor('#memo-text','图片撤销测试');
const png='iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAFElEQVR42mP8z8AARMAgYKSgAQAGgQH/7xZ0WQAAAABJRU5ErkJggg==';
await ev(`(()=>{const ed=document.querySelector('#memo-text');const bin=atob('${png}');
  const bytes=new Uint8Array(bin.length);for(let i=0;i<bin.length;i++)bytes[i]=bin.charCodeAt(i);
  const file=new File([bytes],'undo.png',{type:'image/png'});const dt=new DataTransfer();dt.items.add(file);
  ed.dispatchEvent(new ClipboardEvent('paste',{clipboardData:dt,bubbles:true,cancelable:true}));return 1})()`);
await wait(1200);
ok('4a 图片已插入', await ev(`!!document.querySelector('#memo-text img')`));
await key('#memo-text','z');
ok('4b ⌘Z 撤销图片插入', await ev(`!document.querySelector('#memo-text img')`));
await key('#memo-text','z',true);
ok('4c ⌘⇧Z 恢复图片', await ev(`!!document.querySelector('#memo-text img')`));

await goTab('month');
ok('5a 计划底稿已就绪', await ev(`!!document.querySelector('#monthnote-editor')`));
await setEditor('#monthnote-editor','本月计划底稿');
await deleteLastChar('#monthnote-editor');
ok('5b 计划底稿文字已删除', (await editorText('#monthnote-editor'))==='本月计划底', await editorText('#monthnote-editor'));
await key('#monthnote-editor','z');
ok('5c 计划底稿也能 ⌘Z 恢复', (await editorText('#monthnote-editor'))==='本月计划底稿', await editorText('#monthnote-editor'));

ok('6 全程无 JS 报错', errors.length===0, errors.slice(0,3));

await dump();
process.exit(R.every(r=>r.pass)?0:1);
