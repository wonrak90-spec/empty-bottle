/* V26 수량 보정 레이어
 * WMS: 21,320.000 / 21.320.000 / 21 320.000 / 21320.000 -> 21320
 * 업체: 40×41×13=21,320 / 900×12=10,800 산식 검산
 */
(function(){
  'use strict';
  if(window.__V26_QTY__) return;
  window.__V26_QTY__=true;

  const Q=window.V26Qty={lastWms:null,lastVendor:null};

  function fixDigits(s){
    return String(s||'')
      .replace(/[OoDQ]/g,'0').replace(/[lIi|]/g,'1').replace(/[Ss]/g,'5')
      .replace(/[Bb]/g,'8').replace(/[Zz]/g,'2').replace(/[gq]/g,'9').replace(/[Tt]/g,'7');
  }
  function fmt(n){
    const v=Number(n);
    return Number.isFinite(v)?Math.trunc(v).toLocaleString('ko-KR'):'';
  }

  function findWmsQtyRaw(raw){
    const lines=String(raw||'').replace(/\r/g,'').split('\n');
    for(let i=0;i<lines.length;i++){
      if(!/수\s*량/.test(lines[i])) continue;
      const m=lines[i].match(/수\s*량\s*[:：]?\s*(.*)$/);
      let tail=(m&&m[1]?m[1]:'').trim();
      if(!tail&&i+1<lines.length) tail=lines[i+1].trim();
      const q=tail.match(/([0-9OoDQIl|SsBbZzgqTt][0-9OoDQIl|SsBbZzgqTt,.\s]*)/);
      if(q&&q[1]) return q[1].trim();
    }
    return '';
  }

  function normalizeWmsQuantity(raw){
    const original=String(raw||'').trim();
    if(!original) return {raw:'',value:'',review:false,reason:''};

    let s=fixDigits(original).replace(/\u00a0/g,' ').replace(/[^0-9,.\s]/g,' ').trim();
    s=s.replace(/\s+/g,' ');
    let token=((s.match(/[0-9][0-9,. ]*/)||[''])[0]||'').trim();
    if(!token) return {raw:original,value:'',review:true,reason:'수량 숫자 인식 실패'};

    const sepCount=(token.match(/[,. ]/g)||[]).length;
    const last=token.match(/([,. ])([0-9]{3})$/);
    let work=token;
    let fraction='';
    let decimal=false;

    if(last){
      const sep=last[1];
      const prefix=token.slice(0,last.index).replace(/\D/g,'');
      decimal=(sep==='.'||sepCount>=2||prefix.length>3);
      if(decimal){
        fraction=last[2];
        work=token.slice(0,last.index);
      }
    }

    if(decimal&&fraction!=='000'){
      return {raw:original,value:'',review:true,reason:'WMS 소수부가 .000이 아님 ('+fraction+')'};
    }

    let digits=work.replace(/\D/g,'');
    let inferred=false;
    if(!decimal&&!/[,. ]/.test(token)&&digits.length>=7&&/000$/.test(digits)){
      digits=digits.slice(0,-3);
      inferred=true;
    }
    const n=Number(digits);
    if(!Number.isFinite(n)||n<=0) return {raw:original,value:'',review:true,reason:'수량 값 오류'};
    return {raw:original,value:String(Math.trunc(n)),formatted:fmt(n),review:false,inferred};
  }

  function simpleCount(raw){
    let s=fixDigits(raw).replace(/\u00a0/g,' ');
    const m=s.match(/[0-9][0-9,.\s]*/);
    if(!m) return '';
    let t=m[0].trim().replace(/\s+/g,'');
    if(/\.000$/.test(t)) t=t.slice(0,-4);
    const n=Number(t.replace(/\D/g,''));
    return Number.isFinite(n)&&n>0?String(Math.trunc(n)):'';
  }

  function vendorFormula(raw){
    const src=fixDigits(raw).replace(/\u00a0/g,' ');
    const re=/([0-9][0-9,]*)\s*[xX×*]\s*([0-9][0-9,]*)(?:\s*[xX×*]\s*([0-9][0-9,]*))?/g;
    let m;
    while((m=re.exec(src))){
      const factors=[m[1],m[2],m[3]].filter(Boolean).map(v=>Number(v.replace(/,/g,'')));
      if(factors.some(v=>!Number.isFinite(v)||v<=0)) continue;
      const calculated=factors.reduce((a,b)=>a*b,1);
      const tail=src.slice(re.lastIndex,re.lastIndex+70);
      const sm=tail.match(/([0-9][0-9,.\s]*)\s*(?:본|EA|개)/i);
      const stated=sm?Number(simpleCount(sm[1])):0;
      return {factors,calculated,stated:Number.isFinite(stated)?stated:0,ok:!stated||stated===calculated};
    }
    return null;
  }

  const originalWms=window.parseLabelText;
  if(typeof originalWms==='function'){
    window.parseLabelText=function(raw){
      const out=originalWms(raw)||{};
      const source=findWmsQtyRaw(raw)||String(out.displayQty||'');
      const info=normalizeWmsQuantity(source);
      Q.lastWms=info;
      if(info.review) out.displayQty='';
      else if(info.value){out.displayQty=info.value;if(!out.unit)out.unit='EA';}
      return out;
    };
  }

  const originalVendor=window.parseVendorLabel;
  if(typeof originalVendor==='function'){
    window.parseVendorLabel=function(raw){
      const out=originalVendor(raw)||{};
      const f=vendorFormula(raw);
      if(f){
        Q.lastVendor={kind:'formula',...f};
        out.qty=f.ok?String(f.calculated):'';
      }else{
        const q=simpleCount(out.qty||'');
        Q.lastVendor={kind:'plain',value:q,ok:true};
        if(q)out.qty=q;
      }
      return out;
    };
  }

  const originalSetStatus=window.setStatus;
  if(typeof originalSetStatus==='function'){
    window.setStatus=function(id,text,type){
      let msg=String(text||'');
      let t=type;
      if(id==='wmsStatus'&&/OCR.*(?:완료|인식)|자동인식 완료/.test(msg)&&Q.lastWms){
        const q=Q.lastWms;
        if(q.review){msg+=' · 수량 재확인 필요: '+q.reason;t='warn';}
        else if(q.value)msg+=' · WMS 수량 '+q.raw+' → '+q.formatted+' EA'+(q.inferred?' (구분기호 보정)':'');
      }
      if(id==='vendorStatus'&&/OCR.*(?:완료|인식)|자동인식 완료/.test(msg)&&Q.lastVendor&&Q.lastVendor.kind==='formula'){
        const q=Q.lastVendor;
        const f=q.factors.join('×')+' = '+fmt(q.calculated);
        if(!q.ok){msg+=' · 수량 산식 불일치: '+f+' / 표시 '+fmt(q.stated);t='warn';}
        else msg+=' · 수량 산식 '+f+' ✓';
      }
      return originalSetStatus(id,msg,t);
    };
  }

  Q.normalizeWmsQuantity=normalizeWmsQuantity;
  Q.vendorFormula=vendorFormula;
  console.info('[V26-QTY] WMS quantity normalization + vendor formula verification active');
})();
