// ===================== TIENDA PÚBLICA (/tienda) =====================
// La tienda se carga en una capa separada cuando la ruta es /tienda
let _tiendaCart = [];
let _tiendaUser = null; // {nombre, tel, dir}

// ── Carrito persistente — localStorage ───────────────────────────────────────
// El clienteId es único por dispositivo/navegador (no requiere login)
// ── Identidad real del cliente en tienda pública: el teléfono es la llave, no un token
// aleatorio por dispositivo — así cambiar de equipo o borrar el navegador ya no pierde el
// historial ni los puntos. localStorage queda solo como comodidad (recordar quién es en ESTE
// equipo), nunca como la fuente de verdad — esa es siempre la búsqueda en DB.clientes.
// Escribe DIRECTO a clientes/{id} — no via fbGuardar() (el documento viejo completo exige
// isAdmin() sin excepcion; un visitante de la tienda nunca esta autenticado, esa escritura
// fallaba en silencio). La regla de clientes ahora permite esto especificamente, validado.
function tndSincronizarClientePublico(cli, esNuevo) {
  if (!dbModular) return; // [SDK modular]
  const data = esNuevo
    ? { id: cli.id, nombre: cli.nombre, alias: cli.alias, tel: cli.tel, dir: cli.dir||'', cumple: cli.cumple||'', compras: 0, total: 0, deuda: 0, puntos: 0 }
    : { nombre: cli.nombre, alias: cli.alias };
  _sincIniciar('cliente_publico', cli.id);
  // Antes esto seleccionaba entre 'set' y 'set' (los 2 branches eran identicos) — simplificado
  // de paso, era codigo muerto disfrazado de logica condicional.
  setDocM(docM(dbModular, 'clientes', String(cli.id)), data, esNuevo ? {} : { merge: true })
    .then(() => _sincTerminar('cliente_publico', cli.id))
    .catch(e => _sincError('cliente_publico', cli.id, e, 'tus datos', true));
}

// Asíncrona: DB.clientes nunca se carga entera para un visitante público (evita traer todo
// el listado solo para identificar a uno) — si no está en memoria, consulta Firestore SOLO por
// ese teléfono puntual. Devuelve una Promise<clienteId>.
async function tndResolverCliente(nombre, tel) {
  const telLimpio = (tel || '').replace(/\s/g, '');
  if (!telLimpio || telLimpio.length !== 9) return null; // Peru: celulares son 9 digitos exactos
  let cli = DB.clientes.find(c => (c.tel || '').replace(/\s/g, '') === telLimpio);
  if (!cli && dbModular) { // [SDK modular]
    try {
      const snap = await getDocsM(queryM(collectionM(dbModular, 'clientes'), whereM('tel', '==', telLimpio), limitM(1)));
      if (!snap.empty) {
        const doc = snap.docs[0];
        cli = _envolverCliente({ id: parseInt(doc.id), ...doc.data() });
        DB.clientes.push(cli);
      }
    } catch(e) { console.warn('tndResolverCliente: no se pudo consultar clientes por telefono', e); }
  }
  if (cli) {
    if (nombre && nombre.trim() && cli.nombre !== nombre.trim()) {
      // CRITICO: asignar cli.nombre/cli.alias directo dispara el Proxy (1-2 escrituras) ademas
      // de la escritura explicita combinada de tndSincronizarClientePublico de abajo — hasta 3
      // escrituras por una sola identificacion de cliente en la tienda publica.
      _clienteProxySkipSync = true;
      try {
        cli.nombre = nombre.trim();
        if (!cli.alias) cli.alias = nombre.trim();
      } finally { _clienteProxySkipSync = false; }
      tndSincronizarClientePublico(cli, false);
    }
  } else {
    cli = _envolverCliente({ id: getId(), nombre: nombre || 'Cliente', alias: nombre || 'Cliente', tel: telLimpio, dir: '', cumple: '', compras: 0, total: 0, deuda: 0, puntos: 0 });
    DB.clientes.push(cli);
    tndSincronizarClientePublico(cli, true);
  }
  try { localStorage.setItem('aleze_tnd_cid_real', String(cli.id)); } catch(e) {}
  return cli.id;
}

// Recupera el cliente real ya identificado en este equipo (si lo hay) — no crea nada nuevo,
// solo consulta la comodidad local. Si no hay nada guardado, el visitante sigue anónimo hasta
// que escriba su teléfono (al pedir, o al querer ver sus puntos).
function tndGetClienteIdReal() {
  try {
    const cached = localStorage.getItem('aleze_tnd_cid_real');
    if (cached) {
      const id = parseInt(cached);
      if (DB.clientes.find(c => c.id === id)) return id;
    }
  } catch(e) {}
  return null;
}

// ══════════════════════════════════════════════════════════════════════════
// Verificación SMS de teléfono (Firebase Phone Auth) — CONSTRUIDA COMPLETA,
// pero dormida detrás de DB.config.requiereVerificacionSMS (false por defecto).
// Con el flag apagado, nada de esto se llama — tndResolverCliente() sigue
// siendo el único mecanismo activo. Cuando exista pasarela de pago real,
// activar el flag alcanza para que esta verificación se vuelva obligatoria.
// ══════════════════════════════════════════════════════════════════════════
let _tndRecaptchaVerifier = null;
let _tndConfirmationResult = null;

function _tndFormatearTelefonoPeru(tel) {
  const limpio = (tel || '').replace(/\D/g, '');
  if (limpio.startsWith('51') && limpio.length === 11) return '+' + limpio;
  return '+51' + limpio.replace(/^51/, '');
}

// Envía el código por SMS al teléfono dado. Requiere authModular (ya inicializado para login
// de staff — se reutiliza, no es un servicio aparte) y el contenedor reCAPTCHA invisible.
function tndEnviarCodigoSMS(tel) {
  if (!authModular) { alert('Servicio no disponible por el momento. Intenta más tarde.'); return Promise.resolve(false); }
  const telE164 = _tndFormatearTelefonoPeru(tel);
  try {
    if (!_tndRecaptchaVerifier) {
      _tndRecaptchaVerifier = new window.__fbModular.auth.RecaptchaVerifier(authModular, 'tnd-recaptcha-container', { size: 'invisible' });
    }
    return window.__fbModular.auth.signInWithPhoneNumber(authModular, telE164, _tndRecaptchaVerifier)
      .then(confirmationResult => {
        _tndConfirmationResult = confirmationResult;
        return true;
      })
      .catch(e => {
        console.warn('[SMS] Error al enviar código:', e);
        alert('No se pudo enviar el código. Verifica el número e intenta de nuevo.\n' + (e.message || ''));
        return false;
      });
  } catch(e) {
    console.warn('[SMS] Error de reCAPTCHA:', e);
    alert('No se pudo iniciar la verificación. Intenta de nuevo.');
    return Promise.resolve(false);
  }
}

// Confirma el código de 6 dígitos que el cliente recibió por SMS.
function tndVerificarCodigoSMS(codigo) {
  if (!_tndConfirmationResult) { alert('Primero solicita el código.'); return Promise.resolve(false); }
  return _tndConfirmationResult.confirm(codigo)
    .then(() => {
      try { localStorage.setItem('aleze_tnd_sms_verificado', '1'); } catch(e) {}
      _tndConfirmationResult = null;
      return true;
    })
    .catch(e => {
      console.warn('[SMS] Código incorrecto:', e);
      alert('Código incorrecto. Intenta de nuevo.');
      return false;
    });
}

// Sesión larga (acordado): una vez verificado en este equipo, no se vuelve a pedir código
// salvo que el propio flujo de pago (a futuro) lo exija explícitamente aparte.
function tndTelefonoYaVerificado() {
  try { return localStorage.getItem('aleze_tnd_sms_verificado') === '1'; } catch(e) { return false; }
}

// ── Envoltorio de activación: hoy (flag apagado) llama directo a tndResolverCliente().
// El día que el flag esté en true, exige verificación SMS antes de resolver la identidad,
// salvo que este equipo ya la haya hecho antes (sesión larga). callback recibe el clienteId.
function tndResolverClienteConVerificacion(nombre, tel, callback) {
  if (!DB.config.requiereVerificacionSMS || tndTelefonoYaVerificado()) {
    tndResolverCliente(nombre, tel).then(callback);
    return;
  }
  _tndPendienteNombre = nombre;
  _tndPendienteTel = tel;
  _tndPendienteCallback = callback;
  _tndStep = 'verificar-sms';
  tndRenderPanel();
  document.getElementById('tnd-overlay').classList.add('open');
  document.getElementById('tnd-panel').classList.add('open');
}
let _tndPendienteNombre = null, _tndPendienteTel = null, _tndPendienteCallback = null;

function tndSolicitarCodigoUI() {
  const tel = _tndPendienteTel;
  document.getElementById('tnd-sms-status').textContent = '⏳ Enviando código...';
  tndEnviarCodigoSMS(tel).then(ok => {
    if (ok) {
      document.getElementById('tnd-sms-status').textContent = '✅ Código enviado a ' + tel;
      document.getElementById('tnd-sms-paso2').style.display = 'block';
    } else {
      document.getElementById('tnd-sms-status').textContent = '';
    }
  });
}

function tndConfirmarCodigoUI() {
  const codigo = document.getElementById('tnd-sms-codigo')?.value.trim();
  if (!codigo || codigo.length < 4) { alert('Ingresa el código recibido.'); return; }
  tndVerificarCodigoSMS(codigo).then(ok => {
    if (ok && _tndPendienteCallback) {
      const cb = _tndPendienteCallback;
      const nombrePend = _tndPendienteNombre, telPend = _tndPendienteTel;
      _tndPendienteNombre = _tndPendienteTel = _tndPendienteCallback = null;
      tndResolverCliente(nombrePend, telPend).then(cb);
    }
  });
}

// Guarda el carrito actual en localStorage
function tndSaveCart() {
  try {
    localStorage.setItem('aleze_tnd_cart', JSON.stringify(_tiendaCart));
  } catch(e) {}
}

// Función para el tacho — eliminar item completo del carrito
function tndEliminarDelCarrito(prodId) {
  _tiendaCart = _tiendaCart.filter(i => i.prodId !== prodId);
  tndSaveCart();
  tndUpdateCartBadge();
  tndRenderPanel();
}

// Restaura el carrito desde localStorage — valida stock y precio actual
function tndLoadCart() {
  try {
    const saved = JSON.parse(localStorage.getItem('aleze_tnd_cart') || '[]');
    _tiendaCart = saved
      .map(item => {
        const prod = (DB.productos || []).find(p => p.id === item.prodId);
        if (!prod || stockTotal(prod) <= 0) return null; // producto sin stock (consolidado, tienda pública)
        if (prod.venc && prod.venc < today()) return null; // producto vencido
        return { ...item, precio: prod.precio, nombre: prod.nombre, imagen: prod.imagen||'' }; // precio/imagen actualizados
      })
      .filter(Boolean);
    tndSaveCart(); // limpia entradas inválidas
  } catch(e) { _tiendaCart = []; }
}

// Guarda datos del cliente para pre-rellenar en próxima visita
function tndSaveUser(nombre, tel) {
  try {
    localStorage.setItem('aleze_tnd_user', JSON.stringify({ nombre, tel }));
  } catch(e) {}
}

// Carga datos guardados del cliente
function tndLoadUser() {
  try {
    const saved = JSON.parse(localStorage.getItem('aleze_tnd_user') || 'null');
    if (saved) _tiendaUser = saved;
  } catch(e) {}
}

