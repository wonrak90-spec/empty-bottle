// Production configuration — unified OCR runtime
// Individual employee + PIN session auth. No static API token.
const CONFIG = {
  API_URL: 'https://script.google.com/macros/s/AKfycbw6cRBWwrtwBiTlY6SShBRs5tFPaGwYio2xn7d3ebrBX2Eru4bNogFTiL8MM2IJ1SmUaw/exec',
  API_TOKEN: ''
};

(function bootExtensions(){
  'use strict';
  if(window.__EMPTY_BOTTLE_BOOT__)return;
  window.__EMPTY_BOTTLE_BOOT__=true;

  const RELEASE='20260921-ocr-runtime5';

  const styles=[
    'v22.css',
    'v23.css',
    'v24.css',
    'v25.css'
  ];

  // Runtime order is intentional.
  // Camera ownership:
  //   v26-korean-ocr.js = OCR engine only after final override
  //   ocr-runtime.js     = the single owner of start/live/capture/stop/refocus
  // Legacy v26-wms-cardscan.js / v26-vendor-cardscan.js stay in repo history
  // but are NOT loaded in production.
  const scripts=[
    'v22.js',
    'v24.js',
    'v25.js',
    'v26-web.js',
    'v26-qty.js',
    'v26-korean-ocr.js',
    'v26-vendor-templates.js',
    'v55-vendor-parser.js',
    'v55-wms-parser.js',
    'v55-roi-preprocess.js',
    'v55-adaptive-ocr.js',
    'ocr-runtime.js',
    'v26-production-wms.js',
    'v55-ocr-learning.js',
    'v55-wms-inbound-progress.js',
    'v26-stability.js'
  ];

  function addStyle(file){
    const id='css-'+file.replace(/[^a-z0-9]/gi,'-');
    if(document.getElementById(id))return;
    const el=document.createElement('link');
    el.id=id;el.rel='stylesheet';el.href=file+'?v='+RELEASE;
    document.head.appendChild(el);
  }

  function addScript(file){
    return new Promise((resolve,reject)=>{
      const id='js-'+file.replace(/[^a-z0-9]/gi,'-');
      const old=document.getElementById(id);
      if(old){resolve(file);return;}
      const el=document.createElement('script');
      el.id=id;el.src=file+'?v='+RELEASE;el.async=false;
      el.onload=()=>resolve(file);
      el.onerror=()=>reject(new Error(file+' 로드 실패'));
      document.body.appendChild(el);
    });
  }

  async function boot(){
    styles.forEach(addStyle);
    try{
      for(const file of scripts)await addScript(file);
      window.__EMPTY_BOTTLE_BOOT_READY__=true;
      console.info('[EMPTY-BOTTLE] runtime ready',RELEASE);
    }catch(e){
      window.__EMPTY_BOTTLE_BOOT_ERROR__=String(e&&e.message?e.message:e);
      console.error('[EMPTY-BOTTLE] runtime load failed',e);
      try{
        const id='runtimeBootError';
        let box=document.getElementById(id);
        if(!box){
          box=document.createElement('div');box.id=id;
          box.style.cssText='position:fixed;left:10px;right:10px;bottom:10px;z-index:99999;padding:10px 12px;border-radius:8px;background:#f8d7da;color:#842029;font:700 12px system-ui;';
          document.body.appendChild(box);
        }
        box.textContent='프로그램 일부 기능을 불러오지 못했습니다 · '+window.__EMPTY_BOTTLE_BOOT_ERROR__;
      }catch(_){}
    }
  }

  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',boot,{once:true});
  else boot();
})();
