/**
 * 공병 입고 확인 — 백엔드 (API 전용)
 * 화면(프론트엔드)은 GitHub Pages에서 서빙하고,
 * 이 스크립트는 Google Sheets/Drive 저장·조회만 담당합니다.
 */

const DB_NAME = '공병_입고확인_DB_V11';
const PHOTO_FOLDER_NAME = '공병_입고라벨_사진_V11';

// [LEGACY V11] 공개 저장소에 인증값을 하드코딩하지 않습니다.
// 이 파일을 별도 테스트 배포할 경우 Script Properties의 LEGACY_API_TOKEN을 설정해야 합니다.
// 현재 운영 세션 인증 백엔드와는 별개의 구버전 소스이므로 운영본에 덮어쓰지 마세요.
const API_TOKEN = PropertiesService.getScriptProperties().getProperty('LEGACY_API_TOKEN') || '';

const RECORD_HEADERS = [
  'ID','등록일시','모드','입고번호','입고일자','품명','품목코드','제조원','공급업체',
  '표시수량','단위','사용기한','용기번호시작','용기번호종료','대표코드',
  '입고정보','혼입여부','실제확인수량','수량판정',
  '파레트수','총수량','이종수','최종결과','특이사항','검수자','라벨사진URL','실물사진URL','OCR원문',
  '라벨대조','업체라벨품명','업체라벨수량','업체생산일자','업체생산시간','업체Lot번호','업체생산라인','업체라벨사진URL','업체OCR원문'
];

const PALLET_HEADERS = [
  'Record ID','순번','Barcode/QR','입고번호','용기번호','품목코드','품명','공급업체','수량','단위','판정',
  'WMS라벨사진URL','업체라벨사진URL','업체라벨품명','대조결과','스캔시각','비고'
];

const MASTER_HEADERS = [
  'Lookup Key','입고번호','용기번호','품명','품목코드','제조원','공급업체','수량','단위','사용기한'
];

const PRODUCTION_HEADERS = [
  'ID','등록일시','제품명','제조번호','생산일자','생산수량','투입파레트수','투입총수량',
  '투입파레트요약','비고','등록자'
];

// 제조번호 ↔ 투입 파레트를 1:N으로 남겨 역추적이 가능하게 한다
const PRODUCTION_PALLET_HEADERS = [
  'Production ID','제품명','제조번호','순번','입고번호','용기번호','Barcode/QR','품명','품목코드','수량','단위','검수결과','검수기록ID'
];

/* ---------------- 최초 설정 ---------------- */

function setupSystem() {
  const props = PropertiesService.getScriptProperties();

  let ss;
  let id = props.getProperty('SPREADSHEET_ID');
  if (!id) {
    ss = SpreadsheetApp.create(DB_NAME);
    id = ss.getId();
    props.setProperty('SPREADSHEET_ID', id);
  } else {
    ss = SpreadsheetApp.openById(id);
  }

  ensureSheet_(ss, 'Records', RECORD_HEADERS);
  ensureSheet_(ss, 'PalletDetails', PALLET_HEADERS);
  ensureSheet_(ss, 'Master', MASTER_HEADERS);
  ensureSheet_(ss, 'Production', PRODUCTION_HEADERS);
  ensureSheet_(ss, 'ProductionPallets', PRODUCTION_PALLET_HEADERS);
  ensureSheet_(ss, 'Audit', ['일시','작업','Record ID','상세']);

  let folderId = props.getProperty('PHOTO_FOLDER_ID');
  if (!folderId) {
    const folder = DriveApp.createFolder(PHOTO_FOLDER_NAME);
    folderId = folder.getId();
    props.setProperty('PHOTO_FOLDER_ID', folderId);
  }

  const master = ss.getSheetByName('Master');
  if (master.getLastRow() === 1) {
    master.getRange(2, 1, 3, MASTER_HEADERS.length).setValues([
      ['26003973-0033', '26003973', '0033', '100ML 유리병(각병)', '2002867', '동화지앤피', '동화지앤피(주)', '9072', 'EA', '2031-08-31'],
      ['26003973-0034', '26003973', '0034', '100ML 유리병(각병)', '2002867', '동화지앤피', '동화지앤피(주)', '9072', 'EA', '2031-08-31'],
      ['26003973-0035', '26003973', '0035', '100ML 유리병(각병)', '2002867', '동화지앤피', '동화지앤피(주)', '9072', 'EA', '2031-08-31']
    ]);
  }

  return {
    ok: true,
    spreadsheetUrl: ss.getUrl(),
    folderUrl: 'https://drive.google.com/drive/folders/' + folderId
  };
}

