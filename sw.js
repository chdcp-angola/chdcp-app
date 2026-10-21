/* chdcp-app · ac1e8996b4 */
var C = "chdcp-app-ac1e8996b4", F = ["./","index.html","manifest.webmanifest","icon-192.png","icon-512.png","apple-touch-icon.png","favicon.png","agenda/","agenda/index.html","avaliacao/","avaliacao/index.html","avaliacao/toj.html","avaliacao/teorica.html","avaliacao/resultados.html","avaliacao/logo.png","avaliacao/star.png"];
self.addEventListener('install', function (e) { e.waitUntil(caches.open(C).then(function (c) { return c.addAll(F); }).then(function () { return self.skipWaiting(); })); });
self.addEventListener('activate', function (e) { e.waitUntil(caches.keys().then(function (k) { return Promise.all(k.filter(function (x) { return x.indexOf('chdcp-') === 0 && x !== C; }).map(function (x) { return caches.delete(x); })); }).then(function () { return self.clients.claim(); })); });
self.addEventListener('fetch', function (e) {
  var r = e.request; if (r.method !== 'GET' || new URL(r.url).origin !== location.origin) return;
  e.respondWith(caches.open(C).then(function (c) { return c.match(r, { ignoreSearch: true }).then(function (hit) {
    var net = fetch(r).then(function (res) { if (res && res.ok) c.put(r.url.split('?')[0], res.clone()); return res; }).catch(function () { return hit; });
    return hit || net; }); }));
});
self.addEventListener('push', function (e) {
  var d = {}; try { d = e.data ? e.data.json() : {}; } catch (x) { try { d = { data: { body: e.data.text() } }; } catch (y) { d = {}; } }
  var m = d.data || d.notification || d;
  e.waitUntil(self.registration.showNotification(m.title || 'CHDCP', { body: m.body || '', icon: 'icon-192.png', tag: m.tag || undefined, renotify: !!m.tag, data: { url: m.url || '' } }));
});
self.addEventListener('notificationclick', function (e) {
  e.notification.close();
  var u = (e.notification.data && e.notification.data.url) || self.registration.scope;
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function (ws) {
    for (var i = 0; i < ws.length; i++) { if (ws[i].url.indexOf(u) === 0 && 'focus' in ws[i]) return ws[i].focus(); }
    return self.clients.openWindow(u);
  }));
});
