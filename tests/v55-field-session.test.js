const fs=require('fs');
const vm=require('vm');
const assert=require('assert');

const code=fs.readFileSync('v55-field-session.js','utf8');
const store={};
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
    getElementById(){return null;}
  }
};
ctx.window=ctx;
vm.createContext(ctx);
vm.runInContext(code,ctx,{filename:'v55-field-session.js'});

const F=ctx.V55FieldSession;
assert.ok(F);
assert.strictEqual(F.VERSION,'V55-FIELD-SESSION-1');

const s=F._test.empty();
s.active=true;
s.preprintedWms=12;
s.expectedPallets=12;
s.actualPallets=12;
s.completed=7;
s.discardedLabels=0;

assert.strictEqual(F._test.remainingLabels(s),5);
assert.strictEqual(F._test.palletGap(s),5);
assert.strictEqual(F._test.labelBalance(s),5);
assert.strictEqual(F._test.canClose(s).ok,false);

s.completed=12;
assert.strictEqual(F._test.remainingLabels(s),0);
assert.strictEqual(F._test.canClose(s).ok,true);

const shortTruck=F._test.empty();
shortTruck.active=true;
shortTruck.preprintedWms=12;
shortTruck.expectedPallets=12;
shortTruck.actualPallets=11;
shortTruck.completed=11;
assert.strictEqual(F._test.canClose(shortTruck).ok,false,'one unused label must block close until reconciled');
shortTruck.discardedLabels=1;
assert.strictEqual(F._test.canClose(shortTruck).ok,true,'12 printed / 11 used / 1 discarded is balanced');

const missingPallet=F._test.empty();
missingPallet.active=true;
missingPallet.preprintedWms=12;
missingPallet.actualPallets=12;
missingPallet.completed=11;
missingPallet.discardedLabels=1;
assert.strictEqual(F._test.canClose(missingPallet).ok,false,'missing actual pallet must block close even if label count balances');

console.log('PASS V55 field session V1: WMS label balance + pallet completion rules');
