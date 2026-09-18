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
      '<div id="v55LearningRealtime" style="margin-top:10px"></div>'+
      '<div id="v55LearningQuality" style="margin-top:10px"></div>'+
      '<div style="display:flex;gap:8px;flex-wrap:wrap;margin:10px 0"><button class="btn outline" onclick="V55OcrLearning.loadAdmin()" style="width:auto">새로고침</button><button class="btn outline" onclick="V55OcrLearning.flush(true).then(()=>V55OcrLearning.loadAdmin())" style="width:auto">대기 로그 동기화</button><button class="btn outline" onclick="V55OcrLearning.createDataset()" style="width:auto">Dataset 버전 생성</button><button class="btn outline" onclick="V55OcrLearning.renderDiagnostics(\'v55LearningDiag\')" style="width:auto">연동 진단</button></div>'+
      '<div id="v55LearningDiag" class="status hidden" style="margin-bottom:10px"></div><div id="v55DatasetList" style="font-size:12px;color:#555;margin-bottom:12px"></div><div id="v55LearningList"></div></div>';
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
  function renderRealtime(r){
    if(!r||!r.ok)return '<div class="status">실시간 Learning 현황을 불러오지 못했습니다.</div>';
    const pct=v=>v==null?'-':(String(v)+'%');
    const cards=[
      ['오늘 OCR',r.totalSamples||0+''],
      ['키인 수정',r.manualCorrectionSamples||0+''],
      ['잠정 일치율',pct(r.provisionalAccuracy)],
      ['승인 정확도',pct(r.approvedAccuracy)],
      ['검증 대기',r.pending||0+''],
      ['로컬 대기',L.loadQueue?L.loadQueue().length:0+'']
    ].map(x=>'<div style="border:1px solid #ddd;border-radius:10px;padding:8px;text-align:center"><div style="font-size:11px;color:#666">'+esc(x[0])+'</div><b style="font-size:18px">'+esc(x[1])+'</b></div>').join('');
    const top=(r.topFields||[]).slice(0,5).map(x=>'<span style="display:inline-block;border:1px solid #ddd;border-radius:12px;padding:3px 8px;margin:2px">'+esc(x.field)+' '+esc(x.count)+'건</span>').join('')||'<span style="font-size:12px;color:#666">오늘 키인 수정 없음</span>';
    const rows=(r.recentCorrections||[]).map(x=>{
      const f=(x.manualChangedFields||[]).join(', ');
      return '<tr><td style="padding:5px;border-bottom:1px solid #eee">'+esc(x.capturedAt||'')+'</td><td style="padding:5px;border-bottom:1px solid #eee">'+esc(x.capturedBy||'-')+'</td><td style="padding:5px;border-bottom:1px solid #eee">'+esc(x.source||'')+'</td><td style="padding:5px;border-bottom:1px solid #eee">'+esc(x.recordId||'-')+'</td><td style="padding:5px;border-bottom:1px solid #eee"><b>'+esc(f||'-')+'</b></td><td style="padding:5px;border-bottom:1px solid #eee">'+esc(x.status||'')+'</td></tr>';
    }).join('');
    return '<div style="border:1px solid #d7d7d7;border-radius:12px;padding:12px">'+
      '<div style="display:flex;justify-content:space-between;gap:8px;align-items:center"><div><b>실시간 OCR / 키인 수정 현황</b><div style="font-size:11px;color:#666;margin-top:3px">'+esc(r.date||'')+' · 잠정 일치율은 미검증 포함, 승인 정확도는 관리자 승인 데이터만 반영</div></div><button class="btn outline" style="width:auto;padding:5px 9px;font-size:11px" onclick="V55OcrLearning.refreshRealtime()">지금 갱신</button></div>'+
      '<div style="display:grid;grid-template-columns:repeat(6,minmax(90px,1fr));gap:6px;margin-top:9px">'+cards+'</div>'+
      '<div style="margin-top:8px"><b style="font-size:12px">오늘 수정 빈도</b><div style="margin-top:4px">'+top+'</div></div>'+
      (rows?'<div style="overflow:auto;margin-top:8px"><table style="width:100%;border-collapse:collapse;font-size:11px"><thead><tr><th>시간</th><th>작업자</th><th>구분</th><th>Record</th><th>키인 수정 필드</th><th>상태</th></tr></thead><tbody>'+rows+'</tbody></table></div>':'<div class="status" style="margin-top:8px">오늘 키인 수정 기록이 없습니다.</div>')+
      '</div>';
  }

  L.refreshRealtime=async function(){
    if(!isAdmin())return;
    const box=document.getElementById('v55LearningRealtime');if(!box)return;
    try{
      const r=await apiGet('ocrLearningRealtime',{limit:'30'});
      box.innerHTML=renderRealtime(r);
    }catch(e){
      box.innerHTML='<div class="status warn">실시간 현황 조회 실패 · '+esc(e&&e.message?e.message:e)+'</div>';
    }
  };

  function renderQuality(m){
    if(!m||!m.ok||!m.samples)return '<div class="status">관리자 승인 데이터가 쌓이면 OCR 품질지표가 표시됩니다.</div>';
    const src=Object.keys(m.bySource||{}).map(k=>{
      const x=m.bySource[k]||{};
      return '<div style="border:1px solid #ddd;border-radius:10px;padding:8px"><div style="font-size:11px;color:#666">'+esc(k)+'</div><b style="font-size:17px">'+esc(x.accuracy==null?'-':x.accuracy+'%')+'</b><div style="font-size:11px;color:#777">승인 '+esc(x.samples||0)+'건 · 수정 '+esc(x.changedFields||0)+'/'+esc(x.comparedFields||0)+'</div></div>';
    }).join('');
    const weak=(m.fields||[]).filter(x=>Number(x.changed||0)>0).slice(0,5);
    const weakRows=weak.length?weak.map(x=>'<span style="display:inline-block;border:1px solid #ddd;border-radius:12px;padding:3px 8px;margin:2px">'+esc(x.field)+' · 수정 '+esc(x.changed)+'/'+esc(x.compared)+' ('+esc(x.correctionRate)+'%)</span>').join(''):'<span style="font-size:12px;color:#666">승인 데이터 기준 수정 발생 필드 없음</span>';
    return '<div style="border:1px solid #d7d7d7;border-radius:12px;padding:12px;background:#fafafa">'+
      '<div style="display:flex;justify-content:space-between;gap:10px;align-items:end"><div><b>승인 데이터 OCR 품질</b><div style="font-size:11px;color:#666;margin-top:3px">관리자가 승인한 Final 값만 정답으로 사용</div></div><div style="text-align:right"><b style="font-size:22px">'+esc(m.accuracy==null?'-':m.accuracy+'%')+'</b><div style="font-size:11px;color:#777">필드 일치율 · '+esc(m.samples)+' samples</div></div></div>'+
      (src?'<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:6px;margin-top:9px">'+src+'</div>':'')+
      '<div style="margin-top:8px"><b style="font-size:12px">수정 빈도 높은 필드</b><div style="margin-top:4px">'+weakRows+'</div></div></div>';
  }

  L.loadAdmin=async function(){
    ensureModal();
    const stats=document.getElementById('v55LearningStats'),realtime=document.getElementById('v55LearningRealtime'),quality=document.getElementById('v55LearningQuality'),list=document.getElementById('v55LearningList'),ds=document.getElementById('v55DatasetList');
    stats.className='status';stats.textContent='Learning Store 조회 중...';if(realtime)realtime.innerHTML='';if(quality)quality.innerHTML='';list.innerHTML='';ds.innerHTML='';
    try{
      await L.flush(true);
      const info=await apiGet('ocrLearningInfo',{});
      if(!info||!info.ok)throw new Error(info&&info.message||'Learning Store backend 미적용');
      const r=await apiGet('ocrLearningList',{status:'PENDING',limit:'100'});
      const v=await apiGet('ocrDatasetVersions',{});
      const m=await apiGet('ocrLearningMetrics',{scope:'APPROVED'});
      const rt=await apiGet('ocrLearningRealtime',{limit:'30'});
      const items=(r&&r.items)||[];
      stats.className='status ok';
      stats.textContent='검증 대기 '+items.length+'건 · 전체 '+String(info.total||0)+'건 · 승인 '+String(info.approved||0)+'건 · 로컬 대기 '+String(L.loadQueue().length)+'건';
      ds.innerHTML='Dataset: '+((v&&v.items)||[]).map(x=>'<b>'+esc(x.version)+'</b> '+esc(x.status||'')).join(' · ');
      if(realtime)realtime.innerHTML=renderRealtime(rt);
      if(quality)quality.innerHTML=renderQuality(m);
      if(!items.length){list.innerHTML='<div class="status ok">검증 대기 항목이 없습니다.</div>';return;}
      list.innerHTML=items.map(x=>{
        const d=x.diff||{};
        const rows=Object.keys(d).map(k=>'<div style="display:grid;grid-template-columns:120px 1fr 1fr;gap:8px;padding:4px 0;border-bottom:1px solid #eee"><b>'+esc(k)+(d[k].changed?' *':'')+'</b><span>OCR: '+esc(d[k].ocr)+'</span><span>최종: '+esc(d[k].final)+'</span></div>').join('');
        const photo=x.photoUrl?'<a href="'+esc(x.photoUrl)+'" target="_blank" rel="noopener">Drive 사진</a> · ':'';
        return '<div style="border:1px solid #ddd;border-radius:12px;padding:12px;margin:8px 0"><div style="display:flex;justify-content:space-between;gap:8px"><b>'+esc(x.source)+' · '+esc(x.template||'공통')+'</b><span style="font-size:12px;color:#666">'+esc(x.capturedAt||'')+'</span></div><div style="font-size:12px;color:#666;margin:4px 0">'+photo+'Record '+esc(x.recordId||'-')+' · 수정 '+esc(x.changedFields||0)+' / 비교 '+esc(x.comparedFields||0)+'</div>'+rows+'<div style="display:flex;gap:8px;margin-top:10px"><button class="btn primary" style="width:auto" onclick="V55OcrLearning.verify(\''+esc(x.id)+'\',\'APPROVED\')">승인</button><button class="btn outline" style="width:auto" onclick="V55OcrLearning.verify(\''+esc(x.id)+'\',\'REJECTED\')">제외</button></div></div>';
      }).join('');
    }catch(e){
      stats.className='status bad';stats.textContent='Learning Store 백엔드 연결 필요 · '+String(e&&e.message?e.message:e);
      if(realtime)realtime.innerHTML='';
      if(quality)quality.innerHTML='';
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
  function realtimePoll(){
    setInterval(()=>{
      try{
        const m=document.getElementById('v55LearningModal');
        if(m&&!m.classList.contains('hidden')&&isAdmin())L.refreshRealtime();
      }catch(_){}
    },15000);
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',()=>{mount();setInterval(mount,3000);realtimePoll();},{once:true});
  else{mount();setInterval(mount,3000);realtimePoll();}
})();