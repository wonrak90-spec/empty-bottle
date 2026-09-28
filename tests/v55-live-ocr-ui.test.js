const fs=require('fs');
const assert=require('assert');

const v22=fs.readFileSync('v22.js','utf8');
const assist=fs.readFileSync('v55-capture-assist.js','utf8');
const index=fs.readFileSync('index.html','utf8');

assert.ok(v22.includes("V22.startLive('\${mode}')"),'V22 live start control missing');
assert.ok(v22.includes("V22.stopLive('\${mode}')"),'V22 live stop control missing');
assert.ok(v22.includes("V22.captureLive('\${mode}')"),'V22 live capture control missing');
assert.ok(v22.includes("V22.refocus('\${mode}')"),'V22 live refocus control missing');
assert.ok(v22.includes("V22.ensureLiveUi=function()"),'live UI self-restore hook missing');
assert.ok(!/V22\.ensureLiveUi=function\(\)\s*\{\s*V22\.ensureLiveUi\(\)/.test(v22),
  'ensureLiveUi must not recursively call itself');
assert.ok(v22.includes("insertLiveUi('wms','readerWrapSingle','WMS 라벨')"),
  'WMS live UI restore must call insertLiveUi directly');
assert.ok(v22.includes("insertLiveUi('vendor','vendorPreview','업체 라벨')"),
  'Vendor live UI restore must call insertLiveUi directly');

assert.ok(index.includes('data-live-start="wms"'),'WMS live OCR control must exist statically in production HTML');
assert.ok(index.includes('id="v22LiveWrap_wms"'),'WMS live camera wrapper must exist statically');
assert.ok(index.includes('id="v22LiveVideo_wms"'),'WMS live video must exist statically');
assert.ok(index.includes('data-live-start="vendor"'),'Vendor live OCR control must exist statically in production HTML');
assert.ok(index.includes('id="v22LiveWrap_vendor"'),'Vendor live camera wrapper must exist statically');
assert.ok(index.includes('id="v22LiveVideo_vendor"'),'Vendor live video must exist statically');

assert.ok(assist.includes("ensureLivePrimary()"),'capture UI must preserve live-first layout');
assert.ok(assist.includes("실시간 인식 (기본)"),'live OCR default label missing');
assert.ok(assist.includes("확대 재촬영"),'fallback close-up control missing');
assert.ok(assist.includes("촬영사진 보기"),'photo popup control missing');

console.log('PASS V55 live OCR preservation: static WMS/vendor live UI + nonrecursive self-restore + popup fallback');
