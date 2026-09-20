/* V55 Live Assist RC1
 * Release-candidate overlay for real worker use.
 * - Keeps frozen V26 core untouched.
 * - Photo / explicit capture uses V4.6 Adaptive OCR.
 * - Live stream is preview/stability only; final values are applied after adaptive capture.
 * - Worker verification remains mandatory.
 */
(function(){
  'use strict';
  if(window.__V55_LIVE_ASSIST_RC1__)return;
  window.__V55_LIVE_ASSIST_RC1__=true;

  const A=window.V55LiveAssist={
    VERSION:'V55-LIVE-ASSIST-RC1.3',
    OCR_RELEASE:'V4.6',
    REQUIRE_WORKER_CONFIRM:true
  };
  const $=id=>document.getElementById(id);

  function statusId(mode){
    return mode==='vendor'?'vendorStatus':(mode==='multi'?'multiBaseStatus':'wmsStatus');
  }
  function previewId(mode){
    return mode==='vendor'?'vendorPreview':(mode==='multi'?'multiPreview':'wmsPreview');
  }
  function typeFor(mode){return mode==='vendor'?'vendor':'wms';}
  function countFields(p){return Object.keys(p||{}).filter(k=>String(p[k]??'').trim()).length;}
  function signature(mode,p){
    return mode==='vendor'
      ?[p.product,p.qty,p.lotNo,p.palletNo].filter(Boolean).join('|')
      :[p.inboundNo,p.itemCode,p.displayQty,p.containerFrom,p.containerTo].filter(Boolean).join('|');
  }
  function safeError(err){return String(err&&err.message?err.message:err||'알 수 없는 오류');}

  function parseV55(mode,text,items){
    try{
      if(mode==='vendor'){
        if(window.V55VendorParser&&typeof V55VendorParser.parse==='function')
          return V55VendorParser.parse(text||'',items||[])||{};
        if(window.V26VendorTemplates&&typeof V26VendorTemplates.parse==='function')
          return V26VendorTemplates.parse(text||'',items||[])||{};
        return typeof parseVendorLabel==='function'?parseVendorLabel(text||'')||{}:{};
      }
      if(window.V55WmsParser&&typeof V55WmsParser.parse==='function')
        return V55WmsParser.parse(text||'',items||[])||{};
      if(window.V26WmsCardScan&&typeof V26WmsCardScan.parseWms==='function')
        return V26WmsCardScan.parseWms(text||'',items||[])||{};
      return typeof parseLabelText==='function'?parseLabelText(text||'')||{}:{};
    }catch(e){
      console.warn('[V55 Live Assist] parse fallback',e);
      return {};
    }
  }

  async function recognizeAssist(dataUrl,mode,sid){
    if(!window.V26KoreanOCR||typeof V26KoreanOCR.recognize!=='function')
      throw new Error('PP-OCRv5 엔진이 준비되지 않았습니다.');
    const baseline=await V26KoreanOCR.recognize(dataUrl,false,sid||'');
    const baseParsed=parseV55(mode,baseline.text,baseline.items||[]);
    if(!window.V55AdaptiveOCR||typeof V55AdaptiveOCR.recognize!=='function'){
      return {text:baseline.text||'',items:baseline.items||[],parsed:baseParsed,latency:Number(baseline.latency)||0,method:'baseline'};
    }
    try{
      const out=await V55AdaptiveOCR.recognize(dataUrl,typeFor(mode),baseline);
      return {
        text:baseline.text||'',
        items:baseline.items||[],
        parsed:(out&&out.parsed)||baseParsed,
        latency:Number(out&&out.totalLatency)||Number(baseline.latency)||0,
        method:String(out&&out.method||'baseline'),
        attempts:Array.isArray(out&&out.attempts)?out.attempts:[]
      };
    }catch(e){
      console.warn('[V55 Live Assist] adaptive fallback',e);
      return {text:baseline.text||'',items:baseline.items||[],parsed:baseParsed,latency:Number(baseline.latency)||0,method:'baseline_fallback'};
    }
  }
  A.recognize=recognizeAssist;

  async function storePhoto(mode,dataUrl){
    let stored=dataUrl;
    try{
      if(typeof shrinkForUpload==='function')stored=await shrinkForUpload(dataUrl,1400,.72);
    }catch(_){}
    try{
      if(mode==='vendor')lastPhotoDataUrl.vendor=stored;
      else if(mode==='multi')lastPhotoDataUrl.multi=stored;
      else{lastPhotoDataUrl.wms=stored;lastPhotoDataUrl.single=stored;}
    }catch(_){}
    return stored;
  }

  async function applyAssist(mode,r,dataUrl,label){
    const p=r&&r.parsed||{},raw=String(r&&r.text||'');
    const stored=await storePhoto(mode,dataUrl);
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
    }catch(e){console.warn('[V55 Live Assist] apply form',e);}

    try{
      if(window.V55OcrLearning&&typeof V55OcrLearning.noteApplied==='function')
        V55OcrLearning.noteApplied(mode,raw,p);
    }catch(_){}
    try{if(typeof showOcrRaw==='function')showOcrRaw(mode);}catch(_){}
    try{
      if(p.itemCode&&typeof loadItemInfo==='function')loadItemInfo(p.itemCode);
    }catch(_){}

    const n=countFields(p),sid=statusId(mode);
    if($(sid))setStatus(sid,(label||'V4.6 보조 OCR 완료')+' · '+n+'개 항목 · 작업자 확인 후 확정하세요.','ok');
    return {count:n,stored};
  }
  A.apply=applyAssist;

  function cropVideo(video,maxSide){
    const vw=video&&video.videoWidth||0,vh=video&&video.videoHeight||0;if(!vw||!vh)return '';
    const sx=Math.round(vw*.04),sy=Math.round(vh*.08),sw=Math.round(vw*.92),sh=Math.round(vh*.84);
    const scale=Math.min(1,(maxSide||2300)/Math.max(sw,sh));
    const c=document.createElement('canvas');c.width=Math.max(1,Math.round(sw*scale));c.height=Math.max(1,Math.round(sh*scale));
    const ctx=c.getContext('2d',{alpha:false});ctx.drawImage(video,sx,sy,sw,sh,0,0,c.width,c.height);
    return c.toDataURL('image/jpeg',.90);
  }

  function install(){
    if(!window.V26KoreanOCR||!window.V55AdaptiveOCR||!window.V22){
      setTimeout(install,250);return;
    }
    if(A.installed)return;
    A.installed=true;

    // Photo / gallery path.
    window.labelPhotoSelected=async function(event,mode){
      const file=event&&event.target&&event.target.files&&event.target.files[0];if(!file)return;
      event.target.value='';
      const dataUrl=await fileToDataUrl(file);
      const preview=$(previewId(mode));if(preview){preview.src=dataUrl;preview.classList.remove('hidden');}
      const sid=statusId(mode);
      setStatus(sid,'V4.6 보조 OCR 인식 중 · 자동입력 후 작업자 확인이 필요합니다.','warn');
      try{
        const r=await recognizeAssist(dataUrl,mode,sid);
        const out=await applyAssist(mode,r,dataUrl,'V4.6 보조 OCR 완료');
        if(out.count<2)setStatus(sid,'인식 결과가 부족합니다 · 더 가까이 정면 촬영하거나 직접 입력하세요.','warn');
      }catch(e){
        setStatus(sid,'OCR 실패 · '+safeError(e)+' · 직접 입력할 수 있습니다.','bad');
      }
    };

    // Explicit current-frame capture runs the same V4.6 assist pipeline.
    V22.captureLive=async function(mode){
      const video=$('v22LiveVideo_'+mode);if(!video||!video.videoWidth)return;
      const data=cropVideo(video,2300);if(!data)return;
      const preview=$(previewId(mode));if(preview){preview.src=data;preview.classList.remove('hidden');}
      const sid=statusId(mode);
      setStatus(sid,'V4.6 보조 OCR 정밀 인식 중...','warn');
      try{
        const r=await recognizeAssist(data,mode,sid);
        await applyAssist(mode,r,data,'V4.6 현재화면 OCR 완료');
      }catch(e){
        setStatus(sid,'OCR 실패 · '+safeError(e)+' · 직접 입력할 수 있습니다.','bad');
      }finally{
        try{V22.stopLive(mode,false);}catch(_){}
      }
    };

    // Live frames are used only to judge stability. They never directly commit
    // OCR values. Once stable, run one explicit adaptive capture.
    function liveState(mode){
      const KO=window.V26KoreanOCR;
      if(mode==='vendor')return (KO&&KO.live&&KO.live.vendor)||(V22.live&&V22.live.vendor)||null;
      return (V22.live&&V22.live[mode])||(KO&&KO.live&&KO.live[mode])||null;
    }

    function vendorFrame(video){
      try{
        const vw=video.videoWidth||0,vh=video.videoHeight||0;if(!vw||!vh)return null;
        const c=document.createElement('canvas');c.width=120;c.height=90;
        const x=c.getContext('2d',{willReadFrequently:true});
        x.drawImage(video,0,0,vw,vh,0,0,c.width,c.height);
        const d=x.getImageData(0,0,c.width,c.height).data;
        let sum=0,sum2=0,edge=0,prev=0,n=0;
        for(let i=0;i<d.length;i+=4){
          const g=(d[i]*77+d[i+1]*150+d[i+2]*29)>>8;
          sum+=g;sum2+=g*g;if(n&&n%c.width)edge+=Math.abs(g-prev);prev=g;n++;
        }
        const mean=sum/Math.max(1,n),variance=Math.max(0,sum2/Math.max(1,n)-mean*mean);
        const contrast=Math.sqrt(variance),sharp=edge/Math.max(1,n);
        const exposurePenalty=Math.abs(mean-155)*0.10;
        const score=(Math.min(sharp,35)*3.0)+(Math.min(contrast,70)*1.1)-exposurePenalty;
        return {score,brightness:mean,contrast,sharp};
      }catch(_){return null;}
    }

    async function vendorAutoTick(st,video){
      const sid='vendorStatus';
      st.v55Started=st.v55Started||Date.now();
      st.v55Samples=(st.v55Samples||0)+1;
      const q=vendorFrame(video);
      if(q){
        const acceptable=q.brightness>=40&&q.brightness<=244&&q.contrast>=12&&q.sharp>=5;
        if(acceptable&&(!st.v55Best||q.score>st.v55Best.score)){
          const data=cropVideo(video,2300);
          if(data)st.v55Best={score:q.score,data};
        }
        let msg='프레임 확인 중';
        if(q.brightness<40)msg='조금 더 밝게 비춰주세요';
        else if(q.brightness>244)msg='반사가 강합니다 · 각도를 조금 바꿔주세요';
        else if(q.contrast<12)msg='라벨 전체가 보이도록 조금 더 가까이 맞춰주세요';
        else if(q.sharp<5)msg='초점을 맞추는 중입니다';
        else msg='좋은 프레임을 찾았습니다 · 자동 선택 중';
        setStatus(sid,'업체 라벨 자동 스캔 · '+msg,'warn');
      }

      const elapsed=Date.now()-st.v55Started;
      if(!st.v55Best || (elapsed<1500&&st.v55Samples<6)){
        setTimeout(()=>V22.liveTick('vendor'),220);return;
      }

      st.processing=true;st.busy=true;
      const data=st.v55Best.data;
      const preview=$('vendorPreview');if(preview){preview.src=data;preview.classList.remove('hidden');}
      setStatus(sid,'업체 라벨 최적 프레임 선택 완료 · V4.6 정밀 인식 중...','warn');
      try{
        const r=await recognizeAssist(data,'vendor',sid);
        const out=await applyAssist('vendor',r,data,'V4.6 업체라벨 자동 인식 완료');
        if(out.count<2)throw new Error('인식 항목이 부족합니다.');
        try{V22.stopLive('vendor',false);}catch(_){}
      }catch(e){
        st.v55Fails=(st.v55Fails||0)+1;
        if(st.v55Fails<2&&st.running){
          st.processing=false;st.busy=false;st.v55Started=Date.now();st.v55Samples=0;st.v55Best=null;
          setStatus(sid,'1차 인식 실패 · 더 선명한 프레임으로 자동 재시도합니다.','warn');
          setTimeout(()=>V22.liveTick('vendor'),350);return;
        }
        setStatus(sid,'업체 라벨 실시간 인식 실패 · '+safeError(e)+' · 사진 OCR 또는 현재 화면 확정을 사용하세요.','bad');
        try{V22.stopLive('vendor',false);}catch(_){}
      }finally{
        const cur=liveState('vendor');if(cur){cur.busy=false;cur.processing=false;}
      }
    }

    V22.liveTick=async function(mode){
      const st=liveState(mode),video=$('v22LiveVideo_'+mode);
      if(!st||!st.running||!video||!video.videoWidth)return;

      // Vendor labels need best-frame selection before OCR; do not OCR every frame.
      if(mode==='vendor'){
        if(st.processing||st.busy)return;
        return vendorAutoTick(st,video);
      }

      if(st.busy){setTimeout(()=>V22.liveTick(mode),300);return;}
      st.busy=true;st.attempts=(st.attempts||0)+1;
      const sid=statusId(mode);
      try{
        const data=cropVideo(video,1800);
        const r=await V26KoreanOCR.recognize(data,true,sid);
        const parsed=parseV55(mode,r.text,r.items||[]);
        const cnt=countFields(parsed),sig=signature(mode,parsed);
        if(sig&&sig===st.lastSig)st.stable=(st.stable||0)+1;
        else{st.lastSig=sig;st.stable=sig?1:0;}

        if(cnt>=2&&st.stable>=2){
          setStatus(sid,'라벨 안정 확인 · V4.6 정밀 인식으로 확정 중...','warn');
          st.busy=false;
          await V22.captureLive(mode);
          return;
        }
        if(st.attempts>=4){
          setStatus(sid,'자동 안정 인식이 부족합니다 · 현재 화면 확정 또는 사진 OCR을 사용하세요.','warn');
          V22.stopLive(mode,false);return;
        }
        setStatus(sid,'실시간 확인 중 · '+cnt+'개 항목 후보 · 라벨을 그대로 유지하세요.','warn');
      }catch(e){
        if(st.attempts>=2){setStatus(sid,'실시간 인식 실패 · '+safeError(e)+' · 사진 OCR을 사용하세요.','warn');V22.stopLive(mode,false);return;}
      }finally{
        const cur=liveState(mode);if(cur)cur.busy=false;
      }
      const cur=liveState(mode);
      if(cur&&cur.running)setTimeout(()=>V22.liveTick(mode),550);
    };

    const updateUi=()=>{
      const sub=document.querySelector('header .sub');
      if(sub)sub.textContent='V4.6 보조 OCR · 자동입력 후 작업자 확인 필수 · Learning Store';
      const w=$('wmsStatus');if(w&&!/V4\.6/.test(w.textContent||''))w.textContent='V4.6 보조 OCR · 자동입력 후 작업자가 반드시 확인합니다.';
      const v=$('vendorStatus');if(v&&!/V4\.6/.test(v.textContent||''))v.textContent='V4.6 보조 OCR · WMS와 대조 후 작업자가 최종 확인합니다.';
    };
    updateUi();setTimeout(updateUi,700);setTimeout(updateUi,1800);
    console.info('[V55-LIVE-ASSIST-RC1] worker assist overlay active');
  }

  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',install,{once:true});else install();
})();
