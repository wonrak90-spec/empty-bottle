/* V56 Fast Inbound Flow V1
 * Goal: normal pallet = WMS auto OCR -> vendor auto OCR -> one-tap normal confirm/save.
 * Manual verdict/detail controls remain available only for exception handling.
 */
(function(){
  'use strict';
  if(window.__V56_FAST_FLOW__)return;
  window.__V56_FAST_FLOW__=true;

  const F=window.V56FastFlow={
    VERSION:'V57.2-FAST-FLOW-1.3',
    continuous:false,
    busy:false,
    photoUrls:{wms:'',vendor:''},
    uploads:{wms:null,vendor:null},
    lastEvidence:{wms:'',vendor:''},
    cycleStarted:0,lastCycleMs:0
  };
  const $=id=>document.getElementById(id);
  const val=id=>$(id)?$(id).value.trim():'';

  function setFastStatus(text,type){
    const el=$('v56FastStatus');if(!el)return;
    el.textContent=text;el.className='status'+(type?' '+type:'');
  }
  function labelMatch(){
    try{return typeof singleMatchOk!=='undefined'?singleMatchOk:null;}catch(_){return null;}
  }
  function wmsQuality(){
    try{
      if(window.V55WmsQuality&&typeof V55WmsQuality.inspectForm==='function')
        return V55WmsQuality.inspectForm();
    }catch(_){}
    return {ok:false,issues:[]};
  }
  function hasWms(){
    return /^\d{8}$/.test(val('inboundNo'))&&!!val('itemCode')&&!!val('displayQty')&&!!val('containerFrom')&&!!val('containerTo');
  }
  function hasVendor(){
    const fields=!!val('vProduct')&&!!val('vQty');
    try{
      if(window.V56VendorDistance){
        return fields&&V56VendorDistance.evidenceReady()&&!V56VendorDistance.hasMismatch();
      }
    }catch(_){}
    return fields;
  }
  function state(){
    const q=wmsQuality(),m=labelMatch();
    return {
      wms:hasWms(),
      vendor:hasVendor(),
      quality:!!q.ok,
      match:m,
      ready:hasWms()&&hasVendor()&&q.ok&&m===true,
      issues:q.issues||[]
    };
  }
  F.state=state;

  function refresh(){
    const s=state();
    const w=$('v56WmsState'),v=$('v56VendorState'),j=$('v56JudgeState'),btn=$('v56NormalSave');
    if(w){w.textContent=s.wms?'✓ WMS':'○ WMS';w.className='v56-pill '+(s.wms?'ok':'');}
    if(v){v.textContent=s.vendor?'✓ 업체라벨':'○ 업체라벨';v.className='v56-pill '+(s.vendor?'ok':'');}
    if(j){
      if(s.ready){j.textContent='✓ 자동대조 정상';j.className='v56-pill ok';}
      else if(s.match===false||!s.quality){j.textContent='⚠ 확인 필요';j.className='v56-pill bad';}
      else{j.textContent='○ 자동대조';j.className='v56-pill';}
    }
    if(btn){
      btn.disabled=!s.ready||F.busy;
      btn.textContent=F.busy?'저장 중...':'✓ 정상 확인 · 저장';
    }
    if(s.ready)setFastStatus('정상 Pallet · 실물 이상/혼입이 없으면 아래 버튼 한 번으로 저장하세요.','ok');
    else if(s.match===false||(!s.quality&&s.wms))setFastStatus('자동대조에서 확인할 항목이 있습니다. 정상 저장은 잠겼습니다. 상세/보완에서 확인하세요.','bad');
    else if(s.wms&&!s.vendor)setFastStatus('WMS 인식 완료 · 업체라벨을 비춰주세요.','warn');
    else if(!s.wms)setFastStatus('WMS 라벨부터 자동인식하세요.','');
  }
  F.refresh=refresh;

  function selectNormalVerdict(){
    const yes=$('matchYes'),no=$('matchNo'),mixNo=$('mixNo'),mixYes=$('mixYes');
    if(yes){yes.classList.add('sel-ok');}
    if(no){no.classList.remove('sel-bad','sel-ok');}
    if(mixNo){mixNo.classList.add('sel-ok');}
    if(mixYes){mixYes.classList.remove('sel-bad','sel-ok');}
    if(!val('actualQty')&&val('displayQty'))$('actualQty').value=val('displayQty');
    try{if(typeof updateSingleQty==='function')updateSingleQty();}catch(_){}
  }

  F.normalSave=async function(){
    if(F.busy)return;
    refresh();
    if(!state().ready){
      setFastStatus('정상 자동판정 조건이 충족되지 않았습니다. 상세/보완에서 확인하세요.','bad');
      F.showDetail(true);
      return;
    }
    // One tap = operator confirms no visible mix/abnormality on the physical pallet.
    selectNormalVerdict();
    F.busy=true;refresh();
    try{
      if(typeof saveSingleRecord!=='function')throw new Error('저장 기능을 찾지 못했습니다.');
      await saveSingleRecord();
    }catch(e){
      setFastStatus('저장 실패 · '+String(e&&e.message?e.message:e),'bad');
    }finally{
      F.busy=false;refresh();
    }
  };

  F.showDetail=function(show){
    const on=show!==false;
    document.body.classList.toggle('v56-show-detail',on);
    const btn=$('v56DetailToggle');if(btn)btn.textContent=on?'상세 닫기':'이상/상세 처리';
    if(on){
      const card=$('v56ManualVerdictCard');if(card)card.scrollIntoView({behavior:'smooth',block:'start'});
    }
  };

  async function preUpload(mode,dataUrl){
    if(!dataUrl||typeof apiPost!=='function')return '';
    try{
      let image=dataUrl;
      // Upload evidence is separate from OCR input, so use a slightly lighter file.
      // This reduces save wait time without changing OCR quality.
      if(typeof shrinkForUpload==='function')image=await shrinkForUpload(dataUrl,1200,.68);
      const now=new Date();
      const y=now.getFullYear(),m=String(now.getMonth()+1).padStart(2,'0'),d=String(now.getDate()).padStart(2,'0');
      const day=''+y+m+d;
      const inbound=val('inboundNo')||'NOINBOUND';
      const pallet=val('containerFrom')||'NOPALLET';
      const kind=mode==='vendor'?'VENDOR':'WMS';
      const tag=[day,inbound,'P'+pallet,kind,Date.now()].join('_');
      const res=await apiPost('uploadPhoto',{
        image,
        name:tag,
        inboundNo:inbound,
        palletNo:pallet,
        photoType:kind,
        dateKey:day
      });
      if(res&&res.ok&&res.url){F.photoUrls[mode]=res.url;return res.url;}
    }catch(_){}
    return '';
  }
  function startUpload(mode,dataUrl){
    if(!dataUrl)return;
    // 같은 촬영본에 대해 vendor capture + OCR applied 이벤트가 연속으로 들어와
    // 동일 사진을 두 번 업로드하는 경우가 있었다. 저장 버튼은 두 번째 업로드까지
    // 기다리게 되어 현장에서 "저장" 시간이 길어졌다. 같은 dataUrl이면 재업로드 금지.
    if(F.lastEvidence[mode]===dataUrl && (F.uploads[mode] || F.photoUrls[mode]))return;
    F.lastEvidence[mode]=dataUrl;
    F.photoUrls[mode]='';
    const p=preUpload(mode,dataUrl).finally(()=>{if(F.uploads[mode]===p)F.uploads[mode]=null;});
    F.uploads[mode]=p;
  }
  F.noteEvidence=function(mode,dataUrl){startUpload(mode==='vendor'?'vendor':'wms',dataUrl);};
  F.waitForUploads=async function(){
    const ps=['wms','vendor'].map(k=>F.uploads[k]).filter(Boolean);
    if(ps.length)await Promise.allSettled(ps);
  };

  function startLive(mode){
    try{
      if(mode==='wms'&&!F.cycleStarted)F.cycleStarted=performance.now();
      if(window.V22&&typeof V22.startLive==='function')V22.startLive(mode);
      else throw new Error('실시간 OCR이 준비되지 않았습니다.');
    }catch(e){setFastStatus('카메라 시작 실패 · '+String(e&&e.message?e.message:e),'bad');}
  }
  F.toggleContinuous=function(){
    F.continuous=!F.continuous;
    const b=$('v56Continuous');
    if(b)b.textContent=F.continuous?'⚡ 연속 자동인식 ON':'⚡ 연속 자동인식 시작';
    if(F.continuous){
      setFastStatus('연속검수 시작 · WMS 라벨을 비춰주세요.','warn');
      startLive('wms');
    }else{
      try{if(window.OcrRuntime&&typeof OcrRuntime.stopAll==='function')OcrRuntime.stopAll();}catch(_){}
      setFastStatus('연속 자동인식이 꺼졌습니다.','');
    }
  };

  function afterOcr(ev){
    const d=ev&&ev.detail||{},mode=d.mode==='vendor'?'vendor':'wms';
    // Upload the auto-captured evidence frame while the operator proceeds.
    let captured=d.dataUrl||'';
    try{
      if(typeof lastPhotoDataUrl!=='undefined'&&lastPhotoDataUrl&&lastPhotoDataUrl[mode])
        captured=lastPhotoDataUrl[mode]||captured;
    }catch(_){}
    startUpload(mode,captured);
    setTimeout(refresh,0);

    if(mode==='wms'&&F.continuous){
      const s=state();
      if(s.wms&&s.quality){
        try{if(navigator.vibrate)navigator.vibrate(45);}catch(_){}
        setFastStatus('WMS 완료 · 업체라벨 확대 사진촬영으로 자동 전환합니다.','ok');
        setTimeout(()=>{
          if(!F.continuous)return;
          try{
            if(window.V56VendorDistance&&typeof V56VendorDistance.open==='function')V56VendorDistance.open();
            else setFastStatus('업체라벨 확대 촬영 모듈이 준비되지 않았습니다. 상세 촬영을 사용하세요.','bad');
          }catch(_){setFastStatus('업체라벨 확대 촬영을 시작하지 못했습니다. 다시 촬영하세요.','bad');}
        },450);
      }else{
        setFastStatus('WMS 결과 확인 필요 · 자동 전환을 중단했습니다. 확대/상세 확인하세요.','bad');
      }
    }else if(mode==='vendor'){
      try{if(navigator.vibrate)navigator.vibrate([55,40,55]);}catch(_){}
      setTimeout(refresh,0);
    }
  }

  F.onSaved=function(){
    if(F.cycleStarted){
      F.lastCycleMs=Math.round(performance.now()-F.cycleStarted);
      setFastStatus('저장 완료 · 총 '+(F.lastCycleMs/1000).toFixed(1)+'초'+(F.lastCycleMs<=15000?' · 15초 목표 달성':' · 15초 초과'),'ok');
    }
    F.cycleStarted=0;
    F.photoUrls={wms:'',vendor:''};F.uploads={wms:null,vendor:null};F.lastEvidence={wms:'',vendor:''};
    try{if(window.V56VendorDistance&&typeof V56VendorDistance.resetForNext==='function')V56VendorDistance.resetForNext();}catch(_){}
    if(F.continuous){
      setTimeout(()=>{
        if(!F.continuous)return;
        setFastStatus('저장 완료 · 다음 Pallet WMS를 비춰주세요.','ok');
        startLive('wms');
      },900);
    }
  };

  function addCss(){
    if($('v56FastStyle'))return;
    const s=document.createElement('style');s.id='v56FastStyle';
    s.textContent=`
      #v56FastCard{border:2px solid var(--primary);position:relative}
      .v56-pills{display:flex;gap:6px;flex-wrap:wrap;margin:8px 0}
      .v56-pill{font-size:.73rem;padding:5px 8px;border-radius:999px;background:#eee;color:#666;font-weight:700}
      .v56-pill.ok{background:var(--ok-bg);color:var(--ok)}
      .v56-pill.bad{background:var(--warn-bg);color:var(--warn)}
      #v56NormalSave{font-size:1.08rem;min-height:56px;margin-top:10px}
      #v56Continuous{margin-top:8px}
      #v56DetailToggle{margin-top:8px}
      body.v56-fast #v56ManualVerdictCard,
      body.v56-fast #v56WmsDetailCard,
      body.v56-fast #v56ItemPhotoCard{display:none}
      body.v56-fast.v56-show-detail #v56ManualVerdictCard,
      body.v56-fast.v56-show-detail #v56WmsDetailCard,
      body.v56-fast.v56-show-detail #v56ItemPhotoCard{display:block}
      #v56FastHint{font-size:.74rem;color:var(--muted);line-height:1.45;margin:8px 0 0}
      @media(max-width:600px){#v56FastCard{position:sticky;bottom:8px;z-index:30;box-shadow:0 4px 18px rgba(0,0,0,.14)}}
    `;
    document.head.appendChild(s);
  }

  function tagCards(){
    const verdict=$('matchYes')&&$('matchYes').closest('.card');
    if(verdict)verdict.id='v56ManualVerdictCard';
    const detail=$('inboundNo')&&$('inboundNo').closest('.card');
    if(detail)detail.id='v56WmsDetailCard';
    const photo=$('singleItemPhotoInput')&&$('singleItemPhotoInput').closest('.card');
    if(photo)photo.id='v56ItemPhotoCard';
    return verdict;
  }

  function inject(){
    if($('v56FastCard'))return;
    addCss();const verdict=tagCards();if(!verdict){
      // The legacy single-card DOM can be initialized after the runtime script.
      // Retry instead of permanently losing the V56 controls on refresh.
      if(inject.attempts++<30)setTimeout(inject,250);
      else console.error('[V56] Could not locate single inspection card');
      return;
    }
    const card=document.createElement('div');card.id='v56FastCard';card.className='card';
    card.innerHTML=`
      <p class="step-title">⚡ 빠른 검수</p>
      <div class="v56-pills">
        <span id="v56WmsState" class="v56-pill">○ WMS</span>
        <span id="v56VendorState" class="v56-pill">○ 업체라벨</span>
        <span id="v56JudgeState" class="v56-pill">○ 자동대조</span>
      </div>
      <div id="v56FastStatus" class="status">WMS 라벨부터 자동인식하세요.</div>
      <button type="button" class="btn primary" id="v56NormalSave">✓ 정상 확인 · 저장</button>
      <button type="button" class="btn outline" id="v56Continuous">⚡ 연속 자동인식 시작</button>
      <button type="button" class="btn ghost" id="v56DetailToggle">이상/상세 처리</button>
      <p id="v56FastHint">WMS는 실시간 OCR, 업체라벨은 확대 사진촬영 후 OCR합니다. 정상 저장 1회 터치가 작업자 확인이며 이상건만 상세 판정을 사용합니다.</p>
    `;
    verdict.parentNode.insertBefore(card,verdict);
    $('v56NormalSave').onclick=F.normalSave;
    $('v56Continuous').onclick=F.toggleContinuous;
    $('v56DetailToggle').onclick=()=>F.showDetail(!document.body.classList.contains('v56-show-detail'));
    document.body.classList.add('v56-fast');

    ['inboundNo','itemCode','displayQty','containerFrom','containerTo','vProduct','vQty',
     'matchYes','matchNo','mixYes','mixNo','actualQty'].forEach(id=>{
      const el=$(id);if(el)el.addEventListener('input',refresh);
    });
    refresh();
  }

  inject.attempts=0;
  window.addEventListener('v55:ocr-applied',afterOcr);
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',()=>setTimeout(inject,50),{once:true});
  else setTimeout(inject,50);
})();