function ensureSheet_(ss, name, headers) {
  let sheet = ss.getSheetByName(name);
  if (!sheet) {
    sheet = ss.insertSheet(name);
  }
  if (sheet.getLastRow() === 0) {
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
    sheet.setFrozenRows(1);
  } else {
    // 헤더 이름이나 개수가 바뀐 경우(예: 용어 변경, 컬럼 추가) 1행을 최신으로 맞춘다.
    const width = Math.max(sheet.getLastColumn(), headers.length);
    const current = sheet.getRange(1, 1, 1, width).getValues()[0];
    let needsUpdate = false;
    for (let i = 0; i < headers.length; i++) {
      if (String(current[i] || '') !== headers[i]) { needsUpdate = true; break; }
    }
    if (needsUpdate) {
      sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
      sheet.setFrozenRows(1);
    }
  }
  return sheet;
}

function getSs_() {
  const id = PropertiesService.getScriptProperties().getProperty('SPREADSHEET_ID');
  if (!id) throw new Error('시스템이 아직 설정되지 않았습니다. setupSystem을 먼저 실행하세요.');
  return SpreadsheetApp.openById(id);
}

function getPhotoFolder_() {
  const id = PropertiesService.getScriptProperties().getProperty('PHOTO_FOLDER_ID');
  if (!id) throw new Error('사진 폴더가 아직 설정되지 않았습니다. setupSystem을 먼저 실행하세요.');
  return DriveApp.getFolderById(id);
}

/* ---------------- HTTP 진입점 ---------------- */

function doGet(e) {
  const action = (e && e.parameter && e.parameter.action) || 'status';
  if (!checkToken_(e && e.parameter && e.parameter.token)) {
    return jsonOut_({ ok: false, message: '인증 실패 (토큰 불일치)' });
  }
  try {
    if (action === 'status') {
      const ss = getSs_();
      return jsonOut_({ ok: true, spreadsheetUrl: ss.getUrl() });
    }
    if (action === 'lookup') {
      return jsonOut_(lookupMaster_(e.parameter.key || ''));
    }
    if (action === 'searchRecords') {
      return jsonOut_(searchRecords_(e.parameter.keyword || ''));
    }
    if (action === 'getRecord') {
      return jsonOut_(getRecord_(e.parameter.id || ''));
    }
    if (action === 'searchPallets') {
      return jsonOut_(searchPallets_(e.parameter.keyword || ''));
    }
    if (action === 'dashboard') {
      return jsonOut_(getDashboard_());
    }
    if (action === 'trace') {
      return jsonOut_(trace_(e.parameter.keyword || ''));
    }
    if (action === 'recentProducts') {
      return jsonOut_(recentProducts_());
    }
    return jsonOut_({ ok: false, message: '알 수 없는 action: ' + action });
  } catch (err) {
    return jsonOut_({ ok: false, message: String(err.message || err) });
  }
}

function doPost(e) {
  try {
    if (!e || !e.postData || !e.postData.contents) {
      return jsonOut_({ ok: false, message: '요청 본문이 없습니다.' });
    }
    const body = JSON.parse(e.postData.contents);
    if (!checkToken_(body.token)) {
      return jsonOut_({ ok: false, message: '인증 실패 (토큰 불일치)' });
    }
    const action = body.action;

    if (action === 'saveSingle') {
      return jsonOut_(saveSingleRecord_(body.payload || {}));
    }
    if (action === 'saveMulti') {
      return jsonOut_(saveMultiRecord_(body.payload || {}));
    }
    if (action === 'saveProduction') {
      return jsonOut_(saveProduction_(body.payload || {}));
    }
    if (action === 'startProduction') {
      return jsonOut_(startProduction_(body.payload || {}));
    }
    if (action === 'addProductionPallet') {
      return jsonOut_(addProductionPallet_(body.payload || {}));
    }
    if (action === 'finishProduction') {
      return jsonOut_(finishProduction_(body.payload || {}));
    }
    if (action === 'ocr') {
      return jsonOut_(ocrImage_((body.payload || {}).image));
    }
    if (action === 'uploadPhoto') {
      const pl = body.payload || {};
      const url = savePhoto_(pl.image, pl.name || ('photo_' + Date.now()));
      return jsonOut_({ ok: !!url, url: url });
    }
    if (action === 'importMaster') {
      return jsonOut_(importMaster_((body.payload || {}).rows || []));
    }
    return jsonOut_({ ok: false, message: '알 수 없는 action: ' + action });
  } catch (err) {
    return jsonOut_({ ok: false, message: String(err.message || err) });
  }
}

function checkToken_(token) {
  return String(token || '') === API_TOKEN;
}

/* ---------------- 공병 입고건 검색 (생산 등록 연결용) ---------------- */

