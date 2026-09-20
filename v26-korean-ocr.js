/* V26 한국어 로컬 OCR 레이어
 * - PaddleOCR.js 0.4.2 + PP-OCRv5 mobile detector
 * - korean_PP-OCRv5_mobile_rec 한국어 전용 recognition model
 * - 브라우저 WASM 추론: 서버 OCR 호출/쿼터 없음
 * - WMS/업체 라벨 결과는 기존 parser + V26 수량보정 레이어에 전달
 */
(function(){
  'use strict';
  if(window.__V26_KOREAN_OCR__) return;
  window.__V26_KOREAN_OCR__=true;

  const $=id=>document.getElementById(id);
  const SDK_URL='https://cdn.jsdelivr.net/npm/@paddleocr/paddleocr-js@0.4.2/+esm';
  const WASM_URL='https://cdn.jsdelivr.net/npm/onnxruntime-web@1.22.0/dist/';
  const MODEL_BASE='https://paddle-model-ecology.bj.bcebos.com/paddlex/official_inference_model/paddle3.0.0/';
  const DET_URL=MODEL_BASE+'PP-OCRv5_mobile_det_onnx_infer.tar';
  const REC_URL=MODEL_BASE+'korean_PP-OCRv5_mobile_rec_onnx_infer.tar';

  const KO=window.V26KoreanOCR={
    VERSION:'V26-KO-OCR-1',
    engine:null,
    initPromise:null,
    ready:false,
    busy:false,
    lastError:'',
    lastMetrics:null,
    live:{},
    firstLoad:true
  };

  function statusId(mode){
    return mode==='vendor'?'vendorStatus':(mode==='multi'?'multiBaseStatus':'wmsStatus');
  }
  function previewId(mode){
    return mode==='vendor'?'vendorPreview':(mode==='multi'?'multiPreview':'wmsPreview');
  }
  function parseMode(mode,text,items){
    if(mode==='vendor'){
      if(window.V55VendorParser&&typeof V55VendorParser.parse==='function')return V55VendorParser.parse(text||'',items||[])||{};
      if(window.V26VendorTemplates&&typeof V26VendorTemplates.parse==='function')return V26VendorTemplates.parse(text||'',items||[])||{};
      return parseVendorLabel(text||'');
    }
    if(window.V55WmsParser&&typeof V55WmsParser.parse==='function')return V55WmsParser.parse(text||'',items||[])||{};
    if(window.V26WmsCardScan&&typeof V26WmsCardScan.parseWms==='function')return V26WmsCardScan.parseWms(text||'',items||[])||{};
    return parseLabelText(text||'');
  }
  function countFields(obj){
    return Object.keys(obj||{}).filter(k=>String(obj[k]??'').trim()).length;
  }
  function safeError(err){
    const s=String(err&&err.message?err.message:err||'알 수 없는 오류');
    if(/fetch|network|Failed to fetch|Load failed/i.test(s)) return '한국어 OCR 모델 다운로드 실패 · 네트워크를 확인하고 다시 시도하세요.';
    if(/memory|out of memory|allocation/i.test(s)) return '기기 메모리가 부족해 OCR을 실행하지 못했습니다.';
    if(/WebAssembly|wasm/i.test(s)) return '브라우저 OCR 실행환경(WASM) 초기화 실패 · 브라우저를 새로고침해 주세요.';
    return s;
  }

  async function ensureEngine(statusEl){
    if(KO.engine) return KO.engine;
    if(KO.initPromise) return KO.initPromise;
    if(statusEl) setStatus(statusEl,'한국어 OCR 모델 준비 중 · 최초 1회 약 18MB를 내려받습니다.','warn');

    KO.initPromise=(async()=>{
      try{
        const mod=await import(SDK_URL);
        if(!mod||!mod.PaddleOCR) throw new Error('PaddleOCR.js SDK를 불러오지 못했습니다.');
        const started=performance.now();
        const engine=await mod.PaddleOCR.create({
          textDetectionModelName:'PP-OCRv5_mobile_det',
          textDetectionModelAsset:{url:DET_URL},
          textRecognitionModelName:'korean_PP-OCRv5_mobile_rec',
          textRecognitionModelAsset:{url:REC_URL},
          textDetectionBatchSize:1,
          textRecognitionBatchSize:6,
          ortOptions:{
            backend:'wasm',
            wasmPaths:WASM_URL,
            numThreads:1,
            simd:true,
            proxy:false
          }
        });
        KO.engine=engine;
        KO.ready=true;
        KO.firstLoad=false;
        const ms=Math.round(performance.now()-started);
        try{
          const summary=engine.getInitializationSummary&&engine.getInitializationSummary();
          console.info('[V26-KO-OCR] ready',summary||{},ms+'ms');
        }catch(_){ }
        return engine;
      }catch(err){
        KO.lastError=safeError(err);
        KO.engine=null;
        KO.ready=false;
        throw new Error(KO.lastError);
      }finally{
        KO.initPromise=null;
      }
    })();
    return KO.initPromise;
  }

  function dataUrlToCanvas(dataUrl,maxSide){
    return new Promise((resolve,reject)=>{
      const img=new Image();
      img.onload=()=>{
        try{
          const iw=img.naturalWidth||img.width, ih=img.naturalHeight||img.height;
          const long=Math.max(iw,ih);
          const limit=maxSide||2200;
          // 작은 현장 사진은 글자 픽셀이 부족하므로 최대 2.4배까지 보간 확대한다.
          // 고해상도 카메라 프레임은 기존처럼 limit까지만 축소한다.
          let scale=Math.min(1,limit/Math.max(1,long));
          if(long<1500){
            const target=Math.min(limit,1600);
            scale=Math.min(2.4,Math.max(1,target/Math.max(1,long)));
          }
          const c=document.createElement('canvas');
          c.width=Math.max(1,Math.round(iw*scale));
          c.height=Math.max(1,Math.round(ih*scale));
          const ctx=c.getContext('2d',{alpha:false});
          ctx.imageSmoothingEnabled=true;
          ctx.imageSmoothingQuality='high';
          ctx.fillStyle='#fff';ctx.fillRect(0,0,c.width,c.height);
          ctx.imageSmoothingEnabled=true;ctx.imageSmoothingQuality='high';
          ctx.drawImage(img,0,0,c.width,c.height);
          resolve(c);
        }catch(e){reject(e);}
      };
      img.onerror=()=>reject(new Error('이미지를 읽지 못했습니다.'));
      img.src=dataUrl;
    });
  }

  function polyStats(poly){
    const pts=Array.isArray(poly)?poly:[];
    const xs=[],ys=[];
    for(const p of pts){
      if(Array.isArray(p)){xs.push(Number(p[0])||0);ys.push(Number(p[1])||0);}
      else if(p&&typeof p==='object'){xs.push(Number(p.x)||0);ys.push(Number(p.y)||0);}
    }
    if(!xs.length)return {x:0,y:0,w:0,h:20};
    const minX=Math.min(...xs),maxX=Math.max(...xs),minY=Math.min(...ys),maxY=Math.max(...ys);
    return {x:minX,y:(minY+maxY)/2,w:maxX-minX,h:Math.max(1,maxY-minY)};
  }

  function reconstructText(items){
    const arr=(items||[])
      .filter(it=>it&&String(it.text||'').trim()&&(Number(it.score)||0)>=0.30)
      .map(it=>({text:String(it.text||'').trim(),score:Number(it.score)||0,...polyStats(it.poly)}))
      .sort((a,b)=>a.y-b.y||a.x-b.x);
    if(!arr.length)return '';

    const rows=[];
    for(const it of arr){
      let best=null,bestDelta=Infinity;
      for(const r of rows){
        const tol=Math.max(10,Math.min(35,Math.max(r.h,it.h)*0.65));
        const d=Math.abs(r.y-it.y);
        if(d<=tol&&d<bestDelta){best=r;bestDelta=d;}
      }
      if(!best){best={y:it.y,h:it.h,items:[]};rows.push(best);}
      best.items.push(it);
      const n=best.items.length;
      best.y=((best.y*(n-1))+it.y)/n;
      best.h=Math.max(best.h,it.h);
    }
    rows.sort((a,b)=>a.y-b.y);
    return rows.map(r=>r.items.sort((a,b)=>a.x-b.x).map(x=>x.text).join(' ')).join('\n');
  }

  function cleanKoreanLabelText(text){
    return String(text||'')
      .replace(/입\s*고\s*번\s*호/g,'입고번호')
      .replace(/입\s*고\s*일\s*자/g,'입고일자')
      .replace(/품\s*목\s*코\s*드/g,'품목코드')
      .replace(/공\s*급\s*업\s*체/g,'공급업체')
      .replace(/제\s*조\s*원/g,'제조원')
      .replace(/사\s*용\s*기\s*한/g,'사용기한')
      .replace(/용\s*기\s*번\s*호/g,'용기번호')
      .replace(/수\s*량/g,'수량')
      .replace(/L\s*o\s*t\s*N\s*o\.?/gi,'Lot No.')
      .replace(/P\s*\/\s*L\s*N\s*o\.?/gi,'P/L No.')
      .replace(/[×Ｘ✕]/g,'×');
  }

  async function localOcr(dataUrl,fastMode,statusEl){
    if(KO.busy) throw new Error('한국어 OCR 처리 중입니다.');
    KO.busy=true;
    const started=performance.now();
    try{
      const engine=await ensureEngine(statusEl);
      const canvas=await dataUrlToCanvas(dataUrl,fastMode?1700:2300);
      const [result]=await engine.predict(canvas,{
        textDetLimitSideLen:fastMode?960:1280,
        textDetLimitType:'max',
        textDetMaxSideLimit:fastMode?1280:1800,
        textDetThresh:0.25,
        textDetBoxThresh:0.45,
        textDetUnclipRatio:1.5,
        textRecScoreThresh:0.30
      });
      const text=cleanKoreanLabelText(reconstructText(result&&result.items));
      if(!text.trim()) throw new Error('한국어 OCR이 글자를 찾지 못했습니다. 라벨을 더 가까이 정면으로 맞춰주세요.');
      const elapsed=Math.round(performance.now()-started);
      KO.lastMetrics=result&&result.metrics?result.metrics:{totalMs:elapsed};
      try{lastOcrEngine='한국어 로컬 OCR (PP-OCRv5)';lastOcrError='';}catch(_){ }
      return {text,items:(result&&result.items)||[],metrics:KO.lastMetrics,latency:elapsed};
    }catch(err){
      KO.lastError=safeError(err);
      try{lastOcrEngine='한국어 로컬 OCR (PP-OCRv5)';lastOcrError=KO.lastError;}catch(_){ }
      throw new Error(KO.lastError);
    }finally{KO.busy=false;}
  }
  KO.recognize=localOcr;

  // Release-candidate assist path.
  // - Baseline OCR remains V26 PP-OCRv5.
  // - Photo / explicit capture may use V55 Adaptive OCR V4.6.
  // - Final numeric identifiers stay subject to V4.4 dual-ROI consensus.
  // - Live streaming does NOT run the adaptive retry chain to protect latency.
  async function assistOcr(dataUrl,mode,statusEl){
    const baseline=await localOcr(dataUrl,false,statusEl);
    const type=mode==='vendor'?'vendor':'wms';
    if(!window.V55AdaptiveOCR||typeof V55AdaptiveOCR.recognize!=='function'){
      return {text:baseline.text,items:baseline.items||[],parsed:parseMode(mode,baseline.text,baseline.items||[]),latency:baseline.latency||0,method:'baseline'};
    }
    try{
      const out=await V55AdaptiveOCR.recognize(dataUrl,type,baseline);
      const parsed=(out&&out.parsed)||parseMode(mode,baseline.text,baseline.items||[]);
      return {
        text:baseline.text,
        items:baseline.items||[],
        parsed,
        latency:Number(out&&out.totalLatency)||Number(baseline.latency)||0,
        method:String(out&&out.method||'baseline'),
        attempts:Array.isArray(out&&out.attempts)?out.attempts:[]
      };
    }catch(err){
      console.warn('[V55 Assist] adaptive fallback to baseline',err);
      return {text:baseline.text,items:baseline.items||[],parsed:parseMode(mode,baseline.text,baseline.items||[]),latency:baseline.latency||0,method:'baseline_fallback'};
    }
  }
  KO.recognizeAssist=assistOcr;

  function applyLocalResult(mode,text,items,dataUrl,label,latency,parsedOverride){
    const parsed=parsedOverride||parseMode(mode,text,items);
    try{
      if(window.V55OcrLearning&&typeof V55OcrLearning.noteApplied==='function')
        V55OcrLearning.noteApplied(mode,text,parsed);
    }catch(_){}
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
      lastOcrText.multi=text;
      if(parsed.product)$('mProduct').value=parsed.product;
      if(parsed.itemCode)$('mItemCode').value=parsed.itemCode;
      if(parsed.supplier)$('mSupplier').value=parsed.supplier;
      if(parsed.displayQty)$('mQty').value=parsed.displayQty;
      if(parsed.inboundNo)$('mInboundNo').value=parsed.inboundNo;
    }else{
      lastOcrText.wms=text;lastOcrText.single=text;
      applyParsed(parsed,false);
      try{compareLabels();}catch(_){ }
    }
    shrinkForUpload(dataUrl,1400,.72).then(stored=>{
      if(mode==='vendor')lastPhotoDataUrl.vendor=stored;
      else if(mode==='multi')lastPhotoDataUrl.multi=stored;
      else{lastPhotoDataUrl.wms=stored;lastPhotoDataUrl.single=stored;}
    }).catch(()=>{});
    try{showOcrRaw(mode);}catch(_){ }
    const n=countFields(parsed);
    setStatus(statusId(mode),(label||'한국어 OCR 완료')+' · '+n+'개 항목 · '+latency+'ms','ok');
    return {parsed,count:n};
  }

  window.labelPhotoSelected=async function(event,mode){
    const file=event.target.files&&event.target.files[0];
    if(!file)return;
    event.target.value='';
    const dataUrl=await fileToDataUrl(file);
    const preview=$(previewId(mode));if(preview){preview.src=dataUrl;preview.classList.remove('hidden');}
    const sid=statusId(mode);
    setStatus(sid,KO.engine?'한국어 로컬 OCR 인식 중...':'한국어 OCR 모델 준비 중 · 최초 1회만 다운로드합니다.','warn');
    try{
      const r=await assistOcr(dataUrl,mode,sid);
      const out=applyLocalResult(mode,r.text,r.items,dataUrl,'V4.6 보조 OCR 완료',r.latency,r.parsed);
      if(out.count<2)setStatus(sid,'인식 결과가 부족합니다 · 라벨을 정면에서 더 가까이 촬영하거나 직접 입력하세요.','warn');
      else setStatus(sid,'V4.6 보조 OCR 완료 · '+out.count+'개 항목 · 작업자 확인 후 확정하세요.','ok');
    }catch(err){setStatus(sid,'한국어 OCR 실패 · '+safeError(err),'bad');}
  };

  window.runOcr=async function(dataUrl){
    const r=await localOcr(dataUrl,false,'wmsStatus');
    return r.text;
  };

  function cropVideo(video,maxSide){
    const vw=video.videoWidth,vh=video.videoHeight;if(!vw||!vh)return '';
    const sx=Math.round(vw*.04),sy=Math.round(vh*.08),sw=Math.round(vw*.92),sh=Math.round(vh*.84);
    const scale=Math.min(1,(maxSide||1800)/Math.max(sw,sh));
    const c=document.createElement('canvas');c.width=Math.round(sw*scale);c.height=Math.round(sh*scale);
    const ctx=c.getContext('2d',{alpha:false});ctx.drawImage(video,sx,sy,sw,sh,0,0,c.width,c.height);
    return c.toDataURL('image/jpeg',.86);
  }
  function signature(mode,p){
    return mode==='vendor'
      ?[p.product,p.qty,p.lotNo,p.palletNo].filter(Boolean).join('|')
      :[p.inboundNo,p.itemCode,p.displayQty,p.containerFrom,p.containerTo].filter(Boolean).join('|');
  }

  if(window.V22){
    V22.startLive=async function(mode){
      Object.keys(KO.live).forEach(m=>{if(m!==mode)V22.stopLive(m,false);});
      V22.stopLive(mode,false);
      try{if(typeof stopScanner==='function')await stopScanner();}catch(_){ }
      const video=$('v22LiveVideo_'+mode),wrap=$('v22LiveWrap_'+mode);if(!video||!wrap)return;
      const sid=statusId(mode);
      try{
        const stream=await navigator.mediaDevices.getUserMedia({video:{facingMode:{ideal:'environment'},width:{ideal:1920},height:{ideal:1080}},audio:false});
        KO.live[mode]={stream,running:true,busy:false,attempts:0,lastSig:'',stable:0,bestCount:0};
        video.srcObject=stream;await video.play();wrap.classList.remove('hidden');
        setStatus(sid,KO.engine?'한국어 실시간 OCR 시작 · 라벨을 화면 중앙에 맞추세요.':'한국어 OCR 모델 준비 중 · 최초 1회만 다운로드합니다.','warn');
        try{await ensureEngine(sid);}catch(err){setStatus(sid,'한국어 OCR 준비 실패 · '+safeError(err),'bad');V22.stopLive(mode,false);return;}
        if(KO.live[mode]&&KO.live[mode].running)setTimeout(()=>V22.liveTick(mode),250);
      }catch(err){setStatus(sid,'카메라 실행 실패 · '+safeError(err),'bad');}
    };

    V22.liveTick=async function(mode){
      const st=KO.live[mode],video=$('v22LiveVideo_'+mode);if(!st||!st.running||!video||!video.videoWidth)return;
      if(st.busy){setTimeout(()=>V22.liveTick(mode),250);return;}
      st.busy=true;st.attempts++;
      const sid=statusId(mode);
      try{
        const data=cropVideo(video,1800);
        const r=await localOcr(data,true,sid);
        const parsed=parseMode(mode,r.text,r.items);
        const cnt=countFields(parsed),sig=signature(mode,parsed);
        if(sig&&sig===st.lastSig)st.stable++;else{st.lastSig=sig;st.stable=sig?1:0;}
        if(cnt>=st.bestCount){st.bestCount=cnt;applyLocalResult(mode,r.text,r.items,data,'한국어 실시간 OCR',r.latency);}
        const need=mode==='vendor'?2:4;
        if(cnt>=need&&st.stable>=2){
          setStatus(sid,'한국어 OCR 안정 인식 완료 · '+cnt+'개 항목','ok');
          V22.stopLive(mode,false);return;
        }
        if(st.attempts>=4){
          setStatus(sid,cnt>=2?'한국어 OCR 인식 완료 · 입력값을 확인하세요.':'인식이 부족합니다 · 사진 촬영 또는 직접 입력을 사용하세요.',cnt>=2?'ok':'warn');
          V22.stopLive(mode,false);return;
        }
        setStatus(sid,'한국어 실시간 OCR · '+cnt+'개 항목 인식 · 라벨을 그대로 유지하세요.','warn');
      }catch(err){
        if(st.attempts>=2){setStatus(sid,'한국어 OCR 실패 · '+safeError(err),'bad');V22.stopLive(mode,false);return;}
      }finally{if(KO.live[mode])KO.live[mode].busy=false;}
      if(KO.live[mode]&&KO.live[mode].running)setTimeout(()=>V22.liveTick(mode),450);
    };

    V22.captureLive=async function(mode){
      const video=$('v22LiveVideo_'+mode);if(!video||!video.videoWidth)return;
      const data=cropVideo(video,2300);const preview=$(previewId(mode));if(preview){preview.src=data;preview.classList.remove('hidden');}
      const sid=statusId(mode);setStatus(sid,'V4.6 보조 OCR 정밀 인식 중...','warn');
      try{
        const r=await assistOcr(data,mode,sid);
        applyLocalResult(mode,r.text,r.items,data,'V4.6 보조 OCR 완료',r.latency,r.parsed);
        setStatus(sid,'V4.6 보조 OCR 완료 · 작업자 확인 후 확정하세요.','ok');
      }
      catch(err){setStatus(sid,'한국어 OCR 실패 · '+safeError(err),'bad');}
      finally{V22.stopLive(mode,false);}
    };

    V22.stopLive=function(mode,showStatus){
      const st=KO.live[mode];
      if(st){st.running=false;if(st.stream)st.stream.getTracks().forEach(t=>t.stop());delete KO.live[mode];}
      const wrap=$('v22LiveWrap_'+mode);if(wrap)wrap.classList.add('hidden');
      if(showStatus!==false&&$(statusId(mode)))setStatus(statusId(mode),'카메라 중지 · 입력 내용을 확인하세요.','');
    };
  }

  function updateUi(){
    const sub=document.querySelector('header .sub');
    if(sub)sub.textContent='V4.6 보조 OCR · 작업자 확인 필수 · WMS/업체 라벨 · Google Sheets 저장';
    const wst=$('wmsStatus');if(wst)wst.textContent='V4.6 보조 OCR로 WMS 라벨을 읽습니다 · 자동입력 후 작업자가 반드시 확인합니다.';
    const vst=$('vendorStatus');if(vst)vst.textContent='V4.6 보조 OCR로 업체 라벨을 읽고 WMS 정보와 비교합니다 · 최종 확인은 작업자가 합니다.';
    const wa=$('v26Actions_wms'),va=$('v26Actions_vendor');
    [wa,va].forEach(a=>{if(!a)return;const b=a.querySelector('button');if(b)b.textContent='🎥 한국어 실시간 인식';});
    document.querySelectorAll('#v26Actions_wms button,#v26Actions_vendor button').forEach(b=>{
      if(/사진 촬영/.test(b.textContent||''))b.textContent='📷 사진 OCR';
    });
  }

  function init(){
    updateUi();setTimeout(updateUi,500);setTimeout(updateUi,1600);
    console.info('[V26-KO-OCR-1] PP-OCRv5 + V55 V4.6 assist mode active');
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init,{once:true});else init();
})();
