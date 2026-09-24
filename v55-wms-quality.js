/* V55 WMS OCR Quality Guard V1
 * Conservative validation layer for low-quality WMS OCR.
 * Does not guess/correct identifiers or quantities.
 */
(function(){
  'use strict';
  if(window.__V55_WMS_QUALITY__)return;
  window.__V55_WMS_QUALITY__=true;

  const Q=window.V55WmsQuality={VERSION:'V55-WMS-QUALITY-1'};
  let parseIssues=[];

  const digits=v=>String(v==null?'':v).replace(/[^0-9]/g,'');
  const num=v=>{const d=digits(v);return d?Number(d):0;};
  const text=v=>String(v==null?'':v).trim();

  function todayLocal(){
    const d=new Date();
    return new Date(d.getFullYear(),d.getMonth(),d.getDate());
  }
  function parseDate(v){
    const s=text(v);
    let m=s.match(/^(20\d{2})[-/.]?(\d{2})[-/.]?(\d{2})$/);
    if(!m)return null;
    const y=Number(m[1]),mo=Number(m[2]),da=Number(m[3]);
    const d=new Date(y,mo-1,da);
    if(d.getFullYear()!==y||d.getMonth()!==mo-1||d.getDate()!==da)return null;
    return d;
  }
  function isFutureInboundDate(v){
    const d=parseDate(v);if(!d)return false;
    const max=todayLocal();max.setDate(max.getDate()+1);
    return d>max;
  }
  function expectedManagementPrefix(){
    return String(new Date().getFullYear()).slice(-2);
  }
  function managementYearMismatch(v){
    const d=digits(v);
    return d.length===8&&/^2\d/.test(d)&&d.slice(0,2)!==expectedManagementPrefix();
  }
  function contaminated(v){
    const s=text(v).replace(/\s+/g,'');
    if(!s)return false;
    if(/(?:입고일자|생산일자|사용기한|유효기간|품목코드|관리번호|용기번호|표시수량|수량)/.test(s))return true;
    if(/20\d{6}/.test(s)&&/[가-힣A-Za-z]/.test(s))return true;
    return false;
  }
  function fieldLooksLikeLabelNoise(field,v){
    if(!['product','manufacturer','supplier'].includes(field))return false;
    return contaminated(v);
  }
  function qtyMismatch(wms,vendor){
    const a=num(wms),b=num(vendor);
    if(!a||!b||a===b)return null;
    const hi=Math.max(a,b),lo=Math.min(a,b),ratio=hi/Math.max(1,lo);
    if((lo<100&&hi>=1000)||ratio>=5){
      return {
        severe:true,a,b,ratio,
        factor10:(a*10===b||b*10===a)
      };
    }
    return {severe:false,a,b,ratio,factor10:false};
  }

  Q.sanitizeParsed=function(parsed){
    const out={...(parsed||{})};
    parseIssues=[];
    for(const field of ['product','manufacturer','supplier']){
      if(fieldLooksLikeLabelNoise(field,out[field])){
        parseIssues.push({code:'label_noise',field,value:text(out[field]),
          message:(field==='product'?'품명':field==='manufacturer'?'제조원':'공급업체')+' OCR에 다른 라벨 항목이 섞여 제외했습니다.'});
        delete out[field];
      }
    }
    return out;
  };

  Q.inspect=function(obj){
    obj=obj||{};
    const issues=[...parseIssues];
    const inbound=digits(obj.inboundNo);

    if(inbound&&inbound.length!==8){
      issues.push({code:'management_format',severity:'block',
        message:'관리번호가 8자리가 아닙니다. WMS 라벨을 다시 확인하세요.'});
    }
    if(managementYearMismatch(inbound)){
      issues.push({code:'management_year',severity:'block',
        message:'관리번호 앞자리('+inbound.slice(0,2)+')가 현재 입고연도('+expectedManagementPrefix()+')와 다릅니다. OCR 오인식 여부를 확인하세요.'});
    }
    if(isFutureInboundDate(obj.inboundDate)){
      issues.push({code:'future_inbound_date',severity:'block',
        message:'입고일자가 현재 날짜보다 미래입니다. WMS 입고일자를 다시 확인하세요.'});
    }

    for(const field of ['product','manufacturer','supplier']){
      if(fieldLooksLikeLabelNoise(field,obj[field])){
        issues.push({code:'label_noise',field,severity:'block',
          message:(field==='product'?'품명':field==='manufacturer'?'제조원':'공급업체')+' 값에 다른 라벨 항목/날짜가 섞여 있습니다.'});
      }
    }

    const qm=qtyMismatch(obj.displayQty,obj.vendorQty);
    if(qm&&qm.severe){
      issues.push({code:'qty_extreme',severity:'block',
        message:'WMS 수량 '+qm.a.toLocaleString()+' / 업체라벨 '+qm.b.toLocaleString()+' 차이가 너무 큽니다.'+
          (qm.factor10?' OCR 숫자 1자리 누락 가능성이 있습니다.':' 재인식 또는 실물 확인이 필요합니다.')});
    }

    return {ok:!issues.some(x=>x.severity==='block'),issues};
  };

  Q.inspectForm=function(){
    const val=id=>{const el=document.getElementById(id);return el?el.value.trim():'';};
    return Q.inspect({
      inboundNo:val('inboundNo'),inboundDate:val('inboundDate'),
      product:val('product'),manufacturer:val('manufacturer'),supplier:val('supplier'),
      displayQty:val('displayQty'),vendorQty:val('vQty')
    });
  };

  Q.validateBeforeSave=function(payload){
    const r=Q.inspect({
      inboundNo:payload&&payload.inboundNo,
      inboundDate:payload&&payload.inboundDate,
      product:payload&&payload.product,
      manufacturer:payload&&payload.manufacturer,
      supplier:payload&&payload.supplier,
      displayQty:payload&&payload.displayQty,
      vendorQty:payload&&payload.vendorQty
    });
    if(r.ok)return {ok:true,issues:r.issues};
    return {ok:false,issues:r.issues,message:r.issues.filter(x=>x.severity==='block').map(x=>x.message).join(' · ')};
  };

  Q.render=function(){
    const el=document.getElementById('v55WmsQualityStatus');if(!el)return;
    const r=Q.inspectForm();
    if(!r.issues.length){
      el.className='status ok';
      el.textContent='WMS OCR 품질검사 정상';
      return;
    }
    const block=r.issues.filter(x=>x.severity==='block');
    el.className='status '+(block.length?'bad':'warn');
    el.textContent=(block.length?'⚠ ':'')+r.issues.map(x=>x.message).join(' · ');
  };

  function inject(){
    if(document.getElementById('v55WmsQualityStatus'))return;
    const card=document.getElementById('v55InboundProgressCard');
    if(!card)return;
    const el=document.createElement('div');
    el.id='v55WmsQualityStatus';
    el.className='status';
    el.style.marginTop='8px';
    el.textContent='WMS OCR 품질검사 대기';
    card.appendChild(el);
    ['inboundNo','inboundDate','product','manufacturer','supplier','displayQty','vQty'].forEach(id=>{
      const x=document.getElementById(id);if(x)x.addEventListener('input',Q.render);
    });
    Q.render();
  }

  Q._test={digits,num,parseDate,isFutureInboundDate,managementYearMismatch,contaminated,fieldLooksLikeLabelNoise,qtyMismatch};

  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',()=>setTimeout(inject,0),{once:true});
  else setTimeout(inject,0);
})();