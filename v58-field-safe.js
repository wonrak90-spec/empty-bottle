/* V58 Field Safe
 * Field-first UX: WMS photo -> Vendor photo -> Save.
 * Every pallet keeps evidence photos. First pallet locks stable values.
 * Later pallets reuse the lock and OCR is advisory, not a hard dependency.
 */
(function(){
  'use strict';
  if(window.__V58_FIELD_SAFE__)return;
  window.__V58_FIELD_SAFE__=true;

  const S=window.V58FieldSafe={
    VERSION:'V58-FIELD-SAFE-1.5',
    STORE:'v58.fieldSafe.activeLock.v1',
    lastError:'',
    lastSaveMode:''
  };
  const $=id=>document.getElementById(id);
  const val=id=>$(id)?$(id).value.trim():'';
  const set=(id,v)=>{const e=$(id);if(e)e.value=v==null?'':String(v);};
  const digits=v=>String(v==null?'':v).replace(/[^0-9]/g,'');

  function loadLock(){
    try{
      const x=JSON.parse(localStorage.getItem(S.STORE)||'null');
      return x&&x.product&&x.itemCode?x:null;
    }catch(_){return null;}
  }
  function saveLock(x){
    try{localStorage.setItem(S.STORE,JSON.stringify(x));}catch(_){}
  }
  function clearLock(){
    try{localStorage.removeItem(S.STORE);}catch(_){}
    render();
  }
  S.getLock=loadLock;S.clearLock=clearLock;

  function photoReady(mode){
    try{
      if(window.V56FastFlow&&V56FastFlow.photoUrls&&V56FastFlow.photoUrls[mode])return true;
    }catch(_){}
    try{
      if(typeof lastPhotoDataUrl!=='undefined'){
        if(mode==='wms')return !!(lastPhotoDataUrl.wms||lastPhotoDataUrl.single);
        return !!lastPhotoDataUrl.vendor;
      }
    }catch(_){}
    const img=$(mode==='wms'?'wmsPreview':'vendorPreview');
    return !!(img&&img.src&&!img.classList.contains('hidden'));
  }
  S.photoReady=photoReady;

  function currentPallet(){
    return {current:digits(val('containerFrom')),total:digits(val('containerTo'))};
  }
  function isLast(){
    const p=currentPallet();
    return !!(p.current&&p.total&&Number(p.current)===Number(p.total));
  }

  function applyLock(lock){
    lock=lock||loadLock();if(!lock)return false;
    const fixed={
      inboundNo:lock.inboundNo,itemCode:lock.itemCode,product:lock.product,
      manufacturer:lock.manufacturer,supplier:lock.supplier,unit:lock.unit||'EA',
      containerTo:lock.containerTo
    };
    // Regular pallet qty is stable, but the last pallet may have a different quantity.
    // Never restore the regular-pallet LOCK quantity on the last pallet.
    if(!isLast())fixed.displayQty=lock.displayQty;
    Object.keys(fixed).forEach(id=>{if(fixed[id]&&!val(id))set(id,fixed[id]);});
    if(lock.vendorProduct&&!val('vProduct'))set('vProduct',lock.vendorProduct);
    if(lock.vendorQty&&!val('vQty')&&!isLast())set('vQty',lock.vendorQty);
    if(!val('actualQty')&&val('displayQty'))set('actualQty',val('displayQty'));
    return true;
  }
  S.applyLock=applyLock;

  function makeLock(){
    return {
      inboundNo:val('inboundNo'),itemCode:val('itemCode'),product:val('product'),
      manufacturer:val('manufacturer'),supplier:val('supplier'),
      displayQty:val('displayQty'),unit:val('unit')||'EA',
      containerTo:val('containerTo'),
      vendorProduct:val('vProduct'),vendorQty:val('vQty'),
      createdAt:new Date().toISOString()
    };
  }

  function missingBase(lock){
    const m=[];
    if(!val('inboundNo'))m.push('관리번호');
    if(!val('itemCode'))m.push('품목코드');
    if(!val('product'))m.push('품명');
    if(!val('displayQty'))m.push('WMS 수량');
    if(!val('containerFrom'))m.push('현재 Pallet');
    if(!val('containerTo')&&!lock)m.push('전체 Pallet');
    if(!lock){
      if(!val('vProduct'))m.push('업체 품명');
      if(!val('vQty'))m.push('업체 수량');
    }
    return m;
  }

  function selectNormalVerdict(){
    const yes=$('matchYes'),no=$('matchNo'),mixNo=$('mixNo'),mixYes=$('mixYes');
    if(yes)yes.classList.add('sel-ok');
    if(no)no.classList.remove('sel-bad','sel-ok');
    if(mixNo)mixNo.classList.add('sel-ok');
    if(mixYes)mixYes.classList.remove('sel-bad','sel-ok');
    if(!val('actualQty')&&val('displayQty'))set('actualQty',val('displayQty'));
    try{if(typeof updateSingleQty==='function')updateSingleQty();}catch(_){}
  }

  S.validate=function(){
    const lock=loadLock();
    if(lock)applyLock(lock);
    if(!photoReady('wms'))return {ok:false,code:'wms_photo',message:'1번 WMS 라벨 사진을 먼저 찍어주세요.'};
    if(!photoReady('vendor'))return {ok:false,code:'vendor_photo',message:'2번 업체 라벨 사진을 먼저 찍어주세요.'};
    const missing=missingBase(lock);
    if(missing.length)return {ok:false,code:'fields',message:'확인이 필요한 정보: '+missing.join(', ')};
    return {ok:true,lock:!!lock,last:isLast()};
  };

  S.prepareForSave=function(){
    const r=S.validate();
    if(!r.ok){
      S.lastError=r.message;
      if(r.code==='fields')showEdit(true);
      render();
      return r;
    }
    selectNormalVerdict();
    S.lastSaveMode=r.lock?'LOCK 재사용':'첫 Pallet 기준확정';
    return r;
  };

  S.decoratePayload=function(payload){
    const lock=loadLock();
    const tags=[];
    if(lock)tags.push('V58 기준정보 LOCK 재사용');
    else tags.push('V58 첫 Pallet 기준정보 확정');
    if(photoReady('wms'))tags.push('WMS 사진확보');
    if(photoReady('vendor'))tags.push('업체사진확보');
    if(lock&&!val('vProduct'))payload.vendorProduct=lock.vendorProduct||'';
    if(lock&&!val('vQty')&&!isLast())payload.vendorQty=lock.vendorQty||'';
    payload.note=[payload.note,tags.join(' / ')].filter(Boolean).join(' / ');
    if(lock && (!payload.vendorOcrRaw || !String(payload.vendorOcrRaw).trim())){
      payload.labelMatch='기준정보사용';
    }
    return payload;
  };

  S.onSaved=function(payload){
    let lock=loadLock();
    if(!lock){
      const next=makeLock();
      if(next.product&&next.itemCode&&next.displayQty&&next.vendorProduct&&next.vendorQty){
        saveLock(next);lock=next;
      }
    }
    // Existing prepareNextSingleAfterSave clears the form synchronously after this hook.
    // Restore only stable values after it finishes; the pallet number/photo remain blank.
    if(lock)setTimeout(()=>{applyLock(lock);render();},80);
    setTimeout(render,120);
  };

  function summaryValue(v,fallback){return v&&String(v).trim()?String(v).trim():(fallback||'—');}
  function render(){
    const card=$('v58SimpleCard');if(!card)return;
    const lock=loadLock();
    if(lock)applyLock(lock);
    const w=photoReady('wms'),v=photoReady('vendor');
    const p=currentPallet();
    const product=val('product')||(lock&&lock.product)||'';
    const qty=val('displayQty')||(lock&&lock.displayQty)||'';
    const vendorProduct=val('vProduct')||(lock&&lock.vendorProduct)||'';
    const vendorQty=val('vQty')||(!isLast()&&lock&&lock.vendorQty)||'';

    const setText=(id,t,cls)=>{const e=$(id);if(e){e.textContent=t;e.className='v58-state '+(cls||'');}};
    setText('v58WmsState',w?'✓ WMS 사진':'1. WMS 사진 필요',w?'ok':'');
    setText('v58VendorState',v?'✓ 업체 사진':'2. 업체 사진 필요',v?'ok':'');
    setText('v58LockState',lock?'🔒 기준정보 사용':'첫 Pallet 기준설정',lock?'ok':'warn');

    if($('v58Product'))$('v58Product').textContent=summaryValue(product);
    if($('v58Qty'))$('v58Qty').textContent=summaryValue(qty)+(qty?' EA':'');
    if($('v58Pallet'))$('v58Pallet').textContent=(p.current||'—')+' / '+(p.total||(lock&&lock.containerTo)||'—');
    if($('v58Vendor'))$('v58Vendor').textContent=summaryValue(vendorProduct)+(vendorQty?' · '+vendorQty+' EA':'');

    const vr=S.validate();
    const b=$('v58Save');
    if(b){b.disabled=!vr.ok;b.textContent=vr.ok?'3. 저장하기 ✓':'3. 사진 찍고 저장';}
    const st=$('v58Status');
    if(st){
      if(vr.ok){
        st.className='status ok';
        st.textContent=lock?'사진 2장 확보 완료 · 기준정보 자동사용 · 저장만 누르세요.':'첫 Pallet 정보 확인 완료 · 저장하면 기준정보가 자동 고정됩니다.';
      }else{
        st.className='status '+(S.lastError?'bad':'warn');
        st.textContent=S.lastError||vr.message;
      }
    }
  }
  S.render=render;

  function showEdit(on){
    const p=$('v58EditPanel');if(p)p.classList.toggle('hidden',on===false?true:false);
    if(on&&p)p.scrollIntoView({behavior:'smooth',block:'nearest'});
  }
  S.showEdit=showEdit;

  function syncEditFromForm(){
    const pairs={v58eInbound:'inboundNo',v58eItem:'itemCode',v58eProduct:'product',v58eQty:'displayQty',
      v58eCurrent:'containerFrom',v58eTotal:'containerTo',v58eVProduct:'vProduct',v58eVQty:'vQty'};
    Object.keys(pairs).forEach(a=>set(a,val(pairs[a])));
  }
  function applyEdit(){
    const pairs={v58eInbound:'inboundNo',v58eItem:'itemCode',v58eProduct:'product',v58eQty:'displayQty',
      v58eCurrent:'containerFrom',v58eTotal:'containerTo',v58eVProduct:'vProduct',v58eVQty:'vQty'};
    Object.keys(pairs).forEach(a=>{const x=val(a);if(x)set(pairs[a],x);});
    S.lastError='';
    showEdit(false);render();
    try{if(typeof compareLabels==='function')compareLabels();}catch(_){}
  }

  async function save(){
    S.lastError='';
    const r=S.prepareForSave();
    if(!r.ok)return;
    const b=$('v58Save');if(b){b.disabled=true;b.textContent='저장 중...';}
    try{
      window.__V58_SAVE_INTENT__=true;
      if(typeof saveSingleRecord!=='function')throw new Error('저장 기능을 찾지 못했습니다.');
      await saveSingleRecord();
    }catch(e){
      S.lastError='저장 오류 · '+String(e&&e.message?e.message:e);
    }finally{
      window.__V58_SAVE_INTENT__=false;
      setTimeout(render,100);
    }
  }

  function wmsPhoto(){
    S.lastError='';
    const i=$('wmsPhoto');
    if(i)i.click();
    else{S.lastError='WMS 카메라를 열 수 없습니다.';render();}
  }
  function vendorPhoto(){
    S.lastError='';
    try{
      if(window.V56VendorDistance&&typeof V56VendorDistance.open==='function')V56VendorDistance.open();
      else if($('vendorPhoto'))$('vendorPhoto').click();
      else throw new Error('업체 카메라 없음');
    }catch(_){S.lastError='업체라벨 카메라를 열 수 없습니다.';render();}
  }

  S.handleOcrApplied=function(detail){
    const d=detail||{},lock=loadLock();
    if(lock&&d.mode==='vendor'&&!isLast()){
      set('vProduct',lock.vendorProduct||'');
      set('vQty',lock.vendorQty||'');
    }
    if(lock&&d.mode==='wms'){
      set('product',lock.product||'');
      set('itemCode',lock.itemCode||'');
      set('manufacturer',lock.manufacturer||'');
      set('supplier',lock.supplier||'');
      set('unit',lock.unit||'EA');
      if(!val('containerTo'))set('containerTo',lock.containerTo||'');

      if(isLast()){
        const lastQty=d.parsed&&d.parsed.displayQty?String(d.parsed.displayQty):'';
        set('displayQty',lastQty);
        set('actualQty',lastQty);
        set('vProduct',lock.vendorProduct||'');
        set('vQty','');
      }else{
        set('displayQty',lock.displayQty||'');
        if(!val('actualQty'))set('actualQty',lock.displayQty||'');
      }
    }
    setTimeout(render,0);
  };

  function addCss(){
    if($('v58Style'))return;
    const s=document.createElement('style');s.id='v58Style';
    s.textContent=`
      body.v58-simple #v56FastCard,
      body.v58-simple #v56ManualVerdictCard,
      body.v58-simple #v56WmsDetailCard,
      body.v58-simple #v56ItemPhotoCard,
      body.v58-simple #v58LegacyWmsCard,
      body.v58-simple #v58LegacyVendorCard,
      body.v58-simple #v58LegacySaveCard{display:none!important}
      #v58SimpleCard{border:3px solid var(--primary);padding:14px}
      .v58-title{font-weight:900;font-size:1.15rem;margin-bottom:4px}
      .v58-sub{font-size:.8rem;color:var(--muted);margin-bottom:12px}
      .v58-steps{display:grid;grid-template-columns:1fr 1fr;gap:10px}
      .v58-big{min-height:64px!important;font-size:1.05rem!important;font-weight:900!important}
      #v58Save{grid-column:1/-1;min-height:66px!important;font-size:1.18rem!important}
      .v58-states{display:flex;gap:6px;flex-wrap:wrap;margin:12px 0 8px}
      .v58-state{padding:6px 9px;border-radius:999px;background:#eee;font-size:.75rem;font-weight:800}
      .v58-state.ok{background:var(--ok-bg);color:var(--ok)}
      .v58-state.warn{background:var(--warn-bg);color:var(--warn)}
      .v58-summary{border:1px solid var(--border);border-radius:12px;overflow:hidden;margin:10px 0}
      .v58-row{display:grid;grid-template-columns:95px 1fr;padding:9px 10px;border-bottom:1px solid var(--border);font-size:.86rem}
      .v58-row:last-child{border-bottom:0}.v58-row b{font-size:.76rem;color:var(--muted)}
      #v58EditPanel{margin-top:10px;padding:10px;border:1px solid var(--border);border-radius:12px;background:var(--card)}
      .v58-edit-grid{display:grid;grid-template-columns:1fr 1fr;gap:8px}
      .v58-edit-grid label{font-size:.72rem;color:var(--muted)}
      .v58-edit-grid input{width:100%}
      .v58-help{font-size:.73rem;color:var(--muted);line-height:1.4;margin-top:8px}
      @media(max-width:600px){.v58-steps{grid-template-columns:1fr}.v58-steps #v58Save{grid-column:auto}.v58-edit-grid{grid-template-columns:1fr 1fr}}
    `;
    document.head.appendChild(s);
  }

  function tagLegacy(){
    const w=$('wmsPhoto')&&$('wmsPhoto').closest('.card');if(w)w.id='v58LegacyWmsCard';
    const v=$('vendorPhoto')&&$('vendorPhoto').closest('.card');if(v)v.id='v58LegacyVendorCard';
    const saveBtn=[...document.querySelectorAll('button')].find(b=>String(b.getAttribute('onclick')||'').includes('saveSingleRecord'));
    const sc=saveBtn&&saveBtn.closest('.card');if(sc)sc.id='v58LegacySaveCard';
  }

  function inject(){
    if($('v58SimpleCard'))return;
    const panel=$('single');if(!panel)return setTimeout(inject,150);
    addCss();tagLegacy();
    const card=document.createElement('div');card.id='v58SimpleCard';card.className='card';
    card.innerHTML=`
      <div class="v58-title">공병 입고 확인</div>
      <div class="v58-sub">사진 2장 찍고 저장하면 끝납니다.</div>
      <div class="v58-steps">
        <button type="button" class="btn primary v58-big" id="v58WmsPhoto">1. WMS 라벨 찍기 📷</button>
        <button type="button" class="btn primary v58-big" id="v58VendorPhoto">2. 업체라벨 찍기 📷</button>
        <button type="button" class="btn primary" id="v58Save">3. 사진 찍고 저장</button>
      </div>
      <div class="v58-states">
        <span id="v58WmsState" class="v58-state">1. WMS 사진 필요</span>
        <span id="v58VendorState" class="v58-state">2. 업체 사진 필요</span>
        <span id="v58LockState" class="v58-state warn">첫 Pallet 기준설정</span>
      </div>
      <div class="v58-summary">
        <div class="v58-row"><b>품명</b><span id="v58Product">—</span></div>
        <div class="v58-row"><b>수량</b><span id="v58Qty">—</span></div>
        <div class="v58-row"><b>Pallet</b><span id="v58Pallet">—</span></div>
        <div class="v58-row"><b>업체라벨</b><span id="v58Vendor">—</span></div>
      </div>
      <div id="v58Status" class="status warn">1번 WMS 라벨 사진을 먼저 찍어주세요.</div>
      <button type="button" class="btn outline" id="v58Edit">정보 수정</button>
      <button type="button" class="btn ghost" id="v58NewInbound">새 입고 시작</button>
      <div id="v58EditPanel" class="hidden">
        <div class="v58-edit-grid">
          <label>관리번호<input id="v58eInbound"></label>
          <label>품목코드<input id="v58eItem"></label>
          <label>품명<input id="v58eProduct"></label>
          <label>WMS 수량<input id="v58eQty" inputmode="numeric"></label>
          <label>현재 Pallet<input id="v58eCurrent" inputmode="numeric"></label>
          <label>전체 Pallet<input id="v58eTotal" inputmode="numeric"></label>
          <label>업체 품명<input id="v58eVProduct"></label>
          <label>업체 수량<input id="v58eVQty" inputmode="numeric"></label>
        </div>
        <button type="button" class="btn primary" id="v58EditApply">수정 완료</button>
        <div class="v58-help">첫 Pallet에서만 기준정보를 확인합니다. 다음 Pallet부터는 고정값이 자동으로 채워집니다.</div>
      </div>
    `;
    panel.insertBefore(card,panel.firstChild);
    document.body.classList.add('v58-simple');
    $('v58WmsPhoto').onclick=wmsPhoto;
    $('v58VendorPhoto').onclick=vendorPhoto;
    $('v58Save').onclick=save;
    $('v58Edit').onclick=()=>{syncEditFromForm();showEdit(true);};
    $('v58EditApply').onclick=applyEdit;
    $('v58NewInbound').onclick=()=>{
      if(!window.confirm('현재 기준정보를 지우고 새 입고를 시작할까요?'))return;
      clearLock();
      try{if(typeof clearSingle==='function')clearSingle();}catch(_){}
      S.lastError='';render();
    };

    ['inboundNo','itemCode','product','displayQty','containerFrom','containerTo','vProduct','vQty']
      .forEach(id=>{const e=$(id);if(e){e.addEventListener('input',render);e.addEventListener('change',render);}});
    const obs=new MutationObserver(()=>render());
    ['wmsPreview','vendorPreview'].forEach(id=>{const e=$(id);if(e)obs.observe(e,{attributes:true,attributeFilter:['src','class']});});
    window.addEventListener('v55:ocr-applied',ev=>S.handleOcrApplied(ev&&ev.detail||{}));
    window.addEventListener('v58:vendor-photo',()=>setTimeout(render,0));
    applyLock(loadLock());
    render();
    setInterval(render,1000);
  }

  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',()=>setTimeout(inject,120),{once:true});
  else setTimeout(inject,120);
})();