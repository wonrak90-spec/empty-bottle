/**
 * R15 2026-10-20 (SAFE 2026-10-15 기반, 기존 화면과 함께 동작)
 * - 사진 저장 실패를 성공으로 처리하지 않음 (기존: 사진 없이 기록만 저장)
 * - Master 가져오기·업체 품명 별칭 등록은 관리자 전용
 * - 새 화면(v2)은 입고번호·Pallet 번호·WMS 사진이 없으면 저장 거부
 * - 보고서·가용재고·양방향 추적·생산 투입 API 추가 (파일 맨 아래 R15 구역)
 */
/**
 * SAFE REVIEW PATCH 2026-10-15
 * - 저장속도 최적화 유지
 * - r12 SaveTiming 호환 복원
 * - requestId 검색 3000행 제한 제거(오래된 Queue 재전송 안전성 유지)
 * - 벤치마크 임시 request cache 정리 수정
 */
/**
 * V58 운영 통합본 — 실제 2026-10-02 운영 백업(V22.7) 기반
 * 기존 사번+PIN/세션/권한/Audit/생산연계 기능 보존
 *
 * 공병 입고 확인 — 백엔드 (API 전용)
 * 화면(프론트엔드)은 GitHub Pages에서 서빙하고,
 * 이 스크립트는 Google Sheets/Drive 저장·조회만 담당합니다.
 */

const DB_NAME = '공병_입고확인_DB_V11';
const PHOTO_FOLDER_NAME = '공병_입고라벨_사진_V11';

const BACKEND_VERSION = 'R15-20261020';
const SCHEMA_VERSION = 'V22.5';
// V22.4부터 개인별 사번 + PIN 인증을 사용합니다.
// PIN 원문은 저장하지 않고, 서버 Pepper + 사용자 Salt 기반 해시만 저장합니다.

const RECORD_HEADERS = [
  'ID','등록일시','모드','입고번호','입고일자','품명','품목코드','제조원','공급업체',
  '표시수량','단위','사용기한','용기번호시작','용기번호종료','대표코드',
  '입고정보','혼입여부','실제확인수량','수량판정',
  '파레트수','총수량','이종수','최종결과','특이사항','검수자','라벨사진URL','실물사진URL','OCR원문',
  '라벨대조','업체라벨품명','업체라벨수량','업체생산일자','업체생산시간','업체Lot번호','업체생산라인','업체라벨사진URL','업체OCR원문','업체파레트No'
];

const PALLET_HEADERS = [
  'Record ID','순번','Barcode/QR','입고번호','용기번호','품목코드','품명','공급업체','수량','단위','판정',
  'WMS라벨사진URL','업체라벨사진URL','업체라벨품명','대조결과','스캔시각','비고','WMS파레트No','업체파레트No'
];

const MASTER_HEADERS = [
  'Lookup Key','입고번호','용기번호','품명','품목코드','제조원','공급업체','수량','단위','사용기한'
];

const ITEM_MASTER_HEADERS = [
  '자재코드','자재구분','자재명','공급업체목록','업체품명별칭','용량'
];

const PRODUCTION_HEADERS = [
  'ID','등록일시','제품명','제조번호','생산일자','생산수량','투입파레트수','투입총수량',
  '투입파레트요약','비고','등록자','상태','작업자목록','최종수정'
];

// 제조번호 ↔ 투입 파레트를 1:N으로 남겨 역추적이 가능하게 한다
const PRODUCTION_PALLET_HEADERS = [
  'Production ID','제품명','제조번호','순번','입고번호','용기번호','Barcode/QR','품명','품목코드','수량','단위','검수결과','검수기록ID','작업자','등록시각'
];

const AUDIT_LOG_HEADERS = [
  'Event ID','일시','작업','Record ID','Actor','Reason','Before JSON','After JSON','Meta JSON','Backend Version'
];
const DELETED_RECORD_HEADERS = [
  'Deletion ID','삭제일시','Record ID','삭제자','삭제사유','Record JSON','Pallet JSON','Photo URLs','Photo Delete Result','상태'
];

// V58: 네트워크 재전송 중복방지 / 빠른 Pallet 중복검사 / Soft Delete 관리
const V58_REQUEST_INDEX_HEADERS = ['Request ID','Record ID','Created At'];
const V58_PALLET_INDEX_HEADERS = ['Key','Record ID','Created At'];
const V58_SOFT_DELETED_HEADERS = ['Record ID','삭제일시','삭제사유','삭제자','복구일시','복구자'];
const V58_BACKEND_VERSION = 'V58-BACKEND-1.1';
let V58_SOFT_DELETED_MEM_ = null;

const USER_HEADERS = [
  'User ID','사번','이름','부서','권한','PIN Salt','PIN Hash','상태','실패횟수','잠금해제시각','생성일시','수정일시','최근로그인','생성자'
];
const SESSION_HEADERS = [
  'Session Hash','User ID','사번','이름','권한','발급일시','만료일시','최종사용','상태'
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
  ensureSheet_(ss, 'ItemMaster', ITEM_MASTER_HEADERS);
  seedItemMaster_(ss);
  ensureSheet_(ss, 'Production', PRODUCTION_HEADERS);
  ensureSheet_(ss, 'ProductionPallets', PRODUCTION_PALLET_HEADERS);
  ensureSheet_(ss, 'Audit', ['일시','작업','Record ID','상세']);
  ensureSheet_(ss, 'AuditLog', AUDIT_LOG_HEADERS);
  ensureSheet_(ss, 'DeletedRecords', DELETED_RECORD_HEADERS);
  ensureSheet_(ss, 'SaveRequestIndex', V58_REQUEST_INDEX_HEADERS);
  ensureSheet_(ss, 'PalletSaveIndex', V58_PALLET_INDEX_HEADERS);
  ensureSheet_(ss, 'SoftDeletedRecords', V58_SOFT_DELETED_HEADERS);
  ensureSheet_(ss, 'Users', USER_HEADERS);
  ensureSheet_(ss, 'Sessions', SESSION_HEADERS);
  ensureSheet_(ss, 'SaveTiming', ['일시','Record ID','Request ID','입고번호','Pallet','총저장ms','사진대기ms','서버응답ms','작업자','Backend Version']);
  props.setProperty('SCHEMA_VERSION', SCHEMA_VERSION);

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
  // 같은 실행 안에서 같은 시트를 여러 번 요구하면, 핸들과 헤더검사 결과를
  // 재사용한다. 예전에는 호출 때마다 getSheetByName + getLastRow +
  // 헤더 1행 getValues 를 다시 돌려서, 시트 핸들 하나 얻는 데만
  // 왕복 3회가 들었다. 저장 1건에 이 호출이 7번 가까이 일어난다.
  const memo = SHEET_MEM_[name];
  if (memo && SHEET_HEADER_CHECKED_[name]) return memo;

  let sheet = memo || ss.getSheetByName(name);
  if (!sheet) {
    sheet = ss.insertSheet(name);
  }
  SHEET_MEM_[name] = sheet;

  const done = function () { SHEET_HEADER_CHECKED_[name] = true; return sheet; };

  // 헤더는 코드가 바뀔 때만 바뀐다. 헤더 목록의 지문을 Script Property에 남겨
  // 두고, 지문이 같으면 1행을 다시 읽지 않는다. 예전에는 저장 1건마다
  // getLastRow + getLastColumn + 1행 getValues 가 시트마다 반복됐다.
  // 지문이 다르면(= 컬럼이 바뀌면) 평소처럼 검사하고 1행을 갱신한다.
  const stamp = name + ':' + headers.length + ':' + headers.join('|');
  const stampKey = 'V58_HDR_' + name;
  if (scriptProp_(stampKey) === stamp) return done();

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
  setScriptProp_(stampKey, stamp);
  return done();
}

/* ═══════════════════════════════════════════════════════════════════════
   V58 저장속도 패치 (2026-10-07)
   현장 실측: 저장 클릭 → 완료 약 10초 / Pallet. 14 Pallet 기준 2분 20초.

   원인은 "시트를 몇 번 쓰느냐"가 아니라 "시트에 몇 번 다녀오느냐"였다.
   Apps Script ↔ Sheets 왕복은 1회에 수십~수백 ms인데, 저장 1건에서
   openById / getSheetByName / getLastRow / 헤더 getValues 가 수십 번 돌았다.

   아래 캐시들은 모두 "한 번의 실행(doPost 1회)" 동안만 산다.
   실행이 끝나면 사라지므로 다른 작업자나 다음 요청과 섞이지 않는다.
   ═══════════════════════════════════════════════════════════════════════ */

var SS_MEM_ = null;              // 이 실행에서 연 스프레드시트
var SHEET_MEM_ = {};             // 이 실행에서 가져온 시트 핸들
var SHEET_HEADER_CHECKED_ = {};  // 헤더 검사를 이미 끝낸 시트
var PROPS_MEM_ = null;           // 이 실행의 Script Properties 스냅샷

/** Script Properties 를 실행당 1회만 읽는다. */
function scriptProp_(key){
  if(!PROPS_MEM_){
    try{PROPS_MEM_=PropertiesService.getScriptProperties().getProperties()||{};}
    catch(e){PROPS_MEM_={};}
  }
  const v=PROPS_MEM_[key];
  return (v===undefined)?null:v;
}
function setScriptProp_(key,value){
  try{PropertiesService.getScriptProperties().setProperty(key,String(value));}catch(e){}
  if(!PROPS_MEM_)PROPS_MEM_={};
  PROPS_MEM_[key]=String(value);
}

function getSs_() {
  if (SS_MEM_) return SS_MEM_;
  const id = scriptProp_('SPREADSHEET_ID');
  if (!id) throw new Error('시스템이 아직 설정되지 않았습니다. setupSystem을 먼저 실행하세요.');
  SS_MEM_ = SpreadsheetApp.openById(id);
  return SS_MEM_;
}

var R15_TEST_FOLDER_ = null; // r15ServerTest 중에만: 시험 사진을 실제 사진 폴더 대신 임시 폴더에 넣는다
function getPhotoFolder_() {
  if (R15_TEST_FOLDER_) return R15_TEST_FOLDER_;
  const id = PropertiesService.getScriptProperties().getProperty('PHOTO_FOLDER_ID');
  if (!id) throw new Error('사진 폴더가 아직 설정되지 않았습니다. setupSystem을 먼저 실행하세요.');
  return DriveApp.getFolderById(id);
}

/* ---------------- HTTP 진입점 ---------------- */

function doGet(e) {
  const action = (e && e.parameter && e.parameter.action) || 'status';
  try {
    if (action === 'securityInfo') return jsonOut_(securityInfoV24_());

    const session = (e && e.parameter && (e.parameter.session || e.parameter.token)) || '';
    // 읽기는 조회 권한부터. 삭제 보관함·변경 이력은 중간관리자, DB 상태는 관리자.
    const needRole = action === 'dbStatus' ? 'admin' : (action === 'listDeletedRecords' || action === 'r15Audit') ? 'manager' : 'viewer';
    const auth = authorizeSessionV24_(session, needRole);
    if (!auth.ok) return jsonOut_(auth);

    if (action === 'status') {
      const ss = getSs_();
      return jsonOut_({ ok:true, spreadsheetUrl:ss.getUrl(), backendVersion:BACKEND_VERSION, schemaVersion:SCHEMA_VERSION, user:publicUserV24_(auth) });
    }
    if (action === 'whoami') return jsonOut_({ok:true,user:publicUserV24_(auth),expiresAt:auth.expiresAt});
    if (action === 'lookup') return jsonOut_(lookupMaster_(e.parameter.key || ''));
    if (action === 'searchRecords') return jsonOut_(searchRecords_(e.parameter.keyword || ''));
    if (action === 'listRecords') return jsonOut_(listRecordsV23_(e.parameter.keyword || '', e.parameter.page || 1, e.parameter.pageSize || 30));
    if (action === 'getRecord') return jsonOut_(getRecord_(e.parameter.id || ''));
    if (action === 'searchPallets') return jsonOut_(searchPallets_(e.parameter.keyword || ''));
    if (action === 'dashboard') return jsonOut_(getDashboard_());
    if (action === 'trace') return jsonOut_(trace_(e.parameter.keyword || ''));
    if (action === 'lookupItem') return jsonOut_(lookupItem_(e.parameter.code || ''));
    if (action === 'recentProducts') return jsonOut_(recentProducts_());
    if (action === 'productionSession') return jsonOut_(getProductionSession_(e.parameter.id || ''));
    if (action === 'dbStatus') return jsonOut_(dbStatusV23_());
    if (action === 'backendCapabilities') return jsonOut_(v58BackendCapabilities_(auth));
    if (action === 'reportCapabilities') return jsonOut_(v58ReportCapabilities_(auth));
    if (action === 'listDeletedRecords') return jsonOut_(v58ListSoftDeletedRecords_(auth));
    if (String(action).indexOf('r15') === 0) return jsonOut_(r15Get_(action, e.parameter || {}, auth));
    return jsonOut_({ ok:false, message:'알 수 없는 action: ' + action });
  } catch (err) {
    return jsonOut_({ ok:false, message:String(err.message || err) });
  }
}

function doPost(e) {
  try {
    if (!e || !e.postData || !e.postData.contents) return jsonOut_({ ok:false, message:'요청 본문이 없습니다.' });
    const body = JSON.parse(e.postData.contents);
    const action = body.action;

    // 로그인만 인증 전 허용
    if (action === 'authLogin') return jsonOut_(authLoginV24_(body.payload || {}));

    const session = body.session || body.token || '';
    // 권한 4단계: viewer(조회) < worker(작업자) < manager(중간관리자) < admin(관리자)
    const adminActions = ['deleteRecord','dbStatus','listUsers','createUser','updateUser','resetUserPin'];
    const managerActions = ['updateRecord','softDeleteRecords','restoreRecords','importMaster','addItemAlias','r15ItemSave','r15PlanSave'];
    const viewerActions = ['r15AuditNote','authLogout','changeMyPin','photoDataBatch','photoDataBatchV23','photoDataBatchV24','batchGetRecords'];
    const needRole = adminActions.indexOf(action) >= 0 ? 'admin' : managerActions.indexOf(action) >= 0 ? 'manager' : viewerActions.indexOf(action) >= 0 ? 'viewer' : 'worker';
    const auth = authorizeSessionV24_(session, needRole);
    if (!auth.ok) return jsonOut_(auth);

    if (action === 'authLogout') { appendAudit_('로그아웃', '', { actor: actorLabelV24_(auth) }); return jsonOut_(authLogoutV24_(session)); }
    if (action === 'changeMyPin') return jsonOut_(changeMyPinV24_(body.payload || {}, auth, session));
    if (action === 'listUsers') return jsonOut_(listUsersV24_(auth));
    if (action === 'createUser') return jsonOut_(createUserV24_(body.payload || {}, auth));
    if (action === 'updateUser') return jsonOut_(updateUserV24_(body.payload || {}, auth));
    if (action === 'resetUserPin') return jsonOut_(resetUserPinV24_(body.payload || {}, auth));

    // 기록자 이름은 항상 로그인 사용자로 덮어쓴다 (브라우저 값 위조 방지)
    if (action === 'saveSingle') {
      const p = body.payload || {}; p.inspector = auth.name || '';
      return jsonOut_(saveSingleRecord_(p));
    }
    if (action === 'saveMulti') {
      const p = body.payload || {}; p.inspector = auth.name || '';
      return jsonOut_(saveMultiRecord_(p));
    }
    if (action === 'saveProduction') {
      const p = body.payload || {}; p.registrant = auth.name || '';
      return jsonOut_(saveProduction_(p));
    }
    if (action === 'startProduction') {
      const p = body.payload || {}; p.registrant = auth.name || '';
      return jsonOut_(startProduction_(p));
    }
    if (action === 'addProductionPallet') {
      const p = body.payload || {}; p.worker = auth.name || '';
      return jsonOut_(addProductionPallet_(p));
    }
    if (action === 'finishProduction') {
      const p = body.payload || {}; p.registrant = auth.name || '';
      return jsonOut_(finishProduction_(p));
    }
    if (action === 'ocr') return jsonOut_(ocrImage_((body.payload || {}).image));
    if (action === 'uploadPhoto') {
      const pl = body.payload || {};
      const url = v58SavePhoto_(pl.image, pl.name || ('photo_' + Date.now()), {
        inboundNo: pl.inboundNo || '', palletNo: pl.palletNo || '',
        photoType: pl.photoType || '', dateKey: pl.dateKey || ''
      });
      return jsonOut_(url ? { ok:true, url:url } : { ok:false, retry:true, code:'PHOTO_SAVE_FAILED', message:'사진 저장 실패' });
    }
    if (action === 'saveTiming') return jsonOut_(saveTimingV58_(body.payload || {}, auth));
    if (action === 'addItemAlias') return jsonOut_(addItemAlias_(body.payload || {}));
    if (action === 'importMaster') return jsonOut_(importMaster_((body.payload || {}).rows || []));
    if (action === 'batchGetRecords') return jsonOut_(batchGetRecords_((body.payload || {}).ids || []));
    if (action === 'photoDataBatch' || action === 'photoDataBatchV23' || action === 'photoDataBatchV24') return jsonOut_(photoDataBatchV23_((body.payload || {}).urls || []));
    if (action === 'updateRecord') {
      const p = body.payload || {}; p.actor = actorLabelV24_(auth);
      // V58 보고서 UI는 patch를 사용하고 기존 운영 API는 changes를 사용한다. 둘 다 호환한다.
      if (p.patch && !p.changes) p.changes = p.patch;
      return jsonOut_(updateRecord_(p));
    }
    if (action === 'softDeleteRecords') {
      const p = body.payload || {}; p.actor = actorLabelV24_(auth);
      return jsonOut_(v58SoftDeleteRecords_(p, auth));
    }
    if (action === 'restoreRecords') {
      const p = body.payload || {}; p.actor = actorLabelV24_(auth);
      return jsonOut_(v58RestoreRecords_(p, auth));
    }
    if (action === 'deleteRecord') {
      const p = body.payload || {}; p.actor = actorLabelV24_(auth);
      return jsonOut_(deleteRecordV23_(p, auth));
    }
    if (action === 'dbStatus') return jsonOut_(dbStatusV23_());
    if (String(action).indexOf('r15') === 0) return jsonOut_(r15Post_(action, body.payload || {}, auth));
    return jsonOut_({ ok:false, message:'알 수 없는 action: ' + action });
  } catch (err) {
    // Sheets/Drive 서비스 예외("Service Spreadsheets timed out" 등)는 대부분 일시적이다.
    // retry 없이 돌려주면 R15 대기열이 '확인 필요'로 빼 버리고, 사람이 다시 보내면 중복이 생길 수 있었다.
    return jsonOut_({ ok:false, retry:true, code:'SERVER_EXCEPTION', message:String(err.message || err) });
  }
}

function saveTimingV58_(p,auth){
  try{
    const ss=getSs_();
    let sh=ss.getSheetByName('SaveTiming');
    if(!sh) sh=ensureSheet_(ss,'SaveTiming',['일시','Record ID','Request ID','입고번호','Pallet','총저장ms','사진대기ms','서버응답ms','작업자','Backend Version']);
    sh.getRange(sh.getLastRow()+1,1,1,10).setValues([[
      new Date(),
      String(p.recordId||''),
      String(p.requestId||''),
      String(p.inboundNo||''),
      String(p.palletNo||''),
      Number(p.totalMs)||0,
      Number(p.uploadWaitMs)||0,
      Number(p.serverWaitMs)||0,
      auth&&auth.name||'',
      BACKEND_VERSION
    ]]);
    return {ok:true};
  }catch(e){
    return {ok:false,message:String(e&&e.message?e.message:e)};
  }
}

function checkToken_(token) {
  return authorizeSessionV24_(token, 'worker').ok;
}


/* ==================== V22.4 개인계정 / 권한 ==================== */
function sha256V24_(v) {
  const bytes=Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256,String(v||''),Utilities.Charset.UTF_8);
  return Utilities.base64EncodeWebSafe(bytes).replace(/=+$/,'');
}
function randomHexV24_(){ return Utilities.getUuid().replace(/-/g,'')+Utilities.getUuid().replace(/-/g,''); }
// 초기·재발급 PIN은 암호학적 난수(UUID v4)에서 뽑는다. Math.random()은 예측 가능해 쓰지 않는다.
function randomPinV24_(){
  for(let tries=0;tries<20;tries++){
    const hex=Utilities.getUuid().replace(/-/g,'');
    let s='';
    for(let i=0;i<hex.length&&s.length<6;i++){
      const v=parseInt(hex[i],16);
      if(v<10)s+=String(v);            // 0~9만 취해 자릿수 편향을 없앤다
    }
    if(s.length<6)continue;
    if(/^([0-9])\1{5}$/.test(s))continue;
    if(['123456','654321','012345','543210','000000','111111'].indexOf(s)>=0)continue;
    return s;
  }
  // 극히 드문 경우의 예비 경로
  return String(Math.abs(parseInt(Utilities.getUuid().replace(/[^0-9]/g,'').slice(0,6),10)||123457)).slice(-6);
}
function normalizeEmployeeV24_(v){ return String(v||'').trim().toUpperCase().replace(/\s+/g,''); }
function validPinV24_(v){ return /^\d{6}$/.test(String(v||'')); }
// 6자리 PIN은 경우의 수가 적어 해시를 여러 번 반복해 무차별 대입 비용을 올린다.
// 기존(V1) 해시도 그대로 검증되도록 새 해시에만 'v2$' 표식을 붙인다.
const PIN_HASH_ROUNDS = 1000;   // 로그인 체감 지연과 보안 강도의 절충 (필요시 조정)

function pinHashV24_(pin,salt){ return pinHashV2_(pin,salt); }

function pinHashV1_(pin,salt){
  return sha256V24_(String(salt||'')+'|'+String(pin||'')+'|'+pinPepperV24_());
}

function pinHashV2_(pin,salt){
  const pepper=pinPepperV24_();
  let h=sha256V24_(String(salt||'')+'|'+String(pin||'')+'|'+pepper);
  for(let i=0;i<PIN_HASH_ROUNDS;i++)h=sha256V24_(h+'|'+salt+'|'+pepper);
  return 'v2$'+h;
}

function pinPepperV24_(){
  const props=PropertiesService.getScriptProperties();let pepper=props.getProperty('V24_PIN_PEPPER');
  if(!pepper){pepper=randomHexV24_();props.setProperty('V24_PIN_PEPPER',pepper);}
  return pepper;
}

