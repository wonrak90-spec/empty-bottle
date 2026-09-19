/* V26 OCR Baseline Benchmark V1
 * - 관리자용 / 학습 Seed ZIP은 브라우저 안에서만 처리
 * - 기본: holdout_real 실사진 평가
 * - 선택: augmented_train 강건성 평가
 * - 현재 운영 PP-OCRv5 + 현재 WMS/업체 parser/template 그대로 사용
 */
(function(){
  'use strict';
  if(window.__V26_OCR_BENCHMARK__)return;
  window.__V26_OCR_BENCHMARK__=true;

  const $=id=>document.getElementById(id);
  const B=window.V26OcrBenchmark={
    VERSION:'V26-OCR-BENCHMARK-1',
    running:false,
    results:[],
    summary:null,
    zipName:''
  };

  const FFLATE_URL='https://cdn.jsdelivr.net/npm/fflate@0.8.2/+esm';

  function esc(s){return String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}
  function roleIsAdmin(){return !!(window.V24&&V24.session&&V24.session.user&&V24.session.user.role==='admin');}
  function sleep(ms){return new Promise(r=>setTimeout(r,ms));}
  function normSpace(s){return String(s??'').replace(/\s+/g,' ').trim();}
  function normDigits(s){const d=String(s??'').replace(/[^0-9]/g,'');return d?String(Number(d)):'';}
  function normCompany(s){return String(s??'').toLowerCase().replace(/주식회사|\(주\)|㈜|[\s.()\-_]/g,'');}
  function normProduct(s){
    return String(s??'').toLowerCase()
      .replace(/m[ℓℒ]|㎖/g,'ml')
      .replace(/[()（）\s._-]/g,'')
      .replace(/리터/g,'l');
  }
  function normGeneric(s){return normSpace(s).toLowerCase().replace(/[：:]/g,'');}
  function normDate(s){return String(s??'').replace(/[.\/년월일\s]/g,'-').replace(/-+/g,'-').replace(/^-|-$/g,'');}
  function compareField(k,a,b){
    if(a==null||String(a).trim()==='')return null;
    let x='',y='';
    if(['inboundNo','itemCode','displayQty','qty','containerFrom','containerTo','palletNo','lotNo'].includes(k)){x=normDigits(a);y=normDigits(b);}
    else if(['maker','manufacturer','supplier','deliverTo'].includes(k)){x=normCompany(a);y=normCompany(b);}
    else if(k==='product'){x=normProduct(a);y=normProduct(b);}
    else if(k==='line'){x=normGeneric(a).replace(/\s/g,'');y=normGeneric(b).replace(/\s/g,'');}
    else if(['prodDate','inboundDate','expiryDate'].includes(k)){x=normDate(a);y=normDate(b);}
    else{x=normGeneric(a);y=normGeneric(b);}
    return {ok:!!x&&x===y,expected:String(a??''),actual:String(b??''),nx:x,ny:y};
  }
  function critical(k,type){
    return type==='wms'
      ? ['inboundNo','itemCode','displayQty','containerFrom','containerTo'].includes(k)
      : ['product','qty','palletNo','lotNo'].includes(k);
  }
  function blobToDataUrl(blob){
    return new Promise((res,rej)=>{const fr=new FileReader();fr.onload=()=>res(fr.result);fr.onerror=rej;fr.readAsDataURL(blob);});
  }
  async function unzip(file){
    const mod=await import(FFLATE_URL);
    const buf=new Uint8Array(await file.arrayBuffer());
    return mod.unzipSync(buf);
  }
  function str(bytes){return new TextDecoder('utf-8').decode(bytes);}
  function parseJsonl(bytes){
    return str(bytes).split(/\r?\n/).map(x=>x.trim()).filter(Boolean).map(x=>JSON.parse(x));
  }
  function findEntry(zip, suffix){
    const keys=Object.keys(zip);
    return keys.find(k=>k===suffix||k.endsWith('/'+suffix)||k.endsWith(suffix));
  }
  function imagePath(zip, folder, file){
    const suffix=folder+'/'+file;
    return Object.keys(zip).find(k=>k.endsWith(suffix))||'';
  }
  function predicted(type,text,items){
    if(type==='vendor'){
      if(window.V26VendorTemplates&&typeof V26VendorTemplates.parse==='function')return V26VendorTemplates.parse(text||'',items||[]);
      return typeof parseVendorLabel==='function'?(parseVendorLabel(text||'')||{}):{};
    }
    if(window.V26WmsCardScan&&typeof V26WmsCardScan.parseWms==='function')return V26WmsCardScan.parseWms(text||'',items||[]);
    return typeof parseLabelText==='function'?(parseLabelText(text||'')||{}):{};
  }
  function summarize(rows){
    const field={},template={},condition={},groups={};
    let ok=0,total=0,critOk=0,critTotal=0;
    for(const r of rows){
      for(const f of r.fields){
        if(!field[f.key])field[f.key]={ok:0,total:0};
        field[f.key].total++;total++;
        if(f.ok){field[f.key].ok++;ok++;}
        if(f.critical){critTotal++;if(f.ok)critOk++;}
      }
      const gid=r.sourceGroup||r.file||'-';
      if(!groups[gid])groups[gid]={criticalOk:0,criticalTotal:0,images:0};
      groups[gid].images++;
      for(const f of r.fields){
        if(f.critical){groups[gid].criticalTotal++;if(f.ok)groups[gid].criticalOk++;}
      }
      const t=r.template||r.labelType||'-';
      if(!template[t])template[t]={images:0,ok:0,total:0};template[t].images++;
      for(const f of r.fields){template[t].total++;if(f.ok)template[t].ok++;}
      const tags=Array.isArray(r.conditions)&&r.conditions.length
        ? r.conditions
        : [r.condition||r.split||'real'];
      [...new Set(tags.filter(Boolean))].forEach(c=>{
        if(!condition[c])condition[c]={images:0,ok:0,total:0};
        condition[c].images++;
        for(const f of r.fields){condition[c].total++;if(f.ok)condition[c].ok++;}
      });
    }
    const pct=(a,b)=>b?Math.round(a/b*1000)/10:0;
    const groupScores=Object.values(groups).filter(g=>g.criticalTotal>0).map(g=>g.criticalOk/g.criticalTotal*100);
    const groupWeightedCriticalAccuracy=groupScores.length
      ? Math.round(groupScores.reduce((a,b)=>a+b,0)/groupScores.length*10)/10
      : 0;
    return {images:rows.length,sourceGroups:Object.keys(groups).length,accuracy:pct(ok,total),
      criticalAccuracy:pct(critOk,critTotal),groupWeightedCriticalAccuracy,field,template,condition};
  }
  function pctObj(o){return o.total?Math.round(o.ok/o.total*1000)/10:0;}

  function modal(){
    let m=$('v26OcrBenchModal');if(m)return m;
    m=document.createElement('div');m.id='v26OcrBenchModal';m.className='hidden';
    m.style.cssText='position:fixed;inset:0;z-index:12000;background:rgba(0,0,0,.55);padding:18px;overflow:auto;';
    m.innerHTML='<div style="max-width:920px;margin:20px auto;background:#fff;border-radius:14px;padding:18px;color:#111">'+
      '<div style="display:flex;justify-content:space-between;gap:12px;align-items:center"><div><b style="font-size:18px">OCR Baseline Benchmark V1</b><div style="font-size:12px;color:#666;margin-top:3px">Seed ZIP은 브라우저 안에서만 처리되며 서버로 전송하지 않습니다.</div></div><button class="btn outline" onclick="V26OcrBenchmark.close()">닫기</button></div>'+
      '<div style="display:grid;grid-template-columns:1fr auto;gap:10px;align-items:end;margin-top:16px"><div><label style="font-weight:700">Seed Dataset ZIP</label><input id="v26BenchZip" type="file" accept=".zip,application/zip" style="display:block;width:100%;margin-top:6px"></div><button id="v26BenchRun" class="btn primary" onclick="V26OcrBenchmark.run()">Holdout 평가 시작</button></div>'+
      '<label style="display:flex;gap:8px;align-items:center;margin-top:10px"><input id="v26BenchAug" type="checkbox"> 증강 이미지 66장까지 강건성 평가 (시간이 오래 걸릴 수 있음)</label>'+
      '<div id="v26BenchStatus" class="status" style="margin-top:12px">ZIP을 선택하세요.</div>'+
      '<div id="v26BenchSummary" style="margin-top:12px"></div>'+
      '<div id="v26BenchDetail" style="margin-top:12px;max-height:420px;overflow:auto"></div>'+
      '<div style="display:flex;gap:8px;margin-top:12px"><button id="v26BenchCsv" class="btn outline hidden" onclick="V26OcrBenchmark.downloadCsv()">결과 CSV</button></div>'+
      '</div>';
    document.body.appendChild(m);return m;
  }
  B.open=function(){if(!roleIsAdmin()){alert('관리자만 사용할 수 있습니다.');return;}modal().classList.remove('hidden');};
  B.close=function(){const m=$('v26OcrBenchModal');if(m&&!B.running)m.classList.add('hidden');};

  B.run=async function(){
    if(B.running)return;
    const input=$('v26BenchZip'),file=input&&input.files&&input.files[0];
    if(!file){alert('Seed Dataset ZIP을 선택하세요.');return;}
    if(!window.V26KoreanOCR||typeof V26KoreanOCR.recognize!=='function'){alert('현재 OCR 엔진이 준비되지 않았습니다. 새로고침 후 다시 시도하세요.');return;}
    B.running=true;B.results=[];B.summary=null;B.zipName=file.name;
    const btn=$('v26BenchRun');if(btn)btn.disabled=true;
    const status=$('v26BenchStatus'),detail=$('v26BenchDetail'),sum=$('v26BenchSummary');
    if(detail)detail.innerHTML='';if(sum)sum.innerHTML='';
    try{
      status.textContent='ZIP 확인 중...';status.className='status warn';
      const zip=await unzip(file);
      const holdKey=findEntry(zip,'labels_holdout.jsonl');
      const origKey=findEntry(zip,'labels_original.jsonl');
      let originals=[];
      let holdoutFolder='holdout';
      if(holdKey){
        originals=parseJsonl(zip[holdKey]).filter(x=>x.verified!==false);
      }else if(origKey){
        originals=parseJsonl(zip[origKey]).filter(x=>{
          const s=x.split||x.dataset_split||'';
          return x.verified!==false&&(s==='holdout'||s==='final_holdout');
        });
        holdoutFolder='holdout_real';
      }else{
        throw new Error('labels_holdout.jsonl 또는 holdout이 포함된 labels_original.jsonl을 찾지 못했습니다.');
      }
      let jobs=originals.map(x=>({...x,folder:holdoutFolder,
        split:x.split||x.dataset_split||'final_holdout',
        conditions:Array.isArray(x.conditions)&&x.conditions.length?x.conditions:['real_holdout'],
        condition:(Array.isArray(x.conditions)&&x.conditions.length?x.conditions[0]:'real_holdout')}));
      if($('v26BenchAug')&&$('v26BenchAug').checked){
        const augKey=findEntry(zip,'labels_augmented.jsonl');
        if(augKey){
          const aug=parseJsonl(zip[augKey]).filter(x=>x.label_verified!==false);
          jobs=jobs.concat(aug.map(x=>({...x,
            folder:'augmented/'+(x.dataset_split||'train'),
            split:x.dataset_split||'augmented',
            conditions:Array.isArray(x.conditions)&&x.conditions.length?x.conditions:[x.augmentation||'augmented'],
            condition:(Array.isArray(x.conditions)&&x.conditions.length?x.conditions[0]:(x.augmentation||'augmented'))})));
        }
      }
      if(!jobs.length)throw new Error('평가할 이미지가 없습니다.');

      for(let i=0;i<jobs.length;i++){
        const j=jobs[i];
        const path=imagePath(zip,j.folder,j.file);
        if(!path){B.results.push({file:j.file,sourceGroup:j.source_group||j.sourceGroup||j.file,labelType:j.fields&&j.fields.label_type||j.label_type||'',template:j.fields&&j.fields.template||j.template||'',condition:j.condition,conditions:j.conditions||[],split:j.split,latency:0,error:'이미지 없음',fields:[]});continue;}
        status.textContent='OCR 평가 '+(i+1)+' / '+jobs.length+' · '+j.file;
        const bytes=zip[path],blob=new Blob([bytes],{type:/\.png$/i.test(j.file)?'image/png':'image/jpeg'});
        const data=await blobToDataUrl(blob);
        let r,pred,err='';
        try{
          r=await V26KoreanOCR.recognize(data,false,'');
          const type=(j.fields&&j.fields.label_type)||j.label_type||'';
          pred=predicted(type,r.text,r.items);
        }catch(e){err=String(e&&e.message?e.message:e);pred={};r={latency:0,text:'',items:[]};}
        const expected=j.fields||{},type=expected.label_type||j.label_type||'';
        const fs=[];
        for(const k of Object.keys(expected)){
          if(['label_type','template'].includes(k))continue;
          const cmp=compareField(k,expected[k],pred[k]);
          if(cmp)fs.push({key:k,...cmp,critical:critical(k,type)});
        }
        B.results.push({file:j.file,sourceGroup:j.source_group||j.sourceGroup||j.file,labelType:type,template:expected.template||j.template||'',condition:j.condition,conditions:j.conditions||[],split:j.split||'',latency:r.latency||0,error:err,fields:fs,raw:r.text||''});
        await sleep(20);
      }
      B.summary=summarize(B.results);
      render();
      status.textContent='평가 완료 · '+B.summary.images+'장';status.className='status ok';
      const csv=$('v26BenchCsv');if(csv)csv.classList.remove('hidden');
    }catch(e){
      status.textContent='평가 실패: '+String(e&&e.message?e.message:e);status.className='status bad';
    }finally{
      B.running=false;if(btn)btn.disabled=false;
    }
  };

  function render(){
    const s=B.summary;if(!s)return;
    const sum=$('v26BenchSummary'),detail=$('v26BenchDetail');
    const temp=Object.entries(s.template).map(([k,v])=>'<div><b>'+esc(k)+'</b> '+pctObj(v)+'% <small>('+v.images+'장)</small></div>').join('');
    const cond=Object.entries(s.condition).map(([k,v])=>'<div><b>'+esc(k)+'</b> '+pctObj(v)+'% <small>('+v.images+'장)</small></div>').join('');
    const fld=Object.entries(s.field).sort((a,b)=>pctObj(a[1])-pctObj(b[1])).map(([k,v])=>'<span style="display:inline-block;margin:3px;padding:5px 7px;border:1px solid #ddd;border-radius:8px">'+esc(k)+' <b>'+pctObj(v)+'%</b> ('+v.ok+'/'+v.total+')</span>').join('');
    sum.innerHTML='<div style="display:grid;grid-template-columns:repeat(4,1fr);gap:8px"><div style="border:1px solid #ddd;padding:10px;border-radius:10px"><small>전체 필드 정확도</small><div style="font-size:26px;font-weight:800">'+s.accuracy+'%</div></div><div style="border:1px solid #ddd;padding:10px;border-radius:10px"><small>Critical Field</small><div style="font-size:26px;font-weight:800">'+s.criticalAccuracy+'%</div></div><div style="border:1px solid #ddd;padding:10px;border-radius:10px"><small>Group 균등 Critical</small><div style="font-size:26px;font-weight:800">'+s.groupWeightedCriticalAccuracy+'%</div><small>'+s.sourceGroups+' groups</small></div><div style="border:1px solid #ddd;padding:10px;border-radius:10px"><small>평가 이미지</small><div style="font-size:26px;font-weight:800">'+s.images+'장</div></div></div>'+
      '<div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-top:10px"><div><b>템플릿별</b>'+temp+'</div><div><b>촬영조건별</b>'+cond+'</div></div><div style="margin-top:10px"><b>필드별</b><div>'+fld+'</div></div>';

    detail.innerHTML='<table style="width:100%;border-collapse:collapse;font-size:12px"><thead><tr><th style="text-align:left">파일</th><th>구분</th><th>정확</th><th>오류필드</th><th>시간</th></tr></thead><tbody>'+
      B.results.map(r=>{const bad=r.fields.filter(f=>!f.ok);const good=r.fields.filter(f=>f.ok).length;return '<tr style="border-top:1px solid #eee"><td style="padding:6px">'+esc(r.file)+(r.error?'<div style="color:#b00">'+esc(r.error)+'</div>':'')+'</td><td style="padding:6px;text-align:center">'+esc(r.template||r.labelType)+'<br><small>'+esc(r.condition)+'</small></td><td style="padding:6px;text-align:center">'+good+'/'+r.fields.length+'</td><td style="padding:6px">'+(bad.length?bad.map(f=>'<div><b>'+esc(f.key)+'</b>: '+esc(f.actual||'∅')+' → '+esc(f.expected)+'</div>').join(''):'✓')+'</td><td style="padding:6px;text-align:right">'+Number(r.latency||0).toLocaleString()+'ms</td></tr>';}).join('')+
      '</tbody></table>';
  }

  B.downloadCsv=function(){
    if(!B.results.length)return;
    const rows=[['file','source_group','template','conditions','field','critical','ok','expected','actual','latency_ms','error']];
    for(const r of B.results){
      if(!r.fields.length)rows.push([r.file,r.sourceGroup,r.template,(r.conditions||[r.condition]).join('|'),'','',false,'','',r.latency,r.error]);
      for(const f of r.fields)rows.push([r.file,r.sourceGroup,r.template,(r.conditions||[r.condition]).join('|'),f.key,f.critical,f.ok,f.expected,f.actual,r.latency,r.error]);
    }
    const q=v=>'"'+String(v??'').replace(/"/g,'""')+'"';
    const csv='\ufeff'+rows.map(x=>x.map(q).join(',')).join('\r\n');
    const a=document.createElement('a');a.href=URL.createObjectURL(new Blob([csv],{type:'text/csv;charset=utf-8'}));a.download='OCR_Baseline_'+new Date().toISOString().slice(0,10)+'.csv';a.click();setTimeout(()=>URL.revokeObjectURL(a.href),1000);
  };

  function injectButton(){
    if(!roleIsAdmin())return;
    const bar=$('v24AccountBar');if(!bar||$('btnOcrBenchmark'))return;
    const actions=bar.querySelector('.v24-account-actions');if(!actions)return;
    const b=document.createElement('button');b.id='btnOcrBenchmark';b.textContent='OCR 품질';b.onclick=B.open;
    actions.insertBefore(b,actions.firstChild);
  }
  function init(){
    injectButton();
    const mo=new MutationObserver(()=>injectButton());
    mo.observe(document.body,{childList:true,subtree:true,characterData:false});
    setTimeout(injectButton,700);setTimeout(injectButton,1800);
    console.info('[V26-OCR-BENCHMARK-1] admin local benchmark active');
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init,{once:true});else init();
})();