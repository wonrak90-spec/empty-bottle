/* R15 관리 탭 (관리자만): 품목 기준정보, 주간제조계획표 링크, 사용자, 삭제 기록 복구 */
(function () {
  'use strict';
  const R = window.R15, { $, esc } = R.util;
  const A = R.admin = { sub: 'items', items: [], plan: null, users: [], deleted: [] };

  function render() {
    const root = $('adminView'); if (!root) return;
    if (!R.isAdmin()) { root.innerHTML = '<section><div class="muted">관리자 계정으로 로그인해야 볼 수 있습니다.</div></section>'; return; }
    root.innerHTML = `<section style="padding:10px 14px"><div class="tabs" id="admSub">${[['items', '품목·별칭'], ['plan', '제조계획 링크'], ['users', '사용자'], ['deleted', '삭제 기록']].map(([v, t]) => `<button type="button" data-a="${v}" aria-pressed="${A.sub === v}">${t}</button>`).join('')}</div></section><div id="admBody"><div class="muted pad">불러오는 중…</div></div>`;
    document.querySelectorAll('#admSub [data-a]').forEach((b) => { b.onclick = () => { A.sub = b.dataset.a; render(); }; });
    ({ items: items, plan: plan, users: users, deleted: deleted })[A.sub]();
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
      <div class="list">${A.users.map((u, i) => `<div class="row"><span><b>${esc(u.name)}</b> <span class="muted">${esc(u.employeeNo)} · ${esc(u.department || '')} · ${u.role === 'admin' ? '관리자' : '작업자'} · 최근 ${esc(u.lastLogin || '-')}</span></span>
        <span>${R.pill(u.status === 'ACTIVE' ? 'ok' : 'idle', u.status === 'ACTIVE' ? '사용' : '중지')} <button type="button" class="btn ghost sm" data-pin="${i}">PIN 초기화</button> <button type="button" class="btn ghost sm" data-st="${i}">${u.status === 'ACTIVE' ? '중지' : '다시 사용'}</button></span></div>`).join('')}</div>
      <h3>사용자 추가</h3><div class="grid g2"><label>사번<input id="nuEmp"></label><label>이름<input id="nuName"></label><label>부서<input id="nuDept"></label>
      <label>권한<select id="nuRole"><option value="worker">작업자</option><option value="admin">관리자</option></select></label></div>
      <div><button type="button" class="btn" id="nuAdd">추가</button></div></section>`;
    document.querySelectorAll('[data-pin]').forEach((b) => { b.onclick = async () => { const u = A.users[Number(b.dataset.pin)]; if (!confirm(`${u.name}의 PIN을 초기화할까요?`)) return; const r = await R.tryPost('resetUserPin', { userId: u.userId }); if (r && r.ok) alert(`${u.name} 임시 PIN: ${r.tempPin}\n본인에게 전달하세요.`); }; });
    document.querySelectorAll('[data-st]').forEach((b) => { b.onclick = async () => { const u = A.users[Number(b.dataset.st)]; const r = await R.tryPost('updateUser', { userId: u.userId, status: u.status === 'ACTIVE' ? 'INACTIVE' : 'ACTIVE' }); if (r && r.ok) users(); }; });
    $('nuAdd').onclick = async () => { const r = await R.tryPost('createUser', { employeeNo: $('nuEmp').value, name: $('nuName').value, department: $('nuDept').value, role: $('nuRole').value }); if (r && r.ok) { alert(`추가했습니다. 임시 PIN: ${r.tempPin}`); users(); } };
  }

  /* ---------- 삭제 기록 ---------- */
  async function deleted() {
    const r = await R.tryGet('listDeletedRecords'); A.deleted = r && (r.items || r.records) || [];
    $('admBody').innerHTML = `<section><div class="shead"><h2>삭제한 기록</h2><span class="sub">보고서에서 지운 중복 기록 등. 복구하면 다시 보고서에 나옵니다.</span></div>
      <div class="list">${A.deleted.map((x, i) => `<div class="row"><span><b>${esc(x.inboundNo || '')}</b> ${esc(x.product || '')} <span class="muted">${esc(new Date(x.deletedAt).toLocaleString('ko-KR'))} · ${esc(x.reason || '')} · ${esc(x.actor || '')}</span></span><button type="button" class="btn ghost sm" data-rs="${i}">복구</button></div>`).join('') || '<div class="muted">없음</div>'}</div></section>`;
    document.querySelectorAll('[data-rs]').forEach((b) => { b.onclick = async () => { const x = A.deleted[Number(b.dataset.rs)]; const reason = prompt('복구 사유'); if (!reason) return; const r = await R.tryPost('restoreRecords', { ids: [x.id], reason }); if (r && r.ok) { R.toast('복구했습니다', 'ok'); deleted(); } }; });
  }

  A.show = render;
})();
