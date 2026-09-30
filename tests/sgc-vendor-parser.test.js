/* Run: node tests/sgc-vendor-parser.test.js */
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const ctx={window:{},console};
ctx.window=ctx;
vm.runInNewContext(fs.readFileSync('v55-vendor-parser.js','utf8'),ctx);
const P=ctx.V55VendorParser;
const cases=[
 ['품명 생산라인 1-3\n판콜-A\nP/L NO. 11\n포장사양 1,640본X13단\nSGC솔루션(주) 천안유리공장','11'],
 ['SGC솔루션\n판콜-A\nP/L NO. 3\n1,640본X13단\n선별완료','3'],
 ['생산라인 1-3\n판콜-A\nP/L NO. 16\n1,640본X13단\n천안유리공장','16'],
 ['SGC솔루션\n판콜-A\nP/L NO. 19\n1,640본X13단\n26/03/23','19']
];
for(const [raw,n] of cases){
 const p=P.parse(raw,[]);
 assert.equal(P.lastTemplate,'SGC솔루션');
 assert.equal(p.product,'판콜-A');
 assert.equal(p.palletNo,n);
 assert.equal(p.qty,'21320');
}
const uncertain=P.parse('SGC솔루션\n판콜-A\nP/L NO. 8\n포장사양 1,640본\n선별완료',[]);
assert.equal(uncertain.palletNo,'8');
assert.equal(uncertain.qty,undefined,'No guessed quantity when second factor missing');
assert.equal(P.detect('SGC솔루션 천안유리공장',[]),'SGC솔루션');
console.log('SGC parser regression cases passed');
