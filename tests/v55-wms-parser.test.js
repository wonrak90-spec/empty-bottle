const fs=require('fs');
const vm=require('vm');
const assert=require('assert');

const code=fs.readFileSync('v55-wms-parser.js','utf8');
const ctx={console,window:null};
ctx.window=ctx;
ctx.V26WmsCardScan={
  parseWms(text){
    const s=String(text||'');
    return {
      inboundNo:/damaged/.test(s)?'0003373':(/qtyArtifact/.test(s)?'21320000':''),
      itemCode:'2000990',
      product:'판콜액 병',
      displayQty:'21320',
      inboundDate:/damaged/.test(s)?'2026-07-21':'',
      containerFrom:/missingContainer/.test(s)?'':'0004',
      containerTo:/missingContainer/.test(s)?'':'0028'
    };
  }
};
vm.createContext(ctx);
vm.runInContext(code,ctx,{filename:'v55-wms-parser.js'});

const P=ctx.V55WmsParser;
assert.ok(P);
assert.strictEqual(P.VERSION,'V55-WMS-PARSER-2.6');

const items=[
  {text:'입고번호',poly:[[10,20],[90,20],[90,40],[10,40]]},
  {text:'26003373',poly:[[120,20],[220,20],[220,40],[120,40]]},
  {text:'품목코드',poly:[[10,70],[90,70],[90,90],[10,90]]},
  {text:'2000990',poly:[[120,70],[200,70],[200,90],[120,90]]},
  {text:'수량',poly:[[10,120],[60,120],[60,140],[10,140]]},
  {text:'21,320.000 EA',poly:[[120,120],[230,120],[230,140],[120,140]]}
];
const r=P.parse('',items);
assert.strictEqual(r.inboundNo,'26003373');
assert.strictEqual(r.itemCode,'2000990');

// Fallback: inbound label can be missed but an 8-digit non-date candidate survives.
const items2=[
  {text:'26003373',poly:[[120,20],[220,20],[220,40],[120,40]]},
  {text:'20260917',poly:[[120,60],[220,60],[220,80],[120,80]]},
  {text:'2000990',poly:[[120,100],[200,100],[200,120],[120,120]]}
];
const r2=P.parse('26003373 20260917 2000990',items2);
assert.strictEqual(r2.inboundNo,'26003373');

// A populated 7-digit damaged value must not block an 8-digit recovery.
const r3=P.parse('damaged',items);
assert.strictEqual(r3.inboundNo,'26003373');

const rSplit=P.parse('입고번호 2600 3373',[]);
assert.strictEqual(rSplit.inboundNo,'26003373',
  'split digit groups after the inbound label must be rejoined safely');

const r4=P.parse('qtyArtifact',items);
assert.strictEqual(r4.inboundNo,'26003373',
  '21,320.000 -> 21320000 quantity artifact must not block true inbound recovery');

assert.strictEqual(P._test.validInbound('0003373',{}),false);
assert.strictEqual(P._test.validInbound('26003373',{displayQty:'21320'}),true);
assert.strictEqual(P._test.validInbound('21320000',{displayQty:'21320'}),false);
assert.strictEqual(P._test.isQtyScaledArtifact('21320000',{displayQty:'21320'}),true);

assert.strictEqual(P._test.isDate8('20260917'),true);
assert.strictEqual(P._test.isDate8('26003373'),false);



// Geometry split: label and value can land on adjacent OCR rows.
// OCR-confused O in the number must normalize to zero, while date noise is ignored.
const adjacentItems=[
  {text:'입고번호',poly:[[10,20],[90,20],[90,40],[10,40]]},
  {text:'26O0',poly:[[120,52],[165,52],[165,72],[120,72]]},
  {text:'3373',poly:[[170,52],[215,52],[215,72],[170,72]]},
  {text:'20260917',poly:[[120,92],[220,92],[220,112],[120,112]]},
  {text:'2000990',poly:[[120,132],[200,132],[200,152],[120,152]]}
];
const r5=P.parse('damaged',adjacentItems);
assert.strictEqual(r5.inboundNo,'26003373',
  'adjacent split OCR row should recover the inbound number before generic 8-digit candidates');

const actualLabel=P.parse([
  'missingContainer',
  '관리번호 26004291',
  '품명 판콜액 병',
  '품목코드 2000990',
  '수량 21,320.000 EA',
  '입고일자 20260910',
  '용기번호 0015 / 0039'
].join('\n'),[]);
assert.strictEqual(actualLabel.inboundNo,'26004291',
  'printed WMS 관리번호 must map to internal inboundNo');
assert.strictEqual(actualLabel.containerFrom,'0015');
assert.strictEqual(actualLabel.containerTo,'0039');

const managementItems=[
  {text:'관리번호',poly:[[10,20],[90,20],[90,40],[10,40]]},
  {text:'26004291',poly:[[120,20],[220,20],[220,40],[120,40]]},
  {text:'용기번호',poly:[[10,70],[90,70],[90,90],[10,90]]},
  {text:'0015 / 0039',poly:[[120,70],[220,70],[220,90],[120,90]]}
];
const mg=P.parse('missingContainer',managementItems);
assert.strictEqual(mg.inboundNo,'26004291');
assert.strictEqual(mg.containerFrom,'0015');
assert.strictEqual(mg.containerTo,'0039');

const noSlash=P.parse([
  'missingContainer',
  '관리번호 26004291',
  '용기번호 0015 0028'
].join('\n'),[]);
assert.strictEqual(noSlash.inboundNo,'26004291');
assert.strictEqual(noSlash.containerFrom,'0015');
assert.strictEqual(noSlash.containerTo,'0028',
  'OCR-dropped slash between current/total pallet numbers must still recover under 용기번호 label');

const dirty=P._test.sanitizeWmsFields({
  inboundNo:'25001347',itemCode:'2000990',displayQty:'2',
  supplier:'공급업체 입고일자20260917',manufacturer:'동화지앤피(주) 사용기한 20310917'
});
assert.strictEqual(dirty.displayQty,undefined,'tiny WMS quantity must be cleared');
assert.strictEqual(dirty.supplier,undefined);
assert.strictEqual(dirty.manufacturer,'동화지앤피(주)');

console.log('PASS V55 WMS parser V2.6: low-quality field sanitizing + management/range recovery');
