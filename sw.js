/* 离线缓存 Service Worker：只缓存本站静态资源，绝不缓存 GitHub 数据请求 */
'use strict';
const CACHE = 'task-sync-v26';
const ASSETS = [
  './',
  './index.html',
  './css/style.css',
  './js/config.js',
  './js/core.js',
  './js/store.js',
  './js/app.js',
  './manifest.webmanifest',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/apple-touch-icon.png'
];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE).then((c) => c.addAll(ASSETS)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== location.origin) return; // GitHub API 走网络，不缓存
  if (req.mode === 'navigate') {
    /* 关键：GitHub Pages 的 HTML 带 10 分钟浏览器缓存，直接 fetch 可能拿到旧页面，
     * 于是「刷新了还是旧版本」。加 no-store 强制每次都取最新的 HTML。 */
    e.respondWith(fetch(req, { cache: 'no-store' }).catch(() => caches.match('./index.html')));
    return;
  }
  e.respondWith(
    caches.match(req).then((hit) => {
      if (hit) return hit;
      return fetch(req).then((res) => {
        if (res.ok && /\.(css|js|png|json)$/.test(url.pathname)) {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(req, copy));
        }
        return res;
      });
    })
  );
});
