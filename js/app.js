/* V2 UI 层：今日聚合 + 公司(今日/明日) + 计划(排序/紧急) + 自律(每日/每周) + 效率(二期占位) + 设置 */
(function () {
  'use strict';
  const Core = window.Core;
  const Cfg = window.TS_CONFIG;
  const $ = (s) => document.querySelector(s);
  const today = Core.todayStr;
  const esc = (s) => String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

  const store = new window.Store(Cfg);
  let current = 'today';
  let editingId = null;
  let noteTargetId = null;
  let dragId = null;
  let lastStatus = { text: '连接中…' };

  const items = () => store.files.tasks.value || [];
  const checkins = () => store.files.checkins.value || [];
  const settingsObj = () => store.files.settings.value || { devices: {} };
  const myDevice = () => settingsObj().devices[store.deviceId] || {};
  const byId = (id) => items().find((t) => t.id === id);

  const itemOfKind = (kind) => items().filter((t) => t.kind === kind);
  const workUndone = () => itemOfKind('work').filter((t) => !t.done && (!t.due || t.due >= today()));
  const activePlans = () => itemOfKind('plan').filter((t) => Core.planState(t, today()).active);
  const habitsAction = () => {
    const d = today();
    const c = checkins();
    return itemOfKind('habit').filter((t) => {
      const st = Core.habitOn(t, d, c);
      return st && !st.done;
    }).length;
  };

  /* ---------- 提示 ---------- */
  let toastTimer = null;
  function toast(msg, ms) {
    const t = $('#toast');
    t.textContent = msg;
    t.classList.remove('hidden');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.add('hidden'), ms || 2600);
  }
  function confirmDialog(title, text) {
    return new Promise((resolve) => {
      $('#confirm-title').textContent = title;
      $('#confirm-text').textContent = text;
      $('#confirm-backdrop').classList.remove('hidden');
      const ok = $('#confirm-ok'), cancel = $('#confirm-cancel');
      const done = (v) => {
        $('#confirm-backdrop').classList.add('hidden');
        ok.removeEventListener('click', onOk);
        cancel.removeEventListener('click', onCancel);
        resolve(v);
      };
      const onOk = () => done(true), onCancel = () => done(false);
      ok.addEventListener('click', onOk);
      cancel.addEventListener('click', onCancel);
    });
  }

  /* ---------- 打勾 ---------- */
  function setWorkDone(item, done) {
    const d = today();
    const cur = !!item.done;
    if (cur === done) return;
    store.saveTask(Object.assign({}, item, {
      done,
      doneDate: done ? d : null,
      updatedAt: new Date().toISOString()
    }));
  }
  function setHabitDaily(item, on) {
    const d = today();
    const ids = Core.doneIdsFor(checkins(), d).filter((x) => x !== item.id);
    if (on) ids.push(item.id);
    store.setChecked(d, ids);
  }
  function setHabitWeekly(item, on) {
    const d = today();
    const wk = Core.weekKey(d);
    const set = (Array.isArray(item.weeksDone) ? item.weeksDone.slice() : []);
    const i = set.indexOf(wk);
    if (on && i < 0) set.push(wk);
    if (!on && i >= 0) set.splice(i, 1);
    set.sort();
    store.saveTask(Object.assign({}, item, {
      weeksDone: set,
      updatedAt: new Date().toISOString()
    }));
  }

  /* ---------- 渲染小件 ---------- */
  function chip(text, cls) {
    return '<span class="chip ' + (cls || '') + '">' + esc(text) + '</span>';
  }
  function notesHTML(item, limit) {
    const notes = (item.notes || []).slice();
    const show = limit ? notes.slice(-limit) : notes;
    if (!show.length) return '';
    const more = notes.length > show.length ? '<div class="note-more">…共 ' + notes.length + ' 条进展</div>' : '';
    return '<div class="notes">' +
      show.map((n) => '<div class="note-line"><i>' + esc(n.date || '') + '</i>' + esc(n.text) + '</div>').join('') +
      more + '</div>';
  }
  function rowActions(item, extra) {
    return '<button class="mini-btn" type="button" data-action="note" data-id="' + item.id + '">＋进展</button>' +
      '<button class="mini-btn" type="button" data-action="edit" data-id="' + item.id + '">✎</button>' +
      (extra || '');
  }
  function cbHTML(id, done, date) {
    return '<label class="cb">' +
      '<input type="checkbox" data-action="toggle" data-id="' + id + '" data-date="' + date + '"' + (done ? ' checked' : '') + ' />' +
      '<span class="box"></span></label>';
  }
  function cardHTML(item, opts) {
    const o = opts || {};
    const body =
      '<div class="task-main" data-action="edit" data-id="' + item.id + '">' +
        '<div class="task-title">' + esc(item.title) + '</div>' +
        '<div class="task-meta">' + (o.chips || []).map((c) => chip(c.text, c.cls)).join('') + '</div>' +
      '</div>';
    const cb = o.check ? cbHTML(item.id, o.done, o.date) : '';
    return '<div class="task ' + (o.done ? 'is-done' : '') + (o.hot ? ' is-hot' : '') + '" data-id="' + item.id + '">' +
      (o.handle ? '<span class="drag-handle" title="拖动排序">⋮⋮</span>' : '') +
      cb + body + '<div class="row-act">' + rowActions(item, o.extraActions || '') + '</div></div>' +
      (o.showNotes !== false ? notesHTML(item, o.limitNotes || 4) : '');
  }
  function section(title, body, extra) {
    return '<section class="card"><h3>' + esc(title) + '</h3>' + (extra || '') + body + '</section>';
  }
  function emptyBox(text) {
    return '<div class="empty">' + esc(text) + '</div>';
  }
  function chipClsFor(kind) {
    return kind === 'work' ? 'm-work' : kind === 'plan' ? 'm-plan' : 'm-life';
  }

  /* ---------- 公司 ---------- */
  function workRows() {
    const d = today();
    const tod = [], tmw = [], later = [], done = [];
    itemOfKind('work').forEach((t) => {
      const w = Core.workStatus(t, d);
      const row = (list, chips) => {
        const c = (w.overdue ? [{ text: '逾期', cls: 'warn' }] : []).concat(chips);
        if (t.due) c.push({ text: w.bucket === 'later' || w.bucket === 'tomorrow' ? t.due : (w.overdue ? '原定 ' + t.due : '今天'), cls: 'dim' });
        list.push(cardHTML(t, { check: true, done: false, date: d, hot: !!w.overdue, chips: c, showNotes: false, extraActions: '' }));
      };
      if (w.bucket === 'today') row(tod, []);
      else if (w.bucket === 'tomorrow') row(tmw, []);
      else if (w.bucket === 'later') row(later, [{ text: '更晚', cls: 'dim' }]);
      else if (w.bucket === 'done') {
        done.push(cardHTML(t, { check: true, done: true, date: d, chips: [{ text: t.doneDate === d ? '今日完成' : '已完成 ' + (t.doneDate || ''), cls: 'ok' }], showNotes: false }));
      }
    });
    const sortDue = (a, b) => { const x = byIdOf(a), y = byIdOf(b); const dx = x.due || '', dy = y.due || ''; return dx < dy ? -1 : dx > dy ? 1 : 0; };
    function byIdOf(html) { return html.match(/data-id="([^"]+)"/)[1]; }
    return { today: tod.sort(sortDue), tomorrow: tmw.sort(sortDue), later: later.sort(sortDue), done };
  }

  /* ---------- 计划排序 ---------- */
  function planOrdered() {
    const d = today();
    const acts = [], done = [], arch = [];
    itemOfKind('plan').forEach((t) => {
      const st = Core.planState(t, d);
      if (st.bucket === 'done') done.push({ item: t, st });
      else if (st.bucket === 'archived') arch.push({ item: t, st });
      else acts.push({ item: t, st });
    });
    const cmp = (a, b) => {
      if (a.st.urgent !== b.st.urgent) return a.st.urgent ? -1 : 1;
      const ra = a.item.rank != null ? a.item.rank : Infinity;
      const rb = b.item.rank != null ? b.item.rank : Infinity;
      if (ra !== rb) return ra - rb;
      return a.item.created < b.item.created ? -1 : 1;
    };
    acts.sort(cmp);
    return { active: acts, done: done.sort((a, b) => (a.item.doneDate || '') > (b.item.doneDate || '') ? -1 : 1), archived: arch };
  }
  function planCard(e) {
    const t = e.item, st = e.st;
    const chips = [];
    chips.push({ text: Core.kindLabel('plan'), cls: chipClsFor('plan') });
    if (t.rangeStart || t.rangeEnd) {
      chips.push({ text: (t.rangeStart || '?') + ' → ' + (t.rangeEnd || '持续'), cls: 'dim' });
    }
    if (st.urgent) chips.push({ text: '紧急 · 最后 ' + Math.max(0, Core.dayDiff(today(), t.rangeEnd)) + ' 天', cls: 'warn' });
    if (t.rangeEnd && t.rangeEnd === today() && !st.urgent && st.active) chips.push({ text: '今天截止', cls: 'dim' });
    const doneBtn = st.bucket !== 'done'
      ? '<button class="mini-btn ok-mini" type="button" data-action="plan-done" data-id="' + t.id + '">完成</button>'
      : '<button class="mini-btn" type="button" data-action="plan-done" data-id="' + t.id + '">恢复</button>';
    return cardHTML(t, { check: false, chips, showNotes: false, extraActions: doneBtn, hot: st.urgent });
  }
  function nextRank() {
    let mx = 0;
    itemOfKind('plan').forEach((t) => { if (t.rank != null && t.rank > mx) mx = t.rank; });
    return mx + 1;
  }

  /* ---------- 自律 ---------- */
  function habitRow(item, date, checkins) {
    const st = Core.habitOn(item, date, checkins);
    if (!st) return '';
    const chips = [];
    chips.push({ text: st.kind === 'daily' ? '每日' : '每周 · 自 ' + item.created, cls: st.kind === 'daily' ? 'm-life' : 'dim' });
    if (st.kind === 'weekly') {
      chips.push({ text: st.done ? '本周已勾' : '本周待勾', cls: st.done ? 'ok' : 'warn' });
    }
    const hot = st.kind === 'daily' && item.freq === 'daily' && !st.done;
    return cardHTML(item, { check: true, done: st.done, date, chips, showNotes: false, hot, extraActions: '' });
  }

  /* ---------- 今日首页 ---------- */
  function renderToday() {
    const d = today();
    const te = Core.todayEntries(items(), checkins(), d);
    const pct = te.total ? Math.round((te.done / te.total) * 100) : 0;
    const workRowsHtml = te.work.map((e) => {
      const chips = [];
      if (e.overdue) chips.push({ text: '逾期自动顺延', cls: 'warn' });
      if (e.item.due) chips.push({ text: e.item.due, cls: 'dim' });
      chips.push({ text: '公司', cls: 'm-work' });
      return cardHTML(e.item, { check: true, done: e.done, date: d, chips, showNotes: false, hot: e.overdue && !e.done });
    }).join('');
    const habitHtml = te.habits.map((e) => {
      const chips = [{ text: '自律 · 每日', cls: 'm-life' }];
      if (e.missed) chips.push({ text: '昨日未打勾', cls: 'warn' });
      return cardHTML(e.item, { check: true, done: e.done, date: d, chips, showNotes: false, hot: e.missed && !e.done });
    }).join('');
    return section('今日效率', '<div class="progress">' +
      '<div class="progress-head"><span>' + Core.fmtCN(d) + '</span>' +
      '<span class="stat">' + (te.total ? te.done + '/' + te.total + ' · ' + pct + '%' : '今日无安排') +
      (te.streak ? ' · 🔥 连续 ' + te.streak + ' 天' : '') + '</span></div>' +
      (te.total ? '<div class="bar"><i style="width:' + pct + '%"></i></div>' : '') + '</div>') +
      (te.work.length ? section('公司 · 今日到期（逾期自动顺延）', workRowsHtml) : '') +
      (te.habits.length ? section('自律 · 今日要勾（漏勾昨日会红字顺延）', habitHtml) : '') +
      (!te.total ? '<section class="card"><p class="hint">今天没有安排。点右上「＋新建」，或在 公司/自律 模块添加条目。</p></section>' : '');
  }

  /* ---------- 各模块页 ---------- */
  function renderWork() {
    const b = workRows();
    let html = '';
    if (b.today.length) html += section('今日 · ' + b.today.length + '（逾期自动顺延到今天）', b.today.join(''));
    else html += '<section class="card"><p class="hint">今日无事。点「＋新建」添加到期日=今天的公司条目。</p></section>';
    if (b.tomorrow.length) html += section('明日 · ' + b.tomorrow.length + '（到点自动滚入今日）', b.tomorrow.join(''));
    if (b.later.length) html += section('更晚 · ' + b.later.length, b.later.join(''));
    if (b.done.length) html += section('已完成 · ' + b.done.length, b.done.join(''));
    return html;
  }

  function renderPlan() {
    const d = today();
    const g = planOrdered();
    const urg = g.active.filter((e) => e.st.urgent);
    const norm = g.active.filter((e) => !e.st.urgent);
    const card = (e) => planCard(e);
    const board = urg.map(card).concat(norm.map(card)).join('') ||
      emptyBox('顶部为空：在下方写一条计划方向，会自动同步到这里。');
    let html = '<section class="card plan-board-card"><h3>优先级排序 · 可拖动' +
      (urg.length ? ' <span class="urgent-note">' + urg.length + ' 条紧急</span>' : '') + '</h3>' +
      '<div class="plan-board" id="plan-board">' + board + '</div></section>';
    html += '<section class="card plan-new-card"><h3>写计划方向（自动同步到上方排序表）</h3>' +
      '<div class="field"><input id="p-title" type="text" maxlength="120" placeholder="大的计划方向，如：2026 Q4 换工作" /></div>' +
      '<div class="field-row">' +
      '<label class="field"><span>开始</span><input id="p-start" type="date" /></label>' +
      '<label class="field"><span>结束（最后 10 天自动置顶“紧急”）</span><input id="p-end" type="date" /></label></div>' +
      '<div class="actions-row"><button class="btn btn-primary" id="btn-plan-add" type="button">＋ 添加方向</button>' +
      '<span class="hint">剩余 ' + g.active.length + ' 条进行中</span></div></section>';
    if (g.active.length) {
      html += '<section class="card"><h3>全部进行中 · ' + g.active.length + '（点开可看/补进展）</h3>' + g.active.map(card).join('') + '</section>';
    }
    if (g.archived.length) html += section('已结束（改结束日期可恢复）· ' + g.archived.length, g.archived.map(card).join(''), '');
    if (g.done.length) html += section('已完成 · ' + g.done.length, g.done.map(card).join(''), '');
    return html;
  }

  function renderDisc() {
    const d = today();
    const c = checkins();
    const daily = itemOfKind('habit').filter((t) => t.freq === 'daily')
      .sort((a, b) => (a.created < b.created ? -1 : 1)).map((t) => habitRow(t, d, c)).join('');
    const weekly = itemOfKind('habit').filter((t) => t.freq === 'weekly')
      .sort((a, b) => (a.created < b.created ? -1 : 1)).map((t) => habitRow(t, d, c)).join('');
    const wkStart = Core.weekKey(d);
    return section('日打勾', '<p class="hint">每天都要勾；昨天漏勾的会自动顺延到今天并标红「昨日未打勾」。</p>' +
      (daily || emptyBox('还没有每日习惯。点「＋新建」，类型选 自律、频率选 每日。'))) +
      section('周打勾 · 本周自 ' + wkStart, '<p class="hint">自然周（周一起）内勾一次即完成，下周一自动重置。</p>' +
        (weekly || emptyBox('还没有每周习惯。点「＋新建」，类型选 自律、频率选 每周。')));
  }

  function renderEff() {
    const d = myDevice();
    const def = Cfg.defaults;
    const wake = d.wakeTime || def.wakeTime;
    const sleep = d.sleepTime || def.sleepTime;
    const wOn = d.wakeEnabled !== undefined ? d.wakeEnabled : def.wakeEnabled;
    const sOn = d.sleepEnabled !== undefined ? d.sleepEnabled : def.sleepEnabled;
    return section('效率 · 早睡早起', '<p class="hint">第二阶段功能：声音由 iPhone 系统闹钟/提醒负责（稳定可靠）。本页先放设置状态与入口。</p>' +
      '<div class="eff-row">' + (wOn ? '☀️ 早起闹钟 ' + esc(wake) : '☀️ 早起未启用') + '</div>' +
      '<div class="eff-row">' + (sOn ? '🌙 早睡提醒 ' + esc(sleep) + ' · 熄灯+听英语博客' : '🌙 早睡提醒未启用') + '</div>' +
      '<div class="actions-row"><button class="btn" type="button" data-tab-go="settings">去设置里改时间</button>' +
      '<span class="hint">音频导入步骤见仓库 DEPLOY.md</span></div>');
  }

  function renderSettings() {
    const dev = myDevice();
    const name = dev.deviceName || (store.deviceGuess + ' · ' + store.deviceId.slice(-4));
    const st = lastStatus;
    const hasToken = !!store.token;
    const def = Cfg.defaults;
    const d = settingsObj().devices[store.deviceId] || {};
    const wake = d.wakeTime || def.wakeTime;
    const sleep = d.sleepTime || def.sleepTime;
    const wOn = d.wakeEnabled !== undefined ? d.wakeEnabled : def.wakeEnabled;
    const sOn = d.sleepEnabled !== undefined ? d.sleepEnabled : def.sleepEnabled;
    return (
      '<section class="card"><h3>连接同步（每台设备各设一次）</h3>' +
      '<p class="hint">Token 只存在本机。在 GitHub 建只对 <b>' + esc(Cfg.owner + '/' + Cfg.repo) +
      '</b> 有 Contents 读写权限的 Fine-grained Token，粘贴即可，步骤见 DEPLOY.md。</p>' +
      '<div class="field"><input id="set-token" type="password" value="' + esc(store.token) + '" placeholder="github_pat_…" autocomplete="off" /></div>' +
      '<div class="actions-row"><button class="btn btn-primary" id="set-token-save" type="button">' + (hasToken ? '保存并测试' : '连接') + '</button>' +
      '<button class="btn" id="set-sync-now" type="button">立即同步</button>' +
      '<span class="hint">' + (hasToken ? '状态：' + esc(st.text) : '未连接') + '</span></div></section>' +
      '<section class="card"><h3>设备：' + esc(name) + '</h3>' +
      '<div class="field"><label><span>设备显示名</span><input id="set-devname" type="text" value="' + esc(name) + '" maxlength="30" /></label></div>' +
      '<div class="actions-row"><button class="btn" id="set-name-save" type="button">保存设备名</button></div></section>' +
      '<section class="card"><h3>效率 · 早睡早起（二期，iPhone 为主）</h3>' +
      '<div class="row"><label class="switch-line"><input id="set-wake-on" type="checkbox"' + (wOn ? ' checked' : '') + ' /> 早起闹钟</label>' +
      '<input id="set-wake-time" type="time" value="' + esc(wake) + '" /></div>' +
      '<div class="row"><label class="switch-line"><input id="set-sleep-on" type="checkbox"' + (sOn ? ' checked' : '') + ' /> 早睡提醒</label>' +
      '<input id="set-sleep-time" type="time" value="' + esc(sleep) + '" /></div>' +
      '<div class="actions-row"><button class="btn btn-primary" id="set-alarm-save" type="button">保存</button>' +
      '<span class="hint">音频文件名（如 morning.mp3）可在 DEPLOY.md 第 3 步配置</span></div></section>' +
      '<section class="card danger-zone"><h3>本机数据</h3>' +
      '<div class="actions-row"><button class="btn" id="set-refresh" type="button">重新拉取云端</button>' +
      '<button class="btn btn-danger" id="set-clear" type="button">清空本机缓存</button></div>' +
      '<p class="hint">设备 ID：' + esc(store.deviceId) + '</p></section>'
    );
  }

  /* ---------- Tab ---------- */
  function tabBtn(id, label, badge, extra) {
    return '<button class="tab' + (current === id ? ' active' : '') + '" data-tab="' + id + '" type="button">' +
      label + (badge ? '<i>' + badge + '</i>' : '') + (extra || '') + '</button>';
  }
  function render() {
    $('#subline').textContent = lastStatus.text;
    const d = today();
    const te = Core.todayEntries(items(), checkins(), d);
    const todayBadge = te.total - te.done;
    const labels = [
      ['today', '今日', todayBadge || 0],
      ['work', '公司', workUndone().length],
      ['plan', '计划', activePlans().length],
      ['disc', '自律', habitsAction()],
      ['eff', '效率', 0],
      ['settings', '设置', 0]
    ];
    $('#tabs').innerHTML = labels.map((l) => tabBtn(l[0], l[1], l[2], '')).join('');
    $('#btn-new').textContent = '＋ 新建';
    const view = $('#view');
    if (current === 'today') view.innerHTML = renderToday();
    else if (current === 'work') view.innerHTML = renderWork();
    else if (current === 'plan') view.innerHTML = renderPlan();
    else if (current === 'disc') view.innerHTML = renderDisc();
    else if (current === 'eff') view.innerHTML = renderEff();
    else view.innerHTML = renderSettings();
    bindDynamicEvents();
  }

  /* ---------- 弹窗：新建/编辑 ---------- */
  function kindOfCurrent() {
    if (current === 'work') return 'work';
    if (current === 'disc') return 'habit';
    if (current === 'plan') return 'plan';
    return 'work'; // 今日 / 效率 / 设置 默认公司
  }
  function openItemModal(presetKind, item) {
    editingId = item ? item.id : null;
    const kind = item ? item.kind : presetKind;
    $('#modal-title').textContent = item ? '编辑' : '新建';
    $('#f-title').value = item ? item.title : '';
    $('#f-kind').value = kind;
    $('#f-kind').disabled = !!item;
    $('#f-note').value = '';
    $('#f-note-label').textContent = item ? '备注（可留空）' : '首条备注（可选）';
    $('#f-due').value = item && item.due ? item.due : today();
    $('#f-range-start').value = item && item.rangeStart ? item.rangeStart : '';
    $('#f-range-end').value = item && item.rangeEnd ? item.rangeEnd : '';
    $('#f-freq').value = item && item.freq ? item.freq : 'daily';
    applyKindFields(kind);
    $('#btn-delete-task').classList.toggle('hidden', !item);
    $('#modal-backdrop').classList.remove('hidden');
    $('#f-title').focus();
  }
  function applyKindFields(kind) {
    const kw = kind === 'work', kp = kind === 'plan', kh = kind === 'habit';
    document.querySelectorAll('.fg-work').forEach((el) => el.classList.toggle('hidden', !kw));
    document.querySelectorAll('.fg-plan').forEach((el) => el.classList.toggle('hidden', !kp));
    document.querySelectorAll('.fg-habit').forEach((el) => el.classList.toggle('hidden', !kh));
  }
  function closeItemModal() {
    $('#modal-backdrop').classList.add('hidden');
    editingId = null;
  }
  function buildFromForm(kind) {
    const old = editingId ? byId(editingId) : null;
    const title = $('#f-title').value.trim();
    if (!title) { toast('标题不能为空'); return null; }
    const note = $('#f-note').value.trim();
    let next;
    if (kind === 'work') {
      next = Object.assign({}, old || Core.newItem({ kind: 'work' }), {
        title,
        due: $('#f-due').value || today(),
        updatedAt: new Date().toISOString()
      });
    } else if (kind === 'plan') {
      const base = old ? JSON.parse(JSON.stringify(old)) : Core.newItem({ kind: 'plan' });
      const rangeStart = $('#f-range-start').value || null;
      const rangeEnd = $('#f-range-end').value || null;
      if (!old && !rangeStart) base.rangeStart = today();
      if (!old && base.rank == null) base.rank = nextRank();
      next = Object.assign(base, { title, rangeStart, rangeEnd, updatedAt: new Date().toISOString() });
    } else {
      const base = old ? JSON.parse(JSON.stringify(old)) : Core.newItem({ kind: 'habit' });
      next = Object.assign(base, { title, freq: $('#f-freq').value, updatedAt: new Date().toISOString() });
    }
    if (note) {
      const r = Core.addNote(next, note);
      if (r.changed) next = r.item;
    }
    return next;
  }

  /* ---------- 记一笔 ---------- */
  function openNote(item) {
    noteTargetId = item.id;
    $('#note-title').textContent = '补一条进展：' + item.title;
    $('#note-text').value = '';
    $('#note-backdrop').classList.remove('hidden');
    $('#note-text').focus();
  }
  function closeNote() { $('#note-backdrop').classList.add('hidden'); noteTargetId = null; }

  /* ---------- 计划拖拽 ---------- */
  function bindPlanDrag() {
    const board = $('#plan-board');
    if (!board) return;
    board.querySelectorAll('.task[data-id]').forEach((row) => {
      row.draggable = true;
      row.addEventListener('dragstart', (e) => {
        dragId = row.dataset.id;
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', row.dataset.id);
        row.classList.add('dragging');
      });
      row.addEventListener('dragend', () => { dragId = null; row.classList.remove('dragging'); });
      row.addEventListener('dragover', (e) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        row.classList.add('drag-over');
      });
      row.addEventListener('dragleave', () => row.classList.remove('drag-over'));
      row.addEventListener('drop', (e) => {
        e.preventDefault();
        row.classList.remove('drag-over');
        const srcId = dragId || e.dataTransfer.getData('text/plain');
        const tgtId = row.dataset.id;
        if (!srcId || srcId === tgtId) return;
        const ids = Array.prototype.map.call(board.querySelectorAll('.task[data-id]'), (r) => r.dataset.id);
        const from = ids.indexOf(srcId);
        const to = ids.indexOf(tgtId);
        if (from < 0 || to < 0) return;
        ids.splice(from, 1);
        ids.splice(to, 0, srcId);
        const ranks = {};
        ids.forEach((id, i) => { ranks[id] = i + 1; });
        store.setRanks(ranks);
      });
    });
  }

  /* 每次渲染后绑定本页动态按钮（节点已被替换，不会重复） */
  function bindDynamicEvents() {
    const b = $('#btn-plan-add');
    if (b) b.addEventListener('click', () => {
      const title = $('#p-title').value.trim();
      if (!title) return toast('先写计划方向标题');
      const it = Core.newItem({
        kind: 'plan',
        title,
        rangeStart: $('#p-start').value || today(),
        rangeEnd: $('#p-end').value || null,
        rank: nextRank()
      });
      store.saveTask(it);
      $('#p-title').value = '';
      $('#p-start').value = '';
      $('#p-end').value = '';
      toast('已添加，已同步到上方排序表');
    });
    bindPlanDrag();
    const s1 = $('#set-token-save'); if (s1) s1.addEventListener('click', saveToken);
    const s2 = $('#set-name-save'); if (s2) s2.addEventListener('click', () => {
      const n = $('#set-devname').value.trim();
      if (!n) return toast('名称不能为空');
      store.patchSettings({ deviceName: n });
      toast('已保存设备名');
      render();
    });
    const s3 = $('#set-alarm-save'); if (s3) s3.addEventListener('click', () => {
      store.patchSettings({
        deviceName: $('#set-devname').value.trim() || store.deviceGuess,
        wakeEnabled: $('#set-wake-on').checked,
        wakeTime: $('#set-wake-time').value || Cfg.defaults.wakeTime,
        sleepEnabled: $('#set-sleep-on').checked,
        sleepTime: $('#set-sleep-time').value || Cfg.defaults.sleepTime,
        audioFile: (myDevice().audioFile || 'morning.mp3')
      });
      toast('闹钟设置已保存并同步');
      render();
    });
    const s4 = $('#set-sync-now'); if (s4) s4.addEventListener('click', async () => {
      await store.flush();
      await store.refresh(false).catch((e) => toast('同步失败：' + e.message, 3500));
      toast('已同步');
    });
    const s5 = $('#set-refresh'); if (s5) s5.addEventListener('click', async () => {
      await store.refresh(false).catch((e) => toast('刷新失败：' + e.message, 3500));
      toast('已拉取最新数据');
    });
    const s6 = $('#set-clear'); if (s6) s6.addEventListener('click', async () => {
      const ok = await confirmDialog('清空本机缓存', '会删除本机离线数据与待同步队列（云端不受影响），Token 保留。继续？');
      if (!ok) return;
      store.clearLocal();
      location.reload();
    });
  }
  async function saveToken() {
    const t = $('#set-token').value.trim();
    store.token = t;
    if (!t) { store.setStatus('idle', '未连接'); render(); return; }
    store.setStatus('syncing', '测试连接…');
    try {
      await store.testConnection();
      await store.flush();
      await store.refresh(true);
      toast('连接成功，数据已同步');
      render();
    } catch (err) {
      store.setStatus('error', err.message, new Date());
      toast('连接失败：' + err.message, 4000);
      render();
    }
  }

  /* ---------- 全局事件（一次绑定） ---------- */
  function onViewClick(e) {
    const tabEl = e.target.closest('[data-tab]');
    if (tabEl) { current = tabEl.dataset.tab; render(); return; }
    const go = e.target.closest('[data-tab-go]');
    if (go) { current = go.dataset.tabGo; render(); return; }
    const act = e.target.closest('[data-action]');
    if (act) {
      const action = act.dataset.action;
      const id = act.dataset.id;
      const item = id ? byId(id) : null;
      if (action === 'toggle' && item) {
        const input = act.tagName === 'INPUT' ? act : null;
        const on = !!input.checked;
        if (item.kind === 'habit') {
          if (item.freq === 'weekly') setHabitWeekly(item, on);
          else setHabitDaily(item, on);
        } else {
          setWorkDone(item, on);
          if (on) toast('已完成 ✓');
        }
        return;
      }
      if (action === 'edit' && item) { openItemModal(item.kind, item); return; }
      if (action === 'note' && item) { openNote(item); return; }
      if (action === 'plan-done' && item) {
        const d = today();
        const was = !!item.done;
        store.saveTask(Object.assign({}, item, { done: !was, doneDate: was ? null : d, updatedAt: new Date().toISOString() }));
        toast(was ? '已恢复为进行中' : '已完成，归档');
        return;
      }
    }
    if (e.target.closest('[data-close]')) closeItemModal();
    if (e.target.closest('[data-note-close]')) closeNote();
  }

  /* ---------- 启动 ---------- */
  Core.KINDS.forEach((k) => {
    const o = document.createElement('option');
    o.value = k.id; o.textContent = k.label + '（' + (k.id === 'work' ? '今日/明日' : k.id === 'plan' ? '方向+时间范围' : '每日/每周') + '）';
    $('#f-kind').appendChild(o);
  });
  Core.FREQS.forEach((f) => {
    const o = document.createElement('option');
    o.value = f.id; o.textContent = f.label;
    $('#f-freq').appendChild(o);
  });

  document.addEventListener('click', onViewClick);
  $('#task-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const kind = $('#f-kind').value;
    const next = buildFromForm(kind);
    if (!next) return;
    const isNew = !editingId;
    store.saveTask(next);
    closeItemModal();
    render();
    toast(isNew ? '已创建' : '已保存');
  });
  $('#note-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const item = noteTargetId ? byId(noteTargetId) : null;
    if (!item) return closeNote();
    const r = Core.addNote(item, $('#note-text').value);
    closeNote();
    if (r.changed) {
      store.saveTask(r.item);
      toast('进展已记录');
    }
  });
  $('#btn-delete-task').addEventListener('click', async () => {
    if (!editingId) return;
    const item = byId(editingId);
    if (!item) return closeItemModal();
    const ok = await confirmDialog('删除', '确定删除「' + item.title + '」？进度备注会一并删除。');
    if (!ok) return;
    store.deleteTask(item.id);
    closeItemModal();
    render();
    toast('已删除');
  });
  $('#btn-new').addEventListener('click', () => openItemModal(kindOfCurrent(), null));
  $('#btn-sync').addEventListener('click', async () => {
    await store.flush();
    await store.refresh(false).catch(() => {});
    toast('已同步');
  });
  $('#task-form').addEventListener('change', (e) => {
    if (e.target && e.target.id === 'f-kind') applyKindFields(e.target.value);
  });
  $('#modal-backdrop').addEventListener('click', (e) => { if (e.target === e.currentTarget) closeItemModal(); });
  $('#note-backdrop').addEventListener('click', (e) => { if (e.target === e.currentTarget) closeNote(); });

  store.onStatus = (st) => { lastStatus = st; $('#subline').textContent = st.text; };
  store.onChange = () => render();
  render();
  store.init();
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('./sw.js').catch(() => {});
  }
})();
