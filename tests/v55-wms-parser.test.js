const fs=require('fs');
const vm=require('vm');
const assert=require('assert');

const code=fs.readFileSync('v55-wms-parser.js','utf8');
const ctx={console,window:null};
ctx.window=ctx;
ctx.V26WmsCardScan={
  parseWms(){
    return {
      itemCode:'2000990',
      product:'판콜액 병',
      displayQty:'21320',
      containerFrom:'0004',
      containerTo:'0028'
    };
  }
};
vm.createContext(ctx);
vm.runInContext(code,ctx,{filename:'v55-wms-parser.js'});

const P=ctx.V55WmsParser;
assert.ok(P);

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

assert.strictEqual(P._test.isDate8('20260917'),true);
assert.strictEqual(P._test.isDate8('26003373'),false);

console.log('PASS V55 WMS parser: inbound-number layout and fallback recovery');
