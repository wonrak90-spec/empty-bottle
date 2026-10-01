/* V58 Report Manager
 * Multi-select / combined print works with the existing getRecord API.
 * Edit / soft delete / restore are capability-gated and remain hidden
 * until the production GAS report-management patch is deployed.
 */
(function(){
  'use strict';
  if(window.V58ReportManager)return;

  const R=window.V58ReportManager={
    VERSION:'V58-REPORT-MANAGER-1.2',
    selected:new Set(),
    capabilities:{edit:false,softDelete:false,restore:false,audit:false},
    initialized:false
  };

  const $=id=>document.getElementById(id);
  const h=s=>typeof esc==='function'?esc(s):String(s==null?'':s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

  function addCss(){
    if($('v58ReportStyle'))return;
    const s=document.createElement('style');s.id='v58ReportStyle';
    s.textContent=`
      .v58-report-toolbar{display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin:10px 0}
      .v58-report-toolbar .btn{width:auto;margin:0}
      .v58-report-count{font-size:.78rem;color:var(--muted);font-weight:800;margin-left:auto}
      .v58-report-item{display:grid;grid-template-columns:40px 1fr 28px;gap:8px;align-items:center}
      .v58-report-item input[type=checkbox]{width:22px;height:22px}
      .v58-report-actions{display:flex;gap:8px;flex-wrap:wrap;margin-top:10px}
      .v58-report-actions .btn{width:auto}
      #v58ReportEditPanel{border:1px solid var(--border);border-radius:12px;padding:10px;margin-top:10px}
      .v58-rgrid{display:grid;grid-template-columns:1fr 1fr;gap:8px}
      .v58-rgrid label{font-size:.72rem;color:var(--muted)}
      .v58-rgrid input,.v58-rgrid textarea{width:100%}
      @media(max-width:600px){.v58-rgrid{grid-template-columns:1fr}.v58-report-count{width:100%;margin-left:0}}
    `;
    document.head.appendChild(s);
  }

  function ensureUi(){
    const results=$('viewSearchResults');
    if(!results)return false;
    addCss();

    if(!$('v58ReportToolbar')){
      const bar=document.createElement('div');
      bar.id='v58ReportToolbar';bar.className='v58-report-toolbar';
      bar.innerHTML=`
        <button type="button" class="btn outline" id="v58SelectAllReports">전체 선택</button>
        <button type="button" class="btn primary" id="v58PrintSelectedReports">선택 통합출력</button>
        <button type="button" class="btn outline hidden" id="v58DeleteSelectedReports">선택 삭제</button>
        <button type="button" class="btn outline hidden" id="v58DeletedReports">삭제내역</button>
        <span id="v58ReportCount" class="v58-report-count">0건 선택</span>
      `;
      results.parentNode.insertBefore(bar,results);
      $('v58SelectAllReports').onclick=toggleAll;
      $('v58PrintSelectedReports').onclick=printSelected;
      $('v58DeleteSelectedReports').onclick=softDeleteSelected;
      $('v58DeletedReports').onclick=showDeleted;
    }

    if(!$('v58ReportEditPanel')){
      const detail=$('viewDetailCard');
      if(detail){
        const panel=document.createElement('div');
        panel.id='v58ReportEditPanel';panel.className='hidden';
        panel.innerHTML=`
          <div class="v58-rgrid">
            <label>품명<input id="v58rProduct"></label>
            <label>품목코드<input id="v58rItemCode"></label>
            <label>표시수량<input id="v58rDisplayQty" inputmode="decimal"></label>
            <label>실제수량<input id="v58rActualQty" inputmode="decimal"></label>
            <label>업체 품명<input id="v58rVendorProduct"></label>
            <label>업체 수량<input id="v58rVendorQty" inputmode="decimal"></label>
            <label style="grid-column:1/-1">특이사항<textarea id="v58rNote"></textarea></label>
            <label style="grid-column:1/-1">수정 사유<textarea id="v58rReason" placeholder="수정 사유 필수"></textarea></label>
          </div>
          <div class="v58-report-actions">
            <button type="button" class="btn primary" id="v58ReportApplyEdit">수정 저장</button>
            <button type="button" class="btn outline" id="v58ReportCancelEdit">취소</button>
          </div>
        `;
        detail.appendChild(panel);
        $('v58ReportApplyEdit').onclick=applyEdit;
        $('v58ReportCancelEdit').onclick=()=>panel.classList.add('hidden');

        const actions=document.createElement('div');
        actions.id='v58ReportDetailActions';actions.className='v58-report-actions';
        actions.innerHTML=`
          <button type="button" class="btn outline hidden" id="v58EditCurrentReport">수정</button>
          <button type="button" class="btn outline hidden" id="v58DeleteCurrentReport">삭제</button>
        `;
        detail.appendChild(actions);
        $('v58EditCurrentReport').onclick=openEdit;
        $('v58DeleteCurrentReport').onclick=deleteCurrent;
      }
    }
    syncCapabilityUi();
    updateCount();
    return true;
  }

  function localAdmin(){
    try{
      const s=window.V24&&V24.session;
      return !!(s&&s.user&&s.user.role==='admin');
    }catch(_){return false;}
  }

  async function detectCapabilities(){
    // UI may initialize before the capability request completes. The client-side
    // admin state is only used to SHOW controls; the GAS server remains the
    // authoritative permission check for every edit/delete/restore request.
    const admin=localAdmin();
    if(admin){
      R.capabilities={edit:true,softDelete:true,restore:true,audit:true};
      syncCapabilityUi();
    }
    try{
      const res=await apiGet('reportCapabilities',{});
      if(res&&res.ok){
        R.capabilities={
          edit:!!res.edit,softDelete:!!res.softDelete,
          restore:!!res.restore,audit:!!res.audit
        };
      }
    }catch(_){}
    syncCapabilityUi();
  }

  function syncCapabilityUi(){
    const admin=localAdmin();
    const show=(id,on)=>{const e=$(id);if(e)e.classList.toggle('hidden',!on);};
    show('v58DeleteSelectedReports',R.capabilities.softDelete||admin);
    show('v58DeletedReports',R.capabilities.restore||admin);
    show('v58EditCurrentReport',R.capabilities.edit||admin);
    show('v58DeleteCurrentReport',R.capabilities.softDelete||admin);
  }

  function updateCount(){
    const e=$('v58ReportCount');if(e)e.textContent=R.selected.size+'건 선택';
    const all=typeof viewSearchResultsList!=='undefined'&&Array.isArray(viewSearchResultsList)?viewSearchResultsList:[];
    const b=$('v58SelectAllReports');if(b)b.textContent=all.length&&R.selected.size===all.length?'전체 해제':'전체 선택';
  }

  function toggleOne(id,checked){
    if(checked)R.selected.add(String(id));else R.selected.delete(String(id));
    updateCount();
  }

  function toggleAll(){
    const list=typeof viewSearchResultsList!=='undefined'&&Array.isArray(viewSearchResultsList)?viewSearchResultsList:[];
    const select=R.selected.size!==list.length;
    R.selected.clear();
    if(select)list.forEach(x=>R.selected.add(String(x.id)));
    document.querySelectorAll('.v58-report-check').forEach(ch=>{ch.checked=select;});
    updateCount();
  }

  function renderResults(list){
    ensureUi();
    const box=$('viewSearchResults');
    if(!box)return;
    box.innerHTML=(list||[]).map((it,i)=>`
      <div class="result-item v58-report-item">
        <input type="checkbox" class="v58-report-check" data-id="${h(it.id)}" aria-label="보고서 선택">
        <div role="button" tabindex="0" data-open-index="${i}">
          <div>${h(it.product)} · ${h(String(it.qty))}${h(it.unit||'')}</div>
          <div class="meta">입고번호 ${h(it.inboundNo)} · ${h(it.mode)} · ${h(it.regDate)}</div>
        </div>
        <div>›</div>
      </div>
    `).join('');
    box.querySelectorAll('.v58-report-check').forEach(ch=>{
      ch.checked=R.selected.has(String(ch.dataset.id));
      ch.addEventListener('change',()=>toggleOne(ch.dataset.id,ch.checked));
      ch.addEventListener('click',e=>e.stopPropagation());
    });
    box.querySelectorAll('[data-open-index]').forEach(el=>{
      const open=()=>{if(typeof window.openRecordDetail==='function')window.openRecordDetail(Number(el.dataset.openIndex));};
      el.addEventListener('click',open);
      el.addEventListener('keydown',e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();open();}});
    });
    updateCount();
  }
  R.renderResults=renderResults;

  async function fetchRecord(id){
    const res=await apiGet('getRecord',{id:String(id)});
    if(!res||!res.ok)throw new Error((res&&res.message)||('보고서 '+id+' 조회 실패'));
    return res;
  }

  function row(label,value){return '<tr><th>'+h(label)+'</th><td>'+h(value==null?'':value)+'</td></tr>';}

  function reportSection(pack,index,total,photoMode){
    const r=pack.record||{},ps=pack.pallets||[];
    const pRows=ps.map(p=>'<tr><td>'+h(p.seq||'')+'</td><td>'+h(p.containerNo||p.code||'')+'</td><td>'+h(p.product||'')+'</td><td>'+h(p.qty||'')+h(p.unit||'')+'</td><td>'+h(p.result||'')+'</td></tr>').join('');
    let photos='';
    if(photoMode!=='none'){
      const imgs=[];
      if(r.labelPhotoUrl)imgs.push('<div><b>WMS</b><br><img src="'+h(r.labelPhotoUrl)+'"></div>');
      if(photoMode==='all'&&r.vendorPhotoUrl)imgs.push('<div><b>업체라벨</b><br><img src="'+h(r.vendorPhotoUrl)+'"></div>');
      if(photoMode==='all'&&r.itemPhotoUrl){
        String(r.itemPhotoUrl).split(',').map(x=>x.trim()).filter(Boolean).slice(0,4).forEach((u,i)=>imgs.push('<div><b>실물 '+(i+1)+'</b><br><img src="'+h(u)+'"></div>'));
      }
      if(imgs.length)photos='<div class="photos">'+imgs.join('')+'</div>';
    }
    return `
      <section class="report-page">
        <div class="page-no">${index+1} / ${total}</div>
        <h1>공병 입고 확인 기록서</h1>
        <div class="meta">기록 ID: ${h(r.id)} · 등록일시: ${h(r.regDate)} · ${h(r.mode)}</div>
        <table>
          ${row('입고번호',r.inboundNo)}${row('입고일자',r.inboundDate)}
          ${row('품명',r.product)}${row('품목코드',r.itemCode)}
          ${row('제조원',r.manufacturer)}${row('공급업체',r.supplier)}
          ${row('표시수량',(r.displayQty||'')+(r.unit||''))}
          ${r.actualQty?row('실제 확인수량',r.actualQty):''}
          ${r.labelMatch?row('라벨 대조',r.labelMatch):''}
          ${r.vendorProduct?row('업체라벨 품명',r.vendorProduct):''}
          ${r.vendorQty?row('업체라벨 수량',r.vendorQty):''}
          ${row('최종 결과',r.finalResult)}${row('검수자',r.inspector)}${row('특이사항',r.note)}
        </table>
        ${pRows?'<table><tr><th>#</th><th>용기번호</th><th>품명</th><th>수량</th><th>판정</th></tr>'+pRows+'</table>':''}
        ${photos}
        <div class="sign"><div>검수자</div><div>확인자</div></div>
      </section>
    `;
  }

  async function printSelected(){
    const ids=[...R.selected];
    if(!ids.length){alert('출력할 보고서를 선택하세요.');return;}
    if(ids.length>100&&!confirm(ids.length+'건을 한 번에 출력합니다. 계속할까요?'))return;

    const w=window.open('','_blank');
    if(!w){alert('팝업이 차단되었습니다. 팝업 허용 후 다시 시도해주세요.');return;}
    w.document.write('<p style="font-family:sans-serif;padding:20px;">보고서 불러오는 중...</p>');
    try{
      const packs=[];
      for(const id of ids)packs.push(await fetchRecord(id));
      const photoMode='representative';
      const body=packs.map((p,i)=>reportSection(p,i,packs.length,photoMode)).join('');
      const html=`<!DOCTYPE html><html lang="ko"><head><meta charset="UTF-8"><title>공병 입고 확인 통합보고서</title>
        <style>
          body{font-family:'Malgun Gothic',sans-serif;color:#1c1b19;margin:0}
          .report-page{padding:18mm 14mm;page-break-after:always;position:relative;box-sizing:border-box}
          .report-page:last-child{page-break-after:auto}.page-no{position:absolute;right:14mm;top:8mm;font-size:10px;color:#666}
          h1{font-size:18px;border-bottom:2px solid #1F4B5F;padding-bottom:7px}
          table{width:100%;border-collapse:collapse;margin:10px 0;font-size:11px}
          th,td{border:1px solid #bbb;padding:5px 7px;text-align:left}th{background:#f0efe9}
          .meta{font-size:10px;color:#666}.photos{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-top:10px}
          .photos img{max-width:100%;max-height:220px;object-fit:contain}.sign{display:flex;justify-content:flex-end;gap:35px;margin-top:24px;font-size:11px}
          .sign div{width:120px;text-align:center;border-top:1px solid #333;padding-top:5px}
          @page{size:A4;margin:0}@media print{body{margin:0}}
        </style></head><body>${body}<script>window.onload=()=>setTimeout(()=>window.print(),300);<\/script></body></html>`;
      w.document.open();w.document.write(html);w.document.close();
    }catch(e){
      w.document.open();w.document.write('<p style="font-family:sans-serif;padding:20px;">통합출력 실패: '+h(e&&e.message?e.message:e)+'</p>');w.document.close();
    }
  }

  function openEdit(){
    if(!R.capabilities.edit||typeof currentViewRecord==='undefined'||!currentViewRecord)return;
    const r=currentViewRecord.record||{};
    const set=(id,v)=>{const e=$(id);if(e)e.value=v==null?'':String(v);};
    set('v58rProduct',r.product);set('v58rItemCode',r.itemCode);set('v58rDisplayQty',r.displayQty);
    set('v58rActualQty',r.actualQty);set('v58rVendorProduct',r.vendorProduct);set('v58rVendorQty',r.vendorQty);
    set('v58rNote',r.note);set('v58rReason','');
    $('v58ReportEditPanel').classList.remove('hidden');
  }

  async function applyEdit(){
    if(!R.capabilities.edit||typeof currentViewRecord==='undefined'||!currentViewRecord)return;
    const g=id=>($(id)&&$(id).value||'').trim();
    const reason=g('v58rReason');
    if(!reason){alert('수정 사유를 입력하세요.');return;}
    const payload={
      id:currentViewRecord.record.id,reason,
      patch:{product:g('v58rProduct'),itemCode:g('v58rItemCode'),displayQty:g('v58rDisplayQty'),
        actualQty:g('v58rActualQty'),vendorProduct:g('v58rVendorProduct'),vendorQty:g('v58rVendorQty'),note:g('v58rNote')}
    };
    try{
      const res=await apiPost('updateRecord',payload);
      if(!res||!res.ok)throw new Error((res&&res.message)||'수정 실패');
      $('v58ReportEditPanel').classList.add('hidden');
      const idx=(viewSearchResultsList||[]).findIndex(x=>String(x.id)===String(payload.id));
      if(idx>=0)await openRecordDetail(idx);
      alert('수정 완료');
    }catch(e){alert('수정 실패: '+String(e&&e.message?e.message:e));}
  }

  async function softDelete(ids){
    if(!R.capabilities.softDelete)return;
    const reason=prompt('삭제 사유를 입력하세요.');
    if(!reason)return;
    try{
      const res=await apiPost('softDeleteRecords',{ids:ids.map(String),reason});
      if(!res||!res.ok)throw new Error((res&&res.message)||'삭제 실패');
      ids.forEach(id=>R.selected.delete(String(id)));
      currentViewRecord=null;
      const d=$('viewDetailCard');if(d)d.classList.add('hidden');
      if(typeof searchViewRecords==='function')await searchViewRecords();
    }catch(e){alert('삭제 실패: '+String(e&&e.message?e.message:e));}
  }

  async function softDeleteSelected(){
    const ids=[...R.selected];
    if(!ids.length){alert('삭제할 보고서를 선택하세요.');return;}
    if(!confirm(ids.length+'건을 삭제 처리할까요? 원본은 Audit에 보존됩니다.'))return;
    await softDelete(ids);
  }
  async function deleteCurrent(){
    if(typeof currentViewRecord==='undefined'||!currentViewRecord)return;
    if(!confirm('현재 보고서를 삭제 처리할까요?'))return;
    await softDelete([currentViewRecord.record.id]);
  }

  async function showDeleted(){
    if(!R.capabilities.restore)return;
    try{
      const res=await apiGet('listDeletedRecords',{});
      if(!res||!res.ok)throw new Error((res&&res.message)||'삭제내역 조회 실패');
      const rows=res.items||[];
      if(!rows.length){alert('삭제된 보고서가 없습니다.');return;}
      const msg=rows.slice(0,20).map((x,i)=>(i+1)+'. '+(x.product||'')+' / '+(x.inboundNo||'')+' / '+(x.id||'')).join('\n');
      const id=prompt('삭제된 보고서 일부:\n'+msg+'\n\n복구할 기록 ID를 입력하세요.');
      if(!id)return;
      const rr=await apiPost('restoreRecords',{ids:[id],reason:'작업자 복구'});
      if(!rr||!rr.ok)throw new Error((rr&&rr.message)||'복구 실패');
      alert('복구 완료');
    }catch(e){alert('복구 실패: '+String(e&&e.message?e.message:e));}
  }

  const legacySearch=window.searchViewRecords;
  window.searchViewRecords=async function(){
    await detectCapabilities();
    const kw=$('viewSearchKw')?$('viewSearchKw').value.trim():'';
    if(!kw){setStatus('viewSearchStatus','검색어를 입력하세요.','bad');return;}
    setStatus('viewSearchStatus','검색 중...','warn');
    const detail=$('viewDetailCard');if(detail)detail.classList.add('hidden');
    try{
      const res=await apiGet('searchRecords',{keyword:kw});
      if(!res||!res.ok){setStatus('viewSearchStatus','검색 실패: '+((res&&res.message)||''),'bad');return;}
      viewSearchResultsList=res.items||[];
      R.selected.clear();
      if(!viewSearchResultsList.length){
        const box=$('viewSearchResults');if(box)box.innerHTML='';
        setStatus('viewSearchStatus','일치하는 기록이 없습니다.','bad');updateCount();return;
      }
      setStatus('viewSearchStatus',viewSearchResultsList.length+'건 검색됨 · 체크 후 통합출력 가능합니다.','ok');
      renderResults(viewSearchResultsList);
    }catch(e){setStatus('viewSearchStatus','검색 실패: '+String(e),'bad');}
  };

  const legacyOpen=window.openRecordDetail;
  window.openRecordDetail=async function(index){
    if(typeof legacyOpen==='function')await legacyOpen(index);
    ensureUi();await detectCapabilities();syncCapabilityUi();
  };

  function init(){
    if(R.initialized)return;
    R.initialized=true;
    ensureUi();
    detectCapabilities();
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init,{once:true});else init();
})();
