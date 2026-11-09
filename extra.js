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
const isPartTime = name => PART_TIME_TA.some(n => sameName(n, name)) || Object.values(weeks).some(w => (w.pay || []).some(e => e.kind === 'Part-time' && sameName(e.person, name)));
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
  const people = new Map();
  (week ? week.data.sessions : []).filter(s => s.day === day && !s.off).forEach(s => Q.staffOf(s).forEach(p => { const n = canonStaff(p.name), k = Q.key(n); if (!people.has(k) || people.get(k).due > p.due) people.set(k, { name: n, due: p.due }); }));
  const duty = dutyOf(week, day);
  if (duty) duty.work.forEach(p => { const n = canonStaff(p.name), k = Q.key(n); if (!people.has(k)) people.set(k, { name: n, due: null }); });
  ca.all.filter(r => r.day === day).forEach(r => { const k = Q.key(r.person); if (!people.has(k)) people.set(k, { name: r.person, due: null }); });
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
  const label = l => { const words = String(l).split(' '); let k = 0; while (k < words.length && !/[a-z]/.test(words[k])) k++; const vi = words.slice(0, k).join(' ').trim(), en = words.slice(k).join(' ').replace(/^\(|\)$/g, '').trim(); const pick = lang === 'en' ? (en || vi) : (vi || en); return pick.charAt(0) + pick.slice(1).toLowerCase().replace(/\bielts\b/i, 'IELTS').replace(/\btncn\b/i, 'TNCN').replace(/\bbhxh\b/i, 'BHXH'); };
  const row = x => '<div class="slip-row' + (isTotal(x) ? ' total' : '') + (/^0 đ$/.test(x.value) ? ' zero' : '') + '"><span>' + esc(label(x.label)) + '</span><b>' + esc(x.value) + '</b></div>';
  const section = (title, list, cls) => list.length ? '<div class="slip-sec ' + cls + '"><h3>' + title + '</h3>' + list.map(row).join('') + '</div>' : '';
  const net = paid.find(x => /CÒN LẠI/i.test(x.label)) || paid.find(x => /THỰC NHẬN/i.test(x.label)), rest = paid.filter(x => x !== net);
  return '<div class="card slip"><div class="slip-head"><div><div class="small muted">' + esc(s.tab) + '</div><b class="slip-name">' + esc(s.name) + '</b>' + (s.role ? '<div class="small muted">' + esc(s.role) + '</div>' : '') + '</div>' +
    '<div class="slip-net"><span>' + esc(net ? label(net.label) : T('Thực nhận', 'Net')) + '</span><b>' + esc(s.net || (net && net.value) || '—') + '</b>' + rest.map(x => '<small>' + esc(label(x.label)) + ': ' + esc(x.value) + '</small>').join('') + '</div></div>' +
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
  h += '<p class="small muted">' + T('Ngày ' + viDate(d.dates.show) + ' bảng lương hiện cho từng người; mỗi người kiểm tra dòng của mình đến hết ngày ' + viDate(d.dates.check) + '; cô trả lương ngày ' + viDate(d.dates.pay) + '.', 'Shows ' + viDate(d.dates.show) + ', check by ' + viDate(d.dates.check) + ', paid ' + viDate(d.dates.pay) + '.') + '</p>';
  if (isOwner()) {
    if (pay.person && pay.mine) h += '<div><button class="quiet" data-act="payBack">‹ ' + T('Cả bảng', 'Everyone') + '</button></div>' + slipCard(pay.mine) + '<div class="card row">' + payStateLine(pay.mine.state) + '</div>';
    else {
      const rows = d.rows || [], checked = rows.filter(r => r.state && r.state.check && r.state.check.action === 'Đúng' && !r.state.check.stale).length, wrong = rows.filter(r => r.state && r.state.check && r.state.check.action === 'Báo sai').length, paid = rows.filter(r => r.state && r.state.paid).length;
      h += '<div class="count"><span>' + rows.length + T(' người', ' people') + '</span><span class="tag ok">' + checked + T(' xác nhận đúng', ' confirmed') + '</span>' + (wrong ? '<span class="tag bad">' + wrong + T(' báo sai', ' wrong') + '</span>' : '') + '<span class="tag">' + paid + T(' đã trả', ' paid') + '</span></div>';
      if (!rows.length) h += '<div class="card empty">' + T('Chưa có tab NVVN/GVNN của ' + monthName(d.month) + ' trong file bảng lương.', 'No payroll tab for this month.') + '</div>';
      h += '<div class="list">' + rows.map(r => '<div class="card row"><div class="row-top"><b>' + esc(r.name) + '</b><span class="muted small">' + esc(r.tab) + (r.person ? ' · ' + T('link ', 'app ') + esc(r.person) : ' · ' + T('chưa có người dùng khớp tên', 'no app user')) + '</span><span class="spacer"></span><b>' + esc(r.net) + '</b></div>' +
        '<div>' + payStateLine(r.state) + '</div>' + (r.person ? '<div class="choices"><button class="quiet" data-act="payOpen" data-p="' + esc(r.person) + '">' + T('Xem chi tiết', 'Open') + '</button>' +
        (r.state && r.state.paid ? '<button class="quiet" data-act="payPaid" data-v="Bỏ đã trả" data-p="' + esc(r.person) + '">' + T('Bỏ đánh dấu đã trả', 'Unmark paid') + '</button>' : '<button class="good" data-act="payPaid" data-v="Đã trả" data-p="' + esc(r.person) + '">' + T('Đã trả lương', 'Mark paid') + '</button>') + '</div>' : '') + '</div>').join('') + '</div>';
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
  if (!payNudge.slip || (c && !c.stale) || today() > payNudge.dates.check) return '';
  return '<div class="notice">💰 ' + T('Bảng lương ' + monthName(payNudge.month) + ' đã có. Bạn kiểm tra và xác nhận trước hết ngày ' + viDate(payNudge.dates.check) + '.', 'Your payslip is ready, please check it.') + ' <button class="primary" data-act="view" data-v="luong">' + T('Xem lương', 'Open') + '</button></div>';
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
  if (act === 'payOpen') { pay.person = b.dataset.p; loadLuong(true); }
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
const contactOld = x => { const d = viToIso(x.since); return x.level < 4 && !!d && d < CONTACT_START; };
const isFriday = d => new Date(d + 'T12:00:00').getDay() === 5;
function contactRule(x) {
  const since = viToIso(x.since) || today();
  if (x.level >= 4) return { action: 'Đã gọi PH', who: x.level === 4 ? (homeroom[Q.key(x.cls)] || T('Chủ nhiệm', 'Homeroom')) : T('Quản lí', 'Manager'), due: Q.addDays(since, 2), call: true };
  return { action: 'Đã nhắn PH', who: isFriday(today()) ? 'THUY TRANG' : T('Quản lí', 'Manager'), due: since, call: false };
}
const contactDone = (x, rule) => (ladder.contacts || []).filter(c => sameName(c.cls, x.cls) && c.name === x.name && c.level === x.level && c.since === x.since && c.action === rule.action).pop();
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
  if (b.dataset.act === 'ladPrint') window.print();
});

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
        if ((!c || c.stale) && t <= payNudge.dates.check) add('pay', '💰', T('Bảng lương đã có, xác nhận trước ' + viDate(payNudge.dates.check), 'Payslip ready, please confirm'), 1, t === payNudge.dates.check, { view: 'luong' });
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
    '<span class="spacer"></span>' + (link && open ? '<a class="btn quiet" href="' + esc(link) + '" target="_blank" rel="noopener">' + T('Mở BÁO CÁO', 'Open report tab') + '</a>' : '') +
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
      (reportLink(x.s) ? '<a class="btn quiet" href="' + esc(reportLink(x.s)) + '" target="_blank" rel="noopener">' + T('Mở BÁO CÁO', 'Open') + '</a>' : '') + '<button class="good" data-act="rpDone" data-k="' + esc(x.k) + '">' + T('Đã report ✓', 'Done') + '</button></div>').join('') +
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
  const t = ctx.tracker, key = Q.sessionKey(ctx.session) + '|' + t.at;
  if (owedMemo.key !== key) { owedMemo.key = key; try { owedMemo.list = Q.owedVideos(t.pupils, t.blocks, t.practices, t.cell, ctx.session); } catch (e) { owedMemo.list = []; } }
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
const sumStamp = at => { const d = new Date(at || Date.now()), p = n => String(n).padStart(2, '0'); return p(d.getHours()) + ':' + p(d.getMinutes()) + ' ngày ' + p(d.getDate()) + '/' + p(d.getMonth() + 1) + '/' + d.getFullYear(); };
function summaryOn(s) {
  const key = Q.sessionKey(s);
  if (llSummary.key !== key) llSummary = { key, mode: null };
  return llSummary.mode === null ? lessonEnded(s) : llSummary.mode;
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
      '<td class="sum-debt">' + (debt.length ? '<b>Thiếu ' + debt.length + ' video:</b> ' + esc(kidsKinds(owed[r.i] || [])) : '<span class="sum-ok">Không thiếu ✓</span>') + '</td></tr>';
  }).join('');
  const head = '<tr><th></th><th>Học sinh</th><th>Điểm danh</th>' + (noStars ? '' : '<th>Sao</th>') + (noGrade ? '' : '<th class="sum-c">Bài tập sách giấy</th>') + '<th>Nhắc nhở</th><th>Video còn thiếu</th></tr>';
  return chotBar(s) + '<div class="sum-bar"><button class="quiet" data-act="llSumClose">‹ ' + T('Quay lại màn hình lớp', 'Back to the class screen') + '</button><span class="spacer"></span>' +
    '<button class="quiet" data-act="llSumRefresh">↻ ' + T('Đọc lại sheet', 'Re-read the sheet') + '</button><span class="small muted">' + T('Chụp phần khung trắng bên dưới để gửi phụ huynh.', 'Take a photo of the white sheet below for parents.') + '</span></div>' +
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
setInterval(() => { if (view === 'lenlop' && current && llSummary.mode === null && lessonEnded(current) && !document.querySelector('.sum-sheet')) render(); }, 20000);

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
  const s = ctx.session, started = s.day < today() || (s.day === today() && minutesNow() >= s.start);
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
    if (owed.length) out.push('<span class="rv-flag debt" title="' + esc(owed.map(x => what(x) + ' · ' + dm(x.day)).join('\n')) + '">🎥 Thiếu ' + owed.length + ' video: ' + esc(kidsKinds(owed)) + ' <i class="rv-en-i">Missing video</i></span>');
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
}

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
  return '<div class="sec-marks">' + btn(SEND_HOME, '🚪 ' + T('Cho về · thiếu bài', 'Sent home'), st === SEND_HOME) + btn(HOME_NO_HW, '🏠 ' + T('Ở nhà · chưa làm bài', 'Stayed home'), st === HOME_NO_HW) +
    // Owner 09/11: "IELTS FIGHTER cũng cần có nút ở ngoài bù bài không được học... cùng với sent home".
    btn(OUT_MAKEUP, '📝 ' + T('Ra ngoài bù bài · không vào học', 'Makes up work outside'), st === OUT_MAKEUP) + '</div>';
}
document.addEventListener('click', e => {
  const b = e.target.closest && e.target.closest('[data-act="secMark"]');
  if (!b || !current) return;
  const ctx = classContext(current), pupil = ctx.tracker && ctx.tracker.pupils[Number(b.dataset.i)];
  if (!pupil || !classCanEdit(ctx.session)) return;
  const m = ctx.marks.get(pupil.name);
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
const SKILLS = [[/writing|viết/i, 'Viết'], [/speaking|nói/i, 'Nói'], [/reading|đọc/i, 'Đọc'], [/listening|nghe/i, 'Nghe'], [/vocab|từ vựng/i, 'Từ vựng'], [/grammar|ngữ pháp/i, 'Ngữ pháp'], [/test|kiểm tra/i, 'Kiểm tra']];
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
    const started = minutesNow() >= s.start;
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
const AUTO_LINE = /^(⚠️|⛔|👍|⏰|✓|🏆|🌟)/u;
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
  tracker.pupils.forEach(p => {
    const m = ctx.marks.get(p.name);
    if (!m || !Q.PRESENT.includes(m.status)) return;
    const b = behave.get(p.name), st = block.stars >= 0 ? starsOf(ctx, p) : 0, rank = st ? scores.indexOf(st) + 1 : 0;
    const auto = lessonComment(tagCounts(b ? b.tags : []), m, { stars: st, rank: rank && rank <= 3 ? rank : 0, seed: p.name + '|' + session.day, short: /^(IELTS|FIGHTER)/.test(Q.key(session.cls)) });
    const now = String(tracker.cell(p.row, block.comment) || ''), mine = now.split('\n').filter(l => l.trim() && !AUTO_LINE.test(l.trim()));
    let value = auto.concat(mine).join('\n');
    if (value.length > 200) value = auto.join('\n').slice(0, 200);
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
    list.style.transform = ''; list.style.marginBottom = '';
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
  const show = s && view === 'lenlop' && !isChot(s) && lessonEnded(s) && canConfirm(s) && !(chotSnooze.key === key && Date.now() < chotSnooze.until) && !document.querySelector('.ll-sheet');
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
 * Mất tập trung · Ngủ gật · Viết không kịp · Viết linh tinh tùy ý. IELTS speaking ("IELTS SPEAKING"): Mất trật tự · Mất tập trung ·
 * Ngủ gật · Làm việc riêng. KIDS keep Mất trật tự · Mất tập trung. Praise and wrong answers never count towards the warning limit. */
const NOT_COUNTED = [PRAISE, 'Trả lời sai'];
const FIGHTER_TICKS = ['Mất trật tự', 'Mất tập trung', 'Trả lời sai', PRAISE];
const IELTS_WRITING_TICKS = ['Mất trật tự', 'Mất tập trung', 'Ngủ gật', 'Viết không kịp', 'Viết linh tinh tùy ý'];
const IELTS_SPEAKING_TICKS = ['Mất trật tự', 'Mất tập trung', 'Ngủ gật', 'Làm việc riêng'];
function tickSetOf(s) {
  if (!s) return TICKS;
  const c = Q.key(s.cls), b = Q.key(s.book || '');
  if (/^FIGHTER/.test(c)) return FIGHTER_TICKS;
  if (/^IELTS/.test(c)) return /SPEAKING|NOI\b/.test(b) ? IELTS_SPEAKING_TICKS : IELTS_WRITING_TICKS;
  return isSecondary(s) ? TEEN_TICKS : TICKS;
}
Object.assign(BEHAVIOUR_EN, { 'Trả lời sai': 'Wrong answer', 'Ngủ gật': 'Dozing off', 'Viết không kịp': 'Writing too slowly', 'Viết linh tinh tùy ý': 'Off-task writing', 'Làm việc riêng': 'Off-task' });
[...FIGHTER_TICKS, ...IELTS_WRITING_TICKS, ...IELTS_SPEAKING_TICKS].forEach(t => { if (!BEHAVIOURS.includes(t)) BEHAVIOURS.push(t); });
Object.assign(COMMENT_LINES, {
  'Trả lời sai': 'con còn trả lời sai, cần ôn lại bài.',
  'Ngủ gật': 'con ngủ gật trong giờ học, cần nghỉ ngơi đủ trước buổi học.',
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
const stripOn = () => view === 'lenlop' && window.innerWidth < 900 && !!current;
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
fitClassScreen = function () {
  if (!document.body.classList.contains('rv-strip')) return fitBeforeStrip();
  const list = document.querySelector('.rv-list');
  if (!list) return;
  const open = list.querySelector('.rv-row.open');
  if (open) open.classList.remove('open');
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
  // One column unless two (or three) make the names clearly bigger.
  let s = best(1), cols = 1;
  for (let c = 2; c <= 3 && s < 0.8; c++) { const sc = best(c); if (sc > s * 1.12) { s = sc; cols = c; } }
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
const TICK_ICON = { 'Mất trật tự': '🔊', 'Mất tập trung': '👀', 'Ngủ gật': '😴', 'Viết không kịp': '⏳', 'Viết linh tinh tùy ý': '✏️', 'Làm việc riêng': '📱', 'Trả lời sai': '❌', 'Phát biểu tốt': '👍', 'Dùng điện thoại': '📵' };
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
  return list.length ? base + '<div class="owed" title="' + esc(list.join('\n')) + '">🎥 ' + T('Thiếu ', 'Missing ') + list.length + ' video: ' + esc(kidsKinds(all[i] || [])) + '</div>' : base;
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
    outbox.filter(x => x.kind === 'cell' && x.blind).forEach(x => { (byFile[x.file] = byFile[x.file] || []).push({ range: x.range, values: [[x.value]] }); });
    Object.entries(byFile).forEach(([file, data]) => fetch(CONFIG.server, { method: 'POST', keepalive: true, headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify({ k: accessKey, op: 'set', file, data: data.slice(0, 150) }) }).catch(() => {}));
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
const bookKeyOf = b => Q.key(b).replace(/^SACH\s*:?\s*/, '').replace(/\bOXFORD\s+/, '').replace(/\s+/g, ' ').trim();
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
        : '<span class="small muted">' + T('chưa có link', 'no app user') + '</span>') + '</div>';
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
function ktSheetHtml(ctx, k) {
  const rows = ctx.tracker.pupils.map((p, i) => ({ p, i, m: ctx.marks.get(p.name) })).filter(r => !(r.m && (r.m.status === NGHI || Q.ABSENT.includes(r.m.status))));
  return '<div class="ll-veil" data-act="ktClose"></div><div class="ll-sheet kt-sheet" role="dialog" aria-label="' + T('Nhập điểm kiểm tra', 'Test scores') + '">' +
    '<div class="row-top"><b class="ll-sheet-name">📝 ' + T('Điểm kiểm tra · Unit ', 'Test scores · Unit ') + esc(k.unit) + '</b><span class="spacer"></span><button class="primary" data-act="ktClose">' + T('Xong', 'Done') + '</button></div>' +
    (k.total ? '<div class="small muted">' + T('Gõ số câu đúng trên tổng ', 'Correct answers out of ') + k.total + T(' câu. Bỏ trống nếu chưa chấm.', '. Leave empty if not marked.') + '</div>'
      : '<label class="kt-total">' + T('Tổng số câu của bài này: ', 'Total questions: ') + '<input type="number" inputmode="numeric" min="1" max="500" data-act="ktTotal" aria-label="' + T('Tổng số câu', 'Total questions') + '"></label>') +
    '<div class="kt-list">' + rows.map(r => { const v = ktScore(ctx, k, r.p); return '<label class="kt-row"><b>' + esc(r.p.eng || r.p.name) + '</b><input type="number" inputmode="numeric" min="0"' + (k.total ? ' max="' + k.total + '"' : '') + ' data-act="ktScore" data-i="' + r.i + '" value="' + (v == null ? '' : v) + '" aria-label="' + T('Số câu đúng của ', 'Correct answers of ') + esc(r.p.eng || r.p.name) + '"><span>/' + (k.total || '?') + '</span>' + ktPctTag(ktPctOf(k, v)) + '</label>'; }).join('') + '</div></div>';
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
  return [...last.values()].filter(m => (m.status === SEND_HOME || m.status === OUT_MAKEUP) && mine(m.cls)).map(m => {
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
  let h = '<div class="part p-alert"><h2>' + T('Cho về / ra ngoài bù bài · cần nhắn phụ huynh', 'Sent home or making up outside · message the parents') + '</h2><span>' + (todo ? todo + T(' chưa nhắn', ' to message') : T('Đã nhắn đủ', 'All messaged')) + '</span></div>';
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
  const legend = current && isSecondary(current) ? '<div class="roll-legend">' + [['🚪', T('Cho về · thiếu bài', 'Sent home')], ['🏠', T('Ở nhà · chưa làm bài', 'Stayed home')], ['📝', T('Ra ngoài bù bài · không vào học', 'Making up work outside')]].map(([i, t]) => '<span><b>' + i + '</b> ' + t + '</span>').join('') + '</div>' : '';
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
  const fits = () => list.getBoundingClientRect().bottom <= innerHeight - 8 && wide();
  const key = innerWidth + 'x' + innerHeight + '|' + n + '|' + Math.round(list.getBoundingClientRect().top + scrollY);
  const apply = b => { set(b.c, b.narrow); list.style.zoom = b.z < 0.999 ? b.z : ''; };
  if (fitRollLast.key === key && fitRollLast.best) { apply(fitRollLast.best); if (fits()) return; }
  const top = list.getBoundingClientRect().top, room = innerHeight - 8 - top, tries = [];
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
  if (!stripOn()) return;
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
