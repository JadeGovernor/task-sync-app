/* 站点与数据仓库配置。
 * owner/repo 指向「私有数据仓库」；这里的代码本身托管在公开的 task-sync-app 仓库。
 * 如你改过仓库名，只需改这一处。 */
window.TS_CONFIG = {
  version: '23',            // 发新版时改这里（和 index.html 的 ?v=、sw.js 的缓存名一起）
  owner: 'JadeGovernor',
  repo: 'task-sync',
  files: {
    tasks: 'tasks.json',
    checkins: 'checkins.json',
    settings: 'settings.json'
  },
  defaults: {
    wakeTime: '06:30',
    sleepTime: '22:30',
    wakeEnabled: true,
    sleepEnabled: true
  }
};
