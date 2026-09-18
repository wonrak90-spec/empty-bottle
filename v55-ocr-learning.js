/* OCR Learning Store V1 - passive client extension */
(function(){
  'use strict';
  if(window.__OCR_LEARNING_STORE_V1__) return;
  window.__OCR_LEARNING_STORE_V1__=true;
  const L=window.V55OcrLearning={
    VERSION:'V55-OCR-LEARNING-1',
    queueKey:'emptyBottle.ocrLearning.queue.v1',
    cache:{wms:null,vendor:null,multi:null,production_wms:null,other:null},
    nativePost:null,
    wrapped:false
  };
  function loadQueue(){
    try{const q=JSON.parse(localStorage.getItem(L.queueKey)||'[]');return Array.isArray(q)?q:[];}catch(_){return [];}
  }
  function saveQueue(q){
    try{localStorage.setItem(L.queueKey,JSON.stringify((q||[]).slice(-500)));}catch(_){}
  }
  function enqueue(entry){
    if(!entry||!entry.captureKey)return;
    const q=loadQueue();
    if(!q.some(x=>x.captureKey===entry.captureKey))q.push(entry);
    saveQueue(q);
  }
  L.enqueue=enqueue;
  L.loadQueue=loadQueue;
  console.info('[V55-OCR-LEARNING-1] passive learning extension loaded');
})();