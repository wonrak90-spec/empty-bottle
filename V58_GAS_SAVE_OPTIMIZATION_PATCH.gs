/**
 * V58 GAS SAVE OPTIMIZATION PATCH (proposal only)
 * ------------------------------------------------
 * DO NOT overwrite production Code.gs blindly.
 * Merge into the currently deployed Apps Script after comparing with live source.
 *
 * Goals
 *  - Keep Request-ID idempotency
 *  - Avoid scanning the entire Records sheet on every save
 *  - Shorten ScriptLock critical section
 *  - Cache Drive folder ids
 *  - Preserve existing duplicate-pallet protection
 *
 * Recommended helper sheets
 *  1) SaveRequestIndex : Request ID | Record ID | Created At
 *  2) PalletSaveIndex  : Key | Record ID | Created At
 *
 * Pallet key format
 *  inboundNo + '|' + normalized pallet number
 */

const V58_PALLET_INDEX_SHEET='PalletSaveIndex';
const V58_PALLET_INDEX_HEADERS=['Key','Record ID','Created At'];

function v58EnsurePalletIndex_(){
  const ss=getSs_();
  let sh=ss.getSheetByName(V58_PALLET_INDEX_SHEET);
  if(!sh)sh=ss.insertSheet(V58_PALLET_INDEX_SHEET);
  if(sh.getLastRow()===0){
    sh.getRange(1,1,1,V58_PALLET_INDEX_HEADERS.length).setValues([V58_PALLET_INDEX_HEADERS]);
    sh.setFrozenRows(1);
  }
  return sh;
}

function v58PalletKey_(inboundNo,palletNo){
  const inbound=String(inboundNo||'').trim();
  const pal=String(palletNo||'').replace(/[^0-9]/g,'');
  if(!inbound||!pal)return '';
  return inbound+'|'+pal;
}

function v58FindPallet_(inboundNo,palletNo){
  const key=v58PalletKey_(inboundNo,palletNo);
  if(!key)return '';

  try{
    const cached=CacheService.getScriptCache().get('v58_pal_'+key);
    if(cached)return cached;
  }catch(_){}

  const sh=v58EnsurePalletIndex_();
  if(sh.getLastRow()<2)return '';

  const hit=sh.getRange(2,1,sh.getLastRow()-1,1)
    .createTextFinder(key)
    .matchEntireCell(true)
    .findNext();
  if(!hit)return '';

  const id=String(sh.getRange(hit.getRow(),2).getValue()||'').trim();
  if(id){try{CacheService.getScriptCache().put('v58_pal_'+key,id,21600);}catch(_){}}
  return id;
}

function v58RememberPallet_(inboundNo,palletNo,recordId){
  const key=v58PalletKey_(inboundNo,palletNo);
  const id=String(recordId||'').trim();
  if(!key||!id)return;

  const sh=v58EnsurePalletIndex_();
  sh.getRange(sh.getLastRow()+1,1,1,3).setValues([[key,id,new Date()]]);
  try{CacheService.getScriptCache().put('v58_pal_'+key,id,21600);}catch(_){}
}

/**
 * Optional one-time migration.
 * Run manually once after backup to build PalletSaveIndex from existing Records.
 * Review header names against the actual production sheet before execution.
 */
function v58BuildPalletIndexFromRecords_(){
  const ss=getSs_();
  const records=ss.getSheetByName('Records');
  const idxSheet=v58EnsurePalletIndex_();
  const data=records.getDataRange().getValues();
  const idx={};
  RECORD_HEADERS.forEach(function(h,i){idx[h]=i;});

  const seen={};
  const rows=[];
  for(let i=1;i<data.length;i++){
    const row=data[i];
    if(String(row[idx['모드']]||'')!=='단건')continue;
    const key=v58PalletKey_(row[idx['입고번호']],row[idx['용기번호시작']]);
    const recordId=String(row[idx['ID']]||'').trim();
    if(!key||!recordId||seen[key])continue;
    seen[key]=true;
    rows.push([key,recordId,new Date()]);
  }

  if(idxSheet.getLastRow()>1)idxSheet.getRange(2,1,idxSheet.getLastRow()-1,idxSheet.getLastColumn()).clearContent();
  if(rows.length)idxSheet.getRange(2,1,rows.length,3).setValues(rows);
  return {ok:true,count:rows.length};
}

