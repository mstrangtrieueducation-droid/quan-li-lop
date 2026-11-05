/* Class operations app: static page, private link per person, an Apps Script server decides who can read or write what. */
const CONFIG = window.QL_CONFIG, Q = window.QL;
const TRACKER_TAB = 'THEO DÕI TOÀN DIỆN', ROSTER_LAST = 60, FRESH_MS = 300000;
const $ = id => document.getElementById(id);
const esc = v => String(v == null ? '' : v).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const today = () => Q.iso(new Date());
const minutesNow = () => { const d = new Date(); return d.getHours() * 60 + d.getMinutes(); };
const stamp = () => { const d = new Date(), p = n => String(n).padStart(2, '0'); return p(d.getDate()) + '/' + p(d.getMonth() + 1) + '/' + d.getFullYear() + ' ' + p(d.getHours()) + ':' + p(d.getMinutes()) + ':' + p(d.getSeconds()); };
const ERROR_TYPES = ['Đi muộn', 'Quên điểm danh', 'Chưa nhập A/B/F', 'Chưa mở cột', 'Chấm bài trễ hạn', 'Trả bài trễ hạn', 'Khác'];

/* ---------- Storage on this device: IndexedDB, because localStorage on this address is full ---------- */
let dbHandle = null;
const saved = new Map();
function openStore() {
  return new Promise(done => {
    try {
      const open = indexedDB.open(CONFIG.store || 'quanlilop', 1);
      open.onupgradeneeded = () => open.result.createObjectStore('kv');
      open.onerror = () => done();
      open.onsuccess = () => {
        dbHandle = open.result;
        const items = dbHandle.transaction('kv').objectStore('kv').openCursor();
        items.onsuccess = () => { const c = items.result; if (c) { saved.set(c.key, c.value); c.continue(); } else done(); };
        items.onerror = () => done();
      };
    } catch (e) { done(); }
  });
}
function keep(k, v) {
  saved.set(k, v);
  try { if (dbHandle) dbHandle.transaction('kv', 'readwrite').objectStore('kv').put(v, k); } catch (e) { /* the copy in memory still works */ }
}

/* ---------- Private link ---------- */
// The link carries the key after #, which never reaches the page host. It stays on this device so the plain address works afterwards.
let accessKey = null;
function readKey() {
  const m = location.hash.match(/k=([A-Za-z0-9_-]{24,})/);
  if (m) { keep('key', m[1]); history.replaceState(null, '', location.pathname + location.search); return m[1]; }
  return saved.get('key') || null;
}
function showLogin(expired) {
  $('app').hidden = true; $('login').hidden = false;
  $('loginMsg').textContent = expired ? T('Link này không còn hiệu lực. Vui lòng xin quản lí link mới.', 'This link no longer works. Please ask the manager for a new one.') : '';
}
async function call(op, args, attempts) {
  if (!accessKey) { showLogin(false); throw new Error('Cần mở bằng link riêng.'); }
  const body = JSON.stringify(Object.assign({ k: accessKey, op }, args));
  let last = null;
  for (let k = 0; k < (attempts || 3); k++) {
    if (k) await new Promise(r => setTimeout(r, 3000 * k));
    try {
      const r = await fetch(CONFIG.server, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body });
      const d = await r.json();
      if (d.ok) return d.data;
      last = new Error(d.error || 'Lỗi máy chủ');
      last.status = d.status;
      if (d.status === 401) { accessKey = null; keep('key', ''); showLogin(true); throw last; }
      if (d.status < 500 && d.status !== 429) throw last;
    } catch (e) { last = e; if (e.status && e.status < 500 && e.status !== 429) throw e; }
  }
  throw last;
}
// The server asks Google with a URL, and Apps Script refuses one over about 2000 characters.
const BATCH_RANGES = 20;
const batchGet = async (file, ranges) => {
  const parts = [];
  for (let i = 0; i < ranges.length; i += BATCH_RANGES) parts.push(ranges.slice(i, i + BATCH_RANGES));
  const got = await Promise.all(parts.map(part => call('get', { file, ranges: part }).then(d => d.values)));
  return got.flat();
};
const batchWrite = (file, data) => call('set', { file, data }, 2);
const appendRows = (file, tab, rows) => call('add', { file, tab, rows }, 2);
const quote = tab => "'" + tab + "'";

/* ---------- State ---------- */
let me = null, people = [], classList = [], tabs = [], weeks = {}, logs = { marks: null, staff: null, errors: null }, trackers = {};
let view = 'lich', panel = 'cong', day = today(), current = null, notices = [], filters = { site: '', person: '', showAll: false, task: 'can', month: today().slice(0, 7), payMonth: today().slice(0, 7), payPerson: '' }, drafts = {}, loadError = '';
const isManager = () => me && /quản lí|quản lý|chủ/i.test(me.role);
let lang = 'vi';
const T = (vi, en) => lang === 'en' ? en : vi;
const dayLabel = s => Q.dayText(s, lang);

function say(text, kind) { notices = notices.filter(n => n.text !== text); notices.push({ text, kind: kind || '' }); render(); }

/* ---------- Reading ---------- */
function setWeek(tab, rows) {
  keep('week:' + tab, { rows, at: Date.now() });
  return (weeks[tab] = { data: Q.parseWeek(rows), pay: Q.parsePay(rows, tab), at: Date.now(), tab });
}
// A saved copy shows at once; an old one refreshes quietly and redraws.
function weekOf(target, force) {
  const tab = Q.weekTab(tabs, target);
  if (!tab) return Promise.resolve(null);
  const have = weeks[tab], stored = saved.get('week:' + tab);
  if (!have && stored) { setWeek(tab, stored.rows); weeks[tab].at = stored.at; }
  const hit = weeks[tab];
  if (hit && !force && Date.now() - hit.at < FRESH_MS) return Promise.resolve(hit);
  const read = batchGet(CONFIG.scheduleId, [quote(tab) + '!A1:M400']).then(([rows]) => {
    return setWeek(tab, rows);
  });
  if (hit) { read.then(render).catch(() => {}); return Promise.resolve(hit); }
  return read;
}
const markOf = r => ({ at: r[0], day: r[1], cls: r[2], lesson: r[3], time: r[4], name: r[6], eng: r[7], status: r[8], contact: r[9] || '', note: r[10] || '', by: r[11] || '' });
const markKey = m => [m.day, Q.key(m.cls), m.lesson, m.time, m.name].join('|');
const staffOfRow = r => ({ at: r[0], day: r[1], person: r[2], role: r[3], cls: r[4], time: r[5], due: r[6], status: r[7], minutes: r[8] || '', note: r[9] || '', by: r[10] || '' });
const staffKey = r => [r.day, Q.key(r.cls), r.time, Q.key(r.person)].join('|');
const errorOf = r => ({ id: r[0], at: r[1], day: r[2], person: r[3], cls: r[4], type: r[5], text: r[6], status: r[7], by: r[8] || '' });
async function loadMarks(force) {
  if (logs.marks && !force && Date.now() - logs.marks.at < 60000) return;
  const [rows] = await batchGet(CONFIG.diemDanhId, ['DIEM_DANH!A2:L']);
  logs.marks = { rows: rows.map(markOf), at: Date.now() };
  mergeOutbox();
}
async function loadManager(force) {
  if (logs.staff && !force && Date.now() - logs.staff.at < 60000) return;
  const [cong, loi] = await batchGet(CONFIG.quanLiId, ['CONG!A2:K', 'LOI!A2:I']);
  logs.staff = { rows: cong.map(staffOfRow), at: Date.now() };
  logs.errors = { rows: loi.map(errorOf), at: Date.now() };
  mergeOutbox();
}
// Rows waiting in the outbox belong on screen too, or a refresh would undo a tick for a moment.
function mergeOutbox() {
  outbox.filter(x => x.kind === 'append').forEach(x => {
    if (x.tab === 'DIEM_DANH' && logs.marks) logs.marks.rows.push(markOf(x.row));
    if (x.tab === 'CONG' && logs.staff) logs.staff.rows.push(staffOfRow(x.row));
    if (x.tab === 'LOI' && logs.errors) logs.errors.rows.push(errorOf(x.row));
  });
}
async function loadTracker(cls, force) {
  const hit = trackers[cls.key];
  if (hit && !force && Date.now() - hit.at < FRESH_MS) return hit;
  const tab = quote(TRACKER_TAB);
  const [head, roster] = await batchGet(cls.tracker, [tab + '!A1:4', tab + '!A5:E' + ROSTER_LAST]);
  const year = new Date().getFullYear();
  const pupils = [];
  roster.forEach((r, i) => { if (/^\d+$/.test(Q.clean(r[0])) && Q.clean(r[1])) pupils.push(Object.assign(Q.pupilOf([r[1], r[2]], i + 5), { phone: Q.clean(r[4]) })); });
  const blocks = Q.trackerBlocks(head, year), practices = Q.practiceColumns(head, year);
  const from = Q.addDays(today(), -30);
  const wanted = new Set();
  blocks.filter(b => !b.date || b.date >= from).forEach(b => { if (b.grade >= 0) wanted.add(b.grade); if (b.stars >= 0) wanted.add(b.stars); b.videos.forEach(v => wanted.add(v.col)); });
  practices.filter(p => p.due >= from).forEach(p => wanted.add(p.col));
  const cols = [...wanted];
  const data = cols.length ? await batchGet(cls.tracker, cols.map(c => tab + '!' + Q.colName(c) + '5:' + Q.colName(c) + ROSTER_LAST)) : [];
  const values = {};
  cols.forEach((c, i) => { values[c] = data[i]; });
  const cell = (row, col) => ((values[col] || [])[row - 5] || [])[0] || '';
  const set = (row, col, v) => { const list = values[col] = values[col] || []; list[row - 5] = [v]; };
  return (trackers[cls.key] = { at: Date.now(), pupils, blocks, practices, cell, set });
}

