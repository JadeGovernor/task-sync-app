/* V2 核心逻辑冒烟测试：node tests/core.test.js */
'use strict';
const assert = require('assert');
const Core = require('../js/core.js');

const D = '2026-09-08'; // 周二

/* 新建默认 */
{
  const w = Core.newItem({ kind: 'work' });
  assert.strictEqual(w.kind, 'work');
  assert.strictEqual(w.due, Core.todayStr());
  assert.strictEqual(w.done, false);
  const p = Core.newItem({ kind: 'plan' });
  assert.strictEqual(p.kind, 'plan');
  assert.strictEqual(p.done, false);
  const h = Core.newItem({ kind: 'habit' });
  assert.strictEqual(h.kind, 'habit');
  assert.strictEqual(h.freq, 'daily');
  assert.deepStrictEqual(h.weeksDone, []);
}

/* 公司分桶：今日 / 明日 / 更晚 / 逾期顺延 / 完成 */
{
  const todayItem = Object.assign(Core.newItem({ kind: 'work', title: '今天交' }), { due: D });
  const yestItem = Object.assign(Core.newItem({ kind: 'work', title: '昨天没做' }), { due: '2026-09-07' });
  const tmwItem = Object.assign(Core.newItem({ kind: 'work', title: '明天做' }), { due: '2026-09-09' });
  const lateItem = Object.assign(Core.newItem({ kind: 'work', title: '更晚' }), { due: '2026-09-20' });
  const doneItem = Object.assign(Core.newItem({ kind: 'work', title: '完成' }), { due: '2026-09-07', done: true, doneDate: '2026-09-07' });
  assert.deepStrictEqual(Core.workStatus(todayItem, D), { bucket: 'today', due: D });
  assert.deepStrictEqual(Core.workStatus(yestItem, D).bucket, 'today');
  assert.strictEqual(Core.workStatus(yestItem, D).overdue, true);
  assert.strictEqual(Core.workStatus(tmwItem, D).bucket, 'tomorrow');
  assert.strictEqual(Core.workStatus(lateItem, D).bucket, 'later');
  assert.strictEqual(Core.workStatus(doneItem, D).bucket, 'done');
}

/* 每周习惯：周一起算的自然周 */
{
  assert.strictEqual(Core.weekKey('2026-09-08'), '2026-09-07'); // 周二
  assert.strictEqual(Core.weekKey('2026-09-13'), '2026-09-07'); // 周日仍属上周
  assert.strictEqual(Core.weekKey('2026-09-14'), '2026-09-14'); // 周一开新周
  const wk = Object.assign(Core.newItem({ kind: 'habit' }), { freq: 'weekly', weeksDone: ['2026-09-07'] });
  assert.strictEqual(Core.weeklyDoneOn(wk, '2026-09-08'), true);
  assert.strictEqual(Core.weeklyDoneOn(wk, '2026-09-14'), false);
}

/* 每日习惯与 checkins */
{
  const h = Object.assign(Core.newItem({ kind: 'habit', title: '晨跑' }), { created: '2026-09-01' });
  let ch = [];
  assert.strictEqual(Core.dailyScheduledOn(h, D), true);
  assert.strictEqual(Core.habitOn(h, D, ch).done, false);
  const r = Core.setCheckinDate(ch, D, [h.id]);
  ch = r.list;
  assert.strictEqual(Core.checkedOn(h.id, ch, D), true);
  assert.strictEqual(Core.habitOn(h, D, ch).done, true);
  // 今天创建的习惯昨天不应被要求
  const h2 = Object.assign(Core.newItem({ kind: 'habit', title: '新习惯' }), { created: D });
  assert.strictEqual(Core.dailyScheduledOn(h2, '2026-09-07'), false);
}

