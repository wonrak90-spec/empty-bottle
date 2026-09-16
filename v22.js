/* 공병 입고 확인 V22 확장
 * - 현장 작업성 개선
 * - 브라우저 우선 OCR + 실시간 OCR
 * - 다중 선택/사진 포함 출력
 * - 임원보고/조사보고
 * - 생산 공동 세션(다중 작업자) UI
 */
(function(){
  'use strict';

  const V22 = {
    selectedIds: new Set(),
    live: {},
    prodPoll: null,
    reportData: null,
    reportKind: '',
    photoCache: new Map(),
    ocrBusy: false,
    masterCache: new Map(),
    itemCache: new Map()
  };
  window.V22 = V22;

  const $ = id => document.getElementById(id);
  const e = s => (typeof esc === 'function' ? esc(s) : String(s == null ? '' : s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])));

  function showBusy(text){
    let x=$('v22Busy');
    if(!x){x=document.createElement('div');x.id='v22Busy';x.className='v22-loading hidden';document.body.appendChild(x);}
    x.textContent=text||'처리 중...'; x.classList.remove('hidden');
  }
  function hideBusy(){ const x=$('v22Busy'); if(x)x.classList.add('hidden'); }

  // 자주 반복되는 WMS/자재 마스터 조회는 기기 내 캐시로 즉시 재사용
  window.lookupMaster=async function(key){
    const k=String(key||'').trim();if(!k)return {ok:false,message:'key가 없습니다.'};
    const hit=V22.masterCache.get(k);if(hit && Date.now()-hit.t<300000)return hit.v;
    try{const v=await apiGet('lookup',{key:k});V22.masterCache.set(k,{t:Date.now(),v});return v;}catch(err){return {ok:false,message:String(err)};}
  };

  if(typeof window.loadItemInfo==='function'){
    window.loadItemInfo=async function(code){
      const c=String(code||'').trim();if(!c){currentItemInfo=null;renderItemInfo();return;}
      try{
        const hit=V22.itemCache.get(c);let res;
        if(hit&&Date.now()-hit.t<600000)res=hit.v;else{res=await apiGet('lookupItem',{code:c});V22.itemCache.set(c,{t:Date.now(),v:res});}
        currentItemInfo=(res.ok&&res.found)?res.data:null;
      }catch(_){currentItemInfo=null;}
      renderItemInfo();compareLabels();
    };
  }

  function quickButton(label, tab){
    return `<button class="btn ${tab==='single'?'primary':'outline'}" type="button" onclick="showTab('${tab}')">${label}</button>`;
  }

  function injectQuickStart(){
    const dash=$('dash');
    if(!dash || $('v22Quick')) return;
    const card=document.createElement('div');
    card.className='card'; card.id='v22Quick';
    card.innerHTML=`<p class="step-title">빠른 작업</p><div class="v22-quick">
      ${quickButton('📷 단건 입고','single')}${quickButton('▦ 다중 파레트','multi')}
      ${quickButton('🏭 생산 투입','prod')}${quickButton('🖨 조회·보고','view')}
    </div><div class="status">작업자는 필요한 업무만 선택하면 됩니다. 스캔·촬영 후 자동입력되고, 틀린 항목만 수정하세요.</div>`;
    dash.insertBefore(card,dash.firstChild);
  }

  function insertLiveUi(mode, anchorId, label){
    const anchor=$(anchorId); if(!anchor || $(`v22LiveWrap_${mode}`)) return;
    const wrap=document.createElement('div');
    wrap.innerHTML=`<div class="v22-action-row">
      <button type="button" class="btn outline" onclick="V22.startLive('${mode}')">🎥 ${label} 실시간 인식</button>
      <button type="button" class="btn outline" onclick="V22.stopLive('${mode}')">카메라 중지</button>
    </div>
    <div id="v22LiveWrap_${mode}" class="v22-live hidden">
      <video id="v22LiveVideo_${mode}" playsinline muted></video><div class="v22-guide"></div>
      <div class="v22-live-actions">
        <button type="button" class="btn primary" onclick="V22.captureLive('${mode}')">📷 현재 화면 확정</button>
        <button type="button" class="btn outline" onclick="V22.stopLive('${mode}')">중지</button>
      </div>
    </div>`;
    const frag=wrap.children;
    while(frag.length) anchor.parentNode.insertBefore(frag[0],anchor);
  }

  function cropVideo(video){
    const vw=video.videoWidth, vh=video.videoHeight; if(!vw||!vh)return '';
    // 중앙 라벨 영역 위주로 잘라 OCR 부하와 배경 노이즈 감소
    const sx=Math.round(vw*.06), sy=Math.round(vh*.12), sw=Math.round(vw*.88), sh=Math.round(vh*.76);
    const max=1600, scale=Math.min(1,max/Math.max(sw,sh));
    const c=document.createElement('canvas');c.width=Math.max(1,Math.round(sw*scale));c.height=Math.max(1,Math.round(sh*scale));
    c.getContext('2d').drawImage(video,sx,sy,sw,sh,0,0,c.width,c.height);
    return c.toDataURL('image/jpeg',.86);
  }

  function applyLiveResult(mode, raw, dataUrl){
    if(!raw || !raw.trim())return;
    if(mode==='vendor'){
      lastOcrText.vendor=raw; lastPhotoDataUrl.vendor=dataUrl;
      const v=parseVendorLabel(raw);
      if(v.product)$('vProduct').value=v.product;
      if(v.qty)$('vQty').value=v.qty;
      if(v.prodDate)$('vProdDate').value=v.prodDate;
      if(v.prodTime)$('vProdTime').value=v.prodTime;
      if(v.lotNo)$('vLotNo').value=v.lotNo;
      if(v.line)$('vLine').value=v.line;
      compareLabels();
      setStatus('vendorStatus','실시간 인식됨 · 틀린 항목만 수정하세요.','ok');
    }else{
      const parsed=parseLabelText(raw);
      lastOcrText[mode==='wms'?'wms':'multi']=raw;
      lastPhotoDataUrl[mode==='wms'?'wms':'multi']=dataUrl;
      if(mode==='wms')lastPhotoDataUrl.single=dataUrl;
      applyOcrToMode(mode,parsed);
      if(parsed.itemCode && typeof loadItemInfo==='function')loadItemInfo(parsed.itemCode);
      setStatus(mode==='wms'?'wmsStatus':'multiBaseStatus','실시간 인식됨 · 틀린 항목만 수정하세요.','ok');
    }
  }

  async function browserOcr(dataUrl, progressId){
    const prepped=await preprocessForOcr(dataUrl);
    const worker=await getOcrWorker(progressId);
    const ret=await worker.recognize(prepped);
    return (ret.data && ret.data.text)||'';
  }

  function ocrScore(text){
    const s=String(text||''); let score=0;
    ['입고','품목','품명','수량','공급','생산','LOT','Lot','No'].forEach(k=>{if(s.indexOf(k)>=0)score+=2;});
    if(/\d{6,}/.test(s))score+=2;
    if(s.length>40)score+=1;
    return score;
  }

  // V21의 서버우선 OCR을 브라우저우선으로 변경. 서버 OCR은 저신뢰 결과일 때만 보정용으로 사용.
  window.runOcr = async function(dataUrl, progressId){
    lastOcrError=''; let local='';
    try{
      local=await browserOcr(dataUrl,progressId);
      if(ocrScore(local)>=5){lastOcrEngine='기기 실시간 인식';return local;}
    }catch(err){lastOcrError=String(err&&err.message?err.message:err);}
    if(CONFIG.API_URL && CONFIG.API_URL.indexOf('PUT_YOUR')!==0){
      try{
        const sending=await shrinkForUpload(dataUrl,1600,.82);
        const res=await apiPost('ocr',{image:sending});
        if(res.ok && String(res.text||'').trim()){
          const server=String(res.text||'');
          lastOcrEngine='정밀 보정 인식';
          return ocrScore(server)>=ocrScore(local)?server:local;
        }
      }catch(err){lastOcrError=String(err&&err.message?err.message:err);}
    }
    lastOcrEngine='기기 인식';
    return local;
  };

  V22.startLive=async function(mode){
    Object.keys(V22.live).forEach(m=>{ if(m!==mode) V22.stopLive(m,false); });
    V22.stopLive(mode,false);
    try{ if(typeof stopScanner==='function') await stopScanner(); }catch(_){ }
    const video=$(`v22LiveVideo_${mode}`), wrap=$(`v22LiveWrap_${mode}`); if(!video||!wrap)return;
    try{
      const stream=await navigator.mediaDevices.getUserMedia({video:{facingMode:{ideal:'environment'},width:{ideal:1920},height:{ideal:1080}},audio:false});
      V22.live[mode]={stream,running:true,busy:false,lastText:''};
      video.srcObject=stream; await video.play(); wrap.classList.remove('hidden');
      const sid=mode==='vendor'?'vendorStatus':(mode==='wms'?'wmsStatus':'multiBaseStatus');
      setStatus(sid,'실시간 인식 중 · 라벨을 흰 박스 안에 맞춰주세요.','warn');
      V22.liveTick(mode);
    }catch(err){
      const sid=mode==='vendor'?'vendorStatus':(mode==='wms'?'wmsStatus':'multiBaseStatus');
      setStatus(sid,'카메라 실행 실패: '+err,'bad');
    }
  };

  V22.liveTick=async function(mode){
    const st=V22.live[mode], video=$(`v22LiveVideo_${mode}`); if(!st||!st.running||!video)return;
    if(!st.busy && video.videoWidth){
      st.busy=true;
      try{
        const data=cropVideo(video);
        if(data){
          const worker=await getOcrWorker(mode==='vendor'?'ocrProgressVendor':(mode==='wms'?'ocrProgressWms':'ocrProgressMulti'));
          const ret=await worker.recognize(await preprocessForOcr(data));
          const raw=(ret.data&&ret.data.text)||'';
          if(ocrScore(raw)>=3 && raw!==st.lastText){st.lastText=raw;applyLiveResult(mode,raw,data);}
        }
      }catch(_){ } finally{st.busy=false;}
    }
    if(st.running)setTimeout(()=>V22.liveTick(mode),1200);
  };

  V22.captureLive=async function(mode){
    const video=$(`v22LiveVideo_${mode}`); if(!video||!video.videoWidth)return;
    const data=cropVideo(video); if(!data)return;
    const preview=mode==='vendor'?$('vendorPreview'):(mode==='wms'?$('wmsPreview'):$('multiPreview'));
    if(preview){preview.src=data;preview.classList.remove('hidden');}
    const sid=mode==='vendor'?'vendorStatus':(mode==='wms'?'wmsStatus':'multiBaseStatus');
    setStatus(sid,'촬영 화면 정밀 인식 중...','warn');
    try{
      const raw=await window.runOcr(data,mode==='vendor'?'ocrProgressVendor':(mode==='wms'?'ocrProgressWms':'ocrProgressMulti'));
      applyLiveResult(mode,raw,data);
      setStatus(sid,'촬영 확정 · 자동입력 완료 ('+lastOcrEngine+')','ok');
    }catch(err){setStatus(sid,'인식 실패: '+err,'bad');}
    V22.stopLive(mode,false);
  };

  V22.stopLive=function(mode,showStatus){
    const st=V22.live[mode];
    if(st){st.running=false;if(st.stream)st.stream.getTracks().forEach(t=>t.stop());delete V22.live[mode];}
    const wrap=$(`v22LiveWrap_${mode}`);if(wrap)wrap.classList.add('hidden');
    if(showStatus!==false){
      const sid=mode==='vendor'?'vendorStatus':(mode==='wms'?'wmsStatus':'multiBaseStatus');
      if($(sid))setStatus(sid,'카메라 중지 · 입력 내용을 확인하세요.','');
    }
  };

  // 실물 사진은 저장/출력 속도를 위해 브라우저에서 축소한다.
  window.itemPhotoSelected=async function(event,mode){
    const files=Array.from(event.target.files||[]);
    for(const file of files){
      const raw=await fileToDataUrl(file);
      const small=await shrinkForUpload(raw,1400,.78);
      itemPhotos[mode].push(small);
    }
    event.target.value='';renderItemPhotos(mode);
  };

  V22.manualSingle=function(){
    try{if(typeof stopScanner==='function')stopScanner();}catch(_){}
    setStatus('wmsStatus','코드 없는 일반 라벨 · 아래 입고정보를 직접 입력하고 업체라벨을 촬영하세요.','warn');
    const el=$('inboundNo');if(el){el.scrollIntoView({behavior:'smooth',block:'center'});setTimeout(()=>el.focus(),250);}
  };

  V22.manualMultiBase=function(){
    setStatus('multiBaseStatus','코드 없는 일반 라벨 · 기준정보를 직접 입력한 뒤 파레트별 업체라벨을 촬영하세요.','warn');
    const el=$('mProduct');if(el){el.scrollIntoView({behavior:'smooth',block:'center'});setTimeout(()=>el.focus(),250);}
  };

  V22.manualPallet=function(){
    const product=$('mProduct').value.trim();if(!product){setStatus('loopStatus','먼저 기준정보를 입력하세요.','bad');return;}
    const container=prompt('용기번호/파레트 식별번호가 있으면 입력하세요. 없으면 빈칸으로 확인하세요.','');if(container===null)return;
    const seq=(typeof palletSeq!=='undefined'&&palletSeq)||1;
    currentPallet=currentPallet||{};
    currentPallet.code='직접입력-'+($('mInboundNo').value.trim()||'NO')+'-'+seq;
    currentPallet.inboundNo=$('mInboundNo').value.trim();currentPallet.containerNo=String(container||'').trim();
    currentPallet.itemCode=$('mItemCode').value.trim();currentPallet.product=product;currentPallet.supplier=$('mSupplier').value.trim();
    currentPallet.qty=num($('mQty').value);currentPallet.unit='EA';currentPallet.scanTime=new Date().toLocaleTimeString('ko-KR');
    currentPallet.note=[currentPallet.note||'','코드 없는 일반 라벨 · 직접 입력'].filter(Boolean).join(' / ');
    renderLoop();setStatus('loopStatus','직접 등록됨 · 업체라벨을 촬영한 뒤 완료하세요.','warn');
  };

  function injectManualButtons(){
    const scan=$('btnScanSingle');if(scan&&!$('v22ManualSingle')){
      const b=document.createElement('button');b.id='v22ManualSingle';b.className='btn outline';b.textContent='✍ 코드 없음 / 직접 입력';b.onclick=V22.manualSingle;scan.parentNode.insertBefore(b,$('readerWrapSingle'));
    }
    const mc=$('mSetupCard');if(mc&&!$('v22ManualMulti')){
      const b=document.createElement('button');b.id='v22ManualMulti';b.className='btn outline';b.textContent='✍ 코드 없음 / 기준정보 직접 입력';b.onclick=V22.manualMultiBase;mc.insertBefore(b,$('readerWrapMulti'));
      const gallery=$('multiPhotoGallery');if(gallery&&!$('v22MultiGallery')){const g=document.createElement('button');g.id='v22MultiGallery';g.className='btn outline';g.textContent='🖼 갤러리에서 기준라벨 불러오기';g.onclick=()=>gallery.click();mc.insertBefore(g,$('readerWrapMulti'));}
    }
    const step=$('stepScan');if(step&&!$('v22ManualPallet')){
      const b=document.createElement('button');b.id='v22ManualPallet';b.className='loop-btn';b.innerHTML='<span class="loop-ic">✍</span><span>코드 없음 / 직접 등록</span><span class="loop-chk"></span>';b.onclick=V22.manualPallet;step.insertAdjacentElement('afterend',b);
    }
  }

  function enhanceProductionUi(){
    const reg=$('prodRegistrant'); if(reg){
      const field=reg.closest('.field'); const btn=$('prodSetupCard')&&$('prodSetupCard').querySelector('button.primary');
      if(field&&btn){field.querySelector('label').textContent='작업자명 (필수)';btn.parentNode.insertBefore(field,btn);reg.placeholder='예: 홍길동';}
    }
    const run=$('prodRunCard'); if(run && !$('v22ProdShared')){
      const info=document.createElement('div');info.id='v22ProdShared';info.className='v22-shared';info.textContent='공동 작업 세션 · 같은 제품/제조번호 작업자는 자동으로 같은 세션에 참여합니다.';
      run.insertBefore(info,run.querySelector('.run-banner').nextSibling);
    }
  }

  function stopProdPoll(){if(V22.prodPoll){clearInterval(V22.prodPoll);V22.prodPoll=null;}}
  async function syncProdSession(){
    if(!prodSession||!prodSession.id)return;
    try{
      const res=await apiGet('productionSession',{id:prodSession.id});
      if(!res.ok)return;
      if(res.closed){setStatus('saveProdStatus','이 생산 세션은 종료되었습니다. 새 작업을 시작하세요.','warn');stopProdPoll();return;}
      prodSelectedPallets=res.pallets||[];
      if($('v22ProdShared'))$('v22ProdShared').innerHTML='공동 작업 · 참여자 <b>'+e((res.workers||[]).join(', ')||prodSession.worker)+'</b> · 서버 기준 '+(res.palletCount||0)+' 파레트';
      renderProdSelected();
    }catch(_){ }
  }

  window.startProductionSession=async function(){
    const get=id=>$(id).value.trim();
    const productName=get('prodProductName'),lotNo=get('prodLotNo'),worker=get('prodRegistrant');
    if(!productName){setStatus('prodSetupStatus','제품명을 입력하세요.','bad');return;}
    if(!lotNo){setStatus('prodSetupStatus','제조번호를 입력하세요.','bad');return;}
    if(!worker){setStatus('prodSetupStatus','작업자명을 입력하세요. 여러 명 작업 시 구분에 필요합니다.','bad');return;}
    setStatus('prodSetupStatus','공동 작업 세션 확인 중...','warn');
    try{
      const res=await apiPost('startProduction',{productName,lotNo,prodDate:get('prodDate'),prodQty:get('prodQty'),note:get('prodNote'),registrant:worker,worker});
      if(!res.ok){setStatus('prodSetupStatus','시작 실패: '+res.message,'bad');return;}
      prodSession={id:res.id,productName,lotNo,worker};rememberInspector(worker);
      $('prodSetupCard').classList.add('hidden');$('prodRunCard').classList.remove('hidden');
      $('runProduct').textContent=productName;$('runLot').textContent=lotNo+' · '+worker;
      prodSelectedPallets=res.pallets||[];renderProdSelected();
      const v22Backend=Array.isArray(res.workers)||res.joined!==undefined;
      setStatus('prodSearchStatus',res.joined?'기존 공동 작업에 참여했습니다. 파레트를 스캔하세요.':'작업을 시작했습니다. 파레트를 스캔하세요.','ok');
      setStatus('saveProdStatus',v22Backend?'공동 세션 · 스캔할 때마다 서버에 즉시 저장됩니다.':'기본 저장 모드 · Apps Script V22 재배포 후 공동 작업 보호가 활성화됩니다.','');
      stopProdPoll();if(v22Backend){V22.prodPoll=setInterval(syncProdSession,5000);syncProdSession();}
    }catch(err){setStatus('prodSetupStatus','시작 실패: '+err,'bad');}
  };

  window.addProdPallet=async function(it){
    if(!it||!prodSession)return;
    if(prodSelectedPallets.some(x=>palletKey(x)===palletKey(it))){setStatus('prodSearchStatus','이미 공동 작업에 등록된 파레트입니다.','warn');return;}
    if(navigator.vibrate)navigator.vibrate(50);
    setStatus('prodSearchStatus','등록 중 · '+it.inboundNo+'-'+it.containerNo,'warn');
    try{
      const res=await apiPost('addProductionPallet',Object.assign({productionId:prodSession.id,worker:prodSession.worker},it));
      if(res.duplicate){setStatus('prodSearchStatus','다른 작업자가 이미 등록한 파레트입니다.','warn');await syncProdSession();return;}
      if(!res.ok){setStatus('prodSearchStatus','저장 실패: '+res.message,'bad');return;}
      setStatus('prodSearchStatus','등록 완료 · '+it.inboundNo+'-'+it.containerNo+' · 다음 파레트를 스캔하세요.','ok');
      await syncProdSession();
    }catch(err){setStatus('prodSearchStatus','저장 실패: '+err,'bad');}
  };

  window.renderProdSelected=function(){
    const total=prodSelectedPallets.reduce((s,p)=>s+(Number(String(p.qty||'').replace(/,/g,''))||0),0);
    if($('prodPalletCount'))$('prodPalletCount').textContent=prodSelectedPallets.length;
    if($('prodPalletTotal'))$('prodPalletTotal').textContent=total.toLocaleString();
    if($('runCount'))$('runCount').textContent=prodSelectedPallets.length;
    const box=$('prodSelected');if(!box)return;
    if(!prodSelectedPallets.length){box.innerHTML='<div class="status">아직 등록한 파레트가 없습니다.</div>';return;}
    box.innerHTML=prodSelectedPallets.slice().reverse().map(p=>`<div class="pallet-item"><div><div>${e(p.inboundNo)}-${e(p.containerNo)} · ${e(p.product||'')}</div><div class="code">${Number(String(p.qty||'').replace(/,/g,'')||0).toLocaleString()}${e(p.unit||'')} · ${e(p.result||'')} ${p.worker?'<span class="v22-worker">'+e(p.worker)+'</span>':''}</div></div><div class="tag-ok">✓ 저장</div></div>`).join('');
  };

  window.finishProductionSession=async function(){
    if(!prodSession)return;
    if(!confirm('이 작업은 여러 작업자가 함께 사용할 수 있습니다.\n생산 투입을 최종 종료할까요?'))return;
    const get=id=>$(id).value.trim();
    try{
      const res=await apiPost('finishProduction',{productionId:prodSession.id,note:get('prodNote'),prodQty:get('prodQty'),prodDate:get('prodDate'),worker:prodSession.worker,closeSession:true});
      if(!res.ok){setStatus('saveProdStatus','종료 실패: '+res.message,'bad');return;}
      setStatus('saveProdStatus','최종 종료 · 파레트 '+res.palletCount+'개 ('+Number(res.total||0).toLocaleString()+'개)','ok');
      stopProdPoll();prodSession=null;$('prodRunCard').classList.add('hidden');$('prodSetupCard').classList.remove('hidden');$('prodLotNo').value='';loadRecentProducts();
    }catch(err){setStatus('saveProdStatus','종료 실패: '+err,'bad');}
  };

  function injectViewTools(){
    const results=$('viewSearchResults');if(!results||$('v22ViewTools'))return;
    const bar=document.createElement('div');bar.id='v22ViewTools';bar.className='v22-selectbar hidden';
    bar.innerHTML=`<button class="btn outline" onclick="V22.toggleAll(true)">전체 선택</button><button class="btn outline" onclick="V22.toggleAll(false)">선택 해제</button>
      <button class="btn primary" onclick="V22.printSelected(false)">🖨 선택 기록서</button><button class="btn outline" onclick="V22.printSelected(true)">📷 사진 포함</button>
      <button class="btn outline" onclick="V22.prepareReport('executive')">임원보고</button><button class="btn outline" onclick="V22.prepareReport('investigation')">조사보고서</button>`;
    results.parentNode.insertBefore(bar,results);

    const card=document.createElement('div');card.id='v22ReportBuilder';card.className='card v22-report-card hidden';
    card.innerHTML=`<p class="step-title">보고서 작성</p><div class="v22-report-grid">
      <div class="field span2"><label>목적</label><input id="rPurpose"></div>
      <div class="field span2"><label>결론</label><textarea id="rConclusion"></textarea></div>
      <div class="field"><label>Impact</label><textarea id="rImpact"></textarea></div>
      <div class="field"><label>Risk</label><textarea id="rRisk"></textarea></div>
      <div class="field span2"><label>근본원인</label><textarea id="rCause"></textarea></div>
      <div class="field span2"><label>재발방지대책 / 조치</label><textarea id="rAction"></textarea></div>
      </div><div class="v22-action-row"><button class="btn primary" onclick="V22.printReport()">🖨 보고서 출력</button><button class="btn outline" onclick="document.getElementById('v22ReportBuilder').classList.add('hidden')">닫기</button></div>`;
    $('view').insertBefore(card,$('view').children[1]||null);

    const detail=$('viewDetailCard');if(detail && !$('btnPrintPhotoCurrent')){
      const b=document.createElement('button');b.id='btnPrintPhotoCurrent';b.className='btn outline';b.textContent='📷 사진 포함 A4 출력';b.onclick=()=>V22.printCurrentWithPhotos();
      detail.appendChild(b);
    }
  }

  V22.toggleResult=function(id,checked){if(checked)V22.selectedIds.add(String(id));else V22.selectedIds.delete(String(id));};
  V22.toggleAll=function(flag){
    V22.selectedIds.clear();
    document.querySelectorAll('.v22-record-check').forEach(ch=>{ch.checked=flag;if(flag)V22.selectedIds.add(ch.value);});
  };

  window.searchViewRecords=async function(){
    const kw=$('viewSearchKw').value.trim();if(!kw){setStatus('viewSearchStatus','검색어를 입력하세요.','bad');return;}
    setStatus('viewSearchStatus','빠른 검색 중...','warn');$('viewDetailCard').classList.add('hidden');V22.selectedIds.clear();
    try{
      const res=await apiGet('searchRecords',{keyword:kw});
      if(!res.ok){setStatus('viewSearchStatus','검색 실패: '+res.message,'bad');return;}
      viewSearchResultsList=res.items||[];const box=$('viewSearchResults');$('v22ViewTools').classList.toggle('hidden',!viewSearchResultsList.length);
      if(!viewSearchResultsList.length){box.innerHTML='';setStatus('viewSearchStatus','일치하는 기록이 없습니다.','bad');return;}
      setStatus('viewSearchStatus',viewSearchResultsList.length+'건 검색됨 · 여러 건을 체크해서 한 번에 출력할 수 있습니다.','ok');
      box.innerHTML=viewSearchResultsList.map((it,i)=>`<div class="v22-result"><input class="v22-record-check" type="checkbox" value="${e(it.id)}" onchange="V22.toggleResult(this.value,this.checked)"><div class="main" onclick="openRecordDetail(${i})"><div><b>${e(it.product)}</b> · ${e(String(it.qty))}${e(it.unit||'')}</div><div class="meta">입고번호 ${e(it.inboundNo)} · ${e(it.mode)} · ${e(it.regDate)}</div></div><button class="go" onclick="openRecordDetail(${i})">›</button></div>`).join('');
    }catch(err){setStatus('viewSearchStatus','검색 실패: '+err,'bad');}
  };

  function selectedIds(){
    const ids=Array.from(V22.selectedIds);if(ids.length)return ids;
    if(currentViewRecord&&currentViewRecord.record)return [String(currentViewRecord.record.id)];
    return [];
  }

  async function batchRecords(ids){
    const res=await apiPost('batchGetRecords',{ids});
    if(res.ok)return res.items||[];
    // V21 백엔드가 아직 재배포되지 않은 경우에도 출력은 기존 API로 동작
    const items=[];
    for(const id of ids){const one=await apiGet('getRecord',{id});if(one&&one.ok)items.push({record:one.record,pallets:one.pallets||[]});}
    if(!items.length)throw new Error(res.message||'기록 조회 실패');
    return items;
  }

  function photoUrlsFor(items){
    const urls=[];const add=u=>{String(u||'').split(',').map(x=>x.trim()).filter(Boolean).forEach(x=>{if(urls.indexOf(x)<0)urls.push(x);});};
    items.forEach(it=>{
      add(it.record.labelPhotoUrl);add(it.record.vendorPhotoUrl);add(it.record.itemPhotoUrl);
      (it.pallets||[]).slice(0,6).forEach(p=>{add(p.wmsPhotoUrl);add(p.vendorPhotoUrl);});
    });
    return urls.slice(0,36);
  }

  async function hydratePhotos(items){
    const urls=photoUrlsFor(items).filter(u=>!V22.photoCache.has(u));
    for(let i=0;i<urls.length;i+=6){
      const part=urls.slice(i,i+6);const res=await apiPost('photoDataBatch',{urls:part});
      if(res.ok)Object.keys(res.items||{}).forEach(k=>V22.photoCache.set(k,res.items[k]));
    }
  }

  function dataImg(url){return V22.photoCache.get(String(url||'').trim())||'';}
  function photoHtml(url,label){const src=dataImg(url);return src?`<figure><img src="${src}"><figcaption>${e(label)}</figcaption></figure>`:'';}

  function recordPage(item,withPhotos){
    const r=item.record,p=item.pallets||[];
    const tr=(a,b)=>`<tr><th>${e(a)}</th><td>${e(b==null?'':b)}</td></tr>`;
    const photos=[];
    if(withPhotos){
      if(r.labelPhotoUrl)photos.push(photoHtml(String(r.labelPhotoUrl).split(',')[0],'WMS 라벨'));
      if(r.vendorPhotoUrl)photos.push(photoHtml(String(r.vendorPhotoUrl).split(',')[0],'업체 라벨'));
      String(r.itemPhotoUrl||'').split(',').slice(0,4).forEach((u,i)=>photos.push(photoHtml(u,'공병 실물 '+(i+1))));
      p.slice(0,4).forEach((x,i)=>{if(x.wmsPhotoUrl)photos.push(photoHtml(x.wmsPhotoUrl,'P'+(i+1)+' WMS'));if(x.vendorPhotoUrl)photos.push(photoHtml(x.vendorPhotoUrl,'P'+(i+1)+' 업체'));});
    }
    return `<section class="sheet"><h1>공병 입고 확인 기록서</h1><div class="meta">기록 ID ${e(r.id)} · ${e(r.regDate)} · ${e(r.mode)}</div>
      <table class="info">${tr('입고번호',r.inboundNo)}${tr('입고일자',r.inboundDate)}${tr('품명',r.product)}${tr('품목코드',r.itemCode)}${tr('공급업체',r.supplier)}${tr('표시수량',r.displayQty)}${r.actualQty?tr('실제 확인수량',r.actualQty):''}${r.palletCount?tr('파레트 수',r.palletCount):''}${r.totalQty?tr('총 수량',r.totalQty):''}${tr('최종 결과',r.finalResult)}${tr('검수자',r.inspector)}${tr('특이사항',r.note)}</table>
      ${p.length?`<table><tr><th>#</th><th>용기번호</th><th>품명</th><th>수량</th><th>판정</th></tr>${p.map(x=>`<tr><td>${e(x.seq)}</td><td>${e(x.containerNo||x.code)}</td><td>${e(x.product)}</td><td>${e(x.qty)}${e(x.unit||'')}</td><td>${e(x.result)}</td></tr>`).join('')}</table>`:''}
      ${withPhotos&&photos.filter(Boolean).length?`<h2>증빙 사진</h2><div class="photos">${photos.join('')}</div>`:''}
      <div class="sign"><div>검수자</div><div>확인자</div></div></section>`;
  }

  function printCss(){return `<style>@page{size:A4;margin:10mm}*{box-sizing:border-box}body{font-family:'Malgun Gothic',sans-serif;color:#111;margin:0} .sheet{page-break-after:always;min-height:270mm;padding:2mm}.sheet:last-child{page-break-after:auto}h1{font-size:18px;margin:0 0 6px;border-bottom:2px solid #1F4B5F;padding-bottom:6px}h2{font-size:13px;margin:12px 0 5px}.meta{font-size:10px;color:#666;margin-bottom:7px}table{width:100%;border-collapse:collapse;font-size:10px;margin:7px 0}th,td{border:1px solid #aaa;padding:4px 5px}th{background:#f1f0eb}.info th{width:25%}.photos{display:grid;grid-template-columns:repeat(3,1fr);gap:5px}.photos figure{margin:0;border:1px solid #ccc;padding:3px}.photos img{width:100%;height:42mm;object-fit:contain;display:block}.photos figcaption{text-align:center;font-size:9px;margin-top:2px}.sign{display:flex;justify-content:flex-end;gap:25px;margin-top:16px;font-size:10px}.sign div{width:100px;border-top:1px solid #333;text-align:center;padding-top:4px}.report-box{border:1px solid #999;margin:7px 0}.report-row{display:grid;grid-template-columns:26mm 1fr;border-bottom:1px solid #bbb}.report-row:last-child{border-bottom:0}.report-row b{background:#f1f0eb;padding:6px}.report-row div{padding:6px;white-space:pre-wrap}.timeline{display:flex;gap:8px;font-size:10px;align-items:center;flex-wrap:wrap}.timeline span{padding:4px 7px;border:1px solid #bbb;border-radius:20px}</style>`;}

  async function printItems(items,withPhotos,title,win){
    if(withPhotos)await hydratePhotos(items);
    const html=`<!doctype html><html lang="ko"><head><meta charset="utf-8"><title>${e(title||'공병 입고 확인 기록서')}</title>${printCss()}</head><body>${items.map(x=>recordPage(x,withPhotos)).join('')}<script>window.onload=()=>setTimeout(()=>window.print(),300)<\/script></body></html>`;
    win.document.open();win.document.write(html);win.document.close();
  }

  V22.printSelected=async function(withPhotos){
    const ids=selectedIds();if(!ids.length){alert('출력할 기록을 선택하세요.');return;}
    const w=window.open('','_blank');if(!w){alert('팝업을 허용해주세요.');return;}
    w.document.write('<p style="font-family:sans-serif">기록을 불러오는 중...</p>');
    try{const items=await batchRecords(ids);await printItems(items,withPhotos,withPhotos?'사진 포함 기록서':'공병 입고 확인 기록서',w);}catch(err){w.document.body.innerHTML='<pre>'+e(err)+'</pre>';}
  };

  V22.printCurrentWithPhotos=async function(){
    if(!currentViewRecord)return;V22.selectedIds.clear();V22.selectedIds.add(String(currentViewRecord.record.id));return V22.printSelected(true);
  };

  V22.prepareReport=async function(kind){
    const ids=selectedIds();if(!ids.length){alert('보고서에 포함할 기록을 먼저 선택하세요.');return;}
    showBusy('보고자료를 구성하는 중...');
    try{
      const items=await batchRecords(ids);V22.reportData=items;V22.reportKind=kind;
      const recs=items.map(x=>x.record), issues=recs.filter(r=>String(r.finalResult)!=='적합'||String(r.mixed)==='있음'||String(r.labelMatch)==='불일치');
      const inbound=[...new Set(recs.map(r=>r.inboundNo).filter(Boolean))];
      const products=[...new Set(recs.map(r=>r.product).filter(Boolean))];
      const notes=recs.map(r=>String(r.note||'').trim()).filter(Boolean);
      $('rPurpose').value=`${products.join(', ')||'공병'} 입고 검수 ${recs.length}건의 확인 결과 및 영향성을 검토하고자 함.`;
      $('rConclusion').value=`선택 기록 ${recs.length}건 / 입고번호 ${inbound.length}건 중 확인 필요 ${issues.length}건. ${issues.length?'이상 기록은 실물·라벨 및 생산 투입 연계 여부 추가 확인 필요.':'선택 기록 기준 특이 이상 없음.'}`;
      $('rImpact').value=issues.length?`현재 선택 검수기록에서 확인 필요 ${issues.length}건 확인. 생산 영향은 해당 공병의 실제 투입 여부와 연계하여 판단 필요.`:'선택 검수기록 기준 입고정보·혼입·수량에서 확인 필요 건 없음.';
      $('rRisk').value=issues.length?'라벨 불일치, 혼입 또는 수량 차이가 생산 투입 전 확인되지 않을 경우 오투입 및 추적성 저하 가능.':'선택 기록 내 확인 필요 표시는 없으나 생산 투입 시 용기번호 추적 유지 필요.';
      $('rCause').value=notes.length?notes.slice(0,5).join('\n'):'조사 결과 입력 필요';
      $('rAction').value=issues.length?'확인 필요 파레트 식별·격리 → 실물/라벨 재확인 → 공급업체 원인조사 및 재발방지대책 확인 → 필요 시 입고검수 기준 반영':'현행 입고 검수 및 생산 투입 추적 유지';
      $('v22ReportBuilder').classList.remove('hidden');$('v22ReportBuilder').scrollIntoView({behavior:'smooth',block:'start'});
    }catch(err){alert('보고서 준비 실패: '+err);}finally{hideBusy();}
  };

  function reportSummaryPage(items,kind){
    const get=id=>e($(id).value||'');
    const recs=items.map(x=>x.record);const dates=recs.map(r=>r.regDate).filter(Boolean).slice(0,5);
    const photos=[];items.forEach(it=>{if(it.record.labelPhotoUrl)photos.push(photoHtml(String(it.record.labelPhotoUrl).split(',')[0],'WMS'));if(it.record.vendorPhotoUrl)photos.push(photoHtml(String(it.record.vendorPhotoUrl).split(',')[0],'업체'));});
    return `<section class="sheet"><h1>${kind==='executive'?'공병 입고 검수 임원보고':'공병 입고 이상 조사보고서'}</h1><div class="report-box">
      <div class="report-row"><b>목적</b><div>${get('rPurpose')}</div></div><div class="report-row"><b>결론</b><div>${get('rConclusion')}</div></div>
      <div class="report-row"><b>Impact</b><div>${get('rImpact')}</div></div><div class="report-row"><b>Risk</b><div>${get('rRisk')}</div></div>
      <div class="report-row"><b>근본원인</b><div>${get('rCause')}</div></div><div class="report-row"><b>재발방지</b><div>${get('rAction')}</div></div></div>
      <h2>검수 Timeline</h2><div class="timeline">${dates.map(d=>`<span>${e(d)}</span>`).join(' → ')}</div>
      <h2>대상 기록</h2><table><tr><th>입고번호</th><th>품명</th><th>모드</th><th>결과</th><th>검수자</th></tr>${recs.slice(0,8).map(r=>`<tr><td>${e(r.inboundNo)}</td><td>${e(r.product)}</td><td>${e(r.mode)}</td><td>${e(r.finalResult)}</td><td>${e(r.inspector)}</td></tr>`).join('')}${recs.length>8?`<tr><td colspan="5">외 ${recs.length-8}건</td></tr>`:''}</table>
      ${photos.filter(Boolean).length?`<div class="photos">${photos.slice(0,2).join('')}</div>`:''}</section>`;
  }

  V22.printReport=async function(){
    const items=V22.reportData;if(!items||!items.length)return;
    const w=window.open('','_blank');if(!w){alert('팝업을 허용해주세요.');return;}w.document.write('<p>보고서 준비 중...</p>');
    try{
      await hydratePhotos(items);const kind=V22.reportKind;
      const details=kind==='investigation'?items.map(x=>recordPage(x,true)).join(''):'';
      const html=`<!doctype html><html lang="ko"><head><meta charset="utf-8"><title>${kind==='executive'?'공병 입고 임원보고':'공병 입고 조사보고서'}</title>${printCss()}</head><body>${reportSummaryPage(items,kind)}${details}<script>window.onload=()=>setTimeout(()=>window.print(),400)<\/script></body></html>`;
      w.document.open();w.document.write(html);w.document.close();
    }catch(err){w.document.body.innerHTML='<pre>'+e(err)+'</pre>';}
  };

  const _v21ShowTab=window.showTab;
  window.showTab=function(tab){
    Object.keys(V22.live).forEach(m=>V22.stopLive(m,false));
    return _v21ShowTab(tab);
  };

  function init(){
    injectQuickStart();injectManualButtons();enhanceProductionUi();injectViewTools();
    // 기존 V21 실시간 OCR 코드에 화면이 없던 부분을 실제 UI로 연결
    insertLiveUi('wms','readerWrapSingle','WMS 라벨');
    insertLiveUi('vendor','vendorPreview','업체 라벨');
    insertLiveUi('multi','readerWrapMulti','기준 라벨');
    const sub=document.querySelector('header .sub');if(sub)sub.textContent='스캔 · 실시간 OCR · 촬영 · 입고/생산 추적';
    const labels={tabDash:'홈/현황',tabSingle:'단건',tabMulti:'다중',tabProd:'생산',tabView:'조회/보고'};Object.keys(labels).forEach(id=>{if($(id))$(id).textContent=labels[id];});
    try{showTab('dash');}catch(_){}
    // OCR worker 사전 로딩: 첫 촬영 때 대기시간 감소
    setTimeout(()=>{try{getOcrWorker('ocrProgressWms');}catch(_){ }},800);
    setTimeout(()=>{try{if(typeof loadDashboard==='function')loadDashboard();}catch(_){ }},200);
  }

  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init);else init();
})();
