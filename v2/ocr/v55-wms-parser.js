/* V55 WMS Parser V2
 * Benchmark/feature-layer extension only.
 * Recovers WMS inbound number without modifying V26 core.
 */
(function(){
  'use strict';
  if(window.__V55_WMS_PARSER__)return;
  window.__V55_WMS_PARSER__=true;

  const P=window.V55WmsParser={VERSION:'V57.3-WMS-PARSER-2.6'};

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

  function normalizeQtyToken(v){
    let s=fixDigits(String(v||'')).replace(/\u00a0/g,' ').trim();
    if(!s)return '';
    // 21,320.000 / 21.320.000 / 21 320.000 -> 21320
    s=s.replace(/\s+/g,' ');
    const m=s.match(/([0-9][0-9,. ]*)/);
    if(!m)return '';
    let t=m[1].trim().replace(/\s+/g,'');
    if(/[.,]000$/.test(t))t=t.slice(0,-4);
    const d=t.replace(/\D/g,'');
    if(!d)return '';
    const n=Number(d);
    return Number.isFinite(n)&&n>0&&n<=9999999?String(Math.trunc(n)):'';
  }

  function strictQty(raw,items,out){
    const rr=rows(items);
    const rawLines=String(raw||'').replace(/\r/g,'').split(/\n+/).map(x=>x.trim()).filter(Boolean);
    const all=[...rawLines,...rr.map(r=>r.text||'')];

    // Highest confidence: quantity label and unit appear in the same OCR row.
    for(const row of all){
      if(!/수\s*량/.test(row))continue;
      const tail=row.replace(/^.*?수\s*량\s*[:：-]?\s*/,'');
      const m=tail.match(/([0-9OoDQIl|SsBbZzgqTt][0-9OoDQIl|SsBbZzgqTt,. ]{0,20}?)\s*(EA|개|본)\b/i);
      if(m){
        const q=normalizeQtyToken(m[1]);
        if(q)return q;
      }
      // WMS labels often print quantities with .000 and OCR drops the unit.
      const dec=tail.match(/([0-9OoDQIl|SsBbZzgqTt]{1,3}(?:[,\. ][0-9OoDQIl|SsBbZzgqTt]{3})+[\.,]000|[0-9OoDQIl|SsBbZzgqTt]{4,}[\.,]000)\b/);
      if(dec){
        const q=normalizeQtyToken(dec[1]);
        if(q)return q;
      }
    }

    // Second choice: the row immediately after a standalone quantity label,
    // but only when a quantity unit is present.
    for(let i=0;i<all.length;i++){
      if(!/^(?:.*\s)?수\s*량\s*[:：-]?\s*$/i.test(all[i]))continue;
      for(const j of [i+1]){
        if(j>=all.length)continue;
        const m=all[j].match(/([0-9OoDQIl|SsBbZzgqTt][0-9OoDQIl|SsBbZzgqTt,. ]{0,20}?)\s*(EA|개|본)\b/i);
        if(m){
          const q=normalizeQtyToken(m[1]);
          if(q)return q;
        }
      }
    }

    // Never reuse identifiers as WMS quantity.
    const q=normalizeQtyToken(out&&out.displayQty);
    if(!q)return '';
    const blocked=new Set([
      String(out&&out.inboundNo||'').replace(/\D/g,''),
      String(out&&out.itemCode||'').replace(/\D/g,''),
      String(out&&out.containerFrom||'').replace(/\D/g,''),
      String(out&&out.containerTo||'').replace(/\D/g,''),
      String(out&&out.inboundDate||'').replace(/\D/g,''),
      String(out&&out.expiryDate||'').replace(/\D/g,'')
    ].filter(Boolean));
    return blocked.has(q)?'':q;
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

    // V57.3: quantity is allowed only when it is tied to the quantity field
    // with a reliable unit/format. Ambiguous OCR is cleared instead of guessed.
    const sq=strictQty(text,items,out);
    if(sq){out.displayQty=sq;if(!out.unit)out.unit='EA';}
    else if(/수\s*량/.test(String(text||'')))delete out.displayQty;

    return out;
  };

  P._test={rows,isDate8,isQtyScaledArtifact,validInbound,recoverInbound,inboundYearPrefix,normalizeDamagedInbound,recoverContainerRange,strictQty,normalizeQtyToken};
  console.info('[V57.3-WMS-PARSER-2.6] 관리번호 alias + damaged inbound repair + tolerant container-range recovery ready');
})();