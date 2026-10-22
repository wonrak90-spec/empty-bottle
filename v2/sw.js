/* R15 서비스워커: 앱 파일은 단말에 보관해 바로 열고(버전이 바뀔 때만 새로 받음),
 * 서버(Apps Script) 요청은 절대 보관하지 않는다. */
const VERSION = 'r15-20261022-2';
const FILES = ['./', 'index.html', 'app.css', 'config.js', 'core.js', 'queue.js', 'inspect.js', 'lot.js', 'records.js', 'zoomcam.js', 'report.js', 'admin.js', 'dash.js', 'app.js', 'manifest.json',
  'ocr/legacy-parsers.js', 'ocr/v26-qty.js', 'ocr/v26-korean-ocr.js', 'ocr/v26-vendor-templates.js', 'ocr/v55-vendor-parser.js', 'ocr/v55-wms-parser.js',
  'ocr/v55-roi-preprocess.js', 'ocr/v55-adaptive-ocr.js', 'ocr/ocr.js'];
self.addEventListener('install', (e) => { e.waitUntil(caches.open(VERSION).then((c) => c.addAll(FILES.map((f) => new Request(f, { cache: 'reload' }))) /* 브라우저 HTTP 캐시의 옛 파일을 담지 않게 */).then(() => self.skipWaiting())); });
self.addEventListener('activate', (e) => { e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k.startsWith('r15-') && k !== VERSION).map((k) => caches.delete(k)))).then(() => self.clients.claim())); });
self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== self.location.origin) return; // 서버·CDN은 브라우저에 맡긴다
  e.respondWith(caches.match(e.request, { ignoreSearch: true }).then((hit) => hit || fetch(e.request)));
});
