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
    VERSION:'OCR-RUNTIME-1.3-FAST',
    OCR_RELEASE:'V4.6',
    REQUIRE_WORKER_CONFIRM:true,
    TARGET_LIVE_MS:2000,
    metrics:{},
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
  function signature(mode,p){
    p=p||{};
    return mode==='vendor'
      ?[p.product,p.qty,p.lotNo,p.palletNo].filter(Boolean).join('|')
      :[p.inboundNo,p.itemCode,p.displayQty,p.containerFrom,p.containerTo].filter(Boolean).join('|');
  }
  function liveNeed(mode){return mode==='vendor'?2:4;}

  function ensureLiveHud(mode){
    const wrap=$(wrapId(mode));if(!wrap)return null;
    let hud=$('ocrHud_'+mode);
    if(hud)return hud;

    // The HUD lives inside the camera area so progress remains visible even
    // when the normal status block is below the mobile viewport.
    hud=document.createElement('div');
    hud.id='ocrHud_'+mode;
    hud.style.cssText='position:absolute;left:8px;right:8px;top:8px;bottom:58px;z-index:8;pointer-events:none;display:flex;flex-direction:column;justify-content:space-between;';
    hud.innerHTML=
      '<div id="ocrHudTop_'+mode+'" style="align-self:center;max-width:94%;padding:7px 11px;border-radius:999px;background:rgba(0,0,0,.72);color:#fff;font:700 12px/1.25 system-ui,-apple-system,sans-serif;text-align:center;box-shadow:0 2px 8px rgba(0,0,0,.25)">자동 인식 준비</div>'+
      '<div style="width:100%;background:rgba(0,0,0,.72);border-radius:10px;padding:8px 10px;box-sizing:border-box">'+
        '<div id="ocrHudText_'+mode+'" style="color:#fff;font:700 13px/1.35 system-ui,-apple-system,sans-serif;text-align:center">라벨을 프레임 안에 맞춰주세요</div>'+
        '<div style="height:5px;background:rgba(255,255,255,.22);border-radius:999px;overflow:hidden;margin-top:7px">'+
          '<div id="ocrHudBar_'+mode+'" style="height:100%;width:5%;background:#fff;border-radius:999px;transition:width .18s ease"></div>'+
        '</div>'+
      '</div>';
    wrap.appendChild(hud);

    const hint=wrap.querySelector('.v22-live-hint');
    if(hint)hint.style.display='none';
    return hud;
  }

  function liveHud(mode,text,stage,progress){
    const wrap=$(wrapId(mode));if(!wrap)return;
    ensureLiveHud(mode);
    const top=$('ocrHudTop_'+mode),body=$('ocrHudText_'+mode),bar=$('ocrHudBar_'+mode);
    const label=mode==='vendor'?'업체 라벨 자동 인식':'WMS 자동 인식';
    if(top){
      top.textContent=label+' · '+(stage||'진행 중');
      top.style.background=stage==='완료'?'rgba(22,120,70,.88)':(stage==='오류'?'rgba(170,45,45,.88)':'rgba(0,0,0,.72)');
    }
    if(body)body.textContent=text||'라벨을 프레임 안에 맞춰주세요';
    if(bar){
      const pct=Math.max(5,Math.min(100,Number(progress)||5));
      bar.style.width=pct+'%';
      bar.style.background=stage==='완료'?'#7ee2a8':(stage==='오류'?'#ff9b9b':'#fff');
    }
    const guide=wrap.querySelector('.v22-guide');
    if(guide){
      guide.style.borderColor=stage==='완료'?'#7ee2a8':(stage==='오류'?'#ff9b9b':'rgba(255,255,255,.92)');
    }
  }

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

  // Live camera path is deliberately lightweight: one fast PP-OCRv5 pass +
  // V55 parser only. Adaptive ROI retries are reserved for explicit photo/
  // capture flows so live recognition can stay close to the 2-second target.
  async function recognizeFast(dataUrl,mode,statusId){
    const KO=window.V26KoreanOCR;
    if(!KO||typeof KO.recognize!=='function')throw new Error('한국어 OCR 엔진이 준비되지 않았습니다.');
    const r=await KO.recognize(dataUrl,true,statusId||sid(mode));
    return {
      text:String(r.text||''),
      items:r.items||[],
      parsed:parse(mode,r.text,r.items||[]),
      latency:Number(r.latency)||0,
      method:'live_fast'
    };
  }
  R.recognizeFast=recognizeFast;

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

  async function applyResult(mode,r,dataUrl,label,opts){
    opts=opts||{};
    const previewOnly=!!opts.previewOnly;
    const p=r&&r.parsed||{},raw=String(r&&r.text||'');
    if(!previewOnly)await storedPhoto(mode,dataUrl);
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

    if(!previewOnly){
      try{if(p.itemCode&&typeof loadItemInfo==='function')loadItemInfo(p.itemCode);}catch(_){}
      try{if(typeof showOcrRaw==='function')showOcrRaw(mode);}catch(_){}
      try{
        if(window.V55OcrLearning&&typeof V55OcrLearning.noteApplied==='function')
          V55OcrLearning.noteApplied(mode,raw,p);
      }catch(_){}
    }

    const n=countFields(p);
    if(!previewOnly)setStatus(sid(mode),(label||'V4.6 OCR 완료')+' · '+n+'개 항목 · 작업자 확인 후 확정하세요.','ok');
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
    liveHud(mode,'가장 선명한 화면을 선택했습니다 · V4.6 OCR 분석 중','OCR 분석',82);

    try{
      const r=await recognize(data,mode,status);
      const out=await applyResult(mode,r,data,(mode==='vendor'?'업체 라벨':'WMS')+' 자동 인식 완료');
      if(out.count<2)throw new Error('인식 항목이 부족합니다.');
      liveHud(mode,'인식 완료 · '+out.count+'개 항목을 자동 입력했습니다','완료',100);
      await new Promise(resolve=>setTimeout(resolve,650));
      stopLive(mode,false);
    }catch(e){
      if(R.sessions[mode]!==st)return;
      st.failures++;
      if(st.failures<2){
        st.processing=false;st.started=Date.now();st.prev=null;st.samples=0;st.goodSamples=0;st.bestScore=-Infinity;st.bestData='';
        setStatus(status,'1차 인식 실패 · 더 선명한 프레임으로 자동 재시도합니다.','warn');
        liveHud(mode,'1차 인식이 부족합니다 · 더 선명한 화면을 자동으로 다시 찾습니다','자동 재시도',35);
        schedule(st,()=>liveTick(mode),350);
        return;
      }
      setStatus(status,'실시간 인식 실패 · '+safeError(e)+' · 사진 OCR 또는 현재 화면 확정을 사용하세요.','bad');
      liveHud(mode,'실시간 인식 실패 · 사진 촬영 또는 갤러리를 사용하세요','오류',100);
      await new Promise(resolve=>setTimeout(resolve,850));
      stopLive(mode,false);
    }finally{
      if(R.sessions[mode]===st)st.processing=false;
    }
  }

  async function finalizeLive(st,reason){
    if(!st||!st.bestResult||!st.bestData)return false;
    const mode=st.mode;
    const elapsed=Date.now()-st.started;
    const out=await applyResult(mode,st.bestResult,st.bestData,reason||'실시간 OCR 완료');
    const firstApplyMs=Number(st.firstApplyMs)||elapsed;
    R.metrics[mode]={
      started:st.started,
      firstApplyMs,
      elapsedMs:elapsed,
      targetMet:firstApplyMs<=R.TARGET_LIVE_MS,
      attempts:st.attempts,
      bestFields:st.bestCount,
      lastOcrMs:st.lastOcrMs||0,
      stableCount:st.stable
    };
    liveHud(mode,'1차 자동입력 '+firstApplyMs+'ms · 안정확인 '+elapsed+'ms · '+out.count+'개 항목','완료',100);
    setTimeout(()=>stopLive(mode,false),220);
    return true;
  }

  async function liveTick(mode){
    mode=modeOf(mode);
    const st=R.sessions[mode],video=$(videoId(mode));
    if(!st||!st.running||!video)return;
    if(st.processing){schedule(st,()=>liveTick(mode),90);return;}
    if(!video.videoWidth){schedule(st,()=>liveTick(mode),90);return;}

    st.processing=true;
    st.attempts++;
    const startedPass=performance.now();
    try{
      // Stable pre-cleanup behavior: OCR the live frame first, then judge
      // stability from actual parsed values. Do not wait 0.9~3s for a generic
      // sharpness score before OCR starts.
      const data=cropVideo(video,1800);
      const r=await recognizeFast(data,mode,sid(mode));
      st.lastOcrMs=Math.round(performance.now()-startedPass);
      const parsed=r.parsed||{},cnt=countFields(parsed),sig=signature(mode,parsed);

      if(sig&&sig===st.lastSig)st.stable++;
      else{st.lastSig=sig;st.stable=sig?1:0;}

      if(cnt>st.bestCount || (cnt===st.bestCount&&st.lastOcrMs<(st.bestOcrMs||Infinity))){
        st.bestCount=cnt;
        st.bestResult=r;
        st.bestData=data;
        st.bestOcrMs=st.lastOcrMs;
      }

      // Show useful fields immediately for work speed, but do not create a
      // Learning snapshot until the live result is finalized.
      if(cnt>=2){
        if(!st.firstApplyMs)st.firstApplyMs=Date.now()-st.started;
        await applyResult(mode,r,data,'실시간 OCR 미리보기',{previewOnly:true});
      }

      const elapsed=Date.now()-st.started;
      const progress=Math.min(92,25+st.attempts*20);
      liveHud(mode,'OCR '+st.lastOcrMs+'ms · '+cnt+'개 항목 · '+st.stable+'/2 안정 확인','실시간 OCR',progress);
      const speedText=st.firstApplyMs
        ?(' · 1차입력 '+st.firstApplyMs+'ms'+(st.firstApplyMs<=R.TARGET_LIVE_MS?' ✓':' · 2초 초과'))
        :'';
      setStatus(sid(mode),(mode==='vendor'?'업체 라벨':'WMS')+' 실시간 OCR · '+cnt+'개 항목 · OCR '+st.lastOcrMs+'ms'+speedText,'warn');

      if(cnt>=liveNeed(mode)&&st.stable>=2){
        await finalizeLive(st,'실시간 OCR 안정 인식 완료');
        return;
      }

      // 2-second work-efficiency target: if two-pass consensus has not formed
      // by the target, keep the best actual OCR result rather than waiting for
      // a 3~12 second frame-quality/adaptive retry chain.
      if(elapsed>=R.TARGET_LIVE_MS&&st.bestResult&&st.bestCount>=2){
        await finalizeLive(st,'실시간 OCR 빠른 확정');
        return;
      }

      if(st.attempts>=4){
        if(st.bestResult&&st.bestCount>=2)await finalizeLive(st,'실시간 OCR 최선 결과');
        else{
          setStatus(sid(mode),'인식이 부족합니다 · 사진 OCR 또는 직접 입력을 사용하세요.','warn');
          liveHud(mode,'인식 항목이 부족합니다 · 사진 OCR 또는 직접 입력을 사용하세요','오류',100);
          setTimeout(()=>stopLive(mode,false),300);
        }
        return;
      }
    }catch(e){
      if(st.attempts>=2){
        if(st.bestResult&&st.bestCount>=2)await finalizeLive(st,'실시간 OCR 최선 결과');
        else{
          setStatus(sid(mode),'실시간 OCR 실패 · '+safeError(e),'warn');
          liveHud(mode,'실시간 OCR 실패 · 사진 OCR을 사용하세요','오류',100);
          setTimeout(()=>stopLive(mode,false),300);
        }
        return;
      }
    }finally{
      if(R.sessions[mode]===st)st.processing=false;
    }
    if(R.sessions[mode]===st&&st.running)schedule(st,()=>liveTick(mode),120);
  }

  async function startLive(mode){
    mode=modeOf(mode);
    stopAll(false);
    try{if(typeof stopScanner==='function')await stopScanner();}catch(_){}
    const video=$(videoId(mode)),wrap=$(wrapId(mode));
    if(!video||!wrap){setStatus(sid(mode),'카메라 화면을 준비하지 못했습니다.','bad');return;}

    try{
      if(!navigator.mediaDevices||!navigator.mediaDevices.getUserMedia)throw new Error('이 브라우저에서 카메라를 사용할 수 없습니다.');
      let stream=null;
      const attempts=[
        {video:{facingMode:{ideal:'environment'},width:{ideal:2560},height:{ideal:1440}},audio:false},
        {video:{facingMode:{ideal:'environment'},width:{ideal:1920},height:{ideal:1080}},audio:false},
        {video:true,audio:false}
      ];
      let lastErr=null;
      for(const constraints of attempts){
        try{stream=await navigator.mediaDevices.getUserMedia(constraints);break;}
        catch(e){lastErr=e;}
      }
      if(!stream){
        const name=String(lastErr&&lastErr.name||''),msg=String(lastErr&&lastErr.message||lastErr||'');
        if(/NotFound|DevicesNotFound/i.test(name+' '+msg))
          throw new Error('사용 가능한 카메라를 찾지 못했습니다. 이 기기에서는 사진 촬영/갤러리를 사용하세요.');
        throw lastErr||new Error('카메라를 시작하지 못했습니다.');
      }

      await tuneCamera(stream);
      const st={
        id:++R.seq,mode,stream,track:stream.getVideoTracks()[0]||null,
        running:true,processing:false,started:Date.now(),timer:null,
        attempts:0,lastSig:'',stable:0,bestCount:0,bestResult:null,bestData:'',bestOcrMs:Infinity,lastOcrMs:0,firstApplyMs:0
      };
      R.sessions[mode]=st;
      if(window.V22)V22.live=R.sessions;
      if(window.V26KoreanOCR&&V26KoreanOCR.live)V26KoreanOCR.live[mode]=st;
      video.srcObject=stream;await video.play();wrap.classList.remove('hidden');
      ensureLiveHud(mode);
      liveHud(mode,'카메라 연결 완료 · 바로 OCR을 시작합니다','카메라 연결',12);
      setStatus(sid(mode),(mode==='vendor'?'업체 라벨':'WMS')+' 빠른 실시간 OCR 시작 · 목표 2초 이내','warn');
      schedule(st,()=>liveTick(mode),120);
    }catch(e){
      setStatus(sid(mode),'카메라 실행 실패 · '+safeError(e),'bad');
      const wrap=$(wrapId(mode));
      if(wrap&&!wrap.classList.contains('hidden'))liveHud(mode,'카메라를 시작하지 못했습니다 · '+safeError(e),'오류',100);
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
    liveHud(mode,'현재 화면을 확정했습니다 · V4.6 OCR 분석 중','OCR 분석',82);
    try{
      const r=await recognize(data,mode,sid(mode));
      const out=await applyResult(mode,r,data,'현재 화면 OCR 완료');
      liveHud(mode,'현재 화면 인식 완료 · '+out.count+'개 항목 자동 입력','완료',100);
      await new Promise(resolve=>setTimeout(resolve,650));
    }catch(e){
      setStatus(sid(mode),'OCR 실패 · '+safeError(e)+' · 직접 입력할 수 있습니다.','bad');
      liveHud(mode,'OCR 실패 · 사진 촬영/갤러리 또는 직접 입력을 사용하세요','오류',100);
      await new Promise(resolve=>setTimeout(resolve,750));
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
    // Pre-warm the local OCR model so the first camera scan does not pay the
    // model initialization cost. The same initPromise is reused if the worker
    // starts scanning immediately.
    setTimeout(()=>{
      try{
        if(window.V26KoreanOCR&&typeof V26KoreanOCR.ensureEngine==='function')
          V26KoreanOCR.ensureEngine('').catch(()=>{});
      }catch(_){}
    },250);
    updateUi();setTimeout(updateUi,600);setTimeout(updateUi,1600);
    console.info('[OCR-RUNTIME-1.3-FAST] OCR-result stability + 2s live target active');
  }

  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',install,{once:true});else install();
})();