/* ---------- Writing: everything goes through one outbox kept on the device ---------- */
let outbox = [], flushTimer = null, flushing = false, flushFailed = false;
function queue(item) { outbox.push(item); keep('outbox', outbox); paintSave(); clearTimeout(flushTimer); flushTimer = setTimeout(flush, 1000); }
function paintSave() {
  const el = $('saveState');
  el.className = flushFailed ? 'err' : '';
  el.textContent = flushFailed ? T('Chưa ghi được ' + outbox.length + ' mục', outbox.length + ' not saved yet') : outbox.length ? T('Đang ghi ' + outbox.length + ' mục…', 'Saving ' + outbox.length + '…') : T('Đã lưu về sheet', 'Saved to sheet');
}
async function flush() {
  if (flushing || !outbox.length) return;
  flushing = true;
  const batch = outbox.slice();
  try {
    const appends = {};
    batch.filter(x => x.kind === 'append').forEach(x => { const k = x.file + '|' + x.tab; (appends[k] = appends[k] || { file: x.file, tab: x.tab, rows: [] }).rows.push(x.row); });
    for (const a of Object.values(appends)) await appendRows(a.file, a.tab, a.rows);
    // Rows are in the sheet now, so a retry below must not send them twice.
    outbox = outbox.filter(x => x.kind !== 'append' || !batch.includes(x));
    const byFile = {};
    batch.filter(x => x.kind === 'cell').forEach(x => { (byFile[x.file] = byFile[x.file] || []).push(x); });
    for (const [file, items] of Object.entries(byFile)) await writeCells(file, items);
    outbox = outbox.filter(x => !batch.includes(x));
    flushFailed = false;
  } catch (e) {
    flushFailed = true;
    if (e.status === 403) say(T('Tài khoản này chưa có quyền ghi phần đó. Việc vẫn được giữ trên máy, báo quản lí giúp.', 'This Gmail cannot write to the file yet. Your work is kept on this device; please tell the manager.'), 'bad');
    else setTimeout(flush, 15000);
  }
  keep('outbox', outbox);
  flushing = false;
  paintSave();
  if (outbox.length && !flushFailed) flush();
}
// A cell changed by someone else since we read it is never overwritten; the person is told instead.
async function writeCells(file, items) {
  const last = new Map();
  items.forEach(x => { const seen = last.get(x.range); last.set(x.range, seen ? Object.assign({}, x, { expected: seen.expected }) : x); });
  const list = [...last.values()], now = await batchGet(file, list.map(x => x.range)), data = [];
  list.forEach((x, i) => {
    const value = ((now[i] || [])[0] || [])[0] || '';
    if (value === x.value) return;
    if (value !== x.expected) { conflict(x, value); return; }
    data.push({ range: x.range, values: [[x.value]] });
  });
  if (data.length) await batchWrite(file, data);
}
function conflict(x, value) {
  const hit = trackers[x.classKey];
  if (hit) hit.set(x.row, x.col, value);
  say(x.label + T(': ô đã có "' + Q.clean(value).slice(0, 40) + '" do người khác ghi, app không ghi đè.', ': someone else wrote "' + Q.clean(value).slice(0, 40) + '" here, so it was not overwritten.'), 'bad');
}

/* ---------- Actions ---------- */
function appendMark(session, pupil, status, contact, note) {
  const row = [stamp(), session.day, session.cls, session.lesson, Q.clock(session.start), pupil.row, pupil.name, pupil.eng, status, contact || '', note || '', me.name];
  logs.marks.rows.push(markOf(row));
  queue({ kind: 'append', file: CONFIG.diemDanhId, tab: 'DIEM_DANH', row });
}
const marksOf = session => {
  const prefix = [session.day, session.classKey, session.lesson, Q.clock(session.start)].join('|') + '|', out = new Map();
  (logs.marks ? logs.marks.rows : []).forEach(m => { const k = markKey(m); if (k.startsWith(prefix)) out.set(m.name, m); });
  return out;
};
function gradeCell(cls, tracker, block, pupil, value, label) {
  const col = block.grade, range = quote(TRACKER_TAB) + '!' + Q.colName(col) + pupil.row, expected = tracker.cell(pupil.row, col);
  tracker.set(pupil.row, col, value);
  queue({ kind: 'cell', file: cls.tracker, classKey: cls.key, range, row: pupil.row, col, expected, value, label });
}
function tickPupil(ctx, pupil) {
  const m = ctx.marks.get(pupil.name), on = m && Q.PRESENT.includes(m.status);
  appendMark(ctx.session, pupil, on ? 'Bỏ tick' : Q.tickStatus(ctx.session, today(), minutesNow()), m && m.contact);
  render();
}
function setGrade(ctx, pupil, grade) {
  const { block, tracker, cls, session } = ctx, current = tracker.cell(pupil.row, block.grade), had = Q.gradeOf(current);
  if (current && !had) return say(pupil.eng + T(': ô điểm đang có ghi chú, vui lòng sửa trực tiếp trong sheet.', ': this cell holds a note, please edit it in the sheet.'), 'bad');
  gradeCell(cls, tracker, block, pupil, had === grade ? '' : grade, pupil.eng + ' · ' + session.lesson);
  // A pupil with a grade was in class.
  const m = ctx.marks.get(pupil.name);
  if (had !== grade && !(m && Q.PRESENT.includes(m.status))) appendMark(session, pupil, Q.tickStatus(session, today(), minutesNow()));
  render();
}
function setAbsence(ctx, pupil, status) {
  const m = ctx.marks.get(pupil.name);
  appendMark(ctx.session, pupil, status, m && m.contact, m && m.note);
  // The tracker only learns of an absence once it is confirmed, and only an empty cell is written.
  if (ctx.block && ctx.block.grade >= 0 && !ctx.tracker.cell(pupil.row, ctx.block.grade)) gradeCell(ctx.cls, ctx.tracker, ctx.block, pupil, '/\nCon vắng mặt!', pupil.eng + ' · ' + ctx.session.lesson);
  render();
}
/* ---------- Lên lớp: stars and absence on the classroom touch screen ---------- */
const NGHI = 'GV báo nghỉ';
const starsOf = (ctx, p) => { const v = ctx.block && ctx.block.stars >= 0 ? Q.clean(ctx.tracker.cell(p.row, ctx.block.stars)) : ''; return /^\d+$/.test(v) ? Number(v) : 0; };
function canTeach(s) { return isManager() || ([s.teacher, s.ta, s.video].some(n => Q.nameKey(n) === Q.nameKey(me.name)) && Q.rollCall(s, marksOf(s), today(), minutesNow()).open); }
// Everyone moves to their new place smoothly, so the class sees who overtook whom.
function withMoves(work) {
  const before = new Map([...document.querySelectorAll('.ll-row')].map(el => [el.dataset.name, el.getBoundingClientRect().top]));
  work();
  document.querySelectorAll('.ll-row').forEach(el => { const was = before.get(el.dataset.name); if (was == null) return; const by = was - el.getBoundingClientRect().top; if (by && el.animate) el.animate([{ transform: 'translateY(' + by + 'px)' }, { transform: 'none' }], { duration: 350, easing: 'ease-out' }); });
}
function setStars(ctx, pupil, count) {
  const { block, tracker, cls, session } = ctx;
  if (!block || block.stars < 0) return say(T('Tiết này chưa có cột Số sao trong sheet lớp, TA mở cột giúp.', 'This lesson has no star column yet, TA please open it.'), 'bad');
  const current = Q.clean(tracker.cell(pupil.row, block.stars));
  if (current && !/^\d+$/.test(current)) return say(pupil.eng + T(': ô Số sao đang có ghi chú, vui lòng sửa trong sheet.', ': the star cell holds a note, please edit it in the sheet.'), 'bad');
  const value = Math.max(0, Math.min(99, count)), range = quote(TRACKER_TAB) + '!' + Q.colName(block.stars) + pupil.row, expected = tracker.cell(pupil.row, block.stars);
  tracker.set(pupil.row, block.stars, value ? String(value) : '');
  queue({ kind: 'cell', file: cls.tracker, classKey: cls.key, range, row: pupil.row, col: block.stars, expected, value: value || '', label: pupil.eng + ' · ' + T('Số sao', 'Stars') });
  // A star means the pupil is in class.
  const m = ctx.marks.get(pupil.name);
  if (value && !(m && Q.PRESENT.includes(m.status))) appendMark(session, pupil, Q.tickStatus(session, today(), minutesNow()), m && m.contact);
}
function viewLenLop() {
  const ctx = classContext(current), s = ctx.session;
  if (!ctx.tracker) return '<div class="card empty">' + T('Đang đọc sheet lớp…', 'Reading the class sheet…') + '</div>';
  const roll = Q.rollCall(s, ctx.marks, today(), minutesNow()), edit = canTeach(s);
  const rows = ctx.tracker.pupils.map((p, i) => { const m = ctx.marks.get(p.name); return { p, i, stars: starsOf(ctx, p), off: !!m && (m.status === NGHI || Q.ABSENT.includes(m.status)), here: !!m && Q.PRESENT.includes(m.status) }; })
    .sort((a, b) => a.off - b.off || b.stars - a.stars || (a.p.eng || a.p.name).localeCompare(b.p.eng || b.p.name, 'vi'));
  const scores = rows.filter(r => !r.off && r.stars).map(r => r.stars), medal = ['🥇', '🥈', '🥉'];
  const unmarked = rows.filter(r => !r.off && !r.here).length;
  let h = '<div class="ll-head"><button class="quiet" data-act="llExit" aria-label="' + T('Thoát', 'Exit') + '">‹</button><div class="ll-title"><b>' + esc(s.cls) + T(' · Tiết ', ' · Lesson ') + esc(s.lesson) + '</b><span>' + sessionTime(s) + ' · ' + rows.filter(r => !r.off).length + '/' + rows.length + T(' có mặt', ' here') + '</span></div>' +
    (edit && unmarked ? '<button class="primary" data-act="llAll">' + T('Còn lại có mặt', 'Rest are here') + '</button>' : '') + '</div>';
  if (ctx.problem || (ctx.block && ctx.block.stars < 0)) h += '<div class="notice">' + esc(columnWarning(ctx) || T('Tiết này chưa có cột Số sao trong sheet lớp, TA mở cột giúp.', 'This lesson has no star column yet, TA please open it.')) + '</div>';
  if (!edit) h += '<div class="notice">' + T('Buổi này chưa mở hoặc không phân công cho bạn, chỉ xem được.', 'This session is not open or not assigned to you, view only.') + '</div>';
  h += '<div class="ll-list" role="list">' + rows.map(r => {
    const rank = r.off || !r.stars ? 0 : scores.indexOf(r.stars) + 1, name = r.p.eng || r.p.name, dis = edit ? '' : ' disabled';
    return '<div class="ll-row' + (r.off ? ' off' : rank === 1 ? ' top' : '') + '" role="listitem" data-name="' + esc(r.p.name) + '">' +
      '<button class="ll-main" data-act="llStar" data-i="' + r.i + '"' + (r.off ? ' disabled' : dis) + ' aria-label="' + T('Thêm 1 sao cho ', 'Add a star for ') + esc(name) + '"><span class="ll-rank">' + (r.off ? '' : rank ? (medal[rank - 1] || rank) : '') + '</span><span class="ll-name">' + esc(name) + '</span></button>' +
      (r.off ? '<span class="ll-off">' + T('Nghỉ', 'Absent') + '</span>' : '<button class="ll-count" data-act="llType" data-i="' + r.i + '"' + dis + ' aria-label="' + T('Nhập số sao của ', 'Type stars for ') + esc(name) + '">⭐ ' + r.stars + '</button><button class="ll-minus" data-act="llMinus" data-i="' + r.i + '"' + (r.stars ? dis : ' disabled') + ' aria-label="' + T('Bớt 1 sao của ', 'Remove a star from ') + esc(name) + '">−</button>') +
      '<button class="ll-absent" data-act="llOff" data-i="' + r.i + '" aria-pressed="' + r.off + '"' + dis + '>' + (r.off ? T('Có mặt', 'Here') : T('Nghỉ', 'Absent')) + '</button></div>';
  }).join('') + '</div>';
  return h;
}
function llAction(act, i) {
  const ctx = classContext(current), pupil = ctx.tracker.pupils[Number(i)];
  if (act === 'llExit') { view = 'lop'; document.body.classList.remove('lenlop'); render(); return; }
  if (act === 'llAll') {
    withMoves(() => { ctx.tracker.pupils.forEach(p => { const m = ctx.marks.get(p.name); if (!m || !(m.status === NGHI || Q.ABSENT.includes(m.status) || Q.PRESENT.includes(m.status))) appendMark(ctx.session, p, Q.tickStatus(ctx.session, today(), minutesNow()), m && m.contact); }); render(); });
    return;
  }
  if (act === 'llStar') withMoves(() => { setStars(ctx, pupil, starsOf(ctx, pupil) + 1); render(); });
  if (act === 'llMinus') withMoves(() => { setStars(ctx, pupil, starsOf(ctx, pupil) - 1); render(); });
  if (act === 'llType') {
    const text = window.prompt(T('Số sao của ', 'Stars for ') + (pupil.eng || pupil.name), String(starsOf(ctx, pupil)));
    if (text === null) return;
    if (!/^\s*\d{1,2}\s*$/.test(text)) return say(T('Hãy nhập một số từ 0 đến 99.', 'Please type a number from 0 to 99.'), 'bad');
    withMoves(() => { setStars(ctx, pupil, Number(text)); render(); });
  }
  if (act === 'llOff') {
    const m = ctx.marks.get(pupil.name), off = m && (m.status === NGHI || Q.ABSENT.includes(m.status));
    withMoves(() => { appendMark(ctx.session, pupil, off ? Q.tickStatus(ctx.session, today(), minutesNow()) : NGHI, m && m.contact, m && m.note); render(); });
  }
}

