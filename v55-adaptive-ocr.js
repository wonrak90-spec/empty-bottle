/* V55 Adaptive OCR Benchmark Layer
 * Benchmark-only until holdout evidence shows a measurable gain.
 * Does NOT override labelPhotoSelected, live OCR, save, or production flows.
 */
(function(){
  'use strict';
  if(window.__V55_ADAPTIVE_OCR__)return;
  window.__V55_ADAPTIVE_OCR__=true;

  const A=window.V55AdaptiveOCR={
    VERSION:'V55-ADAPTIVE-OCR-2.1',
    MAX_EXTRA_PASSES:4
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
        const d=digits(v); if(d.length===8)sanity++;
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
    if(type==='vendor')return s.critical<3;
    if(s.critical<5)return true;
    const inbound=digits(parsed&&parsed.inboundNo);
    if(inbound&&inbound.length!==8)return true;
    return false;
  };

  A.isStrictImprovement=function(base,candidate){
    if(!candidate||!base)return false;
    if(candidate.critical>base.critical)return true;
    if(candidate.critical<base.critical)return false;
    if(candidate.sanity>base.sanity)return true;
    return false;
  };

  function fieldSane(k,v){
    if(!present(v))return false;
    const d=digits(v);
    if(k==='inboundNo')return d.length===8;
    if(k==='itemCode')return d.length>=4&&d.length<=14;
    if(k==='displayQty'||k==='qty')return Number(d)>0;
    if(k==='containerFrom'||k==='containerTo'||k==='palletNo')return d.length>=1&&d.length<=8;
    if(k==='product')return String(v).replace(/\s/g,'').length>=2;
    return true;
  }

  A.mergeCandidate=function(type,base,candidate,replaceField){
    const out={...(base||{})},cand=candidate||{},crit=new Set(A.criticalKeys(type));
    for(const k of Object.keys(cand)){
      if(!present(cand[k]))continue;
      if(!crit.has(k)){
        if(!present(out[k]))out[k]=cand[k];
        continue;
      }
      if(!present(out[k]))out[k]=cand[k];
      else if(!fieldSane(k,out[k])&&fieldSane(k,cand[k]))out[k]=cand[k];
      else if(replaceField===k&&fieldSane(k,cand[k]))out[k]=cand[k];
    }
    return out;
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
      if(window.V55VendorParser&&typeof V55VendorParser.parse==='function')
        return V55VendorParser.parse(r.text||'',r.items||[])||{};
      if(window.V26VendorTemplates&&typeof V26VendorTemplates.parse==='function')
        return V26VendorTemplates.parse(r.text||'',r.items||[])||{};
      if(typeof window.parseVendorLabel==='function')return window.parseVendorLabel(r.text||'')||{};
      return {};
    }
    if(window.V55WmsParser&&typeof V55WmsParser.parse==='function')
      return V55WmsParser.parse(r.text||'',r.items||[])||{};
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

  function isDate8(v){
    const d=digits(v);
    if(d.length!==8)return false;
    const y=Number(d.slice(0,4)),m=Number(d.slice(4,6)),day=Number(d.slice(6,8));
    return y>=2020&&y<=2099&&m>=1&&m<=12&&day>=1&&day<=31;
  }

  function extractTargetField(type,field,r){
    const text=String(r&&r.text||'');
    if(type==='vendor'&&field==='palletNo'){
      let m=text.match(/P\s*[/\-]\s*L\s*N\s*o\.?\s*[:\-]?\s*([0-9OQDIl|]{1,4})/i);
      if(!m)m=text.match(/P\s*[-/]?\s*(?:번\s*호|No\.?)\s*[:\-]?\s*([0-9OQDIl|]{1,4})/i);
      if(m){
        const v=digits(String(m[1]).replace(/[OoQD]/g,'0').replace(/[Il|]/g,'1'));
        if(v)return v;
      }
      return '';
    }
    if(type==='wms'&&field==='inboundNo'){
      let m=text.match(/입\s*고\s*번\s*호\s*[:\-]?\s*([0-9OoQDIl|]{7,10})/);
      if(m){
        const v=digits(String(m[1]).replace(/[OoQD]/g,'0').replace(/[Il|]/g,'1'));
        if(v.length===8&&!isDate8(v))return v;
      }
      const cand=(text.match(/[0-9OoQDIl|]{8}/g)||[])
        .map(x=>digits(x.replace(/[OoQD]/g,'0').replace(/[Il|]/g,'1')))
        .find(x=>x.length===8&&!isDate8(x));
      return cand||'';
    }
    return '';
  }

  A.extractTargetField=extractTargetField;

  function retryTarget(type,parsed){
    if(type==='vendor')return 'palletNo';
    const inbound=digits(parsed&&parsed.inboundNo);
    return inbound.length===8?'':'inboundNo';
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

    const runFull=async(name,variant)=>{
      const r=await V26KoreanOCR.recognize(variant,false,'');
      const rawParsed=parse(type,r);
      // Whole-image/ROI candidates may ADD missing Critical values, but they
      // must not overwrite an already populated Critical value. This prevents
      // a visually noisy retry from destroying a correct baseline field.
      const p=A.mergeCandidate(type,best.parsed,rawParsed,'');
      const score=A.scoreParsed(type,p,r.items);
      attempts.push({method:name,score:score.value,critical:score.critical,latency:r.latency||0});
      if(A.isStrictImprovement(best.score,score))best={result:r,parsed:p,score,method:name};
    };

    const initialNeedsRetry=A.needsRetry(type,firstParsed);

    // 1) Whole-label text cluster crop + upscale for distant/low-resolution shots.
    if(attempts.length-1<A.MAX_EXTRA_PASSES&&window.V55RoiPreprocess&&first.items&&first.items.length){
      try{
        const roi=await V55RoiPreprocess.clusterCrop(dataUrl,first.items);
        if(roi)await runFull('roi_zoom',roi.dataUrl);
      }catch(e){attempts.push({method:'roi_zoom',error:String(e&&e.message?e.message:e)});}
    }

    // 2) Small field ROI is merged into the current best result instead of
    // replacing the whole label. This is especially useful for P/L or WMS inbound.
    if(initialNeedsRetry&&attempts.length-1<A.MAX_EXTRA_PASSES&&window.V55RoiPreprocess){
      const target=retryTarget(type,best.parsed);
      if(target){
        try{
          const fr=await V55RoiPreprocess.fieldStrip(dataUrl,first.items,type,target);
          if(fr){
            const rr=await V26KoreanOCR.recognize(fr.dataUrl,false,'');
            const v=extractTargetField(type,target,rr);
            const merged=v?A.mergeCandidate(type,best.parsed,{[target]:v},target):{...best.parsed};
            const score=A.scoreParsed(type,merged,rr.items);
            attempts.push({method:'field_roi_'+target,score:score.value,critical:score.critical,latency:rr.latency||0,recovered:v||''});
            if(v){
              const changed=String(best.parsed&&best.parsed[target]??'')!==String(merged[target]??'');
              if(changed||A.isStrictImprovement(best.score,score))best={result:rr,parsed:merged,score,method:'field_roi_'+target};
            }
          }
        }catch(e){attempts.push({method:'field_roi_'+target,error:String(e&&e.message?e.message:e)});}
      }
    }

    // 3) Perspective rectify stays available in V55RoiPreprocess for future
    // experiments, but is disabled in the active retry chain: V4 Holdout made
    // 11 attempts and selected it 0 times, so it only added latency.
    
    // 4) Keep one proven legacy transform. Prefer deskew when OCR geometry gives
    // a meaningful angle; otherwise use brightness/contrast correction.
    if(A.needsRetry(type,best.parsed)&&attempts.length-1<A.MAX_EXTRA_PASSES){
      let stats={brightness:128};try{stats=await imageStats(dataUrl);}catch(_){}
      const skew=A.estimateSkew(first.items);
      let step=null;
      if(Math.abs(skew)>=3&&Math.abs(skew)<=25)step={name:'deskew_'+Math.round(skew),kind:'rotate',deg:-skew};
      else if(stats.brightness<92)step={name:'bright_contrast',kind:'filter',filter:'brightness(1.32) contrast(1.22) saturate(.75)'};
      else if(stats.brightness>196)step={name:'dark_contrast',kind:'filter',filter:'brightness(.84) contrast(1.28) saturate(.8)'};
      else step={name:'contrast',kind:'filter',filter:'contrast(1.28) brightness(1.04) saturate(.8)'};
      try{
        const variant=step.kind==='rotate'?await rotated(dataUrl,step.deg):await filtered(dataUrl,step.filter);
        await runFull(step.name,variant);
      }catch(e){attempts.push({method:step.name,error:String(e&&e.message?e.message:e)});}
    }

    return {...best,baseline:{result:first,parsed:firstParsed,score:firstScore},
      attempts,totalLatency:Math.round(performance.now()-started),
      extraPasses:Math.max(0,attempts.length-1)};
  };

  console.info('[V55-ADAPTIVE-OCR-2.1] safe-merge ROI benchmark recovery ready');
})();