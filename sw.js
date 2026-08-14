// ================================================
// Service Worker — Tienda Aleze
// Estrategia: Network First, fallback a caché
// Versión: 1.0.0
// ================================================

// ── Notificaciones push (FCM) en segundo plano ──────────────────────────────
// Esto es lo que permite avisar de un pedido nuevo aunque la app este cerrada
// o el celular bloqueado — new Notification() directo desde index.html (usado
// para cuando la app SI esta abierta) no puede hacer esto, tiene que salir de
// acá, en el Service Worker, que sigue vivo aunque la pestaña este cerrada.
// Dormido hasta que se configure VAPID_KEY en index.html y se registre al
// menos un dispositivo — sin eso, esto no recibe nada, no rompe nada.
try {
  const { initializeApp } = await import('https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js');
  const { getMessaging, onBackgroundMessage } = await import('https://www.gstatic.com/firebasejs/10.12.0/firebase-messaging-sw.js');

  const app = initializeApp({
    apiKey: "AIzaSyC9pGcFJG1XNyVgcZNp2NKcxW0d1oat2qI",
    authDomain: "tienda-aleze.firebaseapp.com",
    projectId: "tienda-aleze",
    storageBucket: "tienda-aleze.firebasestorage.app",
    messagingSenderId: "231416120915",
    appId: "1:231416120915:web:749a1a6648d0006faf68a6"
  });

  const messaging = getMessaging(app);

  // El mensaje llega como "data" (sin campo "notification", ver Cloud Function) —
  // por eso hay que armar la notificación acá a mano, en vez de que el navegador
  // la muestre solo (eso evitaría poder personalizar el ícono y el clic).
  onBackgroundMessage(messaging, (payload) => {
    const datos = payload.data || {};
    self.registration.showNotification(datos.titulo || '🛍️ Nuevo pedido online', {
      body: datos.cuerpo || '',
      icon: '/Tienda-Aleze/icon.svg',
      tag: 'pedido-' + (datos.pedidoId || Date.now()),
      data: { pedidoId: datos.pedidoId },
      vibrate: [300, 100, 300, 100, 300], // el sonido lo decide el sistema operativo, no esto —
      silent: false,                       // pero la vibracion si es confiable en Android
      requireInteraction: true             // se queda visible hasta que se toque, no desaparece sola
    });
  });
} catch (e) {
  console.warn('[SW] Notificaciones push no disponibles:', e);
}

// Al tocar la notificación, abrir la app (o enfocar la pestaña si ya está abierta)
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        if (client.url.includes('/Tienda-Aleze/') && 'focus' in client) return client.focus();
      }
      if (clients.openWindow) return clients.openWindow('/Tienda-Aleze/');
    })
  );
});

const CACHE_NAME = 'tienda-aleze-test-v4';
const BASE_PATH = '/Tienda-Aleze';

// Archivos a pre-cachear al instalar
const PRECACHE_URLS = [
  BASE_PATH + '/',
  BASE_PATH + '/index.html',
  BASE_PATH + '/manifest.json',
  BASE_PATH + '/icon.svg',
  // CDN críticos (Chart.js, QR, etc.)
  'https://cdnjs.cloudflare.com/ajax/libs/Chart.js/4.4.1/chart.umd.min.js',
  'https://cdnjs.cloudflare.com/ajax/libs/qrcodejs/1.0.0/qrcode.min.js',
  'https://cdnjs.cloudflare.com/ajax/libs/JsBarcode/3.11.6/JsBarcode.all.min.js',
];

// ── INSTALACIÓN ──────────────────────────────────
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => {
      // Cachear lo que se pueda — si algo falla no bloquear la instalación
      return Promise.allSettled(
        PRECACHE_URLS.map(url =>
          cache.add(url).catch(() => {
            console.warn('[SW] No se pudo cachear:', url);
          })
        )
      );
    }).then(() => self.skipWaiting())
  );
});

// ── ACTIVACIÓN ───────────────────────────────────
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(cacheNames =>
      Promise.all(
        cacheNames
          .filter(name => name !== CACHE_NAME)
          .map(name => {
            console.log('[SW] Eliminando caché antiguo:', name);
            return caches.delete(name);
          })
      )
    ).then(() => self.clients.claim())
  );
});

// ── FETCH: Network First ──────────────────────────
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);

  // No interceptar Firebase, APIs externas ni chrome-extension
  if (
    url.hostname.includes('firebaseio.com') ||
    url.hostname.includes('googleapis.com') ||
    url.hostname.includes('firebaseapp.com') ||
    url.hostname.includes('gstatic.com') ||
    url.protocol === 'chrome-extension:'
  ) {
    return; // Dejar pasar sin tocar
  }

  // Solo interceptar GET
  if (event.request.method !== 'GET') return;

  event.respondWith(
    // CRITICO: { cache: 'no-store' } fuerza a que este fetch ignore el cache HTTP normal del
    // navegador y vaya de verdad a la red — sin esto, "Network First" podia devolver una
    // respuesta guardada por el navegador mismo (no por este Service Worker) sin llegar
    // realmente a GitHub Pages, sobre todo en apps instaladas como PWA, mas propensas a
    // reusar respuestas viejas. Esto explicaba por que el codigo actualizado a veces no se
    // reflejaba incluso despues de cerrar y volver a abrir.
    fetch(event.request, { cache: 'no-store' })
      .then(networkResponse => {
        // Respuesta válida — guardar en caché y devolver
        if (networkResponse && networkResponse.status === 200) {
          const responseClone = networkResponse.clone();
          caches.open(CACHE_NAME).then(cache => {
            cache.put(event.request, responseClone);
          });
        }
        return networkResponse;
      })
      .catch(() => {
        // Sin red — buscar en caché
        return caches.match(event.request).then(cachedResponse => {
          if (cachedResponse) return cachedResponse;
          // Si es navegación y no hay caché, devolver index.html
          if (event.request.mode === 'navigate') {
            return caches.match(BASE_PATH + '/index.html');
          }
          return new Response('Sin conexión', { status: 503 });
        });
      })
  );
});
