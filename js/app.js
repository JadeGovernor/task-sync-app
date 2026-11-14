/* UI 层：新导航 + 今日聚合 + 点子/娱乐/排期/项目/日历/循环/日程/打卡 + 旧页面归档入口 */
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
  /* 三张备忘录（琐事 / 点子 / 娱乐）逻辑一致，落库 kind 各自独立 */
  const MEMOS = {
    memo: {
      tab: 'memo', kind: 'memo', title: '琐事备忘录',
      sub: '想到什么写什么；上方可以加粗、分标题、改字号/颜色、高亮和插表格。停手约 1 秒自动保存并同步三端。',
      ph: '随手记：要买的东西、待查的资料、临时冒出来的点子…'
    },
    idea: {
      tab: 'idea', kind: 'idea', title: '点子',
      sub: '想法一冒出来就丢进来；需要时再用上方工具栏排版。停手约 1 秒自动保存并同步三端。',
      ph: '随手记：突然想到的点子、想试的做法、产品灵感、看到的参考…'
    },
    fun: {
      tab: 'fun', kind: 'fun', title: '娱乐清单',
      sub: '想看的、想玩的、想去的都放这里；和点子分开记录，互不覆盖。停手约 1 秒自动保存。',
      ph: '例如：想看的电影、想玩的游戏、周末想去的地方…'
    }
  };
  const memoState = {};
  Object.keys(MEMOS).forEach((k) => {
    memoState[k] = { timer: null, dirty: false, flushing: false, draft: null, html: null };
  });
  const anyMemoFlushing = () => Object.keys(memoState).some((k) => memoState[k].flushing);

  /* 本月排期：一周一条记录（kind=monthweek），四条周范围和正文都跟着 tasks.json 三端同步。
   * 拆成四条是为了避免「两台设备各改一周」时整条记录互相覆盖。 */
  const MONTH_KIND = 'monthweek';
  const MONTH_NOTE_KIND = 'monthnote';
  const REPORT_KIND = 'weekreport';
  const CAL_NOTE_KIND = 'calendar_note';
  const DAY_PAPER_KIND = 'daypaper';
  const WEEK_NAMES = ['第一周', '第二周', '第三周', '第四周'];
  let monthState = { key: null, drafts: {}, timer: null, dirty: false, flushing: false, rangeEdit: null };
  let activeReportId = null;
  let reportNaming = false;
  let calendarZoom = 0;
  let calendarComposer = null;
  let navGroupOpen = '';
  let navMoreOpen = false;
  const RICH_DOCS = {};
  const richDocState = (key) => {
    if (!RICH_DOCS[key]) {
      RICH_DOCS[key] = { timer: null, dirty: false, flushing: false, draft: null, html: null };
    }
    return RICH_DOCS[key];
  };
  const anyRichDocFlushing = () => Object.keys(RICH_DOCS).some((k) => RICH_DOCS[k].flushing);

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
  const HIST_MAX = 20;            // 设置页「数据恢复」保留的快照份数（与 store.js 一致）
  const purgeIds = () => Core.purgeDoneCandidates(items(), Core.shiftDate(today(), -PURGE_KEEP_DAYS));
  const byId = (id) => items().find((t) => t.id === id);

  const itemOfKind = (kind) => items().filter((t) => t.kind === kind);
  const calendarNotes = () => itemOfKind(CAL_NOTE_KIND)
    .filter((t) => /^\d{4}-\d{2}-\d{2}$/.test(String(t.date || '')))
    .sort((a, b) => {
      if (a.date !== b.date) return a.date < b.date ? -1 : 1;
      return String(a.createdAt || '') < String(b.createdAt || '') ? -1 : 1;
    });
  const calendarNotesOn = (date) => calendarNotes().filter((t) => t.date === date);
  const dayPapers = () => itemOfKind(DAY_PAPER_KIND)
    .filter((t) => /^\d{4}-\d{2}-\d{2}$/.test(String(t.date || '')));
  const dayPaperFor = (date) => dayPapers()
    .filter((t) => t.date === date)
    .sort((a, b) => String(b.updatedAt || '') < String(a.updatedAt || '') ? -1 : 1)[0] || null;
  /* tab 上的「公司」数字 = 今天该做的条数（含逾期顺延），跟公司页「今日」桶、今日页「公司 · 今日到期」完全一个口径。
   * 以前用的是「未完成且到期日 >= 今天」，把逾期顺延的条目漏掉了，所以会出现「页面上 5 条、tab 上 1 条」。 */
  const workToday = () => {
    const d = today();
    return itemOfKind('work').filter((t) => !t.done && Core.workStatus(t, d).bucket === 'today').length;
  };
  const activePlans = () => itemOfKind('plan').filter((t) => Core.planState(t, today()).active);
  const habitsAction = () => {
    const d = today();
    const c = checkins();
    return itemOfKind('habit').filter((t) => {
      const st = Core.habitOn(t, d, c);
      return st && !st.done;
    }).length;
  };
  const habitPendingCount = () => habitsAction();
  const loopPendingCount = () => {
    const d = today();
    return itemOfKind('loop').filter((t) => {
      const st = Core.loopOn(t, d);
      return st && !st.done;
    }).length;
  };
  const calendarNearDates = (days) => {
    const d = today();
    const out = [];
    for (let i = 0; i < (days || 7); i += 1) out.push(Core.shiftDate(d, i));
    return out;
  };
  const calendarNearItems = () => {
    const set = new Set(calendarNearDates(7));
    return calendarNotes().filter((t) => set.has(t.date));
  };
  const calendarNearCount = () => calendarNearItems().length;
  const nearPlanItems = () => {
    const d = today();
    const last = Core.shiftDate(d, 6);
    return planOrdered().active.filter((e) => {
      const end = e.item.rangeEnd;
      if (!end || end > last) return false;
      if (e.st.overdue) return true;
      return end >= d;
    });
  };
  const hotTimerCount = () => todayTimerRows().filter((x) => !x.t.done).length;
  const todayPendingCount = () =>
    hotTimerCount() + loopPendingCount() + habitPendingCount() +
    nearPlanItems().length + calendarNearItems().length;

  /* ---------- 提示 ---------- */
  let toastTimer = null;
  let undoFn = null;                 // 最近一次删除的「撤回」动作；过期就作废
  function toast(msg, ms) {
    const t = $('#toast');
    undoFn = null;
    t.textContent = msg;
    t.classList.remove('hidden');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.add('hidden'), ms || 2600);
  }
  /* 删除类操作给一条后悔路：提示条上带个「撤回」按钮 */
  function toastUndo(msg, undo, ms) {
    const t = $('#toast');
    t.textContent = msg;
    undoFn = undo;
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'toast-undo';
    b.setAttribute('data-action', 'undo');
    b.textContent = '撤回';
    b.addEventListener('click', () => {
      const fn = undoFn;
      undoFn = null;
      t.classList.add('hidden');
      clearTimeout(toastTimer);
      if (fn) fn();
    });
    t.appendChild(b);
    t.classList.remove('hidden');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { undoFn = null; t.classList.add('hidden'); }, ms || 6000);
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
  function cbHTML(id, done, date, action) {
    return '<label class="cb">' +
      '<input type="checkbox" data-action="' + (action || 'toggle') + '" data-id="' + id + '" data-date="' + date + '"' + (done ? ' checked' : '') + ' />' +
      '<span class="box"></span></label>';
  }
  function cardHTML(item, opts) {
    const o = opts || {};
    const body =
      '<div class="task-main" data-action="edit" data-id="' + item.id + '">' +
        '<div class="task-title">' + esc(item.title) + '</div>' +
        '<div class="task-meta">' + (o.chips || []).map((c) => chip(c.text, c.cls)).join('') + '</div>' +
      '</div>';
    const cb = o.check ? cbHTML(item.id, o.done, o.date, o.checkAction) : '';
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
  /* 公司页：先按到期日分桶，桶内顺序用 Core.workOrderCmp（rank → 到期日 → 创建时间），
   * 和今日页共用同一个比较器，拖动改完顺序两边一致 */
  function workRows() {
    const d = today();
    const buckets = { today: [], tomorrow: [], later: [], done: [] };
    itemOfKind('work').forEach((t) => {
      const w = Core.workStatus(t, d);
      (buckets[w.bucket] || buckets.later).push({ t, w });
    });
    ['today', 'tomorrow', 'later'].forEach((k) => {
      buckets[k].sort((a, b) => Core.workOrderCmp(a.t, b.t));
    });
    buckets.done.sort((a, b) => ((a.t.doneDate || '') < (b.t.doneDate || '') ? 1 : -1));
    return { today: buckets.today, tomorrow: buckets.tomorrow, later: buckets.later, done: buckets.done, d };
  }
  function workCardHTML(x, d) {
    const t = x.t, w = x.w;
    const chips = [];
    if (w.overdue) chips.push({ text: '逾期顺延', cls: 'warn' });
    if (t.due) chips.push({ text: w.bucket === 'later' ? t.due : (w.bucket === 'tomorrow' ? '明天 ' + t.due : (w.overdue ? '原定 ' + t.due : '今天')), cls: 'dim' });
    return cardHTML(t, { check: true, done: false, date: d, hot: !!w.overdue, chips, notesZone: true });
  }
  function workDoneRow(x, d) {
    const t = x.t;
    return {
      date: t.doneDate || '',
      html: cardHTML(t, {
        check: true, done: true, date: d, compact: true, minimal: true,
        chips: [{ text: t.doneDate === d ? '今日完成' : '已完成 ' + (t.doneDate || ''), cls: 'ok' }]
      })
    };
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
  function renderLoopPage() {
    return renderLoopSection().replace(
      '<h3>循环任务 · 每周固定要做',
      '<h3>循环 · 每周固定要做'
    );
  }

  /* ---------- 计划排序 ---------- */
  function planOrdered() {
    const d = today();
    const acts = [], done = [];
    itemOfKind('plan').forEach((t) => {
      const st = Core.planState(t, d);
      if (st.bucket === 'done') done.push({ item: t, st });
      else acts.push({ item: t, st });          // 过了结束日但没完成的也在板上（标「已拖延」），不再消失
    });
    acts.sort((a, b) => Core.planOrderCmp(a.item, b.item, d));
    return { active: acts, done: done.sort((a, b) => (a.item.doneDate || '') > (b.item.doneDate || '') ? -1 : 1) };
  }
  function planCard(e, compact, badge, minimal) {
    const t = e.item, st = e.st;
    const isMini = minimal != null ? minimal : !!compact;
    const chips = [];
    chips.push({ text: '项目', cls: chipClsFor('plan') });
    if (t.rangeStart || t.rangeEnd) {
      chips.push({ text: (t.rangeStart || '?') + ' → ' + (t.rangeEnd || '持续'), cls: 'dim' });
    }
    if (st.overdue) chips.push({ text: '已拖延 ' + st.overdueDays + ' 天未完成', cls: 'over' });
    else if (st.urgent) chips.push({ text: '紧急 · 最后 ' + Math.max(0, Core.dayDiff(today(), t.rangeEnd)) + ' 天', cls: 'warn' });
    if (st.overdue) chips.push({ text: '打勾完成 或 改结束日 才会收起', cls: 'dim' });
    if (t.rangeEnd && t.rangeEnd === today() && !st.urgent && st.active) chips.push({ text: '今天截止', cls: 'dim' });
    const doneBtn = st.bucket !== 'done'
      ? '<button class="mini-btn ok-mini" type="button" data-action="plan-done" data-id="' + t.id + '">完成</button>'
      : '<button class="mini-btn" type="button" data-action="plan-done" data-id="' + t.id + '">恢复</button>';
    return cardHTML(t, {
      check: false, chips, extraActions: doneBtn, hot: !compact && (st.urgent || st.overdue),
      notesZone: !compact && !isMini, compact: !!compact, minimal: isMini,
      badge: badge != null ? badge : null, badgeCls: (st.urgent || st.overdue) ? 'is-urgent' : ''
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
      const el = document.querySelector('#view [data-id="' + id + '"]');
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

  /* ---------- 本月排期：一张不交互的月历 + 四行可编辑的周排期 ---------- */
  const p2 = (n) => (n < 10 ? '0' + n : String(n));
  function monthMeta() {
    const d = new Date();
    const y = d.getFullYear();
    const m = d.getMonth();
    const days = new Date(y, m + 1, 0).getDate();
    const key = y + '-' + p2(m + 1);
    return {
      y, m, days, key,
      first: key + '-01',
      last: key + '-' + p2(days),
      label: y + ' 年 ' + (m + 1) + ' 月'
    };
  }
  const shortDay = (s) => {
    const p = String(s || '').split('-');
    return p.length === 3 ? Number(p[1]) + '.' + Number(p[2]) : '';
  };
  const rangeLabel = (w) => shortDay(w.start) + ' – ' + shortDay(w.end);
  const defaultMonthWeeks = (meta) => {
    const base = Math.floor(meta.days / 4);
    const rem = meta.days % 4;
    let day = 1;
    return WEEK_NAMES.map((_, i) => {
      const len = base + (i < rem ? 1 : 0);
      const start = meta.key + '-' + p2(day);
      const end = meta.key + '-' + p2(day + len - 1);
      day += len;
      return { start, end, text: '' };
    });
  };
  const monthItem = (i) => {
    const key = monthMeta().key;
    return items().find((t) => t.kind === MONTH_KIND && t.month === key && t.week === i) || null;
  };
  function monthWeeks() {
    const meta = monthMeta();
    const def = defaultMonthWeeks(meta);
    return def.map((d, i) => {
      const w = monthItem(i) || {};
      const good = (s) => /^\d{4}-\d{2}-\d{2}$/.test(String(s || ''));
      return {
        start: good(w.start) ? w.start : d.start,
        end: good(w.end) ? w.end : d.end,
        text: typeof w.text === 'string' ? w.text : ''
      };
    });
  }
  function saveMonthWeek(i, patch) {
    const meta = monthMeta();
    const def = defaultMonthWeeks(meta)[i];
    const old = monthItem(i);
    const base = old || Core.newItem({
      kind: MONTH_KIND,
      title: meta.label + WEEK_NAMES[i],
      month: meta.key,
      week: i,
      start: def.start,
      end: def.end,
      text: ''
    });
    store.saveTask(Object.assign({}, base, patch, {
      kind: MONTH_KIND,
      month: meta.key,
      week: i,
      updatedAt: new Date().toISOString()
    }));
  }
  function flushMonth() {
    if (!monthState.dirty) return;
    const meta = monthMeta();
    if (monthState.key !== meta.key) { monthState.drafts = {}; monthState.dirty = false; return; }
    const weeks = monthWeeks();
    const changes = Object.keys(monthState.drafts)
      .map(Number)
      .filter((i) => i >= 0 && i < 4)
      .map((i) => ({ i, text: monthState.drafts[i], prev: weeks[i].text }));
    monthState.dirty = false;
    monthState.drafts = {};
    monthState.flushing = true;
    try {
      changes.forEach((c) => {
        if (c.text !== c.prev) saveMonthWeek(c.i, { text: c.text });
      });
    } finally { monthState.flushing = false; }
  }
  function monthOnInput(ta) {
    const i = Number(ta.getAttribute('data-ms-week'));
    if (!(i >= 0 && i < 4)) return;
    monthState.key = monthMeta().key;
    monthState.drafts[i] = ta.value;
    monthState.dirty = true;
    if (monthState.timer) clearTimeout(monthState.timer);
    monthState.timer = setTimeout(() => {
      monthState.timer = null;
      flushMonth();
    }, 700);
  }
  function monthRangeError(i, start, end) {
    const meta = monthMeta();
    if (!start || !end) return '开始和结束日期都要选';
    if (start < meta.first || end > meta.last) return '范围要落在 ' + meta.label + ' 内';
    if (start > end) return '开始日期不能晚于结束日期';
    const weeks = monthWeeks();
    if (i > 0 && start <= weeks[i - 1].end) return '开始日要晚于「' + WEEK_NAMES[i - 1] + '」的结束日';
    if (i < 3 && end >= weeks[i + 1].start) return '结束日要早于「' + WEEK_NAMES[i + 1] + '」的开始日';
    return '';
  }
  function saveMonthRange(i) {
    const start = (document.getElementById('ms-start-' + i) || {}).value;
    const end = (document.getElementById('ms-end-' + i) || {}).value;
    const err = monthRangeError(i, start, end);
    if (err) { toast(err, 3200); return; }
    flushMonth();                     // 别把这次操作前还没落盘的正文丢掉
    monthState.drafts = {};
    monthState.dirty = false;
    monthState.rangeEdit = null;
    saveMonthWeek(i, { start, end });
    toast(WEEK_NAMES[i] + '范围已保存：' + shortDay(start) + ' – ' + shortDay(end));
  }
  /* ISO 周序号：跨年也按 ISO 8601 算 */
  function isoWeekNo(date) {
    const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
    const day = d.getUTCDay() || 7;
    d.setUTCDate(d.getUTCDate() + 4 - day);
    const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
    return Math.ceil((((d - yearStart) / 86400000) + 1) / 7);
  }
  function calendarHTML(weeks) {
    const meta = monthMeta();
    const d = new Date();
    const todayS = today();
    const first = new Date(meta.y, meta.m, 1);
    const offset = (first.getDay() + 6) % 7;        // 周一开头
    const rows = Math.ceil((offset + meta.days) / 7);
    const wd = ['一', '二', '三', '四', '五', '六', '日'];
    let g = '<div class="mc-grid">' +
      '<div class="mc-corner">周</div>' +
      wd.map((x, i) => '<div class="mc-wd' + (i >= 5 ? ' wkend' : '') + '">' + x + '</div>').join('');
    for (let r = 0; r < rows; r += 1) {
      const rowStart = new Date(meta.y, meta.m, 1 - offset + r * 7);
      g += '<div class="mc-wn" title="ISO 第 ' + isoWeekNo(rowStart) + ' 周">' + isoWeekNo(rowStart) + '</div>';
      for (let c = 0; c < 7; c += 1) {
        const dt = new Date(rowStart);
        dt.setDate(rowStart.getDate() + c);
        const ds = Core.dateStr(dt);
        const inMonth = dt.getMonth() === meta.m;
        const wi = inMonth ? weeks.findIndex((w) => ds >= w.start && ds <= w.end) : -1;
        const cls = ['mc-day'];
        if (!inMonth) cls.push('out');
        else if (wi >= 0) cls.push('wk' + (wi + 1));
        if (c >= 5) cls.push('wkend');
        if (ds === todayS) cls.push('today');
        g += '<div class="' + cls.join(' ') + '"' + (inMonth ? '' : ' aria-hidden="true"') + '>' +
          '<b>' + dt.getDate() + '</b>' + (ds === todayS ? '<i class="mc-today">今</i>' : '') + '</div>';
      }
    }
    g += '</div>';
    const todayBlock = weeks.findIndex((w) => todayS >= w.start && todayS <= w.end);
    return '<div class="mc-top">' +
        '<div><div class="mc-month">' + meta.label + '</div>' +
        '<div class="mc-sub">今天 ' + Core.fmtCN(todayS) + ' · ISO 第 ' + isoWeekNo(d) + ' 周' +
        (todayBlock >= 0 ? ' · 本月' + WEEK_NAMES[todayBlock] : '') + '</div></div>' +
        (todayBlock >= 0 ? '<span class="mc-now-badge">今天在' + WEEK_NAMES[todayBlock] + '</span>' : '') +
      '</div>' +
      g +
      '<div class="mc-legend">' +
        weeks.map((w, i) => '<span class="mc-lg"><i class="lg lg' + (i + 1) + '"></i>' +
          WEEK_NAMES[i] + ' ' + rangeLabel(w) + '</span>').join('') +
        '<span class="mc-lg"><i class="lg lg-today"></i>今天</span>' +
      '</div>';
  }
  function renderMonth() {
    const meta = monthMeta();
    const weeks = monthWeeks();
    const todayS = today();
    const rows = weeks.map((w, i) => {
      const isNow = todayS >= w.start && todayS <= w.end;
      const text = monthState.drafts[i] != null ? monthState.drafts[i] : w.text;
      const days = Math.max(0, Core.dayDiff(w.start, w.end) + 1);
      const row = '<div class="ms-row ms-wk' + (i + 1) + (isNow ? ' is-now' : '') + '" data-ms-row="' + i + '">' +
          '<div class="ms-side">' +
            '<div class="ms-name">' + WEEK_NAMES[i] +
              '<button class="ms-pencil" type="button" data-action="month-range-edit" data-week="' + i + '" title="修改本周范围">✎</button>' +
            '</div>' +
            '<div class="ms-range">' + rangeLabel(w) + '</div>' +
            '<div class="ms-meta">' + days + ' 天' + (isNow ? '<span class="ms-now">本周</span>' : '') + '</div>' +
          '</div>' +
          '<div class="ms-body"><textarea class="ms-text" data-ms-week="' + i + '" rows="2" ' +
            'spellcheck="false" placeholder="这周要安排的事，随便写…">' + esc(text) + '</textarea></div>' +
        '</div>';
      if (monthState.rangeEdit !== i) return row;
      return row +
        '<div class="ms-range-editor" data-ms-editor="' + i + '">' +
          '<label><span>' + WEEK_NAMES[i] + '开始</span>' +
            '<input type="date" id="ms-start-' + i + '" value="' + esc(w.start) + '" min="' + meta.first + '" max="' + meta.last + '" /></label>' +
          '<label><span>结束</span>' +
            '<input type="date" id="ms-end-' + i + '" value="' + esc(w.end) + '" min="' + meta.first + '" max="' + meta.last + '" /></label>' +
          '<div class="ms-editor-actions">' +
            '<button class="btn btn-sm btn-primary" type="button" data-action="month-range-save" data-week="' + i + '">保存范围</button>' +
            '<button class="btn btn-sm" type="button" data-action="month-range-cancel">取消</button>' +
          '</div>' +
        '</div>';
    }).join('');
    /* 编辑第四周时，编辑框贴在页面最底部，原生日期选择器向下弹会被屏幕截掉。
     * 留一段空白让页面还能往上滚，配合打开时自动滚动把编辑框放到视口中上部。 */
    const editRoom = monthState.rangeEdit != null ? '<div class="ms-scroll-room" aria-hidden="true"></div>' : '';
    return '<section class="card month-cal-card">' +
        '<h3>本月日历 <span class="cnt">' + meta.days + ' 天</span></h3>' +
        calendarHTML(weeks) +
      '</section>' +
      '<section class="card month-sched-card">' +
        '<h3>本月排期 <span class="cnt">四周</span></h3>' +
        '<p class="hint tight">点周次后面的 ✎ 可以改这一周的范围，日历上的色块会跟着变；右边每行随便写，停手约 1 秒自动保存并同步三端。</p>' +
        '<div class="ms-table">' + rows + '</div>' +
      '</section>' +
      renderMonthNote() +
      renderReports() +
      editRoom;
  }

  /* ---------- 日历：独立记录，一条记录一个同步条目 ---------- */
  function monthYearLabel(y, m) {
    return y + ' 年 ' + (m + 1) + ' 月';
  }
  function addMonths(y, m, n) {
    const d = new Date(y, m + n, 1);
    return { y: d.getFullYear(), m: d.getMonth() };
  }
  function calendarViewMonths() {
    const now = new Date();
    const y = now.getFullYear();
    const m = now.getMonth();
    if (calendarZoom === 0) return [{ y, m }];
    if (calendarZoom === 1) return [-1, 0, 1].map((n) => addMonths(y, m, n));
    return Array.from({ length: 12 }, (_, i) => addMonths(y, m, i - 3));
  }
  function calendarMonthGrid(y, m, notesByDate) {
    const first = new Date(y, m, 1);
    const days = new Date(y, m + 1, 0).getDate();
    const offset = (first.getDay() + 6) % 7;
    const rows = Math.ceil((offset + days) / 7);
    const monthPrefix = y + '-' + p2(m + 1);
    const monthNoteCount = Object.keys(notesByDate)
      .filter((date) => date.startsWith(monthPrefix + '-'))
      .reduce((sum, date) => sum + notesByDate[date].length, 0);
    const todayS = today();
    const noteLimit = calendarZoom === 0 ? 2 : calendarZoom === 1 ? 1 : 0;
    let grid = '<div class="cal-weekdays"><span class="cal-corner">周</span>' +
      ['一', '二', '三', '四', '五', '六', '日'].map((x, i) =>
        '<span' + (i >= 5 ? ' class="is-weekend"' : '') + '>' + x + '</span>').join('') +
    '</div><div class="cal-grid">';
    for (let r = 0; r < rows; r += 1) {
      const weekStart = new Date(y, m, 1 - offset + r * 7);
      grid += '<span class="cal-week-no" title="ISO 第 ' + isoWeekNo(weekStart) + ' 周">' +
        isoWeekNo(weekStart) + '</span>';
      for (let c = 0; c < 7; c += 1) {
        const dt = new Date(weekStart);
        dt.setDate(weekStart.getDate() + c);
        if (dt.getMonth() !== m) {
          grid += '<span class="cal-day is-out" aria-hidden="true"></span>';
          continue;
        }
        const date = Core.dateStr(dt);
        const notes = notesByDate[date] || [];
        const visible = notes.slice(0, noteLimit);
        grid += '<div class="cal-day' +
          (c >= 5 ? ' is-weekend' : '') +
          (date === todayS ? ' is-today' : '') +
          (notes.length ? ' has-notes' : '') +
          '" data-action="calendar-add" data-date="' + date + '">' +
          '<div class="cal-day-head"><b>' + dt.getDate() + '</b>' +
            (notes.length ? '<i class="cal-dot" title="' + notes.length + ' 条记录"></i>' : '') +
          '</div>' +
          (visible.length ? '<div class="cal-day-notes">' + visible.map((n) =>
            '<span class="cal-mini-note" data-action="calendar-edit" data-id="' + n.id + '" title="' +
              esc(n.text || '') + '">' + esc(n.text || '') + '</span>').join('') + '</div>' : '') +
        '</div>';
      }
    }
    grid += '</div>';
    return '<section class="cal-month-card">' +
      '<h4><span>' + monthYearLabel(y, m) + '</span>' +
        (monthNoteCount ? '<small>' + monthNoteCount + ' 条记录</small>' : '') +
      '</h4>' + grid +
    '</section>';
  }
  function calendarRecordsSorted() {
    const d = today();
    return calendarNotes().slice().sort((a, b) => {
      const da = Math.abs(Core.dayDiff(d, a.date));
      const db = Math.abs(Core.dayDiff(d, b.date));
      if (da !== db) return da - db;
      if (a.date !== b.date) return a.date > b.date ? -1 : 1;
      return String(a.createdAt || '') < String(b.createdAt || '') ? -1 : 1;
    });
  }
  function calendarRecordsHTML() {
    const list = calendarRecordsSorted();
    if (!list.length) return emptyBox('还没有日历记录。点任意日期即可写一条。');
    return '<div class="cal-records">' + list.map((n) => {
      return '<div class="cal-record-item" data-id="' + n.id + '">' +
        '<button class="cal-record-main" type="button" data-action="calendar-edit" data-id="' + n.id + '">' +
          '<span class="cal-record-date">' + Core.fmtCN(n.date).replace(' ', ' · ') + '</span>' +
          '<span class="cal-record-text">' + esc(n.text || '') + '</span>' +
        '</button>' +
        '<button class="cal-record-del" type="button" data-action="calendar-del" data-id="' + n.id + '" title="删除这条记录">✕</button>' +
      '</div>';
    }).join('') + '</div>';
  }
  function renderCalendar() {
    const notesByDate = {};
    calendarNotes().forEach((n) => {
      if (!notesByDate[n.date]) notesByDate[n.date] = [];
      notesByDate[n.date].push(n);
    });
    const months = calendarViewMonths();
    return section('日历',
      '<div class="cal-toolbar">' +
        '<div class="cal-zoom" role="group" aria-label="日历缩放">' +
          [['0', '本月'], ['1', '三个月'], ['2', '十二个月']].map((x) =>
            '<button type="button" class="cal-zoom-btn' + (String(calendarZoom) === x[0] ? ' is-on' : '') +
              '" data-action="calendar-zoom" data-zoom="' + x[0] + '">' + x[1] + '</button>').join('') +
        '</div>' +
        '<span class="hint tight">点日期写记录；回车保存，可连续添加多条。绿色浅块和圆点表示当天有记录。</span>' +
      '</div>' +
      '<div class="cal-months zoom-' + calendarZoom + '">' +
        months.map((x) => calendarMonthGrid(x.y, x.m, notesByDate)).join('') +
      '</div>', '', 'acc-blue') +
      section('日历记录 · 从最近到最远', calendarRecordsHTML() +
        '<p class="hint tight">点一条即可改文字；✕ 删除。记录会同步到三端，并在今日页提醒未来 7 天内的内容。</p>', '', 'acc-green');
  }
  function closeCalendarComposer() {
    if (calendarComposer && calendarComposer.el) calendarComposer.el.remove();
    calendarComposer = null;
  }
  function openCalendarComposer(date, anchor, note) {
    closeCalendarComposer();
    const el = document.createElement('div');
    el.className = 'cal-composer';
    el.innerHTML = '<div class="cal-composer-head"><b>' + esc(Core.fmtCN(date)) + '</b>' +
      '<button type="button" data-cal-close="1" aria-label="关闭">✕</button></div>' +
      '<form><input type="text" maxlength="300" placeholder="写点事情，回车保存…" value="' +
        esc(note ? note.text || '' : '') + '" autocomplete="off" /></form>' +
      '<div class="hint">回车保存 · Esc 取消' + (note ? ' · 修改后可直接删除' : ' · 同一天可添加多条') + '</div>';
    document.body.appendChild(el);
    const form = el.querySelector('form');
    const input = el.querySelector('input');
    const rect = anchor && anchor.getBoundingClientRect ? anchor.getBoundingClientRect() : null;
    const width = Math.min(360, window.innerWidth - 16);
    el.style.width = width + 'px';
    if (rect) {
      let left = Math.min(Math.max(8, rect.left), window.innerWidth - width - 8);
      let top = rect.bottom + 8;
      const h = el.getBoundingClientRect().height || 130;
      if (top + h > window.innerHeight - 8) top = Math.max(8, rect.top - h - 8);
      el.style.left = Math.round(left) + 'px';
      el.style.top = Math.round(top) + 'px';
    } else {
      el.style.left = Math.round((window.innerWidth - width) / 2) + 'px';
      el.style.top = '20vh';
    }
    calendarComposer = { el, date, note };
    input.focus();
    input.select();
    const close = () => closeCalendarComposer();
    el.querySelector('[data-cal-close]').addEventListener('click', close);
    el.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') { e.preventDefault(); close(); }
    });
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const text = input.value.trim();
      if (!text) { input.focus(); return; }
      if (note) {
        store.saveTask(Object.assign({}, note, {
          text, title: text, updatedAt: new Date().toISOString()
        }));
        toast('日历记录已修改');
      } else {
        const it = Core.newItem({ kind: CAL_NOTE_KIND, date, text, title: text });
        it.createdAt = new Date().toISOString();
        store.saveTask(it);
        toast('已记到 ' + Core.fmtCN(date));
      }
      close();
    });
    const outside = (e) => {
      if (!el.isConnected) { document.removeEventListener('pointerdown', outside, true); return; }
      if (!el.contains(e.target) && !(anchor && anchor.contains && anchor.contains(e.target))) {
        close();
        document.removeEventListener('pointerdown', outside, true);
      }
    };
    setTimeout(() => document.addEventListener('pointerdown', outside, true), 0);
  }

  /* ---------- 日程：今天起 7 张按日期绑定的富文本纸 ---------- */
  const dayPaperKey = (date) => 'day:' + date;
  const dayPaperEditorId = (date) => 'daypaper-' + date;
  const dayPaperToolbarId = (date) => 'daypaper-toolbar-' + date;
  function dayPaperTextNow(date) {
    const st = richDocState(dayPaperKey(date));
    if (st && st.draft != null) return st.draft;
    const item = dayPaperFor(date);
    return item && typeof item.memo === 'string' ? item.memo : '';
  }
  function dayPaperHtmlNow(date) {
    const st = richDocState(dayPaperKey(date));
    if (st && st.html != null) return st.html;
    const item = dayPaperFor(date);
    const text = dayPaperTextNow(date);
    return memoHtmlForItem(item, text) || memoTextToHtml(text);
  }
  function dayPaperStamp(date) {
    const item = dayPaperFor(date);
    if (!item || !item.updatedAt) return '自动保存';
    const d = new Date(item.updatedAt);
    if (isNaN(d.getTime())) return '自动保存';
    return '已保存 · ' + p2(d.getHours()) + ':' + p2(d.getMinutes());
  }
  function flushDayPaper(date) {
    const key = dayPaperKey(date);
    const st = richDocState(key);
    if (st.timer) { clearTimeout(st.timer); st.timer = null; }
    if (!st.dirty && st.draft == null) return;
    const ed = document.getElementById(dayPaperEditorId(date));
    const text = ed ? memoEditorPlain(ed) : st.draft;
    if (text == null) return;
    const html = ed ? memoEditorHtml(ed) : (st.html != null ? st.html : memoTextToHtml(text));
    st.dirty = false;
    const item = dayPaperFor(date);
    const prevText = item && typeof item.memo === 'string' ? item.memo : '';
    const prevHtml = item && typeof item.memoHtml === 'string' ? item.memoHtml : '';
    if (text === prevText && html === prevHtml) {
      st.draft = null;
      st.html = null;
      return;
    }
    const base = item || Core.newItem({ kind: DAY_PAPER_KIND, date, title: '日程 ' + date });
    st.draft = null;
    st.html = null;
    st.flushing = true;
    try {
      store.saveTask(Object.assign({}, base, {
        kind: DAY_PAPER_KIND,
        date,
        memo: text,
        memoHtml: html || memoTextToHtml(text),
        updatedAt: new Date().toISOString()
      }));
    } finally {
      st.flushing = false;
    }
  }
  function flushAllDayPapers() {
    Object.keys(RICH_DOCS)
      .filter((key) => key.indexOf('day:') === 0)
      .forEach((key) => flushDayPaper(key.slice(4)));
  }
  function dayPaperMeta(date) {
    const state = document.getElementById('daypaper-state-' + date);
    if (state) state.textContent = richDocState(dayPaperKey(date)).dirty ? '保存中…' : dayPaperStamp(date);
  }
  function dayPaperOnInput(date, ed) {
    const st = richDocState(dayPaperKey(date));
    st.dirty = true;
    st.draft = memoEditorPlain(ed);
    st.html = memoEditorHtml(ed);
    ed.classList.toggle('is-empty', !st.draft.trim() && !ed.querySelector('table,hr,img,[data-flow]'));
    dayPaperMeta(date);
    if (st.timer) clearTimeout(st.timer);
    st.timer = setTimeout(() => {
      st.timer = null;
      flushDayPaper(date);
      dayPaperMeta(date);
    }, 800);
  }
  function applyDayPaperText(date, text) {
    const key = dayPaperKey(date);
    const st = richDocState(key);
    const oldText = dayPaperTextNow(date);
    const oldHtml = dayPaperHtmlNow(date);
    const html = memoRichFromText(oldText, oldHtml, text);
    const ed = document.getElementById(dayPaperEditorId(date));
    if (ed) memoSetEditor(ed, html);
    st.draft = normalizeMemoPlain(text);
    st.html = html;
    st.dirty = true;
    flushDayPaper(date);
    dayPaperMeta(date);
  }
  function renderAgenda() {
    const dates = calendarNearDates(7);
    return '<section class="card agenda-intro"><h3>未来 7 天日程</h3>' +
      '<p class="hint tight">每天一张富文本纸，从一行开始，写多少长多少。跨天后如果前一天还有内容，会自动滚到当天最前面，并标注「昨天剩下内容」。</p></section>' +
      dates.map((date, i) => {
        const key = dayPaperKey(date);
        const st = richDocState(key);
        const text = st.draft != null ? st.draft : dayPaperTextNow(date);
        const html = sanitizeMemoHtml(dayPaperHtmlNow(date));
        const empty = !String(text || '').trim() && !memoHtmlHasContent(html);
        const d = Core.parseDate(date);
        return '<section class="card agenda-card' + (i === 0 ? ' is-today' : '') + '">' +
          '<div class="agenda-head"><div><h3>' + Core.fmtCN(date) + '</h3>' +
            '<span class="hint tight">' + (i === 0 ? '今天' : '未来第 ' + (i + 1) + ' 天') + '</span></div>' +
            '<span class="hint tight" id="daypaper-state-' + date + '">' + esc(dayPaperStamp(date)) + '</span></div>' +
          '<div class="memo-editor-shell day-paper-shell">' +
            richToolbarHTML(dayPaperToolbarId(date)) +
            '<div id="' + dayPaperEditorId(date) + '" class="memo-editor day-paper-editor' +
              (empty ? ' is-empty' : '') + '" contenteditable="true" role="textbox" aria-multiline="true" ' +
              'spellcheck="false" data-doc-key="' + esc(key) + '" ' +
              'data-placeholder="' + esc(i === 0 ? '今天要做什么？' : '这一天先留白，想到再写…') + '">' +
              html + '</div>' +
          '</div>' +
          '<div class="timer-add day-timer-add">' +
            '<span class="timer-add-label">' + Core.TIMER_MARK + ' 提醒</span>' +
            '<input type="date" data-day-timer-date="' + date + '" value="' + date + '" />' +
            '<button class="btn btn-sm" type="button" data-action="day-timer-add" data-date="' + date + '">加到光标那一行</button>' +
          '</div>' +
        '</section>';
      }).join('');
  }
  let dayRolloverRunning = false;
  let dayRolloverQueued = false;
  function dayPaperHasText(item) {
    return !!String(item && item.memo || '').trim() ||
      !!memoHtmlHasContent(item && item.memoHtml);
  }
  function prependRolloverLabel(html, label) {
    const box = document.createElement('div');
    box.innerHTML = sanitizeMemoHtml(html);
    const mark = document.createElement('b');
    mark.className = 'day-rollover-mark';
    mark.setAttribute('data-rollover', '1');
    mark.textContent = label;
    const first = box.firstElementChild;
    if (first && first.tagName !== 'TABLE' && first.tagName !== 'HR' &&
        first.tagName !== 'IMG' && !first.hasAttribute('data-flow')) {
      first.insertBefore(mark, first.firstChild);
    } else {
      box.insertBefore(mark, box.firstChild);
    }
    return box.innerHTML;
  }
  function rollDayPapers() {
    if (dayRolloverRunning) return;
    const d = today();
    const past = dayPapers()
      .filter((p) => p.date < d && dayPaperHasText(p))
      .sort((a, b) => a.date < b.date ? -1 : 1);
    if (!past.length) return;
    const target = dayPaperFor(d);
    const targetText = target && typeof target.memo === 'string' ? target.memo : '';
    const targetHtml = target ? (target.memoHtml || memoTextToHtml(targetText)) : '';
    const chunks = past.map((p) => {
      const label = p.date === Core.shiftDate(d, -1)
        ? '昨天剩下内容：'
        : shortDay(p.date) + ' 剩下内容：';
      const text = String(p.memo || '').trim();
      const html = sanitizeMemoHtml(p.memoHtml || memoTextToHtml(text));
      return {
        label, text, html,
        plain: label + text,
        rich: prependRolloverLabel(html, label)
      };
    });
    const spacer = '<div><br></div><div><br></div>';
    const mergedText = chunks.map((x) => x.plain).join('\n\n\n') +
      (String(targetText || '').trim() ? '\n\n\n' + targetText : '');
    const mergedHtml = chunks.map((x) => x.rich).join(spacer) +
      (memoHtmlHasContent(targetHtml) || String(targetText || '').trim() ? spacer + targetHtml : '');
    dayRolloverRunning = true;
    try {
      past.forEach((p) => {
        store.saveTask(Object.assign({}, p, {
          memo: '',
          memoHtml: '',
          rolledTo: d,
          rolledAt: new Date().toISOString(),
          updatedAt: new Date().toISOString()
        }));
      });
      const base = target || Core.newItem({ kind: DAY_PAPER_KIND, date: d, title: '日程 ' + d });
      store.saveTask(Object.assign({}, base, {
        kind: DAY_PAPER_KIND,
        date: d,
        memo: mergedText,
        memoHtml: mergedHtml || memoTextToHtml(mergedText),
        updatedAt: new Date().toISOString()
      }));
      toast('已把之前没写完的日程滚到今天');
    } finally {
      dayRolloverRunning = false;
    }
  }
  function queueDayRollover() {
    if (dayRolloverQueued) return;
    dayRolloverQueued = true;
    setTimeout(() => {
      dayRolloverQueued = false;
      rollDayPapers();
    }, 120);
  }

  /* ---------- 计划底稿 + 周报：都能直接写富文本，按任务条目同步 ---------- */
  const REPORT_DOC_PREFIX = 'report:';
  const monthNoteItem = () => items().find((t) => t && t.kind === MONTH_NOTE_KIND) || null;
  const reportById = (id) => items().find((t) => t && t.kind === REPORT_KIND && t.id === id) || null;
  function reportItems() {
    return itemOfKind(REPORT_KIND).slice().sort((a, b) => {
      const aa = String(a.createdAt || a.created || '');
      const bb = String(b.createdAt || b.created || '');
      if (aa !== bb) return aa < bb ? 1 : -1;
      return String(a.id || '') < String(b.id || '') ? 1 : -1;
    });
  }
  function richDocSpec(key) {
    if (key === MONTH_NOTE_KIND) {
      return {
        key, kind: MONTH_NOTE_KIND, title: '计划底稿',
        editorId: 'monthnote-editor', toolbarId: 'monthnote-toolbar',
        countId: 'monthnote-count', stateId: 'monthnote-state'
      };
    }
    if (String(key).indexOf(REPORT_DOC_PREFIX) === 0) {
      const id = String(key).slice(REPORT_DOC_PREFIX.length);
      return {
        key, kind: REPORT_KIND, id,
        editorId: 'report-editor', toolbarId: 'report-toolbar',
        countId: 'report-count', stateId: 'report-state'
      };
    }
    return null;
  }
  function richDocBase(key) {
    return key === MONTH_NOTE_KIND ? monthNoteItem() : reportById(String(key).slice(REPORT_DOC_PREFIX.length));
  }
  function richDocText(key) {
    const base = richDocBase(key);
    return base && typeof base.memo === 'string' ? base.memo : '';
  }
  function richDocTextNow(key) {
    const st = richDocState(key);
    return st && st.draft != null ? st.draft : richDocText(key);
  }
  function richDocHtmlNow(key) {
    const st = richDocState(key);
    if (st && st.html != null) return st.html;
    const base = richDocBase(key);
    const text = richDocText(key);
    return memoHtmlForItem(base, text) || memoTextToHtml(text);
  }
  function richDocStamp(key) {
    const base = richDocBase(key);
    if (!base || !base.updatedAt) return key === MONTH_NOTE_KIND ? '还没有内容' : '自动保存';
    const d = new Date(base.updatedAt);
    if (isNaN(d.getTime())) return '自动保存';
    const p = (n) => String(n).padStart(2, '0');
    return '已保存 · ' + p(d.getHours()) + ':' + p(d.getMinutes());
  }
  function richDocShellHTML(key) {
    const spec = richDocSpec(key);
    const st = richDocState(key);
    const base = richDocBase(key);
    const text = st.draft != null ? st.draft : (base && typeof base.memo === 'string' ? base.memo : '');
    const html = st.html != null ? st.html : (memoHtmlForItem(base, text) || memoTextToHtml(text));
    const cleanHtml = sanitizeMemoHtml(html);
    const empty = !String(text || '').trim() && !memoHtmlHasContent(cleanHtml);
    const ph = key === MONTH_NOTE_KIND
      ? '把所有想做的事先写在这里，再从里面挑出这个月要推进的，填到上面的排期里…'
      : '写这一周的进展、问题、下周安排…';
    return '<div class="memo-editor-shell rich-doc-shell">' +
        richToolbarHTML(spec.toolbarId) +
        '<div id="' + spec.editorId + '" class="memo-editor rich-doc-editor' + (empty ? ' is-empty' : '') + '" ' +
          'contenteditable="true" role="textbox" aria-multiline="true" spellcheck="false" ' +
          'data-doc-key="' + esc(key) + '" data-placeholder="' + esc(ph) + '">' + cleanHtml + '</div>' +
      '</div>' +
      '<div class="doc-foot"><span class="hint" id="' + spec.stateId + '">' + esc(richDocStamp(key)) + '</span></div>';
  }
  function richDocTimerAddHTML(key) {
    return '<div class="timer-add doc-timer-add">' +
      '<span class="timer-add-label">' + Core.TIMER_MARK + ' 提醒</span>' +
      '<input type="date" data-doc-timer-date="' + esc(key) + '" value="' + esc(today()) + '" />' +
      '<button class="btn btn-sm" type="button" data-action="doc-timer-add" data-doc-key="' + esc(key) + '">加到光标那一行</button>' +
    '</div>';
  }
  function flushRichDoc(key) {
    const spec = richDocSpec(key);
    if (!spec) return;
    const st = richDocState(key);
    if (st.timer) { clearTimeout(st.timer); st.timer = null; }
    if (!st.dirty && st.draft == null) return;
    const ed = document.getElementById(spec.editorId);
    const text = ed ? memoEditorPlain(ed) : st.draft;
    if (text == null) return;
    const html = ed ? memoEditorHtml(ed) : (st.html != null ? st.html : memoTextToHtml(text));
    st.dirty = false;
    const base = richDocBase(key);
    const prevText = base && typeof base.memo === 'string' ? base.memo : '';
    const prevHtml = base && typeof base.memoHtml === 'string' ? base.memoHtml : '';
    if (spec.kind === REPORT_KIND && !base) {
      st.draft = null;
      st.html = null;
      return;
    }
    if (text === prevText && html === prevHtml) {
      st.draft = null;
      st.html = null;
      return;
    }
    const item = base || Core.newItem({ kind: spec.kind, title: spec.title || '周报' });
    st.draft = null;
    st.html = null;
    st.flushing = true;
    try {
      store.saveTask(Object.assign({}, item, {
        memo: text,
        memoHtml: html || memoTextToHtml(text),
        updatedAt: new Date().toISOString()
      }));
    } finally {
      st.flushing = false;
    }
  }
  function flushAllRichDocs() {
    Object.keys(RICH_DOCS).forEach((key) => {
      if (key.indexOf('day:') === 0) flushDayPaper(key.slice(4));
      else flushRichDoc(key);
    });
  }
  function applyRichDocText(key, text) {
    const spec = richDocSpec(key);
    if (!spec) return;
    const st = richDocState(key);
    const oldText = richDocTextNow(key);
    const oldHtml = richDocHtmlNow(key);
    const html = memoRichFromText(oldText, oldHtml, text);
    const ed = document.getElementById(spec.editorId);
    if (ed) memoSetEditor(ed, html);
    st.draft = normalizeMemoPlain(text);
    st.html = html;
    st.dirty = true;
    flushRichDoc(key);
    richDocMeta(key);
  }
  function richDocMeta(key) {
    const spec = richDocSpec(key);
    if (!spec) return;
    const st = richDocState(key);
    const cnt = document.getElementById(spec.countId);
    if (cnt) cnt.textContent = (st.draft != null ? st.draft : richDocText(key)).length + ' 字';
    const state = document.getElementById(spec.stateId);
    if (state) state.textContent = st.dirty ? '保存中…' : richDocStamp(key);
  }
  function richDocOnInput(key) {
    const spec = richDocSpec(key);
    const ed = spec && document.getElementById(spec.editorId);
    if (!ed) return;
    const st = richDocState(key);
    st.dirty = true;
    st.draft = memoEditorPlain(ed);
    st.html = memoEditorHtml(ed);
    ed.classList.toggle('is-empty', !st.draft.trim() && !ed.querySelector('table,hr'));
    richDocMeta(key);
    if (st.timer) clearTimeout(st.timer);
    st.timer = setTimeout(() => {
      st.timer = null;
      flushRichDoc(key);
      richDocMeta(key);
    }, 800);
  }
  function renderMonthNote() {
    const st = richDocState(MONTH_NOTE_KIND);
    const text = st.draft != null ? st.draft : richDocText(MONTH_NOTE_KIND);
    return '<section class="card month-note-card">' +
      '<h3>计划底稿 <span class="cnt" id="monthnote-count">' + text.length + ' 字</span></h3>' +
      '<p class="hint tight">先把所有想做的事都放在这张纸上；再挑出最近一个月要推进的，填到上面的四周排期里。停手约 1 秒自动保存并同步三端。</p>' +
      richDocShellHTML(MONTH_NOTE_KIND) +
      richDocTimerAddHTML(MONTH_NOTE_KIND) +
      '</section>';
  }
  function reportWhen(item) {
    const raw = item && (item.createdAt || item.updatedAt || item.created);
    if (!raw) return '';
    const d = new Date(raw);
    if (isNaN(d.getTime())) return String(raw).slice(0, 10);
    const p = (n) => String(n).padStart(2, '0');
    return (d.getMonth() + 1) + '.' + p(d.getDate());
  }
  function renderReports() {
    const list = reportItems();
    if (activeReportId && !reportById(activeReportId)) activeReportId = null;
    if (!activeReportId && list.length) activeReportId = list[0].id;
    const active = activeReportId ? reportById(activeReportId) : null;
    const naming = reportNaming
      ? '<form id="report-new-form" class="report-name-form">' +
          '<input id="report-name" type="text" maxlength="80" autocomplete="off" placeholder="例如：11 月第二周周报" />' +
          '<button class="btn btn-sm btn-primary" type="submit">创建</button>' +
          '<button class="btn btn-sm" type="button" data-action="report-name-cancel">取消</button>' +
        '</form>'
      : '';
    const banners = list.map((r) =>
      '<div class="report-banner' + (r.id === activeReportId ? ' is-active' : '') + '">' +
        '<button class="report-banner-hit" type="button" data-action="report-select" data-id="' + r.id + '">' +
          '<b>' + esc(r.title || '未命名周报') + '</b>' +
          '<span>' + esc(reportWhen(r)) + '</span>' +
        '</button>' +
      '</div>'
    ).join('');
    const right = active
      ? '<article class="report-paper" data-report-paper="' + active.id + '">' +
          '<div class="report-paper-head">' +
            '<div class="report-paper-title"><b>' + esc(active.title || '未命名周报') + '</b>' +
              '<span>创建于 ' + esc(reportWhen(active)) + ' · 自动保存</span></div>' +
            '<button class="mini-btn" type="button" data-action="report-delete" data-id="' + active.id + '">删除</button>' +
          '</div>' +
          '<div class="report-paper-scroll">' +
            richDocShellHTML(REPORT_DOC_PREFIX + active.id) +
            richDocTimerAddHTML(REPORT_DOC_PREFIX + active.id) +
          '</div>' +
        '</article>'
      : '<div class="report-empty"><b>还没有周报</b><span>点左上角「＋ 新增周报」，输入名称后按回车，左侧就会出现一张可点击的周报卡片。</span></div>';
    return '<section class="card reports-card">' +
      '<div class="reports-head">' +
        '<div class="reports-titlebar">' +
          '<button class="btn btn-sm btn-primary report-new-btn" type="button" data-action="report-new">＋ 新增周报</button>' +
          '<div><h3>周报 <span class="cnt">' + list.length + ' 份</span></h3>' +
            '<p class="hint tight">左侧选周报，右侧直接写；两栏各自滚动，不会互相带着跑。</p></div>' +
        '</div>' +
        naming +
      '</div>' +
      '<div class="reports-workspace">' +
        '<aside class="report-list-panel">' +
          '<div class="report-list-cap">周报列表</div>' +
          '<div class="report-banner-list">' +
            (banners || '<div class="report-list-empty">还没有周报</div>') +
          '</div>' +
        '</aside>' +
        '<div class="report-pane">' + right + '</div>' +
      '</div>' +
      '</section>';
  }

  /* ---------- 备忘录（琐事 / 创意）：一整张纸，随便写、随时改 ---------- */
  /* 富文本正文存 memoHtml；memo 继续存纯文本，倒计时、打勾、进展都还按纯文本工作。
   * 这样旧数据不用迁移，新增格式也只影响显示层。 */
  const MEMO_DROP_TAGS = new Set([
    'SCRIPT', 'STYLE', 'IFRAME', 'OBJECT', 'EMBED', 'FORM', 'INPUT', 'TEXTAREA',
    'BUTTON', 'SELECT', 'OPTION', 'LINK', 'META', 'BASE', 'SVG', 'MATH',
    'VIDEO', 'AUDIO', 'SOURCE', 'CANVAS'
  ]);
  const MEMO_ALLOWED_TAGS = new Set([
    'DIV', 'P', 'BR', 'B', 'STRONG', 'I', 'EM', 'U', 'S', 'STRIKE',
    'SPAN', 'FONT', 'H2', 'H3', 'H4', 'UL', 'OL', 'LI', 'BLOCKQUOTE',
    'PRE', 'CODE', 'HR', 'TABLE', 'THEAD', 'TBODY', 'TFOOT', 'TR',
    'TH', 'TD', 'CAPTION', 'COLGROUP', 'COL', 'IMG'
  ]);
  const MEMO_IMAGE_DATA_LIMIT = 220000;
  const MEMO_ALLOWED_STYLE = new Set([
    'color', 'background-color', 'font-size', 'font-weight', 'font-style',
    'text-decoration', 'text-align'
  ]);
  function normalizeMemoPlain(text) {
    return String(text == null ? '' : text)
      .replace(/\r\n?/g, '\n')
      .replace(/\u00a0/g, ' ')
      .replace(/\n+$/, '');
  }
  function memoCleanStyle(value) {
    const out = [];
    String(value || '').split(';').forEach((part) => {
      const at = part.indexOf(':');
      if (at < 0) return;
      const k = part.slice(0, at).trim().toLowerCase();
      let v = part.slice(at + 1).trim();
      if (!MEMO_ALLOWED_STYLE.has(k) || !v || /url\s*\(|expression|javascript:|@import/i.test(v)) return;
      v = v.replace(/\s*!important\s*$/i, '');
      if ((k === 'color' || k === 'background-color') &&
          !/^(#[0-9a-f]{3,8}|(?:rgb|hsl)a?\([^)]*\)|[a-z]+)$/i.test(v)) return;
      if (k === 'font-size' && !/^\d+(?:\.\d+)?(?:px|pt|em|rem|%)$/i.test(v)) return;
      if (k === 'font-weight' && !/^(normal|bold|bolder|lighter|[1-9]00)$/i.test(v)) return;
      if (k === 'text-align' && !/^(left|right|center|justify|start|end)$/i.test(v)) return;
      out.push(k + ':' + v);
    });
    return out.join(';');
  }
  function sanitizeMemoHtml(html) {
    const tpl = document.createElement('template');
    tpl.innerHTML = String(html == null ? '' : html);
    const walk = (parent) => {
      Array.from(parent.childNodes).forEach((node) => {
        if (node.nodeType === 3) return;
        if (node.nodeType !== 1) { node.remove(); return; }
        const tag = node.tagName.toUpperCase();
        if (MEMO_DROP_TAGS.has(tag)) { node.remove(); return; }
        if (!MEMO_ALLOWED_TAGS.has(tag)) {
          walk(node);
          const kids = Array.from(node.childNodes);
          if (kids.length) node.replaceWith.apply(node, kids);
          else node.remove();
          return;
        }
        Array.from(node.attributes).forEach((attr) => {
          const name = attr.name.toLowerCase();
          if (name === 'style') {
            const style = memoCleanStyle(attr.value);
            if (style) node.setAttribute('style', style);
            else node.removeAttribute(attr.name);
            return;
          }
          if (tag === 'FONT' && name === 'size' && /^[2-5]$/.test(attr.value)) return;
          if ((tag === 'TD' || tag === 'TH') && (name === 'colspan' || name === 'rowspan') &&
              /^[1-9]\d?$/.test(attr.value)) return;
          if (tag === 'IMG' && name === 'src' &&
              /^data:image\/(?:png|jpe?g|webp);base64,[a-z0-9+/=]+$/i.test(attr.value) &&
              attr.value.length <= MEMO_IMAGE_DATA_LIMIT) return;
          if (tag === 'IMG' && name === 'alt') {
            node.setAttribute('alt', String(attr.value || '').slice(0, 120));
            return;
          }
          if (tag === 'B' && name === 'data-rollover' && attr.value === '1') return;
          if (tag === 'DIV' && name === 'data-flow' &&
              /^[a-z0-9_-]{4,200000}$/i.test(attr.value)) return;
          node.removeAttribute(attr.name);
        });
        if (tag === 'IMG') {
          if (!node.getAttribute('src')) node.remove();
          return;
        }
        if (tag === 'DIV' && node.hasAttribute('data-flow')) {
          /* 流程图只存压缩后的节点/连线数据；显示层每次从 data-flow 重新画，避免保存两份。 */
          node.textContent = '';
          return;
        }
        if (tag === 'FONT' && !node.getAttribute('size')) {
          const kids = Array.from(node.childNodes);
          if (kids.length) node.replaceWith.apply(node, kids);
          else node.remove();
          return;
        }
        if (tag === 'SPAN' && !node.getAttribute('style')) {
          const kids = Array.from(node.childNodes);
          if (kids.length) node.replaceWith.apply(node, kids);
          else node.remove();
          return;
        }
        walk(node);
      });
    };
    walk(tpl.content);
    return tpl.innerHTML;
  }
  function memoHtmlHasContent(html) {
    return /<(?:table|hr|img)\b|data-flow=/i.test(String(html || ''));
  }
  function memoLineHtml(line) {
    const s = String(line == null ? '' : line);
    return '<div>' + (s ? esc(s) : '<br>') + '</div>';
  }
  function memoTextToHtml(text) {
    const s = normalizeMemoPlain(text);
    if (!s) return '';
    return s.split('\n').map(memoLineHtml).join('');
  }
  const MEMO_LINE_BLOCKS = new Set([
    'DIV', 'P', 'H2', 'H3', 'H4', 'LI', 'BLOCKQUOTE', 'PRE', 'TABLE', 'HR'
  ]);
  function memoTableSummary(table) {
    return Array.from(table.rows || []).map((tr) =>
      Array.from(tr.cells || []).map((td) =>
        normalizeMemoPlain(td.textContent || '').replace(/\s+/g, ' ').trim()
      ).join(' | ')
    ).join(' / ');
  }
  function memoDomPlain(root) {
    let out = '';
    const cut = () => { if (out && !/\n$/.test(out)) out += '\n'; };
    const walk = (node) => {
      if (node.nodeType === 3) { out += node.nodeValue || ''; return; }
      if (node.nodeType !== 1) return;
      const tag = node.tagName.toUpperCase();
      if (tag === 'BR') { out += '\n'; return; }
      if (node.hasAttribute('data-flow')) {
        cut();
        out += '[流程图]';
        cut();
        return;
      }
      if (tag === 'IMG') {
        cut();
        out += '[图片]';
        cut();
        return;
      }
      if (tag === 'TABLE') {
        cut();
        out += memoTableSummary(node);
        cut();
        return;
      }
      if (tag === 'HR') { cut(); out += '\n'; return; }
      const block = MEMO_LINE_BLOCKS.has(tag);
      if (block) cut();
      Array.from(node.childNodes).forEach(walk);
      if (block) cut();
    };
    Array.from(root.childNodes).forEach(walk);
    return normalizeMemoPlain(out);
  }
  function memoStoredHtml(item) {
    return item && typeof item.memoHtml === 'string' ? item.memoHtml : '';
  }
  function memoHtmlForItem(item, text) {
    const stored = memoStoredHtml(item);
    if (!stored) return '';
    /* 三端滚动更新时，旧版本可能只改了 memo 纯文本、没改 memoHtml。
     * 两份对不上就以纯文本为准，避免新版一直显示旧格式里的旧内容。 */
    const box = document.createElement('div');
    box.innerHTML = sanitizeMemoHtml(stored);
    return memoDomPlain(box) === normalizeMemoPlain(text) ? stored : memoTextToHtml(text);
  }
  function memoHtmlNow(tab) {
    const st = memoState[tab];
    if (st && st.html != null) return st.html;
    const item = Core.memoOf(items(), MEMOS[tab].kind);
    const text = Core.memoText(items(), MEMOS[tab].kind);
    return memoHtmlForItem(item, text) || memoTextToHtml(text);
  }
  function memoBlockText(node) {
    if (node.tagName === 'TABLE') return memoTableSummary(node);
    return memoDomPlain(node);
  }
  function memoHtmlBlocks(html) {
    const root = document.createElement('div');
    root.innerHTML = sanitizeMemoHtml(html);
    const blocks = [];
    let inline = [];
    const flushInline = () => {
      if (!inline.length) return;
      const wrap = document.createElement('div');
      inline.forEach((node) => wrap.appendChild(node.cloneNode(true)));
      const text = memoDomPlain(wrap);
      blocks.push({ html: '<div>' + (wrap.innerHTML || '<br>') + '</div>', text, multi: text.indexOf('\n') >= 0 });
      inline = [];
    };
    Array.from(root.childNodes).forEach((node) => {
      if (node.nodeType === 3) {
        String(node.nodeValue || '').split('\n').forEach((part, i) => {
          if (i > 0) flushInline();
          if (part) inline.push(document.createTextNode(part));
        });
        return;
      }
      if (node.nodeType !== 1) return;
      if (node.tagName === 'BR') {
        if (inline.length) flushInline();
        else blocks.push({ html: '<div><br></div>', text: '' });
        return;
      }
      if (MEMO_LINE_BLOCKS.has(node.tagName)) {
        flushInline();
        const text = memoBlockText(node);
        blocks.push({ html: node.outerHTML, text, multi: text.indexOf('\n') >= 0 });
        return;
      }
      inline.push(node);
    });
    flushInline();
    while (blocks.length && !blocks[blocks.length - 1].text) blocks.pop();
    return blocks;
  }
  function memoRichFromText(oldText, oldHtml, newText) {
    const oldLines = normalizeMemoPlain(oldText).split('\n');
    const newLines = normalizeMemoPlain(newText).split('\n');
    const nextPlain = normalizeMemoPlain(newText);
    if (!nextPlain) return '';
    if (!normalizeMemoPlain(oldText)) return memoTextToHtml(nextPlain);
    const blocks = memoHtmlBlocks(oldHtml);
    if (blocks.length !== oldLines.length || blocks.some((b) => b.multi)) {
      return memoTextToHtml(nextPlain);
    }
    const count = (lines) => {
      const map = new Map();
      lines.forEach((line) => map.set(line, (map.get(line) || 0) + 1));
      return map;
    };
    const a = count(oldLines);
    const b = count(newLines);
    let same = a.size === b.size;
    if (same) a.forEach((n, line) => { if (b.get(line) !== n) same = false; });
    if (same) {
      const buckets = new Map();
      oldLines.forEach((line, i) => {
        if (!buckets.has(line)) buckets.set(line, []);
        buckets.get(line).push(blocks[i].html);
      });
      return newLines.map((line) => buckets.get(line).shift()).join('');
    }
    const n = oldLines.length;
    const m = newLines.length;
    if (!n || !m || n * m > 220000) return memoTextToHtml(nextPlain);
    const dp = Array.from({ length: n + 1 }, () => new Uint16Array(m + 1));
    for (let i = n - 1; i >= 0; i -= 1) {
      for (let j = m - 1; j >= 0; j -= 1) {
        dp[i][j] = oldLines[i] === newLines[j]
          ? dp[i + 1][j + 1] + 1
          : Math.max(dp[i + 1][j], dp[i][j + 1]);
      }
    }
    const match = new Array(m).fill(-1);
    let i = 0;
    let j = 0;
    while (i < n && j < m) {
      if (oldLines[i] === newLines[j]) { match[j] = i; i += 1; j += 1; }
      else if (dp[i + 1][j] >= dp[i][j + 1]) i += 1;
      else j += 1;
    }
    return newLines.map((line, k) =>
      match[k] >= 0 ? blocks[match[k]].html : memoLineHtml(line)
    ).join('');
  }
  function memoEditorPlain(ed) {
    return ed ? memoDomPlain(ed) : '';
  }
  function memoEditorHtml(ed) {
    return ed ? sanitizeMemoHtml(ed.innerHTML) : '';
  }
  function memoSetEditor(ed, html) {
    if (!ed) return;
    ed.innerHTML = sanitizeMemoHtml(html);
    hydrateFlowFigures(ed);
    const has = !!(ed.textContent || '').trim() || !!ed.querySelector('table,hr,img,[data-flow]');
    ed.classList.toggle('is-empty', !has);
  }
  function memoCaretLine(ed) {
    const fallback = Math.max(0, memoEditorPlain(ed).split('\n').length - 1);
    const sel = window.getSelection();
    if (!ed || !sel || !sel.rangeCount || !sel.anchorNode || !ed.contains(sel.anchorNode)) return fallback;
    const range = sel.getRangeAt(0).cloneRange();
    const marker = document.createElement('span');
    marker.textContent = '\u200b';
    try { range.insertNode(marker); } catch (err) { return fallback; }
    const text = memoEditorPlain(ed);
    const at = text.indexOf('\u200b');
    marker.remove();
    if (at < 0) return fallback;
    return normalizeMemoPlain(text.slice(0, at)).split('\n').length - 1;
  }
  const RICH_RANGES = new Map();
  function rememberRichSelection(ed) {
    if (!ed || !ed.id) return;
    const sel = window.getSelection();
    if (sel && sel.rangeCount && sel.anchorNode && ed.contains(sel.anchorNode)) {
      RICH_RANGES.set(ed.id, sel.getRangeAt(0).cloneRange());
    }
  }
  function rememberMemoSelection() {
    const ae = document.activeElement;
    const ed = ae && ae.closest ? ae.closest('.memo-editor[contenteditable="true"]') : null;
    if (ed) rememberRichSelection(ed);
  }
  function restoreRichSelection(ed) {
    if (!ed) return;
    ed.focus();
    const sel = window.getSelection();
    if (!sel) return;
    if (sel.rangeCount && sel.anchorNode && ed.contains(sel.anchorNode)) return;
    const saved = RICH_RANGES.get(ed.id);
    if (!saved || !ed.contains(saved.commonAncestorContainer)) return;
    sel.removeAllRanges();
    sel.addRange(saved);
  }

  /* 选中文字后，在选区最左侧出现「＋」；大 / 中 / 小 / B 都是强制落到目标状态，
   * 不是简单 toggle。反复在大中小 B 之间切，也不会叠出一层层字号或粗体。 */
  let fmtMenuEditor = null;
  let fmtPositionFrame = 0;
  function hideFmtBubble() {
    const bubble = document.getElementById('fmt-bubble');
    if (!bubble) return;
    bubble.classList.add('hidden');
    bubble.classList.remove('is-open');
    bubble.setAttribute('aria-hidden', 'true');
    fmtMenuEditor = null;
  }
  function updateFmtBubble() {
    const bubble = document.getElementById('fmt-bubble');
    if (!bubble) return;
    const sel = window.getSelection();
    if (!sel || !sel.rangeCount || sel.isCollapsed) { hideFmtBubble(); return; }
    const range = sel.getRangeAt(0);
    const node = sel.anchorNode;
    const el = node && node.nodeType === 1 ? node : node && node.parentElement;
    const ed = el && el.closest ? el.closest('.memo-editor[contenteditable="true"]') : null;
    if (!ed || !ed.contains(range.commonAncestorContainer)) { hideFmtBubble(); return; }
    const rects = Array.from(range.getClientRects()).filter((r) => r.width || r.height);
    const rect = rects.length
      ? rects.reduce((a, b) => (b.left < a.left ? b : a), rects[0])
      : range.getBoundingClientRect();
    if (!rect || (!rect.width && !rect.height)) { hideFmtBubble(); return; }
    const width = bubble.offsetWidth || 28;
    const height = bubble.offsetHeight || 28;
    const left = Math.max(4, Math.min(rect.left - width - 5, window.innerWidth - width - 4));
    const top = Math.max(6, Math.min(rect.top + rect.height / 2 - height / 2, window.innerHeight - height - 6));
    bubble.style.left = Math.round(left) + 'px';
    bubble.style.top = Math.round(top) + 'px';
    bubble.classList.toggle('opens-up', top + height + 150 > window.innerHeight);
    bubble.classList.remove('hidden');
    bubble.setAttribute('aria-hidden', 'false');
    fmtMenuEditor = ed;
    rememberRichSelection(ed);
  }
  function scheduleFmtBubble() {
    if (fmtPositionFrame) return;
    fmtPositionFrame = requestAnimationFrame(() => {
      fmtPositionFrame = 0;
      updateFmtBubble();
    });
  }
  function presetBlocks(ed) {
    const sel = window.getSelection();
    if (!ed || !sel || !sel.rangeCount) return [];
    const range = sel.getRangeAt(0);
    const blocks = Array.from(ed.children).filter((el) => {
      try { return range.intersectsNode(el); } catch (err) { return false; }
    });
    if (blocks.length) return blocks;
    let node = sel.anchorNode;
    while (node && node.parentNode !== ed) node = node.parentNode;
    return node && node.nodeType === 1 ? [node] : [];
  }
  /* 空编辑器里直接敲第一行时，浏览器会把文字留成编辑器的直接文本节点；
   * 后面的换行才是 <div>。先把这个行内片段包成块，段落格式才能作用到首行。 */
  function normalizePresetRoot(ed) {
    if (!ed) return;
    const sel = window.getSelection();
    const saved = sel && sel.rangeCount && ed.contains(sel.anchorNode) && ed.contains(sel.focusNode)
      ? {
          start: sel.getRangeAt(0).startContainer,
          startOffset: sel.getRangeAt(0).startOffset,
          end: sel.getRangeAt(0).endContainer,
          endOffset: sel.getRangeAt(0).endOffset
        }
      : null;
    let run = [];
    const flush = () => {
      if (!run.length) return;
      const meaningful = run.some((node) =>
        node.nodeType !== 3 || String(node.nodeValue || '').trim()
      );
      if (!meaningful) {
        run.forEach((node) => node.remove());
        run = [];
        return;
      }
      const block = document.createElement('div');
      run[0].before(block);
      run.forEach((node) => block.appendChild(node));
      run = [];
    };
    Array.from(ed.childNodes).forEach((node) => {
      if (node.nodeType === 1 && MEMO_LINE_BLOCKS.has(node.tagName)) {
        flush();
        return;
      }
      run.push(node);
    });
    flush();
    if (!saved || !ed.contains(saved.start) || !ed.contains(saved.end)) return;
    const clamp = (node, offset) => Math.min(
      offset,
      node.nodeType === 3 ? String(node.nodeValue || '').length : node.childNodes.length
    );
    try {
      const range = document.createRange();
      range.setStart(saved.start, clamp(saved.start, saved.startOffset));
      range.setEnd(saved.end, clamp(saved.end, saved.endOffset));
      if (!range.collapsed) {
        sel.removeAllRanges();
        sel.addRange(range);
      }
    } catch (err) { /* 节点在包装时被浏览器重建，就保留当前选区 */ }
  }
  function unwrapElement(el) {
    const parent = el.parentNode;
    if (!parent) return;
    while (el.firstChild) parent.insertBefore(el.firstChild, el);
    parent.removeChild(el);
  }
  function replaceBlockTag(block, tag) {
    if (!block || !block.parentNode) return null;
    if (block.tagName === tag) return block;
    const next = document.createElement(tag);
    while (block.firstChild) next.appendChild(block.firstChild);
    block.replaceWith(next);
    return next;
  }
  function stripPresetInline(root, forceBold) {
    Array.from(root.querySelectorAll('font, b, strong, span')).forEach((el) => {
      if (el.hasAttribute('data-fmt-anchor')) return;
      if (el.tagName === 'FONT' && el.hasAttribute('size')) el.removeAttribute('size');
      if (el.tagName === 'B' || el.tagName === 'STRONG' || (el.tagName === 'FONT' && !el.hasAttribute('size'))) {
        unwrapElement(el);
        return;
      }
      const style = el.getAttribute('style');
      if (style != null) {
        const kept = style.split(';').filter((part) => {
          const k = part.split(':')[0].trim().toLowerCase();
          return k && k !== 'font-size' && k !== 'font-weight';
        }).join(';');
        if (kept) el.setAttribute('style', kept);
        else el.removeAttribute('style');
      }
      if (el.tagName === 'SPAN' && !el.getAttribute('style')) unwrapElement(el);
    });
    if (forceBold) {
      const style = root.getAttribute('style');
      if (style != null) {
        const kept = style.split(';').filter((part) => {
          const k = part.split(':')[0].trim().toLowerCase();
          return k && k !== 'font-size' && k !== 'font-weight';
        }).join(';');
        if (kept) root.setAttribute('style', kept);
        else root.removeAttribute('style');
      }
    }
  }
  function boldState() {
    try { return !!document.queryCommandState('bold'); } catch (err) { return false; }
  }
  function setBoldState(want) {
    const on = boldState();
    if (on !== !!want) document.execCommand('bold', false, null);
  }
  function markPresetSelection(ed) {
    const sel = window.getSelection();
    if (!ed || !sel || !sel.rangeCount || sel.isCollapsed) return null;
    const range = sel.getRangeAt(0).cloneRange();
    const end = document.createElement('span');
    end.setAttribute('data-fmt-anchor', 'end');
    const endRange = range.cloneRange();
    endRange.collapse(false);
    endRange.insertNode(end);
    const start = document.createElement('span');
    start.setAttribute('data-fmt-anchor', 'start');
    const startRange = range.cloneRange();
    startRange.collapse(true);
    startRange.insertNode(start);
    const marked = document.createRange();
    marked.setStartAfter(start);
    marked.setEndBefore(end);
    sel.removeAllRanges();
    sel.addRange(marked);
    return { ed, start, end, fallback: range };
  }
  function restorePresetSelection(marks) {
    if (!marks) return;
    const { ed, start, end, fallback } = marks;
    if (start.isConnected && end.isConnected && ed.contains(start) && ed.contains(end)) {
      const range = document.createRange();
      range.setStartAfter(start);
      range.setEndBefore(end);
      start.remove();
      end.remove();
      if (!range.collapsed) {
        const sel = window.getSelection();
        sel.removeAllRanges();
        sel.addRange(range);
        rememberRichSelection(ed);
        return;
      }
    }
    if (start.isConnected) start.remove();
    if (end.isConnected) end.remove();
    const sel = window.getSelection();
    if (fallback && fallback.startContainer && ed.contains(fallback.startContainer) &&
        fallback.endContainer && ed.contains(fallback.endContainer)) {
      sel.removeAllRanges();
      sel.addRange(fallback);
      rememberRichSelection(ed);
    }
  }
  function applyFmtPreset(preset) {
    const ed = fmtMenuEditor && document.getElementById(fmtMenuEditor.id);
    if (!ed || !ed.isConnected) { hideFmtBubble(); return; }
    restoreRichSelection(ed);
    richUndoCheckpoint(ed);
    const blockPreset = preset === 'large' || preset === 'medium' || preset === 'small';
    if (blockPreset) normalizePresetRoot(ed);
    const marks = markPresetSelection(ed);
    try {
      document.execCommand('styleWithCSS', false, true);
      if (blockPreset) {
        const tag = preset === 'large' ? 'H2' : preset === 'medium' ? 'H3' : 'P';
        /* 段落格式直接改块节点，不交给 execCommand('formatBlock')。
         * 后者在「普通段落切成标题、再切回来」时偶发折叠选区，
         * 下一次格式就落到空段落上 —— 这正是反复切换看起来会坏的原因。 */
        presetBlocks(ed).forEach((block) => {
          if (!block || block.tagName === 'TABLE') return;
          const next = replaceBlockTag(block, tag);
          if (next) stripPresetInline(next, true);
        });
      } else if (preset === 'bold') {
        setBoldState(!boldState());
      }
    } catch (err) { /* 老浏览器不支持某个命令时保持原文 */ }
    restorePresetSelection(marks);
    rememberRichSelection(ed);
    ed.dispatchEvent(new Event('input', { bubbles: true }));
    scheduleFmtBubble();
  }
  function bindFmtBubble() {
    const bubble = document.getElementById('fmt-bubble');
    if (!bubble) return;
    bubble.addEventListener('pointerdown', (e) => e.preventDefault());
    bubble.querySelector('.fmt-trigger').addEventListener('click', () => {
      if (bubble.classList.contains('hidden')) return;
      bubble.classList.toggle('is-open');
    });
    bubble.querySelectorAll('[data-fmt-preset]').forEach((btn) => {
      btn.addEventListener('click', () => applyFmtPreset(btn.dataset.fmtPreset));
    });
    document.addEventListener('pointerdown', (e) => {
      if (!bubble.contains(e.target)) bubble.classList.remove('is-open');
    }, true);
    document.addEventListener('scroll', () => {
      if (!bubble.classList.contains('hidden')) scheduleFmtBubble();
    }, true);
    window.addEventListener('resize', () => {
      if (!bubble.classList.contains('hidden')) scheduleFmtBubble();
    });
  }
  function richRootBlock(ed) {
    const sel = window.getSelection();
    if (!ed || !sel || !sel.rangeCount || !sel.anchorNode || !ed.contains(sel.anchorNode)) return null;
    let node = sel.anchorNode;
    while (node && node.parentNode !== ed) node = node.parentNode;
    return node && node.nodeType === 1 && MEMO_LINE_BLOCKS.has(node.tagName) ? node : null;
  }
  function placeCaretIn(el, atStart) {
    if (!el) return;
    const sel = window.getSelection();
    if (!sel) return;
    const range = document.createRange();
    range.setStart(el, atStart === false ? el.childNodes.length : 0);
    range.collapse(true);
    sel.removeAllRanges();
    sel.addRange(range);
  }
  function insertRootBlock(ed, block, spacer) {
    normalizePresetRoot(ed);
    const current = richRootBlock(ed);
    if (current) current.after(block);
    else ed.appendChild(block);
    if (spacer) block.after(spacer);
    placeCaretIn(spacer || block, true);
  }
  function memoTableHtml(rows, cols) {
    const rn = Math.max(1, Math.min(10, Number(rows) || 3));
    const cn = Math.max(1, Math.min(10, Number(cols) || 3));
    const cell = (tag) => '<' + tag + '><br></' + tag + '>';
    let html = '<table><tbody><tr>';
    for (let c = 0; c < cn; c += 1) html += '<th>列 ' + (c + 1) + '</th>';
    html += '</tr>';
    for (let r = 1; r < rn; r += 1) {
      html += '<tr>';
      for (let c = 0; c < cn; c += 1) html += cell('td');
      html += '</tr>';
    }
    return html + '</tbody></table>';
  }
  function insertMemoTable(ed, rows, cols) {
    const sel = window.getSelection();
    const wrap = document.createElement('div');
    wrap.innerHTML = memoTableHtml(rows, cols);
    const table = wrap.firstElementChild;
    const spacer = document.createElement('div');
    spacer.innerHTML = '<br>';
    insertRootBlock(ed, table, spacer);
    const cell = table.querySelector('td,th');
    if (cell) placeCaretIn(cell, true);
  }

  /* ---------- 表格尺寸选择器 ---------- */
  let tablePickerEl = null;
  let tablePickerKey = null;
  function closeTablePicker() {
    if (tablePickerEl) tablePickerEl.remove();
    tablePickerEl = null;
    if (tablePickerKey) document.removeEventListener('keydown', tablePickerKey, true);
    tablePickerKey = null;
  }
  function openTablePicker(anchor, ed) {
    closeTablePicker();
    rememberRichSelection(ed);
    const pop = document.createElement('div');
    pop.className = 'table-picker';
    pop.innerHTML = '<div class="table-picker-head"><span>插入表格</span>' +
      '<span class="table-picker-size">3 × 3</span></div>' +
      '<div class="table-picker-grid"></div>';
    const grid = pop.querySelector('.table-picker-grid');
    const size = pop.querySelector('.table-picker-size');
    for (let r = 1; r <= 10; r += 1) {
      for (let c = 1; c <= 10; c += 1) {
        const cell = document.createElement('span');
        cell.className = 'table-picker-cell' + (r <= 3 && c <= 3 ? ' on' : '');
        cell.dataset.row = String(r);
        cell.dataset.col = String(c);
        grid.appendChild(cell);
      }
    }
    const paint = (r, c) => {
      size.textContent = r + ' × ' + c;
      Array.from(grid.children).forEach((cell) => {
        const on = Number(cell.dataset.row) <= r && Number(cell.dataset.col) <= c;
        cell.classList.toggle('on', on);
      });
    };
    grid.addEventListener('pointerover', (e) => {
      const cell = e.target.closest('.table-picker-cell');
      if (!cell) return;
      paint(Number(cell.dataset.row), Number(cell.dataset.col));
    });
    pop.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      e.stopPropagation();
    });
    grid.addEventListener('click', (e) => {
      const cell = e.target.closest('.table-picker-cell');
      if (!cell) return;
      const rows = Number(cell.dataset.row);
      const cols = Number(cell.dataset.col);
      closeTablePicker();
      restoreRichSelection(ed);
      richUndoCheckpoint(ed);
      insertMemoTable(ed, rows, cols);
      rememberRichSelection(ed);
      ed.dispatchEvent(new Event('input', { bubbles: true }));
    });
    document.body.appendChild(pop);
    const rect = anchor.getBoundingClientRect();
    const pr = pop.getBoundingClientRect();
    const left = Math.max(8, Math.min(rect.left, window.innerWidth - pr.width - 8));
    let top = rect.bottom + 7;
    if (top + pr.height > window.innerHeight - 8) top = Math.max(8, rect.top - pr.height - 7);
    pop.style.left = Math.round(left) + 'px';
    pop.style.top = Math.round(top) + 'px';
    tablePickerEl = pop;
    tablePickerKey = (e) => {
      if (e.key === 'Escape') closeTablePicker();
    };
    document.addEventListener('keydown', tablePickerKey, true);
    setTimeout(() => {
      const outside = (e) => {
        if (tablePickerEl && !tablePickerEl.contains(e.target)) {
          closeTablePicker();
          document.removeEventListener('pointerdown', outside, true);
        }
      };
      document.addEventListener('pointerdown', outside, true);
    }, 0);
  }

  /* ---------- 图片粘贴：压缩后内嵌，三端随 memoHtml 同步 ---------- */
  function blobDataUrl(blob) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result || ''));
      reader.onerror = () => reject(new Error('读取图片失败'));
      reader.readAsDataURL(blob);
    });
  }
  function loadImageEl(src) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error('图片格式无法识别'));
      img.src = src;
    });
  }
  async function compressedImageData(file) {
    const raw = await blobDataUrl(file);
    const img = await loadImageEl(raw);
    const w = img.naturalWidth || img.width;
    const h = img.naturalHeight || img.height;
    if (!w || !h) throw new Error('图片尺寸为空');
    let maxSide = 1500;
    let quality = .86;
    let data = '';
    for (let i = 0; i < 14; i += 1) {
      const scale = Math.min(1, maxSide / Math.max(w, h));
      const cw = Math.max(1, Math.round(w * scale));
      const ch = Math.max(1, Math.round(h * scale));
      const canvas = document.createElement('canvas');
      canvas.width = cw;
      canvas.height = ch;
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = '#fff';
      ctx.fillRect(0, 0, cw, ch);
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(img, 0, 0, cw, ch);
      data = canvas.toDataURL('image/webp', quality);
      if (!/^data:image\/webp/i.test(data)) data = canvas.toDataURL('image/jpeg', quality);
      if (data.length <= MEMO_IMAGE_DATA_LIMIT) return data;
      quality -= .1;
      if (quality < .5) {
        maxSide = Math.max(420, Math.round(maxSide * .78));
        quality = .82;
      }
    }
    throw new Error('图片太大，压缩后仍超过同步上限');
  }
  async function insertPastedImage(ed, file, savedRange) {
    const data = await compressedImageData(file);
    if (!ed || !ed.isConnected) throw new Error('编辑区已经刷新，请重新粘贴');
    const sel = window.getSelection();
    if (savedRange && sel && ed.contains(savedRange.commonAncestorContainer)) {
      sel.removeAllRanges();
      sel.addRange(savedRange);
    }
    const block = document.createElement('div');
    const img = document.createElement('img');
    img.src = data;
    img.alt = '粘贴的图片';
    block.appendChild(img);
    const spacer = document.createElement('div');
    spacer.innerHTML = '<br>';
    richUndoCheckpoint(ed);
    insertRootBlock(ed, block, spacer);
    ed.dispatchEvent(new Event('input', { bubbles: true }));
  }
  function bindRichPaste(ed) {
    if (!ed) return;
    ed.addEventListener('paste', async (e) => {
      const cd = e.clipboardData || window.clipboardData;
      if (!cd) return;
      const items = Array.from(cd.items || []);
      let file = null;
      const imageItem = items.find((it) => it && it.kind === 'file' && /^image\//i.test(it.type || ''));
      if (imageItem && imageItem.getAsFile) file = imageItem.getAsFile();
      if (!file && cd.files) {
        file = Array.from(cd.files).find((f) => /^image\//i.test(f.type || '')) || null;
      }
      if (file) {
        e.preventDefault();
        const sel = window.getSelection();
        const saved = sel && sel.rangeCount && ed.contains(sel.anchorNode)
          ? sel.getRangeAt(0).cloneRange() : null;
        try {
          await insertPastedImage(ed, file, saved);
          toast('图片已插入并压缩，稍后自动同步');
        } catch (err) {
          toast('图片粘贴失败：' + (err.message || err), 4200);
        }
        return;
      }
      const txt = cd.getData ? cd.getData('text/plain') : '';
      if (txt == null) return;
      e.preventDefault();
      document.execCommand('insertText', false, String(txt).replace(/\r\n?/g, '\n'));
    });
  }
  function bindRichKeydown(ed) {
    if (!ed) return;
    ed.addEventListener('keydown', (e) => {
      if (e.key !== 'Backspace' || e.isComposing) return;
      if (!e.metaKey && !e.ctrlKey && !e.altKey) richUndoPrepare(ed, 'delete');
      const sel = window.getSelection();
      if (!sel || !sel.rangeCount || !sel.isCollapsed) return;
      const block = richRootBlock(ed);
      if (!block || block.tagName === 'TABLE') return;
      const table = block.previousElementSibling;
      if (!table || table.tagName !== 'TABLE') return;
      if ((block.textContent || '').replace(/\u200b/g, '').trim()) return;
      if (block.querySelector('img,table,hr,[data-flow]')) return;
      e.preventDefault();
      table.remove();
      placeCaretIn(block, true);
      ed.dispatchEvent(new Event('input', { bubbles: true }));
    });
  }

  /* ---------- 富文本撤销 / 重做 ----------
   * 原生 contenteditable 的 undo 栈会在保存后重建 DOM 时丢掉，手动删表格/流程图也记不进去。
   * 这里按「文档」保存快照；编辑器重建后仍能用 ⌘Z / Ctrl+Z 找回刚删的内容。 */
  const RICH_UNDO = new Map();
  let richUndoRestoring = false;
  let richUndoGlobalBound = false;
  let richUndoLastEditor = null;
  function richUndoKey(ed) {
    if (!ed) return '';
    if (ed.dataset && ed.dataset.docKey) return ed.dataset.docKey;
    if (ed.id === 'memo-text') return 'memo-text:' + current;
    return ed.id || '';
  }
  function richUndoState(ed) {
    const key = richUndoKey(ed);
    if (!key) return null;
    if (!RICH_UNDO.has(key)) {
      RICH_UNDO.set(key, { undo: [], redo: [], bytes: 0, pending: null, pendingType: '', group: '', groupAt: 0 });
    }
    return RICH_UNDO.get(key);
  }
  function richNodePath(root, node) {
    const path = [];
    let n = node;
    while (n && n !== root) {
      const p = n.parentNode;
      if (!p) return null;
      path.unshift(Array.prototype.indexOf.call(p.childNodes, n));
      n = p;
    }
    return n === root ? path : null;
  }
  function richNodeAtPath(root, path) {
    let n = root;
    for (let i = 0; i < path.length; i += 1) {
      n = n && n.childNodes[path[i]];
      if (!n) return null;
    }
    return n;
  }
  function richSelectionSnapshot(ed) {
    const sel = window.getSelection();
    if (!ed || !sel || !sel.rangeCount ||
        !sel.anchorNode || !sel.focusNode ||
        !ed.contains(sel.anchorNode) || !ed.contains(sel.focusNode)) return null;
    const range = sel.getRangeAt(0);
    const start = richNodePath(ed, range.startContainer);
    const end = richNodePath(ed, range.endContainer);
    if (!start || !end) return null;
    return {
      start, end,
      startOffset: range.startOffset,
      endOffset: range.endOffset
    };
  }
  function richSnapshot(ed) {
    return {
      html: ed ? ed.innerHTML : '',
      sel: richSelectionSnapshot(ed)
    };
  }
  function richRestoreSelection(ed, saved) {
    if (!ed || !saved) return;
    const start = richNodeAtPath(ed, saved.start);
    const end = richNodeAtPath(ed, saved.end);
    if (!start || !end) return;
    try {
      const range = document.createRange();
      range.setStart(start, Math.min(saved.startOffset,
        start.nodeType === 3 ? String(start.nodeValue || '').length : start.childNodes.length));
      range.setEnd(end, Math.min(saved.endOffset,
        end.nodeType === 3 ? String(end.nodeValue || '').length : end.childNodes.length));
      const sel = window.getSelection();
      sel.removeAllRanges();
      sel.addRange(range);
    } catch (err) { /* 节点结构在快照之后变过，就保留当前光标 */ }
  }
  function richRestoreSnapshot(ed, snap) {
    if (!ed || !snap) return;
    ed.innerHTML = snap.html;
    hydrateFlowFigures(ed);
    const has = !!(ed.textContent || '').trim() || !!ed.querySelector('table,hr,img,[data-flow]');
    ed.classList.toggle('is-empty', !has);
    ed.focus();
    richRestoreSelection(ed, snap.sel);
  }
  function richUndoTrim(st) {
    while (st.undo.length > 40 || (st.bytes > 2600000 && st.undo.length > 1)) {
      const old = st.undo.shift();
      st.bytes -= old && old.html ? old.html.length : 0;
      if (st.bytes < 0) st.bytes = 0;
    }
    while (st.redo.length > 40) st.redo.shift();
  }
  function richUndoPush(ed, snap) {
    const st = richUndoState(ed);
    if (!st || !snap) return;
    const last = st.undo[st.undo.length - 1];
    if (last && last.html === snap.html &&
        JSON.stringify(last.sel) === JSON.stringify(snap.sel)) return;
    st.undo.push(snap);
    st.bytes += (snap.html || '').length;
    st.redo = [];
    richUndoTrim(st);
  }
  function richUndoPrepare(ed, type) {
    if (richUndoRestoring) return;
    const st = richUndoState(ed);
    if (!st) return;
    st.pending = richSnapshot(ed);
    st.pendingType = String(type || '');
  }
  function richUndoCheckpoint(ed) {
    if (richUndoRestoring || !ed) return;
    const st = richUndoState(ed);
    if (!st) return;
    st.pending = null;
    st.group = '';
    st.groupAt = 0;
    richUndoPush(ed, richSnapshot(ed));
  }
  function richUndoCommit(ed, inputType) {
    if (richUndoRestoring) return;
    const st = richUndoState(ed);
    if (!st || !st.pending) return;
    const snap = st.pending;
    const type = String(inputType || st.pendingType || 'input');
    st.pending = null;
    const now = Date.now();
    const sameGroup = st.group && st.group === type && now - st.groupAt < 900;
    st.groupAt = now;
    st.group = type;
    if (sameGroup) return;
    richUndoPush(ed, snap);
  }
  function richUndoAction(ed, redo) {
    const st = richUndoState(ed);
    if (!st) return false;
    const from = redo ? st.redo : st.undo;
    if (!from.length) return false;
    const entry = from.pop();
    const current = richSnapshot(ed);
    if (current.html !== entry.html) {
      if (redo) st.undo.push(current);
      else {
        st.redo.push(current);
        st.redo = st.redo.slice(-40);
      }
    }
    richUndoRestoring = true;
    try {
      richRestoreSnapshot(ed, entry);
      st.pending = null;
      st.group = '';
      ed.dispatchEvent(new Event('input', { bubbles: true }));
    } finally {
      richUndoRestoring = false;
    }
    return true;
  }
  function bindRichUndo(ed) {
    if (!ed) return;
    if (!richUndoGlobalBound) {
      richUndoGlobalBound = true;
      document.addEventListener('focusin', (e) => {
        const target = e.target;
        const active = target && target.closest &&
          target.closest('.memo-editor[contenteditable="true"]');
        if (active) richUndoLastEditor = active;
      });
      /* 点保存 / 删除按钮后焦点可能离开编辑区；仍允许撤销刚作用于该白纸的操作。 */
      document.addEventListener('keydown', (e) => {
        if (e.defaultPrevented || !(e.metaKey || e.ctrlKey)) return;
        const key = String(e.key || '').toLowerCase();
        if (key !== 'z' && key !== 'y') return;
        const target = e.target;
        if (target && target.closest && target.closest('.memo-editor')) return;
        if (target && target.closest && target.closest('input,textarea,select,[contenteditable="true"]')) return;
        const editor = richUndoLastEditor;
        if (!editor || !editor.isConnected) return;
        const acted = richUndoAction(editor, key === 'y' || !!e.shiftKey);
        if (acted) e.preventDefault();
      });
    }
    ed.addEventListener('beforeinput', (e) => {
      const type = String(e.inputType || '');
      if (!type || /^history/i.test(type)) return;
      richUndoPrepare(ed, type);
    });
    ed.addEventListener('input', (e) => richUndoCommit(ed, e.inputType || ''));
    ed.addEventListener('keydown', (e) => {
      if (!(e.metaKey || e.ctrlKey)) return;
      const key = String(e.key || '').toLowerCase();
      if (key === 'z') {
        const redid = richUndoAction(ed, !!e.shiftKey);
        if (redid) e.preventDefault();
      } else if (key === 'y') {
        const redid = richUndoAction(ed, true);
        if (redid) e.preventDefault();
      }
    });
  }
  function applyRichCommand(ed, cmd, value) {
    if (!ed) return;
    restoreRichSelection(ed);
    richUndoCheckpoint(ed);
    try {
      if (cmd === 'bold') {
        document.execCommand('styleWithCSS', false, true);
        document.execCommand('bold', false, null);
      } else if (cmd === 'block') {
        document.execCommand('formatBlock', false, String(value || 'p').toUpperCase());
      } else if (cmd === 'size') {
        document.execCommand('styleWithCSS', false, false);
        document.execCommand('fontSize', false, String(value || '3'));
      } else if (cmd === 'highlight') {
        document.execCommand('styleWithCSS', false, true);
        document.execCommand('hiliteColor', false, value || 'transparent');
      } else if (cmd === 'color') {
        document.execCommand('styleWithCSS', false, true);
        document.execCommand('foreColor', false, value || '#0f172a');
      } else if (cmd === 'clear') {
        document.execCommand('removeFormat', false, null);
        document.execCommand('formatBlock', false, 'P');
      }
    } catch (err) { /* 老浏览器不支持某个命令时保持原文，不要报错 */ }
    rememberRichSelection(ed);
  }
  function bindRichToolbar(toolbar, ed, onChange) {
    if (!toolbar || !ed) return;
    toolbar.addEventListener('mousedown', (e) => {
      if (e.target.closest('button[data-memo-cmd]')) e.preventDefault();
    });
    toolbar.addEventListener('click', (e) => {
      const btn = e.target.closest('button[data-memo-cmd]');
      if (!btn) return;
      if (btn.dataset.memoCmd === 'table') {
        openTablePicker(btn, ed);
        return;
      }
      if (btn.dataset.memoCmd === 'flow') {
        rememberRichSelection(ed);
        openFlowEditor(ed, null);
        return;
      }
      applyRichCommand(ed, btn.dataset.memoCmd, null);
      onChange();
    });
    toolbar.querySelectorAll('select[data-memo-select]').forEach((sel) => {
      sel.addEventListener('change', () => {
        if (!sel.value) return;
        applyRichCommand(ed, sel.dataset.memoSelect, sel.value);
        sel.value = '';
        onChange();
      });
    });
  }

  /* ---------- 流程图：可编辑画框 + 白纸内嵌块 ---------- */
  const FLOW_W = 900;
  const FLOW_H = 560;
  const FLOW_NODE_W = 170;
  const FLOW_NODE_H = 76;
  let flowSession = null;
  let flowSeq = 0;

  function flowPack(data) {
    const bytes = new TextEncoder().encode(JSON.stringify(data));
    let bin = '';
    for (let i = 0; i < bytes.length; i += 0x8000) {
      bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    }
    return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
  }
  function flowClean(raw) {
    const src = raw && typeof raw === 'object' ? raw : {};
    const w = FLOW_W;
    const h = FLOW_H;
    const used = new Set();
    const nodes = (Array.isArray(src.nodes) ? src.nodes : []).slice(0, 80).map((n, i) => {
      let id = String(n && n.id || ('n' + i)).replace(/[^a-z0-9_-]/gi, '').slice(0, 40) || ('n' + i);
      while (used.has(id)) id += '_';
      used.add(id);
      const x = Math.max(0, Math.min(w - FLOW_NODE_W, Number(n && n.x) || 0));
      const y = Math.max(0, Math.min(h - FLOW_NODE_H, Number(n && n.y) || 0));
      return {
        id,
        x: Math.round(x),
        y: Math.round(y),
        text: String(n && n.text == null ? '' : n.text).slice(0, 120)
      };
    });
    const ids = new Set(nodes.map((n) => n.id));
    const seen = new Set();
    const edges = (Array.isArray(src.edges) ? src.edges : []).slice(0, 160).map((e) => ({
      from: String(e && e.from || ''),
      to: String(e && e.to || '')
    })).filter((e) => {
      if (!ids.has(e.from) || !ids.has(e.to) || e.from === e.to) return false;
      const key = e.from + '>' + e.to;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
    return { w, h, nodes, edges };
  }
  function flowUnpack(packed) {
    const s = String(packed || '').replace(/-/g, '+').replace(/_/g, '/');
    if (!s) return null;
    const pad = s.length % 4 ? '='.repeat(4 - (s.length % 4)) : '';
    const bin = atob(s + pad);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i += 1) bytes[i] = bin.charCodeAt(i);
    return flowClean(JSON.parse(new TextDecoder().decode(bytes)));
  }
  function flowCenter(n) {
    return { x: n.x + FLOW_NODE_W / 2, y: n.y + FLOW_NODE_H / 2 };
  }
  function flowBoundary(n, tx, ty) {
    const c = flowCenter(n);
    const dx = tx - c.x;
    const dy = ty - c.y;
    if (!dx && !dy) return { x: c.x + FLOW_NODE_W / 2, y: c.y };
    const rx = FLOW_NODE_W / 2;
    const ry = FLOW_NODE_H / 2;
    const t = 1 / Math.sqrt((dx * dx) / (rx * rx) + (dy * dy) / (ry * ry));
    return { x: c.x + dx * t, y: c.y + dy * t };
  }
  function flowEndpoints(a, b) {
    const ca = flowCenter(a);
    const cb = flowCenter(b);
    return {
      start: flowBoundary(a, cb.x, cb.y),
      end: flowBoundary(b, ca.x, ca.y)
    };
  }
  function flowSvgPath(a, b) {
    const { start, end } = flowEndpoints(a, b);
    const dx = end.x - start.x;
    const bend = Math.max(44, Math.min(160, Math.abs(dx) * .45 || 70));
    const sign = dx >= 0 ? 1 : -1;
    return 'M' + start.x + ' ' + start.y +
      ' C' + (start.x + sign * bend) + ' ' + start.y +
      ', ' + (end.x - sign * bend) + ' ' + end.y +
      ', ' + end.x + ' ' + end.y;
  }
  function flowFigureInner(data) {
    const d = flowClean(data);
    const head = '<div class="flow-figure-head">' +
      '<span>流程图 · ' + d.nodes.length + ' 个节点</span>' +
      '<span class="flow-figure-open">点击编辑</span>' +
      '<button class="flow-figure-del" type="button" data-flow-del="1" title="从白纸删除流程图">✕</button>' +
      '</div>';
    if (!d.nodes.length) return head + '<div class="flow-empty">空流程图</div>';
    const byId = new Map(d.nodes.map((n) => [n.id, n]));
    const edges = d.edges.map((e) => {
      const a = byId.get(e.from);
      const b = byId.get(e.to);
      if (!a || !b) return '';
      const { start, end } = flowEndpoints(a, b);
      const dx = end.x - start.x;
      const dy = end.y - start.y;
      const len = Math.hypot(dx, dy);
      const angle = Math.atan2(dy, dx) * 180 / Math.PI;
      return '<div class="flow-render-edge" style="left:' + (start.x / d.w * 100) +
        '%;top:' + (start.y / d.h * 100) + '%;width:' + (len / d.w * 100) +
        '%;transform:rotate(' + angle + 'deg)"></div>';
    }).join('');
    const nodes = d.nodes.map((n) =>
      '<div class="flow-render-node" style="left:' + (n.x / d.w * 100) +
      '%;top:' + (n.y / d.h * 100) + '%;width:' + (FLOW_NODE_W / d.w * 100) +
      '%;height:' + (FLOW_NODE_H / d.h * 100) + '%">' + esc(n.text || '未命名') + '</div>'
    ).join('');
    return head + '<div class="flow-render-surface">' + edges + nodes + '</div>';
  }
  function hydrateFlowFigures(root) {
    const scope = root && root.querySelectorAll ? root : document;
    scope.querySelectorAll('.memo-editor [data-flow]').forEach((fig) => {
      let data = null;
      try { data = flowUnpack(fig.getAttribute('data-flow')); } catch (err) { data = null; }
      if (!data || !data.nodes.length) return;
      fig.classList.add('flow-figure');
      fig.setAttribute('contenteditable', 'false');
      fig.innerHTML = flowFigureInner(data);
      const del = fig.querySelector('[data-flow-del]');
      if (del) del.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        const ed = fig.closest('.memo-editor');
        richUndoCheckpoint(ed);
        fig.remove();
        if (ed) ed.dispatchEvent(new Event('input', { bubbles: true }));
        toast('流程图已删除');
      });
    });
  }
  function flowNodeEl(id) {
    const layer = document.getElementById('flow-node-layer');
    return layer ? layer.querySelector('[data-node-id="' + id + '"]') : null;
  }
  function flowDrawEdges() {
    if (!flowSession) return;
    const g = document.getElementById('flow-edge-layer');
    if (!g) return;
    const byId = new Map(flowSession.nodes.map((n) => [n.id, n]));
    g.innerHTML = flowSession.edges.map((e) => {
      const a = byId.get(e.from);
      const b = byId.get(e.to);
      return a && b ? '<path class="flow-edge" d="' + flowSvgPath(a, b) + '"></path>' : '';
    }).join('');
  }
  function flowClearTemp() {
    const p = document.getElementById('flow-temp-edge');
    if (!p) return;
    p.setAttribute('d', '');
    p.classList.add('hidden');
  }
  function flowDrawTemp(fromId, point) {
    if (!flowSession) return;
    const n = flowSession.nodes.find((x) => x.id === fromId);
    const p = document.getElementById('flow-temp-edge');
    if (!n || !p) return;
    const start = flowBoundary(n, point.x, point.y);
    p.setAttribute('d', 'M' + start.x + ' ' + start.y + ' L' + point.x + ' ' + point.y);
    p.classList.remove('hidden');
  }
  function flowSetDropTarget(id) {
    if (!flowSession) return;
    if (flowSession.hoverId === id) return;
    if (flowSession.hoverId) {
      const old = flowNodeEl(flowSession.hoverId);
      if (old) old.classList.remove('is-drop-target');
    }
    flowSession.hoverId = id || null;
    if (id) {
      const el = flowNodeEl(id);
      if (el) el.classList.add('is-drop-target');
    }
  }
  function flowUpdateSelection() {
    if (!flowSession) return;
    const layer = document.getElementById('flow-node-layer');
    if (layer) layer.querySelectorAll('.flow-node').forEach((el) => {
      el.classList.toggle('selected', el.dataset.nodeId === flowSession.selectedId);
    });
    const del = document.getElementById('flow-delete-node');
    if (del) del.disabled = !flowSession.selectedId;
  }
  function flowRenderEditor() {
    if (!flowSession) return;
    const layer = document.getElementById('flow-node-layer');
    if (!layer) return;
    layer.innerHTML = flowSession.nodes.map((n) =>
      '<div class="flow-node" data-node-id="' + n.id + '" style="left:' + n.x + 'px;top:' + n.y + 'px">' +
        '<input class="flow-node-input" type="text" maxlength="120" value="' + esc(n.text) + '" aria-label="椭圆内容" />' +
        '<span class="flow-port" title="从这里拖箭头到另一个椭圆">→</span>' +
      '</div>'
    ).join('');
    layer.querySelectorAll('.flow-node').forEach((el) => {
      const n = flowSession.nodes.find((x) => x.id === el.dataset.nodeId);
      const input = el.querySelector('.flow-node-input');
      if (!n || !input) return;
      input.addEventListener('input', () => { n.text = input.value; });
      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === 'Escape') {
          e.preventDefault();
          input.blur();
        }
      });
    });
    const empty = document.getElementById('flow-empty');
    if (empty) empty.classList.toggle('hidden', flowSession.nodes.length > 0);
    flowDrawEdges();
    flowUpdateSelection();
  }
  function flowAddNode() {
    if (!flowSession) return;
    const slot = flowSession.nodes.length;
    const narrow = window.innerWidth <= 700;
    const col = narrow ? 0 : slot % 3;
    const row = narrow ? slot : Math.floor(slot / 3) % 3;
    const n = {
      id: 'fn' + (++flowSeq) + Date.now().toString(36),
      x: 74 + col * 248 + (narrow ? 0 : Math.floor(slot / 9) * 20),
      y: 38 + row * (narrow ? 100 : 158) + (narrow ? 0 : Math.floor(slot / 9) * 20),
      text: ''
    };
    n.x = Math.max(12, Math.min(FLOW_W - FLOW_NODE_W - 12, n.x));
    n.y = Math.max(12, Math.min(FLOW_H - FLOW_NODE_H - 12, n.y));
    flowSession.nodes.push(n);
    flowSession.selectedId = n.id;
    flowRenderEditor();
    const input = flowNodeEl(n.id) && flowNodeEl(n.id).querySelector('.flow-node-input');
    if (input) {
      input.focus();
      input.select();
    }
  }
  function flowDeleteSelected() {
    if (!flowSession || !flowSession.selectedId) return;
    const id = flowSession.selectedId;
    flowSession.nodes = flowSession.nodes.filter((n) => n.id !== id);
    flowSession.edges = flowSession.edges.filter((e) => e.from !== id && e.to !== id);
    flowSession.selectedId = null;
    flowSetDropTarget(null);
    flowRenderEditor();
  }
  function flowLocalPoint(e) {
    const canvas = document.getElementById('flow-canvas');
    if (!canvas) return { x: 0, y: 0 };
    const rect = canvas.getBoundingClientRect();
    const scale = rect.width / FLOW_W || 1;
    return {
      x: (e.clientX - rect.left) / scale,
      y: (e.clientY - rect.top) / scale
    };
  }
  function flowNearBorder(el, e) {
    const rect = el.getBoundingClientRect();
    if (!rect.width || !rect.height) return false;
    const nx = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    const ny = ((e.clientY - rect.top) / rect.height) * 2 - 1;
    const d = nx * nx + ny * ny;
    return d > .66 && d < 1.24;
  }
  function flowTargetAt(x, y) {
    const el = document.elementFromPoint(x, y);
    const node = el && el.closest ? el.closest('.flow-node') : null;
    return node && node.closest('#flow-canvas') ? node.dataset.nodeId : null;
  }
  function flowPointerDown(e) {
    if (!flowSession) return;
    const el = e.target.closest('.flow-node');
    if (!el) return;
    const id = el.dataset.nodeId;
    flowSession.selectedId = id;
    flowUpdateSelection();
    if (e.button != null && e.button !== 0) return;
    const nearBorder = flowNearBorder(el, e);
    if (e.target.closest('.flow-node-input') && !nearBorder) return;
    e.preventDefault();
    const p = flowLocalPoint(e);
    const n = flowSession.nodes.find((x) => x.id === id);
    if (!n) return;
    const mode = e.target.closest('.flow-port') || nearBorder ? 'connect' : 'move';
    flowSession.pointer = {
      id: e.pointerId,
      mode,
      nodeId: id,
      start: p,
      originX: n.x,
      originY: n.y,
      moved: false
    };
    if (mode === 'connect') flowDrawTemp(id, p);
  }
  function flowPointerMove(e) {
    if (!flowSession || !flowSession.pointer) return;
    const st = flowSession.pointer;
    const p = flowLocalPoint(e);
    if (st.mode === 'move') {
      const dx = p.x - st.start.x;
      const dy = p.y - st.start.y;
      if (!st.moved && Math.hypot(dx, dy) < 3) return;
      st.moved = true;
      const n = flowSession.nodes.find((x) => x.id === st.nodeId);
      if (!n) return;
      n.x = Math.max(0, Math.min(FLOW_W - FLOW_NODE_W, Math.round(st.originX + dx)));
      n.y = Math.max(0, Math.min(FLOW_H - FLOW_NODE_H, Math.round(st.originY + dy)));
      const el = flowNodeEl(n.id);
      if (el) {
        el.style.left = n.x + 'px';
        el.style.top = n.y + 'px';
      }
      flowDrawEdges();
    } else {
      st.moved = true;
      flowDrawTemp(st.nodeId, p);
      const target = flowTargetAt(e.clientX, e.clientY);
      flowSetDropTarget(target && target !== st.nodeId ? target : null);
    }
    e.preventDefault();
  }
  function flowPointerUp(e) {
    if (!flowSession || !flowSession.pointer) return;
    const st = flowSession.pointer;
    flowSession.pointer = null;
    if (st.mode === 'connect') {
      const target = flowTargetAt(e.clientX, e.clientY);
      if (target && target !== st.nodeId &&
          !flowSession.edges.some((x) => x.from === st.nodeId && x.to === target)) {
        flowSession.edges.push({ from: st.nodeId, to: target });
        flowDrawEdges();
      }
      flowClearTemp();
      flowSetDropTarget(null);
    } else if (!st.moved) {
      const el = flowNodeEl(st.nodeId);
      const input = el && el.querySelector('.flow-node-input');
      if (input) {
        input.focus();
        input.select();
      }
    }
  }
  function openFlowEditor(ed, figure) {
    if (!ed) return;
    let data = { nodes: [], edges: [] };
    if (figure) {
      try { data = flowUnpack(figure.getAttribute('data-flow')) || data; } catch (err) { data = { nodes: [], edges: [] }; }
    }
    flowSession = {
      editor: ed,
      figure: figure || null,
      nodes: data.nodes.slice(),
      edges: data.edges.slice(),
      selectedId: null,
      pointer: null,
      hoverId: null
    };
    document.getElementById('flow-backdrop').classList.remove('hidden');
    const save = document.getElementById('flow-save');
    if (save) save.textContent = figure ? '保存修改' : '保存到白纸';
    flowRenderEditor();
  }
  function flowCloseEditor() {
    flowClearTemp();
    const back = document.getElementById('flow-backdrop');
    if (back) back.classList.add('hidden');
    flowSession = null;
  }
  function flowSaveToEditor() {
    if (!flowSession) return;
    const clean = flowClean({ nodes: flowSession.nodes, edges: flowSession.edges });
    if (!clean.nodes.length) {
      toast('先点左侧椭圆添加一个节点');
      return;
    }
    const encoded = flowPack(clean);
    const original = flowSession.editor;
    const ed = document.getElementById(original.id) || original;
    let figure = flowSession.figure;
    if (figure && !figure.isConnected) {
      const oldData = figure.getAttribute('data-flow');
      figure = Array.from(ed.querySelectorAll('[data-flow]'))
        .find((x) => x.getAttribute('data-flow') === oldData) || null;
    }
    richUndoCheckpoint(ed);
    if (figure && figure.isConnected) {
      figure.setAttribute('data-flow', encoded);
      hydrateFlowFigures(ed);
      ed.dispatchEvent(new Event('input', { bubbles: true }));
    } else {
      restoreRichSelection(ed);
      const fig = document.createElement('div');
      fig.setAttribute('data-flow', encoded);
      const spacer = document.createElement('div');
      spacer.innerHTML = '<br>';
      insertRootBlock(ed, fig, spacer);
      hydrateFlowFigures(ed);
      ed.dispatchEvent(new Event('input', { bubbles: true }));
    }
    flowCloseEditor();
    toast(figure ? '流程图已更新' : '流程图已保存到白纸');
  }
  function bindFlowEditor() {
    const back = document.getElementById('flow-backdrop');
    if (!back) return;
    back.addEventListener('click', (e) => {
      if (e.target === e.currentTarget || e.target.closest('[data-flow-close]')) {
        e.preventDefault();
        flowCloseEditor();
      }
    });
    const add = back.querySelector('[data-flow-add]');
    if (add) add.addEventListener('click', flowAddNode);
    const save = document.getElementById('flow-save');
    if (save) save.addEventListener('click', flowSaveToEditor);
    const del = document.getElementById('flow-delete-node');
    if (del) del.addEventListener('click', flowDeleteSelected);
    const layer = document.getElementById('flow-node-layer');
    if (layer) layer.addEventListener('pointerdown', flowPointerDown);
    window.addEventListener('pointermove', flowPointerMove, { passive: false });
    window.addEventListener('pointerup', flowPointerUp);
    window.addEventListener('pointercancel', flowPointerUp);
    document.addEventListener('keydown', (e) => {
      if (!flowSession) return;
      if (e.key === 'Escape') {
        e.preventDefault();
        flowCloseEditor();
        return;
      }
      const ae = document.activeElement;
      const typing = ae && (ae.tagName === 'INPUT' || ae.tagName === 'TEXTAREA');
      if (!typing && (e.key === 'Delete' || e.key === 'Backspace')) {
        e.preventDefault();
        flowDeleteSelected();
      }
    });
    document.addEventListener('click', (e) => {
      const fig = e.target.closest('.memo-editor [data-flow]');
      if (!fig || !fig.isConnected || e.target.closest('[data-flow-del]')) return;
      e.preventDefault();
      e.stopPropagation();
      openFlowEditor(fig.closest('.memo-editor'), fig);
    }, true);
  }
  function memoStamp(tab) {
    const m = Core.memoOf(items(), MEMOS[tab].kind);
    if (!m || !m.updatedAt) return '还没有内容';
    const d = new Date(m.updatedAt);
    if (isNaN(d.getTime())) return '';
    const p = (n) => String(n).padStart(2, '0');
    return '已保存 · ' + p(d.getHours()) + ':' + p(d.getMinutes());
  }
  /* ---------- 备忘录倒计时：正文里写 ⏰日期，那一行就进倒计时板 ---------- */
  function memoTextNow(tab) {
    const st = memoState[tab];
    if (st && st.draft != null) return st.draft;
    return Core.memoText(items(), MEMOS[tab].kind);
  }
  const EMPTY_LINE_TEXT = '（这一行还没写字）';
  /* 倒计时的一行：方框打勾 / 点字改内容 / 改日期 / ＋进展 / ✕ 去掉倒计时，整条可拖动排序。
     今日页和琐事 / 创意页用的是同一套 —— 在这里改完就是改了那张备忘录的正文，不用来回跑。 */
  function timerSubsHTML(t) {
    const subs = t.subs || [];
    if (!subs.length) return '';
    return '<div class="timer-subs">' + subs.map((x) =>
      '<div class="timer-sub" data-action="sub-edit" data-sub-line="' + x.line + '" title="点一下改这条进展">' +
        '<span class="sub-md">' + esc(x.md || '进展') + '</span>' +
        '<span class="sub-text">' + esc(x.text || '（空）') + '</span>' +
        '<button class="sub-del" type="button" data-action="sub-del" data-sub-line="' + x.line + '" title="删掉这条进展">✕</button>' +
      '</div>').join('') + '</div>';
  }
  function timerRowHTML(t, src, sourceKey) {
    const done = !!t.done;
    const key = String(sourceKey || '');
    const isDay = key.indexOf('day:') === 0;
    const tab = key.indexOf('memo:') === 0 ? key.slice(5) : '';
    return '<div class="timer-item" data-line="' + t.line + '"' +
      (key ? ' data-src-key="' + esc(key) + '"' : '') +
      (isDay ? ' data-src-day="' + esc(key.slice(4)) + '"' : '') +
      (tab ? ' data-src-tab="' + esc(tab) + '"' : '') + '>' +
      '<div class="timer-row is-' + t.state + (done ? ' is-done' : '') + '">' +
        '<label class="cb timer-cb" title="' + (done ? '取消打勾' : '打勾完成') + '">' +
        '<input type="checkbox" data-action="timer-toggle" data-line="' + t.line + '"' + (done ? ' checked' : '') + ' />' +
        '<span class="box"></span></label>' +
        '<span class="timer-left">' + esc(Core.fmtLeft(t.days)) + '</span>' +
        '<span class="timer-text" data-action="timer-edit" title="点一下直接改这句话">' +
          esc(t.text || EMPTY_LINE_TEXT) + '</span>' +
        (src ? '<span class="timer-src">' + esc(src) + '</span>' : '') +
        '<span class="timer-due">' + esc(t.due) + '</span>' +
        '<input class="timer-date" type="date" data-action="timer-date" data-line="' + t.line + '" value="' + esc(t.due) + '" title="改到期日" />' +
        '<button class="timer-sub-add" type="button" data-action="sub-add" data-line="' + t.line + '" title="记一条进展，不用回备忘录页">＋进展</button>' +
        '<button class="timer-del" type="button" data-action="timer-del" data-line="' + t.line + '" title="去掉这条倒计时（正文那句话保留）">✕</button>' +
      '</div>' + timerSubsHTML(t) + '</div>';
  }
  /* 每条倒计时带上它下面的「↳ 进展」行 */
  function timersWithSubs(text) {
    return Core.timersOf(text, today()).map((t) => Object.assign({}, t, { subs: Core.subLinesOf(text, t.line) }));
  }
  function timerSourceFromKey(key) {
    const raw = String(key || '');
    if (raw.indexOf('memo:') === 0) {
      const tab = raw.slice(5);
      if (!MEMOS[tab]) return null;
      return {
        key: raw, type: 'memo', tab,
        text: () => memoTextNow(tab),
        apply: (text) => applyMemoText(tab, text),
        refresh: () => refreshAfterTimerEdit(tab)
      };
    }
    if (raw.indexOf('day:') === 0) {
      const date = raw.slice(4);
      return {
        key: raw, type: 'day', date,
        text: () => dayPaperTextNow(date),
        apply: (text) => applyDayPaperText(date, text),
        refresh: () => { if (current === 'today') refreshTodayTimers(); }
      };
    }
    if (richDocSpec(raw)) {
      return {
        key: raw, type: 'doc',
        text: () => richDocTextNow(raw),
        apply: (text) => applyRichDocText(raw, text),
        refresh: () => { if (current === 'today') refreshTodayTimers(); }
      };
    }
    return null;
  }
  function timerSourceFromRow(row, fallbackTab) {
    let key = row && row.getAttribute ? row.getAttribute('data-src-key') : '';
    if (!key) {
      const tab = row && row.getAttribute ? row.getAttribute('data-src-tab') : '';
      key = 'memo:' + (tab || fallbackTab || '');
    }
    return timerSourceFromKey(key);
  }
  function timerBoardInner(tab) {
    const list = timersWithSubs(memoTextNow(tab));
    if (!list.length) return '';
    const doneN = list.filter((t) => t.done).length;
    const over = list.filter((t) => t.state === 'over' && !t.done).length;
    const soon = list.filter((t) => (t.state === 'today' || t.state === 'soon') && !t.done).length;
    return '<div class="timer-head">' + Core.TIMER_MARK + ' 倒计时 · ' + list.length + ' 条' +
        (doneN ? '<b class="t-done">已打勾 ' + doneN + '</b>' : '') +
        (over ? '<b class="t-over">已过期 ' + over + '</b>' : '') +
        (soon ? '<b class="t-soon">3 天内 ' + soon + '</b>' : '') +
        '<span class="timer-head-hint">整条可拖动排序 · 紧急的自动置顶</span></div>' +
      list.map((t) => timerRowHTML(t, '', 'memo:' + tab)).join('');
  }
  function timerBoardHTML(tab) {
    return '<div class="timer-board" id="memo-timers">' + timerBoardInner(tab) + '</div>';
  }
  function refreshTimerBoard(tab) {
    if (current !== tab) return;
    /* 拖动期间别直接换掉板子的 DOM；否则按下后光标一失焦，blur 里的这次刷新
     * 会把正被拖的条目换成孤儿节点。等拖完由 flushPendingRender 统一重建。 */
    if (sortActive > 0) { pendingRender = true; return; }
    const el = document.getElementById('memo-timers');
    if (el) el.innerHTML = timerBoardInner(tab);
  }
  /* 改完 / 取消后把当前这张板子重画（今天页和备忘录页各一套） */
  function refreshAfterTimerEdit(tab) {
    if (current === tab) refreshTimerBoard(tab);
    if (current === 'today') refreshTodayTimers();
  }
  /* 点倒计时那一行的文字 → 就地变成输入框；回车 / 失焦提交，Esc 取消 */
  function beginTimerEdit(row, fallbackTab) {
    if (!row || row.classList.contains('is-editing')) return;
    const span = row.querySelector('[data-action="timer-edit"]');
    if (!span) return;
    const source = timerSourceFromRow(row, fallbackTab);
    if (!source) return;
    const line = Number(row.getAttribute('data-line'));
    const before = span.textContent === EMPTY_LINE_TEXT ? '' : span.textContent;
    row.classList.add('is-editing');
    const inp = document.createElement('input');
    inp.type = 'text';
    inp.className = 'timer-edit';
    inp.value = before;
    inp.placeholder = '这一行写点什么';
    span.replaceWith(inp);
    inp.focus();
    inp.select();
    let settled = false;
    const settle = (save) => {
      if (settled) return;
      settled = true;
      const v = inp.value.replace(/\s+/g, ' ').trim();
      if (!save || v === before) { source.refresh(); return; }
      source.apply(Core.setLineText(source.text(), line, v));
      source.refresh();
      toast(v ? '已改好这一行' : '这一行清空了');
    };
    inp.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); settle(true); }
      else if (e.key === 'Escape') { e.preventDefault(); settle(false); }
    });
    inp.addEventListener('blur', () => settle(true));
  }
  /* 打勾 = 这件事做完了：整行（连它下面的进展）从琐事 / 创意里删掉，不留 ✅ 堆积。
     删错了就点提示条上的「撤回」把原来那一块放回去。 */
  function toggleTimerDone(row, fallbackTab, on) {
    if (!row) return;
    const source = timerSourceFromRow(row, fallbackTab);
    if (!source) return;
    const line = Number(row.getAttribute('data-line'));
    const before = source.text();
    if (!on) {                                   // 手写的 ✅ 想取消：只把 ✅ 去掉，行留着
      source.apply(Core.setLineDone(before, line, false));
      source.refresh();
      toast('已取消打勾');
      return;
    }
    const after = Core.deleteLineBlock(before, line);
    source.apply(after);
    source.refresh();
    toastUndo('打勾了 · 这件事已划掉', () => {
      if (source.text() !== after) { toast('这行刚改过，就不撤回了'); return; }
      source.apply(before);
      source.refresh();
      toast('已撤回');
    });
  }
  /* 用一段新正文替换备忘录：走和手打一样的落盘路径，只重画倒计时板，不重建输入框 */
  function applyMemoText(tab, text) {
    const st = memoState[tab];
    const oldText = memoTextNow(tab);
    const oldHtml = memoHtmlNow(tab);
    const html = memoRichFromText(oldText, oldHtml, text);
    const ed = current === tab ? document.getElementById('memo-text') : null;
    if (ed) memoSetEditor(ed, html);
    st.draft = normalizeMemoPlain(text);
    st.html = html;
    st.dirty = true;
    flushMemo(tab);
    if (ed) {
      const cnt = document.getElementById('memo-count');
      if (cnt) cnt.textContent = normalizeMemoPlain(text).length + ' 字';
    }
    refreshTimerBoard(tab);
    const s = document.getElementById('memo-state');
    if (s && !st.dirty) s.textContent = memoStamp(tab);
  }
  function richToolbarHTML(id) {
    return '<div class="memo-toolbar rich-toolbar" id="' + esc(id) + '" role="toolbar" aria-label="文字格式">' +
      '<button class="memo-tool memo-bold" type="button" data-memo-cmd="bold" title="加粗（选中文字后点）"><b>B</b></button>' +
      '<select class="memo-select" data-memo-select="block" aria-label="段落样式">' +
        '<option value="">段落</option><option value="p">正文</option>' +
        '<option value="h2">标题</option><option value="h3">小标题</option>' +
      '</select>' +
      '<select class="memo-select" data-memo-select="size" aria-label="字号">' +
        '<option value="">字号</option><option value="2">小</option>' +
        '<option value="3">标准</option><option value="5">大</option>' +
      '</select>' +
      '<select class="memo-select" data-memo-select="highlight" aria-label="高亮颜色">' +
        '<option value="">高亮</option><option value="#fef08a">黄</option>' +
        '<option value="#bbf7d0">绿</option><option value="#bfdbfe">蓝</option>' +
        '<option value="transparent">清除</option>' +
      '</select>' +
      '<select class="memo-select" data-memo-select="color" aria-label="文字颜色">' +
        '<option value="">字色</option><option value="#0f172a">默认</option>' +
        '<option value="#dc2626">红</option><option value="#2563eb">蓝</option>' +
        '<option value="#15803d">绿</option>' +
      '</select>' +
      '<span class="memo-sep" aria-hidden="true"></span>' +
      '<button class="memo-tool" type="button" data-memo-cmd="table" title="选择行列并插入表格">▦ 表格</button>' +
      '<button class="memo-tool" type="button" data-memo-cmd="flow" title="创建可编辑流程图">◇ 流程图</button>' +
      '<button class="memo-tool" type="button" data-memo-cmd="clear" title="清除选中文字的格式">清除格式</button>' +
    '</div>';
  }
  const memoToolbarHTML = () => richToolbarHTML('memo-toolbar');
  function renderMemo(tab) {
    const cfg = MEMOS[tab];
    const st = memoState[tab];
    // 有未落盘的草稿就显示草稿：同步触发的重渲染不会把正在敲的字冲掉
    const text = st.draft != null ? st.draft : Core.memoText(items(), cfg.kind);
    const item = Core.memoOf(items(), cfg.kind);
    const html = st.html != null ? st.html : (memoHtmlForItem(item, text) || memoTextToHtml(text));
    const cleanHtml = sanitizeMemoHtml(html);
    const empty = !String(text || '').trim() && !memoHtmlHasContent(cleanHtml);
    const dueDefault = today();
    return '<section class="card memo-card memo-' + tab + '">' +
      '<h3>' + esc(cfg.title) + ' <span class="cnt" id="memo-count">' + text.length + ' 字</span></h3>' +
      '<p class="hint tight">' + esc(cfg.sub) + '</p>' +
      timerBoardHTML(tab) +
      '<div class="memo-editor-shell">' + memoToolbarHTML() +
        '<div id="memo-text" class="memo-editor' + (empty ? ' is-empty' : '') + '" ' +
          'contenteditable="true" role="textbox" aria-multiline="true" spellcheck="false" ' +
          'data-placeholder="' + esc(cfg.ph) + '">' + cleanHtml + '</div>' +
      '</div>' +
      '<div class="timer-add">' +
      '<span class="timer-add-label">' + Core.TIMER_MARK + ' 倒计时</span>' +
      '<input type="date" id="memo-timer-date" value="' + esc(dueDefault) + '" title="给光标所在那一行选个到期日" />' +
      '<button class="btn btn-sm btn-primary" type="button" id="memo-timer-add">加到光标那一行</button>' +
      '</div>' +
      '<p class="hint tight">光标点在某一句话上 → 选日期 → 点按钮，那一行末尾会写上「' + Core.TIMER_MARK + '年-月-日」并出现在上方倒计时里；手写「' + Core.TIMER_MARK + '2026-09-20」同样有效，删掉标记倒计时就取消。</p>' +
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
    // 只有当前正显示这张备忘录时编辑区才是它的，否则一律用草稿兜底
    const ed = current === t ? document.getElementById('memo-text') : null;
    const text = ed ? memoEditorPlain(ed) : st.draft;
    if (text == null) return;
    const html = ed ? memoEditorHtml(ed) : (st.html != null ? st.html : memoTextToHtml(text));
    st.dirty = false;
    const prevText = Core.memoText(items(), cfg.kind);
    const prevItem = Core.memoOf(items(), cfg.kind);
    const prevHtml = memoStoredHtml(prevItem);
    if (text === prevText && html === prevHtml) { st.draft = null; st.html = null; return; }
    const base = Core.memoOf(items(), cfg.kind) || Core.newItem({ kind: cfg.kind });
    st.draft = null;
    st.html = null;
    st.flushing = true;                        // 期间 onchange 触发的 render 直接跳过
    try {
      store.saveTask(Object.assign({}, base, { memo: text, memoHtml: html || memoTextToHtml(text) }));
    } finally {
      st.flushing = false;
    }
  }
  function memoOnInput(tab) {
    const st = memoState[tab];
    st.dirty = true;
    const ed = document.getElementById('memo-text');
    if (ed) {
      st.draft = memoEditorPlain(ed);
      st.html = memoEditorHtml(ed);
      ed.classList.toggle('is-empty', !st.draft.trim() && !ed.querySelector('table,hr'));
    }
    const cnt = document.getElementById('memo-count');
    const state = document.getElementById('memo-state');
    if (ed && cnt) cnt.textContent = (st.draft || '').length + ' 字';
    if (state) state.textContent = '保存中…';
    if (st.timer) clearTimeout(st.timer);
    st.timer = setTimeout(() => {
      st.timer = null;
      flushMemo(tab);
      refreshTimerBoard(tab);
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

  /* 今日提醒：琐事 / 创意 里 3 天内到期或已过期的倒计时（更远的留在各自页面里） */
  /* 今日页只收「今天到期 + 已过期」的倒计时，带上它属于哪张备忘录 */
  function todayTimerRows() {
    const d = today();
    const hot = [];
    Object.keys(MEMOS).forEach((tab) => {
      timersWithSubs(Core.memoText(items(), MEMOS[tab].kind)).forEach((t) => {
        if (t.days <= 0) {
          hot.push({
            t,
            src: MEMOS[tab].title.replace('备忘录', ''),
            sourceKey: 'memo:' + tab
          });
        }
      });
    });
    dayPapers().forEach((paper) => {
      timersWithSubs(paper.memo || '').forEach((t) => {
        if (t.days <= 0) {
          hot.push({
            t,
            src: '日程 ' + shortDay(paper.date),
            sourceKey: 'day:' + paper.date
          });
        }
      });
    });
    const monthNote = monthNoteItem();
    if (monthNote) {
      timersWithSubs(monthNote.memo || '').forEach((t) => {
        if (t.days <= 0) {
          hot.push({ t, src: '排期底稿', sourceKey: MONTH_NOTE_KIND });
        }
      });
    }
    reportItems().forEach((r) => {
      timersWithSubs(r.memo || '').forEach((t) => {
        if (t.days <= 0) {
          hot.push({
            t,
            src: '周报 · ' + (r.title || '未命名'),
            sourceKey: REPORT_DOC_PREFIX + r.id
          });
        }
      });
    });
    /* 过期的永远压在今天的上面；同一档里按正文顺序 —— 也就是你在板上拖出来的顺序 */
    const rank = { over: 0, today: 1 };
    const sources = Object.keys(MEMOS).map((tab) => 'memo:' + tab)
      .concat(dayPapers().map((p) => 'day:' + p.date))
      .concat([MONTH_NOTE_KIND])
      .concat(reportItems().map((r) => REPORT_DOC_PREFIX + r.id));
    hot.sort((a, b) => {
      const ra = rank[a.t.state] == null ? 9 : rank[a.t.state];
      const rb = rank[b.t.state] == null ? 9 : rank[b.t.state];
      if (ra !== rb) return ra - rb;
      if (a.t.line !== b.t.line) return a.t.line - b.t.line;   // 同一档里按正文顺序（拖出来的顺序）
      return sources.indexOf(a.sourceKey) - sources.indexOf(b.sourceKey);
    });
    return hot;
  }
  const TODAY_TIMER_HINT = '琐事 / 点子 / 娱乐 / 日程 / 排期底稿 / 周报里标了提醒、今天到期或已经过期的那几句。' +
    '方框打勾 = 这件事做完了，整行（连它的进展）直接从原白纸里划掉，误点可在提示条上「撤回」；' +
    '点字改内容 · 改日期 · ＋进展补记 · ✕ 只去掉倒计时（正文那句话留着）—— 改的都是原白纸里那一行，不用再回去改；' +
    '整条可拖动排序（只在同一张备忘录里生效）。';
  function todayTimersBodyHTML() {
    const hot = todayTimerRows();
    if (!hot.length) return '';
    const pend = hot.filter((x) => !x.t.done);
    const done = hot.filter((x) => x.t.done);
    return '<p class="hint tight">' + TODAY_TIMER_HINT + '</p>' +
      pend.map((x) => timerRowHTML(x.t, x.src, x.sourceKey)).join('') +
      done.map((x) => timerRowHTML(x.t, x.src, x.sourceKey)).join('');
  }
  function refreshTodayTimers() {
    if (current !== 'today') return;
    if (sortActive > 0) { pendingRender = true; return; }
    const el = document.getElementById('today-timers');
    if (el) el.innerHTML = todayTimersBodyHTML();
  }
  function todayTimersHTML() {
    const hot = todayTimerRows();
    if (!hot.length) return '';
    const pend = hot.filter((x) => !x.t.done);
    const doneN = hot.length - pend.length;
    const over = pend.filter((x) => x.t.state === 'over').length;
    const head = pend.length
      ? '今日提醒 · ' + pend.length + ' 条' + (doneN ? ' · 已打勾 ' + doneN : '') +
        (over ? ' · 已过期 ' + over : '')
      : '今日提醒 · 今天的都打勾了 ✓ · 已打勾 ' + doneN;
    return section(head, '<div id="today-timers">' + todayTimersBodyHTML() + '</div>',
      '', over ? 'acc-red' : 'acc-amber');
  }

  /* ---------- 今日：富文本提醒 → 循环 → 打卡 → 近七天项目 → 近七周日历 ---------- */
  function renderToday() {
    const d = today();
    const te = Core.todayEntries(items(), checkins(), d);
    const loopAll = te.loops;
    const loopPend = loopAll.filter((e) => !e.done);
    const loopDone = loopAll.filter((e) => e.done);
    const loopRow = (e, compact) => cardHTML(e.item, {
      check: true, done: !!compact, date: d, hot: !compact,
      chips: compact
        ? [{ text: '循环 · 已完成', cls: 'ok' }]
        : [{ text: '循环 · ' + Core.loopLabel(e.item), cls: 'm-loop' }, { text: '今天要做', cls: 'warn' }],
      compact: !!compact, minimal: !!compact
    });
    const loopBody = loopAll.length
      ? loopPend.map((e) => loopRow(e, false)).join('') +
        (loopDone.length ? doneGrid(loopDone.map((e) => loopRow(e, true))) : '')
      : emptyLine('今天没有循环任务。', 'loop', '去循环页');

    const habitAll = itemOfKind('habit').filter((item) => item.freq === 'daily').map((item) => {
      const st = Core.habitOn(item, d, checkins());
      if (!st) return null;
      const missed = item.freq === 'daily' && Core.dailyScheduledOn(item, Core.shiftDate(d, -1)) &&
        !Core.checkedOn(item.id, checkins(), Core.shiftDate(d, -1));
      return { item, st, missed };
    }).filter(Boolean);
    const habitDone = habitAll.filter((e) => e.st.done);
    const habitPend = habitAll.filter((e) => !e.st.done);
    const habitRow = (e, compact) => cardHTML(e.item, {
      check: true, done: !!compact, date: d,
      chips: compact
        ? [{ text: '打卡 · 已完成', cls: 'ok' }]
        : [{ text: '打卡 · ' + (e.item.freq === 'weekly' ? '每周' : '每日'), cls: e.item.freq === 'weekly' ? 'm-plan' : 'm-life' }]
          .concat(e.missed ? [{ text: '昨日未打卡', cls: 'warn' }] : []),
      softGreen: !compact && e.missed,
      compact: !!compact, minimal: !!compact
    });
    const habitBody = habitAll.length
      ? habitPend.map((e) => habitRow(e, false)).join('') +
        (habitDone.length ? doneGrid(habitDone.map((e) => habitRow(e, true))) : '')
      : emptyLine('今天没有打卡项目。', 'disc', '去打卡页');

    const plans = nearPlanItems();
    const planRow = (e, compact) => {
      const t = e.item;
      const chips = compact
        ? [{ text: '项目 · 已完成', cls: 'ok' }]
        : [{ text: '项目', cls: 'm-plan' }]
          .concat((t.rangeStart || t.rangeEnd)
            ? [{ text: (t.rangeStart || '?') + ' → ' + (t.rangeEnd || '持续'), cls: 'dim' }]
            : [])
          .concat(e.st.overdue
            ? [{ text: '已拖延 ' + e.st.overdueDays + ' 天未完成', cls: 'over' }]
            : [{ text: '剩 ' + Math.max(0, Core.dayDiff(d, t.rangeEnd)) + ' 天', cls: 'warn' }]);
      return cardHTML(t, {
        check: true, checkAction: 'plan-done', done: !!compact, date: d,
        chips, notesList: !compact, hot: !compact && (e.st.overdue || e.st.urgent),
        compact: !!compact, minimal: !!compact
      });
    };
    const planBody = plans.length
      ? plans.map((e) => planRow(e, false)).join('')
      : emptyLine('近七天没有项目到期。', 'plan', '去项目页');

    const calItems = calendarNearItems();
    const calBody = calItems.length
      ? '<div class="today-cal-list">' + calItems.map((n) =>
          '<button class="today-cal-row" type="button" data-action="calendar-edit" data-id="' + n.id + '">' +
            '<span class="today-cal-date">' + esc(Core.fmtCN(n.date)) + '</span>' +
            '<span class="today-cal-text">' + esc(n.text || '') + '</span>' +
          '</button>').join('') + '</div>'
      : emptyLine('近七天日历里没有记录。', 'calendar', '去日历');

    return todayTimersHTML() +
      section('今日循环 · ' + loopPend.length + ' 条待做', loopBody, '', 'acc-indigo') +
      section('今日打卡 · ' + habitPend.length + ' 条待做', habitBody, '', 'acc-green') +
      section('近七天项目 · ' + plans.length + ' 条提醒', planBody,
        '<p class="hint tight">已逾期项目固定排在最顶部；结束日在未来 7 天内的项目会出现在这里。</p>',
        plans.some((e) => e.st.overdue) ? 'acc-red' : 'acc-amber') +
      section('近七周日历 · ' + calItems.length + ' 条记录', calBody,
        '<p class="hint tight">只收今天起 7 天内的日历记录；点一条可直接修改。</p>', 'acc-blue');
  }

  /* ---------- 公司页 ---------- */
  function renderWork() {
    const b = workRows();
    const d = b.d;
    const total = b.today.length + b.tomorrow.length + b.later.length;
    let html = section('公司 · 总览',
      '<div class="summary">' + statPill('今日', b.today.length, 's-blue') +
      statPill('明日', b.tomorrow.length) +
      statPill('更晚', b.later.length) +
      statPill('已完成', b.done.length, 's-green') + '</div>' +
      '<p class="hint tight">按到期日自动分桶，逾期会自动顺延到今天。今日 / 明日 / 更晚 都能在下面直接拖动改顺序。</p>', '', 'acc-blue');

    const head = (key, label, note) => '<h4 class="wb-head" data-bucket="' + key + '">' + label +
      '<span class="cnt">' + b[key].length + '</span>' + (note ? '<span class="wb-note">' + note + '</span>' : '') + '</h4>';
    const cards = (key) => b[key].map((x) => workCardHTML(x, d)).join('');
    const overdue = b.today.filter((x) => x.w.overdue).length;
    const board = total
      ? head('today', '今日', overdue ? '含逾期顺延 ' + overdue : '') + cards('today') +
        head('tomorrow', '明日', '') + cards('tomorrow') +
        head('later', '更晚', '') + cards('later')
      : emptyBox('没有待办。点右上「＋新建」加一条。');
    html += '<section class="card work-board-card"><h3>待办 · 整条任意位置可拖动 ' +
      '<span class="cnt">' + total + ' 条</span></h3>' +
      '<p class="hint tight">拖动改顺序（顺序会存到云端，三端一致）；把一条拖进别的桶，到期日会跟着改：拖进「明日」＝改到明天，拖进「更晚」＝改到一周后。</p>' +
      '<div class="plan-board work-board" id="work-board">' + board + '</div></section>';
    if (b.done.length) html += doneSection('work', b.done.map((x) => workDoneRow(x, d)));
    if (!total && !b.done.length) html += emptyBox('还没有公司条目。点右上「＋新建」添加第一条。');
    return html;
  }

  /* ---------- 计划页：单一可拖拽排序板（不再重复列两遍） ---------- */
  function renderPlan() {
    const g = planOrdered();
    const urg = g.active.filter((e) => e.st.urgent).length;
    const over = g.active.filter((e) => e.st.overdue).length;
    const cards = g.active.map((e, i) => planCard(e, false, i + 1)).join('') ||
      emptyBox('还没有进行中的方向：在下方写一条，会自动出现在这里。');

    let html = '<section class="card plan-board-card' + ((urg || over) ? ' has-urgent' : '') + '">' +
      '<h3>项目优先级排序 · 整条可拖动' +
      (over ? ' <span class="urgent-note">' + over + ' 条已拖延</span>' : '') +
      (urg ? ' <span class="urgent-note">' + urg + ' 条紧急</span>' : '') +
      ' <span class="cnt">' + g.active.length + ' 条</span></h3>' +
      '<p class="hint tight">拖动任意位置即可改顺序，但只在同一档里生效：' +
      '「已拖延」（过了结束日还没完成）永远在最上面，其次是「紧急」（结束日最后 10 天），再是正常；' +
      '硬规则挡住你拖动时会弹提示说明原因。想收起已拖延那条：打勾完成，或改结束日。</p>' +
      '<div class="plan-board" id="plan-board">' + cards + '</div></section>';

    html += '<section class="card plan-new-card"><h3>写项目方向</h3>' +
      '<div class="field"><input id="p-title" type="text" maxlength="120" placeholder="大的项目方向，如：2026 Q4 换工作" /></div>' +
      '<div class="field-row">' +
      '<label class="field"><span>开始</span><input id="p-start" type="date" /></label>' +
      '<label class="field"><span>结束（最后 10 天自动置顶“紧急”）</span><input id="p-end" type="date" /></label></div>' +
      '<div class="actions-row"><button class="btn btn-primary" id="btn-plan-add" type="button">＋ 添加项目</button>' +
      '<span class="hint">目前 ' + g.active.length + ' 条进行中</span></div></section>';

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
    return section('每日打卡', '<p class="hint">每天都要勾；昨天漏勾的会自动顺延到今天并标注「昨日未打勾」。</p>' +
      (daily || emptyBox('还没有每日打卡。点「＋新建」，类型选 打卡、频率选 每日。')), '', 'acc-green') +
      section('每周打卡 · 本周自 ' + wkStart, '<p class="hint">自然周（周一起）内勾一次即完成，下周一自动重置。</p>' +
        (weekly || emptyBox('还没有每周打卡。点「＋新建」，类型选 打卡、频率选 每周。')), '', 'acc-blue');
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
      '<p class="hint">已完成区默认收成一行，点标题展开，不会自动删任何东西；展开后默认只露最近 ' + DONE_RECENT_DAYS + ' 天完成的。下面只在你手动点时，才删掉完成超过 ' + PURGE_KEEP_DAYS + ' 天的公司任务与项目方向，打勾历史（连续天数、打卡记录）一律保留。</p>' +
      '<div class="actions-row"><button class="btn" id="set-purge-done" type="button"' + (purgeIds().length ? '' : ' disabled') + '>清理完成超过 ' + PURGE_KEEP_DAYS + ' 天的（' + purgeIds().length + ' 条）</button></div></section>' +
      '<section class="card"><h3>数据恢复 · 本机历史快照</h3>' +
      '<p class="hint">每次被云端新数据覆盖之前，本机都会把上一版存一份（每个文件最多 ' + HIST_MAX + ' 份）。万一某次同步把内容变少或误删了，点「恢复」就能把那一版整份推回云端，三端一起回到那个版本。</p>' +
      historyHTML() +
      '</section>' +
      '<section class="card danger-zone"><h3>本机数据</h3>' +
      '<div class="actions-row"><button class="btn" id="set-refresh" type="button">重新拉取云端</button>' +
      '<button class="btn btn-danger" id="set-clear" type="button">清空本机缓存</button></div>' +
      '<p class="hint">设备 ID：' + esc(store.deviceId) + '</p></section>'
    );
  }

  /* ---------- 设置页：历史快照列表 ---------- */
  const HIST_LABEL = { tasks: '待办', checkins: '打勾', settings: '设置' };
  function histCount(file, v) {
    if (file === 'tasks') return (v || []).length + ' 条';
    if (file === 'checkins') return Object.keys(v || {}).length + ' 天';
    return Object.keys((v && v.devices) || {}).length + ' 台设备';
  }
  function histStamp(at) {
    const d = new Date(at);
    if (isNaN(d.getTime())) return at || '';
    const p2 = (n) => (n < 10 ? '0' + n : String(n));
    return (d.getMonth() + 1) + '-' + d.getDate() + ' ' + p2(d.getHours()) + ':' + p2(d.getMinutes());
  }
  function historyHTML() {
    let out = '';
    ['tasks', 'checkins', 'settings'].forEach((f) => {
      const list = store.history(f).slice(0, 6);
      if (!list.length) return;
      out += '<div class="hist-group"><div class="hist-title">' + esc(HIST_LABEL[f]) + '</div>' +
        list.map((h) => '<div class="hist-row"><span class="hist-at">' + esc(histStamp(h.at)) + '</span>' +
          '<span class="hist-n">' + esc(histCount(f, h.value)) + '</span>' +
          '<button class="mini-btn" type="button" data-restore="' + f + ':' + h.index + '">恢复</button></div>').join('') +
        '</div>';
    });
    return out || '<p class="hint tight">还没有历史快照（同步过一两次之后就会出现）。</p>';
  }
  async function restoreSnapshot(spec) {
    const parts = String(spec).split(':');
    const file = parts[0], idx = Number(parts[1]);
    const h = store.history(file)[idx];
    if (!h) return toast('这份快照读不出来了');
    const ok = await confirmDialog('恢复数据',
      '把「' + (HIST_LABEL[file] || file) + '」回退到 ' + histStamp(h.at) + ' 的版本（' + histCount(file, h.value) + '）？\n会整份推回云端，另一台设备和 iPhone 也会跟着回到这个版本。');
    if (!ok) return;
    try {
      store.restoreSnapshot(file, idx);
      toast('已恢复，正在同步到三端');
    } catch (err) {
      toast('恢复失败：' + err.message, 4000);
    }
  }

  /* ---------- Tab ---------- */
  function tabBtn(id, label, badge, extra) {
    const b = badge > 99 ? '99+' : badge;   // 习惯清单会长，角标太宽会把 8 个 tab 挤歪
    return '<button class="tab' + (current === id ? ' active' : '') + (extra || '') +
      '" data-tab="' + id + '" type="button">' +
      label + (badge ? '<i>' + b + '</i>' : '') + '</button>';
  }
  const NAV_GROUPS = [
    { id: 'creative', label: '创意层', tabs: [['idea', '点子'], ['fun', '娱乐']] },
    { id: 'planning', label: '计划层', tabs: [['month', '排期'], ['plan', '项目'], ['calendar', '日历'], ['loop', '循环']] },
    { id: 'action', label: '行动层', tabs: [['agenda', '日程'], ['disc', '打卡']] }
  ];
  const LEGACY_TABS = [
    ['today', '今日'], ['work', '公司'], ['plan', '项目'], ['disc', '打卡'],
    ['keep', '习惯'], ['month', '排期'], ['memo', '琐事'], ['idea', '点子'],
    ['eff', '效率'], ['settings', '设置']
  ];
  const NAV_HIDE_BADGES = new Set(['plan', 'disc', 'today']);
  const navBadge = (id, badges) => NAV_HIDE_BADGES.has(id) ? 0 : (badges[id] || 0);
  function navGroupHTML(group, badges) {
    const active = group.tabs.some((t) => t[0] === current);
    const open = navGroupOpen === group.id;
    return '<div class="nav-group' + (active ? ' is-active' : '') + (open ? ' is-open' : '') + '" data-nav-wrap="' + group.id + '">' +
      '<button class="nav-group-main" type="button" data-nav-group="' + group.id + '">' +
        group.label + '<span class="nav-caret">▾</span>' +
      '</button>' +
      '<div class="nav-subtabs">' +
        group.tabs.map((t) => tabBtn(t[0], t[1], navBadge(t[0], badges), ' nav-subtab')).join('') +
      '</div></div>';
  }
  function navHTML(badges) {
    const more = '<div class="nav-more' + (navMoreOpen ? ' is-open' : '') + '">' +
      '<button class="nav-more-btn" type="button" data-nav-more="1">更多<span class="nav-caret">▾</span></button>' +
      '<div class="nav-more-menu' + (navMoreOpen ? '' : ' hidden') + '" role="menu">' +
        LEGACY_TABS.map((t) => tabBtn(t[0], t[1], navBadge(t[0], badges), ' nav-legacy-tab')).join('') +
      '</div></div>';
    return NAV_GROUPS.map((g) => navGroupHTML(g, badges)).join('') +
      tabBtn('today', '今日', navBadge('today', badges), ' nav-today') + more;
  }
  function render() {
    if (sortActive > 0) { pendingRender = true; return; }   // 拖动中重建 DOM 会把手上那张卡片变成孤儿
    if (flowSession) { pendingRender = true; return; }       // 流程图弹窗打开时保住白纸节点与光标
    pendingRender = false;
    if (monthState.flushing) return;              // 排期正在落盘，别把输入框重建掉
    if (anyMemoFlushing()) return;               // 备忘录正在落盘，别把输入框重建掉
    if (anyRichDocFlushing()) return;            // 计划底稿 / 周报正在落盘，保住光标
    if (MEMOS[current]) {
      const st = memoState[current];
      const ed = document.getElementById('memo-text');
      if (ed && document.activeElement === ed) {
        const typed = memoEditorPlain(ed);
        flushMemo(current);                      // 先把正在敲的字存下来
        if (ed.isConnected && typed === Core.memoText(items(), MEMOS[current].kind)) {
          $('#subline').textContent = statusText();   // 内容没变：只更新顶栏，保住光标
          return;
        }
      } else if (st.dirty || st.draft != null) {
        flushMemo(current);
      }
    }
    if (current === 'month') {
      const ae = document.activeElement;
      if (ae && ae.classList && ae.classList.contains('ms-text')) {
        flushMonth();                            // 先把正在敲的字存下来
        $('#subline').textContent = statusText(); // 内容没变：只更新顶栏，保住光标
        return;
      }
      if (ae && ae.dataset && ae.dataset.docKey) {
        flushRichDoc(ae.dataset.docKey);
        if (!reportNaming) {
          $('#subline').textContent = statusText();
          return;
        }
      }
      if (ae && ae.id === 'report-name' && reportNaming) {
        $('#subline').textContent = statusText();
        return;
      }
      if (monthState.dirty) flushMonth();
    }
    if (current === 'agenda') {
      const ae = document.activeElement;
      const key = ae && ae.dataset ? String(ae.dataset.docKey || '') : '';
      if (key.indexOf('day:') === 0) {
        flushDayPaper(key.slice(4));
        $('#subline').textContent = statusText();
        return;
      }
      calendarNearDates(7).forEach(flushDayPaper);
    }
    $('#subline').textContent = statusText();
    $('#tabs').innerHTML = navHTML({
      today: todayPendingCount(),
      work: workToday(),
      plan: activePlans().length,
      disc: habitPendingCount(),
      keep: itemOfKind('keep').length,
      loop: loopPendingCount(),
      calendar: calendarNearCount()
    });
    $('#btn-new').textContent = '＋ 新建';
    $('#btn-new').classList.toggle('hidden',
      !!MEMOS[current] || current === 'month' || current === 'calendar' ||
      current === 'loop' || current === 'agenda' || current === 'today');
    const view = $('#view');
    if (current === 'today') view.innerHTML = renderToday();
    else if (current === 'work') view.innerHTML = renderWork();
    else if (current === 'plan') view.innerHTML = renderPlan();
    else if (current === 'disc') view.innerHTML = renderDisc();
    else if (current === 'keep') view.innerHTML = renderKeep();
    else if (current === 'month') view.innerHTML = renderMonth();
    else if (current === 'calendar') view.innerHTML = renderCalendar();
    else if (current === 'loop') view.innerHTML = renderLoopPage();
    else if (current === 'agenda') view.innerHTML = renderAgenda();
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
  /* 正在拖动的排序实例数。拖动期间一律不重建 DOM：
   * 否则容器被换掉，手上这张浮起来的卡片就成了孤儿，is-dragging 锁也留在页面上，
   * 看起来就是「页面卡住了，拖不动也没反应」。等拖完再补一次渲染。 */
  let sortActive = 0;
  let pendingRender = false;
  function flushPendingRender() {
    if (sortActive > 0 || !pendingRender) return;
    pendingRender = false;
    try { render(); } catch (e) { /* 忽略 */ }
  }
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
    /* 兜底：鼠标在窗口外松开、切后台、按 Esc、或 event 对不上实例时，
       pointerup 可能永远收不到。这时页面会一直留着浮起来的卡片 + is-dragging 锁（就是「卡住」）。
       任何可疑信号都来清一次，清不到东西也不会有副作用。 */
    window.addEventListener('blur', () => abortAllDrags(true));
    document.addEventListener('visibilitychange', () => { if (document.hidden) abortAllDrags(true); });
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape') abortAllDrags(true); });
    window.addEventListener('pointerup', () => setTimeout(() => abortAllDrags(false), 0));       // 正常收尾之后兜底
    window.addEventListener('pointercancel', () => setTimeout(() => abortAllDrags(false), 0));
    window.addEventListener('touchend', () => setTimeout(() => abortAllDrags(false), 0));
    /* 挂在 window 上：指针在容器外松开也能正常收尾 */
    window.addEventListener('pointermove', each((i, e) => i.onMove(e)), { passive: false });
    window.addEventListener('pointerup', each((i, e) => i.onUp(e)));
    window.addEventListener('pointercancel', each((i, e) => i.onUp(e)));
    window.addEventListener('touchmove', each((i, e) => i.onTouchMove(e)), { passive: false });
    /* 文档级兜底：从选中的文字上再拖会触发浏览器原生拖拽（就是那个「复制感」），
       而拖动中的元素此时挂在 body 下，容器级监听拦不到，所以在这里一并拦掉 */
    document.addEventListener('dragstart', (e) => {
      const t = e.target;
      if (t && t.closest && t.closest('.note-line, .item-card, .task, .sort-ph, .timer-item')) e.preventDefault();
    }, true);
  }

  /* 把所有残留的拖动状态清干净（浮起的卡片、占位符、body 上的锁） */
  function abortAllDrags(withPending) {
    let any = false;
    let released = false;
    for (let i = SORT_LIVE.length - 1; i >= 0; i -= 1) {
      const inst = SORT_LIVE[i];
      if (withPending && inst.cancelPending && inst.cancelPending()) released = true;
      if (!inst.container.isConnected) { SORT_LIVE.splice(i, 1); continue; }
      if (inst.hasDrag && inst.hasDrag()) { inst.cancel(); any = true; }
    }
    /* 实例已经丢了也不怕：按残骸特征直接扫 */
    document.querySelectorAll('.sort-ph').forEach((p) => p.remove());
    document.querySelectorAll('body > .is-sorting').forEach((el) => el.remove());
    document.body.classList.remove('is-dragging');
    if (any || released) flushPendingRender();
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
      /* 指针捕获挂在容器上（卡片已被移到 body，捕获会被丢掉）：
       * 这样指针跑到窗口外再松开，pointerup 也还能收到。 */
      try { if (container.setPointerCapture) container.setPointerCapture(e.pointerId); } catch (err) { /* 忽略 */ }
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

    /* keepOrder=false 时直接丢弃这次拖动（容器已被换掉、Esc 取消、窗口失焦…） */
    function endDrag(keepOrder) {
      const d = drag;
      if (!d) return;
      drag = null;
      if (sortActive > 0) sortActive -= 1;
      try {
        if (container.hasPointerCapture && container.hasPointerCapture(d.pointerId)) container.releasePointerCapture(d.pointerId);
      } catch (err) { /* 忽略 */ }
      document.body.classList.remove('is-dragging');
      d.el.classList.remove('is-sorting');
      d.el.removeAttribute('style');
      /* 占位符还在、且容器本身还挂在页面上，才算这次拖动有效 */
      const alive = !!d.ph.parentElement && container.isConnected;
      if (keepOrder && alive) {
        container.insertBefore(d.el, d.ph);
        d.ph.remove();
        SORT_LAST_DRAG = Date.now();
      } else {
        d.el.remove();                  // 丢掉漂浮副本，别留在页面上
        d.ph.remove();
        /* 取消 = 按数据重建一遍：卡片本身被拿走又没放回去，得靠重渲染让它回到原位 */
        if (typeof d.el.isConnected === 'boolean') pendingRender = true;
      }
      /* 先读顺序（占位符已换成真身），再补渲染，免得渲染把节点换掉后读不到 */
      const endOrder = (keepOrder && alive) ? listItems().map(keyOf) : null;
      if (endOrder && d.start.join('|') !== endOrder.join('|') && opts.onReorder) opts.onReorder(endOrder);
      flushPendingRender();
    }
    function finish() { endDrag(true); }
    function cancel() { endDrag(false); }

    function onDown(e) {
      if (drag) return;
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      if (e.target.closest && e.target.closest(ignoreSel)) return;
      const el = itemFor(e.target);
      if (!el) return;
      clearTimeout(timer);
      down = { el, x: e.clientX, y: e.clientY, pointerId: e.pointerId };
      sortActive += 1;              // 从按下起就锁住重绘，别在拖动真正开始前把条目换掉
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
      /* 鼠标在窗口外松开过：下一次 move 时 buttons 已经是 0，直接收尾，别一直卡着 */
      if (drag && e.pointerType === 'mouse' && e.buttons === 0) { finish(); return; }
      if (down && !drag && e.pointerId === down.pointerId) {
        if (Math.abs(e.clientY - down.y) < 6 && Math.abs(e.clientX - down.x) < 6) return;
        clearTimeout(timer);
        if (e.pointerType !== 'mouse') {          // 先滑动了：交给页面滚动
          down = null;
          if (sortActive > 0) sortActive -= 1;
          return;
        }
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
      if (down && e.pointerId === down.pointerId) {
        down = null;
        if (sortActive > 0) sortActive -= 1;
      }
      if (drag && e.pointerId === drag.pointerId) finish();
    }
    function onTouchMove(e) { if (drag && e.cancelable) e.preventDefault(); }
    bindSortGlobals();
    for (let i = SORT_LIVE.length - 1; i >= 0; i -= 1) {
      if (SORT_LIVE[i].container === container) SORT_LIVE.splice(i, 1); // 同一容器不重复绑定
    }
    SORT_LIVE.push({
      container, onMove, onUp, onTouchMove, cancel,
      cancelPending: () => {
        if (!down) return false;
        down = null;
        if (sortActive > 0) sortActive -= 1;
        return true;
      },
      hasDrag: () => !!drag
    });

    container.addEventListener('pointerdown', onDown);
    container.addEventListener('dragstart', (e) => e.preventDefault()); // 关掉浏览器原生拖拽
  }

  /* ---------- 公司页拖拽：桶内改顺序，跨桶自动改到期日 ---------- */
  function bindWorkDrag() {
    const board = $('#work-board');
    if (!board) return;
    makeSortable(board, {
      itemSelector: '.item-card, .task',
      keyOf: (el) => el.dataset.id,
      onReorder: (ids) => {
        /* 拖完先看每条现在落在哪个桶里（按 DOM 顺序扫桶标题），再决定要不要改到期日 */
        const bucketOf = {};
        let cur = null;
        Array.prototype.slice.call(board.children).forEach((el) => {
          if (el.classList && el.classList.contains('wb-head')) { cur = el.getAttribute('data-bucket'); return; }
          const id = el.dataset ? el.dataset.id : null;
          if (id) bucketOf[id] = cur;
        });
        const d = today();
        const ranks = {};
        ids.forEach((id, i) => { ranks[id] = i + 1; });
        store.setRanks(ranks);                       // 顺序：整块板子一起重排 1..N
        let moved = 0;
        ids.forEach((id) => {
          const t = byId(id);
          if (!t || t.kind !== 'work' || t.done) return;
          const bucket = bucketOf[id];
          const nowBucket = Core.workStatus(t, d).bucket;
          let target = null;
          if (bucket === 'today' && nowBucket !== 'today') target = d;
          else if (bucket === 'tomorrow' && nowBucket !== 'tomorrow') target = Core.shiftDate(d, 1);
          else if (bucket === 'later' && (nowBucket === 'today' || nowBucket === 'tomorrow')) target = Core.shiftDate(d, 7);
          if (target && t.due !== target) {
            store.saveTask(Object.assign({}, t, { due: target }));
            moved += 1;
          }
        });
        toast(moved ? '顺序已保存 · ' + moved + ' 条改了到期日' : '顺序已保存');
      }
    });
  }

  /* ---------- 计划拖拽 ---------- */
  /* 硬规则（已拖延 / 紧急 必须在上）挡住拖动时，别让用户白拖：先说清楚为什么。
   * 做法是拿新 rank「预演」一遍真实排序，和用户拖出来的顺序一比，不一致就是被规则顶回去了。 */
  function planDragNote(ids) {
    const d = today();
    const list = ids.map((id, i) => {
      const t = byId(id);
      if (!t || t.kind !== 'plan') return null;
      const st = Core.planState(t, d);
      return { id, item: Object.assign({}, t, { rank: i + 1 }), st, top: !!(st.overdue || st.urgent) };
    }).filter(Boolean);
    const want = list.map((x) => x.id);
    const eff = list.slice().sort((a, b) => Core.planOrderCmp(a.item, b.item, d)).map((x) => x.id);
    if (eff.join(',') === want.join(',')) return '';
    const at = (id) => want.indexOf(id);
    /* ① 想把某条排到「已拖延 / 紧急」上面 → 直接点名那条规则条目 */
    const blocked = list.find((x) => {
      const i = at(x.id);
      return x.top && i > 0 && want.slice(0, i).some((id2) => {
        const y = list.find((z) => z.id === id2);
        return y && !y.top;
      });
    });
    if (blocked) {
      const why = blocked.st.overdue
        ? '已拖延 ' + blocked.st.overdueDays + ' 天未完成'
        : '已进入「紧急」（结束日最后 10 天）';
      return '「' + blocked.item.title + '」' + why + '，固定在排序板最上面，不能排到它上面 · 只在同一档里拖动才有效';
    }
    /* ② 想在「已拖延」和「紧急」之间互换 → 说清这两档的先后 */
    return '「已拖延」永远压在「紧急」上面（两档都固定在排序板最上面），不能互换 · 同一档里拖动才有效';
  }
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
        toast(planDragNote(ids) || '顺序已保存', 4200);
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

  /* ---------- 倒计时板的操作（琐事 / 创意页与今日页共用一套） ---------- */
  /* ＋进展：在那一行下面长出 ↳ 行，写回它所属的备忘录 */
  function beginSubAdd(item, source) {
    if (!item || item.querySelector('.timer-sub-add-form')) return;
    const line = Number(item.getAttribute('data-line'));
    const form = document.createElement('form');
    form.className = 'timer-sub-add-form';
    form.innerHTML = '<input type="text" maxlength="200" placeholder="记一条进展，回车保存（自动带日期）" />' +
      '<button type="submit">记下</button>';
    item.appendChild(form);
    const inp = form.querySelector('input');
    inp.focus();
    let settled = false;
    const commit = () => {
      if (settled) return;
      settled = true;
      const v = inp.value.replace(/\s+/g, ' ').trim();
      if (!v) { form.remove(); return; }
      source.apply(Core.addSubLine(source.text(), line, v, today()));
      source.refresh();
      toast('进展已记下 · 已同步');
    };
    form.addEventListener('submit', (e) => { e.preventDefault(); commit(); });
    inp.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') { e.preventDefault(); settled = true; form.remove(); }
    });
    inp.addEventListener('blur', () => setTimeout(commit, 120));
  }
  /* 点进展的文字 → 就地改（回车 / 失焦提交，Esc 取消） */
  function beginSubEdit(row, source) {
    if (!row || row.classList.contains('is-editing')) return;
    const span = row.querySelector('.sub-text');
    if (!span) return;
    const line = Number(row.getAttribute('data-sub-line'));
    const before = span.textContent;
    row.classList.add('is-editing');
    const inp = document.createElement('input');
    inp.type = 'text';
    inp.className = 'sub-edit';
    inp.value = before;
    span.replaceWith(inp);
    inp.focus();
    inp.select();
    let settled = false;
    const settle = (save) => {
      if (settled) return;
      settled = true;
      const v = inp.value.replace(/\s+/g, ' ').trim();
      if (!save || v === before) { source.refresh(); return; }
      source.apply(Core.setSubLineText(source.text(), line, v));
      source.refresh();
      toast('这条进展改好了');
    };
    inp.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); settle(true); }
      else if (e.key === 'Escape') { e.preventDefault(); settle(false); }
    });
    inp.addEventListener('blur', () => settle(true));
  }
  /* 板上的通用操作：打勾 / 点字改 / 改日期 / ＋进展 / 删进展 / ✕ 去掉倒计时 */
  function bindTimerBoard(el, fallbackTab) {
    if (!el) return;
    const itemOf = (target) => (target && target.closest ? target.closest('.timer-item') : null);
    el.addEventListener('click', (e) => {
      const item = itemOf(e.target);
      if (!item) return;
      const source = timerSourceFromRow(item, fallbackTab);
      if (!source) return;
      const line = Number(item.getAttribute('data-line'));
      const subDel = e.target.closest('[data-action="sub-del"]');
      if (subDel) {
        source.apply(Core.deleteSubLine(source.text(), Number(subDel.getAttribute('data-sub-line'))));
        source.refresh();
        toast('已删掉这条进展');
        return;
      }
      if (e.target.closest('[data-action="sub-add"]')) { beginSubAdd(item, source); return; }
      const sub = e.target.closest('[data-action="sub-edit"]');
      if (sub) { beginSubEdit(sub, source); return; }
      if (e.target.closest('[data-action="timer-del"]')) {
        source.apply(Core.clearLineTimer(source.text(), line));
        source.refresh();
        toast('已去掉这条倒计时（正文那句话留着）');
        return;
      }
      if (e.target.closest('[data-action="timer-edit"]')) beginTimerEdit(item, fallbackTab);
    });
    el.addEventListener('change', (e) => {
      const item = itemOf(e.target);
      if (!item) return;
      const source = timerSourceFromRow(item, fallbackTab);
      if (!source) return;
      const cb = e.target.closest('[data-action="timer-toggle"]');
      if (cb) { toggleTimerDone(item, fallbackTab, cb.checked); return; }
      const inp = e.target.closest('[data-action="timer-date"]');
      if (!inp) return;
      const due = inp.value;
      if (!/^\d{4}-\d{2}-\d{2}$/.test(due)) { source.refresh(); return toast('日期不对'); }
      source.apply(Core.setLineTimer(source.text(), Number(item.getAttribute('data-line')), due));
      source.refresh();
      toast('已改到 ' + due + ' · ' + Core.fmtLeft(Core.dayDiff(today(), due)));
    });
  }
  /* 拖动排序：句子连着它的进展行整块搬家；不同备忘录之间不互相搬 */
  function bindTimerDrag() {
    [[$('#memo-timers'), current], [$('#today-timers'), null]].forEach((pair) => {
      const el = pair[0];
      if (!el) return;
      makeSortable(el, {
        itemSelector: '.timer-item',
        ignoreSelector: SORT_IGNORE + ', .timer-sub, .timer-subs',
        keyOf: (x) => (x.dataset.srcKey || ('memo:' + (x.dataset.srcTab || current || ''))) + '|' + x.dataset.line,
        onReorder: (order) => applyTimerOrder(pair[1], order)
      });
    });
  }
  function applyTimerOrder(fallbackTab, order) {
    const groups = new Map();
    (order || []).forEach((k) => {
      const parts = String(k).split('|');
      const sourceKey = parts[0] || ('memo:' + (fallbackTab || ''));
      const line = Number(parts[1]);
      if (!Number.isFinite(line) || !timerSourceFromKey(sourceKey)) return;
      if (!groups.has(sourceKey)) groups.set(sourceKey, []);
      groups.get(sourceKey).push(line);
    });
    let changed = false;
    groups.forEach((lines, sourceKey) => {
      if (lines.length < 2) return;
      const source = timerSourceFromKey(sourceKey);
      if (!source) return;
      const before = source.text();
      const after = Core.reorderLineBlocks(before, lines);
      if (after !== before) { source.apply(after); changed = true; }
    });
    refreshAfterTimerEdit(fallbackTab || current);
    if (changed) toast('顺序已保存');
  }

  /* 每次渲染后绑定本页动态按钮（节点已被替换，不会重复） */
  function bindDynamicEvents() {
    closeTablePicker();
    hydrateFlowFigures($('#view'));
    const b = $('#btn-plan-add');
    if (b) b.addEventListener('click', () => {
      const title = $('#p-title').value.trim();
      if (!title) return toast('先写项目标题');
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
    bindWorkDrag();
    bindPlanDrag();
    bindKeepDrag();
    bindNoteDrag();
    bindTimerDrag();
    const mt = $('#memo-text');
    if (mt && MEMOS[current]) {
      const tab = current;
      mt.addEventListener('input', () => memoOnInput(tab));
      mt.addEventListener('blur', () => {
        flushMemo(tab);
        refreshTimerBoard(tab);
        const s = document.getElementById('memo-state');
        if (s && !memoState[tab].dirty) s.textContent = memoStamp(tab);
      });
      bindRichPaste(mt);
      bindRichKeydown(mt);
      bindRichUndo(mt);
      mt.addEventListener('keyup', rememberMemoSelection);
      mt.addEventListener('mouseup', rememberMemoSelection);
    }
    const toolbar = $('#memo-toolbar');
    if (toolbar && MEMOS[current]) {
      const tab = current;
      bindRichToolbar(toolbar, mt, () => memoOnInput(tab));
    }
    /* 计划底稿 / 周报：和琐事同一套富文本行为，但各自独立保存 */
    if (current === 'month') {
      const docKeys = [MONTH_NOTE_KIND];
      if (activeReportId && reportById(activeReportId)) docKeys.push(REPORT_DOC_PREFIX + activeReportId);
      docKeys.forEach((key) => {
        const spec = richDocSpec(key);
        const ed = spec && document.getElementById(spec.editorId);
        if (!ed) return;
        const toolbarEl = document.getElementById(spec.toolbarId);
        ed.addEventListener('input', () => richDocOnInput(key));
        ed.addEventListener('blur', () => {
          flushRichDoc(key);
          richDocMeta(key);
        });
        bindRichPaste(ed);
        bindRichKeydown(ed);
        bindRichUndo(ed);
        ed.addEventListener('keyup', rememberMemoSelection);
        ed.addEventListener('mouseup', rememberMemoSelection);
        bindRichToolbar(toolbarEl, ed, () => richDocOnInput(key));
      });
      if (reportNaming) {
        requestAnimationFrame(() => {
          const input = $('#report-name');
          if (input) input.focus();
        });
      }
      const nameInput = $('#report-name');
      if (nameInput) {
        nameInput.addEventListener('keydown', (e) => {
          if (e.key === 'Escape') {
            e.preventDefault();
            reportNaming = false;
            render();
          }
        });
      }
    }
    if (current === 'agenda') {
      calendarNearDates(7).forEach((date) => {
        const ed = document.getElementById(dayPaperEditorId(date));
        if (!ed) return;
        ed.addEventListener('input', () => dayPaperOnInput(date, ed));
        ed.addEventListener('blur', () => {
          flushDayPaper(date);
          dayPaperMeta(date);
        });
        bindRichPaste(ed);
        bindRichKeydown(ed);
        bindRichUndo(ed);
        ed.addEventListener('keyup', rememberMemoSelection);
        ed.addEventListener('mouseup', rememberMemoSelection);
        bindRichToolbar(document.getElementById(dayPaperToolbarId(date)), ed, () => dayPaperOnInput(date, ed));
      });
    }
    const autoGrow = (el) => {
      el.style.height = 'auto';
      el.style.height = Math.max(56, el.scrollHeight) + 'px';
    };
    document.querySelectorAll('.ms-text').forEach((ta) => {
      autoGrow(ta);
      ta.addEventListener('input', () => { monthOnInput(ta); autoGrow(ta); });
      ta.addEventListener('blur', () => { flushMonth(); autoGrow(ta); });
    });
    /* 倒计时板：琐事 / 创意页与今日页共用一套操作（打勾 / 改字 / 改日期 / ＋进展 / 删 / 拖动） */
    bindTimerBoard($('#memo-timers'), current);
    bindTimerBoard($('#today-timers'), null);
    const tAdd = $('#memo-timer-add');
    if (tAdd && MEMOS[current]) {
      const tab = current;
      tAdd.addEventListener('click', () => {
        const due = ($('#memo-timer-date') || {}).value;
        if (!/^\d{4}-\d{2}-\d{2}$/.test(due || '')) return toast('先选一个日期');
        const ed = document.getElementById('memo-text');
        const text = ed ? memoEditorPlain(ed) : memoTextNow(tab);
        const line = ed ? memoCaretLine(ed) : Math.max(0, text.split('\n').length - 1);
        applyMemoText(tab, Core.setLineTimer(text, line, due));
        toast('第 ' + (line + 1) + ' 行已加倒计时 · ' + Core.fmtLeft(Core.dayDiff(today(), due)));
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
        '会从云端删掉 ' + ids.length + ' 条完成超过 ' + PURGE_KEEP_DAYS + ' 天的公司任务与项目方向，这台设备和另外两端都会同步消失。打勾历史与打卡记录不受影响。继续？');
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
    const navGroup = e.target.closest('[data-nav-group]');
    if (navGroup) {
      const id = navGroup.dataset.navGroup;
      navGroupOpen = navGroupOpen === id ? '' : id;
      navMoreOpen = false;
      document.querySelectorAll('.nav-group[data-nav-wrap]').forEach((el) => {
        el.classList.toggle('is-open', el.getAttribute('data-nav-wrap') === navGroupOpen);
      });
      const more = document.querySelector('.nav-more');
      if (more) more.classList.remove('is-open');
      const menu = document.querySelector('.nav-more-menu');
      if (menu) menu.classList.add('hidden');
      return;
    }
    const navMore = e.target.closest('[data-nav-more]');
    if (navMore) {
      navMoreOpen = !navMoreOpen;
      navGroupOpen = '';
      document.querySelectorAll('.nav-group[data-nav-wrap]').forEach((el) => el.classList.remove('is-open'));
      const more = document.querySelector('.nav-more');
      if (more) more.classList.toggle('is-open', navMoreOpen);
      const menu = document.querySelector('.nav-more-menu');
      if (menu) menu.classList.toggle('hidden', !navMoreOpen);
      return;
    }
    const tabEl = e.target.closest('.tab[data-tab]');   // 只有顶部 tab 条才切页；别把内容里的 data-* 当切页指令
    if (tabEl) {
      flushMemo();
      flushMonth();
      flushAllRichDocs();
      closeCalendarComposer();
      current = tabEl.dataset.tab;
      navMoreOpen = false;
      navGroupOpen = '';
      if (current !== 'month') reportNaming = false;
      render();
      return;
    }
    const go = e.target.closest('[data-tab-go]');
    if (go) {
      flushMemo();
      flushMonth();
      flushAllRichDocs();
      closeCalendarComposer();
      current = go.dataset.tabGo;
      navMoreOpen = false;
      navGroupOpen = '';
      reportNaming = false;
      render();
      return;
    }
    const noteText = e.target.closest('.note-text');
    if (noteText && !e.target.closest('[data-action]')) { startNoteEdit(noteText); return; }
    const act = e.target.closest('[data-action]');
    if (act) {
      const action = act.dataset.action;
      const id = act.dataset.id;
      const item = id ? byId(id) : null;
      if (action === 'calendar-zoom') {
        calendarZoom = Number(act.dataset.zoom) || 0;
        render();
        return;
      }
      if (action === 'calendar-add') {
        openCalendarComposer(act.dataset.date, act, null);
        return;
      }
      if (action === 'calendar-edit' && item && item.kind === CAL_NOTE_KIND) {
        openCalendarComposer(item.date, act, item);
        return;
      }
      if (action === 'calendar-del' && item && item.kind === CAL_NOTE_KIND) {
        (async () => {
          const ok = await confirmDialog('删除日历记录', '确定删除「' + (item.text || '') + '」？三端会一起删除。');
          if (!ok) return;
          store.deleteTask(item.id);
          toast('日历记录已删除');
        })();
        return;
      }
      if (action === 'day-timer-add') {
        const date = act.dataset.date;
        const due = (document.querySelector('[data-day-timer-date="' + date + '"]') || {}).value;
        if (!/^\d{4}-\d{2}-\d{2}$/.test(due || '')) { toast('先选一个提醒日期'); return; }
        const ed = document.getElementById(dayPaperEditorId(date));
        const text = ed ? memoEditorPlain(ed) : dayPaperTextNow(date);
        const line = ed ? memoCaretLine(ed) : Math.max(0, text.split('\n').length - 1);
        applyDayPaperText(date, Core.setLineTimer(text, line, due));
        toast('已给第 ' + (line + 1) + ' 行加提醒 · ' + Core.fmtLeft(Core.dayDiff(today(), due)));
        return;
      }
      if (action === 'doc-timer-add') {
        const key = act.dataset.docKey;
        if (!richDocSpec(key)) return;
        const input = Array.prototype.slice.call(document.querySelectorAll('[data-doc-timer-date]'))
          .find((el) => el.getAttribute('data-doc-timer-date') === key);
        const due = input && input.value;
        if (!/^\d{4}-\d{2}-\d{2}$/.test(due || '')) { toast('先选一个提醒日期'); return; }
        const spec = richDocSpec(key);
        const ed = document.getElementById(spec.editorId);
        const text = ed ? memoEditorPlain(ed) : richDocTextNow(key);
        const line = ed ? memoCaretLine(ed) : Math.max(0, text.split('\n').length - 1);
        applyRichDocText(key, Core.setLineTimer(text, line, due));
        toast('已给第 ' + (line + 1) + ' 行加提醒 · ' + Core.fmtLeft(Core.dayDiff(today(), due)));
        return;
      }
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
      if (action === 'month-range-edit') {
        flushMonth();
        monthState.rangeEdit = Number(act.dataset.week);
        render();
        /* 第四周贴在页面底部，原生日期选择器会向下弹而被屏幕截断。
         * 等编辑框渲染完成后，把它滚到视口中上部，给选择器留足展开空间。 */
        requestAnimationFrame(() => {
          requestAnimationFrame(() => {
            const el = document.querySelector('[data-ms-editor="' + monthState.rangeEdit + '"]');
            if (!el) return;
            const y = el.getBoundingClientRect().top + window.scrollY -
              Math.max(80, window.innerHeight * 0.18);
            window.scrollTo({ top: Math.max(0, y), behavior: 'smooth' });
          });
        });
        return;
      }
      if (action === 'month-range-cancel') {
        monthState.rangeEdit = null;
        render();
        return;
      }
      if (action === 'month-range-save') {
        saveMonthRange(Number(act.dataset.week));
        return;
      }
      if (action === 'report-new') {
        flushAllRichDocs();
        reportNaming = true;
        render();
        return;
      }
      if (action === 'report-name-cancel') {
        reportNaming = false;
        render();
        return;
      }
      if (action === 'report-select' && item && item.kind === REPORT_KIND) {
        flushAllRichDocs();
        activeReportId = item.id;
        reportNaming = false;
        render();
        return;
      }
      if (action === 'report-delete' && item && item.kind === REPORT_KIND) {
        (async () => {
          const ok = await confirmDialog('删除周报',
            '确定删除「' + (item.title || '未命名周报') + '」？整份周报内容会从三端一起删除。');
          if (!ok) return;
          const key = REPORT_DOC_PREFIX + item.id;
          const st = richDocState(key);
          if (st.timer) clearTimeout(st.timer);
          st.timer = null;
          st.dirty = false;
          st.draft = null;
          st.html = null;
          store.deleteTask(item.id);
          if (activeReportId === item.id) activeReportId = null;
          render();
          toast('周报已删除');
        })();
        return;
      }
    }
    const rs = e.target.closest('[data-restore]');
    if (rs) { restoreSnapshot(rs.getAttribute('data-restore')); return; }
    if (e.target.closest('[data-close]')) closeItemModal();
    if (e.target.closest('[data-note-close]')) closeNote();
  }

  /* ---------- 启动 ---------- */
  Core.KINDS.forEach((k) => {
    /* 备忘录就地写；循环任务只在「循环」页用专用表单新建，避免公司页又冒出旧入口 */
    if (k.id === 'memo' || k.id === 'idea' || k.id === 'fun' || k.id === 'loop') return;
    const o = document.createElement('option');
    o.value = k.id;
    const hint = { work: '今日/明日', plan: '方向+时间范围', habit: '每日/每周', keep: '长期清单' }[k.id];
    o.textContent = k.label + (hint ? '（' + hint + '）' : '');
    $('#f-kind').appendChild(o);
  });
  Core.FREQS.forEach((f) => {
    const o = document.createElement('option');
    o.value = f.id; o.textContent = f.label;
    $('#f-freq').appendChild(o);
  });

  document.addEventListener('click', onViewClick);
  document.addEventListener('selectionchange', () => {
    rememberMemoSelection();
    scheduleFmtBubble();
  });
  /* 星期按钮：点一下切换高亮（值本身由 checkbox 负责） */
  document.addEventListener('change', (e) => {
    const input = e.target;
    if (!input || input.type !== 'checkbox' || !input.closest('.wd-picker')) return;
    const lab = input.closest('.wd');
    if (lab) lab.classList.toggle('on', input.checked);
  });
  /* 卡片底部输入框：回车/点“记下”即写入一条带时间的进展，并刷新到卡片顶部 */
  document.addEventListener('submit', (e) => {
    const reportForm = e.target && e.target.closest ? e.target.closest('#report-new-form') : null;
    if (reportForm) {
      e.preventDefault();
      const input = $('#report-name');
      const title = (input && input.value || '').trim();
      if (!title) {
        toast('先写一个周报名称');
        if (input) input.focus();
        return;
      }
      flushAllRichDocs();
      const it = Core.newItem({ kind: REPORT_KIND, title });
      it.createdAt = new Date().toISOString();
      it.rank = reportItems().length + 1;
      activeReportId = it.id;
      reportNaming = false;
      store.saveTask(it);
      toast('周报已创建');
      return;
    }
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
    if (isNew) revealItem(next.id);          // 新建的条目直接滚到眼前，别让人以为没建上
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
  store.onChange = () => {
    render();
    queueDayRollover();
  };
  /* 切走 / 息屏 / 关页面之前，把备忘录里没落盘的字存下来 */
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') { flushMemo(); flushMonth(); flushAllRichDocs(); }
  });
  /* 跨零点 / 回到前台时，让日历上的「今天」和月份自己走到新的一天 */
  let monthDayStamp = today();
  const refreshMonthIfDayChanged = () => {
    if (today() === monthDayStamp) return;
    monthDayStamp = today();
    flushMemo();
    flushMonth();
    flushAllRichDocs();
    queueDayRollover();
    if (!['month', 'agenda', 'today', 'calendar', 'disc', 'loop'].includes(current)) return;
    monthState.rangeEdit = null;
    render();
  };
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') refreshMonthIfDayChanged();
  });
  setInterval(refreshMonthIfDayChanged, 60000);
  window.addEventListener('pagehide', () => { flushMemo(); flushMonth(); flushAllRichDocs(); });
  bindFmtBubble();
  bindFlowEditor();
  render();
  store.init();
  queueDayRollover();
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('./sw.js').catch(() => {});
  }
})();
