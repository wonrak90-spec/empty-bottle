/* V4.6 admin-only test flag
 * Normal URL: no-op.
 * Test URL: ?v46test=1
 * Loads only after an authenticated ADMIN session exists.
 * V4.6 assets are pinned to the validated RC1 commit and served from jsDelivr,
 * which is excluded from the production service worker fetch handling.
 */
(function(){
  'use strict';
  if(window.__V46_TEST_LOADER__) return;
  window.__V46_TEST_LOADER__=true;

  const params=new URLSearchParams(location.search);
  if(params.get('v46test')!=='1') return;

  const RC1='188d382d7c1ff54e2439625cca7d939f0e0af111';
  const BASE='https://cdn.jsdelivr.net/gh/wonrak90-spec/empty-bottle@'+RC1+'/';
  const FILES=[
    'v55-vendor-parser.js',
    'v55-wms-parser.js',
    'v55-roi-preprocess.js',
    'v55-adaptive-ocr.js',
    'v55-live-assist.js',
    'v55-ocr-learning.js',
    'v55-ocr-learning-admin.js',
    'v55-ocr-learning-diagnostics.js'
  ];

  function badge(text,type){
    let el=document.getElementById('v46TestBadge');
    if(!el){
      el=document.createElement('div');
      el.id='v46TestBadge';
      el.style.cssText='position:fixed;right:10px;bottom:10px;z-index:99999;padding:9px 12px;border-radius:8px;font:700 12px/1.2 system-ui,sans-serif;box-shadow:0 2px 10px rgba(0,0,0,.18);';
      document.body.appendChild(el);
    }
    el.textContent=text;
    el.style.background=type==='ok'?'#fff3cd':(type==='bad'?'#f8d7da':'#e2e3e5');
    el.style.color='#222';
  }

  function loadOne(file){
    return new Promise((resolve,reject)=>{
      const s=document.createElement('script');
      s.src=BASE+file;
      s.async=false;
      s.crossOrigin='anonymous';
      s.onload=()=>resolve(file);
      s.onerror=()=>reject(new Error(file+' 로드 실패'));
      document.body.appendChild(s);
    });
  }

  async function activate(){
    if(window.__V46_TEST_ACTIVE__) return;
    window.__V46_TEST_ACTIVE__=true;
    badge('V4.6 TEST 로딩 중…','wait');
    try{
      for(const file of FILES) await loadOne(file);
      badge('V4.6 TEST · 관리자 전용 · 작업자 확인 필수','ok');
      document.documentElement.dataset.v46test='1';
      console.info('[V4.6 TEST] active',RC1);
    }catch(e){
      window.__V46_TEST_ACTIVE__=false;
      badge('V4.6 TEST 로드 실패 · 일반 V54 유지','bad');
      console.error('[V4.6 TEST]',e);
    }
  }

  let tries=0;
  const timer=setInterval(()=>{
    tries++;
    const v=window.V24;
    const user=v&&v.session&&v.session.user;
    if(user){
      if(user.role==='admin'){
        clearInterval(timer);
        activate();
      }else{
        clearInterval(timer);
        badge('V4.6 TEST는 관리자만 사용할 수 있습니다.','bad');
      }
    }else if(tries>=240){
      clearInterval(timer);
      badge('V4.6 TEST 대기 종료 · 다시 로그인 후 새로고침','bad');
    }
  },250);
})();
