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

  // WMS·업체 사진을 연달아 찍어도 엔진 하나를 같이 쓰지 않게 차례로 읽는다 (동시에 부르면 기기 OCR이 실패해 느린 서버 OCR로 넘어갔다)
  let chain = Promise.resolve();
  O.read = function (dataUrl, mode, statusEl) {
    const run = chain.then(() => readOne(dataUrl, mode, statusEl));
    chain = run.catch(() => null);
    return run;
  };
  const DATE_RE = /\d{1,2}\s*[월윌원]\s*\d{1,2}\s*[일잉얼]|생\s*산\s*일/;
  // OCR 글자 상자 좌표는 엔진이 키운 캔버스 기준이다 (v26-korean-ocr dataUrlToCanvas와 같은 배율)
  function ocrScale(iw, ih, limit) {
    const long = Math.max(iw, ih); let sc = Math.min(1, limit / Math.max(1, long));
    if (long < 1500) sc = Math.min(2.4, Math.max(1, Math.min(limit, 1600) / Math.max(1, long)));
    return sc;
  }
  function boxOf(it) {
    const xs = [], ys = []; (it.poly || []).forEach((p) => { if (Array.isArray(p)) { xs.push(+p[0] || 0); ys.push(+p[1] || 0); } else if (p) { xs.push(+p.x || 0); ys.push(+p.y || 0); } });
    if (!xs.length) return null; const x = Math.min(...xs), y = Math.min(...ys);
    return { x, y, w: Math.max(...xs) - x, h: Math.max(1, Math.max(...ys) - y) };
  }
  // 시간 글자만 남긴다: "17시10분", "17:10", 날짜를 뺀 뒤 숫자 4자리 "1710"
  function timeFrom(text) {
    const t = String(text || '').replace(/[Oo]/g, '0').replace(/[lI|]/g, '1').replace(/S/g, '5').replace(/B/g, '8')
      .replace(/\d{2,4}\s*[년넌닌]|\d{1,2}\s*[월윌원]\s*\d{1,2}\s*[일잉얼]/g, ' ');
    const ok = (h, m) => (+h < 24 && +m < 60 ? String(+h).padStart(2, '0') + ':' + String(+m).padStart(2, '0') : '');
    let m = t.match(/(\d{1,2})\s*[시사지]\s*(\d{1,2})\s*[분푼본]?/) || t.match(/(\d{1,2})\s*[:;]\s*(\d{2})(?!\d)/);
    if (m) return ok(m[1], m[2]);
    const d = t.match(/\d+/g) || [];
    if (d.length === 1 && d[0].length === 4) return ok(d[0].slice(0, 2), d[0].slice(2));
    return '';
  }
  O._timeFrom = timeFrom;
  async function timeRoi(dataUrl, items, KO) {
    const it = items.find((x) => DATE_RE.test(String(x.text || '')) && /[일잉얼]/.test(String(x.text || ''))) || items.find((x) => DATE_RE.test(String(x.text || '')));
    const b = it && boxOf(it); if (!b) return '';
    const img = await createImageBitmap(await (await fetch(dataUrl)).blob()), sc = ocrScale(img.width, img.height, 2300);
    const x0 = Math.max(0, (b.x + b.w * 0.45) / sc), y0 = Math.max(0, (b.y - b.h * 0.8) / sc);
    const x1 = Math.min(img.width, (b.x + b.w * 2.2) / sc), y1 = Math.min(img.height, (b.y + b.h * 1.8) / sc);
    if (x1 - x0 < 20 || y1 - y0 < 10) return '';
    const k = Math.min(3, 1400 / (x1 - x0)), c = document.createElement('canvas'); c.width = Math.round((x1 - x0) * k); c.height = Math.round((y1 - y0) * k);
    const g = c.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height); g.imageSmoothingQuality = 'high';
    g.filter = 'grayscale(1) contrast(1.4)'; g.drawImage(img, x0, y0, x1 - x0, y1 - y0, 0, 0, c.width, c.height);
    const r = await KO.recognize(c.toDataURL('image/jpeg', 0.9), true);
    return timeFrom(r && r.text);
  }
  O._timeRoi = timeRoi;
  async function readOne(dataUrl, mode, statusEl) {
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
    // 업체 생산일은 읽었는데 손글씨 시간만 못 읽었으면: 날짜 글자 오른쪽만 잘라 크게 키워 한 번 더 읽는다
    if (mode === 'vendor' && parsed && parsed.prodDate && !parsed.prodTime) {
      try { const tm = await timeRoi(dataUrl, base.items || [], KO); if (tm) { parsed = Object.assign({}, parsed, { prodTime: tm }); method += '+time'; } } catch (e) { console.warn('[R15 OCR] time', e); }
    }
    O.lastEngine = '기기 OCR';
    return { text: String(base.text || ''), parsed, method, latency: Number(base.latency) || 0 };
  }
})();
