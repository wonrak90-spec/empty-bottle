const fs=require('fs');
const path=require('path');
const vm=require('vm');
const assert=require('assert');

const storeSource=fs.readFileSync(path.join(__dirname,'..','OCR_LEARNING_STORE_V1.gs'),'utf8');
const routerSource=fs.readFileSync(path.join(__dirname,'..','OCR_LEARNING_ROUTER_V1.gs'),'utf8');

class Range{
  constructor(sheet,row,col,nr,nc){
    this.sheet=sheet;this.row=row;this.col=col;
    this.nr=nr==null?1:nr;this.nc=nc==null?1:nc;
  }
  _ensure(r,c){
    while(this.sheet.rows.length<r)this.sheet.rows.push([]);
    while(this.sheet.rows[r-1].length<c)this.sheet.rows[r-1].push('');
  }
  getValues(){
    const out=[];
    for(let r=0;r<this.nr;r++){
      const row=[];
      for(let c=0;c<this.nc;c++){
        const rr=this.row+r,cc=this.col+c;
        this._ensure(rr,cc);row.push(this.sheet.rows[rr-1][cc-1]);
      }
      out.push(row);
    }
    return out;
  }
  setValues(vals){
    for(let r=0;r<vals.length;r++)for(let c=0;c<vals[r].length;c++){
      const rr=this.row+r,cc=this.col+c;
      this._ensure(rr,cc);this.sheet.rows[rr-1][cc-1]=vals[r][c];
    }
    return this;
  }
  getValue(){return this.getValues()[0][0];}
  setValue(v){this._ensure(this.row,this.col);this.sheet.rows[this.row-1][this.col-1]=v;return this;}
}
class Sheet{
  constructor(name){this.name=name;this.rows=[];}
  getLastRow(){return this.rows.length;}
  getLastColumn(){return this.rows.reduce((m,r)=>Math.max(m,r.length),0);}
  getRange(r,c,nr,nc){return new Range(this,r,c,nr,nc);}
  getDataRange(){return new Range(this,1,1,Math.max(1,this.getLastRow()),Math.max(1,this.getLastColumn()));}
  appendRow(row){this.rows.push(Array.from(row));return this;}
  setFrozenRows(){}
}
class Spreadsheet{
  constructor(){this.sheets=new Map();}
  getSheetByName(name){return this.sheets.get(name)||null;}
  insertSheet(name){const s=new Sheet(name);this.sheets.set(name,s);return s;}
}

function make(){
  const ss=new Spreadsheet();
  const records=ss.insertSheet('Records');
  records.appendRow(['ID','품명','라벨사진URL','업체라벨사진URL']);
  records.appendRow(['R1','A병','https://drive.test/wms-r1','https://drive.test/vendor-r1']);
  records.appendRow(['R2','B병','https://drive.test/wms-r2','https://drive.test/vendor-r2']);

  let uuid=0;
  const lock={wait:0,release:0};
  const ctx={
    console,
    getSs_:()=>ss,
    Utilities:{
      getUuid:()=> 'UUID-'+(++uuid),
      formatDate:(d,tz,fmt)=>{
        const x=d instanceof Date?d:new Date(d);
        const y=x.getFullYear(),m=String(x.getMonth()+1).padStart(2,'0'),day=String(x.getDate()).padStart(2,'0');
        if(fmt==='yyyy-MM-dd')return y+'-'+m+'-'+day;
        return y+'-'+m+'-'+day+' 00:00';
      }
    },
    LockService:{getScriptLock:()=>({waitLock(){lock.wait++;},releaseLock(){lock.release++;}})},
    PropertiesService:{getScriptProperties:()=>({getProperty:()=>''})},
    SpreadsheetApp:{openById:()=>ss},
    Date,JSON,String,Number,Boolean,Array,Object,Map,Set,RegExp,Math
  };
  vm.createContext(ctx);
  vm.runInContext(storeSource,ctx,{filename:'OCR_LEARNING_STORE_V1.gs'});
  vm.runInContext(routerSource,ctx,{filename:'OCR_LEARNING_ROUTER_V1.gs'});
  return {ctx,ss,lock};
}

