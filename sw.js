/* chdcp-app · 45cfd4c7c0 */
var C = "chdcp-app-45cfd4c7c0", F = ["./","index.html","manifest.webmanifest","icon-192.png","icon-512.png","apple-touch-icon.png","favicon.png","agenda/","agenda/index.html","avaliacao/","avaliacao/index.html","avaliacao/toj.html","avaliacao/teorica.html","avaliacao/resultados.html","avaliacao/logo.png","avaliacao/star.png"];
self.addEventListener('install', function (e) { e.waitUntil(caches.open(C).then(function (c) { return c.addAll(F.map(function (u) { return new Request(u, { cache: 'reload' }); })); }).then(function () { return self.skipWaiting(); })); });
self.addEventListener('activate', function (e) { e.waitUntil(caches.keys().then(function (k) { return Promise.all(k.filter(function (x) { return x.indexOf('chdcp-') === 0 && x !== C; }).map(function (x) { return caches.delete(x); })); }).then(function () { return self.clients.claim(); })); });
self.addEventListener('fetch', function (e) {
  var r = e.request; if (r.method !== 'GET' || new URL(r.url).origin !== location.origin) return;
  if (r.mode === 'navigate') { e.respondWith(caches.open(C).then(function (c) { return new Promise(function (ok) {
    var done = false, fin = function (x) { if (!done && x) { done = true; ok(x); } };
    var hitP = c.match(r, { ignoreSearch: true });
    var t = setTimeout(function () { hitP.then(fin); }, 4000);
    fetch(new Request(r.url, { cache: 'no-cache', credentials: 'same-origin' })).then(function (res) { if (res && res.ok) { c.put(r.url.split('?')[0], res.clone()); clearTimeout(t); fin(res); } else { hitP.then(function (h) { fin(h || res); }); } })
      .catch(function () { clearTimeout(t); hitP.then(function (h) { fin(h || Response.error()); }); });
  }); })); return; }
  e.respondWith(caches.open(C).then(function (c) { return c.match(r, { ignoreSearch: true }).then(function (hit) {
    var net = fetch(r).then(function (res) { if (res && res.ok) c.put(r.url.split('?')[0], res.clone()); return res; }).catch(function () { return hit; });
    return hit || net; }); }));
});
self.addEventListener('push', function (e) {
  var d = {}; try { d = e.data ? e.data.json() : {}; } catch (x) { try { d = { data: { body: e.data.text() } }; } catch (y) { d = {}; } }
  var m = d.data || d.notification || d;
  e.waitUntil(self.registration.showNotification(m.title || 'CHDCP Conecta', { body: m.body || '', icon: 'icon-192.png', tag: m.tag || undefined, renotify: !!m.tag, data: { url: m.url || '' } }));
});
self.addEventListener('notificationclick', function (e) {
  e.notification.close();
  var u = (e.notification.data && e.notification.data.url) || self.registration.scope;
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function (ws) {
    for (var i = 0; i < ws.length; i++) { if (ws[i].url.indexOf(u) === 0 && 'focus' in ws[i]) return ws[i].focus(); }
    return self.clients.openWindow(u);
  }));
});
