/* V56 Production Collaboration UI
 * One user creates a production job; other users join the same Production ID.
 * Requires V56_PRODUCTION_COLLAB.gs routes when deployed.
 * Existing production save APIs remain the source of truth.
 */
(function(){
  'use strict';
  if(window.__V56_PRODUCTION_COLLAB__)return;
  window.__V56_PRODUCTION_COLLAB__=true;

  const C=window.V56ProductionCollab={
    VERSION:'V56-PROD-COLLAB-1',
    items:[],
    poll:null,
    backendReady:null
  };
  const $=id=>document.getElementById(id);
  const esc=s=>String(s==null?'':s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const fmt=v=>{const n=Number(String(v==null?'':v).replace(/,/g,''));return Number.isFinite(n)?n.toLocaleString('ko-KR'):'0';};

  function user(){
    try{return V24&&V24.session&&V24.session.user||null;}catch(_){return null;}
  }
  function workerName(){
    const u=user();return u&&u.name?String(u.name):'';
  }
  function normalize(items){
    return (Array.isArray(items)?items:[]).map(x=>({
      productionId:String(x.productionId||x.id||''),
      productName:String(x.productName||''),
      lotNo:String(x.lotNo||''),
      status:String(x.status||'ACTIVE').toUpperCase(),
      createdAt:String(x.createdAt||''),
      updatedAt:String(x.updatedAt||''),
      creator:String(x.creator||''),
      workers:Array.isArray(x.workers)?x.workers.map(String):[],
      palletCount:Number(x.palletCount)||0,
      total:Number(String(x.total||0).replace(/,/g,''))||0
    })).filter(x=>x.productionId&&x.status==='ACTIVE')
      .sort((a,b)=>String(b.updatedAt).localeCompare(String(a.updatedAt)));
  }
  C.normalize=normalize;

  function inject(){
    const prod=$('prod'),setup=$('prodSetupCard');
    if(!prod||!setup||$('v56ActiveProdCard'))return;
    const card=document.createElement('div');
    card.id='v56ActiveProdCard';card.className='card';
    card.innerHTML=
      '<div style="display:flex;justify-content:space-between;align-items:center;gap:8px">'+
        '<p class="step-title" style="margin:0">현재 진행 중인 생산작업</p>'+
        '<button id="v56RefreshProd" type="button" class="btn ghost" style="width:auto;padding:6px 10px">새로고침</button>'+
      '</div>'+
      '<div id="v56ActiveProdStatus" class="status">진행 중 작업을 확인하는 중...</div>'+
      '<div id="v56ActiveProdList"></div>'+
      '<button id="v56NewProdBtn" type="button" class="btn outline">＋ 새 생산 작업 생성</button>';
    prod.insertBefore(card,setup);
    $('v56RefreshProd').onclick=()=>C.load(true);
    $('v56NewProdBtn').onclick=()=>C.showCreate(true);
  }

  C.showCreate=function(flag){
    const setup=$('prodSetupCard');if(!setup)return;
    setup.style.display=flag?'block':'none';
    if(flag){
      const p=$('prodProductName');if(p)setTimeout(()=>p.focus(),0);
    }
  };

  function currentSessionId(){
    try{return typeof prodSession!=='undefined'&&prodSession&&prodSession.id?String(prodSession.id):'';}catch(_){return '';}
  }

  function render(){
    const box=$('v56ActiveProdList'),st=$('v56ActiveProdStatus');
    if(!box||!st)return;
    const active=C.items;
    const current=currentSessionId();

    if(C.backendReady===false){
      st.textContent='공동작업 목록 기능은 테스트 준비 완료 · 운영 백엔드 연결 전입니다.';
      st.className='status warn';box.innerHTML='';
      C.showCreate(true);return;
    }
    if(!active.length){
      st.textContent='현재 진행 중인 생산작업이 없습니다. 새 작업을 생성하세요.';
      st.className='status';box.innerHTML='';
      C.showCreate(true);return;
    }

    st.textContent='진행 중 '+active.length+'건 · 작업을 선택하면 제품/제조번호를 다시 입력하지 않고 참여합니다.';
    st.className='status ok';
    box.innerHTML=active.map(x=>{
      const joined=x.workers.includes(workerName());
      const mine=current===x.productionId;
      const workers=x.workers.length?x.workers.join(', '):x.creator||'-';
      return '<div class="result-item" style="margin-top:8px">'+
        '<div style="flex:1;min-width:0">'+
          '<div><b>'+esc(x.productName||'-')+'</b> · 제조번호 <b>'+esc(x.lotNo||'-')+'</b></div>'+
          '<div class="meta">Pallet '+x.palletCount+' · '+fmt(x.total)+' EA · 참여 '+esc(workers)+(x.updatedAt?' · 최근 '+esc(x.updatedAt):'')+'</div>'+
        '</div>'+
        (mine?'<span class="tag-ok">작업 중</span>':
          '<button type="button" class="btn '+(joined?'outline':'primary')+'" style="width:auto;padding:7px 12px" data-join-prod="'+esc(x.productionId)+'">'+(joined?'다시 참여':'참여')+'</button>')+
      '</div>';
    }).join('');
    box.querySelectorAll('[data-join-prod]').forEach(b=>{
      b.onclick=()=>C.join(b.getAttribute('data-join-prod'));
    });
    if(!current)C.showCreate(false);
  }

  C.load=async function(force){
    inject();
    try{
      const res=await apiGet('productionCollabList',{});
      if(!res||!res.ok){
        C.backendReady=false;C.items=[];render();return;
      }
      C.backendReady=true;C.items=normalize(res.items);render();
    }catch(_){
      C.backendReady=false;C.items=[];render();
    }
  };

  async function syncJoinedSession(){
    try{
      if(typeof syncProdSession==='function')await syncProdSession();
      else{
        const id=currentSessionId();if(!id)return;
        const res=await apiGet('productionSession',{id});
        if(res&&res.ok&&Array.isArray(res.pallets)){
          prodSelectedPallets=res.pallets;
          if(typeof renderProdSelected==='function')renderProdSelected();
        }
      }
    }catch(_){}
  }

  C.join=async function(productionId){
    const x=C.items.find(z=>z.productionId===String(productionId));
    if(!x)return;
    const worker=workerName();
    if(!worker){alert('로그인 사용자 정보를 확인할 수 없습니다.');return;}
    try{
      const res=await apiPost('productionCollabJoin',{productionId:x.productionId});
      if(!res||!res.ok){alert((res&&res.message)||'공동작업 참여에 실패했습니다.');return;}

      // 같은 실제 Production ID를 그대로 사용한다.
      prodSession={id:x.productionId,productName:x.productName,lotNo:x.lotNo,worker};
      prodSelectedPallets=[];
      if($('prodProductName'))$('prodProductName').value=x.productName;
      if($('prodLotNo'))$('prodLotNo').value=x.lotNo;
      if($('prodRegistrant'))$('prodRegistrant').value=worker;
      if($('prodSetupCard'))$('prodSetupCard').classList.add('hidden');
      if($('prodSetupCard'))$('prodSetupCard').style.display='none';
      if($('prodRunCard'))$('prodRunCard').classList.remove('hidden');
      if($('runProduct'))$('runProduct').textContent=x.productName;
      if($('runLot'))$('runLot').textContent=x.lotNo;
      if(typeof renderProdSelected==='function')renderProdSelected();
      if(typeof setStatus==='function'){
        setStatus('prodSearchStatus','공동 작업 참여 완료 · WMS 라벨을 스캔하세요.','ok');
        setStatus('saveProdStatus','같은 제품/제조번호 작업자와 동일한 Pallet 목록을 공유합니다.','');
      }
      await syncJoinedSession();
      await C.load(true);
    }catch(e){alert('공동작업 참여 실패: '+(e.message||e));}
  };

  C.openCurrent=async function(){
    const id=currentSessionId();if(!id||C.backendReady===false)return;
    try{
      await apiPost('productionCollabOpen',{
        productionId:id,
        productName:(prodSession&&prodSession.productName)||($('prodProductName')&&$('prodProductName').value)||'',
        lotNo:(prodSession&&prodSession.lotNo)||($('prodLotNo')&&$('prodLotNo').value)||''
      });
      await C.load(true);
    }catch(_){}
  };

  C.touch=async function(){
    const id=currentSessionId();if(!id||C.backendReady===false)return;
    try{
      await apiPost('productionCollabTouch',{productionId:id});
      await C.load(false);
    }catch(_){}
  };

  C.closeCurrent=async function(id){
    id=String(id||'');if(!id||C.backendReady===false)return;
    try{await apiPost('productionCollabClose',{productionId:id});}catch(_){}
    await C.load(true);
  };

  function patchProduction(){
    if(typeof window.startProductionSession==='function'&&!window.startProductionSession.__v56collab){
      const prev=window.startProductionSession;
      const fn=async function(){
        const before=currentSessionId();
        const out=await prev.apply(this,arguments);
        const after=currentSessionId();
        if(after&&after!==before)await C.openCurrent();
        return out;
      };
      fn.__v56collab=true;window.startProductionSession=fn;
    }

    if(typeof window.addProdPallet==='function'&&!window.addProdPallet.__v56collab){
      const prev=window.addProdPallet;
      const fn=async function(){
        const before=(typeof prodSelectedPallets!=='undefined'&&prodSelectedPallets)?prodSelectedPallets.length:0;
        const out=await prev.apply(this,arguments);
        const after=(typeof prodSelectedPallets!=='undefined'&&prodSelectedPallets)?prodSelectedPallets.length:0;
        if(after>=before)await C.touch();
        return out;
      };
      fn.__v56collab=true;window.addProdPallet=fn;
    }

    if(typeof window.finishProductionSession==='function'&&!window.finishProductionSession.__v56collab){
      const prev=window.finishProductionSession;
      const fn=async function(){
        const id=currentSessionId();
        const out=await prev.apply(this,arguments);
        if(id&&!currentSessionId())await C.closeCurrent(id);
        return out;
      };
      fn.__v56collab=true;window.finishProductionSession=fn;
    }

    if(typeof window.showTab==='function'&&!window.showTab.__v56collab){
      const prev=window.showTab;
      const fn=function(tab){
        const out=prev.apply(this,arguments);
        if(tab==='prod')setTimeout(()=>C.load(false),0);
        return out;
      };
      fn.__v56collab=true;window.showTab=fn;
    }
  }

  function startPoll(){
    if(C.poll)clearInterval(C.poll);
    C.poll=setInterval(()=>{
      try{
        const prod=$('prod');
        if(prod&&prod.classList.contains('active')){
          C.load(false);
          // 목록에서 직접 참여한 작업자는 V22의 기존 poll을 거치지 않을 수 있으므로
          // 같은 Production ID의 Pallet 목록도 주기적으로 다시 동기화한다.
          if(currentSessionId()&&!(window.V22&&V22.prodPoll))syncJoinedSession();
        }
      }catch(_){}
    },5000);
  }

  function boot(){
    if(!window.V22||!window.V24||typeof window.startProductionSession!=='function'){setTimeout(boot,120);return;}
    inject();patchProduction();C.load(false);startPoll();
    console.info('[V56-PROD-COLLAB-1] active job list + join workflow ready');
  }

  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',boot,{once:true});else boot();
})();