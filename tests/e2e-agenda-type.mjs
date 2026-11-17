/* 真实键盘输入回归：在周四日程里输入两行，切页再回来，两行都必须还在。 */
const CDP = 'http://127.0.0.1:9334';
const ORIGIN = 'http://127.0.0.1:8123';
const URL_ = ORIGIN + '/index.html?v=' + Date.now();

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
await send('Network.enable');
await send('Page.bringToFront');

const ev = async (expression) => {
  const r = await send('Runtime.evaluate', {
    expression, awaitPromise: true, returnByValue: true
  });
  if (r.exceptionDetails) {
    throw new Error(String(r.exceptionDetails.exception?.description || r.exceptionDetails).slice(0, 500));
  }
  return r.result.value;
};
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const key = (type, params) => send('Input.dispatchKeyEvent', Object.assign({ type }, params));
const pressEnter = async () => {
  await key('keyDown', {
    key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13, text: '\r'
  });
  await key('keyUp', {
    key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13
  });
};
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
  const KEY = '__mock_remote_type';
  const b64 = (s) => btoa(unescape(encodeURIComponent(s)));
  const ub64 = (s) => decodeURIComponent(escape(atob(s)));
  const seed = () => ({ files: { 'tasks.json': [], 'checkins.json': [], 'settings.json': { devices: {} } }, sha: {}, puts: 0 });
  const read = () => { try { return JSON.parse(localStorage.getItem(KEY)) || seed(); } catch (e) { return seed(); } };
  const save = (st) => localStorage.setItem(KEY, JSON.stringify(st));
  window.__mock = {
    files: () => read().files,
    setRemote: (f, v) => { const st = read(); st.files[f] = v; save(st); },
    reset: () => save(seed())
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
await send('Emulation.setDeviceMetricsOverride', {
  width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false
});
await send('Page.addScriptToEvaluateOnNewDocument', { source: MOCK });
await load(URL_);
await load(URL_);
await wait(700);

const thursday = await ev(`Core.shiftDate(Core.todayStr(), 2)`);
const stamp = new Date().toISOString();
const seedHtml = '<div data-day-section="work"><div data-day-section-title="work"><span>工作</span></div>' +
  '<div data-day-section-body="work"><div>周四原有内容</div></div></div>' +
  '<div data-day-section="career"><div data-day-section-title="career"><span>事业</span></div>' +
  '<div data-day-section-body="career"><div><br></div></div></div>' +
  '<div data-day-section="life"><div data-day-section-title="life"><span>生活</span></div>' +
  '<div data-day-section-body="life"><div><br></div></div></div>';
const seed = [{
  id: 'day-thursday', kind: 'daypaper', title: '日程 ' + thursday, date: thursday,
  memo: '工作\n周四原有内容\n事业\n\n生活', memoHtml: seedHtml,
  created: '2026-11-14', notes: [], updatedAt: stamp
}];
await ev(`window.__mock.setRemote('tasks.json', ${JSON.stringify(seed)})`);
await ev(`localStorage.removeItem('ts_state_v2'); localStorage.removeItem('ts_outbox_v2');`);
await load(URL_);
await wait(1800);

await ev(`document.querySelector('.nav-group[data-nav-wrap="action"] .nav-group-main').click()`);
await wait(100);
await ev(`document.querySelector('.nav-group[data-nav-wrap="action"] .tab[data-tab="agenda"]').click()`);
await wait(500);
await ev(`(() => {
  const ed = document.getElementById('daypaper-${thursday}-work');
  ed.focus();
  const range = document.createRange();
  range.selectNodeContents(ed);
  range.collapse(false);
  const sel = getSelection();
  sel.removeAllRanges();
  sel.addRange(range);
  return document.activeElement.id;
})()`);
await send('Input.insertText', { text: '真实键入第一行' });
await wait(80);
await pressEnter();
await wait(80);
await send('Input.insertText', { text: '真实键入第二行' });
await wait(120);

await ev(`document.querySelector('.nav-group[data-nav-wrap="creative"] .tab[data-tab="idea"]').click()`);
await wait(250);
await ev(`document.querySelector('.nav-group[data-nav-wrap="action"] .nav-group-main').click()`);
await wait(100);
await ev(`document.querySelector('.nav-group[data-nav-wrap="action"] .tab[data-tab="agenda"]').click()`);
await wait(1200);

const result = await ev(`(() => {
  const ed = document.getElementById('daypaper-${thursday}-work');
  const remote = window.__mock.files()['tasks.json'].find((x) => x.id === 'day-thursday');
  let local = null;
  try { local = JSON.parse(localStorage.getItem('ts_state_v2')).tasks.find((x) => x.id === 'day-thursday'); } catch (e) {}
  return {
    dom: ed ? ed.innerText : '',
    remoteMemo: remote ? remote.memo : '',
    localMemo: local ? local.memo : ''
  };
})()`);

const ok = result.dom.includes('真实键入第一行') && result.dom.includes('真实键入第二行') &&
  result.remoteMemo.includes('真实键入第一行') && result.remoteMemo.includes('真实键入第二行') &&
  result.localMemo.includes('真实键入第一行') && result.localMemo.includes('真实键入第二行');
console.log(ok ? 'PASS 真实键入两行并在切页后保留' : 'FAIL ' + JSON.stringify(result));
process.exit(ok ? 0 : 1);
