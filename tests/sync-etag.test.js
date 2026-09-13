/* 校验：条件请求(ETag/304) 同步逻辑 —— 304 不消耗配额、值不丢、PUT 后失效 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const DIR = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(DIR, p), 'utf8');

function mkEnv() {
  const ls = new Map();
  const win = {
    localStorage: {
      getItem: (k) => (ls.has(k) ? ls.get(k) : null),
      setItem: (k, v) => ls.set(k, String(v)),
      removeItem: (k) => ls.delete(k)
    },
    addEventListener() {},
    document: null
  };
  win.window = win;
  return win;
}

function b64(s) { return Buffer.from(s, 'utf8').toString('base64'); }

(async () => {
  const results = [];
  const ok = (name, cond, extra) => results.push({ name, pass: !!cond, extra });

  const files = { 'tasks.json': [], 'checkins.json': [], 'settings.json': { devices: {} } };
  let etags = { 'tasks.json': '"e1"', 'checkins.json': '"e2"', 'settings.json': '"e3"' };
  let quotaUsed = 0, notModified = 0, fullGets = 0, puts = 0;
  let lastConditionalHeader = null;

  const fetchMock = async (url, opts = {}) => {
    const file = url.split('/').pop().split('?')[0];
    const method = (opts.method || 'GET').toUpperCase();
    if (method === 'PUT') {
      puts++;
      quotaUsed++;
      const body = JSON.parse(opts.body);
      files[file] = JSON.parse(Buffer.from(body.content, 'base64').toString('utf8'));
      etags[file] = '"e' + Math.random().toString(36).slice(2) + '"';
      return { ok: true, status: 200, json: async () => ({ content: { sha: 'sha-' + file } }), headers: { get: () => null } };
    }
    const inm = (opts.headers || {})['If-None-Match'];
    if (inm) lastConditionalHeader = inm;
    if (inm && inm === etags[file]) {
      notModified++;
      return { ok: false, status: 304, json: async () => ({ message: 'Not Modified' }), headers: { get: () => null } };
    }
    fullGets++;
    quotaUsed++;
    return {
      ok: true,
      status: 200,
      json: async () => ({ content: b64(JSON.stringify(files[file])), sha: 'sha-' + file }),
      headers: { get: (h) => (h.toLowerCase() === 'etag' ? etags[file] : null) }
    };
  };

  const win = mkEnv();
  const sandbox = {
    window: win, document: { hidden: false, addEventListener() {} },
    navigator: { onLine: true, userAgent: 'Macintosh' },
    localStorage: win.localStorage, fetch: fetchMock,
    setInterval: () => 0, clearInterval() {}, console, TextEncoder, TextDecoder,
    btoa: (s) => Buffer.from(s, 'binary').toString('base64'),
    atob: (s) => Buffer.from(s, 'base64').toString('binary'),
    setTimeout, Promise, JSON, Date, Math, String, Number, Object, Array, Error
  };
  sandbox.window = Object.assign(win, sandbox.window);
  const ctx = vm.createContext(sandbox);
  vm.runInContext(read('js/config.js'), ctx);
  vm.runInContext(read('js/core.js'), ctx);
  vm.runInContext(read('js/store.js'), ctx);

  const Store = vm.runInContext('window.Store', ctx);
  const store = new Store(vm.runInContext('window.TS_CONFIG', ctx));
  store.token = 'github_pat_fake';
  let renders = 0;
  store.onChange = () => { renders++; };

  await store.refresh(true);
  ok('首次全量拉取 3 个文件', fullGets === 3, 'fullGets=' + fullGets);
  ok('首次 0 个 304', notModified === 0);
  ok('首次拉取记录 ETag', store.files.tasks.etag === '"e1"', String(store.files.tasks.etag));
  const quotaAfterFirst = quotaUsed;

  const renderBefore = renders;
  await store.refresh(true);
  ok('二次同步命中 3 个 304', notModified === 3, 'notModified=' + notModified);
  ok('304 不消耗配额', quotaUsed === quotaAfterFirst, 'quota=' + quotaUsed);
  ok('条件请求确实带了 If-None-Match', !!lastConditionalHeader);
  ok('远端未变时不重渲染', renders === renderBefore, 'renders=' + renders);

  // 本地改动 -> PUT -> 本地 ETag 失效 -> 再次拉取必须是全量
  store.saveTask({ id: 't1', title: '测试任务', kind: 'life', done: false });
  await new Promise((r) => setTimeout(r, 60));
  await store.flush();
  ok('改动已 PUT 上传', puts >= 1, 'puts=' + puts);
  ok('PUT 后本地 ETag 失效', store.files.tasks.etag === null, String(store.files.tasks.etag));

  const fullBefore = fullGets;
  await store.refresh(true);
  ok('失效后重新全量拉取 tasks', fullGets === fullBefore + 1, 'fullGets=' + fullGets);
  const remoteTasks = files['tasks.json'];
  ok('远端确实写入了新任务', remoteTasks.some((t) => t.id === 't1'), JSON.stringify(remoteTasks));
  ok('本地任务未被刷没', store.files.tasks.value.some((t) => t.id === 't1'));

  // 未连接 token 时不应发请求
  const q = quotaUsed;
  store.token = ''; // 清掉本机 Token
  await store.refresh(true);
  ok('无 Token 时不发请求', quotaUsed === q, 'quota=' + quotaUsed + ' 期望=' + q);

  let fail = 0;
  results.forEach((r) => {
    if (!r.pass) fail++;
    console.log((r.pass ? '  ✅ ' : '  ❌ ') + r.name + (r.extra && !r.pass ? '  → ' + r.extra : ''));
  });
  console.log(fail ? '\n❌ ' + fail + ' 项失败' : '\n✅ ETag/304 同步测试全部通过');
  process.exit(fail ? 1 : 0);
})();
