/* R15 서비스워커: 앱 파일은 단말에 보관해 바로 열고(버전이 바뀔 때만 새로 받음),
 * 서버(Apps Script) 요청은 절대 보관하지 않는다. */
const VERSION = 'r15-20261030-5';
const FILES = ['./', 'index.html', 'app.css', 'config.js', 'core.js', 'queue.js', 'inspect.js', 'lines.js', 'lot.js', 'records.js', 'zoomcam.js', 'report.js', 'admin.js', 'dash.js', 'app.js', 'manifest.json', 'icon-192.png', 'icon-512.png',
  'ocr/legacy-parsers.js', 'ocr/v26-qty.js', 'ocr/v26-korean-ocr.js', 'ocr/v26-vendor-templates.js', 'ocr/v55-vendor-parser.js', 'ocr/v55-wms-parser.js',
  'ocr/v55-roi-preprocess.js', 'ocr/v55-adaptive-ocr.js', 'ocr/ocr.js'];
self.addEventListener('install', (e) => { e.waitUntil(caches.open(VERSION).then((c) => c.addAll(FILES.map((f) => new Request(f, { cache: 'reload' }))) /* 브라우저 HTTP 캐시의 옛 파일을 담지 않게 */).then(() => self.skipWaiting())); });
self.addEventListener('activate', (e) => { e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k.startsWith('r15-') && k !== VERSION).map((k) => caches.delete(k)))).then(() => self.clients.claim())); });
// 글자 인식 엔진·모델(약 18MB)은 버전과 상관없이 한 번 받으면 단말에 둔다. 브라우저 캐시가 비워져 앱을 열 때마다 다시 받던 것을 막는다.
const OCR_CACHE = 'ocr-models-v1', OCR_HOSTS = ['cdn.jsdelivr.net', 'paddle-model-ecology.bj.bcebos.com'];
self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method === 'GET' && OCR_HOSTS.indexOf(url.hostname) >= 0) {
    e.respondWith(caches.open(OCR_CACHE).then((c) => c.match(e.request).then((hit) => hit || fetch(e.request).then((res) => { if (res && res.ok && res.type !== 'opaque') c.put(e.request, res.clone()).catch(() => {}); return res; }))));
    return;
  }
  if (e.request.method !== 'GET' || url.origin !== self.location.origin) return; // 서버(Apps Script)는 브라우저에 맡긴다
  e.respondWith(caches.match(e.request, { ignoreSearch: true }).then((hit) => hit || fetch(e.request)));
});
