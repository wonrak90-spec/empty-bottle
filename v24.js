/* 공병 입고 확인 V22.3 안정화 패치
 * - 정적 API 토큰 제거 / 6시간 세션 인증
 * - 조회 목록 페이지네이션
 * - 보고서 상태 초기화 + 증빙사진 선택 출력
 * - 조회/보고 가독성 개선
 * - 관리자 삭제 재설계 UI
 *
 * 기존 app.js / v22.js 핵심 업무 로직은 수정하지 않고 뒤에서 필요한 함수만 확장/재정의합니다.
 */
(function(){
  'use strict';

  const V24 = window.V24 = {
    VERSION:'V22.4',
    page:1,pageSize:30,total:0,totalPages:1,keyword:'',listLoaded:false,
    session:null,adminSession:null,authPromise:null,authResolve:null,authReject:null,
    reportItems:null,reportKind:'',reportPhotoData:new Map(),
    backendInfo:null
  };
  const $=id=>document.getElementById(id);
  const esc=s=>String(s==null?'':s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const fmt=v=>{const n=Number(String(v==null?'':v).replace(/,/g,''));return Number.isFinite(n)&&String(v).trim()!==''?n.toLocaleString():String(v==null?'':v)};
  const STORE='emptyBottle.v24.session';

  /* ==================== V22.4 개인계정 인증 ==================== */
  function loadStored(key){try{const x=JSON.parse(localStorage.getItem(key)||'null');if(x&&x.session&&Number(x.expiresAt)>Date.now()+5000)return x;}catch(_){ }try{localStorage.removeItem(key);}catch(_){ }return null;}
  function saveStored(key,x){try{localStorage.setItem(key,JSON.stringify(x));}catch(_){} }
  function clearStored(key){try{localStorage.removeItem(key);}catch(_){} }
  async function rawJson(url,opts){const r=await fetch(url,opts);const t=await r.text();try{return JSON.parse(t);}catch(_){throw new Error('서버 응답을 해석할 수 없습니다. Apps Script 배포 URL을 확인하세요.');}}
  async function publicGet(action,params){const qs=new URLSearchParams(Object.assign({action},params||{}));return rawJson(CONFIG.API_URL+'?'+qs.toString());}
  async function publicPost(action,payload){return rawJson(CONFIG.API_URL,{method:'POST',headers:{'Content-Type':'text/plain;charset=utf-8'},body:JSON.stringify({action,payload:payload||{}})});}
  async function postWithSession(action,payload,session){return rawJson(CONFIG.API_URL,{method:'POST',headers:{'Content-Type':'text/plain;charset=utf-8'},body:JSON.stringify({action,payload:payload||{},session:session||''})});}

  function injectAuthUi(){
    if($('v24AuthOverlay'))return;
    const el=document.createElement('div');el.id='v24AuthOverlay';el.className='v23-auth hidden';
    el.innerHTML=`<div class="v23-auth-card"><div class="v23-auth-title">공병 입고 확인</div><div class="v23-auth-sub">개인계정 로그인</div>
      <div class="field"><label>사번</label><input id="v24EmployeeNo" autocomplete="username" placeholder="사번을 입력하세요"></div>
      <div class="field"><label>개인 PIN</label><input id="v24Pin" type="password" inputmode="numeric" maxlength="6" autocomplete="current-password" placeholder="숫자 6자리"></div>
      <button id="v24AuthBtn" class="btn primary">로그인</button><div id="v24AuthStatus" class="status">개인별 계정으로 작업자와 Audit 이력을 구분합니다.</div>
      <div class="v23-auth-version" id="v24AuthVersion">Frontend ${V24.VERSION}</div></div>`;
    document.body.appendChild(el);$('v24AuthBtn').onclick=loginFromModal;$('v24Pin').addEventListener('keydown',e=>{if(e.key==='Enter')loginFromModal();});
  }
  function showAuth(message){injectAuthUi();$('v24AuthOverlay').classList.remove('hidden');if(message)$('v24AuthStatus').textContent=message;setTimeout(()=>$('v24EmployeeNo').focus(),50);}
  function hideAuth(){if($('v24AuthOverlay'))$('v24AuthOverlay').classList.add('hidden');}
  function userLabel(){const u=V24.session&&V24.session.user;return u?`${u.name} (${u.employeeNo})`:'';}
  function applyIdentity(){
    const u=V24.session&&V24.session.user;if(!u)return;
    try{localStorage.setItem('gongbyeong_inspector',u.name||'');}catch(_){}
    ['inspector','mInspector','prodRegistrant'].forEach(id=>{const el=$(id);if(el){el.value=u.name||'';el.readOnly=true;el.title='로그인 사용자 자동입력';}});
    const actor=$('v22EditActor');if(actor){actor.value=userLabel();actor.readOnly=true;const f=actor.closest('.field');if(f)f.classList.add('v24-auto-actor');}
    injectAccountBar();renderAccountBar();applyPermissions();
  }
  function finishAuth(session){V24.session=session;saveStored(STORE,session);hideAuth();applyIdentity();if(V24.authResolve){V24.authResolve(session);V24.authResolve=null;V24.authReject=null;V24.authPromise=null;}setTimeout(()=>{try{if(typeof loadDashboard==='function')loadDashboard();}catch(_){}},50);}
  async function loginFromModal(){
    const employeeNo=$('v24EmployeeNo').value.trim(),pin=$('v24Pin').value.trim();if(!employeeNo||!/^[0-9]{6}$/.test(pin)){$('v24AuthStatus').textContent='사번과 숫자 6자리 PIN을 입력하세요.';return;}
    $('v24AuthBtn').disabled=true;$('v24AuthStatus').textContent='로그인 중...';
    try{const res=await publicPost('authLogin',{employeeNo,pin});if(!res.ok){$('v24AuthStatus').textContent=res.message||'로그인 실패';return;}$('v24Pin').value='';finishAuth({session:res.session,expiresAt:res.expiresAt,user:res.user,role:(res.user&&res.user.role)||'worker'});}catch(e){$('v24AuthStatus').textContent='로그인 실패: '+e.message;}finally{$('v24AuthBtn').disabled=false;}
  }
  async function ensureSession(){if(!V24.session)V24.session=loadStored(STORE);if(V24.session&&Number(V24.session.expiresAt)>Date.now()+5000){applyIdentity();return V24.session;}V24.session=null;clearStored(STORE);if(!V24.authPromise){V24.authPromise=new Promise((resolve,reject)=>{V24.authResolve=resolve;V24.authReject=reject;});showAuth('로그인이 필요합니다.');}return V24.authPromise;}
  function authExpired(message){V24.session=null;clearStored(STORE);renderAccountBar();showAuth(message||'로그인 세션이 만료되었습니다. 다시 로그인하세요.');}
  window.apiGet=async function(action,params){const sess=await ensureSession();const qs=new URLSearchParams(Object.assign({action,session:sess.session},params||{}));const res=await rawJson(CONFIG.API_URL+'?'+qs.toString());if(res&&(res.code==='AUTH_REQUIRED'||res.code==='USER_DISABLED')){authExpired(res.message);throw new Error(res.message||'인증 필요');}if(res&&res.code==='ADMIN_REQUIRED')throw new Error(res.message||'관리자 권한 필요');return res;};
  window.apiPost=async function(action,payload){const sess=await ensureSession();const res=await postWithSession(action,payload,sess.session);if(res&&(res.code==='AUTH_REQUIRED'||res.code==='USER_DISABLED')){authExpired(res.message);throw new Error(res.message||'인증 필요');}return res;};
  async function ensureAdminSession(){const s=await ensureSession();if(s&&s.user&&s.user.role==='admin')return s;alert('관리자 계정으로 로그인해야 사용할 수 있는 기능입니다.');return null;}
  async function logout(){const s=V24.session;try{if(s)await postWithSession('authLogout',{},s.session);}catch(_){}V24.session=null;clearStored(STORE);renderAccountBar();showAuth('로그아웃되었습니다.');}
  V24.logout=logout;
  async function bootstrapSecurity(){
    injectAuthUi();try{const info=await publicGet('securityInfo');V24.backendInfo=info;if($('v24AuthVersion'))$('v24AuthVersion').textContent=`Frontend ${V24.VERSION} · Backend ${info.backendVersion||'?'} · DB ${info.schemaVersion||'?'}`;if(!info.securityEnabled||info.authMode!=='individual'){showAuth('Apps Script에서 setupSecurityV24()를 1회 실행해야 합니다.');$('v24AuthBtn').disabled=true;return;}V24.session=loadStored(STORE);if(!V24.session){showAuth();return;}const qs=new URLSearchParams({action:'whoami',session:V24.session.session});const me=await rawJson(CONFIG.API_URL+'?'+qs.toString());if(!me.ok){authExpired(me.message);return;}V24.session.user=me.user;V24.session.role=me.user.role;V24.session.expiresAt=me.expiresAt||V24.session.expiresAt;saveStored(STORE,V24.session);hideAuth();applyIdentity();}catch(e){showAuth('백엔드 연결 확인 실패: '+e.message);}
  }

  function injectAccountBar(){
    if($('v24AccountBar'))return;const header=document.querySelector('header');if(!header)return;const bar=document.createElement('div');bar.id='v24AccountBar';bar.className='v24-account-bar';const nav=header.querySelector('nav.tabs');header.insertBefore(bar,nav||null);
  }
  function renderAccountBar(){const bar=$('v24AccountBar');if(!bar)return;const u=V24.session&&V24.session.user;if(!u){bar.innerHTML='';bar.classList.add('hidden');return;}bar.classList.remove('hidden');bar.innerHTML=`<div><b>${esc(u.name)}</b><span>${esc(u.employeeNo)} · ${u.role==='admin'?'관리자':'작업자'}</span></div><div class="v24-account-actions">${u.role==='admin'?'<button onclick="V24.openUsers()">사용자 관리</button>':''}<button onclick="V24.changeMyPin()">PIN 변경</button><button onclick="V24.logout()">로그아웃</button></div>`;}
  function applyPermissions(){const admin=!!(V24.session&&V24.session.user&&V24.session.user.role==='admin');['btnEditCurrent','btnDeleteCurrent'].forEach(id=>{const el=$(id);if(el)el.classList.toggle('hidden',!admin);});const actor=$('v22EditActor');if(actor){actor.value=userLabel();actor.readOnly=true;}}

  function injectUserModal(){
    if($('v24UserModal'))return;const el=document.createElement('div');el.id='v24UserModal';el.className='v24-modal hidden';el.innerHTML=`<div class="v24-modal-card"><div class="v24-modal-head"><b>사용자 관리</b><button onclick="V24.closeUsers()">×</button></div><div class="v24-user-create"><div class="field"><label>사번</label><input id="v24NewEmp"></div><div class="field"><label>이름</label><input id="v24NewName"></div><div class="field"><label>부서</label><input id="v24NewDept" value="자재지원팀"></div><div class="field"><label>권한</label><select id="v24NewRole"><option value="worker">작업자</option><option value="admin">관리자</option></select></div><div class="field"><label>초기 PIN (선택)</label><input id="v24NewPin" inputmode="numeric" maxlength="6" placeholder="공란이면 자동 생성"></div><button class="btn primary" onclick="V24.createUser()">계정 추가</button></div><div id="v24UserStatus" class="status">-</div><div id="v24UserList" class="v24-user-list"></div></div>`;document.body.appendChild(el);
  }
  V24.openUsers=async function(){const a=await ensureAdminSession();if(!a)return;injectUserModal();$('v24UserModal').classList.remove('hidden');await V24.loadUsers();};
  V24.closeUsers=function(){if($('v24UserModal'))$('v24UserModal').classList.add('hidden');};
  V24.loadUsers=async function(){try{const res=await apiPost('listUsers',{});if(!res.ok)throw new Error(res.message);$('v24UserList').innerHTML=(res.items||[]).map(u=>`<div class="v24-user-card"><div><b>${esc(u.name)}</b><span>${esc(u.employeeNo)} · ${esc(u.department||'-')}</span><small>${u.role==='admin'?'관리자':'작업자'} · ${u.status==='ACTIVE'?'사용중':'사용중지'} · 최근 ${esc(u.lastLogin||'-')}</small></div><div><button onclick="V24.resetUserPin('${esc(u.userId)}','${esc(u.name)}')">PIN 초기화</button><button onclick="V24.toggleUser('${esc(u.userId)}','${u.status==='ACTIVE'?'INACTIVE':'ACTIVE'}','${esc(u.name)}')">${u.status==='ACTIVE'?'사용중지':'활성화'}</button><button onclick="V24.toggleRole('${esc(u.userId)}','${u.role==='admin'?'worker':'admin'}','${esc(u.name)}')">${u.role==='admin'?'작업자로':'관리자로'}</button></div></div>`).join('')||'<div class="status">사용자가 없습니다.</div>';}catch(e){$('v24UserStatus').textContent='목록 실패: '+e.message;}};
  V24.createUser=async function(){const p={employeeNo:$('v24NewEmp').value.trim(),name:$('v24NewName').value.trim(),department:$('v24NewDept').value.trim(),role:$('v24NewRole').value,pin:$('v24NewPin').value.trim()};try{const res=await apiPost('createUser',p);if(!res.ok)throw new Error(res.message);alert(`계정 생성 완료\n사번: ${p.employeeNo.toUpperCase()}\n초기 PIN: ${res.tempPin}\n\nPIN은 해당 작업자에게 직접 전달하세요.`);$('v24NewEmp').value='';$('v24NewName').value='';$('v24NewPin').value='';await V24.loadUsers();}catch(e){alert('계정 생성 실패: '+e.message);}};
  V24.resetUserPin=async function(id,name){if(!confirm(`${name} 사용자의 PIN을 초기화할까요?\n기존 로그인 세션은 종료됩니다.`))return;const res=await apiPost('resetUserPin',{userId:id});if(!res.ok){alert(res.message);return;}alert(`${name} 새 PIN: ${res.tempPin}\n\n한 번만 표시되므로 안전하게 전달하세요.`);await V24.loadUsers();};
  V24.toggleUser=async function(id,status,name){if(!confirm(`${name} 계정을 ${status==='ACTIVE'?'활성화':'사용중지'}할까요?`))return;const res=await apiPost('updateUser',{userId:id,status});if(!res.ok){alert(res.message);return;}await V24.loadUsers();};
  V24.toggleRole=async function(id,role,name){if(!confirm(`${name} 권한을 ${role==='admin'?'관리자':'작업자'}로 변경할까요?`))return;const res=await apiPost('updateUser',{userId:id,role});if(!res.ok){alert(res.message);return;}await V24.loadUsers();};
  V24.changeMyPin=async function(){const oldPin=prompt('현재 PIN 6자리를 입력하세요.','');if(oldPin===null)return;const newPin=prompt('새 PIN 6자리를 입력하세요.','');if(newPin===null)return;if(!/^\d{6}$/.test(newPin)){alert('새 PIN은 숫자 6자리여야 합니다.');return;}const again=prompt('새 PIN을 한 번 더 입력하세요.','');if(again!==newPin){alert('새 PIN이 일치하지 않습니다.');return;}const res=await apiPost('changeMyPin',{oldPin,newPin});if(!res.ok){alert(res.message);return;}alert('PIN이 변경되었습니다. 다시 로그인하세요.');await logout();};

  /* ==================== 조회 목록 / 페이지 ==================== */
  function resetReportState(){
    V24.reportItems=null;V24.reportKind='';V24.reportPhotoData.clear();
    if(window.V22){V22.reportData=null;V22.reportKind='';}
    const f=$('v22ReportFields');if(f)f.innerHTML='';
    const c=$('v22ReportBuilder');if(c)c.classList.add('hidden');
  }
  V24.resetReportState=resetReportState;

  function updateSelectedCount(){
    const el=$('v23SelectedCount');if(el&&window.V22)el.textContent=`선택 ${V22.selectedIds.size}건`;
  }
  function injectListControls(){
    const results=$('viewSearchResults');if(!results||$('v23ListControls'))return;
    const card=results.parentNode;
    const ctl=document.createElement('div');ctl.id='v23ListControls';ctl.className='v23-list-controls';
    ctl.innerHTML=`<div class="v23-list-left"><button class="btn outline" onclick="V24.loadRecords(1)">최근 등록 목록</button><span id="v23ListSummary">-</span><span id="v23SelectedCount">선택 0건</span></div>
      <div class="v23-list-right"><label>표시</label><select id="v23PageSize"><option>10</option><option selected>30</option><option>50</option><option>100</option></select><span>건/페이지</span></div>`;
    const status=$('viewSearchStatus');status.parentNode.insertBefore(ctl,status.nextSibling);
    const pager=document.createElement('div');pager.id='v23Pager';pager.className='v23-pager';results.parentNode.insertBefore(pager,results.nextSibling);
    $('v23PageSize').onchange=()=>{V24.pageSize=Number($('v23PageSize').value)||30;V24.loadRecords(1);};
    const input=$('viewSearchKw');if(input){input.placeholder='입고번호 / 품명 / 품목코드 / 공급업체 / 검수자 (공란이면 전체)';}
  }
  function pageButtons(){
    const p=V24.page,t=V24.totalPages,arr=[];for(let n=Math.max(1,p-2);n<=Math.min(t,p+2);n++)arr.push(n);
    return `<button ${p<=1?'disabled':''} onclick="V24.loadRecords(${p-1})">‹ 이전</button>${arr.map(n=>`<button class="${n===p?'active':''}" onclick="V24.loadRecords(${n})">${n}</button>`).join('')}<button ${p>=t?'disabled':''} onclick="V24.loadRecords(${p+1})">다음 ›</button>`;
  }
  function resultChip(v){const s=String(v||'');const cls=/적합|일치|없음/.test(s)?'ok':(/확인|불일치|있음/.test(s)?'warn':'neutral');return `<span class="v23-chip ${cls}">${esc(s||'-')}</span>`;}
  function renderRecordRows(items){
    return items.map((it,i)=>{
      const checked=window.V22&&V22.selectedIds.has(String(it.id));
      return `<div class="v23-record-row">
        <input class="v22-record-check" type="checkbox" value="${esc(it.id)}" ${checked?'checked':''} onchange="V22.toggleResult(this.value,this.checked)">
        <div class="v23-record-main" onclick="openRecordDetail(${i})">
          <div class="v23-record-top"><b>${esc(it.product||'-')}</b>${resultChip(it.finalResult)}<span class="v23-date">${esc(it.regDate||'')}</span></div>
          <div class="v23-record-grid"><div><span>WMS</span><b>${esc(it.inboundNo||'-')}</b><small>${esc(it.itemCode||'-')} · P.No ${esc(it.wmsPalletNo||it.containerFrom||it.containerNo||'-')}</small></div>
          <div><span>업체</span><b>${esc(it.vendorProduct||'-')}</b><small>Lot ${esc(it.vendorLotNo||'-')} · P.No ${esc(it.vendorPalletNo||'-')}</small></div>
          <div><span>수량</span><b>${esc(fmt(it.qty!=null?it.qty:it.displayQty))} ${esc(it.unit||'')}</b><small>${esc(it.supplier||'-')}</small></div>
          <div><span>검수</span><b>${esc(it.inspector||'-')}</b><small>라벨대조 ${esc(it.labelMatch||'-')}</small></div></div>
        </div><button class="go" onclick="openRecordDetail(${i})">›</button></div>`;
    }).join('');
  }
  V24.loadRecords=async function(page){
    injectListControls();resetReportState();V24.page=Math.max(1,Number(page)||1);V24.pageSize=Number($('v23PageSize')&&$('v23PageSize').value)||V24.pageSize||30;V24.keyword=($('viewSearchKw')&&$('viewSearchKw').value||'').trim();
    if($('viewDetailCard'))$('viewDetailCard').classList.add('hidden');
    if(typeof setStatus==='function')setStatus('viewSearchStatus','등록 목록을 불러오는 중...','warn');
    try{
      let res=null, usedFallback=false;
      try{res=await apiGet('listRecords',{keyword:V24.keyword,page:V24.page,pageSize:V24.pageSize});}catch(_){res=null;}
      if(!res||!res.ok){
        if(!V24.keyword)throw new Error((res&&res.message)||'최근 목록 API를 사용할 수 없습니다. 검색어를 입력해 조회하세요.');
        const legacy=await apiGet('searchRecords',{keyword:V24.keyword});
        if(!legacy||!legacy.ok)throw new Error((legacy&&legacy.message)||(res&&res.message)||'조회 실패');
        const all=legacy.items||[],start=(V24.page-1)*V24.pageSize;
        res={ok:true,page:V24.page,pageSize:V24.pageSize,total:all.length,totalPages:Math.max(1,Math.ceil(all.length/V24.pageSize)),items:all.slice(start,start+V24.pageSize)};
        usedFallback=true;
      }
      V24.page=Math.max(1,Number(res.page)||1);V24.pageSize=Number(res.pageSize)||V24.pageSize;V24.total=Number(res.total)||0;V24.totalPages=Math.max(1,Number(res.totalPages)||1);V24.listLoaded=true;
      if(V24.page>V24.totalPages&&V24.total>0)return V24.loadRecords(V24.totalPages);
      viewSearchResultsList=Array.isArray(res.items)?res.items:[];
      const box=$('viewSearchResults');box.innerHTML=viewSearchResultsList.length?renderRecordRows(viewSearchResultsList):'<div class="status">조회된 기록이 없습니다.</div>';
      const tools=$('v22ViewTools');if(tools)tools.classList.toggle('hidden',!viewSearchResultsList.length);
      if($('v23ListSummary'))$('v23ListSummary').textContent=`총 ${Number(V24.total).toLocaleString()}건 · ${V24.page}/${V24.totalPages}페이지`;
      if($('v23Pager'))$('v23Pager').innerHTML=V24.total?pageButtons():'';
      updateSelectedCount();
      if(typeof setStatus==='function'){
        const label=V24.keyword?`“${V24.keyword}” 검색 ${V24.total}건`:`최근 등록순 ${V24.total}건`;
        setStatus('viewSearchStatus',label+(usedFallback?' · 호환 조회모드':''),V24.total?'ok':'');
      }
    }catch(e){
      viewSearchResultsList=[];
      const box=$('viewSearchResults');if(box)box.innerHTML='';
      const tools=$('v22ViewTools');if(tools)tools.classList.add('hidden');
      if($('v23Pager'))$('v23Pager').innerHTML='';
      if(typeof setStatus==='function')setStatus('viewSearchStatus','조회 실패: '+(e.message||e),'bad');
    }
  };
  window.searchViewRecords=function(){return V24.loadRecords(1);};

  function patchSelection(){
    if(!window.V22)return;
    V22.toggleResult=function(id,checked){if(checked)V22.selectedIds.add(String(id));else V22.selectedIds.delete(String(id));resetReportState();updateSelectedCount();};
    V22.toggleAll=function(flag){
      if(!flag)V22.selectedIds.clear();
      document.querySelectorAll('.v22-record-check').forEach(ch=>{ch.checked=flag;if(flag)V22.selectedIds.add(ch.value);});
      resetReportState();updateSelectedCount();
    };
  }

  function enhanceDetail(){
    if(!currentViewRecord||!currentViewRecord.record)return;const r=currentViewRecord.record,box=$('viewDetailBox');if(!box||$('v23DetailSummary'))return;
    const d=document.createElement('div');d.id='v23DetailSummary';d.className='v23-detail-summary';
    d.innerHTML=`<div class="v23-detail-head"><b>${esc(r.product||'-')}</b>${resultChip(r.finalResult)}<span>${esc(r.regDate||'')}</span></div>
      <div class="v23-detail-grid"><section><h4>WMS 입고정보</h4><p><b>입고번호</b>${esc(r.inboundNo||'-')}</p><p><b>품목코드</b>${esc(r.itemCode||'-')}</p><p><b>WMS P.No</b>${esc([r.containerFrom,r.containerTo].filter(Boolean).join(' ~ ')||'-')}</p><p><b>수량</b>${esc(fmt(r.displayQty))} ${esc(r.unit||'')}</p></section>
      <section><h4>업체 라벨</h4><p><b>품명</b>${esc(r.vendorProduct||'-')}</p><p><b>Lot</b>${esc(r.vendorLotNo||'-')}</p><p><b>업체 P.No</b>${esc(r.vendorPalletNo||'-')}</p><p><b>수량</b>${esc(fmt(r.vendorQty))}</p></section>
      <section><h4>검수 판정</h4><p><b>정보</b>${esc(r.infoMatch||'-')}</p><p><b>라벨</b>${esc(r.labelMatch||'-')}</p><p><b>혼입</b>${esc(r.mixed||'-')}</p><p><b>검수자</b>${esc(r.inspector||'-')}</p></section></div>`;
    box.insertBefore(d,box.firstChild);
  }
  function patchDetail(){
    const old=window.openRecordDetail;if(typeof old!=='function'||old.__v23)return;
    const fn=async function(i){resetReportState();const out=await old(i);setTimeout(()=>{enhanceDetail();applyPermissions();},0);return out;};fn.__v23=true;window.openRecordDetail=fn;
  }

  /* ==================== 보고서 V24 ==================== */
  function selectedIds(){const ids=window.V22?Array.from(V22.selectedIds):[];if(ids.length)return ids;if(currentViewRecord&&currentViewRecord.record)return [String(currentViewRecord.record.id)];return [];}
  async function batchRecords(ids){
    const target=(ids||[]).slice(0,100);if(!target.length)return [];
    try{const res=await apiPost('batchGetRecords',{ids:target});if(res&&res.ok&&Array.isArray(res.items))return res.items;}catch(_){}
    const items=[];
    for(const id of target){
      try{const one=await apiGet('getRecord',{id});if(one&&one.ok&&one.record)items.push({record:one.record,pallets:one.pallets||[]});}catch(_){}
    }
    if(!items.length)throw new Error('선택 기록을 불러오지 못했습니다.');
    return items;
  }
  function photoRefs(items,opt){
    const refs=[],seen=new Set();const add=(url,label,type,record)=>{String(url||'').split(',').map(x=>x.trim()).filter(Boolean).forEach(u=>{if(!seen.has(u)){seen.add(u);refs.push({url:u,label,type,record});}});};
    items.forEach(it=>{const r=it.record;if(opt.wms)add(r.labelPhotoUrl,'WMS 입고라벨','wms',r);if(opt.vendor)add(r.vendorPhotoUrl,'업체 라벨','vendor',r);if(opt.item)add(r.itemPhotoUrl,'공병 실물','item',r);(it.pallets||[]).forEach((p,i)=>{if(opt.wms)add(p.wmsPhotoUrl,`P${i+1} WMS`, 'wms',r);if(opt.vendor)add(p.vendorPhotoUrl,`P${i+1} 업체`, 'vendor',r);});});return refs;
  }
  async function loadPhotoData(refs){
    const map=new Map(),errors={};
    for(let i=0;i<refs.length;i+=6){
      const part=refs.slice(i,i+6),urls=part.map(x=>x.url);let res=null;
      try{res=await apiPost('photoDataBatchV24',{urls});}catch(_){res=null;}
      if(!res||(!res.ok&&!res.items)){
        try{res=await apiPost('photoDataBatch',{urls});}catch(e){res={ok:false,message:String(e&&e.message?e.message:e)};}
      }
      if(res&&res.items)Object.keys(res.items).forEach(u=>{if(res.items[u])map.set(u,res.items[u]);});
      if(res&&res.errors)Object.assign(errors,res.errors);
      for(const u of urls){if(!map.has(u)&&!(u in errors))errors[u]=(res&&res.message)||'사진 불러오기 실패';}
    }
    return {map,errors};
  }
  function reportCounts(items){const recs=items.map(x=>x.record),issue=recs.filter(r=>!/적합/.test(String(r.finalResult||''))).length;return {n:recs.length,issue,inbound:new Set(recs.map(r=>String(r.inboundNo||'')).filter(Boolean)).size,products:new Set(recs.map(r=>String(r.product||'')).filter(Boolean)).size};}
  function clearBuilder(){const f=$('v22ReportFields');if(f)f.innerHTML='';const t=$('v22ReportTitle');if(t)t.textContent='보고서 작성';const b=$('v22ReportBadge');if(b)b.textContent='';}
  function photoOptionsHtml(counts){return `<div class="v23-photo-options"><b>증빙사진 출력</b><label><input id="v23PhotoWms" type="checkbox" checked> WMS 라벨 (${counts.wms})</label><label><input id="v23PhotoVendor" type="checkbox" checked> 업체 라벨 (${counts.vendor})</label><label><input id="v23PhotoItem" type="checkbox"> 실물사진 (${counts.item})</label><small>선택한 종류만 보고서에 첨부됩니다.</small></div>`;}
  function countPhotos(items){let wms=0,vendor=0,item=0;items.forEach(it=>{const r=it.record;if(r.labelPhotoUrl)wms+=String(r.labelPhotoUrl).split(',').filter(Boolean).length;if(r.vendorPhotoUrl)vendor+=String(r.vendorPhotoUrl).split(',').filter(Boolean).length;if(r.itemPhotoUrl)item+=String(r.itemPhotoUrl).split(',').filter(Boolean).length;(it.pallets||[]).forEach(p=>{if(p.wmsPhotoUrl)wms++;if(p.vendorPhotoUrl)vendor++;});});return {wms,vendor,item};}
  function buildReportForm(kind,items){
    clearBuilder();const c=reportCounts(items),recs=items.map(x=>x.record),products=[...new Set(recs.map(r=>r.product).filter(Boolean))],inbounds=[...new Set(recs.map(r=>r.inboundNo).filter(Boolean))],dates=recs.map(r=>r.regDate).filter(Boolean).sort(),inspectors=[...new Set(recs.map(r=>r.inspector).filter(Boolean))];
    $('v22ReportTitle').textContent=kind==='executive'?'임원보고서 작성':'이상 조사보고서 작성';$('v22ReportBadge').textContent=kind==='executive'?'1Page Summary':'6하원칙 · 영향평가 · CAPA';
    const box=$('v22ReportFields'), summary=`<div class="v23-builder-summary"><div><small>대상 기록</small><b>${c.n}건</b></div><div><small>입고번호</small><b>${c.inbound}건</b></div><div><small>확인 필요</small><b>${c.issue}건</b></div><div><small>품목</small><b>${c.products}종</b></div></div>`;
    if(kind==='executive'){
      box.innerHTML=summary+`<div class="v23-section-title">보고 요약</div><div class="v22-report-grid"><div class="field span2"><label>목적</label><input id="rPurpose"></div><div class="field span2"><label>결론</label><textarea id="rConclusion"></textarea></div><div class="field"><label>Impact</label><textarea id="rImpact"></textarea></div><div class="field"><label>Risk</label><textarea id="rRisk"></textarea></div><div class="field span2"><label>근본원인 / 확인사항</label><textarea id="rCause"></textarea></div><div class="field span2"><label>재발방지대책 / 후속조치</label><textarea id="rAction"></textarea></div></div>`+photoOptionsHtml(countPhotos(items));
      $('rPurpose').value=`${products.join(', ')||'공병'} 입고 검수 ${c.n}건의 확인 결과 및 생산·재고 영향성을 보고하고자 함.`;
      $('rConclusion').value=`대상 ${c.n}건 / 입고번호 ${c.inbound}건 / 확인 필요 ${c.issue}건. ${c.issue?'확인 필요 건은 대상 라벨·파레트 식별 및 생산 투입 여부 확인이 필요함.':'선택 기록 기준 특이 이상 없음.'}`;
      $('rImpact').value=c.issue?'대상 공병의 재고 범위 및 생산 투입 여부를 확인하여 영향 범위를 확정할 필요가 있음.':'선택 기록 기준 생산 및 재고 영향 확인사항 없음.';
      $('rRisk').value=c.issue?'라벨 식별 오류·혼입·수량 불일치가 미확인 상태로 사용될 경우 오투입 및 추적성 저하 가능.':'현행 입고 검수 및 파레트 식별·추적 관리 유지 필요.';
      $('rCause').value='확인 필요 건의 WMS 라벨, 업체 라벨, 실물 및 생산 투입 이력을 근거로 원인을 확인.';
      $('rAction').value=c.issue?'대상 식별/사용보류 → 라벨·실물 재확인 → 생산 투입 추적 → 필요 시 공급업체 원인조사 및 CAPA 확인':'현행 검수 기준 유지 및 이상 발생 시 동일 절차 적용';
    }else{
      box.innerHTML=summary+`<div class="v23-section-title">1. 6하원칙</div><div class="v22-report-grid"><div class="field span2"><label>조사 제목</label><input id="iTitle"></div><div class="field"><label>언제</label><textarea id="iWhen"></textarea></div><div class="field"><label>어디서</label><textarea id="iWhere"></textarea></div><div class="field"><label>누가</label><textarea id="iWho"></textarea></div><div class="field"><label>무엇을</label><textarea id="iWhat"></textarea></div><div class="field span2"><label>어떻게</label><textarea id="iHow"></textarea></div><div class="field span2"><label>왜 / 조사 가설</label><textarea id="iWhy"></textarea></div></div>
      <div class="v23-section-title">2. 조치·영향·조사</div><div class="v22-report-grid"><div class="field span2"><label>즉시조치 / 격리</label><textarea id="iImmediate"></textarea></div><div class="field"><label>영향 범위</label><textarea id="iScope"></textarea></div><div class="field"><label>품질/생산 영향평가</label><textarea id="iImpact"></textarea></div><div class="field span2"><label>조사 근거 / 증빙</label><textarea id="iEvidence"></textarea></div><div class="field span2"><label>조사결과 / 근본원인</label><textarea id="iRootCause"></textarea></div><div class="field span2"><label>CAPA / 효과확인</label><textarea id="iCapa"></textarea></div></div>`+photoOptionsHtml(countPhotos(items));
      $('iTitle').value=`${products.join(', ')||'공병'} 입고 검수 이상 조사`;$('iWhen').value=dates.length?`${dates[0]}${dates.length>1?' ~ '+dates[dates.length-1]:''}`:'발생/인지 일시 확인 필요';$('iWhere').value='공병 입고검수 구역 / 공병창고 (실제 장소 확인 후 수정)';$('iWho').value=inspectors.length?`검수/발견자: ${inspectors.join(', ')}`:'발견자 및 관련 작업자 확인 필요';$('iWhat').value=`대상 품목: ${products.join(', ')||'-'}\n입고번호: ${inbounds.join(', ')||'-'}\n대상 기록: ${c.n}건`;$('iHow').value='입고 검수 중 WMS 라벨·업체 라벨·실물을 대조하는 과정에서 확인. 상세 발생/발견 경위 입력.';$('iWhy').value='초기 원인 미확정. 라벨 발행/부착, 공급업체 포장·출하, 입고·보관 및 식별 과정의 사실관계 조사 필요.';$('iImmediate').value='대상 공병 식별 및 필요 시 사용보류/격리 → 동일 입고건 확인 → 생산 투입 여부 추적';$('iScope').value=`입고번호 ${inbounds.join(', ')||'-'} / 대상 ${c.n}건. 대상 파레트·수량 및 동일 입고건 범위 확인 필요.`;$('iImpact').value='재고 영향, 생산 투입 여부, 혼입/오투입 가능성 및 추적성 영향 평가 후 최종 판정.';$('iEvidence').value='WMS 입고라벨, 업체 라벨, 공병 실물사진, 검수기록, 파레트 No., 생산 투입 추적기록';$('iRootCause').value='조사 진행 후 사실 및 증빙에 근거하여 확정';$('iCapa').value='근본원인에 따라 공급업체/자재지원/관련부서 조치 수립 및 효과확인 일정 설정';
    }
  }
  V24.closeReport=function(){resetReportState();};
  async function prepareReport(kind){
    resetReportState();const ids=selectedIds();if(!ids.length){alert('보고서에 포함할 기록을 먼저 선택하세요.');return;}
    if(typeof showBusy==='function')showBusy('보고자료를 새로 구성하는 중...');
    try{const items=await batchRecords(ids);V24.reportItems=items;V24.reportKind=kind;if(window.V22){V22.reportData=items;V22.reportKind=kind;}buildReportForm(kind,items);const c=$('v22ReportBuilder');c.classList.remove('hidden');const actions=c.querySelector('.v22-action-row');if(actions)actions.innerHTML=`<button class="btn primary" onclick="V22.printReport()">🖨 보고서 출력</button><button class="btn outline" onclick="V24.closeReport()">닫기</button>`;c.scrollIntoView({behavior:'smooth',block:'start'});}catch(e){alert('보고서 준비 실패: '+e.message);}finally{if(typeof hideBusy==='function')hideBusy();}
  }
  function getVal(id){return esc($(id)&&$(id).value||'');}
  function opt(){return {wms:!!($('v23PhotoWms')&&$('v23PhotoWms').checked),vendor:!!($('v23PhotoVendor')&&$('v23PhotoVendor').checked),item:!!($('v23PhotoItem')&&$('v23PhotoItem').checked)};}
  function reportCss(){return `<style>@page{size:A4;margin:10mm}*{box-sizing:border-box}body{font-family:'Malgun Gothic',sans-serif;color:#111;margin:0;font-size:10px}.sheet{min-height:270mm;page-break-after:always;padding:1mm}.sheet:last-child{page-break-after:auto}h1{font-size:18px;margin:0 0 7px;padding-bottom:6px;border-bottom:2px solid #1f4b5f}h2{font-size:13px;margin:11px 0 5px}.sub{color:#666;margin-bottom:8px}.kpis{display:grid;grid-template-columns:repeat(4,1fr);gap:5px;margin:7px 0}.kpi{border:1px solid #bbb;padding:7px}.kpi small{display:block;color:#666}.kpi b{font-size:16px}.sec{border:1px solid #aaa;margin:7px 0}.row{display:grid;grid-template-columns:28mm 1fr;border-bottom:1px solid #ccc}.row:last-child{border-bottom:0}.row b{background:#f1f0eb;padding:6px}.row div{padding:6px;white-space:pre-wrap}.title{font-size:13px;font-weight:700;margin:10px 0 4px;border-left:4px solid #1f4b5f;padding-left:6px}table{width:100%;border-collapse:collapse;margin:5px 0;font-size:9px}th,td{border:1px solid #aaa;padding:4px;vertical-align:top}th{background:#f1f0eb}.chip{display:inline-block;border:1px solid #aaa;padding:1px 5px;border-radius:9px}.photos{display:grid;grid-template-columns:repeat(2,1fr);gap:6px}.photos figure{margin:0;border:1px solid #bbb;padding:3px;break-inside:avoid}.photos img{width:100%;height:75mm;object-fit:contain}.photos figcaption{text-align:center;font-size:9px}.photo-sheet{page-break-before:always}.warn{border:1px solid #c77;background:#fff4f4;padding:6px;margin:6px 0}.sign{display:flex;justify-content:flex-end;gap:25px;margin-top:16px}.sign div{width:95px;border-top:1px solid #333;text-align:center;padding-top:4px}</style>`;}
  function recordTable(items){return `<table><tr><th>등록일시</th><th>입고번호</th><th>품명/품목코드</th><th>WMS P.No</th><th>업체 P.No / Lot</th><th>수량</th><th>판정</th><th>검수자</th></tr>${items.map(it=>{const r=it.record;return `<tr><td>${esc(r.regDate||'')}</td><td>${esc(r.inboundNo||'')}</td><td><b>${esc(r.product||'')}</b><br>${esc(r.itemCode||'')}</td><td>${esc([r.containerFrom,r.containerTo].filter(Boolean).join(' ~ ')||'')}</td><td>${esc(r.vendorPalletNo||'')}<br>${esc(r.vendorLotNo||'')}</td><td>${esc(fmt(r.displayQty))} ${esc(r.unit||'')}</td><td>${esc(r.finalResult||'')}</td><td>${esc(r.inspector||'')}</td></tr>`;}).join('')}</table>`;}
  function photoFigures(refs,data,max){const arr=[];for(const r of refs){const src=data.get(r.url);if(src)arr.push(`<figure><img src="${src}"><figcaption>${esc(r.label)} · ${esc(r.record.inboundNo||'')} · ${esc(r.record.product||'')}</figcaption></figure>`);if(max&&arr.length>=max)break;}return arr;}
  function executiveHtml(items,refs,data,errors){const c=reportCounts(items),fig=photoFigures(refs,data,2),errN=Object.keys(errors||{}).length;return `<section class="sheet"><h1>공병 입고 검수 임원보고</h1><div class="sub">대상 기록 ${c.n}건 · 입고번호 ${c.inbound}건</div><div class="kpis"><div class="kpi"><small>대상</small><b>${c.n}건</b></div><div class="kpi"><small>입고번호</small><b>${c.inbound}건</b></div><div class="kpi"><small>확인 필요</small><b>${c.issue}건</b></div><div class="kpi"><small>품목</small><b>${c.products}종</b></div></div><div class="sec"><div class="row"><b>목적</b><div>${getVal('rPurpose')}</div></div><div class="row"><b>결론</b><div>${getVal('rConclusion')}</div></div><div class="row"><b>Impact</b><div>${getVal('rImpact')}</div></div><div class="row"><b>Risk</b><div>${getVal('rRisk')}</div></div><div class="row"><b>근본원인</b><div>${getVal('rCause')}</div></div><div class="row"><b>후속조치</b><div>${getVal('rAction')}</div></div></div><div class="title">대상 기록</div>${recordTable(items)}${fig.length?`<div class="title">대표 증빙사진</div><div class="photos">${fig.join('')}</div>`:''}${errN?`<div class="warn">불러오지 못한 사진 ${errN}건</div>`:''}</section>`;}
  function investigationHtml(items,refs,data,errors){const fig=photoFigures(refs,data),errN=Object.keys(errors||{}).length;const main=`<section class="sheet"><h1>공병 입고 이상 조사보고서</h1><div class="sub">일탈 수준 사실조사 · 6하원칙 / 영향평가 / 근본원인 / CAPA</div><div class="title">1. 조사 개요 (6하원칙)</div><table><tr><th>조사 제목</th><td colspan="3">${getVal('iTitle')}</td></tr><tr><th>언제</th><td>${getVal('iWhen')}</td><th>어디서</th><td>${getVal('iWhere')}</td></tr><tr><th>누가</th><td>${getVal('iWho')}</td><th>무엇을</th><td>${getVal('iWhat')}</td></tr></table><div class="sec"><div class="row"><b>어떻게</b><div>${getVal('iHow')}</div></div><div class="row"><b>왜</b><div>${getVal('iWhy')}</div></div></div><div class="title">2. 즉시조치 및 영향 범위</div><div class="sec"><div class="row"><b>즉시조치</b><div>${getVal('iImmediate')}</div></div><div class="row"><b>영향 범위</b><div>${getVal('iScope')}</div></div><div class="row"><b>영향평가</b><div>${getVal('iImpact')}</div></div></div><div class="title">3. 조사 근거 및 결과</div><div class="sec"><div class="row"><b>증빙</b><div>${getVal('iEvidence')}</div></div><div class="row"><b>근본원인</b><div>${getVal('iRootCause')}</div></div><div class="row"><b>CAPA</b><div>${getVal('iCapa')}</div></div></div><div class="sign"><div>조사자</div><div>검토자</div><div>승인자</div></div></section>`;
    const records=`<section class="sheet"><h1>조사 대상 상세</h1>${recordTable(items)}<div class="title">식별 정보</div>${items.map(it=>{const r=it.record;return `<div class="sec"><div class="row"><b>${esc(r.inboundNo||'-')}</b><div>WMS: ${esc(r.product||'-')} / ${esc(r.itemCode||'-')} / P.No ${esc(r.containerFrom||'-')} / ${esc(fmt(r.displayQty))}${esc(r.unit||'')}\n업체: ${esc(r.vendorProduct||'-')} / Lot ${esc(r.vendorLotNo||'-')} / P.No ${esc(r.vendorPalletNo||'-')}\n판정: ${esc(r.finalResult||'-')} / 라벨대조 ${esc(r.labelMatch||'-')} / 혼입 ${esc(r.mixed||'-')}</div></div></div>`;}).join('')}</section>`;
    const photos=fig.length?`<section class="sheet photo-sheet"><h1>증빙사진 별첨</h1>${errN?`<div class="warn">불러오지 못한 사진 ${errN}건</div>`:''}<div class="photos">${fig.join('')}</div></section>`:(errN?`<section class="sheet"><h1>증빙사진 별첨</h1><div class="warn">선택 사진 ${errN}건을 불러오지 못했습니다. Drive 권한/파일 상태를 확인하세요.</div></section>`:'');return main+records+photos;}
  async function printReport(){
    const items=V24.reportItems;if(!items||!items.length){alert('보고서를 다시 선택해서 준비하세요.');return;}
    const w=window.open('','_blank');if(!w){alert('팝업을 허용해주세요.');return;}w.document.write('<p>보고서와 증빙사진을 준비 중입니다...</p>');
    try{const refs=photoRefs(items,opt()),loaded=await loadPhotoData(refs);V24.reportPhotoData=loaded.map;const body=V24.reportKind==='executive'?executiveHtml(items,refs,loaded.map,loaded.errors):investigationHtml(items,refs,loaded.map,loaded.errors);const html=`<!doctype html><html lang="ko"><head><meta charset="utf-8"><title>${V24.reportKind==='executive'?'공병 입고 임원보고':'공병 입고 이상 조사보고서'}</title>${reportCss()}</head><body>${body}<script>window.onload=()=>setTimeout(()=>window.print(),500)<\/script></body></html>`;w.document.open();w.document.write(html);w.document.close();if(refs.length&&!loaded.map.size)alert('선택한 증빙사진을 불러오지 못했습니다. 보고서의 경고 문구와 Drive 파일 상태를 확인하세요.');}catch(e){w.document.body.innerHTML='<pre>'+esc(e.message||e)+'</pre>';}
  }
  function patchReport(){if(!window.V22)return;V22.prepareReport=prepareReport;V22.printReport=printReport;}

  /* ==================== 삭제 V24 ==================== */
  async function deleteCurrent(){
    const r=currentViewRecord&&currentViewRecord.record;if(!r)return;if(String(r.mode||'').indexOf('다중')===0){alert('다중 파레트 기록은 현재 운영 보류 상태이므로 삭제하지 않습니다.');return;}
    if(!confirm('삭제 전 전체 기록이 DeletedRecords와 AuditLog에 보존되고, 연결된 Google Drive 사진은 영구 삭제됩니다.\n생산 투입과 연결된 기록은 삭제되지 않습니다.\n\n계속할까요?'))return;
    const reason=prompt('삭제 사유를 입력하세요. (필수)','오등록');if(reason===null)return;if(!reason.trim()){alert('삭제 사유는 필수입니다.');return;}
    const text=prompt(`최종 확인\n${r.inboundNo||r.id} 기록과 연결 사진을 삭제합니다.\nDELETE 를 입력하세요.`,'');if(text!=='DELETE')return;
    const admin=await ensureAdminSession();if(!admin)return;
    if(typeof showBusy==='function')showBusy('삭제 전 기록 보관 및 사진 삭제 확인 중...');
    try{const res=await postWithSession('deleteRecord',{id:r.id,reason:reason.trim(),confirmText:'DELETE'},admin.session);if(!res.ok){alert('삭제 중단: '+(res.message||'알 수 없는 오류')+(res.code==='PHOTO_DELETE_PARTIAL'?'\nDB 기록은 유지되어 재시도할 수 있습니다.':''));return;}if(window.V22)V22.selectedIds.delete(String(r.id));currentViewRecord=null;if($('viewDetailCard'))$('viewDetailCard').classList.add('hidden');if($('v22EditCard'))$('v22EditCard').classList.add('hidden');resetReportState();alert(`삭제 완료\nDB 기록 삭제: 완료\nDrive 사진: ${res.deletedPhotos||0}/${res.photoCount||0}개\nAudit/삭제보관 ID: ${res.deletionId||'-'}`);await V24.loadRecords(V24.page);}catch(e){alert('삭제 실패: '+e.message);}finally{if(typeof hideBusy==='function')hideBusy();}
  }
  function patchDelete(){if(window.V22)V22.deleteCurrent=deleteCurrent;}

  /* ==================== 초기화 ==================== */
  function patchTools(){
    injectListControls();patchSelection();patchDetail();patchReport();patchDelete();applyPermissions();
    const tools=$('v22ViewTools');if(tools&&!$('v23SelectedCount')){const s=document.createElement('span');s.id='v23SelectedCount';s.textContent='선택 0건';tools.appendChild(s);}
    const prev=window.showTab;if(typeof prev==='function'&&!prev.__v23){const fn=function(tab){const x=prev(tab);if(tab==='view'&&!V24.listLoaded)setTimeout(()=>V24.loadRecords(1),50);return x;};fn.__v23=true;window.showTab=fn;}
    const sub=document.querySelector('header .sub');if(sub)sub.textContent='개인계정 · 단건 중심 · Audit · 조회/보고 V22.4';
  }
  function waitForV22(){if(window.V22&&$('view')){patchTools();bootstrapSecurity();return;}setTimeout(waitForV22,50);}
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',waitForV22);else waitForV22();
})();
