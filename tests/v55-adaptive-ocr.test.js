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
assert.strictEqual(A.VERSION,'V55-ADAPTIVE-OCR-2.4.4');
assert.deepStrictEqual(Array.from(A.criticalKeys('wms')),['inboundNo','itemCode','product','displayQty','containerFrom','containerTo']);
assert.deepStrictEqual(Array.from(A.criticalKeys('vendor')),['product','qty','palletNo']);

const wmsGood={
  inboundNo:'26003373',itemCode:'2000990',product:'판콜병30mL',
  displayQty:'21320',containerFrom:'0004',containerTo:'0028'
};
assert.strictEqual(A.needsRetry('wms',wmsGood),false);
assert.strictEqual(A.needsRetry('wms',{...wmsGood,inboundNo:'0003373'}),true,
  '7-digit damaged WMS inbound number must retry');
assert.strictEqual(A.needsRetry('wms',{...wmsGood,inboundNo:'21320000',displayQty:'21320'}),true,
  'quantity-scaled 21320.000 artifact must not be accepted as inbound number');

const wmsWeak={inboundNo:'26003373',displayQty:'21320'};
assert.strictEqual(A.needsRetry('wms',wmsWeak),true);

const vendorGood={product:'까스활명수75mL병',qty:'10800',palletNo:'9'};
assert.strictEqual(A.needsRetry('vendor',vendorGood),false);
assert.strictEqual(A.needsRetry('vendor',{product:'까스활명수75mL병',qty:'10800'}),true);

assert.strictEqual(A.productSane('30ml'),false,'volume-only OCR must not count as a sane product');
assert.strictEqual(A.productSane('당진'),false,'location noise must not count as a sane product');
assert.strictEqual(A.productSane('품령 30ml'),false,'label noise + volume must not count as a sane product');
assert.strictEqual(A.productSane('판콜에이병 30ml'),true);
assert.strictEqual(A.productSane('판콜에이병 0=$1 13 =21,320 30ml 48 L'),false,
  'formula/pallet contamination must force product retry');
assert.strictEqual(A.needsRetry('vendor',{product:'30ml',qty:'21320',palletNo:'75'}),true,
  'present-but-invalid product fragments must trigger adaptive retry');

const productReplaced=A.mergeCandidate(
  'vendor',
  {product:'30ml',qty:'21320',palletNo:'75'},
  {product:'판콜에이병 30ml',qty:'21320',palletNo:'75'},
  ''
);
assert.strictEqual(productReplaced.product,'판콜에이병 30ml',
  'a sane retry product must replace an invalid volume-only baseline product');

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
assert.strictEqual(A.extractTargetField('vendor','palletNo',{text:'75'}),'75',
  'target ROI may recover a lone pallet number even when the label text is missed');
assert.strictEqual(A.extractTargetField('vendor','palletNo',{text:'40 41 13'}),'',
  'ambiguous numeric-only target ROI must not guess a pallet number');
assert.strictEqual(A.extractTargetField('wms','inboundNo',{text:'입고번호 26003373'}),'26003373');
assert.strictEqual(A.extractTargetField('wms','inboundNo',{text:'입고번호 2600 3373'}),'26003373');
assert.strictEqual(A.extractTargetField('wms','inboundNo',{text:'입고번호\n2600 3373'}),'26003373');
assert.strictEqual(A.extractTargetField('wms','inboundNo',{text:'관리번호 26004341'}),'26004341');
assert.strictEqual(A.extractTargetField('wms','containerRange',{text:'용기번호 0015 / 0028'}),'0015/0028');
assert.strictEqual(A.extractTargetField('wms','containerRange',{text:'용기번호 0015 0028'}),'0015/0028');
assert.strictEqual(A.extractTargetField('wms','containerRange',{text:'용기번호 0029 / 0028'}),'',
  'current pallet may not exceed total pallet count');

assert.strictEqual(
  A.suspiciousTarget('vendor',{product:'까스활명수75ml',qty:'10800',palletNo:'900'},'포장사양 900×12=10,800 본'),
  true,
  'packaging factor 900 must trigger pallet retry'
);
assert.strictEqual(
  A.suspiciousTarget('vendor',{product:'판콜에이병 30ml',qty:'21320',palletNo:'40'},'40×41×13단=21,320 본'),
  true,
  'packaging factor 40 must trigger pallet retry'
);
assert.strictEqual(
  A.suspiciousTarget('vendor',{product:'판콜에이병 30ml',qty:'21320',palletNo:'43'},'40×41×13단=21,320 본'),
  false
);
assert.strictEqual(
  A.suspiciousTarget('vendor',{product:'판콜에이병 30ml',qty:'21320',palletNo:'13'},'40×41 13단=21,320 본'),
  true,
  'missing multiplication mark must still identify 13 as a formula factor'
);

assert.strictEqual(
  A.suspiciousTarget('vendor',{product:'까스활명수75ml',qty:'10800',palletNo:'900'},'포장사양 9OO×12=10,800 본'),
  true,
  'OCR-confused 9OO factor must still block pallet 900'
);
assert.strictEqual(
  A.suspiciousTarget('vendor',{product:'판콜에이병 30ml',qty:'21320',palletNo:'40'},'4O×41×13단=21,320 본'),
  true,
  'OCR-confused 4O factor must still block pallet 40'
);

assert.strictEqual(
  A.pickTargetConsensus([{v:'26',conf:.95}],2),
  null,
  'single numeric ROI hit must not replace a Critical target'
);
assert.strictEqual(
  A.pickTargetConsensus([{v:'70',conf:.91},{v:'70',conf:.94}],2).v,
  '70',
  'two independent ROI variants agreeing on the value must be accepted'
);
assert.strictEqual(
  A.pickTargetConsensus([{v:'70',conf:.95},{v:'7',conf:.96}],2),
  null,
  'disagreeing target OCR variants must not replace the field'
);

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

const sanitizedVendor=A.sanitizeFullRetryCandidate(
  'vendor',
  {product:'판콜에이병 30ml',qty:'21320'},
  {product:'판콜에이병 30ml',qty:'21320',palletNo:'40'}
);
assert.strictEqual(sanitizedVendor.palletNo,undefined,
  'whole-label ROI must not introduce a new pallet number');

const sanitizedWms=A.sanitizeFullRetryCandidate(
  'wms',
  {inboundNo:'',itemCode:'2000990',displayQty:'21320'},
  {inboundNo:'21320000',itemCode:'2000990',displayQty:'21320'}
);
assert.strictEqual(sanitizedWms.inboundNo,undefined,
  'whole-label ROI must not introduce a changed WMS inbound number');

const targetMerged=A.mergeCandidate(
  'vendor',
  {product:'까스활명수75ml',qty:'10800',palletNo:'900'},
  {palletNo:'43'},
  'palletNo'
);
assert.strictEqual(targetMerged.product,'까스활명수75ml');
assert.strictEqual(targetMerged.qty,'10800');
assert.strictEqual(targetMerged.palletNo,'43');

console.log('PASS V55 adaptive OCR V2.4.4: sparse WMS range ROI + product/formula guards + safe dual consensus');