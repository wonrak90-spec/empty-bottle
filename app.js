/* ============ 공통 ============ */

function showTab(tab) {
  document.getElementById('single').classList.toggle('active', tab === 'single');
  document.getElementById('multi').classList.toggle('active', tab === 'multi');
  document.getElementById('prod').classList.toggle('active', tab === 'prod');
  document.getElementById('tabSingle').classList.toggle('active', tab === 'single');
  document.getElementById('tabMulti').classList.toggle('active', tab === 'multi');
  document.getElementById('tabProd').classList.toggle('active', tab === 'prod');
  stopScanner();
  stopLiveOcr('single');
  stopLiveOcr('multi');
  stopLiveOcr('prod');
}

function setStatus(id, text, type) {
  const el = document.getElementById(id);
  el.textContent = text;
  el.className = 'status' + (type ? ' ' + type : '');
}

function num(v) {
  const n = parseFloat(String(v || '').replace(/,/g, ''));
  return isNaN(n) ? 0 : n;
}

function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.onerror = reject;
    r.readAsDataURL(file);
  });
}

function choose(onId, offId, type) {
  const on = document.getElementById(onId);
  const off = document.getElementById(offId);
  const cls = type === 'ok' ? 'sel-ok' : 'sel-bad';
  on.classList.add(cls);
  off.classList.remove('sel-ok', 'sel-bad');
}

function normalizeDate(v) {
  const d = String(v || '').replace(/[^0-9]/g, '');
  return d.length >= 8 ? d.slice(0, 4) + '-' + d.slice(4, 6) + '-' + d.slice(6, 8) : String(v || '').trim();
}

/* ============ API 호출 ============ */

async function apiGet(action, params) {
  const qs = new URLSearchParams(Object.assign({ action, token: CONFIG.API_TOKEN }, params || {})).toString();
  const res = await fetch(CONFIG.API_URL + '?' + qs);
  return res.json();
}

async function apiPost(action, payload) {
  const res = await fetch(CONFIG.API_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' }, // preflight(OPTIONS) 회피용
    body: JSON.stringify({ action, payload, token: CONFIG.API_TOKEN })
  });
  return res.json();
}

async function lookupMaster(key) {
  try {
    return await apiGet('lookup', { key });
  } catch (e) {
    return { ok: false, message: String(e) };
  }
}

/* ============ 라벨 사진 OCR ============ */

let ocrWorker = null;
let lastPhotoDataUrl = { single: '', multi: '', prod: '' };
let lastOcrText = { single: '', multi: '', prod: '' };

const MODE_UI = {
  single: { preview: 'singlePreview', status: 'singleStatus', progress: 'ocrProgressSingle', box: 'ocrBoxSingle', video: 'liveVideoSingle', wrap: 'liveWrapSingle' },
  multi: { preview: 'multiPreview', status: 'multiBaseStatus', progress: 'ocrProgressMulti', box: 'ocrBoxMulti', video: 'liveVideoMulti', wrap: 'liveWrapMulti' },
  prod: { preview: 'prodPreview', status: 'prodOcrStatus', progress: 'ocrProgressProd', box: 'ocrBoxProd', video: 'liveVideoProd', wrap: 'liveWrapProd' }
};

async function getOcrWorker(progressId) {
  if (ocrWorker) return ocrWorker;
  const bar = document.getElementById(progressId);
  ocrWorker = await Tesseract.createWorker('kor+eng', 1, {
    logger: m => {
      if (m.status === 'recognizing text' && bar) {
        bar.style.width = Math.round((m.progress || 0) * 100) + '%';
      }
    }
  });
  return ocrWorker;
}

