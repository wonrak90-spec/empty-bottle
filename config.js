// Apps Script Web App 연결 설정 — V22.4
// 개인별 사번 + PIN → 서버 Session 인증. 정적 API 토큰은 사용하지 않습니다.
const CONFIG = {
  API_URL: 'https://script.google.com/macros/s/AKfycbw6cRBWwrtwBiTlY6SShBRs5tFPaGwYio2xn7d3ebrBX2Eru4bNogFTiL8MM2IJ1SmUaw/exec',
  API_TOKEN: ''
};

(function loadExtensions(){
  const css22=document.createElement('link');css22.rel='stylesheet';css22.href='v22.css?v=20260917d';document.head.appendChild(css22);
  const css23=document.createElement('link');css23.rel='stylesheet';css23.href='v23.css?v=20260917d';document.head.appendChild(css23);
  const css24=document.createElement('link');css24.rel='stylesheet';css24.href='v24.css?v=20260917d';document.head.appendChild(css24);
  const boot=()=>{
    if(document.getElementById('v22Loader'))return;
    const s22=document.createElement('script');s22.id='v22Loader';s22.src='v22.js?v=20260917d';s22.async=false;
    s22.onload=()=>{if(document.getElementById('v24Loader'))return;const s24=document.createElement('script');s24.id='v24Loader';s24.src='v24.js?v=20260917d';s24.async=false;document.body.appendChild(s24);};
    document.body.appendChild(s22);
  };
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',boot,{once:true});else boot();
})();
