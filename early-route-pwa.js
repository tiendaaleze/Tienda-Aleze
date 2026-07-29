// ── DETECCIÓN DE RUTA TEMPRANA ─────────────────────────────────────────────
// Se ejecuta ANTES de que se pinte cualquier pantalla.
// Si la URL contiene /tienda o #/tienda → no mostrar login.
// Si la URL contiene /admin o es la raíz → mostrar login normalmente.
(function earlyRoute() {
  var path = window.location.pathname;
  var hash = window.location.hash;
  var esTienda = path.indexOf('/tienda') !== -1 || hash.indexOf('/tienda') !== -1 || hash === '#tienda';
  window.__rutaTienda = esTienda;
  // Manifest distinto segun quien instale — el de tienda abre directo al catalogo, el de
  // staff abre en el login. Se cambia ACA, antes de pintar nada, para que el navegador ya
  // vea el manifest correcto al momento de decidir si ofrece instalar la app.
  if (!esTienda) {
    var _manifestLink = document.getElementById('app-manifest-link');
    if (_manifestLink) _manifestLink.setAttribute('href', 'manifest-staff.json');
  }
  // Si NO es la tienda, inyectar clase visible en login lo antes posible
  // (el CSS la tiene en display:none por defecto)
  if (!esTienda) {
    document.addEventListener('DOMContentLoaded', function() {
      var el = document.getElementById('login-screen');
      if (el) el.classList.add('visible');
      // Verificar bloqueo activo al mostrar la pantalla de login
      var bloqueoTs = parseInt(localStorage.getItem('aleze_bloqueo') || '0');
      if (bloqueoTs > Date.now()) {
        // Bloqueo activo — mostrarlo después de que las funciones estén listas
        setTimeout(function() {
          if (typeof _mostrarBloqueo === 'function') _mostrarBloqueo(bloqueoTs);
        }, 800);
      }
    });
  }
})();

// ── Invitación a instalar + notificaciones — SOLO tienda pública ────────
// beforeinstallprompt puede disparar antes de que termine de cargar la página,
// así que se captura acá, temprano, junto al resto de la detección de ruta.
var _deferredInstallPrompt = null;
window.addEventListener('beforeinstallprompt', function(e) {
  e.preventDefault();
  _deferredInstallPrompt = e;
  _tryMostrarInstallInvite();
});
window.addEventListener('appinstalled', function() {
  _deferredInstallPrompt = null;
  var el = document.getElementById('install-invite'); if (el) el.style.display = 'none';
});

function _yaEsAppInstalada() {
  return window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;
}
function _esIOS() {
  return /iphone|ipad|ipod/i.test(navigator.userAgent) && !window.MSStream;
}
function _tryMostrarInstallInvite() {
  if (_yaEsAppInstalada()) return;
  if (localStorage.getItem('aleze_install_dismissed') === '1') return;
  var esIOS = _esIOS();
  if (!_deferredInstallPrompt && !esIOS) return; // Chrome/Android sin evento aun capturado — nada que ofrecer todavia
  setTimeout(function() {
    var el = document.getElementById('install-invite');
    if (!el || el.dataset.shown === '1') return;
    el.dataset.shown = '1';
    // Texto adaptado segun contexto: cliente (tienda) vs staff (admin/vendedor).
    const _descEl = document.getElementById('install-invite-desc');
    if (esIOS) {
      _descEl.textContent = window.__rutaTienda
        ? 'Toca el ícono de compartir 🔗 y elige "Agregar a pantalla de inicio".'
        : 'Toca el ícono de compartir 🔗 y elige "Agregar a pantalla de inicio" para acceso rápido y notificaciones de pedidos nuevos.';
      document.getElementById('install-invite-btn').style.display = 'none';
    } else {
      _descEl.textContent = window.__rutaTienda
        ? 'Acceso más rápido y notificaciones de tus pedidos.'
        : 'Acceso más rápido y notificaciones de pedidos nuevos.';
      document.getElementById('install-invite-btn').style.display = 'inline-flex';
    }
    el.style.display = 'block';
  }, 2500);
}

async function _instalarApp() {
  if (!_deferredInstallPrompt) return;
  _deferredInstallPrompt.prompt();
  var choice = await _deferredInstallPrompt.userChoice;
  _deferredInstallPrompt = null;
  document.getElementById('install-invite').style.display = 'none';
  if (choice && choice.outcome === 'accepted') {
    // Notificaciones recién después de instalar — para que funcionen nativas, no antes de dar algo a cambio.
    setTimeout(function() {
      if ('Notification' in window && Notification.permission === 'default') {
        Notification.requestPermission();
      }
    }, 1200);
  }
}

function _descartarInstallInvite(permanente) {
  var el = document.getElementById('install-invite'); if (el) el.style.display = 'none';
  if (permanente) localStorage.setItem('aleze_install_dismissed', '1');
}

// iOS nunca dispara beforeinstallprompt — se intenta mostrar igual, tras el mismo delay,
// una vez que el documento esta listo (para no competir con el resto de la carga inicial).
if (_esIOS()) {
  document.addEventListener('DOMContentLoaded', function() { _tryMostrarInstallInvite(); });
}
