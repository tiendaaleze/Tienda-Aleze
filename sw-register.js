if ('serviceWorker' in navigator) {
  window.addEventListener('load', function() {
    navigator.serviceWorker.register('/Tienda-Aleze/sw.js', {
      scope: '/Tienda-Aleze/'
    }).then(function(reg) {
      console.log('[PWA] Service Worker registrado:', reg.scope);

      function _mostrarBannerActualizacion() {
        if (document.getElementById('_sw-update-banner')) return;
        const b = document.createElement('div');
        b.id = '_sw-update-banner';
        b.style.cssText = 'position:fixed;bottom:0;left:0;right:0;z-index:99999;background:#7C3AED;color:#fff;padding:.75rem 1rem;display:flex;align-items:center;justify-content:space-between;gap:.75rem;font-size:.85rem;box-shadow:0 -2px 8px rgba(0,0,0,.2)';
        b.innerHTML = '<span>🔄 Nueva versión disponible</span><button id="_sw-update-btn" style="background:#fff;color:#7C3AED;border:none;border-radius:6px;padding:.4rem .9rem;font-weight:700;cursor:pointer">Actualizar</button>';
        document.body.appendChild(b);
        document.getElementById('_sw-update-btn').onclick = function() {
          window.location.reload();
        };
      }

      reg.onupdatefound = function() {
        reg.installing.onstatechange = function() {
          if (this.state === 'installed' && navigator.serviceWorker.controller) {
            _mostrarBannerActualizacion();
          }
        };
      };

      document.addEventListener('visibilitychange', function() {
        if (document.visibilityState === 'visible') {
          reg.update().catch(function(){});
        }
      });
    }).catch(function(err) {
      console.warn('[PWA] Error registrando SW:', err);
    });
  });
}
