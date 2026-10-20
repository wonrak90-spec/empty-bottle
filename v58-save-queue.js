/* V58 Save Queue
 * Durable client-side staging for single-pallet saves.
 * Safety rule: automatic retry stays OFF until the production GAS
 * idempotency patch is deployed and CONFIG.V58_IDEMPOTENCY === true.
 */
(function(){
  'use strict';
  if(window.V58SaveQueue)return;

  const DB_NAME='empty-bottle-v58';
  const DB_VERSION=1;
  const STORE='saveQueue';
  const Q=window.V58SaveQueue={
    VERSION:'V58-SAVE-QUEUE-1.5-R14.1',
    autoRetryEnabled:false,
    serverCapabilities:{},
    lastError:''
  };

  function uuid(){
    try{
      if(crypto&&typeof crypto.randomUUID==='function')return crypto.randomUUID();
    }catch(_){}
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g,c=>{
      const r=Math.random()*16|0,v=c==='x'?r:(r&0x3|0x8);return v.toString(16);
    });
  }

  function currentOwner(){
    try{
      const u=window.V24&&V24.session&&V24.session.user||null;
      if(!u)return {key:'',name:''};
      return {key:String(u.userId||u.employeeNo||'').trim(),name:String(u.name||'').replace(/\s+/g,'').trim()};
    }catch(_){return {key:'',name:''};}
  }
  function inspectorName(row){
    try{return String(row&&row.payload&&row.payload.inspector||'').replace(/\s+/g,'').trim();}catch(_){return '';}
  }
  function belongsToCurrent(row,owner){
    owner=owner||currentOwner();
    if(!owner.key)return false;
    if(row&&row.ownerKey)return String(row.ownerKey)===owner.key;
    return !!(owner.name&&inspectorName(row)&&owner.name===inspectorName(row));
  }

  Q.makeRequestId=function(payload){
    const p=payload||{};
    const base=[
      String(p.inboundNo||'NOINBOUND').replace(/\s+/g,''),
      'P'+String(p.containerFrom||'NOPALLET').replace(/\s+/g,''),
      Date.now(),
      uuid()
    ];
    return 'V58-'+base.join('-');
  };

  function openDb(){
    return new Promise((resolve,reject)=>{
      if(!('indexedDB' in window))return reject(new Error('이 기기는 로컬 저장소(IndexedDB)를 지원하지 않습니다.'));
      const req=indexedDB.open(DB_NAME,DB_VERSION);
      req.onupgradeneeded=()=>{
        const db=req.result;
        if(!db.objectStoreNames.contains(STORE)){
          const s=db.createObjectStore(STORE,{keyPath:'requestId'});
          s.createIndex('status','status',{unique:false});
          s.createIndex('createdAt','createdAt',{unique:false});
        }
      };
      req.onsuccess=()=>resolve(req.result);
      req.onerror=()=>reject(req.error||new Error('로컬 저장소 열기 실패'));
    });
  }

  async function tx(mode,fn){
    const db=await openDb();
    return await new Promise((resolve,reject)=>{
      const t=db.transaction(STORE,mode),s=t.objectStore(STORE);
      let result;
      try{result=fn(s,t);}catch(e){db.close();reject(e);return;}
      t.oncomplete=()=>{db.close();resolve(result);};
      t.onerror=()=>{const e=t.error||new Error('로컬 Queue 처리 실패');db.close();reject(e);};
      t.onabort=()=>{const e=t.error||new Error('로컬 Queue 처리 중단');db.close();reject(e);};
    });
  }

  Q.stage=async function(payload){
    const p=JSON.parse(JSON.stringify(payload||{}));
    if(!p.requestId)p.requestId=Q.makeRequestId(p);
    const owner=currentOwner();
    if(!owner.key)throw new Error('로그인 작업자를 확인할 수 없어 안전 Queue 저장을 중단했습니다.');
    const row={
      requestId:p.requestId,
      ownerKey:owner.key,
      ownerName:owner.name,
      payload:p,
      status:'pending',
      createdAt:Date.now(),
      updatedAt:Date.now(),
      attempts:0,
      lastMessage:'서버 전송 대기'
    };
    await tx('readwrite',s=>s.put(row));
    Q.renderStatus();
    return row;
  };

  Q.markSending=async function(requestId){
    if(!requestId)return;
    const row=await Q.get(requestId);if(!row)return;
    row.status='sending';row.updatedAt=Date.now();row.attempts=(row.attempts||0)+1;
    await tx('readwrite',s=>s.put(row));
    Q.renderStatus();
  };

  Q.markPending=async function(requestId,message){
    if(!requestId)return;
    const row=await Q.get(requestId);if(!row)return;
    row.status='pending';row.updatedAt=Date.now();row.lastMessage=String(message||'재전송 대기');
    await tx('readwrite',s=>s.put(row));
    Q.renderStatus();
  };

  Q.confirm=async function(requestId,res){
    if(!requestId)return;
    await tx('readwrite',s=>s.delete(requestId));
    Q.renderStatus();
    return res;
  };

  Q.get=async function(requestId){
    const db=await openDb();
    return await new Promise((resolve,reject)=>{
      const t=db.transaction(STORE,'readonly'),s=t.objectStore(STORE),r=s.get(requestId);
      r.onsuccess=()=>resolve(r.result||null);
      r.onerror=()=>reject(r.error||new Error('Queue 조회 실패'));
      t.oncomplete=()=>db.close();
    });
  };

  Q.listAll=async function(){
    const db=await openDb();
    return await new Promise((resolve,reject)=>{
      const t=db.transaction(STORE,'readonly'),s=t.objectStore(STORE),r=s.getAll();
      r.onsuccess=()=>resolve((r.result||[]).sort((a,b)=>a.createdAt-b.createdAt));
      r.onerror=()=>reject(r.error||new Error('Queue 조회 실패'));
      t.oncomplete=()=>db.close();
    });
  };
  Q.list=async function(){
    const owner=currentOwner(),rows=await Q.listAll();
    return rows.filter(row=>belongsToCurrent(row,owner));
  };
  Q.count=async function(){ return (await Q.list()).length; };
  Q.countForeign=async function(){
    const owner=currentOwner(),rows=await Q.listAll();
    return rows.filter(row=>!belongsToCurrent(row,owner)).length;
  };

  Q.detectCapabilities=async function(){
    try{
      if(typeof apiGet!=='function')return Q.serverCapabilities;
      const res=await apiGet('backendCapabilities',{});
      if(res&&res.ok)Q.serverCapabilities=res;
    }catch(_){}
    return Q.serverCapabilities;
  };

  Q.canAutoRetry=function(){
    try{
      if(typeof CONFIG!=='undefined'&&CONFIG.V58_IDEMPOTENCY===true)return true;
      return !!(Q.serverCapabilities&&Q.serverCapabilities.idempotency===true);
    }catch(_){return false;}
  };

  // R14.1: 차량 12~14 Pallet 연속 작업용 단일 전송 Worker.
  // 한 번의 실패가 발생해도 새 Pallet 저장 버튼은 로컬 Queue 적재만 수행하고 계속 진행한다.
  // 실패 때마다 Queue 전체를 다시 훑어 재전송하던 R13 구조를 제거해 요청 폭주를 막는다.
  Q._workerPromise=null;
  Q._kickRequested=false;
  Q._retryTimer=null;
  Q._failStreak=0;
  Q._nextRetryAt=0;

  function backoffMs(streak){
    const table=[0,2000,5000,12000,30000,60000];
    return table[Math.min(Math.max(1,Number(streak)||1),table.length-1)];
  }

  async function ownedRows(){
    const owner=currentOwner();
    if(!owner.key)return {owner,rows:[],foreign:0};
    const all=await Q.listAll();
    return {
      owner,
      rows:all.filter(row=>belongsToCurrent(row,owner)),
      foreign:all.filter(row=>!belongsToCurrent(row,owner)).length
    };
  }

  async function sendOldestOne(){
    if(!Q.canAutoRetry()){
      try{await Q.detectCapabilities();}catch(_){}
    }
    if(!Q.canAutoRetry())
      return {ok:false,paused:true,message:'운영 서버의 중복저장 방지 기능 확인 전이라 서버 전송만 대기합니다.'};

    const bag=await ownedRows(),owner=bag.owner;
    if(!owner.key)
      return {ok:false,paused:true,message:'로그인 작업자를 확인할 수 없어 서버 전송만 대기합니다.'};

    // sending 상태는 브라우저 중단 후 남을 수 있으므로 pending과 동일하게 재확인한다.
    const rows=bag.rows.filter(row=>row&&row.status!=='blocked');
    if(!rows.length)return {ok:true,empty:true,foreign:bag.foreign};

    const row=rows[0];
    try{
      if(!row.ownerKey){
        row.ownerKey=owner.key;row.ownerName=owner.name;row.updatedAt=Date.now();
        await tx('readwrite',s=>s.put(row));
      }
      await Q.markSending(row.requestId);
      const res=await apiPost('saveSingle',row.payload);
      if(res&&res.ok){
        await Q.confirm(row.requestId,res);
        Q._failStreak=0;Q._nextRetryAt=0;
        return {ok:true,saved:1,requestId:row.requestId,foreign:bag.foreign};
      }
      await Q.markPending(row.requestId,res&&res.message||'서버 저장 실패');
      Q._failStreak=Math.min(10,(Q._failStreak||0)+1);
      const delay=backoffMs(Q._failStreak);
      Q._nextRetryAt=Date.now()+delay;
      Q.lastError=String(res&&res.message||'서버 저장 실패');
      return {ok:false,failed:1,retryInMs:delay,message:Q.lastError,requestId:row.requestId};
    }catch(e){
      try{await Q.markPending(row.requestId,String(e&&e.message?e.message:e));}catch(_){}
      Q._failStreak=Math.min(10,(Q._failStreak||0)+1);
      const delay=backoffMs(Q._failStreak);
      Q._nextRetryAt=Date.now()+delay;
      Q.lastError=String(e&&e.message?e.message:e);
      return {ok:false,failed:1,retryInMs:delay,message:Q.lastError,requestId:row.requestId};
    }
  }

  function scheduleRetry(){
    const wait=Math.max(250,(Q._nextRetryAt||0)-Date.now());
    if(Q._retryTimer)return;
    Q._retryTimer=setTimeout(()=>{
      Q._retryTimer=null;
      Q.kick().catch(()=>{});
    },wait);
  }

  Q.kick=function(force){
    Q._kickRequested=true;
    if(Q._workerPromise)return Q._workerPromise;

    if(!force && Q._nextRetryAt && Date.now()<Q._nextRetryAt){
      scheduleRetry();
      return Promise.resolve({ok:false,paused:true,retryInMs:Q._nextRetryAt-Date.now(),message:Q.lastError||'재전송 대기'});
    }
    if(force){Q._nextRetryAt=0;Q._failStreak=0;if(Q._retryTimer){clearTimeout(Q._retryTimer);Q._retryTimer=null;}}

    Q._workerPromise=(async()=>{
      let saved=0,last={ok:true};
      // 한 Worker만 존재하며 매 반복마다 Queue를 다시 읽는다.
      // 따라서 작업자가 P7/P8을 계속 적재해도 중복 Worker가 생기지 않는다.
      for(let guard=0;guard<100;guard++){
        Q._kickRequested=false;
        if(!force && Q._nextRetryAt && Date.now()<Q._nextRetryAt){scheduleRetry();break;}
        last=await sendOldestOne();
        if(last&&last.saved)saved+=last.saved;
        if(!last||last.empty)break;
        if(last.ok===false){
          if(last.retryInMs)scheduleRetry();
          break;
        }
        // 성공 시 즉시 다음 가장 오래된 Pallet 한 건만 이어서 처리한다.
        // 새 stage()가 동시에 들어와도 다음 loop에서 자연스럽게 포함된다.
      }
      try{Q.renderStatus();}catch(_){}
      return Object.assign({},last||{},{saved});
    })().finally(()=>{
      Q._workerPromise=null;
      // Worker가 종료되는 찰나 새 Pallet이 들어온 race를 놓치지 않는다.
      if(Q._kickRequested){
        if(Q._nextRetryAt&&Date.now()<Q._nextRetryAt)scheduleRetry();
        else setTimeout(()=>Q.kick().catch(()=>{}),0);
      }
    });
    return Q._workerPromise;
  };

  // 화면의 "미전송 저장 재전송"은 backoff를 한 번 해제하고 Worker를 다시 시작한다.
  Q.retryAll=async function(){
    return await Q.kick(true);
  };

  Q._test=Object.assign(Q._test||{},{backoffMs});


  Q.renderStatus=async function(){
    const el=document.getElementById('v58QueueStatus');if(!el)return;
    try{
      const n=await Q.count(),foreign=await Q.countForeign();
      el.textContent=n?('내 미전송 저장 '+n+'건'):(foreign?('확인필요 미전송 '+foreign+'건'):'저장 대기 0건');
      el.className='v58-state '+((n||foreign)?'warn':'ok');
    }catch(_){
      el.textContent='저장 대기 확인 불가';el.className='v58-state warn';
    }
  };

  function bindNetwork(){
    window.addEventListener('online',()=>{
      Q.renderStatus();
      setTimeout(async()=>{
        try{await Q.detectCapabilities();}catch(_){}
        if(Q.canAutoRetry())Q.kick().catch(()=>{});
      },500);
    });
    window.addEventListener('offline',Q.renderStatus);
  }

  bindNetwork();
  setTimeout(async()=>{
    try{await Q.detectCapabilities();}catch(_){}
    Q.renderStatus();
  },500);
})();
