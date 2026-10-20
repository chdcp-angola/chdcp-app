/* chdcp-la · 5c3807bfbb */
var C = "chdcp-la-5c3807bfbb", F = ["./","index.html","toj.html","teorica.html","resultados.html","manifest.webmanifest","logo.png","star.png","icon-192.png","icon-512.png","apple-touch-icon.png","favicon.png"];
self.addEventListener('install', function (e) { e.waitUntil(caches.open(C).then(function (c) { return c.addAll(F); }).then(function () { return self.skipWaiting(); })); });
self.addEventListener('activate', function (e) { e.waitUntil(caches.keys().then(function (k) { return Promise.all(k.filter(function (x) { return x.indexOf("chdcp-la-") === 0 && x !== C; }).map(function (x) { return caches.delete(x); })); }).then(function () { return self.clients.claim(); })); });
self.addEventListener('fetch', function (e) {
  var r = e.request; if (r.method !== 'GET' || new URL(r.url).origin !== location.origin) return;
  e.respondWith(caches.open(C).then(function (c) { return c.match(r, { ignoreSearch: true }).then(function (hit) {
    var net = fetch(r).then(function (res) { if (res && res.ok) c.put(r.url.split('?')[0], res.clone()); return res; }).catch(function () { return hit; });
    return hit || net; }); }));
});