function searchRecords_(keyword) {
  const kw = String(keyword || '').trim().toLowerCase();
  if (!kw) return { ok: false, message: '검색어가 없습니다.' };

  const ss = getSs_();
  const sheet = ss.getSheetByName('Records');
  const data = sheet.getDataRange().getValues();
  const idx = {};
  RECORD_HEADERS.forEach((h, i) => idx[h] = i);

  const items = [];
  for (let i = data.length - 1; i >= 1; i--) {
    const row = data[i];
    const haystack = [row[idx['입고번호']], row[idx['품명']], row[idx['품목코드']], row[idx['공급업체']]]
      .join(' ').toLowerCase();
    if (haystack.indexOf(kw) === -1) continue;

    const qty = row[idx['표시수량']] || row[idx['총수량']] || '';
    items.push({
      id: row[idx['ID']],
      regDate: Utilities.formatDate(new Date(row[idx['등록일시']]), 'Asia/Seoul', 'yyyy-MM-dd HH:mm'),
      mode: row[idx['모드']],
      inboundNo: row[idx['입고번호']],
      product: row[idx['품명']],
      itemCode: row[idx['품목코드']],
      qty: qty,
      unit: row[idx['단위']]
    });
    if (items.length >= 25) break;
  }
  return { ok: true, items: items };
}

function getRecord_(id) {
  if (!id) return { ok: false, message: 'id가 없습니다.' };
  const ss = getSs_();
  const sheet = ss.getSheetByName('Records');
  const data = sheet.getDataRange().getValues();
  const idx = {};
  RECORD_HEADERS.forEach((h, i) => idx[h] = i);

  let row = null;
  for (let i = 1; i < data.length; i++) {
    if (String(data[i][idx['ID']]) === String(id)) { row = data[i]; break; }
  }
  if (!row) return { ok: false, message: '기록을 찾을 수 없습니다.' };

  const record = {
    id: row[idx['ID']],
    regDate: Utilities.formatDate(new Date(row[idx['등록일시']]), 'Asia/Seoul', 'yyyy-MM-dd HH:mm'),
    mode: row[idx['모드']],
    inboundNo: row[idx['입고번호']], inboundDate: row[idx['입고일자']],
    product: row[idx['품명']], itemCode: row[idx['품목코드']],
    manufacturer: row[idx['제조원']], supplier: row[idx['공급업체']],
    displayQty: row[idx['표시수량']], unit: row[idx['단위']],
    expiryDate: row[idx['사용기한']], containerFrom: row[idx['용기번호시작']], containerTo: row[idx['용기번호종료']],
    codeRaw: row[idx['대표코드']], infoMatch: row[idx['입고정보']], mixed: row[idx['혼입여부']],
    actualQty: row[idx['실제확인수량']], qtyResult: row[idx['수량판정']],
    palletCount: row[idx['파레트수']], totalQty: row[idx['총수량']], mixedCount: row[idx['이종수']],
    finalResult: row[idx['최종결과']], note: row[idx['특이사항']], inspector: row[idx['검수자']],
    labelPhotoUrl: row[idx['라벨사진URL']], itemPhotoUrl: row[idx['실물사진URL']], ocrRaw: row[idx['OCR원문']],
    labelMatch: row[idx['라벨대조']], vendorProduct: row[idx['업체라벨품명']], vendorQty: row[idx['업체라벨수량']],
    vendorProdDate: row[idx['업체생산일자']], vendorProdTime: row[idx['업체생산시간']],
    vendorLotNo: row[idx['업체Lot번호']], vendorLine: row[idx['업체생산라인']],
    vendorPhotoUrl: row[idx['업체라벨사진URL']]
  };

  let pallets = [];
  if (String(record.mode || '').indexOf('다중') === 0) {
    const psheet = ss.getSheetByName('PalletDetails');
    const pdata = psheet.getDataRange().getValues();
    const pidx = {};
    PALLET_HEADERS.forEach((h, i) => pidx[h] = i);
    for (let i = 1; i < pdata.length; i++) {
      if (String(pdata[i][pidx['Record ID']]) === String(id)) {
        pallets.push({
          seq: pdata[i][pidx['순번']], code: pdata[i][pidx['Barcode/QR']],
          inboundNo: pdata[i][pidx['입고번호']], containerNo: pdata[i][pidx['용기번호']],
          itemCode: pdata[i][pidx['품목코드']], product: pdata[i][pidx['품명']],
          supplier: pdata[i][pidx['공급업체']], qty: pdata[i][pidx['수량']], unit: pdata[i][pidx['단위']],
          result: pdata[i][pidx['판정']]
        });
      }
    }
  }

  return { ok: true, record: record, pallets: pallets };
}

