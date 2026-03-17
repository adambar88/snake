const CACHE = 'snake-v1';

self.addEventListener('install', e => {
    e.waitUntil(
        caches.open(CACHE).then(c =>
            c.addAll(['/snake/', '/snake/index.html', '/snake/manifest.json', '/snake/favicon.svg'])
        ).then(() => self.skipWaiting())
    );
});

self.addEventListener('activate', e => {
    e.waitUntil(
        caches.keys().then(keys =>
            Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
        ).then(() => self.clients.claim())
    );
});

self.addEventListener('fetch', e => {
    if (e.request.method !== 'GET') return;
    e.respondWith(
        caches.match(e.request).then(cached => {
            const network = fetch(e.request).then(res => {
                if (res.ok) caches.open(CACHE).then(c => c.put(e.request, res.clone()));
                return res;
            });
            return cached || network;
        })
    );
});
