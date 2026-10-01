/* V57.3 UI Recovery
 * 1) Fast Flow card must never cover the inspection screen.
 * 2) Live OCR runs in a camera-app style fullscreen modal using the existing OCR runtime.
 * 3) Empty-bottle sample/item photo card remains visible in Fast Flow.
 * OCR parsing/camera ownership is NOT changed here.
 */
(function(){
  'use strict';
  if(window.__V573_UI_RECOVERY__)return;
  window.__V573_UI_RECOVERY__=true;
  const $=id=>document.getElementById(id);

  function addCss(){
    if($('v571UiRecoveryStyle'))return;
    const s=document.createElement('style');
    s.id='v571UiRecoveryStyle';
    s.textContent=`
      body.v56-fast #v56FastCard{position:relative!important;inset:auto!important;bottom:auto!important;z-index:auto!important;box-shadow:none!important}
      body.v56-fast #v56ItemPhotoCard{display:block!important}

      .v22-live.v571-live-modal:not(.hidden){
        position:fixed!important;inset:0!important;z-index:26000!important;
        margin:0!important;border:0!important;border-radius:0!important;
        width:100vw!important;height:100dvh!important;max-width:none!important;
        background:#000!important;display:flex!important;flex-direction:column!important;
        overflow:hidden!important;
      }
      .v22-live.v571-live-modal .v571-live-head{
        position:relative;z-index:6;display:flex;align-items:center;justify-content:space-between;
        gap:10px;padding:12px 14px calc(10px + env(safe-area-inset-top));background:#111;color:#fff;flex:0 0 auto;
      }
      .v22-live.v571-live-modal .v571-live-title{font-size:1rem;font-weight:800}
      .v22-live.v571-live-modal .v571-live-close{border:1px solid #666;background:#222;color:#fff;border-radius:10px;padding:9px 13px;font-weight:800}
      .v22-live.v571-live-modal video{
        width:100%!important;height:auto!important;max-height:none!important;flex:1 1 auto!important;
        min-height:0!important;object-fit:cover!important;background:#000!important;
      }
      .v22-live.v571-live-modal .v22-live-hint{
        top:calc(60px + env(safe-area-inset-top))!important;left:7%!important;right:7%!important;z-index:7!important;
      }
      .v22-live.v571-live-modal .v22-guide{
        left:7%!important;right:7%!important;top:22%!important;bottom:22%!important;z-index:5!important;
        box-shadow:0 0 0 9999px rgba(0,0,0,.20)!important;
      }
      .v22-live.v571-live-modal .v22-live-actions{
        position:relative;z-index:8;flex:0 0 auto;padding:10px 12px calc(10px + env(safe-area-inset-bottom))!important;
        background:#111!important;grid-template-columns:2fr 1fr 1fr!important;
      }
      .v22-live.v571-live-modal .v22-live-actions .btn{min-height:50px!important}
      body.v571-camera-open{overflow:hidden!important;touch-action:none}
      #v56VendorDistanceBtn{font-size:1.02rem!important;min-height:58px!important;margin:8px 0!important}
      body.v56-fast .v573-vendor-live-secondary{opacity:.82;margin-top:10px!important}
      body.v56-fast .v573-vendor-live-secondary .btn{font-size:.82rem!important;min-height:42px!important}
      #v56VendorNative{font-size:.78rem!important}
      @media(max-width:620px){
        .v22-live.v571-live-modal .v22-live-actions{grid-template-columns:1fr 1fr!important}
        .v22-live.v571-live-modal .v22-live-actions .btn:first-child{grid-column:1/-1!important}
      }
    `;
    document.head.appendChild(s);
  }

  function modeLabel(mode){
    if(mode==='vendor')return '업체 라벨 실시간 인식';
    if(mode==='multi')return '기준정보 실시간 인식';
    return 'WMS 라벨 실시간 인식';
  }

  function decorate(mode){
    const wrap=$('v22LiveWrap_'+mode);
    if(!wrap||wrap.dataset.v571Decorated==='1')return;
    wrap.dataset.v571Decorated='1';
    wrap.classList.add('v571-live-modal');
    const head=document.createElement('div');
    head.className='v571-live-head';
    head.innerHTML='<div class="v571-live-title">'+modeLabel(mode)+'</div><button type="button" class="v571-live-close">닫기 ✕</button>';
    head.querySelector('button').addEventListener('click',function(){
      try{if(window.V22&&typeof V22.stopLive==='function')V22.stopLive(mode,true);}catch(_){}
      syncBody();
    });
    wrap.insertBefore(head,wrap.firstChild);
  }

  function syncBody(){
    const open=['wms','vendor','multi'].some(mode=>{
      const w=$('v22LiveWrap_'+mode);
      return !!(w&&!w.classList.contains('hidden'));
    });
    document.body.classList.toggle('v571-camera-open',open);
  }

  function watch(){
    ['wms','vendor','multi'].forEach(mode=>{
      decorate(mode);
      const w=$('v22LiveWrap_'+mode);
      if(w&&!w.__v571Observer){
        w.__v571Observer=new MutationObserver(syncBody);
        w.__v571Observer.observe(w,{attributes:true,attributeFilter:['class']});
      }
    });
    syncBody();
  }

  function renamePhotoCard(){
    const input=$('singleItemPhotoInput');
    const card=input&&input.closest('.card');
    if(!card)return;
    card.id='v56ItemPhotoCard';
    const title=card.querySelector('.step-title');
    if(title&&title.textContent.indexOf('샘플')<0){
      title.innerHTML=title.innerHTML.replace('공병 실물 사진','공병 샘플/실물 사진');
    }
  }

  function arrangeVendorUi(){
    const dist=$('v56VendorDistanceBtn');
    const vendorInput=$('vendorPhoto');
    const card=vendorInput&&vendorInput.closest('.card');
    const liveRow=card&&card.querySelector('[data-live-mode="vendor"]');
    if(!card||!dist)return;

    // Distance/high-resolution capture is the field-default action.
    dist.textContent='📷 업체라벨 확대 촬영 · 인식';
    dist.classList.add('primary');

    // Move the main capture button directly under the card title.
    const title=card.querySelector('.step-title');
    if(title&&title.nextSibling!==dist)title.insertAdjacentElement('afterend',dist);

    // Live OCR remains available, but is clearly secondary and placed lower.
    if(liveRow){
      liveRow.classList.add('v573-vendor-live-secondary');
      const b=liveRow.querySelector('[data-live-start="vendor"]');
      if(b){b.classList.remove('primary');b.classList.add('outline');b.textContent='🎥 실시간 인식 (보조)';}
      const raw=$('ocrRawVendor');
      if(raw&&raw.parentNode===card)raw.insertAdjacentElement('afterend',liveRow);
      else card.appendChild(liveRow);
    }
  }

  function init(){
    addCss();renamePhotoCard();watch();arrangeVendorUi();
    setTimeout(()=>{watch();arrangeVendorUi();},400);
    setTimeout(()=>{watch();arrangeVendorUi();},1200);
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init,{once:true});else init();
})();