function setContact(ctx, pupil) {
  const m = ctx.marks.get(pupil.name);
  appendMark(ctx.session, pupil, m ? m.status : 'Chưa rõ', m && m.contact ? '' : 'Đã liên hệ', m && m.note);
  render();
}
function markStaff(s, p, status) {
  const k = staffKey({ day: s.day, cls: s.cls, time: Q.clock(s.start), person: p.name }), old = staffLatest().get(k);
  const undo = old && old.status === status;
  const live = s.day === today() && minutesNow() <= s.end ? Q.lateMinutes(s, minutesNow()) : 0, minutes = status === 'Muộn' && !undo ? (drafts['late:' + k] || (old && old.minutes) || live || '') : '';
  const row = [stamp(), s.day, p.name, p.role, s.cls, Q.clock(s.start), Q.clock(p.due), undo ? 'Bỏ chấm' : status, String(minutes), drafts['note:' + k] != null ? drafts['note:' + k] : (old && old.note) || '', me.name];
  logs.staff.rows.push(staffOfRow(row));
  queue({ kind: 'append', file: CONFIG.quanLiId, tab: 'CONG', row });
  render();
}
const staffLatest = () => Q.latest(logs.staff ? logs.staff.rows : [], staffKey);
function saveError() {
  const d = drafts.err || {};
  if (!d.person || !d.text) return say('Chọn người và ghi nội dung lỗi.', 'bad');
  const row = [Date.now().toString(36), stamp(), d.day || day, d.person, d.cls || '', d.type || ERROR_TYPES[0], d.text, 'Mở', me.name];
  logs.errors.rows.push(errorOf(row));
  queue({ kind: 'append', file: CONFIG.quanLiId, tab: 'LOI', row });
  drafts.err = {};
  render();
}
function closeError(id) {
  const e = Q.latest(logs.errors.rows, r => r.id).get(id);
  const row = [e.id, stamp(), e.day, e.person, e.cls, e.type, e.text, e.status === 'Mở' ? 'Đã xử lý' : 'Mở', me.name];
  logs.errors.rows.push(errorOf(row));
  queue({ kind: 'append', file: CONFIG.quanLiId, tab: 'LOI', row });
  render();
}
// Ticks DONE in the Schedule panel. The panel is rebuilt by its own script, so the row is checked first.
async function tickTask(week, task) {
  try {
    const [[r]] = await batchGet(CONFIG.scheduleId, [quote(week.tab) + '!A' + task.row + ':D' + task.row]);
    if (!r || Q.clean(r[3]) !== task.what) { await weekOf(day, true); return say('Danh sách việc vừa đổi, vui lòng bấm lại.', 'bad'); }
    await batchWrite(CONFIG.scheduleId, [{ range: quote(week.tab) + '!A' + task.row, values: [[task.done ? 'FALSE' : 'TRUE']] }]);
    task.done = !task.done;
    saved.delete('week:' + week.tab);
    render();
  } catch (e) { say('Chưa tick được: ' + e.message, 'bad'); }
}

