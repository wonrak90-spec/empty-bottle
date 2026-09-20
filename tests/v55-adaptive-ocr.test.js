const fs=require('fs');
const vm=require('vm');
const assert=require('assert');

const code=fs.readFileSync('v55-adaptive-ocr.js','utf8');
const ctx={
  console,
  window:null,
  performance:{now:()=>0},
  setTimeout,
  clearTimeout
};
ctx.window=ctx;
vm.createContext(ctx);
vm.runInContext(code,ctx,{filename:'v55-adaptive-ocr.js'});

const A=ctx.V55AdaptiveOCR;
assert.ok(A,'V55AdaptiveOCR must be exposed');
assert.deepStrictEqual(Array.from(A.criticalKeys('wms')),['inboundNo','itemCode','product','displayQty','containerFrom','containerTo']);
assert.deepStrictEqual(Array.from(A.criticalKeys('vendor')),['product','qty','palletNo']);

const wmsGood={
  inboundNo:'26003373',itemCode:'2000990',product:'판콜병30mL',
  displayQty:'21320',containerFrom:'0004',containerTo:'0028'
};
assert.strictEqual(A.needsRetry('wms',wmsGood),false);
assert.strictEqual(A.needsRetry('wms',{...wmsGood,inboundNo:'0003373'}),true,
  '7-digit damaged WMS inbound number must retry');

const wmsWeak={inboundNo:'26003373',displayQty:'21320'};
assert.strictEqual(A.needsRetry('wms',wmsWeak),true);

const vendorGood={product:'까스활명수75mL병',qty:'10800',palletNo:'9'};
assert.strictEqual(A.needsRetry('vendor',vendorGood),false);
assert.strictEqual(A.needsRetry('vendor',{product:'까스활명수75mL병',qty:'10800'}),true);

const skew=A.estimateSkew([
  {poly:[[0,0],[100,17],[100,40],[0,23]]},
  {poly:[[0,50],[100,67],[100,90],[0,73]]}
]);
assert.ok(skew>8&&skew<11,'expected approx +10deg skew, got '+skew);

const plan=A.plan('wms',wmsWeak,[{poly:[[0,0],[100,17],[100,40],[0,23]]}],120);
assert.ok(plan.some(x=>String(x.name).startsWith('deskew_')),'deskew candidate missing');
assert.ok(plan.length<=A.MAX_EXTRA_PASSES);
assert.strictEqual(A.MAX_EXTRA_PASSES,4);

const dark=A.plan('vendor',{product:'병'},[],60);
assert.strictEqual(dark[0].name,'bright_contrast');

assert.strictEqual(A.extractTargetField('vendor','palletNo',{text:'P/L No. 946'}),'946');
assert.strictEqual(A.extractTargetField('wms','inboundNo',{text:'입고번호 26003373'}),'26003373');

const bright=A.plan('vendor',{product:'병'},[],220);
assert.strictEqual(bright[0].name,'dark_contrast');

assert.strictEqual(
  A.isStrictImprovement(
    {critical:2,sanity:2,meanConfidence:.90,total:3},
    {critical:2,sanity:2,meanConfidence:.91,total:8}
  ),
  false,
  'extra non-critical fields alone must not replace baseline'
);
assert.strictEqual(
  A.isStrictImprovement(
    {critical:2,sanity:2,meanConfidence:.80,total:3},
    {critical:3,sanity:3,meanConfidence:.60,total:3}
  ),
  true,
  'more Critical coverage must win'
);
assert.strictEqual(
  A.isStrictImprovement(
    {critical:3,sanity:2,meanConfidence:.80,total:3},
    {critical:3,sanity:3,meanConfidence:.70,total:3}
  ),
  true,
  'better Critical sanity must win'
);
assert.strictEqual(
  A.isStrictImprovement(
    {critical:3,sanity:3,meanConfidence:.80,total:3},
    {critical:3,sanity:3,meanConfidence:.89,total:3}
  ),
  false,
  'confidence alone must not replace populated Critical values'
);

const safeMerged=A.mergeCandidate(
  'vendor',
  {product:'까스활명수75ml',qty:'10800'},
  {product:'까스알명75ml',qty:'1800',palletNo:'20'},
  ''
);
assert.strictEqual(safeMerged.product,'까스활명수75ml');
assert.strictEqual(safeMerged.qty,'10800');
assert.strictEqual(safeMerged.palletNo,'20');

const targetMerged=A.mergeCandidate(
  'vendor',
  {product:'까스활명수75ml',qty:'10800',palletNo:'900'},
  {palletNo:'43'},
  'palletNo'
);
assert.strictEqual(targetMerged.product,'까스활명수75ml');
assert.strictEqual(targetMerged.qty,'10800');
assert.strictEqual(targetMerged.palletNo,'43');

console.log('PASS V55 adaptive OCR safe merge, retry gate, target recovery and deskew plan');