/* R15 관리 탭 (중간관리자 이상): 품목 기준정보, 주간제조계획표 링크, 삭제 기록 복구, 변경 이력. 사용자 관리는 관리자만. */
(function () {
  'use strict';
  const R = window.R15, { $, esc } = R.util;
  const A = R.admin = { sub: 'audit', items: [], plan: null, users: [], deleted: [], audit: [], q: '' };
  const SUBS = [['audit', '감사 추적', 2], ['deleted', '삭제 보관함', 2], ['items', '품목·별칭', 2], ['plan', '제조계획 링크', 2], ['users', '사용자·권한', 3], ['tabs', '화면 권한', 3], ['archive', '보관', 3]];

  function render() {
    const root = $('adminView'); if (!root) return;
    if (!R.isManager()) { root.innerHTML = '<section><div class="muted">중간관리자 이상 계정으로 로그인해야 볼 수 있습니다.</div></section>'; return; }
    const subs = SUBS.filter((x) => R.rank() >= x[2]); if (!subs.some((x) => x[0] === A.sub)) A.sub = subs[0][0];
    root.innerHTML = `<section style="padding:10px 14px"><div class="tabs" id="admSub">${subs.map(([v, t]) => `<button type="button" data-a="${v}" aria-pressed="${A.sub === v}">${t}</button>`).join('')}</div></section><div id="admBody"><div class="muted pad">불러오는 중…</div></div>`;
    document.querySelectorAll('#admSub [data-a]').forEach((b) => { b.onclick = () => { A.sub = b.dataset.a; render(); }; });
    ({ items: items, plan: plan, users: users, deleted: deleted, audit: audit, tabs: tabs, archive: archive })[A.sub]();
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
    $('admBody').innerHTML = `<section><div class="shead"><h2>품목 기준정보 (ItemMaster)</h2><span class="sub">검수 화면은 품목코드로 이 정식 명칭을 저장합니다. 업체 라벨 품명은 업체별로 등록하면 그 목록과 대조합니다 (다른 품목 병이 섞이면 오류).</span></div>
      <div class="scroll"><table class="mt"><thead><tr><th>자재코드</th><th>자재명</th><th>용량</th><th>공급업체</th><th>업체별 라벨 품명 · 1 Pallet 수량</th><th></th></tr></thead><tbody>
      ${A.items.map((it, i) => `<tr><td data-l="자재코드"><b>${esc(it.itemCode)}</b></td><td data-l="자재명">${esc(it.itemName)}</td><td data-l="용량">${esc(it.volume)}</td><td data-l="공급업체">${esc(it.suppliers.join(', '))}</td><td data-l="업체 품명">${(it.vendor || []).length ? it.vendor.map((v) => `<div><span class="muted">${esc(v.supplier || '업체 미지정')}</span> ${esc(v.names.join(', '))}${v.qty ? ` <span class="muted">· ${R.util.fmt(v.qty)}</span>` : ''}</div>`).join('') : `<span class="muted">${esc(it.aliases.join(', ')) || '미등록'}</span>`}</td><td><button type="button" class="btn ghost sm" data-it="${i}">고치기</button></td></tr>`).join('')}
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
      <input id="ifAli" type="hidden" value="${esc(d.aliases.join(', '))}"></div>
      <h4 style="margin:14px 0 4px">업체별 라벨 품명</h4><div class="sub">업체 라벨에 적힌 품명(여러 개면 쉼표)과 1 Pallet 정상 수량. 검수 때 이 목록과 비교합니다.</div>
      <datalist id="ifSupList">${d.suppliers.map((x) => `<option value="${esc(x)}">`).join('')}</datalist>
      <div id="vnRows"></div>
      <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:6px"><button type="button" class="btn ghost sm" id="vnAdd">업체 줄 추가</button>${it ? '<button type="button" class="btn ghost sm" id="vnSug">지금까지 기록에서 후보 채우기</button>' : ''}<span class="msg" id="vnMsg"></span></div>
      <div class="savebar"><button type="button" class="btn" id="ifSave">저장</button><button type="button" class="btn ghost sm" id="ifClose">닫기</button></div>`;
    $('dialog').hidden = false; $('ifClose').onclick = () => { $('dialog').hidden = true; };
    const rows = (d.vendor || []).map((v) => ({ supplier: v.supplier, names: v.names.join(', '), qty: v.qty || '' }));
    const draw = () => {
      $('vnRows').innerHTML = rows.map((v, i) => `<div class="vnrow"><input list="ifSupList" data-vk="supplier" data-vi="${i}" value="${esc(v.supplier)}" placeholder="공급업체"><input data-vk="names" data-vi="${i}" value="${esc(v.names)}" placeholder="라벨 품명 (예: 유리병(각병) 100ml)"><input data-vk="qty" data-vi="${i}" value="${esc(v.qty)}" inputmode="numeric" placeholder="수량"><button type="button" class="btn ghost sm" data-vdel="${i}" aria-label="줄 지우기">지우기</button></div>`).join('') || '<div class="muted">아직 없습니다 · 등록 전에는 예전 별칭 방식으로 대조합니다</div>';
      $('vnRows').querySelectorAll('[data-vk]').forEach((el) => { el.oninput = () => { rows[Number(el.dataset.vi)][el.dataset.vk] = el.value; }; });
      $('vnRows').querySelectorAll('[data-vdel]').forEach((el) => { el.onclick = () => { rows.splice(Number(el.dataset.vdel), 1); draw(); }; });
    };
    draw();
    $('vnAdd').onclick = () => { rows.push({ supplier: d.suppliers[0] || '', names: '', qty: '' }); draw(); };
    if ($('vnSug')) $('vnSug').onclick = async () => {
      $('vnMsg').textContent = '기록 읽는 중…';
      const r = await R.tryGet('r15VendorSuggest', { itemCode: d.itemCode }); if (!r) { $('vnMsg').textContent = ''; return; }
      // 후보는 바로 넣지 않고 체크해서 고른다 (비슷한 표기는 서버가 하나로 묶었고, 드문 이름·시험 기록은 뺐다)
      const gs = r.groups.filter((g) => g.names.length);
      if (!gs.length) { $('vnMsg').textContent = '기록에서 믿을 만한 후보를 찾지 못했습니다 · 직접 넣어 주세요'; return; }
      $('vnMsg').innerHTML = `<div class="vnsug">${gs.map((g, gi) => `<div><b>${esc(g.supplier)}</b> <span class="muted">기록 ${g.records}건${g.qty ? ` · 가장 많은 수량 ${R.util.fmt(g.qty)} (${g.qtyCount}건)` : ''}${g.dropped ? ` · 드문 표기 ${g.dropped}개 뺌` : ''}</span>
        ${g.names.map((x, ni) => `<label class="chk"><input type="checkbox" data-sg="${gi}|${ni}"> ${esc(x.name)} <span class="muted">${x.n}건${x.alts.length ? ' · 비슷한 표기 ' + x.alts.length + '개 포함' : ''}</span></label>`).join('')}</div>`).join('')}
        <button type="button" class="btn sm" id="vnTake">고른 후보 넣기</button></div>`;
      $('vnTake').onclick = () => {
        let n = 0;
        document.querySelectorAll('[data-sg]:checked').forEach((el) => { const [gi, ni] = el.dataset.sg.split('|').map(Number), g = gs[gi], name = g.names[ni].name;
          let row = rows.find((x) => x.supplier === g.supplier); if (!row) { row = { supplier: g.supplier, names: '', qty: g.qty || '' }; rows.push(row); }
          const have = row.names.split(',').map((x) => x.trim()).filter(Boolean); if (have.indexOf(name) < 0) { have.push(name); n++; } row.names = have.join(', '); if (!row.qty) row.qty = g.qty || ''; });
        draw(); $('vnMsg').textContent = n ? `${n}개를 넣었습니다 · 저장을 눌러야 반영됩니다` : '고른 후보가 없습니다';
      };
    };
    $('ifSave').onclick = async () => {
      const r = await R.tryPost('r15ItemSave', { itemCode: $('ifCode').value, category: $('ifCat').value, itemName: $('ifName').value, volume: $('ifVol').value, suppliers: $('ifSup').value, aliases: $('ifAli').value });
      if (r && r.ok) { const v = await R.tryPost('r15VendorSave', { itemCode: $('ifCode').value, rows: rows.map((x) => ({ supplier: x.supplier, names: x.names, qty: x.qty })) }); if (!v || !v.ok) return; }
      if (r && r.ok) { $('dialog').hidden = true; R.toast('저장했습니다', 'ok'); try { localStorage.removeItem('r15.items'); } catch (_) {} items(); }
    };
  }

  /* ---------- 주간제조계획표 링크 ---------- */
  // 라인 이름이 "A", "A라인", "A-1"처럼 와도 A~D로 시작하면 공병 라인
  const PLAN_LINE = /^[A-Da-d](?![A-Za-z])/;
  // 원료 수불 대시보드의 제품 목록 (제품명 칸에서 골라 쓴다)
  const PLAN_PRODUCTS = ['가을생강쌍화', '까스명수골드', '까스활명수', '까스활명수큐', '까스활액', '미인활액', '비타천', '속청케어', '속청큐', '스피롱', '십신탕', '쌍화원', '쌍화천', '쌍화탕', '알프스', '이지롱', '토스롱', '판콜에스', '판콜에이', '판토에이', '활명수', '활명수1897'];
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
    const inRange = j.schedules.filter((x) => x && x.prod && /^\d{4}-\d\d-\d\d$/.test(x.date || '') && x.date >= from && x.date <= to);
    // 공병은 A·B·C·D 라인에만 들어간다: 그 라인 일정만 남긴다 (라인 정보가 아예 없는 링크면 전부)
    const hasLine = inRange.some((x) => String(x.line || '').trim()), lineOk = (x) => PLAN_LINE.test(String(x.line || '').trim());
    const list = hasLine ? inRange.filter(lineOk) : inRange, skipped = [...new Set(inRange.filter((x) => !lineOk(x)).map((x) => String(x.line || '라인 없음')))];
    const codes = [...new Set(list.map((x) => x.prod))].sort(), names = Object.assign({}, (A.plan && A.plan.names) || {});
    msg.textContent = `${list.length}건 (지난 7일 ~ 앞으로 21일${hasLine ? ' · A~D 라인만' : ' · 링크에 라인 정보 없음'})` + (hasLine && skipped.length ? ` · 제외한 라인: ${skipped.slice(0, 8).join(', ')}` : '');
    if (!list.length) { $('plPrev').innerHTML = ''; return; }
    $('plPrev').innerHTML = `<div class="sub">계획표의 제품 코드를 현장에서 보일 제품명으로 연결하세요. 한 번 정하면 다음부터 그대로 씁니다.</div>
      <div class="grid g2">${codes.map((c) => `<label>${esc(c)} (${list.filter((x) => x.prod === c).length}배치)<input data-pn="${esc(c)}" list="plNames" value="${esc(names[c] || '')}" placeholder="예: 까스활명수큐"></label>`).join('')}</div>
      <datalist id="plNames">${PLAN_PRODUCTS.map((n) => `<option value="${esc(n)}">`).join('')}</datalist>
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

  // 화면 권한: 탭마다 어느 권한부터 보이는지. Guest는 로그인 없이 보기 (사내 누구나 주소만 알면 볼 수 있음)
  const LEVELS = [[-1, 'Guest (로그인 없이)'], [0, '조회 이상'], [1, '작업자 이상'], [2, '중간관리자 이상'], [3, '관리자만']];
  async function tabs() {
    const c = await R.loadConfig();
    if (!c || !c.tabs) { $('admBody').innerHTML = '<div class="muted pad">화면 권한을 읽지 못했습니다. 서버 코드(Code_R15.gs)를 새 버전으로 배포했는지 확인하세요.</div>'; return; }
    // 원료 수불장과 같은 표: 기능 · 사용 가능한 권한 · 권한별 ●. 화면 보기는 고를 수 있고, 입력·수정은 기록 보호 때문에 고정이다.
    const ROLES = [[-1, 'Guest'], [0, '조회'], [1, '작업자'], [2, '중간관리자'], [3, '관리자']];
    const DESC = { dash: '현황 (오늘·7일·30일 입고, 차량별 진행)', inspect: '입고 검수 (촬영·저장)', lot: '생산 투입 (작업 시작·공병 투입)', trace: '추적 (제품 ↔ 공병)', report: '보고서 (수불·데이터 점검·인쇄)', admin: '관리 (품목·계획·이력)' };
    const FIXED = [['입고 검수 저장 · 오늘 내 기록 고치기·지우기(사유 기록)', 1], ['생산 투입 · 작업 시작·종료', 1], ['모든 기록 고치기·지우기·복구 · 종료 작업 투입 취소', 2], ['품목·별칭 · 제조계획 링크 · 변경 이력·감사 추적', 2], ['사용자 관리 · 화면 권한 설정', 3]];
    const dots = (min) => ROLES.map(([v]) => `<td class="pmd">${v >= min ? '●' : '–'}</td>`).join('');
    const lv = (v) => (LEVELS.find((x) => x[0] === v) || [0, ''])[1].replace(' (로그인 없이)', ' 이상');
    $('admBody').innerHTML = `<section><div class="shead"><h2>권한 설정</h2></div>
      <div class="pmwrap"><table class="pm"><thead><tr><th>기능</th><th>사용 가능한 권한</th>${ROLES.map(([, t]) => `<th class="pmd">${t}</th>`).join('')}</tr></thead><tbody>
      <tr class="pmsec"><td colspan="7">화면 보기</td></tr>
      ${Object.keys(c.tabs).map((k) => `<tr data-row="${k}"><td>${esc(DESC[k] || c.labels[k] || k)}</td><td><select data-tabmin="${k}" aria-label="${esc(c.labels[k] || k)} 보이는 권한">${LEVELS.filter(([v]) => v >= c.limits[k]).map(([v]) => `<option value="${v}" ${v === c.tabs[k] ? 'selected' : ''}>${lv(v)}</option>`).join('')}</select></td>${dots(c.tabs[k])}</tr>`).join('')}
      <tr class="pmsec"><td colspan="7">입력·수정 <span class="muted">(기록 보호를 위해 고정)</span></td></tr>
      ${FIXED.map(([t, m]) => `<tr><td>${esc(t)}</td><td class="muted">${esc(lv(m))}</td>${dots(m)}</tr>`).join('')}
      </tbody></table></div>
      <div class="sub" style="margin-top:12px"><b>권한별로 보이는 탭</b></div><div id="pmSum" class="pmsum"></div>
      <div class="sub">Guest로 연 탭은 로그인 화면의 "로그인 없이 보기"로 누구나 볼 수 있습니다 (보기만, 사진·고치기·삭제 없음). 검수·투입은 작업자 이상, 관리는 중간관리자 이상으로만 정할 수 있습니다.</div>
      <div class="savebar"><button type="button" class="btn" id="tabsSave">저장</button><span class="msg" id="tabsMsg"></span></div></section>`;
    const sum = () => {
      const cur = {}; document.querySelectorAll('[data-tabmin]').forEach((s) => { cur[s.dataset.tabmin] = Number(s.value); const tr = s.closest('tr'); tr.querySelectorAll('.pmd').forEach((td, i) => { td.textContent = ROLES[i][0] >= cur[s.dataset.tabmin] ? '●' : '–'; }); });
      $('pmSum').innerHTML = ROLES.map(([v, t]) => `<div><b>${t}</b><span>${Object.keys(cur).filter((k) => v >= cur[k]).map((k) => esc(c.labels[k] || k)).join(' · ') || '없음'}</span></div>`).join('');
    };
    document.querySelectorAll('[data-tabmin]').forEach((s) => { s.onchange = sum; }); sum();
    $('tabsSave').onclick = async () => {
      const next = {}; document.querySelectorAll('[data-tabmin]').forEach((s) => { next[s.dataset.tabmin] = Number(s.value); });
      R.busy($('tabsSave'), true, '저장 중…');
      const r = await R.tryPost('r15TabsSave', { tabs: next }); R.busy($('tabsSave'), false);
      if (r && r.ok) { R.setConfig(r); $('tabsMsg').textContent = '저장했습니다. 다른 사람 화면은 앱을 다시 열면 바뀝니다.'; R.toast('화면 권한을 저장했습니다', 'ok'); }
    };
  }
  /* ---------- 보관 (1년 지난 기록을 보관 파일로) ---------- */
  async function archive() {
    $('admBody').innerHTML = '<div class="muted pad">옮길 기록을 세는 중…</div>';
    const r = await R.tryGet('r15ArchiveInfo'); if (!r) { $('admBody').innerHTML = '<div class="muted pad">읽지 못했습니다. 서버 코드(Code_R15.gs)를 새 버전으로 배포했는지 확인하세요.</div>'; return; }
    const pct = Math.round(r.cells / r.cellLimit * 100), fmt = R.util.fmt;
    $('admBody').innerHTML = `<section><div class="shead"><h2>보관 파일로 옮기기</h2></div>
      <div class="sub">구글 시트 한 파일은 1,000만 칸이 한도라, 오래된 기록을 보관 파일로 옮겨 지금 파일을 가볍게 유지합니다.
      <b>생산 투입이 끝났고 ${esc(r.cutoff)} 이전</b>인 작업만 그 작업의 투입·검수 기록과 함께 옮깁니다. 아직 재고인 Pallet와 진행 중 작업은 그대로 둡니다. 사진은 Drive에 그대로라 링크가 바뀌지 않습니다.</div>
      <div class="kpis" style="margin:12px 0">
        <div class="kpi ${pct >= 70 ? 'crit' : pct >= 50 ? 'warn' : ''}"><div class="l">지금 파일 크기</div><div class="v">${pct}<small>%</small></div><div class="d">${fmt(Math.round(r.cells / 1e4))}만 / 1,000만 칸</div></div>
        <div class="kpi"><div class="l">옮길 작업</div><div class="v">${fmt(r.lots)}<small> 건</small></div><div class="d">${r.lots ? esc(r.oldest + ' ~ ' + r.newest) : '없음'}</div></div>
        <div class="kpi"><div class="l">옮길 검수 기록</div><div class="v">${fmt(r.records)}<small> 행</small></div><div class="d">투입 ${fmt(r.pallets)} Pallet</div></div>
        ${r.remaining ? `<div class="kpi"><div class="l">다음 번에 옮길 작업</div><div class="v">${fmt(r.remaining)}<small> 건</small></div><div class="d">한 번에 3,000건까지</div></div>` : ''}
      </div>
      ${r.blocked ? `<div class="sub">기준일 이후 기록이 섞인 작업 ${fmt(r.blocked)}건은 옮기지 않습니다.</div>` : ''}
      <div class="savebar"><button type="button" class="btn" id="arRun" ${r.lots ? '' : 'disabled'}>보관 파일로 옮기기</button>${r.archiveUrl ? `<a class="btn ghost sm" href="${esc(r.archiveUrl)}" target="_blank" rel="noopener">보관 파일 열기</a>` : ''}<span class="msg" id="arMsg"></span></div>
      <div class="sub">옮긴 기록은 추적 화면의 "보관 기록도 찾기"로 볼 수 있습니다. 옮기는 동안(몇 분) 다른 저장은 잠시 기다렸다가 자동으로 다시 보냅니다. 검수가 없는 시간에 누르세요.</div></section>`;
    $('admBody').insertAdjacentHTML('beforeend', '<div id="bkBox"></div>'); backup();
    if (!r.lots) return;
    $('arRun').onclick = async () => {
      if (!confirm(`작업 ${r.lots}건 · 검수 기록 ${r.records}행을 보관 파일로 옮길까요?\n\n보관 파일에 먼저 붙이고 확인한 뒤에 지금 파일에서 뺍니다.`)) return;
      R.busy($('arRun'), true, '옮기는 중… (몇 분 걸릴 수 있음)');
      const x = await R.tryPost('r15ArchiveRun', {}); R.busy($('arRun'), false);
      if (x && x.ok) { R.toast(`옮겼습니다 · 기록 ${fmt(x.moved.Records || 0)}행`, 'ok'); archive(); }
    };
  }
  // 주간 자동 백업: 스프레드시트 사본을 "<이름>_백업" 폴더에 최근 8개까지
  async function backup() {
    const box = $('bkBox'); if (!box) return; box.innerHTML = '<section><div class="muted">백업 상태를 읽는 중…</div></section>';
    const b = await R.tryGet('r15BackupInfo'); if (!$('bkBox')) return;
    if (!b) { box.innerHTML = ''; return; }
    box.innerHTML = `<section><div class="shead"><h2>백업</h2>${R.pill(b.on ? 'ok' : 'idle', b.on ? '매주 자동 켜짐' : '자동 꺼짐')}</div>
      <div class="sub">스프레드시트 전체 사본을 같은 폴더의 백업 폴더에 만듭니다. 최근 ${b.keep}개만 남기고 오래된 사본은 휴지통으로 갑니다. 자동은 매주 일요일 새벽 2시입니다.${b.last ? ' 마지막 백업: ' + esc(b.last) : ''}</div>
      ${b.error ? `<div class="warnbox">${esc(b.error)}</div>` : ''}
      <div class="list">${(b.list || []).slice(0, 4).map((x) => `<div class="row"><span>${esc(x.name)} <span class="muted">${esc(x.at)}</span></span><a class="btn ghost sm" href="${esc(x.url)}" target="_blank" rel="noopener">열기</a></div>`).join('') || '<div class="muted">아직 백업이 없습니다.</div>'}</div>
      <div class="savebar"><button type="button" class="btn ghost" id="bkNow">지금 백업</button><button type="button" class="btn ghost" id="bkAuto">${b.on ? '매주 자동 백업 끄기' : '매주 자동 백업 켜기'}</button></div></section>`;
    $('bkNow').onclick = async () => { R.busy($('bkNow'), true, '백업 중…'); const x = await R.tryPost('r15BackupRun', {}); R.busy($('bkNow'), false); if (x && x.ok) { R.toast('백업했습니다', 'ok'); backup(); } };
    $('bkAuto').onclick = async () => { R.busy($('bkAuto'), true, '설정 중…'); const x = await R.tryPost('r15BackupSetup', { on: b.on ? '0' : '1' }); R.busy($('bkAuto'), false); if (x && x.ok) { R.toast(x.on ? '매주 자동 백업을 켰습니다' : '자동 백업을 껐습니다', 'ok'); backup(); } };
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
