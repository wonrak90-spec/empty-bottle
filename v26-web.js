/* V26 Web UI V4
 * UI-only layer.
 * OCR engine and camera lifecycle are owned by:
 *   v26-korean-ocr.js + ocr-runtime.js
 * This file must not override OCR/camera functions.
 */
(function(){
  'use strict';
  if(window.__EMPTY_BOTTLE_V26_WEB__)return;
  window.__EMPTY_BOTTLE_V26_WEB__=true;

  const $=id=>document.getElementById(id);
  const V26W=window.V26W=window.V26W||{};
  V26W.VERSION='V26-WEB-UI-4';

  // V56 fast flow collapses the detail cards (#v56WmsDetailCard etc.) with
  // `body.v56-fast{display:none}`. Manual entry must open them first, or the
  // scroll/focus lands on an invisible field and 직접 입력 looks dead.
  function revealDetail(){
    try{
      if(document.body.classList.contains('v56-fast')&&
         !document.body.classList.contains('v56-show-detail')){
        if(window.V56FastFlow&&typeof V56FastFlow.showDetail==='function')V56FastFlow.showDetail(true);
        else document.body.classList.add('v56-show-detail');
      }
    }catch(_){}
  }

  function scrollToField(id){
    revealDetail();
    const el=$(id);if(!el)return;
    const go=()=>{
      el.scrollIntoView({behavior:'smooth',block:'center'});
      setTimeout(()=>{try{el.focus();}catch(_){}},250);
    };
    // Let the reveal reflow before measuring scroll position.
    requestAnimationFrame(()=>requestAnimationFrame(go));
  }

  V26W.manualWms=function(){
    try{if(window.V22&&typeof V22.stopLive==='function')V22.stopLive('wms',false);}catch(_){}
    if(typeof setStatus==='function')setStatus('wmsStatus','직접 입력 모드 · 아래 WMS 입고정보를 입력하세요.','warn');
    scrollToField('inboundNo');
  };

  V26W.manualVendor=function(){
    try{if(window.V22&&typeof V22.stopLive==='function')V22.stopLive('vendor',false);}catch(_){}
    if(typeof setStatus==='function')setStatus('vendorStatus','직접 입력 모드 · 아래 업체 라벨 정보를 입력하세요.','warn');
    scrollToField('vProduct');
  };

  function createActionGrid(mode,card){
    const id='v26Actions_'+mode;
    if($(id)||!card)return;
    const isVendor=mode==='vendor';
    const wrap=document.createElement('div');
    wrap.id=id;
    wrap.style.cssText='display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:10px;';
    wrap.innerHTML=
      '<button type="button" class="btn primary" onclick="V22.startLive(\''+mode+'\')">🎥 자동 인식</button>'+
      '<button type="button" class="btn outline" onclick="document.getElementById(\''+(isVendor?'vendorPhoto':'wmsPhoto')+'\').click()">📷 사진 촬영</button>'+
      '<button type="button" class="btn outline" onclick="document.getElementById(\''+(isVendor?'vendorPhotoGallery':'wmsPhotoGallery')+'\').click()">🖼 갤러리</button>'+
      '<button type="button" class="btn outline" onclick="V26W.'+(isVendor?'manualVendor':'manualWms')+'()">✍ 직접 입력</button>';
    const title=card.querySelector('.step-title');
    if(title)title.insertAdjacentElement('afterend',wrap);
    else card.insertBefore(wrap,card.firstChild);
  }

  function simplifySingleUi(){
    const single=$('single');if(!single)return;
    // Identify the cards by an element that only ever lives inside them.
    // Positional indexing breaks as soon as another layer prepends a card to
    // #single (v55-wms-inbound-progress.js does exactly that, after this file
    // has loaded), which made the 400ms/1500ms re-runs apply the vendor
    // hide-rules to the WMS card and hide WMS 자동 인식 / 갤러리.
    const wmsAnchor=$('wmsPhoto'),vendorAnchor=$('vendorPhoto');
    const wmsCard=wmsAnchor&&wmsAnchor.closest?wmsAnchor.closest('.card'):null;
    const vendorCard=vendorAnchor&&vendorAnchor.closest?vendorAnchor.closest('.card'):null;
    if(!wmsCard||!vendorCard)return;

    const scan=$('btnScanSingle');if(scan)scan.classList.add('hidden');
    const reader=$('readerWrapSingle');if(reader)reader.classList.add('hidden');

    if(wmsCard){
      Array.from(wmsCard.querySelectorAll('button')).forEach(b=>{
        if(b.closest('#v26Actions_wms')||b.closest('#v26Actions_vendor'))return;
        if(b.id==='btnScanSingle'||/라벨 촬영|갤러리|실시간|자동 인식|직접 입력|코드 없음/.test(b.textContent||''))b.classList.add('hidden');
      });
      createActionGrid('wms',wmsCard);
    }

    if(vendorCard){
      Array.from(vendorCard.querySelectorAll('button')).forEach(b=>{
        if(b.closest('#v26Actions_wms')||b.closest('#v26Actions_vendor'))return;
        if(/업체 라벨 촬영|갤러리|실시간|자동 인식|카메라 중지/.test(b.textContent||''))b.classList.add('hidden');
      });
      createActionGrid('vendor',vendorCard);
    }

    // V22 live controls remain in DOM for video/guide elements, but the old
    // duplicate button rows are hidden. ocr-runtime.js owns their behavior.
    single.querySelectorAll('.v22-action-row').forEach(row=>row.classList.add('hidden'));

    const code=$('codeRaw');
    if(code){const field=code.closest('.field');if(field)field.classList.add('hidden');}
    const manual=$('v22ManualSingle');if(manual)manual.classList.add('hidden');

    const wst=$('wmsStatus');
    if(wst&&!wst.dataset.v26ui){wst.dataset.v26ui='1';wst.textContent='WMS 라벨 자동 인식 또는 사진 OCR을 사용하세요.';}
    const vst=$('vendorStatus');
    if(vst&&!vst.dataset.v26ui){vst.dataset.v26ui='1';vst.textContent='업체 라벨 자동 인식 또는 사진 OCR을 사용하세요.';}
  }

  function init(){
    simplifySingleUi();
    setTimeout(simplifySingleUi,400);
    setTimeout(simplifySingleUi,1500);
    console.info('[V26-WEB-UI-4] UI-only layer active');
  }

  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init,{once:true});
  else init();
})();
