/* V55 Vendor Parser V3.1
 * Benchmark/feature-layer parser only.
 * - Does not modify V26 core files.
 * - Adds Donghwa G&P label recovery.
 * - Cleans Donga Ecopack product / P-L parsing.
 */
(function(){
  'use strict';
  if(window.__V55_VENDOR_PARSER__)return;
  window.__V55_VENDOR_PARSER__=true;

  const P=window.V55VendorParser={VERSION:'V55-VENDOR-PARSER-3.5'};

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
  function formulaFactors(s){
    const out=[];
    const src=fixDigits(s).replace(/,/g,'');
    const re=/([0-9]{1,4})\s*[xX×*]\s*([0-9]{1,4})(?:(?:\s*[xX×*]\s*([0-9]{1,4}))|(?:\s+([0-9]{1,3})\s*단))?/g;
    let m;
    while((m=re.exec(src))!==null){
      [m[1],m[2],m[3],m[4]].filter(Boolean).forEach(v=>out.push(String(Number(v))));
    }
    return out.filter(Boolean);
  }
  function rejectInferredFormulaPallet(out,source){
    const p=num(out&&out.palletNo);
    if(p&&formulaFactors(source).includes(p))delete out.palletNo;
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
  function palletLabelDongaRe(){return /P\s*(?:[/\-]\s*)?(?:[I1|]\s*)?[L1I|]\s*N\s*[oO0QD]\.?/i;}
  function palletLabelDonghwaRe(){return /P\s*[-/]?\s*(?:번\s*호|변(?:\s*호)?|N\s*[oO0QD]\.?)/i;}
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
    x=x.replace(/(\d{1,4})\s*m(?:1|i|I|l|!|\|)?(?=\s|$|[^A-Za-z0-9])/gi,(m,n)=>n+'ml');

    // OCR sometimes leaves the product-key tail in front of a correctly read
    // Donghwa product value ("명 판콜...", "높명 판콜...").  Once the
    // canonical product token itself is present, discard only the leading
    // label/noise and normalize spacing.  Do not invent a product when the
    // canonical token is absent.
    const pancol=x.match(/판콜\s*에?이?\s*병/i);
    if(pancol&&pancol.index>0)x=x.slice(pancol.index);
    x=x.replace(/판콜\s*에?이?\s*병/gi,'판콜에이병');
    return x.trim();
  }

  function editDistance(a,b){
    a=String(a||'');b=String(b||'');
    const prev=Array.from({length:b.length+1},(_,i)=>i),cur=new Array(b.length+1);
    for(let i=1;i<=a.length;i++){
      cur[0]=i;
      for(let j=1;j<=b.length;j++)cur[j]=Math.min(cur[j-1]+1,prev[j]+1,prev[j-1]+(a[i-1]===b[j-1]?0:1));
      for(let j=0;j<=b.length;j++)prev[j]=cur[j];
    }
    return prev[b.length];
  }
  function nearHangulToken(source,target,maxDist){
    const h=String(source||'').replace(/[^가-힣]/g,'');
    const min=Math.max(2,target.length-maxDist),max=target.length+maxDist;
    for(let len=min;len<=max;len++){
      for(let i=0;i+len<=h.length;i++){
        const part=h.slice(i,i+len);
        if(editDistance(part,target)<=maxDist)return true;
      }
    }
    return false;
  }
  function hasVolume(source,n){
    const re=new RegExp(String(n)+'\\s*m(?:l|1|i|I|!|\\|)?(?=\\s|$|[^A-Za-z0-9])','i');
    return re.test(String(source||''));
  }
  function canonicalKnownProduct(rows){
    const src=(Array.isArray(rows)?rows:[rows]).join('\n');
    if(hasVolume(src,75)&&nearHangulToken(src,'까스활명수',2))return '까스활명수75ml';
    if(hasVolume(src,30)&&nearHangulToken(src,'판콜에이병',2))return '판콜에이병 30ml';
    const compact=src.replace(/\s/g,'');
    if(hasVolume(src,100)&&/유리병[（(]?각병[)）]?/.test(compact))return '유리병(각병) 100ml';
    return '';
  }

  function sourceFactorSet(source){return new Set(formulaFactors(source).map(String));}
  function safePalletValue(v,source){
    const p=num(v);
    return p&&!sourceFactorSet(source).has(String(Number(p)))?p:'';
  }
  function recoverDongaPallet(rows,source){
    const src=String(source||'');
    const explicit=src.match(/P\s*(?:[/\-]\s*)?(?:[I1|]\s*)?[L1I|]\s*N\s*[oO0QD]\.?\s*[:\-]?\s*([0-9OQDIl|]{1,4})\b/i);
    if(explicit){
      const p=safePalletValue(explicit[1],src);
      if(p)return p;
    }
    for(const row of rows){
      const m=fixDigits(row).match(/(?:^|\D)([0-9]{1,4})\s*색(?:상|신)(?=\s|$|[:.])/i);
      if(m){
        const p=safePalletValue(m[1],src);
        if(p)return p;
      }
    }
    return '';
  }
  function recoverDonghwaPallet(rows,source){
    const src=String(source||''),factors=sourceFactorSet(src);
    const valid=v=>{const p=num(v);return p&&!factors.has(String(Number(p)))?p:'';};
    const explicit=src.match(/P\s*[-/]?\s*(?:번\s*호|변(?:\s*호)?|N\s*[oO0QD]\.?)\s*[:\-]?\s*([0-9OQDIl|]{1,4})\b/i);
    if(explicit){const p=valid(explicit[1]);if(p)return p;}
    const bare=src.match(/(?:^|\n|\s)번\s*호\s*[:\-]?\s*([0-9OQDIl|]{1,4})\b/im);
    if(bare){const p=valid(bare[1]);if(p)return p;}

    for(let i=0;i<rows.length;i++){
      const row=rows[i];
      if(!/(?:P\s*[-/]?\s*(?:번\s*호|변|N\s*[oO0QD])|번\s*호)/i.test(row))continue;
      const before=rows[i-1]||'',after=rows[i+1]||'';
      let m=before.match(/^\s*([0-9OQDIl|]{1,4})\s*$/i);
      if(m){const p=valid(m[1]);if(p)return p;}
      m=after.match(/=\s*[0-9][0-9,\.]{3,}\s*(?:본|EA|개)?\s+([0-9OQDIl|]{1,4})\s*$/i);
      if(m){const p=valid(m[1]);if(p)return p;}
    }
    return '';
  }

  function productScore(x,fromLabel){
    x=cleanProduct(x);
    if(!x||!/[가-힣]{2,}/.test(x))return -999;
    let score=fromLabel?30:0;
    if(/\d{1,4}\s*ml\b/i.test(x))score+=24;
    if(/[가-힣]{3,}/.test(x))score+=12;
    if(/(?:병|유리병|활명수|판콜)/.test(x))score+=8;
    if(/(?:생산|제조|포장|수량|본|단|충격|파손|주의|검사|납품|회사|일자|시간|라인)/.test(x))score-=45;
    if(/^[0-9\s,.:/\-]+$/.test(x))score-=80;
    // Prefer a complete product+volume string over a shorter partial fragment.
    score+=Math.min(12,Math.max(0,x.replace(/\s/g,'').length-4));
    return score;
  }
  function joinProductRows(rows,i){
    const base=cleanProduct(rows[i]||'');
    const parts=[base].filter(Boolean);
    for(let j=i+1;j<Math.min(rows.length,i+3);j++){
      const n=cleanProduct(rows[j]||'');
      if(!n)continue;
      if(/(?:생산|제조|포장|수량|P\s*[/\-]?\s*L|P\s*[-/]?\s*(?:번호|No)|일자|시간|라인)/i.test(n))break;
      // Join a nearby volume-only row, or a nearby Korean product fragment.
      if(/^\d{1,4}\s*m(?:l|1|i)?\b/i.test(n)||(/[가-힣]{2,}/.test(n)&&parts.join(' ').length<28)){
        parts.push(n);
        if(/\d{1,4}\s*ml\b/i.test(cleanProduct(parts.join(' '))))break;
      }else break;
    }
    return cleanProduct(parts.join(' '));
  }
  function bestProduct(rows){
    const cands=[];
    for(let i=0;i<rows.length;i++){
      const r=rows[i];
      const hasLabel=/(?:제\s*품\s*[명영]|품\s*[명영])/.test(r);
      if(hasLabel){
        const joined=joinProductRows(rows,i);
        if(joined)cands.push({v:joined,score:productScore(joined,true),i});
      }
      const x=cleanProduct(r);
      if(x&&/[가-힣]{2,}/.test(x)&&/\d{1,4}\s*ml/i.test(x))
        cands.push({v:x,score:productScore(x,false),i});
    }
    cands.sort((a,b)=>b.score-a.score||a.i-b.i||b.v.length-a.v.length);
    return cands.length&&cands[0].score>0?cleanProduct(cands[0].v):'';
  }
  function detectDonghwa(raw,rows,base){
    const s=(flat(raw)+' '+rows.join(' ')+' '+flat(base&&base.product)).toLowerCase();
    let score=0;
    if(/동화\s*지앤피/.test(s))score+=4;
    if(/p\s*[-/]?\s*(?:번\s*호|no)/i.test(s))score+=3;
    if(/\d{1,4}\s*[x×*]\s*\d{1,4}\s*(?:[x×*]\s*\d{1,3}|\s+\d{1,3})\s*단/.test(s))score+=3;
    if(/유리\s*제품.*충격.*파손/.test(s))score+=2;
    if(/판콜/.test(s))score+=2;
    if(/유리병\s*[（(]?각병/.test(s))score+=2;
    const known=canonicalKnownProduct(rows);
    if(known==='판콜에이병 30ml'||known==='유리병(각병) 100ml')score+=4;
    if(/499\D{0,4}8574/.test(s))score+=4;
    return score>=3;
  }
  function detectDonga(raw,rows){
    const s=(flat(raw)+' '+rows.join(' ')).toLowerCase();
    return /동아\s*에코\s*팩/.test(s)||/p\s*[/\-]\s*l\s*no/.test(s)||/당진\s*\d+\s*f/.test(s);
  }
  function parseDonghwa(raw,items,base){
    const rows=rowsOf(raw,items),joined=rows.join('\n'),out={...(base||{})};

    let p=canonicalKnownProduct(rows)||bestProduct(rows);
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
    const palletSource=joined+'\n'+String(raw||'');
    let pv=recoverDonghwaPallet(rows,palletSource);
    if(!pv){
      const rowPv=labelValueByRow(items,palletLabelDonghwaRe(),/([0-9OQDIl|]{1,4})\b/i);
      pv=safePalletValue(rowPv,palletSource);
    }
    if(pv)out.palletNo=pv;
    else if(out.palletNo)rejectInferredFormulaPallet(out,palletSource);

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

    const p=canonicalKnownProduct(rows)||bestProduct(rows);
    if(p)out.product=p;
    else if(out.product)out.product=cleanProduct(out.product);

    const palletSource=joined+'\n'+String(raw||'');
    let plv=recoverDongaPallet(rows,palletSource);
    if(!plv){
      const rowPl=labelValueByRow(items,palletLabelDongaRe(),/([0-9OQDIl|]{1,4})\b/i);
      plv=safePalletValue(rowPl,palletSource);
    }
    if(plv)out.palletNo=plv;
    else if(out.palletNo)rejectInferredFormulaPallet(out,palletSource);

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

  P._test={cleanProduct,productScore,joinProductRows,bestProduct,canonicalKnownProduct,editDistance,nearHangulToken,palletLabelDongaRe,palletLabelDonghwaRe,rowsOf,itemRowObjects,labelValueByRow,detectDonghwa,detectDonga,formulaFactors,rejectInferredFormulaPallet,recoverDongaPallet,recoverDonghwaPallet};
  console.info('[V55-VENDOR-PARSER-3.5] known-product normalization + tolerant pallet recovery + formula-safe parser ready');
})();