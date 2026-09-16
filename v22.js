/* 공병 입고 확인 V22
 * - 현장 작업용 하단 퀵바
 * - 사진 OCR 병렬 처리 + 실시간 카메라 OCR
 * - 생산 다중 작업자 공유 세션 / 서버 잠금 연동
 * - 조회 다중 선택 / 사진 포함 A4 / 임원·조사 보고서
 */
(function () {
  'use strict';

  const V22 = {
    activeTab: 'single',
    selectedIds: new Set(),
    live: { mode: '', stream: null, running: false, busy: false, timer: null, bestScore: 0 },
    prodTimer: null,
    reportType: 'executive'
  };

  function el(id) { return document.getElementById(id); }
  function val(id) { const x = el(id); return x ? x.value.trim() : ''; }
  function safeText(s) { return typeof esc === 'function' ? esc(s == null ? '' : s) : String(s == null ? '' : s); }
  function n(v) { return Number(String(v || '').replace(/,/g, '')) || 0; }

  function initQuickBar() {
    if (el('workerQuickBar')) return;
    const bar = document.createElement('div');
    bar.id = 'workerQuickBar';
    bar.className = 'worker-quickbar';
    document.body.appendChild(bar);
    updateQuickBar('single');
  }

  function qbtn(text, fn, cls) {
    return `<button type="button" class="btn ${cls || ''}" onclick="${fn}">${text}</button>`;
  }

  function updateQuickBar(tab) {
    V22.activeTab = tab;
    const bar = el('workerQuickBar');
    if (!bar) return;
    if (tab === 'single') {
      bar.innerHTML = qbtn('📊 스캔', "startScanner('single')", 'primary') + qbtn('📷 촬영', "document.getElementById('wmsPhoto').click()", '') + qbtn('💾 저장', 'saveSingleRecord()', '');
    } else if (tab === 'multi') {
      bar.innerHTML = qbtn('📊 파레트', 'v22MultiScan()', 'primary') + qbtn('📷 업체라벨', "document.getElementById('loopVendorPhoto').click()", '') + qbtn('💾 전체저장', 'saveMultiRecord()', '');
    } else if (tab === 'prod') {
      bar.innerHTML = qbtn('📊 투입 스캔', 'startProdScan()', 'primary') + qbtn('↻ 동기화', 'syncProductionSession()', '') + qbtn('나가기', 'leaveProductionSession()', 'mini');
    } else if (tab === 'view') {
      bar.innerHTML = qbtn('🔎 검색', 'searchViewRecords()', 'primary') + qbtn('🖨 선택출력', 'printSelectedRecords()', '') + qbtn('📄 보고서', "openReportBuilder('executive')", '');
    } else {
      bar.innerHTML = qbtn('↻ 새로고침', 'loadDashboard()', 'primary');
    }
  }

  window.v22MultiScan = function () {
    if (!val('mProduct')) startScanner('base');
    else loopScan();
  };

  function addAfter(ref, node) { if (ref && ref.parentNode) ref.parentNode.insertBefore(node, ref.nextSibling); }
  function makeBtn(text, fn, id) {
    const b = document.createElement('button'); b.type = 'button'; b.className = 'btn outline'; b.textContent = text;
    if (id) b.id = id; b.addEventListener('click', fn); return b;
  }

  function initWorkerInputs() {
    if (!el('v22ManualSingle') && el('btnScanSingle')) {
      const b = makeBtn('✍ 코드 없음 / 직접 입력', function () {
        stopAllCameras();
        setStatus('wmsStatus', '코드가 없는 라벨입니다. 아래 입고정보를 직접 입력해 주세요.', 'warn');
        el('inboundNo').scrollIntoView({ behavior: 'smooth', block: 'center' });
        setTimeout(function () { el('inboundNo').focus(); }, 250);
      }, 'v22ManualSingle');
      addAfter(el('wmsPhotoGallery').nextElementSibling || el('btnScanSingle'), b);
    }

    if (!el('v22ManualMulti') && el('mSetupCard')) {
      const b = makeBtn('✍ 코드 없음 / 기준정보 직접 입력', function () {
        stopAllCameras();
        setStatus('multiBaseStatus', '품명·품목코드·공급업체·수량·입고번호를 직접 입력해 주세요.', 'warn');
        el('mProduct').scrollIntoView({ behavior: 'smooth', block: 'center' });
        setTimeout(function () { el('mProduct').focus(); }, 250);
      }, 'v22ManualMulti');
      const status = el('multiBaseStatus');
      if (status) status.parentNode.insertBefore(b, status);
    }

    if (!el('v22ManualPallet') && el('stepScan')) {
      const b = document.createElement('button');
      b.type = 'button'; b.id = 'v22ManualPallet'; b.className = 'loop-btn';
      b.innerHTML = '<span class="loop-ic">✍</span><span>코드 없음 / 직접 등록</span><span class="loop-chk"></span>';
      b.onclick = function () {
        if (!val('mProduct')) { setStatus('loopStatus', '먼저 기준정보를 입력하세요.', 'bad'); return; }
        const c = window.prompt('용기번호/파레트 식별번호가 있으면 입력하세요. 없으면 빈칸으로 확인하세요.', '');
        if (c === null) return;
        currentPallet = currentPallet || {};
        currentPallet.code = '직접입력-' + (val('mInboundNo') || 'NO') + '-' + palletSeq;
        currentPallet.inboundNo = val('mInboundNo'); currentPallet.containerNo = String(c || '').trim();
        currentPallet.itemCode = val('mItemCode'); currentPallet.product = val('mProduct');
        currentPallet.supplier = val('mSupplier'); currentPallet.qty = num(val('mQty')); currentPallet.unit = 'EA';
        currentPallet.scanTime = new Date().toLocaleTimeString('ko-KR');
        currentPallet.note = [currentPallet.note || '', '코드 없음·직접입력'].filter(Boolean).join(' / ');
        renderLoop();
        setStatus('loopStatus', '직접 등록되었습니다. 업체라벨 촬영 후 완료하세요.', 'warn');
      };
      el('stepScan').insertAdjacentElement('afterend', b);
    }

    addLiveButton('wms', el('btnScanSingle'));
    const vendorPhotoBtn = el('vendorPhoto') && el('vendorPhoto').parentElement.querySelector('button.primary');
    addLiveButton('vendor', vendorPhotoBtn);
    const multiPhotoBtn = el('multiPhoto') && el('multiPhoto').parentElement.querySelector('button.btn.outline');
    addLiveButton('multi', multiPhotoBtn);
  }

  function addLiveButton(mode, afterButton) {
    const id = 'v22LiveBtn_' + mode;
    if (!afterButton || el(id)) return;
    const b = makeBtn('📹 실시간 인식', function () { v22StartLiveOcr(mode); }, id);
    addAfter(afterButton, b);
  }

  function stopAllCameras() {
    try { stopScanner(); } catch (e) {}
    v22StopLiveOcr();
  }

  function modeStatus(mode) { return mode === 'vendor' ? 'vendorStatus' : mode === 'multi' ? 'multiBaseStatus' : 'wmsStatus'; }
  function modePreview(mode) { return mode === 'vendor' ? 'vendorPreview' : mode === 'multi' ? 'multiPreview' : 'wmsPreview'; }
  function modeCard(mode) {
    const p = el(modePreview(mode));
    return p ? p.closest('.card') : null;
  }

  function captureLiveFrame(maxSide) {
    const video = el('v22LiveVideo');
    if (!video || !video.videoWidth) return '';
    const sx = Math.round(video.videoWidth * .05), sy = Math.round(video.videoHeight * .12);
    const sw = Math.round(video.videoWidth * .90), sh = Math.round(video.videoHeight * .76);
    const scale = Math.min(1, (maxSide || 1400) / Math.max(sw, sh));
    const c = document.createElement('canvas'); c.width = Math.max(1, Math.round(sw * scale)); c.height = Math.max(1, Math.round(sh * scale));
    c.getContext('2d').drawImage(video, sx, sy, sw, sh, 0, 0, c.width, c.height);
    return c.toDataURL('image/jpeg', .82);
  }

  function scoreRaw(mode, raw) {
    try {
      const p = mode === 'vendor' ? parseVendorLabel(raw) : parseLabelText(raw);
      return Object.keys(p || {}).filter(function (k) { return p[k]; }).length;
    } catch (e) { return 0; }
  }

  function applyRaw(mode, raw, engine) {
    if (!raw || !raw.trim()) return 0;
    lastOcrEngine = engine || '인식';
    lastOcrText[mode] = raw;
    if (mode === 'wms') lastOcrText.single = raw;
    const parsed = mode === 'vendor' ? {} : parseLabelText(raw);
    const msg = applyOcrToMode(mode, parsed);
    if (parsed && parsed.itemCode && typeof loadItemInfo === 'function') loadItemInfo(parsed.itemCode);
    setStatus(modeStatus(mode), msg, 'ok');
    return scoreRaw(mode, raw);
  }

  window.v22StartLiveOcr = async function (mode) {
    stopAllCameras();
    V22.live.mode = mode; V22.live.bestScore = 0;
    let stream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' }, width: { ideal: 1600 }, height: { ideal: 1200 } }, audio: false });
    } catch (e) {
      setStatus(modeStatus(mode), '카메라 실행 실패: ' + e, 'bad'); return;
    }
    V22.live.stream = stream; V22.live.running = true;
    const card = modeCard(mode); if (!card) return;
    let wrap = el('v22LiveWrap');
    if (wrap) wrap.remove();
    wrap = document.createElement('div'); wrap.id = 'v22LiveWrap'; wrap.className = 'v22-live';
    wrap.innerHTML = '<video id="v22LiveVideo" playsinline autoplay muted></video><div class="live-guide"></div><div class="controls"><button class="btn primary" type="button" onclick="v22CaptureLive()">📷 현재 화면 촬영·정밀인식</button><button class="btn outline" type="button" onclick="v22StopLiveOcr()">닫기</button></div><div class="v22-live-status" id="v22LiveStatus">라벨을 사각형 안에 맞추면 자동으로 내용을 읽습니다.</div>';
    card.appendChild(wrap);
    const video = el('v22LiveVideo'); video.srcObject = stream; await video.play();
    setStatus(modeStatus(mode), '실시간 인식 중 · 촬영 버튼을 누르면 사진도 함께 저장됩니다.', 'warn');
    setTimeout(v22LiveTick, 700);
  };

  async function v22LiveTick() {
    if (!V22.live.running || V22.live.busy) return;
    V22.live.busy = true;
    try {
      const img = captureLiveFrame(1150);
      if (img) {
        const worker = await getOcrWorker('');
        const prepped = await preprocessForOcr(img);
        const ret = await worker.recognize(prepped);
        const raw = (ret.data && ret.data.text) || '';
        const score = scoreRaw(V22.live.mode, raw);
        if (score > 0 && score >= V22.live.bestScore) {
          V22.live.bestScore = score;
          applyRaw(V22.live.mode, raw, '실시간');
          const s = el('v22LiveStatus'); if (s) s.textContent = '자동 인식 ' + score + '개 항목 · 필요하면 현재 화면 촬영으로 정밀 확인하세요.';
        }
      }
    } catch (e) {}
    V22.live.busy = false;
    if (V22.live.running) V22.live.timer = setTimeout(v22LiveTick, 1300);
  }

  window.v22CaptureLive = async function () {
    if (!V22.live.running) return;
    const mode = V22.live.mode;
    const img = captureLiveFrame(1800); if (!img) return;
    lastPhotoDataUrl[mode] = img; if (mode === 'wms') lastPhotoDataUrl.single = img;
    const preview = el(modePreview(mode)); if (preview) { preview.src = img; preview.classList.remove('hidden'); }
    const st = el('v22LiveStatus'); if (st) st.textContent = '사진 저장됨 · 정밀 OCR 확인 중...';
    try {
      const raw = await runOcr(img, '');
      applyRaw(mode, raw, lastOcrEngine || '정밀');
      if (st) st.textContent = '촬영·정밀 인식 완료. 입력값을 확인하세요.';
    } catch (e) {
      if (st) st.textContent = '사진은 저장됐지만 정밀 인식에 실패했습니다. 직접 확인해 주세요.';
    }
  };

  window.v22StopLiveOcr = function () {
    V22.live.running = false; V22.live.busy = false;
    if (V22.live.timer) clearTimeout(V22.live.timer);
    if (V22.live.stream) { V22.live.stream.getTracks().forEach(function (t) { t.stop(); }); V22.live.stream = null; }
    const w = el('v22LiveWrap'); if (w) w.remove();
  };

  window.labelPhotoSelected = async function (event, mode) {
    const file = event.target.files && event.target.files[0]; if (!file) return;
    event.target.value = '';
    const dataUrl = await fileToDataUrl(file);
    const stored = await shrinkForUpload(dataUrl, 1600, .8);
    lastPhotoDataUrl[mode] = stored; if (mode === 'wms') lastPhotoDataUrl.single = stored;
    const preview = el(modePreview(mode)); if (preview) { preview.src = dataUrl; preview.classList.remove('hidden'); }
    setStatus(modeStatus(mode), '사진 저장됨 · OCR 인식 중... 입력 화면은 계속 사용할 수 있습니다.', 'warn');

    const localP = (async function () {
      const worker = await getOcrWorker(''); const prepped = await preprocessForOcr(dataUrl);
      const ret = await worker.recognize(prepped); return { raw: (ret.data && ret.data.text) || '', engine: '기기 빠른인식' };
    })();
    const serverP = (async function () {
      if (!CONFIG.API_URL || CONFIG.API_URL.indexOf('PUT_YOUR') === 0) return { raw: '', engine: '서버' };
      const sending = await shrinkForUpload(dataUrl, 1600, .82);
      const r = await apiPost('ocr', { image: sending });
      return { raw: r.ok ? (r.text || '') : '', engine: '구글 정밀인식' };
    })();

    let best = 0;
    [localP, serverP].forEach(function (pr) {
      pr.then(function (r) {
        const sc = scoreRaw(mode, r.raw);
        if (sc > 0 && sc >= best) { best = sc; applyRaw(mode, r.raw, r.engine); }
      }).catch(function () {});
    });
    try { await Promise.allSettled([localP, serverP]); } catch (e) {}
    if (!best) setStatus(modeStatus(mode), '사진은 저장했습니다. 자동인식이 부족해 직접 입력이 필요합니다.', 'warn');
  };

  function initProductionUi() {
    const registrant = el('prodRegistrant');
    if (registrant) {
      const field = registrant.closest('.field'); const setup = el('prodSetupCard'); const details = setup && setup.querySelector('details.optional');
      if (field && details) { details.parentNode.insertBefore(field, details); field.querySelector('label').textContent = '작업자 (필수)'; }
      if (!registrant.value && typeof getRememberedInspector === 'function') registrant.value = getRememberedInspector();
    }
    if (!el('prodSharedInfo') && el('prodRunCard')) {
      const info = document.createElement('div'); info.id = 'prodSharedInfo'; info.className = 'prod-shared';
      info.innerHTML = '공유 작업 세션 · 다른 작업자와 같은 제품/제조번호를 선택하면 자동 합류합니다.';
      el('prodRunCard').insertBefore(info, el('prodRunCard').children[1] || null);
    }
    const oldEnd = el('prodRunCard') && Array.from(el('prodRunCard').querySelectorAll('button')).find(function (b) { return /작업 종료/.test(b.textContent); });
    if (oldEnd) { oldEnd.textContent = '내 작업 종료 (세션 유지)'; oldEnd.onclick = window.leaveProductionSession; }
    if (!el('btnCompleteLot') && oldEnd) {
      const b = makeBtn('✓ 로트 작업 완료 (전체 종료)', function () { completeProductionLot(); }, 'btnCompleteLot');
      b.style.marginTop = '8px'; addAfter(oldEnd, b);
    }
  }

  window.startProductionSession = async function () {
    const productName = val('prodProductName'), lotNo = val('prodLotNo'), operator = val('prodRegistrant');
    if (!productName) { setStatus('prodSetupStatus', '제품명을 입력하세요.', 'bad'); return; }
    if (!lotNo) { setStatus('prodSetupStatus', '제조번호를 입력하세요.', 'bad'); return; }
    if (!operator) { setStatus('prodSetupStatus', '작업자명을 입력하세요.', 'bad'); el('prodRegistrant').focus(); return; }
    setStatus('prodSetupStatus', '진행 중인 같은 로트를 확인하는 중...', 'warn');
    try {
      const res = await apiPost('startProduction', { productName: productName, lotNo: lotNo, prodDate: val('prodDate'), prodQty: val('prodQty'), note: val('prodNote'), registrant: operator });
      if (!res.ok) { setStatus('prodSetupStatus', '시작 실패: ' + res.message, 'bad'); return; }
      prodSession = { id: res.id, productName: productName, lotNo: lotNo, operator: operator };
      if (typeof rememberInspector === 'function') rememberInspector(operator);
      el('prodSetupCard').classList.add('hidden'); el('prodRunCard').classList.remove('hidden');
      el('runProduct').textContent = productName; el('runLot').textContent = lotNo;
      setStatus('saveProdStatus', res.joined ? '기존 진행 중 로트에 합류했습니다.' : '새 생산 작업을 시작했습니다.', 'ok');
      await syncProductionSession();
    } catch (e) { setStatus('prodSetupStatus', '시작 실패: ' + e, 'bad'); }
  };

  window.onProdCode = async function (text) {
    await stopScanner(); if (!prodSession) return;
    setStatus('prodSearchStatus', '등록 중... ' + text, 'warn');
    try {
      const res = await apiPost('scanProductionPallet', { productionId: prodSession.id, keyword: text, operator: prodSession.operator || '' });
      if (!res.ok) {
        setStatus('prodSearchStatus', res.duplicate ? '이미 다른 작업자가 등록한 파레트입니다.' : (res.message || '등록 실패'), res.duplicate ? 'warn' : 'bad');
        await syncProductionSession(); return;
      }
      if (navigator.vibrate) navigator.vibrate(60);
      setStatus('prodSearchStatus', '등록 완료 · #' + res.seq + ' · 다음 파레트를 스캔하세요.', 'ok');
      await syncProductionSession();
    } catch (e) { setStatus('prodSearchStatus', '등록 실패: ' + e, 'bad'); }
  };

  window.addProdPallet = async function (it) {
    if (!it || !prodSession) return;
    setStatus('prodSearchStatus', '등록 중...', 'warn');
    try {
      const res = await apiPost('addProductionPallet', Object.assign({}, it, { productionId: prodSession.id, operator: prodSession.operator || '' }));
      if (!res.ok) setStatus('prodSearchStatus', res.duplicate ? '이미 등록된 파레트입니다.' : ('저장 실패: ' + res.message), res.duplicate ? 'warn' : 'bad');
      else setStatus('prodSearchStatus', '등록 완료 · #' + res.seq, 'ok');
      await syncProductionSession();
    } catch (e) { setStatus('prodSearchStatus', '저장 실패: ' + e, 'bad'); }
  };

  window.syncProductionSession = async function () {
    if (!prodSession) { setStatus('saveProdStatus', '진행 중인 생산 작업이 없습니다.', ''); return; }
    try {
      const res = await apiGet('getProductionSession', { id: prodSession.id });
      if (!res.ok) return;
      const s = res.session || {};
      if (s.status === '완료') setStatus('saveProdStatus', '이 로트는 다른 작업자에 의해 완료 처리되었습니다.', 'warn');
      prodSelectedPallets = res.pallets || [];
      renderProdSelected();
      const info = el('prodSharedInfo');
      if (info) info.innerHTML = '<b>공유 작업</b> · 참여: ' + safeText(s.participants || '-') + ' · 서버 기준 ' + Number(s.palletCount || 0).toLocaleString() + ' 파레트 / ' + Number(s.total || 0).toLocaleString() + '개' + (s.recentAt ? ' · 최근 ' + safeText(s.recentAt) : '');
    } catch (e) {}
  };

  window.renderProdSelected = function () {
    const total = prodSelectedPallets.reduce(function (s, p) { return s + n(p.qty); }, 0);
    if (el('prodPalletCount')) el('prodPalletCount').textContent = prodSelectedPallets.length;
    if (el('prodPalletTotal')) el('prodPalletTotal').textContent = total.toLocaleString();
    if (el('runCount')) el('runCount').textContent = prodSelectedPallets.length;
    const box = el('prodSelected'); if (!box) return;
    if (!prodSelectedPallets.length) { box.innerHTML = '<div class="status">아직 등록한 파레트가 없습니다.</div>'; return; }
    box.innerHTML = prodSelectedPallets.slice().reverse().map(function (p) {
      return '<div class="pallet-item"><div><div>' + safeText(p.inboundNo) + '-' + safeText(p.containerNo) + ' · ' + safeText(p.product || '') + '</div><div class="code">' + n(p.qty).toLocaleString() + safeText(p.unit || '') + ' · ' + safeText(p.result || '') + (p.operator ? ' · 작업자 ' + safeText(p.operator) : '') + (p.registeredAt ? ' · ' + safeText(p.registeredAt) : '') + '</div></div><div class="tag-ok">#' + safeText(p.seq || '') + '</div></div>';
    }).join('');
  };

  window.leaveProductionSession = function () {
    if (!prodSession) return;
    if (!window.confirm('내 화면에서만 작업을 종료합니다. 다른 작업자는 같은 로트를 계속 작업할 수 있습니다.')) return;
    prodSession = null; prodSelectedPallets = [];
    el('prodRunCard').classList.add('hidden'); el('prodSetupCard').classList.remove('hidden');
    renderProdSelected(); setStatus('prodSetupStatus', '제품명과 제조번호를 입력하면 진행 중 세션이 있으면 자동 합류합니다.', '');
  };

  window.completeProductionLot = async function () {
    if (!prodSession) return;
    if (!window.confirm('이 생산 로트를 전체 완료 처리할까요? 다른 작업자도 더 이상 파레트를 추가할 수 없습니다.')) return;
    setStatus('saveProdStatus', '로트 완료 처리 중...', 'warn');
    try {
      const res = await apiPost('completeProduction', { productionId: prodSession.id, note: val('prodNote'), prodQty: val('prodQty'), prodDate: val('prodDate'), operator: prodSession.operator || '' });
      if (!res.ok) { setStatus('saveProdStatus', '완료 실패: ' + res.message, 'bad'); return; }
      setStatus('saveProdStatus', '로트 완료 · ' + res.palletCount + ' 파레트 / ' + Number(res.total || 0).toLocaleString() + '개', 'ok');
      setTimeout(function () { prodSession = null; prodSelectedPallets = []; el('prodRunCard').classList.add('hidden'); el('prodSetupCard').classList.remove('hidden'); }, 500);
    } catch (e) { setStatus('saveProdStatus', '완료 실패: ' + e, 'bad'); }
  };

  function initViewUi() {
    const results = el('viewSearchResults'); if (!results || el('v22BatchActions')) return;
    const box = document.createElement('div'); box.id = 'v22BatchActions'; box.className = 'batch-actions hidden';
    box.innerHTML = '<div class="line"><label><input type="checkbox" id="v22SelectAll" onchange="v22SelectAllRecords(this.checked)"> 전체 선택</label><b id="v22SelectedCount">0건 선택</b><label><input type="checkbox" id="v22IncludePhotos" checked> 사진 포함</label></div><div class="line" style="margin-top:8px"><button class="btn primary" onclick="printSelectedRecords()">🖨 선택 A4 출력</button><button class="btn outline" onclick="openReportBuilder(\'executive\')">임원보고</button><button class="btn outline" onclick="openReportBuilder(\'investigation\')">조사보고서</button></div><div class="speed-note">사진 포함 출력은 선택 기록에서 최대 8장의 증빙 사진을 자동 삽입합니다.</div>';
    results.parentNode.appendChild(box);

    const detail = el('viewDetailCard');
    const report = document.createElement('div'); report.id = 'v22ReportCard'; report.className = 'card report-card hidden';
    report.innerHTML = '<p class="step-title">보고서 출력</p><div class="field"><label>제목</label><input id="v22ReportTitle"></div><div class="field"><label>목적 (1줄)</label><input id="v22ReportPurpose" maxlength="140"></div><div class="report-grid"><div class="field"><label>결론</label><textarea id="v22ReportConclusion"></textarea></div><div class="field"><label>Impact</label><textarea id="v22ReportImpact"></textarea></div></div><div class="report-grid"><div class="field"><label>Risk</label><textarea id="v22ReportRisk"></textarea></div><div class="field"><label>근본원인 및 재발방지대책</label><textarea id="v22ReportAction" placeholder="조사 결과에 따라 직접 입력"></textarea></div></div><div class="field"><label>조사내용 / 타임라인 (조사보고서용)</label><textarea id="v22ReportInvestigation"></textarea></div><button class="btn primary" onclick="printV22Report()">보고서 A4 출력</button><button class="btn ghost" onclick="document.getElementById(\'v22ReportCard\').classList.add(\'hidden\')">닫기</button>';
    if (detail) detail.insertAdjacentElement('afterend', report); else results.parentNode.parentNode.appendChild(report);
  }

  window.searchViewRecords = async function () {
    const kw = val('viewSearchKw');
    if (!kw) { setStatus('viewSearchStatus', '검색어를 입력하세요.', 'bad'); return; }
    setStatus('viewSearchStatus', '검색 중...', 'warn'); el('viewDetailCard').classList.add('hidden');
    try {
      const res = await apiGet('searchRecords', { keyword: kw });
      if (!res.ok) { setStatus('viewSearchStatus', '검색 실패: ' + res.message, 'bad'); return; }
      viewSearchResultsList = res.items || []; V22.selectedIds.clear(); updateBatchCount();
      const box = el('viewSearchResults');
      if (!viewSearchResultsList.length) { box.innerHTML = ''; el('v22BatchActions').classList.add('hidden'); setStatus('viewSearchStatus', '일치하는 기록이 없습니다.', 'bad'); return; }
      el('v22BatchActions').classList.remove('hidden');
      setStatus('viewSearchStatus', viewSearchResultsList.length + '건 검색됨 · 여러 건을 체크해 한 번에 출력할 수 있습니다.', 'ok');
      box.innerHTML = viewSearchResultsList.map(function (it, i) {
        return '<div class="result-item result-select" onclick="openRecordDetail(' + i + ')"><input type="checkbox" aria-label="기록 선택" onclick="event.stopPropagation();v22ToggleRecord(\'' + safeText(String(it.id)).replace(/'/g, '') + '\',this.checked)"><div><div>' + safeText(it.product) + ' · ' + safeText(String(it.qty)) + safeText(it.unit || '') + '</div><div class="meta">입고번호 ' + safeText(it.inboundNo) + ' · ' + safeText(it.mode) + ' · ' + safeText(it.regDate) + '</div></div><div>›</div></div>';
      }).join('');
    } catch (e) { setStatus('viewSearchStatus', '검색 실패: ' + e, 'bad'); }
  };

  window.v22ToggleRecord = function (id, checked) { if (checked) V22.selectedIds.add(String(id)); else V22.selectedIds.delete(String(id)); updateBatchCount(); };
  window.v22SelectAllRecords = function (checked) {
    V22.selectedIds.clear(); if (checked) viewSearchResultsList.forEach(function (x) { V22.selectedIds.add(String(x.id)); });
    document.querySelectorAll('#viewSearchResults input[type=checkbox]').forEach(function (x) { x.checked = checked; }); updateBatchCount();
  };
  function updateBatchCount() { const c = el('v22SelectedCount'); if (c) c.textContent = V22.selectedIds.size + '건 선택'; const a = el('v22SelectAll'); if (a) a.checked = !!viewSearchResultsList.length && V22.selectedIds.size === viewSearchResultsList.length; }

  function selectedIdsOrCurrent() {
    const ids = Array.from(V22.selectedIds);
    if (!ids.length && currentViewRecord && currentViewRecord.record) ids.push(String(currentViewRecord.record.id));
    return ids;
  }

  async function fetchPrintBundle(ids, includePhotos) { return apiPost('getPrintBundle', { ids: ids, includePhotos: !!includePhotos }); }

  function recordPageHtml(item, pageBreak) {
    const r = item.record || {}, pallets = item.pallets || [], photos = item.photos || [];
    const rows = function (a, b) { return '<tr><th>' + safeText(a) + '</th><td>' + safeText(b == null ? '' : b) + '</td></tr>'; };
    const pRows = pallets.map(function (p) { return '<tr><td>' + safeText(p.seq || '') + '</td><td>' + safeText(p.containerNo || p.code || '') + '</td><td>' + safeText(p.product || '') + '</td><td>' + safeText(p.qty || '') + safeText(p.unit || '') + '</td><td>' + safeText(p.result || '') + '</td></tr>'; }).join('');
    const photoHtml = photos.length ? '<div class="photos">' + photos.map(function (p) { return '<figure><img src="' + p.dataUrl + '"><figcaption>' + safeText(p.label) + '</figcaption></figure>'; }).join('') + '</div>' : '';
    return '<section class="record-page' + (pageBreak ? ' page-break' : '') + '"><h1>공병 입고 확인 기록서</h1><div class="meta">기록 ID: ' + safeText(r.id) + ' · 등록일시: ' + safeText(r.regDate) + ' · ' + safeText(r.mode) + '</div><table>' + rows('입고번호', r.inboundNo) + rows('입고일자', r.inboundDate) + rows('품명', r.product) + rows('품목코드', r.itemCode) + rows('제조원', r.manufacturer) + rows('공급업체', r.supplier) + rows('표시수량', String(r.displayQty || '') + String(r.unit || '')) + rows('사용기한', r.expiryDate) + (String(r.mode || '') === '단건' ? rows('입고정보 일치', r.infoMatch) + rows('혼입 여부', r.mixed) + rows('실제 확인수량', r.actualQty) : '') + (String(r.mode || '').indexOf('다중') === 0 ? rows('파레트 수', r.palletCount) + rows('총 수량', r.totalQty) + rows('이종 수', r.mixedCount) : '') + (r.labelMatch ? rows('라벨 대조', r.labelMatch) : '') + (r.vendorProduct ? rows('업체라벨 품명', r.vendorProduct) : '') + (r.vendorLotNo ? rows('업체 Lot/P-번호', r.vendorLotNo) : '') + rows('최종 결과', r.finalResult) + rows('검수자', r.inspector) + rows('특이사항', r.note) + '</table>' + (pallets.length ? '<table><tr><th>#</th><th>용기번호</th><th>품명</th><th>수량</th><th>판정</th></tr>' + pRows + '</table>' : '') + photoHtml + '<div class="sign"><div>검수자</div><div>확인자</div></div></section>';
  }

  function openHtmlPrint(title, body) {
    const html = '<!DOCTYPE html><html lang="ko"><head><meta charset="UTF-8"><title>' + safeText(title) + '</title><style>@page{size:A4;margin:12mm}body{font-family:Malgun Gothic,sans-serif;color:#1C1B19;margin:0}h1{font-size:18px;border-bottom:2px solid #1F4B5F;padding-bottom:7px;margin:0 0 8px}h2{font-size:15px;margin:12px 0 6px}.meta{font-size:11px;color:#666;margin-bottom:8px}table{width:100%;border-collapse:collapse;margin:8px 0;font-size:11px}th,td{border:1px solid #bbb;padding:5px 6px;text-align:left;vertical-align:top}th{background:#f0efe9}.record-page{min-height:268mm;box-sizing:border-box}.page-break{page-break-after:always}.sign{display:flex;justify-content:flex-end;gap:34px;margin-top:24px;font-size:11px}.sign div{width:110px;border-top:1px solid #333;text-align:center;padding-top:5px}.photos{display:grid;grid-template-columns:repeat(3,1fr);gap:6px;margin-top:8px}.photos figure{margin:0;border:1px solid #ccc;padding:4px;break-inside:avoid}.photos img{width:100%;height:110px;object-fit:contain;display:block}.photos figcaption{font-size:9px;text-align:center;color:#666;margin-top:3px}.report-head{border-bottom:3px solid #1F4B5F;padding-bottom:8px}.report-block{border:1px solid #ccc;margin:8px 0}.report-block h2{margin:0;padding:6px 8px;background:#f0efe9}.report-block div{padding:8px;font-size:12px;white-space:pre-wrap}.summary-kpi{display:grid;grid-template-columns:repeat(4,1fr);gap:6px;margin:8px 0}.summary-kpi div{border:1px solid #ccc;padding:7px;text-align:center}.summary-kpi b{display:block;font-size:18px}.evidence{font-size:10px}.noprint{margin:15px 0}@media print{.noprint{display:none}.record-page{min-height:auto}}</style></head><body>' + body + '<div class="noprint"><button onclick="window.print()">인쇄</button></div><script>window.onload=function(){setTimeout(function(){window.print()},300)};<\/script></body></html>';
    const w = window.open('', '_blank'); if (!w) { alert('팝업이 차단되었습니다. 팝업 허용 후 다시 시도해주세요.'); return; }
    w.document.open(); w.document.write(html); w.document.close();
  }

  window.printSelectedRecords = async function () {
    const ids = selectedIdsOrCurrent(); if (!ids.length) { setStatus('viewSearchStatus', '출력할 기록을 선택하세요.', 'bad'); return; }
    const photos = !!(el('v22IncludePhotos') && el('v22IncludePhotos').checked);
    setStatus('viewSearchStatus', ids.length + '건 출력자료를 불러오는 중...', 'warn');
    try {
      const res = await fetchPrintBundle(ids, photos); if (!res.ok) throw new Error(res.message || '출력자료 조회 실패');
      const body = (res.items || []).map(function (x, i) { return recordPageHtml(x, i < res.items.length - 1); }).join('');
      openHtmlPrint('공병 입고 확인 기록서', body); setStatus('viewSearchStatus', ids.length + '건 출력 준비 완료', 'ok');
    } catch (e) { setStatus('viewSearchStatus', '출력 준비 실패: ' + e, 'bad'); }
  };

  window.printCurrentViewRecord = async function () {
    if (!currentViewRecord || !currentViewRecord.record) return;
    const photos = !!(el('v22IncludePhotos') && el('v22IncludePhotos').checked);
    try {
      const res = await fetchPrintBundle([String(currentViewRecord.record.id)], photos);
      if (!res.ok) throw new Error(res.message || '출력자료 조회 실패');
      openHtmlPrint('공병 입고 확인 기록서', recordPageHtml(res.items[0], false));
    } catch (e) { setStatus('viewSearchStatus', '출력 준비 실패: ' + e, 'bad'); }
  };

  window.printLastSaved = async function (mode) {
    const saved = lastSavedRecord[mode];
    if (!saved || !saved.record || !saved.record.id) return;
    try {
      const res = await fetchPrintBundle([String(saved.record.id)], true);
      if (!res.ok) throw new Error(res.message || '출력자료 조회 실패');
      openHtmlPrint('공병 입고 확인 기록서', recordPageHtml(res.items[0], false));
    } catch (e) { alert('출력 준비 실패: ' + e); }
  };

  window.openReportBuilder = function (type) {
    const ids = selectedIdsOrCurrent(); if (!ids.length) { setStatus('viewSearchStatus', '보고서에 포함할 기록을 먼저 선택하세요.', 'bad'); return; }
    V22.reportType = type || 'executive';
    const selected = viewSearchResultsList.filter(function (x) { return ids.indexOf(String(x.id)) >= 0; });
    const total = selected.reduce(function (s, x) { return s + n(x.qty); }, 0);
    el('v22ReportTitle').value = V22.reportType === 'investigation' ? '공병 입고 조사보고서' : '공병 입고 확인 임원보고';
    el('v22ReportPurpose').value = '공병 입고 확인 결과 및 이상사항을 공유하고 필요한 후속조치를 보고하고자 함.';
    el('v22ReportConclusion').value = '선택 기록 ' + ids.length + '건을 기준으로 입고 확인 결과를 정리함.';
    el('v22ReportImpact').value = '검토 대상 ' + ids.length + '건 / 표시수량 합계 ' + total.toLocaleString() + '개';
    el('v22ReportRisk').value = '확인필요·혼입·수량 또는 라벨 불일치 기록은 상세 내역 및 증빙사진 확인 필요.';
    el('v22ReportAction').value = '';
    el('v22ReportInvestigation').value = '';
    el('v22ReportCard').classList.remove('hidden'); el('v22ReportCard').scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  function issueText(r) {
    const a = [];
    if (String(r.finalResult || '') === '확인필요') a.push('최종 확인필요');
    if (String(r.mixed || '') === '있음' || n(r.mixedCount) > 0) a.push('혼입/이종');
    if (String(r.qtyResult || '') === '불일치') a.push('수량 불일치');
    if (String(r.labelMatch || '') === '불일치') a.push('라벨 불일치');
    return a.join(', ') || '특이사항 없음';
  }

  window.printV22Report = async function () {
    const ids = selectedIdsOrCurrent(); if (!ids.length) return;
    try {
      setStatus('viewSearchStatus', '보고서 자료를 구성하는 중...', 'warn');
      const res = await fetchPrintBundle(ids, true); if (!res.ok) throw new Error(res.message || '자료 조회 실패');
      const items = res.items || [];
      const issueCount = items.filter(function (x) { return issueText(x.record) !== '특이사항 없음'; }).length;
      const totalQty = items.reduce(function (s, x) { const r = x.record || {}; return s + n(r.totalQty || r.actualQty || r.displayQty); }, 0);
      const evidence = items.map(function (x) { const r = x.record || {}; return '<tr><td>' + safeText(r.regDate) + '</td><td>' + safeText(r.inboundNo) + '</td><td>' + safeText(r.product) + '</td><td>' + safeText(r.finalResult) + '</td><td>' + safeText(issueText(r)) + '</td></tr>'; }).join('');
      const photos = [].concat.apply([], items.map(function (x) { return x.photos || []; })).slice(0, 4);
      const photoHtml = photos.length ? '<div class="photos">' + photos.map(function (p) { return '<figure><img src="' + p.dataUrl + '"><figcaption>' + safeText(p.label) + '</figcaption></figure>'; }).join('') + '</div>' : '';
      let body = '<div class="report-head"><h1>' + safeText(val('v22ReportTitle')) + '</h1><div class="meta">출력일시 ' + safeText(new Date().toLocaleString('ko-KR')) + '</div></div><div class="report-block"><h2>목적</h2><div>' + safeText(val('v22ReportPurpose')) + '</div></div><div class="report-block"><h2>결론</h2><div>' + safeText(val('v22ReportConclusion')) + '</div></div><div class="summary-kpi"><div>검토 건수<b>' + items.length + '</b></div><div>확인필요<b>' + issueCount + '</b></div><div>총 수량<b>' + totalQty.toLocaleString() + '</b></div><div>증빙사진<b>' + photos.length + '</b></div></div><div class="report-block"><h2>Impact</h2><div>' + safeText(val('v22ReportImpact')) + '</div></div><div class="report-block"><h2>Risk</h2><div>' + safeText(val('v22ReportRisk')) + '</div></div><div class="report-block"><h2>근본원인 및 재발방지대책</h2><div>' + safeText(val('v22ReportAction') || '조사 후 입력') + '</div></div>' + photoHtml;
      if (V22.reportType === 'investigation') body += '<div class="report-block"><h2>조사내용 / 타임라인</h2><div>' + safeText(val('v22ReportInvestigation') || '조사내용 입력') + '</div></div><h2>조사 대상 기록</h2><table class="evidence"><tr><th>등록일시</th><th>입고번호</th><th>품명</th><th>결과</th><th>확인사항</th></tr>' + evidence + '</table>';
      else body += '<h2>근거 요약</h2><table class="evidence"><tr><th>등록일시</th><th>입고번호</th><th>품명</th><th>결과</th><th>확인사항</th></tr>' + evidence + '</table>';
      openHtmlPrint(val('v22ReportTitle') || '공병 입고 보고서', body); setStatus('viewSearchStatus', '보고서 출력 준비 완료', 'ok');
    } catch (e) { setStatus('viewSearchStatus', '보고서 구성 실패: ' + e, 'bad'); }
  };

  function init() {
    initQuickBar(); initWorkerInputs(); initProductionUi(); initViewUi();
    const oldShowTab = window.showTab;
    window.showTab = function (tab) {
      v22StopLiveOcr();
      if (typeof oldShowTab === 'function') oldShowTab(tab);
      updateQuickBar(tab);
      if (tab === 'prod' && prodSession) syncProductionSession();
    };
    const sub = document.querySelector('header .sub'); if (sub) sub.textContent = sub.textContent.replace(/\s*·\s*V\d+(?:\.\d+)*\s*$/i, '');
    V22.prodTimer = setInterval(function () { if (prodSession && V22.activeTab === 'prod' && !document.hidden) syncProductionSession(); }, 15000);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', function () { setTimeout(init, 0); });
  else setTimeout(init, 0);
})();
