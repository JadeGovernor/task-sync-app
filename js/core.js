/* V2 纯逻辑层：公司(今日/明日+自动顺延)、计划(时间范围+排序+紧急)、自律(每日/每周)、备注流水。
 * 不碰 DOM；与 Node 测试共用。 */
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
  const dayDiff = (a, b) => Math.round((parseDate(b) - parseDate(a)) / 86400000);
  const weekdayCN = (s) => ['周日', '周一', '周二', '周三', '周四', '周五', '周六'][parseDate(s).getDay()];
  const fmtCN = (s) => {
    const d = parseDate(s);
    return (d.getMonth() + 1) + '月' + d.getDate() + '日 ' + weekdayCN(s);
  };
  const uid = (p) => (p || 't') + '_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8);

  /* 三种大条目：公司任务 / 计划方向 / 自律习惯 */
  const KINDS = [
    { id: 'work', label: '公司' },
    { id: 'plan', label: '计划' },
    { id: 'habit', label: '自律' }
  ];
  const FREQS = [
    { id: 'daily', label: '每日习惯（每天都要勾）' },
    { id: 'weekly', label: '每周习惯（本周勾一次）' }
  ];
  const kindLabel = (id) => (KINDS.find((k) => k.id === id) || { label: id }).label;
  const freqLabel = (id) => (FREQS.find((f) => f.id === id) || { label: id }).label;

  function newItem(partial) {
    const base = {
      id: uid('t'),
      kind: 'work',
      title: '',
      created: todayStr(),
      notes: [],        // 进展备注流水：[{ date: 'YYYY-MM-DD', text }]
      updatedAt: new Date().toISOString()
    };
    if (partial && partial.kind === 'plan') {
      base.rangeStart = null;
      base.rangeEnd = null;
      base.done = false;   // 手动完成（也可留空让其随时间归档）
      base.doneDate = null;
    } else if (partial && partial.kind === 'work') {
      base.due = todayStr();
      base.done = false;
      base.doneDate = null;
    } else if (partial && partial.kind === 'habit') {
      base.freq = 'daily';      // daily | weekly
      base.weeksDone = [];      // weekly：已完成的周（周一日期）
    }
    return Object.assign(base, partial || {});
  }

  function fileDefault(file) {
    if (file === 'tasks') return [];
    if (file === 'checkins') return [];
    return { v: 1, devices: {} };
  }

  /* ---------- 通用：备注流水 ---------- */
  function addNote(item, text) {
    const t = (text || '').trim();
    if (!t) return { item, changed: false };
    const next = JSON.parse(JSON.stringify(item));
    if (!Array.isArray(next.notes)) next.notes = [];
    next.notes.push({ date: todayStr(), text: t });
    next.updatedAt = new Date().toISOString();
    return { item: next, changed: true };
  }

  /* ---------- 文件级合并操作（离线队列与远程合并共用） ---------- */
  function upsertItem(items, item) {
    const list = items.slice();
    const i = list.findIndex((t) => t.id === item.id);
    if (i >= 0) {
      const same = JSON.stringify(list[i]) === JSON.stringify(item);
      if (!same) list[i] = item;
      return { list, changed: !same };
    }
    list.push(item);
    return { list, changed: true };
  }
  function removeItem(items, id) {
    const list = items.filter((t) => t.id !== id);
    return { list, changed: list.length !== items.length };
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
        const r = upsertItem(value, op.task);
        return { value: r.list, changed: r.changed };
      }
      if (op.type === 'task_delete') {
        const r = removeItem(value, op.id);
        return { value: r.list, changed: r.changed };
      }
      if (op.type === 'rank_set') {
        const map = op.ranks || {};
        let changed = false;
        const list = value.map((it) => {
          if (it && map[it.id] != null && (it.rank || 0) !== map[it.id]) {
            changed = true;
            return Object.assign({}, it, { rank: map[it.id] });
          }
          return it;
        });
        return { value: list, changed };
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

  /* ---------- 打勾状态 ---------- */
  function doneIdsFor(checkins, date) {
    const rec = (checkins || []).find((c) => c.date === date);
    return rec ? rec.done || [] : [];
  }
  function checkedOn(id, checkins, date) {
    return doneIdsFor(checkins, date).indexOf(id) >= 0;
  }

  /* 每周习惯的自然周 key（周一起算），key = 该周周一的日期 */
  function weekKey(s) {
    const d = parseDate(s);
    d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); // 回到本周周一
    return dateStr(d);
  }
  const weeklyDoneOn = (item, date) =>
    Array.isArray(item.weeksDone) && item.weeksDone.indexOf(weekKey(date)) >= 0;

  /* 每日习惯某天是否应勾：创建当天起每天都要勾 */
  const dailyScheduledOn = (item, date) =>
    item.kind === 'habit' && item.freq === 'daily' &&
    (!item.created || item.created <= date);

  function habitOn(item, date, checkins) {
    if (item.kind !== 'habit') return null;
    if (item.freq === 'daily') {
      if (!dailyScheduledOn(item, date)) return null;
      return { kind: 'daily', done: checkedOn(item.id, checkins, date) };
    }
    const wk = weekKey(date);
    if (item.created && weekKey(item.created) > wk) return null; // 还没到创建那一周
    return { kind: 'weekly', done: weeklyDoneOn(item, date), week: wk };
  }

  /* ---------- 公司：分桶 ---------- */
  function workStatus(item, date) {
    if (item.kind !== 'work') return null;
    if (item.done) return { bucket: 'done', done: true, doneDate: item.doneDate || null };
    const due = item.due || date; // 没设日期视作今天到期（创建时默认会带上）
    if (due < date) return { bucket: 'today', overdue: true, due };
    if (due === date) return { bucket: 'today', due };
    if (due === shiftDate(date, 1)) return { bucket: 'tomorrow', due };
    return { bucket: 'later', due };
  }

  /* ---------- 计划：紧急 / 归档 / 排序 ---------- */
  function planState(item, date) {
    if (item.kind !== 'plan') return null;
    if (item.done) return { bucket: 'done', urgent: false, doneDate: item.doneDate || null };
    const end = item.rangeEnd;
    const started = !item.rangeStart || item.rangeStart <= date;
    const past = !!end && end < date;                    // 时间范围已过 → 归档
    const active = started && !past;
    let urgent = false;
    if (active && end) {
      const left = dayDiff(date, end);                   // 剩余天数
      urgent = left >= 0 && left <= 10;
    }
    return { bucket: past ? 'archived' : 'active', active, urgent, rangeEnd: end || null };
  }

  /* ---------- 今日聚合（今日首页） ---------- */
  function todayEntries(items, checkins, date) {
    const work = [];
    const habits = [];
    (items || []).forEach((t) => {
      if (t.kind === 'work') {
        const w = workStatus(t, date);
        if (w && w.bucket === 'today') work.push({ item: t, done: false, overdue: !!w.overdue });
        else if (w && w.bucket === 'done' && w.doneDate === date && (t.due || date) <= date) {
          work.push({ item: t, done: true, overdue: false }); // 今天刚做完的
        }
      } else if (t.kind === 'habit' && t.freq === 'daily') {
        const h = habitOn(t, date, checkins);
        if (h) {
          const yd = shiftDate(date, -1);
          const missed = dailyScheduledOn(t, yd) && !checkedOn(t.id, checkins, yd);
          habits.push({ item: t, done: h.done, missed });
        }
      }
    });
    // 逾期自动顺延到今天，红字标记
    work.sort((a, b) => (a.overdue === b.overdue ? 0 : a.overdue ? -1 : 1));
    const total = work.length + habits.length;
    const done = work.filter((e) => e.done).length + habits.filter((e) => e.done).length;
    return { work, habits, total, done, streak: streakDays(items, checkins, date) };
  }

  /* 每日习惯的连续达标天数（不含公司/计划；某天没习惯视为达标，有未勾即断） */
  function streakDays(items, checkins, date) {
    const dailies = (items || []).filter((t) => t.kind === 'habit' && t.freq === 'daily');
    if (!dailies.length) return 0;
    const floors = dailies.map((t) => t.created).filter(Boolean);
    const floor = floors.sort()[0];
    const ok = (d) => {
      const list = dailies.filter((t) => dailyScheduledOn(t, d));
      if (!list.length) return true;
      return list.every((t) => checkedOn(t.id, checkins, d));
    };
    let cursor = ok(date) ? date : shiftDate(date, -1);
    let n = 0;
    while (cursor >= floor && ok(cursor) && n < 10000) {
      n++;
      cursor = shiftDate(cursor, -1);
    }
    return n;
  }

  const api = {
    pad, dateStr, todayStr, parseDate, shiftDate, dayDiff, weekdayCN, fmtCN, uid,
    KINDS, FREQS, kindLabel, freqLabel, newItem,
    fileDefault, addNote, upsertItem, removeItem,
    setCheckinDate, upsertDevice, applyOp,
    doneIdsFor, checkedOn, weekKey, weeklyDoneOn, dailyScheduledOn, habitOn,
    workStatus, planState, todayEntries, streakDays
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else global.Core = api;
})(typeof window !== 'undefined' ? window : globalThis);
