/* 跳过多个日期后，最早一页仍要逐日补滚到今天；顶部按钮必须存在。 */
const CDP = 'http://127.0.0.1:9334';
const ORIGIN = 'http://127.0.0.1:8123';
const URL_ = ORIGIN + '/index.html?catchup=' + Date.now();

const list = await (await fetch(CDP + '/json/list')).json();
const target = list.find((x) => x.type === 'page' && x.url.startsWith(ORIGIN)) ||
  list.find((x) => x.type === 'page' && !x.url.startsWith('devtools'));
const ws = new WebSocket(target.webSocketDebuggerUrl);
let id = 0;
const pending = new Map();
const send = (method, params = {}) => new Promise((resolve, reject) => {
  const i = ++id;
  pending.set(i, { resolve, reject });
  ws.send(JSON.stringify({ id: i, method, params }));
});
await new Promise((resolve) => ws.addEventListener('open', resolve));
ws.addEventListener('message', (event) => {
  const msg = JSON.parse(event.data);
  if (msg.id && pending.has(msg.id)) {
    const p = pending.get(msg.id);
    pending.delete(msg.id);
    msg.error ? p.reject(new Error(JSON.stringify(msg.error))) : p.resolve(msg.result);
  }
});
await send('Page.enable');
await send('Runtime.enable');
await send('Page.bringToFront');
const ev = async (expression) => {
  const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  if (r.exceptionDetails) throw new Error(String(r.exceptionDetails.exception?.description || r.exceptionDetails).slice(0, 500));
  return r.result.value;
};
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const load = (url) => new Promise((resolve) => {
  const handler = (event) => {
    const msg = JSON.parse(event.data);
    if (msg.method === 'Page.loadEventFired') {
      ws.removeEventListener('message', handler);
      resolve();
    }
  };
  ws.addEventListener('message', handler);
  send('Page.navigate', { url });
});
const MOCK = `(() => {
  const KEY='__mock_catchup';
  const b64=s=>btoa(unescape(encodeURIComponent(s)));
  const ub64=s=>decodeURIComponent(escape(atob(s)));
  const seed=()=>({files:{'tasks.json':[],'checkins.json':[],'settings.json':{devices:{}}},sha:{},puts:0});
  const read=()=>{try{return JSON.parse(localStorage.getItem(KEY))||seed()}catch(e){return seed()}};
  const save=st=>localStorage.setItem(KEY,JSON.stringify(st));
  window.__mock={files:()=>read().files,setRemote:v=>{const st=read();st.files['tasks.json']=v;save(st)}};
  window.fetch=async(url,opts={})=>{
    const f=String(url).split('/').pop().split('?')[0], m=((opts&&opts.method)||'GET').toUpperCase(), st=read();
    if(m==='GET'){save(st);return{ok:true,status:200,headers:{get:()=>null},json:async()=>({content:b64(JSON.stringify(st.files[f]===undefined?[]:st.files[f])),sha:st.sha[f]||'s0'})}}
    const body=JSON.parse(opts.body);st.files[f]=JSON.parse(ub64(body.content));st.puts++;st.sha[f]='s'+st.puts;save(st);
    return{ok:true,status:200,headers:{get:()=>null},json:async()=>({content:{sha:st.sha[f]}})};
  };
  localStorage.setItem('ts_token_v1','fake-token');
})();`;
await send('Storage.clearDataForOrigin', { origin: ORIGIN, storageTypes: 'all' });
await send('Network.setCacheDisabled', { cacheDisabled: true });
await send('Page.addScriptToEvaluateOnNewDocument', { source: MOCK });
await load(URL_);
await wait(700);
const dates = await ev(`(() => { const t=Core.todayStr(); return {t, p3:Core.shiftDate(t,-3), p2:Core.shiftDate(t,-2), p1:Core.shiftDate(t,-1)}; })()`);
const stamp = new Date().toISOString();
const section = (key, label, text) => '<div data-day-section="' + key + '"><div data-day-section-title="' + key + '"><span>' + label + '</span></div><div data-day-section-body="' + key + '"><div>' + text + '</div></div></div>';
const oldHtml = section('work', '工作', '三天前工作') + section('career', '事业', '三天前事业') + section('life', '生活', '三天前生活');
const remote = [
  { id: 'catch-old', kind: 'daypaper', title: '日程 ' + dates.p3, date: dates.p3, memo: '工作\n三天前工作\n事业\n三天前事业\n生活\n三天前生活', memoHtml: oldHtml, notes: [], updatedAt: stamp },
  { id: 'catch-p2', kind: 'daypaper', title: '日程 ' + dates.p2, date: dates.p2, memo: '工作\n\n事业\n\n生活', memoHtml: section('work','工作','<br>') + section('career','事业','<br>') + section('life','生活','<br>'), notes: [], updatedAt: '2026-01-01T00:00:00.000Z' },
  { id: 'catch-today', kind: 'daypaper', title: '日程 ' + dates.t, date: dates.t, memo: '工作\n\n事业\n今天原有\n生活', memoHtml: section('work','工作','<br>') + section('career','事业','今天原有') + section('life','生活','<br>'), notes: [], updatedAt: '2026-01-01T00:00:00.000Z' }
];
await ev(`window.__mock.setRemote(${JSON.stringify(remote)}); localStorage.removeItem('ts_state_v2'); localStorage.removeItem('ts_outbox_v2');`);
await load(URL_);
await wait(2200);
const result = await ev(`(() => {
  const a=window.__mock.files()['tasks.json']; const t=a.find(x=>x.id==='catch-today'); const p3=a.find(x=>x.id==='catch-old'); const p2=a.find(x=>x.id==='catch-p2');
  return {today:t?t.memo:'', p3:p3?p3.memo:'', p2:p2?p2.memo:'', button:!!document.getElementById('btn-rollover'), labels:t?(t.memo.match(/昨天剩下内容：/g)||[]).length:0};
})()`);
const ok = result.button && result.labels === 3 && /三天前工作/.test(result.today) &&
  /三天前事业/.test(result.today) && /三天前生活/.test(result.today) &&
  !String(result.p3).trim() && !String(result.p2).trim();
console.log((ok ? 'PASS' : 'FAIL') + ' 多日连续补迁移 ' + JSON.stringify(result));
process.exit(ok ? 0 : 1);
