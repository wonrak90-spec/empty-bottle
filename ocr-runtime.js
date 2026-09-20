/* OCR Runtime V1 — production
 * Single owner for camera lifecycle + V4.6 assisted OCR.
 * Replaces the runtime responsibilities previously split across:
 *   v22.js / v26-korean-ocr.js / v26-wms-cardscan.js / v26-vendor-cardscan.js
 * The legacy files may remain in the repository for history, but only this
 * module owns V22.startLive/liveTick/captureLive/stopLive/refocus in production.
 */
(function(){
  'use strict';
  if(window.__OCR_RUNTIME_V1__)return;
  window.__OCR_RUNTIME_V1__=true;

  const $=id=>document.getElementById(id);
  const R=window.OcrRuntime={
    VERSION:'OCR-RUNTIME-1.0',
    OCR_RELEASE:'V4.6',
    REQUIRE_WORKER_CONFIRM:true,
    sessions:{wms:null,vendor:null,multi:null},
    seq:0
  };

  function modeOf(mode){return mode==='vendor'?'vendor':(mode==='multi'?'multi':'wms');}
  function typeOf(mode){return mode==='vendor'?'vendor':'wms';}
  function sid(mode){return mode==='vendor'?'vendorStatus':(mode==='multi'?'multiBaseStatus':'wmsStatus');}
  function previewId(mode){return mode==='vendor'?'vendorPreview':(mode==='multi'?'multiPreview':'wmsPreview');}
  function videoId(mode){return 'v22LiveVideo_'+mode;}
  function wrapId(mode){return 'v22LiveWrap_'+mode;}
  function safeError(err){return String(err&&err.message?err.message:err||'알 수 없는 오류');}
  function countFields(p){return Object.keys(p||{}).filter(k=>String(p[k]??'').trim()).length;}

  function parse(mode,text,items){
    try{
      if(mode==='vendor'){
        if(window.V55VendorParser&&typeof V55VendorParser.parse==='function')
          return V55VendorParser.parse(text||'',items||[])||{};
        if(window.V26VendorTemplates&&typeof V26VendorTemplates.parse==='function')
          return V26VendorTemplates.parse(text||'',items||[])||{};
        return typeof window.parseVendorLabel==='function'?parseVendorLabel(text||'')||{}:{};
      }
      if(window.V55WmsParser&&typeof V55WmsParser.parse==='function')
        return V55WmsParser.parse(text||'',items||[])||{};
      return typeof window.parseLabelText==='function'?parseLabelText(text||'')||{}:{};
    }catch(e){
      console.warn('[OCR Runtime] parser fallback',e);
      return {};
    }
  }

  async function recognize(dataUrl,mode,statusId){
    const KO=window.V26KoreanOCR;
    if(!KO||typeof KO.recognize!=='function')throw new Error('한국어 OCR 엔진이 준비되지 않았습니다.');
    const baseline=await KO.recognize(dataUrl,false,statusId||sid(mode));
    let parsed=parse(mode,baseline.text,baseline.items||[]);
    let method='baseline',attempts=[];
    if(window.V55AdaptiveOCR&&typeof V55AdaptiveOCR.recognize==='function'){
      try{
        const out=await V55AdaptiveOCR.recognize(dataUrl,typeOf(mode),baseline);
        if(out&&out.parsed)parsed=out.parsed;
        method=String(out&&out.method||method);
        attempts=Array.isArray(out&&out.attempts)?out.attempts:[];
      }catch(e){
        console.warn('[OCR Runtime] adaptive fallback',e);
      }
    }
    return {
      text:String(baseline.text||''),
      items:baseline.items||[],
      parsed,
      latency:Number(baseline.latency)||0,
      method,
      attempts
    };
  }
  R.recognize=recognize;

  async function storedPhoto(mode,dataUrl){
    let stored=dataUrl;
    try{if(typeof window.shrinkForUpload==='function')stored=await shrinkForUpload(dataUrl,1400,.72);}catch(_){}
    try{
      if(mode==='vendor')lastPhotoDataUrl.vendor=stored;
      else if(mode==='multi')lastPhotoDataUrl.multi=stored;
      else{lastPhotoDataUrl.wms=stored;lastPhotoDataUrl.single=stored;}
    }catch(_){}
    return stored;
  }

  async function applyResult(mode,r,dataUrl,label){
    const p=r&&r.parsed||{},raw=String(r&&r.text||'');
    await storedPhoto(mode,dataUrl);
    try{
      if(mode==='vendor'){
        lastOcrText.vendor=raw;
        if(p.product&&$('vProduct'))$('vProduct').value=p.product;
        if(p.qty&&$('vQty'))$('vQty').value=p.qty;
        if(p.prodDate&&$('vProdDate'))$('vProdDate').value=p.prodDate;
        if(p.prodTime&&$('vProdTime'))$('vProdTime').value=p.prodTime;
        if(p.lotNo&&$('vLotNo'))$('vLotNo').value=p.lotNo;
        if(p.palletNo&&$('vPalletNo'))$('vPalletNo').value=p.palletNo;
        if(p.line&&$('vLine'))$('vLine').value=p.line;
        if(typeof compareLabels==='function')compareLabels();
      }else if(mode==='multi'){
        lastOcrText.multi=raw;
        if(p.product&&$('mProduct'))$('mProduct').value=p.product;
        if(p.itemCode&&$('mItemCode'))$('mItemCode').value=p.itemCode;
        if(p.supplier&&$('mSupplier'))$('mSupplier').value=p.supplier;
        if(p.displayQty&&$('mQty'))$('mQty').value=p.displayQty;
        if(p.inboundNo&&$('mInboundNo'))$('mInboundNo').value=p.inboundNo;
      }else{
        lastOcrText.wms=raw;lastOcrText.single=raw;
        if(typeof applyParsed==='function')applyParsed(p,false);
        if(typeof compareLabels==='function')compareLabels();
      }
    }catch(e){console.warn('[OCR Runtime] apply form',e);}

    try{
      if(p.itemCode&&typeof loadItemInfo==='function')loadItemInfo(p.itemCode);
    }catch(_){}
    try{if(typeof showOcrRaw==='function')showOcrRaw(mode);}catch(_){}
    try{
      if(window.V55OcrLearning&&typeof V55OcrLearning.noteApplied==='function')
        V55OcrLearning.noteApplied(mode,raw,p);
    }catch(_){}

    const n=countFields(p);
    setStatus(sid(mode),(label||'V4.6 OCR 완료')+' · '+n+'개 항목 · 작업자 확인 후 확정하세요.','ok');
    return {count:n,parsed:p};
  }
  R.apply=applyResult;

  function cropVideo(video,maxSide){
    const vw=video&&video.videoWidth||0,vh=video&&video.videoHeight||0;
    if(!vw||!vh)return '';
    const sx=Math.round(vw*.04),sy=Math.round(vh*.08),sw=Math.round(vw*.92),sh=Math.round(vh*.84);
    const scale=Math.min(1,(maxSide||2300)/Math.max(sw,sh));
    const c=document.createElement('canvas');
    c.width=Math.max(1,Math.round(sw*scale));c.height=Math.max(1,Math.round(sh*scale));
    const ctx=c.getContext('2d',{alpha:false});
    ctx.fillStyle='#fff';ctx.fillRect(0,0,c.width,c.height);
    ctx.drawImage(video,sx,sy,sw,sh,0,0,c.width,c.height);
    return c.toDataURL('image/jpeg',.92);
  }

  function sampleFrame(video){
    try{
      const vw=video.videoWidth||0,vh=video.videoHeight||0;if(!vw||!vh)return null;
      const c=document.createElement('canvas');c.width=120;c.height=90;
      const ctx=c.getContext('2d',{alpha:false,willReadFrequently:true});
      ctx.drawImage(video,0,0,vw,vh,0,0,c.width,c.height);
      const d=ctx.getImageData(0,0,c.width,c.height).data;
      const gray=new Uint8Array(c.width*c.height);
      let sum=0,sum2=0,sharp=0,n=0;
      for(let y=0;y<c.height;y++){
        for(let x=0;x<c.width;x++){
          const i=(y*c.width+x)*4;
          const g=(d[i]*77+d[i+1]*150+d[i+2]*29)>>8;
          gray[n]=g;sum+=g;sum2+=g*g;
          if(x>0)sharp+=Math.abs(g-gray[n-1]);
          if(y>0)sharp+=Math.abs(g-gray[n-c.width]);
          n++;
        }
      }
      const mean=sum/Math.max(1,n),variance=Math.max(0,sum2/Math.max(1,n)-mean*mean);
      return {gray,brightness:mean,contrast:Math.sqrt(variance),sharpness:sharp/Math.max(1,n*2)};
    }catch(_){return null;}
  }

  function frameDiff(a,b){
    if(!a||!b||!a.gray||!b.gray||a.gray.length!==b.gray.length)return 999;
    let sum=0,count=0;
    for(let i=0;i<a.gray.length;i+=4){sum+=Math.abs(a.gray[i]-b.gray[i]);count++;}
    return sum/Math.max(1,count);
  }

  function quality(mode,cur,diff){
    const vendor=mode==='vendor';
    const minContrast=vendor?13:14,minSharp=vendor?6.0:6.2;
    const exposurePenalty=Math.abs(cur.brightness-155)*.12;
    const motionPenalty=Math.min(Number.isFinite(diff)?diff:30,45)*(vendor?.30:.35);
    const score=(Math.min(cur.sharpness,30)*3.2)+(Math.min(cur.contrast,65)*1.1)-exposurePenalty-motionPenalty;
    const acceptable=cur.brightness>=42&&cur.brightness<=242&&cur.contrast>=minContrast&&cur.sharpness>=minSharp;
    let msg='';
    if(cur.brightness<42)msg='조금 더 밝게 비춰주세요';
    else if(cur.brightness>242)msg='반사가 강합니다 · 각도를 조금 바꿔주세요';
    else if(cur.contrast<minContrast)msg=vendor?'라벨 전체가 보이도록 조금 더 가까이 맞춰주세요':'라벨을 조금 더 가까이 맞춰주세요';
    else if(cur.sharpness<minSharp)msg='초점을 맞추는 중입니다';
    else if(diff>(vendor?26:24))msg='움직여도 괜찮습니다 · 프레임 안에만 유지해주세요';
    else msg='좋은 프레임을 찾았습니다 · 자동 선택 중';
    return {score,acceptable,msg};
  }

  async function tuneCamera(stream){
    try{
      const track=stream.getVideoTracks()[0];
      if(!track||!track.getCapabilities||!track.applyConstraints)return;
      const cap=track.getCapabilities(),adv={};
      if(Array.isArray(cap.focusMode)&&cap.focusMode.includes('continuous'))adv.focusMode='continuous';
      if(Array.isArray(cap.exposureMode)&&cap.exposureMode.includes('continuous'))adv.exposureMode='continuous';
      if(Array.isArray(cap.whiteBalanceMode)&&cap.whiteBalanceMode.includes('continuous'))adv.whiteBalanceMode='continuous';
      if(Object.keys(adv).length)await track.applyConstraints({advanced:[adv]});
    }catch(_){}
  }

  function schedule(st,fn,ms){
    if(!st||!st.running)return;
    clearTimeout(st.timer);
    st.timer=setTimeout(()=>{
      if(st.running&&R.sessions[st.mode]===st)fn();
    },ms);
  }

  async function processBest(st){
    if(!st||st.processing||!st.bestData)return;
    st.processing=true;
    const mode=st.mode,data=st.bestData,status=sid(mode);
    const preview=$(previewId(mode));
    if(preview){preview.src=data;preview.classList.remove('hidden');}
    setStatus(status,(mode==='vendor'?'업체 라벨':'WMS')+' 최적 프레임 선택 완료 · V4.6 정밀 인식 중...','warn');

    try{
      const r=await recognize(data,mode,status);
      const out=await applyResult(mode,r,data,(mode==='vendor'?'업체 라벨':'WMS')+' 자동 인식 완료');
      if(out.count<2)throw new Error('인식 항목이 부족합니다.');
      stopLive(mode,false);
    }catch(e){
      if(R.sessions[mode]!==st)return;
      st.failures++;
      if(st.failures<2){
        st.processing=false;st.started=Date.now();st.prev=null;st.samples=0;st.goodSamples=0;st.bestScore=-Infinity;st.bestData='';
        setStatus(status,'1차 인식 실패 · 더 선명한 프레임으로 자동 재시도합니다.','warn');
        schedule(st,()=>liveTick(mode),350);
        return;
      }
      setStatus(status,'실시간 인식 실패 · '+safeError(e)+' · 사진 OCR 또는 현재 화면 확정을 사용하세요.','bad');
      stopLive(mode,false);
    }finally{
      if(R.sessions[mode]===st)st.processing=false;
    }
  }

  async function liveTick(mode){
    mode=modeOf(mode);
    const st=R.sessions[mode],video=$(videoId(mode));
    if(!st||!st.running||!video)return;
    if(st.processing)return;
    if(!video.videoWidth){schedule(st,()=>liveTick(mode),180);return;}

    if(Date.now()-st.started>12000){
      setStatus(sid(mode),'자동 감지 시간이 초과되었습니다 · 라벨을 더 가까이 맞춘 후 다시 시도하세요.','warn');
      stopLive(mode,false);return;
    }

    const cur=sampleFrame(video);
    if(!cur){schedule(st,()=>liveTick(mode),180);return;}
    const diff=frameDiff(cur,st.prev);st.prev=cur;st.samples++;
    const q=quality(mode,cur,diff);
    if(q.acceptable){
      st.goodSamples++;
      if(q.score>st.bestScore){
        const data=cropVideo(video,2300);
        if(data){st.bestScore=q.score;st.bestData=data;}
      }
    }
    setStatus(sid(mode),(mode==='vendor'?'업체 라벨':'WMS')+' 자동 스캔 · '+q.msg,'warn');

    const elapsed=Date.now()-st.started;
    const ready=!!st.bestData&&(
      (elapsed>=900&&st.goodSamples>=2&&st.bestScore>=(mode==='vendor'?40:42)) ||
      (elapsed>=1700&&st.goodSamples>=1) ||
      elapsed>=3000
    );
    if(ready){await processBest(st);return;}
    schedule(st,()=>liveTick(mode),170);
  }

  async function startLive(mode){
    mode=modeOf(mode);
    stopAll(false);
    try{if(typeof stopScanner==='function')await stopScanner();}catch(_){}
    const video=$(videoId(mode)),wrap=$(wrapId(mode));
    if(!video||!wrap){setStatus(sid(mode),'카메라 화면을 준비하지 못했습니다.','bad');return;}

    try{
      if(!navigator.mediaDevices||!navigator.mediaDevices.getUserMedia)throw new Error('이 브라우저에서 카메라를 사용할 수 없습니다.');
      const stream=await navigator.mediaDevices.getUserMedia({
        video:{facingMode:{ideal:'environment'},width:{ideal:1920},height:{ideal:1080}},audio:false
      });
      await tuneCamera(stream);
      const st={
        id:++R.seq,mode,stream,track:stream.getVideoTracks()[0]||null,
        running:true,processing:false,started:Date.now(),timer:null,
        prev:null,samples:0,goodSamples:0,bestScore:-Infinity,bestData:'',failures:0
      };
      R.sessions[mode]=st;
      if(window.V22)V22.live=R.sessions;
      if(window.V26KoreanOCR&&V26KoreanOCR.live)V26KoreanOCR.live[mode]=st;
      video.srcObject=stream;await video.play();wrap.classList.remove('hidden');
      setStatus(sid(mode),(mode==='vendor'?'업체 라벨':'WMS')+' 자동 스캔 시작 · 라벨 전체를 프레임 안에 맞춰주세요.','warn');
      schedule(st,()=>liveTick(mode),220);
    }catch(e){
      setStatus(sid(mode),'카메라 실행 실패 · '+safeError(e),'bad');
    }
  }

  function stopLive(mode,showStatus){
    mode=modeOf(mode);
    const st=R.sessions[mode];
    if(st){
      st.running=false;clearTimeout(st.timer);
      try{if(st.stream)st.stream.getTracks().forEach(t=>t.stop());}catch(_){}
    }
    R.sessions[mode]=null;
    try{
      if(window.V26KoreanOCR&&V26KoreanOCR.live&&V26KoreanOCR.live[mode])delete V26KoreanOCR.live[mode];
    }catch(_){}
    const video=$(videoId(mode));
    if(video){try{video.pause();}catch(_){} try{video.srcObject=null;}catch(_){}}
    const wrap=$(wrapId(mode));if(wrap)wrap.classList.add('hidden');
    if(showStatus!==false&&$(sid(mode)))setStatus(sid(mode),'카메라 중지 · 언제든 다시 자동 인식을 시작할 수 있습니다.','');
  }

  function stopAll(showStatus){
    ['wms','vendor','multi'].forEach(m=>stopLive(m,showStatus));
  }

  async function captureLive(mode){
    mode=modeOf(mode);
    const video=$(videoId(mode));
    if(!video||!video.videoWidth){setStatus(sid(mode),'카메라 화면이 준비되지 않았습니다.','bad');return;}
    const data=cropVideo(video,2300);if(!data)return;
    const preview=$(previewId(mode));if(preview){preview.src=data;preview.classList.remove('hidden');}
    setStatus(sid(mode),'현재 화면 V4.6 정밀 인식 중...','warn');
    try{
      const r=await recognize(data,mode,sid(mode));
      await applyResult(mode,r,data,'현재 화면 OCR 완료');
    }catch(e){
      setStatus(sid(mode),'OCR 실패 · '+safeError(e)+' · 직접 입력할 수 있습니다.','bad');
    }finally{
      stopLive(mode,false);
    }
  }

  async function refocus(mode){
    mode=modeOf(mode);
    const st=R.sessions[mode],track=st&&st.track;if(!track)return;
    try{
      const cap=track.getCapabilities?track.getCapabilities():{};
      if(Array.isArray(cap.focusMode)&&cap.focusMode.includes('single-shot')){
        await track.applyConstraints({advanced:[{focusMode:'single-shot'}]});
        if(cap.focusMode.includes('continuous'))setTimeout(()=>track.applyConstraints({advanced:[{focusMode:'continuous'}]}).catch(()=>{}),700);
      }
    }catch(_){}
  }

  window.labelPhotoSelected=async function(event,mode){
    mode=modeOf(mode);
    const file=event&&event.target&&event.target.files&&event.target.files[0];if(!file)return;
    event.target.value='';
    const dataUrl=await fileToDataUrl(file);
    const preview=$(previewId(mode));if(preview){preview.src=dataUrl;preview.classList.remove('hidden');}
    setStatus(sid(mode),'V4.6 사진 OCR 인식 중 · 자동입력 후 작업자 확인이 필요합니다.','warn');
    try{
      const r=await recognize(dataUrl,mode,sid(mode));
      const out=await applyResult(mode,r,dataUrl,'V4.6 사진 OCR 완료');
      if(out.count<2)setStatus(sid(mode),'인식 결과가 부족합니다 · 더 가까이 정면 촬영하거나 직접 입력하세요.','warn');
    }catch(e){
      setStatus(sid(mode),'OCR 실패 · '+safeError(e)+' · 직접 입력할 수 있습니다.','bad');
    }
  };

  function updateUi(){
    const w=document.querySelector('button[onclick="V22.startLive(\'wms\')"]');
    if(w)w.textContent='🎥 WMS 자동 인식';
    const v=document.querySelector('button[onclick="V22.startLive(\'vendor\')"]');
    if(v)v.textContent='🎥 업체 라벨 자동 인식';
    const sub=document.querySelector('header .sub');
    if(sub)sub.textContent='V4.6 통합 OCR · WMS/업체라벨 자동 인식 · 작업자 확인 필수';
  }

  function install(){
    if(!window.V22||!window.V26KoreanOCR){
      setTimeout(install,150);return;
    }
    V22.startLive=startLive;
    V22.liveTick=liveTick;
    V22.captureLive=captureLive;
    V22.stopLive=stopLive;
    V22.refocus=refocus;
    V22.live=R.sessions;
    R.start=startLive;R.stop=stopLive;R.stopAll=stopAll;R.capture=captureLive;R.refocus=refocus;R.installed=true;
    updateUi();setTimeout(updateUi,600);setTimeout(updateUi,1600);
    console.info('[OCR-RUNTIME-1.0] single camera/OCR owner active');
  }

  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',install,{once:true});else install();
})();
