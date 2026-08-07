// Carga de JsBarcode con fallback a CDN secundaria
(function() {
  var s = document.createElement('script');
  s.src = 'https://cdnjs.cloudflare.com/ajax/libs/JsBarcode/3.11.6/JsBarcode.all.min.js';
  s.onerror = function() {
    var s2 = document.createElement('script');
    s2.src = 'https://cdn.jsdelivr.net/npm/jsbarcode@3.11.6/dist/JsBarcode.all.min.js';
    document.head.appendChild(s2);
  };
  document.head.appendChild(s);
})();

function hideSplash() {
  const s = document.getElementById('splash-screen');
  if (!s || s.classList.contains('hidden')) return;
  s.classList.add('fade-out');
  setTimeout(() => { s.classList.add('hidden'); }, 420);
}

// html2canvas: carga diferida — solo cuando se imprime ticket
function _loadHtml2Canvas(cb) {
  if (window.html2canvas) { if(cb) cb(); return; }
  var s = document.createElement('script');
  s.src = 'https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js';
  s.onload = cb; document.head.appendChild(s);
}

// xlsx: carga diferida — solo cuando admin abre panel Excel
function _loadXLSX(cb) {
  if (window.XLSX) { if(cb) cb(); return; }
  var s = document.createElement('script');
  s.src = 'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js';
  s.onload = cb; document.head.appendChild(s);
}

// html5-qrcode: carga diferida — solo cuando se abre el escáner
function _loadHtml5QrCode(cb) {
  if (window.Html5Qrcode) { if(cb) cb(); return; }
  var s = document.createElement('script');
  s.src = 'https://unpkg.com/html5-qrcode@2.3.8/html5-qrcode.min.js';
  s.onload = cb; document.head.appendChild(s);
}
// Mensajes rotativos del splash — puramente cosmético, no depende de por qué tarda, solo
// da sensación de progreso mientras iniciarFirebase()/getDocM(db_productos) siguen en curso.
// Se detiene solo cuando hideSplash() ya ocultó la pantalla (chequea la clase 'hidden').
(function() {
  const _mensajes = ['Preparando tu tienda...', 'Cargando catálogo...', 'Ya casi listo...'];
  let _i = 0;
  setInterval(() => {
    const el = document.getElementById('splash-msg');
    const s = document.getElementById('splash-screen');
    if (!el || !s || s.classList.contains('hidden') || s.classList.contains('fade-out')) return;
    _i = (_i + 1) % _mensajes.length;
    el.style.opacity = '0';
    setTimeout(() => { el.textContent = _mensajes[_i]; el.style.opacity = '1'; }, 350);
  }, 2500);
})();
