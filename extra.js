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
function myDue(week, d) {
  let due = null;
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
  else if (vin) h += '<div class="small muted">' + T('Về nhớ bấm Ra ca để tính giờ làm.', 'Press Check out when you leave so your hours count.') + '</div>';
  if (!vin) h += '<button class="primary big" data-act="caIn"' + (ca.busy ? ' disabled' : '') + '>' + (ca.busy ? T('Đang lấy vị trí…', 'Getting location…') : T('📍 Vào ca', '📍 Check in')) + '</button>';
  else if (!vout) h += '<button class="big" data-act="caOut"' + (ca.busy ? ' disabled' : '') + '>' + (ca.busy ? T('Đang lấy vị trí…', 'Getting location…') : T('Ra ca', 'Check out')) + '</button>';
  if (!ca.centres) h += '<div class="small muted">' + T('Cô Trang chưa đặt vị trí trung tâm, tạm thời quản lí chấm công như cũ.', 'The centre location is not set yet.') + '</div>';
  return h + '</div>';
}
const position = () => new Promise((res, rej) => navigator.geolocation ? navigator.geolocation.getCurrentPosition(res, rej, { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 }) : rej(new Error(T('máy không có định vị', 'no location on this device'))));
async function caPress(kind) {
  if (ca.busy) return;
  ca.busy = true; render();
  let pos = null;
  try { pos = await position(); }
  catch (e) {
    if (!window.confirm(T('Không lấy được vị trí (' + (e.message || 'bị chặn') + '). Bạn bật định vị cho trình duyệt rồi bấm lại. Hay vẫn ghi giờ và chờ quản lí duyệt?', 'Could not get your location. Record the time anyway and wait for a manager?'))) { ca.busy = false; render(); return; }
  }
  try {
    const week = weeks[Q.weekTab(tabs, today())], due = myDue(week, today());
    const r = await call('vaoca', { kind, lat: pos ? pos.coords.latitude : '', lng: pos ? pos.coords.longitude : '', acc: pos ? Math.round(pos.coords.accuracy) : '', due: due !== null ? Q.clock(due) : '' }, 1);
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
  const m = text.match(/!3d(-?d+.d+)!4d(-?d+.d+)/) || text.match(/(-?d{1,2}.d{4,})s*,s*(-?d{2,3}.d{4,})/);
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
  (week ? week.data.sessions : []).filter(s => s.day === day && !s.off).forEach(s => Q.staffOf(s).forEach(p => { const k = Q.key(p.name); if (!people.has(k) || people.get(k).due > p.due) people.set(k, { name: p.name, due: p.due }); }));
  const duty = dutyOf(week, day);
  if (duty) duty.work.forEach(p => { const k = Q.key(p.name); if (!people.has(k)) people.set(k, { name: p.name, due: null }); });
  ca.all.filter(r => r.day === day).forEach(r => { const k = Q.key(r.person); if (!people.has(k)) people.set(k, { name: r.person, due: null }); });
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
  h += '<div class="list">' + list.map(x => { const hrs = caHours(ca.all, x.p.name, day).total; return '<div class="card row"><div class="row-top"><b>' + esc(x.p.name) + '</b>' + (hrs ? '<span class="tag ok">' + esc(Q.hoursText(hrs, lang)) + '</span>' : x.vin && !x.vout ? '<span class="tag warn">' + T('chưa ra ca', 'not out') + '</span>' : '') + (x.p.due !== null ? '<span class="muted small">' + T('Có mặt trước ', 'Due ') + Q.clock(x.p.due) + '</span>' : '<span class="muted small">' + T('Lịch TA', 'TA rota') + '</span>') + '</div>' +
    (x.vin ? line(x, x.vin, 'Vào ca') + line(x, x.vout, 'Ra ca') : '<div class="small muted">' + T('Chưa vào ca', 'Not checked in') + '</div>') + '</div>'; }).join('') + '</div>';
  const m = day.slice(0, 7), who = [...new Set(ca.all.filter(r => String(r.day).startsWith(m)).map(r => Q.clean(r.person).toUpperCase()))].sort((a, b) => a.localeCompare(b, 'vi'));
  if (who.length) h += '<h2>' + T('Giờ làm theo vào/ra ca ', 'Hours from check-in ') + esc(monthName(m)) + '</h2><div class="card table"><table><thead><tr><th>' + T('Người', 'Person') + '</th><th>' + T('Giờ', 'Hours') + '</th><th>' + T('Ngày', 'Days') + '</th><th>' + T('Cần xem', 'To check') + '</th></tr></thead><tbody>' +
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
    w.data.sessions.filter(s => s.day.startsWith(month) && !s.off && sameName(s.teacher, person) && classOf(s) && !isGroup(s) && s.day >= (classOf(s).since || '') && (s.day < now || (s.day === now && s.start + Q.ROLL_CALL_MINUTES <= minutesNow()))).forEach(s => {
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
  const list = [...names].filter(Boolean).map(n => kpiOf(n, month, kpi.data)).filter(k => k.score != null).sort((a, b) => a.score - b.score || a.person.localeCompare(b.person, 'vi'));
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
const ladder = { rows: null, contacts: null, at: 0, tried: 0, copy: null };
const viToIso = s => { const m = String(s || '').match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/); return m ? m[3] + '-' + m[2].padStart(2, '0') + '-' + m[1].padStart(2, '0') : ''; };
const contactOf = r => ({ at: r[0], cls: Q.clean(r[1]), name: Q.clean(r[2]), level: Number(r[3]) || 0, since: Q.clean(r[4]), action: Q.clean(r[5]), note: r[6] || '', by: r[7] || '' });
async function loadLadder(force) {
  if (!force && ladder.rows && Date.now() - ladder.at < 300000) return;
  const [[rows], [contacts]] = await Promise.all([batchGet(CONFIG.scheduleId, ["'AUTO_KIDS_MUC_PHAT'!A2:M400"]), batchGet(CONFIG.diemDanhId, ['LIEN_HE_PH!A2:H'])]);
  ladder.rows = rows.map(r => ({ checked: Q.clean(r[0]), cls: Q.clean(r[1]), name: Q.clean(r[2]), level: Number(r[3]) || 0, since: Q.clean(r[4]), reason: Q.clean(r[5]), owed: String(r[6] || '').split('\n').map(Q.clean).filter(Boolean) })).filter(x => x.level >= 1 && x.cls && x.name);
  ladder.contacts = contacts.map(contactOf);
  outbox.filter(x => x.kind === 'append' && x.tab === 'LIEN_HE_PH').forEach(x => ladder.contacts.push(contactOf(x.row)));
  ladder.at = Date.now();
}
// Ticks began on 07/11: a level entered earlier may have been handled outside the app, so it is never shown as overdue.
const CONTACT_START = '2026-11-07';
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
  const list = ladder.rows.filter(mine).map(x => { const rule = contactRule(x), done = contactDone(x, rule); return { x, rule, done, late: !done && today() > rule.due && (viToIso(x.since) || today()) >= CONTACT_START, s: todayCls.get(Q.key(x.cls)) }; });
  if (!list.length) return '';
  list.sort((a, b) => (a.done ? 1 : 0) - (b.done ? 1 : 0) || b.late - a.late || (a.s ? 0 : 1) - (b.s ? 0 : 1) || b.x.level - a.x.level || a.x.cls.localeCompare(b.x.cls, 'vi', { numeric: true }));
  const todo = list.filter(l => !l.done).length, late = list.filter(l => l.late).length;
  const mode = filters.lad || 'can', shown = mode === 'can' ? list.filter(l => !l.done) : mode === 'homnay' ? list.filter(l => l.s) : list;
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
      return '<div class="lad lv' + x.level + (late ? ' late' : '') + '"><div class="lad-line"><span class="lvl l' + x.level + '">M' + x.level + '</span><b>' + esc(eng || full) + '</b>' +
        (done ? '<span class="tag ok">✓ ' + esc(rule.action.replace('Đã ', '')) + ' · ' + esc(done.by) + '</span>' : '<span class="tag ' + (late ? 'bad' : 'warn') + '">' + esc(rule.call ? T('Gọi', 'Call') : T('Nhắn', 'Message')) + ' · ' + esc(rule.who) + (rule.call ? ' · ' + esc(viDate(rule.due).slice(0, 5)) : '') + '</span>') +
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
