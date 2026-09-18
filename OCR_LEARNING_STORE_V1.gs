/**
 * OCR Learning Store V1 - Apps Script module
 * IMPORTANT:
 * - This file is NOT the legacy Code.gs replacement.
 * - Add this module to the CURRENT session-authenticated Apps Script backend.
 * - The backend dispatcher must pass the authenticated user object to these functions.
 * - Photos remain in the existing Google Drive folders; this store saves URL references only.
 */

const OCR_LEARNING_LOG_SHEET_V1 = 'OCR_Learning_Log';
const OCR_DATASET_SHEET_V1 = 'OCR_Dataset_Versions';

const OCR_LEARNING_HEADERS_V1 = [
  'ID','CaptureKey','등록일시','Record ID','Source','Template','Dataset Version','Photo URL',
  'OCR Engine','OCR Model','Frontend Version','OCR Raw','OCR JSON','Final JSON','Diff JSON',
  'Compared Fields','Changed Fields','Status','검증일시','검증자','검증메모','등록자'
];

const OCR_DATASET_HEADERS_V1 = [
  'Version','생성일시','Status','승인 Sample 수','설명','생성자'
];

function ocrLearningSsV1_() {
  if (typeof getSs_ === 'function') return getSs_();
  const id = PropertiesService.getScriptProperties().getProperty('SPREADSHEET_ID');
  if (!id) throw new Error('SPREADSHEET_ID가 없습니다.');
  return SpreadsheetApp.openById(id);
}

function ocrEnsureSheetV1_(ss, name, headers) {
  let sh = ss.getSheetByName(name);
  if (!sh) sh = ss.insertSheet(name);
  if (sh.getLastRow() === 0) {
    sh.getRange(1, 1, 1, headers.length).setValues([headers]);
    sh.setFrozenRows(1);
  } else {
    const cur = sh.getRange(1, 1, 1, Math.max(headers.length, sh.getLastColumn())).getValues()[0];
    let diff = false;
    for (let i = 0; i < headers.length; i++) if (String(cur[i] || '') !== headers[i]) { diff = true; break; }
    if (diff) {
      sh.getRange(1, 1, 1, headers.length).setValues([headers]);
      sh.setFrozenRows(1);
    }
  }
  return sh;
}

function ocrActorLabelV1_(actor) {
  if (!actor) return '';
  const name = String(actor.name || '').trim();
  const emp = String(actor.employeeNo || '').trim();
  return name && emp ? name + ' (' + emp + ')' : (name || emp);
}

function ocrAssertAdminV1_(actor) {
  if (!actor || String(actor.role || '').toLowerCase() !== 'admin') {
    throw new Error('관리자 권한이 필요합니다.');
  }
}

function setupOcrLearningStoreV1_() {
  const ss = ocrLearningSsV1_();
  ocrEnsureSheetV1_(ss, OCR_LEARNING_LOG_SHEET_V1, OCR_LEARNING_HEADERS_V1);
  const ds = ocrEnsureSheetV1_(ss, OCR_DATASET_SHEET_V1, OCR_DATASET_HEADERS_V1);
  if (ds.getLastRow() === 1) {
    ds.appendRow(['OCR-DS-V1', new Date(), 'ACTIVE', 0, 'Seed Dataset V1 이후 현장 Learning Log 누적', 'SYSTEM']);
  }
  return { ok: true, version: 'OCR-LEARNING-STORE-V1' };
}

function ocrDatasetRowsV1_() {
  const ss = ocrLearningSsV1_();
  const sh = ocrEnsureSheetV1_(ss, OCR_DATASET_SHEET_V1, OCR_DATASET_HEADERS_V1);
  return sh.getDataRange().getValues();
}

function ocrActiveDatasetV1_() {
  const rows = ocrDatasetRowsV1_();
  for (let i = rows.length - 1; i >= 1; i--) {
    if (String(rows[i][2] || '').toUpperCase() === 'ACTIVE') return String(rows[i][0] || '');
  }
  return 'OCR-DS-V1';
}

function ocrResolvePhotoV1_(recordId, source) {
  if (!recordId) return '';
  try {
    const ss = ocrLearningSsV1_();
    const sh = ss.getSheetByName('Records');
    if (!sh || sh.getLastRow() < 2) return '';
    const data = sh.getDataRange().getValues();
    const h = data[0].map(String);
    const idCol = h.indexOf('ID');
    const wmsCol = h.indexOf('라벨사진URL');
    const vendorCol = h.indexOf('업체라벨사진URL');
    if (idCol < 0) return '';
    for (let i = data.length - 1; i >= 1; i--) {
      if (String(data[i][idCol] || '') !== String(recordId)) continue;
      if (/vendor/i.test(String(source || '')) && vendorCol >= 0) return String(data[i][vendorCol] || '');
      if (wmsCol >= 0) return String(data[i][wmsCol] || '');
      return '';
    }
  } catch (_) {}
  return '';
}

