const fs=require('fs');
const assert=require('assert');

const ko=fs.readFileSync('v26-korean-ocr.js','utf8');
const learn=fs.readFileSync('v55-ocr-learning.js','utf8');
const cfg=fs.readFileSync('config.js','utf8');

assert.ok(ko.includes("V55VendorParser&&typeof V55VendorParser.parse==='function'"),
  'worker assist must prefer V55 vendor parser');
assert.ok(ko.includes("V55WmsParser&&typeof V55WmsParser.parse==='function'"),
  'worker assist must prefer V55 WMS parser');
assert.ok(ko.includes('async function assistOcr'),
  'photo/capture flow must expose assistOcr helper');
assert.ok(ko.includes("V55AdaptiveOCR.recognize(dataUrl,type,baseline)"),
  'photo/capture flow must call V55 Adaptive OCR');
assert.ok(ko.includes("V4.6 보조 OCR 완료"),
  'worker-facing assist confirmation text missing');
assert.ok(ko.includes("V22.liveTick=async function") && ko.includes("const r=await localOcr(data,true,sid);"),
  'live streaming must remain fast local OCR and not run adaptive retries every frame');
assert.ok(ko.includes("V22.captureLive=async function") && ko.includes("const r=await assistOcr(data,mode,sid);"),
  'explicit live capture must use V4.6 assist path');

assert.ok(learn.includes('L.noteApplied=function'),
  'Learning Store must record values actually applied to the form');
assert.ok(learn.includes("V55WmsParser&&typeof V55WmsParser.parse==='function'"),
  'Learning Store must prefer V55 WMS parser');
assert.ok(learn.includes("V55VendorParser&&typeof V55VendorParser.parse==='function'"),
  'Learning Store must prefer V55 vendor parser');

assert.ok(cfg.includes('v55-adaptive-ocr.js'),
  'runtime loader must include adaptive OCR');
assert.ok(cfg.includes('v55-ocr-learning.js'),
  'runtime loader must include Learning Store');

console.log('PASS V4.6 worker-assist runtime wiring static checks');
