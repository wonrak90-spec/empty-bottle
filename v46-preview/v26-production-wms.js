/* V26 생산 WMS 자동스캔
 * - 기존 생산 바코드 스캔은 유지
 * - WMS 라벨 전체화면/손-held 최적 프레임 + 한국어 로컬 OCR
 * - 입고 검수 이력과 정확히 매칭된 파레트만 자동 등록
 */
(function(){
  'use strict';
  if(window.__V26_PROD_WMS__)return;
  window.__V26_PROD_WMS__=true;

  const $=id=>document.getElementById(id);
  const KO=window.V26KoreanOCR;
  const WMS=window.V26WmsCardScan;
  if(!KO||typeof KO.recognize!=='function'||!WMS){
    console.warn('[V26-PROD-WMS] OCR/WMS layer not ready');
    return;
  }

  const P=window.V26ProdWms={VERSION:'V26-PROD-WMS-1',state:null};
  const sleep=ms=>new Promise(r=>setTimeout(r,ms));

  function normNo(v){return String(v||'').replace(/\D/g,'').replace(/^0+(?=\d)/,'');}
  function itemKey(x){return [x&&x.id,x&&x.recordId,x&&x.inboundNo,x&&x.containerNo,x&&x.code].map(v=>String(v||'')).join('|');}

  function ensureUi(){
    const card=$('prodRunCard');if(!card||$('btnProdWmsAuto'))return;
    const barcode=[...card.querySelectorAll('button')].find(b=>/startProdScan/.test(b.getAttribute('onclick')||''));
    if(!barcode)return;
    barcode.textContent='📊 바코드 스캔';
    barcode.classList.remove('btn-big');
    const b=document.createElement('button');
    b.id='btnProdWmsAuto';b.type='button';b.className='btn primary btn-big';
    b.textContent='🎥 WMS 라벨 자동 스캔';b.onclick=()=>P.start();
    barcode.parentNode.insertBefore(b,barcode);
  }

  function makeOverlay(){
    let root=$('v26ProdWmsOverlay');if(root)return root;
    root=document.createElement('div');root.id='v26ProdWmsOverlay';root.className='hidden';
    root.style.cssText='position:fixed;inset:0;z-index:10020;background:#000;overflow:hidden;';
    root.innerHTML='<video id="v26ProdWmsVideo" playsinline muted style="width:100%;height:100%;object-fit:cover;background:#000"></video>'+
      '<div style="position:absolute;inset:0;display:flex;align-items:center;justify-content:center;pointer-events:none">'+
        '<div id="v26ProdWmsBox" style="width:90%;aspect-ratio:1.55/1;border:3px solid #fff;border-radius:14px;box-shadow:0 0 0 9999px rgba(0,0,0,.28);position:relative">'+
          '<div id="v26ProdWmsState" style="position:absolute;left:8px;right:8px;bottom:8px;padding:8px;border-radius:9px;background:rgba(0,0,0,.65);color:#fff;text-align:center;font-size:13px">WMS 라벨을 맞춰주세요</div>'+
        '</div>'+
      '</div>'+
      '<div id="v26ProdWmsTop" style="position:absolute;left:12px;right:12px;top:max(12px,env(safe-area-inset-top));padding:10px 12px;border-radius:10px;background:rgba(0,0,0,.7);color:#fff;text-align:center;font-weight:700">생산 WMS 자동 스캔</div>'+
      '<div style="position:absolute;left:0;right:0;bottom:0;display:grid;grid-template-columns:2fr 1fr;gap:8px;padding:12px 12px calc(12px + env(safe-area-inset-bottom));background:linear-gradient(transparent,rgba(0,0,0,.8))">'+
        '<button class="btn primary" type="button" onclick="V26ProdWms.captureNow()">📷 현재 화면 인식</button>'+
        '<button class="btn outline" type="button" onclick="V26ProdWms.stop()">취소</button>'+
      '</div>';
    document.body.appendChild(root);return root;
  }

  function overlayStatus(t,ok){
    const a=$('v26ProdWmsState'),b=$('v26ProdWmsBox'),top=$('v26ProdWmsTop');
    if(a)a.textContent=t;if(top)top.textContent=t;
    if(b)b.style.borderColor=ok?'#4ade80':'#fff';
    if(top)top.style.background=ok?'rgba(20,120,65,.86)':'rgba(0,0,0,.7)';
  }

  function crop(video,maxSide){
    const vw=video.videoWidth,vh=video.videoHeight;if(!vw||!vh)return '';
    const aspect=1.55;let sw=vw*.90,sh=sw/aspect;if(sh>vh*.76){sh=vh*.76;sw=sh*aspect;}
    const sx=(vw-sw)/2,sy=(vh-sh)/2,scale=Math.min(1,(maxSide||2200)/Math.max(sw,sh));
    const c=document.createElement('canvas');c.width=Math.round(sw*scale);c.height=Math.round(sh*scale);
    const ctx=c.getContext('2d',{alpha:false});ctx.fillStyle='#fff';ctx.fillRect(0,0,c.width,c.height);
    ctx.imageSmoothingEnabled=true;ctx.imageSmoothingQuality='high';ctx.drawImage(video,sx,sy,sw,sh,0,0,c.width,c.height);
    return c.toDataURL('image/jpeg',.90);
  }

  function sample(video){
    const vw=video.videoWidth,vh=video.videoHeight;if(!vw||!vh)return null;
    const aspect=1.55;let sw=vw*.90,sh=sw/aspect;if(sh>vh*.76){sh=vh*.76;sw=sh*aspect;}
    const sx=(vw-sw)/2,sy=(vh-sh)/2,c=document.createElement('canvas');c.width=180;c.height=116;
    const ctx=c.getContext('2d',{willReadFrequently:true});ctx.drawImage(video,sx,sy,sw,sh,0,0,c.width,c.height);
    const d=ctx.getImageData(0,0,c.width,c.height).data,g=new Uint8Array(c.width*c.height);
    let sum=0,sum2=0,sharp=0,k=0;
    for(let y=0;y<c.height;y++)for(let x=0;x<c.width;x++,k++){
      const i=k*4,v=(d[i]*77+d[i+1]*150+d[i+2]*29)>>8;g[k]=v;sum+=v;sum2+=v*v;
      if(x)sharp+=Math.abs(v-g[k-1]);if(y)sharp+=Math.abs(v-g[k-c.width]);
    }
    const n=g.length,mean=sum/n;return {gray:g,brightness:mean,contrast:Math.sqrt(Math.max(0,sum2/n-mean*mean)),sharpness:sharp/(n*2)};
  }
  function diff(a,b){if(!a||!b)return 999;let s=0;for(let i=0;i<a.gray.length;i+=4)s+=Math.abs(a.gray[i]-b.gray[i]);return s/Math.ceil(a.gray.length/4);}

  async function resolvePallet(parsed){
    const inbound=String(parsed.inboundNo||'').trim();
    const cont=String(parsed.containerFrom||'').trim();
    const candidates=(WMS.lookupCandidates?WMS.lookupCandidates(parsed):[]).slice(0,4);
    const seen=new Map();
    for(const q of candidates){
      try{
        const res=await apiGet('searchPallets',{keyword:q});
        for(const it of (res&&res.items)||[])seen.set(itemKey(it),it);
      }catch(_){}
    }
    const items=[...seen.values()];
    const exact=(inbound&&cont)?items.filter(it=>
      String(it.inboundNo||'').trim()===inbound &&
      normNo(it.containerNo||it.wmsPalletNo||it.code)===normNo(cont)
    ):[];

    if(exact.length===1)return {hit:exact[0],items,exact:true};

    // 자동등록은 정확한 입고번호+용기번호 일치일 때만 한다.
    const kw=(inbound&&cont)?(inbound+'-'+cont):(inbound||cont||String(parsed.itemCode||''));
    if($('prodSearchKw'))$('prodSearchKw').value=kw;
    if(typeof searchPalletsForProd==='function'&&kw){
      try{await searchPalletsForProd();}catch(_){}
    }
    return {hit:null,items,exact:false};
  }

  async function processData(data){
    if(!data)return;
    overlayStatus('한국어 OCR 인식 중',true);
    try{
      const r=await KO.recognize(data,false,'prodSearchStatus');
      const parsed=WMS.parseWms?WMS.parseWms(r.text,r.items):(parseLabelText(r.text)||{});
      const key=[parsed.inboundNo,parsed.containerFrom].filter(Boolean).join('-');
      overlayStatus(key?('인식 완료 · '+key):'WMS 정보 인식 완료',true);
      if(typeof setStatus==='function')setStatus('prodSearchStatus','WMS 라벨 인식 완료 · 검수 이력 확인 중...','warn');
      const resolved=await resolvePallet(parsed);
      if(resolved.hit){
        overlayStatus('검수 이력 일치 · 생산 등록 중',true);
        await addProdPallet(resolved.hit);
        await sleep(700);P.stop();return;
      }
      P.stop();
      if(typeof setStatus==='function'){
        setStatus('prodSearchStatus',
          key?'WMS 인식 완료 · 정확히 일치하는 파레트가 1건으로 확정되지 않아 아래 검색결과에서 선택하세요.':'WMS 정보가 부족합니다 · 검색결과 또는 바코드 스캔을 사용하세요.',
          'warn');
      }
      const box=$('prodSearchResults');if(box)box.scrollIntoView({behavior:'smooth',block:'center'});
    }catch(e){
      overlayStatus('인식 실패 · 다시 시도해주세요',false);
      if(typeof setStatus==='function')setStatus('prodSearchStatus','WMS 자동 인식 실패: '+String(e&&e.message?e.message:e),'bad');
      await sleep(800);P.stop();
    }
  }

  P.start=async function(){
    ensureUi();
    if(typeof prodSession==='undefined'||!prodSession){if(typeof setStatus==='function')setStatus('prodSearchStatus','먼저 작업을 시작하세요.','bad');return;}
    if(P.state)P.stop();
    try{if(typeof stopScanner==='function')await stopScanner();}catch(_){}
    try{
      const root=makeOverlay(),video=$('v26ProdWmsVideo');
      const stream=await navigator.mediaDevices.getUserMedia({video:{facingMode:{ideal:'environment'},width:{ideal:1920},height:{ideal:1080}},audio:false});
      P.state={stream,running:true,started:Date.now(),prev:null,best:'',bestScore:-Infinity,good:0,processing:false};
      video.srcObject=stream;await video.play();root.classList.remove('hidden');document.body.style.overflow='hidden';
      overlayStatus('WMS 라벨을 프레임 안에 맞춰주세요',false);
      setTimeout(P.tick,180);
    }catch(e){P.stop();if(typeof setStatus==='function')setStatus('prodSearchStatus','카메라 실행 실패: '+String(e&&e.message?e.message:e),'bad');}
  };

  P.tick=function(){
    const st=P.state,video=$('v26ProdWmsVideo');if(!st||!st.running||st.processing||!video||!video.videoWidth)return;
    const cur=sample(video);if(!cur){setTimeout(P.tick,180);return;}
    const d=diff(cur,st.prev);st.prev=cur;
    const score=Math.min(cur.sharpness,30)*3.2+Math.min(cur.contrast,65)*1.1-Math.abs(cur.brightness-155)*.12-Math.min(d,45)*.35;
    const ok=cur.brightness>=42&&cur.brightness<=242&&cur.contrast>=14&&cur.sharpness>=6.2;
    if(ok){st.good++;if(score>st.bestScore){const x=crop(video,2200);if(x){st.best=x;st.bestScore=score;}}}
    let msg=cur.brightness<42?'조금 더 밝게 비춰주세요':cur.brightness>242?'반사가 강합니다 · 각도를 바꿔주세요':cur.contrast<14?'라벨을 조금 더 가까이 맞춰주세요':cur.sharpness<6.2?'초점을 맞추는 중입니다':d>26?'움직여도 괜찮습니다 · 프레임 안에 유지해주세요':'좋은 프레임을 찾았습니다 · 자동 선택 중';
    overlayStatus(msg,ok);
    const elapsed=Date.now()-st.started,ready=!!st.best&&((elapsed>=900&&st.good>=2&&st.bestScore>=42)||(elapsed>=1700&&st.good>=1));
    if(!ready&&elapsed<7000){setTimeout(P.tick,160);return;}
    if(!st.best){overlayStatus('프레임을 잡지 못했습니다 · 현재 화면 버튼을 사용하세요',false);setTimeout(P.tick,500);return;}
    st.processing=true;processData(st.best);
  };

  P.captureNow=function(){
    const video=$('v26ProdWmsVideo');if(!video||!video.videoWidth)return;
    const data=crop(video,2300);if(P.state)P.state.processing=true;processData(data);
  };

  P.stop=function(){
    const st=P.state;if(st&&st.stream)st.stream.getTracks().forEach(t=>t.stop());
    P.state=null;const video=$('v26ProdWmsVideo');if(video)video.srcObject=null;
    const root=$('v26ProdWmsOverlay');if(root)root.classList.add('hidden');
    document.body.style.overflow='';
  };

  function init(){ensureUi();setTimeout(ensureUi,700);setTimeout(ensureUi,1800);}
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init,{once:true});else init();
})();