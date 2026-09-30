const fs=require('fs');
const vm=require('vm');
const assert=require('assert');

const code=fs.readFileSync('v56-fast-flow.js','utf8');
const els={};
function cls(){
  const s=new Set();
  return {add(...x){x.forEach(v=>s.add(v));},remove(...x){x.forEach(v=>s.delete(v));},contains(x){return s.has(x);},toggle(x,on){if(on===undefined)on=!s.has(x);on?s.add(x):s.delete(x);return on;}};
}
function add(id,value=''){els[id]={id,value,textContent:'',className:'',classList:cls(),addEventListener(){}};return els[id];}
[
  'inboundNo','itemCode','displayQty','containerFrom','containerTo',
  'vProduct','vQty','actualQty','matchYes','matchNo','mixYes','mixNo'
].forEach(id=>add(id,''));
els.inboundNo.value='26004291';
els.itemCode.value='2000990';
els.displayQty.value='21320';
els.containerFrom.value='0015';
els.containerTo.value='0028';
els.vProduct.value='판콜에이병 30ml';
els.vQty.value='21320';

let saved=0,qtyUpdated=0;
const ctx={
  console,
  window:null,
  document:{
    readyState:'loading',
    addEventListener(){},
    getElementById:id=>els[id]||null,
    body:{classList:cls()},
    createElement(){return {style:{},classList:cls(),appendChild(){}};}
  },
  setTimeout,
  navigator:{},
  singleMatchOk:true,
  V55WmsQuality:{inspectForm:()=>({ok:true,issues:[]})},
  updateSingleQty(){qtyUpdated++;},
  saveSingleRecord:async()=>{saved++;},
  addEventListener(){}
};
ctx.window=ctx;
vm.createContext(ctx);
vm.runInContext(code,ctx,{filename:'v56-fast-flow.js'});

const F=ctx.V56FastFlow;
assert.ok(F);
assert.strictEqual(F.VERSION,'V56-FAST-FLOW-1.1');
assert.strictEqual(F.state().ready,true,'normal matching pallet with vendor evidence must be fast-save ready');
ctx.V56VendorDistance.evidenceReady=()=>false;
assert.strictEqual(F.state().ready,false,'vendor fields alone must not enable fast save without current pallet evidence photo');
ctx.V56VendorDistance.evidenceReady=()=>true;

(async()=>{
  await F.normalSave();
  assert.strictEqual(saved,1,'one-tap normal save must call saveSingleRecord once');
  assert.strictEqual(els.matchYes.classList.contains('sel-ok'),true);
  assert.strictEqual(els.mixNo.classList.contains('sel-ok'),true);
  assert.strictEqual(els.actualQty.value,'21320');
  assert.ok(qtyUpdated>0);

  ctx.singleMatchOk=false;
  assert.strictEqual(F.state().ready,false,'mismatch must disable fast normal save');

  ctx.singleMatchOk=true;
  ctx.V55WmsQuality.inspectForm=()=>({ok:false,issues:[{code:'qty_extreme'}]});
  assert.strictEqual(F.state().ready,false,'quality failure must disable fast normal save');

  console.log('PASS V56 fast flow 1.1: evidence-gated one-tap save + exception lockout');
})().catch(e=>{console.error(e);process.exit(1);});
