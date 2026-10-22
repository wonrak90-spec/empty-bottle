/* R15 현황: 오늘·최근 7일·30일 한눈에 (V1 현황 탭). 화면 권한에서 Guest에게 열면 로그인 없이 볼 수 있다. */
(function () {
  'use strict';
  const R = window.R15, { $, esc, fmt } = R.util;
  const D = R.dash = { range: 'today', data: null, lots: null, timer: 0, at: '' };
  const RANGES = [['today', '오늘', 0], ['week', '최근 7일', 6], ['month', '최근 30일', 29]];

  D.show = async function () {
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
      ${open.length ? `<section><div class="shead"><h2>진행 중 생산 작업</h2></div><div class="list">${open.map((l) => `<div class="row"><span><b>${esc(l.productName)} ${esc(l.lotNo)}</b> <span class="muted">${esc(l.at)} · ${esc(l.workers || '')}</span></span><span>투입 <b>${fmt(l.palletCount)}</b> Pallet</span></div>`).join('')}</div></section>` : ''}`;
    root.querySelectorAll('#dashSeg [data-r]').forEach((b) => { b.onclick = () => { D.range = b.dataset.r; D.data = null; D.at = ''; render(); load(); }; });
    $('dashReload').onclick = load;
  }

  function vehicle(x) {
    const total = Math.max(x.gaps.max || 0, x.palletCount), pct = total ? Math.round(x.palletCount / total * 100) : 0;
    const lv = x.errorCount ? 'error' : x.warnCount || x.gaps.missing.length ? 'warn' : 'ok';
    const say = x.errorCount ? `오류 ${x.errorCount}` : x.gaps.missing.length ? `빠진 번호 ${x.gaps.missing.length}` : x.warnCount ? `주의 ${x.warnCount}` : '정상';
    return `<div class="row dveh"><span class="dname"><b>${esc(x.inboundNo || '입고번호 없음')}</b> ${esc(x.product || '')} <span class="muted">${esc(x.supplier || '')} · ${esc(x.days.join(', '))} · ${esc(x.inspectors.join(', '))}</span></span>
      <span class="dprog"><span class="dbar"><i class="${lv}" style="width:${pct}%"></i></span><b>${x.palletCount}</b><span class="muted"> / ${total} Pallet</span> ${R.pill(lv, say)}</span></div>`;
  }
})();
