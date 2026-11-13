// 14/11 audit. One file of the app that does not arrive (weak Wi-Fi in a classroom, or the page opened in the very second a new
// version was being published) left the grey opening frame on the screen for good, with nothing to tap: on 14/11 at 01:21 the
// rules file did not arrive on one open and the app never started. This file loads first and looks once the page has finished
// loading. If a file is missing or the app did not start, the page loads again by itself (twice at most); if the app still has not
// started it says so and offers a button. A page that opened well is never touched.
(function () {
  var KEY = 'ql-tai-lai', failed = false;
  // A script that could not be fetched fires "error" on its own tag; it is only seen in the capture phase.
  window.addEventListener('error', function (e) { var t = e && e.target; if (t && t.tagName === 'SCRIPT' && t.src) failed = true; }, true);
  function tries() { try { return +sessionStorage.getItem(KEY) || 0; } catch (e) { return -1; } }
  function say() {
    var main = document.getElementById('main');
    if (!main) return;
    main.innerHTML = '<div class="card" style="margin:24px auto;max-width:420px;text-align:center"><p><b>Chưa tải được ứng dụng</b></p>'
      + '<p class="small muted">Mạng yếu hoặc bị ngắt giữa chừng. Bấm nút để tải lại.<br>The app could not load. Tap to try again.</p>'
      + '<p><button id="btnTaiLai" type="button">Tải lại · Reload</button></p></div>';
    var b = document.getElementById('btnTaiLai');
    if (b) b.onclick = function () { try { sessionStorage.removeItem(KEY); } catch (e) {} location.reload(); };
  }
  function check() {
    var core = !!(window.QL && window.QL_CONFIG && window.QL_APP), n = tries();
    if (core && !failed) { try { sessionStorage.removeItem(KEY); } catch (e) {} return; }
    // Without a counter that survives the reload there is no way to stop after two tries, so no automatic reload at all.
    if (n >= 0 && n < 2) {
      try { sessionStorage.setItem(KEY, String(n + 1)); } catch (e) { if (!core) say(); return; }
      setTimeout(function () { location.reload(); }, 1500 * (n + 1));
      return;
    }
    // A side file still missing after two tries, with the app itself running: leave the app alone.
    if (!core) say();
  }
  if (document.readyState === 'complete') setTimeout(check, 0);
  else window.addEventListener('load', function () { setTimeout(check, 0); });
})();
