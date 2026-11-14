/* v53：分层导航、日历、日程七天纸、今日四块提醒、富文本提醒统一进今日顶部 */
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
const errors = [];
ws.addEventListener('message', (e) => {
  const m = JSON.parse(e.data);
  if (m.method === 'Runtime.exceptionThrown') {
    errors.push(String(m.params.exceptionDetails.exception?.description ||
      m.params.exceptionDetails.text || '').slice(0, 300));
  }
  if (m.id && pending.has(m.id)) {
    const p = pending.get(m.id);
    pending.delete(m.id);
    m.error ? p.reject(new Error(JSON.stringify(m.error))) : p.resolve(m.result);
  }
});
await send('Page.enable');
await send('Runtime.enable');
await send('Network.enable');
await send('Page.bringToFront');

const ev = async (expression) => {
  const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  if (r.exceptionDetails) {
    throw new Error(String(r.exceptionDetails.exception?.description || r.exceptionDetails).slice(0, 500));
  }
  return r.result.value;
};
const load = (url) => new Promise((resolve) => {
  const h = (e) => {
    const m = JSON.parse(e.data);
    if (m.method === 'Page.loadEventFired') {
      ws.removeEventListener('message', h);
      resolve();
    }
  };
  ws.addEventListener('message', h);
  send('Page.navigate', { url });
});
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const waitFor = async (expression, timeout = 5000) => {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    if (await ev(expression)) return true;
    await wait(120);
  }
  return false;
};
const R = [];
const ok = (name, condition, extra) => R.push({ name, pass: !!condition, extra });
const dump = () => {
  console.log('--- 已完成用例 ---');
  R.forEach((r) => console.log((r.pass ? 'PASS ' : 'FAIL ') + r.name +
    (r.pass ? '' : '  <= ' + JSON.stringify(r.extra))));
  console.log('总计 ' + R.filter((r) => r.pass).length + '/' + R.length);
};
process.on('uncaughtException', (e) => { console.log('CRASH: ' + e.message); dump(); process.exit(1); });
process.on('unhandledRejection', (e) => { console.log('CRASH: ' + (e && e.message || e)); dump(); process.exit(1); });

