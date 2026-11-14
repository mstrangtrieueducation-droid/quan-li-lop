/* ---------- Nền tảng IELTS trong Điều hành (owner 12/11/2026: "nối luôn ở app quản trị của tôi") ----------
 * One tile and one window, owner only, like Nhân sự & lương. Data lives in the Nền tảng IELTS server (its own Apps Script),
 * not in this app's server: this file only reads and calls it with the owner's management code, kept on this device. */
const NT_API = 'https://script.google.com/macros/s/AKfycbzbIthv3oCEXfF93pXF6k4xzhU-9r7uQvrJyRBRIum6vV2iUXQsh7PYILyzt7Y0PaztIg/exec';
const NT_STUDENT = 'https://mstrangtrieueducation-droid.github.io/vocabulary-reading-web/dcaa7ee41f2f36d022bf75a486019b75/';
const NT_TITLES = ['Fun & Games', 'Learning & Doing', 'Coming & Going', 'Friends & Relations', 'Buying & Selling', 'Inventions & Discoveries', 'Sending & Receiving', 'People & Daily Life', 'Working & Earning', 'Body & Lifestyle', 'Creating & Building', 'Nature & the Universe', 'Laughing & Crying', 'Problems & Solutions'];
const nt = { key: '', rows: null, err: '', q: '', f: '', open: '', detail: null, made: null, busy: false };
try { nt.key = localStorage.getItem('nt-admin-key') || ''; } catch (e) {}
const ntLink = c => NT_STUDENT + '?hs=' + c;
const ntClean = s => { ['progress', 'done'].forEach(k => { if (s[k] != null) s[k] = String(s[k]).replace(/^'/, ''); }); if (typeof s.progress === 'number') s.progress = Math.round(s.progress * 100) + '%'; return s; };
const ntDate = t => { if (!t) return '—'; const d = new Date(t); return d.getDate() + '/' + (d.getMonth() + 1) + '/' + d.getFullYear(); };
const ntTime = t => { if (!t) return '—'; const d = new Date(t); return ntDate(t) + ' ' + String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0'); };
function ntPace(s) {
  if (!s.start) return null;
  const a = new Date(s.start); a.setHours(0, 0, 0, 0); const b = new Date(); b.setHours(0, 0, 0, 0);
  const d = Math.floor((b - a) / 864e5) + 1, target = Math.min(14, Math.ceil(d * 14 / 28)), done = parseInt(s.done) || 0;
  return { d, target, done, behind: Math.max(0, target - 1 - done) };
}
const ntActive = s => s.start && s.status !== 'Hoàn thành' && s.status !== 'Hết hạn';
const ntLate = s => ntActive(s) && ntPace(s).d >= 1 && ntPace(s).behind > 0;
function ntChip(s) {
  if (s.status === 'Hoàn thành') return '<span class="tag ok">Hoàn thành</span>';
  if (s.status === 'Hết hạn') return '<span class="tag bad">Hết hạn</span>';
  if (!s.start) return '<span class="tag">Chưa bắt đầu</span>';
  if (new Date(s.start) > Date.now()) return '<span class="tag">Bắt đầu ' + ntDate(s.start) + '</span>';
  const p = ntPace(s); return p.behind ? '<span class="tag warn">Chậm ' + p.behind + ' bài</span>' : '<span class="tag ok">Đúng tiến độ</span>';
}
function ntLeft(s) { if (!s.deadline) return '30 ngày (chưa mở link)'; const n = Math.ceil((new Date(s.deadline) - Date.now()) / 864e5); return n >= 0 ? 'còn ' + n + ' ngày' : 'quá ' + (-n) + ' ngày'; }
function ntMsg(s) { return 'Chào ' + s.name + '! Đây là link học chương trình Nền tảng IELTS (Vocab B1 + Ngữ pháp) của em: ' + ntLink(s.code) + ' . Em có 30 ngày kể từ lúc mở link lần đầu để hoàn thành 14 bài và bài kiểm tra cuối khoá. Nên mở bằng Chrome, đeo tai nghe có micro để luyện phát âm. — Cô Trang'; }

async function ntGet(params) {
  const r = await fetch(NT_API + '?' + new URLSearchParams(Object.assign({ key: nt.key }, params)));
  const j = await r.json(); if (!j.ok) throw new Error(j.error === 'key' ? 'key' : j.error || 'Lỗi máy chủ'); return j;
}
async function ntPost(body) {
  const r = await fetch(NT_API, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify(Object.assign({ key: nt.key }, body)) });
  const j = await r.json(); if (!j.ok) throw new Error(j.error === 'key' ? 'key' : j.error || 'Lỗi máy chủ'); return j;
}
function ntFail(err) {
  if (err.message === 'key') { nt.key = ''; try { localStorage.removeItem('nt-admin-key'); } catch (e) {} nt.err = 'Mã quản trị không đúng.'; }
  else nt.err = 'Chưa kết nối được máy chủ Nền tảng IELTS. Cô thử lại.';
  nt.busy = false; render();
}
async function loadNt() {
  if (!nt.key) return;
  try { const j = await ntGet({ action: 'admin' }); nt.rows = j.students.map(ntClean); nt.err = ''; }
  catch (err) { ntFail(err); }
}

// Giao diện điện thoại: không tràn ngang, bảng học sinh thành thẻ
(function ntStyle() {
  if (document.getElementById('nt-style')) return;
  const st = document.createElement('style'); st.id = 'nt-style';
  st.textContent = `
.ntp{max-width:100%;min-width:0}
.dash-body:has(> .ntp){flex:1 1 auto;min-height:0;overflow-y:auto;-webkit-overflow-scrolling:touch;padding-bottom:calc(24px + env(safe-area-inset-bottom))}
@media (max-width:640px){.dash-modal:has(.ntp){height:100dvh;max-height:100dvh;padding-top:env(safe-area-inset-top)}}
.ntp .ntback{display:inline-flex;align-items:center;gap:6px;padding:8px 14px;border-radius:999px;border:1px solid var(--line);background:var(--card);color:var(--ink);font-weight:700;font-size:15px;cursor:pointer}
.ntp *{box-sizing:border-box}
.ntp .ns-bar input:not([type=search]){flex:1 1 160px;min-width:0;padding:9px 10px;border-radius:9px;border:1px solid var(--line);background:var(--card);color:var(--ink);font-size:15px}
.ntp .ns-bar input[type=search]{max-width:none}
.ntp .ntchu{display:block;text-align:center;padding:12px 14px;border-radius:12px;background:#0d1433;color:#f5c542;font-weight:800;text-decoration:none;white-space:normal;line-height:1.35}
.ntp .ntchu small{display:block;font-weight:600;color:#cfd6f5;font-size:12px}
.ntp .ns-table{overflow-x:auto;-webkit-overflow-scrolling:touch;max-width:100%}
@media (max-width:640px){
  .ntp .ns-list table,.ntp .ns-list tbody,.ntp .ns-list tr,.ntp .ns-list td{display:block;width:100%}
  .ntp .ns-list thead{display:none}
  .ntp .ns-list tr{border:1px solid var(--line);border-radius:12px;padding:8px 12px;margin:8px 0;background:var(--card)}
  .ntp .ns-list td{border:0;padding:3px 0}
  .ntp .ns-list td.num{text-align:left!important}
  .ntp .ns-list td[data-l]:before{content:attr(data-l) ": ";color:var(--muted);font-size:12px}
  .ntp .ns-grid th,.ntp .ns-grid td{padding:6px 7px;font-size:13px}
}`;
  document.head.appendChild(st);
})();
function ntPanel() { return '<div class="ntp">' + ntPanelIn() + '</div>'; }
function ntPanelIn() {
  if (!nt.key) return '<p>Nhập mã quản trị Nền tảng IELTS một lần, máy này sẽ nhớ.</p>' + (nt.err ? '<p class="bad">' + esc(nt.err) + '</p>' : '') +
    '<div class="ns-bar"><input id="nt-key" type="password" autocomplete="off" placeholder="Mã quản trị"><button data-act="ntKey">Vào</button></div>';
  if (nt.open) return ntDetail();
  const rows = nt.rows;
  let h = (nt.err ? '<p class="bad">' + esc(nt.err) + '</p>' : '');
  h += '<div class="ns-sec"><a class="ntchu" href="' + NT_STUDENT + '?hs=chu" target="_blank" rel="noopener">👁 Xem toàn bộ bài (bản chủ)<small>Mở hết 14 bài + bài thi để cô xem, thử</small></a></div>';
  h += '<div class="ns-sec"><b>Thêm học sinh mới</b><div class="ns-bar"><input id="nt-name" placeholder="Họ và tên"><input id="nt-cls" placeholder="Lớp"><input id="nt-note" placeholder="Ghi chú"><button data-act="ntNew"' + (nt.busy ? ' disabled' : '') + '>' + (nt.busy ? 'Đang tạo…' : 'Tạo link') + '</button></div><p class="muted small">30 ngày tính từ lúc học sinh mở link lần đầu.</p>';
  if (nt.made) h += '<div class="card row" style="background:var(--ok-soft)"><div><b>Đã tạo link cho ' + esc(nt.made.name) + ':</b><br><span class="small" style="word-break:break-all">' + esc(ntLink(nt.made.code)) + '</span></div><div class="ns-bar"><button data-act="ntCopy" data-c="' + esc(nt.made.code) + '">Copy link</button><button class="quiet" data-act="ntCopyMsg" data-c="' + esc(nt.made.code) + '">Copy tin nhắn gửi học sinh</button></div></div>';
  h += '</div>';
  if (!rows) return h + '<p class="muted">Đang đọc danh sách…</p>';
  const n = fn => rows.filter(fn).length;
  h += '<div class="ns-kinds">' + [['', 'Tất cả', rows.length], ['new', 'Chưa bắt đầu', n(s => !s.start)], ['run', 'Đang học', n(ntActive)], ['late', 'Đang chậm', n(ntLate)], ['done', 'Hoàn thành', n(s => s.status === 'Hoàn thành')], ['exp', 'Hết hạn', n(s => s.status === 'Hết hạn')]]
    .map(([k, t, c]) => '<button class="chip' + (nt.f === k ? ' on' : '') + '" data-act="ntFilter" data-v="' + k + '">' + t + ' · ' + c + '</button>').join('') + '<span class="spacer"></span><button class="quiet" data-act="ntReload">↻ Tải lại</button></div>';
  h += '<div class="ns-bar"><input type="search" id="nt-q" placeholder="Tìm tên, lớp…" value="' + esc(nt.q) + '"></div>';
  const q = nt.q.toLowerCase();
  const list = rows.filter(s => {
    if (q && !(s.name + ' ' + (s.cls || '') + ' ' + (s.note || '')).toLowerCase().includes(q)) return false;
    return nt.f === 'new' ? !s.start : nt.f === 'run' ? ntActive(s) : nt.f === 'late' ? ntLate(s) : nt.f === 'done' ? s.status === 'Hoàn thành' : nt.f === 'exp' ? s.status === 'Hết hạn' : true;
  }).sort((a, b) => new Date(b.last || b.created || 0) - new Date(a.last || a.created || 0));
  h += '<div class="ns-table ns-list"><table><thead><tr><th>Học sinh</th><th>Trạng thái</th><th>Tiến độ</th><th>Ngày học</th><th class="num">Từ vựng / NP / Phát âm</th><th></th></tr></thead><tbody>' +
    (list.length ? list.map(s => {
      const p = ntPace(s), pct = parseInt(s.progress) || 0, sc = v => v === null || v === '' || v == null ? '—' : v + '%';
      return '<tr data-act="ntOpen" data-c="' + esc(s.code) + '"><td><b>' + esc(s.name) + '</b><br><span class="muted small">' + esc(s.cls || '') + (s.note ? ' · ' + esc(s.note) : '') + '</span></td><td>' + ntChip(s) + '</td><td data-l="Tiến độ">' + (parseInt(s.done) || 0) + '/14 bài · ' + pct + '%</td><td data-l="Ngày học">' + (p ? (p.d < 1 ? 'Bắt đầu ' + ntDate(s.start) : 'Ngày ' + Math.min(p.d, 30) + '/30 <span class="muted small">' + ntLeft(s) + '</span>') : '—') + '</td><td class="num" data-l="Từ vựng / NP / Phát âm">' + sc(s.vocab) + ' / ' + sc(s.grammar) + ' / ' + sc(s.speak) + '</td><td><button class="quiet" data-act="ntCopy" data-c="' + esc(s.code) + '">Copy link</button></td></tr>';
    }).join('') : '<tr><td colspan="6" class="muted">Chưa có học sinh nào' + (q || nt.f ? ' phù hợp' : '') + '.</td></tr>') + '</tbody></table></div>';
  return h;
}

function ntDetail() {
  const d = nt.detail;
  let h = '<div class="ns-bar"><button class="quiet" data-act="ntBack">← Danh sách</button></div>';
  if (!d) return h + '<p class="muted">Đang đọc chi tiết…</p>';
  const s = d.student, st = d.state || { units: {} }, p = ntPace(s);
  const cell = (v, pass) => v == null ? '<span class="muted">—</span>' : v === true ? '<b style="color:var(--ok)">✓</b>' : '<b style="color:' + (pass && v < 80 ? 'var(--bad)' : 'var(--ok)') + '">' + v + '%</b>';
  h += '<h3 style="margin:4px 0">' + esc(s.name) + '</h3><p class="muted small">' + esc(s.cls || '') + ' ' + ntChip(s) + '</p>' +
    '<p>Tạo ' + ntDate(s.created) + ' · Bắt đầu ' + ntDate(s.start) + ' · Hạn chót <b>' + ntDate(s.deadline) + '</b> (' + ntLeft(s) + ')' + (p && p.d >= 1 ? ' · Ngày ' + Math.min(p.d, 30) + '/30, cần xong đến Bài ' + p.target : '') + '</p>' +
    '<p>Tiến độ <b>' + esc(s.progress || '0%') + '</b> · ' + (parseInt(s.done) || 0) + '/14 bài · Đang học: ' + esc(s.current || '—') + ' · Kiểm tra cuối: ' + (s.final != null && s.final !== '' ? s.final + '%' : '—') + '</p>' +
    (s.weak ? '<p class="card" style="background:var(--bad-soft)"><b>Từ hay sai:</b> ' + esc(s.weak) + '</p>' : '') +
    '<div class="ns-bar"><button data-act="ntCopy" data-c="' + esc(s.code) + '">Copy link</button><button class="quiet" data-act="ntCopyMsg" data-c="' + esc(s.code) + '">Copy tin nhắn</button><button class="quiet" data-act="ntExt" data-d="3">Gia hạn +3 ngày</button><button class="quiet" data-act="ntExt" data-d="7">Gia hạn +7 ngày</button><button class="quiet" data-act="ntEdit">Sửa tên / lớp / ghi chú</button><button class="quiet" data-act="ntReset">Đặt lại từ đầu…</button><button class="quiet" data-act="ntDel" style="color:var(--bad)">Xoá học sinh</button></div>';
  let g = '';
  for (let i = 1; i <= 14; i++) {
    const u = (st.units || {})[i] || {};
    g += '<tr><td>' + i + '. ' + esc(NT_TITLES[i - 1]) + '</td><td>' + cell(u.learn ? true : null) + '</td><td>' + (u.speak ? (u.speak.score == null ? '<span class="muted small">' + (u.speak.video ? 'đã nộp video' : 'không chấm') + '</span>' : cell(u.speak.score)) : cell(null)) + '</td><td>' + cell(u.quiz ? u.quiz.best : null, true) + (u.quiz ? ' <span class="muted small">(' + u.quiz.tries + ' lần)</span>' : '') + '</td><td>' + cell(u.gread ? true : null) + '</td><td>' + cell(u.gex ? u.gex.best : null, true) + (u.gex ? ' <span class="muted small">(' + u.gex.tries + ' lần)</span>' : '') + '</td></tr>';
  }
  h += '<div class="ns-table ns-grid"><table><thead><tr><th>Bài</th><th>Học từ</th><th>Phát âm</th><th>Luyện từ</th><th>Ngữ pháp</th><th>BT ngữ pháp</th></tr></thead><tbody>' + g + '</tbody></table></div>';
  const vids = (d.videos || []).slice().reverse();
  h += '<h4>Video phát âm (máy chấm)</h4>' + (vids.length ? vids.map(v => {
    const f = v.fb || {}, bad = (f.words || []).map(w => esc(w.w) + (w.issue ? ' <span class="muted">(' + esc(w.issue) + ')</span>' : '')).join('; '),
      sb = (f.sentences || []).filter(x => !x.ok).map(x => 'Câu ' + esc(x.i) + (x.issue ? ' <span class="muted">(' + esc(x.issue) + ')</span>' : '')).join('; ');
    return '<div class="small" style="padding:6px 0;border-bottom:1px dashed var(--line)"><b>Bài ' + esc(v.unit) + '</b> · nộp ' + ntTime(v.at) + ' · ' +
      (v.score != null && v.status === 'Đã chấm' ? '<b style="color:' + (v.score >= 80 ? 'var(--ok)' : 'var(--bad)') + '">' + v.score + ' điểm</b>' : esc(v.status || '')) +
      (v.file ? ' · <a href="https://drive.google.com/file/d/' + encodeURIComponent(v.file) + '/view" target="_blank" rel="noopener">Xem video</a>' : '') +
      (f.summary ? '<br>' + esc(f.summary) : '') + (bad ? '<br><b>Từ sai:</b> ' + bad : '') + (sb ? '<br><b>Câu:</b> ' + sb : '') +
      ((f.missing || []).length ? '<br><b>Chưa đọc:</b> ' + esc(f.missing.join(', ')) : '') + '</div>';
  }).join('') : '<p class="muted small">Chưa nộp video nào.</p>');
  h += '<h4>Nhật ký học</h4><div style="max-height:320px;overflow:auto">' + (d.log.length ? d.log.map(l => '<div class="small" style="padding:5px 0;border-bottom:1px dashed var(--line)"><b>' + ntTime(l.at) + '</b> · ' + esc([l.unit, l.part].filter(Boolean).join(' · ')) + (l.score !== '' && l.score != null ? ' · <b>' + esc(l.score) + '</b>' : '') + (l.detail ? '<br><span class="muted">' + esc(l.detail) + '</span>' : '') + '</div>').join('') : '<p class="muted">Chưa có hoạt động.</p>') + '</div>';
  return h;
}
async function ntOpen(code) {
  nt.open = code; nt.detail = null; render();
  try { const j = await ntGet({ action: 'detail', code }); j.student = ntClean(j.student); if (nt.open === code) { nt.detail = j; render(); } }
  catch (err) { nt.open = ''; ntFail(err); }
}
function ntCopyText(text, msg) { (navigator.clipboard ? navigator.clipboard.writeText(text) : Promise.reject()).then(() => say(msg)).catch(() => prompt('Sao chép:', text)); }
function ntFind(code) { return (nt.rows || []).find(x => x.code === code) || (nt.made && nt.made.code === code ? nt.made : null) || (nt.detail && nt.detail.student.code === code ? nt.detail.student : null); }
function ntPut(s) { ntClean(s); if (!nt.rows) return; const i = nt.rows.findIndex(x => x.code === s.code); if (i >= 0) nt.rows[i] = Object.assign(nt.rows[i], s); else nt.rows.push(s); }

document.addEventListener('click', e => {
  const b = e.target.closest && e.target.closest('[data-act]');
  if (!b || !/^nt[A-Z]/.test(b.dataset.act)) return;
  const act = b.dataset.act; e.stopImmediatePropagation();
  if (act === 'ntKey') { const v = (document.getElementById('nt-key') || {}).value || ''; if (!v.trim()) return; nt.key = v.trim(); nt.err = ''; try { localStorage.setItem('nt-admin-key', nt.key); } catch (x) {} nt.rows = null; render(); loadNt().then(render); }
  else if (act === 'ntReload') { nt.rows = null; render(); loadNt().then(render); }
  else if (act === 'ntFilter') { nt.f = b.dataset.v; render(); }
  else if (act === 'ntOpen') { if (e.target.closest('[data-act="ntCopy"]')) return; ntOpen(b.dataset.c); }
  else if (act === 'ntBack') { nt.open = ''; nt.detail = null; render(); }
  else if (act === 'ntCopy') { ntCopyText(ntLink(b.dataset.c), 'Đã sao chép link.'); }
  else if (act === 'ntCopyMsg') { const s = ntFind(b.dataset.c); if (s) ntCopyText(ntMsg(s), 'Đã sao chép tin nhắn, dán vào Zalo.'); }
  else if (act === 'ntNew') {
    const name = ((document.getElementById('nt-name') || {}).value || '').trim(); if (!name) { say('Cô nhập họ tên học sinh.', 'bad'); return; }
    const cls = (document.getElementById('nt-cls') || {}).value || '', note = (document.getElementById('nt-note') || {}).value || '';
    nt.busy = true; render();
    ntPost({ action: 'create', name, cls, note }).then(j => { nt.busy = false; nt.made = ntClean(j.student); ntPut(nt.made); render(); say('Đã tạo link cho ' + name + '.'); }).catch(ntFail);
  }
  else if (act === 'ntExt') {
    const code = nt.open, days = Number(b.dataset.d); b.disabled = true;
    ntPost({ action: 'extend', code, days }).then(j => { ntPut(j.student); say('Đã gia hạn đến ' + ntDate(j.student.deadline) + '.'); ntOpen(code); }).catch(ntFail);
  }
  else if (act === 'ntEdit') {
    const s = nt.detail && nt.detail.student; if (!s) return;
    const name = prompt('Họ và tên:', s.name); if (name === null) return;
    const cls = prompt('Lớp:', s.cls || ''); if (cls === null) return;
    const note = prompt('Ghi chú:', s.note || ''); if (note === null) return;
    ntPost({ action: 'edit', code: s.code, name, cls, note }).then(j => { ntPut(j.student); say('Đã lưu.'); ntOpen(s.code); }).catch(ntFail);
  }
  else if (act === 'ntReset') {
    const s = nt.detail && nt.detail.student; if (!s) return;
    const d = new Date(); d.setDate(d.getDate() + ((8 - d.getDay()) % 7 || 7));   // mặc định: thứ Hai tới
    const def = d.getDate() + '/' + (d.getMonth() + 1) + '/' + d.getFullYear();
    const v = prompt('Đặt lại ' + s.name + ': xoá toàn bộ điểm và tiến độ, học lại từ đầu.\nNgày bắt đầu mới (ngày/tháng/năm), hạn 30 ngày tính từ ngày này:', def);
    const m = v && v.trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/); if (!m) { if (v) say('Ngày chưa đúng dạng ngày/tháng/năm.'); return; }
    ntPost({ action: 'reset', code: s.code, start: m[3] + '-' + m[2].padStart(2, '0') + '-' + m[1].padStart(2, '0') }).then(j => { ntPut(j.student); say('Đã đặt lại ' + s.name + ', bắt đầu ' + v.trim() + '.'); ntOpen(s.code); }).catch(ntFail);
  }
  else if (act === 'ntDel') {
    const s = nt.detail && nt.detail.student; if (!s) return;
    if (!confirm('Xoá hẳn ' + s.name + ' cùng toàn bộ tiến độ? Link của em sẽ không dùng được nữa. Không hoàn tác được.')) return;
    ntPost({ action: 'delete', code: s.code }).then(() => { nt.rows = (nt.rows || []).filter(x => x.code !== s.code); nt.open = ''; nt.detail = null; render(); say('Đã xoá ' + s.name + '.'); }).catch(ntFail);
  }
}, true);
document.addEventListener('input', e => { if (e.target && e.target.id === 'nt-q') { nt.q = e.target.value; const pos = e.target.selectionStart; render(); const el = document.getElementById('nt-q'); if (el) { el.focus(); try { el.setSelectionRange(pos, pos); } catch (x) {} } } });
document.addEventListener('keydown', e => { if (e.key === 'Enter' && e.target && e.target.id === 'nt-key') { const b = document.querySelector('[data-act="ntKey"]'); if (b) b.click(); } });

// Điều hành: the tile, owner only.
const dashTilesBeforeNt = dashTiles;
dashTiles = function (week) {
  const h = dashTilesBeforeNt(week);
  if (!isOwner()) return h;
  const rows = nt.rows || [], late = rows.filter(ntLate).length, run = rows.filter(ntActive).length, exp = rows.filter(s => s.status === 'Hết hạn').length;
  const tile = '<button class="dash-tile ' + (late || exp ? 'warn' : 'plain') + '" data-act="panel" data-v="nt"><span class="dash-ico">📚</span><span class="dash-num">' + (nt.rows ? rows.length : '') + '</span><span class="dash-name">Nền tảng IELTS</span><span class="dash-sub">' +
    (!nt.key ? 'tạo link, theo dõi Vocab B1 + ngữ pháp' : late ? late + ' em đang chậm tiến độ' : run ? run + ' em đang học' : 'tạo link cho học sinh mới') + '</span></button>';
  return h.replace(/<\/div>$/, tile + '</div>');
};
const viewManagerBeforeNt = viewManager;
viewManager = function (week) {
  if (panel !== 'nt' || !isOwner()) return viewManagerBeforeNt(week);
  panel = 'tong';
  let base;
  try { base = viewManagerBeforeNt(week); } finally { panel = 'nt'; }
  return base + '<div class="dash-veil" data-act="panel" data-v="tong"></div><div class="dash-modal" role="dialog" aria-label="Nền tảng IELTS"><div class="dash-head"><b>📚 Nền tảng IELTS</b><span class="spacer"></span><button class="quiet" data-act="panel" data-v="tong" aria-label="Đóng">✕</button></div><div class="dash-body">' + ntPanel() + '</div></div>';
};
const loadPanelBeforeNt = loadPanel;
loadPanel = async function () {
  if (panel === 'nt') { if (isOwner()) await loadNt(); return; }
  await loadPanelBeforeNt();
  if (isOwner() && nt.key && !nt.rows) loadNt().then(render).catch(() => {});
};