function applyOcrToMode(mode, parsed) {
  if (mode === 'single') {
    applyParsed(parsed);
    return '라벨 자동인식 완료 · 아래 내용을 확인하세요.';
  }
  if (mode === 'multi') {
    if (parsed.product) document.getElementById('mProduct').value = parsed.product;
    if (parsed.itemCode) document.getElementById('mItemCode').value = parsed.itemCode;
    if (parsed.supplier) document.getElementById('mSupplier').value = parsed.supplier;
    if (parsed.displayQty) document.getElementById('mQty').value = parsed.displayQty;
    if (parsed.inboundNo) document.getElementById('mInboundNo').value = parsed.inboundNo;
    return '기준정보 설정 완료 · 이제 코드 스캔 또는 수동 추가를 진행하세요.';
  }
  if (mode === 'prod') {
    const p = parseProductionText(lastOcrText.prod);
    if (p.productName) document.getElementById('prodProductName').value = p.productName;
    if (p.lotNo) document.getElementById('prodLotNo').value = p.lotNo;
    if (p.prodDate) document.getElementById('prodDate').value = p.prodDate;
    if (p.prodQty) document.getElementById('prodQty').value = p.prodQty;
    return '자동인식 완료 · 아래 생산 정보를 확인하세요.';
  }
}

async function labelPhotoSelected(event, mode) {
  const file = event.target.files && event.target.files[0];
  if (!file) return;

  const dataUrl = await fileToDataUrl(file);
  lastPhotoDataUrl[mode] = dataUrl;

  const ui = MODE_UI[mode];
  const preview = document.getElementById(ui.preview);
  preview.src = dataUrl;
  preview.classList.remove('hidden');

  document.getElementById(ui.box).classList.remove('hidden');
  setStatus(ui.status, '자동인식 중... (처음 실행 시 몇 초 걸릴 수 있어요)', 'warn');

  try {
    const worker = await getOcrWorker(ui.progress);
    const ret = await worker.recognize(dataUrl);
    const raw = ret.data.text || '';
    lastOcrText[mode] = raw;
    const parsed = mode === 'prod' ? {} : parseLabelText(raw);
    const msg = applyOcrToMode(mode, parsed);
    setStatus(ui.status, msg, 'ok');
  } catch (e) {
    setStatus(ui.status, '자동인식 실패: ' + e + ' (필드에 직접 입력해주세요)', 'bad');
  }
}

function parseLabelText(raw) {
  const t = String(raw || '').replace(/\r/g, '\n').replace(/：/g, ':').replace(/\n+/g, '\n');
  const out = {};
  const one = re => { const m = t.match(re); return m ? m[1].trim() : ''; };

  out.inboundNo = one(/입고\s*번호\s*[:\-]?\s*([0-9]{6,})/i);
  out.product = one(/품\s*명\s*[:\-]?\s*([^\n]+)/i);
  out.itemCode = one(/품목\s*코드\s*[:\-]?\s*([A-Za-z0-9\-]+)/i);

  const q = t.match(/수\s*량\s*[:\-]?\s*([\d,]+(?:\.\d+)?)\s*([A-Za-z가-힣]+)?/i);
  if (q) { out.displayQty = q[1]; out.unit = q[2] || 'EA'; }

  out.manufacturer = one(/제\s*조\s*원\s*[:\-]?\s*([^\n]+)/i);
  out.supplier = one(/공급\s*업체\s*[:\-]?\s*([^\n]+)/i);
  out.inboundDate = normalizeDate(one(/입고\s*일자\s*[:\-]?\s*([0-9]{8}|[0-9]{4}[-./][0-9]{1,2}[-./][0-9]{1,2})/i));
  out.expiryDate = normalizeDate(one(/사용\s*기한\s*[:\-]?\s*([0-9]{8}|[0-9]{4}[-./][0-9]{1,2}[-./][0-9]{1,2})/i));

  const c = t.match(/용기\s*번호\s*[:\-]?\s*([0-9]{1,8})\s*[/／]\s*([0-9]{1,8})/i);
  if (c) { out.containerFrom = c[1]; out.containerTo = c[2]; }

  const code = t.match(/(?<!\d)([0-9]{6,12}-[0-9]{3,8})(?!\d)/);
  if (code) out.codeRaw = code[1];

  if (out.product) {
    out.product = out.product.replace(/\s+(품목\s*코드|수\s*량|제\s*조\s*원|공급\s*업체).*$/i, '').trim();
  }
  return out;
}

