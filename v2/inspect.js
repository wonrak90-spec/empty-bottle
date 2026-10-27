/* R15 검수 탭
 * 차량 1대 = 입고번호 1개. 첫 Pallet를 저장하면 그 값이 차량 기준(입고번호·품목·수량)이 된다.
 * 매 Pallet는 WMS 라벨·업체 라벨을 순서 없이 연달아 찍고, 둘 다 읽히면 저장. 읽은 값이 기준과 다를 때만 멈춘다.
 * R14와 달리 기준값으로 빈 칸을 몰래 채우지 않는다. (다른 차량 라벨이 기준 입고번호로 저장되던 원인)
 */
(function () {
  'use strict';
  const R = window.R15, { $, esc, fmt, num, digits, today } = R.util;
  const KEY = 'r15.inspect';
  const S = R.inspect = { base: null, cur: null, items: {}, saved: {} };

  function load() { try { const x = JSON.parse(localStorage.getItem(KEY) || 'null'); if (x) { S.base = x.base || null; S.cur = x.cur || null; } } catch (_) {} }
  function persist() { try { localStorage.setItem(KEY, JSON.stringify({ base: S.base, cur: S.cur ? Object.assign({}, S.cur, { photos: undefined }) : null })); } catch (_) {} }
  // 사진은 크기가 커서 localStorage 대신 메모리에만 둔다 (저장 버튼을 누르면 대기열(IndexedDB)로 넘어간다)
  const photos = { wms: '', vendor: '' };
  // Pallet 입력(cur)마다 '글자 읽는 중'과 그 작업(Promise)을 따로 둔다: 저장 뒤에도 앞 Pallet 인식이 이어질 수 있다
  const BZ = new WeakMap();
  const busyOf = (c) => { let x = c && BZ.get(c); if (!x) { x = { wms: false, vendor: false, prep: 0, jobs: [] }; if (c) BZ.set(c, x); } return x; };
  const reading = (c) => { const x = busyOf(c); return x.wms || x.vendor; };
  const AUTO = 'r15.autocam'; const autoCam = () => { try { return localStorage.getItem(AUTO) !== '0'; } catch (_) { return true; } };

  /* ---------- 기준정보 ---------- */
  async function loadItems() {
    try { const c = JSON.parse(localStorage.getItem('r15.items') || 'null'); if (c && c.items) S.items = index(c.items); } catch (_) {}
    const r = await R.tryGet('r15Items'); if (r && r.items) { S.items = index(r.items); try { localStorage.setItem('r15.items', JSON.stringify({ at: Date.now(), items: r.items })); } catch (_) {} }
  }
  function index(list) { const m = {}; list.forEach((it) => { m[it.itemCode] = it; }); return m; }
  const norm = (s) => String(s || '').toLowerCase().replace(/㎖/g, 'ml').replace(/(\d)o(?=\d|ml)/g, '$10').replace(/[()（）\s\-_.,·]/g, '');
  const vol = (s) => { const m = String(s || '').match(/(\d{2,4})\s*(?:ml|mL|ML|㎖)/); return m ? Number(m[1]) : 0; };

  // 업체 라벨 품명이 이 품목과 맞는지: 별칭 일치 또는 용량 일치. 용량이 다르면 불일치.
  // 업체별 품명 목록(관리 → 품목·별칭)이 있으면 그 목록과만 비교한다. 서버 r15VendorJudge_와 같은 규칙.
  const vnNorm = (s) => String(s || '').toLowerCase().replace(/㎖|밀리/g, 'ml').replace(/[^가-힣a-z0-9]/g, '');
  const vnStrip = (s) => vnNorm(s).replace(/\d+(ml|l|cc)?/g, '') || vnNorm(s);
  function vnSim(a, b) {
    const x = vnStrip(a), y = vnStrip(b); if (!x || !y) return 0;
    if (x === y) return 1; if ((x.length >= 3 && y.indexOf(x) >= 0) || (y.length >= 3 && x.indexOf(y) >= 0)) return 0.95;
    const bg = (t) => { const m = {}; for (let k = 0; k < t.length - 1; k++) { const g = t.substr(k, 2); m[g] = (m[g] || 0) + 1; } return m; };
    const A = bg(x), B = bg(y); let hit = 0, na = 0, nb = 0;
    Object.keys(A).forEach((g) => { na += A[g]; if (B[g]) hit += Math.min(A[g], B[g]); }); Object.keys(B).forEach((g) => { nb += B[g]; });
    return na + nb ? 2 * hit / (na + nb) : 0;
  }
  const supEq = (a, b) => { const f = (t) => vnNorm(t).replace(/주식회사|주/g, ''); const x = f(a), y = f(b); return !!x && !!y && (x === y || x.indexOf(y) >= 0 || y.indexOf(x) >= 0); };
  function vnBest(text, lists) { let best = null; lists.forEach((v) => v.names.forEach((nm) => { const sc = vnSim(text, nm); if (sc >= 0.5 && (!best || sc > best.score)) best = { score: sc, name: nm, v }; })); return best; }
  function vendorLists(item, supplier) { const all = (item && item.vendor) || [], same = all.filter((v) => supEq(v.supplier, supplier)); return { all, same, rest: all.filter((v) => same.indexOf(v) < 0) }; }
  function vendorMatch(item, vendorProduct, supplier) {
    if (!vendorProduct) return { result: '미대조', hard: false, note: '' };
    if (!item) return { result: '미확인', hard: false, note: '품목 기준정보 없음' };
    const L = vendorLists(item, supplier);
    if (L.all.length) {
      const m = vnBest(vendorProduct, L.same); if (m) return { result: '일치', hard: false, note: '', canon: m.name };
      const o = vnBest(vendorProduct, L.rest); if (o) return { result: '공급업체 다름', hard: false, note: o.v.supplier + ' 품명' };
      let other = null; Object.keys(S.items).forEach((c) => { if (c !== item.itemCode && !other) { const b = vnBest(vendorProduct, S.items[c].vendor || []); if (b) other = S.items[c]; } });
      if (other) return { result: '불일치', hard: true, note: '다른 품목(' + other.itemName + ') 병' };
      return { result: '목록에 없음', hard: false, note: '아래에서 업체 품명을 고르세요' };
    }
    const v = norm(vendorProduct);
    if ((item.aliases || []).some((a) => norm(a) && (v.indexOf(norm(a)) >= 0 || norm(a).indexOf(v) >= 0)) || v === norm(item.itemName)) return { result: '일치', hard: false, note: '' };
    const iv = Number(item.volume) || vol(item.itemName), vv = vol(vendorProduct);
    if (iv && vv && iv !== vv) return { result: '불일치', hard: true, note: `용량 다름 (기준 ${iv}mL / 업체 ${vv}mL)` };
    if (iv && vv && iv === vv) return { result: '일치', hard: false, note: '' };
    return { result: '미확인', hard: false, note: '업체 품명 별칭 미등록' };
  }

  /* ---------- 현재 Pallet 판정 ---------- */
  function checks(cIn, selfJob) {
    const b = S.base, c = cIn || S.cur || {}, out = [];
    if (!b) return out;
    const add = (ok, label, hard) => out.push({ ok, label, hard: !!hard });
    if (c.inboundNo) add(c.inboundNo === b.inboundNo, c.inboundNo === b.inboundNo ? '입고번호 일치' : `입고번호 다름 (${c.inboundNo})`, c.inboundNo !== b.inboundNo);
    else add(false, '입고번호를 읽지 못함 · 아래에서 확인', true);
    if (c.itemCode) add(c.itemCode === b.itemCode, c.itemCode === b.itemCode ? '품목코드 일치' : `품목코드 다름 (${c.itemCode})`, c.itemCode !== b.itemCode);
    // stop: 저장 전에 한 번 묻는다 (확인필요로 표시하지는 않는다). 마지막 Pallet처럼 수량이 다른 경우가 있어 hard로 두지 않는다.
    const stop = (label) => out.push({ ok: false, label, hard: false, stop: true });
    if (num(c.qty)) { if (num(c.qty) === num(b.qty)) add(true, 'WMS 수량 기준과 같음', false); else stop(`WMS 수량 ${fmt(c.qty)} (기준 ${fmt(b.qty)})`); }
    else add(false, 'WMS 수량 없음', false);
    const vq = num(c.vQty), wq = num(c.qty);
    if (vq && wq && vq !== wq && (vq * 2 < wq || vq > wq * 2)) add(false, `업체 수량 판독 불확실 (${fmt(c.vQty)}) · 사진 확인`, false);
    else if (num(c.vQty) && num(c.qty)) add(num(c.vQty) === num(c.qty), num(c.vQty) === num(c.qty) ? '업체 수량 일치' : `업체 수량 ${fmt(c.vQty)} ≠ WMS ${fmt(c.qty)}`, num(c.vQty) !== num(c.qty));
    else if (num(c.vQty) && num(b.qty) && num(c.vQty) !== num(b.qty)) stop(`업체 수량 ${fmt(c.vQty)} (기준 ${fmt(b.qty)}) · WMS 수량 없음`);
    const vm = vendorMatch(S.items[b.itemCode], c.vProduct, c.supplier || b.supplier);
    if (c.vProduct) add(vm.result === '일치', vm.result === '일치' ? '업체 품명 일치' : `업체 품명 ${vm.result}${vm.note ? ' · ' + vm.note : ''}`, vm.hard);
    if (!c.vendorDone && !c.vendorPhotoKept) add(false, '업체 라벨 사진 없음', false);
    // 추적의 핵심: 업체 생산일시와 업체 P번호. 못 읽었으면 다시 찍거나 직접 적게 알린다
    else if (c.vendorDone && !busyOf(c).vendor) {
      if (!c.vDate) add(false, '업체 생산일 못 읽음 · 다시 찍거나 직접 입력', false);
      else if (!c.vTime) add(false, '업체 생산시간 못 읽음', false);
      if (!c.vPallet) add(false, '업체 P번호 못 읽음 · 다시 찍거나 직접 입력', false);
    }
    const ss = c.pallet ? savedState(Number(c.pallet), selfJob) : '';
    // 대기열에 아직 있는 번호(전송 중·확인 필요)도 같은 번호를 두 번 넣는 실수다
    if (ss) add(false, ss === 'done' ? `P${c.pallet}는 이미 저장됨` : `P${c.pallet}는 이미 이 폰 대기열에 있음`, true);
    // Pallet 번호는 기준값과 비교하지 않아 오독이 그대로 저장되던 칸: 라벨의 총수(용기번호 뒤 숫자)와 저장 순서로 검산한다
    const pn = Number(digits(c.pallet)) || 0, tot = num(b.total) || num(b.palletTo);
    if (pn && tot && pn > tot) add(false, `Pallet ${pn}이 총 Pallet ${tot}보다 큼`, true);
    if (pn && num(c.palletTo) && num(b.palletTo) && num(c.palletTo) !== num(b.palletTo)) stop(`Pallet 총수 다름 (라벨 ${num(c.palletTo)} · 기준 ${num(b.palletTo)}) · 번호를 확인하세요`);
    if (pn && c.palletNote && String(pn) === String(c.palletNoteFor || pn)) stop(`Pallet P${pn} 맞는지 확인 · ${c.palletNote}`);
    const last = lastSaved();
    if (pn && last && pn !== last + 1 && savedState(pn) !== 'done') stop(`P순서 확인 · 다음은 아마 P${last + 1} (지금 P${pn})`);
    return out;
  }

  /* ---------- 진행 표시 ---------- */
  function savedState(n, selfJob) {
    const b = S.base; if (!b) return '';
    const j = R.queue.list((x) => x.type === 'inspect' && x.key === b.inboundNo + '|' + n && x.id !== selfJob).pop();
    if (j) return j.state === 'sending' || j.state === 'hold' ? 'pending' : j.state;
    return S.saved[n] ? 'done' : '';
  }
  async function refreshSaved() {
    S.saved = {}; if (!S.base) return;
    const r = await R.tryGet('r15Inbound', { inboundNo: S.base.inboundNo });
    if (r && r.records) r.records.forEach((x) => { if (x.pallet) S.saved[x.pallet] = x.id; });
    refreshProgress(); refreshChecks();
  }

  function progressHtml() {
    const b = S.base; if (!b) return '';
    const nums = Object.keys(S.saved).map(Number).concat(R.queue.list((j) => j.type === 'inspect' && j.key.indexOf(b.inboundNo + '|') === 0).map((j) => Number(j.key.split('|')[1])));
    const seen = nums.filter(Boolean), max = Math.max(num(b.total), ...seen, 1), min = num(b.total) || !seen.length ? 1 : Math.min(...seen); // 차량 중간부터 찍는 경우 앞 번호를 비워 두지 않는다
    let done = 0, pend = 0, blk = 0, cells = '';
    for (let n = min; n <= max; n++) {
      const st = savedState(n); if (st === 'done') done++; else if (st === 'pending') pend++; else if (st === 'blocked') blk++;
      cells += `<button type="button" class="pc ${st || 'none'}" data-pc="${n}" aria-label="P${n} ${st === 'done' ? '서버 완료' : st === 'pending' ? '단말 보관' : st === 'blocked' ? '확인 필요' : '미저장'}">${n}</button>`;
    }
    return `<div class="prog-h"><b>${done}${num(b.total) ? ' / ' + num(b.total) : ''}</b> 서버 완료 ${pend ? `<span class="pill p-warn"><i></i>단말 보관 ${pend}</span>` : ''} ${blk ? `<span class="pill p-crit"><i></i>확인 필요 ${blk}</span>` : ''}</div><div class="pcs">${cells}</div>
      <div class="sub">초록 서버 완료 · 노랑 단말 보관(자동 전송 중) · 빨강 확인 필요(눌러서 처리)</div>`;
  }

  /* ---------- 화면 ---------- */
  function field(id, label, value, opt) {
    opt = opt || {};
    return `<label class="${opt.cls || ''}">${esc(label)}<input id="${id}" value="${esc(value == null ? '' : value)}" ${opt.num ? 'inputmode="numeric"' : ''} ${opt.ph ? `placeholder="${esc(opt.ph)}"` : ''} ${opt.ro ? 'readonly' : ''}></label>`;
  }

  function render() {
    const root = $('inspectView'); if (!root) return;
    const b = S.base;
    const c = S.cur || (S.cur = blankCur());
    const it = S.items[c.itemCode];
    root.innerHTML = `
      ${b ? `<section class="veh">
        <div class="shead"><div><div class="sub">입고번호</div><div class="big">${esc(b.inboundNo)}</div></div>
          <div class="right"><button type="button" class="btn ghost sm" id="vehEnd">차량 종료</button></div></div>
        <div class="vline"><b>${esc(b.product)}</b> · ${esc(b.supplier || '')} · ${fmt(b.qty)} ${esc(b.unit || 'EA')}/Pallet</div>
        <div id="progBox">${progressHtml()}</div>
      </section>` : `<section class="veh"><div class="shead"><div><div class="sub">새 차량</div><div class="big">${esc(c.inboundNo || '첫 Pallet')}</div></div></div>
        <div class="vline">${c.itemCode ? `<b>${esc(it ? it.itemName : c.productOcr || '기준정보에 없는 품목코드')}</b> · ${esc(c.supplier || '')}` : 'WMS 라벨과 업체 라벨을 찍으세요. 첫 Pallet를 저장하면 이 차량의 기준이 됩니다.'}</div></section>`}
      <section>
        <div class="shead"><h2>${c.pallet ? 'P' + esc(c.pallet) : '다음 Pallet'}</h2><span class="sub" id="ocrStatus">${esc(c.status || '')}</span></div>
        <div class="steps">
          ${R.zoomcam && R.zoomcam.supported ? `<button type="button" class="shot seq" id="seqBtn"><span class="ic">📷</span><span>연속 촬영 · WMS 1배 → 업체 확대</span></button>` : ''}
          ${shotBtn('wms', '① WMS 라벨', c.wmsDone)}
          ${shotBtn('vendor', '② 업체 라벨', c.vendorDone)}
        </div>
        <div class="grid g2">
          ${field('cPallet', 'Pallet 번호', c.pallet, { num: true, ph: hintNext(), cls: 'key' + (c.pallet ? '' : ' need') })}
          ${field('cInbound', '입고번호', c.inboundNo, { num: true, cls: 'key' + (b && c.inboundNo && c.inboundNo !== b.inboundNo ? ' bad' : '') })}
          ${field('cItem', '품목코드', c.itemCode, { num: true })}
          ${field('cQty', 'WMS 수량', c.qty, { num: true })}
          ${field('cVDate', '업체 생산일자', c.vDate, { ph: 'yyyy-mm-dd', cls: 'key' + (c.vendorDone && !c.vDate ? ' need' : '') })}
          ${field('cVTime', '업체 생산시간', c.vTime, { ph: 'hh:mm', cls: 'key' + (c.vendorDone && !c.vTime ? ' need' : '') })}
          ${field('cVPallet', '업체 P-번호', c.vPallet, { num: true, cls: 'key' + (c.vendorDone && !c.vPallet ? ' need' : '') })}
          ${field('cVQty', '업체 수량', c.vQty, { num: true })}
          ${field('cVProduct', '업체 품명', c.vProduct, { ph: '등록된 품명과 맞을 때만 채워짐' })}
        </div>
        <div class="fixes" id="fixBox"></div>
        <div class="checks" id="checksBox"></div>
        ${R.zoomcam && R.zoomcam.supported ? `<label class="chk"><input type="checkbox" id="autoCam" ${autoCam() ? 'checked' : ''}> 저장하면 다음 Pallet 카메라 자동으로 열기</label>` : ''}
        <label>특이사항<input id="cNote" value="${esc(c.note || '')}" placeholder="필요할 때만"></label>
        <details class="raw"><summary>OCR 원문</summary><pre>${esc((c.ocrRaw || '') + (c.vOcrRaw ? '\n---\n' + c.vOcrRaw : ''))}</pre></details>
      </section>
      <div class="savebar">
        <button type="button" class="btn" id="saveBtn"></button>
        <button type="button" class="btn ghost sm" id="clearCur">다시 찍기</button>
      </div>`;
    bindPallet(); refreshChecks();
  }

  function checksHtml(ck) { return ck.map((x) => `<div class="ck ${x.ok ? 'ok' : x.hard ? 'bad' : 'warn'}">${x.ok ? '✓' : x.hard ? '✗' : '!'} ${esc(x.label)}</div>`).join(''); }
  // 입력 중에는 화면 전체를 다시 그리지 않는다 (입력 칸 포커스가 사라지지 않게)
  // 읽은 값이 비었거나 차량 기준과 다를 때: 라벨을 눈으로 보고 "기준값이 맞습니다"를 한 번 누르면 기준값으로 바꾼다.
  // 몰래 채우지 않고 사람이 누른 것만 바꾸며, 누른 내역(읽은 값)은 특이사항에 남아 감사 추적에 보인다.
  const FIX = [['inboundNo', 'inboundNo', '입고번호', 'cInbound'], ['itemCode', 'itemCode', '품목코드', 'cItem'], ['qty', 'qty', 'WMS 수량', 'cQty']];
  function fixesHtml() {
    const b = S.base, c = S.cur || {}; if (!b || !c.wmsDone || busyOf(c).wms) return '';
    // 라벨에서 8자리 입고번호를 제대로 읽었는데 기준과 다르면 다른 차량이다. 기준값으로 바꾸는 버튼은 주지 않고 새 차량으로 시작하게 한다.
    const other = digits(c.inboundNo).length >= 8 && c.inboundNo !== b.inboundNo;
    const sw = other ? `<div class="box crit"><b>다른 차량 라벨입니다</b> · 읽은 입고번호 <b>${esc(c.inboundNo)}</b> (지금 차량 ${esc(b.inboundNo)})<br><button type="button" class="btn sm" id="vehSwitch">${esc(c.inboundNo)} 새 차량으로 시작</button> <span class="muted">잘못 읽었으면 입고번호 칸을 직접 고치세요</span></div>` : '';
    const it = S.items[b.itemCode], vm = vendorMatch(it, c.vProduct, c.supplier || b.supplier), L = vendorLists(it, c.supplier || b.supplier);
    const cand = c.vendorDone && L.all.length && vm.result !== '일치' ? [...new Set((L.same.length ? L.same : L.all).flatMap((v) => v.names))].slice(0, 4) : [];
    const pick = cand.length ? `<div class="box warn"><b>업체 품명 고르기</b> · 라벨을 보고 맞는 품명을 누르세요${c.vProduct ? ` <span class="muted">(읽은 값 ${esc(c.vProduct)})</span>` : ''}<br>${cand.map((n) => `<button type="button" class="btn ghost sm" data-vn="${esc(n)}">${esc(n)}</button>`).join(' ')}</div>` : '';
    return sw + pick + FIX.filter(([k, bk]) => b[bk] && c[k] !== b[bk] && !(k === 'inboundNo' && other) && !(other && k !== 'inboundNo')).map(([k, bk, label]) => `<button type="button" class="btn ghost sm fix" data-fix="${k}">${esc(label)} ${esc(k === 'qty' ? fmt(b[bk]) : b[bk])}가 맞습니다${c[k] ? ` <span class="muted">(읽은 값 ${esc(c[k])})</span>` : ''}</button>`).join('');
  }
  function refreshFixes() {
    const box = $('fixBox'); if (!box) return; box.innerHTML = staleHtml() + fixesHtml();
    if ($('vehSwitch')) $('vehSwitch').onclick = () => switchVehicle();
    box.querySelectorAll('[data-vn]').forEach((el) => { el.onclick = () => { const c = S.cur; (c.confirmed = c.confirmed || []).push(`업체 품명 선택(읽은 값 ${c.vProduct || '없음'})`); c.vProduct = el.dataset.vn; $('cVProduct').value = c.vProduct; persist(); refreshChecks(); }; });
    if ($('vehStaleEnd')) $('vehStaleEnd').onclick = () => switchVehicle(true);
    box.querySelectorAll('[data-fix]').forEach((el) => { el.onclick = () => {
      const k = el.dataset.fix, f = FIX.find((x) => x[0] === k), c = S.cur;
      (c.confirmed = c.confirmed || []).push(`${f[2]} 기준값 확인(읽은 값 ${c[k] || '없음'})`);
      c[k] = S.base[f[1]]; $(f[3]).value = c[k]; persist(); refreshChecks();
    }; });
  }
  function refreshChecks() {
    refreshFixes();
    const box = $('checksBox'), btn = $('saveBtn'); if (!box || !btn) return;
    const ck = checks(), hard = ck.some((x) => !x.ok && x.hard), c = S.cur || {};
    box.innerHTML = checksHtml(ck);
    btn.disabled = !canSave(); btn.classList.toggle('warn', hard);
    btn.textContent = reading(c) && !canSave() ? '글자 읽는 중…' : reading(c) ? '저장 · 인식은 이어서' + (c.pallet ? ' · P' + c.pallet : '') : (hard ? '확인필요로 저장' : '저장') + (c.pallet ? ' · P' + c.pallet : '');
  }
  function refreshProgress() {
    const box = $('progBox'); if (!box) return;
    box.innerHTML = progressHtml();
    box.querySelectorAll('[data-pc]').forEach((b) => { b.onclick = () => palletChip(Number(b.dataset.pc)); });
  }

  function shotBtn(kind, label, done) {
    // 업체 라벨은 높이 붙어 있어 확대 카메라로 찍는다 (안 되면 그 안의 '기본 카메라')
    if (kind === 'vendor' && R.zoomcam && R.zoomcam.supported) return `<button type="button" class="shot ${done ? 'done' : ''}" data-zoom="vendor"><span class="ic">${busyOf(S.cur)[kind] ? '…' : done ? '✓' : '🔍'}</span><span>${label}${busyOf(S.cur)[kind] ? ' 읽는 중' : done ? ' 다시' : ' 확대'}</span>${photos[kind] ? `<img src="${photos[kind]}" alt="">` : ''}</button><input type="file" accept="image/*" capture="environment" data-shot="vendor" id="vendorFile" hidden>`;
    return `<label class="shot ${done ? 'done' : ''}"><input type="file" accept="image/*" capture="environment" data-shot="${kind}" id="${kind}File" hidden>
      <span class="ic">${busyOf(S.cur)[kind] ? '…' : done ? '✓' : '📷'}</span><span>${label}${busyOf(S.cur)[kind] ? ' 읽는 중' : done ? ' 다시' : ' 촬영'}</span>${photos[kind] ? `<img src="${photos[kind]}" alt="">` : ''}</label>`;
  }
  function lastSaved() { return Math.max(0, ...Object.keys(S.saved).map(Number), ...R.queue.list((j) => S.base && j.key.indexOf(S.base.inboundNo + '|') === 0).map((j) => Number(j.key.split('|')[1]))); }
  function hintNext() {
    const n = lastSaved();
    return n ? '다음은 아마 ' + (n + 1) : '';
  }
  function blankCur() { return { pallet: '', palletTo: '', palletNote: '', palletNoteFor: '', inboundNo: '', itemCode: '', qty: '', vProduct: '', vQty: '', vDate: '', vTime: '', vLot: '', vLine: '', vPallet: '', note: '', ocrRaw: '', vOcrRaw: '', codeRaw: '', wmsDone: false, vendorDone: false, status: '', supplier: '', manufacturer: '', unit: '', inboundDate: '', expiryDate: '', productOcr: '' }; }
  // 바코드로 입고번호·Pallet를 읽었고 차량 기준과 같으면, 글자 인식이 끝나기 전에도 저장할 수 있다 (나머지 대조는 이어서)
  function canSave() {
    const c = S.cur || {}, x = busyOf(c);
    if (!(Number(digits(c.pallet)) && c.inboundNo && photos.wms && !x.prep && (S.base || c.itemCode))) return false;
    return !reading(c) || !!(S.base && c.bc && c.inboundNo === S.base.inboundNo);
  }

  function readCur() {
    const c = S.cur; if (!c || !$('cPallet')) return;
    c.pallet = digits($('cPallet').value).replace(/^0+(?=\d)/, ''); c.inboundNo = digits($('cInbound').value); c.itemCode = digits($('cItem').value);
    c.qty = digits($('cQty').value); c.vProduct = $('cVProduct').value.trim(); c.vQty = digits($('cVQty').value);
    c.vDate = $('cVDate').value.trim(); c.vTime = $('cVTime').value.trim(); c.vPallet = $('cVPallet').value.trim(); c.note = $('cNote').value;
    persist();
  }
  function bindPallet() {
    bindShots();
    if ($('seqBtn')) $('seqBtn').onclick = startSequence;
    if ($('autoCam')) $('autoCam').onchange = (e) => { try { localStorage.setItem(AUTO, e.target.checked ? '1' : '0'); } catch (_) {} };
    ['cPallet', 'cInbound', 'cItem', 'cQty', 'cVProduct', 'cVQty', 'cVDate', 'cVTime', 'cVPallet', 'cNote'].forEach((id) => $(id).addEventListener('input', () => { readCur(); refreshChecks(); }));

    $('saveBtn').onclick = savePallet;
    $('clearCur').onclick = () => { if (!confirm('이 Pallet 입력을 지우고 다시 찍을까요?')) return; S.cur = blankCur(); photos.wms = ''; photos.vendor = ''; persist(); render(); };
    if ($('vehEnd')) $('vehEnd').onclick = endVehicle;
    refreshProgress();
  }

  function bindShots() {
    document.querySelectorAll('[data-zoom]').forEach((b) => {
      b.onclick = async () => {
        const r = await R.zoomcam.capture();
        if (r === 'fallback') { const f = $('vendorFile'); if (f) f.click(); return; }
        if (r) handleShot(b.dataset.zoom, r);
      };
    });
    document.querySelectorAll('[data-shot]').forEach((inp) => {
      inp.onchange = () => { const file = inp.files && inp.files[0]; inp.value = ''; if (file) handleShot(inp.dataset.shot, file); };
    });
  }
  // 연속 촬영: 앱 카메라 하나로 WMS(1배) → 업체(확대). 사진은 찍는 즉시 읽기 시작한다.
  function startSequence() {
    const cur = S.cur;
    R.zoomcam.sequence((kind, url) => {
      if (url) handleShot(kind, url, cur);
      else if (kind === 'vendor' && S.cur === cur) { cur.vendorSkipped = true; render(); }
    }).then((r) => { if (r === 'fallback') { const f = $('wmsFile'); if (f) f.click(); } });
  }

  // WMS 라벨 바코드(Code39 "260047330030" = 입고번호 8자리 + Pallet 4자리)를 사진에서 바로 읽는다.
  // BarcodeDetector가 있는 폰(안드로이드 크롬 등)만. 없으면 글자 인식으로 읽는다.
  async function readBarcode(dataUrl) {
    if (!('BarcodeDetector' in window)) return null;
    try {
      let det; try { det = new BarcodeDetector({ formats: ['code_39', 'code_128', 'qr_code', 'data_matrix'] }); } catch (_) { det = new BarcodeDetector(); }
      const img = await createImageBitmap(await (await fetch(dataUrl)).blob());
      for (const b of await det.detect(img)) {
        const v = String(b.rawValue || '').replace(/\s/g, ''), m = v.match(/(\d{8})-?(\d{4})$/);
        if (m && Number(m[2])) return { inboundNo: m[1], pallet: String(Number(m[2])), raw: v };
      }
    } catch (_) {}
    return null;
  }

  async function handleShot(kind, file, curIn) {
    const cur = curIn || S.cur, x = busyOf(cur), here = () => S.cur === cur, st = $('ocrStatus');
    if (here() && st) { st.textContent = '사진 준비 중…'; st.dataset.type = 'warn'; } // OCR 파일(전역 setStatus)이 안 읽혀도 촬영은 되게
    x.prep++;
    const forOcr = await R.shrink(file, 2000, 0.85), stored = forOcr ? await R.shrink(forOcr, 1400, 0.72) : '';
    x.prep--;
    if (!forOcr || !stored) { if (here() && st) st.textContent = '사진을 열지 못했습니다 · 다시 찍어 주세요'; R.toast('사진을 열지 못했습니다 (' + (file.type || '형식 알 수 없음') + '). 다시 찍어 주세요. 계속되면 설정 > 카메라 > 포맷 > 높은 호환성', 'crit'); if (here()) refreshChecks(); return; }
    if (!here()) return; // 그 사이 저장·다시 찍기를 했으면 버린다
    photos[kind] = stored;
    readCur(); cur[kind + 'Done'] = true; cur.status = '글자 읽는 중…'; x[kind] = true;
    if (kind === 'vendor') cur.vendorSkipped = false;
    if (kind === 'wms') {
      const bc = await readBarcode(forOcr);
      if (bc && here()) { Object.assign(cur, { inboundNo: bc.inboundNo, pallet: bc.pallet, codeRaw: bc.raw, bc: true }); cur.status = '바코드 읽음 · 글자 확인 중'; }
    }
    if (here()) render();
    const job = (async () => {
      try {
        const r = await R.ocr.read(forOcr, kind === 'vendor' ? 'vendor' : 'wms', here() ? $('ocrStatus') : null);
        x[kind] = false; applyOcr(kind, r, cur);
      } catch (e) {
        x[kind] = false; cur.status = e.message;
        if (here()) { R.toast(e.message, 'warn'); render(); }
      }
    })();
    x.jobs.push(job); return job;
  }

  // 용기번호(0029/0042)와 바코드 글자(26004733-0029)에서 Pallet 후보를 모은다 (라벨은 4자리로 인쇄된다).
  // 현장 사진에는 옆 Pallet 라벨이 같이 찍히는 일이 많다: 후보가 여럿이면 값은 두되 저장 전에 묻는다(note).
  // 총수보다 크거나 4자리를 넘으면 비워 두고 직접 입력받는다 (비어 있으면 저장 버튼이 잠긴다).
  function palletCheck(p, text) {
    const inb = digits(p.inboundNo), to = Number(digits(p.containerTo)) || 0, n = Number(digits(p.containerFrom)) || 0;
    const cands = new Set(n ? [n] : []), t = String(text || '').replace(/[OoDQ]/g, '0');
    for (const m of t.matchAll(/(?:^|\D)(\d{8})\s*-\s*(\d{4})(?![\d!|lI])/g) /* lookbehind 없이: iOS 16.3 이하 */) if (!inb || m[1] === inb) cands.add(Number(m[2]));
    for (const m of t.matchAll(/기\s*번\s*호?\s*[:：]?\s*(\d{4})(?![\d!|lI])/g)) cands.add(Number(m[1]));
    cands.delete(0);
    let pallet = n && n <= 9999 ? String(n) : '', note = '';
    if (pallet && to && n > to) { pallet = ''; note = `P${n} > 총 ${to}`; }
    else if (pallet && digits(p.containerFrom).length !== 4) { pallet = ''; note = `용기번호 '${p.containerFrom}' 자리수가 4자리가 아님`; }
    else if (pallet && cands.size > 1) note = '라벨에 Pallet 번호가 여럿 (' + [...cands].map((x) => 'P' + x).join(' · ') + ')';
    else if (pallet && !to) note = '용기번호 뒤 총수를 못 읽음 (라벨이 잘렸을 수 있음)';
    return { pallet, to: to && to <= 9999 ? String(to) : '', note };
  }

  function applyOcr(kind, r, curIn) {
    const p = r.parsed || {};
    const pc = palletCheck(p, r.text), pal = pc.pallet;
    const c = curIn || S.cur;
    if (kind === 'wms') {
      // 읽지 못한 칸은 비워 둔다. 기준값으로 채우지 않는다. 바코드로 읽은 입고번호·Pallet는 글자 인식보다 믿는다.
      const keep = c.bc ? { inboundNo: c.inboundNo, pallet: c.pallet, codeRaw: c.codeRaw } : null;
      Object.assign(c, { pallet: pal || '', palletTo: pc.to, palletNote: pal ? pc.note : '', palletNoteFor: pal, inboundNo: digits(p.inboundNo), itemCode: digits(p.itemCode), qty: digits(p.displayQty), ocrRaw: r.text, codeRaw: p.codeRaw || '',
        supplier: p.supplier || '', manufacturer: p.manufacturer || '', unit: p.unit || '', inboundDate: p.inboundDate || '', expiryDate: p.expiryDate || '', productOcr: p.product || '' });
      c.status = `${R.ocr.lastEngine} 완료` + (pal ? (pc.note ? ' · ' + pc.note : '') : pc.note ? ` · Pallet 번호 확인 필요 (${pc.note}), 직접 입력` : ' · Pallet 번호를 못 읽음, 직접 입력');
      if (keep) {
        if ((digits(p.inboundNo) && digits(p.inboundNo) !== keep.inboundNo) || (pal && pal !== keep.pallet)) c.bcNote = `글자로는 ${digits(p.inboundNo) || '?'} P${pal || '?'} · 바코드 값 사용`;
        Object.assign(c, keep, { palletNote: '' }); c.status = `바코드 + ${R.ocr.lastEngine} 완료${c.bcNote ? ' · ' + c.bcNote : ''}`;
      }
    } else {
      Object.assign(c, { vProduct: p.product || '', vQty: Number(digits(p.qty)) >= 100 ? digits(p.qty) : '', vDate: p.prodDate || '', vTime: p.prodTime || '', vLot: p.lotNo || '', vLine: p.line || '', vPallet: p.palletNo || '', vOcrRaw: r.text });
      // 품명 목록과 맞으면 읽은 글자 대신 목록의 품명으로 저장한다 (원문은 OCR 원문에 남는다). 줄 단위로도 찾아 본다.
      const it = S.items[c.itemCode || (S.base && S.base.itemCode)], sup = c.supplier || (S.base && S.base.supplier);
      if (it && (it.vendor || []).length) {
        const L = vendorLists(it, sup), lines = [p.product || ''].concat(String(r.text || '').split(/\n/));
        let hit = null; lines.forEach((ln) => { const m = ln && vnBest(ln, L.same); if (m && (!hit || m.score > hit.score)) hit = m; });
        // 등록된 품명과 맞을 때만 적는다. 다른 공급업체·다른 품목 이름이 확실히 보이면 그 이름을 적어 오류로 걸리게 하고, 애매한 글자는 비운다
        if (!hit) {
          const pick = (lists, min) => { let h = null; lines.forEach((ln) => { const m = ln && vnBest(ln, lists); if (m && m.score >= min && (!h || m.score > h.score)) h = m; }); return h; };
          hit = pick(L.rest, 0.8);
          if (!hit) Object.keys(S.items).forEach((k) => { if (!hit && S.items[k] !== it) hit = pick(S.items[k].vendor || [], 0.8); });
        }
        c.vProduct = hit ? hit.name : '';
      }
      c.status = `업체 라벨 ${R.ocr.lastEngine} 완료`;
    }
    if (S.cur !== c) return; // 이미 저장한 Pallet: 저장 쪽에서 마무리한다
    persist(); render();
    if (navigator.vibrate) try { navigator.vibrate(60); } catch (_) {}
  }

  async function savePallet() {
    readCur();
    if (!canSave()) return;
    if (!S.base) {
      // 첫 Pallet: 이 값으로 차량을 시작한다
      const c0 = S.cur, it = S.items[c0.itemCode];
      if (c0.inboundNo.length < 6) return R.toast('입고번호를 확인하세요', 'crit');
      if (!it && !confirm(`품목코드 ${c0.itemCode}는 기준정보에 없습니다. 그대로 이 차량을 시작할까요?`)) return;
      S.base = { inboundNo: c0.inboundNo, itemCode: c0.itemCode, product: it ? it.itemName : c0.productOcr || '', supplier: c0.supplier, manufacturer: c0.manufacturer, qty: c0.qty, unit: c0.unit || 'EA',
        inboundDate: c0.inboundDate || today(), expiryDate: c0.expiryDate, total: c0.palletTo || '', palletTo: c0.palletTo || '', startedAt: Date.now() };
      persist(); refreshSaved();
    }
    const b = S.base, c = S.cur, late = reading(c);
    if (!canSave()) return;
    if (savedState(Number(c.pallet)) && !confirm(`P${c.pallet}는 이미 ${savedState(Number(c.pallet)) === 'done' ? '저장되어' : '이 폰 대기열에'} 있습니다. 그래도 보낼까요? (서버가 중복으로 막습니다)`)) return;
    if (!late) {
      const ck = checks(c), bad = ck.filter((x) => !x.ok && x.hard), stops = ck.filter((x) => !x.ok && !x.hard && x.stop);
      if (bad.length && !confirm('기준과 다른 값이 있습니다.\n\n' + bad.map((x) => '· ' + x.label).join('\n') + '\n\n확인필요로 저장할까요? (값을 고치려면 취소)')) return;
      if (stops.length && !confirm('저장 전에 확인하세요.\n\n' + stops.map((x) => '· ' + x.label).join('\n') + '\n\n이대로 저장할까요? (값을 고치려면 취소)')) return;
    }
    // 업체 사진 없이 저장하면 이유를 고른다. '나중에 찍기'만 점검에 남고, 보고서에서 사진을 붙일 수 있다.
    let noVendor = '';
    if (!c.vendorDone && !c.vendorPhotoKept) { noVendor = await askNoVendor(); if (!noVendor) return; }
    const label = `${c.inboundNo} P${c.pallet}`, shots = { wms: photos.wms, vendor: photos.vendor };
    if (!late) {
      await R.queue.addInspect(buildPayload(c, checks(c), noVendor), shots, { label });
      R.toast(`P${c.pallet} 단말에 보관 · 서버로 보내는 중`, 'ok');
    } else {
      // 인식이 끝나기 전 저장: 사진은 바로 올리기 시작하고, 인식이 끝나면 대조해서 보낸다. 기준과 다르면 확인필요로 저장하고 알린다.
      const job = await R.queue.addInspect(buildPayload(c, checks(c), noVendor), shots, { label, hold: true });
      R.toast(`P${c.pallet} 저장 · 업체 라벨 대조는 이어서 합니다`, 'ok');
      Promise.allSettled(busyOf(c).jobs).then(async () => {
        const ck = checks(c, job.id), bad = ck.filter((x) => !x.ok && x.hard), stops = ck.filter((x) => !x.ok && !x.hard && x.stop);
        await R.queue.release(job.id, buildPayload(c, ck, noVendor, true));
        if (bad.length || stops.length) {
          R.toast(`${label} ${bad.length ? '확인필요로 저장' : '확인'}: ${bad.concat(stops).map((x) => x.label).join(', ')} · 보고서에서 고칠 수 있습니다`, bad.length ? 'crit' : 'warn');
          if (navigator.vibrate) try { navigator.vibrate([120, 80, 120]); } catch (_) {}
        }
      });
    }
    b.lastAt = Date.now();
    S.cur = blankCur(); photos.wms = ''; photos.vendor = ''; persist(); render();
    window.scrollTo({ top: 0, behavior: 'smooth' });
    if (R.zoomcam && R.zoomcam.supported && autoCam()) setTimeout(startSequence, 250);
  }

  function buildPayload(c, ck, noVendor, late) {
    const b = S.base, bad = ck.filter((x) => !x.ok && x.hard), warn = ck.filter((x) => !x.ok && !x.hard);
    const item = S.items[b.itemCode] || S.items[c.itemCode], vm = vendorMatch(item, c.vProduct);
    const qtyResult = num(c.vQty) && num(c.qty) ? (num(c.vQty) === num(c.qty) ? '일치' : '불일치') : '';
    const reasons = bad.concat(warn).map((x) => x.label);
    return {
      inboundNo: c.inboundNo, inboundDate: b.inboundDate, product: (S.items[c.itemCode] || item || {}).itemName || b.product, itemCode: c.itemCode || b.itemCode,
      manufacturer: b.manufacturer, supplier: b.supplier, displayQty: c.qty, unit: b.unit || 'EA', expiryDate: b.expiryDate,
      containerFrom: c.pallet, containerTo: c.pallet, codeRaw: c.codeRaw || (c.inboundNo + '-' + String(c.pallet).padStart(4, '0')),
      infoMatch: c.inboundNo === b.inboundNo && (!c.itemCode || c.itemCode === b.itemCode) ? '일치' : '불일치', mixed: c.itemCode && c.itemCode !== b.itemCode ? '있음' : '없음',
      actualQty: (num(c.vQty) && num(c.qty) && (num(c.vQty) * 2 < num(c.qty) || num(c.vQty) > num(c.qty) * 2) ? c.qty : c.vQty || c.qty), qtyResult, finalResult: bad.length ? '확인필요' : '적합',
      note: [c.note, (c.confirmed || []).join(', '), c.bc ? '바코드' + (c.bcNote ? '(' + c.bcNote + ')' : '') : '', late ? '저장 후 대조' : '', noVendor ? '업체사진 없음: ' + noVendor : '', reasons.length ? '확인: ' + reasons.join(', ') : '', 'R15'].filter(Boolean).join(' / '),
      ocrRaw: c.ocrRaw, labelMatch: vm.result,
      vendorProduct: c.vProduct, vendorQty: c.vQty, vendorProdDate: c.vDate, vendorProdTime: c.vTime, vendorLotNo: c.vLot, vendorLine: c.vLine,
      vendorOcrRaw: c.vOcrRaw, vendorPalletNo: c.vPallet, dateKey: today().replace(/-/g, '')
    };
  }

  function askNoVendor() {
    return new Promise((done) => {
      const opts = ['라벨 없음', '라벨 손상', '높아서 못 찍음', '나중에 찍기'];
      $('dialogBody').innerHTML = `<h3>업체 라벨 사진이 없습니다</h3><div class="sub">이유를 고르면 그대로 저장합니다. "나중에 찍기"는 보고서 점검에 남고, 그 기록에서 사진을 붙일 수 있습니다.</div>
        <div class="grid g2">${opts.map((o) => `<button type="button" class="btn ghost" data-nv="${o}">${o}</button>`).join('')}</div>
        <div class="savebar"><button type="button" class="btn ghost sm" id="nvBack">돌아가서 찍기</button></div>`;
      $('dialog').hidden = false;
      const end = (v) => { $('dialog').hidden = true; done(v); };
      document.querySelectorAll('[data-nv]').forEach((b) => { b.onclick = () => end(b.dataset.nv); });
      $('nvBack').onclick = () => end('');
    });
  }

  function palletChip(n) {
    const j = R.queue.find(S.base.inboundNo + '|' + n, 'inspect');
    if (j && j.state === 'blocked') return R.showJob(j);
    if (j) return R.toast(`P${n} · ${j.state === 'done' ? '서버 완료' : '단말 보관 · ' + (j.lastError || '전송 대기')}`, j.state === 'done' ? 'ok' : 'warn');
    if (S.saved[n]) return R.toast(`P${n} 서버 완료`, 'ok');
    R.toast(`P${n} 아직 저장 안 됨`, 'warn');
  }

  // 며칠 전에 시작한 차량이 화면에 남아 있으면 새 차량 라벨을 그 차량 기준으로 저장하기 쉽다 (10-15 차량에 10-19 다른 차량이 섞인 사례)
  function staleHtml() {
    const b = S.base; if (!b || !b.startedAt) return '';
    const last = Math.max(b.startedAt, b.lastAt || 0), day = (t) => new Date(t).toDateString();
    if (day(last) === day(Date.now())) return '';
    return `<div class="box warn"><b>${esc(new Date(last).toLocaleDateString('ko-KR'))}에 검수하던 차량(${esc(b.inboundNo)})이 이어지고 있습니다.</b> 같은 차량이 아니면 새 차량으로 시작하세요.<br><button type="button" class="btn sm" id="vehStaleEnd">새 차량으로 시작</button></div>`;
  }
  function switchVehicle(stale) {
    const keep = S.cur;
    if (!confirm(stale ? `차량 ${S.base.inboundNo} 검수를 끝내고 새 차량으로 시작할까요? (찍은 사진과 읽은 값은 그대로 둡니다)` : `차량 ${S.base.inboundNo}을 끝내고 ${keep.inboundNo} 새 차량으로 시작할까요? 이 Pallet가 새 차량의 첫 Pallet가 됩니다.`)) return;
    S.base = null; S.saved = {}; S.cur = keep; if (keep) keep.confirmed = []; persist(); render();
  }
  function endVehicle() {
    const pend = R.queue.list((j) => j.type === 'inspect' && j.key.indexOf(S.base.inboundNo + '|') === 0 && j.state !== 'done').length;
    if (!confirm(pend ? `아직 서버에 안 올라간 Pallet가 ${pend}건 있습니다. 차량을 종료해도 대기열에서 계속 보냅니다. 종료할까요?` : `입고번호 ${S.base.inboundNo} 차량을 종료할까요?`)) return;
    S.base = null; S.cur = null; S.saved = {}; photos.wms = ''; photos.vendor = ''; persist(); render();
  }

  R.on('queue', refreshProgress);
  R.on('login', () => { if (R.rank() < 1) return; loadItems().then(render); if (S.base) refreshSaved(); });
  R.inspect.init = function () { load(); render(); };
  R.inspect.render = render;
  R.inspect.refreshSaved = refreshSaved;
})();
