/* V56 Operations usability patch
 * Separate from OCR Learning Store.
 * Goals:
 * 1) Never leave stale admin-edit values visible after search/detail/tab changes.
 * 2) Keep production backend behavior, but simplify the operator-facing workflow.
 */
(function(){
  'use strict';
  if(window.__V56_OPERATIONS__)return;
  window.__V56_OPERATIONS__=true;

  const O=window.V56Operations={
    VERSION:'V56-OPERATIONS-1',
    patched:false
  };
  const $=id=>document.getElementById(id);

  function currentUserName(){
    try{
      const u=window.V24&&V24.session&&V24.session.user;
      return u&&u.name?String(u.name):'';
    }catch(_){return '';}
  }

  function resetEditState(clearRecord){
    const card=$('v22EditCard');
    if(card)card.classList.add('hidden');
    const fields=$('v22EditFields');
    if(fields)fields.innerHTML='';
    const reason=$('v22EditReason');
    if(reason)reason.value='';
    const status=$('v22EditStatus');
    if(status){status.textContent='';status.className='status';}
    const actor=$('v22EditActor');
    if(actor){
      const n=currentUserName();
      if(n)actor.value=n;
    }
    if(clearRecord){
      try{currentViewRecord=null;}catch(_){}
      const detail=$('viewDetailCard');
      if(detail)detail.classList.add('hidden');
    }
  }
  O.resetEditState=resetEditState;
  O.cancelEdit=()=>resetEditState(false);

  function patchEditCancel(){
    const card=$('v22EditCard');if(!card)return;
    const buttons=card.querySelectorAll?Array.from(card.querySelectorAll('button')):[];
    const cancel=buttons.find(b=>/취소/.test(String(b.textContent||'')));
    if(cancel){
      cancel.removeAttribute('onclick');
      cancel.onclick=O.cancelEdit;
    }
  }

  function patchViewState(){
    if(window.V24&&typeof V24.loadRecords==='function'&&!V24.loadRecords.__v56){
      const prev=V24.loadRecords.bind(V24);
      const fn=async function(page){
        resetEditState(true);
        return prev(page);
      };
      fn.__v56=true;
      V24.loadRecords=fn;
    }

    if(typeof window.openRecordDetail==='function'&&!window.openRecordDetail.__v56){
      const prev=window.openRecordDetail;
      const fn=async function(){
        resetEditState(false);
        return prev.apply(this,arguments);
      };
      fn.__v56=true;
      window.openRecordDetail=fn;
    }

    if(typeof window.showTab==='function'&&!window.showTab.__v56){
      const prev=window.showTab;
      const fn=function(tab){
        if(tab!=='view')resetEditState(true);
        else resetEditState(false);
        return prev.apply(this,arguments);
      };
      fn.__v56=true;
      window.showTab=fn;
    }

    patchEditCancel();
  }

  function hideLoggedInWorkerField(){
    const reg=$('prodRegistrant');if(!reg)return;
    const n=currentUserName();
    const field=reg.closest&&reg.closest('.field');
    if(n){
      reg.value=n;
      reg.readOnly=true;
      if(field)field.style.display='none';
    }
  }

  function ensureProductionGuide(){
    const run=$('prodRunCard');if(!run)return;
    const shared=$('v22ProdShared');
    if(shared)shared.style.display='none';

    if(!$('v56ProdGuide')){
      const banner=run.querySelector&&run.querySelector('.run-banner');
      const g=document.createElement('div');
      g.id='v56ProdGuide';
      g.className='status ok';
      g.style.margin='10px 0';
      g.innerHTML='<b>생산 투입</b> · ① WMS 라벨 스캔 → ② 등록 목록 확인 → ③ 작업 완료';
      if(banner&&banner.parentNode)banner.parentNode.insertBefore(g,banner.nextSibling);
      else run.insertBefore(g,run.firstChild||null);
    }

    const auto=$('btnProdWmsAuto');
    if(auto)auto.textContent='🎥 WMS 라벨 스캔';
    const barcode=[...run.querySelectorAll('button')].find(b=>/startProdScan/.test(b.getAttribute('onclick')||''));
    if(barcode)barcode.textContent='📊 바코드 스캔 (보조)';

    const details=[...run.querySelectorAll('details')];
    const search=details.find(d=>/검색으로 추가|검색/.test(String(d.textContent||'')));
    if(search){
      const summary=search.querySelector('summary');
      if(summary)summary.textContent='직접 검색 · 스캔이 안 될 때만 사용';
    }

    const finish=[...run.querySelectorAll('button')].find(b=>/finishProductionSession/.test(b.getAttribute('onclick')||''));
    if(finish)finish.textContent='✓ 작업 완료';
  }

  function simplifyProductionStatus(){
    ensureProductionGuide();
    hideLoggedInWorkerField();
    const lot=$('prodLotNo');
    const runLot=$('runLot');
    if(runLot&&lot&&lot.value)runLot.textContent=lot.value;
    const st=$('saveProdStatus');
    if(st&&typeof prodSession!=='undefined'&&prodSession){
      st.textContent='스캔한 파레트는 기존 입고 검수기록과 자동 연결되어 저장됩니다.';
      st.className='status';
    }
  }

  function patchProduction(){
    hideLoggedInWorkerField();
    ensureProductionGuide();

    if(typeof window.startProductionSession==='function'&&!window.startProductionSession.__v56){
      const prev=window.startProductionSession;
      const fn=async function(){
        const out=await prev.apply(this,arguments);
        simplifyProductionStatus();
        return out;
      };
      fn.__v56=true;
      window.startProductionSession=fn;
    }

    if(typeof window.finishProductionSession==='function'&&!window.finishProductionSession.__v56){
      const prev=window.finishProductionSession;
      const fn=async function(){
        const out=await prev.apply(this,arguments);
        setTimeout(()=>{hideLoggedInWorkerField();ensureProductionGuide();},0);
        return out;
      };
      fn.__v56=true;
      window.finishProductionSession=fn;
    }
  }

  function boot(){
    if(O.patched)return;
    if(!window.V22||!window.V24){setTimeout(boot,100);return;}
    O.patched=true;
    patchViewState();
    patchProduction();
    setTimeout(()=>{patchEditCancel();ensureProductionGuide();hideLoggedInWorkerField();},500);
    console.info('[V56-OPERATIONS-1] view-state reset + production simplified');
  }

  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',boot,{once:true});
  else boot();
})();