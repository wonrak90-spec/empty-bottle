/* V55 Vendor Parser V2
 * Benchmark/feature-layer parser only.
 * - Does not modify V26 core files.
 * - Adds Donghwa G&P label recovery.
 * - Cleans Donga Ecopack product / P-L parsing.
 */
(function(){
  'use strict';
  if(window.__V55_VENDOR_PARSER__)return;
  window.__V55_VENDOR_PARSER__=true;

  const P=window.V55VendorParser={VERSION:'V55-VENDOR-PARSER-2'};

  function fixDigits(s){
    return String(s||'')
      .replace(/[OoDQ]/g,'0').replace(/[lIi|]/g,'1').replace(/[Ss]/g,'5')
      .replace(/[Bb]/g,'8').replace(/[Zz]/g,'2').replace(/[gq]/g,'9').replace(/[Tt]/g,'7');
  }
  function flat(s){return String(s||'').replace(/[：﹕]/g,':').replace(/[｜|]/g,' ').replace(/[\t ]+/g,' ').trim();}
  function num(s){
    const d=fixDigits(s).replace(/[^0-9]/g,'');
    const n=Number(d);
    return Number.isFinite(n)&&n>0?String(Math.trunc(n)):'';
  }
  function polyStats(poly){
    const pts=Array.isArray(poly)?poly:[],xs=[],ys=[];
    for(const p of pts){
      if(Array.isArray(p)){xs.push(Number(p[0])||0);ys.push(Number(p[1])||0);}
      else if(p&&typeof p==='object'){xs.push(Number(p.x)||0);ys.push(Number(p.y)||0);}
    }
    if(!xs.length)return {x:0,y:0,h:20};
    return {x:Math.min(...xs),y:(Math.min(...ys)+Math.max(...ys))/2,h:Math.max(1,Math.max(...ys)-Math.min(...ys))};
  }
  function itemRows(items){
    const arr=(items||[]).filter(x=>x&&String(x.text||'').trim()).map(x=>({text:flat(x.text),...polyStats(x.poly)}))
      .sort((a,b)=>a.y-b.y||a.x-b.x);
    const rows=[];
    for(const it of arr){
      let r=rows.find(z=>Math.abs(z.y-it.y)<=Math.max(12,Math.max(z.h,it.h)*.72));
      if(!r){r={y:it.y,h:it.h,items:[]};rows.push(r);}
      r.items.push(it);r.h=Math.max(r.h,it.h);
    }
    return rows.sort((a,b)=>a.y-b.y).map(r=>r.items.sort((a,b)=>a.x-b.x).map(x=>x.text).join(' '));
  }
  function rowsOf(raw,items){
    const a=String(raw||'').replace(/\r/g,'').split(/\n+/).map(flat).filter(Boolean);
    const b=itemRows(items),out=[];
    for(const x of [...a,...b])if(x&&out.indexOf(x)<0)out.push(x);
    return out;
  }
  function cleanProduct(s){
    let x=flat(s)
      .replace(/^(?:제\s*품\s*명|품\s*명)\s*[:\-]?\s*/i,'')
      .replace(/\s*(?:생\s*산\s*라\s*인|생\s*산\s*일\s*자|제\s*조\s*일\s*자|P\s*[/\-]?\s*(?:L\s*)?(?:No\.?|번\s*호)|포\s*장\s*사\s*양|수\s*량).*$/i,'')
      .replace(/\s+당진\s*\d+\s*F\b.*$/i,'')
      .replace(/\s+(?:\d+\s*F)\b.*$/i,'')
      .replace(/㎖/g,'ml')
      .replace(/m[ℓℒ]/gi,'ml')
      .trim();

    // Common recognition slips around the volume suffix only.
    x=x.replace(/(\d{1,4})\s*m(?:1|i|I|l)?\b/gi,(m,n)=>n+'ml');
    return x.trim();
  }
  function bestProduct(rows){
    for(const r of rows){
      if(/(?:제\s*품\s*명|품\s*명)/.test(r)){
        const x=cleanProduct(r);
        if(x&&/[가-힣]/.test(x))return x;
      }
    }
    // Fallback for labels where the key itself was missed but value survived.
    const cands=rows.map(cleanProduct).filter(x=>
      /[가-힣]{2,}/.test(x)&&/\d{1,4}\s*ml/i.test(x)&&
      !/(?:생산|제조|포장|수량|본|단|충격|파손|주의|검사|납품|회사)/.test(x)
    ).sort((a,b)=>a.length-b.length);
    return cands[0]||'';
  }
  function detectDonghwa(raw,rows){
    const s=(flat(raw)+' '+rows.join(' ')).toLowerCase();
    let score=0;
    if(/동화\s*지앤피/.test(s))score+=4;
    if(/p\s*[-/]?\s*번\s*호/.test(s))score+=3;
    if(/\d+\s*[x×*]\s*\d+\s*[x×*]\s*\d+\s*단/.test(s))score+=3;
    if(/유리\s*제품.*충격.*파손/.test(s))score+=2;
    if(/판콜/.test(s)&&/30\s*m[l1i]?/.test(s))score+=1;
    return score>=3;
  }
  function detectDonga(raw,rows){
    const s=(flat(raw)+' '+rows.join(' ')).toLowerCase();
    return /동아\s*에코\s*팩/.test(s)||/p\s*[/\-]\s*l\s*no/.test(s)||/당진\s*\d+\s*f/.test(s);
  }
  function parseDonghwa(raw,items,base){
    const rows=rowsOf(raw,items),joined=rows.join('\n'),out={...(base||{})};

    const p=bestProduct(rows);
    if(p)out.product=p;
    else if(out.product)out.product=cleanProduct(out.product);

    // P-번호 is the pallet identifier on Donghwa labels.
    const pm=(joined+'\n'+String(raw||'')).match(/P\s*[-/]?\s*(?:번\s*호|No\.?)\s*[:\-]?\s*([0-9OQDIl|]{1,4})/i);
    if(pm){
      const v=num(pm[1]);
      if(v)out.palletNo=v;
    }

    // Prefer the printed final count after '=' or a verified multiplicative formula.
    let qty='';
    const eq=fixDigits(joined).match(/[=:]\s*([0-9]{1,3}(?:[,\.]\d{3})+|[0-9]{4,6})\s*(?:본|EA|개)\b/i);
    if(eq)qty=num(eq[1]);
    if(!qty&&window.V26Qty&&typeof V26Qty.vendorFormula==='function'){
      const f=V26Qty.vendorFormula(joined);
      if(f&&f.ok&&f.calculated>0)qty=String(f.calculated);
    }
    if(qty)out.qty=qty;

    // If the generic parser swallowed the following rows into product, clean it.
    if(out.product)out.product=cleanProduct(out.product);

    P.lastTemplate='동화지앤피';
    return out;
  }
  function parseDonga(raw,items,base){
    const rows=rowsOf(raw,items),joined=rows.join('\n'),out={...(base||{})};

    const p=bestProduct(rows);
    if(p)out.product=p;
    else if(out.product)out.product=cleanProduct(out.product);

    const pl=(joined+'\n'+String(raw||'')).match(/P\s*[/\-]\s*L\s*N\s*o\.?\s*[:\-]?\s*([0-9OQDIl|]{1,4})/i);
    if(pl){
      const v=num(pl[1]);
      if(v)out.palletNo=v;
    }

    // Avoid packaging factors (e.g. 900×12) being mistaken for pallet number.
    if(out.palletNo&&Number(out.palletNo)>=500&&/P\s*[/\-]\s*L\s*N\s*o/i.test(joined)===false){
      delete out.palletNo;
    }

    if(window.V26Qty&&typeof V26Qty.vendorFormula==='function'){
      const f=V26Qty.vendorFormula(joined);
      if(f&&f.ok&&f.calculated>0)out.qty=String(f.calculated);
    }

    P.lastTemplate='동아에코팩';
    return out;
  }

  P.detect=function(raw,items){
    const rows=rowsOf(raw,items);
    if(detectDonghwa(raw,rows))return '동화지앤피';
    if(detectDonga(raw,rows))return '동아에코팩';
    return '';
  };

  P.parse=function(raw,items){
    const base=(window.V26VendorTemplates&&typeof V26VendorTemplates.parse==='function')
      ? V26VendorTemplates.parse(raw||'',items||[])
      : (typeof window.parseVendorLabel==='function'?window.parseVendorLabel(raw||''):{} )||{};
    const rows=rowsOf(raw,items);
    if(detectDonghwa(raw,rows))return parseDonghwa(raw,items,base);
    if(detectDonga(raw,rows))return parseDonga(raw,items,base);
    P.lastTemplate=(window.V26VendorTemplates&&V26VendorTemplates.lastTemplate)||'';
    return base;
  };

  P._test={cleanProduct,rowsOf,detectDonghwa,detectDonga};
  console.info('[V55-VENDOR-PARSER-2] Donga + Donghwa parser extension ready');
})();