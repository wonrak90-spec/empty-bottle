/**
 * V56 Production Collaboration Store
 * Sidecar module only. Does NOT replace existing production APIs or schemas.
 *
 * Stores only active-job collaboration metadata:
 * - Production ID
 * - product / lot
 * - ACTIVE/CLOSED
 * - creator / participants
 * - timestamps
 *
 * Pallet count/qty are calculated from existing ProductionPallets when available.
 */

const V56_PROD_COLLAB_SHEET = 'Production_Collab_V56';
const V56_PROD_COLLAB_HEADERS = [
  'Production ID','제품명','제조번호','Status','생성일시','최종활동','생성자','참여자JSON'
];

function v56ProdCollabSs_() {
  if (typeof getSs_ === 'function') return getSs_();
  const id = PropertiesService.getScriptProperties().getProperty('SPREADSHEET_ID');
  if (!id) throw new Error('SPREADSHEET_ID가 설정되지 않았습니다.');
  return SpreadsheetApp.openById(id);
}

function setupProductionCollabV56_() {
  const ss = v56ProdCollabSs_();
  let sh = ss.getSheetByName(V56_PROD_COLLAB_SHEET);
  if (!sh) sh = ss.insertSheet(V56_PROD_COLLAB_SHEET);
  if (sh.getLastRow() === 0) {
    sh.getRange(1,1,1,V56_PROD_COLLAB_HEADERS.length).setValues([V56_PROD_COLLAB_HEADERS]);
    sh.setFrozenRows(1);
  } else {
    const current = sh.getRange(1,1,1,V56_PROD_COLLAB_HEADERS.length).getValues()[0];
    let diff = false;
    for (let i=0;i<V56_PROD_COLLAB_HEADERS.length;i++) {
      if (String(current[i]||'') !== V56_PROD_COLLAB_HEADERS[i]) { diff=true; break; }
    }
    if (diff) sh.getRange(1,1,1,V56_PROD_COLLAB_HEADERS.length).setValues([V56_PROD_COLLAB_HEADERS]);
  }
  return {ok:true,sheet:V56_PROD_COLLAB_SHEET};
}

function v56ActorName_(actor) {
  return String(actor && (actor.name || actor.userName || actor.employeeName) || '').trim();
}

function v56JsonArray_(value) {
  try {
    const x = JSON.parse(String(value||'[]'));
    return Array.isArray(x) ? x.map(String).filter(Boolean) : [];
  } catch (_) { return []; }
}

function v56FindCollabRow_(sh, productionId) {
  const id = String(productionId||'');
  if (!id || sh.getLastRow() < 2) return 0;
  const vals = sh.getRange(2,1,sh.getLastRow()-1,1).getValues();
  for (let i=0;i<vals.length;i++) if (String(vals[i][0]) === id) return i+2;
  return 0;
}

function v56ProdStats_() {
  const ss = v56ProdCollabSs_();
  const sh = ss.getSheetByName('ProductionPallets');
  const out = {};
  if (!sh || sh.getLastRow() < 2) return out;

  const width = sh.getLastColumn();
  const headers = sh.getRange(1,1,1,width).getValues()[0].map(String);
  const idxId = headers.indexOf('Production ID');
  const idxQty = headers.indexOf('수량');
  if (idxId < 0) return out;

  const rows = sh.getRange(2,1,sh.getLastRow()-1,width).getValues();
  rows.forEach(r=>{
    const id = String(r[idxId]||'');
    if (!id) return;
    if (!out[id]) out[id] = {palletCount:0,total:0};
    out[id].palletCount++;
    if (idxQty >= 0) out[id].total += Number(String(r[idxQty]||'').replace(/,/g,'')) || 0;
  });
  return out;
}

function listProductionCollabV56_(actor) {
  setupProductionCollabV56_();
  const ss = v56ProdCollabSs_();
  const sh = ss.getSheetByName(V56_PROD_COLLAB_SHEET);
  const stats = v56ProdStats_();
  if (sh.getLastRow() < 2) return {ok:true,items:[]};

  const rows = sh.getRange(2,1,sh.getLastRow()-1,V56_PROD_COLLAB_HEADERS.length).getValues();
  const tz = Session.getScriptTimeZone() || 'Asia/Seoul';
  const items = [];
  rows.forEach(r=>{
    if (String(r[3]||'').toUpperCase() !== 'ACTIVE') return;
    const id = String(r[0]||'');
    const st = stats[id] || {palletCount:0,total:0};
    items.push({
      productionId:id,
      productName:String(r[1]||''),
      lotNo:String(r[2]||''),
      status:'ACTIVE',
      createdAt:r[4] instanceof Date ? Utilities.formatDate(r[4],tz,'yyyy-MM-dd HH:mm') : String(r[4]||''),
      updatedAt:r[5] instanceof Date ? Utilities.formatDate(r[5],tz,'yyyy-MM-dd HH:mm') : String(r[5]||''),
      creator:String(r[6]||''),
      workers:v56JsonArray_(r[7]),
      palletCount:st.palletCount,
      total:st.total
    });
  });
  items.sort((a,b)=>String(b.updatedAt).localeCompare(String(a.updatedAt)));
  return {ok:true,items:items};
}

