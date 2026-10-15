const fs=require('fs');
const vm=require('vm');
const assert=require('assert');

function cls(){
  const s=new Set();
  return {add(...x){x.forEach(v=>s.add(v));},remove(...x){x.forEach(v=>s.delete(v));},contains(x){return s.has(x);},toggle(x,on){if(on===undefined)on=!s.has(x);on?s.add(x):s.delete(x);return on;}};
}
function el(id,value=''){
  return {id,value,textContent:'',innerHTML:'',style:{},src:'',className:'',classList:cls(),disabled:false,
    addEventListener(){},closest(){return null;},scrollIntoView(){},removeAttribute(){},setAttribute(){}};
}

// 1) Static guards for the field fixes.
const app=fs.readFileSync('app.js','utf8');
const field=fs.readFileSync('v58-field-safe.js','utf8');
const vendor=fs.readFileSync('v56-vendor-distance.js','utf8');

assert.ok(app.includes('v58SwitchInboundFromParsedWms'),'new inbound switch guard must exist');
assert.ok(app.includes('currentItemInfo.itemName'),'ItemMaster canonical product must overwrite OCR product');
assert.ok(field.includes("payload.labelMatch='기준정보사용'"),'middle pallet must record 기준정보사용');
assert.ok(field.includes("payload.vendorOcrRaw=''"),'middle pallet must not persist stale vendor OCR');
assert.ok(field.includes("payload.vendorQty=lock.vendorQty||''"),'middle pallet vendor qty must come from lock');
assert.ok(field.includes("V22.startLive('wms')"),'next WMS camera must auto-start after save');
assert.ok(vendor.includes('ocrSkipped:true'),'middle pallet OCR must be skipped');
assert.ok(!vendor.slice(vendor.indexOf('async function laterCapture'),vendor.indexOf('D.capture=async function')).includes('recognizeVendorAngleAware'),
  'middle pallet laterCapture must never invoke vendor OCR');

// 2) Execute vendor module: middle Pallet evidence becomes ready without OCR.
const store={},els={};
for(const id of ['inboundNo','itemCode','vProduct','vQty','displayQty','containerFrom','containerTo','vendorPhoto','vendorStatus'])els[id]=el(id);
els.inboundNo.value='26004733';els.itemCode.value='2002867';els.displayQty.value='9072';
els.containerFrom.value='30';els.containerTo.value='42';
let uploads=0,ocrCalls=0;
const ctx={
  console,window:null,
  localStorage:{getItem:k=>store[k]||null,setItem:(k,v)=>store[k]=String(v)},
  document:{readyState:'loading',hidden:false,addEventListener(){},getElementById:id=>els[id]||null,
    createElement(){return el('x');},body:{appendChild(){},style:{}}},
  setTimeout:(fn)=>{fn();return 1;},
  clearTimeout(){},
  navigator:{},ImageCapture:undefined,FileReader:function(){},Image:function(){},CustomEvent:function(type,o){this.type=type;this.detail=o&&o.detail;},
  addEventListener(){},
  dispatchEvent(){},
  lastPhotoDataUrl:{vendor:''},lastOcrText:{vendor:''},
  V56FastFlow:{noteEvidence(){uploads++;},refresh(){}},
  OcrRuntime:{recognize(){ocrCalls++;throw new Error('middle OCR must not run');}},
  compareLabels(){},
  setStatus(){},
  singleMatchOk:true
};
ctx.window=ctx;
vm.createContext(ctx);
vm.runInContext(vendor,ctx,{filename:'v56-vendor-distance.js'});
const D=ctx.V56VendorDistance;
D._test.setLock('26004733|2002867',{vendorProduct:'유리병(각병) 100ml',vendorQty:'9072'});
D.currentKey='26004733|2002867';
(async()=>{
  const r=await D._test.laterCaptureForTest('data:image/jpeg;base64,AA',D._test.getLock('26004733|2002867'));
  assert.strictEqual(r.ocrSkipped,true);
  assert.strictEqual(D.evidenceReady(),true);
  assert.strictEqual(D.hasMismatch(),false);
  assert.strictEqual(uploads,1);
  assert.strictEqual(ocrCalls,0);
  assert.strictEqual(els.vQty.value,'9072');
  console.log('PASS R14: master-safe lock + new-inbound guard + middle OCR skip + next-WMS pipeline');
})().catch(e=>{console.error(e);process.exit(1);});
