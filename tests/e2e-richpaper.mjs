/* 文本白纸 V46：图片粘贴、表格行列选择/表后删除、可编辑流程图与三端保存 */
const CDP='http://127.0.0.1:9334', ORIGIN='http://127.0.0.1:8123', URL_=ORIGIN+'/index.html?paper='+Date.now();
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

const goMemo=async()=>{await ev(`document.querySelector('.tab[data-tab="memo"]').click()`);await wait(500)};
const cleanEditor=async text=>{
  await ev(`(()=>{const ed=document.querySelector('#memo-text');ed.focus();
    ed.innerHTML='<div>'+${JSON.stringify(text)}+'</div>';
    ed.dispatchEvent(new Event('input',{bubbles:true}));
    const d=ed.firstChild;const r=document.createRange();r.selectNodeContents(d);r.collapse(false);
    const s=getSelection();s.removeAllRanges();s.addRange(r);return 1})()`);
  await wait(200);
};
const remoteMemo=()=>ev(`(()=>{const t=(window.__mock.files()['tasks.json']||[]).find(x=>x.kind==='memo');return t||null})()`);

await goMemo();
ok('1a 工具栏有流程图入口', await ev(`!!document.querySelector('[data-memo-cmd="flow"]')`));

await cleanEditor('表格尺寸测试');
await ev(`document.querySelector('[data-memo-cmd="table"]').click()`);await wait(180);
ok('2a 表格按钮打开网格选择器', await ev(`!!document.querySelector('.table-picker .table-picker-cell')`));
await ev(`(()=>{const c=document.querySelector('.table-picker-cell[data-row="2"][data-col="4"]');
  c.dispatchEvent(new PointerEvent('pointerover',{bubbles:true}));return document.querySelector('.table-picker-size').textContent})()`);
ok('2b 悬停实时显示 2 × 4', (await ev(`document.querySelector('.table-picker-size').textContent`))==='2 × 4');
await ev(`document.querySelector('.table-picker-cell[data-row="2"][data-col="4"]').click()`);await wait(300);
const tableState=await ev(`(()=>{const t=document.querySelector('#memo-text table');
  return {rows:t&&t.rows.length,cols:t&&t.rows[0].cells.length,spacer:t&&t.nextElementSibling&&t.nextElementSibling.tagName}})()`);
ok('2c 选中 2 × 4 后自动画出对应格数', tableState.rows===2&&tableState.cols===4, tableState);
ok('2d 表格后有可落光标的空行', tableState.spacer==='DIV', tableState);

await ev(`(()=>{const ed=document.querySelector('#memo-text');const table=ed.querySelector('table');
  const line=table.nextElementSibling;const r=document.createRange();r.setStart(line,0);r.collapse(true);
  const s=getSelection();s.removeAllRanges();s.addRange(r);
  line.dispatchEvent(new KeyboardEvent('keydown',{key:'Backspace',bubbles:true,cancelable:true}));
  return !ed.querySelector('table')})()`);
ok('2e 光标在表后空行按退格可直接删表', await ev(`!document.querySelector('#memo-text table')`));

await cleanEditor('图片粘贴测试');
const png='iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAFElEQVR42mP8z8AARMAgYKSgAQAGgQH/7xZ0WQAAAABJRU5ErkJggg==';
await ev(`(()=>{const ed=document.querySelector('#memo-text');
  const bin=atob('${png}');const bytes=new Uint8Array(bin.length);
  for(let i=0;i<bin.length;i++)bytes[i]=bin.charCodeAt(i);
  const file=new File([bytes],'paste.png',{type:'image/png'});
  const dt=new DataTransfer();dt.items.add(file);
  const e=new ClipboardEvent('paste',{clipboardData:dt,bubbles:true,cancelable:true});
  ed.dispatchEvent(e);return 1})()`);
await wait(1100);
const img=await ev(`(()=>{const x=document.querySelector('#memo-text img');
  return x?{src:x.getAttribute('src').slice(0,30),alt:x.alt,w:x.naturalWidth,h:x.naturalHeight}:null})()`);
