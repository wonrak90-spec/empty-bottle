/* V26 업체라벨 카드스캔형 자동인식
 * - 업체라벨만 적용: WMS/생산/조회 기능에는 영향 없음
 * - 모바일 전체화면 + 단일 가이드 + 손-held 최적 프레임 선택
 * - 한국어 로컬 PP-OCRv5 1회 실행
 * - 현재는 공통 업체라벨 parser 사용, 향후 업체별 template/parser 확장
 */
(function(){
  'use strict';
  if(window.__V26_VENDOR_CARDSCAN__) return;
  window.__V26_VENDOR_CARDSCAN__=true;

  const $=id=>document.getElementById(id);
  const KO=window.V26KoreanOCR;
  if(!window.V22||!KO||typeof KO.recognize!=='function'){
    console.warn('[V26-VENDOR-CARDSCAN] Korean OCR layer not ready');
    return;
  }

  const prevStart=V22.startLive.bind(V22);
  const prevTick=V22.liveTick.bind(V22);
  const prevStop=V22.stopLive.bind(V22);
  const prevCapture=V22.captureLive.bind(V22);

  const S=window.V26VendorCardScan={
    VERSION:'V26-VENDOR-CARDSCAN-2',
    state:null,
    fullscreen:null,
    timeoutMs:12000,
    templates:[] // 향후 업체별 템플릿 등록 지점
  };

  function sleep(ms){return new Promise(r=>setTimeout(r,ms));}

  function enterFullscreenScan(wrap){
    if(!wrap||S.fullscreen)return;
    const mobile=window.matchMedia&&window.matchMedia('(max-width: 720px)').matches;
    if(!mobile)return;
    const y=window.scrollY||document.documentElement.scrollTop||0;
    S.fullscreen={scrollY:y,bodyStyle:document.body.getAttribute('style')||'',wrapStyle:wrap.getAttribute('style')||''};

    document.body.style.position='fixed';
    document.body.style.top=(-y)+'px';
    document.body.style.left='0';
    document.body.style.right='0';
    document.body.style.width='100%';
    document.body.style.overflow='hidden';

    wrap.style.cssText='position:fixed!important;inset:0!important;z-index:9999!important;margin:0!important;border:0!important;border-radius:0!important;background:#000!important;height:100dvh!important;max-height:none!important;overflow:hidden!important;display:block!important;';
    const video=$('v22LiveVideo_vendor');
    if(video)video.style.cssText='display:block;width:100%!important;height:100%!important;max-height:none!important;object-fit:cover!important;background:#000;';

    const actions=wrap.querySelector('.v22-live-actions');
    if(actions)actions.style.cssText='position:absolute;left:0;right:0;bottom:0;z-index:20;display:grid;grid-template-columns:2fr 1fr 1fr;gap:8px;padding:10px calc(10px + env(safe-area-inset-right)) calc(10px + env(safe-area-inset-bottom)) calc(10px + env(safe-area-inset-left));background:linear-gradient(transparent,rgba(0,0,0,.78));';
  }

  function exitFullscreenScan(){
    if(!S.fullscreen)return;
    const fs=S.fullscreen;
    const wrap=$('v22LiveWrap_vendor'),video=$('v22LiveVideo_vendor');
    if(wrap){
      if(fs.wrapStyle)wrap.setAttribute('style',fs.wrapStyle);else wrap.removeAttribute('style');
    }
    if(video)video.removeAttribute('style');
    if(fs.bodyStyle)document.body.setAttribute('style',fs.bodyStyle);else document.body.removeAttribute('style');
    S.fullscreen=null;
    requestAnimationFrame(()=>window.scrollTo(0,fs.scrollY||0));
  }

  function ensureGuide(wrap){
    let g=$('v26VendorScanGuide');
    if(g)return g;
    wrap.style.position='relative';

    const legacyGuide=wrap.querySelector('.v22-guide');
    if(legacyGuide)legacyGuide.style.display='none';
    const legacyHint=wrap.querySelector('.v22-live-hint');
    if(legacyHint)legacyHint.style.display='none';

    g=document.createElement('div');
    g.id='v26VendorScanGuide';
    g.style.cssText='position:absolute;inset:0;pointer-events:none;display:flex;align-items:center;justify-content:center;z-index:5;';
    g.innerHTML=
      '<div id="v26VendorScanTop" style="position:absolute;left:12px;right:12px;top:max(12px,env(safe-area-inset-top));padding:10px 12px;border-radius:10px;background:rgba(0,0,0,.68);color:#fff;text-align:center;font-size:14px;font-weight:700;text-shadow:0 1px 2px #000;z-index:8;">업체 라벨 자동 스캔 준비</div>'+
      '<div id="v26VendorGuideBox" style="width:92%;height:68%;max-height:72vh;border:3px solid rgba(255,255,255,.96);border-radius:14px;box-shadow:0 0 0 9999px rgba(0,0,0,.25),0 0 18px rgba(0,0,0,.35) inset;position:relative;">'+
      '<div style="position:absolute;left:0;right:0;top:-34px;text-align:center;color:white;font-weight:700;text-shadow:0 1px 3px #000;">업체 라벨 전체를 프레임 안에 맞춰주세요</div>'+
      '<div id="v26VendorGuideState" style="position:absolute;left:8px;right:8px;bottom:8px;padding:6px 10px;border-radius:9px;background:rgba(0,0,0,.62);color:#fff;text-align:center;font-size:13px;">정렬 확인 중</div>'+
      '</div>';
    wrap.appendChild(g);
    return g;
  }

  function setOverlayStatus(text,ok){
    const e=$('v26VendorGuideState');
    const b=$('v26VendorGuideBox');
    const top=$('v26VendorScanTop');
    if(e)e.textContent=text;
    if(b)b.style.borderColor=ok?'#4ade80':'rgba(255,255,255,.96)';
    if(top){
      top.textContent=text;
      top.style.background=ok?'rgba(20,120,65,.86)':'rgba(0,0,0,.68)';
    }
  }

  function cropVideo(video,maxSide){
    const vw=video.videoWidth,vh=video.videoHeight;
    if(!vw||!vh)return '';
    const sx=Math.round(vw*.04),sy=Math.round(vh*.08),sw=Math.round(vw*.92),sh=Math.round(vh*.84);
    const scale=Math.min(1,(maxSide||2200)/Math.max(sw,sh));
    const c=document.createElement('canvas');
    c.width=Math.max(1,Math.round(sw*scale));
    c.height=Math.max(1,Math.round(sh*scale));
    const ctx=c.getContext('2d',{alpha:false});
    ctx.fillStyle='#fff';ctx.fillRect(0,0,c.width,c.height);
    ctx.imageSmoothingEnabled=true;ctx.imageSmoothingQuality='high';
    ctx.drawImage(video,sx,sy,sw,sh,0,0,c.width,c.height);
    return c.toDataURL('image/jpeg',.90);
  }

  function sampleFrame(video){
    const vw=video.videoWidth,vh=video.videoHeight;
    if(!vw||!vh)return null;
    const sx=Math.round(vw*.04),sy=Math.round(vh*.08),sw=Math.round(vw*.92),sh=Math.round(vh*.84);
    const c=document.createElement('canvas');
    c.width=180;c.height=130;
    const ctx=c.getContext('2d',{willReadFrequently:true});
    ctx.drawImage(video,sx,sy,sw,sh,0,0,c.width,c.height);
    const d=ctx.getImageData(0,0,c.width,c.height).data;
    const gray=new Uint8Array(c.width*c.height);
    let sum=0,sum2=0,sharp=0,k=0;
    for(let y=0;y<c.height;y++){
      for(let x=0;x<c.width;x++,k++){
        const i=k*4;
        const g=(d[i]*77+d[i+1]*150+d[i+2]*29)>>8;
        gray[k]=g;sum+=g;sum2+=g*g;
        if(x>0)sharp+=Math.abs(g-gray[k-1]);
        if(y>0)sharp+=Math.abs(g-gray[k-c.width]);
      }
    }
    const n=gray.length,mean=sum/n;
    const variance=Math.max(0,sum2/n-mean*mean);
    return {gray,brightness:mean,contrast:Math.sqrt(variance),sharpness:sharp/(n*2)};
  }

  function frameDiff(a,b){
    if(!a||!b||!a.gray||!b.gray||a.gray.length!==b.gray.length)return 999;
    let s=0;
    for(let i=0;i<a.gray.length;i+=4)s+=Math.abs(a.gray[i]-b.gray[i]);
    return s/Math.ceil(a.gray.length/4);
  }

  async function tuneCamera(stream){
    try{
      const track=stream.getVideoTracks()[0];
      if(!track||!track.getCapabilities||!track.applyConstraints)return;
      const cap=track.getCapabilities();
      const adv={};
      if(Array.isArray(cap.focusMode)&&cap.focusMode.includes('continuous'))adv.focusMode='continuous';
      if(Array.isArray(cap.exposureMode)&&cap.exposureMode.includes('continuous'))adv.exposureMode='continuous';
      if(Array.isArray(cap.whiteBalanceMode)&&cap.whiteBalanceMode.includes('continuous'))adv.whiteBalanceMode='continuous';
      if(Object.keys(adv).length)await track.applyConstraints({advanced:[adv]});
    }catch(_){}
  }

  function applyResult(text,items,dataUrl,latency){
    const parsed=(window.V26VendorTemplates&&typeof V26VendorTemplates.parse==='function')
      ? V26VendorTemplates.parse(text||'',items||[])
      : (parseVendorLabel(text||'')||{});
    lastOcrText.vendor=text;

    if(parsed.product)$('vProduct').value=parsed.product;
    if(parsed.qty)$('vQty').value=parsed.qty;
    if(parsed.prodDate)$('vProdDate').value=parsed.prodDate;
    if(parsed.prodTime)$('vProdTime').value=parsed.prodTime;
    if(parsed.lotNo)$('vLotNo').value=parsed.lotNo;
    if(parsed.palletNo&&$('vPalletNo'))$('vPalletNo').value=parsed.palletNo;
    if(parsed.line)$('vLine').value=parsed.line;

    try{compareLabels();}catch(_){}
    try{showOcrRaw('vendor');}catch(_){}

    shrinkForUpload(dataUrl,1400,.72).then(stored=>{
      lastPhotoDataUrl.vendor=stored;
    }).catch(()=>{});

    const count=Object.keys(parsed).filter(k=>String(parsed[k]??'').trim()).length;
    const tpl=window.V26VendorTemplates&&V26VendorTemplates.lastTemplate?(' · '+V26VendorTemplates.lastTemplate+' 템플릿'):'';
    setStatus('vendorStatus','업체 라벨 자동 인식 완료'+tpl+' · '+count+'개 항목 · '+latency+'ms · 값 확인 후 저장하세요.','ok');
    return {parsed,count};
  }

  V22.startLive=async function(mode){
    if(mode!=='vendor')return prevStart(mode);
    if(S.state)V22.stopLive('vendor',false);
    try{if(typeof stopScanner==='function')await stopScanner();}catch(_){}

    const video=$('v22LiveVideo_vendor'),wrap=$('v22LiveWrap_vendor');
    if(!video||!wrap){
      setStatus('vendorStatus','카메라 화면을 준비하지 못했습니다.','bad');
      return;
    }

    try{
      const stream=await navigator.mediaDevices.getUserMedia({
        video:{facingMode:{ideal:'environment'},width:{ideal:1920},height:{ideal:1080}},audio:false
      });
      await tuneCamera(stream);
      S.state={stream,running:true,started:Date.now(),prev:null,processing:false,samples:0,goodSamples:0,bestScore:-Infinity,bestData:'',bestAt:0};
      KO.live.vendor=S.state;

      video.srcObject=stream;
      await video.play();
      wrap.classList.remove('hidden');
      ensureGuide(wrap);
      enterFullscreenScan(wrap);

      const g=$('v26VendorScanGuide');
      if(g)g.style.display='flex';
      setOverlayStatus('업체 라벨 전체를 프레임 안에 맞춰주세요',false);
      setStatus('vendorStatus','업체 라벨 자동 스캔 · 완전히 고정할 필요 없이 프레임 안에 맞춰주세요. 가장 선명한 순간을 자동 선택합니다.','warn');

      setTimeout(()=>V22.liveTick('vendor'),220);
    }catch(err){
      setStatus('vendorStatus','카메라 실행 실패 · '+String(err&&err.message?err.message:err),'bad');
    }
  };

  V22.liveTick=async function(mode){
    if(mode!=='vendor')return prevTick(mode);
    const st=S.state,video=$('v22LiveVideo_vendor');
    if(!st||!st.running||!video||!video.videoWidth)return;
    if(st.processing)return;

    if(Date.now()-st.started>S.timeoutMs){
      setOverlayStatus('자동 감지 시간이 초과되었습니다 · 다시 시도해주세요',false);
      setStatus('vendorStatus','자동 감지 시간이 초과되었습니다 · 라벨 전체가 보이도록 다시 시도하세요.','warn');
      await sleep(700);
      V22.stopLive('vendor',false);
      return;
    }

    const cur=sampleFrame(video);
    if(!cur){
      setTimeout(()=>V22.liveTick('vendor'),160);
      return;
    }

    const diff=frameDiff(cur,st.prev);
    st.prev=cur;
    st.samples++;

    const exposurePenalty=Math.abs(cur.brightness-155)*0.12;
    const motionPenalty=Math.min(Number.isFinite(diff)?diff:30,45)*0.30;
    const score=(Math.min(cur.sharpness,30)*3.2)+(Math.min(cur.contrast,65)*1.1)-exposurePenalty-motionPenalty;
    const acceptable=cur.brightness>=42&&cur.brightness<=242&&cur.contrast>=13&&cur.sharpness>=6.0;

    if(acceptable){
      st.goodSamples++;
      if(score>st.bestScore){
        const data=cropVideo(video,2200);
        if(data){
          st.bestScore=score;
          st.bestData=data;
          st.bestAt=Date.now();
        }
      }
    }

    let msg='';
    if(cur.brightness<42)msg='조금 더 밝게 비춰주세요';
    else if(cur.brightness>242)msg='반사가 강합니다 · 각도를 조금 바꿔주세요';
    else if(cur.contrast<13)msg='라벨 전체가 보이도록 조금 더 가까이 맞춰주세요';
    else if(cur.sharpness<6.0)msg='초점을 맞추는 중입니다';
    else if(diff>26)msg='움직여도 괜찮습니다 · 프레임 안에만 유지해주세요';
    else msg='좋은 프레임을 찾았습니다 · 자동 선택 중';

    const elapsed=Date.now()-st.started;
    const ready=!!st.bestData&&(
      (elapsed>=900&&st.goodSamples>=2&&st.bestScore>=40) ||
      (elapsed>=1700&&st.goodSamples>=1) ||
      elapsed>=2800
    );

    setOverlayStatus(msg,acceptable);
    setStatus('vendorStatus','업체 라벨 자동 스캔 · '+msg,'warn');

    if(!ready){
      setTimeout(()=>V22.liveTick('vendor'),160);
      return;
    }

    st.processing=true;
    const bestData=st.bestData;
    setOverlayStatus('가장 선명한 화면 선택 완료 · 한국어 OCR 인식 중',true);

    const preview=$('vendorPreview');
    if(preview){
      preview.src=bestData;
      preview.classList.remove('hidden');
    }
    setStatus('vendorStatus','업체 라벨 최적 프레임 자동 선택 완료 · 한국어 로컬 OCR 인식 중...','warn');

    try{
      const r=await KO.recognize(bestData,false,'vendorStatus');
      const out=applyResult(r.text,r.items,bestData,r.latency);
      setOverlayStatus('인식 완료 · '+out.count+'개 항목 확인',true);
      await sleep(800);
    }catch(err){
      setOverlayStatus('인식 실패 · 다시 촬영해주세요',false);
      setStatus('vendorStatus','한국어 OCR 실패 · '+String(err&&err.message?err.message:err),'bad');
      await sleep(900);
    }finally{
      V22.stopLive('vendor',false);
    }
  };

  V22.captureLive=async function(mode){
    if(mode!=='vendor')return prevCapture(mode);
    const video=$('v22LiveVideo_vendor');
    if(!video||!video.videoWidth)return;

    const data=cropVideo(video,2300);
    if(!data)return;
    const preview=$('vendorPreview');
    if(preview){
      preview.src=data;
      preview.classList.remove('hidden');
    }

    setOverlayStatus('현재 화면 확정 · 한국어 OCR 인식 중',true);
    setStatus('vendorStatus','업체 라벨 현재 화면 한국어 OCR 인식 중...','warn');

    try{
      const r=await KO.recognize(data,false,'vendorStatus');
      const out=applyResult(r.text,r.items,data,r.latency);
      setOverlayStatus('인식 완료 · '+out.count+'개 항목 확인',true);
      await sleep(700);
    }catch(err){
      setOverlayStatus('인식 실패 · 다시 촬영해주세요',false);
      setStatus('vendorStatus','한국어 OCR 실패 · '+String(err&&err.message?err.message:err),'bad');
      await sleep(800);
    }finally{
      V22.stopLive('vendor',false);
    }
  };

  V22.stopLive=function(mode,showStatus){
    if(mode!=='vendor')return prevStop(mode,showStatus);

    const st=S.state||KO.live.vendor;
    if(st){
      st.running=false;
      if(st.stream)st.stream.getTracks().forEach(t=>t.stop());
    }
    S.state=null;
    if(KO.live&&KO.live.vendor)delete KO.live.vendor;

    const wrap=$('v22LiveWrap_vendor');
    if(wrap)wrap.classList.add('hidden');
    const g=$('v26VendorScanGuide');
    if(g)g.style.display='none';

    exitFullscreenScan();

    if(showStatus!==false&&$('vendorStatus')){
      setStatus('vendorStatus','카메라 중지 · 입력 내용을 확인하세요.','');
    }
  };

  function updateUi(){
    const a=$('v26Actions_vendor');
    if(a){
      const b=a.querySelector('button');
      if(b)b.textContent='🎥 업체 라벨 자동 스캔';
    }
    const v=$('vendorStatus');
    if(v&&!/완료|실패|중지/.test(v.textContent||'')){
      v.textContent='업체 라벨 전체를 프레임에 맞추면 가장 선명한 화면을 자동으로 선택해 인식합니다.';
    }
  }

  updateUi();
  setTimeout(updateUi,500);
  setTimeout(updateUi,1600);
  console.info('[V26-VENDOR-CARDSCAN-2] mobile fullscreen + vendor templates active');
})();