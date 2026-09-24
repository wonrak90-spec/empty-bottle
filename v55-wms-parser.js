/* V55 WMS Parser V2
 * Benchmark/feature-layer extension only.
 * Recovers WMS inbound number without modifying V26 core.
 */
(function(){
  'use strict';
  if(window.__V55_WMS_PARSER__)return;
  window.__V55_WMS_PARSER__=true;

  const P=window.V55WmsParser={VERSION:'V55-WMS-PARSER-2.6'};

  function fixDigits(s){
    return String(s||'')
      .replace(/[OoDQ]/g,'0').replace(/[lIi|]/g,'1').replace(/[Ss]/g,'5')
      .replace(/[Bb]/g,'8').replace(/[Zz]/g,'2').replace(/[gq]/g,'9').replace(/[Tt]/g,'7');
  }
  function rect(poly){
    const pts=Array.isArray(poly)?poly:[],xs=[],ys=[];
    for(const p of pts){
      if(Array.isArray(p)){xs.push(Number(p[0])||0);ys.push(Number(p[1])||0);}
      else if(p&&typeof p==='object'){xs.push(Number(p.x)||0);ys.push(Number(p.y)||0);}
    }
    if(!xs.length)return {x:0,y:0,h:20};
    return {x:Math.min(...xs),y:(Math.min(...ys)+Math.max(...ys))/2,h:Math.max(1,Math.max(...ys)-Math.min(...ys))};
  }
  function rows(items){
    const a=(items||[]).filter(x=>x&&String(x.text||'').trim()).map(x=>({
      text:String(x.text||'').trim(),...rect(x.poly)
    })).sort((m,n)=>m.y-n.y||m.x-n.x);
    const out=[];
    for(const it of a){
      let r=out.find(z=>Math.abs(z.y-it.y)<=Math.max(12,Math.max(z.h,it.h)*.72));
      if(!r){r={y:it.y,h:it.h,items:[]};out.push(r);}
      r.items.push(it);r.h=Math.max(r.h,it.h);
      r.y=r.items.reduce((s,x)=>s+x.y,0)/r.items.length;
    }
    return out.sort((m,n)=>m.y-n.y).map(r=>{
      r.items.sort((m,n)=>m.x-n.x);
      r.text=r.items.map(x=>x.text).join(' ');
      return r;
    });
  }
  function isDate8(s){
    const d=String(s||'').replace(/\D/g,'');
    if(d.length!==8)return false;
    const y=Number(d.slice(0,4)),m=Number(d.slice(4,6)),day=Number(d.slice(6,8));
    return y>=2020&&y<=2099&&m>=1&&m<=12&&day>=1&&day<=31;
  }
  function isQtyScaledArtifact(s,out){
    const d=fixDigits(s).replace(/\D/g,'');
    const q=fixDigits(out&&out.displayQty).replace(/\D/g,'');
    return !!(d&&q&&d.length===8&&d===q+'000');
  }
  function inboundYearPrefix(out,raw){
    const d=String(out&&out.inboundDate||'').replace(/\D/g,'');
    if(/^20\d{6}$/.test(d))return d.slice(2,4);
    const m=fixDigits(String(raw||'')).match(/입\s*고\s*일(?:\s*자)?\s*[:：-]?\s*(20\d{6})/);
    return m?m[1].slice(2,4):'';
  }
  function normalizeDamagedInbound(s,out,raw){
    const d=fixDigits(s).replace(/\D/g,'');
    if(d.length===8)return d;
    const yy=inboundYearPrefix(out||{},raw||'');
    if(!yy)return '';
    if(d.length===6)return yy+d;
    if(d.length===7)return yy+d.slice(-6);
    return '';
  }
  function recoverContainerRange(raw,items,out){
    const src=[String(raw||''),...rows(items).map(r=>r.text||'')].join('\n');
    const fixed=fixDigits(src);
    const labelled=fixed.match(/(?:용\s*기|[8B]\s*기)\s*번(?:\s*호)?\s*[:：-]?\s*([0-9]{3,5})\s*(?:[/~～]|\s{1,4})\s*([0-9]{3,5})(?=\D|$)/i);
    const generic=fixed.match(/(?:^|\D)([0-9]{3,5})\s*[/~～]\s*([0-9]{3,5})(?:\D|$)/);
    const m=labelled||generic;
    if(!m)return out||{};
    const next={...(out||{})};
    if(!next.containerFrom)next.containerFrom=m[1];
    if(!next.containerTo)next.containerTo=m[2];
    return next;
  }
  function validInbound(s,out){
    const d=fixDigits(s).replace(/\D/g,'');
    return d.length===8&&!isDate8(d)&&!isQtyScaledArtifact(d,out||{});
  }
  function recoverInbound(raw,items,out){
    const rr=rows(items);

    // Raw-text fallback for OCR that inserts spaces inside the 8-digit
    // inbound number (for example "2600 3373").  Keep it tied to the
    // inbound-number label so unrelated quantity/date rows cannot be joined.
    const rawMatch=fixDigits(String(raw||'')).match(/(?:입\s*고\s*번(?:\s*호)?|관\s*리\s*번\s*호)\s*[:：-]?\s*((?:[0-9][\s\-]*){6,10})/);
    if(rawMatch){
      const d=String(rawMatch[1]||'').replace(/\D/g,'');
      if(validInbound(d,out||{}))return d;
      const repaired=normalizeDamagedInbound(d,out||{},raw||'');
      if(validInbound(repaired,out||{}))return repaired;
    }

    // First choice: digits on the same row as the inbound-number label.
    let inboundRow=-1;
    for(let i=0;i<rr.length;i++){
      const row=rr[i];
      if(!/(?:입\s*고\s*번(?:\s*호)?|관\s*리\s*번\s*호)/.test(row.text))continue;
      inboundRow=i;
      const after=fixDigits(row.text.replace(/^.*?(?:입\s*고\s*번(?:\s*호)?|관\s*리\s*번\s*호)\s*[:：-]?\s*/,'')).replace(/\D/g,'');
      if(validInbound(after,out||{}))return after;
      const repaired=normalizeDamagedInbound(after,out||{},raw||'');
      if(validInbound(repaired,out||{}))return repaired;
      const joined=row.items.map(x=>fixDigits(x.text).replace(/\D/g,'')).filter(Boolean).join('');
      const m=joined.match(/([0-9]{8})/);
      if(m&&validInbound(m[1],out||{}))return m[1];
      const repairedJoined=normalizeDamagedInbound(joined,out||{},raw||'');
      if(validInbound(repairedJoined,out||{}))return repairedJoined;
    }

    // OCR geometry may split the label and its value into adjacent rows.
    // Only inspect the immediate neighbour before falling back to generic
    // candidates; this is safer than selecting an arbitrary 8-digit token.
    if(inboundRow>=0){
      for(const j of [inboundRow+1,inboundRow-1]){
        if(j<0||j>=rr.length)continue;
        const row=rr[j];
        const joined=row.items.map(x=>fixDigits(x.text).replace(/\D/g,'')).filter(Boolean).join('');
        const direct=fixDigits(row.text).replace(/\D/g,'');
        for(const d of [joined,direct]){
          if(validInbound(d,out||{}))return d;
          const m=d.match(/([0-9]{8})/);
          if(m&&validInbound(m[1],out||{}))return m[1];
        }
      }
    }

    const skip=new Set([
      String(out&&out.itemCode||'').replace(/\D/g,''),
      String(out&&out.displayQty||'').replace(/\D/g,''),
      (String(out&&out.displayQty||'').replace(/\D/g,'')+'000'),
      String(out&&out.containerFrom||'').replace(/\D/g,''),
      String(out&&out.containerTo||'').replace(/\D/g,''),
      String(out&&out.inboundDate||'').replace(/\D/g,''),
      String(out&&out.expiryDate||'').replace(/\D/g,'')
    ].filter(Boolean));

    const candidates=[];
    const add=(s,weight)=>{
      const d=fixDigits(s).replace(/\D/g,'');
      if(d.length!==8||isDate8(d)||skip.has(d)||isQtyScaledArtifact(d,out||{}))return;
      if(!candidates.some(x=>x.d===d))candidates.push({d,weight});
    };
    String(raw||'').split(/\s+/).forEach(x=>add(x,1));
    for(const row of rr){
      row.items.forEach(x=>add(x.text,2));
      const m=fixDigits(row.text).match(/\b([0-9]{7,10})\b/g)||[];
      m.forEach(x=>add(x,3));
    }
    candidates.sort((a,b)=>b.weight-a.weight||a.d.length-b.d.length);
    return candidates.length?candidates[0].d:'';
  }

  function sanitizeWmsFields(out){
    const next={...(out||{})};

    // Empty-bottle WMS pallet quantities are expected in the thousands.
    // Tiny OCR fragments such as "2" or "21" are safer treated as missing
    // so Adaptive OCR can retry instead of locking in a wrong quantity.
    if(next.displayQty){
      const q=Number(fixDigits(next.displayQty).replace(/\D/g,''));
      if(!Number.isFinite(q)||q<1000||q>5000000)delete next.displayQty;
    }

    const stopNoise=v=>String(v||'')
      .replace(/\s*(?:입\s*고\s*일(?:\s*자)?|사\s*용\s*기\s*한|유\s*효\s*기\s*한|용\s*기\s*번(?:\s*호)?|품\s*목\s*코\s*드|수\s*량)\b.*$/i,'')
      .trim();

    if(next.supplier){
      next.supplier=stopNoise(next.supplier);
      if(!next.supplier||/^\d+$/.test(next.supplier))delete next.supplier;
    }
    if(next.manufacturer){
      next.manufacturer=stopNoise(next.manufacturer);
      if(!next.manufacturer||/^\d+$/.test(next.manufacturer))delete next.manufacturer;
    }
    return next;
  }

  P.parse=function(text,items){
    let out={};
    if(window.V26WmsCardScan&&typeof V26WmsCardScan.parseWms==='function'){
      out=V26WmsCardScan.parseWms(text||'',items||[])||{};
    }else if(typeof window.parseLabelText==='function'){
      out=window.parseLabelText(text||'')||{};
    }
    if(!validInbound(out.inboundNo,out)){
      const damaged=normalizeDamagedInbound(out.inboundNo,out,text||'');
      if(validInbound(damaged,out))out.inboundNo=damaged;
      else{
        const v=recoverInbound(text,items,out);
        if(validInbound(v,out))out.inboundNo=v;
        else if(!validInbound(out.inboundNo,out))delete out.inboundNo;
      }
    }
    if(!out.containerFrom||!out.containerTo)out=recoverContainerRange(text,items,out);
    out=sanitizeWmsFields(out);
    return out;
  };

  P._test={rows,isDate8,isQtyScaledArtifact,validInbound,recoverInbound,inboundYearPrefix,normalizeDamagedInbound,recoverContainerRange,sanitizeWmsFields};
  console.info('[V55-WMS-PARSER-2.6] low-quality WMS field sanitizing + range recovery ready');
})();