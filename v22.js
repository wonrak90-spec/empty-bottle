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
      ${quickButton('📷 단건 입고','single')}
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
      <div class="v22-live-hint">라벨을 정면으로 크게 맞추고 반사광을 피해주세요. 흐리면 🎯 초점을 누르세요.</div>
      <video id="v22LiveVideo_${mode}" playsinline muted></video><div class="v22-guide"></div>
      <div class="v22-live-actions">
        <button type="button" class="btn primary" onclick="V22.captureLive('${mode}')">📷 현재 화면 확정</button>
        <button type="button" class="btn outline" onclick="V22.refocus('${mode}')">🎯 초점</button>
        <button type="button" class="btn outline" onclick="V22.stopLive('${mode}')">중지</button>
      </div>
    </div>`;
    const frag=wrap.children;
    while(frag.length) anchor.parentNode.insertBefore(frag[0],anchor);
  }

  function cropVideo(video, maxPx){
    const vw=video.videoWidth, vh=video.videoHeight; if(!vw||!vh)return '';
    // 가이드 박스와 동일한 중앙 영역을 넉넉히 사용한다. OCR은 글자 높이가 중요하므로 2.4K까지 유지한다.
    const sx=Math.round(vw*.04), sy=Math.round(vh*.10), sw=Math.round(vw*.92), sh=Math.round(vh*.80);
    const max=maxPx||2400, scale=Math.min(1,max/Math.max(sw,sh));
    const c=document.createElement('canvas');c.width=Math.max(1,Math.round(sw*scale));c.height=Math.max(1,Math.round(sh*scale));
    const ctx=c.getContext('2d');ctx.imageSmoothingEnabled=true;ctx.imageSmoothingQuality='high';
    ctx.drawImage(video,sx,sy,sw,sh,0,0,c.width,c.height);
    return c.toDataURL('image/jpeg',.94);
  }

  function modeProgress(mode){return mode==='vendor'?'ocrProgressVendor':(mode==='wms'?'ocrProgressWms':'ocrProgressMulti');}
  function parseForMode(mode,text){return mode==='vendor'?parseVendorLabel(text):parseLabelText(text);}
  function fieldCount(obj){return Object.keys(obj||{}).filter(k=>String(obj[k]||'').trim()).length;}
  function structuredScore(mode,text){
    const p=parseForMode(mode,text||''); let n=0;
    if(mode==='vendor'){
      if(p.product)n+=4;if(p.qty)n+=4;if(p.lotNo)n+=3;if(p.palletNo)n+=5;if(p.prodDate)n+=2;if(p.prodTime)n+=1;if(p.line)n+=2;
    }else{
      if(p.inboundNo)n+=5;if(p.itemCode)n+=5;if(p.product)n+=3;if(p.displayQty)n+=4;if(p.supplier)n+=2;if(p.containerFrom)n+=4;if(p.inboundDate)n+=1;
    }
    return n;
  }

  function synthText(mode,p){
    if(mode==='vendor') return [
      p.product&&('제품명: '+p.product),p.qty&&('수량: '+p.qty),p.prodDate&&('생산일자: '+p.prodDate),
      p.prodTime&&('시간: '+p.prodTime),p.lotNo&&('Lot No.: '+p.lotNo),p.palletNo&&('Pallet No.: '+p.palletNo),p.line&&('생산라인: '+p.line),p.maker&&('제조원: '+p.maker)
    ].filter(Boolean).join('\n');
    return [
      p.inboundNo&&('입고번호: '+p.inboundNo),p.itemCode&&('품목코드: '+p.itemCode),p.product&&('품명: '+p.product),
      p.displayQty&&('수량: '+p.displayQty),p.supplier&&('공급업체: '+p.supplier),p.manufacturer&&('제조원: '+p.manufacturer),
      p.inboundDate&&('입고일자: '+p.inboundDate),p.expiryDate&&('사용기한: '+p.expiryDate),p.containerFrom&&('용기번호: '+p.containerFrom),p.codeRaw&&('Barcode: '+p.codeRaw)
    ].filter(Boolean).join('\n');
  }

  function mergeParsed(mode, results){
    const sorted=(results||[]).slice().sort((a,b)=>b.score-a.score); const out={};
    sorted.forEach(r=>Object.keys(r.parsed||{}).forEach(k=>{if(!String(out[k]||'').trim() && String(r.parsed[k]||'').trim())out[k]=r.parsed[k];}));
    return out;
  }

  function makeOcrVariant(dataUrl, kind){
    return new Promise(resolve=>{
      const img=new Image();
      img.onload=()=>{
        try{
          const target=2400, up=Math.min(3,Math.max(1,target/Math.max(img.width,img.height))), max=3000;
          const scale=Math.min(up,max/Math.max(img.width,img.height));
          const c=document.createElement('canvas');c.width=Math.round(img.width*scale);c.height=Math.round(img.height*scale);
          const ctx=c.getContext('2d');ctx.imageSmoothingEnabled=true;ctx.imageSmoothingQuality='high';ctx.drawImage(img,0,0,c.width,c.height);
          if(kind!=='original'){
            const d=ctx.getImageData(0,0,c.width,c.height),px=d.data,hist=new Array(256).fill(0);let sum=0;
            for(let i=0;i<px.length;i+=4){const g=Math.max(0,Math.min(255,Math.round(.299*px[i]+.587*px[i+1]+.114*px[i+2])));hist[g]++;sum+=g;px[i]=px[i+1]=px[i+2]=g;}
            if(kind==='contrast'){
              // percentile stretch: 반사광과 회색 배경을 줄이고 글자 대비를 키운다.
              const total=px.length/4,loN=total*.03,hiN=total*.97;let acc=0,lo=0,hi=255;
              for(let j=0;j<256;j++){acc+=hist[j];if(acc>=loN){lo=j;break;}} acc=0;
              for(let j=0;j<256;j++){acc+=hist[j];if(acc>=hiN){hi=j;break;}}
              const span=Math.max(30,hi-lo);
              for(let i=0;i<px.length;i+=4){let g=(px[i]-lo)*255/span;g=Math.max(0,Math.min(255,g));px[i]=px[i+1]=px[i+2]=g;}
            }else if(kind==='binary'){
              // Otsu 전역 threshold. 검정 인쇄 라벨에서 숫자/LOT 인식률이 특히 좋아진다.
              const total=px.length/4;let totalSum=0;for(let j=0;j<256;j++)totalSum+=j*hist[j];
              let wB=0,sumB=0,maxVar=-1,thr=145;
              for(let j=0;j<256;j++){wB+=hist[j];if(!wB)continue;const wF=total-wB;if(!wF)break;sumB+=j*hist[j];const mB=sumB/wB,mF=(totalSum-sumB)/wF,v=wB*wF*(mB-mF)*(mB-mF);if(v>maxVar){maxVar=v;thr=j;}}
              for(let i=0;i<px.length;i+=4){const g=px[i]>thr?255:0;px[i]=px[i+1]=px[i+2]=g;}
            }
            ctx.putImageData(d,0,0);
          }
          resolve(c.toDataURL('image/jpeg',kind==='binary'?0.96:0.92));
        }catch(_){resolve(dataUrl);}
      };img.onerror=()=>resolve(dataUrl);img.src=dataUrl;
    });
  }

  async function recognizeLocal(dataUrl, progressId, psm){
    const worker=await getOcrWorker(progressId);
    try{if(worker.setParameters)await worker.setParameters({tessedit_pageseg_mode:String(psm||6),preserve_interword_spaces:'1',user_defined_dpi:'300'});}catch(_){ }
    const ret=await worker.recognize(dataUrl);
    return {text:(ret.data&&ret.data.text)||'',confidence:Number(ret.data&&ret.data.confidence)||0};
  }

  async function enhancedOcr(dataUrl, mode, progressId, liveFast){
    if(V22.ocrBusy && liveFast)return {raw:'',parsed:{},score:0,engine:'busy'};
    if(V22.ocrBusy&&!liveFast){for(let i=0;i<80&&V22.ocrBusy;i++)await new Promise(r=>setTimeout(r,75));}
    V22.ocrBusy=true; lastOcrError='';
    try{
      const results=[];
      const contrast=await makeOcrVariant(dataUrl,'contrast');
      const a=await recognizeLocal(contrast,progressId,6);a.parsed=parseForMode(mode,a.text);a.score=structuredScore(mode,a.text);results.push(a);
      const target=mode==='vendor'?12:16;
      if(!liveFast && a.score<target){
        const binary=await makeOcrVariant(dataUrl,'binary');
        const b=await recognizeLocal(binary,progressId,6);b.parsed=parseForMode(mode,b.text);b.score=structuredScore(mode,b.text);results.push(b);
      }
      if(!liveFast && Math.max.apply(null,results.map(x=>x.score))<target){
        const original=await makeOcrVariant(dataUrl,'original');
        const c=await recognizeLocal(original,progressId,11);c.parsed=parseForMode(mode,c.text);c.score=structuredScore(mode,c.text);results.push(c);
      }
      let best=results.slice().sort((x,y)=>y.score-x.score)[0]||{text:'',parsed:{},score:0};
      let merged=mergeParsed(mode,results), engine=results.length>1?'기기 다중전처리 OCR':'기기 OCR';
      let mergedScore=structuredScore(mode,synthText(mode,merged));
      if(!liveFast && mergedScore<target && CONFIG.API_URL && CONFIG.API_URL.indexOf('PUT_YOUR')!==0){
        try{
          // 서버 OCR은 원본 정보를 최대한 보존한 고해상도 이미지로 한 번만 사용한다.
          const sending=await shrinkForUpload(dataUrl,2200,.9);
          const res=await apiPost('ocr',{image:sending});
          if(res.ok&&String(res.text||'').trim()){
            const rr={text:String(res.text||''),parsed:parseForMode(mode,String(res.text||''))};rr.score=structuredScore(mode,rr.text);results.push(rr);
            merged=mergeParsed(mode,results);mergedScore=structuredScore(mode,synthText(mode,merged));
            if(rr.score>best.score)best=rr;engine='기기 다중전처리 + 서버 보정';
          }
        }catch(err){lastOcrError=String(err&&err.message?err.message:err);}
      }
      const raw=synthText(mode,merged)||best.text||'';
      return {raw,parsed:merged,score:mergedScore,engine,fieldCount:fieldCount(merged)};
    }finally{V22.ocrBusy=false;}
  }
  V22.enhancedOcr=enhancedOcr;

  function applyStructured(mode, parsed, raw, dataUrl, label){
    if(!parsed)parsed={};
    if(mode==='vendor'){
      lastOcrText.vendor=raw; lastPhotoDataUrl.vendor=dataUrl;
      if(parsed.product)$('vProduct').value=parsed.product;if(parsed.qty)$('vQty').value=parsed.qty;
      if(parsed.prodDate)$('vProdDate').value=parsed.prodDate;if(parsed.prodTime)$('vProdTime').value=parsed.prodTime;
      if(parsed.lotNo)$('vLotNo').value=parsed.lotNo;if(parsed.palletNo&&$('vPalletNo'))$('vPalletNo').value=parsed.palletNo;if(parsed.line)$('vLine').value=parsed.line;compareLabels();
    }else{
      const key=mode==='wms'?'wms':'multi';lastOcrText[key]=raw;lastPhotoDataUrl[key]=dataUrl;if(mode==='wms'){lastOcrText.single=raw;lastPhotoDataUrl.single=dataUrl;}
      applyOcrToMode(mode,parsed);if(parsed.itemCode&&typeof loadItemInfo==='function')loadItemInfo(parsed.itemCode);
    }
    try{showOcrRaw(mode);}catch(_){ }
    const sid=mode==='vendor'?'vendorStatus':(mode==='wms'?'wmsStatus':'multiBaseStatus');
    if($(sid))setStatus(sid,(label||'자동인식')+' · '+fieldCount(parsed)+'개 항목 인식 · 틀린 항목만 수정하세요.','ok');
  }

  // 사진 촬영/갤러리 OCR도 동일한 다중전처리 파이프라인을 사용한다.
  window.labelPhotoSelected=async function(event,mode){
    const file=event.target.files&&event.target.files[0];if(!file)return;event.target.value='';
    const dataUrl=await fileToDataUrl(file),stored=await shrinkForUpload(dataUrl,1400,.72);
    const preview=mode==='vendor'?$('vendorPreview'):(mode==='wms'?$('wmsPreview'):$('multiPreview'));if(preview){preview.src=dataUrl;preview.classList.remove('hidden');}
    const sid=mode==='vendor'?'vendorStatus':(mode==='wms'?'wmsStatus':'multiBaseStatus');setStatus(sid,'라벨 정밀 인식 중 · 대비/이진화 결과를 비교합니다...','warn');
    try{
      const r=await enhancedOcr(dataUrl,mode,modeProgress(mode),false);lastOcrEngine=r.engine;
      applyStructured(mode,r.parsed,r.raw,stored,'촬영 인식 완료 ('+r.engine+')');
      if(r.fieldCount<2)setStatus(sid,'인식 항목이 적습니다. 라벨을 정면에서 더 가까이 촬영하거나 직접 입력하세요.','warn');
    }catch(err){setStatus(sid,'자동인식 실패: '+err+' · 직접 입력도 가능합니다.','bad');}
  };

  // 기존 코드에서 호출하는 runOcr도 개선 파이프라인으로 연결한다.
  window.runOcr=async function(dataUrl,progressId){
    const mode=/(Vendor|loopOcrDummy)/i.test(progressId)?'vendor':(/Multi/i.test(progressId)?'multi':'wms');
    const r=await enhancedOcr(dataUrl,mode,progressId,false);lastOcrEngine=r.engine;return r.raw;
  };

  async function liveBarcode(mode,video){
    if(mode==='vendor'||!('BarcodeDetector' in window))return false;
    try{
      if(!V22.barcodeDetector)V22.barcodeDetector=new BarcodeDetector({formats:['qr_code','code_128','code_39','ean_13','ean_8','data_matrix']});
      const codes=await V22.barcodeDetector.detect(video);if(!codes||!codes.length)return false;
      const raw=String(codes[0].rawValue||'').trim(),st=V22.live[mode];if(!raw||!st||st.lastBarcode===raw)return false;st.lastBarcode=raw;
      const parsed=parseCode(raw);
      if(mode==='wms'){
        applyParsed(parsed,true);$('codeRaw').value=raw;const res=await lookupMaster(raw);if(res&&res.found)applyMasterToForm(res.data);compareLabels();
        setStatus('wmsStatus','코드 우선 인식 완료 · OCR은 부족한 항목만 보완합니다.','ok');
      }else{
        const res=await lookupMaster(raw),d=(res&&res.found)?res.data:{};
        if(d.product||parsed.product)$('mProduct').value=d.product||parsed.product;if(d.itemCode||parsed.itemCode)$('mItemCode').value=d.itemCode||parsed.itemCode;
        if(d.supplier||parsed.supplier)$('mSupplier').value=d.supplier||parsed.supplier;if(d.qty||parsed.displayQty)$('mQty').value=d.qty||parsed.displayQty;
        if(d.inboundNo||parsed.inboundNo)$('mInboundNo').value=d.inboundNo||parsed.inboundNo;
        setStatus('multiBaseStatus','코드 우선 인식 완료 · 기준정보를 확인하세요.','ok');
      }
      return true;
    }catch(_){return false;}
  }

  V22.startLive=async function(mode){
    Object.keys(V22.live).forEach(m=>{ if(m!==mode) V22.stopLive(m,false); });
    V22.stopLive(mode,false);
    try{ if(typeof stopScanner==='function') await stopScanner(); }catch(_){ }
    const video=$(`v22LiveVideo_${mode}`), wrap=$(`v22LiveWrap_${mode}`); if(!video||!wrap)return;
    try{
      const stream=await navigator.mediaDevices.getUserMedia({video:{facingMode:{ideal:'environment'},width:{ideal:2560},height:{ideal:1440}},audio:false});
      const track=stream.getVideoTracks()[0];
      try{const cap=track.getCapabilities?track.getCapabilities():{};const adv={};if(cap.focusMode&&cap.focusMode.indexOf('continuous')>=0)adv.focusMode='continuous';if(cap.exposureMode&&cap.exposureMode.indexOf('continuous')>=0)adv.exposureMode='continuous';if(cap.whiteBalanceMode&&cap.whiteBalanceMode.indexOf('continuous')>=0)adv.whiteBalanceMode='continuous';if(Object.keys(adv).length)await track.applyConstraints({advanced:[adv]});}catch(_){ }
      V22.live[mode]={stream,track,running:true,busy:false,lastText:'',stableText:'',stableCount:0,lastBarcode:''};
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
    const st=V22.live[mode],video=$(`v22LiveVideo_${mode}`);if(!st||!st.running||!video)return;
    if(!st.busy&&!V22.ocrBusy&&video.videoWidth){
      st.busy=true;
      try{
        const barcodeHit=await liveBarcode(mode,video);
        const data=cropVideo(video,1900);
        if(data){
          const r=await enhancedOcr(data,mode,modeProgress(mode),true);
          const signature=synthText(mode,r.parsed);
          if(signature&&r.score>=(mode==='vendor'?7:9)){
            if(signature===st.stableText)st.stableCount++;else{st.stableText=signature;st.stableCount=1;}
            // 한 프레임의 오인식을 바로 덮어쓰지 않고 2회 연속 같은 구조일 때만 확정한다.
            if(st.stableCount>=2&&signature!==st.lastText){st.lastText=signature;applyStructured(mode,r.parsed,r.raw,data,barcodeHit?'코드+실시간 OCR':'실시간 OCR');}
          }
        }
      }catch(_){ }finally{st.busy=false;}
    }
    if(st.running)setTimeout(()=>V22.liveTick(mode),1700);
  };

  V22.captureLive=async function(mode){
    const video=$(`v22LiveVideo_${mode}`); if(!video||!video.videoWidth)return;
    const data=cropVideo(video,2600); if(!data)return;
    const preview=mode==='vendor'?$('vendorPreview'):(mode==='wms'?$('wmsPreview'):$('multiPreview'));
    if(preview){preview.src=data;preview.classList.remove('hidden');}
    const sid=mode==='vendor'?'vendorStatus':(mode==='wms'?'wmsStatus':'multiBaseStatus');
    setStatus(sid,'촬영 화면 정밀 인식 중...','warn');
    try{
      const r=await enhancedOcr(data,mode,modeProgress(mode),false);lastOcrEngine=r.engine;
      const stored=await shrinkForUpload(data,1400,.72);
      applyStructured(mode,r.parsed,r.raw,stored,'촬영 확정 ('+r.engine+')');
      if(r.fieldCount<2)setStatus(sid,'인식 항목이 적습니다. 라벨을 정면/가까이 맞춘 뒤 다시 촬영하세요.','warn');
    }catch(err){setStatus(sid,'인식 실패: '+err,'bad');}
    V22.stopLive(mode,false);
  };

  V22.refocus=async function(mode){
    const st=V22.live[mode];if(!st||!st.track)return;
    try{const cap=st.track.getCapabilities?st.track.getCapabilities():{};if(cap.focusMode&&cap.focusMode.indexOf('single-shot')>=0){await st.track.applyConstraints({advanced:[{focusMode:'single-shot'}]});setTimeout(async()=>{try{if(cap.focusMode.indexOf('continuous')>=0)await st.track.applyConstraints({advanced:[{focusMode:'continuous'}]});}catch(_){ }},800);}}
    catch(_){ }
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
      const small=await shrinkForUpload(raw,1200,.70);
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
    card.innerHTML=`<div style="display:flex;justify-content:space-between;align-items:center;gap:8px"><p class="step-title" id="v22ReportTitle" style="margin:0">보고서 작성</p><span class="v22-report-badge" id="v22ReportBadge"></span></div>
      <div id="v22ReportFields" style="margin-top:12px"></div>
      <div class="v22-action-row"><button class="btn primary" onclick="V22.printReport()">🖨 보고서 출력</button><button class="btn outline" onclick="document.getElementById('v22ReportBuilder').classList.add('hidden')">닫기</button></div>`;
    $('view').insertBefore(card,$('view').children[1]||null);

    const detail=$('viewDetailCard');if(detail && !$('btnPrintPhotoCurrent')){
      const b=document.createElement('button');b.id='btnPrintPhotoCurrent';b.className='btn outline';b.textContent='📷 사진 포함 A4 출력';b.onclick=()=>V22.printCurrentWithPhotos();detail.appendChild(b);
      const edit=document.createElement('button');edit.id='btnEditCurrent';edit.className='btn outline';edit.textContent='✏️ 기록 수정';edit.onclick=()=>V22.openEditCurrent();detail.appendChild(edit);
      const del=document.createElement('button');del.id='btnDeleteCurrent';del.className='btn danger';del.textContent='🗑 기록 삭제';del.onclick=()=>V22.deleteCurrent();detail.appendChild(del);
    }
    if(!$('v22EditCard')){
      const ec=document.createElement('div');ec.id='v22EditCard';ec.className='card hidden';ec.innerHTML=`<p class="step-title">기록 수정 <span style="font-weight:400;color:var(--muted);font-size:.75rem">변경 전/후 내용은 Audit에 남습니다.</span></p><div id="v22EditFields"></div><div class="field"><label>수정자 *</label><input id="v22EditActor"></div><div class="field"><label>수정 사유 *</label><textarea id="v22EditReason" placeholder="OCR 오인식 정정 등"></textarea></div><div class="v22-action-row"><button class="btn primary" onclick="V22.saveEditCurrent()">수정 저장</button><button class="btn ghost" onclick="$('v22EditCard').classList.add('hidden')">취소</button></div><div id="v22EditStatus" class="status"></div>`;$('view').appendChild(ec);
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


  const EDIT_FIELDS=[['inboundNo','입고번호'],['inboundDate','입고일자'],['product','품명'],['itemCode','품목코드'],['manufacturer','제조원'],['supplier','공급업체'],['displayQty','표시수량'],['unit','단위'],['expiryDate','사용기한'],['containerFrom','WMS 파레트/용기번호 시작'],['containerTo','WMS 파레트/용기번호 종료'],['actualQty','실제 확인수량'],['finalResult','최종결과'],['vendorProduct','업체라벨 품명'],['vendorQty','업체라벨 수량'],['vendorProdDate','업체 생산일자'],['vendorProdTime','업체 생산시간'],['vendorLotNo','업체 Lot No.'],['vendorPalletNo','업체 파레트 No.'],['vendorLine','생산라인'],['note','특이사항'],['inspector','검수자']];
  V22.openEditCurrent=function(){
    const r=currentViewRecord&&currentViewRecord.record;if(!r)return;
    if(String(r.mode||'').indexOf('다중')===0){alert('다중 파레트는 현재 운영 보류 상태라 수정 기능도 보류합니다.');return;}
    const box=$('v22EditFields');box.innerHTML=EDIT_FIELDS.map(([k,l])=>`<div class="field"><label>${e(l)}</label>${k==='note'?`<textarea data-edit="${k}">${e(r[k]||'')}</textarea>`:`<input data-edit="${k}" value="${e(r[k]||'')}">`}</div>`).join('');
    $('v22EditActor').value=r.inspector||getRememberedInspector()||'';$('v22EditReason').value='';$('v22EditCard').classList.remove('hidden');$('v22EditCard').scrollIntoView({behavior:'smooth',block:'start'});
  };
  V22.saveEditCurrent=async function(){
    const r=currentViewRecord&&currentViewRecord.record;if(!r)return;const actor=$('v22EditActor').value.trim(),reason=$('v22EditReason').value.trim();if(!actor||!reason){setStatus('v22EditStatus','수정자와 수정 사유를 입력하세요.','bad');return;}
    const changes={};document.querySelectorAll('#v22EditFields [data-edit]').forEach(el=>changes[el.dataset.edit]=el.value.trim());
    setStatus('v22EditStatus','수정 저장 중...','warn');try{const res=await apiPost('updateRecord',{id:r.id,actor,reason,changes});if(!res.ok){setStatus('v22EditStatus','수정 실패: '+res.message,'bad');return;}setStatus('v22EditStatus','수정 완료 · Audit 이력 저장됨','ok');const fresh=await apiGet('getRecord',{id:r.id});if(fresh.ok){currentViewRecord=fresh;Object.assign(r,fresh.record);}setTimeout(()=>{$('v22EditCard').classList.add('hidden');searchViewRecords();},500);}catch(err){setStatus('v22EditStatus','수정 실패: '+err,'bad');}
  };
  V22.deleteCurrent=async function(){
    const r=currentViewRecord&&currentViewRecord.record;if(!r)return;if(String(r.mode||'').indexOf('다중')===0){alert('다중 파레트 기록은 현재 운영 보류 중이라 삭제도 잠금 상태입니다.');return;}
    if(!confirm('기록을 삭제하면 DB 기록과 연결된 Google Drive 사진도 삭제됩니다.\nAudit 이력은 남습니다.\n\n계속할까요?'))return;
    const actor=prompt('삭제자 이름을 입력하세요.',r.inspector||getRememberedInspector()||'');if(actor===null)return;const reason=prompt('삭제 사유를 입력하세요. (필수)','오등록');if(reason===null)return;if(!actor.trim()||!reason.trim()){alert('삭제자와 삭제 사유는 필수입니다.');return;}
    const check=prompt('최종 확인을 위해 DELETE 를 입력하세요.','');if(check!=='DELETE')return;
    showBusy('기록 및 사진 삭제 중...');try{const res=await apiPost('deleteRecord',{id:r.id,actor:actor.trim(),reason:reason.trim()});if(!res.ok){alert('삭제 실패: '+res.message);return;}V22.selectedIds.delete(String(r.id));currentViewRecord=null;$('viewDetailCard').classList.add('hidden');$('v22EditCard').classList.add('hidden');setStatus('viewSearchStatus','삭제 완료 · 사진 '+Number(res.deletedPhotos||0)+'개 삭제 · Audit 기록 완료','ok');await searchViewRecords();}catch(err){alert('삭제 실패: '+err);}finally{hideBusy();}
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
    const r=(item&&item.record)||{},p=(item&&item.pallets)||[];
    const tr=(a,b)=>`<tr><th>${e(a)}</th><td>${e(b==null?'':b)}</td></tr>`;
    const wmsPno=[r.containerFrom,r.containerTo].filter(Boolean).join(' ~ ');
    const vendorDate=[r.vendorProdDate,r.vendorProdTime].filter(Boolean).join(' ');
    const qtyText=[r.displayQty,r.unit].filter(Boolean).join(' ');
    const vendorQty=[r.vendorQty,r.unit].filter(Boolean).join(' ');
    const photos=[];

    if(withPhotos){
      String(r.labelPhotoUrl||'').split(',').filter(Boolean).slice(0,2).forEach((u,i)=>photos.push(photoHtml(u,'WMS 라벨'+(wmsPno?' · P.No '+wmsPno:'')+(i?' · '+(i+1):''))));
      String(r.vendorPhotoUrl||'').split(',').filter(Boolean).slice(0,2).forEach((u,i)=>photos.push(photoHtml(u,'업체 라벨'+(r.vendorPalletNo?' · P.No '+r.vendorPalletNo:'')+(i?' · '+(i+1):''))));
      String(r.itemPhotoUrl||'').split(',').filter(Boolean).slice(0,4).forEach((u,i)=>photos.push(photoHtml(u,'공병 실물 '+(i+1))));
      p.slice(0,6).forEach((x,i)=>{
        const wp=x.wmsPalletNo||x.containerNo||x.code||'',vp=x.vendorPalletNo||'';
        if(x.wmsPhotoUrl)photos.push(photoHtml(x.wmsPhotoUrl,'P'+(i+1)+' WMS'+(wp?' · '+wp:'')));
        if(x.vendorPhotoUrl)photos.push(photoHtml(x.vendorPhotoUrl,'P'+(i+1)+' 업체'+(vp?' · '+vp:'')));
      });
    }

    const vendorRows=[
      r.vendorProduct?tr('업체라벨 품명',r.vendorProduct):'',
      r.vendorQty?tr('업체라벨 수량',vendorQty):'',
      vendorDate?tr('업체 생산일시',vendorDate):'',
      r.vendorLotNo?tr('업체 Lot / P-L No.',r.vendorLotNo):'',
      r.vendorPalletNo?tr('업체 파레트 No.',r.vendorPalletNo):'',
      r.vendorLine?tr('업체 생산라인',r.vendorLine):''
    ].join('');

    return `<section class="sheet"><h1>공병 입고 확인 기록서</h1>
      <div class="meta">기록 ID ${e(r.id||'')} · ${e(r.regDate||'')} · ${e(r.mode||'')}</div>
      <h2>WMS / 입고정보</h2>
      <table class="info">
        ${tr('입고번호',r.inboundNo)}${tr('입고일자',r.inboundDate)}
        ${tr('품명',r.product)}${tr('품목코드',r.itemCode)}
        ${tr('제조원',r.manufacturer)}${tr('공급업체',r.supplier)}
        ${tr('표시수량',qtyText)}${tr('사용기한',r.expiryDate)}
        ${wmsPno?tr('WMS 파레트 / 용기번호',wmsPno):''}
      </table>
      ${vendorRows?`<h2>업체 라벨</h2><table class="info">${vendorRows}</table>`:''}
      <h2>검수 결과</h2>
      <table class="info">
        ${r.infoMatch?tr('입고정보 일치',r.infoMatch):''}
        ${r.labelMatch?tr('라벨 대조',r.labelMatch):''}
        ${r.mixed?tr('혼입 여부',r.mixed):''}
        ${r.actualQty?tr('실제 확인수량',r.actualQty):''}
        ${r.qtyResult?tr('수량 판정',r.qtyResult):''}
        ${r.palletCount?tr('파레트 수',r.palletCount):''}
        ${r.totalQty?tr('총 수량',r.totalQty):''}
        ${tr('최종 결과',r.finalResult)}${tr('검수자',r.inspector)}${tr('특이사항',r.note)}
      </table>
      ${p.length?`<h2>파레트 상세</h2><table><tr><th>#</th><th>WMS 파레트 No.</th><th>업체 파레트 No.</th><th>품명</th><th>수량</th><th>판정</th></tr>${p.map(x=>`<tr><td>${e(x.seq)}</td><td>${e(x.wmsPalletNo||x.containerNo||x.code||'')}</td><td>${e(x.vendorPalletNo||'')}</td><td>${e(x.product)}</td><td>${e(x.qty)} ${e(x.unit||'')}</td><td>${e(x.result)}</td></tr>`).join('')}</table>`:''}
      ${withPhotos&&photos.filter(Boolean).length?`<h2>증빙 사진</h2><div class="photos">${photos.join('')}</div>`:''}
      <div class="sign"><div>검수자</div><div>확인자</div></div>
    </section>`;
  }

  function printCss(){return `<style>@page{size:A4;margin:10mm}*{box-sizing:border-box}body{font-family:'Malgun Gothic',sans-serif;color:#111;margin:0} .sheet{page-break-after:always;min-height:270mm;padding:2mm}.sheet:last-child{page-break-after:auto}h1{font-size:18px;margin:0 0 6px;border-bottom:2px solid #1F4B5F;padding-bottom:6px}h2{font-size:13px;margin:12px 0 5px}.meta{font-size:10px;color:#666;margin-bottom:7px}table{width:100%;border-collapse:collapse;font-size:10px;margin:7px 0}th,td{border:1px solid #aaa;padding:4px 5px}th{background:#f1f0eb}.info th{width:25%}tr{break-inside:avoid}td{word-break:break-word}.photos{display:grid;grid-template-columns:repeat(3,1fr);gap:5px}.photos figure{margin:0;border:1px solid #ccc;padding:3px}.photos img{width:100%;height:42mm;object-fit:contain;display:block}.photos figcaption{text-align:center;font-size:9px;margin-top:2px}.sign{display:flex;justify-content:flex-end;gap:25px;margin-top:16px;font-size:10px}.sign div{width:100px;border-top:1px solid #333;text-align:center;padding-top:4px}.report-box{border:1px solid #999;margin:7px 0}.report-row{display:grid;grid-template-columns:26mm 1fr;border-bottom:1px solid #bbb}.report-row:last-child{border-bottom:0}.report-row b{background:#f1f0eb;padding:6px}.report-row div{padding:6px;white-space:pre-wrap}.timeline{display:flex;gap:8px;font-size:10px;align-items:center;flex-wrap:wrap}.timeline span{padding:4px 7px;border:1px solid #bbb;border-radius:20px}.dev-title{font-size:14px;font-weight:700;margin:10px 0 5px}.dev-note{font-size:9px;color:#555}.dev-table th{width:25mm}.pno{font-family:monospace;font-weight:700}</style>`;}

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

  function issueText(items){
    const out=[];items.forEach(it=>{const r=it.record;if(String(r.mixed)==='있음')out.push('혼입');if(String(r.labelMatch)==='불일치')out.push('라벨 불일치');if(String(r.qtyResult)==='불일치')out.push('수량 불일치');if(String(r.finalResult)==='확인필요')out.push('확인필요');(it.pallets||[]).forEach(p=>{if(String(p.result)!=='정상')out.push('파레트 '+(p.seq||'')+' '+(p.result||'이상'));});});return [...new Set(out)];
  }

  function renderReportForm(kind,items){
    const recs=items.map(x=>x.record),issues=issueText(items),inbound=[...new Set(recs.map(r=>r.inboundNo).filter(Boolean))],products=[...new Set(recs.map(r=>r.product).filter(Boolean))],inspectors=[...new Set(recs.map(r=>r.inspector).filter(Boolean))];
    const notes=recs.map(r=>String(r.note||'').trim()).filter(Boolean),dates=recs.map(r=>r.regDate).filter(Boolean).sort();
    const box=$('v22ReportFields');$('v22ReportTitle').textContent=kind==='executive'?'임원보고서 작성':'일탈형 조사보고서 작성';$('v22ReportBadge').textContent=kind==='executive'?'1Page Summary':'6하원칙 + 조사/조치';
    if(kind==='executive'){
      box.innerHTML=`<div class="v22-report-grid"><div class="field span2"><label>목적</label><input id="rPurpose"></div><div class="field span2"><label>결론</label><textarea id="rConclusion"></textarea></div><div class="field"><label>Impact</label><textarea id="rImpact"></textarea></div><div class="field"><label>Risk</label><textarea id="rRisk"></textarea></div><div class="field span2"><label>근본원인</label><textarea id="rCause"></textarea></div><div class="field span2"><label>재발방지대책 / 조치</label><textarea id="rAction"></textarea></div></div>`;
      $('rPurpose').value=`${products.join(', ')||'공병'} 입고 검수 ${recs.length}건의 확인 결과 및 영향성을 검토하고자 함.`;
      $('rConclusion').value=`선택 기록 ${recs.length}건 / 입고번호 ${inbound.length}건 중 이상·확인 항목 ${issues.length?issues.join(', '):'없음'}. ${issues.length?'생산 투입 여부 및 대상 파레트 추가 확인 필요.':'선택 기록 기준 특이 이상 없음.'}`;
      $('rImpact').value=issues.length?'대상 공병의 재고·생산 투입 여부 확인 필요. 실제 생산 영향은 투입 추적 결과 기준으로 판단.':'선택 검수기록 기준 생산/재고 영향 확인사항 없음.';
      $('rRisk').value=issues.length?'라벨/파레트 식별 불일치 또는 혼입이 확인되지 않을 경우 오투입 및 추적성 저하 가능.':'현행 파레트 식별 및 생산 투입 추적 유지 필요.';
      $('rCause').value=notes.length?notes.slice(0,5).join('\n'):'원인조사 결과 입력';
      $('rAction').value=issues.length?'대상 파레트 식별·격리 → WMS/업체 라벨 및 실물 재확인 → 생산 투입 추적 → 공급업체 원인조사/CAPA 확인 → 필요 시 검수기준 반영':'현행 입고 검수 및 생산 투입 추적 유지';
    }else{
      const what=`대상: ${products.join(', ')||'공병'} / 입고번호 ${inbound.join(', ')||'-'}\n확인사항: ${issues.length?issues.join(', '):'선택 기록에서 명시적 이상항목 없음 - 조사내용 입력 필요'}`;
      const pnos=[];items.forEach(it=>(it.pallets||[]).forEach(p=>pnos.push('WMS '+(p.wmsPalletNo||p.containerNo||p.code||'-')+' / 업체 '+(p.vendorPalletNo||'-'))));
      box.innerHTML=`<div class="v22-report-grid">
        <div class="field span2"><label>사건/조사 제목</label><input id="iTitle"></div>
        <div class="field"><label>언제 (발생/인지 일시)</label><textarea id="iWhen"></textarea></div><div class="field"><label>어디서 (발생/확인 장소)</label><textarea id="iWhere"></textarea></div>
        <div class="field"><label>누가 (발견자/관련 작업자)</label><textarea id="iWho"></textarea></div><div class="field"><label>무엇을 (대상/현상)</label><textarea id="iWhat"></textarea></div>
        <div class="field span2"><label>어떻게 (발견 경위/사건 경위)</label><textarea id="iHow"></textarea></div>
        <div class="field span2"><label>왜 (초기 원인/조사 가설)</label><textarea id="iWhy"></textarea></div>
        <div class="field span2"><label>즉시조치 / 격리</label><textarea id="iImmediate"></textarea></div>
        <div class="field"><label>영향평가</label><textarea id="iImpact"></textarea></div><div class="field"><label>조사 근거 / 증빙</label><textarea id="iEvidence"></textarea></div>
        <div class="field span2"><label>조사결과 / 근본원인</label><textarea id="iRootCause"></textarea></div>
        <div class="field span2"><label>시정 및 재발방지대책 (CAPA)</label><textarea id="iCapa"></textarea></div></div>`;
      $('iTitle').value=`${products.join(', ')||'공병'} 입고 검수 이상 조사`;
      $('iWhen').value=dates.length?(dates[0]+(dates.length>1?' ~ '+dates[dates.length-1]:'')):'발생/인지 일시 확인 필요';
      $('iWhere').value='공병 입고검수 구역 / 공병창고 (실제 장소 확인 후 수정)';
      $('iWho').value=inspectors.length?('발견/검수자: '+inspectors.join(', ')):'발견자 및 관련 작업자 확인 필요';
      $('iWhat').value=what+(pnos.length?'\n파레트: '+pnos.slice(0,12).join(' / '):'');
      $('iHow').value=notes.length?('입고 검수 및 WMS/업체 라벨 대조 과정에서 확인.\n'+notes.slice(0,5).join('\n')):'입고 검수 중 WMS 라벨·업체 라벨·실물을 대조하는 과정에서 확인. 상세 경위 입력 필요.';
      $('iWhy').value='초기 원인 미확정. 라벨 발행/부착, 파레트 식별, 공급업체 포장·출하, 입고 및 보관 과정에 대해 사실관계 조사 필요.';
      $('iImmediate').value=issues.length?'대상 파레트 식별 및 사용 보류/격리 → 동일 입고건 전수 식별 확인 → 생산 투입 여부 즉시 추적':'조사 대상 식별 및 현상 보존. 추가 이상 유무 확인.';
      $('iImpact').value='재고 영향: 대상 수량/파레트 범위 확인 필요\n생산 영향: 해당 파레트의 생산 투입 이력 확인 필요\n품질 영향: 실제 혼입/오투입 여부 및 추적성 확인 후 최종 판정';
      $('iEvidence').value='WMS 입고라벨, 업체 파레트 라벨, 공병 실물사진, 입고 검수기록, 파레트 No., 생산 투입 추적기록';
      $('iRootCause').value='조사 진행 후 사실과 증빙을 근거로 확정';
      $('iCapa').value='근본원인 확정 후 공급업체/자재지원/관련부서별 시정조치 및 재발방지대책 수립, 효과확인 일정 설정';
    }
  }

  V22.prepareReport=async function(kind){
    const ids=selectedIds();if(!ids.length){alert('보고서에 포함할 기록을 먼저 선택하세요.');return;}
    showBusy('보고자료를 구성하는 중...');
    try{const items=await batchRecords(ids);V22.reportData=items;V22.reportKind=kind;renderReportForm(kind,items);$('v22ReportBuilder').classList.remove('hidden');$('v22ReportBuilder').scrollIntoView({behavior:'smooth',block:'start'});}
    catch(err){alert('보고서 준비 실패: '+err);}finally{hideBusy();}
  };

  function executivePage(items){
    const get=id=>e($(id).value||''),recs=items.map(x=>x.record),dates=recs.map(r=>r.regDate).filter(Boolean).slice(0,5),photos=[];
    items.forEach(it=>{if(it.record.labelPhotoUrl)photos.push(photoHtml(String(it.record.labelPhotoUrl).split(',')[0],'WMS'));if(it.record.vendorPhotoUrl)photos.push(photoHtml(String(it.record.vendorPhotoUrl).split(',')[0],'업체'));});
    return `<section class="sheet"><h1>공병 입고 검수 임원보고</h1><div class="report-box"><div class="report-row"><b>목적</b><div>${get('rPurpose')}</div></div><div class="report-row"><b>결론</b><div>${get('rConclusion')}</div></div><div class="report-row"><b>Impact</b><div>${get('rImpact')}</div></div><div class="report-row"><b>Risk</b><div>${get('rRisk')}</div></div><div class="report-row"><b>근본원인</b><div>${get('rCause')}</div></div><div class="report-row"><b>재발방지</b><div>${get('rAction')}</div></div></div><h2>검수 Timeline</h2><div class="timeline">${dates.map(d=>`<span>${e(d)}</span>`).join(' → ')}</div><h2>대상 기록</h2><table><tr><th>입고번호</th><th>품명</th><th>결과</th><th>검수자</th></tr>${recs.slice(0,8).map(r=>`<tr><td>${e(r.inboundNo)}</td><td>${e(r.product)}</td><td>${e(r.finalResult)}</td><td>${e(r.inspector)}</td></tr>`).join('')}</table>${photos.filter(Boolean).length?`<div class="photos">${photos.slice(0,2).join('')}</div>`:''}</section>`;
  }

  function investigationPage(items){
    const get=id=>e($(id).value||''),palletRows=[];items.forEach(it=>(it.pallets||[]).forEach(p=>palletRows.push(`<tr><td>${e(it.record.inboundNo)}</td><td class="pno">${e(p.wmsPalletNo||p.containerNo||p.code||'')}</td><td class="pno">${e(p.vendorPalletNo||'')}</td><td>${e(p.product||it.record.product)}</td><td>${e(p.result||'')}</td></tr>`)));
    return `<section class="sheet"><h1>공병 입고 이상 조사보고서</h1><div class="meta">일탈 수준 사실조사 양식 · 6하원칙 및 영향/조치 중심</div><div class="dev-title">1. 조사 개요</div><table class="dev-table"><tr><th>조사 제목</th><td colspan="3">${get('iTitle')}</td></tr><tr><th>언제</th><td>${get('iWhen')}</td><th>어디서</th><td>${get('iWhere')}</td></tr><tr><th>누가</th><td>${get('iWho')}</td><th>무엇을</th><td>${get('iWhat')}</td></tr></table><div class="dev-title">2. 발생/발견 경위</div><div class="report-box"><div class="report-row"><b>어떻게</b><div>${get('iHow')}</div></div><div class="report-row"><b>왜</b><div>${get('iWhy')}</div></div></div><div class="dev-title">3. 즉시조치 및 영향평가</div><div class="report-box"><div class="report-row"><b>즉시조치</b><div>${get('iImmediate')}</div></div><div class="report-row"><b>영향평가</b><div>${get('iImpact')}</div></div><div class="report-row"><b>증빙</b><div>${get('iEvidence')}</div></div></div><div class="dev-title">4. 조사결과 및 CAPA</div><div class="report-box"><div class="report-row"><b>근본원인</b><div>${get('iRootCause')}</div></div><div class="report-row"><b>CAPA</b><div>${get('iCapa')}</div></div></div>${palletRows.length?`<div class="dev-title">5. 조사 대상 파레트 식별</div><table><tr><th>입고번호</th><th>WMS 파레트 No.</th><th>업체 파레트 No.</th><th>품명</th><th>판정</th></tr>${palletRows.join('')}</table>`:''}<div class="sign"><div>조사자</div><div>검토자</div><div>승인자</div></div></section>`;
  }

  V22.printReport=async function(){
    const items=V22.reportData;if(!items||!items.length)return;
    const w=window.open('','_blank');if(!w){alert('팝업을 허용해주세요.');return;}w.document.write('<p>보고서 준비 중...</p>');
    try{
      await hydratePhotos(items);const kind=V22.reportKind;
      const main=kind==='executive'?executivePage(items):investigationPage(items);
      // 조사보고서는 증빙 별첨을 붙이고, 임원보고는 1Page 요약을 유지한다.
      const appendix=kind==='investigation'?items.map(x=>recordPage(x,true)).join(''):'';
      const html=`<!doctype html><html lang="ko"><head><meta charset="utf-8"><title>${kind==='executive'?'공병 입고 임원보고':'공병 입고 이상 조사보고서'}</title>${printCss()}</head><body>${main}${appendix}<script>window.onload=()=>setTimeout(()=>window.print(),450)<\/script></body></html>`;
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
    // 다중 파레트는 V22.2에서 운영 보류: 기존 코드는 유지하되 화면에서는 숨김
    if($('tabMulti'))$('tabMulti').style.display='none';if($('multi'))$('multi').style.display='none';
    const sub=document.querySelector('header .sub');if(sub)sub.textContent='단건 중심 · OCR · 수정/삭제 Audit · 입고/생산 추적';
    const labels={tabDash:'홈/현황',tabSingle:'단건',tabMulti:'다중(보류)',tabProd:'생산',tabView:'조회/보고'};Object.keys(labels).forEach(id=>{if($(id))$(id).textContent=labels[id];});
    // Dashboard server calls are deferred until V24 authentication is ready.
    // The dashboard section is already the default visible section in HTML.
    // Tesseract legacy worker는 운영에서 사용하지 않는다.
    // 한국어 로컬 OCR(PP-OCRv5)은 실제 스캔 시 초기화하여 불필요한 로딩/오류를 방지한다.
  }

  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init);else init();
})();
