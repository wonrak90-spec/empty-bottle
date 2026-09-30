/* V56 Vendor Distance Capture V1
 * Vendor labels are 2~3m above the operator on loaded vehicles.
 * Do not depend on live OCR. Use one high-resolution still capture in a
 * fullscreen web camera, lock invariant product/qty per WMS group after the
 * first verified pallet, and use later photos as evidence + background mismatch detection.
 */
(function(){
  'use strict';
  if(window.__V56_VENDOR_DISTANCE__)return;
  window.__V56_VENDOR_DISTANCE__=true;

  const D=window.V56VendorDistance={
    VERSION:'V56-VENDOR-DISTANCE-1.1',
    stream:null,track:null,mode:'capture',busy:false,
    evidence:false,mismatch:false,currentKey:''
  };
  const $=id=>document.getElementById(id);
  const val=id=>$(id)?$(id).value.trim():'';
  const digits=v=>String(v==null?'':v).replace(/[^0-9]/g,'');
  const STORE='v56.vendorLocks.v2';
  function palletMeta(){
    const from=Number(digits(val('containerFrom'))||0),to=Number(digits(val('containerTo'))||0);
    return {current:from,total:to,isLast:!!(from&&to&&from===to)};
  }

  function norm(s){
    try{if(typeof normProductName==='function')return normProductName(s);}catch(_){}
    return String(s||'').toLowerCase().replace(/[()（）\s\-_.]/g,'');
  }
  function productSame(a,b){
    const x=norm(a),y=norm(b);
    return !!(x&&y&&(x===y||x.includes(y)||y.includes(x)));
  }
  function key(){
    const a=val('inboundNo'),b=val('itemCode');
    return a&&b?a+'|'+b:'';
  }
  function loadAll(){
    try{return JSON.parse(localStorage.getItem(STORE)||'{}')||{};}catch(_){return {};}
  }
  function saveAll(x){
    try{localStorage.setItem(STORE,JSON.stringify(x||{}));}catch(_){}
  }
  function getLock(k){
    k=k||key();if(!k)return null;
    const x=loadAll()[k];
    return x&&x.vendorProduct?x:null;
  }
  function setLock(k,lock){
    if(!k||!lock)return;
    const all=loadAll();all[k]=lock;saveAll(all);
  }
  function clearLock(k){
    k=k||key();if(!k)return;
    const all=loadAll();delete all[k];saveAll(all);
  }
  D.getLock=getLock;
  D.clearLock=clearLock;
  D.evidenceReady=()=>!!D.evidence;
  D.hasMismatch=()=>!!D.mismatch;
  D.palletMeta=palletMeta;

  function setFast(text,type){
    try{
      const el=$('v56FastStatus');
      if(el){el.textContent=text;el.className='status'+(type?' '+type:'');}
    }catch(_){}
  }
  function setVendorStatus(text,type){
    try{if(typeof setStatus==='function')setStatus('vendorStatus',text,type||'');}catch(_){}
  }

  function ensureStyle(){
    if($('v56VendorDistanceStyle'))return;
    const s=document.createElement('style');s.id='v56VendorDistanceStyle';
    s.textContent=`
      #v56VendorDistanceModal{position:fixed;inset:0;z-index:24000;background:#050505;color:#fff;display:none;flex-direction:column}
      #v56VendorDistanceModal.open{display:flex}
      .v56vd-head{display:flex;align-items:center;justify-content:space-between;padding:12px 14px;gap:10px}
      .v56vd-title{font-size:1rem;font-weight:800}
      .v56vd-close{background:transparent;color:#fff;border:1px solid #666;border-radius:9px;padding:8px 12px;font-weight:700}
      .v56vd-stage{position:relative;flex:1;min-height:0;background:#000;overflow:hidden}
      .v56vd-stage video,.v56vd-stage img{width:100%;height:100%;object-fit:contain;display:block}
      .v56vd-guide{position:absolute;left:6%;right:6%;top:18%;bottom:18%;border:3px solid rgba(255,255,255,.95);border-radius:14px;box-shadow:0 0 0 9999px rgba(0,0,0,.18);pointer-events:none}
      .v56vd-guide:before{content:'업체라벨 전체를 이 안에 크게 맞춰주세요';position:absolute;top:-31px;left:0;right:0;text-align:center;font:800 13px/1.2 system-ui;text-shadow:0 1px 3px #000}
      .v56vd-foot{background:#111;padding:10px 14px calc(12px + env(safe-area-inset-bottom))}
      .v56vd-lock{padding:8px 10px;border-radius:8px;background:#202020;font-size:.78rem;line-height:1.4;margin-bottom:8px}
      .v56vd-status{font-size:.8rem;line-height:1.45;margin-bottom:10px}
      .v56vd-zoom{display:none;align-items:center;gap:8px;margin:8px 0 10px}
      .v56vd-zoom.show{display:flex}.v56vd-zoom input{flex:1}
      .v56vd-actions{display:grid;grid-template-columns:2fr 1fr;gap:8px}
      .v56vd-actions button{min-height:52px;border-radius:10px;font-weight:800;border:0}
      #v56VendorShot{background:#fff;color:#111;font-size:1rem}
      #v56VendorNative{background:#292929;color:#fff;border:1px solid #555}
      #v56VendorDistanceBtn{margin-top:8px}
      body.v56-fast [data-live-mode="vendor"]{display:none!important}
    `;
    document.head.appendChild(s);
  }

  function ensureModal(){
    if($('v56VendorDistanceModal'))return;
    const m=document.createElement('div');m.id='v56VendorDistanceModal';
    m.innerHTML=`
      <div class="v56vd-head">
        <div class="v56vd-title">업체라벨 원거리 촬영</div>
        <button type="button" class="v56vd-close" id="v56VendorClose">닫기 ✕</button>
      </div>
      <div class="v56vd-stage">
        <video id="v56VendorVideo" autoplay muted playsinline></video>
        <div class="v56vd-guide"></div>
      </div>
      <div class="v56vd-foot">
        <div class="v56vd-lock" id="v56VendorLockInfo">기준정보 확인 중...</div>
        <div class="v56vd-status" id="v56VendorDistanceStatus">카메라 준비 중...</div>
        <div class="v56vd-zoom" id="v56VendorZoomWrap">
          <span>확대</span><input id="v56VendorZoom" type="range"><span id="v56VendorZoomValue"></span>
        </div>
        <div class="v56vd-actions">
          <button type="button" id="v56VendorShot">📷 촬영 · 확인</button>
          <button type="button" id="v56VendorNative">기본 카메라</button>
        </div>
      </div>
    `;
    document.body.appendChild(m);
    $('v56VendorClose').onclick=D.close;
    $('v56VendorShot').onclick=D.capture;
    $('v56VendorNative').onclick=()=>{
      D.close();
      const inp=$('vendorPhoto');if(inp)inp.click();
    };
  }

  function modalStatus(t){const e=$('v56VendorDistanceStatus');if(e)e.textContent=t;}
  function renderLock(){
    const e=$('v56VendorLockInfo');if(!e)return;
    const k=key(),lock=getLock(k),pm=palletMeta();
    if(lock)e.textContent='제품명 LOCK · '+lock.vendorProduct+(lock.vendorQty?' / 일반 Pallet '+Number(digits(lock.vendorQty)).toLocaleString():' / 일반 Pallet 수량 미확정')+' · '+(pm.isLast?'마지막 Pallet → 실제 수량 재확인':'현재 Pallet 기준정보 확인');
    else e.textContent='최초 기준확인 · 업체라벨을 확대 촬영해 제품명/수량을 읽고 WMS와 일치하면 기준으로 고정합니다.';
  }

  function stop(){
    if(D.stream){try{D.stream.getTracks().forEach(t=>t.stop());}catch(_){}D.stream=null;}
    D.track=null;
    const v=$('v56VendorVideo');if(v){try{v.pause();}catch(_){}v.srcObject=null;}
  }
  D.close=function(){
    stop();
    const m=$('v56VendorDistanceModal');if(m)m.classList.remove('open');
    document.body.style.overflow='';
  };

  async function setupZoom(track){
    const wrap=$('v56VendorZoomWrap'),range=$('v56VendorZoom'),out=$('v56VendorZoomValue');
    wrap.classList.remove('show');
    try{
      const caps=track&&track.getCapabilities?track.getCapabilities():{};
      const z=caps&&caps.zoom;
      if(!z||!Number.isFinite(z.min)||!Number.isFinite(z.max)||z.max<=z.min)return;
      range.min=z.min;range.max=z.max;range.step=z.step||0.1;
      let start=Math.max(z.min,Math.min(z.max,2));
      try{await track.applyConstraints({advanced:[{zoom:start}]});}catch(_){}
      range.value=start;out.textContent=Number(start).toFixed(1)+'×';
      range.oninput=async()=>{
        const n=Number(range.value);out.textContent=n.toFixed(1)+'×';
        try{await track.applyConstraints({advanced:[{zoom:n}]});}catch(_){}
      };
      wrap.classList.add('show');
    }catch(_){}
  }

  D.open=async function(){
    ensureStyle();ensureModal();
    D.currentKey=key();D.evidence=false;D.mismatch=false;
    renderLock();
    try{if(window.OcrRuntime&&typeof OcrRuntime.stopAll==='function')OcrRuntime.stopAll(false);}catch(_){}
    const m=$('v56VendorDistanceModal');m.classList.add('open');document.body.style.overflow='hidden';
    modalStatus('업체라벨 확대 사진촬영 · 실시간 OCR은 사용하지 않습니다. 라벨 전체를 흰 프레임 안에 크게 맞춘 뒤 촬영하세요.');
    try{
      if(!navigator.mediaDevices||!navigator.mediaDevices.getUserMedia)throw new Error('카메라를 사용할 수 없습니다.');
      const tries=[
        {video:{facingMode:{ideal:'environment'},width:{ideal:3840},height:{ideal:2160}},audio:false},
        {video:{facingMode:{ideal:'environment'},width:{ideal:2560},height:{ideal:1440}},audio:false},
        {video:{facingMode:{ideal:'environment'},width:{ideal:1920},height:{ideal:1080}},audio:false}
      ];
      let stream,last;
      for(const q of tries){try{stream=await navigator.mediaDevices.getUserMedia(q);break;}catch(e){last=e;}}
      if(!stream)throw last||new Error('카메라 시작 실패');
      D.stream=stream;D.track=stream.getVideoTracks()[0]||null;
      const video=$('v56VendorVideo');video.srcObject=stream;await video.play();
      try{
        const caps=D.track&&D.track.getCapabilities?D.track.getCapabilities():{};
        const adv={};
        if(Array.isArray(caps.focusMode)&&caps.focusMode.includes('continuous'))adv.focusMode='continuous';
        if(Array.isArray(caps.exposureMode)&&caps.exposureMode.includes('continuous'))adv.exposureMode='continuous';
        if(Object.keys(adv).length)await D.track.applyConstraints({advanced:[adv]});
      }catch(_){}
      await setupZoom(D.track);
      if(!$('v56VendorZoomWrap').classList.contains('show'))
        modalStatus('라벨 전체를 프레임 안에 맞춘 뒤 촬영하세요. 이 기기는 웹 줌 제어를 제공하지 않아 가능한 한 카메라를 라벨 방향으로 가까이 맞춰주세요.');
    }catch(e){
      modalStatus('웹 카메라 시작 실패 · 기본 카메라 버튼을 사용하세요. · '+String(e&&e.message?e.message:e));
    }
  };

  async function blobData(blob){
    return await new Promise((resolve,reject)=>{
      const fr=new FileReader();fr.onload=()=>resolve(String(fr.result||''));fr.onerror=()=>reject(fr.error||new Error('사진 변환 실패'));fr.readAsDataURL(blob);
    });
  }
  async function still(){
    if(D.track&&typeof ImageCapture!=='undefined'){
      try{
        const ic=new ImageCapture(D.track);
        if(ic&&typeof ic.takePhoto==='function'){
          const blob=await ic.takePhoto();
          if(blob)return await blobData(blob);
        }
      }catch(_){}
    }
    const v=$('v56VendorVideo');if(!v||!v.videoWidth)throw new Error('카메라 화면이 준비되지 않았습니다.');
    const c=document.createElement('canvas');c.width=v.videoWidth;c.height=v.videoHeight;
    c.getContext('2d',{alpha:false}).drawImage(v,0,0,c.width,c.height);
    return c.toDataURL('image/jpeg',.96);
  }

  async function cropForOcr(dataUrl){
    return await new Promise(resolve=>{
      const img=new Image();
      img.onload=()=>{
        const sx=Math.round(img.width*.055),sy=Math.round(img.height*.16);
        const sw=Math.round(img.width*.89),sh=Math.round(img.height*.68);
        const scale=Math.min(3,2800/Math.max(1,sw));
        const c=document.createElement('canvas');
        c.width=Math.max(1,Math.round(sw*scale));c.height=Math.max(1,Math.round(sh*scale));
        const x=c.getContext('2d',{alpha:false});x.fillStyle='#fff';x.fillRect(0,0,c.width,c.height);
        x.drawImage(img,sx,sy,sw,sh,0,0,c.width,c.height);
        resolve(c.toDataURL('image/jpeg',.96));
      };
      img.onerror=()=>resolve(dataUrl);img.src=dataUrl;
    });
  }

  function applyLocked(lock){
    if(!lock)return;
    const p=$('vProduct'),q=$('vQty');
    if(p)p.value=lock.vendorProduct||'';
    if(q&&lock.vendorQty)q.value=lock.vendorQty;
    try{if(typeof compareLabels==='function')compareLabels();}catch(_){}
  }

  async function firstCapture(full,k,pm){
    const crop=await cropForOcr(full);
    if(!window.OcrRuntime||typeof OcrRuntime.recognize!=='function')throw new Error('OCR 엔진이 준비되지 않았습니다.');
    const r=await OcrRuntime.recognize(crop,'vendor','vendorStatus');
    // Apply OCR values but keep the full-resolution full-frame photo as evidence.
    await OcrRuntime.apply('vendor',r,full,'업체라벨 원거리 사진 OCR 완료');
    try{if(typeof compareLabels==='function')compareLabels();}catch(_){}
    let ok=false;
    try{ok=(typeof singleMatchOk!=='undefined'&&singleMatchOk===true);}catch(_){}
    const vp=val('vProduct'),vq=val('vQty');
    if(ok&&vp&&vq){
      setLock(k,{vendorProduct:vp,vendorQty:pm.isLast?'':vq,createdAt:new Date().toISOString()});
      D.evidence=true;D.mismatch=false;
      renderLock();
      return {ok:true,locked:true};
    }
    return {ok:false,locked:false};
  }

  async function laterCapture(full,lock){
    // Speed path: evidence is available immediately and invariant values are reused.
    try{
      if(typeof lastPhotoDataUrl!=='undefined'){lastPhotoDataUrl.vendor=full;}
    }catch(_){}
    applyLocked(lock);
    D.evidence=false;D.mismatch=false;
    try{
      if(window.V56FastFlow&&typeof V56FastFlow.noteEvidence==='function')V56FastFlow.noteEvidence('vendor',full);
    }catch(_){}
    try{window.dispatchEvent(new CustomEvent('v56:vendor-evidence',{detail:{key:D.currentKey,locked:true}}));}catch(_){}

    // Background OCR is a mismatch detector only. It never blocks because text is unreadable.
    (async()=>{
      try{
        if(!window.OcrRuntime||typeof OcrRuntime.recognize!=='function')throw new Error('OCR 엔진 미준비');
        const crop=await cropForOcr(full);
        const r=await OcrRuntime.recognize(crop,'vendor','');
        const p=r&&r.parsed||{};
        if(!p.product&&!p.qty)throw new Error('Unreadable vendor label');
        const qty=p.qty?digits(p.qty):'',expected=digits(lock.vendorQty);
        const name=p.product||'';
        const positiveMismatch=(qty&&expected&&qty!==expected)||(name&&!productSame(name,lock.vendorProduct));
        if(positiveMismatch){
          D.mismatch=true;
          if(name&&$('vProduct'))$('vProduct').value=name;
          if(qty&&$('vQty'))$('vQty').value=qty;
          try{if(typeof compareLabels==='function')compareLabels();}catch(_){}
          setVendorStatus('⚠ 업체라벨 배경확인에서 기준정보와 다른 값이 읽혔습니다. 상세 확인이 필요합니다.','bad');
          setFast('⚠ 업체라벨 기준 불일치 가능 · 정상 저장을 중단하고 상세 확인하세요.','bad');
          try{window.dispatchEvent(new CustomEvent('v56:vendor-mismatch',{detail:{parsed:p,lock}}));}catch(_){}
        }
      }catch(_){setVendorStatus('업체라벨 OCR 미확인 · 상세 확인 필요','warn');D.mismatch=true;}
      finally{D.evidence=!D.mismatch;try{if(window.V56FastFlow)V56FastFlow.refresh();}catch(_){}}
    })();
    return {ok:true,locked:true};
  }

  D.capture=async function(){
    if(D.busy)return;D.busy=true;
    const btn=$('v56VendorShot');if(btn)btn.disabled=true;
    modalStatus('고해상도 사진 확보 중...');
    try{
      const full=await still();
      try{
        if(typeof lastPhotoDataUrl!=='undefined'){lastPhotoDataUrl.vendor=full;}
        const pv=$('vendorPreview');if(pv){pv.src=full;pv.classList.remove('hidden');}
      }catch(_){}
      const k=key();D.currentKey=k;
      const lock=getLock(k),pm=palletMeta();
      if(lock&&pm.isLast){
        modalStatus('마지막 Pallet · 업체라벨 수량을 실제값으로 다시 확인합니다...');
        const crop=await cropForOcr(full);
        if(!window.OcrRuntime||typeof OcrRuntime.recognize!=='function')throw new Error('OCR 엔진이 준비되지 않았습니다.');
        const r=await OcrRuntime.recognize(crop,'vendor','vendorStatus');
        await OcrRuntime.apply('vendor',r,full,'마지막 Pallet 업체라벨 수량 확인 완료');
        const observed=val('vProduct');
        D.mismatch=!!(observed&&!productSame(observed,lock.vendorProduct));
        D.evidence=!!val('vQty')&&!D.mismatch;
        try{if(typeof compareLabels==='function')compareLabels();}catch(_){}
        setVendorStatus(D.evidence?'마지막 Pallet · 실제 수량 확인 완료':'마지막 Pallet · 제품명/수량 확인 필요',D.evidence?'ok':'warn');
        setFast(D.evidence?'마지막 Pallet 판정 결과를 확인하세요.':'마지막 Pallet 판독 미완료 · 정상 저장 중단',D.evidence?'ok':'warn');
        setTimeout(()=>D.close(),500);
      }else if(lock&&lock.vendorQty){
        modalStatus('기준정보 재사용 · 사진 저장 후 백그라운드로 이상 여부를 확인합니다.');
        await laterCapture(full,lock);
        setVendorStatus('업체라벨 사진 확보 완료 · 기준 제품명/수량 재사용 · 백그라운드 확인 중','ok');
        setFast('업체라벨 사진 확보 완료 · 실물 이상이 없으면 정상 확인·저장하세요.','ok');
        setTimeout(()=>D.close(),350);
      }else{
        modalStatus('제품명/일반 Pallet 수량 OCR 후 기준정보를 확인합니다...');
        const out=await firstCapture(full,k,pm);
        if(out.ok){
          if(pm.isLast){
            setVendorStatus('첫 촬영이 마지막 Pallet입니다 · 제품명은 확인했지만 일반 Pallet 수량은 LOCK하지 않습니다.','ok');
          } else {
            setVendorStatus('업체라벨 확인 완료 · 제품명/일반 Pallet 수량 기준 LOCK','ok');
          }
          setFast(pm.isLast?'제품명 기준 유지 · 마지막 Pallet 수량은 별도 확인':'업체 기준정보 LOCK 완료 · 정상 확인·저장 가능합니다.','ok');
          setTimeout(()=>D.close(),500);
        }else{
          D.evidence=true;
          setVendorStatus('첫 업체라벨 OCR 결과가 WMS와 자동 일치하지 않습니다. 상세 확인 후 기준을 확정하세요.','warn');
          setFast('첫 업체라벨 기준 확정 필요 · 상세 확인하세요.','warn');
        }
      }
      try{if(window.V56FastFlow&&typeof V56FastFlow.refresh==='function')V56FastFlow.refresh();}catch(_){}
    }catch(e){
      modalStatus('촬영 실패 · '+String(e&&e.message?e.message:e));
      setVendorStatus('업체라벨 원거리 촬영 실패 · 기본 카메라 촬영을 사용하세요.','bad');
    }finally{
      D.busy=false;if(btn)btn.disabled=false;
    }
  };

  D.resetForNext=function(){
    D.evidence=false;D.mismatch=false;D.currentKey='';
  };

  function addButton(){
    if($('v56VendorDistanceBtn'))return;
    const vendor=$('vendorPhoto'),card=vendor&&vendor.closest?vendor.closest('.card'):null;
    if(!card)return;
    const status=$('vendorStatus');
    const b=document.createElement('button');b.type='button';b.id='v56VendorDistanceBtn';b.className='btn primary';
    b.textContent='📷 업체라벨 원거리 촬영 (권장)';
    b.onclick=D.open;
    if(status)card.insertBefore(b,status);else card.appendChild(b);
    const h=document.createElement('div');h.className='status';h.style.fontSize='.75rem';
    h.textContent='차량 적재 상태 2~3m용 · 실시간 OCR 대신 고해상도 1회 촬영. 첫 Pallet만 제품명/수량을 읽고 이후에는 기준값을 재사용합니다.';
    if(status)card.insertBefore(h,status);else card.appendChild(h);
  }

  function addReset(){
    const card=$('v56FastCard');if(!card||$('v56VendorLockReset'))return;
    const b=document.createElement('button');b.type='button';b.id='v56VendorLockReset';b.className='btn ghost';
    b.textContent='업체 기준정보 초기화';
    b.onclick=()=>{
      const k=key();clearLock(k);D.resetForNext();
      if($('vProduct'))$('vProduct').value='';if($('vQty'))$('vQty').value='';
      try{if(typeof compareLabels==='function')compareLabels();}catch(_){}
      setFast('현재 관리번호의 업체 기준정보를 초기화했습니다. 다음 촬영에서 다시 확정합니다.','warn');
      renderLock();
      try{if(window.V56FastFlow&&typeof V56FastFlow.refresh==='function')V56FastFlow.refresh();}catch(_){}
    };
    card.appendChild(b);
  }

  function boot(){
    ensureStyle();ensureModal();addButton();addReset();
    setTimeout(addButton,400);setTimeout(addReset,500);setTimeout(addButton,1500);
  }
  D._test={digits,norm,productSame,getLock,setLock,clearLock};

  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',boot,{once:true});else boot();
})();