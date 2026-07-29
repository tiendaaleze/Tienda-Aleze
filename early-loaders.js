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
