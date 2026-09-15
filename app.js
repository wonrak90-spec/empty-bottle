/* ============ 공통 ============ */

function showTab(tab) {
  ['single', 'multi', 'prod', 'view'].forEach(t => {
    document.getElementById(t).classList.toggle('active', t === tab);
    document.getElementById('tab' + t.charAt(0).toUpperCase() + t.slice(1)).classList.toggle('active', t === tab);
  });
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
  const s = String(v || '').trim();
  if (!s) return '';
  const d = s.replace(/[^0-9]/g, '');
  if (d.length === 8) return d.slice(0, 4) + '-' + d.slice(4, 6) + '-' + d.slice(6, 8);
  // 2026-1-5 / 2026.1.5 / 2026년 1월 5일 같은 형태
  const m = s.match(/([0-9]{4})\D+([0-9]{1,2})\D+([0-9]{1,2})/);
  if (m) return m[1] + '-' + ('0' + m[2]).slice(-2) + '-' + ('0' + m[3]).slice(-2);
  return s;
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
  let filled = 0;
  if (mode === 'single') {
    applyParsed(parsed);
    filled = Object.keys(parsed).filter(k => parsed[k]).length;
  } else if (mode === 'multi') {
    if (parsed.product) { document.getElementById('mProduct').value = parsed.product; filled++; }
    if (parsed.itemCode) { document.getElementById('mItemCode').value = parsed.itemCode; filled++; }
    if (parsed.supplier) { document.getElementById('mSupplier').value = parsed.supplier; filled++; }
    if (parsed.displayQty) { document.getElementById('mQty').value = parsed.displayQty; filled++; }
    if (parsed.inboundNo) { document.getElementById('mInboundNo').value = parsed.inboundNo; filled++; }
  } else if (mode === 'prod') {
    const p = parseProductionText(lastOcrText.prod);
    if (p.productName) { document.getElementById('prodProductName').value = p.productName; filled++; }
    if (p.lotNo) { document.getElementById('prodLotNo').value = p.lotNo; filled++; }
    if (p.prodDate) { document.getElementById('prodDate').value = p.prodDate; filled++; }
    if (p.prodQty) { document.getElementById('prodQty').value = p.prodQty; filled++; }
  }

  showOcrRaw(mode);
  return filled > 0
    ? '자동인식 완료 · ' + filled + '개 항목 채움 (내용 확인 후 수정하세요)'
    : '글자는 읽었지만 항목을 찾지 못했습니다. 아래 "인식된 글자 보기"를 눌러 확인하고 직접 입력해주세요.';
}