/* ---------------- 서버 OCR (Google Drive 엔진) ---------------- */

function ocrImage_(dataUrl) {
  if (!dataUrl) return { ok: false, message: '이미지가 없습니다.' };
  let tempId = null;
  try {
    const match = String(dataUrl).match(/^data:(image\/\w+);base64,(.*)$/);
    if (!match) return { ok: false, message: '이미지 형식이 올바르지 않습니다.' };
    const blob = Utilities.newBlob(Utilities.base64Decode(match[2]), match[1], 'ocr_temp');

    // 이미지를 OCR로 Google Docs 변환 → 텍스트 추출
    const file = Drive.Files.insert(
      { title: 'ocr_temp_' + Date.now() },
      blob,
      { ocr: true, ocrLanguage: 'ko', convert: true }
    );
    tempId = file.id;
    const text = DocumentApp.openById(tempId).getBody().getText();
    return { ok: true, text: text || '' };
  } catch (err) {
    return { ok: false, message: String(err.message || err) };
  } finally {
    if (tempId) { try { DriveApp.getFileById(tempId).setTrashed(true); } catch (e) {} }
  }
}

/* ---------------- 검수한 파레트 검색 (생산 투입 연결용) ---------------- */

function searchPallets_(keyword) {
  const kw = String(keyword || '').trim().toLowerCase();
  if (!kw) return { ok: false, message: '검색어가 없습니다.' };

  const ss = getSs_();
  const items = [];

  // 1) 다중 파레트 검수 내역
  const psheet = ss.getSheetByName('PalletDetails');
  const pdata = psheet.getDataRange().getValues();
  const pidx = {};
  PALLET_HEADERS.forEach((h, i) => pidx[h] = i);

  for (let i = pdata.length - 1; i >= 1; i--) {
    const row = pdata[i];
    const hay = [row[pidx['입고번호']], row[pidx['용기번호']], row[pidx['품명']],
      row[pidx['품목코드']], row[pidx['Barcode/QR']]].join(' ').toLowerCase();
    if (hay.indexOf(kw) === -1) continue;
    items.push({
      recordId: row[pidx['Record ID']],
      seq: row[pidx['순번']],
      code: row[pidx['Barcode/QR']],
      inboundNo: row[pidx['입고번호']],
      containerNo: row[pidx['용기번호']],
      itemCode: row[pidx['품목코드']],
      product: row[pidx['품명']],
      qty: row[pidx['수량']],
      unit: row[pidx['단위']],
      result: row[pidx['판정']],
      source: '파레트검수'
    });
    if (items.length >= 60) break;
  }

  // 2) 단건 검수 내역 (파레트 1개 취급)
  const rsheet = ss.getSheetByName('Records');
  const rdata = rsheet.getDataRange().getValues();
  const ridx = {};
  RECORD_HEADERS.forEach((h, i) => ridx[h] = i);

  for (let i = rdata.length - 1; i >= 1 && items.length < 80; i--) {
    const row = rdata[i];
    if (String(row[ridx['모드']]) !== '단건') continue;
    const hay = [row[ridx['입고번호']], row[ridx['용기번호시작']], row[ridx['품명']],
      row[ridx['품목코드']], row[ridx['대표코드']]].join(' ').toLowerCase();
    if (hay.indexOf(kw) === -1) continue;
    items.push({
      recordId: row[ridx['ID']],
      seq: 1,
      code: row[ridx['대표코드']],
      inboundNo: row[ridx['입고번호']],
      containerNo: row[ridx['용기번호시작']],
      itemCode: row[ridx['품목코드']],
      product: row[ridx['품명']],
      qty: row[ridx['실제확인수량']] || row[ridx['표시수량']],
      unit: row[ridx['단위']],
      result: row[ridx['최종결과']],
      source: '단건검수'
    });
  }

  return { ok: true, items: items };
}

/* ---------------- 대시보드 / 추적 ---------------- */

function dayStart_(offsetDays) {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - (offsetDays || 0));
  return d;
}

