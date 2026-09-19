const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');

const source = fs.readFileSync(path.join(__dirname, '..', 'v55-ocr-learning.js'), 'utf8');

function makeStore(){
  const m = new Map();
  return {
    getItem:k => m.has(k) ? m.get(k) : null,
    setItem:(k,v) => m.set(k,String(v)),
    removeItem:k => m.delete(k),
    clear:() => m.clear()
  };
}

function makeContext(){
  const state = {
    calls: [],
    saveCounter: 0,
    saveOk: true,
    learningHandler: null,
    ocrResult: {text:'WMS RAW',items:[]},
    wmsParsed: {},
    vendorParsed: {},
    vendorTemplate: ''
  };

  const ctx = {
    console: {info(){}, warn(){}, error(){}},
    document: {readyState:'complete', addEventListener(){}},
    localStorage: makeStore(),
    setTimeout(){ return 0; },
    clearTimeout(){},
    setInterval(){ return 0; },
    clearInterval(){},
    Date, JSON, String, Number, Boolean, Array, Object, Set, Map, RegExp, Math, Promise,
    V26KoreanOCR: {
      VERSION:'TEST-OCR',
      async recognize(){ return state.ocrResult; }
    },
    V26WmsCardScan: {
      VERSION:'TEST-WMS',
      parseWms(){ return Object.assign({}, state.wmsParsed); }
    },
    V26VendorTemplates: {
      VERSION:'TEST-VENDOR',
      parse(){ return Object.assign({}, state.vendorParsed); },
      detect(){ return state.vendorTemplate; }
    }
  };

  ctx.apiPost = async function(action,payload){
    state.calls.push({action,payload});
    if(action === 'ocrLearningSave'){
      if(state.learningHandler) return state.learningHandler(payload);
      return {ok:true};
    }
    if(action === 'saveSingle' || action === 'saveMulti'){
      state.saveCounter += 1;
      return state.saveOk ? {ok:true,id:'R'+state.saveCounter,total:1,mixedCount:0} : {ok:false,message:'save failed'};
    }
    if(action === 'addProductionPallet'){
      return state.saveOk ? {ok:true} : {ok:false,message:'prod failed'};
    }
    return {ok:true};
  };

  ctx.window = ctx;
  vm.createContext(ctx);
  vm.runInContext(source,ctx,{filename:'v55-ocr-learning.js'});
  return {ctx,state};
}

function wmsPayload(overrides={}){
  return Object.assign({
    inboundNo:'26091801',
    inboundDate:'2026-09-18',
    product:'까스활명수75mL병',
    itemCode:'1234567',
    manufacturer:'KC Glass',
    supplier:'공급업체A',
    displayQty:'13608',
    unit:'EA',
    expiryDate:'2027-09-18',
    containerFrom:'001',
    containerTo:'010',
    ocrRaw:'WMS RAW',
    photo:'data:image/jpeg;base64,PRIVATE_IMAGE_BYTES'
  },overrides);
}

async function test(name,fn){
  try{
    await fn();
    process.stdout.write('PASS  '+name+'\n');
  }catch(e){
    process.stderr.write('FAIL  '+name+'\n'+(e && e.stack || e)+'\n');
    process.exitCode=1;
  }
}

