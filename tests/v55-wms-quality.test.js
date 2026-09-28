const fs=require('fs');
const vm=require('vm');
const assert=require('assert');

const code=fs.readFileSync('v55-wms-quality.js','utf8');
const ctx={
  console,
  window:null,
  document:{
    readyState:'loading',
    addEventListener(){},
    getElementById(){return null;},
    createElement(){return {style:{},appendChild(){}};}
  },
  setTimeout
};
ctx.window=ctx;
vm.createContext(ctx);
vm.runInContext(code,ctx,{filename:'v55-wms-quality.js'});

const Q=ctx.V55WmsQuality;
assert.ok(Q);
assert.strictEqual(Q.VERSION,'V55-WMS-QUALITY-1.1');

const yy=Q._test.expectedManagementPrefix();
assert.strictEqual(Q._test.managementYearMismatch(yy+'004291'),false);
const wrong=(String((Number(yy)+99)%100).padStart(2,'0'))+'001347';
assert.strictEqual(Q._test.managementYearMismatch(wrong),true);

const cleaned=Q.sanitizeParsed({
  inboundNo:yy+'004341',
  product:'판콜액 병',
  supplier:'공급업체 입고일자20260912',
  manufacturer:'동화지앤피(주)',
  expiryDate:'2031-09-17'
});
assert.strictEqual(cleaned.product,'판콜액 병');
assert.strictEqual(cleaned.supplier,undefined,'contaminated supplier OCR must be dropped');
assert.strictEqual(cleaned.expiryDate,'2031-09-17','expiry date is not a future inbound-date error');

const qty=Q._test.qtyMismatch('2','21320');
assert.ok(qty&&qty.severe);
assert.strictEqual(Q.validateBeforeSave({
  inboundNo:yy+'004341',
  displayQty:'2',
  vendorQty:'21320'
}).ok,false,'extreme WMS/vendor quantity mismatch must block save');

assert.strictEqual(Q.validateBeforeSave({
  inboundNo:yy+'004291',
  displayQty:'21320',
  vendorQty:'21320',
  expiryDate:'2031-09-17',
  containerFrom:'0015',
  containerTo:'0028'
}).ok,true,'normal quantity + future expiry date + valid pallet range must remain valid');

assert.strictEqual(Q.validateBeforeSave({
  inboundNo:yy+'004291',
  displayQty:'21320',
  vendorQty:'1640',
  containerFrom:'00157',
  containerTo:'0028'
}).ok,false,'157/28 pallet range and severe vendor quantity mismatch must block save');

const rangeIssue=Q._test.palletRangeIssue('00157','0028');
assert.strictEqual(rangeIssue.code,'pallet_range_order');

const nextYear=String(new Date().getFullYear()+1)+'-01-15';
assert.strictEqual(Q.validateBeforeSave({
  inboundNo:yy+'004291',
  inboundDate:nextYear,
  displayQty:'21320',
  vendorQty:'21320'
}).ok,false,'future inbound date must block save');

assert.strictEqual(Q.validateBeforeSave({
  inboundNo:wrong,
  displayQty:'21320',
  vendorQty:'21320'
}).ok,false,'management number year mismatch must block save');

console.log('PASS V55 WMS quality V1.1: noisy-field sanitize + pallet-range/date/year/quantity guards');
