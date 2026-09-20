/* V55 Vendor Parser V3
 * Benchmark/feature-layer parser only.
 * - Does not modify V26 core files.
 * - Adds Donghwa G&P label recovery.
 * - Cleans Donga Ecopack product / P-L parsing.
 */
(function(){
  'use strict';
  if(window.__V55_VENDOR_PARSER__)return;
  window.__V55_VENDOR_PARSER__=true;

  const P=window.V55VendorParser={VERSION:'V55-VENDOR-PARSER-3'};

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
  function itemRowObjects(items){
    const arr=(items||[]).filter(x=>x&&String(x.text||'').trim()).map(x=>({text:flat(x.text),...polyStats(x.poly)}))
      .sort((a,b)=>a.y-b.y||a.x-b.x);
    const rows=[];
    for(const it of arr){
      let r=rows.find(z=>Math.abs(z.y-it.y)<=Math.max(12,Math.max(z.h,it.h)*.72));
      if(!r){r={y:it.y,h:it.h,items:[]};rows.push(r);}
      r.items.push(it);r.h=Math.max(r.h,it.h);
      r.y=r.items.reduce((s,x)=>s+x.y,0)/r.items.length;
    }
    return rows.sort((a,b)=>a.y-b.y).map(r=>{
      r.items.sort((a,b)=>a.x-b.x);
      r.text=r.items.map(x=>x.text).join(' ');
      return r;
    });
  }
  function itemRows(items){return itemRowObjects(items).map(r=>r.text);}
  function rowsOf(raw,items){
    const a=String(raw||'').replace(/\r/g,'').split(/\n+/).map(flat).filter(Boolean);
    const b=itemRows(items),out=[];
    for(const x of [...a,...b])if(x&&out.indexOf(x)<0)out.push(x);
    return out;
  }
  function labelValueByRow(items,labelRe,valueRe){
    const rows=itemRowObjects(items);
    for(const row of rows){
      const text=row.text||'';
      if(!labelRe.test(text))continue;

      // Never let characters inside the label itself (e.g. the "L" in
      // "P/L No.") become the numeric value. Read only the tail after label.
      const tail=text.replace(labelRe,' ').trim();
      const tm=tail.match(valueRe);
      if(tm&&tm[1])return tm[1];

      let labelX=-Infinity;
      for(const it of row.items)if(labelRe.test(it.text||''))labelX=Math.max(labelX,it.x);
      const right=row.items.filter(it=>it.x>labelX).sort((a,b)=>a.x-b.x);
      for(const it of right){
        const mm=(it.text||'').match(valueRe);
        if(mm&&mm[1])return mm[1];
      }
    }
    return '';
  }
  function cleanProduct(s){
    let x=flat(s)
      .replace(/^(?:제\s*품\s*[명영]|품\s*[명영])\s*[:\-]?\s*/i,'')
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
    for(let i=0;i<rows.length;i++){
      const r=rows[i];
      if(/(?:제\s*품\s*[명영]|품\s*[명영])/.test(r)){
        let x=cleanProduct(r);
        if(x&&/[가-힣]/.test(x)){
          if(!/\d{1,4}\s*ml/i.test(x)&&i+1<rows.length){
            const vm=cleanProduct(rows[i+1]).match(/(\d{1,4}\s*m(?:l|1|i)?)/i);
            if(vm)x=(x+' '+vm[1]).trim();
          }
          return cleanProduct(x);
        }
      }
    }
    // Fallback for labels where the key itself was missed but value survived.
    const cands=rows.map(cleanProduct).filter(x=>
      /[가-힣]{2,}/.test(x)&&/\d{1,4}\s*ml/i.test(x)&&
      !/(?:생산|제조|포장|수량|본|단|충격|파손|주의|검사|납품|회사)/.test(x)
    ).sort((a,b)=>a.length-b.length);
    return cands[0]||'';
  }
  function detectDonghwa(raw,rows,base){
    const s=(flat(raw)+' '+rows.join(' ')+' '+flat(base&&base.product)).toLowerCase();
    let score=0;
    if(/동화\s*지앤피/.test(s))score+=4;
    if(/p\s*[-/]?\s*(?:번\s*호|no)/i.test(s))score+=3;
    if(/\d+\s*[x×*]\s*\d+(?:\s*[x×*]|\D{0,6})\s*\d+\s*단/.test(s))score+=3;
    if(/유리\s*제품.*충격.*파손/.test(s))score+=2;
    if(/판콜/.test(s))score+=2;
    if(/유리병\s*[（(]?각병/.test(s))score+=2;
    return score>=3;
  }
  function detectDonga(raw,rows){
    const s=(flat(raw)+' '+rows.join(' ')).toLowerCase();
    return /동아\s*에코\s*팩/.test(s)||/p\s*[/\-]\s*l\s*no/.test(s)||/당진\s*\d+\s*f/.test(s);
  }
  function parseDonghwa(raw,items,base){
    const rows=rowsOf(raw,items),joined=rows.join('\n'),out={...(base||{})};

    let p=bestProduct(rows);
    if(!p&&out.product)p=cleanProduct(out.product);

    // If the generic parser captured only "30ml"/"100ml", recover the Korean
    // product-name row first, then join the neighbouring volume token.
    if(!p||!/[가-힣]{2,}/.test(p)){
      const nameRow=rows.find(r=>/판콜\s*에?이?\s*병|유리병\s*[（(]?각병/i.test(r));
      if(nameRow)p=cleanProduct(nameRow);
    }
    if(p){
      // Common Donghwa layout: product and volume are separate OCR boxes/rows.
      if(/판콜.*병$/i.test(p)&&!/30\s*ml/i.test(p)){
        const vm=(joined+' '+String(raw||'')).match(/\b30\s*m(?:l|1|i)\b/i);
        if(vm)p=(p+' 30ml').trim();
      }
      if(/유리병\s*[（(]?각병[)）]?$/i.test(p)&&!/100\s*ml/i.test(p)){
        const vm=(joined+' '+String(raw||'')).match(/\b100\s*m(?:l|1|i)\b/i);
        if(vm)p=(p+' 100ml').trim();
      }
      out.product=cleanProduct(p);
    }

    // P-번호 is the pallet identifier on Donghwa labels.
    let pv=labelValueByRow(items,/P\s*[-/]?\s*(?:번\s*호|No\.?)?/i,/([0-9OQDIl|]{1,4})/i);
    if(!pv){
      const pm=(joined+'\n'+String(raw||'')).match(/P\s*[-/]?\s*(?:번\s*호|No\.?)\s*[:\-]?\s*([0-9OQDIl|]{1,4})/i);
      if(pm)pv=pm[1];
    }
    if(pv){
      const v=num(pv);
      if(v&&Number(v)<500)out.palletNo=v;
    }

    // Prefer the printed final count after '=' or a verified multiplicative formula.
    let qty='';
    const src=fixDigits(joined+'\n'+String(raw||''));
    const eq=src.match(/[=:]\s*([0-9]{1,3}(?:[,\.]\d{3})+|[0-9]{4,6})\s*(?:본|EA|개)?\b/i);
    if(eq)qty=num(eq[1]);
    if(!qty&&window.V26Qty&&typeof V26Qty.vendorFormula==='function'){
      const f=V26Qty.vendorFormula(src);
      if(f&&f.ok&&f.calculated>0)qty=String(f.calculated);
    }
    if(!qty){
      // Tolerate one missing multiplication sign: 40×41 13단 = 21,320
      const fm=src.match(/([0-9]{1,4})\s*[xX×*]\s*([0-9]{1,4})\D{0,6}([0-9]{1,3})\s*단/);
      if(fm){
        const factors=[fm[1],fm[2],fm[3]].map(Number);
        const calc=factors.reduce((a,b)=>a*b,1);
        if(calc>=1000&&calc<=999999)qty=String(calc);
      }
    }
    if(qty)out.qty=qty;

    if(out.product)out.product=cleanProduct(out.product);
    P.lastTemplate='동화지앤피';
    return out;
  }
  function parseDonga(raw,items,base){
    const rows=rowsOf(raw,items),joined=rows.join('\n'),out={...(base||{})};

    const p=bestProduct(rows);
    if(p)out.product=p;
    else if(out.product)out.product=cleanProduct(out.product);

    let plv=labelValueByRow(items,/P\s*[/\-]\s*L\s*N\s*o\.?/i,/([0-9OQDIl|]{1,4})/i);
    if(!plv){
      const pl=(joined+'\n'+String(raw||'')).match(/P\s*[/\-]\s*L\s*N\s*o\.?\s*[:\-]?\s*([0-9OQDIl|]{1,4})/i);
      if(pl)plv=pl[1];
    }
    if(plv){
      const v=num(plv);
      if(v&&Number(v)<500)out.palletNo=v;
    }

    // Packaging factors such as 900×12 are never pallet numbers.
    if(out.palletNo&&Number(out.palletNo)>=500)delete out.palletNo;

    if(window.V26Qty&&typeof V26Qty.vendorFormula==='function'){
      const f=V26Qty.vendorFormula(joined);
      if(f&&f.ok&&f.calculated>0)out.qty=String(f.calculated);
    }

    P.lastTemplate='동아에코팩';
    return out;
  }

  P.detect=function(raw,items){
    const rows=rowsOf(raw,items);
    if(detectDonghwa(raw,rows,{}))return '동화지앤피';
    if(detectDonga(raw,rows))return '동아에코팩';
    return '';
  };

  P.parse=function(raw,items){
    const base=(window.V26VendorTemplates&&typeof V26VendorTemplates.parse==='function')
      ? V26VendorTemplates.parse(raw||'',items||[])
      : (typeof window.parseVendorLabel==='function'?window.parseVendorLabel(raw||''):{} )||{};
    const rows=rowsOf(raw,items);
    if(detectDonghwa(raw,rows,base))return parseDonghwa(raw,items,base);
    if(detectDonga(raw,rows))return parseDonga(raw,items,base);
    P.lastTemplate=(window.V26VendorTemplates&&V26VendorTemplates.lastTemplate)||'';
    return base;
  };

  P._test={cleanProduct,rowsOf,itemRowObjects,labelValueByRow,detectDonghwa,detectDonga};
  console.info('[V55-VENDOR-PARSER-3] layout-aware Donga + Donghwa parser ready');
})();