function openProductionCollabV56_(payload, actor) {
  setupProductionCollabV56_();
  payload = payload || {};
  const productionId = String(payload.productionId||'').trim();
  if (!productionId) return {ok:false,message:'Production ID가 없습니다.'};

  const name = v56ActorName_(actor);
  if (!name) return {ok:false,message:'로그인 사용자 정보를 확인할 수 없습니다.'};

  const ss = v56ProdCollabSs_();
  const sh = ss.getSheetByName(V56_PROD_COLLAB_SHEET);
  const row = v56FindCollabRow_(sh,productionId);
  const now = new Date();

  if (row) {
    const cur = sh.getRange(row,1,1,V56_PROD_COLLAB_HEADERS.length).getValues()[0];
    if (String(cur[3]||'').toUpperCase() === 'CLOSED') {
      return {ok:false,message:'이미 종료된 생산작업입니다.'};
    }
    const workers = v56JsonArray_(cur[7]);
    if (workers.indexOf(name)<0) workers.push(name);
    if (payload.productName) sh.getRange(row,2).setValue(String(payload.productName));
    if (payload.lotNo) sh.getRange(row,3).setValue(String(payload.lotNo));
    sh.getRange(row,4).setValue('ACTIVE');
    sh.getRange(row,6).setValue(now);
    sh.getRange(row,8).setValue(JSON.stringify(workers));
    return {ok:true,productionId:productionId,joined:true,workers:workers};
  }

  const workers=[name];
  sh.appendRow([
    productionId,
    String(payload.productName||''),
    String(payload.lotNo||''),
    'ACTIVE',
    now,
    now,
    name,
    JSON.stringify(workers)
  ]);
  return {ok:true,productionId:productionId,created:true,workers:workers};
}

function joinProductionCollabV56_(payload, actor) {
  setupProductionCollabV56_();
  payload = payload || {};
  const productionId = String(payload.productionId||'').trim();
  const name = v56ActorName_(actor);
  if (!productionId) return {ok:false,message:'Production ID가 없습니다.'};
  if (!name) return {ok:false,message:'로그인 사용자 정보를 확인할 수 없습니다.'};

  const sh = v56ProdCollabSs_().getSheetByName(V56_PROD_COLLAB_SHEET);
  const row = v56FindCollabRow_(sh,productionId);
  if (!row) return {ok:false,message:'진행 중 생산작업을 찾을 수 없습니다.'};

  const cur = sh.getRange(row,1,1,V56_PROD_COLLAB_HEADERS.length).getValues()[0];
  if (String(cur[3]||'').toUpperCase() !== 'ACTIVE') return {ok:false,message:'이미 종료된 생산작업입니다.'};

  const workers = v56JsonArray_(cur[7]);
  if (workers.indexOf(name)<0) workers.push(name);
  sh.getRange(row,6).setValue(new Date());
  sh.getRange(row,8).setValue(JSON.stringify(workers));

  return {
    ok:true,
    productionId:productionId,
    productName:String(cur[1]||''),
    lotNo:String(cur[2]||''),
    workers:workers
  };
}

function touchProductionCollabV56_(payload, actor) {
  setupProductionCollabV56_();
  payload = payload || {};
  const productionId = String(payload.productionId||'').trim();
  if (!productionId) return {ok:false,message:'Production ID가 없습니다.'};

  const sh = v56ProdCollabSs_().getSheetByName(V56_PROD_COLLAB_SHEET);
  const row = v56FindCollabRow_(sh,productionId);
  if (!row) return {ok:false,message:'공동작업 정보를 찾을 수 없습니다.'};
  if (String(sh.getRange(row,4).getValue()||'').toUpperCase() !== 'ACTIVE') return {ok:false,message:'종료된 생산작업입니다.'};

  const name = v56ActorName_(actor);
  if (name) {
    const workers = v56JsonArray_(sh.getRange(row,8).getValue());
    if (workers.indexOf(name)<0) {
      workers.push(name);
      sh.getRange(row,8).setValue(JSON.stringify(workers));
    }
  }
  sh.getRange(row,6).setValue(new Date());
  return {ok:true};
}

function closeProductionCollabV56_(payload, actor) {
  setupProductionCollabV56_();
  payload = payload || {};
  const productionId = String(payload.productionId||'').trim();
  if (!productionId) return {ok:false,message:'Production ID가 없습니다.'};

  const sh = v56ProdCollabSs_().getSheetByName(V56_PROD_COLLAB_SHEET);
  const row = v56FindCollabRow_(sh,productionId);
  if (!row) return {ok:true,alreadyClosed:true};

  sh.getRange(row,4).setValue('CLOSED');
  sh.getRange(row,6).setValue(new Date());
  return {ok:true,productionId:productionId};
}
