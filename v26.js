/* V22.7 — OCR 경로 정리
   (1) Tesseract(기기 인식)를 더 이상 쓰지 않습니다.
       회사망에서 cdn.jsdelivr.net 이 막혀 로딩 자체가 실패하고,
       로딩되더라도 라벨 인식 정확도가 실사용 수준이 아니었습니다.
   (2) 구글 Drive OCR(서버 인식)만 사용하고, 실패하면 이유를 그대로 보여줍니다.
   기존 파일은 수정하지 않고 runOcr 만 교체합니다. */
(function () {
  'use strict';
  if (window.__v26Ocr) return;
  window.__v26Ocr = true;

  // 카메라 원본은 수 MB라 그대로 보내면 요청이 실패한다. 긴 변 기준으로 줄여서 보낸다.
  function shrink(dataUrl, maxSide, quality) {
    return new Promise(function (resolve) {
      var img = new Image();
      img.onload = function () {
        try {
          var long = Math.max(img.width, img.height);
          if (long <= maxSide) { resolve(dataUrl); return; }
          var s = maxSide / long;
          var c = document.createElement('canvas');
          c.width = Math.round(img.width * s);
          c.height = Math.round(img.height * s);
          var ctx = c.getContext('2d');
          ctx.imageSmoothingQuality = 'high';
          ctx.drawImage(img, 0, 0, c.width, c.height);
          resolve(c.toDataURL('image/jpeg', quality));
        } catch (e) { resolve(dataUrl); }
      };
      img.onerror = function () { resolve(dataUrl); };
      img.src = dataUrl;
    });
  }

  function readableError(msg) {
    var m = String(msg || '');
    if (/인증|session|SESSION/i.test(m)) return '로그인이 풀렸습니다. 다시 로그인해 주세요.';
    if (/Failed to fetch|NetworkError|network/i.test(m)) return '서버에 연결하지 못했습니다. 통신 상태를 확인해 주세요.';
    if (/오류 페이지|재배포/i.test(m)) return '서버가 최신 버전이 아닙니다. 관리자에게 재배포를 요청하세요.';
    if (/Drive|권한|permission/i.test(m)) return '서버의 Drive 권한 문제입니다. 관리자에게 알려주세요.';
    return m;
  }

  // 서버 인식만 사용 (실패 시 기기 인식으로 넘어가지 않음)
  window.runOcr = async function runOcr(dataUrl) {
    window.lastOcrEngine = '';
    window.lastOcrError = '';

    if (!window.CONFIG || !CONFIG.API_URL || String(CONFIG.API_URL).indexOf('PUT_YOUR') === 0) {
      throw new Error('서버 주소가 설정되지 않았습니다. (config.js 확인)');
    }

    var sizes = [[2200, 0.85], [1400, 0.8], [1000, 0.75]];
    var last = '';
    for (var i = 0; i < sizes.length; i++) {
      var sending = await shrink(dataUrl, sizes[i][0], sizes[i][1]);
      try {
        var res = await apiPost('ocr', { image: sending });
        if (res && res.ok && String(res.text || '').trim()) {
          window.lastOcrEngine = '구글 인식';
          return res.text;
        }
        last = (res && res.message) ? res.message : '글자를 읽지 못했습니다';
      } catch (e) {
        last = String(e && e.message ? e.message : e);
      }
    }

    window.lastOcrError = last;
    throw new Error(readableError(last) + ' — 아래 칸에 직접 입력하셔도 됩니다.');
  };

  // 실시간 인식은 Tesseract 전용이라 더 이상 동작하지 않는다.
  // 서버 인식은 한 장에 몇 초가 걸려 실시간으로 쓸 수 없으므로 버튼을 감춘다.
  function hideLiveButtons() {
    var all = document.querySelectorAll('button');
    for (var i = 0; i < all.length; i++) {
      var t = (all[i].textContent || '').replace(/\s/g, '');
      if (t.indexOf('실시간인식') >= 0 || t.indexOf('카메라중지') >= 0) {
        all[i].style.display = 'none';
      }
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', hideLiveButtons, { once: true });
  } else {
    hideLiveButtons();
  }
  // 탭을 옮길 때 새로 그려지는 버튼도 처리
  document.addEventListener('click', function () { setTimeout(hideLiveButtons, 60); });
})();