// 저장된 해시 형식에 맞춰 검증한다 (예전 계정도 계속 로그인 가능)
function pinMatchesV24_(pin,salt,stored){
  const st=String(stored||'');
  if(st.indexOf('v2$')===0)return timingEqualV24_(pinHashV2_(pin,salt),st);
  return timingEqualV24_(pinHashV1_(pin,salt),st);
}
function timingEqualV24_(a,b){a=String(a||'');b=String(b||'');let d=a.length^b.length,n=Math.max(a.length,b.length);for(let i=0;i<n;i++)d|=(a.charCodeAt(i%Math.max(1,a.length))||0)^(b.charCodeAt(i%Math.max(1,b.length))||0);return d===0;}
function userIdxV24_(){const x={};USER_HEADERS.forEach(function(h,i){x[h]=i;});return x;}
function sessionIdxV24_(){const x={};SESSION_HEADERS.forEach(function(h,i){x[h]=i;});return x;}
function userRowByEmployeeV24_(ss,employeeNo){
  const sh=ss.getSheetByName('Users'),emp=normalizeEmployeeV24_(employeeNo);if(!sh||sh.getLastRow()<2||!emp)return null;
  const hit=sh.getRange(2,2,sh.getLastRow()-1,1).createTextFinder(emp).matchEntireCell(true).findNext();
  return hit?{sheet:sh,row:hit.getRow(),values:sh.getRange(hit.getRow(),1,1,USER_HEADERS.length).getValues()[0]}:null;
}
function userRowByIdV24_(ss,userId){
  const sh=ss.getSheetByName('Users');if(!sh||sh.getLastRow()<2||!userId)return null;
  const hit=sh.getRange(2,1,sh.getLastRow()-1,1).createTextFinder(String(userId)).matchEntireCell(true).findNext();
  return hit?{sheet:sh,row:hit.getRow(),values:sh.getRange(hit.getRow(),1,1,USER_HEADERS.length).getValues()[0]}:null;
}
function publicUserFromRowV24_(row){const i=userIdxV24_();return {userId:row[i['User ID']],employeeNo:row[i['사번']],name:row[i['이름']],department:row[i['부서']],role:row[i['권한']],status:row[i['상태']]};}
function publicUserV24_(auth){return {userId:auth.userId||'',employeeNo:auth.employeeNo||'',name:auth.name||'',department:auth.department||'',role:roleOfV24_(auth.role)};}
function actorLabelV24_(auth){return [auth.employeeNo||'',auth.name||'',auth.role?'('+roleLabelV24_(auth.role)+')':''].filter(Boolean).join(' ');}
function setupSecurityV24(){
  const ss=getSs_(),props=PropertiesService.getScriptProperties();
  ensureSheet_(ss,'Users',USER_HEADERS);ensureSheet_(ss,'Sessions',SESSION_HEADERS);
  if(!props.getProperty('V24_PIN_PEPPER'))props.setProperty('V24_PIN_PEPPER',randomHexV24_());
  props.setProperty('V24_SECURITY_ENABLED','1');props.setProperty('V23_SECURITY_ENABLED','0');
  const sh=ss.getSheetByName('Users'),i=userIdxV24_();let hasAdmin=false;
  if(sh.getLastRow()>=2){const vals=sh.getRange(2,1,sh.getLastRow()-1,USER_HEADERS.length).getValues();hasAdmin=vals.some(function(r){return String(r[i['권한']])==='admin'&&String(r[i['상태']])==='ACTIVE';});}
  let initial=null;
  if(!hasAdmin){
    const pin=randomPinV24_(),salt=randomHexV24_().slice(0,24),uid=Utilities.getUuid(),now=new Date();
    sh.appendRow([uid,'ADMIN','시스템 관리자','자재지원팀','admin',salt,pinHashV24_(pin,salt),'ACTIVE',0,'',now,now,'','SYSTEM']);
    initial={employeeNo:'ADMIN',pin:pin};
    Logger.log('V22.4 최초 관리자 사번: ADMIN');Logger.log('V22.4 최초 관리자 PIN: '+pin);
    console.log('V22.4 최초 관리자 사번: ADMIN');console.log('V22.4 최초 관리자 PIN: '+pin);
  }
  cleanupSessionsV24_();
  return {ok:true,initialAdmin:initial,message:initial?'최초 관리자 계정이 생성되었습니다. 실행 로그의 PIN을 보관하세요.':'기존 관리자 계정을 유지했습니다.'};
}
function securityInfoV24_(){
  const p=PropertiesService.getScriptProperties();return {ok:true,securityEnabled:p.getProperty('V24_SECURITY_ENABLED')==='1',authMode:'individual',backendVersion:BACKEND_VERSION,schemaVersion:p.getProperty('SCHEMA_VERSION')||SCHEMA_VERSION};
}
function authLoginCoreV24_(p){
  const props=PropertiesService.getScriptProperties();if(props.getProperty('V24_SECURITY_ENABLED')!=='1')return {ok:false,code:'SECURITY_NOT_INITIALIZED',message:'Apps Script에서 setupSecurityV24()를 1회 실행하세요.'};
  const emp=normalizeEmployeeV24_(p.employeeNo),pin=String(p.pin||'');if(!emp||!validPinV24_(pin))return {ok:false,code:'INVALID_CREDENTIALS',message:'사번과 6자리 PIN을 확인하세요.'};
  const lock=LockService.getScriptLock();
  if(!lock.tryLock(8000))return {ok:false,code:'BUSY',message:'접속이 몰리고 있습니다. 잠시 후 다시 시도하세요.'};
  try{
    const ss=getSs_(),u=userRowByEmployeeV24_(ss,emp);if(!u)return {ok:false,code:'INVALID_CREDENTIALS',message:'사번 또는 PIN이 올바르지 않습니다.',_delay:true};
    const i=userIdxV24_(),r=u.values;if(String(r[i['상태']]||'')!=='ACTIVE')return {ok:false,code:'INVALID_CREDENTIALS',message:'사번 또는 PIN이 올바르지 않습니다. 계속 안 되면 관리자에게 문의하세요.',_delay:true};
    const until=r[i['잠금해제시각']] instanceof Date?r[i['잠금해제시각']]:new Date(r[i['잠금해제시각']]||0);if(until&&!isNaN(until.getTime())&&until.getTime()>Date.now())return {ok:false,code:'ACCOUNT_LOCKED',message:'PIN 오류가 반복되어 잠시 잠겼습니다. '+Utilities.formatDate(until,'Asia/Seoul','HH:mm')+' 이후 다시 시도하세요.'};
    const ok=pinMatchesV24_(pin,r[i['PIN Salt']],r[i['PIN Hash']]);
    if(!ok){let fails=(Number(r[i['실패횟수']])||0)+1,lockUntil='';if(fails>=5){lockUntil=new Date(Date.now()+15*60*1000);fails=0;}u.sheet.getRange(u.row,i['실패횟수']+1).setValue(fails);u.sheet.getRange(u.row,i['잠금해제시각']+1).setValue(lockUntil);return {ok:false,code:'INVALID_CREDENTIALS',message:lockUntil?'PIN 5회 오류로 15분간 잠겼습니다.':'사번 또는 PIN이 올바르지 않습니다.',_delay:true};}
    u.sheet.getRange(u.row,i['실패횟수']+1).setValue(0);u.sheet.getRange(u.row,i['잠금해제시각']+1).setValue('');u.sheet.getRange(u.row,i['최근로그인']+1).setValue(new Date());
    const token=randomHexV24_(),hash=sha256V24_(token),now=new Date(),exp=new Date(Date.now()+30*24*60*60*1000),s=ss.getSheetByName('Sessions');
    s.appendRow([hash,r[i['User ID']],r[i['사번']],r[i['이름']],r[i['권한']],now,exp,now,'ACTIVE']);
    const auth={ok:true,userId:r[i['User ID']],employeeNo:r[i['사번']],name:r[i['이름']],department:r[i['부서']],role:r[i['권한']],expiresAt:exp.getTime()};cacheSessionV24_(hash,auth);
    // Sessions 시트가 무한히 커지지 않도록 가끔 정리한다 (로그인 20회에 1회 정도)
    if(Math.random()<0.05)cleanupSessionsV24_();
    appendAudit_('로그인','',{actor:actorLabelV24_(auth),reason:'',meta:{userId:auth.userId}});
    return {ok:true,session:token,expiresAt:exp.getTime(),user:publicUserV24_(auth),backendVersion:BACKEND_VERSION};
  }finally{lock.releaseLock();}
}

// 로그인 실패 응답은 잠금을 푼 뒤에 지연시킨다 (무차별 대입 속도는 늦추되 다른 사용자는 막지 않음)
function authLoginV24_(p){
  const res=authLoginCoreV24_(p);
  // 실패한 로그인도 남긴다 (PIN은 남기지 않음). 잠금 밖에서 쓴다.
  if(res&&!res.ok&&(res.code==='INVALID_CREDENTIALS'||res.code==='ACCOUNT_LOCKED'))appendAudit_('로그인실패','',{actor:'사번 '+String(p.employeeNo||'').slice(0,20),reason:res.message||'',meta:{code:res.code}});
  if(res&&res._delay){delete res._delay;Utilities.sleep(350);}
  return res;
}
function cacheSessionV24_(hash,auth){try{CacheService.getScriptCache().put('V24SESS_'+hash,JSON.stringify(auth),3600);}catch(e){}}
function authorizeSessionV24_(token,needRole){
  token=String(token||'');if(!token)return {ok:false,code:'AUTH_REQUIRED',message:'로그인이 필요합니다.'};const hash=sha256V24_(token);let auth=null;
  try{const raw=CacheService.getScriptCache().get('V24SESS_'+hash);if(raw)auth=JSON.parse(raw);}catch(e){}
  const ss=getSs_();
  if(!auth){const sh=ss.getSheetByName('Sessions');if(!sh||sh.getLastRow()<2)return {ok:false,code:'AUTH_REQUIRED',message:'로그인 세션이 없습니다.'};const hit=sh.getRange(2,1,sh.getLastRow()-1,1).createTextFinder(hash).matchEntireCell(true).findNext();if(!hit)return {ok:false,code:'AUTH_REQUIRED',message:'로그인 세션이 만료되었습니다.'};const si=sessionIdxV24_(),r=sh.getRange(hit.getRow(),1,1,SESSION_HEADERS.length).getValues()[0],exp=r[si['만료일시']] instanceof Date?r[si['만료일시']]:new Date(r[si['만료일시']]||0);if(String(r[si['상태']])!=='ACTIVE'||isNaN(exp.getTime())||exp.getTime()<Date.now())return {ok:false,code:'AUTH_REQUIRED',message:'로그인 세션이 만료되었습니다.'};const u=userRowByIdV24_(ss,r[si['User ID']]);if(!u)return {ok:false,code:'AUTH_REQUIRED',message:'사용자 계정을 찾을 수 없습니다.'};const ui=userIdxV24_(),ur=u.values;if(String(ur[ui['상태']])!=='ACTIVE')return {ok:false,code:'AUTH_REQUIRED',message:'사용 중지된 계정입니다.'};auth={ok:true,userId:ur[ui['User ID']],employeeNo:ur[ui['사번']],name:ur[ui['이름']],department:ur[ui['부서']],role:ur[ui['권한']],expiresAt:exp.getTime()};sh.getRange(hit.getRow(),si['최종사용']+1).setValue(new Date());cacheSessionV24_(hash,auth);}
  if(Number(auth.expiresAt)<Date.now())return {ok:false,code:'AUTH_REQUIRED',message:'로그인 세션이 만료되었습니다.'};if(roleRankV24_(auth.role)<roleRankV24_(needRole))return {ok:false,code:needRole==='admin'?'ADMIN_REQUIRED':'ROLE_REQUIRED',message:roleLabelV24_(needRole)+' 이상 권한이 필요한 작업입니다.'};return auth;
}
// 권한 4단계. 예전 계정의 빈 값이나 모르는 값은 작업자로 본다.
const ROLE_RANK_V24 = { viewer:0, worker:1, manager:2, admin:3 };
const ROLE_LABEL_V24 = { viewer:'조회', worker:'작업자', manager:'중간관리자', admin:'관리자' };
function roleOfV24_(role){ role = String(role || '').trim(); return Object.prototype.hasOwnProperty.call(ROLE_RANK_V24, role) ? role : 'worker'; }
function roleRankV24_(role){ return ROLE_RANK_V24[roleOfV24_(role)]; }
function roleLabelV24_(role){ return ROLE_LABEL_V24[roleOfV24_(role)]; }
function atLeastV24_(auth, role){ return !!auth && roleRankV24_(auth.role) >= roleRankV24_(role); }
function authLogoutV24_(token){const hash=sha256V24_(String(token||''));try{CacheService.getScriptCache().remove('V24SESS_'+hash);}catch(e){}try{const ss=getSs_(),sh=ss.getSheetByName('Sessions');if(sh&&sh.getLastRow()>=2){const hit=sh.getRange(2,1,sh.getLastRow()-1,1).createTextFinder(hash).matchEntireCell(true).findNext();if(hit)sh.getRange(hit.getRow(),9).setValue('REVOKED');}}catch(e){}return {ok:true};}
// 로그인은 유지하되 캐시만 비운다 (이름·부서가 바뀐 경우, 다음 요청에서 새 값을 읽도록)
function refreshUserSessionCacheV24_(ss,userId){
  const sh=ss.getSheetByName('Sessions');if(!sh||sh.getLastRow()<2)return;
  const si=sessionIdxV24_(),vals=sh.getRange(2,1,sh.getLastRow()-1,SESSION_HEADERS.length).getValues();
  vals.forEach(function(r){
    if(String(r[si['User ID']])===String(userId)&&String(r[si['상태']])==='ACTIVE'){
      try{CacheService.getScriptCache().remove('V24SESS_'+String(r[si['Session Hash']]));}catch(e){}
    }
  });
}

function revokeUserSessionsV24_(ss,userId){const sh=ss.getSheetByName('Sessions');if(!sh||sh.getLastRow()<2)return;const si=sessionIdxV24_(),vals=sh.getRange(2,1,sh.getLastRow()-1,SESSION_HEADERS.length).getValues();vals.forEach(function(r,n){if(String(r[si['User ID']])===String(userId)&&String(r[si['상태']])==='ACTIVE'){sh.getRange(n+2,si['상태']+1).setValue('REVOKED');try{CacheService.getScriptCache().remove('V24SESS_'+String(r[si['Session Hash']]));}catch(e){}}});}
function cleanupSessionsV24_(){try{const ss=getSs_(),sh=ss.getSheetByName('Sessions');if(!sh||sh.getLastRow()<2)return;const si=sessionIdxV24_(),vals=sh.getRange(2,1,sh.getLastRow()-1,SESSION_HEADERS.length).getValues(),cut=Date.now()-30*24*60*60*1000,del=[];vals.forEach(function(r,n){const exp=r[si['만료일시']] instanceof Date?r[si['만료일시']]:new Date(r[si['만료일시']]||0);if((!isNaN(exp.getTime())&&exp.getTime()<Date.now())||String(r[si['상태']])!=='ACTIVE'){const issued=r[si['발급일시']] instanceof Date?r[si['발급일시']]:new Date(r[si['발급일시']]||0);if(!isNaN(issued.getTime())&&issued.getTime()<cut)del.push(n+2);}});del.sort(function(a,b){return b-a;}).forEach(function(r){sh.deleteRow(r);});}catch(e){}}
function activeAdminCountV24_(ss){const sh=ss.getSheetByName('Users'),i=userIdxV24_();if(!sh||sh.getLastRow()<2)return 0;return sh.getRange(2,1,sh.getLastRow()-1,USER_HEADERS.length).getValues().filter(function(r){return String(r[i['권한']])==='admin'&&String(r[i['상태']])==='ACTIVE';}).length;}
function listUsersV24_(auth){if(!auth||auth.role!=='admin')return {ok:false,code:'ADMIN_REQUIRED',message:'관리자 권한이 필요합니다.'};const ss=getSs_(),sh=ss.getSheetByName('Users'),i=userIdxV24_(),items=[];if(sh.getLastRow()>=2)sh.getRange(2,1,sh.getLastRow()-1,USER_HEADERS.length).getValues().forEach(function(r){items.push({userId:r[i['User ID']],employeeNo:r[i['사번']],name:r[i['이름']],department:r[i['부서']],role:r[i['권한']],status:r[i['상태']],lastLogin:r[i['최근로그인']] instanceof Date?Utilities.formatDate(r[i['최근로그인']],'Asia/Seoul','yyyy-MM-dd HH:mm'):String(r[i['최근로그인']]||'')});});return {ok:true,items:items};}
function createUserV24_(p,auth){const ss=getSs_(),emp=normalizeEmployeeV24_(p.employeeNo),name=String(p.name||'').trim(),dept=String(p.department||'').trim(),role=roleOfV24_(p.role||'worker');if(!emp||!name)return {ok:false,message:'사번과 이름은 필수입니다.'};if(userRowByEmployeeV24_(ss,emp))return {ok:false,message:'이미 등록된 사번입니다.'};const pin=validPinV24_(p.pin)?String(p.pin):randomPinV24_(),salt=randomHexV24_().slice(0,24),uid=Utilities.getUuid(),now=new Date();ss.getSheetByName('Users').appendRow([uid,emp,name,dept,role,salt,pinHashV24_(pin,salt),'ACTIVE',0,'',now,now,'',actorLabelV24_(auth)]);appendAudit_('사용자생성','USER:'+uid,{actor:actorLabelV24_(auth),after:{employeeNo:emp,name:name,department:dept,role:role,status:'ACTIVE'}});return {ok:true,userId:uid,tempPin:pin};}
function updateUserV24_(p,auth){const ss=getSs_(),u=userRowByIdV24_(ss,String(p.userId||''));if(!u)return {ok:false,message:'사용자를 찾을 수 없습니다.'};const i=userIdxV24_(),r=u.values,before=publicUserFromRowV24_(r),role=roleOfV24_(p.role||before.role),status=String(p.status||before.status)==='INACTIVE'?'INACTIVE':'ACTIVE';if(before.role==='admin'&&before.status==='ACTIVE'&&(role!=='admin'||status!=='ACTIVE')&&activeAdminCountV24_(ss)<=1)return {ok:false,message:'마지막 활성 관리자 계정은 중지하거나 다른 권한으로 바꿀 수 없습니다.'};r[i['이름']]=String(p.name||before.name).trim();r[i['부서']]=String(p.department==null?before.department:p.department).trim();r[i['권한']]=role;r[i['상태']]=status;r[i['수정일시']]=new Date();u.sheet.getRange(u.row,1,1,USER_HEADERS.length).setValues([r]);if(status!=='ACTIVE'||role!==before.role)revokeUserSessionsV24_(ss,before.userId);
  else if(r[i['이름']]!==before.name||r[i['부서']]!==before.department)refreshUserSessionCacheV24_(ss,before.userId);
  appendAudit_('사용자수정','USER:'+before.userId,{actor:actorLabelV24_(auth),before:before,after:publicUserFromRowV24_(r)});return {ok:true};}
function resetUserPinV24_(p,auth){const ss=getSs_(),u=userRowByIdV24_(ss,String(p.userId||''));if(!u)return {ok:false,message:'사용자를 찾을 수 없습니다.'};const pin=validPinV24_(p.pin)?String(p.pin):randomPinV24_(),i=userIdxV24_(),r=u.values,salt=randomHexV24_().slice(0,24);r[i['PIN Salt']]=salt;r[i['PIN Hash']]=pinHashV24_(pin,salt);r[i['실패횟수']]=0;r[i['잠금해제시각']]='';r[i['수정일시']]=new Date();u.sheet.getRange(u.row,1,1,USER_HEADERS.length).setValues([r]);revokeUserSessionsV24_(ss,r[i['User ID']]);appendAudit_('PIN초기화','USER:'+r[i['User ID']],{actor:actorLabelV24_(auth),reason:'관리자 PIN 초기화'});return {ok:true,tempPin:pin};}
function changeMyPinV24_(p,auth,session){const oldPin=String(p.oldPin||''),newPin=String(p.newPin||'');if(!validPinV24_(newPin))return {ok:false,message:'새 PIN은 숫자 6자리여야 합니다.'};const ss=getSs_(),u=userRowByIdV24_(ss,auth.userId);if(!u)return {ok:false,message:'사용자를 찾을 수 없습니다.'};const i=userIdxV24_(),r=u.values;if(!pinMatchesV24_(oldPin,r[i['PIN Salt']],r[i['PIN Hash']]))return {ok:false,message:'현재 PIN이 올바르지 않습니다.'};const salt=randomHexV24_().slice(0,24);r[i['PIN Salt']]=salt;r[i['PIN Hash']]=pinHashV24_(newPin,salt);r[i['수정일시']]=new Date();u.sheet.getRange(u.row,1,1,USER_HEADERS.length).setValues([r]);revokeUserSessionsV24_(ss,auth.userId);appendAudit_('PIN변경','USER:'+auth.userId,{actor:actorLabelV24_(auth)});return {ok:true,reauth:true};}

/* ==================== V22.3 legacy security ==================== */

/* ---------------- 공병 입고건 검색 (생산 등록 연결용) ---------------- */

function searchRecords_(keyword) {
  const kw = String(keyword || '').trim();
  if (!kw) return { ok: false, message: '검색어가 없습니다.' };
  const ss = getSs_();
  const sheet = ss.getSheetByName('Records');
  const idx = {}; RECORD_HEADERS.forEach(function(h,i){ idx[h]=i; });
  const last = sheet.getLastRow();
  if (last < 2) return { ok: true, items: [] };

  // Sheets 전체를 JS로 가져오지 않고 서버의 TextFinder로 먼저 후보 행만 찾는다.
  let matches = [];
  try {
    matches = sheet.getRange(2, 4, last - 1, 6).createTextFinder(kw).matchCase(false).findAll();
  } catch (e) {}
  const seen = {}; const rows = [];
  matches.forEach(function(r){ const n=r.getRow(); if(!seen[n]){seen[n]=true; rows.push(n);} });
  rows.sort(function(a,b){return b-a;});

  // TextFinder가 숫자/형식 때문에 못 찾는 경우 최근 500건만 보조 검색한다.
  if (!rows.length) {
    const start = Math.max(2, last - 499);
    const vals = sheet.getRange(start, 1, last - start + 1, RECORD_HEADERS.length).getValues();
    const low = kw.toLowerCase();
    for (let i = vals.length - 1; i >= 0; i--) {
      const row = vals[i];
      const hay = [row[idx['입고번호']],row[idx['품명']],row[idx['품목코드']],row[idx['공급업체']]].join(' ').toLowerCase();
      if (hay.indexOf(low) >= 0) rows.push(start + i);
      if (rows.length >= 25) break;
    }
  }

  const items = [];
  for (let i=0; i<rows.length && items.length<25; i++) {
    const row = sheet.getRange(rows[i],1,1,RECORD_HEADERS.length).getValues()[0];
    if (v58IsSoftDeleted_(String(row[idx['ID']] || ''))) continue;
    const qty = row[idx['표시수량']] || row[idx['총수량']] || '';
    const dt = new Date(row[idx['등록일시']]);
    items.push({
      id: row[idx['ID']], regDate: isNaN(dt.getTime()) ? String(row[idx['등록일시']] || '') : Utilities.formatDate(dt,'Asia/Seoul','yyyy-MM-dd HH:mm'),
      mode: row[idx['모드']], inboundNo: row[idx['입고번호']], product: row[idx['품명']], itemCode: row[idx['품목코드']],
      supplier: row[idx['공급업체']], qty: qty, unit: row[idx['단위']], finalResult: row[idx['최종결과']]
    });
  }
  return { ok: true, items: items };
}

function getRecord_(id) {
  if (!id) return { ok: false, message: 'id가 없습니다.' };
  if (v58IsSoftDeleted_(id)) return { ok:false, deleted:true, message:'삭제 처리된 기록입니다.' };
  const ss = getSs_();
  const sheet = ss.getSheetByName('Records');
  const idx = {}; RECORD_HEADERS.forEach(function(h,i){ idx[h]=i; });
  const last = sheet.getLastRow();
  if (last < 2) return { ok:false, message:'기록을 찾을 수 없습니다.' };

  const hit = sheet.getRange(2,1,last-1,1).createTextFinder(String(id)).matchEntireCell(true).findNext();
  if (!hit) return { ok: false, message: '기록을 찾을 수 없습니다.' };
  const row = sheet.getRange(hit.getRow(),1,1,RECORD_HEADERS.length).getValues()[0];
  const dt = new Date(row[idx['등록일시']]);
  const record = {
    id: row[idx['ID']], regDate: isNaN(dt.getTime()) ? String(row[idx['등록일시']] || '') : Utilities.formatDate(dt,'Asia/Seoul','yyyy-MM-dd HH:mm'),
    mode: row[idx['모드']], inboundNo: row[idx['입고번호']], inboundDate: row[idx['입고일자']], product: row[idx['품명']], itemCode: row[idx['품목코드']],
    manufacturer: row[idx['제조원']], supplier: row[idx['공급업체']], displayQty: row[idx['표시수량']], unit: row[idx['단위']], expiryDate: row[idx['사용기한']],
    containerFrom: row[idx['용기번호시작']], containerTo: row[idx['용기번호종료']], codeRaw: row[idx['대표코드']], infoMatch: row[idx['입고정보']], mixed: row[idx['혼입여부']],
    actualQty: row[idx['실제확인수량']], qtyResult: row[idx['수량판정']], palletCount: row[idx['파레트수']], totalQty: row[idx['총수량']], mixedCount: row[idx['이종수']],
    finalResult: row[idx['최종결과']], note: row[idx['특이사항']], inspector: row[idx['검수자']], labelPhotoUrl: row[idx['라벨사진URL']], itemPhotoUrl: row[idx['실물사진URL']],
    ocrRaw: row[idx['OCR원문']], labelMatch: row[idx['라벨대조']], vendorProduct: row[idx['업체라벨품명']], vendorQty: row[idx['업체라벨수량']], vendorProdDate: row[idx['업체생산일자']],
    vendorProdTime: row[idx['업체생산시간']], vendorLotNo: row[idx['업체Lot번호']], vendorLine: row[idx['업체생산라인']], vendorPhotoUrl: row[idx['업체라벨사진URL']], vendorPalletNo: (idx['업체파레트No']!==undefined?row[idx['업체파레트No']]:'')
  };

  const pallets = [];
  if (String(record.mode || '').indexOf('다중') === 0) {
    const ps = ss.getSheetByName('PalletDetails'); const plast=ps.getLastRow();
    if(plast>=2){
      const pidx={}; PALLET_HEADERS.forEach(function(h,i){pidx[h]=i;});
      const hits=ps.getRange(2,1,plast-1,1).createTextFinder(String(id)).matchEntireCell(true).findAll();
      hits.forEach(function(h){
        const pr=ps.getRange(h.getRow(),1,1,PALLET_HEADERS.length).getValues()[0];
        pallets.push({seq:pr[pidx['순번']],code:pr[pidx['Barcode/QR']],inboundNo:pr[pidx['입고번호']],containerNo:pr[pidx['용기번호']],wmsPalletNo:(pidx['WMS파레트No']!==undefined?pr[pidx['WMS파레트No']]:'')||pr[pidx['용기번호']],vendorPalletNo:(pidx['업체파레트No']!==undefined?pr[pidx['업체파레트No']]:'')||'',itemCode:pr[pidx['품목코드']],product:pr[pidx['품명']],supplier:pr[pidx['공급업체']],qty:pr[pidx['수량']],unit:pr[pidx['단위']],result:pr[pidx['판정']],wmsPhotoUrl:pr[pidx['WMS라벨사진URL']],vendorPhotoUrl:pr[pidx['업체라벨사진URL']],vendorProduct:pr[pidx['업체라벨품명']],matchResult:pr[pidx['대조결과']],scanTime:pr[pidx['스캔시각']],note:pr[pidx['비고']]});
      });
    }
  }
  return { ok: true, record: record, pallets: pallets };
}

/* ---------------- 서버 OCR (Google Drive 엔진) ---------------- */

/**
 * 이미지를 Google Docs로 OCR 변환해 텍스트를 뽑는다.
 *
 * Apps Script 프로젝트마다 고급 Drive 서비스 버전(v2/v3)이 다를 수 있다.
 * v3에는 v2의 Files.insert({convert:true, ocr:true}) 문법이 없으므로,
 * 현재 프로젝트에서 실제로 제공되는 메서드를 확인해 v3 -> v2 순서로 시도한다.
 * 둘 다 실패하면 양쪽 오류를 함께 돌려 진단 가능하게 한다.
 *
 *   v3: Drive.Files.create({name, mimeType:'...document'}, blob, {ocrLanguage})
 *   v2: Drive.Files.insert({title},                        blob, {ocr:true, convert:true, ocrLanguage})
 */