function getDashboard_() {
  const ss = getSs_();
  const today = dayStart_(0);
  const week = dayStart_(6);   // 오늘 포함 7일
  const month = dayStart_(29);

  const out = {
    ok: true,
    today: { records: 0, pallets: 0, qty: 0, issues: 0 },
    week: { records: 0, pallets: 0, qty: 0, issues: 0 },
    month: { records: 0, pallets: 0, qty: 0, issues: 0 },
    recentIssues: [],
    recentLots: [],
    topProducts: []
  };

  // --- 입고 검수 집계 ---
  const rsheet = ss.getSheetByName('Records');
  const rdata = rsheet.getDataRange().getValues();
  const ridx = {};
  RECORD_HEADERS.forEach((h, i) => ridx[h] = i);

  const productQty = {};

  for (let i = 1; i < rdata.length; i++) {
    const row = rdata[i];
    const when = new Date(row[ridx['등록일시']]);
    if (isNaN(when.getTime())) continue;

    const isMulti = String(row[ridx['모드']] || '').indexOf('다중') === 0;
    const pallets = isMulti ? (Number(row[ridx['파레트수']]) || 0) : 1;
    const qty = isMulti
      ? (Number(row[ridx['총수량']]) || 0)
      : (Number(String(row[ridx['실제확인수량']] || row[ridx['표시수량']] || '').replace(/,/g, '')) || 0);
    const issue = (String(row[ridx['최종결과']]) === '확인필요')
      || (Number(row[ridx['이종수']]) > 0)
      || (String(row[ridx['라벨대조']]) === '불일치');

    [['month', month], ['week', week], ['today', today]].forEach(function (pair) {
      if (when >= pair[1]) {
        const b = out[pair[0]];
        b.records++; b.pallets += pallets; b.qty += qty;
        if (issue) b.issues++;
      }
    });

    if (when >= month) {
      const name = String(row[ridx['품명']] || '(미지정)');
      productQty[name] = (productQty[name] || 0) + qty;
    }

    if (issue && out.recentIssues.length < 200) {
      out.recentIssues.push({
        id: row[ridx['ID']],
        date: Utilities.formatDate(when, 'Asia/Seoul', 'MM-dd HH:mm'),
        ts: when.getTime(),
        mode: row[ridx['모드']],
        inboundNo: row[ridx['입고번호']],
        product: row[ridx['품명']],
        supplier: row[ridx['공급업체']],
        reason: [
          Number(row[ridx['이종수']]) > 0 ? ('이종 ' + row[ridx['이종수']] + '건') : '',
          String(row[ridx['라벨대조']]) === '불일치' ? '라벨 불일치' : '',
          String(row[ridx['혼입여부']]) === '있음' ? '혼입' : '',
          String(row[ridx['수량판정']]) === '불일치' ? '수량 불일치' : ''
        ].filter(String).join(', ') || '확인필요',
        inspector: row[ridx['검수자']]
      });
    }
  }

  out.recentIssues.sort(function (a, b) { return b.ts - a.ts; });
  out.recentIssues = out.recentIssues.slice(0, 15);

  out.topProducts = Object.keys(productQty)
    .map(function (k) { return { product: k, qty: productQty[k] }; })
    .sort(function (a, b) { return b.qty - a.qty; })
    .slice(0, 5);

  // --- 생산 로트 집계 ---
  const psheet = ss.getSheetByName('Production');
  if (psheet) {
    const pdata = psheet.getDataRange().getValues();
    const pidx = {};
    PRODUCTION_HEADERS.forEach((h, i) => pidx[h] = i);
    const lots = [];
    for (let i = 1; i < pdata.length; i++) {
      const row = pdata[i];
      const when = new Date(row[pidx['등록일시']]);
      if (isNaN(when.getTime())) continue;
      lots.push({
        ts: when.getTime(),
        date: Utilities.formatDate(when, 'Asia/Seoul', 'MM-dd'),
        productName: row[pidx['제품명']],
        lotNo: row[pidx['제조번호']],
        palletCount: row[pidx['투입파레트수']],
        total: row[pidx['투입총수량']],
        registrant: row[pidx['등록자']]
      });
    }
    lots.sort(function (a, b) { return b.ts - a.ts; });
    out.recentLots = lots.slice(0, 10);
    out.lotCountMonth = lots.filter(function (l) { return l.ts >= month.getTime(); }).length;
  }

  return out;
}

// 제조번호 → 투입 공병, 또는 입고번호/용기번호 → 어느 제품으로 나갔는지 (양방향)
function trace_(keyword) {
  const kw = String(keyword || '').trim().toLowerCase();
  if (!kw) return { ok: false, message: '검색어가 없습니다.' };

  const ss = getSs_();
  const sheet = ss.getSheetByName('ProductionPallets');
  if (!sheet) return { ok: true, byLot: [], byPallet: [] };

  const data = sheet.getDataRange().getValues();
  const idx = {};
  PRODUCTION_PALLET_HEADERS.forEach((h, i) => idx[h] = i);

  const byLot = [];
  const byPallet = [];

  for (let i = 1; i < data.length; i++) {
    const row = data[i];
    const lotHay = [row[idx['제조번호']], row[idx['제품명']]].join(' ').toLowerCase();
    const palHay = [row[idx['입고번호']], row[idx['용기번호']], row[idx['Barcode/QR']], row[idx['품명']]]
      .join(' ').toLowerCase();

    const item = {
      productionId: row[idx['Production ID']],
      productName: row[idx['제품명']],
      lotNo: row[idx['제조번호']],
      inboundNo: row[idx['입고번호']],
      containerNo: row[idx['용기번호']],
      code: row[idx['Barcode/QR']],
      product: row[idx['품명']],
      itemCode: row[idx['품목코드']],
      qty: row[idx['수량']],
      unit: row[idx['단위']],
      result: row[idx['검수결과']],
      recordId: row[idx['검수기록ID']]
    };

    if (lotHay.indexOf(kw) !== -1) byLot.push(item);
    else if (palHay.indexOf(kw) !== -1) byPallet.push(item);
  }

  return { ok: true, byLot: byLot.slice(0, 200), byPallet: byPallet.slice(0, 200) };
}

