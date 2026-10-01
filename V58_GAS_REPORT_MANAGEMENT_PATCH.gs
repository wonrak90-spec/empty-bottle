/**
 * V58 REPORT MANAGEMENT PATCH (proposal only)
 * ------------------------------------------
 * DO NOT overwrite production Code.gs blindly.
 * Merge only after comparing with the live Apps Script source.
 *
 * Adds:
 *  - reportCapabilities
 *  - updateRecord
 *  - softDeleteRecords
 *  - restoreRecords
 *  - listDeletedRecords
 *  - RecordAudit sheet
 *  - SoftDeletedRecords sheet
 *
 * Existing searchRecords_ / getRecord_ can remain, with the optional
 * soft-delete filters shown at the bottom of this file.
 */

const V58_RECORD_AUDIT_SHEET='RecordAudit';
const V58_DELETED_SHEET='SoftDeletedRecords';

function v58EnsureReportSheets_(){
  const ss=getSs_();

  let audit=ss.getSheetByName(V58_RECORD_AUDIT_SHEET);
  if(!audit)audit=ss.insertSheet(V58_RECORD_AUDIT_SHEET);
  if(audit.getLastRow()===0){
    audit.getRange(1,1,1,7).setValues([[
      '일시','작업','Record ID','사유','수정 전','수정 후','사용자'
    ]]);
    audit.setFrozenRows(1);
  }

  let del=ss.getSheetByName(V58_DELETED_SHEET);
  if(!del)del=ss.insertSheet(V58_DELETED_SHEET);
  if(del.getLastRow()===0){
    del.getRange(1,1,1,6).setValues([[
      'Record ID','삭제일시','삭제사유','삭제자','복구일시','복구자'
    ]]);
    del.setFrozenRows(1);
  }
  return {audit:audit,deleted:del};
}

function v58ReportCapabilities_(){
  v58EnsureReportSheets_();
  return {ok:true,edit:true,softDelete:true,restore:true,audit:true};
}

function v58RecordRow_(id){
  const ss=getSs_();
  const sh=ss.getSheetByName('Records');
  if(!sh)return null;
  const last=sh.getLastRow();
  if(last<2)return null;
  const idx={};
  RECORD_HEADERS.forEach(function(h,i){idx[h]=i;});
  const finder=sh.getRange(2,1,last-1,1).createTextFinder(String(id||'').trim()).matchEntireCell(true);
  const hit=finder.findNext();
  if(!hit)return null;
  const rowNo=hit.getRow();
  const values=sh.getRange(rowNo,1,1,RECORD_HEADERS.length).getValues()[0];
  return {sheet:sh,rowNo:rowNo,values:values,idx:idx};
}

function v58RecordObject_(info){
  if(!info)return {};
  const o={};
  RECORD_HEADERS.forEach(function(h,i){o[h]=info.values[i];});
  return o;
}

function v58Audit_(action,id,reason,beforeObj,afterObj,user){
  const sheets=v58EnsureReportSheets_();
  sheets.audit.getRange(sheets.audit.getLastRow()+1,1,1,7).setValues([[
    new Date(),action,String(id||''),String(reason||''),
    JSON.stringify(beforeObj||{}),JSON.stringify(afterObj||{}),String(user||'')
  ]]);
}

function v58UpdateRecord_(p){
  p=p||{};
  const id=String(p.id||'').trim();
  const reason=String(p.reason||'').trim();
  if(!id)return {ok:false,message:'Record ID가 없습니다.'};
  if(!reason)return {ok:false,message:'수정 사유가 필요합니다.'};

  const info=v58RecordRow_(id);
  if(!info)return {ok:false,message:'기록을 찾을 수 없습니다.'};

  const before=v58RecordObject_(info);
  const patch=p.patch||{};

  const map={
    product:'품명',
    itemCode:'품목코드',
    displayQty:'표시수량',
    actualQty:'실제확인수량',
    vendorProduct:'업체라벨품명',
    vendorQty:'업체라벨수량',
    note:'특이사항'
  };

  Object.keys(map).forEach(function(k){
    if(!Object.prototype.hasOwnProperty.call(patch,k))return;
    const header=map[k];
    if(info.idx[header]===undefined)return;
    info.values[info.idx[header]]=patch[k];
  });

  info.sheet.getRange(info.rowNo,1,1,RECORD_HEADERS.length).setValues([info.values]);
  const after=v58RecordObject_(info);
  v58Audit_('수정',id,reason,before,after,p.user||'');
  try{CacheService.getScriptCache().remove('v22_dashboard');}catch(_){}
  return {ok:true,id:id};
}