function ocrFindCaptureV1_(sheet, captureKey) {
  if (!captureKey || sheet.getLastRow() < 2) return 0;
  const vals = sheet.getRange(2, 2, sheet.getLastRow() - 1, 1).getValues();
  for (let i = vals.length - 1; i >= 0; i--) if (String(vals[i][0] || '') === String(captureKey)) return i + 2;
  return 0;
}

function saveOcrLearningV1_(payload, actor) {
  setupOcrLearningStoreV1_();
  const e = (payload && payload.entry) || payload || {};
  if (!e.captureKey) throw new Error('captureKey가 없습니다.');
  if (!e.ocrRaw) throw new Error('OCR 원문이 없습니다.');

  const ss = ocrLearningSsV1_();
  const sh = ss.getSheetByName(OCR_LEARNING_LOG_SHEET_V1);
  const existing = ocrFindCaptureV1_(sh, e.captureKey);
  if (existing) {
    return { ok: true, duplicate: true, id: String(sh.getRange(existing, 1).getValue() || '') };
  }

  const id = Utilities.getUuid();
  const version = String(e.datasetVersion || '') || ocrActiveDatasetV1_();
  const photo = String(e.photoUrl || '') || ocrResolvePhotoV1_(e.recordId, e.source);
  sh.appendRow([
    id, String(e.captureKey || ''), e.capturedAt ? new Date(e.capturedAt) : new Date(),
    String(e.recordId || ''), String(e.source || ''), String(e.template || ''), version, photo,
    String(e.ocrEngine || ''), String(e.ocrModel || ''), String(e.frontendVersion || ''),
    String(e.ocrRaw || ''), JSON.stringify(e.ocr || {}), JSON.stringify(e.final || {}), JSON.stringify(e.diff || {}),
    Number(e.comparedFields || 0), Number(e.changedFields || 0), 'PENDING', '', '', '', ocrActorLabelV1_(actor)
  ]);
  return { ok: true, id: id, datasetVersion: version, photoUrl: photo };
}

function ocrLearningInfoV1_() {
  setupOcrLearningStoreV1_();
  const sh = ocrLearningSsV1_().getSheetByName(OCR_LEARNING_LOG_SHEET_V1);
  const rows = sh.getDataRange().getValues();
  let approved = 0, pending = 0, rejected = 0;
  for (let i = 1; i < rows.length; i++) {
    const s = String(rows[i][17] || '').toUpperCase();
    if (s === 'APPROVED') approved++;
    else if (s === 'REJECTED') rejected++;
    else pending++;
  }
  return { ok: true, version: 'OCR-LEARNING-STORE-V1', total: Math.max(0, rows.length - 1), approved, pending, rejected, activeDataset: ocrActiveDatasetV1_() };
}

function listOcrLearningV1_(params, actor) {
  ocrAssertAdminV1_(actor);
  setupOcrLearningStoreV1_();
  params = params || {};
  const status = String(params.status || '').toUpperCase();
  const source = String(params.source || '');
  const version = String(params.datasetVersion || '');
  const limit = Math.max(1, Math.min(200, Number(params.limit || 100)));
  const sh = ocrLearningSsV1_().getSheetByName(OCR_LEARNING_LOG_SHEET_V1);
  const rows = sh.getDataRange().getValues();
  const out = [];
  for (let i = rows.length - 1; i >= 1 && out.length < limit; i--) {
    const r = rows[i];
    if (status && String(r[17] || '').toUpperCase() !== status) continue;
    if (source && String(r[4] || '') !== source) continue;
    if (version && String(r[6] || '') !== version) continue;
    out.push({
      id:String(r[0]||''), captureKey:String(r[1]||''), capturedAt:r[2], recordId:String(r[3]||''),
      source:String(r[4]||''), template:String(r[5]||''), datasetVersion:String(r[6]||''), photoUrl:String(r[7]||''),
      ocrEngine:String(r[8]||''), ocrModel:String(r[9]||''), frontendVersion:String(r[10]||''), ocrRaw:String(r[11]||''),
      ocr:ocrJsonV1_(r[12]), final:ocrJsonV1_(r[13]), diff:ocrJsonV1_(r[14]),
      comparedFields:Number(r[15]||0), changedFields:Number(r[16]||0), status:String(r[17]||''),
      verifiedAt:r[18], verifiedBy:String(r[19]||''), verifyNote:String(r[20]||''), capturedBy:String(r[21]||'')
    });
  }
  return { ok: true, items: out };
}