/* ---------------- 생산 작업 세션 (한 로트에 파레트 연속 투입) ---------------- */

// 최근에 쓴 제품명을 돌려준다 (타이핑 없이 눌러서 고르게 하기 위함)
function recentProducts_() {
  const ss = getSs_();
  const sheet = ss.getSheetByName('Production');
  if (!sheet || sheet.getLastRow() < 2) return { ok: true, products: [], lastLot: '' };

  const data = sheet.getDataRange().getValues();
  const idx = {};
  PRODUCTION_HEADERS.forEach((h, i) => idx[h] = i);

  const seen = {};
  const products = [];
  let lastLot = '';
  for (let i = data.length - 1; i >= 1; i--) {
    const name = String(data[i][idx['제품명']] || '').trim();
    if (!lastLot) lastLot = String(data[i][idx['제조번호']] || '').trim();
    if (name && !seen[name]) { seen[name] = true; products.push(name); }
    if (products.length >= 8) break;
  }
  return { ok: true, products: products, lastLot: lastLot };
}

// 작업 시작: 생산 기록을 먼저 만들어 두고 id를 돌려준다
function startProduction_(p) {
  const ss = getSs_();
  const sheet = ss.getSheetByName('Production');
  const id = Utilities.getUuid();
  sheet.appendRow([
    id, new Date(), p.productName || '', p.lotNo || '', p.prodDate || '', p.prodQty || '',
    0, 0, '', p.note || '', p.registrant || ''
  ]);
  return { ok: true, id: id };
}

function findProductionRow_(sheet, id) {
  const data = sheet.getDataRange().getValues();
  for (let i = 1; i < data.length; i++) {
    if (String(data[i][0]) === String(id)) return i + 1;
  }
  return 0;
}

// 파레트 1개를 즉시 추가하고 합계를 갱신 (스캔할 때마다 호출)
function addProductionPallet_(p) {
  if (!p.productionId) return { ok: false, message: '작업 ID가 없습니다.' };
  const ss = getSs_();
  const psheet = ss.getSheetByName('ProductionPallets');
  const prod = ss.getSheetByName('Production');
  const row = findProductionRow_(prod, p.productionId);
  if (!row) return { ok: false, message: '작업 기록을 찾을 수 없습니다.' };

  const idx = {};
  PRODUCTION_HEADERS.forEach((h, i) => idx[h] = i);
  const cur = prod.getRange(row, 1, 1, PRODUCTION_HEADERS.length).getValues()[0];

  // 같은 작업에 이미 등록된 파레트인지 확인
  const pdata = psheet.getDataRange().getValues();
  const pidx = {};
  PRODUCTION_PALLET_HEADERS.forEach((h, i) => pidx[h] = i);
  for (let i = 1; i < pdata.length; i++) {
    if (String(pdata[i][pidx['Production ID']]) === String(p.productionId)
      && String(pdata[i][pidx['입고번호']]) === String(p.inboundNo || '')
      && String(pdata[i][pidx['용기번호']]) === String(p.containerNo || '')) {
      return { ok: false, duplicate: true, message: '이미 등록된 파레트입니다.' };
    }
  }

  const seq = (Number(cur[idx['투입파레트수']]) || 0) + 1;
  const qty = Number(String(p.qty || '').replace(/,/g, '')) || 0;
  const total = (Number(cur[idx['투입총수량']]) || 0) + qty;
  const summary = String(cur[idx['투입파레트요약']] || '');
  const tag = (p.inboundNo || '') + '-' + (p.containerNo || '');

  psheet.appendRow([
    p.productionId, cur[idx['제품명']], cur[idx['제조번호']], seq,
    p.inboundNo || '', p.containerNo || '', p.code || '', p.product || '',
    p.itemCode || '', p.qty || '', p.unit || '', p.result || '', p.recordId || ''
  ]);

  prod.getRange(row, idx['투입파레트수'] + 1).setValue(seq);
  prod.getRange(row, idx['투입총수량'] + 1).setValue(total);
  prod.getRange(row, idx['투입파레트요약'] + 1).setValue(summary ? (summary + ', ' + tag) : tag);

  return { ok: true, seq: seq, total: total };
}

