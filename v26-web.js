/* 공병 입고 확인 V26 Web Improvement
 * V26-WEB-3
 * - Tesseract 미사용
 * - Google Drive OCR 단일 엔진
 * - WMS 단건 바코드 UI 제거
 * - 카메라 자동 인식은 1회 호출 후 즉시 종료 (Drive OCR rate limit 보호)
 * - 사진/갤러리/직접입력 유지
 * - 기존 로그인/DB/조회/보고서/생산 로직은 유지
 */
(function(){
  'use strict';

  if(window.__EMPTY_BOTTLE_V26_WEB__) return;
  window.__EMPTY_BOTTLE_V26_WEB__ = true;

  const $ = id => document.getElementById(id);
  const V26W = window.V26W = {
    VERSION:'V26-WEB-3',
    live:{},
    busy:false,
    lastLatency:0,
    lastError:'',
    cooldownUntil:0,
    lastRequestAt:0
  };

  function statusId(mode){
    return mode==='vendor'?'vendorStatus':(mode==='multi'?'multiBaseStatus':'wmsStatus');
  }
  function previewId(mode){
    return mode==='vendor'?'vendorPreview':(mode==='multi'?'multiPreview':'wmsPreview');
  }
  function parseForMode(mode,text){
    return mode==='vendor' ? parseVendorLabel(text||'') : parseLabelText(text||'');
  }
  function fieldCount(obj){
    return Object.keys(obj||{}).filter(k=>String(obj[k]||'').trim()).length;
  }
  function isRateLimitMessage(s){
    return /user rate limit|rate limit exceeded|quota|too many requests|\b429\b/i.test(String(s||''));
  }
  function friendlyError(err){
    const s=String(err&&err.message?err.message:err||'알 수 없는 오류');
    if(/^Google OCR 호출 한도 초과|^로그인 세션 확인 필요|^Google Drive OCR 권한 확인 필요|^Apps Script OCR 기능 배포 상태 확인 필요|^이미지 용량이 커서|^네트워크 연결 확인 필요/.test(s)) return s;
    if(isRateLimitMessage(s)) return 'Google OCR 호출 한도 초과 · 약 1분 후 다시 시도하세요.';
    if(/AUTH_REQUIRED|세션|로그인/i.test(s)) return '로그인 세션 확인 필요 · '+s;
    if(/권한|permission|forbidden|access denied/i.test(s)) return 'Google Drive OCR 권한 확인 필요 · '+s;
    if(/action|ocr/i.test(s)&&/알 수 없는|unknown|지원/i.test(s)) return 'Apps Script OCR 기능 배포 상태 확인 필요 · '+s;
    if(/payload|too large|크기|용량|413/i.test(s)) return '이미지 용량이 커서 전송 실패 · 사진을 다시 촬영해 주세요.';
    if(/Failed to fetch|network|네트워크|timeout/i.test(s)) return '네트워크 연결 확인 필요 · '+s;
    return s;
  }

  async function googleOcr(dataUrl, fastMode){
    const now=Date.now();
    if(now<V26W.cooldownUntil){
      const sec=Math.max(1,Math.ceil((V26W.cooldownUntil-now)/1000));
      throw new Error('Google OCR 호출 한도 초과 · '+sec+'초 후 다시 시도하세요.');
    }
    if(V26W.busy) throw new Error('Google OCR 처리 중입니다. 잠시 후 다시 시도하세요.');
    if(!CONFIG || !CONFIG.API_URL) throw new Error('Apps Script API 주소가 설정되지 않았습니다.');

    V26W.busy=true;
    V26W.lastError='';
    V26W.lastRequestAt=Date.now();
    const started=Date.now();
    try{
      const maxSide=fastMode?1600:2200;
      const quality=fastMode?0.82:0.88;
      const sending=await shrinkForUpload(dataUrl,maxSide,quality);
      const res=await apiPost('ocr',{image:sending,source:'v26-web3',live:false});
      if(!res || !res.ok){
        const code=res&&res.code?(' ['+res.code+']'):'';
        throw new Error((res&&res.message?res.message:'Google OCR 응답 실패')+code);
      }
      const text=String(res.text||'').trim();
      if(!text) throw new Error('Google OCR이 글자를 찾지 못했습니다. 라벨을 더 가까이/정면으로 맞춰주세요.');
      V26W.lastLatency=Date.now()-started;
      try{lastOcrEngine='Google Drive OCR';lastOcrError='';}catch(_){ }
      return {text,latency:V26W.lastLatency};
    }catch(err){
      V26W.lastLatency=Date.now()-started;
      const raw=String(err&&err.message?err.message:err||'');
      if(isRateLimitMessage(raw)) V26W.cooldownUntil=Date.now()+60000;
      V26W.lastError=friendlyError(err);
      try{lastOcrEngine='Google Drive OCR';lastOcrError=V26W.lastError;}catch(_){ }
      throw new Error(V26W.lastError);
    }finally{
      V26W.busy=false;
    }
  }
  V26W.googleOcr=googleOcr;

  function applyGoogleResult(mode,text,dataUrl,label,latency){
    const parsed=parseForMode(mode,text);
    const storedPromise=shrinkForUpload(dataUrl,1400,.72);
    if(mode==='vendor'){
      lastOcrText.vendor=text;
      if(parsed.product)$('vProduct').value=parsed.product;
      if(parsed.qty)$('vQty').value=parsed.qty;
      if(parsed.prodDate)$('vProdDate').value=parsed.prodDate;
      if(parsed.prodTime)$('vProdTime').value=parsed.prodTime;
      if(parsed.lotNo)$('vLotNo').value=parsed.lotNo;
      if(parsed.palletNo&&$('vPalletNo'))$('vPalletNo').value=parsed.palletNo;
      if(parsed.line)$('vLine').value=parsed.line;
      try{compareLabels();}catch(_){ }
    }else if(mode==='multi'){
      if(parsed.product)$('mProduct').value=parsed.product;
      if(parsed.itemCode)$('mItemCode').value=parsed.itemCode;
      if(parsed.supplier)$('mSupplier').value=parsed.supplier;
      if(parsed.displayQty)$('mQty').value=parsed.displayQty;
      if(parsed.inboundNo)$('mInboundNo').value=parsed.inboundNo;
      lastOcrText.multi=text;
    }else{
      lastOcrText.wms=text;
      lastOcrText.single=text;
      applyParsed(parsed,false);
      try{compareLabels();}catch(_){ }
    }

    storedPromise.then(stored=>{
      if(mode==='vendor') lastPhotoDataUrl.vendor=stored;
      else if(mode==='multi') lastPhotoDataUrl.multi=stored;
      else {lastPhotoDataUrl.wms=stored;lastPhotoDataUrl.single=stored;}
    }).catch(()=>{});

    try{showOcrRaw(mode);}catch(_){ }
    const n=fieldCount(parsed);
    setStatus(statusId(mode),(label||'Google OCR 완료')+' · '+n+'개 항목 · '+latency+'ms','ok');
    return {parsed,count:n};
  }

  window.labelPhotoSelected=async function(event,mode){
    const file=event.target.files&&event.target.files[0];
    if(!file)return;
    event.target.value='';
    const dataUrl=await fileToDataUrl(file);
    const preview=$(previewId(mode));
    if(preview){preview.src=dataUrl;preview.classList.remove('hidden');}
    const sid=statusId(mode);
    setStatus(sid,'Google OCR 인식 중...','warn');
    try{
      const r=await googleOcr(dataUrl,false);
      const out=applyGoogleResult(mode,r.text,dataUrl,'Google OCR 인식 완료',r.latency);
      if(out.count<2)setStatus(sid,'Google OCR 결과가 부족합니다 · 라벨을 정면에서 더 가까이 촬영하거나 직접 입력하세요.','warn');
    }catch(err){
      setStatus(sid,'Google OCR 실패 · '+friendlyError(err),'bad');
    }
  };

  window.runOcr=async function(dataUrl){
    const r=await googleOcr(dataUrl,false);
    return r.text;
  };
  window.getOcrWorker=async function(){
    throw new Error('V26에서는 Tesseract를 사용하지 않습니다.');
  };

  function cropLive(video,maxSide){
    const vw=video.videoWidth,vh=video.videoHeight;
    if(!vw||!vh)return '';
    const sx=Math.round(vw*.05),sy=Math.round(vh*.10),sw=Math.round(vw*.90),sh=Math.round(vh*.80);
    const scale=Math.min(1,(maxSide||1800)/Math.max(sw,sh));
    const c=document.createElement('canvas');
    c.width=Math.max(1,Math.round(sw*scale));
    c.height=Math.max(1,Math.round(sh*scale));
    const ctx=c.getContext('2d');
    ctx.imageSmoothingEnabled=true;
    ctx.imageSmoothingQuality='high';
    ctx.drawImage(video,sx,sy,sw,sh,0,0,c.width,c.height);
    return c.toDataURL('image/jpeg',.84);
  }

  if(window.V22){
    V22.startLive=async function(mode){
      Object.keys(V26W.live).forEach(m=>{if(m!==mode)V22.stopLive(m,false);});
      V22.stopLive(mode,false);
      try{if(typeof stopScanner==='function')await stopScanner();}catch(_){ }
      const video=$('v22LiveVideo_'+mode),wrap=$('v22LiveWrap_'+mode);
      if(!video||!wrap)return;
      const sid=statusId(mode);
      try{
        const stream=await navigator.mediaDevices.getUserMedia({
          video:{facingMode:{ideal:'environment'},width:{ideal:1920},height:{ideal:1080}},audio:false
        });
        V26W.live[mode]={stream,running:true,timer:null};
        video.srcObject=stream;
        await video.play();
        wrap.classList.remove('hidden');
        setStatus(sid,'라벨을 화면 중앙에 맞추세요 · 1.2초 후 자동으로 한 번 인식합니다.','warn');
        V26W.live[mode].timer=setTimeout(()=>V22.liveTick(mode),1200);
      }catch(err){
        setStatus(sid,'카메라 실행 실패 · '+friendlyError(err),'bad');
      }
    };

    V22.liveTick=async function(mode){
      const st=V26W.live[mode],video=$('v22LiveVideo_'+mode);
      if(!st||!st.running||!video||!video.videoWidth)return;
      const sid=statusId(mode);
      const data=cropLive(video,1800);
      if(!data){V22.stopLive(mode,false);return;}
      const preview=$(previewId(mode));
      if(preview){preview.src=data;preview.classList.remove('hidden');}
      setStatus(sid,'Google OCR 자동 인식 중...','warn');
      try{
        const r=await googleOcr(data,true);
        const out=applyGoogleResult(mode,r.text,data,'Google OCR 자동 인식 완료',r.latency);
        if(out.count<2)setStatus(sid,'인식 결과가 부족합니다 · 사진 촬영 또는 직접 입력을 사용하세요.','warn');
      }catch(err){
        setStatus(sid,'Google OCR 실패 · '+friendlyError(err),'bad');
      }finally{
        V22.stopLive(mode,false);
      }
    };

    V22.captureLive=async function(mode){
      const video=$('v22LiveVideo_'+mode);if(!video||!video.videoWidth)return;
      const data=cropLive(video,2200);if(!data)return;
      const preview=$(previewId(mode));if(preview){preview.src=data;preview.classList.remove('hidden');}
      setStatus(statusId(mode),'현재 화면 Google OCR 인식 중...','warn');
      try{
        const r=await googleOcr(data,false);
        applyGoogleResult(mode,r.text,data,'Google OCR 촬영 완료',r.latency);
      }catch(err){
        setStatus(statusId(mode),'Google OCR 실패 · '+friendlyError(err),'bad');
      }finally{
        V22.stopLive(mode,false);
      }
    };

    V22.stopLive=function(mode,showStatus){
      const st=V26W.live[mode];
      if(st){
        st.running=false;
        if(st.timer)clearTimeout(st.timer);
        if(st.stream)st.stream.getTracks().forEach(t=>t.stop());
        delete V26W.live[mode];
      }
      const wrap=$('v22LiveWrap_'+mode);if(wrap)wrap.classList.add('hidden');
      if(showStatus!==false&&$(statusId(mode)))setStatus(statusId(mode),'카메라 중지 · 입력 내용을 확인하세요.','');
    };
  }

  function scrollToField(id){
    const el=$(id);if(!el)return;
    el.scrollIntoView({behavior:'smooth',block:'center'});
    setTimeout(()=>el.focus(),250);
  }

  V26W.manualWms=function(){
    try{if(window.V22)V22.stopLive('wms',false);}catch(_){ }
    setStatus('wmsStatus','직접 입력 모드 · 아래 WMS 입고정보를 입력하세요.','warn');
    scrollToField('inboundNo');
  };
  V26W.manualVendor=function(){
    try{if(window.V22)V22.stopLive('vendor',false);}catch(_){ }
    setStatus('vendorStatus','직접 입력 모드 · 아래 업체 라벨 정보를 입력하세요.','warn');
    scrollToField('vProduct');
  };

  function createActionGrid(mode,card){
    const id='v26Actions_'+mode;
    if($(id)||!card)return;
    const isVendor=mode==='vendor';
    const wrap=document.createElement('div');
    wrap.id=id;
    wrap.style.cssText='display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:10px;';
    wrap.innerHTML=`
      <button type="button" class="btn primary" onclick="V22.startLive('${mode}')">🎥 카메라 자동 인식</button>
      <button type="button" class="btn outline" onclick="document.getElementById('${isVendor?'vendorPhoto':'wmsPhoto'}').click()">📷 사진 촬영</button>
      <button type="button" class="btn outline" onclick="document.getElementById('${isVendor?'vendorPhotoGallery':'wmsPhotoGallery'}').click()">🖼 갤러리</button>
      <button type="button" class="btn outline" onclick="V26W.${isVendor?'manualVendor':'manualWms'}()">✍ 직접 입력</button>`;
    const title=card.querySelector('.step-title');
    if(title)title.insertAdjacentElement('afterend',wrap);else card.insertBefore(wrap,card.firstChild);
  }

  function simplifySingleUi(){
    const single=$('single');if(!single)return;
    const cards=single.querySelectorAll(':scope > .card');
    const wmsCard=cards[0],vendorCard=cards[1];

    const scan=$('btnScanSingle');if(scan)scan.classList.add('hidden');
    const reader=$('readerWrapSingle');if(reader)reader.classList.add('hidden');

    if(wmsCard){
      Array.from(wmsCard.querySelectorAll('button')).forEach(b=>{
        if(b.closest('#v26Actions_wms'))return;
        if(b.id==='btnScanSingle'||/라벨 촬영|갤러리|실시간|자동 인식|직접 입력|코드 없음/.test(b.textContent||''))b.classList.add('hidden');
      });
      createActionGrid('wms',wmsCard);
    }
    if(vendorCard){
      Array.from(vendorCard.querySelectorAll('button')).forEach(b=>{
        if(b.closest('#v26Actions_vendor'))return;
        if(/업체 라벨 촬영|갤러리|실시간|자동 인식|카메라 중지/.test(b.textContent||''))b.classList.add('hidden');
      });
      createActionGrid('vendor',vendorCard);
    }

    single.querySelectorAll('.v22-action-row').forEach(row=>row.classList.add('hidden'));

    const code=$('codeRaw');
    if(code){const f=code.closest('.field');if(f)f.classList.add('hidden');}

    const manual=$('v22ManualSingle');if(manual)manual.classList.add('hidden');
    const sub=document.querySelector('header .sub');if(sub)sub.textContent='WMS/업체 라벨 Google OCR · Google Sheets 저장';

    const wst=$('wmsStatus');
    if(wst&&!wst.dataset.v26){wst.dataset.v26='1';wst.textContent='카메라 자동 인식 또는 사진 촬영으로 WMS 라벨을 읽습니다.';}
    const vst=$('vendorStatus');
    if(vst&&!vst.dataset.v26){vst.dataset.v26='1';vst.textContent='카메라 자동 인식 또는 사진 촬영으로 업체 라벨을 읽습니다.';}

    try{window.Tesseract=undefined;}catch(_){ }
  }

  function init(){
    simplifySingleUi();
    setTimeout(simplifySingleUi,400);
    setTimeout(simplifySingleUi,1500);
    console.info('[V26-WEB-3] Google Drive OCR protected single-call mode active');
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init,{once:true});else init();
})();
