/* R15 라인 그림: 액제동 1층 배치(라인 4개가 위아래로 놓이고, 오른쪽 병공급실에서 공병이 들어가 왼쪽 충전·포장으로 흐름)를 단순하게 그린다.
 * 투입 보드와 현황 탭이 같이 쓴다. 도면 자체는 사내 문서라 옮기지 않고 흐름만 따랐다.
 * rows: [{ line:'A', title:'판콜에이 2F302', sub:'오늘 12 Pallet · 마지막 14:05', state:'on'|'wait'|'idle'|'bad', note }]
 */
(function () {
  'use strict';
  const R = window.R15, { esc } = R.util;
  const LN = R.lines = { KEYS: ['A', 'B', 'C', 'D'] };
  const COL = { on: 'var(--good)', wait: 'var(--warn)', idle: 'var(--ink3)', bad: 'var(--crit)' };
  const BG = { on: 'var(--good-bg)', wait: 'var(--warn-bg)', idle: 'var(--sunken)', bad: 'var(--crit-bg)' };
  const WORD = { on: '투입 중', wait: '대기', idle: '작업 없음', bad: '확인 필요' };
  LN.svg = function (rows) {
    const H = 118, top = 56, h = top + rows.length * H + 10;
    const lane = (r, i) => {
      const y = top + i * H, st = r.state || 'idle', c = COL[st], bg = BG[st];
      return `<g class="lane" data-line="${esc(r.line)}" role="button" tabindex="0" aria-label="${esc(r.line)} 라인 ${esc(WORD[st])}">
        <rect x="8" y="${y}" width="736" height="${H - 16}" rx="16" fill="${bg}" stroke="${c}" stroke-width="4"/>
        <text x="40" y="${y + 66}" font-size="52" font-weight="800" fill="${c}">${esc(r.line)}</text>
        <text x="110" y="${y + 44}" font-size="32" font-weight="700" fill="var(--ink)">${esc(r.title || '작업 없음')}</text>
        <text x="110" y="${y + 84}" font-size="26" fill="var(--ink2)">${esc(r.sub || '')}</text>
        <text x="728" y="${y + 44}" font-size="24" font-weight="700" fill="${c}" text-anchor="end">${esc(r.note || WORD[st])}</text>
        <path d="M 770 ${y + 51} L 754 ${y + 51}" stroke="${c}" stroke-width="6" marker-end="url(#lnArr)"/>
        <rect x="776" y="${y}" width="214" height="${H - 16}" rx="16" fill="var(--surface)" stroke="var(--line)" stroke-width="3"/>
        <text x="883" y="${y + 46}" font-size="24" fill="var(--ink2)" text-anchor="middle">병 투입</text>
        <text x="883" y="${y + 80}" font-size="22" fill="var(--ink3)" text-anchor="middle">${esc(r.device || '스캐너')}</text>
      </g>`;
    };
    return `<svg class="lnsvg" viewBox="0 0 1000 ${h}" role="img" aria-label="라인별 투입 상황">
      <defs><marker id="lnArr" viewBox="0 0 10 10" refX="5" refY="5" markerWidth="5" markerHeight="5" orient="auto"><path d="M10 0 L0 5 L10 10 z" fill="context-stroke"/></marker></defs>
      <text x="16" y="34" font-size="24" fill="var(--ink3)">← 충전·포장</text>
      <text x="984" y="34" font-size="24" fill="var(--ink3)" text-anchor="end">병공급실 (공병 Pallet 들어옴)</text>
      ${rows.map(lane).join('')}</svg>`;
  };
  // 마지막 투입 시각으로 상태: 10분 안 = 투입 중, 그 밖 = 대기
  LN.state = (lastAt, now, hasLot) => (!hasLot ? 'idle' : lastAt && now - lastAt <= 600000 ? 'on' : 'wait');
  LN.ago = (lastAt, now) => (lastAt ? Math.max(0, Math.round((now - lastAt) / 60000)) : null);
})();