function entry(overrides={}){
  return Object.assign({
    captureKey:'R1|wms||abc|final',
    capturedAt:'2026-09-18T10:00:00.000Z',
    recordId:'R1',
    source:'wms',
    template:'',
    datasetVersion:'',
    photoUrl:'',
    ocrEngine:'PP-OCRv5 Korean local',
    ocrModel:'korean_PP-OCRv5_mobile_rec',
    frontendVersion:'V55-OCR-LEARNING-1',
    ocrRaw:'입고번호 26001 수량 13608',
    ocr:{inboundNo:'26001',displayQty:'13608'},
    final:{inboundNo:'26001',displayQty:'13608'},
    diff:{
      inboundNo:{ocr:'26001',final:'26001',changed:false},
      displayQty:{ocr:'13608',final:'13608',changed:false}
    },
    comparedFields:2,
    changedFields:0,
    manualEditedFields:[],
    manualChangedFields:[],
    manualEditCount:0,
    correctionType:'NO_CORRECTION'
  },overrides);
}
const admin={name:'관리자',employeeNo:'1001',role:'admin'};
const operator={name:'작업자',employeeNo:'2001',role:'operator'};

function approve(ctx,id,note=''){
  return ctx.verifyOcrLearningV1_({id,status:'APPROVED',note},admin);
}
async function test(name,fn){
  try{await fn();process.stdout.write('PASS  '+name+'\n');}
  catch(e){process.stderr.write('FAIL  '+name+'\n'+(e&&e.stack||e)+'\n');process.exitCode=1;}
}