ok('3a 粘贴图片后直接插入编辑区', !!img&&/^data:image\//.test(img.src), img);
await wait(1400);
const savedImg=await remoteMemo();
ok('3b 图片写进 memoHtml 并参与同步', !!savedImg&&/<img[^>]+src="data:image\//i.test(savedImg.memoHtml||''), savedImg&&savedImg.memoHtml.slice(0,120));

await cleanEditor('流程图测试');
await ev(`document.querySelector('[data-memo-cmd="flow"]').click()`);await wait(250);
ok('4a 点流程图入口打开画框', await ev(`!document.querySelector('#flow-backdrop').classList.contains('hidden')`));
await ev(`document.querySelector('[data-flow-add]').click()`);await wait(120);
ok('4b 新建椭圆后自动聚焦输入框', await ev(`document.activeElement&&document.activeElement.classList.contains('flow-node-input')`));
await ev(`(()=>{const i=document.activeElement;i.value='开始';i.dispatchEvent(new Event('input',{bubbles:true}));return 1})()`);
await ev(`document.querySelector('[data-flow-add]').click()`);await wait(120);
await ev(`(()=>{const inputs=[...document.querySelectorAll('.flow-node-input')];
  inputs[1].value='下一步';inputs[1].dispatchEvent(new Event('input',{bubbles:true}));
  inputs[0].focus();inputs[0].select();return 1})()`);

await ev(`(()=>{const nodes=[...document.querySelectorAll('.flow-node')];const port=nodes[0].querySelector('.flow-port');
  const a=port.getBoundingClientRect(),b=nodes[1].getBoundingClientRect();
  const x1=a.left+a.width/2,y1=a.top+a.height/2,x2=b.left+b.width/2,y2=b.top+b.height/2;
  const base={bubbles:true,cancelable:true,pointerId:7,pointerType:'mouse',button:0};
  port.dispatchEvent(new PointerEvent('pointerdown',Object.assign({},base,{buttons:1,clientX:x1,clientY:y1})));
  window.dispatchEvent(new PointerEvent('pointermove',Object.assign({},base,{buttons:1,clientX:x2,clientY:y2})));
  window.dispatchEvent(new PointerEvent('pointerup',Object.assign({},base,{buttons:0,clientX:x2,clientY:y2})));
  return 1})()`);await wait(200);
ok('4c 从椭圆边缘拖到另一个椭圆生成箭头', (await ev(`document.querySelectorAll('#flow-edge-layer path').length`))===1);

await ev(`document.querySelector('#flow-save').click()`);await wait(400);
ok('4d 保存后画框关闭并插入白纸', await ev(`document.querySelector('#flow-backdrop').classList.contains('hidden')&&!!document.querySelector('#memo-text [data-flow]')`));
const flowDom=await ev(`(()=>{const f=document.querySelector('#memo-text [data-flow]');
  return {nodes:f&&f.querySelectorAll('.flow-render-node').length,edges:f&&f.querySelectorAll('.flow-render-edge').length}})()`);
ok('4e 白纸内展示两个椭圆和一条箭头', flowDom.nodes===2&&flowDom.edges===1, flowDom);
await wait(1400);
const savedFlow=await remoteMemo();
ok('4f 流程图 JSON 写进 memoHtml 同步', !!savedFlow&&/data-flow=/i.test(savedFlow.memoHtml||''), savedFlow&&savedFlow.memoHtml.slice(0,160));

await load(URL_);await wait(1800);await goMemo();
ok('5a 刷新后流程图仍在并能重绘', (await ev(`document.querySelectorAll('#memo-text [data-flow] .flow-render-node').length`))===2);
await ev(`document.querySelector('#memo-text [data-flow]').click()`);await wait(250);
ok('5b 点内嵌流程图可重新打开编辑', await ev(`!document.querySelector('#flow-backdrop').classList.contains('hidden')&&document.querySelectorAll('#flow-node-layer .flow-node').length===2`));
await ev(`document.querySelector('[data-flow-close]').click()`);await wait(150);
ok('5c 关闭画框不丢白纸内容', await ev(`!!document.querySelector('#memo-text [data-flow]')`));
ok('6 全程无 JS 报错', errors.length===0, errors.slice(0,3));

await dump();
process.exit(R.every(r=>r.pass)?0:1);
