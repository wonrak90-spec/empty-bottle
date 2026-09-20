const fs=require('fs');
const assert=require('assert');

const ko=fs.readFileSync('v26-korean-ocr.js','utf8');
const assist=fs.readFileSync('v55-live-assist.js','utf8');
const learn=fs.readFileSync('v55-ocr-learning.js','utf8');
const cfg=fs.readFileSync('config.js','utf8');
const sw=fs.readFileSync('sw.js','utf8');

// Frozen V26 core must remain untouched by the V4.6 release-candidate overlay.
assert.ok(!ko.includes('V55AdaptiveOCR.recognize(dataUrl,type,baseline)'),
  'V26 core must not embed V55 assist logic');

assert.ok(assist.includes("VERSION:'V55-LIVE-ASSIST-RC1.3'"),
  'V4.6 worker-assist overlay version missing');
assert.ok(assist.includes("V55VendorParser&&typeof V55VendorParser.parse==='function'"),
  'worker assist must prefer V55 vendor parser');
assert.ok(assist.includes("V55WmsParser&&typeof V55WmsParser.parse==='function'"),
  'worker assist must prefer V55 WMS parser');
assert.ok(assist.includes("V55AdaptiveOCR.recognize(dataUrl,typeFor(mode),baseline)"),
  'photo/capture flow must call V55 Adaptive OCR');
assert.ok(assist.includes("window.labelPhotoSelected=async function"),
  'photo/gallery flow must be overlaid by V4.6 assist');
assert.ok(assist.includes("V22.captureLive=async function"),
  'explicit live capture must use V4.6 assist');
assert.ok(assist.includes("V22.liveTick=async function"),
  'live stability loop must be overlaid');
assert.ok(assist.includes("if(mode==='vendor')return (KO&&KO.live&&KO.live.vendor)||(V22.live&&V22.live.vendor)||null;"),
  'vendor live assist must read the vendor camera session from V26KoreanOCR.live.vendor');
assert.ok(assist.includes("return (V22.live&&V22.live[mode])||(KO&&KO.live&&KO.live[mode])||null;"),
  'WMS/multi live assist must prefer V22.live while allowing compatibility fallback');
assert.ok(assist.includes("Vendor labels need best-frame selection before OCR"),
  'vendor live flow must select a best frame before OCR');
assert.ok(assist.includes("1차 인식 실패 · 더 선명한 프레임으로 자동 재시도합니다."),
  'vendor live flow must retry once with a better frame');
assert.ok(assist.includes("await V22.captureLive(mode)"),
  'stable live recognition must funnel into adaptive capture before applying values');
assert.ok(assist.includes('작업자 확인'),
  'worker confirmation wording is mandatory');

assert.ok(learn.includes('L.noteApplied=function'),
  'Learning Store must record values actually applied to the form');
assert.ok(learn.includes("V55WmsParser&&typeof V55WmsParser.parse==='function'"),
  'Learning Store must prefer V55 WMS parser');
assert.ok(learn.includes("V55VendorParser&&typeof V55VendorParser.parse==='function'"),
  'Learning Store must prefer V55 vendor parser');

assert.ok(cfg.includes("v55-live-assist.js?v=20260920v46rc1"),
  'runtime loader must include V4.6 assist overlay with cache-bust tag');
assert.ok(sw.includes("'./v55-live-assist.js'"),
  'service worker shell must cache the assist overlay');

console.log('PASS V4.6 worker-assist overlay static checks');
