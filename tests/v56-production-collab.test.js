const fs=require('fs');
const path=require('path');
const vm=require('vm');
const assert=require('assert');

const source=fs.readFileSync(path.join(__dirname,'..','v56-production-collab.js'),'utf8');

function make(){
  const ctx={
    console:{info(){},warn(){},error(){}},
    document:{readyState:'loading',addEventListener(){},getElementById(){return null;}},
    window:null,
    setTimeout(){return 0;},clearTimeout(){},setInterval(){return 0;},clearInterval(){},
    Map,Set,Date,JSON,String,Number,Boolean,Array,Object,RegExp,Math,Promise
  };
  ctx.window=ctx;
  vm.createContext(ctx);
  vm.runInContext(source,ctx,{filename:'v56-production-collab.js'});
  return ctx;
}

async function test(name,fn){
  try{await fn();process.stdout.write('PASS  '+name+'\n');}
  catch(e){process.stderr.write('FAIL  '+name+'\n'+(e.stack||e)+'\n');process.exitCode=1;}
}

(async()=>{
  await test('진행 중 작업만 목록에 남김',async()=>{
    const ctx=make();
    const items=ctx.V56ProductionCollab.normalize([
      {productionId:'P1',productName:'제품A',lotNo:'L1',status:'ACTIVE',updatedAt:'2026-09-18 10:00'},
      {productionId:'P2',productName:'제품B',lotNo:'L2',status:'CLOSED',updatedAt:'2026-09-18 11:00'}
    ]);
    assert.strictEqual(items.length,1);
    assert.strictEqual(items[0].productionId,'P1');
  });

  await test('최근 활동 생산작업이 먼저 표시됨',async()=>{
    const ctx=make();
    const items=ctx.V56ProductionCollab.normalize([
      {productionId:'P1',status:'ACTIVE',updatedAt:'2026-09-18 10:00'},
      {productionId:'P2',status:'ACTIVE',updatedAt:'2026-09-18 12:00'},
      {productionId:'P3',status:'ACTIVE',updatedAt:'2026-09-18 11:00'}
    ]);
    assert.deepStrictEqual(Array.from(items,x=>x.productionId),['P2','P3','P1']);
  });

  await test('참여자와 Pallet 집계값 정규화',async()=>{
    const ctx=make();
    const items=ctx.V56ProductionCollab.normalize([
      {id:'P1',productName:'제품A',lotNo:'L1',workers:['작업자A','작업자B'],palletCount:'8',total:'108,864',updatedAt:'2026-09-18 12:00'}
    ]);
    assert.strictEqual(items[0].productionId,'P1');
    assert.deepStrictEqual(Array.from(items[0].workers),['작업자A','작업자B']);
    assert.strictEqual(items[0].palletCount,8);
    assert.strictEqual(items[0].total,108864);
  });

  await test('공동작업 API 노출',async()=>{
    const ctx=make();
    assert.ok(ctx.V56ProductionCollab);
    assert.strictEqual(ctx.V56ProductionCollab.VERSION,'V56-PROD-COLLAB-1');
    assert.strictEqual(typeof ctx.V56ProductionCollab.load,'function');
    assert.strictEqual(typeof ctx.V56ProductionCollab.join,'function');
    assert.strictEqual(typeof ctx.V56ProductionCollab.openCurrent,'function');
    assert.strictEqual(typeof ctx.V56ProductionCollab.closeCurrent,'function');
  });

  if(process.exitCode)process.exit(process.exitCode);
  process.stdout.write('\nAll V56 production collaboration tests passed.\n');
})();