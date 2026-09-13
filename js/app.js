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
  let noteDragZone = null;
  let noteDragIndex = -1;
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
  /* 进展流水：最新一条在最上面，展示时间（今天/昨天/日期 + 时刻） */
  function noteLineHTML(item, entry, num) {
    const n = entry.note;
    return '<div class="note-line" data-id="' + item.id + '" data-note-index="' + entry.index + '">' +
      '<span class="note-drag" title="按住拖动排序">⋮⋮</span>' +
      '<b class="note-num">' + num + '</b>' +
      '<i class="note-time">' + esc(Core.fmtNoteTime(n, today())) + '</i>' +
      '<span class="note-text">' + esc(n.text) + '</span>' +
      '<button class="note-mv" type="button" data-action="note-up" data-id="' + item.id + '" data-idx="' + entry.index + '" title="上移">▲</button>' +
      '<button class="note-mv" type="button" data-action="note-down" data-id="' + item.id + '" data-idx="' + entry.index + '" title="下移">▼</button>' +
      '<button class="note-del" type="button" data-action="note-del" data-id="' + item.id + '" data-idx="' + entry.index + '" title="删除这条进展">✕</button>' +
      '</div>';
  }
  function notesBody(item) {
    return Core.orderedNotes(item).map((e, i) => noteLineHTML(item, e, i + 1)).join('');
  }
  function notesZoneHTML(item) {
    const count = (item.notes || []).length;
    if (!count) return '<div class="notes-zone empty-notes">还没有进展，第一条写在下面 ↓</div>';
    return '<div class="notes-zone" data-notes-for="' + item.id + '">' +
      '<div class="notes-count">共 ' + count + ' 条进展 · 序号 1 在最上 · 可拖动排序</div>' + notesBody(item) + '</div>';
  }
  function notesListHTML(item) {
    const count = (item.notes || []).length;
    if (!count) return '';
    return '<div class="notes-zone notes-plain" data-notes-for="' + item.id + '">' +
      '<div class="notes-count">共 ' + count + ' 条进展 · 序号 1 在最上</div>' + notesBody(item) + '</div>';
  }
  function noteInputHTML(id) {
    return '<form class="note-inline" data-id="' + id + '">' +
      '<input type="text" maxlength="300" placeholder="记一条进展，回车保存（自动带时间）…" />' +
      '<button type="submit">记下</button></form>';
  }
  function rowActions(item, extra, showNoteBtn, minimal) {
    if (minimal) {
      return (extra || '') +
        '<button class="mini-btn" type="button" data-action="edit" data-id="' + item.id + '">✎</button>';
    }
    return (showNoteBtn ? '<button class="mini-btn" type="button" data-action="note" data-id="' + item.id + '">＋进展</button>' : '') +
      '<button class="mini-btn" type="button" data-action="edit" data-id="' + item.id + '">✎</button>' +
      (extra || '');
  }
  /* 已打勾：统一移到底部；宽屏多列紧凑排列，手机端单列 */
  function doneGrid(rows) {
    if (!rows.length) return '';
    return '<div class="done-sep">已完成 · ' + rows.length + ' 条 · 已移至底部</div>' +
      '<div class="done-grid">' + rows.join('') + '</div>';
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
    const badge = o.badge != null
      ? '<span class="row-badge' + (o.badgeCls ? ' ' + o.badgeCls : '') + '">' + esc(String(o.badge)) + '</span>'
      : '';
    const row = '<div class="task ' + (o.done ? 'is-done' : '') + (o.hot ? ' is-hot' : '') + (o.softGreen ? ' is-soft-green' : '') + (o.compact ? ' is-compact' : '') + '" data-id="' + item.id + '">' +
      (o.handle ? '<span class="drag-handle" title="拖动排序">⋮⋮</span>' : '') + badge +
      cb + body + '<div class="row-act">' + rowActions(item, o.extraActions || '', !o.notesZone, o.minimal) + '</div></div>';
    if (o.notesZone) {
      if (o.compact) return row;
      return '<div class="item-card' + (o.hot ? ' is-hot' : '') + (o.softGreen ? ' is-soft-green' : '') + '" data-id="' + item.id + '">' +
        row + notesZoneHTML(item) + noteInputHTML(item.id) + '</div>';
    }
    return row + (!o.compact && o.notesList ? notesListHTML(item) : '');
  }
  function section(title, body, extra, cls) {
    return '<section class="card ' + (cls || '') + '"><h3>' + esc(title) + '</h3>' + (extra || '') + body + '</section>';
  }
  function emptyBox(text) {
    return '<div class="empty">' + esc(text) + '</div>';
  }
  function goBtn(tab, label) {
    return '<button class="link-btn" type="button" data-tab-go="' + tab + '">' + esc(label) + ' →</button>';
  }
  function emptyLine(text, tab, label) {
    return '<div class="empty-line"><span>' + esc(text) + '</span>' + (tab ? goBtn(tab, label) : '') + '</div>';
  }
  function statPill(label, n, cls) {
    return '<span class="stat-pill ' + (cls || '') + (n ? '' : ' is-zero') + '"><b>' + n + '</b>' + esc(label) + '</span>';
  }
  function countIn(title, n) {
    return title + ' · ' + n + ' 条';
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
        list.push(cardHTML(t, { check: true, done: false, date: d, hot: !!w.overdue, chips: c, notesZone: true }));
      };
      if (w.bucket === 'today') row(tod, []);
      else if (w.bucket === 'tomorrow') row(tmw, []);
      else if (w.bucket === 'later') row(later, [{ text: '更晚', cls: 'dim' }]);
      else if (w.bucket === 'done') {
        done.push(cardHTML(t, { check: true, done: true, date: d, compact: true, minimal: true, chips: [{ text: t.doneDate === d ? '今日完成' : '已完成 ' + (t.doneDate || ''), cls: 'ok' }] }));
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
  function planCard(e, compact, badge, minimal) {
    const t = e.item, st = e.st;
    const isMini = minimal != null ? minimal : !!compact;
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
    return cardHTML(t, {
      check: false, chips, extraActions: doneBtn, hot: !compact && st.urgent,
      notesZone: !compact && !isMini, compact: !!compact, minimal: isMini,
      badge: badge != null ? badge : null, badgeCls: st.urgent ? 'is-urgent' : ''
    });
  }
  function nextRank() {
    let mx = 0;
    itemOfKind('plan').forEach((t) => { if (t.rank != null && t.rank > mx) mx = t.rank; });
    return mx + 1;
  }

  /* ---------- 自律 ---------- */
  function habitRow(item, date, checkins, opts) {
    const st = Core.habitOn(item, date, checkins);
    if (!st) return '';
    const o = opts || {};
    const chips = [];
    chips.push({ text: st.kind === 'daily' ? '每日' : '每周 · 自 ' + item.created, cls: st.kind === 'daily' ? 'm-life' : 'dim' });
    if (st.kind === 'weekly') {
      chips.push({ text: st.done ? '本周已勾' : '本周待勾', cls: st.done ? 'ok' : 'warn' });
    }
    const softGreen = st.kind === 'daily' && !st.done;
    return cardHTML(item, { check: true, done: st.done, date, chips, notesZone: !o.compact, softGreen, compact: !!o.compact, minimal: !!o.minimal });
  }
  /* 列表排序：未勾在上，已勾沉底；已勾紧凑显示 */
  function habitCards(list, d, c) {
    const rows = [];
    list.forEach((h) => { const st = Core.habitOn(h, d, c); if (st) rows.push({ h, done: st.done }); });
    rows.sort((a, b) => (a.done === b.done ? (a.h.created < b.h.created ? -1 : 1) : (a.done ? 1 : -1)));
    const pending = rows.filter((r) => !r.done).map((r) => habitRow(r.h, d, c)).join('');
    const done = rows.filter((r) => r.done);
    const doneHTML = doneGrid(done.map((r) => habitRow(r.h, d, c, { compact: true, minimal: true })));
    return pending + doneHTML;
  }

  /* ---------- 今日首页（公司 + 计划 + 自律 聚合） ---------- */
  function renderToday() {
    const d = today();
    const te = Core.todayEntries(items(), checkins(), d);
    const pct = te.total ? Math.round((te.done / te.total) * 100) : 0;

    const workRow = (e, compact) => {
      const chips = [];
      chips.push({ text: '公司', cls: 'm-work' });
      if (compact) return cardHTML(e.item, { check: true, done: true, date: d, chips, compact: true, minimal: true });
      if (e.overdue) chips.push({ text: '逾期自动顺延', cls: 'warn' });
      if (e.item.due) chips.push({ text: e.item.due, cls: 'dim' });
      return cardHTML(e.item, { check: true, done: e.done, date: d, chips, notesList: true, hot: e.overdue && !e.done });
    };
    const habitRowToday = (e, compact) => {
      const chips = [{ text: '自律 · 每日', cls: 'm-life' }];
      if (compact) return cardHTML(e.item, { check: true, done: true, date: d, chips, compact: true, minimal: true });
      if (e.missed) chips.push({ text: '昨日未打勾', cls: 'warn' });
      return cardHTML(e.item, { check: true, done: e.done, date: d, chips, notesList: true, softGreen: e.missed && !e.done });
    };
    /* 未勾在上，已勾移到最下面并紧凑显示 */
    const splitRows = (list, build) => {
      const pend = list.filter((e) => !e.done).map((e) => build(e, false)).join('');
      const done = list.filter((e) => e.done);
      return pend + doneGrid(done.map((e) => build(e, true)));
    };
    const workRowsHtml = splitRows(te.work, workRow);
    const habitHtml = splitRows(te.habits, habitRowToday);

    /* 计划：紧急优先，首页只摆前 5 条 */
    const plans = planOrdered().active;
    const planTop = plans.slice(0, 5);
    const planRowToday = (e) => {
      const t = e.item;
      const chips = [{ text: '计划', cls: 'm-plan' }];
      if (t.rangeStart || t.rangeEnd) chips.push({ text: (t.rangeStart || '?') + ' → ' + (t.rangeEnd || '持续'), cls: 'dim' });
      if (e.st.urgent) chips.push({ text: '紧急 · 剩 ' + Math.max(0, Core.dayDiff(d, t.rangeEnd)) + ' 天', cls: 'warn' });
      return cardHTML(t, { check: false, chips, notesList: true, hot: e.st.urgent });
    };
    const planHtml = planTop.map(planRowToday).join('') +
      (plans.length > planTop.length
        ? '<div class="more-line">还有 ' + (plans.length - planTop.length) + ' 条计划在进行中 ' + goBtn('plan', '去计划页') + '</div>'
        : '');

    const planCls = plans.some((e) => e.st.urgent) ? 'acc-red' : 'acc-amber';
    return section('今日效率', '<div class="progress">' +
      '<div class="progress-head"><span>' + Core.fmtCN(d) + '</span>' +
      '<span class="stat">' + (te.total ? te.done + '/' + te.total + ' · ' + pct + '%' : '今日无安排') +
      (te.streak ? ' · 🔥 连续 ' + te.streak + ' 天' : '') + '</span></div>' +
      (te.total ? '<div class="bar"><i style="width:' + pct + '%"></i></div>' : '') +
      '<div class="summary">' + statPill('公司今日', te.work.length, 's-blue') +
      statPill('计划进行中', plans.length, 's-amber') +
      statPill('自律今日', te.habits.length, 's-green') + '</div></div>') +
      section(countIn('公司 · 今日到期', te.work.length),
        workRowsHtml || emptyLine('今天没有到期的公司条目。', 'work', '去添加'), '', 'acc-blue') +
      section(countIn('计划 · 进行中', plans.length),
        planHtml || emptyLine('还没有进行中的计划方向。', 'plan', '去写一条'), '', planCls) +
      section(countIn('自律 · 今日要勾', te.habits.length),
        habitHtml || emptyLine('今天没有需要打勾的习惯。', 'disc', '去添加'), '', 'acc-green');
  }

  /* ---------- 公司页 ---------- */
  function renderWork() {
    const b = workRows();
    const total = b.today.length + b.tomorrow.length + b.later.length;
    let html = section('公司 · 总览',
      '<div class="summary">' + statPill('今日', b.today.length, 's-blue') +
      statPill('明日', b.tomorrow.length) +
      statPill('更晚', b.later.length) +
      statPill('已完成', b.done.length, 's-green') + '</div>' +
      '<p class="hint tight">今日 / 明日 / 更晚按到期日自动分桶，逾期会自动顺延到今天。</p>', '', 'acc-blue');

    html += section('今日 · ' + b.today.length + ' 条' + (b.today.some((h) => h.indexOf('is-hot') >= 0) ? ' · 含逾期顺延' : ''),
      b.today.join('') || emptyLine('今日无事。', 'today', '回今日'),
      '', b.today.length ? '' : 'is-quiet');
    if (b.tomorrow.length) html += section('明日 · ' + b.tomorrow.length + ' 条', b.tomorrow.join(''));
    if (b.later.length) html += section('更晚 · ' + b.later.length + ' 条', b.later.join(''), '', 'acc-slate');
    if (b.done.length) html += section('已完成 · ' + b.done.length + ' 条', doneGrid(b.done), '', 'acc-slate');
    if (!total && !b.done.length) html += emptyBox('还没有公司条目。点右上「＋新建」添加第一条。');
    return html;
  }

  /* ---------- 计划页：单一可拖拽排序板（不再重复列两遍） ---------- */
  function renderPlan() {
    const g = planOrdered();
    const urg = g.active.filter((e) => e.st.urgent).length;
    const cards = g.active.map((e, i) => planCard(e, false, i + 1)).join('') ||
      emptyBox('还没有进行中的方向：在下方写一条，会自动出现在这里。');

    let html = '<section class="card plan-board-card' + (urg ? ' has-urgent' : '') + '">' +
      '<h3>优先级排序 · 整条可拖动' +
      (urg ? ' <span class="urgent-note">' + urg + ' 条紧急</span>' : '') +
      ' <span class="cnt">' + g.active.length + ' 条</span></h3>' +
      '<p class="hint tight">拖动任意位置即可改顺序；结束日最后 10 天会自动置顶到「紧急」。</p>' +
      '<div class="plan-board" id="plan-board">' + cards + '</div></section>';

    html += '<section class="card plan-new-card"><h3>写计划方向</h3>' +
      '<div class="field"><input id="p-title" type="text" maxlength="120" placeholder="大的计划方向，如：2026 Q4 换工作" /></div>' +
      '<div class="field-row">' +
      '<label class="field"><span>开始</span><input id="p-start" type="date" /></label>' +
      '<label class="field"><span>结束（最后 10 天自动置顶“紧急”）</span><input id="p-end" type="date" /></label></div>' +
      '<div class="actions-row"><button class="btn btn-primary" id="btn-plan-add" type="button">＋ 添加方向</button>' +
      '<span class="hint">目前 ' + g.active.length + ' 条进行中</span></div></section>';

    if (g.archived.length) html += section('已结束 · ' + g.archived.length + ' 条（改结束日期可恢复）', g.archived.map((e) => planCard(e, true)).join(''), '', 'acc-slate');
    if (g.done.length) html += section('已完成 · ' + g.done.length + ' 条', doneGrid(g.done.map((e) => planCard(e, false, null, true))), '', 'acc-slate');
    return html;
  }

  function renderDisc() {
    const d = today();
    const c = checkins();
    const daily = habitCards(itemOfKind('habit').filter((t) => t.freq === 'daily'), d, c);
    const weekly = habitCards(itemOfKind('habit').filter((t) => t.freq === 'weekly'), d, c);
    const wkStart = Core.weekKey(d);
    return section('日打勾', '<p class="hint">每天都要勾；昨天漏勾的会自动顺延到今天并标注「昨日未打勾」。</p>' +
      (daily || emptyBox('还没有每日习惯。点「＋新建」，类型选 自律、频率选 每日。')), '', 'acc-green') +
      section('周打勾 · 本周自 ' + wkStart, '<p class="hint">自然周（周一起）内勾一次即完成，下周一自动重置。</p>' +
        (weekly || emptyBox('还没有每周习惯。点「＋新建」，类型选 自律、频率选 每周。')), '', 'acc-blue');
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
      '<span class="hint">音频导入步骤见仓库 DEPLOY.md</span></div>', '', 'acc-blue');
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

  /* ---------- 通用拖动排序：整条任意位置可拖（鼠标/触屏长按） ---------- */
  const SORT_IGNORE = 'input, textarea, select, button, a, label, .cb, .notes-zone, .note-inline';
  /* 活跃排序容器；页面重渲染后旧节点 isConnected=false，自动淘汰 */
  const SORT_LIVE = [];
  let sortGlobalsBound = false;
  function bindSortGlobals() {
    if (sortGlobalsBound) return;
    sortGlobalsBound = true;
    function each(fn) {
      return (e) => {
        for (let i = SORT_LIVE.length - 1; i >= 0; i -= 1) {
          const inst = SORT_LIVE[i];
          if (!inst.container.isConnected) { SORT_LIVE.splice(i, 1); continue; }
          fn(inst, e);
        }
      };
    }
    /* 挂在 window 上：指针在容器外松开也能正常收尾 */
    window.addEventListener('pointermove', each((i, e) => i.onMove(e)), { passive: false });
    window.addEventListener('pointerup', each((i, e) => i.onUp(e)));
    window.addEventListener('pointercancel', each((i, e) => i.onUp(e)));
    window.addEventListener('touchmove', each((i, e) => i.onTouchMove(e)), { passive: false });
  }

  function makeSortable(container, opts) {
    const itemSel = opts.itemSelector;
    const ignoreSel = opts.ignoreSelector || SORT_IGNORE;
    const keyOf = opts.keyOf;
    const listItems = () => Array.prototype.slice.call(container.children).filter((el) => el.matches(itemSel));
    /* 从点击目标向上找到「直接子节点」的可拖项 */
    function itemFor(target) {
      let el = target && target.closest ? target.closest(itemSel) : null;
      let guard = 0;
      while (el && el.parentElement !== container && guard < 20) {
        el = el.parentElement ? el.parentElement.closest(itemSel) : null;
        guard += 1;
      }
      return el && el.parentElement === container ? el : null;
    }

    let down = null;   // 已按下、还没越过拖动阈值
    let drag = null;   // 正在拖动
    let timer = null;

    function startDrag(e, el) {
      const rect = el.getBoundingClientRect();
      const cs = getComputedStyle(el);
      const ph = document.createElement('div');
      ph.className = 'sort-ph';
      ph.style.height = rect.height + 'px';
      ph.style.marginBottom = cs.marginBottom;
      container.insertBefore(ph, el);
      document.body.appendChild(el);
      el.classList.add('is-sorting');
      el.style.width = rect.width + 'px';
      el.style.height = rect.height + 'px';
      el.style.left = rect.left + 'px';
      el.style.top = rect.top + 'px';
      drag = { el, ph, offsetY: e.clientY - rect.top, pointerId: e.pointerId, start: listItems().map(keyOf) };
    }

    function place(pointerY) {
      const kids = Array.prototype.slice.call(container.children).filter((c) => c !== drag.ph && c.matches(itemSel));
      let before = null;
      for (let i = 0; i < kids.length; i += 1) {
        const r = kids[i].getBoundingClientRect();
        if (pointerY < r.top + r.height / 2) { before = kids[i]; break; }
      }
      if (before) container.insertBefore(drag.ph, before);
      else container.appendChild(drag.ph);
    }

    function finish() {
      const el = drag.el, ph = drag.ph, startOrder = drag.start;
      drag = null;
      el.classList.remove('is-sorting');
      el.removeAttribute('style');
      if (!ph.parentElement) { el.remove(); return; } // 拖动中被重渲染：丢掉漂浮副本
      container.insertBefore(el, ph);
      ph.remove();
      const endOrder = listItems().map(keyOf);
      if (startOrder.join('|') !== endOrder.join('|') && opts.onReorder) opts.onReorder(endOrder);
    }

    function onDown(e) {
      if (drag) return;
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      if (e.target.closest && e.target.closest(ignoreSel)) return;
      const el = itemFor(e.target);
      if (!el) return;
      clearTimeout(timer);
      down = { el, x: e.clientX, y: e.clientY, pointerId: e.pointerId };
      if (e.pointerType !== 'mouse') {
        /* 触屏：长按 320ms 后才进入拖动，避开页面滚动 */
        timer = setTimeout(() => {
          if (!down) return;
          const d = down;
          down = null;
          startDrag({ clientY: d.y, pointerId: d.pointerId }, d.el);
        }, 320);
      }
    }

    function onMove(e) {
      if (down && !drag && e.pointerId === down.pointerId) {
        if (Math.abs(e.clientY - down.y) < 6 && Math.abs(e.clientX - down.x) < 6) return;
        clearTimeout(timer);
        if (e.pointerType !== 'mouse') { down = null; return; } // 先滑动了：交给页面滚动
        const d = down;
        down = null;
        startDrag(e, d.el);
      }
      if (!drag || e.pointerId !== drag.pointerId) return;
      if (e.cancelable) e.preventDefault();
      drag.el.style.top = (e.clientY - drag.offsetY) + 'px';
      place(e.clientY);
    }

    function onUp(e) {
      clearTimeout(timer);
      if (down && e.pointerId === down.pointerId) down = null;
      if (drag && e.pointerId === drag.pointerId) finish();
    }
    function onTouchMove(e) { if (drag && e.cancelable) e.preventDefault(); }
    bindSortGlobals();
    for (let i = SORT_LIVE.length - 1; i >= 0; i -= 1) {
      if (SORT_LIVE[i].container === container) SORT_LIVE.splice(i, 1); // 同一容器不重复绑定
    }
    SORT_LIVE.push({ container, onMove, onUp, onTouchMove });

    container.addEventListener('pointerdown', onDown);
    container.addEventListener('dragstart', (e) => e.preventDefault()); // 关掉浏览器原生拖拽
  }

  /* ---------- 计划拖拽 ---------- */
  function bindPlanDrag() {
    const board = $('#plan-board');
    if (!board) return;
    makeSortable(board, {
      itemSelector: '.item-card, .task',
      keyOf: (el) => el.dataset.id,
      onReorder: (ids) => {
        const ranks = {};
        ids.forEach((id, i) => { ranks[id] = i + 1; });
        store.setRanks(ranks);
        toast('顺序已保存');
      }
    });
  }

  /* ---------- 进展拖动排序 ---------- */
  function bindNoteDrag() {
    document.querySelectorAll('.notes-zone[data-notes-for]').forEach((zone) => {
      makeSortable(zone, {
        itemSelector: '.note-line',
        ignoreSelector: 'input, textarea, select, button, a',
        keyOf: (el) => Number(el.dataset.noteIndex),
        onReorder: (order) => {
          const item = byId(zone.dataset.notesFor);
          if (!item) return;
          const r = Core.setNoteOrder(item, order);
          if (r.changed) { store.saveTask(r.item); toast('进展顺序已保存'); }
        }
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
    bindNoteDrag();
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
      if (action === 'note-del' && item) {
        const idx = Number(act.dataset.idx);
        const r = Core.deleteNote(item, idx);
        if (r.changed) { store.saveTask(r.item); toast('已删除这条进展'); }
        return;
      }
      if ((action === 'note-up' || action === 'note-down') && item) {
        const idx = Number(act.dataset.idx);
        const order = Core.orderedNotes(item).map((e) => e.index);
        const pos = order.indexOf(idx);
        const to = action === 'note-up' ? pos - 1 : pos + 1;
        if (pos < 0 || to < 0 || to >= order.length) return;
        order.splice(pos, 1);
        order.splice(to, 0, idx);
        const r = Core.setNoteOrder(item, order);
        if (r.changed) store.saveTask(r.item);
        return;
      }
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
  /* 卡片底部输入框：回车/点“记下”即写入一条带时间的进展，并刷新到卡片顶部 */
  document.addEventListener('submit', (e) => {
    const form = e.target && e.target.closest ? e.target.closest('.note-inline') : null;
    if (!form) return;
    e.preventDefault();
    const item = byId(form.dataset.id);
    const input = form.querySelector('input');
    if (!item || !input) return;
    const text = (input.value || '').trim();
    if (!text) return;
    const r = Core.addNote(item, text);
    if (!r.changed) return;
    store.saveTask(r.item);
    toast('进展已记录（含时间）');
    requestAnimationFrame(() => {
      const el = document.querySelector('.note-inline[data-id="' + item.id + '"] input');
      if (el) el.focus();
    });
  });
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
