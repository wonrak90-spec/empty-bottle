const fs=require('fs');
const path=require('path');
const vm=require('vm');
const assert=require('assert');

const source=fs.readFileSync(path.join(__dirname,'..','v56-reporting.js'),'utf8');

class El{
  constructor(id){this.id=id;this.children=[];this.textContent='';this.innerHTML='';this.style={};this.className='';this.onclick=null;}
  appendChild(x){this.children.push(x);}
  querySelectorAll(){return [];}
  remove(){}
}
function make(){
  const els={v22ViewTools:new El('v22ViewTools')};
  const ctx={
    console:{info(){},warn(){},error(){}},
    document:{
      readyState:'complete',
      getElementById:id=>els[id]||null,
      addEventListener(){},
      createElement:()=>new El('')
    },
    setTimeout(){return 0;},
    clearTimeout(){},
    window:null,
    V22:{selectedIds:new Set()},
    V24:{},
    Map,Set,Date,JSON,String,Number,Boolean,Array,Object,RegExp,Math,Promise
  };
  ctx.window=ctx;
  vm.createContext(ctx);
  vm.runInContext(source,ctx,{filename:'v56-reporting.js'});
  return ctx;
}

function item(record,links=[]){return {record,pallets:[],productionLinks:links};}

async function test(name,fn){
  try{await fn();process.stdout.write('PASS  '+name+'\n');}
  catch(e){process.stderr.write('FAIL  '+name+'\n'+(e.stack||e)+'\n');process.exitCode=1;}
}

(async()=>{
  await test('일일 Summary 기본 집계',async()=>{
    const ctx=make();
    const s=ctx.V56Reporting.summarizeDaily([
      item({id:'R1',regDate:'2026-09-18 08:10',mode:'단건',inboundNo:'I1',product:'A병',supplier:'S1',actualQty:'1000',unit:'EA',finalResult:'적합',inspector:'홍길동'}),
      item({id:'R2',regDate:'2026-09-18 09:20',mode:'단건',inboundNo:'I2',product:'A병',supplier:'S1',displayQty:'1200',unit:'EA',finalResult:'확인필요',labelMatch:'불일치',inspector:'홍길동'}),
      item({id:'R3',regDate:'2026-09-18 10:00',mode:'다중파레트',inboundNo:'I3',product:'B병',supplier:'S2',palletCount:3,totalQty:'3000',finalResult:'적합',inspector:'김검수'})
    ]);
    assert.strictEqual(s.records,3);
    assert.strictEqual(s.pallets,5);
    assert.strictEqual(s.qty,5200);
    assert.strictEqual(s.ok,2);
    assert.strictEqual(s.issues,1);
    assert.strictEqual(s.productCount,2);
    assert.strictEqual(s.supplierCount,2);
    assert.deepStrictEqual(Array.from(s.inspectors).sort(),['김검수','홍길동']);
    assert.deepStrictEqual(Array.from(s.dates),['2026-09-18']);
  });

  await test('품목별 입고건/파레트/수량 집계',async()=>{
    const ctx=make();
    const s=ctx.V56Reporting.summarizeDaily([
      item({regDate:'2026-09-18',mode:'단건',inboundNo:'I1',product:'A병',actualQty:'1000',finalResult:'적합'}),
      item({regDate:'2026-09-18',mode:'단건',inboundNo:'I1',product:'A병',actualQty:'500',finalResult:'적합'}),
      item({regDate:'2026-09-18',mode:'다중파레트',inboundNo:'I2',product:'A병',palletCount:2,totalQty:'2000',finalResult:'확인필요'})
    ]);
    const a=s.products.find(x=>x.product==='A병');
    assert.ok(a);
    assert.strictEqual(a.records,3);
    assert.strictEqual(a.inboundCount,2);
    assert.strictEqual(a.pallets,4);
    assert.strictEqual(a.qty,3500);
    assert.strictEqual(a.issues,1);
  });

  await test('생산제품/Lot별 Pallet Summary 집계',async()=>{
    const ctx=make();
    const s=ctx.V56Reporting.summarizeTrace([
      item({id:'R1',product:'A병'},[
        {productionId:'P1',productName:'제품X',lotNo:'L001',inboundNo:'I1',containerNo:'1',product:'A병',qty:'1000'},
        {productionId:'P1',productName:'제품X',lotNo:'L001',inboundNo:'I1',containerNo:'2',product:'A병',qty:'1000'}
      ]),
      item({id:'R2',product:'B병'},[
        {productionId:'P2',productName:'제품Y',lotNo:'L002',inboundNo:'I2',containerNo:'1',product:'B병',qty:'500'}
      ])
    ]);
    assert.strictEqual(s.groups.length,2);
    assert.strictEqual(s.links.length,3);
    assert.strictEqual(s.unlinked.length,0);
    const x=s.groups.find(g=>g.productionId==='P1');
    assert.strictEqual(x.pallets,2);
    assert.strictEqual(x.qty,2000);
    assert.strictEqual(x.recordCount,1);
    assert.deepStrictEqual(Array.from(x.bottles),['A병']);
  });

  await test('생산 미연동 검수기록 별도 식별',async()=>{
    const ctx=make();
    const s=ctx.V56Reporting.summarizeTrace([
      item({id:'R1',product:'A병'},[]),
      item({id:'R2',product:'B병'},[{productionId:'P2',productName:'제품Y',lotNo:'L2',qty:'500'}])
    ]);
    assert.strictEqual(s.unlinked.length,1);
    assert.strictEqual(s.unlinked[0].id,'R1');
  });

  await test('V56 Reporting API 노출',async()=>{
    const ctx=make();
    assert.ok(ctx.V56Reporting);
    assert.strictEqual(ctx.V56Reporting.VERSION,'V56-REPORTING-1');
    assert.strictEqual(typeof ctx.V56Reporting.summarizeDaily,'function');
    assert.strictEqual(typeof ctx.V56Reporting.summarizeTrace,'function');
    assert.strictEqual(typeof ctx.V56Reporting.printDailySummary,'function');
    assert.strictEqual(typeof ctx.V56Reporting.printTraceSummary,'function');
  });

  if(process.exitCode)process.exit(process.exitCode);
  process.stdout.write('\nAll V56 reporting regression tests passed.\n');
})();