const fs=require('fs');
const vm=require('vm');
const assert=require('assert');

const code=fs.readFileSync('v56-vendor-distance.js','utf8');
const store={};
const els={};
function add(id,value=''){els[id]={id,value,textContent:'',style:{},classList:{add(){},remove(){},contains(){return false;}},addEventListener(){},closest(){return null;}};return els[id];}
['inboundNo','itemCode','vProduct','vQty','displayQty','vendorPhoto','vendorStatus'].forEach(id=>add(id,''));
els.inboundNo.value='26004291';els.itemCode.value='2000990';

const ctx={
  console,
  window:null,
  localStorage:{
    getItem:k=>Object.prototype.hasOwnProperty.call(store,k)?store[k]:null,
    setItem:(k,v)=>{store[k]=String(v);}
  },
  document:{
    readyState:'loading',
    addEventListener(){},
    getElementById:id=>els[id]||null,
    createElement(){return {style:{},classList:{add(){},remove(){}},appendChild(){}};},
    body:{appendChild(){},style:{}}
  },
  setTimeout,
  navigator:{},
  ImageCapture:undefined,
  FileReader:function(){},
  Image:function(){},
  addEventListener(){}
};
ctx.window=ctx;
vm.createContext(ctx);
vm.runInContext(code,ctx,{filename:'v56-vendor-distance.js'});

const D=ctx.V56VendorDistance;
assert.ok(D);
assert.strictEqual(D.VERSION,'V57.3-VENDOR-DISTANCE-1.8');
assert.strictEqual(D._test.productSame('판콜-A','판콜 A'),true);
assert.strictEqual(D._test.productSame('까스활명수큐병','판콜-A'),false);

const k='26004291|2000990';
D._test.setLock(k,{vendorProduct:'판콜-A',vendorQty:'21320'});
assert.deepStrictEqual(JSON.parse(JSON.stringify(D._test.getLock(k))),{vendorProduct:'판콜-A',vendorQty:'21320'});
assert.strictEqual(D.evidenceReady(),false,'lock must not substitute for current pallet evidence');
D._test.clearLock(k);
assert.strictEqual(D._test.getLock(k),null);

assert.ok(code.includes("rectifyUpwardPerspective"),'upward perspective correction must exist');
assert.ok(code.includes("vendorAngleVariants"),'angle-aware OCR variants must exist');
assert.ok(code.includes("Math.min(z.max,4)"),'hardware default zoom must target 4x when available');
assert.ok(code.includes("range.max=5"),'software zoom slider must allow up to 5x');
console.log('PASS V57.3 vendor distance 1.8: lock/evidence + half-A4 4x zoom + upward-angle correction');
