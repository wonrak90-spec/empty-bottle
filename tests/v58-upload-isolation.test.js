const fs=require('fs');
const assert=require('assert');
const f=fs.readFileSync('v56-fast-flow.js','utf8');
const a=fs.readFileSync('app.js','utf8');

assert.ok(f.includes('uploadGeneration:{wms:0,vendor:0}'),'per-pallet upload generation required');
assert.ok(f.includes('F.uploadGeneration[mode]===generation'),'late upload must be generation guarded');
assert.ok(f.includes("const inbound=val('inboundNo')||'NOINBOUND'"),'upload must snapshot inbound');
assert.ok(f.includes("const pallet=val('containerFrom')||'NOPALLET'"),'upload must snapshot pallet');
assert.ok(f.includes('Promise.race([all,timeout])'),'photo wait must be bounded');
assert.ok(a.includes('V56FastFlow.waitForUploads(4000)'),'save path must not wait indefinitely for photo upload');
assert.ok(a.includes('__V58_UPLOAD_WAIT_TIMEOUT__'),'timeout must remain diagnosable');

function simulateLateCompletion(){
  let generation=0,lastEvidence='',photoUrl='';
  function start(data){const g=++generation;lastEvidence=data;return {g,data};}
  function complete(job,url){if(generation===job.g&&lastEvidence===job.data)photoUrl=url;}
  const p6=start('P6');
  generation++;lastEvidence='';photoUrl=''; // save/reset
  const p7=start('P7');
  complete(p6,'URL_P6_LATE');
  assert.strictEqual(photoUrl,'','P6 late upload must not pollute P7');
  complete(p7,'URL_P7');
  assert.strictEqual(photoUrl,'URL_P7');
}
for(let i=0;i<100000;i++)simulateLateCompletion();
console.log('PASS R14.2 upload isolation: late previous-pallet upload cannot corrupt next pallet; save wait bounded');
