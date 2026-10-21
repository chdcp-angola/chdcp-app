/* sostituito dal service worker unico alla radice */
self.addEventListener('install', function () { self.skipWaiting(); });
self.addEventListener('activate', function (e) { e.waitUntil(caches.keys().then(function (k) { return Promise.all(k.filter(function (x) { return /^chdcp-(agenda|la)-/.test(x); }).map(function (x) { return caches.delete(x); })); }).then(function () { return self.registration.unregister(); })); });
