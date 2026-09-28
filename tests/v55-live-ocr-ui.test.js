const fs=require('fs');
const assert=require('assert');

const v22=fs.readFileSync('v22.js','utf8');
const assist=fs.readFileSync('v55-capture-assist.js','utf8');

assert.ok(v22.includes("V22.startLive('${mode}')"),'V22 live start control missing');
assert.ok(v22.includes("V22.stopLive('${mode}')"),'V22 live stop control missing');
assert.ok(v22.includes("V22.captureLive('${mode}')"),'V22 live capture control missing');
assert.ok(v22.includes("V22.refocus('${mode}')"),'V22 live refocus control missing');
assert.ok(v22.includes("V22.ensureLiveUi=function()"),'live UI self-restore hook missing');
assert.ok(v22.includes("data-live-start=\"${mode}\""),'live start marker missing');
assert.ok(v22.includes("class=\"btn primary\""),'live OCR start must remain primary');

assert.ok(assist.includes("ensureLivePrimary()"),'capture UI must reassert live-first layout');
assert.ok(assist.includes("실시간 인식 (기본)"),'live OCR default label missing');
assert.ok(assist.includes("확대 재촬영"),'fallback close-up control missing');
assert.ok(assist.includes("촬영사진 보기"),'photo popup control missing');

console.log('PASS V55 live OCR preservation: live remains primary, popup capture remains fallback');