function ocrImage_(dataUrl) {
  if (!dataUrl) return { ok: false, message: '이미지가 없습니다.' };

  const match = String(dataUrl).match(/^data:(image\/[a-zA-Z0-9.+-]+)[^,]*;base64,([\s\S]*)$/);
  if (!match) return { ok: false, message: '이미지 형식이 올바르지 않습니다.' };

  let blob;
  try {
    blob = Utilities.newBlob(Utilities.base64Decode(match[2]), match[1], 'ocr_temp');
  } catch (e) {
    return { ok: false, message: '이미지를 해석하지 못했습니다 · ' + String(e.message || e) };
  }

  const name = 'ocr_temp_' + Date.now();
  const DOC_MIME = 'application/vnd.google-apps.document';
  let tempId = null, errors = [], usedApi = '';

  // --- v3 ---
  if (!tempId && typeof Drive !== 'undefined' && Drive.Files && typeof Drive.Files.create === 'function') {
    try {
      const f = Drive.Files.create({ name: name, mimeType: DOC_MIME }, blob, { ocrLanguage: 'ko' });
      if (f && f.id) { tempId = f.id; usedApi = 'v3'; }
    } catch (e) { errors.push('v3: ' + String(e.message || e)); }
  }

  // --- v2 ---
  if (!tempId && typeof Drive !== 'undefined' && Drive.Files && typeof Drive.Files.insert === 'function') {
    try {
      const f = Drive.Files.insert({ title: name }, blob, { ocr: true, ocrLanguage: 'ko', convert: true });
      if (f && f.id) { tempId = f.id; usedApi = 'v2'; }
    } catch (e) { errors.push('v2: ' + String(e.message || e)); }
  }

  if (!tempId) {
    if (typeof Drive === 'undefined' || !Drive.Files) {
      return { ok: false, code: 'DRIVE_SERVICE_OFF',
        message: '고급 Drive 서비스가 켜져 있지 않습니다. Apps Script 편집기 → 서비스 + → Drive API를 추가하세요.' };
    }
    return { ok: false, code: 'DRIVE_OCR_FAILED',
      message: 'Drive OCR 변환 실패 · ' + errors.join(' / ')
        + ' · 고급 Drive 서비스 버전(v2/v3)과 사진 용량을 확인하세요.' };
  }

  try {
    const text = DocumentApp.openById(tempId).getBody().getText();
    return { ok: true, text: text || '', api: usedApi };
  } catch (e) {
    return { ok: false, message: 'OCR 문서를 읽지 못했습니다 · ' + String(e.message || e) };
  } finally {
    try { DriveApp.getFileById(tempId).setTrashed(true); } catch (e) {}
  }
}

/* ---------------- 검수한 파레트 검색 (생산 투입 연결용) ---------------- */

function searchPallets_(keyword) {
  const kw=String(keyword||'').trim(); if(!kw)return {ok:false,message:'검색어가 없습니다.'};
  const ss=getSs_(); const items=[]; const seen={};
  const ps=ss.getSheetByName('PalletDetails'); const plast=ps.getLastRow();
  if(plast>=2){
    const pidx={};PALLET_HEADERS.forEach(function(h,i){pidx[h]=i;});
    let hits=[];try{hits=ps.getRange(2,3,plast-1,5).createTextFinder(kw).matchCase(false).findAll();}catch(e){}
    const rows={};hits.forEach(function(h){rows[h.getRow()]=true;});
    Object.keys(rows).map(Number).sort(function(a,b){return b-a;}).slice(0,60).forEach(function(rn){
      const row=ps.getRange(rn,1,1,PALLET_HEADERS.length).getValues()[0];const key=String(row[pidx['Record ID']])+'|'+String(row[pidx['순번']]);if(seen[key])return;seen[key]=true;
      items.push({recordId:row[pidx['Record ID']],seq:row[pidx['순번']],code:row[pidx['Barcode/QR']],inboundNo:row[pidx['입고번호']],containerNo:row[pidx['용기번호']],itemCode:row[pidx['품목코드']],product:row[pidx['품명']],qty:row[pidx['수량']],unit:row[pidx['단위']],result:row[pidx['판정']],source:'다중검수'});
    });
  }
  // 단건 기록도 동일 검색어로 후보 탐색
  const rs=ss.getSheetByName('Records');const rlast=rs.getLastRow();
  if(rlast>=2 && items.length<80){
    const ridx={};RECORD_HEADERS.forEach(function(h,i){ridx[h]=i;});
    let hits=[];try{hits=rs.getRange(2,4,rlast-1,12).createTextFinder(kw).matchCase(false).findAll();}catch(e){}
    const rows={};hits.forEach(function(h){rows[h.getRow()]=true;});
    Object.keys(rows).map(Number).sort(function(a,b){return b-a;}).slice(0,40).forEach(function(rn){
      if(items.length>=80)return;const row=rs.getRange(rn,1,1,RECORD_HEADERS.length).getValues()[0];if(v58IsSoftDeleted_(String(row[ridx['ID']]||'')))return;if(String(row[ridx['모드']])!=='단건')return;
      items.push({recordId:row[ridx['ID']],seq:1,code:row[ridx['대표코드']],inboundNo:row[ridx['입고번호']],containerNo:row[ridx['용기번호시작']],itemCode:row[ridx['품목코드']],product:row[ridx['품명']],qty:row[ridx['실제확인수량']]||row[ridx['표시수량']],unit:row[ridx['단위']],result:row[ridx['최종결과']],source:'단건검수'});
    });
  }
  return {ok:true,items:items};
}

/* ---------------- 자재 마스터 (자재코드 = 정식 명칭) ---------------- */

// 회사 자재 목록. 업체 라벨의 품명은 회사와 다르므로 별칭으로 연결해 나간다.
function seedItemMaster_(ss) {
  const sheet = ss.getSheetByName('ItemMaster');
  if (sheet.getLastRow() > 1) return;   // 이미 있으면 건드리지 않음
  sheet.getRange(2, 1, 7, ITEM_MASTER_HEADERS.length).setValues([
    ['2002866','유리병','75 mL 유리병(각병)','동화지앤피','','75'],
    ['2002867','유리병','100 mL 유리병(각병)','동화지앤피, KC글라스','','100'],
    ['2002868','유리병','100 mL 유리병(둥근병)','동화지앤피, KC글라스','','100'],
    ['2002869','유리병','120 mL 유리병(각병)','동화지앤피','','120'],
    ['2000982','유리병','까스활명수큐병','동화지앤피, KC글라스, 동아에코팩, SGC 솔루션','',''],
    ['2000990','유리병','판콜액 병','동화지앤피, 동아에코팩, SGC 솔루션','',''],
    ['2003257','유리병','75ML 유리병(각병-1897)','동화지앤피','','75']
  ]);
}

function lookupItem_(code) {
  const key = String(code || '').trim();
  if (!key) return { ok: false, message: '자재코드가 없습니다.' };
  const ss = getSs_();
  const sheet = ss.getSheetByName('ItemMaster');
  if (!sheet) return { ok: true, found: false };
  const data = sheet.getDataRange().getValues();
  const idx = {};
  ITEM_MASTER_HEADERS.forEach((h, i) => idx[h] = i);

  for (let i = 1; i < data.length; i++) {
    if (String(data[i][idx['자재코드']]).trim() !== key) continue;
    const row = data[i];
    return {
      ok: true, found: true,
      data: {
        itemCode: row[idx['자재코드']],
        category: row[idx['자재구분']],
        itemName: row[idx['자재명']],
        suppliers: String(row[idx['공급업체목록']] || '').split(',').map(function (x) { return x.trim(); }).filter(String),
        aliases: String(row[idx['업체품명별칭']] || '').split(',').map(function (x) { return x.trim(); }).filter(String),
        volume: row[idx['용량']]
      }
    };
  }
  return { ok: true, found: false };
}

// 업체 라벨 품명을 해당 자재코드의 별칭으로 등록 (다음부터 자동 대조)
function addItemAlias_(p) {
  const code = String(p.itemCode || '').trim();
  const alias = String(p.alias || '').trim();
  if (!code || !alias) return { ok: false, message: '자재코드와 업체 품명이 모두 필요합니다.' };

  const ss = getSs_();
  const sheet = ss.getSheetByName('ItemMaster');
  const data = sheet.getDataRange().getValues();
  const idx = {};
  ITEM_MASTER_HEADERS.forEach((h, i) => idx[h] = i);

  for (let i = 1; i < data.length; i++) {
    if (String(data[i][idx['자재코드']]).trim() !== code) continue;
    const cur = String(data[i][idx['업체품명별칭']] || '');
    const list = cur.split(',').map(function (x) { return x.trim(); }).filter(String);
    if (list.some(function (x) { return x === alias; })) {
      return { ok: true, already: true };
    }
    list.push(alias);
    sheet.getRange(i + 1, idx['업체품명별칭'] + 1).setValue(list.join(', '));
    return { ok: true, aliases: list };
  }

  // 마스터에 없는 자재코드면 새 줄로 추가
  sheet.appendRow([code, '', p.itemName || '', p.supplier || '', alias, '']);
  return { ok: true, created: true };
}

/* V22.3 이전의 공용 접속코드 인증(V23 계열)은 V22.4의 사번+PIN 방식으로 완전히 대체되어 제거했습니다.
   조회·삭제 등 이름에 V23이 남아있는 함수들은 현재도 사용 중인 정상 기능입니다. */

/* ---------------- 대시보드 / 추적 ---------------- */

function dayStart_(offsetDays) {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - (offsetDays || 0));
  return d;
}

function getDashboardUncached_() {
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
    if (v58IsSoftDeleted_(String(row[ridx['ID']] || ''))) continue;
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
    if (String(data[i][idx['상태']] || '') === '삭제') continue;
    const name = String(data[i][idx['제품명']] || '').trim();
    if (!lastLot) lastLot = String(data[i][idx['제조번호']] || '').trim();
    if (name && !seen[name]) { seen[name] = true; products.push(name); }
    if (products.length >= 8) break;
  }
  return { ok: true, products: products, lastLot: lastLot };
}

// 작업 시작: 생산 기록을 먼저 만들어 두고 id를 돌려준다
function startProduction_(p) {
  const lock=LockService.getScriptLock();
  if(!lock.tryLock(15000))return {ok:false,message:'다른 작업자가 저장 중입니다. 잠시 후 다시 시도하세요.'};
  try{
    const ss=getSs_();const sheet=ss.getSheetByName('Production');const idx={};PRODUCTION_HEADERS.forEach(function(h,i){idx[h]=i;});
    const product=String(p.productName||'').trim(),lot=String(p.lotNo||'').trim(),worker=String(p.worker||p.registrant||'').trim();
    if(!product||!lot||!worker)return {ok:false,message:'제품명, 제조번호, 작업자명이 필요합니다.'};
    let rowNo=0;const last=sheet.getLastRow();
    if(last>=2){
      const hits=sheet.getRange(2,4,last-1,1).createTextFinder(lot).matchEntireCell(true).findAll();
      for(let i=hits.length-1;i>=0;i--){
        const rn=hits[i].getRow();const rr=sheet.getRange(rn,1,1,PRODUCTION_HEADERS.length).getValues()[0];
        if(String(rr[idx['제품명']]||'').trim()===product && String(rr[idx['상태']]||'')==='진행중'){rowNo=rn;break;}
      }
    }
    if(rowNo){
      const cur=sheet.getRange(rowNo,1,1,PRODUCTION_HEADERS.length).getValues()[0];
      const workers=String(cur[idx['작업자목록']]||cur[idx['등록자']]||'').split(',').map(function(x){return x.trim();}).filter(Boolean);
      if(workers.indexOf(worker)<0)workers.push(worker);
      sheet.getRange(rowNo,idx['작업자목록']+1).setValue(workers.join(', '));sheet.getRange(rowNo,idx['최종수정']+1).setValue(new Date());
      const snap=getProductionSession_(String(cur[idx['ID']]));snap.joined=true;return snap;
    }
    const id=Utilities.getUuid();
    sheet.appendRow([id,new Date(),product,lot,p.prodDate||'',p.prodQty||'',0,0,'',p.note||'',worker,'진행중',worker,new Date()]);
    return {ok:true,id:id,joined:false,palletCount:0,total:0,workers:[worker],pallets:[]};
  } finally {lock.releaseLock();}
}

function findProductionRow_(sheet, id) {
  if(!id || sheet.getLastRow()<2) return 0;
  const hit=sheet.getRange(2,1,sheet.getLastRow()-1,1).createTextFinder(String(id)).matchEntireCell(true).findNext();
  return hit ? hit.getRow() : 0;
}

// 파레트 1개를 즉시 추가하고 합계를 갱신 (스캔할 때마다 호출)
function addProductionPallet_(p) {
  if(!p.productionId)return {ok:false,message:'작업 ID가 없습니다.'};
  const lock=LockService.getScriptLock();
  if(!lock.tryLock(15000))return {ok:false,message:'다른 작업자가 등록 중입니다. 다시 스캔해 주세요.'};
  try{
    const ss=getSs_(),ps=ss.getSheetByName('ProductionPallets'),prod=ss.getSheetByName('Production');
    const row=findProductionRow_(prod,p.productionId);if(!row)return {ok:false,message:'작업 기록을 찾을 수 없습니다.'};
    const idx={};PRODUCTION_HEADERS.forEach(function(h,i){idx[h]=i;});const cur=prod.getRange(row,1,1,PRODUCTION_HEADERS.length).getValues()[0];
    if(String(cur[idx['상태']]||'')!=='진행중')return {ok:false,message:'이미 종료된 생산 작업입니다.'};
    const worker=String(p.worker||'').trim();
    const plast=ps.getLastRow(),pidx={};PRODUCTION_PALLET_HEADERS.forEach(function(h,i){pidx[h]=i;});
    if(plast>=2){
      const hits=ps.getRange(2,1,plast-1,1).createTextFinder(String(p.productionId)).matchEntireCell(true).findAll();
      for(let i=0;i<hits.length;i++){
        const rr=ps.getRange(hits[i].getRow(),1,1,PRODUCTION_PALLET_HEADERS.length).getValues()[0];
        if(String(rr[pidx['입고번호']])===String(p.inboundNo||'') && String(rr[pidx['용기번호']])===String(p.containerNo||''))return {ok:false,duplicate:true,message:'다른 작업자가 이미 등록한 파레트입니다.'};
      }
      // R15 화면과 함께 쓰므로 다른 제조번호에 이미 투입된 Pallet도 막는다 (R15 r15LotAdd_와 같은 규칙)
      const ib=String(p.inboundNo||'').trim(),pn=Number(String(p.containerNo||'').replace(/[^0-9]/g,''))||0;
      if(ib&&pn){
        const other=ps.getRange(2,pidx['입고번호']+1,plast-1,1).createTextFinder(ib).matchEntireCell(true).findAll();
        for(let i=0;i<other.length;i++){
          const rr=ps.getRange(other[i].getRow(),1,1,PRODUCTION_PALLET_HEADERS.length).getValues()[0];
          if(String(rr[0])!==String(p.productionId)&&(Number(String(rr[pidx['용기번호']]).replace(/[^0-9]/g,''))||0)===pn)return {ok:false,duplicate:true,message:'이미 '+rr[pidx['제품명']]+' '+rr[pidx['제조번호']]+'에 투입된 파레트입니다.'};
        }
      }
    }
    const seq=(Number(cur[idx['투입파레트수']])||0)+1,qty=Number(String(p.qty||'').replace(/,/g,''))||0,total=(Number(cur[idx['투입총수량']])||0)+qty;
    const summary=String(cur[idx['투입파레트요약']]||''),tag=(p.inboundNo||'')+'-'+(p.containerNo||'');
    ps.appendRow([p.productionId,cur[idx['제품명']],cur[idx['제조번호']],seq,p.inboundNo||'',p.containerNo||'',p.code||'',p.product||'',p.itemCode||'',p.qty||'',p.unit||'',p.result||'',p.recordId||'',worker,new Date()]);
    prod.getRange(row,idx['투입파레트수']+1).setValue(seq);prod.getRange(row,idx['투입총수량']+1).setValue(total);prod.getRange(row,idx['투입파레트요약']+1).setValue(summary?(summary+', '+tag):tag);prod.getRange(row,idx['최종수정']+1).setValue(new Date());
    const workers=String(cur[idx['작업자목록']]||cur[idx['등록자']]||'').split(',').map(function(x){return x.trim();}).filter(Boolean);if(worker&&workers.indexOf(worker)<0){workers.push(worker);prod.getRange(row,idx['작업자목록']+1).setValue(workers.join(', '));}
    return {ok:true,seq:seq,total:total,palletCount:seq};
  } finally {lock.releaseLock();}
}

function finishProduction_(p) {
  if(!p.productionId)return {ok:false,message:'작업 ID가 없습니다.'};
  const lock=LockService.getScriptLock();if(!lock.tryLock(15000))return {ok:false,message:'다른 작업자가 처리 중입니다. 다시 시도하세요.'};
  try{
    const ss=getSs_(),prod=ss.getSheetByName('Production'),row=findProductionRow_(prod,p.productionId);if(!row)return {ok:false,message:'작업 기록을 찾을 수 없습니다.'};
    const idx={};PRODUCTION_HEADERS.forEach(function(h,i){idx[h]=i;});
    if(p.note)prod.getRange(row,idx['비고']+1).setValue(p.note);if(p.prodQty)prod.getRange(row,idx['생산수량']+1).setValue(p.prodQty);if(p.prodDate)prod.getRange(row,idx['생산일자']+1).setValue(p.prodDate);
    if(p.closeSession)prod.getRange(row,idx['상태']+1).setValue('종료');prod.getRange(row,idx['최종수정']+1).setValue(new Date());
    const cur=prod.getRange(row,1,1,PRODUCTION_HEADERS.length).getValues()[0];return {ok:true,palletCount:cur[idx['투입파레트수']],total:cur[idx['투입총수량']],closed:String(cur[idx['상태']])==='종료'};
  } finally {lock.releaseLock();}
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
    pallets.length, total, summary, p.note || '', p.registrant || '', '종료', p.registrant || '', new Date()
  ]);

  if (pallets.length) {
    const psheet = ss.getSheetByName('ProductionPallets');
    const rows = pallets.map(function (x, i) {
      return [id, p.productName || '', p.lotNo || '', i + 1,
        x.inboundNo || '', x.containerNo || '', x.code || '', x.product || '',
        x.itemCode || '', x.qty || '', x.unit || '', x.result || '', x.recordId || '', p.registrant || '', new Date()];
    });
    psheet.getRange(psheet.getLastRow() + 1, 1, rows.length, PRODUCTION_PALLET_HEADERS.length).setValues(rows);
  }

  return { ok: true, id: id, palletCount: pallets.length, total: total };
}


/* ==================== V22.3 DB / 조회 / 삭제 안정화 ==================== */
function listRecordsV23_(keyword,page,pageSize){
  const ss=getSs_(), sh=ss.getSheetByName('Records'), idx={};RECORD_HEADERS.forEach(function(h,i){idx[h]=i;});
  const last=sh.getLastRow(); const allowed=[10,30,50,100]; page=Math.max(1,parseInt(page,10)||1); pageSize=parseInt(pageSize,10)||30;if(allowed.indexOf(pageSize)<0)pageSize=30;
  if(last<2)return {ok:true,items:[],page:1,pageSize:pageSize,total:0,totalPages:1};
  const kw=String(keyword||'').trim(); let rows=[];
  if(!kw){ for(let r=last;r>=2;r--)rows.push(r); }
  else{
    const cols=['입고번호','품명','품목코드','공급업체','검수자','최종결과']; const seen={};
    cols.forEach(function(h){const c=idx[h];if(c===undefined)return;let hits=[];try{hits=sh.getRange(2,c+1,last-1,1).createTextFinder(kw).matchCase(false).findAll();}catch(e){}hits.forEach(function(x){seen[x.getRow()]=true;});});
    rows=Object.keys(seen).map(Number).sort(function(a,b){return b-a;});
  }
  // Soft Delete 된 기록은 페이지 수/총건수에서도 제외한다. ID 열은 한 번만 읽어 성능을 유지한다.
  const deletedMap=v58SoftDeletedMap_();
  if(Object.keys(deletedMap).length){
    const idVals=sh.getRange(2,1,last-1,1).getValues();
    rows=rows.filter(function(rn){return !deletedMap[String(idVals[rn-2][0]||'')];});
  }
  const total=rows.length,totalPages=Math.max(1,Math.ceil(total/pageSize));if(page>totalPages)page=totalPages;
  const sel=rows.slice((page-1)*pageSize,page*pageSize),items=[];
  sel.forEach(function(rn){
    const row=sh.getRange(rn,1,1,RECORD_HEADERS.length).getValues()[0], dt=new Date(row[idx['등록일시']]);
    if(v58IsSoftDeleted_(String(row[idx['ID']]||'')))return;
    items.push({
      id:row[idx['ID']],regDate:isNaN(dt.getTime())?String(row[idx['등록일시']]||''):Utilities.formatDate(dt,'Asia/Seoul','yyyy-MM-dd HH:mm'),
      mode:row[idx['모드']],inboundNo:row[idx['입고번호']],product:row[idx['품명']],itemCode:row[idx['품목코드']],supplier:row[idx['공급업체']],
      qty:row[idx['표시수량']]||row[idx['총수량']]||'',unit:row[idx['단위']],finalResult:row[idx['최종결과']],inspector:row[idx['검수자']],
      wmsPalletNo:row[idx['용기번호시작']]||'',vendorProduct:row[idx['업체라벨품명']]||'',vendorLotNo:row[idx['업체Lot번호']]||'',vendorPalletNo:(idx['업체파레트No']!==undefined?row[idx['업체파레트No']]:'')||'',labelMatch:row[idx['라벨대조']]||''
    });
  });
  return {ok:true,items:items,page:page,pageSize:pageSize,total:total,totalPages:totalPages,keyword:kw};
}

