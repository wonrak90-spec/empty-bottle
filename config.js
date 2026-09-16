// Apps Script Web App 연결 설정
const CONFIG = {
  API_URL: 'https://script.google.com/macros/s/AKfycbwTBf3oHI88yvATBX1usuoSY4iCx5Q2G8Rsmvchx1jsdTkq1yEM03QXMJxUSPJYdcstLA/exec',
  API_TOKEN: 'lkC4e4hdWJIu2MOAckRurQC94hyc1cB-'
};

// V22는 V21 핵심 코드를 보존하고 확장 파일을 뒤에서 로드합니다.
(function loadV22(){
  const link=document.createElement('link');
  link.rel='stylesheet'; link.href='v22.css?v=20260916b'; document.head.appendChild(link);
  const boot=()=>{
    if(document.getElementById('v22Loader')) return;
    const s=document.createElement('script'); s.id='v22Loader'; s.src='v22.js?v=20260916b'; s.async=false; document.body.appendChild(s);
  };
  if(document.readyState==='loading') document.addEventListener('DOMContentLoaded',boot,{once:true}); else boot();
})();
