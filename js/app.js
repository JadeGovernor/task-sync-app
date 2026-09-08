/* UI 层：渲染、事件、任务/打卡操作 */
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
  let current = 'today';   // life|work|plan|today|settings
  let editingId = null;
  let lastStatus = { text: '连接中…' };

  /* ---------- 轻提示 & 确认 ---------- */
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
      const ok = $('#confirm-ok');
      const cancel = $('#confirm-cancel');
      const done = (v) => {
        $('#confirm-backdrop').classList.add('hidden');
        ok.removeEventListener('click', onOk);
        cancel.removeEventListener('click', onCancel);
        resolve(v);
      };
      const onOk = () => done(true);
      const onCancel = () => done(false);
      ok.addEventListener('click', onOk);
      cancel.addEventListener('click', onCancel);
    });
  }

  /* ---------- 数据读取 ---------- */
  const tasks = () => store.files.tasks.value || [];
  const checkins = () => store.files.checkins.value || [];
  const settingsObj = () => store.files.settings.value || { devices: {} };
  const myDevice = () => settingsObj().devices[store.deviceId] || {};
  const activeCount = () => tasks().filter((t) => !(t.repeat === 'once' && t.done)).length;
  const moduleCount = (m) => tasks().filter((t) => t.module === m && !(t.repeat === 'once' && t.done)).length;

  /* ---------- 打卡操作 ---------- */
  async function toggleTask(id, date) {
    const t = tasks().find((x) => x.id === id);
    if (!t) return;
    const wasDone = Core.isDoneOn(t, date, checkins()) || (t.repeat === 'once' && t.doneDate === date && t.done);
    const ids = Core.doneIdsFor(checkins(), date).filter((x) => x !== id);
    if (!wasDone) {
      ids.push(id);
      if (t.repeat === 'once' && !t.done) store.saveTask(Object.assign({}, t, { done: true, doneDate: date }));
      else if (t.repeat !== 'once') store.saveTask(Object.assign({}, t, { lastDone: date }));
      store.setChecked(date, ids);
      toast('已完成 ✓');
    } else {
      if (t.repeat === 'once' && t.doneDate === date) {
        store.saveTask(Object.assign({}, t, { done: false, doneDate: null, lastDone: undefined }));
      }
      store.setChecked(date, ids);
      toast('已取消勾选');
    }
  }

  /* ---------- 任务弹窗 ---------- */
  function openTaskModal(presetModule, task) {
    editingId = task ? task.id : null;
    $('#modal-title').textContent = task ? '编辑任务' : '新建任务';
    $('#f-title').value = task ? task.title : '';
    $('#f-note').value = task ? task.note || '' : '';
    $('#f-due').value = task && task.due ? task.due : today();
    $('#f-module').value = task ? task.module : (presetModule || 'life');
    $('#f-repeat').value = task ? task.repeat : 'once';
    $('#btn-delete-task').classList.toggle('hidden', !task);
    $('#modal-backdrop').classList.remove('hidden');
    $('#f-title').focus();
  }
  function closeTaskModal() {
    $('#modal-backdrop').classList.add('hidden');
    editingId = null;
  }

  function submitTask(e) {
    e.preventDefault();
    const title = $('#f-title').value.trim();
    if (!title) { toast('标题不能为空'); return; }
    const old = editingId ? tasks().find((t) => t.id === editingId) : null;
    const repeat = $('#f-repeat').value;
    const due = $('#f-due').value || null;
    const base = old ? Object.assign({}, old) : Core.newTask({});
    const next = Object.assign(base, {
      title,
      module: $('#f-module').value,
      repeat,
      due,
      note: $('#f-note').value.trim()
    });
    if (repeat !== 'once') {
      // 改为周期性任务时清掉“一次性完成”状态
      if (next.done) { next.done = false; next.doneDate = null; }
    }
    if (!old) next.created = today();
    store.saveTask(next);
    closeTaskModal();
    render();
    toast(old ? '已保存' : '已创建');
  }

  async function deleteEditing() {
    if (!editingId) return;
    const t = tasks().find((x) => x.id === editingId);
    if (!t) return closeTaskModal();
    const ok = await confirmDialog('删除任务', '确定删除「' + t.title + '」？打卡历史会保留。');
    if (!ok) return;
    store.deleteTask(t.id);
    closeTaskModal();
    render();
    toast('已删除');
  }

  /* ---------- 渲染 ---------- */
  function chip(text, cls) {
    return '<span class="chip ' + (cls || '') + '">' + esc(text) + '</span>';
  }

  function taskRowHTML(t, opts) {
    const o = opts || {};
    const doneNow = Core.isDoneOn(t, today(), checkins());
    const isDone = o.done !== undefined ? o.done : doneNow;
    const isOverdue = o.overdue;
    const isOnceDone = t.repeat === 'once' && t.done;
    const meta = [];
    if (o.showModule) meta.push(chip(Core.moduleLabel(t.module), 'm-' + t.module));
    if (!isOverdue && o.date !== t.due && t.due) meta.push(chip('截止 ' + t.due));
    if (!isOnceDone && !isOverdue && o.date !== t.due && t.repeat !== 'once') meta.push(chip(Core.repeatLabel(t.repeat), 'dim'));
    if (isOnceDone) meta.push(chip(t.doneDate === today() ? '今日完成' : '已完成 ' + (t.doneDate || ''), 'ok'));
    if (isOverdue) meta.push(chip('逾期', 'warn'));
    if (t.note) meta.push('<span class="note">' + esc(t.note) + '</span>');
    return (
      '<div class="task ' + (isDone ? 'is-done' : '') + '" data-id="' + t.id + '">' +
        '<label class="cb">' +
          '<input type="checkbox" data-action="toggle" data-id="' + t.id + '" data-date="' + o.date + '"' + (isDone ? ' checked' : '') + ' />' +
          '<span class="box"></span>' +
        '</label>' +
        '<div class="task-main" data-action="edit" data-id="' + t.id + '">' +
          '<div class="task-title">' + esc(t.title) + '</div>' +
          '<div class="task-meta">' + meta.join('') + '</div>' +
        '</div>' +
        '<button class="icon-btn ghost" data-action="edit" data-id="' + t.id + '" type="button" title="编辑">✎</button>' +
      '</div>'
    );
  }

  function listHTML(entries, opts) {
    if (!entries.length) {
      return '<div class="empty">' + (opts.empty || '暂无任务') + '</div>';
    }
    return entries.map((e) => {
      const row = taskRowHTML(e.task, Object.assign({}, opts, { done: e.done }));
      return row;
    }).join('');
  }

  function section(title, body, extra) {
    return '<section class="card"><h3>' + esc(title) + '</h3>' + (extra || '') + body + '</section>';
  }

  function renderModule(m) {
    const list = tasks()
      .filter((t) => t.module === m)
      .map((t) => ({ task: t, done: !!(t.repeat === 'once' && t.done) }))
      .sort((a, b) => {
        if (a.done !== b.done) return a.done ? 1 : -1;
        const da = a.task.due || '9999-99-99';
        const db = b.task.due || '9999-99-99';
        return da < db ? -1 : da > db ? 1 : 0;
      });
    const undone = list.filter((x) => !x.done);
    const doneList = list.filter((x) => x.done);
    let html = section(Core.moduleLabel(m) + ' · ' + undone.length + ' 项待办',
      listHTML(undone, { date: today(), showModule: false }),
      '');
    if (doneList.length) {
      html += section('已完成 ' + doneList.length,
        listHTML(doneList, { date: today(), showModule: false }), '');
    }
    return html;
  }

  function renderToday() {
    const d = today();
    const st = Core.dayStats(tasks(), checkins(), d);
    const { scheduled, overdue } = Core.dayEntries(tasks(), checkins(), d);
    const streak = Core.streakDays(tasks(), checkins(), d);
    const pct = st.total ? Math.round((st.done / st.total) * 100) : 0;
    const sorted = scheduled.slice().sort((a, b) => {
      if (a.done !== b.done) return a.done ? 1 : -1;
      return 0;
    });
    const extra = tasks().filter((t) =>
      t.repeat === 'once' && t.done && t.doneDate === d && t.due !== d);
    const progressHtml =
      '<div class="progress">' +
        '<div class="progress-head">' +
          '<span>' + Core.fmtCN(d) + '</span>' +
          '<span class="stat">' + (st.total ? st.done + '/' + st.total + ' · ' + pct + '%' : '今日无安排') +
          (streak ? ' · 🔥 连续 ' + streak + ' 天' : '') + '</span>' +
        '</div>' +
        (st.total ? '<div class="bar"><i style="width:' + pct + '%"></i></div>' : '') +
      '</div>';
    let html = section('今日效率', progressHtml + listHTML(sorted, {
      date: d, showModule: true, empty: '今天没有安排。到模块页加任务，或在模块页把任务截止日设为今天。'
    }));
    if (overdue.length) {
      html += section('已逾期 · ' + overdue.length,
        listHTML(overdue.map((t) => ({ task: t, done: false })), {
          date: d, overdue: true, showModule: true
        }));
    }
    if (extra.length) {
      html += section('今日补卡',
        listHTML(extra.map((t) => ({ task: t, done: true })), { date: d, showModule: true }));
    }
    return html;
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
      '<section class="card">' +
        '<h3>连接同步（每台设备各设一次）</h3>' +
        '<p class="hint">Token 只保存在本设备浏览器里。在 GitHub 建一个只对 <b>' + esc(Cfg.owner + '/' + Cfg.repo) +
        '</b> 仓库有 Contents 读写权限的 Fine-grained Token，粘贴到下面。详细步骤见仓库 <b>DEPLOY.md</b>。</p>' +
        '<div class="field">' +
          '<input id="set-token" type="password" value="' + esc(store.token) + '" placeholder="ghp_ 或 github_pat_ 开头…" autocomplete="off" />' +
        '</div>' +
        '<div class="actions-row">' +
          '<button class="btn btn-primary" id="set-token-save" type="button">' + (hasToken ? '保存并测试 Token' : '连接') + '</button>' +
          '<button class="btn" id="set-sync-now" type="button">立即同步</button>' +
          '<span class="hint">' + (hasToken ? '状态：' + esc(st.text) : '未连接') + '</span>' +
        '</div>' +
      '</section>' +
      '<section class="card">' +
        '<h3>设备：' + esc(name) + '</h3>' +
        '<div class="field">' +
          '<label><span>设备显示名</span><input id="set-devname" type="text" value="' + esc(name) + '" maxlength="30" /></label>' +
        '</div>' +
        '<div class="actions-row"><button class="btn" id="set-name-save" type="button">保存设备名</button></div>' +
      '</section>' +
      '<section class="card">' +
        '<h3>早睡早起 · 语音闹钟（以 iPhone 为主）</h3>' +
        '<p class="hint">这里只是“计划”，实际到点播放由 iPhone 的「时钟闹钟 / 快捷指令」负责（详见 DEPLOY.md）。</p>' +
        '<div class="row"><label class="switch-line"><input id="set-wake-on" type="checkbox"' + (wOn ? ' checked' : '') + ' /> 早起</label>' +
        '<input id="set-wake-time" type="time" value="' + esc(wake) + '" /></div>' +
        '<div class="row"><label class="switch-line"><input id="set-sleep-on" type="checkbox"' + (sOn ? ' checked' : '') + ' /> 早睡提醒</label>' +
        '<input id="set-sleep-time" type="time" value="' + esc(sleep) + '" /></div>' +
        '<div class="field"><label><span>想播的音频文件名（B 站下载后如 morning.mp3）</span>' +
        '<input id="set-audio" type="text" value="' + esc(d.audioFile || '') + '" placeholder="morning.mp3" maxlength="80" /></label></div>' +
        '<div class="actions-row"><button class="btn btn-primary" id="set-alarm-save" type="button">保存闹钟设置</button></div>' +
      '</section>' +
      '<section class="card danger-zone">' +
        '<h3>本机数据</h3>' +
        '<div class="actions-row">' +
          '<button class="btn" id="set-refresh" type="button">重新拉取云端</button>' +
          '<button class="btn btn-danger" id="set-clear" type="button">清空本机缓存</button>' +
        '</div>' +
        '<p class="hint">设备 ID：' + esc(store.deviceId) + '。清空缓存会删除本机离线数据与待同步队列，Token 保留。</p>' +
      '</section>'
    );
  }

  function tabButton(id, label, count, extra) {
    return '<button class="tab' + (current === id ? ' active' : '') + '" data-tab="' + id + '" type="button">' +
      label + (count != null ? '<i>' + count + '</i>' : '') + (extra || '') + '</button>';
  }

  function render() {
    $('#subline').textContent = lastStatus.text;
    $('#tabs').innerHTML =
      tabButton('today', '今日') +
      Core.MODULES.map((m) => tabButton(m.id, m.label, moduleCount(m.id))).join('') +
      tabButton('settings', '设置');
    const view = $('#view');
    if (current === 'today') view.innerHTML = renderToday();
    else if (current === 'settings') view.innerHTML = renderSettings();
    else view.innerHTML = renderModule(current);
    bindSettingsEvents();
  }

  /* ---------- 事件 ---------- */
  function bindSettingsEvents() {
    const saveToken = async () => {
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
    };
    const b1 = $('#set-token-save'); if (b1) b1.addEventListener('click', saveToken);
    const b2 = $('#set-name-save'); if (b2) b2.addEventListener('click', () => {
      const n = $('#set-devname').value.trim();
      if (!n) return toast('名称不能为空');
      store.patchSettings({ deviceName: n });
      toast('已保存设备名');
      render();
    });
    const b3 = $('#set-alarm-save'); if (b3) b3.addEventListener('click', () => {
      const patch = {
        deviceName: $('#set-devname').value.trim() || store.deviceGuess,
        wakeEnabled: $('#set-wake-on').checked,
        wakeTime: $('#set-wake-time').value || Cfg.defaults.wakeTime,
        sleepEnabled: $('#set-sleep-on').checked,
        sleepTime: $('#set-sleep-time').value || Cfg.defaults.sleepTime,
        audioFile: $('#set-audio').value.trim()
      };
      store.patchSettings(patch);
      toast('闹钟设置已保存并同步');
    });
    const b4 = $('#set-sync-now'); if (b4) b4.addEventListener('click', async () => {
      await store.flush();
      await store.refresh(false).catch((e) => toast('同步失败：' + e.message, 3500));
      toast('已同步');
    });
    const b5 = $('#set-refresh'); if (b5) b5.addEventListener('click', async () => {
      await store.refresh(false).catch((e) => toast('刷新失败：' + e.message, 3500));
      toast('已拉取最新数据');
    });
    const b6 = $('#set-clear'); if (b6) b6.addEventListener('click', async () => {
      const ok = await confirmDialog('清空本机缓存', '会删除本机的离线数据和待同步队列（云端数据不受影响），确定继续？');
      if (!ok) return;
      store.clearLocal();
      location.reload();
    });
  }

  document.addEventListener('click', (e) => {
    const tabEl = e.target.closest('[data-tab]');
    if (tabEl) { current = tabEl.dataset.tab; render(); return; }

    const act = e.target.closest('[data-action]');
    if (act) {
      const action = act.dataset.action;
      const id = act.dataset.id;
      if (action === 'toggle') {
        toggleTask(id, act.dataset.date || today()).then(render);
        return;
      }
      if (action === 'edit') {
        const t = tasks().find((x) => x.id === id);
        if (t) openTaskModal(t.module, t);
        return;
      }
    }

    if (e.target.closest('[data-close]')) closeTaskModal();
  });

  const btnNew = $('#btn-new');
  btnNew.addEventListener('click', () => {
    const preset = current === 'today' ? 'life' : (Core.MODULES.some((m) => m.id === current) ? current : 'life');
    openTaskModal(preset, null);
  });
  $('#btn-sync').addEventListener('click', async () => {
    await store.flush();
    await store.refresh(false).catch(() => {});
    toast('已同步');
  });
  $('#task-form').addEventListener('submit', submitTask);
  $('#btn-delete-task').addEventListener('click', deleteEditing);

  /* 填充下拉 */
  Core.MODULES.forEach((m) => {
    const o = document.createElement('option');
    o.value = m.id; o.textContent = m.label;
    $('#f-module').appendChild(o);
  });
  Core.REPEATS.forEach((r) => {
    const o = document.createElement('option');
    o.value = r.id; o.textContent = r.label;
    $('#f-repeat').appendChild(o);
  });

  /* 启动 */
  store.onStatus = (st) => {
    lastStatus = st;
    $('#subline').textContent = st.text;
  };
  store.onChange = () => render();
  render();
  store.init();
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('./sw.js').catch(() => {});
  }
})();
