/* V2 纯逻辑层：公司(今日/明日+自动顺延)、计划(时间范围+排序+紧急)、自律(每日/每周)、
 * 习惯清单、琐事备忘录、备注流水。
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

  /* 六种大条目：公司任务 / 计划方向 / 自律习惯 / 习惯清单 / 琐事备忘录 / 创意备忘录 */
  const KINDS = [
    { id: 'work', label: '公司' },
    { id: 'loop', label: '循环任务' },
    { id: 'plan', label: '计划' },
    { id: 'habit', label: '自律' },
    { id: 'keep', label: '习惯' },
    { id: 'memo', label: '琐事' },
    { id: 'idea', label: '创意' }
  ];
  const FREQS = [
    { id: 'daily', label: '每日习惯（每天都要勾）' },
    { id: 'weekly', label: '每周习惯（本周勾一次）' }
  ];
  /* 循环任务用：0=周日 … 6=周六，与 Date.getDay() 一致 */
  const WEEKDAY_LABELS = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
  const WEEKDAY_SHORT = ['日', '一', '二', '三', '四', '五', '六'];
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
    } else if (partial && partial.kind === 'loop') {
      base.weekdays = [];     // 每周哪几天要做（0=周日…6=周六）
      base.doneWeeks = [];    // 已完成的自然周（存该周周一日期），下周一自动重新出现
    } else if (partial && partial.kind === 'habit') {
      base.freq = 'daily';      // daily | weekly
      base.weeksDone = [];      // weekly：已完成的周（周一日期）
    } else if (partial && partial.kind === 'keep') {
      base.rank = null;         // 习惯清单里的先后顺序，拖动时写入
    } else if (partial && partial.kind === 'memo') {
      base.title = '琐事';
      base.memo = '';           // 一整张备忘录的正文，随时改
    } else if (partial && partial.kind === 'idea') {
      base.title = '创意';
      base.memo = '';           // 和琐事同款：整张备忘录只有一条，正文放在 memo 字段
    }
    return Object.assign(base, partial || {});
  }

  function fileDefault(file) {
    if (file === 'tasks') return [];
    if (file === 'checkins') return [];
    return { v: 1, devices: {} };
  }

  /* ---------- 通用：备注流水 ---------- */
  const nowTime = () => {
    const d = new Date();
    return pad(d.getHours()) + ':' + pad(d.getMinutes());
  };
  /* 进展时间显示：今天 14:32 / 昨天 09:05 / 09-11 20:10 */
  function fmtNoteTime(note, today) {
    if (!note || !note.date) return '';
    const t = note.time ? ' ' + note.time : '';
    const d = today || todayStr();
    if (note.date === d) return '今天' + t;
    if (note.date === shiftDate(d, -1)) return '昨天' + t;
    return String(note.date).slice(5) + t;
  }
  function addNote(item, text) {
    const t = (text || '').trim();
    if (!t) return { item, changed: false };
    const next = JSON.parse(JSON.stringify(item));
    if (!Array.isArray(next.notes)) next.notes = [];
    let maxSeq = 0;
    next.notes.forEach((n, i) => {
      const s = typeof n.seq === 'number' ? n.seq : i + 1;
      if (s > maxSeq) maxSeq = s;
    });
    next.notes.push({ date: todayStr(), time: nowTime(), text: t, seq: maxSeq + 1 });
    next.updatedAt = new Date().toISOString();
    return { item: next, changed: true };
  }
  /* 进展排序：未完成在上、已完成沉底；同一段内 seq 从大到小 = 最新在最上面。
   * 老数据没有 seq 用数组下标兜底，没有 done 字段一律视为未完成。 */
  const noteDone = (n) => !!(n && n.done);
  function orderedNotes(item) {
    const arr = Array.isArray(item && item.notes) ? item.notes : [];
    return arr.map((note, index) => ({
      note, index,
      seq: (note && typeof note.seq === 'number') ? note.seq : index + 1
    })).sort((a, b) =>
      (noteDone(a.note) ? 1 : 0) - (noteDone(b.note) ? 1 : 0) || b.seq - a.seq);
  }
  function deleteNote(item, index) {
    const list = Array.isArray(item && item.notes) ? item.notes.slice() : [];
    if (index < 0 || index >= list.length) return { item, changed: false };
    list.splice(index, 1);
    const next = Object.assign({}, item, { notes: list, updatedAt: new Date().toISOString() });
    return { item: next, changed: true };
  }
  /* 打勾 / 取消打勾：打勾后沉到最下面，取消后回到原来的 seq 位置 */
  function setNoteDone(item, index, done) {
    const list = Array.isArray(item && item.notes) ? item.notes.slice() : [];
    if (index < 0 || index >= list.length) return { item, changed: false };
    const now = !!list[index].done;
    const want = !!done;
    if (now === want) return { item, changed: false };
    list[index] = Object.assign({}, list[index], want
      ? { done: true, doneAt: new Date().toISOString() }
      : { done: false, doneAt: null });
    return { item: Object.assign({}, item, { notes: list, updatedAt: new Date().toISOString() }), changed: true };
  }
  /* 修改一条进展的文字：时间、顺序、打勾状态都不动 */
  function editNote(item, index, text) {
    const list = Array.isArray(item && item.notes) ? item.notes.slice() : [];
    if (index < 0 || index >= list.length) return { item, changed: false };
    const t = (text || '').trim();
    if (!t || t === list[index].text) return { item, changed: false };
    list[index] = Object.assign({}, list[index], { text: t, editedAt: new Date().toISOString() });
    return { item: Object.assign({}, item, { notes: list, updatedAt: new Date().toISOString() }), changed: true };
  }
  /* displayOrder = 数组下标数组，第一个是页面最上面那条。
   * 没出现在里面的（例如已完成的那些）按当前顺序接在后面。 */
  function setNoteOrder(item, displayOrder) {
    const list = Array.isArray(item && item.notes) ? item.notes.slice() : [];
    if (!list.length) return { item, changed: false };
    const seen = {};
    const reordered = [];
    (displayOrder || []).forEach((i) => {
      if (i < 0 || i >= list.length || seen[i]) return;
      seen[i] = true;
      reordered.push(Object.assign({}, list[i]));
    });
    orderedNotes(item).forEach((e) => {
      if (!seen[e.index]) { seen[e.index] = true; reordered.push(Object.assign({}, list[e.index])); }
    });
    const N = reordered.length;
    reordered.forEach((n, i) => { n.seq = N - i; });   // 最上面 seq 最大
    const next = Object.assign({}, item, { notes: reordered, updatedAt: new Date().toISOString() });
    const before = orderedNotes(item).map((e) => e.note.text).join('\u0001');
    const after = orderedNotes(next).map((e) => e.note.text).join('\u0001');
    return { item: next, changed: before !== after };
  }

  /* ---------- 习惯清单：拖动排序后的展示顺序 ---------- */
  /* 排序键 rank → 创建日 → id，三级都确定：
   * 即使三端各自添加导致 rank 撞号，顺序也永远稳定，不会互相「挤走」。 */
  function compareKeep(a, b) {
    const ra = a.rank != null ? a.rank : Infinity;
    const rb = b.rank != null ? b.rank : Infinity;
    if (ra !== rb) return ra < rb ? -1 : 1;
    const ca = String(a.created || '');
    const cb = String(b.created || '');
    if (ca !== cb) return ca < cb ? -1 : 1;
    const ia = String(a.id || '');
    const ib = String(b.id || '');
    if (ia !== ib) return ia < ib ? -1 : 1;
    return 0;
  }
  function keepOrdered(items) {
    return (items || []).filter((t) => t && t.kind === 'keep').slice().sort(compareKeep);
  }

  /* ---------- 备忘录（琐事 / 创意）：整张清单只有一条，正文放在 memo 字段 ---------- */
  function memoOf(items, kind) {
    const k = kind || 'memo';
    return (items || []).find((t) => t && t.kind === k) || null;
  }
  function memoText(items, kind) {
    const m = memoOf(items, kind);
    return m && typeof m.memo === 'string' ? m.memo : '';
  }

  /* ---------- 备忘录「⏰ 倒计时」：给任意一句话标一个到期日 ----------
   * 正文里在句末写 ⏰2026-09-20（也认 ⏰9/20、⏰9月20日），这一行就成了倒计时。
   * 标记就写在正文里，不额外存字段 —— 少一份状态，就少一类同步冲突。 */
  const TIMER_MARK = '⏰';
  const TIMER_RANK = { over: 0, today: 1, soon: 2, far: 3 };   // 越紧急排越前
  const TIMER_RE = /⏰\s*(?:(\d{4})\s*[-/.年]\s*)?(\d{1,2})\s*[-/.月]\s*(\d{1,2})\s*日?/;
  /* 这一行做完了没有：正文行首写 ✅ 就算完成（同样写在正文里，不额外存字段）。
     ✅ 和 ⏰ 可以并存：'✅ 买菜 ⏰2026-09-20' = 今天到期那件事已经打勾。 */
  const DONE_MARK = '✅';
  const DONE_RE = /^\s*✅\s*/;
  const hasDoneMark = (line) => DONE_RE.test(String(line == null ? '' : line));
  const stripDoneMark = (line) => String(line == null ? '' : line).replace(DONE_RE, '');

  function parseTimerMarker(line) {
    const m = TIMER_RE.exec(String(line == null ? '' : line));
    if (!m) return null;
    const mo = Number(m[2]);
    const da = Number(m[3]);
    if (!(mo >= 1 && mo <= 12) || !(da >= 1 && da <= 31)) return null;
    const y = m[1] ? Number(m[1]) : new Date().getFullYear();
    return { due: y + '-' + pad(mo) + '-' + pad(da), raw: m[0] };
  }
  const stripTimerMarker = (line) =>
    String(line == null ? '' : line).replace(TIMER_RE, '').replace(/\s+$/, '');
  function timerStateOf(days) {
    if (days < 0) return 'over';
    if (days === 0) return 'today';
    if (days <= 3) return 'soon';
    return 'far';
  }
  /* 剩余天数文案：已过期 3 天 / 就是今天 / 明天 / 还有 5 天 */
  function fmtLeft(days) {
    const n = Number(days) || 0;
    if (n < 0) return '已过期 ' + (-n) + ' 天';
    if (n === 0) return '就是今天';
    if (n === 1) return '明天';
    if (n === 2) return '后天';
    return '还有 ' + n + ' 天';
  }
  /* 正文里所有带 ⏰ 的行 → [{ line, text, due, days, state }]，按到期日从近到远 */
  function timersOf(text, today) {
    const d0 = today || todayStr();
    return String(text == null ? '' : text).split('\n').map((line, i) => {
      if (isSubLine(line)) return null;        // ↳ 进展行本身不算一条倒计时
      const mk = parseTimerMarker(line);
      if (!mk) return null;
      const days = dayDiff(d0, mk.due);
      return {
        line: i, text: stripDoneMark(stripTimerMarker(line)).trim(), due: mk.due,
        days, done: hasDoneMark(line), state: timerStateOf(days)
      };
    }).filter(Boolean).sort((a, b) => {
      if (a.done !== b.done) return a.done ? 1 : -1;   // 打过勾的沉到最下面
      const ra = TIMER_RANK[a.state], rb = TIMER_RANK[b.state];
      if (ra !== rb) return ra - rb;                   // 紧急的（已过期 / 今天）自动置顶
      return a.line - b.line;                          // 同一档里按正文顺序 = 你拖出来的顺序
    });
  }
  /* 光标位置 → 第几行（从 0 数），越界一律夹到有效范围 */
  function lineIndexAt(text, pos) {
    const s = String(text == null ? '' : text);
    const p = Math.max(0, Math.min(Number(pos) || 0, s.length));
    return s.slice(0, p).split('\n').length - 1;
  }
  /* 给第 n 行标到期日：已有标记就改成新日期，没有就补在句末 */
  function setLineTimer(text, lineIndex, due) {
    const lines = String(text == null ? '' : text).split('\n');
    const i = Math.max(0, Math.min(Number(lineIndex) || 0, lines.length - 1));
    const base = stripTimerMarker(lines[i]).replace(/\s+$/, '');
    lines[i] = (base ? base + ' ' : '') + TIMER_MARK + due;
    return lines.join('\n');
  }
  function clearLineTimer(text, lineIndex) {
    const lines = String(text == null ? '' : text).split('\n');
    const i = Math.max(0, Math.min(Number(lineIndex) || 0, lines.length - 1));
    if (!parseTimerMarker(lines[i])) return lines.join('\n');
    lines[i] = stripDoneMark(stripTimerMarker(lines[i])).replace(/\s+$/, '');
    return lines.join('\n');
  }
  /* 改第 n 行的正文：打勾的 ✅ 和倒计时标记（原样，含用户手写的写法）都保留 */
  function setLineText(text, lineIndex, newText) {
    const lines = String(text == null ? '' : text).split('\n');
    const i = Math.max(0, Math.min(Number(lineIndex) || 0, lines.length - 1));
    const body = stripDoneMark(String(newText == null ? '' : newText)).replace(/[\r\n]+/g, ' ').trim();
    const mk = parseTimerMarker(lines[i]);
    const parts = [];
    if (hasDoneMark(lines[i])) parts.push(DONE_MARK);
    if (body) parts.push(body);
    if (mk) parts.push(mk.raw);
    lines[i] = parts.join(' ');
    return lines.join('\n');
  }
  /* 打勾 / 取消打勾：在那一行行首加 / 去 ✅，日期标记一个字都不动 */
  function setLineDone(text, lineIndex, done) {
    const lines = String(text == null ? '' : text).split('\n');
    const i = Math.max(0, Math.min(Number(lineIndex) || 0, lines.length - 1));
    const body = stripDoneMark(lines[i]).replace(/^\s+/, '');
    lines[i] = done ? (body ? DONE_MARK + ' ' + body : DONE_MARK) : body;
    return lines.join('\n');
  }

  /* ---------- 倒计时那行下面的「进展」：正文里紧跟其后的 ↳ 行 ----------
   * 在某句话下面写「  ↳ 09-18 已经打过电话了」，这条进展就挂在那句话上。
   * 同样只写在正文里，不额外存字段；今日页提醒里能直接补记，不用回备忘录页。 */
  const SUB_MARK = '↳';
  const SUB_INDENT = '  ';
  const SUB_RE = /^\s*↳/;
  const SUB_TEXT_RE = /^\s*↳\s*(?:(\d{1,2})\s*[-/.]\s*(\d{1,2})\s*)?(.*)$/;
  const isSubLine = (line) => SUB_RE.test(String(line == null ? '' : line));
  function parseSubLine(line) {
    const m = SUB_TEXT_RE.exec(String(line == null ? '' : line));
    if (!m) return null;
    return {
      md: m[1] ? pad(Number(m[1])) + '-' + pad(Number(m[2])) : '',
      text: String(m[3] == null ? '' : m[3]).trim()
    };
  }
  /* 第 n 行下面跟着的进展行 → [{ line, md, text }] */
  function subLinesOf(text, lineIndex) {
    const lines = String(text == null ? '' : text).split('\n');
    if (!lines.length) return [];
    const i = Math.max(0, Math.min(Number(lineIndex) || 0, lines.length - 1));
    if (isSubLine(lines[i])) return [];      // ↳ 行自己不是「一句话」，下面挂的也不归它
    const out = [];
    for (let k = i + 1; k < lines.length && isSubLine(lines[k]); k += 1) {
      out.push(Object.assign({ line: k }, parseSubLine(lines[k])));
    }
    return out;
  }
  /* 给第 n 行补一条进展：接在已有进展的最后面 */
  function addSubLine(text, lineIndex, content, dateStr) {
    const lines = String(text == null ? '' : text).split('\n');
    const i = Math.max(0, Math.min(Number(lineIndex) || 0, lines.length - 1));
    const body = String(content == null ? '' : content).replace(/[\r\n]+/g, ' ').trim();
    if (!body) return lines.join('\n');
    const md = String(dateStr || todayStr()).slice(5);
    let at = i + 1;
    while (at < lines.length && isSubLine(lines[at])) at += 1;
    lines.splice(at, 0, SUB_INDENT + SUB_MARK + ' ' + md + ' ' + body);
    return lines.join('\n');
  }
  /* 改某条进展的文字，日期原样保留 */
  function setSubLineText(text, lineIndex, content) {
    const lines = String(text == null ? '' : text).split('\n');
    const i = Math.max(0, Math.min(Number(lineIndex) || 0, lines.length - 1));
    if (!isSubLine(lines[i])) return lines.join('\n');
    const cur = parseSubLine(lines[i]) || { md: '' };
    const body = String(content == null ? '' : content).replace(/[\r\n]+/g, ' ').trim();
    lines[i] = SUB_INDENT + SUB_MARK + (cur.md ? ' ' + cur.md : '') + (body ? ' ' + body : '');
    return lines.join('\n');
  }
  function deleteSubLine(text, lineIndex) {
    const lines = String(text == null ? '' : text).split('\n');
    const i = Math.max(0, Math.min(Number(lineIndex) || 0, lines.length - 1));
    if (!isSubLine(lines[i])) return lines.join('\n');
    lines.splice(i, 1);
    return lines.join('\n');
  }
  /* 整块划掉：删掉第 n 行，连同它下面挂着的进展行一起 —— 倒计时那件事打完勾就走这条路 */
  function deleteLineBlock(text, lineIndex) {
    const lines = String(text == null ? '' : text).split('\n');
    const i = Math.max(0, Math.min(Number(lineIndex) || 0, lines.length - 1));
    if (!lines.length) return '';
    let end = i + 1;
    if (!isSubLine(lines[i])) {
      while (end < lines.length && isSubLine(lines[end])) end += 1;
    }
    lines.splice(i, end - i);
    return lines.join('\n');
  }
  /* 拖动排序：按新顺序把「句子 + 它的进展行」整块搬一遍，别的行原地不动 */
  function reorderLineBlocks(text, order) {
    const lines = String(text == null ? '' : text).split('\n');
    const starts = (order || []).map(Number).filter((n) => Number.isInteger(n) && n >= 0 && n < lines.length);
    if (starts.length < 2) return lines.join('\n');
    const blocks = starts.map((i) => {
      const rows = [lines[i]];
      for (let k = i + 1; k < lines.length && isSubLine(lines[k]); k += 1) rows.push(lines[k]);
      return { i, rows };
    });
    const used = new Set();
    blocks.forEach((b) => b.rows.forEach((_, k) => used.add(b.i + k)));
    const total = blocks.reduce((n, b) => n + b.rows.length, 0);
    if (used.size !== total) return lines.join('\n');   // 块之间有重叠 → 不动，别搞乱
    const at = Math.min.apply(null, starts);
    const keep = [];
    for (let i = 0; i < lines.length; i += 1) if (!used.has(i)) keep.push(i);
    const before = keep.filter((i) => i < at).length;
    const out = keep.slice(0, before).map((i) => lines[i]);
    blocks.forEach((b) => b.rows.forEach((r) => out.push(r)));
    keep.slice(before).forEach((i) => out.push(lines[i]));
    return out.join('\n');
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
        const t = op.task || {};
        const prev = (value || []).find((x) => x && x.id === t.id);
        /* 最新的那条永远赢：要写进去的内容比已有内容更旧，就当这条操作不存在。
         * 这是为了挡住「离线排队很久的老操作回放」把刚改好的内容盖回去。 */
        if (prev && (prev.updatedAt || '') > (t.updatedAt || '')) {
          return { value, changed: false };
        }
        const r = upsertItem(value, t);
        return { value: r.list, changed: r.changed };
      }
      if (op.type === 'task_delete') {
        const prev = (value || []).find((x) => x && x.id === op.id);
        /* 删除操作比条目本身还旧（删完之后又被编辑过）→ 丢弃，别把新内容删掉 */
        if (prev && op.at && (prev.updatedAt || '') > op.at) {
          return { value, changed: false };
        }
        const r = removeItem(value, op.id);
        return { value: r.list, changed: r.changed };
      }
      /* 批量删除：一次网络往返清掉若干已完成条目（设置页的「清理已完成」用）。
       * 逐条仍然比对时间戳，比条目本身旧的删除请求一律跳过，避免把别处刚改的内容删掉。 */
      if (op.type === 'task_delete_many') {
        let list = value;
        let changed = false;
        (op.ids || []).forEach((id) => {
          const prev = (list || []).find((x) => x && x.id === id);
          if (prev && op.at && (prev.updatedAt || '') > op.at) return;
          const r = removeItem(list, id);
          if (r.changed) { list = r.list; changed = true; }
        });
        return { value: list, changed };
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

  /* ---------- 公司：循环任务（每周固定某几天，到日子自动进「今日」最前面） ---------- */
  const loopWeekdays = (item) => {
    const raw = Array.isArray(item && item.weekdays) ? item.weekdays : [];
    const set = [];
    raw.forEach((n) => {
      const v = Number(n);
      if (v >= 0 && v <= 6 && set.indexOf(v) < 0) set.push(v);
    });
    return set.sort((a, b) => a - b);
  };
  /* 一周内的先后：周一=0 … 周日=6 */
  const weekIndex = (date) => (parseDate(date).getDay() + 6) % 7;

  function loopState(item, date) {
    if (!item || item.kind !== 'loop') return null;
    const wds = loopWeekdays(item);
    if (!wds.length) return null;
    const started = !item.created || item.created <= date;   // 还没到创建那天不算
    const wk = weekKey(date);
    const done = Array.isArray(item.doneWeeks) && item.doneWeeks.indexOf(wk) >= 0;
    const idx = wds.map((w) => (w + 6) % 7).sort((a, b) => a - b);
    const today = started && idx.indexOf(weekIndex(date)) >= 0;
    return {
      week: wk, weekdays: wds, done, today, started,
      missed: started && !done && idx[idx.length - 1] < weekIndex(date) // 本周该做的日子都过了还没勾
    };
  }
  /* 今天要做 → 返回状态；否则 null（「今日」页只收当天该做的循环任务） */
  function loopOn(item, date) {
    const st = loopState(item, date);
    return st && st.today ? st : null;
  }
  /* 打勾 = 本周这个循环任务完成；下周一自动重新出现 */
  function setLoopDone(item, date, done) {
    const wk = weekKey(date);
    const set = Array.isArray(item.doneWeeks) ? item.doneWeeks.slice() : [];
    const i = set.indexOf(wk);
    const changed = done ? i < 0 : i >= 0;
    if (done && i < 0) set.push(wk);
    if (!done && i >= 0) set.splice(i, 1);
    set.sort();
    const next = JSON.parse(JSON.stringify(item));
    next.doneWeeks = set;
    next.updatedAt = new Date().toISOString();
    return { item: next, changed };
  }
  function loopLabel(item) {
    const wds = loopWeekdays(item);
    if (!wds.length) return '未选星期';
    if (wds.length === 7) return '每天';
    return '每周 ' + wds.map((w) => WEEKDAY_SHORT[w]).join('·');
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

  /* ---------- 清理已完成 ---------- */
  /* 只有公司任务与计划方向会被清；自律/习惯/循环任务靠自身周期重置，
   * 备忘录没完成态，都不参与。打勾历史 checkins 一律保留，清理不影响连续打卡统计。 */
  const PURGEABLE_KINDS = ['work', 'plan'];
  function purgeDoneCandidates(items, beforeDate) {
    return (items || [])
      .filter((t) => t && PURGEABLE_KINDS.indexOf(t.kind) >= 0 &&
        t.done && t.doneDate && t.doneDate < beforeDate)
      .map((t) => t.id);
  }

  /* ---------- 今日聚合（今日首页） ---------- */
  function todayEntries(items, checkins, date) {
    const work = [];
    const habits = [];
    const loops = [];
    (items || []).forEach((t) => {
      if (t.kind === 'work') {
        const w = workStatus(t, date);
        if (w && w.bucket === 'today') work.push({ item: t, done: false, overdue: !!w.overdue });
        else if (w && w.bucket === 'done' && w.doneDate === date && (t.due || date) <= date) {
          work.push({ item: t, done: true, overdue: false }); // 今天刚做完的
        }
      } else if (t.kind === 'loop') {
        const l = loopOn(t, date);
        if (l) loops.push({ item: t, done: l.done, week: l.week });
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
    const total = work.length + habits.length + loops.length;
    const done = work.filter((e) => e.done).length + habits.filter((e) => e.done).length +
      loops.filter((e) => e.done).length;
    return { work, habits, loops, total, done, streak: streakDays(items, checkins, date) };
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
    KINDS, FREQS, kindLabel, freqLabel, newItem, keepOrdered, memoOf, memoText,
    TIMER_MARK, parseTimerMarker, stripTimerMarker, timerStateOf, fmtLeft, timersOf,
    DONE_MARK, hasDoneMark, stripDoneMark, setLineDone,
    SUB_MARK, isSubLine, parseSubLine, subLinesOf, addSubLine, setSubLineText, deleteSubLine, deleteLineBlock, reorderLineBlocks,
    lineIndexAt, setLineTimer, clearLineTimer, setLineText,
    WEEKDAY_LABELS, WEEKDAY_SHORT, loopWeekdays, loopLabel, loopState, loopOn, setLoopDone, weekIndex,
    fileDefault, addNote, fmtNoteTime, orderedNotes, deleteNote, setNoteOrder, setNoteDone, editNote, noteDone, upsertItem, removeItem,
    setCheckinDate, upsertDevice, applyOp, purgeDoneCandidates, PURGEABLE_KINDS,
    doneIdsFor, checkedOn, weekKey, weeklyDoneOn, dailyScheduledOn, habitOn,
    workStatus, planState, todayEntries, streakDays
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else global.Core = api;
})(typeof window !== 'undefined' ? window : globalThis);
