// Apps Script Web App 연결 설정 — V26 Korean Local OCR
// 개인별 사번 + PIN → 서버 Session 인증. 정적 API 토큰은 사용하지 않습니다.
const CONFIG = {
  API_URL: 'https://script.google.com/macros/s/AKfycbw6cRBWwrtwBiTlY6SShBRs5tFPaGwYio2xn7d3ebrBX2Eru4bNogFTiL8MM2IJ1SmUaw/exec',
  API_TOKEN: ''
};

(function loadExtensions(){
  const css22=document.createElement('link');css22.rel='stylesheet';css22.href='v22.css?v=20260917d';document.head.appendChild(css22);
  const css23=document.createElement('link');css23.rel='stylesheet';css23.href='v23.css?v=20260917d';document.head.appendChild(css23);
  const css24=document.createElement('link');css24.rel='stylesheet';css24.href='v24.css?v=20260917d';document.head.appendChild(css24);
  const css25=document.createElement('link');css25.rel='stylesheet';css25.href='v25.css?v=20260918a';document.head.appendChild(css25);
  const boot=()=>{
    if(document.getElementById('v22Loader'))return;
    const s22=document.createElement('script');s22.id='v22Loader';s22.src='v22.js?v=20260918f';s22.async=false;
    s22.onload=()=>{
      if(document.getElementById('v24Loader'))return;
      const s24=document.createElement('script');s24.id='v24Loader';s24.src='v24.js?v=20260918e';s24.async=false;
      s24.onload=()=>{
        if(document.getElementById('v25Loader'))return;
        const s25=document.createElement('script');s25.id='v25Loader';s25.src='v25.js?v=20260918a';s25.async=false;
        s25.onload=()=>{
          if(document.getElementById('v26WebLoader'))return;
          const s26=document.createElement('script');
          s26.id='v26WebLoader';
          s26.src='v26-web.js?v=20260918c';
          s26.async=false;
          s26.onload=()=>{
            if(document.getElementById('v26QtyLoader'))return;
            const sq=document.createElement('script');
            sq.id='v26QtyLoader';
            sq.src='v26-qty.js?v=20260918a';
            sq.async=false;
            sq.onload=()=>{
              if(document.getElementById('v26KoreanOcrLoader'))return;
              const sk=document.createElement('script');
              sk.id='v26KoreanOcrLoader';
              sk.src='v26-korean-ocr.js?v=20260918a';
              sk.async=false;
              sk.onload=()=>{
                if(document.getElementById('v26WmsCardScanLoader'))return;
                const sc=document.createElement('script');
                sc.id='v26WmsCardScanLoader';
                sc.src='v26-wms-cardscan.js?v=20260918d';
                sc.async=false;
                sc.onload=()=>{
                  if(document.getElementById('v26VendorCardScanLoader'))return;
                  const sv=document.createElement('script');
                  sv.id='v26VendorCardScanLoader';
                  sv.src='v26-vendor-cardscan.js?v=20260918a';
                  sv.async=false;
                  sv.onload=()=>{
                    if(document.getElementById('v26ProductionWmsLoader'))return;
                    const sp=document.createElement('script');
                    sp.id='v26ProductionWmsLoader';
                    sp.src='v26-production-wms.js?v=20260918a';
                    sp.async=false;
                    sp.onload=()=>{
                      if(document.getElementById('v26StabilityLoader'))return;
                      const ss=document.createElement('script');
                      ss.id='v26StabilityLoader';
                      ss.src='v26-stability.js?v=20260918b';
                      ss.async=false;
                      document.body.appendChild(ss);
                    };
                    document.body.appendChild(sp);
                  };
                  document.body.appendChild(sv);
                };
                document.body.appendChild(sc);
              };
              document.body.appendChild(sk);
            };
            document.body.appendChild(sq);
          };
          document.body.appendChild(s26);
        };
        document.body.appendChild(s25);
      };
      document.body.appendChild(s24);
    };
    document.body.appendChild(s22);
  };
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',boot,{once:true});else boot();
})();
