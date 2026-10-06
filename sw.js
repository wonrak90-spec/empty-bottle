const CACHE = '공병입고-20261007-v58-field-safe-r7';
const SHELL = [
  './',
  './index.html',
  './app.js',
  './config.js',
  './v22.css','./v22.js',
  './v23.css',
  './v24.css','./v24.js',
  './v25.css','./v25.js',
  './v26-web.js',
  './v26-qty.js',
  './v26-korean-ocr.js',
  './v26-vendor-templates.js',
  './v55-vendor-parser.js',
  './v55-wms-parser.js',
  './v55-roi-preprocess.js',
  './v55-adaptive-ocr.js',
  './ocr-runtime.js',
  './v26-production-wms.js',
  './v55-ocr-learning.js',
  './v55-wms-inbound-progress.js',
  './v55-wms-quality.js',
  './v55-capture-assist.js',
  './v56-fast-flow.js',
  './v56-vendor-distance.js',
  './v57-1-ui-recovery.js',
  './v58-save-queue.js',
  './v58-field-safe.js',
  './v58-report-manager.js',
  './v26-stability.js',
  './manifest.json',
  './icon-192.png',
  './icon-512.png'
];

self.addEventListener('install', e => {
  e.waitUntil((async()=>{
    const c=await caches.open(CACHE);
    await Promise.all(SHELL.map(async url=>{
      try{
        const res=await fetch(url,{cache:'reload'});
        if(res.ok)await c.put(url,res);
      }catch(_){}
    }));
  })());
  self.skipWaiting();
});

self.addEventListener('activate', e => {
  e.waitUntil((async()=>{
    const keys=await caches.keys();
    await Promise.all(keys.filter(k=>k!==CACHE).map(k=>caches.delete(k)));
    await self.clients.claim();
  })());
});

function sameOriginFallbackRequest(req){
  try{
    const u=new URL(req.url);
    if(u.origin!==self.location.origin)return null;
    return u.pathname.replace(self.location.pathname.replace(/sw\.js$/,''),'./').replace(/^\//,'/');
  }catch(_){return null;}
}

self.addEventListener('fetch', e => {
  const url=e.request.url;
  if(e.request.method!=='GET')return;

  if(url.includes('unpkg.com/tesseract.js')){
    e.respondWith(new Response('',{headers:{'Content-Type':'application/javascript; charset=utf-8','Cache-Control':'no-store'}}));
    return;
  }
  if(url.includes('script.google.com')||url.includes('unpkg.com')||url.includes('cdn.jsdelivr.net')||url.includes('paddle-model-ecology.bj.bcebos.com'))return;

  e.respondWith((async()=>{
    const cache=await caches.open(CACHE);
    try{
      const fresh=await fetch(e.request,{cache:'no-store'});
      if(fresh&&fresh.ok){
        try{await cache.put(e.request,fresh.clone());}catch(_){}
        return fresh;
      }
      throw new Error('bad response');
    }catch(err){
      const exact=await cache.match(e.request);
      if(exact)return exact;

      // If a versioned URL is unavailable, fall back only to the CURRENT
      // release shell asset from the current cache. Old caches are removed at activate.
      try{
        const u=new URL(e.request.url);
        if(u.origin===self.location.origin){
          const noQuery=u.pathname.split('/').pop();
          const shell=await cache.match('./'+noQuery);
          if(shell)return shell;
        }
      }catch(_){}
      throw err;
    }
  })());
});