function dbStatusV23_(){
  const ss=getSs_(), names=['Records','PalletDetails','Production','ProductionPallets','Audit','AuditLog','DeletedRecords','Master','ItemMaster','Users','Sessions'],counts={};
  names.forEach(function(n){const sh=ss.getSheetByName(n);counts[n]=sh?Math.max(0,sh.getLastRow()-1):null;});
  return {ok:true,backendVersion:BACKEND_VERSION,schemaVersion:PropertiesService.getScriptProperties().getProperty('SCHEMA_VERSION')||SCHEMA_VERSION,counts:counts};
}
function rowObjectV23_(headers,row){const o={};headers.forEach(function(h,i){let v=row[i];if(v instanceof Date)v=Utilities.formatDate(v,'Asia/Seoul','yyyy-MM-dd HH:mm:ss');o[h]=v;});return o;}
function palletSnapshotsV23_(ss,id){
  const ps=ss.getSheetByName('PalletDetails'),out=[];if(!ps||ps.getLastRow()<2)return out;
  const hits=ps.getRange(2,1,ps.getLastRow()-1,1).createTextFinder(String(id)).matchEntireCell(true).findAll();
  hits.forEach(function(h){out.push(rowObjectV23_(PALLET_HEADERS,ps.getRange(h.getRow(),1,1,PALLET_HEADERS.length).getValues()[0]));});return out;
}
function archiveDeletionV23_(ss,id,actor,reason,recordObj,pallets,photos,status,result){
  const sh=ss.getSheetByName('DeletedRecords')||ensureSheet_(ss,'DeletedRecords',DELETED_RECORD_HEADERS), deletionId=Utilities.getUuid();
  sh.appendRow([deletionId,new Date(),id,actor,reason,JSON.stringify(recordObj||{}),JSON.stringify(pallets||[]),JSON.stringify(photos||[]),JSON.stringify(result||{}),status||'PENDING']);
  return {id:deletionId,row:sh.getLastRow(),sheet:sh};
}
function updateDeletionArchiveV23_(arc,status,result){try{arc.sheet.getRange(arc.row,9,1,2).setValues([[JSON.stringify(result||{}),status]]);}catch(e){}}
function preflightPhotosV23_(urls){
  const out=[]; (urls||[]).forEach(function(url){const id=driveFileIdFromUrl_(url);if(!id){out.push({url:url,status:'INVALID_URL'});return;}try{const f=DriveApp.getFileById(id);out.push({url:url,id:id,status:f.isTrashed()?'ALREADY_TRASHED':'READY',name:f.getName()});}catch(e){out.push({url:url,id:id,status:'ALREADY_MISSING',error:String(e.message||e)});}});return out;
}
function permanentlyDeletePhotosV23_(pre){
  // Drive.Files.remove 는 고급 Drive 서비스 v2/v3 양쪽에 있지만, 서비스가 꺼져
  // 있거나 권한이 모자라면 던진다. 그 경우 DriveApp 휴지통 이동으로 물러난다.
  const out=[];(pre||[]).forEach(function(x){
    if(x.status==='ALREADY_MISSING'||x.status==='INVALID_URL'||x.status==='ALREADY_TRASHED'){out.push(x);return;}
    try{
      Drive.Files.remove(x.id);out.push({url:x.url,id:x.id,status:'DELETED'});
    }catch(e){
      try{
        DriveApp.getFileById(x.id).setTrashed(true);
        out.push({url:x.url,id:x.id,status:'DELETED',trashed:true});
      }catch(e2){
        out.push({url:x.url,id:x.id,status:'DELETE_FAILED',error:String(e.message||e)+' / '+String(e2.message||e2)});
      }
    }
  });return out;
}
function deleteRecordV23_(p,auth){
  const id=String(p.id||'').trim(),actor=String(p.actor||'').trim(),reason=String(p.reason||'').trim(),confirmText=String(p.confirmText||'').trim();
  if(!id||!actor||!reason)return {ok:false,message:'기록 ID, 삭제자, 삭제 사유는 필수입니다.'};
  if(confirmText!=='DELETE')return {ok:false,message:'최종 삭제 확인값이 올바르지 않습니다.'};
  if(!auth||auth.role!=='admin')return {ok:false,code:'ADMIN_REQUIRED',message:'관리자 인증이 필요한 작업입니다.'};
  const lock=LockService.getScriptLock();lock.waitLock(20000);
  try{
    const ss=getSs_(),sh=ss.getSheetByName('Records'),last=sh.getLastRow();if(last<2)return {ok:false,message:'기록이 없습니다.'};
    const hit=sh.getRange(2,1,last-1,1).createTextFinder(id).matchEntireCell(true).findNext();if(!hit)return {ok:false,message:'기록을 찾을 수 없습니다.'};
    const rowNo=hit.getRow(),idx={};RECORD_HEADERS.forEach(function(h,i){idx[h]=i;});const row=sh.getRange(rowNo,1,1,RECORD_HEADERS.length).getValues()[0];
    if(String(row[idx['모드']]||'').indexOf('다중')===0)return {ok:false,message:'다중 파레트 기록은 현재 운영 보류 상태이므로 삭제하지 않습니다.'};
    const prod=ss.getSheetByName('ProductionPallets');if(prod&&prod.getLastRow()>=2){const pidx={};PRODUCTION_PALLET_HEADERS.forEach(function(h,i){pidx[h]=i;});const c=pidx['검수기록ID']+1;const linked=prod.getRange(2,c,prod.getLastRow()-1,1).createTextFinder(id).matchEntireCell(true).findNext();if(linked)return {ok:false,message:'이미 생산 투입 기록에 연결되어 있어 삭제할 수 없습니다. 추적성 보존이 필요합니다.'};}
    const recordObj=rowObjectV23_(RECORD_HEADERS,row), pallets=palletSnapshotsV23_(ss,id), photos=collectRecordPhotoUrls_(ss,id,row,idx), pre=preflightPhotosV23_(photos);
    const denied=pre.filter(function(x){return x.status==='INVALID_URL';});
    const arc=archiveDeletionV23_(ss,id,actor,reason,recordObj,pallets,photos,denied.length?'PRECHECK_FAILED':'PENDING',{preflight:pre});
    if(denied.length){appendAudit_('기록삭제실패',id,{actor:actor,reason:reason,before:recordObj,meta:{stage:'photo_preflight',photos:pre}});return {ok:false,code:'PHOTO_PRECHECK_FAILED',message:'연결 사진 중 접근할 수 없는 파일이 있어 DB 기록은 삭제하지 않았습니다.',photoResults:pre};}
    const photoResults=permanentlyDeletePhotosV23_(pre),failed=photoResults.filter(function(x){return x.status==='DELETE_FAILED';});
    if(failed.length){updateDeletionArchiveV23_(arc,'PARTIAL_PHOTO_DELETE',{preflight:pre,delete:photoResults});appendAudit_('기록삭제부분실패',id,{actor:actor,reason:reason,before:recordObj,meta:{photos:photoResults}});return {ok:false,code:'PHOTO_DELETE_PARTIAL',message:'일부 사진 삭제에 실패해 DB 기록은 유지했습니다. 다시 삭제를 시도할 수 있습니다.',photoResults:photoResults};}
    const ps=ss.getSheetByName('PalletDetails');if(ps&&ps.getLastRow()>=2){const hits=ps.getRange(2,1,ps.getLastRow()-1,1).createTextFinder(id).matchEntireCell(true).findAll().map(function(h){return h.getRow();}).sort(function(a,b){return b-a;});hits.forEach(function(r){ps.deleteRow(r);});}
    sh.deleteRow(rowNo);v58RemovePalletIndexByRecord_(id);updateDeletionArchiveV23_(arc,'COMPLETED',{preflight:pre,delete:photoResults});appendAudit_('기록삭제',id,{actor:actor,reason:reason,before:recordObj,meta:{photos:photoResults,deletionId:arc.id}});try{CacheService.getScriptCache().remove('v22_dashboard');}catch(e){}
    return {ok:true,id:id,deletedPhotos:photoResults.filter(function(x){return x.status==='DELETED';}).length,photoCount:photos.length,deletionId:arc.id};
  }finally{lock.releaseLock();}
}
function photoDataBatchV23_(urls){
  const out={},errors={};let total=0;urls=(urls||[]).map(String).filter(Boolean).slice(0,12);
  urls.forEach(function(url){
    try{
      const id=driveFileIdFromUrl_(url);if(!id){errors[url]='파일 ID 확인 실패';return;}const f=DriveApp.getFileById(id);let blob=f.getBlob(),bytes=blob.getBytes();
      if(bytes.length>1400000){try{const t=f.getThumbnail();if(t){blob=t;bytes=blob.getBytes();}}catch(e){}}
      if(bytes.length>1800000){errors[url]='사진 용량이 너무 큼';return;}if(total+bytes.length>8500000){errors[url]='응답 용량 한도 초과';return;}total+=bytes.length;
      out[url]='data:'+(blob.getContentType()||'image/jpeg')+';base64,'+Utilities.base64Encode(bytes);
    }catch(e){errors[url]=String(e.message||e);}
  });
  return {ok:true,items:out,errors:errors,loaded:Object.keys(out).length,requested:urls.length};
}

function jsonOut_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

/* ---------------- Master 조회 ---------------- */

function lookupMaster_(key) {
  if (!key) return { ok:false, message:'key가 없습니다.' };
  const ss=getSs_(); const sheet=ss.getSheetByName('Master'); const last=sheet.getLastRow();
  if(last<2)return {ok:true,found:false};
  const hit=sheet.getRange(2,1,last-1,1).createTextFinder(String(key).trim()).matchEntireCell(true).findNext();
  if(!hit)return {ok:true,found:false};
  const row=sheet.getRange(hit.getRow(),1,1,MASTER_HEADERS.length).getValues()[0];
  return {ok:true,found:true,data:{lookupKey:row[0],inboundNo:row[1],containerNo:row[2],product:row[3],itemCode:row[4],manufacturer:row[5],supplier:row[6],qty:row[7],unit:row[8],expiryDate:row[9]}};
}

/* ---------------- 저장 ---------------- */

function savePhoto_(dataUrl, idPrefix, meta) {
  return v58SavePhoto_(dataUrl, idPrefix, meta || {});
}

function saveItemPhotos_(photos, idPrefix, meta) {
  if (!photos || !photos.length) return '';
  const urls = [];
  photos.forEach(function(dataUrl, i) {
    const m = Object.assign({}, meta || {}, { photoType:'ITEM_' + (i + 1) });
    const url = v58SavePhoto_(dataUrl, idPrefix + '_실물' + (i + 1), m);
    if (url) urls.push(url);
  });
  return urls.join(', ');
}

function v58LegacyDuplicateRecord_(sheet,inboundNo,currentSeq){
  if(!inboundNo || !currentSeq) return '';
  const data = sheet.getDataRange().getValues();
  const idx = {}; RECORD_HEADERS.forEach(function(h,i){idx[h]=i;});
  for(let i=data.length-1;i>=1;i--){
    const row=data[i];
    if(String(row[idx['모드']]||'')!=='단건')continue;
    if(v58IsSoftDeleted_(String(row[idx['ID']]||'')))continue;
    if(String(row[idx['입고번호']]||'').trim()!==inboundNo)continue;
    const savedSeq=Number(String(row[idx['용기번호시작']]||'').replace(/[^0-9]/g,''))||0;
    if(savedSeq===currentSeq)return String(row[idx['ID']]||'');
  }
  return '';
}

function saveSingleRecord_(p) {
  p=p||{};
  // 서버가 각 구간에 실제로 몇 ms를 썼는지 응답에 담는다.
  // 추측으로 최적화하지 않기 위한 계측이다. 응답의 timing 필드로 확인한다.
  const T0=Date.now();const T={};let TP=T0;
  const mark=function(name){const now=Date.now();T[name]=now-TP;TP=now;};

  const ss=getSs_(), sheet=ss.getSheetByName('Records');
  const inboundNo=String(p.inboundNo||'').trim();
  const currentSeq=Number(String(p.containerFrom||'').replace(/[^0-9]/g,''))||0;
  const requestId=String(p.requestId||'').trim();

  // 응답만 유실된 재전송이면 사진을 다시 만들기 전에 먼저 빠르게 복구한다.
  if(requestId){
    // 캐시만 본다. 시트 검색은 아래 Lock 안에서 한 번만 한다.
    // 새 requestId는 항상 캐시에도 시트에도 없으므로, 여기서 시트를 뒤지면
    // 정상 저장 때마다 SaveRequestIndex 전체를 헛되이 한 번 더 훑게 된다.
    // V58DONE_ 은 기록 행까지 쓴 뒤에만 남긴다. (색인만 쓰고 죽은 요청을 '완료'로 착각하지 않게)
    let priorFast='';try{priorFast=CacheService.getScriptCache().get('V58DONE_'+requestId)||'';}catch(e){}
    if(priorFast&&!v58IsSoftDeleted_(priorFast))return {ok:true,id:priorFast,duplicateRequest:true,message:'이미 처리된 저장 요청입니다.'};
  }

  // 사진/Drive I/O는 ScriptLock 밖에서 수행한다. 정상 흐름은 이미 업로드된 URL을 사용한다.
  const provisionalId=Utilities.getUuid();
  const dateKey=Utilities.formatDate(new Date(),Session.getScriptTimeZone()||'Asia/Seoul','yyyyMMdd');
  const meta={inboundNo:inboundNo,palletNo:currentSeq||p.containerFrom||'',dateKey:dateKey};
  const photoUrl=p.photoUrl||v58SavePhoto_(p.photo,provisionalId+'_WMS',Object.assign({},meta,{photoType:'WMS'}));
  const vendorPhotoUrl=p.vendorPhotoUrl||v58SavePhoto_(p.vendorPhoto,provisionalId+'_VENDOR',Object.assign({},meta,{photoType:'VENDOR'}));
  const itemPhotoUrls=saveItemPhotos_(p.itemPhotos,provisionalId,meta);
  mark('photos');
  // 사진 원본을 보냈는데 Drive 저장에 실패하면 기록을 남기지 않는다.
  // (기존에는 사진 없는 기록이 저장되고 단말은 사진을 지워 증빙이 사라졌다)
  if((p.photo&&!photoUrl)||(p.vendorPhoto&&!vendorPhotoUrl))return {ok:false,retry:true,code:'PHOTO_SAVE_FAILED',message:'사진 저장에 실패했습니다 · 자동으로 다시 시도합니다.'};
  if(p.client==='r15'){
    if(!inboundNo||!currentSeq)return {ok:false,code:'MISSING_KEY',message:'입고번호와 Pallet 번호가 필요합니다.'};
    if(!photoUrl)return {ok:false,code:'MISSING_PHOTO',message:'WMS 라벨 사진이 없습니다.'};
  }

  const lock=LockService.getScriptLock();
  if(!lock.tryLock(8000))return {ok:false,busy:true,retry:true,message:'저장 요청이 몰려 잠시 대기 중입니다 · 자동으로 다시 시도합니다.'};
  mark('lock');
  let saved=null;
  try{
    // Lock 안에서 Request ID를 다시 확인해 동시 재전송도 한 건으로 만든다.
    // 이전 시도가 색인만 쓰고 예외로 끝났을 수 있다. 색인에 있어도 기록 행이 없으면 같은 ID로 이어서 저장한다.
    let resumeId='';
    if(requestId){
      const prior=v58FindRequest_(requestId);
      if(prior&&!v58IsSoftDeleted_(prior)){
        if(v58RecordExists_(prior)){v58MarkRequestDone_(requestId,prior);return {ok:true,id:prior,duplicateRequest:true,message:'이미 처리된 저장 요청입니다.'};}
        resumeId=prior;
      }
    }

    mark('requestCheck');

    let duplicateId=v58FindPalletVerified_(inboundNo,currentSeq,resumeId);
    if(duplicateId&&v58IsSoftDeleted_(duplicateId))duplicateId='';
    if(!duplicateId&&!v58PalletIndexReady_())duplicateId=v58LegacyDuplicateRecord_(sheet,inboundNo,currentSeq);
    if(duplicateId){
      // 단말이 '이미 저장됨'을 누르기 전에 기존 기록의 사진과 비교할 수 있게 사진 주소를 함께 돌려준다 (중복일 때만 드는 비용)
      let ex=null;try{ex=v58RecordInfo_(duplicateId);}catch(e){}
      return {ok:false,duplicate:true,id:duplicateId,existingPhotoUrl:ex?String(ex.values[ex.idx['라벨사진URL']]||''):'',existingAt:ex?r15Fmt_(ex.values[ex.idx['등록일시']],'yyyy-MM-dd HH:mm'):'',existingInspector:ex?String(ex.values[ex.idx['검수자']]||''):'',message:'이미 저장된 Pallet입니다 · 관리번호 '+inboundNo+' / 순번 '+currentSeq};
    }
    mark('dupCheck');

    const id=resumeId||provisionalId;
    const row=[
      id,new Date(),'단건',
      p.inboundNo||'',p.inboundDate||'',p.product||'',p.itemCode||'',
      p.manufacturer||'',p.supplier||'',p.displayQty||'',p.unit||'',
      p.expiryDate||'',p.containerFrom||'',p.containerTo||'',p.codeRaw||'',
      p.infoMatch||'',p.mixed||'',p.actualQty||'',p.qtyResult||'',
      '','','',p.finalResult||'',p.note||'',p.inspector||'',
      photoUrl,itemPhotoUrls,p.ocrRaw||'',
      p.labelMatch||'',p.vendorProduct||'',p.vendorQty||'',
      p.vendorProdDate||'',p.vendorProdTime||'',p.vendorLotNo||'',p.vendorLine||'',
      vendorPhotoUrl,p.vendorOcrRaw||'',p.vendorPalletNo||''
    ];
    // 색인을 먼저 쓰고 기록 행을 마지막에 쓴다. 중간에 예외가 나도 재전송이 같은 ID로 이어 쓰므로
    // 기록이 두 번 생기거나(색인 누락) 색인만 남아 유실되는 일이 없다.
    if(requestId&&!resumeId)v58RememberRequest_(requestId,id);
    if(inboundNo&&currentSeq)v58RememberPallet_(inboundNo,currentSeq,id);
    mark('writeIndex');

    sheet.getRange(sheet.getLastRow()+1,1,1,row.length).setValues([row]);
    if(requestId)v58MarkRequestDone_(requestId,id);
    try{CacheService.getScriptCache().remove('v22_dashboard');}catch(e){}
    mark('writeRecord');

    // 구간별 소요시간을 AuditLog에도 남긴다. 현장에서 14 Pallet을 돌린 뒤
    // 시트만 열어보면 어느 구간이 느린지 바로 보인다. (폰 콘솔을 볼 필요 없음)
    T.serverMs=Date.now()-T0;
    saved={ok:true,id:id,photoUrl:photoUrl,vendorPhotoUrl:vendorPhotoUrl,itemPhotoUrls:itemPhotoUrls,requestId:requestId,timing:T};
  } finally {lock.releaseLock();}
  // 감사기록은 Lock을 놓은 뒤 appendRow(원자적)로 남긴다. Lock 안 왕복이 19회 → 13회로 줄어 동시 저장 대기가 짧아진다.
  appendAuditUnlocked_('V58저장',saved.id,{actor:p.inspector||'',meta:{requestId:requestId,inboundNo:inboundNo,palletNo:currentSeq,timing:T}});
  T.totalMs=Date.now()-T0;
  return saved;
}
function appendAuditUnlocked_(action, recordId, detail) {
  try {
    const ss=getSs_(),now=new Date(),d=(detail&&typeof detail==='object')?detail:{};
    const sh=ss.getSheetByName('Audit');if(sh)sh.appendRow([now,action||'',recordId||'',JSON.stringify(detail||{})]);
    const log=ss.getSheetByName('AuditLog');if(log)log.appendRow([Utilities.getUuid(),now,action||'',recordId||'',d.actor||'',d.reason||'',JSON.stringify(d.before||d.snapshot||{}),JSON.stringify(d.after||d.changes||{}),JSON.stringify(d.meta||d.photos||{}),BACKEND_VERSION]);
  } catch (e) {}
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
    '', '', '', '', '', '', '', '', '', ''
  ]);

  if (pallets.length > 0) {
    const rows = pallets.map(function (pl, i) {
      return [id, i + 1, pl.code || '', pl.inboundNo || '', pl.containerNo || '',
        pl.itemCode || '', pl.product || '', pl.supplier || '', pl.qty || '', pl.unit || '',
        pl.mismatch ? '이종' : '정상',
        pl.wmsPhotoUrl || '', pl.vendorPhotoUrl || '', pl.vendorProduct || '',
        pl.matchResult || '', pl.scanTime || '', pl.note || '', pl.wmsPalletNo || pl.containerNo || '', pl.vendorPalletNo || ''];
    });
    palletSheet.getRange(palletSheet.getLastRow() + 1, 1, rows.length, PALLET_HEADERS.length).setValues(rows);
  }

  try{CacheService.getScriptCache().remove('v22_dashboard');}catch(e){}
  return { ok: true, id: id, total: total, mixedCount: mixedCount, photoUrl: photoUrl, itemPhotoUrls: itemPhotoUrls };
}



// appendRow()는 호출마다 시트 flush를 강제해서 왕복이 길다. 감사기록은
// 2개 시트에 쓰므로 저장 1건에 그만큼이 붙는다. 내용은 그대로 두고
// getRange().setValues() 로 바꿔 flush 왕복을 줄인다.
// 시트 핸들도 SHEET_MEM_ 캐시를 타게 한다.
function appendAudit_(action, recordId, detail) {
  try {
    const ss=getSs_();
    const now=new Date();

    let sh=SHEET_MEM_['Audit'];
    if(sh===undefined){sh=ss.getSheetByName('Audit');SHEET_MEM_['Audit']=sh;}
    if(sh){
      sh.getRange(sh.getLastRow()+1,1,1,4)
        .setValues([[now, action || '', recordId || '', typeof detail==='string'?detail:JSON.stringify(detail||{})]]);
    }

    let log=SHEET_MEM_['AuditLog'];
    if(log===undefined){log=ss.getSheetByName('AuditLog');SHEET_MEM_['AuditLog']=log;}
    if(log){
      const d=(detail&&typeof detail==='object')?detail:{};
      log.getRange(log.getLastRow()+1,1,1,10)
        .setValues([[Utilities.getUuid(),now,action||'',recordId||'',d.actor||'',d.reason||'',JSON.stringify(d.before||d.snapshot||{}),JSON.stringify(d.after||d.changes||{}),JSON.stringify(d.meta||d.photos||{}),BACKEND_VERSION]]);
    }
  } catch (e) {}
}

function updateRecord_(p) {
  const id=String(p.id||'').trim(), actor=String(p.actor||'').trim(), reason=String(p.reason||'').trim(), changes=p.changes||{};
  if(!id||!actor||!reason)return {ok:false,message:'기록 ID, 수정자, 수정 사유는 필수입니다.'};
  const lock=LockService.getScriptLock();lock.waitLock(15000);
  try{
    const ss=getSs_(),sh=ss.getSheetByName('Records'),last=sh.getLastRow();if(last<2)return {ok:false,message:'기록이 없습니다.'};
    const hit=sh.getRange(2,1,last-1,1).createTextFinder(id).matchEntireCell(true).findNext();if(!hit)return {ok:false,message:'기록을 찾을 수 없습니다.'};
    const rowNo=hit.getRow(),idx={};RECORD_HEADERS.forEach(function(h,i){idx[h]=i;});const row=sh.getRange(rowNo,1,1,RECORD_HEADERS.length).getValues()[0];
    const oldInboundNo=String(row[idx['입고번호']]||'').trim();
    const oldPalletNo=String(row[idx['용기번호시작']]||'').trim();
    if(String(row[idx['모드']]||'').indexOf('다중')===0)return {ok:false,message:'다중 파레트 기록은 현재 수정 보류 상태입니다.'};
    const map={inboundNo:'입고번호',inboundDate:'입고일자',product:'품명',itemCode:'품목코드',manufacturer:'제조원',supplier:'공급업체',displayQty:'표시수량',unit:'단위',expiryDate:'사용기한',containerFrom:'용기번호시작',containerTo:'용기번호종료',actualQty:'실제확인수량',finalResult:'최종결과',vendorProduct:'업체라벨품명',vendorQty:'업체라벨수량',vendorProdDate:'업체생산일자',vendorProdTime:'업체생산시간',vendorLotNo:'업체Lot번호',vendorPalletNo:'업체파레트No',vendorLine:'업체생산라인',note:'특이사항',inspector:'검수자'};
    const before={},after={},diff={};Object.keys(map).forEach(function(k){if(Object.prototype.hasOwnProperty.call(changes,k)&&idx[map[k]]!==undefined){const col=idx[map[k]];before[k]=row[col];after[k]=changes[k];if(String(before[k]??'')!==String(after[k]??'')){row[col]=after[k];diff[k]={before:before[k],after:after[k]};}}});
    if(!Object.keys(diff).length)return {ok:false,message:'변경된 항목이 없습니다.'};
    // 수량 수정 시 판정이 이전 값과 어긋나지 않도록 재계산한다.
    const dq=Number(String(row[idx['표시수량']]||'').replace(/,/g,''));
    const aq=Number(String(row[idx['실제확인수량']]||'').replace(/,/g,''));
    if(dq>0&&aq>0){
      row[idx['수량판정']]=(dq===aq?'일치':'불일치');
      if(dq!==aq)row[idx['최종결과']]='확인필요';
    }
    const newInboundNo=String(row[idx['입고번호']]||'').trim();
    const newPalletNo=String(row[idx['용기번호시작']]||'').trim();
    if(oldInboundNo!==newInboundNo || String(oldPalletNo).replace(/[^0-9]/g,'')!==String(newPalletNo).replace(/[^0-9]/g,'')){
      const conflict=v58FindPallet_(newInboundNo,newPalletNo);
      if(conflict&&conflict!==id&&!v58IsSoftDeleted_(conflict)){
        return {ok:false,code:'PALLET_DUPLICATE',message:'수정하려는 관리번호/Pallet 순번이 이미 다른 기록에 사용 중입니다.',duplicateId:conflict};
      }
    }
    sh.getRange(rowNo,1,1,RECORD_HEADERS.length).setValues([row]);
    if(oldInboundNo!==newInboundNo || String(oldPalletNo).replace(/[^0-9]/g,'')!==String(newPalletNo).replace(/[^0-9]/g,'')){
      v58RemovePalletIndexByRecord_(id);
      if(newInboundNo&&newPalletNo)v58RememberPallet_(newInboundNo,newPalletNo,id);
    }
    appendAudit_('기록수정',id,{actor:actor,reason:reason,changes:diff});try{CacheService.getScriptCache().remove('v22_dashboard');}catch(e){}
    return {ok:true,id:id,changed:Object.keys(diff).length};
  } finally {lock.releaseLock();}
}

function collectRecordPhotoUrls_(ss,id,row,idx) {
  const urls=[];const add=function(v){String(v||'').split(',').map(function(x){return x.trim();}).filter(Boolean).forEach(function(x){if(urls.indexOf(x)<0)urls.push(x);});};
  add(row[idx['라벨사진URL']]);add(row[idx['업체라벨사진URL']]);add(row[idx['실물사진URL']]);
  const ps=ss.getSheetByName('PalletDetails');if(ps&&ps.getLastRow()>=2){const pidx={};PALLET_HEADERS.forEach(function(h,i){pidx[h]=i;});const hits=ps.getRange(2,1,ps.getLastRow()-1,1).createTextFinder(id).matchEntireCell(true).findAll();hits.forEach(function(h){const pr=ps.getRange(h.getRow(),1,1,PALLET_HEADERS.length).getValues()[0];add(pr[pidx['WMS라벨사진URL']]);add(pr[pidx['업체라벨사진URL']]);});}
  return urls;
}

function deleteDrivePhotoUrl_(url) {
  const id=driveFileIdFromUrl_(url);if(!id)return {ok:false,url:url,error:'파일 ID 확인 실패'};
  try{Drive.Files.remove(id);return {ok:true,url:url,id:id};}catch(e){try{DriveApp.getFileById(id).setTrashed(true);return {ok:true,url:url,id:id,trashed:true};}catch(e2){return {ok:false,url:url,id:id,error:String(e2.message||e2)};}}
}

// [보안] deleteRecord_(p)는 {role:'admin'}을 스스로 만들어 넘겨 인증을 우회합니다.
// 2026-10-01에 제거했는데 V58 병합 과정에서 되살아났습니다. 호출자는 없지만
// 누군가 무심코 연결하면 그 순간 누구나 삭제 가능해지므로 다시 제거합니다.
// 삭제는 doPost -> authorizeSessionV24_ -> deleteRecordV23_(p, auth) 경로만 사용합니다.

function getDashboard_() {
  const cache=CacheService.getScriptCache();
  try{const c=cache.get('v22_dashboard');if(c)return JSON.parse(c);}catch(e){}
  const out=getDashboardUncached_();
  try{cache.put('v22_dashboard',JSON.stringify(out),30);}catch(e){}
  return out;
}