function v58DeletedMap_(){
  const sh=v58EnsureReportSheets_().deleted;
  const map={};
  if(sh.getLastRow()<2)return map;
  const rows=sh.getRange(2,1,sh.getLastRow()-1,6).getValues();
  rows.forEach(function(r){
    const id=String(r[0]||'').trim();
    if(!id)return;
    // Active deletion = no restore timestamp.
    if(r[1]&&!r[4])map[id]={deletedAt:r[1],reason:r[2],user:r[3]};
  });
  return map;
}

function v58IsDeleted_(id){
  return !!v58DeletedMap_()[String(id||'').trim()];
}

function v58SoftDeleteRecords_(p){
  p=p||{};
  const ids=(p.ids||[]).map(function(x){return String(x||'').trim();}).filter(Boolean);
  const reason=String(p.reason||'').trim();
  if(!ids.length)return {ok:false,message:'삭제할 기록이 없습니다.'};
  if(!reason)return {ok:false,message:'삭제 사유가 필요합니다.'};

  const sheets=v58EnsureReportSheets_();
  const active=v58DeletedMap_();
  const rows=[];
  let count=0;

  ids.forEach(function(id){
    if(active[id])return;
    const info=v58RecordRow_(id);
    if(!info)return;
    const before=v58RecordObject_(info);
    rows.push([id,new Date(),reason,String(p.user||''),'','']);
    v58Audit_('삭제',id,reason,before,{},p.user||'');
    count++;
  });

  if(rows.length){
    sheets.deleted.getRange(sheets.deleted.getLastRow()+1,1,rows.length,6).setValues(rows);
  }
  try{CacheService.getScriptCache().remove('v22_dashboard');}catch(_){}
  return {ok:true,count:count};
}

function v58RestoreRecords_(p){
  p=p||{};
  const ids=(p.ids||[]).map(function(x){return String(x||'').trim();}).filter(Boolean);
  if(!ids.length)return {ok:false,message:'복구할 기록이 없습니다.'};

  const sh=v58EnsureReportSheets_().deleted;
  if(sh.getLastRow()<2)return {ok:true,count:0};

  const rows=sh.getRange(2,1,sh.getLastRow()-1,6).getValues();
  let count=0;
  rows.forEach(function(r,i){
    const id=String(r[0]||'').trim();
    if(ids.indexOf(id)===-1||!r[1]||r[4])return;
    const rowNo=i+2;
    sh.getRange(rowNo,5,1,2).setValues([[new Date(),String(p.user||'')]]);
    const info=v58RecordRow_(id);
    v58Audit_('복구',id,String(p.reason||'복구'),{},info?v58RecordObject_(info):{},p.user||'');
    count++;
  });
  try{CacheService.getScriptCache().remove('v22_dashboard');}catch(_){}
  return {ok:true,count:count};
}

function v58ListDeletedRecords_(){
  const sh=v58EnsureReportSheets_().deleted;
  if(sh.getLastRow()<2)return {ok:true,items:[]};
  const rows=sh.getRange(2,1,sh.getLastRow()-1,6).getValues();
  const items=[];
  for(let i=rows.length-1;i>=0;i--){
    const r=rows[i];
    if(!r[1]||r[4])continue;
    const info=v58RecordRow_(r[0]);
    const obj=info?v58RecordObject_(info):{};
    items.push({
      id:String(r[0]||''),
      deletedAt:r[1],
      reason:String(r[2]||''),
      user:String(r[3]||''),
      inboundNo:obj['입고번호']||'',
      product:obj['품명']||''
    });
    if(items.length>=200)break;
  }
  return {ok:true,items:items};
}

/**
 * doGet additions:
 *
 * if(action==='reportCapabilities') return jsonOut_(v58ReportCapabilities_());
 * if(action==='listDeletedRecords') return jsonOut_(v58ListDeletedRecords_());
 *
 * doPost additions:
 *
 * if(action==='updateRecord') return jsonOut_(v58UpdateRecord_(body.payload||{}));
 * if(action==='softDeleteRecords') return jsonOut_(v58SoftDeleteRecords_(body.payload||{}));
 * if(action==='restoreRecords') return jsonOut_(v58RestoreRecords_(body.payload||{}));
 *
 * Optional search filter:
 * In searchRecords_(), before pushing an item:
 *
 *   if(v58IsDeleted_(String(row[idx['ID']]||''))) continue;
 *
 * Optional getRecord behavior:
 * At getRecord_() start, after checking id:
 *
 *   if(v58IsDeleted_(id)) return {ok:false,deleted:true,message:'삭제 처리된 기록입니다.'};
 *
 * IMPORTANT:
 * - This patch performs soft delete only. It does NOT erase the original Records row.
 * - Make a spreadsheet backup before first deployment.
 * - If your live backend already has an auth/session user, pass that user into
 *   v58UpdateRecord_/v58SoftDeleteRecords_/v58RestoreRecords_ instead of trusting
 *   a client supplied user field.
 */
