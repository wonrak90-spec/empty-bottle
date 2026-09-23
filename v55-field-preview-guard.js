/* V55 Field Preview Guard
 * Preview branch only: blocks production writes while allowing local OCR/UI testing.
 */
(function(){
  'use strict';
  if(window.__V55_FIELD_PREVIEW_GUARD__)return;
  window.__V55_FIELD_PREVIEW_GUARD__=true;

  const WRITE_ACTIONS=new Set([
    'addItemAlias','uploadPhoto','saveSingle','saveMulti',
    'startProduction','addProductionPallet','finishProduction','importMaster',
    'createUser','resetUserPin','updateUser','changeMyPin'
  ]);

  function fake(action,payload){
    const id='PREVIEW-'+Date.now();
    if(action==='saveSingle')return {ok:true,id,preview:true};
    if(action==='saveMulti')return {ok:true,id,total:0,mixedCount:0,preview:true};
    if(action==='uploadPhoto')return {ok:true,url:'',preview:true};
    if(action==='startProduction')return {ok:true,id,preview:true};
    if(action==='addProductionPallet')return {ok:true,preview:true};
    if(action==='finishProduction')return {ok:true,preview:true};
    if(action==='addItemAlias')return {ok:true,preview:true};
    return {ok:false,preview:true,message:'미리보기 모드에서는 서버 변경 작업을 저장하지 않습니다.'};
  }

  function install(){
    const original=window.apiPost;
    if(typeof original!=='function'||original.__v55PreviewWrapped)return false;
    const wrapped=async function(action,payload){
      if(WRITE_ACTIONS.has(String(action||''))){
        console.info('[V55 PREVIEW] blocked write:',action);
        return fake(String(action||''),payload);
      }
      return original.apply(this,arguments);
    };
    wrapped.__v55PreviewWrapped=true;
    wrapped.__original=original;
    window.apiPost=wrapped;
    return true;
  }

  function banner(){
    if(document.getElementById('v55PreviewBanner'))return;
    const b=document.createElement('div');
    b.id='v55PreviewBanner';
    b.style.cssText='position:sticky;top:0;z-index:9999;background:#fff3cd;color:#664d03;border-bottom:1px solid #ffecb5;padding:8px 12px;text-align:center;font:700 12px system-ui;';
    b.textContent='V55 현장검증 미리보기 · OCR/차량 Session 테스트용 · 서버 저장 차단';
    document.body.insertBefore(b,document.body.firstChild);
  }

  function boot(){
    banner();
    let tries=0;
    const timer=setInterval(()=>{
      tries++;
      if(install()||tries>100)clearInterval(timer);
    },100);
    install();
  }

  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',boot,{once:true});
  else boot();
})();