function showOcrRaw(mode) {
  const box = document.getElementById('ocrRaw' + mode.charAt(0).toUpperCase() + mode.slice(1));
  if (!box) return;
  const text = (lastOcrText[mode] || '').trim();
  box.classList.toggle('hidden', !text);
  const pre = box.querySelector('pre');
  if (pre) pre.textContent = text;
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
  const t = String(raw || '')
    .replace(/\r/g, '\n')
    .replace(/[：﹕]/g, ':')
    .replace(/[|｜]/g, ' ')
    .replace(/[ \t]+/g, ' ');
  const lines = t.split('\n').map(s => s.trim()).filter(Boolean);
  const out = {};

  // 항목명 뒤의 값을 찾되, 같은 줄에 없으면 다음 줄에서 찾는다.
  // 콜론/하이픈이 없어도 동작하도록 구분자를 선택적으로 처리.
  function grab(labelRe, valueRe) {
    for (let i = 0; i < lines.length; i++) {
      const m = lines[i].match(new RegExp(labelRe.source + '\\s*[:\\-]?\\s*(.*)$', 'i'));
      if (!m) continue;
      const rest = (m[1] || '').trim();
      if (rest) {
        const v = valueRe ? rest.match(valueRe) : [rest];
        if (v) return (v[1] !== undefined ? v[1] : v[0]).trim();
      }
      // 같은 줄에 값이 없으면 다음 줄을 값으로 간주
      for (let j = i + 1; j < Math.min(i + 3, lines.length); j++) {
        const nxt = lines[j].trim();
        if (!nxt) continue;
        const v = valueRe ? nxt.match(valueRe) : [nxt];
        if (v) return (v[1] !== undefined ? v[1] : v[0]).trim();
      }
    }
    return '';
  }

  const NUM = /([0-9][0-9,]*(?:\.[0-9]+)?)/;
  const DATE = /([0-9]{4}\s*[-.\/년]\s*[0-9]{1,2}\s*[-.\/월]\s*[0-9]{1,2}|[0-9]{8})/;

  out.inboundNo = grab(/입\s*고\s*번\s*호/, /([0-9]{5,})/);
  out.product = grab(/품\s*명|제\s*품\s*명/);
  out.itemCode = grab(/품\s*목\s*코\s*드|자\s*재\s*코\s*드/, /([A-Za-z0-9\-]{3,})/);
  out.manufacturer = grab(/제\s*조\s*원|제\s*조\s*사/);
  out.supplier = grab(/공\s*급\s*업\s*체|거\s*래\s*처|납\s*품\s*처/);
  out.inboundDate = normalizeDate(grab(/입\s*고\s*일\s*자?|납\s*품\s*일\s*자?/, DATE));
  out.expiryDate = normalizeDate(grab(/사\s*용\s*기\s*한|유\s*효\s*기\s*한/, DATE));

  const qtyStr = grab(/수\s*량/, NUM);
  if (qtyStr) out.displayQty = qtyStr.replace(/,/g, '');
  const unitLine = t.match(/수\s*량\s*[:\-]?\s*[0-9][0-9,]*(?:\.[0-9]+)?\s*([A-Za-z가-힣]{1,4})/i);
  if (unitLine) out.unit = unitLine[1];

  const c = t.match(/용\s*기\s*번\s*호\s*[:\-]?\s*([0-9]{1,8})\s*[\/～~\-]\s*([0-9]{1,8})/i);
  if (c) { out.containerFrom = c[1]; out.containerTo = c[2]; }
  else {
    const c1 = grab(/용\s*기\s*번\s*호/, /([0-9]{1,8})/);
    if (c1) out.containerFrom = c1;
  }

  const code = t.match(/(?<!\d)([0-9]{6,12}-[0-9]{3,8})(?!\d)/);
  if (code) {
    out.codeRaw = code[1];
    if (!out.inboundNo) out.inboundNo = code[1].split('-')[0];
    if (!out.containerFrom) out.containerFrom = code[1].split('-')[1];
  }

  // 항목명이 값 뒤에 딸려온 경우 잘라내기
  ['product', 'manufacturer', 'supplier'].forEach(k => {
    if (out[k]) {
      out[k] = out[k]
        .replace(/\s*(품\s*목\s*코\s*드|수\s*량|제\s*조\s*원|공\s*급\s*업\s*체|사\s*용\s*기\s*한|입\s*고\s*번\s*호).*$/i, '')
        .replace(/[:\-]\s*$/, '')
        .trim();
    }
  });

  return out;
}

