/* 核心逻辑冒烟测试：node tests/core.test.js */
'use strict';
const assert = require('assert');
const Core = require('../js/core.js');

const t = (o) => Object.assign(Core.newTask({ due: '2026-09-07' }), o);

/* 一次性任务：到期日当天应做 */
{
  const a = t({ id: 'once1', title: '交报告', repeat: 'once', due: '2026-09-07' });
  assert.strictEqual(Core.scheduledOn(a, '2026-09-07'), true);
  assert.strictEqual(Core.scheduledOn(a, '2026-09-08'), false);
}

/* 每天 / 工作日 / 每周 */
{
  const daily = t({ id: 'd1', title: '晨跑', repeat: 'daily', created: '2026-09-01' });
  assert.strictEqual(Core.scheduledOn(daily, '2026-09-07'), true); // 周一
  const wd = t({ id: 'wd1', title: '上班', repeat: 'weekday', created: '2026-09-01' });
  assert.strictEqual(Core.scheduledOn(wd, '2026-09-07'), true); // 周一
  assert.strictEqual(Core.scheduledOn(wd, '2026-09-06'), false); // 周日
  const wk = t({ id: 'wk1', title: '周会', repeat: 'weekly', due: '2026-09-01', created: '2026-08-25' }); // 周二
  assert.strictEqual(Core.scheduledOn(wk, '2026-09-08'), true); // 周二
  assert.strictEqual(Core.scheduledOn(wk, '2026-09-07'), false); // 周一
  // 创建之前的日子不追溯
  const late = t({ id: 'late1', title: '新加的每日', repeat: 'daily', created: '2026-09-05' });
  assert.strictEqual(Core.scheduledOn(late, '2026-09-04'), false);
}

/* 打勾与统计 */
{
  const a = t({ id: 'x1', title: 'A', repeat: 'once', due: '2026-09-07' });
  const b = t({ id: 'x2', title: 'B', repeat: 'once', due: '2026-09-07' });
  const c = t({ id: 'x3', title: 'C', repeat: 'daily', created: '2026-09-01' });
  let checkins = [];
  let r = Core.setCheckinDate(checkins, '2026-09-07', ['x1', 'x3']);
  checkins = r.list;
  assert.deepStrictEqual(Core.doneIdsFor(checkins, '2026-09-07'), ['x1', 'x3']);
  assert.strictEqual(Core.isDoneOn(a, '2026-09-07', checkins), true);
  const st = Core.dayStats([a, b, c], checkins, '2026-09-07');
  assert.deepStrictEqual({ total: st.total, done: st.done }, { total: 3, done: 2 });
  // 取消勾选
  r = Core.setCheckinDate(checkins, '2026-09-07', ['x3']);
  checkins = r.list;
  assert.strictEqual(Core.isDoneOn(a, '2026-09-07', checkins), false);
}

/* 文件级操作（离线/远端共用） */
{
  const tasks = [];
  let r = Core.applyOp('tasks', tasks, { type: 'task_set', task: t({ id: 'n1', title: '新任务' }) });
  assert.strictEqual(r.changed, true);
  r = Core.applyOp('tasks', r.value, { type: 'task_set', task: t({ id: 'n1', title: '改名' }) });
  assert.strictEqual(r.changed, true);
  assert.strictEqual(r.value[0].title, '改名');
  r = Core.applyOp('tasks', r.value, { type: 'task_delete', id: 'n1' });
  assert.strictEqual(r.changed, true);
  assert.strictEqual(r.value.length, 0);

  let ch = [];
  let s = Core.applyOp('checkins', ch, { type: 'checkin_set', date: '2026-09-07', ids: ['a'] });
  ch = s.value;
  s = Core.applyOp('checkins', ch, { type: 'checkin_set', date: '2026-09-07', ids: ['a'] });
  assert.strictEqual(s.changed, false); // 相同效果不重复写

  let settings = Core.fileDefault('settings');
  let p = Core.applyOp('settings', settings, { type: 'settings_patch', deviceId: 'dev1', patch: { wakeTime: '06:30' } });
  assert.strictEqual(p.changed, true);
  p = Core.applyOp('settings', p.value, { type: 'settings_patch', deviceId: 'dev1', patch: { wakeTime: '06:30' } });
  assert.strictEqual(p.changed, false);
}

/* 连续达标天数 */
{
  const a = t({ id: 's1', title: 'A', repeat: 'daily', created: '2026-09-01' });
  const tasks = [a];
  const makeCheckins = (daysDone) => {
    const ch = [];
    daysDone.forEach((d) => { ch.push({ date: d, done: ['s1'] }); });
    return ch;
  };
  // 8 号没做但 7、6 做了：今天(8)未达标 → streak 从昨天数 = 2
  const ch1 = makeCheckins(['2026-09-06', '2026-09-07']);
  assert.strictEqual(Core.streakDays(tasks, ch1, '2026-09-08'), 2);
  // 今天也做了 → 3
  const ch2 = makeCheckins(['2026-09-06', '2026-09-07', '2026-09-08']);
  assert.strictEqual(Core.streakDays(tasks, ch2, '2026-09-08'), 3);
  // 全没做 → 0
  assert.strictEqual(Core.streakDays(tasks, [], '2026-09-08'), 0);
  // 空任务列表：任何一天都算“达标”，必须返回 0 而不是死循环
  assert.strictEqual(Core.streakDays([], [], '2026-09-08'), 0);
  // streak 不早于最早任务的创建日
  const todayOnly = t({ id: 's2', title: '今天开始每天', repeat: 'daily', created: '2026-09-08' });
  const ch3 = [{ date: '2026-09-08', done: ['s2'] }];
  assert.strictEqual(Core.streakDays([todayOnly], ch3, '2026-09-08'), 1);
}

console.log('✅ core.test.js 全部通过');
