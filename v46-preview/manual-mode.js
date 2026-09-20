/* 공병 입고 확인 — 코드 없는 일반 라벨 / 직접입력 보강
 * 기존 app.js 로직은 유지하고, 사용자가 명시적으로 선택할 수 있는 직접입력 동선만 추가한다.
 */
(function () {
  'use strict';

  function byId(id) { return document.getElementById(id); }

  function addButton(parent, beforeEl, text, onClick, extraClass) {
    if (!parent) return null;
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'btn outline' + (extraClass ? ' ' + extraClass : '');
    btn.textContent = text;
    btn.addEventListener('click', onClick);
    if (beforeEl) parent.insertBefore(btn, beforeEl);
    else parent.appendChild(btn);
    return btn;
  }

  function focusAndScroll(id) {
    const el = byId(id);
    if (!el) return;
    try { el.scrollIntoView({ behavior: 'smooth', block: 'center' }); } catch (e) { el.scrollIntoView(); }
    setTimeout(function () { try { el.focus(); } catch (e) {} }, 250);
  }

  window.useManualSingle = function () {
    try { if (typeof stopScanner === 'function') stopScanner(); } catch (e) {}
    if (typeof setStatus === 'function') {
      setStatus('wmsStatus', '코드 없는 일반 라벨 · 아래 WMS 입고정보를 직접 입력하세요. 업체 라벨은 촬영하거나 직접 입력할 수 있습니다.', 'warn');
    }
    focusAndScroll('inboundNo');
  };

  window.useManualMulti = function () {
    try { if (typeof stopScanner === 'function') stopScanner(); } catch (e) {}
    if (typeof setStatus === 'function') {
      setStatus('multiBaseStatus', '코드 없는 일반 라벨 · 품명·품목코드·공급업체·수량·입고번호를 직접 입력한 뒤 아래에서 파레트를 등록하세요.', 'warn');
    }
    focusAndScroll('mProduct');
  };

  window.loopManual = function () {
    const product = byId('mProduct') ? byId('mProduct').value.trim() : '';
    if (!product) {
      if (typeof setStatus === 'function') setStatus('loopStatus', '먼저 위에서 입고 기준정보를 입력하세요.', 'bad');
      focusAndScroll('mProduct');
      return;
    }

    const entered = window.prompt('용기번호 또는 파레트 식별번호가 있으면 입력하세요.\n없으면 빈칸으로 확인을 누르세요.', '');
    if (entered === null) return;

    const inboundNo = byId('mInboundNo') ? byId('mInboundNo').value.trim() : '';
    const seq = (typeof palletSeq !== 'undefined' && palletSeq) ? palletSeq : 1;
    const tag = '직접입력-' + (inboundNo || 'NO') + '-' + seq;

    currentPallet = currentPallet || {};
    currentPallet.code = tag; // 기존 저장/완료 로직과 호환되는 내부 식별값
    currentPallet.inboundNo = inboundNo;
    currentPallet.containerNo = String(entered || '').trim();
    currentPallet.itemCode = byId('mItemCode') ? byId('mItemCode').value.trim() : '';
    currentPallet.product = product;
    currentPallet.supplier = byId('mSupplier') ? byId('mSupplier').value.trim() : '';
    currentPallet.qty = (typeof num === 'function' && byId('mQty')) ? num(byId('mQty').value) : 0;
    currentPallet.unit = 'EA';
    currentPallet.scanTime = new Date().toLocaleTimeString('ko-KR');
    currentPallet.note = [currentPallet.note || '', '코드 없는 일반 라벨 · 직접 입력'].filter(Boolean).join(' / ');

    if (typeof renderLoop === 'function') renderLoop();
    if (typeof setStatus === 'function') {
      setStatus('loopStatus', '직접 등록 완료' + (currentPallet.containerNo ? ' · 용기번호 ' + currentPallet.containerNo : '') + ' · 업체라벨을 촬영한 뒤 파레트를 완료하세요.', 'warn');
    }
  };

  function removeVisibleVersion() {
    const sub = document.querySelector('header .sub');
    if (!sub) return;
    sub.textContent = sub.textContent.replace(/\s*·\s*V\d+(?:\.\d+)*\s*$/i, '');
  }

  function init() {
    // app.js의 DOMContentLoaded 처리까지 끝난 다음 버전 표기를 제거한다.
    setTimeout(removeVisibleVersion, 0);
    setTimeout(removeVisibleVersion, 400);

    // 단건: 스캔/촬영/갤러리 외에 직접 입력을 명시적으로 제공
    const singleCard = byId('btnScanSingle') && byId('btnScanSingle').closest('.card');
    if (singleCard && !byId('btnManualSingle')) {
      const reader = byId('readerWrapSingle');
      const btn = addButton(singleCard, reader, '✍ 코드 없음 / 직접 입력', window.useManualSingle);
      if (btn) btn.id = 'btnManualSingle';
    }

    // 다중 기준정보: 숨겨져 있던 갤러리 입력 동선을 노출하고 직접 입력을 추가
    const multiCard = byId('mSetupCard');
    if (multiCard) {
      const reader = byId('readerWrapMulti');
      if (!byId('btnMultiGallery') && byId('multiPhotoGallery')) {
        const btnGallery = addButton(multiCard, reader, '🖼 갤러리에서 불러오기', function () { byId('multiPhotoGallery').click(); });
        if (btnGallery) btnGallery.id = 'btnMultiGallery';
      }
      if (!byId('btnManualMulti')) {
        const btnManual = addButton(multiCard, reader, '✍ 코드 없음 / 직접 입력', window.useManualMulti);
        if (btnManual) btnManual.id = 'btnManualMulti';
      }
    }

    // 다중 파레트 반복 등록: 바코드가 없어도 직접 등록 가능
    const scanStep = byId('stepScan');
    const loopSteps = scanStep && scanStep.parentElement;
    if (loopSteps && !byId('stepManual')) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.id = 'stepManual';
      btn.className = 'loop-btn';
      btn.innerHTML = '<span class="loop-ic">✍</span><span>코드 없음 / 직접 등록</span><span class="loop-chk"></span>';
      btn.addEventListener('click', window.loopManual);
      scanStep.insertAdjacentElement('afterend', btn);
    }
  }

  if (document.readyState === 'complete') init();
  else window.addEventListener('load', init, { once: true });
})();
