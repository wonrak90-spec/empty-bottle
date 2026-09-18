/* V56 Reporting extension
 * - Production linkage inside View/Print
 * - Claim/Deviation trace summary from selected inspection records
 * - Daily inspection summary for team leader reporting
 * No backend schema change: uses existing getRecord/batchGetRecords/trace APIs.
 */
(function(){
  'use strict';
  if(window.__V56_REPORTING__)return;
  window.__V56_REPORTING__=true;

  const R=window.V56Reporting={
    VERSION:'V56-REPORTING-1',
    traceCache:new Map()
  };
  const $=id=>document.getElementById(id);
  const esc=s=>String(s==null?'':s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const num=v=>{const n=Number(String(v==null?'':v).replace(/,/g,''));return Number.isFinite(n)?n:0;};
  const fmt=v=>num(v).toLocaleString('ko-KR');
  const txt=v=>String(v==null?'':v).trim();
  const dateOnly=v=>{
    const s=txt(v);
    const m=s.match(/(20\d{2})[-./년\s]+(\d{1,2})[-./월\s]+(\d{1,2})/);
    if(m)return m[1]+'-'+String(m[2]).padStart(2,'0')+'-'+String(m[3]).padStart(2,'0');
    return s.split(/[ T]/)[0]||'';
  };

  function selectedIds(){
    try{
      const ids=window.V22?Array.from(V22.selectedIds||[]):[];
      if(ids.length)return ids.map(String);
    }catch(_){}
    try{
      if(currentViewRecord&&currentViewRecord.record&&currentViewRecord.record.id)return [String(currentViewRecord.record.id)];
    }catch(_){}
    return [];
  }

  async function batchRecords(ids){
    const target=(ids||[]).filter(Boolean).slice(0,100);
    if(!target.length)return [];
    try{
      const res=await apiPost('batchGetRecords',{ids:target});
      if(res&&res.ok&&Array.isArray(res.items))return res.items;
    }catch(_){}
    const out=[];
    for(const id of target){
      try{
        const one=await apiGet('getRecord',{id});
        if(one&&one.ok&&one.record)out.push({record:one.record,pallets:one.pallets||[]});
      }catch(_){}
    }
    return out;
  }

  async function traceInbound(inboundNo){
    const key=txt(inboundNo);
    if(!key)return [];
    const hit=R.traceCache.get(key);
    if(hit&&Date.now()-hit.ts<120000)return hit.items;
    let items=[];
    try{
      const res=await apiGet('trace',{keyword:key});
      if(res&&res.ok)items=[...(res.byPallet||[]),...(res.byLot||[])];
    }catch(_){}
    const seen=new Set(),clean=[];
    for(const x of items){
      const k=[x.productionId,x.recordId,x.inboundNo,x.containerNo,x.productName,x.lotNo].join('|');
      if(seen.has(k))continue;seen.add(k);clean.push(x);
    }
    R.traceCache.set(key,{ts:Date.now(),items:clean});
    return clean;
  }

  function recordContainerMatches(record,link){
    const n=String(link&&link.containerNo||'').replace(/\D/g,'');
    if(!n)return true;
    const a=String(record&&record.containerFrom||'').replace(/\D/g,'');
    const b=String(record&&record.containerTo||'').replace(/\D/g,'');
    if(!a&&!b)return true;
    const nn=Number(n),aa=Number(a||b),bb=Number(b||a);
    if(Number.isFinite(nn)&&Number.isFinite(aa)&&Number.isFinite(bb))return nn>=Math.min(aa,bb)&&nn<=Math.max(aa,bb);
    return n===a||n===b;
  }

  async function linksForRecord(record){
    if(!record)return [];
    const all=await traceInbound(record.inboundNo);
    const id=String(record.id||'');
    const exact=all.filter(x=>String(x.recordId||'')===id);
    if(exact.length)return exact;
    return all.filter(x=>
      String(x.inboundNo||'')===String(record.inboundNo||'') &&
      recordContainerMatches(record,x)
    );
  }

  async function enrichItems(items){
    const out=[];
    for(const item of items||[]){
      const record=item.record||{};
      const links=await linksForRecord(record);
      out.push({record,pallets:item.pallets||[],productionLinks:links});
    }
    return out;
  }

  function issueOf(r){
    const reasons=[];
    if(txt(r.finalResult)&&!/적합/.test(txt(r.finalResult)))reasons.push(txt(r.finalResult));
    if(txt(r.labelMatch)==='불일치')reasons.push('라벨 불일치');
    if(txt(r.mixed)==='있음')reasons.push('혼입');
    if(txt(r.qtyResult)==='불일치')reasons.push('수량 불일치');
    return [...new Set(reasons)];
  }

  function summarizeDaily(items){
    const recs=(items||[]).map(x=>x.record||{});
    const products=new Map(),suppliers=new Set(),inspectors=new Set(),dates=new Set();
    let pallets=0,qty=0,ok=0,issues=0;
    for(const r of recs){
      const isMulti=/다중/.test(txt(r.mode));
      const pc=isMulti?num(r.palletCount):1;
      const q=isMulti?num(r.totalQty):num(r.actualQty||r.displayQty);
      pallets+=pc;qty+=q;
      if(/적합/.test(txt(r.finalResult)))ok++;else issues++;
      if(r.supplier)suppliers.add(txt(r.supplier));
      if(r.inspector)inspectors.add(txt(r.inspector));
      const d=dateOnly(r.regDate);if(d)dates.add(d);
      const name=txt(r.product)||'(미지정)';
      const x=products.get(name)||{product:name,records:0,inbounds:new Set(),pallets:0,qty:0,issues:0};
      x.records++;if(r.inboundNo)x.inbounds.add(txt(r.inboundNo));x.pallets+=pc;x.qty+=q;if(issueOf(r).length)x.issues++;
      products.set(name,x);
    }
    return {
      records:recs.length,pallets,qty,ok,issues,
      productCount:products.size,supplierCount:suppliers.size,
      inspectors:[...inspectors],dates:[...dates].sort(),
      products:[...products.values()].map(x=>({...x,inboundCount:x.inbounds.size,inbounds:[...x.inbounds]})).sort((a,b)=>b.qty-a.qty)
    };
  }
  R.summarizeDaily=summarizeDaily;

  function summarizeTrace(items){
    const groups=new Map(),links=[];
    const unlinked=[];
    for(const it of items||[]){
      const record=it.record||{},pl=it.productionLinks||[];
      if(!pl.length)unlinked.push(record);
      for(const x of pl){
        const key=[x.productionId||'',x.productName||'',x.lotNo||''].join('|');
        const g=groups.get(key)||{productionId:x.productionId||'',productName:x.productName||'',lotNo:x.lotNo||'',pallets:0,qty:0,records:new Set(),bottles:new Set()};
        g.pallets++;g.qty+=num(x.qty);if(record.id)g.records.add(String(record.id));if(x.product||record.product)g.bottles.add(txt(x.product||record.product));
        groups.set(key,g);links.push({...x,inspection:record});
      }
    }
    return {
      groups:[...groups.values()].map(g=>({...g,recordCount:g.records.size,bottles:[...g.bottles]})).sort((a,b)=>a.productName.localeCompare(b.productName,'ko')),
      links,unlinked
    };
  }
  R.summarizeTrace=summarizeTrace;

  function injectButtons(){
    const bar=$('v22ViewTools');if(!bar)return;
    if(!$('v56TraceSummaryBtn')){
      const b=document.createElement('button');b.id='v56TraceSummaryBtn';b.className='btn outline';b.textContent='🔗 생산/파레트 Summary';b.onclick=R.printTraceSummary;bar.appendChild(b);
    }
    if(!$('v56DailySummaryBtn')){
      const b=document.createElement('button');b.id='v56DailySummaryBtn';b.className='btn primary';b.textContent='📋 일일 검수 Summary';b.onclick=R.printDailySummary;bar.appendChild(b);
    }
  }

  function reportCss(){
    return '<style>'+
      '@page{size:A4;margin:10mm}*{box-sizing:border-box}body{font-family:"Malgun Gothic",sans-serif;color:#111;margin:0;font-size:9.5px}.sheet{min-height:270mm;page-break-after:always}.sheet:last-child{page-break-after:auto}'+
      'h1{font-size:17px;margin:0 0 4px;border-bottom:2px solid #234d5e;padding-bottom:6px}h2{font-size:12px;margin:10px 0 4px}.meta{color:#666;margin:0 0 8px}.kpis{display:grid;grid-template-columns:repeat(6,1fr);gap:4px;margin:7px 0}.kpi{border:1px solid #aaa;padding:6px;text-align:center}.kpi small{display:block;color:#666}.kpi b{font-size:15px}table{width:100%;border-collapse:collapse;margin:5px 0;font-size:8.8px}th,td{border:1px solid #aaa;padding:4px;vertical-align:top}th{background:#f1f0eb}.warn{background:#fff4f4}.ok{background:#f4faf5}.section-note{border-left:3px solid #777;padding:4px 7px;margin:5px 0;color:#444}.sign{display:flex;justify-content:flex-end;gap:28px;margin-top:18px}.sign div{width:90px;border-top:1px solid #333;text-align:center;padding-top:4px}.pno{font-family:monospace;font-weight:700}</style>';
  }

  function openPrint(title,html){
    const w=window.open('','_blank');
    if(!w){alert('팝업을 허용해주세요.');return;}
    w.document.open();
    w.document.write('<!doctype html><html lang="ko"><head><meta charset="utf-8"><title>'+esc(title)+'</title>'+reportCss()+'</head><body>'+html+'<script>window.onload=()=>setTimeout(()=>window.print(),350)<\/script></body></html>');
    w.document.close();
  }

  R.printDailySummary=async function(){
    const ids=selectedIds();
    if(!ids.length){alert('일일 보고서에 포함할 검수 기록을 먼저 선택하세요.');return;}
    if(typeof showBusy==='function')showBusy('일일 검수 Summary를 구성하는 중...');
    try{
      const items=await batchRecords(ids);
      if(!items.length)throw new Error('선택 기록을 불러오지 못했습니다.');
      const s=summarizeDaily(items);
      const range=s.dates.length?(s.dates[0]+(s.dates.length>1?' ~ '+s.dates[s.dates.length-1]:'')):'-';
      const issueRows=items.filter(x=>issueOf(x.record||{}).length).map(x=>{const r=x.record||{};return '<tr class="warn"><td>'+esc(r.inboundNo)+'</td><td>'+esc(r.product)+'</td><td>'+esc(issueOf(r).join(', '))+'</td><td>'+esc(r.note||'')+'</td><td>'+esc(r.inspector||'')+'</td></tr>';}).join('');
      const productRows=s.products.map(x=>'<tr><td>'+esc(x.product)+'</td><td>'+x.inboundCount+'</td><td>'+x.pallets.toLocaleString()+'</td><td>'+x.qty.toLocaleString()+'</td><td>'+x.issues+'</td></tr>').join('');
      const detailRows=items.map(x=>{const r=x.record||{},pc=/다중/.test(txt(r.mode))?num(r.palletCount):1,q=/다중/.test(txt(r.mode))?num(r.totalQty):num(r.actualQty||r.displayQty);return '<tr><td>'+esc(dateOnly(r.regDate))+'</td><td>'+esc(r.inboundNo)+'</td><td>'+esc(r.product)+'</td><td>'+esc(r.supplier)+'</td><td>'+pc+'</td><td>'+q.toLocaleString()+' '+esc(r.unit||'')+'</td><td>'+esc(r.finalResult||'')+'</td><td>'+esc(r.inspector||'')+'</td></tr>';}).join('');
      const html='<section class="sheet"><h1>공병 입고 검수 일일 Summary</h1>'+
        '<div class="meta">보고기간 '+esc(range)+' · 검수자 '+esc(s.inspectors.join(', ')||'-')+'</div>'+
        '<div class="kpis"><div class="kpi"><small>검수건</small><b>'+s.records+'</b></div><div class="kpi"><small>파레트</small><b>'+s.pallets.toLocaleString()+'</b></div><div class="kpi"><small>총수량</small><b>'+s.qty.toLocaleString()+'</b></div><div class="kpi"><small>품목</small><b>'+s.productCount+'</b></div><div class="kpi"><small>적합</small><b>'+s.ok+'</b></div><div class="kpi"><small>확인필요</small><b>'+s.issues+'</b></div></div>'+
        '<h2>1. 품목별 검수 현황</h2><table><tr><th>공병 품명</th><th>입고건</th><th>파레트</th><th>검수수량</th><th>확인필요</th></tr>'+productRows+'</table>'+
        '<h2>2. 특이사항 / 확인 필요</h2>'+(issueRows?'<table><tr><th>입고번호</th><th>품명</th><th>확인사항</th><th>특이사항</th><th>검수자</th></tr>'+issueRows+'</table>':'<div class="section-note">선택 기록 기준 특이사항 없음.</div>')+
        '<h2>3. 검수 상세</h2><table><tr><th>일자</th><th>입고번호</th><th>품명</th><th>공급업체</th><th>Pallet</th><th>수량</th><th>결과</th><th>검수자</th></tr>'+detailRows+'</table>'+
        '<div class="sign"><div>검수 담당</div><div>팀장 확인</div></div></section>';
      openPrint('공병 입고 검수 일일 Summary',html);
    }catch(e){alert('일일 Summary 생성 실패: '+(e.message||e));}
    finally{if(typeof hideBusy==='function')hideBusy();}
  };

  R.printTraceSummary=async function(){
    const ids=selectedIds();
    if(!ids.length){alert('추적 Summary에 포함할 검수 기록을 선택하세요.');return;}
    if(typeof showBusy==='function')showBusy('생산 연동 및 파레트 이력을 확인하는 중...');
    try{
      const base=await batchRecords(ids);
      if(!base.length)throw new Error('선택 기록을 불러오지 못했습니다.');
      const items=await enrichItems(base),s=summarizeTrace(items);
      const groupRows=s.groups.map(g=>'<tr><td><b>'+esc(g.productName||'-')+'</b></td><td>'+esc(g.lotNo||'-')+'</td><td>'+g.pallets+'</td><td>'+g.qty.toLocaleString()+'</td><td>'+esc(g.bottles.join(', '))+'</td></tr>').join('');
      const linkRows=s.links.map(x=>'<tr><td>'+esc(x.productName||'')+'</td><td>'+esc(x.lotNo||'')+'</td><td>'+esc(x.inboundNo||'')+'</td><td class="pno">'+esc(x.containerNo||'')+'</td><td>'+esc(x.product||'')+'</td><td>'+fmt(x.qty)+' '+esc(x.unit||'')+'</td><td>'+esc(x.result||'')+'</td></tr>').join('');
      const recRows=items.map(x=>{const r=x.record||{};return '<tr'+(x.productionLinks.length?'':' class="warn"')+'><td>'+esc(r.inboundNo||'')+'</td><td>'+esc(r.product||'')+'</td><td>'+esc(r.supplier||'')+'</td><td>'+esc(r.finalResult||'')+'</td><td>'+x.productionLinks.length+'</td><td>'+esc(r.inspector||'')+'</td></tr>';}).join('');
      const html='<section class="sheet"><h1>공병 생산 연동 추적 Summary</h1>'+
        '<div class="meta">클레임·일탈·이상조사 시 입고검수 기록과 실제 생산 투입 제품/파레트를 연결하여 확인</div>'+
        '<div class="kpis"><div class="kpi"><small>검수기록</small><b>'+items.length+'</b></div><div class="kpi"><small>생산제품/Lot</small><b>'+s.groups.length+'</b></div><div class="kpi"><small>연동 Pallet</small><b>'+s.links.length+'</b></div><div class="kpi"><small>투입수량</small><b>'+s.links.reduce((a,x)=>a+num(x.qty),0).toLocaleString()+'</b></div><div class="kpi"><small>미연동 검수</small><b>'+s.unlinked.length+'</b></div><div class="kpi"><small>확인필요</small><b>'+items.filter(x=>issueOf(x.record).length).length+'</b></div></div>'+
        '<h2>1. 생산제품 / 제조번호 Summary</h2>'+(groupRows?'<table><tr><th>생산제품</th><th>제조번호</th><th>Pallet</th><th>투입수량</th><th>사용 공병</th></tr>'+groupRows+'</table>':'<div class="section-note">선택한 검수기록에 연결된 생산 투입이 없습니다.</div>')+
        '<h2>2. 생산 투입 Pallet List</h2>'+(linkRows?'<table><tr><th>생산제품</th><th>제조번호</th><th>입고번호</th><th>WMS P.No</th><th>공병 품명</th><th>수량</th><th>검수결과</th></tr>'+linkRows+'</table>':'<div class="section-note">생산 투입 Pallet 없음.</div>')+
        '<h2>3. 원 입고검수 기록</h2><table><tr><th>입고번호</th><th>공병 품명</th><th>공급업체</th><th>검수결과</th><th>생산연동</th><th>검수자</th></tr>'+recRows+'</table>'+
        '<div class="sign"><div>확인자</div><div>검토자</div></div></section>';
      openPrint('공병 생산 연동 추적 Summary',html);
    }catch(e){alert('생산 추적 Summary 생성 실패: '+(e.message||e));}
    finally{if(typeof hideBusy==='function')hideBusy();}
  };

  async function renderProductionLinksForCurrent(){
    let r=null;
    try{r=currentViewRecord&&currentViewRecord.record;}catch(_){}
    if(!r)return;
    const box=$('viewDetailBox');if(!box)return;
    const old=$('v56ProductionLinks');if(old)old.remove();
    const links=await linksForRecord(r);
    let div=document.createElement('div');div.id='v56ProductionLinks';div.style.marginTop='12px';
    if(!links.length){
      div.innerHTML='<div class="status">생산 연동: 아직 생산 투입 기록 없음</div>';
    }else{
      const lots=[...new Set(links.map(x=>[x.productName,x.lotNo].filter(Boolean).join(' / ')).filter(Boolean))];
      div.innerHTML='<div class="status ok"><b>생산 연동 '+links.length+' Pallet</b> · '+esc(lots.join(', '))+'</div>'+
        '<div style="overflow:auto"><table style="width:100%;border-collapse:collapse;font-size:.78rem"><tr><th>생산제품</th><th>제조번호</th><th>WMS P.No</th><th>수량</th></tr>'+
        links.map(x=>'<tr><td>'+esc(x.productName||'')+'</td><td>'+esc(x.lotNo||'')+'</td><td>'+esc(x.containerNo||'')+'</td><td>'+fmt(x.qty)+' '+esc(x.unit||'')+'</td></tr>').join('')+'</table></div>';
    }
    box.appendChild(div);
  }
  R.renderProductionLinksForCurrent=renderProductionLinksForCurrent;

  function patchDetail(){
    if(typeof window.openRecordDetail!=='function'||window.openRecordDetail.__v56report)return;
    const prev=window.openRecordDetail;
    const fn=async function(){
      const out=await prev.apply(this,arguments);
      setTimeout(()=>renderProductionLinksForCurrent(),0);
      return out;
    };
    fn.__v56report=true;window.openRecordDetail=fn;
  }

  function boot(){
    if(!window.V22||!window.V24){setTimeout(boot,120);return;}
    injectButtons();patchDetail();
    setTimeout(injectButtons,500);
    console.info('[V56-REPORTING-1] production linkage + trace/daily summaries active');
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',boot,{once:true});else boot();
})();