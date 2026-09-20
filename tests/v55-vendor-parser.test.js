const fs=require('fs');
const vm=require('vm');
const assert=require('assert');

const code=fs.readFileSync('v55-vendor-parser.js','utf8');
const ctx={console,window:null};
ctx.window=ctx;
ctx.V26VendorTemplates={
  lastTemplate:'',
  parse(raw){
    const s=String(raw||'');
    if(/까스활명수/.test(s))return {product:'까스활명수75m1 당진 3F',qty:'10800',palletNo:'900'};
    if(/판콜/.test(s))return {product:'30ml',qty:'559'};
    return {};
  }
};
ctx.V26Qty={
  vendorFormula(raw){
    const s=String(raw||'');
    if(/900\s*[x×*]\s*12/.test(s))return {calculated:10800,stated:10800,ok:true};
    if(/40\s*[x×*]\s*41\s*[x×*]\s*13/.test(s))return {calculated:21320,stated:21320,ok:true};
    return null;
  }
};
vm.createContext(ctx);
vm.runInContext(code,ctx,{filename:'v55-vendor-parser.js'});

const P=ctx.V55VendorParser;
assert.ok(P);

const donghwa=[
  '품명 판콜에이병 30ml',
  '생산일자 26-06-27',
  'P-번호 43',
  '수량 40*41*13단=21,320 본',
  '유리 제품으로 충격시 파손 위험이 있으니 주의바랍니다.'
].join('\n');
const d1=P.parse(donghwa,[]);
assert.strictEqual(P.lastTemplate,'동화지앤피');
assert.strictEqual(d1.product,'판콜에이병 30ml');
assert.strictEqual(d1.qty,'21320');
assert.strictEqual(d1.palletNo,'43');

const donga=[
  '동아에코팩(주)',
  '품명 까스활명수75m1 당진 3F',
  'P/L No. 21',
  '포장사양 900×12=10,800 본'
].join('\n');
const d2=P.parse(donga,[]);
assert.strictEqual(P.lastTemplate,'동아에코팩');
assert.strictEqual(d2.product,'까스활명수75ml');
assert.strictEqual(d2.qty,'10800');
assert.strictEqual(d2.palletNo,'21');

assert.strictEqual(P._test.cleanProduct('품명 까스활명수75m 당진 3F'),'까스활명수75ml');
assert.strictEqual(P._test.cleanProduct('품명 유리병(각병) 100mi'),'유리병(각병) 100ml');

console.log('PASS V55 vendor parser: Donghwa + Donga recovery');