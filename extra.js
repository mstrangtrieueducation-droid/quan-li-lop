/* Pages added 07/11: self check-in with location, payroll check, KPI, lesson report from the teacher's comment, labour contracts.
 * Loaded after app.js and uses its state and helpers. Each part shows only to the people it concerns. */
const xMonth = () => today().slice(0, 7);
const viDate = iso => iso ? iso.slice(8, 10) + '/' + iso.slice(5, 7) + '/' + iso.slice(0, 4) : '';
const monthName = m => T('tháng ', '') + Number(m.slice(5, 7)) + '/' + m.slice(0, 4);
const prevMonth = m => { let y = Number(m.slice(0, 4)), n = Number(m.slice(5, 7)) - 1; if (!n) { n = 12; y--; } return y + '-' + String(n).padStart(2, '0'); };
const sameName = (a, b) => Q.key(a) && Q.key(a) === Q.key(b);

/* ---------- Check-in with location ---------- */
const ca = { rows: null, cong: null, at: 0, loading: false, busy: false, centres: 0, all: null, allAt: 0, tried: 0 };
const caRow = r => ({ at: r[0], day: r[1], person: r[2], role: r[3], kind: r[4], time: r[5], due: r[6], late: Number(r[7]) || 0, dist: Number(r[8]), acc: Number(r[9]) || 0, status: r[10], note: r[11] || '', by: r[12] || '' });
async function loadCa(force) {
  if (ca.loading || (!force && ca.rows && Date.now() - ca.at < 120000)) return;
  ca.loading = true;
  try { const d = await call('catoi', { month: xMonth() }); ca.rows = d.checkin.map(caRow); ca.cong = d.cong.map(staffOfRow); ca.centres = d.centres; ca.names = d.centreNames || []; ca.at = Date.now(); }
  finally { ca.loading = false; }
}
// The first row is the press itself; a later row with the same day, person and kind is a manager's decision.
function caPair(rows, d, person, kind) {
  const list = rows.filter(r => r.day === d && sameName(r.person, person) && r.kind === kind);
  if (!list.length) return null;
  const first = list[0], last = list[list.length - 1];
  return { first, status: last.status, by: last !== first ? last.by : '', decided: last !== first ? last : null };
}
// Owner 07/11: TAs and managers are due at the centre by the rota: Mon–Fri 15:30; Sat and Sun morning 8:45;
// Saturday afternoon 14:30, Sunday afternoon 13:30. Morning or afternoon comes from the rota note ("sáng"/"chiều"),
// else from the time of the press (before noon = morning). A class that starts earlier still sets an earlier time.
const ROTA_DUE = { week: 15 * 60 + 30, am: 8 * 60 + 45, sat: 14 * 60 + 30, sun: 13 * 60 + 30 };
function rotaDue(week, d) {
  if (!me || isOwner()) return null;
  const x = dutyOf(week, d), mine = x && x.work.find(p => isMe(p.name));
  if (!(isManager() || mine || (!x && /^TA$/i.test(Q.clean(me.role))))) return null;
  const sh = mine && Q.shiftOf(mine.note);
  if (sh) return sh.start;
  const wd = new Date(d + 'T12:00:00').getDay();
  if (wd >= 1 && wd <= 5) return ROTA_DUE.week;
  const note = Q.key(mine ? mine.note : ''), pm = wd === 6 ? ROTA_DUE.sat : ROTA_DUE.sun;
  if (/SANG|CA NGAY/.test(note)) return ROTA_DUE.am;
  if (/CHIEU/.test(note)) return pm;
  return d === today() && minutesNow() >= 12 * 60 ? pm : ROTA_DUE.am;
}
function myDue(week, d) {
  let due = rotaDue(week, d);
  (week ? week.data.sessions : []).filter(s => s.day === d && !s.off).forEach(s => Q.staffOf(s).forEach(p => { if (isMe(p.name) && (due === null || p.due < due)) due = p.due; }));
  return due;
}
// Hours worked per day from the first check-in to the last check-out (part-time TAs are paid by the hour). A rejected day counts nothing.
const hm = t => { const m = String(t || '').match(/^(\d{1,2}):(\d\d)$/); return m ? Number(m[1]) * 60 + Number(m[2]) : null; };
function caHours(rows, person, prefix) {
  const days = new Map();
  rows.filter(r => sameName(r.person, person) && String(r.day).startsWith(prefix)).forEach(r => { const d = days.get(r.day) || { day: r.day }; if (r.kind === 'Vào ca') { if (!d.in) d.in = r; d.inStatus = r.status; } if (r.kind === 'Ra ca') { if (!d.out) d.out = r; d.outStatus = r.status; } days.set(r.day, d); });
  let total = 0, open = 0, rejected = 0, waiting = 0;
  const list = [...days.values()].sort((a, b) => a.day.localeCompare(b.day)).map(d => {
    const a = d.in ? hm(d.in.time) : null, b = d.out ? hm(d.out.time) : null, no = d.inStatus === 'Không duyệt' || d.outStatus === 'Không duyệt';
    const minutes = a != null && b != null && b > a && !no ? b - a : 0;
    if (no) rejected++; else if (d.in && !d.out) open++; else if (d.inStatus === 'Chờ duyệt' || d.outStatus === 'Chờ duyệt') waiting++;
    total += minutes;
    return Object.assign(d, { minutes, rejected: no });
  });
  return { days: list, total, open, rejected, waiting };
}
// Owner 07/11: only part-time TAs check out (paid by the hour); everyone else only checks in.
const PART_TIME_TA = ['PHUONG THANH', 'THU HIEN', 'HA PHUONG', 'BAO KHANH'];
// Owner 11/11 ("Sơn sao vẫn có nút ra ca"): the staff record (me.ca) wins for the person signed in; a name in the Schedule's
// part-time pay block (extra hours) does not make a full-time staff member part-time.
const fullTimeName = name => { try { return FULL_TIME_STAFF.some(n => sameName(n, name)); } catch (e) { return false; } };
const isPartTime = name => (typeof me !== 'undefined' && me && me.ca && sameName(me.name, name)) ? me.ca === 'part' : !fullTimeName(name) && PART_TIME_TA.some(n => sameName(n, name)) || Object.values(weeks).some(w => (w.pay || []).some(e => e.kind === 'Part-time' && sameName(e.person, name)));
const caTag = st => '<span class="tag ' + (st === 'Tự duyệt' || st === 'Đã duyệt' ? 'ok' : st === 'Không duyệt' ? 'bad' : 'warn') + '">' + esc(st) + '</span>';
function checkinBlock(week) {
  if (day !== today() || !me) return '';
  const due = myDue(week, day);
  if (isOwner()) return '';
  if (!ca.rows && !ca.loading && Date.now() - ca.tried > 60000) { ca.tried = Date.now(); setTimeout(() => loadCa().then(render).catch(() => {}), 0); }
  const rows = ca.rows || [], vin = caPair(rows, day, me.name, 'Vào ca'), vout = caPair(rows, day, me.name, 'Ra ca');
  let h = '<div class="card row checkin"><div class="row-top"><b>📍 ' + T('Chấm công của tôi', 'My check-in') + '</b><span class="small muted">' + (due !== null ? T('Có mặt trước ', 'Be here by ') + Q.clock(due) : onDuty(week, day) ? T('Đi làm theo lịch TA', 'On the TA rota') : T('Tính theo giờ vào, ra', 'Counted from in and out')) + '</span></div>';
  if (!ca.rows) return h + '<div class="small muted">' + T('Đang đọc…', 'Reading…') + '</div></div>';
  if (vin) h += '<div class="small">' + T('Vào ca ', 'In at ') + '<b>' + esc(vin.first.time) + '</b>' + (vin.first.late ? T(' · muộn ', ' · late ') + vin.first.late + T(' phút', ' min') : '') + ' ' + caTag(vin.status) + (vin.by ? ' <span class="muted">' + esc(vin.by) + '</span>' : '') + '</div>';
  if (vout) { const a = hm(vin && vin.first.time), b = hm(vout.first.time); h += '<div class="small">' + T('Ra ca ', 'Out at ') + '<b>' + esc(vout.first.time) + '</b> ' + caTag(vout.status) + (a != null && b > a ? ' · ' + T('làm ', 'worked ') + '<b>' + esc(Q.hoursText(b - a, lang)) + '</b>' : '') + '</div>'; }
  else if (vin && isPartTime(me.name)) h += '<div class="small muted">' + T('Về nhớ bấm Ra ca để tính giờ làm.', 'Press Check out when you leave so your hours count.') + '</div>';
  if (!vin) h += '<button class="primary big" data-act="caIn"' + (ca.busy ? ' disabled' : '') + '>' + (ca.busy ? T('Đang lấy vị trí…', 'Getting location…') : T('📍 Vào ca', '📍 Check in')) + '</button>';
  else if (!vout && isPartTime(me.name)) h += '<button class="big" data-act="caOut"' + (ca.busy ? ' disabled' : '') + '>' + (ca.busy ? T('Đang lấy vị trí…', 'Getting location…') : T('Ra ca', 'Check out')) + '</button>';
  if (!ca.centres) h += '<div class="small muted">' + T('Cô Trang chưa đặt vị trí trung tâm, tạm thời quản lí chấm công như cũ.', 'The centre location is not set yet.') + '</div>';
  return h + '</div>';
}
// Owner 09/11 (Hannah's check-in at 08:37 had no location): one precise GPS request of 15 s often fails indoors in the morning.
// Now the phone is listened to for up to 12 s and the best fix is kept (stopping early at about 60 m); with nothing from GPS,
// the quicker Wi-Fi / network position (up to 5 minutes old) is used. A failure says why, and the reason goes into the note.
const GEO_WHY = { 1: ['bị chặn quyền định vị', 'location permission blocked'], 2: ['không có tín hiệu vị trí', 'no location signal'], 3: ['hết thời gian chờ GPS', 'GPS timed out'] };
const geoError = e => { const w = GEO_WHY[e && e.code] || ['không rõ lỗi định vị', 'unknown location error']; const err = new Error(T(w[0], w[1])); err.why = 'GPS: ' + w[0]; return err; };
const position = () => new Promise((res, rej) => {
  if (!navigator.geolocation) { const err = new Error(T('máy không có định vị', 'no location on this device')); err.why = 'GPS: máy không có định vị'; return rej(err); }
  let best = null, done = false, watch = null, timer = null;
  const finish = (pos, err) => { if (done) return; done = true; clearTimeout(timer); if (watch != null) try { navigator.geolocation.clearWatch(watch); } catch (e) {} if (pos) res(pos); else rej(err); };
  const fallback = lastErr => navigator.geolocation.getCurrentPosition(p => finish(p), e => finish(null, geoError(lastErr && lastErr.code === 1 ? lastErr : e)), { enableHighAccuracy: false, timeout: 8000, maximumAge: 300000 });
  let lastErr = null;
  timer = setTimeout(() => { if (best) finish(best); else { if (watch != null) try { navigator.geolocation.clearWatch(watch); } catch (e) {} watch = null; fallback(lastErr); } }, 12000);
  try {
    watch = navigator.geolocation.watchPosition(p => { if (!best || p.coords.accuracy < best.coords.accuracy) best = p; if (p.coords.accuracy <= 60) finish(best); },
      e => { lastErr = e; if (e.code === 1) finish(null, geoError(e)); }, { enableHighAccuracy: true, maximumAge: 60000, timeout: 12000 });
  } catch (e) { clearTimeout(timer); fallback(null); }
});
async function caPress(kind) {
  if (ca.busy) return;
  ca.busy = true; render();
  let pos = null, posWhy = '';
  try { pos = await position(); }
  catch (e) {
    posWhy = e.why || '';
    if (!window.confirm(T('Không lấy được vị trí (' + (e.message || 'bị chặn') + '). Bạn bật định vị cho trình duyệt rồi bấm lại. Hay vẫn ghi giờ và chờ quản lí duyệt?', 'Could not get your location. Record the time anyway and wait for a manager?'))) { ca.busy = false; render(); return; }
  }
  try {
    const week = weeks[Q.weekTab(tabs, today())], due = myDue(week, today());
    const r = await call('vaoca', { kind, lat: pos ? pos.coords.latitude : '', lng: pos ? pos.coords.longitude : '', acc: pos ? Math.round(pos.coords.accuracy) : '', due: due !== null ? Q.clock(due) : '', note: posWhy }, 1);
    say((kind === 'ra' ? T('Đã ra ca lúc ', 'Out at ') : T('Đã vào ca lúc ', 'In at ')) + r.time + ' · ' + r.status + (r.note ? ' (' + r.note + ')' : ''), r.status === 'Tự duyệt' ? '' : 'bad');
    await loadCa(true);
  } catch (e) { say(T('Chưa chấm được: ', 'Not recorded: ') + e.message, 'bad'); }
  finally { ca.busy = false; render(); }
}
async function caCentre() {
  const name = Q.clean(drafts.caName || 'Cơ sở chính');
  try {
    const pos = await position();
    const r = await call('vaoca', { set: 'centre', name, lat: pos.coords.latitude, lng: pos.coords.longitude, acc: Math.round(pos.coords.accuracy) }, 1);
    say(T('Đã lưu vị trí ', 'Saved ') + name + '. ' + T('Các điểm đang dùng: ', 'Points in use: ') + r.centres.join(', ') + '.');
    ca.centres = r.centres.length;
  } catch (e) { say(T('Chưa lưu được vị trí: ', 'Could not save: ') + e.message, 'bad'); }
}
// The owner can also enter a point from a map: "21.310936, 105.409042" or a Google Maps link.
async function caCentreTyped() {
  const name = Q.clean(drafts.caName || ''), text = String(drafts.caPoint || '');
  const m = text.match(/!3d(-?\d+\.\d+)!4d(-?\d+\.\d+)/) || text.match(/(-?\d{1,2}\.\d{4,})\s*,\s*(-?\d{2,3}\.\d{4,})/);
  if (!name) return say(T('Gõ tên cơ sở trước.', 'Type the site name first.'), 'bad');
  if (!m) return say(T('Chưa đọc được toạ độ. Dán dạng 21.310936, 105.409042 hoặc link Google Maps của đúng điểm.', 'Could not read the coordinates.'), 'bad');
  try { const r = await call('vaoca', { set: 'centre', manual: true, name, lat: Number(m[1]), lng: Number(m[2]) }, 1); ca.names = r.centres; ca.centres = r.centres.length; drafts.caPoint = ''; say(T('Đã lưu ', 'Saved ') + name + '. ' + T('Các điểm đang dùng: ', 'Points in use: ') + r.centres.join(', ') + '.'); }
  catch (e) { say(T('Chưa lưu được: ', 'Not saved: ') + e.message, 'bad'); }
}
async function loadCaAll(force) {
  if (!force && ca.all && Date.now() - ca.allAt < 60000) return;
  const [rows] = await batchGet(CONFIG.quanLiId, ['CHECKIN!A2:M']);
  ca.all = rows.map(caRow); ca.allAt = Date.now();
  outbox.filter(x => x.kind === 'append' && x.tab === 'CHECKIN').forEach(x => ca.all.push(caRow(x.row)));
}
function caDecide(b) {
  const p = caPair(ca.all || [], b.dataset.day, b.dataset.p, b.dataset.kind);
  if (!p) return;
  const f = p.first, row = [stamp(), f.day, f.person, f.role, f.kind, f.time, f.due, String(f.late), String(f.dist), String(f.acc), b.dataset.v, f.note, me.name];
  ca.all.push(caRow(row));
  queue({ kind: 'append', file: CONFIG.quanLiId, tab: 'CHECKIN', row });
  render();
}
function caPanel(week) {
  let h = dayBar();
  if (!ca.all) return h + '<div class="card empty">' + T('Đang đọc…', 'Reading…') + '</div>';
  // Owner 13/11 23:45: due times by the contract rules (dueFor); a person with no due time that day (off, homeroom only, tutoring
  // only) is listed only if they did check in.
  const people = new Map();
  staffOfDay(week, day).forEach(n => { const due = dueFor(week, day, n); if (due !== null) people.set(Q.key(n), { name: n, due }); });
  ca.all.filter(r => r.day === day).forEach(r => { const k = Q.key(r.person); if (!people.has(k)) people.set(k, { name: r.person, due: dueFor(week, day, r.person) }); });
  ownerKeys().forEach(k => people.delete(k));
  const list = [...people.values()].map(p => ({ p, vin: caPair(ca.all, day, p.name, 'Vào ca'), vout: caPair(ca.all, day, p.name, 'Ra ca') }))
    .sort((a, b) => (a.vin ? (a.vin.status === 'Chờ duyệt' ? 0 : 2) : 1) - (b.vin ? (b.vin.status === 'Chờ duyệt' ? 0 : 2) : 1) || a.p.name.localeCompare(b.p.name, 'vi'));
  const waiting = list.filter(x => [x.vin, x.vout].some(v => v && v.status === 'Chờ duyệt')).length, missing = list.filter(x => !x.vin).length;
  h += '<div class="count"><span>' + list.filter(x => x.vin).length + '/' + list.length + T(' người đã vào ca', ' checked in') + '</span>' + (waiting ? '<span class="tag warn">' + waiting + T(' chờ duyệt', ' waiting') + '</span>' : '') + (missing && day <= today() ? '<span class="tag bad">' + missing + T(' chưa vào ca', ' not in') + '</span>' : '') + '</div>';
  const line = (x, v, kind) => {
    if (!v) return '';
    // A manager decides what is waiting; the owner can change any decision. Nobody decides their own.
    const f = v.first, mine = sameName(f.person, me.name), can = !mine && (isOwner() || v.status === 'Chờ duyệt');
    return '<div class="small">' + esc(kind) + ' <b>' + esc(f.time) + '</b>' + (f.due ? T(' (phải có mặt ', ' (due ') + esc(f.due) + ')' : '') + (f.dist >= 0 ? ' · ' + f.dist + ' m' : '') + (f.note ? ' · ' + esc(f.note) : '') + ' ' + caTag(v.status) + (v.by ? ' <span class="muted">' + esc(v.by) + '</span>' : '') +
      (can ? ' <button class="quiet good" data-act="caDecide" data-v="Đã duyệt" data-day="' + esc(f.day) + '" data-p="' + esc(f.person) + '" data-kind="' + esc(kind) + '">' + T('Duyệt', 'Approve') + '</button><button class="quiet low" data-act="caDecide" data-v="Không duyệt" data-day="' + esc(f.day) + '" data-p="' + esc(f.person) + '" data-kind="' + esc(kind) + '">' + T('Không duyệt', 'Reject') + '</button>' : '') + '</div>';
  };
  h += '<div class="list">' + list.map(x => { const hrs = isOwner() ? caHours(ca.all, x.p.name, day).total : 0; return '<div class="card row"><div class="row-top"><b>' + esc(x.p.name) + '</b>' + (hrs ? '<span class="tag ok">' + esc(Q.hoursText(hrs, lang)) + '</span>' : x.vin && !x.vout && isPartTime(x.p.name) ? '<span class="tag warn">' + T('chưa ra ca', 'not out') + '</span>' : '') + (x.p.due !== null ? '<span class="muted small">' + T('Có mặt trước ', 'Due ') + Q.clock(x.p.due) + '</span>' : '<span class="muted small">' + T('Lịch TA', 'TA rota') + '</span>') + '</div>' +
    (x.vin ? line(x, x.vin, 'Vào ca') + line(x, x.vout, 'Ra ca') : '<div class="small muted">' + T('Chưa vào ca', 'Not checked in') + '</div>') + '</div>'; }).join('') + '</div>';
  const m = day.slice(0, 7), who = [...new Set(ca.all.filter(r => String(r.day).startsWith(m)).map(r => Q.clean(r.person).toUpperCase()))].sort((a, b) => a.localeCompare(b, 'vi'));
  // The month's hours per person are pay figures: owner only. Managers still approve each day's check-ins.
  if (who.length && isOwner()) h += '<h2>' + T('Giờ làm theo vào/ra ca ', 'Hours from check-in ') + esc(monthName(m)) + '</h2><div class="card table"><table><thead><tr><th>' + T('Người', 'Person') + '</th><th>' + T('Giờ', 'Hours') + '</th><th>' + T('Ngày', 'Days') + '</th><th>' + T('Cần xem', 'To check') + '</th></tr></thead><tbody>' +
    who.map(n => { const x = caHours(ca.all, n, m); return '<tr><td>' + esc(n) + '</td><td>' + esc(Q.hoursText(x.total, lang)) + '</td><td>' + x.days.filter(d => d.minutes).length + '</td><td>' + [x.open ? x.open + T(' ngày chưa ra ca', ' not out') : '', x.waiting ? x.waiting + T(' chờ duyệt', ' waiting') : '', x.rejected ? x.rejected + T(' không duyệt', ' rejected') : ''].filter(Boolean).join(', ') + '</td></tr>'; }).join('') + '</tbody></table></div>';
  if (isOwner()) h += '<div class="card row"><b>' + T('Vị trí trung tâm', 'Centre location') + '</b><div class="small muted">' + T('Cô đứng tại cơ sở, đặt tên rồi bấm lưu. Nhân viên trong vòng 150 m quanh điểm này, đúng giờ thì tự được duyệt. Có nhiều cơ sở thì lưu từng nơi.', 'Stand at the centre and save. Staff within 150 m, on time, are approved by themselves.') + '</div>' +
    (ca.names && ca.names.length ? '<div class="small">' + T('Đang dùng: ', 'In use: ') + '<b>' + esc(ca.names.join(', ')) + '</b>' + T(' (lưu lại cùng tên là thay điểm cũ)', '') + '</div>' : '<div class="small bad">' + T('Chưa có điểm nào.', 'No point yet.') + '</div>') +
    '<div class="choices"><input data-act="xField" data-k="caName" placeholder="' + T('Tên cơ sở, ví dụ Hàm Nghi, Villa Tiên Dung', 'Name, e.g. Main, Villa') + '" value="' + esc(drafts.caName || '') + '"><button class="primary" data-act="caCentre">' + T('Lưu vị trí tại đây', 'Save this spot') + '</button></div>' +
    '<div class="choices"><input data-act="xField" data-k="caPoint" placeholder="' + T('Hoặc dán toạ độ / link Google Maps của điểm', 'Or paste coordinates / a Maps link') + '" value="' + esc(drafts.caPoint || '') + '"><button data-act="caCentreTyped">' + T('Lưu điểm này', 'Save point') + '</button></div></div>';
  return h;
}

/* ---------- Payroll ---------- */
const pay = { mine: null, all: null, month: '', err: '', loading: false, person: '' };
async function loadLuong(force) {
  if (pay.loading) return;
  pay.loading = true; pay.err = '';
  try {
    if (isOwner()) {
      pay.all = await call('luongall', { month: pay.month || undefined });
      pay.month = pay.all.month;
      pay.mine = pay.person ? await call('luong', { month: pay.month, person: pay.person }) : null;
    } else {
      pay.mine = await call('luong', { month: pay.month || undefined });
      pay.month = pay.mine.month;
      loadPay(pay.month).then(render).catch(() => {});
    }
  } catch (e) { pay.err = /not found|không tìm thấy|permission|quyền|404|403/i.test(e.message) ? T('Máy chủ chưa mở được file BẢNG LƯƠNG THÁNG. Cô Trang chia sẻ file đó (quyền Xem) cho Gmail đang chạy app là xong.', 'The server cannot open the payroll file yet.') : e.message; }
  finally { pay.loading = false; render(); }
}
function slipCard(d) {
  if (!d) return '';
  if (d.locked) return '<div class="card empty">' + T('Bảng lương ' + monthName(d.month) + ' sẽ hiện ngày ' + viDate(d.dates.show) + '.', 'This month shows on ' + viDate(d.dates.show) + '.') + '</div>';
  if (d.ambiguous) return '<div class="card notice bad">' + T('Có nhiều dòng giống tên ' + esc(d.person) + ': ' + esc(d.ambiguous.join(', ')) + '. Cô Trang ghi tên đầy đủ trong bảng lương hoặc báo để tách tên.', 'Several rows match ' + esc(d.person) + '.') + '</div>';
  if (!d.slip) return '<div class="card empty">' + (d.tabs && d.tabs.length ? T('Chưa thấy dòng của ' + esc(d.person) + ' trong ' + esc(d.tabs.join(', ')) + '. Báo cô Trang giúp.', 'No row for you yet.') : T('Bảng lương ' + monthName(d.month) + ' chưa được lập (chưa có tab NVVN/GVNN của tháng).', 'This month has no payroll tab yet.')) + '</div>';
  // Owner 07/11 "hiển thị đẹp hơn": income, deductions, then what is paid, in one language at a time.
  const s = d.slip, isTotal = x => /^(TỔNG|CỘNG)/i.test(x.label), totals = s.items.map((x, i) => isTotal(x) ? i : -1).filter(i => i >= 0);
  const cut1 = totals[0] != null ? totals[0] : s.items.length, cut2 = totals[1] != null ? totals[1] : s.items.length;
  const income = s.items.slice(0, cut1 + 1), deduct = s.items.slice(cut1 + 1, cut2 + 1), paid = s.items.slice(cut2 + 1);
  const label = l => slipLabel(l, lang === 'en');
  const row = x => '<div class="slip-row' + (isTotal(x) ? ' total' : '') + (/^0 đ$/.test(x.value) ? ' zero' : '') + '"><span>' + esc(label(x.label)) + '</span><b>' + esc(slipValue(x.label, x.value, lang === 'en')) + '</b></div>';
  const section = (title, list, cls) => list.length ? '<div class="slip-sec ' + cls + '"><h3>' + title + '</h3>' + list.map(row).join('') + '</div>' : '';
  const net = paid.find(x => /CÒN LẠI/i.test(x.label)) || paid.find(x => /THỰC NHẬN/i.test(x.label)), rest = paid.filter(x => x !== net);
  return '<div class="card slip"><div class="slip-head"><div><div class="small muted">' + esc(s.tab) + '</div><b class="slip-name">' + esc(s.name) + '</b>' + (s.role ? '<div class="small muted">' + esc(s.role) + '</div>' : '') + '</div>' +
    '<div class="slip-net"><span>' + esc(net ? label(net.label) : T('Thực nhận', 'Net')) + '</span><b>' + esc(s.net || (net && net.value) || '—') + '</b>' + rest.map(x => '<small>' + esc(label(x.label)) + ': ' + esc(slipValue(x.label, x.value, lang === 'en')) + '</small>').join('') + '</div></div>' +
    '<div class="slip-grid">' + section(T('Thu nhập', 'Earnings'), income, 'in') + section(T('Khấu trừ', 'Deductions'), deduct, 'out') + '</div>' +
    // Owner 07/11: the payroll's own notes column is not shown; it can differ from what is paid and misleads.
    '</div>';
}
function payStateLine(st) {
  if (!st) return '';
  const c = st.check, p = st.paid;
  return (c ? '<span class="tag ' + (c.stale ? 'warn' : c.action === 'Đúng' ? 'ok' : 'bad') + '">' + (c.stale ? T('Bảng đã sửa sau khi xác nhận', 'Changed after check') : c.action === 'Đúng' ? T('Đã xác nhận đúng', 'Confirmed') : T('Báo sai', 'Reported wrong')) + '</span>' + (c.note ? ' <span class="small">' + esc(c.note) + '</span>' : '') : '<span class="tag">' + T('Chưa kiểm tra', 'Not checked') + '</span>') +
    (p ? ' <span class="tag ok">' + T('Đã trả', 'Paid') + '</span>' : '');
}
function viewLuong() {
  let h = '<h2>' + T('Lương', 'Pay') + (pay.month ? ' ' + esc(monthName(pay.month)) : '') + '</h2>';
  h += '<div class="filters"><input type="month" data-act="payPick" value="' + esc(pay.month || '') + '" aria-label="' + T('Tháng', 'Month') + '"></div>';
  if (pay.err) return h + '<div class="notice bad">' + esc(pay.err) + '</div>';
  if (pay.loading && !pay.mine && !pay.all) return h + '<div class="card empty">' + T('Đang đọc bảng lương…', 'Reading…') + '</div>';
  const d = isOwner() ? pay.all : pay.mine;
  if (!d) return h;
  h += '<p class="small muted">' + T('Ngày ' + viDate(d.dates.show) + ' bảng lương hiện cho từng người; mỗi người kiểm tra dòng của mình đến ' + (d.dates.by ? d.dates.by + ' ' : 'hết ') + 'ngày ' + viDate(d.dates.check) + '; cô trả lương ngày ' + viDate(d.dates.pay) + '.', 'Shows ' + viDate(d.dates.show) + ', check by ' + viDate(d.dates.check) + ', paid ' + viDate(d.dates.pay) + '.') + '</p>';
  if (isOwner()) {
    if (pay.person && pay.mine) h += '<div><button class="quiet" data-act="payBack">‹ ' + T('Cả bảng', 'Everyone') + '</button></div>' + slipCard(pay.mine) + '<div class="card row">' + payStateLine(pay.mine.state) + '</div>';
    else {
      const rows = d.rows || [], checked = rows.filter(r => r.state && r.state.check && r.state.check.action === 'Đúng' && !r.state.check.stale).length, wrong = rows.filter(r => r.state && r.state.check && r.state.check.action === 'Báo sai').length, paid = rows.filter(r => r.state && r.state.paid).length;
      h += '<div class="count"><span>' + rows.length + T(' người', ' people') + '</span><span class="tag ok">' + checked + T(' xác nhận đúng', ' confirmed') + '</span>' + (wrong ? '<span class="tag bad">' + wrong + T(' báo sai', ' wrong') + '</span>' : '') + '<span class="tag">' + paid + T(' đã trả', ' paid') + '</span></div>';
      if (!rows.length) h += '<div class="card empty">' + T('Chưa có tab NVVN/GVNN của ' + monthName(d.month) + ' trong file bảng lương.', 'No payroll tab for this month.') + '</div>';
      h += '<div class="list">' + rows.map(r => '<div class="card row"><div class="row-top"><b>' + esc(r.name) + '</b><span class="muted small">' + esc(r.tab) + (r.person ? ' · ' + T('link ', 'app ') + esc(r.person) : ' · ' + T('chưa có link app (tạo trong Nhân sự & lương, hồ sơ, mục Hợp đồng & link app)', 'no app link')) + '</span><span class="spacer"></span><b>' + esc(r.net) + '</b></div>' +
        '<div>' + payStateLine(r.state) + '</div>' + (r.person ? '<div class="choices"><button class="quiet" data-act="payOpen" data-p="' + esc(r.person) + '">' + T('Xem chi tiết', 'Open') + '</button>' +
        (r.state && r.state.paid ? '<button class="quiet" data-act="payPaid" data-v="Bỏ đã trả" data-p="' + esc(r.person) + '">' + T('Bỏ đánh dấu đã trả', 'Unmark paid') + '</button>' : '<button class="good" data-act="payPaid" data-v="Đã trả" data-p="' + esc(r.person) + '">' + T('Đã trả lương', 'Mark paid') + '</button>') + '</div>' : '<div class="choices"><button class="quiet" data-act="payOpen" data-p="' + esc(r.name) + '">' + T('Xem chi tiết, nhập thưởng / tạm ứng', 'Open') + '</button></div>') + '</div>').join('') + '</div>';
    }
    return h;
  }
  h += slipCard(d);
  if (d.slip) {
    const st = d.state || {}, open = d.today >= d.dates.show && d.today <= d.dates.check, c = st.check;
    h += '<div class="card row"><div>' + payStateLine(st) + '</div>';
    if (open && (!c || c.stale || c.action === 'Báo sai')) h += '<div class="small">' + T('Bạn xem kĩ từng dòng, đối chiếu với số buổi, số giờ ở trang Công của tôi.', 'Check each line against My hours.') + '</div>' +
      '<div class="choices"><button class="good" data-act="payOk">' + T('Đúng, tôi xác nhận', 'Correct') + '</button></div>' +
      '<textarea data-act="xField" data-k="payNote" rows="2" maxlength="300" placeholder="' + T('Phần nào sai? Ví dụ: thiếu 2 buổi gia sư ngày 12/10', 'What is wrong?') + '">' + esc(drafts.payNote || '') + '</textarea><div class="choices"><button class="low" data-act="payWrong">' + T('Báo sai', 'Report wrong') + '</button></div>';
    else if (!open && !c) h += '<div class="small muted">' + (d.today < d.dates.show ? T('Mở để kiểm tra từ ngày ' + viDate(d.dates.show) + '.', 'Opens for checking on ' + viDate(d.dates.show) + '.') : T('Đã hết hạn kiểm tra. Có sai sót gì bạn báo trực tiếp cô Trang.', 'The check window has closed.')) + '</div>';
    h += '</div>';
    const hit = payCache[d.month];
    if (hit) { const p = Q.payOf(hit.entries, me.name, d.month, today()); if (p.count) h += '<div class="card row small">' + T('Theo Schedule ' + monthName(d.month) + ': ', 'Schedule: ') + p.kinds.map(k => esc(k.kind) + ' ' + k.count + T(' buổi', '') + ' (' + esc(Q.hoursText(k.minutes, lang)) + ')').join(' · ') + '</div>'; }
  }
  return h;
}
async function payAct(action, person) {
  const d = pay.mine;
  try {
    if (action === 'Đã trả' || action === 'Bỏ đã trả') await call('luongxn', { month: pay.month, action, person }, 1);
    else await call('luongxn', { month: d.month, action, note: action === 'Báo sai' ? drafts.payNote || '' : '', sig: d.slip.sig }, 1);
    if (action === 'Báo sai') drafts.payNote = '';
    say(action === 'Đúng' ? T('Đã xác nhận, cảm ơn bạn.', 'Confirmed, thank you.') : action === 'Báo sai' ? T('Đã gửi cho cô Trang.', 'Sent to the owner.') : T('Đã ghi.', 'Saved.'));
  } catch (e) { say(e.message, 'bad'); }
  await loadLuong(true);
}
// On the 8th and 9th everyone is reminded on the Schedule page until they have checked.
let payNudge = null, payNudgeAt = 0;
// Owner 10/11: a month closed late is confirmed until 17:00 on pay day (dates.by from the server).
function payBy(d) { return (d.dates.by ? d.dates.by + ' ' : 'hết ') + 'ngày ' + viDate(d.dates.check); }
function payPast(d) { if (!d.dates.by || today() !== d.dates.check) return false; const n = new Date(); return String(n.getHours()).padStart(2, '0') + ':' + String(n.getMinutes()).padStart(2, '0') >= d.dates.by; }
function payNoticeBlock() {
  const d = Number(today().slice(8, 10));
  if (!me || d < 8 || d > 10) return '';
  if (Date.now() - payNudgeAt > 1800000) { payNudgeAt = Date.now(); call(isOwner() ? 'luongall' : 'luong', {}).then(x => { payNudge = x; render(); }).catch(() => {}); }
  if (!payNudge) return '';
  if (isOwner()) {
    const rows = payNudge.rows || [], left = rows.filter(r => r.person && !(r.state && r.state.check && !r.state.check.stale)).length, wrong = rows.filter(r => r.state && r.state.check && r.state.check.action === 'Báo sai').length;
    return rows.length ? '<div class="notice' + (wrong ? ' bad' : '') + '">💰 ' + T('Lương ' + monthName(payNudge.month) + ': ' + left + ' người chưa xác nhận' + (wrong ? ', ' + wrong + ' người báo sai' : '') + '. Trả lương ngày ' + viDate(payNudge.dates.pay) + '.', 'Pay: ' + left + ' not checked.') + ' <button class="quiet" data-act="view" data-v="luong">' + T('Mở', 'Open') + '</button></div>' : '';
  }
  const st = payNudge.state, c = st && st.check;
  if (!payNudge.slip || (c && !c.stale) || today() > payNudge.dates.check || payPast(payNudge)) return '';
  return '<div class="notice">💰 ' + T('Bảng lương ' + monthName(payNudge.month) + ' đã có. Bạn kiểm tra và bấm xác nhận trước ' + payBy(payNudge) + '. Cô Trang chuyển lương sau khi bạn xác nhận.', 'Your payslip is ready. Please check and confirm before ' + (payNudge.dates.by ? payNudge.dates.by + ' on ' : 'the end of ') + viDate(payNudge.dates.check) + '; pay is sent after you confirm.') + ' <button class="primary" data-act="view" data-v="luong">' + T('Xem lương', 'Open') + '</button></div>';
}

/* ---------- KPI (owner 07/11: from tasks, Important Task, on time, etc.) ----------
 * On time 30, Important Task done by its grading day 30, weekly homework return 20, class roll call on time 20.
 * A part with nothing to count that month is left out and the rest are scaled to 100. */
const KPI_PARTS = [['time', 'Đi làm đúng giờ', 30], ['task', 'Important Task', 30], ['ret', 'Trả bài', 20], ['roll', 'Điểm danh lớp', 20]];
function stampMinutes(s) { const m = String(s || '').match(/(\d{1,2})\/(\d{1,2})\/(\d{4})\s+(\d{1,2}):(\d{2})/); return m ? { day: m[3] + '-' + m[2].padStart(2, '0') + '-' + m[1].padStart(2, '0'), min: Number(m[4]) * 60 + Number(m[5]) } : null; }
function kpiOf(person, month, src) {
  const now = today(), last = Q.key(person).split(' ').pop(), parts = { time: [0, 0], task: [0, 0], ret: [0, 0], roll: [0, 0] }, detail = { late: [], task: [], ret: [], roll: [] };
  const monthTabs = Q.tabsOfMonth(tabs, month).map(t => weeks[t]).filter(Boolean), seenTask = new Map(), seenRet = new Map(), seenSes = new Set();
  // A new week tab starts as a copy of the last one, so the same task or return box can sit in two tabs: each counts once, done if done anywhere.
  monthTabs.forEach(w => {
    w.data.tasks.forEach(t => { const k = [Q.key(t.teacher), Q.key(t.cls), Q.key(t.what), t.gradeDue].join('|'), o = seenTask.get(k); seenTask.set(k, o ? Object.assign({}, o, { done: o.done || t.done }) : t); });
    (w.data.returns || []).forEach(x => { const k = [x.day, Q.key(x.who), Q.key(x.cls)].join('|'), o = seenRet.get(k); seenRet.set(k, o ? Object.assign({}, o, { done: o.done || x.done }) : x); });
  });
  const uniq = { data: { tasks: [...seenTask.values()], returns: [...seenRet.values()], sessions: [] } };
  [uniq].concat(monthTabs.map(w => ({ data: { tasks: [], returns: [], sessions: w.data.sessions.filter(s => { const k = Q.sessionKey(s); if (seenSes.has(k)) return false; seenSes.add(k); return true; }) } }))).forEach(w => {
    w.data.tasks.filter(t => sameName(t.teacher, person) && t.gradeDue && t.gradeDue.startsWith(month) && t.gradeDue <= now).forEach(t => { parts.task[1]++; if (t.done) parts.task[0]++; else detail.task.push(t.cls + ' · ' + t.what); });
    (w.data.returns || []).filter(x => x.day && x.day.startsWith(month) && x.day <= now && Q.key(x.who) === last).forEach(x => { parts.ret[1]++; if (x.done) parts.ret[0]++; else detail.ret.push(x.label + ' ' + viDate(x.day)); });
    w.data.sessions.filter(s => s.day.startsWith(month) && !s.off && sameName(rollTaker(s), person) && classOf(s) && !isGroup(s) && s.day >= (classOf(s).since || '') && (s.day < now || (s.day === now && s.start + Q.ROLL_CALL_MINUTES <= minutesNow()))).forEach(s => {
      parts.roll[1]++;
      const marks = [...marksOf(s).values()].filter(m => Q.PRESENT.includes(m.status) || Q.ABSENT.includes(m.status) || m.status === 'GV báo nghỉ');
      const first = marks.map(m => stampMinutes(m.at)).filter(Boolean).sort((a, b) => (a.day + a.min).localeCompare(b.day + b.min))[0];
      if (first && first.day === s.day && first.min <= s.start + Q.ROLL_CALL_MINUTES) parts.roll[0]++; else detail.roll.push(s.cls + ' ' + viDate(s.day) + (first ? T(' (muộn)', ' (late)') : T(' (không điểm danh)', ' (none)')));
    });
  });
  // One judgement per working day: the person's own check-in when there is one, otherwise the manager's marks of that day.
  const days = new Map();
  (src.cong || []).filter(r => sameName(r.person, person) && String(r.day).startsWith(month)).forEach(r => { const k = [r.day, Q.key(r.cls), r.time].join('|'); const d = days.get(r.day) || { marks: new Map() }; d.marks.set(k, r.status); days.set(r.day, d); });
  (src.checkin || []).filter(r => sameName(r.person, person) && String(r.day).startsWith(month) && r.kind === 'Vào ca').forEach(r => { const d = days.get(r.day) || { marks: new Map() }; if (!d.first) d.first = r; d.last = r; days.set(r.day, d); });
  days.forEach((d, iso) => {
    let ok;
    if (d.first) ok = !d.first.late && d.last.status !== 'Không duyệt';
    else { const v = [...d.marks.values()].filter(x => x && x !== 'Bỏ chấm'); if (!v.length) return; ok = !v.some(x => x === 'Muộn' || x === 'Vắng'); }
    parts.time[1]++; if (ok) parts.time[0]++; else detail.late.push(viDate(iso) + (d.first && d.first.late ? ' (' + d.first.late + T(' phút)', ' min)') : ''));
  });
  let sum = 0, weight = 0;
  const list = KPI_PARTS.map(([k, label, w]) => { const [done, total] = parts[k]; if (total) { sum += w * done / total; weight += w; } return { k, label, w, done, total, rate: total ? done / total : null }; });
  return { person, parts: list, score: weight ? Math.round(sum / weight * 100) : null, detail };
}
const kpi = { data: null, at: 0, month: '', loading: false, scope: '', tried: 0 };
async function loadKpi(month, own) {
  kpi.loading = true; kpi.month = month; kpi.tried = Date.now(); kpi.data = null; kpi.scope = own ? 'own' : 'all';
  try {
    const tabsWanted = Q.tabsOfMonth(tabs, month);
    await Promise.all(tabsWanted.map(t => weekOf(Q.dateIn(t.split('-')[0].trim())).catch(() => null)));
    await loadMarks().catch(() => {});
    if (own) { const d = await call('catoi', { month }); kpi.data = { checkin: d.checkin.map(caRow), cong: d.cong.map(staffOfRow) }; }
    else { const [cin, cong] = await batchGet(CONFIG.quanLiId, ['CHECKIN!A2:M', 'CONG!A2:K']); kpi.data = { checkin: cin.map(caRow), cong: cong.map(staffOfRow) }; }
    kpi.at = Date.now();
  } finally { kpi.loading = false; render(); }
}
const bar = r => r == null ? '<span class="muted">—</span>' : '<span class="kbar"><i style="width:' + Math.round(r * 100) + '%"></i></span> ' + Math.round(r * 100) + '%';
function kpiCard(k, open) {
  return '<div class="card row kpi"><div class="row-top"><b>' + esc(k.person) + '</b><span class="spacer"></span><span class="kscore ' + (k.score == null ? '' : k.score >= 90 ? 'ok' : k.score >= 75 ? 'warn' : 'bad') + '">' + (k.score == null ? '—' : k.score) + '</span></div>' +
    k.parts.map(p => '<div class="krow"><span>' + esc(p.label) + ' <span class="muted small">(' + p.w + ')</span></span><span>' + bar(p.rate) + (p.total ? ' <span class="muted small">' + p.done + '/' + p.total + '</span>' : '') + '</span></div>').join('') +
    (open ? ['late', 'task', 'ret', 'roll'].filter(x => k.detail[x].length).map(x => '<div class="small muted">' + { late: T('Muộn: ', 'Late: '), task: T('Task chưa xong: ', 'Tasks open: '), ret: T('Chưa trả: ', 'Not returned: '), roll: T('Điểm danh: ', 'Roll call: ') }[x] + esc(k.detail[x].slice(0, 8).join('; ')) + (k.detail[x].length > 8 ? ' …' : '') + '</div>').join('') : '') + '</div>';
}
function kpiPanel() {
  const month = filters.kpiMonth || xMonth();
  let h = '<div class="filters"><input type="month" data-act="kpiPick" value="' + esc(month) + '"></div><p class="small muted">' + T('Điểm 100: đi làm đúng giờ 30, Important Task xong đúng hạn chấm 30, trả bài 20, điểm danh lớp trong 15 phút đầu 20. Phần nào tháng đó không có thì không tính.', 'Score out of 100.') + '</p>';
  if (!kpi.data || kpi.month !== month || kpi.scope !== 'all') { if (!kpi.loading && Date.now() - kpi.tried > 30000) setTimeout(() => loadKpi(month, false).catch(() => {}), 0); return h + '<div class="card empty">' + T('Đang tính…', 'Working…') + '</div>'; }
  const names = new Set();
  Q.tabsOfMonth(tabs, month).map(t => weeks[t]).filter(Boolean).forEach(w => { w.data.sessions.filter(s => s.day.startsWith(month)).forEach(s => Q.staffOf(s).forEach(p => names.add(Q.clean(p.name).toUpperCase()))); w.data.tasks.forEach(t => names.add(Q.clean(t.teacher).toUpperCase())); });
  people.forEach(p => names.add(p.name));
  const list = [...names].filter(n => n && !ownerKeys().has(Q.key(n))).map(n => kpiOf(n, month, kpi.data)).filter(k => k.score != null).sort((a, b) => a.score - b.score || a.person.localeCompare(b.person, 'vi'));
  return h + '<div class="grid">' + list.map(k => kpiCard(k, true)).join('') + '</div>';
}
function myKpiBlock() {
  const month = filters.payMonth;
  if (!kpi.data || kpi.month !== month) { if (!kpi.loading && Date.now() - kpi.tried > 30000) setTimeout(() => loadKpi(month, !isManager()).catch(() => {}), 0); return '<h2>KPI</h2><div class="card empty">' + T('Đang tính…', 'Working…') + '</div>'; }
  const k = kpiOf(me.name, month, kpi.data), hrs = caHours(kpi.data.checkin || [], me.name, month);
  const hoursCard = hrs.days.length ? '<h2>' + T('Giờ làm theo vào/ra ca', 'Hours from check-in') + '</h2><div class="card row"><div><b>' + esc(Q.hoursText(hrs.total, lang)) + '</b> · ' + hrs.days.filter(d => d.minutes).length + T(' ngày', ' days') + (hrs.open ? ' · <span class="tag warn">' + hrs.open + T(' ngày quên ra ca', ' days not checked out') + '</span>' : '') + (hrs.waiting ? ' · <span class="tag">' + hrs.waiting + T(' chờ duyệt', ' waiting') + '</span>' : '') + '</div>' +
    hrs.days.map(d => '<div class="small">' + esc(viDate(d.day)) + ': ' + esc(d.in ? d.in.time : '?') + ' – ' + esc(d.out ? d.out.time : T('chưa ra ca', 'no check-out')) + (d.minutes ? ' · ' + esc(Q.hoursText(d.minutes, lang)) : '') + (d.rejected ? ' · ' + T('không duyệt', 'rejected') : '') + '</div>').join('') + '</div>' : '';
  return hoursCard + '<h2>KPI ' + esc(monthName(month)) + '</h2>' + (k.score == null ? '<div class="card empty">' + T('Tháng này chưa có gì để tính.', 'Nothing to count yet.') + '</div>' : kpiCard(k, true));
}

/* ---------- Lesson report: the homeroom pastes the teacher's comment; the app reads stars, A/B/F and behaviour with it ---------- */
const reports = { rows: null, at: 0, tried: 0 };
async function loadReports(force) {
  if (!force && reports.rows && Date.now() - reports.at < 60000) return;
  const [rows] = await batchGet(CONFIG.quanLiId, ['BAO_CAO_TIET!A2:F']);
  reports.rows = rows.map(r => ({ at: r[0], day: r[1], cls: r[2], lesson: r[3], text: r[4] || '', by: r[5] || '' })); reports.at = Date.now();
}
const nameClean = s => String(s).replace(/[^\p{L}\p{N} .'-]/gu, ' ').replace(/\s+/g, ' ').trim();
function parseComment(text) {
  const t = String(text || ''), cls = (t.match(/\b(KIDS|IELTS|FIGHTER)\s*\d+(?:\.\d+)?/i) || [''])[0].toUpperCase().replace(/\s+/, ' '), d = t.match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  const stars = [];
  t.split('\n').forEach(line => { const m = line.match(/^\s*(\d{1,2})\s*(?:⭐|★|sao)+\s*[:：\-–]\s*(.+)$/iu); if (m) m[2].split(/\s*(?:,|;| và | & | and )\s*/i).map(nameClean).filter(Boolean).forEach(n => stars.push({ n: Number(m[1]), name: n })); });
  return { cls, day: d ? d[3] + '-' + d[2].padStart(2, '0') + '-' + d[1].padStart(2, '0') : '', stars };
}
const pupilByName = (pupils, n) => pupils.find(p => Q.key(p.eng) === Q.key(n)) || pupils.find(p => Q.key(p.name).endsWith(' ' + Q.key(n)));
function reportBlock(ctx) {
  const s = ctx.session, t = ctx.tracker;
  if (!t || s.day > today() || !(isManager() || teaches(s) || isMe(cmOf(s)))) return '';
  if (!reports.rows && Date.now() - reports.tried > 60000) { reports.tried = Date.now(); setTimeout(() => loadReports().then(render).catch(() => {}), 0); }
  const key = 'bc:' + Q.sessionKey(s), text = drafts[key] || '', p = parseComment(text);
  const saved = (reports.rows || []).filter(r => r.day === s.day && Q.key(r.cls) === Q.key(s.cls) && String(r.lesson) === String(s.lesson));
  let h = '<h2>' + T('Báo cáo buổi học', 'Lesson report') + '</h2><div class="card row">';
  h += '<div class="small muted">' + T('Chủ nhiệm dán nguyên nhận xét của GV vào đây. App đọc số sao, đối chiếu với sheet, kèm điểm bài tập giấy A/B/F và hành vi trong buổi.', 'Paste the teacher\'s comment; the app reads stars, A/B/F and behaviour with it.') + '</div>';
  h += '<textarea data-act="xField" data-k="' + esc(key) + '" rows="6" placeholder="KIDS 22_Nhận xét buổi học ngày …">' + esc(text) + '</textarea><div class="choices"><button data-act="bcRead">' + T('Đọc nhận xét', 'Read it') + '</button></div>';
  if (text) {
    const warn = [];
    if (p.cls && Q.key(p.cls) !== Q.key(s.cls) && Q.key(p.cls) !== Q.key(s.cls.replace(/\.\d+$/, ''))) warn.push(T('Nhận xét ghi lớp ' + p.cls + ', buổi này là ' + s.cls + '.', 'Class differs.'));
    if (p.day && p.day !== s.day) warn.push(T('Nhận xét ghi ngày ' + viDate(p.day) + ', buổi này ngày ' + viDate(s.day) + '.', 'Date differs.'));
    h += warn.map(w => '<div class="notice bad">' + esc(w) + '</div>').join('');
    const starRows = p.stars.map(x => { const pp = pupilByName(t.pupils, x.name); return { x, pp, sheet: pp ? starsOf(ctx, pp) : null }; });
    if (starRows.length) {
      h += '<div class="small"><b>' + T('Số sao trong nhận xét', 'Stars in the comment') + '</b></div>' + starRows.map(r => '<div class="owe-row"><span class="owe-n">' + r.x.n + '⭐</span><b>' + esc(r.x.name) + '</b><span class="small ' + (!r.pp ? 'bad' : r.sheet === r.x.n ? 'muted' : 'warn') + '">' + (!r.pp ? T('không thấy tên này trong lớp', 'name not in class') : r.sheet === r.x.n ? T('khớp sheet', 'matches sheet') : T('sheet ghi ', 'sheet has ') + r.sheet) + '</span></div>').join('');
      const fill = starRows.filter(r => r.pp && !r.sheet && ctx.block && ctx.block.stars >= 0);
      if (fill.length) h += '<div class="choices"><button class="primary" data-act="bcStars">' + T('Ghi ' + fill.length + ' ô sao còn trống vào sheet', 'Write ' + fill.length + ' empty star cells') + '</button></div>';
    }
  }
  // A/B/F of the paper homework checked in this lesson, absences and behaviour.
  if (ctx.block && ctx.block.grade >= 0) {
    const by = { good: [], B: [], F: [], off: [], none: [] };
    t.pupils.forEach(pp => { const g = Q.gradeOf(t.cell(pp.row, ctx.block.grade)), n = pp.eng || pp.name; if (g === 'A+' || g === 'A') by.good.push(n); else if (g === 'B') by.B.push(n); else if (g === 'F') by.F.push(n); else if (g === '/') by.off.push(n); else by.none.push(n); });
    h += '<div class="small"><b>' + T('Bài tập giấy', 'Paper homework') + '</b>: <span class="tag ok">A ' + by.good.length + '</span> <span class="tag warn">B ' + by.B.length + '</span> <span class="tag bad">F ' + by.F.length + '</span> ' + (by.off.length ? '<span class="tag">' + T('Vắng ', 'Absent ') + by.off.length + '</span> ' : '') + (by.none.length ? '<span class="tag">' + T('Chưa chấm ', 'Not graded ') + by.none.length + '</span>' : '') + '</div>' +
      (by.B.length ? '<div class="small">B: ' + esc(by.B.join(', ')) + '</div>' : '') + (by.F.length ? '<div class="small">F: ' + esc(by.F.join(', ')) + '</div>' : '') + (by.none.length && by.none.length < t.pupils.length ? '<div class="small muted">' + T('Chưa chấm: ', 'Not graded: ') + esc(by.none.join(', ')) + '</div>' : '');
    drafts['bcAbf:' + Q.sessionKey(s)] = by;
  }
  const behave = [...behaveFor(s).values()].filter(b => b.tags.length || Q.clean(b.note));
  if (behave.length) h += '<div class="small"><b>' + T('Hành vi (chỉ nội bộ, không gửi PH)', 'Behaviour (staff only)') + '</b></div>' + behave.map(b => '<div class="small">• ' + esc(b.eng || b.name) + ': ' + esc(b.tags.concat(Q.clean(b.note) ? [Q.clean(b.note)] : []).join('; ')) + '</div>').join('');
  if (text) h += '<div class="choices"><button class="primary" data-act="bcCopy">' + T('Copy tin gửi PH', 'Copy parent message') + '</button><button data-act="bcSave">' + T('Lưu báo cáo', 'Save report') + '</button></div>';
  if (saved.length) h += '<div class="small muted">' + T('Đã lưu ', 'Saved ') + saved.length + T(' lần, gần nhất ', ' times, last ') + esc(saved[saved.length - 1].at) + ' · ' + esc(saved[saved.length - 1].by) + '</div>';
  return h + '</div>';
}
function parentMessage(ctx) {
  const s = ctx.session, text = String(drafts['bc:' + Q.sessionKey(s)] || '').trim(), by = drafts['bcAbf:' + Q.sessionKey(s)];
  if (!by) return text;
  const lines = [];
  if (by.B.length || by.F.length) {
    lines.push('📚 Bài tập về nhà trên sách: ' + by.good.length + ' con làm đủ bài.');
    if (by.B.length) lines.push('Cần bổ sung, làm cẩn thận hơn: ' + by.B.join(', ') + '.');
    if (by.F.length) lines.push('Chưa làm bài: ' + by.F.join(', ') + '. Bố mẹ nhắc con hoàn thành giúp cô ạ.');
  } else if (by.good.length) lines.push('📚 Bài tập về nhà trên sách: cả lớp làm đủ bài, cô khen các con!');
  return text + (lines.length ? '\n\n' + lines.join('\n') : '');
}
function bcAction(act) {
  const ctx = classContext(current), s = ctx.session, key = 'bc:' + Q.sessionKey(s);
  if (act === 'bcRead') { render(); return; }
  if (act === 'bcStars') {
    parseComment(drafts[key]).stars.forEach(x => { const pp = pupilByName(ctx.tracker.pupils, x.name); if (pp && !starsOf(ctx, pp) && !Q.clean(ctx.tracker.cell(pp.row, ctx.block.stars))) setStars(ctx, pp, x.n); });
    render(); say(T('Đã ghi số sao vào các ô còn trống.', 'Stars written to empty cells.')); return;
  }
  if (act === 'bcCopy') { navigator.clipboard.writeText(parentMessage(ctx)).then(() => say(T('Đã copy tin nhắn, dán vào Zalo nhóm lớp.', 'Copied.')), () => say(T('Không copy được, bôi đen để copy.', 'Could not copy.'), 'bad')); return; }
  if (act === 'bcSave') {
    const row = [stamp(), s.day, s.cls, s.lesson, String(drafts[key] || '').trim(), me.name];
    reports.rows = reports.rows || []; reports.rows.push({ at: row[0], day: s.day, cls: s.cls, lesson: s.lesson, text: row[4], by: me.name });
    queue({ kind: 'append', file: CONFIG.quanLiId, tab: 'BAO_CAO_TIET', row }); render(); say(T('Đã lưu báo cáo buổi học.', 'Report saved.'));
  }
}

/* ---------- Labour contracts, owner only: who has which contract, when it ends ---------- */
const CONTRACT_TYPES = ['Toàn thời gian (xác định thời hạn)', 'Toàn thời gian (không xác định thời hạn)', 'Bán thời gian theo giờ', 'Giáo viên nước ngoài', 'Nhân viên phục vụ', 'Thử việc'];
const hd = { rows: null };
const hdRow = r => ({ at: r[0], person: r[1], type: r[2], no: r[3], signed: r[4], start: r[5], end: r[6], trial: r[7], note: r[8], status: r[9], by: r[10] });
async function loadHd() { const [rows] = await batchGet(CONFIG.quanLiId, ['HOP_DONG!A2:K']); hd.rows = rows.map(hdRow); }
function viewHopDong() {
  let h = '<h2>' + T('Hợp đồng lao động', 'Contracts') + '</h2>';
  if (typeof CONTRACT_DOC !== 'undefined' && CONTRACT_DOC) h += '<p class="small"><a href="' + esc(CONTRACT_DOC) + '" target="_blank" rel="noopener">' + T('Mở bộ mẫu hợp đồng', 'Open the contract templates') + '</a></p>';
  if (!hd.rows) return h + '<div class="card empty">' + T('Đang đọc…', 'Reading…') + '</div>';
  const latest = new Map();
  hd.rows.forEach(r => latest.set(Q.key(r.person), r));
  const now = today(), soon = Q.addDays(now, 30), list = [...latest.values()].filter(r => r.status !== 'Đã xoá');
  const state = r => r.end && r.end < now ? ['bad', T('Đã hết hạn', 'Expired')] : r.end && r.end <= soon ? ['warn', T('Sắp hết hạn', 'Ends soon')] : r.trial && r.trial >= now ? ['warn', T('Đang thử việc', 'On probation')] : ['ok', T('Còn hiệu lực', 'In force')];
  const without = people.filter(p => !/chủ/i.test(p.role) && !latest.has(Q.key(p.name))).map(p => p.name);
  h += '<div class="count"><span>' + list.length + T(' hợp đồng', ' contracts') + '</span>' + (list.filter(r => state(r)[0] !== 'ok').length ? '<span class="tag warn">' + list.filter(r => state(r)[0] !== 'ok').length + T(' cần xem', ' to review') + '</span>' : '') + (without.length ? '<span class="tag bad">' + without.length + T(' người chưa có', ' without') + '</span>' : '') + '</div>';
  if (without.length) h += '<div class="notice">' + T('Chưa có hợp đồng: ', 'No contract: ') + esc(without.join(', ')) + '</div>';
  h += '<div class="list">' + list.sort((a, b) => (a.end || '9999').localeCompare(b.end || '9999')).map(r => { const [c, t] = state(r); return '<div class="card row"><div class="row-top"><b>' + esc(r.person) + '</b><span class="tag ' + c + '">' + t + '</span><span class="spacer"></span><span class="small muted">' + esc(r.no || '') + '</span></div><div class="small">' + esc(r.type) + ' · ' + T('từ ', 'from ') + esc(viDate(r.start)) + (r.end ? T(' đến ', ' to ') + esc(viDate(r.end)) : T(' · không thời hạn', ' · open-ended')) + (r.trial ? T(' · thử việc đến ', ' · probation to ') + esc(viDate(r.trial)) : '') + '</div>' + (r.note ? '<div class="small muted">' + esc(r.note) + '</div>' : '') + '</div>'; }).join('') + '</div>';
  const d = drafts.hd = drafts.hd || {};
  const names = [...new Set(people.map(p => p.name))].sort((a, b) => a.localeCompare(b, 'vi'));
  h += '<div class="card row"><b>' + T('Thêm hoặc gia hạn hợp đồng', 'Add or renew') + '</b><div class="form-grid">' +
    '<label>' + T('Người', 'Person') + '<select data-act="hdField" data-k="person"><option value="">—</option>' + names.map(n => '<option' + (d.person === n ? ' selected' : '') + '>' + esc(n) + '</option>').join('') + '</select></label>' +
    '<label>' + T('Loại', 'Type') + '<select data-act="hdField" data-k="type">' + CONTRACT_TYPES.map(x => '<option' + (d.type === x ? ' selected' : '') + '>' + esc(x) + '</option>').join('') + '</select></label>' +
    '<label>' + T('Số hợp đồng', 'Number') + '<input data-act="hdField" data-k="no" value="' + esc(d.no || '') + '"></label>' +
    '<label>' + T('Ngày ký', 'Signed') + '<input type="date" data-act="hdField" data-k="signed" value="' + esc(d.signed || '') + '"></label>' +
    '<label>' + T('Bắt đầu', 'Start') + '<input type="date" data-act="hdField" data-k="start" value="' + esc(d.start || '') + '"></label>' +
    '<label>' + T('Kết thúc (để trống nếu không thời hạn)', 'End') + '<input type="date" data-act="hdField" data-k="end" value="' + esc(d.end || '') + '"></label>' +
    '<label>' + T('Thử việc đến', 'Probation to') + '<input type="date" data-act="hdField" data-k="trial" value="' + esc(d.trial || '') + '"></label>' +
    '<label>' + T('Ghi chú (lương, ca, giấy phép LĐ…)', 'Note') + '<input data-act="hdField" data-k="note" value="' + esc(d.note || '') + '"></label></div>' +
    '<div class="choices"><button class="primary" data-act="hdSave">' + T('Lưu', 'Save') + '</button></div></div>';
  return h;
}
function hdSave() {
  const d = drafts.hd || {};
  if (!d.person || !d.start) return say(T('Chọn người và ngày bắt đầu.', 'Pick a person and a start date.'), 'bad');
  const type = d.type || CONTRACT_TYPES[0];
  if (/xác định thời hạn\)/.test(type) && !/không/.test(type) && !d.end) return say(T('Hợp đồng xác định thời hạn cần ngày kết thúc (tối đa 36 tháng).', 'A fixed-term contract needs an end date.'), 'bad');
  if (d.end && d.start && d.end > Q.addDays(d.start, 36 * 31)) return say(T('Hợp đồng xác định thời hạn không quá 36 tháng (Điều 20 BLLĐ 2019).', 'Fixed term is at most 36 months.'), 'bad');
  const row = [stamp(), d.person, type, d.no || '', d.signed || '', d.start, d.end || '', d.trial || '', d.note || '', 'Hiệu lực', me.name];
  hd.rows.push(hdRow(row));
  queue({ kind: 'append', file: CONFIG.quanLiId, tab: 'HOP_DONG', row });
  drafts.hd = {}; render(); say(T('Đã lưu hợp đồng của ', 'Saved for ') + row[1] + '.');
}

/* ---------- Wiring ---------- */
document.addEventListener('click', e => {
  const b = e.target.closest('[data-act]');
  if (!b || b.tagName === 'SELECT' || b.tagName === 'INPUT' || b.tagName === 'TEXTAREA') return;
  const act = b.dataset.act;
  if (act === 'caIn') caPress('vao');
  if (act === 'caOut') caPress('ra');
  if (act === 'caCentre') caCentre();
  if (act === 'caCentreTyped') caCentreTyped();
  if (act === 'caDecide') caDecide(b);
  if (act === 'payOpen') { pay.person = b.dataset.p; pay.mine = null; render(); payOpenOne(); }
  if (act === 'payBack') { pay.person = ''; pay.mine = null; render(); }
  if (act === 'payOk') payAct('Đúng');
  if (act === 'payWrong') payAct('Báo sai');
  if (act === 'payPaid') payAct(b.dataset.v, b.dataset.p);
  if (/^bc[A-Z]/.test(act)) bcAction(act);
  if (act === 'hdSave') hdSave();
  if (act === 'view' && b.dataset.v === 'luong') loadLuong(true);
  if (act === 'view' && b.dataset.v === 'hopdong') loadHd().then(render).catch(err => say(err.message, 'bad'));
});
document.addEventListener('input', e => {
  const b = e.target.closest('[data-act]');
  if (!b) return;
  if (b.dataset.act === 'xField') drafts[b.dataset.k] = b.value;
  if (b.dataset.act === 'hdField') { drafts.hd = drafts.hd || {}; drafts.hd[b.dataset.k] = b.value; }
});
document.addEventListener('change', e => {
  const b = e.target.closest('[data-act]');
  if (!b) return;
  if (b.dataset.act === 'hdField') { drafts.hd = drafts.hd || {}; drafts.hd[b.dataset.k] = b.value; }
  if (b.dataset.act === 'payPick' && b.value) { pay.month = b.value; pay.person = ''; loadLuong(true); }
  if (b.dataset.act === 'kpiPick' && b.value) { filters.kpiMonth = b.value; kpi.data = null; render(); loadKpi(b.value, false).catch(err => say(err.message, 'bad')); }
});
/* ---------- Penalty ladder with parent contact (owner 07/11) ----------
 * Levels come from the Schedule's ladder state (AUTO_KIDS_MUC_PHAT). Each entry into a level needs one contact:
 * L1–L3 a message (Fridays THUY TRANG, other days a manager), L4 a call by the homeroom, L5 a call by a manager,
 * calls within 2 days of entering the level. A tick is a row in LIEN_HE_PH, so everyone on duty sees it done. */
const LADDER_ACT = {
  1: 'TA trực hoặc quản lí gọi ra nhắc nhở trong giờ học; nhắn tin cho phụ huynh.',
  2: 'Ở lại chép bài phạt theo độ tuổi; TA hoặc quản lí nhắc phụ huynh.',
  3: 'Không cho vào lớp, ra ngoài bù bài; nhờ phụ huynh mang thiết bị đến để con làm bài.',
  4: 'Chủ nhiệm gọi điện trực tiếp tư vấn phụ huynh.',
  5: 'Quản lí nhắn tin hoặc gọi điện tư vấn nghỉ học.'
};
// Penalty copy texts by age, chosen from the class's book.
const COPY_TEXTS = {
  nho: { title: 'Bài chép phạt · 5–7 tuổi', how: 'Chép mỗi câu 2 lần, đọc to cho TA nghe.', lines: [
    ['I do my homework every day.', 'Con làm bài tập mỗi ngày.'],
    ['I watch the video and speak.', 'Con xem video và nói theo.'],
    ['I send my video to my teacher.', 'Con gửi video cho cô.'],
    ['I try my best.', 'Con cố gắng hết sức.'],
    ['I am a good student.', 'Con là học sinh chăm ngoan.']] },
  giua: { title: 'Bài chép phạt · 7–9 tuổi', how: 'Chép mỗi câu 1 lần cả tiếng Anh và tiếng Việt, rồi đọc to cho TA nghe.', lines: [
    ['I finish my homework before the next lesson.', 'Con làm xong bài trước buổi học sau.'],
    ['I practise speaking with the video every day.', 'Con luyện nói theo video mỗi ngày.'],
    ['I film myself clearly, with my face and my voice.', 'Con quay rõ mặt và rõ tiếng.'],
    ['If I forget my homework, I make it up the same day.', 'Quên bài thì con bù ngay trong ngày.'],
    ['I listen to my teacher and follow the class rules.', 'Con nghe lời cô và làm theo nội quy lớp.'],
    ['I keep my books and notebooks ready.', 'Con chuẩn bị đủ sách vở.'],
    ['Homework helps me remember new words.', 'Bài tập giúp con nhớ từ mới.'],
    ['I am responsible for my own learning.', 'Con tự chịu trách nhiệm việc học của mình.']] },
  lon: { title: 'Bài chép phạt · 9–12 tuổi', how: 'Chép 10 câu tiếng Anh, rồi viết 3 câu tiếng Việt: con còn nợ bài nào, vì sao, và con sẽ bù vào lúc nào.', lines: [
    ['Homework is my responsibility, not my parents\'.', 'Bài tập là trách nhiệm của con, không phải của bố mẹ.'],
    ['I plan my week so that every video is done before the deadline.', 'Con lên kế hoạch để mọi video xong trước hạn.'],
    ['A late or missing video means I fall behind my class.', 'Nộp muộn hay thiếu bài là con tụt lại so với lớp.'],
    ['I watch the model video first, then practise until I can speak without reading.', 'Con xem video mẫu rồi luyện đến khi nói được không cần nhìn.'],
    ['I check that my video shows my face and has clear sound before I send it.', 'Con kiểm tra video rõ mặt, rõ tiếng trước khi gửi.'],
    ['When I do not understand, I ask my teacher instead of skipping the task.', 'Không hiểu thì con hỏi cô, không bỏ bài.'],
    ['I make up every missing task within two days.', 'Con bù mọi bài còn thiếu trong 2 ngày.'],
    ['Keeping my promises helps my teacher and my friends trust me.', 'Giữ lời hứa giúp cô và bạn tin con.'],
    ['Small daily practice is better than a lot of work at the last minute.', 'Luyện một chút mỗi ngày tốt hơn dồn vào phút cuối.'],
    ['From today, I will hand in all my homework on time.', 'Từ hôm nay, con nộp đủ bài đúng hạn.']] }
};
function ageGroupOf(cls) {
  const books = [];
  Object.values(weeks).forEach(w => w.data.sessions.forEach(s => { if (Q.key(s.cls) === Q.key(cls) && s.book) books.push(Q.clean(s.book).toUpperCase()); }));
  const b = books.pop() || '';
  if (/PHONICS|PEPPA|FAMILY AND FRIENDS 1|\bFF ?1\b|KINDY|KINDER/.test(b)) return 'nho';
  if (/DISCOVER [3-6]|SCIENCE G[2-5]|CRITICAL|DEBATE|THINKING/.test(b)) return 'lon';
  return 'giua';
}
const ladder = { rows: null, contacts: null, at: 0, tried: 0, copy: null, stamp: '', fresh: false };
const viToIso = s => { const m = String(s || '').match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/); return m ? m[3] + '-' + m[2].padStart(2, '0') + '-' + m[1].padStart(2, '0') : ''; };
const contactOf = r => ({ at: r[0], cls: Q.clean(r[1]), name: Q.clean(r[2]), level: Number(r[3]) || 0, since: Q.clean(r[4]), action: Q.clean(r[5]), note: r[6] || '', by: r[7] || '' });
// Today's column of the week tab's penalty list (header "Thứ Hai 09.11", the list under it), read word for word.
async function readScheduleLadderList() {
  const t = today(), tab = Q.weekTab(tabs, t);
  if (!tab) return null;
  const [cells] = await batchGet(CONFIG.scheduleId, [quote(tab) + '!G26:M34']);
  const dm = t.slice(8, 10) + '.' + t.slice(5, 7);
  let body = null;
  for (let r = 0; r < cells.length && body == null; r++) {
    const row = cells[r] || [], c = row.findIndex(v => /^(Thứ|Chủ)/.test(String(v || '')) && String(v).split('\n')[0].includes(dm));
    if (c >= 0) body = String(((cells[r + 1] || [])[c]) || '');
  }
  if (body == null) return null;
  const map = new Map();
  let cls = '', line = '', level = 0;
  body.split('\n').forEach(raw => {
    const l = raw.trim();
    let m;
    if ((m = l.match(/^([A-ZĐ]+\s*\d+(?:\.\d+)?)\s*·/))) { cls = m[1]; return; }
    if ((m = l.match(/^Mức\s*(\d)\s*—/))) { level = Number(m[1]); line = l; return; }
    if ((m = l.match(/^•\s*(.+?)\s*↗?$/)) && cls && level) map.set(Q.key(cls) + '|' + Q.key(m[1]), { level, line });
  });
  return map;
}
async function loadLadder(force) {
  if (!force && ladder.rows && Date.now() - ladder.at < 300000) return;
  const [[rows, stamp = []], [contacts]] = await Promise.all([batchGet(CONFIG.scheduleId, ["'AUTO_KIDS_MUC_PHAT'!A2:M400", "'AUTO_KIDS_MUC_PHAT'!Q1"]), batchGet(CONFIG.diemDanhId, ['LIEN_HE_PH!A2:H'])]);
  // The Schedule's own line "Cập nhật 09/11 18:30 · …": shown above the list so everyone sees the levels are the Schedule's and how fresh.
  ladder.stamp = Q.clean(((stamp || [])[0] || [])[0] || '');
  ladder.rows = rows.map(r => ({ checked: Q.clean(r[0]), cls: Q.clean(r[1]), name: Q.clean(r[2]), level: Number(r[3]) || 0, since: Q.clean(r[4]), reason: Q.clean(r[5]), owed: String(r[6] || '').split('\n').map(Q.clean).filter(Boolean) })).filter(x => x.level >= 1 && x.cls && x.name);
  ladder.contacts = contacts.map(contactOf);
  outbox.filter(x => x.kind === 'append' && x.tab === 'LIEN_HE_PH').forEach(x => ladder.contacts.push(contactOf(x.row)));
  // Owner 09/11: "hiển thị từ schedule ra": today's list on the week tab ("KIDS 39 · 19:30 · 3 HS / Mức 1 — thiếu video 02.11 /
  // • VĂN KHÁNH NHẬT (BRAVE)") is read as it stands; each pupil on it shows that exact level and line. Nothing is worked out here.
  try { ladder.list = await readScheduleLadderList(); } catch (e) { /* the state tab alone still shows */ }
  if (ladder.list) ladder.rows.forEach(x => { const hit = ladder.list.get(Q.key(x.cls) + '|' + Q.key(x.name)); if (hit) { x.level = hit.level; x.line = hit.line; x.reason = hit.line; } });
  ladder.at = Date.now();
}
// Ticks began on 07/11: a level entered earlier may have been handled outside the app, so it is never shown as overdue.
const CONTACT_START = '2026-11-07';
const contactOld = x => { const d = viToIso(x.since); return x.level < 4 && !!d && d < CONTACT_START && !ladTodayClass(x); };
const isFriday = d => new Date(d + 'T12:00:00').getDay() === 5;
function contactRule(x) {
  const since = viToIso(x.since) || today();
  if (x.level >= 4) return { action: 'Đã gọi PH', who: x.level === 4 ? (homeroom[Q.key(x.cls)] || T('Chủ nhiệm', 'Homeroom')) : T('Quản lí', 'Manager'), due: Q.addDays(since, 2), call: true };
  return { action: 'Đã nhắn PH', who: isFriday(today()) ? 'THUY TRANG' : T('Quản lí', 'Manager'), due: since, call: false };
}
const contactDone = (x, rule) => { const list = (ladder.contacts || []).filter(c => sameName(c.cls, x.cls) && c.name === x.name && c.level === x.level && c.since === x.since && c.action === rule.action); return !rule.call && ladTodayClass(x) ? list.filter(c => contactDay(c) === today()).pop() : list.pop(); };
function canContact(x, rule) {
  if (isManager()) return true;
  if (rule.call) return x.level === 4 && isMe(homeroom[Q.key(x.cls)] || '');
  return isFriday(today()) && isMe('THUY TRANG');
}
function ladderBlock(week) {
  if (!ladder.rows) { if (Date.now() - ladder.tried > 60000) { ladder.tried = Date.now(); setTimeout(() => loadLadder().then(render).catch(() => {}), 0); } return penaltyBlock(week); }
  const todayCls = new Map();
  (week ? week.data.sessions : []).filter(s => s.day === day && !s.off).forEach(s => { const k = Q.key(s.cls); if (!todayCls.has(k) || todayCls.get(k).start > s.start) todayCls.set(k, s); });
  // Penalties are handled by managers, staff on the TA side and the homeroom; a class teacher does not see them.
  const mine = x => isManager() || isTaSide(week) || isMe(homeroom[Q.key(x.cls)] || '');
  const list = ladder.rows.filter(mine).map(x => { const rule = contactRule(x), done = contactDone(x, rule) || (contactOld(x) ? { by: T('trước khi dùng app', 'before the app'), at: '', old: true } : null); return { x, rule, done, late: !done && today() > rule.due && (viToIso(x.since) || today()) >= CONTACT_START, s: todayCls.get(Q.key(x.cls)) }; });
  if (!list.length) return '';
  list.sort((a, b) => (a.done ? 1 : 0) - (b.done ? 1 : 0) || b.late - a.late || (a.s ? 0 : 1) - (b.s ? 0 : 1) || b.x.level - a.x.level || a.x.cls.localeCompare(b.x.cls, 'vi', { numeric: true }));
  const todo = list.filter(l => !l.done).length, late = list.filter(l => l.late).length;
  // Owner 08/11: handled pupils do not disappear, they fade and say who did it and when (pending ones stay on top).
  const mode = filters.lad || 'can', shown = mode === 'homnay' ? list.filter(l => l.s) : list;
  let h = '<div class="part p-alert"><h2>' + T('Học sinh trong danh sách phạt', 'Pupils on the penalty ladder') + '</h2><span>' + list.length + T(' HS', ' pupils') + (late ? ' · ' + late + T(' quá hạn', ' overdue') : '') + '</span></div>';
  h += '<div class="chips">' + [['can', T('Cần liên hệ PH', 'To contact') + ' ' + todo], ['homnay', T('Lớp học hôm nay', 'In class today') + ' ' + list.filter(l => l.s).length], ['tat', T('Tất cả', 'All') + ' ' + list.length]].map(([k, t]) => '<button class="' + (mode === k ? 'on' : '') + '" data-act="ladMode" data-v="' + k + '">' + esc(t) + '</button>').join('') + '</div>';
  h += '<details class="card row lad-legend"><summary>' + T('Việc từng mức · nhắn tin hôm nay: ', 'What each level means · messages today: ') + '<b>' + (isFriday(today()) ? 'THUY TRANG' : T('quản lí', 'managers')) + '</b></summary>' + [1, 2, 3, 4, 5].map(l => '<div class="small"><span class="lvl l' + l + '">M' + l + '</span> ' + esc(LADDER_ACT[l]) + (l >= 4 ? T(' Hạn 2 ngày.', ' Within 2 days.') : '') + '</div>').join('') + '</details>';
  if (!shown.length) return h + '<div class="card empty">' + (mode === 'can' ? T('Đã liên hệ phụ huynh đủ.', 'All parents contacted.') : T('Không có học sinh nào.', 'Nobody here.')) + '</div>' + (ladder.copy ? copySheet(ladder.copy) : '');
  const byCls = new Map();
  shown.forEach(l => { if (!byCls.has(l.x.cls)) byCls.set(l.x.cls, []); byCls.get(l.x.cls).push(l); });
  h += '<div class="grid">' + [...byCls.entries()].map(([cls, items]) => {
    const s0 = items[0].s;
    return '<div class="card row lad-class"><div class="row-top"><b>' + esc(cls) + '</b>' + (s0 ? '<span class="tag">' + T('học ', 'class ') + Q.clock(s0.start) + '</span>' : '') + '<span class="spacer"></span><span class="muted small">' + items.length + T(' HS', '') + '</span></div>' + items.map(({ x, rule, done, late }) => {
      const m = x.name.match(/^(.*?)\s*\(([^)]+)\)\s*$/), eng = m ? m[2] : '', full = m ? m[1] : x.name;
      return '<div class="lad lv' + x.level + (late ? ' late' : '') + (done ? ' done' : '') + '"><div class="lad-line"><span class="lvl l' + x.level + '">M' + x.level + '</span><b>' + esc(eng || full) + '</b>' +
        (done && done.old ? '<span class="tag">' + T('Vào mức trước 07/11', 'Before 07/11') + '</span>' : '') + (done && !done.old ? '<span class="tag ok">✓ ' + esc(rule.action) + ' · ' + esc(done.by || '?') + (done.at ? ' · ' + esc(String(done.at).slice(11, 16) + ' ' + String(done.at).slice(0, 5)) : '') + '</span>' : done ? '' : '<span class="tag ' + (late ? 'bad' : 'warn') + '">' + esc(rule.call ? T('Gọi', 'Call') : T('Nhắn', 'Message')) + ' · ' + esc(rule.who) + (rule.call ? ' · ' + esc(viDate(rule.due).slice(0, 5)) : '') + '</span>') +
        '<span class="spacer"></span>' + (!done && canContact(x, rule) ? '<button class="good" data-act="ladTick" data-cls="' + esc(x.cls) + '" data-name="' + esc(x.name) + '">' + esc(rule.action) + '</button>' : '') +
        (x.level === 2 ? '<button class="quiet" data-act="ladCopy" data-cls="' + esc(x.cls) + '" data-name="' + esc(eng || full) + '">' + T('Bài chép', 'Copy text') + '</button>' : '') + '</div>' +
        '<details class="lad-more"><summary>' + esc(x.reason || T('Chi tiết', 'Details')) + '</summary><div class="small">' + esc(full) + ' · ' + T('vào mức từ ', 'since ') + esc(x.since) + '</div>' + (x.owed.length ? '<div class="small muted">' + T('Còn nợ: ', 'Owes: ') + esc(x.owed.join('; ')) + '</div>' : '') + '</details></div>';
    }).join('') + '</div>';
  }).join('') + '</div>';
  if (ladder.copy) h += copySheet(ladder.copy);
  return h;
}
function copySheet(c) {
  const t = COPY_TEXTS[ageGroupOf(c.cls)];
  return '<div class="ll-veil" data-act="ladCopyClose"></div><div class="ll-sheet print-sheet" role="dialog"><div class="row-top no-print"><b>' + esc(t.title) + '</b><span class="spacer"></span><button class="quiet" data-act="ladPrint">' + T('In', 'Print') + '</button><button class="quiet" data-act="ladCopyClose">' + T('Đóng', 'Close') + '</button></div>' +
    '<div class="copy-text"><h3>' + esc(t.title) + '</h3><div>' + T('Học sinh: ', 'Pupil: ') + '<b>' + esc(c.name) + '</b> · ' + esc(c.cls) + ' · ' + T('Ngày ', 'Date ') + esc(viDate(today())) + '</div><p><i>' + esc(t.how) + '</i></p><ol>' +
    t.lines.map(l => '<li><b>' + esc(l[0]) + '</b><br><span>' + esc(l[1]) + '</span></li>').join('') + '</ol><div class="sign">' + T('Học sinh ký tên: ……………………      TA: ……………………', 'Pupil: ……………      TA: ……………') + '</div></div></div>';
}
function ladTick(b) {
  const x = (ladder.rows || []).find(r => sameName(r.cls, b.dataset.cls) && r.name === b.dataset.name);
  if (!x) return;
  const rule = contactRule(x), row = [stamp(), x.cls, x.name, String(x.level), x.since, rule.action, '', me.name];
  ladder.contacts.push(contactOf(row));
  queue({ kind: 'append', file: CONFIG.diemDanhId, tab: 'LIEN_HE_PH', row });
  render();
}
document.addEventListener('click', e => {
  const b = e.target.closest('[data-act]');
  if (!b) return;
  if (b.dataset.act === 'ladTick') ladTick(b);
  if (b.dataset.act === 'ladMode') { filters.lad = b.dataset.v; render(); }
  if (b.dataset.act === 'ladCopy') { ladder.copy = { cls: b.dataset.cls, name: b.dataset.name }; render(); }
  if (b.dataset.act === 'ladCopyClose') { ladder.copy = null; render(); }
  if (b.dataset.act === 'ladPrint') printCopySheet(ladder.copy);
});
/* Owner 09/11: "nút in chép phạt có thể in được thật ý chứ không phải chỉ là cho có". The button prints a real A4 worksheet in a
 * hidden frame (not the app page): pupil, class, date, level and reason from the Schedule ladder, the instruction, each sentence with
 * ruled lines to copy on (2 lines per sentence for the younger groups, 1 for the oldest plus 3 lines for the written self-review),
 * and signatures. */
function printCopySheet(c) {
  if (!c) return;
  const group = ageGroupOf(c.cls), t = COPY_TEXTS[group], reps = group === 'lon' ? 1 : 2;
  const x = (ladder.rows || []).find(r => sameName(r.cls, c.cls) && Q.key(r.name).includes(Q.key(c.name))) || {};
  const ln = n => '<div class="ln"></div>'.repeat(n);
  const body = '<div class="top"><div class="brand">Ms. Trang Trieu Education</div><div class="no">' + esc(viDate(today())) + '</div></div>' +
    '<h1>' + esc(t.title) + '</h1>' +
    '<div class="meta"><div>Học sinh: <b>' + esc(x.name || c.name) + '</b></div><div>Lớp: <b>' + esc(c.cls) + '</b></div>' +
    '<div>Mức: <b>' + (x.level ? 'M' + x.level : '—') + '</b></div><div>Lý do: ' + esc(x.reason || '') + '</div></div>' +
    (x.owed && x.owed.length ? '<div class="owed">Còn nợ: ' + esc(x.owed.join('; ')) + '</div>' : '') +
    '<div class="how">' + esc(t.how) + '</div>' +
    t.lines.map((l, i) => '<div class="item"><div class="en">' + (i + 1) + '. ' + esc(l[0]) + '</div><div class="vi">' + esc(l[1]) + '</div>' + ln(reps) + '</div>').join('') +
    (group === 'lon' ? '<div class="item"><div class="en">Con còn nợ bài nào, vì sao, và con sẽ bù vào lúc nào?</div>' + ln(3) + '</div>' : '') +
    '<div class="sign"><div>Học sinh ký tên<br><br>………………………</div><div>TA / Giáo viên<br><br>………………………</div></div>';
  const html = '<!doctype html><html lang="vi"><head><meta charset="utf-8"><title>Bài chép phạt · ' + esc(c.name) + '</title><style>' +
    '@page{size:A4;margin:9mm 12mm}*{box-sizing:border-box}body{font-family:Arial,Helvetica,sans-serif;color:#111;margin:0}' +
    '.top{display:flex;justify-content:space-between;font-size:10pt;color:#555;border-bottom:2px solid #111;padding-bottom:2mm;margin-bottom:3mm}.brand{font-weight:700}' +
    'h1{font-size:17pt;margin:0 0 2mm}.meta{display:grid;grid-template-columns:1fr 1fr;gap:1.5mm 8mm;font-size:12pt;margin-bottom:2mm}.owed{font-size:10.5pt;color:#333;margin-bottom:2mm}' +
    '.how{font-style:italic;font-size:11.5pt;margin:0 0 4mm;padding:2mm 3mm;border:1px solid #999;border-radius:2mm}' +
    '.item{break-inside:avoid;page-break-inside:avoid;margin-bottom:2mm}.en{font-size:12.5pt;font-weight:700}.vi{font-size:10pt;color:#444;margin:0.3mm 0 0.5mm}' +
    '.ln{border-bottom:1px solid #777;height:6.5mm}.sign{display:flex;justify-content:space-between;margin-top:8mm;font-size:12pt;break-inside:avoid}' +
    '</style></head><body>' + body + '</body></html>';
  const old = document.getElementById('copyPrintFrame');
  if (old) old.remove();
  const f = document.createElement('iframe');
  f.id = 'copyPrintFrame'; f.setAttribute('aria-hidden', 'true');
  f.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0;visibility:hidden';
  f.onload = () => { try { f.contentWindow.focus(); f.contentWindow.print(); } catch (err) { say(T('Không mở được hộp in, thử lại hoặc dùng Ctrl+P.', 'Could not open printing.'), 'bad'); } };
  f.srcdoc = html;
  document.body.appendChild(f);
}

function ladderTodo(week) {
  if (!ladder.rows) return 0;
  return ladder.rows.filter(r => (isManager() || isTaSide(week) || isMe(homeroom[Q.key(r.cls)] || '')) && !contactDone(r, contactRule(r))).length;
}

/* ---------- Notification bell (owner 07/11): what needs me now, each line opens the right place ----------
 * Built from what the app already reads; refreshed every 3 minutes while the app is open. */
const bell = { open: false, busy: false, seen: new Set(), first: true };
function bellItems() {
  if (!me) return [];
  const saved = day, out = [], now = minutesNow(), t = today();
  day = t;
  try {
    const week = weeks[Q.weekTab(tabs, t)] || null;
    const add = (k, icon, text, n, hot, go) => out.push({ k, icon, text, n: n || 1, hot: !!hot, go });
    if (week) {
      const alerts = (alertsBlock(week).match(/class="card row alert/g) || []).length;
      if (alerts) add('alert', '🚨', alerts + T(' lớp hôm nay chưa rõ điểm danh', ' classes with open attendance'), alerts, true, { view: 'lich', sec: 'homnay' });
    }
    // My own check-in.
    if (!isOwner() && ca.rows) {
      const due = myDue(week, t), vin = caPair(ca.rows, t, me.name, 'Vào ca'), vout = caPair(ca.rows, t, me.name, 'Ra ca');
      if (!vin && due !== null && now >= due - 15) add('in', '📍', T('Bạn chưa bấm Vào ca (có mặt trước ', 'Not checked in yet (due ') + Q.clock(due) + ')', 1, now > due, { view: 'lich', sec: 'homnay' });
      if (vin && vin.status === 'Không duyệt') add('inno', '📍', T('Vào ca hôm nay không được duyệt', 'Check-in today was not approved'), 1, true, { view: 'lich', sec: 'homnay' });
      if (vin && !vout && isPartTime(me.name) && now >= 20 * 60) add('out', '🕘', T('Về nhớ bấm Ra ca để tính giờ', 'Check out before you leave'), 1, false, { view: 'lich', sec: 'homnay' });
    }
    // Managers: check-ins waiting for a decision (not their own).
    if (isManager() && ca.all) {
      const keys = new Set(ca.all.filter(r => r.day === t && !sameName(r.person, me.name)).map(r => Q.key(r.person) + '|' + r.kind));
      const waiting = [...keys].filter(k => { const [p, kind] = k.split('|'), x = caPair(ca.all, t, ca.all.find(r => Q.key(r.person) === p).person, kind); return x && x.status === 'Chờ duyệt'; }).length;
      if (waiting) add('wait', '✅', waiting + T(' lượt vào ca chờ duyệt', ' check-ins to approve'), waiting, false, { view: 'dieuhanh', panel: 'ca' });
    }
    // Parents to message or call (penalty ladder).
    if (ladder.rows) {
      const mine = r => isManager() || isTaSide(week) || isMe(homeroom[Q.key(r.cls)] || '');
      const todo = ladder.rows.filter(r => mine(r)).map(r => ({ r, rule: contactRule(r) })).filter(x => !contactDone(x.r, x.rule) && !contactOld(x.r));
      const late = todo.filter(x => t > x.rule.due && (viToIso(x.r.since) || t) >= CONTACT_START).length, mineToo = todo.filter(x => canContact(x.r, x.rule)).length;
      if (todo.length) add('lad', '📞', todo.length + T(' phụ huynh cần nhắn / gọi', ' parents to contact') + (late ? T(' · ' + late + ' quá hạn', ' · ' + late + ' overdue') : '') + (mineToo && mineToo < todo.length ? T(' (' + mineToo + ' việc của bạn)', ' (' + mineToo + ' yours)') : ''), todo.length, late > 0, { view: 'lich', sec: 'phat' });
    }
    if (week) {
      // Important Task due today or overdue.
      const tasks = week.data.tasks.map(x => Object.assign({}, x, { ta: staffNow(x.ta, x.cls) })).filter(x => !x.done && (isMe(x.teacher) || isMe(x.ta)));
      const dueOf = x => isMe(x.teacher) ? x.gradeDue : x.returnDue, over = tasks.filter(x => dueOf(x) && dueOf(x) < t).length, now_ = tasks.filter(x => dueOf(x) === t).length;
      if (over) add('tlate', '⏰', over + T(' Important Task quá hạn', ' important tasks overdue'), over, true, { view: 'lich', sec: 'task' });
      if (now_) add('ttoday', '📝', now_ + T(' Important Task đến hạn hôm nay', ' important tasks due today'), now_, false, { view: 'lich', sec: 'task' });
      // Homework returns that are mine today.
      const last = Q.key(me.name).split(' ').pop(), ret = (week.data.returns || []).filter(x => x.day === t && !x.done && Q.key(x.who) === last).length;
      if (ret) add('ret', '📚', ret + T(' lớp cần trả BTVN hôm nay', ' homework returns today'), ret, now >= 21 * 60, { view: 'lich', sec: 'lamviec' });
    }
    // Payroll days 8 to 10.
    const dm = Number(t.slice(8, 10));
    if (dm >= 8 && dm <= 10) {
      payNoticeBlock();
      if (payNudge && isOwner()) {
        const rows = payNudge.rows || [], left = rows.filter(r => r.person && !(r.state && r.state.check && !r.state.check.stale)).length, wrong = rows.filter(r => r.state && r.state.check && r.state.check.action === 'Báo sai').length;
        if (wrong) add('pwrong', '💰', wrong + T(' người báo sai lương', ' payslips reported wrong'), wrong, true, { view: 'luong' });
        if (left) add('pleft', '💰', left + T(' người chưa xác nhận lương', ' payslips not confirmed'), 1, false, { view: 'luong' });
      } else if (payNudge && payNudge.slip) {
        const c = payNudge.state && payNudge.state.check;
        if ((!c || c.stale) && t <= payNudge.dates.check && !payPast(payNudge)) add('pay', '💰', T('Bảng lương đã có, xác nhận trước ' + payBy(payNudge), 'Payslip ready, please confirm'), 1, t === payNudge.dates.check, { view: 'luong' });
      }
    }
  } catch (e) { /* the bell never breaks the page */ }
  finally { day = saved; }
  return out;
}
function paintBell() {
  const b = document.getElementById('btnBell');
  if (!b || !me) return;
  const items = bellItems(), n = items.reduce((s, x) => s + x.n, 0), hot = items.some(x => x.hot);
  b.innerHTML = ICON_BELL + (n ? '<i class="' + (hot ? 'hot' : '') + '">' + (n > 99 ? '99+' : n) + '</i>' : '');
  b.setAttribute('aria-label', T('Thông báo: ', 'Notifications: ') + n);
  b.classList.toggle('ring', hot);
  try { document.title = (n ? '(' + n + ') ' : '') + T('Quản lí lớp', 'Class manager'); } catch (e) {}
  let p = document.getElementById('bellPanel');
  if (!bell.open) { if (p) p.remove(); return; }
  if (!p) { p = document.createElement('div'); p.id = 'bellPanel'; document.body.appendChild(p); }
  const ask = 'Notification' in window && Notification.permission === 'default';
  p.innerHTML = '<div class="bell-veil" data-act="bell"></div><div class="bell-box" role="dialog" aria-label="' + T('Thông báo', 'Notifications') + '"><div class="row-top"><b>🔔 ' + T('Thông báo', 'Notifications') + '</b><span class="spacer"></span><button class="quiet" data-act="bell">' + T('Đóng', 'Close') + '</button></div>' +
    (items.length ? items.map((x, i) => '<button class="bell-item' + (x.hot ? ' hot' : '') + '" data-act="bellGo" data-i="' + i + '"><span>' + x.icon + '</span><span>' + esc(x.text) + '</span><span class="muted">›</span></button>').join('')
      : '<div class="small muted">' + T('Không có việc gì cần bạn lúc này.', 'Nothing needs you right now.') + '</div>') +
    (ask ? '<button class="quiet small" data-act="bellAsk">' + T('Báo cả khi app chạy nền (máy tính)', 'Notify me in the background (computer)') + '</button>' : '') +
    '<div class="small muted">' + T('Tự cập nhật 3 phút một lần khi app đang mở.', 'Updates every 3 minutes while the app is open.') + '</div></div>';
}
// A new urgent line while the app is in the background shows a computer notification, once per line per day.
function bellNotify() {
  const items = bellItems().filter(x => x.hot), fresh = items.filter(x => !bell.seen.has(today() + x.k + x.n));
  items.forEach(x => bell.seen.add(today() + x.k + x.n));
  if (bell.first) { bell.first = false; return; }
  if (!fresh.length || !document.hidden || !('Notification' in window) || Notification.permission !== 'granted') return;
  try { new Notification(T('Quản lí lớp', 'Class manager'), { body: fresh.map(x => x.text).join('\n'), icon: 'logo.png', tag: 'ql-bell' }); } catch (e) {}
}
async function bellRefresh() {
  if (!me || bell.busy || isBoard()) return;
  bell.busy = true;
  try {
    const week = weeks[Q.weekTab(tabs, today())] || null, jobs = [];
    // My check-in is read again only while it can still change (not in yet, or a part-time TA not out yet).
    if (!isOwner() && (!ca.rows || !caPair(ca.rows, today(), me.name, 'Vào ca') || (isPartTime(me.name) && !caPair(ca.rows, today(), me.name, 'Ra ca')))) jobs.push(loadCa(true));
    if (isManager()) jobs.push(loadCaAll(true));
    if (isManager() || isTaSide(week) || Object.values(homeroom).some(n => isMe(n))) jobs.push(loadLadder(Date.now() - ladder.at > 150000));
    if (view !== 'lich' && week) { const saved = day; day = today(); const need = alertSessions(week).length; day = saved; if (need) jobs.push(loadMarks(true).then(() => { const s = day; day = today(); return loadAlerts().finally(() => { day = s; }); })); }
    await Promise.all(jobs.map(j => j.catch(() => {})));
  } finally { bell.busy = false; }
  render();
  bellNotify();
}
const renderBeforeBell = render;
render = function () { renderBeforeBell(); paintBell(); };
setTimeout(function tick() { bellRefresh().catch(() => {}); setTimeout(tick, document.hidden ? 300000 : 180000); }, 8000);
document.addEventListener('click', e => {
  const b = e.target.closest('[data-act]');
  if (!b) return;
  if (b.dataset.act === 'bell') { bell.open = !bell.open; paintBell(); }
  if (b.dataset.act === 'bellAsk') { try { Notification.requestPermission().then(paintBell); } catch (e) {} }
  if (b.dataset.act === 'bellGo') {
    const x = bellItems()[Number(b.dataset.i)];
    bell.open = false;
    if (!x) return paintBell();
    day = today(); view = x.go.view;
    if (x.go.sec) filters.sec = x.go.sec;
    if (x.go.panel) { panel = x.go.panel; filters.person = ''; }
    if (view === 'lich' && isManager()) filters.showAll = false;
    render(); window.scrollTo(0, 0);
    if (view === 'dieuhanh') guarded(loadPanel); else if (view === 'lich') guarded(() => weekOf(day));
  }
});


/* ---------- Class touch screen (owner 07/11: log in on the ClassIn board to take the roll) ----------
 * The board shows a 6-digit code; a manager types it in Điều hành › Màn hình lớp. The board's own link can only open
 * today's classes for roll call, stars and behaviour; the server refuses everything else. */
const isBoard = () => !!me && me.role === 'Màn hình';
const boardPair = { code: '', secret: '', until: 0, timer: null, err: '' };
const randomText = (n, set) => { const a = new Uint32Array(n); crypto.getRandomValues(a); return [...a].map(x => set[x % set.length]).join(''); };
async function rawCall(op, args) {
  const r = await fetch(CONFIG.server, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify(Object.assign({ op }, args)) });
  const d = await r.json();
  if (!d.ok) { const e = new Error(d.error || 'Lỗi máy chủ'); e.status = d.status; throw e; }
  return d.data;
}
function paintBoardCode() {
  const box = document.getElementById('boardCode');
  if (!box) return;
  if (!boardPair.code) { box.innerHTML = boardPair.err ? '<p class="bad">' + esc(boardPair.err) + '</p>' : ''; return; }
  const left = Math.max(1, Math.round((boardPair.until - Date.now()) / 60000));
  box.innerHTML = '<div class="board-code" aria-label="' + T('Mã ghép', 'Pairing code') + '">' + boardPair.code.slice(0, 3) + ' ' + boardPair.code.slice(3) + '</div>' +
    '<p>' + T('Quản lí mở app trên điện thoại › <b>Điều hành › Màn hình lớp</b>, gõ mã này và tên phòng rồi bấm Ghép. Màn hình tự vào sau vài giây.', 'A manager opens the app › <b>Điều hành › Màn hình lớp</b>, types this code and the room name, then presses Pair.') + '</p>' +
    '<p class="small muted">' + T('Mã dùng được ' + left + ' phút nữa.', 'The code works for ' + left + ' more minutes.') + '</p>';
}
async function boardStart() {
  clearTimeout(boardPair.timer);
  boardPair.err = '';
  try {
    boardPair.code = randomText(6, '0123456789');
    boardPair.secret = randomText(40, 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789');
    const r = await rawCall('ghepmo', { code: boardPair.code, secret: boardPair.secret });
    boardPair.until = Date.now() + r.seconds * 1000;
  } catch (e) { boardPair.code = ''; boardPair.err = T('Chưa lấy được mã: ', 'No code yet: ') + e.message; paintBoardCode(); return; }
  paintBoardCode();
  const poll = async () => {
    if (!boardPair.code) return;
    // After one code (15 min) nobody scanned: stop asking the server and show the button again; one tap brings a new QR.
    if (Date.now() > boardPair.until) { boardPair.code = ''; boardPair.err = T('Mã QR đã hết hạn. Chạm nút ở trên để hiện mã mới.', 'The QR expired. Tap the button above for a new one.'); paintBoardCode(); return; }
    try {
      const r = await rawCall('ghepxem', { code: boardPair.code, secret: boardPair.secret });
      if (r.ready) { boardPair.code = ''; paintBoardCode(); keep('key', r.key); accessKey = r.key; view = 'bang'; boardAutoOpen = r.open || null; enter(); return; }
    } catch (e) { if (e.status === 410 || e.status === 403) { boardPair.code = ''; boardPair.err = e.message; paintBoardCode(); return; } }
    paintBoardCode();
    boardPair.timer = setTimeout(poll, 4000);
  };
  boardPair.timer = setTimeout(poll, 4000);
}

// On the board: today's classes only, big, in time order. A class opens 30 minutes before it starts.
function viewBoard() {
  const t = today(), week = weeks[Q.weekTab(tabs, t)], now = minutesNow();
  let h = '<div class="board-head"><div class="board-clock">' + Q.clock(now) + '</div><div><b>' + esc(dayLabel(t)) + '</b><div class="small muted">' + esc(me.name) + '</div></div></div>';
  if (!week) return h + '<div class="card empty">' + T('Đang đọc lịch hôm nay…', 'Reading today\'s schedule…') + '</div>';
  const all = week.data.sessions.filter(s => s.day === t && !s.off && classOf(s)).sort((a, b) => a.start - b.start);
  const sites = [...new Set(all.map(s => Q.clean(s.site).toUpperCase()).filter(Boolean))], site = saved.get('boardSite') || '';
  if (sites.length > 1) h += '<div class="chips">' + [['', T('Tất cả cơ sở', 'All sites')]].concat(sites.map(x => [x, x])).map(([k, label]) => '<button class="' + (site === k ? 'on' : '') + '" data-act="boardSite" data-v="' + esc(k) + '">' + esc(label) + '</button>').join('') + '</div>';
  const list = site ? all.filter(s => Q.key(s.site) === Q.key(site)) : all;
  if (!list.length) return h + '<div class="card empty">' + T('Hôm nay không có lớp nào ở đây.', 'No classes here today.') + '</div>';
  const state = s => now < s.start - 30 ? 'later' : now <= s.end ? 'now' : 'done';
  return h + '<div class="board-list">' + list.map(s => {
    const st = state(s);
    return '<button class="board-cls ' + st + '" data-act="boardOpen" data-row="' + s.row + '" data-day="' + s.day + '"' + (st === 'later' ? ' disabled' : '') + '><b>' + esc(s.cls) + '</b>' +
      '<span>' + sessionTime(s) + (s.lesson ? T(' · Tiết ', ' · Lesson ') + esc(s.lesson) : '') + '</span><span class="small">GV ' + esc(s.teacher) + (s.site ? ' · ' + esc(s.site) : '') + '</span>' +
      '<i>' + (st === 'now' ? T('Mở lớp ›', 'Open ›') : st === 'later' ? T('Mở lúc ', 'Opens ') + Q.clock(s.start - 30) : T('Đã học · mở lại', 'Done · reopen')) + '</i></button>';
  }).join('') + '</div>';
}
function renderBoard() {
  const active = document.activeElement;
  if (active && $('main').contains(active) && /^(INPUT|TEXTAREA)$/.test(active.tagName)) return;
  $('nav').innerHTML = '';
  const bb = document.getElementById('btnBell');
  if (bb) bb.hidden = true;
  paintLang();
  paintTheme();
  if (view !== 'lenlop') { view = 'bang'; document.body.classList.remove('lenlop'); }
  const notes = notices.map((n, i) => '<div class="notice ' + n.kind + '" role="alert">' + esc(n.text) + ' <button class="quiet" data-act="dismiss" data-i="' + i + '">' + T('Đóng', 'Close') + '</button></div>').join('');
  $('main').innerHTML = notes + (loadError ? '<div class="notice bad">' + esc(loadError) + '</div>' : '') + (view === 'lenlop' && current ? viewLenLop() : viewBoard()); $('main')._html = null;
  paintSave();
}
const renderBeforeBoard = render;
render = function () { if (isBoard()) renderBoard(); else renderBeforeBoard(); };
// The board takes the roll of today's classes only, in the same window as the teacher.
const canTeachBeforeBoard = canTeach;
canTeach = s => isBoard() ? !isChot(s) && s.day === today() && Q.rollCall(s, marksOf(s), today(), minutesNow()).open && !lessonClosed(s) : canTeachBeforeBoard(s);
setInterval(() => {
  if (!isBoard()) return;
  if (day !== today()) { day = today(); weekOf(day).then(render).catch(() => {}); }
  if (view !== 'lenlop') render();
}, 30000);
setInterval(() => { if (isBoard() && view !== 'lenlop') weekOf(today(), true).then(render).catch(() => {}); }, 600000);

/* Managers pair and remove class screens. */
PANELS.push(['manhinh', 'Màn hình lớp']);
const boards = { list: null, tried: 0, busy: false };
const viewManagerBeforeBoard = viewManager;
viewManager = function (week) {
  if (panel !== 'manhinh') return viewManagerBeforeBoard(week);
  return '<div class="tabs">' + PANELS.map(([k, t]) => '<button class="' + (k === panel ? 'on' : '') + '" data-act="panel" data-v="' + k + '">' + esc(t) + '</button>').join('') + '</div>' + boardPanel();
};
function boardPanel() {
  if (!boards.list && Date.now() - boards.tried > 30000) { boards.tried = Date.now(); setTimeout(() => call('manhinh', {}).then(r => { boards.list = r.boards; render(); }).catch(e => say(e.message, 'bad')), 0); }
  let h = '<div class="card row"><b>📺 ' + T('Ghép màn hình lớp', 'Pair a class screen') + '</b>' +
    '<div class="small muted">' + T('Trên màn hình lớp, mở trang app và bấm "Đây là màn hình lớp". Màn hình hiện mã 6 số. Gõ mã và tên phòng ở đây rồi bấm Ghép.', 'On the class screen, open the app page and press "This is a class screen". Type the 6-digit code and the room name here.') + '</div>' +
    '<div class="choices"><input data-act="xField" data-k="bdCode" inputmode="numeric" autocomplete="off" maxlength="7" placeholder="' + T('Mã 6 số', '6-digit code') + '" value="' + esc(drafts.bdCode || '') + '">' +
    '<input data-act="xField" data-k="bdName" list="bdNames" maxlength="40" placeholder="' + T('Tên phòng, ví dụ PHÒNG 1 HÀM NGHI', 'Room, e.g. ROOM 1') + '" value="' + esc(drafts.bdName || '') + '">' +
    '<button class="primary" data-act="boardPairGo"' + (boards.busy ? ' disabled' : '') + '>' + (boards.busy ? T('Đang ghép…', 'Pairing…') : T('Ghép', 'Pair')) + '</button></div>' +
    '<datalist id="bdNames">' + (boards.list || []).map(b => '<option value="' + esc(b.name.replace(/^MÀN HÌNH\s*/, '')) + '">').join('') + '</datalist>' +
    '<div class="small muted">' + T('Màn hình lớp chỉ mở được lớp hôm nay để điểm danh, thêm sao và nhắc nhở. Không xem được lương, danh sách phạt, liên hệ phụ huynh hay việc của nhân viên. Ghép lại cùng tên phòng thì link cũ của màn hình đó hết hiệu lực.', 'A class screen only opens today\'s classes for roll call, stars and behaviour.') + '</div></div>';
  h += '<h2>' + T('Màn hình đang dùng', 'Screens in use') + '</h2>';
  if (!boards.list) return h + '<div class="card empty">' + T('Đang đọc…', 'Reading…') + '</div>';
  if (!boards.list.length) return h + '<div class="card empty">' + T('Chưa ghép màn hình nào.', 'No screen yet.') + '</div>';
  return h + '<div class="list">' + boards.list.map(b => '<div class="card row"><div class="row-top"><b>' + esc(b.name) + '</b><span class="small muted">' + T('ghép ngày ', 'paired ') + esc(b.at) + '</span><span class="spacer"></span><button class="quiet low" data-act="boardDrop" data-id="' + esc(b.id) + '" data-name="' + esc(b.name) + '">' + T('Gỡ', 'Remove') + '</button></div></div>').join('') + '</div>';
}
async function boardPairGo() {
  const code = String(drafts.bdCode || '').replace(/\D/g, ''), name = Q.clean(drafts.bdName || '');
  if (code.length !== 6) return say(T('Mã gồm 6 số hiện trên màn hình lớp.', 'The code has 6 digits.'), 'bad');
  if (!name) return say(T('Đặt tên phòng cho màn hình.', 'Name the room.'), 'bad');
  boards.busy = true; render();
  try {
    const r = await call('ghep', { code, name }, 1);
    drafts.bdCode = '';
    say(T('Đã ghép ' + r.name + '. Màn hình sẽ tự vào trong vài giây.', 'Paired ' + r.name + '. The screen opens in a few seconds.'));
    boards.list = (await call('manhinh', {})).boards;
  } catch (e) { say(T('Chưa ghép được: ', 'Not paired: ') + e.message, 'bad'); }
  finally { boards.busy = false; render(); }
}
async function boardDrop(b) {
  if (!window.confirm(T('Gỡ ' + b.dataset.name + '? Màn hình đó sẽ phải ghép lại mới dùng được.', 'Remove ' + b.dataset.name + '?'))) return;
  try { boards.list = (await call('manhinhxoa', { id: b.dataset.id }, 1)).boards; render(); } catch (e) { say(e.message, 'bad'); }
}
document.addEventListener('click', e => {
  const b = e.target.closest('[data-act]');
  if (!b) return;
  const act = b.dataset.act;
  if (act === 'boardStart') boardStart();
  if (act === 'boardPairGo') boardPairGo();
  if (act === 'boardDrop') boardDrop(b);
  if (act === 'boardSite') { keep('boardSite', b.dataset.v); render(); }
  if (act === 'boardOpen') {
    const s = findSession(b.dataset.row, b.dataset.day);
    if (s && classOf(s)) boardOpenSession(s);
  }
});
let boardAutoOpen = null;
function boardOpenSession(s) {
  current = s; llMode = ''; llMenu = null; llWarn = null; view = 'lenlop';
  document.body.classList.add('lenlop'); render(); window.scrollTo(0, 0);
  guarded(() => Promise.all([loadMarks(true), loadTracker(classOf(s), true), loadBehave(true).catch(() => {})]));
}

/* ---------- Class screen as rows (owner 07/11 spec) ----------
 * One row per pupil: name (red ! past the limit) · − ⭐ n + · Mất trật tự · Mất tập trung · Cảnh cáo (reason box) · Nghỉ.
 * Ticks and warnings are saved in HANH_VI exactly as before; a tap on the name still opens the pupil's panel to take one off. */
const WARN_LIMIT = 3, TICKS = ['Mất trật tự', 'Mất tập trung'], CANH_CAO = 'Cảnh cáo';
BEHAVIOUR_EN[CANH_CAO] = 'Warning';
if (!BEHAVIOURS.includes(CANH_CAO)) BEHAVIOURS.push(CANH_CAO);
const REASONS = ['Nói chuyện riêng', 'Không làm theo yêu cầu', 'Quên sách vở', 'Nói tiếng Việt nhiều', 'Đi lại tự do'];
let llReason = null;
// IELTS / FIGHTER: reminders that fit teenagers, and one praise button that never counts towards a warning.
const PRAISE = 'Phát biểu tốt', TEEN_TICKS = ['Dùng điện thoại', 'Làm việc riêng', PRAISE];
Object.assign(BEHAVIOUR_EN, { 'Dùng điện thoại': 'Using phone', 'Làm việc riêng': 'Off task', [PRAISE]: 'Great answer' });
const ticksFor = s => tickSetOf(s);
const tickTotal = counts => Object.keys(counts).filter(t => t !== CANH_CAO && !NOT_COUNTED.includes(t)).reduce((n, t) => n + (counts[t] || 0), 0);

viewLenLop = function () {
  const ctx = classContext(current), s = ctx.session;
  if (!ctx.tracker) return '<div class="card empty">' + T('Đang đọc sheet lớp…', 'Reading the class sheet…') + '</div>';
  const can = canTeach(s), edit = can && llUnlocked(s), behave = behaveFor(s), dis = edit ? '' : ' disabled';
  const rows = ctx.tracker.pupils.map((p, i) => { const m = ctx.marks.get(p.name); return { p, i, stars: starsOf(ctx, p), off: !!m && (m.status === NGHI || Q.ABSENT.includes(m.status)), here: !!m && Q.PRESENT.includes(m.status), b: behave.get(p.name) }; });
  orderRows(rows, s);
  const scores = [...new Set(rows.filter(r => !r.off && r.stars).map(r => r.stars))].sort((a, b) => b - a), medal = ['🥇', '🥈', '🥉'];
  const unmarked = rows.filter(r => !r.off && !r.here).length, noStars = !ctx.tracker.blocks.length || (!!ctx.block && !(ctx.block.stars >= 0)), group = isGroup(s);
  const starOk = !noStars && ctx.block && ctx.block.stars >= 0, lateNow = Q.tickStatus(s, today(), minutesNow()) === 'Đến muộn';
  const podium = rows.filter(r => !r.off && r.stars && scores.indexOf(r.stars) < 3).sort((a, b) => b.stars - a.stars).slice(0, 5);
  let h = '<div class="ll-head"><button class="quiet" data-act="llExit" aria-label="' + T('Thoát', 'Exit') + '">‹</button><div class="ll-title"><b>' + esc(s.cls) + T(' · Tiết ', ' · Lesson ') + esc(s.lesson) + '</b><span>' + sessionTime(s) + ' · ' + rows.filter(r => r.here).length + '/' + rows.length + T(' có mặt', ' here') + '</span></div>' +
    (podium.length ? '<div class="ll-podium" aria-label="' + T('Dẫn đầu', 'Leaders') + '">' + podium.map(r => '<span>' + (medal[scores.indexOf(r.stars)] || '') + ' ' + esc(r.p.eng || r.p.name) + ' <b>' + r.stars + '</b></span>').join('') + '</div>' : '') +
    (edit && unmarked && !group ? '<button class="primary" data-act="llAll">' + T('Còn lại có mặt', 'Rest are here') + '</button>' : '') + lockBar(can, edit) + '</div>';
  // Owner 08/11: "buổi debate bỏ cái sao đi, hiển thị làm gì... logic chung nên là thế": a lesson without a star column shows no stars.
  if (noStars && !(ctx.problem && ctx.tracker.blocks.length)) h += '';
  else if (ctx.problem || !starOk) h += '<div class="notice">' + esc(columnWarning(ctx) || T('Tiết này chưa có cột Số sao trong sheet lớp, TA mở cột giúp.', 'This lesson has no star column yet, TA please open it.')) + '</div>';
  if (can && !edit) h += '<div class="small muted rv-hint">🔒 ' + T('Đang khoá để học sinh không bấm nhầm. Giáo viên giữ nút "Giữ để sửa" 1 giây để mở. Bấm mũi tên ▸ cạnh tên để xem 3 buổi trước.', 'Locked so pupils cannot change anything. Hold "Hold to edit" for a second. Tap ▸ to see the last 3 lessons.') + '</div>';
  else if (!edit) h += '<div class="notice">' + ([s.teacher, s.ta, s.video].some(n => Q.nameKey(n) === Q.nameKey(me.name)) && lessonClosed(s) ? T('Buổi học đã kết thúc quá ' + closeAfter(s) + ' phút nên đã khoá, không sửa được nữa. Cần sửa thì báo quản lí.', 'This lesson ended more than ' + CLOSE_AFTER + ' minutes ago and is locked. Ask a manager to change anything.') : T('Buổi này chưa mở hoặc không phân công cho bạn, chỉ xem được.', 'This session is not open or not assigned to you, view only.')) + '</div>';
  else h += '<div class="small muted rv-hint">' + T('Bấm Nghỉ cho bạn vắng, rồi "Còn lại có mặt". Nhắc quá ' + WARN_LIMIT + ' lần thì hiện dấu ! đỏ. Bấm nhầm: bấm dấu − ở góc nút để bớt.', 'Tap Absent for missing pupils, then "Rest are here". More than ' + WARN_LIMIT + ' reminders shows a red !. Mis-tap: tap the − in the corner of the button.') + '</div>';
  h += '<div class="rv-list" role="list">' + rows.map(r => {
    const rank = r.off || !r.stars ? 0 : scores.indexOf(r.stars) + 1, name = r.p.eng || r.p.name, counts = tagCounts(r.b ? r.b.tags : []), n = tickTotal(counts), over = n > WARN_LIMIT, warned = counts[CANH_CAO] || 0;
    const live = r.off ? ' disabled' : dis, badge = c => c ? '<span class="rv-badge">' + c + '</span>' : '';
    const histOpen = llHist.has(r.p.name);
    return '<div class="ll-tile rv-row' + (r.off ? ' off' : rank === 1 ? ' top' : '') + (r.here ? ' here' : '') + (over ? ' over' : '') + '" role="listitem" data-i="' + r.i + '">' +
      '<button class="rv-hist' + (histOpen ? ' on' : '') + '" data-act="llHist" data-i="' + r.i + '" aria-expanded="' + histOpen + '" aria-label="' + T('3 buổi trước của ', 'Last 3 lessons of ') + esc(name) + '">' + (histOpen ? '▾' : '▸') + '</button>' +
      '<button class="rv-name" data-act="llMenu" data-i="' + r.i + '" aria-label="' + T('Mở mục của ', 'Open ') + esc(name) + '">' + (rank ? '<span class="rv-rank">' + (medal[rank - 1] || '#' + rank) + '</span>' : '') +
        '<span class="ll-name">' + esc(name) + '</span>' + pupilFlags(ctx, r) + (over ? '<span class="rv-alert" title="' + T('Nhắc ', 'Reminded ') + n + T(' lần', ' times') + '" aria-label="' + T('Nhắc quá ' + WARN_LIMIT + ' lần', 'Over ' + WARN_LIMIT + ' reminders') + '">!</span>' : '') + '</button>' + gradeSeg(ctx, r, live) +
      (noStars ? '' : '<div class="rv-stars"><button class="rv-minus" data-act="llDown" data-i="' + r.i + '"' + (starOk && r.stars ? live : ' disabled') + ' aria-label="' + T('Bớt 1 sao của ', 'One star off ') + esc(name) + '">−</button>' +
        '<span class="ll-num rv-num" aria-label="' + r.stars + T(' sao', ' stars') + '">⭐ <b>' + r.stars + '</b></span>' +
        '<button class="ll-plus rv-plus" data-act="llStar" data-i="' + r.i + '"' + (starOk ? live : ' disabled') + ' aria-label="' + T('Thêm 1 sao cho ', 'Add a star for ') + esc(name) + '">+</button></div>') +
      ticksFor(s).map((t, k) => '<span class="rv-chip"><button class="rv-tick' + (t === PRAISE ? ' rv-praise' : '') + (counts[t] ? ' on' : '') + '" data-act="llTick" data-i="' + r.i + '" data-k="' + k + '" data-v="' + k + '"' + live + '>' + biText(t) + badge(counts[t]) + '</button>' + undoBtn(r, t, counts[t], live, name) + '</span>').join('') +
      '<span class="rv-chip"><button class="rv-warn' + (over ? ' hot' : '') + (warned ? ' on' : '') + '" data-act="llReason" data-i="' + r.i + '"' + live + '>⚠️ Cảnh cáo<small class="rv-en">Warning</small>' + badge(warned) + '</button>' + undoBtn(r, CANH_CAO, warned, live, name) + '</span>' +
      (group && !r.off ? '<button class="rv-here' + (r.here ? ' on' : '') + '" data-act="llHere" data-i="' + r.i + '"' + dis + ' aria-pressed="' + r.here + '">✓</button>' : '') +
      secButtons(ctx, r, live) +
      // Owner 09/11: "khi có hs đến tôi lại phải out ra màn điểm danh để điểm danh": a pupil not yet ticked (or marked absent) gets
      // one tap here; after the roll-call minutes it records "Đến muộn" with the minutes, like the roll call.
      (!group && !r.here && !secStatus(r) ? '<button class="rv-arrive" data-act="llArrive" data-i="' + r.i + '"' + (can ? '' : ' disabled') + '>🙋 ' + (lateNow ? T('Đến muộn', 'Late') + '<small class="rv-en">Arrived late</small>' : T('Có mặt', 'Here') + '<small class="rv-en">Here</small>') + '</button>' : '') +
      ((r.here && !r.off) || r.off || secStatus(r) ? '' : '<button class="rv-off" data-act="llOff" data-i="' + r.i + '"' + dis + ' aria-pressed="false">Nghỉ<small class="rv-en">Absent</small></button>') +
      (r.off ? '<span class="rv-offtag">' + T('Đang ghi nghỉ', 'Marked absent') + '</span>' : '') +
      (histOpen ? histBox(ctx, r) : '') + '</div>';
  }).join('') + '</div>';
  const open = llReason != null ? rows.find(r => r.i === llReason) : null;
  const gOpen = llGradeBox != null ? rows.find(r => r.i === llGradeBox) : null;
  if (gOpen) h += gradeBox(ctx, gOpen, edit);
  else if (open) h += reasonBox(open, edit);
  else if (llMenu != null) h += llSheet(ctx, rows.find(r => r.i === llMenu), edit, noStars);
  return h;
};

// The warning box: an optional reason (typed, or one tap on a common one), then one big button.
function reasonBox(r, edit) {
  const name = r.p.eng || r.p.name, dis = edit ? '' : ' disabled', counts = tagCounts(r.b ? r.b.tags : []), n = tickTotal(counts), draft = drafts['llreason:' + r.p.name] || '';
  return '<div class="ll-veil" data-act="llClose"></div><div class="ll-sheet rv-box" role="dialog" aria-label="' + T('Cảnh cáo ', 'Warn ') + esc(name) + '">' +
    '<div class="row-top"><b class="ll-sheet-name">⚠️ ' + T('Cảnh cáo', 'Warning') + ' · ' + esc(name) + '</b><span class="spacer"></span><button class="quiet" data-act="llClose">' + T('Đóng', 'Close') + '</button></div>' +
    (n ? '<div class="small' + (n > WARN_LIMIT ? ' rv-over-note' : ' muted') + '">' + T('Đã nhắc ', 'Reminded ') + n + T(' lần trong buổi', ' times this lesson') + (n > WARN_LIMIT ? T(' (quá ' + WARN_LIMIT + ' lần)', ' (over ' + WARN_LIMIT + ')') : '') + '</div>' : '') +
    '<div class="ll-chips">' + REASONS.map(t => '<button class="' + (draft === t ? 'on' : '') + '" data-act="llReasonPick" data-i="' + r.i + '" data-v="' + esc(t) + '"' + dis + '>' + biText(t) + '</button>').join('') + '</div>' +
    '<textarea data-act="llReasonText" data-name="' + esc(r.p.name) + '" rows="2" maxlength="200" placeholder="' + T('Lý do (không bắt buộc)…', 'Reason (optional)…') + '"' + dis + '>' + esc(draft) + '</textarea>' +
    '<div class="ll-sheet-row"><button class="rv-give" data-act="llWarnGive" data-i="' + r.i + '"' + dis + '>⚠️ ' + T('Ghi cảnh cáo', 'Give warning') + '</button></div></div>';
}

/* Star motion. Up: a gold star rises from + and melts into the count. Down: the star turns red, shatters and the pieces fall. */
const rvMotion = () => !!document.body.animate && !reduceMotion();
const rvAt = el => { const r = el.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; };
const rvNum = i => document.querySelector('.rv-row[data-i="' + i + '"] .rv-num');
function rvBit(cls, text, x, y) {
  const d = document.createElement('div');
  d.className = cls; if (text) d.textContent = text;
  d.style.left = x + 'px'; d.style.top = y + 'px';
  document.body.appendChild(d);
  return d;
}
function starUp(i) {
  const from = document.querySelector('.rv-plus[data-i="' + i + '"]'), num = rvNum(i);
  if (!from || !num || !rvMotion()) return;
  const a = rvAt(from), b = rvAt(num), dx = b.x - a.x, dy = b.y - a.y, star = rvBit('rv-fly', '⭐', a.x, a.y);
  star.animate([
    { transform: 'translate(-50%,-50%) scale(.5)', opacity: 0 },
    { transform: 'translate(calc(-50% + ' + dx * 0.4 + 'px), calc(-50% - 95px)) scale(2) rotate(200deg)', opacity: 1, offset: 0.5 },
    { transform: 'translate(calc(-50% + ' + dx + 'px), calc(-50% + ' + dy + 'px)) scale(.3) rotate(360deg)', opacity: 0.3 }
  ], { duration: 800, easing: 'cubic-bezier(.3,.7,.4,1)' }).onfinish = () => {
    star.remove();
    const n = rvNum(i), row = document.querySelector('.rv-row[data-i="' + i + '"]');
    if (n) n.animate([{ transform: 'scale(1)' }, { transform: 'scale(1.6)', textShadow: '0 0 18px rgba(245,183,0,.95)' }, { transform: 'scale(1)' }], { duration: 480, easing: 'ease-out' });
    if (row) row.animate([{ boxShadow: '0 0 0 0 rgba(245,183,0,.7)' }, { boxShadow: '0 0 0 14px rgba(245,183,0,0)' }], { duration: 600 });
    for (let k = 0; k < 8; k++) {
      const ang = k / 8 * Math.PI * 2, r = 30 + Math.random() * 16, sp = rvBit('fly-spark', k % 2 ? '✦' : '✨', b.x, b.y);
      sp.animate([{ transform: 'translate(-50%,-50%) scale(.4)', opacity: 1 }, { transform: 'translate(calc(-50% + ' + Math.cos(ang) * r + 'px), calc(-50% + ' + Math.sin(ang) * r + 'px)) scale(1)', opacity: 0 }], { duration: 520, easing: 'ease-out' }).onfinish = () => sp.remove();
    }
    const plus = rvBit('fly-plus', '+1', b.x + 30, b.y);
    plus.animate([{ transform: 'translate(-50%,-50%)', opacity: 1 }, { transform: 'translate(-50%,-170%)', opacity: 0 }], { duration: 800, easing: 'ease-out' }).onfinish = () => plus.remove();
  };
}
function starDown(i) {
  const num = rvNum(i);
  if (!num || !rvMotion()) return;
  const c = rvAt(num), star = rvBit('rv-fly rv-red', '★', c.x - 14, c.y);
  num.animate([{ transform: 'translateX(0)' }, { transform: 'translateX(-7px)' }, { transform: 'translateX(7px)' }, { transform: 'translateX(-4px)' }, { transform: 'translateX(0)' }], { duration: 360 });
  star.animate([
    { transform: 'translate(-50%,-50%) scale(1)', color: '#f5b700' },
    { transform: 'translate(-50%,-50%) scale(1.8) rotate(-14deg)', color: '#dc2626', offset: 0.55 },
    { transform: 'translate(-50%,-50%) scale(2) rotate(10deg)', color: '#b91c1c' }
  ], { duration: 360, easing: 'ease-out' }).onfinish = () => {
    star.remove();
    for (let k = 0; k < 10; k++) {
      const ang = k / 10 * Math.PI * 2 + Math.random() * 0.4, r = 38 + Math.random() * 30, sx = Math.cos(ang) * r, sy = Math.sin(ang) * r, fall = 130 + Math.random() * 90, spin = (Math.random() * 2 - 1) * 600;
      const s = rvBit('rv-shard', '', c.x - 14, c.y);
      s.animate([
        { transform: 'translate(-50%,-50%) rotate(0deg)', opacity: 1, easing: 'ease-out' },
        { transform: 'translate(calc(-50% + ' + sx + 'px), calc(-50% + ' + sy + 'px)) rotate(' + spin / 3 + 'deg)', opacity: 1, offset: 0.3, easing: 'ease-in' },
        { transform: 'translate(calc(-50% + ' + sx * 1.4 + 'px), calc(-50% + ' + (sy + fall) + 'px)) rotate(' + spin + 'deg) scale(.6)', opacity: 0 }
      ], { duration: 950 }).onfinish = () => s.remove();
    }
    const minus = rvBit('rv-minus-fly', '−1', c.x + 30, c.y);
    minus.animate([{ transform: 'translate(-50%,-50%)', opacity: 1 }, { transform: 'translate(-50%, 60%)', opacity: 0 }], { duration: 850, easing: 'ease-in' }).onfinish = () => minus.remove();
  };
}
// A reminder tick: its badge pops; the tick that goes past the limit shakes the row so the class sees it.
function tickPop(i, k, crossed) {
  if (crossed) return shakeTile(i);
  if (!rvMotion()) return;
  const b = document.querySelector('.rv-row[data-i="' + i + '"] .rv-tick[data-k="' + k + '"] .rv-badge'), row = document.querySelector('.rv-row[data-i="' + i + '"]');
  if (b) b.animate([{ transform: 'scale(1)' }, { transform: 'scale(1.8)' }, { transform: 'scale(1)' }], { duration: 380, easing: 'ease-out' });
  if (row) row.animate([{ boxShadow: '0 0 0 0 rgba(245,158,11,.7)' }, { boxShadow: '0 0 0 12px rgba(245,158,11,0)' }], { duration: 550 });
}

const llActionBeforeRows = llAction;
llAction = function (act, i, v) {
  if (act === 'llClose' || act === 'llExit') llReason = null;
  if (!['llTick', 'llDown', 'llStar', 'llReason', 'llReasonPick', 'llWarnGive'].includes(act)) return llActionBeforeRows(act, i, v);
  const ctx = classContext(current), pupil = i != null && ctx.tracker ? ctx.tracker.pupils[Number(i)] : null;
  if (!pupil || !canTeach(ctx.session)) return;
  if (act === 'llStar' || act === 'llDown') {
    const was = starsOf(ctx, pupil);
    if (act === 'llDown' && !was) return;
    setStars(ctx, pupil, was + (act === 'llStar' ? 1 : -1));
    const moved = starsOf(ctx, pupil) !== was;
    render();
    if (moved) (act === 'llStar' ? starUp : starDown)(i);
    return;
  }
  if (act === 'llReason') { llMenu = null; llWarn = null; llReason = Number(i); render(); return; }
  if (act === 'llReasonPick') { const k = 'llreason:' + pupil.name; drafts[k] = drafts[k] === v ? '' : v; render(); return; }
  const old = behaveFor(ctx.session).get(pupil.name), tags = old ? old.tags.slice() : [], note = old ? old.note : '';
  const hereNow = () => { const m = ctx.marks.get(pupil.name); if (!(m && (Q.PRESENT.includes(m.status) || m.status === NGHI || Q.ABSENT.includes(m.status)))) appendMark(ctx.session, pupil, Q.tickStatus(ctx.session, today(), minutesNow()), m && m.contact, '', STAR_WAIT); };
  if (act === 'llTick') {
    const t = ticksFor(ctx.session)[Number(v)];
    if (!t) return;
    const before = tickTotal(tagCounts(tags));
    tags.push(t); setBehave(ctx, pupil, tags, note); hereNow();
    render(); tickPop(i, v, before <= WARN_LIMIT && before + 1 > WARN_LIMIT);
    return;
  }
  if (act === 'llWarnGive') {
    const key = 'llreason:' + pupil.name, why = Q.clean(drafts[key] || '');
    delete drafts[key];
    tags.push(CANH_CAO);
    setBehave(ctx, pupil, tags, why ? (Q.clean(note) ? Q.clean(note) + '; ' : '') + T('Cảnh cáo: ', 'Warning: ') + why : note);
    hereNow();
    llReason = null; render(); shakeTile(i);
    say(T('Đã ghi cảnh cáo cho ', 'Warning saved for ') + (pupil.eng || pupil.name) + '.');
  }
};
document.addEventListener('input', e => {
  const b = e.target.closest('[data-act="llReasonText"]');
  if (b) drafts['llreason:' + b.dataset.name] = b.value;
});

/* ---------- Teachers are marked once per buổi (owner 07/11: "mỗi buổi chỉ 1 lần với giáo viên", the 10-minute rule stays) ----------
 * A teacher's classes on one day form one buổi while the next class starts within BUOI_GAP minutes of the last one ending.
 * The buổi is marked on its first class, due 10 minutes before that class (Q.staffOf already gives start − 10). TAs and video stay per class. */
const BUOI_GAP = 60;
function staffRowsOfDay(sessions) {
  const rows = [], byTeacher = new Map();
  sessions.slice().sort((a, b) => a.start - b.start).forEach(s => Q.staffOf(s).forEach(p => {
    const r = { s, p, k: staffKey({ day: s.day, cls: s.cls, time: Q.clock(s.start), person: p.name }), more: [] };
    if (p.role !== 'GV') return rows.push(r);
    const k = Q.nameKey(p.name), last = byTeacher.get(k);
    if (last && s.start - last.end <= BUOI_GAP) { last.row.more.push(s); last.end = Math.max(last.end, s.end); return; }
    byTeacher.set(k, { row: r, end: s.end });
    rows.push(r);
  }));
  return rows;
}
staffPanel = function (week) {
  if (!week) return dayBar() + '<div class="card empty">File Schedule chưa có tuần này.</div>';
  const sessions = week.data.sessions.filter(s => s.day === day && !s.off), sites = [...new Set(sessions.map(s => s.site).filter(Boolean))].sort(), latest = staffLatest();
  const rows = staffRowsOfDay(sessions);
  const names = [...new Set(rows.map(r => r.p.name))].sort((a, b) => a.localeCompare(b, 'vi'));
  const atSite = r => !filters.site || [r.s].concat(r.more).some(s => s.site === filters.site);
  const shown = rows.filter(r => atSite(r) && (!filters.person || r.p.name === filters.person)).sort((a, b) => a.p.due - b.p.due || a.p.name.localeCompare(b.p.name, 'vi'));
  const blank = shown.filter(r => { const o = latest.get(r.k); return !o || o.status === 'Bỏ chấm'; }).length;
  const overdue = day === today() ? shown.filter(r => { const o = latest.get(r.k); return (!o || o.status === 'Bỏ chấm') && r.p.due <= minutesNow(); }).length : 0;
  let h = dayBar() + '<div class="filters"><select data-act="filter" data-k="site"><option value="">Mọi cơ sở, phòng</option>' + sites.map(x => '<option' + (x === filters.site ? ' selected' : '') + '>' + esc(x) + '</option>').join('') + '</select>' +
    '<select data-act="filter" data-k="person"><option value="">Mọi người</option>' + names.map(x => '<option' + (x === filters.person ? ' selected' : '') + '>' + esc(x) + '</option>').join('') + '</select></div>' +
    '<div class="count"><span>' + (shown.length - blank) + '/' + shown.length + ' lượt đã chấm</span>' + (overdue ? '<span class="tag bad">' + overdue + ' lượt đến giờ chưa chấm</span>' : '') + '</div>' +
    '<div class="small muted">Giáo viên chấm 1 lần mỗi buổi, theo lớp đầu tiên của buổi (có mặt trước 10 phút). TA và quay video vẫn chấm theo từng lớp.</div>';
  if (!shown.length) return h + '<div class="card empty">Không có ca nào.</div>';
  return h + '<div class="list">' + shown.map(r => {
    const o = latest.get(r.k), status = o && o.status !== 'Bỏ chấm' ? o.status : '', cls = v => (status === v ? 'on ' : '');
    const what = r.more.length ? '<b>Buổi ' + (r.more.length + 1) + ' lớp</b> · ' + [r.s].concat(r.more).map(s => esc(s.cls) + ' ' + sessionTime(s)).join(', ') : esc(r.s.cls) + ' · ' + sessionTime(r.s);
    return '<div class="card row"><div class="row-top"><b>' + esc(r.p.name) + '</b><span class="tag">' + esc(r.p.role) + '</span><span class="muted">' + what + '</span><span class="spacer"></span><span class="room small">' + esc(r.s.site) + '</span></div>' +
      '<div class="small muted">Phải có mặt trước ' + Q.clock(r.p.due) + (o && o.by ? ' · Chấm lúc ' + esc(String(o.at).slice(-8, -3)) : '') + '</div>' +
      '<div class="choices" data-k="' + esc(r.k) + '"><button class="' + cls('Đúng giờ') + 'good" data-act="staff" data-v="Đúng giờ" data-row="' + r.s.row + '" data-p="' + esc(r.p.name) + '">Đúng giờ</button><button class="' + cls('Muộn') + 'mid" data-act="staff" data-v="Muộn" data-row="' + r.s.row + '" data-p="' + esc(r.p.name) + '">Muộn</button><button class="' + cls('Vắng') + 'low" data-act="staff" data-v="Vắng" data-row="' + r.s.row + '" data-p="' + esc(r.p.name) + '">Vắng</button>' +
      (status === 'Muộn' ? '<input type="number" min="0" inputmode="numeric" placeholder="Phút" aria-label="Số phút muộn" data-act="staffField" data-field="minutes" data-row="' + r.s.row + '" data-p="' + esc(r.p.name) + '" value="' + esc(o.minutes) + '">' : '') +
      (status ? '<input type="text" placeholder="Ghi chú" aria-label="Ghi chú" data-act="staffField" data-field="note" data-row="' + r.s.row + '" data-p="' + esc(r.p.name) + '" value="' + esc(o.note) + '">' : '') + '</div></div>';
  }).join('') + '</div>';
};

/* ---------- Lesson report deadline (owner 07/11: the homeroom reports every lesson of their class, due the day after the lesson) ----------
 * KIDS classes only: their sheets have the "Nhận xét buổi học" report on the BÁO CÁO tab (same tab id in every KIDS sheet).
 * The homeroom makes the report there, sends it, then taps "Đã report" here; the tap is a row in BAO_CAO_TIET.
 * Counting starts with lessons on REPORT_START, so older lessons are never shown as overdue. */
const REPORT_START = '2026-11-07', REPORT_GID = 21002610, REPORT_DONE = 'Đã report', REPORT_UNDO = 'Bỏ report';
const reportCm = s => /^KIDS\s*\d+$/i.test(Q.clean(s.cls)) ? homeroom[Q.key(s.cls)] || '' : '';
const reportLink = s => { const c = classOf(s); return c && c.tracker ? 'https://docs.google.com/spreadsheets/d/' + encodeURIComponent(c.tracker) + '/edit#gid=' + REPORT_GID : ''; };
const rp = { tried: 0, loading: false };
function ensureReportData(force) {
  if (rp.loading || (!force && Date.now() - rp.tried < 60000)) return;
  rp.tried = Date.now(); rp.loading = true;
  Promise.all([loadReports(force), weekOf(today()), weekOf(Q.addDays(today(), -7)), loadHomeroom()].map(p => Promise.resolve(p).catch(() => null)))
    .finally(() => { rp.loading = false; render(); });
}
// One line per lesson that needs a report; who: '' = everyone (managers), else only that homeroom.
function reportItems(who) {
  const t = today(), now = minutesNow(), seen = new Set(), out = [];
  const rows = reports.rows || [];
  Object.values(weeks).forEach(w => (w.data.sessions || []).forEach(s => {
    if (s.off || isGroup(s) || s.day < REPORT_START || s.day > t || (s.day === t && s.end > now)) return;
    const cm = reportCm(s);
    if (!cm || (who && !sameName(cm, who))) return;
    const k = Q.sessionKey(s);
    if (seen.has(k)) return;
    seen.add(k);
    const mine = rows.filter(r => r.day === s.day && Q.key(r.cls) === Q.key(s.cls) && String(r.lesson) === String(s.lesson));
    const last = mine[mine.length - 1], done = last && Q.clean(last.text) !== REPORT_UNDO ? mine.find(r => Q.clean(r.text) !== REPORT_UNDO) : null;
    const due = Q.addDays(s.day, 1), doneDay = done ? viToIso(done.at) : '';
    const state = done ? (doneDay && doneDay > due ? 'late' : 'ok') : t > due ? 'over' : t === due ? 'today' : 'soon';
    out.push({ s, cm, due, done, state, k, days: t > due ? Math.round((new Date(t + 'T12:00:00') - new Date(due + 'T12:00:00')) / 86400000) : 0 });
  }));
  const rank = { over: 0, today: 1, soon: 2, late: 3, ok: 4 };
  return out.sort((a, b) => rank[a.state] - rank[b.state] || (a.s.day + Q.clock(a.s.start)).localeCompare(b.s.day + Q.clock(b.s.start)));
}
const canReport = x => isManager() || isMe(x.cm);
function reportChip(x) {
  if (x.state === 'ok') return '<span class="tag ok">✓ ' + T('Đã report ', 'Reported ') + esc(String(x.done.at).slice(0, 5) + ' ' + String(x.done.at).slice(11, 16)) + '</span>';
  if (x.state === 'late') return '<span class="tag warn">' + T('Report muộn ', 'Late ') + esc(String(x.done.at).slice(0, 5)) + '</span>';
  if (x.state === 'over') return '<span class="tag bad">' + T('Quá hạn ', 'Overdue ') + x.days + T(' ngày', ' d') + ' (' + T('hạn ', 'due ') + esc(viDate(x.due).slice(0, 5)) + ')</span>';
  if (x.state === 'today') return '<span class="tag warn">' + T('Hạn hôm nay, trước 23:59', 'Due today by 23:59') + '</span>';
  return '<span class="tag">' + T('Hạn ', 'Due ') + esc(dayLabel(x.due)) + '</span>';
}
function reportRow(x, showCm) {
  const s = x.s, link = reportLink(s), open = x.state !== 'ok' && x.state !== 'late';
  return '<div class="rp-row ' + x.state + '"><div class="rp-what"><b>' + esc(s.cls) + T(' · Tiết ', ' · Lesson ') + esc(s.lesson) + '</b><span class="small muted">' + esc(dayLabel(s.day)) + ' ' + Q.clock(s.start) + (showCm ? ' · CN ' + esc(x.cm) : '') + (x.done && x.done.by ? ' · ' + esc(x.done.by) : '') + '</span></div>' + reportChip(x) +
    '<span class="spacer"></span>' + rpChotBtn(s) + (link && open ? '<a class="btn quiet" href="' + esc(link) + '" target="_blank" rel="noopener">' + T('Mở BÁO CÁO', 'Open report tab') + '</a>' : '') +
    (canReport(x) ? (open ? '<button class="good" data-act="rpDone" data-k="' + esc(x.k) + '">' + T('Đã report ✓', 'Mark reported') + '</button>' : '<button class="quiet small" data-act="rpUndo" data-k="' + esc(x.k) + '">' + T('Bỏ', 'Undo') + '</button>') : '') + '</div>';
}
function reportSection() {
  ensureReportData();
  const all = reportItems(isManager() ? '' : me.name), head = '<div class="part p-1"><h2>' + T('Report tiết học', 'Lesson reports') + '</h2><span>' + T('Hạn: hết ngày hôm sau ngày học', 'Due: end of the day after the lesson') + '</span></div>';
  const how = '<details class="small muted how"><summary>' + T('Cách làm', 'How') + '</summary>' + T('Mở tab BÁO CÁO của lớp, chọn "Nhận xét buổi học", điền ngày học, dán nhận xét GV, tick B8, gửi phụ huynh, rồi bấm "Đã report ✓" ở đây.', 'Open the class BÁO CÁO tab, make the lesson report, send it, then tap "Mark reported".') + '</details>';
  if (!reports.rows) return head + '<div class="card empty">' + T('Đang đọc…', 'Reading…') + '</div>';
  if (!all.length) return head + how + '<div class="card empty">' + T('Chưa có tiết nào cần report (tính từ ' + viDate(REPORT_START) + ').', 'No lesson to report yet.') + '</div>';
  const recent = all.filter(x => x.state !== 'ok' || x.s.day >= Q.addDays(today(), -3)), older = all.filter(x => !recent.includes(x));
  const count = st => all.filter(x => x.state === st).length;
  let h = head + how + '<div class="count">' + (count('over') ? '<span class="tag bad">' + count('over') + T(' quá hạn', ' overdue') + '</span>' : '') + (count('today') ? '<span class="tag warn">' + count('today') + T(' hạn hôm nay', ' due today') + '</span>' : '') + (count('soon') ? '<span class="tag">' + count('soon') + T(' hạn mai', ' due tomorrow') + '</span>' : '') + '<span class="tag ok">' + (count('ok') + count('late')) + T(' đã report', ' reported') + '</span></div>';
  if (isManager()) {
    const by = new Map();
    recent.forEach(x => { const k = Q.key(x.cm); if (!by.has(k)) by.set(k, { cm: x.cm, list: [] }); by.get(k).list.push(x); });
    h += [...by.values()].sort((a, b) => b.list.filter(x => x.state === 'over').length - a.list.filter(x => x.state === 'over').length || a.cm.localeCompare(b.cm, 'vi')).map(g => {
      const over = g.list.filter(x => x.state === 'over').length;
      return '<div class="card row"><div class="row-top"><b>' + esc(g.cm) + '</b>' + (over ? '<span class="tag bad">' + over + T(' quá hạn', ' overdue') + '</span>' : '<span class="tag ok">' + T('Đúng hạn', 'On time') + '</span>') + '</div>' + g.list.map(x => reportRow(x, false)).join('') + '</div>';
    }).join('');
  } else h += '<div class="card row">' + recent.map(x => reportRow(x, false)).join('') + '</div>';
  if (older.length) h += '<details class="done-list"><summary>' + T('Đã report', 'Reported') + ' (' + older.length + ')</summary><div class="list"><div class="card row">' + older.map(x => reportRow(x, isManager())).join('') + '</div></div></details>';
  return h;
}
function reportTick(k, undo) {
  const x = reportItems('').find(y => y.k === k);
  if (!x || !canReport(x)) return;
  const row = [stamp(), x.s.day, x.s.cls, String(x.s.lesson), undo ? REPORT_UNDO : REPORT_DONE, me.name];
  reports.rows = reports.rows || [];
  reports.rows.push({ at: row[0], day: row[1], cls: row[2], lesson: row[3], text: row[4], by: row[5] });
  queue({ kind: 'append', file: CONFIG.quanLiId, tab: 'BAO_CAO_TIET', row });
  render();
  if (!undo) say(T('Đã ghi report ', 'Reported ') + x.s.cls + T(' tiết ', ' lesson ') + x.s.lesson + '.');
}
const isCm = () => !!me && Object.values(homeroom).some(n => isMe(n));

/* ---------- Report ↔ bảng chốt (owner 12/11: "học xong chốt buổi thì khi chủ nhiệm report lớp... nối được cái ảnh chốt sang đấy
 * để chủ nhiệm có vào luôn lúc chốt, lúc báo cáo, lúc report") ----------
 * Every lesson waiting for a report gets a "📸 Bảng chốt" button that opens that lesson's summary sheet straight away. On the sheet
 * the homeroom teacher finds the report tools (open the BÁO CÁO tab, "Đã report ✓") and a way back to the report list. */
const rpBack = { key: '', view: '' };
// "💾 Lưu ảnh": the white sheet becomes a PNG named after the class, lesson and day. On a phone it opens the share menu (Zalo…);
// elsewhere it downloads. The picture library is loaded only the first time someone taps the button.
let h2cLoad = null;
const loadH2c = () => window.html2canvas ? Promise.resolve() : h2cLoad || (h2cLoad = new Promise((ok, bad) => { const sc = document.createElement('script'); sc.src = 'html2canvas.min.js?v=1.4.1'; sc.onload = ok; sc.onerror = () => { h2cLoad = null; bad(new Error('load')); }; document.head.appendChild(sc); }));
let sumSaving = false;
async function sumSave(btn) {
  const el = document.querySelector('.sum-sheet'), s = current;
  if (!el || !s || sumSaving) return;
  sumSaving = true; const label = btn.innerHTML; btn.disabled = true; btn.innerHTML = '⏳ ' + T('Đang tạo ảnh…', 'Making image…');
  try {
    await loadH2c();
    const canvas = await window.html2canvas(el, { scale: Math.min(3, Math.max(2, window.devicePixelRatio || 1)), backgroundColor: '#ffffff', useCORS: true, logging: false,
      // Square corners, no shadow, and plain digits: the picture library spaces "11/11" and "17:30" oddly with the app's number style.
      onclone: d => { const st = d.createElement('style'); st.textContent = '.sum-sheet{box-shadow:none!important;border-radius:0!important;margin:0!important}.sum-sheet,.sum-sheet *{font-variant-numeric:normal!important;font-feature-settings:normal!important;font-variant-ligatures:none!important}'; d.head.appendChild(st); } });
    const blob = await new Promise(r => canvas.toBlob(r, 'image/png'));
    if (!blob) throw new Error('blob');
    const name = (Q.clean(s.cls) + ' Tiet ' + s.lesson + ' ' + s.day).normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/g, 'd').replace(/Đ/g, 'D').replace(/[^\w.-]+/g, '_') + '.png';
    const file = new File([blob], name, { type: 'image/png' });
    if (navigator.canShare && navigator.canShare({ files: [file] }) && /Android|iPhone|iPad|iPod/i.test(navigator.userAgent)) {
      try { await navigator.share({ files: [file], title: s.cls + ' · Tiết ' + s.lesson }); say(T('Đã mở chia sẻ ảnh bảng chốt.', 'Share opened.')); return; } catch (e) { if (e && e.name === 'AbortError') return; }
    }
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 10000);
    say(T('Đã lưu ảnh bảng chốt: ', 'Saved: ') + name);
  } catch (e) { say(T('Không tạo được ảnh, vui lòng chụp màn hình phần khung trắng.', 'Could not make the image; please take a screenshot.'), 'bad'); }
  finally { sumSaving = false; btn.disabled = false; btn.innerHTML = label; }
}
document.addEventListener('click', e => { const b = e.target.closest && e.target.closest('[data-act="sumSave"]'); if (b) { e.stopImmediatePropagation(); sumSave(b); } }, true);
const rpChotBtn = s => lessonEnded(s) && classOf(s) ? '<button class="quiet" data-act="rpChot" data-row="' + s.row + '" data-day="' + esc(s.day) + '">📸 ' + T('Bảng chốt', 'Summary') + '</button>' : '';
function rpChotBar(s) {
  if (rpBack.key !== Q.sessionKey(s)) return '';
  const x = reportItems('').find(y => y.k === rpBack.key), link = reportLink(s), open = x && x.state !== 'ok' && x.state !== 'late';
  return '<div class="sum-bar rp-chot"><button class="quiet" data-act="rpChotBack">‹ ' + T('Về danh sách report', 'Back to reports') + '</button>' + (x ? reportChip(x) : '') + '<span class="spacer"></span>' +
    (link ? '<a class="btn quiet" href="' + esc(link) + '" target="_blank" rel="noopener">' + T('Mở BÁO CÁO', 'Open report tab') + '</a>' : '') +
    (x && canReport(x) && open ? '<button class="good" data-act="rpDone" data-k="' + esc(x.k) + '">' + T('Đã report ✓', 'Mark reported') + '</button>' : '') + '</div>';
}
function rpChotOpen(s) {
  rpBack.key = Q.sessionKey(s); rpBack.view = view;
  current = s; llMode = ''; llMenu = null; llWarn = null; llSummary = { key: rpBack.key, mode: true }; view = 'lenlop';
  document.body.classList.add('lenlop'); render(); window.scrollTo(0, 0);
  guarded(() => Promise.all([loadMarks(true), loadTracker(classOf(s), true), loadBehave(true).catch(() => {})]));
}
function rpChotBack() {
  const to = rpBack.view && rpBack.view !== 'lenlop' ? rpBack.view : 'lopcn';
  rpBack.key = ''; rpBack.view = ''; current = null; llMenu = null; llWarn = null; llMode = ''; llGradeBox = null;
  view = to; document.body.classList.remove('lenlop'); flush(); render(); window.scrollTo(0, 0);
}
document.addEventListener('click', e => {
  const b = e.target.closest && e.target.closest('[data-act]');
  if (!b) return;
  const act = b.dataset.act;
  if (act === 'rpChot') { e.stopImmediatePropagation(); const s = findSession(b.dataset.row, b.dataset.day); if (s && classOf(s)) rpChotOpen(s); else say(T('Không tìm thấy buổi học này trong lịch.', 'Lesson not found.'), 'bad'); return; }
  if (act === 'rpChotBack') { e.stopImmediatePropagation(); rpChotBack(); return; }
  // Leaving a lesson opened from the report list goes back to that list, not to the class page.
  if (act === 'llExit' && rpBack.key && current && Q.sessionKey(current) === rpBack.key) { e.stopImmediatePropagation(); rpChotBack(); }
}, true);
// Homeroom page: lesson reports first, then the web homework still owed.
const viewHomeroomsBeforeRp = viewHomerooms;
viewHomerooms = function () {
  const owed = viewHomeroomsBeforeRp().replace('<h2>' + T('Lớp chủ nhiệm', 'Homeroom classes') + '</h2>', '<div class="part p-2"><h2>' + T('Bài web học sinh còn nợ', 'Web homework still owed') + '</h2></div>');
  return '<h2>' + T('Lớp chủ nhiệm', 'Homeroom classes') + '</h2>' + (isManager() || isCm() ? reportSection() : '') + owed;
};
// The bell: my lessons to report; the owner and managers also see overdue ones across homerooms.
const bellItemsBeforeRp = bellItems;
bellItems = function () {
  const out = bellItemsBeforeRp();
  try {
    if (!me || isBoard() || !reports.rows) return out;
    const mine = isCm() ? reportItems(me.name).filter(x => x.state === 'over' || x.state === 'today') : [];
    if (mine.length) { const over = mine.filter(x => x.state === 'over').length; out.push({ k: 'rp', icon: '📝', text: mine.length + T(' tiết cần report', ' lessons to report') + (over ? T(' · ' + over + ' quá hạn', ' · ' + over + ' overdue') : T(' (hạn hôm nay)', ' (due today)')), n: mine.length, hot: over > 0 || minutesNow() >= 20 * 60, go: { view: 'lopcn' } }); }
    if (isManager()) { const others = reportItems('').filter(x => x.state === 'over' && !isMe(x.cm)).length; if (others) out.push({ k: 'rpall', icon: '📝', text: others + T(' tiết chủ nhiệm quá hạn report', ' homeroom reports overdue'), n: others, hot: false, go: { view: 'lopcn' } }); }
  } catch (e) {}
  return out;
};
setInterval(() => { if (me && !isBoard() && (isCm() || isManager())) ensureReportData(true); }, 300000);
setTimeout(() => { if (me && !isBoard() && (isCm() || isManager())) ensureReportData(); }, 6000);

/* ---------- "Việc cần làm" on the schedule page (owner 07/11: the homeroom and TA layout must be clear) ----------
 * One list at the top of today: everything that needs me, with its deadline and a button to the place. The tabs below stay for detail. */
function todoCard() {
  if (!me || isBoard() || day !== today()) return '';
  const items = bellItems().map((x, i) => Object.assign({ i }, x)).filter(x => !['in', 'inno', 'out', 'rp'].includes(x.k));
  const reps = isCm() && reports.rows ? reportItems(me.name).filter(x => x.state === 'over' || x.state === 'today' || x.state === 'soon') : [];
  if (!items.length && !reps.length) return '<div class="card row todo empty-todo"><b>✅ ' + T('Việc cần làm hôm nay', 'To do today') + '</b><span class="small muted">' + T('Chưa có việc nào cần bạn.', 'Nothing needs you right now.') + '</span></div>';
  return '<div class="card row todo"><div class="row-top"><b>✅ ' + T('Việc cần làm hôm nay', 'To do today') + '</b><span class="small muted">' + (items.length + reps.length) + T(' việc', ' items') + '</span></div>' +
    reps.map(x => '<div class="todo-item' + (x.state === 'over' ? ' hot' : '') + '"><span class="ico">📝</span><span class="txt">' + T('Report ', 'Report ') + esc(x.s.cls) + T(' tiết ', ' lesson ') + esc(x.s.lesson) + ' <span class="muted">(' + esc(viDate(x.s.day).slice(0, 5)) + ')</span></span>' + reportChip(x) +
      rpChotBtn(x.s) + (reportLink(x.s) ? '<a class="btn quiet" href="' + esc(reportLink(x.s)) + '" target="_blank" rel="noopener">' + T('Mở BÁO CÁO', 'Open') + '</a>' : '') + '<button class="good" data-act="rpDone" data-k="' + esc(x.k) + '">' + T('Đã report ✓', 'Done') + '</button></div>').join('') +
    items.map(x => '<div class="todo-item' + (x.hot ? ' hot' : '') + '"><span class="ico">' + x.icon + '</span><span class="txt">' + esc(x.text) + '</span>' + (x.hot ? '<span class="tag bad">' + T('Làm ngay', 'Now') + '</span>' : '') + '<button class="quiet" data-act="bellGo" data-i="' + x.i + '">' + T('Mở ›', 'Open ›') + '</button></div>').join('') + '</div>';
}
const checkinBlockBeforeTodo = checkinBlock;
let dvTodoOpen = false;
checkinBlock = function (week) {
  const pic = typeof dayVisual === 'function' ? dayVisual(week) : '';
  const list = dvTodoOpen ? qaDialog(dvTodoOpen) : tlInfoOpen ? tlInfoDialog() : '';
  return checkinBlockBeforeTodo(week) + (pic || todoCard()) + list;
};
document.addEventListener('click', e => { if (e.target.closest && e.target.closest('[data-act="bellGo"]')) dvTodoOpen = false; }, true);
document.addEventListener('click', e => { const b = e.target.closest && e.target.closest('[data-act="dvTodo"]'); if (!b) return; dvTodoOpen = b.dataset.v === '1' ? (b.dataset.k || 'all') : false; qaSnap = new Map(); render(); });
document.addEventListener('click', e => {
  const b = e.target.closest('[data-act]');
  if (!b) return;
  if (b.dataset.act === 'rpDone') reportTick(b.dataset.k, false);
  if (b.dataset.act === 'rpUndo') reportTick(b.dataset.k, true);
});

/* ---------- Penalty ladder by day (owner 07/11: "phạt hs mức nọ kia là hiển thị theo ngày") ----------
 * The default view follows the day picked at the top: classes of that day in time order, each with its pupils, level and what to do.
 * "Tất cả" lists everyone by the day they entered their level, newest first. */
ladderBlock = function (week) {
  if (!ladder.rows) { if (Date.now() - ladder.tried > 60000) { ladder.tried = Date.now(); setTimeout(() => loadLadder().then(render).catch(() => {}), 0); } return penaltyBlock(week); }
  const dayCls = new Map();
  (week ? week.data.sessions : []).filter(s => s.day === day && !s.off).forEach(s => { const k = Q.key(s.cls); if (!dayCls.has(k) || dayCls.get(k).start > s.start) dayCls.set(k, s); });
  const mine = x => isManager() || isTaSide(week) || isMe(homeroom[Q.key(x.cls)] || '');
  const list = ladder.rows.filter(mine).map(x => { const rule = contactRule(x), done = contactDone(x, rule) || (contactOld(x) ? { by: T('trước khi dùng app', 'before the app'), at: '', old: true } : null); return { x, rule, done, late: !done && today() > rule.due && (viToIso(x.since) || today()) >= CONTACT_START, s: dayCls.get(Q.key(x.cls)), since: viToIso(x.since) }; });
  if (!list.length) return '';
  const todo = list.filter(l => !l.done).length, late = list.filter(l => l.late).length, onDay = list.filter(l => l.s);
  const mode = ['ngay', 'can', 'tat'].includes(filters.lad) ? filters.lad : 'ngay';
  let h = '<div class="part p-alert"><h2>' + T('Học sinh trong danh sách phạt', 'Pupils on the penalty ladder') + '</h2><span>' + list.length + T(' HS', ' pupils') + (late ? ' · ' + late + T(' quá hạn liên hệ', ' contact overdue') : '') + '</span></div>';
  h += '<div class="chips">' + [['ngay', esc(dayLabel(day)) + ' · ' + onDay.length], ['can', T('Cần liên hệ PH', 'To contact') + ' · ' + todo], ['tat', T('Tất cả theo ngày vào mức', 'All, by date') + ' · ' + list.length]].map(([k, t]) => '<button class="' + (mode === k ? 'on' : '') + '" data-act="ladMode" data-v="' + k + '">' + t + '</button>').join('') + '</div>';
  h += '<details class="card row lad-legend"><summary>' + T('Việc từng mức · nhắn tin hôm nay: ', 'What each level means · messages today: ') + '<b>' + (isFriday(today()) ? 'THUY TRANG' : T('quản lí', 'managers')) + '</b></summary>' + [1, 2, 3, 4, 5].map(l => '<div class="small"><span class="lvl l' + l + '">M' + l + '</span> ' + esc(LADDER_ACT[l]) + (l >= 4 ? T(' Hạn 2 ngày.', ' Within 2 days.') : '') + '</div>').join('') + '</details>';
  const line = ({ x, rule, done, late }) => {
    const m = x.name.match(/^(.*?)\s*\(([^)]+)\)\s*$/), eng = m ? m[2] : '', full = m ? m[1] : x.name;
    return '<div class="lad lv' + x.level + (late ? ' late' : '') + (done ? ' done' : '') + '"><div class="lad-line"><span class="lvl l' + x.level + '">M' + x.level + '</span><b>' + esc(eng || full) + '</b>' + (mode !== 'tat' && x.since ? '<span class="small muted">' + T('từ ', 'since ') + esc(String(x.since).slice(0, 5)) + '</span>' : '') +
      (done && done.old ? '<span class="tag">' + T('Vào mức trước 07/11', 'Before 07/11') + '</span>' : '') + (done && !done.old ? '<span class="tag ok">✓ ' + esc(rule.action) + ' · ' + esc(done.by || '?') + (done.at ? ' · ' + esc(String(done.at).slice(11, 16) + ' ' + String(done.at).slice(0, 5)) : '') + '</span>' : done ? '' : '<span class="tag ' + (late ? 'bad' : 'warn') + '">' + esc(rule.call ? T('Gọi', 'Call') : T('Nhắn', 'Message')) + ' · ' + esc(rule.who) + (rule.call ? ' · ' + esc(viDate(rule.due).slice(0, 5)) : '') + '</span>') +
      '<span class="spacer"></span>' + (!done && canContact(x, rule) ? '<button class="good" data-act="ladTick" data-cls="' + esc(x.cls) + '" data-name="' + esc(x.name) + '">' + esc(rule.action) + '</button>' : '') +
      (x.level === 2 ? '<button class="quiet" data-act="ladCopy" data-cls="' + esc(x.cls) + '" data-name="' + esc(eng || full) + '">' + T('Bài chép', 'Copy text') + '</button>' : '') + '</div>' +
      '<div class="small lad-do">' + esc(LADDER_ACT[x.level] || '') + '</div>' +
      '<details class="lad-more"><summary>' + esc(x.reason || T('Chi tiết', 'Details')) + '</summary><div class="small">' + esc(full) + ' · ' + T('vào mức từ ', 'since ') + esc(x.since) + '</div>' + (x.owed.length ? '<div class="small muted">' + T('Còn nợ: ', 'Owes: ') + esc(x.owed.join('; ')) + '</div>' : '') + '</details></div>';
  };
  const groups = new Map(), add = (k, title, sort, l) => { if (!groups.has(k)) groups.set(k, { title, sort, items: [] }); groups.get(k).items.push(l); };
  // Owner 08/11: handled pupils stay (faded, with who and when); pending ones are sorted first.
  const shown = mode === 'ngay' ? onDay : list;
  if (mode === 'tat') shown.forEach(l => add(l.since || '0', l.since ? T('Vào mức ngày ', 'Since ') + dayLabel(l.since) : T('Chưa rõ ngày', 'No date'), l.since || '0', l));
  else shown.forEach(l => add(l.x.cls, '<b>' + esc(l.x.cls) + '</b>' + (l.s ? '<span class="tag">' + T('học ', 'class ') + Q.clock(l.s.start) + '</span>' : '') + ladCheckTag(l), l.s ? String(l.s.start).padStart(5, '0') : '99999' + l.x.cls, l));
  if (!shown.length) return h + '<div class="card empty">' + (mode === 'ngay' ? T('Các lớp học ' + dayLabel(day) + ' không có học sinh nào trong danh sách phạt.', 'No pupil on the ladder in classes on this day.') : mode === 'can' ? T('Đã liên hệ phụ huynh đủ.', 'All parents contacted.') : T('Không có học sinh nào.', 'Nobody here.')) + '</div>' + (ladder.copy ? copySheet(ladder.copy) : '');
  const ordered = [...groups.values()].sort((a, b) => mode === 'tat' ? b.sort.localeCompare(a.sort) : a.sort.localeCompare(b.sort, 'vi', { numeric: true }));
  h += '<div class="grid">' + ordered.map(g => {
    g.items.sort((a, b) => (a.done ? 1 : 0) - (b.done ? 1 : 0) || b.late - a.late || b.x.level - a.x.level);
    return '<div class="card row lad-class"><div class="row-top">' + (mode === 'tat' ? '<b>' + esc(g.title) + '</b>' : g.title) + '<span class="spacer"></span><span class="muted small">' + g.items.length + T(' HS', '') + '</span></div>' +
      g.items.map(l => mode === 'tat' ? line(l).replace('<b>', '<b>' + esc(l.x.cls) + ' · ') : line(l)).join('') + '</div>';
  }).join('') + '</div>';
  if (ladder.copy) h += copySheet(ladder.copy);
  return h;
};

/* ---------- Grade, history and lock on the class screen (owner 07/11 spec) ----------
 * A+ / B / F beside the name writes the paper-homework cell; B and F open a reason box ("Lý do: …" on the next line of the cell,
 * so the grade letter stays first and every reader still sees the grade).
 * ▸ beside a pupil shows the last 3 lessons: stars, BTVN, reminders. The screen starts locked; the teacher holds "Giữ để sửa",
 * then "Lưu & khoá". Every tap is kept on this device at once and sent to the sheets in the background, so a power cut loses nothing. */
// Owner 09/11: "đừng tự động lock": the screen no longer locks itself after 5 idle minutes, nor when the teacher steps out to another
// screen and back; it locks only on "Xong, khoá lại" or when another lesson is opened.
const LOCK_IDLE = Infinity, HOLD_MS = 700, REASON_TAG = 'Lý do: ';
const GRADE_REASONS = ['Chưa làm bài', 'Làm thiếu', 'Làm ẩu, sai nhiều', 'Quên sách vở', 'Chưa chữa bài'];
const llLock = { key: '', open: false, at: 0 };
let llGradeBox = null;
const llHist = new Set();
function llUnlocked(s) {
  const k = Q.sessionKey(s);
  if (llLock.key !== k) { llLock.key = k; llLock.open = false; }
  return llLock.open && Date.now() - llLock.at < LOCK_IDLE;
}
function lockBar(can, edit) {
  if (!can) return '';
  const left = outbox.length, state = '<span class="rv-saved" id="llSaveState">' + saveText() + '</span>';
  if (!edit) return state + '<button class="rv-lock" data-act="llUnlock" aria-label="' + T('Giữ 1 giây để mở khoá sửa', 'Hold a second to unlock') + '"><span class="fill"></span><span class="lbl">🔒 ' + T('Giữ để sửa', 'Hold to edit') + '</span></button>';
  return state + '<span class="rv-editing">✏️ ' + T('Đang sửa', 'Editing') + '</span><button class="primary rv-save" data-act="llSave">🔒 ' + T('Xong, khoá lại', 'Done, lock') + '</button>';
}
const saveText = () => flushFailed ? '⚠️ ' + T('Mất mạng: ' + outbox.length + ' mục giữ trên máy, sẽ tự gửi lại', outbox.length + ' kept on this device, will resend') : outbox.length ? T('Đã giữ trên máy · đang gửi ' + outbox.length + ' mục', 'Kept on device · sending ' + outbox.length) : '✓ ' + T('Đã lưu lên sheet', 'Saved to the sheets');
const paintSaveBeforeLock = paintSave;
paintSave = function () { paintSaveBeforeLock(); const el = document.getElementById('llSaveState'); if (el) el.textContent = saveText(); };

const gradeParts = v => { const lines = String(v || '').split('\n'), g = Q.gradeOf(v); return { g, why: lines.slice(1).filter(l => l.startsWith(REASON_TAG)).map(l => l.slice(REASON_TAG.length)).join('; '), rest: lines.slice(1).filter(l => !l.startsWith(REASON_TAG) && Q.clean(l)) }; };
function gradeSeg(ctx, r, live) {
  if (!ctx.block || ctx.block.grade < 0) return '';
  const { g, why } = gradeParts(ctx.tracker.cell(r.p.row, ctx.block.grade)), pick = g === 'A' ? 'A+' : g;
  // Owner 08/11: the class screen shows only the grade already given (A+, B or F, with the reason for B/F), nothing to tap.
  if (!pick || pick === '/') return '<div class="rv-grade-show" aria-hidden="true"></div>';
  return '<div class="rv-grade-show" title="' + T('Bài tập về nhà (chấm ở trang lớp)', 'Homework (graded on the class page)') + '"><span class="rv-gbig g' + pick[0] + '">' + esc(pick) + '</span>' + (why && pick !== 'A+' ? '<span class="rv-gwhy">' + esc(why) + '</span>' : '') + '</div>';
}
function gradeWrite(ctx, pupil, grade, why) {
  const { block, tracker, cls, session } = ctx, cur = tracker.cell(pupil.row, block.grade), p = gradeParts(cur);
  const rest = p.g === '/' ? [] : p.rest, value = grade ? [grade].concat(rest, grade !== 'A+' && Q.clean(why) ? [REASON_TAG + Q.clean(why)] : []).join('\n') : rest.join('\n');
  gradeCell(cls, tracker, block, pupil, value, pupil.eng + ' · BTVN ' + session.lesson);
  const m = ctx.marks.get(pupil.name);
  if (grade && !(m && Q.PRESENT.includes(m.status))) appendMark(session, pupil, Q.tickStatus(session, today(), minutesNow()));
}
function gradeBox(ctx, r, edit) {
  const name = r.p.eng || r.p.name, dis = edit ? '' : ' disabled', cur = gradeParts(ctx.tracker.cell(r.p.row, ctx.block.grade)), key = 'llgrade:' + r.p.name, draft = drafts[key] != null ? drafts[key] : cur.why;
  return '<div class="ll-veil" data-act="llClose"></div><div class="ll-sheet rv-box" role="dialog" aria-label="BTVN ' + esc(name) + '">' +
    '<div class="row-top"><b class="ll-sheet-name">BTVN <span class="rv-gtag g' + cur.g[0] + '">' + esc(cur.g) + '</span> · ' + esc(name) + '</b><span class="spacer"></span><button class="quiet" data-act="llClose">' + T('Đóng', 'Close') + '</button></div>' +
    '<div class="small muted">' + T('Lý do (không bắt buộc). Ghi vào ô BTVN của tiết này trong sheet lớp.', 'Reason (optional), written to the homework cell.') + '</div>' +
    '<div class="ll-chips">' + GRADE_REASONS.map(t => '<button class="' + (draft === t ? 'on' : '') + '" data-act="llGradePick" data-i="' + r.i + '" data-v="' + esc(t) + '"' + dis + '>' + biText(t) + '</button>').join('') + '</div>' +
    '<textarea data-act="llGradeText" data-name="' + esc(r.p.name) + '" rows="2" maxlength="200" placeholder="' + T('Lý do cụ thể…', 'Reason…') + '"' + dis + '>' + esc(draft) + '</textarea>' +
    '<div class="ll-sheet-row"><button class="primary" data-act="llGradeSave" data-i="' + r.i + '"' + dis + '>' + T('Lưu lý do', 'Save reason') + '</button><button data-act="llGradeClear" data-i="' + r.i + '"' + dis + '>' + T('Xoá điểm', 'Clear grade') + '</button></div></div>';
}
// The last 3 lessons before this one, read from the class sheet (stars, BTVN) and the behaviour log.
function histBox(ctx, r) {
  const s = ctx.session, t = ctx.tracker, here = ctx.block;
  // Sheets put the newest lesson on the left, so the order comes from the date and lesson number, never the column.
  const num = b => Number(b.lesson) || 0;
  const past = t.blocks.filter(b => b !== here && b.date && (b.date < s.day || (b.date === s.day && num(b) && num(b) < (Number(s.lesson) || 0)))).sort((a, b) => b.date.localeCompare(a.date) || num(b) - num(a)).slice(0, 3);
  if (!past.length) return '<div class="rv-histbox"><span class="small muted">' + T('Chưa có buổi nào trước buổi này trong sheet.', 'No earlier lesson in the sheet.') + '</span></div>';
  const rows = logs.behave ? logs.behave.rows : [];
  return '<div class="rv-histbox"><table><thead><tr><th>' + T('Buổi', 'Lesson') + '</th><th>⭐</th><th>BTVN</th><th>' + T('Nhắc nhở', 'Reminders') + '</th></tr></thead><tbody>' + past.map(b => {
    const star = b.stars >= 0 ? Q.clean(t.cell(r.p.row, b.stars)) : '', gp = b.grade >= 0 ? gradeParts(t.cell(r.p.row, b.grade)) : { g: '', why: '' };
    const beh = rows.filter(x => x.day === b.date && Q.key(x.cls) === Q.key(s.cls) && String(x.lesson) === String(b.lesson) && x.name === r.p.name).pop();
    const c = tagCounts(beh ? beh.tags : []), tags = Object.keys(c).map(k => tagText(k) + (c[k] > 1 ? ' ×' + c[k] : '')).join(', ');
    const absent = gp.g === '/';
    return '<tr><td>' + esc(viDate(b.date).slice(0, 5)) + (b.lesson ? ' · T' + esc(b.lesson) : '') + '</td><td>' + (absent ? '—' : esc(/^\d+$/.test(star) ? star : star ? '?' : '0')) + '</td><td>' + (absent ? '<span class="tag">' + T('Vắng', 'Absent') + '</span>' : gp.g ? '<span class="rv-gtag g' + gp.g[0] + '">' + esc(gp.g) + '</span>' + (gp.why ? ' <span class="small muted">' + esc(gp.why) + '</span>' : '') : '<span class="muted">—</span>') + '</td><td>' + (tags ? '<span class="rv-htags">' + esc(tags) + '</span>' : '<span class="muted">' + T('Không', 'None') + '</span>') + '</td></tr>';
  }).join('') + '</tbody></table></div>';
}

const WRITE_ACTS = ['llStar', 'llDown', 'llTick', 'llWarnGive', 'llWarnAdd', 'llOff', 'llHere', 'llAll', 'llType', 'llMinus', 'llTag', 'llNoteSave', 'llGrade', 'llGradeSave', 'llGradeClear', 'llReason', 'llReasonPick', 'llGradePick'];
const llActionBeforeLock = llAction;
llAction = function (act, i, v) {
  const ctx = classContext(current), s = ctx.session;
  if (act === 'llExit') { llGradeBox = null; llHist.clear(); }
  if (act === 'llClose') llGradeBox = null;
  if (act === 'llHist') { const p = ctx.tracker && ctx.tracker.pupils[Number(i)]; if (p) { if (llHist.has(p.name)) llHist.delete(p.name); else llHist.add(p.name); render(); } return; }
  if (act === 'llUnlock') return;
  if (act === 'llSave') { llLock.open = false; llGradeBox = null; flush(); render(); say(T('Đã lưu và khoá màn hình lớp.', 'Saved and locked.')); return; }
  if (WRITE_ACTS.includes(act)) {
    if (!canTeach(s) || !llUnlocked(s)) return;
    llLock.at = Date.now();
  }
  if (!['llGrade', 'llGradeSave', 'llGradeClear', 'llGradePick'].includes(act)) return llActionBeforeLock(act, i, v);
  const pupil = i != null && ctx.tracker ? ctx.tracker.pupils[Number(i)] : null;
  if (!pupil || !ctx.block || ctx.block.grade < 0) return;
  const key = 'llgrade:' + pupil.name, cur = gradeParts(ctx.tracker.cell(pupil.row, ctx.block.grade));
  if (act === 'llGrade') {
    const same = (cur.g === 'A' ? 'A+' : cur.g) === v;
    if (same && v === 'A+') { if (cur.rest.length) return say(T('Ô BTVN có nhận xét của GV, muốn xoá điểm thì sửa trong sheet.', 'This cell has a teacher comment.'), 'bad'); gradeWrite(ctx, pupil, '', ''); render(); return; }
    if (!same) gradeWrite(ctx, pupil, v, v === 'A+' ? '' : cur.why);
    if (v !== 'A+') { llMenu = null; llReason = null; llGradeBox = Number(i); delete drafts[key]; }
    render(); return;
  }
  if (act === 'llGradePick') { drafts[key] = drafts[key] === v ? '' : v; render(); return; }
  if (act === 'llGradeSave') { gradeWrite(ctx, pupil, cur.g, drafts[key] != null ? drafts[key] : cur.why); delete drafts[key]; llGradeBox = null; render(); return; }
  if (act === 'llGradeClear') { gradeWrite(ctx, pupil, '', ''); delete drafts[key]; llGradeBox = null; render(); }
};
document.addEventListener('input', e => {
  const b = e.target.closest('[data-act="llGradeText"]');
  if (b) drafts['llgrade:' + b.dataset.name] = b.value;
});
// Hold to unlock: a quick tap by a pupil does nothing; the teacher keeps a finger on it for under a second.
let holdTimer = null;
const holdStop = () => { clearTimeout(holdTimer); holdTimer = null; document.querySelectorAll('.rv-lock.holding').forEach(b => b.classList.remove('holding')); };
const unlockNow = () => { llLock.open = true; llLock.at = Date.now(); holdStop(); render(); };
document.addEventListener('pointerdown', e => {
  const b = e.target.closest('[data-act="llUnlock"]');
  if (!b) return;
  e.preventDefault(); b.classList.add('holding');
  holdTimer = setTimeout(unlockNow, HOLD_MS);
});
['pointerup', 'pointercancel', 'pointerleave'].forEach(t => document.addEventListener(t, e => { if (holdTimer && (t !== 'pointerleave' || e.target.closest && e.target.closest('[data-act="llUnlock"]'))) holdStop(); }, true));
document.addEventListener('contextmenu', e => { if (e.target.closest && e.target.closest('[data-act="llUnlock"]')) e.preventDefault(); });
document.addEventListener('keydown', e => { if ((e.key === 'Enter' || e.key === ' ') && e.target.closest && e.target.closest('[data-act="llUnlock"]')) { e.preventDefault(); unlockNow(); } });
// After 5 minutes without a tap the screen locks itself again.
setInterval(() => { if (view === 'lenlop' && llLock.open && Date.now() - llLock.at >= LOCK_IDLE) { llLock.open = false; llGradeBox = null; flush(); render(); } }, 15000);

/* ---------- Điều hành reorganised (owner 08/11: "không còn mục chấm công nữa vì là tự động chấm công... cái nào trùng lặp bỏ đi...
 * bố trí lại cho dễ theo dõi... cái nào cần thì thêm") ----------
 * Staff time now comes only from GPS check-in (Vào ca), so the manual "Chấm công" tab is gone; KPI and the month table are one tab;
 * a new "Tổng quan" tab comes first and lists, for today, what needs someone, each line opening the tab that handles it. */
PANELS.splice(0, PANELS.length, ['tong', 'Tổng quan'], ['ca', 'Vào ca'], ['vang', 'HS vắng'], ['task', 'Important Task'], ['loi', 'Lỗi'], ['thang', 'Tháng & KPI'], ['cot', 'Cột lớp'], ['manhinh', 'Màn hình lớp']);
if (!PANELS.some(p => p[0] === panel)) panel = 'tong';
const PANEL_EN = { 'Tổng quan': 'Overview', 'Vào ca': 'Check-in', 'HS vắng': 'Absences', 'Lỗi': 'Errors', 'Tháng & KPI': 'Month & KPI', 'Cột lớp': 'Lesson columns', 'Màn hình lớp': 'Class screens' };
const panelTabs = () => '<div class="tabs">' + PANELS.map(([k, t]) => '<button class="' + (k === panel ? 'on' : '') + '" data-act="panel" data-v="' + k + '">' + esc(lang === 'en' ? PANEL_EN[t] || t : t) + '</button>').join('') + '</div>';
// Today's counts, from what is already read; a figure that needs class sheets says so instead of guessing.
function overviewStats(week) {
  const t = today(), saved = day, out = {};
  day = t;
  try {
    // Check-in: reuse the Vào ca tab's own count line, so both always agree.
    const c = ca.all ? (caPanel(week).match(/<div class="count">([\s\S]*?)<\/div>/) || [])[1] : null;
    out.ca = c == null ? null : c.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
    out.caWaiting = c ? Number((c.match(/(\d+)\s*(chờ duyệt|waiting)/) || [])[1] || 0) : 0;
    out.caMissing = c ? Number((c.match(/(\d+)\s*(chưa vào ca|not in)/) || [])[1] || 0) : 0;
    const ses = week ? week.data.sessions.filter(s => s.day === t && !s.off && classOf(s)) : [];
    let noRoll = 0, pending = 0, cols = 0, read = 0;
    ses.forEach(s => {
      const ctx = classContext(s);
      if (!ctx.tracker) return;
      read++;
      if (ctx.tracker.blocks.length && columnWarning(ctx)) cols++;
      if (isGroup(s) || s.day < (classOf(s).since || '')) return;
      const roll = Q.rollCall(s, ctx.marks, t, minutesNow());
      if (!roll.past) return;
      if (roll.noRollCall) { noRoll++; return; }
      pending += ctx.tracker.pupils.filter(p => Q.pupilState(ctx.marks.get(p.name), roll) === 'Vắng chờ xác minh').length;
    });
    Object.assign(out, { classes: ses.length, read, noRoll, pending, cols });
    const tasks = week ? week.data.tasks.map(x => Q.taskState(x, t).state) : [];
    out.taskLate = tasks.filter(x => x === 'quahan').length; out.taskToday = tasks.filter(x => x === 'homnay').length; out.taskOpen = tasks.filter(x => x !== 'xong').length;
    out.errors = logs.errors ? [...Q.latest(logs.errors.rows, r => r.id).values()].filter(e => e.status === 'Mở').length : null;
  } catch (e) { out.err = e.message; }
  finally { day = saved; }
  return out;
}
function overviewPanel(week) {
  const s = overviewStats(week), bellNow = bellItems().filter(x => !['in', 'inno', 'out'].includes(x.k));
  const line = (icon, title, text, tag, go, v) => '<div class="card row ov-line"><div class="row-top"><span class="ico">' + icon + '</span><b>' + esc(title) + '</b>' + (tag || '') + '<span class="spacer"></span>' +
    (go ? '<button class="quiet" data-act="' + go + '"' + (v ? ' data-v="' + v + '"' : '') + '>' + T('Mở', 'Open') + ' ›</button>' : '') + '</div>' + (text ? '<div class="small muted">' + text + '</div>' : '') + '</div>';
  const tag = (n, kind, word) => n ? '<span class="tag ' + kind + '">' + n + ' ' + esc(word) + '</span>' : '';
  let h = '';
  if (bellNow.length) h += '<h2>' + T('Cần xử lý ngay', 'Needs action now') + '</h2><div class="list">' + bellNow.map((x, i) => '<button class="bell-item' + (x.hot ? ' hot' : '') + '" data-act="ovGo" data-i="' + i + '"><span>' + x.icon + '</span><span>' + esc(x.text) + '</span><span class="muted">›</span></button>').join('') + '</div>';
  h += '<h2>' + T('Hôm nay ở trung tâm', 'Today at the centre') + '</h2><div class="grid">' +
    line('📍', T('Vào ca', 'Check-in'), s.ca == null ? T('Đang đọc…', 'Reading…') : esc(s.ca), tag(s.caWaiting, 'warn', T('chờ duyệt', 'waiting')), 'panel', 'ca') +
    line('🧒', T('Điểm danh học sinh', 'Pupil roll call'), s.classes ? (s.read < s.classes ? T('Đã đọc ' + s.read + '/' + s.classes + ' sheet lớp hôm nay…', 'Read ' + s.read + '/' + s.classes + ' class sheets…') : s.classes + T(' buổi hôm nay', ' sessions today')) : T('Hôm nay không có lớp.', 'No classes today.'),
      tag(s.noRoll, 'bad', T('buổi GV chưa điểm danh', 'not taken')) + tag(s.pending, 'warn', T('HS vắng chờ xác minh', 'absences to check')), 'panel', 'vang') +
    line('📝', 'Important Task', s.taskOpen ? s.taskOpen + T(' việc chưa xong trong tuần', ' open this week') : T('Tuần này đã xong hết.', 'All done this week.'), tag(s.taskLate, 'bad', T('quá hạn', 'overdue')) + tag(s.taskToday, 'warn', T('hạn hôm nay', 'due today')), 'panel', 'task') +
    line('⚠️', T('Lỗi nhân viên', 'Staff errors'), s.errors == null ? T('Đang đọc…', 'Reading…') : s.errors ? s.errors + T(' lỗi đang mở', ' open') : T('Không có lỗi đang mở.', 'None open.'), '', 'panel', 'loi') +
    line('🗂️', T('Cột tiết học hôm nay', 'Lesson columns today'), s.read ? (s.cols ? s.cols + T(' buổi cần TA kiểm tra cột', ' need a column check') : T('Các lớp hôm nay đều đã có cột.', 'All classes today have their column.')) : T('Đang đọc sheet lớp…', 'Reading class sheets…'), tag(s.cols, 'bad', T('cần xem', 'to check')), 'panel', 'cot') +
    '</div>';
  return h;
}
// The month tab: KPI cards (on time from check-in, Important Task, returns, roll call) and errors per person of that month.
function thangPanel() {
  const month = filters.kpiMonth || xMonth(), errors = {};
  [...Q.latest(logs.errors ? logs.errors.rows : [], r => r.id).values()].filter(e => String(e.day).startsWith(month)).forEach(e => { errors[e.person] = (errors[e.person] || 0) + 1; });
  const rows = Object.entries(errors).sort((a, b) => b[1] - a[1]);
  return kpiPanel() + (rows.length ? '<h2>' + T('Lỗi trong ', 'Errors in ') + esc(monthName(month)) + '</h2><div class="card table"><table><thead><tr><th>' + T('Người', 'Person') + '</th><th>' + T('Số lỗi', 'Errors') + '</th></tr></thead><tbody>' +
    rows.map(([p, n]) => '<tr><td>' + esc(p) + '</td><td>' + n + '</td></tr>').join('') + '</tbody></table></div>' : '');
}
viewManager = function (week) {
  const body = { tong: () => overviewPanel(week), kpi: thangPanel, ca: () => caPanel(week), vang: absencePanel, task: () => taskPanel(week), loi: errorPanel, thang: thangPanel, cot: columnPanel, manhinh: boardPanel }[panel] || (() => overviewPanel(week));
  return panelTabs() + body();
};
const loadPanelBeforeReorg = loadPanel;
loadPanel = async function () {
  if (panel === 'thang') { panel = 'kpi'; try { await loadPanelBeforeReorg(); } finally { panel = 'thang'; } return; }
  if (panel !== 'tong') return loadPanelBeforeReorg();
  const t = today();
  await weekOf(t);
  await Promise.all([loadManager().catch(() => {}), loadCaAll(true).catch(() => {}), loadMarks().catch(() => {})]);
  render();
  // Today's class sheets only, two at a time, so the overview stays light on Google's limit.
  const week = weeks[Q.weekTab(tabs, t)], left = [...new Set((week ? week.data.sessions : []).filter(s => s.day === t && !s.off && classOf(s)).map(classOf))];
  const work = async () => { while (left.length) { const c = left.shift(); try { await loadTracker(c, false, true); } catch (e) {} if (panel === 'tong') render(); } };
  await Promise.all([work(), work()]);
};
document.addEventListener('click', e => {
  const b = e.target.closest && e.target.closest('[data-act="ovGo"]');
  if (!b) return;
  const x = bellItems().filter(y => !['in', 'inno', 'out'].includes(y.k))[Number(b.dataset.i)];
  if (!x || !x.go) return;
  if (x.go.view) view = x.go.view;
  if (x.go.panel) panel = x.go.panel;
  if (x.go.sec) filters.sec = x.go.sec;
  render(); window.scrollTo(0, 0);
  guarded(() => view === 'dieuhanh' ? loadPanel() : view === 'lopcn' ? loadHomerooms() : weekOf(day));
});

/* ---------- Saving never waits for a button (owner 08/11: "các thứ cần phải tự động lưu") ----------
 * Every tap is already kept on the device at once and sent within seconds (stars and behaviour within 10 s, to spare the shared Google limit).
 * Also send at once when the screen is switched off, the tab is hidden or the page is closed, and retry anything left every 20 s. */
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden' && outbox.length) flush(); });
window.addEventListener('pagehide', () => { if (outbox.length) flush(); });
setInterval(() => { if (outbox.length && !flushing && !flushTimer) flush(); }, 20000);

/* ---------- Live ranking on the class screen (owner 08/11: "tính điểm live nhảy lên nhảy xuống thứ tự") ----------
 * Pupils stand in star order, most stars first, absent ones last, ties in register order. While the teacher is tapping, rows hold
 * still so a second tap never lands on another child; 1.5 s after the last star tap everyone glides to their new place. */
const RANK_WAIT = 1500;
let llOrder = { key: '', list: [] }, llFreezeUntil = 0, llRankTimer = null;
function orderRows(rows, s) {
  const key = Q.sessionKey(s), want = rows.slice().sort((a, b) => a.off - b.off || b.stars - a.stars || a.i - b.i).map(r => r.i);
  let list = want;
  if (llOrder.key === key && Date.now() < llFreezeUntil) {
    const kept = llOrder.list.filter(i => want.includes(i));
    list = kept.concat(want.filter(i => !kept.includes(i)));
  }
  llOrder = { key, list };
  const at = new Map(list.map((i, n) => [i, n]));
  rows.sort((a, b) => at.get(a.i) - at.get(b.i));
}
function rerankNow() {
  llRankTimer = null; llFreezeUntil = 0;
  if (view !== 'lenlop') return;
  const before = new Map([...document.querySelectorAll('.rv-row')].map(el => [el.dataset.i, el.getBoundingClientRect().top]));
  render();
  document.querySelectorAll('.rv-row').forEach(el => {
    const was = before.get(el.dataset.i);
    if (was == null) return;
    const by = was - el.getBoundingClientRect().top;
    if (by && el.animate) el.animate([{ transform: 'translateY(' + by + 'px)' }, { transform: 'none' }], { duration: 550, easing: 'cubic-bezier(.2,.8,.2,1)' });
    if (by > 4 && el.animate) el.animate([{ boxShadow: '0 0 0 3px gold' }, { boxShadow: '0 0 0 0 transparent' }], { duration: 1200 });
  });
}
const llActionBeforeRank = llAction;
llAction = function (act, i, v) {
  const moves = ['llStar', 'llDown', 'llOff'].includes(act);
  if (moves) { llFreezeUntil = Date.now() + RANK_WAIT; clearTimeout(llRankTimer); llRankTimer = setTimeout(rerankNow, RANK_WAIT); }
  return llActionBeforeRank(act, i, v);
};

/* ---------- Class screen flags and bilingual chips (owner 08/11) ----------
 * "thông tin hs đi muộn hiển thị nhỏ nhỏ", "hs vẫn thiếu video hiển thị như ABF để hs luôn thấy mình còn thiếu", "lý do... dịch ra, vào sheet bằng Tiếng Việt". */
const GRADE_EN = { 'Chưa làm bài': 'Not done', 'Làm thiếu': 'Incomplete', 'Làm ẩu, sai nhiều': 'Careless, many mistakes', 'Quên sách vở': 'Forgot books', 'Chưa chữa bài': 'No corrections' };
const biText = t => { const en = BEHAVIOUR_EN[t] || GRADE_EN[t] || ''; return esc(t) + (en && en !== t ? '<small class="rv-en">' + esc(en) + '</small>' : ''); };
const owedMemo = { key: '', list: [] };
function owedOf(ctx) {
  const t = ctx.tracker, key = Q.sessionKey(ctx.session) + '|' + t.at + '|' + (ctx.session.day === today() && minutesNow() >= ctx.session.start - Q.OPEN_BEFORE);
  if (owedMemo.key !== key) { owedMemo.key = key; try { owedMemo.list = Q.owedVideos(t.pupils, t.blocks, t.practices, t.cell, Object.assign({}, ctx.session, { started: ctx.session.day < today() || (ctx.session.day === today() && minutesNow() >= ctx.session.start - Q.OPEN_BEFORE) })); } catch (e) { owedMemo.list = []; } }
  return owedMemo.list;
}
function pupilFlags(ctx, r) {
  const m = ctx.marks.get(r.p.name), out = [];
  if (m && m.status === 'Đến muộn') out.push('<span class="rv-flag late">⏰ Muộn <i class="rv-en-i">Late</i></span>');
  // Owner 08/11: one short red chip that still stings: what is owed, by lesson, and whether it was filmed wrong.
  const owed = owedOf(ctx)[r.i] || [], dm = d => d.slice(8, 10) + '/' + d.slice(5, 7);
  const what = x => (x.practice ? (x.label || 'Tự luyện').replace(/^Tự luyện video/i, 'Tự luyện') : (x.lesson ? 'Tiết ' + Number(x.lesson) : dm(x.day)) + (x.label ? ' ' + x.label.toLowerCase() : '')) + (x.wrong ? ' (quay sai)' : '');
  if (owed.length) out.push('<span class="rv-flag debt" title="' + esc(owed.map(x => what(x) + ' · ' + dm(x.day)).join('\n')) + '">⛔ Nợ video: ' + esc(owed.slice(0, 2).map(what).join(', ') + (owed.length > 2 ? ' +' + (owed.length - 2) : '')) + ' <i class="rv-en-i">Missing video</i></span>');
  return out.length ? '<span class="rv-flags">' + out.join('') + '</span>' : '';
}

/* ---------- B/F reason on the class page (owner 08/11: "khi chọn thiếu bài gì thì phải chọn ở đây... cái ghi chú ấy") ----------
 * A/B/F is graded on the class page with roll call; B or F opens the reason picker (Vietnamese with English under it),
 * written into the BTVN cell as "B" then "Lý do: …", so every report still reads the grade. Tapping A+ again clears it. */
let cgOpen = null, cgGrade = '';
const gradeReason = v => gradeParts(v).why;
function classCanEdit(s) {
  const mine = takesRoll(s);
  return !isChot(s) && (isManager() || (mine && Q.rollCall(s, marksOf(s), today(), minutesNow()).open && !lessonClosed(s)));
}
function classGrade(ctx, pupil, grade, i) {
  if (!ctx.block || ctx.block.grade < 0 || !classCanEdit(ctx.session)) return;
  const raw = ctx.tracker.cell(pupil.row, ctx.block.grade), cur = gradeParts(raw);
  if (Q.clean(raw) && !Q.gradeOf(raw)) return say(pupil.eng + T(': ô BTVN đang có ghi chú khác, vui lòng sửa trực tiếp trong sheet.', ': the homework cell holds other text, please edit it in the sheet.'), 'bad');
  if (grade === 'A+') { gradeWrite(ctx, pupil, (cur.g === 'A+' || cur.g === 'A') && !cur.rest.length ? '' : 'A+'); cgOpen = null; render(); return; }
  // B or F is written only together with its reason (owner 08/11: bắt buộc có lí do).
  cgOpen = i; cgGrade = grade; delete drafts['cggrade:' + pupil.name]; render();
}
function classGradeBox() {
  if (cgOpen == null || view !== 'lop' || !current) return '';
  const ctx = classContext(current), p = ctx.tracker && ctx.tracker.pupils[cgOpen];
  if (!p || !ctx.block || ctx.block.grade < 0) return '';
  const cur = gradeParts(ctx.tracker.cell(p.row, ctx.block.grade)), key = 'cggrade:' + p.name, draft = drafts[key] != null ? drafts[key] : cur.why, name = p.eng || p.name, dis = classCanEdit(ctx.session) ? '' : ' disabled';
  return '<div class="ll-veil" data-act="cgClose"></div><div class="ll-sheet rv-box" role="dialog" aria-label="BTVN ' + esc(name) + '">' +
    '<div class="row-top"><b class="ll-sheet-name">BTVN <span class="rv-gtag g' + cgGrade[0] + '">' + esc(cgGrade) + '</span> · ' + esc(name) + '</b><span class="spacer"></span><button class="quiet" data-act="cgClose">' + T('Đóng', 'Close') + '</button></div>' +
    '<div class="small muted">' + T('Bắt buộc có lý do cho điểm ' + cgGrade + '. Chọn hoặc gõ, rồi bấm Lưu: điểm và lý do cùng ghi vào ô BTVN của tiết này trong sheet lớp.', 'A reason is required for ' + cgGrade + '. Pick or type, then Save: grade and reason go to the homework cell together.') + '</div>' +
    '<div class="ll-chips">' + GRADE_REASONS.map(t => '<button class="' + (draft === t ? 'on' : '') + '" data-act="cgPick" data-v="' + esc(t) + '"' + dis + '>' + biText(t) + '</button>').join('') + '</div>' +
    '<textarea data-cg="text" rows="2" maxlength="200" placeholder="' + T('Lý do cụ thể, ví dụ: thiếu trang 50', 'Details, e.g. page 50 missing') + '"' + dis + '>' + esc(draft) + '</textarea>' +
    '<div class="ll-sheet-row"><button class="primary" data-act="cgSave"' + dis + '>' + T('Lưu điểm ' + cgGrade + ' và lý do', 'Save ' + cgGrade + ' with reason') + '</button><button data-act="cgClear"' + dis + '>' + T('Xoá điểm', 'Clear grade') + '</button></div></div>';
}
const viewClassBeforeReason = viewClass;
viewClass = function () { return viewClassBeforeReason() + classGradeBox(); };
document.addEventListener('input', e => {
  if (!(e.target.dataset && e.target.dataset.cg === 'text') || cgOpen == null) return;
  const p = classContext(current).tracker.pupils[cgOpen];
  if (p) drafts['cggrade:' + p.name] = e.target.value;
});
document.addEventListener('click', e => {
  const b = e.target.closest && e.target.closest('[data-act^="cg"]');
  if (!b || cgOpen == null) return;
  const ctx = classContext(current), p = ctx.tracker && ctx.tracker.pupils[cgOpen], act = b.dataset.act;
  if (act === 'cgClose' || !p) { cgOpen = null; render(); return; }
  const key = 'cggrade:' + p.name;
  if (act === 'cgPick') { drafts[key] = drafts[key] === b.dataset.v ? '' : b.dataset.v; render(); return; }
  const cur = gradeParts(ctx.tracker.cell(p.row, ctx.block.grade));
  if (act === 'cgSave') {
    const why = Q.clean(drafts[key] != null ? drafts[key] : cur.g === cgGrade ? cur.why : '');
    if (!why) return say(T('Điểm ' + cgGrade + ' bắt buộc có lý do: chọn một lý do hoặc gõ vào ô.', 'A ' + cgGrade + ' needs a reason: pick one or type it.'), 'bad');
    notices = notices.filter(n => !/bắt buộc có lý do|needs a reason/.test(n.text));
    gradeWrite(ctx, p, cgGrade, why); delete drafts[key]; cgOpen = null; render(); return;
  }
  if (act === 'cgClear') { gradeWrite(ctx, p, ''); delete drafts[key]; cgOpen = null; render(); }
});

/* ---------- Lesson summary for parents (owner 08/11: "sau khi lớp học kết thúc hãy hiện ra màn hình chốt... màn hình tôi chụp ảnh gửi PH
 * khi report lớp... phần thiếu video note là tính đến thời điểm nào") ----------
 * When the lesson has ended the class screen turns into a clean, light sheet made for a photo: each pupil's attendance, stars,
 * homework grade with its reason, reminders, and the videos still owed, stamped with the time the class sheet was read. */
let llSummary = { key: '', mode: null };
const lessonEnded = s => s.day < today() || (s.day === today() && minutesNow() >= s.end);
// Owner 13/11: the close-lesson screen and its pop-up come 5 minutes after the lesson ends (the teacher is still wrapping up);
// the close button itself works from the end of the lesson.
const CHOT_AFTER_MIN = 5;
const chotTime = s => s.day < today() || (s.day === today() && minutesNow() >= s.end + CHOT_AFTER_MIN);
const sumStamp = at => { const d = new Date(at || Date.now()), p = n => String(n).padStart(2, '0'); return p(d.getHours()) + ':' + p(d.getMinutes()) + ' ngày ' + p(d.getDate()) + '/' + p(d.getMonth() + 1) + '/' + d.getFullYear(); };
function summaryOn(s) {
  const key = Q.sessionKey(s);
  if (llSummary.key !== key) llSummary = { key, mode: null };
  return llSummary.mode === null ? chotTime(s) : llSummary.mode;
}
function attendText(m) {
  const st = m ? m.status : '';
  if (st === 'Có mặt') return '<span class="sum-ok">Có mặt</span>';
  if (st === 'Đến muộn') return '<span class="sum-late">Đến muộn</span>';
  if (st === NGHI || st === 'Đã báo nghỉ' || st === 'Có phép') return '<span class="sum-off">Nghỉ có phép</span>';
  if (st === 'Chưa báo nghỉ' || st === 'Không phép') return '<span class="sum-off">Nghỉ</span>';
  return '<span class="sum-muted">—</span>';
}
function summaryView(ctx) {
  const s = ctx.session, t = ctx.tracker, behave = behaveFor(s), owed = totalOwed(ctx), medal = ['🥇', '🥈', '🥉'];
  const rows = t.pupils.map((p, i) => { const m = ctx.marks.get(p.name); return { p, i, m, stars: starsOf(ctx, p), off: !!m && (m.status === NGHI || Q.ABSENT.includes(m.status)), b: behave.get(p.name) }; })
    .sort((a, b) => a.off - b.off || b.stars - a.stars || a.i - b.i);
  const scores = [...new Set(rows.filter(r => !r.off && r.stars).map(r => r.stars))].sort((a, b) => b - a);
  const here = rows.filter(r => r.m && Q.PRESENT.includes(r.m.status)).length, noStars = !(ctx.block && ctx.block.stars >= 0), noGrade = !(ctx.block && ctx.block.grade >= 0);
  const owedText = x => (x.practice ? (x.label || 'Tự luyện').replace(/^Tự luyện video/i, 'Tự luyện') : (x.lesson ? 'Tiết ' + Number(x.lesson) : viDate(x.day).slice(0, 5)) + (x.label ? ' ' + x.label.toLowerCase() : '')) + (x.wrong ? ' (quay sai)' : '');
  const body = rows.map(r => {
    const rank = r.off || !r.stars ? 0 : scores.indexOf(r.stars) + 1, gp = noGrade ? { g: '' } : gradeParts(t.cell(r.p.row, ctx.block.grade)), g = gp.g === 'A' ? 'A+' : gp.g;
    const counts = tagCounts(r.b ? r.b.tags : []), remind = Object.entries(counts).filter(([k]) => k !== CANH_CAO && k !== PRAISE).map(([k, n]) => esc(k) + (n > 1 ? ' ×' + n : '')).join(', ') + (counts[PRAISE] ? (Object.keys(counts).some(k => k !== CANH_CAO && k !== PRAISE) ? '<br>' : '') + '<span class="sum-ok">👍 ' + PRAISE + (counts[PRAISE] > 1 ? ' ×' + counts[PRAISE] : '') + '</span>' : '');
    const warned = counts[CANH_CAO] || 0, debt = (owed[r.i] || []).map(owedText);
    return '<tr' + (r.off ? ' class="sum-offrow"' : '') + '><td class="sum-rank">' + (rank && rank <= 3 ? medal[rank - 1] : rank ? '#' + rank : '') + '</td>' +
      '<td class="sum-name"><b>' + esc(r.p.eng || r.p.name) + '</b></td><td>' + attendText(r.m) + '</td>' +
      (noStars ? '' : '<td class="sum-stars">' + (r.off ? '' : '⭐ ' + r.stars) + '</td>') +
      (noGrade ? '' : '<td class="sum-gcell">' + (g && g !== '/' ? '<span class="sum-g g' + g[0] + '">' + esc(g) + '</span>' + (gp.why && g !== 'A+' ? '<div class="sum-why">' + esc(gp.why) + '</div>' : '') : '') + '</td>') +
      '<td class="sum-remind">' + (warned ? '<span class="sum-warn">⚠️ Cảnh cáo' + (warned > 1 ? ' ×' + warned : '') + '</span>' + (remind ? '<br>' : '') : '') + remind + (!warned && !remind && !r.off ? '<span class="sum-ok">Tốt ✓</span>' : '') + '</td>' +
      '<td class="sum-debt">' + (debt.length ? '<b>Thiếu ' + debt.length + ' bài:</b> ' + esc(kidsKinds(owed[r.i] || [])) : dashRedoOf(ctx, r.i).length ? '' : '<span class="sum-ok">Không thiếu ✓</span>') + (dashRedoOf(ctx, r.i).length ? (debt.length ? '<br>' : '') + '<b>🔁 Cần nộp lại ' + dashRedoOf(ctx, r.i).length + ' bài:</b> ' + esc(dashRedoOf(ctx, r.i).map(x => Q.clean(x.label)).join('; ')) : '') + '</td></tr>';
  }).join('');
  const head = '<tr><th></th><th>Học sinh</th><th>Điểm danh</th>' + (noStars ? '' : '<th>Sao</th>') + (noGrade ? '' : '<th class="sum-c">Bài tập sách giấy</th>') + '<th>Nhắc nhở</th><th>Video còn thiếu</th></tr>';
  return chotBar(s) + rpChotBar(s) + '<div class="sum-bar"><button class="quiet" data-act="llSumClose">‹ ' + T('Quay lại màn hình lớp', 'Back to the class screen') + '</button><span class="spacer"></span>' +
    '<button class="quiet" data-act="llSumRefresh">↻ ' + T('Đọc lại sheet', 'Re-read the sheet') + '</button><button class="primary" data-act="sumSave">💾 ' + T('Lưu ảnh', 'Save image') + '</button><span class="small muted">' + T('Bấm "Lưu ảnh" (hoặc chụp phần khung trắng bên dưới) để gửi phụ huynh.', 'Tap "Save image" (or photograph the white sheet) for parents.') + '</span></div>' +
    '<div class="sum-sheet"><div class="sum-top"><img src="logo.png" alt="" width="44" height="44"><div><div class="sum-title">' + esc(s.cls) + ' · Tiết ' + esc(s.lesson) + '</div>' +
    '<div class="sum-sub">' + esc(Q.dayText(s.day, 'vi')) + ' · ' + sessionTime(s) + '</div>' +
    (s.book || s.detail ? '<div class="sum-sub">' + esc([s.book, Q.clean(s.detail).split('\n')[0]].filter(Boolean).join(' · ')) + '</div>' : '') + '</div>' +
    '<div class="sum-count"><b>' + here + '/' + t.pupils.length + '</b><span>có mặt</span></div></div>' +
    '<table class="sum-table"><thead>' + head + '</thead><tbody>' + body + '</tbody></table>' +
    '<div class="sum-note">Video còn thiếu là <b>các bài đã quá hạn mà con chưa nộp hoặc phải quay lại, tính đến lúc chốt buổi: ' + sumStamp(t.at) + '</b>. Bài nộp sau thời điểm này chưa có trong bảng, bố mẹ xem trên trang học tập của con nhé.</div></div>';
}
const viewLenLopBeforeSummary = viewLenLop;
viewLenLop = function () {
  const ctx = current ? classContext(current) : null;
  if (ctx && ctx.tracker && summaryOn(ctx.session)) return summaryView(ctx);
  return viewLenLopBeforeSummary();
};
const lockBarBeforeSummary = lockBar;
lockBar = function (can, edit) { const done = current && isChot(current); return '<button class="' + (done ? 'quiet ' : '') + 'rv-sumbtn' + (done ? '' : ' rv-chot') + '" data-act="llSumOpen">' + (done ? '📸 ' + T('Xem bảng chốt', 'Summary') : '✅ ' + T('Rà soát & chốt buổi', 'Review & close')) + '</button>' + lockBarBeforeSummary(can, edit); };
const llActionBeforeSummary = llAction;
llAction = function (act, i, v) {
  if (act === 'llSumOpen' || act === 'llSumClose') { if (current) { summaryOn(current); llSummary.mode = act === 'llSumOpen'; } render(); window.scrollTo(0, 0); return; }
  if (act === 'llSumRefresh') { const c = current && classOf(current); if (c) guarded(() => Promise.all([loadTracker(c, true), loadMarks(true), loadBehave(true).catch(() => {})])); return; }
  return llActionBeforeSummary(act, i, v);
};
// The class screen does not redraw by itself every 30 s; at the end of the lesson it switches to the summary once.
setInterval(() => { if (view === 'lenlop' && current && llSummary.mode === null && chotTime(current) && !document.querySelector('.sum-sheet')) render(); }, 20000);

/* ---------- Live data on the class page and class screen (owner 08/11: "đảm bảo tất cả dữ liệu phải live, update ngay lập tức mà không hết quota") ----------
 * While a class is open and the page is visible: new roll-call rows every 30 s (only the rows added since the last read, one request),
 * the class sheet and the behaviour log every 60 s (three requests), never while this device still has unsent changes for that sheet,
 * and never redrawing under the teacher's finger. About 5 requests a minute per open class, well inside Google's 60. */
const LIVE_MARKS_MS = 30000, LIVE_SHEET_MS = 60000;
const liveAt = { marks: 0, sheet: 0, key: '' };
let liveBusy = false;
async function liveMarks() {
  if (!logs.marks || !marksCount) return loadMarks(true);
  const [rows, [count = []]] = await batchGet(CONFIG.diemDanhId, ['DIEM_DANH!A' + Math.max(2, marksCount - 4) + ':L', 'DIEM_DANH!N1']);
  const n = Number(count[0]) || marksCount, fresh = (rows || []).filter(r => r && r.length && Q.clean(r[0]));
  // A few rows overlap the last read so the range always stays inside the sheet; a repeated row changes nothing (newest per pupil wins).
  if (fresh.length) logs.marks.rows.push(...fresh.map(markOf));
  marksCount = Math.max(marksCount, n);
  logs.marks.at = Date.now();
}
setInterval(async () => {
  if (liveBusy || document.visibilityState !== 'visible' || !me || !current || !['lop', 'lenlop'].includes(view)) return;
  const key = Q.sessionKey(current);
  if (liveAt.key !== key) { liveAt.key = key; liveAt.marks = liveAt.sheet = Date.now(); return; }
  liveBusy = true;
  try {
    const now = Date.now(), c = classOf(current), jobs = [];
    if (now - liveAt.marks >= LIVE_MARKS_MS) { liveAt.marks = now; jobs.push(liveMarks()); }
    const pending = outbox.some(x => (x.kind === 'cell' && c && x.classKey === c.key) || (x.kind === 'append' && x.tab === 'HANH_VI'));
    if (c && !pending && now - liveAt.sheet >= LIVE_SHEET_MS) { liveAt.sheet = now; jobs.push(loadTracker(c, true), loadBehave(true)); }
    if (!jobs.length) return;
    await Promise.all(jobs);
    if (!(view === 'lenlop' && Date.now() < llFreezeUntil)) render();
  } catch (e) { /* a missed refresh is retried on the next tick */ }
  finally { liveBusy = false; }
}, 10000);

// Everything still owed up to the summary (the class sheet's last 60 days), not only the last two weeks the class screen shows.
function totalOwed(ctx) {
  const t = ctx.tracker, day = ctx.session.day, found = t.pupils.map(() => []);
  const assigned = cols => t.pupils.length < 3 || t.pupils.some(p => cols.some(c => Q.videoState(t.cell(p.row, c)) === 'done'));
  const k = classKeyOfBlocks(t.blocks), due = b => (k && scheduleDue(k, b.date)) || Q.videoDue(t.blocks, b);
  t.blocks.filter(b => b.date && b.date < day && b.videos.length && due(b) < day).forEach(b => {
    const cols = b.videos.map(v => v.col);
    if (!assigned(cols)) return;
    t.pupils.forEach((p, i) => {
      if (p.since && b.date < p.since) return;
      if (b.grade >= 0 && Q.isAbsentMark(t.cell(p.row, b.grade))) return;
      b.videos.forEach(v => { const st = Q.videoState(t.cell(p.row, v.col)); if (st === 'missing' || st === 'wrong') found[i].push({ col: v.col, day: b.date, lesson: b.lesson, label: v.label, wrong: st === 'wrong' }); });
    });
  });
  (t.practices || []).filter(p => p.due < day).forEach(x => {
    if (!assigned([x.col])) return;
    t.pupils.forEach((p, i) => { if (p.since && x.due < p.since) return; const st = Q.videoState(t.cell(p.row, x.col)); if (st === 'missing' || st === 'wrong') found[i].push({ col: x.col, day: x.due, lesson: '', label: x.label, wrong: st === 'wrong', practice: true }); });
  });
  return found;
}

/* ---------- Owed work in every class, and IELTS / FIGHTER on the class screen (owner 08/11) ----------
 * "mỗi một lớp giáo viên dạy hiển thị nợ bao nhiêu video... gọn gàng mà vẫn đủ thông tin... màn hình này tôi dùng xuyên suốt buổi học";
 * "áp dụng cả IELTS và FIGHTER... hs lớn không cần sao... bị đuổi về vì thiếu bài tập... hoặc ở nhà luôn vì biết không làm bài thì không được học".
 * KIDS: the chip under the name counts every video still owed (same count as the lesson summary).
 * IELTS / FIGHTER: no stars; the homework still owed for this lesson comes from the class sheet (server 'baino', kept 10 minutes);
 * two extra marks: "Cho về (thiếu bài)" for a pupil who came without the homework, "Nghỉ (chưa làm bài)" for one who stayed home. */
const SEND_HOME = 'Cho về (thiếu bài)', HOME_NO_HW = 'Nghỉ (chưa làm bài)';
const secStatus = r => { const st = current ? ((marksOf(current).get(r.p.name)) || {}).status : ''; return st === SEND_HOME || st === HOME_NO_HW || st === OUT_MAKEUP ? st : ''; };
const secLoading = new Set();
function secOwedFor(s) {
  const c = classOf(s);
  if (!c || !isSecondary(s)) return null;
  const key = c.tracker + '|' + s.day, hit = owedCache[key];
  if ((!hit || Date.now() - hit.at > 600000) && !secLoading.has(key)) {
    secLoading.add(key);
    call('baino', { file: c.tracker, day: s.day }).then(data => { owedCache[key] = { at: Date.now(), data }; }).catch(e => { owedCache[key] = { at: Date.now(), data: null, error: e.message }; }).finally(() => { secLoading.delete(key); render(); });
  }
  return hit && hit.data ? hit : null;
}
// The work a pupil of an IELTS / FIGHTER class still owes for this lesson or earlier.
function secOwedOf(ctx, p) {
  const hit = secOwedFor(ctx.session);
  if (!hit) return null;
  const x = hit.data.pupils.find(q => q.row === p.row) || hit.data.pupils.find(q => Q.key(q.name) === Q.key(p.name));
  const s = ctx.session, started = s.day < today() || (s.day === today() && minutesNow() >= s.start - Q.OPEN_BEFORE);
  return x ? x.owed.filter(o => o.due && (o.due < s.day || (o.due === s.day && started))) : [];
}
const shortTask = o => Q.clean(o.label).replace(/\s+/g, ' ').slice(0, 28) + (Q.clean(o.label).length > 28 ? '…' : '');
const pupilFlagsBeforeSec = pupilFlags;
pupilFlags = function (ctx, r) {
  const m = ctx.marks.get(r.p.name), out = [], st = m ? m.status : '';
  if (st === 'Đến muộn') out.push('<span class="rv-flag late">⏰ Muộn <i class="rv-en-i">Late</i></span>');
  if (st === SEND_HOME) out.push('<span class="rv-flag sent">🚪 Cho về · thiếu bài <i class="rv-en-i">Sent home</i></span>');
  if (st === HOME_NO_HW) out.push('<span class="rv-flag sent">🏠 Ở nhà · chưa làm bài <i class="rv-en-i">Stayed home</i></span>');
  if (isSecondary(ctx.session)) {
    const owed = secOwedOf(ctx, r.p);
    if (owed && owed.length) out.push('<span class="rv-flag debt" title="' + esc(owed.map(o => Q.clean(o.label) + (o.due ? ' · hạn ' + viDate(o.due).slice(0, 5) : '')).join('\n')) + '">📚 Thiếu ' + owed.length + ' bài: ' + esc(owed.slice(0, 2).map(shortTask).join(', ') + (owed.length > 2 ? ' +' + (owed.length - 2) : '')) + ' <i class="rv-en-i">Homework owed</i></span>');
  } else {
    const owed = totalOwed(ctx)[r.i] || [], dm = d => d.slice(8, 10) + '/' + d.slice(5, 7);
    const what = x => (x.practice ? (x.label || 'Tự luyện').replace(/^Tự luyện video/i, 'Tự luyện') : (x.lesson ? 'Tiết ' + Number(x.lesson) : dm(x.day)) + (x.label ? ' ' + x.label.toLowerCase() : '')) + (x.wrong ? ' (quay sai)' : '');
    if (owed.length) out.push('<span class="rv-flag debt" title="' + esc(owed.map(x => what(x) + ' · ' + dm(x.day)).join('\n')) + '">🎥 Thiếu ' + owed.length + ' bài: ' + esc(kidsKinds(owed)) + ' <i class="rv-en-i">Missing video</i></span>');
  }
  return out.length ? '<span class="rv-flags">' + out.join('') + '</span>' : '';
};
// totalOwed runs once per class-sheet read, not once per row.
const totalOwedRaw = totalOwed, totalMemo = { key: '', list: [] };
totalOwed = function (ctx) { const k = Q.sessionKey(ctx.session) + '|' + ctx.tracker.at; if (totalMemo.key !== k) { totalMemo.key = k; totalMemo.list = totalOwedRaw(ctx); } return totalMemo.list; };
function secButtons(ctx, r, live) {
  return '';
  if (!isSecondary(ctx.session)) return '';
  const st = (ctx.marks.get(r.p.name) || {}).status || '';
  if (st === SEND_HOME) return '<button class="rv-send on" data-act="llUnsend" data-i="' + r.i + '"' + live.replace(' disabled', '') + '>🚪 Cho về ✓<small class="rv-en">Undo</small></button>';
  if (st === HOME_NO_HW) return '<button class="rv-send on" data-act="llUnsend" data-i="' + r.i + '"' + live.replace(' disabled', '') + '>🏠 Ở nhà ✓<small class="rv-en">Undo</small></button>';
  if (r.here) return '<button class="rv-send" data-act="llSend" data-i="' + r.i + '"' + live + '>🚪 Cho về<small class="rv-en">Sent home · no homework</small></button>';
  return '<button class="rv-send" data-act="llHomeNoHw" data-i="' + r.i + '"' + live + '>🏠 Ở nhà<small class="rv-en">Stayed home · no homework</small></button>';
}
const llActionBeforeSec = llAction;
llAction = function (act, i, v) {
  if (!['llSend', 'llHomeNoHw', 'llUnsend'].includes(act)) return llActionBeforeSec(act, i, v);
  const ctx = classContext(current), s = ctx.session, pupil = ctx.tracker && ctx.tracker.pupils[Number(i)];
  if (!pupil || !canTeach(s) || !llUnlocked(s)) return;
  llLock.at = Date.now();
  const m = ctx.marks.get(pupil.name);
  appendMark(s, pupil, act === 'llSend' ? SEND_HOME : act === 'llHomeNoHw' ? HOME_NO_HW : 'Có mặt', m && m.contact, m && m.note);
  llFreezeUntil = Date.now() + RANK_WAIT; clearTimeout(llRankTimer); llRankTimer = setTimeout(rerankNow, RANK_WAIT);
  render();
};
// The lesson summary reads the same marks and, for IELTS / FIGHTER, the homework owed.
const attendTextBeforeSec = attendText;
attendText = function (m) {
  const st = m ? m.status : '';
  if (st === SEND_HOME) return '<span class="sum-sent">Cho về · thiếu bài</span>';
  if (st === HOME_NO_HW) return '<span class="sum-sent">Ở nhà · chưa làm bài</span>';
  return attendTextBeforeSec(m);
};
const summaryViewBeforeSec = summaryView;
summaryView = function (ctx) {
  if (!isSecondary(ctx.session)) return summaryViewBeforeSec(ctx);
  const hit = secOwedFor(ctx.session);
  let h = summaryViewBeforeSec(ctx);
  // Replace the video column with the homework still owed, stamped with the time the class sheet was read for it.
  const rows = ctx.tracker.pupils, stamp = hit ? sumStamp(hit.at) : '';
  h = h.replace(/<th>Video còn thiếu[^<]*<\/th>/, '<th>Bài còn thiếu</th>');
  let n = 0;
  const order = [...h.matchAll(/<td class="sum-name"><b>([^<]*)<\/b>/g)].map(mm => mm[1]);
  h = h.replace(/<td class="sum-debt">[\s\S]*?<\/td><\/tr>/g, () => {
    const name = order[n++], p = rows.find(q => esc(q.eng || q.name) === name), owed = p ? secOwedOf(ctx, p) : null;
    const cell = owed == null ? '<span class="sum-muted">Đang đọc…</span>' : owed.length ? '<b>Thiếu ' + owed.length + ' bài:</b> ' + esc(owed.map(o => Q.clean(o.label)).join('; ')) : '<span class="sum-ok">Đủ bài ✓</span>';
    return '<td class="sum-debt">' + cell + '</td></tr>';
  });
  return h.replace(/<div class="sum-note">[\s\S]*?<\/div><\/div>$/, '<div class="sum-note">Bài còn thiếu là <b>các bài đã quá hạn mà con chưa nộp, tính đến lúc chốt buổi' + (stamp ? ': ' + stamp : '') + '</b>. Con thiếu bài thì chưa được vào học; bài nộp sau thời điểm này chưa có trong bảng.</div></div>');
};

/* ---------- Review and close the lesson (owner 08/11) ---------- */
const canConfirm = s => !isChot(s) && (isManager() || isBoard() || takesRoll(s));
function chotBar(s) {
  const c = chotOf(s);
  if (c) return '<div class="chot-done">✅ ' + T('Đã chốt lúc ', 'Closed at ') + esc(String(c.at || '').slice(11, 16)) + (c.by ? ' · ' + esc(c.by) : '') + T(' · không sửa được nữa', ' · locked') +
    '<span class="spacer"></span>' + (isManager() ? '<button class="quiet" data-act="llChotUndo">' + T('Mở lại để sửa', 'Reopen') + '</button>' : '') + '<button class="primary" data-act="llExit">' + T('Thoát lớp', 'Leave class') + '</button></div>';
  if (!canConfirm(s)) return '';
  return '<div class="chot-warn"><b>⚠️ ' + T('Giáo viên rà soát lại một lượt trước khi chốt:', 'Teacher, check once more before closing:') + '</b> ' +
    T('điểm danh (có mặt, muộn, nghỉ), số sao, A+/B/F và lý do, nhắc nhở. Sai chỗ nào thì "Quay lại màn hình lớp" để sửa. Chốt xong sẽ không sửa được nữa.', 'attendance, stars, A+/B/F with reasons, reminders. Go back to fix anything; after closing nothing can be changed.') +
    '<div class="chot-row"><button class="primary chot-go" data-act="llChot">✅ ' + T('Xác nhận đúng, chốt buổi & thoát lớp', 'Confirm, close and leave') + '</button></div></div>';
}
const llActionBeforeChot = llAction;
llAction = function (act, i, v) {
  if (act === 'llChot' || act === 'llChotUndo') {
    const s = current;
    if (!s || (act === 'llChot' ? !canConfirm(s) : !isManager())) return;
    appendMark(s, { row: '', name: CHOT_NAME, eng: '' }, act === 'llChot' ? 'Đã chốt' : 'Bỏ chốt');
    flush();
    if (act === 'llChot') { llLock.open = false; llSummary.mode = true; say(T('Đã chốt buổi. Màn hình chốt bên dưới dùng để chụp gửi phụ huynh.', 'Lesson closed. Use the sheet below for parents.'), 'ok'); }
    render(); window.scrollTo(0, 0);
    return;
  }
  return llActionBeforeChot(act, i, v);
};
// Reopen from the class page too (managers only).
document.addEventListener('click', e => {
  const b = e.target.closest && e.target.closest('[data-act="chotUndo"]');
  if (!b || !current || !isManager()) return;
  appendMark(current, { row: '', name: CHOT_NAME, eng: '' }, 'Bỏ chốt'); flush(); render();
});

/* Deadlines from the Schedule for every owed-work count (owner 08/11: "hạn theo schedule"). */
function scheduleDue(classKey, day) {
  for (const w of Object.values(weeks)) { const s = w.data.sessions.find(x => x.classKey === classKey && x.day === day && x.due); if (s) return s.due; }
  return '';
}
const classKeyOfBlocks = blocks => { const e = Object.entries(trackers).find(([, t]) => t && t.blocks === blocks); return e ? e[0] : ''; };
const owedVideosRaw = Q.owedVideos;
Q.owedVideos = function (pupils, blocks, practices, cell, session, dueOf) {
  const k = classKeyOfBlocks(blocks);
  return owedVideosRaw(pupils, blocks, practices, cell, session, dueOf || (k ? b => scheduleDue(k, b.date) : null));
};

/* ---------- The owner has no hours and no KPI (owner 08/11) ---------- */
function ownerKeys() { return new Set(people.filter(p => /chủ/i.test(p.role || '')).map(p => Q.key(p.name)).concat(me && isOwner() ? [Q.key(me.name)] : [])); }
if (isOwner && me && isOwner() && view === 'cong') view = 'lich';

/* ---------- Lesson columns: only real problems (owner 08/11: "cột tiết học sao cứ báo đang lỗi... nếu lỗi gì bạn fix đi") ----------
 * Columns open by themselves at 6:00, two days ahead, so a later lesson without its column is not a fault; Phonics and Debate sheets
 * have no paper-homework cell by design. Only today and the next two days are checked. */
const AUTO_OPEN_DAYS = 2;
const columnWarningRaw = columnWarning;
columnWarning = function (ctx) {
  const s = ctx.session;
  if (s.day > Q.addDays(today(), AUTO_OPEN_DAYS)) return '';
  if (!ctx.problem) return '';
  return columnWarningRaw(ctx).replace(/ ?TA kiểm tra lại giúp\.| ?TA please check\./g, T(' Cần kiểm tra lại Schedule hoặc sheet lớp.', ' Please check the Schedule or the class sheet.')).replace('cho đến khi TA mở cột', 'cho đến khi cột được mở');
};
columnPanel = function () {
  const rows = [], now = today(), until = Q.addDays(now, AUTO_OPEN_DAYS);
  Object.values(weeks).forEach(w => w.data.sessions.filter(s => classOf(s) && !s.off && s.day >= now && s.day <= until).forEach(s => { const ctx = classContext(s); if (ctx.tracker && ctx.tracker.blocks.length) rows.push(ctx); }));
  rows.sort((a, b) => a.session.day.localeCompare(b.session.day) || a.session.start - b.session.start);
  const note = '<p class="small muted">' + T('Cột tiết học tự mở lúc 6:00 sáng, trước buổi học 2 ngày. Ở đây chỉ kiểm tra hôm nay và 2 ngày tới; lớp Phonics, Debate không có ô bài tập giấy là đúng.', 'Columns open by themselves at 6:00, two days ahead. Only today and the next two days are checked.') + '</p>';
  if (!rows.length) return note + '<div class="card empty">' + T('Chưa có buổi nào trong 3 ngày tới, hoặc đang đọc sheet lớp…', 'No lessons in the next 3 days yet, or still reading.') + '</div>';
  const bad = rows.filter(c => columnWarning(c));
  return note + '<div class="count"><span>' + (bad.length ? bad.length + T(' buổi cần kiểm tra', ' to check') : T('Đủ cột cho hôm nay và 2 ngày tới', 'All columns in place')) + '</span></div><div class="list">' + (bad.length ? bad : rows).map(c => {
    const warn = columnWarning(c);
    return '<div class="card row"><div class="row-top"><b>' + esc(c.session.cls) + ' · ' + T('Tiết ', 'Lesson ') + esc(c.session.lesson) + '</b><span class="muted">' + esc(Q.dayText(c.session.day, lang)) + '</span><span class="tag ' + (warn ? 'bad' : 'ok') + '">' + (warn ? T('Cần kiểm tra', 'Check') : T('Đủ cột', 'OK')) + '</span>' +
      '<span class="spacer"></span><a class="small" target="_blank" rel="noopener" href="https://docs.google.com/spreadsheets/d/' + esc(c.cls.tracker) + '/edit">' + T('Mở sheet lớp', 'Open sheet') + ' ↗</a></div>' + (warn ? '<div class="small">' + esc(warn) + '</div>' : '') + '</div>';
  }).join('') + '</div>';
};

/* ---------- Schedule: whole centre first, the lesson running now first (owner 08/11) ---------- */
let scopeInit = false;
const renderBeforeScope = render;
render = function () { if (me && !scopeInit) { scopeInit = true; if (isManager()) filters.showAll = true; } renderBeforeScope(); hocPhiFrame(); };
// Today: what is running now on top, then what is still to come (morning, afternoon, evening), and finished lessons folded at the bottom.
const dayPartsBeforeNow = dayParts;
dayParts = function (list) {
  if (day !== today()) return dayPartsBeforeNow(list);
  const now = minutesNow(), live = list.filter(s => !s.off && s.start <= now && now < s.end), next = list.filter(s => s.start > now), done = list.filter(s => s.start <= now && !(live.includes(s)));
  let out = '';
  if (live.length) out += '<div class="part p-live"><h2>● ' + T('Đang diễn ra', 'In progress') + '</h2><span>' + live.length + T(' buổi', ' sessions') + '</span></div><div class="grid">' + live.map(sessionCard).join('') + '</div>';
  if (next.length) out += (live.length ? '<div class="part p-next"><h2>' + T('Sắp tới', 'Coming up') + '</h2><span>' + next.length + T(' buổi', ' sessions') + '</span></div>' : '') + dayPartsBeforeNow(next);
  if (done.length) out += '<details class="done-part" open><summary>' + T('Đã xong hôm nay', 'Finished today') + ' · ' + done.length + T(' buổi', ' sessions') + '</summary><div class="grid">' + done.map(sessionCard).join('') + '</div></details>';
  return out || dayPartsBeforeNow(list);
};

/* ---------- Tuition (Học phí) inside this app, for managers and the owner ----------
 * The tuition app is shown in a frame that stays alive while you move around, so it is not reloaded every time this page redraws.
 * It keeps its own sign-in on this device (the personal tuition link); nothing of it passes through this app. */
const HOC_PHI_URL = '../hoc-phi/';
// Once the link is in (pasted here, or the owner says so with "ẩn"), the bar is gone for good on this device (owner 08/11: "đã ấn link vào rồi thì bỏ cái header trên đầu đi").
const hpDone = () => { try { return localStorage.getItem('ql-hp-ok') === '1'; } catch (e) { return false; } };
const hpSetDone = () => { try { localStorage.setItem('ql-hp-ok', '1'); } catch (e) {} };
document.addEventListener('click', e => { if (e.target.closest && e.target.closest('[data-act="hpHide"]')) { hpSetDone(); render(); } });
function viewHocPhi() {
  if (hpDone()) return '';
  return '<div class="hp-bar"><b>💰 ' + T('Học phí', 'Tuition') + '</b><span class="small muted">' + T('Lần đầu trên máy này: dán link học phí riêng của bạn vào ô bên cạnh rồi bấm Mở. Máy sẽ nhớ, lần sau không cần dán.', 'First time on this device: paste your personal tuition link and press Open; it is remembered.') + '</span>' +
    '<input id="hpPaste" type="password" autocomplete="off" placeholder="' + T('Dán link học phí…', 'Paste the tuition link…') + '"><button class="primary" data-act="hpOpen">' + T('Mở', 'Open') + '</button><span class="spacer"></span><button class="quiet" data-act="hpHide">' + T('Đã dán rồi · ẩn dòng này', 'Already done · hide') + '</button></div>';
}
function hocPhiFrame() {
  let f = document.getElementById('hpFrame');
  const show = view === 'hocphi' && me && isManager() && !isBoard();
  if (!show) { if (f) f.hidden = true; return; }
  if (!f) { f = document.createElement('iframe'); f.id = 'hpFrame'; f.title = 'Học phí'; f.src = HOC_PHI_URL; f.setAttribute('allow', 'clipboard-write'); document.body.appendChild(f); }
  f.hidden = false;
  const bar = document.querySelector('header');
  f.classList.add('hp-full');
  // An iframe does not stretch between top and bottom like a box does, so its height is set too (owner 09/11 photo: it stayed 150px).
  // While the "paste your tuition link" bar is still shown (first time on this device), the frame starts under it, never over it.
  const hb = document.querySelector('.hp-bar');
  const top = Math.max(0, Math.round(hb ? hb.getBoundingClientRect().bottom + 8 : bar ? bar.getBoundingClientRect().bottom : 0));
  f.style.top = top + 'px';
  f.style.height = Math.max(320, innerHeight - top) + 'px';
}
addEventListener('resize', () => { try { if (view === 'hocphi') hocPhiFrame(); } catch (e) {} });

/* ---------- One person, one name (owner 08/11) ---------- */
// A short name from the rota (SON) is the staff member whose name ends with it (VAN SON), when exactly one does.
function canonStaff(name) {
  const k = Q.key(name);
  if (!k || people.some(p => Q.key(p.name) === k)) return name;
  const hits = people.filter(p => { const pk = Q.key(p.name); return pk.endsWith(' ' + k) || pk.split(' ')[0] === k; });
  return hits.length === 1 ? hits[0].name : name;
}
/* ---------- Important Task: a TA sees the return date, not the teacher's grading date ---------- */
let taskTaView = false;
const taskStateRaw = Q.taskState;
Q.taskState = function (t, d) {
  if (!taskTaView || t.done || !isMe(t.ta) || isMe(t.teacher)) return taskStateRaw(t, d);
  if (t.returnDue && t.returnDue < d) return { state: 'quahan', text: 'Quá hạn trả' };
  if (t.returnDue === d) return { state: 'homnay', text: 'Hạn trả hôm nay' };
  return { state: 'sap', text: 'Chưa đến hạn trả' };
};
const taskRowRaw = taskRow;
taskRow = function (t, week, canTick) { taskTaView = true; try { return taskRowRaw(t, week, canTick); } finally { taskTaView = false; } };

// The pasted link goes straight into the tuition frame (which keeps it on this device); this app never stores it.
document.addEventListener('click', e => {
  const b = e.target.closest && e.target.closest('[data-act="hpOpen"]');
  if (!b) return;
  const box = document.getElementById('hpPaste'), link = String(box && box.value || '').trim(), base = new URL(HOC_PHI_URL, location.href).href;
  if (box) box.value = '';
  if (!link.startsWith(base)) return say(T('Link này không phải link trang học phí. Dán đúng link học phí cô Trang gửi.', 'This is not a tuition link.'), 'bad');
  hpSetDone(); view = 'hocphi'; render();
  const f = document.getElementById('hpFrame'); if (f) f.src = link;
});

/* IELTS / FIGHTER on the class page: two more choices beside roll call (owner 08/11). */
function secClassButtons(ctx, p, i, canEdit) {
  if (!isSecondary(ctx.session)) return '<div></div>';
  const st = (ctx.marks.get(p.name) || {}).status || '', dis = canEdit ? '' : ' disabled';
  // Icon and words apart, so the tiled roll call can show the icon alone (owner 09/11: "biểu tượng như đã chốt"), with a legend above.
  const btn = (v, label, on) => { const sp = label.indexOf(' '), ic = label.slice(0, sp), tx = label.slice(sp + 1); return '<button class="sec-mark' + (on ? ' on' : '') + '" data-act="secMark" data-i="' + i + '" data-v="' + esc(on ? 'Bỏ tick' : v) + '" title="' + esc(tx) + (on ? ' ✓' : '') + '" aria-label="' + esc(tx) + '"' + dis + '><span class="sm-ic">' + ic + '</span><span class="sm-t"> ' + tx + '</span>' + (on ? '<span class="sm-ok"> ✓</span>' : '') + '</button>'; };
  // Owner 10/11: classes taught by Vietnamese teachers already got the parents' message, so "Nghỉ · đã báo" is on the roll call too.
  return '<div class="sec-marks">' + btn('Đã báo nghỉ', '✉️ ' + T('Nghỉ · đã báo', 'Absent, notified'), st === 'Đã báo nghỉ') + btn(SEND_HOME, '🚪 ' + T('Cho về · thiếu bài', 'Sent home'), st === SEND_HOME) + btn(HOME_NO_HW, '🏠 ' + T('Ở nhà · chưa làm bài', 'Stayed home'), st === HOME_NO_HW) +
    // Owner 09/11: "IELTS FIGHTER cũng cần có nút ở ngoài bù bài không được học... cùng với sent home".
    btn(OUT_MAKEUP, '📝 ' + T('Ra ngoài bù bài · không vào học', 'Makes up work outside'), st === OUT_MAKEUP) + '</div>';
}
document.addEventListener('click', e => {
  const b = e.target.closest && e.target.closest('[data-act="secMark"]');
  if (!b || !current) return;
  const ctx = classContext(current), pupil = ctx.tracker && ctx.tracker.pupils[Number(b.dataset.i)];
  if (!pupil || !classCanEdit(ctx.session)) return;
  const m = ctx.marks.get(pupil.name);
  // An absence also goes into the sheet ("/ Vắng mặt" in the lesson comment), like the absence choice of the HS vắng tab.
  if (b.dataset.v === 'Đã báo nghỉ') return setAbsence(ctx, pupil, 'Đã báo nghỉ');
  appendMark(ctx.session, pupil, b.dataset.v, m && m.contact, m && m.note);
  render();
});

/* ---------- Part-time hours by the rota (owner 08/11) ----------
 * "họ ấn vào ca và ra ca... nếu muộn thì trừ công, còn nếu sớm là họ đến sớm; muộn hơn là họ về muộn, còn chấm công theo giờ quy định...
 * nếu có buổi vào làm thêm ấn vào ca ra ca thì tôi duyệt". A shift on the rota ("PHUONG THANH (17.00-21.30)") is paid from its start
 * (or the later check-in) to its end (or the earlier check-out); coming early or staying late adds nothing. A day with no shift on the
 * rota is extra work: it counts from check-in to check-out only after a manager or the owner approves it. */
function shiftFor(person, day) {
  for (const w of Object.values(weeks)) {
    const x = w.data.duty && w.data.duty.days[day];
    if (!x) continue;
    const p = x.work.find(q => sameName(canonStaff(q.name), person) || sameName(q.name, person));
    return p ? Q.shiftOf(p.note) : null;
  }
  return undefined;
}
const caHoursRaw = caHours;
caHours = function (rows, person, prefix) {
  const base = caHoursRaw(rows, person, prefix);
  if (!isPartTime(person)) return base;
  let total = 0;
  base.days.forEach(d => {
    const a = d.in ? hm(d.in.time) : null, b = d.out ? hm(d.out.time) : null, sh = shiftFor(person, d.day);
    d.shift = sh || null; d.extra = sh === null; d.late = sh && a != null ? Math.max(0, a - sh.start) : 0;
    if (d.rejected || a == null) d.minutes = 0;
    else if (sh) d.minutes = Math.max(0, Math.min(b == null ? sh.end : b, sh.end) - Math.max(a, sh.start));
    else d.minutes = (d.inStatus === 'Đã duyệt') && b != null && b > a ? b - a : 0;
    if (d.extra && d.inStatus !== 'Đã duyệt') d.needsApproval = true;
    total += d.minutes;
  });
  base.total = total;
  base.extraWaiting = base.days.filter(d => d.needsApproval).length;
  return base;
};

/* ---------- Printing duty (owner 08/11: "lịch in cũng cần tick đã hoàn thành") ----------
 * The rota row "Phụ trách in ấn" names who prints for the next lesson day; that person (or a manager) ticks it done.
 * The tick is a row in DIEM_DANH (class "IN ẤN"), which every staff member can read and write. */
const PRINT_CLS = 'IN ẤN';
const printDone = (d, name) => { const rows = (logs.marks ? logs.marks.rows : []).filter(r => r.cls === PRINT_CLS && r.day === d && sameName(r.name, name)); const last = rows[rows.length - 1]; return last && last.status === 'Đã in xong' ? last : null; };
function printCard(week) {
  const x = dutyOf(week, day);
  if (!x || !x.print || !x.print.length) return '';
  if (!logs.marks) setTimeout(() => loadMarks().then(render).catch(() => {}), 0);
  return '<div class="card row print-card"><b>🖨️ ' + T('In ấn', 'Printing') + '</b>' + x.print.map(p => {
    const done = printDone(day, p.name), can = isMe(p.name) || isManager();
    return '<span class="person' + (isMe(p.name) ? ' me' : '') + '">' + esc(Q.key(p.name)) + (p.note ? ' <i>' + esc(p.note) + '</i>' : '') + '</span>' +
      (done ? '<span class="done">✓ ' + T('Đã in xong', 'Printed') + ' ' + esc(String(done.at || '').slice(11, 16)) + '</span>' + (can ? ' <button class="quiet" data-act="printTick" data-p="' + esc(p.name) + '" data-v="Bỏ in">' + T('Bỏ', 'Undo') + '</button>' : '')
        : can ? '<button class="primary" data-act="printTick" data-p="' + esc(p.name) + '" data-v="Đã in xong">✓ ' + T('Đã in xong', 'Done printing') + '</button>' : '<span class="tag warn">' + T('Chưa in', 'Not yet') + '</span>');
  }).join('') + '</div>';
}
const dutyBlockRaw = dutyBlock;
dutyBlock = function (week) { const h = dutyBlockRaw(week); return h ? h + printCard(week) : (isTaSide(week) ? printCard(week) : ''); };
document.addEventListener('click', e => {
  const b = e.target.closest && e.target.closest('[data-act="printTick"]');
  if (!b) return;
  const name = b.dataset.p;
  if (!(isMe(name) || isManager())) return;
  appendMark({ day, cls: PRINT_CLS, lesson: '', start: 0 }, { row: '', name, eng: '' }, b.dataset.v);
  render();
});
// The bell reminds the person on printing duty today.
const bellItemsBeforePrint = bellItems;
bellItems = function () {
  const out = bellItemsBeforePrint();
  try {
    const t = today(), x = dutyOf(weeks[Q.weekTab(tabs, t)] || null, t);
    (x && x.print || []).filter(p => isMe(p.name) && !printDone(t, p.name)).forEach(p => out.push({ k: 'print', icon: '🖨️', text: T('Bạn in bài', 'You print') + (p.note ? ' (' + p.note + ')' : '') + T(' · chưa tick xong', ' · not ticked yet'), n: 1, hot: minutesNow() >= 18 * 60, go: { view: 'lich', sec: 'lamviec' } }));
  } catch (e) {}
  return out;
};

/* ---------- KIDS level 3: called out to make up the work (owner 08/11: "gọi ra học riêng làm bài chứ không phải nghỉ") ----------
 * On the class page a pupil at level 3 or more today gets "Ra ngoài bù bài"; the mark counts as present, the class screen shows them
 * as working outside, and "Bù xong · vào lớp" brings them back. */
const MAKEUP = 'Bù bài (mức 3)';
function ladderLevel(s, p) {
  if (!ladder.rows) { if (!ladder.loading) { ladder.loading = true; loadLadder().catch(() => {}).finally(() => { ladder.loading = false; render(); }); } return 0; }
  const k = Q.key(p.name), hits = ladder.rows.filter(r => Q.key(r.cls) === Q.key(s.cls) && Q.key(r.name).startsWith(k));
  return hits.length ? Math.max(...hits.map(r => r.level)) : 0;
}
function kidsMakeup(ctx, p, i, canEdit) {
  const s = ctx.session;
  if (isSecondary(s) || !/^KIDS/i.test(Q.clean(s.cls))) return '';
  const st = (ctx.marks.get(p.name) || {}).status || '', dis = canEdit ? '' : ' disabled';
  if (st === MAKEUP) return '<button class="mk-btn on" data-act="mkMark" data-i="' + i + '" data-v="Có mặt"' + dis + '>📝 ' + T('Đang bù bài ngoài lớp · bấm khi bù xong, vào lớp', 'Making up work outside · tap when done') + '</button>';
  const lv = ladderLevel(s, p);
  return lv >= 3 ? '<button class="mk-btn" data-act="mkMark" data-i="' + i + '" data-v="' + MAKEUP + '"' + dis + '>📝 ' + T('Mức ' + lv + ': ra ngoài bù bài', 'Level ' + lv + ': make up work outside') + '</button>' : '';
}
document.addEventListener('click', e => {
  const b = e.target.closest && e.target.closest('[data-act="mkMark"]');
  if (!b || !current) return;
  const ctx = classContext(current), pupil = ctx.tracker && ctx.tracker.pupils[Number(b.dataset.i)];
  if (!pupil || !classCanEdit(ctx.session)) return;
  const m = ctx.marks.get(pupil.name);
  appendMark(ctx.session, pupil, b.dataset.v, m && m.contact, m && m.note);
  render();
});
// Class screen and summary: show it, and keep the row looking set aside.
const pupilFlagsBeforeMk = pupilFlags;
pupilFlags = function (ctx, r) {
  const st = (ctx.marks.get(r.p.name) || {}).status || '', h = pupilFlagsBeforeMk(ctx, r);
  if (st !== MAKEUP) return h;
  const flag = '<span class="rv-flag mk">📝 Đang bù bài ngoài lớp <i class="rv-en-i">Making up work</i></span>';
  return h ? h.replace('<span class="rv-flags">', '<span class="rv-flags">' + flag) : '<span class="rv-flags">' + flag + '</span>';
};
const attendTextBeforeMk = attendText;
attendText = function (m) { return m && m.status === MAKEUP ? '<span class="sum-sent">Bù bài ngoài lớp (mức 3)</span>' : attendTextBeforeMk(m); };

/* ---------- IELTS / FIGHTER owed work, short (owner 08/11: "hiển thị thiếu bài gì bên fighter ielts còn dài dòng... ngắn gọn hơn") ---------- */
// Owner 10/11 (F6): FIGHTER practice tests have two parts, the notebooks and redoing the test on the web; a "Practice Test" is not a "Kiểm tra".
const SKILLS = [[/sổ luyện đề|sổ từ vựng/i, 'Sổ luyện đề'], [/làm lại trên web/i, 'Làm lại đề web'], [/luyện đề|practice test/i, 'Luyện đề'], [/đoạn văn/i, 'Đoạn văn'], [/writing|viết/i, 'Viết'], [/speaking|nói/i, 'Nói'], [/reading|đọc/i, 'Đọc'], [/listening|nghe/i, 'Nghe'], [/vocab|từ vựng/i, 'Từ vựng'], [/grammar|ngữ pháp/i, 'Ngữ pháp'], [/test|kiểm tra/i, 'Kiểm tra']];
const skillOf = o => { const t = Q.clean(o.label); const hit = SKILLS.find(([re]) => re.test(t)); return hit ? hit[1] : t.split(' ').slice(0, 2).join(' '); };
const skillSummary = owed => { const n = {}; owed.forEach(o => { const k = skillOf(o); n[k] = (n[k] || 0) + 1; }); return Object.entries(n).map(([k, c]) => k + (c > 1 ? ' ×' + c : '')).join(', '); };
const pupilFlagsBeforeShort = pupilFlags;
pupilFlags = function (ctx, r) {
  const h = pupilFlagsBeforeShort(ctx, r);
  if (!isSecondary(ctx.session)) return h;
  return h.replace(/📚 Thiếu (\d+) bài: [^<]*?( <i class="rv-en-i">Homework owed<\/i>)/, (m0, n, tail) => { const owed = secOwedOf(ctx, r.p) || []; return '📚 Thiếu ' + n + ' bài: ' + esc(skillSummary(owed)) + tail; });
};
const summaryViewBeforeShort = summaryView;
summaryView = function (ctx) {
  const h = summaryViewBeforeShort(ctx);
  if (!isSecondary(ctx.session)) return h;
  const rows = ctx.tracker.pupils;
  return h.replace(/<tr([^>]*)><td class="sum-rank">([\s\S]*?)<td class="sum-name"><b>([^<]*)<\/b>([\s\S]*?)<td class="sum-debt"><b>Thiếu (\d+) bài:<\/b> [^<]*<\/td><\/tr>/g, (m0, a1, a2, name, mid, n) => {
    const p = rows.find(q => esc(q.eng || q.name) === name), owed = p ? secOwedOf(ctx, p) || [] : [];
    return '<tr' + a1 + '><td class="sum-rank">' + a2 + '<td class="sum-name"><b>' + name + '</b>' + mid + '<td class="sum-debt"><b>Thiếu ' + n + ' bài:</b> ' + esc(skillSummary(owed)) + '</td></tr>';
  });
};

/* ---------- Printing counts as a task in the KPI (owner 08/11: "việc in bài cũng tính KPI... nó là 1 loại nhiệm vụ") ---------- */
const kpiOfBeforePrint = kpiOf;
kpiOf = function (person, month, src) {
  const k = kpiOfBeforePrint(person, month, src), now = today();
  const task = k.parts.find(p => p.k === 'task');
  if (!task) return k;
  Object.values(weeks).forEach(w => Object.entries((w.data.duty && w.data.duty.days) || {}).forEach(([d, x]) => {
    if (!d.startsWith(month) || d > now) return;
    (x.print || []).filter(p => sameName(canonStaff(p.name), person)).forEach(p => { task.total++; if (printDone(d, p.name)) task.done++; else k.detail.task.push(T('In bài ', 'Printing ') + viDate(d).slice(0, 5)); });
  }));
  task.rate = task.total ? task.done / task.total : null;
  let sum = 0, weight = 0;
  k.parts.forEach(p => { if (p.total) { sum += p.w * p.done / p.total; weight += p.w; } });
  k.score = weight ? Math.round(sum / weight * 100) : null;
  return k;
};

/* ---------- Homework status on today's lesson cards (owner 08/11: "nay đến lớp nào dạy hoặc TA hoặc quay thì cũng hiện tình trạng làm bài tập") ---------- */
function owedLine(s) {
  if (s.off || s.day !== today() || !classOf(s)) return '';
  if (!(isManager() || isMe(s.teacher) || isMe(s.ta) || isMe(s.video))) return '';
  let names = [];
  if (isSecondary(s)) {
    const hit = secOwedFor(s);
    if (!hit) return '';
    const started = minutesNow() >= s.start - Q.OPEN_BEFORE; // 14/11: from the moment the roll call opens
    names = hit.data.pupils.map(p => ({ n: p.eng || p.name, c: p.owed.filter(o => o.due && (o.due < s.day || (o.due === s.day && started))).length })).filter(x => x.c);
  } else {
    const t = trackers[classOf(s).key];
    if (!t || !t.blocks.length) return '';
    const owed = totalOwed(classContext(s));
    names = t.pupils.map((p, i) => ({ n: p.eng || p.name, c: (owed[i] || []).length })).filter(x => x.c);
  }
  if (!names.length) return '<div class="s-owed ok">📚 ' + T('Cả lớp không thiếu bài', 'No missing work') + '</div>';
  names.sort((a, b) => b.c - a.c);
  return '<div class="s-owed">📚 ' + names.length + T(' bạn thiếu bài: ', ' pupils owe work: ') + esc(names.slice(0, 4).map(x => x.n + (x.c > 1 ? ' (' + x.c + ')' : '')).join(', ') + (names.length > 4 ? ' +' + (names.length - 4) : '')) + '</div>';
}
const sessionCardBeforeOwed = sessionCard;
sessionCard = function (s) {
  const h = sessionCardBeforeOwed(s), line = '';
  if (!line) return h;
  const i = h.lastIndexOf('</div></button>') >= 0 ? h.lastIndexOf('</div></button>') : h.lastIndexOf('</div></div>');
  return i >= 0 ? h.slice(0, i) + line + h.slice(i) : h + line;
};

/* ---------- HS vắng, tidy and live (owner 08/11: "đang hiển thị lung tung... TK VAN SON vẫn không có thông tin, cần truyền thông tin live") ----------
 * Pupils still to check come first, one card per lesson; checked ones are folded below with what was decided and by whom.
 * The roll-call log is re-read every 30 s while the tab is open, so a decision on one device shows on every other. */
absencePanel = function () {
  const from = Q.addDays(today(), -7), now = today(), todo = [], done = [];
  Object.values(weeks).forEach(w => w.data.sessions.filter(s => classOf(s) && !isGroup(s) && !s.off && s.day >= from && s.day <= now && s.day >= (classOf(s).since || '')).forEach(s => {
    const ctx = classContext(s);
    if (!ctx.tracker) return;
    const roll = Q.rollCall(s, ctx.marks, now, minutesNow());
    if (!roll.past) return;
    if (roll.noRollCall) { todo.push({ s, none: true, list: [] }); return; }
    const list = ctx.tracker.pupils.map(p => ({ p, m: ctx.marks.get(p.name), st: Q.pupilState(ctx.marks.get(p.name), roll) })).filter(x => x.st === 'Vắng chờ xác minh' || Q.ABSENT.includes(x.st));
    const open = list.filter(x => x.st === 'Vắng chờ xác minh'), shut = list.filter(x => x.st !== 'Vắng chờ xác minh');
    if (open.length) todo.push({ s, list: open });
    if (shut.length) done.push({ s, list: shut });
  }));
  const byTime = (a, b) => (b.s.day + Q.clock(b.s.start)).localeCompare(a.s.day + Q.clock(a.s.start));
  todo.sort(byTime); done.sort(byTime);
  const head = s => '<div class="row-top"><b>' + esc(s.cls) + T(' · Tiết ', ' · Lesson ') + esc(s.lesson) + '</b><span class="muted small">' + esc(Q.dayText(s.day, lang)) + ' · ' + sessionTime(s) + '</span><span class="spacer"></span><button class="quiet" data-act="open" data-row="' + s.row + '" data-day="' + s.day + '">' + T('Mở lớp', 'Open') + '</button></div>';
  const phoneOf = p => { const ph = (String(p.phone || '').match(/[\d ]{9,}/) || [''])[0].trim(); return ph ? '<a class="small" href="tel:' + esc(ph.replace(/\s/g, '')) + '">📞 ' + esc(ph) + '</a>' : ''; };
  const choice = (s, x, v, cls) => '<button class="' + (x.st === v ? 'on ' : '') + cls + '" data-act="absence" data-v="' + v + '" data-row="' + s.row + '" data-day="' + s.day + '" data-name="' + esc(x.p.name) + '">' + esc(stateText(v)) + '</button>';
  const pupilLine = (s, x) => '<div class="abs-line"><div class="abs-who"><b>' + esc(x.p.eng || x.p.name) + '</b> <span class="small muted">' + esc(x.p.name) + '</span> ' + phoneOf(x.p) + '</div>' +
    '<div class="choices">' + choice(s, x, 'Có phép', 'mid') + choice(s, x, 'Không phép', 'low') + '<button class="' + (x.m && x.m.contact ? 'on good' : 'good') + '" data-act="contact" data-row="' + s.row + '" data-day="' + s.day + '" data-name="' + esc(x.p.name) + '">' + T('Đã liên hệ PH', 'Parent contacted') + '</button></div></div>';
  let h = '<div class="count"><span>' + (todo.length ? todo.reduce((n, c) => n + (c.none ? 1 : c.list.length), 0) + T(' mục chờ xác minh', ' to check') : T('Không còn mục chờ xác minh', 'Nothing left to check')) + '</span><span class="small muted">' + T('Tự cập nhật mỗi 30 giây', 'Updates every 30 s') + '</span></div>';
  h += todo.length ? '<div class="list">' + todo.map(c => '<div class="card row">' + head(c.s) + (c.none ? '<div class="notice bad">' + T('GV chưa điểm danh buổi này', 'Roll call not taken') + ' (' + esc(rollTaker(c.s)) + ').</div>' : c.list.map(x => pupilLine(c.s, x) + markTrail(c.s, x.p)).join('')) + '</div>').join('') + '</div>' : '';
  if (done.length) h += '<details class="card row abs-done" open><summary>' + T('Đã xác minh trong 7 ngày', 'Checked in the last 7 days') + ' · ' + done.reduce((n, c) => n + c.list.length, 0) + '</summary>' +
    done.map(c => '<div class="abs-group">' + head(c.s) + c.list.map(x => pupilLine(c.s, x) + markTrail(c.s, x.p)).join('') + '</div>').join('') + '</details>';
  return h;
};
// Live: the absence tab, the overview and the check-in tab re-read the roll-call log (and check-ins) every 30 s while open.
let panelLiveBusy = false, panelLiveAt = 0;
setInterval(async () => {
  if (panelLiveBusy || document.visibilityState !== 'visible' || !me || view !== 'dieuhanh' || !['vang', 'tong', 'ca'].includes(panel) || Date.now() - panelLiveAt < 30000) return;
  panelLiveBusy = true; panelLiveAt = Date.now();
  try { await Promise.all([liveMarks(), panel === 'vang' ? Promise.resolve() : loadCaAll(true)]); const a = document.activeElement; if (!(a && /^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName))) render(); } catch (e) {} finally { panelLiveBusy = false; }
}, 10000);

/* ---------- Lesson comment written into the sheet at the close (owner 08/11: "nếu mất tập trung thì nhận xét tương ứng chứ") ----------
 * On "Xác nhận đúng, chốt buổi", each present pupil's "Nhận xét" cell of the lesson gets one line per reminder, in Vietnamese for
 * parents; a pupil with none gets a short praise line. Lines the teacher typed in the sheet are kept under ours; our own lines
 * (they start with ⚠️ ⛔ 👍 ⏰ ✓) are replaced, so closing again after a reopen never doubles them. The server colours warnings red. */
const AUTO_LINE = /^(⚠️|⛔|👍|⏰|✓|🏆|🌟|🚪|🏠|📝|📕)/u;
const COMMENT_LINES = {
  'Mất tập trung': 'con còn mất tập trung, cần chú ý nghe giảng hơn.',
  'Mất trật tự': 'con còn mất trật tự, cần giữ trật tự trong lớp.',
  'Dùng điện thoại': 'con dùng điện thoại trong giờ học.',
  'Làm việc riêng': 'con làm việc riêng, cần tập trung vào bài hơn.'
};
function lessonComment(counts, m, extra) {
  const x = n => n > 1 ? ' (' + n + ' lần)' : '', out = [];
  // Owner 09/11: IELTS / FIGHTER comments name the reminders only, as on the close sheet ("không phải phiên ra như KIDS").
  if (extra && extra.short) {
    // Owner 10/11: sent home, stayed home without homework and make-up outside the room are written in the lesson comment too.
    const st = m && m.status, lead = st === SEND_HOME ? '🚪 Cho về (thiếu bài)' : st === HOME_NO_HW ? '🏠 Nghỉ ở nhà (chưa làm bài)' : st === OUT_MAKEUP ? '📝 Ra ngoài bù bài, không vào học' : '';
    if (lead) out.push(lead);
    if (counts[CANH_CAO]) out.push('⛔ Cảnh cáo' + x(counts[CANH_CAO]));
    Object.entries(counts).forEach(([k, n]) => { if (k !== CANH_CAO && k !== PRAISE) out.push('⚠️ ' + k + x(n)); });
    if (counts[PRAISE]) out.push('👍 ' + PRAISE + x(counts[PRAISE]));
    if (!out.length) out.push('✓ Tốt');
    return out;
  }
  if (counts[CANH_CAO]) out.push('⛔ Bị cảnh cáo' + x(counts[CANH_CAO]) + ' trong buổi học.');
  Object.entries(counts).forEach(([k, n]) => { if (k === CANH_CAO || k === PRAISE) return; out.push('⚠️ ' + k + x(n) + ': ' + (COMMENT_LINES[k] || 'con cần cố gắng hơn.')); });
  if (counts[PRAISE]) out.push('👍 Con phát biểu tốt' + x(counts[PRAISE]) + '.');
  // Lateness stays in the attendance column only (a roll taken late would mark the whole class late in every comment).
  if (!out.length || out.every(l => l.startsWith('👍'))) out.push(pickLine(GOOD_LINES, extra && extra.seed));
  // Owner 08/11: the top stars of the lesson get their own praise line.
  if (extra && extra.rank && extra.stars) out.unshift(TOP_LINES[extra.rank - 1](extra.stars));
  return out;
}
function writeLessonComments(ctx) {
  const { block, tracker, cls, session } = ctx;
  if (!block || block.comment < 0 || !tracker) return 0;
  const behave = behaveFor(session);
  const here = p => { const m = ctx.marks.get(p.name); return m && Q.PRESENT.includes(m.status); };
  const scores = block.stars >= 0 ? [...new Set(tracker.pupils.filter(here).map(p => starsOf(ctx, p)).filter(Boolean))].sort((a, b) => b - a) : [];
  let n = 0;
  const short = /^(IELTS|FIGHTER)/.test(Q.key(session.cls)), offRoom = [SEND_HOME, HOME_NO_HW, OUT_MAKEUP];
  tracker.pupils.forEach(p => {
    const m = ctx.marks.get(p.name);
    if (!m || !(Q.PRESENT.includes(m.status) || (short && offRoom.includes(m.status)))) return;
    const b = behave.get(p.name), st = block.stars >= 0 ? starsOf(ctx, p) : 0, rank = st ? scores.indexOf(st) + 1 : 0;
    const auto = lessonComment(tagCounts(b ? b.tags : []), m, { stars: st, rank: rank && rank <= 3 ? rank : 0, seed: p.name + '|' + session.day, short: /^(IELTS|FIGHTER)/.test(Q.key(session.cls)) });
    // Owner 11/11: the parent page shows this comment ("Lời cô dặn") but only the letter of the paper grade, so a B or F carries its
    // reason here too (the server writes an English reason in Vietnamese).
    if (block.grade >= 0) { const gp = gradeParts(tracker.cell(p.row, block.grade)), why = gp.why || gp.rest.join('; '); if (/^(B|F)$/.test(gp.g || '') && Q.clean(why)) auto.push('📕 Sách giấy ' + gp.g + ': ' + Q.clean(why)); }
    const now = String(tracker.cell(p.row, block.comment) || ''), mine = now.split('\n').filter(l => l.trim() && !AUTO_LINE.test(l.trim()));
    let value = auto.concat(mine).join('\n');
    if (value.length > NX_MAX) { const at = mine.findIndex(l => l.startsWith(NX_MARK)); value = auto.concat(at >= 0 ? mine.slice(at) : []).join('\n').slice(0, NX_MAX); }
    if (value === now) return;
    const range = quote(tracker.tab) + '!' + Q.colName(block.comment) + p.row;
    tracker.set(p.row, block.comment, value);
    queue({ kind: 'cell', file: cls.tracker, classKey: cls.key, range, row: p.row, col: block.comment, expected: now, value, label: (p.eng || p.name) + ' · ' + T('Nhận xét', 'Comment') });
    n++;
  });
  return n;
}
const llActionBeforeComments = llAction;
llAction = function (act, i, v) {
  if (act === 'llChot' && current && canConfirm(current)) { try { writeLessonComments(classContext(current)); } catch (e) { console.warn('comments', e); } }
  return llActionBeforeComments(act, i, v);
};

/* ---------- Scan, pick the class, the board opens it (owner 08/11: "giáo viên cũng ghép... quét QR xong chọn lớp xong vào luôn") ----------
 * The class screen (opened at .../quan-li-lop/#bang, or with "Đây là màn hình lớp") shows a QR of its pairing code.
 * A teacher scans it with the phone camera: the app opens on the phone with today's lessons of that person (all lessons for
 * a manager); one tap and the board signs in as "MÀN HÌNH <class>" and goes straight into that lesson's class screen. */
const PAIR_FROM_LINK = (location.hash.match(/(?:^#|&)ghep=(\d{6})/) || [])[1] || '';
const BOARD_LINK_WANTED = /^#bang$/.test(location.hash);
if (PAIR_FROM_LINK) history.replaceState(null, '', location.pathname + location.search);
let pairWant = PAIR_FROM_LINK, pairBusy = false;
const APP_BASE = location.origin + location.pathname;
function qrSvg(text) {
  try { const q = qrcode(0, 'M'); q.addData(text); q.make(); return q.createSvgTag({ cellSize: 4, margin: 2, scalable: true, alt: 'QR' }); } catch (e) { return ''; }
}
paintBoardCode = function () {
  const box = document.getElementById('boardCode');
  if (!box) return;
  if (!boardPair.code) { const c0 = box.closest('.login-box'); if (c0) c0.classList.remove('qr-on'); box.innerHTML = boardPair.err ? '<p class="bad">' + esc(boardPair.err) + '</p>' : ''; return; }
  const left = Math.max(1, Math.round((boardPair.until - Date.now()) / 60000)), qr = qrSvg(APP_BASE + '#ghep=' + boardPair.code);
  const card = box.closest('.login-box'); if (card) card.classList.toggle('qr-on', !!qr);
  box.innerHTML = (qr ? '<div class="board-qr">' + qr + '</div>' : '') +
    '<p class="board-qr-t"><b>' + T('Giáo viên mở camera điện thoại, quét mã', 'Teacher: scan with your phone camera') + '</b><br>' + T('rồi chọn lớp. Màn hình tự vào lớp.', 'then pick the class. The screen opens it.') + '</p>' +
    '<div class="board-code small-code">' + boardPair.code.slice(0, 3) + ' ' + boardPair.code.slice(3) + '</div>' +
    '<p class="small muted">' + T('Hoặc quản lí gõ mã này ở Điều hành › Màn hình lớp. Mã tự đổi sau ' + left + ' phút.', 'Or a manager types this code in Điều hành › Class screens. Renews in ' + left + ' min.') + '</p>';
};
// The board link ".../quan-li-lop/#bang" shows the QR at once, no button to press.
if (BOARD_LINK_WANTED) setTimeout(() => { if (!$('login').hidden && !boardPair.code) boardStart(); }, 400);

// Phone side: the lessons this person may open on the board, the running one first.
function pairChoices() {
  const t = today(), w = weeks[Q.weekTab(tabs, t)];
  if (!w) return null;
  const now = minutesNow(), rank = s => now >= s.start - 30 && now <= s.end ? 0 : now < s.start ? 1 : 2;
  return w.data.sessions.filter(s => s.day === t && !s.off && classOf(s) && (isManager() || isMe(s.teacher) || isMe(s.video) || isMe(s.ta)))
    .sort((a, b) => rank(a) - rank(b) || a.start - b.start);
}
function paintPairBox() {
  let box = document.getElementById('pairBox');
  if (!pairWant || !me || isBoard()) { if (box) box.remove(); return; }
  if (!box) { box = document.createElement('div'); box.id = 'pairBox'; document.body.appendChild(box); }
  const list = pairChoices(), now = minutesNow();
  const tag = s => now >= s.start && now <= s.end ? '<i class="on">● ' + T('Đang diễn ra', 'Now') + '</i>' : now < s.start ? '<i>' + T('Lúc ', 'At ') + Q.clock(s.start) + '</i>' : '<i class="done">' + T('Đã xong', 'Done') + '</i>';
  box.innerHTML = '<div class="pair-veil" data-act="pairCancel"></div><div class="pair-sheet" role="dialog" aria-label="' + T('Mở lớp trên màn hình', 'Open a class on the screen') + '">' +
    '<div class="row-top"><b>📺 ' + T('Mở lớp trên màn hình lớp', 'Open a class on the class screen') + '</b><span class="spacer"></span><button class="quiet" data-act="pairCancel">' + T('Huỷ', 'Cancel') + '</button></div>' +
    '<p class="small muted">' + T('Chạm lớp bạn đang dạy. Màn hình trong lớp sẽ tự mở lớp đó sau vài giây.', 'Tap your class. The class screen opens it in a few seconds.') + '</p>' +
    (list == null ? '<div class="card empty">' + T('Đang đọc lịch hôm nay…', 'Reading today\'s schedule…') + '</div>'
      : !list.length ? '<div class="card empty">' + T('Hôm nay bạn không có lớp nào trong lịch.', 'No class of yours today.') + '</div>'
      : '<div class="pair-list">' + list.map(s => '<button class="pair-cls" data-act="pairPick" data-row="' + s.row + '" data-day="' + s.day + '"' + (pairBusy ? ' disabled' : '') + '><b>' + esc(s.cls) + '</b><span>' + sessionTime(s) + (s.lesson ? T(' · Tiết ', ' · Lesson ') + esc(s.lesson) : '') + (s.site ? ' · ' + esc(s.site) : '') + '</span>' + tag(s) + '</button>').join('') + '</div>') +
    '</div>';
}
document.addEventListener('click', async e => {
  const b = e.target.closest && e.target.closest('[data-act="pairPick"], [data-act="pairCancel"]');
  if (!b) return;
  if (b.dataset.act === 'pairCancel') { pairWant = ''; paintPairBox(); return; }
  const s = findSession(b.dataset.row, b.dataset.day);
  if (!s || pairBusy) return;
  pairBusy = true; paintPairBox();
  try {
    await call('ghepvao', { code: pairWant, cls: s.cls, day: s.day, row: s.row }, 1);
    pairWant = '';
    say('📺 ' + T('Màn hình lớp đang mở ' + s.cls + '. Nhìn lên màn hình nhé.', 'The class screen is opening ' + s.cls + '.'), 'ok');
  } catch (err) {
    say(T('Chưa mở được: ', 'Not opened: ') + err.message, 'bad');
    if (err.status === 400) pairWant = '';
  } finally { pairBusy = false; paintPairBox(); render(); }
});
// No private link on this phone yet: say what to do instead of a bare sign-in page.
setTimeout(() => { if (PAIR_FROM_LINK && !$('login').hidden) $('loginMsg').textContent = T('Điện thoại này chưa mở app. Mở link riêng của bạn một lần trên trình duyệt này, rồi quét lại mã trên màn hình lớp.', 'This phone has not opened the app yet. Open your private link once in this browser, then scan again.'); }, 400);

// The board opens the lesson it was paired for as soon as today's schedule is in.
const renderBeforePair = render;
render = function () {
  if (isBoard() && boardAutoOpen && view !== 'lenlop') {
    const s = findSession(boardAutoOpen.row, boardAutoOpen.day);
    if (s && classOf(s)) { boardAutoOpen = null; boardOpenSession(s); return; }
  }
  renderBeforePair();
  paintPairBox();
  if (view === 'lenlop') requestAnimationFrame(fitClassScreen);
};

/* ---------- The whole class in one window (owner 08/11: "đủ tên trong một màn hình thu nhỏ ấy, màn hình tại lớp... bây giờ cứ phải kéo,
 * bất tiện thao tác khi đang dạy") ----------
 * On anything wider than a phone, the pupil rows are laid out in 1–3 columns and scaled down just enough that every pupil
 * fits the window (ClassIn's browser box, a half screen, a board) without scrolling; never below 45 %. Phones keep scrolling. */
const FIT_MIN = 0.4;
let fitLast = { key: '', c: 1, s: 1 };
function fitClassScreen() {
  const list = document.querySelector('.rv-list');
  if (!list) return;
  const set = (c, s) => {
    list.style.gridTemplateColumns = c > 1 ? 'repeat(' + c + ', minmax(0, 1fr))' : '';
    list.style.width = s < 0.999 ? (100 / s) + '%' : '';
    list.style.transform = ''; list.style.marginBottom = ''; list.style.gridAutoRows = ''; list.style.transformOrigin = '';
  };
  const apply = (c, s) => {
    set(c, s);
    list.classList.toggle('rv-fit', s < 0.999);
    if (s < 0.999) { list.style.transform = 'scale(' + s + ')'; list.style.marginBottom = -(list.offsetHeight * (1 - s)) + 'px'; }
  };
  set(1, 1); list.classList.remove('rv-fit');
  // Owner 09/11: "áp dụng cho tab ở laptop nữa khi tôi bật chia đôi màn hay 1/3 màn": on a computer a narrow window keeps the
  // full-screen layout (one row per pupil, rv-desk turns off the phone rules) and is scaled to fit. Only a real phone scrolls.
  const realPhone = matchMedia('(pointer: coarse)').matches && Math.min(screen.width, screen.height) < 600;
  list.classList.toggle('rv-desk', !realPhone);
  if (realPhone) return;
  // Owner 09/11: a box (warning, homework reason) opening must not blow the class up behind it: keep the last fitted size.
  if (document.querySelector('.ll-sheet')) { if (fitLast.key) apply(fitLast.c, fitLast.s); return; }
  const top = list.getBoundingClientRect().top + window.scrollY, avail = window.innerHeight - top - 10;
  if (avail < 150) return;
  const n = list.children.length, wide = list.parentElement.clientWidth;
  // Same window, same pupils, same words: reuse the last answer instead of measuring again (taps re-render often).
  const key = window.innerWidth + 'x' + window.innerHeight + '|' + Math.round(top) + '|' + n + '|' + list.textContent.length;
  if (fitLast.key === key) return apply(fitLast.c, fitLast.s);
  // On screen the list is s × its height when laid out at width 100/s %; that only grows with s, so search for the largest s that fits.
  const visual = (c, s) => { set(c, s); return list.offsetHeight * s; };
  const best = c => {
    if (visual(c, 1) <= avail) return 1;
    if (visual(c, FIT_MIN) > avail) return 0;
    let lo = FIT_MIN, hi = 1;
    for (let k = 0; k < 7; k++) { const mid = (lo + hi) / 2; if (visual(c, mid) <= avail) lo = mid; else hi = mid; }
    return lo;
  };
  // One row per pupil is the owner's layout; columns only when that would make everything too small.
  let pick = { c: 1, s: best(1) };
  if (pick.s < 0.8 && n >= 6) for (let c = 2; c <= 3; c++) {
    if (wide / c < 340) break;
    const s = best(c);
    if (s > pick.s + 0.08) pick = { c, s };
  }
  if (!pick.s) pick = { c: 1, s: FIT_MIN };
  fitLast = { key, c: pick.c, s: pick.s };
  apply(pick.c, pick.s);
}
let fitTimer = null;
window.addEventListener('resize', () => { clearTimeout(fitTimer); fitTimer = setTimeout(() => { if (view === 'lenlop') fitClassScreen(); }, 150); });

/* ---------- Take one reminder off right on its button (owner 08/11: "các nút mất trật tự... cũng phải có trừ, chẳng may ấn nhầm... gọn") ----------
 * A reminder with a count gets a small "−" in its top-left corner (the count sits top-right): one tap takes the last one off. */
function undoBtn(r, tag, n, live, name) {
  if (!n || r.off) return '';
  return '<button class="rv-undo" data-act="llUntick" data-i="' + r.i + '" data-v="' + esc(tag) + '"' + live + ' aria-label="' + T('Bớt 1 lần ', 'Take one off: ') + esc(tag) + ' · ' + esc(name) + '">−</button>';
}
const llActionBeforeUndo = llAction;
llAction = function (act, i, v) {
  if (act !== 'llUntick') return llActionBeforeUndo(act, i, v);
  const ctx = classContext(current), pupil = i != null && ctx.tracker ? ctx.tracker.pupils[Number(i)] : null;
  if (!pupil || !canTeach(ctx.session) || !llUnlocked(ctx.session)) return;
  const old = behaveFor(ctx.session).get(pupil.name), tags = old ? old.tags.slice() : [], at = tags.lastIndexOf(v);
  if (at < 0) return;
  tags.splice(at, 1);
  setBehave(ctx, pupil, tags, old ? old.note : '');
  render();
};

/* ---------- A re-read of the class sheet never takes back what this device just set (Angelo 08/11: stars "0 again") ----------
 * The sheet is re-read every minute and whenever a class screen opens. A read that left before a tap, or came back while the
 * tap was still waiting to be sent (stars go together every 10 s), used to put the old value back on screen; the next tap then
 * counted from 0. Now every fresh read gets this device's unsent cells laid back on top, and the stars it sent in the last
 * 2 minutes, so the screen keeps the teacher's numbers until the sheet itself shows them. */
const KEEP_SENT_MS = 120000, sentCells = new Map();
const writeCellsBeforeKeep = writeCells;
writeCells = async function (file, items) {
  await writeCellsBeforeKeep(file, items);
  const at = Date.now();
  items.filter(x => x.blind && x.classKey).forEach(x => sentCells.set(x.classKey + '|' + x.row + '|' + x.col, { row: x.row, col: x.col, value: x.value, at }));
};
const loadTrackerBeforeKeep = loadTracker;
loadTracker = async function (cls, force, light) {
  const t = await loadTrackerBeforeKeep(cls, force, light);
  if (!t || !cls) return t;
  const now = Date.now();
  sentCells.forEach((x, k) => {
    if (now - x.at > KEEP_SENT_MS) { sentCells.delete(k); return; }
    if (k.startsWith(cls.key + '|')) t.set(x.row, x.col, x.value === '' ? '' : String(x.value));
  });
  outbox.filter(x => x.kind === 'cell' && x.classKey === cls.key).forEach(x => t.set(x.row, x.col, x.value === '' ? '' : String(x.value)));
  return t;
};

/* ---------- Class boards switched off (owner 08/11: "thôi dừng các bảng lớp đi, không cần đâu") ----------
 * No pairing code or QR any more: the sign-in button, the #bang link and the Điều hành › Màn hình lớp tab are gone.
 * Teachers keep the class screen (Lên lớp) on their own device. Boards paired earlier keep working until a manager removes them. */
const BOARDS_OFF = true;
if (BOARDS_OFF) {
  boardStart = function () {};
  const bi = PANELS.findIndex(p => p[0] === 'manhinh');
  if (bi >= 0) PANELS.splice(bi, 1);
  if (panel === 'manhinh') panel = 'tong';
  const btn = document.querySelector('[data-act="boardStart"]');
  if (btn) btn.remove();
}

/* ---------- The owner's own teacher link (owner 08/11: "tôi như là GV cũng cho tôi tạo link để tôi đăng nhập bằng link") ----------
 * One tap in Người dùng makes a GV link with her own name, for class computers: it shows her lessons and the class screen,
 * never pay, tuition, contracts or people. Her owner link stays as it is. */
const viewNguoiBeforeOwnGv = viewNguoi;
viewNguoi = function () {
  const h = viewNguoiBeforeOwnGv();
  if (!isOwner() || !nguoi) return h;
  const mine = nguoi.people.filter(p => Q.key(p.name) === Q.key(me.name) && p.role === 'GV');
  const card = '<div class="card"><h3>Link GV của cô</h3><p>Dùng trên máy ở lớp: chỉ thấy lịch dạy và màn hình lớp của cô, không thấy lương, học phí, hợp đồng hay danh sách người dùng. Link Chủ của cô vẫn giữ nguyên.</p>' +
    (mine.length ? '<p class="small muted">Đã có link GV (tạo ngày ' + esc(mine[0].at || '') + '). Muốn tạo lại thì xoá dòng "' + esc(me.name) + ' · GV" ở danh sách bên dưới trước.</p>'
      : '<button class="primary" data-act="nguoiThemToi">Tạo link GV cho tôi</button>') + '</div>';
  const at = h.indexOf('<div class="card"><h3>Thêm người</h3>');
  return at >= 0 ? h.slice(0, at) + card + h.slice(at) : h + card;
};
document.addEventListener('click', async e => {
  const b = e.target.closest && e.target.closest('[data-act="nguoiThemToi"]');
  if (!b || !isOwner()) return;
  b.disabled = true;
  try { const r = await call('them', { name: me.name, role: 'GV' }); nguoiMoi = { name: r.name + ' (GV)', link: location.origin + location.pathname + '#k=' + r.key }; await loadNguoi(); render(); window.scrollTo(0, 0); }
  catch (err) { say(err.message, 'bad'); render(); }
});

/* ---------- "Rà soát & chốt" only once the lesson is over, with a pop-up asking for it (owner 08/11) ----------
 * Before the end time the header button is grey ("Chốt buổi lúc 18:30") and the close cannot be confirmed. From the end time, a
 * pop-up over the class screen asks the teacher to check roll call, stars, A+/B/F and reminders and close the lesson;
 * "5 phút nữa" hides it for five minutes. It never shows once the lesson is closed, or to someone who may not close it. */
const CHOT_SNOOZE_MS = 5 * 60000;
let chotSnooze = { key: '', until: 0 };
const lockBarBeforeEnd = lockBar;
lockBar = function (can, edit) {
  const h = lockBarBeforeEnd(can, edit);
  if (!current || isChot(current) || lessonEnded(current)) return h;
  return h.replace(/<button class="rv-sumbtn rv-chot" data-act="llSumOpen">[^<]*<\/button>/, '<button class="rv-sumbtn rv-chot-wait" disabled title="' + T('Chỉ chốt được khi buổi học kết thúc', 'Only after the lesson ends') + '">✅ ' + T('Chốt buổi lúc ', 'Close at ') + Q.clock(current.end) + '</button>');
};
const llActionBeforeEnd = llAction;
llAction = function (act, i, v) {
  if ((act === 'llSumOpen' || act === 'llChot') && current && !isChot(current) && !lessonEnded(current)) return;
  if (act === 'llChotPopGo') { chotSnooze = { key: Q.sessionKey(current), until: Date.now() + CHOT_SNOOZE_MS }; summaryOn(current); llSummary.mode = true; render(); setTimeout(() => { const w = document.querySelector('.chot-warn'); if (w) w.scrollIntoView({ block: 'center' }); }, 50); return; }
  if (act === 'llChotPopLater') { chotSnooze = { key: Q.sessionKey(current), until: Date.now() + CHOT_SNOOZE_MS }; paintChotPop(); return; }
  return llActionBeforeEnd(act, i, v);
};
function paintChotPop() {
  let box = document.getElementById('chotPop');
  const s = current, key = s ? Q.sessionKey(s) : '';
  const show = s && view === 'lenlop' && !isChot(s) && chotTime(s) && canConfirm(s) && !(chotSnooze.key === key && Date.now() < chotSnooze.until) && !document.querySelector('.ll-sheet');
  if (!show) { if (box) box.remove(); return; }
  if (!box) { box = document.createElement('div'); box.id = 'chotPop'; document.body.appendChild(box); }
  // In the app's language (owner 08/11: foreign teachers use English; only the class screen pupils look at stays bilingual).
  box.innerHTML = '<div class="pair-veil"></div><div class="pair-sheet chot-pop" role="alertdialog" aria-label="' + T('Buổi học đã kết thúc', 'The lesson has ended') + '">' +
    '<b class="chot-pop-t">⏰ ' + T('Buổi học đã kết thúc', 'The lesson has ended') + '</b>' +
    '<p>' + T('Thầy/cô rà soát lại một lượt: <b>điểm danh, số sao, A+/B/F (và lý do), nhắc nhở</b>, rồi bấm <b>Chốt buổi</b>. Chốt xong sẽ không sửa được nữa.', 'Please check <b>roll call, stars, A+/B/F (with reasons) and reminders</b>, then <b>close the lesson</b>. After closing nothing can be changed.') + '</p>' +
    '<div class="chot-row"><button class="primary chot-go" data-act="llChotPopGo">✅ ' + T('Rà soát & chốt ngay', 'Review & close now') + '</button>' +
    '<button class="quiet" data-act="llChotPopLater">' + T('5 phút nữa', 'In 5 minutes') + '</button></div></div>';
}
const renderBeforeChotPop = render;
render = function () { renderBeforeChotPop(); paintChotPop(); };
setInterval(() => { if (view === 'lenlop' && current) paintChotPop(); }, 20000);

/* ---------- Reminder buttons by class (owner 08/11) ----------
 * FIGHTER: Mất trật tự · Mất tập trung · Trả lời sai · Phát biểu tốt. IELTS writing (Schedule book "IELTS VIẾT"): Mất trật tự ·
 * (Owner 10/11: "Ngủ gật" is now "Buồn ngủ", also for FIGHTER; older records keep their word.) Mất tập trung · Buồn ngủ · Viết không kịp · Viết linh tinh tùy ý. IELTS speaking ("IELTS SPEAKING"): Mất trật tự · Mất tập trung ·
 * Ngủ gật · Làm việc riêng. KIDS keep Mất trật tự · Mất tập trung. Praise and wrong answers never count towards the warning limit. */
const NOT_COUNTED = [PRAISE, 'Trả lời sai'];
const FIGHTER_TICKS = ['Mất trật tự', 'Mất tập trung', 'Buồn ngủ', 'Trả lời sai', PRAISE];
const IELTS_WRITING_TICKS = ['Mất trật tự', 'Mất tập trung', 'Buồn ngủ', 'Viết không kịp', 'Viết linh tinh tùy ý'];
const IELTS_SPEAKING_TICKS = ['Mất trật tự', 'Mất tập trung', 'Buồn ngủ', 'Làm việc riêng'];
function tickSetOf(s) {
  if (!s) return TICKS;
  const c = Q.key(s.cls), b = Q.key(s.book || '');
  if (/^FIGHTER/.test(c)) return FIGHTER_TICKS;
  if (/^IELTS/.test(c)) return /SPEAKING|NOI\b/.test(b) ? IELTS_SPEAKING_TICKS : IELTS_WRITING_TICKS;
  return isSecondary(s) ? TEEN_TICKS : TICKS;
}
Object.assign(BEHAVIOUR_EN, { 'Trả lời sai': 'Wrong answer', 'Ngủ gật': 'Dozing off', 'Buồn ngủ': 'Sleepy', 'Viết không kịp': 'Writing too slowly', 'Viết linh tinh tùy ý': 'Off-task writing', 'Làm việc riêng': 'Off-task' });
[...FIGHTER_TICKS, ...IELTS_WRITING_TICKS, ...IELTS_SPEAKING_TICKS].forEach(t => { if (!BEHAVIOURS.includes(t)) BEHAVIOURS.push(t); });
Object.assign(COMMENT_LINES, {
  'Trả lời sai': 'con còn trả lời sai, cần ôn lại bài.',
  'Ngủ gật': 'con ngủ gật trong giờ học, cần nghỉ ngơi đủ trước buổi học.',
  'Buồn ngủ': 'con buồn ngủ trong giờ học, cần nghỉ ngơi đủ trước buổi học.',
  'Viết không kịp': 'con viết chưa kịp thời gian, cần luyện tốc độ viết.',
  'Viết linh tinh tùy ý': 'con viết chưa theo yêu cầu của đề, cần bám sát đề bài.'
});

/* ---------- A narrow board strip: every name in one column (owner 08/11, ClassIn browser box on the board: "muốn thêm hoặc nhắc đứa nào
 * phải kéo... làm sao hàng dọc đó hiện hết các tên") ----------
 * Narrower than 640 px, each pupil is one short line: name, stars and +. Touching the name opens that pupil's line with every button
 * (reminders with their −, warning, absent, −1 star); touching it again, or another name, closes it. The column is scaled to fit. */
let llOpenRow = null;
// IELTS and FIGHTER first (owner 08/11: "phần khung hẹp áp dụng cho ielts và fighter trước"); KIDS keep their usual rows.
// All classes (IELTS/FIGHTER first on 08/11, KIDS the same evening: "kids cũng cần sửa theo các nút tương ứng").
// Owner 09/11: also a laptop window split in half or a third gets the icon ("nút tắt") layout that fits the window.
// Owner 11/11 (portrait board): a tall screen also gets the icon layout, whatever its width.
const stripOn = () => view === 'lenlop' && (window.innerWidth < 900 || window.innerHeight > window.innerWidth * 1.2) && !!current;
document.addEventListener('click', e => {
  const n = stripOn() && e.target.closest && e.target.closest('.rv-row .rv-name');
  if (!n) return;
  e.preventDefault(); e.stopPropagation();
  const row = n.closest('.rv-row'), i = row ? Number(row.dataset.i) : null;
  llOpenRow = llOpenRow === i ? null : i;
  paintStrip();
}, true);
function paintStrip() {
  document.body.classList.toggle('rv-strip', stripOn());
  if (!stripOn()) return;
  document.querySelectorAll('.rv-row').forEach(r => {
    r.classList.toggle('open', Number(r.dataset.i) === llOpenRow);
    // A closed line still says how many reminders the pupil has (and praise), so nobody has to open it to know.
    const name = r.querySelector('.rv-name'), old = r.querySelector('.rv-mini');
    if (old) old.remove();
    let warn = 0, good = 0;
    r.querySelectorAll('.rv-chip').forEach(c => { const b = c.querySelector('.rv-badge'), n = b ? Number(b.textContent) || 0 : 0; if (c.querySelector('.rv-praise')) good += n; else warn += n; });
    if (name && (warn || good)) name.insertAdjacentHTML('beforeend', '<span class="rv-mini">' + (warn ? '⚠ ' + warn : '') + (warn && good ? ' · ' : '') + (good ? '👍 ' + good : '') + '</span>');
  });
  fitClassScreen();
}
const renderBeforeStrip = render;
render = function () { renderBeforeStrip(); paintStrip(); };
window.addEventListener('resize', () => { if (view === 'lenlop') paintStrip(); });
const fitBeforeStrip = fitClassScreen;
const stripKeep = new Map();
fitClassScreen = function () {
  if (!document.body.classList.contains('rv-strip')) return fitBeforeStrip();
  const list = document.querySelector('.rv-list');
  if (!list) return;
  const open = list.querySelector('.rv-row.open');
  if (open) open.classList.remove('open');
  // Owner 11/11 (board photo): the row height grown by the previous fit was measured again, so the class shrank to 30%.
  list.style.gridAutoRows = '';
  list.style.transform = ''; list.style.width = ''; list.style.marginBottom = ''; list.style.gridTemplateColumns = ''; list.style.transformOrigin = '0 0';
  const top = list.getBoundingClientRect().top + window.scrollY, avail = window.innerHeight - top - 10;
  // A line fits when its last button ends inside it (the small count badges sticking out of a button's corner do not count).
  const lineFits = r => {
    const kids = [...r.children].filter(e => e.offsetWidth && getComputedStyle(e).position !== 'absolute');
    const last = kids[kids.length - 1];
    return !last || last.getBoundingClientRect().right <= r.getBoundingClientRect().right - parseFloat(getComputedStyle(r).paddingRight || 0) + 1;
  };
  const fits = (s, c) => {
    list.style.gridTemplateColumns = c > 1 ? 'repeat(' + c + ', minmax(0, 1fr))' : '';
    list.style.width = (100 / s) + '%';
    return [...list.children].every(lineFits) && list.offsetHeight * s <= avail;
  };
  const best = c => { if (fits(1, c)) return 1; if (!fits(0.3, c)) return 0.3; let lo = 0.3, hi = 1; for (let k = 0; k < 8; k++) { const mid = (lo + hi) / 2; if (fits(mid, c)) lo = mid; else hi = mid; } return lo; };
  // Owner 13/11 ("lúc đang điểm danh màn hình liên tục giật về màn nhỏ màn to"): every tap redraws the list, and a row that loses
  // its 🙋 button after roll call let the whole class grow a little each time. The size found for this window and this class is
  // kept while it still fits; it is measured again only when the window, the number of pupils or the icon size changes.
  const keepKey = [innerWidth, innerHeight, list.children.length, list.style.getPropertyValue('--rvq'), list.classList.contains('rv-tall')].join('|');
  let s, cols;
  const kept = stripKeep.get(keepKey);
  if (kept && fits(kept.s, kept.cols)) { s = kept.s; cols = kept.cols; }
  else {
    // One column unless two (or three) make the names clearly bigger.
    s = best(1); cols = 1;
    // A tall window keeps one column (owner 11/11: name big on top, icons under it).
    for (let c = 2; c <= (list.classList.contains('rv-tall') ? 1 : 3) && s < 0.8; c++) { const sc = best(c); if (sc > s * 1.12) { s = sc; cols = c; } }
    if (stripKeep.size > 40) stripKeep.clear();
    stripKeep.set(keepKey, { s, cols });
  }
  list.style.gridTemplateColumns = cols > 1 ? 'repeat(' + cols + ', minmax(0, 1fr))' : '';
  list.style.width = s < 0.999 ? (100 / s) + '%' : '';
  // Height left over (the width was the limit): lines grow taller so the pupils fill the box (owner: pupils take ~5/6 of it).
  list.style.gridAutoRows = '';
  list.style.width = (100 / s) + '%';
  const per = Math.ceil(list.children.length / cols), gap = parseFloat(getComputedStyle(list).rowGap) || 0, room = avail / s - gap * (per - 1);
  if (per && list.offsetHeight * s < avail - 4) list.style.gridAutoRows = Math.floor(room / per) + 'px';
  if (s >= 0.999) list.style.width = '';
  if (s < 0.999) { list.style.transform = 'scale(' + s + ')'; list.style.marginBottom = -(list.offsetHeight * (1 - s)) + 'px'; }
  if (open) open.classList.add('open');
};

/* ---------- A group lesson lists only its group (owner 08/11: "ielts chia 2 nhóm speaking thì buổi nào hiện danh sách ấy thôi") ----------
 * The class sheet marks each speaking group with a row "IELTS 52.1" / "IELTS 52.2"; in a lesson of IELTS 52.2 the class page, the class
 * screen and the summary show those pupils only. A sheet without such rows keeps the whole class, as before. */
const classContextBeforeGroup = classContext;
classContext = function (session) {
  const ctx = classContextBeforeGroup(session);
  if (ctx.tracker && session && isGroup(session)) {
    const g = Q.key(session.cls), mine = ctx.tracker.pupils.filter(p => p.group === g);
    if (mine.length) ctx.tracker = Object.assign({}, ctx.tracker, { pupils: mine, grouped: true });
  }
  return ctx;
};

/* ---------- Board strip: icon buttons beside each name (owner 08/11: "có nút tắt cho ngủ gật hay mất trật tự nằm cạnh để ấn luôn, chứ không
 * hiện màn hình phụ... vẫn còn chỗ mà") ----------
 * Each closed line is: short name (the last two words; the full name shows when the line is opened) and one small icon button per
 * reminder of this class plus ⚠️ for a warning, each with its count. A legend above the list says what the icons mean, in Vietnamese
 * with English under it. Touching the name still opens the full line (with "−", absent). */
// Owner 09/11 (staff idea, ML): 🗣️ reads better than 🔊 for "Mất trật tự".
const TICK_ICON = { 'Mất trật tự': '🗣️', 'Mất tập trung': '👀', 'Ngủ gật': '😴', 'Buồn ngủ': '😴', 'Viết không kịp': '⏳', 'Viết linh tinh tùy ý': '✏️', 'Làm việc riêng': '📱', 'Trả lời sai': '❌', 'Phát biểu tốt': '👍', 'Dùng điện thoại': '📵' };
const shortName = full => { const w = String(full || '').trim().split(/\s+/); return w.length > 2 ? w.slice(-2).join(' ') : full; };
const paintStripBeforeQuick = paintStrip;
paintStrip = function () {
  paintStripBeforeQuick();
  if (!stripOn()) return;
  const set = tickSetOf(current), list = document.querySelector('.rv-list');
  if (list && !document.querySelector('.rv-legend')) list.insertAdjacentHTML('beforebegin', '<div class="rv-legend">' + set.concat([CANH_CAO]).map(t => '<span>' + (t === CANH_CAO ? '⚠️' : TICK_ICON[t] || '•') + ' ' + esc(t) + '<small class="rv-en">' + esc(BEHAVIOUR_EN[t] || '') + '</small></span>').join('') + '</div>');
  document.querySelectorAll('.rv-row').forEach(r => {
    const open = r.classList.contains('open'), nm = r.querySelector('.ll-name'), old = r.querySelector('.rv-quick'), mini = r.querySelector('.rv-mini');
    if (mini) mini.remove();
    if (old) old.remove();
    if (nm) { if (!nm.dataset.full) nm.dataset.full = nm.textContent; nm.textContent = open ? nm.dataset.full : shortName(nm.dataset.full); }
    if (open || r.classList.contains('off')) return;
    const chips = r.querySelectorAll('.rv-chip'), i = r.dataset.i;
    const btn = (k, act, icon, cls, title) => {
      const chip = chips[k], b = chip && chip.querySelector('button'), badge = chip && chip.querySelector('.rv-badge'), dis = !b || b.disabled;
      return '<button class="rv-q' + cls + (badge ? ' on' : '') + '" data-act="' + act + '" data-i="' + i + '"' + (act === 'llTick' ? ' data-k="' + k + '" data-v="' + k + '"' : '') + (dis ? ' disabled' : '') + ' title="' + esc(title) + '">' + icon + (badge ? '<b>' + esc(badge.textContent) + '</b>' : '') + '</button>';
    };
    const html = '<span class="rv-quick">' + set.map((t, k) => btn(k, 'llTick', TICK_ICON[t] || '•', t === PRAISE ? ' good' : '', t)).join('') + btn(set.length, 'llReason', '⚠️', ' warn', CANH_CAO) + '</span>';
    const name = r.querySelector('.rv-name');
    if (name) name.insertAdjacentHTML('afterend', html);
  });
  fitClassScreen();
};

/* ---------- Class page: IELTS / FIGHTER pupils show what they still owe (owner 08/11: "màn hình điểm danh ngoài lại không có thiếu bài
 * gì... để hs vào biết mình còn thiếu") ----------
 * Under each name, the same short overdue list as on the class screen: "📚 Thiếu 3 bài: Viết ×2, Nói". KIDS keep "Thiếu video". */
const kidsMakeupBeforeSecOwed = kidsMakeup;
kidsMakeup = function (ctx, p, i, canEdit) {
  const base = kidsMakeupBeforeSecOwed(ctx, p, i, canEdit);
  if (!ctx || !ctx.session || !isSecondary(ctx.session)) return base;
  const owed = secOwedOf(ctx, p);
  if (!owed || !owed.length) return base;
  return base + '<div class="owed">📚 ' + T('Thiếu ', 'Missing ') + owed.length + T(' bài: ', ' tasks: ') + esc(skillSummary(owed)) + '</div>';
};

/* ---------- Class page: KIDS pupils show what they still owe the same way (owner 08/11: "phần kids cũng vậy") ----------
 * Same rule and count as the class screen and the summary: every lesson or self-study video already overdue,
 * "🎥 Thiếu 2 video: Tiết 54 ngữ pháp, Tự luyện 22". */
const owedOnPage = new WeakMap();
const kidsMakeupBeforeKidsOwed = kidsMakeup;
kidsMakeup = function (ctx, p, i, canEdit) {
  const base = kidsMakeupBeforeKidsOwed(ctx, p, i, canEdit);
  if (!ctx || !ctx.session || !ctx.tracker || isSecondary(ctx.session) || !ctx.tracker.blocks.length) return base;
  let all = owedOnPage.get(ctx.tracker);
  if (!all) { all = totalOwed(ctx); owedOnPage.set(ctx.tracker, all); }
  const list = (all[i] || []).map(x => (x.practice ? (x.label || 'Tự luyện').replace(/^Tự luyện video/i, 'Tự luyện') : (x.lesson ? 'Tiết ' + Number(x.lesson) : viDate(x.day).slice(0, 5)) + (x.label ? ' ' + x.label.toLowerCase() : '')) + (x.wrong ? ' (quay sai)' : ''));
  return list.length ? base + '<div class="owed" title="' + esc(list.join('\n')) + '">🎥 ' + T('Thiếu ', 'Missing ') + list.length + ' bài: ' + esc(kidsKinds(all[i] || [])) + '</div>' : base;
};

/* ---------- KIDS owed work in short, like IELTS (owner 08/11: "theo logic kids đã chốt, chỉ là hiển thị cũng vậy") ----------
 * Same items as before (overdue only, HẠN from the Schedule); shown by kind: "Ngữ pháp ×2, Từ vựng, Tự luyện, Quay lại". */
function kidsKinds(items) {
  const n = {}, order = [];
  (items || []).forEach(x => {
    let k = x.wrong ? 'Quay lại' : x.practice ? 'Tự luyện' : x.label ? String(x.label).trim().toLowerCase().split(/\s+/).slice(0, 3).join(' ') : 'Video bài học';
    k = k.charAt(0).toUpperCase() + k.slice(1);
    if (!(k in n)) { n[k] = 0; order.push(k); }
    n[k]++;
  });
  return order.map(k => k + (n[k] > 1 ? ' ×' + n[k] : '')).join(', ');
}

/* ---------- Owed work read fresh at the close (owner 08/11: "cập nhật ngay lúc chốt... cả kids nữa") ----------
 * When the review-and-close sheet opens (by itself at the end of the lesson, or by the button) and on "↻ Đọc lại sheet":
 * KIDS re-read the class sheet, IELTS / FIGHTER ask the server for a new owed list instead of its 10-minute copy. */
const owedFreshAt = {};
function refreshOwedNow(s) {
  const c = s && classOf(s);
  if (!c) return;
  const key = c.tracker + '|' + s.day;
  if (Date.now() - (owedFreshAt[key] || 0) < 30000) return;
  owedFreshAt[key] = Date.now();
  if (isSecondary(s)) {
    secLoading.add(key);
    call('baino', { file: c.tracker, day: s.day, fresh: true }).then(data => { owedCache[key] = { at: Date.now(), data }; }).catch(() => {}).finally(() => { secLoading.delete(key); render(); });
  } else guarded(() => Promise.all([loadTracker(c, true), loadMarks(true), loadBehave(true).catch(() => {})]));
}
const llActionBeforeFresh = llAction;
llAction = function (act, i, v) {
  const r = llActionBeforeFresh(act, i, v);
  if (current && (act === 'llSumOpen' || act === 'llChotPopGo' || act === 'llSumRefresh')) { if (act === 'llSumRefresh') owedFreshAt[(classOf(current) || {}).tracker + '|' + current.day] = 0; refreshOwedNow(current); }
  return r;
};
const sumSeen = new Set();
const renderBeforeFresh = render;
render = function () {
  renderBeforeFresh();
  if (view === 'lenlop' && current && document.querySelector('.sum-sheet')) { const k = Q.sessionKey(current); if (!sumSeen.has(k)) { sumSeen.add(k); refreshOwedNow(current); } }
};

/* ---------- Điều hành as a dashboard (owner 08/11: "tổ chức lại app quản trị hơi giống dash... có nút ấn xong mở ra hộp thoại phụ... gọn gàng,
 * thẩm mĩ hơn") ----------
 * The page is a grid of tiles, one per area, each with its number and a colour (red = act now, amber = waiting, green = fine).
 * A tile opens its area in a dialog over the grid; ✕ or the dark background closes it. "Cần xử lý ngay" stays under the tiles. */
const DASH = [['ca', '📍', 'Vào ca', 'Check-in'], ['vang', '🧒', 'HS vắng', 'Absences'], ['task', '📝', 'Important Task', 'Important Task'], ['loi', '⚠️', 'Lỗi nhân viên', 'Staff errors'], ['thang', '📊', 'Tháng & KPI', 'Month & KPI'], ['cot', '🗂️', 'Cột lớp', 'Lesson columns']];
function dashTiles(week) {
  const s = overviewStats(week);
  const v = {
    ca: [s.caWaiting || 0, s.caWaiting ? 'warn' : 'ok', s.ca == null ? T('Đang đọc…', 'Reading…') : s.caWaiting ? T('chờ duyệt', 'to approve') : String(s.ca)],
    vang: [(s.pending || 0) + (s.noRoll || 0), s.noRoll ? 'bad' : s.pending ? 'warn' : 'ok', s.noRoll ? s.noRoll + T(' buổi chưa điểm danh', ' not taken') : s.pending ? T('chờ xác minh', 'to check') : T('đã xử lý hết', 'all handled')],
    task: [(s.taskLate || 0) + (s.taskToday || 0), s.taskLate ? 'bad' : s.taskToday ? 'warn' : 'ok', s.taskLate ? s.taskLate + T(' quá hạn', ' overdue') : s.taskToday ? T('hạn hôm nay', 'due today') : T('ổn', 'fine')],
    loi: [s.errors || 0, s.errors ? 'warn' : 'ok', s.errors == null ? T('Đang đọc…', 'Reading…') : s.errors ? T('lỗi đang mở', 'open') : T('không có lỗi', 'none')],
    thang: ['', 'plain', monthName(filters.kpiMonth || xMonth())],
    cot: [s.cols || 0, s.cols ? 'warn' : 'ok', s.cols ? T('buổi cần kiểm tra cột', 'to check') : T('đủ cột', 'all there')]
  };
  return '<div class="dash-grid">' + DASH.map(([k, ico, vi, en]) => { const [n, tone, sub] = v[k]; return '<button class="dash-tile ' + tone + '" data-act="panel" data-v="' + k + '"><span class="dash-ico">' + ico + '</span><span class="dash-num">' + n + '</span><span class="dash-name">' + T(vi, en) + '</span><span class="dash-sub">' + esc(sub) + '</span></button>'; }).join('') + '</div>';
}
const viewManagerBeforeDash = viewManager;
viewManager = function (week) {
  if (isBoard()) return viewManagerBeforeDash(week);
  const savedPanel = panel;
  // The grid and "needs action now" always show; an open area sits in a dialog above them.
  panel = 'tong';
  let base;
  try { const ov = overviewPanel(week), cut = ov.indexOf('<h2>' + T('Hôm nay ở trung tâm', 'Today at the centre')); base = dashTiles(week) + (cut >= 0 ? ov.slice(0, cut) : ov); } finally { panel = savedPanel; }
  if (!panel || panel === 'tong') return base;
  const item = DASH.find(d => d[0] === panel), title = item ? item[1] + ' ' + T(item[2], item[3]) : panel;
  const full = viewManagerBeforeDash(week), tabsEnd = full.startsWith('<div class="tabs">') ? full.indexOf('</div>') + 6 : 0;
  return base + '<div class="dash-veil" data-act="panel" data-v="tong"></div><div class="dash-modal" role="dialog" aria-label="' + esc(title) + '"><div class="dash-head"><b>' + esc(title) + '</b><span class="spacer"></span><button class="quiet" data-act="panel" data-v="tong" aria-label="' + T('Đóng', 'Close') + '">✕</button></div><div class="dash-body">' + full.slice(tabsEnd) + '</div></div>';
};

/* ---------- HS vắng keeps the handled ones, faded, with their trail (owner 08/11: "không mất hẳn mà chỉ ẩn mờ... lưu vết là ai ấn, ai đã nhắn,
 * ai đã xác nhận, để chủ nhiệm, TA, quản lí biết") ----------
 * Each pupil line lists the changes for that lesson from the roll-call log: status or "đã liên hệ PH", who, and when (last five). */
function markTrail(s, p) {
  const rows = (logs.marks ? logs.marks.rows : []).filter(r => r.day === s.day && Q.key(r.cls) === Q.key(s.cls) && String(r.lesson) === String(s.lesson) && r.name === p.name);
  const out = [];
  let lastContact = '', lastStatus = '';
  rows.forEach(r => {
    const when = String(r.at || '').slice(11, 16), who = r.by || '?';
    if (r.status !== lastStatus) out.push('<span>' + esc(stateText(r.status)) + ' · ' + esc(who) + ' ' + esc(when) + '</span>');
    lastStatus = r.status;
    if (r.contact && r.contact !== lastContact) { out.push('<span>📞 ' + T('Đã liên hệ PH', 'Parent contacted') + ' · ' + esc(who) + ' ' + esc(when) + '</span>'); lastContact = r.contact; }
  });
  return out.length ? '<div class="abs-trail">' + out.slice(-5).join('') + '</div>' : '';
}

/* ---------- Stars tapped just before the page closes still reach the sheet (MY LINH 08/11: "thỉnh thoảng có bạn không được cập nhật sao") ----------
 * Stars wait about 10 s to go together. A tab closed inside that wait used to leave the last stars on the device until the app was opened
 * again on that same device. On pagehide the waiting star cells are also sent with keepalive, which the browser finishes after the page is
 * gone; they stay in the outbox too, so the next opening sends them once more (the same number, nothing changes). */
window.addEventListener('pagehide', () => {
  try {
    if (!accessKey) return;
    const byFile = {};
    // Owner 12/11: sent to the gateway with each item's own id, so the copy sent again at the next opening is not saved twice.
    outbox.filter(x => x.kind === 'cell' && x.blind).forEach(x => { if (!x.cid) x.cid = newCid(); (byFile[x.file] = byFile[x.file] || []).push({ cid: x.cid, range: x.range, row: x.row, col: x.col, value: x.value, blind: true, colSig: x.colSig || '', name: x.name || '' }); });
    keep('outbox', outbox);
    Object.entries(byFile).forEach(([file, items]) => fetch(CONFIG.server, { method: 'POST', keepalive: true, headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify({ k: accessKey, op: 'ghi', file, items: items.slice(0, 150) }) }).catch(() => {}));
  } catch (e) {}
});

/* ---------- Kinder words in the lesson comment (owner 08/11: "nếu không có lần nào ấn mất trật tự thì ghi nhận xét tương ứng... linh hoạt câu chữ
 * từng lần... bạn đứng top sao thì cũng ghi tương ứng") ----------
 * A pupil with no reminder gets one of several praise lines; the choice is fixed for that pupil and lesson (closing again keeps it).
 * The top three by stars get a line of their own above the rest. */
const GOOD_LINES = [
  '✓ Con tập trung, giữ trật tự tốt trong buổi học.',
  '✓ Hôm nay con học rất ngoan và chăm chú, cô khen con!',
  '✓ Con tham gia bài học tích cực, tiếp tục phát huy nhé!',
  '✓ Con hoàn thành tốt các hoạt động trên lớp.',
  '✓ Con chú ý nghe giảng và hợp tác tốt với các bạn.',
  '✓ Buổi học hôm nay con rất chăm chỉ, cô rất vui!',
  '✓ Con giữ trật tự và làm theo hướng dẫn rất tốt.',
  '✓ Con học bài nghiêm túc, cố gắng như vậy nhé!'
];
const TOP_LINES = [
  n => '🏆 Con đứng đầu lớp hôm nay với ' + n + ' ⭐, cô khen con!',
  n => '🌟 Con đứng thứ hai về sao hôm nay (' + n + ' ⭐), rất giỏi!',
  n => '🌟 Con nằm trong top 3 sao của lớp hôm nay (' + n + ' ⭐), cố lên nhé!'
];
function pickLine(list, seed) {
  let hsh = 0; String(seed || Math.random()).split('').forEach(c => { hsh = (hsh * 31 + c.charCodeAt(0)) >>> 0; });
  return list[hsh % list.length];
}

/* ---------- Book orders (owner 08/11: "đặt in sách cho học sinh... KIDS 36 hôm nay chủ nhiệm quên không đặt nên không có sách"; "chủ nhiệm đặt";
 * how many days before is up to me) ----------
 * From the Schedule: a KIDS class whose lessons in the next two weeks use a book it has not used in the last two weeks (or whose Schedule
 * still says the book is to be confirmed) needs its books printed. The homeroom teacher orders them 7 days before the first lesson of the
 * new book (reminded from 10 days before, red after). Steps "Đã đặt in" then "Đã nhận sách", each kept with who and when in DIEM_DANH
 * (class "ĐẶT SÁCH"); a finished order stays, faded. */
const BOOK_CLS = 'ĐẶT SÁCH', BOOK_LEAD = 7, BOOK_WARN = 10;
// Owner 09/11: "phonics 1-2 là 1 sách và phonics 3-4 là 1 sách": moving from Phonics 1 to 2 (or 3 to 4) needs no new book.
const bookKeyOf = b => Q.key(b).replace(/^SACH\s*:?\s*/, '').replace(/\bOXFORD\s+/, '').replace(/\s+/g, ' ').trim()
  .replace(/^PHONICS\s*[-_ ]?\s*[12]\b.*$/, 'PHONICS 1-2').replace(/^PHONICS\s*[-_ ]?\s*[34]\b.*$/, 'PHONICS 3-4');
const bookPending = b => /CHECK PROGRAM|CHO XAC NHAN/.test(Q.key(b));
let bookWeeksAsked = 0;
function bookNeeds() {
  const t = today(), from = Q.addDays(t, -14), until = Q.addDays(t, 14);
  if (Date.now() - bookWeeksAsked > 600000) { bookWeeksAsked = Date.now(); [-7, 7, 14].forEach(d => weekOf(Q.addDays(t, d)).catch(() => {})); }
  const all = [];
  Object.values(weeks).forEach(w => w.data.sessions.forEach(s => { if (/^KIDS \d+$/i.test(Q.clean(s.cls)) && !s.off && s.day >= from && s.day <= until && Q.clean(s.book)) all.push(s); }));
  const byClass = {};
  all.forEach(s => (byClass[Q.key(s.cls)] = byClass[Q.key(s.cls)] || []).push(s));
  const out = [];
  Object.values(byClass).forEach(list => {
    list.sort((p, q) => p.day.localeCompare(q.day));
    const past = new Set(list.filter(s => s.day < t && !bookPending(s.book)).map(s => bookKeyOf(s.book)));
    if (!past.size) return;
    const seen = new Set();
    list.filter(s => s.day >= t).forEach(s => {
      const k = bookPending(s.book) ? '?' : bookKeyOf(s.book);
      if (seen.has(k) || (k !== '?' && past.has(k))) return;
      seen.add(k);
      out.push({ cls: Q.clean(s.cls), book: k === '?' ? '' : Q.clean(s.book), unsure: k === '?', first: s.day, due: Q.addDays(s.day, -BOOK_LEAD), cm: homeroom[Q.key(s.cls)] || '' });
    });
  });
  return out.sort((p, q) => p.first.localeCompare(q.first));
}
const bookName = n => n.cls + ' · ' + (n.book || 'SÁCH MỚI');
function bookSteps(n) {
  const rows = (logs.marks ? logs.marks.rows : []).filter(r => r.cls === BOOK_CLS && r.name === bookName(n));
  const last = st => { const hit = rows.filter(r => r.status === st || r.status === 'Bỏ ' + st).pop(); return hit && hit.status === st ? hit : null; };
  return { ordered: last('Đã đặt in'), received: last('Đã nhận sách') };
}
function bookBlock() {
  if (!me) return '';
  if (!logs.marks) setTimeout(() => loadMarks().then(render).catch(() => {}), 0);
  const t = today(), list = bookNeeds().filter(n => isManager() || isMe(n.cm));
  if (!list.length) return '';
  const when = r => r ? ' · ' + esc(r.by || '?') + ' ' + esc(String(r.at || '').slice(11, 16) + ' ' + String(r.at || '').slice(0, 5)) : '';
  const cards = list.map(n => {
    const st = bookSteps(n), done = st.ordered && st.received, late = !st.ordered && t > n.due, soon = !st.ordered && Q.addDays(n.first, -BOOK_WARN) <= t;
    const can = isMe(n.cm), btn = (v, label, on) => can ? '<button class="' + (on ? 'quiet' : 'primary') + '" data-act="bookTick" data-n="' + esc(bookName(n)) + '" data-d="' + n.first + '" data-v="' + v + '">' + label + '</button>' : '';
    return '<div class="card row book ' + (done ? 'done' : 'todo') + (late ? ' late' : '') + '">' +
      '<div class="row-top"><b>📚 ' + esc(n.cls) + '</b><span class="tag">' + esc(n.unsure ? T('Schedule chưa rõ sách mới', 'new book not set on the Schedule') : n.book) + '</span><span class="spacer"></span>' +
      '<span class="small ' + (late ? 'bad' : soon ? 'warn' : 'muted') + '">' + T('Học từ ', 'Starts ') + esc(viDate(n.first).slice(0, 5)) + T(' · đặt trước ', ' · order by ') + esc(viDate(n.due).slice(0, 5)) + (late ? T(' · QUÁ HẠN', ' · OVERDUE') : '') + '</span></div>' +
      '<div class="small muted">' + T('Chủ nhiệm: ', 'Homeroom: ') + esc(n.cm || T('chưa rõ', 'unknown')) + '</div>' +
      '<div class="book-steps"><span class="' + (st.ordered ? 'ok' : '') + '">① ' + T('Đặt in', 'Ordered') + (st.ordered ? ' ✓' + when(st.ordered) : '') + '</span>' + (st.ordered ? btn('Bỏ Đã đặt in', T('Bỏ', 'Undo'), true) : btn('Đã đặt in', '✓ ' + T('Đã đặt in', 'Ordered'))) +
      '<span class="' + (st.received ? 'ok' : '') + '">② ' + T('Nhận sách', 'Received') + (st.received ? ' ✓' + when(st.received) : '') + '</span>' + (st.ordered ? (st.received ? btn('Bỏ Đã nhận sách', T('Bỏ', 'Undo'), true) : btn('Đã nhận sách', '✓ ' + T('Đã nhận sách', 'Received'))) : '') + '</div></div>';
  });
  return '<div class="part p-2"><h2>' + T('Đặt in sách', 'Book orders') + '</h2><span>' + T('chủ nhiệm đặt trước ' + BOOK_LEAD + ' ngày', 'homeroom orders ' + BOOK_LEAD + ' days ahead') + '</span></div><div class="grid">' + cards.join('') + '</div>';
}
document.addEventListener('click', e => {
  const b = e.target.closest && e.target.closest('[data-act="bookTick"]');
  if (!b) return;
  appendMark({ day: b.dataset.d, cls: BOOK_CLS, lesson: '', start: 0 }, { row: '', name: b.dataset.n, eng: '' }, b.dataset.v);
  render();
});
// The bell reminds homeroom teachers (and managers) of orders due within three days or late.
const bellItemsBeforeBooks = bellItems;
bellItems = function () {
  const out = bellItemsBeforeBooks();
  try {
    const t = today();
    bookNeeds().filter(n => isMe(n.cm) && !bookSteps(n).ordered && Q.addDays(n.due, -3) <= t).forEach(n => out.push({ k: 'sach', icon: '📚', text: T('Đặt in sách ', 'Order books ') + n.cls + (n.book ? ' (' + n.book + ')' : '') + T(' · hạn ', ' · by ') + viDate(n.due).slice(0, 5), n: 1, hot: t > n.due, go: { view: 'lich', sec: 'sach' } }));
  } catch (e) {}
  return out;
};

/* ---------- The day at a glance (owner 08/11: "việc cần làm trong ngày hiển thị trực quan hơn... chèn đồ thị hay biểu lịch chuyên nghiệp,
 * lắm chữ mệt mỏi") ----------
 * Progress rings (today only): roll call taken / lessons begun, homework returned, printing done, things still waiting for me.
 * A timeline from 8:00 to 21:30: one coloured bar per lesson (KIDS blue, IELTS purple, FIGHTER amber, TA green, tutor grey), a red line
 * at the time now, finished lessons faded; the centre view has one lane per site. A bar opens its class. */
const TL_FROM = 8 * 60, TL_TO = 21 * 60 + 30;
const kindOfS = s => { const c = Q.key(s.cls); return /^KIDS/.test(c) ? 'kids' : /^IELTS/.test(c) ? 'ielts' : /^FIGHTER/.test(c) ? 'fighter' : /^TA\d*$/.test(c) || /^TA /.test(c) ? 'ta' : /TUTOR/.test(c) ? 'tutor' : 'other'; };
function ring(label, done, total, tone) {
  const pct = total ? Math.min(1, done / total) : 1, r = 22, c = 2 * Math.PI * r, col = tone || (pct >= 1 ? '#16a34a' : pct >= 0.5 ? '#f59e0b' : '#dc2626');
  return '<div class="ring"><svg viewBox="0 0 56 56" aria-hidden="true"><circle cx="28" cy="28" r="' + r + '" class="ring-bg"/><circle cx="28" cy="28" r="' + r + '" stroke="' + col + '" stroke-dasharray="' + (c * pct).toFixed(1) + ' ' + c.toFixed(1) + '" transform="rotate(-90 28 28)" class="ring-fg"/></svg>' +
    '<b>' + (total ? done + '/' + total : '✓') + '</b><span>' + esc(label) + '</span></div>';
}
// "KIDS 20" -> "KIDS " (hidden on phones) + "20", so a narrow bar still says which class it is.
function barLabel(s) {
  const name = Q.clean(s.cls).replace(/^TUTOR\s*/i, ''), m = name.match(/^(.*?\s)(\d[\d.]*)$/);
  return m ? '<span class="tl-pre">' + esc(m[1].trim()) + '&nbsp;</span>' + esc(m[2]) : esc(name);
}
function dayVisual(week) {
  if (!me || isBoard() || !week) return '';
  const centre = isManager() && filters.showAll, now = minutesNow(), isToday = day === today();
  const mine = s => isMe(s.teacher) || isMe(s.ta) || isMe(s.video);
  const all = week.data.sessions.filter(s => s.day === day && !s.off && s.start != null && s.end != null && (centre || mine(s)));
  if (!all.length) return '';
  let rings = '';
  if (isToday) {
    const begun = all.filter(s => classOf(s) && !isGroup(s) && now >= s.start + 15);
    const taken = begun.filter(s => { try { return !Q.rollCall(s, marksOf(s), today(), now).noRollCall; } catch (e) { return false; } }).length;
    const lastName = Q.key(me.name).split(' ').pop(), rets = (week.data.returns || []).filter(r => r.day === day && (centre || Q.key(r.who) === lastName));
    const duty = dutyOf(week, day), prints = duty && duty.print ? duty.print.filter(p => centre || isMe(p.name)) : [];
    const waiting = bellItems().filter(b => !['in', 'inno', 'out', 'rp'].includes(b.k));
    const reps = isCm() && reports.rows ? reportItems(me.name).filter(r => r.state === 'over' || r.state === 'today' || r.state === 'soon') : [];
    if (reps.length) waiting.unshift({ icon: '📝', text: reps.length + T(' tiết cần report', ' lessons to report'), n: reps.length, hot: reps.some(r => r.state === 'over') });
    const badges = waiting.length ? waiting.map(b => '<button class="dv-badge' + (b.hot ? ' hot' : '') + '" data-act="dvTodo" data-v="1" title="' + esc(b.text) + '" aria-label="' + esc(b.text) + '"><span>' + b.icon + '</span><b>' + (b.n || 1) + '</b></button>').join('')
      : '<span class="dv-badge ok" title="' + T('Không có việc nào chờ bạn', 'Nothing waiting') + '"><span>✅</span></span>';
    rings = '<div class="rings">' + (begun.length ? ring(T('Điểm danh', 'Roll call'), taken, begun.length) : '') + (rets.length ? ring(T('Trả BTVN', 'Returns'), rets.filter(r => r.done).length, rets.length) : '') +
      (prints.length ? ring(T('In ấn', 'Printing'), prints.filter(p => printDone(day, p.name)).length, prints.length) : '') +
      '<div class="dv-badges">' + badges + '</div></div>';
  }
  // Lanes: one per site in the centre view, else one; lessons that overlap in a lane go on separate rows.
  const lanes = {};
  all.slice().sort((a, b) => a.start - b.start).forEach(s => { const k = centre ? (Q.clean(s.site) || T('Khác', 'Other')) : T('Lịch của tôi', 'My day'); (lanes[k] = lanes[k] || []).push(s); });
  const pos = m => ((Math.max(TL_FROM, Math.min(TL_TO, m)) - TL_FROM) / (TL_TO - TL_FROM) * 100).toFixed(2) + '%';
  let ticks = '';
  for (let m = TL_FROM + 60 - (TL_FROM % 60); m <= TL_TO; m += 60) ticks += '<span class="tl-tick' + ((m / 60) % 2 ? ' odd' : '') + '" style="left:' + pos(m) + '">' + (m / 60) + 'h</span>';
  const laneHtml = Object.entries(lanes).map(([name, list]) => {
    const rowsEnd = [];
    const bars = list.map(s => {
      let r = rowsEnd.findIndex(e => e <= s.start); if (r < 0) { r = rowsEnd.length; rowsEnd.push(0); } rowsEnd[r] = s.end;
      const st = !isToday ? '' : now >= s.end ? ' past' : now >= s.start ? ' now' : '';
      const tg = classOf(s) ? 'button' : 'div';
      return '<' + tg + ' class="tl-bar k-' + kindOfS(s) + st + (tg === 'div' ? ' nolink' : '') + '" style="left:' + pos(s.start) + ';width:calc(' + pos(s.end) + ' - ' + pos(s.start) + ');top:' + (r * 30) + 'px" data-act="open" data-row="' + s.row + '" data-day="' + s.day + '" title="' + esc(s.cls + ' · ' + sessionTime(s) + (s.teacher ? ' · GV ' + s.teacher : '')) + '">' + barLabel(s) + '</' + tg + '>';
    }).join('');
    return '<div class="tl-lane"><div class="tl-name">' + esc(name) + '</div><div class="tl-track" style="height:' + (Math.max(1, rowsEnd.length) * 30) + 'px">' + bars + '</div></div>';
  }).join('');
  const nowLine = isToday && now >= TL_FROM && now <= TL_TO ? '<div class="tl-now" style="left:calc(var(--lane) + (100% - var(--lane)) * ' + (parseFloat(pos(now)) / 100).toFixed(4) + ')"><i>' + Q.clock(now) + '</i></div>' : '';
  return '<div class="card row dayvis">' + rings + '<div class="tl"><div class="tl-axis">' + ticks + '</div><div class="tl-body">' + laneHtml + nowLine + '</div></div></div>';
}

/* ---------- Layout upgrade (owner 09/11: header, day row, quick actions, compressed timeline, compact numbers) ---------- */
const svgI = d => '<svg viewBox="0 0 24 24" aria-hidden="true">' + d + '</svg>';
document.addEventListener('click', e => {
  const b = e.target.closest && e.target.closest('[data-act="navMore"]');
  if (b) { $('nav').classList.toggle('open'); b.setAttribute('aria-expanded', $('nav').classList.contains('open')); return; }
  if (e.target.closest && e.target.closest('#nav [data-act="view"]')) $('nav').classList.remove('open');
});

// Waiting things: one short name and one line icon per kind; two kinds never share a picture.
const QA = {
  alert: ['Điểm danh', 'Roll call', '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M16 11l2 2 4-4"/>'],
  lad: ['Phụ huynh', 'Parents', '<path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1.9.4 1.8.7 2.7a2 2 0 0 1-.5 2.1L8 9.8a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.4c.9.3 1.8.6 2.7.7a2 2 0 0 1 1.7 2z"/>'],
  wait: ['Duyệt ca', 'Check-ins', '<path d="M22 11.1V12a10 10 0 1 1-5.9-9.1"/><path d="M22 4L12 14l-3-3"/>'],
  tlate: ['Task trễ', 'Late tasks', '<circle cx="12" cy="13" r="8"/><path d="M12 9v4l2 2M5 3L2 6M22 6l-3-3"/>'],
  ttoday: ['Task', 'Tasks', '<path d="M9 6h11M9 12h11M9 18h11"/><path d="M4 6h.01M4 12h.01M4 18h.01"/>'],
  tret: ['Trả bài KT', 'Return tests', '<path d="M4 12v7a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-7"/><path d="M16 6l-4-4-4 4M12 2v13"/>'],
  ret: ['Trả BTVN', 'Returns', '<path d="M22 12h-6l-2 3h-4l-2-3H2"/><path d="M5.5 5.1L2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.5-6.9A2 2 0 0 0 16.8 4H7.2a2 2 0 0 0-1.7 1.1z"/>'],
  pay: ['Lương', 'Pay', '<rect x="2" y="5" width="20" height="14" rx="2"/><path d="M2 10h20M6 15h4"/>'],
  rp: ['Report', 'Reports', '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6M16 13H8M16 17H8"/>'],
  rpall: ['Report CN', 'Homeroom reports', '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6M9 15l2 2 4-4"/>'],
  print: ['In bài', 'Printing', '<path d="M6 9V2h12v7"/><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><rect x="6" y="14" width="12" height="8"/>'],
  sach: ['Đặt sách', 'Book orders', '<path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"/><path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"/>'],
  other: ['Khác', 'Other', '<circle cx="12" cy="12" r="9"/><path d="M12 8v5M12 16h.01"/>']
};
const qaKind = k => ({ pleft: 'pay', pwrong: 'pay' })[k] || (QA[k] ? k : 'other');
function quickActions() {
  const raw = bellItems().filter(b => !['in', 'inno', 'out', 'rp'].includes(b.k));
  const reps = isCm() && reports.rows ? reportItems(me.name).filter(r => r.state === 'over' || r.state === 'today' || r.state === 'soon') : [];
  if (reps.length) raw.unshift({ k: 'rp', n: reps.length, hot: reps.some(r => r.state === 'over'), text: reps.length + T(' tiết cần report', ' lessons to report') });
  const groups = [];
  raw.forEach(b => { const k = qaKind(b.k), g = groups.find(x => x.k === k); if (g) { g.n += b.n || 1; g.hot = g.hot || b.hot; g.text.push(b.text); } else groups.push({ k, n: b.n || 1, hot: !!b.hot, text: [b.text] }); });
  if (!groups.length) return '<div class="qa-row"><span class="qa ok">' + svgI('<path d="M20 6L9 17l-5-5"/>') + '<span class="qa-l">' + T('Không có việc nào chờ', 'Nothing waiting') + '</span></span></div>';
  return '<div class="qa-row">' + groups.map(g => { const d = QA[g.k]; return '<button class="qa' + (g.hot ? ' hot' : '') + '" data-act="dvTodo" data-v="1" data-k="' + g.k + '" title="' + esc(g.text.join(' · ')) + '">' + svgI(d[2]) + '<span class="qa-l">' + esc(T(d[0], d[1])) + '</span><b class="qa-n">' + (g.n > 99 ? '99+' : g.n) + '</b></button>'; }).join('') + '</div>';
}
function progChip(label, done, total) {
  const pct = total ? Math.min(1, done / total) : 1, r = 11, c = 2 * Math.PI * r, col = pct >= 1 ? 'var(--ok)' : pct >= 0.5 ? 'var(--k-fighter)' : 'var(--bad)';
  return '<span class="prog"><svg viewBox="0 0 28 28" aria-hidden="true"><circle cx="14" cy="14" r="' + r + '" class="ring-bg"/><circle cx="14" cy="14" r="' + r + '" stroke="' + col + '" stroke-dasharray="' + (c * pct).toFixed(1) + ' ' + c.toFixed(1) + '" transform="rotate(-90 14 14)" class="ring-fg"/></svg><span>' + esc(label) + '</span><b>' + done + '/' + total + '</b></span>';
}

// Rooms: short names in a fixed order; a class's colour by its kind.
const LANES = [['Tầng 1', /^(1ST FLOOR|TANG 1\b|1F\b)/], ['Tầng 2', /^(2ND FLOOR|TANG 2\b|2F\b)/], ['Tầng 3', /^(3RD FLOOR|TANG 3\b|3F\b)/], ['Tầng 4', /^(4TH FLOOR|TANG 4\b|4F\b)/], ['Villa', /^VILLA/], ['H.Nghi', /^HAM NGHI/], ['Little', /^LITTLE (SUN|STARS?)/], ['Meeting', /^MEETING/]];
function laneOf(site) {
  const k = Q.key(site), i = LANES.findIndex(([, re]) => re.test(k));
  if (i >= 0) return { name: LANES[i][0], order: i };
  return { name: k ? Q.clean(site).replace(/_/g, ' ') : T('Khác', 'Other'), order: k ? 50 : 99 };
}
function tlKind(s) {
  const c = Q.key(s.cls), site = Q.key(s.site);
  if (/LITTLE (SUN|STAR)/.test(site) || /^(BIRDY|PONY|KITTY)$/.test(c)) return 'ls';
  if (/TUTOR/.test(c)) return 'tutor';
  if (/^KIDS/.test(c)) return 'kids';
  if (/^IELTS/.test(c)) return 'ielts';
  if (/^FIGHTER/.test(c)) return 'fighter';
  if (/^TA\s*\d*$/.test(c)) return 'ta';
  return 'other';
}
const TL_KINDS = [['kids', 'KIDS'], ['ielts', 'IELTS'], ['fighter', 'FIGHTER'], ['ta', 'TA'], ['ls', 'Little Sun'], ['tutor', 'Tutor'], ['other', 'Khác']];
function tlLabel(s) {
  const c = Q.clean(s.cls), k = Q.key(c);
  let m;
  if ((m = k.match(/^KIDS\s*(\d+)$/))) return m[1];
  if ((m = k.match(/^IELTS\s*(\d+(?:\.\d+)?)$/))) return m[1];
  if ((m = k.match(/^FIGHTER\s*(\d+)$/))) return 'F' + m[1];
  if (/TUTOR/.test(k)) {
    const n = c.replace(/IELTS\s+TUTORING|TUTORING|TUTOR/ig, '').replace(/\bKIDS\s*\d+\b/ig, '').replace(/\bIELTS(\s*\d+)?\b/ig, '').replace(/\b(19|20)\d\d\b/g, '').replace(/\s*-\s*/g, ' · ').replace(/\s+/g, ' ').replace(/^[\s·]+|[\s·]+$/g, '');
    return n || 'Tutor';
  }
  return c;
}
// Time axis: hours with lessons get the width; an empty stretch longer than an hour shrinks to a thin dotted strip.
function tlScale(list) {
  const iv = list.map(s => [Math.floor((s.start - 15) / 30) * 30, Math.ceil((s.end + 15) / 30) * 30]).sort((p, q) => p[0] - q[0]);
  const act = [];
  iv.forEach(([p, q]) => { const l = act[act.length - 1]; if (l && p <= l[1] + 60) l[1] = Math.max(l[1], q); else act.push([p, q]); });
  const total = act.reduce((t, [p, q]) => t + q - p, 0), gapW = Math.max(12, total * 0.035), segs = [];
  act.forEach(([p, q], i) => { if (i) segs.push({ a: act[i - 1][1], b: p, gap: true, w: gapW }); segs.push({ a: p, b: q, gap: false, w: q - p }); });
  const sum = segs.reduce((t, sg) => t + sg.w, 0);
  let off = 0;
  segs.forEach(sg => { sg.x = off / sum; sg.f = sg.w / sum; off += sg.w; });
  const at = m => {
    if (m <= segs[0].a) return 0;
    const sg = segs.find(z => m >= z.a && m <= z.b);
    if (!sg) return 1;
    return sg.gap ? sg.x + sg.f / 2 : sg.x + (m - sg.a) / (sg.b - sg.a) * sg.f;
  };
  const ticks = [];
  segs.filter(z => !z.gap).forEach(z => { for (let m = Math.ceil(z.a / 60) * 60; m <= z.b; m += 60) if (!ticks.some(t => t.m === m)) ticks.push({ m, x: at(m) }); });
  const dense = 60 / sum < 0.075, gapsAt = segs.filter(z => z.gap).map(z => z.x + z.f / 2);
  // An hour label right beside the "⋯" of an empty stretch is left out, so the two never collide.
  return { at, segs, ticks: ticks.filter(t => !gapsAt.some(g => Math.abs(g - t.x) < 0.035)), dense };
}
dayVisual = function (week) {
  if (!me || isBoard() || !week) return '';
  const centre = isManager() && filters.showAll, now = minutesNow(), isToday = day === today();
  const mine = s => isMe(s.teacher) || isMe(s.ta) || isMe(s.video);
  const all = week.data.sessions.filter(s => s.day === day && !s.off && s.start != null && s.end != null && (centre || mine(s)));
  let top = '';
  if (isToday) {
    const begun = all.filter(s => classOf(s) && !isGroup(s) && now >= s.start + 15);
    const taken = begun.filter(s => { try { return !Q.rollCall(s, marksOf(s), today(), now).noRollCall; } catch (e) { return false; } }).length;
    const lastName = Q.key(me.name).split(' ').pop(), rets = (week.data.returns || []).filter(r => r.day === day && (centre || Q.key(r.who) === lastName));
    const duty = dutyOf(week, day), prints = duty && duty.print ? duty.print.filter(p => centre || isMe(p.name)) : [];
    const progs = (begun.length ? progChip(T('Đã điểm danh', 'Roll taken'), taken, begun.length) : '') + (rets.length ? progChip(T('Trả BTVN', 'Returns'), rets.filter(r => r.done).length, rets.length) : '') +
      (prints.length ? progChip(T('In ấn', 'Printing'), prints.filter(p => printDone(day, p.name)).length, prints.length) : '');
    top = quickActions() + (progs ? '<div class="progs">' + progs + '</div>' : '');
  }
  if (!all.length) return top ? '<div class="card row dayvis">' + top + '</div>' : '';
  const sc = tlScale(all), pct = f => (f * 100).toFixed(2) + '%';
  const lanes = {};
  all.slice().sort((p, q) => p.start - q.start).forEach(s => { const l = centre ? laneOf(s.site) : { name: T('Của tôi', 'Mine'), order: 0 }; (lanes[l.name] = lanes[l.name] || { order: l.order, list: [] }).list.push(s); });
  const ROW = 29;
  const laneHtml = Object.entries(lanes).sort((p, q) => p[1].order - q[1].order || p[0].localeCompare(q[0])).map(([name, { list }]) => {
    const ends = [];
    const bars = list.map(s => {
      // Lessons that overlap, or follow within 5 minutes, take separate rows.
      let r = ends.findIndex(e => e + 5 <= s.start); if (r < 0) { r = ends.length; ends.push(0); } ends[r] = s.end;
      const st = !isToday ? '' : now >= s.end ? ' past' : now >= s.start ? ' now' : '', tg = 'button', x0 = sc.at(s.start), x1 = sc.at(s.end);
      return '<' + tg + ' class="tl-bar k-' + tlKind(s) + st + (tg === 'div' ? ' nolink' : '') + '" style="left:' + pct(x0) + ';width:' + pct(Math.max(0.01, x1 - x0)) + ';top:' + (r * ROW) + 'px"' + ' data-act="tlInfo" data-row="' + s.row + '" data-day="' + s.day + '"' +
        ' data-s="' + esc(tlShort(tlLabel(s))) + '" title="' + esc(Q.clean(s.cls) + ' · ' + sessionTime(s) + (s.teacher ? ' · GV ' + s.teacher : '') + (s.site ? ' · ' + Q.clean(s.site) : '')) + '">' + esc(tlLabel(s)) + '</' + tg + '>';
    }).join('');
    return '<div class="tl-lane"><div class="tl-name" title="' + esc(name) + '">' + esc(name) + '</div><div class="tl-track" style="height:' + (Math.max(1, ends.length) * ROW - 3) + 'px">' + bars + '</div></div>';
  }).join('');
  const inBody = f => 'calc(var(--lane) + (100% - var(--lane)) * ' + f.toFixed(4) + ')';
  const grid = sc.ticks.map(t => '<i class="tl-grid" style="left:' + inBody(t.x) + '"></i>').join('') +
    sc.segs.filter(z => z.gap).map(z => '<i class="tl-gap" style="left:' + inBody(z.x) + ';width:calc((100% - var(--lane)) * ' + z.f.toFixed(4) + ')"></i>').join('');
  const nowX = isToday ? sc.at(now) : -1;
  const ticks = sc.ticks.filter(t => Math.abs(t.x - nowX) > 0.04).map((t, i) => '<span class="tl-tick' + (sc.dense && i % 2 ? ' odd' : '') + '" style="left:' + pct(t.x) + '">' + (t.m / 60) + 'h</span>').join('') +
    sc.segs.filter(z => z.gap).map(z => '<span class="tl-tick gap" style="left:' + pct(z.x + z.f / 2) + '" title="' + esc(Q.clock(z.a) + '–' + Q.clock(z.b) + T(' không có lớp', ' no lessons')) + '">⋯</span>').join('');
  const first = sc.segs[0].a, last = sc.segs[sc.segs.length - 1].b;
  const nowLine = isToday && now >= first && now <= last ? '<div class="tl-now" style="left:' + inBody(sc.at(now)) + '"><i>' + Q.clock(now) + '</i></div>' : '';
  return '<div class="card row dayvis">' + top + '<div class="tl"><div class="tl-axis">' + ticks + '</div><div class="tl-body">' + grid + laneHtml + nowLine + '</div></div>' + (centre ? tlLegend(week.data.sessions.filter(s => s.day === day)) : '') + '</div>';
};
// The day's numbers as one compact strip; each dot has the colour of its bars on the timeline.
dayStats = function (list) {
  const on = list.filter(s => !s.off), people = new Set(on.flatMap(s => [s.teacher, s.ta, s.video]).filter(Boolean).map(Q.nameKey)), by = {};
  on.forEach(s => { const k = tlKind(s); by[k] = (by[k] || 0) + 1; });
  const cells = [[on.length, T('Buổi học', 'Sessions'), 'all']].concat(TL_KINDS.filter(([k]) => by[k]).map(([k, n]) => [by[k], k === 'other' ? T('Khác', 'Other') : n, k]))
    .concat([[people.size, T('GV/TA đi làm', 'Staff on duty'), 'staff']]).concat(list.length - on.length ? [[list.length - on.length, T('Buổi nghỉ', 'Cancelled'), 'off']] : []);
  return '<div class="kpis">' + cells.map(([n, name, k]) => '<div class="kc k-' + k + '"><i></i><b>' + n + '</b><span>' + esc(name) + '</span></div>').join('') + '</div>';
};
// Short forms: "TUỆ ANH · HOÀNG BÁCH" -> "TUỆ ANH"; initials when even that does not fit.
const tlShort = l => String(l).split(' · ')[0];
const tlInitials = l => String(l).split(/[\s·]+/).filter(Boolean).map(w => /^\d/.test(w) ? w : w[0]).join('').slice(0, 4);
// After each drawing: a name that does not fit its bar gets smaller, then shorter, then initials; it is never cut in half.
function fitBars() {
  document.querySelectorAll('.tl-bar').forEach(b => {
    if (b.dataset.fit === b.clientWidth + '') return;
    const fits = () => b.scrollWidth <= b.clientWidth + 1;
    b.style.fontSize = ''; b.dataset.full = b.dataset.full || b.textContent; b.textContent = b.dataset.full;
    if (!fits()) b.style.fontSize = '10px';
    if (!fits()) b.textContent = b.dataset.s || b.dataset.full;
    if (!fits()) b.textContent = tlInitials(b.dataset.full);
    if (!fits()) b.textContent = '';
    b.dataset.fit = b.clientWidth + '';
  });
}
const renderBeforeFit = render;
render = function () { renderBeforeFit.apply(this, arguments); try { requestAnimationFrame(fitBars); } catch (e) {} };
window.addEventListener('resize', () => { try { requestAnimationFrame(fitBars); } catch (e) {} });
// Numbers strip, folded so a phone shows it in two short rows: staff and cancelled sit beside the sessions count; Little Sun joins "Khác" when both exist.
dayStats = function (list) {
  const on = list.filter(s => !s.off), people = new Set(on.flatMap(s => [s.teacher, s.ta, s.video]).filter(Boolean).map(Q.nameKey)), by = {};
  on.forEach(s => { const k = tlKind(s); by[k] = (by[k] || 0) + 1; });
  if (by.ls && by.other) { by.other += by.ls; delete by.ls; }
  const off = list.length - on.length;
  const sub = '<em>' + people.size + T(' GV/TA', ' staff') + (off ? T(' · ' + off + ' nghỉ', ' · ' + off + ' off') : '') + '</em>';
  const cells = [[on.length, T('Buổi học', 'Sessions'), 'all', sub]].concat(TL_KINDS.filter(([k]) => by[k]).map(([k, n]) => [by[k], k === 'other' ? T('Khác', 'Other') : n, k, '']));
  return '<div class="kpis' + (cells.length > 6 ? ' many' : '') + '">' + cells.map(([n, name, k, extra]) => '<div class="kc k-' + k + '"><i></i><b>' + n + extra + '</b><span>' + esc(name) + '</span></div>').join('') + '</div>';
};

/* ---------- Important Task: a ticked task fades in place and says who ticked it (owner 09/11) ----------
 * Each tick is also kept in DIEM_DANH (class "IMPORTANT TASK", name "<class> · <task>"), so the trail survives a reload. */
const TASK_CLS = 'IMPORTANT TASK', taskTicked = new Set();
const taskName = t => (Q.clean(t.cls) + ' · ' + Q.clean(t.what)).slice(0, 150);
const tickTaskBeforeTrail = tickTask;
tickTask = async function (week, task) {
  if (!task) return;
  const was = !!task.done;
  taskTicked.add(week.tab + '|' + task.row);
  await tickTaskBeforeTrail(week, task);
  if (!!task.done === was) return;
  try { if (!logs.marks) await loadMarks(); } catch (e) {}
  if (logs.marks) appendMark({ day: today(), cls: TASK_CLS, lesson: '', start: 0 }, { row: '', name: taskName(task), eng: '' }, task.done ? 'Đã xong' : 'Bỏ Đã xong');
  render();
};
function taskTrail(t) {
  if (!logs.marks) return null;
  const hit = logs.marks.rows.filter(r => r.cls === TASK_CLS && r.name === taskName(t) && /Đã xong$/.test(r.status)).pop();
  return hit && hit.status === 'Đã xong' ? hit : null;
}
const taskRowBeforeTrail = taskRow;
taskRow = function (t, week, canTick) {
  let out = taskRowBeforeTrail(t, week, canTick);
  if (!t.done) return out;
  const tr = taskTrail(t), when = tr ? ' · ' + esc(tr.by || '?') + ' ' + esc(String(tr.at || '').slice(11, 16) + ' ' + String(tr.at || '').slice(0, 5)) : '';
  out = out.replace('<div class="card row">', '<div class="card row task-done">');
  return out.replace(/<\/div><\/div><\/div>$/, '<div class="small muted trail">✓ ' + T('Đã xong', 'Done') + when + '</div></div></div></div>');
};

/* ---------- Lịch, inside (owner 09/11: "ít chữ – dòng phẳng – tag ngang – nút 1 chạm") ---------- */
const ICO = {
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  pin: '<path d="M12 21s-7-6.2-7-11.5A7 7 0 0 1 19 9.5C19 14.8 12 21 12 21z"/><circle cx="12" cy="9.5" r="2.5"/>',
  user: '<circle cx="12" cy="8" r="4"/><path d="M4 21v-1a6 6 0 0 1 6-6h4a6 6 0 0 1 6 6v1"/>',
  book: '<path d="M4 4.5A2.5 2.5 0 0 1 6.5 2H20v18H6.5A2.5 2.5 0 0 0 4 22.5z"/><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/>',
  list: '<path d="M9 6h11M9 12h11M9 18h11M4 6h.01M4 12h.01M4 18h.01"/>',
  sheet: '<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18M3 15h18M9 3v18"/>',
  check: '<path d="M20 6L9 17l-5-5"/>'
};
const ico = k => '<svg class="i" viewBox="0 0 24 24" aria-hidden="true">' + ICO[k] + '</svg>';
const pill = (k, text) => '<span class="pl">' + ico(k) + esc(text) + '</span>';
const clsBadge = cls => '<span class="cb k-' + tlKind({ cls, site: '' }) + '">' + esc(Q.clean(cls)) + '</span>';

// Timeline card: four lines, two buttons.
let tlInfoOpen = null;
function tlInfoDialog() {
  const w = weeks[Q.weekTab(tabs, tlInfoOpen.day)], s = w && w.data.sessions.find(z => z.row === tlInfoOpen.row);
  if (!s) { tlInfoOpen = null; return ''; }
  const c = classOf(s), detail = String(s.detail || '').split('\n').map(Q.clean).filter(Boolean)[0] || '';
  const lesson = [s.book ? Q.clean(s.book) : '', s.lesson ? T('Tiết ', 'Lesson ') + s.lesson : ''].filter(Boolean).join(' · ') + (detail ? ' (' + (detail.length > 42 ? detail.slice(0, 40) + '…' : detail) + ')' : '');
  const people = [s.teacher ? 'GV ' + Q.clean(s.teacher) : '', s.video ? Q.clean(s.video) : '', s.ta ? 'CN ' + Q.clean(s.ta) : ''].filter(Boolean);
  const sheet = c && c.tracker && isManager() ? '<a class="btn quiet" href="https://docs.google.com/spreadsheets/d/' + encodeURIComponent(c.tracker) + '/edit" target="_blank" rel="noopener">' + ico('sheet') + T('Mở Sheet lớp ↗', 'Open sheet ↗') + '</a>' : '';
  return '<div class="dash-veil" data-act="tlClose"></div><div class="dash-modal tl-card" role="dialog" aria-label="' + esc(s.cls) + '"><div class="dash-head">' + clsBadge(s.cls) + '<b>' + esc(dayLabel(s.day)) + '</b><span class="spacer"></span><button class="quiet" data-act="tlClose" aria-label="' + T('Đóng', 'Close') + '">✕</button></div>' +
    '<div class="dash-body"><div class="pls">' + pill('clock', sessionTime(s)) + (s.site ? pill('pin', laneOf(s.site).name) : '') + people.map(p => pill('user', p)).join('') + '</div>' +
    (lesson ? '<div class="tl-lesson">' + ico('book') + '<span>' + esc(lesson) + '</span></div>' : '') +
    '<div class="tl-btns">' + (c ? '<button class="primary" data-act="open" data-row="' + s.row + '" data-day="' + s.day + '">' + ico('list') + T('Xem danh sách HS', 'Pupil list') + '</button>' : '') + sheet + '</div></div></div>';
}
document.addEventListener('click', e => {
  const b = e.target.closest && e.target.closest('[data-act="tlInfo"],[data-act="tlClose"]');
  if (b) { tlInfoOpen = b.dataset.act === 'tlInfo' ? { row: Number(b.dataset.row), day: b.dataset.day } : null; render(); return; }
  if (tlInfoOpen && e.target.closest && e.target.closest('.tl-card [data-act="open"]')) tlInfoOpen = null;
}, true);

// Legend line: "20 ca: ● 6 · ● 5 … · 9 GV/TA".
function tlLegend(list) {
  const on = list.filter(s => !s.off), by = {}, people = new Set(on.flatMap(s => [s.teacher, s.ta, s.video]).filter(Boolean).map(Q.nameKey)), off = list.length - on.length;
  on.forEach(s => { const k = tlKind(s); by[k] = (by[k] || 0) + 1; });
  return '<div class="tl-legend"><b>' + on.length + T(' ca', ' sessions') + ':</b>' + TL_KINDS.filter(([k]) => by[k]).map(([k, n]) => '<span title="' + esc(k === 'other' ? T('Khác', 'Other') : n) + '"><i class="k-' + k + '"></i>' + by[k] + '</span>').join('<em>·</em>') +
    '<em>·</em><span class="muted" title="' + T('GV / TA đi làm', 'Staff on duty') + '">' + ico('user') + people.size + '</span>' + (off ? '<em>·</em><span class="bad">' + off + T(' nghỉ', ' off') + '</span>' : '') + '</div>';
}
dayStats = () => '';

// Rows behind each quick-action cell: class · who — short reason — one-tap button. Rows done while the dialog is open stay, faded.
let qaSnap = new Map();
function qaRows(kind) {
  const t = today(), week = weeks[Q.weekTab(tabs, t)], out = [], push = (k, cls, who, reason, btn, hot) => out.push({ key: kind + '|' + k, cls: Q.clean(cls), who, reason, btn, hot: !!hot });
  const saved = day; day = t;
  try {
    if (kind === 'alert' && week) alertSessions(week).forEach(s => {
      const ctx = classContext(s); if (!ctx.tracker) return;
      const roll = Q.rollCall(s, ctx.marks, t, minutesNow()), open = '<button class="quiet" data-act="open" data-row="' + s.row + '" data-day="' + s.day + '">' + T('Xử lý', 'Open') + '</button>';
      if (roll.noRollCall) return push(s.row, s.cls, Q.clock(s.start), T('Chưa điểm danh', 'No roll call'), open, true);
      if (isGroup(s)) return;
      ctx.tracker.pupils.forEach(p => { const m = ctx.marks.get(p.name), st = Q.pupilState(m, roll); if (st === 'Vắng chờ xác minh') push(s.row + p.name, s.cls, p.eng || p.name, T('Vắng chưa rõ', 'Absent?'), open, true); else if (m && m.status === 'Chưa báo nghỉ' && !m.contact) push(s.row + p.name, s.cls, p.eng || p.name, T('Vắng KP', 'No notice'), open, true); });
    });
    if (kind === 'lad' && ladder.rows) {
      const mine = r => isManager() || isTaSide(week) || isMe(homeroom[Q.key(r.cls)] || '');
      ladder.rows.filter(mine).forEach(r => { const rule = contactRule(r); if (contactDone(r, rule) || contactOld(r)) return; push(r.cls + r.name, r.cls, r.name, (rule.call ? T('Gọi PH', 'Call') : T('Nhắn PH', 'Message')) + ' · ' + T('mức ', 'lv ') + r.level, canContact(r, rule) ? '<button class="good" data-act="ladTick" data-cls="' + esc(r.cls) + '" data-name="' + esc(r.name) + '">' + ico('check') + '</button>' : '', t > rule.due); });
    }
    if ((kind === 'tlate' || kind === 'ttoday') && week) {
      const dueOf = z => isMe(z.teacher) ? z.gradeDue : z.returnDue;
      week.data.tasks.map(z => Object.assign({}, z, { ta: staffNow(z.ta, z.cls) })).filter(z => !z.done && (isMe(z.teacher) || isMe(z.ta))).forEach(z => {
        const d = dueOf(z); if (!(kind === 'tlate' ? d && d < t : d === t)) return;
        push(z.row, z.cls, Q.clean(z.what).split(/\s+/).slice(0, 4).join(' '), isMe(z.teacher) ? (kind === 'tlate' ? T('Chấm trễ', 'Grade late') : T('Chấm hôm nay', 'Grade today')) : (kind === 'tlate' ? T('Trả trễ', 'Return late') : T('Trả hôm nay', 'Return today')), '<button class="good" data-act="task" data-row="' + z.row + '">' + ico('check') + '</button>', kind === 'tlate');
      });
    }
    // Owner 10/11: graded Important Tasks the TA still has to return, each with its own "Đã trả" tap.
    if (kind === 'tret' && week) week.data.tasks.filter(z => z.done && z.ta && !taskReturned(z) && (isMe(taOf(z)) || isManager()) && !isMe(z.teacher)).forEach(z => {
      const late = !!(z.returnDue && z.returnDue < t);
      push('r' + z.row, z.cls, Q.clean(z.what).split('_').slice(-2).join(' · '), (late ? T('Trả trễ', 'Return late') : T('Cần trả', 'To return')) + (z.returnDue ? ' · ' + viDate(z.returnDue).slice(0, 5) : '') + (isMe(taOf(z)) ? '' : ' · ' + titleCase(taOf(z))), '<button class="good" data-act="taskRet" data-row="' + z.row + '" data-v="Đã trả">' + ico('check') + '</button>', late);
    });
    if (kind === 'ret' && week) { const last = Q.key(me.name).split(' ').pop(); (week.data.returns || []).filter(z => z.day === t && !z.done && Q.key(z.who) === last).forEach(z => push(z.row + '-' + z.col, z.cls, '', T('Chưa trả', 'Not returned'), '<button class="good" data-act="ret" data-row="' + z.row + '" data-col="' + z.col + '">' + ico('check') + '</button>')); }
    if ((kind === 'rp' || kind === 'rpall') && reports.rows) (kind === 'rp' ? reportItems(me.name).filter(z => ['over', 'today', 'soon'].includes(z.state)) : reportItems('').filter(z => z.state === 'over' && !isMe(z.cm))).forEach(z => push(z.k, z.s.cls, T('Tiết ', 'L') + z.s.lesson, z.state === 'over' ? T('Quá hạn', 'Overdue') : z.state === 'today' ? T('Hạn hôm nay', 'Due today') : T('Sắp đến hạn', 'Soon'), kind === 'rp' && canReport(z) ? '<button class="good" data-act="rpDone" data-k="' + esc(z.k) + '">' + ico('check') + '</button>' : '', z.state === 'over'));
    if (kind === 'sach') bookNeeds().filter(n => isMe(n.cm) && !bookSteps(n).ordered).forEach(n => push(bookName(n), n.cls, n.book || T('Sách mới', 'New book'), t > n.due ? T('Quá hạn đặt', 'Order late') : T('Đặt trước ', 'By ') + viDate(n.due).slice(0, 5), '<button class="good" data-act="bookTick" data-n="' + esc(bookName(n)) + '" data-d="' + n.first + '" data-v="Đã đặt in">' + ico('check') + '</button>', t > n.due));
    if (kind === 'print' && week) { const d = dutyOf(week, t); (d && d.print || []).filter(p => isMe(p.name) && !printDone(t, p.name)).forEach(p => push(p.name, T('In bài', 'Printing'), p.note || '', T('Chưa in', 'Not printed'), '<button class="good" data-act="printTick" data-p="' + esc(p.name) + '" data-v="Đã in xong">' + ico('check') + '</button>')); }
  } catch (e) { /* a list never breaks the page */ } finally { day = saved; }
  if (!out.length) bellItems().forEach((b, i) => { if (qaKind(b.k) === kind) out.push({ key: kind + '|b' + i, cls: '', who: b.text, reason: '', btn: '<button class="quiet" data-act="bellGo" data-i="' + i + '">' + T('Mở', 'Open') + '</button>', hot: b.hot }); });
  return out;
}
function qaListHtml(kind) {
  const rows = qaRows(kind), now = new Set(rows.map(r => r.key));
  rows.forEach(r => qaSnap.set(r.key, r));
  const all = [...qaSnap.values()].filter(r => r.key.startsWith(kind + '|')).map(r => now.has(r.key) ? r : Object.assign({}, r, { done: true }));
  if (!all.length) return '<div class="fl-empty">' + ico('check') + T('Không còn việc nào', 'Nothing left') + '</div>';
  const groups = new Map();
  all.forEach(r => { const g = r.cls || '—'; if (!groups.has(g)) groups.set(g, []); groups.get(g).push(r); });
  return [...groups.entries()].map(([cls, list]) => '<div class="fl-group">' + (cls !== '—' ? '<div class="fl-head">' + clsBadge(cls) + '<span>' + list.filter(r => !r.done).length + '</span></div>' : '') +
    list.map(r => '<div class="fl' + (r.done ? ' done' : '') + (r.hot && !r.done ? ' hot' : '') + '"><span class="fl-who">' + esc(r.who || r.cls) + '</span><span class="fl-why">' + esc(r.reason) + '</span><span class="fl-act">' + (r.done ? '<span class="fl-ok">' + ico('check') + '</span>' : r.btn) + '</span></div>').join('') + '</div>').join('');
}
function qaDialog(kind) {
  const kinds = kind === 'all' ? [...new Set(bellItems().filter(b => !['in', 'inno', 'out'].includes(b.k)).map(b => qaKind(b.k)))] : [kind];
  const body = kinds.map(k => (kinds.length > 1 ? '<div class="fl-kind">' + svgI(QA[k][2]) + esc(T(QA[k][0], QA[k][1])) + '</div>' : '') + qaListHtml(k)).join('');
  const d = QA[kind] || ['Việc cần làm', 'To do', ICO.list];
  return '<div class="dash-veil" data-act="dvTodo" data-v="0"></div><div class="dash-modal fl-modal" role="dialog"><div class="dash-head">' + svgI(d[2]) + '<b>' + esc(T(d[0], d[1])) + '</b><span class="spacer"></span><button class="quiet" data-act="dvTodo" data-v="0" aria-label="' + T('Đóng', 'Close') + '">✕</button></div><div class="dash-body">' + body + '</div></div>';
}
// The bell shows the same flat lines, grouped by kind then class.
const paintBellBeforeFlat = paintBell;
paintBell = function () {
  paintBellBeforeFlat();
  const box = document.querySelector('#bellPanel .bell-box');
  if (!box || box.dataset.flat) return;
  const kinds = [...new Set(bellItems().filter(b => !['in', 'inno', 'out'].includes(b.k)).map(b => qaKind(b.k)))];
  const head = box.querySelector('.row-top'), keep = [...box.children].filter(c => c !== head && !c.classList.contains('bell-item'));
  box.innerHTML = '';
  if (head) { const b = head.querySelector("b"); if (b) b.innerHTML = ICON_BELL.replace("<svg ", "<svg class=\"i\" ") + " " + esc(T("Thông báo", "Notifications")); box.appendChild(head); }
  const list = document.createElement('div');
  list.className = 'bell-flat';
  list.innerHTML = kinds.length ? kinds.map(k => '<div class="fl-kind">' + svgI(QA[k][2]) + esc(T(QA[k][0], QA[k][1])) + '</div>' + qaListHtml(k)).join('') : '<div class="fl-empty">' + ico('check') + T('Không có việc gì cần bạn lúc này.', 'Nothing needs you right now.') + '</div>';
  box.appendChild(list);
  keep.forEach(c => box.appendChild(c));
};

function ladCheckTag(l) {
  const c = viToIso(l.x.checked), dm = d => d.slice(8, 10) + '/' + d.slice(5, 7);
  if (!l.s) return c ? '<span class="tag">' + T('xét ', 'checked ') + dm(c) + '</span>' : '';
  if (c && c >= l.s.day) return '<span class="tag ok">' + T('Đã xét buổi này', 'Checked for this lesson') + '</span>';
  return '<span class="tag warn">' + T('Chưa xét buổi này · xét ~', 'Not checked yet · ~') + Q.clock(Math.max(0, l.s.start - 60)) + '</span>' + (c ? '<span class="small muted">' + T('đang hiện kết quả ', 'showing ') + dm(c) + '</span>' : '');
}

/* ---------- Lesson cards, toolbar and table view (owner 09/11, pasted spec; owed work stays off the cards) ----------
 * A card has three tiers: time + class + room; book · lesson with the detail cut to two lines; small chips for people, break and notes.
 * Cards in a row have the same height. Split groups with the same time and lesson (IELTS 46.1 / 46.2) share one card.
 * Above the list (whole-centre view): search (class, teacher, pupil), kind, room, "Cần in bài", and a card / table switch. */
const titleCase = n => Q.clean(n).toLowerCase().replace(/(^|[\s\-(])(\S)/g, (m, p, c) => p + c.toUpperCase());
const SC_ICO = { printer: '<path d="M6 9V2h12v7"/><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><rect x="6" y="14" width="12" height="8"/>', cam: '<path d="M23 7l-7 5 7 5V7z"/><rect x="1" y="5" width="15" height="14" rx="2"/>', home: '<path d="M3 10.5L12 3l9 7.5V21H3z"/><path d="M9 21v-6h6v6"/>', search: '<circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3"/>', grid: '<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/>', rows: '<path d="M3 6h18M3 12h18M3 18h18"/>' };
Object.assign(ICO, SC_ICO);
const roomText = site => Q.clean(site).replace(/_/g, ' · ');
function noteChips(s) {
  return String(s.note || '').split('\n').map(Q.clean).filter(Boolean).map(n => {
    const k = Q.key(n);
    if (/PRINT/.test(k)) return '<span class="chip warn">' + ico('printer') + T('Cần in bài', 'Printing needed') + '</span>';
    if (/VIDEO ?TAPER/.test(k)) return '<span class="chip">' + ico('cam') + T('Cần quay video', 'Video taper') + '</span>';
    if (/\bTA NEEDED\b/.test(k)) return '<span class="chip">' + ico('user') + T('Cần TA trông KT', 'Invigilator') + '</span>';
    return '<span class="chip" title="' + esc(n) + '">' + esc(n.length > 28 ? n.slice(0, 26) + '…' : n) + '</span>';
  }).join('');
}
const peopleChips = list => {
  const seen = new Set();
  return [s => ['user', 'GV', s.teacher], s => ['cam', helperRole(s), s.video], s => ['home', 'CN', s.ta]].flatMap(f => list.map(f)).filter(([, , n]) => n && !seen.has(Q.key(n)) && (seen.add(Q.key(n)), true))
    .map(([i, role, n]) => '<span class="chip">' + ico(i) + esc(role) + ': <b>' + esc(titleCase(n)) + '</b></span>').join('');
};
const schQ = s => { const c = classOf(s), t = c && trackers[c.key]; return Q.key([s.cls, s.teacher, s.ta, s.video, s.site, s.book, (s.merged || []).map(z => z.cls).join(' ')].concat(t ? t.pupils.flatMap(p => [p.name, p.eng]) : []).join(' ')); };
function scard(s) {
  const group = s.merged || [s], first = group[0], k = kindOf(first), c = classOf(first);
  const name = group.length > 1 ? group.map((z, i) => i ? Q.clean(z.cls).replace(/^.*?(\.\d+)$/, '$1') : Q.clean(z.cls)).join(' · ') : (k === 'tutor' ? Q.clean(s.cls).replace(/^TUTOR\s*/i, '') : Q.clean(s.cls));
  const rooms = [...new Set(group.map(z => z.site).filter(Boolean).map(roomText))];
  const detail = [String(first.detail || '').split('\n').map(Q.clean).filter(Boolean).join(' · ')].concat(first.also && first.also.length ? [T('Cùng buổi: ', 'Same session: ') + first.also.join(', ')] : []).filter(Boolean).join(' — ');
  const lesson = [first.book ? Q.clean(first.book) : '', first.lesson ? T('Tiết ', 'Lesson ') + first.lesson : ''].filter(Boolean).join(' · ');
  const chips = peopleChips(group) + (first.breakAt ? '<span class="chip">' + ico('clock') + T('Giải lao ', 'Break ') + esc(String(first.breakAt).replace(/^(\d{1,2})[.h](\d{2})$/, '$1:$2')) + '</span>' : '') + group.map(noteChips).join('');
  const inner = '<div class="sc-h"><span class="sc-time">' + Q.clock(first.start) + '–' + Q.clock(first.end) + '</span><strong>' + esc(name) + '</strong>' + liveTag(first) + (first.off ? '<span class="tag bad">' + T('Nghỉ', 'Off') + '</span>' : '') +
    '<span class="spacer"></span>' + (rooms.length ? '<span class="sc-room" title="' + esc(rooms.join(' / ')) + '">' + ico('pin') + esc(rooms.join(' / ')) + '</span>' : '') + '</div>' +
    (lesson || detail ? '<div class="sc-l">' + (lesson ? '<b>' + esc(lesson) + '</b>' : '') + (detail ? '<div class="sc-d" title="' + esc(detail) + '">' + esc(detail) + '</div>' : '') + '</div>' : '') +
    (chips ? '<div class="sc-c">' + chips + '</div>' : '') +
    (group.length > 1 && group.some(z => classOf(z)) ? '<div class="sc-open">' + group.filter(z => classOf(z)).map(z => '<button class="quiet" data-act="open" data-row="' + z.row + '" data-day="' + z.day + '">' + T('Mở ', 'Open ') + esc(Q.clean(z.cls)) + '</button>').join('') + '</div>' : '');
  const cl = 'card session sc k-' + k + (first.off ? ' off' : ''), q = ' data-q="' + esc(schQ(s)) + '"';
  return group.length === 1 && c ? '<button class="' + cl + ' link" data-act="open" data-row="' + first.row + '" data-day="' + first.day + '"' + q + '>' + inner + '</button>' : '<div class="' + cl + '"' + q + '>' + inner + '</div>';
}
sessionCard = scard;
// Split groups with the same time, book and lesson become one card.
function mergeGroups(list) {
  const out = [], seen = new Map();
  list.forEach(s => {
    const base = Q.key(s.cls).replace(/\.\d+$/, '');
    if (!/\.\d+$/.test(Q.clean(s.cls))) { out.push(s); return; }
    const k = [base, s.day, s.start, s.end, Q.key(s.book), s.lesson].join('|');
    if (seen.has(k)) { const m = seen.get(k); m.merged.push(s); return; }
    const m = Object.assign({}, s, { merged: [s] });
    seen.set(k, m); out.push(m);
  });
  return out.map(m => m.merged && m.merged.length === 1 ? m.merged[0] : m);
}
let schView = 'grid';
try { schView = localStorage.getItem('ql-schview') || 'grid'; } catch (e) {}
function schTable(list) {
  if (!list.length) return '';
  return '<div class="stbl" role="table"><div class="st-h" role="row"><span>' + T('Giờ', 'Time') + '</span><span>' + T('Lớp', 'Class') + '</span><span>' + T('Phòng', 'Room') + '</span><span>' + T('Bài học', 'Lesson') + '</span><span>' + T('GV & CN', 'Staff') + '</span><span>' + T('Trạng thái', 'Status') + '</span></div>' +
    list.map(s => {
      const g = s.merged || [s], f = g[0], c = classOf(f), name = g.map(z => Q.clean(z.cls)).join(' · '), staff = [...new Set(g.flatMap(z => [z.teacher, z.ta]).filter(Boolean).map(titleCase))].join(' · ');
      const status = liveTag(f) + (f.off ? '<span class="tag bad">' + T('Nghỉ', 'Off') + '</span>' : '') + (g.some(z => /PRINT/.test(Q.key(z.note))) ? '<span class="chip warn">' + ico('printer') + T('In bài', 'Print') + '</span>' : '');
      const cells = '<span class="st-t">' + Q.clock(f.start) + '–' + Q.clock(f.end) + '</span><span class="st-c">' + clsBadge(name) + '</span><span class="st-r">' + esc(f.site ? laneOf(f.site).name : '') + '</span><span class="st-l" title="' + esc([f.book, f.lesson, f.detail].filter(Boolean).join(' · ')) + '">' + esc([f.book ? Q.clean(f.book) : '', f.lesson ? T('T', 'L') + f.lesson : ''].filter(Boolean).join(' · ')) + '</span><span class="st-p">' + esc(staff) + '</span><span class="st-s">' + status + '</span>';
      const tag = g.length === 1 && c ? 'button' : 'div';
      return '<' + tag + ' class="st-row k-' + kindOf(f) + (f.off ? ' off' : '') + '" role="row" data-q="' + esc(schQ(s)) + '"' + (tag === 'button' ? ' data-act="open" data-row="' + f.row + '" data-day="' + f.day + '"' : '') + '>' + cells + '</' + tag + '>';
    }).join('') + '</div>';
}
function schToolbar(all) {
  const kinds = KINDS.filter(([k]) => all.some(s => kindOf(s) === k)), rooms = [...new Set(all.filter(s => s.site).map(s => laneOf(s.site)).sort((p, q) => p.order - q.order).map(l => l.name))];
  const pill = (act, v, on, label) => '<button class="fp' + (on ? ' on' : '') + '" data-act="' + act + '" data-v="' + esc(v) + '">' + label + '</button>';
  return '<div class="stools"><label class="sq">' + ico('search') + '<input id="schQ" type="search" placeholder="' + T('Tìm lớp, GV, học sinh…', 'Find class, teacher, pupil…') + '" value="' + esc(filters.q || '') + '" autocomplete="off"></label>' +
    '<div class="fps">' + pill('kind', '', !filters.kind, T('Tất cả', 'All')) + kinds.map(([k]) => pill('kind', k, filters.kind === k, esc(kindName(k)))).join('') + '</div>' +
    (rooms.length > 1 ? '<div class="fps">' + rooms.map(r => pill('schRoom', r, filters.room === r, esc(r))).join('') + '</div>' : '') +
    '<div class="fps">' + pill('schPrint', '1', !!filters.print, ico('printer') + T('Cần in bài', 'Printing')) + '</div>' +
    '<div class="seg st-view">' + '<button class="' + (schView === 'grid' ? 'on' : '') + '" data-act="schView" data-v="grid" aria-label="' + T('Dạng thẻ', 'Cards') + '">' + ico('grid') + '</button><button class="' + (schView === 'table' ? 'on' : '') + '" data-act="schView" data-v="table" aria-label="' + T('Dạng bảng', 'Table') + '">' + ico('rows') + '</button></div></div>';
}
const schMatch = (s, q) => !q || schQ(s).includes(q);
const dayPartsBeforeCards = dayParts;
dayParts = function (list) {
  const centre = isManager() && filters.showAll;
  const q = Q.key(filters.q || '');
  let shown = mergeGroups(list.filter(s => (!filters.room || (s.site && laneOf(s.site).name === filters.room)) && (!filters.print || /PRINT/.test(Q.key(s.note))) && (!centre || schMatch(s, q))));
  if (!centre) return dayPartsBeforeCards(shown);
  const body = !shown.length ? '<div class="card empty">' + T('Không có ca nào khớp bộ lọc.', 'Nothing matches.') + ' <button class="quiet" data-act="schClear">' + T('Bỏ lọc', 'Clear') + '</button></div>'
    : schView === 'table' ? schTable(shown) : dayPartsBeforeCards(shown);
  const wk = weeks[Q.weekTab(tabs, day)], dayAll = wk ? wk.data.sessions.filter(z => z.day === day) : list;
  return schToolbar(dayAll) + '<div class="sch-list">' + body + '</div>';
};
document.addEventListener('click', e => {
  const b = e.target.closest && e.target.closest('[data-act="schRoom"],[data-act="schPrint"],[data-act="schView"],[data-act="schClear"]');
  if (!b) return;
  const act = b.dataset.act;
  if (act === 'schRoom') filters.room = filters.room === b.dataset.v ? '' : b.dataset.v;
  if (act === 'schPrint') filters.print = !filters.print;
  if (act === 'schView') { schView = b.dataset.v; try { localStorage.setItem('ql-schview', schView); } catch (err) {} }
  if (act === 'schClear') { filters.room = ''; filters.print = false; filters.q = ''; filters.kind = ''; }
  render();
});
// Typing filters the list on the spot (the page does not redraw while the box has focus).
document.addEventListener('input', e => {
  if (!e.target || e.target.id !== 'schQ') return;
  filters.q = e.target.value;
  const q = Q.key(filters.q);
  document.querySelectorAll('.sch-list [data-q]').forEach(el => { el.style.display = !q || el.dataset.q.includes(q) ? '' : 'none'; });
});
document.addEventListener('focusout', e => { if (e.target && e.target.id === 'schQ') setTimeout(render, 0); });

/* ---------- Lesson card, four facts (owner 09/11, "Vibrant SaaS" spec) ----------
 * (1) solid time pill + big class name + room badge; (2) lesson title only, the long notes behind a small "Nội dung" icon (hover or tap);
 * (3) round avatars with short names. Owed work stays off the card (owner: "bỏ mục thiếu bài ở ngoài này đi"). */
const AV_COLORS = ['#4F46E5', '#0284C7', '#059669', '#D97706', '#DB2777', '#7C3AED', '#0D9488', '#E11D48'];
const avColor = n => { let s = 0; String(n).split('').forEach(c => { s = (s * 31 + c.charCodeAt(0)) >>> 0; }); return AV_COLORS[s % AV_COLORS.length]; };
const initials = n => Q.clean(n).split(/\s+/).filter(Boolean).slice(0, 2).map(w => w[0]).join('').toUpperCase();
const avatar = (role, n) => '<span class="av-chip" title="' + esc(role + ': ' + titleCase(n)) + '"><i style="background:' + avColor(Q.key(n)) + '">' + esc(initials(n)) + '</i><span>' + esc(role) + ': <b>' + esc(titleCase(n)) + '</b></span></span>';
ICO.doc = '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6M8 13h8M8 17h6"/>';
function scard4(s) {
  const group = s.merged || [s], f = group[0], k = kindOf(f), c = classOf(f);
  const name = group.length > 1 ? group.map((z, i) => i ? Q.clean(z.cls).replace(/^.*?(\.\d+)$/, '$1') : Q.clean(z.cls)).join(' · ') : (k === 'tutor' ? Q.clean(s.cls).replace(/^TUTOR\s*/i, '') : Q.clean(s.cls));
  const rooms = [...new Set(group.map(z => z.site).filter(Boolean).map(z => laneOf(z).name))];
  const lesson = [f.book ? Q.clean(f.book) : '', f.lesson ? T('Tiết ', 'Lesson ') + f.lesson : ''].filter(Boolean).join(' · ');
  const notes = group.flatMap(z => String(z.note || '').split('\n').map(Q.clean).filter(Boolean));
  const printing = notes.some(n => /PRINT/.test(Q.key(n)));
  const pop = [String(f.detail || '').trim() ? '<div class="pop-d">' + esc(String(f.detail).trim()) + '</div>' : '', f.also && f.also.length ? '<div>' + T('Cùng buổi: ', 'Same session: ') + esc(f.also.join(', ')) + '</div>' : '',
    f.breakAt ? '<div>' + T('Giải lao ', 'Break ') + esc(String(f.breakAt).replace(/^(\d{1,2})[.h](\d{2})$/, '$1:$2')) + '</div>' : '', notes.filter(n => !/PRINT/.test(Q.key(n))).map(n => '<div>• ' + esc(n) + '</div>').join(''),
    rooms.length ? '<div class="muted">' + esc(group.map(z => Q.clean(z.site)).filter(Boolean).join(' / ')) + '</div>' : ''].join('');
  const seen = new Set(), people = [z => ['GV', z.teacher], z => [helperRole(z), z.video], z => ['CN', z.ta]].flatMap(fn => group.map(fn)).filter(([, n]) => n && !seen.has(Q.key(n)) && (seen.add(Q.key(n)), true)).map(([r, n]) => avatar(r, n)).join('');
  const inner = '<div class="c4-h"><span class="c4-time">' + Q.clock(f.start) + '</span><strong>' + esc(name) + '</strong>' + (rooms.length ? '<span class="c4-room">' + esc(rooms.join(' / ')) + '</span>' : '') + '</div>' +
    '<div class="c4-l"><span class="c4-lt">' + esc(lesson || T('Chưa ghi bài', 'No lesson set')) + '</span>' + (printing ? '<span class="c4-print" title="' + T('Cần in bài', 'Printing needed') + '">' + ico('printer') + '</span>' : '') +
    (pop ? '<span class="c4-doc" data-act="scDoc" role="button" tabindex="0" aria-label="' + T('Nội dung', 'Details') + '">' + ico('doc') + T('Nội dung', 'Details') + '<span class="c4-pop">' + pop + '</span></span>' : '') + '</div>' +
    (people ? '<div class="c4-p">' + people + '</div>' : '') +
    '<div class="c4-tags">' + liveTag(f) + (f.off ? '<span class="tag bad">' + T('Nghỉ', 'Off') + '</span>' : '') + '<span class="c4-end">→ ' + Q.clock(f.end) + '</span></div>' +
    (group.length > 1 && group.some(z => classOf(z)) ? '<div class="sc-open">' + group.filter(z => classOf(z)).map(z => '<span class="c4-go" role="button" tabindex="0" data-act="open" data-row="' + z.row + '" data-day="' + z.day + '">' + T('Mở ', 'Open ') + esc(Q.clean(z.cls)) + '</span>').join('') + '</div>' : '');
  const cl = 'card session sc c4 k-' + k + (f.off ? ' off' : ''), q = ' data-q="' + esc(schQ(s)) + '"';
  return group.length === 1 && c ? '<button class="' + cl + ' link" data-act="open" data-row="' + f.row + '" data-day="' + f.day + '"' + q + '>' + inner + '</button>' : '<div class="' + cl + '"' + q + '>' + inner + '</div>';
}
sessionCard = scard4;
// "Nội dung": hover shows it on a computer; a tap pins it open (and does not open the class).
document.addEventListener('click', e => {
  const d = e.target.closest && e.target.closest('[data-act="scDoc"]');
  document.querySelectorAll('.c4-doc.open').forEach(o => { if (o !== d) o.classList.remove('open'); });
  if (!d) return;
  e.preventDefault(); e.stopPropagation();
  d.classList.toggle('open');
}, true);

/* ---------- Lớp chủ nhiệm: KPI cards, one line per class, pupils in a side drawer (owner 09/11) ---------- */
Object.assign(ICO, {
  users: '<path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.9M16 3.1a4 4 0 0 1 0 7.8"/>',
  school: '<path d="M22 10L12 5 2 10l10 5 10-5z"/><path d="M6 12v5c3 2 9 2 12 0v-5"/>',
  pct: '<path d="M19 5L5 19"/><circle cx="6.5" cy="6.5" r="2.5"/><circle cx="17.5" cy="17.5" r="2.5"/>',
  bolt: '<path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z"/>',
  alert: '<path d="M10.3 3.9L1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/><path d="M12 9v4M12 17h.01"/>',
  chart: '<path d="M3 3v18h18"/><path d="M7 15l4-4 3 3 5-6"/>',
  folder: '<path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>',
  cal: '<rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/>',
  phone: '<path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1.9.4 1.8.7 2.7a2 2 0 0 1-.5 2.1L8 9.8a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.4c.9.3 1.8.6 2.7.7a2 2 0 0 1 1.7 2z"/>'
});
const kpi4Card = (icon, tone, label, value, sub) => '<div class="kpi4c t-' + tone + '"><span class="kpi4i">' + ico(icon) + '</span><div><span class="kpi4l">' + esc(label) + '</span><b>' + value + '</b>' + (sub ? '<small>' + esc(sub) + '</small>' : '') + '</div></div>';
let hrDrawer = null;
function hrStats(x) {
  const t = trackers[x.cls.key];
  if (!t || t.light) return null;
  const owed = Q.owedVideos(t.pupils, t.blocks, t.practices, t.cell, { day: Q.addDays(today(), 1) });
  const rows = t.pupils.map((p, i) => ({ p, o: owed[i] || [] }));
  return { t, rows, owing: rows.filter(r => r.o.length).length, total: t.pupils.length };
}
const oweLabel = o => o.practice ? String(o.label || '').replace(/^Tự luyện video/i, 'Tự luyện') : T('Tiết ', 'L') + o.lesson;
viewHomerooms = function () {
  const list = myHomerooms();
  if (!list.length) return '<div class="card empty">' + (cnLoading ? T('Đang đọc…', 'Reading…') : T('Bạn chưa chủ nhiệm lớp nào trong tuần này.', 'No homeroom class this week.')) + '</div>' + (isManager() || isCm() ? reportSection() : '');
  const stats = list.map(x => ({ x, s: hrStats(x) })), loaded = stats.filter(z => z.s);
  const pupils = loaded.reduce((n, z) => n + z.s.total, 0), owing = loaded.reduce((n, z) => n + z.s.owing, 0);
  const rate = pupils ? Math.round((pupils - owing) / pupils * 100) : null;
  const reps = reports.rows ? reportItems(isManager() ? '' : me.name).filter(r => r.state === 'over' || r.state === 'today') : [];
  let h = '<div class="kpi4">' + kpi4Card('school', 'indigo', T('Lớp chủ nhiệm', 'Classes'), list.length, isManager() ? new Set(list.map(z => Q.key(z.cm))).size + T(' chủ nhiệm', ' homeroom teachers') : '') +
    kpi4Card('users', 'sky', T('Học sinh', 'Pupils'), loaded.length ? pupils : '—', loaded.length < list.length ? T('đã đọc ', 'read ') + loaded.length + '/' + list.length + T(' lớp', ' classes') : '') +
    kpi4Card('pct', rate == null ? 'slate' : rate >= 85 ? 'green' : rate >= 60 ? 'amber' : 'red', T('Đủ bài', 'Caught up'), rate == null ? '—' : rate + '%', owing ? owing + T(' HS còn nợ', ' pupils owe') : '') +
    kpi4Card('bolt', reps.length ? 'red' : 'green', T('Cần xử lý ngay', 'Act now'), reps.length, T('report quá hạn / hôm nay', 'reports due')) + '</div>';
  h += '<div class="hr-tbl">' + stats.sort((a, b) => (b.s ? b.s.owing / Math.max(1, b.s.total) : -1) - (a.s ? a.s.owing / Math.max(1, a.s.total) : -1)).map(({ x, s }) => {
    const pct = s && s.total ? Math.round((s.total - s.owing) / s.total * 100) : 0, tone = !s ? 'none' : pct >= 85 ? 'green' : pct >= 60 ? 'amber' : 'red';
    const next = x.next ? dayLabel(x.next.day).replace(/^Thứ /, 'T').replace(/^Chủ nhật/, 'CN') + ' ' + Q.clock(x.next.start) : '';
    return '<div class="hr-row"><span class="dot d-' + tone + '"></span>' + clsBadge(x.cls.name) + (isManager() ? '<span class="hr-cm">' + esc(titleCase(x.cm)) + '</span>' : '') + '<span class="hr-next">' + esc(next) + '</span>' +
      (s ? '<span class="hr-bar"><i class="d-' + tone + '" style="width:' + pct + '%"></i></span><span class="hr-n">' + (s.total - s.owing) + '/' + s.total + '</span><button class="quiet hr-go" data-act="hrDrawer" data-k="' + esc(x.cls.key) + '">' + (s.owing ? '<span class="tag bad">' + s.owing + T(' nợ', ' owe') + '</span>' : '<span class="tag ok">' + T('Đủ', 'OK') + '</span>') + ' ›</button>'
        : '<span class="hr-bar"></span><span class="hr-n">—</span><button class="quiet hr-go" data-act="cnLoad" data-k="' + esc(x.cls.key) + '">' + T('Xem ›', 'Load ›') + '</button>') + '</div>';
  }).join('') + '</div>';
  h += isManager() || isCm() ? reportSection() : '';
  if (hrDrawer) h += hrDrawerHtml(list.find(z => z.cls.key === hrDrawer));
  return h;
};
function hrDrawerHtml(x) {
  if (!x) { hrDrawer = null; return ''; }
  const s = hrStats(x);
  const rows = s ? s.rows.slice().sort((a, b) => b.o.length - a.o.length) : [];
  const body = !s ? '<div class="fl-empty">' + T('Đang đọc…', 'Reading…') + '</div>' : rows.map(r => '<div class="dw-row' + (r.o.length ? '' : ' done') + '"><span class="dw-n' + (r.o.length ? '' : ' ok') + '">' + (r.o.length || '✓') + '</span><div><b>' + esc(r.p.eng || r.p.name) + '</b>' + (r.p.eng ? '<small>' + esc(r.p.name) + '</small>' : '') +
    (r.o.length ? '<div class="dw-chips">' + [...new Set(r.o.map(oweLabel))].map(l => '<span class="chip">' + esc(l) + '</span>').join('') + '</div>' : '') + '</div></div>').join('');
  return '<div class="dw-veil" data-act="hrClose"></div><aside class="drawer" role="dialog" aria-label="' + esc(x.cls.name) + '"><div class="dw-head">' + clsBadge(x.cls.name) + '<b>' + (s ? s.owing + T(' HS còn nợ bài', ' pupils owe work') : '') + '</b><span class="spacer"></span>' +
    (x.next ? '<button class="quiet" data-act="open" data-row="' + x.next.row + '" data-day="' + x.next.day + '">' + T('Mở lớp', 'Open') + '</button>' : '') + '<button class="quiet" data-act="hrClose" aria-label="' + T('Đóng', 'Close') + '">✕</button></div><div class="dw-body">' + body + '</div></aside>';
}
document.addEventListener('click', e => {
  const b = e.target.closest && e.target.closest('[data-act="hrDrawer"],[data-act="hrClose"]');
  if (b) { hrDrawer = b.dataset.act === 'hrDrawer' ? b.dataset.k : null; render(); return; }
  if (hrDrawer && e.target.closest && e.target.closest('.drawer [data-act="open"]')) hrDrawer = null;
});
document.addEventListener('keydown', e => { if (e.key === 'Escape' && hrDrawer) { hrDrawer = null; render(); } });

// Colour icon squares in place of the emoji on dashboard tiles (Điều hành and the Lịch tiles).
const TILE_ICO = { ca: ['pin', 'green'], vang: ['users', 'sky'], task: ['list', 'amber'], loi: ['alert', 'red'], thang: ['chart', 'indigo'], cot: ['folder', 'violet'], phat: ['phone', 'red'], lamviec: ['cal', 'indigo'], sach: ['book', 'sky'] };
const vividTiles = html => html.replace(/data-v="(\w+)"><span class="dash-ico">[^<]*<\/span>/g, (m, k) => TILE_ICO[k] ? 'data-v="' + k + '"><span class="dash-ico vi t-' + TILE_ICO[k][1] + '">' + ico(TILE_ICO[k][0]) + '</span>' : m);
const dashTilesBeforeVivid = dashTiles;
dashTiles = function (week) { return vividTiles(dashTilesBeforeVivid(week)); };
const viewScheduleBeforeVivid = viewSchedule;
viewSchedule = function (week) { return vividTiles(viewScheduleBeforeVivid(week)); };

/* ---------- Lương, Hợp đồng, Người dùng: KPI cards, flat rows, details on tap (owner 09/11) ---------- */
Object.assign(ICO, {
  wallet: '<rect x="2" y="5" width="20" height="14" rx="2"/><path d="M2 10h20M16 15h2"/>',
  coin: '<circle cx="12" cy="12" r="9"/><path d="M15 9.5c-.5-1-1.6-1.5-3-1.5-1.7 0-3 .9-3 2s1.3 1.7 3 2 3 .9 3 2-1.3 2-3 2c-1.4 0-2.5-.5-3-1.5M12 6v2M12 16v2"/>',
  clockx: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  file: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/>',
  shield: '<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>'
});
const money = s => Number(String(s || '').replace(/[^\d]/g, '')) || 0;
const fmtMoney = n => n.toLocaleString('vi-VN') + ' đ';
const dmy = d => d ? String(viDate(d)).slice(0, 5) + '/' + String(d).slice(2, 4) : '—';

// Lương: the explanation becomes three date pills; the owner's list becomes KPI cards and one line per person.
const viewLuongBeforeKpi = viewLuong;
viewLuong = function () {
  let out = viewLuongBeforeKpi();
  const d = isOwner() ? pay.all : pay.mine;
  if (d && d.dates) out = out.replace(/<p class="small muted">(Ngày |Shows )[^<]*<\/p>/, '<div class="pls">' + pill('cal', T('Hiện ', 'Shows ') + dmy(d.dates.show)) + pill('check', T('Kiểm tra đến ', 'Check by ') + dmy(d.dates.check)) + pill('wallet', T('Trả lương ', 'Paid ') + dmy(d.dates.pay)) + '</div>');
  if (!isOwner() || !d || pay.err || (pay.person && pay.mine)) return out;
  const rows = d.rows || [], cut = out.indexOf('<div class="count">');
  if (cut < 0 || !rows.length) return out;
  const isPaid = r => r.state && r.state.paid, ok = r => r.state && r.state.check && r.state.check.action === 'Đúng' && !r.state.check.stale, wrong = r => r.state && r.state.check && r.state.check.action === 'Báo sai';
  const total = rows.reduce((n, r) => n + money(r.net), 0), paidSum = rows.filter(isPaid).reduce((n, r) => n + money(r.net), 0);
  let h = out.slice(0, cut) + '<div class="kpi4">' + kpi4Card('wallet', 'indigo', T('Tổng lương', 'Total pay'), fmtMoney(total), rows.length + T(' người', ' people')) +
    kpi4Card('coin', 'green', T('Đã trả', 'Paid'), fmtMoney(paidSum), rows.filter(isPaid).length + T(' người', ' people')) +
    kpi4Card('clockx', total - paidSum ? 'red' : 'green', T('Chưa trả', 'Unpaid'), fmtMoney(total - paidSum), rows.filter(r => !isPaid(r)).length + T(' người', ' people')) +
    kpi4Card('check', rows.some(wrong) ? 'red' : 'amber', T('Đã xác nhận', 'Confirmed'), rows.filter(ok).length + '/' + rows.length, rows.some(wrong) ? rows.filter(wrong).length + T(' báo sai', ' wrong') : '') + '</div>';
  h += '<div class="hr-tbl pay-tbl">' + rows.map(r => {
    const st = wrong(r) ? ['bad', T('Báo sai', 'Wrong')] : r.state && r.state.check && r.state.check.stale ? ['warn', T('Đã sửa sau XN', 'Changed')] : ok(r) ? ['ok', T('Đã XN', 'Confirmed')] : ['', T('Chưa XN', 'Not checked')];
    return '<div class="hr-row pay-row"><span class="av-chip"><i style="background:' + avColor(Q.key(r.name)) + '">' + esc(initials(r.name)) + '</i><span><b>' + esc(titleCase(r.name)) + '</b></span></span><span class="chip">' + esc(r.tab) + '</span>' +
      '<span class="pay-st"><span class="tag ' + st[0] + '">' + st[1] + '</span>' + (isPaid(r) ? '<span class="tag ok">' + T('Đã trả', 'Paid') + '</span>' : '') + '</span><b class="pay-net">' + esc(r.net || '') + '</b>' +
      (r.person ? '<span class="pay-btns"><button class="quiet" data-act="payOpen" data-p="' + esc(r.person) + '">' + T('Chi tiết ▸', 'Details ▸') + '</button>' + (isPaid(r) ? '<button class="quiet" data-act="payPaid" data-v="Bỏ đã trả" data-p="' + esc(r.person) + '" title="' + T('Bỏ đánh dấu đã trả', 'Unmark paid') + '">↺</button>' : '<button class="good" data-act="payPaid" data-v="Đã trả" data-p="' + esc(r.person) + '">' + ico('check') + T('Trả', 'Pay') + '</button>') + '</span>'
        : '<span class="pay-btns"><button class="quiet" data-act="payOpen" data-p="' + esc(r.name) + '" title="' + T('Chưa có link app', 'No app link') + '">' + T('Chi tiết ▸', 'Details ▸') + '</button><span class="small muted">' + T('chưa có link', 'no app user') + '</span></span>') + '</div>';
  }).join('') + '</div>';
  return h;
};

// Hợp đồng: KPI cards, one line per person with a coloured term badge; everything else in a pop-up.
let hdOpen = '';
const viewHopDongBeforeKpi = viewHopDong;
viewHopDong = function () {
  const out = viewHopDongBeforeKpi(), cut = out.indexOf('<div class="count">'), formAt = out.indexOf('<div class="card row"><b>' + T('Thêm hoặc gia hạn hợp đồng', 'Add or renew'));
  if (!hd.rows || cut < 0 || formAt < 0) return out;
  const latest = new Map(); hd.rows.forEach(r => latest.set(Q.key(r.person), r));
  const now = today(), soon = Q.addDays(now, 30), list = [...latest.values()].filter(r => r.status !== 'Đã xoá');
  const state = r => r.end && r.end < now ? ['bad', T('Hết hạn', 'Expired')] : r.end && r.end <= soon ? ['warn', T('Sắp hết hạn', 'Ends soon')] : r.trial && r.trial >= now ? ['warn', T('Thử việc', 'Probation')] : ['ok', T('Còn hạn', 'In force')];
  const without = people.filter(p => !/chủ/i.test(p.role) && !latest.has(Q.key(p.name))).map(p => p.name);
  const n = k => list.filter(r => state(r)[0] === k).length;
  let h = out.slice(0, cut) + '<div class="kpi4">' + kpi4Card('file', 'indigo', T('Hợp đồng', 'Contracts'), list.length, '') + kpi4Card('shield', 'green', T('Còn hạn', 'In force'), n('ok'), '') +
    kpi4Card('clockx', n('warn') ? 'amber' : 'green', T('Sắp hết / thử việc', 'Soon / probation'), n('warn'), '') + kpi4Card('alert', n('bad') + without.length ? 'red' : 'green', T('Hết hạn / chưa có', 'Expired / none'), n('bad') + without.length, '') + '</div>';
  h += '<div class="hr-tbl">' + without.map(p => '<div class="hr-row hd-row"><span class="dot d-red"></span><b>' + esc(titleCase(p)) + '</b><span class="small muted">—</span><span class="tag bad">' + T('Chưa có HĐ', 'No contract') + '</span><span></span></div>').join('') +
    list.sort((a, b) => (a.end || '9999').localeCompare(b.end || '9999')).map(r => { const [c, t] = state(r); return '<div class="hr-row hd-row"><span class="dot d-' + (c === 'ok' ? 'green' : c === 'warn' ? 'amber' : 'red') + '"></span><b>' + esc(titleCase(r.person)) + '</b><span class="small muted hd-dates">' + esc(dmy(r.start)) + ' → ' + esc(r.end ? dmy(r.end) : T('không hạn', 'open')) + '</span><span class="tag ' + c + '">' + t + '</span><button class="quiet" data-act="hdOpen" data-p="' + esc(r.person) + '">' + T('Chi tiết ▸', 'Details ▸') + '</button></div>'; }).join('') + '</div>';
  h += out.slice(formAt);
  const o = hdOpen && latest.get(Q.key(hdOpen));
  if (o) { const [c, t] = state(o), line = (k, v) => v ? '<div class="kv"><span>' + esc(k) + '</span><b>' + esc(v) + '</b></div>' : '';
    h += '<div class="dash-veil" data-act="hdClose"></div><div class="dash-modal" role="dialog"><div class="dash-head"><b>' + esc(titleCase(o.person)) + '</b><span class="tag ' + c + '">' + t + '</span><span class="spacer"></span><button class="quiet" data-act="hdClose" aria-label="' + T('Đóng', 'Close') + '">✕</button></div><div class="dash-body kvs">' +
      line(T('Loại', 'Type'), o.type) + line(T('Số', 'No.'), o.no) + line(T('Ngày ký', 'Signed'), o.signed && viDate(o.signed)) + line(T('Bắt đầu', 'Start'), o.start && viDate(o.start)) + line(T('Kết thúc', 'End'), o.end ? viDate(o.end) : T('Không thời hạn', 'Open-ended')) + line(T('Thử việc đến', 'Probation to'), o.trial && viDate(o.trial)) + line(T('Ghi chú', 'Note'), o.note) + '</div></div>'; }
  return h;
};
document.addEventListener('click', e => {
  const b = e.target.closest && e.target.closest('[data-act="hdOpen"],[data-act="hdClose"]');
  if (b) { hdOpen = b.dataset.act === 'hdOpen' ? b.dataset.p : ''; render(); }
});

// Người dùng: profile cards with an avatar coloured by role; shorter wording.
const ROLE_COLOR = { 'Chủ': '#C026D3', 'Quản lí': '#4F46E5', 'GV': '#0284C7', 'TA': '#D97706' };
const viewNguoiBeforeCards = viewNguoi;
viewNguoi = function () {
  let out = viewNguoiBeforeCards();
  out = out.replace(/<p>Chọn tên trong danh sách[^<]*<\/p>/, '').replace(/<p class="sub">Mỗi người một link riêng[^<]*<\/p>/, '<p class="sub small muted">Mỗi người một link riêng · xoá là hết hiệu lực</p>')
    .replace(/<p>Dùng trên máy ở lớp: [^<]*<\/p>/, '<p class="small muted">Dùng ở máy trên lớp · chỉ thấy lịch và màn hình lớp</p>');
  const at = out.indexOf('<div class="card"><h3>Đang có link</h3>');
  if (at < 0 || !nguoi || !nguoi.people.length) return out;
  const by = {}; nguoi.people.forEach(p => { (by[p.role] = by[p.role] || []).push(p); });
  const order = ['Chủ', 'Quản lí', 'GV', 'TA'].concat(Object.keys(by).filter(r => !['Chủ', 'Quản lí', 'GV', 'TA'].includes(r)));
  const cards = order.filter(r => by[r]).map(r => '<div class="part"><h2>' + esc(r === 'Chủ' ? 'Admin' : r) + '</h2><span>' + by[r].length + '</span></div><div class="pf-grid">' + by[r].sort((a, b) => a.name.localeCompare(b.name, 'vi')).map(p => {
    const col = ROLE_COLOR[p.role] || '#475569', self = p.name === me.name && p.role === me.role;
    return '<div class="pf"><i style="background:' + col + '">' + esc(initials(p.name)) + '</i><div class="pf-t"><b>' + esc(titleCase(p.name)) + '</b><span class="pf-role" style="color:' + col + ';background:' + col + '1a">' + esc(p.role === 'Chủ' ? 'Admin' : p.role) + '</span><small>' + T('Cấp ', 'Since ') + esc(String(p.at || '').slice(0, 10)) + '</small></div>' +
      (self ? '<span class="tag">' + T('Bạn', 'You') + '</span>' : '<button class="quiet pf-x" data-act="nguoiXoa" data-id="' + esc(p.id) + '" title="' + T('Xoá link', 'Remove link') + '" aria-label="' + T('Xoá link của ', 'Remove link of ') + esc(p.name) + '">✕</button>') + '</div>';
  }).join('') + '</div>').join('');
  return out.slice(0, at) + '<div class="card"><h3>Đang có link · ' + nguoi.people.length + '</h3>' + cards + '</div>';
};

fitBars = function () {
  const track = document.querySelector('.tl-track');
  if (!track) return;
  const tw = track.clientWidth, base = innerWidth < 641 ? 11 : 12;
  document.querySelectorAll('.tl-bar').forEach(b => {
    const full = b.dataset.full || (b.dataset.full = b.textContent), w = parseFloat(b.style.width) / 100 * tw - 8;
    const fits = (t, px) => String(t).length * px * 0.66 <= w;
    let txt = full, fs = '';
    if (!fits(full, base)) { fs = '10px'; if (!fits(full, 10)) { txt = b.dataset.s || full; if (!fits(txt, 10)) { txt = tlInitials(full); if (!fits(txt, 10)) txt = ''; } } }
    if (b.style.fontSize !== fs) b.style.fontSize = fs;
    if (b.textContent !== txt) b.textContent = txt;
  });
};

// Managers see when a week tab's rota header carries the wrong dates (the app has placed the days by column order meanwhile).
const viewScheduleBeforeStale = viewSchedule;
viewSchedule = function (week) {
  const h = viewScheduleBeforeStale(week);
  if (!week || !isManager() || !week.data.duty || !week.data.duty.stale) return h;
  const note = '<div class="notice bad">' + T('Tab ' + esc(week.tab) + ': hàng ngày ở LỊCH LÀM VIỆC TA đang ghi sai ngày (bắt đầu ' + esc(viDate(week.data.duty.stale).slice(0, 5)) + '). App tạm xếp theo thứ; sửa hàng ngày trong Schedule giúp.', 'The rota header of ' + esc(week.tab) + ' has wrong dates; days are placed by column for now.') + '</div>';
  return note + h;
};

/* ---------- Lớp chủ nhiệm, class overview from lists already worked out (owner 09/11: "logic Lớp chủ nhiệm đang sai... tổng quan lớp,
 * dữ liệu phải đúng... làm sao không hết quota") ----------
 * No class sheet is read any more (the old page read every homeroom class's whole sheet on each visit and counted homework its own way).
 *  - homework owed: the Schedule's AUTO_KIDS_BU_BAI, the official list the Schedule worked out from the class sheets with the owner's
 *    rules (one read for all classes, kept 5 minutes);
 *  - penalty levels: AUTO_KIDS_MUC_PHAT (already read for Lịch);
 *  - class size and absences: the attendance log the app already holds (pupils marked in the last lesson; absences in 14 days);
 *  - reports and the next lesson: as before. */
const buBai = { rows: null, at: 0, loading: false };
async function loadBuBai(force) {
  if (buBai.loading || (!force && buBai.rows && Date.now() - buBai.at < 300000)) return;
  buBai.loading = true;
  try {
    const [[rows]] = [await batchGet(CONFIG.scheduleId, ["'AUTO_KIDS_BU_BAI'!A2:I800"])];
    buBai.rows = rows.filter(r => Q.clean(r[1]) && Q.clean(r[2])).map(r => ({ cls: Q.clean(r[1]), name: Q.clean(r[2]), reason: Q.clean(r[3]), items: String(r[4] || '').split('\n[TA_REASON')[0].trim(), scanned: Q.clean(r[6]) }));
    buBai.at = Date.now();
  } finally { buBai.loading = false; }
}
loadHomerooms = async function () {
  if (cnLoading) return;
  cnLoading = true;
  try {
    await Promise.all([weekOf(today()), weekOf(Q.addDays(today(), 7)), weekOf(Q.addDays(today(), -7)), loadHomeroom(), loadBuBai(), loadMarks(), loadLadder(), ensureReportData()].map(p => Promise.resolve(p).catch(() => null)));
  } finally { cnLoading = false; render(); }
};
const markIsPupil = m => m && m.name && m.name !== CHOT_NAME;
function classSummary(x) {
  const k = x.cls.key, t = today(), from = Q.addDays(t, -14);
  let size = null;
  if (x.last) { try { size = [...marksOf(x.last).values()].filter(markIsPupil).length || null; } catch (e) {} }
  const marks = logs.marks ? logs.marks.rows.filter(r => Q.key(r.cls) === k && r.day >= from && r.day <= t && markIsPupil(r)) : [];
  const latest = new Map();
  marks.forEach(r => latest.set(r.day + '|' + r.time + '|' + r.name, r));
  const absent = [...latest.values()].filter(r => Q.ABSENT.includes(r.status));
  const owed = (buBai.rows || []).filter(r => Q.key(r.cls) === k);
  const lad = (ladder.rows || []).filter(r => Q.key(r.cls) === k && r.level >= 1).sort((a, b) => b.level - a.level);
  const reps = reports.rows ? reportItems('').filter(r => Q.key(r.s.cls) === k && (r.state === 'over' || r.state === 'today')) : [];
  const kids = /^KIDS/i.test(x.cls.name);
  const tone = lad.some(r => r.level >= 3) || reps.some(r => r.state === 'over') ? 'red' : owed.length || lad.length || absent.length >= 3 ? 'amber' : 'green';
  return { size, absent, owed, lad, reps, kids, tone, scanned: owed[0] ? owed[0].scanned : '' };
}
viewHomerooms = function () {
  const list = myHomerooms();
  if (!buBai.rows && !buBai.loading) setTimeout(() => loadBuBai().then(render).catch(() => {}), 0);
  if (!list.length) return '<div class="card empty">' + (cnLoading ? T('Đang đọc…', 'Reading…') : T('Bạn chưa chủ nhiệm lớp nào trong tuần này.', 'No homeroom class this week.')) + '</div>' + (isManager() || isCm() ? reportSection() : '');
  ktQueue(list.map(z => z.cls));
  const all = list.map(x => ({ x, s: classSummary(x) }));
  const pupils = all.reduce((n, z) => n + (z.s.size || 0), 0), owing = all.reduce((n, z) => n + z.s.owed.length, 0);
  const act = all.reduce((n, z) => n + z.s.reps.length + z.s.lad.filter(r => r.level >= 3).length, 0);
  let h = '<div class="kpi4">' + kpi4Card('school', 'indigo', T('Lớp chủ nhiệm', 'Classes'), list.length, isManager() ? new Set(list.map(z => Q.key(z.cm))).size + T(' chủ nhiệm', ' homeroom teachers') : '') +
    kpi4Card('users', 'sky', T('Học sinh', 'Pupils'), pupils || '—', T('theo điểm danh buổi gần nhất', 'from the last roll call')) +
    kpi4Card('pct', !buBai.rows ? 'slate' : owing ? 'amber' : 'green', T('Em nợ bài', 'Owing work'), buBai.rows ? owing : '…', buBai.rows && pupils ? Math.round(owing / pupils * 100) + T('% sĩ số · danh sách Schedule', '% · Schedule list') : '') +
    kpi4Card('bolt', act ? 'red' : 'green', T('Cần xử lý', 'Act now'), act, T('report trễ · phạt từ M3', 'late reports · level 3+')) + '</div>';
  const order = { red: 0, amber: 1, green: 2 };
  h += '<div class="hr-tbl">' + all.sort((a, b) => order[a.s.tone] - order[b.s.tone] || a.x.cls.name.localeCompare(b.x.cls.name, 'vi', { numeric: true })).map(({ x, s }) => {
    const next = x.next ? dayLabel(x.next.day).replace(/^Thứ /, 'T').replace(/^Chủ nhật/, 'CN') + ' ' + Q.clock(x.next.start) : '';
    const levels = [5, 4, 3, 2, 1].map(l => [l, s.lad.filter(r => r.level === l).length]).filter(([, n]) => n).map(([l, n]) => '<span class="lvl l' + l + '">M' + l + (n > 1 ? '×' + n : '') + '</span>').join('');
    return '<button class="hr-row hr-ov" data-act="hrDrawer" data-k="' + esc(x.cls.key) + '"><span class="dot d-' + s.tone + '"></span>' + clsBadge(x.cls.name) +
      '<span class="hr-cm">' + esc(isManager() ? titleCase(x.cm) : next) + '</span>' +
      '<span class="hr-chips"><span class="chip" title="' + T('Sĩ số theo điểm danh buổi gần nhất', 'Pupils at the last roll call') + '">' + ico('users') + (s.size || '—') + '</span>' +
      (s.kids ? (s.owed.length ? '<span class="chip warn">' + T('Nợ bài ', 'Owe ') + s.owed.length + '</span>' : buBai.rows ? '<span class="chip ok-chip" title="' + T('Không em nào trong danh sách bù bài của Schedule', 'Nobody on the Schedule makeup list') + '">' + T('Nợ 0', 'Owe 0') + '</span>' : '') : '') +
      ktChip(x.cls.key) + levels + (s.absent.length ? '<span class="chip">' + T('Vắng ', 'Absent ') + s.absent.length + '</span>' : '') + (s.reps.length ? '<span class="chip warn">' + T('Report ', 'Report ') + s.reps.length + '</span>' : '') + '</span>' +
      '<span class="hr-next">' + esc(isManager() ? next : '') + '</span><span class="hr-go-ic">›</span></button>';
  }).join('') + '</div>';
  h += isManager() || isCm() ? reportSection() : '';
  if (hrDrawer) h += hrOverviewDrawer(list.find(z => z.cls.key === hrDrawer));
  return h;
};
function hrOverviewDrawer(x) {
  if (!x) { hrDrawer = null; return ''; }
  const s = classSummary(x), dm = d => String(d || '').slice(8, 10) + '/' + String(d || '').slice(5, 7);
  const sec = (title, n, body) => '<div class="dw-sec"><div class="dw-sec-h"><b>' + title + '</b><span>' + n + '</span></div>' + body + '</div>';
  const none = t => '<div class="small muted dw-none">' + t + '</div>';
  const byPupil = new Map();
  s.absent.forEach(r => { const a = byPupil.get(r.name) || []; a.push(dm(r.day)); byPupil.set(r.name, a); });
  let body = '';
  if (x.next) body += '<div class="pls">' + pill('cal', dayLabel(x.next.day) + ' ' + Q.clock(x.next.start)) + (x.next.book ? pill('book', Q.clean(x.next.book) + (x.next.lesson ? ' · ' + T('Tiết ', 'L') + x.next.lesson : '')) : '') + '</div>';
  body += s.kids ? sec(T('Nợ bài', 'Homework owed'), s.owed.length + (s.scanned ? T(' · quét ', ' · checked ') + esc(s.scanned.slice(0, 5)) : ''),
    s.owed.length ? s.owed.map(r => '<div class="dw-row"><span class="dw-n">!</span><div><b>' + esc(r.name) + '</b><small>' + esc(r.reason) + '</small>' + (r.items ? '<div class="dw-chips">' + r.items.split(/,\s*|;\s*/).filter(Boolean).slice(0, 6).map(i => '<span class="chip">' + esc(i) + '</span>').join('') + '</div>' : '') + '</div></div>').join('') : none(buBai.rows ? T('Không em nào trong danh sách nợ bài.', 'Nobody on the list.') : T('Đang đọc…', 'Reading…'))) : '';
  body += ktSection(x.cls.key);
  body += sec(T('Mức phạt', 'Penalty levels'), s.lad.length, s.lad.length ? s.lad.map(r => '<div class="dw-row"><span class="lvl l' + r.level + '">M' + r.level + '</span><div><b>' + esc(r.name) + '</b><small>' + esc(r.reason) + (r.since ? T(' · từ ', ' · since ') + esc(r.since.slice(0, 5)) : '') + '</small></div></div>').join('') : none(T('Không em nào.', 'Nobody.')));
  body += sec(T('Vắng 14 ngày', 'Absent, 14 days'), s.absent.length, byPupil.size ? [...byPupil.entries()].sort((a, b) => b[1].length - a[1].length).map(([n, days]) => '<div class="dw-row"><span class="dw-n">' + days.length + '</span><div><b>' + esc(n) + '</b><small>' + esc(days.join(', ')) + '</small></div></div>').join('') : none(T('Không vắng buổi nào.', 'No absences.')));
  if (s.reps.length) body += sec(T('Report cần làm', 'Reports due'), s.reps.length, s.reps.map(r => '<div class="dw-row"><span class="dw-n">' + esc(r.s.lesson) + '</span><div><b>' + T('Tiết ', 'Lesson ') + esc(r.s.lesson) + '</b><small>' + esc(dayLabel(r.s.day)) + (r.state === 'over' ? T(' · quá hạn', ' · overdue') : T(' · hạn hôm nay', ' · due today')) + '</small></div></div>').join(''));
  return '<div class="dw-veil" data-act="hrClose"></div><aside class="drawer" role="dialog" aria-label="' + esc(x.cls.name) + '"><div class="dw-head">' + clsBadge(x.cls.name) + '<b>' + esc(titleCase(x.cm)) + '</b><span class="spacer"></span>' +
    (x.next ? '<button class="quiet" data-act="open" data-row="' + x.next.row + '" data-day="' + x.next.day + '">' + T('Mở lớp', 'Open') + '</button>' : '') + '<button class="quiet" data-act="hrClose" aria-label="' + T('Đóng', 'Close') + '">✕</button></div><div class="dw-body">' + body + '</div></aside>';
}

/* ---------- Paper-test scores in the homeroom overview (owner 09/11: "điểm số học sinh nữa") ----------
 * The server reads only the "KIỂM TRA GIẤY ĐỊNH KÌ" columns of a class and keeps them 6 hours for everyone; the page keeps its copy on
 * this device too, so the overview shows at once and asks again at most hourly, two classes at a time. */
const ktData = {}, ktWait = [];
let ktBusy = 0;
function ktQueue(classes) {
  classes.forEach(c => {
    const have = ktData[c.key] || (saved.get('kt:' + c.key) ? (ktData[c.key] = saved.get('kt:' + c.key)) : null);
    if ((have && Date.now() - have.at < 3600000) || ktWait.some(z => z.key === c.key) || (have && have.loading)) return;
    ktWait.push(c);
  });
  while (ktBusy < 2 && ktWait.length) {
    const c = ktWait.shift();
    ktBusy++;
    const old = ktData[c.key];
    ktData[c.key] = Object.assign({}, old || {}, { loading: true });
    call('diemlop', { cls: c.name }).then(d => { ktData[c.key] = { data: d, at: Date.now() }; keep('kt:' + c.key, ktData[c.key]); })
      .catch(() => { ktData[c.key] = Object.assign({}, old || { data: null }, { at: Date.now() - 3000000, loading: false }); })
      .finally(() => { ktBusy--; ktRenderSoon(); if (ktWait.length) ktQueue([]); });
  }
}
let ktRenderTimer = 0;
function ktRenderSoon() { clearTimeout(ktRenderTimer); ktRenderTimer = setTimeout(render, ktWait.length || ktBusy ? 1500 : 150); }
const ktTone = p => p >= 85 ? 'ok' : p >= 65 ? 'warn' : 'bad';
function ktLatest(key) {
  const d = ktData[key] && ktData[key].data;
  const t = d && d.tests && d.tests.find(z => Object.values(z.scores).some(v => typeof v === 'number'));
  if (!t) return null;
  const vals = Object.values(t.scores).filter(v => typeof v === 'number');
  const avg = vals.reduce((n, v) => n + v, 0) / vals.length;
  return { t, avg, pct: Math.round(avg / t.total * 100), marked: vals.length };
}
function ktChip(key) {
  const k = ktLatest(key);
  if (!k) return '';
  return '<span class="chip kt-' + ktTone(k.pct) + '" title="' + esc(k.t.title + (k.t.date ? ' · ' + viDate(k.t.date) : '') + ' · ' + k.marked + T(' em', ' pupils')) + '">' + T('KT ', 'Test ') + k.pct + '%</span>';
}
function ktSection(key) {
  const d = ktData[key];
  if (!d || !d.data) return '<div class="dw-sec"><div class="dw-sec-h"><b>' + T('Kiểm tra giấy', 'Paper tests') + '</b><span>…</span></div><div class="small muted dw-none">' + T('Đang đọc điểm…', 'Reading scores…') + '</div></div>';
  const k = ktLatest(key);
  if (!k) return '<div class="dw-sec"><div class="dw-sec-h"><b>' + T('Kiểm tra giấy', 'Paper tests') + '</b><span>0</span></div><div class="small muted dw-none">' + T('Chưa có điểm kiểm tra giấy.', 'No paper-test score yet.') + '</div></div>';
  const rows = Object.entries(k.t.scores).sort((a, b) => (typeof a[1] === 'number' ? a[1] : 999) - (typeof b[1] === 'number' ? b[1] : 999));
  const older = d.data.tests.filter(z => z !== k.t).slice(0, 4).map(z => { const v = Object.values(z.scores).filter(n => typeof n === 'number'); return v.length ? '<div class="small muted">' + esc(z.title) + (z.date ? ' · ' + esc(viDate(z.date).slice(0, 5)) : '') + T(' · TB ', ' · avg ') + Math.round(v.reduce((n, a) => n + a, 0) / v.length / z.total * 100) + '%</div>' : ''; }).join('');
  return '<div class="dw-sec"><div class="dw-sec-h"><b>' + T('Kiểm tra giấy', 'Paper tests') + ' · ' + esc(k.t.title) + '</b><span class="chip kt-' + ktTone(k.pct) + '">' + T('TB ', 'Avg ') + k.pct + '%</span></div>' +
    '<div class="small muted">' + (k.t.date ? T('Ngày kiểm tra ', 'Test date ') + esc(viDate(k.t.date)) + ' · ' : '') + T('tổng ', 'out of ') + k.t.total + '</div>' +
    rows.map(([n, v]) => { const p = typeof v === 'number' ? Math.round(v / k.t.total * 100) : null; return '<div class="kt-row"><b>' + esc(n) + '</b><span>' + (p == null ? esc(v) : v + '/' + k.t.total) + '</span>' + (p == null ? '<span class="chip">' + T('vắng', 'absent') + '</span>' : '<span class="chip kt-' + ktTone(p) + '">' + p + '%</span>') + '</div>'; }).join('') + older + '</div>';
}

/* ---------- IELTS / FIGHTER: who may not come in today (owner 09/11: "nay buổi 5 vocab 2 mà buổi 4 vocab 2 chưa làm bài thì không được
 * vào lớp... cảnh báo lúc mở điểm danh để tôi quyết định ấn tick hay sent home") ----------
 *  - IELTS: the Schedule's own gate list (AUTO_IELTS_TRUOC_GIO_HOC, made one hour before each class: skill and task code still missing);
 *  - FIGHTER: work owed from the class sheet for the programme of today's lesson (not self-study), due by today.
 * The roll call shows a red line at the top and a line under each pupil; the teacher still decides: tick present or "Cho về". */
const ieltsGate = { rows: null, at: 0, loading: false };
function loadIeltsGate() {
  if (ieltsGate.loading || (ieltsGate.rows && Date.now() - ieltsGate.at < 600000)) return;
  ieltsGate.loading = true;
  batchGet(CONFIG.scheduleId, ["'AUTO_IELTS_TRUOC_GIO_HOC'!A2:H800"]).then(([rows]) => { ieltsGate.rows = rows; ieltsGate.at = Date.now(); })
    .catch(() => {}).finally(() => { ieltsGate.loading = false; render(); });
}
const dmyOf = iso => iso.slice(8, 10) + '/' + iso.slice(5, 7) + '/' + iso.slice(0, 4);
function gateOf(ctx, p) {
  const s = ctx.session;
  if (!s || !isSecondary(s)) return null;
  if (/^IELTS/i.test(Q.clean(s.cls))) {
    if (!ieltsGate.rows) { loadIeltsGate(); return null; }
    const hit = ieltsGate.rows.find(r => Q.clean(r[1]) === dmyOf(s.day) && Q.key(r[2]) === Q.key(s.cls) && Q.key(r[3]) === Q.key(p.name));
    return hit ? { why: T('chưa làm bài ', 'missing ') + Q.clean(r4(hit[4])) + (Q.clean(hit[7]) && hit[7] !== '0' ? ' (' + Q.clean(hit[7]) + ')' : '') } : null;
  }
  const book = Q.key(s.book);
  if (!book) return null;
  const owed = (secOwedOf(ctx, p) || []).filter(o => !o.self && Q.key(o.label).includes(book));
  return owed.length ? { why: T('chưa làm ', 'missing ') + owed.slice(0, 2).map(shortTask).join(', ') + (owed.length > 2 ? ' +' + (owed.length - 2) : '') } : null;
}
const r4 = v => ({ SPEAKING: 'Nói', WRITING: 'Viết', READING: 'Đọc', LISTENING: 'Nghe' })[Q.key(v)] || Q.clean(v);
function gateChecked(s) {
  if (!/^IELTS/i.test(Q.clean(s.cls))) return true;
  return !!(ieltsGate.rows && ieltsGate.rows.some(r => Q.clean(r[1]) === dmyOf(s.day) && Q.key(r[2]) === Q.key(s.cls)));
}
// The line under each pupil on the class page.
const kidsMakeupBeforeGate = kidsMakeup;
kidsMakeup = function (ctx, p, i, canEdit) {
  const g = gateOf(ctx, p), st = (ctx.marks.get(p.name) || {}).status || '';
  const line = g ? '<div class="gate-line">⛔ ' + T('Không vào lớp: ', 'Not allowed in: ') + esc(g.why) + (st === SEND_HOME ? ' · ' + T('đã cho về', 'sent home') : '') + '</div>' : '';
  return line + kidsMakeupBeforeGate(ctx, p, i, canEdit);
};
// The red line at the top of the roll call.
const viewClassBeforeGate = viewClass;
viewClass = function () {
  const out = viewClassBeforeGate();
  if (!current || !isSecondary(current)) return out;
  const ctx = classContext(current);
  if (!ctx.tracker) return out;
  const list = ctx.tracker.pupils.map(p => ({ p, g: gateOf(ctx, p) })).filter(z => z.g);
  const note = list.length ? '<div class="notice bad gate-top">⛔ ' + list.length + T(' em chưa làm bài buổi trước, theo luật không được vào lớp: ', ' pupils have not done the last homework and may not come in: ') + esc(list.map(z => z.p.eng || z.p.name).join(', ')) + T('. Cô/thầy chọn Có mặt, "Cho về · thiếu bài" hay "Ra ngoài bù bài".', '. Choose present, "Sent home" or "Make up outside".') + '</div>'
    : !gateChecked(current) ? '<div class="notice gate-top">' + T('Danh sách không vào lớp của buổi này chưa quét (Schedule quét khoảng 1 tiếng trước giờ học).', 'The not-allowed-in list for this lesson is not ready yet (about an hour before class).') + '</div>' : '';
  const at = out.indexOf('<div class="card"><div class="pupil');
  return note && at >= 0 ? out.slice(0, at) + note + out.slice(at) : out + note;
};
// On the class screen pupils see: a short bilingual flag.
const pupilFlagsBeforeGate = pupilFlags;
pupilFlags = function (ctx, r) {
  const html = pupilFlagsBeforeGate(ctx, r), g = gateOf(ctx, r.p);
  if (!g) return html;
  const flag = '<span class="rv-flag debt">⛔ ' + T('Chưa làm bài buổi trước', 'Last homework not done') + ' <i class="rv-en-i">Homework missing</i></span>';
  return html ? html.replace('<span class="rv-flags">', '<span class="rv-flags">' + flag) : '<span class="rv-flags">' + flag + '</span>';
};

/* ---------- Late minutes everywhere (owner 09/11: "có ghi số phút... từ hôm nay áp dụng đồng bộ và làm chuẩn") ----------
 * A pupil ticked after the roll call closes is "Đến muộn"; the minutes are counted from the lesson start to the first tick of the
 * current late streak (later re-marks with the same status do not move it). A tick made after the lesson (fixing the record)
 * has no minutes, so it shows "Đến muộn" alone rather than a wrong number. */
function lateMinOf(s, name) {
  if (!s || !logs.marks) return 0;
  const prefix = [s.day, s.classKey, s.lesson, Q.clock(s.start)].join('|') + '|';
  let first = null;
  logs.marks.rows.forEach(m => { if (m.name !== name || !markKey(m).startsWith(prefix)) return; if (m.status === 'Đến muộn') { if (!first) first = m; } else first = null; });
  const t = first && stampMinutes(first.at);
  if (!t || t.day !== s.day || t.min > s.end) return 0;
  return Math.max(1, t.min - s.start);
}
const lateMinText = (s, name) => { const n = lateMinOf(s, name); return n ? ' ' + n + T(' phút', ' min') : ''; };
const attendTextBeforeMin = attendText;
attendText = function (m) {
  if (m && m.status === 'Đến muộn' && current) { const n = lateMinOf(current, m.name); if (n) return '<span class="sum-late">Đến muộn ' + n + ' phút</span>'; }
  return attendTextBeforeMin(m);
};
const pupilFlagsBeforeMin = pupilFlags;
pupilFlags = function (ctx, r) {
  const h = pupilFlagsBeforeMin(ctx, r), n = lateMinOf(ctx.session, r.p.name);
  return n ? h.replace('⏰ Muộn <i class="rv-en-i">Late</i>', '⏰ Muộn ' + n + ' phút <i class="rv-en-i">Late ' + n + ' min</i>') : h;
};

/* ---------- FIGHTER test scores on the class screen (owner 09/11: "lúc nào tôi có bài kiểm tra là tôi có điểm ngay hôm ấy... tự mở cột
 * cho tôi... trừ Practice test"; "nhập điểm ở đây thì cũng ghi vào sheet... nhập xong thì cũng nhảy thứ tự cho hs thấy") ----------
 * A FIGHTER lesson is a test when its lesson text (Schedule AUTO_GUIDELINES_CACHE) starts "kiểm tra Unit N"; practice tests and
 * Đoạn văn học thuật never are. On that day the server opens the column pair in the class sheet if it is missing (MoKT.gs).
 * Each pupil row gets a box for the number of correct answers; it is written to the count column of the sheet (the score out of 10
 * is the sheet's own formula). Pupils are ranked by it with the same slide-up as stars, and the summary shows it. */
const ktG = { map: null, any: null, at: 0, loading: false }, ktOpen = {}, ktVals = {};
const ktBookKey = s => Q.key(s).replace(/[^A-Z0-9.]+/g, ' ').trim();
function loadKtGuide() {
  if (ktG.loading || (ktG.map && Date.now() - ktG.at < 21600000)) return;
  const kept = saved.get('ktguide2');
  if (kept && kept.map && kept.any && Date.now() - kept.at < 21600000) { ktG.map = kept.map; ktG.any = kept.any; ktG.at = kept.at; return; }
  ktG.loading = true;
  batchGet(CONFIG.scheduleId, ["'AUTO_GUIDELINES_CACHE'!A2:C2000", "'AUTO_GUIDELINES_CACHE'!F2:F2000"]).then(([a, f]) => {
    const map = {}, any = {};
    a.forEach((r, i) => {
      if (Q.clean(r[0]) !== 'IELTS_FIGHTER') return;
      const d = Q.key((f[i] || [])[0] || ''), k = ktBookKey(r[1]) + '|' + Q.clean(r[2]), m = d.match(/^KIEM TRA UNIT\s*([\d.]+)/);
      if (m) map[k] = m[1];
      if (/^KIEM TRA\b/.test(d)) any[k] = 1;
    });
    ktG.map = map; ktG.any = any; ktG.at = Date.now(); keep('ktguide2', { map, any, at: ktG.at });
  }).catch(() => {}).finally(() => { ktG.loading = false; render(); });
}
function ktUnitOf(s) {
  if (!s || !/^FIGHTER/i.test(Q.clean(s.cls))) return '';
  if (!ktG.map) { loadKtGuide(); return ''; }
  return ktG.map[ktBookKey(s.book) + '|' + Q.clean(s.lesson)] || '';
}
// The pair inside "Điểm Kiểm tra" of the class sheet header (same rule as the server).
function ktFindCol(t, book, unit) {
  const head = t.head || [], r1 = head[0] || [], r2 = head[1] || [], r3 = head[2] || [], width = Math.max(r1.length, r2.length, r3.length);
  const sc = r1.findIndex(v => /DIEM\s*KIEM\s*TRA/.test(Q.key(v)));
  if (sc < 0) return null;
  let end = width;
  for (let c = sc + 1; c < width; c++) if (Q.clean(r1[c])) { end = c; break; }
  const bk = ktBookKey(book), re = new RegExp('\\bUNIT ' + unit.replace('.', '\\.') + '(?![0-9.])');
  for (let c = sc; c < end; c++) { const k = ktBookKey(r2[c]); if (k && k.includes(bk) && re.test(k)) { const m = Q.key(r3[c]).match(/TONG\s*:?\s*(\d+)/); return { col: c, total: m ? Number(m[1]) : 0 }; } }
  return null;
}
function ktOf(ctx) {
  const s = ctx && ctx.session, t = ctx && ctx.tracker;
  if (!t || !t.head) return null;
  const unit = ktUnitOf(s);
  if (!unit) return null;
  const hit = ktFindCol(t, s.book, unit), key = Q.sessionKey(s);
  if (!hit) { if (s.day === today()) ktOpenNow(s); return { unit, col: -1, total: 0, opening: !!ktOpen[key] }; }
  ktLoadVals(ctx, hit.col);
  return { unit, col: hit.col, total: hit.total };
}
function ktOpenNow(s, total) {
  const key = Q.sessionKey(s), c = classOf(s);
  if (!c || (ktOpen[key] && !total)) return;
  ktOpen[key] = 'opening';
  call('motkt', { cls: s.cls, book: s.book, lesson: s.lesson, total: total || 0 })
    .then(() => loadTracker(c, true)).then(() => { ktOpen[key] = 'done'; })
    .catch(e => { ktOpen[key] = 'failed'; say(T('Chưa mở được cột điểm kiểm tra: ', 'Could not open the test column: ') + e.message, 'bad'); })
    .finally(render);
}
// The count column is read once per class-sheet read; this device's unsent scores stay on top.
function ktLoadVals(ctx, col) {
  const t = ctx.tracker, c = classOf(ctx.session), k = c.key + '|' + t.at + '|' + col;
  if (ktVals[k]) return;
  ktVals[k] = 'loading';
  batchGet(c.tracker, [quote(t.tab) + '!' + Q.colName(col) + '1:' + Q.colName(col) + ROSTER_LAST]).then(([rows]) => {
    rows.forEach((r, i) => t.set(i + 1, col, Q.clean((r || [])[0])));
    outbox.filter(x => x.kind === 'cell' && x.classKey === c.key && x.col === col).forEach(x => t.set(x.row, x.col, x.value === '' ? '' : String(x.value)));
    ktVals[k] = 'ok';
  }).catch(() => { ktVals[k] = null; }).finally(render);
}
const ktScore = (ctx, k, p) => { const v = Q.clean(ctx.tracker.cell(p.row, k.col)).replace(',', '.'); return /^\d+(\.\d+)?$/.test(v) ? Number(v) : null; };
// Ranking: with no star column in a test lesson, the test score is what the class screen ranks by.
const starsOfBeforeKt = starsOf;
starsOf = function (ctx, p) {
  if (!(ctx.block && ctx.block.stars >= 0)) { const k = ktOf(ctx); if (k && k.col >= 0) return ktScore(ctx, k, p) || 0; }
  return starsOfBeforeKt(ctx, p);
};
// Owner 09/11: "nhập điểm phải ở màn hình sau màn hình lớp" — the teacher types scores on the roll-call screen (tick, A+/B/F);
// the class screen pupils look at only shows them and the ranking, nothing to change there.
const ktPctOf = (k, v) => v != null && k.total ? Math.round(v / k.total * 100) : null;
const ktPctTag = p => p != null ? '<b class="kt-pct kt-' + ktTone(p) + '">' + p + '%</b>' : '';
// Class screen: read-only score on each pupil row.
const gradeSegBeforeKt = gradeSeg;
gradeSeg = function (ctx, r, live) {
  const h = gradeSegBeforeKt(ctx, r, live), k = ktOf(ctx);
  if (!k || k.col < 0 || r.off) return h;
  const v = ktScore(ctx, k, r.p);
  return h + '<span class="kt-box kt-view"><span>' + T('KT', 'Test') + ' <i class="rv-en-i">Test</i></span><b>' + (v == null ? '…' : v) + '</b><span>/' + (k.total || '?') + '</span>' + ktPctTag(ktPctOf(k, v)) + '</span>';
};
// Owner 09/11 (chosen): "khung riêng mở từ màn hình lớp" — a "Nhập điểm KT" button on the class screen opens a box with the whole
// class; the teacher types each pupil's correct answers there (and the total once when no class has done the unit). Closing the
// box lets the class screen slide the pupils into their new order.
let ktSheet = false;
function ktLine(ctx, k) {
  const s = ctx.session, vals = ctx.tracker.pupils.map(p => ktScore(ctx, k, p)).filter(v => v != null), edit = canTeach(s) && llUnlocked(s);
  const avg = vals.length && k.total ? Math.round(vals.reduce((n, v) => n + v, 0) / vals.length / k.total * 100) : null;
  return '<div class="kt-line"><b>' + T('Kiểm tra ', 'Test ') + esc(Q.clean(s.book)) + ' · Unit ' + esc(k.unit) + '</b>' +
    '<span>' + (k.total ? T('tổng ', 'out of ') + k.total + T(' câu', '') : T('chưa có tổng số câu', 'total not set')) + '</span>' +
    (avg != null ? '<span class="chip kt-' + ktTone(avg) + '">' + T('TB ', 'Avg ') + avg + '% · ' + vals.length + T(' em', '') + '</span>' : '') +
    (canTeach(s) ? '<button class="primary kt-go" data-act="ktOpen"' + (edit ? '' : ' disabled title="' + T('Giữ "Giữ để sửa" để mở khoá trước', 'Unlock with "Hold to edit" first') + '"') + '>📝 ' + T('Nhập điểm KT', 'Enter test scores') + '</button>' : '') + '</div>';
}
// Owner 10/11: the name is the biggest thing in each box. A long Vietnamese name shows the given name (last word) big, with the
// rest small above it, so the teacher never has to guess from a cut-off name.
function ktNameHtml(p) {
  const full = Q.clean(p.eng || p.name), w = full.split(/\s+/);
  if (full.length <= 12 || w.length < 2) return '<b class="kt-name" title="' + esc(Q.clean(p.name)) + '">' + esc(full) + '</b>';
  return '<b class="kt-name" title="' + esc(Q.clean(p.name)) + '"><small>' + esc(w.slice(0, -1).join(' ')) + '</small>' + esc(w[w.length - 1]) + '</b>';
}
function ktSheetHtml(ctx, k) {
  const rows = ctx.tracker.pupils.map((p, i) => ({ p, i, m: ctx.marks.get(p.name) })).filter(r => !(r.m && (r.m.status === NGHI || Q.ABSENT.includes(r.m.status))));
  return '<div class="ll-veil" data-act="ktClose"></div><div class="ll-sheet kt-sheet" role="dialog" aria-label="' + T('Nhập điểm kiểm tra', 'Test scores') + '">' +
    '<div class="row-top"><b class="ll-sheet-name">📝 ' + T('Điểm kiểm tra · Unit ', 'Test scores · Unit ') + esc(k.unit) + '</b><span class="spacer"></span><button class="primary" data-act="ktClose">' + T('Xong', 'Done') + '</button></div>' +
    (k.total ? '<div class="small muted">' + T('Gõ số câu đúng trên tổng ', 'Correct answers out of ') + k.total + T(' câu. Bỏ trống nếu chưa chấm.', '. Leave empty if not marked.') + '</div>'
      : '<label class="kt-total">' + T('Tổng số câu của bài này: ', 'Total questions: ') + '<input type="number" inputmode="numeric" min="1" max="500" data-act="ktTotal" aria-label="' + T('Tổng số câu', 'Total questions') + '"></label>') +
    '<div class="kt-list">' + rows.map(r => { const v = ktScore(ctx, k, r.p); return '<label class="kt-row">' + ktNameHtml(r.p) + '<input type="number" inputmode="numeric" min="0"' + (k.total ? ' max="' + k.total + '"' : '') + ' data-act="ktScore" data-i="' + r.i + '" value="' + (v == null ? '' : v) + '" aria-label="' + T('Số câu đúng của ', 'Correct answers of ') + esc(r.p.eng || r.p.name) + '"><span>/' + (k.total || '?') + '</span>' + ktPctTag(ktPctOf(k, v)) + '</label>'; }).join('') + '</div></div>';
}
const viewLenLopBeforeKt = viewLenLop;
viewLenLop = function () {
  const out = viewLenLopBeforeKt();
  const ctx = current ? classContext(current) : null, k = ctx && ctx.tracker ? ktOf(ctx) : null;
  if (!k || k.col < 0 || !out.includes('<div class="rv-list"')) { ktSheet = false; return out; }
  const at = out.indexOf('<div class="rv-list"');
  return out.slice(0, at) + ktLine(ctx, k) + out.slice(at) + (ktSheet && canTeach(current) ? ktSheetHtml(ctx, k) : '');
};
document.addEventListener('click', e => {
  const b = e.target.closest && e.target.closest('[data-act="ktOpen"],[data-act="ktClose"]');
  if (!b || !current) return;
  if (b.dataset.act === 'ktOpen') {
    ktSheet = true;
    // Keep the order on screen while the box is open; it changes when the box closes.
    const key = Q.sessionKey(current);
    if (llOrder.key !== key) { const ctx = classContext(current); llOrder = { key, list: ctx.tracker.pupils.map((p, i) => i) }; }
    llFreezeUntil = Date.now() + 3600000; clearTimeout(llRankTimer);
    render();
  } else {
    if (document.activeElement && document.activeElement.blur) document.activeElement.blur();
    ktSheet = false; render();
    clearTimeout(llRankTimer); llRankTimer = setTimeout(rerankNow, 350);
  }
});
function ktSave(i, raw) {
  const ctx = current ? classContext(current) : null, k = ctx ? ktOf(ctx) : null, p = ctx && ctx.tracker.pupils[i];
  if (!k || k.col < 0 || !p || !canTeach(ctx.session)) return;
  const text = Q.clean(raw).replace(',', '.');
  if (text !== '' && !/^\d+(\.\d+)?$/.test(text)) return say(T('Điểm kiểm tra phải là số câu đúng.', 'Enter the number of correct answers.'), 'bad');
  const v = text === '' ? '' : Number(text);
  if (v !== '' && k.total && v > k.total) return say(T('Số câu đúng lớn hơn tổng ' + k.total + ' câu.', 'More than the total of ' + k.total + '.'), 'bad');
  const cls = classOf(ctx.session), t = ctx.tracker, before = t.cell(p.row, k.col);
  if (String(before) === String(v)) return;
  t.set(p.row, k.col, v === '' ? '' : String(v));
  queue({ kind: 'cell', file: cls.tracker, classKey: cls.key, range: quote(t.tab) + '!' + Q.colName(k.col) + p.row, row: p.row, col: k.col, expected: before, value: v, label: (p.eng || p.name) + ' · KT' });
  // In the box the order waits until it closes; a short delay lets a tap on Xong land before the box is redrawn.
  if (ktSheet) { setTimeout(render, 250); return; }
  llFreezeUntil = Date.now() + RANK_WAIT; clearTimeout(llRankTimer); llRankTimer = setTimeout(rerankNow, RANK_WAIT);
  render();
}
document.addEventListener('change', e => {
  const el = e.target;
  if (!el || !el.dataset) return;
  if (el.dataset.act === 'ktScore') ktSave(Number(el.dataset.i), el.value);
  if (el.dataset.act === 'ktTotal' && current && Number(el.value) > 0) ktOpenNow(current, Math.min(500, Number(el.value)));
});
document.addEventListener('keydown', e => { if (e.key === 'Enter' && e.target && e.target.dataset && /^kt(Score|Total)$/.test(e.target.dataset.act || '')) e.target.blur(); });
// The summary for parents: the test score next to attendance.
const summaryViewBeforeKt = summaryView;
summaryView = function (ctx) {
  const h = summaryViewBeforeKt(ctx), k = ktOf(ctx);
  if (!k || k.col < 0) return h;
  const rows = ctx.tracker.pupils;
  return h.replace('<th>Điểm danh</th>', '<th>Điểm danh</th><th>KT Unit ' + esc(k.unit) + (k.total ? ' · ' + k.total + ' câu' : '') + '</th>')
    .replace(/(<td class="sum-name"><b>([^<]*)<\/b><\/td><td>[\s\S]*?<\/td>)/g, (m0, all, name) => {
      const p = rows.find(q => esc(q.eng || q.name) === name), v = p ? ktScore(ctx, k, p) : null, pct = v != null && k.total ? Math.round(v / k.total * 100) : null;
      return all + '<td class="sum-kt">' + (v == null ? '<span class="sum-muted">—</span>' : '<b>' + v + (k.total ? '/' + k.total : '') + '</b>' + (pct != null ? ' <span class="chip kt-' + ktTone(pct) + '">' + pct + '%</span>' : '')) + '</td>';
    });
};

/* Owner 09/11: "buổi học nào kiểm tra thì thêm 1 cái là làm bài kiểm tra không nghiêm túc... practice test cũng có... chỉ là không có màn
 * nhập điểm". Every IELTS / FIGHTER lesson whose lesson text starts "kiểm tra" (unit tests, practice tests, IELTS speaking and
 * listening-reading-writing tests) gets one more reminder button; it counts towards the warning limit like the others. */
const KT_TICK = 'Làm bài KT không nghiêm túc';
Object.assign(BEHAVIOUR_EN, { [KT_TICK]: 'Not serious in the test' });
COMMENT_LINES[KT_TICK] = 'con làm bài kiểm tra chưa nghiêm túc, cần tập trung và tự giác hơn.';
// Owner 10/11: it showed a bare dot on the class screen's icon strip; every reminder has its own icon.
TICK_ICON[KT_TICK] = '📋';
if (!BEHAVIOURS.includes(KT_TICK)) BEHAVIOURS.push(KT_TICK);
const isTestLesson = s => { if (!s || !isSecondary(s)) return false; if (!ktG.any) { loadKtGuide(); return false; } return !!ktG.any[ktBookKey(s.book) + '|' + Q.clean(s.lesson)]; };
const tickSetOfBeforeKt = tickSetOf;
tickSetOf = function (s) { const list = tickSetOfBeforeKt(s); return isTestLesson(s) && !list.includes(KT_TICK) ? list.concat([KT_TICK]) : list; };

/* ---------- Sent home → message the parents (owner 09/11: "fighter vs ielts... nếu tôi ấn nút sent home là bị phạt về ý thì thông báo cho
 * nhân sự là nhắn tin cho bố mẹ là con bị phạt về") ----------
 * Every pupil marked "Cho về (thiếu bài)" becomes one "Nhắn PH" job on the penalty page, in the bell and in the to-do dialog, for the
 * same people who send the ladder messages (Fridays THUY TRANG, other days managers; managers, TA side and the homeroom see it).
 * A ready message (what is owed, read from the class sheet) can be copied for Zalo. The tick writes a LIEN_HE_PH row (level 0,
 * action SENT_ACT), so everyone sees who sent it. Undoing the mark removes the job. Counted from 09/11, at most the last 7 days. */
const SENT_ACT = 'Đã nhắn PH (cho về)', SENT_START = '2026-11-09';
const sentHome = { tried: 0 };
function sentClass(cls) { const k = Q.key(cls); return classList.find(c => c.key === k) || classList.find(c => c.key === Q.key(String(cls).replace(/\.\d+$/, ''))); }
function sentHomeList(week) {
  if (!logs.marks) { if (Date.now() - sentHome.tried > 60000) { sentHome.tried = Date.now(); setTimeout(() => loadMarks().then(render).catch(() => {}), 0); } return []; }
  const t = today(), back = Q.addDays(t, -7), from = back > SENT_START ? back : SENT_START, last = new Map();
  logs.marks.rows.forEach(m => { if (m.day >= from && m.day <= t) last.set(markKey(m), m); });
  const mine = cls => isManager() || isTaSide(week) || isMe(homeroom[Q.key(cls)] || '') || isMe(homeroom[Q.key(String(cls).replace(/\.\d+$/, ''))] || '');
  return [...last.values()].filter(m => m.status === SEND_HOME && mine(m.cls)).map(m => {
    const x = { m, cls: Q.clean(m.cls), name: Q.clean(m.name), eng: Q.clean(m.eng), day: m.day, since: viDate(m.day), level: 0 };
    x.done = (ladder.contacts || []).filter(c => sameName(c.cls, x.cls) && c.name === x.name && c.since === x.since && c.action === SENT_ACT).pop() || null;
    return x;
  }).sort((a, b) => (a.done ? 1 : 0) - (b.done ? 1 : 0) || b.day.localeCompare(a.day) || a.cls.localeCompare(b.cls, 'vi', { numeric: true }));
}
const canSentTick = () => isManager() || (isFriday(today()) && isMe('THUY TRANG'));
// What the pupil owed that day, from the server's copy of the class sheet (asked for once, kept 10 minutes like the class screen).
function sentOwed(x) {
  const c = sentClass(x.cls);
  if (!c || !c.tracker) return [];
  const key = c.tracker + '|' + x.day, hit = owedCache[key];
  if ((!hit || Date.now() - hit.at > 600000) && !secLoading.has(key)) {
    secLoading.add(key);
    call('baino', { file: c.tracker, day: x.day }).then(data => { owedCache[key] = { at: Date.now(), data }; }).catch(e => { owedCache[key] = { at: Date.now(), data: null, error: e.message }; }).finally(() => { secLoading.delete(key); render(); });
  }
  if (!hit) return null;
  if (!hit.data) return [];
  const p = hit.data.pupils.find(q => Q.key(q.name) === Q.key(x.name));
  return p ? p.owed.filter(o => o.due && o.due <= x.day) : [];
}
function sentMessage(x) {
  const owed = sentOwed(x), who = x.eng ? x.eng + ' (' + x.name + ')' : x.name;
  const what = owed && owed.length ? ' chưa hoàn thành ' + owed.length + ' bài tập về nhà (' + skillSummary(owed) + ')' : ' chưa hoàn thành bài tập về nhà';
  return 'Phúc Hưng Edu xin thông báo: buổi học ngày ' + x.since + ' của lớp ' + x.cls + ', con ' + who + what +
    (x.m.status === OUT_MAKEUP ? ' nên con phải ra ngoài làm bù bài và không được vào học buổi này, theo nội quy về ý thức học tập của lớp.' : ' nên con đã bị cho về để hoàn thành bài, theo nội quy về ý thức học tập của lớp.') + ' Kính mong phụ huynh nhắc con làm đủ bài và nộp trước buổi học sau ạ. Trân trọng cảm ơn!';
}
function sentHomeBlock(week) {
  const list = sentHomeList(week);
  if (!list.length) return '';
  const todo = list.filter(x => !x.done).length;
  let h = '<div class="part p-alert"><h2>' + T('Cho về · cần nhắn phụ huynh', 'Sent home · message the parents') + '</h2><span>' + (todo ? todo + T(' chưa nhắn', ' to message') : T('Đã nhắn đủ', 'All messaged')) + '</span></div>';
  h += '<div class="small muted sent-who">' + T('Người nhắn hôm nay: ', 'Messages today: ') + '<b>' + (isFriday(today()) ? 'THUY TRANG' : T('quản lí', 'managers')) + '</b></div>';
  h += '<div class="grid">' + list.map((x, i) => {
    const owed = sentOwed(x), late = !x.done && today() > x.day;
    return '<div class="card row lad sent-job' + (x.done ? ' done' : '') + (late ? ' late' : '') + '"><div class="lad-line"><span class="lvl l2">🚪</span><b>' + esc(x.eng || x.name) + '</b><span class="tag">' + esc(x.cls) + ' · ' + esc(x.since.slice(0, 5)) + '</span>' +
      (x.done ? '<span class="tag ok">✓ ' + esc(SENT_ACT) + ' · ' + esc(x.done.by || '?') + (x.done.at ? ' · ' + esc(String(x.done.at).slice(11, 16) + ' ' + String(x.done.at).slice(0, 5)) : '') + '</span>' : '<span class="tag ' + (late ? 'bad' : 'warn') + '">' + T('Nhắn PH', 'Message') + '</span>') +
      '<span class="spacer"></span><button class="quiet" data-act="sentCopy" data-i="' + i + '">' + T('Chép tin nhắn', 'Copy message') + '</button>' +
      (!x.done && canSentTick() ? '<button class="good" data-act="sentTick" data-i="' + i + '">' + T('Đã nhắn PH', 'Messaged') + '</button>' : '') + '</div>' +
      '<details class="lad-more"><summary>' + (owed == null ? T('Đang đọc bài thiếu…', 'Reading owed work…') : owed.length ? T('Thiếu ', 'Owes ') + owed.length + T(' bài: ', ': ') + esc(skillSummary(owed)) : T('Lí do: thiếu bài', 'Reason: homework')) + '</summary><div class="small sent-msg">' + esc(sentMessage(x)) + '</div>' +
      '<div class="small muted">' + esc(x.name) + T(' · cho về bởi ', ' · sent home by ') + esc(x.m.by || '?') + '</div></details></div>';
  }).join('') + '</div>';
  return h;
}
const ladderBlockBeforeSent = ladderBlock;
ladderBlock = function (week) {
  // Owner 09/11: "mức nào theo schedule chứ... đúng giờ": levels are re-read from the Schedule at most 2 minutes old while this list shows.
  if (ladder.rows && Date.now() - ladder.at > 120000 && !ladder.fresh) { ladder.fresh = true; setTimeout(() => loadLadder(true).then(render).catch(() => {}).finally(() => { ladder.fresh = false; }), 0); }
  const a = sentHomeBlock(week);
  let b = ladderBlockBeforeSent(week) || '';
  const m = String(ladder.stamp || '').match(/(\d{1,2}\/\d{1,2})\s+(\d{1,2}:\d{2})/);
  const src = '<div class="small muted lad-src">' + T('Mức lấy nguyên từ Schedule (AUTO_KIDS_MUC_PHAT)', 'Levels straight from the Schedule') + (m ? T(' · Schedule cập nhật ', ' · Schedule updated ') + m[2] + ' ' + m[1] : '') + T(' · app đọc lúc ', ' · read at ') + new Date(ladder.at || Date.now()).toTimeString().slice(0, 5) + '</div>';
  if (b) b = b.replace(/(<\/h2>[\s\S]*?<\/div>)/, '$1' + src);
  return a + b;
};
const ladderTodoBeforeSent = ladderTodo;
ladderTodo = function (week) { return ladderTodoBeforeSent(week) + sentHomeList(week).filter(x => !x.done).length; };
// Bell: one line for the parents of pupils sent home.
const bellItemsBeforeSent = bellItems;
bellItems = function () {
  const out = bellItemsBeforeSent();
  try {
    if (me) {
      const week = weeks[Q.weekTab(tabs, today())] || null, todo = sentHomeList(week).filter(x => !x.done);
      if (todo.length) out.push({ k: 'lad', icon: '🚪', text: todo.length + T(' HS bị cho về · cần nhắn phụ huynh', ' pupils sent home · message parents'), n: todo.length, hot: todo.some(x => today() > x.day), go: { view: 'lich', sec: 'phat' } });
    }
  } catch (e) { /* the bell never breaks the page */ }
  return out;
};
// The to-do dialog ("Phạt & phụ huynh" list) gets the same jobs.
const qaRowsBeforeSent = qaRows;
qaRows = function (kind) {
  const out = qaRowsBeforeSent(kind);
  if (kind !== 'lad') return out;
  try {
    const week = weeks[Q.weekTab(tabs, today())] || null;
    sentHomeList(week).forEach((x, i) => { if (!x.done) out.unshift({ key: 'lad|sent|' + x.cls + x.name + x.day, cls: x.cls, who: x.eng || x.name, reason: T('Cho về · nhắn PH', 'Sent home · message'), btn: canSentTick() ? '<button class="good" data-act="sentTick" data-i="' + i + '">' + ico('check') + '</button>' : '', hot: today() > x.day }); });
  } catch (e) {}
  return out;
};
document.addEventListener('click', e => {
  const b = e.target.closest('[data-act="sentTick"],[data-act="sentCopy"]');
  if (!b) return;
  const week = weeks[Q.weekTab(tabs, today())] || null, x = sentHomeList(week)[Number(b.dataset.i)];
  if (!x) return;
  if (b.dataset.act === 'sentCopy') {
    navigator.clipboard.writeText(sentMessage(x)).then(() => say(T('Đã copy tin nhắn, dán vào Zalo phụ huynh.', 'Copied.')), () => say(T('Không copy được, mở "Thiếu bài" để bôi đen.', 'Could not copy.'), 'bad'));
    return;
  }
  if (x.done || !canSentTick()) return;
  const row = [stamp(), x.cls, x.name, '0', x.since, SENT_ACT, 'Cho về ' + x.since, me.name];
  if (!ladder.contacts) ladder.contacts = [];
  ladder.contacts.push(contactOf(row));
  queue({ kind: 'append', file: CONFIG.diemDanhId, tab: 'LIEN_HE_PH', row });
  render();
});

/* ---------- Roll call fits the screen (owner 09/11: "màn hình điểm danh cần vừa khung hình k phải kéo... kéo lên kéo xuống bất tiện") ----------
 * The pupil list takes as many columns as needed for all pupils to fit under the header without scrolling (up to what the width
 * allows: columns of at least 250px, or 165px on a phone, where the grade buttons move under the name). If even the most columns
 * cannot fit (a very small phone with a big class), the page scrolls as before. */
const viewClassBeforeFit = viewClass;
viewClass = function () {
  let h = viewClassBeforeFit().replace('<div class="card class-head">', '<div class="card class-head fit-head">');
  if (!/<div class="card">(<div class="pupil)/.test(h)) return h;
  // The back button joins the bar under the header instead of taking its own line.
  const back = (h.match(/^<div>(<button class="quiet" data-act="back">[\s\S]*?<\/button>)<\/div>/) || [])[1] || '';
  if (back && /<button class="primary ll-open"/.test(h)) h = h.slice(back.length + 11);
  const legend = current && isSecondary(current) ? '<div class="roll-legend">' + [['✉️', T('Nghỉ · đã báo', 'Absent, notified')], ['🚪', T('Cho về · thiếu bài', 'Sent home')], ['🏠', T('Ở nhà · chưa làm bài', 'Stayed home')], ['📝', T('Ra ngoài bù bài · không vào học', 'Making up work outside')]].map(([i, t]) => '<span><b>' + i + '</b> ' + t + '</span>').join('') + '</div>' : '';
  return h.replace(/<div class="card">(<div class="pupil)/, () => legend + '<div class="card roll-fit"><div class="pupil')
    .replace(/(<button class="primary ll-open"[^>]*>[\s\S]*?<\/button>)(<div class="count">[\s\S]*?<\/div>)/, (m0, a, b) => '<div class="roll-bar">' + back + a + b + '</div>');
};
function fitRoll() {
  const list = document.querySelector('.roll-fit');
  if (!list) return;
  // A pupil with no English name (IELTS / FIGHTER sheets) shows the last two words big; the full name stays on the small line.
  list.querySelectorAll('.pupil .who b').forEach(n => { if (n.dataset.short) return; const full = n.textContent.trim(), w = full.split(/\s+/), small = n.parentElement.querySelector('.small'); if (w.length > 2 && small && small.textContent.trim().startsWith(full)) { n.dataset.short = '1'; n.title = full; n.textContent = w.slice(-2).join(' '); } });
  // Owner 09/11: also when the laptop window is split in half or a third. Only a real phone (touch, small screen) is treated as a
  // phone; a narrow window on a computer gets more, smaller tiles and, if that is still too tall, the whole list is scaled down.
  const phone = matchMedia('(pointer: coarse)').matches && Math.min(screen.width, screen.height) < 600;
  list.style.zoom = '';
  const width = list.clientWidth, n = list.querySelectorAll(':scope > .pupil').length;
  const set = (c, narrow) => { list.style.setProperty('--roll-cols', c); list.classList.toggle('multi', c > 1); list.classList.toggle('narrow', !!narrow && c > 1); };
  // Every layout is tried (tiles with the grade buttons beside the name, then smaller tiles with them underneath). The first one that
  // fits at full size wins; otherwise the few layouts that need the least shrinking are scaled to the largest size that still fits
  // and the biggest wins (owner 09/11, board photo: names must be readable, so the list fills the window). Measured once per window
  // size and class; a tap only re-checks that the kept answer still fits.
  // A layout also has to keep every button of a tile inside it (no icon cut off at the tile edge).
  const wide = () => [...list.querySelectorAll(':scope > .pupil')].slice(0, 4).every(p => p.scrollWidth <= p.clientWidth + 1);
  // Owner 13/11 (video, iPhone: one column turned into two or three after a tick made while scrolled down): the room was
  // measured from the list's place on screen, so scrolling down made any layout look as if it fitted. Everything is now measured
  // on the page itself (as if scrolled to the top), and a layout that has to scroll is kept as it is until the window or the class changes.
  const fits = () => list.getBoundingClientRect().bottom + scrollY <= innerHeight - 8 && wide();
  const key = innerWidth + 'x' + innerHeight + '|' + n + '|' + Math.round(list.getBoundingClientRect().top + scrollY);
  const apply = b => { set(b.c, b.narrow); list.style.zoom = b.z < 0.999 ? b.z : ''; };
  if (fitRollLast.key === key && fitRollLast.best) { apply(fitRollLast.best); if (fitRollLast.scrolls || fits()) return; }
  const top = list.getBoundingClientRect().top + scrollY, room = innerHeight - 8 - top, tries = [];
  let best = null;
  search: for (const [minCol, narrow] of [[400, false], [290, false], [230, false], [150, true], [118, true]]) {
    const most = Math.max(1, Math.min(6, Math.floor(width / minCol)));
    for (let c = 1; c <= most; c++) {
      set(c, narrow); list.style.zoom = '';
      const h = list.getBoundingClientRect().height;
      if ((h <= room || c >= n) && wide()) { best = { c, narrow, z: 1 }; break search; }
      if (!wide()) { tries.push({ c, narrow, guess: Math.min(1, room / h) * 0.6 }); continue; }
      tries.push({ c, narrow, guess: room / h });
    }
  }
  if (!best && tries.length) {
    tries.sort((a, b) => b.guess - a.guess);
    for (const t of tries.slice(0, 3)) {
      set(t.c, t.narrow);
      let lo = 0.5, hi = 1;
      list.style.zoom = lo;
      if (!fits()) { if (!best) best = { c: t.c, narrow: t.narrow, z: 0.5 }; continue; }
      for (let k = 0; k < 5; k++) { const mid = (lo + hi) / 2; list.style.zoom = mid; if (fits()) lo = mid; else hi = mid; }
      if (!best || lo > best.z) best = { c: t.c, narrow: t.narrow, z: lo };
    }
  }
  // A phone that cannot show everything at full size goes back to one tidy column (easier to scroll than tiny tiles).
  if (phone && best && best.z < 1) best = { c: 1, narrow: false, z: 1 };
  fitRollLast = { key, best: best || { c: 1, narrow: false, z: 1 } };
  apply(fitRollLast.best);
  fitRollLast.scrolls = !fits();
}
let fitRollLast = { key: '', best: null };
const renderBeforeRollFit = render;
render = function () { renderBeforeRollFit(); try { fitRoll(); } catch (e) {} };
let fitRollTimer = 0;
addEventListener('resize', () => { clearTimeout(fitRollTimer); fitRollTimer = setTimeout(() => { try { fitRoll(); } catch (e) {} }, 120); });

/* ---------- Search (staff via owner 09/11: "cái thanh tìm kiếm... để em tìm các thứ ở trong đó mà không cần tìm. Ví dụ em tìm Arthur thì
 * nó sẽ ra Arthur trong danh mục phạt") ----------
 * A magnifier in the top bar (or Ctrl+K, or "/") opens one box. Typing a pupil, class or staff name lists every place the app already
 * knows it from: penalty ladder, sent home, KIDS homework owed, pupils of class sheets already read, classes, staff. Each person only
 * finds what their own pages show them. A tap goes to that place and the line flashes there. Accents and case do not matter. */
const finder = { open: false, q: '', focus: '' };
const fold = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[đĐ]/g, 'd').toLowerCase().replace(/\s+/g, ' ').trim();
const FIND_GROUPS = [['phat', '⚠️', 'Danh sách phạt', 'Penalty ladder'], ['sent', '🚪', 'Cho về · nhắn phụ huynh', 'Sent home'], ['no', '📚', 'Nợ bài (KIDS)', 'Homework owed'],
  ['hs', '🧒', 'Học sinh', 'Pupils'], ['lop', '🏫', 'Lớp', 'Classes'], ['nguoi', '👤', 'Nhân sự', 'Staff']];
// The class's session to open: today's first, else the next one, else the latest, in the weeks already read.
function finderSession(key) {
  const all = Object.values(weeks).flatMap(w => (w && w.data ? w.data.sessions : [])).filter(s => !s.off && (s.classKey === key || Q.key(String(s.cls).replace(/\.\d+$/, '')) === key));
  const t = today();
  return all.filter(s => s.day >= t).sort((a, b) => a.day.localeCompare(b.day) || a.start - b.start)[0] || all.sort((a, b) => b.day.localeCompare(a.day))[0] || null;
}
function finderResults(q) {
  const k = fold(q);
  if (k.length < 2) return [];
  const hit = (...xs) => xs.some(x => fold(x).includes(k)), t = today(), week = weeks[Q.weekTab(tabs, t)] || null, out = [];
  const add = (group, title, sub, go) => out.push({ group, title, sub, go });
  const seeLadder = x => isManager() || isTaSide(week) || isMe(homeroom[Q.key(x.cls)] || '');
  (ladder.rows || []).filter(seeLadder).forEach(x => {
    if (!hit(x.name, x.cls)) return;
    const m = x.name.match(/^(.*?)\s*\(([^)]+)\)\s*$/), eng = m ? m[2] : '', full = m ? m[1] : x.name;
    add('phat', (eng ? eng + ' · ' : '') + full, 'M' + x.level + ' · ' + x.cls + (x.since ? T(' · từ ', ' · since ') + String(x.since).slice(0, 5) : '') + (x.reason ? ' · ' + x.reason : ''), { view: 'lich', sec: 'phat', lad: 'tat', focus: eng || full });
  });
  try { sentHomeList(week).forEach(x => { if (hit(x.name, x.eng, x.cls)) add('sent', (x.eng ? x.eng + ' · ' : '') + x.name, x.cls + ' · ' + x.since.slice(0, 5) + (x.done ? T(' · đã nhắn PH', ' · parents told') : T(' · chưa nhắn PH', ' · not told yet')), { view: 'lich', sec: 'phat', focus: x.eng || x.name }); }); } catch (e) {}
  (buBai.rows || []).forEach(x => { if (hit(x.name, x.cls)) add('no', x.name, x.cls + (x.reason ? ' · ' + x.reason : '') + (x.items ? ' · ' + x.items.split('\n')[0].slice(0, 80) : ''), { view: 'lopcn', focus: x.name }); });
  Object.entries(trackers).forEach(([key, tr]) => {
    const c = classList.find(z => z.key === key);
    (tr && tr.pupils || []).forEach(p => { if (hit(p.name, p.eng)) add('hs', (p.eng ? p.eng + ' · ' : '') + p.name, c ? c.name : key, { cls: key }); });
  });
  classList.forEach(c => { if (!hit(c.name)) return; const s = finderSession(c.key); add('lop', c.name, s ? (s.day === t ? T('Hôm nay ', 'Today ') : dayLabel(s.day) + ' ') + Q.clock(s.start) + (s.lesson ? T(' · tiết ', ' · lesson ') + s.lesson : '') : T('Chưa có buổi trong các tuần đã mở', 'No session in the weeks read'), { cls: c.key }); });
  (people || []).forEach(p => { if (hit(p.name)) add('nguoi', p.name, p.role || '', null); });
  return out;
}
function finderHtml() {
  if (!finder.open) return '';
  const res = finderResults(finder.q), k = fold(finder.q);
  const mark = s => { const f = fold(s), i = k ? f.indexOf(k) : -1; return i < 0 || f.length !== String(s).length ? esc(s) : esc(String(s).slice(0, i)) + '<mark>' + esc(String(s).slice(i, i + k.length)) + '</mark>' + esc(String(s).slice(i + k.length)); };
  let body;
  if (k.length < 2) body = '<div class="fd-hint">' + T('Gõ tên học sinh (tiếng Anh hoặc tiếng Việt, không cần dấu), tên lớp hoặc tên nhân sự.', 'Type a pupil, class or staff name.') + '</div>';
  else if (!res.length) body = '<div class="fd-hint">' + T('Không thấy "', 'Nothing for "') + esc(finder.q) + T('" trong những gì app đang có.', '".') + '</div>';
  else body = FIND_GROUPS.map(([g, icon, vi, en]) => {
    const list = res.map((r, i) => Object.assign({ i }, r)).filter(r => r.group === g);
    if (!list.length) return '';
    return '<div class="fd-group"><div class="fd-head">' + icon + ' ' + T(vi, en) + ' <span>' + list.length + '</span></div>' + list.slice(0, 30).map(r =>
      '<button class="fd-row' + (r.go ? '' : ' fd-static') + '" data-act="finderGo" data-i="' + r.i + '"><b>' + mark(r.title) + '</b><small>' + mark(r.sub) + '</small></button>').join('') + (list.length > 30 ? '<div class="fd-hint">+' + (list.length - 30) + '</div>' : '') + '</div>';
  }).join('');
  return '<div class="dash-veil" data-act="finderClose"></div><div class="dash-modal fd-modal" role="dialog" aria-label="' + T('Tìm kiếm', 'Search') + '"><div class="fd-bar">' + svgI(ICO_FIND) +
    '<input id="finderInput" type="search" autocomplete="off" spellcheck="false" placeholder="' + T('Tìm học sinh, lớp, nhân sự…', 'Find a pupil, class, staff…') + '" value="' + esc(finder.q) + '">' +
    '<button class="quiet" data-act="finderClose" aria-label="' + T('Đóng', 'Close') + '">✕</button></div><div class="dash-body fd-body">' + body + '</div></div>';
}
const ICO_FIND = '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>';
function paintFinder() {
  let host = document.getElementById('finderHost');
  if (!host) { host = document.createElement('div'); host.id = 'finderHost'; document.body.appendChild(host); }
  if (!finder.open) { host.innerHTML = ''; return; }
  const input = document.getElementById('finderInput');
  if (input) { const body = host.querySelector('.fd-body'), fresh = document.createElement('div'); fresh.innerHTML = finderHtml(); const nb = fresh.querySelector('.fd-body'); if (body && nb) body.innerHTML = nb.innerHTML; return; }
  host.innerHTML = finderHtml();
  const el = document.getElementById('finderInput');
  if (el) { el.focus(); el.setSelectionRange(el.value.length, el.value.length); }
}
function openFinder() {
  finder.open = true; paintFinder();
  // What the search reads: the ladder, the KIDS owed list and the marks (each is kept a few minutes, so this is usually instant).
  Promise.all([loadLadder(), loadBuBai(), loadMarks(), loadHomeroom()].map(p => Promise.resolve(p).catch(() => null))).then(() => { if (finder.open) paintFinder(); });
}
function closeFinder() { finder.open = false; paintFinder(); }
function finderButton() {
  const bar = document.querySelector('header .bar'), bellBtn = document.getElementById('btnBell');
  if (!bar || !bellBtn || document.getElementById('btnFind') || !me) return;
  const b = document.createElement('button');
  b.id = 'btnFind'; b.className = 'quiet bell'; b.dataset.act = 'finder'; b.title = T('Tìm kiếm (Ctrl+K)', 'Search (Ctrl+K)'); b.setAttribute('aria-label', T('Tìm kiếm', 'Search'));
  b.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + ICO_FIND + '</svg>';
  bar.insertBefore(b, bellBtn);
}
// After a jump, the matching line is scrolled to and flashes (tried a few times while the page fills in).
function finderFlash() {
  const want = fold(finder.focus);
  if (!want) return;
  const tryOnce = () => {
    const el = [...document.querySelectorAll('.lad b, .sent-job b, .dw-row b, .cn-card b, .pupil .who b, .rv-name, b')].find(x => fold(x.textContent) === want || fold(x.textContent).includes(want));
    if (!el) return false;
    const box = el.closest('.lad, .sent-job, .dw-row, .card, .pupil') || el;
    box.scrollIntoView({ block: 'center', behavior: 'smooth' });
    box.classList.remove('fd-flash'); void box.offsetWidth; box.classList.add('fd-flash');
    return true;
  };
  [250, 900, 2200].forEach(ms => setTimeout(() => { if (finder.focus && tryOnce()) finder.focus = ''; }, ms));
}
function finderGo(r) {
  if (!r || !r.go) return;
  closeFinder();
  const g = r.go;
  if (g.cls) {
    const s = finderSession(g.cls);
    if (s && classOf(s)) { openClass(s); return; }
    view = 'lopcn'; render(); return;
  }
  day = today(); view = g.view;
  if (g.sec) filters.sec = g.sec;
  if (g.lad) filters.lad = g.lad;
  if (view === 'lich' && isManager()) filters.showAll = false;
  finder.focus = g.focus || '';
  render(); window.scrollTo(0, 0);
  if (view === 'lich') guarded(() => weekOf(day)); else if (view === 'lopcn' && typeof loadHomerooms === 'function') loadHomerooms();
  finderFlash();
}
document.addEventListener('click', e => {
  const b = e.target.closest('[data-act]');
  if (!b) return;
  if (b.dataset.act === 'finder') openFinder();
  if (b.dataset.act === 'finderClose') closeFinder();
  if (b.dataset.act === 'finderGo') finderGo(finderResults(finder.q)[Number(b.dataset.i)]);
});
document.addEventListener('input', e => { if (e.target && e.target.id === 'finderInput') { finder.q = e.target.value; paintFinder(); } });
document.addEventListener('keydown', e => {
  if (!me) return;
  const typing = /INPUT|TEXTAREA|SELECT/.test((e.target && e.target.tagName) || '') || (e.target && e.target.isContentEditable);
  if ((e.key === 'k' || e.key === 'K') && (e.ctrlKey || e.metaKey)) { e.preventDefault(); finder.open ? closeFinder() : openFinder(); return; }
  if (e.key === '/' && !typing && !finder.open) { e.preventDefault(); openFinder(); return; }
  if (e.key === 'Escape' && finder.open) { closeFinder(); return; }
  if (e.key === 'Enter' && finder.open && e.target && e.target.id === 'finderInput') { const r = finderResults(finder.q).find(x => x.go); if (r) finderGo(r); }
});
const renderBeforeFinder = render;
render = function () { renderBeforeFinder(); try { finderButton(); } catch (e) {} };

// "🙋 Có mặt / Đến muộn" on the class screen (owner 09/11): same mark as a tick on the roll call, without leaving the class screen.
const llActionBeforeArrive = llAction;
llAction = function (act, i, v) {
  if (act !== 'llArrive') return llActionBeforeArrive(act, i, v);
  const ctx = classContext(current), s = ctx.session, pupil = ctx.tracker && ctx.tracker.pupils[Number(i)];
  // Owner 09/11: "xong vẫn có các nút tắt ấy": works even after "Xong, khoá lại" (no need to unlock for a late arrival).
  if (!pupil || !canTeach(s)) return;
  const m = ctx.marks.get(pupil.name);
  appendMark(s, pupil, Q.tickStatus(s, today(), minutesNow()), m && m.contact, m && m.note);
  render();
};

/* Owner 09/11: "ielts fighter thêm cho tôi lỗi là lười suy nghĩ": one more reminder button for every IELTS and FIGHTER lesson. */
const LAZY_TICK = 'Lười suy nghĩ';
Object.assign(BEHAVIOUR_EN, { [LAZY_TICK]: 'Not thinking' });
COMMENT_LINES[LAZY_TICK] = 'con còn lười suy nghĩ.';
TICK_ICON[LAZY_TICK] = '🧠';
[FIGHTER_TICKS, IELTS_WRITING_TICKS, IELTS_SPEAKING_TICKS, TEEN_TICKS].forEach(list => { if (list.includes(LAZY_TICK)) return; const p = list.indexOf(PRAISE); if (p >= 0) list.splice(p, 0, LAZY_TICK); else list.push(LAZY_TICK); });
if (!BEHAVIOURS.includes(LAZY_TICK)) BEHAVIOURS.push(LAZY_TICK);

// The icon layout also gets 🙋 for a pupil not yet ticked or marked absent (owner 09/11: "xong vẫn có các nút tắt ấy"), and the legend says so.
const paintStripBeforeArrive = paintStrip;
paintStrip = function () {
  paintStripBeforeArrive();
  // Owner 09/11 (photo, rows on top of each other): back from the narrow icon layout to a wide window, the page kept the narrow
  // layout's fixed row height, icons and legend (the screen is only redrawn when something changes). Clear them, then fit again.
  if (!stripOn()) {
    let had = false;
    document.querySelectorAll('.rv-quick, .rv-legend, .rv-mini, .rv-q-arrive').forEach(x => { x.remove(); had = true; });
    document.querySelectorAll('.rv-row.open').forEach(r => r.classList.remove('open'));
    document.querySelectorAll('.rv-row .ll-name[data-full]').forEach(n => { n.textContent = n.dataset.full; });
    const list = document.querySelector('.rv-list');
    if (list && list.style.gridAutoRows) { list.style.gridAutoRows = ''; had = true; }
    if (had && view === 'lenlop') { fitLast.key = ''; fitClassScreen(); }
    return;
  }
  let added = false;
  document.querySelectorAll('.rv-row').forEach(r => {
    const old = r.querySelector('.rv-q-arrive');
    if (old) old.remove();
    const a = r.querySelector('.rv-arrive');
    if (!a || r.classList.contains('open')) return;
    const html = '<button class="rv-q rv-q-arrive" data-act="llArrive" data-i="' + r.dataset.i + '"' + (a.disabled ? ' disabled' : '') + ' title="' + esc(a.textContent) + '">🙋</button>';
    const q = r.querySelector('.rv-quick'), n = r.querySelector('.rv-name');
    if (q) q.insertAdjacentHTML('afterbegin', html); else if (n) n.insertAdjacentHTML('afterend', '<span class="rv-quick">' + html + '</span>');
    added = true;
  });
  const legend = document.querySelector('.rv-legend');
  if (legend && !legend.querySelector('.lg-arrive')) legend.insertAdjacentHTML('afterbegin', '<span class="lg-arrive">🙋 ' + T('Có mặt / đến muộn', 'Arrived') + '<small class="rv-en">Arrived</small></span>');
  if (added) fitClassScreen();
};

/* IELTS / FIGHTER "Ra ngoài bù bài · không vào học" (owner 09/11): at the centre (counts as present, like KIDS level 3) but not in the
 * lesson; the class screen and the close sheet say so, and the parents get the same message job as "Cho về". */
const OUT_MAKEUP = 'Bù bài ngoài lớp';
if (!Q.PRESENT.includes(OUT_MAKEUP)) Q.PRESENT.push(OUT_MAKEUP);
const pupilFlagsBeforeOut = pupilFlags;
pupilFlags = function (ctx, r) {
  const st = (ctx.marks.get(r.p.name) || {}).status || '', h = pupilFlagsBeforeOut(ctx, r);
  if (st !== OUT_MAKEUP) return h;
  const flag = '<span class="rv-flag mk">📝 Ra ngoài bù bài · không vào học <i class="rv-en-i">Making up work outside</i></span>';
  return h ? h.replace('<span class="rv-flags">', '<span class="rv-flags">' + flag) : '<span class="rv-flags">' + flag + '</span>';
};
const attendTextBeforeOut = attendText;
attendText = function (m) { return m && m.status === OUT_MAKEUP ? '<span class="sum-sent">Ra ngoài bù bài · không vào học</span>' : attendTextBeforeOut(m); };

/* Owner 13/11: KIDS 19 Lucy was set "Bù bài (mức 3)" at 18:32; at 18:37 a tap on her roll-call name wrote "Bỏ tick" (bù bài counts as
 * present, so a tap meant "untick"), she became "no news", and the absence panel then got "Có phép" → the close sheet said excused.
 * A ✓ tap no longer clears those states: KIDS "Bù bài (mức 3)" → "Có mặt" (= the 📝 "bù xong, vào lớp" button, which the class screen
 * lacks); IELTS/FIGHTER "Bù bài ngoài lớp" and "Cho về" stay and the teacher is told to use the buttons under the name on the class page. */
const KEEP_ON_TAP = [MAKEUP, OUT_MAKEUP, SEND_HOME];
const tickPupilBeforeKeep = tickPupil;
tickPupil = function (ctx, pupil) {
  const m = ctx && ctx.marks && ctx.marks.get(pupil.name), st = m && m.status, who = pupil.eng || pupil.name;
  if (st === MAKEUP) {
    appendMark(ctx.session, pupil, 'Có mặt', m.contact, m.note);
    say(T(who + ': bù bài xong, vào lớp (Có mặt).', who + ': done making up work, back in class.'));
    render();
    return;
  }
  if (KEEP_ON_TAP.includes(st)) {
    say(T(who + (st === SEND_HOME ? ' đang ghi "Cho về".' : ' đang ra ngoài bù bài.') + ' Muốn đổi thì mở trang lớp, dùng các nút dưới tên con.',
      who + (st === SEND_HOME ? ' is marked sent home.' : ' is making up work outside.') + ' To change it, use the buttons under the name on the class page.'), 'bad');
    return;
  }
  return tickPupilBeforeKeep(ctx, pupil);
};

/* ---------- Print documents from CLASS RESOURCES (owner 09/11: "tài liệu gì in sẽ là link drive... thêm ở class resources... từ sheet
 * nối nút vào web") ----------
 * Sheet "TÀI LIỆU IN · nối vào app Quản lí lớp" (tab TAI_LIEU_IN) in the CLASS RESOURCES folder: SÁCH (as in the Schedule's BOOK),
 * TIẾT (one number, a list "12, 13" or a range "12-14"), TÊN TÀI LIỆU, LINK DRIVE. A lesson with a matching row gets 🖨 buttons on
 * its class page, and the printing card lists the documents for today and the next two days, so the person printing opens them
 * straight from the app. Read again every 10 minutes. */
const printDocs = { list: null, at: 0, loading: false, tried: 0, stamp: '' };
// Owner 09/11: "đừng dùng file riêng... mò vào các sách xong tìm file in... lấy link đó trực tiếp ra". The Schedule scans CLASS RESOURCES
// once a day into AUTO_TAI_LIEU_IN (folder path, name, kind, id, link); the lesson's print file is looked up there.
const docPlain = s => Q.key(s).replace(/[_\-–:,.()+]/g, ' ').replace(/\s+/g, ' ').trim();
async function loadPrintDocs(force) {
  if (printDocs.loading || (!force && printDocs.list && Date.now() - printDocs.at < 1800000)) return;
  printDocs.loading = true;
  try {
    const [rows, head = []] = await batchGet(CONFIG.scheduleId, ["'AUTO_TAI_LIEU_IN'!A2:F9000", "'AUTO_TAI_LIEU_IN'!G1"]);
    printDocs.stamp = Q.clean(((head || [])[0] || [])[0] || '');
    printDocs.list = rows.filter(r => r[1] && /^https:\/\//.test(String(r[4] || ''))).map(r => {
      const path = Q.clean(r[0]), name = Q.clean(r[1]), full = path ? path + ' / ' + name : name;
      return { path, name, full, kind: Q.clean(r[2]), link: Q.clean(r[4]), keyFull: ' ' + docPlain(full) + ' ', keyName: ' ' + docPlain(name) + ' ', keyPath: ' ' + docPlain(path) + ' ' };
    });
    printDocs.at = Date.now();
  } finally { printDocs.loading = false; }
}
// The book as it is named in the folders: "DISCOVER 3", "FAMILY AND FRIENDS 1" (FF1), "PHONICS 3", "IELTS SPEAKING"…
function docBookKeys(book) {
  const b = docPlain(book).replace(/^SACH /, '').replace(/^OXFORD /, '');
  const out = [b];
  let m;
  if ((m = b.match(/^FF ?(\d)$/))) out.push('FAMILY AND FRIENDS ' + m[1]);
  if ((m = b.match(/^FAMILY AND FRIENDS (\d)$/))) out.push('FF' + m[1], 'FF ' + m[1]);
  if (/^DISCOVER FUTURES?$/.test(b)) out.push('FUTURE');
  if ((m = b.match(/^CRITICAL THINKING (?:& )?SCIENCE (\d)$/))) out.push('CRITICAL THINKING ' + m[1], 'SCIENCE ' + m[1]);
  return out;
}
// What is printed in this lesson, from the Schedule's lesson text: written tests, Phonics tests, interviews, reviews, projects.
function docItems(s) {
  const d = docPlain(s.detail || ''), out = [];
  let m;
  if ((m = d.match(/WRITTEN TEST (\d+)/))) out.push('WRITTEN TEST ' + m[1]);
  // Family and Friends tests are named by their units ("Test - Unit 4,5,6"); the Schedule writes "U4,5,6" or "UNIT 4+5+6".
  if (/WRITTEN TEST|\bTEST\b/.test(d) && (m = Q.key(s.detail || '').match(/\bU(?:NITS?)?\s*(\d+(?:\s*[,+&]\s*\d+)+)/))) out.push('UNIT ' + m[1].split(/\s*[,+&]\s*/).join(' '));
  if ((m = d.match(/\bTEST (\d+ \d+)/))) out.push('TEST ' + m[1]);
  if ((m = d.match(/INTERVIEW (\d+)/))) out.push('INTERVIEW ' + m[1]);
  // "REVIEW 4" on its own (not "REVIEW (15-20 MINS)").
  if ((m = String(s.detail || '').toUpperCase().match(/\bREVIEW[ \t]+(\d+)[ \t]*(?:$|\n|,|;)/m))) out.push('REVIEW ' + m[1]);
  if ((m = d.match(/FLUENCY TIME (\d+)/))) out.push('FLUENCY TIME ' + m[1]);
  if (/MID COURSE REVISION/.test(d)) out.push('MID COURSE REVISION', 'MID COURSE');
  if (/FINAL COURSE/.test(d)) out.push('FINAL COURSE');
  return out;
}
function docsFor(s) {
  if (!s) return [];
  if ((!printDocs.list || Date.now() - printDocs.at > 1800000) && Date.now() - printDocs.tried > 60000) { printDocs.tried = Date.now(); if (!printDocs.loading) loadPrintDocs(true).then(render).catch(() => {}); }
  if (!printDocs.list || !Q.clean(s.book)) return [];
  const items = docItems(s);
  if (!items.length) return [];
  const books = docBookKeys(s.book).map(b => ' ' + b + ' ');
  const inBook = printDocs.list.filter(e => books.some(b => e.keyFull.includes(b)));
  for (const item of items) {
    const it = ' ' + item + ' ';
    // "FLUENCY TIME 4": the 4th template in the book's "Fluency Time Project Templates" folder ("4. Food Plate.pdf").
    const ft = item.match(/^FLUENCY TIME (\d+)$/);
    if (ft) {
      const tpl = inBook.filter(e => e.kind === 'file' && e.keyPath.includes(' FLUENCY TIME ') && e.keyName.startsWith(' ' + ft[1] + ' ')).slice(0, 3);
      if (tpl.length) return tpl.map(f => ({ name: f.name, link: f.link, note: f.full }));
      continue;
    }
    // A folder named after the item ("Written Test 3"): its link and the files directly in it.
    const folder = inBook.find(e => e.kind === 'folder' && e.keyName.trim() === item) || inBook.find(e => e.kind === 'folder' && e.keyName.includes(it));
    if (folder) {
      const files = printDocs.list.filter(e => e.kind === 'file' && e.path === folder.full).slice(0, 6);
      return [{ name: folder.name, link: folder.link, note: folder.full, folder: true }].concat(files.map(f => ({ name: f.name, link: f.link, note: f.full })));
    }
    const files = inBook.filter(e => e.kind === 'file' && e.keyName.includes(it)).slice(0, 6);
    if (files.length) return files.map(f => ({ name: f.name, link: f.link, note: f.full }));
  }
  return [];
}
const docButtons = list => list.map(d => '<a class="doc-btn" href="' + esc(d.link) + '" target="_blank" rel="noopener" title="' + esc(d.note || d.name) + '">' + (d.folder ? '📁 ' : '🖨 ') + esc(d.name) + '</a>').join('');
// Class page: the documents of this lesson right under the lesson header.
const viewClassBeforeDocs = viewClass;
viewClass = function () {
  const h = viewClassBeforeDocs(), list = docsFor(current);
  if (!list.length) return h;
  const row = '<div class="doc-row"><b>' + T('Tài liệu in', 'Print documents') + ':</b>' + docButtons(list) + '</div>';
  // Placed just above the bar with "Mở màn hình lên lớp" (or that button), i.e. right under the lesson header card.
  const i = [h.indexOf('<div class="roll-bar">'), h.indexOf('<button class="primary ll-open"')].filter(x => x >= 0)[0];
  return i == null ? row + h : h.slice(0, i) + row + h.slice(i);
};
// Printing card: documents of the lessons today and in the next two days.
const printCardBeforeDocs = printCard;
printCard = function (week) {
  const h = printCardBeforeDocs(week);
  const days = [day, Q.addDays(day, 1), Q.addDays(day, 2)], items = [];
  days.forEach(d => { const w = weeks[Q.weekTab(tabs, d)]; (w ? w.data.sessions : []).filter(s => s.day === d && !s.off).sort((a, b) => a.start - b.start).forEach(s => { const list = docsFor(s), need = /PRINT/.test(Q.key(s.note || '')); if (list.length || need) items.push({ s, list, need }); }); });
  if (!items.length) return h;
  const lines = items.map(({ s, list }) => '<div class="doc-line"><span class="doc-when">' + esc(dayLabel(s.day).replace(/,.*$/, '')) + ' ' + Q.clock(s.start) + '</span><b>' + esc(s.cls) + '</b><span class="muted small">' + esc(Q.clean(s.book)) + (s.lesson ? T(' · tiết ', ' · lesson ') + esc(s.lesson) : '') + '</span>' +
    (list.length ? docButtons(list) : '<span class="tag warn">' + T('Cần in · chưa tìm thấy file', 'Printing needed · file not found yet') + '</span>') + '</div>').join('');
  const box = '<div class="card row doc-card"><b>🖨️ ' + T('Tài liệu cần in (hôm nay và 2 ngày tới)', 'Documents to print (today and next 2 days)') + '</b>' + lines + '</div>';
  return (h || '') + box;
};

/* ---------- Printing, followed (owner 09/11: "tài liệu in không cần answer key... quản lí với tôi cũng cần nắm được việc in... dấu ấn ai đã
 * in rồi... hiện luôn số bản cần in là số học sinh lớp đó + sơ cua thêm 1-2 bản mỗi lần") ----------
 * - Answer keys never show among the files to print (only the folder link stays when nothing else is there).
 * - Each lesson to print shows the copies: pupils of that class (or group) + 1 spare up to 10 pupils, + 2 above.
 * - "✓ Đã in" writes a row in DIEM_DANH (class "IN TÀI LIỆU", name "<class> · tiết <n>"): everyone sees who printed and when;
 *   the person who ticked it or a manager can take it back. */
const PRINT_DOC_CLS = 'IN TÀI LIỆU';
const isAnswerKey = name => /ANSWER|\bKEYS?\b|DAP AN|LOI GIAI/.test(Q.key(String(name || '')).replace(/[_\-.]/g, ' '));
const docsForBeforeKey = docsFor;
docsFor = function (s) {
  const list = docsForBeforeKey(s), files = list.filter(d => !d.folder && !isAnswerKey(d.name));
  return files.length ? files : list.filter(d => d.folder);
};
const printTried = new Set();
function printCopies(s) {
  const c = classOf(s) || sentClass(s.cls);
  if (!c) return null;
  const t = trackers[c.key];
  if (!t) { if (!printTried.has(c.key)) { printTried.add(c.key); loadTracker(c, false, true).then(render).catch(() => {}); } return null; }
  const g = Q.key(s.cls), mine = (t.pupils || []).filter(p => p.group === g), n = (mine.length ? mine : t.pupils || []).length;
  if (!n) return null;
  const spare = n <= 10 ? 1 : 2;
  return { n, spare, total: n + spare };
}
const printKey = s => Q.clean(s.cls) + ' · ' + T('tiết ', 'lesson ') + Q.clean(s.lesson || '');
function printedOf(s) {
  const k = Q.clean(s.cls) + ' · tiết ' + Q.clean(s.lesson || ''), rows = (logs.marks ? logs.marks.rows : []).filter(r => r.cls === PRINT_DOC_CLS && r.day === s.day && r.name === k);
  const last = rows[rows.length - 1];
  return last && last.status === 'Đã in' ? last : null;
}
function printLine(s, list, week) {
  const cp = printCopies(s), done = printedOf(s), can = isManager() || isTaSide(week) || isMe(s.teacher) || isMe(s.ta);
  const copies = cp ? '<span class="doc-copies" title="' + esc(cp.n + T(' học sinh + ', ' pupils + ') + cp.spare + T(' bản dự phòng', ' spare')) + '">🧾 ' + T('Cần in ', 'Print ') + '<b>' + cp.total + '</b>' + T(' bản', ' copies') + ' <small>(' + cp.n + ' HS + ' + cp.spare + ')</small></span>' : '<span class="doc-copies muted small">🧾 ' + T('đang đếm sĩ số…', 'counting pupils…') + '</span>';
  const mark = done ? '<span class="tag ok">✓ ' + T('Đã in', 'Printed') + ' · ' + esc(done.by || '?') + ' · ' + esc(String(done.at || '').slice(11, 16)) + ' ' + esc(String(done.at || '').slice(0, 5)) + '</span>' + (isManager() || isMe(done.by) ? '<button class="quiet" data-act="docPrinted" data-row="' + s.row + '" data-day="' + s.day + '" data-v="Bỏ in">' + T('Bỏ', 'Undo') + '</button>' : '')
    : can ? '<button class="good" data-act="docPrinted" data-row="' + s.row + '" data-day="' + s.day + '" data-v="Đã in">✓ ' + T('Đã in', 'Printed') + '</button>' : '<span class="tag warn">' + T('Chưa in', 'Not printed') + '</span>';
  return '<div class="doc-line' + (done ? ' done' : '') + '"><span class="doc-when">' + esc(dayLabel(s.day).replace(/,.*$/, '')) + ' ' + Q.clock(s.start) + '</span><b>' + esc(s.cls) + '</b><span class="muted small">' + esc(Q.clean(s.book)) + (s.lesson ? T(' · tiết ', ' · lesson ') + esc(s.lesson) : '') + '</span>' +
    (list.length ? docButtons(list) : '<span class="tag warn">' + T('Cần in · chưa tìm thấy file', 'Printing needed · file not found yet') + '</span>') + copies + mark + '</div>';
}
printCard = function (week) {
  const h = printCardBeforeDocs(week);
  if (!logs.marks) setTimeout(() => loadMarks().then(render).catch(() => {}), 0);
  const days = [day, Q.addDays(day, 1), Q.addDays(day, 2)], items = [];
  days.forEach(d => { const w = weeks[Q.weekTab(tabs, d)]; (w ? w.data.sessions : []).filter(s => s.day === d && !s.off).sort((a, b) => a.start - b.start).forEach(s => { const list = docsFor(s), need = /PRINT/.test(Q.key(s.note || '')); if (list.length || need) items.push({ s, list }); }); });
  if (!items.length) return h;
  const left = items.filter(x => !printedOf(x.s)).length;
  const box = '<div class="card row doc-card"><div class="row-top"><b>🖨️ ' + T('Tài liệu cần in (hôm nay và 2 ngày tới)', 'Documents to print (today and next 2 days)') + '</b><span class="spacer"></span><span class="tag ' + (left ? 'warn' : 'ok') + '">' + (left ? left + T(' buổi chưa in', ' not printed') : T('Đã in đủ', 'All printed')) + '</span></div>' + items.map(x => printLine(x.s, x.list, week)).join('') + '</div>';
  return (h || '') + box;
};
document.addEventListener('click', e => {
  const b = e.target.closest && e.target.closest('[data-act="docPrinted"]');
  if (!b) return;
  const s = findSession(b.dataset.row, b.dataset.day);
  if (!s) return;
  appendMark({ day: s.day, cls: PRINT_DOC_CLS, lesson: '', start: s.start }, { row: '', name: Q.clean(s.cls) + ' · tiết ' + Q.clean(s.lesson || ''), eng: '' }, b.dataset.v);
  render();
});
// Class page: the copies to print next to the documents.
const viewClassBeforeCopies = viewClass;
viewClass = function () {
  const h = viewClassBeforeCopies();
  if (!current || h.indexOf('class="doc-row"') < 0) return h;
  const cp = printCopies(current), done = printedOf(current);
  const add = (cp ? '<span class="doc-copies">🧾 ' + T('Cần in ', 'Print ') + '<b>' + cp.total + '</b>' + T(' bản', ' copies') + ' <small>(' + cp.n + ' HS + ' + cp.spare + ')</small></span>' : '') + (done ? '<span class="tag ok">✓ ' + T('Đã in', 'Printed') + ' · ' + esc(done.by || '?') + '</span>' : '');
  return h.replace(/(<div class="doc-row">[\s\S]*?)(<\/div>)/, (m0, a, b) => a + add + b);
};

/* ---------- Nhân sự & lương trong Điều hành (owner 10/11/2026: "từ giờ tôi muốn chỉ thao tác ở webapp phần điều hành, còn sheet lưu
 * lại... thêm nhân viên mới rồi 1 tháng thử việc") ----------
 * Owner only. Staff records are rows of quanli NHAN_VIEN (newest row per person wins; a change is a new row, the old ones stay as
 * history). From them and the Schedule counts the app lays out the month's payroll draft in the payroll workbook, the owner types
 * the yellow cells (thưởng thêm, trừ khác, tạm ứng, tỷ giá) on the Lương page, and "Chốt" hands it to staff.
 * Probation: at least 85% of the pay (BLLĐ 2019 art. 26), at most 60 days (art. 25); the result is due when it ends (art. 27). */
const NS_STATUS = ['Thử việc', 'Chính thức', 'Tạm dừng', 'Đã nghỉ'];
const NS_KINDS = ['KIDS', 'KINDER', 'FIGHTER', 'JUNIOR', 'TA', 'TUTOR', 'IELTS TUTOR', 'IELTS', 'CLASS KHÁC'];
const NS_POS = ['Giáo viên', 'Trợ giảng', 'Trợ giảng part-time', 'Gia sư', 'Chấm, chữa bài', 'Quản lí', 'Giáo viên nước ngoài', 'Bảo vệ', 'Tạp vụ', 'Nhân viên văn phòng'];
const ns = { rows: null, hd: null, err: '', busy: '', form: null, month: '', fx: '', msg: '' };
const nsJson = t => { try { const o = JSON.parse(t || '{}'); return o && typeof o === 'object' ? o : {}; } catch (e) { return {}; } };
const nsRow = r => ({ at: r[0], name: Q.key(r[1]), full: Q.clean(r[2]), group: Q.clean(r[3]) === 'GVNN' ? 'GVNN' : 'NVVN', pos: Q.clean(r[4]), status: Q.clean(r[5]) || 'Chính thức',
  start: Q.clean(r[6]), trial: Q.clean(r[7]), pct: Number(r[8]) || 100, sum: Q.clean(r[9]), rate: nsJson(r[10]), note: Q.clean(r[11]), id: nsJson(r[12]), by: Q.clean(r[13]) });
const nsMoney = n => n === '' || n == null || isNaN(Number(n)) ? '' : Number(n).toLocaleString('vi-VN');
const nsNum = v => { const s = String(v == null ? '' : v).replace(/[^\d,.\-]/g, ''); if (!s) return ''; const n = Number(/,\d{1,2}$/.test(s) ? s.replace(/\./g, '').replace(',', '.') : s.replace(/[.,](?=\d{3}\b)/g, '').replace(',', '.')); return isFinite(n) ? n : ''; };
const nsAddMonths = (iso, n) => { const d = Q.fromIso(iso); const want = d.getMonth() + n; d.setMonth(want); if (d.getMonth() !== ((want % 12) + 12) % 12) d.setDate(0); return Q.iso(d); };
function nsLatest() { const m = new Map(); (ns.rows || []).forEach(r => { if (r.name) m.set(r.name, r); }); return m; }
function nsActive() { return [...nsLatest().values()].filter(r => r.status !== 'Đã nghỉ'); }
async function loadNs() {
  const [rows, hdRows] = await batchGet(CONFIG.quanLiId, ['NHAN_VIEN!A2:N', 'HOP_DONG!A2:K']);
  ns.rows = rows.map(nsRow); ns.hd = hdRows.map(hdRow); hd.rows = ns.hd;
  if (!nguoi) call('nguoi', {}).then(r => { nguoi = r; render(); }).catch(() => {});
}
// One line of money rules, written into the record so the sheet stays readable on its own.
function nsSummary(g, r) {
  const p = [], m = n => nsMoney(n) + ' đ', u = n => n + '$';
  if (g === 'GVNN') {
    if (r.base) p.push('Lương cơ bản ' + m(r.base) + ' = ' + (r.baseH || 0) + ' giờ đầu');
    if (r.r) p.push((r.usd ? u(r.r) + ' × tỷ giá' : m(r.r)) + '/giờ');
    if (r.r101) p.push('từ giờ 101: ' + (r.usd ? u(r.r101) + ' × tỷ giá' : m(r.r101)));
    if (r.ielts) p.push('lớp IELTS ' + (r.usd ? u(r.ielts) + ' × tỷ giá' : m(r.ielts)) + '/giờ');
    if (r.bonus) p.push('thưởng ' + m(r.bonus) + '/tháng');
    if (r.nha) p.push('nhà ở ' + (r.nhaUsd ? u(r.nha) + ' × tỷ giá' : m(r.nha)) + (r.nhaFree ? ' (không tính thuế)' : ''));
  } else {
    if (r.c) p.push('lương cố định ' + m(r.c));
    if (r.d) p.push('thưởng ' + m(r.d));
    if (r.gs) p.push('gia sư ' + m(r.gs) + '/công (' + (r.gsK || ['TUTOR']).join(', ').replace('CHAM', 'bảng chấm bài') + ')');
    if (r.dl) p.push('dạy-đứng lớp ' + m(r.dl) + '/công (' + (r.dlK || []).join(', ') + ')');
    if (r.tg) p.push('trợ giảng ' + m(r.tg) + '/giờ');
    if (r.ch) p.push('chấm bài ' + m(r.ch) + '/bài');
    if (r.npt) p.push(r.npt + ' người phụ thuộc');
  }
  p.push(r.bhMode === 'tt' ? 'đóng BH ' + String(r.bhRate || 10.5).replace('.', ',') + '% trên lương thực tế khi tháng đó từ 2.340.000 đ' : r.bh ? 'đóng BH ' + String(r.bhRate || 10.5).replace('.', ',') + '% trên ' + m(r.bh) : 'không đóng BH');
  if (r.thue) p.push((NS_TAX_MODES.find(x => x[0] === r.thue) || ['', ''])[1].split(' (')[0]);
  return p.join(' · ');
}
function nsState(r) {
  const t = today();
  if (r.status === 'Thử việc' && r.trial) {
    const left = Math.round((Q.fromIso(r.trial) - Q.fromIso(t)) / 864e5);
    return left < 0 ? ['bad', 'Hết thử việc ' + viDate(r.trial) + ' · chưa đánh giá'] : left <= 7 ? ['warn', 'Thử việc đến ' + viDate(r.trial) + ' · còn ' + left + ' ngày'] : ['warn', 'Thử việc ' + r.pct + '% đến ' + viDate(r.trial)];
  }
  return r.status === 'Tạm dừng' ? ['', 'Tạm dừng'] : r.status === 'Đã nghỉ' ? ['', 'Đã nghỉ'] : ['ok', 'Chính thức'];
}
function nsContract(r) {
  const c = [...(ns.hd || [])].reverse().find(x => Q.key(x.person) === r.name && x.status !== 'Đã xoá');
  if (!c) return '<span class="tag bad">Chưa có hợp đồng</span>';
  const t = today(), end = c.end;
  return '<span class="tag ' + (end && end < t ? 'bad' : end && end <= Q.addDays(t, 30) ? 'warn' : 'ok') + '">' + esc(c.type) + (end ? ' · đến ' + viDate(end) : '') + '</span>';
}
function nsPanel() {
  if (!isOwner()) return '<div class="card empty">Chỉ cô Trang xem phần này.</div>';
  let h = '<p class="small muted">Sửa ở đây, app tự lưu vào sheet (tab NHAN_VIEN của file quản lí, bảng lương tháng ở file BẢNG LƯƠNG THÁNG). Không cần mở sheet.</p>';
  if (ns.err) h += '<div class="notice bad">' + esc(ns.err) + '</div>';
  if (ns.msg) h += '<div class="notice">' + esc(ns.msg) + '</div>';
  if (!ns.rows) return h + '<div class="card empty">Đang đọc danh sách nhân sự…</div>';
  const list = nsActive();
  const due = list.filter(r => r.status === 'Thử việc' && r.trial && r.trial <= Q.addDays(today(), 7));
  due.forEach(r => {
    h += '<div class="card row ns-due"><div class="row-top"><b>⏳ ' + esc(r.full || r.name) + '</b><span class="tag ' + nsState(r)[0] + '">' + esc(nsState(r)[1]) + '</span></div>' +
      '<div class="small">Hết thử việc phải báo kết quả cho người lao động (Điều 27 BLLĐ). Đạt thì ký hợp đồng chính thức, lương từ ' + viDate(Q.addDays(r.trial, 1)) + ' tính 100%.</div>' +
      '<div class="choices"><button class="good" data-act="nsPass" data-n="' + esc(r.name) + '">✓ Đạt, chuyển chính thức</button><button class="low" data-act="nsFail" data-n="' + esc(r.name) + '">Không đạt, nghỉ từ ' + viDate(Q.addDays(r.trial, 1)) + '</button></div></div>';
  });
  h += '<div class="choices"><button class="primary" data-act="nsNew">+ Thêm nhân viên mới</button></div>';
  if (ns.form) h += nsFormHtml();
  h += nsPayCard();
  ['NVVN', 'GVNN'].forEach(g => {
    const part = list.filter(r => r.group === g).sort((a, b) => a.name.localeCompare(b.name, 'vi'));
    if (!part.length) return;
    h += '<h2>' + (g === 'NVVN' ? 'Nhân viên, giáo viên Việt Nam' : 'Giáo viên nước ngoài') + ' <span class="muted small">(' + part.length + ')</span></h2><div class="list">' +
      part.map(r => { const [tone, text] = nsState(r), hasLink = nguoi && nguoi.people.some(p => Q.key(p.name) === r.name);
        return '<div class="card row"><div class="row-top"><b>' + esc(r.full || r.name) + '</b><span class="muted small">' + esc(r.name) + (r.pos ? ' · ' + esc(r.pos) : '') + '</span><span class="spacer"></span><button class="quiet" data-act="nsEdit" data-n="' + esc(r.name) + '">Sửa</button></div>' +
          '<div><span class="tag ' + tone + '">' + esc(text) + '</span> ' + nsContract(r) + (nguoi ? ' <span class="tag' + (hasLink ? ' ok' : '') + '">' + (hasLink ? 'Có link app' : 'Chưa có link app') + '</span>' : '') + '</div>' +
          '<div class="small muted">' + esc(r.sum || nsSummary(r.group, r.rate)) + '</div></div>'; }).join('') + '</div>';
  });
  const gone = [...nsLatest().values()].filter(r => r.status === 'Đã nghỉ');
  if (gone.length) h += '<details class="card row"><summary>Đã nghỉ (' + gone.length + ')</summary>' + gone.map(r => '<div class="row-top small faded"><span>' + esc(r.full || r.name) + '</span><span class="spacer"></span><button class="quiet" data-act="nsEdit" data-n="' + esc(r.name) + '">Xem / đi làm lại</button></div>').join('') + '</details>';
  return h;
}

/* The add / edit form. */
function nsBlank() { return { id: {}, isNew: true, group: 'NVVN', status: 'Thử việc', start: today(), trialMode: '1', trial: Q.addDays(nsAddMonths(today(), 1), -1), pct: 85, app: 'GV', hdOn: true, rate: { gsK: ['TUTOR'], dlK: ['KIDS', 'FIGHTER', 'TA', 'IELTS TUTOR'] } }; }
function nsFormFrom(r) { return { isNew: false, name: r.name, full: r.full, group: r.group, pos: r.pos, status: r.status, start: r.start, trialMode: r.trial ? 'date' : '0', trial: r.trial, pct: r.pct, note: r.note, rate: JSON.parse(JSON.stringify(r.rate || {})), id: Object.assign({}, r.id || {}), app: '', hdOn: false }; }
function nsFormHtml() {
  const f = ns.form, r = f.rate, g = f.group;
  const inp = (k, label, val, extra) => '<label>' + label + '<input data-act="nsF" data-k="' + k + '" value="' + esc(val == null ? '' : val) + '"' + (extra || '') + '></label>';
  const money = (k, label) => inp('r.' + k, label, nsMoney(r[k]), ' inputmode="numeric"');
  const kinds = (k, label) => '<div class="ns-kinds"><span class="small muted">' + label + '</span>' + NS_KINDS.concat(k === 'gsK' ? ['CHAM'] : []).map(x => '<button class="chip' + ((r[k] || []).includes(x) ? ' on' : '') + '" data-act="nsKind" data-k="' + k + '" data-v="' + esc(x) + '">' + esc(x === 'CHAM' ? 'Bảng chấm bài' : x) + '</button>').join('') + '</div>';
  const names = nguoiChoices().map(x => x.name).concat([...nsLatest().keys()]);
  let h = '<div class="card ns-form"><h3>' + (f.isNew ? 'Thêm nhân viên mới' : 'Sửa: ' + esc(f.full || f.name)) + '</h3><div class="form-grid">' +
    (f.isNew ? inp('name', 'Tên trên Schedule (để app đếm công)', f.name, ' list="nsNames" placeholder="VD: MAI ANH"') + '<datalist id="nsNames">' + [...new Set(names)].map(n => '<option value="' + esc(n) + '">').join('') + '</datalist>' : '') +
    inp('full', 'Họ tên đầy đủ', f.full, ' placeholder="Như trên CCCD"') +
    '<label>Nhóm<select data-act="nsF" data-k="group"><option value="NVVN"' + (g === 'NVVN' ? ' selected' : '') + '>Việt Nam</option><option value="GVNN"' + (g === 'GVNN' ? ' selected' : '') + '>Nước ngoài</option></select></label>' +
    inp('pos', 'Vị trí', f.pos, ' list="nsPos"') + '<datalist id="nsPos">' + NS_POS.map(p => '<option value="' + esc(p) + '">').join('') + '</datalist>' +
    inp('start', 'Ngày vào làm', f.start, ' type="date"') +
    (f.isNew ? '' : '<label>Trạng thái<select data-act="nsF" data-k="status">' + NS_STATUS.map(s => '<option' + (f.status === s ? ' selected' : '') + '>' + s + '</option>').join('') + '</select></label>') +
    '<label>Thử việc<select data-act="nsF" data-k="trialMode">' + [['0', 'Không thử việc'], ['1', '1 tháng'], ['2', '2 tháng (tối đa 60 ngày)'], ['date', 'Đến ngày…']].map(([v, t]) => '<option value="' + v + '"' + (String(f.trialMode) === v ? ' selected' : '') + '>' + t + '</option>').join('') + '</select></label>' +
    (f.trialMode !== '0' ? inp('trial', 'Thử việc đến hết ngày', f.trial, ' type="date"') + inp('pct', 'Lương thử việc (% lương chính thức, ít nhất 85)', f.pct, ' type="number" min="85" max="100"') : '') +
    (f.status === 'Đã nghỉ' ? inp('r.het', 'Làm đến hết ngày', r.het || '', ' type="date"') : '') +
    '</div><h4>Lương</h4><div class="form-grid">';
  if (g === 'NVVN') {
    h += money('c', 'Lương cố định / tháng (đ)') + money('d', 'Thưởng hoàn thành CV / tháng (đ)') + money('gs', 'Gia sư (đ/công)') + money('dl', 'Dạy - đứng lớp (đ/công)') + money('tg', 'Trợ giảng theo giờ (đ/giờ)') + money('ch', 'Chấm, chữa bài (đ/bài)') +
      '<label>Đóng bảo hiểm<select data-act="nsF" data-k="r.bhMode">' + [['', 'Không đóng'], ['co', 'Trên mức cố định'], ['tt', 'Theo lương thực tế từng tháng (part-time)']].map(([v, t]) => '<option value="' + v + '"' + ((r.bhMode || (r.bh ? 'co' : '')) === v ? ' selected' : '') + '>' + t + '</option>').join('') + '</select></label>' +
      ((r.bhMode || (r.bh ? 'co' : '')) === 'co' ? money('bh', 'Mức đóng bảo hiểm (đ)') : '') + inp('r.npt', 'Người phụ thuộc', r.npt || '', ' type="number" min="0" max="9"') + '</div>' +
      (r.gs ? kinds('gsK', 'Gia sư tính các buổi:') : '') + (r.dl ? kinds('dlK', 'Dạy - đứng lớp tính các buổi:') : '') +
      (r.tg ? '<p class="small muted">Giờ trợ giảng lấy từ ô chấm công part-time của Schedule (app ghi từ Vào ca / Ra ca).</p>' : '') + (r.ch ? '<p class="small muted">Số bài lấy từ bảng chấm bài (CHẤM CÔNG TỔNG HỢP, cột R:W).</p>' : '');
  } else {
    h += '<label>Tính lương theo<select data-act="nsF" data-k="r.usd"><option value=""' + (r.usd ? '' : ' selected') + '>Tiền Việt (đ)</option><option value="1"' + (r.usd ? ' selected' : '') + '>Đô la × tỷ giá tháng</option></select></label>' +
      inp('r.r', 'Đơn giá giờ (' + (r.usd ? '$' : 'đ') + ')', r.usd ? r.r || '' : nsMoney(r.r)) + inp('r.r101', 'Đơn giá từ giờ 101 (' + (r.usd ? '$' : 'đ') + ', trống = giữ nguyên)', r.usd ? r.r101 || '' : nsMoney(r.r101)) +
      inp('r.ielts', 'Lớp IELTS (' + (r.usd ? '$' : 'đ') + '/giờ, trống = như giờ thường)', r.usd ? r.ielts || '' : nsMoney(r.ielts)) +
      money('base', 'Lương cơ bản (đ, gói giờ đầu)') + inp('r.baseH', 'Số giờ trong lương cơ bản', r.baseH || '', ' type="number" min="0"') + money('bonus', 'Thưởng / tháng (đ)') +
      inp('r.nha', 'Trợ cấp nhà ở (' + (r.nhaUsd ? '$' : 'đ') + ')', r.nhaUsd ? r.nha || '' : nsMoney(r.nha)) +
      '<label>Nhà ở tính bằng<select data-act="nsF" data-k="r.nhaUsd"><option value="">đ</option><option value="1"' + (r.nhaUsd ? ' selected' : '') + '>$ × tỷ giá</option></select></label>' +
      '<label>Nhà ở chịu thuế?<select data-act="nsF" data-k="r.nhaFree"><option value="">Có tính thuế</option><option value="1"' + (r.nhaFree ? ' selected' : '') + '>Không tính thuế</option></select></label>' +
      inp('r.fx', 'Tỷ giá cố định ghi trong hợp đồng (đ/$, trống = Vietcombank lúc lập)', r.fx || '') + money('bh', 'Đóng bảo hiểm trên mức (đ, trống = không)') + '</div>';
  }
  const id = f.id || (f.id = {});
  h += '<h4>Bảo hiểm và thuế</h4><div class="form-grid">' +
    '<label>Tỷ lệ người lao động đóng BH<select data-act="nsF" data-k="r.bhRate">' + [['', '10,5% (BHXH 8% + BHYT 1,5% + BHTN 1%)'], ['9.5', '9,5% (không có BHTN, VD người nước ngoài)'], ['1.5', '1,5% (chỉ BHYT)']].map(([v, t]) => '<option value="' + v + '"' + (String(r.bhRate || '') === v ? ' selected' : '') + '>' + t + '</option>').join('') + '</select></label>' +
    '<label>Cách tính thuế TNCN<select data-act="nsF" data-k="r.thue">' + NS_TAX_MODES.map(([v, t]) => '<option value="' + v + '"' + ((r.thue || '') === v ? ' selected' : '') + '>' + t + '</option>').join('') + '</select></label></div>' +
    '<h4>Hồ sơ (chỉ cô thấy; in vào cột họ tên của bảng lương)</h4><div class="form-grid">' +
    inp('id.cccd', 'Số CCCD / hộ chiếu', id.cccd || '') + inp('id.ns', 'Ngày sinh', id.ns || '', ' type="date"') + inp('id.mst', 'Mã số thuế cá nhân', id.mst || '') +
    inp('id.bank', 'Ngân hàng', id.bank || '', ' placeholder="VD: Vietcombank Phú Thọ"') + inp('id.stk', 'Số tài khoản', id.stk || '', ' inputmode="numeric"') + inp('id.phone', 'Điện thoại', id.phone || '') + '</div>' +
    (f.isNew ? '' : '<div class="choices"><button class="quiet" data-act="nsHoSo">Lấy CCCD, STK từ bảng lương gần nhất</button></div>');
  h += '<div class="form-grid">' + inp('note', 'Ghi chú', f.note || '') + '</div>';
  if (f.isNew) h += '<div class="form-grid"><label>Link app<select data-act="nsF" data-k="app">' + [['GV', 'Tạo link vai trò GV'], ['TA', 'Tạo link vai trò TA'], ['Quản lí', 'Tạo link vai trò Quản lí'], ['', 'Không tạo link']].map(([v, t]) => '<option value="' + v + '"' + (f.app === v ? ' selected' : '') + '>' + t + '</option>').join('') + '</select></label>' +
    '<label>Hợp đồng<select data-act="nsF" data-k="hdOn"><option value="1"' + (f.hdOn ? ' selected' : '') + '>Ghi hợp đồng ' + (f.trialMode !== '0' ? 'thử việc' : 'vào trang Hợp đồng') + '</option><option value=""' + (f.hdOn ? '' : ' selected') + '>Để sau</option></select></label></div>';
  h += '<p class="small muted">Thử việc: tối đa 60 ngày với việc cần trình độ cao đẳng trở lên, 30 ngày với trung cấp, 6 ngày làm việc với việc khác; lương thử việc ít nhất 85%. Tháng có thử việc, app tính phần lương cố định và đơn giá theo số ngày, số buổi trong thời gian thử việc.</p>' +
    '<div class="choices"><button class="primary" data-act="nsSave"' + (ns.busy ? ' disabled' : '') + '>' + (ns.busy === 'save' ? 'Đang lưu…' : 'Lưu') + '</button><button class="quiet" data-act="nsCancel">Huỷ</button></div></div>';
  return h;
}
function nsField(k, v) {
  const f = ns.form; if (!f) return;
  if (k.startsWith('id.')) { f.id = f.id || {}; f.id[k.slice(3)] = Q.clean(v); return false; }
  if (k.startsWith('r.')) {
    const key = k.slice(2), textKeys = ['het', 'thue', 'bhRate', 'bhMode', 'ca'], flags = ['usd', 'nhaUsd', 'nhaFree'];
    if (key === 'bhMode') { f.rate.bhMode = v === 'co' ? '' : v; if (v !== 'co') f.rate.bh = ''; if (v === 'co' && !f.rate.bh) f.rate.bh = 4730000; return true; }
    f.rate[key] = flags.includes(key) ? (v ? 1 : 0) : textKeys.includes(key) ? v : (f.group === 'GVNN' && f.rate.usd && ['r', 'r101', 'ielts'].includes(key)) || (key === 'nha' && f.rate.nhaUsd) || ['npt', 'baseH'].includes(key) ? (v === '' ? '' : Number(String(v).replace(',', '.'))) : nsNum(v);
    return flags.includes(key) || ['gs', 'dl', 'tg', 'ch'].includes(key);
  }
  f[k] = k === 'pct' ? Number(v) : k === 'hdOn' ? !!v : v;
  if (k === 'trialMode' || k === 'start') { if (f.trialMode === '1' || f.trialMode === '2') f.trial = Q.addDays(nsAddMonths(f.start || today(), Number(f.trialMode)), -1); if (f.trialMode === '0') f.trial = ''; }
  if (k === 'group' && v === 'GVNN' && f.isNew) { f.rate = { usd: 1, bh: '' }; f.pos = f.pos || 'Giáo viên nước ngoài'; }
  if (k === 'group' && v === 'NVVN' && f.isNew) f.rate = { gsK: ['TUTOR'], dlK: ['KIDS', 'FIGHTER', 'TA', 'IELTS TUTOR'] };
  return ['group', 'trialMode', 'status', 'start'].includes(k);
}
async function nsSave() {
  const f = ns.form;
  const name = Q.key(f.name || ''), full = Q.clean(f.full || '').toUpperCase();
  if (!name || name.length > 60) return say('Ghi tên đúng như trên Schedule để app đếm công.', 'bad');
  if (f.isNew && nsLatest().has(name) && nsLatest().get(name).status !== 'Đã nghỉ') return say(name + ' đã có trong danh sách. Bấm Sửa ở dòng đó.', 'bad');
  if (!f.start) return say('Chọn ngày vào làm.', 'bad');
  const trial = f.trialMode === '0' ? '' : f.trial;
  if (trial) {
    if (trial < f.start) return say('Ngày hết thử việc phải sau ngày vào làm.', 'bad');
    if (Q.fromIso(trial) - Q.fromIso(f.start) > 59 * 864e5) return say('Thử việc tối đa 60 ngày (Điều 25 BLLĐ).', 'bad');
    if (!(f.pct >= 85 && f.pct <= 100)) return say('Lương thử việc ít nhất 85% lương chính thức (Điều 26 BLLĐ).', 'bad');
  }
  const rate = Object.fromEntries(Object.entries(f.rate).filter(([k, v]) => v !== '' && v != null && v !== 0 && !(Array.isArray(v) && !v.length)));
  if (f.group === 'NVVN' && !['c', 'd', 'gs', 'dl', 'tg', 'ch'].some(k => rate[k])) return say('Nhập ít nhất một khoản lương.', 'bad');
  if (f.group === 'GVNN' && !rate.r && !rate.base) return say('Nhập đơn giá giờ hoặc lương cơ bản.', 'bad');
  const status = f.isNew ? (trial && trial >= today() ? 'Thử việc' : 'Chính thức') : f.status;
  const row = [stamp(), name, full, f.group, Q.clean(f.pos || ''), status, f.start, trial, trial ? f.pct : 100, nsSummary(f.group, rate), JSON.stringify(rate), Q.clean(f.note || ''), JSON.stringify(Object.fromEntries(Object.entries(f.id || {}).filter(([, v]) => v))), me.name];
  ns.busy = 'save'; render();
  try {
    await appendRows(CONFIG.quanLiId, 'NHAN_VIEN', [row]);
    ns.rows.push(nsRow(row));
    const done = ['Đã lưu ' + (full || name) + '.'];
    if (f.isNew && f.hdOn) {
      const hdr = [stamp(), name, trial ? 'Thử việc' : f.group === 'GVNN' ? 'Giáo viên nước ngoài' : 'Toàn thời gian (xác định thời hạn)', '', '', f.start, trial || '', trial || '', trial ? 'Lương thử việc ' + f.pct + '%' : '', 'Hiệu lực', me.name];
      await appendRows(CONFIG.quanLiId, 'HOP_DONG', [hdr]); ns.hd.push(hdRow(hdr)); done.push('Đã ghi hợp đồng ' + (trial ? 'thử việc đến ' + viDate(trial) : '') + ' ở trang Hợp đồng.');
    }
    if (f.isNew && f.app && !(nguoi && nguoi.people.some(p => Q.key(p.name) === name))) {
      try { const r = await call('them', { name, role: f.app }); nguoiMoi = { name: r.name, link: location.origin + location.pathname + '#k=' + r.key }; done.push('Đã tạo link app: mở trang Người dùng để copy gửi riêng cho ' + name + ' (link chỉ hiện một lần).'); nguoi = null; }
      catch (e) { done.push('Chưa tạo được link app: ' + e.message); }
    }
    ns.form = null; ns.msg = done.join(' ');
  } catch (e) { say('Chưa lưu được: ' + e.message, 'bad'); }
  finally { ns.busy = ''; render(); }
}
async function nsDecide(name, pass) {
  const r = nsLatest().get(name);
  if (!r) return;
  const from = Q.addDays(r.trial || today(), 1);
  if (!window.confirm(pass ? 'Xác nhận ' + (r.full || name) + ' đạt thử việc, chính thức từ ' + viDate(from) + '?' : 'Xác nhận ' + (r.full || name) + ' không đạt thử việc, nghỉ từ ' + viDate(from) + '?')) return;
  const rate = Object.assign({}, r.rate);
  if (!pass) rate.het = r.trial || today();
  const row = [stamp(), name, r.full, r.group, r.pos, pass ? 'Chính thức' : 'Đã nghỉ', r.start, r.trial, r.pct, nsSummary(r.group, rate), JSON.stringify(rate), (pass ? 'Đạt thử việc ' : 'Không đạt thử việc ') + viDate(today()), JSON.stringify(r.id || {}), me.name];
  try {
    await appendRows(CONFIG.quanLiId, 'NHAN_VIEN', [row]); ns.rows.push(nsRow(row));
    if (pass) {
      drafts.hd = { person: name, type: r.group === 'GVNN' ? 'Giáo viên nước ngoài' : 'Toàn thời gian (xác định thời hạn)', start: from, end: Q.addDays(nsAddMonths(from, 12), -1) };
      ns.msg = (r.full || name) + ' đã chính thức từ ' + viDate(from) + '. Ký hợp đồng chính thức rồi bấm Lưu ở trang Hợp đồng (đã điền sẵn).';
    } else ns.msg = (r.full || name) + ' nghỉ từ ' + viDate(from) + '. Nhớ báo kết quả thử việc bằng văn bản và xoá link app ở trang Người dùng.';
  } catch (e) { say('Chưa lưu được: ' + e.message, 'bad'); }
  render();
}

/* ---------- The month's payroll draft, laid out from the records and the Schedule ---------- */
// Thuế TNCN: lũy tiến (HĐLĐ từ 3 tháng, cư trú); 10% khi không HĐLĐ hoặc HĐ dưới 3 tháng và mỗi lần trả từ NS_K10_FROM (Nghị định 253/2026, kế toán xác nhận);
// 20% trên thu nhập chịu thuế với người không cư trú (dưới 183 ngày ở Việt Nam).
const NS_TAX_MODES = [['', 'Lũy tiến (HĐLĐ từ 3 tháng, cư trú)'], ['k10', 'Khấu trừ 10% (không HĐLĐ hoặc HĐ dưới 3 tháng)'], ['k20', '20% (người nước ngoài không cư trú)']];
const NS_K10_FROM = 5000000;
// Lowest monthly pay that must be insured = lương cơ sở / mức tham chiếu (2.340.000 đ from 1/7/2024; change here if the state raises it).
const NS_BH_FLOOR = 2340000;
const nsTaxCell = (mode, taxable, gross) => mode === 'k20' ? '=ROUND(MAX(0;' + gross + ')*20%;0)' : mode === 'k10' ? '=IF(' + gross + '>=' + NS_K10_FROM + ';ROUND(' + gross + '*10%;0);0)' : NS_TAX(taxable);
const nsBhPct = a => String(a.bhRate || 10.5).replace('.', ',') + '%';
const NS_TAX = x => '=ROUND(MAX(0;' + x + '*5%;' + x + '*10%-500000;' + x + '*20%-3500000;' + x + '*30%-9500000;' + x + '*35%-14500000);0)';
const nsDec = n => String(Math.round(n * 100) / 100).replace('.', ',');
function nsPayCard() {
  const m = ns.month || Q.addDays(today().slice(0, 7) + '-01', -1).slice(0, 7);
  return '<div class="card ns-pay"><h3>💰 Bảng lương tháng</h3><div class="form-grid">' +
    '<label>Tháng<input type="month" data-act="nsF0" data-k="month" value="' + esc(m) + '"></label>' +
    '<label>Tỷ giá $ của tháng (đ, cho GV tính bằng $)<input data-act="nsF0" data-k="fx" inputmode="numeric" value="' + esc(ns.fx || (saved.get('nsFx') || '26295')) + '"></label></div>' +
    '<p class="small muted">1. Bấm Lập: app đếm công từ Schedule và bảng chấm bài, nhân đơn giá ở danh sách dưới, ghi thành tab nháp. Lập lại bao nhiêu lần cũng được, ô cô đã nhập được giữ. ' +
    '2. Mở trang Lương: xem từng người, nhập thưởng thêm, trừ khác, tạm ứng, tỷ giá. 3. Bấm Chốt: nhân viên thấy lương của mình từ ngày 8.</p>' +
    '<div class="choices"><button class="primary" data-act="nsLap"' + (ns.busy ? ' disabled' : '') + '>' + (ns.busy === 'lap' ? 'Đang lập…' : 'Lập / cập nhật bảng nháp') + '</button>' +
    '<button data-act="view" data-v="luong">Mở trang Lương</button><button class="good" data-act="nsChot"' + (ns.busy ? ' disabled' : '') + '>Chốt bảng ' + esc(monthName(m)) + '</button></div></div>';
}
function nsWindow(r, month) {
  const first = month + '-01', last = Q.addDays(nsAddMonths(first, 1), -1), dim = Number(last.slice(8));
  const from = r.start && r.start > first ? r.start : first, to = r.rate.het && r.rate.het < last ? r.rate.het : last;
  if (from > to) return null;
  const days = Math.round((Q.fromIso(to) - Q.fromIso(from)) / 864e5) + 1;
  const tEnd = r.trial && r.pct < 100 ? (r.trial < to ? r.trial : to) : '';
  const trialDays = tEnd && tEnd >= from ? Math.round((Q.fromIso(tEnd) - Q.fromIso(from)) / 864e5) + 1 : 0;
  return { first, last, dim, from, to, days, trialDays, inTrial: d => !!(tEnd && d <= tEnd && d >= from) };
}
// Fixed monthly pay for the days worked, probation days at the probation rate.
function nsFixed(amount, w, pct) {
  if (!amount) return '';
  if (w.days === w.dim && !w.trialDays) return amount;
  return '=ROUND(' + amount + '*(' + (w.trialDays ? w.trialDays + '*' + pct + '%+' : '') + (w.days - w.trialDays) + ')/' + w.dim + ';0)';
}
// A unit rate, weighted when part of the units fall inside probation.
function nsRateCell(rate, u, pct) {
  if (!u.trial || pct >= 100 || !u.all) return rate;
  return '=(' + nsDec(u.trial) + '*' + rate + '*' + pct + '%+' + nsDec(u.all - u.trial) + '*' + rate + ')/' + nsDec(u.all);
}
function nsUnits(pay, r, w, kinds, measure) {
  const k = r.name, out = { all: 0, trial: 0, minutes: 0, trialMinutes: 0, by: {} };
  if ((kinds || []).includes('CHAM') || measure === 'papers') {
    pay.marking.filter(x => x.person === k && x.day >= w.from && x.day <= w.to).forEach(x => { out.all += x.papers; if (w.inTrial(x.day)) out.trial += x.papers; out.by['bảng chấm bài'] = (out.by['bảng chấm bài'] || 0) + x.papers; });
    if (measure === 'papers') return out;
  }
  pay.entries.filter(e => e.person === k && e.count && e.day >= w.from && e.day <= w.to && (kinds || []).includes(e.kind)).forEach(e => {
    const v = measure === 'hours' ? e.minutes : 1;
    out.all += v; out.by[e.kind] = (out.by[e.kind] || 0) + v; out.minutes += e.minutes;
    if (w.inTrial(e.day)) { out.trial += v; out.trialMinutes += e.minutes; }
  });
  if (measure === 'hours') { out.all /= 60; out.trial /= 60; Object.keys(out.by).forEach(k => { out.by[k] /= 60; }); }
  return out;
}
const nsBy = u => Object.entries(u.by).map(([k, v]) => k + ' ' + nsDec(v)).join(' + ');
function nsHeader(title, bands, subs, labels) {
  const w = labels.length, r1 = Array(w).fill(''), r2 = Array(w).fill('');
  bands.forEach(b => { r1[b[0]] = b[2]; }); subs.forEach(s => { r2[s[0]] = s[2]; });
  const r0 = Array(w).fill(''); r0[0] = 'PHÚC HƯNG EDU'; r0[2] = title;
  return [r0, r1, r2, labels];
}
const NS_NV_LABELS = ['Lưu ý (cách tính)', 'HỌ TÊN', 'Lương cố định', 'Thưởng hoàn thành CV', 'Thưởng thêm (nhập tay)', 'Số công', 'Đơn giá', 'Thành tiền', 'Số công', 'Đơn giá', 'Thành tiền', 'Số giờ', 'Đơn giá', 'Thành tiền', 'Số bài', 'Đơn giá', 'Thành tiền',
  'TỔNG THU NHẬP', 'MỨC ĐÓNG BẢO HIỂM', 'BHXH, BHYT, BHTN (10,5%)', 'GIẢM TRỪ NGƯỜI PHỤ THUỘC', 'THU NHẬP TÍNH THUẾ', 'THUẾ TNCN', 'TRỪ KHÁC (truy thu, nghỉ không lương) (nhập tay)', 'TỔNG KHẤU TRỪ', 'THỰC NHẬN', 'TẠM ỨNG (nhập tay)', 'CÒN LẠI (chuyển khoản)', 'NGUỒN SỐ CÔNG / CẦN XEM'];
const NS_NV_LAYOUT = { bands: [[2, 18, 'CÁC KHOẢN ĐƯỢC NHẬN', '#c9daf8'], [18, 23, 'BẢO HIỂM VÀ THUẾ', '#fff2cc', 1], [23, 25, 'KHẤU TRỪ', '#f4cccc', 1], [25, 28, 'THỰC NHẬN', '#d9ead3', 1], [28, 29, '', '#eeeeee', 1]],
  subs: [[2, 5, 'LƯƠNG VÀ THƯỞNG', '#e8f0fe'], [5, 8, 'GIA SƯ', '#d6e4f9'], [8, 11, 'DẠY - ĐỨNG LỚP', '#e8f0fe'], [11, 14, 'TRỢ GIẢNG THEO GIỜ', '#d6e4f9'], [14, 17, 'CHẤM / CHỮA BÀI', '#e8f0fe'], [17, 18, '', '#c9daf8']],
  money: [2, 3, 4, 6, 7, 9, 10, 12, 13, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27], num: [5, 8, 11, 14], manual: [4, 23, 26], auto: [5, 8, 11, 14], rate: [6, 9, 12, 15], net: [25, 27] };
const NS_GV_LABELS = ['Lưu ý (cách tính)', 'HỌ TÊN / Name', 'Số giờ / Hours', 'Tỷ giá (đ/$) / Exchange rate', 'Lương cơ bản / Base pay', 'Giờ trong lương cơ bản / Hours in base', 'Đơn giá giờ / Hourly rate', 'Lương giờ / Hourly pay', 'Đơn giá từ giờ 101 / Rate from hour 101', 'Lương từ giờ 101 / Pay from hour 101',
  'Số giờ / Hours', 'Đơn giá / Rate', 'Thành tiền / Pay', 'Thưởng / Bonus', 'Nhà ở / Housing', 'Thưởng thêm (nhập tay) / Extra', 'TỔNG THU NHẬP / TOTAL', 'KHOẢN KHÔNG TÍNH THUẾ / Not taxed', 'BHXH / Social insurance', 'THU NHẬP TÍNH THUẾ / Taxable income', 'THUẾ TNCN / Personal income tax',
  'TRỪ KHÁC (nhập tay) / Other deductions', 'TỔNG KHẤU TRỪ / Total deductions', 'THỰC NHẬN / Net', 'TẠM ỨNG (nhập tay) / Advance', 'CÒN LẠI / Remaining salary', 'NGUỒN SỐ GIỜ / CẦN XEM'];
const NS_GV_LAYOUT = { bands: [[2, 17, 'CÁC KHOẢN ĐƯỢC NHẬN / Received amounts', '#c9daf8'], [17, 21, 'BẢO HIỂM VÀ THUẾ / Insurance and tax', '#fff2cc', 1], [21, 23, 'KHẤU TRỪ / Deductions', '#f4cccc', 1], [23, 26, 'THỰC NHẬN / Net', '#d9ead3', 1], [26, 27, '', '#eeeeee', 1]],
  subs: [[2, 10, 'GIỜ DẠY THƯỜNG / Regular teaching', '#e8f0fe'], [10, 13, 'LỚP IELTS / IELTS classes', '#d6e4f9'], [13, 16, 'THƯỞNG, NHÀ Ở / Bonus, housing', '#e8f0fe'], [16, 17, '', '#c9daf8']],
  money: [3, 4, 6, 7, 8, 9, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25], num: [2, 5, 10], manual: [3, 15, 21, 24], auto: [2, 10], rate: [5, 6, 8, 11], net: [23, 25] };
// Builds both month grids. pay = { entries, marking } from loadPay; fx = this month's dollar rate.
function nsBuild(month, people, pay, fx) {
  const mm = month.slice(5) + '/' + month.slice(0, 4), out = {};
  ['NVVN', 'GVNN'].forEach(g => {
    const nv = g === 'NVVN', labels = nv ? NS_NV_LABELS : NS_GV_LABELS, layout = JSON.parse(JSON.stringify(nv ? NS_NV_LAYOUT : NS_GV_LAYOUT));
    const grid = nsHeader(nv ? 'BẢNG LƯƠNG NHÂN VIÊN, GIÁO VIÊN VIỆT NAM — THÁNG ' + mm : 'BẢNG LƯƠNG GIÁO VIÊN NƯỚC NGOÀI / FOREIGN TEACHERS — THÁNG ' + mm, layout.bands, layout.subs, labels);
    const list = [], missing = [];
    people.filter(r => r.group === g && r.status !== 'Tạm dừng').forEach(r => {
      const w = nsWindow(r, month);
      if (!w) return;
      const R = grid.length + 1, row = grid.length, a = r.rate, pct = r.trial && r.pct < 100 ? r.pct : 100, rules = [r.sum || nsSummary(g, a)], src = [];
      if (a.thue) rules.push('Thuế: ' + (NS_TAX_MODES.find(x => x[0] === a.thue) || ['', ''])[1] + '.');
      if (pct < 100 && w.trialDays) rules.push('Thử việc ' + pct + '% đến ' + viDate(r.trial) + ': ' + w.trialDays + ' ngày trong tháng.');
      if (w.days < w.dim) rules.push('Tính ' + w.days + '/' + w.dim + ' ngày (' + viDate(w.from) + ' – ' + viDate(w.to) + ').');
      let cells;
      if (nv) {
        const gs = a.gs ? nsUnits(pay, r, w, a.gsK || ['TUTOR'], 'count') : null, dl = a.dl ? nsUnits(pay, r, w, a.dlK || [], 'count') : null;
        const tg = a.tg ? nsUnits(pay, r, w, ['Part-time'], 'hours') : null, ch = a.ch ? nsUnits(pay, r, w, ['CHAM'], 'papers') : null;
        [[gs, 'Gia sư', 5], [dl, 'Dạy lớp', 8], [tg, 'Trợ giảng', 11], [ch, 'Chấm bài', 14]].forEach(([u, t, c]) => { if (!u) return; if (u.all) src.push(t + ': ' + (t === 'Trợ giảng' ? u.minutes + ' phút' : nsBy(u))); else { missing.push([row, c]); src.push(t + ': chưa có số trong tháng, cô xem lại'); } });
        cells = [rules.join('\n'), '', nsFixed(a.c, w, pct), nsFixed(a.d, w, pct), '',
          gs ? gs.all : '', gs ? nsRateCell(a.gs, gs, pct) : '', gs ? '=ROUND(F' + R + '*G' + R + ';0)' : '',
          dl ? dl.all : '', dl ? nsRateCell(a.dl, dl, pct) : '', dl ? '=ROUND(I' + R + '*J' + R + ';0)' : '',
          tg ? '=' + tg.minutes + '/60' : '', tg ? nsRateCell(a.tg, tg, pct) : '', tg ? '=ROUND(L' + R + '*M' + R + ';0)' : '',
          ch ? ch.all : '', ch ? nsRateCell(a.ch, ch, pct) : '', ch ? '=ROUND(O' + R + '*P' + R + ';0)' : '',
          '=SUM(C' + R + ';D' + R + ';E' + R + ';H' + R + ';K' + R + ';N' + R + ';Q' + R + ')',
          // Part-time on actual pay: insured only in a month whose pay reaches the lowest insurance base (Luật BHXH 2024, Điều 2 và 31).
          a.bhMode === 'tt' ? '=IF(R' + R + '>=' + NS_BH_FLOOR + ';R' + R + ';0)' : a.bh || '', a.bhMode === 'tt' || a.bh ? '=ROUND(S' + R + '*' + nsBhPct(a) + ';0)' : '', a.npt ? '=' + a.npt + '*6200000' : '',
          '=MAX(0;R' + R + '-T' + R + '-U' + R + '-15500000)', nsTaxCell(a.thue, 'V' + R, 'R' + R), '', '=T' + R + '+W' + R + '+X' + R, '=R' + R + '-Y' + R, '', '=Z' + R + '-AA' + R, src.join(' · ')];
      } else {
        const usd = !!a.usd, sep = !!a.ielts, all = NS_KINDS.filter(k => !(sep && k === 'IELTS'));
        const hrs = nsUnits(pay, r, w, a.hK || all, 'hours'), ie = sep ? nsUnits(pay, r, w, ['IELTS'], 'hours') : null;
        const money = v => usd ? '=D' + R + '*' + String(v).replace('.', ',') : v;
        const rateCell = (v, u) => { if (!v) return ''; const base = usd ? 'D' + R + '*' + String(v).replace('.', ',') : v; if (!u.trial || pct >= 100 || !u.all) return usd ? '=' + base : base; return '=(' + nsDec(u.trial) + '*' + base + '*' + pct + '%+' + nsDec(u.all - u.trial) + '*' + base + ')/' + nsDec(u.all); };
        src.push('Giờ thường: ' + (hrs.all ? nsBy(hrs) + ' giờ' : 'chưa có giờ trong tháng'));
        if (!hrs.all) missing.push([row, 2]);
        if (ie) src.push('IELTS: ' + nsDec(ie.all) + ' giờ');
        cells = [rules.join('\n'), '', '=' + hrs.minutes + '/60', usd ? (a.fx || fx || '') : (a.fx || '-'), nsFixed(a.base, w, pct), a.baseH || '', rateCell(a.r, hrs),
          '=ROUND(MAX(0;IF(I' + R + '="";C' + R + ';MIN(C' + R + ';100))-F' + R + ')*G' + R + ';0)', a.r101 ? money(a.r101) : '', a.r101 ? '=ROUND(MAX(0;C' + R + '-100)*I' + R + ';0)' : '',
          ie ? '=' + ie.minutes + '/60' : '', ie ? rateCell(a.ielts, ie) : '', ie ? '=ROUND(K' + R + '*L' + R + ';0)' : '', nsFixed(a.bonus, w, 100), a.nha ? (a.nhaUsd ? money(a.nha) : a.nha) : '', '',
          '=SUM(E' + R + ';H' + R + ';J' + R + ';M' + R + ';N' + R + ';O' + R + ';P' + R + ')', a.nhaFree && a.nha ? '=O' + R : '', a.bh ? '=ROUND(' + a.bh + '*' + nsBhPct(a) + ';0)' : '',
          '=MAX(0;Q' + R + '-R' + R + '-S' + R + '-15500000)', nsTaxCell(a.thue, 'T' + R, 'Q' + R + '-R' + R), '', '=S' + R + '+U' + R + '+V' + R, '=Q' + R + '-W' + R, '', '=X' + R + '-Y' + R, src.join(' · ')];
        if (usd && !(a.fx || fx)) missing.push([row, 3]);
      }
      grid.push(cells.map(v => typeof v === 'number' && !Number.isInteger(v) ? nsDec(v) : v));
      const id = r.id || {}, hasId = id.cccd || id.stk;
      list.push({ row, name: r.full || r.name, short: r.name, role: r.pos, b: hasId ? [r.full || r.name].concat(id.cccd ? ['Số CCCD: ' + id.cccd] : [], id.ns ? ['Ngày sinh: ' + viDate(id.ns)] : [], r.pos ? ['Chức vụ: ' + r.pos] : [], id.mst ? ['MST: ' + id.mst] : [], id.stk ? ['STK: ' + id.stk + (id.bank ? ' - ' + id.bank : '')] : []).join('\n') : '' });
    });
    if (!list.length) return;
    const first = 5, lastR = grid.length, sums = nv ? [2, 3, 4, 7, 10, 13, 16, 17, 19, 22, 23, 24, 25, 26, 27] : [4, 7, 9, 12, 13, 14, 15, 16, 18, 20, 21, 22, 23, 24, 25];
    grid.push(labels.map((_, c) => c === 1 ? 'TỔNG CỘNG' : sums.includes(c) ? '=SUM(' + Q.colName(c) + first + ':' + Q.colName(c) + lastR + ')' : ''));
    layout.missing = missing;
    out[g] = { grid, people: list, layout };
  });
  return out;
}
async function nsLap() {
  const month = ns.month || Q.addDays(today().slice(0, 7) + '-01', -1).slice(0, 7), fx = nsNum(ns.fx || saved.get('nsFx') || '26295');
  if (!ns.rows) return;
  ns.busy = 'lap'; ns.msg = ''; render();
  try {
    const pay = await loadPay(month, true);
    const built = nsBuild(month, nsActive().concat([...nsLatest().values()].filter(r => r.status === 'Đã nghỉ' && r.rate.het && r.rate.het >= month + '-01')), pay, fx);
    const done = [];
    for (const g of Object.keys(built)) {
      const b = built[g], r = await call('luonglap', { group: g, month, grid: b.grid, layout: b.layout, people: b.people }, 1);
      done.push(r.tab + ': ' + r.rows + ' người' + (r.kept ? ', giữ ' + r.kept + ' ô cô đã nhập' : '') + (r.fresh.length ? '; người mới chưa có CCCD, STK: ' + r.fresh.join(', ') : '') + (b.layout.missing.length ? '; ' + b.layout.missing.length + ' ô cam cần xem' : ''));
    }
    keep('nsFx', String(fx));
    ns.msg = done.length ? 'Đã lập ' + done.join(' · ') + '. Mở trang Lương để xem từng người.' : 'Không có ai để lập lương tháng này.';
  } catch (e) { ns.msg = ''; say('Chưa lập được: ' + e.message, 'bad'); }
  finally { ns.busy = ''; render(); }
}
async function nsChot() {
  const month = ns.month || Q.addDays(today().slice(0, 7) + '-01', -1).slice(0, 7);
  if (!window.confirm('Chốt bảng lương ' + monthName(month) + '? Nhân viên thấy lương của mình từ ngày 8 (chốt sau ngày 9 thì thấy ngay, xác nhận đến 17:00 ngày 10); sau khi chốt muốn sửa thì sửa trong file.')) return;
  ns.busy = 'chot'; render();
  try { const r = await call('luongchot', { month }, 1); ns.msg = 'Đã chốt: ' + r.tabs.join(', ') + '.'; pay.all = null; }
  catch (e) { say('Chưa chốt được: ' + e.message, 'bad'); }
  finally { ns.busy = ''; render(); }
}

/* Lương page, owner, a draft: the yellow cells can be typed here. */
const NS_MANUAL = { NVVN: [[4, 'Thưởng thêm'], [23, 'Trừ khác (truy thu, nghỉ không lương)'], [26, 'Tạm ứng']], GVNN: [[3, 'Tỷ giá (đ/$)'], [15, 'Thưởng thêm'], [21, 'Trừ khác'], [24, 'Tạm ứng']] };
const slipCardBeforeNs = slipCard;
slipCard = function (d) {
  const h = slipCardBeforeNs(d);
  if (!isOwner() || !d || !d.slip || !/\(NHÁP\)\s*$/.test(d.slip.tab)) return h;
  const s = d.slip, g = /^GVNN/.test(s.tab) ? 'GVNN' : 'NVVN', have = c => { const it = s.items.find(x => x.col === c); return it ? it.value : ''; };
  return h + '<div class="card row ns-manual"><b>✏️ Ô cô nhập (bảng nháp)</b><div class="form-grid">' + NS_MANUAL[g].map(([c, t]) => '<label>' + t + '<input inputmode="numeric" data-act="nsCell" data-tab="' + esc(s.tab) + '" data-row="' + s.row + '" data-col="' + c + '" value="' + esc(String(have(c)).replace(/\s*đ$/, '')) + '"></label>').join('') + '</div>' +
    '<p class="small muted">Gõ số rồi bấm Enter (hoặc bấm ra ngoài ô): ô hiện "✓ Đã lưu" và thực nhận tự tính lại. Để trống là 0.</p></div>';
};
document.addEventListener('change', async e => {
  const b = e.target;
  if (!b || !b.dataset) return;
  if (b.dataset.act === 'nsCell') {
    b.disabled = true;
    try { await call('luongo', { tab: b.dataset.tab, row: Number(b.dataset.row), col: Number(b.dataset.col), value: b.value }, 1); say('Đã ghi vào bảng nháp.'); await loadLuong(true); }
    catch (err) { say('Chưa ghi được: ' + err.message, 'bad'); b.disabled = false; }
  }
  if (b.dataset.act === 'nsF' && ns.form) { if (nsField(b.dataset.k, b.value)) render(); }
  if (b.dataset.act === 'nsF0') { ns[b.dataset.k] = b.value; if (b.dataset.k === 'month') render(); }
});
document.addEventListener('input', e => {
  const b = e.target;
  if (b && b.dataset && b.dataset.act === 'nsF' && ns.form && b.tagName === 'INPUT') nsField(b.dataset.k, b.value);
  if (b && b.dataset && b.dataset.act === 'nsF0') ns[b.dataset.k] = b.value;
});
document.addEventListener('click', e => {
  const b = e.target.closest && e.target.closest('[data-act]');
  if (!b) return;
  const act = b.dataset.act;
  if (act === 'nsNew') { ns.form = nsBlank(); ns.msg = ''; if (!nguoi) call('nguoi', {}).then(r => { nguoi = r; }).catch(() => {}); Promise.all([weekOf(today()), weekOf(Q.addDays(today(), -7))]).then(render).catch(() => {}); render(); }
  if (act === 'nsEdit') { const r = nsLatest().get(b.dataset.n); if (r) { ns.form = nsFormFrom(r); ns.msg = ''; render(); const el = document.querySelector('.ns-form'); if (el) el.scrollIntoView({ block: 'start' }); } }
  if (act === 'nsCancel') { ns.form = null; render(); }
  if (act === 'nsKind' && ns.form) { const k = b.dataset.k, v = b.dataset.v, list = ns.form.rate[k] = ns.form.rate[k] || []; const i = list.indexOf(v); if (i >= 0) list.splice(i, 1); else list.push(v); render(); }
  if (act === 'nsSave' && ns.form) nsSave();
  if (act === 'nsHoSo' && ns.form) {
    b.disabled = true;
    call('nshoso', { name: ns.form.full || ns.form.name, short: ns.form.name }, 1).then(r => {
      const t = String(r.text || ''), id = ns.form.id = ns.form.id || {};
      const cccd = t.match(/(?:CCCD|CMND|hộ chiếu|passport)[^\d]{0,20}(\d[\d ]{7,14}\d)/i), stk = t.match(/(?:STK|Số TK|tài khoản)[^\d]{0,12}(\d[\d .]{4,24}\d)\s*[-–:,]?\s*([^\n]*)/i), mst = t.match(/MST[^\d]{0,6}(\d{10,14})/i), ns_ = t.match(/(?:sinh)[^\d]{0,6}(\d{1,2})\/(\d{1,2})\/(\d{4})/i);
      if (cccd && !id.cccd) id.cccd = cccd[1].replace(/\s/g, '');
      if (stk && !id.stk) { id.stk = stk[1].replace(/[\s.]/g, ''); if (!id.bank && stk[2]) id.bank = Q.clean(stk[2]).slice(0, 60); }
      if (mst && !id.mst) id.mst = mst[1];
      if (ns_ && !id.ns) id.ns = ns_[3] + '-' + ns_[2].padStart(2, '0') + '-' + ns_[1].padStart(2, '0');
      say(t ? 'Đã lấy từ ' + r.tab + '. Cô xem lại rồi bấm Lưu.' : 'Không thấy dòng của người này trong bảng lương.', t ? '' : 'bad'); render();
    }).catch(err => { say('Chưa lấy được: ' + err.message, 'bad'); b.disabled = false; });
  }
  if (act === 'nsPass') nsDecide(b.dataset.n, true);
  if (act === 'nsFail') nsDecide(b.dataset.n, false);
  if (act === 'nsLap') nsLap();
  if (act === 'nsChot') nsChot();
});
// Điều hành: one more tile, owner only, opening the same kind of window as the others.
const dashTilesBeforeNs = dashTiles;
dashTiles = function (week) {
  const h = dashTilesBeforeNs(week);
  if (!isOwner()) return h;
  const list = ns.rows ? nsActive() : [], due = list.filter(r => r.status === 'Thử việc' && r.trial && r.trial <= Q.addDays(today(), 7)).length, trial = list.filter(r => r.status === 'Thử việc').length;
  const tile = '<button class="dash-tile ' + (due ? 'warn' : 'plain') + '" data-act="panel" data-v="ns"><span class="dash-ico">👥</span><span class="dash-num">' + (ns.rows ? list.length : '') + '</span><span class="dash-name">Nhân sự & lương</span><span class="dash-sub">' +
    (due ? due + ' người sắp hết thử việc' : trial ? trial + ' người đang thử việc' : 'thêm người, đơn giá, bảng lương') + '</span></button>';
  return h.replace(/<\/div>$/, tile + '</div>');
};
const viewManagerBeforeNs = viewManager;
viewManager = function (week) {
  if (panel !== 'ns' || !isOwner()) return viewManagerBeforeNs(week);
  panel = 'tong';
  let base;
  try { base = viewManagerBeforeNs(week); } finally { panel = 'ns'; }
  return base + '<div class="dash-veil" data-act="panel" data-v="tong"></div><div class="dash-modal" role="dialog" aria-label="Nhân sự và lương"><div class="dash-head"><b>👥 Nhân sự & lương</b><span class="spacer"></span><button class="quiet" data-act="panel" data-v="tong" aria-label="Đóng">✕</button></div><div class="dash-body">' + nsPanel() + '</div></div>';
};
const loadPanelBeforeNs = loadPanel;
loadPanel = async function () {
  if (panel === 'ns') { if (isOwner()) await loadNs(); return; }
  await loadPanelBeforeNs();
  if (isOwner() && !ns.rows) loadNs().then(render).catch(() => {});
};

/* Owner 10/11: "bên nhân sự hiện thứ cần được hiện thôi... tham khảo như bên Misa". Two tabs (Hồ sơ nhân viên, Bảng lương), a plain
 * table with search and status filter, and one person's record in sections, one section on screen at a time. */
ns.tab = 'hoso'; ns.filter = 'dang'; ns.q = ''; ns.sec = 'chung';
function nsMainPay(r) {
  const a = r.rate || {}, m = n => nsMoney(n) + ' đ';
  if (r.group === 'GVNN') return a.base ? m(a.base) + ' / ' + (a.baseH || 0) + ' giờ' : a.r ? (a.usd ? a.r + '$' : m(a.r)) + ' / giờ' : '—';
  return a.c ? m(a.c) + ' / tháng' : a.gs ? m(a.gs) + ' / công' : a.dl ? m(a.dl) + ' / công' : a.tg ? m(a.tg) + ' / giờ' : a.ch ? m(a.ch) + ' / bài' : '—';
}
nsPanel = function () {
  if (!isOwner()) return '<div class="card empty">Chỉ cô Trang xem phần này.</div>';
  let h = '<div class="tabs ns-tabs">' + [['hoso', '👤 Hồ sơ nhân viên'], ['luong', '💰 Bảng lương']].map(([k, t]) => '<button class="' + (ns.tab === k ? 'on' : '') + '" data-act="nsTab" data-v="' + k + '">' + t + '</button>').join('') + '</div>';
  if (ns.err) h += '<div class="notice bad">' + esc(ns.err) + '</div>';
  if (ns.msg) h += '<div class="notice">' + esc(ns.msg) + ' <button class="quiet" data-act="nsMsgOff">Đóng</button></div>';
  if (!ns.rows) return h + '<div class="card empty">Đang đọc…</div>';
  if (ns.tab === 'luong') return h + nsPayCard();
  if (ns.form) return h + nsFormHtml();
  const all = [...nsLatest().values()], t = today();
  const due = all.filter(r => r.status === 'Thử việc' && r.trial && r.trial <= Q.addDays(t, 7));
  due.forEach(r => {
    h += '<div class="notice warn ns-due">⏳ <b>' + esc(r.full || r.name) + '</b> ' + esc(nsState(r)[1]) + '. <button class="good" data-act="nsPass" data-n="' + esc(r.name) + '">Đạt, chính thức</button> <button class="low" data-act="nsFail" data-n="' + esc(r.name) + '">Không đạt</button></div>';
  });
  const counts = { dang: all.filter(r => r.status !== 'Đã nghỉ').length, thu: all.filter(r => r.status === 'Thử việc').length, nghi: all.filter(r => r.status === 'Đã nghỉ').length };
  h += '<div class="ns-bar"><input type="search" data-act="nsQ" placeholder="Tìm tên…" value="' + esc(ns.q) + '">' +
    [['dang', 'Đang làm'], ['thu', 'Thử việc'], ['nghi', 'Đã nghỉ']].map(([k, tx]) => '<button class="chip' + (ns.filter === k ? ' on' : '') + '" data-act="nsFilter" data-v="' + k + '">' + tx + ' ' + counts[k] + '</button>').join('') +
    '<span class="spacer"></span><button class="primary" data-act="nsNew">+ Thêm nhân viên</button></div>';
  const q = Q.key(ns.q || '');
  const list = all.filter(r => ns.filter === 'nghi' ? r.status === 'Đã nghỉ' : ns.filter === 'thu' ? r.status === 'Thử việc' : r.status !== 'Đã nghỉ')
    .filter(r => !q || Q.key(r.full + ' ' + r.name + ' ' + r.pos).includes(q))
    .sort((a, b) => a.group.localeCompare(b.group) || (a.full || a.name).localeCompare(b.full || b.name, 'vi'));
  if (!list.length) return h + '<div class="card empty">Không có ai.</div>';
  h += '<div class="card table ns-table"><table><thead><tr><th>Họ tên</th><th>Vị trí</th><th>Trạng thái</th><th>Hợp đồng</th><th class="num">Lương chính</th></tr></thead><tbody>' +
    list.map(r => { const [tone, text] = nsState(r); return '<tr data-act="nsEdit" data-n="' + esc(r.name) + '"><td><b>' + esc(r.full || r.name) + '</b><div class="small muted">' + esc(r.name) + (r.group === 'GVNN' ? ' · nước ngoài' : '') + '</div></td><td>' + esc(r.pos || '') + '</td><td><span class="tag ' + tone + '">' + esc(text) + '</span></td><td>' + nsContract(r) + '</td><td class="num">' + esc(nsMainPay(r)) + '</td></tr>'; }).join('') +
    '</tbody></table></div>';
  return h;
};
const nsFormHtmlFull = nsFormHtml;
// The full form split at its section headings; only the chosen section shows, the save bar always does.
nsFormHtml = function () {
  const full = nsFormHtmlFull(), f = ns.form;
  const start = full.indexOf('<div class="form-grid">'), endBtns = full.lastIndexOf('<p class="small muted">Thử việc:');
  const head = '<div class="card ns-form"><div class="row-top"><button class="quiet" data-act="nsCancel">‹ Danh sách</button><b>' + (f.isNew ? 'Thêm nhân viên mới' : esc(f.full || f.name)) + '</b>' + (f.isNew ? '' : '<span class="tag ' + nsState(Object.assign({ pct: 100 }, f))[0] + '">' + esc(f.status) + '</span>') + '</div>';
  const body = full.slice(start, endBtns), parts = body.split(/<h4>/), first = parts[0], rest = {};
  parts.slice(1).forEach(p => { const i = p.indexOf('</h4>'); rest[p.slice(0, i)] = p.slice(i + 5); });
  const tail = rest['Hồ sơ (chỉ cô thấy; in vào cột họ tên của bảng lương)'] || '';
  const noteAt = tail.indexOf('<div class="form-grid"><label>Ghi chú');
  const secs = { chung: first + (noteAt >= 0 ? tail.slice(noteAt) : ''), luong: rest['Lương'] || '', bh: rest['Bảo hiểm và thuế'] || '', hoso: noteAt >= 0 ? tail.slice(0, noteAt) : tail };
  const names = [['chung', 'Thông tin chung'], ['luong', 'Lương'], ['bh', 'Bảo hiểm & thuế'], ['hoso', 'CCCD & ngân hàng']];
  if (!secs[ns.sec]) ns.sec = 'chung';
  return head + '<div class="tabs ns-sec">' + names.map(([k, t]) => '<button class="' + (ns.sec === k ? 'on' : '') + '" data-act="nsSec" data-v="' + k + '">' + t + '</button>').join('') + '</div>' +
    '<div class="ns-sec-body">' + secs[ns.sec] + '</div>' +
    (ns.sec === 'chung' ? '<p class="small muted">Thử việc tối đa 60 ngày (việc cần cao đẳng trở lên), 30 ngày (trung cấp), 6 ngày làm việc (việc khác); lương thử việc ít nhất 85%; hết thử việc phải báo kết quả.</p>' : '') +
    '<div class="ns-save"><button class="primary" data-act="nsSave"' + (ns.busy ? ' disabled' : '') + '>' + (ns.busy === 'save' ? 'Đang lưu…' : 'Lưu') + '</button><button class="quiet" data-act="nsCancel">Huỷ</button></div></div>';
};
document.addEventListener('click', e => {
  const b = e.target.closest && e.target.closest('[data-act]');
  if (!b) return;
  const act = b.dataset.act;
  if (act === 'nsTab') { ns.tab = b.dataset.v; ns.form = null; render(); }
  if (act === 'nsFilter') { ns.filter = b.dataset.v; render(); }
  if (act === 'nsSec') { ns.sec = b.dataset.v; render(); }
  if (act === 'nsMsgOff') { ns.msg = ''; render(); }
  if (act === 'nsNew' || act === 'nsEdit') ns.sec = 'chung';
}, true);
// render() waits while a box has focus, so the search hides rows in place.
document.addEventListener('input', e => { const b = e.target; if (!(b && b.dataset && b.dataset.act === 'nsQ')) return; ns.q = b.value; const q = Q.key(b.value); document.querySelectorAll('.ns-table tr[data-n]').forEach(tr => { tr.style.display = !q || Q.key(tr.textContent).includes(q) ? '' : 'none'; }); });

/* ---------- Owner 10/11: contracts by year and the app link, inside each staff record ----------
 * "Ngày vào làm" is the first day at the centre and never moves; every signing (a new one-year contract from 1/10, say)
 * is one more HOP_DONG row. Law kept in view: a fixed-term contract is at most 36 months and may be signed again only once,
 * the next must be open-ended (Điều 20 BLLĐ 2019); a foreign teacher's term follows the work permit, at most 2 years (Điều 151). */
ns.hdf = null; ns.newLink = null;
const NS_TERMS = [['12', '1 năm'], ['24', '2 năm'], ['36', '3 năm'], ['0', 'Không thời hạn'], ['date', 'Đến ngày…']];
const nsLinkOf = name => nguoi && (nguoi.people || []).find(p => Q.key(p.name) === Q.key(name) && !/chủ/i.test(p.role || ''));
const nsHasLink = name => !!nsLinkOf(name);
const nsHdList = name => (ns.hd || []).filter(x => Q.key(x.person) === Q.key(name) && x.status !== 'Đã xoá').sort((a, b) => String(a.start).localeCompare(String(b.start)));
const nsFixedTerm = t => /xác định thời hạn\)/.test(t) && !/không xác định/.test(t);
function nsHdBlank(f) {
  const list = nsHdList(f.name), last = list[list.length - 1];
  const start = last && last.end ? Q.addDays(last.end, 1) : '';
  const d = { type: f.group === 'GVNN' ? 'Giáo viên nước ngoài' : 'Toàn thời gian (xác định thời hạn)', term: '12', start, end: '', no: '', signed: '', note: '' };
  nsHdEnd(d);
  return d;
}
function nsHdEnd(d) {
  if (d.term === '0') d.end = '';
  else if (d.term !== 'date' && d.start) d.end = Q.addDays(nsAddMonths(d.start, Number(d.term)), -1);
}
function nsHdWarn(f, d) {
  const prior = nsHdList(f.name).filter(x => nsFixedTerm(x.type) && x.start < (d.start || '9999'));
  const out = [];
  if (nsFixedTerm(d.type) && d.term !== '0' && prior.length >= 2) out.push(['bad', 'Đã ký ' + prior.length + ' hợp đồng xác định thời hạn. Luật chỉ cho ký xác định thời hạn thêm 1 lần; lần này phải là hợp đồng không xác định thời hạn (Điều 20 khoản 2 BLLĐ 2019).']);
  else if (nsFixedTerm(d.type) && d.term !== '0' && prior.length === 1) out.push(['warn', 'Đây là lần ký xác định thời hạn thứ 2. Hết hợp đồng này mà vẫn làm tiếp thì lần sau phải ký không xác định thời hạn.']);
  if (d.end && d.start && d.end > Q.addDays(d.start, 36 * 31)) out.push(['bad', 'Hợp đồng xác định thời hạn không quá 36 tháng.']);
  if (d.type === 'Giáo viên nước ngoài') out.push(['', 'Giáo viên nước ngoài: thời hạn không dài hơn giấy phép lao động (tối đa 2 năm). Ghi số giấy phép vào ô Ghi chú.']);
  return out;
}
function nsHdHtml(f) {
  if (f.isNew) return '<p class="small">Người mới: khi bấm Lưu, app ghi hợp đồng thử việc (nếu chọn) và tạo link app theo lựa chọn ở mục Thông tin chung. Lưu xong mở lại hồ sơ để ký hợp đồng chính thức ở đây.</p>';
  const d = ns.hdf = ns.hdf || nsHdBlank(f), list = nsHdList(f.name), t = today();
  const inp = (k, label, v, extra) => '<label>' + label + '<input data-act="nsH" data-k="' + k + '" value="' + esc(v || '') + '"' + (extra || '') + '></label>';
  let h = '<p class="small muted">Ngày vào làm (' + (f.start ? viDate(f.start) : 'chưa ghi') + ') là ngày bắt đầu làm ở trung tâm, giữ nguyên khi ký lại. Mỗi lần ký hợp đồng mới (VD: hợp đồng năm mới từ 1/10) thêm một dòng ở đây.</p>';
  h += list.length ? '<div class="card table"><table><thead><tr><th>Loại</th><th>Từ</th><th>Đến</th><th>Số HĐ</th><th></th></tr></thead><tbody>' + list.map(x => {
    const tone = x.end && x.end < t ? ['bad', 'Hết hạn'] : x.start > t ? ['', 'Chưa bắt đầu'] : x.end && x.end <= Q.addDays(t, 30) ? ['warn', 'Sắp hết'] : ['ok', 'Đang hiệu lực'];
    return '<tr><td>' + esc(x.type) + (x.note ? '<div class="small muted">' + esc(x.note) + '</div>' : '') + '</td><td>' + esc(viDate(x.start)) + '</td><td>' + (x.end ? esc(viDate(x.end)) : 'Không thời hạn') + '</td><td>' + esc(x.no || '') + '</td><td><span class="tag ' + tone[0] + '">' + tone[1] + '</span></td></tr>';
  }).join('') + '</tbody></table></div>' : '<div class="notice">Chưa ghi hợp đồng nào cho ' + esc(f.full || f.name) + '.</div>';
  h += '<h4>' + (list.length ? 'Ký hợp đồng mới / gia hạn' : 'Ghi hợp đồng đang có') + '</h4><div class="form-grid">' +
    '<label>Loại<select data-act="nsH" data-k="type">' + CONTRACT_TYPES.map(x => '<option' + (d.type === x ? ' selected' : '') + '>' + esc(x) + '</option>').join('') + '</select></label>' +
    '<label>Thời hạn<select data-act="nsH" data-k="term">' + NS_TERMS.map(([v, tx]) => '<option value="' + v + '"' + (d.term === v ? ' selected' : '') + '>' + tx + '</option>').join('') + '</select></label>' +
    inp('start', 'Hiệu lực từ ngày', d.start, ' type="date"') +
    (d.term === '0' ? '' : inp('end', 'Đến hết ngày', d.end, ' type="date"' + (d.term === 'date' ? '' : ' readonly'))) +
    inp('no', 'Số hợp đồng', d.no, ' placeholder="VD: 12/2026/HĐLĐ"') + inp('signed', 'Ngày ký', d.signed, ' type="date"') +
    inp('note', 'Ghi chú (lương ghi trong HĐ, giấy phép LĐ…)', d.note) + '</div>';
  h += nsHdWarn(f, d).map(([tone, tx]) => '<div class="notice ' + tone + '">' + esc(tx) + '</div>').join('');
  h += '<div class="choices"><button class="good" data-act="nsHSave"' + (ns.busy ? ' disabled' : '') + '>' + (ns.busy === 'hd' ? 'Đang lưu…' : 'Lưu hợp đồng') + '</button></div>';
  h += '<h4>Link app</h4>';
  const lk = nsLinkOf(f.name);
  if (ns.newLink && ns.newLink.name === f.name) h += '<div class="notice ok">Link của ' + esc(f.name) + ' chỉ hiện lần này. Gửi riêng cho người đó, đừng dán vào nhóm.<p style="word-break:break-all;user-select:all">' + esc(ns.newLink.link) + '</p><button class="primary" data-act="nsLinkCopy">Copy link</button></div>';
  else if (!nguoi) h += '<p class="small muted">Đang đọc danh sách link…</p>';
  else if (lk) h += '<p><span class="tag ok">Có link app</span> vai trò ' + esc(lk.role) + '. Phiếu lương và công của ' + esc(f.name) + ' hiện trong app của họ.</p>';
  else h += '<p><span class="tag bad">Chưa có link app</span> ' + esc(f.name) + ' chưa xem được phiếu lương, chưa chấm công trên app.</p><div class="choices">' + [['GV', 'Tạo link GV'], ['TA', 'Tạo link TA'], ['Quản lí', 'Tạo link Quản lí']].map(([v, tx]) => '<button class="quiet" data-act="nsLink" data-v="' + v + '"' + (ns.busy ? ' disabled' : '') + '>' + tx + '</button>').join('') + '</div>';
  return h;
}
async function nsHSave() {
  const f = ns.form, d = ns.hdf; if (!f || !d) return;
  if (!d.start) return say('Chọn ngày hiệu lực.', 'bad');
  if (d.term !== '0' && !d.end) return say('Chọn ngày hết hạn.', 'bad');
  if (d.end && d.end < d.start) return say('Ngày hết hạn phải sau ngày hiệu lực.', 'bad');
  if (d.end && d.end > Q.addDays(d.start, 36 * 31)) return say('Hợp đồng xác định thời hạn không quá 36 tháng.', 'bad');
  const type = d.term === '0' && nsFixedTerm(d.type) ? 'Toàn thời gian (không xác định thời hạn)' : d.type;
  const row = [stamp(), f.name, type, Q.clean(d.no || ''), d.signed || '', d.start, d.term === '0' ? '' : d.end, '', Q.clean(d.note || ''), 'Hiệu lực', me.name];
  ns.busy = 'hd'; render();
  try { await appendRows(CONFIG.quanLiId, 'HOP_DONG', [row]); ns.hd.push(hdRow(row)); hd.rows = ns.hd; ns.hdf = null; say('Đã lưu hợp đồng của ' + (f.full || f.name) + ': ' + viDate(row[5]) + (row[6] ? ' – ' + viDate(row[6]) : ', không thời hạn') + '.'); }
  catch (e) { say('Chưa lưu được: ' + e.message, 'bad'); }
  finally { ns.busy = ''; render(); }
}
async function nsLinkMake(role) {
  const f = ns.form; if (!f) return;
  if (!window.confirm('Tạo link app vai trò ' + role + ' cho ' + f.name + '? Ai có link là vào được với tên này.')) return;
  ns.busy = 'link'; render();
  try { const r = await call('them', { name: f.name, role }); ns.newLink = { name: f.name, link: location.origin + location.pathname + '#k=' + r.key }; nguoiMoi = { name: r.name, link: ns.newLink.link }; nguoi = await call('nguoi', {}); }
  catch (e) { say('Chưa tạo được link: ' + e.message, 'bad'); }
  finally { ns.busy = ''; render(); }
}
const nsFormHtmlSec = nsFormHtml;
nsFormHtml = function () {
  const f = ns.form, onHd = ns.sec === 'hd';
  if (onHd) ns.sec = 'chung';
  let h = nsFormHtmlSec();
  if (onHd) {
    ns.sec = 'hd';
    const a = h.indexOf('<div class="ns-sec-body">'), b = h.indexOf('<div class="ns-save">');
    if (a >= 0 && b > a) h = h.slice(0, a) + '<div class="ns-sec-body">' + nsHdHtml(f) + '</div></div>';
    h = h.replace('<button class="on" data-act="nsSec" data-v="chung">', '<button class="" data-act="nsSec" data-v="chung">');
  }
  const tab = '<button class="' + (onHd ? 'on' : '') + '" data-act="nsSec" data-v="hd">Hợp đồng &amp; link app</button>';
  return h.replace(/(<button class="[^"]*" data-act="nsSec" data-v="hoso">[^<]*<\/button>)/, '$1' + tab);
};
// The staff table shows who has no app link, so the owner sees it before payroll day.
const nsPanelLink = nsPanel;
nsPanel = function () {
  if (isOwner() && !nguoi && !ns.nguoiAsked) { ns.nguoiAsked = true; call('nguoi', {}).then(r => { nguoi = r; render(); }).catch(() => { ns.nguoiAsked = false; }); }
  let h = nsPanelLink();
  if (nguoi && !ns.form && ns.tab !== 'luong') h = h.replace(/<tr data-act="nsEdit" data-n="([^"]*)"><td><b>([^<]*)<\/b>/g, (m, n) => nsHasLink(n.replace(/&amp;/g, '&')) ? m : m + ' <span class="tag bad">Chưa có link app</span>');
  return h;
};
document.addEventListener('click', e => {
  const b = e.target.closest && e.target.closest('[data-act]');
  if (!b || b.tagName === 'SELECT' || b.tagName === 'INPUT') return;
  const act = b.dataset.act;
  if (act === 'nsNew' || act === 'nsEdit') { ns.hdf = null; ns.newLink = null; }
  if (act === 'nsHSave') nsHSave();
  if (act === 'nsLink') nsLinkMake(b.dataset.v);
  if (act === 'nsLinkCopy' && ns.newLink) navigator.clipboard.writeText(ns.newLink.link).then(() => { b.textContent = 'Đã copy'; }).catch(() => {});
}, true);
const nsHField = (b, redraw) => {
  if (!(b && b.dataset && b.dataset.act === 'nsH') || !ns.form) return;
  const d = ns.hdf = ns.hdf || nsHdBlank(ns.form), k = b.dataset.k;
  d[k] = b.value;
  if (k === 'type' && d.type === 'Toàn thời gian (không xác định thời hạn)') d.term = '0';
  if (k === 'term' || k === 'start' || k === 'type') nsHdEnd(d);
  if (redraw && ['type', 'term', 'start'].includes(k)) render();
};
document.addEventListener('input', e => nsHField(e.target, false));
document.addEventListener('change', e => nsHField(e.target, true));

/* ---------- Owner 10/11: dollar rate read live at each run, and the draft keeps itself up to date ----------
 * Each Lập reads Vietcombank's board at that moment (mua chuyển khoản by default) and writes it over the old draft's rate;
 * "Cố định" keeps the number the owner types. Counts are re-read every run. Opening the payroll (Nhân sự › Bảng lương or the
 * Lương page) re-lays an unclosed draft from 11/2026 on by itself when the last run is over 20 minutes old.
 * October 2026 was finished by hand, so it is never re-laid by itself and a manual Lập asks first. */
const NS_FX_MODES = [['transfer', 'Vietcombank mua chuyển khoản lúc lập (theo quy định thuế)'], ['sell', 'Vietcombank bán ra lúc lập'], ['fixed', 'Cố định, số cô nhập']];
const NS_AUTO_FROM = '2026-11';
ns.fxInfo = null; ns.auto = '';
const nsFxMode = () => ns.fxMode || saved.get('nsFxMode') || 'transfer';
const nsDefaultMonth = () => { const t = today(); return Number(t.slice(8)) <= 10 ? Q.addDays(t.slice(0, 7) + '-01', -1).slice(0, 7) : t.slice(0, 7); };
const nsLastRun = m => { try { return JSON.parse(saved.get('nsRun_' + m) || 'null'); } catch (e) { return null; } };
nsPayCard = function () {
  if (!ns.month) ns.month = nsDefaultMonth();
  const m = ns.month, mode = nsFxMode(), last = nsLastRun(m), fi = ns.fxInfo;
  let h = '<div class="card ns-pay"><h3>💰 Bảng lương tháng</h3><div class="form-grid">' +
    '<label>Tháng<input type="month" data-act="nsF0" data-k="month" value="' + esc(m) + '"></label>' +
    '<label>Tỷ giá $ (GV tính lương bằng $)<select data-act="nsFxMode">' + NS_FX_MODES.map(([v, t]) => '<option value="' + v + '"' + (mode === v ? ' selected' : '') + '>' + t + '</option>').join('') + '</select></label>' +
    (mode === 'fixed' ? '<label>Tỷ giá cố định (đ/$)<input data-act="nsF0" data-k="fx" inputmode="numeric" value="' + esc(ns.fx || (saved.get('nsFx') || '')) + '"></label>' : '') + '</div>';
  if (fi) h += '<p class="small">Vietcombank lúc ' + esc(fi.at) + ': mua chuyển khoản <b>' + nsMoney(fi.transfer) + '</b> · bán ra <b>' + nsMoney(fi.sell) + '</b> đ/$.</p>';
  if (ns.auto) h += '<div class="notice">⏳ ' + esc(ns.auto) + '</div>';
  if (last) h += '<p class="small muted">Bảng nháp ' + esc(monthName(m)) + ' cập nhật lần cuối ' + esc(last.at) + (last.fx ? ', tỷ giá ' + nsMoney(last.fx) + ' đ/$' + (last.src ? ' (' + esc(last.src) + ')' : '') : '') + '.</p>';
  h += '<p class="small muted">1. Bấm Lập: app đếm lại công từ Schedule và bảng chấm bài đến lúc bấm, lấy tỷ giá ngay lúc đó, ghi thành tab nháp. Ô cô đã nhập (thưởng, trừ khác, tạm ứng) được giữ. ' +
    (m >= NS_AUTO_FROM ? 'Mở phần này hoặc trang Lương, app tự cập nhật nếu lần trước đã quá 20 phút. ' : '') +
    '2. Mở trang Lương: xem từng người. 3. Bấm Chốt: số công và tỷ giá đứng yên, nhân viên thấy lương của mình từ ngày 8.</p>' +
    '<div class="choices"><button class="primary" data-act="nsLap"' + (ns.busy ? ' disabled' : '') + '>' + (ns.busy === 'lap' ? 'Đang lập…' : 'Lập / cập nhật bảng nháp') + '</button>' +
    '<button data-act="view" data-v="luong">Mở trang Lương</button><button class="good" data-act="nsChot"' + (ns.busy ? ' disabled' : '') + '>Chốt bảng ' + esc(monthName(m)) + '</button></div></div>';
  return h;
};
nsLap = async function (auto) {
  const month = ns.month || nsDefaultMonth(), mode = nsFxMode();
  if (!ns.rows || ns.busy) return;
  if (!auto && month < NS_AUTO_FROM && !window.confirm('Bảng ' + monthName(month) + ' cô đã sửa tay trong file. Lập lại sẽ viết lại các ô công thức và số công (ô cô nhập được giữ). Vẫn lập lại?')) return;
  ns.busy = 'lap'; if (!auto) ns.msg = ''; ns.auto = auto ? 'Đang tự cập nhật công và tỷ giá của ' + monthName(month) + '…' : ''; render();
  try {
    let fx, src = '';
    if (mode === 'fixed') { fx = nsNum(ns.fx || saved.get('nsFx') || ''); if (!fx) throw Error('Nhập tỷ giá cố định trước.'); src = 'cố định'; }
    else { ns.fxInfo = ns.fxPreset || await nsReadFx(); ns.fxPreset = null; const lastFx = nsLastRun(month); if (!ns.fxInfo && !(auto && lastFx && lastFx.fx)) throw Error('Chưa đọc được tỷ giá Vietcombank. Thử lại sau ít phút, hoặc chọn Cố định và nhập tay.'); fx = ns.fxInfo ? ns.fxInfo[mode] : lastFx.fx; src = ns.fxInfo ? 'Vietcombank ' + (mode === 'sell' ? 'bán ra' : 'mua CK') + ' ' + ns.fxInfo.at : 'giữ tỷ giá lần trước, chưa đọc được Vietcombank'; }
    const pd = await loadPay(month, true);
    const built = nsBuild(month, nsActive().concat([...nsLatest().values()].filter(r => r.status === 'Đã nghỉ' && r.rate.het && r.rate.het >= month + '-01')), pd, fx);
    const done = [];
    for (const g of Object.keys(built)) {
      const b = built[g], r = await call('luonglap', { group: g, month, grid: b.grid, layout: b.layout, people: b.people, fxAuto: mode !== 'fixed' ? 1 : '' }, 1);
      done.push(r.tab + ': ' + r.rows + ' người' + (r.kept ? ', giữ ' + r.kept + ' ô cô đã nhập' : '') + (r.fresh.length ? '; người mới chưa có CCCD, STK: ' + r.fresh.join(', ') : '') + (b.layout.missing.length ? '; ' + b.layout.missing.length + ' ô cam cần xem' : ''));
    }
    if (mode === 'fixed') keep('nsFx', String(fx));
    keep('nsRun_' + month, JSON.stringify({ at: Q.clean(stamp()), t: Date.now(), fx, src }));
    pay.all = null;
    if (!auto) ns.msg = done.length ? 'Đã lập ' + done.join(' · ') + '. Tỷ giá ' + nsMoney(fx) + ' đ/$ (' + src + '). Mở trang Lương để xem từng người.' : 'Không có ai để lập lương tháng này.';
  } catch (e) { if (!auto) { ns.msg = ''; say('Chưa lập được: ' + e.message, 'bad'); } else if (!/đã chốt/i.test(e.message)) say('Chưa tự cập nhật được bảng lương: ' + e.message, 'bad'); else keep('nsRun_' + month, JSON.stringify({ at: 'đã chốt', t: Date.now() + 864e5 * 365 })); }
  finally { ns.busy = ''; ns.auto = ''; render(); }
};
// Re-lays the draft when the payroll is opened and the last run is stale. Never for October 2026 or a future month.
async function nsAutoLap(month) {
  if (!isOwner() || ns.busy || !month || month < NS_AUTO_FROM || month > today().slice(0, 7)) return false;
  const last = nsLastRun(month);
  if (last && Date.now() - (last.t || 0) < 20 * 60e3) return false;
  if (!ns.rows) await loadNs();
  ns.month = month;
  await nsLap(true);
  return true;
}
document.addEventListener('click', e => {
  const b = e.target.closest && e.target.closest('[data-act]');
  if (!b || b.tagName === 'SELECT' || b.tagName === 'INPUT') return;
  if (b.dataset.act === 'nsTab' && b.dataset.v === 'luong') setTimeout(() => nsAutoLap(ns.month || nsDefaultMonth()).catch(() => {}), 0);
  if (b.dataset.act === 'view' && b.dataset.v === 'luong' && isOwner()) setTimeout(() => nsAutoLap(pay.month || nsDefaultMonth()).then(ran => { if (ran) loadLuong(true); }).catch(() => {}), 0);
});
document.addEventListener('change', e => {
  const b = e.target;
  if (b && b.dataset && b.dataset.act === 'nsFxMode') { ns.fxMode = b.value; keep('nsFxMode', b.value); render(); }
});

// Vietcombank answers this page directly (it allows this site), which is quicker than going through the Google server; the server read is the fallback.
async function nsReadFx() {
  try {
    const ctl = new AbortController(), timer = setTimeout(() => ctl.abort(), 12000);
    const r = await fetch('https://www.vietcombank.com.vn/api/exchangerates?date=' + today(), { signal: ctl.signal });
    clearTimeout(timer);
    const j = await r.json(), u = (j.Data || []).find(d => d.currencyCode === 'USD'), n = v => Math.round(Number(String(v).replace(/,/g, '')));
    if (u && n(u.transfer) > 1000) { const d = new Date(); return { cash: n(u.cash), transfer: n(u.transfer), sell: n(u.sell), source: 'Vietcombank', at: String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0') + ' ' + viDate(today()) }; }
  } catch (e) {}
  return null;
}

/* ---------- Owner 10/11: "thao tác chưa nuột... kéo lên kéo xuống, trái phải nó tràn, xô lệch... nút lưu ở bảng lương... nhân sự
 * không nhanh nuột" ----------
 * - A redraw keeps the open panel's scroll position, the page scroll and the box that had focus (a dropdown in the staff form
 *   used to send the panel back to the top and drop focus).
 * - Draft payroll cells: Enter saves, the box itself shows "đang lưu / đã lưu", nothing pops in at the top of the page, and the
 *   total is read again once in the background. */
const paintMainBeforeKeep = paintMain;
const keepSel = el => {
  if (!el || !el.dataset || !el.dataset.act) return '';
  return ['act', 'k', 'v', 'n', 'tab', 'row', 'col'].filter(k => el.dataset[k] != null).map(k => '[data-' + k + '="' + CSS.escape(el.dataset[k]) + '"]').join('');
};
paintMain = function (h) {
  const main = $('main');
  if (main._html === h) return;
  const box = main.querySelector('.dash-modal'), body = box && box.querySelector('.dash-body'), label = box && box.getAttribute('aria-label'), top = body ? body.scrollTop : 0;
  const a = document.activeElement, sel = a && main.contains(a) ? keepSel(a) : '', y = window.scrollY;
  paintMainBeforeKeep(h);
  const now = main.querySelector('.dash-modal'), nb = now && now.querySelector('.dash-body');
  if (nb && box && now.getAttribute('aria-label') === label && !keepTop) nb.scrollTop = top;
  keepTop = false;
  if (Math.abs(window.scrollY - y) > 1) window.scrollTo(0, y);
  if (sel) { const el = main.querySelector(sel); if (el && el !== document.activeElement) try { el.focus({ preventScroll: true }); } catch (e) {} }
};
let keepTop = false;
// After saving or leaving a staff record the list starts from the top, where the "Đã lưu" line is.
document.addEventListener('click', e => {
  const b = e.target.closest && e.target.closest('[data-act]');
  if (b && ['nsCancel', 'nsTab', 'nsNew', 'nsEdit', 'nsSec'].includes(b.dataset.act)) keepTop = true;
}, true);
const nsSaveBeforeTop = nsSave;
nsSave = async function () { await nsSaveBeforeTop.apply(this, arguments); if (!ns.form) { keepTop = true; render(); } };
// Draft payroll cells.
document.addEventListener('keydown', e => {
  const b = e.target;
  if (e.key === 'Enter' && b && b.dataset && b.dataset.act === 'nsCell') { e.preventDefault(); b.blur(); }
}, true);
document.addEventListener('change', async e => {
  const b = e.target;
  if (!b || !b.dataset || b.dataset.act !== 'nsCell') return;
  e.stopImmediatePropagation();
  b.classList.remove('ns-ok', 'ns-err'); b.classList.add('ns-busy'); b.readOnly = true;
  const tip = b.parentElement && b.parentElement.querySelector('.ns-st') || (() => { const s = document.createElement('small'); s.className = 'ns-st'; b.after(s); return s; })();
  tip.textContent = 'Đang lưu…';
  try {
    await call('luongo', { tab: b.dataset.tab, row: Number(b.dataset.row), col: Number(b.dataset.col), value: b.value }, 1);
    b.classList.add('ns-ok'); tip.textContent = '✓ Đã lưu';
    clearTimeout(nsCellReload); nsCellReload = setTimeout(() => loadLuong(true).then(render).catch(() => {}), 900);
  } catch (err) { b.classList.add('ns-err'); tip.textContent = 'Chưa lưu được: ' + err.message; }
  finally { b.classList.remove('ns-busy'); b.readOnly = false; }
}, true);
let nsCellReload = 0;

/* ---------- Owner 10/11: "không được phép không kịp, tự động và chính xác" ----------
 * The rate is the Vietcombank board in force at the moment of the run: today's newest board, or, before the bank posts today's
 * (early morning, Sunday, holidays), the last board it posted. Network trouble is retried; an old run's rate is never reused.
 * An automatic run that still cannot read the board tries again by itself every 2 minutes and says so on screen. */
nsReadFx = async function () {
  const n = v => Math.round(Number(String(v).replace(/,/g, '')));
  const board = async day => {
    const ctl = new AbortController(), timer = setTimeout(() => ctl.abort(), 10000);
    try {
      const r = await fetch('https://www.vietcombank.com.vn/api/exchangerates?date=' + day, { signal: ctl.signal, cache: 'no-store' });
      if (!r.ok) throw Error('HTTP ' + r.status);
      const j = await r.json(), u = (j.Data || []).find(d => d.currencyCode === 'USD');
      if (!u || !(n(u.transfer) > 1000)) return null;
      const m = String(j.UpdatedDate || '').match(/^(\d{4})-(\d\d)-(\d\d)T(\d\d):(\d\d)/);
      return { cash: n(u.cash), transfer: n(u.transfer), sell: n(u.sell), source: 'Vietcombank', at: m ? m[4] + ':' + m[5] + ' ' + m[3] + '/' + m[2] + '/' + m[1] : viDate(day) };
    } finally { clearTimeout(timer); }
  };
  let last = null;
  for (let attempt = 0; attempt < 4; attempt++) {
    if (attempt) await new Promise(r => setTimeout(r, 2000 * attempt));
    try {
      for (let back = 0; back < 10; back++) { const got = await board(Q.addDays(today(), -back)); if (got) return got; }
      last = Error('Vietcombank chưa có bảng giá 10 ngày gần đây.');
    } catch (e) { last = e; }
  }
  throw Error('Chưa đọc được tỷ giá Vietcombank (' + (last ? last.message : 'không rõ') + ').');
};
const nsLapSure = nsLap;
nsLap = async function (auto) {
  const month = ns.month || nsDefaultMonth(), mode = nsFxMode();
  if (mode !== 'fixed') {
    try { ns.fxInfo = await nsReadFx(); }
    catch (e) {
      if (!auto) return say(e.message + ' Kiểm tra mạng rồi bấm Lập lại.', 'bad');
      ns.auto = e.message + ' App tự thử lại sau 2 phút.'; render();
      clearTimeout(ns.autoRetry); ns.autoRetry = setTimeout(() => { ns.auto = ''; nsAutoLap(month).catch(() => {}); }, 120000);
      return;
    }
  }
  ns.fxPreset = ns.fxInfo;
  return nsLapSure(auto);
};

// Owner 10/11: a pupil making up work outside the room is still at the centre, so no parent message job; only "Cho về" has one.
/* ---------- Owner 10/11: IELTS lessons in the sheet ----------
 * The app only knew the KIDS header ("Buổi học ngày …"), so on IELTS sheets it found no lesson: absences and the close
 * comments were never written there. IELTS headers are read as they are: row 1 the skill (Speaking / Writing), row 2
 * "Buổi học số N / date(s)", row 3 "Nhận xét Buổi học" (where absences and reminders go) and "Nhận xét Bài tập về nhà".
 * A session finds its block by skill and lesson number; groups .1 / .2 share one block ("05-06/11/2026"). Test blocks are
 * found but never written by the close. */
function ieltsBlocks(head) {
  const rows = head || [], width = Math.max(0, ...rows.map(r => (r || []).length)), at = (r, c) => String((rows[r] || [])[c] || ''), out = [];
  if (rows.length < 3) return out;
  let area = '';
  const starts = [];
  for (let c = 0; c < width; c++) {
    const r1 = Q.key(at(0, c));
    if (r1) area = /SPEAKING|KI NANG NOI/.test(r1) ? 'NOI' : /WRITING|KI NANG VIET/.test(r1) ? 'VIET' : '';
    const k = Q.key(at(1, c)), m = k.match(/^BUOI (?:HOC )?SO\s*0*(\d+)/);
    if (area && m) starts.push({ col: c, area, lesson: m[1], test: /KIEM TRA/.test(k), text: at(1, c) });
    else if (r1 && starts.length && !starts[starts.length - 1].end) starts[starts.length - 1].end = c;
  }
  starts.forEach((s, n) => {
    const end = Math.min(s.end || width, n + 1 < starts.length ? starts[n + 1].col : width), dates = [];
    const re = /(\d{1,2})(?:\s*-\s*(\d{1,2}))?\/(\d{1,2})\/(20\d{2})/g;
    for (let m; (m = re.exec(s.text));) { [m[1], m[2]].filter(Boolean).forEach(d => { const iso = Q.dateIn(d + '/' + m[3] + '/' + m[4]); if (iso) dates.push(iso); }); }
    let comment = -1, hw = -1;
    for (let c = s.col; c < end; c++) { const t = Q.key(at(2, c)); if (t === 'NHAN XET BUOI HOC' && comment < 0) comment = c; if (t === 'NHAN XET BAI TAP VE NHA' && hw < 0) hw = c; }
    out.push({ col: s.col, date: dates[0] || '', dates, head: Q.clean(s.text), videos: [], grade: -1, stars: -1, comment: s.test ? -1 : comment, nx: comment, homework: hw, lesson: s.lesson, topic: '', skill: s.area, test: s.test });
  });
  return out;
}
const trackerBlocksKids = Q.trackerBlocks;
Q.trackerBlocks = function (head, year) { const kids = trackerBlocksKids(head, year); return kids.length ? kids : ieltsBlocks(head); };
const findBlockKids = Q.findBlock;
Q.findBlock = function (blocks, session) {
  if (!blocks.some(b => b.skill)) return findBlockKids(blocks, session);
  const bk = Q.key(session.book || ''), skill = /SPEAKING/.test(bk) ? 'NOI' : /VIET|WRITING/.test(bk) ? 'VIET' : '';
  const num = x => String(x == null ? '' : x).trim().replace(/^0+(?=\d)/, ''), want = num(session.lesson);
  const hit = blocks.find(b => (!skill || b.skill === skill) && num(b.lesson) === want);
  if (!hit) return { block: null, problem: 'thieu' };
  if (hit.dates.length && !hit.dates.includes(session.day)) return { block: hit, problem: 'ngay' };
  return { block: hit, problem: '' };
};

/* ---------- Owner 10/11: arrival time by contract, not by the earliest class with one's name ----------
 * "THUY TRANG, VAN SON, MY LINH là 3h30 phải có mặt, trừ ngày nghỉ... mấy ca tutor không cần check in, chỉ tick dạy xong...
 * THU HIEN là TA part-time nên là 5h". Before, the due time was the earliest session naming the person, tutor sessions and the
 * homeroom column (CM/TA) included: Thùy Trang was "316 minutes late" on Saturday 07/11 because of a morning tutor class, and
 * Thu Hiền, homeroom of every IELTS/FIGHTER class, was due at 09:20 on Sunday.
 * - Full-time staff: Mon-Fri 15:30; weekends keep the rota rule of 07/11 (morning 8:45, Saturday afternoon 14:30, Sunday
 *   afternoon 13:30). Their own classes and tutor sessions never move it; a day listed under "Nghỉ" in the rota has no due time.
 * - Part-time TAs: the shift written beside their name in the rota, else 17:00 on weekdays (weekends by the rota rule); only a
 *   class they teach or assist in the room (columns E and F) can make it earlier, never the homeroom column G.
 * - Everyone else (teachers) as before: 10 minutes before their first class. */
const FULL_TIME_STAFF = ['THUY TRANG', 'VAN SON', 'MY LINH'], FULL_DUE = 15 * 60 + 30, PART_DUE = 17 * 60;
const isFullTimeStaff = name => FULL_TIME_STAFF.some(n => sameName(n, name));
const myDueBeforeContract = myDue;
myDue = function (week, d) {
  if (!me || isOwner()) return null;
  const x = dutyOf(week, d);
  if (x && x.off.some(p => isMe(p.name))) return null;
  const wd = new Date(d + 'T12:00:00').getDay(), weekday = wd >= 1 && wd <= 5;
  if (isFullTimeStaff(me.name)) return weekday ? FULL_DUE : rotaDue(week, d);
  if (isPartTime(me.name)) {
    const mine = x && x.work.find(p => isMe(p.name)), sh = mine && Q.shiftOf(mine.note);
    let due = sh ? sh.start : weekday ? PART_DUE : rotaDue(week, d);
    (week ? week.data.sessions : []).filter(s => s.day === d && !s.off).forEach(s => Q.staffOf(s).forEach(p => {
      if (p.role !== 'TA' && isMe(p.name) && (due === null || p.due < due)) due = p.due;
    }));
    return due;
  }
  return myDueBeforeContract(week, d);
};
// Tutor sessions: no check-in, one tick "Đã dạy xong" on the card (owner 10/11). The tick is a DIEM_DANH row of that session.
const TUTOR_DONE = '— DẠY XONG —';
const tutorDoneOf = s => { const rows = (logs.marks ? logs.marks.rows : []).filter(r => r.cls === Q.clean(s.cls) && r.day === s.day && r.name === TUTOR_DONE); const l = rows[rows.length - 1]; return l && l.status === 'Đã dạy' ? l : null; };
const scardBeforeTutor = sessionCard;
sessionCard = function (s) {
  const h = scardBeforeTutor(s), group = s.merged || [s], f = group[0];
  if (group.length > 1 || kindOf(f) !== 'tutor' || f.off || f.day > today() || !(isMe(f.teacher) || isManager())) return h;
  if (!logs.marks) setTimeout(() => loadMarks().then(render).catch(() => {}), 0);
  const done = tutorDoneOf(f);
  const bar = '<div class="c4-done">' + (done ? '<span class="tag ok">✓ ' + T('Đã dạy xong', 'Taught') + ' · ' + esc(String(done.at || '').slice(11, 16)) + '</span>' + (isManager() || isMe(done.by) ? ' <button class="quiet" data-act="tutorDone" data-row="' + f.row + '" data-day="' + f.day + '" data-v="Bỏ">' + T('Bỏ', 'Undo') + '</button>' : '')
    : '<button class="good" data-act="tutorDone" data-row="' + f.row + '" data-day="' + f.day + '" data-v="Đã dạy">✓ ' + T('Đã dạy xong', 'Mark as taught') + '</button>') + '</div>';
  const at = h.lastIndexOf('</div>');
  return at > 0 ? h.slice(0, at) + bar + h.slice(at) : h + bar;
};
document.addEventListener('click', e => {
  const b = e.target.closest && e.target.closest('[data-act="tutorDone"]');
  if (!b) return;
  e.stopPropagation();
  const s = findSession(b.dataset.row, b.dataset.day);
  if (!s) return;
  appendMark({ day: s.day, cls: Q.clean(s.cls), lesson: '', start: s.start }, { row: '', name: TUTOR_DONE, eng: '' }, b.dataset.v === 'Bỏ' ? 'Bỏ dạy xong' : 'Đã dạy');
  render();
}, true);

// Owner 10/11: one language at a time. Payroll labels are "Vietnamese / English", sometimes with a class group
// "(giờ dạy thường / regular teaching)"; the chosen side is shown in sentence case, acronyms kept.
const SLIP_KEEP = /^(IELTS|KIDS|BHXH|BHYT|BHTN|TNCN|FIGHTER|TA|CK)$/;
function slipCase(t) {
  t = String(t || '').trim();
  if (!t) return t;
  t = t.split(' ').map(w => { const c = w.replace(/[(),.%\d\/$]/g, ''); return c && c === c.toUpperCase() && c !== c.toLowerCase() && !SLIP_KEEP.test(c) ? w.toLowerCase() : w; }).join(' ');
  t = t.replace(/\bielts\b/gi, 'IELTS');
  return t.charAt(0).toUpperCase() + t.slice(1);
}
function slipSide(t, en) {
  const parts = String(t).split(/\s+\/\s+/);
  const vi = parts[0] || '', eng = parts.length > 1 ? parts.slice(1).join(' / ') : '';
  return en ? (eng || '') : vi;
}
function slipLabel(l, en) {
  let main = String(l || '').trim(), group = '';
  const g = main.match(/^(.*\S)\s*\(([^()]*\/[^()]*)\)\s*$/);
  if (g) { main = g[1]; group = g[2]; }
  if (/^NGUỒN SỐ/i.test(main)) return en ? 'Hours by class' : 'Nguồn số giờ';
  let pick = slipSide(main, en) || slipSide(main, !en);
  pick = pick.replace(/\s*\(nhập tay\)/gi, '').trim();
  let gp = group ? (slipSide(group, en) || slipSide(group, !en)) : '';
  return slipCase(pick) + (gp ? ' (' + slipCase(gp).replace(/^./, c => en ? c.toUpperCase() : c.toLowerCase()).replace(/\bielts\b/gi, 'IELTS') + ')' : '');
}
function slipValue(label, v, en) {
  if (!en || !/^NGUỒN SỐ/i.test(String(label))) return v;
  return String(v).replace(/Giờ thường/g, 'Regular').replace(/chưa có giờ trong tháng/g, 'no hours this month').replace(/(\d)\s*giờ/g, '$1 h').replace(/·/g, '·');
}

/* ---------- Owner 10/11: "part time lịch như trong schedule, nhưng nếu có ca thêm ghi ở đi quay hay đi trông kiểm tra vẫn phải có giờ" ----------
 * A part-time TA's due time is the rota shift (or 17:00 on a weekday rota day); on a day off the rota, or listed under "Nghỉ",
 * an extra duty written for them in column F (video, invigilation) or a class they teach still sets a due time: that duty's own. */
const myDueBeforeExtra = myDue;
myDue = function (week, d) {
  if (!me || isOwner() || !isPartTime(me.name)) return myDueBeforeExtra(week, d);
  const x = dutyOf(week, d), off = x && x.off.some(p => isMe(p.name)), mine = !off && x && x.work.find(p => isMe(p.name));
  const wd = new Date(d + 'T12:00:00').getDay(), weekday = wd >= 1 && wd <= 5, sh = mine && Q.shiftOf(mine.note);
  let due = sh ? sh.start : mine ? (weekday ? PART_DUE : rotaDue(week, d)) : null;
  (week ? week.data.sessions : []).filter(s => s.day === d && !s.off).forEach(s => Q.staffOf(s).forEach(p => {
    if (p.role !== 'TA' && isMe(p.name) && (due === null || p.due < due)) due = p.due;
  }));
  return due;
};

/* ---------- Owner 10/11: "quá 15 phút mà có người không có thông tin nghỉ học, cần nhắn PH thì phải nổi tin lên... popup thật nổi bật" ----------
 * From 15 minutes after a lesson starts until 2 hours after it ends, a pupil with no roll-call mark and no decision ("Vắng chờ
 * xác minh", parent not contacted yet) puts up a red pop-up for managers and the class's homeroom (CN): name, phone, and the same
 * buttons as the HS vắng tab (Có phép / Không phép / Đã liên hệ PH). A lesson with no roll call at all after 15 minutes is shown
 * too, and also to the teacher who takes the roll. "Để 10 phút" hides it for 10 minutes; it never covers the class screen. */
const PH_SNOOZE_MS = 10 * 60 * 1000;
let phSnoozeUntil = 0, phTried = new Set();
// Owner 12/11 ("tôi vẫn thấy báo sai": KIDS 26 and IELTS 51 shown as "no roll call" although both had it): the pop-up was worked out
// from a roll-call list that had not arrived yet, or one kept from earlier. It now waits for a list read in the last 3 minutes.
const PH_FRESH_MS = 3 * 60 * 1000;
let phFetching = false;
function phItems() {
  if (!me) return [];
  if (!logs.marks || Date.now() - (logs.marks.at || 0) > PH_FRESH_MS) {
    if (!phFetching) { phFetching = true; (logs.marks ? liveMarks() : loadMarks(true)).catch(() => {}).finally(() => { phFetching = false; try { paintPhPop(); } catch (e) {} }); }
    return [];
  }
  const t = today(), now = minutesNow(), w = weeks[Q.weekTab(tabs, t)], out = [];
  (w ? w.data.sessions : []).filter(s => s.day === t && !s.off && classOf(s) && now >= s.start + Q.ROLL_CALL_MINUTES && now <= s.end + 120).forEach(s => {
    const mineCn = isMe(s.ta), mineRoll = takesRoll(s);
    if (!(isManager() || mineCn || mineRoll)) return;
    const c = classOf(s);
    if (!trackers[c.key]) { if (!phTried.has(c.key)) { phTried.add(c.key); loadTracker(c, false, true).then(render).catch(() => {}); } return; }
    const ctx = classContext(s);
    if (!ctx.tracker) return;
    const roll = Q.rollCall(s, ctx.marks, t, now);
    if (roll.noRollCall) { out.push({ s, none: true, list: [] }); return; }
    if (!(isManager() || mineCn)) return;
    const list = ctx.tracker.pupils.map(p => ({ p, m: ctx.marks.get(p.name), st: Q.pupilState(ctx.marks.get(p.name), roll) })).filter(x => x.st === 'Vắng chờ xác minh' && !(x.m && x.m.contact));
    if (list.length) out.push({ s, list });
  });
  return out;
}
function paintPhPop() {
  let box = document.getElementById('phPop');
  const items = view === 'lenlop' || Date.now() < phSnoozeUntil ? [] : phItems();
  if (!items.length) { if (box) box.remove(); return; }
  if (!box) { box = document.createElement('div'); box.id = 'phPop'; document.body.appendChild(box); }
  const phone = p => { const ph = (String(p.phone || '').match(/[\d ]{9,}/) || [''])[0].trim(); return ph ? '<a href="tel:' + esc(ph.replace(/\s/g, '')) + '">📞 ' + esc(ph) + '</a>' : ''; };
  const btn = (s, x, act, v, cls, label) => '<button class="' + cls + '" data-act="' + act + '" data-v="' + v + '" data-row="' + s.row + '" data-day="' + s.day + '" data-name="' + esc(x.p.name) + '">' + label + '</button>';
  const body = items.map(it => '<div class="ph-cls"><b>' + esc(it.s.cls) + '</b> <span class="muted small">' + Q.clock(it.s.start) + ' · ' + T('CN ', 'Homeroom ') + esc(titleCase(it.s.ta || '—')) + '</span>' +
    (it.none ? '<div class="ph-none">' + T('Chưa điểm danh cả lớp sau 15 phút', 'No roll call 15 minutes in') + ' · ' + esc(titleCase(it.s.teacher || '')) + '</div>'
      : it.list.map(x => '<div class="ph-line"><span class="ph-who"><b>' + esc(x.p.eng || x.p.name) + '</b> <small>' + esc(x.p.name) + '</small> ' + phone(x.p) + '</span><span class="ph-btns">' +
        btn(it.s, x, 'absence', 'Có phép', 'mid', T('Có phép', 'Excused')) + btn(it.s, x, 'absence', 'Không phép', 'low', T('Không phép', 'Unexcused')) + btn(it.s, x, 'contact', '', 'good', '📞 ' + T('Đã liên hệ PH', 'Parent contacted')) + '</span></div>').join('')) + '</div>').join('');
  const n = items.reduce((k, it) => k + (it.none ? 1 : it.list.length), 0);
  box.innerHTML = '<div class="pair-veil"></div><div class="pair-sheet ph-pop" role="alertdialog" aria-label="' + T('Cần nhắn phụ huynh', 'Parents to contact') + '">' +
    '<b class="ph-t">🚨 ' + T('Cần nhắn phụ huynh ngay', 'Contact parents now') + ' · ' + n + '</b>' +
    '<p class="small">' + T('Quá 15 phút vào lớp mà chưa có thông tin nghỉ học. Gọi hoặc nhắn phụ huynh rồi bấm Đã liên hệ PH, hoặc chọn Có phép / Không phép.', 'Fifteen minutes in with no news. Contact the parents, then mark it.') + '</p>' +
    body + '<div class="chot-row"><button class="primary" data-act="phOpen">' + T('Mở mục HS vắng', 'Open absences') + '</button><button class="quiet" data-act="phLater">' + T('Để 10 phút', 'In 10 minutes') + '</button></div></div>';
}
document.addEventListener('click', e => {
  const b = e.target.closest && e.target.closest('#phPop [data-act]');
  if (!b) return;
  if (b.dataset.act === 'phLater') { phSnoozeUntil = Date.now() + PH_SNOOZE_MS; paintPhPop(); }
  if (b.dataset.act === 'phOpen') { phSnoozeUntil = Date.now() + 2 * 60 * 1000; if (isManager()) { view = 'dieuhanh'; panel = 'vang'; filters.person = ''; render(); guarded(loadPanel); } else { view = 'lopcn'; render(); } }
  setTimeout(paintPhPop, 300);
});
const renderBeforePh = render;
render = function () { renderBeforePh(); try { paintPhPop(); } catch (e) {} };
// The roll-call log is re-read once a minute for this, while the page is open and someone it concerns is signed in.
setInterval(async () => {
  if (!me || document.visibilityState !== 'visible' || view === 'lenlop') return;
  try { if (logs.marks) await liveMarks(); } catch (e) {}
  try { paintPhPop(); } catch (e) {}
}, 60000);

/* ---------- Owner 10/11: "tất cả mọi loại update phải được thực hiện không cần F5" ----------
 * Every page now follows what others do, without reloading (a new app version still needs F5):
 * - roll call, ticks (printing, tutor done, absences, parent contacts): the roll-call log tail every 30 s;
 * - the Schedule week shown (lessons, rota, tasks, penalty list): every 2 minutes;
 * - check-ins and approvals: every 2 minutes on Lịch, Công and Điều hành; payslip states every 2 minutes on Lương;
 * - and at once when the tab comes back to the front.
 * The class page and class screen keep their own faster refresh; Điều hành panels keep theirs. The server keeps each read for
 * 10-90 s and shares it between all phones, so many open pages still cost Google only a few reads a minute.
 * A redraw waits while someone is typing and keeps the scroll and the box in focus. */
const LIVE_EVERY = { marks: 30000, week: 120000, ca: 120000, pay: 120000 };
const liveAll = { marks: Date.now(), week: Date.now(), ca: Date.now(), pay: Date.now(), busy: false };
async function liveTick(now) {
  if (liveAll.busy || !me || isBoard() || document.visibilityState !== 'visible' || ['lop', 'lenlop'].includes(view)) return;
  // Coming back to the tab reads at once, but not more than once every 15 s.
  if (now && Date.now() - (liveAll.front || 0) < 15000) now = false; else if (now) liveAll.front = Date.now();
  const t = Date.now(), due = k => now || t - liveAll[k] >= LIVE_EVERY[k], jobs = [];
  if (due('marks')) { liveAll.marks = t; jobs.push(logs.marks ? liveMarks() : loadMarks(true)); }
  if (due('week')) { liveAll.week = t; jobs.push(weekOf(day, true)); if (day !== today()) jobs.push(weekOf(today(), true)); }
  if (due('ca') && ['lich', 'cong', 'dieuhanh'].includes(view)) { liveAll.ca = t; jobs.push(loadCa(true)); }
  if (due('pay') && view === 'luong') { liveAll.pay = t; jobs.push(loadLuong(true)); }
  if (!jobs.length) return;
  liveAll.busy = true;
  try { await Promise.allSettled(jobs); } finally { liveAll.busy = false; }
  const a = document.activeElement;
  if (!(a && /^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName))) render();
}
setInterval(() => { liveTick(false).catch(() => {}); }, 15000);
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') liveTick(true).catch(() => {}); });
window.addEventListener('focus', () => { liveTick(true).catch(() => {}); });

/* ---------- Owner 10/11: "app mới có cách nào không cần F5... vì tôi phải sửa liên tục" ----------
 * A page left open now takes a new version by itself. Every 2 minutes (and when the tab comes back to the front) it reads the
 * published index.html; when its version differs from the running one, the page reloads at a safe moment: nothing typed half-way,
 * nothing waiting to be saved, no sheet or staff form open, and never on the class screen (it waits until the teacher leaves it).
 * Before reloading it notes the page, day, panel and scroll; after the reload it comes back there and says "Đã cập nhật bản mới". */
const APP_V = ((document.querySelector('script[src*="extra.js"]') || {}).src || '').replace(/^.*[?&]v=/, '');
let appNewV = '', appCheckAt = 0;
async function appCheck(now) {
  if (!APP_V || document.visibilityState !== 'visible' || (!now && Date.now() - appCheckAt < 110000)) return;
  appCheckAt = Date.now();
  try {
    const r = await fetch('index.html?check=' + Date.now(), { cache: 'no-store' });
    const v = ((await r.text()).match(/extra\.js\?v=([\w.-]+)/) || [])[1] || '';
    if (v && v !== APP_V) appNewV = v;
  } catch (e) {}
  appSwap();
}
function appSafe() {
  const a = document.activeElement;
  if (a && /^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName)) return false;
  if (typeof outbox !== 'undefined' && outbox.length) return false;
  if (view === 'lenlop' || document.querySelector('.ll-sheet, .sum-sheet, #chotPop')) return false;
  if (typeof ns !== 'undefined' && ns && (ns.form || ns.busy)) return false;
  return true;
}
function appSwap() {
  if (!appNewV || !appSafe()) return;
  try {
    const box = document.querySelector('.dash-modal .dash-body');
    sessionStorage.setItem('qllBack', JSON.stringify({ at: Date.now(), view, day, panel, y: window.scrollY, from: APP_V, to: appNewV, row: current ? current.row : '', cday: current ? current.day : '' }));
  } catch (e) {}
  location.reload();
}
setInterval(() => { appCheck(false); if (appNewV) appSwap(); }, 30000);
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') appCheck(true); });
// After the reload: back to where the person was.
(function () {
  let back = null;
  try { back = JSON.parse(sessionStorage.getItem('qllBack') || 'null'); } catch (e) {}
  if (!back || Date.now() - back.at > 120000) { try { sessionStorage.removeItem('qllBack'); } catch (e) {} return; }
  // The device's stored page may still be the old one for this open; the worker then reloads once more, and the note waits for it.
  if (back.to && APP_V !== back.to) return;
  try { sessionStorage.removeItem('qllBack'); } catch (e) {}
  const until = Date.now() + 20000, t = setInterval(() => {
    if (Date.now() > until) return clearInterval(t);
    if (!me) return;
    clearInterval(t);
    if (back.day) day = back.day;
    if (back.panel) panel = back.panel;
    if (back.view && back.view !== 'lenlop') view = back.view;
    Promise.resolve(weekOf(day)).catch(() => {}).then(() => { if (view === 'lop') { const s = back.row && findSession(back.row, back.cday); if (s) current = s; else view = 'lich'; } render(); setTimeout(() => window.scrollTo(0, back.y || 0), 50); if (view === 'dieuhanh') guarded(loadPanel); say('Đã tự cập nhật bản mới của app.'); });
  }, 300);
})();

/* ---------- Owner 10/11: "logic lấy Nhân sự là chuẩn" ----------
 * Each staff record has "Giờ vào ca": Toàn thời gian (15:30 Thứ 2-6, weekends by the rota rule), Part-time (rota shift, else 17:00,
 * plus extra duties), Theo lớp dạy (before the first class), Không chấm vào ca. The server sends only that word for the person
 * signed in (me.ca). A record without the choice is read from its position; a person without a record keeps the old lists. */
const CA_KINDS = [['', 'Tự xét theo vị trí'], ['full', 'Toàn thời gian · có mặt 15:30 Thứ 2–6'], ['part', 'Part-time · theo ca trong lịch trực (mặc định 17:00)'], ['lop', 'Theo lớp dạy · trước buổi đầu 10 phút'], ['none', 'Không chấm vào ca']];
const nsFormHtmlBeforeCa = nsFormHtml;
nsFormHtml = function () {
  const h = nsFormHtmlBeforeCa(), f = ns.form;
  if (!f || ns.sec !== 'chung') return h;
  const v = (f.rate && f.rate.ca) || '';
  const sel = '<div class="form-grid"><label>Giờ vào ca<select data-act="nsF" data-k="r.ca">' + CA_KINDS.map(([k, t]) => '<option value="' + k + '"' + (v === k ? ' selected' : '') + '>' + t + '</option>').join('') + '</select></label></div>';
  const at = h.indexOf('<div class="form-grid"><label>Ghi chú');
  return at >= 0 ? h.slice(0, at) + sel + h.slice(at) : h.replace('<div class="ns-save">', sel + '<div class="ns-save">');
};
// The record decides the lists the check-in rules use for the person signed in.
function caApply() {
  if (!me || !me.ca) return;
  const drop = list => { const i = list.findIndex(n => sameName(n, me.name)); if (i >= 0) list.splice(i, 1); };
  drop(FULL_TIME_STAFF); drop(PART_TIME_TA);
  if (me.ca === 'full') FULL_TIME_STAFF.push(me.name);
  if (me.ca === 'part') PART_TIME_TA.push(me.name);
}
const myDueBeforeCa = myDue;
myDue = function (week, d) {
  caApply();
  if (me && me.ca === 'none') return null;
  if (me && me.ca === 'lop') return myDueBeforeContract(week, d);
  return myDueBeforeCa(week, d);
};

/* ---------- Owner 10/11: "Angelo bấm Important Task done thì ai phụ trách phải biết là Angelo chấm xong rồi, để còn biết đường trả" ----------
 * When the teacher's grading is done (ticked in the app or in the Schedule), the task moves to its second step for the person in
 * the Return column: it stays open on their list as "Cần trả" with the return date, the bell counts it, and they get a note that
 * stays until closed ("ANGELO đã chấm xong KIDS 38 · … — bạn trả trước 16/11"). "📤 Đã trả" ticks the return (DIEM_DANH, class
 * IMPORTANT TASK, name "<class> · <task> · trả"); managers see who returned and when, and can undo like the person who ticked. */
const RETURN_TAG = ' · trả';
const taskReturned = t => { if (!logs.marks) return null; const rows = logs.marks.rows.filter(r => r.cls === TASK_CLS && r.name === (taskName(t) + RETURN_TAG).slice(0, 160)); const l = rows[rows.length - 1]; return l && l.status === 'Đã trả' ? l : null; };
const taOf = t => staffNow(t.ta, t.cls);
// Graded, not yet returned, and the person signed in is the one returning it.
const returnPending = t => !!(t && t.done && t.ta && !isMe(t.teacher) && isMe(taOf(t)) && !taskReturned(t));
const taskStateBeforeReturn = Q.taskState;
Q.taskState = function (t, d) {
  if (t.done && t.ta && !taskReturned(t) && (isMe(taOf(t)) || isManager()) && !isMe(t.teacher)) {
    if (t.returnDue && t.returnDue < d) return { state: 'quahan', text: 'Quá hạn trả' };
    if (t.returnDue === d) return { state: 'homnay', text: 'Hạn trả hôm nay' };
    return { state: 'sap', text: 'Đã chấm xong · cần trả' };
  }
  return taskStateBeforeReturn(t, d);
};
const taskRowBeforeReturn = taskRow;
taskRow = function (t, week, canTick) {
  const h = taskRowBeforeReturn(t, week, canTick);
  if (!t.done || !t.ta) return h;
  const back = taskReturned(t), can = isManager() || isMe(taOf(t));
  const line = back ? '<div class="small trail ret-done">📤 ' + T('Đã trả', 'Returned') + ' · ' + esc(back.by || '?') + ' ' + esc(String(back.at || '').slice(11, 16) + ' ' + String(back.at || '').slice(0, 5)) + (can ? ' <button class="quiet" data-act="taskRet" data-row="' + t.row + '" data-v="Bỏ trả">' + T('Bỏ', 'Undo') + '</button>' : '') + '</div>'
    : '<div class="small ret-wait">📤 ' + T('Chờ ', 'Waiting for ') + '<b>' + esc(titleCase(taOf(t))) + '</b>' + T(' trả bài', ' to return') + (t.returnDue ? T(' trước ', ' by ') + esc(viDate(t.returnDue)) : '') + (can ? ' <button class="good" data-act="taskRet" data-row="' + t.row + '" data-v="Đã trả">📤 ' + T('Đã trả', 'Returned') + '</button>' : '') + '</div>';
  const out = h.replace(/<\/div><\/div><\/div>$/, line + '</div></div></div>');
  // Still to return: a normal (not faded) card with a green edge, so the TA sees it is their turn.
  return !back && (isMe(taOf(t)) || isManager()) && !isMe(t.teacher) ? out.replace('<div class="card row task-done">', '<div class="card row ret-todo">') : out;
};
document.addEventListener('click', e => {
  const b = e.target.closest && e.target.closest('[data-act="taskRet"]');
  if (!b) return;
  e.stopPropagation();
  const week = weeks[Q.weekTab(tabs, day)] || weeks[Q.weekTab(tabs, today())], t = week && week.data.tasks.find(x => String(x.row) === b.dataset.row);
  if (!t) return;
  appendMark({ day: today(), cls: TASK_CLS, lesson: '', start: 0 }, { row: '', name: (taskName(t) + RETURN_TAG).slice(0, 160), eng: '' }, b.dataset.v);
  render();
}, true);
// The note that stays until closed, once per task on this device; the bell counts what is still to return.
function taskReturnNotes() {
  if (!me || isOwner()) return;
  const week = weeks[Q.weekTab(tabs, today())];
  if (!week || !logs.marks) return;
  let seen = []; try { seen = JSON.parse(saved.get('taskRetSeen') || '[]'); } catch (e) {}
  const fresh = week.data.tasks.filter(t => t.done && t.ta && isMe(taOf(t)) && !isMe(t.teacher) && !taskReturned(t) && !seen.includes(week.tab + '|' + taskName(t)));
  if (!fresh.length) return;
  fresh.forEach(t => {
    notices.push({ text: '✅ ' + titleCase(t.teacher) + T(' đã chấm xong ', ' finished grading ') + Q.clean(t.cls) + ' · ' + Q.clean(t.what) + T(' — bạn trả bài', ' — please return it') + (t.returnDue ? T(' trước ', ' by ') + viDate(t.returnDue) : '') + '.', kind: 'ok' });
    seen.push(week.tab + '|' + taskName(t));
  });
  keep('taskRetSeen', JSON.stringify(seen.slice(-200)));
  render();
}
setInterval(() => { try { taskReturnNotes(); } catch (e) {} }, 30000);
const bellItemsBeforeReturn = bellItems;
bellItems = function () {
  const out = bellItemsBeforeReturn();
  try {
    const week = weeks[Q.weekTab(tabs, today())];
    if (week && me) {
      const todo = week.data.tasks.filter(t => t.done && t.ta && !taskReturned(t) && (isMe(taOf(t)) || isManager()) && !isMe(t.teacher));
      if (todo.length) out.push({ k: 'tret', icon: '📤', text: todo.length + T(' bài đã chấm xong, cần trả', ' graded, to return'), n: todo.length, hot: todo.some(t => t.returnDue && t.returnDue <= today()), go: { view: 'lich', sec: 'task' } });
    }
  } catch (e) {}
  return out;
};

/* ---------- Owner 10/11 "nút chi tiết bị đơ": opening one payslip reads only that slip and shows at once that it is opening ---------- */
async function payOpenOne() {
  const who = pay.person;
  try { const m = await call('luong', { month: pay.month || undefined, person: who }); if (pay.person === who) pay.mine = m; }
  catch (e) { if (pay.person === who) pay.person = ''; say(e.message, 'bad'); }
  render();
}
const viewLuongBeforeOpen = viewLuong;
viewLuong = function () {
  if (isOwner() && pay.person && !pay.mine && !pay.err) {
    const out = viewLuongBeforeOpen(), cut = out.search(/<div class="(count|kpi4)">/);
    return (cut > 0 ? out.slice(0, cut) : '') + '<div><button class="quiet" data-act="payBack">‹ ' + T('Cả bảng', 'Everyone') + '</button></div><div class="card empty">⏳ ' + T('Đang mở phiếu lương của ', 'Opening the payslip of ') + esc(pay.person) + '…</div>';
  }
  return viewLuongBeforeOpen();
};

/* ---------- Owner 10/11 (Văn Sơn: "nay nó không cập nhật để em nhắn nhắc PH") ----------
 * A message to parents was counted once per level: Bush and Mia, on level since 08/11 and messaged that day, showed "done" on
 * 10/11 although KIDS 11 had class and both were still on that day's Schedule list. Now a pupil who is on today's Schedule list and
 * whose class meets today needs today's message; earlier messages show in the trail but do not count for today. Pupils with no class
 * today keep one message per level. Calls (level 4 and up) are unchanged. */
function ladTodayClass(x) {
  const w = weeks[Q.weekTab(tabs, today())];
  return !!w && !!x.line && w.data.sessions.some(s => s.day === today() && !s.off && Q.key(s.cls) === Q.key(x.cls));
}
function contactDay(c) { const m = String(c.at || '').match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/); return m ? m[3] + '-' + ('0' + m[2]).slice(-2) + '-' + ('0' + m[1]).slice(-2) : ''; }


/* ---------- Owner 10/11 "sao tối qua Kids 8 k có màn hình nhập điểm": KIDS paper tests get the same score box as FIGHTER ----------
 * A KIDS lesson that returns a written test ("UNIT 1 TEST RETURN", "WRITTEN TEST 7 RETURN", "TRẢ BÀI KIỂM TRA VIẾT SỐ 9") opens the class's newest "KIỂM TRA GIẤY ĐỊNH KÌ" column whose test date is within the last
 * three weeks. Scores go into that column (the one with the title; the cell next to it is left alone). When the header has no
 * "Tổng: N câu hỏi" yet, the box asks once and adds that line under the test date, where the reports already read it. */
const KIDS_PAPER_DAYS = 21;
// Owner 10/11: "khung nhập điểm ở buổi TEST RETURN" — scores are typed when the marked tests are handed back, not on the test day.
const kidsTestLesson = s => /\bRETURN\b|TRA BAI KIEM TRA/.test(Q.key(s.detail || ''));
function kidsPaperCols(t) {
  const head = t.head || [], width = Math.max(0, ...head.map(r => (r || []).length)), out = [], two = n => ('0' + n).slice(-2);
  for (let c = 0; c < width; c++) {
    const cells = head.map(r => String((r || [])[c] || ''));
    if (!cells.some(v => /KIEM TRA GIAY/.test(Q.key(v)))) continue;
    const text = cells.join('\n'), d = text.match(/Ngày kiểm tra:?\s*(\d{1,2})\s*\/\s*(\d{1,2})\s*\/\s*(\d{4})/i), tot = text.match(/Tổng:?\s*(\d+)/i);
    const u = Q.key(text).match(/UNITS?\s*(\d+(?:\s*[,+&]\s*\d+)*)/);
    out.push({ col: c, date: d ? d[3] + '-' + two(d[2]) + '-' + two(d[1]) : '', total: tot ? Number(tot[1]) : 0,
      unit: u ? u[1].replace(/\s*[,+&]\s*/g, '+') : '', dateRow: cells.findIndex(v => /Ngày kiểm tra/i.test(v)) });
  }
  return out;
}
function kidsPaperOf(ctx) {
  const s = ctx && ctx.session, t = ctx && ctx.tracker;
  if (!s || !t || !t.head || !kidsTestLesson(s)) return null;
  const from = Q.addDays(s.day, -KIDS_PAPER_DAYS);
  return kidsPaperCols(t).filter(c => c.date && c.date <= s.day && c.date >= from).sort((a, b) => b.date.localeCompare(a.date))[0] || null;
}
const ktOfBeforeKids = ktOf;
ktOf = function (ctx) {
  const s = ctx && ctx.session;
  if (!s || isSecondary(s) || isGroup(s)) return ktOfBeforeKids(ctx);
  const hit = kidsPaperOf(ctx);
  if (!hit) return null;
  ktLoadVals(ctx, hit.col);
  return { unit: hit.unit || '?', col: hit.col, total: hit.total, kids: true, dateRow: hit.dateRow };
};
// The total for a KIDS test is written into the sheet header (FIGHTER keeps its own server path).
document.addEventListener('change', e => {
  const el = e.target;
  if (!el || !el.dataset || el.dataset.act !== 'ktTotal' || !current) return;
  const ctx = classContext(current), k = ctx && ctx.tracker ? ktOf(ctx) : null;
  if (!k || !k.kids) return;
  e.stopImmediatePropagation();
  const n = Math.min(500, Math.round(Number(el.value)));
  if (!(n > 0) || !canTeach(ctx.session)) return;
  const t = ctx.tracker, cls = classOf(ctx.session), r = k.dateRow >= 0 ? k.dateRow : 2, row = (t.head[r] = t.head[r] || []);
  const before = String(row[k.col] || ''), value = (before.trim() ? before.replace(/\s+$/, '') + '\n' : '') + 'Điểm Tổng: ' + n + ' câu hỏi';
  row[k.col] = value;
  queue({ kind: 'cell', file: cls.tracker, classKey: cls.key, range: quote(t.tab) + '!' + Q.colName(k.col) + (r + 1), row: r + 1, col: k.col, expected: before, value, label: T('Tổng số câu KT', 'Test total') });
  render();
}, true);


/* ---------- Owner 11/11: "cảnh báo nổi khi có lớp nghỉ học — báo lên nhóm Zalo lớp ít nhất 1 ngày trước ngày nghỉ; nổi đến khi có ai
 * tick là đã làm; TA chủ nhiệm phải báo, quản lí hay tôi; mọi thứ đều có dấu ai đã tick để truy vết" ----------
 * Every class lesson marked off in the Schedule (CLASS STATUS "Nghỉ học", or a centre day off) in the next 7 days puts up a pop-up
 * for the class's homeroom (PHÂN CÔNG, else the CM/TA column), managers and the owner, until someone taps "Đã báo nhóm lớp".
 * The deadline is the day before the lesson. A tick is a roll-call log row (class "BÁO NGHỈ LỚP", name "<class> · nghỉ <day>",
 * person and time kept); "Bỏ" writes a newer row, so the whole history stays. "Để 30 phút" only hides the pop-up for a while. */
const OFF_CLS = 'BÁO NGHỈ LỚP', OFF_DONE = 'Đã báo nhóm lớp', OFF_AHEAD = 7, OFF_SNOOZE_MS = 30 * 60 * 1000;
let offSnoozeUntil = 0, offNextTried = 0;
const offName = s => (Q.clean(s.cls).replace(/\.\d+$/, '') + ' · nghỉ ' + s.day).slice(0, 160);
const offDone = s => { if (!logs.marks) return null; const rows = logs.marks.rows.filter(r => r.cls === OFF_CLS && r.name === offName(s)); const l = rows[rows.length - 1]; return l && l.status === OFF_DONE ? l : null; };
const offWho = l => esc(titleCase(l.by || '?')) + ' ' + esc(String(l.at || '').slice(11, 16) + ' ' + String(l.at || '').slice(0, 5));
function offItems(withDone) {
  if (!me || !logs.marks) return [];
  const t = today(), end = Q.addDays(t, OFF_AHEAD), seen = new Set(), out = [];
  // The window can reach into next week's tab.
  if (Date.now() - offNextTried > 10 * 60 * 1000) { offNextTried = Date.now(); weekOf(Q.addDays(t, OFF_AHEAD)).then(() => render()).catch(() => {}); }
  Object.values(weeks).forEach(w => (w.data.sessions || []).forEach(s => {
    if (!s.off || s.day < t || s.day > end || !classOf(s)) return;
    const k = offName(s);
    if (seen.has(k)) return;
    seen.add(k);
    const cn = homeroom[Q.key(Q.clean(s.cls).replace(/\.\d+$/, ''))] || homeroom[Q.key(s.cls)] || s.ta || '';
    if (!(isManager() || isMe(cn) || isMe(s.ta))) return;
    const done = offDone(s);
    if (done && !withDone) return;
    out.push({ s, cn, done, due: Q.addDays(s.day, -1) });
  }));
  return out.sort((a, b) => a.s.day.localeCompare(b.s.day) || a.s.start - b.s.start);
}
const offWhen = x => { const t = today(); return t > x.due ? { hot: true, text: T('Trễ hạn báo (phải báo trước 1 ngày)', 'Late: due a day before') } : t === x.due ? { hot: true, text: T('Hạn báo hôm nay', 'Tell the group today') } : { hot: false, text: T('Báo trước ', 'Tell by ') + viDate(x.due).slice(0, 5) }; };
const offBtn = (x, v, cls, label) => '<button class="' + cls + '" data-act="offTick" data-k="' + esc(offName(x.s)) + '" data-day="' + x.s.day + '" data-v="' + v + '">' + label + '</button>';
// Owner 11/11 ("tôi lo nhiều thứ nổi quá… nhưng vẫn cần cảnh báo"): one pop-up for every kind of reminder, one short line per kind;
// a line opens to its items. It stays until each item is ticked; "Để 30 phút" hides all of it for half an hour.
const POP_SECTIONS = [], popOpen = new Set();
function popSection(sec) { POP_SECTIONS.push(sec); }
popSection({ k: 'off', icon: '📢', title: () => T('Lớp nghỉ · báo nhóm Zalo lớp (trước 1 ngày)', 'Class off · tell the class group a day ahead'),
  items: () => offItems(false).map(x => { const w = offWhen(x); return { hot: w.hot, html: '<div class="ph-cls"><b>' + esc(Q.clean(x.s.cls).replace(/\.\d+$/, '')) + '</b> <span class="muted small">' + T('nghỉ ', 'off ') + esc(dayLabel(x.s.day)) + ' · ' + Q.clock(x.s.start) + ' · ' + T('CN ', 'Homeroom ') + esc(titleCase(x.cn || '—')) + '</span>' +
    '<div class="ph-line"><span class="ph-who ' + (w.hot ? 'ph-none' : '') + '">' + esc(w.text) + '</span><span class="ph-btns">' + offBtn(x, OFF_DONE, 'good', '✅ ' + T('Đã báo nhóm lớp', 'Told the group')) + '</span></div></div>' }; }) });
function paintOffPop() {
  let box = document.getElementById('offPop');
  const quiet = view === 'lenlop' || Date.now() < offSnoozeUntil || document.getElementById('phPop');
  const secs = quiet ? [] : POP_SECTIONS.map(sec => { let items = []; try { items = sec.items(); } catch (e) {} return { sec, items }; }).filter(x => x.items.length);
  if (!secs.length) { if (box) box.remove(); return; }
  if (!box) { box = document.createElement('div'); box.id = 'offPop'; document.body.appendChild(box); }
  const n = secs.reduce((k, x) => k + x.items.length, 0), one = secs.length === 1;
  const body = secs.map(x => { const hot = x.items.filter(i => i.hot).length;
    return '<details class="pop-sec" data-k="' + x.sec.k + '"' + (one || popOpen.has(x.sec.k) ? ' open' : '') + '><summary><span>' + x.sec.icon + ' ' + esc(x.sec.title()) + '</span><b class="pop-n' + (hot ? ' hot' : '') + '">' + x.items.length + '</b>' +
      (hot ? '<span class="pop-hot">' + hot + T(' đến hạn', ' due') + '</span>' : '') + '</summary>' + x.items.map(i => i.html).join('') + '</details>'; }).join('');
  box.innerHTML = '<div class="pair-veil"></div><div class="pair-sheet ph-pop pop-todo" role="alertdialog" aria-label="' + T('Việc cần làm', 'To do') + '">' +
    '<b class="ph-t">🔔 ' + T('Việc cần làm', 'To do') + ' · ' + n + '</b>' +
    '<p class="small">' + T('Hiện cho tới khi có người tick. Ai tick, lúc nào đều được lưu lại.', 'Stays until someone ticks it; who and when are kept.') + '</p>' +
    body + '<div class="chot-row"><button class="quiet" data-act="offLater">' + T('Để 30 phút', 'In 30 minutes') + '</button></div></div>';
}
document.addEventListener('toggle', e => { const d = e.target; if (d && d.classList && d.classList.contains('pop-sec')) { if (d.open) popOpen.add(d.dataset.k); else popOpen.delete(d.dataset.k); } }, true);
document.addEventListener('click', e => {
  const b = e.target.closest && e.target.closest('[data-act="offTick"],[data-act="offLater"]');
  if (!b) return;
  e.stopPropagation();
  if (b.dataset.act === 'offLater') { offSnoozeUntil = Date.now() + OFF_SNOOZE_MS; paintOffPop(); return; }
  appendMark({ day: today(), cls: OFF_CLS, lesson: '', start: 0 }, { row: '', name: b.dataset.k, eng: '' }, b.dataset.v);
  say(b.dataset.v === OFF_DONE ? T('Đã ghi: bạn đã báo lớp nghỉ lên nhóm.', 'Saved.') : T('Đã bỏ dấu đã báo.', 'Undone.'));
  render();
}, true);
const renderBeforeOff = render;
render = function () { renderBeforeOff(); try { paintOffPop(); } catch (e) {} };
setInterval(() => { try { paintOffPop(); } catch (e) {} }, 60000);
// Bell and the quick lists on Lịch: what is still to tell, and who told which class when (the trail).
QA.offcls = ['Báo lớp nghỉ', 'Class off', '<path d="M3 11l18-5v12L3 14v-3z"/><path d="M11.6 16.8a3 3 0 1 1-5.8-1.6"/>'];
const bellItemsBeforeOff = bellItems;
bellItems = function () {
  const out = bellItemsBeforeOff();
  try { const list = offItems(false); if (list.length) out.push({ k: 'offcls', icon: '📢', text: list.length + T(' lớp nghỉ chưa báo nhóm Zalo', ' classes off not announced'), n: list.length, hot: list.some(x => offWhen(x).hot), go: { view: 'lich', sec: 'homnay' } }); } catch (e) {}
  return out;
};
const qaRowsBeforeOff = qaRows;
qaRows = function (kind) {
  if (kind !== 'offcls') return qaRowsBeforeOff(kind);
  return offItems(true).map(x => {
    const w = offWhen(x), mine = x.done && (isManager() || isMe(x.done.by));
    return { key: 'offcls|' + offName(x.s), cls: Q.clean(x.s.cls).replace(/\.\d+$/, ''), who: T('Nghỉ ', 'Off ') + viDate(x.s.day).slice(0, 5),
      reason: x.done ? '✓ ' + T('Đã báo · ', 'Told · ') + titleCase(x.done.by || '?') + ' ' + String(x.done.at || '').slice(11, 16) + ' ' + String(x.done.at || '').slice(0, 5) : w.text,
      btn: x.done ? (mine ? offBtn(x, 'Bỏ báo', 'quiet', T('Bỏ', 'Undo')) : '') : offBtn(x, OFF_DONE, 'good', ico('check')), hot: !x.done && w.hot };
  });
};
// The lesson card of a class that is off shows who told the group and when (or that nobody has yet).
const sessionCardBeforeOff = sessionCard;
sessionCard = function (s) {
  const h = sessionCardBeforeOff(s);
  try {
    if (!s || !s.off || !classOf(s) || s.day < today()) return h;
    const d = offDone(s), line = d ? '<div class="small ok-text">📢 ' + T('Đã báo nhóm lớp · ', 'Group told · ') + offWho(d) + '</div>' : '<div class="small bad-text">📢 ' + T('Chưa báo nhóm Zalo lớp nghỉ', 'Class group not told yet') + '</div>';
    const at = h.lastIndexOf('</div>');
    return at > 0 ? h.slice(0, at) + line + h.slice(at) : h + line;
  } catch (e) { return h; }
};


/* ---------- Owner 11/11: new pupils ("có hs mới thì đón xong nọ kia"; steps and owners as proposed 08/11, "riêng từng việc") ----------
 * The pupils come from the tuition app's roster scan (server op 'hsmoi': a pupil newly added to a THEO DÕI TOÀN DIỆN, no transfers,
 * none the owner skipped). Each pupil has ten ticks, each with its owner and day:
 *   homeroom TA: pick up + trial books (the day), then "knows how to hand in work" at the 1st, 2nd and 3rd lesson after;
 *   teacher of the trial lesson: feedback (fits the class?) the same day;
 *   managers: message parents the same day, parents confirm (+1 day), fee, learning-web link, guide to parents (+2 days).
 * A due tick goes into the shared "Việc cần làm" pop-up for its owner (managers also see anything overdue) until someone ticks it.
 * Ticks are roll-call log rows (class "HS MỚI", name "<class> · <pupil> · <step>", person and time kept); "Bỏ" adds a newer row.
 * Pupils added before 11/11 are listed (bell and quick list) but do not pop up. */
const HS_CLS = 'HS MỚI', HS_DONE = 'Đã xong', HS_POP_FROM = '2026-11-11';
const HS_STEPS = [['don', 'Đón HS, phát sách học thử', 'cn', 0], ['gv', 'GV nhận xét buổi học thử (có hợp lớp không)', 'gv', 0], ['nhan', 'Nhắn PH kết quả học thử', 'ql', 0],
  ['xn', 'PH xác nhận cho con học', 'ql', 1], ['phi', 'Thu phí nhập học', 'ql', 2], ['link', 'Tạo link web học của con', 'ql', 2], ['hd', 'Gửi PH hướng dẫn nộp bài', 'ql', 2],
  ['b1', 'Buổi 1: con biết cách nộp bài', 'cn', 'L1'], ['b2', 'Buổi 2: con nộp bài đúng', 'cn', 'L2'], ['b3', 'Buổi 3: con nộp bài đúng', 'cn', 'L3']];
const HS_WHO = { cn: 'TA chủ nhiệm', gv: 'GV buổi học thử', ql: 'Quản lí' };
const hsData = { list: null, at: 0, loading: false };
function hsLoad(force) {
  if (!me || hsData.loading || (!force && Date.now() - hsData.at < 5 * 60 * 1000)) return;
  hsData.loading = true;
  call('hsmoi', {}).then(d => { hsData.list = (d && d.list) || []; hsData.at = Date.now(); }).catch(() => { hsData.at = Date.now(); }).finally(() => { hsData.loading = false; render(); });
}
const hsName = (ev, st) => (ev.cls + ' · ' + ev.name + ' · ' + st).slice(0, 160);
const hsTick = (ev, st) => { if (!logs.marks) return null; const n = hsName(ev, st), rows = logs.marks.rows.filter(r => r.cls === HS_CLS && r.name === n); const l = rows[rows.length - 1]; return l && l.status === HS_DONE ? l : null; };
// The class lessons from the day the pupil joined (the trial lesson first), from the Schedule weeks loaded on this page.
function hsLessons(ev) {
  const seen = new Set();
  return Object.values(weeks).flatMap(w => w.data.sessions || []).filter(s => !s.off && s.day >= ev.day && Q.key(Q.clean(s.cls).replace(/\.\d+$/, '')) === Q.key(ev.cls))
    .filter(s => { const k = s.day + '|' + s.start; if (seen.has(k)) return false; seen.add(k); return true; }).sort((a, b) => a.day.localeCompare(b.day) || a.start - b.start);
}
function hsSteps(ev) {
  const lessons = hsLessons(ev), trial = lessons.find(s => s.day === ev.day) || lessons[0], after = lessons.filter(s => s.day > ev.day);
  const cn = homeroom[Q.key(ev.cls)] || (trial && trial.ta) || '', gv = (trial && trial.teacher) || '';
  return HS_STEPS.map(([k, label, role, at]) => {
    const n = typeof at === 'string' ? Number(at.slice(1)) : 0;
    const due = n ? (after[n - 1] ? after[n - 1].day : Q.addDays(ev.day, 7 * n)) : Q.addDays(ev.day, at);
    const owner = role === 'cn' ? cn : role === 'gv' ? gv : '';
    return { k, label, role, due, owner, done: hsTick(ev, k), mine: role === 'ql' ? isManager() : isMe(owner) };
  });
}
const hsBtn = (ev, st, v, cls, label) => '<button class="' + cls + '" data-act="hsTick" data-k="' + esc(hsName(ev, st)) + '" data-v="' + v + '">' + label + '</button>';
const hsPupil = ev => '<b>' + esc(ev.eng || ev.name) + '</b> <small>' + esc(ev.name) + '</small> · ' + esc(ev.cls);
popSection({ k: 'hs', icon: '🆕', title: () => T('Học sinh mới · từng việc', 'New pupils · each step'),
  items: () => {
    const t = today();
    hsLoad();
    return (hsData.list || []).filter(ev => ev.day >= HS_POP_FROM).map(ev => {
      const due = hsSteps(ev).filter(x => !x.done && x.due <= t && (x.mine || (isManager() && x.due < t)));
      if (!due.length) return null;
      return { hot: due.some(x => x.due < t), html: '<div class="ph-cls">' + hsPupil(ev) + '<span class="muted small"> · ' + T('vào lớp ', 'joined ') + viDate(ev.day).slice(0, 5) + '</span>' +
        due.map(x => '<div class="ph-line"><span class="ph-who' + (x.due < t ? ' ph-none' : '') + '">' + esc(x.label) + ' <small>· ' + esc(x.owner ? titleCase(x.owner) : HS_WHO[x.role]) + (x.due < t ? ' · ' + T('trễ từ ', 'late since ') + viDate(x.due).slice(0, 5) : '') + '</small></span><span class="ph-btns">' + hsBtn(ev, x.k, HS_DONE, 'good', '✅ ' + T('Xong', 'Done')) + '</span></div>').join('') + '</div>' };
    }).filter(Boolean);
  } });
document.addEventListener('click', e => {
  const b = e.target.closest && e.target.closest('[data-act="hsTick"]');
  if (!b) return;
  e.stopPropagation();
  appendMark({ day: today(), cls: HS_CLS, lesson: '', start: 0 }, { row: '', name: b.dataset.k, eng: '' }, b.dataset.v);
  say(b.dataset.v === HS_DONE ? T('Đã ghi xong việc này, có tên bạn và giờ bấm.', 'Saved with your name and the time.') : T('Đã bỏ dấu.', 'Undone.'));
  render();
}, true);
// Bell, and the quick list on Lịch with every step of every new pupil: who ticked it and when (the trail), or who still has it.
QA.hsmoi = ['Học sinh mới', 'New pupils', '<circle cx="9" cy="7" r="4"/><path d="M3 21v-2a4 4 0 0 1 4-4h4a4 4 0 0 1 4 4v2M19 8v6M16 11h6"/>'];
const bellItemsBeforeHs = bellItems;
bellItems = function () {
  const out = bellItemsBeforeHs();
  try {
    hsLoad();
    const t = today(), left = (hsData.list || []).reduce((n, ev) => n + hsSteps(ev).filter(x => !x.done && x.due <= t && (x.mine || isManager())).length, 0);
    if (left) out.push({ k: 'hsmoi', icon: '🆕', text: left + T(' việc học sinh mới đến hạn', ' new-pupil steps due'), n: left, hot: true, go: { view: 'lich', sec: 'homnay' } });
  } catch (e) {}
  return out;
};
const qaRowsBeforeHs = qaRows;
qaRows = function (kind) {
  if (kind !== 'hsmoi') return qaRowsBeforeHs(kind);
  const t = today(), out = [];
  // Owner 13/11: "hs mới đã tick rồi cứ hiện đây làm gì": only the steps still to do are listed; a ticked step leaves the list.
  (hsData.list || []).forEach(ev => hsSteps(ev).filter(x => !x.done).forEach(x => {
    const mine = x.done && (isManager() || isMe(x.done.by));
    out.push({ key: 'hsmoi|' + hsName(ev, x.k), cls: ev.cls, who: (ev.eng || ev.name) + ' · ' + x.label,
      reason: x.done ? '✓ ' + titleCase(x.done.by || '?') + ' ' + String(x.done.at || '').slice(11, 16) + ' ' + String(x.done.at || '').slice(0, 5) : (x.owner ? titleCase(x.owner) : HS_WHO[x.role]) + ' · ' + (x.due < t ? T('trễ từ ', 'late since ') : T('hạn ', 'due ')) + viDate(x.due).slice(0, 5),
      btn: x.done ? (mine ? hsBtn(ev, x.k, 'Bỏ', 'quiet', T('Bỏ', 'Undo')) : '') : (x.mine || isManager() ? hsBtn(ev, x.k, HS_DONE, 'good', ico('check')) : ''), hot: !x.done && x.due < t });
  }));
  return out;
};

/* ---------- Owner 11/11: tuition to-dos for managers ("học phí đến hạn thu hay đến hạn nhắc… popup gọn gàng"; "tab học phí có chữ gì đó
 * để quản lí click vào") ----------
 * The tuition app, running in this page's Học phí frame, sends its Tổng quan counts (classes due to collect, students to remind again,
 * sends not ticked, roster moves, tutor reminders). The frame is also loaded quietly once this device has the tuition link, and
 * reloaded hourly while hidden. Managers see a red count on the Học phí tab and one line per kind in "Việc cần làm"; a line leaves
 * when the work is done in the tuition app (its own ticks). */
let hpViec = null;
try { hpViec = JSON.parse(localStorage.getItem('ql-hp-viec') || 'null'); } catch (e) { hpViec = null; }
addEventListener('message', e => {
  if (e.origin !== location.origin || !e.data || e.data.type !== 'hp-viec') return;
  hpViec = { at: e.data.at, viec: e.data.viec || {} };
  try { localStorage.setItem('ql-hp-viec', JSON.stringify(hpViec)); } catch (err) {}
  render();
});
let hpBgAt = 0;
function hpBackground() {
  if (!me || !isManager() || isBoard() || !hpDone() || view === 'hocphi') return;
  let f = document.getElementById('hpFrame');
  if (!f) { f = document.createElement('iframe'); f.id = 'hpFrame'; f.title = 'Học phí'; f.src = HOC_PHI_URL; f.setAttribute('allow', 'clipboard-write'); f.hidden = true; document.body.appendChild(f); hpBgAt = Date.now(); return; }
  if (f.hidden && Date.now() - hpBgAt > 60 * 60 * 1000) { hpBgAt = Date.now(); try { f.contentWindow.location.reload(); } catch (e) { f.src = f.src; } }
}
const hpLines = () => {
  if (!hpViec || !isManager() || isBoard()) return [];
  const v = hpViec.viec || {}, out = [];
  if ((v.den || []).length) out.push({ hot: true, text: T('Đến hạn thu: ', 'Due to collect: ') + v.den.join(', ') });
  if (v.nhac) out.push({ hot: true, text: v.nhac + T(' em gửi quá hạn chưa thấy nộp, cần nhắc lại', ' students to remind again') + ((v.nhacLop || []).length ? ' (' + v.nhacLop.join(', ') + ')' : '') });
  if (v.chuaGui) out.push({ hot: false, text: v.chuaGui + T(' em chưa tick đã gửi Zalo', ' sends not ticked') });
  if (v.bienDong) out.push({ hot: false, text: v.bienDong + T(' biến động học sinh cần xử lí', ' roster moves to handle') });
  if (v.tutor) out.push({ hot: false, text: v.tutor + T(' em tutor quá hạn chưa nộp', ' tutor students to remind') });
  return out;
};
popSection({ k: 'hp', icon: '💰', title: () => T('Học phí', 'Tuition'),
  items: () => hpLines().map(l => ({ hot: l.hot, html: '<div class="ph-line"><span class="ph-who' + (l.hot ? ' ph-none' : '') + '">' + esc(l.text) + '</span><span class="ph-btns"><button class="good" data-act="hpGo">' + T('Mở Học phí', 'Open') + '</button></span></div>' })) });
document.addEventListener('click', e => {
  if (!(e.target.closest && e.target.closest('[data-act="hpGo"]'))) return;
  e.stopPropagation();
  offSnoozeUntil = Date.now() + 5 * 60 * 1000;
  view = 'hocphi'; render();
}, true);
// The red count on the Học phí tab.
const renderBeforeHp = render;
render = function () {
  renderBeforeHp();
  try {
    hpBackground();
    const n = hpLines().length, b = document.querySelector('#nav [data-v="hocphi"]');
    if (b && n && !b.querySelector('.hp-dot')) b.insertAdjacentHTML('beforeend', ' <span class="hp-dot">' + n + '</span>');
  } catch (e) {}
};

/* ---------- Owner 11/11 (board photo, IELTS 47 on a portrait board: "bên cạnh trắng trơn… tích hợp biểu tượng để chọn luôn") ----------
 * In the narrow layout the icon buttons grow to use the empty width beside the names (34–64 px), so they are easy to see and tap. */
const paintStripBeforeSize = paintStrip;
let rvqBest = { key: '', size: 0 };
paintStrip = function () {
  paintStripBeforeSize();
  if (!stripOn()) return;
  const list = document.querySelector('.rv-list'), row = list && list.querySelector('.rv-row:not(.open) .rv-quick');
  if (!list || !row || document.querySelector('.ll-sheet')) return;
  // A tall window (portrait board): one pupil per line, name on the left and the icons in the free space on its right (owner 11/11).
  list.classList.remove('rv-stack');
  list.classList.toggle('rv-tall', innerHeight > innerWidth * 1.2);
  // (13/11: the number of icons in the first row no longer restarts the search; it changed with every roll-call tap.)
  const key = [innerWidth, innerHeight, list.children.length].join('|'), eff = () => { const q = list.querySelector('.rv-row:not(.open) .rv-q'); return q ? q.getBoundingClientRect().width : 0; };
  // Try a few button sizes; keep the one that ends up biggest on screen after the class is fitted to the window.
  if (rvqBest.key !== key) {
    list.style.removeProperty('--rvq'); fitClassScreen();
    let best = { size: 0, shown: eff() };
    [64, 56, 48, 42].forEach(size => { list.style.setProperty('--rvq', size + 'px'); fitClassScreen(); const shown = eff(); if (shown > best.shown + 1) best = { size, shown }; });
    rvqBest = { key, size: best.size };
  }
  if (rvqBest.size) list.style.setProperty('--rvq', rvqBest.size + 'px'); else list.style.removeProperty('--rvq');
  fitClassScreen();
};

/* ---------- Owner 11/11 ("dùng bộ đếm chung với dash… dash chính xác"): KIDS owed work comes from the parent pages ----------
 * The server reads each pupil's parent-page data and returns what that page counts as overdue (op 'dashno', kept 10 minutes).
 * The class screen, the lesson card line and the summary use it; a pupil without a parent link (or before the answer arrives)
 * keeps the sheet-based count. Work due on the lesson day counts once the class opens for roll call, 30 minutes before the lesson
 * (owner: "đếm tới lúc mở lớp"; 14/11 "đếm bài thiếu đến lúc mở lớp điểm danh còn sai": it used to wait for the lesson's start time). */
/* ---------- Owner 12/11 ("đọc bài tập về nhà bị sao thì sao... làm sao tối ưu nhất"): KIDS parent pages read by the staff device ----------
 * The parent pages live on the same site as this app, so a teacher's or manager's device reads them directly: the class gives
 * its parent links (op dashlinks, read from the sheet), the class page names its dashboard server, and each pupil's data file is
 * named by the SHA-256 of the link key, exactly as the parent page does. The same rules as the server (dashNo_) pick what is
 * overdue. The answer is then left on the server (op dashnoput), so the class screen and every other device get it without the
 * server fetching anything: no Google UrlFetch allowance is used. If the device cannot read the pages, the server is asked. */
const dashHost = {};
const dashIsoOf = d => { const m = String(d || '').match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/); return m ? m[3] + '-' + m[2].padStart(2, '0') + '-' + m[1].padStart(2, '0') : ''; };
const dashMsOf = s => { const m = String(s || '').match(/(\d{1,2})\/(\d{1,2})\/(\d{4})\D+(\d{1,2}):(\d{2})(?::(\d{2}))?/); return m ? Date.UTC(+m[3], +m[2] - 1, +m[1], +m[4] - 7, +m[5], +(m[6] || 0)) : 0; };
function dashResubmitOf(comment, attempts) {
  const c = String(comment || '');
  if (!c.includes('CẦN NỘP LẠI')) return false;
  const times = (attempts || []).map(a => Number(a.submittedAtMs) || dashMsOf(a.submittedAt)).filter(Boolean).sort((a, b) => a - b);
  const m = c.match(/CẦN NỘP LẠI(?:\s*\([^)]*\))?\s*(\d{1,2}\/\d{1,2}\/\d{4}\s+\d{1,2}:\d{2})/);
  if (m) { const stamp = dashMsOf(m[1]); return !times.some(t => t >= stamp + 60000); }
  for (let i = 1; i < times.length; i++) if (times[i] >= Date.UTC(2026, 10, 5, 17) && times[i] - times[i - 1] >= 7200000) return false;
  return true;
}
async function dashSha(s) { const b = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s)); return [...new Uint8Array(b)].map(x => x.toString(16).padStart(2, '0')).join(''); }
function dashItemsOf(prof, day) {
  const items = [], join = dashIsoOf(prof.joinDate);
  (prof.selfPractice || []).forEach(x => {
    const due = dashIsoOf(x.dueDate), label = 'Tự luyện ' + Q.clean(String(x.title || '').split('\n')[0]);
    if (x.state && dashResubmitOf(x.teacherComment, x.submissionAttempts)) items.push({ practice: true, resubmit: true, label, due });
    else if (!x.state && due && due <= day && (!join || due >= join)) items.push({ practice: true, label, due });
  });
  (prof.assignments || []).forEach(a => {
    if (a.kind !== 'lesson') return;
    const due = dashIsoOf(a.dueDate);
    (a.tasks || []).forEach(t => {
      if (String(t.requiresSubmission) === 'false') return;
      const fb = t.feedback || {}, tl = Q.clean(t.title || 'Bài trên web').slice(0, 60);
      if ((fb.state || a.state) && dashResubmitOf(fb.teacherComment, fb.submissionAttempts)) { items.push({ lesson: Number(a.sessionNumber) || '', resubmit: true, label: tl, due }); return; }
      if (a.state || fb.state || !due || due > day || (join && due < join)) return;
      items.push({ lesson: Number(a.sessionNumber) || '', label: tl, due });
    });
  });
  return items;
}
async function dashNoBrowser(cls) {
  const num = (cls.match(/^KIDS\s*(\d+)$/i) || [])[1];
  if (!num) return { pupils: [], skip: 'không phải lớp KIDS' };
  const links = (((await call('dashlinks', { cls })) || {}).links || []).map(x => { const m = x.url.match(/github\.io\/([a-z0-9]+)\/#p=([A-Za-z0-9_-]+)/i); return m && { row: x.row, page: m[1], token: m[2] }; }).filter(Boolean);
  if (!links.length) return { pupils: [], skip: 'không có link học sinh' };
  const page = links[0].page;
  let host = dashHost[page] || (saved.get('dashHost') || {})[page];
  if (!host) {
    const html = await (await fetch('/' + page + '/', { cache: 'no-store' })).text();
    host = (html.match(/https:\/\/[a-z0-9.-]+\.workers\.dev/) || [])[0];
    if (!host) throw new Error('không thấy máy chủ dash của lớp');
    dashHost[page] = host; keep('dashHost', Object.assign({}, saved.get('dashHost') || {}, { [page]: host }));
  }
  const day = today(), out = new Array(links.length), queueList = links.map((p, i) => i);
  const worker = async () => {
    while (queueList.length) {
      const i = queueList.shift(), p = links[i], item = { row: p.row, ok: false, items: [] };
      try {
        const r = await fetch(host + '/data/' + num + '/' + await dashSha(p.token) + '.json', { cache: 'no-store' });
        if (!r.ok) throw new Error('HTTP ' + r.status);
        item.items = dashItemsOf(((await r.json()).actions.bootstrap.profile) || {}, day); item.ok = true;
      } catch (e) { item.error = String(e.message || e).slice(0, 80); }
      out[i] = item;
    }
  };
  await Promise.all([1, 2, 3, 4, 5, 6].map(worker));
  if (!out.some(p => p.ok)) throw new Error('không đọc được trang dash nào');
  const answer = { at: new Date().toLocaleString('vi-VN'), today: day, pupils: out, by: 'browser' };
  call('dashnoput', { cls, pupils: out, today: day }).catch(() => {});
  return answer;
}
// Staff devices read the pages themselves; the class screen (and any device that cannot) asks the server, which answers from
// what a staff device left there or, failing that, reads the pages itself.
// Owner 12/11 ("có sợ máy người ta chặn gì không"): one pupil's page data is about half a megabyte, so a device reads a class at most
// every 10 minutes (every 2 minutes when asked fresh, e.g. while closing the lesson) and reuses its last answer in between.
const dashMine = {};
async function dashNoGet(cls, fresh) {
  if (!isBoard()) {
    const k = Q.key(cls), hit = dashMine[k], age = hit ? Date.now() - hit.at : Infinity;
    if (hit && age < (fresh ? 120000 : 600000)) return hit.data;
    if (hit && hit.busy) return hit.data;
    // Owner 13/11 ("đọc thẳng từ dash… không hết quota"): another device may have read this class's pages a moment ago and left the
    // result at the gateway; take that instead of reading every pupil's page again.
    try {
      const g = await call('dashno', { cls, fresh: !!fresh, peek: true }, 1);
      if (g && Array.isArray(g.pupils) && g.pupils.length) { dashMine[k] = { at: Date.now(), data: g }; return g; }
    } catch (e) { /* read the pages below */ }
    try {
      dashMine[k] = Object.assign({}, hit, { busy: true });
      const data = await dashNoBrowser(cls);
      dashMine[k] = { at: Date.now(), data };
      return data;
    } catch (e) { console.warn('dash browser', e); if (hit) dashMine[k] = hit; else delete dashMine[k]; }
  }
  return call('dashno', fresh ? { cls, fresh: true } : { cls });
}
const dashOwed = {};
function dashOwedFor(ctx) {
  const s = ctx && ctx.session;
  if (!s || !ctx.tracker || isSecondary(s) || !/^KIDS\s*\d+/i.test(Q.clean(s.cls))) return null;
  const c = classOf(s);
  if (!c) return null;
  const hit = dashOwed[c.key];
  if ((!hit || Date.now() - hit.at > 5 * 60 * 1000) && !(hit && hit.loading)) {
    dashOwed[c.key] = Object.assign({ at: 0 }, hit, { loading: true });
    dashNoGet(Q.clean(s.cls).replace(/\.\d+$/, '')).then(d => { dashOwed[c.key] = { at: Date.now(), data: d }; })
      .catch(() => { dashOwed[c.key] = { at: Date.now(), data: hit && hit.data || null }; }).finally(() => { try { owedMemo.key = ''; } catch (e) {} render(); });
  }
  const d = hit && hit.data;
  if (!d || !d.pupils || !d.pupils.length) return null;
  const byRow = new Map(d.pupils.filter(p => p.ok).map(p => [p.row, p.items]));
  return ctx.tracker.pupils.map(p => byRow.has(p.row) ? byRow.get(p.row) : null);
}
const dashToOwed = x => ({ col: -1, day: x.due, lesson: x.lesson || '', label: x.label, wrong: false, practice: !!x.practice });
const owedOfBeforeDash = owedOf;
owedOf = function (ctx) {
  const base = owedOfBeforeDash(ctx), dash = dashOwedFor(ctx);
  if (!dash) return base;
  const s = ctx.session, started = s.day < today() || (s.day === today() && minutesNow() >= s.start - Q.OPEN_BEFORE);
  return ctx.tracker.pupils.map((p, i) => dash[i] ? dash[i].filter(x => !x.resubmit && (x.due < s.day || (started && x.due === s.day))).map(dashToOwed) : (base[i] || []));
};
const totalOwedBeforeDash = totalOwed;
totalOwed = function (ctx) {
  const base = totalOwedBeforeDash(ctx), dash = dashOwedFor(ctx);
  if (!dash) return base;
  return ctx.tracker.pupils.map((p, i) => dash[i] ? dash[i].filter(x => !x.resubmit && x.due < ctx.session.day).map(dashToOwed) : (base[i] || []));
};


/* ---------- Owner 11/11 ("dash ntn thì web lớp hiển thị như thế… lúc chốt lớp dữ liệu phải đúng như dash mới nhất") ----------
 * As on the parent page, work to redo ("🔁 Cần nộp lại": a teacher/grader notice not yet answered by a new receipt) is its own line,
 * not counted with overdue work. Opening the review-and-close sheet (or "↻ Đọc lại sheet") asks the server for a fresh read of
 * the parent pages instead of its 10-minute copy. */
function dashRedoOf(ctx, i) { const d = dashOwedFor(ctx); return d && d[i] ? d[i].filter(x => x.resubmit) : []; }
const redoTag = list => '<span class="rv-flag debt" title="' + esc(list.map(x => Q.clean(x.label)).join('\n')) + '">🔁 ' + T('Cần nộp lại ', 'To redo ') + list.length + T(' bài', '') + ': ' + esc(list.slice(0, 2).map(x => x.practice ? Q.clean(x.label) : 'Tiết ' + x.lesson).join(', ') + (list.length > 2 ? ' +' + (list.length - 2) : '')) + '</span>';
const pupilFlagsBeforeRedo = pupilFlags;
pupilFlags = function (ctx, r) {
  const h = pupilFlagsBeforeRedo(ctx, r), redo = dashRedoOf(ctx, r.i);
  if (!redo.length) return h;
  return h ? h.replace(/<\/span>$/, redoTag(redo) + '</span>') : '<span class="rv-flags">' + redoTag(redo) + '</span>';
};
function refreshDashNow(s) {
  const c = s && classOf(s);
  if (!c || isSecondary(s) || !/^KIDS\s*\d+/i.test(Q.clean(s.cls))) return;
  dashOwed[c.key] = Object.assign({}, dashOwed[c.key], { loading: true });
  dashNoGet(Q.clean(s.cls).replace(/\.\d+$/, ''), true).then(d => { dashOwed[c.key] = { at: Date.now(), data: d }; })
    .catch(() => { dashOwed[c.key] = Object.assign({}, dashOwed[c.key], { loading: false }); }).finally(() => { try { owedMemo.key = ''; } catch (e) {} render(); });
}
const refreshOwedNowBeforeDash = refreshOwedNow;
refreshOwedNow = function (s) {
  const c = s && classOf(s), key = c ? c.tracker + '|' + s.day : '', was = owedFreshAt[key] || 0;
  refreshOwedNowBeforeDash(s);
  if (c && owedFreshAt[key] !== was) refreshDashNow(s);
};

/* ---------- Owner 11/11 ("lúc chốt buổi auto nạp lại để chuẩn… con đi học, ở nhà bố mẹ nộp bài") ----------
 * Confirming the close re-reads the parent pages at once, and while the review-and-close sheet is on screen it is re-read every
 * minute, so work a parent hands in during the lesson leaves the list before the photo is taken. */
function closeReread() {
  const c = current && classOf(current);
  if (!c) return;
  owedFreshAt[c.tracker + '|' + current.day] = 0;
  refreshOwedNow(current);
}
const llActionBeforeCloseReread = llAction;
llAction = function (act, i, v) {
  const r = llActionBeforeCloseReread(act, i, v);
  if (act === 'llChot' && current) closeReread();
  return r;
};
setInterval(() => {
  try { if (view === 'lenlop' && current && llSummary && llSummary.mode && document.visibilityState === 'visible') closeReread(); } catch (e) {}
}, 60000);

/* ---------- Owner 11/11 ("tất cả đi cả ielts fighter… quy tắc y hệt dash"): IELTS / FIGHTER owed work from the parent pages ----------
 * Their pages count the work themselves, so a staff device opens each pupil's page out of sight (same site, hidden frame) and asks
 * the page's own list: FIGHTER fighterPendingEntriesV15_, IELTS ielts<N>PendingHomeworkEntriesV<n>_. "overdue" entries are the
 * work owed. The answer goes to the server for 20 minutes so the class screen account (which never gets the links) shows the same.
 * Re-read every 10 minutes, at once when the close sheet opens, and on "↻ Đọc lại sheet". A pupil whose page did not answer keeps
 * the sheet-based list. */
const pageRun = {};
function runParentPage(url) {
  return new Promise(resolve => {
    const f = document.createElement('iframe');
    f.setAttribute('aria-hidden', 'true'); f.tabIndex = -1;
    f.style.cssText = 'position:fixed;left:-10000px;top:0;width:900px;height:700px;border:0;visibility:hidden;pointer-events:none';
    let n = 0;
    const done = v => { clearInterval(timer); try { f.remove(); } catch (e) {} resolve(v); };
    const timer = setInterval(() => {
      n++;
      try {
        const w = f.contentWindow;
        let list = null;
        if (w && typeof w.fighterPendingEntriesV15_ === 'function' && w.fighterPendingStudentV15_) list = w.fighterPendingEntriesV15_(w.fighterPendingStudentV15_);
        else if (w) {
          const k = Object.keys(w).find(x => /^ielts\d+PendingHomeworkEntriesV\d+_$/.test(x));
          if (k) { const v = w[k](); if (Array.isArray(v) && (v.length || n > 24)) list = v; }
        }
        if (Array.isArray(list)) return done(list.map(x => ({ status: String(x.status || ''), label: Q.clean(x.label || x.title || '') })));
      } catch (e) { /* the page is still loading */ }
      if (n > 70) done(null);
    }, 500);
    f.src = url;
    document.body.appendChild(f);
  });
}
async function startPageRun(s, c) {
  const cls = Q.clean(s.cls).replace(/\.\d+$/, '');
  pageRun[c.key] = Object.assign({}, pageRun[c.key], { running: true });
  try {
    let rows = null;
    if (isBoard()) rows = ((await call('dashget', { cls })) || {}).rows || null;
    else {
      const links = ((await call('dashlinks', { cls })) || {}).links || [], queue = links.slice();
      rows = [];
      const worker = async () => { while (queue.length) { const l = queue.shift(), r = await runParentPage(l.url); if (r) rows.push({ row: l.row, owed: r.filter(e => e.status === 'overdue').map(e => e.label), all: r.length }); } };
      await Promise.all([worker(), worker()]);
      if (rows.length) call('dashput', { cls, rows }).catch(() => {});
    }
    pageRun[c.key] = { at: Date.now(), rows, running: false };
  } catch (e) { pageRun[c.key] = { at: Date.now(), rows: (pageRun[c.key] || {}).rows || null, running: false }; }
  render();
}
function pageRunFor(s, force) {
  const c = s && classOf(s);
  if (!c || !isSecondary(s)) return null;
  const st = pageRun[c.key];
  if ((force || !st || Date.now() - st.at > 10 * 60 * 1000) && !(st && st.running)) startPageRun(s, c);
  return st && st.rows && st.rows.length ? st : null;
}
const secOwedForBeforePage = secOwedFor;
secOwedFor = function (s) {
  const base = secOwedForBeforePage(s), run = pageRunFor(s);
  if (!run) return base;
  const yesterday = Q.addDays(today(), -1), byRow = new Map(run.rows.map(r => [r.row, r]));
  const pupils = (base && base.data && base.data.pupils || []).filter(p => !byRow.has(p.row));
  const tr = trackers[(classOf(s) || {}).key], who = row => (tr && tr.pupils.find(p => p.row === row)) || {};
  run.rows.forEach(r => { if (r.owed.length) pupils.push({ row: r.row, name: who(r.row).name || '', eng: who(r.row).eng || '', owed: r.owed.map(label => ({ label, due: yesterday, self: /tự luyện|reading intensive|listening|shadowing/i.test(label) })) }); });
  return { at: run.at, data: { pupils } };
};
const refreshOwedNowBeforePage = refreshOwedNow;
refreshOwedNow = function (s) {
  const c = s && classOf(s), key = c ? c.tracker + '|' + s.day : '', was = owedFreshAt[key] || 0;
  refreshOwedNowBeforePage(s);
  if (c && isSecondary(s) && owedFreshAt[key] !== was) pageRunFor(s, true);
};

/* ---------- IELTS lesson comments on the web (owner 12/11: "giáo viên ghi bằng tiếng Anh và bạn sẽ tự dịch sang tiếng Việt... ghi vào
 * luôn ô nhận xét sheet... với IELTS thì cứ thẳng thắn... xưng cô/thầy và em, không xưng con... tất cả những lần kiểm tra nữa sẽ có ô
 * mở ra... không chốt sớm quá... nhanh, không hết quota") ----------
 * Every IELTS lesson with a "Nhận xét Buổi học" column (tests included) gets "📝 Comments" on the class screen and on the close sheet.
 * The teacher types English for each pupil; "a save goes by itself a few seconds after typing stops and sends only the changed ones in one call. The server translates them
 * with the same Google translation as the KIDS reasons (cached, so an unchanged comment is never translated twice), speaks as
 * "thầy"/"cô" (staff list, column Giới tính) to "em", and writes "💬 Nhận xét của cô: …" under the reminders in the cell. The English
 * is kept in NHAN_XET_GV so it opens again for editing. Teachers, TAs and the class screen can edit until 23:59 of the lesson day,
 * after the close too; managers at any time. Drafts stay on the device until they are saved. */
const NX_MARK = '💬', NX_MAX = 1800;
const nx = { open: false, key: '', rows: null, loading: false, saving: false, error: '', timer: null, again: false, savedAt: 0 };
// Speaking only (owner 12/11: "Writing tôi không nhận xét trên lớp nhé nên không cần có nút").
const nxCol = ctx => ctx && ctx.block && ctx.tracker && /^IELTS/.test(Q.key(ctx.session.cls)) && ctx.block.skill === 'NOI' && ctx.block.nx >= 0 ? ctx.block.nx : -1;
const nxCan = s => !!me && (isManager() || s.day === today());
const nxDrafts = () => saved.get('nxDraft') || {};
const nxDk = (s, p) => Q.sessionKey(s) + '|' + p.name;
function nxSavedEn(p) { const r = nx.rows && nx.rows[Q.key(p.name)]; return r ? r.en : ''; }
function nxText(p, s) { const d = nxDrafts()[nxDk(s, p)]; return d != null ? d : nxSavedEn(p); }
function nxCellVi(ctx, p) { const v = String(ctx.tracker.cell(p.row, nxCol(ctx)) || ''), at = v.indexOf(NX_MARK); return at >= 0 ? v.slice(at).replace(/^💬\s*/, '') : ''; }
function nxLoad(s, force) {
  const key = Q.sessionKey(s);
  if (nx.loading || (!force && nx.key === key && nx.rows)) return;
  nx.loading = true; nx.error = '';
  call('nxlay', { cls: Q.clean(s.cls), day: s.day, lesson: String(s.lesson) })
    .then(r => { nx.key = key; nx.rows = {}; (r.rows || []).forEach(x => { nx.rows[Q.key(x.name)] = x; }); })
    .catch(e => { nx.error = e.message; })
    .finally(() => { nx.loading = false; render(); });
}
function nxButton(ctx) {
  if (nxCol(ctx) < 0 || !nxCan(ctx.session)) return '';
  const pupils = ctx.tracker.pupils, done = pupils.filter(p => nxCellVi(ctx, p)).length;
  return '<button class="quiet nx-btn" data-act="nxOpen">📝 ' + T('Nhận xét', 'Comments') + ' <small>' + done + '/' + pupils.length + '</small></button>';
}
function nxDialog() {
  if (!nx.open || !current) return '';
  const ctx = classContext(current), s = ctx.session;
  if (nxCol(ctx) < 0) return '';
  if (nx.key !== Q.sessionKey(s) || !nx.rows) nxLoad(s);
  const can = nxCan(s), dr = nxDrafts();
  const changed = ctx.tracker.pupils.filter(p => dr[nxDk(s, p)] != null && dr[nxDk(s, p)] !== nxSavedEn(p)).length;
  const absent = p => { const m = ctx.marks.get(p.name); return !!m && (m.status === NGHI || Q.ABSENT.includes(m.status)); };
  let h = '<div class="ll-veil" data-act="nxClose"></div><div class="ll-sheet nx-sheet" role="dialog" aria-label="' + T('Nhận xét buổi học', 'Lesson comments') + '">' +
    '<div class="row-top"><b>📝 ' + esc(s.cls) + T(' · Tiết ', ' · Lesson ') + esc(s.lesson) + '</b><span class="spacer"></span><button class="quiet" data-act="nxClose">' + T('Đóng', 'Close') + '</button></div>' +
    '<div class="small muted">' + T('Viết nhận xét bằng tiếng Anh. App tự dịch sang tiếng Việt (xưng thầy/cô – em) và ghi vào ô "Nhận xét Buổi học" của sheet. Sửa được đến 23:59 hôm nay.', 'Write each comment in English. The app translates it into Vietnamese and writes it into the class sheet. You can edit until 23:59 today.') + '</div>';
  if (nx.error) h += '<div class="notice bad">' + esc(nx.error) + '</div>';
  if (!nx.rows) h += '<div class="small muted">' + T('Đang đọc nhận xét đã lưu…', 'Reading saved comments…') + '</div>';
  h += ctx.tracker.pupils.map(p => {
    const k = nxDk(s, p), text = nxText(p, s), vi = nxCellVi(ctx, p), dirty = dr[k] != null && dr[k] !== nxSavedEn(p);
    return '<div class="nx-row' + (absent(p) ? ' off' : '') + '"><div class="row-top"><b>' + esc(p.eng || p.name) + '</b>' + (absent(p) ? '<span class="tag">' + T('Vắng', 'Absent') + '</span>' : '') + '<span class="spacer"></span>' +
      (dirty ? '<span class="tag warn">' + T('Chưa lưu', 'Not saved') + '</span>' : vi ? '<span class="tag ok">✓ ' + T('Đã ghi sheet', 'In the sheet') + '</span>' : '') + '</div>' +
      '<textarea data-act="nxField" data-k="' + esc(k) + '" rows="3" maxlength="1200" lang="en" spellcheck="true"' + (can ? '' : ' disabled') + ' placeholder="' + T('Nhận xét bằng tiếng Anh…', 'Comment in English…') + '">' + esc(text) + '</textarea>' +
      (vi ? '<div class="small nx-vi">🇻🇳 ' + esc(vi) + '</div>' : '') + '</div>';
  }).join('');
  if (can) h += '<div class="choices nx-foot"><span class="small nx-state">' + nxStateText(changed) + '</span></div>';
  return h + '</div>';
}
// Owner 12/11: "tự động lưu nhé". A save goes 4 s after the teacher stops typing, at once when they leave the box or close the list.
function nxStateText(changed) {
  if (nx.saving) return '⏳ ' + T('Đang dịch và lưu…', 'Translating and saving…');
  if (nx.error) return '⚠️ ' + esc(nx.error);
  if (changed) return '✏️ ' + T('Sẽ tự lưu sau vài giây', 'Saves automatically in a few seconds');
  return nx.savedAt ? '✓ ' + T('Đã tự lưu và ghi vào sheet', 'Saved to the sheet') : '✓ ' + T('Tự động lưu', 'Saves automatically');
}
function nxSoon(ms) { if (nx.timer) clearTimeout(nx.timer); nx.timer = setTimeout(() => { nx.timer = null; if (current && nx.open) nxSave(true); }, ms); }
// Updates the tags and the footer without redrawing the boxes, so the cursor stays where the teacher is typing.
function nxPaint() {
  const box = document.querySelector('.nx-sheet');
  if (!box || !current) return render();
  const ctx = classContext(current), s = ctx.session, dr = nxDrafts();
  let changed = 0;
  box.querySelectorAll('textarea[data-act="nxField"]').forEach(t => {
    const p = ctx.tracker.pupils.find(q => nxDk(s, q) === t.dataset.k), row = t.closest('.nx-row');
    if (!p || !row) return;
    const dirty = dr[t.dataset.k] != null && dr[t.dataset.k] !== nxSavedEn(p), vi = nxCellVi(ctx, p);
    if (dirty) changed++;
    const tag = row.querySelector('.row-top .tag.warn, .row-top .tag.ok'), html = dirty ? '<span class="tag warn">' + T('Chưa lưu', 'Not saved') + '</span>' : vi ? '<span class="tag ok">✓ ' + T('Đã ghi sheet', 'In the sheet') + '</span>' : '';
    if (tag) tag.outerHTML = html; else if (html) row.querySelector('.row-top').insertAdjacentHTML('beforeend', html);
    let v = row.querySelector('.nx-vi');
    if (vi) { if (!v) { t.insertAdjacentHTML('afterend', '<div class="small nx-vi"></div>'); v = row.querySelector('.nx-vi'); } v.textContent = '🇻🇳 ' + vi; } else if (v) v.remove();
  });
  const st = box.querySelector('.nx-state'), btn = box.querySelector('[data-act="nxSave"]');
  if (st) st.innerHTML = nxStateText(changed);
  if (btn) btn.disabled = nx.saving || !changed;
}
async function nxSave(auto) {
  const ctx = classContext(current), s = ctx.session, col = nxCol(ctx), dr = nxDrafts();
  if (col < 0 || !nxCan(s)) return;
  if (nx.saving) { nx.again = true; return; }
  const list = ctx.tracker.pupils.filter(p => dr[nxDk(s, p)] != null && dr[nxDk(s, p)] !== nxSavedEn(p));
  if (!list.length) { if (!auto) say(T('Không có nhận xét nào mới.', 'Nothing new to save.')); return; }
  nx.saving = true; nxPaint();
  try {
    const teacher = Q.clean(s.teacher) || (me && me.name) || '';
    const items = list.map(p => ({ name: p.name, range: quote(ctx.tracker.tab) + '!' + Q.colName(col) + p.row, en: String(dr[nxDk(s, p)] || '').trim().slice(0, 1200) }));
    const r = await call('nxghi', { file: ctx.cls.tracker, cls: Q.clean(s.cls), day: s.day, lesson: String(s.lesson), teacher, items }, 2);
    const left = Object.assign({}, nxDrafts());
    (r.items || []).forEach(x => {
      const p = list.find(q => q.name === x.name);
      if (!p) return;
      ctx.tracker.set(p.row, col, x.value);
      nx.rows = nx.rows || {}; nx.rows[Q.key(p.name)] = { name: p.name, en: x.en, vi: x.vi };
      if (String(left[nxDk(s, p)] || '').trim() === x.en) delete left[nxDk(s, p)];
    });
    keep('nxDraft', left);
    nx.error = ''; nx.savedAt = Date.now();
    if (!auto) say(T('Đã dịch và ghi ' + (r.items || []).length + ' nhận xét vào sheet.', (r.items || []).length + ' comments translated and saved.'));
  } catch (e) { nx.error = T('Chưa lưu được: ', 'Not saved: ') + e.message + T('. Nhận xét vẫn giữ trên máy, app sẽ thử lại.', '. Your text stays on this device; the app will try again.'); if (!auto) say(nx.error, 'bad'); nxSoon(20000); }
  finally { nx.saving = false; nxPaint(); if (nx.again) { nx.again = false; nxSoon(800); } }
}
document.addEventListener('input', e => {
  const b = e.target;
  if (!b || b.dataset.act !== 'nxField') return;
  const d = Object.assign({}, nxDrafts()); d[b.dataset.k] = b.value; keep('nxDraft', d);
  nxSoon(4000); nxPaint();
});
document.addEventListener('focusout', e => { if (e.target && e.target.dataset && e.target.dataset.act === 'nxField') nxSoon(300); });
window.addEventListener('pagehide', () => { if (nx.timer) { clearTimeout(nx.timer); nx.timer = null; nxSave(true); } });
document.addEventListener('click', e => {
  const b = e.target.closest && e.target.closest('[data-act]');
  if (!b || !/^nx(Open|Close|Save)$/.test(b.dataset.act)) return;
  e.stopImmediatePropagation();
  if (b.dataset.act === 'nxOpen') { nx.open = true; if (current) nxLoad(current, true); render(); }
  if (b.dataset.act === 'nxClose') { if (nx.timer) { clearTimeout(nx.timer); nx.timer = null; nxSave(true); } nx.open = false; render(); }
  if (b.dataset.act === 'nxSave') nxSave();
}, true);
const viewLenLopBeforeNx = viewLenLop;
viewLenLop = function () {
  if (nx.open && current && nx.key && nx.key !== Q.sessionKey(current)) { nx.open = false; nx.rows = null; nx.key = ''; }
  return viewLenLopBeforeNx() + nxDialog();
};
const lockBarBeforeNx = lockBar;
lockBar = function (can, edit) { let b = ''; try { b = current ? nxButton(classContext(current)) : ''; } catch (e) {} return b + lockBarBeforeNx(can, edit); };
const summaryViewBeforeNx = summaryView;
summaryView = function (ctx) { const h = summaryViewBeforeNx(ctx), b = nxButton(ctx); return b ? h.replace('<div class="sum-bar">', '<div class="sum-bar">' + b) : h; };

/* ---------- Hồ sơ lớp (owner 12/11: "Chủ nhiệm full time và TA part time... cần có danh sách học sinh, điểm, link dash... tiến tới
 * tôi muốn hoạt động hoàn toàn trên webapp, sheet chỉ là nơi để ghi... thêm hs mới, xóa hs ra, sheet vẫn đánh lại, thêm ngày new,
 * hs chuyển lớp") ----------
 * A page under Lớp chủ nhiệm: every pupil of the class with the parent-dashboard link (copy / share), phone, the day they joined,
 * attendance from the DIEM_DANH log, web homework still owed, and the marks the sheet holds (KIDS: A/B/F of the last lessons,
 * stars, paper tests; IELTS: Listening/Reading scores, estimated Speaking band). The homeroom teacher and managers can add a
 * pupil, retire one (the row goes to tab HS ĐÃ NGHỈ) or move one to another class; the server rewrites the numbers and the page
 * reloads the list. The parent link is still issued in the class file: one button opens its LINK HỌC SINH tab. */
const ho = { key: '', loading: false, err: '', info: null, q: '', filter: '', form: null, busy: false, left: null, leftOpen: false };
const hoCls = () => classList.find(c => c.key === ho.key);
const hoIsIelts = c => /^IELTS/.test(c.key);
const hoCanEdit = c => isManager() || [...myHomerooms().values()].some(x => x.cls.key === c.key && isMe(x.cm));
const hoSheetUrl = (c, gid) => 'https://docs.google.com/spreadsheets/d/' + c.tracker + '/edit' + (gid != null ? '#gid=' + gid : '');
const hoDmy = iso => { const m = String(iso || '').match(/^(\d{4})-(\d{2})-(\d{2})$/); return m ? m[3] + '/' + m[2] + '/' + m[1] : iso; };
function hoNum(v) { const m = String(v || '').match(/Điểm\s*(\d+(?:[.,]\d+)?)\s*\/\s*(\d+)/g); if (!m) return ''; const last = m[m.length - 1].match(/(\d+(?:[.,]\d+)?)\s*\/\s*(\d+)/); return last[1] + '/' + last[2]; }
function hoBand(v) { const m = String(v || '').match(/Band ước tính\s*([\d.,]+)|Estimated Band:\s*([\d.,]+)|Điểm số ước tính:\s*\n*\s*([\d.,]+)/); return m ? (m[1] || m[2] || m[3]) : ''; }
async function hoLoad(force) {
  const c = hoCls();
  if (!c || ho.loading) return;
  ho.loading = true; ho.err = '';
  try {
    const t = await loadTracker(c, force);
    const tab = quote(t.tab), head = t.head, width = Math.max(0, ...head.map(r => (r || []).length)), at = (r, k) => String((head[r] || [])[k] || '');
    const lay = { eng: -1, birth: -1, phone: -1, dash: -1 };
    for (let k = 0; k < 8; k++) { const txt = head.slice(0, 6).map(r => String((r || [])[k] || '')).join(' ').toUpperCase(); if (/NĂM SINH/.test(txt)) lay.birth = k; else if (/ĐIỆN THOẠI/.test(txt)) lay.phone = k; else if (/DASHBOARD|LINK HỒ SƠ/.test(txt)) lay.dash = k; }
    if (lay.dash !== 2) lay.eng = 2;
    // Score columns: KIDS paper tests (header KIỂM TRA, not homework), IELTS Listening/Reading (ĐIỂM · SỐ LẦN) and Speaking homework (band).
    const cols = [];
    let area = '', areaText = '';
    for (let k = 0; k < width; k++) {
      const r0 = Q.key(at(0, k)); if (r0) { area = r0; areaText = Q.clean(at(0, k)).split('\n')[0]; }
      const all = Q.key([0, 1, 2, 3, 4].map(r => at(r, k)).join(' '));
      if (/KIEM TRA/.test(area) && !/BAI TAP|NHAN XET|GHI CHU/.test(all) && (/\/\s*\d+/.test(all) || /DIEM/.test(all))) cols.push({ col: k, kind: 'test', area: areaText, max: ([3, 4, 2].map(r => (at(r, k).match(/\.{2,}\s*\/\s*(\d+)|\/\s*(\d+)\s*$/m) || [])).find(m => m[1] || m[2]) || []).filter(Boolean).slice(-1)[0] || '' });
      else if (/LISTENING|READING/.test(area) && /DIEM SO LAN/.test(all)) cols.push({ col: k, kind: /LISTENING/.test(area) ? 'L' : 'R', label: Q.clean(at(3, k)).split('\n')[0] });
      else if (/SPEAKING|KI NANG NOI/.test(area) && /NHAN XET BAI TAP/.test(all)) cols.push({ col: k, kind: 'S', label: Q.clean(at(3, k)).split('\n')[0].replace(/^Mã:\s*/, '') });
    }
    const grades = t.blocks.filter(b => b.grade >= 0).slice(-8), stars = t.blocks.filter(b => b.stars >= 0);
    const want = [...new Set(cols.map(x => x.col).concat(grades.map(b => b.grade), stars.map(b => b.stars)))].sort((a, b) => a - b);
    const ranges = [tab + '!A1:' + Q.colName(Math.max(7, lay.dash + 1)) + ROSTER_LAST].concat(want.map(k => tab + '!' + Q.colName(k) + '1:' + Q.colName(k) + ROSTER_LAST));
    const got = await batchGet(c.tracker, ranges);
    const roster = got[0] || [], vals = {};
    want.forEach((k, i) => { vals[k] = (got[i + 1] || []).map(r => (r || [])[0] || ''); });
    const cell = (row, k) => (vals[k] || [])[row - 1] || '';
    const pupils = t.pupils.map(p => {
      const r = roster[p.row - 1] || [];
      return Object.assign({}, p, { eng: Q.clean(r[lay.eng]) || p.eng, birth: lay.birth >= 0 ? Q.clean(r[lay.birth]) : '', phone: lay.phone >= 0 ? Q.clean(r[lay.phone]) : '', dash: lay.dash >= 0 ? Q.clean(r[lay.dash]) : '', raw: Q.clean(r[1]) });
    });
    const owed = Q.owedVideos(t.pupils, t.blocks, t.practices, t.cell, { day: Q.addDays(today(), 1) });
    ho.info = { at: Date.now(), tab: t.tab, lay, cols, grades, stars, cell, pupils, owed, tracker: t };
    ho.left = null;
  } catch (e) { ho.err = e.message; }
  finally { ho.loading = false; render(); }
  try { await loadMarks(); render(); } catch (e) {}
}
function hoAttend(c, p) {
  const out = { present: 0, late: 0, absent: 0 }, seen = new Set();
  ((logs.marks && logs.marks.rows) || []).forEach(m => {
    if (Q.key(m.cls).replace(/\.\d+$/, '') !== c.key || Q.key(m.name) !== Q.key(p.name)) return;
    const k = m.day + '|' + m.lesson; if (seen.has(k)) return; seen.add(k);
    if (m.status === 'Đến muộn') out.late++; else if (Q.PRESENT.includes(m.status)) out.present++; else if (Q.ABSENT.includes(m.status)) out.absent++;
  });
  return out;
}
function hoRow(c, p, i) {
  const I = ho.info, a = hoAttend(c, p), owe = (I.owed[i] || []).length, ielts = hoIsIelts(c);
  let marks = '';
  if (!ielts) {
    const g = I.grades.map(b => I.cell(p.row, b.grade)).map(v => (String(v).split('\n')[0].match(/^\s*(A\+|A|B|F)(?![A-Za-z])/i) || [])[1]).filter(Boolean);
    const st = I.stars.reduce((n, b) => n + (starNum(I.cell(p.row, b.stars)) || 0), 0);
    if (g.length) marks += '<span class="hs-g">' + g.map(x => '<b class="g' + x.replace('+', 'p') + '">' + esc(x) + '</b>').join('') + '</span>';
    if (st) marks += '<span class="tag">⭐ ' + st + '</span>';
    const byTest = new Map();
    I.cols.filter(x => x.kind === 'test').forEach(x => { const v = Q.clean(I.cell(p.row, x.col)); if (!v) return; const g = byTest.get(x.area) || { parts: [], sum: 0, max: 0, ok: true }; g.parts.push(v); const n = Number(String(v).replace(',', '.')); if (isNaN(n) || !x.max) g.ok = false; else { g.sum += n; g.max += Number(x.max); } byTest.set(x.area, g); });
    byTest.forEach((g, area) => { marks += '<div class="small">📝 ' + esc(area.replace(/^KIỂM TRA\s*/i, 'KT ')) + ': ' + esc(g.parts.join(' · ')) + (g.ok && g.parts.length > 1 ? ' = <b>' + (Math.round(g.sum * 10) / 10) + '/' + g.max + '</b>' : '') + '</div>'; });
  } else {
    const L = I.cols.filter(x => x.kind === 'L').map(x => hoNum(I.cell(p.row, x.col))).filter(Boolean), R = I.cols.filter(x => x.kind === 'R').map(x => hoNum(I.cell(p.row, x.col))).filter(Boolean);
    const S = I.cols.filter(x => x.kind === 'S').map(x => hoBand(I.cell(p.row, x.col))).filter(Boolean);
    if (L.length) marks += '<span class="tag">🎧 ' + esc(L.slice(-3).join(' · ')) + '</span>';
    if (R.length) marks += '<span class="tag">📖 ' + esc(R.slice(-3).join(' · ')) + '</span>';
    if (S.length) marks += '<span class="tag">🗣️ Band ' + esc(S.slice(-3).join(' · ')) + '</span>';
  }
  const tel = p.phone ? '<a class="small" href="tel:' + esc(p.phone.replace(/\s+/g, '')) + '">📞 ' + esc(p.phone) + '</a>' : '';
  const edit = hoCanEdit(c);
  return '<div class="card hs-row' + (owe ? ' owe' : '') + '" data-row="' + p.row + '"><div class="row-top"><span class="hs-n">' + (i + 1) + '</span><div><b>' + esc(p.name) + '</b>' + (p.eng ? ' <span class="muted">' + esc(p.eng) + '</span>' : '') +
    '<div class="small muted">' + [p.group, p.birth ? T('Sinh ', 'Born ') + esc(p.birth) : '', p.since ? T('Vào học ', 'Joined ') + esc(hoDmy(p.since)) : ''].filter(Boolean).join(' · ') + '</div></div><span class="spacer"></span>' +
    (edit ? '<button class="quiet hs-more" data-act="hoMenu" data-row="' + p.row + '" aria-label="' + T('Thao tác', 'Actions') + '">⋯</button>' : '') + '</div>' +
    '<div class="hs-tags"><span class="tag ' + (a.absent >= 3 ? 'bad' : 'ok') + '">' + T('Có mặt ', 'Present ') + a.present + (a.late ? ' · ' + T('muộn ', 'late ') + a.late : '') + ' · ' + T('vắng ', 'absent ') + a.absent + '</span>' +
    (owe ? '<span class="tag bad">' + T('Nợ ' + owe + ' bài', owe + ' owed') + '</span>' : '<span class="tag ok">' + T('Đủ bài', 'No work owed') + '</span>') + marks + '</div>' +
    '<div class="hs-acts">' + tel + (p.dash ? '<button class="quiet" data-act="hoCopy" data-u="' + esc(p.dash) + '">🔗 ' + T('Sao chép link dash', 'Copy dash link') + '</button><button class="quiet" data-act="hoShare" data-u="' + esc(p.dash) + '" data-n="' + esc(p.name) + '">📤 ' + T('Gửi', 'Share') + '</button>' : '<span class="tag warn">' + T('Chưa có link dash', 'No dash link yet') + '</span>') + '</div>' +
    (ho.menuRow === p.row && edit ? '<div class="choices hs-menu"><button class="quiet" data-act="hoForm" data-f="nghi" data-row="' + p.row + '">🚪 ' + T('Cho nghỉ', 'Retire') + '</button><button class="quiet" data-act="hoForm" data-f="chuyen" data-row="' + p.row + '">🔁 ' + T('Chuyển lớp', 'Move class') + '</button></div>' : '') + '</div>';
}
function hoFormView(c) {
  const f = ho.form; if (!f) return '';
  const p = f.row ? ho.info.pupils.find(x => x.row === f.row) : null, groups = [...new Set(ho.info.pupils.map(x => x.group).filter(Boolean))];
  const title = f.kind === 'them' ? T('Thêm học sinh vào ', 'Add a pupil to ') + c.name : f.kind === 'nghi' ? T('Cho nghỉ: ', 'Retire: ') + (p && p.name) : T('Chuyển lớp: ', 'Move: ') + (p && p.name);
  let h = '<div class="ll-veil" data-act="hoFormClose"></div><div class="ll-sheet hs-sheet" role="dialog"><div class="row-top"><b>' + esc(title) + '</b><span class="spacer"></span><button class="quiet" data-act="hoFormClose">' + T('Đóng', 'Close') + '</button></div>';
  if (f.kind === 'them') {
    h += '<label>' + T('Họ tên (tiếng Việt)', 'Full name') + '<input data-f="name" value="' + esc(f.name || '') + '" autocapitalize="characters"></label>' +
      (ho.info.lay.eng >= 0 ? '<label>' + T('Tên tiếng Anh', 'English name') + '<input data-f="eng" value="' + esc(f.eng || '') + '"></label>' : '') +
      (ho.info.lay.birth >= 0 ? '<label>' + T('Năm sinh', 'Birth year') + '<input data-f="birth" inputmode="numeric" value="' + esc(f.birth || '') + '"></label>' : '') +
      (ho.info.lay.phone >= 0 ? '<label>' + T('SĐT phụ huynh', 'Parent phone') + '<input data-f="phone" inputmode="tel" value="' + esc(f.phone || '') + '"></label>' : '') +
      '<label>' + T('Ngày vào học', 'First day') + '<input type="date" data-f="since" value="' + esc(f.since || today()) + '"></label>' +
      (groups.length ? '<label>' + T('Nhóm', 'Group') + '<select data-f="group">' + groups.map(g => '<option' + (f.group === g ? ' selected' : '') + '>' + esc(g) + '</option>').join('') + '</select></label>' : '');
  } else {
    if (f.kind === 'chuyen') h += '<label>' + T('Chuyển sang lớp', 'To class') + '<select data-f="to"><option value="">' + T('— chọn lớp —', '— choose —') + '</option>' + classList.filter(x => x.key !== c.key).map(x => '<option' + (f.to === x.key ? ' selected' : '') + ' value="' + esc(x.key) + '">' + esc(x.name) + '</option>').join('') + '</select></label>';
    h += '<label>' + (f.kind === 'chuyen' ? T('Ngày học buổi đầu ở lớp mới', 'First day in the new class') : T('Ngày nghỉ', 'Last day')) + '<input type="date" data-f="since" value="' + esc(f.since || today()) + '"></label>' +
      '<label>' + T('Lý do / ghi chú', 'Reason / note') + '<input data-f="reason" value="' + esc(f.reason || '') + '"></label>' +
      '<p class="small muted">' + T('Dòng của học sinh được chuyển sang tab "HS ĐÃ NGHỈ" trong file lớp (giữ nguyên điểm, link) rồi xóa khỏi danh sách; STT được đánh lại.', 'The row moves to tab "HS ĐÃ NGHỈ" in the class file (marks and link kept) and the list is renumbered.') + '</p>';
  }
  h += '<div class="choices"><button class="primary" data-act="hoDo"' + (ho.busy ? ' disabled' : '') + '>' + (ho.busy ? '⏳ ' + T('Đang ghi sheet…', 'Writing…') : f.kind === 'them' ? '➕ ' + T('Thêm vào lớp', 'Add') : f.kind === 'nghi' ? '🚪 ' + T('Cho nghỉ', 'Retire') : '🔁 ' + T('Chuyển lớp', 'Move')) + '</button></div></div>';
  return h;
}
function viewHoSo() {
  const c = hoCls();
  if (!c) { ho.key = ''; return viewHomerooms(); }
  const I = ho.info, edit = hoCanEdit(c);
  let h = '<div class="row-top"><button class="quiet" data-act="hoBack">‹ ' + T('Lớp chủ nhiệm', 'Homerooms') + '</button><span class="spacer"></span><button class="quiet" data-act="hoReload">↻</button></div>' +
    '<h2>📋 ' + esc(c.name) + '</h2>';
  if (ho.err) h += '<div class="notice bad">' + esc(ho.err) + '</div>';
  h += '<div class="seg hg-mode">' + [['', '👤 ' + T('Danh sách', 'Pupils')], ['grid', '📊 ' + T('Bảng như sheet', 'Sheet view')]].map(([k, t]) => '<button class="' + ((ho.mode || '') === k ? 'on' : '') + '" data-act="hoMode" data-m="' + k + '">' + t + '</button>').join('') + '</div>';
  if (ho.mode === 'grid') return h + hgView(c);
  if (!I) return h + '<div class="card empty">' + T('Đang đọc sheet lớp…', 'Reading the class sheet…') + '</div>';
  const n = I.pupils.length, owing = I.owed.filter(o => o.length).length, noDash = I.pupils.filter(p => !p.dash).length;
  h += '<div class="filters"><input type="search" data-act="hoQ" value="' + esc(ho.q) + '" placeholder="' + T('Tìm tên…', 'Find…') + '"><div class="seg">' + [['', T('Tất cả ', 'All ') + n], ['owe', T('Nợ bài ', 'Owing ') + owing], ['absent', T('Vắng nhiều', 'Often absent')], ['nodash', T('Chưa có link ', 'No link ') + noDash]].map(([k, t]) => '<button class="' + (ho.filter === k ? 'on' : '') + '" data-act="hoFilter" data-k="' + k + '">' + t + '</button>').join('') + '</div></div>';
  h += '<div class="choices">' + (edit ? '<button class="primary" data-act="hoForm" data-f="them">➕ ' + T('Thêm học sinh', 'Add pupil') + '</button>' : '') +
    '<a class="btn quiet" href="' + esc(hoSheetUrl(c, I.linkGid)) + '" target="_blank" rel="noopener">🔗 ' + T('Tạo link / cập nhật dash', 'Issue links / refresh dash') + '</a>' +
    '<button class="quiet" data-act="hoLeft">' + T('Đã nghỉ', 'Former pupils') + (ho.left ? ' (' + ho.left.length + ')' : '') + '</button></div>';
  if (noDash && edit) h += '<p class="small muted">' + T('Học sinh thêm từ app có link dash tự động. Em nào thêm thẳng vào sheet mà chưa có link: bấm "Tạo link / cập nhật dash" rồi tích ô trong tab LINK HỌC SINH.', 'Pupils added in the app get a link automatically; for rows typed into the sheet, tap "Issue links".') + '</p>';
  if (ho.leftOpen) h += '<div class="card"><b>' + T('Đã nghỉ / chuyển đi', 'Former pupils') + '</b>' + (ho.left ? (ho.left.length ? ho.left.map(x => '<div class="small">' + esc(x.day) + ' · <b>' + esc(x.name) + '</b>' + (x.eng ? ' (' + esc(x.eng) + ')' : '') + (x.reason ? ' · ' + esc(x.reason) : '') + ' · ' + esc(x.by) + '</div>').join('') : '<div class="small muted">' + T('Chưa có.', 'None.') + '</div>') : '<div class="small muted">' + T('Đang đọc…', 'Reading…') + '</div>') + '</div>';
  const q = Q.key(ho.q);
  const list = I.pupils.map((p, i) => ({ p, i })).filter(({ p, i }) => (!q || Q.key(p.name + ' ' + p.eng).includes(q)) &&
    (ho.filter === 'owe' ? I.owed[i].length : ho.filter === 'absent' ? hoAttend(c, p).absent >= 3 : ho.filter === 'nodash' ? !p.dash : true));
  h += list.length ? list.map(({ p, i }) => hoRow(c, p, i)).join('') : '<div class="card empty">' + T('Không có học sinh nào khớp.', 'No pupil matches.') + '</div>';
  return h + hoFormView(c);
}
async function hoDo() {
  const c = hoCls(), f = ho.form, I = ho.info;
  if (!c || !f || ho.busy) return;
  const p = f.row ? I.pupils.find(x => x.row === f.row) : null;
  if (f.kind === 'them' && !Q.clean(f.name)) { say(T('Chị/anh nhập họ tên học sinh.', 'Enter the pupil name.'), 'bad'); return; }
  if (f.kind === 'chuyen' && !f.to) { say(T('Chọn lớp chuyển đến.', 'Choose the new class.'), 'bad'); return; }
  ho.busy = true; render();
  try {
    await flush();
    if (f.kind === 'them') {
      const r = await call('hsthem', { file: c.tracker, tab: I.tab, cls: c.name, name: Q.clean(f.name), eng: Q.clean(f.eng), birth: Q.clean(f.birth), phone: Q.clean(f.phone), since: f.since || today(), group: f.group || '' }, 1);
      I.linkGid = r.linkGid;
      say(r.link ? T('Đã thêm ' + Q.clean(f.name).toUpperCase() + ' vào ' + c.name + ', link dash phụ huynh đã tạo sẵn. Việc đón học sinh mới đã vào chuông 🔔.', 'Added, parent link created; new-pupil steps are in the bell.')
        : T('Đã thêm ' + Q.clean(f.name).toUpperCase() + ' vào ' + c.name + '. Chưa tạo được link dash tự động (' + (r.linkSkipped || '') + '): bấm "Tạo link / cập nhật dash".', 'Added; parent link not created automatically, tap "Issue links".'), r.link ? '' : 'bad');
      if (typeof hsData !== 'undefined') hsData.at = 0;
    } else {
      const r = await call('hsnghi', { file: c.tracker, tab: I.tab, cls: c.name, row: p.row, name: p.name, reason: (f.kind === 'chuyen' ? T('Chuyển sang ', 'Moved to ') + (classList.find(x => x.key === f.to) || {}).name + (f.reason ? ' · ' : '') : '') + Q.clean(f.reason) }, 1);
      I.linkGid = r.linkGid;
      if (f.kind === 'chuyen') {
        const to = classList.find(x => x.key === f.to), tt = await loadTracker(to, true);
        const r2 = await call('hsthem', { file: to.tracker, tab: tt.tab, cls: to.name, name: p.name, eng: p.eng, birth: p.birth, phone: p.phone, since: f.since || today(), group: '' }, 1);
        delete trackers[to.key];
        say(T(p.name + ' đã chuyển sang ' + to.name + (r2.link ? ', link dash mới đã tạo (link cũ tự hết hiệu lực).' : '. Mở lớp mới và bấm "Tạo link / cập nhật dash".'), 'Moved.'));
      } else say(T('Đã cho ' + p.name + ' nghỉ: link dash hết hiệu lực, xóa khỏi danh sách nợ bài/mức phạt; dòng lưu ở tab HS ĐÃ NGHỈ.', 'Retired; dash link revoked, removed from owed/penalty lists.'));
    }
    ho.form = null; ho.menuRow = 0; delete trackers[c.key]; if (typeof buBai !== 'undefined') buBai.at = 0; if (typeof ladder !== 'undefined') ladder.at = 0;
    await hoLoad(true);
  } catch (e) { say(T('Chưa làm được: ', 'Failed: ') + e.message, 'bad'); if (/thay đổi/.test(e.message)) { delete trackers[c.key]; hoLoad(true); } }
  finally { ho.busy = false; render(); }
}
document.addEventListener('input', e => { const b = e.target; if (b && b.dataset && b.dataset.f && ho.form) ho.form[b.dataset.f] = b.value; if (b && b.dataset && b.dataset.act === 'hoQ') { ho.q = b.value; render(); } });
document.addEventListener('change', e => { const b = e.target; if (b && b.dataset && b.dataset.f && ho.form) { ho.form[b.dataset.f] = b.value; render(); } });
document.addEventListener('click', e => {
  const b = e.target.closest && e.target.closest('[data-act]');
  if (!b || !/^ho[A-Z]/.test(b.dataset.act) || /^ho(Mode|Cell|Grid)/.test(b.dataset.act)) return;
  const act = b.dataset.act; e.stopImmediatePropagation();
  if (act === 'hoOpen') { const c = classList.find(x => x.key === b.dataset.k); if (!c) return; hrDrawer = null; ho.key = c.key; ho.info = null; ho.q = ''; ho.filter = ''; ho.form = null; ho.menuRow = 0; ho.leftOpen = false; view = 'lopcn'; hg.cell = null; render(); window.scrollTo(0, 0); guarded(() => hoLoad(false)); if (ho.mode === 'grid') guarded(() => hgLoad(false)); }
  else if (act === 'hoBack') { ho.key = ''; render(); }
  else if (act === 'hoReload') { delete trackers[ho.key]; if (ho.mode === 'grid') guarded(() => hgLoad(true)); else guarded(() => hoLoad(true)); }
  else if (act === 'hoFilter') { ho.filter = b.dataset.k; render(); }
  else if (act === 'hoMenu') { ho.menuRow = ho.menuRow === Number(b.dataset.row) ? 0 : Number(b.dataset.row); render(); }
  else if (act === 'hoForm') { ho.form = { kind: b.dataset.f, row: Number(b.dataset.row) || 0, since: today() }; ho.menuRow = 0; render(); }
  else if (act === 'hoFormClose') { ho.form = null; render(); }
  else if (act === 'hoDo') hoDo();
  else if (act === 'hoLeft') { ho.leftOpen = !ho.leftOpen; render(); if (ho.leftOpen && !ho.left) { const c = hoCls(); call('hsdanghi', { file: c.tracker }).then(r => { ho.left = r.rows || []; render(); }).catch(() => { ho.left = []; render(); }); } }
  else if (act === 'hoCopy') { navigator.clipboard.writeText(b.dataset.u).then(() => say(T('Đã sao chép link.', 'Link copied.'))).catch(() => prompt(T('Sao chép link:', 'Copy:'), b.dataset.u)); }
  else if (act === 'hoShare') { const text = T('Link theo dõi học tập của ', 'Progress link for ') + b.dataset.n + ': ' + b.dataset.u; if (navigator.share) navigator.share({ text }).catch(() => {}); else navigator.clipboard.writeText(text).then(() => say(T('Đã sao chép, dán vào Zalo.', 'Copied; paste into Zalo.'))); }
}, true);
/* ---------- Bảng lớp như sheet (owner 12/11: "làm sao mà Lớp hiển thị phải giống với Sheet ý... đủ thông tin như sheet thì tôi mới
 * bỏ sheet được") ----------
 * The Hồ sơ lớp page has a second view, "📊 Bảng như sheet": the whole THEO DÕI TOÀN DIỆN tab drawn as the same grid, with the
 * sheet's colours, bold, red lines inside a cell, merged headers, column widths, notes and its frozen rows and columns. The
 * server reads it in one call (op luoi). Hidden columns stay hidden unless asked. The chips jump to a block (a lesson, a test).
 * Tapping a cell shows its full text, note and header; the homeroom teacher and managers can change a pupil's cell there, and the
 * write goes through the same outbox (never overwrites a cell someone else changed, row checked against the pupil name). */
const hg = { key: '', data: null, loading: false, err: '', hidden: false, cell: null, draft: '', scroll: 0 };
const HG_SCALE = 0.8, HG_NAME_MAX = 170;
async function hgLoad(force) {
  const c = hoCls();
  if (!c || hg.loading || (!force && hg.key === c.key && hg.data && Date.now() - hg.data.at < 120000)) return;
  hg.loading = true; hg.err = ''; if (hg.key !== c.key) { hg.data = null; hg.cell = null; } hg.key = c.key; render();
  try {
    const t = await loadTracker(c, false, true);
    const d = await call('luoi', { file: c.tracker, tab: t.tab });
    d.at = Date.now();
    // Merges: each merged block is drawn once at its first visible cell.
    d.anchor = {}; d.cover = {};
    (d.merges || []).forEach(m => { for (let r = m[0]; r < m[1]; r++) for (let k = m[2]; k < m[3]; k++) d.cover[r + ',' + k] = m; });
    hg.data = d;
  } catch (e) { hg.err = e.message; }
  finally { hg.loading = false; render(); }
}
const hgShown = (d, k) => hg.hidden || !((d.cols[k] || [])[1]);
const hgCell = (d, r, k) => ((d.rows[r] || [])[k]) || {};
const hgIsPupilRow = (d, r) => r >= d.frozenRows && /^\d+$/.test(String(hgCell(d, r, 0).v || '').trim()) && String(hgCell(d, r, 1).v || '').trim();
function hgText(cell) {
  const v = String(cell.v || '');
  if (!cell.r) return esc(v);
  const runs = cell.r.slice().sort((a, b) => a[0] - b[0]);
  return esc(v.slice(0, runs[0][0])) + runs.map((x, i) => { const part = v.slice(x[0], i + 1 < runs.length ? runs[i + 1][0] : v.length); if (!part) return ''; const st = (x[1] && x[1] !== '#000000' ? 'color:' + x[1] + ';' : '') + (x[2] ? 'font-weight:700;' : ''); return st ? '<span style="' + st + '">' + esc(part) + '</span>' : esc(part); }).join('');
}
function hgWidth(d, k) { const w = Math.round(((d.cols[k] || [])[0] || 100) * HG_SCALE); return k === 1 ? Math.min(w, HG_NAME_MAX) : Math.max(28, Math.min(w, 320)); }
// Header text of a column: every frozen row's value at that column (or of the merged block covering it), without repeats.
function hgHead(d, k) {
  const out = [];
  for (let r = 0; r < d.frozenRows; r++) { const m = d.cover[r + ',' + k], v = Q.clean(hgCell(d, m ? m[0] : r, m ? m[2] : k).v || ''); if (v && !out.includes(v)) out.push(v); }
  return out;
}
function hgBlocks(d) {
  const out = [], short = v => v.replace(/KIỂM TRA GIẤY ĐỊNH KÌ/i, 'KT giấy').replace(/KIỂM TRA NÓI CUỐI SÁCH/i, 'KT nói').replace(/CHUỖI VIDEO TỰ LUYỆN/i, 'Video tự luyện').replace(/^Buổi học ngày/i, 'Buổi');
  let last = null;
  for (let k = d.frozenCols; k < d.width; k++) {
    if (!hgShown(d, k)) continue;
    const m = d.cover['0,' + k];
    if (m && m[1] >= d.frozenRows && m[3] - m[2] === 1) continue; // a one-column field (năm sinh, SĐT, dash)
    const block = m ? m[2] + '-' + m[3] : String(k);
    if (block === last) continue;
    const v = Q.clean(hgCell(d, 0, m ? m[2] : k).v || '').split('\n')[0];
    if (!v) continue;
    last = block;
    const date = (hgHead(d, k).join(' ').match(/\b(\d{1,2})\/(\d{1,2})(?:\/\d{2,4})?\b/) || []);
    let label = short(v); if (label.length > 22) label = label.slice(0, 21) + '…';
    if (date[0]) label += ' ' + date[1].padStart(2, '0') + '/' + date[2].padStart(2, '0');
    if (!out.length || out[out.length - 1].label !== label) out.push({ col: k, label });
  }
  return out;
}
function hgTable(d) {
  const cols = []; for (let k = 0; k < d.width; k++) if (hgShown(d, k)) cols.push(k);
  const frozen = cols.filter(k => k < d.frozenCols).slice(0, innerWidth < 700 ? 2 : 9), left = {};
  let x = 0; frozen.forEach(k => { left[k] = x; x += hgWidth(d, k); });
  const total = cols.reduce((n, k) => n + hgWidth(d, k), 0);
  let h = '<table class="hg" style="width:' + total + 'px"><colgroup>' + cols.map(k => '<col style="width:' + hgWidth(d, k) + 'px">').join('') + '</colgroup>';
  d.rows.forEach((row, r) => {
    const head = r < d.frozenRows;
    h += '<tr' + (head ? ' class="hg-h"' : '') + '>';
    cols.forEach(k => {
      const m = d.cover[r + ',' + k];
      let rs = 1, cs = 1;
      if (m) {
        const firstVisible = cols.find(q => q >= m[2] && q < m[3]);
        if (r !== m[0] || k !== firstVisible) return;
        rs = Math.min(m[1], d.rows.length) - m[0]; cs = cols.filter(q => q >= m[2] && q < m[3]).length;
      }
      const cell = (m ? hgCell(d, m[0], m[2]) : hgCell(d, r, k)), st = [];
      if (cell.bg) st.push('background:' + cell.bg);
      if (cell.fg) st.push('color:' + cell.fg);
      if (cell.b) st.push('font-weight:700');
      if (cell.i) st.push('font-style:italic');
      if (cell.a) st.push('text-align:' + (cell.a === 'c' ? 'center' : 'right'));
      const pin = k in left;
      if (pin) st.push('left:' + left[k] + 'px');
      const tag = head ? 'th' : 'td', v = String(cell.v || ''), url = cell.h || (/^https?:\/\/\S+$/.test(v) ? v : '');
      const body = url ? '<a href="' + esc(url) + '" target="_blank" rel="noopener" class="hg-link">🔗 ' + (/#p=/.test(url) ? 'Dash' : T('Mở', 'Open')) + '</a>' : '<div class="gc">' + hgText(cell) + '</div>';
      h += '<' + tag + (rs > 1 ? ' rowspan="' + rs + '"' : '') + (cs > 1 ? ' colspan="' + cs + '"' : '') + ' class="' + (pin ? 'pin' : '') + (cell.n ? ' hg-note' : '') + (pin && k === frozen[frozen.length - 1] ? ' pin-end' : '') + '"' +
        (st.length ? ' style="' + st.join(';') + '"' : '') + (url ? '' : ' data-act="hoCell" data-r="' + (m ? m[0] : r) + '" data-c="' + (m ? m[2] : k) + '"') + '>' + body + '</' + tag + '>';
    });
    h += '</tr>';
  });
  return h + '</table>';
}
// Frozen header rows stay on top while scrolling down: their offsets are measured once the table is on the page.
function hgPin() {
  const box = document.querySelector('.hg-box'); if (!box) return;
  if (hg.scroll) { box.scrollLeft = hg.scroll; hg.scroll = 0; }
  let y = 0;
  box.querySelectorAll('tr.hg-h').forEach(tr => { tr.querySelectorAll('th').forEach(th => { th.style.top = y + 'px'; }); y += tr.getBoundingClientRect().height; });
}
function hgCellView(c) {
  const d = hg.data, s = hg.cell; if (!d || !s) return '';
  const cell = hgCell(d, s.r, s.c), pupil = s.r >= d.frozenRows ? Q.clean(hgCell(d, s.r, 1).v || '').split('\n')[0] : '';
  const head = hgHead(d, s.c), edit = hoCanEdit(c) && hgIsPupilRow(d, s.r) && s.c > 1;
  let h = '<div class="ll-veil" data-act="hoCellClose"></div><div class="ll-sheet hg-sheet" role="dialog"><div class="row-top"><b>' + esc(pupil || T('Tiêu đề', 'Header')) + '</b><span class="muted small">' + Q.colName(s.c) + (s.r + 1) + '</span><span class="spacer"></span><button class="quiet" data-act="hoCellClose">' + T('Đóng', 'Close') + '</button></div>';
  if (head.length && s.r >= d.frozenRows) h += '<div class="small muted hg-path">' + head.map(x => esc(x.split('\n')[0])).join(' › ') + '</div>';
  h += edit ? '<textarea data-act="hoCellText" rows="6">' + esc(hg.draft) + '</textarea>' : '<div class="hg-full"' + (cell.bg ? ' style="background:' + cell.bg + (cell.fg ? ';color:' + cell.fg : '') + '"' : '') + '>' + (cell.v ? hgText(cell) : '<span class="muted">' + T('(trống)', '(empty)') + '</span>') + '</div>';
  if (cell.n) h += '<div class="notice">📝 ' + esc(cell.n) + '</div>';
  if (edit) h += '<div class="choices"><button class="primary" data-act="hoCellSave"' + (hg.draft === String(cell.v || '') ? ' disabled' : '') + '>💾 ' + T('Ghi vào sheet', 'Save to sheet') + '</button></div><p class="small muted">' + T('Ghi qua hàng chờ như mọi thao tác khác; nếu ô vừa bị người khác sửa thì app không ghi đè và báo lại.', 'Saved through the outbox; a cell someone else just changed is never overwritten.') + '</p>';
  return h + '</div>';
}
function hgView(c) {
  const d = hg.data;
  let h = '';
  if (hg.err) h += '<div class="notice bad">' + esc(hg.err) + '</div>';
  if (!d) return h + '<div class="card empty">' + (hg.loading ? T('Đang đọc nguyên bảng sheet…', 'Reading the sheet…') : '') + '</div>';
  const hiddenN = d.cols.filter(x => x[1]).length;
  h += '<div class="hg-bar"><span class="small muted">' + T('Bảng ' + d.tab + ' · đọc lúc ', d.tab + ' · read at ') + new Date(d.at).toTimeString().slice(0, 5) + (hg.loading ? ' ⏳' : '') + '</span>' +
    (hiddenN ? '<button class="quiet" data-act="hoGridHidden">' + (hg.hidden ? T('Ẩn ' + hiddenN + ' cột ẩn', 'Hide ' + hiddenN + ' hidden columns') : T('Hiện ' + hiddenN + ' cột ẩn', 'Show ' + hiddenN + ' hidden columns')) + '</button>' : '') + '</div>';
  const blocks = hgBlocks(d);
  if (blocks.length > 1) h += '<div class="hg-chips">' + blocks.map(b => '<button class="quiet" data-act="hoGridGo" data-c="' + b.col + '">' + esc(b.label) + '</button>').join('') + '</div>';
  h += '<div class="hg-box">' + hgTable(d) + '</div>';
  setTimeout(hgPin, 0);
  return h + hgCellView(c);
}
async function hgSave() {
  const c = hoCls(), d = hg.data, s = hg.cell; if (!c || !d || !s) return;
  const cell = hgCell(d, s.r, s.c), before = String(cell.v || ''), value = hg.draft;
  if (value === before) return;
  const pupil = Q.clean(hgCell(d, s.r, 1).v || '').split('\n')[0], head = hgHead(d, s.c);
  queue({ kind: 'cell', file: c.tracker, classKey: c.key, range: quote(d.tab) + '!' + Q.colName(s.c) + (s.r + 1), row: s.r + 1, col: s.c, expected: before, value, name: pupil, label: pupil + ' · ' + (head[head.length - 1] || Q.colName(s.c)).split('\n')[0].slice(0, 30) });
  d.rows[s.r] = d.rows[s.r] || []; d.rows[s.r][s.c] = Object.assign({}, cell, { v: value, r: null });
  const t = trackers[c.key]; if (t && t.set) t.set(s.r + 1, s.c, value);
  hg.cell = null; render();
  say(T('Đã đưa vào hàng chờ ghi sheet.', 'Queued for the sheet.'));
}
document.addEventListener('input', e => { const b = e.target; if (b && b.dataset && b.dataset.act === 'hoCellText') { hg.draft = b.value; const btn = document.querySelector('[data-act="hoCellSave"]'); if (btn) btn.disabled = hg.draft === String(hgCell(hg.data, hg.cell.r, hg.cell.c).v || ''); } });
document.addEventListener('click', e => {
  const b = e.target.closest && e.target.closest('[data-act]');
  if (!b || !/^ho(Mode|Cell|CellClose|CellSave|Grid[A-Z]\w*)$/.test(b.dataset.act)) return;
  const act = b.dataset.act; e.stopImmediatePropagation();
  const box = document.querySelector('.hg-box');
  if (act === 'hoMode') { ho.mode = b.dataset.m; render(); if (ho.mode === 'grid') guarded(() => hgLoad(false)); }
  else if (act === 'hoCell') { if (box) hg.scroll = box.scrollLeft; hg.cell = { r: Number(b.dataset.r), c: Number(b.dataset.c) }; hg.draft = String(hgCell(hg.data, hg.cell.r, hg.cell.c).v || ''); render(); }
  else if (act === 'hoCellClose') { if (box) hg.scroll = box.scrollLeft; hg.cell = null; render(); }
  else if (act === 'hoCellSave') { if (box) hg.scroll = box.scrollLeft; hgSave(); }
  else if (act === 'hoGridHidden') { hg.hidden = !hg.hidden; render(); }
  else if (act === 'hoGridGo') {
    const td = box && box.querySelector('[data-c="' + b.dataset.c + '"]'), pinned = [...(box ? box.querySelectorAll('tr:first-child .pin') : [])].reduce((n, x) => Math.max(n, x.offsetLeft + x.offsetWidth), 0);
    if (td) box.scrollTo({ left: Math.max(0, td.offsetLeft - pinned - 4), behavior: 'smooth' });
  }
}, true);

const viewHomeroomsBeforeHs = viewHomerooms;
viewHomerooms = function () {
  if (ho.key) return viewHoSo();
  const go = name => '<button class="quiet hs-go" data-act="hoOpen" data-k="' + esc(Q.key(name)) + '">📋 ' + T('Hồ sơ · Bảng như sheet', 'Profile · Sheet view') + '</button>';
  // Owner 12/11 ("chỗ bảng như sheet ở đâu"): the class page opens from the class drawer (tap a class), next to "Mở lớp".
  return viewHomeroomsBeforeHs()
    .replace(/<div class="row-top"><b>([^<]+)<\/b>/g, (m, name) => classList.some(x => x.key === Q.key(name)) ? m + go(name) : m)
    .replace(/(<aside class="drawer" role="dialog" aria-label="([^"]+)"><div class="dw-head">[\s\S]*?<span class="spacer"><\/span>)/, (m, all, name) => classList.some(x => x.key === Q.key(name)) ? all + go(name) : m);
};
// Tracker writes name the pupil of each row, so a row that moved (a pupil retired above it) is never overwritten.
const writeCellsBeforeHs = writeCells;
writeCells = async function (file, items) {
  items.forEach(x => { if (x.row && x.classKey && !x.name) { const t = trackers[x.classKey], p = t && t.pupils.find(q => q.row === x.row); if (p) x.name = p.name; } });
  return writeCellsBeforeHs(file, items);
};


/* ---------- Owner 12/11 (GV Hannah: "193 not saved yet", a wall of "someone else wrote … here, so it was not overwritten" that kept
 * coming back) ----------
 * Work queued while the server could not write (the Google allowance ran out) stayed on the device for hours; meanwhile the
 * class sheet got a new lesson block, which pushes every older column to the right. A cell kept as "column V" then names another
 * column. Three guards:
 *  1. Each tracker cell now remembers which column it was meant for (the lesson block's title and the column's own header). Before
 *     writing, the header of the sheet is read again; a cell whose column moved is moved with it, or dropped if not found.
 *     Star counts queued before this guard existed (they are written without the "someone else wrote" check) are dropped, since
 *     their column cannot be confirmed; other old cells keep that check, which already refuses a moved column.
 *  2. "Someone else wrote here" is said once per save, as one line naming the pupils, never one notice per cell on every retry.
 *  3. A save the server refuses (a row that changed, a bad cell) no longer blocks everything else forever: the batch is split until
 *     the one bad cell is found, that cell is dropped with a note, and the rest is written. */
const colSig = (head, col) => {
  // Owner 12/11 (FIGHTER 5 test scores, only Lucy's saved): rows 1–4 of a sheet often hold the first pupil on row 4; a pupil row is
  // never part of the column's identity, or the first pupil's own score would make every other score of that column "moved".
  const all = head || [], cut = all.findIndex(r => /^\d+$/.test(Q.clean((r || [])[0]))), rows = cut < 0 ? all : all.slice(0, cut);
  const at = (r, c) => Q.key(String((rows[r] || [])[c] || ''));
  let title = '';
  for (let c = col; c >= 0 && !title; c--) { const t = at(0, c); if (t) title = t; }
  return title.slice(0, 80) + '|' + [1, 2, 3].map(r => at(r, col)).join('/').slice(0, 120);
};
const queueBeforeSig = queue;
queue = function (item, wait) {
  if (item && item.kind === 'cell' && !item.at) {
    item.at = Date.now();
    const t = item.classKey && trackers[item.classKey];
    if (t && t.head && item.col >= 0 && !item.colSig) item.colSig = colSig(t.head, item.col);
  }
  return queueBeforeSig(item, wait);
};
let conflictBag = null;
const conflictBeforeBag = conflict;
conflict = function (x, value) {
  if (!conflictBag) return conflictBeforeBag(x, value);
  const hit = trackers[x.classKey]; if (hit) hit.set(x.row, x.col, value);
  conflictBag.push(x.label || x.range);
};
async function sigFix(file, items) {
  const tracked = items.filter(x => x.classKey && x.col >= 0 && /^'.+'!/.test(x.range));
  const drop = new Set();
  // Blind writes (stars) queued before the guard: nothing proves their column, so they are not written.
  tracked.forEach(x => { if (x.blind && !x.colSig) drop.add(x); });
  const withSig = tracked.filter(x => x.colSig && !drop.has(x));
  if (withSig.length) {
    const tabs = [...new Set(withSig.map(x => x.range.match(/^('.+')!/)[1]))];
    const got = await batchGet(file, tabs.map(t => t + '!1:4'));
    tabs.forEach((tab, i) => {
      const head = got[i] || [], width = Math.max(0, ...head.map(r => (r || []).length));
      withSig.filter(x => x.range.startsWith(tab + '!')).forEach(x => {
        if (colSig(head, x.col) === x.colSig) return;
        let to = -1;
        for (let c = 0; c < width; c++) if (colSig(head, c) === x.colSig) { to = c; break; }
        if (to < 0) { drop.add(x); return; }
        x.col = to; x.range = tab + '!' + Q.colName(to) + x.row;
      });
    });
  }
  return drop;
}
async function writeSplit(file, items, dropped) {
  try { return await writeCellsBeforeSig(file, items); }
  catch (e) {
    if (!(e.status === 400 || e.status === 409) ) throw e;
    if (items.length === 1) { dropped.push((items[0].label || items[0].range) + ' (' + Q.clean(e.message).slice(0, 80) + ')'); return; }
    const half = Math.ceil(items.length / 2);
    await writeSplit(file, items.slice(0, half), dropped);
    await writeSplit(file, items.slice(half), dropped);
  }
}
const writeCellsBeforeSig = writeCells;
writeCells = async function (file, items) {
  const drop = await sigFix(file, items).catch(() => new Set());
  const go = items.filter(x => !drop.has(x)), dropped = [...drop].map(x => x.label || x.range);
  conflictBag = [];
  try { if (go.length) await writeSplit(file, go, dropped); }
  finally {
    const bag = conflictBag; conflictBag = null;
    if (bag.length) say(T(bag.length + ' ô không ghi vì trên sheet đã có nội dung khác (app không ghi đè): ', bag.length + ' cells skipped, the sheet already holds something else: ') + bag.slice(0, 6).join('; ') + (bag.length > 6 ? '…' : ''), 'bad');
    if (dropped.length) say(T('Bỏ ' + dropped.length + ' mục cũ không còn đúng cột trên sheet (để tránh ghi nhầm): ', dropped.length + ' old items dropped, their column moved: ') + dropped.slice(0, 6).join('; ') + (dropped.length > 6 ? '…' : ''), 'bad');
  }
};

/* ---------- Owner 12/11 (GV Angelo: "I confirmed this is done almost a week ago, every day it comes back") ----------
 * A grading task whose dates run past Sunday is listed again in the next week's tab, with its own DONE box left unticked, so a
 * task ticked last week came back as not done. A task now counts as done when it is ticked in any loaded week tab (same teacher,
 * class, work and lesson day); the app then ticks the other tab too, after checking the row still holds that task, so the sheet
 * agrees. Unticking clears it in every tab that holds it. Last week's tab is read once so last week's ticks are known. */
const taskKey = t => [Q.key(t.teacher), Q.key(t.cls), Q.key(t.what), t.lessonDay || ''].join('|');
const taskHealing = new Set();
let taskPrevAsked = false;
function healTasks() {
  if (!me || isBoard()) return;
  if (!taskPrevAsked) { taskPrevAsked = true; weekOf(Q.addDays(today(), -7)).then(() => healTasks()).catch(() => {}); }
  const all = Object.values(weeks).filter(w => w && w.data && w.data.tasks), done = new Set();
  all.forEach(w => w.data.tasks.forEach(t => { if (t.done) done.add(taskKey(t)); }));
  const fix = {};
  all.forEach(w => w.data.tasks.forEach(t => {
    if (t.done || !done.has(taskKey(t))) return;
    t.done = true;
    const k = w.tab + '|' + t.row;
    if (taskHealing.has(k)) return;
    taskHealing.add(k); (fix[w.tab] = fix[w.tab] || []).push(t);
  }));
  Object.entries(fix).forEach(([tab, list]) => setTaskBoxes(tab, list, true).catch(() => list.forEach(t => taskHealing.delete(tab + '|' + t.row))));
}
async function setTaskBoxes(tab, list, value) {
  const got = await batchGet(CONFIG.scheduleId, list.map(t => quote(tab) + '!A' + t.row + ':D' + t.row));
  const data = list.filter((t, i) => { const r = ((got[i] || [])[0]) || []; return Q.clean(r[3]) === t.what && Q.key(r[2]) === Q.key(t.cls) && /^(TRUE|FALSE)$/i.test(Q.clean(r[0])) && /^TRUE$/i.test(Q.clean(r[0])) !== value; })
    .map(t => ({ range: quote(tab) + '!A' + t.row, values: [[value ? 'TRUE' : 'FALSE']] }));
  if (data.length) { await batchWrite(CONFIG.scheduleId, data); saved.delete('week:' + tab); }
}
const setWeekBeforeHeal = setWeek;
setWeek = function (tab, rows) { const w = setWeekBeforeHeal(tab, rows); try { setTimeout(healTasks, 0); } catch (e) {} return w; };
const tickTaskBeforeHeal = tickTask;
tickTask = async function (week, task) {
  if (!task) return;
  const was = !!task.done;
  await tickTaskBeforeHeal(week, task);
  if (!!task.done === was) return;
  const k = taskKey(task);
  Object.values(weeks).filter(w => w && w !== week && w.data && w.data.tasks).forEach(w => {
    const same = w.data.tasks.filter(t => taskKey(t) === k && !!t.done !== !!task.done);
    if (!same.length) return;
    same.forEach(t => { t.done = task.done; });
    setTaskBoxes(w.tab, same, !!task.done).catch(() => {});
  });
  render();
};

/* Owner 12/11, same complaint: the log shows the TA of the class (THU HIEN, MY LINH) pressing the teacher's ✓ on the shared list,
 * which unticked the teacher's "graded" mark (10/11 17:16, 20:13; 11/11 19:32). The ✓ belongs to the teacher who grades (and
 * managers); a TA sees it but cannot change it, and marks the return with "Đã trả" as before. */
const canTickTask = t => !!me && (isManager() || isMe(t.teacher));
const tickTaskBeforeOwner = tickTask;
tickTask = async function (week, task) {
  if (task && !canTickTask(task)) { say(T('Ô ✓ là của GV chấm bài (' + task.teacher + '). TA bấm "Đã trả" khi đã trả bài.', 'Only the grading teacher (' + task.teacher + ') ticks this. TAs use "Returned".'), 'bad'); return; }
  return tickTaskBeforeOwner(week, task);
};
const taskRowBeforeOwner = taskRow;
taskRow = function (t, week, canTick) {
  const h = taskRowBeforeOwner(t, week, canTick);
  return canTickTask(t) ? h : h.replace(/<button class="(on)?" data-act="task"[^>]*>✓<\/button>/, (m, on) => '<button class="' + (on || '') + ' locked" disabled title="' + esc(T('Chỉ GV chấm bài tích ô này', 'Only the grading teacher ticks this')) + '">✓</button>');
};

/* Owner 12/11 ("việc ai người ấy ấn... nếu không phải việc người ấy thì không được ấn"): every tick belongs to one person.
 * - Graded ✓: the grading teacher (above). - "Đã trả" of a graded task: that task's TA. - Weekly "Trả BTVN" list: the TA named on
 *   that line. Managers may tick any of them. Others see the box greyed out and a tap says whose it is. */
const retLast = x => Q.key(x.who) === Q.key(me && me.name || '').split(' ').pop();
const canTickReturn = x => !!me && (isManager() || retLast(x));
const tickReturnBeforeOwner = tickReturn;
tickReturn = async function (week, item) {
  if (item && !canTickReturn(item)) { say(T('Đây là việc trả bài của TA ' + item.who + ', chỉ người đó (hoặc quản lí) tích được.', 'This return belongs to TA ' + item.who + '.'), 'bad'); return; }
  return tickReturnBeforeOwner(week, item);
};
const returnsBlockBeforeOwner = returnsBlock;
returnsBlock = function (week) {
  const h = returnsBlockBeforeOwner(week);
  if (!h || isManager()) return h;
  const list = (week.data.returns || []);
  return h.replace(/<button class="(on)?" data-act="ret" data-row="(\d+)" data-col="(\d+)"/g, (m, on, row, col) => {
    const x = list.find(r => String(r.row) === row && String(r.col) === col);
    return x && !canTickReturn(x) ? '<button class="' + (on || '') + ' locked" disabled data-row="' + row + '" data-col="' + col + '"' : m;
  });
};
window.addEventListener('click', e => {
  const b = e.target.closest && e.target.closest('[data-act="taskRet"]');
  if (!b) return;
  const week = weeks[Q.weekTab(tabs, day)] || weeks[Q.weekTab(tabs, today())], t = week && week.data.tasks.find(x => String(x.row) === b.dataset.row);
  if (t && !(isManager() || isMe(taOf(t)))) { e.stopImmediatePropagation(); say(T('Đây là việc trả bài của TA ' + taOf(t) + ', chỉ người đó (hoặc quản lí) bấm được.', 'This return belongs to TA ' + taOf(t) + '.'), 'bad'); }
}, true);

/* Owner 12/11 ("bản mới không cần F5, nó tự lên"): a page waited for an empty outbox before taking a new version, so a device
 * whose outbox was stuck (GV Hannah, 193 items) could never receive the very fix that unsticks it. The outbox is kept on the
 * device and comes back after a reload, so the page now waits only while a save is on its way or something was queued in the
 * last minute. */
let queueLastAt = 0;
const queueBeforeStamp = queue;
queue = function (item, wait) { queueLastAt = Date.now(); return queueBeforeStamp(item, wait); };
const appSafeBeforeOutbox = appSafe;
appSafe = function () {
  if (typeof flushing !== 'undefined' && flushing) return false;
  if (outbox.length && Date.now() - queueLastAt < 60000) return false;
  const keep = outbox; outbox = [];
  try { return appSafeBeforeOutbox(); } finally { outbox = keep; }
};

/* ---------- Owner 12/11: pop-ups only for TAs, managers and homerooms, never for a teacher who is teaching ----------
 * "màn hình cảnh báo nổi chỉ hiện cho TA, quản lí và chủ nhiệm, tuyệt đối không hiện cho GV — họ đang dạy, bận và phân tâm".
 * Teachers (role GV) who are nobody's homeroom get no pop-up at all; the bell and the lists stay. */
const popupAllowed = () => !!me && (isManager() || !/^GV/i.test(Q.clean(me.role || '')) || myHomerooms().some(x => isMe(x.cm)));
const paintPhPopBeforeRole = paintPhPop;
paintPhPop = function () { if (!popupAllowed()) { const b = document.getElementById('phPop'); if (b) b.remove(); return; } return paintPhPopBeforeRole(); };
const paintOffPopBeforeRole = paintOffPop;
paintOffPop = function () { if (!popupAllowed()) { const b = document.getElementById('offPop'); if (b) b.remove(); return; } return paintOffPopBeforeRole(); };

/* ---------- Owner 12/11 ("dứt khỏi Google… chỉ là nơi ghi dự phòng"): cells are saved by the gateway, not by Google ----------
 * A tap is saved in the app's own database at Cloudflare and counts as saved at once; the gateway then puts it into the sheet with
 * the same checks as before (the pupil of the row, "someone else wrote here", a column that moved). Nothing is read from Google
 * before a write any more. A minute later the app asks how each cell went: a cell the sheet refused is named once on screen,
 * a cell someone else had changed shows their value, a reason written in English comes back in Vietnamese. */
const ghiWatch = new Map();
let ghiTimer = null, ghiTries = 0;
function ghiLater(ms) { clearTimeout(ghiTimer); ghiTimer = setTimeout(ghiCheck, ms); }
// How each cell went, from the gateway (later) or the old server (at once): screen follows the sheet, problems are named once.
function ghiResults(pairs) {
  const clash = [], refused = [];
  pairs.forEach(([x, r]) => {
    const t = trackers[x.classKey];
    if (r.state === 'xong') { if (t && r.col >= 0 && r.col !== x.col) t.set(x.row, r.col, x.value === '' ? '' : String(x.value)); if (t && r.vi != null) t.set(x.row, r.col >= 0 ? r.col : x.col, r.vi); return; }
    if (r.state !== 'xong' && x.classKey) sentCells.delete(x.classKey + '|' + x.row + '|' + x.col);
    if (r.state === 'xung') { if (t) t.set(x.row, x.col, r.now || ''); clash.push(x.label || x.range); return; }
    if (r.state === 'loi') refused.push((x.label || x.range) + (r.note ? ' (' + Q.clean(r.note).slice(0, 70) + ')' : ''));
  });
  if (clash.length) say(T(clash.length + ' ô không ghi vì trên sheet đã có nội dung khác (app không ghi đè): ', clash.length + ' cells skipped, the sheet already holds something else: ') + clash.slice(0, 6).join('; ') + (clash.length > 6 ? '…' : ''), 'bad');
  if (refused.length) say(T('Sheet không nhận ' + refused.length + ' ô (đã giữ lại để quản lí xem): ', refused.length + ' cells refused by the sheet (kept for the manager): ') + refused.slice(0, 4).join('; ') + (refused.length > 4 ? '…' : ''), 'bad');
  if (clash.length || refused.length) render();
}
async function ghiCheck() {
  ghiTimer = null;
  if (!ghiWatch.size) return;
  let res;
  try { res = await call('ghixem', { ids: [...ghiWatch.keys()].slice(0, 300) }, 1); }
  catch (e) { if (++ghiTries < 30) ghiLater(60000); return; }
  const pairs = [];
  ((res && res.items) || []).forEach(r => { const x = ghiWatch.get(r.id); if (!x || r.state === 'cho') return; ghiWatch.delete(r.id); pairs.push([x, r]); });
  ghiResults(pairs);
  if (ghiWatch.size && ++ghiTries < 30) ghiLater(ghiTries < 3 ? 15000 : 60000); else ghiTries = 0;
}
writeCells = async function (file, items) {
  // The newest value of a cell wins; the first one queued holds what the sheet must still have.
  const last = new Map();
  items.forEach(x => { const seen = last.get(x.range); last.set(x.range, seen ? Object.assign({}, x, { expected: seen.expected, blind: x.blind && seen.blind }) : x); });
  const list = [...last.values()];
  list.forEach(x => { if (x.row && x.classKey && !x.name) { const t = trackers[x.classKey], p = t && t.pupils.find(q => q.row === x.row); if (p) x.name = p.name; } if (!x.cid) x.cid = newCid(); });
  const gv = teacherFor(list[0] && list[0].classKey);
  // Owner 13/11 (tests): every cell sent, not only stars, stays on this screen for 2 minutes, so a sheet copy read before the
  // gateway has put it in never shows the old value for a moment. A cell the sheet refuses or already holds differently lets go.
  const at = Date.now();
  list.filter(x => x.classKey).forEach(x => sentCells.set(x.classKey + '|' + x.row + '|' + x.col, { row: x.row, col: x.col, value: x.value, at }));
  for (let i = 0; i < list.length; i += 200) {
    const part = list.slice(i, i + 200);
    const res = await call('ghi', { file, gv, items: part.map(x => ({ cid: x.cid, range: x.range, row: x.row, col: x.col, value: x.value, expected: x.expected, blind: !!x.blind, colSig: x.colSig || '', name: x.name || '' })) }, 2);
    ((res && res.ids) || []).forEach(({ cid, id }) => { const x = part.find(y => y.cid === cid); if (x) ghiWatch.set(id, x); });
    if (res && res.done) ghiResults(res.done.map(r => [part.find(y => y.cid === r.cid), r]).filter(p => p[0]));
  }
  if (ghiWatch.size) { ghiTries = 0; ghiLater(8000); }
};

/* ---------- Như dashboard (owner 13/11: "làm giống dash… có dữ liệu mới thì update không cần F5, cực kì hiệu quả") ----------
 * Reads are kept on this page (kho) with the version the gateway gave them. Opening the app asks for the whole first screen in
 * one request (the reads this device made last time). Every 10 s, while the page is in front, one small request asks the gateway
 * which of the kept reads changed; only those are fetched again, and the screen redraws by itself. In between, the app's own
 * refreshes are answered here without going to the network. Writes drop the kept reads of their file, so a read after a write
 * always asks the gateway. If the gateway cannot answer, everything falls back to the normal way. */
const KHO_OK_MS = 25000, KHO_POLL_MS = 10000, KHO_IDLE_MS = 10 * 60000, KHO_SAVE = 'kho_keys';
const kho = new Map();
const khoClone = typeof structuredClone === 'function' ? x => structuredClone(x) : x => JSON.parse(JSON.stringify(x)); // older phones
let khoWarm = null, khoBusy = false, khoSaveAt = 0;
const khoOn = () => /workers\.dev/.test(String(CONFIG.server || ''));
const khoCell = r => /![A-Z]{1,3}\d{1,5}$/.test(String(r).replace(/\$/g, ''));
const khoKey = (op, a) => op === 'boot' ? 'boot' : op === 'get' && a && a.file && Array.isArray(a.ranges) && a.ranges.length && !a.ranges.every(khoCell) ? 'g|' + a.file + '|' + a.ranges.join('|') : '';
const khoReq = (op, a) => op === 'boot' ? { op: 'boot' } : { op: 'get', file: a.file, ranges: a.ranges.slice() };
function khoDrop(file) { kho.forEach((x, k) => { if (k.startsWith('g|' + file + '|')) { x.checked = 0; x.v = 'cu'; } }); }
async function khoFetch(list) {
  if (!list.length) return new Map();
  const res = await callBeforeKho('laynhieu', { reqs: list.map(x => ({ key: x.key, q: x.req })) }, 1);
  const out = new Map(), now = Date.now();
  ((res && res.items) || []).forEach(it => {
    const x = list.find(l => l.key === it.key), b = it.b || {};
    if (!x) return;
    if (b.ok) { const old = kho.get(it.key); kho.set(it.key, { req: x.req, data: b.data, v: it.v, checked: now, used: old ? old.used : now }); }
    out.set(it.key, b);
  });
  return out;
}
function khoSave() {
  const now = Date.now();
  if (now - khoSaveAt < 20000) return;
  khoSaveAt = now;
  keep(KHO_SAVE, { tag: keyTag(accessKey), list: [...kho.entries()].filter(([, x]) => now - x.used < KHO_IDLE_MS).slice(0, 60).map(([key, x]) => ({ key, req: x.req })) });
}
const callBeforeKho = call;
call = async function (op, args, attempts) {
  if (!khoOn()) return callBeforeKho(op, args, attempts);
  const key = khoKey(op, args);
  if (!key) {
    const out = await callBeforeKho(op, args, attempts);
    if (/^(ghi|set|add)$/.test(op) && args && args.file) khoDrop(args.file);
    return out;
  }
  if (khoWarm) { try { await khoWarm; } catch (e) {} }
  const hit = kho.get(key), now = Date.now();
  if (hit && now - hit.checked < KHO_OK_MS) { hit.used = now; return khoClone(hit.data); }
  try {
    const got = await khoFetch([{ key, req: khoReq(op, args) }]), b = got.get(key);
    if (b && b.ok) { khoSave(); return khoClone(b.data); }
    if (b && b.status && b.status < 500 && b.status !== 429) { const e = new Error(b.error || 'Lỗi máy chủ'); e.status = b.status; if (b.status === 401) return callBeforeKho(op, args, attempts); throw e; }
  } catch (e) { if (e.status && e.status < 500 && e.status !== 429) throw e; }
  return callBeforeKho(op, args, attempts);
};
// Opening: the reads of last time, in one request, before the app's own first reads.
const enterBeforeKho = enter;
enter = function () {
  const s = saved.get(KHO_SAVE);
  if (khoOn() && s && s.tag === keyTag(accessKey) && Array.isArray(s.list) && s.list.length) {
    khoWarm = khoFetch(s.list).catch(() => {}).finally(() => { khoWarm = null; });
  }
  return enterBeforeKho();
};
// What changed since: one small request every 10 s while the page is in front; then only the changed reads, and a redraw.
async function khoPoll() {
  if (!khoOn() || !me || !accessKey || khoBusy || document.visibilityState !== 'visible' || !kho.size) return;
  khoBusy = true;
  try {
    const now = Date.now();
    kho.forEach((x, k) => { if (now - x.used > KHO_IDLE_MS) kho.delete(k); });
    const items = [...kho.entries()].map(([key, x]) => ({ key, q: x.req, v: x.v }));
    if (!items.length) return;
    const res = await callBeforeKho('moi', { items }, 1);
    const changed = new Set((res && res.changed) || []), t = Date.now();
    kho.forEach((x, k) => { if (!changed.has(k)) x.checked = t; });
    if (changed.size) {
      await khoFetch([...changed].filter(k => kho.has(k)).map(k => ({ key: k, req: kho.get(k).req })));
      khoNews(changed);
    }
    khoSave();
  } catch (e) { /* the normal refreshes still run */ }
  finally { khoBusy = false; }
}
setInterval(khoPoll, KHO_POLL_MS);
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') khoPoll(); });
// New data: the screen follows at once, the same way the app's own timers would (now answered from the page, so instantly).
function khoNews(changed) {
  try {
    const keys = [...changed];
    const jobs = [];
    if (keys.some(k => k === 'boot')) jobs.push(call('boot', {}).then(b => { applyBoot(b); keep('boot', { tag: keyTag(accessKey), b, at: Date.now() }); }).catch(() => {}));
    if (keys.some(k => k.startsWith('g|' + CONFIG.diemDanhId + '|DIEM_DANH'))) jobs.push((logs.marks ? liveMarks() : loadMarks(true)).catch(() => {}));
    if (keys.some(k => k.startsWith('g|' + CONFIG.diemDanhId + '|HANH_VI'))) jobs.push(loadBehave(true).catch(() => {}));
    if (keys.some(k => k.startsWith('g|' + CONFIG.scheduleId + '|'))) jobs.push(weekOf(day, true).catch(() => {}));
    classList.forEach(c => { if (keys.some(k => k.startsWith('g|' + c.tracker + '|'))) jobs.push(loadTracker(c, true).catch(() => {})); });
    if (keys.some(k => k.startsWith('g|' + CONFIG.quanLiId + '|'))) { try { liveAll.front = 0; jobs.push(liveTick(true).catch(() => {})); } catch (e) {} }
    Promise.allSettled(jobs).then(() => {
      const a = document.activeElement;
      if (a && /^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName)) return;
      if (view === 'lenlop' && typeof llFreezeUntil !== 'undefined' && Date.now() < llFreezeUntil) return;
      render();
    });
  } catch (e) {}
}
window.addEventListener('pagehide', () => { khoSaveAt = 0; try { khoSave(); } catch (e) {} });

/* Owner 13/11 (tests: Điều hành › HS vắng took over a minute, ~30 class sheets read two at a time): the class sheets a panel needs
 * are asked for together first (a few requests of 15), so the panel's own reads are then answered on this page at once. */
async function khoPrefetchClasses(span) {
  if (!khoOn()) return;
  const t = today(), from = Q.addDays(t, span[0]), until = Q.addDays(t, span[1]);
  await Promise.all([from, t, until].map(d => Promise.resolve(weekOf(d)).catch(() => {})));
  const set = new Set();
  Object.values(weeks).forEach(w => ((w && w.data && w.data.sessions) || []).forEach(s => { const c = classOf(s); if (c && !s.off && s.day >= from && s.day <= until) set.add(c); }));
  const list = [...set].map(c => {
    const tab = quote(c.tab || TRACKER_TAB), a = { file: c.tracker, ranges: [tab + '!A1:8', tab + '!A1:E' + ROSTER_LAST] };
    return { key: khoKey('get', a), req: khoReq('get', a) };
  }).filter(x => x.key && !(kho.has(x.key) && Date.now() - kho.get(x.key).checked < KHO_OK_MS));
  for (let i = 0; i < list.length; i += 15) await khoFetch(list.slice(i, i + 15)).catch(() => {});
}
const loadPanelBeforeKho = loadPanel;
loadPanel = async function () {
  if (!['vang', 'cot', 'tong'].includes(panel)) return loadPanelBeforeKho();
  try { await khoPrefetchClasses(panel === 'cot' ? [0, 14] : panel === 'vang' ? [-7, 0] : [0, 0]); } catch (e) {}
  // Tests 13/11: the panel redrew the whole screen after every class (45 times, ~0.3 s each = 15 s of a frozen page). While it
  // loads, the screen is redrawn at most every 1.5 s, and once at the end.
  // Two loads at once (a quick second tap) share one slowed-down drawing, and the real one always comes back.
  if (!panelDraw.depth++) { panelDraw.real = render; panelDraw.last = 0; render = function () { const t = Date.now(); if (t - panelDraw.last > 1500) { panelDraw.last = t; return panelDraw.real.apply(this, arguments); } }; }
  try { return await loadPanelBeforeKho(); } finally { if (!--panelDraw.depth) { render = panelDraw.real; render(); } }
};
const panelDraw = { depth: 0, real: null, last: 0 };

/* ---------- Nhận xét lớp GV nước ngoài (owner 12–13/11) ----------
 * "mỗi một lớp dạy xong sẽ có ô điền nhận xét chung của lớp... dịch tự động sang cho chủ nhiệm duyệt rồi gửi zalo... hạn nhận xét
 * cho GV là trong ngày học hôm đó... quản lí và tôi có bảng tổng kết hàng ngày nhận xét original của GV... các lớp có người NN dạy".
 * 13/11: the homeroom teacher sends to Zalo by hand (text + the close-sheet picture are ready to copy); a teacher who has not
 * written by 21:30 is reminded; the homeroom teacher only checks and edits the translation, beside the original, never writes
 * instead of the teacher.
 *  - A lesson counts when its teacher (or helper) is a foreign teacher (staff record group GVNN, sent with the opening answer).
 *  - The comment box sits under the close sheet ("Rà soát & chốt buổi"), on the class screen and on any device; it is kept at the
 *    Cloudflare gateway (never Google), which translates it with its own AI and tells the homeroom teacher's devices.
 *  - The homeroom teacher finds it on "Lớp chủ nhiệm" and in the bell; owners/managers get Điều hành › "Nhận xét GV NN". */
let nlGvnn = new Map();
const nlMap = list => new Map((list || []).map(x => [Q.nameKey(x.name), x.xung === 'thầy' ? 'thầy' : 'cô']));
function nlNN() {
  if (!nlGvnn.size) { const b = saved.get('boot'), list = b && b.b && b.b.gvnn; if (Array.isArray(list)) nlGvnn = nlMap(list); }
  return nlGvnn;
}
const applyBootBeforeNl = applyBoot;
applyBoot = function (b) { applyBootBeforeNl(b); try { if (b && Array.isArray(b.gvnn)) nlGvnn = nlMap(b.gvnn); } catch (e) {} };
// Owner 13/11: "cơ chế tính nhận xét lớp bắt đầu từ hôm nay thôi": lessons before this day are never asked for, reminded or counted.
const NL_FROM = typeof DEMO !== 'undefined' ? '2026-11-01' : '2026-11-13';
function nlOf(s) {
  if (!s || s.off || !classOf(s) || s.day < NL_FROM) return null;
  const m = nlNN();
  for (const n of [s.teacher, s.video]) { const k = Q.nameKey(n || ''); if (k && m.has(k)) return { gv: Q.clean(n), xung: m.get(k) }; }
  return null;
}
const nlId = s => Q.sessionKey(s);
// Owner 13/11: the lesson content (book · lesson · topic from the Schedule) goes with it, so the translation can say what was learnt.
const nlMeta = (s, nn) => ({ id: nlId(s), day: s.day, cls: Q.clean(s.cls), lesson: String(s.lesson), bd: s.start, kt: s.end, label: [Q.clean(s.book), 'Lesson ' + s.lesson].filter(Boolean).join(' · '), nd: [Q.clean(s.book), s.lesson ? 'Lesson ' + s.lesson : '', String(s.detail || '').split('\n').map(Q.clean).filter(Boolean)[0] || ''].filter(Boolean).join(' · ').slice(0, 200), gv: nn.gv, cn: cmOf(s) || '', xung: nn.xung, row: s.row });
const nlx = { rows: {}, at: {}, busy: {}, reg: {}, draft: {}, saving: '', poll: {} };
// The device's store opens after this file has run, so kept drafts are taken in the first time a box is drawn (13/11 test: a draft
// written before a reload came back empty).
let nlDraftsIn = false;
const nlTakeDrafts = () => { if (nlDraftsIn || !saved.size) return; nlDraftsIn = true; try { Object.entries(saved.get('nlDrafts') || {}).forEach(([k, v]) => { if (nlx.draft[k] == null) nlx.draft[k] = v; }); } catch (e) {} };
let nlDraftTimer = null;
const nlSaveDrafts = () => { clearTimeout(nlDraftTimer); nlDraftTimer = setTimeout(() => { const keepOnly = {}; Object.entries(nlx.draft).forEach(([k, v]) => { if (/\|en$/.test(k) && v) keepOnly[k] = v; }); keep('nlDrafts', keepOnly); }, 600); };
const nlTime = ms => { const d = new Date(ms); return ('0' + d.getHours()).slice(-2) + ':' + ('0' + d.getMinutes()).slice(-2); };
const nlPhone = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
function nlSessionsOn(d) { const w = weeks[Q.weekTab(tabs, d)]; return w ? w.data.sessions.filter(s => s.day === d && nlOf(s)) : []; }
function nlFindSession(id) { for (const w of Object.values(weeks)) { const s = w.data.sessions.find(x => nlId(x) === id); if (s) return s; } return null; }
async function nlLoad(d, force) {
  if (!me || !d || nlx.busy[d] || (!force && Date.now() - (nlx.at[d] || 0) < 20000)) return;
  nlx.busy[d] = true;
  try {
    const list = nlSessionsOn(d), sig = list.map(s => nlId(s) + '|' + nlOf(s).gv + '|' + (cmOf(s) || '') + '|' + s.end).join(';');
    if (list.length && nlx.reg[d] !== sig && d >= Q.addDays(today(), -14) && d <= Q.addDays(today(), 7)) { await call('nxdk', { rows: list.map(s => nlMeta(s, nlOf(s))) }); nlx.reg[d] = sig; }
    const r = await call('nxxem', { day: d }), was = JSON.stringify(Object.values(nlx.rows).filter(x => x.day === d));
    Object.keys(nlx.rows).forEach(k => { if (nlx.rows[k].day === d) delete nlx.rows[k]; });
    (r.rows || []).forEach(x => { nlx.rows[x.id] = x; });
    nlx.at[d] = Date.now();
    if (JSON.stringify(Object.values(nlx.rows).filter(x => x.day === d)) !== was) render();
  } catch (e) { /* tried again on the next round */ } finally { nlx.busy[d] = false; }
}
// A comment just written is translated in about ten seconds: the screens that show the translation ask for that one row.
function nlPoll(id) {
  if (nlx.poll[id]) return;
  let n = 0;
  nlx.poll[id] = setInterval(async () => {
    n++;
    try { const r = await call('nxxem', { ids: [id] }), row = (r.rows || [])[0]; if (row) { nlx.rows[id] = row; if (row.vi || row.vi_err) { clearInterval(nlx.poll[id]); delete nlx.poll[id]; } render(); } } catch (e) {}
    if (n >= 24 && nlx.poll[id]) { clearInterval(nlx.poll[id]); delete nlx.poll[id]; }
  }, 5000);
}
function nlState(r, s) {
  const d = r ? r.day : s.day, t = today(), now = minutesNow(), kt = r ? r.gio_kt : s.end;
  if (r && r.zalo_at) return ['ok', T('Đã gửi Zalo ', 'Sent to parents ') + nlTime(r.zalo_at)];
  if (r && r.en) return r.ok_at ? ['warn', T('Đã duyệt, chưa gửi Zalo', 'Checked, not sent yet')] : ['warn', T('Chờ chủ nhiệm duyệt', 'Waiting for homeroom')];
  if (d < t) return nlOnTime(d) ? ['warn', T('Chưa nộp · hạn 12:00 hôm nay', 'Not written · due 12:00 today')] : ['bad', T('Chưa nộp · đã muộn', 'Not written · late')];
  if (d > t || (d === t && now < kt)) return ['', T('Chưa đến giờ tan', 'Lesson not over')];
  if (r && r.nhac_at) return ['bad', T('Chưa nộp · đã nhắc ', 'Not written · reminded ') + nlTime(r.nhac_at)];
  return ['', T('GV chưa nộp (hạn 12:00 trưa mai)', 'Due by 12:00 tomorrow')];
}
// Owner 13/11: "sau 12h trưa (hôm sau) mới là muộn... và kể cả muộn thì vẫn cho họ nhận xét" — due 12:00 the day after the lesson,
// later is marked late but never locked (the gateway keeps the same rule; the first submission decides).
const NL_DUE_AT = 12 * 60;
const nlOnTime = d => d >= today() || (d === Q.addDays(today(), -1) && minutesNow() < NL_DUE_AT);
const nlLateTag = r => r && r.muon ? '<span class="tag bad">' + T('Nộp muộn', 'Late') + '</span>' : '';
const nlChip = (r, s) => { const [c, t] = nlState(r, s); return '<span class="tag ' + c + '">' + esc(t) + '</span>' + nlLateTag(r); };

function nlPanel(s) {
  const nn = nlOf(s);
  if (!nn || !me) return '';
  const id = nlId(s), r = nlx.rows[id] || null, en = (r && r.en) || '', cn = cmOf(s);
  const canGv = isManager() || isBoard() || isMe(nn.gv), canCn = !isBoard() && (isManager() || (!!cn && isMe(cn)));
  if (!nlx.at[s.day]) setTimeout(() => nlLoad(s.day), 0);
  const lateNow = !nlOnTime(s.day);
  let h = '<div class="card nx-card" id="nx-card"><div class="nx-head"><b>📝 ' + T('Nhận xét lớp · GV nước ngoài', 'Class comment') + '</b><span class="small muted">' + esc(nn.gv) + ' · ' + esc(s.cls) + ' · ' + T('Tiết ', 'Lesson ') + esc(s.lesson) + '</span>' + nlChip(r, s) + '</div>';
  if (canGv && !(r && r.zalo_at && !isManager())) {
    nlTakeDrafts();
    const v = nlx.draft[id + '|en'] != null ? nlx.draft[id + '|en'] : en;
    h += (lateNow && !(r && r.en) ? '<div class="notice bad">' + T('Đã quá hạn 12:00 trưa hôm sau ngày học: vẫn nộp được, nhưng tính NỘP MUỘN.', 'Past the deadline (12:00 the day after the lesson): you can still submit, but it counts as LATE.') + '</div>' : '') +
      '<label class="nx-lab" for="nx-en">' + T('Nhận xét chung cả lớp (giáo viên viết bằng tiếng Anh) · hạn 12:00 trưa hôm sau ngày học', 'Your comment on the whole class, in English · due by 12:00 noon the day after the lesson') + '</label>' +
      '<textarea id="nx-en" class="nx-ta" rows="5" data-nx="en" data-id="' + esc(id) + '" placeholder="' + esc(T('Giáo viên viết bằng tiếng Anh: hôm nay cả lớp học thế nào, điều làm tốt, điều còn khó…', 'How did the class do today? What went well, what was hard, anything parents should help with…')) + '">' + esc(v) + '</textarea>' +
      '<div class="nx-btns"><button class="primary" data-act="nlSend" data-id="' + esc(id) + '"' + (nlx.saving === id ? ' disabled' : '') + '>' + (nlx.saving === id ? '⏳ ' : '') + (en ? T('Lưu sửa đổi', 'Save changes') : T('Gửi nhận xét', 'Submit')) + '</button>' +
      (r && r.en_at ? '<span class="small muted">✓ ' + T('Đã nộp lúc ', 'Submitted at ') + nlTime(r.en_at) + (r.en_by ? ' · ' + esc(r.en_by) : '') + '</span>' : '<span class="small muted">' + T('App tự dịch sang tiếng Việt cho chủ nhiệm duyệt.', 'The homeroom teacher checks the Vietnamese translation and sends it to parents.') + '</span>') + '</div>';
  } else if (en && !canCn) h += '<div class="nx-lab">' + T('Bản gốc của giáo viên', 'Teacher\'s original') + '</div><div class="nx-en">' + esc(en) + '</div>';
  else if (!en) h += '<div class="small muted">' + (lateNow ? T('Giáo viên chưa nộp, đã quá hạn 12:00 trưa hôm sau (khi nộp sẽ tính muộn).', 'Not written yet; past the deadline (will count as late).') : T('Giáo viên chưa nộp nhận xét (hạn 12:00 trưa hôm sau ngày học; 21:30 tối ngày học app nhắc giáo viên).', 'Not written yet (due by 12:00 the day after the lesson).')) + '</div>';
  if (canCn && en) h += nlCnPart(r);
  else if (r && r.zalo_at) h += '<div class="small muted">✓ ' + T('Chủ nhiệm đã gửi Zalo lúc ', 'Sent to parents at ') + nlTime(r.zalo_at) + (r.zalo_by ? ' · ' + esc(r.zalo_by) : '') + '</div>';
  return h + '</div>';
}
function nlCnPart(r) {
  const id = r.id, vi0 = r.vi_ok || r.vi || '', v = nlx.draft[id + '|vi'] != null ? nlx.draft[id + '|vi'] : vi0;
  if (!vi0 && !r.vi_err) nlPoll(id);
  let h = '<div class="nx-cn"><div class="nx-lab">' + T('Chủ nhiệm: so với bản gốc, sửa bản dịch cho đúng ý giáo viên, rồi gửi nhóm Zalo lớp', 'Homeroom: check the translation against the original, then send it to the class Zalo group') + '</div>';
  if (r.ok_at && r.en_at > r.ok_at) h += '<div class="notice warn">' + T('Giáo viên đã sửa bản gốc sau lần duyệt trước. Bấm "Dịch lại" hoặc sửa bản dịch cho khớp.', 'The teacher changed the original after it was checked. Translate again or edit to match.') + '</div>';
  h += '<div class="nx-pair"><div><div class="nx-tag">' + T('BẢN GỐC · TIẾNG ANH', 'ORIGINAL') + ' · ' + esc(r.gv || '') + '</div><div class="nx-en">' + esc(r.en) + '</div></div><div><div class="nx-tag vi">' + T('BẢN DỊCH · SỬA ĐƯỢC', 'TRANSLATION · EDITABLE') + '</div><div class="nx-headline">' + esc(r.head || '') + '</div>';
  if (!vi0 && !r.vi_err && nlx.draft[id + '|vi'] == null) h += '<div class="small muted">⏳ ' + T('Đang dịch… (khoảng 10 giây)', 'Translating… (about 10 seconds)') + '</div>';
  else h += (r.vi_err && !vi0 ? '<div class="notice bad">' + esc(r.vi_err) + T(' Bấm "Dịch lại" hoặc tự dịch vào ô dưới.', ' Translate again or type it below.') + '</div>' : '') + '<textarea id="nx-vi" class="nx-ta" rows="9" data-nx="vi" data-id="' + esc(id) + '">' + esc(v) + '</textarea>';
  h += '</div></div><div class="nx-btns">' +
    '<button data-act="nlCopyText" data-id="' + esc(id) + '">📋 ' + T('Copy chữ', 'Copy text') + '</button>' +
    '<button data-act="nlCopyImg">' + (nlPhone ? '📤 ' + T('Gửi ảnh bảng chốt', 'Share summary image') : '🖼 ' + T('Copy ảnh bảng chốt', 'Copy summary image')) + '</button>' +
    (nlPhone ? '' : '<a class="btn quiet" href="https://chat.zalo.me/" target="_blank" rel="noopener">' + T('Mở Zalo', 'Open Zalo') + '</a>') +
    '<button class="quiet" data-act="nlOk" data-id="' + esc(id) + '">💾 ' + T('Lưu bản dịch', 'Save translation') + '</button>' +
    '<button class="quiet" data-act="nlDich" data-id="' + esc(id) + '">🔁 ' + T('Dịch lại', 'Translate again') + '</button>' +
    (r.zalo_at ? '<span class="tag ok">✓ ' + T('Đã gửi Zalo ', 'Sent ') + nlTime(r.zalo_at) + (r.zalo_by ? ' · ' + esc(r.zalo_by) : '') + '</span><button class="quiet" data-act="nlZalo" data-undo="1" data-id="' + esc(id) + '">' + T('Bỏ đánh dấu', 'Undo') + '</button>'
      : '<button class="good" data-act="nlZalo" data-id="' + esc(id) + '">✓ ' + T('Đã gửi Zalo', 'Mark as sent') + '</button>') + '</div>' +
    '<div class="small muted">' + (nlPhone ? T('Bấm "Copy chữ", rồi "Gửi ảnh bảng chốt" → chọn Zalo → nhóm lớp, dán chữ vào và gửi. Xong bấm "Đã gửi Zalo".', 'Copy the text, share the image to the class Zalo group, paste the text and send. Then mark as sent.')
      : T('Copy chữ rồi dán vào nhóm Zalo lớp, copy ảnh rồi dán tiếp, tự bấm gửi. Xong bấm "Đã gửi Zalo".', 'Copy and paste the text and the image into the class Zalo group, send, then mark as sent.')) + '</div>';
  return h + '</div>';
}
const summaryViewBeforeNl = summaryView;
summaryView = function (ctx) { const h = summaryViewBeforeNl(ctx); try { return h + nlPanel(ctx.session); } catch (e) { return h; } };

// Opening a lesson's close sheet at the comment (bell, homeroom list, daily table, notifications).
function nlOpen(s) {
  const r = nlx.rows[nlId(s)], cn = cmOf(s), asCn = !isBoard() && !!(r && r.en) && (isManager() || (!!cn && isMe(cn)));
  if (asCn && typeof rpChotOpen === 'function') rpChotOpen(s);
  else {
    current = s; llMode = ''; llMenu = null; llWarn = null; llSummary = { key: Q.sessionKey(s), mode: true }; view = 'lenlop';
    document.body.classList.add('lenlop'); render(); window.scrollTo(0, 0);
    guarded(() => Promise.all([loadMarks(true), loadTracker(classOf(s), true), loadBehave(true).catch(() => {})]));
  }
  nlLoad(s.day, true);
  let n = 0; const go = setInterval(() => { const el = document.getElementById('nx-card'); if (el || ++n > 20) { clearInterval(go); if (el) el.scrollIntoView({ block: 'start', behavior: 'smooth' }); } }, 400);
}
async function nlGoId(id) {
  let s = nlFindSession(id);
  const r = nlx.rows[id];
  if (!s && (r || /^\d{4}-\d{2}-\d{2}/.test(id))) { try { await weekOf(r ? r.day : id.slice(0, 10)); } catch (e) {} s = nlFindSession(id); }
  if (!s) return say(T('Không tìm thấy buổi học này trong lịch.', 'Lesson not found in the schedule.'), 'bad');
  if (!r) await nlLoad(s.day, true);
  nlOpen(s);
}

// Homeroom page and bell.
const viewHomeroomsBeforeNl = viewHomerooms;
viewHomerooms = function () {
  const base = viewHomeroomsBeforeNl();
  try {
    const t = today(), y = Q.addDays(t, -1);
    [t, y].forEach(d => { if (!nlx.at[d]) setTimeout(() => nlLoad(d), 0); });
    const rows = Object.values(nlx.rows).filter(r => r.day >= y && (isManager() || isMe(r.cn)) && !(r.zalo_at && r.day < t)).sort((a, b) => (a.day + String(a.gio_bd).padStart(4, '0')).localeCompare(b.day + String(b.gio_bd).padStart(4, '0')));
    if (!rows.length) return base;
    const sec = '<h2>📝 ' + T('Nhận xét GV nước ngoài', 'Foreign teachers\' class comments') + '</h2><div class="card row nx-list">' + rows.map(r =>
      '<div class="nx-li"><span><b>' + esc(r.cls) + '</b> · ' + T('Tiết ', 'Lesson ') + esc(r.lesson) + ' <span class="muted small">' + esc(viDate(r.day).slice(0, 5)) + ' · ' + esc(r.gv || '') + '</span></span>' + nlChip(r, null) +
      '<button class="' + (r.en && !r.zalo_at ? 'primary' : 'quiet') + '" data-act="nlGo" data-id="' + esc(r.id) + '">' + (r.en && !r.zalo_at ? T('Duyệt & gửi', 'Check & send') : T('Mở', 'Open')) + '</button></div>').join('') + '</div>';
    const at = base.indexOf('</h2>');
    return at >= 0 ? base.slice(0, at + 5) + sec + base.slice(at + 5) : sec + base;
  } catch (e) { return base; }
};
const bellItemsBeforeNl = bellItems;
bellItems = function () {
  const out = bellItemsBeforeNl();
  try {
    if (!me || isBoard()) return out;
    const t = today(), y = Q.addDays(t, -1), now = minutesNow();
    const wait = Object.values(nlx.rows).filter(r => r.day >= y && r.en && !r.zalo_at && (isMe(r.cn) || (isManager() && !r.cn)));
    if (wait.length) out.push({ k: 'nx', icon: '📝', text: wait.length + T(' nhận xét GV nước ngoài chờ duyệt, gửi Zalo', ' class comments to check and send'), n: wait.length, hot: wait.some(r => r.day < t), go: wait.length === 1 ? { view: 'lopcn', nx: wait[0].id } : { view: 'lopcn' } });
    nlSessionsOn(t).filter(s => isMe(nlOf(s).gv) && now >= s.end && !((nlx.rows[nlId(s)] || {}).en)).forEach(s =>
      out.push({ k: 'nxgv', icon: '📝', text: T('Viết nhận xét lớp ', 'Write the class comment for ') + Q.clean(s.cls) + T(' (hạn 12:00 trưa mai)', ' (due by 12:00 tomorrow)'), n: 1, hot: now >= 21 * 60 + 30, go: { view: 'lich', nx: nlId(s) } }));
    // Yesterday's lessons still without a comment: due 12:00 today; after that still possible, late.
    nlSessionsOn(y).filter(s => isMe(nlOf(s).gv) && !((nlx.rows[nlId(s)] || {}).en)).forEach(s =>
      out.push({ k: 'nxgv', icon: '📝', text: T('Nhận xét lớp ', 'Class comment for ') + Q.clean(s.cls) + (now < NL_DUE_AT ? T(' hôm qua chưa nộp · hạn 12:00 hôm nay', ' (yesterday) is missing · due 12:00 today') : T(' hôm qua chưa nộp · đã muộn, vẫn nộp được', ' (yesterday) is missing · late, you can still submit')), n: 1, hot: true, go: { view: 'lich', nx: nlId(s) } }));
  } catch (e) {}
  return out;
};
document.addEventListener('click', e => {
  const b = e.target.closest && e.target.closest('[data-act="bellGo"],[data-act="ovGo"]');
  if (!b) return;
  const list = b.dataset.act === 'bellGo' ? bellItems() : bellItems().filter(y => !['in', 'inno', 'out'].includes(y.k)), x = list[Number(b.dataset.i)];
  if (!x || !x.go || !x.go.nx) return;
  e.stopImmediatePropagation(); bell.open = false; paintBell(); nlGoId(x.go.nx);
}, true);

// Điều hành › "Nhận xét GV NN": every foreign-teacher lesson of a day with the teacher's own words.
let nlDay = '';
PANELS.push(['nxnn', 'Nhận xét GV NN']);
PANEL_EN['Nhận xét GV NN'] = 'Class comments';
function nlDaily() {
  const d = nlDay || today(), map = new Map();
  Object.values(nlx.rows).filter(r => r.day === d).forEach(r => map.set(r.id, { r, s: nlFindSession(r.id) }));
  nlSessionsOn(d).forEach(s => { const x = map.get(nlId(s)); if (x) x.s = s; else map.set(nlId(s), { r: null, s }); });
  const list = [...map.values()].sort((a, b) => ((a.r ? a.r.gio_bd : a.s.start) - (b.r ? b.r.gio_bd : b.s.start)) || String(a.r ? a.r.cls : a.s.cls).localeCompare(String(b.r ? b.r.cls : b.s.cls)));
  const st = list.map(x => nlState(x.r, x.s || { day: d, end: x.r.gio_kt })), count = c => st.filter(x => x[0] === c).length;
  let h = '<div class="card row nx-daynav"><button class="quiet" data-act="nlDay" data-v="-1" aria-label="' + T('Ngày trước', 'Previous day') + '">‹</button><b>' + esc(Q.dayText(d, lang)) + '</b><button class="quiet" data-act="nlDay" data-v="1" aria-label="' + T('Ngày sau', 'Next day') + '">›</button>' +
    (d !== today() ? '<button class="quiet" data-act="nlDay" data-v="0">' + T('Hôm nay', 'Today') + '</button>' : '') + '<span class="spacer"></span>' +
    '<span class="tag">' + list.length + T(' buổi GV NN', ' lessons') + '</span><span class="tag ok">' + count('ok') + T(' đã gửi', ' sent') + '</span><span class="tag warn">' + count('warn') + T(' chờ chủ nhiệm', ' with homeroom') + '</span><span class="tag bad">' + count('bad') + T(' chưa/không nộp', ' missing') + '</span><span class="tag bad">' + list.filter(x => x.r && x.r.muon).length + T(' nộp muộn', ' late') + '</span></div>';
  if (!list.length) return h + '<div class="card empty">' + (nlx.busy[d] ? T('Đang đọc…', 'Loading…') : T('Không có buổi nào do giáo viên nước ngoài dạy trong ngày này.', 'No foreign-teacher lessons on this day.')) + '</div>';
  h += '<div class="card table"><table class="nx-tbl"><thead><tr><th>' + T('Lớp · bài', 'Class') + '</th><th>' + T('Giáo viên', 'Teacher') + '</th><th>' + T('Giờ', 'Time') + '</th><th>' + T('Nhận xét gốc (tiếng Anh)', 'Original comment') + '</th><th>' + T('Trạng thái', 'Status') + '</th></tr></thead><tbody>' +
    list.map((x, i) => {
      const r = x.r, s = x.s, id = r ? r.id : nlId(s), cls = r ? r.cls : Q.clean(s.cls), lesson = r ? r.lesson : s.lesson, bd = r ? r.gio_bd : s.start, kt = r ? r.gio_kt : s.end;
      const vi = r && (r.vi_ok || r.vi);
      return '<tr><td><b>' + esc(cls) + '</b><br><span class="small muted">' + esc(r ? r.label || '' : [Q.clean(s.book), 'Lesson ' + lesson].filter(Boolean).join(' · ')) + '</span></td><td>' + esc(r ? r.gv : nlOf(s).gv) + (r && r.cn ? '<br><span class="small muted">CN ' + esc(r.cn) + '</span>' : '') + '</td><td class="num">' + Q.clock(bd) + '–' + Q.clock(kt) + '</td>' +
        '<td class="nx-orig">' + (r && r.en ? esc(r.en) + (vi ? '<details><summary class="small">' + T('Bản tiếng Việt', 'Vietnamese') + (r.vi_ok ? T(' (đã duyệt)', ' (checked)') : T(' (bản dịch máy)', ' (machine)')) + '</summary><div class="nx-vi-small">' + esc(r.head || '') + '\n\n' + esc(vi) + '</div></details>' : '') : '<span class="muted">—</span>') + '</td>' +
        '<td><span class="tag ' + st[i][0] + '">' + esc(st[i][1]) + '</span>' + nlLateTag(r) + (r && r.zalo_by ? '<br><span class="small muted">' + esc(r.zalo_by) + '</span>' : '') + '<br><button class="quiet small" data-act="nlGo" data-id="' + esc(id) + '">' + T('Mở', 'Open') + '</button></td></tr>';
    }).join('') + '</tbody></table></div>';
  return h;
}
const viewManagerBeforeNl = viewManager;
viewManager = function (week) { return panel === 'nxnn' ? panelTabs() + nlDaily() : viewManagerBeforeNl(week); };
const loadPanelBeforeNl = loadPanel;
loadPanel = async function () {
  if (panel !== 'nxnn') return loadPanelBeforeNl();
  const d = nlDay || today();
  await weekOf(d);
  await nlLoad(d, true);
  render();
};

// Typing keeps a draft (the teacher's English survives a reload); buttons do the work.
document.addEventListener('input', e => { const t = e.target; if (t && t.dataset && t.dataset.nx && t.dataset.id) { nlx.draft[t.dataset.id + '|' + t.dataset.nx] = t.value; if (t.dataset.nx === 'en') nlSaveDrafts(); } });
const nlText = id => { const ta = document.querySelector('textarea[data-nx="vi"][data-id="' + CSS.escape(id) + '"]'), r = nlx.rows[id] || {}; return (ta ? ta.value : nlx.draft[id + '|vi'] != null ? nlx.draft[id + '|vi'] : r.vi_ok || r.vi || '').trim(); };
async function nlDo(id, op, args, okText) {
  nlx.saving = id; render();
  try { const r = await call(op, Object.assign({ id }, args)); if (r && r.row) nlx.rows[id] = r.row; if (okText) say(okText); return r; }
  catch (e) { say(e.message || String(e), 'bad'); return null; }
  finally { nlx.saving = ''; render(); }
}
function nlSheetBlob() {
  return loadH2c().then(() => {
    const el = document.querySelector('.sum-sheet');
    if (!el) throw new Error('no sheet');
    return window.html2canvas(el, { scale: 2, backgroundColor: '#ffffff', useCORS: true, logging: false,
      onclone: d => { const st = d.createElement('style'); st.textContent = '.sum-sheet{box-shadow:none!important;border-radius:0!important;margin:0!important}.sum-sheet,.sum-sheet *{font-variant-numeric:normal!important;font-feature-settings:normal!important;font-variant-ligatures:none!important}'; d.head.appendChild(st); } });
  }).then(c => new Promise((ok, bad) => c.toBlob(b => b ? ok(b) : bad(new Error('blob')), 'image/png')));
}
function nlCopyImg(btn) {
  if (!document.querySelector('.sum-sheet')) return say(T('Mở bảng chốt của buổi này để copy ảnh.', 'Open the lesson summary to copy its image.'), 'bad');
  const save = document.querySelector('[data-act="sumSave"]');
  // Phones: the share menu (pick Zalo), as "Lưu ảnh" does. Computers: straight to the clipboard, pasted into Zalo with Ctrl+V.
  if (nlPhone || !(navigator.clipboard && navigator.clipboard.write && window.ClipboardItem)) { if (save) sumSave(save); return; }
  const label = btn.innerHTML; btn.disabled = true; btn.innerHTML = '⏳ ' + T('Đang tạo ảnh…', 'Making image…');
  navigator.clipboard.write([new ClipboardItem({ 'image/png': nlSheetBlob() })])
    .then(() => say(T('Đã copy ảnh bảng chốt. Vào nhóm Zalo lớp, bấm Ctrl+V để dán.', 'Summary image copied. Paste it into the class Zalo group (Ctrl+V).')))
    .catch(() => { if (save) sumSave(save); })
    .finally(() => { btn.disabled = false; btn.innerHTML = label; });
}
function nlCopyText(id) {
  const r = nlx.rows[id], text = ((r && r.head) || '') + '\n\n' + nlText(id);
  const fallback = () => { const ta = document.querySelector('textarea[data-nx="vi"][data-id="' + CSS.escape(id) + '"]'); if (ta) { ta.focus(); ta.select(); } say(T('Máy này không cho copy tự động: chữ đã được chọn, bấm Ctrl+C (hoặc giữ → Sao chép). Nhớ thêm dòng tiêu đề.', 'Select and copy the text by hand.'), 'bad'); };
  try { navigator.clipboard.writeText(text).then(() => say(T('Đã copy nhận xét (kèm dòng tiêu đề). Dán vào nhóm Zalo lớp.', 'Comment copied with its title line.')), fallback); } catch (e) { fallback(); }
}
document.addEventListener('click', e => {
  const b = e.target.closest && e.target.closest('[data-act]');
  if (!b) return;
  const act = b.dataset.act, id = b.dataset.id || '';
  if (!/^(nlSend|nlOk|nlZalo|nlDich|nlCopyText|nlCopyImg|nlGo|nlDay|tbOn|tbLater)$/.test(act)) return;
  e.stopImmediatePropagation();
  if (act === 'nlSend') {
    const ta = document.querySelector('textarea[data-nx="en"][data-id="' + CSS.escape(id) + '"]'), en = (ta ? ta.value : nlx.draft[id + '|en'] || '').trim();
    if (!en) return say(T('Nhận xét đang trống.', 'The comment is empty.'), 'bad');
    const s = nlFindSession(id), nn = s && nlOf(s);
    nlDo(id, 'nxgv', { en, meta: s && nn ? nlMeta(s, nn) : undefined }, T('Đã gửi nhận xét. Chủ nhiệm sẽ duyệt bản dịch và gửi phụ huynh.', 'Thank you! Your comment was submitted.'))
      .then(r => { if (r) { delete nlx.draft[id + '|en']; delete nlx.draft[id + '|vi']; nlSaveDrafts(); render(); } });
    return;
  }
  if (act === 'nlOk') { const vi = nlText(id); if (!vi) return say(T('Bản dịch đang trống.', 'The translation is empty.'), 'bad'); nlDo(id, 'nxok', { vi }, T('Đã lưu bản dịch.', 'Saved.')).then(r => { if (r) { delete nlx.draft[id + '|vi']; render(); } }); return; }
  if (act === 'nlZalo') {
    const undo = !!b.dataset.undo, vi = undo ? '' : nlText(id);
    if (!undo && !vi) return say(T('Chưa có bản dịch để gửi.', 'No translation yet.'), 'bad');
    nlDo(id, 'nxzalo', undo ? { undo: 1 } : { vi }, undo ? T('Đã bỏ đánh dấu.', 'Unmarked.') : T('Đã ghi: chủ nhiệm đã gửi Zalo.', 'Marked as sent.')).then(r => { if (r) { delete nlx.draft[id + '|vi']; render(); } });
    return;
  }
  if (act === 'nlDich') {
    say(T('Đang dịch lại…', 'Translating…'));
    nlDo(id, 'nxdich', {}, '').then(r => { if (r && r.row) { nlx.draft[id + '|vi'] = r.row.vi || ''; say(T('Đã dịch lại. Kiểm tra rồi bấm Lưu bản dịch.', 'Translated again.')); render(); } });
    return;
  }
  if (act === 'nlCopyText') return nlCopyText(id);
  if (act === 'nlCopyImg') return nlCopyImg(b);
  if (act === 'nlGo') return void nlGoId(id);
  if (act === 'nlDay') { const v = Number(b.dataset.v); nlDay = v ? Q.addDays(nlDay || today(), v) : today(); render(); guarded(loadPanel); return; }
  if (act === 'tbOn') return void tbOn();
  if (act === 'tbLater') { keep('tbLater', Date.now() + 7 * 86400000); render(); return; }
}, true);
// Fresh rows while a page that shows them is open; otherwise now and then for the bell (one small read each time).
setInterval(() => {
  if (!me || document.hidden) return;
  const t = today(), s = view === 'lenlop' && current && nlOf(current) ? current : null;
  if (s) nlLoad(s.day, true);
  else if (view === 'lopcn') { nlLoad(t, true); nlLoad(Q.addDays(t, -1)); }
  else if (view === 'dieuhanh' && panel === 'nxnn') nlLoad(nlDay || t, true);
}, 60000);
setInterval(() => { if (me && !document.hidden && !isBoard() && nlSessionsOn(today()).length) nlLoad(today(), true); }, 300000);
setTimeout(() => { if (me && !isBoard()) { nlLoad(today()); if (isManager() || isCm()) nlLoad(Q.addDays(today(), -1)); } }, 8000);

/* ---------- Thông báo đẩy (owner 13/11: "thông báo ở điện thoại hoặc laptop… như 1 ứng dụng thực sự") ----------
 * Each person taps "Bật thông báo" once per device and allows it. The gateway keeps that device's push address and sends
 * through the browser's own push service, so a notification arrives with the app closed (Android, Windows/Mac browsers; an
 * iPhone after "Thêm vào MH chính"). Tapping it opens the app at the right place (?mo=…). */
const tb = { sub: null, checked: false, busy: false };
const tbOk = () => 'serviceWorker' in navigator && 'PushManager' in window && typeof Notification !== 'undefined';
const tbIOS = /iPhone|iPad|iPod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const tbStandalone = () => (window.matchMedia && matchMedia('(display-mode: standalone)').matches) || navigator.standalone === true;
const tbKey = () => { const s = String(CONFIG.vapid || '').replace(/-/g, '+').replace(/_/g, '/'); return Uint8Array.from(atob(s + '='.repeat((4 - s.length % 4) % 4)), c => c.charCodeAt(0)); };
async function tbCheck() {
  if (tbOk()) {
    try { const reg = await navigator.serviceWorker.ready; tb.sub = await reg.pushManager.getSubscription(); } catch (e) {}
    // The gateway's copy stays current (renewed addresses, a new link on this device), once a day.
    if (tb.sub && Notification.permission === 'granted' && me && !isBoard() && Date.now() - (saved.get('tbAt') || 0) > 86400000)
      call('tbdk', { sub: tb.sub.toJSON(), ua: navigator.userAgent.slice(0, 120) }).then(() => keep('tbAt', Date.now())).catch(() => {});
  }
  tb.checked = true; render();
}
function tbCard() {
  if (!me || isBoard() || !tb.checked || (saved.get('tbLater') || 0) > Date.now()) return '';
  const later = '<button class="quiet" data-act="tbLater">' + T('Để sau', 'Later') + '</button>';
  if (!tbOk()) return tbIOS && !tbStandalone() ? '<div class="card row tb-card"><b>🔔 ' + T('Nhận thông báo trên iPhone', 'Notifications on iPhone') + '</b><span class="small">' + T('Mở app bằng Safari → bấm nút Chia sẻ ⬆️ → "Thêm vào MH chính". Mở app từ biểu tượng mới đó rồi bấm "Bật thông báo" ở đây.', 'In Safari tap Share ⬆️ → "Add to Home Screen", open the app from that icon, then turn notifications on here.') + '</span>' + later + '</div>' : '';
  if (tb.sub && Notification.permission === 'granted') return '';
  if (Notification.permission === 'denied') return '<div class="card row tb-card"><b>🔕 ' + T('Thông báo đang bị chặn', 'Notifications are blocked') + '</b><span class="small">' + T('Bấm biểu tượng ổ khoá cạnh địa chỉ trang → Thông báo → Cho phép, rồi tải lại trang.', 'Allow notifications in the site settings (lock icon by the address), then reload.') + '</span>' + later + '</div>';
  return '<div class="card row tb-card"><b>🔔 ' + T('Bật thông báo trên máy này', 'Turn on notifications on this device') + '</b><span class="small muted">' + T('Báo ngay khi có việc cần bạn (nhận xét chờ duyệt, nhắc viết nhận xét…), kể cả khi đang không mở app.', 'Get told at once when something needs you, even with the app closed.') + '</span>' +
    '<button class="primary" data-act="tbOn"' + (tb.busy ? ' disabled' : '') + '>' + (tb.busy ? '⏳ ' : '') + T('Bật thông báo', 'Turn on') + '</button>' + later + '</div>';
}
async function tbOn() {
  if (tb.busy || !tbOk()) return;
  tb.busy = true;
  try {
    const perm = await Notification.requestPermission();
    render();
    if (perm !== 'granted') { say(T('Bạn chưa cho phép thông báo trên máy này.', 'Notifications were not allowed.'), 'bad'); return; }
    const reg = await navigator.serviceWorker.ready;
    let sub = await reg.pushManager.getSubscription();
    if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: tbKey() });
    await call('tbdk', { sub: sub.toJSON(), ua: navigator.userAgent.slice(0, 120) });
    keep('tbAt', Date.now()); tb.sub = sub;
    const r = await call('tbthu', {});
    say(r && r.sent ? T('Đã bật thông báo. Máy vừa nhận một thông báo thử.', 'Notifications are on. A test notification was sent.') : T('Đã bật thông báo.', 'Notifications are on.'));
  } catch (e) { say(T('Chưa bật được thông báo: ', 'Could not turn notifications on: ') + (e.message || e), 'bad'); }
  finally { tb.busy = false; render(); }
}
const todoCardBeforeTb = todoCard;
todoCard = function () { const t = todoCardBeforeTb(); return me && !isBoard() && day === today() ? tbCard() + t : t; };
setTimeout(() => { if (me) tbCheck(); else setTimeout(tbCheck, 6000); }, 3000);

// A notification tapped: open the app at that place, in this window if one is open.
let nlPending = null;
function nlTryPending() {
  if (!nlPending || !me || !tabs || !tabs.length || isBoard()) return;
  const p = nlPending; nlPending = null;
  if (p.id) return void nlGoId(p.id);
  if (p.mo === 'nx') { view = 'lopcn'; render(); }
  // Owner 13/11 (test of every message): a tap opens the place where the thing is handled.
  if (p.mo === 'ca' && isManager()) { view = 'dieuhanh'; panel = 'ca'; render(); guarded(loadPanel); }
  if (p.mo === 'vang') { if (isManager()) { view = 'dieuhanh'; panel = 'vang'; filters.person = ''; render(); guarded(loadPanel); } else { view = 'lopcn'; render(); } }
  if (p.mo === 'hs') { view = 'lich'; day = today(); render(); bell.open = true; paintBell(); }
}
try {
  const q = new URLSearchParams(location.search);
  if (q.get('mo')) { nlPending = { mo: q.get('mo'), id: q.get('id') || '' }; history.replaceState(null, '', location.pathname + location.hash); }
} catch (e) {}
setInterval(nlTryPending, 1500);
try { navigator.serviceWorker.addEventListener('message', e => { if (e.data && e.data.type === 'mo') { try { const u = new URL(e.data.url, location.href); nlPending = { mo: u.searchParams.get('mo') || '', id: u.searchParams.get('id') || '' }; nlTryPending(); } catch (x) {} } }); } catch (e) {}

(function nlStyle() {
  try {
    const st = document.createElement('style');
    st.textContent = '.nx-card{margin:14px auto;width:100%;box-sizing:border-box;max-width:1000px;display:grid;gap:10px;padding:14px;text-align:left}' +
      '.nx-head{display:flex;flex-wrap:wrap;gap:6px 10px;align-items:center}.nx-lab{font-size:13px;font-weight:600;color:var(--muted)}' +
      '.nx-ta{width:100%;box-sizing:border-box;font:inherit;font-size:15px;line-height:1.55;padding:10px 12px;border:1px solid var(--line);border-radius:10px;background:var(--card);color:var(--ink);resize:vertical}' +
      '.nx-en{white-space:pre-wrap;background:var(--soft);border-radius:10px;padding:10px 12px;font-size:14px;line-height:1.55}' +
      '.nx-pair{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:12px}@media(max-width:720px){.nx-pair{grid-template-columns:1fr}}' +
      '.nx-tag{font-size:11px;font-weight:700;letter-spacing:.05em;color:var(--muted);margin-bottom:4px}.nx-tag.vi{color:var(--brand)}.nx-headline{font-weight:700;font-size:14px;margin-bottom:6px}' +
      '.nx-btns{display:flex;flex-wrap:wrap;gap:8px;align-items:center}.nx-cn{display:grid;gap:10px;border-top:1px solid var(--line);padding-top:12px}' +
      '.nx-list{display:grid;gap:0}.nx-li{display:flex;flex-wrap:wrap;gap:6px 10px;align-items:center;justify-content:space-between;padding:8px 0;border-bottom:1px solid var(--line)}.nx-li:last-child{border-bottom:0}' +
      '.nx-daynav{display:flex;flex-wrap:wrap;gap:8px;align-items:center}.nx-tbl td{vertical-align:top}.nx-orig{white-space:pre-wrap;min-width:240px;max-width:520px;font-size:13.5px;line-height:1.5}' +
      '.nx-vi-small{white-space:pre-wrap;font-size:13px;margin-top:6px;color:var(--ink)}.tb-card{display:flex;flex-wrap:wrap;gap:8px 12px;align-items:center}.tb-card .small{flex:1 1 260px}';
    document.head.appendChild(st);
  } catch (e) {}
})();
// The "Bật thông báo" card: at the top of today's schedule and inside the bell (it replaces the old "only while the app runs" ask).
const viewScheduleBeforeTb = viewSchedule;
viewSchedule = function (week) { const h = viewScheduleBeforeTb(week); try { return (day === today() ? tbCard() : '') + h; } catch (e) { return h; } };
const paintBellBeforeTb = paintBell;
paintBell = function () {
  paintBellBeforeTb();
  try {
    const box = document.querySelector('#bellPanel .bell-box');
    if (!box) return;
    const old = box.querySelector('[data-act="bellAsk"]'); if (old) old.remove();
    const c = tbCard();
    if (c && !box.querySelector('.tb-card')) { const top = box.querySelector('.row-top'); if (top) top.insertAdjacentHTML('afterend', c); }
  } catch (e) {}
};

/* ---------- iPhone: the app on the home screen keeps its own storage (owner 13/11: "ở iphone nó báo là vui lòng mở app từ link
 * riêng") ----------
 * Safari and the home-screen app do not share what the page keeps, so the link opened in Safari is unknown there. The sign-in
 * screen takes the private link pasted in, and Safari's notification card offers "Copy link riêng" to carry it over. */
(function linkPaste() {
  const box = document.querySelector('#login .login-box'), msg = document.getElementById('loginMsg');
  if (!box || !msg || document.getElementById('linkPaste')) return;
  msg.insertAdjacentHTML('afterend', '<div class="link-paste"><label for="linkPaste" class="small" id="linkPasteLab"></label><div class="link-row"><input id="linkPaste" type="url" inputmode="url" autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="https://…#k=…"><button class="primary" id="linkGo"></button></div></div>');
  const paint = () => { document.getElementById('linkPasteLab').textContent = T('Hoặc dán link riêng vào đây (cần khi mở app từ màn hình chính iPhone):', 'Or paste your private link here (needed for the iPhone home-screen app):'); document.getElementById('linkGo').textContent = T('Vào app', 'Open'); };
  paint();
  const paintLoginBeforeLink = paintLogin;
  paintLogin = function () { paintLoginBeforeLink(); try { paint(); } catch (e) {} };
  const go = () => {
    const el = document.getElementById('linkPaste'), m = String(el.value || '').match(/k=([A-Za-z0-9_-]{24,})/);
    if (!m) { msg.textContent = T('Chưa thấy mã trong link. Dán đúng cả link riêng (có đoạn #k=…).', 'No key found. Paste the whole private link (with #k=…).'); return; }
    el.value = ''; msg.textContent = ''; keep('key', m[1]); accessKey = m[1]; enter();
  };
  document.getElementById('linkGo').addEventListener('click', go);
  document.getElementById('linkPaste').addEventListener('keydown', e => { if (e.key === 'Enter') go(); });
  try { const st = document.createElement('style'); st.textContent = '.link-paste{display:grid;gap:6px;margin:12px 0;text-align:left}.link-row{display:flex;gap:8px}.link-row input{flex:1;min-width:0;font:inherit;font-size:16px;padding:10px 12px;border:1px solid var(--line);border-radius:10px;background:var(--card);color:var(--ink)}'; document.head.appendChild(st); } catch (e) {}
})();
const myLink = () => location.origin + location.pathname + '#k=' + accessKey;
const tbCardBeforeIos = tbCard;
tbCard = function () {
  const h = tbCardBeforeIos();
  if (!h || !tbIOS || tbStandalone() || !accessKey) return h;
  return h.replace('<button class="quiet" data-act="tbLater">', '<button class="primary" data-act="tbCopyLink">📋 ' + T('Copy link riêng', 'Copy my link') + '</button><button class="quiet" data-act="tbLater">')
    .replace(T('Mở app bằng Safari → bấm nút Chia sẻ ⬆️ → "Thêm vào MH chính". Mở app từ biểu tượng mới đó rồi bấm "Bật thông báo" ở đây.', 'In Safari tap Share ⬆️ → "Add to Home Screen", open the app from that icon, then turn notifications on here.'), T('Bấm "Copy link riêng", rồi Chia sẻ ⬆️ → "Thêm vào MH chính". Mở app từ biểu tượng mới, dán link vào ô "dán link riêng", bấm Vào app, rồi bấm "Bật thông báo".', 'Tap "Copy my link", then Share ⬆️ → "Add to Home Screen". Open the new icon, paste the link, tap Open, then turn notifications on.'));
};
document.addEventListener('click', e => {
  const b = e.target.closest && e.target.closest('[data-act="tbCopyLink"]');
  if (!b) return;
  e.stopImmediatePropagation();
  const done = () => say(T('Đã copy link riêng. Đừng gửi link này cho ai khác.', 'Your private link is copied. Do not share it.'));
  try { navigator.clipboard.writeText(myLink()).then(done, () => window.prompt && window.prompt(T('Copy link này:', 'Copy this link:'), myLink())); } catch (err) {}
}, true);

/* ---------- Owner 13/11: "thông tin quan trọng phải báo qua app… dùng thông báo rồi thì thôi popup ở màn hình"; "15p hs chưa đến…
 * nhắn tin bố mẹ… nếu bạn ý đến rồi GV sẽ tick điểm danh thì hiển thị ở đâu đó để tôi biết… để quản lí hay mọi người trong team
 * không hoang mang hoặc phải chạy lên tận lớp để xem đến chưa" ----------
 *  - The gateway sends the messages itself (no roll call at 15 minutes, pupils with no news, "đã đến lớp", a new pupil). It needs
 *    to know today's lessons and each class's pupils: a device with the app open registers them (op skdk), and reads the sheet of
 *    a class about to start so the list is there in time.
 *  - Lịch (today) shows "Vắng đầu giờ hôm nay": who has no news yet, with the same buttons as the old pop-up, and who has since
 *    arrived, with the time. A pupil counts as "arrived late" when the first present tick came 15 minutes or more into the lesson
 *    and not within the roll call itself (3 minutes from its first tick). A toast says so on devices that have the app open.
 *  - A device with notifications on no longer gets the red pop-up; a device without them keeps it. */
const sk = { sig: '', busy: false, tried: new Set(), told: null, restUntil: 0 };
const SK_ROLL = () => Q.ROLL_CALL_MINUTES, SK_SETTLE = 3;
const skStampMin = at => { const m = String(at || '').match(/(\d{1,2}):(\d{2})(?::\d{2})?\s*$/); return m ? Number(m[1]) * 60 + Number(m[2]) : -1; };
function skToday() { const t = today(), w = weeks[Q.weekTab(tabs, t)]; return w ? w.data.sessions.filter(s => s.day === t && !s.off && classOf(s)) : []; }
const skCn = s => { try { return cmOf(s) || ''; } catch (e) { return ''; } };
const skMine = s => isManager() || isMe(skCn(s)) || isMe(s.ta) || takesRoll(s);
const skActs = s => isManager() || isMe(skCn(s)) || isMe(s.ta);
async function skRegister() {
  if (!me || sk.busy || Date.now() < sk.restUntil) return;
  const list = skToday(), now = minutesNow();
  if (!list.length) return;
  list.forEach(s => {
    const c = classOf(s);
    if (!trackers[c.key] && !sk.tried.has(c.key) && skMine(s) && now >= s.start - 20 && now <= s.end) { sk.tried.add(c.key); loadTracker(c, false, true).then(() => skRegister()).catch(() => {}); }
  });
  const rows = list.map(s => {
    let names = [];
    try { const ctx = trackers[classOf(s).key] ? classContext(s) : null; if (ctx && ctx.tracker) names = ctx.tracker.pupils.map(p => [p.name, p.eng || '']); } catch (e) {}
    // Owner 13/11 "đến giờ chưa đến cũng báo": teacher and video staff are due 10 minutes before the lesson (TAs register their own time).
    return { id: Q.sessionKey(s), day: s.day, cls: Q.clean(s.cls), lesson: String(s.lesson), gio: Q.clock(s.start), bd: s.start, kt: s.end, gv: Q.clean(s.teacher || ''), cn: skCn(s), names };
  });
  let toi = null;
  // 14/11 audit: one's own time by the same contract rules (it knows the staff record's choice); 0 = not due today.
  try { if (!isOwner() && !isBoard()) { const w = weeks[Q.weekTab(tabs, today())]; if (w) { const due = dueFor(w, today(), me.name); toi = { due: due === null ? 0 : due }; } } } catch (e) {}
  // Owner 13/11 23:45: everyone's due time today by the contract rules (the same as the check-in panel), for "chưa vào ca".
  let caList = [];
  try { const w = weeks[Q.weekTab(tabs, today())]; caList = staffOfDay(w, today()).map(n => { const due = dueFor(w, today(), n); if (due === null) return null; const s = (w ? w.data.sessions : []).filter(z => z.day === today() && !z.off && Q.staffOf(z).some(p => p.role !== 'TA' && nameIs(p.name, n))).sort((a, b) => a.start - b.start)[0]; return [n, due, s ? Q.clean(s.cls) : '']; }).filter(Boolean); } catch (e) {}
  const sig = JSON.stringify([rows, toi, caList]);
  if (sig === sk.sig) return;
  sk.busy = true;
  try { await call('skdk', { rows, toi, ca: caList }); sk.sig = sig; } catch (e) { sk.restUntil = Date.now() + 10 * 60000; /* gateway away or not updated yet: asked again in 10 minutes, nothing is lost */ } finally { sk.busy = false; }
}
setInterval(() => { if (!document.hidden) skRegister().catch(() => {}); }, 60000);
setTimeout(() => skRegister().catch(() => {}), 15000);

// What the roll-call rows say about each of today's lessons that I may see.
function skLook() {
  const t = today(), now = minutesNow(), out = [];
  if (!me || !logs.marks) return out;
  skToday().filter(s => skMine(s) && now >= s.start + SK_ROLL()).forEach(s => {
    const prefix = [s.day, s.classKey, s.lesson, Q.clock(s.start)].join('|') + '|', first = new Map();
    let rollStart = 1e9;
    logs.marks.rows.forEach(m => {
      if (!markKey(m).startsWith(prefix) || !Q.PRESENT.includes(m.status)) return;
      const at = skStampMin(m.at); if (at < 0) return;
      if (!first.has(m.name) || at < first.get(m.name).at) first.set(m.name, { at, by: m.by, eng: m.eng });
      if (at < rollStart) rollStart = at;
    });
    const ctx = trackers[classOf(s).key] ? classContext(s) : null, marks = ctx ? ctx.marks : marksOf(s), roll = Q.rollCall(s, marks, t, now);
    const item = { s, none: roll.noRollCall && now <= s.end + 120, came: [], wait: [] };
    first.forEach((f, name) => {
      const m = marks.get(name);
      if (m && Q.PRESENT.includes(m.status) && f.at >= s.start + SK_ROLL() && f.at >= rollStart + SK_SETTLE) item.came.push({ name, eng: f.eng || (m && m.eng) || '', at: f.at, by: f.by, late: f.at - s.start });
    });
    if (ctx && ctx.tracker && !roll.noRollCall && now <= s.end + 120) ctx.tracker.pupils.forEach(p => { const m = marks.get(p.name); if (Q.pupilState(m, roll) === 'Vắng chờ xác minh') item.wait.push({ p, contact: !!(m && m.contact) }); });
    item.came.sort((a, b) => a.at - b.at);
    if (item.none || item.came.length || item.wait.length) out.push(item);
  });
  return out;
}
const skShort = n => { const w = Q.clean(n).split(' '); return w.length > 2 ? w.slice(-2).join(' ') : Q.clean(n); };
function skCard() {
  let items = [];
  try { items = skLook(); } catch (e) { return ''; }
  if (!items.length) return '';
  const phone = p => { const ph = (String(p.phone || '').match(/[\d ]{9,}/) || [''])[0].trim(); return ph ? '<a href="tel:' + esc(ph.replace(/\s/g, '')) + '">📞 ' + esc(ph) + '</a>' : ''; };
  const btn = (s, x, act, v, cls, label) => '<button class="' + cls + '" data-act="' + act + '" data-v="' + v + '" data-row="' + s.row + '" data-day="' + s.day + '" data-name="' + esc(x.p.name) + '">' + label + '</button>';
  const body = items.map(it => '<div class="ph-cls"><b>' + esc(it.s.cls) + '</b> <span class="muted small">' + Q.clock(it.s.start) + (skCn(it.s) ? ' · ' + T('CN ', 'Homeroom ') + esc(titleCase(skCn(it.s))) : '') + '</span>' +
    (it.none ? '<div class="ph-none">' + T('Chưa điểm danh sau 15 phút', 'No roll call 15 minutes in') + (it.s.teacher ? ' · ' + esc(titleCase(it.s.teacher)) : '') + '</div>' : '') +
    it.wait.map(x => '<div class="ph-line"><span class="ph-who"><span class="tag ' + (x.contact ? 'warn' : 'bad') + '">⏳ ' + T('Chưa đến', 'Not here') + '</span> <b>' + esc(x.p.eng || skShort(x.p.name)) + '</b> <small>' + esc(x.p.name) + ' · ' + (x.contact ? T('đã liên hệ phụ huynh', 'parent contacted') : T('chưa liên hệ phụ huynh', 'parent not contacted')) + '</small> ' + (skActs(it.s) ? phone(x.p) : '') + '</span>' +
      (skActs(it.s) ? '<span class="ph-btns">' + btn(it.s, x, 'absence', 'Có phép', 'mid', T('Có phép', 'Excused')) + btn(it.s, x, 'absence', 'Không phép', 'low', T('Không phép', 'Unexcused')) + (x.contact ? '' : btn(it.s, x, 'contact', '', 'good', '📞 ' + T('Đã liên hệ PH', 'Parent contacted'))) + '</span>' : '') + '</div>').join('') +
    it.came.map(x => '<div class="ph-line"><span class="ph-who"><span class="tag ok">✅ ' + T('Đã đến ', 'Arrived ') + Q.clock(x.at) + '</span> <b>' + esc(x.eng || skShort(x.name)) + '</b> <small>' + T('muộn ', '') + x.late + T(' phút', ' min late') + (x.by ? ' · ' + esc(titleCase(x.by)) + T(' điểm danh', ' took the roll') : '') + '</small></span></div>').join('') + '</div>').join('');
  const wait = items.reduce((n, it) => n + it.wait.length + (it.none ? 1 : 0), 0), came = items.reduce((n, it) => n + it.came.length, 0);
  return '<div class="card sk-card"><b>🕒 ' + T('Vắng đầu giờ hôm nay', 'Missing at the start today') + '</b> <span class="small muted">' + [wait ? wait + T(' chưa có tin', ' with no news') : '', came ? came + T(' đã đến muộn', ' arrived late') : ''].filter(Boolean).join(' · ') + T(' · tự cập nhật khi giáo viên điểm danh', ' · updates as the roll is taken') + '</span>' + body + '</div>';
}
const viewScheduleBeforeSk = viewSchedule;
// Owner 13/11: "Vắng học hs đầu giờ không cần hiển thị 1 đống như này, mình có thông báo rồi": the card is no longer shown on Lịch.
viewSchedule = function (week) { return viewScheduleBeforeSk(week); };
// A late arrival is also said aloud (a toast) on devices that have the app open; the first look only takes note.
function skWatch() {
  let items = [];
  try { items = skLook(); } catch (e) { return; }
  const keys = new Map();
  // Never on a class screen, and never to the teacher of the lesson (owner 13/11: "giáo viên đang dạy tuyệt đối không làm phiền").
  items.filter(it => skActs(it.s) && !takesRoll(it.s)).forEach(it => it.came.forEach(x => keys.set(Q.sessionKey(it.s) + '|' + x.name, (x.eng || skShort(x.name)) + ' (' + Q.clean(it.s.cls) + ')' + T(' đã đến lớp lúc ', ' arrived at ') + Q.clock(x.at))));
  if (sk.told && view !== 'lenlop' && !isBoard() && !skPushOn()) keys.forEach((text, k) => { if (!sk.told.has(k)) say('✅ ' + text); });
  if (logs.marks) sk.told = new Set(keys.keys());
}
setInterval(skWatch, 20000);
// The red pop-up stays only on devices without notifications.
const skPushOn = () => { try { return !!tb.sub && Notification.permission === 'granted'; } catch (e) { return false; } };
const paintPhPopBeforeSk = paintPhPop;
// Owner 13/11 22:46: "bỏ hẳn popup đi": the red "Cần nhắn phụ huynh ngay" pop-up is gone for everyone; the phone notifications
// and the bell carry it.
paintPhPop = function () { const box = document.getElementById('phPop'); if (box) box.remove(); };
try { const st = document.createElement('style'); st.textContent = '.sk-card{display:block}.sk-card .ph-cls:first-of-type{margin-top:8px}.sk-card .tag{white-space:nowrap}'; document.head.appendChild(st); } catch (e) {}

/* ---------- Owner 13/11: "tôi vẫn chưa nhận được thông báo nào kể từ khi cài app"; "không có gì lưu trữ… tôi xem ở đâu" ----------
 * The bell keeps every message the gateway sent you (30 days), so nothing is lost when a phone does not show it. "Gửi thử tới máy
 * này" re-registers this device and has the gateway send one message to it 8 seconds later, time enough to leave the app. A message
 * about a class comment opens that comment. A teacher only teaching a lesson no longer gets the red "chưa điểm danh" pop-up
 * (owner: "giáo viên đang dạy tuyệt đối không làm phiền"); the homeroom teacher and managers still do. */
const hop = { items: null, at: 0, busy: false, here: null, test: '', all: false };
async function hopLoad(force) {
  if (!me || isBoard() || hop.busy || (!force && Date.now() - hop.at < 30000)) return;
  hop.busy = true;
  try { const r = await call('tbhop', { endpoint: tb.sub ? tb.sub.endpoint : '' }); hop.items = r.items || []; hop.here = r.thisDevice; }
  catch (e) { if (hop.items == null) hop.items = []; }
  finally { hop.at = Date.now(); hop.busy = false; if (bell.open) paintBell(); }
}
const hopWhen = ms => { const d = new Date(ms), p = n => ('0' + n).slice(-2); return p(d.getHours()) + ':' + p(d.getMinutes()) + ' ' + p(d.getDate()) + '/' + p(d.getMonth() + 1); };
function hopHtml() {
  const on = tbOk() && tb.sub && Notification.permission === 'granted';
  const state = !tbOk() ? (tbIOS && !tbStandalone() ? T('Trên iPhone chỉ nhận thông báo khi mở app từ biểu tượng ở màn hình chính.', 'On iPhone, open the app from its home-screen icon to get notifications.') : T('Trình duyệt này không nhận được thông báo.', 'This browser cannot get notifications.'))
    : Notification.permission === 'denied' ? T('Thông báo đang bị chặn trên máy này.', 'Notifications are blocked on this device.')
    : on ? (hop.here === false ? T('Máy này đã cho phép nhưng cổng chưa có địa chỉ máy: bấm Gửi thử để đăng ký lại.', 'Allowed here but not registered: press Test.') : T('Máy này đã bật thông báo.', 'Notifications are on for this device.'))
    : T('Máy này chưa bật thông báo.', 'Notifications are off on this device.');
  const btn = on ? '<button class="quiet" data-act="hopTest">🔔 ' + T('Gửi thử tới máy này', 'Test this device') + '</button>' : (tbOk() && Notification.permission !== 'denied' ? '<button class="primary" data-act="tbOn">' + T('Bật thông báo', 'Turn on') + '</button>' : '');
  const list = hop.items == null ? '<div class="small muted">' + T('Đang tải…', 'Loading…') + '</div>' : !hop.items.length ? '<div class="small muted">' + T('Chưa có thông báo nào gửi tới bạn.', 'Nothing sent to you yet.') + '</div>'
    : hop.items.slice(0, hop.all ? 30 : 3).map(x => { const id = (String(x.url || '').match(/[?&]id=([^&]+)/) || [])[1]; return '<div class="hop-item' + (id ? ' go' : '') + '"' + (id ? ' data-act="hopGo" data-id="' + esc(decodeURIComponent(id)) + '"' : '') + '><div><b>' + esc(x.title || '') + '</b> <span class="small muted">' + hopWhen(x.at) + '</span></div><div class="small">' + esc(x.body || '').replace(/\n/g, '<br>') + '</div></div>'; }).join('') + (hop.items.length > 3 ? '<button class="quiet small" data-act="hopAll">' + (hop.all ? T('Thu gọn', 'Show less') : T('Xem tất cả ', 'Show all ') + hop.items.length + T(' tin', '')) + '</button>' : '');
  return '<div class="hop"><div class="row-top"><b>📬 ' + T('Thông báo đã gửi tới bạn', 'Messages sent to you') + '</b>' + btn + '</div><div class="small muted">' + esc(state) + '</div>' + (hop.test ? '<div class="small hop-test">' + esc(hop.test) + '</div>' : '') + list + '</div>';
}
const paintBellBeforeHop = paintBell;
paintBell = function () {
  paintBellBeforeHop();
  try {
    const box = document.querySelector('#bellPanel .bell-box');
    if (!box || !me || isBoard()) return;
    const old = box.querySelector('.hop'); if (old) old.remove();
    // Top of the bell, under its title and the "turn notifications on" card (owner: "tôi xem ở đâu").
    const after = box.querySelector('.tb-card') || box.querySelector('.row-top');
    if (after) after.insertAdjacentHTML('afterend', hopHtml()); else box.insertAdjacentHTML('afterbegin', hopHtml());
    hopLoad(false);
  } catch (e) {}
};
document.addEventListener('click', async e => {
  const b = e.target.closest && e.target.closest('[data-act="hopTest"],[data-act="hopGo"],[data-act="hopAll"]');
  if (!b) return;
  e.stopImmediatePropagation();
  if (b.dataset.act === 'hopAll') { hop.all = !hop.all; paintBell(); return; }
  if (b.dataset.act === 'hopGo') { bell.open = false; paintBell(); try { await nlGoId(b.dataset.id); } catch (err) {} return; }
  if (!tb.sub) return;
  hop.test = T('Đang gửi…', 'Sending…'); paintBell();
  try {
    try { await call('tbdk', { sub: tb.sub.toJSON(), ua: navigator.userAgent.slice(0, 120) }); keep('tbAt', Date.now()); } catch (err) {}
    await call('tbthu', { endpoint: tb.sub.endpoint, later: true });
    hop.test = T('Tin thử sẽ tới sau khoảng 8 giây: vuốt về màn hình chính hoặc khoá máy để xem. Không thấy gì thì vào Cài đặt → Thông báo → Quản lí lớp: bật Cho phép thông báo, Màn hình khoá, Biểu ngữ; tắt chế độ Tập trung / Không làm phiền.', 'A test arrives in about 8 seconds: leave the app or lock the phone. Nothing? Allow notifications for this app in Settings and turn Focus off.');
  } catch (err) { hop.test = T('Gửi không được: ', 'Failed: ') + (err.message || err); }
  paintBell();
  setTimeout(() => { hop.at = 0; hopLoad(true); }, 9500);
}, true);
const phItemsBeforeHop = phItems;
phItems = function () { return phItemsBeforeHop().filter(it => !it.none || isManager() || isMe(skCn(it.s)) || isMe(it.s.ta)); };
try { const st = document.createElement('style'); st.textContent = '.hop{border-bottom:1px solid var(--line);padding-bottom:10px;margin-bottom:4px;display:grid;gap:6px}.hop>.quiet.small{justify-self:start}.hop .row-top{display:flex;gap:8px;align-items:center;justify-content:space-between;flex-wrap:wrap}.hop-item{padding:6px 8px;border-radius:10px;background:var(--soft)}.hop-item.go{cursor:pointer}.hop-item.go:hover{outline:1px solid var(--line)}.hop-test{color:var(--brand)}'; document.head.appendChild(st); } catch (e) {}

/* ---------- Owner 13/11 22:55: "nhận xét lớp này có thể tích hợp vào lớp học xong luôn... ấn nút là hiện bảng nhỏ... sao phải tab
 * riêng làm gì" ----------
 * Tapping a lesson on the Lịch timeline opens its small card; for a lesson with a foreign teacher that card now shows the class
 * comment right there: its state, the teacher's original, the translation, and for the homeroom teacher and managers a button that
 * opens the full box to check the translation and send it to Zalo. Seen by managers, the homeroom teacher and the teacher. */
const tlInfoDialogBeforeNl = tlInfoDialog;
tlInfoDialog = function () {
  const h = tlInfoDialogBeforeNl();
  try {
    if (!h || !tlInfoOpen || !me || isBoard()) return h;
    const w = weeks[Q.weekTab(tabs, tlInfoOpen.day)], s = w && w.data.sessions.find(z => z.row === tlInfoOpen.row), nn = s && nlOf(s);
    if (!nn) return h;
    const cn = cmOf(s), asCn = isManager() || (!!cn && isMe(cn));
    if (!asCn && !isMe(nn.gv)) return h;
    const id = nlId(s), r = nlx.rows[id] || null;
    if (!nlx.at[s.day] && !nlx.busy[s.day]) setTimeout(() => { nlLoad(s.day).catch(() => {}); }, 0);
    const col = (label, text) => '<div class="tl-nx-col"><div class="small muted">' + label + '</div><div class="tl-nx-txt">' + esc(text) + '</div></div>';
    const body = r && r.en ? '<div class="tl-nx-cols">' + col(T('Bản gốc · GV ', 'Original · ') + esc(nn.gv), r.en) + col(r.vi_ok ? T('Bản dịch · đã duyệt', 'Translation · checked') : T('Bản dịch tự động', 'Translation'), r.vi_ok || r.vi || T('Đang dịch…', 'Translating…')) + '</div>'
      : '<div class="small muted">' + (nlx.at[s.day] ? T('GV ', 'Teacher ') + esc(nn.gv) + T(' chưa nộp nhận xét buổi này.', ' has not written it yet.') : T('Đang tải nhận xét…', 'Loading…')) + '</div>';
    const btn = asCn && r && r.en ? '<button class="quiet" data-act="tlNx" data-id="' + esc(id) + '">' + (r.zalo_at ? T('Xem đầy đủ ›', 'Open ›') : T('Duyệt bản dịch & gửi Zalo ›', 'Check & send ›')) + '</button>' : '';
    const box = '<div class="tl-nx"><div class="tl-nx-head"><b>📝 ' + T('Nhận xét lớp', 'Class comment') + '</b>' + nlChip(r, s) + '</div>' + body + btn + '</div>';
    return h.replace('<div class="tl-btns">', box + '<div class="tl-btns">');
  } catch (e) { return h; }
};
document.addEventListener('click', e => {
  const b = e.target.closest && e.target.closest('[data-act="tlNx"]');
  if (!b) return;
  e.stopImmediatePropagation();
  tlInfoOpen = null;
  nlGoId(b.dataset.id).catch(() => {});
}, true);
try { const st = document.createElement('style'); st.textContent = '.tl-nx{border:1px solid var(--line);border-radius:12px;padding:10px;margin:10px 0;display:grid;gap:8px}.tl-nx-head{display:flex;gap:8px;align-items:center;flex-wrap:wrap}.tl-nx-cols{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:8px}.tl-nx-txt{white-space:pre-wrap;font-size:14px;max-height:180px;overflow:auto;background:var(--soft);border-radius:8px;padding:8px}.tl-nx>.quiet{justify-self:start}'; document.head.appendChild(st); } catch (e) {}

/* ---------- Owner 13/11 23:00: "ấn HS mới Jen rồi mà cứ hiện popup suốt"; earlier "dùng thông báo rồi thì thôi popup ở màn hình" ----------
 * The "Việc cần làm" pop-up (class off to announce, new-pupil steps) is gone for everyone. The same items stay in the bell and in
 * the quick lists on Lịch, where each one is ticked as before. */
paintOffPop = function () { const box = document.getElementById('offPop'); if (box) box.remove(); };

/* ---------- Owner 13/11 23:05 ("có đâu nhỉ"): which lessons hold a class comment is visible on the timeline itself ----------
 * A lesson with a foreign teacher gets a small mark on its bar: 📝 written (✓ once sent to Zalo), ⏳ not written yet after the
 * lesson. Tapping the bar opens the card with the comment. Shown to managers, the homeroom teacher and the teacher. */
function tlMarkComments() {
  if (!me || isBoard() || view !== 'lich') return;
  const days = new Set();
  document.querySelectorAll('.tl-bar[data-act="tlInfo"]').forEach(b => {
    if (b.querySelector('.tl-nxm')) return;
    const w = weeks[Q.weekTab(tabs, b.dataset.day)], s = w && w.data.sessions.find(z => z.row === Number(b.dataset.row) && z.day === b.dataset.day), nn = s && nlOf(s);
    if (!nn) return;
    const cn = cmOf(s);
    if (!(isManager() || (cn && isMe(cn)) || isMe(nn.gv))) return;
    days.add(s.day);
    const r = nlx.rows[nlId(s)], over = s.day < today() || (s.day === today() && minutesNow() >= s.end);
    const mark = r && r.en ? (r.zalo_at ? '📝✓' : '📝') : over ? '⏳' : '';
    if (mark) b.insertAdjacentHTML('afterbegin', '<span class="tl-nxm" title="' + (r && r.en ? T('Có nhận xét lớp', 'Class comment written') : T('GV chưa nộp nhận xét', 'Comment not written')) + '">' + mark + '</span>');
  });
  days.forEach(d => { if (!nlx.at[d] && !nlx.busy[d]) nlLoad(d).catch(() => {}); });
}
const renderBeforeTlMark = render;
render = function () { renderBeforeTlMark(); try { tlMarkComments(); } catch (e) {} };
try { const st = document.createElement('style'); st.textContent = '.tl-bar .tl-nxm{margin-right:3px;font-size:11px}'; document.head.appendChild(st); } catch (e) {}

/* ---------- Owner 13/11 23:08 (screenshot of the list view ≡ on her iPhone): the same 📝 / ⏳ mark on each row of the list view;
 * tapping the mark opens the lesson's small card with the comment (tapping the rest of the row still opens the class). ---------- */
function stMarkComments() {
  if (!me || isBoard() || view !== 'lich') return;
  document.querySelectorAll('.st-row[data-act="open"]').forEach(row => {
    if (row.querySelector('.tl-nxm')) return;
    const day = row.dataset.day, w = weeks[Q.weekTab(tabs, day)], s = w && w.data.sessions.find(z => z.row === Number(row.dataset.row) && z.day === day), nn = s && nlOf(s);
    if (!nn) return;
    const cn = cmOf(s);
    if (!(isManager() || (cn && isMe(cn)) || isMe(nn.gv))) return;
    const r = nlx.rows[nlId(s)], over = s.day < today() || (s.day === today() && minutesNow() >= s.end);
    const mark = r && r.en ? (r.zalo_at ? '📝✓' : '📝') : over ? '⏳' : '';
    if (!nlx.at[s.day] && !nlx.busy[s.day]) nlLoad(s.day).catch(() => {});
    const cell = row.children[1] || row;
    if (mark) cell.insertAdjacentHTML('beforeend', ' <span class="tl-nxm st-nxm" role="button" data-tlrow="' + s.row + '" data-tlday="' + s.day + '" title="' + T('Xem nhận xét lớp', 'Class comment') + '">' + mark + (r && r.en ? ' ' + T('Nhận xét', 'Comment') : '') + '</span>');
  });
}
const renderBeforeStMark = render;
render = function () { renderBeforeStMark(); try { stMarkComments(); } catch (e) {} };
window.addEventListener('click', e => {
  const m = e.target.closest && e.target.closest('.st-nxm[data-tlrow]');
  if (!m) return;
  e.preventDefault(); e.stopImmediatePropagation();
  tlInfoOpen = { row: Number(m.dataset.tlrow), day: m.dataset.tlday };
  render();
}, true);
try { const st = document.createElement('style'); st.textContent = '.st-nxm{display:inline-block;margin-left:6px;padding:2px 8px;border-radius:99px;background:var(--brand-soft);color:var(--brand);font-size:12px;font-weight:700;cursor:pointer;white-space:nowrap}'; document.head.appendChild(st); } catch (e) {}

/* ---------- Owner 13/11 23:45 ("Thu Hiền không đi làm mà vẫn hiện có mặt 17:05… Sơn… Phương… kiểm tra kĩ") ----------
 * Anyone's due time by the contract rules of 10/11, the same as one's own "Có mặt trước":
 *  - a name under "Nghỉ" on the day's rota: no due time;
 *  - full-time (Thùy Trang, Văn Sơn, My Linh, or "Toàn thời gian" on the record): 15:30 Mon–Fri, weekends by the rota rule;
 *  - part-time TAs: the rota shift, else 17:00 on a rota weekday (weekend rota rule); not on the rota: only a class they teach or
 *    film sets a time; the homeroom column never does;
 *  - everyone else: 10 minutes before their first class as teacher or video, tutor sessions excluded (no check-in for tutoring).
 * The staff record's choice is only known for the person signed in; others follow the same lists the app already uses. */
const nameIs = (a, full) => { const k = Q.key(a), m = Q.key(full); return !!k && !!m && (k === m || (!k.includes(' ') && m.split(' ').pop() === k)); };
function rotaDueFor(week, d, name) {
  const x = dutyOf(week, d), mine = x && x.work.find(p => nameIs(p.name, name)), sh = mine && Q.shiftOf(mine.note);
  if (sh) return sh.start;
  const wd = new Date(d + 'T12:00:00').getDay();
  if (wd >= 1 && wd <= 5) return ROTA_DUE.week;
  const note = Q.key(mine ? mine.note : ''), pm = wd === 6 ? ROTA_DUE.sat : ROTA_DUE.sun;
  if (/SANG|CA NGAY/.test(note)) return ROTA_DUE.am;
  if (/CHIEU/.test(note)) return pm;
  // Owner 14/11 ("mai Thùy Trang, My Linh, Sơn phải có mặt sáng 8:45"): on the weekend rota with no word beside the name, the
  // morning time. Someone who only works the afternoon has "chiều" written beside the name.
  return ROTA_DUE.am;
}
function dueFor(week, d, name) {
  if (!name) return null;
  try { if ([...ownerKeys()].includes(Q.key(canonStaff(name)))) return null; } catch (e) {}
  const x = dutyOf(week, d);
  if (x && x.off.some(p => nameIs(p.name, name))) return null;
  const wd = new Date(d + 'T12:00:00').getDay(), weekday = wd >= 1 && wd <= 5;
  const mine = me && sameName(me.name, name) && me.ca ? me.ca : '';
  const mode = mine === 'none' ? 'none' : mine === 'lop' ? 'lop' : mine === 'full' || (!mine && isFullTimeStaff(name)) ? 'full' : mine === 'part' || (!mine && isPartTime(name)) ? 'part' : 'lop';
  if (mode === 'none') return null;
  if (mode === 'full') return weekday ? FULL_DUE : (x && x.work.some(p => nameIs(p.name, name)) ? rotaDueFor(week, d, name) : null);
  let due = null;
  if (mode === 'part') { const w = x && x.work.find(p => nameIs(p.name, name)), sh = w && Q.shiftOf(w.note); due = sh ? sh.start : w ? (weekday ? PART_DUE : rotaDueFor(week, d, name)) : null; }
  // Owner 14/11: "tính theo ca tutor nếu tutor sớm hơn": a tutor session counts like a class for teachers and part-time staff
  // (full-time staff keep 15:30 whatever they tutor, as decided on 10/11).
  (week ? week.data.sessions : []).filter(s => s.day === d && !s.off).forEach(s => Q.staffOf(s).forEach(p => {
    if (p.role !== 'TA' && nameIs(p.name, name) && (due === null || p.due < due)) due = p.due;
  }));
  return due;
}
// Everyone who may be due on a day: the rota, the classes (teacher, video, homeroom) and whoever checked in.
function staffOfDay(week, d) {
  const out = new Map(), put = n => { const c = canonStaff(n), k = Q.key(c); if (k && !out.has(k)) out.set(k, c); };
  const x = dutyOf(week, d);
  if (x) x.work.forEach(p => put(p.name));
  (week ? week.data.sessions : []).filter(s => s.day === d && !s.off).forEach(s => Q.staffOf(s).forEach(p => put(p.name)));
  return [...out.values()];
}

/* ---------- Owner 14/11: "màn hình nhận xét bị đơ còn không kéo được" (IELTS Speaking, nhận xét từng em) ----------
 * The class screen redraws itself whenever anything on it changes: a mark from another device, a save going through, and after
 * every automatic save of a comment. Each redraw rebuilt the comment window, so it jumped back to its top and the cursor left the
 * box being typed in; the list could not be scrolled past the first pupils. A redraw now puts an open window (comments, test
 * scores, reasons) back as it was: same scroll position, same box, same text and cursor. */
// (A text box in focus already stops every redraw, so typing was safe; the jump came while scrolling or reading. The class board
// rebuilds its whole page on every redraw, so there it happened every few seconds.)
let sheetMovedAt = 0, sheetLater = null;
['touchmove', 'wheel', 'scroll'].forEach(ev => document.addEventListener(ev, e => { const t = e.target; if (t && t.closest ? t.closest('.ll-sheet') : (t && t.classList && t.classList.contains('ll-sheet'))) sheetMovedAt = Date.now(); }, { capture: true, passive: true }));
const renderBeforeSheetKeep = render;
render = function () {
  const main = $('main'), sh = main && main.querySelector('.ll-sheet'), top = sh ? sh.scrollTop : 0;
  // While a finger is dragging the list, the redraw waits a moment (a rebuilt list would stop the drag).
  if (sh && Date.now() - sheetMovedAt < 900) { clearTimeout(sheetLater); sheetLater = setTimeout(() => { try { render(); } catch (e) {} }, 1000); return; }
  renderBeforeSheetKeep();
  try { if (top) { const now = $('main').querySelector('.ll-sheet'); if (now && now !== sh) now.scrollTop = top; } } catch (e) {}
};
try { const st = document.createElement('style'); st.textContent = '.ll-sheet.nx-sheet{overscroll-behavior:contain;-webkit-overflow-scrolling:touch;max-height:min(88vh,calc(100dvh - 24px))}'; document.head.appendChild(st); } catch (e) {}

/* ---------- Owner 14/11 ("làm sao 100% đọc theo dash không theo sheet, bỏ luôn sheet") ----------
 * For classes whose pupils have their own pages (KIDS, IELTS, FIGHTER) the work still owed comes from those pages only. The
 * sheet-based count is never shown in their place any more: not while the pages are being read, and not for a pupil whose page
 * gave no answer (the two disagreed: Linda of KIDS 34, who moved in on 25/10, was shown owing videos 31 and 32 that her page
 * never gave her). While the pages are being read, or when they could not be read, the class page and the class screen say so
 * instead of showing a number. A class without pupil pages keeps the sheet. */
const dashOnly = s => !!s && !!classOf(s) && (isSecondary(s) || /^KIDS\s*\d+/i.test(Q.clean(s.cls)));
function dashStateOf(s) {
  const c = s && classOf(s);
  if (!c || !dashOnly(s)) return 'none';
  if (isSecondary(s)) { const st = pageRun[c.key]; return st && st.rows && st.rows.length ? 'ok' : !st || st.running ? 'wait' : 'fail'; }
  const hit = dashOwed[c.key], d = hit && hit.data;
  return d && d.pupils && d.pupils.some(p => p.ok) ? 'ok' : !hit || hit.loading ? 'wait' : 'fail';
}
const dashOpened = s => s.day < today() || (s.day === today() && minutesNow() >= s.start - Q.OPEN_BEFORE);
const owedOfBeforeDashOnly = owedOf;
owedOf = function (ctx) {
  const s = ctx && ctx.session;
  if (!s || !ctx.tracker || isSecondary(s) || !dashOnly(s)) return owedOfBeforeDashOnly(ctx);
  const dash = dashOwedFor(ctx), opened = dashOpened(s);
  return ctx.tracker.pupils.map((p, i) => dash && dash[i] ? dash[i].filter(x => !x.resubmit && (x.due < s.day || (opened && x.due === s.day))).map(dashToOwed) : []);
};
const totalOwedBeforeDashOnly = totalOwed;
totalOwed = function (ctx) {
  const s = ctx && ctx.session;
  if (!s || !ctx.tracker || isSecondary(s) || !dashOnly(s)) return totalOwedBeforeDashOnly(ctx);
  const dash = dashOwedFor(ctx);
  return ctx.tracker.pupils.map((p, i) => dash && dash[i] ? dash[i].filter(x => !x.resubmit && x.due < s.day).map(dashToOwed) : []);
};
const secOwedForBeforeDashOnly = secOwedFor;
secOwedFor = function (s) {
  const c = s && classOf(s);
  if (!c || !isSecondary(s)) return secOwedForBeforeDashOnly(s);
  const run = pageRunFor(s);
  if (!run) return null;
  const yesterday = Q.addDays(today(), -1), tr = trackers[c.key], who = row => (tr && tr.pupils.find(p => p.row === row)) || {};
  return { at: run.at, data: { pupils: run.rows.filter(r => r.owed && r.owed.length).map(r => ({ row: r.row, name: who(r.row).name || '', eng: who(r.row).eng || '', owed: r.owed.map(label => ({ label, due: yesterday, self: /tự luyện|reading intensive|listening|shadowing/i.test(label) })) })) } };
};
const dashNote = s => {
  const st = dashStateOf(s);
  return st === 'wait' ? '<div class="small muted dash-note">⏳ ' + T('Đang đọc bài thiếu từ trang học sinh…', 'Reading owed work from the pupils\' pages…') + '</div>'
    : st === 'fail' ? '<div class="notice warn dash-note">⚠️ ' + T('Chưa đọc được bài thiếu từ trang học sinh, nên số bài thiếu chưa hiện. Bấm "↻ Đọc lại sheet" để thử lại.', 'Owed work could not be read from the pupils\' pages yet, so it is not shown. Press ↻ to try again.') + '</div>' : '';
};
const withDashNote = (h, anchor) => { try { const n = current ? dashNote(current) : ''; if (!n) return h; const at = h.indexOf(anchor); return at >= 0 ? h.slice(0, at) + n + h.slice(at) : n + h; } catch (e) { return h; } };
const viewLenLopBeforeDashOnly = viewLenLop;
viewLenLop = function () { return withDashNote(viewLenLopBeforeDashOnly(), '<div class="rv-list"'); };
const viewClassBeforeDashOnly = viewClass;
viewClass = function () { return withDashNote(viewClassBeforeDashOnly(), '<div class="card roll-fit">'); };
