// Apps Script 배포 후 나온 /exec 로 끝나는 URL을 아래에 붙여넣으세요.
// 예: 'https://script.google.com/macros/s/AKfycbw.../exec'
//
// API_TOKEN은 backend/Code.gs의 API_TOKEN 값과 정확히 같아야 합니다.
// (이미 backend/Code.gs에 무작위 문자열이 들어가 있으니, 그대로 복사해서 아래에 붙여넣으면 됩니다.
//  더 안전하게 하려면 두 곳 모두 본인만 아는 새 문자열로 바꿔도 됩니다.)
const CONFIG = {
  API_URL: 'https://script.google.com/macros/s/AKfycbwTBf3oHI88yvATBX1usuoSY4iCx5Q2G8Rsmvchx1jsdTkq1yEM03QXMJxUSPJYdcstLA/exec',
  API_TOKEN: 'lkC4e4hdWJIu2MOAckRurQC94hyc1cB-'
};

// 기존 app.js를 건드리지 않고 코드 없는 일반 라벨/직접입력 동선을 보강한다.
(function loadManualModeEnhancement() {
  const s = document.createElement('script');
  s.src = 'manual-mode.js?v=20260916';
  s.async = true;
  document.head.appendChild(s);
})();
