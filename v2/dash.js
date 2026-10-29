/* R15 현황: 오늘·최근 7일·30일 한눈에 (V1 현황 탭). 화면 권한에서 Guest에게 열면 로그인 없이 볼 수 있다. */
(function () {
  'use strict';
  const R = window.R15, { $, esc, fmt } = R.util;
  const D = R.dash = { range: 'today', data: null, lots: null, timer: 0, at: '' };
  const RANGES = [['today', '오늘', 0], ['week', '최근 7일', 6], ['month', '최근 30일', 29]];

  // 마지막으로 받은 현황을 먼저 보여 주고 새 자료로 바꾼다 (Apps Script가 깨어나는 동안 빈 화면을 줄인다)
  const CK = 'r15.dash.';
  function cached() { try { const x = JSON.parse(localStorage.getItem(CK + D.range) || 'null'); return x && Date.now() - x.t < 3 * 864e5 ? x : null; } catch (_) { return null; } }
  function keep(rep, lots) { try { const s = JSON.stringify({ t: Date.now(), at: D.at, rep, lots }); if (s.length < 1500000) localStorage.setItem(CK + D.range, s); } catch (_) {} }
  D.show = async function () {
    const c = !D.data && cached(); if (c) { D.data = c.rep; D.lots = c.lots; D.at = (c.at || '') + ' 저장본'; }
    render();
    await load();
    // 사무실 모니터에 띄워 두는 경우를 위해 1분마다 새로 읽는다 (현황 탭을 보고 있을 때만)
    clearInterval(D.timer);
    D.timer = setInterval(() => { if (document.body.dataset.tab === 'dash' && !document.hidden) load(); else clearInterval(D.timer); }, 60000);
  };

  async function load() {
    const off = RANGES.find((x) => x[0] === D.range)[2];
    const [rep, lots] = await Promise.all([R.tryGet('r15Report', { from: R.util.today(-off), to: R.util.today() }), R.tryGet('r15Lots')]);
    if (rep && rep.ok) D.data = rep;
    if (lots && lots.ok) D.lots = lots.lots || [];
    D.at = new Date().toTimeString().slice(0, 5);
    if (rep && rep.ok) keep(rep, D.lots);
    render();
  }

  function render() {
    const root = $('dashView'); if (!root) return;
    const d = D.data, k = d && d.kpi, open = (D.lots || []).filter((l) => l.status === '진행중');
    root.innerHTML = `<section>
      <div class="shead"><h2>입고 검수 현황</h2>
        <div class="tabs" id="dashSeg">${RANGES.map(([v, t]) => `<button type="button" data-r="${v}" aria-pressed="${D.range === v}">${t}</button>`).join('')}</div>
        <span class="muted">${D.at ? D.at + ' 기준' : '불러오는 중…'} <button type="button" class="btn ghost sm" id="dashReload">새로고침</button></span></div>
      ${k ? `<div class="kpis">
        <div class="kpi"><div class="l">입고 차량</div><div class="v">${k.inbounds}<small> 대</small></div></div>
        <div class="kpi"><div class="l">검수 Pallet</div><div class="v">${fmt(k.pallets)}<small> 개</small></div><div class="d">${fmt(k.qty)} EA</div></div>
        <div class="kpi ${k.errorRecords ? 'crit' : k.warnRecords ? 'warn' : ''}"><div class="l">확인 필요</div><div class="v">${k.errorRecords + k.warnRecords}<small> 건</small></div><div class="d">오류 ${k.errorRecords} · 주의 ${k.warnRecords}</div></div>
        <div class="kpi ${k.gapPallets ? 'warn' : ''}"><div class="l">번호 빠진 Pallet</div><div class="v">${k.gapPallets}<small> 개</small></div></div>
        <div class="kpi"><div class="l">진행 중 생산 작업</div><div class="v">${open.length}<small> 건</small></div></div>
      </div>` : ''}</section>
      ${d ? `<section><div class="shead"><h2>차량별 진행</h2><span class="muted">${d.inbounds.length}대</span></div>
        <div class="list">${d.inbounds.length ? d.inbounds.map(vehicle).join('') : '<div class="muted pad">이 기간에 검수한 차량이 없습니다.</div>'}</div></section>` : ''}
      ${d ? blanks(d.records || []) + rates(d.records || []) : ''}
      ${open.length ? `<section><div class="shead"><h2>진행 중 생산 작업</h2></div><div class="list">${open.map((l) => `<div class="row"><span><b>${esc(l.productName)} ${esc(l.lotNo)}</b> <span class="muted">${esc(l.at)} · ${esc(l.workers || '')}</span></span><span>투입 <b>${fmt(l.palletCount)}</b> Pallet</span></div>`).join('')}</div></section>` : ''}`;
    root.querySelectorAll('#dashSeg [data-r]').forEach((b) => { b.onclick = () => { D.range = b.dataset.r; const c = cached(); D.data = c ? c.rep : null; D.at = c ? (c.at || '') + ' 저장본' : ''; render(); load(); }; });
    $('dashReload').onclick = load;
    root.querySelectorAll('[data-goreport]').forEach((b) => { b.onclick = () => { const n = document.querySelector('#nav [data-tab="report"]'); if (n) n.click(); }; });
  }

  // 업체 사진은 있는데 생산일·시간이 빈 Pallet: 사진을 보고 바로 채우게 차량별로 모아 보여 준다
  function blanks(recs) {
    const by = {};
    recs.forEach((r) => { if (!r.vendorPhoto) return; const k = !r.vendorProdDate ? 'd' : !r.vendorProdTime ? 't' : ''; if (!k) return; const g = by[r.inboundNo] = by[r.inboundNo] || { d: [], t: [], product: r.product }; g[k].push(r.pallet); });
    const ks = Object.keys(by); if (!ks.length) return '';
    const nd = ks.reduce((s, k) => s + by[k].d.length, 0), nt = ks.reduce((s, k) => s + by[k].t.length, 0);
    const ps = (a) => a.sort((x, y) => x - y).map((n) => 'P' + n).join(' ');
    return `<section><div class="shead"><h2>업체 생산일시 빈칸</h2><span class="muted">날짜 ${nd} · 시간 ${nt} Pallet</span></div>
      <div class="sub" style="margin-bottom:6px">업체 라벨 사진을 보고 채우면 업체 생산일 추적이 정확해집니다. 보고서 → 차량 → 고치기.</div>
      <div class="list">${ks.map((k) => `<div class="row"><span><b>${esc(k)}</b> ${esc(by[k].product || '')}<br><span class="muted">${by[k].d.length ? '날짜 없음 ' + ps(by[k].d) : ''}${by[k].d.length && by[k].t.length ? ' · ' : ''}${by[k].t.length ? '시간 없음 ' + ps(by[k].t) : ''}</span></span><button type="button" class="btn ghost sm" data-goreport>보고서로</button></div>`).join('')}</div></section>`;
  }
  // 업체별로 라벨에서 얼마나 기록됐나 (사진 있는 Pallet 기준). 낮은 업체는 촬영 방법이나 라벨 양식을 바꿀 곳
  function rates(recs) {
    const by = {};
    recs.forEach((r) => { const s = r.supplier || '업체 미상', g = by[s] = by[s] || { n: 0, ph: 0, d: 0, t: 0, p: 0, q: 0 }; g.n++; if (!r.vendorPhoto) return; g.ph++; if (r.vendorProdDate) g.d++; if (r.vendorProdTime) g.t++; if (r.vendorPalletNo) g.p++; if (r.vendorQty) g.q++; });
    const ks = Object.keys(by).filter((k) => by[k].n); if (!ks.length) return '';
    const pc = (a, b, l) => { if (!b) return `<td class="num muted" data-l="${l}">-</td>`; const v = Math.round(a / b * 100); return `<td class="num ${v < 50 ? 'crit' : v < 80 ? 'warnt' : ''}" data-l="${l}">${v}% <span class="muted">(${a}/${b})</span></td>`; };
    return `<section><div class="shead"><h2>업체별 라벨 판독</h2><span class="muted">사진 있는 Pallet 중 기록된 비율</span></div>
      <div class="scroll"><table class="mt"><thead><tr><th>업체</th><th class="num">Pallet</th><th class="num">업체 사진</th><th class="num">생산일</th><th class="num">생산시간</th><th class="num">P번호</th><th class="num">수량</th></tr></thead><tbody>
      ${ks.map((k) => { const g = by[k]; return `<tr><td data-l="업체"><b>${esc(k)}</b></td><td class="num" data-l="Pallet">${g.n}</td>${pc(g.ph, g.n, '업체 사진')}${pc(g.d, g.ph, '생산일')}${pc(g.t, g.ph, '생산시간')}${pc(g.p, g.ph, 'P번호')}${pc(g.q, g.ph, '수량')}</tr>`; }).join('')}</tbody></table></div>
      <div class="sub">동화지앤피 시간은 손글씨라 낮게 나올 수 있고, 동아에코팩 표지에는 날짜만 있습니다.</div></section>`;
  }
  function vehicle(x) {
    const total = Math.max(x.gaps.max || 0, x.palletCount), pct = total ? Math.round(x.palletCount / total * 100) : 0;
    const lv = x.errorCount ? 'error' : x.warnCount || x.gaps.missing.length ? 'warn' : 'ok';
    const say = x.errorCount ? `오류 ${x.errorCount}` : x.gaps.missing.length ? `빠진 번호 ${x.gaps.missing.length}` : x.warnCount ? `주의 ${x.warnCount}` : '정상';
    return `<div class="row dveh"><span class="dname"><b>${esc(x.inboundNo || '입고번호 없음')}</b> ${esc(x.product || '')} <span class="muted">${esc(x.supplier || '')} · ${esc(x.days.join(', '))} · ${esc(x.inspectors.join(', '))}</span></span>
      <span class="dprog"><span class="dbar"><i class="${lv}" style="width:${pct}%"></i></span><b>${x.palletCount}</b><span class="muted"> / ${total} Pallet</span> ${R.pill(lv, say)}</span></div>`;
  }
})();