function parseProductionText(raw) {
  const t = String(raw || '').replace(/\r/g, '\n').replace(/：/g, ':').replace(/\n+/g, '\n');
  const out = {};
  const one = re => { const m = t.match(re); return m ? m[1].trim() : ''; };

  out.productName = one(/제\s*품\s*명\s*[:\-]?\s*([^\n]+)/i) || one(/품\s*명\s*[:\-]?\s*([^\n]+)/i);
  out.lotNo = one(/제\s*조\s*번\s*호\s*[:\-]?\s*([A-Za-z0-9\-]+)/i) ||
    one(/lot\s*(?:no\.?)?\s*[:\-]?\s*([A-Za-z0-9\-]+)/i) ||
    one(/로트\s*번호\s*[:\-]?\s*([A-Za-z0-9\-]+)/i);
  out.prodDate = normalizeDate(
    one(/제\s*조\s*일\s*자?\s*[:\-]?\s*([0-9]{8}|[0-9]{4}[-./][0-9]{1,2}[-./][0-9]{1,2})/i) ||
    one(/생\s*산\s*일\s*자?\s*[:\-]?\s*([0-9]{8}|[0-9]{4}[-./][0-9]{1,2}[-./][0-9]{1,2})/i)
  );
  const q = t.match(/(?:생\s*산\s*수\s*량|수\s*량)\s*[:\-]?\s*([\d,]+(?:\.\d+)?)/i);
  if (q) out.prodQty = q[1];

  if (out.productName) {
    out.productName = out.productName.replace(/\s+(제조\s*번호|lot|로트\s*번호|제조\s*일자?|생산\s*일자?|수\s*량).*$/i, '').trim();
  }
  return out;
}

function applyParsed(p) {
  const ids = ['inboundNo', 'inboundDate', 'product', 'itemCode', 'manufacturer', 'supplier', 'displayQty', 'unit', 'expiryDate', 'containerFrom', 'containerTo', 'codeRaw'];
  ids.forEach(id => { if (p[id]) document.getElementById(id).value = p[id]; });
  if (document.getElementById('actualQty').value === '' && p.displayQty) {
    document.getElementById('actualQty').value = p.displayQty;
    updateSingleQty();
  }
}

function applyMasterToForm(d) {
  applyParsed({
    inboundNo: d.inboundNo, product: d.product, itemCode: d.itemCode, manufacturer: d.manufacturer,
    supplier: d.supplier, displayQty: d.qty, unit: d.unit, expiryDate: d.expiryDate, containerFrom: d.containerNo
  });
}

/* ============ 공병 실물 사진 (여러 장) ============ */

let itemPhotos = { single: [], multi: [] };

async function itemPhotoSelected(event, mode) {
  const files = Array.from(event.target.files || []);
  for (const file of files) {
    const dataUrl = await fileToDataUrl(file);
    itemPhotos[mode].push(dataUrl);
  }
  event.target.value = '';
  renderItemPhotos(mode);
}

function renderItemPhotos(mode) {
  const wrap = document.getElementById(mode === 'single' ? 'singleItemPhotos' : 'multiItemPhotos');
  wrap.innerHTML = itemPhotos[mode].map((src, i) => `
    <div class="photo-thumb">
      <img src="${src}">
      <button type="button" class="rm" onclick="removeItemPhoto('${mode}',${i})">×</button>
    </div>
  `).join('');
}

function removeItemPhoto(mode, index) {
  itemPhotos[mode].splice(index, 1);
  renderItemPhotos(mode);
}

/* ============ 실시간 카메라 인식 ============ */

let liveOcr = { single: { stream: null, running: false }, multi: { stream: null, running: false }, prod: { stream: null, running: false } };

async function startLiveOcr(mode) {
  if (liveOcr[mode].running) return;
  await stopScanner(); // 코드 스캔 중이면 먼저 정지

  const ui = MODE_UI[mode];
  const video = document.getElementById(ui.video);

  try {
    const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' } }, audio: false });
    liveOcr[mode].stream = stream;
    video.srcObject = stream;
    await video.play();
  } catch (e) {
    setStatus(ui.status, '카메라 실행 실패: ' + e, 'bad');
    return;
  }

  document.getElementById(ui.wrap).classList.remove('hidden');
  liveOcr[mode].running = true;
  setStatus(ui.status, '실시간 인식 중... 라벨을 화면에 비춰주세요.', 'warn');
  liveOcrTick(mode);
}

