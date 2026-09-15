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

// OCR이 자주 헷갈리는 글자를 숫자 자리에서 교정
function fixDigits(s) {
  return String(s || '')
    .replace(/[OoDQ]/g, '0')
    .replace(/[lIi|]/g, '1')
    .replace(/[Ss]/g, '5')
    .replace(/[Bb]/g, '8')
    .replace(/[Zz]/g, '2')
    .replace(/[gq]/g, '9')
    .replace(/[Tt]/g, '7');
}

// 실제로 존재할 수 있는 날짜만 통과시킨다 (잘못 읽은 값이 들어가는 것을 막음)
function validDate(y, m, d) {
  y = Number(y); m = Number(m); d = Number(d);
  if (!(y >= 2000 && y <= 2099)) return '';
  if (!(m >= 1 && m <= 12)) return '';
  if (!(d >= 1 && d <= 31)) return '';
  const dt = new Date(y, m - 1, d);
  if (dt.getFullYear() !== y || dt.getMonth() !== m - 1 || dt.getDate() !== d) return '';
  return y + '-' + ('0' + m).slice(-2) + '-' + ('0' + d).slice(-2);
}

function normalizeDate(v) {
  const s = String(v || '').trim();
  if (!s) return '';

  // 2026년 08월 19일 / 2026-08-19 / 2026.8.19
  let m = s.match(/([0-9]{4})\D{1,3}([0-9]{1,2})\D{1,3}([0-9]{1,2})/);
  if (m) return validDate(m[1], m[2], m[3]);

  // 26.05.19 / 26년 08월 13일  (2자리 연도)
  m = s.match(/(?:^|\D)([0-9]{2})\D{1,3}([0-9]{1,2})\D{1,3}([0-9]{1,2})(?!\d)/);
  if (m) return validDate('20' + m[1], m[2], m[3]);

  // 20260901 (8자리 연속)
  const d8 = fixDigits(s).replace(/[^0-9]/g, '');
  if (d8.length === 8) return validDate(d8.slice(0, 4), d8.slice(4, 6), d8.slice(6, 8));

  return '';
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
let lastPhotoDataUrl = { single: '', multi: '', prod: '', wms: '', vendor: '' };
let lastOcrText = { single: '', multi: '', prod: '', wms: '', vendor: '' };

const MODE_UI = {
  single: { preview: 'wmsPreview', status: 'wmsStatus', progress: 'ocrProgressWms', box: 'ocrBoxWms', video: 'liveVideoSingle', wrap: 'liveWrapSingle' },
  wms: { preview: 'wmsPreview', status: 'wmsStatus', progress: 'ocrProgressWms', box: 'ocrBoxWms', video: 'liveVideoSingle', wrap: 'liveWrapSingle' },
  vendor: { preview: 'vendorPreview', status: 'vendorStatus', progress: 'ocrProgressVendor', box: 'ocrBoxVendor', video: 'liveVideoSingle', wrap: 'liveWrapSingle' },
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

// 서버(Google Drive OCR)를 우선 사용하고, 실패 시 브라우저 Tesseract로 대체
async function runOcr(dataUrl, progressId) {
  if (CONFIG.API_URL && CONFIG.API_URL.indexOf('PUT_YOUR') !== 0) {
    try {
      const res = await apiPost('ocr', { image: dataUrl });
      if (res.ok && (res.text || '').trim()) return res.text;
    } catch (e) { /* 서버 OCR 실패 → 아래 Tesseract로 진행 */ }
  }
  const worker = await getOcrWorker(progressId);
  const ret = await worker.recognize(dataUrl);
  return ret.data.text || '';
}

function applyOcrToMode(mode, parsed) {
  let filled = 0;
  if (mode === 'single' || mode === 'wms') {
    applyParsed(parsed);
    filled = Object.keys(parsed).filter(k => parsed[k]).length;
  } else if (mode === 'vendor') {
    const v = parseVendorLabel(lastOcrText.vendor);
    if (v.product) { document.getElementById('vProduct').value = v.product; filled++; }
    if (v.qty) { document.getElementById('vQty').value = v.qty; filled++; }
    if (v.prodDate) { document.getElementById('vProdDate').value = v.prodDate; filled++; }
    if (v.lotNo) { document.getElementById('vLotNo').value = v.lotNo; filled++; }
    compareLabels();
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
  if ((mode === 'single' || mode === 'wms') && filled > 0) {
    const blanks = [];
    if (!document.getElementById('inboundDate').value.trim()) blanks.push('입고일자');
    if (!document.getElementById('expiryDate').value.trim()) blanks.push('사용기한');
    if (blanks.length) {
      setTimeout(() => setStatus('wmsStatus',
        '자동인식 완료 · ' + blanks.join('/') + '는 잘못 읽힐 수 있어 비워뒀습니다. 직접 확인해 입력하세요.', 'warn'), 0);
    }
  }
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
  if (mode === 'wms') lastPhotoDataUrl.single = dataUrl;

  const ui = MODE_UI[mode];
  const preview = document.getElementById(ui.preview);
  preview.src = dataUrl;
  preview.classList.remove('hidden');

  document.getElementById(ui.box).classList.remove('hidden');
  setStatus(ui.status, '자동인식 중... (몇 초 걸릴 수 있어요)', 'warn');

  try {
    const raw = await runOcr(dataUrl, ui.progress);
    lastOcrText[mode] = raw;
    if (mode === 'wms') lastOcrText.single = raw;
    const parsed = (mode === 'prod' || mode === 'vendor') ? {} : parseLabelText(raw);
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

  out.inboundNo = fixDigits(grab(/입\s*고\s*번\s*호/, /([0-9OolIiSsBbZzgq]{5,})/)).replace(/[^0-9]/g, '');
  out.product = grab(/품\s*명|제\s*품\s*명/);
  out.itemCode = fixDigits(grab(/품\s*목\s*코\s*드|자\s*재\s*코\s*드/, /([A-Za-z0-9\-]{3,})/)).replace(/[^0-9A-Za-z\-]/g, '');
  out.manufacturer = grab(/제\s*조\s*원|제\s*조\s*사/);
  out.supplier = grab(/공\s*급\s*업\s*체|거\s*래\s*처|납\s*품\s*처/);
  out.inboundDate = normalizeDate(grab(/입\s*고\s*일\s*자?|납\s*품\s*일\s*자?/, DATE));
  out.expiryDate = normalizeDate(grab(/사\s*용\s*기\s*한|유\s*효\s*기\s*한/, DATE));

  const qtyStr = grab(/수\s*량/, NUM);
  if (qtyStr) {
    const q = fixDigits(qtyStr).replace(/[^0-9.]/g, '');
    if (q && Number(q) > 0) out.displayQty = String(Number(q));
  }
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

// 업체 라벨: 회사마다 항목명이 달라서 별도 사전으로 처리
// (KC Glass: 제품명/규격/1PT 수량/라인·Lot No. · 동아에코팩: 품명/P/L No./포장사양 · 동화지앤피: 품명/P-번호/수량)
function parseVendorLabel(raw) {
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

  out.product = grab(/제\s*품\s*명|품\s*명/);
  const spec = grab(/규\s*격/);
  if (spec && out.product && out.product.indexOf(spec) === -1) out.product = (out.product + ' ' + spec).trim();

  // 수량: "1PT 수량 9,072" / "40*41*13단 = 21,320본" / "900 x 12단 : 10,800본"
  let qty = grab(/1\s*PT\s*수\s*량|수\s*량/, /([0-9][0-9,]{2,})\s*(?:본|EA|개)?\s*$/);
  if (!qty) {
    const eq = t.match(/[=:]\s*([0-9][0-9,]{2,})\s*(?:본|EA|개)/i);
    if (eq) qty = eq[1];
  }
  if (!qty) {
    const pk = grab(/포\s*장\s*사\s*양/, /([0-9][0-9,]{2,})\s*(?:본|EA|개)/);
    if (pk) qty = pk;
  }
  if (qty) out.qty = qty.replace(/,/g, '');

  out.prodDate = normalizeDate(
    grab(/생\s*산\s*일\s*자?|제\s*조\s*일\s*자?/,
      /([0-9]{2,4}\s*[-.\/년]\s*[0-9]{1,2}\s*[-.\/월]\s*[0-9]{1,2}|[0-9]{8})/)
  );

  // Lot: "1F / 224" 형태는 뒤 숫자, "P-번호 742", "P/L No. 4"
  out.lotNo = grab(/라\s*인\s*[\/·]?\s*lot\s*no\.?/, /([A-Za-z0-9]+)\s*[\/]\s*([A-Za-z0-9\-]+)$/)
    || grab(/lot\s*no\.?|로\s*트\s*번\s*호|제\s*조\s*번\s*호/, /([A-Za-z0-9\-]{2,})/)
    || grab(/p\s*[-–]\s*번\s*호/, /([A-Za-z0-9\-]{2,})/)
    || grab(/p\s*\/\s*l\s*no\.?/, /([A-Za-z0-9\-]+)/);
  const lotPair = t.match(/라\s*인\s*[\/·]?\s*lot\s*no\.?\s*[:\-]?\s*([A-Za-z0-9]+)\s*[\/]\s*([A-Za-z0-9\-]+)/i);
  if (lotPair) out.lotNo = lotPair[2];

  out.maker = grab(/제\s*조\s*회\s*사|제\s*조\s*원|생\s*산\s*자/);
  out.deliverTo = grab(/납\s*품\s*처/);

  if (out.product) {
    out.product = out.product
      .replace(/\s*(규\s*격|수\s*량|생\s*산\s*일\s*자?|생\s*산\s*라\s*인|포\s*장|라\s*인).*$/i, '')
      .replace(/[:\-]\s*$/, '').trim();
  }
  return out;
}

// 품명 비교용 정규화: 공백/괄호/단위표기 차이를 무시
function normProductName(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/[()（）\s\-_.]/g, '')
    .replace(/ml리터/g, 'ml')
    .replace(/㎖/g, 'ml');
}

function compareLabels() {
  const wmsProduct = document.getElementById('product').value.trim();
  const wmsQty = num(document.getElementById('displayQty').value);
  const vProduct = document.getElementById('vProduct').value.trim();
  const vQty = num(document.getElementById('vQty').value);

  if (!wmsProduct && !vProduct) {
    setStatus('matchResult', '두 라벨을 모두 입력하면 자동으로 대조합니다.', '');
    singleMatchOk = null;
    return;
  }
  if (!wmsProduct || !vProduct) {
    setStatus('matchResult', '아직 한쪽 라벨만 입력되었습니다.', 'warn');
    singleMatchOk = null;
    return;
  }

  const issues = [];
  const a = normProductName(wmsProduct), b = normProductName(vProduct);
  const nameOk = a === b || a.indexOf(b) >= 0 || b.indexOf(a) >= 0;
  if (!nameOk) issues.push('품명 불일치 (WMS: ' + wmsProduct + ' / 업체: ' + vProduct + ')');
  if (wmsQty && vQty && wmsQty !== vQty) issues.push('수량 불일치 (WMS: ' + wmsQty + ' / 업체: ' + vQty + ')');

  if (issues.length) {
    setStatus('matchResult', '⚠ ' + issues.join(' · '), 'bad');
    singleMatchOk = false;
  } else {
    setStatus('matchResult', '✓ 두 라벨 정보가 일치합니다.', 'ok');
    singleMatchOk = true;
  }
}

let singleMatchOk = null;

function applyParsed(p, force) {
  const ids = ['inboundNo', 'inboundDate', 'product', 'itemCode', 'manufacturer', 'supplier', 'displayQty', 'unit', 'expiryDate', 'containerFrom', 'containerTo', 'codeRaw'];
  ids.forEach(id => {
    const el = document.getElementById(id);
    if (!el) return;
    // Master(바코드) 정보는 OCR로 채운 값을 덮어쓴다
    if (p[id] && (force || !el.value.trim())) el.value = p[id];
  });
  if (document.getElementById('actualQty').value === '' && p.displayQty) {
    document.getElementById('actualQty').value = p.displayQty;
    updateSingleQty();
  }
}

function applyMasterToForm(d) {
  applyParsed({
    inboundNo: d.inboundNo, product: d.product, itemCode: d.itemCode, manufacturer: d.manufacturer,
    supplier: d.supplier, displayQty: d.qty, unit: d.unit, expiryDate: d.expiryDate, containerFrom: d.containerNo
  }, true);
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
  if (!wrap) return;
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
  stopLiveOcr('single');
  scanMode = mode;
  const map = {
    single: { wrap: 'readerWrapSingle', reader: 'reader' },
    base: { wrap: 'readerWrapMulti', reader: 'readerMulti' },
    loop: { wrap: 'readerWrapLoop', reader: 'readerLoop' }
  };
  const cfg = map[mode] || map.single;
  document.getElementById(cfg.wrap).classList.remove('hidden');

  activeScanner = new Html5Qrcode(cfg.reader);
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
    const sid = mode === 'single' ? 'wmsStatus' : (mode === 'base' ? 'multiBaseStatus' : 'loopStatus');
    setStatus(sid, '카메라 실행 실패: ' + e, 'bad');
  }
}

async function stopScanner() {
  if (activeScanner) {
    try { await activeScanner.stop(); await activeScanner.clear(); } catch (e) {}
    activeScanner = null;
  }
  ['readerWrapSingle', 'readerWrapMulti', 'readerWrapLoop'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.classList.add('hidden');
  });
}

// 스캔 중인 카메라 화면을 그대로 캡처 (별도 촬영 없이 사진 확보)
function grabScannerFrame(readerId) {
  try {
    const video = document.querySelector('#' + readerId + ' video');
    if (!video || !video.videoWidth) return '';
    return shrinkFromVideo(video);
  } catch (e) { return ''; }
}

function captureScannerFrame(mode) {
  const readerId = mode === 'wms' ? 'reader' : 'readerMulti';
  const dataUrl = grabScannerFrame(readerId);
  if (!dataUrl) return;
  lastPhotoDataUrl[mode] = dataUrl;
  if (mode === 'wms') lastPhotoDataUrl.single = dataUrl;
  const ui = MODE_UI[mode];
  if (ui) {
    const preview = document.getElementById(ui.preview);
    if (preview) { preview.src = dataUrl; preview.classList.remove('hidden'); }
  }
}

async function onCode(text) {
  if (scanMode === 'single') {
    captureScannerFrame('wms');
    await stopScanner();
    applyParsed(parseCode(text));
    document.getElementById('codeRaw').value = text;
    setStatus('wmsStatus', '코드 인식 완료 · ' + text, 'ok');

    const res = await lookupMaster(text);
    if (res && res.found) {
      applyMasterToForm(res.data);
      setStatus('wmsStatus', '코드 + Master 정보 자동입력 완료', 'ok');
    }
    compareLabels();
    return;
  }

  if (scanMode === 'base') {
    const frame = grabScannerFrame('readerMulti');
    await stopScanner();
    const p = parseCode(text);
    if (frame) {
      lastPhotoDataUrl.multi = frame;
      const pv = document.getElementById('multiPreview');
      pv.src = frame; pv.classList.remove('hidden');
    }
    const res = await lookupMaster(text);
    const d = (res && res.found) ? res.data : {};
    if (d.product || p.product) document.getElementById('mProduct').value = d.product || p.product;
    if (d.itemCode || p.itemCode) document.getElementById('mItemCode').value = d.itemCode || p.itemCode;
    if (d.supplier || p.supplier) document.getElementById('mSupplier').value = d.supplier || p.supplier;
    if (d.qty || p.displayQty) document.getElementById('mQty').value = d.qty || p.displayQty;
    if (d.inboundNo || p.inboundNo) document.getElementById('mInboundNo').value = d.inboundNo || p.inboundNo;
    setStatus('multiBaseStatus', '기준정보 설정 완료 · 이제 아래에서 파레트를 하나씩 등록하세요.', 'ok');
    renderLoop();
    return;
  }

  if (scanMode === 'loop') {
    if (multiPallets.some(x => x.code === text) || (currentPallet && currentPallet.code === text)) return;
    if (navigator.vibrate) navigator.vibrate(60);
    const frame = grabScannerFrame('readerLoop');
    await stopScanner();

    const p = parseCode(text);
    currentPallet = currentPallet || {};
    currentPallet.code = text;
    currentPallet.wmsPhoto = frame;
    currentPallet.inboundNo = p.inboundNo || document.getElementById('mInboundNo').value || '';
    currentPallet.containerNo = p.containerFrom || '';
    currentPallet.itemCode = document.getElementById('mItemCode').value.trim();
    currentPallet.product = document.getElementById('mProduct').value.trim();
    currentPallet.supplier = document.getElementById('mSupplier').value.trim();
    currentPallet.qty = num(document.getElementById('mQty').value);
    currentPallet.unit = 'EA';
    currentPallet.scanTime = new Date().toLocaleTimeString('ko-KR');
    renderLoop();

    // Master 조회는 백그라운드로 (대기 없음)
    lookupMaster(text).then(res => {
      if (!res || !res.found || !currentPallet || currentPallet.code !== text) return;
      const base = document.getElementById('mItemCode').value.trim();
      currentPallet.containerNo = res.data.containerNo || currentPallet.containerNo;
      currentPallet.itemCode = res.data.itemCode || currentPallet.itemCode;
      currentPallet.product = res.data.product || currentPallet.product;
      currentPallet.qty = num(res.data.qty) || currentPallet.qty;
      currentPallet.mismatch = !!(base && currentPallet.itemCode && currentPallet.itemCode !== base);
      renderLoop();
    });
  }
}

/* ============ 파레트 반복 등록 루프 ============ */

let multiPallets = [];
let currentPallet = null;
let palletSeq = 1;

function shrinkFromVideo(video) {
  const max = 1400;
  const scale = Math.min(1, max / Math.max(video.videoWidth, video.videoHeight));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(video.videoWidth * scale);
  canvas.height = Math.round(video.videoHeight * scale);
  canvas.getContext('2d').drawImage(video, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL('image/jpeg', 0.7);
}

// 업로드 용량을 줄이기 위해 사진을 축소/압축
function shrinkDataUrl(dataUrl) {
  return new Promise(resolve => {
    const img = new Image();
    img.onload = () => {
      const max = 1400;
      const scale = Math.min(1, max / Math.max(img.width, img.height));
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(img.width * scale);
      canvas.height = Math.round(img.height * scale);
      canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
      resolve(canvas.toDataURL('image/jpeg', 0.7));
    };
    img.onerror = () => resolve(dataUrl);
    img.src = dataUrl;
  });
}

function loopScan() {
  if (!document.getElementById('mProduct').value.trim()) {
    setStatus('loopStatus', '먼저 위에서 기준정보를 설정하세요.', 'bad');
    return;
  }
  startScanner('loop');
}

async function loopVendorSelected(event) {
  const file = event.target.files && event.target.files[0];
  if (!file) return;
  event.target.value = '';
  const raw = await fileToDataUrl(file);
  const small = await shrinkDataUrl(raw);
  currentPallet = currentPallet || {};
  currentPallet.vendorPhoto = small;
  renderLoop();

  // OCR은 백그라운드 — 작업을 막지 않음
  const target = currentPallet;
  runOcr(small, 'loopOcrDummy').then(text => {
    if (!target || target.vendorPhoto !== small) return;
    const v = parseVendorLabel(text);
    target.vendorProduct = v.product || '';
    target.vendorOcr = text;
    const base = document.getElementById('mProduct').value.trim();
    if (base && v.product) {
      const a = normProductName(base), b = normProductName(v.product);
      const ok = a === b || a.indexOf(b) >= 0 || b.indexOf(a) >= 0;
      target.matchResult = ok ? '일치' : '불일치';
      if (!ok) target.mismatch = true;
    }
    renderLoop();
  }).catch(() => {});
}

function renderLoop() {
  const p = currentPallet || {};
  const hasScan = !!p.code, hasVendor = !!p.vendorPhoto;

  document.getElementById('loopNo').textContent = palletSeq;
  const expected = num(document.getElementById('mExpected').value);
  document.getElementById('loopTotal').textContent = expected ? (' / ' + expected) : '';
  document.getElementById('loopProgress').style.width =
    expected ? Math.min(100, (multiPallets.length / expected) * 100) + '%' : '0%';
  document.getElementById('loopSub').textContent =
    expected ? (multiPallets.length + '개 완료 · ' + Math.max(0, expected - multiPallets.length) + '개 남음')
             : (multiPallets.length + '개 완료');

  document.getElementById('stepScan').classList.toggle('done', hasScan);
  document.getElementById('chkScan').textContent = hasScan ? '✓' : '';
  document.getElementById('stepVendor').classList.toggle('done', hasVendor);
  document.getElementById('chkVendor').textContent = hasVendor ? '✓' : '';
  document.getElementById('btnNextPallet').disabled = !(hasScan && hasVendor);

  if (!hasScan) setStatus('loopStatus', '바코드를 스캔하세요.', '');
  else if (!hasVendor) setStatus('loopStatus', '스캔 완료 (' + p.code + ') · 이제 업체라벨을 촬영하세요.', 'warn');
  else if (p.matchResult === '불일치') setStatus('loopStatus', '⚠ 업체라벨 품명이 기준과 다릅니다: ' + (p.vendorProduct || ''), 'bad');
  else setStatus('loopStatus', '준비 완료 · "이 파레트 완료"를 누르세요.', 'ok');

  renderPallets();
}

async function commitPallet() {
  if (!currentPallet || !currentPallet.code || !currentPallet.vendorPhoto) return;
  const p = currentPallet;
  p.seq = palletSeq;
  multiPallets.push(p);
  currentPallet = null;
  palletSeq++;
  renderLoop();
  setStatus('loopStatus', '파레트 ' + p.seq + ' 등록됨 · 다음 파레트 바코드를 스캔하세요.', 'ok');

  // 사진은 즉시 업로드해서 마지막에 몰리지 않게 함
  uploadPalletPhotos(p);
}

async function uploadPalletPhotos(p) {
  try {
    if (p.wmsPhoto) {
      const r = await apiPost('uploadPhoto', { image: p.wmsPhoto, name: 'P' + p.seq + '_WMS_' + (p.code || '') });
      if (r.ok) { p.wmsPhotoUrl = r.url; p.wmsPhoto = ''; }
    }
    if (p.vendorPhoto) {
      const r2 = await apiPost('uploadPhoto', { image: p.vendorPhoto, name: 'P' + p.seq + '_업체_' + (p.code || '') });
      if (r2.ok) { p.vendorPhotoUrl = r2.url; }
    }
    renderPallets();
  } catch (e) { /* 실패해도 저장 시 다시 시도 */ }
}

function skipPalletNote() {
  const memo = window.prompt('이 파레트의 문제점을 적어주세요 (예: 라벨 훼손, 파손)');
  if (memo === null) return;
  currentPallet = currentPallet || {};
  currentPallet.note = memo;
  currentPallet.mismatch = true;
  renderLoop();
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
  document.getElementById('multiTotal').textContent = total.toLocaleString();
  document.getElementById('multiMixed').textContent = mixed;

  const list = document.getElementById('palletList');
  if (multiPallets.length === 0) {
    list.innerHTML = '<div class="status">등록된 파레트가 없습니다.</div>';
    return;
  }
  list.innerHTML = multiPallets.slice().reverse().map(p => `
    <div class="pallet-item">
      <div>
        <div>#${p.seq} ${esc(p.product || '')} · ${esc(String(p.qty || ''))}${esc(p.unit || '')}</div>
        <div class="code">${esc(p.containerNo || p.code || '')}${p.note ? ' · ' + esc(p.note) : ''}</div>
        <div class="thumbs">
          ${p.wmsPhotoUrl || p.wmsPhoto ? `<img src="${p.wmsPhoto || ''}" ${p.wmsPhotoUrl && !p.wmsPhoto ? 'style="display:none"' : ''}>` : ''}
          ${p.vendorPhoto ? `<img src="${p.vendorPhoto}">` : ''}
        </div>
      </div>
      ${p.mismatch ? '<div class="flag">⚠ 확인</div>' : '<div class="flag" style="color:var(--ok)">✓</div>'}
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
  compareLabels();
  if (singleMatchOk === false) {
    setStatus('saveSingleStatus', '두 라벨 정보가 일치하지 않아 저장할 수 없습니다. 2단계의 대조 결과를 확인하고 수정하세요.', 'bad');
    return;
  }
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
    photo: lastPhotoDataUrl.wms || lastPhotoDataUrl.single, ocrRaw: lastOcrText.wms || lastOcrText.single,
    vendorPhoto: lastPhotoDataUrl.vendor, vendorOcrRaw: lastOcrText.vendor,
    vendorProduct: get('vProduct'), vendorQty: get('vQty'),
    vendorProdDate: get('vProdDate'), vendorLotNo: get('vLotNo'),
    labelMatch: singleMatchOk === true ? '일치' : (singleMatchOk === false ? '불일치' : '미대조'),
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
          finalResult: payload.finalResult, note: payload.note, inspector: payload.inspector,
          labelMatch: payload.labelMatch, vendorProduct: payload.vendorProduct,
          vendorQty: payload.vendorQty, vendorLotNo: payload.vendorLotNo
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
    setStatus('saveMultiStatus', '스캔된 파레트가 없습니다.', 'bad');
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

  setStatus('saveMultiStatus', '사진 업로드 확인 중...', 'warn');
  for (const p of multiPallets) {
    if (p.wmsPhoto || (p.vendorPhoto && !p.vendorPhotoUrl)) await uploadPalletPhotos(p);
  }
  payload.pallets = multiPallets.map(p => ({
    seq: p.seq, code: p.code, inboundNo: p.inboundNo, containerNo: p.containerNo,
    itemCode: p.itemCode, product: p.product, supplier: p.supplier, qty: p.qty, unit: p.unit,
    mismatch: !!p.mismatch, wmsPhotoUrl: p.wmsPhotoUrl || '', vendorPhotoUrl: p.vendorPhotoUrl || '',
    vendorProduct: p.vendorProduct || '', matchResult: p.matchResult || '', scanTime: p.scanTime || '',
    note: p.note || ''
  }));

  setStatus('saveMultiStatus', '저장 중...', 'warn');
  try {
    const res = await apiPost('saveMulti', payload);
    if (res.ok) {
      setStatus('saveMultiStatus', '저장 완료 · 총 ' + res.total + (res.mixedCount ? (', 이종 ' + res.mixedCount + '건') : '') + ' (ID: ' + res.id + ')', 'ok');
      lastSavedRecord.multi = {
        record: {
          id: res.id, regDate: new Date().toLocaleString('ko-KR'), mode: '다중파레트',
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
  ['vProduct', 'vQty', 'vProdDate', 'vLotNo'].forEach(id => document.getElementById(id).value = '');
  ['wmsPreview', 'vendorPreview'].forEach(id => document.getElementById(id).classList.add('hidden'));
  ['ocrBoxWms', 'ocrBoxVendor', 'ocrRawWms', 'ocrRawVendor'].forEach(id => document.getElementById(id).classList.add('hidden'));
  lastPhotoDataUrl.wms = ''; lastPhotoDataUrl.vendor = '';
  lastOcrText.wms = ''; lastOcrText.vendor = '';
  singleMatchOk = null;
  setStatus('wmsStatus', '바코드를 스캔하거나 WMS 입고라벨을 촬영하세요.', '');
  setStatus('vendorStatus', '업체 라벨을 촬영하면 WMS 정보와 자동 비교합니다.', '');
  setStatus('matchResult', '두 라벨을 모두 입력하면 자동으로 대조합니다.', '');
  ['inboundNo', 'inboundDate', 'product', 'itemCode', 'manufacturer', 'supplier', 'displayQty',
    'expiryDate', 'containerFrom', 'containerTo', 'codeRaw', 'actualQty', 'note', 'inspector']
    .forEach(id => document.getElementById(id).value = '');
  document.getElementById('unit').value = 'EA';
  ['matchYes', 'matchNo', 'mixYes', 'mixNo'].forEach(id => document.getElementById(id).classList.remove('sel-ok', 'sel-bad'));
  lastPhotoDataUrl.single = ''; lastOcrText.single = '';
  itemPhotos.single = []; renderItemPhotos('single');
  document.getElementById('inspector').value = getRememberedInspector();
  setStatus('qtyStatus', '수량을 입력하면 일치 여부를 계산합니다.', '');
  setStatus('saveSingleStatus', '저장 전 자동입력 내용을 확인하세요.', '');
}

function clearMulti() {
  stopLiveOcr('multi');
  stopScanner();
  document.getElementById('btnPrintMulti').classList.add('hidden');
  lastSavedRecord.multi = null;
  multiPallets = [];
  currentPallet = null;
  palletSeq = 1;
  ['mProduct', 'mItemCode', 'mSupplier', 'mQty', 'mInboundNo', 'mExpected', 'mNote']
    .forEach(id => document.getElementById(id).value = '');
  document.getElementById('mInspector').value = getRememberedInspector();
  document.getElementById('multiPreview').classList.add('hidden');
  document.getElementById('ocrBoxMulti').classList.add('hidden');
  document.getElementById('ocrRawMulti').classList.add('hidden');
  lastPhotoDataUrl.multi = ''; lastOcrText.multi = '';
  renderLoop();
  setStatus('multiBaseStatus', '첫 파레트 바코드를 찍으면 품명·품목코드·수량이 자동 설정됩니다.', '');
  setStatus('saveMultiStatus', '파레트 등록 후 저장하세요.', '');
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
    ${String(record.mode || '') === '단건' ? rows('입고정보 일치', record.infoMatch) : ''}
    ${String(record.mode || '') === '단건' ? rows('혼입 여부', record.mixed) : ''}
    ${String(record.mode || '') === '단건' ? rows('실제 확인수량', record.actualQty) : ''}
    ${String(record.mode || '').indexOf('다중') === 0 ? rows('파레트 수', record.palletCount) : ''}
    ${String(record.mode || '').indexOf('다중') === 0 ? rows('총 수량', record.totalQty) : ''}
    ${String(record.mode || '').indexOf('다중') === 0 ? rows('이종 수', record.mixedCount) : ''}
    ${record.labelMatch ? rows('라벨 대조', record.labelMatch) : ''}
    ${record.vendorProduct ? rows('업체라벨 품명', record.vendorProduct) : ''}
    ${record.vendorQty ? rows('업체라벨 수량', record.vendorQty) : ''}
    ${record.vendorLotNo ? rows('업체 Lot/P-번호', record.vendorLotNo) : ''}
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
      ${res.pallets && res.pallets.length ? `<div style="margin-top:6px;color:var(--muted);">파레트 ${res.pallets.length}건 포함</div>` : ''}
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

/* ============ 입고 예정 목록 불러오기 ============ */

let importRows = [];

// WMS마다 열 이름이 달라서 여러 표기를 모두 인식
const IMPORT_ALIASES = {
  inboundNo: ['입고번호', '입고no', '입고번호no', 'inboundno', '입하번호', '전표번호'],
  containerNo: ['용기번호', '용기no', '팔레트번호', '파레트번호', 'containerno', '용기'],
  product: ['품명', '품목명', '자재명', '제품명', 'product', 'itemname'],
  itemCode: ['품목코드', '자재코드', '품번', 'itemcode', 'materialcode', '코드'],
  manufacturer: ['제조원', '제조사', '제조회사', 'manufacturer'],
  supplier: ['공급업체', '거래처', '납품처', '업체명', 'supplier', 'vendor'],
  qty: ['수량', '입고수량', '발주수량', 'qty', 'quantity'],
  unit: ['단위', 'unit', 'uom'],
  expiryDate: ['사용기한', '유효기한', '유통기한', 'expiry', 'expirydate'],
  inboundDate: ['입고일자', '입고일', '납품일자', 'inbounddate']
};

function normHeader(h) {
  return String(h || '').toLowerCase().replace(/[\s()\-_./]/g, '');
}

function splitRow(line) {
  if (line.indexOf('\t') >= 0) return line.split('\t');
  // 간단한 CSV 분해 (따옴표 안의 쉼표 보호)
  const out = []; let cur = ''; let q = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') { q = !q; continue; }
    if (c === ',' && !q) { out.push(cur); cur = ''; continue; }
    cur += c;
  }
  out.push(cur);
  return out;
}

function parseImportText(text) {
  const lines = String(text || '').replace(/\r/g, '').split('\n').filter(l => l.trim());
  if (lines.length < 2) return { rows: [], error: '제목줄과 데이터가 함께 필요합니다.' };

  const header = splitRow(lines[0]).map(normHeader);
  const map = {};
  Object.keys(IMPORT_ALIASES).forEach(field => {
    for (let i = 0; i < header.length; i++) {
      if (IMPORT_ALIASES[field].some(a => header[i] === normHeader(a))) { map[field] = i; return; }
    }
    for (let i = 0; i < header.length; i++) {
      if (IMPORT_ALIASES[field].some(a => header[i].indexOf(normHeader(a)) >= 0)) { map[field] = i; return; }
    }
  });

  if (map.inboundNo === undefined || map.product === undefined) {
    return { rows: [], error: '입고번호와 품명 열을 찾지 못했습니다. 제목줄이 포함되었는지 확인하세요.' };
  }

  const rows = [];
  for (let i = 1; i < lines.length; i++) {
    const c = splitRow(lines[i]);
    const get = f => (map[f] !== undefined ? String(c[map[f]] || '').trim() : '');
    const inboundNo = get('inboundNo');
    const product = get('product');
    if (!inboundNo || !product) continue;

    let containerNo = get('containerNo');
    if (containerNo && /^\d+$/.test(containerNo)) containerNo = ('0000' + containerNo).slice(-4);

    rows.push({
      lookupKey: containerNo ? (inboundNo + '-' + containerNo) : inboundNo,
      inboundNo: inboundNo, containerNo: containerNo, product: product,
      itemCode: get('itemCode'), manufacturer: get('manufacturer'), supplier: get('supplier'),
      qty: get('qty').replace(/,/g, ''), unit: get('unit') || 'EA',
      expiryDate: normalizeDate(get('expiryDate')) || get('expiryDate')
    });
  }
  return { rows: rows, mapped: Object.keys(map) };
}

function previewImport() {
  const res = parseImportText(document.getElementById('importBox').value);
  const btn = document.getElementById('btnImport');
  if (res.error) {
    setStatus('importStatus', res.error, 'bad');
    btn.classList.add('hidden');
    importRows = [];
    return;
  }
  importRows = res.rows;
  if (!importRows.length) {
    setStatus('importStatus', '읽을 수 있는 줄이 없습니다.', 'bad');
    btn.classList.add('hidden');
    return;
  }
  const sample = importRows[0];
  setStatus('importStatus',
    importRows.length + '줄 확인됨 · 예: ' + sample.lookupKey + ' / ' + sample.product +
    (sample.qty ? (' / ' + sample.qty + sample.unit) : ''), 'ok');
  btn.classList.remove('hidden');
}

async function importFileSelected(event) {
  const file = event.target.files && event.target.files[0];
  if (!file) return;
  event.target.value = '';
  const text = await file.text();
  document.getElementById('importBox').value = text;
  previewImport();
}

async function commitImport() {
  if (!importRows.length) return;
  setStatus('importStatus', importRows.length + '줄 저장 중...', 'warn');
  try {
    const res = await apiPost('importMaster', { rows: importRows });
    if (res.ok) {
      setStatus('importStatus', '완료 · ' + res.count + '줄이 등록되었습니다. 이제 바코드만 찍으면 정보가 자동으로 채워집니다.', 'ok');
      document.getElementById('importBox').value = '';
      document.getElementById('btnImport').classList.add('hidden');
      importRows = [];
    } else {
      setStatus('importStatus', '저장 실패: ' + res.message, 'bad');
    }
  } catch (e) {
    setStatus('importStatus', '저장 실패: ' + e, 'bad');
  }
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
  // 두 라벨 관련 필드를 수정하면 즉시 재대조
  ['product', 'displayQty', 'vProduct', 'vQty'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.addEventListener('input', compareLabels);
  });
}

/* ============ PWA 설치 ============ */

window.addEventListener('DOMContentLoaded', () => { initInspector(); renderLoop(); });

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  });
}