/* ==================== V22 helpers ==================== */
function getProductionSession_(id) {
  if(!id)return {ok:false,message:'작업 ID가 없습니다.'};
  const ss=getSs_(),prod=ss.getSheetByName('Production'),row=findProductionRow_(prod,id);if(!row)return {ok:false,message:'작업을 찾을 수 없습니다.'};
  const idx={};PRODUCTION_HEADERS.forEach(function(h,i){idx[h]=i;});const cur=prod.getRange(row,1,1,PRODUCTION_HEADERS.length).getValues()[0];
  const ps=ss.getSheetByName('ProductionPallets'),pidx={};PRODUCTION_PALLET_HEADERS.forEach(function(h,i){pidx[h]=i;});const pallets=[];const last=ps.getLastRow();
  if(last>=2){
    const hits=ps.getRange(2,1,last-1,1).createTextFinder(String(id)).matchEntireCell(true).findAll();
    hits.forEach(function(h){const r=ps.getRange(h.getRow(),1,1,PRODUCTION_PALLET_HEADERS.length).getValues()[0];pallets.push({productionId:r[pidx['Production ID']],seq:r[pidx['순번']],inboundNo:r[pidx['입고번호']],containerNo:r[pidx['용기번호']],code:r[pidx['Barcode/QR']],product:r[pidx['품명']],itemCode:r[pidx['품목코드']],qty:r[pidx['수량']],unit:r[pidx['단위']],result:r[pidx['검수결과']],recordId:r[pidx['검수기록ID']],worker:r[pidx['작업자']],registeredAt:r[pidx['등록시각']]});});
  }
  const workers=String(cur[idx['작업자목록']]||cur[idx['등록자']]||'').split(',').map(function(x){return x.trim();}).filter(Boolean);
  return {ok:true,id:cur[idx['ID']],productName:cur[idx['제품명']],lotNo:cur[idx['제조번호']],palletCount:Number(cur[idx['투입파레트수']])||0,total:Number(cur[idx['투입총수량']])||0,status:cur[idx['상태']]||'',closed:String(cur[idx['상태']])==='종료',workers:workers,pallets:pallets};
}

function batchGetRecords_(ids) {
  ids=(ids||[]).map(String).filter(Boolean).slice(0,100);if(!ids.length)return {ok:false,message:'선택된 기록이 없습니다.'};
  const items=[];ids.forEach(function(id){const x=getRecord_(id);if(x&&x.ok)items.push({record:x.record,pallets:x.pallets||[]});});
  return {ok:true,items:items};
}

function driveFileIdFromUrl_(url) {
  const s=String(url||'');let m=s.match(/\/d\/([A-Za-z0-9_-]{15,})/);if(m)return m[1];m=s.match(/[?&]id=([A-Za-z0-9_-]{15,})/);if(m)return m[1];
  // 저장된 URL이 file.getUrl 형식이면 /file/d/<id>/view
  m=s.match(/\/file\/d\/([A-Za-z0-9_-]{15,})/);return m?m[1]:'';
}

function photoDataBatch_(urls) {
  const out={};let total=0;urls=(urls||[]).map(String).filter(Boolean).slice(0,8);
  urls.forEach(function(url){
    try{
      const id=driveFileIdFromUrl_(url);if(!id)return;const blob=DriveApp.getFileById(id).getBlob();const bytes=blob.getBytes();
      if(bytes.length>1800000 || total+bytes.length>8000000)return;total+=bytes.length;
      out[url]='data:'+(blob.getContentType()||'image/jpeg')+';base64,'+Utilities.base64Encode(bytes);
    }catch(e){}
  });
  return {ok:true,items:out};
}

/* ==================== V58 저장/보고서 안정화 ==================== */
function v58BackendCapabilities_(auth){
  return {ok:true,version:V58_BACKEND_VERSION,idempotency:true,organizedPhotos:true,reportManagement:true,backendReady:PropertiesService.getScriptProperties().getProperty('V58_BACKEND_READY')==='1',palletIndex:v58PalletIndexReady_(),role:(auth&&auth.role)||'worker'};
}

function v58ReportCapabilities_(auth){
  const mgr=atLeastV24_(auth,'manager');
  return {ok:true,edit:mgr,softDelete:mgr,restore:mgr,audit:mgr,role:roleOfV24_(auth&&auth.role)};
}