async function liveOcrTick(mode) {
  if (!liveOcr[mode].running) return;
  const ui = MODE_UI[mode];
  const video = document.getElementById(ui.video);

  try {
    if (video.videoWidth > 0) {
      const canvas = document.createElement('canvas');
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      canvas.getContext('2d').drawImage(video, 0, 0);
      const dataUrl = canvas.toDataURL('image/jpeg', 0.85);

      const worker = await getOcrWorker(ui.progress);
      const ret = await worker.recognize(dataUrl);
      const raw = ret.data.text || '';

      if (liveOcr[mode].running && raw.trim()) {
        lastPhotoDataUrl[mode] = dataUrl;
        lastOcrText[mode] = raw;
        const parsed = mode === 'prod' ? {} : parseLabelText(raw);
        applyOcrToMode(mode, parsed);
        setStatus(ui.status, '실시간 인식 중 · 마지막 업데이트 ' + new Date().toLocaleTimeString('ko-KR'), 'ok');
      }
    }
  } catch (e) {
    // 한 프레임 실패는 무시하고 계속 진행
  }

  if (liveOcr[mode].running) {
    setTimeout(() => liveOcrTick(mode), 300);
  }
}

function stopLiveOcr(mode) {
  liveOcr[mode].running = false;
  if (liveOcr[mode].stream) {
    liveOcr[mode].stream.getTracks().forEach(t => t.stop());
    liveOcr[mode].stream = null;
  }
  const ui = MODE_UI[mode];
  document.getElementById(ui.wrap).classList.add('hidden');
  setStatus(ui.status, '실시간 인식 중지됨 · 내용을 확인하세요.', 'ok');
}

/* ============ QR/바코드 스캔 (코드가 있는 경우만) ============ */

let activeScanner = null;
let scanMode = 'single';

async function startScanner(mode) {
  stopLiveOcr(mode);
  scanMode = mode;
  const wrapId = mode === 'single' ? 'readerWrapSingle' : 'readerWrapMulti';
  const readerId = mode === 'single' ? 'reader' : 'readerMulti';
  document.getElementById(wrapId).classList.remove('hidden');

  activeScanner = new Html5Qrcode(readerId);
  const formats = [
    Html5QrcodeSupportedFormats.QR_CODE,
    Html5QrcodeSupportedFormats.CODE_128,
    Html5QrcodeSupportedFormats.CODE_39,
    Html5QrcodeSupportedFormats.EAN_13,
    Html5QrcodeSupportedFormats.EAN_8,
    Html5QrcodeSupportedFormats.DATA_MATRIX
  ];
  try {
    await activeScanner.start(
      { facingMode: 'environment' },
      { fps: 10, qrbox: { width: 260, height: 160 }, formatsToSupport: formats },
      text => onCode(text)
    );
  } catch (e) {
    setStatus(mode === 'single' ? 'singleStatus' : 'multiBaseStatus', '카메라 실행 실패: ' + e, 'bad');
  }
}

async function stopScanner() {
  if (activeScanner) {
    try { await activeScanner.stop(); await activeScanner.clear(); } catch (e) {}
    activeScanner = null;
  }
  document.getElementById('readerWrapSingle').classList.add('hidden');
  document.getElementById('readerWrapMulti').classList.add('hidden');
}

let multiPallets = [];

