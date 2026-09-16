// Apps Script 배포 후 나온 /exec 로 끝나는 URL을 아래에 붙여넣으세요.
// 예: 'https://script.google.com/macros/s/AKfycbw.../exec'
//
// API_TOKEN은 backend/Code.gs의 API_TOKEN 값과 정확히 같아야 합니다.
const CONFIG = {
  API_URL: 'https://script.google.com/macros/s/AKfycbwTBf3oHI88yvATBX1usuoSY4iCx5Q2G8Rsmvchx1jsdTkq1yEM03QXMJxUSPJYdcstLA/exec',
  API_TOKEN: 'lkC4e4hdWJIu2MOAckRurQC94hyc1cB-'
};

// V22는 기존 app.js가 모두 로드된 뒤 추가 기능만 덧붙인다.
window.addEventListener('load', () => {
  if (!document.querySelector('link[data-v22]')) {
    const css = document.createElement('link');
    css.rel = 'stylesheet'; css.href = 'v22.css?v=20260916'; css.dataset.v22 = '1';
    document.head.appendChild(css);
  }
  if (!document.querySelector('script[data-v22]')) {
    const js = document.createElement('script');
    js.src = 'v22.js?v=20260916'; js.dataset.v22 = '1';
    document.body.appendChild(js);
  }
});
