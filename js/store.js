/* 数据层：通过 GitHub Contents API 读写私有数据仓库；
 * 本层不做任何 UI。改动先落到本地(localStorage)，再进 outbox 逐条同步，
 * 离线时自动排队，恢复联网后重放。 */
(function () {
  'use strict';
  const Core = window.Core;

  const K_TOKEN = 'ts_token_v1';
  const K_STATE = 'ts_state_v1';
  const K_OUTBOX = 'ts_outbox_v1';
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
        this.files[f] = { path: this.cfg.files[f], value: Core.fileDefault(f), sha: null, loaded: false };
      });
      this.onChange = null; // fn()
      this.onStatus = null; // fn({state,text,at})
      this._status = { state: 'idle', text: '未连接', at: null };
      this._timer = null;
    }

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
    _persistOutbox() { localStorage.setItem(K_OUTBOX, JSON.stringify(this._outbox())); }
    _outbox() { return this._ls(K_OUTBOX) || []; }
    _outboxFor(file) { return this._outbox().filter((o) => o.file === file); }

    /* ---------- 网络 ---------- */
    _headers(json) {
      const h = { Accept: 'application/vnd.github+json' };
      if (this.token) h.Authorization = 'Bearer ' + this.token;
      if (json) h['Content-Type'] = 'application/json';
      return h;
    }

    async _fetchRemote(file) {
      const rec = this.files[file];
      const res = await fetch(this.apiBase + rec.path, { headers: this._headers(false) });
      if (res.status === 404) {
        return { value: Core.fileDefault(file), sha: null };
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
      return { value: JSON.parse(b64decode(j.content)), sha: j.sha };
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
      return j.content ? j.content.sha : sha;
    }

    _isOffline(err) {
      if (typeof navigator !== 'undefined' && navigator.onLine === false) return true;
      return !!(err && (err instanceof TypeError || /network|fetch|load failed/i.test(err && err.message)));
    }

    /* 用远端最新值 + outbox 里的本地操作，重新物化某个文件的显示值 */
    _materialize(file) {
      let value = this.files[file].value;
      this._outboxFor(file).forEach((op) => {
        const r = Core.applyOp(file, value, op);
        value = r.value;
      });
      return value;
    }

    /* ---------- 对外操作 ---------- */
    init() {
      const saved = this._ls(K_STATE);
      if (saved) {
        ['tasks', 'checkins', 'settings'].forEach((f) => {
          if (saved[f] !== undefined) this.files[f].value = saved[f];
        });
      }
      if (this.token) this.refresh(true);
      else this.setStatus('idle', '请先在「设置」中连接 GitHub Token');
      this._timer = setInterval(() => this._heartbeat(), 20000);
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
        await Promise.all(['tasks', 'checkins', 'settings'].map(async (f) => {
          const remote = await this._fetchRemote(f);
          this.files[f].sha = remote.sha;
          this.files[f].value = remote.value;
          this.files[f].loaded = true;
        }));
        // 若还有未上传的本地操作，物化后展示，避免刷新把本地改动“刷没”
        if (this._outbox().length) {
          ['tasks', 'checkins', 'settings'].forEach((f) => {
            this.files[f].value = this._materialize(f);
          });
        }
        this._persistState();
        this.setStatus('ok', '已同步', new Date());
        if (this.onChange) this.onChange();
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
      const remote = await this._fetchRemote(op.file);
      const r = Core.applyOp(op.file, remote.value, op);
      if (!r.changed) {
        // 远端已包含该操作效果（例如另一台设备已提交），无需重复写
        this.files[op.file].sha = remote.sha;
        return false;
      }
      const sha = await this._putRemote(op.file, r.value, remote.sha);
      this.files[op.file].sha = sha;
      this.files[op.file].value = r.value;
      this.files[op.file].loaded = true;
      return true;
    }

    async flush() {
      const outbox = this._outbox();
      if (!outbox.length || !this.token) return;
      this.setStatus('syncing', '同步中…');
      let failed = false;
      while (outbox.length && !failed) {
        const op = outbox[0];
        try {
          await this._syncOne(op);
          outbox.shift();
          this._persistOutbox();
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