(async()=>{
  await test('기존 saveSingle 응답을 그대로 반환하고 Learning은 후행 처리', async()=>{
    const {ctx,state}=makeContext();
    state.wmsParsed=wmsPayload({displayQty:'13608.000'});
    delete state.wmsParsed.ocrRaw; delete state.wmsParsed.photo;
    const res=await ctx.apiPost('saveSingle',wmsPayload());
    assert.strictEqual(res.ok,true);
    assert.strictEqual(res.id,'R1');
    assert.strictEqual(state.calls[0].action,'saveSingle');
    const q=ctx.V55OcrLearning.loadQueue();
    assert.strictEqual(q.length,1);
    assert.strictEqual(q[0].source,'wms');
    assert.strictEqual(q[0].recordId,'R1');
  });

  await test('WMS 수량 13608.000 과 최종 13608을 동일값으로 판단', async()=>{
    const {ctx,state}=makeContext();
    state.wmsParsed={
      inboundNo:'26091801', inboundDate:'2026-09-18', product:'까스활명수75mL병',
      itemCode:'1234567', manufacturer:'KC Glass', supplier:'공급업체A',
      displayQty:'13608.000', unit:'EA', expiryDate:'2027-09-18',
      containerFrom:'001', containerTo:'010'
    };
    await ctx.apiPost('saveSingle',wmsPayload());
    const entry=ctx.V55OcrLearning.loadQueue()[0];
    assert.strictEqual(entry.diff.displayQty.changed,false);
    assert.strictEqual(entry.changedFields,0);
  });

  await test('업체라벨은 템플릿과 최종 수정값을 함께 기록', async()=>{
    const {ctx,state}=makeContext();
    state.wmsParsed={};
    state.vendorTemplate='동아에코팩';
    state.vendorParsed={product:'까스활명수75mL병',qty:'12000',prodDate:'2026-09-18',prodTime:'08:30',lotNo:'',palletNo:'12',line:'2'};
    const p=wmsPayload({
      ocrRaw:'',
      vendorOcrRaw:'DONGA RAW',
      vendorPhoto:'data:image/jpeg;base64,PRIVATE_VENDOR_IMAGE',
      vendorProduct:'까스활명수75mL병',vendorQty:'12000',vendorProdDate:'2026-09-18',
      vendorProdTime:'08:30',vendorLotNo:'',vendorPalletNo:'12',vendorLine:'2'
    });
    await ctx.apiPost('saveSingle',p);
    const q=ctx.V55OcrLearning.loadQueue();
    assert.strictEqual(q.length,1);
    assert.strictEqual(q[0].source,'vendor');
    assert.strictEqual(q[0].template,'동아에코팩');
    assert.strictEqual(q[0].changedFields,0);
  });

  await test('OCR 후 작업자 키인 수정 필드는 Learning Audit에 반드시 기록', async()=>{
    const {ctx,state}=makeContext();
    state.wmsParsed={
      inboundNo:'26091801',product:'까스활명수75mL병',itemCode:'1234567',
      displayQty:'13608000',unit:'EA'
    };
    ctx.V55OcrLearning.noteManualEdit('wms','displayQty','13608');
    await ctx.apiPost('saveSingle',wmsPayload({displayQty:'13608'}));
    const entry=ctx.V55OcrLearning.loadQueue()[0];
    assert.deepStrictEqual(Array.from(entry.manualEditedFields),['displayQty']);
    assert.deepStrictEqual(Array.from(entry.manualChangedFields),['displayQty']);
    assert.strictEqual(entry.manualEditCount,1);
    assert.strictEqual(entry.correctionType,'OCR_KEYIN_CORRECTION');
    assert.strictEqual(entry.diff.displayQty.ocr,'13608000');
    assert.strictEqual(entry.diff.displayQty.final,'13608');
  });

  await test('사진 바이너리를 Learning queue에 저장하지 않음', async()=>{
    const {ctx,state}=makeContext();
    state.wmsParsed={inboundNo:'26091801',displayQty:'13608'};
    await ctx.apiPost('saveSingle',wmsPayload());
    const raw=JSON.stringify(ctx.V55OcrLearning.loadQueue());
    assert.ok(!raw.includes('PRIVATE_IMAGE_BYTES'));
    assert.ok(!raw.includes('data:image'));
  });

  await test('기존 입고 저장 실패 시 Learning 로그를 만들지 않음', async()=>{
    const {ctx,state}=makeContext();
    state.saveOk=false;
    const res=await ctx.apiPost('saveSingle',wmsPayload());
    assert.strictEqual(res.ok,false);
    assert.strictEqual(ctx.V55OcrLearning.loadQueue().length,0);
  });

  await test('Learning backend 실패가 기존 저장 성공을 되돌리지 않고 queue를 보존', async()=>{
    const {ctx,state}=makeContext();
    state.wmsParsed={inboundNo:'26091801',displayQty:'13608'};
    const res=await ctx.apiPost('saveSingle',wmsPayload());
    assert.strictEqual(res.ok,true);
    state.learningHandler=async()=>({ok:false,message:'backend unavailable'});
    await ctx.V55OcrLearning.flush(true);
    assert.strictEqual(ctx.V55OcrLearning.loadQueue().length,1);
  });

  await test('동기화 중 새로 저장된 Learning 로그를 유실하지 않음', async()=>{
    const {ctx,state}=makeContext();
    state.wmsParsed={inboundNo:'26091801',displayQty:'13608'};
    await ctx.apiPost('saveSingle',wmsPayload({ocrRaw:'FIRST RAW'}));
    let release;
    state.learningHandler=()=>new Promise(resolve=>{release=resolve;});
    const flushing=ctx.V55OcrLearning.flush(true);
    assert.strictEqual(typeof release,'function');

    state.wmsParsed={inboundNo:'26091802',displayQty:'12000'};
    await ctx.apiPost('saveSingle',wmsPayload({inboundNo:'26091802',displayQty:'12000',ocrRaw:'SECOND RAW'}));
    assert.strictEqual(ctx.V55OcrLearning.loadQueue().length,2);

    release({ok:true});
    await flushing;
    const q=ctx.V55OcrLearning.loadQueue();
    assert.strictEqual(q.length,1);
    assert.strictEqual(q[0].ocrRaw,'SECOND RAW');
    assert.strictEqual(q[0].recordId,'R2');
  });

  await test('생산 WMS OCR은 검수 Record ID와 연결', async()=>{
    const {ctx,state}=makeContext();
    state.ocrResult={text:'PRODUCTION RAW',items:[]};
    state.wmsParsed={inboundNo:'26091801',product:'병',itemCode:'1234567',supplier:'공급A',displayQty:'1000',unit:'EA',containerFrom:'15'};
    await ctx.V26KoreanOCR.recognize('image',false,'prodSearchStatus');
    await ctx.apiPost('addProductionPallet',{
      productionId:'PROD-1',recordId:'REC-77',inboundNo:'26091801',product:'병',
      itemCode:'1234567',supplier:'공급A',qty:'1000',unit:'EA',containerNo:'15'
    });
    const q=ctx.V55OcrLearning.loadQueue();
    assert.strictEqual(q.length,1);
    assert.strictEqual(q[0].source,'production_wms');
    assert.strictEqual(q[0].recordId,'REC-77');
    assert.strictEqual(q[0].productionId,'PROD-1');
  });

  await test('Learning client script 문법 및 필수 API 노출', async()=>{
    const {ctx}=makeContext();
    assert.ok(ctx.V55OcrLearning);
    assert.strictEqual(typeof ctx.V55OcrLearning.flush,'function');
    assert.strictEqual(typeof ctx.V55OcrLearning.loadQueue,'function');
    assert.strictEqual(typeof ctx.V55OcrLearning.noteManualEdit,'function');
  });

  if(process.exitCode) process.exit(process.exitCode);
  process.stdout.write('\nAll V55 Learning Store regression tests passed.\n');
})();