(async()=>{
  await test('초기 Setup은 OCR-DS-V1 ACTIVE를 생성',()=>{
    const {ctx,ss}=make();
    const r=ctx.setupOcrLearningStoreV1_();
    assert.strictEqual(r.ok,true);
    const ds=ss.getSheetByName('OCR_Dataset_Versions');
    assert.strictEqual(ds.getLastRow(),2);
    assert.strictEqual(ds.rows[1][0],'OCR-DS-V1');
    assert.strictEqual(ds.rows[1][2],'ACTIVE');
  });

  await test('Learning 저장은 Record ID로 기존 Drive WMS 사진 URL을 복원',()=>{
    const {ctx}=make();
    const r=ctx.saveOcrLearningV1_({entry:entry()},operator);
    assert.strictEqual(r.ok,true);
    assert.strictEqual(r.photoUrl,'https://drive.test/wms-r1');
    assert.strictEqual(r.datasetVersion,'OCR-DS-V1');
    const list=ctx.listOcrLearningV1_({status:'PENDING'},admin);
    assert.strictEqual(list.items.length,1);
    assert.strictEqual(list.items[0].capturedBy,'작업자 (2001)');
    assert.strictEqual(list.items[0].photoUrl,'https://drive.test/wms-r1');
  });

  await test('Vendor Learning은 업체라벨 Drive URL을 복원',()=>{
    const {ctx}=make();
    const e=entry({
      captureKey:'R1|vendor||v1|f1',
      source:'vendor',
      template:'동아에코팩',
      ocrRaw:'업체 라벨 OCR',
      ocr:{product:'A병',palletNo:'11'},
      final:{product:'A병',palletNo:'12'},
      diff:{
        product:{ocr:'A병',final:'A병',changed:false},
        palletNo:{ocr:'11',final:'12',changed:true}
      },
      comparedFields:2,changedFields:1
    });
    const r=ctx.saveOcrLearningV1_({entry:e},operator);
    assert.strictEqual(r.photoUrl,'https://drive.test/vendor-r1');
  });

  await test('키인 수정 Audit 필드가 Learning Log에 영구 저장',()=>{
    const {ctx}=make();
    const e=entry({
      captureKey:'R1|wms||manual|final',
      ocrRaw:'수량 13608000',
      ocr:{displayQty:'13608000'},
      final:{displayQty:'13608'},
      diff:{displayQty:{ocr:'13608000',final:'13608',changed:true}},
      comparedFields:1,changedFields:1,
      manualEditedFields:['displayQty'],
      manualChangedFields:['displayQty'],
      manualEditCount:2,
      correctionType:'OCR_KEYIN_CORRECTION'
    });
    ctx.saveOcrLearningV1_({entry:e},operator);
    const list=ctx.listOcrLearningV1_({status:'PENDING'},admin);
    assert.deepStrictEqual(Array.from(list.items[0].manualEditedFields),['displayQty']);
    assert.deepStrictEqual(Array.from(list.items[0].manualChangedFields),['displayQty']);
    assert.strictEqual(list.items[0].manualEditCount,2);
    assert.strictEqual(list.items[0].correctionType,'OCR_KEYIN_CORRECTION');
  });

  await test('동일 CaptureKey 재전송은 중복 저장하지 않음',()=>{
    const {ctx,ss}=make();
    const a=ctx.saveOcrLearningV1_({entry:entry()},operator);
    const b=ctx.saveOcrLearningV1_({entry:entry()},operator);
    assert.strictEqual(a.ok,true);
    assert.strictEqual(b.ok,true);
    assert.strictEqual(b.duplicate,true);
    assert.strictEqual(ss.getSheetByName('OCR_Learning_Log').getLastRow(),2);
  });

  await test('Learning 상태 변경은 ScriptLock으로 보호',()=>{
    const {ctx,lock}=make();
    const r=ctx.saveOcrLearningV1_({entry:entry()},operator);
    ctx.verifyOcrLearningV1_({id:r.id,status:'APPROVED'},admin);
    ctx.createOcrDatasetVersionV1_({version:'OCR-DS-V2',activate:true},admin);
    assert.strictEqual(lock.wait,3);
    assert.strictEqual(lock.release,3);
  });

  await test('관리자만 Learning 목록/승인/품질지표 접근',()=>{
    const {ctx}=make();
    ctx.saveOcrLearningV1_({entry:entry()},operator);
    assert.throws(()=>ctx.listOcrLearningV1_({},operator),/관리자/);
    assert.throws(()=>ctx.ocrLearningMetricsV1_({},operator),/관리자/);
    assert.throws(()=>ctx.verifyOcrLearningV1_({id:'x',status:'APPROVED'},operator),/관리자/);
  });

  await test('승인 데이터만 OCR 품질지표에 반영',()=>{
    const {ctx}=make();
    const a=ctx.saveOcrLearningV1_({entry:entry()},operator);
    approve(ctx,a.id);

    const b=ctx.saveOcrLearningV1_({entry:entry({
      captureKey:'R1|vendor||abc2|final2',
      source:'vendor',
      template:'동아에코팩',
      ocrRaw:'업체 OCR',
      ocr:{product:'A병',palletNo:'11'},
      final:{product:'A병',palletNo:'12'},
      diff:{
        product:{ocr:'A병',final:'A병',changed:false},
        palletNo:{ocr:'11',final:'12',changed:true}
      },
      comparedFields:2,changedFields:1
    })},operator);
    approve(ctx,b.id);

    ctx.saveOcrLearningV1_({entry:entry({
      captureKey:'R2|wms||pending|pending',
      recordId:'R2',
      ocrRaw:'PENDING OCR',
      changedFields:2
    })},operator);

    const m=ctx.ocrLearningMetricsV1_({scope:'APPROVED'},admin);
    assert.strictEqual(m.samples,2);
    assert.strictEqual(m.comparedFields,4);
    assert.strictEqual(m.changedFields,1);
    assert.strictEqual(m.accuracy,75);
    assert.strictEqual(m.bySource.wms.samples,1);
    assert.strictEqual(m.bySource.vendor.samples,1);
    const pallet=m.fields.find(x=>x.field==='palletNo');
    assert.ok(pallet);
    assert.strictEqual(pallet.changed,1);
    assert.strictEqual(pallet.correctionRate,100);
  });

  await test('관리자 실시간 화면은 오늘 키인 수정/잠정 정확도/최근 수정자를 집계',()=>{
    const {ctx}=make();
    const today=new Date();
    const a=ctx.saveOcrLearningV1_({entry:entry({
      capturedAt:today.toISOString(),
      captureKey:'R1|wms||rt1|x',
      ocrRaw:'수량 13608000',
      ocr:{displayQty:'13608000'},
      final:{displayQty:'13608'},
      diff:{displayQty:{ocr:'13608000',final:'13608',changed:true}},
      comparedFields:1,changedFields:1,
      manualEditedFields:['displayQty'],manualChangedFields:['displayQty'],
      manualEditCount:1,correctionType:'OCR_KEYIN_CORRECTION'
    })},operator);
    approve(ctx,a.id);
    ctx.saveOcrLearningV1_({entry:entry({
      capturedAt:today.toISOString(),
      captureKey:'R2|wms||rt2|x',recordId:'R2'
    })},operator);
    const date=ctx.Utilities.formatDate(today,'Asia/Seoul','yyyy-MM-dd');
    const rt=ctx.ocrLearningRealtimeV1_({date,limit:20},admin);
    assert.strictEqual(rt.totalSamples,2);
    assert.strictEqual(rt.manualCorrectionSamples,1);
    assert.strictEqual(rt.pending,1);
    assert.strictEqual(rt.approved,1);
    assert.strictEqual(rt.comparedFields,3);
    assert.strictEqual(rt.changedFields,1);
    assert.strictEqual(rt.provisionalAccuracy,66.7);
    assert.strictEqual(rt.approvedAccuracy,0);
    assert.strictEqual(rt.topFields[0].field,'displayQty');
    assert.strictEqual(rt.recentCorrections[0].capturedBy,'작업자 (2001)');
  });

  await test('Dataset V2 활성화 후 신규 Learning은 V2로 저장',()=>{
    const {ctx}=make();
    const r=ctx.createOcrDatasetVersionV1_({version:'OCR-DS-V2',note:'현장 2차',activate:true},admin);
    assert.strictEqual(r.status,'ACTIVE');
    const versions=ctx.listOcrDatasetVersionsV1_(admin).items;
    const v1=versions.find(x=>x.version==='OCR-DS-V1');
    const v2=versions.find(x=>x.version==='OCR-DS-V2');
    assert.strictEqual(v1.status,'FROZEN');
    assert.strictEqual(v2.status,'ACTIVE');

    const saved=ctx.saveOcrLearningV1_({entry:entry({captureKey:'R2|wms||v2|x',recordId:'R2'})},operator);
    assert.strictEqual(saved.datasetVersion,'OCR-DS-V2');
  });

  await test('Manifest는 선택 Dataset의 승인 Sample만 export',()=>{
    const {ctx}=make();
    const a=ctx.saveOcrLearningV1_({entry:entry()},operator);
    approve(ctx,a.id);
    ctx.saveOcrLearningV1_({entry:entry({captureKey:'R2|wms||pending|x',recordId:'R2'})},operator);
    const m=ctx.exportOcrDatasetManifestV1_({datasetVersion:'OCR-DS-V1'},admin);
    assert.strictEqual(m.ok,true);
    assert.strictEqual(m.count,1);
    assert.strictEqual(m.items[0].id,a.id);
    assert.strictEqual(m.items[0].photoUrl,'https://drive.test/wms-r1');
  });

  await test('Router는 Metrics를 처리하고 무관 action은 기존 dispatcher로 넘김',()=>{
    const {ctx}=make();
    const a=ctx.saveOcrLearningV1_({entry:entry()},operator);approve(ctx,a.id);
    const handled=ctx.routeOcrLearningGetV1_('ocrLearningMetrics',{scope:'APPROVED'},admin);
    assert.strictEqual(handled.handled,true);
    assert.strictEqual(handled.result.samples,1);
    const realtime=ctx.routeOcrLearningGetV1_('ocrLearningRealtime',{date:ctx.Utilities.formatDate(new Date(),'Asia/Seoul','yyyy-MM-dd')},admin);
    assert.strictEqual(realtime.handled,true);
    assert.strictEqual(ctx.routeOcrLearningGetV1_('searchRecords',{},admin).handled,false);
    assert.strictEqual(ctx.routeOcrLearningPostV1_('saveSingle',{},admin).handled,false);
  });

  if(process.exitCode)process.exit(process.exitCode);
  process.stdout.write('\nAll V55 Learning Store backend tests passed.\n');
})();