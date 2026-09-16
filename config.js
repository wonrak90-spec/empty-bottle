// Apps Script Web App 연결 설정 — V22.3
// 정적 API_TOKEN은 보안상 제거되었습니다. 접속코드 → 단기 세션 방식으로 인증합니다.
const CONFIG = {
  API_URL: 'https://script.google.com/macros/s/AKfycbzN1SH_mzK7_U1ylz4Ion9EBFtjs5rlOt_MpfGbJE4Sw5orNUQ6Vtqi4FdHSYjG4GPUuw/exec',
  API_TOKEN: ''
};

// 기존 V22 핵심 코드는 그대로 보존하고 V22.3 안정화 패치만 뒤에서 추가 로드합니다.
(function loadExtensions(){
  const css22=document.createElement('link');css22.rel='stylesheet';css22.href='v22.css?v=20260917c';document.head.appendChild(css22);
  const css23=document.createElement('link');css23.rel='stylesheet';css23.href='v23.css?v=20260917c';document.head.appendChild(css23);
  const boot=()=>{
    if(document.getElementById('v22Loader')) return;
    const s22=document.createElement('script');s22.id='v22Loader';s22.src='v22.js?v=20260917c';s22.async=false;
    s22.onload=()=>{if(document.getElementById('v23Loader'))return;const s23=document.createElement('script');s23.id='v23Loader';s23.src='v23.js?v=20260917c';s23.async=false;document.body.appendChild(s23);};
    document.body.appendChild(s22);
  };
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',boot,{once:true});else boot();
})();
