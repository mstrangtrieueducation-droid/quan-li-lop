window.QL_CONFIG = {
  // Owner 12/11: the app talks to its own gateway on Cloudflare; Google sheets are only the copy behind it.
  server: 'https://qll-cong.helper1-mstrangtrieueducation.workers.dev/',
  // The old Apps Script server: reads fall back to it if the gateway cannot be reached.
  gas: 'https://script.google.com/macros/s/AKfycbzY6A64R3HX1ZwscE0OYs_ojqPK6TWGyPz87kdCvLHokovqXV0d2afLTu7-UujyUfoP6Q/exec',
  scheduleId: 'schedule',
  diemDanhId: 'diemdanh',
  quanLiId: 'quanli'
};
