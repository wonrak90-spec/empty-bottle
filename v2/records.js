/* R15 기록 수정·삭제·되살리기·이력 (권한에 따라)
 * 서버가 기록마다 can={edit,del,fields,why}를 붙여 준다. 화면은 그대로 따르고, 최종 판단은 서버가 다시 한다.
 * 작업자: 본인이 오늘 저장한 기록. 중간관리자 이상: 모든 기록. 생산에 투입된 Pallet는 삭제 불가.
 */
(function () {
  'use strict';
  const R = window.R15, { $, esc, fmt } = R.util;
  const LABEL = { inboundNo: '입고번호', containerFrom: 'Pallet 번호', containerTo: 'Pallet 번호(끝)', displayQty: 'WMS 수량', actualQty: '실제 확인 수량', vendorProduct: '업체 품명', vendorQty: '업체 수량',
    vendorProdDate: '업체 생산일자', vendorLotNo: '업체 Lot', note: '특이사항', inboundDate: '입고일자', product: '품명', itemCode: '품목코드', manufacturer: '제조원', supplier: '공급업체', unit: '단위',
    expiryDate: '사용기한', finalResult: '판정', vendorProdTime: '업체 생산시간', vendorPalletNo: '업체 P-번호', vendorLine: '업체 라인' };
  // 기록 객체(r15Public_)의 이름 → updateRecord 항목 이름
  const VALUE = { inboundNo: 'inboundNo', containerFrom: 'pallet', displayQty: 'qty', actualQty: 'actualQty', vendorProduct: 'vendorProduct', vendorQty: 'vendorQty', vendorProdDate: 'vendorProdDate',
    vendorLotNo: 'vendorLotNo', note: 'note', inboundDate: 'inboundDate', product: 'productRaw', itemCode: 'itemCode', manufacturer: 'manufacturer', supplier: 'supplier', unit: 'unit', expiryDate: 'expiryDate',
    finalResult: 'finalResult', vendorProdTime: 'vendorProdTime', vendorPalletNo: 'vendorPalletNo', vendorLine: 'vendorLine' };
  const NUMERIC = { inboundNo: 1, containerFrom: 1, displayQty: 1, actualQty: 1, vendorQty: 1, itemCode: 1 };
  const close = () => { $('dialog').hidden = true; };
  const can = (r) => r && r.can || { edit: false, del: false, fields: [], why: '' };

  // 한 줄에 붙는 버튼: 고치기·삭제(권한 있을 때)와 이력(항상)
  function actionsHtml(r) {
    const c = can(r);
    return `<span class="ract">${c.edit ? `<button type="button" class="btn ghost sm" data-rx="edit" data-rid="${esc(r.id)}">고치기</button>` : ''}${c.del ? `<button type="button" class="btn ghost sm" data-rx="del" data-rid="${esc(r.id)}">삭제</button>` : ''}<button type="button" class="btn ghost sm" data-rx="hist" data-rid="${esc(r.id)}">이력</button></span>`;
  }
  function bind(root, records, onDone) {
    root.querySelectorAll('[data-rx]').forEach((b) => {
      b.onclick = () => { const r = records.find((x) => x.id === b.dataset.rid); if (!r) return; ({ edit, del, hist: history })[b.dataset.rx](r, onDone); };
    });
  }

  function edit(r, onDone) {
    const c = can(r); if (!c.edit) return R.toast(c.why || '고칠 권한이 없습니다', 'warn');
    const fields = c.fields.filter((k) => LABEL[k]);
    $('dialogBody').innerHTML = `<h3>${esc(r.inboundNo || '번호 없음')} P${esc(r.pallet || '?')} 고치기</h3>
      <div class="sub">${esc(r.atText)} · ${esc(r.inspector || '')} 저장${fields.length < 12 ? ' · 작업자는 번호·수량·업체 라벨·특이사항만 고칠 수 있습니다' : ''}</div>
      <div class="grid g2">${fields.map((k) => k === 'finalResult'
        ? `<label>${LABEL[k]}<select data-f="${k}">${['적합', '확인필요', '부적합'].map((v) => `<option ${v === r.finalResult ? 'selected' : ''}>${v}</option>`).join('')}</select></label>`
        : `<label class="${k === 'note' || k === 'vendorProduct' || k === 'product' ? 'wide' : ''}">${LABEL[k]}<input data-f="${k}" value="${esc(r[VALUE[k]] == null || r[VALUE[k]] === 0 && k !== 'containerFrom' ? '' : r[VALUE[k]])}"${NUMERIC[k] ? ' inputmode="numeric"' : ''}></label>`).join('')}</div>
      <label>고친 사유 (필수)<input id="edReason" placeholder="예: Pallet 번호 오입력, 라벨 사진 확인"></label>
      <div class="savebar"><button type="button" class="btn" id="edSave">저장</button><button type="button" class="btn ghost sm" id="edHist">이력</button><button type="button" class="btn ghost sm" id="edClose">닫기</button></div>`;
    $('dialog').hidden = false;
    $('edClose').onclick = close; $('edHist').onclick = () => history(r);
    $('edSave').onclick = async () => {
      const reason = $('edReason').value.trim(); if (!reason) { $('edReason').focus(); return R.toast('고친 사유를 적어 주세요', 'crit'); }
      const changes = {};
      $('dialogBody').querySelectorAll('[data-f]').forEach((i) => {
        const k = i.dataset.f, old = r[VALUE[k]] == null ? '' : String(r[VALUE[k]]), v = i.value.trim();
        if (v !== old && !(v === '' && old === '0')) changes[k] = NUMERIC[k] ? v.replace(/[^0-9.]/g, '') : v;
      });
      if (!Object.keys(changes).length) return R.toast('바뀐 값이 없습니다', 'warn');
      const btn = $('edSave'); R.busy(btn, true, '저장 중…');
      const res = await R.tryPost('r15RecordEdit', { id: r.id, reason, changes }); R.busy(btn, false);
      if (res && res.ok) { close(); R.toast('고쳤습니다 · 이력에 남았습니다', 'ok'); if (onDone) onDone('edit', r); }
    };
  }

  function del(r, onDone) {
    const c = can(r); if (!c.del) return R.toast(c.why || '삭제할 권한이 없습니다', 'warn');
    $('dialogBody').innerHTML = `<h3>${esc(r.inboundNo || '번호 없음')} P${esc(r.pallet || '?')} 삭제</h3>
      <div class="warnbox">삭제하면 보고서·재고에서 빠집니다. 기록은 삭제 보관함에 남아 다시 되살릴 수 있습니다.</div>
      <div class="sub">${esc(r.atText)} · ${esc(r.inspector || '')} · WMS ${fmt(r.qty)} · ${esc(r.finalResult || '')}</div>
      <label>삭제 사유 (필수)<input id="dlReason" placeholder="예: 같은 Pallet 두 번 저장, 다른 차량 라벨"></label>
      <div class="savebar"><button type="button" class="btn danger" id="dlGo">삭제</button><button type="button" class="btn ghost sm" id="dlClose">닫기</button></div>`;
    $('dialog').hidden = false; $('dlClose').onclick = close;
    $('dlGo').onclick = async () => {
      const reason = $('dlReason').value.trim(); if (!reason) { $('dlReason').focus(); return R.toast('삭제 사유를 적어 주세요', 'crit'); }
      const btn = $('dlGo'); R.busy(btn, true, '삭제 중…');
      const res = await R.tryPost('r15RecordDelete', { id: r.id, reason }); R.busy(btn, false);
      if (res && res.ok) { close(); R.toast('삭제했습니다 · 삭제 보관함에서 되살릴 수 있습니다', 'ok'); if (onDone) onDone('del', r); }
    };
  }

  function delMany(list, onDone) {
    if (!list.length) return;
    $('dialogBody').innerHTML = `<h3>${list.length}건 삭제</h3>
      <div class="sub">${list.slice(0, 30).map((r) => esc((r.inboundNo || '') + ' P' + (r.pallet || '?'))).join(', ')}${list.length > 30 ? ' 외 ' + (list.length - 30) + '건' : ''}</div>
      <label>삭제 사유 (필수, 모두 같은 사유로 남습니다)<input id="dmReason" placeholder="예: 다른 차량 라벨로 잘못 저장"></label>
      <div class="savebar"><button type="button" class="btn danger" id="dmGo">${list.length}건 삭제</button><button type="button" class="btn ghost sm" id="dmClose">닫기</button></div>`;
    $('dialog').hidden = false; $('dmClose').onclick = close;
    $('dmGo').onclick = async () => {
      const reason = $('dmReason').value.trim(); if (!reason) { $('dmReason').focus(); return R.toast('삭제 사유를 적어 주세요', 'crit'); }
      const btn = $('dmGo'); R.busy(btn, true, '삭제 중…');
      const res = await R.tryPost('r15RecordDelete', { ids: list.map((r) => r.id), reason }); R.busy(btn, false);
      if (!res || !res.ok) return;
      close(); const f = res.failed || [];
      R.toast(`${res.deleted}건 삭제했습니다${f.length ? ` · ${f.length}건은 못 지움 (${f[0].reason})` : ''} · 삭제 보관함에서 되살릴 수 있습니다`, f.length ? 'warn' : 'ok');
      if (onDone) onDone('del');
    };
  }

  async function restore(id, onDone) {
    const reason = prompt('되살리는 사유를 적어 주세요', '잘못 삭제'); if (reason == null) return;
    const res = await R.tryPost('r15RecordRestore', { id, reason: reason.trim() || '복구' });
    if (res && res.ok) { R.toast('되살렸습니다', 'ok'); if (onDone) onDone('restore', { id }); }
  }

  function changesHtml(ch) {
    const keys = Object.keys(ch || {}).filter((k) => LABEL[k] && k !== 'containerTo');
    return keys.map((k) => { const v = ch[k] || {}; return `<div>${esc(LABEL[k])}: <s>${esc(v.before == null || v.before === '' ? '빈칸' : v.before)}</s> → <b>${esc(v.after == null || v.after === '' ? '빈칸' : v.after)}</b></div>`; }).join('');
  }
  async function history(r) {
    $('dialogBody').innerHTML = `<h3>${esc(r.inboundNo || '')} P${esc(r.pallet || '?')} 변경 이력</h3><div class="muted">불러오는 중…</div>`;
    $('dialog').hidden = false;
    const res = await R.tryGet('r15History', { id: r.id });
    const items = res && res.items || [];
    $('dialogBody').innerHTML = `<h3>${esc(r.inboundNo || '')} P${esc(r.pallet || '?')} 변경 이력</h3>
      <ol class="hist">${items.map((a) => `<li class="h-${esc(a.label)}"><div><b>${esc(a.label)}</b> <span class="muted">${esc(a.atText)} · ${esc(a.actor)}</span></div>${a.reason ? `<div class="sub">사유: ${esc(a.reason)}</div>` : ''}${changesHtml(a.changes)}</li>`).join('') || '<li class="muted">이력이 없습니다.</li>'}</ol>
      <div class="savebar"><button type="button" class="btn ghost sm" id="hsClose">닫기</button></div>`;
    $('hsClose').onclick = close;
  }

  /* ---------- 검수 탭 아래 "오늘 내 기록" ---------- */
  const M = { data: null, timer: 0, lastDone: -1 };
  async function loadMine() {
    const root = $('mineView'); if (!root || !R.user || R.rank() < 1) { if (root) root.innerHTML = ''; return; }
    const res = await R.tryGet('r15Mine'); if (!res || !res.ok) return;
    M.data = res; renderMine();
  }
  function renderMine() {
    const root = $('mineView'), d = M.data; if (!root || !d) return;
    root.innerHTML = `<section><details class="mine" ${d.items.length && d.items.length <= 8 ? '' : ''}><summary><b>오늘 내 기록</b> <span class="muted">${d.items.length}건${d.deleted.length ? ` · 지운 기록 ${d.deleted.length}건` : ''}</span></summary>
      <div class="sub">잘못 저장한 Pallet는 여기서 고치거나 지울 수 있습니다. 지난 날짜나 다른 사람 기록은 중간관리자에게 요청하세요.</div>
      <div class="list">${d.items.map((r) => `<div class="row"><span><b>${esc(r.inboundNo)} P${esc(r.pallet || '?')}</b> <span class="muted">${esc(r.atText.slice(11))} · WMS ${fmt(r.qty)} · ${esc(r.finalResult || '')}${r.usedIn.length ? ' · 생산 투입됨' : ''}</span>${r.can && !r.can.edit && r.can.why ? `<span class="sub">${esc(r.can.why)}</span>` : ''}</span>${actionsHtml(r)}</div>`).join('') || '<div class="muted">오늘 저장한 기록이 없습니다.</div>'}</div>
      ${d.deleted.length ? `<div class="sub">오늘 지운 기록</div><div class="list">${d.deleted.map((x) => `<div class="row"><span><s>${esc(x.inboundNo)} P${esc(x.pallet || '?')}</s> <span class="muted">${esc(x.deletedAt)} 삭제 · ${esc(x.reason)}</span></span><button type="button" class="btn ghost sm" data-undel="${esc(x.id)}">되살리기</button></div>`).join('')}</div>` : ''}
      </details></section>`;
    bind(root, d.items, afterChange);
    root.querySelectorAll('[data-undel]').forEach((b) => { b.onclick = () => restore(b.dataset.undel, afterChange); });
    const det = root.querySelector('details.mine'); try { det.open = localStorage.getItem('r15.mineOpen') === '1'; det.ontoggle = () => { try { localStorage.setItem('r15.mineOpen', det.open ? '1' : '0'); } catch (_) {} }; } catch (_) {}
  }
  function afterChange() { loadMine(); if (R.inspect && R.inspect.refreshSaved) R.inspect.refreshSaved(); if (R.report && R.report.reload) R.report.reload(); }
  function soon() { clearTimeout(M.timer); M.timer = setTimeout(loadMine, 1500); }

  R.on('login', soon);
  R.on('queue', (s) => { if (s && s.done !== M.lastDone) { M.lastDone = s.done; if (document.body.dataset.tab === 'inspect') soon(); } });
  R.rec = { actionsHtml, bind, edit, del, delMany, restore, history, loadMine };
})();
