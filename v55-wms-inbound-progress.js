/* V55 WMS Inbound Progress V1
 * Operational layer only. Keeps OCR parsers unchanged.
 * Groups saved pallets by WMS inbound/management number + item code and
 * interprets containerFrom/containerTo as current-sequence/total only when sane.
 */
(function(){
  'use strict';
  if(window.__V55_WMS_INBOUND_PROGRESS__)return;
  window.__V55_WMS_INBOUND_PROGRESS__=true;

  const KEY='v55.wmsInboundProgress.v1';
  const $=id=>document.getElementById(id);
  const n=v=>{const x=Number(String(v==null?'':v).replace(/\D/g,''));return Number.isFinite(x)?x:0;};
  const pad=(v,w=4)=>String(n(v)||0).padStart(w,'0');

  function load(){
    try{
      const x=JSON.parse(localStorage.getItem(KEY)||'{}');
      return x&&typeof x==='object'?x:{};
    }catch(_){return {};}
  }
  let groups=load();
  const syncAt={};
  function persist(){try{localStorage.setItem(KEY,JSON.stringify(groups));}catch(_){} renderCurrent();}

  function seqInfo(obj){
    const current=n(obj&&obj.containerFrom), total=n(obj&&obj.containerTo);
    // The printed WMS label seen in validation uses e.g. 0004/0028.
    // Treat this as current/total only when the pair is internally sane.
    if(!current||!total||current>total||total>9999)return null;
    return {current,total,currentText:pad(current),totalText:pad(total)};
  }
  function keyOf(obj){
    const inbound=String(obj&&obj.inboundNo||'').trim();
    const item=String(obj&&obj.itemCode||'').trim();
    return inbound?(inbound+'|'+item):'';
  }
  function getGroup(obj){
    const key=keyOf(obj);if(!key)return null;
    const seq=seqInfo(obj);
    const g=groups[key]||{
      key,
      managementNo:String(obj.inboundNo||'').trim(),
      itemCode:String(obj.itemCode||'').trim(),
      product:String(obj.product||'').trim(),
      total:seq?seq.total:0,
      done:[],
      review:[],
      lastSeq:0,
      updatedAt:0
    };
    if(seq&&(!g.total||g.total===seq.total))g.total=seq.total;
    if(!g.product&&obj.product)g.product=String(obj.product).trim();
    groups[key]=g;
    return g;
  }
  function isDuplicate(obj){
    const seq=seqInfo(obj), key=keyOf(obj);
    if(!seq||!key||!groups[key])return false;
    return (groups[key].done||[]).includes(seq.current);
  }
  function validateBeforeSave(obj){
    const seq=seqInfo(obj);
    const inbound=String(obj&&obj.inboundNo||'').trim();
    const qty=Number(String(obj&&obj.displayQty||'').replace(/[^0-9]/g,''));
    if(!seq&&/^\d{8}$/.test(inbound)){
      return {ok:false,tracked:false,missingRange:true,message:
        '관리번호는 인식됐지만 현재/전체 Pallet 순번이 없습니다. WMS 라벨 하단을 다시 인식하거나 직접 입력하세요.'};
    }
    if(!seq)return {ok:true,tracked:false,message:'WMS 순번/전체수량을 확인할 수 없어 진행률 추적 없이 저장합니다.'};
    if(!Number.isFinite(qty)||qty<1000||qty>5000000){
      return {ok:false,tracked:true,invalidQty:true,message:
        'WMS 표시수량이 비어 있거나 비정상적으로 작습니다. WMS 라벨을 다시 인식하거나 수량을 확인 후 입력하세요.'};
    }
    if(isDuplicate(obj)){
      return {ok:false,tracked:true,duplicate:true,message:
        '이미 확인한 Pallet입니다 · 관리번호 '+String(obj.inboundNo||'')+' / 순번 '+seq.currentText+' / '+seq.totalText};
    }
    return {ok:true,tracked:true,duplicate:false,message:'순번 '+seq.currentText+' / '+seq.totalText};
  }
  function onSingleSaved(obj){
    const seq=seqInfo(obj);if(!seq)return;
    const g=getGroup(obj);if(!g)return;
    if(!g.done.includes(seq.current))g.done.push(seq.current);
    g.done.sort((a,b)=>a-b);
    const review=String(obj.finalResult||'')!=='적합'||String(obj.labelMatch||'')==='불일치';
    if(review&&!g.review.includes(seq.current))g.review.push(seq.current);
    g.lastSeq=seq.current;g.updatedAt=Date.now();
    persist();
  }
  function missingOf(g){
    if(!g||!g.total)return [];
    const done=new Set(g.done||[]),out=[];
    for(let i=1;i<=g.total;i++)if(!done.has(i))out.push(i);
    return out;
  }
  function latestGroup(){
    const arr=Object.values(groups||{}).filter(g=>g&&g.updatedAt);
    arr.sort((a,b)=>(b.updatedAt||0)-(a.updatedAt||0));
    return arr[0]||null;
  }

  function currentForm(){
    const val=id=>$(id)?$(id).value.trim():'';
    return {
      inboundNo:val('inboundNo'),itemCode:val('itemCode'),product:val('product'),
      containerFrom:val('containerFrom'),containerTo:val('containerTo')
    };
  }
  function itemSeq(it,total){
    let x=n(it&&it.containerNo);
    if(!x){
      const code=String(it&&it.code||'');
      const m=code.match(/[-/]([0-9]{1,4})$/);
      if(m)x=n(m[1]);
    }
    return x>0&&(!total||x<=total)?x:0;
  }
  async function syncFromServer(obj){
    obj=obj||currentForm();
    const seq=seqInfo(obj),key=keyOf(obj);
    if(!seq||!key||typeof window.apiGet!=='function')return null;
    const last=syncAt[key]||0;
    if(Date.now()-last<10000)return groups[key]||null;
    syncAt[key]=Date.now();
    try{
      const res=await window.apiGet('searchPallets',{keyword:String(obj.inboundNo||'').trim()});
      if(!res||!res.ok||!Array.isArray(res.items))return groups[key]||null;
      const g=getGroup(obj);if(!g)return null;
      for(const it of res.items){
        if(String(it&&it.inboundNo||'').trim()!==String(obj.inboundNo||'').trim())continue;
        if(obj.itemCode&&it.itemCode&&String(it.itemCode).trim()!==String(obj.itemCode).trim())continue;
        const s=itemSeq(it,seq.total);if(!s)continue;
        if(!g.done.includes(s))g.done.push(s);
        if(/확인|이종|불일치/.test(String(it.result||''))&&!g.review.includes(s))g.review.push(s);
      }
      g.done.sort((a,b)=>a-b);g.updatedAt=Math.max(g.updatedAt||0,Date.now());
      persist();return g;
    }catch(_){return groups[key]||null;}
  }
  function refresh(){
    renderCurrent();
    const obj=currentForm();
    if(seqInfo(obj)&&keyOf(obj))syncFromServer(obj);
  }

  function inject(){
    const single=$('single');if(!single||$('v55InboundProgressCard'))return;
    const card=document.createElement('div');
    card.className='card';card.id='v55InboundProgressCard';
    card.innerHTML=`
      <p class="step-title" style="margin-bottom:10px">입고 진행현황 <span style="font-weight:400;color:var(--muted);font-size:.75rem">(WMS 기준)</span></p>
      <div id="v55ipTitle" style="font-weight:700;font-size:.95rem">WMS 라벨을 인식하면 자동으로 표시됩니다.</div>
      <div id="v55ipMeta" style="font-size:.75rem;color:var(--muted);margin-top:3px"></div>
      <div class="kpis" style="margin-top:12px">
        <div class="kpi"><small>현재 순번</small><b id="v55ipSeq">–</b></div>
        <div class="kpi"><small>확인 완료</small><b id="v55ipDone">–</b></div>
        <div class="kpi"><small>남은 Pallet</small><b id="v55ipRemain">–</b></div>
      </div>
      <div id="v55ipStatus" class="status">관리번호와 WMS 순번을 자동 추적합니다.</div>
    `;
    const first=single.querySelector('.card');
    single.insertBefore(card,first||single.firstChild);

    ['inboundNo','itemCode','product','containerFrom','containerTo'].forEach(id=>{
      const el=$(id);if(el)el.addEventListener('input',refresh);
    });
    refresh();
  }

  function renderCurrent(){
    if(!$('v55InboundProgressCard'))return;
    const obj=currentForm(),seq=seqInfo(obj),key=keyOf(obj);
    const g=(key&&groups[key])||(!key?latestGroup():null);
    const displayProduct=obj.product||(g&&g.product)||'WMS 라벨을 인식하면 자동으로 표시됩니다.';
    const displayNo=obj.inboundNo||(g&&g.managementNo)||'';
    const displayItem=obj.itemCode||(g&&g.itemCode)||'';
    $('v55ipTitle').textContent=displayProduct;
    $('v55ipMeta').textContent=displayNo?
      ('관리번호(WMS 입고번호) '+displayNo+(displayItem?' · 품목코드 '+displayItem:'')):'';
    $('v55ipSeq').textContent=seq?(seq.current+' / '+seq.total):(g&&g.lastSeq&&g.total?(g.lastSeq+' / '+g.total):'–');
    if(g&&g.total){
      const done=(g.done||[]).length, remain=Math.max(0,g.total-done);
      $('v55ipDone').textContent=done+' / '+g.total;
      $('v55ipRemain').textContent=remain;
      const miss=missingOf(g);
      const preview=miss.slice(0,8).map(x=>pad(x)).join(', ');
      const more=miss.length>8?' 외 '+(miss.length-8)+'개':'';
      const dup=seq&&g.done.includes(seq.current);
      setStatus('v55ipStatus',
        dup?'⚠ 이미 확인된 순번 '+seq.currentText:
        (remain===0?'관리번호 '+g.managementNo+' · 전체 Pallet 확인 완료':
          '미확인 순번 '+(preview||'-')+more),
        dup?'bad':(remain===0?'ok':''));
    }else{
      $('v55ipDone').textContent='–';$('v55ipRemain').textContent='–';
      const missingRange=!!(displayNo&&!seq);
      setStatus('v55ipStatus',seq?
        ('순번 '+seq.currentText+' / '+seq.totalText+' · 저장하면 진행률에 반영됩니다.'):
        (missingRange
          ? '⚠ 관리번호는 인식됨 · 현재/전체 Pallet 순번 재인식 필요'
          : 'WMS 라벨의 순번 정보가 확인되면 자동으로 진행률을 시작합니다.'),
        missingRange?'bad':'');
    }
  }

  window.V55InboundProgress={
    VERSION:'V55-WMS-INBOUND-PROGRESS-1',
    seqInfo,keyOf,validateBeforeSave,onSingleSaved,isDuplicate,missingOf,syncFromServer,refresh,
    get groups(){return JSON.parse(JSON.stringify(groups));},
    reset(){groups={};persist();},
    _test:{seqInfo,keyOf,missingOf,latestGroup,itemSeq}
  };

  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',inject,{once:true});else inject();
})();