async function onCode(text) {
  if (scanMode === 'single') {
    await stopScanner();
    applyParsed(parseCode(text));
    document.getElementById('codeRaw').value = text;
    setStatus('singleStatus', '코드 인식 완료 · ' + text, 'ok');

    const res = await lookupMaster(text);
    if (res && res.found) {
      applyMasterToForm(res.data);
      setStatus('singleStatus', '코드 + Master 정보 자동입력 완료', 'ok');
    }
    return;
  }

  // 다중 팔레트 모드: 연속 스캔, 중복 제외
  if (multiPallets.some(x => x.code === text)) return;
  if (navigator.vibrate) navigator.vibrate(80);

  const fallback = parseCode(text);
  const baseItemCode = document.getElementById('mItemCode').value.trim();
  const temp = {
    code: text,
    inboundNo: fallback.inboundNo || document.getElementById('mInboundNo').value || '',
    containerNo: fallback.containerFrom || '',
    itemCode: baseItemCode,
    product: document.getElementById('mProduct').value,
    supplier: document.getElementById('mSupplier').value,
    qty: num(document.getElementById('mQty').value),
    unit: 'EA',
    mismatch: false
  };
  multiPallets.push(temp);
  renderPallets();

  const res = await lookupMaster(text);
  const p = multiPallets.find(x => x.code === text);
  if (!p) return;
  if (res && res.found) {
    p.inboundNo = res.data.inboundNo || p.inboundNo;
    p.containerNo = res.data.containerNo || p.containerNo;
    p.itemCode = res.data.itemCode || p.itemCode;
    p.product = res.data.product || p.product;
    p.supplier = res.data.supplier || p.supplier;
    p.qty = num(res.data.qty) || p.qty;
    p.unit = res.data.unit || p.unit;
    p.mismatch = baseItemCode && p.itemCode && p.itemCode !== baseItemCode;
    renderPallets();
  }
}

function addPalletManually() {
  const containerNo = window.prompt('용기번호를 입력하세요 (없으면 취소)');
  if (containerNo === null) return;
  const baseItemCode = document.getElementById('mItemCode').value.trim();
  multiPallets.push({
    code: '(수동)' + Date.now(),
    inboundNo: document.getElementById('mInboundNo').value || '',
    containerNo,
    itemCode: baseItemCode,
    product: document.getElementById('mProduct').value,
    supplier: document.getElementById('mSupplier').value,
    qty: num(document.getElementById('mQty').value),
    unit: 'EA',
    mismatch: false
  });
  renderPallets();
}

function parseCode(raw) {
  const out = { codeRaw: raw };
  const text = String(raw || '').trim();

  if (/^\d{6,12}-\d{3,8}$/.test(text)) {
    const p = text.split('-');
    out.inboundNo = p[0];
    out.containerFrom = p[1];
  }

  text.split(/[\n;|]/).forEach(part => {
    const m = part.match(/^\s*([^:=\t]+)\s*[:=\t]\s*(.+?)\s*$/);
    if (!m) return;
    const k = m[1].toLowerCase().replace(/[\s._\-/]/g, '');
    const v = m[2].trim();
    if (['입고번호', 'inboundno'].includes(k)) out.inboundNo = v;
    if (['품명', 'product'].includes(k)) out.product = v;
    if (['품목코드', 'itemcode'].includes(k)) out.itemCode = v;
    if (['수량', 'qty'].includes(k)) out.displayQty = v.replace(/\s*EA$/i, '');
    if (['단위', 'unit'].includes(k)) out.unit = v;
    if (['제조원', 'manufacturer'].includes(k)) out.manufacturer = v;
    if (['공급업체', 'supplier'].includes(k)) out.supplier = v;
    if (['입고일자', 'inbounddate'].includes(k)) out.inboundDate = normalizeDate(v);
    if (['사용기한', 'expirydate'].includes(k)) out.expiryDate = normalizeDate(v);
  });
  return out;
}

function renderPallets() {
  const total = multiPallets.reduce((s, p) => s + num(p.qty), 0);
  const mixed = multiPallets.filter(p => p.mismatch).length;
  document.getElementById('multiCount').textContent = multiPallets.length;
  document.getElementById('multiTotal').textContent = total;
  document.getElementById('multiMixed').textContent = mixed;

  const list = document.getElementById('palletList');
  if (multiPallets.length === 0) {
    list.innerHTML = '<div class="status">인식된 팔레트가 없습니다.</div>';
    return;
  }
  list.innerHTML = multiPallets.map((p, i) => `
    <div class="pallet-item">
      <div>
        <div>#${i + 1} ${esc(p.product || '')} · ${esc(String(p.qty))}${esc(p.unit || '')}</div>
        <div class="code">${esc(p.containerNo || p.code)}</div>
      </div>
      ${p.mismatch ? '<div class="flag">⚠ 이종</div>' : ''}
    </div>
  `).join('');
}

