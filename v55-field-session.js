/* V55 Field Session V1
 * Development/field-validation layer only.
 * Tracks a vehicle receipt while existing single-pallet OCR/save remains unchanged.
 */
(function(){
  'use strict';
  if(window.__V55_FIELD_SESSION__)return;
  window.__V55_FIELD_SESSION__=true;

  const KEY='v55_field_session_v1';
  const now=()=>Date.now();
  const num=v=>Math.max(0,Math.trunc(Number(v)||0));
  const esc=s=>String(s==null?'':s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const empty=()=>({
    active:false,id:'',startedAt:0,endedAt:0,
    expectedPallets:0,preprintedWms:0,actualPallets:0,
    completed:0,ok:0,review:0,manual:0,
    records:[],discardedLabels:0
  });

  function load(){
    try{
      const x=JSON.parse(localStorage.getItem(KEY)||'null');
      return x&&typeof x==='object'?Object.assign(empty(),x):empty();
    }catch(_){return empty();}
  }
  let state=load();

  function save(){try{localStorage.setItem(KEY,JSON.stringify(state));}catch(_){} render();}
  function remainingLabels(s=state){return Math.max(0,num(s.preprintedWms)-num(s.completed)-num(s.discardedLabels));}
  function palletGap(s=state){return num(s.actualPallets)-num(s.completed);}
  function labelBalance(s=state){return num(s.preprintedWms)-num(s.completed)-num(s.discardedLabels);}
  function canClose(s=state){
    if(!s.active)return {ok:false,message:'진행 중인 차량 Session이 없습니다.'};
    if(num(s.actualPallets)<=0)return {ok:false,message:'실제 Pallet 수량을 먼저 입력하세요.'};
    if(num(s.completed)!==num(s.actualPallets))return {ok:false,message:'실제 Pallet '+s.actualPallets+'개 중 '+s.completed+'개만 처리되었습니다.'};
    if(labelBalance(s)!==0)return {ok:false,message:'WMS 라벨 정산이 맞지 않습니다. 남은/폐기 라벨을 확인하세요.'};
    return {ok:true,message:'정상 종료 가능'};
  }

  function set(id,v){const el=document.getElementById(id);if(el)el.textContent=String(v);}
  function value(id){const el=document.getElementById(id);return el?el.value:'';}

  function inject(){
    const panel=document.getElementById('single');
    if(!panel||document.getElementById('v55FieldSessionCard'))return;
    const card=document.createElement('div');
    card.className='card';
    card.id='v55FieldSessionCard';
    card.innerHTML=`
      <div style="display:flex;justify-content:space-between;align-items:center;gap:8px">
        <p class="step-title" style="margin:0">차량 입고 Session <span style="font-weight:400;color:var(--muted);font-size:.75rem">(현장 검증)</span></p>
        <span id="v55fsBadge" style="font-size:.72rem;font-weight:700;color:var(--muted)">대기</span>
      </div>
      <div class="row2" style="margin-top:12px">
        <div class="field"><label>WMS 선출력 라벨 수</label><input id="v55fsPrinted" inputmode="numeric" placeholder="예: 12"></div>
        <div class="field"><label>예상 Pallet 수</label><input id="v55fsExpected" inputmode="numeric" placeholder="예: 12"></div>
      </div>
      <div class="field"><label>차량 입고 후 실제 Pallet 수</label><input id="v55fsActual" inputmode="numeric" placeholder="수량 확인 후 입력"></div>
      <div style="display:flex;gap:8px;flex-wrap:wrap">
        <button class="btn primary" style="flex:1" id="v55fsStart">Session 시작</button>
        <button class="btn outline" style="flex:1" id="v55fsClose">Session 종료</button>
      </div>
      <div class="kpis" style="margin-top:12px">
        <div class="kpi"><small>완료</small><b id="v55fsDone">0</b></div>
        <div class="kpi"><small>남은 Pallet</small><b id="v55fsRemain">0</b></div>
        <div class="kpi"><small>남은 WMS</small><b id="v55fsLabels">0</b></div>
      </div>
      <div class="kpis">
        <div class="kpi"><small>정상</small><b id="v55fsOk">0</b></div>
        <div class="kpi"><small>검토대기</small><b id="v55fsReview">0</b></div>
        <div class="kpi"><small>수기수정</small><b id="v55fsManual">0</b></div>
      </div>
      <div class="field">
        <label>미사용/폐기 WMS 라벨</label>
        <input id="v55fsDiscard" inputmode="numeric" value="0">
      </div>
      <div id="v55fsStatus" class="status">WMS 라벨 선출력 수량을 입력하고 차량 Session을 시작하세요.</div>
    `;
    panel.insertBefore(card,panel.firstChild);

    document.getElementById('v55fsStart').onclick=()=>{
      const printed=num(value('v55fsPrinted')), expected=num(value('v55fsExpected'));
      if(!printed){setStatus('v55fsStatus','WMS 선출력 라벨 수를 입력하세요.','bad');return;}
      state=empty();
      state.active=true;
      state.id='VEH-'+new Date().toISOString().replace(/[-:TZ.]/g,'').slice(0,14);
      state.startedAt=now();
      state.preprintedWms=printed;
      state.expectedPallets=expected||printed;
      state.actualPallets=num(value('v55fsActual'));
      save();
      setStatus('v55fsStatus','Session 시작 · 실제 Pallet 수 확인 후 단건 검수를 연속 진행하세요.','ok');
    };
    document.getElementById('v55fsActual').oninput=()=>{if(state.active){state.actualPallets=num(value('v55fsActual'));save();}};
    document.getElementById('v55fsDiscard').oninput=()=>{if(state.active){state.discardedLabels=num(value('v55fsDiscard'));save();}};
    document.getElementById('v55fsClose').onclick=()=>{
      if(state.active){
        state.actualPallets=num(value('v55fsActual'))||state.actualPallets;
        state.discardedLabels=num(value('v55fsDiscard'));
      }
      const c=canClose(state);
      if(!c.ok){setStatus('v55fsStatus',c.message,'bad');save();return;}
      state.active=false;state.endedAt=now();save();
      setStatus('v55fsStatus','차량 Session 종료 완료 · Pallet/WMS 라벨 정산 일치','ok');
    };
    render();
  }

  function render(){
    if(!document.getElementById('v55FieldSessionCard'))return;
    const actual=num(state.actualPallets),done=num(state.completed);
    const remain=Math.max(0,(actual||num(state.expectedPallets))-done);
    set('v55fsDone',done);set('v55fsRemain',remain);set('v55fsLabels',remainingLabels());
    set('v55fsOk',state.ok);set('v55fsReview',state.review);set('v55fsManual',state.manual);
    const badge=document.getElementById('v55fsBadge');
    if(badge)badge.textContent=state.active?'진행 중 '+done+'/'+(actual||state.expectedPallets||'?'):(state.endedAt?'종료':'대기');
    const a=document.getElementById('v55fsActual');if(a&&document.activeElement!==a&&state.actualPallets)a.value=state.actualPallets;
    const p=document.getElementById('v55fsPrinted');if(p&&document.activeElement!==p&&state.preprintedWms)p.value=state.preprintedWms;
    const e=document.getElementById('v55fsExpected');if(e&&document.activeElement!==e&&state.expectedPallets)e.value=state.expectedPallets;
    const d=document.getElementById('v55fsDiscard');if(d&&document.activeElement!==d)d.value=state.discardedLabels||0;
  }

  function onSingleSaved(payload,res){
    if(!state.active)return;
    const started=now();
    const result=String(payload&&payload.finalResult||'');
    const labelMatch=String(payload&&payload.labelMatch||'');
    const review=result!=='적합'||labelMatch==='불일치';
    state.completed++;
    if(review)state.review++;else state.ok++;
    state.records.push({
      seq:state.completed,
      recordId:res&&res.id||'',
      inboundNo:payload&&payload.inboundNo||'',
      containerFrom:payload&&payload.containerFrom||'',
      vendorPalletNo:payload&&payload.vendorPalletNo||'',
      finalResult:result,
      labelMatch,
      savedAt:started
    });
    save();
    const target=state.actualPallets||state.expectedPallets||state.preprintedWms;
    setStatus('v55fsStatus','Pallet '+state.completed+'/'+target+' 저장 · 다음 Pallet 진행','ok');
  }

  function markManual(){if(!state.active)return;state.manual++;save();}

  window.V55FieldSession={
    VERSION:'V55-FIELD-SESSION-1',
    get state(){return JSON.parse(JSON.stringify(state));},
    remainingLabels,palletGap,labelBalance,canClose,onSingleSaved,markManual,
    reset(){state=empty();save();},
    _test:{empty,remainingLabels,palletGap,labelBalance,canClose}
  };

  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',inject,{once:true});else inject();
})();