/**
 * Drive folder id cache.
 * CacheService avoids repeated getFoldersByName traversal for active folders.
 */
function v58FolderCacheKey_(parentId,name){
  const raw='v58_folder_'+String(parentId||'')+'_'+String(name||'');
  return raw.replace(/[^a-zA-Z0-9_\-]/g,'_').slice(0,240);
}

function v58GetOrCreateChildCached_(parent,name){
  const safe=v58SafeName_(name)||'UNKNOWN';
  const key=v58FolderCacheKey_(parent.getId(),safe);

  try{
    const id=CacheService.getScriptCache().get(key);
    if(id)return DriveApp.getFolderById(id);
  }catch(_){}

  const it=parent.getFoldersByName(safe);
  const folder=it.hasNext()?it.next():parent.createFolder(safe);
  try{CacheService.getScriptCache().put(key,folder.getId(),21600);}catch(_){}
  return folder;
}

function v58PhotoFolderCached_(meta){
  const root=getPhotoFolder_();
  const tz=Session.getScriptTimeZone()||'Asia/Seoul';
  let dateKey=String(meta&&meta.dateKey||'').replace(/[^0-9]/g,'');
  if(dateKey.length!==8)dateKey=Utilities.formatDate(new Date(),tz,'yyyyMMdd');

  const inbound=v58SafeName_(meta&&meta.inboundNo||'NO_INBOUND');
  const pallet=v58SafeName_(meta&&meta.palletNo||'NO_PALLET');

  const day=v58GetOrCreateChildCached_(root,dateKey);
  const inboundFolder=v58GetOrCreateChildCached_(day,inbound);
  return v58GetOrCreateChildCached_(inboundFolder,'Pallet_'+pallet);
}

/**
 * Recommended saveSingleRecord_ ordering
 *
 * PHASE A - before acquiring ScriptLock
 * -------------------------------------
 * 1) Validate payload in memory
 * 2) Photos should already have been uploaded by frontend when possible
 * 3) Do NOT call Drive upload while holding the lock
 *
 * PHASE B - short ScriptLock section
 * ----------------------------------
 * const lock=LockService.getScriptLock();
 * if(!lock.tryLock(8000)) return {ok:false,busy:true,message:'저장 요청이 몰려 잠시 대기 중입니다.'};
 * try {
 *   const requestId=String(p.requestId||'').trim();
 *
 *   // Idempotency
 *   if(requestId){
 *     const prior=v58FindRequest_(requestId);
 *     if(prior)return {ok:true,id:prior,duplicateRequest:true};
 *   }
 *
 *   // Duplicate pallet
 *   const duplicateId=v58FindPallet_(p.inboundNo,p.containerFrom);
 *   if(duplicateId){
 *     return {ok:false,duplicate:true,id:duplicateId,message:'이미 저장된 Pallet입니다.'};
 *   }
 *
 *   // Write ONE row with setValues instead of appendRow when practical
 *   const id=Utilities.getUuid();
 *   const row=[ ...same current Records columns... ];
 *   const next=sheet.getLastRow()+1;
 *   sheet.getRange(next,1,1,row.length).setValues([row]);
 *
 *   // Update both indexes before lock release
 *   if(requestId)v58RememberRequest_(requestId,id);
 *   v58RememberPallet_(p.inboundNo,p.containerFrom,id);
 *
 *   // SpreadsheetApp.flush() is optional here.
 *   // Prefer omitting it unless a downstream read in the same execution requires it.
 *   return {ok:true,id:id,photoUrl:p.photoUrl||'',vendorPhotoUrl:p.vendorPhotoUrl||''};
 * } finally {
 *   lock.releaseLock();
 * }
 *
 * IMPORTANT
 * ---------
 * - Keep the old full Records scan as an emergency fallback only during migration.
 * - Do not turn on CONFIG.V58_IDEMPOTENCY until Request-ID handling is live.
 * - Run v58BuildPalletIndexFromRecords_() once before switching duplicate checks.
 * - Back up spreadsheet before migration.
 * - Test with 2, 5 and 10 concurrent saves before production cutover.
 */