/* ---------- Pieces of the page ---------- */
const sessionTime = s => Q.clock(s.start) + '–' + Q.clock(s.end);
const classOf = s => classList.find(c => c.key === s.classKey);
function sessionCard(s) {
  const c = classOf(s), peopleLine = [s.teacher && T('GV ', 'Teacher ') + s.teacher, s.ta && 'TA ' + s.ta, s.video && T('Quay ', 'Video ') + s.video].filter(Boolean).join(' · ');
  const inner = '<div class="session-top"><time>' + sessionTime(s) + '</time><strong>' + esc(s.cls) + '</strong>' + (s.off ? '<span class="tag bad">' + T('Nghỉ', 'Off') + '</span>' : '') + '<span class="spacer"></span><span class="room">' + esc(s.site || T('Chưa ghi phòng', 'No room listed')) + '</span></div>' +
    (s.book ? '<div>' + esc(s.book) + (s.lesson ? T(' · Tiết ', ' · Lesson ') + esc(s.lesson) : '') + '</div>' : '') +
    (s.detail ? '<div class="detail">' + esc(s.detail) + '</div>' : '') +
    (s.also.length ? '<div class="detail">' + T('Cùng buổi: ', 'Same session: ') + esc(s.also.join(', ')) + '</div>' : '') +
    (peopleLine ? '<div class="small muted">' + esc(peopleLine) + '</div>' : '') +
    (s.breakAt ? '<div class="small muted">' + T('Giải lao ', 'Break ') + esc(s.breakAt) + '</div>' : '') +
    (s.note ? '<div><span class="tag warn">' + esc(s.note.replace(/\n/g, ' · ')) + '</span></div>' : '');
  return c ? '<button class="card session link' + (s.off ? ' off' : '') + '" data-act="open" data-row="' + s.row + '">' + inner + '</button>' : '<div class="card session' + (s.off ? ' off' : '') + '">' + inner + '</div>';
}
const dayBar = () => '<div class="daybar"><button data-act="day" data-n="-1" aria-label="' + T('Hôm trước', 'Previous day') + '">‹</button><b>' + esc(dayLabel(day)) + '</b>' + (day !== today() ? '<button class="quiet" data-act="today">' + T('Hôm nay', 'Today') + '</button>' : '') + '<button data-act="day" data-n="1" aria-label="' + T('Hôm sau', 'Next day') + '">›</button></div>';

function viewSchedule(week) {
  if (!week) return dayBar() + '<div class="card empty">' + T('File Schedule chưa có tuần này.', 'This week is not on the Schedule yet.') + '</div>';
  const all = week.data.sessions.filter(s => s.day === day).sort((a, b) => a.start - b.start);
  const list = isManager() && filters.showAll ? all : Q.mine(all, me.name);
  const myTasks = week.data.tasks.filter(t => !t.done && [t.teacher, t.ta].some(n => Q.nameKey(n) === Q.nameKey(me.name)));
  let h = dayBar();
  if (isManager()) h += '<div class="tabs"><button class="' + (filters.showAll ? '' : 'on') + '" data-act="scope" data-v="">Lịch của tôi</button><button class="' + (filters.showAll ? 'on' : '') + '" data-act="scope" data-v="1">Cả trung tâm</button></div>';
  h += list.length ? '<div class="list">' + list.map(sessionCard).join('') + '</div>' : '<div class="card empty">' + T('Không có buổi nào trong ngày này.', 'No sessions on this day.') + '</div>';
  if (myTasks.length) h += '<h2>' + T('Việc quan trọng của tôi', 'My important tasks') + '</h2><div class="list">' + myTasks.map(t => taskRow(t, week, false)).join('') + '</div>';
  return h;
}

function classContext(session) {
  const cls = classOf(session), tracker = trackers[cls.key], marks = marksOf(session);
  const found = tracker ? Q.findBlock(tracker.blocks, session) : { block: null, problem: '' };
  return { session, cls, tracker, marks, block: found.block, problem: found.problem };
}
function columnWarning(ctx) {
  const s = ctx.session;
  if (ctx.problem === 'thieu') return T('Chưa có cột cho tiết ' + s.lesson + ' trong sheet lớp. Điểm danh vẫn lưu, A/B/F chưa ghi được cho đến khi TA mở cột.', 'Lesson ' + s.lesson + ' has no column in the class sheet yet. Attendance still saves; A/B/F needs the TA to open the column.');
  if (ctx.problem === 'ngay') return T('Cột tiết ' + s.lesson + ' đang ghi ngày ' + (ctx.block.date ? dayLabel(ctx.block.date) : 'không đọc được') + ', Schedule là ' + dayLabel(s.day) + '. TA kiểm tra lại giúp.', 'The column for lesson ' + s.lesson + ' shows ' + (ctx.block.date ? dayLabel(ctx.block.date) : 'an unreadable date') + ', the Schedule says ' + dayLabel(s.day) + '. TA please check.');
  if (ctx.problem === 'tiet') return T('Cột ngày này ghi tiết ' + (ctx.block.lesson || 'trống') + ', Schedule là tiết ' + s.lesson + '. TA kiểm tra lại giúp.', 'The column for this day shows lesson ' + (ctx.block.lesson || 'blank') + ', the Schedule says lesson ' + s.lesson + '. TA please check.');
  if (ctx.block && ctx.block.grade < 0) return T('Cột tiết ' + s.lesson + ' chưa có ô bài tập giấy.', 'The column for lesson ' + s.lesson + ' has no paper homework cell.');
  return '';
}
const videoLabel = label => lang === 'en' ? ({ 'NGU PHAP': 'grammar', 'TU VUNG': 'vocabulary', 'DOC': 'reading' }[Q.key(label)] || label) : label.toLowerCase();
const stateText = st => lang === 'en' ? ({ 'Vắng chờ xác minh': 'Absent, awaiting check', 'Có phép': 'Excused', 'Không phép': 'Unexcused' }[st] || st) : st;
function viewClass() {
  const ctx = classContext(current), s = ctx.session, tracker = ctx.tracker;
  const assigned = [s.teacher, s.ta, s.video].some(n => Q.nameKey(n) === Q.nameKey(me.name));
  const roll = Q.rollCall(s, ctx.marks, today(), minutesNow()), canEdit = isManager() || (assigned && roll.open);
  let h = '<div><button class="quiet" data-act="back">‹ ' + T('Lịch', 'Schedule') + '</button></div><div class="card class-head"><h1>' + esc(s.cls) + T(' · Tiết ', ' · Lesson ') + esc(s.lesson) + '</h1>' +
    '<div>' + esc(dayLabel(s.day)) + ' · <b>' + sessionTime(s) + '</b> · <span class="room">' + esc(s.site || T('Chưa ghi phòng', 'No room listed')) + '</span></div>' +
    '<div class="detail">' + esc(s.book) + (s.detail ? '\n' + esc(s.detail) : '') + '</div>' +
    '<div class="small muted">' + esc([T('GV ', 'Teacher ') + s.teacher, s.ta && 'TA ' + s.ta, s.video && T('Quay ', 'Video ') + s.video].filter(Boolean).join(' · ')) + '</div>' +
    (s.note ? '<div><span class="tag warn">' + esc(s.note.replace(/\n/g, ' · ')) + '</span></div>' : '') + '</div>';
  if (!tracker) return h + '<div class="card empty">' + T('Đang đọc sheet lớp…', 'Reading the class sheet…') + '</div>';
  const warning = columnWarning(ctx);
  if (warning) h += '<div class="notice">' + esc(warning) + '</div>';
  h += '<button class="primary ll-open" data-act="llOpen">⭐ ' + T('Mở màn hình lên lớp', 'Open classroom screen') + '</button>';
  const present = tracker.pupils.filter(p => { const m = ctx.marks.get(p.name); return m && Q.PRESENT.includes(m.status); }).length;
  const waiting = tracker.pupils.filter(p => Q.pupilState(ctx.marks.get(p.name), roll) === 'Vắng chờ xác minh').length;
  h += '<div class="count"><span>' + present + '/' + tracker.pupils.length + T(' có mặt', ' present') + '</span>' +
    (roll.noRollCall ? '<span class="tag bad">' + T('Chưa điểm danh', 'Attendance not taken') + '</span>' : roll.past ? (waiting ? '<span class="tag bad">' + waiting + T(' vắng chờ xác minh', ' absent, awaiting check') + '</span>' : '<span class="tag ok">' + T('Đủ', 'All here') + '</span>') : '<span class="tag">' + T('Chốt lúc ', 'Closes at ') + Q.clock(roll.closeAt) + '</span>') + '</div>';
  if (!canEdit) h += '<div class="notice">' + (assigned ? T('Điểm danh mở trước giờ học ' + Q.OPEN_BEFORE + ' phút.', 'Attendance opens ' + Q.OPEN_BEFORE + ' minutes before class.') : T('Chỉ xem được, buổi này không phân công cho Gmail này.', 'View only: this session is not assigned to this Gmail.')) + '</div>';
  const owed = Q.owedVideos(tracker.pupils, tracker.blocks, tracker.practices, tracker.cell, s);
  h += '<div class="card">' + tracker.pupils.map((p, i) => {
    const m = ctx.marks.get(p.name), on = m && Q.PRESENT.includes(m.status), state = Q.pupilState(m, roll), value = ctx.block && ctx.block.grade >= 0 ? tracker.cell(p.row, ctx.block.grade) : '', g = Q.gradeOf(value);
    const grades = ctx.block && ctx.block.grade >= 0 ? '<div class="grades">' + ['A+', 'B', 'F'].map(x => '<button class="' + (g === x ? 'on ' : '') + x[0] + '" data-act="grade" data-i="' + i + '" data-v="' + x + '"' + (canEdit ? '' : ' disabled') + '>' + x + '</button>').join('') + '</div>' : '<div></div>';
    const owedText = owed[i].map(o => (o.practice ? T(o.label, o.label.replace('Tự luyện video', 'Self-study video').replace('Tự luyện', 'Self-study')) : T('Tiết ', 'Lesson ') + o.lesson + (o.label ? ' ' + videoLabel(o.label) : '')) + (o.wrong ? T(' (quay sai)', ' (filmed wrong)') : '')).join(', ');
    return '<div class="pupil' + (state === 'Vắng chờ xác minh' || Q.ABSENT.includes(state) ? ' absent' : '') + '"><button class="tick' + (on ? (m.status === 'Đến muộn' ? ' late' : ' on') : '') + '" data-act="tick" data-i="' + i + '" aria-pressed="' + Boolean(on) + '" aria-label="Điểm danh ' + esc(p.eng) + '"' + (canEdit ? '' : ' disabled') + '>✓</button>' +
      '<div class="who"><b>' + esc(p.eng || p.name) + '</b><span class="small muted">' + esc(p.name) + (state && !on ? ' · ' + esc(stateText(state)) : m && m.status === 'Đến muộn' ? T(' · Đến muộn', ' · Late') : '') + (g === '/' ? T(' · Sheet ghi vắng', ' · Sheet says absent') : '') + (value && !g ? T(' · Có ghi chú', ' · Has a note') : '') + '</span></div>' + grades +
      (owedText ? '<div class="owed">' + T('Thiếu video: ', 'Missing video: ') + esc(owedText) + '</div>' : '') + '</div>';
  }).join('') + '</div>';
  return h;
}