function finishProduction_(p) {
  if (!p.productionId) return { ok: false, message: '작업 ID가 없습니다.' };
  const ss = getSs_();
  const prod = ss.getSheetByName('Production');
  const row = findProductionRow_(prod, p.productionId);
  if (!row) return { ok: false, message: '작업 기록을 찾을 수 없습니다.' };

  const idx = {};
  PRODUCTION_HEADERS.forEach((h, i) => idx[h] = i);
  if (p.note) prod.getRange(row, idx['비고'] + 1).setValue(p.note);
  if (p.prodQty) prod.getRange(row, idx['생산수량'] + 1).setValue(p.prodQty);
  if (p.prodDate) prod.getRange(row, idx['생산일자'] + 1).setValue(p.prodDate);

  const cur = prod.getRange(row, 1, 1, PRODUCTION_HEADERS.length).getValues()[0];
  return { ok: true, palletCount: cur[idx['투입파레트수']], total: cur[idx['투입총수량']] };
}

/* ---------------- 입고 예정 목록 등록 ---------------- */

function importMaster_(rows) {
  if (!rows || !rows.length) return { ok: false, message: '등록할 줄이 없습니다.' };

  const ss = getSs_();
  const sheet = ss.getSheetByName('Master');
  const existing = sheet.getDataRange().getValues();

  // Lookup Key 기준으로 기존 줄을 갱신하고, 없으면 새로 추가 (기존 목록을 지우지 않음)
  const keyToRow = {};
  for (let i = 1; i < existing.length; i++) {
    const k = String(existing[i][0] || '').trim();
    if (k) keyToRow[k] = i + 1;
  }

  const appends = [];
  let updated = 0;
  rows.forEach(function (r) {
    const values = [
      r.lookupKey || '', r.inboundNo || '', r.containerNo || '', r.product || '',
      r.itemCode || '', r.manufacturer || '', r.supplier || '', r.qty || '',
      r.unit || 'EA', r.expiryDate || ''
    ];
    const key = String(r.lookupKey || '').trim();
    if (key && keyToRow[key]) {
      sheet.getRange(keyToRow[key], 1, 1, MASTER_HEADERS.length).setValues([values]);
      updated++;
    } else {
      appends.push(values);
    }
  });

  if (appends.length) {
    sheet.getRange(sheet.getLastRow() + 1, 1, appends.length, MASTER_HEADERS.length).setValues(appends);
  }

  return { ok: true, count: rows.length, added: appends.length, updated: updated };
}

/* ---------------- 생산 등록 ---------------- */

function saveProduction_(p) {
  const ss = getSs_();
  const sheet = ss.getSheetByName('Production');
  const id = Utilities.getUuid();

  const pallets = p.pallets || [];
  let total = 0;
  pallets.forEach(function (x) { total += Number(String(x.qty || '').replace(/,/g, '')) || 0; });
  const summary = pallets.map(function (x) {
    return (x.inboundNo || '') + '-' + (x.containerNo || '');
  }).join(', ');

  sheet.appendRow([
    id, new Date(), p.productName || '', p.lotNo || '', p.prodDate || '', p.prodQty || '',
    pallets.length, total, summary, p.note || '', p.registrant || ''
  ]);

  if (pallets.length) {
    const psheet = ss.getSheetByName('ProductionPallets');
    const rows = pallets.map(function (x, i) {
      return [id, p.productName || '', p.lotNo || '', i + 1,
        x.inboundNo || '', x.containerNo || '', x.code || '', x.product || '',
        x.itemCode || '', x.qty || '', x.unit || '', x.result || '', x.recordId || ''];
    });
    psheet.getRange(psheet.getLastRow() + 1, 1, rows.length, PRODUCTION_PALLET_HEADERS.length).setValues(rows);
  }

  return { ok: true, id: id, palletCount: pallets.length, total: total };
}

function jsonOut_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

/* ---------------- Master 조회 ---------------- */

function lookupMaster_(key) {
  if (!key) return { ok: false, message: 'key가 없습니다.' };
  const ss = getSs_();
  const sheet = ss.getSheetByName('Master');
  const data = sheet.getDataRange().getValues();
  for (let i = 1; i < data.length; i++) {
    if (String(data[i][0]).trim() === String(key).trim()) {
      const row = data[i];
      return {
        ok: true,
        found: true,
        data: {
          lookupKey: row[0], inboundNo: row[1], containerNo: row[2], product: row[3],
          itemCode: row[4], manufacturer: row[5], supplier: row[6],
          qty: row[7], unit: row[8], expiryDate: row[9]
        }
      };
    }
  }
  return { ok: true, found: false };
}