function v58SafeName_(s){
  return String(s||'').trim().replace(/[\\/:*?"<>|#%{}~&]/g,'_').replace(/\s+/g,'_').slice(0,80);
}
function v58FolderCacheKey_(parentId,name){
  return ('v58_folder_'+String(parentId||'')+'_'+String(name||'')).replace(/[^a-zA-Z0-9_\-]/g,'_').slice(0,240);
}
function v58GetOrCreateChildCached_(parent,name){
  const safe=v58SafeName_(name)||'UNKNOWN',key=v58FolderCacheKey_(parent.getId(),safe);
  try{const id=CacheService.getScriptCache().get(key);if(id)return DriveApp.getFolderById(id);}catch(e){}
  const it=parent.getFoldersByName(safe),folder=it.hasNext()?it.next():parent.createFolder(safe);
  try{CacheService.getScriptCache().put(key,folder.getId(),21600);}catch(e){}
  return folder;
}
function v58PhotoFolder_(meta){
  const root=getPhotoFolder_(),tz=Session.getScriptTimeZone()||'Asia/Seoul';
  let dateKey=String(meta&&meta.dateKey||'').replace(/[^0-9]/g,'');
  if(dateKey.length!==8)dateKey=Utilities.formatDate(new Date(),tz,'yyyyMMdd');
  const inbound=v58SafeName_(meta&&meta.inboundNo||'NO_INBOUND');
  const pallet=v58SafeName_(meta&&meta.palletNo||'NO_PALLET');
  return v58GetOrCreateChildCached_(v58GetOrCreateChildCached_(v58GetOrCreateChildCached_(root,dateKey),inbound),'Pallet_'+pallet);
}
function v58SavePhoto_(dataUrl,fileName,meta){
  if(!dataUrl)return '';
  try{
    const m=String(dataUrl).match(/^data:(image\/[a-zA-Z0-9.+-]+)[^,]*;base64,([\s\S]*)$/);if(!m)return '';
    const ct=m[1],bytes=Utilities.base64Decode(m[2]),ext=ct.split('/')[1]||'jpg';
    let base=v58SafeName_(fileName||('photo_'+Date.now())).replace(/\.(jpg|jpeg|png|webp)$/i,'');
    const blob=Utilities.newBlob(bytes,ct,base+'.'+ext);
    return v58PhotoFolder_(meta||{}).createFile(blob).getUrl();
  }catch(e){try{console.error('사진 저장 실패',String(e&&e.message||e));}catch(_){}return '';}
}

function v58EnsureSheet_(name,headers){return ensureSheet_(getSs_(),name,headers);}
/** 캐시만 조회. 시트를 건드리지 않는다. */
function v58FindRequestCached_(requestId){
  const key=String(requestId||'').trim();if(!key)return '';
  try{return CacheService.getScriptCache().get('V58REQ_'+key)||'';}catch(e){return '';}
}

// requestId 중복방지는 오래된 Queue 재전송까지 보장해야 하므로
// 행 수로 검색 범위를 제한하지 않는다. 먼저 ScriptCache를 확인하고,
// cache miss일 때만 SaveRequestIndex 전체에서 정확히 1회 검색한다.
function v58FindRequest_(requestId){
  const key=String(requestId||'').trim();if(!key)return '';
  const cached=v58FindRequestCached_(key);if(cached)return cached;
  const sh=v58EnsureSheet_('SaveRequestIndex',V58_REQUEST_INDEX_HEADERS);
  const last=sh.getLastRow();if(last<2)return '';
  const hit=sh.getRange(2,1,last-1,1).createTextFinder(key).matchEntireCell(true).findNext();if(!hit)return '';
  const id=String(sh.getRange(hit.getRow(),2).getValue()||'');
  try{if(id)CacheService.getScriptCache().put('V58REQ_'+key,id,21600);}catch(e){}
  return id;
}
function v58RememberRequest_(requestId,recordId){
  const key=String(requestId||'').trim(),id=String(recordId||'').trim();if(!key||!id)return;
  const sh=v58EnsureSheet_('SaveRequestIndex',V58_REQUEST_INDEX_HEADERS);sh.getRange(sh.getLastRow()+1,1,1,3).setValues([[key,id,new Date()]]);
  try{CacheService.getScriptCache().put('V58REQ_'+key,id,21600);}catch(e){}
}
function v58PalletKey_(inboundNo,palletNo){
  const a=String(inboundNo||'').trim(),b=String(palletNo||'').replace(/[^0-9]/g,'');return a&&b?a+'|'+b:'';
}
function v58FindPallet_(inboundNo,palletNo){
  const key=v58PalletKey_(inboundNo,palletNo);if(!key)return '';
  try{const x=CacheService.getScriptCache().get('V58PAL_'+key);if(x)return x;}catch(e){}
  const sh=v58EnsureSheet_('PalletSaveIndex',V58_PALLET_INDEX_HEADERS);if(sh.getLastRow()<2)return '';
  const hit=sh.getRange(2,1,sh.getLastRow()-1,1).createTextFinder(key).matchEntireCell(true).findNext();if(!hit)return '';
  const id=String(sh.getRange(hit.getRow(),2).getValue()||'');try{if(id)CacheService.getScriptCache().put('V58PAL_'+key,id,21600);}catch(e){}return id;
}
function v58RememberPallet_(inboundNo,palletNo,recordId){
  const key=v58PalletKey_(inboundNo,palletNo),id=String(recordId||'').trim();if(!key||!id)return;
  const sh=v58EnsureSheet_('PalletSaveIndex',V58_PALLET_INDEX_HEADERS);
  // 호출 직전에 saveSingleRecord_ 가 이미 v58FindPallet_ 로 중복을 확인했다.
  // 여기서 또 조회하면 PalletSaveIndex 전체를 한 번 더 훑게 되므로,
  // 캐시에 같은 값이 있을 때만 건너뛰고 시트 재검색은 하지 않는다.
  try{
    const cached=CacheService.getScriptCache().get('V58PAL_'+key);
    if(cached===id)return;
  }catch(e){}
  sh.getRange(sh.getLastRow()+1,1,1,3).setValues([[key,id,new Date()]]);try{CacheService.getScriptCache().put('V58PAL_'+key,id,21600);}catch(e){}
}
function v58RecordExists_(id){
  const sh=getSs_().getSheetByName('Records');if(!id||!sh||sh.getLastRow()<2)return false;
  return !!sh.getRange(2,1,sh.getLastRow()-1,1).createTextFinder(String(id)).matchEntireCell(true).findNext();
}
function v58MarkRequestDone_(requestId,id){try{CacheService.getScriptCache().put('V58DONE_'+requestId,id,21600);}catch(e){}}
// 색인이 가리키는 기록이 실제로 있는지 확인한다(중복으로 판정될 때만 드는 비용). 중단된 저장이 남긴 색인은 건너뛴다.
function v58FindPalletVerified_(inboundNo,palletNo,resumeId){
  const first=v58FindPallet_(inboundNo,palletNo);if(!first)return '';
  if(first!==resumeId&&v58RecordExists_(first))return first;
  const key=v58PalletKey_(inboundNo,palletNo),sh=v58EnsureSheet_('PalletSaveIndex',V58_PALLET_INDEX_HEADERS),last=sh.getLastRow();if(last<2)return '';
  const hits=sh.getRange(2,1,last-1,1).createTextFinder(key).matchEntireCell(true).findAll();
  for(let i=hits.length-1;i>=0;i--){const id=String(sh.getRange(hits[i].getRow(),2).getValue()||'');if(id&&id!==resumeId&&id!==first&&v58RecordExists_(id)){try{CacheService.getScriptCache().put('V58PAL_'+key,id,21600);}catch(e){}return id;}}
  return '';
}
function v58RemovePalletIndexByRecord_(recordId){
  const sh=v58EnsureSheet_('PalletSaveIndex',V58_PALLET_INDEX_HEADERS);if(sh.getLastRow()<2)return;
  const hits=sh.getRange(2,2,sh.getLastRow()-1,1).createTextFinder(String(recordId||'')).matchEntireCell(true).findAll();
  const rows=hits.map(function(h){return h.getRow();}).sort(function(a,b){return b-a;});
  rows.forEach(function(r){const key=String(sh.getRange(r,1).getValue()||'');sh.deleteRow(r);try{CacheService.getScriptCache().remove('V58PAL_'+key);}catch(e){}});
}
function v58PalletIndexReady_(){return scriptProp_('V58_PALLET_INDEX_READY')==='1';}
function v58BuildPalletIndexFromRecords_(){
  const ss=getSs_(),rs=ss.getSheetByName('Records'),sh=v58EnsureSheet_('PalletSaveIndex',V58_PALLET_INDEX_HEADERS),idx={};RECORD_HEADERS.forEach(function(h,i){idx[h]=i;});
  const data=rs.getDataRange().getValues(),seen={},rows=[];
  for(let i=data.length-1;i>=1;i--){
    const r=data[i];if(String(r[idx['모드']]||'')!=='단건')continue;const id=String(r[idx['ID']]||'');if(v58IsSoftDeleted_(id))continue;
    const key=v58PalletKey_(r[idx['입고번호']],r[idx['용기번호시작']]);if(!key||!id||seen[key])continue;seen[key]=1;rows.push([key,id,new Date()]);
  }
  if(sh.getLastRow()>1)sh.getRange(2,1,sh.getLastRow()-1,3).clearContent();if(rows.length)sh.getRange(2,1,rows.length,3).setValues(rows);
  PropertiesService.getScriptProperties().setProperty('V58_PALLET_INDEX_READY','1');return {ok:true,count:rows.length};
}

function v58InvalidateSoftDeletedCache_(){V58_SOFT_DELETED_MEM_=null;try{CacheService.getScriptCache().remove('V58_SOFT_DELETED');}catch(e){}}
function v58SoftDeletedMap_(){
  if(V58_SOFT_DELETED_MEM_)return V58_SOFT_DELETED_MEM_;
  try{const raw=CacheService.getScriptCache().get('V58_SOFT_DELETED');if(raw){V58_SOFT_DELETED_MEM_=JSON.parse(raw);return V58_SOFT_DELETED_MEM_;}}catch(e){}
  const sh=v58EnsureSheet_('SoftDeletedRecords',V58_SOFT_DELETED_HEADERS),m={};if(sh.getLastRow()>=2){
    sh.getRange(2,1,sh.getLastRow()-1,6).getValues().forEach(function(r){const id=String(r[0]||'');if(id&&r[1]&&!r[4])m[id]={deletedAt:r[1],reason:r[2],actor:r[3]};});
  }
  V58_SOFT_DELETED_MEM_=m;try{CacheService.getScriptCache().put('V58_SOFT_DELETED',JSON.stringify(m),300);}catch(e){}return m;
}
function v58IsSoftDeleted_(id){return !!v58SoftDeletedMap_()[String(id||'')];}
function v58RecordInfo_(id){
  const sh=getSs_().getSheetByName('Records');if(!sh||sh.getLastRow()<2)return null;const hit=sh.getRange(2,1,sh.getLastRow()-1,1).createTextFinder(String(id||'')).matchEntireCell(true).findNext();
  if(!hit)return null;const idx={};RECORD_HEADERS.forEach(function(h,i){idx[h]=i;});return {sheet:sh,row:hit.getRow(),values:sh.getRange(hit.getRow(),1,1,RECORD_HEADERS.length).getValues()[0],idx:idx};
}
function v58ProductionLinked_(id){
  const ss=getSs_(),sh=ss.getSheetByName('ProductionPallets');if(!sh||sh.getLastRow()<2)return false;const idx={};PRODUCTION_PALLET_HEADERS.forEach(function(h,i){idx[h]=i;});const col=idx['검수기록ID'];if(col===undefined)return false;
  return !!sh.getRange(2,col+1,sh.getLastRow()-1,1).createTextFinder(String(id||'')).matchEntireCell(true).findNext();
}
function v58SoftDeleteRecords_(p,auth){
  if(!atLeastV24_(auth,'manager'))return {ok:false,code:'ROLE_REQUIRED',message:'중간관리자 이상 권한이 필요합니다.'};
  return v58SoftDeleteCore_(p,auth);
}
// 권한 확인은 부르는 쪽에서 한다 (v58SoftDeleteRecords_: 중간관리자, r15RecordDelete_: 본인 당일 기록)
function v58SoftDeleteCore_(p,auth){
  const ids=(p.ids||[]).map(String).filter(Boolean),reason=String(p.reason||'').trim(),actor=String(p.actor||actorLabelV24_(auth));
  if(!ids.length)return {ok:false,message:'삭제할 기록이 없습니다.'};if(!reason)return {ok:false,message:'삭제 사유가 필요합니다.'};
  const lock=LockService.getScriptLock();if(!lock.tryLock(10000))return {ok:false,message:'다른 작업이 진행 중입니다. 다시 시도하세요.'};
  try{
    const sh=v58EnsureSheet_('SoftDeletedRecords',V58_SOFT_DELETED_HEADERS),active=v58SoftDeletedMap_(),rows=[],failed=[];
    ids.forEach(function(id){
      if(active[id])return;if(v58ProductionLinked_(id)){failed.push({id:id,reason:'생산 투입 기록 연결'});return;}const info=v58RecordInfo_(id);if(!info){failed.push({id:id,reason:'기록 없음'});return;}
      rows.push([id,new Date(),reason,actor,'','']);appendAudit_('기록SoftDelete',id,{actor:actor,reason:reason,before:rowObjectV23_(RECORD_HEADERS,info.values)});v58RemovePalletIndexByRecord_(id);
    });
    if(rows.length)sh.getRange(sh.getLastRow()+1,1,rows.length,6).setValues(rows);if(rows.length)v58InvalidateSoftDeletedCache_();try{CacheService.getScriptCache().remove('v22_dashboard');}catch(e){}
    return {ok:true,count:rows.length,failed:failed};
  }finally{lock.releaseLock();}
}
function v58RestoreRecords_(p,auth){
  if(!atLeastV24_(auth,'manager'))return {ok:false,code:'ROLE_REQUIRED',message:'중간관리자 이상 권한이 필요합니다.'};
  return v58RestoreCore_(p,auth);
}
// 권한 확인은 부르는 쪽에서 한다 (v58RestoreRecords_: 중간관리자, r15RecordRestore_: 본인이 오늘 지운 기록)
function v58RestoreCore_(p,auth){
  const ids=(p.ids||[]).map(String).filter(Boolean),actor=String(p.actor||actorLabelV24_(auth));if(!ids.length)return {ok:false,message:'복구할 기록이 없습니다.'};
  const lock=LockService.getScriptLock();if(!lock.tryLock(10000))return {ok:false,message:'다른 작업이 진행 중입니다. 다시 시도하세요.'};
  try{
    const sh=v58EnsureSheet_('SoftDeletedRecords',V58_SOFT_DELETED_HEADERS);if(sh.getLastRow()<2)return {ok:true,count:0,failed:[]};
    const vals=sh.getRange(2,1,sh.getLastRow()-1,6).getValues(),failed=[];let count=0;
    vals.forEach(function(r,i){
      const id=String(r[0]||'');if(ids.indexOf(id)<0||!r[1]||r[4])return;const info=v58RecordInfo_(id);if(!info){failed.push({id:id,reason:'원본 기록 없음'});return;}
      const inbound=info.values[info.idx['입고번호']],pal=info.values[info.idx['용기번호시작']],other=v58FindPallet_(inbound,pal);if(other&&other!==id&&!v58IsSoftDeleted_(other)){failed.push({id:id,reason:'동일 Pallet의 새 기록이 이미 존재'});return;}
      sh.getRange(i+2,5,1,2).setValues([[new Date(),actor]]);v58RememberPallet_(inbound,pal,id);appendAudit_('기록복구',id,{actor:actor,reason:String(p.reason||'복구')});count++;
    });
    if(count)v58InvalidateSoftDeletedCache_();try{CacheService.getScriptCache().remove('v22_dashboard');}catch(e){}return {ok:true,count:count,failed:failed};
  }finally{lock.releaseLock();}
}
function v58ListSoftDeletedRecords_(auth){
  if(!atLeastV24_(auth,'manager'))return {ok:false,code:'ROLE_REQUIRED',message:'중간관리자 이상 권한이 필요합니다.'};
  const sh=v58EnsureSheet_('SoftDeletedRecords',V58_SOFT_DELETED_HEADERS),items=[];if(sh.getLastRow()<2)return {ok:true,items:items};
  const vals=sh.getRange(2,1,sh.getLastRow()-1,6).getValues();for(let i=vals.length-1;i>=0&&items.length<200;i--){const r=vals[i];if(!r[1]||r[4])continue;const info=v58RecordInfo_(r[0]),o=info?rowObjectV23_(RECORD_HEADERS,info.values):{};items.push({id:String(r[0]||''),deletedAt:r[1],reason:String(r[2]||''),actor:String(r[3]||''),inboundNo:o['입고번호']||'',product:o['품명']||''});}
  return {ok:true,items:items};
}
/**
 * ─────────────────────────────────────────────────────────────
 * 편집기에서 직접 실행하는 설치 함수 (밑줄 없음 = 실행 메뉴에 보임)
 *
 * Apps Script는 이름이 밑줄(_)로 끝나는 함수를 "비공개"로 보고
 * 상단 실행 메뉴의 함수 목록에서 숨깁니다. 그래서 v58InitializeBackend_ 는
 * 목록에 나타나지 않습니다. 아래 래퍼를 대신 선택해 실행하세요.
 *
 * 하는 일:
 *   - SaveRequestIndex   시트 생성 (저장 중복방지용 요청 ID 색인)
 *   - PalletSaveIndex    시트 생성 (Pallet 중복 검사 색인)
 *   - SoftDeletedRecords 시트 생성 (삭제 보관)
 *   - 기존 Records 를 훑어 PalletSaveIndex 를 1회 구축
 *
 * 여러 번 실행해도 안전합니다. 색인을 지우고 다시 만들 뿐,
 * Records 원본은 건드리지 않습니다.
 * ─────────────────────────────────────────────────────────────
 */
function v58InitializeBackend(){
  const res = v58InitializeBackend_();
  const msg = 'V58 백엔드 설치 완료\n'
    + '· 백엔드 버전: ' + (res.backendVersion || V58_BACKEND_VERSION) + '\n'
    + '· PalletSaveIndex 구축: ' + (res.palletIndex || 0) + '건\n'
    + '· 시트: SaveRequestIndex / PalletSaveIndex / SoftDeletedRecords 준비됨';
  Logger.log(msg);
  return res;
}

/** PalletSaveIndex 만 다시 만들고 싶을 때 (Records 를 손으로 고친 뒤 등). */
function v58RebuildPalletIndex(){
  const res = v58BuildPalletIndexFromRecords_();
  Logger.log('PalletSaveIndex 재구축 완료 · ' + (res.count || 0) + '건');
  return res;
}

/** 지금 백엔드가 어떤 상태인지 한 번에 확인. 아무것도 바꾸지 않습니다. */
/**
 * 저장속도 실측은 운영 Pallet 저장 응답 timing + SaveTiming/AuditLog로 확인한다.
 * 운영 DB에 임시 행을 쓰고 지우는 benchmark 함수는 배포본에서 제외했다.
 */
function v58CheckStatus(){
  const p = PropertiesService.getScriptProperties();
  const ss = getSs_();
  const names = ['Records','SaveRequestIndex','PalletSaveIndex','SoftDeletedRecords','Users','Sessions'];
  const sheets = names.map(function(n){
    const sh = ss.getSheetByName(n);
    return '  · ' + n + ': ' + (sh ? (Math.max(0, sh.getLastRow() - 1) + '행') : '없음');
  }).join('\n');
  const driveApi = (typeof Drive === 'undefined' || !Drive.Files) ? '꺼져 있음'
    : (typeof Drive.Files.create === 'function' ? 'v3' : (typeof Drive.Files.insert === 'function' ? 'v2' : '알 수 없음'));
  const msg = 'V58 백엔드 상태\n'
    + '· BACKEND_VERSION: ' + BACKEND_VERSION + '  (웹앱에서 이 값이 보이려면 반드시 "새 버전"으로 재배포)\n'
    + '· V58_BACKEND_READY: ' + (p.getProperty('V58_BACKEND_READY') === '1' ? '예' : '아니오 — v58InitializeBackend 를 실행하세요') + '\n'
    + '· PalletIndex 준비: ' + (p.getProperty('V58_PALLET_INDEX_READY') === '1' ? '예' : '아니오') + '\n'
    + '· 보안 초기화: ' + (p.getProperty('V24_SECURITY_ENABLED') === '1' ? '예' : '아니오 — setupSecurityV24 를 실행하세요') + '\n'
    + '· 고급 Drive 서비스: ' + driveApi + '\n'
    + '시트\n' + sheets;
  Logger.log(msg);
  return msg;
}

function v58InitializeBackend_(){
  const ss=getSs_();ensureSheet_(ss,'SaveRequestIndex',V58_REQUEST_INDEX_HEADERS);ensureSheet_(ss,'PalletSaveIndex',V58_PALLET_INDEX_HEADERS);ensureSheet_(ss,'SoftDeletedRecords',V58_SOFT_DELETED_HEADERS);
  const x=v58BuildPalletIndexFromRecords_();PropertiesService.getScriptProperties().setProperty('V58_BACKEND_READY','1');return {ok:true,backendVersion:V58_BACKEND_VERSION,palletIndex:x.count};
}
/* ================== END V58 저장/보고서 안정화 ================== */

function resetInitialAdminPinV24() {
  const ss = getSs_();
  const user = userRowByEmployeeV24_(ss, 'ADMIN');

  if (!user) {
    throw new Error('ADMIN 계정을 찾을 수 없습니다. setupSecurityV24()를 먼저 실행하세요.');
  }

  const idx = userIdxV24_();
  const row = user.values;

  const newPin = randomPinV24_();
  const newSalt = randomHexV24_().slice(0, 24);

  row[idx['PIN Salt']] = newSalt;
  row[idx['PIN Hash']] = pinHashV24_(newPin, newSalt);
  row[idx['실패횟수']] = 0;
  row[idx['잠금해제시각']] = '';
  row[idx['상태']] = 'ACTIVE';
  row[idx['수정일시']] = new Date();

  user.sheet
    .getRange(user.row, 1, 1, USER_HEADERS.length)
    .setValues([row]);

  revokeUserSessionsV24_(ss, row[idx['User ID']]);

  Logger.log('==============================');
  Logger.log('ADMIN 사번: ADMIN');
  Logger.log('ADMIN 새 PIN: ' + newPin);
  Logger.log('==============================');

  console.log('ADMIN 사번: ADMIN');
  console.log('ADMIN 새 PIN: ' + newPin);

  return {
    ok: true,
    employeeNo: 'ADMIN',
    pin: newPin
  };
}

/* =====================================================================
 * R15 구역 — 새 화면(v2)용 API
 * 기존 시트 구조(Records, ProductionPallets, Production, ItemMaster)를 그대로 읽는다.
 * 투입 여부는 Records에 따로 적지 않고 ProductionPallets에서 계산한다.
 * (같은 사실을 두 곳에 적으면 서로 어긋나기 때문)
 * ===================================================================== */

const R15_TZ = 'Asia/Seoul';
const R15_MEM_ = {};

function r15Get_(action, q, auth) {
  R15_MEM_.__auth = auth; // r15Public_가 기록마다 이 사용자가 고칠 수 있는지(can)를 붙인다
  if (action === 'r15Mine') return r15Mine_(auth);
  if (action === 'r15History') return r15History_(q.id);
  if (action === 'r15Audit') return r15Audit_(q, auth);
  if (action === 'r15Ping') return { ok:true, backendVersion:BACKEND_VERSION, user:publicUserV24_(auth) };
  if (action === 'r15Report') return r15Report_(q.from, q.to);
  if (action === 'r15Inbound') return r15Inbound_(q.inboundNo);
  if (action === 'r15Stock') return r15Stock_(q.days, q.itemCode);
  if (action === 'r15Trace') return r15Trace_(q.q);
  if (action === 'r15Lots') return r15Lots_();
  if (action === 'r15Lot') return r15Lot_(q.id);
  if (action === 'r15Items') return r15Items_();
  if (action === 'r15Plan') return r15Plan_();
  if (action === 'r15Pallet') return r15PalletInfo_(q.inboundNo, q.pallet);
  return { ok:false, message:'알 수 없는 action: ' + action };
}

function r15Post_(action, p, auth) {
  p = p || {};
  if (action === 'r15LotStart') { p.worker = auth.name || ''; const r = startProduction_(p); if (r && r.ok) appendAudit_(r.joined ? 'R15작업참여' : 'R15작업시작', r.id || '', { actor: actorLabelV24_(auth), after: { productName: r15S_(p.productName), lotNo: r15S_(p.lotNo) } }); return r; }
  if (action === 'r15LotAdd') return r15LotAdd_(p, auth);
  if (action === 'r15LotRemove') return r15LotRemove_(p, auth);
  if (action === 'r15LotDelete') return r15LotDelete_(p, auth);
  if (action === 'r15LotFinish') { p.registrant = auth.name || ''; p.closeSession = true; const r = finishProduction_(p); if (r && r.ok) appendAudit_('R15작업종료', r15S_(p.productionId), { actor: actorLabelV24_(auth), after: { palletCount: r.palletCount, total: r.total } }); return r; }
  if (action === 'r15AuditNote') return r15AuditNote_(p, auth);
  if (action === 'r15IssueAck') return r15IssueAck_(p, auth);
  if (action === 'r15AttachPhoto') return r15AttachPhoto_(p, auth);
  if (action === 'r15RecordEdit') return r15RecordEdit_(p, auth);
  if (action === 'r15RecordDelete') return r15RecordDelete_(p, auth);
  if (action === 'r15RecordRestore') return r15RecordRestore_(p, auth);
  if (action === 'r15ItemSave') return r15ItemSave_(p, auth);
  if (action === 'r15PlanSave') return r15PlanSave_(p, auth);
  return { ok:false, message:'알 수 없는 action: ' + action };
}

/* ---------- 값 정리 ---------- */
function r15S_(v) { return v == null ? '' : String(v).trim(); }
function r15Digits_(v) {
  // 시트가 숫자로 바꿔 저장한 값(26004733, 2002867.0)도 같은 문자열이 되게 한다
  if (typeof v === 'number') return isFinite(v) ? String(Math.round(v)) : '';
  return r15S_(v).replace(/\.0+$/, '').replace(/[^0-9]/g, '');
}
function r15Num_(v) {
  if (typeof v === 'number') return isFinite(v) ? v : 0;
  const n = Number(r15S_(v).replace(/,/g, ''));
  return isFinite(n) ? n : 0;
}
function r15Pallet_(v) { const d = r15Digits_(v); return d ? Number(d) : 0; }
function r15Key_(inboundNo, pallet) { const a = r15Digits_(inboundNo), b = r15Pallet_(pallet); return a && b ? a + '|' + b : ''; }
function r15Date_(v) {
  if (v instanceof Date) return isNaN(v.getTime()) ? null : v;
  const s = r15S_(v); if (!s) return null;
  const d = new Date(s.replace(' ', 'T')); return isNaN(d.getTime()) ? null : d;
}
function r15Fmt_(v, pattern) {
  const d = r15Date_(v); return d ? Utilities.formatDate(d, R15_TZ, pattern || 'yyyy-MM-dd') : r15S_(v);
}
function r15DayStart_(s) {
  const m = r15S_(s).match(/^(\d{4})-(\d{2})-(\d{2})$/); if (!m) return null;
  return new Date(m[1] + '-' + m[2] + '-' + m[3] + 'T00:00:00+09:00');
}
function r15NormName_(s) {
  return r15S_(s).toLowerCase().replace(/㎖/g, 'ml').replace(/(\d)o(?=\d|ml)/g, '$10').replace(/[()（）\s\-_.,·]/g, '');
}
function r15Idx_(headers) { const x = {}; headers.forEach(function(h, i) { x[h] = i; }); return x; }
function r15SheetValues_(name) {
  if (R15_MEM_[name]) return R15_MEM_[name];
  const sh = getSs_().getSheetByName(name);
  const vals = sh && sh.getLastRow() >= 1 ? sh.getDataRange().getValues() : [];
  R15_MEM_[name] = vals; return vals;
}
function r15Forget_(name) { delete R15_MEM_[name]; }
function r15HeaderIdx_(vals, fallback) {
  // 시트 첫 줄 실제 헤더 기준으로 찾는다. 열 순서가 바뀌어도 맞게 읽기 위함
  const x = {}; const head = vals[0] || fallback; head.forEach(function(h, i) { x[String(h).trim()] = i; });
  fallback.forEach(function(h, i) { if (x[h] === undefined) x[h] = i; });
  return x;
}

/* ---------- 기준 데이터 읽기 ---------- */
function r15Items_() {
  const vals = r15SheetValues_('ItemMaster'); if (!vals.length) return { ok:true, items:[] };
  const i = r15HeaderIdx_(vals, ITEM_MASTER_HEADERS), items = [];
  for (let n = 1; n < vals.length; n++) {
    const r = vals[n], code = r15Digits_(r[i['자재코드']]); if (!code) continue;
    items.push({
      itemCode: code, category: r15S_(r[i['자재구분']]), itemName: r15S_(r[i['자재명']]),
      suppliers: r15S_(r[i['공급업체목록']]).split(',').map(r15S_).filter(String),
      aliases: r15S_(r[i['업체품명별칭']]).split(',').map(r15S_).filter(String),
      volume: r15S_(r[i['용량']])
    });
  }
  return { ok:true, items:items };
}
function r15ItemMap_() {
  if (R15_MEM_.__items) return R15_MEM_.__items;
  const m = {}; r15Items_().items.forEach(function(it) { m[it.itemCode] = it; });
  R15_MEM_.__items = m; return m;
}

function r15Records_() {
  if (R15_MEM_.__records) return R15_MEM_.__records;
  const vals = r15SheetValues_('Records'), out = [];
  if (vals.length < 2) { R15_MEM_.__records = out; return out; }
  const i = r15HeaderIdx_(vals, RECORD_HEADERS), deleted = v58SoftDeletedMap_(), items = r15ItemMap_();
  for (let n = 1; n < vals.length; n++) {
    const r = vals[n], id = r15S_(r[i['ID']]); if (!id || deleted[id]) continue;
    const at = r15Date_(r[i['등록일시']]), itemCode = r15Digits_(r[i['품목코드']]), item = items[itemCode];
    out.push({
      id: id, row: n + 1, at: at ? at.getTime() : 0, atText: at ? Utilities.formatDate(at, R15_TZ, 'yyyy-MM-dd HH:mm') : r15S_(r[i['등록일시']]),
      day: at ? Utilities.formatDate(at, R15_TZ, 'yyyy-MM-dd') : '',
      mode: r15S_(r[i['모드']]), inboundNo: r15Digits_(r[i['입고번호']]), pallet: r15Pallet_(r[i['용기번호시작']]),
      inboundDate: r15Fmt_(r[i['입고일자']]), expiryDate: r15Fmt_(r[i['사용기한']]),
      itemCode: itemCode, productRaw: r15S_(r[i['품명']]), product: item && item.itemName ? item.itemName : r15S_(r[i['품명']]),
      manufacturer: r15S_(r[i['제조원']]), supplier: r15S_(r[i['공급업체']]),
      qty: r15Num_(r[i['표시수량']]), actualQty: r15Num_(r[i['실제확인수량']]), unit: r15S_(r[i['단위']]) || 'EA',
      codeRaw: r15S_(r[i['대표코드']]), qtyResult: r15S_(r[i['수량판정']]), finalResult: r15S_(r[i['최종결과']]),
      labelMatch: r15S_(r[i['라벨대조']]), note: r15S_(r[i['특이사항']]), inspector: r15S_(r[i['검수자']]),
      wmsPhoto: r15S_(r[i['라벨사진URL']]), itemPhotos: r15S_(r[i['실물사진URL']]), vendorPhoto: r15S_(r[i['업체라벨사진URL']]),
      vendorProduct: r15S_(r[i['업체라벨품명']]), vendorQty: r15Num_(r[i['업체라벨수량']]),
      vendorProdDate: r15Fmt_(r[i['업체생산일자']]), vendorProdTime: r15Fmt_(r[i['업체생산시간']], 'HH:mm'),
      vendorLotNo: r15S_(r[i['업체Lot번호']]), vendorLine: r15S_(r[i['업체생산라인']]), vendorPalletNo: r15S_(r[i['업체파레트No']])
    });
  }
  R15_MEM_.__records = out; return out;
}

function r15ProdPallets_() {
  if (R15_MEM_.__pp) return R15_MEM_.__pp;
  const vals = r15SheetValues_('ProductionPallets'), out = [];
  if (vals.length >= 2) {
    const i = r15HeaderIdx_(vals, PRODUCTION_PALLET_HEADERS);
    for (let n = 1; n < vals.length; n++) {
      const r = vals[n], pid = r15S_(r[i['Production ID']]); if (!pid) continue;
      const at = r15Date_(r[i['등록시각']]);
      out.push({ row: n + 1, productionId: pid, productName: r15S_(r[i['제품명']]), lotNo: r15S_(r[i['제조번호']]), seq: r15Num_(r[i['순번']]),
        inboundNo: r15Digits_(r[i['입고번호']]), pallet: r15Pallet_(r[i['용기번호']]), code: r15S_(r[i['Barcode/QR']]),
        product: r15S_(r[i['품명']]), itemCode: r15Digits_(r[i['품목코드']]), qty: r15Num_(r[i['수량']]), unit: r15S_(r[i['단위']]),
        result: r15S_(r[i['검수결과']]), recordId: r15S_(r[i['검수기록ID']]), worker: r15S_(r[i['작업자']]),
        at: at ? at.getTime() : 0, atText: at ? Utilities.formatDate(at, R15_TZ, 'yyyy-MM-dd HH:mm') : '' });
    }
  }
  R15_MEM_.__pp = out; return out;
}

function r15Productions_() {
  const vals = r15SheetValues_('Production'), out = [];
  if (vals.length < 2) return out;
  const i = r15HeaderIdx_(vals, PRODUCTION_HEADERS);
  for (let n = 1; n < vals.length; n++) {
    const r = vals[n], id = r15S_(r[i['ID']]); if (!id || r15S_(r[i['상태']]) === '삭제') continue;
    const at = r15Date_(r[i['등록일시']]);
    out.push({ row: n + 1, id: id, at: at ? at.getTime() : 0, atText: at ? Utilities.formatDate(at, R15_TZ, 'yyyy-MM-dd HH:mm') : '',
      productName: r15S_(r[i['제품명']]), lotNo: r15S_(r[i['제조번호']]), prodDate: r15Fmt_(r[i['생산일자']]), prodQty: r15S_(r[i['생산수량']]),
      note: r15S_(r[i['비고']]), registrant: r15S_(r[i['등록자']]), status: r15S_(r[i['상태']]), workers: r15S_(r[i['작업자목록']]) });
  }
  return out;
}

/* ---------- 데이터 점검 ---------- */
// 보고서 오류의 대부분은 저장된 값 자체의 문제다. 기록마다 무엇이 틀렸는지 이름을 붙인다.
function r15Issues_(rec, ctx) {
  const out = [], add = function(code, level, label) { out.push({ code:code, level:level, label:label }); };
  if (!rec.inboundNo) add('NO_INBOUND', 'error', '입고번호 없음');
  if (!rec.pallet) add('NO_PALLET', 'error', 'Pallet 번호 없음');
  const key = r15Key_(rec.inboundNo, rec.pallet);
  if (key && ctx.dup[key] > 1) add('DUPLICATE', 'error', '같은 Pallet가 ' + ctx.dup[key] + '번 저장됨');
  const code = r15LabelCode_(rec.codeRaw);
  if (code && rec.inboundNo && rec.pallet && (rec.inboundNo.slice(-code[1].length) !== code[1] || Number(code[2]) !== rec.pallet)) add('CODE_MISMATCH', 'error', '라벨 바코드 ' + code[0] + '와 저장된 번호 다름');
  if (!rec.wmsPhoto) add('NO_WMS_PHOTO', 'error', 'WMS 라벨 사진 없음');
  if (!rec.vendorPhoto) add('NO_VENDOR_PHOTO', 'warn', '업체 라벨 사진 없음');
  if (!rec.qty) add('NO_QTY', 'warn', 'WMS 수량 없음');
  if (rec.qty && rec.vendorQty && rec.qty !== rec.vendorQty) add('QTY_MISMATCH', 'error', '수량 불일치 (WMS ' + rec.qty + ' / 업체 ' + rec.vendorQty + ')');
  const item = ctx.items[rec.itemCode];
  if (!rec.itemCode) add('NO_ITEM', 'warn', '품목코드 없음');
  else if (!item) add('UNKNOWN_ITEM', 'warn', '기준정보에 없는 품목코드 ' + rec.itemCode);
  else if (rec.productRaw && r15NormName_(rec.productRaw) !== r15NormName_(item.itemName)) add('NAME_DIFF', 'info', '저장된 품명 "' + rec.productRaw + '" → 정식명으로 표시');
  if (rec.labelMatch === '미대조') add('NOT_COMPARED', 'warn', '업체 라벨 미대조');
  if (/확인/.test(rec.finalResult) && !out.some(function(x) { return x.level === 'error'; })) add('JUDGED_CHECK', 'warn', '검수 판정 확인필요 (사유 미기록)');
  return out;
}
// WMS 라벨 바코드 값: 바코드 자체는 Code39 "260047330030"(입고번호 8 + Pallet 4, 하이픈 없음),
// 밑글자와 예전 기록은 "26004733-0030", 앞자리가 빠진 판독은 "6004733-0030". [전체, 입고번호(끝자리), Pallet]
function r15LabelCode_(v) {
  const s = r15S_(v);
  return s.match(/(\d{6,12})-0*(\d{1,6})/) || s.match(/^(\d{8})(\d{4})$/);
}
function r15Ctx_(records) {
  const dup = {}; records.forEach(function(r) { const k = r15Key_(r.inboundNo, r.pallet); if (k) dup[k] = (dup[k] || 0) + 1; });
  const used = {}; r15ProdPallets_().forEach(function(pp) { const k = r15Key_(pp.inboundNo, pp.pallet); if (k) (used[k] = used[k] || []).push(pp); });
  return { dup:dup, used:used, items:r15ItemMap_(), acks:r15AckMap_() };
}
// 저장할 때 업체 사진 없이 고른 사유 (inspect.js가 특이사항에 '업체사진 없음: …'으로 남김). '나중에 찍기'는 점검에 남는다.
const R15_NOVENDOR_OK = ['라벨 없음', '라벨 손상', '높아서 못 찍음'];
function r15NoVendorReason_(note) { const m = r15S_(note).match(/업체사진 없음: ([^/]+)/); return m ? m[1].trim() : ''; }
// 업체 라벨 사진을 나중에 붙인다. 작업자는 본인이 검수한 기록 중 사진이 없는 것만, 중간관리자 이상은 바꾸기도 가능.
function r15AttachPhoto_(p, auth) {
  const url = r15S_(p.url); if (!/^https:\/\//.test(url)) return { ok:false, message:'사진 주소가 없습니다. 사진을 먼저 올리세요.' };
  const lock = LockService.getScriptLock(); if (!lock.tryLock(15000)) return { ok:false, busy:true, retry:true, message:'잠시 후 다시 시도하세요.' };
  try {
    r15Forget_('Records'); delete R15_MEM_.__records;
    const rec = r15Records_().filter(function(r) { return r.id === r15S_(p.id); })[0]; if (!rec) return { ok:false, message:'기록을 찾을 수 없습니다.' };
    const mgr = atLeastV24_(auth, 'manager'), mine = r15S_(rec.inspector) === r15S_(auth.name);
    if (!mgr && !mine) return { ok:false, code:'ROLE_REQUIRED', message:'본인이 검수한 기록에만 사진을 붙일 수 있습니다.' };
    if (!mgr && rec.vendorPhoto) return { ok:false, code:'ROLE_REQUIRED', message:'이미 업체 사진이 있습니다. 바꾸려면 중간관리자에게 요청하세요.' };
    const sh = getSs_().getSheetByName('Records'), head = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0].map(function(h) { return String(h).trim(); });
    const col = head.indexOf('업체라벨사진URL') + 1; if (!col) return { ok:false, message:'Records 시트에 업체라벨사진URL 열이 없습니다.' };
    if (r15S_(sh.getRange(rec.row, 1).getValue()) !== rec.id) return { ok:false, retry:true, message:'기록 위치가 바뀌었습니다. 다시 시도하세요.' };
    sh.getRange(rec.row, col).setValue(url);
    r15Forget_('Records'); delete R15_MEM_.__records;
    appendAudit_('사진추가', rec.id, { actor: actorLabelV24_(auth), reason: r15S_(p.reason) || '업체 라벨 사진 추가', before: { vendorPhoto: rec.vendorPhoto || '' }, after: { vendorPhoto: url } });
    return { ok:true, url:url };
  } finally { lock.releaseLock(); }
}
// 점검 확인 처리: 사람이 보고 '문제 아님/조치함'으로 닫은 점검 항목. 기록ID|점검코드 → 마지막 처리 (취소 포함)
const R15_ACK_HEADERS = ['Record ID', '점검코드', '처리', '사유', '처리자', '일시'];
function r15AckMap_() {
  if (R15_MEM_.__acks) return R15_MEM_.__acks;
  const vals = r15SheetValues_('IssueAcks'), m = {};
  if (vals.length >= 2) { const i = r15HeaderIdx_(vals, R15_ACK_HEADERS); for (let n = 1; n < vals.length; n++) { const r = vals[n], k = r15S_(r[i['Record ID']]) + '|' + r15S_(r[i['점검코드']]); const at = r15Date_(r[i['일시']]);
    if (r15S_(r[i['처리']]) === '취소') delete m[k]; else m[k] = { reason: r15S_(r[i['사유']]), by: r15S_(r[i['처리자']]), at: at ? Utilities.formatDate(at, R15_TZ, 'yyyy-MM-dd HH:mm') : '' }; } }
  return R15_MEM_.__acks = m;
}
// ids: 기록ID 목록, codes: 점검코드 목록(비우면 그 기록의 열린 점검 전부), undo: 처리 취소
function r15IssueAck_(p, auth) {
  if (!atLeastV24_(auth, 'manager')) return { ok:false, code:'ROLE_REQUIRED', message:'점검 확인 처리는 중간관리자 이상만 할 수 있습니다. 값이 틀렸으면 기록을 고치세요.' };
  const reason = r15S_(p.reason), undo = !!p.undo; if (!reason) return { ok:false, message:'처리 사유를 적어 주세요.' };
  const ids = (p.ids || []).map(r15S_).filter(String).slice(0, 500), codes = (p.codes || []).map(r15S_).filter(String);
  if (!ids.length) return { ok:false, message:'처리할 기록을 고르세요.' };
  const all = r15Records_(), ctx = r15Ctx_(all), byId = {}; all.forEach(function(r) { byId[r.id] = r; });
  const rows = [], now = new Date(), who = actorLabelV24_(auth);
  ids.forEach(function(id) {
    const rec = byId[id]; if (!rec) return;
    r15Issues_(rec, ctx).filter(function(x) { return x.level !== 'info' && (!codes.length || codes.indexOf(x.code) >= 0) && (undo ? ctx.acks[id + '|' + x.code] : !ctx.acks[id + '|' + x.code]); })
      .forEach(function(x) { rows.push([id, x.code, undo ? '취소' : '확인', reason, who, now]); });
  });
  if (!rows.length) return { ok:true, count:0 };
  const sh = ensureSheet_(getSs_(), 'IssueAcks', R15_ACK_HEADERS); sh.getRange(sh.getLastRow() + 1, 1, rows.length, R15_ACK_HEADERS.length).setValues(rows);
  r15Forget_('IssueAcks'); delete R15_MEM_.__acks;
  const byRec = {}; rows.forEach(function(r) { (byRec[r[0]] = byRec[r[0]] || []).push(r[1]); });
  Object.keys(byRec).forEach(function(id) { appendAudit_(undo ? '점검확인취소' : '점검확인', id, { actor: who, reason: reason, after: { codes: byRec[id].join(', ') } }); });
  return { ok:true, count: rows.length, records: Object.keys(byRec).length };
}
function r15Public_(rec, ctx) {
  const k = r15Key_(rec.inboundNo, rec.pallet), uses = (ctx.used[k] || []).map(function(pp) { return { lotNo:pp.lotNo, productName:pp.productName, productionId:pp.productionId, at:pp.atText }; });
  const o = {}; Object.keys(rec).forEach(function(x) { if (x !== 'row') o[x] = rec[x]; });
  const nv = r15NoVendorReason_(rec.note);
  o.issues = r15Issues_(rec, ctx).map(function(x) {
    const a = ctx.acks && ctx.acks[rec.id + '|' + x.code]; if (a) x.acked = a;
    else if (x.code === 'NO_VENDOR_PHOTO' && nv) { if (R15_NOVENDOR_OK.indexOf(nv) >= 0) x.acked = { by: rec.inspector, reason: nv + ' (저장 시 선택)', at: rec.atText }; else x.label += ' · ' + nv; }
    return x; }); o.usedIn = uses;
  if (R15_MEM_.__auth) o.can = r15RecordPerm_(rec, R15_MEM_.__auth, uses.length > 0);
  const open = o.issues.filter(function(x) { return !x.acked; }); // 확인 처리한 점검은 등급에서 뺀다
  o.level = open.some(function(x) { return x.level === 'error'; }) ? 'error' : (open.some(function(x) { return x.level === 'warn'; }) ? 'warn' : 'ok');
  return o;
}
function r15Gaps_(pallets) {
  const nums = pallets.filter(Boolean).sort(function(a, b) { return a - b; }); if (!nums.length) return { min:0, max:0, missing:[] };
  const seen = {}; nums.forEach(function(n) { seen[n] = 1; });
  const missing = []; for (let n = nums[0]; n <= nums[nums.length - 1] && missing.length < 200; n++) if (!seen[n]) missing.push(n);
  return { min:nums[0], max:nums[nums.length - 1], missing:missing };
}
function r15InboundSummary_(no, recs) {
  recs.sort(function(a, b) { return (a.pallet - b.pallet) || (a.at - b.at); });
  const first = recs[0], gaps = r15Gaps_(recs.map(function(r) { return r.pallet; }));
  const sum = function(f) { return recs.reduce(function(t, r) { return t + (f(r) || 0); }, 0); };
  const products = {}; recs.forEach(function(r) { if (r.product) products[r.product] = 1; });
  const inspectors = {}; recs.forEach(function(r) { if (r.inspector) inspectors[r.inspector] = 1; });
  const lots = {}; recs.forEach(function(r) { r.usedIn.forEach(function(u) { lots[u.lotNo + ' ' + u.productName] = 1; }); });
  return {
    inboundNo: no, inboundDate: first.inboundDate || first.day, firstAt: recs.reduce(function(m, r) { return r.at && (!m || r.at < m) ? r.at : m; }, 0),
    days: Object.keys(recs.reduce(function(m, r) { if (r.day) m[r.day] = 1; return m; }, {})).sort(),
    itemCode: first.itemCode, product: Object.keys(products).join(', '), supplier: first.supplier, manufacturer: first.manufacturer, expiryDate: first.expiryDate,
    palletCount: recs.length, qtyTotal: sum(function(r) { return r.qty || r.vendorQty; }),
    okCount: recs.filter(function(r) { return r.level === 'ok'; }).length,
    errorCount: recs.filter(function(r) { return r.level === 'error'; }).length,
    warnCount: recs.filter(function(r) { return r.level === 'warn'; }).length,
    usedCount: recs.filter(function(r) { return r.usedIn.length; }).length,
    lots: Object.keys(lots), inspectors: Object.keys(inspectors), gaps: gaps
  };
}

/* ---------- 보고서 ---------- */
function r15Report_(from, to) {
  const start = r15DayStart_(from), endDay = r15DayStart_(to || from);
  if (!start || !endDay) return { ok:false, message:'기간(from, to)을 yyyy-MM-dd로 보내세요.' };
  const end = endDay.getTime() + 24 * 3600 * 1000;
  const all = r15Records_(), ctx = r15Ctx_(all), inPeriod = {};
  all.forEach(function(r) { if (r.at >= start.getTime() && r.at < end) inPeriod[r.inboundNo || ('없음:' + r.id)] = 1; });
  // 기간 안에 1건이라도 있는 입고번호는 그 입고번호의 기록 전체를 보여준다 (하루를 넘긴 차량도 한 장에)
  const groups = {};
  all.forEach(function(r) { const g = r.inboundNo || ('없음:' + r.id); if (inPeriod[g]) (groups[g] = groups[g] || []).push(r15Public_(r, ctx)); });
  const inbounds = Object.keys(groups).map(function(g) { return r15InboundSummary_(g.indexOf('없음:') === 0 ? '' : g, groups[g]); })
    .sort(function(a, b) { return b.firstAt - a.firstAt; });
  const records = []; Object.keys(groups).forEach(function(g) { groups[g].forEach(function(r) { records.push(r); }); });

  // 수불: 품목별 기간 입고 / 기간 투입 / 현재 가용
  const supply = {}, sup = function(code, name) { const k = code || name || '미상'; return supply[k] = supply[k] || { itemCode:code, product:name, inPallets:0, inQty:0, usedPallets:0, usedQty:0, stockPallets:0, stockQty:0 }; };
  all.forEach(function(r) {
    if (r.at >= start.getTime() && r.at < end) { const s = sup(r.itemCode, r.product); s.inPallets++; s.inQty += r.qty || r.vendorQty; }
  });
  const recByKey = {}; all.forEach(function(r) { const k = r15Key_(r.inboundNo, r.pallet); if (k && !recByKey[k]) recByKey[k] = r; });
  r15ProdPallets_().forEach(function(pp) {
    if (pp.at >= start.getTime() && pp.at < end) { const rec = recByKey[r15Key_(pp.inboundNo, pp.pallet)]; const s = sup(rec ? rec.itemCode : pp.itemCode, rec ? rec.product : pp.product); s.usedPallets++; s.usedQty += pp.qty || (rec ? rec.qty : 0); }
  });
  r15Stock_(180).groups.forEach(function(g) { const s = sup(g.itemCode, g.product); s.stockPallets += g.palletCount; s.stockQty += g.qtyTotal; });

  const issueCounts = {}; records.forEach(function(r) { r.issues.forEach(function(x) { if (!x.acked) issueCounts[x.code] = (issueCounts[x.code] || 0) + 1; }); });
  const lotsInPeriod = r15Productions_().filter(function(p) { return p.at >= start.getTime() && p.at < end; }).length;
  return {
    ok:true, from:from, to:to || from, generatedAt: Utilities.formatDate(new Date(), R15_TZ, 'yyyy-MM-dd HH:mm'), backendVersion:BACKEND_VERSION,
    kpi: { inbounds: inbounds.length, pallets: records.length, qty: records.reduce(function(t, r) { return t + (r.qty || r.vendorQty); }, 0),
      errorRecords: records.filter(function(r) { return r.level === 'error'; }).length, warnRecords: records.filter(function(r) { return r.level === 'warn'; }).length,
      gapPallets: inbounds.reduce(function(t, x) { return t + x.gaps.missing.length; }, 0), lots: lotsInPeriod },
    supply: Object.keys(supply).map(function(k) { return supply[k]; }).sort(function(a, b) { return (b.inQty + b.stockQty) - (a.inQty + a.stockQty); }),
    inbounds: inbounds, records: records, issueCounts: issueCounts
  };
}

function r15Inbound_(inboundNo) {
  const no = r15Digits_(inboundNo); if (!no) return { ok:false, message:'입고번호가 없습니다.' };
  const all = r15Records_(), ctx = r15Ctx_(all);
  const recs = all.filter(function(r) { return r.inboundNo === no; }).map(function(r) { return r15Public_(r, ctx); });
  if (!recs.length) return { ok:true, found:false, inboundNo:no, records:[] };
  return { ok:true, found:true, summary: r15InboundSummary_(no, recs), records: recs };
}

/* ---------- 가용 재고 (검수 완료, 아직 투입 안 됨) ---------- */
function r15Stock_(days, itemCode) {
  const d = Math.max(1, Math.min(730, Number(days) || 120)), since = Date.now() - d * 24 * 3600 * 1000, code = r15Digits_(itemCode);
  const all = r15Records_(), ctx = r15Ctx_(all), seen = {}, groups = {};
  all.forEach(function(r) {
    const k = r15Key_(r.inboundNo, r.pallet); if (!k || seen[k] || ctx.used[k] || r.at < since) return; seen[k] = 1;
    if (code && r.itemCode !== code) return;
    const g = groups[r.inboundNo] = groups[r.inboundNo] || { inboundNo:r.inboundNo, itemCode:r.itemCode, product:r.product, supplier:r.supplier, inboundDate:r.inboundDate || r.day, palletCount:0, qtyTotal:0, pallets:[] };
    const pub = r15Public_(r, ctx);
    g.palletCount++; g.qtyTotal += r.qty || r.vendorQty;
    g.pallets.push({ pallet:r.pallet, recordId:r.id, qty:r.qty || r.vendorQty, finalResult:r.finalResult, level:pub.level });
  });
  const list = Object.keys(groups).map(function(k) { const g = groups[k]; g.pallets.sort(function(a, b) { return a.pallet - b.pallet; }); return g; })
    .sort(function(a, b) { return String(a.inboundDate).localeCompare(String(b.inboundDate)) || a.inboundNo.localeCompare(b.inboundNo); });
  return { ok:true, days:d, groups:list };
}

function r15PalletInfo_(inboundNo, pallet) {
  const k = r15Key_(inboundNo, pallet); if (!k) return { ok:false, message:'입고번호와 Pallet 번호가 필요합니다.' };
  const all = r15Records_(), ctx = r15Ctx_(all), hit = all.filter(function(r) { return r15Key_(r.inboundNo, r.pallet) === k; });
  return { ok:true, found:hit.length > 0, record: hit.length ? r15Public_(hit[0], ctx) : null, usedIn: (ctx.used[k] || []).map(function(pp) { return { lotNo:pp.lotNo, productName:pp.productName, at:pp.atText }; }) };
}

/* ---------- 양방향 추적 ---------- */
function r15Trace_(query) {
  const raw = r15S_(query); if (!raw) return { ok:false, message:'검색어를 입력하세요.' };
  const low = raw.toLowerCase(), all = r15Records_(), ctx = r15Ctx_(all), pp = r15ProdPallets_();
  const recByKey = {}; all.forEach(function(r) { const k = r15Key_(r.inboundNo, r.pallet); if (k && !recByKey[k]) recByKey[k] = r; });
  // 제조번호 → 투입 Pallet → 입고 검수 기록
  const lots = r15Productions_().filter(function(p) { const lot = p.lotNo.toLowerCase(); return lot === low || (low.length >= 3 && lot.indexOf(low) >= 0) || (low.length >= 2 && p.productName.toLowerCase().indexOf(low) >= 0); })
    .sort(function(a, b) { return b.at - a.at; }).slice(0, 30).map(function(p) {
      const rows = pp.filter(function(x) { return x.productionId === p.id; }).sort(function(a, b) { return a.seq - b.seq; });
      return { id:p.id, productName:p.productName, lotNo:p.lotNo, status:p.status, prodDate:p.prodDate, at:p.atText, workers:p.workers,
        pallets: rows.map(function(x) { const rec = recByKey[r15Key_(x.inboundNo, x.pallet)]; return { seq:x.seq, inboundNo:x.inboundNo, pallet:x.pallet, at:x.atText, worker:x.worker, unverified:!rec, record: rec ? r15Public_(rec, ctx) : null }; }) };
    });
  // 입고번호(또는 26004733-0042) → 검수 기록 → 사용된 제조번호
  const m = raw.match(/^(\d{8})(\d{4})$/) || raw.match(/(\d{6,12})(?:\s*[-\/ ]\s*0*(\d{1,4}))?/), inbounds = []; // 바코드 값 260047330030도 찾는다
  if (m) {
    const no = m[1], only = m[2] ? Number(m[2]) : 0;
    const recs = all.filter(function(r) { return r.inboundNo === no && (!only || r.pallet === only); }).map(function(r) { return r15Public_(r, ctx); });
    if (recs.length) inbounds.push({ summary: r15InboundSummary_(no, recs), records: recs });
  }
  return { ok:true, query:raw, lots:lots, inbounds:inbounds };
}

/* ---------- 생산 투입 ---------- */
function r15Lots_() {
  const pp = r15ProdPallets_(), cnt = {};
  pp.forEach(function(x) { cnt[x.productionId] = (cnt[x.productionId] || 0) + 1; });
  const list = r15Productions_().sort(function(a, b) { return (a.status === '진행중' ? 0 : 1) - (b.status === '진행중' ? 0 : 1) || b.at - a.at; }).slice(0, 40)
    .map(function(p) { return { id:p.id, productName:p.productName, lotNo:p.lotNo, status:p.status, at:p.atText, workers:p.workers, palletCount:cnt[p.id] || 0 }; });
  return { ok:true, lots:list, products: recentProducts_().products || [], plan: r15PlanToday_() };
}
function r15Lot_(id) {
  const p = r15Productions_().filter(function(x) { return x.id === String(id || ''); })[0]; if (!p) return { ok:false, message:'생산 작업을 찾을 수 없습니다.' };
  const all = r15Records_(), recByKey = {}; all.forEach(function(r) { const k = r15Key_(r.inboundNo, r.pallet); if (k && !recByKey[k]) recByKey[k] = r; });
  const rows = r15ProdPallets_().filter(function(x) { return x.productionId === p.id; }).sort(function(a, b) { return a.seq - b.seq; })
    .map(function(x) { const rec = recByKey[r15Key_(x.inboundNo, x.pallet)]; return { seq:x.seq, inboundNo:x.inboundNo, pallet:x.pallet, qty:x.qty, at:x.atText, worker:x.worker, result:x.result, unverified:!rec, product: rec ? rec.product : x.product }; });
  return { ok:true, lot:{ id:p.id, productName:p.productName, lotNo:p.lotNo, status:p.status, at:p.atText, workers:p.workers, prodDate:p.prodDate }, pallets:rows, total: rows.reduce(function(t, r) { return t + r.qty; }, 0) };
}

function r15ProductionRowObj_(id) {
  const sh = getSs_().getSheetByName('Production'), row = findProductionRow_(sh, id); if (!row) return null;
  return { sheet:sh, row:row, values: sh.getRange(row, 1, 1, PRODUCTION_HEADERS.length).getValues()[0], idx: r15Idx_(PRODUCTION_HEADERS) };
}
function r15RefreshProductionSummary_(prodObj, productionId) {
  r15Forget_('ProductionPallets'); delete R15_MEM_.__pp;
  return r15WriteProductionSummary_(prodObj, r15ProdPallets_().filter(function(x) { return x.productionId === productionId; }));
}
function r15WriteProductionSummary_(prodObj, list) {
  const rows = list.slice().sort(function(a, b) { return a.seq - b.seq; });
  const i = prodObj.idx, total = rows.reduce(function(t, r) { return t + r.qty; }, 0);
  const v = prodObj.values; v[i['투입파레트수']] = rows.length; v[i['투입총수량']] = total;
  v[i['투입파레트요약']] = rows.map(function(r) { return r.inboundNo + '-P' + r.pallet; }).join(', ').slice(0, 45000); v[i['최종수정']] = new Date();
  prodObj.sheet.getRange(prodObj.row, 1, 1, PRODUCTION_HEADERS.length).setValues([v]);
  return { palletCount: rows.length, total: total };
}

// 여러 Pallet를 한 번에 투입한다. 같은 Pallet가 다른 제조번호에 이미 투입됐으면 거부한다.
function r15LotAdd_(p, auth) {
  const pid = r15S_(p.productionId), reqId = r15S_(p.requestId), sent = p.items || [], items = sent.slice(0, 60), over = sent.slice(60);
  if (!pid) return { ok:false, message:'생산 작업 ID가 없습니다.' };
  if (!items.length) return { ok:false, message:'투입할 Pallet가 없습니다.' };
  const cache = CacheService.getScriptCache();
  if (reqId) { try { const prior = cache.get('R15LOT_' + reqId); if (prior) { const o = JSON.parse(prior); o.duplicateRequest = true; return o; } } catch (e) {} }
  // 검수 기록(Records 전체)은 Lock 밖에서 읽는다. 기록은 추가만 되므로 잠깐 늦게 읽어도 안전하고,
  // Lock 안에서 읽으면 DB가 커질수록 그동안 모든 저장(saveSingle tryLock 8초)이 기다리다 '혼잡'이 된다.
  const all = r15Records_(), recByKey = {}; all.forEach(function(r) { const k = r15Key_(r.inboundNo, r.pallet); if (k && !recByKey[k]) recByKey[k] = r; });
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(15000)) return { ok:false, busy:true, retry:true, message:'다른 작업자가 등록 중입니다 · 자동으로 다시 시도합니다.' };
  try {
    r15Forget_('ProductionPallets'); delete R15_MEM_.__pp;
    const prod = r15ProductionRowObj_(pid); if (!prod) return { ok:false, message:'생산 작업을 찾을 수 없습니다.' };
    const pi = prod.idx; if (r15S_(prod.values[pi['상태']]) !== '진행중') return { ok:false, code:'LOT_CLOSED', message:'이미 종료된 생산 작업입니다.' };
    const pps = r15ProdPallets_(), used = {}; pps.forEach(function(x) { const k = r15Key_(x.inboundNo, x.pallet); if (k) used[k] = x; });
    const mineBefore = pps.filter(function(x) { return x.productionId === pid; });
    let seq = mineBefore.reduce(function(m, x) { return Math.max(m, x.seq); }, 0);
    const added = [], skipped = [], rejected = [], rows = [], now = new Date(), worker = auth.name || '';
    items.forEach(function(it) {
      const k = r15Key_(it.inboundNo, it.pallet), tag = { inboundNo: r15Digits_(it.inboundNo), pallet: r15Pallet_(it.pallet) };
      if (!k) { rejected.push(Object.assign(tag, { reason:'입고번호·Pallet 번호 확인 필요' })); return; }
      const u = used[k];
      if (u && u.productionId === pid) { skipped.push(Object.assign(tag, { reason:'이미 이 작업에 투입됨' })); return; }
      if (u) { rejected.push(Object.assign(tag, { reason:'이미 ' + u.productName + ' ' + u.lotNo + '에 투입됨' })); return; }
      const rec = recByKey[k]; seq++;
      rows.push([pid, prod.values[pi['제품명']], prod.values[pi['제조번호']], seq, tag.inboundNo, tag.pallet, rec ? rec.codeRaw : r15S_(it.code),
        rec ? rec.product : '', rec ? rec.itemCode : '', rec ? (rec.qty || rec.vendorQty) : '', rec ? rec.unit : '',
        rec ? rec.finalResult : '미검수투입', rec ? rec.id : '', worker, now]);
      used[k] = { productionId: pid };
      added.push(Object.assign(tag, { seq: seq, unverified: !rec, finalResult: rec ? rec.finalResult : '미검수투입' }));
    });
    // 한 번에 60개까지만 처리한다. 나머지를 말없이 버리지 않고 거부 목록으로 알린다.
    over.forEach(function(it) { rejected.push({ inboundNo: r15Digits_(it.inboundNo), pallet: r15Pallet_(it.pallet), reason:'한 번에 60개까지 · 나머지는 다시 투입하세요' }); });
    if (rows.length) {
      const ps = getSs_().getSheetByName('ProductionPallets');
      ps.getRange(ps.getLastRow() + 1, 1, rows.length, PRODUCTION_PALLET_HEADERS.length).setValues(rows);
    }
    const workers = r15S_(prod.values[pi['작업자목록']]).split(',').map(r15S_).filter(String);
    if (worker && workers.indexOf(worker) < 0) { workers.push(worker); prod.values[pi['작업자목록']] = workers.join(', '); }
    // 방금 읽은 목록 + 새 행으로 합계를 낸다 (ProductionPallets 전체를 한 번 더 읽지 않는다)
    const sum = r15WriteProductionSummary_(prod, mineBefore.concat(rows.map(function(r) { return { inboundNo: r[4], pallet: r[5], seq: r[3], qty: r15Num_(r[9]) }; })));
    if (rows.length) appendAudit_('R15생산투입', pid, { actor: actorLabelV24_(auth), meta: { requestId: reqId, added: added, rejected: rejected } });
    const res = { ok:true, added:added, skipped:skipped, rejected:rejected, palletCount:sum.palletCount, total:sum.total };
    if (reqId) { try { cache.put('R15LOT_' + reqId, JSON.stringify(res), 21600); } catch (e) {} }
    return res;
  } finally { lock.releaseLock(); }
}

function r15LotRemove_(p, auth) {
  const pid = r15S_(p.productionId), k = r15Key_(p.inboundNo, p.pallet), reason = r15S_(p.reason);
  if (!pid || !k) return { ok:false, message:'작업 ID와 Pallet가 필요합니다.' };
  if (!reason) return { ok:false, message:'취소 사유를 입력하세요.' };
  const lock = LockService.getScriptLock(); if (!lock.tryLock(15000)) return { ok:false, busy:true, retry:true, message:'잠시 후 다시 시도하세요.' };
  try {
    r15Forget_('ProductionPallets'); delete R15_MEM_.__pp;
    const prod = r15ProductionRowObj_(pid); if (!prod) return { ok:false, message:'생산 작업을 찾을 수 없습니다.' };
    if (r15S_(prod.values[prod.idx['상태']]) !== '진행중' && !atLeastV24_(auth, 'manager')) return { ok:false, code:'ROLE_REQUIRED', message:'종료된 작업의 투입 취소는 중간관리자 이상만 할 수 있습니다.' };
    const hit = r15ProdPallets_().filter(function(x) { return x.productionId === pid && r15Key_(x.inboundNo, x.pallet) === k; });
    if (!hit.length) return { ok:false, message:'이 작업에 투입된 Pallet가 아닙니다.' };
    const sh = getSs_().getSheetByName('ProductionPallets');
    hit.map(function(x) { return x.row; }).sort(function(a, b) { return b - a; }).forEach(function(r) { sh.deleteRow(r); });
    const sum = r15RefreshProductionSummary_(prod, pid);
    appendAudit_('R15투입취소', pid, { actor: actorLabelV24_(auth), reason: reason, before: hit[0] });
    return { ok:true, palletCount: sum.palletCount, total: sum.total };
  } finally { lock.releaseLock(); }
}

// 잘못 시작한 작업(제품명·제조번호)을 지운다. 행은 '삭제' 상태로 남겨 이력을 보존하고 목록·제품명 추천에서 뺀다.
// 작업자: 투입이 없는 진행중 작업만. 투입된 Pallet가 있으면 중간관리자 이상이 지우고, 그 Pallet들은 다시 투입할 수 있게 풀린다.
function r15LotDelete_(p, auth) {
  const pid = r15S_(p.productionId), reason = r15S_(p.reason);
  if (!pid) return { ok:false, message:'작업 ID가 필요합니다.' };
  if (!reason) return { ok:false, message:'삭제 사유를 입력하세요.' };
  const lock = LockService.getScriptLock(); if (!lock.tryLock(15000)) return { ok:false, busy:true, retry:true, message:'잠시 후 다시 시도하세요.' };
  try {
    r15Forget_('ProductionPallets'); r15Forget_('Production'); delete R15_MEM_.__pp;
    const prod = r15ProductionRowObj_(pid); if (!prod) return { ok:false, message:'생산 작업을 찾을 수 없습니다.' };
    const i = prod.idx, st = r15S_(prod.values[i['상태']]);
    if (st === '삭제') return { ok:true, already:true };
    const hit = r15ProdPallets_().filter(function(x) { return x.productionId === pid; });
    const mgr = atLeastV24_(auth, 'manager');
    if (!mgr && hit.length) return { ok:false, code:'ROLE_REQUIRED', message:'Pallet가 투입된 작업은 중간관리자 이상만 삭제할 수 있습니다. 먼저 투입을 모두 취소하세요.' };
    if (!mgr && st !== '진행중') return { ok:false, code:'ROLE_REQUIRED', message:'종료된 작업은 중간관리자 이상만 삭제할 수 있습니다.' };
    if (hit.length) { const sh = getSs_().getSheetByName('ProductionPallets'); hit.map(function(x) { return x.row; }).sort(function(a, b) { return b - a; }).forEach(function(r) { sh.deleteRow(r); }); }
    const v = prod.values; v[i['상태']] = '삭제'; v[i['투입파레트수']] = 0; v[i['투입총수량']] = 0; v[i['최종수정']] = new Date();
    v[i['비고']] = [r15S_(v[i['비고']]), '삭제: ' + reason + ' (' + actorLabelV24_(auth) + ')'].filter(String).join(' / ');
    prod.sheet.getRange(prod.row, 1, 1, PRODUCTION_HEADERS.length).setValues([v]);
    r15Forget_('Production'); r15Forget_('ProductionPallets'); delete R15_MEM_.__pp;
    appendAudit_('R15작업삭제', pid, { actor: actorLabelV24_(auth), reason: reason, before: { productName: v[i['제품명']], lotNo: v[i['제조번호']], status: st, pallets: hit.map(function(x) { return x.inboundNo + '-P' + x.pallet; }) } });
    return { ok:true, released: hit.length };
  } finally { lock.releaseLock(); }
}

/* ---------- 기준정보 ---------- */
function r15ItemSave_(p, auth) {
  if (!atLeastV24_(auth, 'manager')) return { ok:false, code:'ROLE_REQUIRED', message:'중간관리자 이상 권한이 필요합니다.' };
  const code = r15Digits_(p.itemCode), name = r15S_(p.itemName);
  if (!code || !name) return { ok:false, message:'자재코드와 자재명은 필수입니다.' };
  const list = function(v) { return (Array.isArray(v) ? v : String(v || '').split(',')).map(r15S_).filter(String).join(', '); };
  const row = [code, r15S_(p.category), name, list(p.suppliers), list(p.aliases), r15S_(p.volume)];
  const lock = LockService.getScriptLock(); if (!lock.tryLock(10000)) return { ok:false, busy:true, message:'잠시 후 다시 시도하세요.' };
  try {
    const sh = getSs_().getSheetByName('ItemMaster'), vals = sh.getDataRange().getValues();
    for (let n = 1; n < vals.length; n++) {
      if (r15Digits_(vals[n][0]) !== code) continue;
      sh.getRange(n + 1, 1, 1, row.length).setValues([row]);
      appendAudit_('R15기준정보수정', 'ITEM:' + code, { actor: actorLabelV24_(auth), before: vals[n].slice(0, 6), after: row });
      return { ok:true, updated:true };
    }
    sh.getRange(sh.getLastRow() + 1, 1, 1, row.length).setValues([row]);
    appendAudit_('R15기준정보추가', 'ITEM:' + code, { actor: actorLabelV24_(auth), after: row });
    return { ok:true, created:true };
  } finally { lock.releaseLock(); }
}

/* ---------- 주간제조계획표 (공유 링크에서 읽은 일정) ---------- */
// 관리자가 공유 링크를 붙여 넣으면 화면에서 풀어 일정만 보낸다. 현장 폰은 오늘 일정을 눌러 작업을 시작한다.
function r15PlanSheet_() { return ensureSheet_(getSs_(), 'R15Plan', ['저장일시', '저장자', '일정 JSON', '제품명 연결 JSON']); }
function r15PlanSave_(p, auth) {
  if (!atLeastV24_(auth, 'manager')) return { ok:false, code:'ROLE_REQUIRED', message:'중간관리자 이상 권한이 필요합니다.' };
  const list = (p.schedules || []).filter(function(x) { return x && x.prod && /^\d{4}-\d{2}-\d{2}$/.test(String(x.date || '')); })
    .map(function(x) { return { prod: r15S_(x.prod), date: r15S_(x.date), batch: r15S_(x.batch), line: r15S_(x.line) }; }).slice(0, 3000);
  if (!list.length) return { ok:false, message:'일정이 없습니다.' };
  const names = {}; Object.keys(p.names || {}).forEach(function(k) { const v = r15S_(p.names[k]); if (v) names[r15S_(k)] = v; });
  const json = JSON.stringify(list); if (json.length > 48000) return { ok:false, message:'일정이 너무 많습니다. 기간을 줄여 주세요.' };
  const sh = r15PlanSheet_(); sh.getRange(2, 1, 1, 4).setValues([[new Date(), actorLabelV24_(auth), json, JSON.stringify(names)]]);
  try { CacheService.getScriptCache().remove('R15PLAN'); } catch (e) {}
  appendAudit_('R15계획저장', '', { actor: actorLabelV24_(auth), after: { count: list.length, from: list[0].date, to: list[list.length - 1].date } });
  return { ok:true, count:list.length };
}
function r15Plan_() {
  try { const c = CacheService.getScriptCache().get('R15PLAN'); if (c) return JSON.parse(c); } catch (e) {}
  const sh = r15PlanSheet_(); if (sh.getLastRow() < 2) return { ok:true, schedules:[], names:{}, savedAt:'' };
  const r = sh.getRange(2, 1, 1, 4).getValues()[0]; let list = [], names = {};
  try { list = JSON.parse(r[2] || '[]'); } catch (e) {} try { names = JSON.parse(r[3] || '{}'); } catch (e) {}
  const out = { ok:true, schedules:list, names:names, savedAt: r15Fmt_(r[0], 'yyyy-MM-dd HH:mm'), savedBy: r15S_(r[1]) };
  try { CacheService.getScriptCache().put('R15PLAN', JSON.stringify(out), 600); } catch (e) {}
  return out;
}
function r15PlanToday_() {
  const plan = r15Plan_(), day = function(off) { return Utilities.formatDate(new Date(Date.now() + off * 86400000), R15_TZ, 'yyyy-MM-dd'); };
  const from = day(-1), to = day(1);
  return (plan.schedules || []).filter(function(x) { return x.date >= from && x.date <= to && x.batch; })
    .map(function(x) { return { date:x.date, prod:x.prod, productName: plan.names[x.prod] || x.prod, lotNo:x.batch, line:x.line }; })
    .sort(function(a, b) { return a.date.localeCompare(b.date) || a.lotNo.localeCompare(b.lotNo); });
}


/* ==================== R15 기록 수정·삭제 권한과 이력 ==================== */
// 작업자: 본인이 오늘 저장한 기록만, 생산에 투입되지 않았을 때. 중간관리자 이상: 모든 기록.
// 생산에 투입된 Pallet는 누구도 삭제할 수 없다 (투입 취소가 먼저). 모든 변경은 사유를 받고 AuditLog에 남긴다.
const R15_WORKER_FIELDS = ['inboundNo','containerFrom','displayQty','actualQty','vendorProduct','vendorQty','vendorProdDate','vendorLotNo','note'];
const R15_MANAGER_FIELDS = R15_WORKER_FIELDS.concat(['inboundDate','product','itemCode','manufacturer','supplier','unit','expiryDate','finalResult','vendorProdTime','vendorPalletNo','vendorLine']);
function r15Today_() { return Utilities.formatDate(new Date(), R15_TZ, 'yyyy-MM-dd'); }
function r15RecordPerm_(rec, auth, used) {
  if (!atLeastV24_(auth, 'worker')) return { edit:false, del:false, fields:[], why:'조회 권한은 기록을 고칠 수 없습니다.' };
  if (atLeastV24_(auth, 'manager')) return { edit:true, del:!used, fields:R15_MANAGER_FIELDS, why: used ? '생산에 투입된 Pallet입니다. 삭제하려면 투입 취소를 먼저 하세요.' : '' };
  if (!rec.inspector || rec.inspector !== r15S_(auth.name)) return { edit:false, del:false, fields:[], why:'다른 사람이 저장한 기록입니다. 중간관리자에게 요청하세요.' };
  if (rec.day !== r15Today_()) return { edit:false, del:false, fields:[], why:'지난 날짜 기록은 중간관리자만 고칠 수 있습니다.' };
  if (used) return { edit:false, del:false, fields:[], why:'생산에 투입된 Pallet는 중간관리자만 고칠 수 있습니다.' };
  return { edit:true, del:true, fields:R15_WORKER_FIELDS, why:'' };
}
function r15RecordAndPerm_(id, auth) {
  const rec = r15Records_().filter(function(r) { return r.id === String(id || ''); })[0];
  if (!rec) return { error:{ ok:false, message:'기록을 찾을 수 없습니다. 이미 삭제되었을 수 있습니다.' } };
  const k = r15Key_(rec.inboundNo, rec.pallet);
  const used = r15ProdPallets_().some(function(pp) { return pp.recordId === rec.id || (k && r15Key_(pp.inboundNo, pp.pallet) === k); });
  return { rec:rec, perm:r15RecordPerm_(rec, auth, used) };
}
function r15RecordEdit_(p, auth) {
  const reason = r15S_(p.reason); if (!reason) return { ok:false, message:'수정 사유를 적어 주세요.' };
  const x = r15RecordAndPerm_(p.id, auth); if (x.error) return x.error;
  if (!x.perm.edit) return { ok:false, code:'ROLE_REQUIRED', message:x.perm.why };
  const changes = {}, src = p.changes || {}, denied = [];
  Object.keys(src).forEach(function(k) { if (x.perm.fields.indexOf(k) >= 0) changes[k] = src[k]; else denied.push(k); });
  if (denied.length) return { ok:false, code:'ROLE_REQUIRED', message:'이 권한으로 고칠 수 없는 항목입니다: ' + denied.join(', ') };
  if (Object.prototype.hasOwnProperty.call(changes, 'containerFrom')) changes.containerTo = changes.containerFrom;
  if (Object.prototype.hasOwnProperty.call(changes, 'inboundNo')) changes.inboundNo = r15Digits_(changes.inboundNo);
  const res = updateRecord_({ id:x.rec.id, actor:actorLabelV24_(auth), reason:reason, changes:changes });
  r15Forget_('Records'); delete R15_MEM_.__records;
  return res;
}
function r15RecordDelete_(p, auth) {
  const reason = r15S_(p.reason); if (!reason) return { ok:false, message:'삭제 사유를 적어 주세요.' };
  if (Array.isArray(p.ids)) return r15RecordDeleteMany_(p.ids, reason, auth);
  const x = r15RecordAndPerm_(p.id, auth); if (x.error) return x.error;
  if (!x.perm.del) return { ok:false, code:'ROLE_REQUIRED', message:x.perm.why || '삭제할 수 없는 기록입니다.' };
  const res = v58SoftDeleteCore_({ ids:[x.rec.id], reason:reason, actor:actorLabelV24_(auth) }, auth);
  if (res.ok && res.failed && res.failed.length) return { ok:false, message:'삭제하지 못했습니다: ' + res.failed[0].reason };
  return res;
}
// 여러 건을 한 번에: 건마다 권한을 확인하고, 되는 것만 한 번에 지운다 (한 건씩 부르면 GAS 왕복이 건수만큼 걸린다)
function r15RecordDeleteMany_(ids, reason, auth) {
  ids = ids.map(r15S_).filter(String).slice(0, 300); if (!ids.length) return { ok:false, message:'삭제할 기록을 고르세요.' };
  const okIds = [], failed = [];
  ids.forEach(function(id) {
    const x = r15RecordAndPerm_(id, auth);
    if (x.error) failed.push({ id:id, reason:x.error.message || '찾을 수 없음' });
    else if (!x.perm.del) failed.push({ id:id, reason:x.perm.why || '삭제할 수 없는 기록' });
    else okIds.push(x.rec.id);
  });
  if (!okIds.length) return { ok:false, code: failed.length ? 'ROLE_REQUIRED' : '', message:'삭제할 수 있는 기록이 없습니다: ' + (failed[0] ? failed[0].reason : ''), failed:failed };
  const res = v58SoftDeleteCore_({ ids:okIds, reason:reason, actor:actorLabelV24_(auth) }, auth);
  if (!res.ok) return res;
  const f2 = failed.concat(res.failed || []);
  return { ok:true, deleted: okIds.length - (res.failed || []).length, failed: f2 };
}
// 작업자는 본인이 오늘 지운 기록을 되살릴 수 있다 (잘못 지운 경우). 그 밖의 복구는 중간관리자 이상.
function r15RecordRestore_(p, auth) {
  const id = r15S_(p.id), item = v58SoftDeletedMap_()[id];
  if (!item) return { ok:false, message:'삭제 보관함에 없는 기록입니다.' };
  if (!atLeastV24_(auth, 'manager')) {
    const at = r15Date_(item.deletedAt), mine = r15S_(item.actor) === actorLabelV24_(auth);
    if (!atLeastV24_(auth, 'worker') || !mine || !at || Utilities.formatDate(at, R15_TZ, 'yyyy-MM-dd') !== r15Today_()) return { ok:false, code:'ROLE_REQUIRED', message:'본인이 오늘 지운 기록만 되살릴 수 있습니다. 그 밖에는 중간관리자에게 요청하세요.' };
  }
  const res = v58RestoreCore_({ ids:[id], reason:r15S_(p.reason) || '복구', actor:actorLabelV24_(auth) }, auth);
  if (res.ok && res.failed && res.failed.length) return { ok:false, message:'되살리지 못했습니다: ' + res.failed[0].reason };
  return res;
}
// 오늘 내가 저장한 기록과 오늘 내가 지운 기록 (검수 탭 "오늘 내 기록")
function r15Mine_(auth) {
  const today = r15Today_(), name = r15S_(auth.name), all = r15Records_(), ctx = r15Ctx_(all);
  const items = all.filter(function(r) { return r.day === today && r.inspector === name; }).sort(function(a, b) { return b.at - a.at; }).map(function(r) { return r15Public_(r, ctx); });
  const del = v58SoftDeletedMap_(), me = actorLabelV24_(auth), deleted = [];
  Object.keys(del).forEach(function(id) {
    const d = del[id], at = r15Date_(d.deletedAt);
    if (r15S_(d.actor) !== me || !at || Utilities.formatDate(at, R15_TZ, 'yyyy-MM-dd') !== today) return;
    const info = v58RecordInfo_(id), o = info ? rowObjectV23_(RECORD_HEADERS, info.values) : {};
    deleted.push({ id:id, deletedAt:Utilities.formatDate(at, R15_TZ, 'HH:mm'), reason:r15S_(d.reason), inboundNo:r15Digits_(o['입고번호']), pallet:r15Pallet_(o['용기번호시작']) });
  });
  return { ok:true, today:today, items:items, deleted:deleted };
}
const R15_AUDIT_LABEL = { '기록저장':'저장', 'V58저장':'저장', '기록수정':'수정', '기록SoftDelete':'삭제', '기록복구':'복구', '기록삭제':'영구 삭제', 'R15투입취소':'투입 취소', 'R15작업삭제':'작업 삭제', 'R15작업시작':'작업 시작', 'R15작업참여':'작업 참여', 'R15작업종료':'작업 종료', 'R15계획저장':'계획표 저장', '로그아웃':'로그아웃', '로그인실패':'로그인 실패', '기록삭제실패':'삭제 실패', '기록삭제부분실패':'삭제 일부 실패', '내보내기':'내보내기', '점검확인':'점검 확인', '사진추가':'사진 추가', '점검확인취소':'점검 확인 취소', 'R15생산투입':'생산 투입', 'R15기준정보수정':'품목 수정', 'R15기준정보추가':'품목 추가', 'PIN변경':'PIN 변경', '사용자생성':'사용자 추가', '사용자수정':'사용자 수정', 'PIN초기화':'PIN 초기화' };
function r15AuditRows_() {
  const vals = r15SheetValues_('AuditLog'); if (vals.length < 2) return [];
  const i = r15HeaderIdx_(vals, AUDIT_LOG_HEADERS), out = [];
  for (let n = 1; n < vals.length; n++) {
    const r = vals[n], at = r15Date_(r[i['일시']]); let changes = {}, before = {}, meta = {};
    try { changes = JSON.parse(r[i['After JSON']] || '{}'); } catch (e) {}
    try { before = JSON.parse(r[i['Before JSON']] || '{}'); } catch (e) {}
    try { meta = JSON.parse(r[i['Meta JSON']] || '{}'); } catch (e) {}
    out.push({ at:at ? at.getTime() : 0, atText:at ? Utilities.formatDate(at, R15_TZ, 'yyyy-MM-dd HH:mm') : '', action:r15S_(r[i['작업']]),
      label:R15_AUDIT_LABEL[r15S_(r[i['작업']])] || r15S_(r[i['작업']]), recordId:r15S_(r[i['Record ID']]), actor:r15S_(r[i['Actor']]), reason:r15S_(r[i['Reason']]), changes:changes, before:before, meta:meta });
  }
  return out;
}
// 기록 1건의 변경 이력: 처음 저장 + AuditLog의 수정·삭제·복구
function r15History_(id) {
  id = r15S_(id); if (!id) return { ok:false, message:'기록 ID가 없습니다.' };
  const rec = r15Records_().filter(function(r) { return r.id === id; })[0];
  const items = r15AuditRows_().filter(function(a) { return a.recordId === id && a.action !== '로그인'; }).sort(function(a, b) { return b.at - a.at; });
  if (rec && !items.some(function(a) { return a.label === '저장'; })) items.push({ at:rec.at, atText:rec.atText, action:'기록저장', label:'저장', actor:rec.inspector, reason:'', changes:{} });
  return { ok:true, id:id, items:items };
}
// 최근 변경 이력 (관리 탭). 로그인 기록은 뺀다.
// 종류 묶음: 화면의 '종류' 선택과 같다
const R15_AUDIT_KIND = { '저장':'기록', '수정':'기록', '삭제':'기록', '복구':'기록', '영구 삭제':'기록', '삭제 실패':'기록', '삭제 일부 실패':'기록', '점검 확인':'기록', '사진 추가':'기록', '점검 확인 취소':'기록',
  '생산 투입':'생산', '투입 취소':'생산', '작업 시작':'생산', '작업 참여':'생산', '작업 종료':'생산', '작업 삭제':'생산',
  '품목 수정':'기준정보', '품목 추가':'기준정보', '계획표 저장':'기준정보',
  '로그인':'로그인·사용자', '로그아웃':'로그인·사용자', '로그인 실패':'로그인·사용자', 'PIN 변경':'로그인·사용자', 'PIN 초기화':'로그인·사용자', '사용자 추가':'로그인·사용자', '사용자 수정':'로그인·사용자',
  '내보내기':'내보내기' };
// 감사 추적: 기간·종류·사람·검색어로 거른다. 저장·로그인까지 모두 포함 (최대 2000건, 최신순)
function r15Audit_(q, auth) {
  if (!atLeastV24_(auth, 'manager')) return { ok:false, code:'ROLE_REQUIRED', message:'중간관리자 이상 권한이 필요합니다.' };
  const kw = r15S_(q.q), kind = r15S_(q.kind), actor = r15S_(q.actor), byId = {};
  const from = /^\d{4}-\d{2}-\d{2}$/.test(r15S_(q.from)) ? r15S_(q.from) : '', to = /^\d{4}-\d{2}-\d{2}$/.test(r15S_(q.to)) ? r15S_(q.to) : '';
  r15Records_().forEach(function(r) { byId[r.id] = r; });
  const all = r15AuditRows_().map(function(a) { a.kind = R15_AUDIT_KIND[a.label] || '기타'; a.day = a.atText.slice(0, 10); return a; })
    .filter(function(a) { return (!from || a.day >= from) && (!to || a.day <= to); });
  const actors = {}; all.forEach(function(a) { if (a.actor) actors[a.actor] = 1; });
  const items = all.filter(function(a) { return (!kind || a.kind === kind) && (!actor || a.actor === actor); }).sort(function(a, b) { return b.at - a.at; })
    .map(function(a) { const r = byId[a.recordId]; a.inboundNo = r ? r.inboundNo : (a.before && a.before.inboundNo) || ''; a.pallet = r ? r.pallet : 0; return a; })
    .filter(function(a) { return !kw || JSON.stringify(a).indexOf(kw) >= 0; });
  return { ok:true, total:items.length, items:items.slice(0, 2000), actors:Object.keys(actors).sort(), kinds:['기록','생산','기준정보','로그인·사용자','내보내기','기타'] };
}
// 인쇄·CSV 내보내기를 남긴다 (조회 권한도 가능)
function r15AuditNote_(p, auth) {
  const what = r15S_(p.kind).slice(0, 20); if (!what) return { ok:false, message:'종류가 없습니다.' };
  appendAudit_('내보내기', '', { actor: actorLabelV24_(auth), reason: what, meta: { target: r15S_(p.target).slice(0, 500), count: r15Num_(p.count) } });
  return { ok:true };
}


/* ======================================================================
 * 실제 서버 시험 (Apps Script 편집기에서 r15ServerTest 를 선택하고 ▶ 실행)
 * - 운영 스프레드시트를 통째로 복사한 사본에서만 저장·수정·삭제를 한다. 운영 시트와 사진 폴더는 건드리지 않는다.
 * - 실제 Apps Script·실제 시트 크기로 동작별 시간을 재고, 결과를 실행 로그에 표로 남긴다.
 * - 끝나면 사본과 임시 사진 폴더를 휴지통으로 보낸다 (keep=true면 남김).
 * - 시험 중 잠금(LockService)을 쓰므로 현장에서 저장이 몰리지 않는 시간에 돌린다. 약 1~3분.
 * ====================================================================== */
function r15ServerTest(keep) {
  const t0 = Date.now(), out = [], fails = [];
  const origId = scriptProp_('SPREADSHEET_ID'), stamp = Utilities.formatDate(new Date(), R15_TZ, 'yyyyMMdd_HHmmss');
  const copy = DriveApp.getFileById(origId).makeCopy('R15_서버시험_' + stamp);
  const folder = DriveApp.createFolder('R15_서버시험_사진_' + stamp);
  const reset = function() { SS_MEM_ = null; SHEET_MEM_ = {}; Object.keys(R15_MEM_).forEach(function(k) { delete R15_MEM_[k]; }); };
  const time = function(name, fn, check) {
    reset(); SS_MEM_ = SpreadsheetApp.openById(copy.getId());
    const a = Date.now(); let r, err = '';
    try { r = fn(); if (check && !check(r)) err = '결과 이상: ' + JSON.stringify(r).slice(0, 160); } catch (e) { err = String(e && e.message || e); }
    const ms = Date.now() - a; out.push([name, ms, err ? '실패' : '정상', err]); if (err) fails.push(name + ' · ' + err); return r;
  };
  const who = function(role, name) { return { ok:true, userId:'TEST-' + role, employeeNo:'T-' + role, name:name, department:'시험', role:role, expiresAt:Date.now() + 3600e3 }; };
  const W = who('worker', '시험작업자'), W2 = who('worker', '시험작업자2'), MG = who('manager', '시험중간관리자'), V = who('viewer', '시험조회자');
  const img = 'data:image/jpeg;base64,' + 'UjE1IHNlcnZlciB0ZXN0';
  const today = r15Today_(), inb = '9999' + stamp.slice(4, 8), ids = [];
  try {
    R15_TEST_FOLDER_ = folder;
    const n0 = time('시트 크기 확인', function() { return r15Records_().length; }, function(n) { return n >= 0; });
    // 읽기 (운영과 같은 데이터 크기)
    time('보고서 1주', function() { return r15Get_('r15Report', { from: Utilities.formatDate(new Date(Date.now() - 6 * 864e5), R15_TZ, 'yyyy-MM-dd'), to: today }, MG); }, function(r) { return r.ok; });
    time('보고서 전체 기간', function() { return r15Get_('r15Report', { from: '2000-01-01', to: '2099-12-31' }, MG); }, function(r) { return r.ok; });
    time('투입 작업 목록', function() { return r15Get_('r15Lots', {}, W); }, function(r) { return r.ok; });
    time('가용 공병(재고)', function() { return r15Get_('r15Stock', {}, W); }, function(r) { return r.ok; });
    time('감사 추적 1주', function() { return r15Get_('r15Audit', { from: Utilities.formatDate(new Date(Date.now() - 6 * 864e5), R15_TZ, 'yyyy-MM-dd'), to: today }, MG); }, function(r) { return r.ok; });
    // 차량 1대: Pallet 10개 (사진 2장 + 저장)
    for (let i = 1; i <= 10; i++) {
      const u1 = time('사진 올리기 WMS P' + i, function() { return v58SavePhoto_(img, inb + '_P' + i + '_WMS', { inboundNo: inb, palletNo: i, photoType: 'WMS' }); }, function(u) { return !!u; });
      const u2 = i === 10 ? '' : time('사진 올리기 업체 P' + i, function() { return v58SavePhoto_(img, inb + '_P' + i + '_VENDOR', { inboundNo: inb, palletNo: i, photoType: 'VENDOR' }); }, function(u) { return !!u; });
      const r = time('Pallet 저장 P' + i, function() { return saveSingleRecord_({ client:'r15', requestId:'R15TEST-' + stamp + '-' + i, inspector:W.name, inboundNo:inb, containerFrom:String(i), containerTo:String(i), photoUrl:u1, vendorPhotoUrl:u2,
        product:'서버시험', itemCode:'0000000', displayQty:'1000', actualQty:'1000', finalResult:'적합', note: i === 10 ? '업체사진 없음: 나중에 찍기 / R15 서버시험' : 'R15 서버시험', dateKey: today.replace(/-/g, '') }); }, function(r) { return r && r.ok && r.id; });
      if (r && r.id) ids.push(r.id);
    }
    time('같은 요청 다시 보내기(중복 방지)', function() { return saveSingleRecord_({ client:'r15', requestId:'R15TEST-' + stamp + '-1', inspector:W.name, inboundNo:inb, containerFrom:'1', containerTo:'1', photoUrl:'x', product:'서버시험', itemCode:'0000000', displayQty:'1000', finalResult:'적합' }); }, function(r) { return r && r.ok && r.id === ids[0]; });
    time('같은 Pallet 새로 저장(막혀야 함)', function() { return saveSingleRecord_({ client:'r15', requestId:'R15TEST-' + stamp + '-dup', inspector:W.name, inboundNo:inb, containerFrom:'2', containerTo:'2', photoUrl:'x', product:'서버시험', itemCode:'0000000', displayQty:'1000', finalResult:'적합' }); }, function(r) { return r && !r.ok && r.duplicate; });
    time('입고번호로 조회', function() { return r15Get_('r15Inbound', { inboundNo: inb }, W); }, function(r) { return r.ok && r.records.length === 10; });
    time('오늘 내 기록', function() { return r15Get_('r15Mine', {}, W); }, function(r) { return r.ok && r.items.length >= 10; });
    // 권한·수정·삭제·복구·이력
    time('작업자 수정(사유 있음)', function() { return r15Post_('r15RecordEdit', { id: ids[0], reason: '서버시험 수정', changes: { note: '수정됨' } }, W); }, function(r) { return r.ok; });
    time('남의 기록 수정(막혀야 함)', function() { return r15Post_('r15RecordEdit', { id: ids[0], reason: 'x', changes: { note: 'x' } }, W2); }, function(r) { return !r.ok; });
    time('여러 건 삭제 3건', function() { return r15Post_('r15RecordDelete', { ids: ids.slice(1, 4), reason: '서버시험 삭제' }, W); }, function(r) { return r.ok && r.deleted === 3; });
    time('되살리기 1건', function() { return r15Post_('r15RecordRestore', { id: ids[1], reason: '서버시험 복구' }, W); }, function(r) { return r.ok; });
    time('기록 이력', function() { return r15Get_('r15History', { id: ids[0] }, V); }, function(r) { return r.ok && r.items.some(function(x) { return x.label === '수정'; }); });
    time('업체 사진 나중에 붙이기', function() { return r15Post_('r15AttachPhoto', { id: ids[9], url: v58SavePhoto_(img, inb + '_P10_VENDOR_추가', { inboundNo: inb, palletNo: 10, photoType: 'VENDOR' }) }, W); }, function(r) { return r.ok; });
    time('점검 확인 처리(중간관리자)', function() { return r15Post_('r15IssueAck', { ids: [ids[0]], codes: [], reason: '서버시험 확인' }, MG); }, function(r) { return r.ok; });
    // 생산 투입
    const lot = time('작업 시작', function() { return r15Post_('r15LotStart', { productName: '서버시험제품', lotNo: 'T' + stamp.slice(9) }, W); }, function(r) { return r.ok && r.id; }) || {};
    time('Pallet 5개 투입', function() { return r15Post_('r15LotAdd', { productionId: lot.id, requestId: 'R15TESTLOT-' + stamp, items: [1, 5, 6, 7, 8].map(function(n) { return { inboundNo: inb, pallet: n }; }) }, W); }, function(r) { return r.ok; });
    time('투입된 기록 삭제(막혀야 함)', function() { return r15Post_('r15RecordDelete', { id: ids[4], reason: 'x' }, MG); }, function(r) { return !r.ok; });
    time('투입 1개 취소', function() { return r15Post_('r15LotRemove', { productionId: lot.id, inboundNo: inb, pallet: 8, reason: '서버시험' }, W); }, function(r) { return r.ok; });
    time('작업 종료', function() { return r15Post_('r15LotFinish', { productionId: lot.id }, W); }, function(r) { return r.ok; });
    time('제조번호로 역추적', function() { return r15Get_('r15Trace', { q: 'T' + stamp.slice(9) }, V); }, function(r) { return r.ok; });
    time('작업 삭제(중간관리자, 투입 풀림)', function() { return r15Post_('r15LotDelete', { productionId: lot.id, reason: '서버시험' }, MG); }, function(r) { return r.ok; });
    time('감사 추적 오늘 전체', function() { return r15Get_('r15Audit', { from: today, to: today }, MG); }, function(r) { return r.ok && r.items.some(function(x) { return x.label === '작업 삭제'; }); });
    out.unshift(['운영 기록 수(사본)', n0, '', '']);
  } finally {
    R15_TEST_FOLDER_ = null; reset();
    if (!keep) { try { copy.setTrashed(true); } catch (e) {} try { folder.setTrashed(true); } catch (e) {} }
  }
  const sum = function(re) { const xs = out.filter(function(r) { return re.test(r[0]); }).map(function(r) { return r[1]; }); return xs.length ? Math.round(xs.reduce(function(a, b) { return a + b; }, 0) / xs.length) : 0; };
  const lines = ['R15 서버 시험 ' + stamp + ' · 총 ' + Math.round((Date.now() - t0) / 1000) + '초 · 실패 ' + fails.length + '건' + (keep ? ' · 사본 남김: ' + copy.getUrl() : ' · 사본·임시 사진 폴더는 휴지통으로 보냄'),
    '평균: 사진 올리기 ' + sum(/^사진 올리기/) + 'ms · Pallet 저장 ' + sum(/^Pallet 저장/) + 'ms',
    '동작 | 서버 시간(ms) | 결과 | 비고'].concat(out.map(function(r) { return r.join(' | '); }));
  Logger.log(lines.join('\n'));
  return lines.join('\n');
}