/* ---------- Manager pages ---------- */
function staffPanel(week) {
  if (!week) return dayBar() + '<div class="card empty">File Schedule chưa có tuần này.</div>';
  const sessions = week.data.sessions.filter(s => s.day === day && !s.off), sites = [...new Set(sessions.map(s => s.site).filter(Boolean))].sort(), latest = staffLatest();
  const rows = [];
  sessions.forEach(s => Q.staffOf(s).forEach(p => rows.push({ s, p, k: staffKey({ day: s.day, cls: s.cls, time: Q.clock(s.start), person: p.name }) })));
  const names = [...new Set(rows.map(r => r.p.name))].sort((a, b) => a.localeCompare(b, 'vi'));
  const shown = rows.filter(r => (!filters.site || r.s.site === filters.site) && (!filters.person || r.p.name === filters.person)).sort((a, b) => a.p.due - b.p.due || a.p.name.localeCompare(b.p.name, 'vi'));
  const blank = shown.filter(r => { const o = latest.get(r.k); return !o || o.status === 'Bỏ chấm'; }).length;
  const overdue = day === today() ? shown.filter(r => { const o = latest.get(r.k); return (!o || o.status === 'Bỏ chấm') && r.p.due <= minutesNow(); }).length : 0;
  let h = dayBar() + '<div class="filters"><select data-act="filter" data-k="site"><option value="">Mọi cơ sở, phòng</option>' + sites.map(x => '<option' + (x === filters.site ? ' selected' : '') + '>' + esc(x) + '</option>').join('') + '</select>' +
    '<select data-act="filter" data-k="person"><option value="">Mọi người</option>' + names.map(x => '<option' + (x === filters.person ? ' selected' : '') + '>' + esc(x) + '</option>').join('') + '</select></div>' +
    '<div class="count"><span>' + (shown.length - blank) + '/' + shown.length + ' ca đã chấm</span>' + (overdue ? '<span class="tag bad">' + overdue + ' ca đến giờ chưa chấm</span>' : '') + '</div>';
  if (!shown.length) return h + '<div class="card empty">Không có ca nào.</div>';
  return h + '<div class="list">' + shown.map(r => {
    const o = latest.get(r.k), status = o && o.status !== 'Bỏ chấm' ? o.status : '', cls = v => (status === v ? 'on ' : '');
    return '<div class="card row"><div class="row-top"><b>' + esc(r.p.name) + '</b><span class="tag">' + esc(r.p.role) + '</span><span class="muted">' + esc(r.s.cls) + ' · ' + sessionTime(r.s) + '</span><span class="spacer"></span><span class="room small">' + esc(r.s.site) + '</span></div>' +
      '<div class="small muted">Phải có mặt trước ' + Q.clock(r.p.due) + (o && o.by ? ' · Chấm lúc ' + esc(String(o.at).slice(-8, -3)) : '') + '</div>' +
      '<div class="choices" data-k="' + esc(r.k) + '"><button class="' + cls('Đúng giờ') + 'good" data-act="staff" data-v="Đúng giờ" data-row="' + r.s.row + '" data-p="' + esc(r.p.name) + '">Đúng giờ</button><button class="' + cls('Muộn') + 'mid" data-act="staff" data-v="Muộn" data-row="' + r.s.row + '" data-p="' + esc(r.p.name) + '">Muộn</button><button class="' + cls('Vắng') + 'low" data-act="staff" data-v="Vắng" data-row="' + r.s.row + '" data-p="' + esc(r.p.name) + '">Vắng</button>' +
      (status === 'Muộn' ? '<input type="number" min="0" inputmode="numeric" placeholder="Phút" aria-label="Số phút muộn" data-act="staffField" data-field="minutes" data-row="' + r.s.row + '" data-p="' + esc(r.p.name) + '" value="' + esc(o.minutes) + '">' : '') +
      (status ? '<input type="text" placeholder="Ghi chú" aria-label="Ghi chú" data-act="staffField" data-field="note" data-row="' + r.s.row + '" data-p="' + esc(r.p.name) + '" value="' + esc(o.note) + '">' : '') + '</div></div>';
  }).join('') + '</div>';
}

// Past sessions of pilot classes with someone awaiting a decision, newest first.
function absencePanel() {
  const items = [], from = Q.addDays(today(), -7), now = today();
  Object.values(weeks).forEach(w => w.data.sessions.filter(s => classOf(s) && !s.off && s.day >= from && s.day <= now && s.day >= (classOf(s).since || '')).forEach(s => {
    const ctx = classContext(s);
    if (!ctx.tracker) return;
    const roll = Q.rollCall(s, ctx.marks, now, minutesNow());
    if (!roll.past) return;
    items.push({ ctx, roll });
  }));
  items.sort((a, b) => (b.ctx.session.day + Q.clock(b.ctx.session.start)).localeCompare(a.ctx.session.day + Q.clock(a.ctx.session.start)));
  if (!items.length) return '<div class="card empty">7 ngày qua chưa có buổi nào đã chốt điểm danh trong app.</div>';
  let open = 0;
  const body = items.map(({ ctx, roll }) => {
    const s = ctx.session;
    const title = '<div class="row-top"><b>' + esc(s.cls) + ' · Tiết ' + esc(s.lesson) + '</b><span class="muted">' + esc(Q.dayText(s.day)) + ' · ' + sessionTime(s) + '</span><span class="spacer"></span><button class="quiet" data-act="open" data-row="' + s.row + '" data-day="' + s.day + '">Mở lớp</button></div>';
    if (roll.noRollCall) { open++; return '<div class="card row">' + title + '<div class="notice bad">GV chưa điểm danh buổi này (' + esc(s.teacher) + (s.ta ? ', TA ' + esc(s.ta) : '') + '). Không tính cả lớp vắng.</div></div>'; }
    const list = ctx.tracker.pupils.filter(p => { const st = Q.pupilState(ctx.marks.get(p.name), roll); return st === 'Vắng chờ xác minh' || Q.ABSENT.includes(st); });
    if (!list.length) return '';
    open += list.filter(p => Q.pupilState(ctx.marks.get(p.name), roll) === 'Vắng chờ xác minh').length;
    return '<div class="card row">' + title + list.map(p => {
      const m = ctx.marks.get(p.name), st = Q.pupilState(m, roll), phone = /\d{9}/.test((p.phone || '').replace(/\s/g, '')) ? (p.phone.match(/[\d ]{9,}/) || [''])[0].trim() : '';
      const data = 'data-row="' + s.row + '" data-day="' + s.day + '" data-name="' + esc(p.name) + '"';
      return '<div class="row-top"><b>' + esc(p.eng || p.name) + '</b><span class="small muted">' + esc(p.name) + '</span>' + (phone ? '<a class="small" href="tel:' + esc(phone.replace(/\s/g, '')) + '">' + esc(phone) + '</a>' : p.phone ? '<span class="small muted">' + esc(p.phone) + '</span>' : '') + '</div>' +
        '<div class="choices"><button class="' + (st === 'Có phép' ? 'on ' : '') + 'mid" data-act="absence" data-v="Có phép" ' + data + '>Có phép</button><button class="' + (st === 'Không phép' ? 'on ' : '') + 'low" data-act="absence" data-v="Không phép" ' + data + '>Không phép</button><button class="' + (m && m.contact ? 'on good' : 'good') + '" data-act="contact" ' + data + '>Đã liên hệ PH</button></div>';
    }).join('') + '</div>';
  }).join('');
  return '<div class="count"><span>' + (open ? open + ' mục chờ xác minh' : 'Không còn mục chờ') + '</span></div>' + (body.trim() ? '<div class="list">' + body + '</div>' : '<div class="card empty">Các buổi đều đủ học sinh.</div>');
}

