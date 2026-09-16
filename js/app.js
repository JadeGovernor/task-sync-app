/* V2 UI 层：今日聚合 + 公司(今日/明日) + 计划(排序/紧急) + 自律(每日/每周) + 习惯清单 + 琐事备忘录 + 效率(二期占位) + 设置 */
(function () {
  'use strict';
  const Core = window.Core;
  const Cfg = window.TS_CONFIG;
  const $ = (s) => document.querySelector(s);
  const today = Core.todayStr;
  const esc = (s) => String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

  /* 从自己的 script 标签上取版本号：设置页会显示出来，方便确认这台设备到底更新了没 */
  const APP_VERSION = (function () {
    const tag = document.querySelector('script[src*="app.js"]');
    const m = tag && tag.src.match(/[?&]v=(\d+)/);
    return m ? ('v' + m[1]) : '';
  })();
  const LATEST_VERSION = Cfg.version ? ('v' + Cfg.version) : '';
  const store = new window.Store(Cfg);
  let current = 'today';
  let editingId = null;
  let noteTargetId = null;
  let dragId = null;
  let noteDragZone = null;
  let noteDragIndex = -1;
  let lastStatus = { text: '连接中…' };
  /* 两张备忘录（琐事 / 创意）逻辑完全一致，只是标题和落库的 kind 不同 */
  const MEMOS = {
    memo: {
      tab: 'memo', kind: 'memo', title: '琐事备忘录',
      sub: '想到什么写什么，停手约 1 秒自动保存并同步到三端。没有格式，就是一张随时能改的纸。',
      ph: '随手记：要买的东西、待查的资料、临时冒出来的点子…'
    },
    idea: {
      tab: 'idea', kind: 'idea', title: '创意备忘录',
      sub: '想法一冒出来就丢进来，停手约 1 秒自动保存并同步到三端。先记下，不用整理格式。',
      ph: '随手记：突然想到的点子、想试的做法、产品灵感、看到的参考…'
    }
  };
  const memoState = {};
  Object.keys(MEMOS).forEach((k) => {
    memoState[k] = { timer: null, dirty: false, flushing: false, draft: null };
  });
  const anyMemoFlushing = () => Object.keys(memoState).some((k) => memoState[k].flushing);

  /* 顶栏状态文案：同步成功时带上时刻，方便确认「实时同步」真的在跑 */
  function statusText() {
    const st = lastStatus || {};
    if (st.state === 'ok' && st.at) {
      const d = new Date(st.at);
      const p = (n) => String(n).padStart(2, '0');
      return '已同步 · ' + p(d.getHours()) + ':' + p(d.getMinutes()) + ':' + p(d.getSeconds());
    }
    return st.text || '';
  }

  const items = () => store.files.tasks.value || [];
  const checkins = () => store.files.checkins.value || [];
  const settingsObj = () => store.files.settings.value || { devices: {} };
  const myDevice = () => settingsObj().devices[store.deviceId] || {};

  /* ---------- 清理已完成（设置页） ---------- */
  const PURGE_KEEP_DAYS = 30;
  const purgeIds = () => Core.purgeDoneCandidates(items(), Core.shiftDate(today(), -PURGE_KEEP_DAYS));
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
  /* 进展流水：未完成按新→旧排在上（序号 1 在最上），打勾的划掉沉到最下面 */
  function noteLineHTML(item, entry, num, isDone) {
    const n = entry.note;
    const idx = 'data-id="' + item.id + '" data-idx="' + entry.index + '"';
    return '<div class="note-line' + (isDone ? ' is-done' : '') + '" data-id="' + item.id + '" data-note-index="' + entry.index + '">' +
      (isDone
        ? '<span class="note-drag ghost">⋮⋮</span>'
        : '<span class="note-drag" title="按住拖动排序">⋮⋮</span>') +
      '<b class="note-num' + (isDone ? ' is-ok' : '') + '">' + (isDone ? '✓' : num) + '</b>' +
      '<i class="note-time">' + esc(Core.fmtNoteTime(n, today())) + '</i>' +
      '<span class="note-text" title="点一下可修改">' + esc(n.text) + '</span>' +
      '<button class="note-del" type="button" data-action="note-del" ' + idx + ' title="删除这条进展">✕</button>' +
      '<button class="note-ok" type="button" data-action="note-done" ' + idx +
      ' title="' + (isDone ? '取消打勾，移回上面' : '打勾：划掉并移到最后') + '">✓</button>' +
      '</div>';
  }
  function notesSplit(item) {
    const list = Core.orderedNotes(item);
    return { open: list.filter((e) => !e.note.done), done: list.filter((e) => e.note.done) };
  }
  function notesOpenHTML(item, open) {
    return open.map((e, i) => noteLineHTML(item, e, i + 1, false)).join('');
  }
  function notesDoneHTML(item, done) {
    if (!done.length) return '';
    return '<div class="note-done-sep">已完成 · ' + done.length + ' 条 · 已移至底部（拖不走了）</div>' +
      '<div class="notes-done">' + done.map((e) => noteLineHTML(item, e, 0, true)).join('') + '</div>';
  }
  function notesZoneHTML(item) {
    const count = (item.notes || []).length;
    if (!count) return '<div class="notes-zone empty-notes">还没有进展，第一条写在下面 ↓</div>';
    const sp = notesSplit(item);
    return '<div class="notes-zone">' +
      '<div class="notes-count">共 ' + count + ' 条进展 · 序号 1 在最上 · 整条可拖动排序 · 点文字可修改</div>' +
      '<div class="note-list" data-notes-for="' + item.id + '">' + notesOpenHTML(item, sp.open) + '</div>' +
      notesDoneHTML(item, sp.done) + '</div>';
  }
  function notesListHTML(item) {
    const count = (item.notes || []).length;
    if (!count) return '';
    const sp = notesSplit(item);
    return '<div class="notes-zone notes-plain">' +
      '<div class="notes-count">共 ' + count + ' 条进展 · 序号 1 在最上</div>' +
      '<div class="note-list" data-notes-for="' + item.id + '">' + notesOpenHTML(item, sp.open) + '</div>' +
      notesDoneHTML(item, sp.done) + '</div>';
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

  /* ---------- 已完成区：默认收起成一行 ----------
   * 只改显示，不删任何数据：收起时只留「已完成 N 条」标题，
   * 展开后先露最近 DONE_RECENT_DAYS 天完成的，更早的再折一层「更早完成」。 */
  const DONE_RECENT_DAYS = 3;
  const doneFoldState = {};      // 用户点过的展开状态
  const doneFoldDefault = {};    // 没点过时的默认状态（渲染时记下来，点击时按同一套规则取反）
  const doneFoldOpen = (scope) => (Object.prototype.hasOwnProperty.call(doneFoldState, scope)
    ? !!doneFoldState[scope] : !!doneFoldDefault[scope]);
  function doneSection(scope, entries) {
    if (!entries || !entries.length) return '';
    const open = doneFoldOpen(scope);
    const head = '<h3 class="done-head" data-action="done-fold" data-scope="' + scope + '" role="button" tabindex="0">' +
      '已完成 <span class="cnt">' + entries.length + ' 条</span>' +
      '<span class="fold-caret">' + (open ? '收起 ▾' : '展开 ▸') + '</span></h3>';
    if (!open) return '<section class="card acc-slate done-card">' + head + '</section>';
    const list = entries.slice().sort((a, b) => ((a.date || '') < (b.date || '') ? 1 : -1));
    const cutoff = Core.shiftDate(today(), -DONE_RECENT_DAYS);
    const recent = list.filter((e) => !e.date || e.date >= cutoff);
    const older = list.filter((e) => e.date && e.date < cutoff);
    const oldScope = scope + 'Old';
    /* 最近几天一条都没有时，直接把「更早」那层铺开，别让人白点一次 */
    doneFoldDefault[scope] = false;
    doneFoldDefault[oldScope] = !recent.length;
    const openOld = doneFoldOpen(oldScope);
    let body = recent.length ? '<div class="done-grid">' + recent.map((e) => e.html).join('') + '</div>' : '';
    if (older.length) {
      body += '<button class="done-more" type="button" data-action="done-fold" data-scope="' + oldScope + '">' +
        '更早完成 · ' + older.length + ' 条 ' + (openOld ? '收起 ▾' : '展开 ▸') + '</button>';
      if (openOld) body += '<div class="done-grid">' + older.map((e) => e.html).join('') + '</div>';
    }
    return '<section class="card acc-slate done-card is-open">' + head + body + '</section>';
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
      cb + body + '<div class="row-act">' + rowActions(item, o.extraActions || '', !o.notesZone && !o.noNoteBtn, o.minimal) + '</div></div>';
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
    if (kind === 'loop') return 'm-loop';
    return kind === 'work' ? 'm-work' : kind === 'plan' ? 'm-plan' : 'm-life';
  }
  /* 星期多选：周一到周日（值跟 Date.getDay 一致，周日 = 0） */
  const WD_ORDER = [1, 2, 3, 4, 5, 6, 0];
  function wdPickerHTML(selected) {
    const sel = selected || [];
    return WD_ORDER.map((w) =>
      '<label class="wd' + (sel.indexOf(w) >= 0 ? ' on' : '') + '">' +
      '<input type="checkbox" value="' + w + '"' + (sel.indexOf(w) >= 0 ? ' checked' : '') + ' />' +
      '<span>' + Core.WEEKDAY_SHORT[w] + '</span></label>').join('');
  }
  function readWeekdays(container) {
    if (!container) return [];
    return Array.prototype.slice.call(container.querySelectorAll('input:checked'))
      .map((i) => Number(i.value)).sort((a, b) => a - b);
  }
  const todayWeekday = () => new Date().getDay();

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
        done.push({
          date: t.doneDate || '',
          html: cardHTML(t, { check: true, done: true, date: d, compact: true, minimal: true, chips: [{ text: t.doneDate === d ? '今日完成' : '已完成 ' + (t.doneDate || ''), cls: 'ok' }] })
        });
      }
    });
    const sortDue = (a, b) => { const x = byIdOf(a), y = byIdOf(b); const dx = x.due || '', dy = y.due || ''; return dx < dy ? -1 : dx > dy ? 1 : 0; };
    function byIdOf(html) { return html.match(/data-id="([^"]+)"/)[1]; }
    return { today: tod.sort(sortDue), tomorrow: tmw.sort(sortDue), later: later.sort(sortDue), done };
  }

  /* ---------- 公司：循环任务（每周固定某几天） ---------- */
  function loopCard(item, st, d, compact) {
    const chips = [{ text: Core.loopLabel(item), cls: 'm-loop' }];
    if (st.done) chips.push({ text: '本周已完成', cls: 'ok' });
    else if (st.today) chips.push({ text: '今天要做', cls: 'warn' });
    else if (st.missed) chips.push({ text: '本周已过', cls: 'dim' });
    else chips.push({ text: '本周待做', cls: 'dim' });
    /* 循环任务同样能写进展：未完成时展开整块进展区（含底部输入框），本周已完成的收成一行 */
    return cardHTML(item, {
      check: true, done: st.done, date: d, chips, noNoteBtn: true,
      notesZone: !compact, compact: !!compact, minimal: !!compact
    });
  }
  function loopRows() {
    const d = today();
    const rows = itemOfKind('loop')
      .map((t) => ({ t, st: Core.loopState(t, d) }))
      .filter((r) => r.st);
    const firstWd = (r) => {
      const w = r.st.weekdays.map((x) => (x + 6) % 7).sort((a, b) => a - b);
      return w.length ? w[0] : 9;
    };
    rows.sort((a, b) =>
      (a.st.done ? 1 : 0) - (b.st.done ? 1 : 0) ||
      (a.st.today === b.st.today ? 0 : (a.st.today ? -1 : 1)) ||
      firstWd(a) - firstWd(b) ||
      (a.t.created < b.t.created ? -1 : 1));
    return { list: rows, d };
  }
  function renderLoopSection() {
    const r = loopRows();
    const pend = r.list.filter((x) => !x.st.done).map((x) => loopCard(x.t, x.st, r.d)).join('');
    const done = r.list.filter((x) => x.st.done);
    const body = r.list.length
      ? pend + (done.length ? doneGrid(done.map((x) => loopCard(x.t, x.st, r.d, true))) : '')
      : emptyBox('还没有循环任务。在下面选「周几」加一条，到那天它会自动出现在「今日」最上面。');
    return '<section class="card loop-card">' +
      '<h3>循环任务 · 每周固定要做 <span class="cnt">' + r.list.length + ' 条</span></h3>' +
      '<p class="hint tight">到那一天自动置顶到「今日」最上面；打勾后从今日消失，本周不再提醒，下周一自动重新出现。</p>' +
      body +
      '<form id="loop-form" class="loop-add">' +
      '<input id="lp-title" type="text" maxlength="120" placeholder="例如：每周一交周报 / 每周五写总结" />' +
      '<div class="wd-picker" id="lp-weekdays">' + wdPickerHTML([todayWeekday()]) + '</div>' +
      '<button class="btn btn-primary" type="submit">＋ 加为循环任务</button>' +
      '</form></section>';
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
  function nextRank(kind) {
    let mx = 0;
    itemOfKind(kind || 'plan').forEach((t) => { if (t.rank != null && t.rank > mx) mx = t.rank; });
    return mx + 1;
  }

  /* ---------- 自律 ---------- */

  /* ---------- 习惯清单 ---------- */
  function keepCard(item) {
    const chips = [{ text: Core.kindLabel('keep'), cls: 'm-keep' }];
    if (item.created) chips.push({ text: '自 ' + item.created, cls: 'dim' });
    return cardHTML(item, { check: false, chips, notesList: true });
  }
  /* 新记下的一条：滚到屏幕中间并闪一下，避免「记了却看不见」 */
  function revealItem(id) {
    requestAnimationFrame(() => {
      const el = document.querySelector('#keep-board .task[data-id="' + id + '"]');
      if (!el) return;
      el.scrollIntoView({ block: 'center', behavior: 'smooth' });
      el.classList.add('just-added');
      setTimeout(() => el.classList.remove('just-added'), 1700);
    });
  }
  function renderKeep() {
    const list = Core.keepOrdered(items());
    const cards = list.map((t) => keepCard(t)).join('') ||
      emptyBox('还没有记录。在下面写一条，它会一直留在这张清单里。');
    let html = '<section class="card keep-board-card">' +
      '<h3>我的习惯 · 整条可拖动 <span class="cnt">' + list.length + ' 条</span></h3>' +
      '<p class="hint tight">随时记下想养成的习惯；拖动任意位置即可调整顺序。</p>' +
      '<div class="keep-board plan-board" id="keep-board">' + cards + '</div></section>';
    html += '<section class="card keep-new-card">' +
      '<h3>记录一条习惯</h3>' +
      '<form id="keep-form" class="keep-add">' +
      '<input id="k-title" type="text" maxlength="120" placeholder="例如：每天 7 点起床 / 20 分钟英语" />' +
      '<button class="btn btn-primary" type="submit">＋ 记下</button></form>' +
      '<p class="hint">同一个习惯不用重复记，它一直留在这里。</p></section>';
    return html;
  }

  /* ---------- 备忘录（琐事 / 创意）：一整张纸，随便写、随时改 ---------- */
  function memoStamp(tab) {
    const m = Core.memoOf(items(), MEMOS[tab].kind);
    if (!m || !m.updatedAt) return '还没有内容';
    const d = new Date(m.updatedAt);
    if (isNaN(d.getTime())) return '';
    const p = (n) => String(n).padStart(2, '0');
    return '已保存 · ' + p(d.getHours()) + ':' + p(d.getMinutes());
  }
  function renderMemo(tab) {
    const cfg = MEMOS[tab];
    const st = memoState[tab];
    // 有未落盘的草稿就显示草稿：同步触发的重渲染不会把正在敲的字冲掉
    const text = st.draft != null ? st.draft : Core.memoText(items(), cfg.kind);
    return '<section class="card memo-card memo-' + tab + '">' +
      '<h3>' + esc(cfg.title) + ' <span class="cnt" id="memo-count">' + text.length + ' 字</span></h3>' +
      '<p class="hint tight">' + esc(cfg.sub) + '</p>' +
      '<textarea id="memo-text" class="memo-text" spellcheck="false" ' +
      'placeholder="' + esc(cfg.ph) + '">' + esc(text) + '</textarea>' +
      '<div class="memo-foot"><span class="hint" id="memo-state">' + esc(memoStamp(tab)) + '</span></div>' +
      '</section>';
  }
  /* 把输入框里的字落盘；没改动时直接返回 */
  function flushMemo(tab) {
    const t = tab || current;
    const cfg = MEMOS[t];
    if (!cfg) return;
    const st = memoState[t];
    if (st.timer) { clearTimeout(st.timer); st.timer = null; }
    if (!st.dirty && st.draft == null) return;
    // 只有当前正显示这张备忘录时输入框才是它的，否则一律用草稿兜底
    const ta = current === t ? document.getElementById('memo-text') : null;
    const text = ta ? ta.value : st.draft;
    if (text == null) return;
    st.dirty = false;
    if (text === Core.memoText(items(), cfg.kind)) { st.draft = null; return; }
    const base = Core.memoOf(items(), cfg.kind) || Core.newItem({ kind: cfg.kind });
    st.draft = null;
    st.flushing = true;                        // 期间 onchange 触发的 render 直接跳过
    try {
      store.saveTask(Object.assign({}, base, { memo: text }));
    } finally {
      st.flushing = false;
    }
  }
  function memoOnInput(tab) {
    const st = memoState[tab];
    st.dirty = true;
    const ta = document.getElementById('memo-text');
    if (ta) st.draft = ta.value;
    const cnt = document.getElementById('memo-count');
    const state = document.getElementById('memo-state');
    if (ta && cnt) cnt.textContent = ta.value.length + ' 字';
    if (state) state.textContent = '保存中…';
    if (st.timer) clearTimeout(st.timer);
    st.timer = setTimeout(() => {
      st.timer = null;
      flushMemo(tab);
      const s2 = document.getElementById('memo-state');
      if (s2 && !st.dirty && current === tab) s2.textContent = memoStamp(tab);
    }, 800);
  }
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

    /* 循环任务：今天该做的置顶；打勾后从今日消失（沉到公司页底部） */
    const loopAll = te.loops;
    const loopPend = loopAll.filter((e) => !e.done);
    const loopDoneN = loopAll.length - loopPend.length;
    const loopRowToday = (e) => cardHTML(e.item, {
      check: true, done: false, date: d, hot: true, notesList: true,
      chips: [{ text: '循环 · ' + Core.loopLabel(e.item), cls: 'm-loop' }, { text: '今天要做', cls: 'warn' }]
    });
    const loopHtml = loopAll.length
      ? section('今日循环任务 · ' + loopPend.length + ' 条待做',
          (loopPend.map(loopRowToday).join('') ||
            '<div class="empty-line"><span>今天的循环任务都做完了 ✓</span></div>') +
          (loopDoneN ? '<p class="hint tight">已打勾 ' + loopDoneN + ' 条 · 已沉到「公司」页底部的循环任务里（本周不再提醒）</p>' : ''),
          '', 'acc-indigo')
      : '';

    const planCls = plans.some((e) => e.st.urgent) ? 'acc-red' : 'acc-amber';
    return loopHtml + section('今日效率', '<div class="progress">' +
      '<div class="progress-head"><span>' + Core.fmtCN(d) + '</span>' +
      '<span class="stat">' + (te.total ? te.done + '/' + te.total + ' · ' + pct + '%' : '今日无安排') +
      (te.streak ? ' · 🔥 连续 ' + te.streak + ' 天' : '') + '</span></div>' +
      (te.total ? '<div class="bar"><i style="width:' + pct + '%"></i></div>' : '') +
      '<div class="summary">' + statPill('循环今日', loopAll.length, 's-indigo') +
      statPill('公司今日', te.work.length, 's-blue') +
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
    if (b.done.length) html += doneSection('work', b.done);
    if (!total && !b.done.length) html += emptyBox('还没有公司条目。点右上「＋新建」添加第一条。');
    html += renderLoopSection();
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
    if (g.done.length) html += doneSection('plan', g.done.map((e) => ({
      date: e.item.doneDate || '',
      html: planCard(e, false, null, true)
    })));
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
      '<span class="hint">' + (hasToken ? '状态：' + esc(statusText()) : '未连接') + '</span></div></section>' +
      '<section class="card"><h3>设备：' + esc(name) + '</h3>' +
      '<div class="field"><label><span>设备显示名</span><input id="set-devname" type="text" value="' + esc(name) + '" maxlength="30" /></label></div>' +
      '<div class="actions-row"><button class="btn" id="set-name-save" type="button">保存设备名</button>' +
      '<span class="hint">本机版本 ' + esc(APP_VERSION || '未知') + (APP_VERSION === LATEST_VERSION ? '（最新）' : '（有新版本，刷新一次页面即可）') + '</span></div></section>' +
      '<section class="card"><h3>效率 · 早睡早起（二期，iPhone 为主）</h3>' +
      '<div class="row"><label class="switch-line"><input id="set-wake-on" type="checkbox"' + (wOn ? ' checked' : '') + ' /> 早起闹钟</label>' +
      '<input id="set-wake-time" type="time" value="' + esc(wake) + '" /></div>' +
      '<div class="row"><label class="switch-line"><input id="set-sleep-on" type="checkbox"' + (sOn ? ' checked' : '') + ' /> 早睡提醒</label>' +
      '<input id="set-sleep-time" type="time" value="' + esc(sleep) + '" /></div>' +
      '<div class="actions-row"><button class="btn btn-primary" id="set-alarm-save" type="button">保存</button>' +
      '<span class="hint">音频文件名（如 morning.mp3）可在 DEPLOY.md 第 3 步配置</span></div></section>' +
      '<section class="card"><h3>清理已完成</h3>' +
      '<p class="hint">已完成区默认收成一行，点标题展开，不会自动删任何东西；展开后默认只露最近 ' + DONE_RECENT_DAYS + ' 天完成的。下面只在你手动点时，才删掉完成超过 ' + PURGE_KEEP_DAYS + ' 天的公司任务与计划方向，打勾历史（连续天数、自律记录）一律保留。</p>' +
      '<div class="actions-row"><button class="btn" id="set-purge-done" type="button"' + (purgeIds().length ? '' : ' disabled') + '>清理完成超过 ' + PURGE_KEEP_DAYS + ' 天的（' + purgeIds().length + ' 条）</button></div></section>' +
      '<section class="card danger-zone"><h3>本机数据</h3>' +
      '<div class="actions-row"><button class="btn" id="set-refresh" type="button">重新拉取云端</button>' +
      '<button class="btn btn-danger" id="set-clear" type="button">清空本机缓存</button></div>' +
      '<p class="hint">设备 ID：' + esc(store.deviceId) + '</p></section>'
    );
  }

  /* ---------- Tab ---------- */
  function tabBtn(id, label, badge, extra) {
    const b = badge > 99 ? '99+' : badge;   // 习惯清单会长，角标太宽会把 8 个 tab 挤歪
    return '<button class="tab' + (current === id ? ' active' : '') + '" data-tab="' + id + '" type="button">' +
      label + (badge ? '<i>' + b + '</i>' : '') + (extra || '') + '</button>';
  }
  function render() {
    if (anyMemoFlushing()) return;               // 备忘录正在落盘，别把输入框重建掉
    if (MEMOS[current]) {
      const st = memoState[current];
      const ta = document.getElementById('memo-text');
      if (ta && document.activeElement === ta) {
        const typed = ta.value;
        flushMemo(current);                      // 先把正在敲的字存下来
        if (ta.isConnected && typed === Core.memoText(items(), MEMOS[current].kind)) {
          $('#subline').textContent = statusText();   // 内容没变：只更新顶栏，保住光标
          return;
        }
      } else if (st.dirty || st.draft != null) {
        flushMemo(current);
      }
    }
    $('#subline').textContent = statusText();
    const d = today();
    const te = Core.todayEntries(items(), checkins(), d);
    const todayBadge = te.total - te.done;
    const labels = [
      ['today', '今日', todayBadge || 0],
      ['work', '公司', workUndone().length],
      ['plan', '计划', activePlans().length],
      ['disc', '自律', habitsAction()],
      ['keep', '习惯', itemOfKind('keep').length],
      ['memo', '琐事', 0],
      ['idea', '创意', 0],
      ['eff', '效率', 0],
      ['settings', '设置', 0]
    ];
    $('#tabs').innerHTML = labels.map((l) => tabBtn(l[0], l[1], l[2], '')).join('');
    $('#btn-new').textContent = '＋ 新建';
    $('#btn-new').classList.toggle('hidden', !!MEMOS[current]);   // 备忘录就地写，不需要「新建」
    const view = $('#view');
    if (current === 'today') view.innerHTML = renderToday();
    else if (current === 'work') view.innerHTML = renderWork();
    else if (current === 'plan') view.innerHTML = renderPlan();
    else if (current === 'disc') view.innerHTML = renderDisc();
    else if (current === 'keep') view.innerHTML = renderKeep();
    else if (MEMOS[current]) view.innerHTML = renderMemo(current);
    else if (current === 'eff') view.innerHTML = renderEff();
    else view.innerHTML = renderSettings();
    bindDynamicEvents();
  }

  /* ---------- 弹窗：新建/编辑 ---------- */
  function kindOfCurrent() {
    if (current === 'work') return 'work';
    if (current === 'disc') return 'habit';
    if (current === 'plan') return 'plan';
    if (current === 'keep') return 'keep';
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
    $('#f-weekdays').innerHTML = wdPickerHTML(item && item.kind === 'loop' ? Core.loopWeekdays(item) : [todayWeekday()]);
    applyKindFields(kind);
    $('#btn-delete-task').classList.toggle('hidden', !item);
    $('#modal-backdrop').classList.remove('hidden');
    $('#f-title').focus();
  }
  function applyKindFields(kind) {
    const kw = kind === 'work', kp = kind === 'plan', kh = kind === 'habit', kl = kind === 'loop';
    document.querySelectorAll('.fg-work').forEach((el) => el.classList.toggle('hidden', !kw));
    document.querySelectorAll('.fg-plan').forEach((el) => el.classList.toggle('hidden', !kp));
    document.querySelectorAll('.fg-habit').forEach((el) => el.classList.toggle('hidden', !kh));
    document.querySelectorAll('.fg-loop').forEach((el) => el.classList.toggle('hidden', !kl));
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
    } else if (kind === 'loop') {
      const base = old ? JSON.parse(JSON.stringify(old)) : Core.newItem({ kind: 'loop' });
      const wds = readWeekdays($('#f-weekdays'));
      if (!wds.length) { toast('至少选一个星期几'); return null; }
      next = Object.assign(base, { title, weekdays: wds, updatedAt: new Date().toISOString() });
    } else if (kind === 'keep') {
      const base = old ? JSON.parse(JSON.stringify(old)) : Core.newItem({ kind: 'keep' });
      if (!old && base.rank == null) base.rank = nextRank('keep');
      next = Object.assign(base, { title, updatedAt: new Date().toISOString() });
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
  /* 点进展文字就地编辑：回车保存、Esc 取消、点别处也算保存 */
  function startNoteEdit(textEl) {
    if (Date.now() - SORT_LAST_DRAG < 350) return;
    const line = textEl.closest('.note-line');
    if (!line || document.querySelector('.note-edit')) return;
    const item = byId(line.dataset.id);
    const idx = Number(line.dataset.noteIndex);
    const cur = item && (item.notes || [])[idx];
    if (!cur) return;
    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'note-edit';
    input.maxLength = 300;
    input.value = cur.text;
    textEl.replaceWith(input);
    input.focus();
    try { input.setSelectionRange(input.value.length, input.value.length); } catch (err) { /* 忽略 */ }
    let closed = false;
    const restore = () => {
      const span = document.createElement('span');
      span.className = 'note-text';
      span.title = '点一下可修改';
      span.textContent = cur.text;
      if (input.parentElement) input.replaceWith(span);
    };
    const commit = (save) => {
      if (closed) return;
      closed = true;
      const v = (input.value || '').trim();
      if (save && v && v !== cur.text) {
        const r = Core.editNote(item, idx, v);
        if (r.changed) { store.saveTask(r.item); toast('进展已修改'); return; }
      }
      restore();
    };
    input.addEventListener('keydown', (ev) => {
      if (ev.key === 'Enter') { ev.preventDefault(); commit(true); }
      else if (ev.key === 'Escape') { ev.preventDefault(); commit(false); }
    });
    input.addEventListener('blur', () => commit(true));
  }
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
  /* 刚拖完的那一下点击不要被当成「点文字改内容」 */
  let SORT_LAST_DRAG = 0;
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
    /* 文档级兜底：从选中的文字上再拖会触发浏览器原生拖拽（就是那个「复制感」），
       而拖动中的元素此时挂在 body 下，容器级监听拦不到，所以在这里一并拦掉 */
    document.addEventListener('dragstart', (e) => {
      const t = e.target;
      if (t && t.closest && t.closest('.note-line, .item-card, .task, .sort-ph')) e.preventDefault();
    }, true);
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
      /* 拖动期间锁住文字选择，避免拖出「复制一块文字」的残影 */
      const sel = window.getSelection && window.getSelection();
      if (sel && sel.removeAllRanges) sel.removeAllRanges();
      document.body.classList.add('is-dragging');
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
      document.body.classList.remove('is-dragging');
      el.classList.remove('is-sorting');
      el.removeAttribute('style');
      if (!ph.parentElement) { el.remove(); return; } // 拖动中被重渲染：丢掉漂浮副本
      container.insertBefore(el, ph);
      ph.remove();
      SORT_LAST_DRAG = Date.now();
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

  /* ---------- 习惯清单拖拽 ---------- */
  function bindKeepDrag() {
    const board = $('#keep-board');
    if (!board) return;
    makeSortable(board, {
      itemSelector: '.item-card, .task',
      keyOf: (el) => el.dataset.id,
      onReorder: (ids) => {
        // 以屏幕上的新顺序为准，把没出现在屏幕上的也接在后面，
        // 保证整张清单每次都重排成 1..N，永不撞号
        const seen = {};
        const ordered = ids.filter((id) => { if (seen[id]) return false; seen[id] = 1; return true; });
        Core.keepOrdered(items()).forEach((t) => { if (!seen[t.id]) { seen[t.id] = 1; ordered.push(t.id); } });
        const ranks = {};
        ordered.forEach((id, i) => { ranks[id] = i + 1; });
        store.setRanks(ranks);
        toast('习惯顺序已保存');
      }
    });
  }

  /* ---------- 进展拖动排序 ---------- */
  function bindNoteDrag() {
    document.querySelectorAll('.note-list[data-notes-for]').forEach((zone) => {
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
    const lf = $('#loop-form');
    if (lf) lf.addEventListener('submit', (e) => {
      e.preventDefault();
      const input = $('#lp-title');
      const title = (input.value || '').trim();
      if (!title) { toast('先写一句要循环做的事'); return; }
      const wds = readWeekdays($('#lp-weekdays'));
      if (!wds.length) { toast('至少选一个星期几'); return; }
      const it = Core.newItem({ kind: 'loop', title, weekdays: wds });
      store.saveTask(it);
      input.value = '';
      render();
      toast('已加入循环任务 · ' + Core.loopLabel(it));
    });
    const kf = $('#keep-form');
    if (kf) kf.addEventListener('submit', (e) => {
      e.preventDefault();
      const title = $('#k-title').value.trim();
      if (!title) return toast('先写一条习惯');
      const it = Core.newItem({ kind: 'keep', title, rank: nextRank('keep') });
      store.saveTask(it);
      $('#k-title').value = '';
      $('#k-title').blur();          // 收起手机键盘，别把刚记的那条挡在屏幕外
      revealItem(it.id);
      toast('已记录，已同步到上方清单');
    });
    bindPlanDrag();
    bindKeepDrag();
    bindNoteDrag();
    const mt = $('#memo-text');
    if (mt && MEMOS[current]) {
      const tab = current;
      mt.addEventListener('input', () => memoOnInput(tab));
      mt.addEventListener('blur', () => {
        flushMemo(tab);
        const s = document.getElementById('memo-state');
        if (s && !memoState[tab].dirty) s.textContent = memoStamp(tab);
      });
    }
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
    const s7 = $('#set-purge-done'); if (s7) s7.addEventListener('click', async () => {
      const ids = purgeIds();
      if (!ids.length) { toast('没有完成超过 ' + PURGE_KEEP_DAYS + ' 天的任务'); return; }
      const ok = await confirmDialog('清理已完成',
        '会从云端删掉 ' + ids.length + ' 条完成超过 ' + PURGE_KEEP_DAYS + ' 天的公司任务与计划方向，这台设备和另外两端都会同步消失。打勾历史与自律记录不受影响。继续？');
      if (!ok) return;
      store.deleteTasks(ids);
      toast('已清理 ' + ids.length + ' 条已完成任务');
      render();
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
    if (tabEl) { flushMemo(); current = tabEl.dataset.tab; render(); return; }
    const go = e.target.closest('[data-tab-go]');
    if (go) { flushMemo(); current = go.dataset.tabGo; render(); return; }
    const noteText = e.target.closest('.note-text');
    if (noteText && !e.target.closest('[data-action]')) { startNoteEdit(noteText); return; }
    const act = e.target.closest('[data-action]');
    if (act) {
      const action = act.dataset.action;
      const id = act.dataset.id;
      const item = id ? byId(id) : null;
      if (action === 'done-fold') {
        const sc = act.dataset.scope;
        if (sc) { doneFoldState[sc] = !doneFoldOpen(sc); render(); }
        return;
      }
      if (action === 'toggle' && item) {
        const input = act.tagName === 'INPUT' ? act : null;
        const on = !!input.checked;
        if (item.kind === 'habit') {
          if (item.freq === 'weekly') setHabitWeekly(item, on);
          else setHabitDaily(item, on);
        } else if (item.kind === 'loop') {
          const r = Core.setLoopDone(item, today(), on);
          if (r.changed) store.saveTask(r.item);
          if (on) toast('循环任务完成 ✓ 本周不再提醒');
          else toast('已取消，重新回到今日');
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
      if (action === 'note-done' && item) {
        const idx = Number(act.dataset.idx);
        const note = (item.notes || [])[idx] || {};
        const r = Core.setNoteDone(item, idx, !note.done);
        if (r.changed) {
          store.saveTask(r.item);
          toast(note.done ? '已取消打勾，移回上面' : '已完成 ✓ 已划掉并移到最后');
        }
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
    if (k.id === 'memo' || k.id === 'idea') return;   // 备忘录就地写，不走「新建」表单
    const o = document.createElement('option');
    o.value = k.id;
    const hint = { work: '今日/明日', loop: '每周固定某几天', plan: '方向+时间范围', habit: '每日/每周', keep: '长期清单' }[k.id];
    o.textContent = k.label + (hint ? '（' + hint + '）' : '');
    $('#f-kind').appendChild(o);
  });
  Core.FREQS.forEach((f) => {
    const o = document.createElement('option');
    o.value = f.id; o.textContent = f.label;
    $('#f-freq').appendChild(o);
  });

  document.addEventListener('click', onViewClick);
  /* 星期按钮：点一下切换高亮（值本身由 checkbox 负责） */
  document.addEventListener('change', (e) => {
    const input = e.target;
    if (!input || input.type !== 'checkbox' || !input.closest('.wd-picker')) return;
    const lab = input.closest('.wd');
    if (lab) lab.classList.toggle('on', input.checked);
  });
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

  store.onStatus = (st) => { lastStatus = st; $('#subline').textContent = statusText(); };
  store.onChange = () => render();
  /* 切走 / 息屏 / 关页面之前，把备忘录里没落盘的字存下来 */
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') flushMemo();
  });
  window.addEventListener('pagehide', flushMemo);
  render();
  store.init();
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('./sw.js').catch(() => {});
  }
})();
