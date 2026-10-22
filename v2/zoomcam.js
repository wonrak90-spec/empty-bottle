/* R15 앱 카메라 (R14 v56-vendor-distance의 줌 카메라를 줄여 옮김)
 * 업체 라벨은 적재된 차량 위 2~3m에 붙어 있어 확대가 필요하고, WMS 라벨은 가까이서 1배로 찍는다.
 * 카메라가 줌을 지원하면 하드웨어 줌(업체 기본 4배), 아니면(iPhone Safari 등) 화면 가운데를 디지털 확대(업체 기본 3배).
 * R.zoomcam.capture()  : 업체 라벨 한 장 → dataURL / 취소 null / '기본 카메라' 'fallback'
 * R.zoomcam.sequence(onShot) : 연속 촬영. WMS(1배) → 자동으로 업체 배율 → 업체. onShot(kind, dataURL|null)
 *   업체 단계의 '업체 라벨 없음'은 onShot('vendor', null). 끝나면 'done', 닫으면 null, 기본 카메라 'fallback'.
 */
(function () {
  'use strict';
  const R = window.R15, { $ } = R.util;
  const Z = R.zoomcam = { supported: !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia) };
  let stream = null, track = null, mode = 'software', soft = 3, zr = null, done = null, step = null;
  const VENDOR_HW = 4, VENDOR_SW = 3;

  function ui() {
    if ($('zcam')) return;
    document.body.insertAdjacentHTML('beforeend', `<div id="zcam" class="zcam" hidden>
      <div class="zcam-view"><video id="zcVideo" playsinline muted autoplay></video><div class="zcam-frame" id="zcFrame"></div><div class="zcam-step" id="zcStep"></div></div>
      <div class="zcam-bar"><div class="sub" id="zcMsg">카메라 준비 중…</div>
        <div class="zcam-zoom">확대 <input type="range" id="zcRange" min="1" max="5" step="0.1" value="3"> <b id="zcVal">3.0×</b></div>
        <div class="savebar"><button type="button" class="btn" id="zcShot">촬영</button><button type="button" class="btn ghost sm" id="zcSkip" hidden>업체 라벨 없음</button><button type="button" class="btn ghost sm" id="zcFallback">기본 카메라</button><button type="button" class="btn ghost sm" id="zcClose">닫기</button></div></div></div>`);
    $('zcShot').onclick = shoot; $('zcClose').onclick = () => finish(null); $('zcFallback').onclick = () => finish('fallback');
    $('zcSkip').onclick = () => { if (step) step('skip'); };
    $('zcRange').oninput = () => setZoom(Number($('zcRange').value));
  }
  function stop() { clearTimeout(idle); if (stream) try { stream.getTracks().forEach((t) => t.stop()); } catch (_) {} stream = null; track = null; const v = $('zcVideo'); if (v) v.srcObject = null; }
  // 닫아도 카메라를 바로 끄지 않고 잠시 켜 둔다. 끄고 다시 열 때마다 폰(특히 iPhone 홈 화면 앱)이 권한 허용 창을 또 띄우기 때문.
  // 다음 Pallet에서 같은 카메라를 다시 쓰고, 3분 동안 안 쓰거나 앱을 내리면 끈다.
  const KEEP_MS = 180000; let idle = 0;
  const live = () => !!(stream && track && track.readyState === 'live');
  function park() { clearTimeout(idle); const v = $('zcVideo'); if (v) try { v.pause(); } catch (_) {} idle = setTimeout(stop, KEEP_MS); }
  function finish(v) { if (live()) park(); else stop(); step = null; const m = $('zcam'); if (m) m.hidden = true; document.body.style.overflow = ''; const d = done; done = null; if (d) d(v); }

  function setZoom(n) {
    const out = $('zcVal'), range = $('zcRange'), v = $('zcVideo');
    if (mode === 'hardware') { n = Math.max(zr.min, Math.min(zr.max, n)); track.applyConstraints({ advanced: [{ zoom: n }] }).catch(() => null); }
    else { n = Math.max(1, Math.min(5, n)); soft = n; }
    range.value = n; out.textContent = Number(n).toFixed(1) + '×';
    v.style.transform = mode === 'software' && soft > 1 ? `scale(${soft})` : '';
  }
  function preset(kind) { setZoom(kind === 'vendor' ? (mode === 'hardware' ? VENDOR_HW : VENDOR_SW) : (mode === 'hardware' ? zr.min : 1)); }
  function setStep(kind) {
    $('zcStep').textContent = kind === 'wms' ? '① WMS 라벨 · 1배' : '② 업체 라벨 · 확대';
    $('zcFrame').className = 'zcam-frame' + (kind === 'wms' ? ' near' : '');
    $('zcSkip').hidden = kind !== 'vendor' || !Z.seq;
    $('zcMsg').textContent = kind === 'wms' ? 'WMS 라벨을 흰 테두리 안에 맞추고 촬영하세요 (바코드가 보이게)' : `업체 라벨 · 기본 ${mode === 'hardware' ? VENDOR_HW + '배 줌' : VENDOR_SW + '배 디지털 확대'} · 라벨이 테두리 안을 60~80% 채우게`;
    preset(kind);
  }

  async function open() {
    ui(); $('zcam').hidden = false; document.body.style.overflow = 'hidden'; $('zcMsg').textContent = '카메라 준비 중…';
    const tries = [3840, 2560, 1920].map((w) => ({ video: { facingMode: { ideal: 'environment' }, width: { ideal: w }, height: { ideal: Math.round(w * 9 / 16) } }, audio: false }));
    let last = null;
    clearTimeout(idle);
    if (live()) { const v = $('zcVideo'); if (v.srcObject !== stream) v.srcObject = stream; try { await v.play(); } catch (_) {} return true; } // 켜 둔 카메라 다시 쓰기 (권한 창 없음)
    stop();
    for (const q of tries) { try { stream = await navigator.mediaDevices.getUserMedia(q); break; } catch (e) { last = e; } }
    if (!stream) { $('zcMsg').textContent = '카메라를 열지 못했습니다 · "기본 카메라"로 찍으세요 (' + ((last && last.name) || '') + ')'; return false; }
    track = stream.getVideoTracks()[0] || null;
    const v = $('zcVideo'); v.srcObject = stream; try { await v.play(); } catch (_) {}
    let caps = {}; try { caps = track.getCapabilities ? track.getCapabilities() : {}; } catch (_) {}
    try { if ((caps.focusMode || []).indexOf('continuous') >= 0) await track.applyConstraints({ advanced: [{ focusMode: 'continuous' }] }); } catch (_) {}
    const z = caps.zoom;
    if (z && isFinite(z.min) && isFinite(z.max) && z.max > z.min) { mode = 'hardware'; zr = z; $('zcRange').min = z.min; $('zcRange').max = z.max; $('zcRange').step = z.step || 0.1; }
    else { mode = 'software'; zr = null; $('zcRange').min = 1; $('zcRange').max = 5; $('zcRange').step = 0.1; }
    return true;
  }

  async function grab() {
    const v = $('zcVideo'); if (!v || !v.videoWidth) { R.toast('카메라 화면이 아직 준비되지 않았습니다', 'warn'); return ''; }
    let url = '';
    // 하드웨어 줌이면 ImageCapture가 화면보다 고해상도 사진을 준다 (지원하는 기기만)
    if (mode === 'hardware' && typeof ImageCapture !== 'undefined') {
      try { const blob = await new ImageCapture(track).takePhoto(); url = await new Promise((ok, no) => { const fr = new FileReader(); fr.onload = () => ok(String(fr.result)); fr.onerror = no; fr.readAsDataURL(blob); }); } catch (_) { url = ''; }
    }
    if (!url) {
      const c = document.createElement('canvas'), z = mode === 'software' ? soft : 1, sw = v.videoWidth / z, sh = v.videoHeight / z;
      c.width = v.videoWidth; c.height = v.videoHeight;
      const x = c.getContext('2d', { alpha: false }); x.imageSmoothingQuality = 'high';
      x.drawImage(v, (v.videoWidth - sw) / 2, (v.videoHeight - sh) / 2, sw, sh, 0, 0, c.width, c.height);
      url = c.toDataURL('image/jpeg', 0.95);
    }
    const f = $('zcFrame'); f.classList.add('flash'); setTimeout(() => f.classList.remove('flash'), 180);
    return url;
  }
  async function shoot() { const url = await grab(); if (url && step) step(url); }

  Z.capture = function () {
    Z.seq = false;
    return new Promise(async (resolve) => {
      done = resolve; if (!(await open())) return;
      setStep('vendor'); step = (url) => { if (url !== 'skip') finish(url); };
    });
  };
  Z.sequence = function (onShot) {
    Z.seq = true;
    return new Promise(async (resolve) => {
      done = resolve; if (!(await open())) return;
      setStep('wms');
      step = (url) => {
        if (url === 'skip') return;
        onShot('wms', url); setStep('vendor');
        step = (u2) => { onShot('vendor', u2 === 'skip' ? null : u2); finish('done'); };
      };
    });
  };
  document.addEventListener('visibilitychange', () => { if (document.hidden && stream) { if (done) finish(null); stop(); } });
})();
