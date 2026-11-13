// Keeps this app's own files on the device so the page opens at once, like the parent dashboards (owner 09/11: "mở nhanh y hệt
// dashboard"). Only this app's own files are kept: data from Google (Apps Script, Sheets) and sign-in never pass through here, and
// fonts are kept only as the browser fetched them.
//  - The page itself opens from the copy kept here, and is fetched again behind it. As soon as the page has started it asks
//    whether that fetch brought a newer copy; if so it reloads itself at once (only while it is still opening), so an update
//    shows on the same open instead of one open later. (Before 09/11 the news was sent before the page existed and was lost,
//    so a device could stay on an old copy for days.)
//  - Files named with ?v= never change: they come from here without asking the network. Copies of older versions are dropped
//    when a newer page arrives.
const CACHE = 'app-' + new URL(self.registration.scope).pathname.replace(/\W+/g, '-');
const SHELL = ['./', './index.html'];
let pageCheck = Promise.resolve(false);
// A device that already had this app (an older worker) gets its page copy refreshed and its open windows reloaded once when this
// worker takes over, so the fix reaches it on that open instead of after several more.
let upgraded = false;
self.addEventListener('install', e => { self.skipWaiting(); e.waitUntil(caches.has(CACHE).then(had => { upgraded = had; return caches.open(CACHE); }).then(c => upgraded ? c.addAll(SHELL.map(p => new Request(p, { cache: 'no-cache' }))) : c.addAll(SHELL)).catch(() => {})); });
self.addEventListener('activate', e => e.waitUntil((async () => {
  const keep = new Set([CACHE, 'fonts']);
  for (const k of await caches.keys()) if (k.startsWith('app-') && !keep.has(k)) await caches.delete(k);
  await self.clients.claim();
  if (upgraded) for (const c of await self.clients.matchAll({ type: 'window' })) { try { c.navigate(c.url.split('#')[0]).catch(() => {}); } catch (err) {} }
})()));
self.addEventListener('message', e => {
  if (!e.data || e.data.type !== 'check' || !e.source) return;
  e.waitUntil(pageCheck.then(changed => { if (changed) e.source.postMessage({ type: 'app-updated', path: 'page' }); }).catch(() => {}));
});
async function tell(msg) { for (const c of await self.clients.matchAll({ type: 'window' })) c.postMessage(msg); }
const isFont = u => u.hostname === 'fonts.googleapis.com' || u.hostname === 'fonts.gstatic.com';
const versionOf = text => { const m = String(text).match(/\?v=([\w.-]+)/); return m ? m[1] : ''; };
async function dropOldVersions(cache, v) {
  if (!v) return;
  for (const k of await cache.keys()) { const m = new URL(k.url).search.match(/[?&]v=([\w.-]+)/); if (m && m[1] !== v) await cache.delete(k); }
}
self.addEventListener('fetch', e => {
  const req = e.request, u = new URL(req.url);
  if (req.method !== 'GET') return;
  if (isFont(u)) {
    e.respondWith(caches.open('fonts').then(async c => (await c.match(req)) || fetch(req).then(r => { if (r.ok || r.type === 'opaque') c.put(req, r.clone()); return r; })));
    return;
  }
  const scope = new URL(self.registration.scope).pathname;
  if (u.origin !== self.location.origin || !u.pathname.startsWith(scope)) return;
  if (/\/dev\//.test(u.pathname)) return;
  const page = req.mode === 'navigate' || u.pathname === scope || /\/index\.html$/.test(u.pathname);
  const key = new Request(u.origin + u.pathname + (page ? '' : u.search));
  e.respondWith((async () => {
    const cache = await caches.open(CACHE), kept = await cache.match(key);
    // Read the kept copy now: once it is handed to the page its body is used up (the cause of devices staying on old copies).
    const keptText = kept && !(!page && /[?&]v=/.test(u.search)) ? kept.clone().text() : null;
    // A file with ?v= is fixed for that version.
    if (!page && /[?&]v=/.test(u.search) && kept) return kept;
    const fresh = fetch(req.url.split('#')[0], { cache: 'no-cache' }).then(async r => {
      let changed = false;
      if (r.ok && r.type === 'basic') {
        if (keptText && /html|javascript|css/.test(r.headers.get('content-type') || '')) {
          const [a, b] = await Promise.all([keptText, r.clone().text()]);
          changed = a !== b;
          if (changed && page) await dropOldVersions(cache, versionOf(b));
        }
        await cache.put(key, r.clone());
      }
      // A changed script or style of a page already open (files without ?v=, as in Học phí): tell it now.
      if (changed && !page) tell({ type: 'app-updated', path: u.pathname });
      return { r, changed };
    });
    if (page && req.mode === 'navigate') pageCheck = fresh.then(x => x.changed).catch(() => false);
    if (kept) { e.waitUntil(fresh.catch(() => {})); return kept; }
    return fresh.then(x => x.r);
  })());
});

// Notifications (owner 13/11: "thông báo ở điện thoại hoặc laptop… như 1 ứng dụng thực sự"). The gateway sends an encrypted
// message through the browser's push service; this shows it, and a tap opens the app at that place (in an open window if any).
self.addEventListener('push', e => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch (err) { d = { body: e.data ? e.data.text() : '' }; }
  e.waitUntil(self.registration.showNotification(d.title || 'Quản lí lớp', {
    body: d.body || '', tag: d.tag || undefined, renotify: !!d.tag, icon: 'logo.png', badge: 'logo.png', data: { url: d.url || './' }
  }));
});
self.addEventListener('notificationclick', e => {
  e.notification.close();
  const url = new URL((e.notification.data && e.notification.data.url) || './', self.registration.scope).href;
  e.waitUntil((async () => {
    const wins = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const w = wins.find(c => c.url.startsWith(self.registration.scope));
    // Owner 13/11 (iPhone: "bấm vào nhận xét của GV chả ra gì"): an open window is told where to go and brought forward; where
    // that is not possible (iPhone home-screen app), the app is opened at the address itself, which it reads when it starts.
    if (w) { w.postMessage({ type: 'mo', url }); try { await w.focus(); return; } catch (err) {} }
    try { await self.clients.openWindow(url); } catch (err) { if (w && w.navigate) { try { await w.navigate(url); } catch (x) {} } }
  })());
});
