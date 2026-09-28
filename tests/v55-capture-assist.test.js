const fs=require('fs');
const vm=require('vm');
const assert=require('assert');

const code=fs.readFileSync('v55-capture-assist.js','utf8');
const els={};
function el(id,value=''){
  els[id]={id,value,String,style:{},className:'',textContent:'',addEventListener(){},closest(){return null;}};
  return els[id];
}
[
  'inboundNo','inboundDate','product','itemCode','manufacturer','supplier','displayQty','unit',
  'expiryDate','containerFrom','containerTo','codeRaw','actualQty',
  'vProduct','vQty','vProdDate','vProdTime','vLotNo','vPalletNo','vLine'
].forEach(id=>el(id,''));

const ctx={
  console,
  window:null,
  document:{
    readyState:'loading',
    addEventListener(){},
    getElementById:id=>els[id]||null,
    querySelector(){return null;},
    createElement(){return {style:{},appendChild(){},setAttribute(){}};}
  },
  setTimeout,
  setStatus(){},
  updateSingleQty(){},
  compareLabels(){},
  V55InboundProgress:{refresh(){}},
  V55WmsQuality:{render(){}}
};
ctx.window=ctx;
vm.createContext(ctx);
vm.runInContext(code,ctx,{filename:'v55-capture-assist.js'});

const C=ctx.V55CaptureAssist;
assert.ok(C);
assert.strictEqual(C.VERSION,'V55-CAPTURE-ASSIST-1.2.1');
assert.strictEqual(C._test.saneRange('0015','0028'),true);
assert.strictEqual(C._test.saneRange('00157','0028'),false);
assert.strictEqual(C._test.severeQtyMismatch('1640','21320'),true);
assert.strictEqual(C._test.severeQtyMismatch('21320','21320'),false);

const yy=String(new Date().getFullYear()).slice(-2);
els.inboundNo.value=yy+'004291';
els.containerFrom.value='00157';
els.containerTo.value='0028';
els.displayQty.value='1640';
els.vQty.value='21320';
els.product.value='판콜액 병';

let changed=C._test.mergeWms({
  inboundNo:'28009999',
  containerFrom:'0015',
  containerTo:'0028',
  displayQty:'21320',
  product:'엉뚱한 품명',
  itemCode:'2000990'
});
assert.strictEqual(els.inboundNo.value,yy+'004291','valid existing management number must not be overwritten');
assert.strictEqual(els.containerFrom.value,'0015');
assert.strictEqual(els.containerTo.value,'0028');
assert.strictEqual(els.displayQty.value,'21320');
assert.strictEqual(els.product.value,'판콜액 병','existing valid product must be preserved');
assert.strictEqual(els.itemCode.value,'2000990','blank item code may be filled');
assert.ok(changed.includes('Pallet 순번'));
assert.ok(changed.includes('WMS 수량'));

els.vProduct.value='판콜에이병 30ml';
els.vQty.value='1640';
els.vPalletNo.value='';
els.displayQty.value='21320';
changed=C._test.mergeVendor({
  product:'다른품명',
  qty:'21320',
  palletNo:'75',
  prodDate:'2026-09-28'
});
assert.strictEqual(els.vProduct.value,'판콜에이병 30ml','existing vendor product must not be overwritten');
assert.strictEqual(els.vQty.value,'21320','severe bad vendor qty may be replaced only by WMS-matching close-up result');
assert.strictEqual(els.vPalletNo.value,'75');
assert.strictEqual(els.vProdDate.value,'2026-09-28');

// A hidden preview may still contain the previous pallet image after save/reset.
// It must never unlock photo view/close-up for the next pallet.
els.wmsPreview={
  id:'wmsPreview',src:'data:image/jpeg;base64,OLD',
  classList:{contains:x=>x==='hidden'}
};
ctx.lastPhotoDataUrl={wms:'',vendor:''};
assert.strictEqual(C._test.fullPhoto('wms'),'',
  'hidden stale preview from previous pallet must be ignored');

els.wmsPreview.classList={contains:()=>false};
assert.strictEqual(C._test.fullPhoto('wms'),'data:image/jpeg;base64,OLD',
  'visible current preview may be used as fallback');

ctx.lastPhotoDataUrl={wms:'data:image/jpeg;base64,CURRENT',vendor:''};
els.wmsPreview.src='data:image/jpeg;base64,OLD';
assert.strictEqual(C._test.fullPhoto('wms'),'data:image/jpeg;base64,CURRENT',
  'current evidence buffer must take precedence over preview src');

console.log('PASS V55 capture assist V1.2.1: live-first modal + safe merge + stale-photo isolation');
