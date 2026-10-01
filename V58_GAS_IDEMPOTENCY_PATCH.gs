/**
 * V58 GAS IDEMPOTENCY PATCH (proposal only)
 * ----------------------------------------
 * DO NOT overwrite production Code.gs blindly.
 * Merge these helpers into the currently deployed Apps Script after comparing
 * with the live production source.
 *
 * Purpose
 *  - Prevent duplicate rows when the phone retries the same save after
 *    a timeout / lost response.
 *  - Each client save carries payload.requestId.
 *  - The same requestId returns the original record id instead of inserting again.
 *
 * Recommended one-time setup:
 *  1) Add / ensure a sheet named "SaveRequestIndex"
 *  2) Headers: Request ID | Record ID | Created At
 *  3) Deploy a NEW Apps Script version
 *  4) Only after verification, set CONFIG.V58_IDEMPOTENCY = true in frontend.
 */

const V58_REQUEST_INDEX_SHEET = 'SaveRequestIndex';
const V58_REQUEST_INDEX_HEADERS = ['Request ID','Record ID','Created At'];

function v58EnsureRequestIndex_() {
  const ss = getSs_();
  let sh = ss.getSheetByName(V58_REQUEST_INDEX_SHEET);
  if (!sh) sh = ss.insertSheet(V58_REQUEST_INDEX_SHEET);
  if (sh.getLastRow() === 0) {
    sh.getRange(1, 1, 1, V58_REQUEST_INDEX_HEADERS.length).setValues([V58_REQUEST_INDEX_HEADERS]);
    sh.setFrozenRows(1);
  }
  return sh;
}

function v58FindRequest_(requestId) {
  const key = String(requestId || '').trim();
  if (!key) return '';

  try {
    const cached = CacheService.getScriptCache().get('v58_req_' + key);
    if (cached) return cached;
  } catch (_) {}

  const sh = v58EnsureRequestIndex_();
  if (sh.getLastRow() < 2) return '';

  const finder = sh.getRange(2, 1, sh.getLastRow() - 1, 1)
    .createTextFinder(key)
    .matchEntireCell(true);
  const hit = finder.findNext();
  if (!hit) return '';

  const recordId = String(sh.getRange(hit.getRow(), 2).getValue() || '').trim();
  if (recordId) {
    try { CacheService.getScriptCache().put('v58_req_' + key, recordId, 21600); } catch (_) {}
  }
  return recordId;
}

function v58RememberRequest_(requestId, recordId) {
  const key = String(requestId || '').trim();
  const id = String(recordId || '').trim();
  if (!key || !id) return;

  const sh = v58EnsureRequestIndex_();
  sh.getRange(sh.getLastRow() + 1, 1, 1, 3).setValues([[key, id, new Date()]]);
  try { CacheService.getScriptCache().put('v58_req_' + key, id, 21600); } catch (_) {}
}

/**
 * Integration points inside saveSingleRecord_(p):
 *
 * A) AFTER acquiring the existing ScriptLock and BEFORE duplicate-pallet scan:
 *
 *    const requestId = String(p.requestId || '').trim();
 *    if (requestId) {
 *      const priorId = v58FindRequest_(requestId);
 *      if (priorId) {
 *        return {
 *          ok: true,
 *          id: priorId,
 *          duplicateRequest: true,
 *          message: '이미 처리된 저장 요청입니다.'
 *        };
 *      }
 *    }
 *
 * B) AFTER the Records row has been written successfully and BEFORE releasing
 *    the existing ScriptLock:
 *
 *    if (requestId) v58RememberRequest_(requestId, id);
 *
 * IMPORTANT:
 *  - The request-index write MUST happen while the same ScriptLock is held.
 *  - Do not enable frontend automatic retry until this is live and verified.
 *  - Existing inboundNo + palletNo duplicate protection should stay in place.
 */
