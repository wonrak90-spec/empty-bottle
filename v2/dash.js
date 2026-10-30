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
    // 라인 현황은 30초마다 (가벼운 호출, 서버가 20초 캐시)
    clearInterval(D.ltimer); live();
    D.ltimer = setInterval(() => { if (document.body.dataset.tab === 'dash' && !document.hidden) live(); else clearInterval(D.ltimer); }, 30000);
  };

  /* ---------- 라인 현황 (실시간) ---------- */
  async function live() {
    const r = await R.tryGet('r15Live'); if (!r || !r.ok) return;
    // 새 투입 오류가 생기면 이 화면을 보고 있는 폰·PC가 소리와 진동으로 알린다
    const seen = D.seenEv || (D.seenEv = new Set(R.lines.open(r.events).map((e) => e.id))), fresh = R.lines.open(r.events).filter((e) => !seen.has(e.id));
    fresh.forEach((e) => seen.add(e.id));
    if (fresh.length && D.live) { try { navigator.vibrate && navigator.vibrate([300, 120, 300]); } catch (_) {} alarm(); R.toast(`${fresh[0].line || '?'} 라인 투입 오류 · ${fresh[0].text}`, 'crit'); }
    D.live = r; const el = $('liveBox'); if (el) { el.outerHTML = liveHtml(); bindLive(); }
  }
  function alarm() { try { const a = D.ac = D.ac || new (window.AudioContext || window.webkitAudioContext)(); [0, 0.25].forEach((t) => { const o = a.createOscillator(), g = a.createGain(); o.frequency.value = 520; g.gain.value = 0.2; o.connect(g); g.connect(a.destination); o.start(a.currentTime + t); o.stop(a.currentTime + t + 0.18); }); } catch (_) {} }
  const liveLot = (k) => ((D.live && D.live.lots) || []).find((l) => l.line === k) || null;
  function bindLive() { const el = $('liveBox'); if (el && D.live) R.lines.bindAck(el, D.live.events || [], () => { const b = $('liveBox'); if (b) { b.outerHTML = liveHtml(); bindLive(); } }, liveLot); }
  function liveHtml() {
    const r = D.live; if (!r) return '<section id="liveBox"><div class="shead"><h2>라인 현황</h2><span class="muted">불러오는 중…</span></div></section>';
    const byLine = {}; r.lots.forEach((l) => { if (l.line && !byLine[l.line]) byLine[l.line] = l; });
    const other = r.lots.filter((l) => !l.line || byLine[l.line] !== l), cfg = r.lines || {};
    const open = R.lines.open(r.events);
    const rows = R.lines.KEYS.map((k) => { const l = byLine[k], m = l ? R.lines.ago(l.lastAt, r.now) : null, errs = open.filter((e) => e.line === k).length;
      return { line: k, state: errs ? 'bad' : R.lines.state(l && l.lastAt, r.now, !!l), title: l ? `${l.productName} ${l.lotNo}` : ((cfg[k] && cfg[k].products.length) ? cfg[k].products.join(' · ') + ' (작업 없음)' : '작업 없음'),
        sub: l ? `오늘 ${fmt(l.today)} Pallet · 누적 ${fmt(l.count)} · 마지막 ${l.lastText || '-'}` : '', note: errs ? `오류 ${errs}건 · 확인 필요` : !l ? '작업 없음' : m == null ? '투입 대기' : m <= 10 ? '투입 중' : `${m}분째 대기` }; });
    const tot = r.lots.reduce((a, l) => a + (l.today || 0), 0);
    return `<section id="liveBox"><div class="shead"><h2>라인 현황</h2><span class="muted">오늘 투입 ${fmt(tot)} Pallet · ${esc(r.at)} 기준 · 30초마다</span></div>
      ${R.lines.eventsHtml(r.events, R.rank() >= 1, liveLot).replace('<section class="lnerr">', '<div class="lnerr">').replace(/<\/section>$/, '</div>')}
      ${R.lines.svg(rows)}
      ${other.length ? `<details class="mt"><summary>라인 없이 진행 중인 작업 ${other.length}건 (폰에서 시작)</summary><div class="list">${other.map((l) => `<div class="row"><span><b>${esc(l.productName)} ${esc(l.lotNo)}</b> <span class="muted">오늘 ${fmt(l.today)} · 누적 ${fmt(l.count)} · 마지막 ${esc(l.lastText || '-')}</span></span></div>`).join('')}</div></details>` : ''}</section>`;
  }


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
    root.innerHTML = liveHtml() + `<section>
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
      `;
    root.querySelectorAll('#dashSeg [data-r]').forEach((b) => { b.onclick = () => { D.range = b.dataset.r; const c = cached(); D.data = c ? c.rep : null; D.at = c ? (c.at || '') + ' 저장본' : ''; render(); load(); }; });
    $('dashReload').onclick = load;
    bindLive();
    root.querySelectorAll('[data-goreport]').forEach((b) => { b.onclick = () => { const n = document.querySelector('#nav [data-tab="report"]'); if (n) n.click(); }; });
  }

  function vehicle(x) {
    const total = Math.max(x.gaps.max || 0, x.palletCount), pct = total ? Math.round(x.palletCount / total * 100) : 0;
    const lv = x.errorCount ? 'error' : x.warnCount || x.gaps.missing.length ? 'warn' : 'ok';
    const say = x.errorCount ? `오류 ${x.errorCount}` : x.gaps.missing.length ? `빠진 번호 ${x.gaps.missing.length}` : x.warnCount ? `주의 ${x.warnCount}` : '정상';
    return `<div class="row dveh"><span class="dname"><b>${esc(x.inboundNo || '입고번호 없음')}</b> ${esc(x.product || '')} <span class="muted">${esc(x.supplier || '')} · ${esc(x.days.join(', '))} · ${esc(x.inspectors.join(', '))}</span></span>
      <span class="dprog"><span class="dbar"><i class="${lv}" style="width:${pct}%"></i></span><b>${x.palletCount}</b><span class="muted"> / ${total} Pallet</span> ${R.pill(lv, say)}</span></div>`;
  }
})();
