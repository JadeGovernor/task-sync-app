/* 排期跨月：上月四周剩余内容自动并入本月第一周，并且旧设备重推时不能重复。 */
const CDP = 'http://127.0.0.1:9334';
const ORIGIN = 'http://127.0.0.1:8123';
const URL_ = ORIGIN + '/index.html?monthroll=' + Date.now();

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
  const KEY = '__mock_month_roll';
  const b64 = (s) => btoa(unescape(encodeURIComponent(s)));
  const ub64 = (s) => decodeURIComponent(escape(atob(s)));
  const seed = () => ({ files: { 'tasks.json': [], 'checkins.json': [], 'settings.json': { devices: {} } }, sha: {}, puts: 0 });
  const read = () => { try { return JSON.parse(localStorage.getItem(KEY)) || seed(); } catch (e) { return seed(); } };
  const save = (st) => localStorage.setItem(KEY, JSON.stringify(st));
  window.__mock = {
    files: () => read().files,
    stats: () => read(),
    setRemote: (f, v) => { const st = read(); st.files[f] = v; save(st); }
  };
  window.fetch = async (url, opts = {}) => {
    const f = String(url).split('/').pop().split('?')[0];
    const method = ((opts && opts.method) || 'GET').toUpperCase();
    const st = read();
    if (method === 'GET') {
      save(st);
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
await wait(900);

const keys = await ev(`(() => {
  const d = new Date();
  const p2 = (n) => String(n).padStart(2, '0');
  const key = (x) => x.getFullYear() + '-' + p2(x.getMonth() + 1);
  const cur = new Date(d.getFullYear(), d.getMonth(), 1);
  const prev = new Date(d.getFullYear(), d.getMonth() - 1, 1);
  return { cur: key(cur), prev: key(prev) };
})()`);
const stamp = new Date().toISOString();
const week = (monthKey, i, text) => {
  const y = Number(monthKey.slice(0, 4));
  const m = Number(monthKey.slice(5, 7)) - 1;
  const last = new Date(y, m + 1, 0).getDate();
  const starts = [1, 8, 15, 22];
  const ends = [7, 14, 21, last];
  const day = (n) => monthKey + '-' + String(n).padStart(2, '0');
  return {
    id: 'mw-' + monthKey + '-' + i,
    kind: 'monthweek',
    title: monthKey + ' 第 ' + (i + 1) + ' 周',
    month: monthKey,
    week: i,
    start: day(starts[i]),
    end: day(ends[i]),
    text,
    notes: [],
    updatedAt: stamp
  };
};
const seed = [
  week(keys.cur, 0, '新月自带任务'),
  week(keys.prev, 0, '上月第一周任务'),
  week(keys.prev, 1, '上月第二周任务'),
  week(keys.prev, 2, '上月第三周任务'),
  week(keys.prev, 3, '上月第四周任务')
];
await ev(`window.__mock.setRemote('tasks.json', ${JSON.stringify(seed)})`);
await ev(`localStorage.removeItem('ts_state_v2'); localStorage.removeItem('ts_outbox_v2');`);
await load(URL_);
await wait(2200);

const readMonth = () => ev(`(() => {
  const st = window.__mock.stats();
  const all = st.files['tasks.json'];
  const cur = all.find((x) => x.kind === 'monthweek' && x.month === ${JSON.stringify(keys.cur)} && x.week === 0);
  const prev = all.filter((x) => x.kind === 'monthweek' && x.month === ${JSON.stringify(keys.prev)})
    .sort((a, b) => a.week - b.week);
  return {
    puts: st.puts,
    curText: cur ? cur.text : '',
    prev: prev.map((x) => ({ week: x.week, text: x.text, rolledTo: x.rolledTo }))
  };
})()`);
const first = await readMonth();
const okFirst = first.curText.includes('新月自带任务') &&
  first.curText.includes('上月剩下内容：') &&
  ['上月第一周任务', '上月第二周任务', '上月第三周任务', '上月第四周任务'].every((x) => first.curText.includes(x)) &&
  first.prev.every((x) => !String(x.text || '').trim() && x.rolledTo === keys.cur);
await ev(`document.querySelector('.tab[data-tab="month"]').click()`);
await wait(450);
const monthUi = await ev(`(() => {
  const el = document.querySelector('[data-ms-week="0"]');
  return el ? el.value : '';
})()`);
const okUi = monthUi.includes('上月剩下内容：') &&
  ['上月第一周任务', '上月第二周任务', '上月第三周任务', '上月第四周任务'].every((x) => monthUi.includes(x));

const stale = await ev(`(() => {
  const st = window.__mock.stats();
  const all = st.files['tasks.json'];
  const old = ${JSON.stringify(seed)};
  old.forEach((x) => {
    if (x.month === ${JSON.stringify(keys.prev)}) {
      const cur = all.find((y) => y.id === x.id);
      if (cur) cur.text = x.text;
    }
  });
  window.__mock.setRemote('tasks.json', all);
  return 1;
})()`);
const putsBefore = (await readMonth()).puts;
await load(URL_);
await wait(1800);
const second = await readMonth();
const okSecond = (second.curText.match(/上月第一周任务/g) || []).length === 1 &&
  (second.curText.match(/上月第四周任务/g) || []).length === 1 &&
  second.puts === putsBefore;

console.log((okFirst && okUi && okSecond ? 'PASS' : 'FAIL') + ' 排期跨月延续 ' +
  JSON.stringify({ first, monthUi, second, putsBefore, stale }));
process.exit(okFirst && okUi && okSecond ? 0 : 1);
