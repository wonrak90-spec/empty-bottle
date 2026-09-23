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
    if(/판콜/.test(s))return {product:'30ml',qty:'559',palletNo:'40'};
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
assert.strictEqual(P.VERSION,'V55-VENDOR-PARSER-3.5');

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
assert.strictEqual(P._test.cleanProduct('명 판콜에이병 30ml'),'판콜에이병 30ml');
assert.strictEqual(P._test.cleanProduct('높명 판콜 에이 병 30ml'),'판콜에이병 30ml');

// Layout recovery: Donghwa label/value split into separate OCR boxes and one
// multiplication symbol missing in the quantity formula.
const donghwaItems=[
  {text:'P-번호',poly:[[10,100],[90,100],[90,120],[10,120]]},
  {text:'75',poly:[[130,100],[160,100],[160,120],[130,120]]}
];
const d3=P.parse('판콜에이병\n30ml\n40×41 13단=21,320 본',donghwaItems);
assert.strictEqual(P.lastTemplate,'동화지앤피');
assert.strictEqual(d3.product,'판콜에이병 30ml');
assert.strictEqual(d3.qty,'21320');
assert.strictEqual(d3.palletNo,'75');

// Layout recovery: Donga P/L value must come from the same row, not 900
// from the packaging formula.
const dongaItems=[
  {text:'P/L No.',poly:[[10,80],[90,80],[90,100],[10,100]]},
  {text:'21',poly:[[130,80],[160,80],[160,100],[130,100]]},
  {text:'900×12=10,800본',poly:[[10,140],[220,140],[220,165],[10,165]]}
];
const d4=P.parse('동아에코팩(주)\n품명 까스활명수75ml\n포장사양 900×12=10,800 본',dongaItems);
assert.strictEqual(d4.palletNo,'21');
assert.strictEqual(d4.qty,'10800');

// Explicit large P-number is valid. It must not be rejected merely because
// packaging formulas can also contain large factors.
const d5=P.parse('판콜에이병 30ml\nP-번호 946\n40×41×13단=21,320 본',[]);
assert.strictEqual(d5.palletNo,'946');
assert.strictEqual(d5.qty,'21320');

// If no explicit P-number survives, a generic pallet value that is actually
// a packaging factor must be discarded rather than treated as a pallet ID.
const d6=P.parse('판콜에이병 30ml\n40×41×13단=21,320 본',[]);
assert.strictEqual(d6.palletNo,undefined);
assert.deepStrictEqual(Array.from(P._test.formulaFactors('40×41 13단=21,320 본')),['40','41','13']);



// Product recovery: label key, Korean product name, and volume may be split
// across adjacent OCR rows. The complete candidate must beat a shorter fragment.
const splitProduct=[
  '품명',
  '판콜 에이 병',
  '30m1',
  'P-번호 43',
  '40×41×13단=21,320 본'
].join('\n');
const d7=P.parse(splitProduct,[]);
assert.strictEqual(d7.product,'판콜에이병 30ml');
assert.strictEqual(d7.palletNo,'43');

// A short volume/noise row must not outrank the labelled complete product.
const noisyProduct=[
  '동아에코팩(주)',
  '품명 까스활명수75m1',
  '검사 75ml',
  'P/L No. 21',
  '포장사양 900×12=10,800 본'
].join('\n');
const d8=P.parse(noisyProduct,[]);
assert.strictEqual(d8.product,'까스활명수75ml');
assert.ok(P._test.productScore('품명 까스활명수75ml',true)>P._test.productScore('검사 75ml',false));



// OCR-confused explicit pallet labels: only the label tokens are tolerated.
// This must still prefer the explicit value over packaging formula factors.
const dongaConfused=P.parse([
  '동아에코팩(주)',
  '품명 까스활명수75ml',
  'P/1 N0. 27',
  '포장사양 900×12=10,800 본'
].join('\n'),[]);
assert.strictEqual(dongaConfused.palletNo,'27');

const donghwaConfused=P.parse([
  '품명 판콜에이병 30ml',
  'P-N0. 44',
  '40×41×13단=21,320 본'
].join('\n'),[]);
assert.strictEqual(donghwaConfused.palletNo,'44');


/* V3.5 regression cases from the 35-image development validation set.
 * These are parser-generalization tests, not a final holdout score.
 */
const dongaPilRaw=[
  '동아에코팩(주)',
  '품명 까스활명수75ml',
  'PILNO',
  '27',
  '포장사양 900×12단:10,800'
].join('\n');
assert.strictEqual(P.detect(dongaPilRaw,[]),'동아에코팩');
const dongaPil=P.parse(dongaPilRaw,[]);
assert.strictEqual(dongaPil.palletNo,'27','PILNO line break must recover pallet 27');

const dongaFormulaBeforePallet=P.parse([
  '동아에코팩(주)',
  '품명 까스활명수75ml',
  'P/L No. 900×12단:10,800 21 색상 3.5'
].join('\n'),[]);
assert.strictEqual(dongaFormulaBeforePallet.palletNo,'21',
  'formula factor 900 after P/L label must be rejected and 21 before color recovered');

const dongaColorFallback=P.parse([
  '동아에코팩(주)',
  '까스활명수75ml',
  '생산라인 52 색상',
  'P/L No. 900×12단:10,800'
].join('\n'),[]);
assert.strictEqual(dongaColorFallback.palletNo,'52',
  'Donga color-row pallet fallback must recover a non-formula value');

const noisyDongaProduct=P.parse([
  '동아에코팩(주)',
  '까 스알명 75m1',
  '50 색신 3.5',
  '900×12단:10,800'
].join('\n'),[]);
assert.strictEqual(noisyDongaProduct.product,'까스활명수75ml',
  'known Donga product should normalize conservative OCR substitutions');
assert.strictEqual(noisyDongaProduct.palletNo,'50');

const donghwaVariant=P.parse([
  '판클에이병',
  '품명',
  '30ml',
  'P-변 75',
  '수량 40 41·13 단=21,320본',
  '동화지앤피주식회사'
].join('\n'),[]);
assert.strictEqual(donghwaVariant.product,'판콜에이병 30ml');
assert.strictEqual(donghwaVariant.palletNo,'75');

const donghwaBareNo=P.parse([
  '판콜에이블',
  '품명',
  '30mi',
  '번 호 73',
  '수량 40*41*13단=21,320본'
].join('\n'),[]);
assert.strictEqual(donghwaBareNo.product,'판콜에이병 30ml');
assert.strictEqual(donghwaBareNo.palletNo,'73');

const donghwaAdjacent=P.parse([
  '판콜에이병',
  '품명 30m1',
  '48',
  'p-번호 40=41 13단=21,320본'
].join('\n'),[]);
assert.strictEqual(donghwaAdjacent.palletNo,'48',
  'formula-like explicit value 40 must fall back to the adjacent standalone pallet value');

const donghwaTrailing=P.parse([
  '명 판콜에이병',
  '30ml',
  '생산일자26년06월27일/시0분 번호',
  '산자 량 40*41*13단=21,320본 50'
].join('\n'),[]);
assert.strictEqual(donghwaTrailing.product,'판콜에이병 30ml');
assert.strictEqual(donghwaTrailing.palletNo,'50',
  'number label split from a trailing pallet value on the next row must be recovered');

console.log('PASS V55 vendor parser V3.5: known-product normalization + tolerant pallet recovery');