/* 今日聚合：公司逾期顺延 + 每日习惯昨日未打勾标红 */
{
  const work = Object.assign(Core.newItem({ kind: 'work', title: '迟交' }), { due: '2026-09-07' });
  const habit = Object.assign(Core.newItem({ kind: 'habit', title: '喝水' }), { created: '2026-09-07' });
  const ch = []; // 昨天没打勾
  const te = Core.todayEntries([work, habit], ch, D);
  assert.strictEqual(te.work.length, 1);
  assert.strictEqual(te.work[0].overdue, true);
  assert.strictEqual(te.habits.length, 1);
  assert.strictEqual(te.habits[0].missed, true); // 昨日未打勾 → 今日红字
  assert.strictEqual(te.total, 2);
  // 补勾今天的习惯
  const r = Core.setCheckinDate(ch, D, [habit.id]);
  const te2 = Core.todayEntries([work, habit], r.list, D);
  assert.strictEqual(te2.habits[0].done, true);
  assert.strictEqual(te2.habits[0].missed, true); // 昨日仍缺失，仅提示
  assert.strictEqual(te2.done, 1);
}

/* 计划：紧急(最后10天) / 正常 / 归档 / 完成 */
{
  const urgent = Object.assign(Core.newItem({ kind: 'plan', title: '冲刺' }), { rangeStart: '2026-09-01', rangeEnd: '2026-09-10' });
  const ok10 = Object.assign(Core.newItem({ kind: 'plan', title: '恰好十天' }), { rangeEnd: '2026-09-18' });
  const normal = Object.assign(Core.newItem({ kind: 'plan', title: '远计划' }), { rangeEnd: '2027-01-01' });
  const past = Object.assign(Core.newItem({ kind: 'plan', title: '已过期' }), { rangeEnd: '2026-09-05' });
  const fin = Object.assign(Core.newItem({ kind: 'plan', title: '做完' }), { rangeEnd: '2026-09-20', done: true, doneDate: '2026-09-08' });
  assert.strictEqual(Core.planState(urgent, D).urgent, true);
  assert.strictEqual(Core.planState(ok10, D).urgent, true);
  assert.strictEqual(Core.planState(normal, D).urgent, false);
  assert.strictEqual(Core.planState(past, D).bucket, 'archived');
  assert.strictEqual(Core.planState(fin, D).bucket, 'done');
}

/* 连续达标（每日习惯；空列表不死循环；破卡即停） */
{
  assert.strictEqual(Core.streakDays([], [], D), 0);
  const a = Object.assign(Core.newItem({ kind: 'habit', title: 'A' }), { created: '2026-09-01' });
  const b = Object.assign(Core.newItem({ kind: 'habit', title: 'B' }), { created: '2026-09-01' });
  // 只有 A 做了昨天和今天
  const ch1 = [{ date: '2026-09-07', done: [a.id] }, { date: '2026-09-08', done: [a.id] }];
  assert.strictEqual(Core.streakDays([a, b], ch1, D), 0); // B 昨天没做，断
  const ch2 = [{ date: '2026-09-07', done: [a.id, b.id] }, { date: '2026-09-08', done: [a.id, b.id] }];
  assert.strictEqual(Core.streakDays([a, b], ch2, D), 2);
}

/* 备注流水 */
{
  const w = Core.newItem({ kind: 'work', title: 'X' });
  let r = Core.addNote(w, '  联系了供应商  ');
  assert.strictEqual(r.changed, true);
  assert.strictEqual(r.item.notes.length, 1);
  assert.strictEqual(r.item.notes[0].text, '联系了供应商');
  const r2 = Core.addNote(r.item, '   ');
  assert.strictEqual(r2.changed, false);
}

/* 文件操作：task_set / rank_set / 幂等 */
{
  let list = [];
  const w = Object.assign(Core.newItem({ kind: 'work', title: 't1' }), { id: 'w1' });
  let r = Core.applyOp('tasks', list, { type: 'task_set', task: w });
  assert.strictEqual(r.changed, true);
  list = r.value;
  assert.strictEqual(list.length, 1);
  // rank_set：给 w1 排第 2
  r = Core.applyOp('tasks', list, { type: 'rank_set', ranks: { w1: 2 } });
  assert.strictEqual(r.changed, true);
  assert.strictEqual(r.value[0].rank, 2);
  r = Core.applyOp('tasks', r.value, { type: 'rank_set', ranks: { w1: 2 } });
  assert.strictEqual(r.changed, false); // 相同排名不重复写
  r = Core.applyOp('tasks', list, { type: 'task_delete', id: 'w1' });
  assert.strictEqual(r.value.length, 0);
}

console.log('✅ core.test.js（V2）全部通过');
