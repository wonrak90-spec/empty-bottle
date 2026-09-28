/* V55 Capture Assist V1
 * Close-up recapture is a supplemental OCR pass only.
 * The original full-label photo remains the evidence image.
 */
(function(){
  'use strict';
  if(window.__V55_CAPTURE_ASSIST__)return;
  window.__V55_CAPTURE_ASSIST__=true;

  const C=window.V55CaptureAssist={VERSION:'V55-CAPTURE-ASSIST-1'};
  const $=id=>document.getElementById(id);
  const digits=v=>String(v==null?'':v).replace(/[^0-9]/g,'');
  const val=id=>$(id)?$(id).value.trim():'';
  const set=(id,v)=>{const el=$(id);if(el&&v!=null)el.value=String(v);};

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
    const changed=[];
    const wmsQty=val('displayQty');

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

  async function readFile(file){
    if(typeof window.fileToDataUrl!=='function')throw new Error('사진 처리 기능이 준비되지 않았습니다.');
    return await fileToDataUrl(file);
  }

  C.zoomSelected=async function(event,mode){
    mode=mode==='vendor'?'vendor':'wms';
    const input=event&&event.target;
    const file=input&&input.files&&input.files[0];
    if(input)input.value='';
    if(!file)return;

    // Close-up is supplemental. Preserve the original full-label evidence photo.
    try{
      const existing=window.lastPhotoDataUrl&&lastPhotoDataUrl[mode];
      if(!existing){
        setStatus(mode==='vendor'?'vendorStatus':'wmsStatus',
          '먼저 전체 라벨을 1회 촬영한 뒤 확대 재촬영을 사용하세요.','warn');
        return;
      }
    }catch(_){}

    const statusId=mode==='vendor'?'vendorStatus':'wmsStatus';
    setStatus(statusId,'확대사진 정밀 OCR 중 · 기존 정상값은 유지하고 부족한 항목만 보완합니다.','warn');

    try{
      const dataUrl=await readFile(file);
      if(!window.OCRRuntime||typeof OCRRuntime.recognize!=='function')
        throw new Error('OCR 엔진이 아직 준비되지 않았습니다.');
      const r=await OCRRuntime.recognize(dataUrl,mode,statusId);
      const changed=mode==='vendor'?mergeVendor(r.parsed):mergeWms(r.parsed);
      if(changed.length){
        setStatus(statusId,'확대 재촬영 보완 완료 · '+changed.join(', ')+' 반영 · 기존 전체 라벨 사진은 유지됩니다.','ok');
      }else{
        setStatus(statusId,'확대사진에서도 안전하게 보완할 새 항목을 찾지 못했습니다. 더 가까이 정면 촬영하거나 직접 확인하세요.','warn');
      }
    }catch(e){
      setStatus(statusId,'확대 재촬영 OCR 실패 · '+String(e&&e.message?e.message:e),'bad');
    }
  };

  C.open=function(mode){
    mode=mode==='vendor'?'vendor':'wms';
    const statusId=mode==='vendor'?'vendorStatus':'wmsStatus';
    const existing=(()=>{
      try{return !!(window.lastPhotoDataUrl&&lastPhotoDataUrl[mode]);}catch(_){return false;}
    })();
    if(!existing){
      setStatus(statusId,'확대 촬영은 보완용입니다. 먼저 전체 라벨을 한 번 촬영하세요.','warn');
      return;
    }
    setStatus(statusId,
      '확대 촬영: 작은 글자 부분이 화면의 60~80%를 차지하도록 맞추세요. 아이폰/안드로이드는 핀치 줌 또는 가까이 이동 후 초점을 맞춰 촬영하세요.','warn');
    const input=$(mode==='vendor'?'vendorZoomPhoto':'wmsZoomPhoto');
    if(input)input.click();
  };

  function addInput(mode,card){
    const id=mode==='vendor'?'vendorZoomPhoto':'wmsZoomPhoto';
    if($(id))return;
    const input=document.createElement('input');
    input.id=id;input.type='file';input.accept='image/*';input.setAttribute('capture','environment');input.className='hidden';
    input.onchange=e=>C.zoomSelected(e,mode);
    card.appendChild(input);
  }

  function addButton(mode,card){
    const id=mode==='vendor'?'btnVendorZoomRecapture':'btnWmsZoomRecapture';
    if($(id))return;
    const button=document.createElement('button');
    button.type='button';button.id=id;button.className='btn outline';
    button.textContent='🔍 확대 재촬영';
    button.onclick=()=>C.open(mode);

    const note=document.createElement('div');
    note.className='status';
    note.style.marginTop='8px';
    note.style.fontSize='.75rem';
    note.textContent=mode==='vendor'
      ? '작은 Pallet No./수량이 안 읽힐 때만 사용 · 기존 정상값과 전체 라벨 사진은 유지'
      : '관리번호/용기번호 등 작은 글자가 안 읽힐 때만 사용 · 기존 정상값과 전체 라벨 사진은 유지';

    const status=$(mode==='vendor'?'vendorStatus':'wmsStatus');
    if(status){card.insertBefore(button,status);card.insertBefore(note,status);}
    else{card.appendChild(button);card.appendChild(note);}
  }

  function polish(){
    const w=$('wmsPhoto'),v=$('vendorPhoto');
    if(w){
      const card=w.closest('.card');if(card){addInput('wms',card);addButton('wms',card);}
    }
    if(v){
      const card=v.closest('.card');if(card){addInput('vendor',card);addButton('vendor',card);}
    }
  }

  C._test={saneManagement,saneRange,severeQtyMismatch};

  function boot(){
    polish();setTimeout(polish,500);setTimeout(polish,1600);
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',boot,{once:true});else boot();
})();