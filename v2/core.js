/* R15 공통: 서버 호출(시간 제한 포함), 로그인, 화면 도우미.
 * apiGet / apiPost는 이 파일에서만 정의한다. (R14까지는 3곳에서 덮어써서 동작이 꼬였다) */
(function () {
  'use strict';
  const C = window.R15_CONFIG;
  const STORE = 'emptyBottle.v24.session'; // 기존 화면과 같은 로그인 저장소를 쓴다 (한 번 로그인으로 둘 다 사용)
  const R = window.R15 = { session: null, user: null, listeners: {} };

  /* ---------- 화면 도우미 ---------- */
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const num = (v) => { const n = Number(String(v == null ? '' : v).replace(/,/g, '')); return Number.isFinite(n) ? n : 0; };
  const fmt = (v) => { const n = num(v); return n ? n.toLocaleString('ko-KR') : (v === 0 || v === '0' ? '0' : ''); };
  const digits = (v) => String(v == null ? '' : v).replace(/\.0+$/, '').replace(/\D/g, '');
  const pad = (n, w) => String(n).padStart(w || 2, '0');
  const today = (off) => { const d = new Date(Date.now() + (off || 0) * 86400000); return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); };
  R.util = { $, esc, num, fmt, digits, pad, today };

  R.on = (ev, fn) => { (R.listeners[ev] = R.listeners[ev] || []).push(fn); };
  R.emit = (ev, data) => { (R.listeners[ev] || []).forEach((fn) => { try { fn(data); } catch (e) { console.error(e); } }); };

  let toastTimer = 0;
  R.toast = function (text, type) {
    const el = $('toast'); if (!el) return;
    el.textContent = text; el.dataset.type = type || ''; el.hidden = false;
    clearTimeout(toastTimer); toastTimer = setTimeout(() => { el.hidden = true; }, type === 'crit' ? 6000 : 3000);
  };
  R.busy = function (btn, on, label) {
    if (!btn) return;
    if (on) { btn.dataset.label = btn.textContent; btn.disabled = true; if (label) btn.textContent = label; }
    else { btn.disabled = false; if (btn.dataset.label) btn.textContent = btn.dataset.label; }
  };
  R.pill = (level, text) => `<span class="pill p-${level === 'error' ? 'crit' : level === 'warn' ? 'warn' : level === 'ok' ? 'good' : 'idle'}"><i></i>${esc(text)}</span>`;

  /* ---------- 서버 호출 ---------- */
  class ApiError extends Error {
    constructor(message, kind, res) { super(message); this.kind = kind; this.res = res || null; }
  }
  R.ApiError = ApiError;

  async function request(url, opts, ms) {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), ms);
    let res, text;
    try {
      res = await fetch(url, Object.assign({}, opts, { signal: ctl.signal, cache: 'no-store', redirect: 'follow' }));
      text = await res.text();
    } catch (e) {
      // 시간 초과와 네트워크 끊김은 모두 '다시 시도' 대상이다
      throw new ApiError(e && e.name === 'AbortError' ? '서버 응답 시간 초과' : '네트워크 연결 안 됨', 'network');
    } finally { clearTimeout(timer); }
    const head = text.slice(0, 300).trim();
    if (head.startsWith('<')) throw new ApiError('서버가 오류 페이지를 보냈습니다 (Apps Script 배포 확인 필요)', 'server');
    try { return JSON.parse(text); } catch (_) { throw new ApiError('서버 응답을 읽지 못했습니다', 'server'); }
  }

  function loadSession() {
    try { const x = JSON.parse(localStorage.getItem(STORE) || 'null'); if (x && x.session && Number(x.expiresAt) > Date.now() + 5000) return x; } catch (_) {}
    return null;
  }
  function saveSession(x) { try { localStorage.setItem(STORE, JSON.stringify(x)); } catch (_) {} }
  function clearSession() { try { localStorage.removeItem(STORE); } catch (_) {} }

  function checkAuth(res) {
    if (res && (res.code === 'AUTH_REQUIRED' || res.code === 'USER_DISABLED')) {
      if (R.isGuest()) { showLogin('이 화면은 로그인해야 볼 수 있습니다.'); throw new ApiError('로그인이 필요합니다', 'auth', res); }
      R.session = null; clearSession(); showLogin(res.message || '다시 로그인하세요.');
      throw new ApiError(res.message || '로그인이 필요합니다', 'auth', res);
    }
    return res;
  }

  // 기록 전체를 훑는 읽기는 1년치가 쌓이면 25초를 넘을 수 있다. 서버는 끝까지 계산하므로 앱이 먼저 포기하지 않게 더 기다린다.
  const SLOW = { r15Report: 60000, r15Stock: 60000, r15Trace: 45000, r15Audit: 45000, r15Lots: 45000, r15LotAdd: 60000, r15ArchiveInfo: 60000, r15ArchiveRun: 340000, r15BackupRun: 300000, r15BackupInfo: 60000, r15BackupSetup: 60000, r15VendorSuggest: 60000 };
  R.apiGet = async function (action, params, ms) {
    const s = R.session || loadSession(); if (!s && !R.isGuest()) { showLogin(); throw new ApiError('로그인이 필요합니다', 'auth'); }
    // Guest는 세션 없이 보낸다. 서버가 화면 권한에서 Guest에게 연 탭의 읽기만 받아준다.
    const qs = new URLSearchParams(Object.assign({ action }, s ? { session: s.session } : {}, params || {}));
    return checkAuth(await request(C.API_URL + '?' + qs.toString(), { method: 'GET' }, ms || SLOW[action] || C.TIMEOUT.get));
  };
  R.apiPost = async function (action, payload, ms) {
    const s = R.session || loadSession(); if (!s) { showLogin(); throw new ApiError('로그인이 필요합니다', 'auth'); }
    // text/plain 이어야 브라우저가 사전 요청(CORS preflight) 없이 Apps Script로 바로 보낸다
    const body = JSON.stringify({ action, payload: payload || {}, session: s.session });
    return checkAuth(await request(C.API_URL, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body }, ms || SLOW[action] || C.TIMEOUT.post));
  };
  // 화면에서 바로 쓰는 호출: 실패하면 문구를 띄우고 null
  R.tryGet = async function (action, params) {
    try { const r = await R.apiGet(action, params); if (!r.ok) { R.toast(r.message || '서버 오류', 'crit'); return null; } return r; }
    catch (e) { if (e.kind !== 'auth') R.toast(e.message, 'crit'); return null; }
  };
  R.tryPost = async function (action, payload) {
    try { const r = await R.apiPost(action, payload); if (!r.ok) { R.toast(r.message || '서버 오류', 'crit'); return r; } return r; }
    catch (e) { if (e.kind !== 'auth') R.toast(e.message, 'crit'); return null; }
  };

  /* ---------- 로그인 ---------- */
  function showLogin(msg) {
    const ov = $('login'); if (!ov) return;
    ov.hidden = false; $('loginMsg').textContent = msg || '사번과 PIN 6자리로 로그인하세요.';
    const g = $('guestBtn'); if (g) g.hidden = !(R.config && R.config.guest);
    setTimeout(() => { try { $('loginEmp').focus(); } catch (_) {} }, 50);
  }
  R.showLogin = showLogin;

  async function doLogin() {
    const emp = $('loginEmp').value.trim(), pin = $('loginPin').value.trim(), btn = $('loginBtn');
    if (!emp || !/^\d{6}$/.test(pin)) { $('loginMsg').textContent = '사번과 숫자 6자리 PIN을 입력하세요.'; return; }
    R.busy(btn, true, '로그인 중…');
    try {
      const res = await request(C.API_URL, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify({ action: 'authLogin', payload: { employeeNo: emp, pin } }) }, C.TIMEOUT.post);
      if (!res.ok) { $('loginMsg').textContent = res.message || '로그인 실패'; return; }
      $('loginPin').value = '';
      R.session = { session: res.session, expiresAt: res.expiresAt, user: res.user, role: res.user && res.user.role || 'worker' };
      setGuest(false); saveSession(R.session); applyUser(res.user); $('login').hidden = true; R.emit('login', res.user);
    } catch (e) { $('loginMsg').textContent = '로그인 실패: ' + e.message; }
    finally { R.busy(btn, false); }
  }

  async function logout() {
    const s = R.session; R.session = null; R.user = null; clearSession();
    try { if (s) await request(C.API_URL, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify({ action: 'authLogout', payload: {}, session: s.session }) }, 8000); } catch (_) {}
    setGuest(false); applyUser(null); showLogin('로그아웃했습니다.');
  }
  R.logout = logout;

  // 권한 4단계 (서버 ROLE_RANK_V24와 같다). 예전 계정의 빈 값은 작업자.
  R.ROLES = { viewer: [0, '조회'], worker: [1, '작업자'], manager: [2, '중간관리자'], admin: [3, '관리자'] };
  R.roleOf = (role) => (R.ROLES[role] ? role : 'worker');
  R.roleName = (role) => R.ROLES[R.roleOf(role)][1];
  R.rank = () => (R.user && !R.user.guest ? R.ROLES[R.roleOf(R.user.role)][0] : -1);
  R.isGuest = () => !!(R.user && R.user.guest);
  // 화면 권한: 탭마다 어느 권한부터 보이는지 (-1 Guest). 서버 r15Config, 못 읽으면 마지막 값
  const CFG = 'r15.config', GUEST = 'r15.guest', GUEST_USER = { name: 'Guest', role: 'guest', guest: true };
  try { R.config = JSON.parse(localStorage.getItem(CFG) || 'null'); } catch (_) { R.config = null; }
  R.tabMin = (tab, fallback) => (R.config && R.config.tabs && R.config.tabs[tab] !== undefined ? Number(R.config.tabs[tab]) : fallback);
  R.loadConfig = async function () {
    try { const c = await request(C.API_URL + '?action=r15Config', { method: 'GET' }, C.TIMEOUT.get); if (c && c.ok) { R.config = c; try { localStorage.setItem(CFG, JSON.stringify(c)); } catch (_) {} R.emit('config', c); } } catch (_) {}
    return R.config;
  };
  R.setConfig = (c) => { R.config = c; try { localStorage.setItem(CFG, JSON.stringify(c)); } catch (_) {} R.emit('config', c); };
  function setGuest(on) { try { if (on) localStorage.setItem(GUEST, '1'); else localStorage.removeItem(GUEST); } catch (_) {} }
  function enterGuest() { setGuest(true); applyUser(GUEST_USER); $('login').hidden = true; R.emit('login', R.user); }
  function applyUser(u) {
    R.user = u || null;
    document.body.dataset.role = u && !u.guest ? R.roleOf(u.role) : 'guest';
    const chip = $('roleChip'); if (chip) chip.textContent = u ? (u.guest ? 'Guest · 로그인' : `${u.name} · ${R.roleName(u.role)}`) : '로그인 전';
    R.emit('role', u);
  }
  R.isAdmin = () => R.rank() >= 3;
  R.isManager = () => R.rank() >= 2;

  R.boot = async function () {
    $('loginBtn').onclick = doLogin;
    $('loginPin').addEventListener('keydown', (e) => { if (e.key === 'Enter') doLogin(); });
    if ($('guestBtn')) $('guestBtn').onclick = enterGuest;
    const s = loadSession(), wasGuest = (() => { try { return localStorage.getItem(GUEST) === '1'; } catch (_) { return false; } })();
    if (!s) {
      if (wasGuest && R.config && R.config.guest) enterGuest(); else { applyUser(null); showLogin(); }
      // 화면 권한은 매번 새로 읽는다. Guest가 닫혔으면 로그인 화면으로
      const c = await R.loadConfig();
      if (R.isGuest() && c && !c.guest) { setGuest(false); applyUser(null); showLogin('Guest 보기가 닫혔습니다. 로그인하세요.'); }
      else if (!R.user) showLogin();
      return;
    }
    R.loadConfig();
    // 저장된 로그인으로 화면을 바로 연다. 서버 확인(whoami)은 뒤에서 하고, 로그인이 풀렸으면 그때 로그인 화면을 띄운다.
    R.session = s; applyUser(s.user); R.emit('login', R.user);
    try {
      const me = await request(C.API_URL + '?' + new URLSearchParams({ action: 'whoami', session: s.session }), { method: 'GET' }, C.TIMEOUT.get);
      if (!me.ok) { clearSession(); R.session = null; applyUser(null); showLogin(me.message); return; }
      const changed = R.roleOf(me.user.role) !== R.roleOf(s.user && s.user.role);
      s.user = me.user; s.role = me.user.role; saveSession(s); applyUser(me.user);
      if (changed) R.emit('login', R.user); // 권한이 바뀌었으면 탭을 다시 맞춘다
    } catch (e) {
      // 오프라인이면 저장된 로그인으로 계속 쓴다. 저장은 대기열에 쌓였다가 연결되면 올라간다.
      R.toast('서버 확인 실패 · 저장된 로그인으로 계속합니다', 'warn');
    }
  };

  /* ---------- 사진 ---------- */
  // 사진을 긴 변 maxSide로 줄여 JPEG dataURL로 만든다
  R.shrink = function (src, maxSide, quality) {
    return new Promise((resolve) => {
      const img = new Image(), url = typeof src === 'string' ? src : URL.createObjectURL(src);
      const done = (v) => { if (url !== src) URL.revokeObjectURL(url); resolve(v); }; // iOS: 안 풀면 12~48MP 원본이 계속 메모리에 남는다
      img.onload = () => {
        let c = null;
        try {
          const long = Math.max(img.width, img.height), scale = Math.min(1, maxSide / long);
          c = document.createElement('canvas'); c.width = Math.max(1, Math.round(img.width * scale)); c.height = Math.max(1, Math.round(img.height * scale));
          const ctx = c.getContext('2d'); if (!ctx) throw new Error('canvas'); // Safari 캔버스 메모리 한도를 넘으면 null
          ctx.imageSmoothingQuality = 'high'; ctx.drawImage(img, 0, 0, c.width, c.height);
          const out = c.toDataURL('image/jpeg', quality || 0.8); // 한도 초과 캔버스는 'data:,'
          done(out.length > 100 ? out : (typeof src === 'string' ? src : ''));
        } catch (e) { done(typeof src === 'string' ? src : ''); }
        finally { if (c) { c.width = 0; c.height = 0; } } // Safari는 GC 전까지 캔버스 메모리를 잡고 있으므로 바로 비운다
      };
      img.onerror = () => done(typeof src === 'string' ? src : '');
      img.src = url;
    });
  };

  // Drive 사진 URL → 화면에 띄울 dataURL (서버가 12장씩 보내준다)
  const photoCache = new Map();
  R.loadPhotos = async function (urls) {
    if (R.isGuest()) return {}; // Guest는 사진을 받지 않는다 (로그인 창이 뜨지 않게)
    const need = [...new Set(urls.filter(Boolean))].filter((u) => !photoCache.has(u));
    for (let i = 0; i < need.length; i += 12) {
      try {
        const r = await R.apiPost('photoDataBatch', { urls: need.slice(i, i + 12) }, 60000);
        Object.entries((r && r.items) || {}).forEach(([u, d]) => photoCache.set(u, d));
        Object.keys((r && r.errors) || {}).forEach((u) => photoCache.set(u, ''));
      } catch (e) { need.slice(i, i + 12).forEach((u) => photoCache.set(u, '')); }
    }
    const out = {}; urls.forEach((u) => { if (u) out[u] = photoCache.get(u) || ''; }); return out;
  };

  R.photoViewer = function (src, caption) {
    const ov = $('viewer'); if (!ov) return;
    $('viewerImg').src = src || ''; $('viewerCap').textContent = caption || ''; ov.hidden = false;
  };

  /* ---------- 글씨 크기 · 어두운 모드 ---------- */
  R.initPrefs = function () {
    const root = document.documentElement;
    const setFz = (n) => { root.style.fontSize = (100 + n * 12) + '%'; try { localStorage.setItem('r15fz', String(n)); } catch (_) {} };
    let fz = 0; try { fz = Number(localStorage.getItem('r15fz') || 0); } catch (_) {}
    setFz(fz);
    document.querySelectorAll('[data-fz]').forEach((b) => { b.onclick = () => { const v = Number(b.dataset.fz); fz = v === 0 ? 0 : Math.max(-1, Math.min(3, fz + v)); setFz(fz); }; });
    const th = $('thBtn');
    const setTh = (t) => { root.dataset.theme = t; th.textContent = t === 'dark' ? '밝은 모드' : '어두운 모드'; try { localStorage.setItem('r15th', t); } catch (_) {} };
    let t = 'light'; try { t = localStorage.getItem('r15th') || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'); } catch (_) {}
    setTh(t); th.onclick = () => setTh(root.dataset.theme === 'dark' ? 'light' : 'dark');
  };
})();