function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

/* ============ 단건: 수량판정 ============ */

function updateSingleQty() {
  const disp = num(document.getElementById('displayQty').value);
  const actual = num(document.getElementById('actualQty').value);
  if (!document.getElementById('actualQty').value) {
    setStatus('qtyStatus', '수량을 입력하면 일치 여부를 계산합니다.', '');
    return;
  }
  if (disp === actual) {
    setStatus('qtyStatus', '수량 일치 (' + actual + ')', 'ok');
  } else {
    setStatus('qtyStatus', '수량 불일치 · 표시 ' + disp + ' / 실제 ' + actual, 'bad');
  }
}

/* ============ 저장 ============ */

async function saveSingleRecord() {
  const get = id => document.getElementById(id).value.trim();
  const disp = num(get('displayQty'));
  const actual = num(get('actualQty'));
  const payload = {
    inboundNo: get('inboundNo'), inboundDate: get('inboundDate'), product: get('product'),
    itemCode: get('itemCode'), manufacturer: get('manufacturer'), supplier: get('supplier'),
    displayQty: get('displayQty'), unit: get('unit'), expiryDate: get('expiryDate'),
    containerFrom: get('containerFrom'), containerTo: get('containerTo'), codeRaw: get('codeRaw'),
    infoMatch: document.getElementById('matchYes').classList.contains('sel-ok') ? '일치' :
      (document.getElementById('matchNo').classList.contains('sel-bad') ? '불일치' : ''),
    mixed: document.getElementById('mixYes').classList.contains('sel-bad') ? '있음' :
      (document.getElementById('mixNo').classList.contains('sel-ok') ? '없음' : ''),
    actualQty: get('actualQty'),
    qtyResult: disp === actual ? '일치' : '불일치',
    finalResult: (disp === actual && document.getElementById('matchYes').classList.contains('sel-ok') && document.getElementById('mixNo').classList.contains('sel-ok')) ? '적합' : '확인필요',
    note: get('note'), inspector: get('inspector'),
    photo: lastPhotoDataUrl.single, ocrRaw: lastOcrText.single,
    itemPhotos: itemPhotos.single
  };

  if (!CONFIG.API_URL || CONFIG.API_URL.indexOf('PUT_YOUR') === 0) {
    setStatus('saveSingleStatus', 'config.js에 Apps Script 배포 URL을 먼저 넣어주세요.', 'bad');
    return;
  }

  setStatus('saveSingleStatus', '저장 중...', 'warn');
  try {
    const res = await apiPost('saveSingle', payload);
    if (res.ok) {
      setStatus('saveSingleStatus', '저장 완료 (ID: ' + res.id + ')', 'ok');
    } else {
      setStatus('saveSingleStatus', '저장 실패: ' + res.message, 'bad');
    }
  } catch (e) {
    setStatus('saveSingleStatus', '저장 실패: ' + e, 'bad');
  }
}

