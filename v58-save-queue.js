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
    VERSION:'V58-SAVE-QUEUE-1.4',
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

  Q.retryAll=async function(){
    // Capability may have been checked before V24 login finished. Re-check at
    // the moment the operator requests retry so a newly deployed backend is
    // recognized without reloading the page.
    if(!Q.canAutoRetry()){
      try{await Q.detectCapabilities();}catch(_){}
    }
    if(!Q.canAutoRetry())return {ok:false,message:'운영 서버의 중복저장 방지 패치가 아직 활성화되지 않아 자동 재전송을 잠가두었습니다.'};
    const owner=currentOwner();
    if(!owner.key)return {ok:false,message:'로그인 작업자를 확인할 수 없어 미전송 저장을 재전송하지 않습니다.'};
    const all=await Q.listAll(),rows=all.filter(row=>belongsToCurrent(row,owner));
    const foreign=all.length-rows.length;
    let ok=0,failed=0;
    for(const row of rows){
      try{
        if(!row.ownerKey){
          row.ownerKey=owner.key;row.ownerName=owner.name;row.updatedAt=Date.now();
          await tx('readwrite',s=>s.put(row));
        }
        await Q.markSending(row.requestId);
        const res=await apiPost('saveSingle',row.payload);
        if(res&&res.ok){await Q.confirm(row.requestId,res);ok++;}
        else{await Q.markPending(row.requestId,res&&res.message||'서버 저장 실패');failed++;}
      }catch(e){await Q.markPending(row.requestId,String(e&&e.message?e.message:e));failed++;}
    }
    Q.renderStatus();
    return {ok:failed===0,saved:ok,failed,foreign,
      message:foreign?('다른 작업자 또는 소유자 확인이 필요한 미전송 저장 '+foreign+'건은 재전송하지 않았습니다.'):''
    };
  };

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
        if(Q.canAutoRetry())Q.retryAll().catch(()=>{});
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
