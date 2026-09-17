/* V26 공통 안정화 레이어
 * - 카메라/스캐너 정리
 * - Legacy Tesseract 호출 차단
 * - 조회 상세 사진출력 시 다중선택 보존
 */
(function(){
  'use strict';
  if(window.__V26_STABILITY__)return;
  window.__V26_STABILITY__=true;

  const S=window.V26Stability={VERSION:'V26-STABILITY-1',cleaning:false};

  // 운영에서는 Tesseract를 로드하지 않는다. 남아있는 legacy 호출이 발생해도 외부 라이브러리를 요구하지 않게 한다.
  window.getOcrWorker=async function(){
    return {
      setParameters:async()=>{},
      recognize:async()=>{throw new Error('Legacy OCR 비활성화 · 한국어 로컬 OCR을 사용하세요.');}
    };
  };

  S.stopAllCameras=function(){
    if(S.cleaning)return;
    S.cleaning=true;
    try{
      try{if(typeof stopScanner==='function'){const p=stopScanner();if(p&&typeof p.catch==='function')p.catch(()=>{});}}catch(_){}
      try{if(window.V22&&typeof V22.stopLive==='function')V22.stopLive('wms',false);}catch(_){}
      try{if(window.V22&&typeof V22.stopLive==='function')V22.stopLive('vendor',false);}catch(_){}
      try{if(window.V22&&typeof V22.stopLive==='function')V22.stopLive('multi',false);}catch(_){}
      try{if(window.V26ProdWms&&typeof V26ProdWms.stop==='function')V26ProdWms.stop();}catch(_){}
      document.querySelectorAll('video').forEach(v=>{
        try{
          const s=v.srcObject;
          if(s&&typeof s.getTracks==='function')s.getTracks().forEach(t=>t.stop());
          v.srcObject=null;
        }catch(_){}
      });
    }finally{S.cleaning=false;}
  };

  function patchTab(){
    const old=window.showTab;
    if(typeof old!=='function'||old.__v26stability)return;
    const fn=function(tab){
      S.stopAllCameras();
      return old(tab);
    };
    fn.__v26stability=true;
    window.showTab=fn;
  }

  async function printCurrent(withPhotos){
    if(!window.V22||typeof V22.printSelected!=='function')return;
    const rec=(typeof currentViewRecord!=='undefined'&&currentViewRecord)?currentViewRecord:null;
    if(!rec||!rec.record)return;
    const saved=new Set(V22.selectedIds);
    try{
      V22.selectedIds.clear();
      V22.selectedIds.add(String(rec.record.id));
      await V22.printSelected(!!withPhotos);
    }finally{
      V22.selectedIds.clear();
      saved.forEach(id=>V22.selectedIds.add(id));
      const el=document.getElementById('v23SelectedCount');
      if(el)el.textContent='선택 '+V22.selectedIds.size+'건';
      document.querySelectorAll('.v22-record-check').forEach(ch=>ch.checked=V22.selectedIds.has(String(ch.value)));
    }
  }

  function patchCurrentPrint(){
    if(!window.V22||typeof V22.printSelected!=='function')return;
    V22.printCurrentWithPhotos=function(){return printCurrent(true);};
    window.printCurrentViewRecord=function(){return printCurrent(false);};
  }

  function init(){
    patchTab();patchCurrentPrint();
    setTimeout(()=>{patchTab();patchCurrentPrint();},800);
    document.addEventListener('visibilitychange',()=>{if(document.hidden)S.stopAllCameras();});
    window.addEventListener('pagehide',S.stopAllCameras);
    window.addEventListener('beforeunload',S.stopAllCameras);
    console.info('[V26-STABILITY-1] camera/view safeguards active');
  }

  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init,{once:true});else init();
})();