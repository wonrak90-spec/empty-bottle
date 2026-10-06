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

const BACKEND_VERSION = 'V22.8-V58';
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
  try {
    if (action === 'securityInfo') return jsonOut_(securityInfoV24_());

    const session = (e && e.parameter && (e.parameter.session || e.parameter.token)) || '';
    const needRole = (action === 'dbStatus' || action === 'listDeletedRecords') ? 'admin' : 'worker';
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
    const adminActions = ['deleteRecord','updateRecord','softDeleteRecords','restoreRecords','dbStatus','listUsers','createUser','updateUser','resetUserPin'];
    const auth = authorizeSessionV24_(session, adminActions.indexOf(action) >= 0 ? 'admin' : 'worker');
    if (!auth.ok) return jsonOut_(auth);

    if (action === 'authLogout') return jsonOut_(authLogoutV24_(session));
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
      return jsonOut_({ ok:!!url, url:url });
    }
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
    return jsonOut_({ ok:false, message:'알 수 없는 action: ' + action });
  } catch (err) {
    return jsonOut_({ ok:false, message:String(err.message || err) });
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
function publicUserV24_(auth){return {userId:auth.userId||'',employeeNo:auth.employeeNo||'',name:auth.name||'',department:auth.department||'',role:auth.role||'worker'};}
function actorLabelV24_(auth){return [auth.employeeNo||'',auth.name||'',auth.role?'('+auth.role+')':''].filter(Boolean).join(' ');}
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
  if(res&&res._delay){delete res._delay;Utilities.sleep(350);}
  return res;
}
function cacheSessionV24_(hash,auth){try{CacheService.getScriptCache().put('V24SESS_'+hash,JSON.stringify(auth),3600);}catch(e){}}
function authorizeSessionV24_(token,needRole){
  token=String(token||'');if(!token)return {ok:false,code:'AUTH_REQUIRED',message:'로그인이 필요합니다.'};const hash=sha256V24_(token);let auth=null;
  try{const raw=CacheService.getScriptCache().get('V24SESS_'+hash);if(raw)auth=JSON.parse(raw);}catch(e){}
  const ss=getSs_();
  if(!auth){const sh=ss.getSheetByName('Sessions');if(!sh||sh.getLastRow()<2)return {ok:false,code:'AUTH_REQUIRED',message:'로그인 세션이 없습니다.'};const hit=sh.getRange(2,1,sh.getLastRow()-1,1).createTextFinder(hash).matchEntireCell(true).findNext();if(!hit)return {ok:false,code:'AUTH_REQUIRED',message:'로그인 세션이 만료되었습니다.'};const si=sessionIdxV24_(),r=sh.getRange(hit.getRow(),1,1,SESSION_HEADERS.length).getValues()[0],exp=r[si['만료일시']] instanceof Date?r[si['만료일시']]:new Date(r[si['만료일시']]||0);if(String(r[si['상태']])!=='ACTIVE'||isNaN(exp.getTime())||exp.getTime()<Date.now())return {ok:false,code:'AUTH_REQUIRED',message:'로그인 세션이 만료되었습니다.'};const u=userRowByIdV24_(ss,r[si['User ID']]);if(!u)return {ok:false,code:'AUTH_REQUIRED',message:'사용자 계정을 찾을 수 없습니다.'};const ui=userIdxV24_(),ur=u.values;if(String(ur[ui['상태']])!=='ACTIVE')return {ok:false,code:'AUTH_REQUIRED',message:'사용 중지된 계정입니다.'};auth={ok:true,userId:ur[ui['User ID']],employeeNo:ur[ui['사번']],name:ur[ui['이름']],department:ur[ui['부서']],role:ur[ui['권한']],expiresAt:exp.getTime()};sh.getRange(hit.getRow(),si['최종사용']+1).setValue(new Date());cacheSessionV24_(hash,auth);}
  if(Number(auth.expiresAt)<Date.now())return {ok:false,code:'AUTH_REQUIRED',message:'로그인 세션이 만료되었습니다.'};if(needRole==='admin'&&auth.role!=='admin')return {ok:false,code:'ADMIN_REQUIRED',message:'관리자 권한이 필요한 작업입니다.'};return auth;
}
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
function createUserV24_(p,auth){const ss=getSs_(),emp=normalizeEmployeeV24_(p.employeeNo),name=String(p.name||'').trim(),dept=String(p.department||'').trim(),role=String(p.role||'worker')==='admin'?'admin':'worker';if(!emp||!name)return {ok:false,message:'사번과 이름은 필수입니다.'};if(userRowByEmployeeV24_(ss,emp))return {ok:false,message:'이미 등록된 사번입니다.'};const pin=validPinV24_(p.pin)?String(p.pin):randomPinV24_(),salt=randomHexV24_().slice(0,24),uid=Utilities.getUuid(),now=new Date();ss.getSheetByName('Users').appendRow([uid,emp,name,dept,role,salt,pinHashV24_(pin,salt),'ACTIVE',0,'',now,now,'',actorLabelV24_(auth)]);appendAudit_('사용자생성','USER:'+uid,{actor:actorLabelV24_(auth),after:{employeeNo:emp,name:name,department:dept,role:role,status:'ACTIVE'}});return {ok:true,userId:uid,tempPin:pin};}
function updateUserV24_(p,auth){const ss=getSs_(),u=userRowByIdV24_(ss,String(p.userId||''));if(!u)return {ok:false,message:'사용자를 찾을 수 없습니다.'};const i=userIdxV24_(),r=u.values,before=publicUserFromRowV24_(r),role=String(p.role||before.role)==='admin'?'admin':'worker',status=String(p.status||before.status)==='INACTIVE'?'INACTIVE':'ACTIVE';if(before.role==='admin'&&before.status==='ACTIVE'&&(role!=='admin'||status!=='ACTIVE')&&activeAdminCountV24_(ss)<=1)return {ok:false,message:'마지막 활성 관리자 계정은 중지하거나 작업자로 변경할 수 없습니다.'};r[i['이름']]=String(p.name||before.name).trim();r[i['부서']]=String(p.department==null?before.department:p.department).trim();r[i['권한']]=role;r[i['상태']]=status;r[i['수정일시']]=new Date();u.sheet.getRange(u.row,1,1,USER_HEADERS.length).setValues([r]);if(status!=='ACTIVE'||role!==before.role)revokeUserSessionsV24_(ss,before.userId);
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
  const ss=getSs_(), sheet=ss.getSheetByName('Records');
  const inboundNo=String(p.inboundNo||'').trim();
  const currentSeq=Number(String(p.containerFrom||'').replace(/[^0-9]/g,''))||0;
  const requestId=String(p.requestId||'').trim();

  // 응답만 유실된 재전송이면 사진을 다시 만들기 전에 먼저 빠르게 복구한다.
  if(requestId){
    const priorFast=v58FindRequest_(requestId);
    if(priorFast&&!v58IsSoftDeleted_(priorFast))return {ok:true,id:priorFast,duplicateRequest:true,message:'이미 처리된 저장 요청입니다.'};
  }

  // 사진/Drive I/O는 ScriptLock 밖에서 수행한다. 정상 흐름은 이미 업로드된 URL을 사용한다.
  const provisionalId=Utilities.getUuid();
  const dateKey=Utilities.formatDate(new Date(),Session.getScriptTimeZone()||'Asia/Seoul','yyyyMMdd');
  const meta={inboundNo:inboundNo,palletNo:currentSeq||p.containerFrom||'',dateKey:dateKey};
  const photoUrl=p.photoUrl||v58SavePhoto_(p.photo,provisionalId+'_WMS',Object.assign({},meta,{photoType:'WMS'}));
  const vendorPhotoUrl=p.vendorPhotoUrl||v58SavePhoto_(p.vendorPhoto,provisionalId+'_VENDOR',Object.assign({},meta,{photoType:'VENDOR'}));
  const itemPhotoUrls=saveItemPhotos_(p.itemPhotos,provisionalId,meta);

  const lock=LockService.getScriptLock();
  if(!lock.tryLock(8000))return {ok:false,busy:true,message:'저장 요청이 몰려 잠시 대기 중입니다 · 다시 저장해주세요.'};
  try{
    // Lock 안에서 Request ID를 다시 확인해 동시 재전송도 한 건으로 만든다.
    if(requestId){
      const prior=v58FindRequest_(requestId);
      if(prior&&!v58IsSoftDeleted_(prior))return {ok:true,id:prior,duplicateRequest:true,message:'이미 처리된 저장 요청입니다.'};
    }

    let duplicateId=v58FindPallet_(inboundNo,currentSeq);
    if(duplicateId&&v58IsSoftDeleted_(duplicateId))duplicateId='';
    if(!duplicateId&&!v58PalletIndexReady_())duplicateId=v58LegacyDuplicateRecord_(sheet,inboundNo,currentSeq);
    if(duplicateId)return {ok:false,duplicate:true,id:duplicateId,message:'이미 저장된 Pallet입니다 · 관리번호 '+inboundNo+' / 순번 '+currentSeq};

    const id=provisionalId;
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
    sheet.getRange(sheet.getLastRow()+1,1,1,row.length).setValues([row]);
    if(requestId)v58RememberRequest_(requestId,id);
    if(inboundNo&&currentSeq)v58RememberPallet_(inboundNo,currentSeq,id);
    try{CacheService.getScriptCache().remove('v22_dashboard');}catch(e){}
    appendAudit_('V58저장',id,{actor:p.inspector||'',meta:{requestId:requestId,inboundNo:inboundNo,palletNo:currentSeq}});
    return {ok:true,id:id,photoUrl:photoUrl,vendorPhotoUrl:vendorPhotoUrl,itemPhotoUrls:itemPhotoUrls,requestId:requestId};
  } finally {lock.releaseLock();}
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



function appendAudit_(action, recordId, detail) {
  try {
    const ss=getSs_();
    const sh=ss.getSheetByName('Audit');
    if(sh) sh.appendRow([new Date(), action || '', recordId || '', typeof detail==='string'?detail:JSON.stringify(detail||{})]);
    const log=ss.getSheetByName('AuditLog');
    if(log){
      const d=(detail&&typeof detail==='object')?detail:{};
      log.appendRow([Utilities.getUuid(),new Date(),action||'',recordId||'',d.actor||'',d.reason||'',JSON.stringify(d.before||d.snapshot||{}),JSON.stringify(d.after||d.changes||{}),JSON.stringify(d.meta||d.photos||{}),BACKEND_VERSION]);
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
  const admin=!!(auth&&auth.role==='admin');
  return {ok:true,edit:admin,softDelete:admin,restore:admin,audit:admin};
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
  }catch(e){return '';}
}

function v58EnsureSheet_(name,headers){return ensureSheet_(getSs_(),name,headers);}
function v58FindRequest_(requestId){
  const key=String(requestId||'').trim();if(!key)return '';
  try{const x=CacheService.getScriptCache().get('V58REQ_'+key);if(x)return x;}catch(e){}
  const sh=v58EnsureSheet_('SaveRequestIndex',V58_REQUEST_INDEX_HEADERS);if(sh.getLastRow()<2)return '';
  const hit=sh.getRange(2,1,sh.getLastRow()-1,1).createTextFinder(key).matchEntireCell(true).findNext();if(!hit)return '';
  const id=String(sh.getRange(hit.getRow(),2).getValue()||'');try{if(id)CacheService.getScriptCache().put('V58REQ_'+key,id,21600);}catch(e){}return id;
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
  const old=v58FindPallet_(inboundNo,palletNo);if(old===id)return;
  sh.getRange(sh.getLastRow()+1,1,1,3).setValues([[key,id,new Date()]]);try{CacheService.getScriptCache().put('V58PAL_'+key,id,21600);}catch(e){}
}
function v58RemovePalletIndexByRecord_(recordId){
  const sh=v58EnsureSheet_('PalletSaveIndex',V58_PALLET_INDEX_HEADERS);if(sh.getLastRow()<2)return;
  const hits=sh.getRange(2,2,sh.getLastRow()-1,1).createTextFinder(String(recordId||'')).matchEntireCell(true).findAll();
  const rows=hits.map(function(h){return h.getRow();}).sort(function(a,b){return b-a;});
  rows.forEach(function(r){const key=String(sh.getRange(r,1).getValue()||'');sh.deleteRow(r);try{CacheService.getScriptCache().remove('V58PAL_'+key);}catch(e){}});
}
function v58PalletIndexReady_(){return PropertiesService.getScriptProperties().getProperty('V58_PALLET_INDEX_READY')==='1';}
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
  if(!auth||auth.role!=='admin')return {ok:false,code:'ADMIN_REQUIRED',message:'관리자 권한이 필요합니다.'};
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
  if(!auth||auth.role!=='admin')return {ok:false,code:'ADMIN_REQUIRED',message:'관리자 권한이 필요합니다.'};
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
  if(!auth||auth.role!=='admin')return {ok:false,code:'ADMIN_REQUIRED',message:'관리자 권한이 필요합니다.'};
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
}