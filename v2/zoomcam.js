/* R15 업체 라벨 확대 촬영 (R14 v56-vendor-distance의 줌 카메라를 줄여 옮김)
 * 업체 라벨은 적재된 차량 위 2~3m에 붙어 있어 기본 카메라로 찍으면 글자가 작다.
 * 카메라가 줌을 지원하면 기본 4배(하드웨어), 아니면(iPhone Safari 등) 화면 가운데를 기본 3배로 잘라 확대한다.
 * R.zoomcam.capture() → 사진 dataURL, 취소하면 null, '기본 카메라'를 고르면 'fallback'.
 */
(function () {
  'use strict';
  const R = window.R15, { $ } = R.util;
  const Z = R.zoomcam = { supported: !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia) };
  let stream = null, track = null, mode = 'software', soft = 3, done = null;

  function ui() {
    if ($('zcam')) return;
    document.body.insertAdjacentHTML('beforeend', `<div id="zcam" class="zcam" hidden>
      <div class="zcam-view"><video id="zcVideo" playsinline muted autoplay></video><div class="zcam-frame"></div></div>
      <div class="zcam-bar"><div class="sub" id="zcMsg">카메라 준비 중…</div>
        <div class="zcam-zoom">확대 <input type="range" id="zcRange" min="1" max="5" step="0.1" value="3"> <b id="zcVal">3.0×</b></div>
        <div class="savebar"><button type="button" class="btn" id="zcShot">촬영</button><button type="button" class="btn ghost sm" id="zcFallback">기본 카메라</button><button type="button" class="btn ghost sm" id="zcClose">닫기</button></div></div></div>`);
    $('zcShot').onclick = shoot; $('zcClose').onclick = () => finish(null); $('zcFallback').onclick = () => finish('fallback');
  }
  function stop() { if (stream) try { stream.getTracks().forEach((t) => t.stop()); } catch (_) {} stream = null; track = null; const v = $('zcVideo'); if (v) v.srcObject = null; }
  function finish(v) { stop(); const m = $('zcam'); if (m) m.hidden = true; document.body.style.overflow = ''; const d = done; done = null; if (d) d(v); }
  function preview() { const v = $('zcVideo'); v.style.transform = mode === 'software' && soft > 1 ? `scale(${soft})` : ''; }

  async function setupZoom() {
    const range = $('zcRange'), out = $('zcVal');
    let caps = {}; try { caps = track && track.getCapabilities ? track.getCapabilities() : {}; } catch (_) {}
    const z = caps.zoom;
    if (z && isFinite(z.min) && isFinite(z.max) && z.max > z.min) {
      mode = 'hardware'; const start = Math.max(z.min, Math.min(z.max, 4));
      range.min = z.min; range.max = z.max; range.step = z.step || 0.1; range.value = start;
      try { await track.applyConstraints({ advanced: [{ zoom: start }] }); } catch (_) {}
      out.textContent = Number(start).toFixed(1) + '×';
      range.oninput = () => { const n = Number(range.value); out.textContent = n.toFixed(1) + '×'; track.applyConstraints({ advanced: [{ zoom: n }] }).catch(() => null); };
    } else {
      mode = 'software'; soft = 3; range.min = 1; range.max = 5; range.step = 0.1; range.value = 3; out.textContent = '3.0×';
      range.oninput = () => { soft = Math.max(1, Math.min(5, Number(range.value) || 3)); out.textContent = soft.toFixed(1) + '×'; preview(); };
    }
    preview();
  }

  Z.capture = function () {
    ui();
    return new Promise(async (resolve) => {
      done = resolve; $('zcam').hidden = false; document.body.style.overflow = 'hidden'; $('zcMsg').textContent = '카메라 준비 중…';
      const tries = [3840, 2560, 1920].map((w) => ({ video: { facingMode: { ideal: 'environment' }, width: { ideal: w }, height: { ideal: Math.round(w * 9 / 16) } }, audio: false }));
      let last = null;
      for (const q of tries) { try { stream = await navigator.mediaDevices.getUserMedia(q); break; } catch (e) { last = e; } }
      if (!stream) { $('zcMsg').textContent = '카메라를 열지 못했습니다 · "기본 카메라"로 찍으세요 (' + ((last && last.name) || '') + ')'; return; }
      track = stream.getVideoTracks()[0] || null;
      const v = $('zcVideo'); v.srcObject = stream; try { await v.play(); } catch (_) {}
      try { const c = track.getCapabilities ? track.getCapabilities() : {}; if ((c.focusMode || []).indexOf('continuous') >= 0) await track.applyConstraints({ advanced: [{ focusMode: 'continuous' }] }); } catch (_) {}
      await setupZoom();
      $('zcMsg').textContent = `기본 ${mode === 'hardware' ? '4.0× 확대' : '3.0× 디지털 확대'} · 라벨이 흰 테두리 안을 60~80% 채우게 맞추고 촬영하세요`;
    });
  };

  async function shoot() {
    const v = $('zcVideo'); if (!v || !v.videoWidth) return R.toast('카메라 화면이 아직 준비되지 않았습니다', 'warn');
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
    finish(url);
  }
  document.addEventListener('visibilitychange', () => { if (document.hidden && stream) finish(null); });
})();