const MOCK = `(() => {
  const KEY = '__mock_remote';
  const b64 = (s) => btoa(unescape(encodeURIComponent(s)));
  const ub64 = (s) => decodeURIComponent(escape(atob(s)));
  const seed = () => ({ files: { 'tasks.json': [], 'checkins.json': [], 'settings.json': { devices: {} } }, sha: {}, puts: 0, gets: 0 });
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
      st.gets += 1;
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
  width: 393, height: 852, deviceScaleFactor: 2, mobile: true
});
await send('Page.addScriptToEvaluateOnNewDocument', { source: MOCK });
await load(URL_);
await wait(900);

const dates = await ev(`(() => {
  const t = Core.todayStr();
  return {
    t, y: Core.shiftDate(t, -1), p3: Core.shiftDate(t, 3), p10: Core.shiftDate(t, 10),
    wd: new Date().getDay(), old: Core.shiftDate(t, -30)
  };
})()`);
const otherWd = (dates.wd + 3) % 7;
const stamp = new Date().toISOString();
const tasks = [
  { id: 'loop1', kind: 'loop', title: '今日循环站会', weekdays: [dates.wd], doneWeeks: [], created: dates.old, notes: [], updatedAt: stamp },
  { id: 'loop2', kind: 'loop', title: '别天循环复盘', weekdays: [otherWd], doneWeeks: [], created: dates.old, notes: [], updatedAt: stamp },
  { id: 'habit1', kind: 'habit', title: '每日喝水', freq: 'daily', weeksDone: [], created: dates.old, notes: [], updatedAt: stamp },
  { id: 'habit2', kind: 'habit', title: '每周整理', freq: 'weekly', weeksDone: [], created: dates.old, notes: [], updatedAt: stamp },
  { id: 'plan-over', kind: 'plan', title: '逾期项目', rangeStart: dates.old, rangeEnd: dates.y, done: false, rank: 1, created: dates.old, notes: [], updatedAt: stamp },
  { id: 'plan-soon', kind: 'plan', title: '三天后项目', rangeStart: dates.t, rangeEnd: dates.p3, done: false, rank: 2, created: dates.t, notes: [], updatedAt: stamp },
  { id: 'plan-far', kind: 'plan', title: '十天后项目', rangeStart: dates.t, rangeEnd: dates.p10, done: false, rank: 3, created: dates.t, notes: [], updatedAt: stamp },
  { id: 'cal-today', kind: 'calendar_note', title: '今天日历', text: '今天日历记录', date: dates.t, createdAt: '2026-01-01T00:00:00.000Z', updatedAt: stamp },
  { id: 'cal-soon', kind: 'calendar_note', title: '三天后日历', text: '三天后日历记录', date: dates.p3, createdAt: '2026-01-02T00:00:00.000Z', updatedAt: stamp },
  { id: 'cal-far', kind: 'calendar_note', title: '十天后日历', text: '十天后日历记录', date: dates.p10, createdAt: '2026-01-03T00:00:00.000Z', updatedAt: stamp },
  { id: 'idea1', kind: 'idea', title: '点子', memo: '旧点子内容', memoHtml: '<div>旧点子内容</div>', created: dates.old, notes: [], updatedAt: stamp },
  { id: 'memo1', kind: 'memo', title: '琐事', memo: '交房租 ⏰' + dates.t, memoHtml: '<div>交房租 ⏰' + dates.t + '</div>', created: dates.old, notes: [], updatedAt: stamp },
  { id: 'monthnote1', kind: 'monthnote', title: '计划底稿', memo: '排期底稿提醒 ⏰' + dates.t, memoHtml: '<div>排期底稿提醒 ⏰' + dates.t + '</div>', created: dates.old, notes: [], updatedAt: stamp },
  { id: 'report1', kind: 'weekreport', title: '测试周报', memo: '周报提醒 ⏰' + dates.t, memoHtml: '<div>周报提醒 ⏰' + dates.t + '</div>', createdAt: stamp, created: dates.old, notes: [], updatedAt: stamp },
  { id: 'day-y', kind: 'daypaper', title: '日程 ' + dates.y, date: dates.y, memo: '昨天没写完的日程', memoHtml: '<div>昨天没写完的日程</div>', updatedAt: '2026-01-04T00:00:00.000Z' },
  { id: 'day-today', kind: 'daypaper', title: '日程 ' + dates.t, date: dates.t, memo: '下午准备周会 ⏰' + dates.t, memoHtml: '<div>下午准备周会 ⏰' + dates.t + '</div>', updatedAt: '2026-01-05T00:00:00.000Z' },
  { id: 'work1', kind: 'work', title: '公司旧待办', due: dates.t, done: false, created: dates.t, notes: [], updatedAt: stamp }
];
await ev(`window.__mock.setRemote('tasks.json', ${JSON.stringify(tasks)})`);
await ev(`localStorage.removeItem('ts_state_v2'); localStorage.removeItem('ts_revs_v2');`);
await load(URL_);
await wait(2400);
errors.length = 0;

const go = async (group, tab) => {
  await ev(`document.querySelector('.nav-group[data-nav-wrap="${group}"] .nav-group-main').click()`);
  await wait(120);
  await ev(`document.querySelector('.nav-group[data-nav-wrap="${group}"] .tab[data-tab="${tab}"]').click()`);
  await wait(450);
};
const remoteTasks = () => ev(`window.__mock.files()['tasks.json']`);
const remoteOne = async (id) => (await remoteTasks()).find((x) => x.id === id);

/* 1. 新导航：三个大椭圆组 + 今日 + 更多，点击组本身不切页 */
const nav = await ev(`(() => ({
  groups: [...document.querySelectorAll('.nav-group-main')].map((x) => x.textContent.replace(/▾/g, '').trim()),
  today: (document.querySelector('.nav-today') || {}).textContent,
  more: (document.querySelector('.nav-more-btn') || {}).textContent,
  tabs: document.querySelectorAll('#tabs .tab').length
}))()`);
ok('1a 三个分组按 创意层/计划层/行动层 排列',
  JSON.stringify(nav.groups) === JSON.stringify(['创意层', '计划层', '行动层']), nav.groups);
ok('1b 分组后是今日和更多', /今日/.test(nav.today) && /更多/.test(nav.more), nav);
const groupStyle = await ev(`[...document.querySelectorAll('.nav-group')].map((g) => {
  const box = getComputedStyle(g);
  const main = getComputedStyle(g.querySelector('.nav-group-main'));
  return { bg: box.backgroundColor, border: box.borderColor, cursor: main.cursor };
})`);
ok('1b2 三个分组用不同底色区分', new Set(groupStyle.map((x) => x.bg)).size === 3, groupStyle);
ok('1b3 分组标题视觉上不可点击（默认光标）',
  groupStyle.every((x) => x.cursor === 'default'), groupStyle);
const todayBefore = await ev(`document.querySelector('#view').textContent`);
await ev(`document.querySelector('.nav-group[data-nav-wrap="creative"] .nav-group-main').click()`);
await wait(150);
ok('1c 点大组只展开、不切页', await ev(`document.querySelector('#view').textContent`) === todayBefore);
ok('1d 手机端点大组后子 Tab 可见',
  await ev(`getComputedStyle(document.querySelector('.nav-group[data-nav-wrap="creative"] .nav-subtabs')).display !== 'none'`));
await ev(`document.querySelector('.nav-group[data-nav-wrap="creative"] .tab[data-tab="idea"]').click()`);
await wait(400);
ok('1e 点子页复用旧创意数据', /旧点子内容/.test(await ev(`document.querySelector('#view').textContent`)));

/* 2. 娱乐是独立数据 */
await go('creative', 'fun');
ok('2a 娱乐页是全新的独立备忘录', await ev(`!!document.querySelector('#memo-text') && !/旧点子内容/.test(document.querySelector('#view').textContent)`));
await ev(`(() => { const ed = document.querySelector('#memo-text'); ed.innerHTML = '<div>今晚看一部电影</div>';
  ed.dispatchEvent(new Event('input', { bubbles: true })); return 1; })()`);
await wait(1400);
const funItem = (await remoteTasks()).find((x) => x.kind === 'fun');
ok('2b 娱乐内容写进独立 kind=fun', !!funItem && /今晚看一部电影/.test(funItem.memo || ''), funItem);
await go('creative', 'idea');
ok('2c 娱乐不会覆盖旧点子', /旧点子内容/.test(await ev(`document.querySelector('#view').textContent`)) &&
  !/今晚看一部电影/.test(await ev(`document.querySelector('#view').textContent`)));

/* 3. 更多菜单保留所有旧入口，并统一新名字 */
await ev(`document.querySelector('.nav-more-btn').click()`);
await wait(150);
const legacy = await ev(`(() => ({
  open: !document.querySelector('.nav-more-menu').classList.contains('hidden'),
  labels: [...document.querySelectorAll('.nav-more-menu .tab')].map((x) => x.textContent.replace(/\\d+/g, '').trim()),
  topmost: (() => {
    const r = document.querySelector('.nav-more-menu .tab').getBoundingClientRect();
    const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    return !!(hit && hit.closest('.nav-more-menu'));
  })()
}))()`);
ok('3a 更多菜单可展开且旧入口都在', legacy.open && legacy.labels.length >= 10, legacy);
ok('3b 旧入口已改名：项目/打卡/点子', ['项目', '打卡', '点子'].every((x) => legacy.labels.includes(x)), legacy.labels);
ok('3c 旧入口不再出现 自律/创意', !legacy.labels.includes('自律') && !legacy.labels.includes('创意'), legacy.labels);
ok('3c2 更多菜单位于页面最上层', legacy.topmost, legacy);
await ev(`document.querySelector('.nav-more-menu .tab[data-tab="settings"]').click()`);
ok('3d 旧入口仍能打开设置页', await waitFor(`/连接同步/.test(document.querySelector('#view').textContent)`));
await ev(`document.querySelector('.nav-today').click()`);
await wait(350);

/* 4. 日历：三档、三个月竖排、12 个月 6×2、当日多条、编辑删除、绿点、Banner */
await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false });
await wait(250);
await ev(`document.querySelector('.nav-group[data-nav-wrap="planning"] .tab[data-tab="calendar"]').click()`);
await wait(450);
ok('4a 日历页打开', /日历记录 · 从最近到最远/.test(await ev(`document.querySelector('#view').textContent`)));
ok('4b 默认只显示本月', (await ev(`document.querySelectorAll('.cal-month-card').length`)) === 1);
await ev(`document.querySelector('[data-action="calendar-zoom"][data-zoom="1"]').click()`);
await wait(200);
ok('4c 三个月档显示 3 个月', (await ev(`document.querySelectorAll('.cal-month-card').length`)) === 3);
const calGrid3 = await ev(`(() => {
  const cards = [...document.querySelectorAll('.cal-month-card')];
  const tops = [...new Set(cards.map((x) => Math.round(x.getBoundingClientRect().top)))];
  const lefts = [...new Set(cards.map((x) => Math.round(x.getBoundingClientRect().left)))];
  return { n: cards.length, rows: tops.length, cols: lefts.length };
})()`);
ok('4c2 三个月纵向排列', calGrid3.rows === 3 && calGrid3.cols === 1, calGrid3);
await ev(`document.querySelector('[data-action="calendar-zoom"][data-zoom="2"]').click()`);
await wait(250);
const calGrid = await ev(`(() => {
  const cards = [...document.querySelectorAll('.cal-month-card')];
  const tops = [...new Set(cards.map((x) => Math.round(x.getBoundingClientRect().top)))];
  const lefts = [...new Set(cards.map((x) => Math.round(x.getBoundingClientRect().left)))];
  return { n: cards.length, rows: tops.length, cols: lefts.length };
})()`);
ok('4d 十二个月档共 12 张', calGrid.n === 12, calGrid);
ok('4e 十二个月按 6 行 × 2 列排列', calGrid.rows === 6 && calGrid.cols === 2, calGrid);
ok('4f 今天在日历上有标记', await ev(`!!document.querySelector('.cal-day.is-today')`));
ok('4g 空间不足时仍有绿点', await ev(`!!document.querySelector('.cal-day.has-notes .cal-dot')`));
ok('4g2 日历显示 ISO 周序号', await ev(`document.querySelectorAll('.cal-week-no').length >= 4`));

await ev(`document.querySelector('.cal-day[data-date="${dates.t}"]').click()`);
await wait(160);
ok('4h 点日期打开输入框', await ev(`!!document.querySelector('.cal-composer input')`));
await ev(`(() => { const i = document.querySelector('.cal-composer input'); i.value = '今天新日历事项';
  document.querySelector('.cal-composer form').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); return 1; })()`);
await wait(1000);
ok('4i 回车后写入一条', (await remoteTasks()).some((x) => x.kind === 'calendar_note' &&
  x.date === dates.t && x.text === '今天新日历事项'));
await ev(`document.querySelector('.cal-day[data-date="${dates.t}"]').click()`);
await wait(160);
await ev(`(() => { const i = document.querySelector('.cal-composer input'); i.value = '今天第二件事';
  document.querySelector('.cal-composer form').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); return 1; })()`);
await wait(1000);
const sameDay = (await remoteTasks()).filter((x) => x.kind === 'calendar_note' && x.date === dates.t);
ok('4j 同一天可以记录多条', sameDay.length === 3, sameDay.map((x) => x.text));
await ev(`document.querySelector('.cal-record-main[data-id="cal-soon"]').click()`);
await wait(160);
await ev(`(() => { const i = document.querySelector('.cal-composer input'); i.value = '三天后日历记录-已改';
  document.querySelector('.cal-composer form').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); return 1; })()`);
await wait(1000);
ok('4k 日历记录可以编辑', /已改/.test(((await remoteOne('cal-soon')) || {}).text || ''));
await ev(`document.querySelector('.cal-record-del[data-id="cal-far"]').click()`);
await wait(250);
await ev(`document.querySelector('#confirm-ok').click()`);
await wait(900);
ok('4l 日历记录可以删除', !(await remoteTasks()).some((x) => x.id === 'cal-far'));
const bannerOrder = await ev(`(() => ({
  dates: [...document.querySelectorAll('.cal-record-date')].map((x) => x.textContent),
  first: (document.querySelector('.cal-record-text') || {}).textContent || ''
}))()`);
ok('4m 下方 Banner 从最近到最远排列',
  bannerOrder.dates.length >= 2 && bannerOrder.first === '今天日历记录', bannerOrder);

/* 5. 日程：今天起 7 张、一行起步、跨天滚动、富文本提醒 */
await ev(`document.querySelector('.nav-group[data-nav-wrap="action"] .tab[data-tab="agenda"]').click()`);
await waitFor(`document.querySelectorAll('.agenda-card').length === 7`);
await waitFor(`!!document.getElementById('daypaper-${dates.t}') &&
  /昨天剩下内容/.test(document.getElementById('daypaper-${dates.t}').textContent)`);
ok('5a 日程页正好 7 张纸', (await ev(`document.querySelectorAll('.agenda-card').length`)) === 7);
ok('5b 七张纸都有富文本编辑器', (await ev(`document.querySelectorAll('.agenda-card .day-paper-editor[contenteditable="true"]').length`)) === 7);
const blankPaper = await ev(`(() => {
  const ed = document.querySelector('#daypaper-${dates.p3}');
  return { found: !!ed, h: ed && ed.getBoundingClientRect().height };
})()`);
ok('5c 空白纸初始高度接近一行', blankPaper.found && blankPaper.h <= 90, blankPaper);
const todayPaper = await ev(`(() => {
  const ed = document.querySelector('#daypaper-${dates.t}');
  return { text: ed ? ed.textContent : '', h: ed ? ed.getBoundingClientRect().height : 0 };
})()`);
ok('5d 昨天剩下的内容滚到今天最前面',
  /昨天剩下内容：/.test(todayPaper.text) && /昨天没写完的日程/.test(todayPaper.text), todayPaper.text);
ok('5e 今天原有内容排在滚动内容后面', /昨天没写完的日程[\s\S]*下午准备周会/.test(todayPaper.text), todayPaper.text);
const oldDay = await remoteOne('day-y');
ok('5f 滚动后昨天那张纸已清空并标记 rolledTo', oldDay && !String(oldDay.memo || '').trim() && oldDay.rolledTo === dates.t, oldDay);
await ev(`(() => { const ed = document.querySelector('#daypaper-${dates.t}');
  ed.innerHTML += '<div>今天的新日程</div>'; ed.dispatchEvent(new Event('input', { bubbles: true })); return 1; })()`);
await wait(1300);
const todayPaperRemote = (await remoteTasks()).find((x) => x.kind === 'daypaper' && x.date === dates.t);
ok('5g 日程纸自动保存', todayPaperRemote && /今天的新日程/.test(todayPaperRemote.memo || ''), todayPaperRemote);
ok('5g2 滚动前缀保留粗体', await ev(`!!document.querySelector('.day-paper-editor b[data-rollover]')`));
ok('5g3 滚动原文与今天内容之间留两行',
  !!todayPaperRemote && /<div><br><\/div><div><br><\/div>/.test(todayPaperRemote.memoHtml || ''),
  todayPaperRemote && todayPaperRemote.memoHtml);
ok('5h 日程纸有富文本工具栏', await ev(`!!document.querySelector('.agenda-card .rich-toolbar')`));
ok('5i 日程纸有独立提醒入口', await ev(`!!document.querySelector('[data-action="day-timer-add"]')`));

/* 6. 今日：提醒在最顶，然后 循环→打卡→项目→日历 */
await ev(`document.querySelector('.nav-today').click()`);
await wait(400);
const todayOrder = await ev(`[...document.querySelectorAll('#view > section')].map((s) => (s.querySelector('h3') || {}).textContent || '')`);
ok('6a 今日提醒在最顶部', /今日提醒/.test(todayOrder[0] || ''), todayOrder);
ok('6b 之后依次是 循环/打卡/项目/日历',
  /今日循环/.test(todayOrder[1] || '') && /今日打卡/.test(todayOrder[2] || '') &&
  /近七天项目/.test(todayOrder[3] || '') && /近七周日历/.test(todayOrder[4] || ''), todayOrder);
ok('6c 旧的自律区块已从今日移除', !/自律/.test(await ev(`document.querySelector('#view').textContent`)));
ok('6d 琐事提醒进入今日顶部', await ev(`!!document.querySelector('#today-timers [data-src-key="memo:memo"]')`));
ok('6e 日程提醒进入今日顶部', await ev(`!!document.querySelector('#today-timers [data-src-key="day:${dates.t}"]')`));
ok('6f 排期底稿提醒进入今日顶部', await ev(`!!document.querySelector('#today-timers [data-src-key="monthnote"]')`));
ok('6g 周报提醒进入今日顶部', await ev(`!!document.querySelector('#today-timers [data-src-key="report:report1"]')`));
ok('6h 今日不显示公司旧待办', !(await ev(`!!document.querySelector('#view .task[data-id="work1"]')`)));
const planIds = await ev(`[...document.querySelectorAll('#view .task')].map((x) => x.dataset.id)`);
ok('6i 逾期项目排在项目提醒最前', planIds.indexOf('plan-over') >= 0 &&
  planIds.indexOf('plan-over') < planIds.indexOf('plan-soon'), planIds);
ok('6j 近七周日历包含今天和三天后、不含十天后',
  /今天日历记录/.test(await ev(`document.querySelector('#view').textContent`)) &&
  /三天后日历记录-已改/.test(await ev(`document.querySelector('#view').textContent`)) &&
  !/十天后日历记录/.test(await ev(`document.querySelector('#view').textContent`)));

/* 7. 今日直接打勾：打卡 / 循环 / 项目 / 提醒 */
await ev(`document.querySelector('#view .task[data-id="habit1"] input[data-action="toggle"]').click()`);
await wait(1000);
ok('7a 今日可直接打卡', await ev(`(() => { const c = window.__mock.files()['checkins.json'] || [];
  return c.some((x) => x.date === '${dates.t}' && (x.done || []).indexOf('habit1') >= 0); })()`));
await ev(`document.querySelector('#view .task[data-id="loop1"] input[data-action="toggle"]').click()`);
await wait(1000);
const loopDone = await remoteOne('loop1');
ok('7b 今日可直接勾循环任务', loopDone && (loopDone.doneWeeks || []).length === 1, loopDone);
await ev(`document.querySelector('#view .task[data-id="plan-soon"] input[data-action="plan-done"]').click()`);
await wait(1000);
ok('7c 今日可直接完成项目', ((await remoteOne('plan-soon')) || {}).done === true);
await ev(`document.querySelector('#today-timers .timer-item[data-src-key="memo:memo"] input[data-action="timer-toggle"]').click()`);
await wait(1200);
ok('7d 琐事提醒打勾后从原白纸删除',
  !/交房租/.test(((await remoteOne('memo1')) || {}).memo || ''));
await ev(`document.querySelector('#today-timers .timer-item[data-src-key="day:${dates.t}"] input[data-action="timer-toggle"]').click()`);
await wait(1200);
const dayAfterTick = (await remoteTasks()).find((x) => x.kind === 'daypaper' && x.date === dates.t);
ok('7e 日程提醒打勾后从日程纸删除', dayAfterTick && !/下午准备周会/.test(dayAfterTick.memo || ''), dayAfterTick);

/* 8. 刷新后保持，且没有 JS 报错 */
await load(URL_);
await wait(2200);
ok('8a 刷新后导航仍是新版', (await ev(`document.querySelectorAll('.nav-group').length`)) === 3);
ok('8b 刷新后娱乐数据仍在', /今晚看一部电影/.test(await ev(`(() => {
  const f = (window.__mock.files()['tasks.json'] || []).find((x) => x.kind === 'fun');
  return f ? f.memo : '';
})()`)));
ok('8c 刷新后日历记录仍在', (await remoteTasks()).filter((x) => x.kind === 'calendar_note').length >= 2);
ok('8d 全程无 JS 报错', errors.length === 0, errors.slice(0, 3));

dump();
process.exit(R.every((r) => r.pass) ? 0 : 1);
