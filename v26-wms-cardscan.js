/* V26 WMS 카드스캔형 자동인식
 * - WMS만 적용: 업체라벨/생산/조회 기능에는 영향 없음
 * - 카메라 가이드 + 밝기/선명도/흔들림 검사 후 자동 캡처
 * - OCR은 한국어 로컬 PP-OCRv5를 1회만 실행
 * - OCR 결과에서 WMS 고정 숫자 형식을 보조 복원
 */
(function(){
  'use strict';
  if(window.__V26_WMS_CARDSCAN__) return;
  window.__V26_WMS_CARDSCAN__=true;

  const $=id=>document.getElementById(id);
  const KO=window.V26KoreanOCR;
  if(!window.V22||!KO||typeof KO.recognize!=='function'){
    console.warn('[V26-WMS-CARDSCAN] Korean OCR layer not ready');
    return;
  }

  const prevStart=V22.startLive.bind(V22);
  const prevTick=V22.liveTick.bind(V22);
  const prevStop=V22.stopLive.bind(V22);
  const prevCapture=V22.captureLive.bind(V22);

  const S=window.V26WmsCardScan={
    VERSION:'V26-WMS-CARDSCAN-2',
    state:null,
    timeoutMs:12000
  };

  function rectOf(poly){
    const pts=Array.isArray(poly)?poly:[];
    const xs=[],ys=[];
    for(const p of pts){
      if(Array.isArray(p)){xs.push(Number(p[0])||0);ys.push(Number(p[1])||0);}
      else if(p&&typeof p==='object'){xs.push(Number(p.x)||0);ys.push(Number(p.y)||0);}
    }
    if(!xs.length)return {x:0,y:0,w:0,h:0};
    const x1=Math.min(...xs),x2=Math.max(...xs),y1=Math.min(...ys),y2=Math.max(...ys);
    return {x:x1,y:y1,w:x2-x1,h:y2-y1,cx:(x1+x2)/2,cy:(y1+y2)/2};
  }

  function digitsFix(s){
    return String(s||'').replace(/[OoDQ]/g,'0').replace(/[lIi|]/g,'1').replace(/[Ss]/g,'5')
      .replace(/[Bb]/g,'8').replace(/[Zz]/g,'2').replace(/[gq]/g,'9').replace(/[Tt]/g,'7');
  }

  function cleanNumberToken(s){
    return digitsFix(s).replace(/[^0-9,./\- ]/g,' ').replace(/\s+/g,' ').trim();
  }

  function layoutAssist(parsed,items){
    const out=Object.assign({},parsed||{});
    const a=(items||[]).filter(it=>it&&String(it.text||'').trim()).map(it=>{
      const r=rectOf(it.poly);
      return {text:String(it.text||'').trim(),score:Number(it.score)||0,...r};
    }).sort((x,y)=>x.cy-y.cy||x.cx-y.cx);

    if(!a.length)return out;
    const maxY=Math.max(...a.map(x=>x.cy||0),1);
    const maxX=Math.max(...a.map(x=>x.cx||0),1);

    const numCandidates=[];
    for(const it of a){
      const t=cleanNumberToken(it.text);
      const plain=t.replace(/\D/g,'');
      if(plain.length>=6&&plain.length<=10) numCandidates.push({...it,plain,t,nx:it.cx/maxX,ny:it.cy/maxY});
    }

    if(!out.inboundNo){
      const top=numCandidates.filter(x=>x.plain.length>=7&&x.plain.length<=9&&x.ny<0.38)
        .sort((x,y)=>x.ny-y.ny||x.nx-y.nx)[0];
      if(top)out.inboundNo=top.plain;
    }

    if(!out.expiryDate){
      for(const it of a){
        const t=digitsFix(it.text);
        const m=t.match(/(20\d{2})\D([01]?\d)\D([0-3]?\d)/);
        if(m){out.expiryDate=m[1]+'-'+String(m[2]).padStart(2,'0')+'-'+String(m[3]).padStart(2,'0');break;}
      }
    }

    if(!out.containerFrom||!out.containerTo){
      for(const it of a){
        const t=digitsFix(it.text);
        const m=t.match(/(\d{3,5})\s*[/\-]\s*(\d{3,5})/);
        if(m){out.containerFrom=out.containerFrom||m[1];out.containerTo=out.containerTo||m[2];break;}
      }
    }

    if(!out.displayQty){
      let qRaw='';
      for(const it of a){
        const t=digitsFix(it.text);
        if(/EA/i.test(t)||/[0-9][,. ]?[0-9]{3}[,. ]000/.test(t)){qRaw=t;break;}
      }
      if(qRaw&&window.V26Qty&&typeof V26Qty.normalizeWmsQuantity==='function'){
        const q=V26Qty.normalizeWmsQuantity(qRaw);
        if(q&&!q.review&&q.value){out.displayQty=q.value;out.unit=out.unit||'EA';V26Qty.lastWms=q;}
      }
    }

    const eight=numCandidates.filter(x=>x.plain.length===8);
    if(!out.inboundDate&&eight.length){
      const dateLike=eight.filter(x=>{
        const p=x.plain;
        const y=Number(p.slice(0,4)),m=Number(p.slice(4,6)),d=Number(p.slice(6,8));
        return y>=2020&&y<=2099&&m>=1&&m<=12&&d>=1&&d<=31;
      }).sort((x,y)=>y.ny-x.ny||y.nx-x.nx)[0];
      if(dateLike)out.inboundDate=dateLike.plain.slice(0,4)+'-'+dateLike.plain.slice(4,6)+'-'+dateLike.plain.slice(6,8);
    }

    if(!out.itemCode){
      const cands=numCandidates.filter(x=>x.plain.length>=6&&x.plain.length<=8&&x.plain!==out.inboundNo&&x.plain!==String(out.inboundDate||'').replace(/\D/g,''));
      const mid=cands.filter(x=>x.ny>0.25&&x.ny<0.72).sort((x,y)=>x.nx-y.nx||x.ny-y.ny)[0];
      if(mid)out.itemCode=mid.plain;
    }

    if(!out.product){
      const labelIndex=a.findIndex(x=>/품\s*명/.test(x.text));
      if(labelIndex>=0){
        const base=a[labelIndex];
        const same=a.filter((x,i)=>i!==labelIndex&&Math.abs(x.cy-base.cy)<=Math.max(18,base.h*1.2)&&x.cx>base.cx&&/[가-힣]/.test(x.text))
          .sort((x,y)=>x.cx-y.cx)[0];
        if(same)out.product=same.text;
      }
    }

    return out;
  }

  function guideCrop(video,maxSide){
    const vw=video.videoWidth,vh=video.videoHeight;
    if(!vw||!vh)return {dataUrl:'',canvas:null};
    const aspect=1.55;
    let sw=vw*.90,sh=sw/aspect;
    if(sh>vh*.76){sh=vh*.76;sw=sh*aspect;}
    const sx=(vw-sw)/2,sy=(vh-sh)/2;
    const scale=Math.min(1,(maxSide||2000)/Math.max(sw,sh));
    const c=document.createElement('canvas');
    c.width=Math.max(1,Math.round(sw*scale));
    c.height=Math.max(1,Math.round(sh*scale));
    const ctx=c.getContext('2d',{alpha:false});
    ctx.fillStyle='#fff';ctx.fillRect(0,0,c.width,c.height);
    ctx.imageSmoothingEnabled=true;ctx.imageSmoothingQuality='high';
    ctx.drawImage(video,sx,sy,sw,sh,0,0,c.width,c.height);
    return {canvas:c,dataUrl:c.toDataURL('image/jpeg',.90)};
  }

  function sampleFrame(video){
    const vw=video.videoWidth,vh=video.videoHeight;
    if(!vw||!vh)return null;
    const aspect=1.55;
    let sw=vw*.90,sh=sw/aspect;
    if(sh>vh*.76){sh=vh*.76;sw=sh*aspect;}
    const sx=(vw-sw)/2,sy=(vh-sh)/2;
    const c=document.createElement('canvas');c.width=180;c.height=116;
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

  function ensureGuide(wrap){
    let g=$('v26WmsScanGuide');
    if(g)return g;
    wrap.style.position='relative';
    // V22 기본 가이드와 겹치지 않도록 WMS에서는 기존 프레임을 숨긴다.
    const legacyGuide=wrap.querySelector('.v22-guide');
    if(legacyGuide)legacyGuide.style.display='none';
    const legacyHint=wrap.querySelector('.v22-live-hint');
    if(legacyHint)legacyHint.style.display='none';
    g=document.createElement('div');
    g.id='v26WmsScanGuide';
    g.style.cssText='position:absolute;inset:0;pointer-events:none;display:flex;align-items:center;justify-content:center;z-index:5;';
    g.innerHTML='<div id="v26WmsGuideBox" style="width:90%;aspect-ratio:1.55/1;border:3px solid rgba(255,255,255,.96);border-radius:14px;box-shadow:0 0 0 9999px rgba(0,0,0,.28),0 0 18px rgba(0,0,0,.35) inset;position:relative;">'
      +'<div style="position:absolute;left:0;right:0;top:-34px;text-align:center;color:white;font-weight:700;text-shadow:0 1px 3px #000;">WMS 라벨을 프레임에 맞춰주세요</div>'
      +'<div id="v26WmsGuideState" style="position:absolute;left:8px;right:8px;bottom:8px;padding:6px 10px;border-radius:9px;background:rgba(0,0,0,.62);color:#fff;text-align:center;font-size:13px;">정렬 확인 중</div>'
      +'</div>';
    wrap.appendChild(g);
    return g;
  }

  function guideState(text,ok){
    const e=$('v26WmsGuideState');
    const b=$('v26WmsGuideBox');
    if(e)e.textContent=text;
    if(b)b.style.borderColor=ok?'#4ade80':'rgba(255,255,255,.96)';
  }

  function applyResult(text,items,dataUrl,latency){
    let parsed=parseLabelText(text||'')||{};
    parsed=layoutAssist(parsed,items||[]);

    lastOcrText.wms=text;lastOcrText.single=text;
    applyParsed(parsed,false);
    try{compareLabels();}catch(_){}
    try{showOcrRaw('wms');}catch(_){}
    shrinkForUpload(dataUrl,1400,.72).then(stored=>{
      lastPhotoDataUrl.wms=stored;lastPhotoDataUrl.single=stored;
    }).catch(()=>{});

    const count=Object.keys(parsed).filter(k=>String(parsed[k]??'').trim()).length;
    if(parsed.itemCode&&typeof loadItemInfo==='function'){
      try{loadItemInfo(parsed.itemCode);}catch(_){}
    }
    setStatus('wmsStatus','WMS 자동 인식 완료 · '+count+'개 항목 · '+latency+'ms · 값 확인 후 저장하세요.','ok');
    return {parsed,count};
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
      // 손-held 현장 촬영에서는 자동 줌이 흔들림을 키울 수 있어 강제 줌하지 않는다.
      if(Object.keys(adv).length)await track.applyConstraints({advanced:[adv]});
    }catch(_){}
  }

  V22.startLive=async function(mode){
    if(mode!=='wms')return prevStart(mode);
    if(S.state)V22.stopLive('wms',false);
    try{if(typeof stopScanner==='function')await stopScanner();}catch(_){}
    const video=$('v22LiveVideo_wms'),wrap=$('v22LiveWrap_wms');
    if(!video||!wrap){setStatus('wmsStatus','카메라 화면을 준비하지 못했습니다.','bad');return;}

    try{
      const stream=await navigator.mediaDevices.getUserMedia({
        video:{facingMode:{ideal:'environment'},width:{ideal:1920},height:{ideal:1080}},audio:false
      });
      await tuneCamera(stream);
      S.state={stream,running:true,started:Date.now(),prev:null,processing:false,samples:0,goodSamples:0,bestScore:-Infinity,bestData:'',bestAt:0};
      KO.live.wms=S.state;
      video.srcObject=stream;await video.play();
      wrap.classList.remove('hidden');ensureGuide(wrap);
      const g=$('v26WmsScanGuide');if(g)g.style.display='flex';
      guideState('라벨을 프레임 안에 맞춰주세요',false);
      setStatus('wmsStatus','WMS 자동 스캔 · 완전히 고정할 필요 없이 프레임 안에 맞춰주세요. 가장 선명한 순간을 자동 선택합니다.','warn');
      setTimeout(()=>V22.liveTick('wms'),220);
    }catch(err){
      setStatus('wmsStatus','카메라 실행 실패 · '+String(err&&err.message?err.message:err),'bad');
    }
  };

  V22.liveTick=async function(mode){
    if(mode!=='wms')return prevTick(mode);
    const st=S.state,video=$('v22LiveVideo_wms');
    if(!st||!st.running||!video||!video.videoWidth)return;
    if(st.processing)return;

    if(Date.now()-st.started>S.timeoutMs){
      setStatus('wmsStatus','자동 감지 시간이 초과되었습니다 · 라벨을 더 가까이 맞춘 후 다시 시도하세요.','warn');
      V22.stopLive('wms',false);return;
    }

    const cur=sampleFrame(video);
    if(!cur){setTimeout(()=>V22.liveTick('wms'),160);return;}
    const diff=frameDiff(cur,st.prev);
    st.prev=cur;
    st.samples++;

    // 손-held 촬영용 품질 점수: 흔들림은 약한 감점만 주고 선명도/대비를 더 크게 본다.
    const exposurePenalty=Math.abs(cur.brightness-155)*0.12;
    const motionPenalty=Math.min(Number.isFinite(diff)?diff:30,45)*0.35;
    const score=(Math.min(cur.sharpness,30)*3.2)+(Math.min(cur.contrast,65)*1.1)-exposurePenalty-motionPenalty;
    const acceptable=cur.brightness>=42&&cur.brightness<=242&&cur.contrast>=14&&cur.sharpness>=6.2;

    if(acceptable){
      st.goodSamples++;
      if(score>st.bestScore){
        const best=guideCrop(video,2200);
        if(best.dataUrl){st.bestScore=score;st.bestData=best.dataUrl;st.bestAt=Date.now();}
      }
    }

    let msg='';
    if(cur.brightness<42)msg='조금 더 밝게 비춰주세요';
    else if(cur.brightness>242)msg='반사가 강합니다 · 각도를 조금 바꿔주세요';
    else if(cur.contrast<14)msg='라벨을 조금 더 가까이 맞춰주세요';
    else if(cur.sharpness<6.2)msg='초점을 맞추는 중입니다';
    else if(diff>24)msg='움직여도 괜찮습니다 · 프레임 안에만 유지해주세요';
    else msg='좋은 프레임을 찾았습니다 · 자동 선택 중';

    const elapsed=Date.now()-st.started;
    const ready=!!st.bestData && (
      (elapsed>=900&&st.goodSamples>=2&&st.bestScore>=42) ||
      (elapsed>=1600&&st.goodSamples>=1) ||
      elapsed>=2600
    );

    guideState(msg,acceptable);
    setStatus('wmsStatus','WMS 자동 스캔 · '+msg,'warn');

    if(!ready){
      setTimeout(()=>V22.liveTick('wms'),160);return;
    }

    if(!st.bestData){
      setTimeout(()=>V22.liveTick('wms'),160);return;
    }

    st.processing=true;
    guideState('가장 선명한 화면 선택 완료 · OCR 인식 중',true);
    const bestData=st.bestData;
    const preview=$('wmsPreview');if(preview){preview.src=bestData;preview.classList.remove('hidden');}
    setStatus('wmsStatus','WMS 최적 프레임 자동 선택 완료 · 한국어 로컬 OCR 인식 중...','warn');

    try{
      const r=await KO.recognize(bestData,false,'wmsStatus');
      applyResult(r.text,r.items,bestData,r.latency);
    }catch(err){
      setStatus('wmsStatus','한국어 OCR 실패 · '+String(err&&err.message?err.message:err),'bad');
    }finally{
      V22.stopLive('wms',false);
    }
  };

  V22.captureLive=async function(mode){
    if(mode!=='wms')return prevCapture(mode);
    const video=$('v22LiveVideo_wms');
    if(!video||!video.videoWidth)return;
    const cap=guideCrop(video,2300);
    const preview=$('wmsPreview');if(preview){preview.src=cap.dataUrl;preview.classList.remove('hidden');}
    setStatus('wmsStatus','WMS 현재 화면 한국어 OCR 인식 중...','warn');
    try{
      const r=await KO.recognize(cap.dataUrl,false,'wmsStatus');
      applyResult(r.text,r.items,cap.dataUrl,r.latency);
    }catch(err){
      setStatus('wmsStatus','한국어 OCR 실패 · '+String(err&&err.message?err.message:err),'bad');
    }finally{V22.stopLive('wms',false);}
  };

  V22.stopLive=function(mode,showStatus){
    if(mode!=='wms')return prevStop(mode,showStatus);
    const st=S.state||KO.live.wms;
    if(st){
      st.running=false;
      if(st.stream)st.stream.getTracks().forEach(t=>t.stop());
    }
    S.state=null;
    if(KO.live&&KO.live.wms)delete KO.live.wms;
    const wrap=$('v22LiveWrap_wms');if(wrap)wrap.classList.add('hidden');
    const g=$('v26WmsScanGuide');if(g)g.style.display='none';
    if(showStatus!==false&&$('wmsStatus'))setStatus('wmsStatus','카메라 중지 · 입력 내용을 확인하세요.','');
  };

  function updateUi(){
    const a=$('v26Actions_wms');
    if(a){
      const b=a.querySelector('button');
      if(b)b.textContent='🎥 WMS 자동 스캔';
    }
    const w=$('wmsStatus');
    if(w&&!/완료|실패|중지/.test(w.textContent||''))w.textContent='WMS 라벨을 카드처럼 프레임에 맞추면 자동으로 인식합니다.';
  }

  updateUi();setTimeout(updateUi,500);setTimeout(updateUi,1600);
  console.info('[V26-WMS-CARDSCAN-1] guided stable-frame local OCR active');
})();