async function saveMultiRecord() {
  if (multiPallets.length === 0) {
    setStatus('saveMultiStatus', '스캔된 팔레트가 없습니다.', 'bad');
    return;
  }
  const get = id => document.getElementById(id).value.trim();
  const payload = {
    inboundNo: get('mInboundNo'), product: get('mProduct'), itemCode: get('mItemCode'),
    supplier: get('mSupplier'), displayQty: get('mQty'), unit: 'EA',
    pallets: multiPallets,
    finalResult: multiPallets.some(p => p.mismatch) ? '확인필요' : '적합',
    note: get('mNote'), inspector: get('mInspector'),
    photo: lastPhotoDataUrl.multi, ocrRaw: lastOcrText.multi,
    itemPhotos: itemPhotos.multi
  };

  if (!CONFIG.API_URL || CONFIG.API_URL.indexOf('PUT_YOUR') === 0) {
    setStatus('saveMultiStatus', 'config.js에 Apps Script 배포 URL을 먼저 넣어주세요.', 'bad');
    return;
  }

  setStatus('saveMultiStatus', '저장 중...', 'warn');
  try {
    const res = await apiPost('saveMulti', payload);
    if (res.ok) {
      setStatus('saveMultiStatus', '저장 완료 · 총 ' + res.total + (res.mixedCount ? (', 이종 ' + res.mixedCount + '건') : '') + ' (ID: ' + res.id + ')', 'ok');
    } else {
      setStatus('saveMultiStatus', '저장 실패: ' + res.message, 'bad');
    }
  } catch (e) {
    setStatus('saveMultiStatus', '저장 실패: ' + e, 'bad');
  }
}

function clearSingle() {
  stopLiveOcr('single');
  ['inboundNo', 'inboundDate', 'product', 'itemCode', 'manufacturer', 'supplier', 'displayQty',
    'expiryDate', 'containerFrom', 'containerTo', 'codeRaw', 'actualQty', 'note', 'inspector']
    .forEach(id => document.getElementById(id).value = '');
  document.getElementById('unit').value = 'EA';
  document.getElementById('singlePreview').classList.add('hidden');
  document.getElementById('ocrBoxSingle').classList.add('hidden');
  document.getElementById('ocrProgressSingle').style.width = '0%';
  ['matchYes', 'matchNo', 'mixYes', 'mixNo'].forEach(id => document.getElementById(id).classList.remove('sel-ok', 'sel-bad'));
  lastPhotoDataUrl.single = ''; lastOcrText.single = '';
  itemPhotos.single = []; renderItemPhotos('single');
  setStatus('singleStatus', '라벨을 촬영하거나 코드를 스캔하세요.', '');
  setStatus('qtyStatus', '수량을 입력하면 일치 여부를 계산합니다.', '');
  setStatus('saveSingleStatus', '저장 전 자동입력 내용을 확인하세요.', '');
}

function clearMulti() {
  stopLiveOcr('multi');
  multiPallets = [];
  ['mProduct', 'mItemCode', 'mSupplier', 'mQty', 'mInboundNo', 'mNote', 'mInspector']
    .forEach(id => document.getElementById(id).value = '');
  document.getElementById('multiPreview').classList.add('hidden');
  document.getElementById('ocrBoxMulti').classList.add('hidden');
  document.getElementById('ocrProgressMulti').style.width = '0%';
  lastPhotoDataUrl.multi = ''; lastOcrText.multi = '';
  itemPhotos.multi = []; renderItemPhotos('multi');
  renderPallets();
  setStatus('multiBaseStatus', '첫 라벨로 품명·품목코드·공급업체·팔레트당 수량을 설정합니다.', '');
  setStatus('saveMultiStatus', '팔레트 스캔 후 저장하세요.', '');
}

/* ============ 생산 등록 ============ */

let prodSelectedRecords = [];

let prodSearchResultsList = [];

async function searchRecordsForProd() {
  const kw = document.getElementById('prodSearchKw').value.trim();
  if (!kw) {
    setStatus('prodSearchStatus', '검색어를 입력하세요.', 'bad');
    return;
  }
  setStatus('prodSearchStatus', '검색 중...', 'warn');
  try {
    const res = await apiGet('searchRecords', { keyword: kw });
    if (!res.ok) {
      setStatus('prodSearchStatus', '검색 실패: ' + res.message, 'bad');
      return;
    }
    prodSearchResultsList = res.items || [];
    const box = document.getElementById('prodSearchResults');
    if (prodSearchResultsList.length === 0) {
      box.innerHTML = '';
      setStatus('prodSearchStatus', '일치하는 입고건이 없습니다.', 'bad');
      return;
    }
    setStatus('prodSearchStatus', prodSearchResultsList.length + '건 검색됨 · 선택하세요.', 'ok');
    box.innerHTML = prodSearchResultsList.map((it, i) => `
      <div class="result-item" onclick="selectProdRecord(${i})">
        <div>
          <div>${esc(it.product)} · ${esc(String(it.qty))}${esc(it.unit || '')}</div>
          <div class="meta">입고번호 ${esc(it.inboundNo)} · ${esc(it.mode)} · ${esc(it.regDate)}</div>
        </div>
        <div>+</div>
      </div>
    `).join('');
  } catch (e) {
    setStatus('prodSearchStatus', '검색 실패: ' + e, 'bad');
  }
}

