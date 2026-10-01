/**
 * V58 GAS STORAGE PATCH (proposal only)
 * DO NOT overwrite production blindly.
 *
 * Goal
 *  - Faster, organized photo storage
 *  - Folder tree: ROOT/YYYYMMDD/INBOUND_NO/PALLET_xx/
 *  - Stable file names: YYYYMMDD_INBOUND_Pxx_WMS|VENDOR_timestamp.jpg
 *
 * Integrate these helpers into the currently deployed Apps Script only after
 * comparing with the live production source.
 */

function v58SafeName_(s) {
  return String(s || '').trim().replace(/[\\/:*?"<>|#%{}~&]/g, '_').replace(/\s+/g, '_').slice(0, 80);
}

function v58GetOrCreateChild_(parent, name) {
  var safe = v58SafeName_(name) || 'UNKNOWN';
  var it = parent.getFoldersByName(safe);
  if (it.hasNext()) return it.next();
  return parent.createFolder(safe);
}

function v58PhotoFolder_(meta) {
  var root = getPhotoFolder_();
  var tz = Session.getScriptTimeZone() || 'Asia/Seoul';
  var dateKey = String(meta && meta.dateKey || '').replace(/[^0-9]/g,'');
  if (dateKey.length !== 8) dateKey = Utilities.formatDate(new Date(), tz, 'yyyyMMdd');

  var inbound = v58SafeName_(meta && meta.inboundNo || 'NO_INBOUND');
  var pallet = v58SafeName_(meta && meta.palletNo || 'NO_PALLET');

  var dayFolder = v58GetOrCreateChild_(root, dateKey);
  var inboundFolder = v58GetOrCreateChild_(dayFolder, inbound);
  return v58GetOrCreateChild_(inboundFolder, 'Pallet_' + pallet);
}

function v58SavePhoto_(dataUrl, fileName, meta) {
  if (!dataUrl) return '';
  try {
    var match = String(dataUrl).match(/^data:(image\/\w+);base64,(.*)$/);
    if (!match) return '';
    var contentType = match[1];
    var bytes = Utilities.base64Decode(match[2]);
    var ext = contentType.split('/')[1] || 'jpg';
    var name = v58SafeName_(fileName || ('photo_' + Date.now())) + '.' + ext;
    var blob = Utilities.newBlob(bytes, contentType, name);
    return v58PhotoFolder_(meta || {}).createFile(blob).getUrl();
  } catch (err) {
    return '';
  }
}

/**
 * Replace only the uploadPhoto branch in doPost with:
 *
 * if (action === 'uploadPhoto') {
 *   const pl = body.payload || {};
 *   const url = v58SavePhoto_(pl.image, pl.name || ('photo_' + Date.now()), {
 *     inboundNo: pl.inboundNo || '',
 *     palletNo: pl.palletNo || '',
 *     photoType: pl.photoType || '',
 *     dateKey: pl.dateKey || ''
 *   });
 *   return jsonOut_({ ok: !!url, url: url });
 * }
 *
 * Result example:
 * 공병입고사진/
 *   20261001/
 *     26001234/
 *       Pallet_1/
 *         20261001_26001234_P1_WMS_....jpg
 *         20261001_26001234_P1_VENDOR_....jpg
 *       Pallet_2/
 *         ...
 */
