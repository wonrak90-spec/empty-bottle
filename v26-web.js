/* 공병 입고 확인 V26 Web Improvement
 * - Tesseract 사용 차단
 * - Google Drive OCR 단일 엔진
 * - WMS 단건 바코드 스캔 제거
 * - 사진 OCR + 웹 연속 OCR 모두 Google OCR만 사용
 * - 기존 로그인/DB/조회/보고서/생산 로직은 유지
 */
(function(){
  'use strict';

  if(window.__EMPTY_BOTTLE_V26_WEB__) return;
  window.__EMPTY_BOTTLE_V26_WEB__ = true;

  const $ = id => document.getElementById(id);
  const V26W = window.V26W = {
    VERSION:'V26-WEB-1',
    live:{},
    busy:false,
    lastLatency:0,
    lastError:''
  };

  function statusId(mode){
    return mode==='vendor'?'vendorStatus':(mode==='multi'?'multiBaseStatus':'wmsStatus');
  }
  function progressId(mode){
    return mode==='vendor'?'ocrProgressVendor':(mode==='multi'?'ocrProgressMulti':'ocrProgressWms');
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

  function friendlyError(err){
    const s=String(err&&err.message?err.message:err||'알 수 없는 오류');
    if(/AUTH_REQUIRED|세션|로그인/i.test(s)) return '로그인 세션 확인 필요 · '+s;
    if(/권한|permission|Drive|드라이브/i.test(s)) return 'Google Drive OCR 권한 확인 필요 · '+s;
    if(/action|ocr/i.test(s)&&/알 수 없는|unknown|지원/i.test(s)) return 'Apps Script OCR 기능 배포 상태 확인 필요 · '+s;
    if(/payload|too large|크기|용량|413/i.test(s)) return '이미지 용량이 커서 전송 실패 · 사진을 다시 촬영해 주세요.';
    if(/Failed to fetch|network|네트워크|timeout/i.test(s)) return '네트워크 연결 확인 필요 · '+s;
    return s;
  }

  async function googleOcr(dataUrl, liveFast){
    if(V26W.busy) throw new Error('Google OCR 처리 중입니다. 잠시 후 다시 시도하세요.');
    if(!CONFIG || !CONFIG.API_URL) throw new Error('Apps Script API 주소가 설정되지 않았습니다.');

    V26W.busy=true;
    V26W.lastError='';
    const started=Date.now();
    try{
      // Google OCR은 원본 특성을 잘 살리는 편이므로 대비/이진화는 하지 않는다.
      // 실시간은 전송량을 줄이고, 촬영 확정은 글자 보존을 위해 조금 더 크게 보낸다.
      const maxSide=liveFast?1500:2200;
      const quality=liveFast?0.80:0.88;
      const sending=await shrinkForUpload(dataUrl,maxSide,quality);
      const res=await apiPost('ocr',{image:sending,source:'v26-web',live:!!liveFast});
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

  // 촬영/갤러리 OCR: Google OCR만 사용.
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
      setStatus(sid,'Google OCR 실패 · '+friendlyError(err)+' · 다시 촬영하거나 직접 입력하세요.','bad');
    }
  };

  // 기존 코드가 호출하는 runOcr도 Google OCR만 사용.
  window.runOcr=async function(dataUrl,progressId){
    const r=await googleOcr(dataUrl,false);
    return r.text;
  };

  // Tesseract가 실수로 다시 호출되는 경로도 차단한다.
  window.getOcrWorker=async function(){
    throw new Error('V26에서는 Tesseract를 사용하지 않습니다.');
  };

  function cropLive(video,maxSide){
    const vw=video.videoWidth,vh=video.videoHeight;
    if(!vw||!vh)return '';
    // 화면 중앙 라벨 영역을 넉넉하게 사용해 서버 전송량을 줄인다.
    const sx=Math.round(vw*.05),sy=Math.round(vh*.10),sw=Math.round(vw*.90),sh=Math.round(vh*.80);
    const scale=Math.min(1,(maxSide||1500)/Math.max(sw,sh));
    const c=document.createElement('canvas');
    c.width=Math.max(1,Math.round(sw*scale));c.height=Math.max(1,Math.round(sh*scale));
    const ctx=c.getContext('2d');ctx.imageSmoothingEnabled=true;ctx.imageSmoothingQuality='high';
    ctx.drawImage(video,sx,sy,sw,sh,0,0,c.width,c.height);
    return c.toDataURL('image/jpeg',.82);
  }

  function liveSignature(mode,p){
    if(mode==='vendor') return [p.product,p.qty,p.lotNo,p.palletNo].filter(Boolean).join('|');
    return [p.inboundNo,p.itemCode,p.displayQty,p.containerFrom,p.containerTo].filter(Boolean).join('|');
  }

  if(window.V22){
    // 웹의 '실시간'은 카메라 프레임을 Google OCR 서버에 순차 전송한다.
    // 요청을 겹치지 않게 해서 현장 네트워크/Apps Script 과부하를 막는다.
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
        const track=stream.getVideoTracks()[0];
        V26W.live[mode]={stream,track,running:true,busy:false,lastSig:'',stableCount:0,lastApplied:''};
        video.srcObject=stream;await video.play();wrap.classList.remove('hidden');
        setStatus(sid,'Google OCR 연속 인식 중 · 라벨을 흰 박스 안에 맞춰주세요.','warn');
        V22.liveTick(mode);
      }catch(err){setStatus(sid,'카메라 실행 실패 · '+friendlyError(err),'bad');}
    };

    V22.liveTick=async function(mode){
      const st=V26W.live[mode],video=$('v22LiveVideo_'+mode);
      if(!st||!st.running||!video)return;
      if(!st.busy&&!V26W.busy&&video.videoWidth){
        st.busy=true;
        try{
          const data=cropLive(video,1500);
          if(data){
            const r=await googleOcr(data,true);
            const parsed=parseForMode(mode,r.text);
            const sig=liveSignature(mode,parsed);
            const count=fieldCount(parsed);
            if(sig){
              if(sig===st.lastSig)st.stableCount++;else{st.lastSig=sig;st.stableCount=1;}
              // 첫 결과도 빠르게 보여주되, 같은 구조가 반복되면 '안정 인식'으로 표시.
              if(sig!==st.lastApplied && count>=2){
                st.lastApplied=sig;
                applyGoogleResult(mode,r.text,data,st.stableCount>=2?'Google OCR 안정 인식':'Google OCR 실시간 인식',r.latency);
              }else{
                setStatus(statusId(mode),'Google OCR 연속 인식 중 · '+r.latency+'ms · 라벨 유지','warn');
              }
            }
          }
        }catch(err){
          setStatus(statusId(mode),'Google OCR 연속 인식 대기 · '+friendlyError(err),'warn');
        }finally{st.busy=false;}
      }
      if(st.running)setTimeout(()=>V22.liveTick(mode),900);
    };

    V22.captureLive=async function(mode){
      const video=$('v22LiveVideo_'+mode);if(!video||!video.videoWidth)return;
      const data=cropLive(video,2200);if(!data)return;
      const preview=$(previewId(mode));if(preview){preview.src=data;preview.classList.remove('hidden');}
      setStatus(statusId(mode),'현재 화면 Google OCR 정밀 인식 중...','warn');
      try{
        const r=await googleOcr(data,false);
        applyGoogleResult(mode,r.text,data,'Google OCR 촬영 확정',r.latency);
        V22.stopLive(mode,false);
      }catch(err){setStatus(statusId(mode),'Google OCR 실패 · '+friendlyError(err),'bad');}
    };

    V22.stopLive=function(mode,showStatus){
      const st=V26W.live[mode];
      if(st){st.running=false;if(st.stream)st.stream.getTracks().forEach(t=>t.stop());delete V26W.live[mode];}
      const wrap=$('v22LiveWrap_'+mode);if(wrap)wrap.classList.add('hidden');
      if(showStatus!==false&&$(statusId(mode)))setStatus(statusId(mode),'카메라 중지 · 입력 내용을 확인하세요.','');
    };
  }

  function simplifySingleUi(){
    const scan=$('btnScanSingle');if(scan)scan.classList.add('hidden');
    const reader=$('readerWrapSingle');if(reader)reader.classList.add('hidden');
    const manual=$('v22ManualSingle');if(manual)manual.textContent='✍ 직접 입력';
    const sub=document.querySelector('header .sub');if(sub)sub.textContent='WMS/업체 라벨 Google OCR · Google Sheets 저장';
    const st=$('wmsStatus');if(st&&!st.dataset.v26){st.dataset.v26='1';st.textContent='WMS 입고라벨을 촬영하거나 실시간 Google OCR을 사용하세요.';}

    // 과거 Tesseract Worker 핫픽스는 V26에서 사용하지 않는다.
    const old=document.getElementById('ocrHotfixLoader');if(old)old.remove();
    try{window.Tesseract=undefined;}catch(_){ }
  }

  function init(){
    simplifySingleUi();
    // V22가 동적으로 추가하는 버튼이 늦게 생기는 경우 한 번 더 정리한다.
    setTimeout(simplifySingleUi,400);
    setTimeout(simplifySingleUi,1500);
    console.info('[V26-WEB] Google-only OCR layer active');
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init,{once:true});else init();
})();
