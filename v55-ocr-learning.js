/* OCR Learning Store V1 - passive client extension
 * Captures OCR-parsed values vs final saved values after successful saves.
 * No image bytes are stored in GitHub or browser learning queue.
 */
(function(){
  'use strict';
  if(window.__OCR_LEARNING_STORE_V1__) return;
  window.__OCR_LEARNING_STORE_V1__=true;

  const L=window.V55OcrLearning={
    VERSION:'V55-OCR-LEARNING-1',
    queueKey:'emptyBottle.ocrLearning.queue.v1',
    backendKey:'emptyBottle.ocrLearning.backend.v1',
    cache:{wms:null,vendor:null,multi:null,production_wms:null,other:null},
    applied:{wms:null,vendor:null,multi:null},
    manual:{wms:{},vendor:{},multi:{}},
    queueMax:1500,lastQueueError:'',
    nativePost:null,wrapped:false,syncing:false
  };
  const WMS=['inboundNo','inboundDate','product','itemCode','manufacturer','supplier','displayQty','unit','expiryDate','containerFrom','containerTo'];
  const VENDOR=['product','qty','prodDate','prodTime','lotNo','palletNo','line'];
  const MANUAL_FIELDS={
    inboundNo:['wms','inboundNo'],inboundDate:['wms','inboundDate'],product:['wms','product'],
    itemCode:['wms','itemCode'],manufacturer:['wms','manufacturer'],supplier:['wms','supplier'],
    displayQty:['wms','displayQty'],unit:['wms','unit'],expiryDate:['wms','expiryDate'],
    containerFrom:['wms','containerFrom'],containerTo:['wms','containerTo'],
    vProduct:['vendor','product'],vQty:['vendor','qty'],vProdDate:['vendor','prodDate'],
    vProdTime:['vendor','prodTime'],vLotNo:['vendor','lotNo'],vPalletNo:['vendor','palletNo'],vLine:['vendor','line'],
    mInboundNo:['multi','inboundNo'],mProduct:['multi','product'],mItemCode:['multi','itemCode'],
    mSupplier:['multi','supplier'],mQty:['multi','displayQty']
  };

  function txt(v){return String(v==null?'':v).replace(/\s+/g,' ').trim();}
  function hash(s){s=String(s||'');let h=2166136261;for(let i=0;i<s.length;i++){h^=s.charCodeAt(i);h+=(h<<1)+(h<<4)+(h<<7)+(h<<8)+(h<<24);}return (h>>>0).toString(16);}
  function norm(k,v){
    let s=txt(v);if(!s)return '';
    if(/qty/i.test(k)){const n=Number(s.replace(/,/g,''));if(Number.isFinite(n))return String(n);}
    if(/date/i.test(k)){const m=s.match(/(20\d{2})\D?([01]?\d)\D?([0-3]?\d)/);if(m)return m[1]+'-'+String(m[2]).padStart(2,'0')+'-'+String(m[3]).padStart(2,'0');}
    if(/No$|Code$|container|inbound/i.test(k))return s.replace(/[\s,]/g,'').replace(/\.000$/,'');
    return s.toLowerCase();
  }
  function pick(obj,fields){const out={};for(const k of fields)out[k]=obj&&obj[k]!=null?String(obj[k]):'';return out;}
  function diff(ocr,final,fields){
    const out={};let changed=0,compared=0;
    for(const k of fields){
      const a=ocr&&ocr[k]!=null?String(ocr[k]):'',b=final&&final[k]!=null?String(final[k]):'';
      if(!txt(a)&&!txt(b))continue;
      compared++;const c=norm(k,a)!==norm(k,b);if(c)changed++;
      out[k]={ocr:a,final:b,changed:c};
    }
    return {out,changed,compared};
  }
  function cacheMode(statusEl){
    const s=String(statusEl||'');
    if(/prodSearchStatus/i.test(s))return 'production_wms';
    if(/vendorStatus/i.test(s))return 'vendor';
    if(/multi/i.test(s))return 'multi';
    if(/wmsStatus/i.test(s))return 'wms';
    return 'other';
  }
  function items(mode,raw){
    const c=L.cache[mode];if(!c||Date.now()-c.ts>120000||txt(c.text)!==txt(raw))return [];
    return Array.isArray(c.items)?c.items:[];
  }
  function applied(mode,raw){
    const a=L.applied[mode||'wms'];
    if(!a||Date.now()-a.ts>120000||txt(a.raw)!==txt(raw))return null;
    return a.parsed&&typeof a.parsed==='object'?Object.assign({},a.parsed):null;
  }
  function parseWms(raw,mode){
    try{
      const hit=applied(mode||'wms',raw);if(hit)return hit;
      const its=items(mode||'wms',raw);
      if(window.V55WmsParser&&typeof V55WmsParser.parse==='function')return V55WmsParser.parse(raw||'',its)||{};
      if(window.V26WmsCardScan&&typeof V26WmsCardScan.parseWms==='function')return V26WmsCardScan.parseWms(raw||'',its)||{};
      if(typeof parseLabelText==='function')return parseLabelText(raw||'')||{};
    }catch(_){}
    return {};
  }
  function parseVendor(raw,mode){
    try{
      const hit=applied(mode||'vendor',raw);if(hit)return hit;
      const its=items(mode||'vendor',raw);
      if(window.V55VendorParser&&typeof V55VendorParser.parse==='function')return V55VendorParser.parse(raw||'',its)||{};
      if(window.V26VendorTemplates&&typeof V26VendorTemplates.parse==='function')return V26VendorTemplates.parse(raw||'',its)||{};
      if(typeof parseVendorLabel==='function')return parseVendorLabel(raw||'')||{};
    }catch(_){}
    return {};
  }
  function template(raw,mode){
    try{
      if(window.V26VendorTemplates&&typeof V26VendorTemplates.detect==='function')return V26VendorTemplates.detect(raw||'',items(mode||'vendor',raw))||'';
    }catch(_){}
    return '';
  }
  L.noteApplied=function(mode,raw,parsed){
    const m=mode==='single'?'wms':mode;
    if(!m||!L.applied[m])return;
    L.applied[m]={raw:String(raw||''),parsed:Object.assign({},parsed||{}),ts:Date.now()};
  };

  L.noteManualEdit=function(mode,key,value){
    if(!mode||!key)return;
    const bag=L.manual[mode]||(L.manual[mode]={});
    const cur=bag[key]||{count:0,firstAt:'',lastAt:'',lastValue:''};
    const now=new Date().toISOString();
    if(!cur.firstAt)cur.firstAt=now;
    cur.lastAt=now;cur.lastValue=String(value==null?'':value);cur.count++;
    bag[key]=cur;
  };
  function manualSnapshot(mode){
    const src=L.manual[mode]||{},out={};
    Object.keys(src).forEach(k=>{out[k]=Object.assign({},src[k]);});
    return out;
  }
  function resetManual(mode){L.manual[mode]={};}
  function bindManualAudit(){
    if(!document||typeof document.addEventListener!=='function'||L.__manualBound)return;
    L.__manualBound=true;
    document.addEventListener('input',ev=>{
      try{
        if(ev&&ev.isTrusted===false)return;
        const t=ev&&ev.target,id=t&&t.id,m=MANUAL_FIELDS[id];
        if(!m)return;
        L.noteManualEdit(m[0],m[1],t.value);
      }catch(_){}
    },true);
  }

  function makeEntry(source,recordId,raw,ocr,final,fields,extra){
    const d=diff(ocr,final,fields),x=extra||{},manual=x.manualEdits||{};
    const edited=Object.keys(manual).filter(k=>fields.indexOf(k)>=0);
    const manualChanged=edited.filter(k=>d.out[k]&&d.out[k].changed);
    const editCount=edited.reduce((n,k)=>n+Number(manual[k]&&manual[k].count||0),0);
    const e={
      captureKey:'',capturedAt:new Date().toISOString(),recordId:String(recordId||''),source,
      template:'',datasetVersion:'',photoUrl:'',palletSeq:'',productionId:'',
      ocrEngine:'PP-OCRv5 Korean local',ocrModel:'korean_PP-OCRv5_mobile_rec',
      frontendVersion:L.VERSION,ocrAssistVersion:(window.V55AdaptiveOCR&&V55AdaptiveOCR.VERSION)||'',ocrRaw:String(raw||''),ocr:pick(ocr,fields),final:pick(final,fields),
      diff:d.out,comparedFields:d.compared,changedFields:d.changed,
      manualEditedFields:edited,manualChangedFields:manualChanged,manualEditCount:editCount,
      correctionType:manualChanged.length?'OCR_KEYIN_CORRECTION':(edited.length?'KEYIN_NO_FINAL_CHANGE':(d.changed?'NON_KEYIN_DIFFERENCE':'NO_CORRECTION'))
    };
    Object.assign(e,x);delete e.manualEdits;
    e.captureKey=[e.recordId,e.source,e.palletSeq,hash(e.ocrRaw),hash(JSON.stringify(e.final))].join('|');
    return e;
  }
  function loadQueue(){try{const q=JSON.parse(localStorage.getItem(L.queueKey)||'[]');return Array.isArray(q)?q:[];}catch(_){return [];}}
  function saveQueue(q){
    let ok=true;
    try{localStorage.setItem(L.queueKey,JSON.stringify((q||[]).slice(-L.queueMax)));L.lastQueueError='';}
    catch(e){ok=false;L.lastQueueError=String(e&&e.message||e||'Learning Outbox 저장 실패');console.warn('[OCR Learning] outbox persist failed',e);}
    if(typeof L.onQueueChange==='function')L.onQueueChange(loadQueue().length);
    return ok;
  }
  function enqueue(list){
    const q=loadQueue(),seen=new Set(q.map(x=>x.captureKey));
    for(const e of list||[]){if(e&&e.ocrRaw&&!seen.has(e.captureKey)){q.push(e);seen.add(e.captureKey);}}
    saveQueue(q);setTimeout(()=>L.flush(false),50);
  }
  function cooldown(){try{const x=JSON.parse(localStorage.getItem(L.backendKey)||'{}');return Number(x.retryAfter||0)>Date.now();}catch(_){return false;}}
  function markBackend(ok,msg){try{localStorage.setItem(L.backendKey,JSON.stringify(ok?{ok:true,retryAfter:0,at:Date.now()}:{ok:false,retryAfter:Date.now()+300000,message:String(msg||''),at:Date.now()}));}catch(_){}}
  L.flush=async function(force){
    if(L.syncing||!L.nativePost||(!force&&cooldown()))return;
    const snapshot=loadQueue();if(!snapshot.length)return;
    L.syncing=true;
    const synced=new Set();
    try{
      for(let i=0;i<snapshot.length;i++){
        let r;
        try{r=await L.nativePost('ocrLearningSave',{entry:snapshot[i]});}
        catch(e){markBackend(false,e&&e.message);break;}
        if(r&&r.ok){synced.add(snapshot[i].captureKey);markBackend(true);continue;}
        markBackend(false,r&&r.message);break;
      }
    }finally{
      // 동기화 도중 새 입고가 저장되어 queue가 늘어날 수 있다.
      // 현재 queue에서 성공 처리된 snapshot 항목만 제거하여 새 로그를 잃지 않는다.
      const current=loadQueue();
      saveQueue(current.filter(x=>!synced.has(x&&x.captureKey)));
      L.syncing=false;
    }
  };
  L.loadQueue=loadQueue;

  function finalWms(p){return {inboundNo:p.inboundNo||'',inboundDate:p.inboundDate||'',product:p.product||'',itemCode:p.itemCode||'',manufacturer:p.manufacturer||'',supplier:p.supplier||'',displayQty:p.displayQty||'',unit:p.unit||'',expiryDate:p.expiryDate||'',containerFrom:p.containerFrom||'',containerTo:p.containerTo||''};}
  function finalVendor(p){return {product:p.vendorProduct||'',qty:p.vendorQty||'',prodDate:p.vendorProdDate||'',prodTime:p.vendorProdTime||'',lotNo:p.vendorLotNo||'',palletNo:p.vendorPalletNo||'',line:p.vendorLine||''};}
  function singleEntries(p,r){
    const out=[],id=r&&r.id||'',mw=manualSnapshot('wms'),mv=manualSnapshot('vendor');
    if(p.ocrRaw)out.push(makeEntry('wms',id,p.ocrRaw,parseWms(p.ocrRaw,'wms'),finalWms(p),WMS,{photoUrl:String(r&&r.photoUrl||''),manualEdits:mw}));
    if(p.vendorOcrRaw)out.push(makeEntry('vendor',id,p.vendorOcrRaw,parseVendor(p.vendorOcrRaw,'vendor'),finalVendor(p),VENDOR,{template:template(p.vendorOcrRaw,'vendor'),photoUrl:String(r&&r.vendorPhotoUrl||''),manualEdits:mv}));
    resetManual('wms');resetManual('vendor');
    return out;
  }
  function multiEntries(p,r){
    const out=[],id=r&&r.id||'';
    let raw=p.ocrRaw||'';try{if(typeof lastOcrText!=='undefined'&&lastOcrText.multi)raw=lastOcrText.multi;}catch(_){}
    if(raw){
      const f={inboundNo:p.inboundNo||'',product:p.product||'',itemCode:p.itemCode||'',supplier:p.supplier||'',displayQty:p.displayQty||'',unit:p.unit||''};
      out.push(makeEntry('multi_wms',id,raw,parseWms(raw,'multi'),f,['inboundNo','product','itemCode','supplier','displayQty','unit'],{photoUrl:String(r&&r.photoUrl||''),manualEdits:manualSnapshot('multi')}));
    }
    try{
      if(typeof multiPallets!=='undefined')for(const x of multiPallets){
        if(!x||!x.vendorOcr)continue;
        const o=parseVendor(x.vendorOcr,'other'),f={product:x.vendorProduct||'',palletNo:x.vendorPalletNo||''};
        out.push(makeEntry('multi_vendor',id,x.vendorOcr,o,f,['product','palletNo'],{palletSeq:String(x.seq||''),template:template(x.vendorOcr,'other'),photoUrl:String(x.vendorPhotoUrl||'')}));
      }
    }catch(_){}
    resetManual('multi');
    return out;
  }
  function productionEntries(p){
    const c=L.cache.production_wms;if(!c||Date.now()-c.ts>45000||!c.text)return [];
    const f={inboundNo:p.inboundNo||'',product:p.product||'',itemCode:p.itemCode||'',supplier:p.supplier||'',displayQty:p.qty||'',unit:p.unit||'',containerFrom:p.containerNo||p.wmsPalletNo||''};
    const e=makeEntry('production_wms',p.recordId||p.inspectionRecordId||'',c.text,parseWms(c.text,'production_wms'),f,['inboundNo','product','itemCode','supplier','displayQty','unit','containerFrom'],{productionId:String(p.productionId||'')});
    L.cache.production_wms=null;return [e];
  }
  function wrapOcr(){
    const KO=window.V26KoreanOCR;if(!KO||typeof KO.recognize!=='function'||KO.__learningWrapped)return;
    const prev=KO.recognize.bind(KO);
    KO.recognize=async function(data,fast,statusEl){const r=await prev(data,fast,statusEl);L.cache[cacheMode(statusEl)]={text:r&&r.text||'',items:r&&r.items||[],ts:Date.now()};return r;};
    KO.__learningWrapped=true;
  }
  function wrapApi(){
    if(L.wrapped||typeof window.apiPost!=='function')return;
    L.nativePost=window.apiPost;
    window.apiPost=async function(action,payload){
      const r=await L.nativePost(action,payload);
      try{
        if(r&&r.ok){
          if(action==='saveSingle')enqueue(singleEntries(payload||{},r));
          else if(action==='saveMulti')enqueue(multiEntries(payload||{},r));
          else if(action==='addProductionPallet')enqueue(productionEntries(payload||{}));
        }
      }catch(e){console.warn('[OCR Learning] capture skipped',e);}
      return r;
    };
    L.wrapped=true;
  }
  function boot(){bindManualAudit();wrapOcr();wrapApi();setTimeout(()=>L.flush(false),1500);setInterval(()=>{wrapOcr();wrapApi();},3000);}
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',boot,{once:true});else boot();
  console.info('[V55-OCR-LEARNING-1] passive learning capture active');
})();