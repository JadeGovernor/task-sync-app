/* 纯逻辑层：任务/打卡/连续天数/离线合并，浏览器与 Node 测试共用 */
(function (global) {
  'use strict';

  const pad = (n) => (n < 10 ? '0' + n : '' + n);
  const dateStr = (d) => d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
  const todayStr = () => dateStr(new Date());
  const parseDate = (s) => {
    const [y, m, d] = String(s).split('-').map(Number);
    return new Date(y, m - 1, d);
  };
  const shiftDate = (s, n) => {
    const d = parseDate(s);
    d.setDate(d.getDate() + n);
    return dateStr(d);
  };
  const weekdayCN = (s) => ['周日', '周一', '周二', '周三', '周四', '周五', '周六'][parseDate(s).getDay()];
  const fmtCN = (s) => {
    const d = parseDate(s);
    return (d.getMonth() + 1) + '月' + d.getDate() + '日 ' + weekdayCN(s);
  };
  const uid = (p) => (p || 't') + '_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8);

  const MODULES = [
    { id: 'life', label: '生活' },
    { id: 'work', label: '公司' },
    { id: 'plan', label: '计划' }
  ];
  const REPEATS = [
    { id: 'once', label: '一次性' },
    { id: 'daily', label: '每天' },
    { id: 'weekday', label: '工作日' },
    { id: 'weekly', label: '每周(按截止日)' }
  ];
  const moduleLabel = (id) => (MODULES.find((m) => m.id === id) || { label: id }).label;
  const repeatLabel = (id) => (REPEATS.find((r) => r.id === id) || { label: id }).label;

  function newTask(partial) {
    return Object.assign({
      id: uid('t'),
      title: '',
      module: 'life',
      due: null,          // YYYY-MM-DD，可空
      repeat: 'once',     // once | daily | weekday | weekly
      note: '',
      created: todayStr(),
      done: false,        // 一次性任务做完后为 true
      doneDate: null,     // 一次性任务完成日期
      updatedAt: new Date().toISOString()
    }, partial || {});
  }

  function fileDefault(file) {
    if (file === 'tasks') return [];
    if (file === 'checkins') return [];
    return { v: 1, devices: {} };
  }

  /* ---------- 文件级合并操作（离线队列与远程合并共用） ---------- */
  function upsertTask(tasks, task) {
    const list = tasks.slice();
    const i = list.findIndex((t) => t.id === task.id);
    if (i >= 0) {
      const same = JSON.stringify(list[i]) === JSON.stringify(task);
      if (!same) list[i] = task;
      return { list, changed: !same };
    }
    list.push(task);
    return { list, changed: true };
  }

  function removeTask(tasks, id) {
    const list = tasks.filter((t) => t.id !== id);
    return { list, changed: list.length !== tasks.length };
  }

  function setCheckinDate(checkins, date, doneIds) {
    const ids = (doneIds || []).slice().sort();
    const prev = checkins.find((c) => c.date === date);
    if (prev && JSON.stringify(prev.done || []) === JSON.stringify(ids)) {
      return { list: checkins, changed: false };
    }
    const list = checkins.filter((c) => c.date !== date);
    if (ids.length) list.push({ date, done: ids });
    list.sort((a, b) => (a.date < b.date ? -1 : 1));
    return { list, changed: true };
  }

  function upsertDevice(settings, deviceId, patch) {
    const next = JSON.parse(JSON.stringify(settings));
    if (!next.devices) next.devices = {};
    const dev = Object.assign({}, next.devices[deviceId], patch);
    const same = next.devices[deviceId] && JSON.stringify(next.devices[deviceId]) === JSON.stringify(dev);
    if (same) return { obj: settings, changed: false };
    next.devices[deviceId] = dev;
    return { obj: next, changed: true };
  }

  function applyOp(file, value, op) {
    if (file === 'tasks') {
      if (op.type === 'task_set') {
        const r = upsertTask(value, op.task);
        return { value: r.list, changed: r.changed };
      }
      if (op.type === 'task_delete') {
        const r = removeTask(value, op.id);
        return { value: r.list, changed: r.changed };
      }
    }
    if (file === 'checkins' && op.type === 'checkin_set') {
      const r = setCheckinDate(value, op.date, op.ids);
      return { value: r.list, changed: r.changed };
    }
    if (file === 'settings' && op.type === 'settings_patch') {
      const r = upsertDevice(value, op.deviceId, op.patch);
      return { value: r.obj, changed: r.changed };
    }
    return { value, changed: false };
  }

  /* ---------- 任务在指定日期是否应做 / 已做 ---------- */
  const dayOfWeek = (s) => parseDate(s).getDay();

  function scheduledOn(task, date) {
    if (!task || !date) return false;
    if (task.repeat === 'once') return task.due === date;
    if (task.created && task.created > date) return false; // 不追溯创建之前的日子
    const dow = dayOfWeek(date);
    if (task.repeat === 'daily') return true;
    if (task.repeat === 'weekday') return dow >= 1 && dow <= 5;
    if (task.repeat === 'weekly') {
      const anchor = task.due || task.created;
      return !!anchor && dayOfWeek(anchor) === dow;
    }
    return false;
  }

  function doneIdsFor(checkins, date) {
    const rec = (checkins || []).find((c) => c.date === date);
    return rec ? rec.done || [] : [];
  }

  function isDoneOn(task, date, checkins) {
    return doneIdsFor(checkins, date).indexOf(task.id) >= 0;
  }

  /* 逾期未完成的一次性任务 */
  function overdueOnce(tasks, date) {
    return (tasks || []).filter((t) =>
      t.repeat === 'once' && !t.done && t.due && t.due < date &&
      (!t.created || t.created <= date)
    );
  }

  /* 某天应做列表：scheduled = 当天安排(含已完成)，overdue = 逾期未做 */
  function dayEntries(tasks, checkins, date) {
    const scheduled = (tasks || [])
      .filter((t) => scheduledOn(t, date))
      .map((t) => ({ task: t, done: isDoneOn(t, date, checkins) }));
    return { scheduled, overdue: overdueOnce(tasks, date) };
  }

  function dayStats(tasks, checkins, date) {
    const { scheduled } = dayEntries(tasks, checkins, date);
    const done = scheduled.filter((e) => e.done).length;
    return { total: scheduled.length, done };
  }

  /* 连续达标天数：某天 total=0 视为达标；今天没做完不打断 streak，从昨天开始计 */
  function streakDays(tasks, checkins, date) {
    const ok = (d) => {
      const s = dayStats(tasks, checkins, d);
      return s.total === 0 || s.done >= s.total;
    };
    // 无任务时所有日子都“达标”，必须设起点下限，否则会死循环到世界末日
    const floors = (tasks || []).map((t) => t.created || t.due).filter(Boolean);
    if (!floors.length) return 0;
    const floor = floors.sort()[0];
    let cursor = ok(date) ? date : shiftDate(date, -1);
    let n = 0;
    while (cursor >= floor && ok(cursor) && n < 10000) {
      n++;
      cursor = shiftDate(cursor, -1);
    }
    return n;
  }

  const api = {
    pad, dateStr, todayStr, parseDate, shiftDate, weekdayCN, fmtCN, uid,
    MODULES, REPEATS, moduleLabel, repeatLabel, newTask,
    fileDefault, upsertTask, removeTask, setCheckinDate, upsertDevice, applyOp,
    scheduledOn, doneIdsFor, isDoneOn, overdueOnce, dayEntries, dayStats, streakDays
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else global.Core = api;
})(typeof window !== 'undefined' ? window : globalThis);
