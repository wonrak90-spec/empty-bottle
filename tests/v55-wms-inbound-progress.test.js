const fs=require('fs');
const vm=require('vm');
const assert=require('assert');

const code=fs.readFileSync('v55-wms-inbound-progress.js','utf8');
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
    getElementById(){return null;},
    createElement(){return {className:'',id:'',innerHTML:'',style:{}};}
  },
  setStatus(){}
};
ctx.window=ctx;
vm.createContext(ctx);
vm.runInContext(code,ctx,{filename:'v55-wms-inbound-progress.js'});

const P=ctx.V55InboundProgress;
assert.ok(P);
assert.strictEqual(P.VERSION,'V55-WMS-INBOUND-PROGRESS-1');

const first={
  inboundNo:'26004032',
  itemCode:'2000982',
  product:'까스활명수큐병',
  containerFrom:'0004',
  containerTo:'0048',
  finalResult:'적합',
  labelMatch:'일치'
};
assert.deepStrictEqual(JSON.parse(JSON.stringify(P.seqInfo(first))),{
  current:4,total:48,currentText:'0004',totalText:'0048'
});
assert.strictEqual(P.keyOf(first),'26004032|2000982');

let check=P.validateBeforeSave(first);
assert.strictEqual(check.ok,true);
assert.strictEqual(check.tracked,true);

P.onSingleSaved(first);
check=P.validateBeforeSave(first);
assert.strictEqual(check.ok,false);
assert.strictEqual(check.duplicate,true);

const second={...first,containerFrom:'0005'};
assert.strictEqual(P.validateBeforeSave(second).ok,true);
P.onSingleSaved(second);

const g=P.groups['26004032|2000982'];
assert.strictEqual(g.total,48);
assert.deepStrictEqual(Array.from(g.done),[4,5]);
assert.strictEqual(P.missingOf(g).length,46);
assert.strictEqual(P.missingOf(g)[0],1);
assert.strictEqual(P.missingOf(g)[3],6);

const invalid={...first,containerFrom:'0049',containerTo:'0048'};
assert.strictEqual(P.seqInfo(invalid),null);
assert.strictEqual(P.validateBeforeSave(invalid).ok,true);
assert.strictEqual(P.validateBeforeSave(invalid).tracked,false);

const noTotal={...first,containerFrom:'0004',containerTo:''};
assert.strictEqual(P.seqInfo(noTotal),null);

const review={...first,inboundNo:'26004033',itemCode:'2000990',product:'판콜액 병',containerFrom:'0001',containerTo:'0028',finalResult:'확인필요',labelMatch:'불일치'};
P.onSingleSaved(review);
const g2=P.groups['26004033|2000990'];
assert.deepStrictEqual(Array.from(g2.review),[1]);
assert.strictEqual(g2.total,28);

console.log('PASS V55 WMS inbound progress V1: sequence tracking + duplicate prevention');
