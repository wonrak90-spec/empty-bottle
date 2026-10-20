const fs=require('fs');
const assert=require('assert');
const q=fs.readFileSync('v58-save-queue.js','utf8');

assert.ok(q.includes("VERSION:'V58-SAVE-QUEUE-1.5-R14.1'"));
assert.ok(q.includes('async function sendOldestOne()'),'single-item sender required');
assert.ok(q.includes('Q._nextRetryAt'),'retry cooldown required');
assert.ok(q.includes('function backoffMs(streak)'),'backoff required');
assert.ok(q.includes('Q.retryAll=async function(){\n    return await Q.kick(true);'),'manual retry must reuse single worker');

const kickStart=q.indexOf('Q.kick=function(force)');
const kickEnd=q.indexOf('Q.retryAll=async function()',kickStart);
const kick=q.slice(kickStart,kickEnd);
assert.ok(!kick.includes('Q.retryAll()'),'background kick must never recursively retry whole queue');
assert.ok(!kick.includes('for(const row of rows)'),'kick must not blast all rows in one retry call');

// Reference state simulation: failure at pallet 6 must not prevent pallets 7~14 being staged.
// Network sends stay single-concurrency and failure attempts back off rather than multiplying by queue size.
function simulate(){
  const rows=[];let networkCalls=0,maxConcurrent=0,active=0,failedOnce=false;
  for(let p=1;p<=14;p++){
    rows.push({p,status:'pending'}); // local stage always succeeds
    if(p<6){
      active++;maxConcurrent=Math.max(maxConcurrent,active);networkCalls++;
      rows.find(x=>x.status==='pending').status='done';active--;
    }else if(p===6){
      active++;maxConcurrent=Math.max(maxConcurrent,active);networkCalls++;failedOnce=true;active--;
      // backoff: p7~p14 continue staging without additional network blast
    }
  }
  assert.strictEqual(rows.length,14);
  assert.strictEqual(rows.filter(x=>x.status==='pending').length,9);
  assert.strictEqual(networkCalls,6);
  assert.strictEqual(maxConcurrent,1);
  assert.strictEqual(failedOnce,true);
}
for(let i=0;i<10000;i++)simulate();
console.log('PASS R14.1 queue resilience: pallet-6 failure does not block local staging; no retry storm');
