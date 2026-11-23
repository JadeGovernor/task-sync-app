/* 旧设备的空白日程编辑器不能覆盖另一台设备已经写好的板块。 */
const CDP = 'http://127.0.0.1:9334';
const ORIGIN = 'http://127.0.0.1:8123';
const URL_ = ORIGIN + '/index.html?merge=' + Date.now();

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
  const KEY = '__mock_daypaper_merge';
  const b64 = (s) => btoa(unescape(encodeURIComponent(s)));
  const ub64 = (s) => decodeURIComponent(escape(atob(s)));
  const seed = () => ({ files: { 'tasks.json': [], 'checkins.json': [], 'settings.json': { devices: {} } }, sha: {}, puts: 0 });
  const read = () => { try { return JSON.parse(localStorage.getItem(KEY)) || seed(); } catch (e) { return seed(); } };
  const save = (st) => localStorage.setItem(KEY, JSON.stringify(st));
  window.__mock = { files: () => read().files, setRemote: (v) => { const st = read(); st.files['tasks.json'] = v; save(st); } };
  window.fetch = async (url, opts = {}) => {
    const f = String(url).split('/').pop().split('?')[0];
    const method = ((opts && opts.method) || 'GET').toUpperCase();
    const st = read();
    if (method === 'GET') {
      save(st);
      return { ok: true, status: 200, headers: { get: () => null }, json: async () => ({
        content: b64(JSON.stringify(st.files[f] === undefined ? [] : st.files[f])), sha: st.sha[f] || 's0'
      }) };
    }
    const body = JSON.parse(opts.body);
    st.files[f] = JSON.parse(ub64(body.content));
    st.puts += 1; st.sha[f] = 's' + st.puts; save(st);
    return { ok: true, status: 200, headers: { get: () => null }, json: async () => ({ content: { sha: st.sha[f] } }) };
  };
  localStorage.setItem('ts_token_v1', 'fake-token');
})();`;

await send('Storage.clearDataForOrigin', { origin: ORIGIN, storageTypes: 'all' });
await send('Network.setCacheDisabled', { cacheDisabled: true });
await send('Page.addScriptToEvaluateOnNewDocument', { source: MOCK });
await load(URL_);
await wait(600);
const date = await ev('Core.todayStr()');
const stamp = new Date().toISOString();
const careerHtml = '<div data-day-section="career"><div data-day-section-title="career"><span>事业</span></div>' +
  '<div data-day-section-body="career"><div>云端已经写好事业内容</div></div></div>';
const remote = [{
  id: 'merge-day', kind: 'daypaper', title: '日程 ' + date, date,
  memo: '工作\n\n事业\n云端已经写好事业内容\n生活',
  memoHtml: '<div data-day-section="work"><div data-day-section-title="work"><span>工作</span></div><div data-day-section-body="work"><div><br></div></div></div>' + careerHtml +
    '<div data-day-section="life"><div data-day-section-title="life"><span>生活</span></div><div data-day-section-body="life"><div><br></div></div></div>',
  notes: [], updatedAt: stamp
}];
const stale = {
  id: 'merge-day', kind: 'daypaper', title: '日程 ' + date, date,
  memo: '工作\n\n事业\n\n生活',
  memoHtml: '<div data-day-section="work"><div data-day-section-title="work"><span>工作</span></div><div data-day-section-body="work"><div><br></div></div></div>' +
    '<div data-day-section="career"><div data-day-section-title="career"><span>事业</span></div><div data-day-section-body="career"><div><br></div></div></div>' +
    '<div data-day-section="life"><div data-day-section-title="life"><span>生活</span></div><div data-day-section-body="life"><div><br></div></div></div>',
  notes: [], updatedAt: '2026-01-01T00:00:00.000Z'
};
await ev(`window.__mock.setRemote(${JSON.stringify(remote)}); localStorage.setItem('ts_state_v2', JSON.stringify({tasks:[${JSON.stringify(stale)}],checkins:[],settings:{devices:{}}})); localStorage.setItem('ts_outbox_v2', JSON.stringify([{file:'tasks',type:'task_set',task:${JSON.stringify(stale)},base:${JSON.stringify(stale)},_id:'merge-op',at:'${stamp}'}]));`);
await load(URL_);
await wait(1800);
const result = await ev(`(() => {
  const p = window.__mock.files()['tasks.json'].find((x) => x.id === 'merge-day');
  return { memo: p ? p.memo : '', html: p ? p.memoHtml : '', puts: JSON.parse(localStorage.getItem('__mock_daypaper_merge')).puts };
})()`);
const ok = result.memo.includes('云端已经写好事业内容') && result.html.includes('云端已经写好事业内容');

/* 反向验证：用户在 base 里本来有这一段，主动清空时仍然允许删除。 */
const now = new Date().toISOString();
await ev(`window.__mock.setRemote(${JSON.stringify(remote)}); localStorage.setItem('ts_state_v2', JSON.stringify({tasks:[${JSON.stringify(remote[0])}],checkins:[],settings:{devices:{}}})); localStorage.setItem('ts_outbox_v2', JSON.stringify([{file:'tasks',type:'task_set',task:${JSON.stringify(Object.assign({}, stale, { updatedAt: now }))},base:${JSON.stringify(remote[0])},_id:'delete-op',at:'${now}'}]));`);
await load(URL_);
await wait(6500);
const deleted = await ev(`(() => { const p = window.__mock.files()['tasks.json'].find((x) => x.id === 'merge-day'); return p ? p.memo : ''; })()`);
const okDelete = !deleted.includes('云端已经写好事业内容');
console.log((ok && okDelete ? 'PASS' : 'FAIL') + ' 日程板块三方合并 ' +
  JSON.stringify({ result, deleted }));
process.exit(ok && okDelete ? 0 : 1);
