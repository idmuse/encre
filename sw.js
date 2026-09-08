// Service Worker — Encrier
// v8 : stratégie "réseau d'abord" pour les pages et le code de l'appli,
// avec repli sur le cache si hors ligne. La v7 servait tout "cache d'abord",
// ce qui pouvait figer des appareils sur une vieille version même après
// un déploiement — corrigé ici (voir aussi le nettoyage des vieux caches
// dans 'activate', déjà en place).
const CACHE = 'encre-v8';

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

// Permet à la page de forcer l'activation immédiate d'une nouvelle version
// (voir le bandeau "nouvelle version disponible" dans app.js).
self.addEventListener('message', e => {
  if (e.data === 'skipWaiting') self.skipWaiting();
});

self.addEventListener('fetch', e => {
  const req = e.request;
  const url = req.url;

  // Ignorer les URLs non-HTTP (chrome-extension://, etc.)
  if (!url.startsWith('http')) return;

  // Laisser passer Supabase et les API dynamiques
  if (url.includes('supabase.co')) return;
  if (url.includes('backup.php') || url.includes('list-backups.php') || url.includes('get-backup.php')) return;

  // Laisser passer les requêtes non-GET
  if (req.method !== 'GET') return;

  const sameOrigin = url.startsWith(self.location.origin);
  // Pages et code de l'appli (même origine) : toujours essayer la dernière
  // version en ligne d'abord, ne retomber sur le cache que si hors ligne.
  const isAppCode = sameOrigin && (req.mode === 'navigate' || /\.(html|js|css|json)(\?|$)/.test(url));

  if (isAppCode) {
    e.respondWith(
      fetch(req).then(res => {
        if (res.ok) {
          const clone = res.clone();
          caches.open(CACHE).then(cache => { try { cache.put(req, clone); } catch (err) {} });
        }
        return res;
      }).catch(() =>
        caches.match(req).then(cached => cached || (req.mode === 'navigate' ? caches.match('./index.html') : undefined))
      )
    );
    return;
  }

  // Reste (polices, librairies CDN versionnées, images) : cache d'abord,
  // ces fichiers ne changent pas une fois publiés à une version donnée.
  e.respondWith(
    caches.match(req).then(cached => {
      if (cached) return cached;
      return fetch(req).then(response => {
        if (response.ok) {
          const clone = response.clone();
          caches.open(CACHE).then(cache => {
            try { cache.put(req, clone); } catch (err) {}
          });
        }
        return response;
      }).catch(() => undefined);
    })
  );
});
