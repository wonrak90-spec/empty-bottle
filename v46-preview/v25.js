/* V22.6 — 글자 크기 조절
   기존 파일은 건드리지 않고 이 레이어만 추가합니다.
   앱의 글자 크기가 rem 기준이라, 문서 기준 크기만 바꾸면 화면 전체가 같이 커집니다. */
(function () {
  'use strict';
  if (window.__v25TextSize) return;
  window.__v25TextSize = true;

  var KEY = 'gongbyeong_text_scale';
  var STEPS = [
    { id: 's',  label: '작게',   scale: 0.9 },
    { id: 'm',  label: '보통',   scale: 1.0 },
    { id: 'l',  label: '크게',   scale: 1.15 },
    { id: 'xl', label: '아주 크게', scale: 1.3 }
  ];

  function currentId() {
    try {
      var v = localStorage.getItem(KEY);
      if (v && STEPS.some(function (s) { return s.id === v; })) return v;
    } catch (e) {}
    return 'm';
  }

  function stepById(id) {
    for (var i = 0; i < STEPS.length; i++) if (STEPS[i].id === id) return STEPS[i];
    return STEPS[1];
  }

  function apply(id, save) {
    var st = stepById(id);
    // 앱 기준 글자 크기는 16px. 여기에 배율을 곱한다.
    document.documentElement.style.fontSize = (16 * st.scale) + 'px';
    if (save !== false) { try { localStorage.setItem(KEY, st.id); } catch (e) {} }
    markActive(st.id);
    return st;
  }

  function markActive(id) {
    var btns = document.querySelectorAll('.v25-size-opt');
    for (var i = 0; i < btns.length; i++) {
      btns[i].classList.toggle('active', btns[i].getAttribute('data-size') === id);
    }
    var badge = document.getElementById('v25SizeBadge');
    if (badge) badge.textContent = stepById(id).label;
  }

  function buildPanel() {
    var wrap = document.createElement('div');
    wrap.className = 'v25-size-panel';
    wrap.id = 'v25SizePanel';
    wrap.setAttribute('role', 'group');
    wrap.setAttribute('aria-label', '글자 크기');

    var title = document.createElement('div');
    title.className = 'v25-size-title';
    title.textContent = '글자 크기';
    wrap.appendChild(title);

    var row = document.createElement('div');
    row.className = 'v25-size-row';
    STEPS.forEach(function (s) {
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'v25-size-opt';
      b.setAttribute('data-size', s.id);
      b.textContent = s.label;
      b.addEventListener('click', function () {
        apply(s.id);
        closePanel();
      });
      row.appendChild(b);
    });
    wrap.appendChild(row);
    return wrap;
  }

  function closePanel() {
    var p = document.getElementById('v25SizePanel');
    if (p) p.classList.remove('open');
  }

  function togglePanel() {
    var p = document.getElementById('v25SizePanel');
    if (!p) return;
    p.classList.toggle('open');
  }

  function buildButton() {
    var btn = document.createElement('button');
    btn.type = 'button';
    btn.id = 'v25SizeBtn';
    btn.className = 'v25-size-btn';
    btn.setAttribute('aria-label', '글자 크기 조절');
    btn.innerHTML = '<span class="v25-ga">가</span><span class="v25-badge" id="v25SizeBadge"></span>';
    btn.addEventListener('click', function (e) {
      e.stopPropagation();
      togglePanel();
    });
    return btn;
  }

  function mount() {
    if (document.getElementById('v25SizeBtn')) return;

    var host = document.createElement('div');
    host.className = 'v25-size-host';
    host.appendChild(buildPanel());
    host.appendChild(buildButton());
    document.body.appendChild(host);

    // 바깥을 누르면 닫힘
    document.addEventListener('click', function (e) {
      if (!host.contains(e.target)) closePanel();
    });

    apply(currentId(), false);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', mount, { once: true });
  } else {
    mount();
  }

  // 로그인 화면이 나중에 그려지는 경우에도 크기가 유지되도록 한 번 더 적용
  window.addEventListener('load', function () { apply(currentId(), false); });
})();
