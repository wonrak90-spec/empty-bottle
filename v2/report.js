/* R15 보고서 · 추적 탭
 * 보고서 양식은 하나다: 입고번호 1건 = 보고서 1장 (+ 사진 장).
 * 서버(r15Report)가 기록마다 '데이터 점검' 결과를 붙여 주므로, 화면은 그것을 보여 주기만 한다.
 * R14의 v22/v23/v24/v58 보고서 4벌은 쓰지 않는다.
 */
(function () {
  'use strict';
  const R = window.R15, { $, esc, fmt, num, today, pad } = R.util;
  const P = R.report = { view: 'week', from: '', to: '', data: null, detail: null, sel: new Set(), sub: 'summary' };

  const ISSUE_NAMES = {
    NO_INBOUND: '입고번호 없음', NO_PALLET: 'Pallet 번호 없음', DUPLICATE: '같은 Pallet 중복 저장', CODE_MISMATCH: '라벨 바코드와 저장 번호 다름',
    NO_WMS_PHOTO: 'WMS 사진 없음', NO_VENDOR_PHOTO: '업체 사진 없음', NO_QTY: 'WMS 수량 없음', QTY_MISMATCH: 'WMS·업체 수량 불일치',
    NO_ITEM: '품목코드 없음', UNKNOWN_ITEM: '기준정보에 없는 품목', NAME_DIFF: '품명 표기 오류(정식명으로 표시)', NOT_COMPARED: '업체 라벨 미대조',
    JUDGED_CHECK: '확인필요 판정(사유 미기록)'
  };
  const LEVEL_ORDER = { error: 0, warn: 1, info: 2 };

  /* ---------- 기간 ---------- */
  function ymd(d) { return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }
  function parse(s) { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); }
  function setPeriod(view, anchor) {
    const a = anchor ? parse(anchor) : new Date(); P.view = view;
    if (view === 'day') { P.from = P.to = ymd(a); }
    else if (view === 'week') { const s = new Date(a); s.setDate(a.getDate() - ((a.getDay() + 6) % 7)); const e = new Date(s); e.setDate(s.getDate() + 6); P.from = ymd(s); P.to = ymd(e); }
    else if (view === 'month') { P.from = ymd(new Date(a.getFullYear(), a.getMonth(), 1)); P.to = ymd(new Date(a.getFullYear(), a.getMonth() + 1, 0)); }
  }
  function shift(dir) {
    const a = parse(P.from);
    if (P.view === 'day') a.setDate(a.getDate() + dir); else if (P.view === 'week') a.setDate(a.getDate() + 7 * dir); else if (P.view === 'month') a.setMonth(a.getMonth() + dir);
    else { const len = Math.round((parse(P.to) - parse(P.from)) / 86400000) + 1; a.setDate(a.getDate() + len * dir); const b = new Date(a); b.setDate(a.getDate() + len - 1); P.from = ymd(a); P.to = ymd(b); return; }
    setPeriod(P.view, ymd(a));
  }
  const label = () => { const md = (d) => d.slice(5).replace('-', '.'); return P.from === P.to ? P.from : P.from.slice(0, 4) === P.to.slice(0, 4) ? `${P.from.slice(0, 4)}. ${md(P.from)} ~ ${md(P.to)}` : `${P.from} ~ ${P.to}`; };

  // 마지막으로 본 기간은 폰에 남겨 두고 먼저 보여 준 뒤, 서버 응답이 오면 바꾼다 (Apps Script 응답이 몇 초씩 걸린다)
  const CK = 'r15.report';
  async function load() {
    const key = P.from + '|' + P.to, seq = (P.seq = (P.seq || 0) + 1);
    let cached = null; try { const c = JSON.parse(localStorage.getItem(CK) || 'null'); if (c && c.key === key && R.user && c.user === R.user.name) cached = c.data; } catch (_) {}
    if (cached && !P.detail) { P.data = cached; renderBody(); const h = $('repBody'); if (h) h.insertAdjacentHTML('afterbegin', '<div class="muted small" id="repStale">최신 내용 불러오는 중…</div>'); }
    else if (!cached) $('repBody').innerHTML = '<div class="muted pad">불러오는 중…</div>';
    const r = await R.tryGet('r15Report', { from: P.from, to: P.to });
    if (seq !== P.seq) return; // 늦게 도착한 이전 기간 응답은 버린다
    if (!r || !r.ok) { const st = $('repStale'); if (st) st.textContent = '서버에 연결하지 못해 마지막으로 받은 내용을 보여 줍니다'; if (cached) return; }
    if (r && r.ok) try { localStorage.setItem(CK, JSON.stringify({ key, user: R.user && R.user.name, data: r })); } catch (_) {}
    P.data = r; P.inCache = {}; P.sel.clear(); if (P.detail) { const no = P.detail.summary && P.detail.summary.inboundNo; P.detail = null; if (no && r && r.inbounds && r.inbounds.some((x) => x.inboundNo === no)) { openDetail(no); return; } } renderBody();
  }

  /* ---------- 화면 ---------- */
  function render() {
    const root = $('reportView'); if (!root) return;
    root.innerHTML = `<section>
      <div class="shead"><h2>입고 검수 보고서</h2>
        <div class="vseg" id="repSeg">${['day', 'week', 'month', 'custom'].map((v) => `<button type="button" data-v="${v}" aria-pressed="${P.view === v}">${{ day: '일', week: '주', month: '월', custom: '기간' }[v]}</button>`).join('')}</div></div>
      <div class="wk"><button type="button" class="btn ghost sm" id="repPrev">‹</button><b id="repLabel">${esc(label())}</b><button type="button" class="btn ghost sm" id="repNext">›</button><button type="button" class="btn ghost sm" id="repToday">오늘</button></div>
      <div class="grid g2" id="repCustom" ${P.view === 'custom' ? '' : 'hidden'}><label>시작<input type="date" id="repFrom" value="${P.from}"></label><label>끝<input type="date" id="repTo" value="${P.to}"></label></div>
    </section>
    <div id="repBody"></div>`;
    document.querySelectorAll('#repSeg [data-v]').forEach((b) => { b.onclick = () => { if (b.dataset.v === 'custom') P.view = 'custom'; else setPeriod(b.dataset.v, P.from || today()); render(); load(); }; });
    $('repPrev').onclick = () => { shift(-1); render(); load(); };
    $('repNext').onclick = () => { shift(1); render(); load(); };
    $('repToday').onclick = () => { setPeriod(P.view === 'custom' ? 'week' : P.view); render(); load(); };
    $('repFrom').onchange = $('repTo').onchange = () => { P.from = $('repFrom').value; P.to = $('repTo').value || P.from; if (P.from > P.to) [P.from, P.to] = [P.to, P.from]; $('repLabel').textContent = label(); load(); };
    if (P.data) renderBody();
  }

  function renderBody() {
    const d = P.data, root = $('repBody'); if (!root) return;
    if (!d) { root.innerHTML = '<div class="muted pad">보고서를 불러오지 못했습니다.</div>'; return; }
    if (P.detail) return renderDetail();
    const k = d.kpi;
    root.innerHTML = `${d.trimmed ? `<div class="muted small">기간이 한 달을 넘어 화면에는 확인이 필요한 기록만 보여 줍니다 (전체 ${fmt(d.trimmed)}건). 차량을 누르면 그 차량 전체를 불러오고, CSV는 한 달씩 받아 전체를 만듭니다.</div>` : ''}
      <div class="kpis">
        <div class="kpi"><div class="l">입고 차량</div><div class="v">${k.inbounds}<small> 건</small></div></div>
        <div class="kpi"><div class="l">검수 Pallet</div><div class="v">${fmt(k.pallets)}<small> 개</small></div><div class="d">${fmt(k.qty)} EA</div></div>
        <div class="kpi ${k.errorRecords ? 'crit' : ''}"><div class="l">오류 있는 기록</div><div class="v">${k.errorRecords}<small> 건</small></div><div class="d">주의 ${k.warnRecords}건</div></div>
        <div class="kpi ${k.gapPallets ? 'warn' : ''}"><div class="l">번호 빠진 Pallet</div><div class="v">${k.gapPallets}<small> 개</small></div></div>
        <div class="kpi"><div class="l">생산 작업</div><div class="v">${k.lots}<small> 건</small></div></div>
      </div>
      <div class="tabs sub2" id="repSub">${[['summary', '수불 현황'], ['inbound', '입고번호별'], ['issues', '데이터 점검']].map(([v, t]) => `<button type="button" data-s="${v}" aria-pressed="${P.sub === v}">${t}${v === 'issues' && (k.errorRecords + k.warnRecords) ? ` <span class="cnt2">${k.errorRecords + k.warnRecords}</span>` : ''}</button>`).join('')}</div>
      <div id="repSubBody"></div>`;
    document.querySelectorAll('#repSub [data-s]').forEach((b) => { b.onclick = () => { P.sub = b.dataset.s; renderBody(); }; });
    ({ summary: renderSupply, inbound: renderInbounds, issues: renderIssues })[P.sub]();
  }

  function renderSupply() {
    const d = P.data, box = $('repSubBody');
    box.innerHTML = `<section><div class="shead"><h2>품목별 수불</h2><span class="sub">입고·투입은 선택 기간, 가용은 지금 기준(최근 180일 검수분 중 미투입)</span></div>
      <div class="scroll"><table class="mt sup"><thead><tr><th>품목</th><th class="num">기간 입고</th><th class="num">기간 투입</th><th class="num">현재 가용</th></tr></thead><tbody>
      ${d.supply.map((s) => `<tr><td data-l="품목"><b>${esc(s.product)}</b><div class="muted">${esc(s.itemCode || '')}</div></td>
        <td class="num" data-l="기간 입고"><span class="in">+${fmt(s.inPallets) || 0}</span> P<div class="muted">${fmt(s.inQty) || 0} EA</div></td>
        <td class="num" data-l="기간 투입"><span class="out">−${fmt(s.usedPallets) || 0}</span> P<div class="muted">${fmt(s.usedQty) || 0} EA</div></td>
        <td class="num" data-l="현재 가용"><b>${fmt(s.stockPallets) || 0}</b> P<div class="muted">${fmt(s.stockQty) || 0} EA</div></td></tr>`).join('') || '<tr><td colspan="4" class="muted">기록 없음</td></tr>'}
      </tbody></table></div></section>
      ${inboundListHtml(d.inbounds.slice(0, 5), '최근 입고')}`;
    bindInboundList();
  }

  function inboundListHtml(list, title) {
    return `<section><div class="shead"><h2>${esc(title)}</h2>
      <div class="right"><button type="button" class="btn ghost sm" id="repSelAll">전체 선택</button><button type="button" class="btn sm" id="repPrint" ${P.sel.size ? '' : 'disabled'}>선택 ${P.sel.size}건 인쇄</button></div></div>
      <div class="list">${list.map((x) => `<div class="ib">
        <label class="cb"><input type="checkbox" data-sel="${esc(x.inboundNo)}" ${P.sel.has(x.inboundNo) ? 'checked' : ''} aria-label="${esc(x.inboundNo)} 선택"></label>
        <button type="button" class="ibb" data-open="${esc(x.inboundNo)}">
          <span class="ibt"><b>${esc(x.inboundNo || '입고번호 없음')}</b> ${esc(x.product)}</span>
          <span class="muted">${esc(x.days.join(', '))} · ${esc(x.supplier || '')} · ${esc(x.inspectors.join(', '))}</span>
          <span class="ibs">${x.palletCount} Pallet (P${x.gaps.min}~P${x.gaps.max}) · ${fmt(x.qtyTotal)} EA
            ${x.errorCount ? R.pill('error', '오류 ' + x.errorCount) : ''}${x.warnCount ? R.pill('warn', '주의 ' + x.warnCount) : ''}${x.gaps.missing.length ? R.pill('warn', '빠진 번호 ' + x.gaps.missing.length) : ''}${!x.errorCount && !x.warnCount && !x.gaps.missing.length ? R.pill('ok', '이상 없음') : ''}${x.usedCount ? R.pill('idle', '투입 ' + x.usedCount) : ''}</span>
        </button></div>`).join('') || '<div class="muted">기간 안에 입고 기록이 없습니다.</div>'}</div>
      ${title === '최근 입고' && P.data.inbounds.length > 5 ? '<button type="button" class="btn ghost sm" id="repMore">입고번호 전체 보기</button>' : ''}
      </section>`;
  }
  function bindInboundList() {
    document.querySelectorAll('[data-sel]').forEach((c) => { c.onchange = () => { c.checked ? P.sel.add(c.dataset.sel) : P.sel.delete(c.dataset.sel); updPrint(); }; });
    document.querySelectorAll('[data-open]').forEach((b) => { b.onclick = () => openDetail(b.dataset.open); });
    const all = $('repSelAll'); if (all) all.onclick = () => { const on = P.sel.size < P.data.inbounds.length; P.sel.clear(); if (on) P.data.inbounds.forEach((x) => P.sel.add(x.inboundNo)); document.querySelectorAll('[data-sel]').forEach((c) => { c.checked = P.sel.has(c.dataset.sel); }); updPrint(); };
    const pr = $('repPrint'); if (pr) pr.onclick = () => printInbounds([...P.sel]);
    const more = $('repMore'); if (more) more.onclick = () => { P.sub = 'inbound'; renderBody(); };
  }
  function updPrint() { const b = $('repPrint'); if (b) { b.disabled = !P.sel.size; b.textContent = `선택 ${P.sel.size}건 인쇄`; } }

  function renderInbounds() {
    $('repSubBody').innerHTML = inboundListHtml(P.data.inbounds, `입고번호 ${P.data.inbounds.length}건`) +
      `<section><div class="shead"><h2>내려받기</h2></div><div><button type="button" class="btn ghost" id="repCsv">기간 기록 엑셀(CSV)</button></div></section>`;
    bindInboundList(); $('repCsv').onclick = csv;
  }

  function renderIssues() {
    const d = P.data, groups = {}, mgr = R.isManager();
    const acked = [];
    d.records.forEach((r) => r.issues.forEach((x) => { if (x.level === 'info') return; if (x.acked) { acked.push({ r, x }); return; } (groups[x.code] = groups[x.code] || { level: x.level, list: [] }).list.push({ r, x }); }));
    const codes = Object.keys(groups).sort((a, b) => LEVEL_ORDER[groups[a].level] - LEVEL_ORDER[groups[b].level] || groups[b].list.length - groups[a].list.length);
    const gaps = d.inbounds.filter((x) => x.gaps.missing.length);
    $('repSubBody').innerHTML = `<section><div class="shead"><h2>데이터 점검</h2><span class="sub">저장된 값 자체의 문제입니다. 항목을 누르면 해당 기록이 나옵니다.${R.rank() >= 1 ? ' 고칠 권한이 있는 기록은 바로 고칠 수 있습니다.' : ''}</span></div>
      ${codes.length || gaps.length ? '' : '<div class="muted">문제 없음</div>'}
      ${gaps.length ? `<details class="iss"><summary>${R.pill('warn', gaps.reduce((t, x) => t + x.gaps.missing.length, 0) + '개')} Pallet 번호가 중간에 빠짐</summary>
        <div class="list">${gaps.map((x) => `<button type="button" class="row" data-open="${esc(x.inboundNo)}"><span><b>${esc(x.inboundNo)}</b> ${esc(x.product)}</span><span class="muted">P${x.gaps.min}~P${x.gaps.max} 중 ${x.gaps.missing.length > 12 ? x.gaps.missing.length + '개' : x.gaps.missing.map((n) => 'P' + n).join(' ')} 없음</span></button>`).join('')}</div></details>` : ''}
      ${codes.map((c) => `<details class="iss"><summary>${R.pill(groups[c].level, groups[c].list.length + '건')} ${esc(ISSUE_NAMES[c] || c)}</summary>
        ${mgr ? `<div class="bulk"><span class="sub">값이 맞으면 확인 처리, 틀렸으면 고치기</span><button type="button" class="btn ghost sm" data-ackall="${esc(c)}">${groups[c].list.length}건 모두 확인 처리</button></div>` : ''}
        <div class="list">${groups[c].list.map(({ r, x }) => `<div class="row"><button type="button" class="lnk" data-open="${esc(r.inboundNo)}"><b>${esc(r.inboundNo || '번호 없음')}</b> P${esc(r.pallet || '?')} <span class="muted">${esc(r.atText)} · ${esc(x.label)}</span></button>${mgr ? `<button type="button" class="btn ghost sm" data-ack="${esc(r.id)}|${esc(c)}">확인 처리</button>` : ''}${R.rec.actionsHtml(r)}</div>`).join('')}</div></details>`).join('')}
      ${acked.length ? `<details class="iss"><summary>${R.pill('ok', acked.length + '건')} 확인 처리된 점검</summary>
        <div class="list">${acked.map(({ r, x }) => `<div class="row"><button type="button" class="lnk" data-open="${esc(r.inboundNo)}"><b>${esc(r.inboundNo || '번호 없음')}</b> P${esc(r.pallet || '?')} <span class="muted">${esc(x.label)} · ${esc(x.acked.by)} ${esc(x.acked.at)} · ${esc(x.acked.reason)}</span></button>${mgr ? `<button type="button" class="btn ghost sm" data-unack="${esc(r.id)}|${esc(x.code)}">처리 취소</button>` : ''}</div>`).join('')}</div></details>` : ''}
    </section>`;
    const byId = (id) => d.records.find((r) => r.id === id);
    document.querySelectorAll('[data-ackall]').forEach((b) => { b.onclick = () => { const c = b.dataset.ackall; R.rec.ack(groups[c].list.map((g) => g.r), [c], ISSUE_NAMES[c] || c, afterChange); }; });
    document.querySelectorAll('[data-ack],[data-unack]').forEach((b) => { b.onclick = () => { const un = !!b.dataset.unack, [id, c] = (b.dataset.ack || b.dataset.unack).split('|'); R.rec.ack([byId(id)], [c], ISSUE_NAMES[c] || c, afterChange, un); }; });
    document.querySelectorAll('[data-open]').forEach((b) => { b.onclick = () => openDetail(b.dataset.open); });
    R.rec.bind($('repSubBody'), d.records, afterChange);
  }

  /* ---------- 입고번호 상세 ---------- */
  // 한 달이 넘는 기간은 서버가 문제 있는 기록만 보낸다(trimmed). 그때 차량 상세·인쇄는 그 입고번호만 따로 읽는다.
  async function recsOf(no) {
    if (!P.data.trimmed) return P.data.records.filter((r) => r.inboundNo === no);
    P.inCache = P.inCache || {};
    if (!P.inCache[no]) { const r = await R.tryGet('r15Inbound', { inboundNo: no }); P.inCache[no] = (r && r.records) || P.data.records.filter((x) => x.inboundNo === no); }
    return P.inCache[no];
  }
  async function openDetail(no) {
    const recs = await recsOf(no);
    P.detail = { summary: P.data.inbounds.find((x) => x.inboundNo === no), records: recs }; renderDetail(); window.scrollTo({ top: 0 });
  }
  function renderDetail() {
    const { summary: s, records } = P.detail, root = $('repBody');
    root.innerHTML = `<section>
      <div class="shead"><button type="button" class="btn ghost sm" id="detBack">‹ 목록</button><div class="right"><button type="button" class="btn ghost sm" id="detPhotos">사진 보기</button><button type="button" class="btn sm" id="detPrint">인쇄</button></div></div>
      <div><div class="sub">입고번호</div><div class="big">${esc(s.inboundNo || '번호 없음')}</div><div class="vline"><b>${esc(s.product)}</b> · ${esc(s.supplier)} · 입고일 ${esc(s.inboundDate)} · 사용기한 ${esc(s.expiryDate)}</div></div>
      <div class="kpis small">
        <div class="kpi"><div class="l">Pallet</div><div class="v">${s.palletCount}</div><div class="d">P${s.gaps.min}~P${s.gaps.max}</div></div>
        <div class="kpi"><div class="l">총 수량</div><div class="v">${fmt(s.qtyTotal)}</div></div>
        <div class="kpi"><div class="l">이상 없음</div><div class="v">${s.okCount}</div></div>
        <div class="kpi ${s.errorCount ? 'crit' : ''}"><div class="l">오류 / 주의</div><div class="v">${s.errorCount} / ${s.warnCount}</div></div>
        <div class="kpi"><div class="l">생산 투입</div><div class="v">${s.usedCount}</div><div class="d">${esc(s.lots.join(', '))}</div></div>
      </div>
      ${records.some((r) => r.can && r.can.del) ? `<div class="bulk"><label class="chk"><input type="checkbox" id="detAll"> 지울 수 있는 기록 모두 선택</label><button type="button" class="btn ghost sm danger" id="detDelSel" disabled>선택 0건 삭제</button></div>` : ''}
      ${s.gaps.missing.length ? `<div class="warnbox">기록 없는 Pallet 번호: ${s.gaps.missing.map((n) => 'P' + n).join(', ')}</div>` : ''}
      <div class="scroll"><table class="mt det"><thead><tr><th>P</th><th class="num">WMS 수량</th><th class="num">업체 수량</th><th>업체 생산일</th><th>판정</th><th>점검</th><th>사진</th><th>투입</th><th>관리</th></tr></thead><tbody>
      ${records.map((r) => `<tr class="lv-${r.level}"><td data-l="Pallet">${r.can && r.can.del ? `<input type="checkbox" class="dsel" data-dsel="${esc(r.id)}" aria-label="P${esc(r.pallet)} 선택"> ` : ''}<b>P${esc(r.pallet || '?')}</b><div class="muted">${esc(r.atText.slice(5))} ${esc(r.inspector)}</div></td>
        <td class="num" data-l="WMS 수량">${fmt(r.qty)}</td><td class="num" data-l="업체 수량">${fmt(r.vendorQty)}</td>
        <td data-l="업체 생산일" class="${r.vendorProdDate ? '' : 'e'}">${esc(r.vendorProdDate)} ${esc(r.vendorProdTime)}</td>
        <td data-l="판정">${R.pill(/적합/.test(r.finalResult) ? 'ok' : 'warn', r.finalResult || '-')}</td>
        <td data-l="점검" class="${r.issues.some((x) => x.level !== 'info') ? 'wide2' : 'e'}">${r.issues.filter((x) => x.level !== 'info').map((x) => x.acked ? `<div class="muted"><s>${esc(x.label)}</s> 확인됨 · ${esc(x.acked.by)} · ${esc(x.acked.reason)}</div>` : `<div class="iss-${x.level}">${esc(x.label)}</div>`).join('') || '<span class="muted">-</span>'}${R.isManager() && r.issues.some((x) => x.level !== 'info' && !x.acked) ? `<button type="button" class="btn ghost sm" data-dack="${esc(r.id)}">확인 처리</button>` : ''}</td>
        <td data-l="사진">${r.wmsPhoto ? `<button type="button" class="btn ghost sm" data-ph="${esc(r.wmsPhoto)}" data-cap="${esc(s.inboundNo)} P${esc(r.pallet)} WMS">WMS</button>` : ''}${r.vendorPhoto ? `<button type="button" class="btn ghost sm" data-ph="${esc(r.vendorPhoto)}" data-cap="${esc(s.inboundNo)} P${esc(r.pallet)} 업체">업체</button>` : ''}</td>
        <td data-l="투입" class="${r.usedIn.length ? '' : 'e'}">${r.usedIn.map((u) => esc(u.productName + ' ' + u.lotNo)).join('<br>') || '<span class="muted">-</span>'}</td>
        <td data-l="관리" class="wide2">${R.rec.actionsHtml(r)}${r.can && !r.can.edit && r.can.why && R.user && r.inspector === R.user.name ? `<div class="muted small">${esc(r.can.why)}</div>` : ''}</td></tr>`).join('')}
      </tbody></table></div>
      <div id="detGallery"></div>
    </section>`;
    $('detBack').onclick = () => { P.detail = null; renderBody(); };
    $('detPrint').onclick = () => printInbounds([s.inboundNo]);
    $('detPhotos').onclick = () => gallery(records, $('detGallery'), s.inboundNo);
    bindPhotoButtons(root);
    R.rec.bind(root, records, afterChange);
    root.querySelectorAll('[data-dack]').forEach((b) => { b.onclick = () => { const r = records.find((x) => x.id === b.dataset.dack); R.rec.ack([r], [], r.issues.filter((x) => x.level !== 'info' && !x.acked).map((x) => x.label).join(', '), afterChange); }; });
    // 여러 건 삭제: 사유 한 번, 서버 왕복 한 번
    const boxes = [...root.querySelectorAll('[data-dsel]')], delBtn = $('detDelSel');
    const upd = () => { const n = boxes.filter((b) => b.checked).length; if (delBtn) { delBtn.disabled = !n; delBtn.textContent = `선택 ${n}건 삭제`; } };
    boxes.forEach((b) => { b.onchange = upd; });
    if ($('detAll')) $('detAll').onchange = (e) => { boxes.forEach((b) => { b.checked = e.target.checked; }); upd(); };
    if (delBtn) delBtn.onclick = () => R.rec.delMany(records.filter((r) => boxes.some((b) => b.checked && b.dataset.dsel === r.id)), afterChange);
  }

  function bindPhotoButtons(root) {
    root.querySelectorAll('[data-ph]').forEach((b) => { b.onclick = async () => { R.busy(b, true, '…'); const m = await R.loadPhotos([b.dataset.ph]); R.busy(b, false); if (m[b.dataset.ph]) R.photoViewer(m[b.dataset.ph], b.dataset.cap); else R.toast('사진을 불러오지 못했습니다', 'crit'); }; });
  }
  async function gallery(records, box, no) {
    box.innerHTML = '<div class="muted pad">사진 불러오는 중…</div>';
    const urls = records.flatMap((r) => [r.wmsPhoto, r.vendorPhoto]).filter(Boolean), m = await R.loadPhotos(urls);
    box.innerHTML = `<div class="gal">${records.map((r) => `<figure><div class="gp">${[['WMS', r.wmsPhoto], ['업체', r.vendorPhoto]].map(([t, u]) => u && m[u] ? `<img src="${m[u]}" alt="${esc(no)} P${esc(r.pallet)} ${t}" data-big="${esc(u)}">` : `<div class="noimg">${t} 사진 없음</div>`).join('')}</div><figcaption>P${esc(r.pallet)}</figcaption></figure>`).join('')}</div>`;
    box.querySelectorAll('[data-big]').forEach((im) => { im.onclick = () => R.photoViewer(im.src, im.alt); });
  }

  /* ---------- 인쇄 ---------- */
  function printCss() {
    return `<style>@page{size:A4;margin:10mm}*{box-sizing:border-box}body{font-family:'Malgun Gothic','Apple SD Gothic Neo',sans-serif;color:#111;margin:0;font-size:10px}
      .sheet{page-break-after:always}.sheet:last-child{page-break-after:auto}h1{font-size:17px;margin:0 0 6px;padding-bottom:6px;border-bottom:2px solid #111}
      .meta{display:flex;justify-content:space-between;color:#555;margin-bottom:8px}table{width:100%;border-collapse:collapse;margin:6px 0}th,td{border:1px solid #999;padding:3px 5px;vertical-align:top}
      th{background:#eee;text-align:left}td.j{white-space:nowrap}.num{text-align:right}.info th{width:18%}.kp{display:grid;grid-template-columns:repeat(5,1fr);gap:4px;margin:6px 0}.kp div{border:1px solid #999;padding:5px}.kp b{display:block;font-size:14px}
      .bad{color:#b00;font-weight:700}.warn{color:#8a5a00}.box{border:1px solid #c66;background:#fff4f4;padding:5px;margin:6px 0}tr{break-inside:avoid}
      .sign{display:flex;justify-content:flex-end;gap:0;margin-top:10px}.sign div{width:80px;border:1px solid #999;text-align:center}.sign div b{display:block;background:#eee;border-bottom:1px solid #999;padding:2px}.sign div span{display:block;height:40px}
      .ph{display:grid;grid-template-columns:1fr 1fr;gap:5px}.ph figure{margin:0;border:1px solid #bbb;padding:3px;break-inside:avoid}.ph img{width:100%;height:76mm;object-fit:contain;display:block}.ph figcaption{text-align:center;font-size:9px}
      .noimg{height:76mm;display:flex;align-items:center;justify-content:center;color:#999;border:1px dashed #ccc}</style>`;
  }
  function sheetHtml(s, recs, ph) {
    const rows = recs.map((r) => `<tr><td>P${esc(r.pallet || '?')}</td><td>${esc(r.atText)}</td><td class="num">${fmt(r.qty)}</td><td class="num">${fmt(r.vendorQty)}</td><td>${esc(r.vendorProdDate)}</td><td>${esc(String(r.vendorProduct || '').slice(0, 30))}</td>
      <td class="j ${/적합/.test(r.finalResult) ? '' : 'bad'}">${esc(r.finalResult)}</td><td>${r.issues.filter((x) => x.level !== 'info').map((x) => `<span class="${x.level === 'error' ? 'bad' : 'warn'}">${esc(x.label)}</span>`).join('<br>')}</td><td>${r.usedIn.map((u) => esc(u.lotNo)).join(', ')}</td></tr>`).join('');
    const photoPages = ph ? chunk(recs, 3).map((g) => `<section class="sheet"><h1>${esc(s.inboundNo)} 증빙 사진</h1><div class="ph">${g.map((r) => [['WMS 라벨', r.wmsPhoto], ['업체 라벨', r.vendorPhoto]].map(([t, u]) => `<figure>${u && ph[u] ? `<img src="${ph[u]}">` : '<div class="noimg">사진 없음</div>'}<figcaption>P${esc(r.pallet)} ${t}</figcaption></figure>`).join('')).join('')}</div></section>`).join('') : '';
    return `<section class="sheet"><h1>공병 입고 검수 보고서</h1><div class="meta"><span>입고번호 <b>${esc(s.inboundNo)}</b></span><span>출력 ${esc(new Date().toLocaleString('ko-KR'))} · ${esc(R.user ? R.user.name : '')}</span></div>
      <table class="info"><tr><th>품명</th><td>${esc(s.product)}</td><th>품목코드</th><td>${esc(s.itemCode)}</td></tr><tr><th>공급업체</th><td>${esc(s.supplier)}</td><th>제조원</th><td>${esc(s.manufacturer)}</td></tr>
      <tr><th>입고일자</th><td>${esc(s.inboundDate)}</td><th>사용기한</th><td>${esc(s.expiryDate)}</td></tr><tr><th>검수일</th><td>${esc(s.days.join(', '))}</td><th>검수자</th><td>${esc(s.inspectors.join(', '))}</td></tr></table>
      <div class="kp"><div>Pallet<b>${s.palletCount}</b></div><div>총 수량<b>${fmt(s.qtyTotal)}</b></div><div>이상 없음<b>${s.okCount}</b></div><div>오류 / 주의<b>${s.errorCount} / ${s.warnCount}</b></div><div>생산 투입<b>${s.usedCount}</b></div></div>
      ${s.gaps.missing.length ? `<div class="box">기록 없는 Pallet 번호: ${s.gaps.missing.map((n) => 'P' + n).join(', ')}</div>` : ''}
      <table><thead><tr><th>P</th><th>검수 시각</th><th class="num">WMS 수량</th><th class="num">업체 수량</th><th>업체 생산일</th><th>업체 품명</th><th>판정</th><th>데이터 점검</th><th>투입 Lot</th></tr></thead><tbody>${rows}</tbody></table>
      <div class="sign"><div><b>검수</b><span></span></div><div><b>확인</b><span></span></div><div><b>승인</b><span></span></div></div></section>${photoPages}`;
  }
  function chunk(a, n) { const out = []; for (let i = 0; i < a.length; i += n) out.push(a.slice(i, i + n)); return out; }

  // iOS Safari는 탭 안에서 바로 연 창만 허용한다. confirm() 다음에 열면 막힐 수 있어, 창 안 버튼을 누르는 순간 연다.
  function printInbounds(nos) {
    if (!nos.length) return;
    $('dialogBody').innerHTML = `<h3>인쇄 ${nos.length}건</h3><div class="sub">사진 장을 함께 인쇄할까요?</div><div class="savebar"><button type="button" class="btn" id="prPh">사진 포함</button><button type="button" class="btn ghost" id="prNo">표만</button><button type="button" class="btn ghost sm" id="prClose">닫기</button></div>`;
    $('dialog').hidden = false;
    $('prClose').onclick = () => { $('dialog').hidden = true; };
    $('prPh').onclick = () => { $('dialog').hidden = true; R.rec.note('보고서 인쇄(사진 포함)', nos.join(', '), nos.length); printOpen(nos, true); };
    $('prNo').onclick = () => { $('dialog').hidden = true; R.rec.note('보고서 인쇄', nos.join(', '), nos.length); printOpen(nos, false); };
  }
  async function printOpen(nos, withPhotos) {
    const w = window.open('', '_blank'); if (!w) return R.toast('팝업이 막혀 있습니다. 브라우저에서 팝업을 허용하세요', 'crit');
    w.document.write('<p style="font-family:sans-serif">보고서 준비 중…</p>');
    const packs = []; for (const no of nos) { const s = P.data.inbounds.find((x) => x.inboundNo === no); if (s) packs.push({ s, recs: await recsOf(no) }); }
    let ph = null;
    if (withPhotos) { const urls = packs.flatMap((p) => p.recs.flatMap((r) => [r.wmsPhoto, r.vendorPhoto])).filter(Boolean); w.document.body.innerHTML = `<p style="font-family:sans-serif">사진 ${urls.length}장 불러오는 중…</p>`; ph = await R.loadPhotos(urls); }
    const html = `<!doctype html><html><head><meta charset="utf-8"><title>공병 입고 검수 보고서 ${esc(label())}</title>${printCss()}</head><body>${packs.map((p) => sheetHtml(p.s, p.recs, ph)).join('')}<script>window.onload=function(){setTimeout(function(){window.print()},300)}<\/script></body></html>`;
    w.document.open(); w.document.write(html); w.document.close();
  }

  // 기간이 길어 기록이 줄여져 왔으면 한 달씩 나눠 받아 CSV를 만든다
  async function allRecords() {
    if (!P.data.trimmed) return P.data.records;
    const out = []; let a = new Date(P.from + 'T00:00:00');
    const end = new Date(P.to + 'T00:00:00'), ymd = (d) => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
    while (a <= end) {
      const b = new Date(Math.min(end.getTime(), a.getTime() + 30 * 864e5));
      R.toast(`CSV 준비 중 · ${ymd(a)} ~ ${ymd(b)}`, 'warn');
      const r = await R.tryGet('r15Report', { from: ymd(a), to: ymd(b) }); if (!r) return null;
      const seen = new Set(out.map((x) => x.id)); r.records.forEach((x) => { if (!seen.has(x.id) && x.at >= new Date(P.from + 'T00:00:00').getTime()) out.push(x); });
      a = new Date(b.getTime() + 864e5);
    }
    return out;
  }
  async function csv() {
    const recsAll = await allRecords(); if (!recsAll) return;
    const head = ['입고번호', 'Pallet', '검수일시', '품목코드', '품명(정식)', '저장된 품명', '공급업체', 'WMS수량', '업체수량', '업체품명', '업체생산일자', '판정', '데이터점검', '투입 제조번호', '검수자', 'WMS사진', '업체사진', '기록ID'];
    const rows = recsAll.map((r) => [r.inboundNo, r.pallet, r.atText, r.itemCode, r.product, r.productRaw, r.supplier, r.qty, r.vendorQty, r.vendorProduct, r.vendorProdDate, r.finalResult,
      r.issues.filter((x) => x.level !== 'info').map((x) => x.label).join(' / '), r.usedIn.map((u) => u.productName + ' ' + u.lotNo).join(' / '), r.inspector, r.wmsPhoto, r.vendorPhoto, r.id]);
    const text = '﻿' + [head].concat(rows).map((row) => row.map((v) => { const s = String(v == null ? '' : v); return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; }).join(',')).join('\r\n');
    const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([text], { type: 'text/csv;charset=utf-8' })); a.download = `공병검수_${P.from}_${P.to}.csv`; a.click(); R.rec.note('보고서 CSV', `${P.from}~${P.to}`, rows.length); setTimeout(() => URL.revokeObjectURL(a.href), 120000); // iOS는 '다운로드할까요?' 확인 뒤에 받는다
  }

  P.init = function () { setPeriod('week'); render(); };
  P.show = function () { if (!P.data) load(); };
  // 기록을 고치거나 지운 뒤: 같은 기간을 다시 읽고, 보던 입고번호 상세가 있으면 다시 연다
  P.reload = async function () {
    if (!P.data) return; try { localStorage.removeItem(CK); } catch (_) {} const keep = P.detail && P.detail.summary && P.detail.summary.inboundNo; P.detail = null;
    await load(); if (keep && P.data && P.data.inbounds.some((x) => x.inboundNo === keep)) openDetail(keep);
  };
  const afterChange = () => { P.reload(); if (R.rec) R.rec.loadMine(); };

  /* ---------- 추적 탭 ---------- */
  const T = R.trace = {};
  T.init = function () {
    $('traceView').innerHTML = `<section><div class="shead"><h2>추적</h2><span class="sub">제품명, 제조번호, 입고번호, 26004733-0042 같은 라벨 번호 어느 것이든</span></div>
      <div class="searchrow"><input id="trQ" type="search" placeholder="예: 제품명, 2F205, 26004733" enterkeyhint="search"><button type="button" class="btn" id="trGo">찾기</button></div></section><div id="trOut"></div>`;
    $('trGo').onclick = go; $('trQ').addEventListener('keydown', (e) => { if (e.key === 'Enter') go(); });
  };
  async function go() {
    const q = $('trQ').value.trim(); if (!q) return;
    const out = $('trOut'); out.innerHTML = '<div class="muted pad">찾는 중…</div>';
    const r = await R.tryGet('r15Trace', { q }); if (!r) { out.innerHTML = ''; return; }
    if (!r.lots.length && !r.inbounds.length) { out.innerHTML = '<section><div class="muted">찾은 기록이 없습니다.</div></section>'; return; }
    out.innerHTML = r.lots.map((l) => `<section><div class="shead"><div><div class="sub">제조번호 → 투입 공병</div><div class="big">${esc(l.productName)} ${esc(l.lotNo)}</div></div>${R.pill(l.status === '진행중' ? 'warn' : 'idle', l.status)}</div>
        <div class="vline">${esc(l.at)} · ${esc(l.workers)} · 투입 ${l.pallets.length} Pallet</div>
        <div class="list">${l.pallets.map((p) => { const rec = p.record; return `<div class="row"><span><b>${esc(p.inboundNo)}</b> P${esc(p.pallet)} <span class="muted">${rec ? esc(rec.product + ' · ' + rec.supplier + ' · 검수 ' + rec.atText.slice(0, 10)) : ''}</span></span>
          <span>${p.unverified ? R.pill('error', '미검수 투입') : R.pill(rec.level, rec.level === 'ok' ? '검수 이상 없음' : rec.finalResult)} ${rec && rec.wmsPhoto ? `<button type="button" class="btn ghost sm" data-ph="${esc(rec.wmsPhoto)}" data-cap="${esc(p.inboundNo)} P${esc(p.pallet)} WMS">WMS</button>` : ''}${rec && rec.vendorPhoto ? `<button type="button" class="btn ghost sm" data-ph="${esc(rec.vendorPhoto)}" data-cap="${esc(p.inboundNo)} P${esc(p.pallet)} 업체">업체</button>` : ''}</span></div>`; }).join('') || '<div class="muted">투입 기록 없음</div>'}</div></section>`).join('') +
      r.inbounds.map((g) => `<section><div class="shead"><div><div class="sub">입고번호 → 사용된 제조번호</div><div class="big">${esc(g.summary.inboundNo)}</div></div></div>
        <div class="vline">${esc(g.summary.product)} · ${esc(g.summary.supplier)} · ${g.records.length} Pallet · 투입 ${g.summary.usedCount}${(() => { const n = [...new Set(g.records.flatMap((rec) => rec.usedIn.map((u) => u.productName)).filter(Boolean))]; return n.length ? ' · 사용 제품 <b>' + esc(n.join(', ')) + '</b>' : ''; })()}</div>
        <div class="list">${g.records.map((rec) => `<div class="row"><span><b>P${esc(rec.pallet)}</b> <span class="muted">${esc(rec.atText)} · ${esc(rec.inspector)}</span></span>
          <span>${rec.usedIn.length ? rec.usedIn.map((u) => R.pill('idle', u.productName + ' ' + u.lotNo)).join(' ') : '<span class="muted">미투입</span>'} ${rec.wmsPhoto ? `<button type="button" class="btn ghost sm" data-ph="${esc(rec.wmsPhoto)}" data-cap="${esc(rec.inboundNo)} P${esc(rec.pallet)} WMS">WMS</button>` : ''}${rec.vendorPhoto ? `<button type="button" class="btn ghost sm" data-ph="${esc(rec.vendorPhoto)}" data-cap="${esc(rec.inboundNo)} P${esc(rec.pallet)} 업체">업체</button>` : ''}</span></div>`).join('')}</div></section>`).join('');
    bindPhotoButtons(out);
  }
})();