function errorPanel() {
  const d = drafts.err = drafts.err || {}, names = [...new Set(people.map(p => p.name))].sort((a, b) => a.localeCompare(b, 'vi'));
  const known = names.concat(extraNames().filter(n => !names.some(x => Q.nameKey(x) === Q.nameKey(n))));
  const all = [...Q.latest(logs.errors ? logs.errors.rows : [], r => r.id).values()].reverse();
  const open = all.filter(e => e.status === 'Mở'), closed = all.filter(e => e.status !== 'Mở').slice(0, 20);
  const line = e => '<div class="card row"><div class="row-top"><b>' + esc(e.person) + '</b><span class="tag ' + (e.status === 'Mở' ? 'bad' : 'ok') + '">' + esc(e.type) + '</span><span class="muted small">' + esc(e.cls) + ' · ' + esc(e.day) + '</span><span class="spacer"></span><button class="quiet" data-act="closeError" data-id="' + esc(e.id) + '">' + (e.status === 'Mở' ? 'Đã xử lý' : 'Mở lại') + '</button></div><div>' + esc(e.text) + '</div></div>';
  return '<div class="card form"><h2>Ghi lỗi</h2><div class="form-grid"><label>Người<select data-act="errField" data-k="person"><option value="">Chọn</option>' + known.map(n => '<option' + (n === d.person ? ' selected' : '') + '>' + esc(n) + '</option>').join('') + '</select></label>' +
    '<label>Loại lỗi<select data-act="errField" data-k="type">' + ERROR_TYPES.map(n => '<option' + (n === d.type ? ' selected' : '') + '>' + esc(n) + '</option>').join('') + '</select></label>' +
    '<label>Lớp<input data-act="errField" data-k="cls" value="' + esc(d.cls) + '" placeholder="KIDS 21"></label><label>Ngày<input type="date" data-act="errField" data-k="day" value="' + esc(d.day || day) + '"></label></div>' +
    '<label>Nội dung<textarea data-act="errField" data-k="text" placeholder="Việc gì đã xảy ra">' + esc(d.text) + '</textarea></label><div><button class="primary" data-act="saveError">Lưu lỗi</button></div></div>' +
    '<h2>Đang mở (' + open.length + ')</h2>' + (open.length ? '<div class="list">' + open.map(line).join('') + '</div>' : '<div class="card empty">Không có lỗi đang mở.</div>') +
    (closed.length ? '<h2>Đã xử lý gần đây</h2><div class="list">' + closed.map(line).join('') + '</div>' : '');
}
function extraNames() { const out = new Set(); Object.values(weeks).forEach(w => w.data.sessions.forEach(s => [s.teacher, s.ta, s.video].forEach(n => n && out.add(n)))); return [...out].sort((a, b) => a.localeCompare(b, 'vi')); }

function taskRow(t, week, canTick) {
  const st = Q.taskState(t, today()), tag = { quahan: 'bad', homnay: 'warn', xong: 'ok', sap: '' }[st.state];
  const stText = lang === 'en' ? ({ 'Xong': 'Done', 'Quá hạn chấm': 'Grading overdue', 'Hạn chấm hôm nay': 'Grade today', 'Quá hạn trả': 'Return overdue', 'Chưa đến hạn': 'Not due yet' }[st.text]) : st.text;
  const body = '<div><div class="row-top"><b>' + esc(t.cls) + '</b><span class="tag ' + tag + '">' + esc(stText) + '</span></div><div>' + esc(t.what) + '</div><div class="small muted">' + T('GV ', 'Teacher ') + esc(t.teacher) + T(' · Chấm trước ', ' · Grade by ') + esc(t.gradeDue ? dayLabel(t.gradeDue) : '?') + ' · TA ' + esc(t.ta) + T(' trả ', ' returns ') + esc(t.returnDue ? dayLabel(t.returnDue) : '?') + '</div></div>';
  return '<div class="card row"><div class="check">' + (canTick ? '<button class="' + (t.done ? 'on' : '') + '" data-act="task" data-row="' + t.row + '" aria-label="Đánh dấu xong" aria-pressed="' + t.done + '">✓</button>' : '') + body + '</div></div>';
}
function taskPanel(week) {
  if (!week) return '<div class="card empty">File Schedule chưa có tuần này.</div>';
  const rank = { quahan: 0, homnay: 1, sap: 2, xong: 3 };
  const all = week.data.tasks.map(t => ({ t, st: Q.taskState(t, today()).state })).sort((a, b) => rank[a.st] - rank[b.st]);
  const names = [...new Set(all.map(x => x.t.teacher))].sort();
  const shown = all.filter(x => (filters.task === 'can' ? x.st !== 'xong' : x.st === filters.task) && (!filters.person || x.t.teacher === filters.person || x.t.ta === filters.person));
  const count = s => all.filter(x => x.st === s).length;
  return '<div class="filters"><select data-act="filter" data-k="task"><option value="can"' + (filters.task === 'can' ? ' selected' : '') + '>Chưa xong (' + (all.length - count('xong')) + ')</option><option value="quahan"' + (filters.task === 'quahan' ? ' selected' : '') + '>Quá hạn (' + count('quahan') + ')</option><option value="homnay"' + (filters.task === 'homnay' ? ' selected' : '') + '>Hạn hôm nay (' + count('homnay') + ')</option><option value="xong"' + (filters.task === 'xong' ? ' selected' : '') + '>Đã xong (' + count('xong') + ')</option></select>' +
    '<select data-act="filter" data-k="person"><option value="">Mọi người</option>' + names.map(x => '<option' + (x === filters.person ? ' selected' : '') + '>' + esc(x) + '</option>').join('') + '</select></div>' +
    '<p class="small muted">Danh sách lấy từ Important Task của tuần ' + esc(week.tab) + '. Tick ở đây ghi vào cột DONE trong Schedule.</p>' +
    (shown.length ? '<div class="list">' + shown.map(x => taskRow(x.t, week, true)).join('') + '</div>' : '<div class="card empty">Không có việc nào.</div>');
}

function columnPanel() {
  const rows = [], now = today(), until = Q.addDays(now, 14);
  Object.values(weeks).forEach(w => w.data.sessions.filter(s => classOf(s) && !s.off && s.day >= now && s.day <= until).forEach(s => { const ctx = classContext(s); if (ctx.tracker) rows.push(ctx); }));
  rows.sort((a, b) => a.session.day.localeCompare(b.session.day));
  if (!rows.length) return '<div class="card empty">Chưa có buổi sắp tới trong các tuần Schedule đã có.</div>';
  const bad = rows.filter(c => columnWarning(c));
  return '<div class="count"><span>' + (bad.length ? bad.length + ' buổi cần TA kiểm tra' : 'Đủ cột cho các buổi sắp tới') + '</span></div><div class="list">' + rows.map(c => {
    const warn = columnWarning(c);
    return '<div class="card row"><div class="row-top"><b>' + esc(c.session.cls) + ' · Tiết ' + esc(c.session.lesson) + '</b><span class="muted">' + esc(Q.dayText(c.session.day)) + '</span><span class="tag ' + (warn ? 'bad' : 'ok') + '">' + (warn ? 'Cần kiểm tra' : 'Đã có cột') + '</span><span class="spacer"></span><span class="small muted">TA ' + esc(c.session.ta) + '</span></div>' + (warn ? '<div class="small">' + esc(warn) + '</div>' : '') + '</div>';
  }).join('') + '</div>';
}

