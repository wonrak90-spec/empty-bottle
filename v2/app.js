/* R15 시작점: 탭 이동, 대기열 표시, 공통 창 */
(function () {
  'use strict';
  const R = window.R15, { $, esc } = R.util;

  function showTab(tab) {
    if (tab === 'admin' && !R.isAdmin()) tab = 'inspect';
    document.body.dataset.tab = tab;
    document.querySelectorAll('#nav [data-tab]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.tab === tab)));
    document.querySelectorAll('.page').forEach((p) => { p.hidden = p.dataset.page !== tab; });
    try { localStorage.setItem('r15.tab', tab); } catch (_) {}
    if (tab === 'lot') R.lot.show();
    if (tab === 'report') R.report.show();
    if (tab === 'admin') R.admin.show();
    window.scrollTo({ top: 0 });
  }

  function queueChip(s) {
    const c = $('qChip'), wait = (s.pending || 0) + (s.sending || 0), blk = s.blocked || 0;
    c.textContent = blk ? `확인 필요 ${blk}` : wait ? `단말 보관 ${wait}` : '저장 완료';
    c.dataset.state = blk ? 'crit' : wait ? 'warn' : 'good';
  }

  // 대기열 1건 처리 창 (확인 필요 건을 고치거나, 이미 있는 기록으로 처리)
  R.showJob = function (j) {
    const p = j.payload || {}, isIns = j.type === 'inspect';
    $('dialogBody').innerHTML = `<h3>${esc(j.label || (isIns ? `${p.inboundNo} P${p.containerFrom}` : '생산 투입'))}</h3>
      <div class="warnbox">${esc(j.lastError || '')}</div>
      ${isIns ? `<div class="grid g2"><label>입고번호<input id="jIn" value="${esc(p.inboundNo)}" inputmode="numeric"></label><label>Pallet 번호<input id="jP" value="${esc(p.containerFrom)}" inputmode="numeric"></label></div>
        <div class="sub">번호가 잘못 읽혔으면 고친 뒤 다시 보내세요. 이미 서버에 같은 Pallet가 정상 저장되어 있으면 "이미 저장됨"을 누르세요.</div>
        ${j.result && j.result.duplicateId ? `<div class="grid g2 cmp"><figure><img id="jMine" src="${esc((j.photos && j.photos.wms) || '')}" alt=""><figcaption>이 폰 사진</figcaption></figure>
          <figure><img id="jTheirs" alt=""><figcaption>서버 기록 ${esc(j.result.existingAt || '')} ${esc(j.result.existingInspector || '')}</figcaption></figure></div>
          <div class="sub">두 사진의 라벨 번호가 다르면 서버 기록이 잘못 저장된 것입니다. "이미 저장됨"을 누르지 말고 관리자에게 서버 기록 수정을 요청하세요.</div>` : ''}` : ''}
      <div class="savebar"><button type="button" class="btn" id="jRetry">${isIns ? '고쳐서 다시 보내기' : '다시 보내기'}</button>
        ${isIns && j.result && j.result.duplicateId ? '<button type="button" class="btn ghost" id="jExist">이미 저장됨</button>' : ''}
        <button type="button" class="btn ghost sm" id="jDel">이 건 버리기</button><button type="button" class="btn ghost sm" id="jClose">닫기</button></div>`;
    $('dialog').hidden = false;
    if (j.result && j.result.existingPhotoUrl && $('jTheirs')) R.loadPhotos([j.result.existingPhotoUrl]).then((m) => { const el = $('jTheirs'); if (el) el.src = m[j.result.existingPhotoUrl] || ''; });
    $('jClose').onclick = () => { $('dialog').hidden = true; };
    $('jRetry').onclick = async () => {
      const patch = isIns ? { inboundNo: R.util.digits($('jIn').value), containerFrom: R.util.digits($('jP').value), containerTo: R.util.digits($('jP').value) } : null;
      if (patch && (patch.inboundNo === p.inboundNo && patch.containerFrom === String(p.containerFrom)) && j.result && j.result.duplicateId && !confirm('번호가 그대로입니다. 같은 번호로 다시 보내면 또 중복으로 막힙니다. 그래도 보낼까요?')) return;
      await R.queue.retry(j.id, patch && (patch.inboundNo !== p.inboundNo || patch.containerFrom !== String(p.containerFrom)) ? patch : null);
      $('dialog').hidden = true; R.toast('다시 보내는 중', 'ok');
    };
    const ex = $('jExist'); if (ex) ex.onclick = async () => { await R.queue.resolveAsExisting(j.id); $('dialog').hidden = true; R.toast('이미 저장된 기록으로 처리했습니다', 'ok'); };
    $('jDel').onclick = async () => { if (!confirm('이 건을 버리면 사진과 입력값이 단말에서 지워집니다. 버릴까요?')) return; await R.queue.remove(j.id); $('dialog').hidden = true; };
  };

  function queueDialog() {
    const list = R.queue.list((j) => j.state !== 'done').concat(R.queue.list((j) => j.state === 'done').slice(-20).reverse());
    $('dialogBody').innerHTML = `<h3>이 폰의 저장 대기열</h3>
      <div class="sub">단말 보관 건은 연결되면 자동으로 올라갑니다. 확인 필요 건은 눌러서 처리하세요. 저장소: ${R.queue.store ? (R.queue.store.kind === 'idb' ? '단말 보관(IndexedDB)' : '메모리 (앱을 닫으면 사라짐)') : '-'}</div>
      <div class="list">${list.map((j) => `<button type="button" class="row" data-j="${esc(j.id)}"><span><b>${esc(j.label || j.type)}</b> <span class="muted">${new Date(j.createdAt).toLocaleTimeString('ko-KR')}${j.lastError ? ' · ' + esc(j.lastError) : ''}</span></span>
        ${R.pill(j.state === 'done' ? 'ok' : j.state === 'blocked' ? 'error' : 'warn', j.state === 'done' ? '서버 완료' : j.state === 'blocked' ? '확인 필요' : j.state === 'sending' ? '보내는 중' : '단말 보관')}</button>`).join('') || '<div class="muted">비어 있음</div>'}</div>
      <div class="savebar"><button type="button" class="btn" id="qNow">지금 보내기</button><button type="button" class="btn ghost sm" id="qClose">닫기</button></div>`;
    $('dialog').hidden = false;
    $('qClose').onclick = () => { $('dialog').hidden = true; };
    $('qNow').onclick = () => { R.queue.list((j) => j.state === 'pending').forEach((j) => { j.nextAt = 0; }); R.queue.kick(); R.toast('보내는 중', 'ok'); };
    document.querySelectorAll('[data-j]').forEach((b) => { b.onclick = () => { const j = R.queue.jobs.find((x) => x.id === b.dataset.j); if (j && j.state === 'blocked') R.showJob(j); }; });
  }

  document.addEventListener('DOMContentLoaded', async () => {
    R.initPrefs();
    document.querySelectorAll('#nav [data-tab]').forEach((b) => { b.onclick = () => showTab(b.dataset.tab); });
    $('qChip').onclick = queueDialog;
    $('roleChip').onclick = () => { if (R.user && confirm('로그아웃할까요? 단말 보관 중인 저장은 다시 로그인하면 이어서 보냅니다.')) R.logout(); };
    $('viewerClose').onclick = $('viewer').onclick = (e) => { if (e.target.id === 'viewerImg') return; $('viewer').hidden = true; };
    $('dialog').addEventListener('click', (e) => { if (e.target.id === 'dialog') $('dialog').hidden = true; });
    $('foot').textContent = `새 화면 ${window.R15_CONFIG.RELEASE} · 기존 화면은 상위 주소에서 그대로 사용 가능`;
    R.on('queue', queueChip);
    R.on('login', () => { R.queue.kick(); R.ocr.warmup(); showTab(document.body.dataset.tab); });
    await R.queue.init();
    R.inspect.init(); R.lot.init(); R.trace.init(); R.report.init();
    let tab = 'inspect'; try { tab = localStorage.getItem('r15.tab') || 'inspect'; } catch (_) {}
    document.body.dataset.tab = tab;
    showTabSafe(tab);
    R.boot();
    // 저장하지 않은 단말 보관 건이 있으면 창을 닫기 전에 알린다
    window.addEventListener('beforeunload', (e) => { const s = R.queue.summary(); if ((s.pending || 0) + (s.sending || 0) > 0 && R.queue.store && R.queue.store.kind === 'memory') { e.preventDefault(); e.returnValue = ''; } });
    if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
  });
  function showTabSafe(tab) { document.querySelectorAll('.page').forEach((p) => { p.hidden = p.dataset.page !== tab; }); document.querySelectorAll('#nav [data-tab]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.tab === tab))); }
})();
