/* R15 OCR 연결부
 * 엔진과 파서는 R14.2 파일을 그대로 쓴다 (v26-korean-ocr, v55-wms-parser, v55-vendor-parser, v55-adaptive-ocr).
 * 순서는 R14.2 ocr-runtime.js의 사진 인식과 같다: 기기 OCR → 파서 → 영역 재인식, 기기 OCR이 안 되면 서버 OCR.
 * 실시간 카메라 감시는 쓰지 않는다. 사진 한 장을 찍으면 그 사진만 읽는다.
 */
(function () {
  'use strict';
  const R = window.R15;
  const O = R.ocr = { lastEngine: '' };

  function parse(mode, text, items) {
    try {
      if (mode === 'vendor') return (window.V55VendorParser ? V55VendorParser.parse(text || '', items || []) : parseVendorLabel(text || '')) || {};
      return (window.V55WmsParser ? V55WmsParser.parse(text || '', items || []) : parseLabelText(text || '')) || {};
    } catch (e) { console.warn('[R15 OCR] parser', e); return {}; }
  }
  O.parse = parse;

  async function serverOcr(dataUrl) {
    const img = await R.shrink(dataUrl, 2000, 0.82);
    const res = await R.apiPost('ocr', { image: img }, 60000);
    if (!res || !res.ok || !String(res.text || '').trim()) throw new Error((res && res.message) || '서버 OCR이 글자를 읽지 못했습니다');
    return String(res.text);
  }

  // 모델(약 18MB)을 미리 받아 둔다. 첫 촬영이 느려지지 않게 로그인 직후 한 번 부른다.
  O.warmup = function (statusEl) {
    try { if (window.V26KoreanOCR && V26KoreanOCR.ensureEngine) return V26KoreanOCR.ensureEngine(statusEl).catch(() => null); } catch (_) {}
    return Promise.resolve(null);
  };

  O.read = async function (dataUrl, mode, statusEl) {
    const KO = window.V26KoreanOCR; let base = null, err = '';
    if (KO && KO.recognize) {
      try { base = await KO.recognize(dataUrl, false, statusEl); } catch (e) { err = String(e && e.message || e); }
    } else err = '기기 OCR 엔진 없음';
    if (!base) {
      if (statusEl && typeof setStatus === 'function') setStatus(statusEl, '기기 OCR 실패 · 서버 OCR로 다시 읽는 중…', 'warn');
      try {
        const text = await serverOcr(dataUrl); O.lastEngine = '서버 OCR';
        return { text, parsed: parse(mode, text, []), method: 'server' };
      } catch (e2) {
        throw new Error('글자를 읽지 못했습니다 (' + err + ' / ' + (e2.message || e2) + ') · 직접 입력하세요');
      }
    }
    let parsed = parse(mode, base.text, base.items || []), method = 'baseline';
    if (window.V55AdaptiveOCR && V55AdaptiveOCR.recognize) {
      try { const out = await V55AdaptiveOCR.recognize(dataUrl, mode === 'vendor' ? 'vendor' : 'wms', base); if (out && out.parsed) parsed = out.parsed; method = String(out && out.method || method); }
      catch (e) { console.warn('[R15 OCR] adaptive', e); }
    }
    O.lastEngine = '기기 OCR';
    return { text: String(base.text || ''), parsed, method, latency: Number(base.latency) || 0 };
  };
})();
