/* 数据层：通过 GitHub Contents API 读写私有数据仓库；
 * 本层不做任何 UI。改动先落到本地(localStorage)，再进 outbox 逐条同步，
 * 离线时自动排队，恢复联网后重放。 */
(function () {
  'use strict';
  const Core = window.Core;

  const K_TOKEN = 'ts_token_v1';
  const K_STATE = 'ts_state_v2';
  const K_OUTBOX = 'ts_outbox_v2';
  const K_DEVICE = 'ts_device_v1';

  function b64encode(str) {
    const bytes = new TextEncoder().encode(str);
    let bin = '';
    for (let i = 0; i < bytes.length; i += 0x8000) {
      bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    }
    return btoa(bin);
  }
  function b64decode(b64) {
    const bin = atob(b64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return new TextDecoder('utf-8').decode(bytes);
  }

  class Store {
    constructor(config) {
      this.cfg = config || window.TS_CONFIG;
      this.apiBase = 'https://api.github.com/repos/' + this.cfg.owner + '/' + this.cfg.repo + '/contents/';
      this.files = {};
      ['tasks', 'checkins', 'settings'].forEach((f) => {
        this.files[f] = { path: this.cfg.files[f], value: Core.fileDefault(f), sha: null, etag: null, loaded: false };
      });
      this.onChange = null; // fn()
      this.onStatus = null; // fn({state,text,at})
      this._status = { state: 'idle', text: '未连接', at: null };
      this._timer = null;
      /* 每个文件的「本地写入版本号」。refresh 用它判断手里这份远端快照是否已经过期：
       * 请求飞行期间本地只要写过一次，这份快照就不能再用来覆盖本地。 */
      this._revs = { tasks: 0, checkins: 0, settings: 0 };
      this._flushing = null;   // 同一时刻只允许一次 flush，避免同一个操作被推两遍
    }

    _touch(file) { this._revs[file] = (this._revs[file] || 0) + 1; }

    /* ---------- 本地存储 ---------- */
    _ls(key, val) {
      if (val === undefined) {
        try { return JSON.parse(localStorage.getItem(key)); } catch (e) { return null; }
      }
      localStorage.setItem(key, JSON.stringify(val));
    }
    get token() { return localStorage.getItem(K_TOKEN) || ''; }
    set token(t) {
      if (t) localStorage.setItem(K_TOKEN, t);
      else localStorage.removeItem(K_TOKEN);
    }
    get deviceId() {
      let id = localStorage.getItem(K_DEVICE);
      if (!id) {
        id = Core.uid('dev');
        localStorage.setItem(K_DEVICE, id);
      }
      return id;
    }
    get deviceGuess() {
      const ua = navigator.userAgent || '';
      if (/iPhone/.test(ua)) return 'iPhone';
      if (/iPad/.test(ua)) return 'iPad';
      if (/Mac/.test(ua)) return 'Mac';
      if (/Android/.test(ua)) return 'Android';
      return '设备';
    }

    setStatus(state, text, at) {
      this._status = { state, text, at: at || this._status.at };
      if (this.onStatus) this.onStatus(this._status);
    }

    _persistState() {
      const s = {};
      ['tasks', 'checkins', 'settings'].forEach((f) => { s[f] = this.files[f].value; });
      localStorage.setItem(K_STATE, JSON.stringify(s));
    }
    _persistOutbox(list) {
      localStorage.setItem(K_OUTBOX, JSON.stringify(list || this._outbox()));
    }
    /* 把已经成功推送的操作从队列里摘掉；期间新入队的操作必须原样留着 */
    _dropFromOutbox(doneIds) {
      const rest = this._outbox().filter((o) => !doneIds.has(o._id));
      localStorage.setItem(K_OUTBOX, JSON.stringify(rest));
    }
    _outbox() { return this._ls(K_OUTBOX) || []; }
    _outboxFor(file) { return this._outbox().filter((o) => o.file === file); }

    /* ---------- 网络 ---------- */
    _headers(json) {
      const h = { Accept: 'application/vnd.github+json' };
      if (this.token) h.Authorization = 'Bearer ' + this.token;
      if (json) h['Content-Type'] = 'application/json';
      return h;
    }

    async _fetchRemote(file, conditional) {
      const rec = this.files[file];
      const headers = this._headers(false);
      if (conditional && rec.etag) headers['If-None-Match'] = rec.etag;
      const res = await fetch(this.apiBase + rec.path, { headers });
      // 304：远端没变，直接复用本地副本。GitHub 对 304 不计速率配额。
      if (res.status === 304) {
        return { value: rec.value, sha: rec.sha, etag: rec.etag, notModified: true };
      }
      if (res.status === 404) {
        return { value: Core.fileDefault(file), sha: null, etag: null };
      }
      if (!res.ok) {
        let msg = 'HTTP ' + res.status;
        try {
          const j = await res.json();
          if (j && j.message) msg = j.message;
        } catch (e) { /* ignore */ }
        const err = new Error(msg);
        err.status = res.status;
        throw err;
      }
      const j = await res.json();
      return { value: JSON.parse(b64decode(j.content)), sha: j.sha, etag: res.headers.get('ETag') };
    }

    async _putRemote(file, value, sha, message) {
      const rec = this.files[file];
      const body = {
        message: message || ('同步 ' + file),
        content: b64encode(JSON.stringify(value)),
        sha: sha || undefined
      };
      const res = await fetch(this.apiBase + rec.path, {
        method: 'PUT',
        headers: this._headers(true),
        body: JSON.stringify(body)
      });
      if (!res.ok) {
        let msg = 'HTTP ' + res.status;
        try {
          const j = await res.json();
          if (j && j.message) msg = j.message;
        } catch (e) { /* ignore */ }
        const err = new Error(msg);
        err.status = res.status;
        throw err;
      }
      const j = await res.json();
      if (rec) {
        rec.sha = j.content ? j.content.sha : sha;
        rec.etag = null; // 内容已变，下次拉取必须完整取一次以拿到新 ETag
        this._touch(file); // 远端刚变过，之前发出的 GET 结果一律作废
      }
      return j.content ? j.content.sha : sha;
    }

    _isOffline(err) {
      if (typeof navigator !== 'undefined' && navigator.onLine === false) return true;
      return !!(err && (err instanceof TypeError || /network|fetch|load failed/i.test(err && err.message)));
    }

    /* 把某个文件「还没上传成功」的本地操作，叠到任意一份基底值上 */
    _materializeFrom(base, file) {
      let value = base;
      this._outboxFor(file).forEach((op) => {
        const r = Core.applyOp(file, value, op);
        value = r.value;
      });
      return value;
    }
    /* 当前本地值 + 尚未上传的操作 */
    _materialize(file) { return this._materializeFrom(this.files[file].value, file); }

    /* ---------- 对外操作 ---------- */
    init() {
      /* 一次性迁移：旧版本的待上传队列从不清空，里面堆着几个月来早已同步成功的历史操作。
       * 这些操作被重放时，会把别的设备后来改的内容盖回旧值（删掉的习惯复活、新写的琐事消失），
       * 所以升级到本版后把旧队列整段丢掉，以远端为准重新同步。 */
      const legacy = this._outbox();
      if (legacy.some((o) => o && o._id == null)) localStorage.removeItem(K_OUTBOX);
      const saved = this._ls(K_STATE);
      if (saved) {
        ['tasks', 'checkins', 'settings'].forEach((f) => {
          if (saved[f] !== undefined) this.files[f].value = saved[f];
        });
      }
      if (this.token) this.refresh(true);
      else this.setStatus('idle', '请先在「设置」中连接 GitHub Token');
      this._timer = setInterval(() => this._heartbeat(), 5000);
      if (typeof window !== 'undefined') {
        window.addEventListener('online', () => {
          this.setStatus('syncing', '网络恢复，正在同步…');
          this.flush().then(() => this.refresh(false));
        });
        document.addEventListener('visibilitychange', () => {
          if (!document.hidden && this.token) this.refresh(false);
        });
      }
      return this;
    }

    async _heartbeat() {
      if (!this.token) return;
      if (this._outbox().length) await this.flush();
      else if (typeof document === 'undefined' || !document.hidden) await this.refresh(false).catch(() => {});
    }

    async refresh(silent) {
      if (!this.token) return;
      if (!silent) this.setStatus('syncing', '同步中…');
      try {
        let changed = false;
        await Promise.all(['tasks', 'checkins', 'settings'].map(async (f) => {
          const rec = this.files[f];
          const revAtStart = this._revs[f] || 0;
          // 只有本地已有一份完整副本时才带 ETag：命中即 304，省流量也省速率配额
          const remote = await this._fetchRemote(f, rec.loaded && !!rec.etag);
          if (remote.notModified) return;
          // 这次请求还在路上时，本地又写过东西（或刚往远端推过一条）：
          // 手里这份快照可能已经是旧的，直接丢给下一轮，绝不用它盖掉刚写的内容。
          if ((this._revs[f] || 0) !== revAtStart) return;
          // 远端最新值 + 还没上传成功的本地操作 = 应该显示的内容
          const merged = this._materializeFrom(remote.value, f);
          const before = JSON.stringify(rec.value);
          rec.etag = remote.etag || null;
          rec.sha = remote.sha;
          rec.value = merged;
          rec.loaded = true;
          if (before !== JSON.stringify(merged)) changed = true;
        }));
        this._persistState();
        this.setStatus('ok', '已同步', new Date());
        if (changed && this.onChange) this.onChange();
      } catch (err) {
        if (this._isOffline(err)) {
          this.setStatus('offline', '离线模式：改动已存本地，联网后自动同步');
        } else {
          this.setStatus('error', err.message, new Date());
        }
        throw err;
      }
    }

    async _syncOne(op) {
      const rec = this.files[op.file];
      const remote = await this._fetchRemote(op.file);
      const r = Core.applyOp(op.file, remote.value, op);
      if (!r.changed) {
        // 远端已包含该操作效果（例如另一台设备已提交），无需重复写
        rec.sha = remote.sha;
        rec.loaded = true;
        return false;
      }
      const sha = await this._putRemote(op.file, r.value, remote.sha);
      rec.sha = sha;
      rec.loaded = true;
      // 推送期间用户可能又写了几条，要在「远端 + 本条」的基础上接着叠，不能丢
      rec.value = this._materializeFrom(r.value, op.file);
      return true;
    }

    async flush() {
      if (!this.token) return;
      if (this._flushing) return this._flushing;   // 已经有一次在跑，别重复推
      this._flushing = this._doFlush();
      try { return await this._flushing; } finally { this._flushing = null; }
    }

    async _doFlush() {
      const outbox = this._outbox();
      if (!outbox.length) return;
      // 旧版本留下的操作没有 _id，补一个，否则摘不干净会一直重放
      let patched = false;
      outbox.forEach((o) => { if (o._id == null) { o._id = Core.uid('op'); patched = true; } });
      if (patched) this._persistOutbox(outbox);
      this.setStatus('syncing', '同步中…');
      const doneIds = new Set();
      let failed = false;
      for (let i = 0; i < outbox.length && !failed; i++) {
        const op = outbox[i];
        try {
          await this._syncOne(op);
          doneIds.add(op._id);
          this._dropFromOutbox(doneIds);   // 推成功一条就摘一条，期间新入队的原样保留
        } catch (err) {
          failed = true;
          if (this._isOffline(err)) {
            this.setStatus('offline', '离线模式：改动已存本地，联网后自动同步');
          } else {
            this.setStatus('error', err.message, new Date());
          }
        }
      }
      if (!failed) {
        this._persistState();
        this.setStatus('ok', '已同步', new Date());
        if (this.onChange) this.onChange();
      }
    }

    /* 本地立刻应用一条操作并进入同步队列 */
    _mutate(op) {
      const rec = this.files[op.file];
      const r = Core.applyOp(op.file, rec.value, op);
      if (!r.changed) return false;
      rec.value = r.value;
      rec.loaded = true;
      this._touch(op.file);
      op._id = op._id || Core.uid('op');
      op.at = op.at || new Date().toISOString();   // 操作发起时间：删除要比对谁更新
      const outbox = this._outbox();
      outbox.push(op);
      localStorage.setItem(K_OUTBOX, JSON.stringify(outbox));
      this._persistState();
      if (this.onChange) this.onChange();
      this.flush();
      return true;
    }

    saveTask(task) {
      task.updatedAt = new Date().toISOString();
      return this._mutate({ file: 'tasks', type: 'task_set', task });
    }
    deleteTask(id) {
      return this._mutate({ file: 'tasks', type: 'task_delete', id });
    }
    setRanks(ranks) {
      return this._mutate({ file: 'tasks', type: 'rank_set', ranks });
    }
    setChecked(date, ids) {
      return this._mutate({ file: 'checkins', type: 'checkin_set', date, ids });
    }
    patchSettings(patch) {
      patch.updatedAt = new Date().toISOString();
      return this._mutate({ file: 'settings', type: 'settings_patch', deviceId: this.deviceId, patch });
    }

    clearLocal() {
      localStorage.removeItem(K_STATE);
      localStorage.removeItem(K_OUTBOX);
      ['tasks', 'checkins', 'settings'].forEach((f) => {
        this.files[f].value = Core.fileDefault(f);
        this.files[f].sha = null;
        this.files[f].loaded = false;
      });
      if (this.onChange) this.onChange();
    }

    async testConnection() {
      if (!this.token) throw new Error('请先粘贴 Token');
      const remote = await this._fetchRemote('settings');
      this.files.settings.sha = remote.sha;
      this.files.settings.value = remote.value;
      this.files.settings.loaded = true;
      this._persistState();
      return true;
    }
  }

  window.Store = Store;
})();