function initTienda() {
  // Ocultar login y app del sistema
  document.getElementById('login-screen').classList.remove('visible');
  const appEl = document.getElementById('app');
  if (appEl) appEl.style.display = 'none';
  try { hideSplash(); } catch(e) {}
  // Mostrar tienda
  let tiendaEl = document.getElementById('tienda-publica');
  if (!tiendaEl) {
    tiendaEl = document.createElement('div');
    tiendaEl.id = 'tienda-publica';
    document.body.appendChild(tiendaEl);
  }
  tiendaEl.style.display = 'block';
  // Mostrar el estado de carga DE INMEDIATO — antes, la pantalla quedaba en blanco
  // mientras la lectura de Firestore estaba en curso (el mensaje "Cargando catálogo..."
  // solo aparecía DESPUÉS de que la lectura terminaba y seguía sin haber productos).
  tiendaEl.innerHTML = '<div style="display:flex;flex-direction:column;align-items:center;justify-content:center;height:100vh;gap:1rem;color:#6B7280;font-size:1rem;background:#FAF8FF">' +
    '<div style="width:40px;height:40px;border:3px solid #EDE9FE;border-top-color:#7C3AED;border-radius:50%;animation:tndSpin .8s linear infinite"></div>' +
    '<div>Cargando catálogo...</div>' +
    '</div><style>@keyframes tndSpin{to{transform:rotate(360deg)}}</style>';

  // Helper interno: inicializar datos persistidos y renderizar
  function _initTiendaConDatos() {
    if (!DB.productos || DB.productos.length === 0) {
      // Productos aún no disponibles — mostrar mensaje en lugar de pantalla en blanco
      tiendaEl.innerHTML = '<div style="display:flex;align-items:center;justify-content:center;height:60vh;color:#6B7280;font-size:1rem">Cargando catálogo...</div>';
      return;
    }
    tndGetClienteIdReal();
    tndLoadUser();
    tndLoadCart();
    tndUpdateCartBadge();
    _renderTienda();
    // Link directo a un producto (#/producto/123) — mismo catálogo ya cargado, cero lecturas
    // adicionales al detectar el hash; solo el detalle (si lo tiene) se trae bajo demanda.
    const _hashMatch = window.location.hash.match(/^#\/producto\/(\d+)/);
    if (_hashMatch) {
      const _prodIdHash = parseInt(_hashMatch[1]);
      if (DB.productos.find(p => p.id === _prodIdHash)) tndVerDetalle(_prodIdHash);
    }
  }

  // Siempre cargar desde Firebase — sin condición de caché para garantizar datos frescos
  if (dbModular) { // [SDK modular]
    getDocM(docM(dbModular, 'aleze', 'db_productos')).then(snap => {
      if (snap.exists()) { // en modular, exists es un METODO, no una propiedad
        const pd = snap.data();
        if (pd.categorias) DB.categorias = pd.categorias;
        if (pd.config)     DB.config     = { ...DB.config, ...pd.config };
        _fbProdCacheTs = Date.now();
      }
      // CRITICO: productos (con su stock ya unificado adentro, ver FASE 3/4) vive en su
      // propia coleccion, no en pd.productos (el array viejo, que ya no existe desde que
      // fbGuardarProductos() se simplifico). Antes esta funcion seguia el patron viejo por
      // completo (pd.productos + una lectura separada de la coleccion stock, que ya no se
      // actualiza desde ningun lado) — sobrescribia el stock ya correcto, cargado bien desde
      // otro lado, con datos vacios/desactualizados de esa coleccion muerta.
      //
      // CRITICO: cache del catalogo por version REAL del servidor, no por tiempo fijo — con
      // catalogos grandes, releer 1000+ productos en cada visita agota la cuota diaria de
      // lecturas con apenas unas decenas de visitantes reales. El stock debe reflejarse al
      // instante en cuanto algo cambia (fricción real si un cliente compra algo agotado), asi
      // que el cache nunca se basa en "cuanto tiempo paso" sino en "¿cambio algo de verdad?" —
      // marcarCatalogoActualizado_* (Cloud Functions) actualiza aleze/catalogo_meta cada vez
      // que un producto o categoria cambia, sin importar el origen (venta, merma, edicion).
      // Durante horas sin ningun cambio, esa marca queda igual y el cache local sirve
      // indefinidamente: 0 lecturas adicionales para cada visita durante ese tiempo. En el
      // instante en que algo cambia, la version ya no coincide y se relee todo de inmediato.
      return getDocM(docM(dbModular, 'aleze', 'catalogo_meta')).then(metaSnap => {
        const _versionServidor = (metaSnap.exists() && metaSnap.data().ultimaActualizacion)
          ? metaSnap.data().ultimaActualizacion.toMillis() : null;
        let _cacheValido = false;
        if (_versionServidor) {
          try {
            const _versionLocal = localStorage.getItem('tnd_catalogo_version');
            const _catalogoLocal = localStorage.getItem('tnd_catalogo_data');
            if (_versionLocal && _catalogoLocal && parseInt(_versionLocal) === _versionServidor) {
              DB.productos = JSON.parse(_catalogoLocal);
              _cacheValido = true;
            }
          } catch(e) { /* localStorage no disponible o dato corrupto — sigue de largo, relee todo */ }
        }
        if (_cacheValido) return; // catalogo ya cargado desde cache local, sin releer nada
        return getDocsM(collectionM(dbModular, 'productos')).then(prodsSnap => {
          DB.productos = prodsSnap.docs.map(d => d.data());
          if (_versionServidor) {
            try {
              localStorage.setItem('tnd_catalogo_version', String(_versionServidor));
              localStorage.setItem('tnd_catalogo_data', JSON.stringify(DB.productos));
            } catch(e) { /* localStorage lleno o no disponible — no rompe nada, solo no cachea esta vez */ }
          }
        }).catch(() => {});
      }).catch(() => {
        // catalogo_meta aun no existe, o la regla no esta publicada todavia — cae al
        // comportamiento original: relee todo, sin cache, igual que siempre.
        return getDocsM(collectionM(dbModular, 'productos')).then(prodsSnap => {
          DB.productos = prodsSnap.docs.map(d => d.data());
        }).catch(() => {});
      });
    }).then(() => {
      _initTiendaConDatos();
    }).catch(() => _initTiendaConDatos());
  } else {
    _initTiendaConDatos();
  }
}
function _getStockBadge(p) {
  const _stockPub = stockTotal(p);
  if (_stockPub <= 0) return '<span class="badge badge-red">Agotado</span>';
  if (_stockPub <= p.stockMin) return '<span class="badge badge-orange">Últimas unidades</span>';
  // Sin badge cuando hay stock normal — el usuario asume disponibilidad por defecto;
  // el badge queda reservado para las excepciones que sí necesitan atención.
  return '';
}

function _getPromoTienda(p) {
  const hoy = today();
  const promoActivas = (DB.promociones||[]).filter(pr => pr.activa && pr.hasta >= hoy && _promoAplicaSede(pr, 'principal'));
  return p.esCombo
    ? promoActivas.find(pr => pr.packProdId === p.id)
    : promoActivas.find(pr => !pr.packProdId && pr.prod1 == p.id && !pr.prod2);
}
function _renderTienda() {
  try {
  const tiendaEl = document.getElementById('tienda-publica');
  if (!tiendaEl) { console.warn('tienda-publica no encontrado'); return; }
  const config   = DB.config || {};
  const nombre   = config.nombre    || 'Tienda Aleze';
  const dir      = config.direccion || '';
  const waNum    = config.whatsappTienda || '980037284';

  tiendaEl.innerHTML = `
<style>
#tienda-publica {
  font-family:'Segoe UI',system-ui,sans-serif;
  background:#FAF8FF;
  min-height:100vh;
  overflow-y:auto;
  overflow-x:hidden;
  position:relative;
}
/* Fondo con emojis muy sutiles corriendo detras de todo el contenido — para que no se sienta
   un blanco plano, sin competir nunca con el contenido real (opacity muy bajo, z-index -1,
   fixed para que se mantenga parejo aunque se haga scroll). */
.tnd-bg-pattern {
  position:fixed;inset:0;z-index:0;overflow:hidden;pointer-events:none;
}
.tnd-bg-pattern span { position:absolute;font-size:2.4rem;opacity:.045;color:#5B21B6; }
.tnd-main { position:relative;z-index:1; }
.tnd-header {
  background:linear-gradient(135deg,#5B21B6,#7C3AED);
  color:white;
  padding:1rem 1.5rem;
  position:sticky;top:0;z-index:100;
  display:flex;align-items:center;justify-content:space-between;
  box-shadow:0 2px 8px rgba(0,0,0,0.15);
}
.tnd-brand { font-size:1.2rem;font-weight:800;display:flex;align-items:center;gap:.5rem; }
.tnd-cart-btn {
  background:rgba(255,255,255,.2);border:1.5px solid rgba(255,255,255,.4);
  color:white;padding:.5rem 1rem;border-radius:10px;cursor:pointer;
  font-weight:700;font-size:.9rem;position:relative;
}
.tnd-cart-count {
  position:absolute;top:-8px;right:-8px;
  background:#EF4444;color:white;
  border-radius:50%;width:20px;height:20px;
  font-size:.7rem;font-weight:700;
  display:flex;align-items:center;justify-content:center;
}
.tnd-cart-count.tnd-bump { animation:tndCartBump .35s ease; }
@keyframes tndCartBump { 0%{transform:scale(1);} 40%{transform:scale(1.45);} 100%{transform:scale(1);} }
@media (max-width:380px) {
  .tnd-cart-label { display:none; }
  .tnd-cart-btn { padding:.5rem .65rem; }
}
.tnd-main { max-width:1400px;margin:0 auto;padding:1.25rem; }
/* Buscador sticky: queda anclado justo debajo del header al hacer scroll — fondo sólido
   propio para que el contenido que pasa detrás no se transparente. */
#tnd-search-sticky-wrap {
  position:sticky; top:60px; z-index:90;
  background:#FAF8FF; margin:0 -1.25rem; padding:0 1.25rem .75rem;
}
.tnd-search-bar {
  display:flex;gap:.5rem;
  background:white;border-radius:12px;padding:.6rem 1rem;
  box-shadow:0 1px 4px rgba(0,0,0,.08);
}
.tnd-search-bar input {
  flex:1;border:none;outline:none;font-size:.95rem;background:transparent;
}
/* ── Home: secciones con scroll horizontal (promos, categorias, recien agregados) ──
   Mismo patron en las 3, para que la pagina se sienta consistente y "viva" — con
   scroll-snap para que se acomode solo al soltar, como cualquier app real, no una lista
   estatica. */
.tnd-section-title { font-weight:800;font-size:1.05rem;color:#1f2937;margin-bottom:.75rem;display:flex;align-items:center;gap:.4rem; }
.tnd-banner-carousel { position:relative;margin-bottom:1.5rem; }
.tnd-banner-track {
  display:flex;overflow-x:auto;scroll-snap-type:x proximity;
  scrollbar-width:none;border-radius:14px;-webkit-overflow-scrolling:touch;
}
.tnd-banner-track::-webkit-scrollbar { display:none; }
/* Móvil/app: tal cual la versión que ya funcionaba bien — tamaño natural, sin recorte. */
.tnd-banner-slide { flex:0 0 100%;scroll-snap-align:start;display:block; }
.tnd-banner-slide picture { display:block; width:100%; }
.tnd-banner-slide img { width:100%;height:auto;display:block; }
@media (min-width: 900px) {
  .tnd-banner-carousel { max-width:1100px; margin-left:auto; margin-right:auto; }
.tnd-banner-slide picture:has(source) img { width:100%; height:auto; object-fit:contain; }
  .tnd-banner-slide picture:not(:has(source)) img { height:230px; width:100%; object-fit:cover; object-position:center; }
}
.tnd-banner-dots { display:flex;justify-content:center;gap:6px;margin-top:.6rem; }
.tnd-banner-dot { width:6px;height:6px;border-radius:50%;background:#D1D5DB;transition:all .25s; }
.tnd-banner-dot.active { width:18px;border-radius:3px;background:#7C3AED; }
.tnd-scroll-wrap { position:relative;margin-bottom:1.5rem; }
.tnd-scroll-wrap::after {
  content:'';position:absolute;top:0;right:0;bottom:.5rem;width:28px;
  background:linear-gradient(to right, transparent, #FAF8FF);pointer-events:none;
}
.tnd-scroll-row {
  display:flex;gap:.75rem;overflow-x:auto;padding-bottom:.5rem;
  scroll-snap-type:x proximity;-webkit-overflow-scrolling:touch;
  /* CRITICO: pan-x SOLO (sin pan-y) le decia al navegador "unicamente permitido el gesto
     horizontal aca" — si el dedo arrancaba el scroll VERTICAL de la pagina justo encima de
     un riel (categorias, promos, recien agregados), ese componente vertical del gesto se
     bloqueaba en ese punto exacto, y la pagina "no respondia" ahi — aunque funcionara bien
     en cualquier otro lugar de la pantalla. Con pan-x pan-y, el navegador deja pasar ambos
     ejes y decide solo cual predomina segun la direccion real del gesto, como es normal. */
  touch-action:pan-x pan-y;
  scrollbar-width:none;
}
.tnd-scroll-row::-webkit-scrollbar { display:none; }
.tnd-scroll-row > * { scroll-snap-align:start; }
/* Burbujas de categoria — reemplazan las fotos-collage con texto incrustado por un circulo
   de color + emoji, mucho mas liviano y consistente entre categorias con o sin foto propia. */
.tnd-cat-bubble {
  cursor:pointer;flex-shrink:0;width:86px;display:flex;flex-direction:column;
  align-items:center;gap:.4rem;text-align:center;
  transition:transform .12s ease;
}
.tnd-cat-bubble:active { transform:scale(.94); }
.tnd-cat-circle {
  width:72px;height:72px;border-radius:50%;
  display:flex;align-items:center;justify-content:center;font-size:1.7rem;
  background:linear-gradient(135deg,#5B21B6,#7C3AED);
  box-shadow:0 3px 10px rgba(124,58,237,.25);
  overflow:hidden;
}
/* Circulo un poco mas grande en web/PC que en mobile/app — pantallas mas anchas, se ve mejor
   con algo mas de presencia. Mismo breakpoint de 900px ya usado en todo el sistema para
   distinguir desktop de mobile. */
@media (min-width:900px) {
  .tnd-cat-bubble { width:113px; }
  .tnd-cat-circle { width:99px; height:99px; }
}
.tnd-cat-circle img { width:100%;height:100%;object-fit:cover; }
.tnd-cat-bubble .tnd-cat-label { font-size:.7rem;font-weight:700;color:#374151;line-height:1.2; }
/* Tarjetas de producto en riel (promos / recien agregados) — mismo toque de presion que las
   burbujas, para que toda la pagina responda igual al tacto. */
.tnd-rail-card { transition:transform .12s ease; }
.tnd-rail-card:active { transform:scale(.96); }
.tnd-cats { margin-bottom:1.25rem; }
.tnd-cats #tnd-cats-riel::-webkit-scrollbar { display:none; }
.tnd-cat-tag {
  padding:.25rem .6rem;border-radius:20px;cursor:pointer;
  border:1.5px solid #e5e7eb;background:white;
  font-size:.75rem;font-weight:600;color:#6b7280;transition:all .15s;
  white-space:nowrap;flex-shrink:0;
}
.tnd-cat-tag.active { background:#7C3AED;color:white;border-color:#7C3AED; }
.tnd-grid {
  display:grid;grid-template-columns:repeat(auto-fill,minmax(160px,1fr));gap:1rem;
}
.tnd-prod-card {
  background:white;border-radius:14px;overflow:hidden;
  box-shadow:0 1px 4px rgba(0,0,0,.08);cursor:pointer;
  transition:all .15s;border:2px solid transparent;
  display:flex;flex-direction:column;
  position:relative;
}
.tnd-prod-card:hover:not(.agotado) { border-color:#7C3AED;transform:translateY(-2px); }
.tnd-prod-card.agotado { opacity:.6;cursor:not-allowed; }
/* Tarjetas con oferta activa — antes solo la etiqueta chica de la esquina distinguia un
   producto en oferta, facil de pasar por alto al escanear rapido una grilla completa. Borde +
   fondo sutil hacen que la tarjeta entera destaque a la distancia, sin ser tan agresivo como
   para verse como un error o una alerta. */
/* Tarjetas con oferta activa — el badge de la esquina ya comunica la oferta con claridad;
   una sombra mas marcada (en vez de borde rojo + fondo rosado) da un realce sutil a la
   distancia sin competir visualmente con la foto del producto ni leerse como una alerta. */
.tnd-prod-card.en-oferta { box-shadow:0 4px 14px rgba(124,58,237,.18); }
.tnd-prod-card.en-oferta:hover:not(.agotado) { border-color:#7C3AED; }
/* La imagen ocupa la mayor parte de la tarjeta — formato 4:5 (mas alta que ancha, no
   cuadrada) en vez de 1:1, para que el texto de abajo (nombre + precio) quede genuinamente
   en el 30% o menos del total, no la mitad. Fondo gris muy suave para que fotos con fondo
   blanco/transparente no se "pierdan". */
.tnd-prod-img-wrap {
  width:100%;aspect-ratio:4/5;background:#F3F4F6;
  display:flex;align-items:center;justify-content:center;
  padding:.85rem;box-sizing:border-box;position:relative;
}
.tnd-prod-img-wrap img { width:100%;height:100%;object-fit:contain; }
.tnd-prod-icon-emoji { font-size:3.6rem; }
/* Boton de compra rapida — atajo de 1 toque, coexiste con el click en el resto de la
   tarjeta (que sigue abriendo el detalle si el producto lo tiene). stopPropagation evita que
   ambos comportamientos se disparen a la vez. */
.tnd-prod-add-btn {
  position:absolute;right:6px;bottom:6px;z-index:2;
  background:#7C3AED;color:#fff;border:none;border-radius:50%;
  width:30px;height:30px;font-size:1.1rem;font-weight:700;line-height:1;
  display:flex;align-items:center;justify-content:center;cursor:pointer;
  box-shadow:0 2px 6px rgba(124,58,237,.4);
}
.tnd-prod-add-btn.granel { width:auto;border-radius:14px;padding:0 .5rem;font-size:.68rem; }
.tnd-prod-add-btn:active { transform:scale(0.92); }
.tnd-prod-info { padding:.55rem .75rem .65rem;text-align:center; }
.tnd-prod-name { font-size:.8rem;font-weight:700;color:#1f2937;margin-bottom:.2rem;line-height:1.2;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden; }
.tnd-prod-price { font-size:1.05rem;font-weight:800;color:#7C3AED; }
.tnd-prod-price-orig { font-size:.72rem;color:#6b7280;text-decoration:line-through; }
/* Un solo contenedor coordina los 2 grupos de badges (izquierda: detalle/promo — derecha:
   stock) — antes eran 2 position:absolute independientes que no se "conocian" entre si, y en
   tarjetas angostas con texto largo en ambos lados (ej. "Ultimas unidades" + "Detalle"+
   "OFERTA") terminaban superpuestos. Con flex-wrap, si no caben en la misma fila, el grupo
   de la derecha se envuelve a una segunda linea debajo, nunca se superponen. */
.tnd-badges-top {
  position:absolute;top:8px;left:8px;right:8px;z-index:2;
  display:flex;flex-wrap:wrap;justify-content:space-between;align-items:flex-start;gap:4px;
}
.tnd-badges-left { display:flex;flex-direction:column;gap:4px;align-items:flex-start; }
.tnd-badge-detalle { background:#7C3AED;color:#fff;font-size:.62rem;font-weight:700;padding:.15rem .4rem;border-radius:5px; }
.tnd-prod-promo { color:white;font-size:.74rem;font-weight:800;padding:.2rem .5rem;border-radius:5px;background:#EF4444;box-shadow:0 1px 4px rgba(239,68,68,.4);letter-spacing:.2px; }
.tnd-panel-overlay {
  position:fixed;inset:0;background:rgba(0,0,0,.5);z-index:200;display:none;
}
.tnd-panel-overlay.open { display:block; }
.tnd-panel {
  position:fixed;top:0;right:0;bottom:0;width:min(420px,100vw);
  background:white;z-index:201;transform:translateX(100%);
  transition:transform .3s cubic-bezier(.4,0,.2,1);
  display:flex;flex-direction:column;box-shadow:-4px 0 20px rgba(0,0,0,.15);
}
.tnd-panel.open { transform:translateX(0); }
.tnd-panel-header {
  padding:1rem 1.25rem;border-bottom:1px solid #e5e7eb;
  display:flex;align-items:center;justify-content:space-between;
  flex-shrink:0;
}
.tnd-panel-header h3 { font-size:1.1rem;font-weight:700; }
.tnd-panel-close {
  background:#f3f4f6;border:none;width:32px;height:32px;border-radius:50%;
  cursor:pointer;font-size:1.1rem;
}
.tnd-panel-body { flex:1;overflow-y:auto;padding:1rem 1.25rem; }
.tnd-panel-footer { padding:1rem 1.25rem;border-top:1px solid #e5e7eb;flex-shrink:0; }
.tnd-cart-item {
  display:flex;align-items:center;gap:.6rem;
  padding:.6rem;background:#f9fafb;border-radius:10px;margin-bottom:.5rem;
}
.tnd-cart-item-icon { font-size:1.5rem; width:44px; height:44px; flex-shrink:0; display:flex; align-items:center; justify-content:center; overflow:hidden; }
.tnd-cart-item-info { flex:1; }
.tnd-cart-item-name { font-size:.82rem;font-weight:700;color:#1f2937; }
.tnd-cart-item-price { font-size:.78rem;color:#7C3AED;font-weight:600; }
.tnd-qty-btn { width:28px;height:28px;border-radius:6px;background:#e5e7eb;border:none;cursor:pointer;font-size:1rem; }
.tnd-qty-btn:hover { background:#7C3AED;color:white; }
.tnd-qty-val { font-size:.9rem;font-weight:700;min-width:24px;text-align:center; }
.tnd-cart-trash { background:none; border:none; cursor:pointer; font-size:1rem; color:#ef4444; padding:.2rem .3rem; margin-left:.2rem; flex-shrink:0; }
.tnd-btn { width:100%;padding:.8rem;border-radius:10px;border:none;cursor:pointer;font-size:1rem;font-weight:700; }
.tnd-btn-primary { background:#7C3AED;color:white; }
.tnd-btn-primary:hover { background:#5B21B6; }
.tnd-btn-accent { background:#10B981;color:white; }
.tnd-btn-outline { background:white;color:#374151;border:1.5px solid #d1d5db;margin-top:.5rem; }
.tnd-step { display:none; }
.tnd-step.active { display:block; }
.tnd-user-area { background:#EDE9FE;border-radius:10px;padding:.75rem 1rem;margin-bottom:1rem;font-size:.85rem; }
.tnd-delivery-box { background:#ECFDF5;border-radius:10px;padding:.75rem 1rem;margin:.75rem 0;font-size:.82rem;color:#065F46;border-left:4px solid #10B981; }
.tnd-form-group { margin-bottom:.75rem; }
.tnd-form-group label { display:block;font-size:.78rem;font-weight:700;color:#4b5563;margin-bottom:.3rem; }
.tnd-form-group input, .tnd-form-group select {
  width:100%;padding:.6rem .75rem;border:1.5px solid #e5e7eb;
  border-radius:8px;font-size:.85rem;outline:none;
}
.tnd-form-group input:focus, .tnd-form-group select:focus { border-color:#7C3AED; }
.tnd-metodo-grid { display:grid;grid-template-columns:1fr 1fr;gap:.4rem;margin-bottom:.75rem; }
.tnd-metodo-opt {
  padding:.5rem;border:1.5px solid #e5e7eb;border-radius:8px;
  cursor:pointer;text-align:center;font-size:.8rem;font-weight:600;
  transition:all .15s;
}
.tnd-metodo-opt.selected { border-color:#7C3AED;background:#EDE9FE;color:#5B21B6; }
/* Toast de feedback al agregar al carrito — reemplaza el parpadeo de borde verde anterior */
#tnd-toast {
  position:fixed; left:50%; bottom:24px; transform:translateX(-50%) translateY(20px);
  background:#1f2937; color:#fff; font-size:.85rem; font-weight:600;
  padding:.7rem 1.2rem; border-radius:12px; box-shadow:0 4px 16px rgba(0,0,0,.25);
  z-index:500; opacity:0; pointer-events:none; transition:opacity .25s ease, transform .25s ease;
  display:flex; align-items:center; gap:.5rem; max-width:90vw;
}
#tnd-toast.show { opacity:1; transform:translateX(-50%) translateY(0); }
@media(max-width:600px){
  .tnd-grid{grid-template-columns:repeat(2,1fr);}
  .tnd-panel{width:100vw;}
}
#tnd-bottombar {
  position:fixed; left:0; right:0; bottom:0; z-index:150;
  background:#fff; border-top:1px solid #e5e7eb;
  display:flex; box-shadow:0 -2px 10px rgba(0,0,0,.06);
  padding-bottom:env(safe-area-inset-bottom, 0px);
}
.tnd-bb-item {
  flex:1; background:none; border:none; cursor:pointer;
  display:flex; flex-direction:column; align-items:center; gap:2px;
  padding:.5rem 0 .4rem; color:#9ca3af; font-size:.65rem; font-weight:600;
}
.tnd-bb-item.active { color:#7C3AED; }
.tnd-bb-icon { font-size:1.3rem; line-height:1; }
.tnd-bb-badge {
  position:absolute; top:-6px; right:-8px; background:#EF4444; color:#fff;
  font-size:.6rem; font-weight:700; border-radius:50%; min-width:14px; height:14px;
  display:flex; align-items:center; justify-content:center; padding:0 2px;
}
#tienda-publica { padding-bottom:64px; }
/* En móvil, el header oculta ⭐ Puntos (ya cubierto por su propio botón en la barra inferior)
   y el botón "Ver todo el catálogo" del Home (mismo destino que "Catálogo" de la barra). El
   carrito SÍ se muestra siempre en el header — misma ubicación familiar que la mayoría de
   apps, en vez de vivir solo en la barra inferior. En escritorio no cambia nada. */
.tnd-header .tnd-puntos-btn, #tnd-ver-catalogo-btn { display:none; }
@media (min-width:900px) {
  #tnd-bottombar { display:none; }
  #tienda-publica { padding-bottom:0; }
  .tnd-header .tnd-puntos-btn, #tnd-ver-catalogo-btn { display:inline-flex; }
}
#tnd-wa-fab {
  display:none; /* oculto en mobile — se integra como boton de la bottom bar en su lugar */
  position:fixed; right:16px; bottom:24px; z-index:160;
  width:52px; height:52px; border-radius:50%;
  background:#25D366; color:#fff; font-size:1.5rem;
  align-items:center; justify-content:center;
  text-decoration:none; box-shadow:0 4px 12px rgba(37,211,102,.4);
}
@media (min-width:900px) {
  #tnd-wa-fab { display:flex; } /* en desktop no hay bottom bar, vuelve a flotar */
}
/* ── Filtros y orden (marca/precio/orden) — colapsados en botón + hoja SOLO en móvil ──
   Pedido explícito del usuario: en PC estos 3 selects caben cómodos y quedan visibles siempre,
   sin ningún cambio acá. En móvil, el font-size:16px que los navegadores fuerzan en <select>
   (evita el zoom automático de iOS) los hace demasiado anchos para convivir en una fila —
   terminaban en 3 filas casi completas, ocupando ~30% de la pantalla antes de ver un solo
   producto. Mismo breakpoint de 900px ya usado en todo este archivo para distinguir desktop de
   mobile (ver #tnd-bottombar arriba). */
.tnd-filtros-btn-mobile {
  display:flex; align-items:center; gap:.4rem;
  background:#fff; border:1.5px solid #e5e7eb; border-radius:8px;
  padding:.55rem .8rem; font-size:.82rem; font-weight:600; color:#374151;
  margin-bottom:.75rem; cursor:pointer;
}
.tnd-filtros-badge {
  display:inline-block; width:7px; height:7px; border-radius:50%; background:#EF4444;
}
#tnd-filtros-backdrop { display:none; }
.tnd-filtros-sheet-header { display:none; }
@media (min-width:900px) {
  .tnd-filtros-btn-mobile { display:none; } /* en PC no hace falta el botón, los selects ya están visibles */
}
@media (max-width:899px) {
  #tnd-filtros-controles { display:none; }
  #tnd-filtros-controles.abierto {
    display:block; position:fixed; left:0; right:0; bottom:0;
    background:#fff; border-radius:16px 16px 0 0;
    padding:1.25rem 1rem calc(1.5rem + env(safe-area-inset-bottom, 0px));
    max-height:80dvh; overflow-y:auto; z-index:1001;
    box-shadow:0 -4px 24px rgba(0,0,0,.15);
  }
  #tnd-filtros-controles.abierto .tnd-filtros-sheet-header {
    display:flex; justify-content:space-between; align-items:center;
    margin-bottom:.5rem; font-size:.95rem;
  }
  .tnd-filtros-cerrar {
    background:#f3f4f6; border:none; border-radius:8px;
    width:28px; height:28px; font-size:.9rem; cursor:pointer;
  }
  #tnd-filtros-backdrop.abierto {
    display:block; position:fixed; inset:0; background:rgba(0,0,0,.4); z-index:1000;
  }
}
</style>

<div class="tnd-bg-pattern" aria-hidden="true">
  <span style="left:4%;top:3%;transform:rotate(-12deg)">🛒</span>
  <span style="left:22%;top:9%;transform:rotate(8deg)">🍎</span>
  <span style="left:42%;top:2%;transform:rotate(-6deg)">🥤</span>
  <span style="left:63%;top:8%;transform:rotate(14deg)">📦</span>
  <span style="left:84%;top:4%;transform:rotate(-10deg)">🧃</span>
  <span style="left:8%;top:18%;transform:rotate(10deg)">🍫</span>
  <span style="left:32%;top:22%;transform:rotate(-8deg)">🧴</span>
  <span style="left:53%;top:17%;transform:rotate(6deg)">🥖</span>
  <span style="left:74%;top:21%;transform:rotate(-14deg)">🛒</span>
  <span style="left:93%;top:16%;transform:rotate(9deg)">🍎</span>
  <span style="left:2%;top:33%;transform:rotate(-9deg)">🥤</span>
  <span style="left:24%;top:37%;transform:rotate(12deg)">📦</span>
  <span style="left:45%;top:32%;transform:rotate(-6deg)">🧃</span>
  <span style="left:66%;top:36%;transform:rotate(8deg)">🍫</span>
  <span style="left:87%;top:31%;transform:rotate(-11deg)">🧴</span>
  <span style="left:12%;top:48%;transform:rotate(7deg)">🥖</span>
  <span style="left:34%;top:52%;transform:rotate(-13deg)">🛒</span>
  <span style="left:56%;top:47%;transform:rotate(10deg)">🍎</span>
  <span style="left:77%;top:51%;transform:rotate(-7deg)">🥤</span>
  <span style="left:5%;top:63%;transform:rotate(11deg)">📦</span>
  <span style="left:27%;top:67%;transform:rotate(-9deg)">🧃</span>
  <span style="left:49%;top:62%;transform:rotate(13deg)">🍫</span>
  <span style="left:70%;top:66%;transform:rotate(-6deg)">🧴</span>
  <span style="left:91%;top:61%;transform:rotate(8deg)">🥖</span>
  <span style="left:16%;top:78%;transform:rotate(-12deg)">🛒</span>
  <span style="left:38%;top:82%;transform:rotate(9deg)">🍎</span>
  <span style="left:59%;top:77%;transform:rotate(-8deg)">🥤</span>
  <span style="left:80%;top:81%;transform:rotate(14deg)">📦</span>
  <span style="left:9%;top:93%;transform:rotate(-10deg)">🧃</span>
  <span style="left:44%;top:95%;transform:rotate(7deg)">🍫</span>
  <span style="left:68%;top:92%;transform:rotate(-13deg)">🧴</span>
  <span style="left:95%;top:94%;transform:rotate(6deg)">🥖</span>
</div>
<div id="tnd-recaptcha-container"></div>
<div class="tnd-header">
  <div class="tnd-brand" onclick="_tndIrHome()" style="cursor:pointer"><img src="${_LOGO_B64}" alt="Aleze" style="width:28px;height:28px;border-radius:6px;vertical-align:middle;margin-right:6px"> ${nombre}</div>
  <div style="display:flex;gap:.5rem;align-items:center">
    <span id="sync-badge-tienda" style="display:none;align-items:center;gap:.2rem;background:#EDE9FE;border-radius:12px;padding:.15rem .4rem;font-size:.66rem;color:#7C3AED;white-space:nowrap;flex-shrink:0"></span>
    <button class="tnd-cart-btn tnd-puntos-btn" onclick="tndAbrirMisPuntos()" style="padding:.5rem .75rem">⭐${(() => {
      const _cidHeader = tndGetClienteIdReal();
      return _cidHeader ? ' ' + Math.floor(estadoFidelizacion(_cidHeader).saldo) : '';
    })()}</button>
    <button class="tnd-cart-btn" onclick="tndAbrirCarrito()">
      🛒 <span class="tnd-cart-label">Carrito</span>
      <span class="tnd-cart-count" id="tnd-cart-count">0</span>
    </button>
  </div>
</div>

<div class="tnd-main">
  <div id="tnd-search-sticky-wrap">
    <div class="tnd-search-bar">
      <span>🔍</span>
      <input type="text" id="tnd-search" placeholder="Buscar producto..." oninput="tndBuscarDesdeHome()" />
    </div>
  </div>
<div class="tnd-cats" id="tnd-cats" style="display:none;position:relative">
    <button type="button" class="tnd-arrow tnd-arrow-left" onclick="_scrollRielCats('tnd-cats-riel',-1)" aria-label="Categorías anteriores">‹</button>
    <div id="tnd-cats-riel" style="display:flex;gap:.4rem;flex-wrap:nowrap;overflow-x:auto;scrollbar-width:none;-webkit-overflow-scrolling:touch"></div>
    <button type="button" class="tnd-arrow tnd-arrow-right" onclick="_scrollRielCats('tnd-cats-riel',1)" aria-label="Categorías siguientes">›</button>
  </div>
  <div id="tnd-filtros-btn-wrap" style="display:none">
    <button type="button" class="tnd-filtros-btn-mobile" onclick="_tndAbrirFiltrosMovil()">
      ⚙️ Filtros y orden<span id="tnd-filtros-badge" class="tnd-filtros-badge" style="display:none"></span>
    </button>
  </div>
  <div id="tnd-filtros-backdrop" onclick="_tndCerrarFiltrosMovil()"></div>
  <div id="tnd-filtros-controles">
    <div class="tnd-filtros-sheet-header">
      <strong>Filtros y orden</strong>
      <button type="button" class="tnd-filtros-cerrar" onclick="_tndCerrarFiltrosMovil()" aria-label="Cerrar filtros">✕</button>
    </div>
    <div id="tnd-filtros-fila" style="display:flex;gap:.5rem;flex-wrap:wrap;margin-top:.4rem;margin-bottom:1.25rem">
      <div id="tnd-marcas" style="display:none">
        <select id="tnd-marca-select" class="form-control" style="width:auto;font-size:.8rem;padding:.4rem .6rem" onchange="tndSetMarca(this.value)"></select>
      </div>
      <div id="tnd-precios" style="display:none">
        <select id="tnd-precio-select" class="form-control" style="width:auto;font-size:.8rem;padding:.4rem .6rem" onchange="_tndOnChangePrecioSelect(this.value)"></select>
      </div>
    </div>
    <div id="tnd-orden-wrap" style="display:none;margin-bottom:.75rem">
      <select id="tnd-orden" class="form-control" style="width:auto;font-size:.8rem;padding:.4rem .6rem" onchange="tndFiltrar()">
        <option value="">Ordenar por...</option>
        <option value="precio-asc">Precio: menor a mayor</option>
        <option value="precio-desc">Precio: mayor a menor</option>
        <option value="recientes">Más recientes</option>
      </select>
    </div>
  </div>
  <div class="tnd-grid" id="tnd-grid"></div>
</div>
<div id="tnd-toast">✅ <span id="tnd-toast-msg"></span></div>
<!-- WhatsApp flotante (solo desktop, sin bottom bar) — icono generico de burbuja de chat en
     el verde de marca, no el logo oficial (protegido como marca registrada de Meta). -->
<a href="https://wa.me/51${waNum}" target="_blank" id="tnd-wa-fab" aria-label="Escríbenos por WhatsApp">
  <svg viewBox="0 0 24 24" width="24" height="24" fill="white"><path d="M6.62 10.79c1.44 2.83 3.76 5.14 6.59 6.59l2.2-2.2c.27-.27.67-.36 1.02-.24 1.12.37 2.33.57 3.57.57.55 0 1 .45 1 1V20c0 .55-.45 1-1 1-9.39 0-17-7.61-17-17 0-.55.45-1 1-1h3.5c.55 0 1 .45 1 1 0 1.25.2 2.45.57 3.57.11.35.03.74-.25 1.02l-2.2 2.2z"/></svg>
</a>
<!-- Barra de navegación inferior fija -->
<nav id="tnd-bottombar">
  <button type="button" class="tnd-bb-item ${_tndVista==='home'?'active':''}" onclick="_tndIrHome()">
    <span class="tnd-bb-icon">🏠</span><span class="tnd-bb-label">Inicio</span>
  </button>
  <button type="button" class="tnd-bb-item ${_tndVista==='catalogo'?'active':''}" onclick="tndSetCat('')">
    <span class="tnd-bb-icon">📦</span><span class="tnd-bb-label">Catálogo</span>
  </button>
  <button type="button" class="tnd-bb-item" onclick="tndAbrirMisPuntos()">
    <span class="tnd-bb-icon">⭐</span><span class="tnd-bb-label">Puntos</span>
  </button>
  <a href="https://wa.me/51${waNum}" target="_blank" class="tnd-bb-item" style="text-decoration:none">
    <span class="tnd-bb-icon" style="color:#25D366"><svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor" style="vertical-align:-3px"><path d="M6.62 10.79c1.44 2.83 3.76 5.14 6.59 6.59l2.2-2.2c.27-.27.67-.36 1.02-.24 1.12.37 2.33.57 3.57.57.55 0 1 .45 1 1V20c0 .55-.45 1-1 1-9.39 0-17-7.61-17-17 0-.55.45-1 1-1h3.5c.55 0 1 .45 1 1 0 1.25.2 2.45.57 3.57.11.35.03.74-.25 1.02l-2.2 2.2z"/></svg></span><span class="tnd-bb-label">WhatsApp</span>
  </a>
</nav>
<!-- Panel lateral (carrito / checkout) -->
<div class="tnd-panel-overlay" id="tnd-overlay" onclick="tndCerrarPanel()"></div>
<div class="tnd-panel" id="tnd-panel">
  <div class="tnd-panel-header">
    <h3 id="tnd-panel-titulo">🛒 Tu carrito</h3>
    <button class="tnd-panel-close" onclick="tndCerrarPanel()">✕</button>
  </div>
  <div class="tnd-panel-body" id="tnd-panel-body"></div>
  <div class="tnd-panel-footer" id="tnd-panel-footer"></div>
</div>
`;

 // Mostrar home o catálogo según _tndVista
  if (_tndVista === 'home') {
    _tndRenderHome();
  } else {
    tndRenderCats();
    tndFiltrar();
  }
  } catch(e) {
    const tel = document.getElementById('tienda-publica');
    if (tel) tel.innerHTML = '<div style="padding:2rem;text-align:center;font-family:sans-serif"><p style="font-size:1.2rem">🛒 ' + (DB.config&&DB.config.nombre||'Tienda Aleze') + '</p><p style="color:#6B7280;margin-top:0.5rem">Cargando catálogo...</p><button onclick="_renderTienda()" style="margin-top:1rem;padding:.6rem 1.5rem;background:#7C3AED;color:white;border:none;border-radius:8px;cursor:pointer">🔄 Reintentar</button></div>';
    console.warn('_renderTienda error:', e);
  }
}
let _tndCatActiva = '';
let _tndMarcaActiva = '';
let _tndRangoPrecioActivo = null; // {min, max} o null
let _tndVista = 'home'; // 'home' | 'catalogo'
// ── Iconos ilustrados a medida por categoria, con su propio color — reemplazan el emoji
// generico. Se empareja por palabra clave normalizada (sin tildes, minuscula) contra el
// nombre real de la categoria, no por coincidencia exacta — asi resiste variaciones menores
// de tipeo sin romper el emparejamiento. Si ninguna palabra clave coincide (categoria nueva
// que todavia no está en esta lista), cae de vuelta al emoji/imagen normal, nunca se rompe.
const _TND_CAT_ICONOS = [
  { kw: ['confiteria','snack'], color: '#C026D3', svg: '<rect x="5" y="7" width="14" height="10" rx="1.5"/><line x1="9" y1="7.5" x2="9" y2="16.5" stroke="#C026D3" stroke-width="1.2"/><line x1="12" y1="7.5" x2="12" y2="16.5" stroke="#C026D3" stroke-width="1.2"/><line x1="15" y1="7.5" x2="15" y2="16.5" stroke="#C026D3" stroke-width="1.2"/><line x1="5.5" y1="12" x2="18.5" y2="12" stroke="#C026D3" stroke-width="1"/>' },
  { kw: ['gaseosa'], color: '#4F46E5', svg: '<path d="M11 2h2v3.2c1.6.7 2.5 1.8 2.5 3.3 0 1.2-.6 1.7-.6 2.9 0 1.6 1.6 2.3 1.6 5.1 0 2.5-1.7 3.5-4.5 3.5s-4.5-1-4.5-3.5c0-2.8 1.6-3.5 1.6-5.1 0-1.2-.6-1.7-.6-2.9 0-1.5.9-2.6 2.5-3.3z"/>' },
  { kw: ['alcoholica','cigarro','licor'], color: '#4C1D95', svg: '<path d="M7 2h10l-1.2 9.5A4 4 0 0 1 12 15a4 4 0 0 1-3.8-3.5z"/><rect x="11" y="15" width="2" height="6"/><rect x="8" y="21" width="8" height="1.5" rx="0.7"/>' },
  { kw: ['abarrote'], color: '#7E22CE', svg: '<rect x="5" y="7" width="14" height="13" rx="1"/><rect x="4.5" y="5" width="15" height="2.6" rx="1"/>' },
  { kw: ['lacteo','embutido','huevo'], color: '#A855F7', svg: '<ellipse cx="9" cy="14.5" rx="4.6" ry="6.2"/><ellipse cx="15.5" cy="11.5" rx="3.8" ry="5"/>' },
  { kw: ['cuidado personal'], color: '#6D28D9', svg: '<rect x="9" y="6" width="6" height="15" rx="2"/><rect x="10" y="2" width="4" height="4" rx="1"/>' },
  { kw: ['limpieza'], color: '#6366F1', svg: '<rect x="7" y="9" width="7" height="13" rx="1.5"/><rect x="9" y="4" width="3" height="5"/><path d="M12 5h6a1 1 0 0 1 1 1v2h-7z"/><rect x="18" y="6.5" width="3" height="1.4" rx="0.7"/>' },
  { kw: ['fruta','verdura'], color: '#8B5CF6', svg: '<path d="M12 8c-4 0-7 3-7 7a7 7 0 0 0 14 0c0-4-3-7-7-7z"/><path d="M12 8V4" stroke="white" stroke-width="1.6"/><path d="M12 4c1.5-1.5 3-1.5 4-1" fill="none" stroke="white" stroke-width="1.6"/>' },
  { kw: ['mascota'], color: '#9333EA', svg: '<ellipse cx="12" cy="16" rx="5.5" ry="4.5"/><circle cx="7" cy="8" r="2"/><circle cx="12" cy="6" r="2"/><circle cx="17" cy="8" r="2"/><circle cx="19.5" cy="12" r="1.6"/>' },
  { kw: ['vestuario','calzado','ropa'], color: '#5B21B6', svg: '<path d="M8 3L3 6l2 3 2-1v13h10V8l2 1 2-3-5-3-2 2h-4z"/>' },
  { kw: ['medicamento','medicina'], color: '#86198F', svg: '<rect x="3" y="6" width="18" height="12" rx="2"/><circle cx="7.5" cy="10" r="1.3" fill="#86198F"/><circle cx="12" cy="10" r="1.3" fill="#86198F"/><circle cx="16.5" cy="10" r="1.3" fill="#86198F"/><circle cx="7.5" cy="14" r="1.3" fill="#86198F"/><circle cx="12" cy="14" r="1.3" fill="#86198F"/><circle cx="16.5" cy="14" r="1.3" fill="#86198F"/>' },
  { kw: ['libreria','bazar'], color: '#7C3AED', svg: '<rect x="8" y="10" width="8" height="11" rx="2.5"/><rect x="10" y="6.5" width="4" height="4"/><rect x="9" y="3" width="6" height="3" rx="1"/>' },
  { kw: ['novedad','campana','campaña'], color: '#A78BFA', svg: '<rect x="4" y="10" width="16" height="11" rx="1"/><rect x="4" y="7" width="16" height="4" rx="1"/><rect x="11" y="7" width="2" height="14" fill="#A78BFA"/><path d="M12 7c-2-3-6-2-5 0s5 0 5 0zM12 7c2-3 6-2 5 0s-5 0-5 0z"/>' }
];
function _tndCatIcono(nombre) {
  const n = _norm(nombre||'');
  return _TND_CAT_ICONOS.find(x => x.kw.some(k => n.includes(k))) || null;
}

function _tndRenderHome() {
  const cfg   = DB.config || {};
  const waNum = (cfg.whatsappTienda || '980037284').replace(/\D/g,'');
  const grid  = document.getElementById('tnd-grid');
  const cats  = document.getElementById('tnd-cats');
  const back  = document.getElementById('tnd-back-home');
  if (!grid) return;
  grid.style.cssText = 'display:block';
  if (cats) cats.style.display = 'none';
  const _marcasHome = document.getElementById('tnd-marcas'); if (_marcasHome) _marcasHome.style.display = 'none';
  const _preciosHome = document.getElementById('tnd-precios'); if (_preciosHome) _preciosHome.style.display = 'none';
  if (back) back.style.display = 'none';
  // ── Banner (carrusel real si hay 2+, uno solo si hay 1, gradiente de marca si no hay ninguno) ──
  // Migracion defensiva: si el admin todavia no abrio Configuracion desde que se paso a
  // carrusel, cfg.banners puede no existir aunque cfg.bannerUrl (el banner unico viejo) si —
  // sin esto, ese banner desaparecia de tienda publica hasta que alguien entrara a guardar la
  // configuracion una vez.
  const _banners = (cfg.banners && cfg.banners.length) ? cfg.banners
    : (cfg.bannerUrl ? [{ id: 'legacy', url: cfg.bannerUrl, link: cfg.bannerLink || '' }] : []);
  let bannerHtml;
  if (cfg.bannerVisible !== false && _banners.length) {
    bannerHtml = `<div class="tnd-banner-carousel">
      ${_banners.length > 1 ? `<button type="button" class="tnd-arrow tnd-arrow-left" onclick="_scrollRielCats('tnd-banner-track',-1)" aria-label="Banner anterior">‹</button>` : ''}
  <div class="tnd-banner-track" id="tnd-banner-track">
        ${_banners.map(b => `<div class="tnd-banner-slide" ${b.link ? `onclick="window.open('${b.link}','_blank')" style="cursor:pointer"` : ''}><picture>${b.urlDesktop ? `<source media="(min-width:900px)" srcset="${b.urlDesktop}">` : ''}<img src="${b.url}" alt="Banner"></picture></div>`).join('')}
      </div>
      ${_banners.length > 1 ? `<button type="button" class="tnd-arrow tnd-arrow-right" onclick="_scrollRielCats('tnd-banner-track',1)" aria-label="Banner siguiente">›</button>` : ''}
      ${_banners.length > 1 ? `<div class="tnd-banner-dots" id="tnd-banner-dots">${_banners.map((_,i) => `<span class="tnd-banner-dot${i===0?' active':''}"></span>`).join('')}</div>` : ''}
    </div>`;
  } else {
    bannerHtml = `<div style="background:linear-gradient(135deg,#5B21B6,#7C3AED);border-radius:14px;padding:1.5rem 1.25rem;margin-bottom:1.5rem;text-align:center"><div style="font-size:1.4rem;font-weight:900;color:#fff;margin-bottom:.3rem">${cfg.nombre||'Tienda Aleze'}</div><div style="font-size:.95rem;color:rgba(255,255,255,.85)">🛒 ${cfg.eslogan||'Todo lo que necesitas, cerca de ti'} 📍</div></div>`;
  }

  // Tarjeta de producto para los rieles de scroll (promos / recien agregados) — mismo diseño
  // en ambas, para que la pagina se sienta de una sola pieza, no secciones inconexas.
  const _tarjetaProdRail = (p, _esNuevo) => {
    const _promoRail = _getPromoTienda(p);
    const _esCantidadRail = _promoRail && (_promoRail.tipo === '2x1' || _promoRail.tipo === '3x2');
    // Para un combo, p.precio YA es el precio de oferta (se establecio asi al crearlo) —
    // comparar contra si mismo siempre daria 0% de descuento. El precio de referencia real
    // para calcular el ahorro es precioOrig de la promocion (la suma de los productos sueltos).
    const _precioRefRail = p.esCombo ? (_promoRail && _promoRail.precioOrig) : p.precio;
    const _pctDesc = (!_esCantidadRail && _promoRail && _promoRail.precioPromo && _precioRefRail && _promoRail.precioPromo < _precioRefRail)
      ? Math.round((1 - _promoRail.precioPromo / _precioRefRail) * 100) : 0;
    const _precioMostrar = (p.esCombo || _esCantidadRail) ? p.precio : (_pctDesc > 0 ? _promoRail.precioPromo : p.precio);
   const _badgeEsquina = _esCantidadRail ? `<div style="position:absolute;top:6px;left:6px;background:#EF4444;color:#fff;font-size:.76rem;font-weight:800;padding:.22rem .5rem;border-radius:5px;z-index:1;box-shadow:0 1px 4px rgba(239,68,68,.4)">${_promoRail.tipo}</div>`
      : (_pctDesc > 0 ? `<div style="position:absolute;top:6px;left:6px;background:#EF4444;color:#fff;font-size:.76rem;font-weight:800;padding:.22rem .5rem;border-radius:5px;z-index:1;box-shadow:0 1px 4px rgba(239,68,68,.4)">-${_pctDesc}%</div>`
      : (_esNuevo ? `<div style="position:absolute;top:6px;left:6px;background:#10B981;color:#fff;font-size:.65rem;font-weight:800;padding:.15rem .4rem;border-radius:5px;z-index:1">🆕 Nuevo</div>` : ''));
    const _badgeDetalleRail = p.tieneDetalle ? `<div class="tnd-badge-detalle" style="position:absolute;top:6px;right:6px;z-index:1">🔍 Detalle</div>` : '';
    const _botonAddRail = !((p.esCombo && p.promoActiva === false) || stockTotal(p) <= 0)
      ? `<button type="button" onclick="event.stopPropagation();tndAgregarCarrito(${p.id})" aria-label="Agregar ${p.nombre} al carrito" style="position:absolute;top:96px;right:6px;z-index:2;background:#7C3AED;color:#fff;border:none;border-radius:50%;width:26px;height:26px;font-size:1rem;font-weight:700;line-height:1;display:flex;align-items:center;justify-content:center;cursor:pointer;box-shadow:0 2px 6px rgba(124,58,237,.4)">+</button>`
      : '';
    return `<div class="tnd-rail-card" onclick="${p.tieneDetalle ? `tndVerDetalle(${p.id})` : `tndAgregarCarrito(${p.id})`}" style="cursor:pointer;flex-shrink:0;width:140px;background:${_pctDesc>0?'#FFF5F5':'#fff'};border-radius:12px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,.08);position:relative;${_pctDesc>0?'border:2px solid #FCA5A5':''}">${_badgeEsquina}${_badgeDetalleRail}${_botonAddRail}${p.imagen?`<img src="${p.imagen}" style="width:100%;height:120px;object-fit:contain;background:#F3F4F6">`:`<div style="height:120px;background:#f3f4f6;display:flex;align-items:center;justify-content:center;font-size:2rem">🏷️</div>`}<div style="padding:.5rem"><div style="font-size:.78rem;font-weight:700;color:#1f2937;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${p.nombre}</div><div style="display:flex;align-items:baseline;gap:.35rem">${_pctDesc > 0 ? `<span style="font-size:.68rem;color:#6b7280;text-decoration:line-through">S/ ${(+_precioRefRail).toFixed(2)}</span>` : ''}<span style="font-size:.82rem;font-weight:900;color:#7C3AED">S/ ${(+_precioMostrar).toFixed(2)}</span></div></div></div>`;
  };

  const hoy = new Date().toISOString().slice(0,10);
const promsActivas = (DB.promociones||[]).filter(p => p.activa && p.hasta >= hoy && _promoAplicaSede(p, 'principal'));
const prodsPromo = promsActivas.map(pr => (DB.productos||[]).find(p => p.id === (pr.packProdId || pr.prod1) && stockTotal(p) > 0 && !(p.esCombo && p.promoActiva === false))).filter(Boolean);
  const promosHtml = prodsPromo.length ? `<div class="tnd-section-title">🔥 Promociones activas</div><div class="tnd-scroll-wrap"><button type="button" class="tnd-arrow tnd-arrow-left" onclick="_scrollRielCats('tnd-riel-promos',-1)" aria-label="Anteriores">‹</button><div class="tnd-scroll-row" id="tnd-riel-promos">${prodsPromo.slice(0,10).map(p => _tarjetaProdRail(p, false)).join('')}</div><button type="button" class="tnd-arrow tnd-arrow-right" onclick="_scrollRielCats('tnd-riel-promos',1)" aria-label="Siguientes">›</button></div>` : '';

  // Categorias como riel de burbujas — reemplaza las fotos-collage con texto incrustado (ver
  // nota mas abajo) por circulos de color + emoji: mas liviano, mas consistente, y con scroll
  // horizontal real en vez de una grilla vertical estatica.
  const cats2 = (DB.categorias||[]).filter(c => c.nombre && !c.oculta);
  const catsHtml = cats2.length ? `<div class="tnd-section-title">📦 Categorías</div><div class="tnd-scroll-wrap"><button type="button" class="tnd-arrow tnd-arrow-left" onclick="_scrollRielCats('tnd-riel-cats',-1)" aria-label="Anteriores">‹</button><div class="tnd-scroll-row" id="tnd-riel-cats">${cats2.map(c => {
  
// Foto real de la categoría (subida en Configuración) tiene prioridad — el ícono de
    // color SVG queda como respaldo mientras esa categoría no tenga foto propia cargada.
    const _catIco = _tndCatIcono(c.nombre);
    const _catBg = c.imagen ? '#F3F4F6' : (_catIco ? _catIco.color : 'linear-gradient(135deg,#5B21B6,#7C3AED)');
    const _catVisual = c.imagen ? `<img src="${c.imagen}" alt="${c.nombre}">` : (_catIco ? `<svg width="30" height="30" viewBox="0 0 24 24" fill="white">${_catIco.svg}</svg>` : (c.emoji || '📦'));
    return `<div class="tnd-cat-bubble" onclick="tndSetCat(${c.id})">
      <div class="tnd-cat-circle" style="background:${_catBg}">${_catVisual}</div>
      <div class="tnd-cat-label">${c.nombre}</div>
    </div>`;
  }).join('')}</div><button type="button" class="tnd-arrow tnd-arrow-right" onclick="_scrollRielCats('tnd-riel-cats',1)" aria-label="Siguientes">›</button></div>` : '';

  // Recien agregados — dato real (ordenado por id, que ya incluye el momento de creacion),
  // no una seccion inventada. Le da a la home algo que cambie con el tiempo, ademas de las
  // categorias fijas — sensacion de tienda con movimiento, no un catalogo estatico.
  const recientes = (DB.productos||[]).filter(p => stockTotal(p) > 0).slice().sort((a,b) => b.id - a.id).slice(0, 10);
  const recientesHtml = recientes.length ? `<div class="tnd-section-title">✨ Recién agregados</div><div class="tnd-scroll-wrap"><button type="button" class="tnd-arrow tnd-arrow-left" onclick="_scrollRielCats('tnd-riel-recientes',-1)" aria-label="Anteriores">‹</button><div class="tnd-scroll-row" id="tnd-riel-recientes">${recientes.map(p => _tarjetaProdRail(p, true)).join('')}</div><button type="button" class="tnd-arrow tnd-arrow-right" onclick="_scrollRielCats('tnd-riel-recientes',1)" aria-label="Siguientes">›</button></div>` : '';

  const servicios = (cfg.serviciosWa||[]).filter(s => s.visible);
  // Migración defensiva: mismo criterio que cfg.banners más arriba.
  const _svcBanners = (cfg.serviciosBanners && cfg.serviciosBanners.length) ? cfg.serviciosBanners
    : (cfg.serviciosBannerUrl ? [{ id: 'legacy', url: cfg.serviciosBannerUrl }] : []);
  const _waLinkServicios = `https://wa.me/51${waNum}?text=${encodeURIComponent('Hola, quisiera información sobre sus servicios')}`;
  const serviciosHtml = _svcBanners.length
    ? `<div style="margin-bottom:1.5rem">
        <div class="tnd-section-title">⚡ Servicios rápidos</div>
        <div class="tnd-banner-carousel" style="margin-bottom:0">
          ${_svcBanners.length > 1 ? `<button type="button" class="tnd-arrow tnd-arrow-left" onclick="_scrollRielCats('tnd-servicios-track',-1)" aria-label="Anterior">‹</button>` : ''}
          <div class="tnd-banner-track" id="tnd-servicios-track">
            ${_svcBanners.map(b => `<a href="${_waLinkServicios}" target="_blank" class="tnd-banner-slide" style="text-decoration:none"><img src="${b.url}" alt="Servicios"></a>`).join('')}
          </div>
          ${_svcBanners.length > 1 ? `<button type="button" class="tnd-arrow tnd-arrow-right" onclick="_scrollRielCats('tnd-servicios-track',1)" aria-label="Siguiente">›</button>` : ''}
          ${_svcBanners.length > 1 ? `<div class="tnd-banner-dots" id="tnd-servicios-dots">${_svcBanners.map((_,i) => `<span class="tnd-banner-dot${i===0?' active':''}"></span>`).join('')}</div>` : ''}
        </div>
       </div>`
    : servicios.length ? `<div style="margin-bottom:1.5rem"><div class="tnd-section-title">⚡ Servicios rápidos</div><div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(160px,1fr));gap:.6rem">${servicios.map(s=>`<a href="https://wa.me/51${waNum}?text=${encodeURIComponent('Hola, quisiera: '+s.nombre)}" target="_blank" class="tnd-rail-card" style="display:flex;align-items:center;gap:.6rem;background:#fff;border-radius:12px;padding:.75rem;box-shadow:0 2px 6px rgba(0,0,0,.07);text-decoration:none;color:#1f2937"><span style="font-size:1.4rem">${s.emoji}</span><span style="font-size:.82rem;font-weight:700">${s.nombre}</span></a>`).join('')}</div></div>` : '';
  const tiendas = (cfg.tiendasExternas||[]).filter(t => t.visible && t.url);
const tiendasHtml = tiendas.length ? `<div style="margin-bottom:1.5rem"><div class="tnd-section-title" style="margin-bottom:.5rem">🛍️ Electrodomésticos y más</div>
      ${cfg.tiendasTexto?`<div style="font-size:.8rem;color:#6b7280;margin-bottom:.75rem;line-height:1.4">${cfg.tiendasTexto}</div>`:''}
      <div class="tnd-scroll-wrap"><button type="button" class="tnd-arrow tnd-arrow-left" onclick="_scrollRielCats('tnd-riel-tiendas',-1)" aria-label="Tiendas anteriores">‹</button><div class="tnd-scroll-row" id="tnd-riel-tiendas">${tiendas.map(t=>`<div class="tnd-rail-card" style="flex-shrink:0;width:160px;background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,.08)"><a href="${t.url}" target="_blank" style="display:block;text-decoration:none">${t.imagen?`<img src="${t.imagen}" style="width:100%;height:90px;object-fit:cover;display:block">`:`<div style="height:90px;background:#f3f4f6;display:flex;align-items:center;justify-content:center;font-size:.9rem;font-weight:700;color:#374151">${t.nombre}</div>`}</a>${t.waCatalogo?`<a href="https://wa.me/51${waNum}?text=${encodeURIComponent('Hola, quisiera hacer un pedido del catálogo '+t.nombre)}" target="_blank" style="display:block;text-align:center;padding:.5rem;font-size:.78rem;font-weight:700;color:#25D366;text-decoration:none;border-top:1px solid #f3f4f6">📲 Pedir por WhatsApp</a>`:''}</div>`).join('')}</div><button type="button" class="tnd-arrow tnd-arrow-right" onclick="_scrollRielCats('tnd-riel-tiendas',1)" aria-label="Tiendas siguientes">›</button></div></div>` : '';

grid.innerHTML = bannerHtml + catsHtml + promosHtml + recientesHtml + serviciosHtml + tiendasHtml
    + `<button id="tnd-ver-catalogo-btn" onclick="tndSetCat('')" style="width:100%;margin-top:.25rem;margin-bottom:1rem;padding:.75rem;background:#fff;border:1.5px solid #e5e7eb;border-radius:10px;font-weight:700;font-size:.88rem;cursor:pointer;color:#374151">Ver todo el catálogo →</button>`;
  _tndIniciarCarruselBanner(_banners.length);
  _tndIniciarCarruselServicios(_svcBanners.length);
}
// Auto-avance del carrusel de banners — se pausa solo (no reinicia el timer) si el usuario
// desliza a mano, el proximo avance automatico sigue el ritmo normal desde ahi. Los puntos se
// actualizan tanto por el auto-avance como por el deslizado manual, mismo mecanismo.
function _tndIniciarCarrusel(trackId, dotsSelector, cantidad, intervalVarName, ritmoMs) {
  clearInterval(window[intervalVarName]);
  if (cantidad <= 1) return;
  let idx = 0;
  const track = document.getElementById(trackId);
  if (!track) return;
  window[intervalVarName] = setInterval(() => {
    const t = document.getElementById(trackId);
    if (!t) { clearInterval(window[intervalVarName]); return; }
    idx = (idx + 1) % cantidad;
    t.scrollTo({ left: t.clientWidth * idx, behavior: 'smooth' });
  }, ritmoMs);
  track.onscroll = () => {
    idx = Math.round(track.scrollLeft / track.clientWidth);
    document.querySelectorAll(dotsSelector).forEach((d,i) => d.classList.toggle('active', i===idx));
  };
}
function _tndIniciarCarruselBanner(cantidad) {
  _tndIniciarCarrusel('tnd-banner-track', '#tnd-banner-dots .tnd-banner-dot', cantidad, '_tndBannerInterval', 4500);
}
function _tndIniciarCarruselServicios(cantidad) {
  _tndIniciarCarrusel('tnd-servicios-track', '#tnd-servicios-dots .tnd-banner-dot', cantidad, '_tndServiciosInterval', 5200);
}
let _tndMetodo = 'Yape';
let _tndMasMetodos = false;
let _tndEntrega = 'recojo';
// Revalida stock real del SERVIDOR (nunca cache) justo antes de confirmar o pagar un pedido —
// el carrito persiste en localStorage y puede quedar abierto horas o dias, tiempo suficiente
// para que ese mismo stock se venda por otro lado (POS, otro cliente). Sin esto, un pedido
// podia confirmarse — o peor, pagarse en linea de forma irreversible — sin stock real de
// respaldo. Cubre tambien los componentes reales de un pack, no solo el producto combo.
async function _tndRevalidarStock() {
  if (!dbModular) return true; // sin conexion no se puede verificar — se deja pasar
  for (const item of _tiendaCart) {
    const p = DB.productos.find(x => x.id === item.prodId);
    if (!p) continue;
    if (p.esCombo && p.componentes) {
      for (const comp of p.componentes) {
        try {
          const snap = await getDocDelServidorM(docM(dbModular, 'productos', String(comp.prodId)));
          const stockReal = snap.exists() ? (snap.data().stock || 0) : 0;
          if (stockReal < (comp.cant || 1) * item.cant) {
            alert(`⚠️ "${p.nombre}" ya no tiene stock suficiente para armar este pack. Ajusta la cantidad en tu carrito e intenta de nuevo.`);
            return false;
          }
        } catch (e) { console.warn('No se pudo revalidar stock de componente ' + comp.prodId, e); }
      }
    } else {
      try {
        const snap = await getDocDelServidorM(docM(dbModular, 'productos', String(item.prodId)));
        const stockReal = snap.exists() ? (snap.data().stock || 0) : 0;
        if (stockReal < item.cant) {
          alert(`⚠️ "${item.nombre}" ya no tiene stock suficiente (quedan ${stockReal}). Ajusta la cantidad en tu carrito e intenta de nuevo.`);
          return false;
        }
      } catch (e) { console.warn('No se pudo revalidar stock de ' + item.prodId, e); }
    }
  }
  return true;
}
let _tndStep = 'cart'; // cart | datos | pago | confirmacion
// Total real del carrito de tienda publica, con descuentos de combo (2 productos distintos)
// y de cantidad (2x1/3x2 sobre el mismo producto) ya aplicados — mismo mecanismo que POS.
// Centralizado aca para que el carrito en vivo, el resumen, el envio del pedido y el pago en
// linea SIEMPRE calculen exactamente lo mismo, sin poder divergir entre si.
function _tndCalcularTotal() {
  const subtotal = _tiendaCart.reduce((s,i) => s+subtotalItemCarrito(i), 0);
  const combo = calcComboDescuento(_tiendaCart, 'principal');
  const cantidad = calcDescuentoCantidad(_tiendaCart, 'principal');
  const recargo = calcRecargoPorLimitePromo(_tiendaCart, 'principal');
  const descuento = combo.total + cantidad.total;
  return { subtotal, descuento, total: Math.max(0, subtotal - descuento + recargo.total), lineasCombo: combo.lineas, lineasCantidad: cantidad.lineas, lineasRecargo: recargo.lineas };
}

function tndRenderCats() {
  const el = document.getElementById('tnd-cats-riel');
  if (!el) return;
  const catPromo = (DB.categorias||[]).find(c => c.nombre === 'Promociones' && !c.oculta);
  const otrosCats = (DB.categorias||[]).filter(c => c.nombre !== 'Promociones' && !c.oculta);
  const catsOrdenadas = catPromo ? [catPromo, ...otrosCats] : otrosCats;
  el.innerHTML = `<span class="tnd-cat-tag active" onclick="tndSetCat('')">Todos</span>` +
    catsOrdenadas.map(c => `<span class="tnd-cat-tag" onclick="tndSetCat(${c.id})">${c.imagen ? `<img src="${c.imagen}" style="width:16px;height:16px;object-fit:cover;border-radius:3px;vertical-align:middle">` : c.emoji} ${c.nombre}</span>`).join('');
}

function tndBuscarDesdeHome() {
  const q = document.getElementById('tnd-search')?.value || '';
  if (q && _tndVista === 'home') {
    _tndVista = 'catalogo';
    _tndCatActiva = '';
    const back = document.getElementById('tnd-back-home');
    const cats = document.getElementById('tnd-cats');
    const ordenWrap = document.getElementById('tnd-orden-wrap');
    const filtrosBtnWrap = document.getElementById('tnd-filtros-btn-wrap');
    if (back) back.style.display = 'inline-flex';
    if (cats) cats.style.display = 'flex';
    if (ordenWrap) ordenWrap.style.display = 'block';
    if (filtrosBtnWrap) filtrosBtnWrap.style.display = 'block';
    tndRenderCats();
  }
  tndFiltrar();
}
function tndSetCat(id) {
  _tndCatActiva = id;
  if (_tndVista === 'home') {
    _tndVista = 'catalogo';
    const back = document.getElementById('tnd-back-home');
    const cats = document.getElementById('tnd-cats');
    const ordenWrap = document.getElementById('tnd-orden-wrap');
    const filtrosBtnWrap = document.getElementById('tnd-filtros-btn-wrap');
    if (back) back.style.display = 'inline-flex';
    if (cats) cats.style.display = 'flex';
    if (ordenWrap) ordenWrap.style.display = 'block';
    if (filtrosBtnWrap) filtrosBtnWrap.style.display = 'block';
    tndRenderCats();
    tndFiltrar();
  } else {
    document.querySelectorAll('.tnd-cat-tag').forEach(t => t.classList.remove('active'));
    const sel = id
      ? document.querySelector(`.tnd-cat-tag[onclick="tndSetCat(${id})"]`)
      : document.querySelector(`.tnd-cat-tag[onclick="tndSetCat('')"]`);
    if (sel) sel.classList.add('active');
    tndFiltrar();
  }
  _tndActualizarBottomBar();
}
function _tndIrHome() {
  _tndVista = 'home';
  _tndCatActiva = '';
  _tndMarcaActiva = '';
  _tndRangoPrecioActivo = null;
  const back = document.getElementById('tnd-back-home');
  const cats = document.getElementById('tnd-cats');
  const search = document.getElementById('tnd-search');
  const ordenWrap = document.getElementById('tnd-orden-wrap');
  const filtrosBtnWrap = document.getElementById('tnd-filtros-btn-wrap');
  if (back) back.style.display = 'none';
  if (cats) cats.style.display = 'none';
  const _marcasHome2 = document.getElementById('tnd-marcas'); if (_marcasHome2) _marcasHome2.style.display = 'none';
  const _preciosHome2 = document.getElementById('tnd-precios'); if (_preciosHome2) _preciosHome2.style.display = 'none';
  if (ordenWrap) ordenWrap.style.display = 'none';
  if (filtrosBtnWrap) filtrosBtnWrap.style.display = 'none';
  _tndCerrarFiltrosMovil(); // por si quedó abierta la hoja de filtros del celular al volver a Inicio
  if (search) search.value = '';
  _tndRenderHome();
  _tndActualizarBottomBar();
}

// ── Hoja de filtros en móvil (marca/precio/orden) — pedido explícito del usuario para reducir
// el espacio que ocupaban esos 3 selects en pantallas chicas (ver comentario CSS en styles.css,
// sección "FILTROS DE TIENDA PÚBLICA"). En PC no se usan estas 2 funciones — los selects quedan
// visibles inline como siempre, el botón que las dispara está oculto fuera de esa media query.
function _tndAbrirFiltrosMovil() {
  document.getElementById('tnd-filtros-controles')?.classList.add('abierto');
  document.getElementById('tnd-filtros-backdrop')?.classList.add('abierto');
}
function _tndCerrarFiltrosMovil() {
  document.getElementById('tnd-filtros-controles')?.classList.remove('abierto');
  document.getElementById('tnd-filtros-backdrop')?.classList.remove('abierto');
}
// Punto (rojo) sobre el botón "Filtros y orden" cuando hay algún filtro/orden activo — para que
// en móvil, con los selects colapsados dentro de la hoja, no sea invisible que hay un filtro
// aplicado. Se recalcula cada vez que tndFiltrar() corre (cualquier cambio de marca/precio/orden).
function _tndActualizarBadgeFiltros() {
  const badge = document.getElementById('tnd-filtros-badge');
  if (!badge) return;
  const ordenSel = document.getElementById('tnd-orden')?.value || '';
  badge.style.display = (_tndMarcaActiva || _tndRangoPrecioActivo || ordenSel) ? 'inline-block' : 'none';
}
function _tndActualizarBottomBar() {
  document.querySelectorAll('.tnd-bb-item').forEach((b,i) => b.classList.toggle('active', i === (_tndVista==='home'?0:1)));
}

// Redondea un precio a un numero "limpio" segun su magnitud (S/7.34 -> S/5 o S/10, nunca un
// decimal raro) — el paso de redondeo crece con la magnitud para que siga siendo un corte
// razonable tanto en un catalogo de a S/1-S/10 como en uno de a S/50-S/500.
function _tndRedondearPrecioBonito(n) {
  if (n < 10) return Math.round(n);
  if (n < 50) return Math.round(n / 5) * 5;
  if (n < 200) return Math.round(n / 10) * 10;
  return Math.round(n / 50) * 50;
}
// Riel de marcas — mismo patron visual y de interaccion que categorias. Se recalcula en cada
// filtrado (no es estatico como categorias) porque las marcas relevantes cambian segun la
// categoria/busqueda activa — nunca se muestran marcas que no tengan ningun producto visible
// en el contexto actual. Con menos de 2 marcas distintas no aporta nada elegir, se oculta.
function _tndRenderRielMarcas(prodsBase) {
  const wrap = document.getElementById('tnd-marcas');
  const sel = document.getElementById('tnd-marca-select');
  if (!wrap || !sel) return;
  const marcas = [...new Set(prodsBase.map(p => p.marca).filter(Boolean))].sort();
  if (_tndMarcaActiva && !marcas.includes(_tndMarcaActiva)) _tndMarcaActiva = ''; // ya no aplica a este contexto
  if (marcas.length < 2) { wrap.style.display = 'none'; return; }
  wrap.style.display = 'block';
  sel.innerHTML = `<option value="">Todas las marcas</option>` +
    marcas.map(m => `<option value="${escapeHtml(m)}">${escapeHtml(m)}</option>`).join('');
  sel.value = _tndMarcaActiva || '';
}
function tndSetMarca(marca) {
  _tndMarcaActiva = marca;
  tndFiltrar();
}
// Riel de rango de precio — 3 tramos calculados dinamicamente sobre el precio real minimo y
// maximo de lo que se esta viendo (nunca del catalogo entero), redondeados a numeros limpios.
// Rangos fijos ("Menos de S/5") no tendrian sentido en todas las categorias — una de
// productos caros quedaria toda en un solo tramo, inutil. Si el rango de precios visible es
// insignificante (todo cuesta casi lo mismo), se oculta — no aporta nada filtrar ahi.
function _tndRenderRielPrecios(prodsBase) {
  const wrap = document.getElementById('tnd-precios');
  const sel = document.getElementById('tnd-precio-select');
  if (!wrap || !sel) return;
  const precios = prodsBase.map(p => p.precio).filter(v => typeof v === 'number' && !isNaN(v));
  if (!precios.length) { wrap.style.display = 'none'; _tndRangoPrecioActivo = null; return; }
  const min = Math.min(...precios), max = Math.max(...precios);
  if (max - min < 1) { wrap.style.display = 'none'; _tndRangoPrecioActivo = null; return; }
  let corte1 = _tndRedondearPrecioBonito(min + (max - min) / 3);
  let corte2 = _tndRedondearPrecioBonito(min + (max - min) * 2 / 3);
  if (corte1 <= min) corte1 = Math.ceil(min) + 1;
  if (corte2 <= corte1) corte2 = corte1 + 1;
  if (corte2 >= max) corte2 = Math.floor(max) - 1;
  if (corte1 >= corte2 || corte1 <= min) { wrap.style.display = 'none'; _tndRangoPrecioActivo = null; return; } // rango muy chico para 3 tramos utiles
  const rangos = [
    { min: 0, max: corte1, etiqueta: `Menos de S/${corte1}` },
    { min: corte1, max: corte2, etiqueta: `S/${corte1} - S/${corte2}` },
    { min: corte2, max: Infinity, etiqueta: `Más de S/${corte2}` },
  ];
  if (_tndRangoPrecioActivo && !rangos.some(r => r.min === _tndRangoPrecioActivo.min && r.max === _tndRangoPrecioActivo.max)) {
    _tndRangoPrecioActivo = null; // ya no aplica a este contexto
  }
  wrap.style.display = 'block';
  sel.innerHTML = `<option value="">Todos los precios</option>` +
    rangos.map(r => `<option value="${r.min}|${r.max===Infinity?'inf':r.max}">${escapeHtml(r.etiqueta)}</option>`).join('');
  sel.value = _tndRangoPrecioActivo ? `${_tndRangoPrecioActivo.min}|${_tndRangoPrecioActivo.max===Infinity?'inf':_tndRangoPrecioActivo.max}` : '';
}
function tndSetRangoPrecio(min, max) {
  _tndRangoPrecioActivo = (min === null && max === null) ? null : { min: min || 0, max: max === null ? Infinity : max };
  tndFiltrar();
}
// El <select> de precio codifica el rango en el value como "min|max" (max="inf" para el
// tramo final sin techo) porque un <option value> solo puede llevar un string — a diferencia
// de los onclick de antes, que pasaban los numeros directo como argumentos de función.
function _tndOnChangePrecioSelect(v) {
  if (!v) { tndSetRangoPrecio(null, null); return; }
  const [minStr, maxStr] = v.split('|');
  tndSetRangoPrecio(parseFloat(minStr), maxStr === 'inf' ? null : parseFloat(maxStr));
}

function tndFiltrar() {
  const _gridEl = document.getElementById('tnd-grid');
  if (_gridEl) _gridEl.style.cssText = '';
  const buscar = (document.getElementById('tnd-search')?.value||'').toLowerCase();
  const hoy = today();
  // Al filtrar por "Promociones" (la categoria especial de los packs/combos), tambien se
  // incluyen productos individuales con descuento activo, aunque vivan en otra categoria real
  // — un descuento directo (ej. Papa a S/2.00) es tan "promocion" como un pack, no debe
  // quedar invisible en este filtro solo por no tener su propia categoria.
  const _catPromoActiva = _tndCatActiva && (DB.categorias||[]).find(c => c.id == _tndCatActiva && c.nombre === 'Promociones');
let prods = (DB.productos||[]).filter(p => {
    if (_tndCatActiva) {
      const _esDescuentoIndividual = _catPromoActiva && !p.esCombo && !!_getPromoTienda(p);
      if (p.cat != _tndCatActiva && !_esDescuentoIndividual) return false;
    }
  if (buscar && !_norm(p.nombre||'').includes(_norm(buscar))) return false;
    if (p.venc && p.venc < hoy) return false;
    if (p.esCombo && p.promoActiva === false) return false; // ocultar combos desactivados
    return true;
  });

  // ── Marca: el riel se calcula sobre la base ya filtrada por categoria+busqueda, ANTES de
  // aplicar el filtro de marca mismo — asi siempre muestra TODAS las marcas disponibles en
  // este contexto, permitiendo cambiar libremente entre ellas en vez de reducirse a una sola
  // opcion apenas se elige una. Se combina (AND) con categoria/busqueda, nunca las reemplaza.
  _tndRenderRielMarcas(prods);
  if (_tndMarcaActiva) prods = prods.filter(p => p.marca === _tndMarcaActiva);

  // ── Precio: el riel se calcula sobre categoria+busqueda+marca ya aplicados, para que los
  // rangos sean relevantes a lo que realmente se esta viendo en este momento (los precios
  // varian segun la marca elegida, no tendria sentido mostrar rangos de todo el catalogo).
  _tndRenderRielPrecios(prods);
  if (_tndRangoPrecioActivo) {
    const { min, max } = _tndRangoPrecioActivo;
    prods = prods.filter(p => p.precio >= min && p.precio <= max);
  }

  const _ordenSel = document.getElementById('tnd-orden')?.value || '';
  // Catálogo no estático: sin orden manual elegido, se mezcla — pero los destacados (combos
  // o con promo activa) siempre quedan primero. El mezclado se guarda en sessionStorage por
  // el ID de cada producto, así el orden se mantiene ESTABLE durante toda la visita (entrar a
  // un detalle y volver no reordena todo de nuevo) — recién cambia al cerrar y reabrir la
  // tienda (nueva sessionStorage).
if (!_ordenSel) {
    // "Agotado" real: mismo criterio que agotado/badge en el resto del catálogo — combo
    // desactivado, o stock <= 0 para producto normal.
    const _estaAgotado = p => p.esCombo ? (p.promoActiva === false) : stockTotal(p) <= 0;
    const destacados = prods.filter(p => !_estaAgotado(p) && (p.esCombo || !!_getPromoTienda(p)));
    const resto = prods.filter(p => !_estaAgotado(p) && !p.esCombo && !_getPromoTienda(p));
    const agotados = prods.filter(_estaAgotado);
    const claveSesion = 'tnd_orden_' + (_tndCatActiva || 'todos') + '_' + (buscar || '');
    let ordenGuardado = null;
    try { ordenGuardado = JSON.parse(sessionStorage.getItem(claveSesion) || 'null'); } catch(e) {}
    let restoOrdenado;
    if (ordenGuardado) {
      // Reconstruye el orden guardado (lista de IDs), agregando al final cualquier producto
      // nuevo que no estuviera en esa lista todavía (recién agregado durante la sesión).
      const porId = new Map(resto.map(p => [p.id, p]));
      restoOrdenado = ordenGuardado.map(id => porId.get(id)).filter(Boolean);
      resto.forEach(p => { if (!ordenGuardado.includes(p.id)) restoOrdenado.push(p); });
    } else {
      restoOrdenado = resto.slice();
      for (let i = restoOrdenado.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [restoOrdenado[i], restoOrdenado[j]] = [restoOrdenado[j], restoOrdenado[i]];
      }
      try { sessionStorage.setItem(claveSesion, JSON.stringify(restoOrdenado.map(p => p.id))); } catch(e) {}
    }
    // Agotados: siempre al final, sin mezclar con los que sí tienen stock — ordenados por
    // nombre para que al menos entre ellos no salten de posición en cada render.
    prods = [...destacados, ...restoOrdenado, ...agotados.slice().sort((a,b) => (a.nombre||'').localeCompare(b.nombre||''))];
  }
  if (_ordenSel === 'precio-asc') prods = prods.slice().sort((a,b) => a.precio - b.precio);
  else if (_ordenSel === 'precio-desc') prods = prods.slice().sort((a,b) => b.precio - a.precio);
  else if (_ordenSel === 'recientes') prods = prods.slice().sort((a,b) => b.id - a.id);

  const grid = document.getElementById('tnd-grid');
  if (!grid) return;
  grid.innerHTML = prods.map(p => {
    const agotado = (p.promoActiva === false) || stockTotal(p) <= 0;
    const cat = (DB.categorias||[]).find(c => c.id === p.cat);
   const icon = p.imagen
      ? `<img src="${p.imagen}" alt="${p.nombre}">`
      : cat?.imagen
        ? `<img src="${cat.imagen}" alt="${p.nombre}">`
        : `<span class="tnd-prod-icon-emoji">${cat?.emoji || '📦'}</span>`;
    const badge = _getStockBadge(p);
    const promo = _getPromoTienda(p);
    const precio = p.esCombo ? p.precio : (promo && promo.precioPromo ? promo.precioPromo : p.precio);
    // Para un combo, p.precio YA es el precio de oferta — comparar contra si mismo siempre
    // daria 0% de descuento. El precio de referencia real es precioOrig de la promocion.
    const _precioRefCat = p.esCombo ? (promo && promo.precioOrig) : p.precio;
    const precioOrig = (promo && promo.precioPromo && _precioRefCat && promo.precioPromo < _precioRefCat) ? _precioRefCat : null;
    const pctDescCat = precioOrig ? Math.round((1 - precio / precioOrig) * 100) : 0;
    const precioCat = p.costo ? Math.ceil(p.costo * (1 + ((DB.categorias||[]).find(c=>c.id===p.cat)?.margen||0)/100) * 10) / 10 : null;
    const sugerido = precioCat && precioCat !== p.precio ? precioCat : null;

    const _hayPromoActiva = !!(p.esCombo || promo);
    // El badge de stock "Disponible" (verde, el caso generico) se oculta cuando hay promo
    // activa — la promo ya comunica disponibilidad implicitamente, mostrar ambos era
    // redundante y competia por el mismo espacio angosto. "Ultimas unidades"/"Agotado" SI se
    // mantienen siempre — son informacion de urgencia real, nunca redundante con una promo.
    const _badgeVisible = (_hayPromoActiva && badge.includes('badge-green')) ? '' : badge;
    const accionClic = agotado ? '' : (p.tieneDetalle ? `tndVerDetalle(${p.id})` : `tndAgregarCarrito(${p.id})`);
 return `<div class="tnd-prod-card ${agotado?'agotado':''} ${_hayPromoActiva?'en-oferta':''}" onclick="${accionClic}" style="position:relative">
      <div class="tnd-badges-top">
        <div class="tnd-badges-left">
          ${p.tieneDetalle ? `<span class="tnd-badge-detalle">🔍 Detalle</span>` : ''}
          ${p.esCombo ? `<span class="tnd-prod-promo" style="background:var(--accent)">OFERTA</span>` : promo ? `<span class="tnd-prod-promo">${(promo.tipo === '2x1' || promo.tipo === '3x2') ? promo.tipo : (pctDescCat > 0 ? `-${pctDescCat}%` : 'PROMO')}</span>` : ''}
        </div>
        <div>${_badgeVisible}</div>
      </div>
      <div class="tnd-prod-img-wrap">${icon}${!agotado ? `<button type="button" class="tnd-prod-add-btn ${p.tipo==='granel'?'granel':''}" onclick="event.stopPropagation();tndAgregarCarrito(${p.id})" aria-label="Agregar ${p.nombre} al carrito">${p.tipo==='granel'?'+250g':'+'}</button>` : ''}</div>
      <div class="tnd-prod-info">
        <div class="tnd-prod-name">${p.nombre}</div>
        ${precioOrig ? `<div class="tnd-prod-price-orig">S/ ${precioOrig.toFixed(2)}</div>` : ''}
        <div class="tnd-prod-price">S/ ${precio.toFixed(2)}${p.tipo==='granel'?'<span style="font-size:.65em;font-weight:400"> /kg</span>':''}</div>
        ${agotado ? '<div style="font-size:.75rem;color:#ef4444;margin-top:.25rem">Sin stock</div>' : ''}
      </div>
    </div>`;
  }).join('') || '<p style="grid-column:1/-1;text-align:center;color:#9ca3af;padding:2rem">Sin productos que coincidan</p>';
  _tndActualizarBadgeFiltros();
}

let _tndToastTimer = null;
function tndMostrarToast(mensaje) {
  const toast = document.getElementById('tnd-toast');
  const msgEl = document.getElementById('tnd-toast-msg');
  if (!toast || !msgEl) return;
  msgEl.textContent = mensaje;
  toast.classList.add('show');
  clearTimeout(_tndToastTimer);
  _tndToastTimer = setTimeout(() => toast.classList.remove('show'), 2000);
}
function tndAgregarCarrito(prodId) {
  const p = DB.productos.find(x => x.id === prodId);
  if (!p || p.promoActiva === false || stockTotal(p) <= 0) return;
  if (p.venc && p.venc < today()) { alert('Este producto ya no está disponible.'); tndFiltrar(); return; }
  const promo = _getPromoTienda(p);
  const precio = promo && promo.precioPromo ? promo.precioPromo : p.precio;
  const cat = (DB.categorias||[]).find(c => c.id === p.cat);
  const existing = _tiendaCart.find(i => i.prodId === prodId);
  // Pack: limite por venta es un bloqueo directo, mismo criterio que POS.
  if (p.esCombo && promo && promo.maxPorVenta > 0 && (existing ? existing.cant : 0) >= promo.maxPorVenta) {
    alert(`Máximo ${promo.maxPorVenta} unidad(es) de este pack por compra.`);
    return;
  }
  // Productos por peso (granel) se agregan de a bloques de 250g (0.25 kg) por click — tanto el
  // primer click como los siguientes, siempre el mismo paso. Mismo bug que ya se corrigió en
  // POS: si el primero usa un valor distinto al de los siguientes clicks, la suma queda mal.
  const paso = p.tipo === 'granel' ? 0.25 : 1;
  // Descuento directo y 2x1/3x2: no se bloquea, pero se avisa de forma clara e inmediata en
  // el momento exacto en que la unidad agregada ya no lleva el descuento — mismo criterio que
  // POS. Se compara "antes/despues" en vez de igualdad exacta porque el paso puede ser
  // fraccionario (granel, bloques de 0.25 kg), donde nunca se pisa un valor entero exacto.
  if (!p.esCombo && promo && promo.maxPorVenta > 0) {
    const _cantAntes = existing ? existing.cant : 0;
    if (_cantAntes < promo.maxPorVenta && (_cantAntes + paso) > promo.maxPorVenta) {
      alert(`⚠️ Ya se alcanzó el máximo de ${promo.maxPorVenta} unidad(es) con precio promocional de "${p.nombre}". Las siguientes se cobran al precio normal (S/ ${p.precio.toFixed(2)}).`);
    }
  }
  if (existing) {
    if (existing.cant + paso > stockTotal(p)) { alert('No hay más stock disponible'); return; }
    existing.cant = Math.round((existing.cant + paso) * 1000) / 1000;
  } else {
_tiendaCart.push({ prodId, nombre: p.nombre, precio, cant: paso, icon: cat?.emoji||'📦', imagen: p.imagen||'', tipo: p.tipo });
  }
tndSaveCart(); // persistir en localStorage
  tndUpdateCartBadge();
  tndMostrarToast(`${p.nombre} añadido al carrito`);
}

// Envoltorio para el boton + del carrusel de compras por impulso (vive dentro del panel del
// carrito) — reutiliza tndAgregarCarrito() tal cual, sin duplicar nada, solo agrega el
// refresco del panel que ese caso especifico necesita (agregar desde DENTRO del carrito ya
// abierto, para que el producto desaparezca del carrusel y el subtotal se actualice en vivo).
function tndAgregarDesdeImpulso(prodId) {
  tndAgregarCarrito(prodId);
  if (_tndStep === 'cart') tndRenderPanel();
}

function tndUpdateCartBadge() {
  const total = _tiendaCart.reduce((s,i) => s+i.cant, 0);
  const el = document.getElementById('tnd-cart-count');
  if (el) {
    el.textContent = total;
    el.classList.remove('tnd-bump');
    void el.offsetWidth;
    el.classList.add('tnd-bump');
  }
}

function tndAbrirCarrito() {
  _tndStep = 'cart';
  tndRenderPanel();
  document.getElementById('tnd-overlay').classList.add('open');
  document.getElementById('tnd-panel').classList.add('open');
}

function tndAbrirMisPuntos() {
  _tndStep = 'puntos';
  tndRenderPanel();
  document.getElementById('tnd-overlay').classList.add('open');
  document.getElementById('tnd-panel').classList.add('open');
}

// ── Vista de detalle de producto — carga la colección aparte SOLO acá, nunca en la grilla.
let _tndDetalleProdId = null, _tndDetalleData = null, _tndDetalleCant = 1;
function tndVerDetalle(prodId) {
  _tndDetalleProdId = prodId;
  _tndDetalleData = null;
  const _pDet = DB.productos.find(x => x.id === prodId);
  _tndDetalleCant = _pDet && _pDet.tipo === 'granel' ? 0.25 : 1;
  _tndStep = 'detalle-producto';
  window.location.hash = '#/producto/' + prodId;
  tndRenderPanel();
  document.getElementById('tnd-overlay').classList.add('open');
  document.getElementById('tnd-panel').classList.add('open');
  if (dbModular) { // [SDK modular]
    getDocM(docM(dbModular, 'productos_detalle', String(prodId))).then(doc => {
      _tndDetalleData = doc.exists() ? doc.data() : {}; // en modular, exists es un METODO
      if (_tndStep === 'detalle-producto' && _tndDetalleProdId === prodId) tndRenderPanel();
    }).catch(() => { _tndDetalleData = {}; });
  } else {
    _tndDetalleData = {};
  }
}
function tndDetalleCambiarCant(delta) {
  const p = DB.productos.find(x => x.id === _tndDetalleProdId);
  if (p && p.tipo === 'granel') {
    _tndDetalleCant = Math.max(0.25, Math.round((_tndDetalleCant + 0.25 * Math.sign(delta)) * 1000) / 1000);
  } else {
    _tndDetalleCant = Math.max(1, _tndDetalleCant + delta);
  }
  tndRenderPanel();
}
function tndDetalleAgregarCarrito() {
  const p = DB.productos.find(x => x.id === _tndDetalleProdId);
  if (!p) return;
  const cant = _tndDetalleCant;
  const existing = _tiendaCart.find(i => i.prodId === p.id);
  // CRITICO — la validacion anterior solo miraba la cantidad nueva, no la suma con lo que ya
  // estuviera en el carrito — permitia superar el stock real si el producto ya estaba agregado.
  const cantTotalTrasAgregar = (existing ? existing.cant : 0) + cant;
  if (cantTotalTrasAgregar > stockTotal(p)) { alert('No hay suficiente stock disponible.'); return; }
  const promo = _getPromoTienda(p);
  // Pack: limite por venta es un bloqueo directo, mismo criterio que POS.
  if (p.esCombo && promo && promo.maxPorVenta > 0 && ((existing ? existing.cant : 0) + cant) > promo.maxPorVenta) {
    alert(`Máximo ${promo.maxPorVenta} unidad(es) de este pack por compra.`);
    return;
  }
  let precio = promo && promo.precioPromo ? promo.precioPromo : p.precio;
  // Descuento directo y 2x1/3x2: no se bloquea, pero se avisa de forma clara e inmediata si
  // la cantidad agregada hace que el total supere el maximo por venta — mismo criterio que
  // el resto del sistema, aca la cantidad puede saltar de golpe (el usuario escribe un
  // numero), no de a un paso por click.
  if (!p.esCombo && promo && promo.maxPorVenta > 0 && ((existing ? existing.cant : 0) + cant) > promo.maxPorVenta) {
    alert(`⚠️ Con esta cantidad, algunas unidades de "${p.nombre}" superan el máximo de ${promo.maxPorVenta} con precio promocional — esas se cobran al precio normal (S/ ${p.precio.toFixed(2)}).`);
  }
  const mayor = _tndDetalleData?.precioMayor;
  if (mayor && mayor.cantidadMin > 0 && cant >= mayor.cantidadMin) precio = mayor.precio;
  const cat = (DB.categorias||[]).find(c => c.id === p.cat);
  if (existing) {
    existing.cant += cant;
    existing.precio = precio;
  } else {
  _tiendaCart.push({ prodId: p.id, nombre: p.nombre, precio, cant, icon: cat?.emoji||'📦', imagen: p.imagen||'', tipo: p.tipo });
  }
tndSaveCart();
  tndUpdateCartBadge();
  tndCerrarPanel();
  tndMostrarToast(`${p.nombre} añadido al carrito`);
}
// Identificación mínima para ver puntos — mismo mecanismo real usado al pedir (teléfono = llave).
function tndIdentificarParaPuntos() {
  const nombre = document.getElementById('tnd-puntos-nombre')?.value.trim();
  const tel = document.getElementById('tnd-puntos-tel')?.value.trim();
  if (!nombre || nombre.length < 3) { alert('Ingresa tu nombre (mínimo 3 caracteres)'); return; }
  const telLimpio = (tel||'').replace(/\s/g,'');
  if (!telLimpio || telLimpio.length !== 9) { alert('Ingresa tu número de celular (9 dígitos)'); return; }
  tndResolverClienteConVerificacion(nombre, telLimpio, () => {
    tndSaveUser(nombre, telLimpio);
    _tndStep = 'puntos';
    tndRenderPanel();
  });
}

function tndCerrarPanel() {
  document.getElementById('tnd-overlay').classList.remove('open');
  document.getElementById('tnd-panel').classList.remove('open');
  if (_tndStep === 'detalle-producto' && window.location.hash.startsWith('#/producto/')) {
    history.replaceState(null, '', window.location.pathname + window.location.search);
  }
}

function tndRenderPanel() {
  const titulo = document.getElementById('tnd-panel-titulo');
  const body = document.getElementById('tnd-panel-body');
  const footer = document.getElementById('tnd-panel-footer');
// Productos marcados como compra por impulso (checkbox en el modal de producto), con stock,
// que no combo, y que todavia no esten en el carrito (no tiene sentido sugerir algo ya
// agregado). Variable por visita, no en cada apertura del carrito — mismo mecanismo de
// sessionStorage que ya usa el catalogo principal para el orden aleatorio estable.
function _tndProductosImpulso() {
  const candidatos = (DB.productos||[]).filter(p =>
    p.esImpulso && !p.esCombo && stockTotal(p) > 0 && !_tiendaCart.some(i => i.prodId === p.id)
  );
  if (!candidatos.length) return [];
  const claveSesion = 'tnd_impulso_orden';
  let ordenGuardado = null;
  try { ordenGuardado = JSON.parse(sessionStorage.getItem(claveSesion) || 'null'); } catch(e) {}
  let ordenados;
  if (ordenGuardado) {
    const porId = new Map(candidatos.map(p => [p.id, p]));
    ordenados = ordenGuardado.map(id => porId.get(id)).filter(Boolean);
    candidatos.forEach(p => { if (!ordenGuardado.includes(p.id)) ordenados.push(p); });
  } else {
    ordenados = candidatos.slice();
    for (let i = ordenados.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [ordenados[i], ordenados[j]] = [ordenados[j], ordenados[i]];
    }
    try { sessionStorage.setItem(claveSesion, JSON.stringify(ordenados.map(p => p.id))); } catch(e) {}
  }
  return ordenados.slice(0, 10);
}

if (_tndStep === 'cart') {
    titulo.textContent = '🛒 Tu carrito';
    const { subtotal, total, lineasCombo: _comboTnd, lineasCantidad: _cantidadTnd, lineasRecargo: _recargoTnd } = _tndCalcularTotal();
    if (_tiendaCart.length === 0) {
      body.innerHTML = '<div style="text-align:center;padding:2rem;color:#9ca3af">🛒 Tu carrito está vacío<br><span style="font-size:.82rem">Agrega productos del catálogo</span></div>';
      footer.innerHTML = '<button class="tnd-btn tnd-btn-outline" onclick="tndCerrarPanel()">Seguir comprando</button>';
      return;
    }
    body.innerHTML = `
      ${_tiendaCart.map(item => `
     <div class="tnd-cart-item">
        <div class="tnd-cart-item-icon">${item.imagen ? `<img src="${item.imagen}" style="width:100%;height:100%;object-fit:contain;border-radius:6px">` : item.icon}</div>
        <div class="tnd-cart-item-info">
          <div class="tnd-cart-item-name">${item.nombre}</div>
          <div class="tnd-cart-item-price">S/ ${item.precio.toFixed(2)} ${item.tipo==='granel'?'/kg':'c/u'}</div>
        </div>
        <button class="tnd-qty-btn" onclick="tndCartCant(${item.prodId},-1)">−</button>
        <span class="tnd-qty-val">${item.tipo==='granel'?Math.round(item.cant*1000)+'g':item.cant}</span>
        <button class="tnd-qty-btn" onclick="tndCartCant(${item.prodId},1)">+</button>
        <button class="tnd-cart-trash" onclick="tndEliminarDelCarrito(${item.prodId})" title="Eliminar" aria-label="Eliminar producto">🗑️</button>
      </div>`).join('')}
      ${(_comboTnd.length || _cantidadTnd.length || _recargoTnd.length) ? `
      <div style="margin-top:.5rem">
        ${_comboTnd.map(l => `<div style="display:flex;justify-content:space-between;align-items:center;font-size:.78rem;background:#F5F3FF;border-radius:6px;padding:.3rem .5rem;margin-bottom:.25rem"><span style="color:#5B21B6">🎁 Combo: ${l.nombre}${l.sets>1?' ×'+l.sets:''}</span><span style="font-weight:700;color:#5B21B6">-S/ ${l.descuento.toFixed(2)}</span></div>`).join('')}
        ${_cantidadTnd.map(l => `<div style="display:flex;justify-content:space-between;align-items:center;font-size:.78rem;background:#F5F3FF;border-radius:6px;padding:.3rem .5rem;margin-bottom:.25rem"><span style="color:#5B21B6">🏷️ ${l.nombre}${l.grupos>1?' ×'+l.grupos:''}</span><span style="font-weight:700;color:#5B21B6">-S/ ${l.descuento.toFixed(2)}</span></div>`).join('')}
        ${_recargoTnd.map(l => `<div style="display:flex;justify-content:space-between;align-items:center;font-size:.78rem;background:#FEF3C7;border-radius:6px;padding:.3rem .5rem;margin-bottom:.25rem"><span style="color:#92400E">⚠️ ${l.unidadesExceso} unid. de "${l.nombre}" superan el máx. por compra</span><span style="font-weight:700;color:#92400E">+S/ ${l.recargo.toFixed(2)}</span></div>`).join('')}
      </div>` : ''}
      ${(() => {
        const _impulsoProds = _tndProductosImpulso();
        if (!_impulsoProds.length) return '';
        return `<div style="margin-top:.75rem">
          <div style="font-size:.78rem;font-weight:700;color:#6b7280;margin-bottom:.4rem">😋 ¿Te provoca algo más?</div>
          <div style="display:flex;gap:.5rem;overflow-x:auto;scrollbar-width:none;-webkit-overflow-scrolling:touch;padding-bottom:.25rem">
            ${_impulsoProds.map(p => `<div style="flex-shrink:0;width:88px;background:#fff;border:1px solid #eee;border-radius:10px;overflow:hidden;position:relative">
              <div style="width:100%;height:70px;background:#F3F4F6;display:flex;align-items:center;justify-content:center">${p.imagen?`<img src="${p.imagen}" style="width:100%;height:100%;object-fit:contain">`:'<span style="font-size:1.6rem">🍫</span>'}</div>
              <div style="padding:.3rem"><div style="font-size:.68rem;font-weight:600;color:#1f2937;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${p.nombre}</div><div style="font-size:.72rem;font-weight:800;color:#7C3AED">S/ ${p.precio.toFixed(2)}</div></div>
              <button type="button" onclick="tndAgregarDesdeImpulso(${p.id})" aria-label="Agregar ${p.nombre}" style="position:absolute;top:4px;right:4px;background:#7C3AED;color:#fff;border:none;border-radius:50%;width:22px;height:22px;font-size:.85rem;font-weight:700;line-height:1;display:flex;align-items:center;justify-content:center;cursor:pointer;box-shadow:0 2px 5px rgba(124,58,237,.4)">+</button>
            </div>`).join('')}
          </div>
        </div>`;
      })()}
      <div style="border-top:2px solid #e5e7eb;margin-top:.5rem;padding-top:.75rem">
        <div style="display:flex;justify-content:space-between;font-size:.85rem;color:#6b7280;margin-bottom:.3rem">
          <span>Subtotal</span><span>S/ ${subtotal.toFixed(2)}</span>
        </div>
        <div style="display:flex;justify-content:space-between;font-size:.85rem;color:#6b7280;margin-bottom:.5rem">
          <span>Envío</span><span>Se calcula en el siguiente paso</span>
        </div>
        <div style="display:flex;justify-content:space-between;align-items:center;border-top:1px dashed #e5e7eb;padding-top:.5rem">
          <span style="font-size:.9rem;font-weight:700;color:#1f2937">Total estimado</span>
          <strong style="font-size:1.2rem;color:#7C3AED">S/ ${total.toFixed(2)}</strong>
        </div>
      </div>`;
    footer.innerHTML = `
      <div style="display:flex;gap:.4rem;flex-wrap:wrap;margin-bottom:.75rem">
        <span style="background:#EDE9FE;color:#5B21B6;font-size:.68rem;font-weight:700;padding:.3rem .6rem;border-radius:6px">💵 Efectivo</span>
        <span style="background:#7C3AED;color:#fff;font-size:.68rem;font-weight:700;padding:.3rem .6rem;border-radius:6px">Yape</span>
        <span style="background:#00B4E1;color:#fff;font-size:.68rem;font-weight:700;padding:.3rem .6rem;border-radius:6px">Plin</span>
        <span style="background:#1f2937;color:#fff;font-size:.68rem;font-weight:700;padding:.3rem .6rem;border-radius:6px">💳 Tarjeta</span>
      </div>
      <button class="tnd-btn tnd-btn-primary" onclick="tndIrDatos()">Continuar → Datos</button>
      <button class="tnd-btn tnd-btn-outline" onclick="tndCerrarPanel()">Seguir comprando</button>`;
  }
  if (_tndStep === 'verificar-sms') {
    titulo.textContent = '🔒 Verificar tu número';
    body.innerHTML = `
      <p style="font-size:.82rem;color:#6b7280;margin-bottom:1rem">Por seguridad, confirmamos tu número antes de continuar.</p>
      <div class="tnd-form-group">
        <label>Te enviaremos un código a:</label>
        <div style="font-weight:700;padding:.5rem 0">${_tndPendienteTel||''}</div>
      </div>
      <div id="tnd-sms-status" style="font-size:.82rem;color:#6b7280;margin:.5rem 0"></div>
      <div id="tnd-sms-paso2" style="display:none" class="tnd-form-group">
        <label>Código recibido</label>
        <input type="text" id="tnd-sms-codigo" placeholder="123456" maxlength="6" inputmode="numeric" />
      </div>`;
    footer.innerHTML = `
      <button class="tnd-btn tnd-btn-primary" onclick="tndSolicitarCodigoUI()">Enviar código</button>
      <button class="tnd-btn tnd-btn-primary" style="display:none" id="tnd-sms-btn-verificar" onclick="tndConfirmarCodigoUI()">Verificar</button>
      <button class="tnd-btn tnd-btn-outline" onclick="tndCerrarPanel()">Cancelar</button>`;
    // Revela el botón de verificar recién cuando aparece el campo de código
    setTimeout(() => {
      const obs = new MutationObserver(() => {
        const visible = document.getElementById('tnd-sms-paso2')?.style.display === 'block';
        const btn = document.getElementById('tnd-sms-btn-verificar');
        if (btn) btn.style.display = visible ? 'inline-block' : 'none';
      });
      const target = document.getElementById('tnd-sms-paso2');
      if (target) obs.observe(target, { attributes: true, attributeFilter: ['style'] });
    }, 0);
  }

  if (_tndStep === 'detalle-producto') {
    const p = DB.productos.find(x => x.id === _tndDetalleProdId);
    if (!p) { titulo.textContent = 'Producto'; body.innerHTML = '<p>Producto no encontrado.</p>'; footer.innerHTML = ''; }
    else {
      titulo.textContent = p.nombre;
      const cat = (DB.categorias||[]).find(c => c.id === p.cat);
      const imgPrincipal = p.imagen || cat?.imagen || '';
      const cargando = _tndDetalleData === null;
      const extra = _tndDetalleData?.imagenesExtra || [];
      const desc = _tndDetalleData?.descripcion || '';
      const mayor = _tndDetalleData?.precioMayor;
      const agotado = (p.promoActiva === false) || stockTotal(p) <= 0;
      // CRITICO: esta vista mostraba p.precio directo, sin chequear nunca si el producto tenia
      // una promo individual activa — el carrito SI aplicaba el descuento correctamente al
      // agregar (tndDetalleAgregarCarrito ya usa _getPromoTienda), pero el precio que se veia
      // ANTES de agregar seguia siendo el regular, mismo patron ya usado en la grilla del
      // catalogo (precio tachado + precio con descuento + etiqueta PROMO).
      const promo = _getPromoTienda(p);
      const precioMostrar = p.esCombo ? p.precio : (promo && promo.precioPromo ? promo.precioPromo : p.precio);
      const _precioRefDet = p.esCombo ? (promo && promo.precioOrig) : p.precio;
      const precioOrigDetalle = (promo && promo.precioPromo && _precioRefDet && promo.precioPromo < _precioRefDet) ? _precioRefDet : null;
      const pctDescDet = precioOrigDetalle ? Math.round((1 - precioMostrar / precioOrigDetalle) * 100) : 0;
      body.innerHTML = `
        <div style="text-align:center;margin-bottom:1rem;background:#F3F4F6;border-radius:12px;padding:.75rem">
          ${imgPrincipal ? `<img src="${imgPrincipal}" style="width:100%;max-height:50vh;object-fit:contain;border-radius:8px">` : `<div style="font-size:4rem;padding:2rem 0">${cat?.emoji||'📦'}</div>`}
        </div>
        ${extra.length ? `<div style="display:flex;gap:.5rem;justify-content:center;margin-bottom:1rem">${extra.map(u=>`<img src="${u}" style="width:56px;height:56px;object-fit:cover;border-radius:8px;border:1px solid #e5e7eb">`).join('')}</div>` : ''}
        ${promo ? `<div style="text-align:center;margin-bottom:.35rem"><span class="tnd-prod-promo">${(promo.tipo === '2x1' || promo.tipo === '3x2') ? promo.tipo : (pctDescDet > 0 ? `-${pctDescDet}%` : 'PROMO')}</span></div>` : ''}
        ${precioOrigDetalle ? `<div style="text-align:center;font-size:.95rem;color:#9ca3af;text-decoration:line-through">S/ ${precioOrigDetalle.toFixed(2)}</div>` : ''}
        <div style="text-align:center;font-size:1.4rem;font-weight:800;color:#7C3AED;margin-bottom:.5rem">S/ ${precioMostrar.toFixed(2)}${p.tipo==='granel'?' <span style="font-size:.6em;font-weight:400">/kg</span>':''}</div>
        ${cargando ? '<p style="text-align:center;color:#9ca3af;font-size:.82rem">⏳ Cargando detalle...</p>' : ''}
        ${desc ? `<p style="font-size:.85rem;color:#4b5563;line-height:1.5;margin-bottom:1rem">${desc}</p>` : ''}
        ${mayor && mayor.cantidadMin > 0 ? `<div style="background:#EDE9FE;border-radius:8px;padding:.6rem;font-size:.8rem;color:#5B21B6;margin-bottom:1rem">💰 Desde ${mayor.cantidadMin} unidades: <strong>S/ ${mayor.precio.toFixed(2)} c/u</strong></div>` : ''}
        ${agotado ? '<p style="text-align:center;color:#ef4444;font-weight:700">Sin stock por el momento</p>' : `
          <div style="display:flex;align-items:center;justify-content:center;gap:1rem;margin-top:1rem">
            <button class="tnd-btn tnd-btn-outline" style="width:44px" onclick="tndDetalleCambiarCant(-1)">−</button>
            <span style="font-size:1.2rem;font-weight:700;min-width:30px;text-align:center">${p.tipo==='granel'?Math.round(_tndDetalleCant*1000)+'g':_tndDetalleCant}</span>
            <button class="tnd-btn tnd-btn-outline" style="width:44px" onclick="tndDetalleCambiarCant(1)">+</button>
          </div>`}`;
      footer.innerHTML = agotado
        ? `<button class="tnd-btn tnd-btn-outline" onclick="tndCerrarPanel()">Cerrar</button>`
        : `<button class="tnd-btn tnd-btn-primary" onclick="tndDetalleAgregarCarrito()">Agregar al carrito</button>`;
    }
  }

  if (_tndStep === 'puntos') {
    titulo.textContent = '⭐ Mis puntos';
    const clienteId = tndGetClienteIdReal();
    if (!clienteId) {
      body.innerHTML = `
        <p style="font-size:.82rem;color:#6b7280;margin-bottom:1rem">Ingresa tu nombre y teléfono para ver tus puntos — es el mismo dato que usás al pedir, así siempre encuentra tu cuenta real, sin importar desde qué equipo entres.</p>
        <div class="tnd-form-group">
          <label>Nombre *</label>
          <input type="text" id="tnd-puntos-nombre" placeholder="Tu nombre" value="${_tiendaUser?.nombre||''}" />
        </div>
        <div class="tnd-form-group">
          <label>Teléfono *</label>
          <input type="tel" id="tnd-puntos-tel" placeholder="999 999 999" value="${_tiendaUser?.tel||''}" />
        </div>`;
      footer.innerHTML = `<button class="tnd-btn tnd-btn-primary" onclick="tndIdentificarParaPuntos()">Ver mis puntos</button>`;
    } else {
      const cli = DB.clientes.find(c => c.id === clienteId);
      const est = estadoFidelizacion(clienteId);
      const _deudaCli = clienteDeudaMonto(cli);
      body.innerHTML = `
        <div style="text-align:center;padding:1rem 0">
          <div style="font-size:2.2rem;font-weight:800;color:#7C3AED">${cli.puntos||0}</div>
          <div style="font-size:.8rem;color:#6b7280">puntos acumulados</div>
        </div>
        ${est.valorCanjeable > 0 ? `
          <div style="background:#ECFDF5;border-left:4px solid #10B981;border-radius:8px;padding:.75rem;margin-bottom:1rem;font-size:.85rem">🎁 Puedes canjear tus puntos por <strong>${sol(est.valorCanjeable)}</strong> de descuento.</div>
          <p style="font-size:.75rem;color:#9ca3af;margin-top:.5rem">Pídelo en caja al recoger tu pedido.</p>
        ` : '<p style="font-size:.82rem;color:#9ca3af;text-align:center">Seguí comprando para juntar puntos canjeables.</p>'}
        ${_deudaCli > 0 ? `
          <div style="border-top:1px solid #e5e7eb;margin-top:1rem;padding-top:1rem;text-align:center">
            <div style="font-size:.78rem;color:#6b7280;margin-bottom:.25rem">Tienes una deuda pendiente de</div>
            <div style="font-size:1.6rem;font-weight:800;color:var(--danger,#EF4444)">${sol(_deudaCli)}</div>
            <a href="https://wa.me/51${(DB.config?.whatsappTienda||'980037284').replace(/\\D/g,'')}?text=${encodeURIComponent('Hola, quisiera ver el detalle de mi deuda pendiente ('+sol(_deudaCli)+').')}" target="_blank" style="display:inline-block;margin-top:.6rem;font-size:.78rem;color:#25D366;text-decoration:none;font-weight:600">📲 Pedir detalle por WhatsApp</a>
          </div>
        ` : ''}`;
      footer.innerHTML = `<button class="tnd-btn tnd-btn-outline" onclick="tndCerrarPanel()">Cerrar</button>`;
    }
  }

  if (_tndStep === 'datos') {
    titulo.textContent = '👤 Tus datos';
    body.innerHTML = `
      <p style="font-size:.82rem;color:#6b7280;margin-bottom:1rem">Necesitamos tus datos para confirmar tu pedido por WhatsApp.</p>
      <div class="tnd-form-group">
        <label>Nombre *</label>
        <input type="text" id="tnd-inp-nombre" placeholder="¿Cómo te llamamos?" value="${_tiendaUser?.nombre||''}" />
      </div>
      <div class="tnd-form-group">
        <label>WhatsApp * <span style="font-size:.72rem;font-weight:400;color:#9ca3af">(para confirmar tu pedido)</span></label>
        <input type="tel" id="tnd-inp-tel" placeholder="Ej: 987654321" value="${_tiendaUser?.tel||''}" inputmode="numeric" />
      </div>
      <div class="tnd-form-group">
        <label>Método de entrega *</label>
        <div style="display:flex;gap:.5rem">
          <div class="tnd-metodo-opt ${_tndEntrega==='recojo'?'selected':''}" onclick="tndSetEntrega('recojo')" style="flex:1">🏪<br>Recojo en tienda</div>
          <div class="tnd-metodo-opt ${_tndEntrega==='delivery'?'selected':''}" onclick="tndSetEntrega('delivery')" style="flex:1">🚚<br>Delivery</div>
        </div>
      </div>
      ${_tndEntrega==='delivery'?`<div class="tnd-delivery-box">🚚 El delivery puede tener un costo adicional según la distancia y disponibilidad. Te lo confirmamos por WhatsApp antes de cerrar tu pedido.</div>`:''}
      ${_tndEntrega==='delivery'?`<div class="tnd-form-group"><label>Tu dirección</label><input type="text" id="tnd-inp-dir" placeholder="Calle, número, referencia..." /></div>`:''}
    `;
    footer.innerHTML = `
      <button class="tnd-btn tnd-btn-primary" onclick="tndIrPago()">Continuar → Pago</button>
      <button class="tnd-btn tnd-btn-outline" onclick="tndVolverCart()">← Volver al carrito</button>`;
  }

  if (_tndStep === 'pago') {
    titulo.textContent = '💳 Método de pago';
    const { total: subtotal } = _tndCalcularTotal();
    // Los 3 de mayor uso quedan siempre visibles; el resto se colapsa bajo "Ver más opciones"
    // para no presentar 8 botones con el mismo peso visual — si el metodo ya elegido esta
    // entre los colapsados (de una visita anterior), esa seccion se muestra expandida desde
    // el inicio, para que el cliente vea su seleccion actual sin tener que buscarla.
    const metodosDestacados = [
      {v:'Yape',e:'💜 Yape'},
      {v:'Plin',e:'💚 Plin'},
      {v:'Efectivo',e:'💵 Efectivo'},
    ];
    const metodosOtros = [
      {v:'QR',e:'📱 QR'},
      {v:'Link de pago',e:'🔗 Link de pago'},
      {v:'Tarjeta POS',e:'💳 Tarjeta POS'},
      {v:'Tarjeta POS Móvil',e:'📲 POS Móvil'},
      {v:'Transferencia',e:'🏦 Transferencia'},
    ];
    if (metodosOtros.some(m => m.v === _tndMetodo)) _tndMasMetodos = true;
    body.innerHTML = `
      <div class="tnd-metodo-grid">
        ${metodosDestacados.map(m=>`<div class="tnd-metodo-opt ${_tndMetodo===m.v?'selected':''}" onclick="tndSetMetodo('${m.v}')">${m.e}</div>`).join('')}
      </div>
      ${_tndMasMetodos
        ? `<div class="tnd-metodo-grid" style="margin-top:.5rem">${metodosOtros.map(m=>`<div class="tnd-metodo-opt ${_tndMetodo===m.v?'selected':''}" onclick="tndSetMetodo('${m.v}')">${m.e}</div>`).join('')}</div>`
        : `<button type="button" onclick="_tndToggleMasMetodos()" style="width:100%;background:none;border:none;color:#7C3AED;font-size:.82rem;font-weight:600;padding:.6rem 0;cursor:pointer">Ver más opciones ▾</button>`}
      <div style="border-top:2px solid #e5e7eb;padding-top:.75rem;margin-top:.5rem">
        ${_tiendaCart.map(i=>`<div style="display:flex;justify-content:space-between;gap:.5rem;font-size:.82rem;padding:.25rem 0"><span style="flex:1;min-width:0">${i.nombre} x${i.tipo==='granel'?Math.round(i.cant*1000)+'g':i.cant}</span><span style="flex-shrink:0;white-space:nowrap">S/ ${subtotalItemCarrito(i).toFixed(2)}</span></div>`).join('')}
        <div style="display:flex;justify-content:space-between;margin-top:.5rem;font-size:1rem;font-weight:700;color:#7C3AED">
          <span>TOTAL</span><span>S/ ${subtotal.toFixed(2)}</span>
        </div>
      </div>`;
    // "Pagar en linea" solo aparece si la pasarela esta activa en Configuracion — dormida
    // por defecto, el checkout de hoy (WhatsApp + metodo informativo) sigue igual.
    const _pasarelaActiva = DB.config.pasarelaPago && DB.config.pasarelaPago.activa;
    footer.innerHTML = `
      ${_pasarelaActiva ? `<button class="tnd-btn tnd-btn-primary" onclick="tndPagarEnLinea()">💳 Pagar ahora en línea</button>` : ''}
      <button class="tnd-btn tnd-btn-accent" onclick="tndEnviarPedido()">📱 Confirmar y Enviar Pedido por WhatsApp</button>
      <button class="tnd-btn tnd-btn-outline" onclick="tndVolverDatos()">← Volver</button>`;
  }
}

// ── Pago en línea (Izipay) — solo se llega acá si el flag esta activo Y las Cloud
// Functions ya fueron desplegadas manualmente (ver /functions en el repositorio).
// Sin ese despliegue, esta llamada falla con un error claro, no en silencio.
async function tndPagarEnLinea() {
  if (!_tiendaUser?.nombre || !_tiendaUser?.tel) { alert('Completa tus datos antes de pagar.'); tndVolverDatos(); return; }
  const { total: subtotal } = _tndCalcularTotal();
  if (subtotal <= 0) { alert('Tu carrito está vacío.'); return; }
  if (_tndEntrega === 'delivery') {
    const _minDelivery = (DB.config && DB.config.deliveryMinimo) || 20;
    if (subtotal < _minDelivery) { alert(`🚚 El pedido mínimo para delivery es S/ ${_minDelivery.toFixed(2)}. Tu carrito cambió — ajústalo o elige recojo en tienda.`); return; }
  }
  if (!functionsModular) { alert('El pago en línea no está disponible por el momento.'); return; }
  if (!(await _tndRevalidarStock())) return;

  try {
    // El pedido tiene que existir en Firestore ANTES de iniciar el pago — crearSesionPago
    // verifica el monto contra el pedido real, no confía en lo que mande el navegador.
    const clienteId = await tndResolverCliente(_tiendaUser.nombre, (_tiendaUser.tel||'').replace(/\s/g,''));
    const pedido = {
      id: getId(), clienteNombre: _tiendaUser.nombre, telefono: (_tiendaUser.tel||'').replace(/\s/g,''),
      clienteId, items: _tiendaCart, total: Math.round(subtotal*100)/100,
      entrega: _tndEntrega, direccion: _tndEntrega==='delivery' ? (document.getElementById('tnd-inp-dir')?.value||'') : '',
      metodo: 'Pago en línea', estado: 'pendiente', pagoEstado: 'sin_iniciar',
      fecha: new Date().toISOString(), origen: 'web'
    };
    await setDocM(docM(dbModular, 'pedidos_online', String(pedido.id)), pedido); // [SDK modular]

    const crearSesion = httpsCallableM(functionsModular, 'crearSesionPago');
    const resultado = await crearSesion({ pedidoId: pedido.id, monto: pedido.total, moneda: 'PEN' });

    // TODO: acá se renderiza el formulario embebido de Izipay usando
    // resultado.data.formToken — pendiente de completar contra su SDK real
    // (KR.setFormConfig / KR.attachForm o el nombre que use su documentación
    // actual). Por ahora, deja constancia de que la sesión se creó bien.
    if (resultado.data && resultado.data.formToken) {
      alert('Sesión de pago creada. Falta completar la integración visual del formulario de Izipay (pendiente de su documentación técnica).');
    } else {
      alert('No se pudo iniciar el pago en línea. Intenta con WhatsApp mientras tanto.');
    }
  } catch (e) {
    console.warn('tndPagarEnLinea:', e);
    alert('El pago en línea no está disponible en este momento. Puedes completar tu pedido por WhatsApp.');
  }
}

function tndSetEntrega(tipo) {
  if (tipo === 'delivery') {
    const _minDelivery = (DB.config && DB.config.deliveryMinimo) || 20;
    const { total: _totalActual } = _tndCalcularTotal();
    if (_totalActual < _minDelivery) {
      alert(`🚚 El pedido mínimo para delivery es S/ ${_minDelivery.toFixed(2)}. Te faltan S/ ${(_minDelivery - _totalActual).toFixed(2)} — agrega más productos, o elige recojo en tienda.`);
      return;
    }
  }
  _tndEntrega = tipo;
  document.querySelectorAll('.tnd-metodo-opt').forEach(el => {
    const esEste = (tipo==='recojo' && el.textContent.includes('Recojo')) ||
                   (tipo==='delivery' && el.textContent.includes('Delivery'));
    el.classList.toggle('selected', esEste);
  });
  // Re-renderizar para mostrar/ocultar nota delivery
  tndRenderPanel();
}

function tndSetMetodo(m) {
  _tndMetodo = m;
  document.querySelectorAll('.tnd-metodo-grid .tnd-metodo-opt').forEach(el => {
    el.classList.toggle('selected', el.textContent.includes(m));
  });
}
function _tndToggleMasMetodos() {
  _tndMasMetodos = true;
  tndRenderPanel();
}

function tndCartCant(prodId, delta) {
  const idx = _tiendaCart.findIndex(i => i.prodId === prodId);
  if (idx < 0) return;
  // El boton siempre pasa -1/1 (direccion) — el paso real depende del tipo de producto: 250g
  // (0.25) para granel, 1 unidad para el resto. Mismo criterio que tndAgregarCarrito().
  const esGranel = _tiendaCart[idx].tipo === 'granel';
  const paso = esGranel ? 0.25 * Math.sign(delta) : delta;
  // CRITICO — bug real confirmado: este +/- nunca verificaba stock, a diferencia de
  // tndAgregarCarrito() (el botón de la grilla principal), que sí lo hace. Con esto, se podía
  // subir la cantidad sin límite una vez que el producto ya estaba en el carrito. La
  // verificación es interna — no hace falta un mensaje nuevo para el cliente, alcanza con que
  // el botón + simplemente no haga nada más allá del stock real disponible.
  if (paso > 0) {
    const p = DB.productos.find(x => x.id === prodId);
    const stockReal = p ? stockTotal(p) : 0;
    if (_tiendaCart[idx].cant >= stockReal) return;
  }
  _tiendaCart[idx].cant = Math.round((_tiendaCart[idx].cant + paso) * 1000) / 1000;
  if (_tiendaCart[idx].cant <= 0) _tiendaCart.splice(idx, 1);
  tndSaveCart(); // persistir cambio de cantidad
  tndUpdateCartBadge();
  tndRenderPanel();
}

function tndIrDatos() {
  if (_tiendaCart.length === 0) { alert('Tu carrito está vacío'); return; }
  _tndStep = 'datos';
  tndRenderPanel();
}

function tndVolverCart() {
  _tndStep = 'cart';
  tndRenderPanel();
}

function tndIrPago() {
  const nombre = document.getElementById('tnd-inp-nombre')?.value.trim();
  if (!nombre || nombre.length < 3) { alert('Por favor ingresa tu nombre (mínimo 3 caracteres)'); return; }
  const tel = document.getElementById('tnd-inp-tel')?.value.trim()||'';
  if (!tel || tel.replace(/\s/g,'').length !== 9) { alert('Por favor ingresa tu número de WhatsApp (9 dígitos)\nEsto nos permite confirmarte el pedido.'); return; }
  _tiendaUser = {
    nombre,
    tel,
    dir: document.getElementById('tnd-inp-dir')?.value.trim()||''
  };
  tndSaveUser(nombre, tel); // recordar para próxima visita
  _tndStep = 'pago';
  tndRenderPanel();
}

function tndVolverDatos() {
  _tndStep = 'datos';
  tndRenderPanel();
}

// ── Flag anti-doble-envío — se resetea tras éxito o error ───────────────────
let _tndEnviando = false;

async function tndEnviarPedido() {
  // ── Guardia anti-doble-clic ──────────────────────────────────────────────
  if (_tndEnviando) return;

  // ── Validaciones previas al envío ────────────────────────────────────────
  // Los máximos (100 y 15) coinciden exactamente con pedidoValido() en las reglas de Firestore
  // — sin esto, un nombre o teléfono demasiado largo rechazaba el pedido sin ningún mensaje
  // claro para el cliente, solo un error crudo de permisos.
  if (!_tiendaUser?.nombre || _tiendaUser.nombre.length < 3) {
    alert('Falta tu nombre (mínimo 3 caracteres)'); return;
  }
  if (_tiendaUser.nombre.length > 100) {
    alert('Tu nombre es demasiado largo (máximo 100 caracteres)'); return;
  }
  const telLimpio = (_tiendaUser?.tel||'').replace(/\s/g,'');
  if (!telLimpio || telLimpio.length !== 9) {
    alert('Tu número de WhatsApp debe tener 9 dígitos'); return;
  }
  if (_tiendaCart.length === 0) {
    alert('Tu carrito está vacío'); return;
  }
 const { total: subtotal } = _tndCalcularTotal();
  if (!subtotal || subtotal <= 0) {
    alert('El total del pedido no es válido'); return;
  }
  if (_tndEntrega === 'delivery') {
    const _minDelivery = (DB.config && DB.config.deliveryMinimo) || 20;
    if (subtotal < _minDelivery) { alert(`🚚 El pedido mínimo para delivery es S/ ${_minDelivery.toFixed(2)}. Tu carrito cambió — ajústalo o elige recojo en tienda.`); return; }
  }
  if (!(await _tndRevalidarStock())) return;

  // ── Verificación SMS (dormida mientras el flag esté apagado) — si hace falta y
  // todavía no se hizo en este equipo, se muestra y se vuelve a llamar esta misma
  // función al terminar. El resto de tndEnviarPedido() no cambia en nada.
  if (DB.config.requiereVerificacionSMS && !tndTelefonoYaVerificado()) {
    tndResolverClienteConVerificacion(_tiendaUser.nombre, telLimpio, () => tndEnviarPedido());
    return;
  }

  // ── Bloquear botón inmediatamente ────────────────────────────────────────
  _tndEnviando = true;
  const btnEnviar = document.querySelector('.tnd-btn-accent');
  if (btnEnviar) { btnEnviar.disabled = true; btnEnviar.textContent = '⏳ Enviando...'; }

  const waNum = DB.config.whatsappTienda || '980037284';
  const fecha = today();
  const hora  = nowTime();

  // ── Construir pedido con TODOS los campos requeridos por pedidoValido() ──
  // Incluye: clienteNombre, telefono, items, total, fecha, origen
  if (!DB.pedidosOnline) DB.pedidosOnline = [];
  const clienteId = await tndResolverCliente(_tiendaUser.nombre, telLimpio);
  const pedido = {
    id:            getId(),
    fecha,                          // string "YYYY-MM-DD" — requerido por reglas
    hora,
    clienteId,
    clienteNombre: _tiendaUser.nombre,           // string >2 chars — validado arriba
    clienteTel:    _tiendaUser.tel,
    telefono:      telLimpio,                    // ← NUEVO — requerido por pedidoValido()
    clienteDir:    _tiendaUser.dir || '',
    items:         _tiendaCart.map(i=>({...i})), // lista >0 — validado arriba
    total:         subtotal,                     // number >0 — validado arriba
    metodo:        _tndMetodo,
    entrega:       _tndEntrega,
    estado:        'pendiente',
    origen:        'web'                         // ← NUEVO — requerido por pedidoValido()
  };

  // ── Guardar en colección pedidos_online/{id} ─────────────────────────────
  // El cliente NO escribe en aleze/db — solo en pedidos_online. A diferencia de venta/fiado,
  // acá hay UN solo documento (no varias piezas que puedan desincronizarse entre si) — pero
  // antes se mostraba "pedido enviado" SIEMPRE, sin esperar a que el guardado terminara de
  // verdad. Si fallaba, el pedido quedaba en un array local que nunca llega a ningun lado, y
  // el cliente jamas se enteraba. Ahora se espera la confirmacion real antes de avisar exito.
  if (dbModular) { // [SDK modular]
    try {
      await setDocM(docM(dbModular, 'pedidos_online', String(pedido.id)), pedido);
    } catch (e) {
      console.warn('pedidos_online write error:', e.code);
      _tndEnviando = false;
      if (btnEnviar) { btnEnviar.disabled = false; btnEnviar.textContent = '📲 Enviar pedido'; }
      alert('⚠️ No se pudo enviar tu pedido — puede ser un problema de conexión.\n\nPor favor intenta de nuevo, o escríbenos directo por WhatsApp para no perder tu pedido.');
      return;
    }
  }
  _tndEnviando = false;

  // ── Guardar historial local del cliente (solo localStorage) ─────────────
  if (_tiendaUser.tel) {
    const key = 'tnd_hist_' + _tiendaUser.tel;
    try {
      const hist = JSON.parse(localStorage.getItem(key)||'[]');
      hist.push({ fecha, hora, items: pedido.items, total: subtotal, metodo: _tndMetodo });
      localStorage.setItem(key, JSON.stringify(hist.slice(-20)));
    } catch(e) {}
  }
  // NO llamar fbGuardar() — el cliente ya no escribe en aleze/db

  // ── Armar mensaje WhatsApp ───────────────────────────────────────────────
  let msg = `🛒 *Nuevo pedido — ${DB.config.nombre||'Tienda Aleze'}*\n\n`;
  msg += `👤 *Cliente:* ${_tiendaUser.nombre}\n`;
  if (_tiendaUser.tel) msg += `📱 *WhatsApp:* ${_tiendaUser.tel}\n`;
  msg += `\n*Productos:*\n`;
  _tiendaCart.forEach(i => {
    msg += `• ${i.nombre} x${i.tipo==='granel'?Math.round(i.cant*1000)+'g':i.cant} — S/ ${subtotalItemCarrito(i).toFixed(2)}\n`;
  });
  msg += `\n*Total: S/ ${subtotal.toFixed(2)}*\n`;
  msg += `💳 *Pago:* ${_tndMetodo}\n`;
  msg += `📦 *Entrega:* ${_tndEntrega==='delivery'?'🚚 Delivery':'🏪 Recojo en tienda'}\n`;
  if (_tndEntrega==='delivery' && _tiendaUser.dir) msg += `📍 *Dirección:* ${_tiendaUser.dir}\n`;
  msg += `\n_Pedido generado desde la tienda web_`;

  const url = `https://wa.me/51${waNum}?text=${encodeURIComponent(msg)}`;
  window.open(url, '_blank');

  // ── Limpiar carrito — en memoria y en localStorage ───────────────────────
  _tiendaCart = [];
  try { localStorage.removeItem('aleze_tnd_cart'); } catch(e) {}
  tndUpdateCartBadge();
  tndFiltrar();
  document.getElementById('tnd-panel-titulo').textContent = '✅ ¡Pedido enviado!';
  document.getElementById('tnd-panel-body').innerHTML = `
    <div style="text-align:center;padding:2rem">
      <div style="font-size:4rem;margin-bottom:1rem">✅</div>
      <h3 style="font-size:1.2rem;font-weight:800;color:#1f2937;margin-bottom:.5rem">¡Tu pedido fue enviado!</h3>
      <p style="font-size:.9rem;color:#6b7280;margin-bottom:1rem">Se abrió WhatsApp con tu pedido listo para enviar a la tienda.<br>El vendedor te confirmará la disponibilidad y el costo de delivery si aplica.</p>
     <div style="background:#EDE9FE;border-radius:10px;padding:.75rem;font-size:.82rem;color:#5B21B6">
        📱 WhatsApp tienda: <strong>${waNum}</strong>
      </div>
      <div style="background:#FEF3C7;border-radius:10px;padding:.75rem;font-size:.82rem;color:#92400E;margin-top:.5rem">
        🎁 Cada compra te acerca a un premio. ¡Te esperamos pronto!
      </div>
    </div>`;
  document.getElementById('tnd-panel-footer').innerHTML = `<button class="tnd-btn tnd-btn-outline" onclick="tndCerrarPanel()">Seguir comprando</button>`;
}
