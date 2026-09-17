/* V22.4.1 OCR Worker 안정화 핫픽스
 * 목적:
 * - 기존 단건/OCR/조회/보고/계정 기능은 수정하지 않음
 * - Tesseract.js Worker 로딩 경로만 명시적으로 지정
 * - jsDelivr 단일 의존을 제거하고 unpkg -> cdnjs -> jsDelivr 순으로 재시도
 */
(function () {
  'use strict';

  if (window.__emptyBottleOcrHotfixV2241) return;
  window.__emptyBottleOcrHotfixV2241 = true;

  var hotfixWorker = null;
  var creatingWorker = null;
  var activeProgressId = '';

  function updateProgress(m) {
    if (!m || m.status !== 'recognizing text') return;
    var pct = Math.round((m.progress || 0) * 100) + '%';
    var ids = [activeProgressId, 'ocrProgressWms', 'ocrProgressVendor', 'ocrProgressMulti'];
    var seen = {};
    ids.forEach(function (id) {
      if (!id || seen[id]) return;
      seen[id] = true;
      var el = document.getElementById(id);
      if (el) el.style.width = pct;
    });
  }

  function resetOldWorker() {
    try {
      if (typeof ocrWorker !== 'undefined' && ocrWorker && ocrWorker !== hotfixWorker) {
        try { ocrWorker.terminate(); } catch (_) {}
      }
      if (typeof ocrWorker !== 'undefined') ocrWorker = null;
    } catch (_) {}
  }

  async function loadTesseractIfNeeded() {
    if (window.Tesseract && typeof window.Tesseract.createWorker === 'function') return;

    var urls = [
      'https://unpkg.com/tesseract.js@5.1.1/dist/tesseract.min.js',
      'https://cdnjs.cloudflare.com/ajax/libs/tesseract.js/5.1.1/tesseract.min.js'
    ];

    var lastErr = null;
    for (var i = 0; i < urls.length; i++) {
      try {
        await new Promise(function (resolve, reject) {
          var s = document.createElement('script');
          s.src = urls[i];
          s.async = true;
          s.onload = resolve;
          s.onerror = function () { reject(new Error('Tesseract 본체 로딩 실패: ' + urls[i])); };
          document.head.appendChild(s);
        });
        if (window.Tesseract && typeof window.Tesseract.createWorker === 'function') return;
      } catch (e) {
        lastErr = e;
      }
    }
    throw lastErr || new Error('Tesseract OCR 라이브러리를 불러오지 못했습니다.');
  }

  var WORKER_CANDIDATES = [
    {
      name: 'unpkg',
      workerPath: 'https://unpkg.com/tesseract.js@5.1.1/dist/worker.min.js',
      corePath: 'https://unpkg.com/tesseract.js-core@5.1.1',
      langPath: 'https://tessdata.projectnaptha.com/4.0.0'
    },
    {
      name: 'cdnjs',
      workerPath: 'https://cdnjs.cloudflare.com/ajax/libs/tesseract.js/5.1.1/worker.min.js',
      corePath: 'https://unpkg.com/tesseract.js-core@5.1.1',
      langPath: 'https://tessdata.projectnaptha.com/4.0.0'
    },
    {
      name: 'jsdelivr',
      workerPath: 'https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/worker.min.js',
      corePath: 'https://cdn.jsdelivr.net/npm/tesseract.js-core@5.1.1',
      langPath: 'https://tessdata.projectnaptha.com/4.0.0'
    }
  ];

  async function createStableWorker() {
    await loadTesseractIfNeeded();
    resetOldWorker();

    var errors = [];
    for (var i = 0; i < WORKER_CANDIDATES.length; i++) {
      var c = WORKER_CANDIDATES[i];
      try {
        var w = await window.Tesseract.createWorker('kor+eng', 1, {
          workerPath: c.workerPath,
          corePath: c.corePath,
          langPath: c.langPath,
          logger: updateProgress
        });
        hotfixWorker = w;
        try {
          if (typeof ocrWorker !== 'undefined') ocrWorker = w;
        } catch (_) {}
        console.info('[OCR V22.4.1] Worker loaded via ' + c.name);
        return w;
      } catch (e) {
        errors.push(c.name + ': ' + String(e && e.message ? e.message : e));
        console.warn('[OCR V22.4.1] ' + c.name + ' Worker failed', e);
      }
    }

    throw new Error(
      'OCR 엔진을 불러오지 못했습니다. 네트워크 상태를 확인한 뒤 다시 시도하세요. (' +
      errors.join(' / ') + ')'
    );
  }

  window.getOcrWorker = async function (progressId) {
    activeProgressId = progressId || activeProgressId || '';
    if (hotfixWorker) return hotfixWorker;
    if (!creatingWorker) {
      creatingWorker = createStableWorker().finally(function () {
        creatingWorker = null;
      });
    }
    return creatingWorker;
  };

  window.resetOcrWorkerV2241 = async function () {
    try {
      if (hotfixWorker && hotfixWorker.terminate) await hotfixWorker.terminate();
    } catch (_) {}
    hotfixWorker = null;
    creatingWorker = null;
    try { if (typeof ocrWorker !== 'undefined') ocrWorker = null; } catch (_) {}
    return true;
  };

  console.info('[OCR V22.4.1] Worker 안정화 핫픽스 활성화');
})();
