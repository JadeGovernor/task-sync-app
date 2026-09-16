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
  const m = Core.newItem({ kind: 'memo' });
  assert.strictEqual(m.kind, 'memo');
  assert.strictEqual(m.memo, '');
  assert.ok(Core.KINDS.some((x) => x.id === 'memo'));
  assert.strictEqual(Core.kindLabel('memo'), '琐事');
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
  assert.match(r.item.notes[0].time, /^\d{2}:\d{2}$/);              // 进展带时刻
  assert.strictEqual(Core.fmtNoteTime(r.item.notes[0], Core.todayStr()), '今天 ' + r.item.notes[0].time);
  assert.strictEqual(Core.fmtNoteTime({ date: '2026-09-12', time: '08:05' }, '2026-09-13'), '昨天 08:05');
  assert.strictEqual(Core.fmtNoteTime({ date: '2026-09-10' }, '2026-09-13'), '09-10');
  const r2 = Core.addNote(r.item, '   ');
  assert.strictEqual(r2.changed, false);
}

/* 进展：序号顺序 / 拖动排序 / 删除 */
{
  let it = Core.newItem({ kind: 'work', title: 'N' });
  it = Core.addNote(it, '第一条').item;
  it = Core.addNote(it, '第二条').item;
  it = Core.addNote(it, '第三条').item;
  // 默认最新在最上
  assert.deepStrictEqual(Core.orderedNotes(it).map((e) => e.note.text), ['第三条', '第二条', '第一条']);
  // 拖动：把最上面的第三条移到最下 → 顺序 第二/第一/第三
  const order = Core.orderedNotes(it).map((e) => e.index); // [2,1,0]
  const moved = [order[1], order[2], order[0]];
  const r = Core.setNoteOrder(it, moved);
  assert.strictEqual(r.changed, true);
  it = r.item;
  assert.deepStrictEqual(Core.orderedNotes(it).map((e) => e.note.text), ['第二条', '第一条', '第三条']);
  // 相同顺序不重复写
  assert.strictEqual(Core.setNoteOrder(it, Core.orderedNotes(it).map((e) => e.index)).changed, false);
  // 删除“第二条”
  const idxSecond = Core.orderedNotes(it).find((e) => e.note.text === '第二条').index;
  const d = Core.deleteNote(it, idxSecond);
  assert.strictEqual(d.changed, true);
  assert.deepStrictEqual(Core.orderedNotes(d.item).map((e) => e.note.text), ['第一条', '第三条']);
  assert.strictEqual(Core.deleteNote(d.item, 99).changed, false);
}

