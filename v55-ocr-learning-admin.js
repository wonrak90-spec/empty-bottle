/* OCR Learning Store V1 - admin verification UI */
(function(){
  'use strict';
  const L=window.V55OcrLearning;
  if(!L||window.__OCR_LEARNING_ADMIN_V1__)return;
  window.__OCR_LEARNING_ADMIN_V1__=true;

  function esc(s){return String(s==null?'':s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}
  function isAdmin(){try{return !!(window.V24&&V24.session&&V24.session.user&&V24.session.user.role==='admin');}catch(_){return false;}}
  function ensureModal(){
    if(document.getElementById('v55LearningModal'))return;
    const el=document.createElement('div');el.id='v55LearningModal';el.className='hidden';
    el.style.cssText='position:fixed;inset:0;z-index:5000;background:rgba(0,0,0,.48);padding:18px;overflow:auto';
    el.innerHTML='<div style="max-width:980px;margin:20px auto;background:#fff;border-radius:16px;padding:18px;box-shadow:0 20px 60px rgba(0,0,0,.25)">'+
      '<div style="display:flex;justify-content:space-between;gap:12px;align-items:center"><div><b style="font-size:18px">OCR Learning Store V1</b><div style="font-size:12px;color:#666;margin-top:4px">OCR 인식값과 최종 수정값 검증</div></div><button class="btn outline" onclick="V55OcrLearning.closeAdmin()" style="width:auto">닫기</button></div>'+
      '<div id="v55LearningStats" class="status" style="margin-top:12px">불러오는 중...</div>'+
      '<div style="display:flex;gap:8px;flex-wrap:wrap;margin:10px 0"><button class="btn outline" onclick="V55OcrLearning.loadAdmin()" style="width:auto">새로고침</button><button class="btn outline" onclick="V55OcrLearning.flush(true).then(()=>V55OcrLearning.loadAdmin())" style="width:auto">대기 로그 동기화</button><button class="btn outline" onclick="V55OcrLearning.createDataset()" style="width:auto">Dataset 버전 생성</button></div>'+
      '<div id="v55DatasetList" style="font-size:12px;color:#555;margin-bottom:12px"></div><div id="v55LearningList"></div></div>';
    document.body.appendChild(el);
  }
  function mount(){
    if(!isAdmin())return;
    const bar=document.getElementById('v24AccountBar');
    if(!bar||document.getElementById('btnOcrLearning'))return;
    const b=document.createElement('button');b.id='btnOcrLearning';b.className='btn outline';
    b.style.cssText='width:auto;padding:6px 10px;font-size:12px';b.onclick=()=>L.openAdmin();bar.appendChild(b);badge();
  }
  function badge(){
    const b=document.getElementById('btnOcrLearning');if(!b)return;
    const n=L.loadQueue?L.loadQueue().length:0;b.textContent=n?('OCR 학습 · 대기 '+n):'OCR 학습';
  }
  L.onQueueChange=badge;
  L.openAdmin=async function(){
    if(!isAdmin()){alert('관리자 계정이 필요합니다.');return;}
    ensureModal();document.getElementById('v55LearningModal').classList.remove('hidden');await L.loadAdmin();
  };
  L.closeAdmin=function(){const e=document.getElementById('v55LearningModal');if(e)e.classList.add('hidden');};
  L.loadAdmin=async function(){
    ensureModal();
    const stats=document.getElementById('v55LearningStats'),list=document.getElementById('v55LearningList'),ds=document.getElementById('v55DatasetList');
    stats.className='status';stats.textContent='Learning Store 조회 중...';list.innerHTML='';ds.innerHTML='';
    try{
      await L.flush(true);
      const info=await apiGet('ocrLearningInfo',{});
      if(!info||!info.ok)throw new Error(info&&info.message||'Learning Store backend 미적용');
      const r=await apiGet('ocrLearningList',{status:'PENDING',limit:'100'});
      const v=await apiGet('ocrDatasetVersions',{});
      const items=(r&&r.items)||[];
      stats.className='status ok';
      stats.textContent='검증 대기 '+items.length+'건 · 전체 '+String(info.total||0)+'건 · 승인 '+String(info.approved||0)+'건 · 로컬 대기 '+String(L.loadQueue().length)+'건';
      ds.innerHTML='Dataset: '+((v&&v.items)||[]).map(x=>'<b>'+esc(x.version)+'</b> '+esc(x.status||'')).join(' · ');
      if(!items.length){list.innerHTML='<div class="status ok">검증 대기 항목이 없습니다.</div>';return;}
      list.innerHTML=items.map(x=>{
        const d=x.diff||{};
        const rows=Object.keys(d).map(k=>'<div style="display:grid;grid-template-columns:120px 1fr 1fr;gap:8px;padding:4px 0;border-bottom:1px solid #eee"><b>'+esc(k)+(d[k].changed?' *':'')+'</b><span>OCR: '+esc(d[k].ocr)+'</span><span>최종: '+esc(d[k].final)+'</span></div>').join('');
        const photo=x.photoUrl?'<a href="'+esc(x.photoUrl)+'" target="_blank" rel="noopener">Drive 사진</a> · ':'';
        return '<div style="border:1px solid #ddd;border-radius:12px;padding:12px;margin:8px 0"><div style="display:flex;justify-content:space-between;gap:8px"><b>'+esc(x.source)+' · '+esc(x.template||'공통')+'</b><span style="font-size:12px;color:#666">'+esc(x.capturedAt||'')+'</span></div><div style="font-size:12px;color:#666;margin:4px 0">'+photo+'Record '+esc(x.recordId||'-')+' · 수정 '+esc(x.changedFields||0)+' / 비교 '+esc(x.comparedFields||0)+'</div>'+rows+'<div style="display:flex;gap:8px;margin-top:10px"><button class="btn primary" style="width:auto" onclick="V55OcrLearning.verify(\''+esc(x.id)+'\',\'APPROVED\')">승인</button><button class="btn outline" style="width:auto" onclick="V55OcrLearning.verify(\''+esc(x.id)+'\',\'REJECTED\')">제외</button></div></div>';
      }).join('');
    }catch(e){
      stats.className='status bad';stats.textContent='Learning Store 백엔드 연결 필요 · '+String(e&&e.message?e.message:e);
      list.innerHTML='<div class="status">OCR 학습 로그 캡처는 로컬 대기열에 유지됩니다. Apps Script에 Learning Store V1 모듈을 배포하면 자동 동기화됩니다.</div>';
    }
  };
  L.verify=async function(id,status){
    const note=status==='REJECTED'?(prompt('제외 사유를 입력하세요.','')||''):'';
    const r=await apiPost('ocrLearningVerify',{id,status,note});
    if(!r||!r.ok){alert(r&&r.message||'검증 저장 실패');return;}await L.loadAdmin();
  };
  L.createDataset=async function(){
    const version=prompt('새 Dataset 버전명','OCR-DS-V2');if(!version)return;
    const note=prompt('버전 설명','')||'';
    const r=await apiPost('ocrDatasetCreate',{version:version.trim(),note,activate:true});
    if(!r||!r.ok){alert(r&&r.message||'Dataset 생성 실패');return;}await L.loadAdmin();
  };
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',()=>{mount();setInterval(mount,3000);},{once:true});
  else{mount();setInterval(mount,3000);}
})();