function ocrJsonV1_(v) {
  try { return JSON.parse(String(v || '{}')); } catch (_) { return {}; }
}

function verifyOcrLearningV1_(payload, actor) {
  ocrAssertAdminV1_(actor);
  payload = payload || {};
  const id = String(payload.id || '');
  const status = String(payload.status || '').toUpperCase();
  if (!id) throw new Error('Learning ID가 없습니다.');
  if (['APPROVED','REJECTED'].indexOf(status) < 0) throw new Error('검증 상태가 올바르지 않습니다.');

  const sh = ocrLearningSsV1_().getSheetByName(OCR_LEARNING_LOG_SHEET_V1);
  const ids = sh.getRange(2, 1, Math.max(0, sh.getLastRow() - 1), 1).getValues();
  let row = 0;
  for (let i = ids.length - 1; i >= 0; i--) if (String(ids[i][0] || '') === id) { row = i + 2; break; }
  if (!row) throw new Error('Learning Log를 찾지 못했습니다.');

  sh.getRange(row, 18, 1, 4).setValues([[status, new Date(), ocrActorLabelV1_(actor), String(payload.note || '')]]);
  ocrRefreshDatasetCountV1_();
  return { ok: true, id, status };
}

function listOcrDatasetVersionsV1_(actor) {
  ocrAssertAdminV1_(actor);
  const rows = ocrDatasetRowsV1_();
  return { ok: true, items: rows.slice(1).reverse().map(r => ({
    version:String(r[0]||''), createdAt:r[1], status:String(r[2]||''), approvedSamples:Number(r[3]||0), note:String(r[4]||''), createdBy:String(r[5]||'')
  })) };
}

function createOcrDatasetVersionV1_(payload, actor) {
  ocrAssertAdminV1_(actor);
  payload = payload || {};
  const version = String(payload.version || '').trim();
  if (!/^OCR-DS-[A-Za-z0-9._-]+$/.test(version)) throw new Error('Dataset 버전명은 OCR-DS- 형식으로 입력하세요.');
  const ss = ocrLearningSsV1_();
  const sh = ocrEnsureSheetV1_(ss, OCR_DATASET_SHEET_V1, OCR_DATASET_HEADERS_V1);
  const rows = sh.getDataRange().getValues();
  for (let i = 1; i < rows.length; i++) if (String(rows[i][0] || '') === version) throw new Error('이미 존재하는 Dataset 버전입니다.');
  if (payload.activate !== false && sh.getLastRow() >= 2) {
    const vals = sh.getRange(2, 3, sh.getLastRow() - 1, 1).getValues().map(r => [String(r[0] || '').toUpperCase() === 'ACTIVE' ? 'FROZEN' : r[0]]);
    sh.getRange(2, 3, vals.length, 1).setValues(vals);
  }
  sh.appendRow([version, new Date(), payload.activate === false ? 'FROZEN' : 'ACTIVE', 0, String(payload.note || ''), ocrActorLabelV1_(actor)]);
  return { ok: true, version, status: payload.activate === false ? 'FROZEN' : 'ACTIVE' };
}

function ocrRefreshDatasetCountV1_() {
  const ss = ocrLearningSsV1_();
  const log = ocrEnsureSheetV1_(ss, OCR_LEARNING_LOG_SHEET_V1, OCR_LEARNING_HEADERS_V1).getDataRange().getValues();
  const counts = {};
  for (let i = 1; i < log.length; i++) if (String(log[i][17] || '').toUpperCase() === 'APPROVED') {
    const v = String(log[i][6] || ''); counts[v] = (counts[v] || 0) + 1;
  }
  const ds = ocrEnsureSheetV1_(ss, OCR_DATASET_SHEET_V1, OCR_DATASET_HEADERS_V1);
  if (ds.getLastRow() < 2) return;
  const vers = ds.getRange(2, 1, ds.getLastRow() - 1, 1).getValues();
  ds.getRange(2, 4, vers.length, 1).setValues(vers.map(r => [counts[String(r[0] || '')] || 0]));
}

function exportOcrDatasetManifestV1_(params, actor) {
  ocrAssertAdminV1_(actor);
  params = params || {};
  const version = String(params.datasetVersion || ocrActiveDatasetV1_());
  const all = listOcrLearningV1_({ status:'APPROVED', datasetVersion:version, limit:200 }, actor);
  return { ok:true, datasetVersion:version, count:all.items.length, items:all.items.map(x => ({
    id:x.id, source:x.source, template:x.template, photoUrl:x.photoUrl, ocrRaw:x.ocrRaw, ocr:x.ocr, final:x.final, diff:x.diff
  })) };
}
