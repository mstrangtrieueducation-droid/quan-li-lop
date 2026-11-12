/* Nhân sự · Lương · Hợp đồng (tách khỏi extra.js ngày 12/11/2026, owner: "tách logic nhân sự lương ra đây để sửa cho tiện").
 * Mọi thứ về hồ sơ nhân viên, bảng lương tháng, phiếu lương, xác nhận lương và hợp đồng lao động nằm ở file này.
 * File nạp ngay sau extra.js (xem index.html). Các khối giữ nguyên thứ tự cũ; chỉ khác là chúng chạy sau phần còn lại của extra.js,
 * điều đã kiểm tra là không đổi gì: không đoạn nào khác trong extra.js đọc hay bọc lại các hàm ở đây lúc nạp.
 * Quy tắc tính lương, bảo hiểm, thuế, thử việc, hợp đồng: các hằng số ở đầu mỗi khối (NS_BH_FLOOR, NS_TAX, NS_K10_FROM,
 * CONTRACT_TYPES, NS_TERMS, CA_KINDS…). Máy chủ (Apps Script) lo phần đọc/ghi file BẢNG LƯƠNG THÁNG: luong, luongall, luonglap,
 * luongchot, luongo, luongxn. */

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

/* ---------- Wiring (moved from extra.js's shared listeners) ---------- */
document.addEventListener('click', e => {
  const b = e.target.closest('[data-act]');
  if (!b || b.tagName === 'SELECT' || b.tagName === 'INPUT' || b.tagName === 'TEXTAREA') return;
  const act = b.dataset.act;
  if (act === 'payOpen') { pay.person = b.dataset.p; pay.mine = null; render(); payOpenOne(); }
  if (act === 'payBack') { pay.person = ''; pay.mine = null; render(); }
  if (act === 'payOk') payAct('Đúng');
  if (act === 'payWrong') payAct('Báo sai');
  if (act === 'payPaid') payAct(b.dataset.v, b.dataset.p);
  if (act === 'hdSave') hdSave();
  if (act === 'view' && b.dataset.v === 'luong') loadLuong(true);
  if (act === 'view' && b.dataset.v === 'hopdong') loadHd().then(render).catch(err => say(err.message, 'bad'));
});
document.addEventListener('input', e => {
  const b = e.target.closest('[data-act]');
  if (!b) return;
  if (b.dataset.act === 'hdField') { drafts.hd = drafts.hd || {}; drafts.hd[b.dataset.k] = b.value; }
});
document.addEventListener('change', e => {
  const b = e.target.closest('[data-act]');
  if (!b) return;
  if (b.dataset.act === 'hdField') { drafts.hd = drafts.hd || {}; drafts.hd[b.dataset.k] = b.value; }
  if (b.dataset.act === 'payPick' && b.value) { pay.month = b.value; pay.person = ''; loadLuong(true); }
});

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

