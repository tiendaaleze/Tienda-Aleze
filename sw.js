// ================================================
// Service Worker — Aleze Shop
// Estrategia: Network First, fallback a caché
// Versión: 1.0.0
// ================================================

const CACHE_NAME = 'tienda-aleze-test-v1';
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
    fetch(event.request)
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