function parseProductionText(raw) {
  const t = String(raw || '')
    .replace(/\r/g, '\n').replace(/[：﹕]/g, ':').replace(/[|｜]/g, ' ').replace(/[ \t]+/g, ' ');
  const lines = t.split('\n').map(s => s.trim()).filter(Boolean);
  const out = {};

  function grab(labelRe, valueRe) {
    for (let i = 0; i < lines.length; i++) {
      const m = lines[i].match(new RegExp(labelRe.source + '\\s*[:\\-]?\\s*(.*)$', 'i'));
      if (!m) continue;
      const rest = (m[1] || '').trim();
      if (rest) {
        const v = valueRe ? rest.match(valueRe) : [rest];
        if (v) return (v[1] !== undefined ? v[1] : v[0]).trim();
      }
      for (let j = i + 1; j < Math.min(i + 3, lines.length); j++) {
        const nxt = lines[j].trim();
        if (!nxt) continue;
        const v = valueRe ? nxt.match(valueRe) : [nxt];
        if (v) return (v[1] !== undefined ? v[1] : v[0]).trim();
      }
    }
    return '';
  }

  const DATE = /([0-9]{4}\s*[-.\/년]\s*[0-9]{1,2}\s*[-.\/월]\s*[0-9]{1,2}|[0-9]{8})/;

  out.productName = grab(/제\s*품\s*명|품\s*명/);
  out.lotNo = grab(/제\s*조\s*번\s*호|로\s*트\s*번\s*호|lot\s*(?:no\.?)?|batch\s*(?:no\.?)?/, /([A-Za-z0-9\-]{2,})/);
  out.prodDate = normalizeDate(grab(/제\s*조\s*일\s*자?|생\s*산\s*일\s*자?/, DATE));
  out.prodQty = grab(/생\s*산\s*수\s*량|수\s*량/, /([0-9][0-9,]*)/);
  if (out.prodQty) out.prodQty = out.prodQty.replace(/,/g, '');

  if (out.productName) {
    out.productName = out.productName
      .replace(/\s*(제\s*조\s*번\s*호|로\s*트|lot|batch|제\s*조\s*일\s*자?|생\s*산\s*일\s*자?|수\s*량).*$/i, '')
      .replace(/[:\-]\s*$/, '').trim();
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

function captureScannerFrame(mode) {
  try {
    const readerId = mode === 'single' ? 'reader' : 'readerMulti';
    const video = document.querySelector('#' + readerId + ' video');
    if (!video || !video.videoWidth) return;
    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    canvas.getContext('2d').drawImage(video, 0, 0);
    const dataUrl = canvas.toDataURL('image/jpeg', 0.85);
    lastPhotoDataUrl[mode] = dataUrl;
    const preview = document.getElementById(MODE_UI[mode].preview);
    preview.src = dataUrl;
    preview.classList.remove('hidden');
  } catch (e) { /* 캡처 실패해도 스캔 자체는 계속 진행 */ }
}

async function onCode(text) {
  if (scanMode === 'single') {
    captureScannerFrame('single'); // 스캔 순간의 화면을 라벨 사진으로 자동 저장
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
  captureScannerFrame('multi'); // 가장 최근 스캔 화면을 대표 사진으로 저장

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
      lastSavedRecord.single = {
        record: {
          id: res.id, regDate: new Date().toLocaleString('ko-KR'), mode: '단건',
          inboundNo: payload.inboundNo, inboundDate: payload.inboundDate, product: payload.product,
          itemCode: payload.itemCode, manufacturer: payload.manufacturer, supplier: payload.supplier,
          displayQty: payload.displayQty, unit: payload.unit, expiryDate: payload.expiryDate,
          infoMatch: payload.infoMatch, mixed: payload.mixed, actualQty: payload.actualQty,
          finalResult: payload.finalResult, note: payload.note, inspector: payload.inspector
        },
        pallets: []
      };
      document.getElementById('btnPrintSingle').classList.remove('hidden');
      rememberInspector(payload.inspector);
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
      lastSavedRecord.multi = {
        record: {
          id: res.id, regDate: new Date().toLocaleString('ko-KR'), mode: '다중팔레트',
          inboundNo: payload.inboundNo, product: payload.product, itemCode: payload.itemCode,
          supplier: payload.supplier, displayQty: payload.displayQty, unit: payload.unit,
          palletCount: multiPallets.length, totalQty: res.total, mixedCount: res.mixedCount,
          finalResult: payload.finalResult, note: payload.note, inspector: payload.inspector
        },
        pallets: multiPallets.map((p, i) => ({
          seq: i + 1, code: p.code, containerNo: p.containerNo, product: p.product,
          qty: p.qty, unit: p.unit, result: p.mismatch ? '이종' : '정상'
        }))
      };
      document.getElementById('btnPrintMulti').classList.remove('hidden');
      rememberInspector(payload.inspector);
    } else {
      setStatus('saveMultiStatus', '저장 실패: ' + res.message, 'bad');
    }
  } catch (e) {
    setStatus('saveMultiStatus', '저장 실패: ' + e, 'bad');
  }
}

function clearSingle() {
  stopLiveOcr('single');
  document.getElementById('btnPrintSingle').classList.add('hidden');
  lastSavedRecord.single = null;
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
  document.getElementById('inspector').value = getRememberedInspector();
  setStatus('singleStatus', '라벨을 촬영하거나 코드를 스캔하세요.', '');
  setStatus('qtyStatus', '수량을 입력하면 일치 여부를 계산합니다.', '');
  setStatus('saveSingleStatus', '저장 전 자동입력 내용을 확인하세요.', '');
}

function clearMulti() {
  stopLiveOcr('multi');
  document.getElementById('btnPrintMulti').classList.add('hidden');
  lastSavedRecord.multi = null;
  multiPallets = [];
  ['mProduct', 'mItemCode', 'mSupplier', 'mQty', 'mInboundNo', 'mNote', 'mInspector']
    .forEach(id => document.getElementById(id).value = '');
  document.getElementById('multiPreview').classList.add('hidden');
  document.getElementById('ocrBoxMulti').classList.add('hidden');
  document.getElementById('ocrProgressMulti').style.width = '0%';
  lastPhotoDataUrl.multi = ''; lastOcrText.multi = '';
  itemPhotos.multi = []; renderItemPhotos('multi');
  renderPallets();
  document.getElementById('mInspector').value = getRememberedInspector();
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
  const get = id => document.getElementById(id).value.trim();
  const productName = get('prodProductName');
  if (!productName) {
    setStatus('saveProdStatus', '제품명을 입력하세요.', 'bad');
    return;
  }
  if (!get('prodLotNo')) {
    setStatus('saveProdStatus', '제조번호를 입력하세요.', 'bad');
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
      rememberInspector(payload.registrant);
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
  document.getElementById('prodRegistrant').value = getRememberedInspector();
  setStatus('prodOcrStatus', '제품명·제조번호가 보이도록 촬영하면 아래 항목이 자동으로 채워집니다.', '');
  setStatus('prodSearchStatus', '입고번호나 품명으로 검색해서 사용한 공병 입고건을 선택하세요.', '');
  setStatus('saveProdStatus', '연결할 입고건 선택 후 생산 정보를 입력하세요.', '');
}

/* ============ 보고서 출력 (A4) ============ */

let lastSavedRecord = { single: null, multi: null };
let currentViewRecord = null;
let viewSearchResultsList = [];

function esc2(s) { return esc(s); } // alias for clarity in templates

function buildPrintHtml(record, pallets) {
  const rows = (label, value) => `<tr><th>${esc(label)}</th><td>${esc(value == null ? '' : value)}</td></tr>`;
  const palletRows = (pallets || []).map(p => `
    <tr>
      <td>${esc(p.seq || '')}</td><td>${esc(p.containerNo || p.code || '')}</td>
      <td>${esc(p.product || '')}</td><td>${esc(p.qty || '')}${esc(p.unit || '')}</td>
      <td>${p.result === '이종' ? '⚠ 이종' : '정상'}</td>
    </tr>`).join('');

  return `<!DOCTYPE html><html lang="ko"><head><meta charset="UTF-8">
<title>공병 입고 확인 기록서</title>
<style>
  body{font-family:'Malgun Gothic',sans-serif; padding:24px; color:#1C1B19;}
  h1{font-size:1.3rem; border-bottom:2px solid #1F4B5F; padding-bottom:8px;}
  table{width:100%; border-collapse:collapse; margin:12px 0; font-size:0.85rem;}
  th,td{border:1px solid #ccc; padding:6px 8px; text-align:left;}
  th{background:#F0EFE9; width:120px;}
  .meta{color:#666; font-size:0.8rem; margin-bottom:8px;}
  .sign{display:flex; justify-content:flex-end; gap:40px; margin-top:40px; font-size:0.85rem;}
  .sign div{border-top:1px solid #333; padding-top:6px; width:140px; text-align:center;}
  @media print{ .noprint{display:none;} }
</style></head><body>
  <h1>공병 입고 확인 기록서</h1>
  <div class="meta">기록 ID: ${esc(record.id)} · 등록일시: ${esc(record.regDate)} · 모드: ${esc(record.mode)}</div>
  <table>
    ${rows('입고번호', record.inboundNo)}
    ${rows('입고일자', record.inboundDate)}
    ${rows('품명', record.product)}
    ${rows('품목코드', record.itemCode)}
    ${rows('제조원', record.manufacturer)}
    ${rows('공급업체', record.supplier)}
    ${rows('표시수량', (record.displayQty || '') + (record.unit || ''))}
    ${rows('사용기한', record.expiryDate)}
    ${record.mode === '단건' ? rows('입고정보 일치', record.infoMatch) : ''}
    ${record.mode === '단건' ? rows('혼입 여부', record.mixed) : ''}
    ${record.mode === '단건' ? rows('실제 확인수량', record.actualQty) : ''}
    ${record.mode === '다중팔레트' ? rows('팔레트 수', record.palletCount) : ''}
    ${record.mode === '다중팔레트' ? rows('총 수량', record.totalQty) : ''}
    ${record.mode === '다중팔레트' ? rows('이종 수', record.mixedCount) : ''}
    ${rows('최종 결과', record.finalResult)}
    ${rows('검수자', record.inspector)}
    ${rows('특이사항', record.note)}
  </table>
  ${pallets && pallets.length ? `
  <table>
    <tr><th>#</th><th>용기번호</th><th>품명</th><th>수량</th><th>판정</th></tr>
    ${palletRows}
  </table>` : ''}
  <div class="sign">
    <div>검수자</div>
    <div>확인자</div>
  </div>
  <div class="noprint" style="margin-top:20px;">
    <button onclick="window.print()">인쇄</button>
  </div>
  <script>window.onload=()=>window.print();</script>
</body></html>`;
}

function openPrintWindow(record, pallets) {
  const html = buildPrintHtml(record, pallets);
  const w = window.open('', '_blank');
  if (!w) { alert('팝업이 차단되었습니다. 팝업 허용 후 다시 시도해주세요.'); return; }
  w.document.open();
  w.document.write(html);
  w.document.close();
}

function printLastSaved(mode) {
  const rec = lastSavedRecord[mode];
  if (!rec) return;
  openPrintWindow(rec.record, rec.pallets);
}

async function searchViewRecords() {
  const kw = document.getElementById('viewSearchKw').value.trim();
  if (!kw) { setStatus('viewSearchStatus', '검색어를 입력하세요.', 'bad'); return; }
  setStatus('viewSearchStatus', '검색 중...', 'warn');
  document.getElementById('viewDetailCard').classList.add('hidden');
  try {
    const res = await apiGet('searchRecords', { keyword: kw });
    if (!res.ok) { setStatus('viewSearchStatus', '검색 실패: ' + res.message, 'bad'); return; }
    viewSearchResultsList = res.items || [];
    const box = document.getElementById('viewSearchResults');
    if (viewSearchResultsList.length === 0) {
      box.innerHTML = '';
      setStatus('viewSearchStatus', '일치하는 기록이 없습니다.', 'bad');
      return;
    }
    setStatus('viewSearchStatus', viewSearchResultsList.length + '건 검색됨 · 선택하면 상세/출력이 가능합니다.', 'ok');
    box.innerHTML = viewSearchResultsList.map((it, i) => `
      <div class="result-item" onclick="openRecordDetail(${i})">
        <div>
          <div>${esc(it.product)} · ${esc(String(it.qty))}${esc(it.unit || '')}</div>
          <div class="meta">입고번호 ${esc(it.inboundNo)} · ${esc(it.mode)} · ${esc(it.regDate)}</div>
        </div>
        <div>›</div>
      </div>
    `).join('');
  } catch (e) {
    setStatus('viewSearchStatus', '검색 실패: ' + e, 'bad');
  }
}

async function openRecordDetail(index) {
  const it = viewSearchResultsList[index];
  if (!it) return;
  setStatus('viewSearchStatus', '상세 불러오는 중...', 'warn');
  try {
    const res = await apiGet('getRecord', { id: it.id });
    if (!res.ok) { setStatus('viewSearchStatus', '조회 실패: ' + res.message, 'bad'); return; }
    currentViewRecord = res;
    const r = res.record;
    document.getElementById('viewDetailCard').classList.remove('hidden');
    document.getElementById('viewDetailBox').innerHTML = `
      <div><b>${esc(r.product)}</b> · ${esc(r.mode)}</div>
      <div style="color:var(--muted);margin:6px 0;">입고번호 ${esc(r.inboundNo)} · 등록 ${esc(r.regDate)}</div>
      <div>최종 결과: <b>${esc(r.finalResult)}</b> · 검수자: ${esc(r.inspector || '-')}</div>
      ${res.pallets && res.pallets.length ? `<div style="margin-top:6px;color:var(--muted);">팔레트 ${res.pallets.length}건 포함</div>` : ''}
    `;
    setStatus('viewSearchStatus', viewSearchResultsList.length + '건 검색됨 · 선택하면 상세/출력이 가능합니다.', 'ok');
  } catch (e) {
    setStatus('viewSearchStatus', '조회 실패: ' + e, 'bad');
  }
}

function printCurrentViewRecord() {
  if (!currentViewRecord) return;
  openPrintWindow(currentViewRecord.record, currentViewRecord.pallets);
}

/* ============ 검수자 이름 기억 ============ */

const INSPECTOR_KEY = 'gongbyeong_inspector';

function getRememberedInspector() {
  try { return localStorage.getItem(INSPECTOR_KEY) || ''; } catch (e) { return ''; }
}

function rememberInspector(name) {
  const v = String(name || '').trim();
  if (!v) return;
  try { localStorage.setItem(INSPECTOR_KEY, v); } catch (e) {}
  ['inspector', 'mInspector', 'prodRegistrant'].forEach(id => {
    const el = document.getElementById(id);
    if (el && !el.value.trim()) el.value = v;
  });
}

function initInspector() {
  const saved = getRememberedInspector();
  ['inspector', 'mInspector', 'prodRegistrant'].forEach(id => {
    const el = document.getElementById(id);
    if (!el) return;
    if (saved) el.value = saved;
    el.addEventListener('change', () => rememberInspector(el.value));
  });
}

/* ============ PWA 설치 ============ */

window.addEventListener('DOMContentLoaded', initInspector);

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  });
}
