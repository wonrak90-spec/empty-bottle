/* Korean OCR Engine V2
 * Engine-only layer.
 * - PaddleOCR.js 0.4.2 + PP-OCRv5 mobile detector
 * - korean_PP-OCRv5_mobile_rec recognition model
 * - Browser WASM inference
 * Camera/UI lifecycle is owned exclusively by ocr-runtime.js.
 */
(function(){
  'use strict';
  if(window.__V26_KOREAN_OCR__)return;
  window.__V26_KOREAN_OCR__=true;

  const SDK_URL='https://cdn.jsdelivr.net/npm/@paddleocr/paddleocr-js@0.4.2/+esm';
  const WASM_URL='https://cdn.jsdelivr.net/npm/onnxruntime-web@1.22.0/dist/';
  const MODEL_BASE='https://paddle-model-ecology.bj.bcebos.com/paddlex/official_inference_model/paddle3.0.0/';
  const DET_URL=MODEL_BASE+'PP-OCRv5_mobile_det_onnx_infer.tar';
  const REC_URL=MODEL_BASE+'korean_PP-OCRv5_mobile_rec_onnx_infer.tar';

  const KO=window.V26KoreanOCR={
    VERSION:'KO-OCR-ENGINE-2',
    engine:null,
    initPromise:null,
    ready:false,
    busy:false,
    lastError:'',
    lastMetrics:null,
    live:{},
    firstLoad:true
  };

  function safeError(err){
    const s=String(err&&err.message?err.message:err||'알 수 없는 오류');
    if(/fetch|network|Failed to fetch|Load failed/i.test(s))return '한국어 OCR 모델 다운로드 실패 · 네트워크를 확인하고 다시 시도하세요.';
    if(/memory|out of memory|allocation/i.test(s))return '기기 메모리가 부족해 OCR을 실행하지 못했습니다.';
    if(/WebAssembly|wasm/i.test(s))return '브라우저 OCR 실행환경(WASM) 초기화 실패 · 브라우저를 새로고침해 주세요.';
    return s;
  }
  KO.safeError=safeError;

  async function ensureEngine(statusEl){
    if(KO.engine)return KO.engine;
    if(KO.initPromise)return KO.initPromise;
    if(statusEl&&typeof setStatus==='function')setStatus(statusEl,'한국어 OCR 모델 준비 중 · 최초 1회 약 18MB를 내려받습니다.','warn');

    KO.initPromise=(async()=>{
      try{
        const mod=await import(SDK_URL);
        if(!mod||!mod.PaddleOCR)throw new Error('PaddleOCR.js SDK를 불러오지 못했습니다.');
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
          console.info('[KO-OCR-ENGINE-2] ready',summary||{},ms+'ms');
        }catch(_){}
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
  KO.ensureEngine=ensureEngine;

  function dataUrlToCanvas(dataUrl,maxSide){
    return new Promise((resolve,reject)=>{
      const img=new Image();
      img.onload=()=>{
        try{
          const iw=img.naturalWidth||img.width,ih=img.naturalHeight||img.height;
          const long=Math.max(iw,ih),limit=maxSide||2200;
          let scale=Math.min(1,limit/Math.max(1,long));
          if(long<1500){
            const target=Math.min(limit,1600);
            scale=Math.min(2.4,Math.max(1,target/Math.max(1,long)));
          }
          const c=document.createElement('canvas');
          c.width=Math.max(1,Math.round(iw*scale));
          c.height=Math.max(1,Math.round(ih*scale));
          const ctx=c.getContext('2d',{alpha:false});
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
    const pts=Array.isArray(poly)?poly:[],xs=[],ys=[];
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
      for(const row of rows){
        const tol=Math.max(10,Math.min(35,Math.max(row.h,it.h)*0.65));
        const d=Math.abs(row.y-it.y);
        if(d<=tol&&d<bestDelta){best=row;bestDelta=d;}
      }
      if(!best){best={y:it.y,h:it.h,items:[]};rows.push(best);}
      best.items.push(it);
      const n=best.items.length;
      best.y=((best.y*(n-1))+it.y)/n;
      best.h=Math.max(best.h,it.h);
    }
    rows.sort((a,b)=>a.y-b.y);
    return rows.map(row=>row.items.sort((a,b)=>a.x-b.x).map(x=>x.text).join(' ')).join('\n');
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

  async function recognize(dataUrl,fastMode,statusEl){
    if(KO.busy)throw new Error('한국어 OCR 처리 중입니다.');
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
      if(!text.trim())throw new Error('한국어 OCR이 글자를 찾지 못했습니다. 라벨을 더 가까이 정면으로 맞춰주세요.');
      const elapsed=Math.round(performance.now()-started);
      KO.lastMetrics=result&&result.metrics?result.metrics:{totalMs:elapsed};
      try{lastOcrEngine='한국어 로컬 OCR (PP-OCRv5)';lastOcrError='';}catch(_){}
      return {text,items:(result&&result.items)||[],metrics:KO.lastMetrics,latency:elapsed};
    }catch(err){
      KO.lastError=safeError(err);
      try{lastOcrEngine='한국어 로컬 OCR (PP-OCRv5)';lastOcrError=KO.lastError;}catch(_){}
      throw new Error(KO.lastError);
    }finally{
      KO.busy=false;
    }
  }
  KO.recognize=recognize;

  // Compatibility helper for older call sites that only need OCR text.
  window.runOcr=async function(dataUrl){
    const r=await recognize(dataUrl,false,'wmsStatus');
    return r.text;
  };

  console.info('[KO-OCR-ENGINE-2] engine-only layer active');
})();
