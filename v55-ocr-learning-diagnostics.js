/* OCR Learning Store V1 - diagnostics */
(function(){
  'use strict';
  const L=window.V55OcrLearning;
  if(!L||window.__OCR_LEARNING_DIAGNOSTICS_V1__)return;
  window.__OCR_LEARNING_DIAGNOSTICS_V1__=true;

  function row(name,ok,detail){return {name,ok:!!ok,detail:String(detail||'')};}

  L.runDiagnostics=async function(){
    const rows=[];
    rows.push(row('Learning client',!!window.V55OcrLearning,L.VERSION||''));
    rows.push(row('PP-OCRv5 local engine layer',!!(window.V26KoreanOCR&&typeof V26KoreanOCR.recognize==='function'),window.V26KoreanOCR&&V26KoreanOCR.VERSION||'not loaded'));
    rows.push(row('WMS parser',!!(window.V26WmsCardScan&&typeof V26WmsCardScan.parseWms==='function'),window.V26WmsCardScan&&V26WmsCardScan.VERSION||''));
    rows.push(row('Vendor template parser',!!(window.V26VendorTemplates&&typeof V26VendorTemplates.parse==='function'),window.V26VendorTemplates&&V26VendorTemplates.VERSION||''));
    rows.push(row('Save hook',!!(L.wrapped&&L.nativePost),'existing save flow wrapped passively'));
    const q=L.loadQueue?L.loadQueue():[];
    rows.push(row('Local learning queue',true,String(q.length)+' pending'));

    try{
      if('caches' in window){
        const keys=await caches.keys();
        const hit=keys.find(x=>/v55-learning-store-v1/i.test(x));
        rows.push(row('Service worker cache',!!hit,hit||keys.join(', ')||'no cache'));
      }
    }catch(e){rows.push(row('Service worker cache',false,e.message||e));}

    try{
      const info=await apiGet('ocrLearningInfo',{});
      rows.push(row('Learning backend',!!(info&&info.ok),info&&info.ok?('total '+(info.total||0)+' / approved '+(info.approved||0)+' / active '+(info.activeDataset||'')):(info&&info.message||'no response')));
    }catch(e){
      rows.push(row('Learning backend',false,e&&e.message||e));
    }

    try{
      const admin=!!(window.V24&&V24.session&&V24.session.user&&V24.session.user.role==='admin');
      if(admin){
        const v=await apiGet('ocrDatasetVersions',{});
        rows.push(row('Dataset version API',!!(v&&v.ok),v&&v.ok?String((v.items||[]).length)+' versions':(v&&v.message||'no response')));
        const m=await apiGet('ocrLearningMetrics',{scope:'APPROVED'});
        rows.push(row('OCR quality metrics API',!!(m&&m.ok),m&&m.ok?('approved '+String(m.samples||0)+' / accuracy '+String(m.accuracy==null?'-':m.accuracy+'%')):(m&&m.message||'no response')));
      }else{
        rows.push(row('Dataset version API',true,'operator session - admin check skipped'));
        rows.push(row('OCR quality metrics API',true,'operator session - admin check skipped'));
      }
    }catch(e){
      rows.push(row('Dataset version API',false,e&&e.message||e));
    }

    return {
      ok:rows.every(x=>x.ok),
      checkedAt:new Date().toISOString(),
      queueCount:q.length,
      rows
    };
  };

  L.renderDiagnostics=async function(targetId){
    const el=document.getElementById(targetId||'v55LearningDiag');
    if(!el)return;
    el.className='status';el.textContent='진단 중...';
    const r=await L.runDiagnostics();
    el.className='status '+(r.ok?'ok':'warn');
    el.innerHTML=r.rows.map(x=>'<div style="display:grid;grid-template-columns:22px 180px 1fr;gap:6px;padding:3px 0"><b>'+(x.ok?'✓':'!')+'</b><b>'+String(x.name).replace(/[&<>]/g,'')+'</b><span>'+String(x.detail).replace(/[&<>]/g,'')+'</span></div>').join('');
  };
})();