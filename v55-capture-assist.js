/* V55 Capture Assist V1.1
 * Full-label evidence stays off the main page and is viewed in a fullscreen modal.
 * Close-up recapture uses an in-page fullscreen camera modal and only supplements
 * missing/clearly invalid OCR fields; valid values are never blindly overwritten.
 */
(function(){
  'use strict';
  if(window.__V55_CAPTURE_ASSIST__)return;
  window.__V55_CAPTURE_ASSIST__=true;

  const C=window.V55CaptureAssist={VERSION:'V55-CAPTURE-ASSIST-1.2.1'};
  const $=id=>document.getElementById(id);
  const digits=v=>String(v==null?'':v).replace(/[^0-9]/g,'');
  const val=id=>$(id)?$(id).value.trim():'';
  const set=(id,v)=>{const el=$(id);if(el&&v!=null)el.value=String(v);};
  let modalMode='wms',modalStream=null,zoomTrack=null;

  function fullPhoto(mode){
    // The current evidence buffer is authoritative. It is cleared after save/reset.
    // A hidden preview may still carry the previous pallet's src, so never use it.
    try{
      if(typeof lastPhotoDataUrl!=='undefined'&&lastPhotoDataUrl&&lastPhotoDataUrl[mode])
        return lastPhotoDataUrl[mode];
    }catch(_){}
    try{
      const pv=$(mode==='vendor'?'vendorPreview':'wmsPreview');
      if(pv&&pv.src&&!pv.classList.contains('hidden'))return pv.src;
    }catch(_){}
    return '';
  }
  function currentYearPrefix(){return String(new Date().getFullYear()).slice(-2);}
  function saneManagement(v){
    const d=digits(v);
    return d.length===8&&d.slice(0,2)===currentYearPrefix();
  }
  function saneRange(a,b){
    const x=Number(digits(a)),y=Number(digits(b));
    return x>0&&y>0&&x<=y&&y<=9999;
  }
  function severeQtyMismatch(a,b){
    a=Number(digits(a));b=Number(digits(b));
    if(!a||!b||a===b)return false;
    const hi=Math.max(a,b),lo=Math.min(a,b);
    return (lo<100&&hi>=1000)||(hi/Math.max(1,lo)>=5);
  }

  function mergeWms(p){
    p=p||{};
    const changed=[];
    const oldInbound=val('inboundNo');
    if(p.inboundNo&&(!oldInbound||(!saneManagement(oldInbound)&&saneManagement(p.inboundNo)))){
      set('inboundNo',p.inboundNo);changed.push('관리번호');
    }
    const oldFrom=val('containerFrom'),oldTo=val('containerTo');
    if(p.containerFrom&&p.containerTo&&saneRange(p.containerFrom,p.containerTo)&&!saneRange(oldFrom,oldTo)){
      set('containerFrom',p.containerFrom);set('containerTo',p.containerTo);changed.push('Pallet 순번');
    }
    const oldQty=val('displayQty'),vendorQty=val('vQty');
    if(p.displayQty&&(!oldQty||(severeQtyMismatch(oldQty,vendorQty)&&digits(p.displayQty)===digits(vendorQty)))){
      set('displayQty',p.displayQty);changed.push('WMS 수량');
      if(!val('actualQty'))set('actualQty',p.displayQty);
    }
    const fillOnly=[
      ['inboundDate','inboundDate','입고일자'],['product','product','품명'],
      ['itemCode','itemCode','품목코드'],['manufacturer','manufacturer','제조원'],
      ['supplier','supplier','공급업체'],['unit','unit','단위'],
      ['expiryDate','expiryDate','사용기한'],['codeRaw','codeRaw','코드']
    ];
    for(const [id,key,label] of fillOnly){
      if(p[key]&&!val(id)){set(id,p[key]);changed.push(label);}
    }
    try{if(typeof updateSingleQty==='function')updateSingleQty();}catch(_){}
    try{if(typeof compareLabels==='function')compareLabels();}catch(_){}
    try{if(window.V55InboundProgress&&typeof V55InboundProgress.refresh==='function')V55InboundProgress.refresh();}catch(_){}
    try{if(window.V55WmsQuality&&typeof V55WmsQuality.render==='function')V55WmsQuality.render();}catch(_){}
    return changed;
  }

  function mergeVendor(p){
    p=p||{};
    const changed=[],wmsQty=val('displayQty');
    const fillOnly=[
      ['vProduct','product','품명'],['vProdDate','prodDate','생산일자'],
      ['vProdTime','prodTime','생산시간'],['vLotNo','lotNo','Lot No.'],
      ['vPalletNo','palletNo','Pallet No.'],['vLine','line','생산라인']
    ];
    for(const [id,key,label] of fillOnly){
      if(p[key]&&!val(id)){set(id,p[key]);changed.push(label);}
    }
    const oldQty=val('vQty');
    if(p.qty&&(!oldQty||(severeQtyMismatch(oldQty,wmsQty)&&digits(p.qty)===digits(wmsQty)))){
      set('vQty',p.qty);changed.push('업체 수량');
    }
    try{if(typeof compareLabels==='function')compareLabels();}catch(_){}
    try{if(window.V55WmsQuality&&typeof V55WmsQuality.render==='function')V55WmsQuality.render();}catch(_){}
    return changed;
  }

  function injectStyle(){
    if($('v55CaptureAssistStyle'))return;
    const s=document.createElement('style');s.id='v55CaptureAssistStyle';
    s.textContent=`
      #wmsPreview,#vendorPreview{display:none!important}
      .v55-photo-view-btn{margin-top:8px}
      #v55CaptureModal{position:fixed;inset:0;z-index:20000;background:rgba(0,0,0,.94);display:none;flex-direction:column;color:#fff}
      #v55CaptureModal.open{display:flex}
      #v55CaptureModal .v55m-head{display:flex;align-items:center;justify-content:space-between;padding:14px 14px 10px;gap:10px}
      #v55CaptureModal .v55m-title{font-size:1rem;font-weight:800}
      #v55CaptureModal .v55m-close{border:1px solid rgba(255,255,255,.4);background:transparent;color:#fff;border-radius:9px;padding:8px 12px;font-weight:700}
      #v55CaptureModal .v55m-stage{position:relative;flex:1;min-height:0;display:flex;align-items:center;justify-content:center;overflow:hidden;background:#000}
      #v55CaptureModal video,#v55CaptureModal img{width:100%;height:100%;object-fit:contain}
      #v55CaptureModal .v55m-guide{position:absolute;left:8%;right:8%;top:24%;bottom:24%;border:2px solid rgba(255,255,255,.85);border-radius:14px;box-shadow:0 0 0 9999px rgba(0,0,0,.16);pointer-events:none}
      #v55CaptureModal .v55m-guide span{position:absolute;top:-31px;left:0;right:0;text-align:center;font-size:.78rem;font-weight:700;text-shadow:0 1px 3px #000}
      #v55CaptureModal .v55m-foot{padding:12px 14px calc(12px + env(safe-area-inset-bottom));background:#111}
      #v55CaptureModal .v55m-status{font-size:.78rem;line-height:1.45;margin-bottom:10px;color:#eee}
      #v55CaptureModal .v55m-zoom{display:none;align-items:center;gap:9px;margin:8px 0 12px}
      #v55CaptureModal .v55m-zoom.show{display:flex}
      #v55CaptureModal .v55m-zoom input{flex:1}
      #v55CaptureModal .v55m-actions{display:grid;grid-template-columns:1fr 1fr;gap:8px}
      #v55CaptureModal .v55m-actions button{min-height:48px;border-radius:10px;border:0;font-weight:800}
      #v55CaptureModal .v55m-shot{background:#fff;color:#111}
      #v55CaptureModal .v55m-fallback{background:#2a2a2a;color:#fff;border:1px solid #555!important}
      @media (max-width:600px){#v55CaptureModal .v55m-stage{min-height:52vh}}
    `;
    document.head.appendChild(s);
  }

  function injectModal(){
    if($('v55CaptureModal'))return;
    const m=document.createElement('div');m.id='v55CaptureModal';
    m.innerHTML=`
      <div class="v55m-head">
        <div class="v55m-title" id="v55ModalTitle">라벨 사진</div>
        <button type="button" class="v55m-close" id="v55ModalClose">닫기 ✕</button>
      </div>
      <div class="v55m-stage">
        <video id="v55ModalVideo" playsinline muted autoplay></video>
        <img id="v55ModalImage" alt="라벨 사진" style="display:none">
        <div class="v55m-guide" id="v55ModalGuide"><span>작은 글자 영역을 이 안에 크게 맞춰주세요</span></div>
      </div>
      <div class="v55m-foot">
        <div class="v55m-status" id="v55ModalStatus">카메라 준비 중...</div>
        <div class="v55m-zoom" id="v55ModalZoomWrap">
          <span>확대</span><input id="v55ModalZoom" type="range"><span id="v55ModalZoomValue"></span>
        </div>
        <div class="v55m-actions" id="v55ModalActions">
          <button type="button" class="v55m-shot" id="v55ModalShot">촬영 · 인식</button>
          <button type="button" class="v55m-fallback" id="v55ModalFallback">기본 카메라로 촬영</button>
        </div>
      </div>
    `;
    document.body.appendChild(m);
    $('v55ModalClose').onclick=C.closeModal;
    $('v55ModalShot').onclick=C.captureModal;
    $('v55ModalFallback').onclick=()=>{
      C.closeModal();
      const input=$(modalMode==='vendor'?'vendorZoomPhoto':'wmsZoomPhoto');
      if(input)input.click();
    };
    $('v55CaptureModal').addEventListener('click',e=>{if(e.target===m)C.closeModal();});
  }

  function stopModalStream(){
    if(modalStream){try{modalStream.getTracks().forEach(t=>t.stop());}catch(_){}modalStream=null;}
    zoomTrack=null;
    const v=$('v55ModalVideo');if(v)v.srcObject=null;
  }

  function setModalStatus(t){const e=$('v55ModalStatus');if(e)e.textContent=t;}
  function showModal(kind){
    const m=$('v55CaptureModal');if(!m)return;
    m.classList.add('open');document.body.style.overflow='hidden';
    const view=kind==='view';
    $('v55ModalVideo').style.display=view?'none':'block';
    $('v55ModalImage').style.display=view?'block':'none';
    $('v55ModalGuide').style.display=view?'none':'block';
    $('v55ModalActions').style.display=view?'none':'grid';
    $('v55ModalZoomWrap').classList.remove('show');
  }

  C.closeModal=function(){
    stopModalStream();
    const m=$('v55CaptureModal');if(m)m.classList.remove('open');
    document.body.style.overflow='';
  };

  C.view=function(mode){
    mode=mode==='vendor'?'vendor':'wms';
    const src=fullPhoto(mode),statusId=mode==='vendor'?'vendorStatus':'wmsStatus';
    if(!src){setStatus(statusId,'확인할 촬영사진이 없습니다. 먼저 전체 라벨을 촬영하세요.','warn');return;}
    modalMode=mode;showModal('view');
    $('v55ModalTitle').textContent=(mode==='vendor'?'업체 라벨':'WMS 입고라벨')+' · 촬영사진';
    $('v55ModalImage').src=src;
    setModalStatus('전체 라벨 증빙사진입니다. 확대해서 확인할 수 있습니다.');
  };

  async function setupZoom(track){
    const wrap=$('v55ModalZoomWrap'),range=$('v55ModalZoom'),out=$('v55ModalZoomValue');
    wrap.classList.remove('show');zoomTrack=null;
    try{
      const caps=track&&track.getCapabilities?track.getCapabilities():{};
      if(!caps||!caps.zoom||!Number.isFinite(caps.zoom.min)||!Number.isFinite(caps.zoom.max)||caps.zoom.max<=caps.zoom.min)return;
      zoomTrack=track;
      range.min=String(caps.zoom.min);range.max=String(caps.zoom.max);
      range.step=String(caps.zoom.step||0.1);
      const current=(track.getSettings&&track.getSettings().zoom)||caps.zoom.min;
      range.value=String(current);out.textContent=Number(current).toFixed(1)+'×';
      range.oninput=async()=>{
        const z=Number(range.value);out.textContent=z.toFixed(1)+'×';
        try{await track.applyConstraints({advanced:[{zoom:z}]});}catch(_){}
      };
      wrap.classList.add('show');
    }catch(_){}
  }

  C.open=async function(mode){
    mode=mode==='vendor'?'vendor':'wms';
    const statusId=mode==='vendor'?'vendorStatus':'wmsStatus';
    if(!fullPhoto(mode)){
      setStatus(statusId,'확대 촬영은 보완용입니다. 먼저 전체 라벨을 한 번 촬영하세요.','warn');
      return;
    }
    modalMode=mode;
    try{if(window.OCRRuntime&&typeof OCRRuntime.stopAll==='function')OCRRuntime.stopAll();}catch(_){}
    showModal('capture');
    $('v55ModalTitle').textContent=(mode==='vendor'?'업체 라벨':'WMS 입고라벨')+' · 확대 재촬영';
    setModalStatus('작은 글자 부분이 화면의 60~80%를 차지하도록 정면으로 맞춰주세요.');
    try{
      let stream;
      try{
        stream=await navigator.mediaDevices.getUserMedia({
          video:{facingMode:{ideal:'environment'},width:{ideal:1920},height:{ideal:1080}},audio:false
        });
      }catch(_){
        stream=await navigator.mediaDevices.getUserMedia({video:{facingMode:'environment'},audio:false});
      }
      modalStream=stream;
      const video=$('v55ModalVideo');video.srcObject=stream;await video.play();
      const track=stream.getVideoTracks&&stream.getVideoTracks()[0];
      try{
        const caps=track&&track.getCapabilities?track.getCapabilities():{};
        if(caps&&Array.isArray(caps.focusMode)&&caps.focusMode.includes('continuous'))
          await track.applyConstraints({advanced:[{focusMode:'continuous'}]});
      }catch(_){}
      await setupZoom(track);
      if(!$('v55ModalZoomWrap').classList.contains('show'))
        setModalStatus('확대 제어를 지원하지 않는 기기입니다. 휴대폰을 가까이 이동해 작은 글자를 크게 맞춘 뒤 촬영하세요.');
    }catch(e){
      setModalStatus('웹 카메라를 열지 못했습니다. 아래 "기본 카메라로 촬영"을 사용하세요. · '+String(e&&e.message?e.message:e));
    }
  };

  async function recognizeCloseup(dataUrl,mode){
    const statusId=mode==='vendor'?'vendorStatus':'wmsStatus';
    if(!window.OCRRuntime||typeof OCRRuntime.recognize!=='function')throw new Error('OCR 엔진이 아직 준비되지 않았습니다.');
    const r=await OCRRuntime.recognize(dataUrl,mode,statusId);
    return mode==='vendor'?mergeVendor(r.parsed):mergeWms(r.parsed);
  }

  C.captureModal=async function(){
    const video=$('v55ModalVideo');
    if(!video||!video.videoWidth){setModalStatus('카메라 화면이 아직 준비되지 않았습니다.');return;}
    const canvas=document.createElement('canvas');
    canvas.width=video.videoWidth;canvas.height=video.videoHeight;
    canvas.getContext('2d').drawImage(video,0,0,canvas.width,canvas.height);
    const dataUrl=canvas.toDataURL('image/jpeg',0.94);
    setModalStatus('확대사진 OCR 처리 중...');
    $('v55ModalShot').disabled=true;
    try{
      const changed=await recognizeCloseup(dataUrl,modalMode);
      const statusId=modalMode==='vendor'?'vendorStatus':'wmsStatus';
      if(changed.length){
        const msg='확대 재촬영 보완 완료 · '+changed.join(', ')+' 반영 · 전체 라벨 증빙사진은 유지됩니다.';
        setModalStatus(msg);setStatus(statusId,msg,'ok');
        setTimeout(()=>C.closeModal(),700);
      }else{
        const msg='안전하게 보완할 새 항목을 찾지 못했습니다. 더 가까이 촬영하거나 직접 확인하세요.';
        setModalStatus(msg);setStatus(statusId,msg,'warn');
      }
    }catch(e){
      const msg='확대 재촬영 OCR 실패 · '+String(e&&e.message?e.message:e);
      setModalStatus(msg);setStatus(modalMode==='vendor'?'vendorStatus':'wmsStatus',msg,'bad');
    }finally{
      $('v55ModalShot').disabled=false;
    }
  };

  async function readFile(file){
    if(typeof fileToDataUrl!=='function')throw new Error('사진 처리 기능이 준비되지 않았습니다.');
    return await fileToDataUrl(file);
  }

  C.zoomSelected=async function(event,mode){
    mode=mode==='vendor'?'vendor':'wms';
    const input=event&&event.target,file=input&&input.files&&input.files[0];
    if(input)input.value='';if(!file)return;
    const statusId=mode==='vendor'?'vendorStatus':'wmsStatus';
    if(!fullPhoto(mode)){setStatus(statusId,'먼저 전체 라벨을 1회 촬영하세요.','warn');return;}
    setStatus(statusId,'확대사진 정밀 OCR 중 · 기존 정상값은 유지합니다.','warn');
    try{
      const changed=await recognizeCloseup(await readFile(file),mode);
      setStatus(statusId,changed.length
        ?'확대 재촬영 보완 완료 · '+changed.join(', ')+' 반영 · 전체 라벨 증빙사진은 유지됩니다.'
        :'확대사진에서도 안전하게 보완할 새 항목을 찾지 못했습니다.',
        changed.length?'ok':'warn');
    }catch(e){setStatus(statusId,'확대 재촬영 OCR 실패 · '+String(e&&e.message?e.message:e),'bad');}
  };

  function addInput(mode,card){
    const id=mode==='vendor'?'vendorZoomPhoto':'wmsZoomPhoto';if($(id))return;
    const input=document.createElement('input');input.id=id;input.type='file';input.accept='image/*';
    input.setAttribute('capture','environment');input.className='hidden';input.onchange=e=>C.zoomSelected(e,mode);card.appendChild(input);
  }

  function addButtons(mode,card){
    const zoomId=mode==='vendor'?'btnVendorZoomRecapture':'btnWmsZoomRecapture';
    const viewId=mode==='vendor'?'btnVendorPhotoView':'btnWmsPhotoView';
    const status=$(mode==='vendor'?'vendorStatus':'wmsStatus');
    if(!$(viewId)){
      const view=document.createElement('button');view.type='button';view.id=viewId;view.className='btn outline v55-photo-view-btn';
      view.textContent='🖼 촬영사진 보기';view.onclick=()=>C.view(mode);
      if(status)card.insertBefore(view,status);else card.appendChild(view);
    }
    if(!$(zoomId)){
      const zoom=document.createElement('button');zoom.type='button';zoom.id=zoomId;zoom.className='btn outline';
      zoom.textContent='🔍 확대 재촬영';zoom.onclick=()=>C.open(mode);
      const note=document.createElement('div');note.className='status';note.style.marginTop='8px';note.style.fontSize='.75rem';
      note.textContent=mode==='vendor'
        ?'작은 Pallet No./수량이 안 읽힐 때만 확대 팝업 사용 · 정상값과 전체 라벨 사진은 유지'
        :'관리번호/용기번호 등 작은 글자가 안 읽힐 때만 확대 팝업 사용 · 정상값과 전체 라벨 사진은 유지';
      if(status){card.insertBefore(zoom,status);card.insertBefore(note,status);}else{card.appendChild(zoom);card.appendChild(note);}
    }
  }

  function ensureLivePrimary(){
    try{
      if(window.V22&&typeof V22.ensureLiveUi==='function')V22.ensureLiveUi();
    }catch(_){}
    for(const mode of ['wms','vendor']){
      const row=document.querySelector('[data-live-mode="'+mode+'"]');
      const input=$(mode==='vendor'?'vendorPhoto':'wmsPhoto');
      const card=input&&input.closest?input.closest('.card'):null;
      const title=card&&card.querySelector?card.querySelector('.step-title'):null;
      if(row&&card&&title){
        // Live OCR is the default workflow. Keep it immediately below the card title.
        if(title.nextSibling!==row)card.insertBefore(row,title.nextSibling);
        const start=row.querySelector('[data-live-start="'+mode+'"]');
        if(start){
          start.classList.remove('outline');
          start.classList.add('primary');
          start.textContent='🎥 '+(mode==='vendor'?'업체 라벨':'WMS 라벨')+' 실시간 인식 (기본)';
        }
      }
    }
  }

  function renameBaseButtons(){
    const w=document.querySelector('button[onclick*="wmsPhoto"][onclick*="click"]');
    if(w&&/라벨 촬영/.test(w.textContent))w.textContent='📷 전체 라벨 촬영';
    const v=document.querySelector('button[onclick*="vendorPhoto"][onclick*="click"]');
    if(v&&/업체 라벨 촬영/.test(v.textContent))v.textContent='📷 전체 라벨 촬영';
  }

  function watchPreview(mode){
    const pv=$(mode==='vendor'?'vendorPreview':'wmsPreview');if(!pv||pv.__v55Watched)return;
    pv.__v55Watched=true;
    try{new MutationObserver(()=>{}).observe(pv,{attributes:true,attributeFilter:['src']});}catch(_){}
  }

  function polish(){
    ensureLivePrimary();
    renameBaseButtons();
    const w=$('wmsPhoto'),v=$('vendorPhoto');
    if(w){const card=w.closest('.card');if(card){addInput('wms',card);addButtons('wms',card);}watchPreview('wms');}
    if(v){const card=v.closest('.card');if(card){addInput('vendor',card);addButtons('vendor',card);}watchPreview('vendor');}
  }

  C._test={saneManagement,saneRange,severeQtyMismatch,mergeWms,mergeVendor,fullPhoto};

  function boot(){
    injectStyle();injectModal();polish();
    // Runtime/UI scripts are loaded dynamically. Re-assert the live-first layout
    // several times so a slow phone cannot lose the primary live OCR controls.
    setTimeout(polish,250);setTimeout(polish,700);setTimeout(polish,1600);setTimeout(polish,3200);
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',boot,{once:true});else boot();
})();