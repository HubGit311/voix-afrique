// Service worker volontairement minimal pour Awa.
//
// Objectif unique : satisfaire les critères d'installabilité PWA des
// navigateurs (qui exigent un service worker actif avec un gestionnaire
// "fetch"). Il ne met RIEN en cache — chaque déploiement doit être visible
// immédiatement pour les utilisateurs, sans risque de rester coincé sur une
// ancienne version de l'app.

self.addEventListener('install', (event) => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener('fetch', (event) => {
  // Laisse passer toutes les requêtes normalement, sans mise en cache.
  event.respondWith(fetch(event.request));
});
