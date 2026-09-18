const fs=require('fs');
const path=require('path');
const vm=require('vm');
const assert=require('assert');

const source=fs.readFileSync(path.join(__dirname,'..','V56_PRODUCTION_COLLAB.gs'),'utf8');

class Range{
  constructor(sheet,row,col,nr=1,nc=1){this.sheet=sheet;this.row=row;this.col=col;this.nr=nr||1;this.nc=nc||1;}
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
        this._ensure(rr,cc);
        row.push(this.sheet.rows[rr-1][cc-1]);
      }
      out.push(row);
    }
    return out;
  }
  setValues(vals){
    for(let r=0;r<vals.length;r++)for(let c=0;c<vals[r].length;c++){
      const rr=this.row+r,cc=this.col+c;this._ensure(rr,cc);
      this.sheet.rows[rr-1][cc-1]=vals[r][c];
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
  getRange(r,c,nr,nc){return new Range(this,r,c,nr||1,nc||1);}
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
  const pp=ss.insertSheet('ProductionPallets');
  pp.appendRow(['Production ID','제품명','제조번호','순번','입고번호','용기번호','Barcode/QR','품명','품목코드','수량','단위','검수결과','검수기록ID']);

  const lockState={wait:0,release:0};
  const ctx={
    console,
    getSs_:()=>ss,
    Session:{getScriptTimeZone:()=> 'Asia/Seoul'},
    Utilities:{formatDate:(d)=>d instanceof Date?'2026-09-18 23:00':String(d||'')},
    LockService:{
      getScriptLock:()=>({
        waitLock(){lockState.wait++;},
        releaseLock(){lockState.release++;}
      })
    },
    Date,JSON,String,Number,Boolean,Array,Object,Map,Set,RegExp,Math
  };
  vm.createContext(ctx);
  vm.runInContext(source,ctx,{filename:'V56_PRODUCTION_COLLAB.gs'});
  return {ctx,ss,pp,lockState};
}

async function test(name,fn){
  try{await fn();process.stdout.write('PASS  '+name+'\n');}
  catch(e){process.stderr.write('FAIL  '+name+'\n'+(e.stack||e)+'\n');process.exitCode=1;}
}

(async()=>{
  await test('작업자 A가 생산작업을 생성하면 ACTIVE 목록에 표시',()=>{
    const {ctx}=make();
    const a={name:'작업자A'};
    const r=ctx.openProductionCollabV56_({productionId:'P1',productName:'까스활명수',lotNo:'L001'},a);
    assert.strictEqual(r.ok,true);
    assert.strictEqual(r.created,true);
    const list=ctx.listProductionCollabV56_(a);
    assert.strictEqual(list.items.length,1);
    assert.strictEqual(list.items[0].productionId,'P1');
    assert.deepStrictEqual(Array.from(list.items[0].workers),['작업자A']);
  });

  await test('작업자 B와 C가 같은 Production ID에 참여',()=>{
    const {ctx}=make();
    ctx.openProductionCollabV56_({productionId:'P1',productName:'제품A',lotNo:'L001'},{name:'작업자A'});
    const b=ctx.joinProductionCollabV56_({productionId:'P1'},{name:'작업자B'});
    const c=ctx.joinProductionCollabV56_({productionId:'P1'},{name:'작업자C'});
    assert.strictEqual(b.ok,true);
    assert.strictEqual(c.ok,true);
    const list=ctx.listProductionCollabV56_({name:'작업자A'});
    assert.deepStrictEqual(Array.from(list.items[0].workers),['작업자A','작업자B','작업자C']);
  });

  await test('같은 작업자가 다시 참여해도 참여자 중복 없음',()=>{
    const {ctx}=make();
    ctx.openProductionCollabV56_({productionId:'P1',productName:'제품A',lotNo:'L001'},{name:'작업자A'});
    ctx.joinProductionCollabV56_({productionId:'P1'},{name:'작업자B'});
    ctx.joinProductionCollabV56_({productionId:'P1'},{name:'작업자B'});
    const list=ctx.listProductionCollabV56_({});
    assert.deepStrictEqual(Array.from(list.items[0].workers),['작업자A','작업자B']);
  });

  await test('기존 ProductionPallets를 기준으로 공동작업 Pallet/수량 집계',()=>{
    const {ctx,pp}=make();
    ctx.openProductionCollabV56_({productionId:'P1',productName:'제품A',lotNo:'L001'},{name:'작업자A'});
    pp.appendRow(['P1','제품A','L001',1,'I1','001','','A병','','13,608','EA','적합','R1']);
    pp.appendRow(['P1','제품A','L001',2,'I1','002','','A병','','13608','EA','적합','R2']);
    pp.appendRow(['P2','제품B','L002',1,'I2','001','','B병','','5000','EA','적합','R3']);
    const list=ctx.listProductionCollabV56_({});
    assert.strictEqual(list.items[0].palletCount,2);
    assert.strictEqual(list.items[0].total,27216);
  });

  await test('작업 완료 후 CLOSED 처리되어 진행 중 목록에서 제외',()=>{
    const {ctx}=make();
    ctx.openProductionCollabV56_({productionId:'P1',productName:'제품A',lotNo:'L001'},{name:'작업자A'});
    ctx.joinProductionCollabV56_({productionId:'P1'},{name:'작업자B'});
    const closed=ctx.closeProductionCollabV56_({productionId:'P1'},{name:'작업자A'});
    assert.strictEqual(closed.ok,true);
    assert.strictEqual(ctx.listProductionCollabV56_({}).items.length,0);
    const again=ctx.joinProductionCollabV56_({productionId:'P1'},{name:'작업자B'});
    assert.strictEqual(again.ok,false);
  });

  await test('로그인 사용자 없는 생성/참여 차단',()=>{
    const {ctx}=make();
    const open=ctx.openProductionCollabV56_({productionId:'P1',productName:'제품A',lotNo:'L1'},null);
    assert.strictEqual(open.ok,false);
    ctx.openProductionCollabV56_({productionId:'P2',productName:'제품B',lotNo:'L2'},{name:'작업자A'});
    const join=ctx.joinProductionCollabV56_({productionId:'P2'},null);
    assert.strictEqual(join.ok,false);
  });

  await test('상태 변경은 ScriptLock으로 보호',()=>{
    const {ctx,lockState}=make();
    ctx.openProductionCollabV56_({productionId:'P1',productName:'제품A',lotNo:'L1'},{name:'A'});
    ctx.joinProductionCollabV56_({productionId:'P1'},{name:'B'});
    ctx.touchProductionCollabV56_({productionId:'P1'},{name:'B'});
    ctx.closeProductionCollabV56_({productionId:'P1'},{name:'A'});
    assert.strictEqual(lockState.wait,4);
    assert.strictEqual(lockState.release,4);
  });

  if(process.exitCode)process.exit(process.exitCode);
  process.stdout.write('\nAll V56 Apps Script collaboration tests passed.\n');
})();