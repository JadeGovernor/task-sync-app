/* 手机端旧缓存不能先迁移：必须等云端最新任务拉下来后再执行跨天延续。 */
const CDP = 'http://127.0.0.1:9334';
const ORIGIN = 'http://127.0.0.1:8123';
const URL_ = ORIGIN + '/index.html?freshroll=' + Date.now();

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
  const KEY = '__mock_fresh_roll';
  const b64 = (s) => btoa(unescape(encodeURIComponent(s)));
  const ub64 = (s) => decodeURIComponent(escape(atob(s)));
  const seed = () => ({ files: { 'tasks.json': [], 'checkins.json': [], 'settings.json': { devices: {} } }, sha: {}, puts: 0, gets: 0, delay: 0 });
  const read = () => { try { return JSON.parse(localStorage.getItem(KEY)) || seed(); } catch (e) { return seed(); } };
  const save = (st) => localStorage.setItem(KEY, JSON.stringify(st));
  window.__mock = {
    files: () => read().files,
    stats: () => read(),
    setRemote: (f, v) => { const st = read(); st.files[f] = v; save(st); },
    setDelay: (ms) => { const st = read(); st.delay = ms; save(st); }
  };
  window.fetch = async (url, opts = {}) => {
    const f = String(url).split('/').pop().split('?')[0];
    const method = ((opts && opts.method) || 'GET').toUpperCase();
    const st = read();
    if (method === 'GET') {
      st.gets += 1;
      save(st);
      if (f === 'tasks.json' && st.delay) await new Promise((r) => setTimeout(r, st.delay));
      return {
        ok: true, status: 200, headers: { get: () => null },
        json: async () => ({
          content: b64(JSON.stringify(st.files[f] === undefined ? [] : st.files[f])),
          sha: st.sha[f] || 's0'
        })
      };
    }
    const body = JSON.parse(opts.body);
    st.files[f] = JSON.parse(ub64(body.content));
    st.puts += 1;
    st.sha[f] = 's' + st.puts;
    save(st);
    return {
      ok: true, status: 200, headers: { get: () => null },
      json: async () => ({ content: { sha: st.sha[f] } })
    };
  };
  localStorage.setItem('ts_token_v1', 'fake-token');
})();`;

await send('Storage.clearDataForOrigin', { origin: ORIGIN, storageTypes: 'all' });
await send('Network.setCacheDisabled', { cacheDisabled: true });
await send('Page.addScriptToEvaluateOnNewDocument', { source: MOCK });
await load(URL_);
await wait(700);

const dates = await ev(`({ today: Core.todayStr(), yesterday: Core.shiftDate(Core.todayStr(), -1) })`);
const stamp = new Date().toISOString();
const remote = [
  {
    id: 'fresh-y', kind: 'daypaper', title: '日程 ' + dates.yesterday, date: dates.yesterday,
    memo: '工作\n电脑端最新工作\n事业\n\n生活', memoHtml: '<div>电脑端最新工作</div>',
    notes: [], updatedAt: stamp
  }
];
const stale = [
  {
    id: 'fresh-y', kind: 'daypaper', title: '日程 ' + dates.yesterday, date: dates.yesterday,
    memo: '工作\n手机旧缓存\n事业\n\n生活', memoHtml: '<div>手机旧缓存</div>',
    notes: [], updatedAt: '2026-01-01T00:00:00.000Z'
  }
];
await ev(`window.__mock.setRemote('tasks.json', ${JSON.stringify(remote)}); window.__mock.setDelay(900);`);
await ev(`localStorage.setItem('ts_state_v2', JSON.stringify({ tasks: ${JSON.stringify(stale)}, checkins: [], settings: { devices: {} } })); localStorage.removeItem('ts_outbox_v2');`);
await load(URL_);
await wait(2300);

const result = await ev(`(() => {
  const st = window.__mock.stats();
  const all = st.files['tasks.json'];
  const today = all.find((x) => x.kind === 'daypaper' && x.date === ${JSON.stringify(dates.today)});
  return { text: today ? today.memo : '', html: today ? today.memoHtml : '', puts: st.puts, gets: st.gets };
})()`);
const ok = result.text.includes('电脑端最新工作') && !result.text.includes('手机旧缓存') &&
  /昨天剩下内容/.test(result.html) && result.puts > 0;
console.log((ok ? 'PASS' : 'FAIL') + ' 跨天迁移使用云端最新版本 ' + JSON.stringify(result));
process.exit(ok ? 0 : 1);
