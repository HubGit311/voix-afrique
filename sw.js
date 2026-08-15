// Service worker volontairement minimal pour Awa.
//
// Objectif unique : satisfaire les critères d'installabilité PWA des
// navigateurs (qui exigent un service worker actif avec un gestionnaire
// "fetch"). Il ne met RIEN en cache via le Cache API — chaque déploiement
// doit être visible immédiatement pour les utilisateurs, sans risque de
// rester coincé sur une ancienne version de l'app.

self.addEventListener('install', (event) => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener('fetch', (event) => {
  const url = event.request.url;

  // Les connexions temps réel de Firestore (onSnapshot) et certains appels
  // Firebase/Google utilisent un mécanisme de streaming particulier
  // (long-polling / WebChannel) qui casse s'il est intercepté puis rejoué
  // via fetch() par un service worker. On laisse donc ces requêtes passer
  // nativement, sans y toucher, en ne les interceptant pas du tout.
  const isGoogleApi =
    url.includes('firestore.googleapis.com') ||
    url.includes('googleapis.com') ||
    url.includes('firebaseapp.com') ||
    url.includes('firebasestorage.app') ||
    url.includes('firebaseio.com');

  if (isGoogleApi) {
    return; // ne pas appeler respondWith : le navigateur gère la requête normalement
  }

  // Pour une requête de navigation (chargement/rechargement de la page HTML
  // elle-même), on force explicitement un aller au réseau en ignorant le
  // cache HTTP natif du navigateur (distinct du Cache API, qu'on n'utilise
  // jamais ici). Sans ce "cache: no-store", un navigateur peut réutiliser
  // une ancienne réponse HTTP mise en cache localement pour index.html même
  // si aucun code de ce service worker ne la stocke explicitement — ce qui
  // ferait tourner une vieille version du code chez un utilisateur malgré un
  // déploiement réussi côté serveur.
  if (event.request.mode === 'navigate') {
    event.respondWith(
      fetch(event.request, { cache: 'no-store' }).catch(() => fetch(event.request))
    );
    return;
  }

  // Pour tout le reste, laisse passer normalement, sans mise en cache.
  event.respondWith(fetch(event.request));
});
