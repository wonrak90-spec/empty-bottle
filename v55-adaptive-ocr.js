/* V55 Adaptive OCR Benchmark Layer
 * Benchmark-only until holdout evidence shows a measurable gain.
 * Does NOT override labelPhotoSelected, live OCR, save, or production flows.
 */
(function(){
  'use strict';
  if(window.__V55_ADAPTIVE_OCR__)return;
  window.__V55_ADAPTIVE_OCR__=true;

  const A=window.V55AdaptiveOCR={
    VERSION:'V55-ADAPTIVE-OCR-2.4.5',
    MAX_EXTRA_PASSES:4
  };

  const CRITICAL={
    wms:['inboundNo','itemCode','product','displayQty','containerFrom','containerTo'],
    vendor:['product','qty','palletNo']
  };

  function present(v){return v!=null&&String(v).trim()!=='';}
  function digits(v){return String(v??'').replace(/[^0-9]/g,'');}
  function fixNumericConfusions(v){
    return String(v??'')
      .replace(/[OoQD]/g,'0').replace(/[Il|]/g,'1')
      .replace(/[Ss]/g,'5').replace(/[Bb]/g,'8')
      .replace(/[Zz]/g,'2').replace(/[gq]/g,'9').replace(/[Tt]/g,'7');
  }
  function allFields(parsed){return Object.keys(parsed||{}).filter(k=>present(parsed[k]));}
  function isQtyScaledInbound(parsed,v){
    const d=digits(v),q=digits(parsed&&parsed.displayQty);
    return !!(d&&q&&d.length===8&&d===q+'000');
  }
  function wmsInboundSane(parsed){
    const d=digits(parsed&&parsed.inboundNo);
    return d.length===8&&!isDate8(d)&&!isQtyScaledInbound(parsed,d);
  }

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
        if(wmsInboundSane(parsed))sanity++;
      }else if(k==='itemCode'){
        const d=digits(v); if(d.length>=4&&d.length<=14)sanity++;
      }else if(k==='displayQty'||k==='qty'){
        const n=Number(digits(v));
        if(type==='wms'){
          if(Number.isFinite(n)&&n>=1000&&n<=5000000)sanity++;
        }else if(Number.isFinite(n)&&n>0)sanity++;
      }else if(k==='containerFrom'||k==='containerTo'||k==='palletNo'){
        const d=digits(v); if(d.length>=1&&d.length<=8)sanity++;
      }else if(k==='product'){
        if(productSane(v))sanity++;
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
    if(type==='vendor')return s.critical<3||s.sanity<3;
    if(s.critical<5)return true;
    if(!wmsInboundSane(parsed))return true;
    return false;
  };

  A.isStrictImprovement=function(base,candidate){
    if(!candidate||!base)return false;
    if(candidate.critical>base.critical)return true;
    if(candidate.critical<base.critical)return false;
    if(candidate.sanity>base.sanity)return true;
    return false;
  };

  function productSane(v){
    const s=String(v??'').replace(/\s+/g,' ').trim();
    const compact=s.replace(/\s/g,'');
    if(compact.length<2)return false;
    if(/^\d{1,4}m(?:l|1|i)$/i.test(compact))return false;
    if(/^(?:당진|검사|생산|포장|수량|일자|시간|라인|제조|품명|제품명)$/i.test(compact))return false;
    if(/^(?:품명|품령|제품명)\d{1,4}m(?:l|1|i)$/i.test(compact))return false;
    const hangul=(s.match(/[가-힣]/g)||[]).length;
    if(hangul<2&&!/[A-Za-z]{3,}/.test(s))return false;
    const digitRuns=s.match(/\d+/g)||[];
    const operators=s.match(/[=×*$]/g)||[];
    if(operators.length>=2&&digitRuns.length>=3)return false;
    if(/(?:년|월|일|시)/.test(s)&&digitRuns.length>=2)return false;
    return true;
  }
  A.productSane=productSane;

  function fieldSane(k,v,type){
    if(!present(v))return false;
    const d=digits(v);
    if(k==='inboundNo')return d.length===8;
    if(k==='itemCode')return d.length>=4&&d.length<=14;
    if(k==='displayQty'||k==='qty'){
      const n=Number(d);
      return type==='wms' ? (Number.isFinite(n)&&n>=1000&&n<=5000000) : n>0;
    }
    if(k==='containerFrom'||k==='containerTo'||k==='palletNo')return d.length>=1&&d.length<=8;
    if(k==='product')return productSane(v);
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
      else if(!fieldSane(k,out[k],type)&&fieldSane(k,cand[k],type))out[k]=cand[k];
      else if(replaceField===k&&fieldSane(k,cand[k],type))out[k]=cand[k];
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
      const lone=[...new Set((text.match(/(?<![0-9OoQDIl|])[0-9OoQDIl|]{1,4}(?![0-9OoQDIl|])/g)||[])
        .map(x=>digits(x.replace(/[OoQD]/g,'0').replace(/[Il|]/g,'1')))
        .filter(x=>x&&Number(x)>0))];
      return lone.length===1?lone[0]:'';
    }
    if(type==='wms'&&field==='containerRange'){
      const fix=(s)=>digits(String(s||'').replace(/[OoQD]/g,'0').replace(/[Il|]/g,'1'));
      let m=text.match(/(?:용\s*기|[8B]\s*기)\s*번(?:\s*호)?\s*[:\-]?\s*([0-9OoQDIl|]{3,5})\s*(?:[/~～]|\s+)\s*([0-9OoQDIl|]{3,5})/i);
      if(!m)m=text.match(/(?:^|\D)([0-9OoQDIl|]{3,5})\s*[/~～]\s*([0-9OoQDIl|]{3,5})(?:\D|$)/i);
      if(!m){
        const lines=text.split(/\r?\n+/).map(x=>x.trim()).filter(Boolean);
        for(const line of lines){
          const nums=(line.match(/[0-9OoQDIl|]{3,5}/g)||[]).map(fix).filter(Boolean);
          if(nums.length===2){
            const a=Number(nums[0]),b=Number(nums[1]);
            if(a>0&&b>0&&a<=b&&b<=500){m=[line,nums[0],nums[1]];break;}
          }
        }
      }
      if(!m)return '';
      const a=fix(m[1]),b=fix(m[2]);
      if(!a||!b||Number(a)<=0||Number(b)<=0||Number(a)>Number(b)||Number(b)>500)return '';
      return a.padStart(4,'0')+'/'+b.padStart(4,'0');
    }
    if(type==='wms'&&field==='displayQty'){
      const fix=(s)=>digits(String(s||'').replace(/[OoQD]/g,'0').replace(/[Il|]/g,'1'));
      let m=text.match(/수\s*량\s*[:\-]?\s*([0-9OoQDIl|][0-9OoQDIl|,.\s]{2,12})\s*(?:EA|개|본)?/i);
      const candidates=[];
      if(m)candidates.push(fix(m[1]));
      (text.match(/[0-9][0-9,\.]{3,}/g)||[]).forEach(x=>candidates.push(fix(x)));
      const sane=candidates.map(Number).filter(x=>Number.isFinite(x)&&x>=1000&&x<=5000000);
      if(!sane.length)return '';
      return String(Math.max(...sane));
    }
    if(type==='wms'&&field==='inboundNo'){
      const fix=(s)=>digits(String(s||'').replace(/[OoQD]/g,'0').replace(/[Il|]/g,'1'));

      // Prefer the value immediately following the inbound/management-number label,
      // but tolerate OCR inserting whitespace between digit groups: 2600 3373.
      let m=text.match(/(?:입\s*고\s*번\s*호|관\s*리\s*번\s*호)\s*[:\-]?\s*((?:[0-9OoQDIl|][\s\-]*){8,10})/);
      if(m){
        const v=fix(m[1]);
        if(v.length===8&&!isDate8(v))return v;
      }

      // Target ROI OCR may omit the label but preserve one line containing the
      // 8-digit value split into groups.  Accept only a line whose normalized
      // numeric content is exactly eight digits; do not join unrelated rows.
      const lines=text.split(/\r?\n+/).map(x=>x.trim()).filter(Boolean);
      for(const line of lines){
        const parts=line.match(/[0-9OoQDIl|]{1,4}/g)||[];
        if(!parts.length)continue;
        const v=fix(parts.join(''));
        if(v.length===8&&!isDate8(v))return v;
      }

      const cand=(text.match(/[0-9OoQDIl|]{8}/g)||[])
        .map(x=>fix(x))
        .find(x=>x.length===8&&!isDate8(x));
      return cand||'';
    }
    return '';
  }

  A.extractTargetField=extractTargetField;

  function retryTarget(type,parsed){
    if(type==='vendor')return 'palletNo';
    if(!wmsInboundSane(parsed))return 'inboundNo';
    if(!present(parsed&&parsed.containerFrom)||!present(parsed&&parsed.containerTo))return 'containerRange';
    if(!fieldSane('displayQty',parsed&&parsed.displayQty,type))return 'displayQty';
    return '';
  }

  function formulaFactors(text){
    const out=[];
    const s=fixNumericConfusions(text).replace(/,/g,'');
    // Also catch OCR where one multiplication mark disappears:
    // 40×41 13단 -> factors 40, 41, 13.
    const re=/([0-9]{1,4})\s*[xX×*]\s*([0-9]{1,4})(?:(?:\s*[xX×*]\s*([0-9]{1,4}))|(?:\s+([0-9]{1,3})\s*단))?/g;
    let m;
    while((m=re.exec(s))!==null){
      [m[1],m[2],m[3],m[4]].filter(Boolean).forEach(v=>out.push(String(Number(v))));
    }
    return out.filter(Boolean);
  }

  A.suspiciousTarget=function(type,parsed,text){
    if(type==='vendor'){
      const p=digits(parsed&&parsed.palletNo);
      if(!p)return true;
      const factors=formulaFactors(text);
      return factors.includes(String(Number(p)));
    }
    return !wmsInboundSane(parsed);
  };

  function targetValueSane(type,field,v,sourceText,context){
    const d=digits(v);
    if(type==='vendor'&&field==='palletNo'){
      if(!d||d.length>4)return false;
      const factors=formulaFactors(sourceText);
      return !factors.includes(String(Number(d)));
    }
    if(type==='wms'&&field==='inboundNo'){
      return d.length===8&&!isDate8(d)&&!isQtyScaledInbound(context||{},d);
    }
    if(type==='wms'&&field==='containerRange'){
      const m=String(v||'').match(/^(\d{3,5})\/(\d{3,5})$/);
      return !!(m&&Number(m[1])>0&&Number(m[2])>0&&Number(m[1])<=Number(m[2])&&Number(m[2])<=500);
    }
    if(type==='wms'&&field==='displayQty'){
      const n=Number(d);
      return Number.isFinite(n)&&n>=1000&&n<=5000000;
    }
    return !!d;
  }

  A.pickTargetConsensus=function(candidates,requiredVotes){
    const good=(candidates||[]).filter(x=>x&&present(x.v));
    if(!good.length)return null;
    const freq={};
    for(const x of good)freq[x.v]=(freq[x.v]||0)+1;
    good.sort((a,b)=>(freq[b.v]-freq[a.v])||((Number(b.conf)||0)-(Number(a.conf)||0)));
    const pick=good[0],need=Math.max(1,Number(requiredVotes)||1);
    return (freq[pick.v]||0)>=need?pick:null;
  };

  A.sanitizeFullRetryCandidate=function(type,base,candidate){
    const out={...(candidate||{})};
    const target=type==='vendor'?'palletNo':'inboundNo';
    const before=String((base&&base[target])??'').trim();
    const after=String((out&&out[target])??'').trim();
    // Whole-image retries may recover text/quantity, but a new or changed
    // Critical numeric identifier must come through the dedicated dual-ROI
    // consensus gate. This blocks PL48-style formula digits entering via ROI.
    if(after&&after!==before)delete out[target];
    return out;
  };

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

    const suspicious=A.suspiciousTarget(type,firstParsed,first.text||'');
    if(!A.needsRetry(type,firstParsed)&&!suspicious){
      return {...best,baseline:{result:first,parsed:firstParsed,score:firstScore},
        attempts,totalLatency:Math.round(performance.now()-started),extraPasses:0};
    }

    const runFull=async(name,variant)=>{
      const r=await V26KoreanOCR.recognize(variant,false,'');
      const rawParsed=A.sanitizeFullRetryCandidate(type,best.parsed,parse(type,r));
      // Whole-image/ROI candidates may ADD missing Critical values, but they
      // must not overwrite an already populated Critical value. This prevents
      // a visually noisy retry from destroying a correct baseline field.
      const p=A.mergeCandidate(type,best.parsed,rawParsed,'');
      const score=A.scoreParsed(type,p,r.items);
      attempts.push({method:name,score:score.value,critical:score.critical,latency:r.latency||0});
      if(A.isStrictImprovement(best.score,score))best={result:r,parsed:p,score,method:name};
    };

    const initialNeedsRetry=A.needsRetry(type,firstParsed)||suspicious;

    // 1) Whole-label text cluster crop + upscale for distant/low-resolution shots.
    if(attempts.length-1<A.MAX_EXTRA_PASSES&&window.V55RoiPreprocess&&first.items&&first.items.length){
      try{
        const roi=await V55RoiPreprocess.clusterCrop(dataUrl,first.items);
        if(roi)await runFull('roi_zoom',roi.dataUrl);
      }catch(e){attempts.push({method:'roi_zoom',error:String(e&&e.message?e.message:e)});}
    }

    // 2) Target field ROI: run two local variants (contrast + binary).
    // Only values that are sane in the context of the original label can replace
    // the target field. Packaging formula factors such as 900 or 40 are rejected.
    if(initialNeedsRetry&&attempts.length-1<A.MAX_EXTRA_PASSES&&window.V55RoiPreprocess){
      const target=retryTarget(type,best.parsed);
      if(target){
        try{
          const variants=typeof V55RoiPreprocess.fieldStripVariants==='function'
            ? await V55RoiPreprocess.fieldStripVariants(dataUrl,first.items,type,target)
            : [await V55RoiPreprocess.fieldStrip(dataUrl,first.items,type,target)].filter(Boolean);
          const candidates=[];
          for(const fr of variants){
            if(!fr||attempts.length-1>=A.MAX_EXTRA_PASSES)break;
            try{
              const rr=await V26KoreanOCR.recognize(fr.dataUrl,false,'');
              const v=extractTargetField(type,target,rr);
              const scores=(rr.items||[]).map(x=>Number(x&&x.score)).filter(Number.isFinite);
              const conf=scores.length?scores.reduce((a,b)=>a+b,0)/scores.length:0;
              const sane=v&&targetValueSane(type,target,v,first.text||'',best.parsed);
              attempts.push({method:fr.kind||('field_roi_'+target),latency:rr.latency||0,recovered:v||'',sane:!!sane,confidence:conf});
              if(sane)candidates.push({v,rr,conf,method:fr.kind||('field_roi_'+target)});
            }catch(e){
              attempts.push({method:fr.kind||('field_roi_'+target),error:String(e&&e.message?e.message:e)});
            }
          }

          if(candidates.length){
            // A single local OCR hit can still be a digit substitution (36 -> 26).
            // With the dual target ROI, require two independent variants to agree
            // before replacing a Critical numeric field. This keeps Safe-Merge
            // conservative while still allowing strong recoveries such as 70/70.
            const requiredVotes=variants.length>=2?2:1;
            const pick=A.pickTargetConsensus(candidates,requiredVotes);
            if(pick){
              let merged,changed=false;
              if(type==='wms'&&target==='containerRange'){
                const m=String(pick.v||'').match(/^(\d{3,5})\/(\d{3,5})$/);
                if(m){
                  const candidate={containerFrom:m[1],containerTo:m[2]};
                  merged=A.mergeCandidate(type,best.parsed,candidate,'');
                  changed=String(best.parsed&&best.parsed.containerFrom||'')!==String(merged.containerFrom||'')
                    ||String(best.parsed&&best.parsed.containerTo||'')!==String(merged.containerTo||'');
                }else merged={...(best.parsed||{})};
              }else{
                merged=A.mergeCandidate(type,best.parsed,{[target]:pick.v},target);
                changed=String((best.parsed&&best.parsed[target])??'')!==String(merged[target]??'');
              }
              const score=A.scoreParsed(type,merged,pick.rr.items);
              if(changed||A.isStrictImprovement(best.score,score)){
                best={result:pick.rr,parsed:merged,score,method:pick.method};
              }
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
    if((A.needsRetry(type,best.parsed)||A.suspiciousTarget(type,best.parsed,first.text||''))&&attempts.length-1<A.MAX_EXTRA_PASSES){
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

  console.info('[V55-ADAPTIVE-OCR-2.4.5] sparse WMS range + implausible quantity recovery ready');
})();