function monthPanel() {
  const rows = [...staffLatest().values()], sum = Q.monthSummary(rows, filters.month);
  const errors = {};
  [...Q.latest(logs.errors ? logs.errors.rows : [], r => r.id).values()].filter(e => String(e.day).startsWith(filters.month)).forEach(e => { errors[e.person] = (errors[e.person] || 0) + 1; });
  return '<div class="filters"><input type="month" data-act="filter" data-k="month" value="' + esc(filters.month) + '" aria-label="Tháng"></div>' +
    '<p class="small muted">Chỉ đếm các ca đã chấm trong app. Bảng CHẤM CÔNG TỔNG HỢP và tiền công không bị thay đổi.</p>' +
    (sum.length ? '<div class="card table"><table><thead><tr><th>Người</th><th>Đúng giờ</th><th>Muộn</th><th>Tổng phút</th><th>Vắng</th><th>Lỗi</th></tr></thead><tbody>' + sum.map(a => '<tr><td>' + esc(a.person) + ' <span class="tag">' + esc(a.role) + '</span></td><td>' + a.onTime + '</td><td>' + a.late + '</td><td>' + a.lateMinutes + '</td><td>' + a.absent + '</td><td>' + (errors[a.person] || 0) + '</td></tr>').join('') + '</tbody></table></div>' : '<div class="card empty">Tháng này chưa có ca nào được chấm.</div>');
}
/* ---------- Người dùng: the owner's page, same as the tuition app ---------- */
const isOwner = () => me && /chủ/i.test(me.role);
let nguoi = null, nguoiMoi = null;
async function loadNguoi() { nguoi = await call('nguoi', {}); render(); }
function viewNguoi() {
  const d = drafts.person = drafts.person || { role: 'GV' };
  let h = '<h2>Người dùng</h2><p class="sub">Mỗi người một link riêng, không cần đăng nhập. Xoá người là link đó hết hiệu lực.</p>';
  if (nguoiMoi) h += '<div class="card"><h3>Link của ' + esc(nguoiMoi.name) + '</h3><p>Link chỉ hiện lần này. Gửi riêng cho ' + esc(nguoiMoi.name) + ', đừng dán vào nhóm. Ai có link là vào được với tên người này.</p><p style="word-break:break-all;user-select:all">' + esc(nguoiMoi.link) + '</p><button class="primary" data-act="nguoiCopy">Copy link</button></div>';
  const names = nguoi ? nguoi.staff.filter(s => !nguoi.people.some(p => p.name === s.name)) : [];
  h += '<div class="card"><h3>Thêm người</h3><p>Tên phải đúng như trên file Schedule thì lịch và công mới khớp.</p><input data-act="personField" data-k="name" list="tenNhanSu" placeholder="Tên trên Schedule" maxlength="60" value="' + esc(d.name || '') + '"><datalist id="tenNhanSu">' + names.map(s => '<option value="' + esc(s.name) + '"></option>').join('') + '</datalist> <select data-act="personField" data-k="role" aria-label="Vai trò">' + ['GV', 'TA', 'Quản lí'].map(r => '<option' + (d.role === r ? ' selected' : '') + '>' + r + '</option>').join('') + '</select> <button class="primary" data-act="nguoiThem">Tạo link</button></div>';
  h += '<div class="card"><h3>Đang có link</h3>';
  if (!nguoi) h += '<p>Đang đọc…</p>';
  else if (!nguoi.people.length) h += '<p>Chưa cấp link cho ai.</p>';
  else h += '<div class="table"><table><tbody>' + nguoi.people.map(p => '<tr><td>' + esc(p.name) + '</td><td>' + esc(p.role) + '</td><td>Cấp ngày ' + esc(p.at) + '</td><td>' + (p.name === me.name ? '' : '<button class="quiet" data-act="nguoiXoa" data-id="' + esc(p.id) + '">Xoá</button>') + '</td></tr>').join('') + '</tbody></table></div>';
  return h + '</div>';
}
async function nguoiThem() {
  const d = drafts.person || {};
  if (!Q.clean(d.name)) return say('Hãy nhập tên.', 'bad');
  try { const r = await call('them', { name: d.name, role: d.role || 'GV' }); nguoiMoi = { name: r.name, link: location.origin + location.pathname + '#k=' + r.key }; drafts.person = { role: 'GV' }; await loadNguoi(); }
  catch (e) { say('Không tạo được: ' + e.message, 'bad'); }
}
async function nguoiXoa(id) {
  const p = nguoi.people.find(x => x.id === id);
  if (!p || !window.confirm('Xoá ' + p.name + '? Link của ' + p.name + ' sẽ hết hiệu lực ngay.')) return;
  try { await call('xoa', { id }); nguoiMoi = null; await loadNguoi(); say('Đã xoá ' + p.name + ', link đó không vào được nữa.'); }
  catch (e) { say('Không xoá được: ' + e.message, 'bad'); }
}
async function nguoiCopy(b) {
  try { await navigator.clipboard.writeText(nguoiMoi.link); b.textContent = 'Đã copy'; }
  catch (e) { b.textContent = 'Không copy được, bôi đen để copy'; }
}
const PANELS = [['cong', 'Chấm công'], ['vang', 'HS vắng'], ['loi', 'Lỗi'], ['task', 'Important Task'], ['cot', 'Cột lớp'], ['thang', 'Tổng tháng']];
function viewManager(week) {
  const body = { cong: () => staffPanel(week), vang: absencePanel, loi: errorPanel, task: () => taskPanel(week), cot: columnPanel, thang: monthPanel }[panel]();
  return '<div class="tabs">' + PANELS.map(([k, t]) => '<button class="' + (k === panel ? 'on' : '') + '" data-act="panel" data-v="' + k + '">' + esc(t) + '</button>').join('') + '</div>' + body;
}

/* ---------- My hours ---------- */
const KIND_EN = { 'CLASS KHÁC': 'Other classes' };
const payCache = {};
// Reads every week tab of the month in one request, then keeps them with the other weeks.
async function loadPay(month, force) {
  const hit = payCache[month];
  if (hit && !force && Date.now() - hit.at < FRESH_MS) return hit;
  const wanted = Q.tabsOfMonth(tabs, month), missing = wanted.filter(t => force || !weeks[t] || Date.now() - weeks[t].at >= FRESH_MS);
  const ranges = missing.map(t => quote(t) + '!A1:M400').concat(["'CHẤM CÔNG TỔNG HỢP'!R7:W46"]);
  const data = await batchGet(CONFIG.scheduleId, ranges);
  missing.forEach((t, i) => setWeek(t, data[i]));
  return (payCache[month] = { at: Date.now(), entries: wanted.flatMap(t => weeks[t].pay), marking: Q.parseMarking(data[data.length - 1]).filter(x => x.day.startsWith(month)) });
}
function viewPay() {
  const month = filters.payMonth, hit = payCache[month], who = isManager() && filters.payPerson ? filters.payPerson : me.name;
  const names = hit ? [...new Set(hit.entries.filter(e => e.count).map(e => e.person).concat(hit.marking.map(x => x.person)))].sort((a, b) => a.localeCompare(b, 'vi')) : [];
  let h = '<div class="filters"><input type="month" data-act="filter" data-k="payMonth" value="' + esc(month) + '" aria-label="' + T('Tháng', 'Month') + '">' +
    (isManager() ? '<select data-act="filter" data-k="payPerson" aria-label="Người"><option value="">' + esc(me.name) + '</option>' + names.filter(n => n !== Q.key(me.name)).map(n => '<option' + (n === filters.payPerson ? ' selected' : '') + '>' + esc(n) + '</option>').join('') + '</select>' : '') + '</div>';
  if (!hit) return h + '<div class="card empty">' + T('Đang đọc lịch của tháng…', 'Reading the month…') + '</div>';
  const pay = Q.payOf(hit.entries, who, month, today()), marking = hit.marking.filter(x => x.person === Q.key(who));
  if (!pay.rows.length && !marking.length && !pay.duty) return h + '<div class="card empty">' + T('Tháng này chưa có buổi nào của ', 'No sessions this month for ') + esc(who) + '.</div>';
  const unfinished = pay.pastCount !== pay.count;
  h += '<div class="card class-head"><h1>' + esc(Q.hoursText(unfinished ? pay.pastMinutes : pay.minutes, lang)) + ' · ' + (unfinished ? pay.pastCount : pay.count) + T(' buổi', ' sessions') + '</h1>' +
    '<div class="muted">' + (unfinished ? T('Đến hôm nay. Cả tháng theo lịch hiện có: ', 'Up to today. Whole month as now scheduled: ') + pay.count + T(' buổi, ', ' sessions, ') + esc(Q.hoursText(pay.minutes, lang)) + '.' : T('Cả tháng theo lịch.', 'Whole month as scheduled.')) + '</div>' +
    '<div class="small muted">' + T('Tính theo Schedule, như bảng CHẤM CÔNG TỔNG HỢP. Buổi nghỉ không tính.', 'Counted from the Schedule, the same way as the CHẤM CÔNG TỔNG HỢP tab. Cancelled sessions do not count.') + '</div></div>';
  if (pay.kinds.length) h += '<div class="card table"><table><thead><tr><th>' + T('Loại', 'Type') + '</th><th>' + T('Buổi', 'Sessions') + '</th><th>' + T('Giờ', 'Hours') + '</th><th>' + T('Ca nghỉ', 'Cancelled') + '</th></tr></thead><tbody>' +
    pay.kinds.map(k => '<tr><td>' + esc(lang === 'en' ? KIND_EN[k.kind] || k.kind : k.kind) + '</td><td>' + k.count + '</td><td>' + esc(Q.hoursText(k.minutes, lang)) + '</td><td>' + k.off + '</td></tr>').join('') + '</tbody></table></div>';
  if (pay.duty) h += '<p class="small muted">' + T('Trực lớp (TA/CM): ', 'Class duty as TA: ') + pay.duty + T(' buổi. Bảng công hiện không tính phần này.', ' sessions. The hours tab does not count these.') + '</p>';
  if (marking.length) h += '<h2>' + T('Chấm bài', 'Marking') + ': ' + marking.reduce((n, x) => n + x.papers, 0) + T(' bài', ' papers') + '</h2><div class="card row">' + marking.map(x => '<div class="small">' + esc(Q.dayText(x.day, lang)) + ' · ' + esc(x.cls) + ' · ' + x.papers + T(' bài', ' papers') + (x.note ? '<span class="detail"> · ' + esc(x.note) + '</span>' : '') + '</div>').join('') + '</div>';
  if (pay.kinds.length) h += '<h2>' + T('Theo lớp, học sinh', 'By class and pupil') + '</h2><div class="card row">' + pay.kinds.flatMap(k => Object.values(k.classes)).sort((a, b) => b.minutes - a.minutes).map(c => '<div class="row-top"><span>' + esc(c.cls) + '</span><span class="spacer"></span><span class="muted small">' + c.count + T(' buổi, ', ' sessions, ') + esc(Q.hoursText(c.minutes, lang)) + '</span></div>').join('') + '</div>';
  h += '<details class="card row"><summary>' + T('Từng buổi để đối chiếu', 'Every session, to check') + ' (' + pay.rows.length + ')</summary>' + pay.rows.map(e => '<div class="row-top small' + (e.day > today() ? ' muted' : '') + '"><span>' + esc(Q.dayText(e.day, lang)) + (e.timeText ? ' · ' + esc(e.timeText) : '') + '</span><span>' + esc(e.cls) + '</span><span class="spacer"></span>' + (e.status !== 'Học' ? '<span class="tag bad">' + T('Nghỉ', 'Off') + '</span>' : e.count ? '<span class="muted">' + e.minutes + T(' phút', ' min') + '</span>' : '<span class="tag">' + T('Không tính', 'Not counted') + '</span>') + '</div>').join('') + '</details>';
  return h;
}