/* 进展：打勾沉底 / 取消复原 / 修改文字 */
{
  let it = Core.newItem({ kind: 'work', title: 'D' });
  it = Core.addNote(it, '第一条').item;
  it = Core.addNote(it, '第二条').item;
  it = Core.addNote(it, '第三条').item;
  const idxFirst = Core.orderedNotes(it).find((e) => e.note.text === '第一条').index;
  // 打勾 → 划掉沉底
  let r = Core.setNoteDone(it, idxFirst, true);
  assert.strictEqual(r.changed, true);
  it = r.item;
  assert.deepStrictEqual(Core.orderedNotes(it).map((e) => e.note.text), ['第三条', '第二条', '第一条']);
  assert.strictEqual(Core.orderedNotes(it).filter((e) => e.note.done).length, 1);
  assert.ok(it.notes[idxFirst].doneAt);
  // 重复打勾不写
  assert.strictEqual(Core.setNoteDone(it, idxFirst, true).changed, false);
  // 取消打勾 → 回到原来的位置（seq 位置在「第二条」之后）
  r = Core.setNoteDone(it, idxFirst, false);
  assert.strictEqual(r.changed, true);
  it = r.item;
  assert.deepStrictEqual(Core.orderedNotes(it).map((e) => e.note.text), ['第三条', '第二条', '第一条']);
  assert.strictEqual(Core.orderedNotes(it)[2].note.done, false);
  // 越界不写
  assert.strictEqual(Core.setNoteDone(it, 99, true).changed, false);
  // 修改文字：时间与 seq 不动
  const idxSecond = Core.orderedNotes(it).find((e) => e.note.text === '第二条').index;
  const beforeSeq = it.notes[idxSecond].seq, beforeTime = it.notes[idxSecond].time;
  const e1 = Core.editNote(it, idxSecond, '  第二条（改过）  ');
  assert.strictEqual(e1.changed, true);
  assert.strictEqual(e1.item.notes[idxSecond].text, '第二条（改过）');
  assert.strictEqual(e1.item.notes[idxSecond].seq, beforeSeq);
  assert.strictEqual(e1.item.notes[idxSecond].time, beforeTime);
  assert.strictEqual(Core.editNote(e1.item, idxSecond, '第二条（改过）').changed, false);
  assert.strictEqual(Core.editNote(e1.item, idxSecond, '   ').changed, false);
  // 拖拽只传未完成的那几条：已完成自动接在后面
  const openIdx = Core.orderedNotes(e1.item).filter((e) => !e.note.done).map((e) => e.index);
  const moved = openIdx.slice().reverse();
  const o1 = Core.setNoteOrder(e1.item, moved);
  assert.strictEqual(o1.changed, true);
  const after = Core.orderedNotes(o1.item);
  assert.strictEqual(after.length, 3);
  assert.strictEqual(after.filter((e) => e.note.done).length, 0);
  assert.deepStrictEqual(after.map((e) => e.note.text), ['第一条', '第二条（改过）', '第三条']);
  // 部分顺序 / 越界下标都不炸
  assert.strictEqual(Core.setNoteOrder(e1.item, []).changed, false);
  assert.strictEqual(Core.setNoteOrder(e1.item, [99, -1]).item.notes.length, 3);
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

/* 习惯清单：kind=keep + 拖动排序 */
{
  const k = Core.newItem({ kind: 'keep' });
  assert.strictEqual(k.kind, 'keep');
  assert.strictEqual(k.rank, null);
  assert.deepStrictEqual(k.notes, []);
  assert.ok(Core.KINDS.some((x) => x.id === 'keep'));
  assert.strictEqual(Core.kindLabel('keep'), '习惯');

  // 只有 keep 条目参与清单排序，且按 rank 升序
  const mixed = [
    Object.assign(Core.newItem({ kind: 'work', title: '公司活' }), { id: 'w1' }),
    Object.assign(Core.newItem({ kind: 'keep', title: 'B' }), { id: 'k2', rank: 2 }),
    Object.assign(Core.newItem({ kind: 'keep', title: 'A' }), { id: 'k1', rank: 1 }),
    Object.assign(Core.newItem({ kind: 'habit', title: '每日' }), { id: 'h1' })
  ];
  assert.deepStrictEqual(Core.keepOrdered(mixed).map((t) => t.title), ['A', 'B']);

  // 没 rank 的排在最后，不报错
  const noRank = mixed.concat([Object.assign(Core.newItem({ kind: 'keep', title: 'C' }), { id: 'k3', created: '2026-09-01' })]);
  assert.deepStrictEqual(Core.keepOrdered(noRank).map((t) => t.title), ['A', 'B', 'C']);
  assert.deepStrictEqual(Core.keepOrdered([]), []);
  assert.deepStrictEqual(Core.keepOrdered(null), []);

  // 序号撞号（三端各自添加造成）时顺序也必须稳定，不能互相挤走
  const dup = [
    Object.assign(Core.newItem({ kind: 'keep', title: 'A' }), { id: 'k1', rank: 1, created: '2026-09-10' }),
    Object.assign(Core.newItem({ kind: 'keep', title: 'B' }), { id: 'k2', rank: 2, created: '2026-09-10' }),
    Object.assign(Core.newItem({ kind: 'keep', title: 'C' }), { id: 'k3', rank: 2, created: '2026-09-11' }),
    Object.assign(Core.newItem({ kind: 'keep', title: 'D' }), { id: 'k4', rank: 3, created: '2026-09-11' })
  ];
  const once = Core.keepOrdered(dup).map((t) => t.title).join('');
  assert.strictEqual(once, 'ABCD');
  // 反复排序 + 打乱输入，结果必须完全一致（旧比较器会在这里乱跳）
  for (let i = 0; i < 40; i++) {
    const shuffled = dup.slice().sort(() => (i % 2 ? 1 : -1));
    assert.strictEqual(Core.keepOrdered(shuffled).map((t) => t.title).join(''), once);
  }
  // 完全相同的 rank/created 时用 id 兜底，仍有确定顺序
  const tie = [
    Object.assign(Core.newItem({ kind: 'keep', title: 'Y' }), { id: 'k9', rank: 1, created: '2026-09-10' }),
    Object.assign(Core.newItem({ kind: 'keep', title: 'Z' }), { id: 'k8', rank: 1, created: '2026-09-10' })
  ];
  assert.deepStrictEqual(Core.keepOrdered(tie).map((t) => t.title), ['Z', 'Y']);

  // 拖动后写 rank：整条重排成 1..N
  const ranks = {};
  Core.keepOrdered(mixed).map((t) => t.id).reverse().forEach((id, i) => { ranks[id] = i + 1; });
  const r = Core.applyOp('tasks', mixed, { type: 'rank_set', ranks });
  assert.deepStrictEqual(Core.keepOrdered(r.value).map((t) => t.title), ['B', 'A']);
}

/* 琐事备忘录：一整张、只有一条、随便改 */
{
  assert.strictEqual(Core.memoOf([]), null);
  assert.strictEqual(Core.memoOf(null), null);
  assert.strictEqual(Core.memoText(null), '');
  assert.strictEqual(Core.memoText([]), '');

  // 习惯/公司条目不会被当成备忘录
  const noise = [
    Core.newItem({ kind: 'keep', title: '每天读书' }),
    Core.newItem({ kind: 'work', title: '开会' })
  ];
  assert.strictEqual(Core.memoOf(noise), null);
  assert.strictEqual(Core.memoText(noise), '');

  // 新建 → 写入正文 → 再改一次，始终保持一条
  let list = Core.applyOp('tasks', [], {
    type: 'task_set',
    task: Object.assign(Core.newItem({ kind: 'memo' }), { id: 'memo1', memo: '买牛奶\n周三交周报' })
  }).value;
  assert.strictEqual(list.length, 1);
  assert.strictEqual(Core.memoText(list), '买牛奶\n周三交周报');
  assert.strictEqual(Core.memoOf(list).id, 'memo1');

  list = Core.applyOp('tasks', list, {
    type: 'task_set',
    task: Object.assign(Core.memoOf(list), { memo: '买牛奶' })
  }).value;
  assert.strictEqual(list.length, 1);
  assert.strictEqual(Core.memoText(list), '买牛奶');

  // 正文可以清空，条目还在（表头/时间仍在）
  list = Core.applyOp('tasks', list, {
    type: 'task_set',
    task: Object.assign(Core.memoOf(list), { memo: '' })
  }).value;
  assert.strictEqual(Core.memoText(list), '');
  assert.strictEqual(list.length, 1);

  // 备忘录不参与今日聚合，也不会混进习惯清单
  const te = Core.todayEntries(list, [], D);
  assert.strictEqual(te.total, 0);
  assert.deepStrictEqual(Core.keepOrdered(list), []);
}

/* 公司 · 循环任务：到日子进今日、打勾本周消失、下周一自动回来 */
{
  const mon = '2026-09-07', tue = D, sun = '2026-09-13';
  const nextTue = '2026-09-15';
  const l = Core.newItem({ kind: 'loop', title: '交周报' });
  l.weekdays = [2];            // 每周二
  l.created = '2026-09-01';
  assert.deepStrictEqual(l.doneWeeks, []);
  assert.strictEqual(Core.loopLabel(l), '每周 二');

  // 周二当天才进「今日」
  assert.strictEqual(Core.loopOn(l, tue).today, true);
  assert.strictEqual(Core.loopOn(l, mon), null);
  assert.strictEqual(Core.loopOn(l, sun), null);

  const te = Core.todayEntries([l], [], tue);
  assert.strictEqual(te.loops.length, 1);
  assert.strictEqual(te.loops[0].done, false);
  assert.strictEqual(te.total, 1);
  assert.strictEqual(te.done, 0);
  assert.strictEqual(Core.todayEntries([l], [], mon).total, 0);

  // 打勾 = 本周完成（本周一为 key），下周一自动重置
  const r1 = Core.setLoopDone(l, tue, true);
  assert.strictEqual(r1.changed, true);
  assert.deepStrictEqual(r1.item.doneWeeks, [Core.weekKey(tue)]);
  assert.strictEqual(Core.loopState(r1.item, tue).done, true);
  assert.strictEqual(Core.setLoopDone(r1.item, tue, true).changed, false);

  const te2 = Core.todayEntries([r1.item], [], tue);
  assert.strictEqual(te2.loops.length, 1);
  assert.strictEqual(te2.loops[0].done, true);
  assert.strictEqual(te2.done, 1);

  // 同一周内的另一个循环日子：已勾过就本周不再出现提醒语义（done 仍为 true）
  assert.strictEqual(Core.loopState(r1.item, '2026-09-09').done, true);

  // 下一周的同一天：重新出现且未完成
  assert.strictEqual(Core.loopOn(r1.item, nextTue).done, false);
  const r2 = Core.setLoopDone(r1.item, nextTue, false);
  assert.strictEqual(r2.changed, false);

  // 取消打勾 → 回到未完成
  const r3 = Core.setLoopDone(r1.item, tue, false);
  assert.strictEqual(r3.changed, true);
  assert.deepStrictEqual(r3.item.doneWeeks, []);

  // 周日用 0 表示；周内已过的日子标记 missed
  const sunItem = Object.assign(Core.newItem({ kind: 'loop', title: '周复盘' }), { weekdays: [0], created: '2026-09-01' });
  assert.strictEqual(Core.loopOn(sunItem, sun).today, true);
  assert.strictEqual(Core.loopState(sunItem, '2026-09-10').missed, false); // 周四，还没到周日
  assert.strictEqual(Core.loopState(sunItem, '2026-09-14').missed, false); // 新的一周周一，本周日还没到
  const monItem = Object.assign(Core.newItem({ kind: 'loop', title: '周一例会' }), { weekdays: [1], created: '2026-09-01' });
  assert.strictEqual(Core.loopState(monItem, '2026-09-07').missed, false); // 周一当天：还没过
  assert.strictEqual(Core.loopState(monItem, '2026-09-09').missed, true);  // 周三：本周一已过还没勾

  // 创建当天之前的日期不提醒；没选星期不算
  const fresh = Object.assign(Core.newItem({ kind: 'loop', title: '新循环' }), { weekdays: [2], created: tue });
  assert.strictEqual(Core.loopOn(fresh, mon), null);
  const noWd = Object.assign(Core.newItem({ kind: 'loop', title: '没选星期' }), { weekdays: [] });
  assert.strictEqual(Core.loopState(noWd, tue), null);

  // 每天都做
  assert.strictEqual(Core.loopLabel(Object.assign(Core.newItem({ kind: 'loop' }), { weekdays: [0, 1, 2, 3, 4, 5, 6] })), '每天');
  assert.strictEqual(Core.loopLabel(Object.assign(Core.newItem({ kind: 'loop' }), { weekdays: [1, 3, 5] })), '每周 一·三·五');

  // 不跟公司/自律互相污染
  const te3 = Core.todayEntries([sunItem, l], [], mon);
  assert.strictEqual(te3.total, 0);
}

console.log('✅ core.test.js（V2）全部通过');
