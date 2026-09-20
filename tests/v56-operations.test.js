const fs=require('fs');
const path=require('path');
const vm=require('vm');
const assert=require('assert');

const source=fs.readFileSync(path.join(__dirname,'..','v56-operations.js'),'utf8');

class ClassList{
  constructor(){this.s=new Set();}
  add(...a){a.forEach(x=>this.s.add(x));}
  remove(...a){a.forEach(x=>this.s.delete(x));}
  contains(x){return this.s.has(x);}
  toggle(x,on){if(on===undefined){this.s.has(x)?this.s.delete(x):this.s.add(x);}else{on?this.s.add(x):this.s.delete(x);}}
}
class El{
  constructor(id){this.id=id;this.classList=new ClassList();this.value='';this.textContent='';this.innerHTML='';this.className='';this.style={};this.buttons=[];}
  querySelectorAll(sel){if(sel==='button')return this.buttons;return [];}
  querySelector(){return null;}
  closest(){return null;}
  removeAttribute(){}
  scrollIntoView(){}
}
function make(){
  const els={};
  const add=id=>(els[id]=new El(id));
  ['v22EditCard','v22EditFields','v22EditReason','v22EditStatus','v22EditActor','viewDetailCard'].forEach(add);
  els.v22EditCard.classList.add('hidden');
  const cancel=new El('cancel');cancel.textContent='취소';cancel.onclick='legacy';els.v22EditCard.buttons=[cancel];

  const state={load:0,detail:0,tabs:[]};
  const ctx={
    console:{info(){},warn(){},error(){}},
    document:{
      readyState:'complete',
      getElementById:id=>els[id]||null,
      addEventListener(){},
      createElement:id=>new El(id)
    },
    setTimeout:fn=>{fn();return 1;},
    clearTimeout(){},
    window:null,
    V22:{},
    V24:{
      session:{user:{name:'관리자A',role:'admin'}},
      async loadRecords(){state.load++;return {ok:true};}
    },
    currentViewRecord:{record:{id:'R1'}},
    async openRecordDetail(){state.detail++;return {ok:true};},
    showTab(tab){state.tabs.push(tab);return tab;}
  };
  ctx.window=ctx;
  vm.createContext(ctx);
  vm.runInContext(source,ctx,{filename:'v56-operations.js'});
  return {ctx,els,state,cancel};
}

async function test(name,fn){
  try{await fn();process.stdout.write('PASS  '+name+'\n');}
  catch(e){process.stderr.write('FAIL  '+name+'\n'+(e.stack||e)+'\n');process.exitCode=1;}
}

(async()=>{
  await test('수정 취소 시 이전 입력값이 완전히 초기화됨',async()=>{
    const {ctx,els,cancel}=make();
    els.v22EditCard.classList.remove('hidden');
    els.v22EditFields.innerHTML='<input value="OLD">';
    els.v22EditReason.value='이전 사유';
    els.v22EditStatus.textContent='이전 상태';
    assert.strictEqual(typeof cancel.onclick,'function');
    cancel.onclick();
    assert.ok(els.v22EditCard.classList.contains('hidden'));
    assert.strictEqual(els.v22EditFields.innerHTML,'');
    assert.strictEqual(els.v22EditReason.value,'');
    assert.strictEqual(els.v22EditStatus.textContent,'');
    assert.strictEqual(els.v22EditActor.value,'관리자A');
  });

  await test('목록 재조회 시 stale Record와 수정 폼 제거',async()=>{
    const {ctx,els,state}=make();
    els.v22EditCard.classList.remove('hidden');
    els.v22EditFields.innerHTML='OLD';
    await ctx.V24.loadRecords(2);
    assert.strictEqual(state.load,1);
    assert.strictEqual(ctx.currentViewRecord,null);
    assert.ok(els.v22EditCard.classList.contains('hidden'));
    assert.ok(els.viewDetailCard.classList.contains('hidden'));
  });

  await test('다른 상세 기록 오픈 전 이전 수정 폼만 초기화',async()=>{
    const {ctx,els,state}=make();
    const before=ctx.currentViewRecord;
    els.v22EditCard.classList.remove('hidden');
    els.v22EditReason.value='OLD';
    await ctx.openRecordDetail(1);
    assert.strictEqual(state.detail,1);
    assert.strictEqual(ctx.currentViewRecord,before);
    assert.ok(els.v22EditCard.classList.contains('hidden'));
    assert.strictEqual(els.v22EditReason.value,'');
  });

  await test('조회 탭 이탈 시 상세 Record context 제거',async()=>{
    const {ctx,state}=make();
    ctx.showTab('prod');
    assert.deepStrictEqual(state.tabs,['prod']);
    assert.strictEqual(ctx.currentViewRecord,null);
  });

  await test('V56 필수 API 노출',async()=>{
    const {ctx}=make();
    assert.ok(ctx.V56Operations);
    assert.strictEqual(ctx.V56Operations.VERSION,'V56-OPERATIONS-1');
    assert.strictEqual(typeof ctx.V56Operations.resetEditState,'function');
    assert.strictEqual(typeof ctx.V56Operations.cancelEdit,'function');
  });

  if(process.exitCode)process.exit(process.exitCode);
  process.stdout.write('\nAll V56 operations regression tests passed.\n');
})();