function selectProdRecord(index) {
  const it = prodSearchResultsList[index];
  if (!it || prodSelectedRecords.some(x => x.id === it.id)) return;
  prodSelectedRecords.push(it);
  renderProdSelected();
}

function removeProdRecord(id) {
  prodSelectedRecords = prodSelectedRecords.filter(x => x.id !== id);
  renderProdSelected();
}

function renderProdSelected() {
  const box = document.getElementById('prodSelected');
  if (prodSelectedRecords.length === 0) {
    box.innerHTML = '';
    return;
  }
  box.innerHTML = '<div style="font-size:0.78rem;color:var(--muted);margin-bottom:6px;">연결된 입고건</div>' +
    prodSelectedRecords.map(it => `
      <span class="chip">${esc(it.product)} (${esc(it.inboundNo)})
        <button type="button" onclick="removeProdRecord('${it.id}')">×</button>
      </span>
    `).join('');
}

async function saveProduction() {
  if (prodSelectedRecords.length === 0) {
    setStatus('saveProdStatus', '연결할 공병 입고건을 최소 1개 선택하세요.', 'bad');
    return;
  }
  const get = id => document.getElementById(id).value.trim();
  const productName = get('prodProductName');
  if (!productName) {
    setStatus('saveProdStatus', '제품명을 입력하세요.', 'bad');
    return;
  }
  const payload = {
    productName, lotNo: get('prodLotNo'), prodDate: get('prodDate'), prodQty: get('prodQty'),
    note: get('prodNote'), registrant: get('prodRegistrant'),
    linkedRecords: prodSelectedRecords,
    photo: lastPhotoDataUrl.prod, ocrRaw: lastOcrText.prod
  };

  if (!CONFIG.API_URL || CONFIG.API_URL.indexOf('PUT_YOUR') === 0) {
    setStatus('saveProdStatus', 'config.js에 Apps Script 배포 URL을 먼저 넣어주세요.', 'bad');
    return;
  }

  setStatus('saveProdStatus', '저장 중...', 'warn');
  try {
    const res = await apiPost('saveProduction', payload);
    if (res.ok) {
      setStatus('saveProdStatus', '생산 등록 완료 (ID: ' + res.id + ')', 'ok');
    } else {
      setStatus('saveProdStatus', '저장 실패: ' + res.message, 'bad');
    }
  } catch (e) {
    setStatus('saveProdStatus', '저장 실패: ' + e, 'bad');
  }
}

function clearProduction() {
  stopLiveOcr('prod');
  prodSelectedRecords = [];
  ['prodSearchKw', 'prodProductName', 'prodLotNo', 'prodDate', 'prodQty', 'prodRegistrant', 'prodNote']
    .forEach(id => document.getElementById(id).value = '');
  document.getElementById('prodSearchResults').innerHTML = '';
  document.getElementById('prodPreview').classList.add('hidden');
  document.getElementById('ocrBoxProd').classList.add('hidden');
  document.getElementById('ocrProgressProd').style.width = '0%';
  lastPhotoDataUrl.prod = ''; lastOcrText.prod = '';
  renderProdSelected();
  setStatus('prodOcrStatus', '제품명·제조번호가 보이도록 촬영하면 아래 항목이 자동으로 채워집니다.', '');
  setStatus('prodSearchStatus', '입고번호나 품명으로 검색해서 사용한 공병 입고건을 선택하세요.', '');
  setStatus('saveProdStatus', '연결할 입고건 선택 후 생산 정보를 입력하세요.', '');
}

/* ============ PWA 설치 ============ */

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  });
}