/* ---------- Drawing ---------- */
function render() {
  if (!me) return;
  const active = document.activeElement;
  if (active && $('main').contains(active) && /^(INPUT|TEXTAREA)$/.test(active.tagName)) return;
  const items = [['lich', T('Lịch', 'Schedule')], ['cong', T('Công của tôi', 'My hours')]].concat(isManager() ? [['dieuhanh', 'Điều hành']] : []).concat(isOwner() ? [['nguoi', 'Người dùng']] : []);
  $('btnLang').textContent = lang === 'en' ? 'Tiếng Việt' : 'English';
  $('btnOut').textContent = T('Thoát', 'Sign out');
  $('nav').innerHTML = items.map(([k, t]) => '<button class="' + (view === k ? 'on' : '') + '" data-act="view" data-v="' + k + '">' + t + '</button>').join('');
  const week = weeks[Q.weekTab(tabs, day)] || null;
  let h = notices.map((n, i) => '<div class="notice ' + n.kind + '" role="alert">' + esc(n.text) + ' <button class="quiet" data-act="dismiss" data-i="' + i + '">' + T('Đóng', 'Close') + '</button></div>').join('');
  if (loadError) h += '<div class="notice bad">' + esc(loadError) + '</div>';
  if (view === 'lenlop' && current) h =notices.map((n, i) => '<div class="notice ' + n.kind + '" role="alert">' + esc(n.text) + ' <button class="quiet" data-act="dismiss" data-i="' + i + '">' + T('Đóng', 'Close') + '</button></div>').join('') + viewLenLop();
  else if (view === 'lop' && current) h += viewClass();
  else if (view === 'dieuhanh' && isManager()) h += viewManager(week);
  else if (view === 'nguoi' && isOwner()) h += viewNguoi();
  else if (view === 'cong') h += viewPay();
  else h += viewSchedule(week);
  $('main').innerHTML = h;
  paintSave();
}
async function guarded(work) {
  try { loadError = ''; await work(); } catch (e) { if (!/đăng nhập/.test(e.message)) loadError = e.status === 403 ? T('Tài khoản này chưa có quyền xem phần đó. Vui lòng báo quản lí.', 'This account cannot see that part. Please tell the manager.') : T('Chưa đọc được dữ liệu: ', 'Could not read the data: ') + e.message; }
  render();
}
async function loadPanel() {
  await weekOf(day);
  await loadManager();
  if (panel === 'vang' || panel === 'cot') {
    await loadMarks();
    const span = panel === 'vang' ? [-7, 0] : [0, 7, 14];
    await Promise.all(classList.map(c => loadTracker(c)));
    await Promise.all(span.map(n => weekOf(Q.addDays(today(), n))));
  }
  if (panel === 'loi') await Promise.all([weekOf(today())]);
}
function findSession(row, onDay) {
  const week = weeks[Q.weekTab(tabs, onDay || day)];
  return week ? week.data.sessions.find(s => s.row === Number(row)) : null;
}
async function openClass(session) {
  current = session; view = 'lop'; render(); window.scrollTo(0, 0);
  await guarded(async () => { await Promise.all([loadMarks(true), loadTracker(classOf(session), true)]); });
}

/* ---------- Events ---------- */
document.addEventListener('click', e => {
  const b = e.target.closest('[data-act]');
  if (!b || b.tagName === 'SELECT' || b.tagName === 'INPUT' || b.tagName === 'TEXTAREA') return;
  const act = b.dataset.act, v = b.dataset.v;
  if (act === 'view') { view = v; render(); guarded(() => view === 'nguoi' ? loadNguoi() : view === 'dieuhanh' ? loadPanel() : view === 'cong' ? loadPay(filters.payMonth) : weekOf(day)); }
  if (act === 'panel') { panel = v; filters.person = ''; render(); guarded(loadPanel); }
  if (act === 'day') { day = Q.addDays(day, Number(b.dataset.n)); render(); guarded(() => view === 'dieuhanh' ? loadPanel() : weekOf(day)); }
  if (act === 'today') { day = today(); render(); guarded(() => weekOf(day)); }
  if (act === 'scope') { filters.showAll = Boolean(v); render(); }
  if (act === 'back') { view = 'lich'; current = null; render(); }
  if (act === 'llOpen') { view = 'lenlop'; document.body.classList.add('lenlop'); render(); }
  if (/^ll[A-Z]/.test(act) && act !== 'llOpen') llAction(act, b.dataset.i);
  if (act === 'dismiss') { notices.splice(Number(b.dataset.i), 1); render(); }
  if (act === 'open') { const s = findSession(b.dataset.row, b.dataset.day); if (s && classOf(s)) openClass(s); }
  if (act === 'tick' || act === 'grade') {
    const ctx = classContext(current), pupil = ctx.tracker.pupils[Number(b.dataset.i)];
    if (act === 'tick') tickPupil(ctx, pupil); else setGrade(ctx, pupil, v);
  }
  if (act === 'absence' || act === 'contact') {
    const s = findSession(b.dataset.row, b.dataset.day), ctx = classContext(s), pupil = ctx.tracker.pupils.find(p => p.name === b.dataset.name);
    if (act === 'absence') setAbsence(ctx, pupil, v); else setContact(ctx, pupil);
  }
  if (act === 'staff') { const s = findSession(b.dataset.row), p = Q.staffOf(s).find(x => x.name === b.dataset.p); markStaff(s, p, v); }
  if (act === 'saveError') saveError();
  if (act === 'nguoiThem') nguoiThem();
  if (act === 'nguoiXoa') nguoiXoa(b.dataset.id);
  if (act === 'nguoiCopy') nguoiCopy(b);
  if (act === 'closeError') closeError(b.dataset.id);
  if (act === 'task') { const w = weeks[Q.weekTab(tabs, day)], t = w.data.tasks.find(x => x.row === Number(b.dataset.row)); tickTask(w, t); }
});
document.addEventListener('change', e => {
  const b = e.target.closest('[data-act]');
  if (!b) return;
  if (b.dataset.act === 'filter') { filters[b.dataset.k] = b.value; b.blur(); render(); if (b.dataset.k === 'payMonth' && b.value) guarded(() => loadPay(b.value)); }
  if (b.dataset.act === 'errField') { drafts.err[b.dataset.k] = b.value; }
  if (b.dataset.act === 'personField') { drafts.person = drafts.person || {}; drafts.person[b.dataset.k] = b.value; }
  if (b.dataset.act === 'staffField') {
    const s = findSession(b.dataset.row), p = Q.staffOf(s).find(x => x.name === b.dataset.p), k = staffKey({ day: s.day, cls: s.cls, time: Q.clock(s.start), person: p.name }), o = staffLatest().get(k);
    const row = [stamp(), s.day, p.name, p.role, s.cls, Q.clock(s.start), Q.clock(p.due), o.status, b.dataset.field === 'minutes' ? b.value : o.minutes, b.dataset.field === 'note' ? b.value : o.note, me.name];
    logs.staff.rows.push(staffOfRow(row));
    queue({ kind: 'append', file: CONFIG.quanLiId, tab: 'CONG', row });
  }
});
window.addEventListener('online', flush);

/* ---------- Start ---------- */
async function enter() {
  $('login').hidden = true; $('app').hidden = false;
  try {
    const b = await call('boot', {});
    people = b.people;
    classList = b.classes.map(c => ({ name: c.name, key: Q.key(c.name), tracker: c.tracker, since: c.since }));
    tabs = b.tabs;
    me = b.me;
    outbox = saved.get('outbox') || [];
    render();
    await guarded(() => weekOf(day));
    flush();
  } catch (e) {
    if (e.status === 401) return;
    me = me || { name: '', role: '' };
    loadError = T('Chưa mở được: ', 'Could not open: ') + e.message;
    $('main').innerHTML = '<div class="notice bad">' + esc(loadError) + '</div>';
  }
}
$('btnLang').addEventListener('click', () => { lang = lang === 'en' ? 'vi' : 'en'; keep('lang', lang); paintLogin(); render(); });
$('btnLangLogin').addEventListener('click', () => { lang = lang === 'en' ? 'vi' : 'en'; keep('lang', lang); paintLogin(); });
function paintLogin() {
  $('loginText').textContent = T('Vui lòng mở app bằng link riêng quản lí đã gửi cho bạn.', 'Please open the app with the private link your manager sent you.');
  $('btnLangLogin').textContent = lang === 'en' ? 'Tiếng Việt' : 'English';
}
$('btnOut').addEventListener('click', () => {
  if (!window.confirm(T('Thoát trên máy này? Muốn vào lại phải mở lại link riêng.', 'Leave on this device? You will need your private link to come back.'))) return;
  accessKey = null; me = null; keep('key', '');
  showLogin(false);
});
openStore().then(() => {
  lang = saved.get('lang') || 'vi';
  paintLogin();
  accessKey = readKey();
  if (accessKey) enter(); else showLogin(false);
});
