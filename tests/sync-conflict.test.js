/* 校验同步加固：409 冲突重试、单条失败不堵队、历史快照恢复（file_set）、GET 不走 HTTP 缓存 */
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
function todayStr() {
  const d = new Date();
  const p2 = (n) => (n < 10 ? '0' + n : String(n));
  return d.getFullYear() + '-' + p2(d.getMonth() + 1) + '-' + p2(d.getDate());
}
function b64d(s) { return Buffer.from(s, 'base64').toString('utf8'); }

(async () => {
  const results = [];
  const ok = (name, cond, extra) => results.push({ name, pass: !!cond, extra });

  const files = {
    'tasks.json': [{ id: 't0', kind: 'work', title: '已有条目', done: false }],
    'checkins.json': [],
    'settings.json': { devices: {} }
  };
  let sha = { 'tasks.json': 's1', 'checkins.json': 's1', 'settings.json': 's1' };
  let conflictOnce = false;      // 让下一次 PUT 撞一次 409
  let failCheckinPut = false;    // 让 checkins 的 PUT 一直失败（模拟某条操作推不上去）
  let noStoreMissing = 0;
  let puts = 0;

  const fetchMock = async (url, opts = {}) => {
    const file = url.split('/').pop().split('?')[0];
    const method = (opts.method || 'GET').toUpperCase();
    const j = (o) => ({ ok: true, status: 200, json: async () => o, headers: { get: () => null } });
    if (method === 'PUT') {
      if (opts.cache !== undefined) noStoreMissing += 1;      // PUT 不该带 cache
      const body = JSON.parse(opts.body);
      if (file === 'tasks.json' && conflictOnce) {            // 模拟别台设备刚写过：sha 过期
        conflictOnce = false;
        return { ok: false, status: 409, json: async () => ({ message: 'does not match current sha' }), headers: { get: () => null } };
      }
      if (file === 'checkins.json' && failCheckinPut) {
        return { ok: false, status: 500, json: async () => ({ message: 'server error' }), headers: { get: () => null } };
      }
      puts += 1;
      files[file] = JSON.parse(b64d(body.content));
      sha[file] = 's' + puts;
      return j({ content: { sha: sha[file] } });
    }
    if (opts.cache !== 'no-store') noStoreMissing += 1;        // GET 必须禁用浏览器 HTTP 缓存
    return j({ content: b64(JSON.stringify(files[file])), sha: sha[file] });
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

  await store.refresh(true).catch(() => {});
  ok('首次全量拉取带 cache:no-store', noStoreMissing === 0, 'noStoreMissing=' + noStoreMissing);
  ok('本地拿到了远端条目', store.files.tasks.value.some((t) => t.id === 't0'));

  /* ---- 1) 409 冲突：自动重拉再写，操作不丢、也不把旧内容写回去 ---- */
  conflictOnce = true;
  files['tasks.json'] = files['tasks.json'].concat([{ id: 'tx', kind: 'work', title: '别台设备刚加的', done: false }]);
  store.saveTask({ id: 't1', kind: 'work', title: '本机新加', done: false });
  await new Promise((r) => setTimeout(r, 80));
  await store.flush();
  const remote = files['tasks.json'];
  ok('409 后自动重试成功', remote.some((t) => t.id === 't1'), '远端=' + JSON.stringify(remote.map((t) => t.id)));
  ok('重试时保住了别台设备的新条目', remote.some((t) => t.id === 'tx'), '远端=' + JSON.stringify(remote.map((t) => t.id)));
  ok('队列已清空（没有留下死操作）', JSON.parse(win.localStorage.getItem('ts_outbox_v2') || '[]').length === 0);

  /* ---- 2) 单条失败不堵队：一条卡住，后面的改动照样要能上传 ---- */
  failCheckinPut = true;
  store.setChecked(todayStr(), ['t0']);                  // 这条一定会失败（留队列重试）
  await new Promise((r) => setTimeout(r, 80));
  store.saveTask({ id: 't2', kind: 'work', title: '排在失败操作后面的改动', done: false });
  await new Promise((r) => setTimeout(r, 80));
  await store.flush();
  ok('坏操作失败后，后面的操作照常上传', files['tasks.json'].some((t) => t.id === 't2'),
    '远端=' + JSON.stringify(files['tasks.json'].map((t) => t.id)));
  const left = JSON.parse(win.localStorage.getItem('ts_outbox_v2') || '[]');
  ok('失败的那条留在队列里等重试', left.some((o) => o.file === 'checkins'), '队列=' + JSON.stringify(left.map((o) => o.file + ':' + o.type)));
  ok('失败的那条记了重试次数与退避时间', left.some((o) => o.file === 'checkins' && o.tries >= 1 && o._next > Date.now()),
    JSON.stringify(left.find((o) => o.file === 'checkins')));
  ok('状态栏如实提示有改动没上传', store._status.state === 'error' || /重试|待/.test(store._status.text), JSON.stringify(store._status));

  /* ---- 3) 历史快照 + 一键恢复（file_set）----
   * 模拟最坏情况：某台设备拿着旧快照整份写回云端，把 t1 / t2 抹掉。
   * 本机刷新时应该先把「被覆盖掉的那一版」存进历史，之后能一键恢复。 */
  failCheckinPut = false;
  ok('本机此刻确实有 t1 / t2', store.files.tasks.value.some((t) => t.id === 't1') && store.files.tasks.value.some((t) => t.id === 't2'),
    '本地=' + JSON.stringify(store.files.tasks.value.map((t) => t.id)));
  files['tasks.json'] = [{ id: 't0', kind: 'work', title: '已有条目', done: false }];   // 旧客户端整份写回
  sha['tasks.json'] = 'rolled-back';
  await store.refresh(true);
  ok('被旧快照覆盖后本地确实变少了', !store.files.tasks.value.some((t) => t.id === 't1'),
    '本地=' + JSON.stringify(store.files.tasks.value.map((t) => t.id)));
  const hist = store.history('tasks');
  ok('覆盖前自动留了历史快照', hist.length >= 1, '份数=' + hist.length);
  const target = hist.find((h) => Array.isArray(h.value) && h.value.some((t) => t.id === 't1'));
  ok('快照里存着被覆盖掉的那一版', !!target, '首份=' + JSON.stringify((hist[0] || {}).value && hist[0].value.map((t) => t.id)));
  store.restoreSnapshot('tasks', target.index);
  await new Promise((r) => setTimeout(r, 80));
  await store.flush();
  ok('一键恢复把那一版整份推回云端', files['tasks.json'].some((t) => t.id === 't1') && files['tasks.json'].some((t) => t.id === 't2'),
    '远端=' + JSON.stringify(files['tasks.json'].map((t) => t.id)));
  ok('恢复后本地也回来了', store.files.tasks.value.some((t) => t.id === 't1'));

  let fail = 0;
  results.forEach((r) => {
    if (!r.pass) fail++;
    console.log((r.pass ? '  ✅ ' : '  ❌ ') + r.name + (r.extra && !r.pass ? '  → ' + r.extra : ''));
  });
  console.log(fail ? '\n❌ ' + fail + ' 项失败' : '\n✅ 同步加固测试（409 重试 / 失败不堵队 / 快照恢复）全部通过');
  process.exit(fail ? 1 : 0);
})();
