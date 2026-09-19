/* V55 Adaptive OCR Benchmark Layer
 * Benchmark-only until holdout evidence shows a measurable gain.
 * Does NOT override labelPhotoSelected, live OCR, save, or production flows.
 */
(function(){
  'use strict';
  if(window.__V55_ADAPTIVE_OCR__)return;
  window.__V55_ADAPTIVE_OCR__=true;

  const A=window.V55AdaptiveOCR={
    VERSION:'V55-ADAPTIVE-OCR-1',
    MAX_EXTRA_PASSES:3
  };

  const CRITICAL={
    wms:['inboundNo','itemCode','product','displayQty','containerFrom','containerTo'],
    vendor:['product','qty','palletNo']
  };

  function present(v){return v!=null&&String(v).trim()!=='';}
  function digits(v){return String(v??'').replace(/[^0-9]/g,'');}
  function allFields(parsed){return Object.keys(parsed||{}).filter(k=>present(parsed[k]));}

  A.criticalKeys=function(type){return (CRITICAL[type]||CRITICAL.wms).slice();};

  A.scoreParsed=function(type,parsed,items){
    parsed=parsed||{};
    const keys=A.criticalKeys(type);
    let critical=0,sanity=0;
    for(const k of keys){
      const v=parsed[k];
      if(!present(v))continue;
      critical++;
      if(k==='inboundNo'){
        const d=digits(v); if(d.length>=6&&d.length<=12)sanity++;
      }else if(k==='itemCode'){
        const d=digits(v); if(d.length>=4&&d.length<=14)sanity++;
      }else if(k==='displayQty'||k==='qty'){
        const n=Number(digits(v)); if(Number.isFinite(n)&&n>0)sanity++;
      }else if(k==='containerFrom'||k==='containerTo'||k==='palletNo'){
        const d=digits(v); if(d.length>=1&&d.length<=8)sanity++;
      }else if(k==='product'){
        if(String(v).replace(/\s/g,'').length>=2)sanity++;
      }
    }
    const total=allFields(parsed).length;
    const scores=(items||[]).map(x=>Number(x&&x.score)).filter(Number.isFinite);
    const mean=scores.length?scores.reduce((a,b)=>a+b,0)/scores.length:0;
    return {
      critical,total,sanity,meanConfidence:mean,
      value:critical*100+sanity*15+Math.min(total,12)*4+Math.round(mean*10)
    };
  };

  A.needsRetry=function(type,parsed){
    const s=A.scoreParsed(type,parsed,[]);
    return type==='vendor' ? s.critical<3 : s.critical<5;
  };

  A.isStrictImprovement=function(base,candidate){
    if(!candidate||!base)return false;
    if(candidate.critical>base.critical)return true;
    if(candidate.critical<base.critical)return false;
    if(candidate.sanity>base.sanity)return true;
    if(candidate.sanity<base.sanity)return false;
    // Same Critical coverage and sanity: only accept a materially stronger OCR
    // confidence. Extra non-critical fields alone must never replace baseline.
    return candidate.meanConfidence>=base.meanConfidence+0.08;
  };

  function point(p){
    if(Array.isArray(p))return {x:Number(p[0])||0,y:Number(p[1])||0};
    return {x:Number(p&&p.x)||0,y:Number(p&&p.y)||0};
  }
  A.estimateSkew=function(items){
    const angles=[];
    for(const it of (items||[])){
      const poly=it&&it.poly;
      if(!Array.isArray(poly)||poly.length<2)continue;
      const p0=point(poly[0]),p1=point(poly[1]);
      const dx=p1.x-p0.x,dy=p1.y-p0.y;
      if(Math.abs(dx)<4)continue;
      let deg=Math.atan2(dy,dx)*180/Math.PI;
      while(deg>45)deg-=90;
      while(deg<-45)deg+=90;
      if(Math.abs(deg)<=30)angles.push(deg);
    }
    if(!angles.length)return 0;
    angles.sort((a,b)=>a-b);
    return angles[Math.floor(angles.length/2)];
  };

  function parse(type,r){
    if(type==='vendor'){
      if(window.V26VendorTemplates&&typeof V26VendorTemplates.parse==='function')
        return V26VendorTemplates.parse(r.text||'',r.items||[])||{};
      if(typeof window.parseVendorLabel==='function')return window.parseVendorLabel(r.text||'')||{};
      return {};
    }
    if(window.V26WmsCardScan&&typeof V26WmsCardScan.parseWms==='function')
      return V26WmsCardScan.parseWms(r.text||'',r.items||[])||{};
    if(typeof window.parseLabelText==='function')return window.parseLabelText(r.text||'')||{};
    return {};
  }
  A.parse=parse;

  function loadImage(dataUrl){
    return new Promise((resolve,reject)=>{
      const img=new Image();
      img.onload=()=>resolve(img);
      img.onerror=()=>reject(new Error('Adaptive OCR image load failed'));
      img.src=dataUrl;
    });
  }

  async function imageStats(dataUrl){
    const img=await loadImage(dataUrl);
    const c=document.createElement('canvas');
    const scale=Math.min(1,180/Math.max(img.naturalWidth||img.width,img.naturalHeight||img.height));
    c.width=Math.max(1,Math.round((img.naturalWidth||img.width)*scale));
    c.height=Math.max(1,Math.round((img.naturalHeight||img.height)*scale));
    const ctx=c.getContext('2d',{alpha:false,willReadFrequently:true});
    ctx.drawImage(img,0,0,c.width,c.height);
    const d=ctx.getImageData(0,0,c.width,c.height).data;
    let sum=0,n=0;
    for(let i=0;i<d.length;i+=16){
      sum+=(d[i]*0.299+d[i+1]*0.587+d[i+2]*0.114);n++;
    }
    return {brightness:n?sum/n:128};
  }

  async function filtered(dataUrl,filter){
    const img=await loadImage(dataUrl);
    const w=img.naturalWidth||img.width,h=img.naturalHeight||img.height;
    const scale=Math.min(1,1900/Math.max(w,h));
    const c=document.createElement('canvas');
    c.width=Math.max(1,Math.round(w*scale));c.height=Math.max(1,Math.round(h*scale));
    const ctx=c.getContext('2d',{alpha:false});
    ctx.fillStyle='#fff';ctx.fillRect(0,0,c.width,c.height);
    ctx.imageSmoothingEnabled=true;ctx.imageSmoothingQuality='high';
    try{ctx.filter=filter;}catch(_){}
    ctx.drawImage(img,0,0,c.width,c.height);
    try{ctx.filter='none';}catch(_){}
    return c.toDataURL('image/jpeg',.92);
  }

  async function rotated(dataUrl,deg){
    const img=await loadImage(dataUrl);
    const iw=img.naturalWidth||img.width,ih=img.naturalHeight||img.height;
    const scale=Math.min(1,1900/Math.max(iw,ih));
    const w=Math.max(1,Math.round(iw*scale)),h=Math.max(1,Math.round(ih*scale));
    const rad=deg*Math.PI/180,cs=Math.cos(rad),sn=Math.sin(rad);
    const nw=Math.ceil(Math.abs(w*cs)+Math.abs(h*sn));
    const nh=Math.ceil(Math.abs(w*sn)+Math.abs(h*cs));
    const c=document.createElement('canvas');c.width=nw;c.height=nh;
    const ctx=c.getContext('2d',{alpha:false});
    ctx.fillStyle='#fff';ctx.fillRect(0,0,nw,nh);
    ctx.imageSmoothingEnabled=true;ctx.imageSmoothingQuality='high';
    ctx.translate(nw/2,nh/2);ctx.rotate(rad);
    ctx.drawImage(img,-w/2,-h/2,w,h);
    return c.toDataURL('image/jpeg',.92);
  }

  A.plan=function(type,parsed,items,brightness){
    const plan=[];
    if(brightness<92)plan.push({name:'bright_contrast',kind:'filter',filter:'brightness(1.32) contrast(1.22) saturate(.75)'});
    else if(brightness>196)plan.push({name:'dark_contrast',kind:'filter',filter:'brightness(.84) contrast(1.28) saturate(.8)'});
    else plan.push({name:'contrast',kind:'filter',filter:'contrast(1.28) brightness(1.04) saturate(.8)'});

    const skew=A.estimateSkew(items);
    if(Math.abs(skew)>=3&&Math.abs(skew)<=25){
      plan.push({name:'deskew_'+Math.round(skew),kind:'rotate',deg:-skew});
    }else if(A.needsRetry(type,parsed)){
      plan.push({name:'rotate_left_10',kind:'rotate',deg:-10});
      plan.push({name:'rotate_right_10',kind:'rotate',deg:10});
    }
    return plan.slice(0,A.MAX_EXTRA_PASSES);
  };

  A.recognize=async function(dataUrl,type,baseline){
    if(!window.V26KoreanOCR||typeof V26KoreanOCR.recognize!=='function')
      throw new Error('V26 Korean OCR engine is not available');

    const started=performance.now();
    const first=baseline||await V26KoreanOCR.recognize(dataUrl,false,'');
    const firstParsed=parse(type,first);
    const firstScore=A.scoreParsed(type,firstParsed,first.items);
    let best={result:first,parsed:firstParsed,score:firstScore,method:'baseline'};
    const attempts=[{method:'baseline',score:firstScore.value,critical:firstScore.critical,latency:first.latency||0}];

    if(!A.needsRetry(type,firstParsed)){
      return {...best,baseline:{result:first,parsed:firstParsed,score:firstScore},
        attempts,totalLatency:Math.round(performance.now()-started),extraPasses:0};
    }

    let stats={brightness:128};
    try{stats=await imageStats(dataUrl);}catch(_){}
    const plan=A.plan(type,firstParsed,first.items,stats.brightness);

    for(const step of plan){
      let variant;
      try{
        variant=step.kind==='rotate'
          ? await rotated(dataUrl,step.deg)
          : await filtered(dataUrl,step.filter);
        const r=await V26KoreanOCR.recognize(variant,false,'');
        const p=parse(type,r);
        const score=A.scoreParsed(type,p,r.items);
        attempts.push({method:step.name,score:score.value,critical:score.critical,latency:r.latency||0});
        if(A.isStrictImprovement(best.score,score)){
          best={result:r,parsed:p,score,method:step.name};
        }
        if(!A.needsRetry(type,best.parsed))break;
      }catch(e){
        attempts.push({method:step.name,error:String(e&&e.message?e.message:e)});
      }
    }

    return {...best,baseline:{result:first,parsed:firstParsed,score:firstScore},
      attempts,totalLatency:Math.round(performance.now()-started),
      extraPasses:Math.max(0,attempts.length-1)};
  };

  console.info('[V55-ADAPTIVE-OCR-1] benchmark-only adaptive OCR ready');
})();