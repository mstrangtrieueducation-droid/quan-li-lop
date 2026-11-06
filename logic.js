// Pure rules of the class operations app: no page, no network. Run the checks with: node test.js
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.QL = factory();
}(typeof self !== 'undefined' ? self : this, function () {
  const ARRIVE_BEFORE = 10, ROLL_CALL_MINUTES = 15, OPEN_BEFORE = 30, RECENT_DAYS = 14;
  const WEEKDAY = ['Chủ nhật', 'Thứ 2', 'Thứ 3', 'Thứ 4', 'Thứ 5', 'Thứ 6', 'Thứ 7'];

  const clean = v => String(v == null ? '' : v).replace(/\s+/g, ' ').trim();
  const key = v => clean(v).normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/g, 'd').replace(/Đ/g, 'D').toUpperCase();
  const pad = n => String(n).padStart(2, '0');
  const two = pad;

  // Dates travel as yyyy-mm-dd text so a phone's time zone can never shift a lesson by a day.
  const iso = d => d.getFullYear() + '-' + two(d.getMonth() + 1) + '-' + two(d.getDate());
  const fromIso = s => { const [y, m, d] = String(s).split('-').map(Number); return new Date(y, m - 1, d); };
  const addDays = (s, n) => { const d = fromIso(s); d.setDate(d.getDate() + n); return iso(d); };
  const WEEKDAY_EN = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const dayText = (s, lang) => { const d = fromIso(s); return (lang === 'en' ? WEEKDAY_EN : WEEKDAY)[d.getDay()] + ', ' + two(d.getDate()) + '/' + two(d.getMonth() + 1); };
  function dateIn(text, fallbackYear) {
    const m = String(text || '').match(/(\d{1,2})[.\/-](\d{1,2})(?:[.\/-](20\d{2}))?/);
    if (!m) return '';
    const y = Number(m[3] || fallbackYear), mo = Number(m[2]), d = Number(m[1]), real = new Date(y, mo - 1, d);
    if (!y || real.getMonth() !== mo - 1 || real.getDate() !== d) return '';
    return iso(real);
  }

  /* ---------- Column letters ---------- */
  function colName(i) { let s = ''; for (let n = i + 1; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + (n - 1) % 26) + s; return s; }

  /* ---------- Schedule ---------- */
  // "17.45 - 19.15", "18:30 - 20.00", "09.15 - 10.45"
  function parseTime(text) {
    const m = clean(text).match(/(\d{1,2})[.:](\d{2})\s*-\s*(\d{1,2})[.:](\d{2})/);
    return m ? { start: Number(m[1]) * 60 + Number(m[2]), end: Number(m[3]) * 60 + Number(m[4]) } : null;
  }
  const clock = minutes => two(Math.floor(minutes / 60)) + ':' + two(minutes % 60);

  // Tab names look like "02.11.2026 - 08.11.2026".
  function weekTab(titles, day) {
    return (titles || []).find(t => {
      const m = String(t).match(/^\s*(\d{2}\.\d{2}\.\d{4})\s*-\s*(\d{2}\.\d{2}\.\d{4})\s*$/);
      return m && dateIn(m[1]) <= day && day <= dateIn(m[2]);
    }) || '';
  }

  // One week tab, A1:M: tasks above the table, then the table itself. The header row moves between weeks.
  function parseWeek(rows) {
    const out = { sessions: [], tasks: [], returns: [], duty: { days: {}, general: '' }, head: -1 };
    const head = (rows || []).findIndex(r => r && clean(r[3]) === 'CLASS' && clean(r[12]) === 'CLASS STATUS');
    if (head < 0) return out;
    out.head = head;
    const days = rows.findIndex((r, i) => i < head && r && /^Thứ 2/.test(clean(r[0])));
    const flags = {};
    if (days >= 0) (rows[days] || []).forEach((label, c) => { const date = dateIn(label, 0) || dateIn(label, yearOf(rows, head)); if (date) flags[date] = clean((rows[days + 1] || [])[c]); });
    let day = '';
    for (let i = head + 1; i < rows.length; i++) {
      const r = rows[i] || [], found = dateIn(r[0]);
      if (found) day = found;
      const time = parseTime(r[1]), cls = clean(r[3]);
      if (!day || !time || !cls) {
        // A "same session" row adds a second book to the session above it.
        const last = out.sessions[out.sessions.length - 1];
        if (last && /CÙNG BUỔI/i.test(clean(r[11])) && clean(r[7])) last.also.push(clean(r[7]) + ' ' + clean(r[8]));
        continue;
      }
      const status = clean(r[12]), dayOff = /^nghỉ/i.test(flags[day] || '');
      out.sessions.push({ row: i + 1, day, timeText: clean(r[1]), start: time.start, end: time.end, breakAt: clean(r[2]), cls,
        classKey: key(cls), teacher: clean(r[4]), video: clean(r[5]), ta: clean(r[6]), book: clean(r[7]), lesson: clean(r[8]),
        detail: String(r[9] || '').trim(), site: clean(r[10]), note: String(r[11] || '').trim(), off: status === 'Nghỉ học' || dayOff, also: [] });
    }
    out.tasks = parseTasks(rows, head);
    out.returns = parseReturns(rows, head);
    out.duty = parseDuty(rows, head);
    out.penalty = parsePenalty(rows, head);
    return out;
  }
  function yearOf(rows, head) {
    for (let i = head + 1; i < rows.length; i++) { const d = dateIn((rows[i] || [])[0]); if (d) return Number(d.slice(0, 4)); }
    return 0;
  }

  // Important Task panel: DONE, Teacher, Class, Assignment, "lesson\nGrade: due", "ta\nreturn".
  function parseTasks(rows, head) {
    const out = [];
    for (let i = 1; i < Math.max(1, head - 2); i++) {
      const r = rows[i] || [], who = clean(r[1]), what = clean(r[3]);
      if (!who || !what || !/^(TRUE|FALSE)$/i.test(clean(r[0]))) continue;
      const lines = String(r[4] || '').split('\n'), back = String(r[5] || '').split('\n');
      out.push({ row: i + 1, done: /^TRUE$/i.test(clean(r[0])), teacher: who, cls: clean(r[2]), what,
        lessonDay: dateIn(lines[0]), gradeDue: dateIn(lines[1]), ta: clean(back[0]), returnDue: dateIn(back[1]) });
    }
    return out;
  }
  // TA work plan at the top of a week tab: a "LỊCH LÀM VIỆC TA" title, a row of days, then rows
  // "Đi làm: A, B (note)", "Nghỉ: ...", "Khóa cửa: ...", "Ghi chú: ..." and one "Lưu ý chung: ..." line.
  function parseDuty(rows, head) {
    const out = { days: {}, general: '' }, stop = head > 0 ? head : (rows || []).length;
    let top = -1, col0 = -1;
    for (let i = 0; i < Math.min(stop, 10) && top < 0; i++) (rows[i] || []).forEach((v, c) => { if (top < 0 && /^LỊCH LÀM VIỆC TA/i.test(clean(v))) { top = i; col0 = c; } });
    if (top < 0) return out;
    const dayRow = rows[top + 1] || [], cols = [];
    for (let c = col0; c < col0 + 7; c++) { const d = dateIn(String(dayRow[c] || '').replace(/\n/g, ' '), yearOf(rows, head)); if (d) { cols.push([c, d]); out.days[d] = { work: [], off: [], lock: [], note: '' }; } }
    const names = text => String(text || '').split(/[,;\n]/).map(clean).filter(Boolean).map(x => { const m = x.match(/^(.*?)\s*\((.*)\)\s*$/); return m ? { name: clean(m[1]), note: clean(m[2]) } : { name: x, note: '' }; });
    for (let i = top + 2; i < Math.min(stop, top + 10); i++) {
      const r = rows[i] || [], first = clean(r[col0]);
      if (/^Lưu ý chung/i.test(first)) { out.general = clean(first.replace(/^Lưu ý chung\s*:?/i, '')); continue; }
      const kind = /^Đi làm/i.test(first) ? 'work' : /^Nghỉ/i.test(first) ? 'off' : /^Khóa cửa/i.test(first) ? 'lock' : /^Ghi chú/i.test(first) ? 'note' : '';
      if (!kind) break;
      cols.forEach(([c, d]) => {
        const body = String(r[c] || '').replace(/^[^:]*:/, '');
        if (kind === 'note') out.days[d].note = clean(body); else out.days[d][kind] = names(body);
      });
    }
    return out;
  }
  // Penalty ladder of the week: after the "KHI NÀO VÀO DANH SÁCH" guide, a row of days ("Thứ Hai 02.11\n16 HS cần TA bù"),
  // then one or two rows of text per day (KIDS classes, then IELTS). Each class block starts with its name.
  function parsePenalty(rows, head) {
    const out = {}, stop = head > 0 ? head : (rows || []).length;
    let guide = -1, col0 = -1;
    for (let i = 0; i < stop && guide < 0; i++) (rows[i] || []).forEach((v, c) => { if (guide < 0 && /^KHI NÀO VÀO DANH SÁCH/i.test(clean(v))) { guide = i; col0 = c; } });
    if (guide < 0) return out;
    let dayRow = -1;
    for (let i = guide + 1; i < Math.min(stop, guide + 5) && dayRow < 0; i++) if (/^(Thứ|Chủ)/i.test(clean((rows[i] || [])[col0])) && dateIn(String((rows[i] || [])[col0]).replace(/\n/g, ' '), yearOf(rows, head))) dayRow = i;
    if (dayRow < 0) return out;
    for (let c = col0; c < col0 + 7; c++) {
      const label = String((rows[dayRow] || [])[c] || ''), d = dateIn(label.replace(/\n/g, ' '), yearOf(rows, head));
      if (!d) continue;
      const text = [dayRow + 1, dayRow + 2].map(i => String((rows[i] || [])[c] || '').trim()).filter(t => t && t !== ' ').join('\n\n');
      const blocks = [];
      text.split('\n').forEach(line => {
        const t = line.replace(/\s*↗\s*$/, '').trimEnd();
        if (/^(KIDS|IELTS|FIGHTER)\b/i.test(t.trim())) blocks.push({ title: t.trim(), cls: clean(t.split('·')[0]).replace(/\s*\(.*$/, ''), lines: [] });
        else if (t.trim() && blocks.length) blocks[blocks.length - 1].lines.push(t.trim());
      });
      out[d] = { head: clean(label.split('\n').slice(1).join(' ')), blocks };
    }
    return out;
  }
  // TA weekly homework return: a title cell, a row of day headers, then pairs of "Name · Class" over a TRUE/FALSE tick.
  function parseReturns(rows, head) {
    const out = [], stop = head > 0 ? head : (rows || []).length;
    let top = -1, col0 = -1;
    for (let i = 0; i < stop && top < 0; i++) (rows[i] || []).forEach((v, c) => { if (top < 0 && /^TRẢ BTVN/i.test(clean(v))) { top = i; col0 = c; } });
    if (top < 0) return out;
    const dayRow = rows[top + 1] || [], days = {};
    for (let c = col0; c < col0 + 7; c++) { const d = dateIn(String(dayRow[c] || '').replace(/\n/g, ' '), yearOf(rows, head)); if (d) days[c] = d; }
    for (let i = top + 2; i + 1 < stop; i += 2) {
      const labels = rows[i] || [], ticks = rows[i + 1] || [];
      if (!Object.keys(days).some(c => /^(TRUE|FALSE)$/i.test(clean(ticks[c])))) break;
      Object.keys(days).forEach(c => {
        const label = clean(labels[c]), tick = clean(ticks[c]);
        if (!label || !/^(TRUE|FALSE)$/i.test(tick)) return;
        const parts = label.split('·').map(clean);
        out.push({ day: days[c], who: parts[0], cls: parts.slice(1).join(' · '), label, done: /^TRUE$/i.test(tick), row: i + 2, col: Number(c) });
      });
    }
    return out;
  }
  // Which deadline is still ahead for this task. Grading first, then the TA's return.
  function taskState(t, today) {
    if (t.done) return { state: 'xong', text: 'Xong' };
    if (t.gradeDue && t.gradeDue < today) return { state: 'quahan', text: 'Quá hạn chấm' };
    if (t.gradeDue === today) return { state: 'homnay', text: 'Hạn chấm hôm nay' };
    if (t.returnDue && t.returnDue < today) return { state: 'quahan', text: 'Quá hạn trả' };
    return { state: 'sap', text: 'Chưa đến hạn' };
  }

  const nameKey = key;
  const mine = (sessions, name) => { const k = nameKey(name); return sessions.filter(s => [s.teacher, s.ta, s.video].some(p => nameKey(p) === k)); };

  // Everyone expected at one session, each with the time they must be there.
  function staffOf(s) {
    const out = [], seen = {};
    const add = (name, role) => { const k = nameKey(name); if (k && !seen[k]) { seen[k] = 1; out.push({ name, role, due: s.start - ARRIVE_BEFORE }); } };
    add(s.teacher, 'GV'); add(s.ta, 'TA'); add(s.video, 'Quay video');
    return out;
  }
  const sessionKey = s => [s.day, s.classKey, s.lesson, clock(s.start)].join('|');

  /* ---------- Tracker ---------- */
  function trackerBlocks(head, year) {
    const rows = head || [], width = Math.max(0, ...rows.map(r => (r || []).length));
    const at = (r, c) => String((rows[r] || [])[c] || '');
    // Classes differ in which header row holds what, so every label is looked for in all of them.
    const starts = [];
    for (let c = 0; c < width; c++) { const r = rows.findIndex((_, i) => /BUOI HOC NGAY/.test(key(at(i, c)))); if (r >= 0) starts.push({ col: c, r }); }
    const STOP = /CHUOI VIDEO TU LUYEN|KIEM TRA GIAY|KIEM TRA NOI/;
    const stops = (c, r) => [0, r].some(i => !/TIET HOC SO/.test(key(at(i, c))) && STOP.test(key(at(i, c))));
    const blocks = starts.map(({ col, r: dayRow }, n) => {
      const next = starts[n + 1] == null ? width : starts[n + 1].col;
      const b = { col, date: dateIn(at(dayRow, col), year), head: clean(at(dayRow, col)), videos: [], grade: -1, stars: -1, comment: -1 };
      for (let c = col; c < next; c++) {
        if (c > col && stops(c, dayRow)) break;
        const paper = rows.some((_, i) => /SACH GIAY/.test(key(at(i, c))));
        rows.forEach((_, i) => {
          const t = key(at(i, c));
          if (/TIET HOC SO/.test(t)) { const m = t.match(/TIET HOC SO\s*(\d+)\s*:?\s*(.*)/); b.lesson = m ? m[1] : ''; b.topic = clean(at(i, c)).replace(/^.*Tiết học số\s*\d+\s*:?\s*/i, ''); }
          if (/BAI TAP VE NHA DANG VIDEO/.test(t) && !paper) b.videos.push({ col: c, label: clean(at(i + 1, c)).replace(/🔗.*$/u, '').trim() });
          if (/BAI TAP VE NHA.*SACH GIAY/.test(t)) b.grade = c;
          if (t === 'SO SAO') b.stars = c;
          if (t === 'NHAN XET' && b.comment < 0) b.comment = c;
        });
      }
      return b;
    });
    return blocks;
  }

  // Standalone self-study video columns, with their due date when the header states exactly one.
  function practiceColumns(head, year) {
    const rows = head || [], width = Math.max(0, ...rows.map(r => (r || []).length)), out = [];
    for (let c = 0; c < width; c++) {
      if (!/CHUOI VIDEO TU LUYEN/.test(key((rows[0] || [])[c]))) continue;
      const title = rows.map(r => (r || [])[c] || '').join('\n'), text = key(title), dates = [];
      const re = /(?:^|[^A-Z])HAN(?:\s+NOP)?\s*[:：-]?\s*(\d{1,2})([./-])(\d{1,2})(?:\2(20\d{2}))?/g;
      for (let m; (m = re.exec(text));) { const d = dateIn(m[1] + '/' + m[3] + '/' + (m[4] || year)); if (d && !dates.includes(d)) dates.push(d); }
      const named = text.match(/\bVIDEO\s*(\d+)\b/);
      if (dates.length === 1) out.push({ col: c, due: dates[0], label: named ? 'Tự luyện video ' + named[1] : 'Tự luyện' });
    }
    return out;
  }

  // The block of a session: by lesson number first, because a wrong date in a header must not hide the block.
  function findBlock(blocks, session) {
    const byLesson = blocks.filter(b => b.lesson && b.lesson === String(session.lesson));
    const hit = byLesson.find(b => b.date === session.day) || byLesson[0] || blocks.find(b => b.date === session.day);
    if (!hit) return { block: null, problem: 'thieu' };
    if (hit.date !== session.day) return { block: hit, problem: 'ngay' };
    if (hit.lesson !== String(session.lesson)) return { block: hit, problem: 'tiet' };
    return { block: hit, problem: '' };
  }

  // Same reading as the staff lists in the Schedule: a receipt counts, a teacher's real comment counts, a lone mark does not.
  const COMMENT_SPLIT = '— NHẬN XÉT GV —';
  function hasTeacherComment(text) {
    const t = key(text);
    if (!t || /^[X/\-. ]+$/.test(t)) return false;
    return !/GUI LAI|NOP LAI|QUAY LAI/.test(t);
  }
  function videoState(value) {
    const raw = String(value || ''), parts = raw.split(COMMENT_SPLIT), status = parts[0], first = key(status.split('\n')[0]), text = key(status);
    if (/HOC SINH MOI|KHONG TINH BAI|CHUA THAM GIA/.test(key(raw))) return 'none';
    if (/\bCAN NOP LAI\b/.test(key(raw))) return 'wrong';
    if (/DA NOP|NOP MUON/.test(first)) return 'done';
    if (!text || /^[X/\- ]+$/.test(text) || /CHUA GHI NHAN|CHUA NOP/.test(text)) return hasTeacherComment(parts.slice(1).join(' ')) ? 'done' : 'missing';
    return 'done';
  }
  const isAbsentMark = value => clean(String(value || '').split('\n')[0]) === '/';
  function gradeOf(value) {
    const first = clean(String(value || '').split('\n')[0]);
    if (first === '/') return '/';
    const m = first.match(/^(A\+|A|B|F)(?:\s|$|[.:;-])/i);
    return m ? m[1].toUpperCase() : '';
  }
  // "NGUYỄN ĐAN KHÁNH LINH\nNew 25.5.2026" -> the name, and the first day the pupil counts.
  function pupilOf(row, number) {
    const label = String(row[0] || ''), lines = label.split('\n'), m = label.match(/\bNew\s+(\d{1,2}[./-]\d{1,2}[./-]20\d{2})/i);
    return { row: number, name: clean(lines[0]), eng: clean(row[1]), since: m ? dateIn(m[1]) : '' };
  }

  // What each pupil still owes before this session. A column nobody submitted is a lesson without web homework.
  function owedVideos(pupils, blocks, practices, cell, session) {
    const from = addDays(session.day, -RECENT_DAYS), found = pupils.map(() => []);
    const assigned = cols => pupils.length < 3 || pupils.some(p => cols.some(c => videoState(cell(p.row, c)) === 'done'));
    blocks.filter(b => b.date && b.date < session.day && b.date >= from && b.videos.length).forEach(b => {
      const cols = b.videos.map(v => v.col);
      if (!assigned(cols)) return;
      pupils.forEach((p, i) => {
        if (p.since && b.date < p.since) return;
        if (b.grade >= 0 && isAbsentMark(cell(p.row, b.grade))) return;
        b.videos.forEach(v => {
          const st = videoState(cell(p.row, v.col));
          if (st === 'missing' || st === 'wrong') found[i].push({ col: v.col, day: b.date, lesson: b.lesson, label: v.label, wrong: st === 'wrong' });
        });
      });
    });
    (practices || []).filter(x => x.due < session.day && x.due >= from).forEach(x => {
      if (!assigned([x.col])) return;
      pupils.forEach((p, i) => {
        if (p.since && x.due < p.since) return;
        const st = videoState(cell(p.row, x.col));
        if (st === 'missing' || st === 'wrong') found[i].push({ col: x.col, day: x.due, lesson: '', label: x.label, wrong: st === 'wrong', practice: true });
      });
    });
    return found;
  }

  /* ---------- Logs: append only, the newest row of a key wins ---------- */
  function latest(rows, keyOf) {
    const map = new Map();
    (rows || []).forEach((r, i) => { const k = keyOf(r, i); if (k) map.set(k, r); });
    return map;
  }

  /* ---------- Roll call ---------- */
  const PRESENT = ['Có mặt', 'Đến muộn'], ABSENT = ['Đã báo nghỉ', 'Chưa báo nghỉ', 'Có phép', 'Không phép'];
  // minutesNow is minutes since midnight of "today".
  function rollCall(session, marks, today, minutesNow) {
    const closeAt = session.start + ROLL_CALL_MINUTES;
    const past = session.day < today || (session.day === today && minutesNow >= closeAt);
    const open = session.day < today || (session.day === today && minutesNow >= session.start - OPEN_BEFORE);
    const any = [...marks.values()].some(m => PRESENT.includes(m.status));
    return { closeAt, past, open, anyPresent: any, noRollCall: past && !any };
  }
  const tickStatus = (session, today, minutesNow) => (session.day === today && minutesNow >= session.start + ROLL_CALL_MINUTES) || session.day < today ? 'Đến muộn' : 'Có mặt';
  function pupilState(mark, roll) {
    const status = mark ? mark.status : '';
    if (PRESENT.includes(status) || ABSENT.includes(status)) return status;
    return roll.past && !roll.noRollCall ? 'Vắng chờ xác minh' : '';
  }

  /* ---------- Staff time ---------- */
  function lateMinutes(session, minutesNow) { return Math.max(0, minutesNow - (session.start - ARRIVE_BEFORE)); }
  // Monthly table from the newest row of each person and session.
  function monthSummary(rows, month) {
    const by = {};
    rows.filter(r => String(r.day).startsWith(month)).forEach(r => {
      const a = by[r.person] = by[r.person] || { person: r.person, role: r.role, onTime: 0, late: 0, lateMinutes: 0, absent: 0 };
      if (r.status === 'Đúng giờ') a.onTime++;
      if (r.status === 'Muộn') { a.late++; a.lateMinutes += Number(r.minutes) || 0; }
      if (r.status === 'Vắng') a.absent++;
    });
    return Object.values(by).sort((x, y) => x.person.localeCompare(y.person, 'vi'));
  }

  /* ---------- Hours: same rules as the CHẤM CÔNG TỔNG HỢP tab, but for any month without touching its shared B3 ---------- */
  const OFF_WORDS = /NGHỈ|NGHI|OFF|CANCEL|HỦY|HUỶ|KHÔNG HỌC|DELAY|DELAYED/;
  const DAY_NAMES = ['MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY', 'SUNDAY'];
  function payKind(cls, type) {
    const c = clean(cls).toUpperCase();
    if (/TUTOR.*IELTS|IELTS.*TUTOR/.test(c)) return 'IELTS TUTOR';
    if (/TUTOR/.test(c)) return 'TUTOR';
    if (/IELTS/.test(c)) return 'IELTS';
    if (/JUNIOR/.test(c)) return 'JUNIOR';
    if (/KIDS/.test(c)) return 'KIDS';
    if (/^ *TA[ ._-]*[0-9]+ *$/.test(c)) return 'TA';
    if (/BIRDY|KITTY|PONY|PONNY|KINDY|KINDER/.test(c)) return 'KINDER';
    if (/FIGHTER/.test(c)) return 'FIGHTER';
    return type === 'Class' ? 'CLASS KHÁC' : type;
  }
  function parsePay(rows, tab) {
    const out = [], start = dateIn(String(tab).split('-')[0]);
    const head = (rows || []).findIndex(r => r && clean(r[3]) === 'CLASS' && clean(r[12]) === 'CLASS STATUS');
    if (head < 0 || !start) return out;
    let day = '';
    for (let i = head + 1; i < rows.length; i++) {
      const r = rows[i] || [], name = DAY_NAMES.findIndex(d => clean(r[0]).toUpperCase().startsWith(d));
      if (name >= 0) day = addDays(start, name);
      const cls = clean(r[3]), person = key(r[4]), timeText = clean(r[1]);
      if (!day || !cls || !person || !timeText || /BREAK TIMES|MEETING NOTES|^DAY$|^CLASS$/.test(cls.toUpperCase())) continue;
      const upper = cls.toUpperCase();
      const type = /^ *(MEETING|STAFF MEETING|ALL STAFF) *$/.test(upper) ? 'Other' : /PART ?TIME|PART-TIME|NHAN VIEN|NHÂN VIÊN|STAFF/.test(upper) ? 'Part-time' : /TUTOR/.test(upper) ? 'Tutor' : /IELTS/.test(upper) ? 'IELTS' : 'Class';
      const status = clean(r[12]) || (OFF_WORDS.test([r[3], r[4], r[5], r[6], r[7], r[8], r[9], r[10], r[11]].join(' ').toUpperCase()) ? 'Nghỉ học' : 'Học');
      const time = parseTime(timeText), minutes = time ? time.end - time.start : 0;
      out.push({ day, timeText, start: time ? time.start : 0, cls, person, duty: key(r[6]) || key(r[5]), kind: payKind(cls, type), type, status, minutes,
        count: status === 'Học' && minutes > 0 && type !== 'Other' ? 1 : 0 });
    }
    // Part-time block G9:M13, one column per day: "PHUONG THANH (330p)".
    for (let i = 8; i < 13 && i < head; i++) for (let c = 6; c < 13; c++) {
      const text = clean(((rows[i] || [])[c] || '')).replace(/^[^:]*:/, '').trim(), person = key(text.replace(/\([^)]*\)/g, ''));
      if (!person) continue;
      const low = text.toLowerCase(), p = low.match(/(\d+(?:[.,]\d+)?)\s*(?:p|ph|phút|min)/), h = low.match(/(\d+(?:[.,]\d+)?)\s*h/);
      const hours = h ? Number(h[1].replace(',', '.')) : NaN;
      const minutes = p ? Number(p[1].replace(',', '.')) : hours <= 8 ? Math.round(hours * 60) : 0;
      out.push({ day: addDays(start, c - 6), timeText: '', start: 0, cls: 'TA PART-TIME', person, duty: '', kind: 'Part-time', type: 'Part-time', status: 'Học', minutes, count: 1 });
    }
    return out;
  }
  // Marking rows R:W of the tab: date, TA, class, kind of work, papers, note.
  function parseMarking(rows) {
    return (rows || []).map(r => ({ day: dateIn(r[0]), person: key(r[1]), cls: clean(r[2]), task: clean(r[3]), papers: Number(String(r[4] || '').replace(',', '.')) || 0, note: clean(r[5]) })).filter(x => x.day && x.person && x.papers > 0);
  }
  // Same grouping as the tab's teacher table: one line per person and type of class.
  function payTable(entries, month) {
    const by = {};
    entries.filter(e => e.day.startsWith(month)).forEach(e => {
      const k = e.person + '|' + e.kind, a = by[k] = by[k] || { person: e.person, kind: e.kind, count: 0, minutes: 0, off: 0 };
      if (e.count) { a.count++; a.minutes += e.minutes; }
      if (e.status !== 'Học') a.off++;
    });
    return Object.values(by).filter(a => a.count).sort((x, y) => (x.person + x.kind).localeCompare(y.person + y.kind, 'vi'));
  }
  // One person's month: the payable total, what is already behind us, every session to check against, and class duty for TAs.
  function payOf(entries, person, month, today) {
    const k = key(person), mine = entries.filter(e => e.person === k && e.day.startsWith(month)).sort((a, b) => (a.day + clock(a.start)).localeCompare(b.day + clock(b.start)));
    const kinds = {};
    mine.forEach(e => {
      const a = kinds[e.kind] = kinds[e.kind] || { kind: e.kind, count: 0, minutes: 0, off: 0, classes: {} };
      if (e.status !== 'Học') a.off++;
      if (!e.count) return;
      a.count++; a.minutes += e.minutes;
      const c = a.classes[e.cls] = a.classes[e.cls] || { cls: e.cls, count: 0, minutes: 0 };
      c.count++; c.minutes += e.minutes;
    });
    const paid = mine.filter(e => e.count), past = paid.filter(e => e.day <= today);
    return { rows: mine, kinds: Object.values(kinds).filter(a => a.count || a.off).sort((a, b) => b.minutes - a.minutes),
      count: paid.length, minutes: paid.reduce((n, e) => n + e.minutes, 0), pastCount: past.length, pastMinutes: past.reduce((n, e) => n + e.minutes, 0),
      duty: entries.filter(e => e.duty === k && e.person !== k && e.day.startsWith(month) && e.count).length };
  }
  const hoursText = (minutes, lang) => { const h = Math.floor(minutes / 60), m = minutes % 60; return lang === 'en' ? h + 'h' + (m ? ' ' + m + 'm' : '') : h + ' giờ' + (m ? ' ' + m + ' phút' : ''); };
  // Week tabs that hold any day of the month.
  function tabsOfMonth(titles, month) {
    const first = month + '-01', next = new Date(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 1), last = addDays(iso(next), -1);
    return (titles || []).filter(t => { const m = String(t).match(/^\s*(\d{2}\.\d{2}\.\d{4})\s*-\s*(\d{2}\.\d{2}\.\d{4})\s*$/); return m && dateIn(m[1]) <= last && dateIn(m[2]) >= first; });
  }

  return { parsePenalty, parseDuty, parseReturns, ARRIVE_BEFORE, ROLL_CALL_MINUTES, OPEN_BEFORE, PRESENT, ABSENT, clean, key, iso, fromIso, addDays, dayText, dateIn, colName, parseTime, clock, weekTab,
    parseWeek, taskState, mine, staffOf, sessionKey, trackerBlocks, practiceColumns, findBlock, videoState, isAbsentMark, gradeOf, pupilOf, owedVideos,
    latest, rollCall, tickStatus, pupilState, lateMinutes, monthSummary, nameKey, parsePay, parseMarking, payTable, payOf, hoursText, tabsOfMonth };
}));
