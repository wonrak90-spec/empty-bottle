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
  const busy = { wms: false, vendor: false }; // 글자 읽는 중인 사진 (둘 다 끝나야 저장)

  /* ---------- 기준정보 ---------- */
  async function loadItems() {
    try { const c = JSON.parse(localStorage.getItem('r15.items') || 'null'); if (c && c.items) S.items = index(c.items); } catch (_) {}
    const r = await R.tryGet('r15Items'); if (r && r.items) { S.items = index(r.items); try { localStorage.setItem('r15.items', JSON.stringify({ at: Date.now(), items: r.items })); } catch (_) {} }
  }
  function index(list) { const m = {}; list.forEach((it) => { m[it.itemCode] = it; }); return m; }
  const norm = (s) => String(s || '').toLowerCase().replace(/㎖/g, 'ml').replace(/(\d)o(?=\d|ml)/g, '$10').replace(/[()（）\s\-_.,·]/g, '');
  const vol = (s) => { const m = String(s || '').match(/(\d{2,4})\s*(?:ml|mL|ML|㎖)/); return m ? Number(m[1]) : 0; };

  // 업체 라벨 품명이 이 품목과 맞는지: 별칭 일치 또는 용량 일치. 용량이 다르면 불일치.
  function vendorMatch(item, vendorProduct) {
    if (!vendorProduct) return { result: '미대조', hard: false, note: '' };
    if (!item) return { result: '미확인', hard: false, note: '품목 기준정보 없음' };
    const v = norm(vendorProduct);
    if ((item.aliases || []).some((a) => norm(a) && (v.indexOf(norm(a)) >= 0 || norm(a).indexOf(v) >= 0)) || v === norm(item.itemName)) return { result: '일치', hard: false, note: '' };
    const iv = Number(item.volume) || vol(item.itemName), vv = vol(vendorProduct);
    if (iv && vv && iv !== vv) return { result: '불일치', hard: true, note: `용량 다름 (기준 ${iv}mL / 업체 ${vv}mL)` };
    if (iv && vv && iv === vv) return { result: '일치', hard: false, note: '' };
    return { result: '미확인', hard: false, note: '업체 품명 별칭 미등록' };
  }

  /* ---------- 현재 Pallet 판정 ---------- */
  function checks() {
    const b = S.base, c = S.cur || {}, out = [];
    if (!b) return out;
    const add = (ok, label, hard) => out.push({ ok, label, hard: !!hard });
    if (c.inboundNo) add(c.inboundNo === b.inboundNo, c.inboundNo === b.inboundNo ? '입고번호 일치' : `입고번호 다름 (${c.inboundNo})`, c.inboundNo !== b.inboundNo);
    else add(false, '입고번호를 읽지 못함 · 아래에서 확인', true);
    if (c.itemCode) add(c.itemCode === b.itemCode, c.itemCode === b.itemCode ? '품목코드 일치' : `품목코드 다름 (${c.itemCode})`, c.itemCode !== b.itemCode);
    // stop: 저장 전에 한 번 묻는다 (확인필요로 표시하지는 않는다). 마지막 Pallet처럼 수량이 다른 경우가 있어 hard로 두지 않는다.
    const stop = (label) => out.push({ ok: false, label, hard: false, stop: true });
    if (num(c.qty)) { if (num(c.qty) === num(b.qty)) add(true, 'WMS 수량 기준과 같음', false); else stop(`WMS 수량 ${fmt(c.qty)} (기준 ${fmt(b.qty)})`); }
    else add(false, 'WMS 수량 없음', false);
    if (num(c.vQty) && num(c.qty)) add(num(c.vQty) === num(c.qty), num(c.vQty) === num(c.qty) ? '업체 수량 일치' : `업체 수량 ${fmt(c.vQty)} ≠ WMS ${fmt(c.qty)}`, num(c.vQty) !== num(c.qty));
    else if (num(c.vQty) && num(b.qty) && num(c.vQty) !== num(b.qty)) stop(`업체 수량 ${fmt(c.vQty)} (기준 ${fmt(b.qty)}) · WMS 수량 없음`);
    const vm = vendorMatch(S.items[b.itemCode], c.vProduct);
    if (c.vProduct) add(vm.result === '일치', vm.result === '일치' ? '업체 품명 일치' : `업체 품명 ${vm.result}${vm.note ? ' · ' + vm.note : ''}`, vm.hard);
    if (!photos.vendor && !c.vendorPhotoKept) add(false, '업체 라벨 사진 없음', false);
    const ss = c.pallet ? savedState(Number(c.pallet)) : '';
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
  function savedState(n) {
    const b = S.base; if (!b) return '';
    const j = R.queue.find(b.inboundNo + '|' + n, 'inspect');
    if (j) return j.state === 'sending' ? 'pending' : j.state;
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
          ${shotBtn('wms', '① WMS 라벨', c.wmsDone)}
          ${shotBtn('vendor', '② 업체 라벨', c.vendorDone)}
        </div>
        <div class="grid g2">
          ${field('cPallet', 'Pallet 번호', c.pallet, { num: true, ph: hintNext(), cls: 'key' + (c.pallet ? '' : ' need') })}
          ${field('cInbound', '입고번호', c.inboundNo, { num: true, cls: b && c.inboundNo && c.inboundNo !== b.inboundNo ? 'bad' : '' })}
          ${field('cItem', '품목코드', c.itemCode, { num: true })}
          ${field('cQty', 'WMS 수량', c.qty, { num: true })}
          ${field('cVProduct', '업체 품명', c.vProduct)}
          ${field('cVQty', '업체 수량', c.vQty, { num: true })}
          ${field('cVDate', '업체 생산일자', c.vDate, { ph: 'yyyy-mm-dd' })}
          ${field('cVPallet', '업체 P-번호', c.vPallet)}
        </div>
        ${b && !c.inboundNo && c.wmsDone ? `<button type="button" class="btn ghost" id="useBaseInbound">입고번호 ${esc(b.inboundNo)}가 맞습니다</button>` : ''}
        <div class="checks" id="checksBox"></div>
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
  function refreshChecks() {
    const box = $('checksBox'), btn = $('saveBtn'); if (!box || !btn) return;
    const ck = checks(), hard = ck.some((x) => !x.ok && x.hard), c = S.cur || {};
    box.innerHTML = checksHtml(ck);
    btn.disabled = !canSave(); btn.classList.toggle('warn', hard);
    btn.textContent = busy.wms || busy.vendor ? '글자 읽는 중…' : (hard ? '확인필요로 저장' : '저장') + (c.pallet ? ' · P' + c.pallet : '');
  }
  function refreshProgress() {
    const box = $('progBox'); if (!box) return;
    box.innerHTML = progressHtml();
    box.querySelectorAll('[data-pc]').forEach((b) => { b.onclick = () => palletChip(Number(b.dataset.pc)); });
  }

  function shotBtn(kind, label, done) {
    // 업체 라벨은 높이 붙어 있어 확대 카메라로 찍는다 (안 되면 그 안의 '기본 카메라')
    if (kind === 'vendor' && R.zoomcam && R.zoomcam.supported) return `<button type="button" class="shot ${done ? 'done' : ''}" data-zoom="vendor"><span class="ic">${busy[kind] ? '…' : done ? '✓' : '🔍'}</span><span>${label}${busy[kind] ? ' 읽는 중' : done ? ' 다시' : ' 확대 촬영'}</span>${photos[kind] ? `<img src="${photos[kind]}" alt="">` : ''}</button><input type="file" accept="image/*" capture="environment" data-shot="vendor" id="vendorFile" hidden>`;
    return `<label class="shot ${done ? 'done' : ''}"><input type="file" accept="image/*" capture="environment" data-shot="${kind}" hidden>
      <span class="ic">${busy[kind] ? '…' : done ? '✓' : '📷'}</span><span>${label}${busy[kind] ? ' 읽는 중' : done ? ' 다시' : ' 촬영'}</span>${photos[kind] ? `<img src="${photos[kind]}" alt="">` : ''}</label>`;
  }
  function lastSaved() { return Math.max(0, ...Object.keys(S.saved).map(Number), ...R.queue.list((j) => S.base && j.key.indexOf(S.base.inboundNo + '|') === 0).map((j) => Number(j.key.split('|')[1]))); }
  function hintNext() {
    const n = lastSaved();
    return n ? '다음은 아마 ' + (n + 1) : '';
  }
  function blankCur() { return { pallet: '', palletTo: '', palletNote: '', palletNoteFor: '', inboundNo: '', itemCode: '', qty: '', vProduct: '', vQty: '', vDate: '', vTime: '', vLot: '', vLine: '', vPallet: '', note: '', ocrRaw: '', vOcrRaw: '', codeRaw: '', wmsDone: false, vendorDone: false, status: '', supplier: '', manufacturer: '', unit: '', inboundDate: '', expiryDate: '', productOcr: '' }; }
  function canSave() { const c = S.cur || {}; return !!(Number(digits(c.pallet)) && c.inboundNo && photos.wms && !busy.wms && !busy.vendor && (S.base || c.itemCode)); }

  function readCur() {
    const c = S.cur; if (!c || !$('cPallet')) return;
    c.pallet = digits($('cPallet').value).replace(/^0+(?=\d)/, ''); c.inboundNo = digits($('cInbound').value); c.itemCode = digits($('cItem').value);
    c.qty = digits($('cQty').value); c.vProduct = $('cVProduct').value.trim(); c.vQty = digits($('cVQty').value);
    c.vDate = $('cVDate').value.trim(); c.vPallet = $('cVPallet').value.trim(); c.note = $('cNote').value;
    persist();
  }
  function bindPallet() {
    bindShots();
    ['cPallet', 'cInbound', 'cItem', 'cQty', 'cVProduct', 'cVQty', 'cVDate', 'cVPallet', 'cNote'].forEach((id) => $(id).addEventListener('input', () => { readCur(); refreshChecks(); }));
    const ub = $('useBaseInbound'); if (ub) ub.onclick = () => { S.cur.inboundNo = S.base.inboundNo; persist(); render(); };
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
  async function handleShot(kind, file) {
        const st = $('ocrStatus');
        if (st) { st.textContent = '사진 준비 중…'; st.dataset.type = 'warn'; } // OCR 파일(전역 setStatus)이 안 읽혀도 촬영은 되게
        const forOcr = await R.shrink(file, 2000, 0.85), stored = forOcr ? await R.shrink(forOcr, 1400, 0.72) : '';
        if (!forOcr || !stored) { if (st) st.textContent = '사진을 열지 못했습니다 · 다시 찍어 주세요'; R.toast('사진을 열지 못했습니다 (' + (file.type || '형식 알 수 없음') + '). 다시 찍어 주세요. 계속되면 설정 > 카메라 > 포맷 > 높은 호환성', 'crit'); return; }
        photos[kind] = stored;
        readCur(); const cur = S.cur; cur[kind + 'Done'] = true; cur.status = '글자 읽는 중…'; busy[kind] = true; render();
        try {
          const r = await R.ocr.read(forOcr, kind === 'vendor' ? 'vendor' : 'wms', $('ocrStatus'));
          busy[kind] = false;
          if (S.cur === cur) applyOcr(kind, r); // 그 사이 저장·다시 찍기를 했으면 버린다
        } catch (e) {
          busy[kind] = false;
          if (S.cur === cur) { cur.status = e.message; R.toast(e.message, 'warn'); render(); }
        }
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

  function applyOcr(kind, r) {
    const p = r.parsed || {};
    const pc = palletCheck(p, r.text), pal = pc.pallet;
    const c = S.cur;
    if (kind === 'wms') {
      // 읽지 못한 칸은 비워 둔다. 기준값으로 채우지 않는다.
      Object.assign(c, { pallet: pal || '', palletTo: pc.to, palletNote: pal ? pc.note : '', palletNoteFor: pal, inboundNo: digits(p.inboundNo), itemCode: digits(p.itemCode), qty: digits(p.displayQty), ocrRaw: r.text, codeRaw: p.codeRaw || '',
        supplier: p.supplier || '', manufacturer: p.manufacturer || '', unit: p.unit || '', inboundDate: p.inboundDate || '', expiryDate: p.expiryDate || '', productOcr: p.product || '' });
      c.status = `${R.ocr.lastEngine} 완료` + (pal ? (pc.note ? ' · ' + pc.note : '') : pc.note ? ` · Pallet 번호 확인 필요 (${pc.note}), 직접 입력` : ' · Pallet 번호를 못 읽음, 직접 입력');
    } else {
      Object.assign(c, { vProduct: p.product || '', vQty: digits(p.qty), vDate: p.prodDate || '', vTime: p.prodTime || '', vLot: p.lotNo || '', vLine: p.line || '', vPallet: p.palletNo || '', vOcrRaw: r.text });
      c.status = `업체 라벨 ${R.ocr.lastEngine} 완료`;
    }
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
    const b = S.base, c = S.cur, ck = checks(), bad = ck.filter((x) => !x.ok && x.hard), warn = ck.filter((x) => !x.ok && !x.hard);
    if (!canSave()) return;
    if (savedState(Number(c.pallet)) && !confirm(`P${c.pallet}는 이미 ${savedState(Number(c.pallet)) === 'done' ? '저장되어' : '이 폰 대기열에'} 있습니다. 그래도 보낼까요? (서버가 중복으로 막습니다)`)) return;
    if (bad.length && !confirm('기준과 다른 값이 있습니다.\n\n' + bad.map((x) => '· ' + x.label).join('\n') + '\n\n확인필요로 저장할까요? (값을 고치려면 취소)')) return;
    const stops = warn.filter((x) => x.stop);
    if (stops.length && !confirm('저장 전에 확인하세요.\n\n' + stops.map((x) => '· ' + x.label).join('\n') + '\n\n이대로 저장할까요? (값을 고치려면 취소)')) return;
    const item = S.items[b.itemCode] || S.items[c.itemCode], vm = vendorMatch(item, c.vProduct);
    const qtyResult = num(c.vQty) && num(c.qty) ? (num(c.vQty) === num(c.qty) ? '일치' : '불일치') : '';
    const reasons = bad.concat(warn).map((x) => x.label);
    const payload = {
      inboundNo: c.inboundNo, inboundDate: b.inboundDate, product: (S.items[c.itemCode] || item || {}).itemName || b.product, itemCode: c.itemCode || b.itemCode,
      manufacturer: b.manufacturer, supplier: b.supplier, displayQty: c.qty, unit: b.unit || 'EA', expiryDate: b.expiryDate,
      containerFrom: c.pallet, containerTo: c.pallet, codeRaw: c.codeRaw || (c.inboundNo + '-' + String(c.pallet).padStart(4, '0')),
      infoMatch: c.inboundNo === b.inboundNo && (!c.itemCode || c.itemCode === b.itemCode) ? '일치' : '불일치', mixed: c.itemCode && c.itemCode !== b.itemCode ? '있음' : '없음',
      actualQty: c.vQty || c.qty, qtyResult, finalResult: bad.length ? '확인필요' : '적합',
      note: [c.note, reasons.length ? '확인: ' + reasons.join(', ') : '', 'R15'].filter(Boolean).join(' / '),
      ocrRaw: c.ocrRaw, labelMatch: vm.result,
      vendorProduct: c.vProduct, vendorQty: c.vQty, vendorProdDate: c.vDate, vendorProdTime: c.vTime, vendorLotNo: c.vLot, vendorLine: c.vLine,
      vendorOcrRaw: c.vOcrRaw, vendorPalletNo: c.vPallet, dateKey: today().replace(/-/g, '')
    };
    await R.queue.addInspect(payload, { wms: photos.wms, vendor: photos.vendor }, { label: `${c.inboundNo} P${c.pallet}` });
    R.toast(`P${c.pallet} 단말에 보관 · 서버로 보내는 중`, 'ok');
    S.cur = blankCur(); photos.wms = ''; photos.vendor = ''; persist(); render();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function palletChip(n) {
    const j = R.queue.find(S.base.inboundNo + '|' + n, 'inspect');
    if (j && j.state === 'blocked') return R.showJob(j);
    if (j) return R.toast(`P${n} · ${j.state === 'done' ? '서버 완료' : '단말 보관 · ' + (j.lastError || '전송 대기')}`, j.state === 'done' ? 'ok' : 'warn');
    if (S.saved[n]) return R.toast(`P${n} 서버 완료`, 'ok');
    R.toast(`P${n} 아직 저장 안 됨`, 'warn');
  }

  function endVehicle() {
    const pend = R.queue.list((j) => j.type === 'inspect' && j.key.indexOf(S.base.inboundNo + '|') === 0 && j.state !== 'done').length;
    if (!confirm(pend ? `아직 서버에 안 올라간 Pallet가 ${pend}건 있습니다. 차량을 종료해도 대기열에서 계속 보냅니다. 종료할까요?` : `입고번호 ${S.base.inboundNo} 차량을 종료할까요?`)) return;
    S.base = null; S.cur = null; S.saved = {}; photos.wms = ''; photos.vendor = ''; persist(); render();
  }

  R.on('queue', refreshProgress);
  R.on('login', () => { loadItems().then(render); if (S.base) refreshSaved(); });
  R.inspect.init = function () { load(); render(); };
  R.inspect.render = render;
  R.inspect.refreshSaved = refreshSaved;
})();
