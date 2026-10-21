/* R15 관리 탭 (중간관리자 이상): 품목 기준정보, 주간제조계획표 링크, 삭제 기록 복구, 변경 이력. 사용자 관리는 관리자만. */
(function () {
  'use strict';
  const R = window.R15, { $, esc } = R.util;
  const A = R.admin = { sub: 'audit', items: [], plan: null, users: [], deleted: [], audit: [], q: '' };
  const SUBS = [['audit', '감사 추적', 2], ['deleted', '삭제 보관함', 2], ['items', '품목·별칭', 2], ['plan', '제조계획 링크', 2], ['users', '사용자·권한', 3]];

  function render() {
    const root = $('adminView'); if (!root) return;
    if (!R.isManager()) { root.innerHTML = '<section><div class="muted">중간관리자 이상 계정으로 로그인해야 볼 수 있습니다.</div></section>'; return; }
    const subs = SUBS.filter((x) => R.rank() >= x[2]); if (!subs.some((x) => x[0] === A.sub)) A.sub = subs[0][0];
    root.innerHTML = `<section style="padding:10px 14px"><div class="tabs" id="admSub">${subs.map(([v, t]) => `<button type="button" data-a="${v}" aria-pressed="${A.sub === v}">${t}</button>`).join('')}</div></section><div id="admBody"><div class="muted pad">불러오는 중…</div></div>`;
    document.querySelectorAll('#admSub [data-a]').forEach((b) => { b.onclick = () => { A.sub = b.dataset.a; render(); }; });
    ({ items: items, plan: plan, users: users, deleted: deleted, audit: audit })[A.sub]();
  }

  /* ---------- 변경 이력 ---------- */
  // 감사 추적: 누가·언제·무엇을·왜. 저장·로그인·투입·내보내기까지 모두. 기간·종류·사람·검색으로 거르고 CSV로 내려받는다.
  const day = (d) => d.toISOString().slice(0, 10);
  function auF() { if (!A.f) { const t = new Date(Date.now() + 9 * 3600e3); A.f = { from: day(new Date(t - 6 * 864e5)), to: day(t), kind: '', actor: '', q: '' }; } return A.f; }
  function auDetail(a) {
    const ch = a.changes || {}, isDiff = Object.keys(ch).some((k) => ch[k] && typeof ch[k] === 'object' && 'after' in ch[k]);
    const flat = (o) => Object.keys(o || {}).filter((k) => o[k] !== '' && o[k] != null && typeof o[k] !== 'object').map((k) => `${k}: ${o[k]}`).join(' · ');
    const lines = [];
    if (isDiff) lines.push(R.rec.changesHtml(ch));
    else if (flat(ch)) lines.push(`<div>내용: ${esc(flat(ch))}</div>`);
    if (flat(a.before)) lines.push(`<div class="muted">이전: ${esc(flat(a.before))}${Array.isArray(a.before.pallets) && a.before.pallets.length ? ' · Pallet ' + esc(a.before.pallets.join(', ')) : ''}</div>`);
    if (flat(a.meta)) lines.push(`<div class="muted">${esc(flat(a.meta))}</div>`);
    return lines.join('');
  }
  const auText = (a) => { const ch = a.changes || {}; return Object.keys(ch).map((k) => { const v = ch[k]; return v && typeof v === 'object' ? `${k}: ${v.before ?? ''} → ${v.after ?? ''}` : `${k}: ${v}`; }).join(' / '); };
  async function audit() {
    const f = auF();
    $('admBody').innerHTML = '<div class="muted pad">불러오는 중…</div>';
    const r = await R.tryGet('r15Audit', f); A.audit = r && r.items || []; A.auMeta = r || {};
    const opt = (list, cur, all) => `<option value="">${all}</option>` + (list || []).map((x) => `<option ${x === cur ? 'selected' : ''}>${esc(x)}</option>`).join('');
    $('admBody').innerHTML = `<section><div class="shead"><h2>감사 추적</h2><span class="sub">누가 · 언제 · 무엇을 · 왜 · 저장·로그인·투입·내보내기 모두</span></div>
      <div class="grid g2 aufilter">
        <label>시작일<input type="date" id="auFrom" value="${esc(f.from)}"></label><label>종료일<input type="date" id="auTo" value="${esc(f.to)}"></label>
        <label>종류<select id="auKind">${opt(A.auMeta.kinds, f.kind, '전체')}</select></label>
        <label>사람<select id="auActor">${opt(A.auMeta.actors, f.actor, '전체')}</select></label>
        <label class="wide">검색<input id="auQ" type="search" value="${esc(f.q)}" placeholder="입고번호, 제조번호, 사유" enterkeyhint="search"></label></div>
      <div class="savebar"><button type="button" class="btn" id="auGo">조회</button><button type="button" class="btn ghost sm" id="auCsv" ${A.audit.length ? '' : 'disabled'}>CSV 내려받기</button>
        <span class="sub">${A.auMeta.total || 0}건${A.auMeta.total > A.audit.length ? ` · 앞 ${A.audit.length}건만 표시` : ''}</span></div>
      <div class="list">${A.audit.map((a, i) => `<details class="aurow"><summary><span><b>${esc(a.label)}</b> <span class="pill p-idle">${esc(a.kind)}</span> ${a.inboundNo ? `${esc(a.inboundNo)}${a.pallet ? ' P' + esc(a.pallet) : ''}` : ''}
          <span class="muted">${esc(a.atText)} · ${esc(a.actor)}${a.reason ? ' · ' + esc(a.reason) : ''}</span></span></summary>
        <div class="audet">${auDetail(a) || '<div class="muted">추가 내용 없음</div>'}${a.inboundNo && a.recordId ? `<button type="button" class="btn ghost sm" data-au="${i}">이 기록의 전체 이력</button>` : ''}</div></details>`).join('') || '<div class="muted">이 조건에 해당하는 이력이 없습니다.</div>'}</div></section>`;
    const read = () => { f.from = $('auFrom').value; f.to = $('auTo').value; f.kind = $('auKind').value; f.actor = $('auActor').value; f.q = $('auQ').value.trim(); if (f.from && f.to && f.from > f.to) [f.from, f.to] = [f.to, f.from]; };
    $('auGo').onclick = () => { read(); audit(); };
    ['auKind', 'auActor'].forEach((id) => { $(id).onchange = () => { read(); audit(); }; });
    $('auQ').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('auGo').click(); });
    $('auCsv').onclick = () => {
      const q = (v) => '"' + String(v == null ? '' : v).replace(/"/g, '""') + '"';
      const rows = [['일시', '종류', '작업', '입고번호', 'Pallet', '작업자', '사유', '내용', 'Record ID']].concat(A.audit.map((a) => [a.atText, a.kind, a.label, a.inboundNo, a.pallet || '', a.actor, a.reason, auText(a), a.recordId]));
      const blob = new Blob(['\ufeff' + rows.map((r) => r.map(q).join(',')).join('\r\n')], { type: 'text/csv;charset=utf-8' });
      const el = document.createElement('a'); el.href = URL.createObjectURL(blob); el.download = `감사추적_${f.from}_${f.to}.csv`; el.click(); setTimeout(() => URL.revokeObjectURL(el.href), 5000);
      R.rec.note('감사추적 CSV', `${f.from}~${f.to} ${f.kind || '전체'} ${f.actor || ''}`, A.audit.length);
    };
    document.querySelectorAll('[data-au]').forEach((b) => { b.onclick = () => { const a = A.audit[Number(b.dataset.au)]; R.rec.history({ id: a.recordId, inboundNo: a.inboundNo, pallet: a.pallet }); }; });
  }

  /* ---------- 품목 ---------- */
  async function items() {
    const r = await R.tryGet('r15Items'); A.items = r ? r.items : [];
    $('admBody').innerHTML = `<section><div class="shead"><h2>품목 기준정보 (ItemMaster)</h2><span class="sub">검수 화면은 품목코드로 이 정식 명칭을 저장합니다. 업체 라벨 품명은 별칭으로 등록하면 자동 일치합니다.</span></div>
      <div class="scroll"><table class="mt"><thead><tr><th>자재코드</th><th>자재명</th><th>용량</th><th>공급업체</th><th>업체 품명 별칭</th><th></th></tr></thead><tbody>
      ${A.items.map((it, i) => `<tr><td data-l="자재코드"><b>${esc(it.itemCode)}</b></td><td data-l="자재명">${esc(it.itemName)}</td><td data-l="용량">${esc(it.volume)}</td><td data-l="공급업체">${esc(it.suppliers.join(', '))}</td><td data-l="별칭">${esc(it.aliases.join(', '))}</td><td><button type="button" class="btn ghost sm" data-it="${i}">고치기</button></td></tr>`).join('')}
      </tbody></table></div><div><button type="button" class="btn ghost" id="itNew">품목 추가</button></div></section>`;
    document.querySelectorAll('[data-it]').forEach((b) => { b.onclick = () => itemForm(A.items[Number(b.dataset.it)]); });
    $('itNew').onclick = () => itemForm(null);
  }
  function itemForm(it) {
    const d = it || { itemCode: '', category: '유리병', itemName: '', volume: '', suppliers: [], aliases: [] };
    $('dialogBody').innerHTML = `<h3>${it ? '품목 고치기' : '품목 추가'}</h3><div class="grid g2">
      <label>자재코드<input id="ifCode" value="${esc(d.itemCode)}" inputmode="numeric" ${it ? 'readonly' : ''}></label><label>자재구분<input id="ifCat" value="${esc(d.category)}"></label>
      <label class="wide">자재명 (정식 명칭)<input id="ifName" value="${esc(d.itemName)}"></label><label>용량(mL)<input id="ifVol" value="${esc(d.volume)}" inputmode="numeric"></label>
      <label class="wide">공급업체 (쉼표로 구분)<input id="ifSup" value="${esc(d.suppliers.join(', '))}"></label>
      <label class="wide">업체 품명 별칭 (쉼표로 구분)<input id="ifAli" value="${esc(d.aliases.join(', '))}" placeholder="예: 유리병(각병) 100ml, 판콜에이병 30ml"></label></div>
      <div class="savebar"><button type="button" class="btn" id="ifSave">저장</button><button type="button" class="btn ghost sm" id="ifClose">닫기</button></div>`;
    $('dialog').hidden = false; $('ifClose').onclick = () => { $('dialog').hidden = true; };
    $('ifSave').onclick = async () => {
      const r = await R.tryPost('r15ItemSave', { itemCode: $('ifCode').value, category: $('ifCat').value, itemName: $('ifName').value, volume: $('ifVol').value, suppliers: $('ifSup').value, aliases: $('ifAli').value });
      if (r && r.ok) { $('dialog').hidden = true; R.toast('저장했습니다', 'ok'); try { localStorage.removeItem('r15.items'); } catch (_) {} items(); }
    };
  }

  /* ---------- 주간제조계획표 링크 ---------- */
  async function plan() {
    A.plan = await R.tryGet('r15Plan');
    const p = A.plan || { schedules: [], names: {} };
    $('admBody').innerHTML = `<section><div class="shead"><h2>주간제조계획표 링크</h2><span class="sub">${p.savedAt ? `${esc(p.savedAt)} · ${esc(p.savedBy || '')} 저장 · ${p.schedules.length}건` : '아직 없음'}</span></div>
      <div class="sub">원료 수불 대시보드와 같은 공유 링크(#share=…)를 붙여 넣으면, 생산 투입 탭에 오늘 전후 제조번호가 버튼으로 나옵니다. 일정이 바뀌면 새 링크로 다시 저장하세요.</div>
      <label>공유 링크<input id="plLink" placeholder="https://…#share=N4Ig…" autocomplete="off"></label>
      <div><button type="button" class="btn ghost" id="plRead">링크 읽기</button> <span class="msg" id="plMsg"></span></div>
      <div id="plPrev"></div></section>`;
    $('plRead').onclick = readLink;
    $('plLink').addEventListener('paste', () => setTimeout(readLink, 60));
  }
  async function lz() {
    if (window.LZString) return window.LZString;
    await new Promise((res, rej) => { const s = document.createElement('script'); s.src = 'https://cdnjs.cloudflare.com/ajax/libs/lz-string/1.5.0/lz-string.min.js'; s.onload = res; s.onerror = () => rej(new Error('LZString 불러오기 실패')); document.head.appendChild(s); });
    return window.LZString;
  }
  async function readLink() {
    const raw = $('plLink').value.trim(), s = raw.includes('share=') ? raw.split('share=').pop() : raw, msg = $('plMsg');
    let j = null;
    try { j = JSON.parse((await lz()).decompressFromEncodedURIComponent(s.replace(/\s/g, ''))); if (!j || !Array.isArray(j.schedules)) throw 0; }
    catch (e) { msg.textContent = raw.endsWith('…') || raw.endsWith('...') ? '링크가 중간에 잘렸습니다. 전체 링크를 다시 복사하세요.' : '링크를 읽지 못했습니다. #share= 뒤 전체가 복사됐는지 확인하세요.'; return; }
    const from = R.util.today(-7), to = R.util.today(21);
    const list = j.schedules.filter((x) => x && x.prod && /^\d{4}-\d\d-\d\d$/.test(x.date || '') && x.date >= from && x.date <= to);
    const codes = [...new Set(list.map((x) => x.prod))].sort(), names = Object.assign({}, (A.plan && A.plan.names) || {});
    msg.textContent = `${list.length}건 (지난 7일 ~ 앞으로 21일)`;
    $('plPrev').innerHTML = `<div class="sub">계획표의 제품 코드를 현장에서 보일 제품명으로 연결하세요. 한 번 정하면 다음부터 그대로 씁니다.</div>
      <div class="grid g2">${codes.map((c) => `<label>${esc(c)} (${list.filter((x) => x.prod === c).length}배치)<input data-pn="${esc(c)}" value="${esc(names[c] || '')}" placeholder="예: 까스활명수큐"></label>`).join('')}</div>
      <div class="savebar"><button type="button" class="btn" id="plSave">계획 저장</button></div>`;
    $('plSave').onclick = async () => {
      document.querySelectorAll('[data-pn]').forEach((i) => { if (i.value.trim()) names[i.dataset.pn] = i.value.trim(); });
      const r = await R.tryPost('r15PlanSave', { schedules: list, names });
      if (r && r.ok) { R.toast(`계획 ${r.count}건 저장`, 'ok'); plan(); }
    };
  }

  /* ---------- 사용자 ---------- */
  async function users() {
    const r = await R.tryPost('listUsers', {}); A.users = r && r.items || [];
    $('admBody').innerHTML = `<section><div class="shead"><h2>사용자</h2></div>
      <div class="list">${A.users.map((u, i) => `<div class="row"><span><b>${esc(u.name)}</b> <span class="muted">${esc(u.employeeNo)} · ${esc(u.department || '')} · 최근 ${esc(u.lastLogin || '-')}</span></span>
        <span class="ract"><select data-urole="${i}" aria-label="${esc(u.name)} 권한">${roleOpts(R.roleOf(u.role))}</select>${R.pill(u.status === 'ACTIVE' ? 'ok' : 'idle', u.status === 'ACTIVE' ? '사용' : '중지')} <button type="button" class="btn ghost sm" data-pin="${i}">PIN 초기화</button> <button type="button" class="btn ghost sm" data-st="${i}">${u.status === 'ACTIVE' ? '중지' : '다시 사용'}</button></span></div>`).join('')}</div>
      <details><summary>권한별로 할 수 있는 일</summary><div class="scroll"><table class="mt permt"><tbody>${Object.keys(R.ROLES).map((k) => `<tr><td>${esc(R.roleName(k))}</td><td>${R.CAN[k].map(esc).join('<br>')}</td></tr>`).join('')}</tbody></table></div></details>
      <h3>사용자 추가</h3><div class="grid g2"><label>사번<input id="nuEmp"></label><label>이름<input id="nuName"></label><label>부서<input id="nuDept"></label>
      <label>권한<select id="nuRole">${roleOpts('worker')}</select></label></div>
      <div><button type="button" class="btn" id="nuAdd">추가</button></div></section>`;
    document.querySelectorAll('[data-urole]').forEach((sel) => { sel.onchange = async () => { const u = A.users[Number(sel.dataset.urole)], to = sel.value;
      if (!confirm(`${u.name}의 권한을 ${R.roleName(to)}(으)로 바꿀까요? 바꾸면 그 사람은 다시 로그인해야 합니다.`)) { sel.value = R.roleOf(u.role); return; }
      const r = await R.tryPost('updateUser', { userId: u.userId, role: to }); if (r && r.ok) { R.toast('권한을 바꿨습니다', 'ok'); users(); } else sel.value = R.roleOf(u.role); }; });
    document.querySelectorAll('[data-pin]').forEach((b) => { b.onclick = async () => { const u = A.users[Number(b.dataset.pin)]; if (!confirm(`${u.name}의 PIN을 초기화할까요?`)) return; const r = await R.tryPost('resetUserPin', { userId: u.userId }); if (r && r.ok) alert(`${u.name} 임시 PIN: ${r.tempPin}\n본인에게 전달하세요.`); }; });
    document.querySelectorAll('[data-st]').forEach((b) => { b.onclick = async () => { const u = A.users[Number(b.dataset.st)]; const r = await R.tryPost('updateUser', { userId: u.userId, status: u.status === 'ACTIVE' ? 'INACTIVE' : 'ACTIVE' }); if (r && r.ok) users(); }; });
    $('nuAdd').onclick = async () => { const r = await R.tryPost('createUser', { employeeNo: $('nuEmp').value, name: $('nuName').value, department: $('nuDept').value, role: $('nuRole').value }); if (r && r.ok) { alert(`추가했습니다. 임시 PIN: ${r.tempPin}`); users(); } };
  }

  function roleOpts(cur) { return Object.keys(R.ROLES).map((k) => `<option value="${k}" ${k === cur ? 'selected' : ''}>${esc(R.roleName(k))}</option>`).join(''); }

  /* ---------- 삭제 기록 ---------- */
  async function deleted() {
    const r = await R.tryGet('listDeletedRecords'); A.deleted = r && (r.items || r.records) || [];
    $('admBody').innerHTML = `<section><div class="shead"><h2>삭제 보관함</h2><span class="sub">지운 기록은 여기 남습니다. 되살리면 다시 보고서·재고에 나옵니다.</span></div>
      <div class="list">${A.deleted.map((x, i) => `<div class="row"><span><b>${esc(x.inboundNo || '')}</b> ${esc(x.product || '')} <span class="muted">${esc(new Date(x.deletedAt).toLocaleString('ko-KR'))} · ${esc(x.reason || '')} · ${esc(x.actor || '')}</span></span><button type="button" class="btn ghost sm" data-rs="${i}">되살리기</button></div>`).join('') || '<div class="muted">없음</div>'}</div></section>`;
    document.querySelectorAll('[data-rs]').forEach((b) => { b.onclick = async () => { const x = A.deleted[Number(b.dataset.rs)]; R.rec.restore(x.id, () => { deleted(); if (R.report.reload) R.report.reload(); }); }; });
  }

  A.show = render;
})();