/* ---------------- 저장 ---------------- */

function savePhoto_(dataUrl, idPrefix) {
  if (!dataUrl) return '';
  try {
    const match = String(dataUrl).match(/^data:(image\/\w+);base64,(.*)$/);
    if (!match) return '';
    const contentType = match[1];
    const base64 = match[2];
    const bytes = Utilities.base64Decode(base64);
    const ext = contentType.split('/')[1] || 'jpg';
    const blob = Utilities.newBlob(bytes, contentType, idPrefix + '.' + ext);
    const file = getPhotoFolder_().createFile(blob);
    return file.getUrl();
  } catch (err) {
    return '';
  }
}

function saveItemPhotos_(photos, idPrefix) {
  if (!photos || !photos.length) return '';
  const urls = [];
  photos.forEach((dataUrl, i) => {
    const url = savePhoto_(dataUrl, idPrefix + '_실물' + (i + 1));
    if (url) urls.push(url);
  });
  return urls.join(', ');
}

function saveSingleRecord_(p) {
  const ss = getSs_();
  const sheet = ss.getSheetByName('Records');
  const id = Utilities.getUuid();
  const photoUrl = savePhoto_(p.photo, id + '_라벨');
  const itemPhotoUrls = saveItemPhotos_(p.itemPhotos, id);

  const vendorPhotoUrl = savePhoto_(p.vendorPhoto, id + '_업체라벨');

  sheet.appendRow([
    id, new Date(), '단건',
    p.inboundNo || '', p.inboundDate || '', p.product || '', p.itemCode || '',
    p.manufacturer || '', p.supplier || '', p.displayQty || '', p.unit || '',
    p.expiryDate || '', p.containerFrom || '', p.containerTo || '', p.codeRaw || '',
    p.infoMatch || '', p.mixed || '', p.actualQty || '', p.qtyResult || '',
    '', '', '', p.finalResult || '', p.note || '', p.inspector || '',
    photoUrl, itemPhotoUrls, p.ocrRaw || '',
    p.labelMatch || '', p.vendorProduct || '', p.vendorQty || '',
    p.vendorProdDate || '', p.vendorProdTime || '', p.vendorLotNo || '', p.vendorLine || '',
    vendorPhotoUrl, p.vendorOcrRaw || ''
  ]);

  return { ok: true, id: id, photoUrl: photoUrl, itemPhotoUrls: itemPhotoUrls };
}

function saveMultiRecord_(p) {
  const ss = getSs_();
  const recSheet = ss.getSheetByName('Records');
  const palletSheet = ss.getSheetByName('PalletDetails');
  const id = Utilities.getUuid();
  const photoUrl = savePhoto_(p.photo, id + '_라벨');
  const itemPhotoUrls = saveItemPhotos_(p.itemPhotos, id);

  const pallets = p.pallets || [];
  let total = 0;
  let mixedCount = 0;
  pallets.forEach(function (pl) {
    total += Number(pl.qty) || 0;
    if (pl.mismatch) mixedCount++;
  });

  recSheet.appendRow([
    id, new Date(), '다중파레트',
    p.inboundNo || '', p.inboundDate || '', p.product || '', p.itemCode || '',
    p.manufacturer || '', p.supplier || '', p.displayQty || '', p.unit || '',
    p.expiryDate || '', '', '', '',
    '', mixedCount > 0 ? '있음' : '없음', '', '',
    pallets.length, total, mixedCount, p.finalResult || '', p.note || '', p.inspector || '',
    photoUrl, itemPhotoUrls, p.ocrRaw || '',
    '', '', '', '', '', '', '', '', ''
  ]);

  if (pallets.length > 0) {
    const rows = pallets.map(function (pl, i) {
      return [id, i + 1, pl.code || '', pl.inboundNo || '', pl.containerNo || '',
        pl.itemCode || '', pl.product || '', pl.supplier || '', pl.qty || '', pl.unit || '',
        pl.mismatch ? '이종' : '정상',
        pl.wmsPhotoUrl || '', pl.vendorPhotoUrl || '', pl.vendorProduct || '',
        pl.matchResult || '', pl.scanTime || '', pl.note || ''];
    });
    palletSheet.getRange(palletSheet.getLastRow() + 1, 1, rows.length, PALLET_HEADERS.length).setValues(rows);
  }

  return { ok: true, id: id, total: total, mixedCount: mixedCount, photoUrl: photoUrl, itemPhotoUrls: itemPhotoUrls };
}
