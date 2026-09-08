// Service Worker — Encrier
const CACHE = 'encre-v7';

const ASSETS = [
  './',
  './index.html',
  './editeur.html',
  './lecture.html',
  './profil.html',
  './stats-page.html',
  './guide.html',
  './auteurs.html',
  './manifest.json',
  './favicon.ico',
  './favicon.svg',
  './css/main.css',
  './css/dark.css',
  './js/app.js',
  './js/stats.js',
  './js/theme.js'
];

const CDN = [
  'https://fonts.googleapis.com/css2?family=Playfair+Display:ital,wght@0,400;0,600;1,400&family=Crimson+Pro:ital,wght@0,300;0,400;1,300&family=JetBrains+Mono:wght@400&display=swap',
  'https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js',
  'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/dist/umd/supabase.js',
  'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js'
];

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE).then(cache =>
      cache.addAll(ASSETS).then(() =>
        Promise.allSettled(CDN.map(url => cache.add(url)))
      )
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
  const url = e.request.url;

  // Ignorer les URLs non-HTTP (chrome-extension://, etc.)
  if (!url.startsWith('http')) return;

  // Laisser passer Supabase et les API dynamiques
  if (url.includes('supabase.co')) return;
  if (url.includes('backup.php') || url.includes('list-backups.php') || url.includes('get-backup.php')) return;

  // Laisser passer les requêtes non-GET
  if (e.request.method !== 'GET') return;

  e.respondWith(
    caches.match(e.request).then(cached => {
      if (cached) return cached;
      return fetch(e.request).then(response => {
        if (response.ok && url.startsWith('http')) {
          const clone = response.clone();
          caches.open(CACHE).then(cache => {
            try { cache.put(e.request, clone); } catch(err) {}
          });
        }
        return response;
      }).catch(() => {
        if (e.request.mode === 'navigate') {
          return caches.match('./index.html');
        }
      });
    })
  );
});
