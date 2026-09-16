const CACHE = '공병입고-v30';
const SHELL = ['./', './index.html', './app.js', './config.js', './manifest.json', './icon-192.png', './icon-512.png'];

self.addEventListener('install', e => {
  e.waitUntil((async () => {
    const c = await caches.open(CACHE);
    // 브라우저가 들고 있는 예전 파일을 쓰지 않도록 항상 새로 받아온다
    await Promise.all(SHELL.map(async url => {
      try {
        const res = await fetch(url, { cache: 'reload' });
        if (res.ok) await c.put(url, res);
      } catch (err) { /* 일부 실패해도 설치는 진행 */ }
    }));
  })());
  self.skipWaiting();
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
  );
  self.clients.claim();
});

// 앱 껍데기(HTML/CSS/JS)만 캐시하고, Apps Script API 호출이나 CDN 스크립트는 항상 네트워크를 우선합니다.
self.addEventListener('fetch', e => {
  const url = e.request.url;
  if (url.includes('script.google.com') || url.includes('unpkg.com')) return;

  // 앱 파일은 네트워크를 먼저 시도하고, 실패할 때만 캐시를 쓴다 (업데이트 누락 방지)
  e.respondWith((async () => {
    try {
      const fresh = await fetch(e.request);
      if (fresh && fresh.ok) {
        const c = await caches.open(CACHE);
        c.put(e.request, fresh.clone());
        return fresh;
      }
      throw new Error('bad response');
    } catch (err) {
      const cached = await caches.match(e.request);
      if (cached) return cached;
      throw err;
    }
  })());
});
