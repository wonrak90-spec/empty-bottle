/* R15 저장 대기열
 * 사진과 기록을 먼저 단말(IndexedDB)에 보관하고, 서버가 저장을 확인해야 '서버 완료'로 바꾼다.
 * R14 대기열과 다른 점
 *  - 요청마다 시간 제한이 있어 응답 없는 요청 하나가 대기열 전체를 멈추지 않는다.
 *  - 다시 보내도 안 되는 실패(중복 Pallet 등)는 '확인 필요'로 빼고 다음 건을 계속 보낸다.
 *  - 같은 요청 ID로 다시 보내므로 응답만 끊긴 경우에도 서버에 두 번 저장되지 않는다.
 * 상태: hold(사진 인식 마무리 중, 사진은 먼저 올림) → pending(단말 보관) → done(서버 완료) / blocked(확인 필요)
 */
(function () {
  'use strict';
  const R = window.R15;
  const BACKOFF = [3, 8, 20, 45, 90, 180, 300];
  const KEEP_DONE_MS = 3 * 86400000;

  /* ---------- 저장소 (IndexedDB, 실패하면 메모리) ---------- */
  function idbStore() {
    let dbp = null;
    const open = () => dbp || (dbp = new Promise((res, rej) => {
      // iOS Safari: open()이 응답 없이 멈추는 경우가 있어 시간 제한을 둔다 (넘으면 메모리 보관으로 계속)
      let settled = false; const to = setTimeout(() => { if (!settled) { settled = true; rej(new Error('IndexedDB open timeout')); } }, 4000);
      const rq = indexedDB.open('empty-bottle-r15', 1);
      rq.onupgradeneeded = () => { rq.result.createObjectStore('jobs', { keyPath: 'id' }); };
      rq.onsuccess = () => { clearTimeout(to); const db = rq.result; if (settled) { try { db.close(); } catch (_) {} return; } settled = true; db.onclose = () => { dbp = null; }; db.onversionchange = () => { db.close(); dbp = null; }; res(db); };
      rq.onerror = () => { clearTimeout(to); if (!settled) { settled = true; rej(rq.error); } };
    }).catch((e) => { dbp = null; throw e; }));
    const once = async (mode, fn) => { const db = await open(); return new Promise((res, rej) => { const t = db.transaction('jobs', mode), st = t.objectStore('jobs'); const out = fn(st); t.oncomplete = () => res(out && out.result); t.onerror = () => rej(t.error || new Error('IndexedDB error')); t.onabort = () => rej(t.error || new Error('IndexedDB abort')); }); };
    // 백그라운드 후 "Connection to Indexed Database server lost" → 한 번 다시 연결해 본다
    const tx = async (mode, fn) => { try { return await once(mode, fn); } catch (e) { dbp = null; return once(mode, fn); } };
    return {
      kind: 'idb',
      all: () => tx('readonly', (st) => st.getAll()),
      put: (job) => tx('readwrite', (st) => { st.put(job); }),
      del: (id) => tx('readwrite', (st) => { st.delete(id); })
    };
  }
  function memStore() {
    const m = new Map();
    return { kind: 'memory', all: async () => [...m.values()].map((x) => JSON.parse(JSON.stringify(x))), put: async (j) => { m.set(j.id, JSON.parse(JSON.stringify(j))); }, del: async (id) => { m.delete(id); } };
  }

  const Q = R.queue = { store: null, jobs: [], running: false, paused: false, timer: 0, wake: null, unit: 1000 };

  function uuid() { return (crypto.randomUUID ? crypto.randomUUID() : 'r' + Date.now().toString(36) + Math.random().toString(36).slice(2)); }

  Q.init = async function (store) {
    Q.store = store || null;
    if (!Q.store) {
      try { Q.store = idbStore(); await Q.store.all(); }
      catch (e) { Q.store = memStore(); R.toast && R.toast('이 브라우저는 단말 보관을 못 합니다 · 저장 완료 전 앱을 닫지 마세요', 'crit'); }
    }
    Q.jobs = (await Q.store.all()) || [];
    const now = Date.now();
    for (const j of Q.jobs) {
      if (j.state === 'sending') { j.state = 'pending'; await Q.store.put(j); } // 앱이 보내는 중에 꺼졌던 건
      // 인식이 끝나기 전에 앱이 꺼진 건: 기록을 잃지 않게 확인필요로 보낸다
      if (j.state === 'hold') { j.state = 'pending'; j.payload.finalResult = '확인필요'; j.payload.note = [j.payload.note, '확인: 사진 인식 완료 전 앱 종료'].filter(Boolean).join(' / '); await Q.store.put(j); }
      if (j.state === 'done' && now - (j.doneAt || 0) > KEEP_DONE_MS) await Q.store.del(j.id);
    }
    Q.jobs = (await Q.store.all()) || [];
    changed();
    if (typeof window !== 'undefined' && window.addEventListener) {
      window.addEventListener('online', () => Q.kick());
      document.addEventListener('visibilitychange', () => { if (!document.hidden) Q.kick(); });
    }
    if (!Q.timer) Q.timer = setInterval(() => Q.kick(), 15000);
    Q.kick();
  };

  function changed() { R.emit('queue', Q.summary()); }
  Q.summary = function () {
    const c = { pending: 0, sending: 0, blocked: 0, done: 0 };
    Q.jobs.forEach((j) => { const st = j.state === 'hold' ? 'pending' : j.state; c[st] = (c[st] || 0) + 1; });
    return c;
  };
  Q.list = (filter) => Q.jobs.filter(filter || (() => true)).sort((a, b) => a.createdAt - b.createdAt);
  Q.find = (key, type) => Q.jobs.filter((j) => j.key === key && (!type || j.type === type)).sort((a, b) => b.createdAt - a.createdAt)[0] || null;

  async function save(job) {
    job.updatedAt = Date.now(); const i = Q.jobs.findIndex((x) => x.id === job.id); if (i >= 0) Q.jobs[i] = job; else Q.jobs.push(job);
    try { await Q.store.put(job); } catch (e) { await toMemory(e); }
    changed();
  }
  // 단말 저장소 쓰기가 실패하면(용량 초과·연결 끊김) 메모리 보관으로 바꿔서라도 계속 보낸다
  async function toMemory(e) {
    if (Q.store && Q.store.kind === 'memory') throw e;
    console.warn('[R15 queue] IndexedDB write failed, using memory', e);
    const m = memStore(); for (const j of Q.jobs) await m.put(j); Q.store = m;
    R.toast && R.toast('단말 보관 공간에 쓰지 못했습니다 · 서버 완료 전 앱을 닫지 마세요', 'crit');
  }

  // 검수 기록 추가. photos: {wms, vendor} dataURL. 반환: job
  Q.addInspect = async function (payload, photos, meta) {
    const job = { id: uuid(), type: 'inspect', state: meta && meta.hold ? 'hold' : 'pending', createdAt: Date.now(), attempts: 0, nextAt: 0,
      key: payload.inboundNo + '|' + Number(R.util.digits(payload.containerFrom)), label: meta && meta.label || '',
      payload, photos: photos || {}, urls: {}, lastError: '', result: null };
    await save(job); Q.kick(); return job;
  };
  // 인식이 끝나 값이 채워지면 보내기 시작한다
  Q.release = async function (id, payload) {
    const job = Q.jobs.find((j) => j.id === id); if (!job || job.state !== 'hold') return null;
    job.payload = Object.assign({}, job.payload, payload); job.state = 'pending'; job.nextAt = 0;
    job.key = job.payload.inboundNo + '|' + Number(R.util.digits(job.payload.containerFrom));
    await save(job); Q.kick(); return job;
  };
  // 생산 투입 추가
  Q.addLot = async function (productionId, items, meta) {
    const job = { id: uuid(), type: 'lot', state: 'pending', createdAt: Date.now(), attempts: 0, nextAt: 0,
      key: 'lot|' + productionId, label: meta && meta.label || '', payload: { productionId, items }, lastError: '', result: null };
    await save(job); Q.kick(); return job;
  };

  Q.retry = async function (id, patch) {
    const j = Q.jobs.find((x) => x.id === id); if (!j || j.state === 'done') return;
    if (patch) {
      Object.assign(j.payload, patch);
      if (j.type === 'inspect') j.key = j.payload.inboundNo + '|' + Number(R.util.digits(j.payload.containerFrom));
      // 값을 고치면 다른 요청이다. 같은 요청 ID를 쓰면 서버가 이전 결과(중복)를 돌려준다.
      j.prevIds = (j.prevIds || []).concat(j.id);
      await Q.store.del(j.id); Q.jobs = Q.jobs.filter((x) => x.id !== j.id); j.id = uuid();
    }
    j.state = 'pending'; j.nextAt = 0; j.attempts = 0; j.lastError = ''; await save(j); Q.kick();
  };
  // 이미 서버에 있는 기록으로 처리 (중복 Pallet일 때 작업자가 확인 후 선택)
  Q.resolveAsExisting = async function (id) {
    const j = Q.jobs.find((x) => x.id === id); if (!j) return;
    j.state = 'done'; j.doneAt = Date.now(); j.result = Object.assign({}, j.result, { existing: true }); j.photos = {}; await save(j);
  };
  Q.remove = async function (id) { await Q.store.del(id); Q.jobs = Q.jobs.filter((x) => x.id !== id); changed(); };

  Q.kick = function () { if (R.isGuest && R.isGuest()) return; /* Guest는 보낼 권한이 없다. 로그인하면 다시 보낸다 */ if (Q.wake) { const w = Q.wake; Q.wake = null; w(); } if (!Q.running) run().catch((e) => { console.warn('[R15 queue]', e); }); };

  function sleepUntilKick(ms) { return new Promise((res) => { const t = setTimeout(() => { Q.wake = null; res(); }, ms); Q.wake = () => { clearTimeout(t); res(); }; }); }

  async function run() {
    if (Q.running) return; Q.running = true;
    try {
      for (;;) {
        if (Q.paused) break;
        const now = Date.now();
        const ready = Q.list((j) => j.state === 'pending' && (j.nextAt || 0) <= now);
        if (!ready.length) {
          prefetch(Q.list((j) => j.state === 'hold').slice(0, 3));
          const next = Q.list((j) => j.state === 'pending').reduce((m, j) => Math.min(m, j.nextAt || 0), Infinity);
          if (next === Infinity) break;
          await sleepUntilKick(Math.max(200, next - Date.now()));
          continue;
        }
        prefetch(ready.slice(1, 3).concat(Q.list((j) => j.state === 'hold')).slice(0, 4));
        await process(ready[0]);
      }
    } finally { Q.running = false; }
  }

  function transient(job, msg) {
    job.attempts++; job.state = 'pending'; job.lastError = msg;
    job.nextAt = Date.now() + BACKOFF[Math.min(job.attempts - 1, BACKOFF.length - 1)] * Q.unit;
  }
  function blocked(job, msg, res) { job.state = 'blocked'; job.lastError = msg; job.result = res || null; }

  async function process(job) {
    job.state = 'sending'; await save(job);
    try {
      if (job.type === 'inspect') await sendInspect(job);
      else if (job.type === 'lot') await sendLot(job);
      else blocked(job, '알 수 없는 작업');
    } catch (e) {
      if (e && e.kind === 'auth') {
        transient(job, '로그인 필요'); job.attempts = 0; Q.paused = true;
        if (!Q.authHook) { Q.authHook = true; R.on('login', () => { Q.paused = false; Q.kick(); }); }
      }
      else transient(job, (e && e.message) || String(e));
    }
    await save(job);
  }

  // 사진 올리기는 기록 저장(서버 잠금)과 달리 동시에 해도 된다: WMS·업체 사진을 같이 올리고,
  // 앞 Pallet를 저장하는 동안 다음 Pallet 사진을 미리 올린다. 같은 사진은 한 번만 올린다.
  const inflight = {};
  function uploadOne(job, kind) {
    const k = job.id + '|' + kind; if (inflight[k]) return inflight[k];
    const p = job.payload;
    inflight[k] = R.apiPost('uploadPhoto', { image: job.photos[kind], name: `${p.inboundNo}_P${R.util.pad(R.util.digits(p.containerFrom), 2)}_${kind === 'wms' ? 'WMS' : 'VENDOR'}`,
      inboundNo: p.inboundNo, palletNo: Number(R.util.digits(p.containerFrom)), photoType: kind === 'wms' ? 'WMS' : 'VENDOR', dateKey: p.dateKey || '' }, window.R15_CONFIG.TIMEOUT.upload)
      .then(async (r) => { if (r && r.ok && r.url) { job.urls[kind] = r.url; await save(job); } return r; })
      .finally(() => { delete inflight[k]; });
    return inflight[k];
  }
  const needsUpload = (j) => j.type === 'inspect' && ['wms', 'vendor'].filter((k) => j.photos && j.photos[k] && !j.urls[k]);
  function prefetch(jobs) { jobs.forEach((j) => { (needsUpload(j) || []).forEach((k) => { uploadOne(j, k).catch(() => null); }); }); }

  async function sendInspect(job) {
    const p = job.payload;
    const res = await Promise.all(needsUpload(job).map((k) => uploadOne(job, k)));
    const bad = res.find((r) => !r || !r.ok || !r.url);
    if (bad !== undefined) return transient(job, '사진 업로드 실패' + (bad && bad.message ? ' · ' + bad.message : ''));
    const body = Object.assign({}, p, { client: 'r15', requestId: job.id, photoUrl: job.urls.wms || '', vendorPhotoUrl: job.urls.vendor || '' });
    const r = await R.apiPost('saveSingle', body);
    if (r && r.ok && r.id) {
      job.state = 'done'; job.doneAt = Date.now(); job.result = { id: r.id, duplicateRequest: !!r.duplicateRequest };
      job.photos = {}; // 서버에 저장된 것을 확인했으므로 단말 사진을 지운다
      return;
    }
    if (r && (r.retry || r.busy)) return transient(job, r.message || '서버 혼잡');
    if (r && r.duplicate) return blocked(job, '이미 저장된 Pallet입니다 · 번호를 확인하세요', { duplicateId: r.id, existingPhotoUrl: r.existingPhotoUrl || '', existingAt: r.existingAt || '', existingInspector: r.existingInspector || '' });
    return blocked(job, (r && r.message) || '저장 거부', r);
  }

  async function sendLot(job) {
    const r = await R.apiPost('r15LotAdd', Object.assign({ requestId: job.id }, job.payload));
    if (r && r.ok) { job.state = 'done'; job.doneAt = Date.now(); job.result = r; R.emit('lotSaved', { job, res: r }); return; }
    if (r && (r.retry || r.busy)) return transient(job, r.message || '서버 혼잡');
    return blocked(job, (r && r.message) || '투입 거부', r);
  }
})();
