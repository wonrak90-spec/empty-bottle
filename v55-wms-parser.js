/* V55 WMS Parser V2
 * Benchmark/feature-layer extension only.
 * Recovers WMS inbound number without modifying V26 core.
 */
(function(){
  'use strict';
  if(window.__V55_WMS_PARSER__)return;
  window.__V55_WMS_PARSER__=true;

  const P=window.V55WmsParser={VERSION:'V55-WMS-PARSER-2.1'};

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
  function validInbound(s,out){
    const d=fixDigits(s).replace(/\D/g,'');
    return d.length===8&&!isDate8(d)&&!isQtyScaledArtifact(d,out||{});
  }
  function recoverInbound(raw,items,out){
    const rr=rows(items);

    // First choice: digits on the same row as the inbound-number label.
    for(const row of rr){
      if(!/입\s*고\s*번\s*호/.test(row.text))continue;
      const after=fixDigits(row.text.replace(/^.*?입\s*고\s*번\s*호\s*[:：-]?\s*/,'')).replace(/\D/g,'');
      if(after.length===8&&!isDate8(after))return after;
      const joined=row.items.map(x=>fixDigits(x.text).replace(/\D/g,'')).filter(Boolean).join('');
      const m=joined.match(/([0-9]{8})/);
      if(m&&!isDate8(m[1]))return m[1];
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

  P.parse=function(text,items){
    let out={};
    if(window.V26WmsCardScan&&typeof V26WmsCardScan.parseWms==='function'){
      out=V26WmsCardScan.parseWms(text||'',items||[])||{};
    }else if(typeof window.parseLabelText==='function'){
      out=window.parseLabelText(text||'')||{};
    }
    if(!validInbound(out.inboundNo,out)){
      const v=recoverInbound(text,items,out);
      if(validInbound(v,out))out.inboundNo=v;
      else if(!validInbound(out.inboundNo,out))delete out.inboundNo;
    }
    return out;
  };

  P._test={rows,isDate8,isQtyScaledArtifact,validInbound,recoverInbound};
  console.info('[V55-WMS-PARSER-2.1] quantity-artifact-safe inbound recovery ready');
})();