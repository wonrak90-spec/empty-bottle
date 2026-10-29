/* R15 생산 투입 탭
 * 제조번호를 고르고(오늘 계획표에서 한 번 누름), 검수 끝난 가용 Pallet를 눌러 투입한다.
 * 라벨 사진이나 바코드로도 찾을 수 있다. 투입은 대기열로 보내므로 신호가 약해도 계속 진행된다.
 */
(function () {
  'use strict';
  const R = window.R15, { $, esc, fmt, digits } = R.util;
  const KEY = 'r15.lot';
  const L = R.lot = { lot: null, stock: [], lots: null, detail: null, sel: new Map(), filter: '' };

  function load() { try { L.lot = JSON.parse(localStorage.getItem(KEY) || 'null'); } catch (_) { L.lot = null; } boardLoad(); }
  function persist() { try { localStorage.setItem(KEY, JSON.stringify(L.lot)); } catch (_) {} }
  const pk = (inb, p) => digits(inb) + '|' + Number(digits(p));

  async function refresh() {
    if (L.board) return boardRefresh();
    if (!L.lot) { L.lots = await R.tryGet('r15Lots'); render(); return; }
    const [d, s, ls] = await Promise.all([R.tryGet('r15Lot', { id: L.lot.id }), R.tryGet('r15Stock'), L.lots ? null : R.tryGet('r15Lots')]);
    if (ls) L.lots = ls;
    if (d) { L.detail = d; if (d.lot.status !== '진행중') R.toast('이 작업은 종료되었습니다', 'warn'); }
    if (s) L.stock = s.groups || [];
    render();
  }

  function render() {
    const root = $('lotView'); if (!root) return;
    scanStop(); // 다시 그리면 영상 칸이 사라진다: 카메라를 꺼서 화면 밖에서 계속 찍히지 않게 한다
    if (L.board) { const vOld = $('bdVideo'); root.innerHTML = boardHtml(); bindBoard(); if (!$('bdVideo') && vOld) camStop(); return; }
    if (!L.lot) { const keep = ['lpName', 'lpLot'].map((id) => $(id) ? $(id).value : ''); root.innerHTML = pickHtml(); bindPick(); ['lpName', 'lpLot'].forEach((id, i) => { if (keep[i]) $(id).value = keep[i]; }); return; } // 목록이 늦게 와도 입력값 유지
    root.innerHTML = workHtml(); bindWork();
  }

  /* ---------- 작업 고르기 ---------- */
  function pickHtml() {
    const d = L.lots || { plan: [], lots: [], products: [] };
    const open = (d.lots || []).filter((x) => x.status === '진행중');
    return `<section>
      <div class="shead"><h2>오늘 제조 계획</h2><span class="sub">${d.plan && d.plan.length ? '눌러서 바로 시작' : '계획표가 없으면 아래에 직접 입력'}</span></div>
      <div class="chips">${(d.plan || []).map((p, i) => `<button type="button" class="chipbtn" data-plan="${i}"><b>${esc(p.productName)}</b> ${esc(p.lotNo)}<small>${esc(p.date.slice(5))}${p.line ? ' · ' + esc(p.line) : ''}</small></button>`).join('') || '<span class="muted">관리 탭에서 주간제조계획표 링크를 넣으면 여기에 나옵니다.</span>'}</div>
    </section>
    ${open.length ? `<section><div class="shead"><h2>진행 중인 작업</h2><span class="sub">다른 작업자와 같이 투입할 수 있습니다</span></div>
      <div class="list">${open.map((x, i) => `<div class="row"><button type="button" class="lnk" data-open="${i}"><b>${esc(x.productName)}</b> ${esc(x.lotNo)} <span class="muted">${x.palletCount} Pallet · ${esc(x.workers || '')}</span></button>${!x.palletCount || R.isManager() ? `<button type="button" class="btn ghost sm danger" data-del="${i}">삭제</button>` : ''}</div>`).join('')}</div></section>` : ''}
    <section><div class="shead"><h2>4개 라인 투입 보드</h2><span class="sub">PC 한 대 + 라인별 스캐너 (A~D 접두어)</span></div>
      <div><button type="button" class="btn ghost" id="bdOpen">투입 보드 열기</button></div></section>
    <section><div class="shead"><h2>직접 입력</h2></div>
      <div class="grid g2"><label>제품명<input id="lpName" list="lpNames" placeholder="예: 판콜에이"><datalist id="lpNames">${(d.products || []).map((p) => `<option value="${esc(p)}">`).join('')}</datalist></label>
      <label>제조번호<input id="lpLot" placeholder="예: 2F205" autocapitalize="characters"></label></div>
      <div><button type="button" class="btn" id="lpStart">작업 시작</button></div>
    </section>`;
  }
  function bindPick() {
    const d = L.lots || {};
    document.querySelectorAll('[data-plan]').forEach((b) => { b.onclick = () => { const p = d.plan[Number(b.dataset.plan)]; start(p.productName, p.lotNo, b); }; });
    document.querySelectorAll('[data-del]').forEach((b) => { b.onclick = () => { const p = d.lots.filter((x) => x.status === '진행중')[Number(b.dataset.del)]; deleteLot(p); }; });
    document.querySelectorAll('[data-open]').forEach((b) => { b.onclick = () => { const p = d.lots.filter((x) => x.status === '진행중')[Number(b.dataset.open)]; start(p.productName, p.lotNo, b); }; });
    $('bdOpen').onclick = () => { L.board = true; try { localStorage.setItem(BK + '.on', '1'); } catch (_) {} refresh(); };
    $('lpStart').onclick = () => start($('lpName').value.trim(), $('lpLot').value.trim().toUpperCase(), $('lpStart'));
  }
  async function start(productName, lotNo, btn) {
    if (!productName || !lotNo) return R.toast('제품명과 제조번호를 넣으세요', 'crit');
    R.busy(btn, true, '시작 중…');
    const r = await R.tryPost('r15LotStart', { productName, lotNo });
    R.busy(btn, false);
    if (!r || !r.ok) return;
    L.lot = { id: r.id, productName, lotNo }; L.sel.clear(); persist();
    R.toast(r.joined ? '진행 중인 작업에 참여했습니다' : '작업을 시작했습니다', 'ok');
    refresh();
  }

  /* ---------- 투입 작업 ---------- */
  function pendingItems() {
    return R.queue.list((j) => j.type === 'lot' && j.payload.productionId === L.lot.id && j.state !== 'done')
      .flatMap((j) => j.payload.items.map((it) => Object.assign({ state: j.state, error: j.lastError, jobId: j.id }, it)));
  }
  function workHtml() {
    const d = L.detail, pend = pendingItems(), pendKeys = new Set(pend.map((x) => pk(x.inboundNo, x.pallet)));
    const used = d ? d.pallets : [], usedKeys = new Set(used.map((x) => pk(x.inboundNo, x.pallet)));
    const items = [...new Set(L.stock.map((g) => g.product))];
    // 라인 설정에서 이 제품을 만드는 라인의 공병만 먼저 보여 준다 ('전체 품목'을 고르면 다 보임)
    const allowed = bottlesFor(L.lot.productName), useAllowed = allowed.length && L.filter === '';
    const groups = L.stock.filter((g) => (L.filter && L.filter !== '__all' ? g.product === L.filter : !useAllowed || allowed.includes(g.product)));
    const closed = d && d.lot.status !== '진행중';
    return `<section class="veh">
      <div class="shead"><div><div class="sub">제조번호</div><div class="big">${esc(L.lot.productName)} ${esc(L.lot.lotNo)}</div></div>
        <div class="right">${closed && !R.isManager() ? '' : '<button type="button" class="btn ghost sm danger" id="lotDel">작업 삭제</button> '}<button type="button" class="btn ghost sm" id="lotLeave">다른 작업</button></div></div>
      <div class="vline">투입 <b>${used.length}</b> Pallet · ${fmt(d ? d.total : 0)} EA${pend.length ? ` · <span class="pill p-warn"><i></i>단말 보관 ${pend.length}</span>` : ''}${closed ? ' · <span class="pill p-idle"><i></i>종료됨</span>' : ''}</div>
    </section>
    ${closed ? '' : `<section>
      <div class="shead"><h2>Pallet 찾기</h2></div>
      <div class="steps"><label class="shot"><input type="file" accept="image/*" capture="environment" id="lotShot" hidden><span class="ic">📷</span><span>WMS 라벨 촬영</span></label>
        ${'BarcodeDetector' in window ? '<button type="button" class="shot" id="lotScan"><span class="ic">▥</span><span>바코드 스캔</span></button>' : ''}</div>
      <div class="grid g3"><label>입고번호<input id="lfIn" inputmode="numeric"></label><label>Pallet<input id="lfP" inputmode="numeric"></label><div><button type="button" class="btn ghost" id="lfAdd">추가</button></div></div>
      <div class="grid g2"><label>바코드 스캐너<input id="lfScan" placeholder="여기를 누른 뒤 스캐너로 WMS 라벨을 찍으세요" autocomplete="off" autocapitalize="off" spellcheck="false"></label>
        <label class="chk"><input type="checkbox" id="lfAuto" ${scanAuto() ? 'checked' : ''}> 찍으면 바로 투입 (확인 없이)</label></div>
      <div class="sub" id="lotStatus"></div>
      <div id="scanBox" hidden><video id="scanVideo" playsinline muted></video><button type="button" class="btn ghost sm" id="scanStop">스캔 닫기</button></div>
    </section>
    <section>
      <div class="shead"><h2>가용 공병 (검수 완료 · 미투입)</h2>
        <select id="lotFilter" style="width:auto">${allowed.length ? `<option value="">이 제품 공병 (${esc(allowed.join(', '))})</option><option value="__all" ${L.filter === '__all' ? 'selected' : ''}>전체 품목</option>` : '<option value="">전체 품목</option>'}${items.map((p) => `<option ${p === L.filter ? 'selected' : ''}>${esc(p)}</option>`).join('')}</select></div>
      <div class="sub" style="margin-bottom:6px">업체 생산일이 오래된 차량부터 보입니다. <b>먼저</b> 표시를 먼저 쓰세요.</div>
      ${groups.length ? groups.map((g) => `<div class="sg"><div class="sgh"><b>${esc(g.inboundNo)}</b> ${esc(g.product)} ${firstOf(g) ? R.pill('ok', '먼저') : ''} <span class="muted">${esc(g.supplier || '')} · 입고 ${esc(g.inboundDate || '')}${g.vMin ? ` · 업체 생산 ${esc(g.vMin.slice(5))}${g.vMax && g.vMax !== g.vMin ? '~' + esc(g.vMax.slice(5)) : ''}` : ''} · ${g.palletCount} Pallet</span>
          <button type="button" class="btn ghost sm" data-all="${esc(g.inboundNo)}">모두</button></div>
        <div class="pcs">${g.pallets.map((p) => { const k = pk(g.inboundNo, p.pallet), on = L.sel.has(k), dis = usedKeys.has(k) || pendKeys.has(k);
          return `<button type="button" class="pc ${on ? 'sel' : ''} ${p.level === 'error' ? 'err' : p.level === 'warn' ? 'wrn' : ''}" data-k="${k}" ${dis ? 'disabled' : ''} title="${esc(p.finalResult)}">${p.pallet}</button>`; }).join('')}</div></div>`).join('')
        : '<div class="muted">가용 Pallet가 없습니다.</div>'}
      <div class="sub">빨간 테두리는 검수 기록에 확인할 점이 있는 Pallet입니다.</div>
    </section>`}
    <section>
      <div class="shead"><h2>투입 내역</h2></div>
      <div class="list">${pend.map((x) => `<div class="row"><span><b>${esc(x.inboundNo)}</b> P${esc(x.pallet)}</span><span>${R.pill(x.state === 'blocked' ? 'error' : 'warn', x.state === 'blocked' ? '확인 필요' : '단말 보관')} ${x.state === 'blocked' ? `<button type="button" class="btn ghost sm" data-job="${esc(x.jobId)}">처리</button>` : ''}</span></div>`).join('')}
        ${used.slice().reverse().map((x) => `<div class="row"><span><b>${esc(x.inboundNo)}</b> P${esc(x.pallet)} <span class="muted">${esc(x.product || '')} · ${fmt(x.qty)}</span></span>
          <span>${x.unverified ? R.pill('error', '미검수 투입') : R.pill('ok', '서버 완료')} <span class="muted">${esc((x.at || '').slice(11))}</span> ${closed && !R.isManager() ? '' : `<button type="button" class="btn ghost sm" data-rm="${esc(x.inboundNo)}|${esc(x.pallet)}" aria-label="투입 취소">취소</button>`}</span></div>`).join('') || (pend.length ? '' : '<div class="muted">아직 투입한 Pallet가 없습니다.</div>')}</div>
    </section>
    ${closed ? '' : `<div class="savebar"><button type="button" class="btn" id="lotAdd" ${L.sel.size ? '' : 'disabled'}>선택 ${L.sel.size}개 투입</button><button type="button" class="btn ghost sm" id="lotFinish">작업 종료</button></div>`}`;
  }

  function bindWork() {
    $('lotLeave').onclick = () => { L.lot = null; L.detail = null; L.sel.clear(); persist(); refresh(); };
    if ($('lotDel')) $('lotDel').onclick = () => deleteLot();
    document.querySelectorAll('[data-rm]').forEach((b) => { b.onclick = () => removePallet(b.dataset.rm); });
    document.querySelectorAll('[data-job]').forEach((b) => { b.onclick = () => { const j = R.queue.jobs.find((x) => x.id === b.dataset.job); if (j) R.showJob(j); }; });
    if (!$('lotAdd')) return;
    $('lotFilter').onchange = (e) => { L.filter = e.target.value; render(); };
    document.querySelectorAll('[data-k]').forEach((b) => { b.onclick = () => toggle(b.dataset.k); });
    document.querySelectorAll('[data-all]').forEach((b) => { b.onclick = () => { const g = L.stock.find((x) => x.inboundNo === b.dataset.all); g.pallets.forEach((p) => { const k = pk(g.inboundNo, p.pallet); const el = document.querySelector(`[data-k="${k}"]`); if (el && !el.disabled) L.sel.set(k, { inboundNo: g.inboundNo, pallet: p.pallet }); }); render(); }; });
    $('lotAdd').onclick = submit;
    $('lotFinish').onclick = finish;
    $('lfAdd').onclick = () => findPallet(digits($('lfIn').value), digits($('lfP').value));
    $('lotShot').onchange = shot;
    if ($('lotScan')) { $('lotScan').onclick = scanStart; $('scanStop').onclick = scanStop; }
    bindScanner();
  }

  /* ---------- 바코드 스캐너 (키보드처럼 글자를 치고 Enter를 보내는 USB·블루투스 스캐너) ---------- */
  const SA = 'r15.lotScanAuto';
  function scanAuto() { try { return localStorage.getItem(SA) !== '0'; } catch (_) { return true; } }
  let scanFocus = false, scanBusy = Promise.resolve();
  function beep(ok) {
    try { const a = beep.ctx = beep.ctx || new (window.AudioContext || window.webkitAudioContext)(), o = a.createOscillator(), g = a.createGain();
      o.frequency.value = ok ? 1200 : 300; g.gain.value = 0.15; o.connect(g); g.connect(a.destination); o.start(); o.stop(a.currentTime + (ok ? 0.12 : 0.4)); } catch (_) {}
  }
  function bindScanner() {
    const inp = $('lfScan'); if (!inp) return;
    $('lfAuto').onchange = (e) => { try { localStorage.setItem(SA, e.target.checked ? '1' : '0'); } catch (_) {} inp.focus(); };
    inp.onfocus = () => { scanFocus = true; }; inp.onblur = () => { setTimeout(() => { if (document.activeElement !== $('lfScan')) scanFocus = false; }, 0); };
    let t = 0; const go = () => { clearTimeout(t); const v = inp.value; inp.value = ''; if (v.trim()) scanBusy = scanBusy.then(() => onScanner(v)).catch(() => {}); };
    inp.onkeydown = (e) => { if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); go(); } };
    // Enter를 안 보내는 스캐너: 글자가 멈추고 0.3초 지나면 받는다
    inp.oninput = () => { clearTimeout(t); t = setTimeout(go, 300); };
    if (scanFocus) inp.focus();
  }
  async function onScanner(raw) {
    const st = $('lotStatus'), c = parseLabelCode(raw);
    if (!c || c.partial) { if (st) st.textContent = `"${String(raw).trim().slice(0, 20)}"는 WMS 라벨 바코드가 아닙니다 (입고번호 8자리 + Pallet 4자리)`; beep(false); return; }
    const k = pk(c.inboundNo, c.pallet), had = L.sel.has(k);
    await findPallet(c.inboundNo, c.pallet, 'scan');
    if (!L.sel.has(k) || had) { beep(false); return; }
    beep(true);
    if (scanAuto() && $('lotAdd')) await submit(true);
  }
  R.lot.onScanner = onScanner;

  /* ---------- 4개 라인 투입 보드 ----------
   * PC 한 대에 스캐너 4개(무선 동글 또는 USB). 브라우저는 어느 스캐너인지 모르므로 스캐너마다 앞에 라인 글자를 붙이게 설정한다:
   * A260047330030 → A 라인 작업에 투입. 사람이 보지 않는 자리라 확인 창 없이 판단하고, 넣지 못한 것은 소리와 빨간 줄로 알린다.
   */
  const BK = 'r15.board', LINES = ['A', 'B', 'C', 'D'];
  const B = L.bd = { slots: {}, log: [], detail: {}, wake: null, pick: {}, change: '', cam: '' };
  function boardLoad() {
    try { L.board = localStorage.getItem(BK + '.on') === '1'; B.slots = JSON.parse(localStorage.getItem(BK) || '{}') || {}; B.voice = localStorage.getItem(BK + '.voice') !== '0'; B.cam = localStorage.getItem(BK + '.cam') || ''; } catch (_) { L.board = false; B.slots = {}; }
  }
  function boardSave() { try { localStorage.setItem(BK, JSON.stringify(B.slots)); } catch (_) {} }
  async function boardRefresh() {
    const ids = LINES.map((k) => B.slots[k] && B.slots[k].id).filter(Boolean);
    const [lots, s, ...ds] = await Promise.all([R.tryGet('r15Lots'), R.tryGet('r15Stock'), ...ids.map((id) => R.tryGet('r15Lot', { id }))]);
    if (lots) L.lots = lots; if (s) L.stock = s.groups || [];
    ds.forEach((d, i) => { if (d) B.detail[ids[i]] = d; });
    LINES.forEach((k) => { const x = B.slots[k], d = x && B.detail[x.id], p = d && d.pallets.find((y) => y.product); if (x && !x.bottle && p) { x.bottle = p.product; boardSave(); } });
    LINES.forEach((k) => { const x = B.slots[k], d = x && B.detail[x.id]; if (d && d.lot.status !== '진행중') { delete B.slots[k]; boardSave(); } });
    const a = document.activeElement;
    if (!(a && /^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName) && a.id !== 'bdScan')) render();
    wakeOn(); evRefresh();
    // 다른 폰에서 검수·투입한 것을 반영하려고 2분마다 다시 받는다 (보드가 열려 있을 때만)
    clearTimeout(B.timer); B.timer = setTimeout(() => { if (L.board && $('bdScan')) boardRefresh(); }, 120000);
  }
  async function evRefresh() {
    const r = await R.tryGet('r15Live'); if (!r || !r.ok) return;
    B.events = r.events || []; if (r.lines && L.lots) L.lots.lines = r.lines;
    // 서버가 받지 않은 투입(대기열 '확인 필요')도 오류로 남긴다 (한 번만)
    B.repJobs = B.repJobs || {};
    LINES.forEach((k) => { const x = B.slots[k]; if (!x) return; R.queue.list((j) => j.type === 'lot' && j.payload.productionId === x.id && j.state === 'blocked').forEach((j) => {
      if (B.repJobs[j.id]) return; B.repJobs[j.id] = 1; R.tryPost('r15LineEvent', { line: k, code: 'server', text: `${j.payload.items.map((it) => it.inboundNo + ' P' + it.pallet).join(', ')} 서버가 받지 않음 · ${j.lastError || ''}`.slice(0, 150), lotNo: x.lotNo }).catch(() => {}); }); });
    const el = $('bdErr'); if (el && L.board) { el.innerHTML = R.lines.eventsHtml(B.events, true); R.lines.bindAck(el, B.events, () => render()); }
  }
  setInterval(() => { if (!L.board || !$('bdScan') || document.hidden) return; evRefresh();
    const open = R.lines.open(B.events); if (open.length) { beep(false); const ls = [...new Set(open.map((e) => e.line || ''))].filter(Boolean); say(`${ls.join(', ')} 라인 확인 필요 ${open.length}건`); } }, 60000);
  // 화면이 꺼지면 스캐너 입력을 못 받는다: 보드를 여는 동안 화면 꺼짐을 막는다 (지원하는 브라우저만)
  async function wakeOn() { try { if (L.board && 'wakeLock' in navigator && !B.wake && document.visibilityState === 'visible') { B.wake = await navigator.wakeLock.request('screen'); B.wake.addEventListener('release', () => { B.wake = null; }); } } catch (_) {} }
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') wakeOn(); });
  function bottlesFor(productName) {
    const ls = (L.lots && L.lots.lines) || {}; return [...new Set(Object.values(ls).filter((c) => (c.products || []).includes(productName)).flatMap((c) => c.bottles || []))];
  }
  const lineOf = (p) => String(p && p.line || '').trim().charAt(0).toUpperCase();
  const lineCfg = (k) => ((L.lots && L.lots.lines) || {})[k] || { products: [], bottles: [] };
  // 이 라인에서 고를 제품: 라인 설정 + 오늘 계획에서 이 라인에 잡힌 제품 (중복 없이)
  function lineProducts(k) {
    const plan = ((L.lots && L.lots.plan) || []).filter((p) => lineOf(p) === k).map((p) => p.productName);
    return [...new Set(lineCfg(k).products.concat(plan))].filter(Boolean);
  }
  function lanes() {
    const now = Date.now();
    return LINES.map((k) => {
      const x = B.slots[k], d = x && B.detail[x.id], logs = B.log.filter((l) => l.line === k), last = logs[0];
      const lastAt = Math.max(last && last.ok ? last.t : 0, d && d.pallets.length ? Date.parse(String(d.pallets[d.pallets.length - 1].at || '').replace(' ', 'T')) || 0 : 0);
      const errs = R.lines.open(B.events).filter((e) => e.line === k).length;
      const bad = errs || (last && !last.ok && now - last.t < 60000), st = bad ? 'bad' : LN().state(lastAt, now, !!x), m = LN().ago(lastAt, now);
      const today = logs.filter((l) => l.ok).length;
      return { line: k, state: st, title: x ? `${x.productName} ${x.lotNo}` : '작업 없음', device: B.cam === k ? '이 기기 카메라' : '스캐너·카메라',
        sub: x ? `투입 ${(d ? d.pallets.length : 0) + pendOf(x)} Pallet${today ? ` · 이 화면에서 ${today}` : ''}` : '눌러서 제품 고르기',
        note: errs ? `오류 ${errs}건 · 확인 필요` : bad ? '확인 필요' : !x ? '작업 없음' : m == null ? '투입 대기' : m <= 10 ? '투입 중' : `${m}분째 대기` };
    });
  }
  const LN = () => R.lines;
  const pendOf = (x) => R.queue.list((j) => j.type === 'lot' && j.payload.productionId === x.id && j.state !== 'done').reduce((a, j) => a + j.payload.items.length, 0);
  function startForm(k) {
    const prods = lineProducts(k), plan = ((L.lots && L.lots.plan) || []).filter((p) => lineOf(p) === k || !lineOf(p));
    const sel = B.pick[k] || prods[0] || '';
    const lots = plan.filter((p) => !sel || p.productName === sel).map((p) => p.lotNo);
    return `<div class="grid g2"><label>제품<select id="bdN${k}">${prods.map((p) => `<option ${p === sel ? 'selected' : ''}>${esc(p)}</option>`).join('')}<option value="__new">+ 다른 제품 직접 입력</option></select></label>
        <label>제조번호<input id="bdL${k}" list="bdLots${k}" autocapitalize="characters" placeholder="예: 2F205" value="${esc(lots.length === 1 ? lots[0] : '')}"><datalist id="bdLots${k}">${lots.map((l) => `<option value="${esc(l)}">`).join('')}</datalist></label></div>
      <label id="bdNewW${k}" ${prods.length ? 'hidden' : ''}>새 제품 이름<input id="bdNew${k}" list="lpNames" placeholder="예: 판콜에이"></label>
      <div><button type="button" class="btn" data-bdstart="${k}">${k} 라인 시작</button></div>`;
  }
  function card(k) {
    const x = B.slots[k], d = x && B.detail[x.id], logs = B.log.filter((l) => l.line === k).slice(0, 4), cfg = lineCfg(k);
    const blk = x ? R.queue.list((j) => j.type === 'lot' && j.payload.productionId === x.id && j.state === 'blocked') : [];
    if (!x || B.change === k) {
      return `<section class="bd" id="bdCard${k}"><div class="shead"><h2>${k} 라인</h2>${x ? '<button type="button" class="btn ghost sm" data-bdcancel="1">취소</button>' : '<span class="sub">작업 없음</span>'}</div>${startForm(k)}</section>`;
    }
    const last = logs[0], hot = last && Date.now() - last.t < 6000 ? (last.ok ? ' bdok' : ' bdno') : '';
    return `<section class="bd${hot}" id="bdCard${k}">${hot ? `<div class="bdbig">${last.ok ? '✓ 투입됨' : '✗ 안 넣음'}</div>` : ''}<div class="shead"><h2>${k} 라인</h2><button type="button" class="btn ghost sm" data-bdchange="${k}">제품 바꾸기</button></div>
      <div class="big">${esc(x.productName)} ${esc(x.lotNo)}</div>
      <div class="vline">투입 <b>${(d ? d.pallets.length : 0) + pendOf(x)}</b> Pallet${pendOf(x) ? ` · <span class="pill p-warn"><i></i>보내는 중 ${pendOf(x)}</span>` : ''} · <span class="muted">${esc(cfg.bottles.length ? cfg.bottles.join(', ') : x.bottle || '공병 품목: 첫 Pallet 기준')}</span></div>
      ${blk.map((j) => `<button type="button" class="btn sm danger" data-bdjob="${esc(j.id)}">서버가 받지 않음 ${j.payload.items.map((it) => it.inboundNo + ' P' + it.pallet).join(', ')} · 눌러서 확인</button>`).join('')}
      <div class="list">${logs.map((l) => `<div class="row ${l.ok ? '' : 'bdbad'}"><span>${esc(l.at)} ${esc(l.text)}</span></div>`).join('') || '<span class="muted">스캔 대기 중</span>'}</div></section>`;
  }
  // 라인 설정: 라인마다 만드는 제품과 쓰는 공병 품목 (중간관리자 이상). 공병은 지금 가용 재고에 있는 품목에서 고른다
  function cfgHtml() {
    const items = [...new Set(L.stock.map((g) => g.product).concat(...LINES.map((k) => lineCfg(k).bottles)))].filter(Boolean).sort();
    return `<section id="bdCfg"><div class="shead"><h2>라인 설정</h2><span class="sub">라인마다 만드는 제품과 쓰는 공병을 정하면 제품 고르기가 짧아지고, 다른 공병은 넣지 않습니다</span></div>
      ${LINES.map((k) => { const c = lineCfg(k); return `<div class="bdcfg"><h3>${k} 라인</h3>
        <label>제품 (쉼표로 구분)<input id="cfP${k}" value="${esc(c.products.join(', '))}" placeholder="예: 판콜에이, 판콜에스"></label>
        <div class="sub">쓰는 공병 (비우면 첫 Pallet 품목 기준)</div><div class="chks">${items.map((b) => `<label class="chk"><input type="checkbox" data-cfb="${k}" value="${esc(b)}" ${c.bottles.includes(b) ? 'checked' : ''}> ${esc(b)}</label>`).join('') || '<span class="muted">가용 재고가 없습니다</span>'}</div></div>`; }).join('')}
      <div class="savebar"><button type="button" class="btn" id="cfSave">라인 설정 저장</button> <button type="button" class="btn ghost sm" id="cfClose">닫기</button></div></section>`;
  }
  function boardHtml() {
    const last = B.log[0], camOnly = B.cam && LINES.includes(B.cam);
    return `<section><div class="shead"><h2>${camOnly ? `${B.cam} 라인 카메라` : '라인 투입 보드'}</h2><span class="bdtools">
        <button type="button" class="btn ghost sm" id="bdVoice">${B.voice ? '🔊 음성' : '🔇 음성 꺼짐'}</button>
        <button type="button" class="btn ghost sm" id="bdCam">${camOnly ? '카메라 끄기' : '📷 카메라'}</button>
        ${R.isManager() && !camOnly ? '<button type="button" class="btn ghost sm" id="bdCfgBtn">⚙ 설정</button>' : ''}
        <button type="button" class="btn ghost sm" id="bdFull" aria-label="전체 화면">⛶</button> <button type="button" class="btn ghost sm" id="bdClose">닫기</button></span></div>
      <div class="bdlast ${last ? (last.ok ? 'ok' : 'bad') : ''}" id="bdLast">${last ? `${esc(last.line || '?')} 라인 · ${esc(last.text)}` : camOnly ? 'WMS 라벨 바코드를 카메라에 비추면 바로 투입됩니다' : '스캐너로 WMS 라벨을 찍으면 여기에 결과가 나옵니다'}</div>
      <input id="bdScan" class="bdscan" autocomplete="off" autocapitalize="off" spellcheck="false" aria-label="스캐너 입력">
      ${camOnly ? `<div class="bdcam"><video id="bdVideo" playsinline muted autoplay></video><div class="sub" id="bdCamMsg">카메라 켜는 중…</div></div>`
        : B.pickCam ? `<div class="sub">이 기기를 어느 라인 카메라로 쓸까요?</div><div class="chips">${LINES.map((k) => `<button type="button" class="chipbtn" data-cam="${k}"><b>${k} 라인</b></button>`).join('')}</div>`
        : `<details class="sub"><summary>사용 방법</summary>스캐너마다 앞에 라인 글자(A~D)를 붙이게 설정합니다 (예: A260047330030). 라인마다 제품·제조번호를 시작해 두면 찍는 대로 투입됩니다. 넣지 못한 Pallet는 빨간 목록에 남고 '확인'을 누를 때까지 1분마다 다시 알립니다. 라인 그림을 누르면 그 라인 칸으로 갑니다.</details>`}</section>
      <div id="bdErr">${R.lines.eventsHtml(B.events, true)}</div>
      ${B.cfgOpen && !camOnly ? cfgHtml() : ''}
      ${camOnly ? '' : `<section>${R.lines.svg(lanes())}</section>`}
      <datalist id="lpNames">${((L.lots && L.lots.products) || []).map((p) => `<option value="${esc(p)}">`).join('')}</datalist>
      <div class="bdgrid">${(camOnly ? [B.cam] : LINES).map(card).join('')}</div>`;
  }
  function bindBoard() {
    $('bdClose').onclick = () => { camStop(); B.cam = ''; L.board = false; try { localStorage.setItem(BK + '.on', '0'); localStorage.setItem(BK + '.cam', ''); } catch (_) {} if (B.wake) B.wake.release().catch(() => {}); refresh(); };
    document.querySelectorAll('[id^="bdN"]').forEach((s) => { if (s.tagName !== 'SELECT') return; s.onchange = () => { const k = s.id.slice(3); if (s.value === '__new') { $('bdNewW' + k).hidden = false; $('bdNew' + k).focus(); return; } B.pick[k] = s.value; render(); }; });
    document.querySelectorAll('[data-bdstart]').forEach((b) => { b.onclick = () => { const k = b.dataset.bdstart, sv = $('bdN' + k).value, nw = $('bdNew' + k).value.trim();
      const name = sv === '__new' || !sv ? nw : sv; boardStart(k, name, $('bdL' + k).value.trim().toUpperCase(), b, sv === '__new' || !sv); }; });
    document.querySelectorAll('[data-bdchange]').forEach((b) => { b.onclick = () => { B.change = b.dataset.bdchange; render(); }; });
    document.querySelectorAll('[data-bdcancel]').forEach((b) => { b.onclick = () => { B.change = ''; render(); }; });
    document.querySelectorAll('.lnsvg .lane').forEach((g) => { const go = () => { const c = $('bdCard' + g.dataset.line); if (c) c.scrollIntoView({ behavior: 'smooth', block: 'start' }); }; g.onclick = go; g.onkeydown = (e) => { if (e.key === 'Enter') go(); }; });
    const inp = $('bdScan'); inp.oninput = () => { inp.value = ''; };
    const a = document.activeElement; if (!a || a === document.body) inp.focus();
    $('bdVoice').onclick = () => { B.voice = !B.voice; try { localStorage.setItem(BK + '.voice', B.voice ? '1' : '0'); } catch (_) {} render(); };
    $('bdFull').onclick = () => { const d = document.documentElement; if (document.fullscreenElement) document.exitFullscreen().catch(() => {}); else if (d.requestFullscreen) d.requestFullscreen().catch(() => {}); };
    $('bdCam').onclick = () => { if (B.cam) { camStop(); B.cam = ''; try { localStorage.setItem(BK + '.cam', ''); } catch (_) {} } else B.pickCam = !B.pickCam; render(); };
    document.querySelectorAll('[data-cam]').forEach((b) => { b.onclick = () => { B.cam = b.dataset.cam; B.pickCam = false; try { localStorage.setItem(BK + '.cam', B.cam); } catch (_) {} render(); }; });
    if ($('bdCfgBtn')) $('bdCfgBtn').onclick = () => { B.cfgOpen = !B.cfgOpen; render(); };
    if ($('cfClose')) $('cfClose').onclick = () => { B.cfgOpen = false; render(); };
    if ($('cfSave')) $('cfSave').onclick = cfgSave;
    document.querySelectorAll('[data-bdjob]').forEach((b) => { b.onclick = () => { const j = R.queue.jobs.find((x) => x.id === b.dataset.bdjob); if (j) R.showJob(j); }; });
    R.lines.bindAck($('bdErr'), B.events || [], () => render());
    if ($('bdVideo')) camStart();
  }
  async function cfgSave() {
    const lines = {}; LINES.forEach((k) => { lines[k] = { products: $('cfP' + k).value.split(/[,，]/).map((v) => v.trim()).filter(Boolean), bottles: [...document.querySelectorAll(`[data-cfb="${k}"]:checked`)].map((c) => c.value) }; });
    const r = await R.tryPost('r15LinesSave', { lines }); if (!r || !r.ok) return;
    if (L.lots) L.lots.lines = r.lines; B.cfgOpen = false; R.toast('라인 설정 저장', 'ok'); render();
  }

  /* 태블릿·폰 카메라로 라인 투입: 카메라를 켜 둔 채 WMS 라벨 바코드를 찾는다. 같은 값이 연달아 2번 읽혀야 받는다 (반쯤 읽힌 값 방지) */
  let camStream = null, camRun = 0, camDet = null, camZx = null;
  function camStop() { camRun++; if (camStream) { camStream.getTracks().forEach((t) => t.stop()); camStream = null; } }
  async function camStart() {
    const v = $('bdVideo'), msg = $('bdCamMsg'), run = ++camRun; if (!v) return;
    try {
      if (!camStream) camStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment', width: { ideal: 1920 }, height: { ideal: 1080 } }, audio: false });
      if (run !== camRun) return; v.srcObject = camStream; await v.play().catch(() => {});
    } catch (e) { if (msg) msg.textContent = '카메라를 켜지 못했습니다: 카메라 권한을 허용해 주세요'; return; }
    if ('BarcodeDetector' in window) { try { camDet = camDet || new BarcodeDetector({ formats: ['code_39', 'code_128'] }); } catch (_) { camDet = null; } }
    if (msg) msg.textContent = camDet ? '바코드 찾는 중' : '바코드 찾는 중 (이 기기는 조금 느립니다)';
    const cv = document.createElement('canvas'); let prev = '', same = 0;
    while (run === camRun && document.body.contains(v)) {
      await new Promise((r) => setTimeout(r, camDet ? 250 : 500));
      if (document.hidden || !v.videoWidth) continue;
      let raw = '';
      try {
        if (camDet) { const r = await camDet.detect(v); raw = r.length ? r[0].rawValue : ''; }
        else {
          camZx = camZx || import('https://cdn.jsdelivr.net/npm/zxing-wasm@2.1.2/dist/es/reader/index.js').then((m) => { m.prepareZXingModule({ overrides: { locateFile: (f, p) => (f.endsWith('.wasm') ? 'https://cdn.jsdelivr.net/npm/zxing-wasm@2.1.2/dist/reader/' + f : p + f) } }); return m; });
          const Z = await camZx, w = Math.min(1280, v.videoWidth), h = Math.round(v.videoHeight * w / v.videoWidth); cv.width = w; cv.height = h;
          const g = cv.getContext('2d', { willReadFrequently: true }); g.drawImage(v, 0, 0, w, h);
          const r = await Z.readBarcodes(g.getImageData(0, 0, w, h), { formats: ['Code39', 'Code128'], tryHarder: true, maxNumberOfSymbols: 1 }); raw = r.length ? r[0].text : '';
        }
      } catch (_) { raw = ''; }
      const c = raw && parseLabelCode(raw);
      if (!c || c.partial) { prev = ''; same = 0; continue; }
      const code = c.inboundNo + String(c.pallet).padStart(4, '0');
      same = code === prev ? same + 1 : 1; prev = code;
      if (same === 2 && run === camRun) await onBoardScan(B.cam + code);
    }
  }
  async function boardStart(k, productName, lotNo, btn, isNew) {
    if (!productName || !lotNo) return R.toast('제품과 제조번호를 넣으세요', 'crit');
    R.busy(btn, true, '시작 중…'); const r = await R.tryPost('r15LotStart', { productName, lotNo, line: k }); R.busy(btn, false);
    if (!r || !r.ok) return;
    B.slots[k] = { id: r.id, productName, lotNo }; B.change = ''; boardSave();
    // 새로 입력한 제품은 그 라인 제품 목록에 더해 둔다 (중간관리자 이상만 저장됨)
    if (isNew && R.isManager()) { const lines = Object.assign({}, (L.lots && L.lots.lines) || {}); lines[k] = Object.assign({ products: [], bottles: [] }, lines[k]); if (!lines[k].products.includes(productName)) { lines[k] = Object.assign({}, lines[k], { products: lines[k].products.concat(productName) }); const rr = await R.tryPost('r15LinesSave', { lines }); if (rr && rr.ok && L.lots) L.lots.lines = rr.lines; } }
    boardRefresh();
  }
  // 라인 앞에 서 있는 사람이 화면을 안 봐도 알 수 있게 짧게 말해 준다 (PC 스피커)
  function say(t) { try { if (!B.voice || !window.speechSynthesis) return; speechSynthesis.cancel(); const u = new SpeechSynthesisUtterance(t); u.lang = 'ko-KR'; u.rate = 1.1; speechSynthesis.speak(u); } catch (_) {} }
  // 넣지 못한 것 중 사람이 손봐야 하는 것(code 있음)은 서버에 남겨 현황·다른 폰에서도 보이고, 확인할 때까지 보드가 1분마다 다시 알린다
  function boardLog(line, ok, text, code) {
    if (code) { const lot = B.slots[line]; B.events = (B.events || []).concat({ id: 'local' + Date.now(), at: Date.now(), line, code, text, n: 1, ack: null, local: true });
      R.tryPost('r15LineEvent', { line, code, text, lotNo: lot ? lot.lotNo : '' }).then(() => evRefresh()).catch(() => {}); }
    const typing = document.activeElement && /^(INPUT|SELECT|TEXTAREA)$/.test(document.activeElement.tagName) && document.activeElement.id !== 'bdScan';
    if (B.cur) { B.recent[B.cur] = { t: Date.now(), ok }; B.cur = ''; }
    Object.keys(B.recent || {}).forEach((c) => { if (Date.now() - B.recent[c].t > 90000) delete B.recent[c]; });
    say((line ? line + ' 라인 ' : '') + (ok ? '투입' : '확인 필요'));
    B.log.unshift({ line, ok, text, t: Date.now(), at: new Date().toTimeString().slice(0, 8) });
    clearTimeout(B.cool); B.cool = setTimeout(() => { if (L.board && $('bdScan')) render(); }, 6100); B.log = B.log.slice(0, 60);
    beep(ok);
    if (typing) { const el = $('bdLast'); if (el) { el.className = 'bdlast ' + (ok ? 'ok' : 'bad'); el.textContent = `${line || '?'} 라인 · ${text}`; } } else render();
  }
  const JAMO = { 'ㅁ': 'A', 'ㅠ': 'B', 'ㅊ': 'C', 'ㅇ': 'D' };
  async function onBoardScan(raw) {
    let s = String(raw || '').trim(); if (JAMO[s.charAt(0)]) s = JAMO[s.charAt(0)] + s.slice(1);
    // 거치대 스캐너는 라벨이 앞에 있는 동안 같은 바코드를 계속 읽는다: 넣은 값은 90초, 거부한 값은 10초 안에 다시 오면 소리 없이 넘긴다
    // (거부 뒤 작업을 시작하거나 고친 다음 다시 찍으면 받도록 거부는 짧게)
    const now = Date.now(), cu = s.toUpperCase(); B.recent = B.recent || {};
    const prev = B.recent[cu];
    if (prev && now - prev.t < (prev.ok ? 90000 : 10000)) { const el = $('bdLast'); if (el && !/다시 읽힘/.test(el.textContent)) el.textContent += ' (같은 라벨 다시 읽힘 · 무시)'; return; }
    B.cur = cu;
    const m = s.match(/^([A-Da-d])[\s:\-_]?(.+)$/);
    let k = m ? m[1].toUpperCase() : '';
    const code = m ? m[2] : s;
    if (!k) { const on = LINES.filter((x) => B.slots[x]); if (on.length === 1) k = on[0]; else return boardLog('', false, `라인 글자 없는 입력 "${s.slice(0, 16)}" · 스캐너 접두어 설정 확인`, 'noprefix'); }
    const x = B.slots[k]; if (!x) return boardLog(k, false, `${code.slice(0, 14)} · 이 라인에 시작한 작업이 없습니다`, 'nolot');
    const c = parseLabelCode(code); if (!c || c.partial) return boardLog(k, false, `WMS 라벨 바코드가 아님 "${code.slice(0, 16)}"`);
    const name = `${c.inboundNo} P${c.pallet}`, key = pk(c.inboundNo, c.pallet);
    // 어느 라인이든 이미 넣었거나 보내는 중이면 다시 넣지 않는다
    const sent = R.queue.list((j) => j.type === 'lot' && j.state !== 'done').some((j) => j.payload.items.some((it) => pk(it.inboundNo, it.pallet) === key));
    const doneHere = Object.values(B.detail).some((d) => d && d.pallets.some((p) => pk(p.inboundNo, p.pallet) === key));
    if (sent || doneHere) return boardLog(k, false, `${name} 이미 투입함`);
    let inStock = L.stock.some((g) => g.inboundNo === c.inboundNo && g.pallets.some((p) => p.pallet === Number(c.pallet))), rInfo = null;
    if (!inStock) {
      const r = rInfo = await R.tryGet('r15Pallet', { inboundNo: c.inboundNo, pallet: c.pallet });
      if (!r) { B.cur = ''; return boardLog(k, false, `${name} 서버 확인 실패 · 다시 찍기`, 'net'); }
      if (r.usedIn && r.usedIn.length) return boardLog(k, false, `${name} 이미 ${r.usedIn[0].productName} ${r.usedIn[0].lotNo}에 투입됨`, 'used');
      if (!r.found) return boardLog(k, false, `${name} 검수 기록 없음 · 넣지 않음`, 'noinsp');
    }
    // 한 제조번호에는 한 가지 공병만 들어간다: 첫 Pallet의 품목과 다르면 넣지 않는다 (다른 라인 Pallet를 잘못 찍은 경우)
    const g = L.stock.find((y) => y.inboundNo === c.inboundNo), prod = (g && g.product) || (rInfo && rInfo.record && rInfo.record.product) || '';
    const allow = lineCfg(k).bottles;
    if (allow.length && prod && !allow.includes(prod)) return boardLog(k, false, `${name} 이 라인 공병 아님 (${prod})`, 'bottle');
    if (!allow.length && x.bottle && prod && prod !== x.bottle) return boardLog(k, false, `${name} 다른 공병 (${prod}) · 이 라인은 ${x.bottle}`, 'bottle');
    if (!x.bottle && prod) { x.bottle = prod; boardSave(); }
    const old = olderLeft([{ inboundNo: c.inboundNo, pallet: Number(c.pallet) }]);
    await R.queue.addLot(x.id, [{ inboundNo: c.inboundNo, pallet: Number(c.pallet) }], { label: `${x.lotNo} 1 Pallet` });
    L.stock.forEach((g) => { if (g.inboundNo === c.inboundNo) g.pallets = g.pallets.filter((p) => p.pallet !== Number(c.pallet)); });
    boardLog(k, true, `${name} → ${x.productName} ${x.lotNo}${old.length ? ` (더 오래된 ${old[0].inboundNo} 남음)` : ''}`);
  }
  R.lot.onBoardScan = onBoardScan;
  // 커서가 스캐너 칸 밖에 있어도 받는다: 다른 입력 칸이 아닌 곳에서 빠르게(글자 사이 80ms 이하) 들어온 숫자 + Enter
  // 글자는 e.code(자판 위치)로 받는다: PC 한글 입력 상태에서도 스캐너의 "A"가 "ㅁ"으로 바뀌지 않게
  const keyChar = (e) => { let m = /^Key([A-Z])$/.exec(e.code || ''); if (m) return m[1]; m = /^(?:Digit|Numpad)(\d)$/.exec(e.code || ''); if (m) return m[1];
    if (e.code === 'Minus' || e.code === 'NumpadSubtract') return '-'; return e.key && e.key.length === 1 && /[0-9A-Za-z\-]/.test(e.key) ? e.key : ''; };
  let kb = '', kbAt = 0;
  document.addEventListener('keydown', (e) => {
    const inp = $('lfScan') || $('bdScan'), a = document.activeElement, sink = a && a.id === 'bdScan';
    if (!inp || !inp.offsetParent || a === $('lfScan') || (!sink && a && /^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName))) { kb = ''; return; }
    const now = Date.now(); if (now - kbAt > 80) kb = ''; kbAt = now;
    if (e.key === 'Enter' || e.key === 'Tab') { const v = kb; kb = ''; if (v.length >= 10 || sink) { e.preventDefault(); if (v) scanBusy = scanBusy.then(() => (L.board ? onBoardScan(v) : onScanner(v))).catch(() => {}); } return; }
    const ch = keyChar(e); if (ch) { kb += ch; if (sink) e.preventDefault(); }
  });
  function toggle(k) {
    if (L.sel.has(k)) L.sel.delete(k); else { const [inboundNo, pallet] = k.split('|'); L.sel.set(k, { inboundNo, pallet: Number(pallet) }); }
    const el = document.querySelector(`[data-k="${k}"]`); if (el) el.classList.toggle('sel', L.sel.has(k));
    const b = $('lotAdd'); b.disabled = !L.sel.size; b.textContent = `선택 ${L.sel.size}개 투입`;
  }

  // 선입선출: 품목마다 업체 생산일(없으면 입고일)이 가장 이른 차량. 서버가 그 순서로 보낸다
  const ageOf = (g) => g.vMin || g.inboundDate || '';
  function firstOf(g) { const same = L.stock.filter((x) => x.product === g.product && x.pallets.length); return same.length > 1 && same[0] === g; }
  // 고른 Pallet보다 업체 생산일이 오래된 재고가 (고르지 않은 채) 남아 있으면 묻는다
  function olderLeft(items) {
    const keys = new Set(items.map((x) => pk(x.inboundNo, x.pallet))), out = [];
    const picked = L.stock.filter((g) => g.pallets.some((p) => keys.has(pk(g.inboundNo, p.pallet))));
    picked.forEach((g) => { L.stock.forEach((o) => { if (o !== g && o.product === g.product && ageOf(o) && ageOf(o) < ageOf(g) && o.pallets.some((p) => !keys.has(pk(o.inboundNo, p.pallet))) && !out.includes(o)) out.push(o); }); });
    return out;
  }
  async function submit(auto) {
    if (!L.sel.size) return;
    const items = [...L.sel.values()];
    const old = olderLeft(items);
    // 스캐너 자동 투입은 사람이 화면을 보지 않을 수 있어 확인 창 대신 알림만 띄운다
    if (old.length && auto) R.toast(`더 오래된 재고 ${old[0].inboundNo}가 남아 있습니다`, 'warn');
    else if (old.length && !confirm(`더 오래된 재고가 남아 있습니다:\n${old.slice(0, 3).map((g) => `${g.inboundNo} (업체 생산 ${(g.vMin || '').slice(5) || '?'} · 입고 ${g.inboundDate || '?'})`).join('\n')}\n\n그래도 지금 고른 Pallet를 투입할까요?`)) return;
    // 서버는 한 번에 60개까지 처리한다. '모두'를 여러 번 누르면 넘을 수 있으므로 나눠서 넣는다.
    for (let i = 0; i < items.length; i += 60) { const part = items.slice(i, i + 60); await R.queue.addLot(L.lot.id, part, { label: `${L.lot.lotNo} ${part.length} Pallet` }); }
    L.sel.clear(); R.toast(`${items.length} Pallet 투입 · 서버로 보내는 중`, 'ok'); render();
  }

  // 사진·바코드·직접 입력으로 찾은 Pallet를 선택에 넣는다
  async function findPallet(inboundNo, pallet, via) {
    const st = $('lotStatus');
    if (!inboundNo || !Number(pallet)) { st.textContent = '입고번호와 Pallet 번호가 필요합니다.'; return; }
    const k = pk(inboundNo, pallet);
    if ((L.detail && L.detail.pallets.some((x) => pk(x.inboundNo, x.pallet) === k)) || pendingItems().some((x) => pk(x.inboundNo, x.pallet) === k)) { st.textContent = `${inboundNo} P${Number(pallet)}는 이미 이 작업에 투입했습니다.`; return; }
    const inStock = L.stock.some((g) => g.inboundNo === inboundNo && g.pallets.some((p) => p.pallet === Number(pallet)));
    if (inStock) { if (!L.sel.has(k)) toggle(k); st.textContent = `${inboundNo} P${Number(pallet)} 선택됨 · 검수 기록 있음`; const el = document.querySelector(`[data-k="${k}"]`); if (el) el.scrollIntoView({ block: 'center', behavior: 'smooth' }); return; }
    st.textContent = '서버에서 확인 중…';
    const r = await R.tryGet('r15Pallet', { inboundNo, pallet });
    if (!r) { st.textContent = '확인 실패'; return; }
    if (r.usedIn && r.usedIn.length) { st.textContent = `${inboundNo} P${Number(pallet)}는 이미 ${r.usedIn[0].productName} ${r.usedIn[0].lotNo}에 투입되었습니다.`; R.toast(st.textContent, 'crit'); return; }
    if (!r.found) {
      // 바코드는 검사 숫자가 없어 한 자리가 잘못 읽혀도 값이 나온다. 모르는 입고번호면 한 번 눌러 넣지 않고 직접 확인하게 한다.
      if (via === 'scan' && !L.stock.some((g) => g.inboundNo === inboundNo)) {
        $('lfIn').value = inboundNo; $('lfP').value = Number(pallet);
        st.textContent = `${inboundNo} P${Number(pallet)}: 검수 기록이 없는 입고번호입니다. 라벨 글자와 같은지 확인하고 "추가"를 누르세요.`; return;
      }
      if (!confirm(`${inboundNo} P${Number(pallet)}는 검수 기록이 없습니다.\n"미검수 투입"으로 기록할까요?`)) { st.textContent = '취소했습니다.'; return; }
      L.sel.set(k, { inboundNo, pallet: Number(pallet) }); st.textContent = `${inboundNo} P${Number(pallet)} 미검수 투입으로 선택됨`;
      const b = $('lotAdd'); b.disabled = false; b.textContent = `선택 ${L.sel.size}개 투입`; return;
    }
    L.sel.set(k, { inboundNo, pallet: Number(pallet) }); st.textContent = `${inboundNo} P${Number(pallet)} 선택됨 (180일 이전 검수)`;
    const b = $('lotAdd'); b.disabled = false; b.textContent = `선택 ${L.sel.size}개 투입`;
  }

  async function shot(e) {
    const file = e.target.files && e.target.files[0]; e.target.value = ''; if (!file) return;
    const st = $('lotStatus'); st.textContent = '글자 읽는 중…';
    try {
      const img = await R.shrink(file, 2000, 0.85); if (!img) throw new Error('사진을 열지 못했습니다 · 다시 찍어 주세요');
      const r = await R.ocr.read(img, 'wms', st), p = r.parsed || {};
      const inb = digits(p.inboundNo), pal = digits(p.containerFrom);
      $('lfIn').value = inb; $('lfP').value = pal ? Number(pal) : '';
      if (inb && pal) findPallet(inb, pal); else st.textContent = '번호를 다 읽지 못했습니다. 입고번호·Pallet를 확인하고 추가를 누르세요.';
    } catch (err) { st.textContent = err.message; }
  }

  /* ---------- 바코드 (지원하는 폰만) ---------- */
  // WMS 라벨 바코드는 Code39 "입고번호 8자리 + Pallet 4자리"다 (예: 260047330030, 밑글자는 26004733-0030).
  // 앞자리가 빠진 값(6004733-0030)은 가용 재고에 끝자리가 맞는 입고번호가 하나뿐일 때만 받는다.
  // 품목 EAN-13·ITF 같은 다른 바코드와 일부만 읽힌 값은 버리고, 같은 값이 연속 2번 읽혀야 받는다.
  const SCAN_FORMATS = ['code_39', 'code_128', 'qr_code'];
  function parseLabelCode(raw, format) {
    if (format && SCAN_FORMATS.indexOf(format) < 0) return null;
    const s = String(raw == null ? '' : raw).replace(/^\][A-Za-z][0-9A-Za-z]/, '').replace(/[\s*\u0000-\u001f]/g, '');
    const m = s.match(/^(\d{6,8})-?(\d{4})$/); if (!m || !Number(m[2])) return null;
    let inb = m[1];
    if (inb.length < 8) {
      const hit = [...new Set(L.stock.map((g) => digits(g.inboundNo)))].filter((x) => x.length === 8 && x.endsWith(inb));
      if (hit.length !== 1) return { partial: m[1] + '-' + m[2] };
      inb = hit[0];
    }
    return { inboundNo: inb, pallet: String(Number(m[2])) };
  }
  R.lot.parseLabelCode = parseLabelCode;

  let stream = null, scanning = false, det = null, gen = 0, opening = false;
  async function scanStart() {
    if (stream || opening) return; // 두 번 눌러도 카메라는 하나만
    const my = ++gen, seen = new Set(); let last = '', lastN = 0;
    opening = true;
    try {
      det = det || new BarcodeDetector({ formats: SCAN_FORMATS });
      // 기본 640x480이면 라벨 바코드(약 190칸)가 화면 폭의 1/3 이상이어야 읽힌다: 해상도를 높여 달라고 한다
      const s = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment', width: { ideal: 1920 }, height: { ideal: 1080 } } });
      opening = false;
      if (my !== gen) { s.getTracks().forEach((t) => t.stop()); return; } // 여는 사이에 닫기·탭 이동
      stream = s;
      const v = $('scanVideo'); v.srcObject = stream; await v.play(); $('scanBox').hidden = false; scanning = true;
      const st = $('lotStatus'); st.textContent = 'WMS 라벨 바코드 하나만 화면에 비추세요.';
      const tick = async () => {
        if (my !== gen || !scanning) return;
        if (document.hidden || document.body.dataset.tab !== 'lot' || !document.body.contains(v)) { scanStop(); return; }
        let codes = []; try { codes = await det.detect(v); } catch (_) {}
        if (my !== gen) return;
        const found = new Map(); let partial = '';
        for (const c of codes) { const p = parseLabelCode(c.rawValue, c.format); if (p && p.inboundNo) found.set(pk(p.inboundNo, p.pallet), p); else if (p) partial = p.partial; }
        if (found.size > 1) { last = ''; st.textContent = `Pallet 바코드 ${found.size}개가 함께 보입니다. 투입할 라벨 하나만 비추세요.`; }
        else if (found.size === 1) {
          const [k, p] = [...found.entries()][0];
          lastN = k === last ? lastN + 1 : 1; last = k;
          if (lastN >= 2 && !seen.has(k)) { // 이번 스캔에서 이미 처리한 라벨은 다시 묻지 않는다
            seen.add(k); scanning = false; if (navigator.vibrate) navigator.vibrate(80);
            try { await findPallet(p.inboundNo, p.pallet, 'scan'); } finally { if (my === gen && stream) { scanning = true; setTimeout(tick, 800); } }
            return;
          }
        } else if (partial) st.textContent = `바코드가 일부만 읽혔습니다 (${partial}). 가까이 대고 다시 비추세요.`;
        setTimeout(tick, 250);
      };
      tick();
    } catch (e) { R.toast('카메라를 열지 못했습니다: ' + e.message, 'crit'); scanStop(); }
    finally { opening = false; }
  }
  function scanStop() { gen++; scanning = false; if (stream) stream.getTracks().forEach((t) => t.stop()); stream = null; const v = $('scanVideo'); if (v) v.srcObject = null; const b = $('scanBox'); if (b) b.hidden = true; }
  document.addEventListener('visibilitychange', () => { if (document.hidden) scanStop(); });

  async function removePallet(key) {
    const [inboundNo, pallet] = key.split('|');
    const reason = prompt(`${inboundNo} P${pallet} 투입을 취소합니다. 사유를 입력하세요.`); if (!reason) return;
    const r = await R.tryPost('r15LotRemove', { productionId: L.lot.id, inboundNo, pallet, reason });
    if (r && r.ok) { R.toast('투입을 취소했습니다', 'ok'); refresh(); }
  }
  // 잘못 시작한 작업(제품명·제조번호 오입력)을 지운다. 투입된 Pallet가 있으면 중간관리자만, 지우면 그 Pallet들은 다시 투입할 수 있다.
  // lot: 목록에서 고른 작업 (없으면 지금 연 작업)
  async function deleteLot(lot) {
    const cur = !lot || (L.lot && lot.id === L.lot.id); lot = cur ? L.lot : lot;
    if (cur && pendingItems().length) return R.toast('단말 보관 중인 투입이 서버에 올라간 뒤 삭제하세요', 'warn');
    const n = cur ? (L.detail && L.detail.pallets ? L.detail.pallets.length : 0) : lot.palletCount || 0;
    if (n && !R.isManager()) return R.toast('투입된 Pallet가 있습니다. 투입 내역에서 모두 취소한 뒤 삭제하세요', 'warn');
    const reason = prompt(`${lot.productName} ${lot.lotNo} 작업을 삭제합니다.${n ? `\n투입된 ${n} Pallet도 모두 취소됩니다.` : ''}\n사유를 입력하세요. (예: 제품명 오입력)`); if (!reason) return;
    const r = await R.tryPost('r15LotDelete', { productionId: lot.id, reason });
    if (r && r.ok) { R.toast('작업을 삭제했습니다', 'ok'); if (cur) { L.lot = null; L.detail = null; L.sel.clear(); persist(); } refresh(); }
  }
  async function finish() {
    if (pendingItems().length) return R.toast('단말 보관 중인 투입이 서버에 올라간 뒤 종료하세요', 'warn');
    if (!confirm(`${L.lot.productName} ${L.lot.lotNo} 작업을 종료할까요? 종료 후에는 관리자만 고칠 수 있습니다.`)) return;
    const r = await R.tryPost('r15LotFinish', { productionId: L.lot.id });
    if (r && r.ok) { R.toast('작업을 종료했습니다', 'ok'); L.lot = null; L.detail = null; persist(); refresh(); }
  }

  R.on('lotSaved', ({ res }) => {
    if (res.rejected && res.rejected.length) R.toast('투입 안 됨: ' + res.rejected.map((x) => `${x.inboundNo} P${x.pallet} (${x.reason})`).join(', '), 'crit');
    if (L.lot) refresh();
  });
  R.on('queue', () => { if (L.lot && !stream && document.body.dataset.tab === 'lot' && !document.activeElement.matches('input,select')) render(); });
  R.lot.init = function () { load(); render(); };
  R.lot.show = refresh;
})();
