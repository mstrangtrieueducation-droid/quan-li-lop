/* Class operations app: static page, private link per person, an Apps Script server decides who can read or write what. */
const CONFIG = window.QL_CONFIG, Q = window.QL;
const TRACKER_TAB = 'THEO DÕI TOÀN DIỆN', OTHER_TRACKER_TAB = 'THEO DÕI', ROSTER_LAST = 60, FRESH_MS = 300000, LIGHT_MS = 900000, STAR_WAIT = 10000, MARKS_TAIL = 4000;
const $ = id => document.getElementById(id);
const esc = v => String(v == null ? '' : v).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const today = () => Q.iso(new Date());
// Light by default; the bar button switches to dark and the choice stays in this browser.
let theme = 'light';
try { theme = localStorage.getItem('ql-theme') === 'dark' ? 'dark' : 'light'; } catch (e) {}
document.documentElement.dataset.theme = theme;
// Header buttons are small pills: a line icon for the theme, "EN" / "VI" for the language (owner 09/11).
const ICON_BELL = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/></svg>';
const ICON_MOON = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>';
const ICON_SUN = '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="4.5"/><path d="M12 1.5v2.5M12 20v2.5M4.6 4.6l1.8 1.8M17.6 17.6l1.8 1.8M1.5 12h2.5M20 12h2.5M4.6 19.4l1.8-1.8M17.6 6.4l1.8-1.8"/></svg>';
function paintTheme() { const b = document.getElementById('btnTheme'); if (!b) return; b.innerHTML = theme === 'dark' ? ICON_SUN : ICON_MOON; const l = theme === 'dark' ? T('Nền sáng', 'Light theme') : T('Nền tối', 'Dark theme'); b.setAttribute('aria-label', l); b.title = l; }
function paintLang() { const b = document.getElementById('btnLang'); if (!b) return; b.textContent = lang === 'en' ? 'VI' : 'EN'; const l = lang === 'en' ? 'Tiếng Việt' : 'English'; b.setAttribute('aria-label', l); b.title = l; }
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
  // Google allows 60 reads a minute for everyone on this server together, so a refusal waits for the next minute.
  for (let k = 0; k < (last && last.status === 429 ? 5 : attempts || 3); k++) {
    if (k) await new Promise(r => setTimeout(r, last && last.status === 429 ? 20000 : 3000 * k));
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
let me = null, people = [], classList = [], tabs = [], weeks = {}, logs = { marks: null, staff: null, errors: null, behave: null }, trackers = {};
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
  const read = batchGet(CONFIG.scheduleId, [quote(tab) + '!A1:O400']).then(([rows]) => {
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
let marksCount = 0;
async function loadMarks(force) {
  if (logs.marks && !force && Date.now() - logs.marks.at < 60000) return;
  // The log only grows, so only its tail is read; N1 of that tab counts its rows.
  if (!marksCount) { const [[first = []]] = await batchGet(CONFIG.diemDanhId, ['DIEM_DANH!N1']); marksCount = Number(first[0]) || 0; }
  const [rows, [count = []]] = await batchGet(CONFIG.diemDanhId, ['DIEM_DANH!A' + Math.max(2, marksCount - MARKS_TAIL) + ':L', 'DIEM_DANH!N1']);
  marksCount = Number(count[0]) || marksCount;
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
const readTrackerTop = (cls, tab) => batchGet(cls.tracker, [quote(tab) + '!A1:8', quote(tab) + '!A1:E' + ROSTER_LAST]);
// light: names and column headers only, one read, enough for the manager lists across all classes.
async function loadTracker(cls, force, light) {
  const hit = trackers[cls.key];
  if (hit && !force && (light || !hit.light) && Date.now() - hit.at < (hit.light ? LIGHT_MS : FRESH_MS)) return hit;
  let tabName = cls.tab || TRACKER_TAB, top;
  try { top = await readTrackerTop(cls, tabName); }
  catch (e) { if (tabName !== TRACKER_TAB || !/parse range/i.test(e.message)) throw e; tabName = OTHER_TRACKER_TAB; top = await readTrackerTop(cls, tabName); }
  cls.tab = tabName;
  const tab = quote(tabName), [rowsTop, roster] = top;
  const year = new Date().getFullYear();
  const pupils = [], isPupil = r => /^\d+$/.test(Q.clean((r || [])[0]));
  // A marker row such as "IELTS 52.2" in column A starts a speaking group: its pupils belong to that group until the next marker.
  let group = '';
  roster.forEach((r, i) => { const a0 = Q.clean((r || [])[0]); if (/^[A-Z]+\s*\d+\.\d+$/i.test(a0)) group = Q.key(a0); if (isPupil(r) && Q.clean(r[1])) pupils.push(Object.assign(Q.pupilOf([r[1], r[2]], i + 1), { phone: Q.clean(r[4]), group })); });
  // The first pupil's row differs by class; everything above it is header.
  const firstPupil = rowsTop.findIndex(isPupil), head = firstPupil < 0 ? rowsTop : rowsTop.slice(0, firstPupil);
  const blocks = Q.trackerBlocks(head, year), practices = Q.practiceColumns(head, year);
  const from = Q.addDays(today(), -60);
  const wanted = new Set();
  blocks.filter(b => !b.date || b.date >= from).forEach(b => { if (b.grade >= 0) wanted.add(b.grade); if (b.stars >= 0) wanted.add(b.stars); b.videos.forEach(v => wanted.add(v.col)); });
  practices.filter(p => p.due >= from).forEach(p => wanted.add(p.col));
  const cols = light ? [] : [...wanted];
  const values = {};
  if (cols.length) {
    const lo = Math.min(...cols), hi = Math.max(...cols);
    const [rows] = await batchGet(cls.tracker, [tab + '!' + Q.colName(lo) + '1:' + Q.colName(hi) + ROSTER_LAST]);
    cols.forEach(c => { values[c] = rows.map(r => [(r || [])[c - lo] || '']); });
  }
  const cell = (row, col) => ((values[col] || [])[row - 1] || [])[0] || '';
  const set = (row, col, v) => { const list = values[col] = values[col] || []; list[row - 1] = [v]; };
  return (trackers[cls.key] = { at: Date.now(), light: Boolean(light), tab: tabName, pupils, blocks, practices, cell, set });
}

/* ---------- Writing: everything goes through one outbox kept on the device ---------- */
let outbox = [], flushTimer = null, flushDue = 0, flushing = false, flushFailed = false;
// Many classrooms share one write allowance, so stars wait and go together; anything else goes within seconds.
function queue(item, wait) {
  outbox.push(item); keep('outbox', outbox); paintSave();
  const due = Date.now() + (wait || 3000);
  if (flushTimer && flushDue <= due) return;
  clearTimeout(flushTimer); flushDue = due;
  flushTimer = setTimeout(() => { flushTimer = null; flush(); }, due - Date.now());
}
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
  const all = [...last.values()], list = all.filter(x => !x.blind), now = list.length ? await batchGet(file, list.map(x => x.range)) : [];
  const data = all.filter(x => x.blind).map(x => ({ range: x.range, values: [[x.value]] }));
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
function appendMark(session, pupil, status, contact, note, wait) {
  const row = [stamp(), session.day, session.cls, session.lesson, Q.clock(session.start), pupil.row, pupil.name, pupil.eng, status, contact || '', note || '', me.name];
  logs.marks.rows.push(markOf(row));
  queue({ kind: 'append', file: CONFIG.diemDanhId, tab: 'DIEM_DANH', row }, wait);
}
const marksOf = session => {
  const prefix = [session.day, session.classKey, session.lesson, Q.clock(session.start)].join('|') + '|', out = new Map();
  (logs.marks ? logs.marks.rows : []).forEach(m => { const k = markKey(m); if (k.startsWith(prefix)) out.set(m.name, m); });
  return out;
};
function gradeCell(cls, tracker, block, pupil, value, label) {
  const col = block.grade, range = quote(tracker.tab) + '!' + Q.colName(col) + pupil.row, expected = tracker.cell(pupil.row, col);
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
  // Only the grade letter changes; a teacher's comment after it stays. "/ Con vắng mặt" is replaced whole.
  const comment = had && had !== '/' ? String(current).trim().replace(/^(A\+|A|B|F)/i, '').trim() : '';
  if (had === grade && comment) return say(pupil.eng + T(': ô điểm có nhận xét của GV, muốn xoá điểm thì sửa trong sheet.', ': this grade has a teacher comment, clear it in the sheet.'), 'bad');
  const value = had === grade ? '' : had && had !== '/' ? String(current).trim().replace(/^(A\+|A|B|F)/i, grade) : grade;
  gradeCell(cls, tracker, block, pupil, value, pupil.eng + ' · ' + session.lesson);
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
// Owner 08/11: 30 minutes after a lesson ends it locks for teachers and TAs (A/B/F, stars, attendance), so nothing is tapped by mistake later; managers can still correct.
const CLOSE_AFTER = 30;
const lessonClosed = s => s.day < today() || (s.day === today() && minutesNow() > s.end + CLOSE_AFTER);
// A lesson running now, or starting within 15 minutes.
function liveTag(s) { if (s.off || s.day !== today()) return ''; const n = minutesNow(); if (n >= s.start && n < s.end) return '<span class="tag live">● ' + T('Đang diễn ra', 'In progress') + '</span>'; if (n >= s.start - 15 && n < s.start) return '<span class="tag soon">' + T('Sắp bắt đầu', 'Starting soon') + '</span>'; if (n >= s.end && n <= s.end + CLOSE_AFTER) return '<span class="tag">' + T('Vừa xong', 'Just ended') + '</span>'; return ''; }
const CHOT_NAME = '— CHỐT BUỔI —';
const chotOf = s => { try { const m = marksOf(s).get(CHOT_NAME); return m && m.status === 'Đã chốt' ? m : null; } catch (e) { return null; } };
const isChot = s => !!chotOf(s);
function canTeach(s) { return !isChot(s) && (isManager() || (takesRoll(s) && Q.rollCall(s, marksOf(s), today(), minutesNow()).open && !lessonClosed(s))); }
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
  const value = Math.max(0, Math.min(99, count)), range = quote(tracker.tab) + '!' + Q.colName(block.stars) + pupil.row, expected = tracker.cell(pupil.row, block.stars);
  tracker.set(pupil.row, block.stars, value ? String(value) : '');
  queue({ kind: 'cell', file: cls.tracker, classKey: cls.key, range, row: pupil.row, col: block.stars, expected, value: value || '', blind: true, label: pupil.eng + ' · ' + T('Số sao', 'Stars') }, STAR_WAIT);
  // A star means the pupil is in class.
  const m = ctx.marks.get(pupil.name);
  if (value && !(m && Q.PRESENT.includes(m.status))) appendMark(session, pupil, Q.tickStatus(session, today(), minutesNow()), m && m.contact, '', STAR_WAIT);
}
/* Owner 07/11: a star goes on only with the star button beside the name (a tap elsewhere never adds one), it flies in so the class sees it,
 * and behaviour (talking, not focused…) plus a free note are ticked per pupil. Tiles keep their place, so a tap never lands on the wrong child. */
const BEHAVIOURS = ['Mất trật tự', 'Mất tập trung', 'Nói chuyện riêng', 'Không làm theo yêu cầu', 'Quên sách vở', 'Nói tiếng Việt nhiều', 'Đi lại tự do'];
const BEHAVIOUR_EN = { 'Mất trật tự': 'Disruptive', 'Mất tập trung': 'Not focused', 'Nói chuyện riêng': 'Chatting', 'Không làm theo yêu cầu': 'Not following', 'Quên sách vở': 'Forgot books', 'Nói tiếng Việt nhiều': 'Too much Vietnamese', 'Đi lại tự do': 'Wandering' };
const behaveOf = r => ({ at: r[0], day: r[1], cls: r[2], lesson: r[3], time: r[4], row: r[5], name: r[6], eng: r[7], tags: Q.clean(r[8]) ? Q.clean(r[8]).split(/\s*;\s*/) : [], note: r[9] || '', by: r[10] || '' });
async function loadBehave(force) {
  if (logs.behave && !force && Date.now() - logs.behave.at < 60000) return;
  const [rows] = await batchGet(CONFIG.diemDanhId, ['HANH_VI!A2:K']);
  logs.behave = { rows: rows.map(behaveOf), at: Date.now() };
  outbox.filter(x => x.kind === 'append' && x.tab === 'HANH_VI').forEach(x => logs.behave.rows.push(behaveOf(x.row)));
}
const behaveFor = session => {
  const prefix = [session.day, session.classKey, session.lesson, Q.clock(session.start)].join('|') + '|', out = new Map();
  (logs.behave ? logs.behave.rows : []).forEach(b => { if ([b.day, Q.key(b.cls), b.lesson, b.time, ''].join('|') === prefix) out.set(b.name, b); });
  return out;
};
function setBehave(ctx, pupil, tags, note) {
  const s = ctx.session, row = [stamp(), s.day, s.cls, s.lesson, Q.clock(s.start), pupil.row, pupil.name, pupil.eng, tags.join('; '), note || '', me.name];
  logs.behave = logs.behave || { rows: [], at: Date.now() };
  logs.behave.rows.push(behaveOf(row));
  queue({ kind: 'append', file: CONFIG.diemDanhId, tab: 'HANH_VI', row }, STAR_WAIT);
}
let llMenu = null;
const reduceMotion = () => window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
// A star leaves the button, arcs up and lands on the pupil's count, which then pops.
function flyStar(i) {
  const from = document.querySelector('.ll-plus[data-i="' + i + '"]'), to = document.querySelector('.ll-tile[data-i="' + i + '"] .ll-num');
  if (!from || !to || !document.body.animate || reduceMotion()) return;
  const a = from.getBoundingClientRect(), b = to.getBoundingClientRect(), x0 = a.left + a.width / 2, y0 = a.top + a.height / 2, x1 = b.left + 14, y1 = b.top + b.height / 2;
  const star = document.createElement('div');
  star.className = 'fly-star'; star.textContent = '⭐';
  star.style.left = x0 + 'px'; star.style.top = y0 + 'px';
  document.body.appendChild(star);
  const dx = x1 - x0, dy = y1 - y0, lift = -Math.max(70, Math.abs(dx) * 0.35);
  star.animate([
    { transform: 'translate(-50%,-50%) scale(.6) rotate(0deg)', opacity: 1 },
    { transform: 'translate(calc(-50% + ' + dx * 0.5 + 'px), calc(-50% + ' + (dy * 0.5 + lift) + 'px)) scale(1.9) rotate(200deg)', opacity: 1, offset: 0.55 },
    { transform: 'translate(calc(-50% + ' + dx + 'px), calc(-50% + ' + dy + 'px)) scale(1) rotate(360deg)', opacity: 0.9 }
  ], { duration: 650, easing: 'cubic-bezier(.3,.7,.4,1)' }).onfinish = () => {
    star.remove();
    const num = document.querySelector('.ll-tile[data-i="' + i + '"] .ll-num'), tile = document.querySelector('.ll-tile[data-i="' + i + '"]');
    if (num) num.animate([{ transform: 'scale(1)' }, { transform: 'scale(1.6)' }, { transform: 'scale(1)' }], { duration: 380, easing: 'ease-out' });
    if (tile) tile.animate([{ boxShadow: '0 0 0 0 rgba(245,183,0,.7)' }, { boxShadow: '0 0 0 14px rgba(245,183,0,0)' }], { duration: 600 });
    for (let k = 0; k < 8; k++) {
      const spark = document.createElement('div'), ang = k / 8 * Math.PI * 2, r = 34 + Math.random() * 16;
      spark.className = 'fly-spark'; spark.textContent = k % 2 ? '✦' : '✨';
      spark.style.left = x1 + 'px'; spark.style.top = y1 + 'px';
      document.body.appendChild(spark);
      spark.animate([{ transform: 'translate(-50%,-50%) scale(.4)', opacity: 1 }, { transform: 'translate(calc(-50% + ' + Math.cos(ang) * r + 'px), calc(-50% + ' + Math.sin(ang) * r + 'px)) scale(1)', opacity: 0 }], { duration: 520, easing: 'ease-out' }).onfinish = () => spark.remove();
    }
    const plus = document.createElement('div');
    plus.className = 'fly-plus'; plus.textContent = '+1';
    plus.style.left = x1 + 26 + 'px'; plus.style.top = y1 + 'px';
    document.body.appendChild(plus);
    plus.animate([{ transform: 'translate(-50%,-50%)', opacity: 1 }, { transform: 'translate(-50%,-160%)', opacity: 0 }], { duration: 800, easing: 'ease-out' }).onfinish = () => plus.remove();
  };
}
// Owner 07/11: behaviour is marked right on the class screen, and the class sees it. Two modes on the same tiles:
// ⭐ adds a star, ⚠️ opens big behaviour buttons; a warning stays in red on the pupil's tile for everyone to see.
let llMode = '', llWarn = null;
const tagCounts = tags => { const c = {}; (tags || []).forEach(t => { c[t] = (c[t] || 0) + 1; }); return c; };
const tagText = t => lang === 'en' ? BEHAVIOUR_EN[t] || t : t;
function shakeTile(i) {
  const tile = document.querySelector('.ll-tile[data-i="' + i + '"]');
  if (!tile || !tile.animate || reduceMotion()) return;
  tile.animate([{ transform: 'translateX(0)' }, { transform: 'translateX(-10px)' }, { transform: 'translateX(10px)' }, { transform: 'translateX(-6px)' }, { transform: 'translateX(0)' }], { duration: 420 });
  tile.animate([{ boxShadow: '0 0 0 0 rgba(220,38,38,.8)' }, { boxShadow: '0 0 0 16px rgba(220,38,38,0)' }], { duration: 700 });
  const r = tile.getBoundingClientRect(), mark = document.createElement('div');
  mark.className = 'fly-warn'; mark.textContent = '⚠️';
  mark.style.left = r.left + r.width / 2 + 'px'; mark.style.top = r.top + r.height / 2 + 'px';
  document.body.appendChild(mark);
  mark.animate([{ transform: 'translate(-50%,-50%) scale(3)', opacity: 0 }, { transform: 'translate(-50%,-50%) scale(1.4)', opacity: 1, offset: 0.3 }, { transform: 'translate(-50%,-50%) scale(1)', opacity: 0 }], { duration: 900, easing: 'ease-out' }).onfinish = () => mark.remove();
}
function viewLenLop() {
  const ctx = classContext(current), s = ctx.session;
  if (!ctx.tracker) return '<div class="card empty">' + T('Đang đọc sheet lớp…', 'Reading the class sheet…') + '</div>';
  const edit = canTeach(s), behave = behaveFor(s);
  const rows = ctx.tracker.pupils.map((p, i) => { const m = ctx.marks.get(p.name); return { p, i, stars: starsOf(ctx, p), off: !!m && (m.status === NGHI || Q.ABSENT.includes(m.status)), here: !!m && Q.PRESENT.includes(m.status), b: behave.get(p.name) }; });
  // Present pupils keep the sheet's order; absent ones move to the end. Rank is shown, the tile does not move.
  rows.sort((a, b) => a.off - b.off || a.i - b.i);
  const scores = [...new Set(rows.filter(r => !r.off && r.stars).map(r => r.stars))].sort((a, b) => b - a), medal = ['🥇', '🥈', '🥉'];
  const unmarked = rows.filter(r => !r.off && !r.here).length, noStars = !ctx.tracker.blocks.length, group = isGroup(s);
  const podium = rows.filter(r => !r.off && r.stars && scores.indexOf(r.stars) < 3).sort((a, b) => b.stars - a.stars).slice(0, 5);
  const anyMarked = rows.some(r => r.here || r.off);
  const mode = llMode === 'warn' ? 'warn' : llMode === 'roll' || (!llMode && !anyMarked) || (noStars && llMode !== 'warn') ? 'roll' : 'star';
  // The opening mode is chosen once; a tick must not switch the screen under the teacher's finger.
  if (!llMode) llMode = mode;
  let h = '<div class="ll-head"><button class="quiet" data-act="llExit" aria-label="' + T('Thoát', 'Exit') + '">‹</button><div class="ll-title"><b>' + esc(s.cls) + T(' · Tiết ', ' · Lesson ') + esc(s.lesson) + '</b><span>' + sessionTime(s) + ' · ' + rows.filter(r => !r.off).length + '/' + rows.length + T(' có mặt', ' here') + '</span></div>' +
    (podium.length ? '<div class="ll-podium" aria-label="' + T('Dẫn đầu', 'Leaders') + '">' + podium.map(r => '<span>' + (medal[scores.indexOf(r.stars)] || '') + ' ' + esc(r.p.eng || r.p.name) + ' <b>' + r.stars + '</b></span>').join('') + '</div>' : '') +
    (edit && unmarked && !group ? '<button class="primary" data-act="llAll">' + T('Còn lại có mặt', 'Rest are here') + '</button>' : '') + '</div>';
  if (edit) h += '<div class="ll-modes" role="tablist"><button class="roll' + (mode === 'roll' ? ' on' : '') + '" data-act="llMode" data-v="roll">✓ ' + T('Điểm danh', 'Roll call') + ' <small>' + rows.filter(r => r.here).length + '/' + rows.length + '</small></button>' + (noStars ? '' : '<button class="star' + (mode === 'star' ? ' on' : '') + '" data-act="llMode" data-v="star">⭐ ' + T('Thêm sao', 'Stars') + '</button>') + '<button class="warn' + (mode === 'warn' ? ' on' : '') + '" data-act="llMode" data-v="warn">⚠️ ' + T('Nhắc nhở', 'Warnings') + '</button></div>';
  if (edit && mode === 'roll') h += '<div class="small muted">' + T('Bấm ✓ cho từng bạn có mặt, hoặc "Còn lại có mặt" cho cả lớp. Bạn nghỉ: chạm tên, chọn Nghỉ. Thêm sao cũng tính là có mặt.', 'Tap ✓ for each pupil here, or "Rest are here". Absent: tap the name, choose Absent.') + '</div>';
  if (noStars) h += '<div class="notice">' + T('Sheet lớp này không có cột Số sao, nên chỉ điểm danh và nhắc nhở.', 'This class sheet has no star column.') + '</div>';
  else if (ctx.problem || (ctx.block && ctx.block.stars < 0)) h += '<div class="notice">' + esc(columnWarning(ctx) || T('Tiết này chưa có cột Số sao trong sheet lớp, TA mở cột giúp.', 'This lesson has no star column yet, TA please open it.')) + '</div>';
  if (!edit) h += '<div class="notice">' + T('Buổi này chưa mở hoặc không phân công cho bạn, chỉ xem được.', 'This session is not open or not assigned to you, view only.') + '</div>';
  h += '<div class="ll-grid' + (mode === 'warn' ? ' warn-mode' : '') + '" role="list">' + rows.map(r => {
    const rank = r.off || !r.stars ? 0 : scores.indexOf(r.stars) + 1, name = r.p.eng || r.p.name, dis = edit ? '' : ' disabled', tags = r.b ? r.b.tags : [], note = r.b ? Q.clean(r.b.note) : '', counts = tagCounts(tags), warns = tags.length;
    const action = r.off ? '<span class="ll-off">' + T('Nghỉ', 'Absent') + '</span>' :
      mode === 'warn' ? '<button class="ll-warnbtn" data-act="llWarnOpen" data-i="' + r.i + '"' + dis + ' aria-label="' + T('Nhắc nhở ', 'Warn ') + esc(name) + '">⚠️</button>' :
      mode === 'roll' || noStars ? '<button class="ll-plus check' + (r.here ? ' on' : '') + '" data-act="llHere" data-i="' + r.i + '"' + dis + ' aria-pressed="' + r.here + '">' + (r.here ? '✓ ' + T('Có mặt', 'Here') : '✓') + '</button>' :
      '<button class="ll-plus" data-act="llStar" data-i="' + r.i + '"' + dis + ' aria-label="' + T('Thêm 1 sao cho ', 'Add a star for ') + esc(name) + '">+⭐</button>';
    return '<div class="ll-tile' + (r.off ? ' off' : rank === 1 ? ' top' : '') + (warns ? ' warned' : '') + '" role="listitem" data-i="' + r.i + '">' +
      '<button class="ll-namebtn" data-act="llMenu" data-i="' + r.i + '" aria-label="' + T('Mở mục của ', 'Open ') + esc(name) + '"><span class="ll-rank">' + (r.off ? '' : rank ? (medal[rank - 1] || '#' + rank) : '') + '</span><span class="ll-name">' + esc(name) + '</span></button>' +
      '<div class="ll-act">' + (noStars || r.off ? '' : '<span class="ll-num" aria-label="' + r.stars + T(' sao', ' stars') + '">⭐ ' + r.stars + '</span>') + (warns ? '<span class="ll-wcount">⚠️ ' + warns + '</span>' : '') + '<span class="spacer"></span>' + action + '</div>' +
      (warns || note ? '<div class="ll-flags">' + Object.keys(counts).map(t => '<i>' + esc(tagText(t)) + (counts[t] > 1 ? ' ×' + counts[t] : '') + '</i>').join('') + (note ? '<i class="n">✎</i>' : '') + '</div>' : '') +
      '</div>';
  }).join('') + '</div>';
  if (llWarn != null) h += warnPicker(rows.find(r => r.i === llWarn), edit);
  else if (llMenu != null) h += llSheet(ctx, rows.find(r => r.i === llMenu), edit, noStars);
  return h;
}
// Big buttons, one tap each: the class watches the warning land on the tile.
function warnPicker(r, edit) {
  if (!r) return '';
  const name = r.p.eng || r.p.name, dis = edit ? '' : ' disabled';
  return '<div class="ll-veil" data-act="llClose"></div><div class="ll-sheet warn-sheet" role="dialog" aria-label="' + esc(name) + '"><div class="row-top"><b class="ll-sheet-name">⚠️ ' + esc(name) + '</b><span class="spacer"></span><button class="quiet" data-act="llClose">' + T('Đóng', 'Close') + '</button></div>' +
    '<div class="warn-grid">' + BEHAVIOURS.map(t => '<button data-act="llWarnAdd" data-i="' + r.i + '" data-v="' + esc(t) + '"' + dis + '>' + esc(tagText(t)) + '</button>').join('') + '<button class="other" data-act="llWarnOther" data-i="' + r.i + '"' + dis + '>' + T('Khác / ghi chú…', 'Other / note…') + '</button></div></div>';
}
// One pupil's own panel: fewer stars, typed count, absent, behaviour (a marked chip takes one off) and a note.
function llSheet(ctx, r, edit, noStars) {
  if (!r) return '';
  const name = r.p.eng || r.p.name, tags = r.b ? r.b.tags : [], counts = tagCounts(tags), dis = edit ? '' : ' disabled', draft = drafts['llnote:' + r.p.name];
  return '<div class="ll-veil" data-act="llClose"></div><div class="ll-sheet" role="dialog" aria-label="' + esc(name) + '">' +
    '<div class="row-top"><b class="ll-sheet-name">' + esc(name) + '</b><span class="muted">' + esc(r.p.name) + '</span><span class="spacer"></span><button class="quiet" data-act="llClose">' + T('Đóng', 'Close') + '</button></div>' +
    '<div class="ll-sheet-row">' + (noStars || r.off ? '' : '<button data-act="llMinus" data-i="' + r.i + '"' + (r.stars ? dis : ' disabled') + '>−1 ⭐</button><button data-act="llType" data-i="' + r.i + '"' + dis + '>' + T('Nhập số sao', 'Type stars') + ' (' + r.stars + ')</button>') +
    '<button class="' + (r.off ? 'good' : 'low') + '" data-act="llOff" data-i="' + r.i + '"' + dis + '>' + (r.off ? T('Có mặt', 'Here') : T('Nghỉ', 'Absent')) + '</button></div>' +
    '<div class="small muted">' + T('Hành vi trong buổi: chạm để thêm, chạm chip đang đỏ để bớt 1 lần', 'Behaviour: tap to add, tap a red chip to take one off') + '</div>' +
    '<div class="ll-chips">' + BEHAVIOURS.map(t => '<button class="' + (counts[t] ? 'on' : '') + '" data-act="llTag" data-i="' + r.i + '" data-v="' + esc(t) + '"' + dis + ' aria-pressed="' + Boolean(counts[t]) + '">' + esc(tagText(t)) + (counts[t] > 1 ? ' ×' + counts[t] : '') + '</button>').join('') + '</div>' +
    '<textarea data-act="llNote" data-name="' + esc(r.p.name) + '" rows="2" maxlength="300" placeholder="' + T('Ghi chú khác…', 'Other note…') + '"' + dis + '>' + esc(draft != null ? draft : r.b ? r.b.note : '') + '</textarea>' +
    '<div class="ll-sheet-row"><button class="primary" data-act="llNoteSave" data-i="' + r.i + '"' + dis + '>' + T('Lưu ghi chú', 'Save note') + '</button>' + (r.b && r.b.by ? '<span class="small muted">' + T('Ghi bởi ', 'By ') + esc(r.b.by) + '</span>' : '') + '</div></div>';
}
function llAction(act, i, v) {
  const ctx = classContext(current), pupil = i != null && ctx.tracker ? ctx.tracker.pupils[Number(i)] : null;
  if (act === 'llExit') { view = 'lop'; llMenu = null; llWarn = null; llMode = ''; document.body.classList.remove('lenlop'); render(); flush(); return; }
  if (act === 'llMode') { llMode = ['warn', 'roll'].includes(v) ? v : 'star'; render(); return; }
  if (act === 'llMenu') { llWarn = null; llMenu = Number(i); render(); return; }
  if (act === 'llClose') { llMenu = null; llWarn = null; render(); return; }
  if (act === 'llAll') {
    ctx.tracker.pupils.forEach(p => { const m = ctx.marks.get(p.name); if (!m || !(m.status === NGHI || Q.ABSENT.includes(m.status) || Q.PRESENT.includes(m.status))) appendMark(ctx.session, p, Q.tickStatus(ctx.session, today(), minutesNow()), m && m.contact); });
    render(); return;
  }
  if (!pupil || !canTeach(ctx.session)) return;
  if (act === 'llWarnOpen') { llMenu = null; llWarn = Number(i); render(); return; }
  if (act === 'llWarnOther') { llWarn = null; llMenu = Number(i); render(); return; }
  if (act === 'llHere') { tickPupil(ctx, pupil); return; }
  if (act === 'llStar') { setStars(ctx, pupil, starsOf(ctx, pupil) + 1); render(); flyStar(i); return; }
  if (act === 'llMinus') { setStars(ctx, pupil, starsOf(ctx, pupil) - 1); render(); return; }
  if (act === 'llType') {
    const text = window.prompt(T('Số sao của ', 'Stars for ') + (pupil.eng || pupil.name), String(starsOf(ctx, pupil)));
    if (text === null) return;
    if (!/^\s*\d{1,2}\s*$/.test(text)) return say(T('Hãy nhập một số từ 0 đến 99.', 'Please type a number from 0 to 99.'), 'bad');
    setStars(ctx, pupil, Number(text)); render(); return;
  }
  if (act === 'llOff') {
    const m = ctx.marks.get(pupil.name), off = m && (m.status === NGHI || Q.ABSENT.includes(m.status));
    appendMark(ctx.session, pupil, off ? Q.tickStatus(ctx.session, today(), minutesNow()) : NGHI, m && m.contact, m && m.note);
    llMenu = null; render(); return;
  }
  const old = behaveFor(ctx.session).get(pupil.name), tags = old ? old.tags.slice() : [], note = old ? old.note : '';
  // A warning counts each time it is given; a marked person also counts as here.
  if (act === 'llWarnAdd') {
    tags.push(v); setBehave(ctx, pupil, tags, note);
    const m = ctx.marks.get(pupil.name);
    if (!(m && (Q.PRESENT.includes(m.status) || m.status === NGHI || Q.ABSENT.includes(m.status)))) appendMark(ctx.session, pupil, Q.tickStatus(ctx.session, today(), minutesNow()), m && m.contact, '', STAR_WAIT);
    llWarn = null; render(); shakeTile(i); return;
  }
  if (act === 'llTag') { const k = tags.indexOf(v); if (k >= 0) tags.splice(k, 1); else tags.push(v); setBehave(ctx, pupil, tags, note); render(); return; }
  if (act === 'llNoteSave') {
    const text = Q.clean(drafts['llnote:' + pupil.name] != null ? drafts['llnote:' + pupil.name] : note);
    delete drafts['llnote:' + pupil.name];
    setBehave(ctx, pupil, tags, text); llMenu = null; render(); say(T('Đã lưu ghi chú của ', 'Note saved for ') + (pupil.eng || pupil.name) + '.'); return;
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
  task.done = !task.done; render(); task.done = !task.done;
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
// IELTS 46.1 and 46.2 are speaking groups of IELTS 46 and share its sheet.
const isGroup = s => /\.\d+$/.test(s.cls);
const classOf = s => classList.find(c => c.key === s.classKey) || (isGroup(s) ? classList.find(c => c.key === Q.key(s.cls.replace(/\.\d+$/, ''))) : undefined);
// Kind of class, from its name: drives the coloured edge, the label and the filter.
const KINDS = [['kids', 'KIDS'], ['ielts', 'IELTS'], ['fighter', 'FIGHTER'], ['ta', 'TA'], ['tutor', 'TUTOR'], ['other', 'KHÁC']];
function kindOf(s) {
  const n = Q.clean(s.cls).toUpperCase();
  return /^KIDS/.test(n) ? 'kids' : /^IELTS/.test(n) ? 'ielts' : /^FIGHTER/.test(n) ? 'fighter' : /^TUTOR/.test(n) ? 'tutor' : /^TA\s*\d/.test(n) ? 'ta' : 'other';
}
const kindName = k => k === 'other' ? T('KHÁC', 'OTHER') : (KINDS.find(x => x[0] === k) || ['', k])[1];
// Owner 08/11: G = homeroom (Chủ nhiệm); F = Quay only for VIDEOTAPER NEEDED, Trông kiểm tra for TA NEEDED, else TA.
const invigilated = s => /\bTA NEEDED\b/.test(Q.key([s.note, s.detail].join(' '))) && !!s.video;
const rollTaker = s => invigilated(s) ? s.video : s.teacher;
// Who may take the roll and mark the class: the teacher, or the invigilator on a TA NEEDED session (homeroom and video TAs only look).
const takesRoll = s => !!me && (Q.nameKey(s.teacher) === Q.nameKey(me.name) || (invigilated(s) && Q.nameKey(s.video) === Q.nameKey(me.name)));
function helperRole(s) { const n = Q.key([s.note, s.detail].join(' ')); return /VIDEO ?TAPER/.test(n) ? T('Quay', 'Video') : /\bTA NEEDED\b/.test(n) ? T('Trông kiểm tra', 'Invigilator') : 'TA'; }
function sessionCard(s) {
  const c = classOf(s), k = kindOf(s), name = k === 'tutor' ? Q.clean(s.cls).replace(/^TUTOR\s*/i, '') : s.cls;
  const people = [[T('GV', 'Teacher'), s.teacher], [helperRole(s), s.video], [T('Chủ nhiệm', 'Homeroom'), s.ta]].filter(x => x[1]).map(x => '<span>' + x[0] + ' <b>' + esc(Q.key(x[1])) + '</b></span>').join('');
  const inner = '<div class="s-time"><b>' + Q.clock(s.start) + '</b><span>' + Q.clock(s.end) + '</span></div><div class="s-body">' +
    '<div class="s-head">' + (k === 'tutor' ? '<span class="kind k-tutor">TUTOR</span>' : '') + '<strong>' + esc(name) + '</strong>' + liveTag(s) + (s.off ? '<span class="tag bad">' + T('Nghỉ', 'Off') + '</span>' : '') + '<span class="spacer"></span><span class="room small">' + esc(s.site || T('Chưa ghi phòng', 'No room listed')) + '</span></div>' +
    (s.book ? '<div class="s-book">' + esc(s.book) + (s.lesson ? T(' · Tiết ', ' · Lesson ') + esc(s.lesson) : '') + '</div>' : '') +
    (s.detail ? '<div class="detail">' + esc(s.detail) + '</div>' : '') +
    (s.also.length ? '<div class="detail">' + T('Cùng buổi: ', 'Same session: ') + esc(s.also.join(', ')) + '</div>' : '') +
    (people || s.breakAt ? '<div class="people">' + people + (s.breakAt ? '<span>' + T('Giải lao ', 'Break ') + '<b>' + esc(s.breakAt) + '</b></span>' : '') + '</div>' : '') +
    (s.note ? '<div><span class="tag warn">' + esc(s.note.replace(/\n/g, ' · ')) + '</span></div>' : '') + '</div>';
  const cl = 'card session k-' + k + (s.off ? ' off' : '');
  return c ? '<button class="' + cl + ' link" data-act="open" data-row="' + s.row + '">' + inner + '</button>' : '<div class="' + cl + '">' + inner + '</div>';
}
// Morning, afternoon and evening blocks with a count each, so a full day reads at a glance.
function dayParts(list) {
  const parts = [[T('Sáng', 'Morning'), s => s.start < 12 * 60], [T('Chiều', 'Afternoon'), s => s.start >= 12 * 60 && s.start < 17 * 60], [T('Tối', 'Evening'), s => s.start >= 17 * 60]];
  return parts.map(([label, test], i) => { const got = list.filter(test); return got.length ? '<div class="part p-' + i + '"><h2>' + label + '</h2><span>' + got.length + T(' buổi', ' sessions') + '</span></div><div class="grid">' + got.map(sessionCard).join('') + '</div>' : ''; }).join('');
}
function dayStats(list) {
  const on = list.filter(s => !s.off), people = new Set(on.flatMap(s => [s.teacher, s.ta, s.video]).filter(Boolean).map(Q.nameKey));
  const cell = (n, label, k) => '<div class="card stat' + (k === 'off' ? ' off' : k ? ' k-' + k : '') + '"><b>' + n + '</b><span>' + esc(label) + '</span></div>';
  return '<div class="stats">' + cell(on.length, T('buổi học', 'sessions')) +
    KINDS.map(([k]) => { const n = on.filter(s => kindOf(s) === k).length; return n ? cell(n, kindName(k), k) : ''; }).join('') +
    cell(people.size, T('GV / TA đi làm', 'staff on duty')) + (list.length - on.length ? cell(list.length - on.length, T('buổi nghỉ', 'cancelled'), 'off') : '') + '</div>';
}
const scopeSeg = () => '<div class="seg" role="group" aria-label="' + T('Phạm vi', 'Scope') + '"><button class="' + (filters.showAll ? 'on' : '') + '" data-act="scope" data-v="1" aria-pressed="' + !!filters.showAll + '"><span class="seg-l">' + T('Cả trung tâm', 'Whole centre') + '</span><span class="seg-s">' + T('Trung tâm', 'Centre') + '</span></button>' +
  '<button class="' + (filters.showAll ? '' : 'on') + '" data-act="scope" data-v="" aria-pressed="' + !filters.showAll + '"><span class="seg-l">' + T('Lịch của tôi', 'My schedule') + '</span><span class="seg-s">' + T('Của tôi', 'Mine') + '</span></button></div>';
const dayBar = () => '<div class="daybar"><button data-act="day" data-n="-1" aria-label="' + T('Hôm trước', 'Previous day') + '">‹</button><b>' + esc(dayLabel(day)) + '</b>' + (day !== today() ? '<button class="quiet" data-act="today">' + T('Hôm nay', 'Today') + '</button>' : '') + '<button data-act="day" data-n="1" aria-label="' + T('Hôm sau', 'Next day') + '">›</button></div>';

/* ---------- People: who is who today ---------- */
// Someone who has left, and who now covers their IELTS duty (owner 07/11: Hường left, THU HIEN covers IELTS).
const LEFT_STAFF = { HUONG: 'THU HIEN' };
const staffNow = (name, cls) => { const k = Q.key(name); return LEFT_STAFF[k] && /^IELTS/i.test(Q.clean(cls)) ? LEFT_STAFF[k] : Q.clean(name); };
// "SON" on the TA plan is VAN SON; a one-word name matches the last word of a full name.
function isMe(name) {
  const k = Q.key(name), mine = Q.key(me.name);
  return !!k && (k === mine || (!k.includes(' ') && mine.split(' ').pop() === k));
}
// Homeroom of KIDS classes comes from the PHÂN CÔNG LỚP HỌC tab (ML / TT / SƠN under each class number); others from the session row.
const CN_CODE = { ML: 'MY LINH', TT: 'THUY TRANG', SON: 'VAN SON', S: 'VAN SON' };
let homeroom = {};
function setHomeroom(rows) {
  const out = {}, head = rows[0] || [];
  head.forEach((n, c) => {
    if (!c || !/^\d+$/.test(Q.clean(n))) return;
    for (let r = 1; r < Math.min(rows.length, 6); r++) { const code = Q.key((rows[r] || [])[c]); if (CN_CODE[code]) { out['KIDS ' + Q.clean(n)] = CN_CODE[code]; break; } }
  });
  homeroom = out;
}
async function loadHomeroom() {
  const hit = saved.get('homeroom');
  if (hit) setHomeroom(hit.rows);
  if (hit && Date.now() - hit.at < FRESH_MS) return;
  const [rows] = await batchGet(CONFIG.scheduleId, ["'PHÂN CÔNG LỚP HỌC'!A1:AZ6"]);
  keep('homeroom', { rows, at: Date.now() });
  setHomeroom(rows);
}
// Owner 07/11: THU HIEN is the homeroom of every IELTS and FIGHTER class; an invigilator in the session row still opens the class.
const BLOCK_CM = [[/^FIGHTER\b/i, 'THU HIEN'], [/^IELTS\b/i, 'THU HIEN']];
const cmOf = s => homeroom[Q.key(s.cls)] || (BLOCK_CM.find(([re]) => re.test(Q.clean(s.cls))) || [])[1] || staffNow(s.ta, s.cls);
const dutyOf = (week, d) => (week && week.data.duty && week.data.duty.days[d]) || null;
const onDuty = (week, d) => { const x = dutyOf(week, d); return !!x && x.work.some(p => isMe(p.name)); };
// Sessions this person stands in front of: teacher or video, never homeroom duty.
const teaches = s => isMe(s.teacher) || isMe(s.video);

/* ---------- Attendance alerts: pupils nobody ticked, for everyone on duty that day ---------- */
const ALERT_EVERY = 120000;
let alertTimer = null, alertLoading = false, alertTried = 0;
const alertScope = (week, s) => isManager() || onDuty(week, s.day) || teaches(s) || isMe(cmOf(s));
function alertSessions(week) {
  if (!week || day !== today()) return [];
  const now = minutesNow();
  return week.data.sessions.filter(s => s.day === day && !s.off && classOf(s) && s.start + Q.ROLL_CALL_MINUTES <= now && s.day >= (classOf(s).since || '') && alertScope(week, s));
}
// Rosters (light reads, kept 15 minutes) and the attendance tail; nothing else.
async function loadAlerts() {
  const week = weeks[Q.weekTab(tabs, today())];
  const list = alertSessions(week);
  if (!list.length || alertLoading) return;
  alertLoading = true;
  try {
    await loadMarks();
    const left = [...new Set(list.map(classOf))];
    const work = async () => { while (left.length) { const c = left.shift(); try { await loadTracker(c, false, true); } catch (e) {} } };
    await Promise.all([work(), work()]);
  } finally { alertLoading = false; }
  render();
}
function startAlerts() {
  if (alertTimer) return;
  alertTimer = setInterval(() => {
    if (document.hidden || view !== 'lich' || day !== today()) return;
    loadMarks(true).then(() => loadAlerts()).catch(() => {});
  }, ALERT_EVERY);
}
function alertsBlock(week) {
  const cards = [];
  let count = 0;
  alertSessions(week).forEach(s => {
    const ctx = classContext(s);
    if (!ctx.tracker) return;
    const roll = Q.rollCall(s, ctx.marks, today(), minutesNow()), people = 'GV ' + esc(s.teacher) + (cmOf(s) ? ' · CN ' + esc(cmOf(s)) : '');
    const head = '<div class="row-top"><b>' + esc(s.cls) + '</b><span class="muted small">' + sessionTime(s) + ' · ' + people + '</span><span class="spacer"></span><button class="quiet" data-act="open" data-row="' + s.row + '" data-day="' + s.day + '">' + T('Mở lớp', 'Open') + '</button></div>';
    if (roll.noRollCall) { count++; cards.push('<div class="card row alert">' + head + '<div class="notice bad">' + (invigilated(s) ? T('Chưa ai điểm danh lớp này. TA trông kiểm tra ' + s.video + ' vào điểm danh ngay.', 'Nobody has taken attendance yet. Invigilator ' + s.video + ', please take it.') : T('Chưa ai điểm danh lớp này. GV/TA vào điểm danh ngay.', 'Nobody has taken attendance yet.')) + '</div></div>'); return; }
    if (isGroup(s)) return;
    const waiting = ctx.tracker.pupils.filter(p => { const m = ctx.marks.get(p.name), st = Q.pupilState(m, roll); return st === 'Vắng chờ xác minh' || (m && m.status === 'Chưa báo nghỉ' && !m.contact); });
    if (!waiting.length) return;
    count += waiting.length;
    const data = p => 'data-row="' + s.row + '" data-day="' + s.day + '" data-name="' + esc(p.name) + '"';
    cards.push('<div class="card row alert">' + head + waiting.map(p => {
      const m = ctx.marks.get(p.name), notTold = m && m.status === 'Chưa báo nghỉ', phone = (String(p.phone || '').match(/[\d .]{9,}/) || [''])[0].trim();
      return '<div class="pupil-alert"><div class="row-top"><b>' + esc(p.eng || p.name) + '</b><span class="small muted">' + esc(p.name) + '</span>' + (phone ? '<a class="small" href="tel:' + esc(phone.replace(/[\s.]/g, '')) + '">' + esc(phone) + '</a>' : '') + '</div>' +
        (notTold ? '<div class="choices"><span class="tag bad">' + T('Chưa báo nghỉ, nhắn hỏi PH ngay', 'Not reported, message the parent') + '</span><button class="good" data-act="contact" ' + data(p) + '>' + T('Đã nhắn PH', 'Parent messaged') + '</button></div>'
          : '<div class="choices"><button class="good" data-act="present" ' + data(p) + '>' + T('Có mặt', 'Here') + '</button><button class="mid" data-act="absence" data-v="Đã báo nghỉ" ' + data(p) + '>' + T('Đã báo nghỉ', 'Reported absent') + '</button><button class="low" data-act="absence" data-v="Chưa báo nghỉ" ' + data(p) + '>' + T('Chưa báo · nhắn PH', 'Not reported') + '</button></div>') + '</div>';
    }).join('') + '</div>');
  });
  if (!cards.length) return alertLoading ? '<p class="small muted">' + T('Đang xem điểm danh các lớp hôm nay…', 'Checking today\'s attendance…') + '</p>' : '';
  return '<div class="part p-alert"><h2>' + T('Cần xử lý ngay', 'Needs action now') + '</h2><span>' + count + T(' mục chưa rõ điểm danh', ' open') + '</span></div><div class="list">' + cards.join('') + '</div>';
}

/* ---------- IELTS / FIGHTER: homework owed before class (the server reads the sheet and keeps a short list 10 minutes) ---------- */
const owedCache = {};
let owedLoading = false, owedTried = 0;
const isSecondary = s => /^(IELTS|FIGHTER)\s/i.test(Q.clean(s.cls));
const owedScope = (week, s) => isManager() || onDuty(week, s.day) || isMe(cmOf(s));
const owedSessions = week => week ? week.data.sessions.filter(s => s.day === day && !s.off && isSecondary(s) && classOf(s) && owedScope(week, s)).sort((a, b) => a.start - b.start) : [];
async function loadOwed(week) {
  if (owedLoading) return;
  const want = [...new Set(owedSessions(week).map(s => classOf(s).tracker))].filter(t => { const h = owedCache[t + '|' + day]; return !h || Date.now() - h.at > 600000; });
  if (!want.length) return;
  owedLoading = true;
  const d = day;
  try {
    const work = async () => { while (want.length) { const t = want.shift(); try { owedCache[t + '|' + d] = { at: Date.now(), data: await call('baino', { file: t, day: d }) }; } catch (e) { owedCache[t + '|' + d] = { at: Date.now(), data: null, error: e.message }; } render(); } };
    await Promise.all([work(), work()]);
  } finally { owedLoading = false; render(); }
}
function owedBlock(week) {
  const list = owedSessions(week);
  if (!list.length) return '';
  if (!owedLoading && Date.now() - owedTried > 60000 && list.some(s => !owedCache[classOf(s).tracker + '|' + day])) { owedTried = Date.now(); setTimeout(() => loadOwed(week).catch(() => {}), 0); }
  const name = p => esc(p.eng || p.name);
  const cards = list.map(s => {
    const hit = owedCache[classOf(s).tracker + '|' + day], head = '<div class="row-top"><b>' + esc(s.cls) + '</b><span class="muted small">' + sessionTime(s) + ' · GV ' + esc(s.teacher) + '</span></div>';
    if (!hit) return '<div class="card row owed-card">' + head + '<div class="small muted">' + T('Đang đọc sheet lớp…', 'Reading…') + '</div></div>';
    if (!hit.data) return '<div class="card row owed-card">' + head + '<div class="small muted">' + T('Chưa đọc được: ', 'Could not read: ') + esc(hit.error || '') + '</div></div>';
    const group = /\.\d+$/.test(s.cls), pupils = hit.data.pupils.filter(p => !group || !p.part || Q.key(p.part) === Q.key(s.cls));
    const dueNow = pupils.map(p => ({ p, o: p.owed.filter(o => o.due === day) })).filter(x => x.o.length);
    const late = pupils.map(p => ({ p, o: p.owed.filter(o => o.due < day) })).filter(x => x.o.length).sort((a, b) => b.o.length - a.o.length);
    if (!dueNow.length && !late.length) return '<div class="card row owed-card">' + head + '<span class="tag ok">' + T('Cả lớp đã nộp đủ', 'All handed in') + '</span></div>';
    const line = x => '<div class="owe-row"><span class="owe-n">' + x.o.length + '</span><b>' + name(x.p) + '</b><span class="small muted">' + esc(x.o.slice(0, 3).map(o => o.label + (o.due < day ? ' (hạn ' + o.due.slice(8) + '/' + o.due.slice(5, 7) + ')' : '')).join(', ') + (x.o.length > 3 ? ' …' : '')) + '</span></div>';
    const chips = list => '<div class="chips-n">' + list.map(x => '<span class="kid"><b>' + name(x.p) + '</b>' + (x.o.length > 1 ? '<i>' + x.o.length + '</i>' : '') + '</span>').join('') + '</div>';
    return '<div class="card row owed-card">' + head +
      (dueNow.length ? '<div class="owed-h warn">' + T('Chưa nộp bài hạn hôm nay', 'Due today, not handed in') + ' · ' + dueNow.length + ' HS</div>' + chips(dueNow) : '') +
      (late.length ? '<div class="owed-h bad">' + T('Quá hạn chưa làm', 'Overdue, not done') + ' · ' + late.length + ' HS</div>' + chips(late) : '') +
      '<details><summary>' + T('Xem từng bài', 'Show each task') + '</summary>' + dueNow.concat(late).map(line).join('') + '</details></div>';
  });
  return '<div class="part p-alert"><h2>' + T('Trước giờ học · IELTS / FIGHTER', 'Before class · IELTS / FIGHTER') + '</h2><span>' + T('bài chưa nộp, để nhắc và xử lí', 'work not handed in') + '</span></div><div class="grid">' + cards.join('') + '</div>';
}

function penaltyBlock(week) {
  const p = week && week.data.penalty && week.data.penalty[day];
  if (!p || !p.blocks.length) return '';
  const taSide = isTaSide(week), mineCls = new Set(week.data.sessions.filter(s => s.day === day && (teaches(s) || isMe(cmOf(s)))).map(s => Q.key(s.cls).replace(/\.\d+$/, '')));
  const blocks = taSide ? p.blocks : p.blocks.filter(b => mineCls.has(Q.key(b.cls).replace(/\.\d+$/, '')));
  if (!blocks.length) return '';
  const line = l => /^Mức \d/.test(l) ? '<div class="pen-level">' + esc(l) + '</div>' : '<div class="pen-kid">' + esc(l.replace(/^•\s*/, '')) + '</div>';
  return '<div class="part p-alert"><h2>' + T('HS cần phạt hôm nay', 'Pupils on the penalty list today') + '</h2><span>' + esc(p.head || '') + '</span></div>' +
    '<div class="grid">' + blocks.map(b => '<div class="card row pen"><b>' + esc(b.title) + '</b>' + b.lines.map(line).join('') + '</div>').join('') + '</div>';
}

/* ---------- TA work plan of the day ---------- */
const isTaSide = week => isManager() || /^TA$/i.test(Q.clean(me.role)) || Object.values((week && week.data.duty && week.data.duty.days) || {}).some(d => d.work.concat(d.off, d.lock).some(p => isMe(p.name)));
function dutyBlock(week) {
  if (!isTaSide(week)) return '';
  const x = dutyOf(week, day);
  if (!x || (!x.work.length && !x.off.length && !x.lock.length && !x.note)) return '';
  const chip = p => '<span class="person' + (isMe(p.name) ? ' me' : '') + '">' + esc(Q.key(p.name)) + (p.note ? ' <i>' + esc(p.note) + '</i>' : '') + '</span>';
  const mine = x.work.find(p => isMe(p.name)), off = x.off.some(p => isMe(p.name)), lock = x.lock.some(p => isMe(p.name));
  const status = mine ? T('Hôm nay bạn đi làm', 'You work today') + (mine.note ? ' (' + esc(mine.note) + ')' : '') + (lock ? T(' · bạn khóa cửa', ' · you lock up') : '') : off ? T('Hôm nay bạn nghỉ', 'You are off today') : '';
  return '<div class="part p-0"><h2>' + T('Lịch làm việc', 'Work plan') + '</h2>' + (status ? '<span class="tag ' + (mine ? 'ok' : 'warn') + '">' + status + '</span>' : '') + '</div>' +
    '<div class="card row duty">' +
    (x.work.length ? '<div><span class="lbl">' + T('Đi làm', 'Working') + '</span>' + x.work.map(chip).join('') + '</div>' : '') +
    (x.off.length ? '<div><span class="lbl">' + T('Nghỉ', 'Off') + '</span>' + x.off.map(chip).join('') + '</div>' : '') +
    (x.lock.length ? '<div><span class="lbl">' + T('Khóa cửa', 'Locks up') + '</span>' + x.lock.map(chip).join('') + '</div>' : '') +
    (x.note ? '<div><span class="lbl">' + T('Ghi chú', 'Note') + '</span>' + esc(x.note) + '</div>' : '') +
    (week.data.duty.general ? '<div class="small muted">' + esc(week.data.duty.general) + '</div>' : '') + '</div>';
}

/* ---------- Important Task by the day it is due for me ---------- */
function myTaskBlock(week) {
  const mine = week.data.tasks.map(t => Object.assign({}, t, { ta: staffNow(t.ta, t.cls) })).filter(t => isMe(t.teacher) || isMe(t.ta));
  if (!mine.length) return '';
  const dueOf = t => isMe(t.teacher) ? t.gradeDue : t.returnDue, todo = mine.filter(t => !t.done), done = mine.filter(t => t.done);
  const groups = new Map();
  todo.sort((a, b) => (dueOf(a) || '9').localeCompare(dueOf(b) || '9')).forEach(t => {
    const d = dueOf(t) || '', label = !d ? T('Chưa có hạn', 'No date') : d < today() ? T('Quá hạn', 'Overdue') : d === today() ? T('Hôm nay', 'Today') : d === Q.addDays(today(), 1) ? T('Ngày mai', 'Tomorrow') : dayLabel(d);
    if (!groups.has(label)) groups.set(label, []);
    groups.get(label).push(t);
  });
  const row = t => { const real = week.data.tasks.find(x => x.row === t.row); return taskRow(Object.assign({}, real, { ta: t.ta }), week, true); };
  let h = '<div class="part p-1"><h2>' + T('Important Task của tôi', 'My important tasks') + '</h2><span>' + todo.length + T(' việc còn lại · chạm ✓ khi xong', ' to do · tap ✓ when done') + '</span></div>';
  groups.forEach((list, label) => { h += '<div class="due-label' + (label === T('Quá hạn', 'Overdue') ? ' late' : '') + '">' + esc(label) + ' · ' + list.length + '</div><div class="list">' + list.map(row).join('') + '</div>'; });
  if (done.length) h += '<details class="done-list" open><summary>' + T('Đã xong', 'Done') + ' (' + done.length + ')</summary><div class="list">' + done.map(row).join('') + '</div></details>';
  return h;
}

/* ---------- Homeroom classes and the homework each pupil still owes ---------- */
let cnLoading = false;
function myHomerooms() {
  const out = new Map();
  Object.values(weeks).forEach(w => w.data.sessions.forEach(s => {
    const c = classOf(s);
    if (!c || isGroup(s) || s.day < Q.addDays(today(), -7)) return;
    const cm = cmOf(s);
    if (!cm || !(isMe(cm) || isManager())) return;
    const hit = out.get(c.key) || { cls: c, cm, next: null };
    if ((s.day < today() || (s.day === today() && s.start <= minutesNow())) && !s.off && (!hit.last || s.day + Q.clock(s.start) > hit.last.day + Q.clock(hit.last.start))) hit.last = s;
    if ((s.day > today() || (s.day === today() && s.start >= minutesNow())) && (!hit.next || s.day + Q.clock(s.start) < hit.next.day + Q.clock(hit.next.start))) hit.next = s;
    if (s.day >= today() || !out.has(c.key)) hit.cm = cm;
    out.set(c.key, hit);
  }));
  Object.keys(homeroom).forEach(k => {
    const c = classList.find(x => x.key === Q.key(k));
    if (!c) return;
    const hit = out.get(c.key) || { cls: c, cm: homeroom[k], next: null };
    hit.cm = homeroom[k];
    out.set(c.key, hit);
  });
  return [...out.values()].filter(x => isMe(x.cm) || isManager()).sort((a, b) => a.cls.name.localeCompare(b.cls.name, 'vi', { numeric: true }));
}
async function loadHomerooms(only) {
  if (cnLoading) return;
  cnLoading = true;
  try {
    await Promise.all([weekOf(today()), weekOf(Q.addDays(today(), 7)), loadHomeroom()].map(p => Promise.resolve(p).catch(() => null)));
    const left = myHomerooms().filter(x => (only ? x.cls.key === only : isMe(x.cm)) && !(trackers[x.cls.key] && !trackers[x.cls.key].light)).map(x => x.cls);
    render();
    const work = async () => { while (left.length) { const c = left.shift(); try { await loadTracker(c); } catch (e) {} render(); } };
    await Promise.all([work(), work()]);
  } finally { cnLoading = false; render(); }
}
function viewHomerooms() {
  const list = myHomerooms();
  let h = '<h2>' + T('Lớp chủ nhiệm', 'Homeroom classes') + '</h2><p class="sub small muted">' + T('Số bài web còn thiếu trong 14 ngày gần nhất, nhiều nhất ở trên. Chạm tên lớp để mở.', 'Web homework still missing in the last 14 days.') + '</p>';
  if (!list.length) return h + '<div class="card empty">' + (cnLoading ? T('Đang đọc…', 'Reading…') : T('Bạn chưa chủ nhiệm lớp nào trong tuần này.', 'No homeroom class this week.')) + '</div>';
  const byCm = new Map();
  list.forEach(x => { const k = Q.key(x.cm); if (!byCm.has(k)) byCm.set(k, []); byCm.get(k).push(x); });
  byCm.forEach((items, cm) => {
    if (isManager()) h += '<div class="part p-2"><h2>' + esc(cm) + '</h2><span>' + items.length + T(' lớp', ' classes') + '</span></div>';
    h += '<div class="grid">' + items.map(x => {
      const t = trackers[x.cls.key], next = x.next ? dayLabel(x.next.day) + ' ' + Q.clock(x.next.start) : '';
      const title = '<div class="row-top"><b>' + esc(x.cls.name) + '</b>' + (next ? '<span class="small muted">' + T('Buổi tới ', 'Next ') + esc(next) + '</span>' : '') + '<span class="spacer"></span>' + (x.next ? '<button class="quiet" data-act="open" data-row="' + x.next.row + '" data-day="' + x.next.day + '">' + T('Mở lớp', 'Open') + '</button>' : '') + '</div>';
      if (!t || t.light) return '<div class="card row cn">' + title + '<button data-act="cnLoad" data-k="' + esc(x.cls.key) + '">' + T('Xem bài còn nợ', 'Show missing homework') + '</button></div>';
      const owed = Q.owedVideos(t.pupils, t.blocks, t.practices, t.cell, { day: Q.addDays(today(), 1) });
      const rows = t.pupils.map((p, i) => ({ p, n: owed[i].length, o: owed[i] })).filter(r => r.n).sort((a, b) => b.n - a.n);
      return '<div class="card row cn">' + title + '<div class="small">' + (rows.length ? '<span class="tag bad">' + rows.length + '/' + t.pupils.length + T(' HS còn nợ bài', ' pupils owe work') + '</span>' : '<span class="tag ok">' + T('Cả lớp đủ bài', 'All caught up') + '</span>') + '</div>' +
        rows.map(r => '<div class="owe-row"><span class="owe-n">' + r.n + '</span><b>' + esc(r.p.eng || r.p.name) + '</b><span class="small muted">' + esc([...new Set(r.o.map(o => o.practice ? o.label.replace(/^Tự luyện video/i, 'Tự luyện') : T('Tiết ', 'L') + o.lesson + (o.label && o.label.length <= 12 ? ' ' + videoLabel(o.label) : '')))].join(', ')) + '</span></div>').join('') + '</div>';
    }).join('') + '</div>';
  });
  return h;
}

function viewSchedule(week) {
  if (!week) return dayBar() + '<div class="card empty">' + T('File Schedule chưa có tuần này.', 'This week is not on the Schedule yet.') + '</div>';
  const all = week.data.sessions.filter(s => s.day === day).sort((a, b) => a.start - b.start);
  const list = isManager() && filters.showAll ? all : all.filter(teaches);
  let h = '<div class="dayrow">' + dayBar() + (isManager() ? scopeSeg() : '') + '</div>';
  // Attendance of today's classes is read in the background, at most once a minute when something is missing.
  if (day === today() && !alertLoading && Date.now() - alertTried > 60000 && alertSessions(week).some(s => !trackers[classOf(s).key])) { alertTried = Date.now(); setTimeout(() => loadAlerts().catch(() => {}), 0); }
  h += payNoticeBlock();
  h += checkinBlock(week);
  let today_ = alertsBlock(week);
  const secs = [];
  if (isManager() && filters.showAll && all.length) {
    h += dayStats(all);
    const kinds = KINDS.filter(([k]) => all.some(s => kindOf(s) === k));
  }
  const shown = isManager() && filters.showAll && filters.kind ? list.filter(s => kindOf(s) === filters.kind) : list;
  if (shown.length && isManager() && filters.showAll) today_ += dayParts(shown);
  else if (shown.length) {
    const teach = shown.filter(s => isMe(s.teacher)), help = shown.filter(s => !isMe(s.teacher));
    if (teach.length) today_ += '<div class="part p-1"><h2>' + T('Lớp tôi dạy', 'My classes') + '</h2><span>' + teach.length + T(' buổi', ' sessions') + '</span></div>' + dayParts(teach);
    if (help.length) today_ += '<div class="part p-1"><h2>' + T('Lớp tôi hỗ trợ', 'Classes I help in') + '</h2><span>' + help.length + T(' buổi · quay / trông kiểm tra', ' sessions · video / invigilation') + '</span></div>' + dayParts(help);
  }
  else if (isManager() && filters.showAll) today_ += '<div class="card empty">' + T('Không có buổi nào trong ngày này.', 'No sessions on this day.') + '</div>';
  // Each tab carries its own count; a tab with nothing in it is not shown.
  const ladderHtml = ladderBlock(week), owedHtml = '', workHtml = dutyBlock(week) + returnsBlock(week), taskHtml = myTaskBlock(week);
  const count = html => (html.match(/class="card row/g) || []).length;
  secs.push({ k: 'homnay', label: T('Hôm nay', 'Today'), html: today_, n: (today_.match(/class="card row alert/g) || []).length, hot: /class="card row alert/.test(today_) });
  if (ladderHtml) secs.push({ k: 'phat', label: T('Phạt & phụ huynh', 'Penalties & parents'), html: ladderHtml, n: typeof ladderTodo === 'function' ? ladderTodo(week) : count(ladderHtml), hot: /class="card row lad[^"]*late/.test(ladderHtml) });
  // Owner 08/11: the IELTS/FIGHTER owed tab is not needed any more (owed work shows on each class).
  if (false && owedHtml) secs.push({ k: 'baino', label: T('Bài nợ IELTS/FIGHTER', 'IELTS/FIGHTER owed'), html: owedHtml, n: count(owedHtml) });
  if (workHtml) secs.push({ k: 'lamviec', label: T('Lịch làm & trả bài', 'Rota & returns'), html: workHtml, n: count(workHtml) });
  if (taskHtml) secs.push({ k: 'task', label: 'Important Task', html: taskHtml, n: (taskHtml.match(/data-act="task"/g) || []).length });
  const bookHtml = typeof bookBlock === 'function' ? bookBlock() : '';
  if (bookHtml) secs.push({ k: 'sach', label: T('Đặt in sách', 'Book orders'), html: bookHtml, n: (bookHtml.match(/class="card row book todo/g) || []).length, hot: /class="card row book todo late/.test(bookHtml) });
  // Owner 08/11 ("cả app hiển thị như dash"): today stays on the page; the other parts are tiles that open in a dialog.
  const live = secs.filter(x => x.html), main = live.find(x => x.k === 'homnay'), side = live.filter(x => x.k !== 'homnay'), open = side.find(x => x.k === filters.sec);
  const SEC_TILE = { sach: ['📚', T('lớp cần đặt in sách', 'classes to order'), T('đã đặt đủ', 'all ordered')], phat: ['📞', T('cần liên hệ phụ huynh', 'parents to contact'), T('đã liên hệ đủ', 'all contacted')], lamviec: ['🗓️', T('việc trong ngày', 'today'), T('không có việc', 'nothing')], task: ['📝', T('việc cần làm', 'to do'), T('đã xong', 'done')] };
  if (side.length) h += '<div class="dash-grid mini">' + side.map(x => { const t = SEC_TILE[x.k] || ['•', '', '']; const tone = x.hot ? 'bad' : x.n ? 'warn' : 'ok'; return '<button class="dash-tile ' + tone + '" data-act="sec" data-v="' + x.k + '"><span class="dash-ico">' + t[0] + '</span><span class="dash-num">' + (x.n || 0) + '</span><span class="dash-name">' + esc(x.label) + '</span><span class="dash-sub">' + esc(x.n ? t[1] : t[2]) + '</span></button>'; }).join('') + '</div>';
  if (main) h += main.html;
  else h += '<div class="card empty">' + T('Hôm nay bạn không có lớp hay việc nào.', 'Nothing for you on this day.') + '</div>';
  if (open) h += '<div class="dash-veil" data-act="sec" data-v="homnay"></div><div class="dash-modal" role="dialog" aria-label="' + esc(open.label) + '"><div class="dash-head"><b>' + esc((SEC_TILE[open.k] || ['•'])[0] + ' ' + open.label) + '</b><span class="spacer"></span><button class="quiet" data-act="sec" data-v="homnay" aria-label="' + T('Đóng', 'Close') + '">✕</button></div><div class="dash-body">' + open.html + '</div></div>';
  return h;
}

function classContext(session) {
  const cls = classOf(session), tracker = trackers[cls.key], marks = marksOf(session);
  const found = tracker ? Q.findBlock(tracker.blocks, session) : { block: null, problem: '' };
  return { session, cls, tracker, marks, block: found.block, problem: found.problem };
}
function columnWarning(ctx) {
  const s = ctx.session;
  if (ctx.tracker && !ctx.tracker.blocks.length) return '';
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
  const assigned = takesRoll(s);
  const roll = Q.rollCall(s, ctx.marks, today(), minutesNow()), canEdit = !isChot(s) && (isManager() || (assigned && roll.open && !lessonClosed(s)));
  let h = '<div><button class="quiet" data-act="back">‹ ' + T('Lịch', 'Schedule') + '</button></div><div class="card class-head"><h1>' + esc(s.cls) + T(' · Tiết ', ' · Lesson ') + esc(s.lesson) + '</h1>' +
    '<div>' + esc(dayLabel(s.day)) + ' · <b>' + sessionTime(s) + '</b> · <span class="room">' + esc(s.site || T('Chưa ghi phòng', 'No room listed')) + '</span></div>' +
    '<div class="detail">' + esc(s.book) + (s.detail ? '\n' + esc(s.detail) : '') + '</div>' +
    '<div class="small muted">' + esc([T('GV ', 'Teacher ') + s.teacher, s.video && helperRole(s) + ' ' + s.video, s.ta && T('Chủ nhiệm ', 'Homeroom ') + s.ta].filter(Boolean).join(' · ')) + '</div>' +
    (s.note ? '<div><span class="tag warn">' + esc(s.note.replace(/\n/g, ' · ')) + '</span></div>' : '') + '</div>';
  if (!tracker) return h + '<div class="card empty">' + T('Đang đọc sheet lớp…', 'Reading the class sheet…') + '</div>';
  const warning = columnWarning(ctx);
  if (warning) h += '<div class="notice">' + esc(warning) + '</div>';
  h += '<button class="primary ll-open" data-act="llOpen">⭐ ' + T('Mở màn hình lên lớp', 'Open classroom screen') + '</button>';
  const present = tracker.pupils.filter(p => { const m = ctx.marks.get(p.name); return m && Q.PRESENT.includes(m.status); }).length;
  const group = isGroup(s), stateOf = p => group ? '' : Q.pupilState(ctx.marks.get(p.name), roll);
  const waiting = tracker.pupils.filter(p => stateOf(p) === 'Vắng chờ xác minh').length;
  h += '<div class="count"><span>' + present + '/' + tracker.pupils.length + T(' có mặt', ' present') + '</span>' +
    (roll.noRollCall ? '<span class="tag bad">' + T('Chưa điểm danh', 'Attendance not taken') + '</span>' : roll.past ? (waiting ? '<span class="tag bad">' + waiting + T(' vắng chờ xác minh', ' absent, awaiting check') + '</span>' : '<span class="tag ok">' + T('Đủ', 'All here') + '</span>') : '<span class="tag">' + T('Chốt lúc ', 'Closes at ') + Q.clock(roll.closeAt) + '</span>') + '</div>';
  if (group && !tracker.grouped) h += '<div class="notice">' + T('Đây là buổi nhóm nên danh sách là cả lớp, chỉ tick các em học nhóm này.', 'This is a group session showing the whole class, so tick only the pupils in this group.') + '</div>';
  if (isChot(s)) h += '<div class="notice ok">✅ ' + T('Buổi đã chốt lúc ', 'Lesson closed at ') + esc(String(chotOf(s).at || '').slice(11, 16) || '') + (chotOf(s).by ? T(' bởi ', ' by ') + esc(chotOf(s).by) : '') + T('. Không sửa được nữa.', '. It can no longer be changed.') + (isManager() ? ' <button class="quiet" data-act="chotUndo">' + T('Mở lại để sửa', 'Reopen') + '</button>' : T(' Cần sửa thì báo quản lí.', ' Ask a manager to change anything.')) + '</div>';
  else if (!canEdit) h += '<div class="notice">' + (assigned && lessonClosed(s) ? T('Buổi học đã kết thúc quá ' + CLOSE_AFTER + ' phút nên đã khoá, không sửa được nữa. Cần sửa thì báo quản lí.', 'This lesson ended more than ' + CLOSE_AFTER + ' minutes ago and is locked. Ask a manager to change anything.') : assigned ? T('Điểm danh mở trước giờ học ' + Q.OPEN_BEFORE + ' phút.', 'Attendance opens ' + Q.OPEN_BEFORE + ' minutes before class.') : T('Chỉ xem được, buổi này không phân công cho Gmail này.', 'View only: this session is not assigned to this Gmail.')) + '</div>';
  const owed = Q.owedVideos(tracker.pupils, tracker.blocks, tracker.practices, tracker.cell, s);
  h += '<div class="card">' + tracker.pupils.map((p, i) => {
    const m = ctx.marks.get(p.name), on = m && Q.PRESENT.includes(m.status), state = stateOf(p), value = ctx.block && ctx.block.grade >= 0 ? tracker.cell(p.row, ctx.block.grade) : '', g = Q.gradeOf(value);
    const grades = ctx.block && ctx.block.grade >= 0 ? '<div class="grades">' + ['A+', 'B', 'F'].map(x => '<button class="' + (g === x ? 'on ' : '') + x[0] + '" data-act="grade" data-i="' + i + '" data-v="' + x + '"' + (canEdit ? '' : ' disabled') + '>' + x + '</button>').join('') + '</div>' : (typeof secClassButtons === 'function' ? secClassButtons(ctx, p, i, canEdit) : '<div></div>');
    const owedText = owed[i].map(o => (o.practice ? T(o.label, o.label.replace('Tự luyện video', 'Self-study video').replace('Tự luyện', 'Self-study')) : T('Tiết ', 'Lesson ') + o.lesson + (o.label ? ' ' + videoLabel(o.label) : '')) + (o.wrong ? T(' (quay sai)', ' (filmed wrong)') : '')).join(', ');
    return '<div class="pupil' + (state === 'Vắng chờ xác minh' || Q.ABSENT.includes(state) ? ' absent' : '') + '"><button class="tick' + (on ? (m.status === 'Đến muộn' ? ' late' : ' on') : '') + '" data-act="tick" data-i="' + i + '" aria-pressed="' + Boolean(on) + '" aria-label="Điểm danh ' + esc(p.eng) + '"' + (canEdit ? '' : ' disabled') + '>✓</button>' +
      '<div class="who"><b>' + esc(p.eng || p.name) + '</b><span class="small muted">' + esc(p.name) + (state && !on ? ' · ' + esc(stateText(state)) : m && m.status === 'Đến muộn' ? T(' · Đến muộn', ' · Late') : '') + (g === '/' ? T(' · Sheet ghi vắng', ' · Sheet says absent') : '') + (value && !g ? T(' · Có ghi chú', ' · Has a note') : '') + '</span></div>' + grades +
      (gradeReason(value) ? '<div class="small muted">✎ ' + T('Lý do: ', 'Reason: ') + esc(gradeReason(value)) + '</div>' : '') + (typeof kidsMakeup === 'function' ? kidsMakeup(ctx, p, i, canEdit) : '') +
      // The owed line comes from extra.js (kidsMakeup wrapper): same count and rule as the class screen (owner 08/11).
      (typeof kidsMakeup === 'function' ? '' : (owedText ? '<div class="owed">' + T('Thiếu video: ', 'Missing video: ') + esc(owedText) + '</div>' : '')) + '</div>';
  }).join('') + '</div>';
  // Owner 07/11: the lesson report lives in the class sheet's BÁO CÁO tab, not here.
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
  Object.values(weeks).forEach(w => w.data.sessions.filter(s => classOf(s) && !isGroup(s) && !s.off && s.day >= from && s.day <= now && s.day >= (classOf(s).since || '')).forEach(s => {
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
  const line = e => '<div class="card row' + (e.status === 'Mở' ? '' : ' faded') + '"><div class="row-top"><b>' + esc(e.person) + '</b><span class="tag ' + (e.status === 'Mở' ? 'bad' : 'ok') + '">' + esc(e.type) + '</span><span class="muted small">' + esc(e.cls) + ' · ' + esc(e.day) + '</span><span class="spacer"></span><button class="quiet" data-act="closeError" data-id="' + esc(e.id) + '">' + (e.status === 'Mở' ? 'Đã xử lý' : 'Mở lại') + '</button></div><div>' + esc(e.text) + '</div></div>';
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
  const stText = lang === 'en' ? ({ 'Xong': 'Done', 'Quá hạn chấm': 'Grading overdue', 'Hạn chấm hôm nay': 'Grade today', 'Quá hạn trả': 'Return overdue', 'Hạn trả hôm nay': 'Return today', 'Chưa đến hạn trả': 'Return not due yet', 'Chưa đến hạn': 'Not due yet' }[st.text]) : st.text;
  const body = '<div><div class="row-top"><b>' + esc(t.cls) + '</b><span class="tag ' + tag + '">' + esc(stText) + '</span></div><div>' + esc(t.what) + '</div><div class="small muted">' + T('GV ', 'Teacher ') + esc(t.teacher) + T(' · Chấm trước ', ' · Grade by ') + esc(t.gradeDue ? dayLabel(t.gradeDue) : '?') + ' · TA ' + esc(t.ta) + T(' trả ', ' returns ') + esc(t.returnDue ? dayLabel(t.returnDue) : '?') + '</div></div>';
  return '<div class="card row"><div class="check">' + (canTick ? '<button class="' + (t.done ? 'on' : '') + '" data-act="task" data-row="' + t.row + '" aria-label="Đánh dấu xong" aria-pressed="' + t.done + '">✓</button>' : '') + body + '</div></div>';
}
// The TA weekly return list of the chosen day; one tap ticks the same box as in the Schedule.
function returnsBlock(week) {
  const list = (week.data.returns || []).filter(x => x.day === day);
  const last = Q.key(me.name).split(' ').pop(), mine = x => Q.key(x.who) === last;
  if (!list.length || !(isManager() || /^TA$/i.test(Q.clean(me.role)) || list.some(mine))) return '';
  const sorted = list.slice().sort((a, b) => mine(b) - mine(a) || a.done - b.done);
  const done = list.filter(x => x.done).length;
  return '<div class="part p-2"><h2>' + T('Trả BTVN hôm nay', 'Homework returns today') + '</h2><span>' + done + '/' + list.length + T(' lớp đã trả', ' returned') + '</span></div>' +
    '<div class="grid">' + sorted.map(x => '<div class="card row ret' + (mine(x) ? ' mine' : '') + (x.done ? ' done' : '') + '"><div class="check"><button class="' + (x.done ? 'on' : '') + '" data-act="ret" data-row="' + x.row + '" data-col="' + x.col + '" aria-pressed="' + x.done + '" aria-label="' + T('Đã trả ', 'Returned ') + esc(x.label) + '">✓</button><div><b>' + esc(x.cls) + '</b><div class="small muted">TA ' + esc(x.who) + (x.done ? T(' · đã trả', ' · returned') : '') + '</div></div></div></div>').join('') + '</div>';
}
async function tickReturn(week, item) {
  const cell = quote(week.tab) + '!' + Q.colName(item.col) + item.row, label = quote(week.tab) + '!' + Q.colName(item.col) + (item.row - 1);
  const want = item.done ? 'FALSE' : 'TRUE';
  item.done = !item.done; render();
  try {
    const [[l], [v]] = await batchGet(CONFIG.scheduleId, [label, cell]);
    if (!l || Q.clean(l[0]) !== item.label || !/^(TRUE|FALSE)$/i.test(Q.clean((v || [])[0]))) { item.done = !item.done; await weekOf(day, true); return say(T('Danh sách trả bài vừa đổi, vui lòng bấm lại.', 'The return list just changed, please tap again.'), 'bad'); }
    await batchWrite(CONFIG.scheduleId, [{ range: cell, values: [[want]] }]);
    saved.delete('week:' + week.tab);
  } catch (e) { item.done = !item.done; render(); say(T('Chưa tick được: ', 'Could not tick: ') + e.message, 'bad'); }
}
function taskPanel(week) {
  if (!week) return '<div class="card empty">File Schedule chưa có tuần này.</div>';
  const rank = { quahan: 0, homnay: 1, sap: 2, xong: 3 };
  const all = week.data.tasks.map(t => ({ t, st: Q.taskState(t, today()).state })).sort((a, b) => rank[a.st] - rank[b.st]);
  const names = [...new Set(all.map(x => x.t.teacher))].sort();
  const shown = all.filter(x => (filters.task === 'can' || x.st === filters.task || (typeof taskTicked !== 'undefined' && taskTicked.has(week.tab + '|' + x.t.row))) && (!filters.person || x.t.teacher === filters.person || x.t.ta === filters.person));
  const count = s => all.filter(x => x.st === s).length;
  return '<div class="filters"><select data-act="filter" data-k="task"><option value="can"' + (filters.task === 'can' ? ' selected' : '') + '>Chưa xong (' + (all.length - count('xong')) + ')</option><option value="quahan"' + (filters.task === 'quahan' ? ' selected' : '') + '>Quá hạn (' + count('quahan') + ')</option><option value="homnay"' + (filters.task === 'homnay' ? ' selected' : '') + '>Hạn hôm nay (' + count('homnay') + ')</option><option value="xong"' + (filters.task === 'xong' ? ' selected' : '') + '>Đã xong (' + count('xong') + ')</option></select>' +
    '<select data-act="filter" data-k="person"><option value="">Mọi người</option>' + names.map(x => '<option' + (x === filters.person ? ' selected' : '') + '>' + esc(x) + '</option>').join('') + '</select></div>' +
    '<p class="small muted">Danh sách lấy từ Important Task của tuần ' + esc(week.tab) + '. Tick ở đây ghi vào cột DONE trong Schedule.</p>' +
    (shown.length ? '<div class="list">' + shown.map(x => taskRow(x.t, week, true)).join('') + '</div>' : '<div class="card empty">Không có việc nào.</div>');
}

function columnPanel() {
  const rows = [], now = today(), until = Q.addDays(now, 14);
  Object.values(weeks).forEach(w => w.data.sessions.filter(s => classOf(s) && !s.off && s.day >= now && s.day <= until).forEach(s => { const ctx = classContext(s); if (ctx.tracker && ctx.tracker.blocks.length) rows.push(ctx); }));
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
async function loadNguoi() {
  // This week and last week from the Schedule give the full name list for the picker.
  await Promise.all([call('nguoi', {}).then(r => { nguoi = r; }), weekOf(today()), weekOf(Q.addDays(today(), -7))].map(p => Promise.resolve(p).catch(() => null)));
  render();
}
// Every name on the Schedule plus the staff sheet, each with a suggested role; names that already have a link are left out.
function nguoiChoices() {
  const out = new Map(), add = (name, role) => { const n = Q.key(name); if (n && n.length <= 60 && !out.has(n)) out.set(n, role); };
  (nguoi ? nguoi.staff : []).forEach(p => add(p.name, ['GV', 'TA', 'Quản lí'].includes(p.role) ? p.role : 'GV'));
  const ss = Object.values(weeks).flatMap(w => (w && w.data ? w.data.sessions : []));
  ss.forEach(x => add(x.teacher, 'GV'));
  ss.forEach(x => { add(x.ta, 'TA'); add(x.video, 'TA'); });
  const taken = new Set((nguoi ? nguoi.people : []).map(p => Q.key(p.name)));
  return [...out].filter(([n]) => !taken.has(n)).sort((a, b) => a[0].localeCompare(b[0], 'vi')).map(([name, role]) => ({ name, role }));
}
function viewNguoi() {
  const d = drafts.person = drafts.person || { role: 'GV' };
  let h = '<h2>Người dùng</h2><p class="sub">Mỗi người một link riêng, không cần đăng nhập. Xoá người là link đó hết hiệu lực.</p>';
  if (nguoiMoi) h += '<div class="card"><h3>Link của ' + esc(nguoiMoi.name) + '</h3><p>Link chỉ hiện lần này. Gửi riêng cho ' + esc(nguoiMoi.name) + ', đừng dán vào nhóm. Ai có link là vào được với tên người này.</p><p style="word-break:break-all;user-select:all">' + esc(nguoiMoi.link) + '</p><button class="primary" data-act="nguoiCopy">Copy link</button></div>';
  const names = nguoiChoices(), other = d.pick === '__khac';
  h += '<div class="card"><h3>Thêm người</h3><p>Chọn tên trong danh sách (lấy từ Schedule tuần này, tuần trước và bảng nhân sự). Người đã có link không hiện ở đây.</p>' +
    '<select data-act="personPick" aria-label="Tên"><option value="">— Chọn tên —</option>' + names.map(s => '<option value="' + esc(s.name) + '"' + (d.pick === s.name ? ' selected' : '') + '>' + esc(s.name) + '</option>').join('') + '<option value="__khac"' + (other ? ' selected' : '') + '>Tên khác (gõ tay)…</option></select> ' +
    (other ? '<input data-act="personField" data-k="name" placeholder="Tên đúng như trên Schedule" maxlength="60" value="' + esc(d.name || '') + '"> ' : '') +
    '<select data-act="personField" data-k="role" aria-label="Vai trò">' + ['GV', 'TA', 'Quản lí'].map(r => '<option' + (d.role === r ? ' selected' : '') + '>' + r + '</option>').join('') + '</select> <button class="primary" data-act="nguoiThem">Tạo link</button></div>';
  h += '<div class="card"><h3>Đang có link</h3>';
  if (!nguoi) h += '<p>Đang đọc…</p>';
  else if (!nguoi.people.length) h += '<p>Chưa cấp link cho ai.</p>';
  else h += '<div class="table"><table><tbody>' + nguoi.people.map(p => '<tr><td>' + esc(p.name) + '</td><td>' + esc(p.role) + '</td><td>Cấp ngày ' + esc(p.at) + '</td><td>' + (p.name === me.name && p.role === me.role ? '' : '<button class="quiet" data-act="nguoiXoa" data-id="' + esc(p.id) + '">Xoá</button>') + '</td></tr>').join('') + '</tbody></table></div>';
  return h + '</div>';
}
async function nguoiThem() {
  const d = drafts.person || {};
  if (!Q.clean(d.name)) return say('Hãy chọn tên.', 'bad');
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
const PANELS = [['ca', 'Vào ca (định vị)'], ['kpi', 'KPI'], ['cong', 'Chấm công'], ['vang', 'HS vắng'], ['loi', 'Lỗi'], ['task', 'Important Task'], ['cot', 'Cột lớp'], ['thang', 'Tổng tháng']];
function viewManager(week) {
  const body = { ca: () => caPanel(week), kpi: kpiPanel, cong: () => staffPanel(week), vang: absencePanel, loi: errorPanel, task: () => taskPanel(week), cot: columnPanel, thang: monthPanel }[panel]();
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
  const ranges = missing.map(t => quote(t) + '!A1:O400').concat(["'CHẤM CÔNG TỔNG HỢP'!R7:W46"]);
  const data = await batchGet(CONFIG.scheduleId, ranges);
  missing.forEach((t, i) => setWeek(t, data[i]));
  return (payCache[month] = { at: Date.now(), entries: wanted.flatMap(t => weeks[t].pay), marking: Q.parseMarking(data[data.length - 1]).filter(x => x.day.startsWith(month)) });
}
function viewPay() {
  const month = filters.payMonth, hit = payCache[month], who = isOwner() && filters.payPerson ? filters.payPerson : me.name; // owner 07/11: managers do not see other people's pay or hours
  const names = hit ? [...new Set(hit.entries.filter(e => e.count).map(e => e.person).concat(hit.marking.map(x => x.person)))].sort((a, b) => a.localeCompare(b, 'vi')) : [];
  let h = '<div class="filters"><input type="month" data-act="filter" data-k="payMonth" value="' + esc(month) + '" aria-label="' + T('Tháng', 'Month') + '">' +
    (isOwner() ? '<select data-act="filter" data-k="payPerson" aria-label="Người"><option value="">' + esc(me.name) + '</option>' + names.filter(n => n !== Q.key(me.name)).map(n => '<option' + (n === filters.payPerson ? ' selected' : '') + '>' + esc(n) + '</option>').join('') + '</select>' : '') + '</div>';
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
  return h + myKpiBlock();
}

/* ---------- Drawing ---------- */
function render() {
  if (!me) return;
  const active = document.activeElement;
  if (active && $('main').contains(active) && /^(INPUT|TEXTAREA)$/.test(active.tagName)) return;
  const items = [['lich', T('Lịch', 'Schedule')]].concat(isManager() || myHomerooms().some(x => isMe(x.cm)) ? [['lopcn', T('<span class="nl">Lớp chủ nhiệm</span><span class="ns">Chủ nhiệm</span>', 'Homeroom')]] : []).concat(isOwner() ? [['luong', T('Lương', 'Pay')]] : [['cong', T('<span class="nl">Công của tôi</span><span class="ns">Công</span>', '<span class="nl">My hours</span><span class="ns">Hours</span>')], ['luong', T('Lương', 'Pay')]]).concat(isManager() ? [['dieuhanh', 'Điều hành'], ['hocphi', T('Học phí', 'Tuition')]] : []).concat(isOwner() ? [['hopdong', T('Hợp đồng', 'Contracts')], ['nguoi', 'Người dùng']] : []);
  paintLang();
  paintTheme();
  $('nav').innerHTML = items.map(([k, t], i) => '<button class="' + (view === k ? 'on' : '') + (i >= 5 ? ' nav-x' : '') + '" data-act="view" data-v="' + k + '">' + t + '</button>').join('') +
    (items.length > 5 ? '<button class="nav-more' + (items.slice(5).some(([k]) => k === view) ? ' on' : '') + '" data-act="navMore" aria-label="' + T('Mục khác', 'More') + '" aria-expanded="' + $('nav').classList.contains('open') + '">⋯</button>' : '');
  const week = weeks[Q.weekTab(tabs, day)] || null;
  let h = notices.map((n, i) => '<div class="notice ' + n.kind + '" role="alert">' + esc(n.text) + ' <button class="quiet" data-act="dismiss" data-i="' + i + '">' + T('Đóng', 'Close') + '</button></div>').join('');
  if (loadError) h += '<div class="notice bad">' + esc(loadError) + '</div>';
  if (view === 'lenlop' && current) h =notices.map((n, i) => '<div class="notice ' + n.kind + '" role="alert">' + esc(n.text) + ' <button class="quiet" data-act="dismiss" data-i="' + i + '">' + T('Đóng', 'Close') + '</button></div>').join('') + viewLenLop();
  else if (view === 'lop' && current) h += viewClass();
  else if (view === 'dieuhanh' && isManager()) h += viewManager(week);
  else if (view === 'nguoi' && isOwner()) h += viewNguoi();
  else if (view === 'cong') h += viewPay();
  else if (view === 'luong') h += viewLuong();
  else if (view === 'hopdong' && isOwner()) h += viewHopDong();
  else if (view === 'lopcn') h += viewHomerooms();
  else if (view === 'hocphi' && isManager()) h += viewHocPhi();
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
  if (panel === 'ca') await Promise.all([loadCaAll(true), loadCa(true).catch(() => {})]);
  if (panel === 'kpi') { const m = filters.kpiMonth || today().slice(0, 7); if (!(kpi.data && kpi.month === m && kpi.scope === 'all')) await loadKpi(m, false); }
  if (panel === 'vang' || panel === 'cot') {
    await loadMarks();
    const absent = panel === 'vang', span = absent ? [-7, 0] : [0, 7, 14];
    await Promise.all(span.map(n => weekOf(Q.addDays(today(), n))));
    // Only classes with a session in the window, two at a time, so the list stays inside Google's limit.
    const from = Q.addDays(today(), span[0]), until = Q.addDays(today(), span[span.length - 1]), wanted = new Set();
    Object.values(weeks).forEach(w => w.data.sessions.forEach(s => { const c = classOf(s); if (c && !s.off && s.day >= from && s.day <= until && (!absent || s.day >= (c.since || ''))) wanted.add(c); }));
    const left = [...wanted], total = left.length, failed = [];
    let done = 0;
    const work = async () => {
      while (left.length) {
        const c = left.shift();
        try { await loadTracker(c, false, true); } catch (e) { failed.push(c.name); }
        done++;
        render();
        if (done < total) $('saveState').textContent = 'Đang đọc sheet lớp ' + done + '/' + total + '…';
      }
    };
    await Promise.all([work(), work()]);
    paintSave();
    if (failed.length) say('Chưa đọc được sheet: ' + failed.join(', '), 'bad');
  }
  if (panel === 'loi') await Promise.all([weekOf(today())]);
}
function findSession(row, onDay) {
  const week = weeks[Q.weekTab(tabs, onDay || day)];
  return week ? week.data.sessions.find(s => s.row === Number(row)) : null;
}
async function openClass(session) {
  current = session; view = 'lop'; render(); window.scrollTo(0, 0);
  await guarded(async () => { await Promise.all([loadMarks(true), loadTracker(classOf(session), true), loadBehave(true).catch(() => {})]); });
}

/* ---------- Events ---------- */
document.addEventListener('click', e => {
  const b = e.target.closest('[data-act]');
  if (!b || b.tagName === 'SELECT' || b.tagName === 'INPUT' || b.tagName === 'TEXTAREA') return;
  const act = b.dataset.act, v = b.dataset.v;
  if (act === 'view') { view = v; render(); if (v === 'luong' || v === 'hopdong') return; guarded(() => view === 'lopcn' ? loadHomerooms() : view === 'nguoi' ? loadNguoi() : view === 'dieuhanh' ? loadPanel() : view === 'cong' ? loadPay(filters.payMonth) : weekOf(day)); }
  if (act === 'panel') { panel = v; filters.person = ''; render(); guarded(loadPanel); }
  if (act === 'day') { day = Q.addDays(day, Number(b.dataset.n)); render(); guarded(() => view === 'dieuhanh' ? loadPanel() : weekOf(day)); }
  if (act === 'today') { day = today(); render(); guarded(() => weekOf(day)); }
  if (act === 'scope') { filters.showAll = Boolean(v); render(); }
  if (act === 'sec') { filters.sec = v; render(); window.scrollTo(0, 0); }
  if (act === 'kind') { filters.kind = v; render(); }
  if (act === 'back') { view = 'lich'; current = null; render(); }
  if (act === 'llOpen') { view = 'lenlop'; document.body.classList.add('lenlop'); render(); }
  if (/^ll[A-Z]/.test(act) && act !== 'llOpen') llAction(act, b.dataset.i, v);
  if (act === 'dismiss') { notices.splice(Number(b.dataset.i), 1); render(); }
  if (act === 'open') { const s = findSession(b.dataset.row, b.dataset.day); if (s && classOf(s)) openClass(s); }
  if (act === 'tick' || act === 'grade') {
    const ctx = classContext(current), pupil = ctx.tracker.pupils[Number(b.dataset.i)];
    if (act === 'tick') tickPupil(ctx, pupil); else if (typeof classGrade === 'function') classGrade(ctx, pupil, v, Number(b.dataset.i)); else setGrade(ctx, pupil, v);
  }
  if (act === 'cnLoad') guarded(() => loadHomerooms(b.dataset.k));
  if (act === 'present') {
    const s = findSession(b.dataset.row, b.dataset.day), ctx = classContext(s), pupil = ctx.tracker.pupils.find(p => p.name === b.dataset.name), m = ctx.marks.get(pupil.name);
    appendMark(s, pupil, Q.tickStatus(s, today(), minutesNow()), m && m.contact, m && m.note); render();
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
  if (act === 'ret') { const w = weeks[Q.weekTab(tabs, day)], x = w && (w.data.returns || []).find(r => r.row === Number(b.dataset.row) && r.col === Number(b.dataset.col)); if (x) tickReturn(w, x); }
  if (act === 'task') { const w = weeks[Q.weekTab(tabs, day)], t = w.data.tasks.find(x => x.row === Number(b.dataset.row)); tickTask(w, t); }
});
document.addEventListener('change', e => {
  const b = e.target.closest('[data-act]');
  if (!b) return;
  if (b.dataset.act === 'filter') { filters[b.dataset.k] = b.value; b.blur(); render(); if (b.dataset.k === 'payMonth' && b.value) guarded(() => loadPay(b.value)); }
  if (b.dataset.act === 'errField') { drafts.err[b.dataset.k] = b.value; }
  if (b.dataset.act === 'personField') { drafts.person = drafts.person || {}; drafts.person[b.dataset.k] = b.value; }
  if (b.dataset.act === 'personPick') {
    const d = drafts.person = drafts.person || { role: 'GV' }, c = nguoiChoices().find(x => x.name === b.value);
    d.pick = b.value; d.name = b.value === '__khac' ? '' : b.value; if (c) d.role = c.role;
    render();
  }
  if (b.dataset.act === 'staffField') {
    const s = findSession(b.dataset.row), p = Q.staffOf(s).find(x => x.name === b.dataset.p), k = staffKey({ day: s.day, cls: s.cls, time: Q.clock(s.start), person: p.name }), o = staffLatest().get(k);
    const row = [stamp(), s.day, p.name, p.role, s.cls, Q.clock(s.start), Q.clock(p.due), o.status, b.dataset.field === 'minutes' ? b.value : o.minutes, b.dataset.field === 'note' ? b.value : o.note, me.name];
    logs.staff.rows.push(staffOfRow(row));
    queue({ kind: 'append', file: CONFIG.quanLiId, tab: 'CONG', row });
  }
});
document.addEventListener('input', e => {
  const b = e.target.closest('[data-act]');
  if (b && b.dataset.act === 'llNote') drafts['llnote:' + b.dataset.name] = b.value;
});
window.addEventListener('online', flush);

/* ---------- Start ---------- */
// The last answer of 'boot' is kept on this device (for this link only): the page draws from it at once, like the parent dashboards,
// and the fresh answer replaces it a moment later.
const keyTag = k => { let n = 0; String(k || '').split('').forEach(c => { n = (n * 31 + c.charCodeAt(0)) >>> 0; }); return n.toString(36); };
function applyBoot(b) {
  people = b.people;
  classList = b.classes.map(c => ({ name: c.name, key: Q.key(c.name), tracker: c.tracker, since: c.since }));
  tabs = b.tabs;
  me = b.me;
}
function forget(k) { saved.delete(k); try { if (dbHandle) dbHandle.transaction('kv', 'readwrite').objectStore('kv').delete(k); } catch (e) {} }
// Week copies older than three weeks are dropped, so opening the page never has to read months of old rows.
function pruneWeeks() {
  const cut = Q.addDays(today(), -21);
  [...saved.keys()].filter(k => /^week:/.test(k)).forEach(k => { const m = k.match(/(\d\d)\.(\d\d)\.(\d{4})$/); if (m && m[3] + '-' + m[2] + '-' + m[1] < cut) forget(k); });
}
async function enter() {
  $('login').hidden = true; $('app').hidden = false;
  const tag = keyTag(accessKey), copy = saved.get('boot');
  if (copy && copy.tag === tag && copy.b) {
    try { applyBoot(copy.b); outbox = saved.get('outbox') || []; render(); weekOf(day).then(render).catch(() => {}); } catch (e) { /* the fresh answer below still comes */ }
  }
  try {
    const b = await call('boot', {});
    applyBoot(b);
    keep('boot', { tag, b, at: Date.now() });
    try { pruneWeeks(); } catch (e) {}
    outbox = saved.get('outbox') || [];
    render();
    await guarded(() => weekOf(day));
    flush();
    startAlerts();
    loadHomeroom().then(render).catch(() => {});
    if (view === 'lich') loadAlerts().catch(() => {});
    weekOf(Q.addDays(today(), 7)).catch(() => {});
  } catch (e) {
    if (e.status === 401) { forget('boot'); return; }
    me = me || { name: '', role: '' };
    loadError = T('Chưa mở được: ', 'Could not open: ') + e.message;
    $('main').innerHTML = '<div class="notice bad">' + esc(loadError) + '</div>';
  }
}
$('btnTheme').addEventListener('click', () => { theme = theme === 'dark' ? 'light' : 'dark'; document.documentElement.dataset.theme = theme; try { localStorage.setItem('ql-theme', theme); } catch (e) {} paintTheme(); });
$('btnLang').addEventListener('click', () => { lang = lang === 'en' ? 'vi' : 'en'; keep('lang', lang); paintLogin(); render(); });
$('btnLangLogin').addEventListener('click', () => { lang = lang === 'en' ? 'vi' : 'en'; keep('lang', lang); paintLogin(); });
function paintLogin() {
  $('loginText').textContent = T('Vui lòng mở app bằng link riêng quản lí đã gửi cho bạn.', 'Please open the app with the private link your manager sent you.');
  $('btnLangLogin').textContent = lang === 'en' ? 'Tiếng Việt' : 'English';
}
if ($('btnOut')) $('btnOut').addEventListener('click', () => {
  if (!window.confirm(T('Thoát trên máy này? Muốn vào lại phải mở lại link riêng.', 'Leave on this device? You will need your private link to come back.'))) return;
  accessKey = null; me = null; keep('key', '');
  showLogin(false);
});
// Starts once every script of the page has run (extra.js comes after this file).
const start = () => openStore().then(() => {
  lang = saved.get('lang') || 'vi';
  paintLogin();
  accessKey = readKey();
  if (accessKey) enter(); else showLogin(false);
});
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();
