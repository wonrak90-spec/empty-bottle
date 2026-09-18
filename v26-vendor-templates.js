/* V26 업체 라벨 템플릿 보정
 * 실제 현장 사진에서 확인된 업체 양식만 선택적으로 보정한다.
 * - KC Glass & Materials: 제품명/규격/1PT 수량/생산일자+시간/라인·Lot No.
 * - 동아에코팩: 품명/생산라인/P-L No./포장사양/생산일자/시간/납품처/제조회사
 * 사진 원본은 저장소에 포함하지 않는다.
 */
(function(){
  'use strict';
  if(window.__V26_VENDOR_TEMPLATES__)return;
  window.__V26_VENDOR_TEMPLATES__=true;

  const T=window.V26VendorTemplates={
    VERSION:'V26-VENDOR-TEMPLATES-1',
    lastTemplate:'',
    templates:['KC Glass & Materials','동아에코팩']
  };

  function fixDigits(s){
    return String(s||'')
      .replace(/[OoDQ]/g,'0').replace(/[lIi|]/g,'1').replace(/[Ss]/g,'5')
      .replace(/[Bb]/g,'8').replace(/[Zz]/g,'2').replace(/[gq]/g,'9').replace(/[Tt]/g,'7');
  }
  function flat(s){return String(s||'').replace(/[：﹕]/g,':').replace(/[｜|]/g,' ').replace(/[\t ]+/g,' ').trim();}
  function lines(s){return String(s||'').replace(/\r/g,'').split(/\n+/).map(flat).filter(Boolean);}
  function num(v){
    const n=Number(fixDigits(v).replace(/[^0-9]/g,''));
    return Number.isFinite(n)&&n>0?String(Math.trunc(n)):'';
  }
  function validDate(y,m,d){
    y=Number(y);m=Number(m);d=Number(d);
    if(y<2000||y>2099||m<1||m>12||d<1||d>31)return '';
    const x=new Date(y,m-1,d);
    if(x.getFullYear()!==y||x.getMonth()!==m-1||x.getDate()!==d)return '';
    return y+'-'+String(m).padStart(2,'0')+'-'+String(d).padStart(2,'0');
  }
  function dateOf(s){
    s=fixDigits(String(s||''));
    let m=s.match(/(20\d{2})\s*(?:년|[.\/-])\s*(\d{1,2})\s*(?:월|[.\/-])\s*(\d{1,2})/);
    if(m)return validDate(m[1],m[2],m[3]);
    m=s.match(/(?:^|\D)(\d{2})\s*[.\/-]\s*(\d{1,2})\s*[.\/-]\s*(\d{1,2})(?!\d)/);
    if(m)return validDate('20'+m[1],m[2],m[3]);
    return '';
  }
  function timeOf(s){
    const m=fixDigits(String(s||'')).match(/(?:^|\D)([01]?\d|2[0-3])\s*[:시]\s*([0-5]\d)(?!\d)/);
    return m?String(Number(m[1])).padStart(2,'0')+':'+m[2]:'';
  }
  function afterLabel(row,re){
    const m=String(row||'').match(re);
    return m&&m[1]?flat(m[1]):'';
  }
  function rowMatch(arr,re){
    return arr.find(x=>re.test(x))||'';
  }
  function cleanProduct(s){
    return flat(s)
      .replace(/m[ℓℒ]/gi,'mL').replace(/㎖/g,'mL')
      .replace(/^[\s:.-]+|[\s:.-]+$/g,'')
      .replace(/\s+(?=ml\b)/ig,'');
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
    const arr=(items||[]).filter(x=>x&&String(x.text||'').trim()).map(x=>({text:flat(x.text),...polyStats(x.poly)})).sort((a,b)=>a.y-b.y||a.x-b.x);
    const rows=[];
    for(const it of arr){
      let r=rows.find(z=>Math.abs(z.y-it.y)<=Math.max(12,Math.max(z.h,it.h)*.7));
      if(!r){r={y:it.y,h:it.h,items:[]};rows.push(r);}
      r.items.push(it);r.h=Math.max(r.h,it.h);
    }
    return rows.sort((a,b)=>a.y-b.y).map(r=>r.items.sort((a,b)=>a.x-b.x).map(x=>x.text).join(' '));
  }
  function combinedRows(raw,items){
    const a=lines(raw),b=itemRows(items),out=[];
    for(const x of [...a,...b])if(x&&out.indexOf(x)<0)out.push(x);
    return out;
  }
  function detect(raw,rows){
    const s=(flat(raw)+' '+rows.join(' ')).toLowerCase().replace(/\s+/g,' ');
    let kc=0,donga=0;
    if(/kc\s*glass|glass\s*&\s*materials/.test(s))kc+=3;
    if(/1\s*p\s*t\s*수\s*량/.test(s))kc+=2;
    if(/라인\s*[/·]?\s*lot/.test(s))kc+=2;
    if(/규\s*격/.test(s)&&/생산\s*일\s*자/.test(s))kc++;

    if(/동아\s*에코\s*팩/.test(s))donga+=3;
    if(/포\s*장\s*사\s*양/.test(s))donga+=2;
    if(/p\s*[/\-]?\s*l\s*no/.test(s))donga+=2;
    if(/생산\s*라\s*인/.test(s)&&/납\s*품\s*처/.test(s))donga++;

    if(kc>=3&&kc>donga)return 'KC Glass & Materials';
    if(donga>=3&&donga>=kc)return '동아에코팩';
    return '';
  }

  function parseKC(raw,rows,out){
    const joined=rows.join('\n');

    const productRow=rowMatch(rows,/제\s*품\s*명/i);
    const specRow=rowMatch(rows,/규\s*격/i);
    const qtyRow=rowMatch(rows,/1\s*P\s*T\s*수\s*량/i);
    const dateRow=rowMatch(rows,/생\s*산\s*일\s*자/i);
    const lotRow=rowMatch(rows,/라\s*인\s*[/·]?\s*L\s*o\s*t\s*N\s*o/i);

    const product=afterLabel(productRow,/제\s*품\s*명\s*[:\-]?\s*(.+)$/i);
    const spec=afterLabel(specRow,/규\s*격\s*[:\-]?\s*(.+)$/i);
    if(product){
      let p=cleanProduct(product);
      if(spec&&p.toLowerCase().indexOf(cleanProduct(spec).toLowerCase())<0)p+=' '+cleanProduct(spec);
      out.product=p.trim();
    }

    const qsrc=afterLabel(qtyRow,/1\s*P\s*T\s*수\s*량\s*[:\-]?\s*(.+)$/i)||qtyRow;
    const qm=fixDigits(qsrc).match(/([0-9][0-9,. ]{2,})/);
    if(qm){const q=num(qm[1]);if(q)out.qty=q;}

    const dsrc=afterLabel(dateRow,/생\s*산\s*일\s*자\s*[:\-]?\s*(.+)$/i)||dateRow;
    const d=dateOf(dsrc),tm=timeOf(dsrc);
    if(d)out.prodDate=d;if(tm)out.prodTime=tm;

    const lm=(lotRow||joined).match(/라\s*인\s*[/·]?\s*L\s*o\s*t\s*N\s*o\.?\s*[:\-]?\s*([0-9OIl|]{1,2})\s*([A-Za-z])?\s*[/／]\s*([A-Za-z0-9\-]{1,12})/i);
    if(lm){
      out.line=(fixDigits(lm[1])+(lm[2]||'')).replace(/\s+/g,'').toUpperCase();
      out.lotNo=fixDigits(lm[3]).replace(/\s+/g,'');
    }else{
      const loose=(lotRow||'').match(/([0-9OIl|]\s*[Ff])\s*[/／]\s*([A-Za-z0-9\-]{1,12})/);
      if(loose){out.line=fixDigits(loose[1]).replace(/\s+/g,'').toUpperCase();out.lotNo=fixDigits(loose[2]);}
    }
    out.maker=out.maker||'KC Glass & Materials';
    return out;
  }

  function parseDonga(raw,rows,out){
    const joined=rows.join('\n');
    const productRow=rowMatch(rows,/품\s*명/i);
    const lineRow=rowMatch(rows,/생\s*산\s*라\s*인/i);
    const plRow=rowMatch(rows,/P\s*[/\-]?\s*L\s*N\s*o/i);
    const packRow=rowMatch(rows,/포\s*장\s*사\s*양/i);
    const dateRow=rowMatch(rows,/생\s*산\s*일\s*자/i);
    const timeRow=rowMatch(rows,/시\s*간/i);
    const makerRow=rowMatch(rows,/제\s*조\s*회\s*사/i);
    const deliverRow=rowMatch(rows,/납\s*품\s*처/i);

    const product=afterLabel(productRow,/품\s*명\s*[:\-]?\s*(.+)$/i);
    if(product)out.product=cleanProduct(product).replace(/\s+(?=75\s*m[lℓ])/i,'');

    let line=afterLabel(lineRow,/생\s*산\s*라\s*인\s*[:\-]?\s*(.+)$/i);
    if(line)out.line=flat(line).replace(/\s+/g,' ').trim();

    const pl=(plRow||joined).match(/P\s*[/\-]?\s*L\s*N\s*o\.?\s*[:\-]?\s*([0-9OQDIl|]{1,4})/i);
    if(pl){
      const p=num(pl[1]);
      if(p){out.palletNo=p;if(String(out.lotNo||'')===p)delete out.lotNo;}
    }

    const f=window.V26Qty&&typeof V26Qty.vendorFormula==='function'?V26Qty.vendorFormula(packRow||joined):null;
    if(f&&f.calculated>0&&f.ok)out.qty=String(f.calculated);
    else{
      const q=(packRow||joined).match(/[:=]\s*([0-9OQDIl|][0-9OQDIl|,\. ]{2,})\s*(?:본|EA|개)/i);
      if(q){const v=num(q[1]);if(v)out.qty=v;}
    }

    const dsrc=afterLabel(dateRow,/생\s*산\s*일\s*자\s*[:\-]?\s*(.+)$/i)||dateRow;
    const tsrc=afterLabel(timeRow,/시\s*간\s*[:\-]?\s*(.+)$/i)||timeRow;
    const d=dateOf(dsrc),tm=timeOf(tsrc||dsrc);
    if(d)out.prodDate=d;if(tm)out.prodTime=tm;

    const mm=String(makerRow||'').match(/제\s*조\s*회\s*사\s*[:\-]?\s*(.+)$/i);
    const dm=String(deliverRow||'').match(/납\s*품\s*처\s*[:\-]?\s*(.+?)(?=\s*제\s*조\s*회\s*사|$)/i);
    const maker=mm&&mm[1]?flat(mm[1]):'';
    const deliver=dm&&dm[1]?flat(dm[1]):'';
    if(maker)out.maker=maker;if(deliver)out.deliverTo=deliver;
    if(!out.maker&&/동아\s*에코\s*팩/i.test(joined))out.maker='동아에코팩(주)';
    return out;
  }

  T.parse=function(raw,items){
    const base=(typeof window.parseVendorLabel==='function'?window.parseVendorLabel(raw||''):{})||{};
    const rows=combinedRows(raw,items);
    const name=detect(raw,rows);
    T.lastTemplate=name;
    const out={...base};
    if(name==='KC Glass & Materials')return parseKC(raw,rows,out);
    if(name==='동아에코팩')return parseDonga(raw,rows,out);
    return out;
  };

  T.detect=function(raw,items){return detect(raw,combinedRows(raw,items));};
  console.info('[V26-VENDOR-TEMPLATES-1] KC Glass + Donga Ecopack templates active');
})();